// Detecção de dado desatualizado. Funções puras: usadas pela página (app.js) e pelos testes (node:test).
//
// O workflow só roda de segunda a sexta, das 06:07 às 20:52 de Brasília. Por isso o atraso conta apenas
// o tempo dentro dessa janela: um dado de sexta às 20:52 não está "atrasado" no sábado nem às 06:05 de segunda.

// Janela de execução do workflow, em horário de Brasília.
export const JANELA = { dias: [1, 2, 3, 4, 5], inicioMin: 6 * 60, fimMin: 21 * 60 };
// Brasília não tem horário de verão desde 2019: UTC-3 fixo.
const OFFSET_BR_MS = -3 * 3600e3;
const DIA_MS = 86400e3;
// Limite para contar (60 dias de janela); acima disso o dado já está atrasado de qualquer forma.
const MAX_DIAS = 60;

// Minutos entre `desde` e `ate` que caem dentro da janela de execução.
export function minutosNaJanela(desde, ate, janela = JANELA) {
  const ini = new Date(desde).getTime() + OFFSET_BR_MS;
  const fim = new Date(ate).getTime() + OFFSET_BR_MS;
  if (!Number.isFinite(ini) || !Number.isFinite(fim) || fim <= ini) return 0;
  let total = 0;
  const primeiro = Math.floor(ini / DIA_MS);
  const ultimo = Math.min(Math.floor(fim / DIA_MS), primeiro + MAX_DIAS);
  for (let d = primeiro; d <= ultimo; d++) {
    if (!janela.dias.includes(new Date(d * DIA_MS).getUTCDay())) continue;
    const a = Math.max(ini, d * DIA_MS + janela.inicioMin * 60e3);
    const b = Math.min(fim, d * DIA_MS + janela.fimMin * 60e3);
    if (b > a) total += b - a;
  }
  return total / 60e3;
}

// O dado está atrasado se passou mais de `limiteMin` minutos de janela de execução desde `atualizado`.
export function estaAtrasado(atualizado, agora, limiteMin = 60) {
  if (!atualizado || Number.isNaN(new Date(atualizado).getTime())) return false;
  return minutosNaJanela(atualizado, agora) > limiteMin;
}

// "há 5 min · 12/11 14:07" (sempre com data e hora de Brasília).
export function textoAtualizacao(atualizado, agora) {
  const d = new Date(atualizado);
  if (!atualizado || Number.isNaN(d.getTime())) return "";
  const dataHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(d).replace(",", "");
  const min = Math.floor((new Date(agora) - d) / 60e3);
  let rel;
  if (min < 1) rel = "agora há pouco";
  else if (min < 60) rel = `há ${min} min`;
  else if (min < 48 * 60) rel = `há ${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
  else rel = `há ${Math.floor(min / 1440)} dias`;
  return `${rel} · ${dataHora}`;
}
