// Carimbo de dado desatualizado da ficha (#38). Lógica pura: a data de hoje entra como argumento.
//
// A ficha está desatualizada quando o documento mais recente da companhia é mais antigo do que o
// último que já deveria ter sido entregue. Os prazos da CVM:
//   ITR  45 dias depois do fim do trimestre
//   DFP  90 dias depois do fim do exercício
// Os trimestres seguem o exercício da própria companhia: quem fecha o exercício em março (São
// Martinho) tem ITR em junho, setembro e dezembro, e DFP em março.
import { data } from "./formatar.mjs";

export const PRAZO_ITR_DIAS = 45;
export const PRAZO_DFP_DIAS = 90;

const DIA = 86_400_000;
const emMs = (iso) => Date.parse(`${iso}T00:00:00Z`);
const somarDias = (iso, n) => new Date(emMs(iso) + n * DIA).toISOString().slice(0, 10);
const ultimoDiaDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10); // mes de 1 a 12
const rotulo = (tipo) => (tipo === "dfp" ? "a DFP" : "o ITR");
const rotuloDe = (tipo) => (tipo === "dfp" ? "da DFP" : "do ITR");

// Fins de trimestre da companhia até `hoje`, do mais recente para o mais antigo, cada um com o
// documento esperado e o prazo: [{ tipo, dtRefer, prazo }].
//   mesDoExercicio  mês em que o exercício social termina (12 para quase todas; 3 para a São Martinho)
export function documentosEsperados(mesDoExercicio, hoje, quantos = 8) {
  const [ano, mes] = hoje.split("-").map(Number);
  const lista = [];
  for (let a = ano, m = mes; lista.length < quantos; m--) {
    if (m === 0) { m = 12; a--; }
    if (((m - mesDoExercicio) % 3 + 3) % 3 !== 0) continue;
    const dtRefer = ultimoDiaDoMes(a, m);
    if (dtRefer > hoje) continue;
    const tipo = m === mesDoExercicio ? "dfp" : "itr";
    lista.push({ tipo, dtRefer, prazo: somarDias(dtRefer, tipo === "dfp" ? PRAZO_DFP_DIAS : PRAZO_ITR_DIAS) });
  }
  return lista;
}

// Decide o carimbo.
//   documento       o mais recente da companhia: { tipo ("dfp" | "itr"), dtRefer } ou null
//   mesDoExercicio  mês em que o exercício termina (do último exercício da série); padrão 12
//   hoje            "AAAA-MM-DD"
// Devolve { desatualizado, texto, esperado }:
//   desatualizado  true quando já venceu o prazo de um documento mais novo do que o da ficha
//   texto          a frase do carimbo (null quando está em dia)
//   esperado       { tipo, dtRefer, prazo } do documento que falta (null quando está em dia)
// No dia do prazo o documento ainda não está atrasado.
export function carimbo({ documento, mesDoExercicio = 12, hoje }) {
  if (!documento?.dtRefer) {
    return { desatualizado: true, texto: "Sem documento da CVM para esta companhia.", esperado: null };
  }
  const vencidos = documentosEsperados(mesDoExercicio, hoje).filter((d) => d.prazo < hoje);
  const esperado = vencidos[0] ?? null;
  if (!esperado || esperado.dtRefer <= documento.dtRefer) return { desatualizado: false, texto: null, esperado: null };
  return {
    desatualizado: true,
    texto: `Dados até ${rotulo(documento.tipo)} de ${data(documento.dtRefer)}. ${rotulo(esperado.tipo).replace(/^./, (c) => c.toUpperCase())} de ${data(esperado.dtRefer)} já deveria ter sido entregue (prazo ${rotuloDe(esperado.tipo)}: ${data(esperado.prazo)}).`,
    esperado,
  };
}
