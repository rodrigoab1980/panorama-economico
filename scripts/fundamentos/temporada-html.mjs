// HTML da temporada de balanços (#68): a página /fundamentos/temporada/ e o card da ficha.
// Lógica pura: recebe a saída de montarTemporada e de temporadaDaCompanhia (temporada.mjs) e devolve
// texto. Tudo é HTML estático, sem JS.
//
// A data nunca aparece sozinha: é sempre "data provável", com a origem ao lado, e o prazo legal junto.
// Palavras neutras: nada de "atrasada". Os links da página são relativos a /fundamentos/temporada/:
// a ficha fica em "../<ticker>/".
import { escapar as e } from "./html.mjs";
import { data } from "./formatar.mjs";
import { PRAZO_DFP_MESES, PRAZO_ITR_DIAS } from "./temporada.mjs";

export const LEGENDA_DA_TEMPORADA = "A data provável é uma estimativa deste site, não uma data oficial: é o dia em que a empresa entregou o mesmo documento no ano anterior. A empresa pode divulgar antes ou depois.";
export const REGRA_DA_TEMPORADA = `Prazo legal: o ITR sai em até ${PRAZO_ITR_DIAS} dias do fim do trimestre, e a DFP, em até ${PRAZO_DFP_MESES} meses do fim do exercício. `
  + "Sem o documento do ano anterior, a data provável é o próprio prazo legal. Sábado e domingo passam para a segunda-feira; feriado não entra na conta.";

const pasta = (ticker) => String(ticker).toLowerCase().replace(/[^a-z0-9]/g, "");
const artigo = (tipo) => (tipo === "dfp" ? "a" : "o");
const linkSeguro = (link) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(link ?? "")) ? link : null);
const diaMes = (iso) => data(iso).slice(0, 5);
const maiuscula = (texto) => texto.replace(/^./, (c) => c.toUpperCase());

function tickerHtml(ticker, comPagina) {
  return !comPagina || comPagina.has(ticker) ? `<a href="../${e(pasta(ticker))}/">${e(ticker)}</a>` : e(ticker);
}

// "último entregue: ITR de 30/09/2026, em 21/10/2026", com o link do documento quando a CVM informa.
function ultimoHtml(ultimo, { comLink = true } = {}) {
  if (!ultimo) return "";
  const link = comLink ? linkSeguro(ultimo.link) : null;
  const rotulo = link ? `<a href="${e(link)}" rel="noopener external" title="${e(ultimo.rotulo)}, na CVM">${e(ultimo.rotulo)}</a>` : e(ultimo.rotulo);
  const quando = ultimo.entregueEm ? `, em ${e(data(ultimo.entregueEm))}`
    : ultimo.reapresentadoEm ? `, reapresentado em ${e(data(ultimo.reapresentadoEm))}` : "";
  return `${rotulo}${quando}`;
}

// ---------- card da ficha ----------

// O card da ficha: o próximo documento, a data provável com a origem, o prazo legal e o último entregue.
//   item  a saída de temporadaDaCompanhia; sem próximo documento, o card não sai
export function cardDaTemporadaHtml(item) {
  const p = item?.proximo;
  if (!p) return "";
  const observacoes = (item.observacoes ?? []).map((o) => `<small class="proximo-obs">${e(maiuscula(o))}.</small>`).join("");
  const motivo = p.origem.tipo === "prazo-legal" ? `: ${e(p.origem.motivo)}` : "";
  return `<aside class="proximo-balanco" aria-label="Próximo balanço">`
    + `<p><span class="proximo-rotulo">Próximo balanço</span> <strong>${e(p.rotulo)}</strong>, `
    + `data provável <strong class="n">${e(data(p.dataProvavel))}</strong> `
    + `<span class="proximo-origem">(${e(p.origem.texto)}${motivo}; prazo legal ${e(data(p.prazoLegal))})</span></p>`
    + `<p class="proximo-situacao">${e(maiuscula(p.situacao.texto))}. Último entregue: ${ultimoHtml(item.ultimo)}. `
    + `<a href="../temporada/">Temporada de balanços</a></p>`
    + observacoes
    + `</aside>`;
}

