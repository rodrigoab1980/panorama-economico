// Leitor dos CSVs de DFP e ITR da CVM: transforma cada linha num "fato" normalizado.
// Lógica pura: sem disco e sem rede. Quem abre ZIP, decodifica latin1 e lê em fluxo é a casca (#37).
// As funções recebem a linha JÁ decodificada, uma por vez, porque os arquivos reais somam
// 40 milhões de linhas (docs/cvm.md).
//
// Fato (um por valor; formato intermediário decidido no checkpoint da #29):
//   cnpj, cdCvm, documento ("dfp"|"itr"), demonstrativo ("DRE"|"BPA"|"BPP"|"DFC_MI"|"DFC_MD"|"DVA"),
//   consolidado (bool), dtRefer, versao, ordem ("ultimo"|"penultimo"), inicio (null no balanço), fim,
//   conta, descricao, contaFixa (bool), valor.
// `valor` é um inteiro em R$ mil. Exceção: contas 3.99.* (lucro por ação) ficam em R$ por ação,
// como vêm, porque não estão na escala do documento.

export const DEMONSTRATIVOS = ["DRE", "BPA", "BPP", "DFC_MI", "DFC_MD", "DVA"];

const OBRIGATORIAS = [
  "CNPJ_CIA", "DT_REFER", "VERSAO", "CD_CVM", "MOEDA", "ESCALA_MOEDA", "ORDEM_EXERC",
  "DT_FIM_EXERC", "CD_CONTA", "DS_CONTA", "VL_CONTA", "ST_CONTA_FIXA",
];
const ORDENS = { "ÚLTIMO": "ultimo", "PENÚLTIMO": "penultimo" };
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const NUMERO = /^-?\d+(\.\d+)?$/;

const onde = (ctx) => (ctx?.arquivo ? `${ctx.arquivo}${ctx.linha ? `:${ctx.linha}` : ""}: ` : "");

// "dfp_cia_aberta_DRE_con_2025.csv" → { documento, demonstrativo, consolidado, ano }.
// Devolve null para arquivos que o leitor não trata (índice, composição do capital, DRA, DMPL, parecer).
export function interpretarArquivo(nome) {
  const base = String(nome).split(/[\\/]/).pop();
  const m = /^(dfp|itr)_cia_aberta_([A-Z_]+)_(con|ind)_(\d{4})\.csv$/.exec(base);
  if (!m || !DEMONSTRATIVOS.includes(m[2])) return null;
  return { documento: m[1], demonstrativo: m[2], consolidado: m[3] === "con", ano: Number(m[4]) };
}

// Tira o CR do fim (os arquivos usam CRLF). Linha vazia vira "".
export const limparLinha = (linha) => (linha.endsWith("\r") ? linha.slice(0, -1) : linha);

// Cabeçalho → posição de cada coluna. As colunas mudam entre demonstrativos
// (BPA e BPP não têm DT_INI_EXERC), então nada é lido por posição fixa.
export function interpretarCabecalho(linha, ctx) {
  const nomes = limparLinha(linha).split(";");
  const indice = Object.fromEntries(nomes.map((n, i) => [n, i]));
  const faltam = OBRIGATORIAS.filter((c) => !(c in indice));
  if (faltam.length) throw new Error(`${onde(ctx)}cabeçalho sem a(s) coluna(s) ${faltam.join(", ")}`);
  return { colunas: nomes.length, indice };
}

// Lucro por ação (3.99 e filhas) vem em R$ por ação, fora da escala do documento.
export const ehPorAcao = (conta) => conta === "3.99" || conta.startsWith("3.99.");

// VL_CONTA ("273505274.0000000000") + ESCALA_MOEDA → inteiro em R$ mil.
// MIL fica como está; UNIDADE divide por 1.000. Frações (raras em MIL, comuns em UNIDADE)
// são arredondadas ao inteiro mais próximo. Valor não numérico ou escala desconhecida dá erro.
export function normalizarValor(texto, escala, ctx) {
  if (!NUMERO.test(texto)) throw new Error(`${onde(ctx)}VL_CONTA não numérico: "${texto}"`);
  const bruto = Number(texto);
  let emMil;
  if (escala === "MIL") emMil = bruto;
  else if (escala === "UNIDADE") emMil = bruto / 1000;
  else throw new Error(`${onde(ctx)}ESCALA_MOEDA desconhecida: "${escala}"`);
  return Math.round(emMil) || 0; // "|| 0" evita o -0
}

