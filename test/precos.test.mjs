// Fonte de preço das ações do universo (#51): o contrato (fonte.mjs) e o adaptador da CNBC (cnbc.mjs).
// Nenhum teste usa a rede: a busca é trocada por uma função que devolve respostas montadas aqui.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as fonte from "../scripts/precos/fonte.mjs";
import {
  ARQUIVO_COTACOES, FINAIS_DE_CLASSE, HORA_DA_COLETA, cotacaoValida, juntarCotacoes, precisaColetar, resumoDaColeta, tickersParaCotar,
} from "../scripts/precos/fonte.mjs";
import {
  FONTE, SUFIXO_B3, TAMANHO_DO_LOTE, TIMEOUT_MS, cotacaoDoContrato, cotacoesDoContrato, cotar, cotarCNBC, indexarCNBC,
  simboloDoTicker, tickerDoSimbolo, urlCNBC,
} from "../scripts/precos/cnbc.mjs";
import { calcularMultiplos } from "../scripts/cvm/multiplos.mjs";

// Uma cotação como a CNBC devolve (só os campos usados). A consulta vai com ".SA"; a resposta vem
// com o símbolo que a CNBC preferir: "-BR" para a maioria e ".SA" para ABEV3, TEND3 e IGTI3.
const q = (symbol, last, last_time = "2026-11-13T18:05:49.000-0300", extra = {}) => ({ symbol, code: 0, last, last_time, currencyCode: "BRL", exchange: "Sao Paulo Stock Exchange", ...extra });
const resposta = (...quotes) => ({ FormattedQuoteResult: { FormattedQuote: quotes } });
const desconhecido = (symbol) => ({ symbol, code: 1 });

describe("contrato da fonte de preço", () => {
  test("fonte.mjs exporta cotar e FONTE, e hoje eles são os do adaptador da CNBC", () => {
    assert.equal(typeof fonte.cotar, "function");
    assert.equal(fonte.cotar, cotar);
    assert.equal(fonte.FONTE, FONTE);
    assert.match(FONTE, /CNBC.*atraso de até 15 min/);
  });

  test("cotacaoValida: preço positivo e dataHora que é data", () => {
    assert.ok(cotacaoValida({ preco: 51.31, dataHora: "2026-11-13T18:05:49.000-0300" }));
    for (const ruim of [null, undefined, 51.31, {}, { preco: 0, dataHora: "2026-11-13T18:05:49.000-0300" }, { preco: -1, dataHora: "2026-11-13T18:05:49.000-0300" },
      { preco: "51.31", dataHora: "2026-11-13T18:05:49.000-0300" }, { preco: NaN, dataHora: "2026-11-13T18:05:49.000-0300" }, { preco: 51.31 }, { preco: 51.31, dataHora: "ontem" }]) {
      assert.equal(cotacaoValida(ruim), false, JSON.stringify(ruim));
    }
  });

  test("tickersParaCotar: os do universo e os finais 3, 4, 5, 6 e 11 de cada raiz, sem repetir, em ordem", () => {
    assert.deepEqual(FINAIS_DE_CLASSE, ["3", "4", "5", "6", "11"]);
    const r = tickersParaCotar([{ tickers: [{ ticker: "KLBN11" }] }, { tickers: [{ ticker: "AXIA3" }, { ticker: "AXIA7" }] }]);
    assert.deepEqual(r, ["AXIA11", "AXIA3", "AXIA4", "AXIA5", "AXIA6", "AXIA7", "KLBN11", "KLBN3", "KLBN4", "KLBN5", "KLBN6"]);
    assert.deepEqual(tickersParaCotar(null), []);
  });

  test("o universo do repositório: 74 companhias; todos os tickers dele são cotados, e a Klabin ganha KLBN3 e KLBN4", () => {
    const { mapeadas } = JSON.parse(readFileSync(new URL("../scripts/cvm/universo.json", import.meta.url), "utf8"));
    assert.equal(mapeadas.length, 74);
    const r = tickersParaCotar(mapeadas);
    for (const t of mapeadas.flatMap((c) => c.tickers.map((x) => x.ticker))) assert.ok(r.includes(t), t);
    assert.ok(r.includes("KLBN3") && r.includes("KLBN4"));
    assert.equal(new Set(r).size, r.length);
  });
});