// ---------- página ----------

function topoHtml(t) {
  const { referencia: ref } = t;
  const fracao = t.total > 0 ? Math.min(1, t.entregaram / t.total) : 0;
  const dados = t.dadosAte ? `<p class="painel-carimbo">dados da CVM de ${e(data(t.dadosAte))}, atualizados uma vez por semana; entregas depois dessa data ainda não aparecem</p>` : "";
  return `<section class="temporada" aria-labelledby="t-temporada">
<div class="temporada-topo"><h2 id="t-temporada">Temporada do ${e(ref.nome)}</h2>${dados}</div>
<div class="progresso">
<p><strong class="n">${t.entregaram} de ${t.total}</strong> já entregaram ${artigo(ref.tipo)} ${e(ref.documento)}</p>
<div class="progresso-trilho" aria-hidden="true"><span style="width:${(fracao * 100).toFixed(1)}%"></span></div>
</div>
<p class="temporada-legenda">${e(LEGENDA_DA_TEMPORADA)}</p>
</section>`;
}

// Uma companhia que ainda não entregou: ticker, nome, data provável, origem, prazo legal e situação.
function linhaQueFalta(i, comPagina) {
  const p = i.proximo;
  if (!p) return `<li class="entrega"><strong class="entrega-ticker">${tickerHtml(i.ticker, comPagina)}</strong><span class="entrega-nome">${e(i.nomeCurto)}</span><span class="entrega-origem">${e(maiuscula((i.observacoes ?? []).join("; ") || "sem documento coletado"))}.</span></li>`;
  const motivo = p.origem.tipo === "prazo-legal" ? `: ${e(p.origem.motivo)}` : "";
  const observacoes = (i.observacoes ?? []).map((o) => ` ${e(maiuscula(o))}.`).join("");
  return `<li class="entrega ${e(p.situacao.id)}">`
    + `<strong class="entrega-ticker">${tickerHtml(i.ticker, comPagina)}</strong><span class="entrega-nome">${e(i.nomeCurto)}</span>`
    + `<span class="entrega-data"><small>${e(p.rotulo)}, data provável</small> <b class="n">${e(data(p.dataProvavel))}</b></span>`
    + `<span class="entrega-situacao">${e(maiuscula(p.situacao.texto))}</span>`
    + `<span class="entrega-origem">${e(maiuscula(p.origem.texto))}${motivo}. Prazo legal: <span class="n">${e(data(p.prazoLegal))}</span>.${observacoes}</span>`
    + `</li>`;
}

function faltamHtml(t, comPagina) {
  const porTicker = new Map(t.faltam.map((i) => [i.ticker, i]));
  const semProximo = t.faltam.filter((i) => !i.proximo);
  const semanas = t.semanas.map((s) => `<section class="semana"><h4>Semana de ${e(diaMes(s.segunda))} <small>${s.tickers.length}</small></h4>`
    + `<ul class="entregas">${s.tickers.map((tk) => linhaQueFalta(porTicker.get(tk), comPagina)).join("")}</ul></section>`).join("\n");
  const resto = semProximo.length ? `<ul class="entregas">${semProximo.map((i) => linhaQueFalta(i, comPagina)).join("")}</ul>` : "";
  const semFicha = t.semFicha.length
    ? `<p class="temporada-nota">Sem ficha, e por isso sem data: ${t.semFicha.map((c) => `${e(c.ticker)}${c.motivo ? ` (${e(c.motivo)})` : ""}`).join("; ")}.</p>` : "";
  const total = t.faltam.length + t.semFicha.length;
  const corpo = total === 0 ? `<p class="painel-vazio">Todas as empresas já entregaram ${artigo(t.referencia.tipo)} ${e(t.referencia.documento)}.</p>` : `${semanas}${resto}${semFicha}`;
  return `<section class="temporada-bloco" aria-labelledby="t-proximas">
<h3 id="t-proximas">Próximas entregas <small>${total}</small></h3>
<p class="temporada-nota">Quem ainda não entregou ${artigo(t.referencia.tipo)} ${e(t.referencia.documento)}, pela data provável, agrupado pela semana dela. ${e(REGRA_DA_TEMPORADA)}</p>
${corpo}
</section>`;
}

