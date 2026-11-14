// Páginas do site e funções puras do build: a barra de topo comum, a inserção no HTML e a leitura de links.
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
  { id: "temporada", titulo: "Temporada", subtitulo: "de balanços", pasta: "fundamentos/temporada/" },
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

export const NOME_DO_SITE = "Panorama Econômico";
// Abaixo desta largura (em px), a barra vira o botão de menu. O mesmo número está em site/menu.css
// e em site/menu.js; test/build.test.mjs confere os três.
export const LARGURA_DO_BOTAO = 640;

// A barra de topo do site, para a página `ativa` (id), vista de `prof` pastas abaixo da raiz.
// É o único lugar que gera a barra: o Diário, a Fundamentalista, os Rankings, a Temporada e as fichas
// recebem este mesmo HTML, e só mudam o item atual e o caminho relativo dos links.
//   - o nome do site à esquerda (link para a raiz) e os itens à direita, com o atual em aria-current;
//   - o botão de menu vem escondido (hidden): quem o liga é site/menu.js, que também controla o
//     aria-expanded. Sem JS, a lista fica à vista em qualquer largura.
// A barra fica no fluxo da página (nada de position), então nada se sobrepõe a ela.
export function menuHtml(paginas, ativa, prof) {
  if (!paginas.some((p) => p.id === ativa)) throw new Error(`página ativa desconhecida: ${ativa}`);
  const itens = paginas.map((p) => {
    const marca = p.id === ativa ? ' aria-current="page"' : "";
    return `<li><a href="${esc(hrefPara(p, prof))}"${marca} title="${esc(p.subtitulo)}">${esc(p.titulo)}</a></li>`;
  }).join("");
  const raiz = prof > 0 ? paraRaiz(prof) : "";
  return `<link rel="stylesheet" href="${raiz}menu.css">`
    + `<header class="barra-site">`
    + `<a class="barra-marca" href="${paraRaiz(prof)}">${esc(NOME_DO_SITE)}</a>`
    + `<button class="barra-botao" type="button" aria-expanded="false" aria-controls="barra-menu" hidden>`
    + `<span class="barra-botao-icone" aria-hidden="true"></span>Menu</button>`
    + `<nav class="barra-nav" id="barra-menu" aria-label="Seções do site"><ul>${itens}</ul></nav>`
    + `</header>`
    + `<script src="${raiz}menu.js"></script>`;
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