describe("quando coletar: uma vez por dia, depois das 19h de Brasília", () => {
  const as = (iso) => new Date(iso);
  const arquivo = (coletadoEm) => ({ coletadoEm, fonte: "x", precos: {} });

  test("sem arquivo, ou com arquivo sem data ou sem preços: coleta a qualquer hora", () => {
    assert.equal(HORA_DA_COLETA, 19);
    assert.equal(precisaColetar(null, as("2026-11-13T10:00:00-03:00")), true);
    assert.equal(precisaColetar({ precos: {} }, as("2026-11-13T10:00:00-03:00")), true);
    assert.equal(precisaColetar({ coletadoEm: "2026-11-12T22:07:00Z" }, as("2026-11-13T10:00:00-03:00")), true);
    assert.equal(precisaColetar(arquivo("não é data"), as("2026-11-13T10:00:00-03:00")), true);
  });

  test("antes das 19h não coleta de novo", () => {
    assert.equal(precisaColetar(arquivo("2026-11-12T19:07:00-03:00"), as("2026-11-13T18:52:00-03:00")), false);
  });

  test("a partir das 19h coleta, se a última coleta foi em outro dia ou antes das 19h de hoje", () => {
    assert.equal(precisaColetar(arquivo("2026-11-12T19:07:00-03:00"), as("2026-11-13T19:07:00-03:00")), true);
    assert.equal(precisaColetar(arquivo("2026-11-13T10:22:00-03:00"), as("2026-11-13T19:07:00-03:00")), true); // a primeira foi de manhã
  });

  test("depois de coletar às 19h, as execuções seguintes do mesmo dia não coletam", () => {
    assert.equal(precisaColetar(arquivo("2026-11-13T19:07:00-03:00"), as("2026-11-13T19:22:00-03:00")), false);
    assert.equal(precisaColetar(arquivo("2026-11-13T19:07:00-03:00"), as("2026-11-13T20:52:00-03:00")), false);
  });
});

