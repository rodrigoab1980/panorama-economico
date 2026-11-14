// HTML da página Fundamentalista (#38): a lista das companhias e a ficha de cada uma.
// Lógica pura: recebe a ficha (o JSON de scripts/cvm/ficha.mjs) e devolve texto. Sem disco, sem rede
// e sem relógio. Quem grava os arquivos é o build.
//
// A ficha responde "esta empresa é boa e sempre foi?": a série anual é o centro, e os 12 meses e os
// múltiplos são a coluna de hoje. As tabelas saem prontas no HTML, e a página funciona sem JS.
// Todo texto que vem de dado passa por escapar(). Todos os links internos são relativos, porque o
// site fica num subcaminho. Aqui só há dados e regras à vista: nenhuma classificação do resultado.
import { INDICADORES } from "../cvm/indicadores.mjs";
import { MULTIPLOS } from "../cvm/multiplos.mjs";
import { SEM_VALOR, data, dataHora, formatar, instanteBR, preco, sinal } from "./formatar.mjs";
import { carimbo } from "./carimbo.mjs";
import { UNIDADE_NO_CSV, montarCsv } from "./csv.mjs";
import { escapar } from "./html.mjs";
import { resumoHtml } from "./resumo.mjs";
import { LEGENDA_DA_REGUA, TITULO_DA_REGUA, reguaHtml } from "./regua.mjs";

export { escapar };

export const AVISO_LEGAL = "Dados para estudo, extraídos dos documentos entregues à CVM. Não é recomendação de investimento.";

// Os quatro blocos da ficha, na ordem da página, e os indicadores de cada um.
export const BLOCOS = [
  {
    id: "resultado", titulo: "Resultado",
    indicadores: ["receita", "lucroBruto", "margemBruta", "ebit", "da", "ebitda", "margemEbitda", "resultadoFinanceiro", "lucroLiquido", "margemLiquida", "roe", "roa", "roic"],
  },
  {
    id: "caixa-e-divida", titulo: "Caixa e dívida",
    indicadores: [
      "patrimonioLiquido", "caixa", "dividaBruta", "arrendamentos", "dividaBrutaComArrendamentos", "dividaLiquida", "dividaLiquidaComArrendamentos",
      "dividaBrutaSobrePl", "dividaLiquidaSobreEbitda", "dividaCurtoPrazo", "despesasFinanceiras", "coberturaJuros", "liquidezCorrente", "liquidezImediata",
    ],
  },
  {
    id: "fluxo-de-caixa", titulo: "Fluxo de caixa",
    indicadores: ["fco", "fci", "fcf", "capex", "fcl", "fclAposArrendamentos", "fcoSobreEbitda", "capexSobreFco", "jurosPagos", "coberturaJurosPagos", "custoDividaJurosPagos", "proventosPagos"],
  },
  {
    id: "valuation", titulo: "Valuation",
    // Valores por ação: não dependem de preço, então têm série anual. Os múltiplos vêm à parte, só com a coluna de hoje.
    indicadores: ["acoesCirculacao", "diluicao", "lucroPorAcao", "valorPatrimonialPorAcao", "fcoPorAcao", "fclPorAcao"],
  },
];

// Como cada indicador é escrito. As razões viram percentual ou "vezes", conforme o que medem.
const EM_VEZES = ["dividaBrutaSobrePl", "dividaLiquidaSobreEbitda", "coberturaJuros", "liquidezCorrente", "liquidezImediata", "coberturaJurosPagos"];
export function formatoDoIndicador(id) {
  const indicador = INDICADORES.find((i) => i.id === id);
  if (!indicador) throw new Error(`indicador desconhecido: ${id}`);
  if (indicador.unidade === "R$ mil") return "moeda";
  if (indicador.unidade === "ações") return "acoes";
  if (indicador.unidade === "R$ por ação") return "porAcao";
  return EM_VEZES.includes(id) ? "vezes" : "pct";
}
const FORMATO_DO_MULTIPLO = { valorMercado: "moeda", ev: "moeda", earningsYield: "pct", dividendYield: "pct" };
export const formatoDoMultiplo = (id) => FORMATO_DO_MULTIPLO[id] ?? "vezes";

