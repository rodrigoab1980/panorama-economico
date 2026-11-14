// HTML do painel da página inicial dos fundamentos (#66). Lógica pura: recebe a saída de
// montarPainel (painel.mjs) e devolve texto. Tudo é HTML estático, sem JS.
//
// Palavras neutras: "maior", "menor", "altas" e "quedas". A cor de alta e de baixa só entra na
// variação percentual do lucro, sempre junto do sinal (+ ou −) e do número. Os links são relativos
// à lista (/fundamentos/): "<ticker>/".
import { escapar as e } from "./html.mjs";
import { data, moeda, percentual } from "./formatar.mjs";

export const NOTA_DO_ACUMULADO = "Acumulado do ano até a data do documento, contra o mesmo período do ano anterior, como entregue à CVM; sem ajuste de não recorrentes.";

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const pasta = (ticker) => String(ticker).toLowerCase().replace(/[^a-z0-9]/g, "");

// Variação com o sinal sempre à vista: "+12,3%" ou "−12,3%".
export const comSinal = (razao) => `${razao > 0 ? "+" : ""}${percentual(razao)}`;
// O sinal num <span> com a cor de alta ou de baixa; o número fica junto.
const variacaoHtml = (razao) => `<b class="variacao ${razao > 0 ? "alta" : razao < 0 ? "baixa" : "igual"}">${e(comSinal(razao))}</b>`;

// O ticker, com link para a ficha quando ela tem página.
function tickerHtml(ticker, comPagina) {
  return !comPagina || comPagina.has(ticker) ? `<a href="${e(pasta(ticker))}/">${e(ticker)}</a>` : e(ticker);
}
const tickersHtml = (tickers, comPagina) => tickers.map((t) => tickerHtml(t, comPagina)).join(", ");

// ---------- 1. temporada ----------

function temporadaHtml(p) {
  const { referencia: ref, numeros: n } = p;
  const fracao = p.total > 0 ? Math.min(1, p.entregaram / p.total) : 0;
  const numero = (x, texto) => `<li><strong class="n">${x.valor} <small>de ${x.total}</small></strong><span>${e(texto)}</span></li>`;
  const periodo = ref.tipo === "dfp" ? "exercício" : "acumulado";
  const fora = p.semComparacao.length
    ? ` ${plural(p.semComparacao.length, "companhia que entregou ficou", "companhias que entregaram ficaram")} fora da comparação: ${p.semComparacao.map((s) => `${s.ticker} (${s.motivo})`).join("; ")}.`
    : "";
  const carimbo = p.entregueAte ? `<p class="painel-carimbo">dados de documentos entregues até ${e(data(p.entregueAte))}</p>` : "";
  return `<section class="temporada" aria-labelledby="t-temporada">
<div class="temporada-topo"><h2 id="t-temporada">Temporada do ${e(ref.nome)}</h2>${carimbo}</div>
<div class="progresso">
<p><strong class="n">${p.entregaram} de ${p.total}</strong> já entregaram ${ref.tipo === "dfp" ? "a" : "o"} ${e(ref.documento)}</p>
<div class="progresso-trilho" aria-hidden="true"><span style="width:${(fracao * 100).toFixed(1)}%"></span></div>
</div>
<p class="temporada-base">Das ${p.entregaram} que entregaram, ${p.comparadas === p.entregaram ? "todas têm" : `${p.comparadas} têm`} a comparação com o ano anterior:</p>
<ul class="temporada-numeros">
${numero(n.lucroMaior, `lucro do ${periodo} maior que o do ano anterior`)}
${numero(n.receitaMaior, "receita maior")}
${numero(n.margemMaior, "margem líquida maior")}
${numero(n.prejuizo, `prejuízo no ${periodo}`)}
</ul>
<p class="painel-nota">${e(ref.tipo === "dfp" ? "Exercício fechado, contra o exercício anterior, como entregue à CVM; sem ajuste de não recorrentes." : NOTA_DO_ACUMULADO)}${e(fora)}</p>
</section>`;
}

