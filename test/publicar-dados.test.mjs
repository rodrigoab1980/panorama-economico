// Commit e push da coleta dos fundamentos na branch de dados (#37), com o git trocado por um de mentira
// e, no fim, com um git de verdade em repositórios temporários (o caminho da rejeição).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ESPERA_ENTRE_TENTATIVAS_MS, TENTATIVAS_DE_PUSH, publicar } from "../scripts/publicar-dados.mjs";

// Git de mentira: responde a cada comando pela primeira palavra; `pushes` diz o código de cada push.
function gitFalso({ status = " M fundamentos/005410.json\n", pushes = [0], rebase = 0, commit = 0 } = {}) {
  const chamadas = [];
  let n = 0;
  const git = (args) => {
    chamadas.push(args.join(" "));
    if (args[0] === "status") return { codigo: 0, saida: status };
    if (args[0] === "commit") return { codigo: commit, saida: commit ? "nothing to commit" : "" };
    if (args[0] === "push") { const codigo = pushes[Math.min(n++, pushes.length - 1)]; return { codigo, saida: codigo ? "To github.com:x/y\n ! [rejected]        HEAD -> dados (fetch first)" : "" }; }
    if (args[0] === "pull") return { codigo: rebase, saida: rebase ? "CONFLICT (content): Merge conflict in fundamentos/indice.json" : "" };
    return { codigo: 0, saida: "" };
  };
  return { git, chamadas };
}
const esperas = () => { const lista = []; return { esperar: async (ms) => { lista.push(ms); }, lista }; };
const base = { branch: "dados", mensagem: "dados: fundamentos de 2026-11-15", caminhos: ["fundamentos"] };

describe("publicar: commit só quando algo mudou", () => {
  test("nada mudou: nenhum commit e nenhum push", async () => {
    const { git, chamadas } = gitFalso({ status: "" });
    const r = await publicar({ ...base, git, ...esperas() });
    assert.deepEqual(r, { commit: false, push: false, tentativas: 0, motivo: "nada mudou" });
    assert.deepEqual(chamadas, ["status --porcelain -- fundamentos"]);
  });

  test("mudou: add, commit e push na branch, de primeira", async () => {
    const { git, chamadas } = gitFalso();
    const r = await publicar({ ...base, git, ...esperas() });
    assert.deepEqual(r, { commit: true, push: true, tentativas: 1, motivo: null });
    assert.deepEqual(chamadas, ["status --porcelain -- fundamentos", "add -A -- fundamentos", "commit -m dados: fundamentos de 2026-11-15", "push origin HEAD:dados"]);
  });

  test("só olha a pasta pedida: mudança fora dela não entra no commit", async () => {
    const { git, chamadas } = gitFalso();
    await publicar({ ...base, git, ...esperas() });
    assert.ok(chamadas.filter((c) => c.startsWith("add") || c.startsWith("status")).every((c) => c.endsWith("-- fundamentos")));
  });
});

describe("publicar: push rejeitado", () => {
  test("rejeitado uma vez: espera, pull --rebase e push de novo", async () => {
    const { git, chamadas } = gitFalso({ pushes: [1, 0] });
    const e = esperas();
    const avisos = [];
    const r = await publicar({ ...base, git, esperar: e.esperar, log: (t) => avisos.push(t) });
    assert.deepEqual(r, { commit: true, push: true, tentativas: 2, motivo: null });
    assert.deepEqual(chamadas.slice(3), ["push origin HEAD:dados", "pull --rebase origin dados", "push origin HEAD:dados"]);
    assert.deepEqual(e.lista, [ESPERA_ENTRE_TENTATIVAS_MS]);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /push rejeitado \(tentativa 1 de 3\): .*\[rejected\]/);
  });

  test("rejeitado duas vezes e aceito na terceira; a espera cresce", async () => {
    const { git } = gitFalso({ pushes: [1, 1, 0] });
    const e = esperas();
    const r = await publicar({ ...base, git, esperar: e.esperar });
    assert.deepEqual([r.push, r.tentativas], [true, 3]);
    assert.deepEqual(e.lista, [ESPERA_ENTRE_TENTATIVAS_MS, 2 * ESPERA_ENTRE_TENTATIVAS_MS]);
  });

  test("rejeitado três vezes: para, sem forçar o push, e diz o motivo", async () => {
    assert.equal(TENTATIVAS_DE_PUSH, 3);
    const { git, chamadas } = gitFalso({ pushes: [1] });
    const e = esperas();
    const r = await publicar({ ...base, git, esperar: e.esperar });
    assert.equal(r.commit, true);
    assert.equal(r.push, false);
    assert.equal(r.tentativas, 3);
    assert.match(r.motivo, /^push rejeitado 3 vezes: /);
    assert.equal(chamadas.filter((c) => c.startsWith("push")).length, 3);
    assert.equal(chamadas.filter((c) => c.startsWith("pull")).length, 2); // não há pull depois da última tentativa
    assert.ok(chamadas.every((c) => !/--force|-f\b/.test(c)));
  });

  test("o rebase não fecha: desfaz o rebase e para", async () => {
    const { git, chamadas } = gitFalso({ pushes: [1], rebase: 1 });
    const r = await publicar({ ...base, git, ...esperas() });
    assert.deepEqual([r.commit, r.push, r.tentativas], [true, false, 1]);
    assert.match(r.motivo, /^git pull --rebase falhou: CONFLICT/);
    assert.equal(chamadas.at(-1), "rebase --abort");
  });

  test("falha no commit ou no status: não tenta o push", async () => {
    const semCommit = gitFalso({ commit: 1 });
    const r = await publicar({ ...base, git: semCommit.git, ...esperas() });
    assert.deepEqual([r.commit, r.push], [false, false]);
    assert.match(r.motivo, /^git commit falhou/);
    assert.ok(!semCommit.chamadas.some((c) => c.startsWith("push")));
    const r2 = await publicar({ ...base, git: () => ({ codigo: 128, saida: "fatal: not a git repository" }), ...esperas() });
    assert.match(r2.motivo, /^git status falhou: fatal: not a git repository/);
  });
});

