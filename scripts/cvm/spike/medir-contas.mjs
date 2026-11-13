// Spike #29: análises sobre o banco gerado por medir-sqlite.mjs.
// Descrições da DFC (capex, juros, proventos, arrendamentos), cobertura da regex de capex por ano,
// reapresentações da DRE e exercício social fora de dezembro.
// Uso: node scripts/cvm/spike/medir-contas.mjs <saida>/spike.sqlite <saida>/stats.json
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

const [dbPath, statsPath] = process.argv.slice(2);
const db = new DatabaseSync(dbPath);
const tickers = {};
for (const [t, c] of Object.entries(JSON.parse(readFileSync(statsPath, "utf8")).cnpjPorTicker)) {
  tickers[c] = tickers[c] ? `${tickers[c]},${t}` : t;
}
const ATUAL = "ordem NOT LIKE 'PEN%'";

// 1) Variações de descrição na DFP 2025
const GRUPOS = {
  capex: { pref: "6.02", re: /(aquisi|adi[çc][õo]es|compra|investimento).*(imobiliz|intang|ativo.* de contrato)|^(imobilizado|intang[ií]vel)$/i },
  juros: { pref: "6.0", re: /juros.*(pag|pgto)|pag.*juros/i, nao: /capital pr[óo]prio|recebid/i },
  proventos: { pref: "6.03", re: /dividend|capital pr[óo]prio|jcp/i, nao: /recebid/i },
  arrendamento: { pref: "6.03", re: /arrendament|leasing|direito de uso/i },
};
const dfc2025 = db.prepare(`SELECT cnpj, conta, descr FROM l WHERE doc='dfp' AND dtFim LIKE '2025-%' AND ${ATUAL}
  AND demo LIKE 'DFC%' AND conta LIKE '6.0%'`).all();
console.log("## DFC 2025: empresas", new Set(dfc2025.map((r) => r.cnpj)).size);
for (const [g, { pref, re, nao }] of Object.entries(GRUPOS)) {
  const hit = dfc2025.filter((r) => r.conta.startsWith(pref) && re.test(r.descr.trim()) && !nao?.test(r.descr));
  const secoes = {};
  for (const r of hit) secoes[r.conta.slice(0, 4)] = (secoes[r.conta.slice(0, 4)] ?? 0) + 1;
  console.log(g, {
    empresas: new Set(hit.map((r) => r.cnpj)).size,
    descricoes: new Set(hit.map((r) => r.descr.trim().toLowerCase())).size,
    codigos: new Set(hit.map((r) => r.conta)).size, secoes,
  });
}

// 2) Cobertura da regex ampliada de capex, por ano
const CAPEX = /(aquisi|adi[çc]|aplica[çc]|acr[ée]scimo|aumento|investimentos? em|compra|^(no|em)\b).*(imobiliz|intang|ativo.* contrat|n[ãa]o circulante)|^(ativo )?(imobilizado|intang[ií]vel)$/i;
const NAO_CAPEX = /venda|baixa|aliena|recebi/i;
console.log("## Cobertura do capex (regex ampliada)");
for (let ano = 2011; ano <= 2025; ano += 2) {
  const rows = db.prepare(`SELECT cnpj, descr FROM l WHERE doc='dfp' AND dtFim LIKE '${ano}-%' AND ${ATUAL}
    AND demo='DFC_MI' AND conta LIKE '6.02.%'`).all();
  const todas = new Set(rows.map((r) => r.cnpj));
  const ok = new Set(rows.filter((r) => CAPEX.test(r.descr.trim()) && !NAO_CAPEX.test(r.descr)).map((r) => r.cnpj));
  const faltam = [...todas].filter((c) => !ok.has(c)).map((c) => tickers[c] ?? c);
  console.log(ano, `${ok.size}/${todas.size}`, faltam.join(" "));
}

// 3) Reapresentações: receita (3.01) e lucro (3.11) do ano X na DFP X × no PENÚLTIMO da DFP X+1
console.log("## Reapresentações na DRE");
for (const y of [2022, 2023, 2024]) {
  const r = db.prepare(`SELECT a.cnpj, a.conta, a.valor orig, b.valor reap FROM l a JOIN l b
    ON a.cnpj=b.cnpj AND a.conta=b.conta AND a.demo=b.demo AND a.dtFim=b.dtFim
    WHERE a.doc='dfp' AND b.doc='dfp' AND a.demo='DRE' AND a.conta IN ('3.01','3.11') AND a.dtFim='${y}-12-31'
      AND a.dtRefer='${y}-12-31' AND b.dtRefer='${y + 1}-12-31' AND b.ordem LIKE 'PEN%' AND a.ordem NOT LIKE 'PEN%'
      AND abs(a.valor-b.valor)>1`).all();
  console.log(y, r.map((x) => `${tickers[x.cnpj]} ${x.conta} ${x.orig}->${x.reap}`).join(" | "));
}

// 4) Exercício social fora de dezembro
const fora = db.prepare(`SELECT cnpj, group_concat(DISTINCT substr(dtFim,6)) fim FROM l
  WHERE doc='dfp' AND dtFim NOT LIKE '%-12-31' AND ${ATUAL} GROUP BY cnpj`).all();
console.log("## Exercício fora de dezembro", fora.map((r) => `${tickers[r.cnpj]} (${r.fim})`).join(" "));
