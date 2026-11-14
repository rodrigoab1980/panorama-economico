// Ficha de uma companhia para o site (#37): dos fatos gravados pela coleta semanal saem a série anual,
// a base de 12 meses, os indicadores e os múltiplos. Lógica pura: sem disco, sem rede e sem relógio.
// Quem lê `dados/fundamentos/` e grava `dist/fundamentos/dados/` é o build (scripts/build.mjs).
//
// É aqui que o fundamento semanal encontra o preço diário: o build roda a cada 15 minutos, então uma
// fórmula nova ou um preço novo aparecem no site sem precisar coletar a CVM de novo.
import { fatosDaCompanhia, documentoMaisRecente } from "./coleta.mjs";
import { montarSeries } from "./series.mjs";
import { calcularIndicadoresDaSerie } from "./indicadores.mjs";
import { calcularMultiplos, fundamentosParaMultiplos } from "./multiplos.mjs";

export const PASTA_DAS_FICHAS = "fundamentos/dados";
export const INDICE_DAS_FICHAS = "indice.json";

// O ticker que dá nome ao arquivo da ficha: o que está no Ibovespa; sem ele, o primeiro da lista.
export const tickerPrincipal = (companhia) => (companhia.tickers.find((t) => t.ibovespa) ?? companhia.tickers[0]).ticker;

// Monta a ficha de uma companhia.
//   companhia    entrada do universo: { cnpj, cdCvm, nome, setor, tickers: [{ ticker, ibovespa }] }
//   arquivo      o arquivo dela gravado pela coleta (fundamentos/<cdCvm>.json)
//   cotacoes     o arquivo de preços ({ coletadoEm, fonte, precos }) ou null
//   hoje         "AAAA-MM-DD" do dia do build
//   excecoesDfc  exceções do classificador da DFC
// Devolve { ticker, tickers, cnpj, cdCvm, nome, setor, documentoMaisRecente, anual, doze, multiplos, avisos }:
//   anual      [{ inicio, fim, tipo, indicadores }], um item por exercício, do mais antigo ao mais novo
//   doze       { fim, tipo, motivo, indicadores }
//   multiplos  a saída de calcularMultiplos
// Só vão os indicadores calculados, não as contas dos demonstrativos: a ficha fica pequena.
export function montarFicha({ companhia, arquivo, cotacoes = null, hoje, excecoesDfc = [] }) {
  const series = montarSeries(fatosDaCompanhia(arquivo));
  const calculado = calcularIndicadoresDaSerie(series, { composicoes: arquivo.composicoes ?? [], excecoesDfc });
  const multiplos = calcularMultiplos({
    fundamentos: fundamentosParaMultiplos(series.doze, calculado.doze.indicadores),
    composicao: calculado.doze.composicao,
    motivoComposicao: calculado.doze.motivoComposicao,
    tickers: companhia.tickers,
    cotacoes, hoje,
  });
  const acoes = (c) => (c ? { dtRefer: c.dtRefer, acoesCirculacao: c.acoesCirculacao, escala: c.escala, escalaPor: c.escalaPor } : null);
  return {
    ticker: tickerPrincipal(companhia),
    tickers: companhia.tickers.map((t) => t.ticker),
    cnpj: companhia.cnpj, cdCvm: companhia.cdCvm, nome: companhia.nome, setor: companhia.setor ?? null,
    documentoMaisRecente: documentoMaisRecente(arquivo),
    anual: calculado.anual.map((p) => ({ inicio: p.inicio, fim: p.fim, tipo: p.tipo, composicao: acoes(p.composicao), indicadores: p.indicadores })),
    doze: {
      fim: calculado.doze.fim, tipo: calculado.doze.tipo, motivo: series.doze?.motivo ?? null,
      composicao: acoes(calculado.doze.composicao), indicadores: calculado.doze.indicadores,
    },
    multiplos,
    avisos: [...(arquivo.avisos ?? []), ...calculado.avisos],
  };
}

// Monta todas as fichas e o índice do site.
//   companhias   as do universo que entram na página
//   arquivos     { cdCvm: arquivo da coleta } (quem não tem arquivo fica sem ficha, com o motivo no índice)
//   indiceDaColeta  fundamentos/indice.json da coleta, ou null
// Devolve { fichas: { TICKER: ficha }, indice }. Uma companhia que dá erro ao montar não derruba as
// outras: fica sem ficha, e o índice diz o erro.
export function montarFichas({ companhias, arquivos, indiceDaColeta = null, cotacoes = null, hoje, excecoesDfc = [] }) {
  const fichas = {};
  const lista = [];
  for (const companhia of companhias) {
    const ticker = tickerPrincipal(companhia);
    const base = { ticker, nome: companhia.nome, setor: companhia.setor ?? null, cdCvm: companhia.cdCvm };
    const daColeta = indiceDaColeta?.companhias?.[companhia.cdCvm] ?? null;
    const arquivo = arquivos[companhia.cdCvm];
    if (!arquivo) {
      lista.push({ ...base, ficha: false, motivo: daColeta?.motivo ?? "sem dados coletados", documentoMaisRecente: null });
      continue;
    }
    try {
      const ficha = montarFicha({ companhia, arquivo, cotacoes, hoje, excecoesDfc });
      fichas[ticker] = ficha;
      lista.push({
        ...base, ficha: true, motivo: null, documentoMaisRecente: ficha.documentoMaisRecente,
        exercicios: ficha.anual.length, primeiroExercicio: ficha.anual[0]?.fim ?? null, ultimoExercicio: ficha.anual.at(-1)?.fim ?? null,
        dozeMeses: ficha.doze.fim, coleta: daColeta ? { status: daColeta.status, motivo: daColeta.motivo } : null,
      });
    } catch (e) {
      lista.push({ ...base, ficha: false, motivo: `erro ao montar a ficha: ${e.message}`, documentoMaisRecente: documentoMaisRecente(arquivo) });
    }
  }
  return {
    fichas,
    indice: {
      montadoEm: hoje,
      coletadoEm: indiceDaColeta?.coletadoEm ?? null,
      cotacoes: cotacoes ? { coletadoEm: cotacoes.coletadoEm ?? null, fonte: cotacoes.fonte ?? null } : null,
      companhias: lista.sort((a, b) => (a.ticker < b.ticker ? -1 : 1)),
    },
  };
}
