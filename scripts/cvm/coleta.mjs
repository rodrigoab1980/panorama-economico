// Coleta semanal dos fundamentos (#37): as regras, sem disco, sem rede e sem relógio.
// A casca (scripts/coletar-fundamentos.mjs) baixa os ZIPs da CVM, lê em fluxo e grava; aqui fica o que
// dá para testar: quais arquivos baixar, o que aproveitar de cada linha, o formato gravado na branch
// `dados`, a serialização estável e a decisão do que gravar.
//
// Três etapas, cada uma com a sua saída:
//   1. extrato   de cada ZIP da CVM sai um extrato: só as linhas das companhias do universo, já como
//                fatos, agrupados em blocos. É o que fica em cache (um por ZIP e por Last-Modified).
//   2. companhia dos extratos sai um arquivo por companhia, `fundamentos/<cdCvm>.json`, com os fatos
//                (versão e consolidado já escolhidos) e a composição do capital. São fatos, não
//                indicadores: quem calcula é o build, e mudar uma fórmula não pede coleta nova.
//   3. índice    `fundamentos/indice.json`: a data da coleta, o estado de cada ZIP e, de cada
//                companhia, o documento mais recente (para o carimbo de desatualizado) e o que falhou.
import { consolidadosZerados, criarLeitor, escolherConsolidado, escolherVersao, interpretarArquivo } from "./leitor.mjs";
import { lerComposicaoCapital } from "./composicao-capital.mjs";

export const BASE_CVM = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC";
export const PRIMEIRO_ANO_DFP = 2010;
export const PASTA_FUNDAMENTOS = "fundamentos";
export const ARQUIVO_INDICE = "indice.json";
// Muda quando o formato do extrato ou do arquivo da companhia muda; entra na chave do cache.
export const FORMATO = 1;

// ---------- o que baixar ----------

// Anos de cada documento para a data da coleta ("AAAA-MM-DD"):
//   DFP  de 2010 até o ano corrente (a série anual inteira);
//   ITR  só o ano corrente e o anterior, que é tudo o que a base de 12 meses usa.
export function anosDaColeta(hoje) {
  const ano = Number(String(hoje).slice(0, 4));
  if (!Number.isInteger(ano) || ano < PRIMEIRO_ANO_DFP) throw new Error(`data da coleta inválida: ${hoje}`);
  return {
    dfp: Array.from({ length: ano - PRIMEIRO_ANO_DFP + 1 }, (_, i) => PRIMEIRO_ANO_DFP + i),
    itr: [ano - 1, ano],
  };
}

// Os ZIPs da coleta: [{ nome, documento, ano, url }], DFP antes de ITR, em ordem de ano.
export function arquivosDaColeta(hoje) {
  const { dfp, itr } = anosDaColeta(hoje);
  const arquivo = (documento, ano) => {
    const nome = `${documento}_cia_aberta_${ano}.zip`;
    return { nome, documento, ano, url: `${BASE_CVM}/${documento.toUpperCase()}/DADOS/${nome}` };
  };
  return [...dfp.map((a) => arquivo("dfp", a)), ...itr.map((a) => arquivo("itr", a))];
}

// O que fazer com uma entrada do ZIP, pelo nome: "demonstrativo" (DRE, BPA, BPP, DFC e DVA, consolidado
// e individual), "composicao" (composição do capital) ou null (índice, DMPL, DRA, parecer).
export function tipoDaEntrada(nome) {
  const base = String(nome).split(/[\\/]/).pop();
  if (interpretarArquivo(base)) return "demonstrativo";
  if (/^(dfp|itr)_cia_aberta_composicao_capital_\d{4}\.csv$/.test(base)) return "composicao";
  return null;
}

// ---------- extrato de um ZIP ----------

const CAMPOS_DO_BLOCO = ["documento", "dtRefer", "versao", "consolidado", "demonstrativo", "ordem", "inicio", "fim"];
const chaveDoBloco = (f) => CAMPOS_DO_BLOCO.map((c) => String(f[c])).join("|");
const ordenar = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Agrupa fatos de UMA companhia em blocos, um por (documento, data, versão, base, demonstrativo, coluna):
//   { documento, dtRefer, versao, consolidado, demonstrativo, ordem, inicio, fim, contas: [[conta, descricao, fixa (1|0), valor]] }
// É o formato intermediário da #29 sem repetir em cada linha o que é igual no bloco inteiro. As contas
// ficam na ordem em que vieram do arquivo (a ordem do demonstrativo); os blocos, em ordem estável.
export function agruparEmBlocos(fatos) {
  const blocos = new Map();
  for (const f of fatos) {
    const k = chaveDoBloco(f);
    let b = blocos.get(k);
    if (!b) {
      b = { ...Object.fromEntries(CAMPOS_DO_BLOCO.map((c) => [c, f[c]])), contas: [] };
      blocos.set(k, b);
    }
    b.contas.push([f.conta, f.descricao, f.contaFixa ? 1 : 0, f.valor]);
  }
  const ordem = (b) => [b.dtRefer, b.documento, String(b.versao).padStart(4, "0"), b.consolidado ? "0" : "1", b.demonstrativo, b.ordem, b.inicio ?? "", b.fim].join("|");
  return [...blocos.values()].sort((a, b) => ordenar(ordem(a), ordem(b)));
}

