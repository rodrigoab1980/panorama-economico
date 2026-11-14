// HTML do calendário anual da temporada (#77). Lógica pura: recebe a saída de montarCalendario
// (calendario.mjs) e devolve texto. Tudo é HTML estático, sem JS.
//
// Cada mês é uma tabela, com a semana começando no domingo. O dia com balanço é um <details>: o
// <summary> mostra o dia e as marcas, com a quantidade de empresas, e traz os tickers no title (para
// o mouse); aberto (toque ou clique), mostra os tickers com link para a ficha. Os <details> têm o
// mesmo `name`, então abrir um dia fecha o outro.
//
// As marcas se distinguem pelo desenho, não pela cor: cheia (entrega feita), vazada (data provável) e
// contorno tracejado (prazo legal), com o texto para leitor de tela em cada uma. Os links são
// relativos a /fundamentos/temporada/: a ficha fica em "../<ticker>/".
import { escapar as e } from "./html.mjs";
import { data as dataBr } from "./formatar.mjs";
import { DIAS_DA_SEMANA } from "./calendario.mjs";

// As três marcas, na ordem em que aparecem no dia e na legenda.
export const MARCAS = [
  { tipo: "entregues", classe: "entregue", legenda: "entrega feita", leitor: "com entrega feita", titulo: "Entrega feita" },
  { tipo: "provaveis", classe: "provavel", legenda: "data provável (estimativa)", leitor: "com data provável", titulo: "Data provável, estimada" },
  { tipo: "prazos", classe: "prazo", legenda: "prazo legal", leitor: "com prazo legal", titulo: "Prazo legal" },
];
export const NOTA_DO_CALENDARIO = "O número em cada marca é a quantidade de empresas no dia. Passe o mouse ou toque no dia para ver os tickers. "
  + "A data provável é uma estimativa deste site, pela entrega do mesmo documento no ano anterior; a entrega feita e o prazo legal são fatos.";

const pasta = (ticker) => String(ticker).toLowerCase().replace(/[^a-z0-9]/g, "");
const maiuscula = (texto) => texto.replace(/^./, (c) => c.toUpperCase());
const tickerHtml = (ticker, comPagina) => (!comPagina || comPagina.has(ticker) ? `<a href="../${e(pasta(ticker))}/">${e(ticker)}</a>` : e(ticker));

// O texto do title de um dia: "05/11/2026. Entrega feita (2): AAAA3, BBBB3. Prazo legal (1): CCCC3."
export function textoDoDia(dia) {
  const partes = MARCAS.filter((m) => dia[m.tipo].length).map((m) => `${m.titulo} (${dia[m.tipo].length}): ${dia[m.tipo].map((x) => x.ticker).join(", ")}.`);
  return `${dataBr(dia.data)}${dia.hoje ? ", hoje" : ""}. ${partes.join(" ")}`.trim();
}

function diaHtml(dia, comPagina) {
  if (!dia) return `<td class="fora"></td>`;
  const hoje = dia.hoje ? ` aria-current="date"` : "";
  const numero = `<span class="dia-n">${dia.dia}</span>${dia.hoje ? `<span class="so-leitor"> (hoje)</span>` : ""}`;
  const comEvento = MARCAS.some((m) => dia[m.tipo].length);
  if (!comEvento) return `<td${dia.hoje ? ` class="hoje"` : ""}${hoje}>${numero}</td>`;
  const marcas = MARCAS.filter((m) => dia[m.tipo].length)
    .map((m) => `<b class="marca ${m.classe}">${dia[m.tipo].length}<span class="so-leitor"> ${m.leitor}</span></b>`).join("");
  // No painel, os tickers de cada marca, agrupados pelo documento.
  const grupos = MARCAS.filter((m) => dia[m.tipo].length).map((m) => {
    const porDocumento = new Map();
    for (const x of dia[m.tipo]) {
      if (!porDocumento.has(x.documento)) porDocumento.set(x.documento, []);
      porDocumento.get(x.documento).push(x.ticker);
    }
    const linhas = [...porDocumento.entries()].map(([documento, tickers]) => `${e(documento)}: ${tickers.map((t) => tickerHtml(t, comPagina)).join(", ")}`).join("; ");
    return `<p><strong>${e(m.titulo)} (${dia[m.tipo].length}).</strong> ${linhas}.</p>`;
  }).join("");
  return `<td class="com-evento${dia.hoje ? " hoje" : ""}"${hoje}><details name="dia-do-calendario">`
    + `<summary title="${e(textoDoDia(dia))}">${numero}<span class="marcas">${marcas}</span></summary>`
    + `<div class="dia-painel"><p class="dia-data">${e(dataBr(dia.data))}${dia.hoje ? ", hoje" : ""}</p>${grupos}</div>`
    + `</details></td>`;
}

function mesHtml(mes, ano, comPagina) {
  const cabeca = DIAS_DA_SEMANA.map((d) => `<th scope="col"><abbr title="${e(d.nome)}">${e(d.curto)}</abbr></th>`).join("");
  const linhas = mes.semanas.map((semana) => `<tr>${semana.map((dia) => diaHtml(dia, comPagina)).join("")}</tr>`).join("");
  return `<table class="mes"><caption>${e(maiuscula(mes.nome))}<span class="so-leitor"> de ${ano}</span></caption><thead><tr>${cabeca}</tr></thead><tbody>${linhas}</tbody></table>`;
}

// O calendário inteiro, para o topo de /fundamentos/temporada/.
//   calendario  a saída de montarCalendario, ou null (sem dados: sai vazio)
//   comPagina   Set com os tickers que têm página; sem ele, todo ticker ganha link
export function calendarioHtml(calendario, { comPagina = null } = {}) {
  if (!calendario) return "";
  const legenda = MARCAS.map((m) => `<li><span class="marca ${m.classe}" aria-hidden="true"></span>${e(m.legenda)}</li>`).join("")
    + `<li><span class="marca-hoje" aria-hidden="true">${Number(String(calendario.hoje).slice(8, 10))}</span>hoje</li>`;
  return `<section class="calendario" aria-labelledby="t-calendario">
<h3 id="t-calendario">Calendário de ${calendario.ano}</h3>
<ul class="calendario-legenda">${legenda}</ul>
<p class="temporada-nota">${e(NOTA_DO_CALENDARIO)} <a href="#t-proximas">Ir para as próximas entregas</a>.</p>
<div class="calendario-meses">
${calendario.meses.map((mes) => mesHtml(mes, calendario.ano, comPagina)).join("\n")}
</div>
</section>`;
}
