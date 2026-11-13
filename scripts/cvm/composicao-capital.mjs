// Composição do capital (número de ações) dos arquivos `*_cia_aberta_composicao_capital_AAAA.csv`.
// Lógica pura: sem disco, sem rede e sem relógio. Fica fora do leitor de DFP e ITR (leitor.mjs), que
// só trata demonstrativos com conta e valor.
//
// O arquivo vem na DFP e também no ITR, com uma linha por documento e versão:
//   CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_TOTAL_CAP_INTEGR;
//   QT_ACAO_ORDIN_TESOURO;QT_ACAO_PREF_TESOURO;QT_ACAO_TOTAL_TESOURO
//
// ESCALA: o arquivo não diz se as quantidades estão em unidades ou em milhares, e as companhias usam as
// duas. Na DFP de 2025, 17 das 64 companhias da página informam em milhares (a Vale informa 4.539.007 e
// tem 4,5 bilhões de ações). lerComposicaoCapital devolve o número como veio; escalaDasAcoes descobre a
// escala e emUnidades converte.

const COLUNAS = ["CNPJ_CIA", "DT_REFER", "VERSAO", "QT_ACAO_TOTAL_CAP_INTEGR", "QT_ACAO_TOTAL_TESOURO"];

function inteiro(texto, coluna, numeroDaLinha) {
  const limpo = String(texto ?? "").trim();
  if (limpo === "") return null;
  if (!/^\d+(\.0+)?$/.test(limpo)) throw new Error(`composição do capital, linha ${numeroDaLinha}: ${coluna} não é um inteiro ("${limpo}")`);
  return Number(limpo.split(".")[0]);
}

// Lê o texto de um CSV de composição do capital (já decodificado de latin1).
// Devolve [{ cnpj, dtRefer, versao, acoesTotal, acoesTesouraria, acoesCirculacao }], uma entrada por
// (companhia, data), a de maior versão, em ordem de companhia e de data.
//   acoesTotal        ações do capital integralizado (ordinárias + preferenciais)
//   acoesTesouraria   ações em tesouraria; campo vazio conta como 0
//   acoesCirculacao   total − tesouraria; null quando o total não vem ou vem zero
export function lerComposicaoCapital(texto) {
  const linhas = String(texto ?? "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length === 0) return [];
  const cab = linhas[0].split(";").map((c) => c.trim());
  for (const c of COLUNAS) if (!cab.includes(c)) throw new Error(`composição do capital sem a coluna ${c}`);
  const i = Object.fromEntries(COLUNAS.map((c) => [c, cab.indexOf(c)]));

  const porDocumento = new Map();
  linhas.slice(1).forEach((linha, k) => {
    const n = k + 2;
    const c = linha.split(";");
    if (c.length !== cab.length) throw new Error(`composição do capital, linha ${n}: ${c.length} colunas, esperava ${cab.length}`);
    const versao = inteiro(c[i.VERSAO], "VERSAO", n);
    const total = inteiro(c[i.QT_ACAO_TOTAL_CAP_INTEGR], "QT_ACAO_TOTAL_CAP_INTEGR", n);
    const tesouraria = inteiro(c[i.QT_ACAO_TOTAL_TESOURO], "QT_ACAO_TOTAL_TESOURO", n) ?? 0;
    const item = {
      cnpj: c[i.CNPJ_CIA], dtRefer: c[i.DT_REFER], versao,
      acoesTotal: total, acoesTesouraria: tesouraria,
      acoesCirculacao: total == null || total === 0 ? null : total - tesouraria,
    };
    const chave = `${item.cnpj}|${item.dtRefer}`;
    const atual = porDocumento.get(chave);
    if (!atual || item.versao > atual.versao) porDocumento.set(chave, item);
  });
  return [...porDocumento.values()].sort((a, b) => (a.cnpj < b.cnpj ? -1 : a.cnpj > b.cnpj ? 1 : a.dtRefer < b.dtRefer ? -1 : a.dtRefer > b.dtRefer ? 1 : 0));
}

// Abaixo deste total, o número só pode estar em milhares de ações. Na DFP de 2025 das 64 companhias da
// página, o maior total informado em milhares é 15,8 milhões (Ambev) e o menor informado em unidades é
// 206 milhões (Azzas): 100 milhões fica no meio, com folga dos dois lados. É a regra de reserva, usada
// só quando o lucro por ação informado não resolve.
export const LIMITE_ACOES_EM_MIL = 100_000_000;

// Em que escala está o total de ações de uma composição? Devolve { escala: "unidade" | "mil", por } ou null.
//   1. Pelo lucro por ação que a própria companhia informa no mesmo documento (DRE, conta 3.99): o lucro
//      da controladora dividido por ele dá o número de ações que a companhia usou na conta. Se esse
//      número é da ordem do total informado, a escala é unidade; se é cerca de mil vezes maior, é mil.
//      (O lucro por ação usa a média do período e o total é o do fim; por isso a comparação é larga.)
//   2. Se não há lucro por ação informado, ou ele não fecha com nenhuma das duas, pela ordem de
//      grandeza: total abaixo de LIMITE_ACOES_EM_MIL está em milhares.
// `lucro` em R$ mil; `lucroPorAcaoInformado` em R$ por ação.
export function escalaDasAcoes({ acoesTotal, lucro, lucroPorAcaoInformado }) {
  if (acoesTotal == null || acoesTotal <= 0) return null;
  if (lucro && lucroPorAcaoInformado) {
    const razao = (lucro * 1000) / lucroPorAcaoInformado / acoesTotal;
    if (razao >= 0.5 && razao <= 2) return { escala: "unidade", por: "lucro por ação informado" };
    if (razao >= 500 && razao <= 2000) return { escala: "mil", por: "lucro por ação informado" };
  }
  return { escala: acoesTotal < LIMITE_ACOES_EM_MIL ? "mil" : "unidade", por: "ordem de grandeza" };
}

// A composição com as quantidades em unidades de ação. `escala` é a saída de escalaDasAcoes.
export function emUnidades(composicao, escala) {
  if (composicao == null || escala == null) return composicao ?? null;
  const fator = escala.escala === "mil" ? 1000 : 1;
  const vezes = (n) => (n == null ? null : n * fator);
  return {
    ...composicao,
    acoesTotal: vezes(composicao.acoesTotal), acoesTesouraria: vezes(composicao.acoesTesouraria), acoesCirculacao: vezes(composicao.acoesCirculacao),
    escala: escala.escala, escalaPor: escala.por,
  };
}

// A composição de uma data, entre as de UMA companhia. Devolve a entrada com `dtRefer` igual a `data`.
// Se não houver e `aceitarAnterior` for true, devolve a mais recente anterior à data (para os 12 meses,
// quando o ITR não traz a composição): quem usa vê pela `dtRefer` de onde veio.
export function composicaoNaData(composicoes, data, { aceitarAnterior = false } = {}) {
  const lista = composicoes ?? [];
  const exata = lista.find((c) => c.dtRefer === data);
  if (exata || !aceitarAnterior) return exata ?? null;
  return lista.filter((c) => c.dtRefer < data).sort((a, b) => (a.dtRefer < b.dtRefer ? 1 : -1))[0] ?? null;
}
