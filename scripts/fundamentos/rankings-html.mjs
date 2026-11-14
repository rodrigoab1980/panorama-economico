// HTML da página de rankings por indicador (#67). Lógica pura: recebe a saída de montarRankings
// (rankings.mjs) e devolve texto. Tudo é HTML estático, sem JS.
//
// Palavras neutras: "Maiores", "Menores" e "posição". Nenhuma cor de favorável ou desfavorável: as
// duas listas usam a mesma tinta. Os links são relativos a /fundamentos/rankings/: a ficha fica em
// "../<ticker>/".
import { escapar as e } from "./html.mjs";
import { LEGENDA_DA_REGUA, TITULO_DA_REGUA, reguaHtml } from "./regua.mjs";

export const LEGENDA_DOS_RANKINGS = "Ordenação simples de cada indicador, calculado dos documentos entregues à CVM. Estar no topo ou no fim de uma lista não diz se a empresa é um bom investimento.";
export const NOTA_DOS_MULTIPLOS = "Os indicadores que dependem do preço da ação ficam fora desta página, de propósito: ordenar empresas pelo preço se lê como recomendação, e aqui só há ordenação de números das demonstrações.";

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const pasta = (ticker) => String(ticker).toLowerCase().replace(/[^a-z0-9]/g, "");
const numeroHtml = (texto) => (texto.startsWith("−") ? `<span class="menos">−</span>${e(texto.slice(1))}` : e(texto));

function tickerHtml(ticker, comPagina) {
  return !comPagina || comPagina.has(ticker) ? `<a href="../${e(pasta(ticker))}/">${e(ticker)}</a>` : e(ticker);
}

// Uma linha da lista: posição, ticker, nome curto, régua em miniatura e valor.
function linhaHtml(item, { fichas, comPagina }) {
  const regua = fichas?.[item.ticker] ? reguaHtml(fichas[item.ticker], { miniatura: true }) : "";
  const dentro = `<span class="posicao n">${item.posicao}º</span><strong>${e(item.ticker)}</strong><span class="nome">${e(item.nome)}</span>${regua}`
    + `<span class="valor n">${numeroHtml(item.texto)}${item.detalhe ? `<small>${e(item.detalhe)}</small>` : ""}</span>`;
  return !comPagina || comPagina.has(item.ticker)
    ? `<li><a href="../${e(pasta(item.ticker))}/">${dentro}</a></li>`
    : `<li><span class="sem-link">${dentro}</span></li>`;
}

// Uma ponta do critério: a lista numerada, ou a linha única do empate em massa.
function pontaHtml(titulo, ponta, opcoes) {
  let corpo;
  if (ponta.tipo === "massa") {
    const frase = ponta.frase ? `${ponta.frase} (${ponta.texto})` : `empatadas em ${ponta.texto}`;
    corpo = `<p class="ranking-massa"><strong>${plural(ponta.quantidade, "empresa", "empresas")}</strong> ${e(frase)}: `
      + `${ponta.itens.map((d) => tickerHtml(d.ticker, opcoes.comPagina)).join(", ")}.</p>`;
  } else if (ponta.itens.length === 0) {
    corpo = `<p class="ranking-vazio">Nenhuma empresa nesta lista.</p>`;
  } else {
    const corte = ponta.noCorte ? `<p class="ranking-corte">${plural(ponta.noCorte, "outra empresa tem", "outras empresas têm")} o mesmo valor da última posição desta lista.</p>` : "";
    corpo = `<ol>${ponta.itens.map((item) => linhaHtml(item, opcoes)).join("")}</ol>${corte}`;
  }
  return `<div class="ranking"><h4>${titulo}</h4>${corpo}</div>`;
}

// Quem ficou fora do critério, agrupado pelo motivo.
function foraHtml(fora, comPagina) {
  if (fora.length === 0) return `<p class="criterio-fora">Sem dado neste critério: nenhuma empresa.</p>`;
  const porMotivo = new Map();
  for (const f of fora) {
    if (!porMotivo.has(f.motivo)) porMotivo.set(f.motivo, []);
    porMotivo.get(f.motivo).push(f.ticker);
  }
  const itens = [...porMotivo.entries()].sort(([, a], [, b]) => b.length - a.length)
    .map(([motivo, tickers]) => `<li>${e(motivo.replace(/^./, (c) => c.toUpperCase()))}: ${tickers.map((t) => tickerHtml(t, comPagina)).join(", ")}.</li>`).join("");
  return `<details class="criterio-fora"><summary>Sem dado neste critério: ${plural(fora.length, "empresa", "empresas")}</summary><ul>${itens}</ul></details>`;
}