// O inverso: blocos → fatos do leitor, com o cnpj e o cdCvm da companhia.
export function fatosDosBlocos(blocos, { cnpj, cdCvm }) {
  const fatos = [];
  for (const b of blocos ?? []) {
    for (const [conta, descricao, fixa, valor] of b.contas) {
      fatos.push({
        cnpj, cdCvm, documento: b.documento, demonstrativo: b.demonstrativo, consolidado: b.consolidado, dtRefer: b.dtRefer,
        versao: b.versao, ordem: b.ordem, inicio: b.inicio, fim: b.fim, conta, descricao, contaFixa: fixa === 1, valor,
      });
    }
  }
  return fatos;
}

// Monta o extrato de um ZIP, uma entrada por vez, sem guardar o que não é do universo.
//   companhias  as do universo que entram na página: [{ cnpj, cdCvm }]
// Devolve { demonstrativo(nomeDaEntrada), composicao(nomeDaEntrada), extrato() }:
//   demonstrativo(nome)  → função que recebe uma linha por vez (a primeira é o cabeçalho)
//   composicao(nome)     → idem, para o CSV de composição do capital
//   extrato()            → { formato, companhias: { cdCvm: { blocos, composicoes } }, linhas: { lidas, aproveitadas } }
// A linha de outra companhia é descartada pelo CNPJ, que são os 18 primeiros caracteres, antes de virar fato.
export function criarExtrator(companhias) {
  const porCnpj = new Map(companhias.map((c) => [c.cnpj, c]));
  const fatos = new Map(companhias.map((c) => [c.cdCvm, []]));
  const composicoes = new Map(companhias.map((c) => [c.cdCvm, []]));
  const linhas = { lidas: 0, aproveitadas: 0 };
  const doUniverso = (linha) => porCnpj.get(linha.slice(0, 18));

  return {
    demonstrativo(nome) {
      const ler = criarLeitor(String(nome).split(/[\\/]/).pop());
      let primeira = true;
      return (linha) => {
        linhas.lidas++;
        if (primeira) { primeira = false; ler(linha); return; } // cabeçalho: confere as colunas
        const cia = doUniverso(linha);
        if (!cia) { ler(""); return; } // mantém a contagem de linhas do leitor, para as mensagens de erro
        const fato = ler(linha);
        if (fato) { fatos.get(cia.cdCvm).push(fato); linhas.aproveitadas++; }
      };
    },
    composicao() {
      let cabecalho = null;
      const guardadas = [];
      const receber = (linha) => {
        linhas.lidas++;
        const limpa = linha.endsWith("\r") ? linha.slice(0, -1) : linha;
        if (cabecalho == null) { cabecalho = limpa; return; }
        if (doUniverso(limpa)) { guardadas.push(limpa); linhas.aproveitadas++; }
      };
      receber.fechar = () => {
        if (cabecalho == null) return;
        for (const c of lerComposicaoCapital([cabecalho, ...guardadas].join("\n"))) composicoes.get(porCnpj.get(c.cnpj).cdCvm).push(c);
      };
      return receber;
    },
    extrato() {
      const saida = {};
      for (const c of companhias) {
        const blocos = agruparEmBlocos(fatos.get(c.cdCvm));
        const comp = composicoes.get(c.cdCvm);
        if (blocos.length || comp.length) saida[c.cdCvm] = { blocos, composicoes: comp };
      }
      return { formato: FORMATO, companhias: saida, linhas };
    },
  };
}

// ---------- arquivo de uma companhia ----------

// A companhia depende deste ZIP? Depende se o arquivo anterior dela tirou dados dele, ou se o ZIP é
// do ano corrente ou do anterior (onde aparecem os documentos novos). Sem arquivo anterior, depende
// de todos: não dá para saber o que estaria lá.
export function dependeDoArquivo(anterior, arquivo, anoCorrente) {
  if (!anterior) return true;
  if (arquivo.ano >= anoCorrente - 1) return true;
  return (anterior.origem ?? []).some((o) => o.arquivo === arquivo.nome);
}

