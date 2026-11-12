// Guarda da execução agendada: decide se ela deve pular porque o gatilho externo (cron-job.org) já rodou.
// Roda num job separado do workflow, antes do job de atualização. Na dúvida (erro na API), não pula.
import fs from "node:fs/promises";
import { pularAgendada } from "./logica.mjs";

const { GITHUB_REPOSITORY, GITHUB_TOKEN, GITHUB_RUN_ID, GITHUB_OUTPUT } = process.env;
const JANELA_MIN = Number(process.env.GUARDA_JANELA_MIN || 12);

let decisao = { pular: false };
try {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/atualizar.yml/runs?per_page=20`, {
    headers: { accept: "application/vnd.github+json", ...(GITHUB_TOKEN ? { authorization: `Bearer ${GITHUB_TOKEN}` } : {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${r.status} na API do GitHub`);
  const { workflow_runs } = await r.json();
  decisao = pularAgendada(workflow_runs, new Date(), { janelaMin: JANELA_MIN, idAtual: Number(GITHUB_RUN_ID) });
} catch (e) {
  console.warn(`guarda: não deu para consultar as execuções (${e.message}); segue normalmente`);
}

console.log(decisao.pular ? `guarda: pulando, o gatilho externo já rodou: ${decisao.motivo}` : "guarda: nenhuma execução externa recente; segue");
if (GITHUB_OUTPUT) await fs.appendFile(GITHUB_OUTPUT, `pular=${decisao.pular}\n`);
