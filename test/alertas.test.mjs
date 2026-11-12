import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ALERTA_PADRAO, configAlerta, variacoesDiarias, desvioPadrao, avaliarMovimento, detectarAlertas, diasAntes,
} from "../scripts/logica.mjs";

const HOJE = "2026-11-12";

// Histórico com `n` fechamentos em dias corridos até ontem, a partir de uma lista de valores.
function historicoDe(simbolo, valores) {
  const fechamentos = {};
  valores.forEach((v, i) => { fechamentos[diasAntes(HOJE, valores.length - i)] = { [simbolo]: v }; });
  return { formato: 1, fechamentos };
}

// Preço que alterna +1% / -1% todo dia: variações diárias de ~±1%, desvio padrão ~1%.
function precosOscilando(n, inicio = 100) {
  const v = [inicio];
  for (let i = 1; i < n; i++) v.push(v[i - 1] * (i % 2 ? 1.01 : 0.99));
  return v;
}

const preco = (variacao_pct, simbolo = ".SPX") => ({ simbolo, nome: "S&P 500", variacao_pct, variacao_bps: null });
const juro = (variacao_bps, simbolo = "US10Y") => ({ simbolo, nome: "EUA 10 anos", variacao_pct: null, variacao_bps });

describe("configAlerta", () => {
  test("sem variáveis usa o padrão documentado", () => {
    assert.deepEqual(configAlerta({}), ALERTA_PADRAO);
    assert.equal(ALERTA_PADRAO.desvios, 2.5);
  });

  test("lê ALERTA_DESVIOS, ALERTA_PCT e ALERTA_BPS", () => {
    const c = configAlerta({ ALERTA_DESVIOS: "3", ALERTA_PCT: "2.5", ALERTA_BPS: "20" });
    assert.equal(c.desvios, 3);
    assert.equal(c.pct, 2.5);
    assert.equal(c.bps, 20);
  });

  test("valor vazio, zero, negativo ou texto volta para o padrão", () => {
    for (const v of ["", "0", "-1", "abc"]) assert.equal(configAlerta({ ALERTA_DESVIOS: v }).desvios, 2.5, v);
  });
});

