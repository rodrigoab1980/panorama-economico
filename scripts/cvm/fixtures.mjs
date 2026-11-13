// Lógica pura das fixtures da CVM: sem rede e sem disco.
// Recebe e devolve Buffers; latin1 mapeia byte a byte, então os bytes originais
// (acentos e CRLF) saem idênticos.

// Quais recortes compõem cada fixture, por CD_CVM.
export const FIXTURES = {
  "005410": { pasta: "weg", documentos: [{ doc: "dfp", ano: 2025 }, { doc: "itr", ano: 2026, dtRefer: "2026-09-30" }] },
  "005258": { pasta: "raia-drogasil", documentos: [{ doc: "dfp", ano: 2025 }] },
  "024392": { pasta: "hapvida", documentos: [{ doc: "dfp", ano: 2022 }, { doc: "dfp", ano: 2023 }] },
};

const DEMONSTRATIVOS = ["DRE", "BPA", "BPP", "DFC_MI", "DVA"];

// Nomes dos CSVs de um documento: índice, demonstrativos consolidados e,
// na DFP, a composição do capital.
export function arquivosDoDocumento(doc, ano) {
  const nomes = [`${doc}_cia_aberta_${ano}.csv`];
  for (const d of DEMONSTRATIVOS) nomes.push(`${doc}_cia_aberta_${d}_con_${ano}.csv`);
  if (doc === "dfp") nomes.push(`${doc}_cia_aberta_composicao_capital_${ano}.csv`);
  return nomes;
}

function separar(bytes) {
  const texto = Buffer.from(bytes).toString("latin1");
  const linhas = texto.split("\r\n");
  if (linhas.at(-1) === "") linhas.pop();
  return { cabecalho: linhas[0], cab: linhas[0].split(";"), linhas: linhas.slice(1) };
}

// CNPJ da empresa com esse CD_CVM no arquivo de índice (dfp/itr_cia_aberta_AAAA.csv).
export function cnpjDoCodigo(indice, cdCvm) {
  const { cab, linhas } = separar(indice);
  const iCnpj = cab.indexOf("CNPJ_CIA"), iCod = cab.indexOf("CD_CVM");
  if (iCnpj < 0 || iCod < 0) throw new Error("índice sem as colunas CNPJ_CIA e CD_CVM");
  for (const l of linhas) {
    const c = l.split(";");
    if (c[iCod] === cdCvm) return c[iCnpj];
  }
  return null;
}

// Cabeçalho + linhas do CNPJ (e, se informado, só do DT_REFER), com CRLF no fim.
export function recortarCsv(bytes, cnpj, dtRefer) {
  const { cabecalho, cab, linhas } = separar(bytes);
  const iCnpj = cab.indexOf("CNPJ_CIA"), iData = cab.indexOf("DT_REFER");
  if (iCnpj < 0 || iData < 0) throw new Error("CSV sem as colunas CNPJ_CIA e DT_REFER");
  const ficam = linhas.filter((l) => {
    const c = l.split(";");
    return c[iCnpj] === cnpj && (!dtRefer || c[iData] === dtRefer);
  });
  return Buffer.from([cabecalho, ...ficam].map((l) => `${l}\r\n`).join(""), "latin1");
}