// Indicadores que dependem do número de ações, que a CVM só informa de 2020 em diante.
const POR_ACAO = ["acoesCirculacao", "diluicao", "lucroPorAcao", "valorPatrimonialPorAcao", "fcoPorAcao", "fclPorAcao"];
export const PRIMEIRO_ANO_COM_ACOES = 2020;
export const MOTIVO_SEM_ACOES = "a CVM só informa o número de ações a partir de 2020";

// ---------- texto ----------

const e = escapar;

// Pasta da ficha: o ticker em minúsculas, só com letras e números.
export function pastaDaFicha(ticker) {
  const pasta = String(ticker ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!pasta) throw new Error(`ticker inválido para a pasta da ficha: "${ticker}"`);
  return pasta;
}

// Link só entra na página se for http(s); qualquer outra coisa fica de fora.
const linkSeguro = (link) => (/^https?:\/\/[^\s"'<>]+$/i.test(String(link ?? "")) ? link : null);

// Número já formatado, com o sinal de menos num <span> próprio: a cor de negativo vai só no sinal.
const numeroHtml = (texto) => (texto.startsWith("−") ? `<span class="menos">−</span>${e(texto.slice(1))}` : e(texto));

// Forma curta, para o rodapé da tabela: "DFP 31/12/2025".
const rotuloCurto = (o) => `${o.documento === "dfp" ? "DFP" : "ITR"} ${data(o.dtRefer)}`;
const rotuloDoDocumento = (o) => `${o.documento === "dfp" ? "DFP" : "ITR"} de ${data(o.dtRefer)}${o.versao ? `, versão ${o.versao}` : ""}`;

// ---------- colunas ----------

// Rótulo de um exercício: o ano, ou mês/ano quando o exercício não termina em dezembro.
export const rotuloDoExercicio = (fim) => (String(fim).slice(5) === "12-31" ? String(fim).slice(0, 4) : `${String(fim).slice(5, 7)}/${String(fim).slice(0, 4)}`);

// As colunas da tabela, na ordem da página: os 12 meses e depois os exercícios, do mais recente ao
// mais antigo. No celular, rolar para a direita é voltar no tempo.
//   [{ chave, rotulo, detalhe, hoje, meses, fim, origem: texto, documentos: [{ rotulo, link }], indicadores }]
export function colunasDaFicha(ficha) {
  const colunas = [];
  const doze = ficha.doze;
  if (doze?.fim) {
    const parcelas = doze.origem ?? [];
    const sinais = { anual: "", acumuladoAtual: " + ", acumuladoAnterior: " − " };
    colunas.push({
      chave: "12m", rotulo: "12 meses", detalhe: `até ${data(doze.fim)}`, hoje: true, meses: 12, fim: doze.fim,
      origem: doze.motivo ? `Base de 12 meses indisponível: ${doze.motivo}`
        : parcelas.length > 1 ? `Soma de 12 meses: ${parcelas.map((p) => `${sinais[p.parcela] ?? " "}${rotuloDoDocumento(p)}`).join("")}`
          : parcelas.length === 1 ? `Exercício fechado: ${rotuloDoDocumento(parcelas[0])}` : "Base de 12 meses",
      documentos: parcelas.map((p) => ({ rotulo: rotuloDoDocumento(p), curto: rotuloCurto(p), link: linkSeguro(p.link) })),
      indicadores: doze.indicadores,
    });
  }
  for (const p of [...(ficha.anual ?? [])].reverse()) {
    const o = p.origem;
    const transicao = p.tipo === "transicao";
    colunas.push({
      chave: p.fim, rotulo: rotuloDoExercicio(p.fim), detalhe: transicao ? `${p.meses ?? "?"} meses` : null, hoje: false, meses: p.meses ?? null, fim: p.fim,
      origem: !o ? "Documento de origem não identificado"
        : `${rotuloDoDocumento(o)}${o.consolidado === false ? ", individual" : ""}${o.dtRefer !== p.fim ? ` (coluna do ano anterior${o.reapresentado ? ", com valores reapresentados" : ""})` : ""}`
          + (transicao ? `. Exercício de ${p.meses ?? "?"} meses, de ${data(p.inicio)} a ${data(p.fim)}` : ""),
      documentos: o ? [{ rotulo: rotuloDoDocumento(o), curto: rotuloCurto(o), link: linkSeguro(o.link) }] : [],
      indicadores: p.indicadores,
    });
  }
  return colunas;
}

// Valor e motivo de um indicador numa coluna. O motivo de quem não tem número de ações antes de 2020
// é trocado por um que diz a causa de verdade.
export function celula(coluna, id) {
  const r = coluna.indicadores?.[id] ?? { valor: null, motivo: "indicador não calculado" };
  if (r.valor == null && !coluna.hoje && POR_ACAO.includes(id) && Number(String(coluna.fim).slice(0, 4)) < PRIMEIRO_ANO_COM_ACOES
    && /composição do capital/.test(r.motivo ?? "")) {
    return { valor: null, motivo: MOTIVO_SEM_ACOES };
  }
  return { valor: r.valor ?? null, motivo: r.valor == null ? (r.motivo ?? "sem valor") : null };
}

// ---------- gráfico de tendência ----------

// SVG pequeno com a série do mais antigo para o mais recente. Ano sem valor fica como buraco na linha,
// nunca como zero. Quando a série cruza o zero, uma linha fina marca o zero.
//   valores  [número | null], do mais antigo ao mais recente
export function tendenciaSvg(valores, { largura = 84, altura = 22 } = {}) {
  const pontos = valores.map((v, i) => ({ i, v })).filter((p) => typeof p.v === "number" && Number.isFinite(p.v));
  if (pontos.length === 0) return "";
  const margem = 2.5;
  const min = Math.min(...pontos.map((p) => p.v));
  const max = Math.max(...pontos.map((p) => p.v));
  const faixa = max - min || 1;
  const n = Math.max(valores.length - 1, 1);
  const x = (i) => (margem + (i / n) * (largura - 2 * margem)).toFixed(1);
  const y = (v) => (max === min ? altura / 2 : margem + (1 - (v - min) / faixa) * (altura - 2 * margem)).toFixed(1);
  // Trechos contínuos: um ano sem valor quebra a linha.
  const trechos = [];
  let atual = [];
  valores.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) atual.push({ i, v });
    else if (atual.length) { trechos.push(atual); atual = []; }
  });
  if (atual.length) trechos.push(atual);
  const linhas = trechos.filter((t) => t.length > 1).map((t) => `<polyline points="${t.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}"/>`).join("");
  const soltos = trechos.filter((t) => t.length === 1).map(([p]) => `<circle cx="${x(p.i)}" cy="${y(p.v)}" r="1.4"/>`).join("");
  const ultimo = pontos.at(-1);
  const zero = min < 0 && max > 0 ? `<line class="zero" x1="${margem}" x2="${largura - margem}" y1="${y(0)}" y2="${y(0)}"/>` : "";
  return `<svg class="tendencia" viewBox="0 0 ${largura} ${altura}" width="${largura}" height="${altura}" aria-hidden="true" focusable="false">`
    + `${zero}${linhas}${soltos}<circle class="fim" cx="${x(ultimo.i)}" cy="${y(ultimo.v)}" r="2"/></svg>`;
}