describe("juntar a coleta nova ao arquivo anterior", () => {
  const agora = new Date("2026-11-13T22:07:00.000Z");
  const c = (preco, dataHora = "2026-11-13T18:05:00.000-0300") => ({ preco, dataHora });
  const anterior = { coletadoEm: "2026-11-12T22:07:00.000Z", fonte: "fonte antiga", precos: { AAAA3: c(10, "2026-11-12T18:05:00.000-0300"), BBBB3: c(20, "2026-11-12T18:05:00.000-0300") } };

  test("primeira coleta: grava o que veio, com a hora da coleta e a fonte, em ordem de ticker", () => {
    const r = juntarCotacoes(null, { BBBB3: c(21), AAAA3: c(11) }, { agora, fonte: "fonte de teste" });
    assert.deepEqual(r, { coletadoEm: "2026-11-13T22:07:00.000Z", fonte: "fonte de teste", precos: { AAAA3: c(11), BBBB3: c(21) } });
    assert.deepEqual(Object.keys(r.precos), ["AAAA3", "BBBB3"]);
  });

  test("falha total (nada veio): null, para a coleta não tocar no arquivo anterior", () => {
    assert.equal(juntarCotacoes(anterior, {}, { agora, fonte: "x" }), null);
    assert.equal(juntarCotacoes(anterior, null, { agora, fonte: "x" }), null);
    assert.equal(juntarCotacoes(anterior, { AAAA3: { preco: 0, dataHora: "2026-11-13T18:05:00.000-0300" } }, { agora, fonte: "x" }), null);
  });

  test("falha parcial: quem não veio fica com o último preço conhecido e com a dataHora dele", () => {
    const r = juntarCotacoes(anterior, { AAAA3: c(11) }, { agora, fonte: "fonte de teste" });
    assert.deepEqual(r.precos, { AAAA3: c(11), BBBB3: c(20, "2026-11-12T18:05:00.000-0300") });
    assert.equal(r.coletadoEm, "2026-11-13T22:07:00.000Z");
    assert.equal(r.fonte, "fonte de teste");
    assert.deepEqual(anterior.precos.AAAA3, c(10, "2026-11-12T18:05:00.000-0300")); // não mexe no objeto recebido
  });

  test("cotação fora do contrato é descartada, e uma mais antiga não substitui a que já está no arquivo", () => {
    const r = juntarCotacoes(anterior, { AAAA3: c(9, "2026-11-10T18:05:00.000-0300"), BBBB3: { preco: "21" }, CCCC3: c(30) }, { agora, fonte: "x" });
    assert.deepEqual(r.precos, { AAAA3: c(10, "2026-11-12T18:05:00.000-0300"), BBBB3: c(20, "2026-11-12T18:05:00.000-0300"), CCCC3: c(30) });
  });

  test("o preço mantido de uma falha parcial acaba marcado como desatualizado pelos múltiplos", () => {
    // AAAA3 não vem desde 03/11; em 13/11 já são 8 dias úteis.
    const arquivo = juntarCotacoes({ coletadoEm: "x", fonte: "x", precos: { AAAA3: c(10, "2026-11-03T18:05:00.000-0300") } }, { BBBB3: c(21) }, { agora, fonte: "x" });
    const composicao = { classes: { on: { circulacao: 1000 }, pn: { circulacao: 0 } } };
    const r = calcularMultiplos({ fundamentos: null, composicao, tickers: [{ ticker: "AAAA3", ibovespa: true }], cotacoes: arquivo, hoje: "2026-11-13" });
    assert.deepEqual([r.multiplos.valorMercado.valor, r.dataPregao, r.desatualizado], [10, "2026-11-03", true]);
  });

  test("resumoDaColeta diz quantos vieram, quem ficou com o preço anterior e quem do universo não tem preço", () => {
    const novas = { AAAA3: c(11) };
    const arquivo = juntarCotacoes(anterior, novas, { agora, fonte: "x" });
    assert.deepEqual(resumoDaColeta(arquivo, novas, ["AAAA3", "BBBB3", "DDDD3"]), { novos: 1, total: 2, mantidos: ["BBBB3"], semPreco: ["DDDD3"] });
  });

  test("o nome do arquivo na branch dados", () => {
    assert.equal(ARQUIVO_COTACOES, "cotacoes-fundamentos.json");
  });
});