// Uma linha de dados → fato. `origem` vem de interpretarArquivo(); `ctx` = { arquivo, linha } para os erros.
export function linhaParaFato(cabecalho, linha, origem, ctx) {
  const campos = limparLinha(linha).split(";");
  if (campos.length !== cabecalho.colunas) {
    throw new Error(`${onde(ctx)}linha malformada: ${campos.length} colunas, o cabeçalho tem ${cabecalho.colunas}`);
  }
  const campo = (nome) => campos[cabecalho.indice[nome]];

  const ordem = ORDENS[campo("ORDEM_EXERC")];
  if (!ordem) {
    throw new Error(`${onde(ctx)}ORDEM_EXERC desconhecida: "${campo("ORDEM_EXERC")}" (o arquivo foi decodificado como latin1?)`);
  }
  if (campo("MOEDA") !== "REAL") throw new Error(`${onde(ctx)}MOEDA desconhecida: "${campo("MOEDA")}"`);

  const data = (nome) => {
    const v = campo(nome);
    if (!DATA.test(v)) throw new Error(`${onde(ctx)}${nome} inválida: "${v}"`);
    return v;
  };
  const versao = Number(campo("VERSAO"));
  if (!Number.isInteger(versao) || versao < 1) throw new Error(`${onde(ctx)}VERSAO inválida: "${campo("VERSAO")}"`);
  const fixa = campo("ST_CONTA_FIXA");
  if (fixa !== "S" && fixa !== "N") throw new Error(`${onde(ctx)}ST_CONTA_FIXA inválida: "${fixa}"`);

  const conta = campo("CD_CONTA");
  const texto = campo("VL_CONTA");
  let valor;
  if (ehPorAcao(conta)) {
    if (!NUMERO.test(texto)) throw new Error(`${onde(ctx)}VL_CONTA não numérico: "${texto}"`);
    valor = Number(texto);
  } else {
    valor = normalizarValor(texto, campo("ESCALA_MOEDA"), ctx);
  }

  return {
    cnpj: campo("CNPJ_CIA"),
    cdCvm: campo("CD_CVM"),
    documento: origem.documento,
    demonstrativo: origem.demonstrativo,
    consolidado: origem.consolidado,
    dtRefer: data("DT_REFER"),
    versao,
    ordem,
    inicio: "DT_INI_EXERC" in cabecalho.indice ? data("DT_INI_EXERC") : null,
    fim: data("DT_FIM_EXERC"),
    conta,
    descricao: campo("DS_CONTA"),
    contaFixa: fixa === "S",
    valor,
  };
}

// Para ler em fluxo: devolve uma função que recebe uma linha por vez (a primeira é o cabeçalho)
// e devolve o fato, ou null para o cabeçalho e para linhas vazias (a última linha do arquivo é vazia).
export function criarLeitor(nomeArquivo) {
  const origem = interpretarArquivo(nomeArquivo);
  if (!origem) throw new Error(`${nomeArquivo}: não é um demonstrativo que o leitor trata (${DEMONSTRATIVOS.join(", ")})`);
  let cabecalho = null, numero = 0;
  return (linha) => {
    numero++;
    if (limparLinha(linha) === "") return null;
    const ctx = { arquivo: nomeArquivo, linha: numero };
    if (!cabecalho) { cabecalho = interpretarCabecalho(linha, ctx); return null; }
    return linhaParaFato(cabecalho, linha, origem, ctx);
  };
}

const chaveDoc = (f) => `${f.cnpj}|${f.documento}|${f.dtRefer}`;

// Fica só com a maior VERSAO de cada documento (cnpj + documento + dtRefer).
export function escolherVersao(fatos) {
  const maior = new Map();
  for (const f of fatos) {
    const k = chaveDoc(f);
    if ((maior.get(k) ?? 0) < f.versao) maior.set(k, f.versao);
  }
  return fatos.filter((f) => f.versao === maior.get(chaveDoc(f)));
}

// Consolidado × individual, por documento (não por conta): se o documento tem consolidado,
// saem todos os fatos individuais dele; o individual só fica quando não há consolidado.
export function escolherConsolidado(fatos) {
  const comConsolidado = new Set(fatos.filter((f) => f.consolidado).map(chaveDoc));
  return fatos.filter((f) => f.consolidado || !comConsolidado.has(chaveDoc(f)));
}

// Conveniência (testes e conjuntos pequenos): [{ nome, linhas }] → fatos já com versão e
// consolidado escolhidos. `linhas` é qualquer iterável de linhas decodificadas, com o cabeçalho na primeira.
// Arquivos que o leitor não trata são ignorados.
export function lerArquivos(arquivos) {
  const fatos = [];
  for (const { nome, linhas } of arquivos) {
    if (!interpretarArquivo(nome)) continue;
    const ler = criarLeitor(nome);
    for (const linha of linhas) {
      const fato = ler(linha);
      if (fato) fatos.push(fato);
    }
  }
  return escolherConsolidado(escolherVersao(fatos));
}