// ---------- tabela anual ----------

// Quebras no número de ações: exercícios em que a diluição ficou vazia por variação acima de 50%.
// Devolve [{ fim, anterior, variacao }], do mais recente ao mais antigo.
export function quebrasDeAcoes(ficha) {
  const anual = ficha.anual ?? [];
  const quebras = [];
  anual.forEach((p, i) => {
    const m = /variação de ([+-]\d+)% sugere desdobramento ou grupamento/.exec(p.indicadores?.diluicao?.motivo ?? "");
    if (m && i > 0) quebras.push({ fim: p.fim, anterior: anual[i - 1].fim, variacao: m[1].replace("-", "−") });
  });
  return quebras.reverse();
}

function cabecalhoDaTabela(colunas) {
  const ths = colunas.map((c) => `<th scope="col" class="${c.hoje ? "hoje" : "ano"}${c.quebra ? " quebra" : ""}" title="${e(c.origem)}">${e(c.rotulo)}${c.detalhe ? `<small>${e(c.detalhe)}</small>` : ""}</th>`).join("");
  return `<thead><tr><th scope="col" class="fixa">Indicador</th><th scope="col" class="tend">Tendência</th>${ths}</tr></thead>`;
}

function linhaDaTabela(id, colunas) {
  const indicador = INDICADORES.find((i) => i.id === id);
  const formato = formatoDoIndicador(id);
  // O gráfico vai do exercício mais antigo ao mais recente, só com a série anual (sem os 12 meses).
  const serie = colunas.filter((c) => !c.hoje).reverse().map((c) => celula(c, id).valor);
  const tds = colunas.map((c) => {
    const { valor, motivo } = celula(c, id);
    const classes = ["n", c.hoje ? "hoje" : "", c.quebra ? "quebra" : "", valor == null ? "vazio" : sinal(valor)].filter(Boolean).join(" ");
    return `<td class="${classes}"${motivo ? ` title="${e(motivo)}"` : ""}>${numeroHtml(formatar(valor, formato))}</td>`;
  }).join("");
  return `<tr><th scope="row" class="fixa" title="${e(indicador.formula)}">${e(indicador.nome)}</th><td class="tend">${tendenciaSvg(serie)}</td>${tds}</tr>`;
}