// Junta os extratos de todos os ZIPs no arquivo de uma companhia.
//   companhia  { cnpj, cdCvm, tickers } do universo
//   extratos   [{ arquivo: { nome, lastModified }, extrato }] dos ZIPs que deram certo
// Devolve { cnpj, cdCvm, tickers, fatos, composicoes, origem, avisos } ou null quando nenhum ZIP traz a companhia.
//   fatos        blocos, já com a maior versão de cada documento e com consolidado × individual resolvido
//   composicoes  composição do capital de cada documento, como veio (a escala é resolvida no build)
//   origem       [{ arquivo, lastModified }] dos ZIPs que trouxeram alguma coisa da companhia
//   avisos       o que merece ser olhado: consolidado zerado tratado como ausente
export function montarCompanhia(companhia, extratos) {
  const { cnpj, cdCvm } = companhia;
  const fatos = [];
  const composicoes = new Map();
  const origem = [];
  for (const { arquivo, extrato } of extratos) {
    const parte = extrato.companhias?.[cdCvm];
    if (!parte) continue;
    origem.push({ arquivo: arquivo.nome, lastModified: arquivo.lastModified ?? null });
    fatos.push(...fatosDosBlocos(parte.blocos, { cnpj, cdCvm }));
    for (const c of parte.composicoes ?? []) {
      const atual = composicoes.get(c.dtRefer);
      if (!atual || c.versao > atual.versao) composicoes.set(c.dtRefer, c);
    }
  }
  if (origem.length === 0) return null;
  const daVersao = escolherVersao(fatos);
  const avisos = consolidadosZerados(daVersao).map((d) => `consolidado zerado ${d.documento === "dfp" ? "na DFP" : "no ITR"} de ${dataBr(d.dtRefer)}: vale o individual`);
  return {
    cnpj, cdCvm,
    tickers: companhia.tickers.map((t) => t.ticker),
    fatos: agruparEmBlocos(escolherConsolidado(daVersao)),
    composicoes: [...composicoes.values()].sort((a, b) => ordenar(a.dtRefer, b.dtRefer)),
    origem: origem.sort((a, b) => ordenar(a.arquivo, b.arquivo)),
    avisos,
  };
}

const dataBr = (iso) => String(iso).split("-").reverse().join("/");

// Fatos do leitor a partir do arquivo de uma companhia (para montarSeries, no build).
export const fatosDaCompanhia = (arquivo) => fatosDosBlocos(arquivo.fatos, arquivo);

// O documento mais recente de uma companhia, para o carimbo de desatualizado: { tipo, dtRefer, versao }.
// Entre documentos da mesma data, a DFP vem antes do ITR (não acontece na prática).
export function documentoMaisRecente(arquivo) {
  let melhor = null;
  for (const b of Array.isArray(arquivo?.fatos) ? arquivo.fatos : []) {
    if (!melhor || b.dtRefer > melhor.dtRefer || (b.dtRefer === melhor.dtRefer && b.documento === "dfp" && melhor.tipo !== "dfp")) {
      melhor = { tipo: b.documento, dtRefer: b.dtRefer, versao: b.versao };
    }
  }
  return melhor;
}

// ---------- serialização ----------

