// Gera as fixtures de test/fixtures/cvm/ a partir de CSVs da CVM já extraídos.
// Sem rede e sem ZIP: só lê a pasta indicada e grava os recortes, byte a byte.
//
// Uso: node scripts/cvm/gerar-fixtures.mjs <pasta-dos-csv> [CD_CVM ...] [--saida <pasta>]
// Sem CD_CVM, gera todas as fixtures de FIXTURES (scripts/cvm/fixtures.mjs).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES, arquivosDoDocumento, cnpjDoCodigo, recortarCsv } from "./fixtures.mjs";

const args = process.argv.slice(2);
const iSaida = args.indexOf("--saida");
const saida = iSaida >= 0 ? args.splice(iSaida, 2)[1] : fileURLToPath(new URL("../../test/fixtures/cvm/", import.meta.url));
const [pasta, ...codigos] = args;

if (!pasta) {
  console.error("Uso: node scripts/cvm/gerar-fixtures.mjs <pasta-dos-csv> [CD_CVM ...] [--saida <pasta>]");
  process.exit(1);
}

const ler = (nome) => {
  const caminho = join(pasta, nome);
  if (!existsSync(caminho)) throw new Error(`falta ${nome} em ${pasta} (extraia do ZIP do ano)`);
  return readFileSync(caminho);
};

for (const cd of codigos.length ? codigos : Object.keys(FIXTURES)) {
  const fx = FIXTURES[cd];
  if (!fx) throw new Error(`CD_CVM ${cd} não está em FIXTURES (scripts/cvm/fixtures.mjs). Conhecidos: ${Object.keys(FIXTURES).join(", ")}`);
  const destino = join(saida, fx.pasta);
  mkdirSync(destino, { recursive: true });
  for (const { doc, ano, dtRefer } of fx.documentos) {
    const indice = `${doc}_cia_aberta_${ano}.csv`;
    const cnpj = cnpjDoCodigo(ler(indice), cd);
    if (!cnpj) throw new Error(`CD_CVM ${cd} não aparece em ${indice}`);
    for (const nome of arquivosDoDocumento(doc, ano)) {
      const recorte = recortarCsv(ler(nome), cnpj, dtRefer);
      writeFileSync(join(destino, nome), recorte);
      console.log(`${fx.pasta}/${nome}: ${recorte.toString("latin1").split("\r\n").length - 2} linhas`);
    }
  }
}