describe("adaptador da CNBC: símbolos e conversão para o contrato", () => {
  test("a consulta vai com .SA; a resposta pode vir com -BR ou com .SA", () => {
    assert.equal(SUFIXO_B3, ".SA");
    assert.equal(simboloDoTicker("WEGE3"), "WEGE3.SA");
    assert.equal(tickerDoSimbolo("WEGE3-BR"), "WEGE3");
    assert.equal(tickerDoSimbolo("ABEV3.SA"), "ABEV3");
    assert.equal(tickerDoSimbolo("KLBN11-BR"), "KLBN11");
  });

  test("urlCNBC junta os símbolos com | e codifica", () => {
    const url = urlCNBC(["WEGE3.SA", "@SP.1", ".SPX"]);
    assert.match(url, /^https:\/\/quote\.cnbc\.com\/quote-html-webservice\/restQuote\/symbolType\/symbol\?symbols=WEGE3\.SA%7C%40SP\.1%7C\.SPX&requestMethod=itv/);
    assert.match(url, /output=json$/);
  });

  test("indexarCNBC indexa por símbolo e aguenta resposta vazia", () => {
    assert.deepEqual(Object.keys(indexarCNBC(resposta(q("WEGE3-BR", "51.31"), desconhecido("XXXX3.SA")))), ["WEGE3-BR", "XXXX3.SA"]);
    assert.deepEqual(indexarCNBC(null), {});
    assert.deepEqual(indexarCNBC({}), {});
  });

  test("cotacaoDoContrato: preço do último negócio e a dataHora dele, não a da coleta", () => {
    assert.deepEqual(cotacaoDoContrato(q("WEGE3-BR", "51.31")), { preco: 51.31, dataHora: "2026-11-13T18:05:49.000-0300" });
    assert.deepEqual(cotacaoDoContrato(q("XPTO3-BR", "1,234.50")), { preco: 1234.5, dataHora: "2026-11-13T18:05:49.000-0300" }); // milhar com vírgula
  });

  test("papel que não negociou no dia: a CNBC manda só a data do último negócio, e ela passa como veio", () => {
    const c = cotacaoDoContrato(q("USIM6.SA", "5.50", "2026-11-12"));
    assert.deepEqual(c, { preco: 5.5, dataHora: "2026-11-12" });
    assert.ok(cotacaoValida(c));
  });

  test("cotação que não serve vira null: símbolo desconhecido, sem preço, preço zero, sem data ou em outra moeda", () => {
    assert.equal(cotacaoDoContrato(desconhecido("XXXX3.SA")), null);
    assert.equal(cotacaoDoContrato(q("WEGE3-BR", "")), null);
    assert.equal(cotacaoDoContrato(q("WEGE3-BR", "0.00")), null);
    assert.equal(cotacaoDoContrato(q("WEGE3-BR", "51.31", null)), null);
    assert.equal(cotacaoDoContrato({ symbol: "WEGE3-BR", last: "51.31", last_time: "6:05 PM BET" }), null);
    assert.equal(cotacaoDoContrato(q("ABEV", "2.76", "2026-11-13T16:10:00.000-0500", { currencyCode: "USD" })), null);
    assert.equal(cotacaoDoContrato(null), null);
  });

  test("cotacoesDoContrato: só os tickers pedidos, pelo ticker (sem o sufixo), em ordem", () => {
    const porSimbolo = indexarCNBC(resposta(q("WEGE3-BR", "51.31"), q("ABEV3.SA", "15.79"), desconhecido("SBSP4.SA"), q("PETR4-BR", "45.30")));
    assert.deepEqual(cotacoesDoContrato(porSimbolo, ["WEGE3", "ABEV3", "SBSP4"]), {
      ABEV3: { preco: 15.79, dataHora: "2026-11-13T18:05:49.000-0300" },
      WEGE3: { preco: 51.31, dataHora: "2026-11-13T18:05:49.000-0300" },
    });
  });
});

describe("adaptador da CNBC: cotar e cotarCNBC, com a busca trocada", () => {
  const tickers = (n) => Array.from({ length: n }, (_, i) => `T${String(i).padStart(3, "0")}3`);
  // Responde cada lote com uma cotação por símbolo pedido; `falhar(numeroDoLote)` diz quais lotes dão erro.
  function busca({ falhar = () => false } = {}) {
    const chamadas = [];
    const buscar = async (url) => {
      const simbolos = decodeURIComponent(/symbols=([^&]*)/.exec(url)[1]).split("|");
      chamadas.push(simbolos);
      if (falhar(chamadas.length)) throw new Error(`503 no lote ${chamadas.length}`);
      return resposta(...simbolos.map((s) => q(s.replace(".SA", "-BR"), "10.00")));
    };
    return { buscar, chamadas };
  }

  test("lotes de 40 e timeout de 20 s", () => {
    assert.equal(TAMANHO_DO_LOTE, 40);
    assert.equal(TIMEOUT_MS, 20000);
  });

  test("cotar: 97 tickers vão em 3 lotes (40, 40 e 17), com o sufixo .SA, e voltam pelo ticker", async () => {
    const { buscar, chamadas } = busca();
    const r = await cotar(tickers(97), { buscar });
    assert.deepEqual(chamadas.map((l) => l.length), [40, 40, 17]);
    assert.ok(chamadas.flat().every((s) => s.endsWith(".SA")));
    assert.equal(Object.keys(r).length, 97);
    assert.deepEqual(r.T0003, { preco: 10, dataHora: "2026-11-13T18:05:49.000-0300" });
  });

  test("cotar: ticker que a CNBC não conhece fica ausente, nunca zero", async () => {
    const buscar = async () => resposta(q("WEGE3-BR", "51.31"), desconhecido("SBSP4.SA"), q("TEND3.SA", "17.23"));
    const r = await cotar(["WEGE3", "SBSP4", "TEND3"], { buscar });
    assert.deepEqual(Object.keys(r), ["TEND3", "WEGE3"]);
    assert.equal("SBSP4" in r, false);
  });

  test("cotar: um lote que falha não derruba os outros (falha parcial)", async () => {
    const { buscar, chamadas } = busca({ falhar: (n) => n === 2 });
    const r = await cotar(tickers(97), { buscar });
    assert.equal(chamadas.length, 3);
    assert.equal(Object.keys(r).length, 57);
    assert.ok("T0003" in r && !("T0403" in r) && "T0963" in r);
  });

  test("cotar: todos os lotes falharam é falha total, e lança erro", async () => {
    const { buscar } = busca({ falhar: () => true });
    await assert.rejects(cotar(tickers(50), { buscar }), /CNBC: todos os 2 lotes falharam \(503 no lote 2\)/);
  });

  test("cotar: lista vazia não chama a rede; tickers repetidos vão uma vez só", async () => {
    const { buscar, chamadas } = busca();
    assert.deepEqual(await cotar([], { buscar }), {});
    assert.deepEqual(await cotar(null, { buscar }), {});
    assert.equal(chamadas.length, 0);
    await cotar(["WEGE3", "WEGE3"], { buscar });
    assert.deepEqual(chamadas, [["WEGE3.SA"]]);
  });

  test("cotarCNBC (usada pelo mapa do Diário): símbolos como vieram, indexados pelo símbolo; qualquer lote que falhe derruba a chamada", async () => {
    const ok = busca();
    const r = await cotarCNBC(["PETR4-BR", "AAPL"], { buscar: ok.buscar });
    assert.deepEqual(ok.chamadas, [["PETR4-BR", "AAPL"]]);
    assert.deepEqual(Object.keys(r), ["PETR4-BR", "AAPL"]);
    const ruim = busca({ falhar: (n) => n === 2 });
    await assert.rejects(cotarCNBC(tickers(50), { buscar: ruim.buscar }), /503 no lote 2/);
  });
});

