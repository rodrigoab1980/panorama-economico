// Monta dist/ a partir de site/: copia tudo (inclusive site/data/, gerado pelo update.mjs), troca o
// marcador <!-- menu --> pelo menu comum em cada página de PAGINAS e, a partir dos fatos da branch
// `dados`, gera a página Fundamentalista: a lista em dist/fundamentos/, uma página por companhia em
// dist/fundamentos/<ticker>/ (com os CSVs de cada bloco), os JSON em dist/fundamentos/dados/, o painel
// da temporada, no topo da lista e em dist/fundamentos/dados/painel.json, e os rankings por indicador,
// em dist/fundamentos/rankings/ e em dist/fundamentos/dados/rankings.json.
// Só casca (disco); a lógica está em scripts/paginas.mjs, scripts/cvm/ficha.mjs e scripts/fundamentos/.
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
import { csvsDaFicha, fichaHtml, inserirLista, listaHtml, pastaDaFicha } from "./fundamentos/pagina.mjs";
import { configAtencao } from "./fundamentos/atencao.mjs";
import { montarPainel } from "./fundamentos/painel.mjs";
import { inserirPainel, painelHtml } from "./fundamentos/painel-html.mjs";
import { montarRankings } from "./fundamentos/rankings.mjs";
import { inserirRankings, rankingsHtml } from "./fundamentos/rankings-html.mjs";

const ARQUIVO_DO_PAINEL = "painel.json";
const ARQUIVO_DOS_RANKINGS = "rankings.json";

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
  if (!nomes) { console.log("fichas: sem a pasta de fundamentos; o site sai sem elas"); return null; }
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
    // Limites dos pontos de atenção: os padrões, ou as variáveis ATENCAO_* do Actions.
    limitesAtencao: configAtencao(process.env),
  });
  const saida = join(destino, PASTA_DAS_FICHAS);
  await mkdir(saida, { recursive: true });
  for (const [ticker, ficha] of Object.entries(fichas)) await writeFile(join(saida, `${ticker}.json`), JSON.stringify(ficha));
  await writeFile(join(saida, INDICE_DAS_FICHAS), JSON.stringify(indice, null, 1));
  for (const c of indice.companhias.filter((x) => !x.ficha)) console.warn(`aviso: fichas: ${c.ticker} sem ficha: ${c.motivo}`);
  console.log(`fichas: ${Object.keys(fichas).length} de ${indice.companhias.length} companhias em ${Date.now() - inicio} ms`);
  return { fichas, indice };
}

// Página de cada companhia e os CSVs dos blocos. Uma ficha que dá erro não derruba as outras:
// ela sai da lista como "sem ficha", com o motivo.
async function gerarPaginas({ fichas, indice }) {
  const inicio = Date.now();
  const hoje = diaBR(new Date());
  const pagina = PAGINAS.find((p) => p.id === "fundamentos");
  const menu = menuHtml(PAGINAS, pagina.id, profundidade(pagina) + 1);
  let prontas = 0;
  for (const [ticker, ficha] of Object.entries(fichas)) {
    const item = indice.companhias.find((c) => c.ticker === ticker);
    try {
      const html = inserirMenu(fichaHtml(ficha, { hoje, coletadoEm: indice.coletadoEm }), menu);
      const csvs = csvsDaFicha(ficha);
      const pasta = join(destino, pagina.pasta, pastaDaFicha(ticker));
      await mkdir(pasta, { recursive: true });
      await writeFile(join(pasta, "index.html"), html);
      for (const [nome, texto] of Object.entries(csvs)) await writeFile(join(pasta, nome), texto);
      prontas++;
    } catch (e) {
      console.warn(`aviso: página de ${ticker} não gerada: ${e.message}`);
      if (item) { item.ficha = false; item.motivo = `erro ao gerar a página: ${e.message}`; }
    }
  }
  console.log(`páginas das companhias: ${prontas} em ${Date.now() - inicio} ms`);
}

// O painel da temporada, a partir das fichas. Um erro aqui não derruba a lista: a página sai sem o painel.
async function gerarPainel(indice, fichas) {
  if (!fichas || !indice) return "";
  try {
    const painel = montarPainel(fichas, { total: indice.companhias.length });
    if (!painel) return "";
    await writeFile(join(destino, PASTA_DAS_FICHAS, ARQUIVO_DO_PAINEL), JSON.stringify(painel, null, 1));
    console.log(`painel: temporada do ${painel.referencia.nome}, ${painel.entregaram} de ${painel.total} entregaram, ${painel.comparadas} com a comparação`);
    return painelHtml(painel, { comPagina: new Set(indice.companhias.filter((c) => c.ficha).map((c) => c.ticker)) });
  } catch (e) {
    console.warn(`aviso: painel não gerado: ${e.message}`);
    return "";
  }
}

// O painel e a lista entram em fundamentos/index.html mesmo sem dados (o painel sai vazio, e a lista,
// com o aviso de que os dados ainda não foram coletados).
async function gerarLista(indice, fichas) {
  const arquivo = join(destino, arquivoDaPagina(PAGINAS.find((p) => p.id === "fundamentos")));
  const comPainel = inserirPainel(await readFile(arquivo, "utf8"), await gerarPainel(indice, fichas));
  await writeFile(arquivo, inserirLista(comPainel, listaHtml(indice, { fichas })));
}

// Os rankings por indicador, a partir das fichas. Um erro aqui não derruba o resto do site: a página
// sai com o aviso, e as fichas e a lista continuam. Sem dados, a página diz que a coleta ainda não rodou.
async function gerarRankings(indice, fichas) {
  const arquivo = join(destino, arquivoDaPagina(PAGINAS.find((p) => p.id === "rankings")));
  let corpo;
  try {
    const rankings = fichas && indice ? montarRankings(fichas) : null;
    if (rankings) {
      await writeFile(join(destino, PASTA_DAS_FICHAS, ARQUIVO_DOS_RANKINGS), JSON.stringify(rankings, null, 1));
      console.log(`rankings: ${rankings.criterios.length} critérios, ${rankings.empresas} companhias, exercício de referência ${rankings.rotuloDoExercicio ?? "indefinido"}`);
    }
    corpo = rankingsHtml(rankings, { fichas, comPagina: indice ? new Set(indice.companhias.filter((c) => c.ficha).map((c) => c.ticker)) : null });
  } catch (e) {
    console.warn(`aviso: rankings não gerados: ${e.message}`);
    corpo = `<h2>Rankings por indicador</h2>\n<p class="sem-dados">Os rankings não puderam ser gerados nesta atualização. As fichas das empresas continuam disponíveis.</p>`;
  }
  await writeFile(arquivo, inserirRankings(await readFile(arquivo, "utf8"), corpo));
}

let resultado = null;
try { resultado = await gerarFichas(); } catch (e) { console.warn(`aviso: fichas não geradas: ${e.message}`); }
try { if (resultado) await gerarPaginas(resultado); } catch (e) { console.warn(`aviso: páginas das companhias não geradas: ${e.message}`); }
await gerarLista(resultado?.indice ?? null, resultado?.fichas ?? null);
await gerarRankings(resultado?.indice ?? null, resultado?.fichas ?? null);

console.log(`build pronto em ${destino}`);