describe("publicar com git de verdade: outro processo grava na branch entre o checkout e o push", () => {
  let pasta;
  const git = (cwd) => (args) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    return { codigo: r.status ?? 1, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  const rodar = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  const identidade = (cwd) => { rodar(cwd, "config", "user.name", "teste"); rodar(cwd, "config", "user.email", "teste@example.invalid"); rodar(cwd, "config", "commit.gpgsign", "false"); rodar(cwd, "config", "core.autocrlf", "false"); };

  before(() => {
    pasta = mkdtempSync(join(tmpdir(), "publicar-dados-"));
    rodar(pasta, "init", "--bare", "-q", "--initial-branch=dados", "origem.git");
    // "semanal" é o checkout da coleta dos fundamentos; "diario" é o do workflow de 15 minutos.
    rodar(pasta, "clone", "-q", "origem.git", "semanal");
    identidade(join(pasta, "semanal"));
    writeFileSync(join(pasta, "semanal", "historico.json"), "{}\n");
    rodar(join(pasta, "semanal"), "add", "-A");
    rodar(join(pasta, "semanal"), "commit", "-q", "-m", "dados: início");
    rodar(join(pasta, "semanal"), "push", "-q", "origin", "HEAD:dados");
    rodar(pasta, "clone", "-q", "origem.git", "diario");
    identidade(join(pasta, "diario"));
  });
  after(() => { rmSync(pasta, { recursive: true, force: true }); });

  test("o push é rejeitado, o rebase traz o commit do outro, e o segundo push entra com os dois", async () => {
    // o workflow de 15 minutos grava o histórico primeiro
    writeFileSync(join(pasta, "diario", "historico.json"), '{"2026-11-13":{}}\n');
    rodar(join(pasta, "diario"), "commit", "-q", "-am", "dados: fechamento de 2026-11-13");
    rodar(join(pasta, "diario"), "push", "-q", "origin", "HEAD:dados");
    // a coleta semanal, que não viu esse commit, grava os fundamentos
    mkdirSync(join(pasta, "semanal", "fundamentos"));
    writeFileSync(join(pasta, "semanal", "fundamentos", "005410.json"), '{"cdCvm":"005410"}\n');
    const avisos = [];
    const r = await publicar({ ...base, git: git(join(pasta, "semanal")), esperar: async () => {}, log: (t) => avisos.push(t) });
    assert.deepEqual(r, { commit: true, push: true, tentativas: 2, motivo: null });
    assert.equal(avisos.length, 1);
    // na origem ficaram os dois commits, e os dois arquivos
    const historico = rodar(join(pasta, "origem.git"), "log", "--format=%s", "dados").trim().split("\n");
    assert.deepEqual(historico, ["dados: fundamentos de 2026-11-15", "dados: fechamento de 2026-11-13", "dados: início"]);
    rodar(join(pasta, "diario"), "pull", "-q", "--rebase", "origin", "dados");
    assert.equal(readFileSync(join(pasta, "diario", "fundamentos", "005410.json"), "utf8"), '{"cdCvm":"005410"}\n');
    assert.equal(readFileSync(join(pasta, "diario", "historico.json"), "utf8"), '{"2026-11-13":{}}\n');
  });

  test("execução seguinte sem mudança: nenhum commit", async () => {
    const antes = rodar(join(pasta, "origem.git"), "rev-parse", "dados");
    const r = await publicar({ ...base, git: git(join(pasta, "semanal")), esperar: async () => {} });
    assert.deepEqual(r, { commit: false, push: false, tentativas: 0, motivo: "nada mudou" });
    assert.equal(rodar(join(pasta, "origem.git"), "rev-parse", "dados"), antes);
  });
});
