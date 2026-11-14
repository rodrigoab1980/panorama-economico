// Monta dist/ a partir de site/: copia tudo (inclusive site/data/, gerado pelo update.mjs), troca o
// marcador <!-- menu --> pelo menu comum em cada página de PAGINAS e gera as fichas das companhias
// (dist/fundamentos/dados/) a partir dos fatos da branch `dados`.
// Só casca (disco); a lógica está em scripts/paginas.mjs e em scripts/cvm/ficha.mjs.
//
// Uso: node scripts/build.mjs [origem] [destino]   (padrão: site dist)
// DADOS_DIR aponta para a branch `dados` (padrão: dados/). Sem a pasta dados/fundamentos/, o build
// segue sem fichas e não falha.
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGINAS, arquivoDaPagina, inserirMenu, menuHtml, profundidade } from "./paginas.mjs";
import { INDICE_DAS_FICHAS, PASTA_DAS_FICHAS, montarFichas } from "./cvm/ficha.mjs";
import { ARQUIVO_INDICE, PASTA_FUNDAMENTOS } from "./cvm/coleta.mjs";
import { ARQUIVO_COTACOES } from "./precos/fonte.mjs";
import { diaBR } from "./logica.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origem = resolve(RAIZ, process.argv[2] ?? "site");
const destino = resolve(RAIZ, process.argv[3] ?? "dist");
const dados = resolve(process.env.DADOS_DIR || join(RAIZ, "dados"));

if (destino === origem || destino === RAIZ) throw new Error(`destino inválido: ${destino}`);

await rm(destino, { recursive: true, force: true });
await mkdir(destino, { recursive: true });
await cp(origem, destino, { recursive: true });

for (const pagina of PAGINAS) {
  const arquivo = arquivoDaPagina(pagina);
  const html = await readFile(join(origem, arquivo), "utf8");
  const pronto = inserirMenu(html, menuHtml(PAGINAS, pagina.id, profundidade(pagina)));
  await mkdir(dirname(join(destino, arquivo)), { recursive: true });
  await writeFile(join(destino, arquivo), pronto);
  console.log(`${arquivo}: menu inserido`);
}

// Fichas das companhias. Nada aqui derruba o build: sem os dados, o site sai sem as fichas.
const lerJson = async (caminho) => { try { return JSON.parse(await readFile(caminho, "utf8")); } catch { return null; } };
async function gerarFichas() {
  const pasta = join(dados, PASTA_FUNDAMENTOS);
  const nomes = await readdir(pasta).catch(() => null);
  if (!nomes) { console.log("fichas: sem a pasta de fundamentos; o site sai sem elas"); return; }
  const inicio = Date.now();
  const { mapeadas } = JSON.parse(await readFile(join(RAIZ, "scripts", "cvm", "universo.json"), "utf8"));
  const { excecoes } = JSON.parse(await readFile(join(RAIZ, "scripts", "cvm", "excecoes-dfc.json"), "utf8"));
  const arquivos = {};
  for (const nome of nomes) {
    if (!nome.endsWith(".json") || nome === ARQUIVO_INDICE) continue;
    const arquivo = await lerJson(join(pasta, nome));
    if (arquivo?.cdCvm) arquivos[arquivo.cdCvm] = arquivo;
    else console.warn(`aviso: fichas: ${nome} ilegível, ignorado`);
  }
  const { fichas, indice } = montarFichas({
    companhias: mapeadas.filter((c) => !c.foraDaPagina),
    arquivos,
    indiceDaColeta: await lerJson(join(pasta, ARQUIVO_INDICE)),
    cotacoes: await lerJson(join(dados, ARQUIVO_COTACOES)),
    hoje: diaBR(new Date()),
    excecoesDfc: excecoes,
  });
  const saida = join(destino, PASTA_DAS_FICHAS);
  await mkdir(saida, { recursive: true });
  for (const [ticker, ficha] of Object.entries(fichas)) await writeFile(join(saida, `${ticker}.json`), JSON.stringify(ficha));
  await writeFile(join(saida, INDICE_DAS_FICHAS), JSON.stringify(indice, null, 1));
  for (const c of indice.companhias.filter((x) => !x.ficha)) console.warn(`aviso: fichas: ${c.ticker} sem ficha: ${c.motivo}`);
  console.log(`fichas: ${Object.keys(fichas).length} de ${indice.companhias.length} companhias em ${Date.now() - inicio} ms`);
}
try { await gerarFichas(); } catch (e) { console.warn(`aviso: fichas não geradas: ${e.message}`); }

console.log(`build pronto em ${destino}`);