// ---------- 2. maiores variações do lucro ----------

function variacoesHtml(p, comPagina) {
  const v = p.variacoes;
  const periodo = p.referencia.tipo === "dfp" ? "exercício" : "acumulado";
  const linha = (x) => {
    const conta = `Lucro do ${periodo}: ${moeda(x.atual)}, contra ${moeda(x.anterior)} no ano anterior`;
    const dentro = `<strong>${e(x.ticker)}</strong><span>${e(x.nomeCurto)}</span>${variacaoHtml(x.variacao)}`;
    return !comPagina || comPagina.has(x.ticker)
      ? `<li title="${e(conta)}"><a href="${e(pasta(x.ticker))}/">${dentro}</a></li>`
      : `<li title="${e(conta)}"><span class="sem-link">${dentro}</span></li>`;
  };
  const lista = (titulo, itens, vazio) => `<div class="variacoes-lista"><h4>${titulo}</h4>${itens.length ? `<ol>${itens.map(linha).join("")}</ol>` : `<p class="painel-vazio">${vazio}</p>`}</div>`;
  const aParte = [
    ["Passaram de prejuízo a lucro", v.viraramLucro],
    ["Passaram de lucro a prejuízo", v.viraramPrejuizo],
    ["Prejuízo nos dois períodos", v.prejuizoNosDois],
    [`Lucro anterior abaixo de ${moeda(v.limite)}, fora do percentual`, v.baseBaixa],
  ].filter(([, itens]) => itens.length).map(([rotulo, itens]) => `<li>${e(rotulo)}: ${tickersHtml(itens.map((x) => x.ticker), comPagina)}.</li>`).join("");
  return `<section class="painel-bloco variacoes" aria-labelledby="t-variacoes">
<h3 id="t-variacoes">Maiores variações do lucro no ${periodo}</h3>
<div class="variacoes-listas">
${lista("Maiores altas", v.altas, "Nenhuma companhia com alta no percentual.")}
${lista("Maiores quedas", v.quedas, "Nenhuma companhia com queda no percentual.")}
</div>
${aParte ? `<ul class="variacoes-a-parte">${aParte}</ul>` : ""}
<p class="painel-nota">Variação percentual só de quem teve lucro nos dois períodos e lucro anterior de ${e(moeda(v.limite))} ou mais: ${plural(v.elegiveis, "companhia", "companhias")} de ${p.comparadas}.</p>
</section>`;
}

// ---------- 3. lucro somado por setor ----------

// O texto da variação da soma de um setor. Só a variação entre dois lucros leva a cor.
export function variacaoDoSetorHtml(s) {
  switch (s.tipo) {
    case "lucro": return variacaoHtml(s.variacao);
    case "prejuizo-menor": return `<span class="variacao">prejuízo menor (${e(comSinal(s.variacao))})</span>`;
    case "prejuizo-maior": return `<span class="variacao">prejuízo maior (${e(comSinal(s.variacao))})</span>`;
    case "prejuizo-igual": return `<span class="variacao">prejuízo igual</span>`;
    case "virou-lucro": return `<span class="variacao">passou de prejuízo a lucro</span>`;
    case "virou-prejuizo": return `<span class="variacao">passou de lucro a prejuízo</span>`;
    default: return `<span class="variacao">sem percentual</span>`;
  }
}