// JSON com as chaves em ordem alfabética, em qualquer profundidade: o mesmo dado dá os mesmos bytes,
// não importa a ordem em que as chaves foram criadas. As listas ficam na ordem em que estão (quem monta
// é que ordena). `nivel` é até onde o texto é quebrado em linhas: o que está mais fundo sai numa linha
// só, para o arquivo ficar pequeno e o `git diff` mostrar um bloco por linha. Termina com "\n".
export function serializar(valor, { nivel = 2 } = {}) {
  const compacto = (v) => {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(compacto).join(",")}]`;
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${compacto(v[k])}`).join(",")}}`;
  };
  const quebrado = (v, profundidade) => {
    if (v === null || typeof v !== "object" || profundidade >= nivel) return compacto(v);
    const recuo = " ".repeat(profundidade + 1);
    const fecho = " ".repeat(profundidade);
    if (Array.isArray(v)) {
      if (v.length === 0) return "[]";
      return `[\n${v.map((x) => recuo + quebrado(x, profundidade + 1)).join(",\n")}\n${fecho}]`;
    }
    const chaves = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    if (chaves.length === 0) return "{}";
    return `{\n${chaves.map((k) => `${recuo}${JSON.stringify(k)}: ${quebrado(v[k], profundidade + 1)}`).join(",\n")}\n${fecho}}`;
  };
  return `${quebrado(valor, 0)}\n`;
}

// ---------- o que gravar ----------

export const caminhoDaCompanhia = (cdCvm) => `${PASTA_FUNDAMENTOS}/${cdCvm}.json`;
export const CAMINHO_DO_INDICE = `${PASTA_FUNDAMENTOS}/${ARQUIVO_INDICE}`;

// Decide o que a coleta grava.
//   companhias  as do universo que entram na página: [{ cnpj, cdCvm, tickers }]
//   arquivos    os ZIPs da coleta, cada um com o resultado: [{ nome, ano, lastModified, tamanho, status ("ok" | "falhou"), motivo }]
//   extratos    [{ arquivo, extrato }] dos ZIPs com status "ok"
//   anteriores  { caminho: texto } do que já está gravado (os arquivos das companhias e o índice)
//   agora       Date da coleta; anoCorrente: o ano dela
// Devolve { gravar: { caminho: texto }, indice, resumo }:
//   - Companhia que depende de um ZIP que falhou: mantém o arquivo anterior (status "mantido"); sem
//     arquivo anterior, fica "falhou". Nada é zerado.
//   - Companhia que dá erro ao montar: mantém o anterior, e as outras seguem.
//   - Só entra em `gravar` o arquivo cujo texto mudou. O índice só é gravado quando alguma companhia
//     ou o estado de algum ZIP mudou (a data da coleta sozinha não conta): sem mudança, `gravar` vem
//     vazio e não há commit.
export function decidirSaida({ companhias, arquivos, extratos, anteriores = {}, agora, anoCorrente }) {
  const gravar = {};
  const falhos = arquivos.filter((a) => a.status !== "ok");
  const estado = {};
  for (const cia of [...companhias].sort((a, b) => ordenar(a.cdCvm, b.cdCvm))) {
    const caminho = caminhoDaCompanhia(cia.cdCvm);
    const textoAnterior = anteriores[caminho] ?? null;
    let anterior = null;
    try { anterior = textoAnterior ? JSON.parse(textoAnterior) : null; } catch { anterior = null; }
    const tickers = cia.tickers.map((t) => t.ticker);
    const manter = (motivo) => {
      estado[cia.cdCvm] = { tickers, documentoMaisRecente: documentoMaisRecente(anterior), status: anterior ? "mantido" : "falhou", motivo, avisos: anterior?.avisos ?? [] };
    };
    const culpados = falhos.filter((a) => dependeDoArquivo(anterior, a, anoCorrente));
    if (culpados.length) { manter(`falhou ${culpados.map((a) => `${a.nome} (${a.motivo})`).join("; ")}`); continue; }
    try {
      const nova = montarCompanhia(cia, extratos);
      if (!nova) { manter("nenhum arquivo da CVM traz a companhia"); continue; }
      const texto = serializar(nova);
      if (texto !== textoAnterior) gravar[caminho] = texto;
      estado[cia.cdCvm] = { tickers, documentoMaisRecente: documentoMaisRecente(nova), status: "ok", motivo: null, avisos: nova.avisos };
    } catch (e) {
      manter(`erro ao montar: ${e.message}`);
    }
  }

  const indice = {
    coletadoEm: agora.toISOString(),
    arquivos: Object.fromEntries(arquivos.map((a) => [a.nome, { lastModified: a.lastModified ?? null, tamanho: a.tamanho ?? null, status: a.status, motivo: a.motivo ?? null }])),
    companhias: estado,
  };
  let indiceAnterior = null;
  try { indiceAnterior = anteriores[CAMINHO_DO_INDICE] ? JSON.parse(anteriores[CAMINHO_DO_INDICE]) : null; } catch { indiceAnterior = null; }
  const semData = (i) => serializar({ ...i, coletadoEm: null });
  const mudou = Object.keys(gravar).length > 0 || !indiceAnterior || semData(indiceAnterior) !== semData(indice);
  // Se todos os ZIPs falharam, nada é gravado, nem o índice: nenhum commit.
  const tudoFalhou = arquivos.length > 0 && falhos.length === arquivos.length;
  if (mudou && !tudoFalhou) gravar[CAMINHO_DO_INDICE] = serializar(indice, { nivel: 3 });

  const porStatus = (s) => Object.values(estado).filter((c) => c.status === s).length;
  return {
    gravar, indice,
    resumo: { ok: porStatus("ok"), mantidas: porStatus("mantido"), falharam: porStatus("falhou"), arquivosComFalha: falhos.length, tudoFalhou, gravados: Object.keys(gravar).length },
  };
}
