// Spike #29: carga no node:sqlite, consulta de base 12m (WEG) e tamanho do JSON por empresa.
// Uso: node scripts/cvm/spike/medir-sqlite.mjs <saida>/linhas.ndjson <saida>/spike.sqlite
import { DatabaseSync } from "node:sqlite";
import { createReadStream, rmSync, statSync } from "node:fs";
import { createInterface } from "node:readline";

const [ndjson, dbPath] = process.argv.slice(2);
rmSync(dbPath, { force: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
CREATE TABLE l(doc TEXT, demo TEXT, cnpj TEXT, dtRefer TEXT, ordem TEXT, dtIni TEXT, dtFim TEXT,
  escala TEXT, conta TEXT, descr TEXT, valor REAL);`);
const ins = db.prepare("INSERT INTO l VALUES (?,?,?,?,?,?,?,?,?,?,?)");

let t = Date.now(), n = 0;
db.exec("BEGIN");
for await (const s of createInterface({ input: createReadStream(ndjson), crlfDelay: Infinity })) {
  const r = JSON.parse(s);
  ins.run(r.doc, r.demo, r.cnpj, r.dtRefer, r.ordem, r.dtIni ?? null, r.dtFim, r.escala, r.conta, r.desc, r.valor);
  n++;
}
db.exec("COMMIT");
const tCarga = (Date.now() - t) / 1000;
t = Date.now();
db.exec("CREATE INDEX ix ON l(cnpj, conta, dtFim)");
const tIndice = (Date.now() - t) / 1000;

// Base 12m do lucro (3.11) da WEG no último ITR: anual + acumulado atual - acumulado do ano anterior
const WEG = "84.429.695/0001-11";
t = Date.now();
const ult = db.prepare(`SELECT max(dtRefer) d FROM l WHERE cnpj=? AND doc='itr'`).get(WEG).d;
const v = (sql, ...p) => db.prepare(sql).get(...p)?.v;
const acumAtual = v(`SELECT valor v FROM l WHERE cnpj=? AND doc='itr' AND dtRefer=? AND conta='3.11'
  AND ordem LIKE '%LTIMO' AND ordem NOT LIKE 'PEN%' AND dtIni=substr(?,1,4)||'-01-01'`, WEG, ult, ult);
const acumAnt = v(`SELECT valor v FROM l WHERE cnpj=? AND doc='itr' AND dtRefer=? AND conta='3.11'
  AND ordem LIKE 'PEN%' AND dtIni=(substr(?,1,4)-1)||'-01-01'`, WEG, ult, ult);
const anual = v(`SELECT valor v FROM l WHERE cnpj=? AND doc='dfp' AND conta='3.11' AND ordem NOT LIKE 'PEN%'
  AND dtFim=(substr(?,1,4)-1)||'-12-31'`, WEG, ult);
const tConsulta = (Date.now() - t) / 1000;

// JSON da empresa: todas as contas dos períodos "ÚLTIMO" (anual DFP + trimestral ITR)
const rows = db.prepare(`SELECT doc, demo, conta, descr, dtIni, dtFim, valor FROM l
  WHERE cnpj=? AND ordem NOT LIKE 'PEN%' AND ordem NOT LIKE 'ANTE%' ORDER BY demo, conta, dtFim`).all(WEG);
const completo = {};
for (const r of rows) {
  const k = `${r.demo}:${r.conta}`;
  (completo[k] ??= { d: r.descr, v: {} }).v[`${r.dtIni ?? ""}_${r.dtFim}`] = r.valor;
}
const CHAVE = /^(DRE:3\.(01|03|05|06|11)|BPA:1(\.01(\.01|\.02)?)?|BPP:2\.0(1|2|3)(\.0[14])?|DFC_MI:6\.0[1-3](\.\d\d)?|DVA:7\.04\.01)$/;
const enxuto = Object.fromEntries(Object.entries(completo).filter(([k]) => CHAVE.test(k)));
const tam = (o) => Buffer.byteLength(JSON.stringify(o));

console.log(JSON.stringify({
  linhas: n, tCarga, tIndice, tConsulta, dbMB: +(statSync(dbPath).size / 1e6).toFixed(1),
  weg: { ultimoItr: ult, acumAtual, acumAnt, anual, base12m: anual + acumAtual - acumAnt },
  jsonCompletoKB: +(tam(completo) / 1024).toFixed(0), contasCompleto: Object.keys(completo).length,
  jsonEnxutoKB: +(tam(enxuto) / 1024).toFixed(0), contasEnxuto: Object.keys(enxuto).length,
}, null, 2));
db.close();