function criterioHtml(c, grupo, opcoes) {
  return `<section class="criterio" id="${e(c.id)}" aria-labelledby="t-${e(c.id)}">
<p class="criterio-grupo">${e(grupo.titulo)}</p>
<h3 id="t-${e(c.id)}">${e(c.titulo)}</h3>
<p class="criterio-regra">${e(c.regra)}</p>
<p class="criterio-periodo">Período: ${e(c.periodo)}. ${plural(c.empresas, "empresa", "empresas")} no ranking.</p>
<div class="criterio-listas">
${pontaHtml("Maiores", c.maiores, opcoes)}
${pontaHtml("Menores", c.menores, opcoes)}
</div>
${foraHtml(c.fora, opcoes.comPagina)}
</section>`;
}

// O índice dos critérios, agrupado, com âncoras.
function indiceHtml(r) {
  const grupos = r.grupos.map((g) => {
    const links = r.criterios.filter((c) => c.grupo === g.id).map((c) => `<a href="#${e(c.id)}">${e(c.titulo)}</a>`).join("");
    return `<li><span>${e(g.titulo)}</span>${links}</li>`;
  }).join("");
  return `<nav class="rankings-indice" aria-label="Critérios dos rankings"><ul>${grupos}</ul></nav>`;
}

// A página inteira, para dentro de /fundamentos/rankings/index.html.
//   rankings   a saída de montarRankings, ou null (sem dados)
//   fichas     { TICKER: ficha }, para a régua de anos em miniatura de cada linha
//   comPagina  Set com os tickers que têm página; sem ele, todo ticker ganha link
export function rankingsHtml(rankings, { fichas = null, comPagina = null } = {}) {
  const topo = `<h2>Rankings por indicador</h2>\n<p class="rankings-legenda">${e(LEGENDA_DOS_RANKINGS)}</p>`;
  if (!rankings) {
    return `${topo}\n<p class="sem-dados">Os dados das companhias ainda não foram coletados. A coleta roda aos domingos.</p>`;
  }
  const r = rankings;
  const referencia = r.exercicio
    ? `Exercício de referência: <strong>${e(r.rotuloDoExercicio)}</strong>, o último exercício anual que a maioria já entregou (${r.comExercicio} de ${r.empresas}).`
      + (r.semExercicio.length ? ` Sem esse exercício: ${r.semExercicio.map((t) => tickerHtml(t, comPagina)).join(", ")}.` : "")
    : "Sem exercício de referência: nenhum exercício anual foi entregue pela maioria das empresas.";
  const opcoes = { fichas, comPagina };
  const grupoDe = (c) => r.grupos.find((g) => g.id === c.grupo) ?? { titulo: "" };
  return `${topo}
<p class="rankings-base">${plural(r.empresas, "empresa", "empresas")}. ${referencia} Os 12 meses mais recentes não entram, porque as datas variam de empresa para empresa. Cada lista tem até ${r.tamanho} empresas; empate recebe a mesma posição.</p>
<div class="lista-legenda"><p>${TITULO_DA_REGUA}, ao lado de cada empresa:</p>${LEGENDA_DA_REGUA}</div>
${indiceHtml(r)}
${r.criterios.map((c) => criterioHtml(c, grupoDe(c), opcoes)).join("\n")}
<p class="rankings-fora-de-proposito">${e(NOTA_DOS_MULTIPLOS)}</p>`;
}

// Marcador de /fundamentos/rankings/index.html que o build troca pelos rankings.
export const MARCADOR_DOS_RANKINGS = "<!-- rankings -->";
export function inserirRankings(html, rankings) {
  const partes = html.split(MARCADOR_DOS_RANKINGS);
  if (partes.length !== 2) throw new Error(`o HTML precisa ter exatamente um ${MARCADOR_DOS_RANKINGS} (achei ${partes.length - 1})`);
  return `${partes[0]}${rankings}${partes[1]}`;
}