// Linha do rodapé da tabela com o documento de origem de cada coluna (com link, quando a CVM informa).
function rodapeDaTabela(colunas) {
  const tds = colunas.map((c) => {
    const docs = c.documentos.map((d) => (d.link ? `<a href="${e(d.link)}" rel="noopener external" title="${e(d.rotulo)}, na CVM">${e(d.curto)}</a>` : `<span title="${e(d.rotulo)}">${e(d.curto)}</span>`)).join("<br>");
    return `<td class="${c.hoje ? "hoje" : ""}${c.quebra ? " quebra" : ""}">${docs || SEM_VALOR}</td>`;
  }).join("");
  return `<tfoot><tr><th scope="row" class="fixa" title="Documento entregue à CVM de onde saíram os números da coluna">Documento</th><td class="tend"></td>${tds}</tr></tfoot>`;
}

// Tabela de um bloco: uma linha por indicador, uma coluna por período.
export function tabelaAnual(bloco, colunas) {
  return `<div class="rolagem" tabindex="0" role="region" aria-label="${e(bloco.titulo)}, ano a ano">`
    + `<table class="serie">${cabecalhoDaTabela(colunas)}<tbody>${bloco.indicadores.map((id) => linhaDaTabela(id, colunas)).join("")}</tbody>${rodapeDaTabela(colunas)}</table></div>`;
}

// Tabela dos múltiplos: só a coluna de hoje.
export function tabelaDeMultiplos(ficha) {
  const m = ficha.multiplos ?? {};
  const linhas = MULTIPLOS.map((mult) => {
    const r = m.multiplos?.[mult.id] ?? { valor: null, motivo: "múltiplo não calculado" };
    const classes = ["n", "hoje", r.valor == null ? "vazio" : sinal(r.valor)].filter(Boolean).join(" ");
    return `<tr><th scope="row" class="fixa" title="${e(mult.formula)}">${e(mult.nome)}</th>`
      + `<td class="${classes}"${r.valor == null ? ` title="${e(r.motivo)}"` : ""}>${numeroHtml(formatar(r.valor, formatoDoMultiplo(mult.id)))}</td>`
      + `<td class="motivo">${r.valor == null ? e(r.motivo) : ""}</td></tr>`;
  }).join("");
  const quando = m.dataPregao ? `preço de ${data(m.dataPregao)}` : "sem preço";
  return `<div class="rolagem" tabindex="0" role="region" aria-label="Múltiplos de hoje">`
    + `<table class="serie multiplos"><thead><tr><th scope="col" class="fixa">Múltiplo</th><th scope="col" class="hoje">Hoje<small>${e(quando)}</small></th><th scope="col" class="motivo">Observação</th></tr></thead>`
    + `<tbody>${linhas}</tbody></table></div>`;
}

// ---------- CSV ----------

// Rótulo de uma coluna no CSV.
const rotuloNoCsv = (c) => (c.hoje ? `12 meses ${c.detalhe}` : `${c.rotulo}${c.detalhe ? ` (${c.detalhe})` : ""}`);

