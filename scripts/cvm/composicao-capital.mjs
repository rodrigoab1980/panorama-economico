// Composição do capital (número de ações) dos arquivos `*_cia_aberta_composicao_capital_AAAA.csv`.
// Lógica pura: sem disco, sem rede e sem relógio. Fica fora do leitor de DFP e ITR (leitor.mjs), que
// só trata demonstrativos com conta e valor.
//
// O arquivo vem na DFP e também no ITR, com uma linha por documento e versão:
//   CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_TOTAL_CAP_INTEGR;
//   QT_ACAO_ORDIN_TESOURO;QT_ACAO_PREF_TESOURO;QT_ACAO_TOTAL_TESOURO
// As quantidades são em unidades (ações), não em milhares.

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

// A composição de uma data, entre as de UMA companhia. Devolve a entrada com `dtRefer` igual a `data`.
// Se não houver e `aceitarAnterior` for true, devolve a mais recente anterior à data (para os 12 meses,
// quando o ITR não traz a composição): quem usa vê pela `dtRefer` de onde veio.
export function composicaoNaData(composicoes, data, { aceitarAnterior = false } = {}) {
  const lista = composicoes ?? [];
  const exata = lista.find((c) => c.dtRefer === data);
  if (exata || !aceitarAnterior) return exata ?? null;
  return lista.filter((c) => c.dtRefer < data).sort((a, b) => (a.dtRefer < b.dtRefer ? 1 : -1))[0] ?? null;
}
