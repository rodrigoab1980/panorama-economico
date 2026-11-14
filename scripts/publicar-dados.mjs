// Grava na branch de dados o que a coleta dos fundamentos mudou (#37): commit só quando há mudança,
// e push com nova tentativa quando é rejeitado.
//
// Por que a nova tentativa: o workflow de 15 minutos também faz push na branch `dados`. Os arquivos são
// outros (histórico e preços), então não há conflito de conteúdo, mas o push é rejeitado se a branch
// andou entre o checkout e o push. Aí é `git pull --rebase` e push de novo, até 3 vezes, com espera.
//
// Uso: node scripts/publicar-dados.mjs <pasta do checkout> <branch> [mensagem]
// A função `publicar` recebe o `git` e a `espera` de fora, para o teste trocar os dois.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TENTATIVAS_DE_PUSH = 3;
export const ESPERA_ENTRE_TENTATIVAS_MS = 15_000;

// git(args) → { codigo, saida }. esperar(ms) → Promise.
// Devolve { commit, push, tentativas, motivo }:
//   commit      true quando havia mudança e o commit foi feito
//   push        true quando o push entrou
//   tentativas  quantos pushes foram tentados
//   motivo      por que parou sem commit ou sem push (null quando deu certo)
export async function publicar({ git, esperar, branch, mensagem, caminhos = ["."], tentativas = TENTATIVAS_DE_PUSH, espera = ESPERA_ENTRE_TENTATIVAS_MS, log = () => {} }) {
  const estado = git(["status", "--porcelain", "--", ...caminhos]);
  if (estado.codigo !== 0) return { commit: false, push: false, tentativas: 0, motivo: `git status falhou: ${estado.saida.trim()}` };
  if (estado.saida.trim() === "") return { commit: false, push: false, tentativas: 0, motivo: "nada mudou" };

  for (const args of [["add", "-A", "--", ...caminhos], ["commit", "-m", mensagem]]) {
    const r = git(args);
    if (r.codigo !== 0) return { commit: false, push: false, tentativas: 0, motivo: `git ${args[0]} falhou: ${r.saida.trim()}` };
  }
  let ultimo = "";
  for (let n = 1; n <= tentativas; n++) {
    const push = git(["push", "origin", `HEAD:${branch}`]);
    if (push.codigo === 0) return { commit: true, push: true, tentativas: n, motivo: null };
    ultimo = push.saida.trim();
    log(`push rejeitado (tentativa ${n} de ${tentativas}): ${ultimo.split("\n").at(-1)}`);
    if (n === tentativas) break;
    await esperar(espera * n);
    // Traz o que entrou na branch e põe o nosso commit por cima. Se o rebase não fecha, desfaz e para:
    // nada de forçar o push.
    const rebase = git(["pull", "--rebase", "origin", branch]);
    if (rebase.codigo !== 0) {
      git(["rebase", "--abort"]);
      return { commit: true, push: false, tentativas: n, motivo: `git pull --rebase falhou: ${rebase.saida.trim().split("\n").at(-1)}` };
    }
  }
  return { commit: true, push: false, tentativas, motivo: `push rejeitado ${tentativas} vezes: ${ultimo.split("\n").at(-1)}` };
}

// Execução direta (o caminho do repositório tem espaços: compara por caminho, não por URL).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [pasta, branch, mensagem = `dados: fundamentos de ${new Date().toISOString().slice(0, 10)}`] = process.argv.slice(2);
  if (!pasta || !branch) { console.error("uso: node scripts/publicar-dados.mjs <pasta do checkout> <branch> [mensagem]"); process.exit(2); }
  const git = (args) => {
    const r = spawnSync("git", args, { cwd: resolve(pasta), encoding: "utf8" });
    return { codigo: r.status ?? 1, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };
  // Sem checkout próprio na pasta, o git subiria até o repositório de fora: não grava nada.
  const raiz = git(["rev-parse", "--show-toplevel"]);
  const aqui = git(["rev-parse", "--show-prefix"]);
  if (raiz.codigo !== 0 || aqui.saida.trim() !== "") {
    console.warn(`aviso: ${pasta} não é a raiz de um checkout; nada gravado`);
    process.exit(0);
  }
  git(["config", "user.name", "github-actions[bot]"]);
  git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
  const r = await publicar({ git, esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)), branch, mensagem, caminhos: ["fundamentos"], log: (t) => console.warn(`aviso: ${t}`) });
  if (r.push) console.log(`publicado na branch ${branch} (${r.tentativas} tentativa${r.tentativas > 1 ? "s" : ""})`);
  else if (!r.commit && r.motivo === "nada mudou") console.log("nada mudou; nenhum commit");
  else console.warn(`aviso: não publicado: ${r.motivo}`);
  // Nunca termina com erro: uma falha aqui não pode virar alerta falso. O aviso fica no log.
}