// Uma companhia que já entregou: ticker, nome, a data de entrega com o link do documento e o próximo.
function linhaEntregue(i, comPagina) {
  const u = i.ultimo;
  const link = linkSeguro(u.link);
  const documento = link ? `<a href="${e(link)}" rel="noopener external">${e(u.rotulo)} na CVM</a>` : e(u.rotulo);
  const quando = u.entregueEm ? `<small>entregue em</small> <b class="n">${e(data(u.entregueEm))}</b>`
    : u.reapresentadoEm ? `<small>reapresentado em</small> <b class="n">${e(data(u.reapresentadoEm))}</b>` : `<small>data de entrega não informada</small>`;
  const reapresentado = u.entregueEm && u.reapresentadoEm && u.reapresentadoEm !== u.entregueEm ? ` Reapresentado em ${e(data(u.reapresentadoEm))} (versão ${e(u.versao)}).` : "";
  const p = i.proximo;
  const proximo = p ? ` Próximo: ${e(p.rotulo)}, data provável <span class="n">${e(data(p.dataProvavel))}</span> (${e(p.origem.texto)}; prazo legal ${e(data(p.prazoLegal))}).` : "";
  return `<li class="entrega entregue">`
    + `<strong class="entrega-ticker">${tickerHtml(i.ticker, comPagina)}</strong><span class="entrega-nome">${e(i.nomeCurto)}</span>`
    + `<span class="entrega-data">${quando}</span>`
    + `<span class="entrega-situacao">${documento}</span>`
    + `<span class="entrega-origem">${reapresentado}${proximo}</span>`
    + `</li>`;
}

function entreguesHtml(t, comPagina) {
  const corpo = t.entregues.length ? `<ul class="entregas">${t.entregues.map((i) => linhaEntregue(i, comPagina)).join("")}</ul>`
    : `<p class="painel-vazio">Nenhuma empresa entregou ainda.</p>`;
  return `<section class="temporada-bloco" aria-labelledby="t-entregues">
<h3 id="t-entregues">Já entregaram <small>${t.entregues.length}</small></h3>
<p class="temporada-nota">Da entrega mais recente para a mais antiga. A data é a da primeira entrega do documento à CVM; o link leva à versão mais nova.</p>
${corpo}
</section>`;
}

// A página inteira, para dentro de /fundamentos/temporada/index.html.
//   temporada  a saída de montarTemporada, ou null (sem dados)
//   comPagina  Set com os tickers que têm página; sem ele, todo ticker ganha link
export function temporadaHtml(temporada, { comPagina = null } = {}) {
  if (!temporada) {
    return `<h2>Temporada de balanços</h2>\n<p class="temporada-legenda">${e(LEGENDA_DA_TEMPORADA)}</p>\n<p class="sem-dados">Os dados das companhias ainda não foram coletados. A coleta roda aos domingos.</p>`;
  }
  return `${topoHtml(temporada)}
${faltamHtml(temporada, comPagina)}
${entreguesHtml(temporada, comPagina)}`;
}

// Marcador de /fundamentos/temporada/index.html que o build troca pela temporada.
export const MARCADOR_DA_TEMPORADA = "<!-- temporada -->";
export function inserirTemporada(html, temporada) {
  const partes = html.split(MARCADOR_DA_TEMPORADA);
  if (partes.length !== 2) throw new Error(`o HTML precisa ter exatamente um ${MARCADOR_DA_TEMPORADA} (achei ${partes.length - 1})`);
  return `${partes[0]}${temporada}${partes[1]}`;
}
