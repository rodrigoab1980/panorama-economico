import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pularAgendada } from "../scripts/logica.mjs";

const AGORA = new Date("2026-11-12T15:30:00Z");
const run = (event, minAtras, conclusion = "success", id = Math.random()) => ({
  id, event, conclusion, status: conclusion ? "completed" : "in_progress",
  created_at: new Date(AGORA.getTime() - minAtras * 60e3).toISOString(),
});

describe("pularAgendada", () => {
  test("gatilho externo rodou há 5 min: a agendada pula", () => {
    const d = pularAgendada([run("workflow_dispatch", 5, "success", 99)], AGORA);
    assert.equal(d.pular, true);
    assert.match(d.motivo, /99/);
  });

  test("gatilho externo ainda rodando também conta", () => {
    assert.equal(pularAgendada([run("workflow_dispatch", 1, null)], AGORA).pular, true);
  });

  test("sem execução externa recente (cron-job.org fora do ar): a agendada roda", () => {
    assert.equal(pularAgendada([run("workflow_dispatch", 20)], AGORA).pular, false);
    assert.equal(pularAgendada([], AGORA).pular, false);
    assert.equal(pularAgendada(null, AGORA).pular, false);
  });

  test("no limite da janela (12 min) ainda pula; passou, roda", () => {
    assert.equal(pularAgendada([run("workflow_dispatch", 12)], AGORA).pular, true);
    assert.equal(pularAgendada([run("workflow_dispatch", 12.1)], AGORA).pular, false);
  });

  test("execução externa que falhou ou foi cancelada não conta: a agendada roda para cobrir", () => {
    for (const c of ["failure", "cancelled", "timed_out", "startup_failure"]) {
      assert.equal(pularAgendada([run("workflow_dispatch", 3, c)], AGORA).pular, false, c);
    }
  });

  test("outras agendadas e pushes não contam", () => {
    assert.equal(pularAgendada([run("schedule", 2), run("push", 2)], AGORA).pular, false);
  });

  test("ignora a própria execução e datas muito no futuro", () => {
    assert.equal(pularAgendada([run("workflow_dispatch", 1, null, 7)], AGORA, { idAtual: 7 }).pular, false);
    assert.equal(pularAgendada([run("workflow_dispatch", -10)], AGORA).pular, false);
  });

  test("janela configurável", () => {
    assert.equal(pularAgendada([run("workflow_dispatch", 20)], AGORA, { janelaMin: 30 }).pular, true);
  });
});
