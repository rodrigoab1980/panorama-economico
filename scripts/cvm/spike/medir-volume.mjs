// Spike #29: filtra DFP/ITR das empresas da amostra direto dos ZIPs (via `unzip -p`) e mede volume.
// Uso: node scripts/cvm/spike/medir-volume.mjs <pasta-dos-zip> <pasta-de-saida>
// Grava <saida>/linhas.ndjson (linhas consolidadas da amostra) e <saida>/stats.json.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dirZip, dirOut] = process.argv.slice(2);
mkdirSync(dirOut, { recursive: true });

// Amostra aproximada do Ibovespa sem bancos/seguradoras (a lista oficial é a #32).
const TICKERS = `PETR4 PETR3 PRIO3 VBBR3 UGPA3 CSAN3 RECV3 BRAV3 VALE3 GGBR4 GOAU4 CSNA3 USIM5 CMIN3 BRAP4
AXIA3 ELET3 ELET6 EQTL3 SBSP3 CMIG4 ENGI11 CPFE3 EGIE3 TAEE11 NEOE3 CPLE6 CPLE3 ISAE4 TRPL4 AURE3 SAPR11 CSMG3
RADL3 LREN3 ASAI3 CRFB3 ABEV3 NTCO3 MGLU3 PETZ3 VIVA3 SMFT3 ALOS3 MULT3 IGTI11 CYRE3 MRVE3 DIRR3 CURY3 EZTC3
WEGE3 EMBJ3 EMBR3 RENT3 RAIL3 MOVI3 VAMO3 CCRO3 MOTV3 ECOR3 AZUL4 GOLL4 POMO4 TUPY3 RAPT4 LWSA3 TOTS3
SUZB3 KLBN11 DXCO3 RDOR3 HAPV3 FLRY3 ONCO3 HYPE3 VIVT3 TIMS3 JBSS3 BRFS3 MRFG3 BEEF3 SLCE3 SMTO3 YDUQ3 COGN3
CVCB3 BRKM5 UNIP6 AZZA3 ARZZ3 SOMA3 MBRF3`.split(/\s+/).filter(Boolean);

function linhas(zip, membro) {
  const p = spawn("unzip", ["-p", join(dirZip, zip), membro]);
  p.stdout.setEncoding("latin1");
  return createInterface({ input: p.stdout, crlfDelay: Infinity });
}

async function lerCsv(zip, membro, cb) {
  let cab = null, n = 0;
  for await (const l of linhas(zip, membro)) {
    const c = l.split(";");
    if (!cab) { cab = c; continue; }
    n++;
    cb(Object.fromEntries(cab.map((k, i) => [k, c[i]])));
  }
  return n;
}

// 1) ticker -> CNPJ pelo FCA valor_mobiliario (2026 para trás)
const cnpjPorTicker = {};
for (let y = 2026; y >= 2010; y--) {
  await lerCsv(`fca_cia_aberta_${y}.zip`, `fca_cia_aberta_valor_mobiliario_${y}.csv`, (r) => {
    const t = r.Codigo_Negociacao?.trim();
    if (t && TICKERS.includes(t) && !cnpjPorTicker[t]) cnpjPorTicker[t] = r.CNPJ_Companhia;
  });
}
const cnpjs = new Set(Object.values(cnpjPorTicker));
const semCnpj = TICKERS.filter((t) => !cnpjPorTicker[t]);

// 2) filtra demonstrativos
const DEMOS = ["DRE", "BPA", "BPP", "DFC_MI", "DFC_MD", "DVA"];
const stats = { tickers: TICKERS.length, cnpjs: cnpjs.size, semCnpj, cnpjPorTicker, anos: {} };
const out = createWriteStream(join(dirOut, "linhas.ndjson"));
const t0 = Date.now();

for (const [doc, ini, fim] of [["dfp", 2010, 2025], ["itr", 2011, 2026]]) {
  for (let y = ini; y <= fim; y++) {
    const zip = `${doc}_cia_aberta_${y}.zip`;
    const st = { brutas: 0, amostraTodas: 0, amostraCon: 0, finais: 0 };
    // versão mais recente por (CNPJ, DT_REFER)
    const versao = {};
    await lerCsv(zip, `${doc}_cia_aberta_${y}.csv`, (r) => {
      const k = r.CNPJ_CIA + r.DT_REFER;
      versao[k] = Math.max(versao[k] ?? 0, Number(r.VERSAO));
    });
    for (const d of DEMOS) for (const tipo of ["con", "ind"]) {
      st.brutas += await lerCsv(zip, `${doc}_cia_aberta_${d}_${tipo}_${y}.csv`, (r) => {
        if (!cnpjs.has(r.CNPJ_CIA)) return;
        st.amostraTodas++;
        if (tipo !== "con") return;
        st.amostraCon++;
        if (Number(r.VERSAO) !== versao[r.CNPJ_CIA + r.DT_REFER]) return;
        st.finais++;
        out.write(JSON.stringify({ doc, demo: d, cnpj: r.CNPJ_CIA, dtRefer: r.DT_REFER, versao: +r.VERSAO,
          ordem: r.ORDEM_EXERC, dtIni: r.DT_INI_EXERC, dtFim: r.DT_FIM_EXERC, escala: r.ESCALA_MOEDA,
          conta: r.CD_CONTA, desc: r.DS_CONTA, valor: Number(r.VL_CONTA), fixa: r.ST_CONTA_FIXA }) + "\n");
      });
    }
    stats.anos[zip] = st;
    console.log(zip, JSON.stringify(st), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
out.end();
stats.segundos = (Date.now() - t0) / 1000;
writeFileSync(join(dirOut, "stats.json"), JSON.stringify(stats, null, 2));
console.log("sem CNPJ:", semCnpj.join(" "), "| CNPJs:", cnpjs.size, "| total s:", stats.segundos);