describe("variacoesDiarias e desvioPadrao", () => {
  test("variações entre fechamentos consecutivos, em % para preço", () => {
    const v = variacoesDiarias(historicoDe(".SPX", [100, 110, 99]), ".SPX", HOJE);
    assert.equal(v.length, 2);
    assert.ok(Math.abs(v[0] - 10) < 1e-9 && Math.abs(v[1] + 10) < 1e-9);
  });

  test("juros em pontos-base", () => {
    const v = variacoesDiarias(historicoDe("US10Y", [4.5, 4.6]), "US10Y", HOJE, true);
    assert.ok(Math.abs(v[0] - 10) < 1e-9);
  });

  test("pula dias em que o ativo não tem valor e ignora o dia de hoje", () => {
    const h = historicoDe(".SPX", [100, 110, 121]);
    h.fechamentos[diasAntes(HOJE, 2)] = {}; // faltou no meio
    h.fechamentos[HOJE] = { ".SPX": 999 };
    const v = variacoesDiarias(h, ".SPX", HOJE);
    assert.equal(v.length, 1);
    assert.ok(Math.abs(v[0] - 21) < 1e-9);
  });

  test("usa só as `janela` variações mais recentes", () => {
    assert.equal(variacoesDiarias(historicoDe(".SPX", precosOscilando(100)), ".SPX", HOJE, false, 60).length, 60);
  });

  test("desvio padrão amostral; null com menos de 2 valores", () => {
    assert.equal(desvioPadrao([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7));
    assert.equal(desvioPadrao([1]), null);
    assert.equal(desvioPadrao([]), null);
  });
});

describe("avaliarMovimento com histórico (critério de desvio)", () => {
  const h = historicoDe(".SPX", precosOscilando(41)); // 40 variações
  const dp = desvioPadrao(variacoesDiarias(h, ".SPX", HOJE));

  test("abaixo do limite: sem alerta", () => {
    assert.equal(avaliarMovimento(preco(2 * dp), h, HOJE), null);
  });

  test("no limite (exatamente 2,5×): alerta", () => {
    const a = avaliarMovimento(preco(2.5 * dp), h, HOJE);
    assert.equal(a.criterio, "desvio");
    assert.equal(a.vezes, 2.5);
  });

  test("acima do limite, para cima ou para baixo: alerta com quantas vezes o normal", () => {
    const a = avaliarMovimento(preco(-3.2), h, HOJE);
    assert.equal(a.criterio, "desvio");
    assert.equal(a.unidade, "%");
    assert.equal(a.variacao, -3.2);
    assert.equal(a.vezes, +(3.2 / dp).toFixed(1));
    assert.equal(a.dias, 40);
  });

  test("um movimento de 3% num ativo que oscila 5% ao dia é normal (o limite fixo não vale aqui)", () => {
    const volatil = historicoDe("BTC", precosOscilando(41).map((_, i) => 100 * (i % 2 ? 1.05 : 1)));
    assert.equal(avaliarMovimento(preco(3.5, "BTC"), volatil, HOJE), null);
  });

  test("X configurável: com 4 desvios, o mesmo movimento deixa de alertar", () => {
    const cfg = { ...ALERTA_PADRAO, desvios: 4 };
    assert.ok(avaliarMovimento(preco(3 * dp), h, HOJE));
    assert.equal(avaliarMovimento(preco(3 * dp), h, HOJE, cfg), null);
  });

  test("juros usam pontos-base", () => {
    const hj = historicoDe("US10Y", Array.from({ length: 41 }, (_, i) => 4.5 + (i % 2 ? 0.02 : 0))); // ±2 bps
    const a = avaliarMovimento(juro(12), hj, HOJE);
    assert.equal(a.criterio, "desvio");
    assert.equal(a.unidade, "bps");
    assert.equal(avaliarMovimento(juro(3), hj, HOJE), null);
  });
});

describe("avaliarMovimento com histórico insuficiente (limite fixo)", () => {
  const curto = historicoDe(".SPX", precosOscilando(10)); // 9 variações < 20

  test("abaixo de 3%: sem alerta", () => {
    assert.equal(avaliarMovimento(preco(2.99), curto, HOJE), null);
  });

  test("no limite (3%) e acima: alerta pelo critério fixo", () => {
    assert.deepEqual(avaliarMovimento(preco(3), curto, HOJE),
      { simbolo: ".SPX", nome: "S&P 500", variacao: 3, unidade: "%", criterio: "fixo", limite: 3 });
    assert.equal(avaliarMovimento(preco(-4.1), curto, HOJE).criterio, "fixo");
  });

  test("juros: 15 bps", () => {
    assert.equal(avaliarMovimento(juro(14.9), null, HOJE), null);
    assert.equal(avaliarMovimento(juro(-15), null, HOJE).limite, 15);
  });

  test("sem histórico nenhum também usa o limite fixo", () => {
    assert.equal(avaliarMovimento(preco(5), null, HOJE).criterio, "fixo");
  });

  test("histórico parado (desvio zero) cai no limite fixo em vez de dividir por zero", () => {
    const parado = historicoDe(".SPX", Array(30).fill(100));
    assert.equal(avaliarMovimento(preco(1), parado, HOJE), null);
    assert.equal(avaliarMovimento(preco(3), parado, HOJE).criterio, "fixo");
  });

  test("variação ausente ou zero nunca alerta", () => {
    assert.equal(avaliarMovimento(preco(null), null, HOJE), null);
    assert.equal(avaliarMovimento(preco(0), null, HOJE), null);
  });
});

describe("detectarAlertas", () => {
  test("lista só os ativos fora do padrão, do mais extremo para o menor", () => {
    const ativos = [preco(1, "A"), preco(-5, "B"), preco(3.5, "C"), juro(30, "D")];
    assert.deepEqual(detectarAlertas(ativos, null, HOJE).map((a) => a.simbolo), ["D", "B", "C"]);
  });

  test("sem ativos, lista vazia", () => {
    assert.deepEqual(detectarAlertas(null, null, HOJE), []);
  });
});
