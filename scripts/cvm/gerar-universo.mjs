// Gera scripts/cvm/universo.json a partir dos CSVs do FCA já extraídos.
// Sem rede e sem ZIP: lê a pasta indicada e os três arquivos mantidos à mão
// (tickers-ibovespa.json, excecoes-tickers.json e setores.json). A lógica está em universo.mjs.
//
// Uso: node scripts/cvm/gerar-universo.mjs <pasta-dos-csv-do-fca> [ano]
// Sem o ano, usa o fca_cia_aberta_valor_mobiliario_AAAA.csv mais recente da pasta.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cadastroDoFca, montarUniverso, resumoPorSetor, vinculosDoFca } from "./universo.mjs";

const AQUI = fileURLToPath(new URL(".", import.meta.url));
const [pasta, anoPedido] = process.argv.slice(2);
if (!pasta) {
  console.error("Uso: node scripts/cvm/gerar-universo.mjs <pasta-dos-csv-do-fca> [ano]");
  process.exit(1);
}

const anos = readdirSync(pasta).map((n) => /^fca_cia_aberta_valor_mobiliario_(\d{4})\.csv$/.exec(n)?.[1]).filter(Boolean).sort();
const ano = anoPedido ?? anos.at(-1);
if (!ano) throw new Error(`nenhum fca_cia_aberta_valor_mobiliario_AAAA.csv em ${pasta}`);

const json = (nome) => JSON.parse(readFileSync(join(AQUI, nome), "utf8"));
const linhas = (nome) => new TextDecoder("latin1").decode(readFileSync(join(pasta, nome))).split("\n");

const carteira = json("tickers-ibovespa.json");
const { setores, foraDaPagina } = json("setores.json");
const arquivoVm = `fca_cia_aberta_valor_mobiliario_${ano}.csv`;
const arquivoGeral = `fca_cia_aberta_geral_${ano}.csv`;

const { mapeadas, pendentes } = montarUniverso({
  tickers: carteira.tickers,
  vinculos: vinculosDoFca(linhas(arquivoVm), arquivoVm),
  cadastro: cadastroDoFca(linhas(arquivoGeral), arquivoGeral),
  excecoes: json("excecoes-tickers.json").excecoes,
  setores,
  foraDaPagina,
});

const saida = {
  obs: "Gerado por scripts/cvm/gerar-universo.mjs. Não edite à mão: mude tickers-ibovespa.json, excecoes-tickers.json ou setores.json e gere de novo.",
  carteira: { dataReferencia: carteira.dataReferencia, fonte: carteira.fonte, url: carteira.url, consultadoEm: carteira.consultadoEm },
  fca: [arquivoVm, arquivoGeral],
  mapeadas,
  pendentes,
};
writeFileSync(join(AQUI, "universo.json"), `${JSON.stringify(saida, null, 2)}\n`);

const naPagina = mapeadas.filter((c) => !c.foraDaPagina).length;
console.log(`${carteira.tickers.length} tickers da carteira de ${carteira.dataReferencia} → ${mapeadas.length} companhias (${naPagina} na página, ${mapeadas.length - naPagina} fora), ${pendentes.length} pendentes`);
for (const g of resumoPorSetor(mapeadas)) {
  const fora = g.fora.length ? `  | fora: ${g.fora.map((f) => `${f.ticker} (${f.motivo})`).join(" ")}` : "";
  const poucos = g.naPagina > 0 && g.naPagina < 3 ? "  ← menos de 3 na página" : "";
  console.log(`  ${String(g.naPagina).padStart(2)}  ${g.setor}${poucos}: ${g.tickers.join(" ")}${fora}`);
}
for (const p of pendentes) console.log(`  PENDENTE ${p.ticker}: ${p.motivo}`);