// Os CSVs da ficha: { "resultado.csv": texto, ... }, um por bloco. O de valuation traz os valores por
// ação de cada exercício e, depois, os múltiplos, que só têm a coluna dos 12 meses.
export function csvsDaFicha(ficha) {
  const colunas = colunasDaFicha(ficha);
  const rotulos = colunas.map(rotuloNoCsv);
  const csvs = {};
  for (const bloco of BLOCOS) {
    const linhas = bloco.indicadores.map((id) => {
      const formato = formatoDoIndicador(id);
      return { nome: INDICADORES.find((i) => i.id === id).nome, unidade: UNIDADE_NO_CSV[formato], valores: colunas.map((c) => celula(c, id).valor) };
    });
    if (bloco.id === "valuation") {
      for (const mult of MULTIPLOS) {
        const valor = ficha.multiplos?.multiplos?.[mult.id]?.valor ?? null;
        linhas.push({ nome: mult.nome, unidade: UNIDADE_NO_CSV[formatoDoMultiplo(mult.id)], valores: colunas.map((c) => (c.hoje ? valor : null)) });
      }
    }
    csvs[`${bloco.id}.csv`] = montarCsv({ colunas: rotulos, linhas });
  }
  return csvs;
}

// ---------- ficha ----------

// A cotação fica na linha do ticker (à direita no desktop, abaixo no celular). O preço do ticker que
// dá nome à ficha vem sem repetir o ticker; os outros tickers da companhia vêm numa lista, cada um com
// o seu. A fonte fica numa linha menor.
function cotacaoHtml(ficha) {
  const cot = ficha.cotacoes ?? { tickers: [] };
  const comPreco = new Map((cot.tickers ?? []).map((t) => [t.ticker, t]));
  const valor = (ticker) => {
    const c = comPreco.get(ticker);
    return c ? `<span class="n">${e(preco(c.preco))}</span> <time>${e(dataHora(c.dataHora))}</time>` : `<span class="vazio" title="sem cotação coletada para este ticker">${SEM_VALOR}</span>`;
  };
  const tickers = ficha.tickers ?? [];
  const principal = tickers.includes(ficha.ticker) ? `<p class="cotacao-principal"><span class="so-leitor">${e(ficha.ticker)}: </span>${valor(ficha.ticker)}</p>` : "";
  const outros = tickers.filter((t) => t !== ficha.ticker).map((t) => `<li><strong>${e(t)}</strong> ${valor(t)}</li>`).join("");
  const fonte = cot.fonte ? `<p class="fonte">Cotação: ${e(cot.fonte)}. É o preço do último negócio de cada ticker, na data e hora ao lado.</p>` : `<p class="fonte">Sem cotação coletada.</p>`;
  return `<div class="cotacao">${principal}${outros ? `<ul class="cotacoes">${outros}</ul>` : ""}${fonte}</div>`;
}

function cabecalhoDaFicha(ficha, { hoje }) {
  const mesDoExercicio = Number(String(ficha.anual?.at(-1)?.fim ?? "").slice(5, 7)) || 12;
  const selo = carimbo({ documento: ficha.documentoMaisRecente, mesDoExercicio, hoje });
  const antiga = ficha.multiplos?.desatualizado ? `<p class="carimbo">Cotação desatualizada: o preço usado nos múltiplos é de ${e(data(ficha.multiplos.dataPregao))}.</p>` : "";
  return `<header class="ficha-cabecalho">`
    + `<p class="trilha"><a href="../">Todas as empresas</a></p>`
    + `<div class="topo-da-ficha"><div class="identidade"><p class="ticker">${e(ficha.ticker)}</p><h2>${e(ficha.nome)}</h2>`
    + `<p class="setor">${e(ficha.setor ?? "Setor não informado")}</p></div>${cotacaoHtml(ficha)}</div>`
    + reguaHtml(ficha)
    + (selo.desatualizado ? `<p class="carimbo">${e(selo.texto)}</p>` : "")
    + antiga
    + `</header>`;
}

