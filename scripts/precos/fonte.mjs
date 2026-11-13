// Fonte de preço das ações do universo, para os múltiplos da página Fundamentalista (#51).
//
// CONTRATO. Uma fonte de preço é um módulo que exporta:
//   FONTE                    texto que diz de onde vem o preço e com que atraso (vai para o arquivo e para a página)
//   cotar(tickers)           → Promise<{ [ticker]: { preco, dataHora } }>
//     preco      preço do último negócio, em R$, número maior que zero
//     dataHora   data e hora desse negócio, em ISO 8601 ("2026-11-13T18:05:49.000-0300"), ou só a
//                data ("2026-11-12") quando a fonte não informa a hora; é a do negócio, não a da coleta
//     Ticker sem cotação fica AUSENTE do resultado. Nunca vem zero nem null no lugar do preço.
//     Falha total (nada foi obtido) lança erro; falha parcial devolve só o que veio.
//
// A fonte em uso é a linha de exportação abaixo. Trocar de fonte é escrever outro módulo com esse
// contrato e mudar essa linha. O resto do código (a coleta, os múltiplos e o build) só conhece o
// contrato e o arquivo gravado, nunca a fonte.
//
// Fora essa linha, este arquivo é lógica pura: sem disco, sem rede e sem relógio.
import { diaBR, horaBR } from "../logica.mjs";

export { cotar, FONTE } from "./cnbc.mjs";

// Arquivo gravado na branch `dados`:
//   { coletadoEm, fonte, precos: { TICKER: { preco, dataHora } } }
// `coletadoEm` é a hora da última coleta que trouxe alguma cotação. Cada preço carrega a data e a hora
// do seu último negócio; a regra de "desatualizado" dos múltiplos olha para ela, não para `coletadoEm`.
export const ARQUIVO_COTACOES = "cotacoes-fundamentos.json";

// A partir desta hora de Brasília o pregão e o after-market já acabaram, e o último preço do dia é o
// de fechamento. É a mesma hora em que o Diário grava o fechamento do dia.
export const HORA_DA_COLETA = 19;

// Finais de ticker que a coleta procura para cada raiz de quatro letras: ON, PN, PNA, PNB e unit.
export const FINAIS_DE_CLASSE = ["3", "4", "5", "6", "11"];

// Tickers a cotar para a lista de companhias do universo ([{ tickers: [{ ticker }] }]): os que estão
// no universo e, para cada raiz, os finais de FINAIS_DE_CLASSE. A Klabin está no universo só pela unit
// (KLBN11), mas o valor de mercado dela sai de KLBN3 e KLBN4. Em ordem alfabética, sem repetir.
export function tickersParaCotar(companhias) {
  const todos = new Set();
  for (const c of companhias ?? []) {
    for (const t of c.tickers ?? []) {
      todos.add(t.ticker);
      for (const final of FINAIS_DE_CLASSE) todos.add(String(t.ticker).slice(0, 4) + final);
    }
  }
  return [...todos].sort();
}

// A cotação segue o contrato?
export const cotacaoValida = (c) => c != null && typeof c.preco === "number" && Number.isFinite(c.preco) && c.preco > 0
  && typeof c.dataHora === "string" && !Number.isNaN(Date.parse(c.dataHora));

// Já é hora de coletar? Uma coleta por dia, depois do fechamento, e uma na primeira vez, a qualquer hora.
//   anterior  o arquivo já gravado (ou null)
//   agora     Date
export function precisaColetar(anterior, agora) {
  if (anterior?.coletadoEm == null || anterior.precos == null) return true;
  const coleta = new Date(anterior.coletadoEm);
  if (Number.isNaN(coleta.getTime())) return true;
  if (horaBR(agora) < HORA_DA_COLETA) return false;
  return !(diaBR(coleta) === diaBR(agora) && horaBR(coleta) >= HORA_DA_COLETA);
}

// Junta as cotações novas ao arquivo anterior e devolve o arquivo a gravar, ou null quando não há o
// que gravar (falha total: fica valendo o arquivo anterior, intocado).
//   - Cotação nova fora do contrato é descartada.
//   - Ticker que não veio desta vez (falha parcial) continua com o último preço conhecido e com a
//     `dataHora` dele; a regra de "desatualizado" marca o que precisar.
//   - Uma cotação nova nunca substitui uma mais recente do mesmo ticker.
//   anterior  arquivo já gravado, ou null
//   novas     saída de cotar()
//   agora     Date da coleta; fonte: texto FONTE
export function juntarCotacoes(anterior, novas, { agora, fonte }) {
  const validas = Object.entries(novas ?? {}).filter(([, c]) => cotacaoValida(c));
  if (validas.length === 0) return null;
  const precos = {};
  for (const [ticker, c] of Object.entries(anterior?.precos ?? {})) if (cotacaoValida(c)) precos[ticker] = { preco: c.preco, dataHora: c.dataHora };
  for (const [ticker, c] of validas) {
    const atual = precos[ticker];
    if (!atual || Date.parse(c.dataHora) >= Date.parse(atual.dataHora)) precos[ticker] = { preco: c.preco, dataHora: c.dataHora };
  }
  return {
    coletadoEm: agora.toISOString(),
    fonte,
    precos: Object.fromEntries(Object.entries(precos).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

// Resumo da coleta para o log: quantos vieram, quais ficaram com o preço anterior e quais nunca tiveram.
//   obrigatorios  tickers do universo (os que precisam ter preço)
export function resumoDaColeta(arquivo, novas, obrigatorios) {
  const vieram = Object.keys(novas ?? {}).filter((t) => cotacaoValida(novas[t]));
  return {
    novos: vieram.length,
    total: Object.keys(arquivo?.precos ?? {}).length,
    mantidos: Object.keys(arquivo?.precos ?? {}).filter((t) => !vieram.includes(t)),
    semPreco: (obrigatorios ?? []).filter((t) => arquivo?.precos?.[t] == null),
  };
}
