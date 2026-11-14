// CSV de cada bloco da ficha (#38). Lógica pura.
//
// Feito para abrir certo no Excel brasileiro: separador ";", vírgula decimal, UTF-8 com BOM e CRLF.
// Os valores vão sem abreviação: R$ mil inteiros, razões em fração (0,1234 = 12,34%), ações em
// unidades e valores por ação em R$. A coluna "Unidade" diz qual é. Sem valor, a célula fica vazia.

export const BOM = "﻿";
export const SEPARADOR = ";";
const QUEBRA = "\r\n";

// Um campo de texto: entre aspas quando tem separador, aspas ou quebra de linha. Texto que começa
// com =, +, - ou @ ganha um apóstrofo na frente, para o Excel não tratar como fórmula.
export function campo(texto) {
  let t = String(texto ?? "");
  if (/^[=+\-@]/.test(t)) t = `'${t}`;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

// Um número com vírgula decimal e sem separador de milhar. Inteiro sai inteiro; fração, com até 6 casas.
export function numeroCsv(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toFixed(6))).replace(".", ",");
}

// Monta o CSV.
//   colunas  rótulos das colunas de período, na ordem da tabela: ["12 meses até 30/09/2026", "2025", ...]
//   linhas   [{ nome, unidade, valores: [número | null, ...] }], um valor por coluna
export function montarCsv({ colunas, linhas }) {
  const cabecalho = ["Indicador", "Unidade", ...colunas].map(campo).join(SEPARADOR);
  const corpo = linhas.map((l) => {
    if (l.valores.length !== colunas.length) throw new Error(`CSV: "${l.nome}" tem ${l.valores.length} valores para ${colunas.length} colunas`);
    return [campo(l.nome), campo(l.unidade), ...l.valores.map(numeroCsv)].join(SEPARADOR);
  });
  return BOM + [cabecalho, ...corpo].join(QUEBRA) + QUEBRA;
}

// Unidade de cada formato da página, como vai escrita no CSV.
export const UNIDADE_NO_CSV = {
  moeda: "R$ mil",
  pct: "fração (0,10 = 10%)",
  vezes: "vezes",
  porAcao: "R$ por ação",
  acoes: "ações (unidades)",
};
