// Lógica pura das fixtures da CVM: sem rede e sem disco.
// Recebe e devolve Buffers; latin1 mapeia byte a byte, então os bytes originais
// (acentos e CRLF) saem idênticos.

// Quais recortes compõem cada fixture, por CD_CVM.
export const FIXTURES = {
  // O ITR do mesmo período do ano anterior entra porque a base de 12 meses usa o acumulado dele (#33).
  "005410": { pasta: "weg", documentos: [{ doc: "dfp", ano: 2025 }, { doc: "itr", ano: 2025, dtRefer: "2025-09-30" }, { doc: "itr", ano: 2026, dtRefer: "2026-09-30" }] },
  "005258": { pasta: "raia-drogasil", documentos: [{ doc: "dfp", ano: 2025 }] },
  "024392": { pasta: "hapvida", documentos: [{ doc: "dfp", ano: 2022 }, { doc: "dfp", ano: 2023 }] },
  // São Martinho: exercício de abril a março. O arquivo do ano AAAA traz os documentos com DT_REFER em AAAA,
  // então a DFP de 31/03/2026 está no arquivo de 2026. O último ITR entregue é o de 30/06/2026 (1º trimestre).
  "020516": {
    pasta: "sao-martinho",
    documentos: [{ doc: "dfp", ano: 2025 }, { doc: "dfp", ano: 2026 }, { doc: "itr", ano: 2025, dtRefer: "2025-06-30" }, { doc: "itr", ano: 2026, dtRefer: "2026-06-30" }],
  },
};

// Fixture do FCA (cadastro e códigos de negociação), usada nos testes do universo (#32).
// Cada empresa cobre um caso: ON e PN, unit, código inválido, nome trocado, ticker com dígito,
// data de fim preenchida por engano e negociação encerrada de verdade.
export const FIXTURE_FCA = {
  pasta: "fca",
  ano: 2026,
  cdCvms: [
    "009512", // Petrobras: ON e PN (PETR3, PETR4)
    "012653", // Klabin: só a unit (KLBN11)
    "015253", // Energisa: unit, ON e PN (ENGI11, ENGI3, ENGI4)
    "004030", // CSN: código de negociação inválido ("4030")
    "002437", // Axia Energia: antiga Eletrobras (ELET3 → AXIA3)
    "021610", // B3: ticker com dígito no meio (B3SA3)
    "024848", // C&A: data de fim igual à de início (CEAB3)
    "016292", // BRF: BRFS3 com negociação encerrada em 2025
    "020788", // Marfrig: código "ADR"; hoje negocia como MBRF3
  ],
};

export const arquivosDoFca = (ano) => [`fca_cia_aberta_geral_${ano}.csv`, `fca_cia_aberta_valor_mobiliario_${ano}.csv`];

const DEMONSTRATIVOS = ["DRE", "BPA", "BPP", "DFC_MI", "DVA"];

// Nomes dos CSVs de um documento: índice, demonstrativos consolidados e a composição do capital
// (o ITR também traz a composição: é dela que sai o número de ações dos 12 meses, #36).
export function arquivosDoDocumento(doc, ano) {
  const nomes = [`${doc}_cia_aberta_${ano}.csv`];
  for (const d of DEMONSTRATIVOS) nomes.push(`${doc}_cia_aberta_${d}_con_${ano}.csv`);
  nomes.push(`${doc}_cia_aberta_composicao_capital_${ano}.csv`);
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

// CNPJs das companhias com esses códigos CVM, pelo fca_cia_aberta_geral_AAAA.csv.
// Código que não aparece dá erro, para a fixture não sair incompleta em silêncio.
export function cnpjsDoFca(geral, cdCvms) {
  const { cab, linhas } = separar(geral);
  const iCnpj = cab.indexOf("CNPJ_Companhia"), iCod = cab.indexOf("Codigo_CVM");
  if (iCnpj < 0 || iCod < 0) throw new Error("FCA geral sem as colunas CNPJ_Companhia e Codigo_CVM");
  const achados = new Map(linhas.map((l) => l.split(";")).map((c) => [c[iCod], c[iCnpj]]));
  return cdCvms.map((cd) => {
    if (!achados.has(cd)) throw new Error(`CD_CVM ${cd} não aparece no FCA geral`);
    return achados.get(cd);
  });
}

// Cabeçalho + linhas das companhias pedidas num CSV do FCA (coluna CNPJ_Companhia), com CRLF no fim.
export function recortarFca(bytes, cnpjs) {
  const { cabecalho, cab, linhas } = separar(bytes);
  const iCnpj = cab.indexOf("CNPJ_Companhia");
  if (iCnpj < 0) throw new Error("CSV do FCA sem a coluna CNPJ_Companhia");
  const quero = new Set(cnpjs);
  const ficam = linhas.filter((l) => quero.has(l.split(";")[iCnpj]));
  return Buffer.from([cabecalho, ...ficam].map((l) => `${l}\r\n`).join(""), "latin1");
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