function notasDeAcoes(ficha) {
  const notas = quebrasDeAcoes(ficha).map((q) => `<li>O número de ações mudou ${e(q.variacao)}% entre ${e(rotuloDoExercicio(q.anterior))} e ${e(rotuloDoExercicio(q.fim))}; os valores por ação antes disso não são comparáveis. Os valores antigos não foram ajustados.</li>`);
  if ((ficha.anual ?? []).some((p) => Number(p.fim.slice(0, 4)) < PRIMEIRO_ANO_COM_ACOES)) {
    notas.push(`<li>Antes de ${PRIMEIRO_ANO_COM_ACOES} não há valores por ação: ${e(MOTIVO_SEM_ACOES)}.</li>`);
  }
  return notas.length ? `<ul class="notas">${notas.join("")}</ul>` : "";
}

function blocoHtml(bloco, ficha, colunas) {
  const csv = `<a class="csv" href="${e(bloco.id)}.csv" download>baixar CSV</a>`;
  if (bloco.id !== "valuation") {
    return `<section class="bloco" id="${e(bloco.id)}"><div class="bloco-topo"><h3>${e(bloco.titulo)}</h3>${csv}</div>${tabelaAnual(bloco, colunas)}</section>`;
  }
  // No valuation, a borda da quebra marca onde o número de ações mudou.
  const quebras = new Set(quebrasDeAcoes(ficha).map((q) => q.fim));
  const comQuebra = colunas.map((c) => ({ ...c, quebra: quebras.has(c.chave) }));
  return `<section class="bloco" id="valuation"><div class="bloco-topo"><h3>Valuation</h3>${csv}</div>`
    + `<p class="explica">Os múltiplos dependem do preço da ação, e esta versão do site não tem preço histórico. Por isso eles aparecem só na coluna de hoje, com o preço do último pregão coletado e os fundamentos dos 12 meses.</p>`
    + tabelaDeMultiplos(ficha)
    + `<h4>Valores por ação, ano a ano</h4>`
    + `<p class="explica">Não dependem de preço, então têm a série inteira.</p>`
    + tabelaAnual(bloco, comQuebra)
    + notasDeAcoes(ficha)
    + `</section>`;
}

// Página da ficha de uma companhia. `menu` é o marcador que o build troca pelo menu comum.
//   hoje        "AAAA-MM-DD" do dia do build, para o carimbo
//   coletadoEm  data da coleta dos fundamentos (ISO), do índice
// Os caminhos partem de /fundamentos/<ticker>/: "../" é a lista e "../../" é a raiz do site.
export function fichaHtml(ficha, { hoje, coletadoEm = null, menu = "<!-- menu -->" }) {
  const colunas = colunasDaFicha(ficha);
  const titulo = `${ficha.ticker} · ${ficha.nome}`;
  const exercicios = ficha.anual ?? [];
  const periodo = exercicios.length ? `de ${rotuloDoExercicio(exercicios[0].fim)} a ${rotuloDoExercicio(exercicios.at(-1).fim)}` : "sem série anual";
  const avisos = (ficha.avisos ?? []).length ? `<ul class="notas avisos">${ficha.avisos.map((a) => `<li>${e(a.replace(/^./, (c) => c.toUpperCase()))}.</li>`).join("")}</ul>` : "";
  const atalhos = BLOCOS.map((b) => `<a href="#${e(b.id)}">${e(b.titulo)}</a>`).join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(titulo)} · Fundamentalista · Panorama Econômico</title>
<meta name="description" content="${e(`${ficha.nome} (${(ficha.tickers ?? []).join(", ")}): resultado, caixa, dívida e fluxo de caixa ano a ano, ${periodo}, a partir dos documentos entregues à CVM.`)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,300..800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../../tokens.css">
<link rel="stylesheet" href="../fundamentos.css">
</head>
<body class="fundamentos">

<header class="cabeca">
  <a class="cabeca-marca" href="../../">Panorama Econômico</a>
  <h1 class="so-leitor">Fundamentalista: ${e(ficha.ticker)}, ${e(periodo)}</h1>
  ${menu}
</header>

