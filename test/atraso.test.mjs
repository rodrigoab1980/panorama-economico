import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { minutosNaJanela, estaAtrasado, textoAtualizacao } from "../site/atraso.js";

// Horários de Brasília (UTC-3). 12/11/2026 é quinta-feira; 13 sexta; 14 sábado; 15 domingo; 16 segunda.
const br = (dataHora) => new Date(`${dataHora}:00-03:00`);

describe("minutosNaJanela", () => {
  test("dentro do horário de execução conta o tempo normal", () => {
    assert.equal(minutosNaJanela(br("2026-11-12T10:00"), br("2026-11-12T10:45")), 45);
  });

  test("um dia útil inteiro tem 15 h de janela (06:00–21:00)", () => {
    assert.equal(minutosNaJanela(br("2026-11-12T00:00"), br("2026-11-13T00:00")), 900);
  });

  test("uma semana inteira tem 5 dias úteis de janela", () => {
    assert.equal(minutosNaJanela(br("2026-11-16T00:00"), br("2026-11-23T00:00")), 5 * 900);
  });

  test("noite, sábado e domingo não contam", () => {
    assert.equal(minutosNaJanela(br("2026-11-12T21:00"), br("2026-11-13T06:00")), 0);
    assert.equal(minutosNaJanela(br("2026-11-13T21:00"), br("2026-11-16T06:00")), 0);
  });

  test("intervalo invertido, vazio ou inválido dá zero", () => {
    assert.equal(minutosNaJanela(br("2026-11-12T11:00"), br("2026-11-12T10:00")), 0);
    assert.equal(minutosNaJanela(br("2026-11-12T11:00"), br("2026-11-12T11:00")), 0);
    assert.equal(minutosNaJanela("lixo", br("2026-11-12T11:00")), 0);
  });

  test("dado muito antigo não trava (conta no máximo ~60 dias)", () => {
    const m = minutosNaJanela(new Date("2020-01-01T00:00:00Z"), br("2026-11-12T12:00"));
    assert.ok(m > 60 && m <= 61 * 900);
  });
});

describe("estaAtrasado", () => {
  const ultimo = br("2026-11-12T10:00");

  test("em horário de pregão: até 1 h não é atraso; passou de 1 h é", () => {
    assert.equal(estaAtrasado(ultimo, br("2026-11-12T10:30")), false);
    assert.equal(estaAtrasado(ultimo, br("2026-11-12T11:00")), false);
    assert.equal(estaAtrasado(ultimo, br("2026-11-12T11:01")), true);
  });

  test("aceita ISO em texto, como vem dos JSON", () => {
    assert.equal(estaAtrasado("2026-11-12T13:00:00.000Z", br("2026-11-12T12:00")), true);
    assert.equal(estaAtrasado("2026-11-12T14:30:00.000Z", br("2026-11-12T12:00")), false);
  });

  test("noite: a última coleta do dia (20:52) não fica atrasada até a manhã seguinte", () => {
    const ultimaDoDia = br("2026-11-12T20:52");
    assert.equal(estaAtrasado(ultimaDoDia, br("2026-11-12T23:30")), false);
    assert.equal(estaAtrasado(ultimaDoDia, br("2026-11-13T03:00")), false);
    assert.equal(estaAtrasado(ultimaDoDia, br("2026-11-13T06:50")), false); // 8 + 50 min
    assert.equal(estaAtrasado(ultimaDoDia, br("2026-11-13T07:00")), true); // 8 + 60 min
  });

  test("fim de semana: o dado de sexta à noite não fica atrasado no sábado nem no domingo", () => {
    const sexta = br("2026-11-13T20:52");
    assert.equal(estaAtrasado(sexta, br("2026-11-14T12:00")), false);
    assert.equal(estaAtrasado(sexta, br("2026-11-15T22:00")), false);
    assert.equal(estaAtrasado(sexta, br("2026-11-16T06:30")), false); // segunda: 8 + 30 min
    assert.equal(estaAtrasado(sexta, br("2026-11-16T07:10")), true); // segunda: 8 + 70 min
  });

  test("coleta que parou no meio do dia continua acusando atraso à noite e no fim de semana", () => {
    const parou = br("2026-11-13T15:00");
    assert.equal(estaAtrasado(parou, br("2026-11-13T22:00")), true);
    assert.equal(estaAtrasado(parou, br("2026-11-14T12:00")), true);
  });

  test("limite configurável (ex.: resumo da IA, refeito de hora em hora)", () => {
    assert.equal(estaAtrasado(ultimo, br("2026-11-12T11:30"), 120), false);
    assert.equal(estaAtrasado(ultimo, br("2026-11-12T12:01"), 120), true);
  });

  test("data no futuro (relógio adiantado) não é atraso", () => {
    assert.equal(estaAtrasado(br("2026-11-12T12:00"), br("2026-11-12T10:00")), false);
  });

  test("sem data ou data inválida não acusa atraso", () => {
    for (const v of [null, undefined, "", "lixo"]) assert.equal(estaAtrasado(v, br("2026-11-12T12:00")), false, String(v));
  });
});

describe("textoAtualizacao", () => {
  const agora = br("2026-11-12T14:07");

  test("mostra tempo relativo e data e hora de Brasília", () => {
    assert.equal(textoAtualizacao(br("2026-11-12T14:06"), agora), "há 1 min · 12/11 14:06");
    assert.equal(textoAtualizacao(br("2026-11-12T14:02"), agora), "há 5 min · 12/11 14:02");
    assert.equal(textoAtualizacao(br("2026-11-12T12:07"), agora), "há 2 h · 12/11 12:07");
    assert.equal(textoAtualizacao(br("2026-11-12T11:52"), agora), "há 2 h 15 min · 12/11 11:52");
    assert.equal(textoAtualizacao(br("2026-11-09T20:52"), agora), "há 2 dias · 09/11 20:52");
  });

  test("menos de 1 minuto (ou no futuro) vira 'agora há pouco'", () => {
    assert.equal(textoAtualizacao("2026-11-12T17:06:30.000Z", agora), "agora há pouco · 12/11 14:06");
    assert.equal(textoAtualizacao(br("2026-11-12T14:10"), agora), "agora há pouco · 12/11 14:10");
  });

  test("usa o horário de Brasília mesmo perto da meia-noite UTC", () => {
    assert.equal(textoAtualizacao("2026-11-13T01:30:00.000Z", new Date("2026-11-13T01:40:00.000Z")), "há 10 min · 12/11 22:30");
  });

  test("sem data ou data inválida devolve texto vazio", () => {
    assert.equal(textoAtualizacao(null, agora), "");
    assert.equal(textoAtualizacao("lixo", agora), "");
  });
});
