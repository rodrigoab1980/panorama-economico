import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  historicoVazio, normalizarHistorico, registrarFechamento, serializarHistorico,
  diasAntes, fechamentoReferencia, variacaoDesde, variacoesPeriodo,
} from "../scripts/logica.mjs";

// Datas de Brasília. 12/11/2026 é quinta-feira.
const HOJE = "2026-11-12";

// Gera fechamentos em dias úteis (seg–sex) entre duas datas, com valor crescente para o símbolo.
function historicoUtil(inicio, fim, simbolo = ".SPX", valorDe = (i) => 100 + i) {
  const fechamentos = {};
  let i = 0;
  for (let d = inicio; d <= fim; d = diasAntes(d, -1)) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    fechamentos[d] = { [simbolo]: valorDe(i++) };
  }
  return { formato: 1, fechamentos };
}

describe("diasAntes", () => {
  test("subtrai dias corridos, atravessando mês e ano", () => {
    assert.equal(diasAntes("2026-11-12", 7), "2026-11-05");
    assert.equal(diasAntes("2026-11-12", 30), "2026-10-13");
    assert.equal(diasAntes("2026-01-03", 5), "2025-12-29");
  });
});

describe("normalizarHistorico", () => {
  test("arquivo ausente ou corrompido vira histórico vazio", () => {
    for (const v of [null, undefined, "lixo", 42, {}, { fechamentos: "x" }]) {
      assert.deepEqual(normalizarHistorico(v), historicoVazio(), String(v));
    }
  });
});

describe("registrarFechamento", () => {
  const ativos = [
    { simbolo: ".SPX", ultimo: 7644.91 },
    { simbolo: "US10Y", ultimo: 5.068, variacao_bps: 7.9 },
    { simbolo: "QUEBRADO", ultimo: NaN },
  ];

  test("grava o último valor de cada ativo válido na data do dia", () => {
    const h = registrarFechamento(historicoVazio(), HOJE, ativos);
    assert.deepEqual(h.fechamentos[HOJE], { ".SPX": 7644.91, US10Y: 5.068 });
  });

  test("substitui o mesmo dia (a última coleta do dia vence) e preserva os outros dias", () => {
    let h = registrarFechamento(historicoVazio(), "2026-11-11", [{ simbolo: ".SPX", ultimo: 1 }]);
    h = registrarFechamento(h, HOJE, [{ simbolo: ".SPX", ultimo: 2 }]);
    h = registrarFechamento(h, HOJE, [{ simbolo: ".SPX", ultimo: 3 }]);
    assert.deepEqual(h.fechamentos, { "2026-11-11": { ".SPX": 1 }, [HOJE]: { ".SPX": 3 } });
  });

  test("não altera o histórico recebido", () => {
    const original = historicoVazio();
    registrarFechamento(original, HOJE, ativos);
    assert.deepEqual(original, historicoVazio());
  });

  test("sem nenhum ativo válido, não cria o dia", () => {
    assert.deepEqual(registrarFechamento(historicoVazio(), HOJE, []).fechamentos, {});
    assert.deepEqual(registrarFechamento(historicoVazio(), HOJE, null).fechamentos, {});
  });
});

describe("serializarHistorico", () => {
  test("uma linha por dia, em ordem de data, e volta igual com JSON.parse", () => {
    const h = { formato: 1, fechamentos: { [HOJE]: { a: 2 }, "2026-11-11": { a: 1 } } };
    const txt = serializarHistorico(h);
    assert.equal(txt, '{"formato": 1, "fechamentos": {\n  "2026-11-11": {"a":1},\n  "2026-11-12": {"a":2}\n}}\n');
    assert.deepEqual(JSON.parse(txt), h);
  });

  test("histórico vazio continua sendo JSON válido", () => {
    assert.deepEqual(JSON.parse(serializarHistorico(historicoVazio())), historicoVazio());
  });
});

describe("fechamentoReferencia", () => {
  const h = { formato: 1, fechamentos: {
    "2026-11-02": { ".SPX": 90 },
    "2026-11-04": { ".SPX": 95 },
    "2026-11-05": { ".SPX": 100, US10Y: 5 },
  } };

  test("usa o fechamento exato do dia alvo quando existe", () => {
    assert.deepEqual(fechamentoReferencia(h, ".SPX", "2026-11-05"), { dia: "2026-11-05", valor: 100 });
  });

  test("dia alvo sem dado (fim de semana, feriado): volta para o dia anterior mais próximo", () => {
    assert.deepEqual(fechamentoReferencia(h, ".SPX", "2026-11-08"), { dia: "2026-11-05", valor: 100 });
    assert.deepEqual(fechamentoReferencia(h, ".SPX", "2026-11-03"), { dia: "2026-11-02", valor: 90 });
  });

  test("ativo que faltou num dia: procura o dia anterior em que ele tem valor", () => {
    assert.deepEqual(fechamentoReferencia(h, "US10Y", "2026-11-06"), { dia: "2026-11-05", valor: 5 });
    assert.equal(fechamentoReferencia(h, "US10Y", "2026-11-04"), null);
  });

  test("buraco maior que a tolerância (4 dias) não serve de referência", () => {
    assert.equal(fechamentoReferencia(h, ".SPX", "2026-11-10"), null);
    assert.deepEqual(fechamentoReferencia(h, ".SPX", "2026-11-10", 5), { dia: "2026-11-05", valor: 100 });
  });

  test("nunca usa um dia depois do alvo", () => {
    assert.equal(fechamentoReferencia(h, ".SPX", "2026-11-01"), null);
  });
});