function setoresHtml(p) {
  const comSoma = p.setores.filter((s) => !s.poucas);
  // As barras partem do zero. Se algum setor soma prejuízo, o zero sai da borda esquerda.
  const min = Math.min(0, ...comSoma.map((s) => s.atual));
  const max = Math.max(0, ...comSoma.map((s) => s.atual));
  const faixa = max - min || 1;
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const periodo = p.referencia.tipo === "dfp" ? "exercício" : "acumulado";
  const linha = (s) => {
    const cabeca = `<span class="setor-nome">${e(s.setor)} <small>${plural(s.empresas, "empresa", "empresas")}</small></span>`;
    if (s.poucas) return `<li class="poucas" title="${e(`Na comparação: ${s.tickers.join(", ")}`)}">${cabeca}<span class="setor-valor vazio">poucas empresas</span></li>`;
    const inicio = (Math.min(s.atual, 0) - min) / faixa;
    const largura = Math.abs(s.atual) / faixa;
    const conta = `Soma do lucro do ${periodo} de ${s.tickers.join(", ")}: ${moeda(s.atual)}, contra ${moeda(s.anterior)} no ano anterior`;
    return `<li title="${e(conta)}">${cabeca}<span class="setor-valor n">${e(moeda(s.atual))} ${variacaoDoSetorHtml(s)}</span>`
      + `<span class="setor-barra" aria-hidden="true"><i class="${s.atual < 0 ? "prejuizo" : "lucro"}" style="margin-left:${pct(inicio)};width:${pct(largura)}"></i></span></li>`;
  };
  const corpo = p.setores.length ? `<ul class="setores-soma">${p.setores.map(linha).join("")}</ul>` : `<p class="painel-vazio">Nenhuma companhia com a comparação ainda.</p>`;
  return `<section class="painel-bloco setores-painel" aria-labelledby="t-setores">
<h3 id="t-setores">Lucro somado por setor</h3>
${corpo}
<p class="painel-nota">Soma do lucro do ${periodo} das companhias com a comparação, e a variação contra a soma do ano anterior. Setor com menos de ${p.minimoPorSetor ?? 3} empresas na comparação fica sem soma.</p>
</section>`;
}

// ---------- 4. pontos de atenção ----------

function atencaoHtml(p, comPagina) {
  const linha = (r) => {
    const nao = r.naoAvaliadas ? ` ${plural(r.naoAvaliadas, "não avaliada", "não avaliadas")}.` : "";
    const cabeca = `<strong class="n">${r.acionadas}</strong> <span>${e(r.titulo)}</span>`;
    if (r.acionadas === 0) return `<li><p class="regra-sem">${cabeca}</p></li>`;
    return `<li><details><summary>${cabeca}</summary><p>${tickersHtml(r.tickers, comPagina)}.</p><small>Limite: ${e(r.limite)}.${e(nao)}</small></details></li>`;
  };
  return `<section class="painel-bloco atencao-painel" aria-labelledby="t-atencao">
<h3 id="t-atencao">Pontos de atenção nas ${p.fichas}</h3>
<p class="painel-nota">Quantas companhias acionam cada regra. Regras automáticas sobre os números entregues à CVM. Descrevem fatos, não são recomendação.</p>
<ol class="atencao-contagem">${p.atencao.map(linha).join("")}</ol>
</section>`;
}

// O painel inteiro, para dentro de /fundamentos/index.html, antes da busca e da lista.
//   painel     a saída de montarPainel, ou null (sem dados: sai vazio)
//   comPagina  Set com os tickers que têm página; sem ele, todo ticker ganha link
export function painelHtml(painel, { comPagina = null } = {}) {
  if (!painel) return "";
  return `<div class="painel">
${temporadaHtml(painel)}
<div class="painel-blocos">
${variacoesHtml(painel, comPagina)}
${setoresHtml(painel)}
${atencaoHtml(painel, comPagina)}
</div>
</div>`;
}

// Marcador de /fundamentos/index.html que o build troca pelo painel.
export const MARCADOR_DO_PAINEL = "<!-- painel -->";
export function inserirPainel(html, painel) {
  const partes = html.split(MARCADOR_DO_PAINEL);
  if (partes.length !== 2) throw new Error(`o HTML precisa ter exatamente um ${MARCADOR_DO_PAINEL} (achei ${partes.length - 1})`);
  return `${partes[0]}${painel}${partes[1]}`;
}
