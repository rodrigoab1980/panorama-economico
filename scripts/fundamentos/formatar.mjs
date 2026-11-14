// Números e datas da página Fundamentalista, em pt-BR. Lógica pura: sem disco, sem rede e sem relógio.
// Sem valor é sempre "—", nunca 0. Negativo leva o sinal de menos (−, U+2212), e não parênteses.

export const SEM_VALOR = "—";
const MENOS = "−";

const temValor = (v) => typeof v === "number" && Number.isFinite(v);

// Número em pt-BR com `casas` casas decimais fixas: 1234.5 → "1.234,5".
export function numero(v, casas = 0) {
  if (!temValor(v)) return SEM_VALOR;
  const [inteiro, fracao] = Math.abs(v).toFixed(casas).split(".");
  const comMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const zero = Number(Math.abs(v).toFixed(casas)) === 0;
  return `${v < 0 && !zero ? MENOS : ""}${comMilhar}${fracao ? `,${fracao}` : ""}`;
}

// Abrevia um valor em unidades: { texto, sufixo } com "bi", "mi" ou "mil".
function abreviar(unidades) {
  const abs = Math.abs(unidades);
  if (abs >= 999_950_000) return { n: unidades / 1e9, casas: abs >= 99_950_000_000 ? 0 : 1, sufixo: " bi" };
  if (abs >= 999_500) return { n: unidades / 1e6, casas: abs >= 9_995_000 ? 0 : 1, sufixo: " mi" };
  if (abs >= 1_000) return { n: unidades / 1e3, casas: 0, sufixo: " mil" };
  return { n: unidades, casas: 0, sufixo: "" };
}

// Valor em R$ mil (como vem da CVM) → "R$ 40,8 bi", "R$ 532 mi", "R$ 5,3 mi", "R$ 812 mil".
export function moeda(emMil) {
  if (!temValor(emMil)) return SEM_VALOR;
  const { n, casas, sufixo } = abreviar(emMil * 1000);
  const texto = numero(Math.abs(n), casas);
  const zero = Number(Math.abs(n).toFixed(casas)) === 0;
  return `${emMil < 0 && !zero ? MENOS : ""}R$ ${texto}${sufixo}`;
}

// Razão (fração) → percentual com 1 casa: 0.1234 → "12,3%".
export function percentual(razao) {
  return temValor(razao) ? `${numero(razao * 100, 1)}%` : SEM_VALOR;
}

// Múltiplo ou razão em vezes, com 1 casa: 12.34 → "12,3x".
export function vezes(v) {
  return temValor(v) ? `${numero(v, 1)}x` : SEM_VALOR;
}

// Valor por ação, em R$ com 2 casas: 1.5197 → "R$ 1,52".
export function porAcao(v) {
  if (!temValor(v)) return SEM_VALOR;
  const zero = Number(Math.abs(v).toFixed(2)) === 0;
  return `${v < 0 && !zero ? MENOS : ""}R$ ${numero(Math.abs(v), 2)}`;
}

// Número de ações, em unidades: 4195695973 → "4,2 bi"; 236197769 → "236 mi".
export function acoes(unidades) {
  if (!temValor(unidades)) return SEM_VALOR;
  const { n, casas, sufixo } = abreviar(unidades);
  return `${numero(n, casas)}${sufixo}`;
}

// Preço de uma ação: "R$ 51,31".
export const preco = porAcao;

// Formata pelo tipo do indicador: "moeda", "pct", "vezes", "porAcao" ou "acoes".
export const FORMATOS = { moeda, pct: percentual, vezes, porAcao, acoes };
export function formatar(valor, formato) {
  const f = FORMATOS[formato];
  if (!f) throw new Error(`formato desconhecido: ${formato}`);
  return f(valor);
}

// Sinal do número, para a cor: "pos", "neg" ou "" (zero e sem valor).
export const sinal = (v) => (!temValor(v) || v === 0 ? "" : v > 0 ? "pos" : "neg");

// "2026-09-30" → "30/09/2026". O que não é data sai como "—".
export function data(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : SEM_VALOR;
}

// Data e hora como vieram escritas: "2026-11-13T18:05:49.000-0300" → "13/11/2026 18:05".
// Só a data ("2026-11-12") sai sem a hora.
export function dataHora(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(iso ?? ""));
  if (!m) return SEM_VALOR;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] ? ` ${m[4]}:${m[5]}` : ""}`;
}

// Instante (ISO com fuso, como "2026-11-14T00:57:29.000Z") no horário de Brasília: "13/11/2026 21:57".
export function instanteBR(iso) {
  const d = new Date(iso ?? NaN);
  if (Number.isNaN(d.getTime())) return SEM_VALOR;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}
