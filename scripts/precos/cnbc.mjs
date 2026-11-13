// Adaptador da CNBC: o único arquivo do projeto que conhece o serviço de cotações da CNBC.
// Serve o Diário (cotarCNBC e indexarCNBC, que vieram da v1) e implementa o contrato de preço das ações
// do universo (cotar), descrito em fonte.mjs. Trocar a fonte de preço dos múltiplos é escrever outro
// arquivo com `cotar` e `FONTE` e apontar o fonte.mjs para ele.
//
// A CNBC é um endpoint não oficial, com atraso de até 15 minutos. Veja "Fonte de preço" no README.
import { numero } from "../logica.mjs";

export const FONTE = "CNBC (atraso de até 15 min)";
export const TAMANHO_DO_LOTE = 40;
export const TIMEOUT_MS = 20000;
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36" };

// Sufixo das ações da B3 na consulta. O mapa do Ibovespa do Diário usa "-BR"; aqui vai ".SA", porque
// com "-BR" a CNBC não devolve três tickers do universo (ABEV3, TEND3 e IGTI3, conferido em 13/11/2026)
// e com ".SA" devolve todos, com o mesmo preço. A resposta vem com o símbolo que a CNBC preferir
// ("WEGE3-BR" ou "ABEV3.SA"); tickerDoSimbolo aceita os dois.
export const SUFIXO_B3 = ".SA";
const SUFIXOS_B3 = /(-BR|\.SA)$/;
export const simboloDoTicker = (ticker) => `${ticker}${SUFIXO_B3}`;
export const tickerDoSimbolo = (simbolo) => String(simbolo ?? "").replace(SUFIXOS_B3, "");

// Endereço da consulta de uma lista de símbolos.
export const urlCNBC = (simbolos) => `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(simbolos.join("|"))}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;

// Indexa a resposta da CNBC por símbolo.
export const indexarCNBC = (j) => Object.fromEntries((j?.FormattedQuoteResult?.FormattedQuote || []).map((q) => [q.symbol, q]));

// Busca um endereço e devolve o JSON, com timeout. É a única função deste arquivo que usa a rede;
// cotarCNBC e cotar aceitam outra no lugar (`buscar`), para os testes.
async function buscarJson(url) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`${r.status} em ${url}`);
  return r.json();
}

// Cotações de uma lista de símbolos da CNBC, em lotes de 40, indexadas pelo símbolo da resposta.
// Qualquer lote que falhe derruba a chamada (é o comportamento do mapa do Diário desde a v1).
export async function cotarCNBC(simbolos, { buscar = buscarJson } = {}) {
  const porSimbolo = {};
  for (let i = 0; i < simbolos.length; i += TAMANHO_DO_LOTE) {
    const lote = simbolos.slice(i, i + TAMANHO_DO_LOTE);
    Object.assign(porSimbolo, indexarCNBC(await buscar(urlCNBC(lote))));
  }
  return porSimbolo;
}

// Uma cotação da CNBC no formato do contrato: { preco, dataHora }, ou null quando não serve.
// Só serve ação cotada em reais, com preço positivo e com a data do último negócio. A CNBC manda data
// e hora ("2026-11-13T18:05:49.000-0300") quando o negócio é do dia e só a data ("2026-11-12") quando
// o papel não negociou no dia (USIM6 em 13/11/2026); as duas formas passam como vieram.
export function cotacaoDoContrato(q) {
  const preco = numero(q?.last);
  const dataHora = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}\S*)?$/.test(String(q?.last_time ?? "")) ? String(q.last_time) : null;
  if (preco == null || preco <= 0 || dataHora == null) return null;
  if (q.currencyCode && q.currencyCode !== "BRL") return null;
  return { preco, dataHora };
}

// Converte a resposta indexada no formato do contrato, só para os tickers pedidos.
export function cotacoesDoContrato(porSimbolo, tickers) {
  const pedidos = new Set(tickers);
  const cotacoes = {};
  for (const [simbolo, q] of Object.entries(porSimbolo ?? {})) {
    const ticker = tickerDoSimbolo(simbolo);
    const cotacao = pedidos.has(ticker) ? cotacaoDoContrato(q) : null;
    if (cotacao) cotacoes[ticker] = cotacao;
  }
  return Object.fromEntries(Object.entries(cotacoes).sort(([a], [b]) => (a < b ? -1 : 1)));
}

// Contrato de fonte.mjs: cotar(tickers) → { [ticker]: { preco, dataHora } }.
//   - `dataHora` é a do último negócio que a CNBC informa, não a hora da coleta.
//   - Ticker que a CNBC não conhece, ou que veio sem preço, fica ausente (nunca zero).
//   - Um lote que falhe não derruba os outros: os tickers dele ficam ausentes. Se todos os lotes
//     falharem, lança o erro do último.
export async function cotar(tickers, { buscar = buscarJson } = {}) {
  const lista = [...new Set(tickers ?? [])];
  const porSimbolo = {};
  let lotes = 0;
  let falhas = 0;
  let ultimoErro = null;
  for (let i = 0; i < lista.length; i += TAMANHO_DO_LOTE) {
    lotes++;
    try {
      Object.assign(porSimbolo, await cotarCNBC(lista.slice(i, i + TAMANHO_DO_LOTE).map(simboloDoTicker), { buscar }));
    } catch (e) {
      falhas++;
      ultimoErro = e;
    }
  }
  if (lotes > 0 && falhas === lotes) throw new Error(`CNBC: todos os ${lotes} lotes falharam (${ultimoErro.message})`);
  return cotacoesDoContrato(porSimbolo, lista);
}
