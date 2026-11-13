// Monta dist/ a partir de site/: copia tudo (inclusive site/data/, gerado pelo update.mjs) e,
// em cada página de PAGINAS, troca o marcador <!-- menu --> pelo menu comum.
// Só casca (disco); a lógica está em scripts/paginas.mjs.
//
// Uso: node scripts/build.mjs [origem] [destino]   (padrão: site dist)
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGINAS, arquivoDaPagina, inserirMenu, menuHtml, profundidade } from "./paginas.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origem = resolve(RAIZ, process.argv[2] ?? "site");
const destino = resolve(RAIZ, process.argv[3] ?? "dist");

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
console.log(`build pronto em ${destino}`);
