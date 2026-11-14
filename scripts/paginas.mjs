// Páginas do site e funções puras do build: menu comum, inserção no HTML e leitura de links.
// Sem disco: quem lê site/ e grava dist/ é scripts/build.mjs.
//
// O site é servido num subcaminho (/panorama-economico/ no GitHub Pages), então todo link
// interno é relativo: nada pode começar com "/".

// Só entram páginas que já existem. Overview e Treinamentos (v3) são acrescentados aqui
// quando tiverem conteúdo; um item para página inexistente quebraria o teste de links.
export const PAGINAS = [
  { id: "diario", titulo: "Diário", subtitulo: "visão de trade", pasta: "" },
  { id: "fundamentos", titulo: "Fundamentalista", subtitulo: "empresas do Ibovespa", pasta: "fundamentos/" },
  { id: "rankings", titulo: "Rankings", subtitulo: "por indicador", pasta: "fundamentos/rankings/" },
];

export const MARCADOR = "<!-- menu -->";
const FIM = "<!-- /menu -->";

// Arquivo de origem/destino da página, relativo a site/ e dist/.
export const arquivoDaPagina = (pagina) => `${pagina.pasta}index.html`;

// Quantas pastas abaixo da raiz a página está ("" → 0, "fundamentos/" → 1).
export const profundidade = (pagina) => pagina.pasta.split("/").filter(Boolean).length;

// Caminho relativo de uma página até a raiz do site.
export const paraRaiz = (prof) => (prof > 0 ? "../".repeat(prof) : "./");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Link de uma página para outra, a partir de `prof` pastas abaixo da raiz.
export function hrefPara(pagina, prof) {
  const raiz = paraRaiz(prof);
  if (!pagina.pasta) return raiz;
  return raiz === "./" ? pagina.pasta : `${raiz}${pagina.pasta}`;
}

// HTML do menu para a página `ativa` (id), vista de `prof` pastas abaixo da raiz.
// Duas formas, escolhidas só por CSS (site/menu.css), sem JS: lista em linha no desktop e
// <details>/<summary> no celular. A que não serve fica com display:none (some também para leitores de tela).
export function menuHtml(paginas, ativa, prof) {
  const atual = paginas.find((p) => p.id === ativa);
  if (!atual) throw new Error(`página ativa desconhecida: ${ativa}`);
  const itens = paginas.map((p) => {
    const marca = p.id === ativa ? ' aria-current="page"' : "";
    return `<li><a href="${esc(hrefPara(p, prof))}"${marca} title="${esc(p.subtitulo)}">${esc(p.titulo)}</a></li>`;
  }).join("");
  const css = prof > 0 ? `${paraRaiz(prof)}menu.css` : "menu.css";
  return `<link rel="stylesheet" href="${css}">`
    + `<nav class="menu-site" aria-label="Seções do site">`
    + `<ul class="menu-site-lista">${itens}</ul>`
    + `<details class="menu-site-gaveta"><summary>${esc(atual.titulo)}</summary><ul>${itens}</ul></details>`
    + `</nav>`;
}

// Troca o marcador pelo bloco do menu. O bloco começa no marcador e termina em <!-- /menu -->,
// então removerMenu() devolve o HTML original byte a byte.
export function inserirMenu(html, menu) {
  const partes = html.split(MARCADOR);
  if (partes.length !== 2) throw new Error(`o HTML precisa ter exatamente um ${MARCADOR} (achei ${partes.length - 1})`);
  return `${partes[0]}${MARCADOR}${menu}${FIM}${partes[1]}`;
}

export function removerMenu(html) {
  const ini = html.indexOf(MARCADOR), fim = html.indexOf(FIM);
  if (ini < 0 || fim < ini) throw new Error("bloco do menu não encontrado");
  return html.slice(0, ini + MARCADOR.length) + html.slice(fim + FIM.length);
}

// Valores de href/src do HTML que apontam para dentro do site (sem esquema, sem "#", sem "data:").
// Caminhos absolutos ("/x", "//x") voltam também: o teste os reprova.
export function linksInternos(html) {
  const links = [];
  for (const m of html.matchAll(/(?<![\w-])(?:href|src)\s*=\s*["']([^"']*)["']/gi)) {
    const v = m[1].trim();
    if (!v || v.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(v)) continue;
    links.push(v);
  }
  return links;
}