<main class="ficha" data-ticker="${e(ficha.ticker)}">
${cabecalhoDaFicha(ficha, { hoje })}
<section class="resumo" id="resumo-consistencia"${ficha.consistencia || ficha.atencao || ficha.pares ? "" : " hidden"}>
${resumoHtml(ficha)}
</section>
<nav class="atalhos" aria-label="Blocos da ficha">${atalhos}</nav>
${avisos}
${BLOCOS.map((b) => blocoHtml(b, ficha, colunas)).join("\n")}
<footer class="aviso-legal">
  <p><strong>${e(AVISO_LEGAL)}</strong></p>
  <p>Fonte: CVM, Dados Abertos (DFP e ITR)${coletadoEm ? `, coleta de ${e(instanteBR(coletadoEm))}` : ""}.${ficha.cotacoes?.fonte ? ` Preço: ${e(ficha.cotacoes.fonte)}${ficha.cotacoes.coletadoEm ? `, coleta de ${e(instanteBR(ficha.cotacoes.coletadoEm))}` : ""}.` : ""} Passe o mouse ou toque no nome de um indicador para ver a fórmula, e no número vazio para ver o motivo.</p>
</footer>
</main>

<script src="../ficha.js" defer></script>
</body>
</html>
`;
}

// ---------- lista ----------

// Trecho de HTML da lista de companhias, agrupadas por setor, para dentro de /fundamentos/index.html.
//   indice  o índice das fichas (scripts/cvm/ficha.mjs): { coletadoEm, companhias: [{ ticker, nome, setor, ficha, motivo }] }
//   fichas  { TICKER: ficha }, opcional: com ele, cada empresa ganha a régua de anos em miniatura
// Sem JS a lista inteira fica visível; o campo de busca só aparece quando o JS liga (atributo hidden).
export function listaHtml(indice, { fichas = null } = {}) {
  const companhias = indice?.companhias ?? [];
  if (companhias.length === 0) {
    return `<p class="sem-dados">Os dados das companhias ainda não foram coletados. A coleta roda aos domingos.</p>`;
  }
  const porSetor = new Map();
  for (const c of companhias) {
    const setor = c.setor ?? "Outros";
    if (!porSetor.has(setor)) porSetor.set(setor, []);
    porSetor.get(setor).push(c);
  }
  const setores = [...porSetor.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([setor, lista]) => {
    const itens = lista.sort((a, b) => (a.ticker < b.ticker ? -1 : 1)).map((c) => {
      const busca = `${c.ticker} ${c.nome}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const corpo = `<strong>${e(c.ticker)}</strong> <span>${e(c.nome)}</span>`;
      const regua = c.ficha && fichas?.[c.ticker] ? reguaHtml(fichas[c.ticker], { miniatura: true }) : "";
      return c.ficha
        ? `<li data-busca="${e(busca)}"><a href="${e(pastaDaFicha(c.ticker))}/">${corpo}${regua ? ` ${regua}` : ""}</a></li>`
        : `<li data-busca="${e(busca)}" class="sem-ficha" title="${e(c.motivo ?? "sem ficha")}">${corpo} <em>sem ficha</em></li>`;
    }).join("");
    return `<section class="setor"><h3>${e(setor)} <small>${lista.length}</small></h3><ul>${itens}</ul></section>`;
  }).join("\n");
  const comFicha = companhias.filter((c) => c.ficha).length;
  // A legenda só entra quando alguma linha tem a régua.
  const legenda = setores.includes('class="regua miniatura"') ? `\n<div class="lista-legenda"><p>${TITULO_DA_REGUA}, ao lado de cada empresa:</p>${LEGENDA_DA_REGUA}</div>` : "";
  return `<div class="busca" hidden><label for="busca">Buscar por ticker ou nome</label><input id="busca" type="search" autocomplete="off" spellcheck="false" placeholder="WEGE3, Petrobras…"><p class="busca-vazia" hidden>Nenhuma empresa com esse ticker ou nome.</p></div>
<p class="contagem">${comFicha} empresas${indice.coletadoEm ? `, com dados coletados em ${e(instanteBR(indice.coletadoEm))}` : ""}.</p>${legenda}
<div class="setores">
${setores}
</div>`;
}

// Marcador de /fundamentos/index.html que o build troca pela lista.
export const MARCADOR_DA_LISTA = "<!-- companhias -->";
export function inserirLista(html, lista) {
  const partes = html.split(MARCADOR_DA_LISTA);
  if (partes.length !== 2) throw new Error(`o HTML precisa ter exatamente um ${MARCADOR_DA_LISTA} (achei ${partes.length - 1})`);
  return `${partes[0]}${lista}${partes[1]}`;
}
