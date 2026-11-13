// Imprime, em Markdown, a série anual e a base de 12 meses de uma companhia, em R$ milhões.
// Serve para conferir os números contra uma fonte externa (checkpoint da #33).
// Casca: lê os CSVs de DFP e ITR de uma pasta (já extraídos, de UMA companhia) e usa leitor.mjs e series.mjs.
//
// Uso: node scripts/cvm/tabela-series.mjs <pasta-com-os-csv> [quantos-anos]
// Ex.: node scripts/cvm/tabela-series.mjs test/fixtures/cvm/weg
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { interpretarArquivo, lerArquivos } from "./leitor.mjs";
import { montarSeries, valorDaConta } from "./series.mjs";

const [pasta, quantos = "2"] = process.argv.slice(2);
if (!pasta) {
  console.error("Uso: node scripts/cvm/tabela-series.mjs <pasta-com-os-csv> [quantos-anos]");
  process.exit(1);
}

const LINHAS = [
  ["DRE", "3.01", "Receita líquida"], ["DRE", "3.03", "Lucro bruto"], ["DRE", "3.05", "EBIT"],
  ["DRE", "3.06", "Resultado financeiro"], ["DRE", "3.11", "Lucro líquido"], ["BPP", "2.03", "Patrimônio líquido"],
  ["DFC", "6.01", "FCO"], ["DFC", "6.02", "FCI"], ["DFC", "6.03", "FCF"],
];

const arquivos = readdirSync(pasta).filter((n) => interpretarArquivo(n))
  .map((nome) => ({ nome, linhas: new TextDecoder("latin1").decode(readFileSync(join(pasta, nome))).split("\n") }));
const { cnpj, cdCvm, anual, doze } = montarSeries(lerArquivos(arquivos));

const milhoes = (v) => (v == null ? "—" : (v / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
const br = (iso) => iso.split("-").reverse().join("/");
const anos = anual.slice(-Number(quantos));

const origem = (p) => {
  const o = p.demonstrativos.DRE?.origem;
  return o ? `DFP ${br(o.dtRefer)}, ${o.ordem === "ultimo" ? "ÚLTIMO" : "PENÚLTIMO"}` : "";
};
const cab = ["Conta (R$ milhões)", ...anos.map((p) => `${p.meses} meses até ${br(p.fim)}`), doze.fim ? `12 meses até ${br(doze.fim)}` : "12 meses"];

console.log(`Companhia ${cnpj} (código CVM ${cdCvm})\n`);
console.log(`| ${cab.join(" | ")} |`);
console.log(`|---|${cab.slice(1).map(() => "---:").join("|")}|`);
for (const [demo, conta, nome] of LINHAS) {
  const doAno = anos.map((p) => milhoes(valorDaConta(p.demonstrativos[demo], conta)));
  const de12 = demo === "BPP" ? doze.estoques?.contas[conta]?.valor : doze.fluxos?.[conta]?.valor;
  console.log(`| ${nome} (${conta}) | ${doAno.join(" | ")} | ${milhoes(de12)} |`);
}

console.log(`\nOrigem dos anuais: ${anos.map((p) => `${br(p.fim)} = ${origem(p)}`).join("; ")}.`);
if (doze.tipo === "itr") {
  const { anual: a, acumuladoAtual: b, acumuladoAnterior: c } = doze.parcelas;
  console.log(`12 meses = anual (${br(a.inicio)} a ${br(a.fim)}) + acumulado (${br(b.inicio)} a ${br(b.fim)}) − acumulado (${br(c.inicio)} a ${br(c.fim)}).`);
  console.log(`O acumulado anterior vem do ITR de ${br(c.dtRefer)}, como entregue. As três parcelas são ${a.consolidado ? "consolidadas" : "individuais"}.`);
  console.log(`O patrimônio líquido da última coluna é a posição em ${br(doze.estoques.data)}.`);
} else if (doze.tipo === "ano-fechado") {
  console.log("12 meses = ano fechado: o documento mais recente é a DFP.");
} else {
  console.log(`12 meses indisponível: ${doze.motivo}`);
}