describe("variacaoDesde", () => {
  test("preço: variação percentual com 2 casas", () => {
    assert.deepEqual(variacaoDesde(105, { dia: "2026-11-05", valor: 100 }), { variacao_pct: 5, desde: "2026-11-05" });
    assert.deepEqual(variacaoDesde(98.761, { dia: "d", valor: 100 }), { variacao_pct: -1.24, desde: "d" });
  });

  test("juros: variação em pontos-base", () => {
    assert.deepEqual(variacaoDesde(5.068, { dia: "d", valor: 4.9 }, true), { variacao_bps: 16.8, desde: "d" });
  });

  test("sem referência, valor atual inválido ou referência zero dá null", () => {
    assert.equal(variacaoDesde(100, null), null);
    assert.equal(variacaoDesde(NaN, { dia: "d", valor: 100 }), null);
    assert.equal(variacaoDesde(100, { dia: "d", valor: 0 }), null);
  });
});

describe("variacoesPeriodo", () => {
  const spx = { simbolo: ".SPX", ultimo: 200, variacao_pct: 0.3, variacao_bps: null };

  test("histórico completo: calcula semana (7 dias) e mês (30 dias)", () => {
    const h = historicoUtil("2026-09-01", "2026-11-11");
    const [a] = variacoesPeriodo([spx], h, HOJE);
    const sem = h.fechamentos["2026-11-05"][".SPX"];
    const mes = h.fechamentos["2026-10-13"][".SPX"];
    assert.deepEqual(a.semana, { variacao_pct: +((200 / sem - 1) * 100).toFixed(2), desde: "2026-11-05" });
    assert.deepEqual(a.mes, { variacao_pct: +((200 / mes - 1) * 100).toFixed(2), desde: "2026-10-13" });
    assert.equal(a.variacao_pct, 0.3, "mantém os campos originais");
  });

  test("com buracos: usa o dia útil anterior mais próximo", () => {
    const h = historicoUtil("2026-09-01", "2026-11-11");
    delete h.fechamentos["2026-11-05"]; // sem coleta na quinta da semana passada
    delete h.fechamentos["2026-10-13"]; // nem no dia do mês passado
    const [a] = variacoesPeriodo([spx], h, HOJE);
    assert.equal(a.semana.desde, "2026-11-04");
    assert.equal(a.mes.desde, "2026-10-12");
  });

  test("buraco longo no período: a variação fica null em vez de usar um dado velho demais", () => {
    const h = historicoUtil("2026-09-01", "2026-10-20");
    Object.assign(h.fechamentos, historicoUtil("2026-11-10", "2026-11-11").fechamentos);
    const [a] = variacoesPeriodo([spx], h, HOJE);
    assert.equal(a.semana, null);
    assert.equal(a.mes.desde, "2026-10-13");
  });

  test("histórico curto (menos de 1 semana): semana e mês null", () => {
    const h = historicoUtil("2026-11-09", "2026-11-11");
    const [a] = variacoesPeriodo([spx], h, HOJE);
    assert.equal(a.semana, null);
    assert.equal(a.mes, null);
  });

  test("histórico de 2 semanas: tem semana, mas não mês", () => {
    const h = historicoUtil("2026-10-29", "2026-11-11");
    const [a] = variacoesPeriodo([spx], h, HOJE);
    assert.equal(a.semana.desde, "2026-11-05");
    assert.equal(a.mes, null);
  });

  test("juros usam pontos-base", () => {
    const h = { formato: 1, fechamentos: { "2026-11-05": { US10Y: 4.9 } } };
    const [a] = variacoesPeriodo([{ simbolo: "US10Y", ultimo: 5.068, variacao_pct: null, variacao_bps: 7.9 }], h, HOJE);
    assert.deepEqual(a.semana, { variacao_bps: 16.8, desde: "2026-11-05" });
  });

  test("sem histórico nenhum (primeira execução ou arquivo ilegível)", () => {
    const [a] = variacoesPeriodo([spx], null, HOJE);
    assert.equal(a.semana, null);
    assert.equal(a.mes, null);
  });
});