describe("a CNBC fica atrás do adaptador", () => {
  const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const arquivos = (pasta) => readdirSync(path.join(RAIZ, pasta), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? arquivos(`${pasta}/${e.name}`) : /\.m?js$/.test(e.name) ? [`${pasta}/${e.name}`] : []));
  const fontes = Object.fromEntries(arquivos("scripts").map((f) => [f, readFileSync(path.join(RAIZ, f), "utf8")]));
  const importaCnbc = (texto) => /from\s+["'][^"']*cnbc\.mjs["']/.test(texto);

  test("só fonte.mjs (a linha que escolhe a fonte) e update.mjs (o Diário) importam o adaptador", () => {
    assert.deepEqual(Object.keys(fontes).filter((f) => importaCnbc(fontes[f])).sort(), ["scripts/precos/fonte.mjs", "scripts/update.mjs"]);
  });

  test("o endereço da CNBC só aparece no adaptador", () => {
    assert.deepEqual(Object.keys(fontes).filter((f) => /quote\.cnbc\.com/.test(fontes[f])), ["scripts/precos/cnbc.mjs"]);
  });

  test("os módulos da CVM (múltiplos, indicadores, séries) e o build não citam a CNBC", () => {
    for (const f of Object.keys(fontes).filter((x) => x.startsWith("scripts/cvm/") || x === "scripts/build.mjs" || x === "scripts/paginas.mjs")) {
      assert.doesNotMatch(fontes[f], /cnbc/i, f);
    }
  });

  test("nada da B3 no repositório: nenhum módulo cita o arquivo de cotações históricas nem o endereço dele", () => {
    for (const [f, texto] of Object.entries(fontes)) assert.doesNotMatch(texto, /COTAHIST|bvmf\.bmfbovespa/i, f);
  });

  test("update.mjs usa o preço das ações só pelo contrato (cotar e FONTE vêm de fonte.mjs)", () => {
    const update = fontes["scripts/update.mjs"];
    assert.match(update, /import \{ cotarCNBC, indexarCNBC, urlCNBC \} from "\.\/precos\/cnbc\.mjs";/);
    assert.match(update, /import \{[^}]*\bcotar\b[^}]*\} from "\.\/precos\/fonte\.mjs";/);
    assert.doesNotMatch(update, /async function cotarCNBC/); // sem cópia da função
  });
});
