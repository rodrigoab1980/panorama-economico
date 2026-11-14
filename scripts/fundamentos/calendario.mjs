// Calendário anual da temporada de balanços (#77): os 12 meses do ano corrente, dia a dia, com as
// entregas feitas, as datas prováveis e os prazos legais de cada dia. Lógica pura: recebe as fichas
// (scripts/cvm/ficha.mjs) e a data de hoje, injetada. Sem disco, sem rede e sem relógio. O HTML fica
// em calendario-html.mjs.
//
// As três marcas de um dia:
//   entregues  documentos que chegaram à CVM naquele dia (a data da primeira entrega). É fato.
//   provaveis  data provável de um documento que ainda não saiu. É ESTIMATIVA, pela regra da
//              temporada (temporada.mjs): a entrega do mesmo documento no ano anterior, um ano depois.
//   prazos     prazo legal de um documento que ainda não saiu.
// A temporada estima só o próximo documento de cada companhia. O calendário segue a mesma regra adiante,
// documento a documento, enquanto a data provável ou o prazo legal cair dentro do ano: em janeiro, o
// ano inteiro já aparece.
import {
  entregaDe, levarAnos, mesDoExercicio, prazoLegal, proximoDiaDeSemana, proximoPeriodo, rotuloDoDocumento,
} from "./temporada.mjs";

export const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
// A semana começa no domingo, como num calendário de parede.
export const DIAS_DA_SEMANA = [
  { curto: "D", nome: "domingo" }, { curto: "S", nome: "segunda-feira" }, { curto: "T", nome: "terça-feira" }, { curto: "Q", nome: "quarta-feira" },
  { curto: "Q", nome: "quinta-feira" }, { curto: "S", nome: "sexta-feira" }, { curto: "S", nome: "sábado" },
];
// Quantos documentos adiante o calendário estima, no máximo, por companhia: um ano tem quatro.
export const MAXIMO_ADIANTE = 6;

const FORMA = /^(\d{4})-(\d{2})-(\d{2})$/;
const anoDe = (iso) => Number(String(iso).slice(0, 4));
const dois = (n) => String(n).padStart(2, "0");
const porTicker = (a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);

// Quantos dias tem o mês (1 a 12) do ano. Fevereiro tem 29 em ano bissexto.
export const diasDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
// O dia da semana de uma data: 0 é domingo e 6 é sábado.
export const diaDaSemana = (ano, mes, dia) => new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();

// Os eventos de cada dia do ano.
//   fichas  { TICKER: ficha } ou [ficha]
//   hoje    "AAAA-MM-DD", injetada
//   ano     o ano do calendário; sem ele, o ano de `hoje`
// Devolve { ano, hoje, dias: { "AAAA-MM-DD": { entregues, provaveis, prazos } }, totais }:
//   entregues  [{ ticker, documento }]            documento: "ITR de 30/09/2026"
//   provaveis  [{ ticker, documento, origem }]    origem: "ano-anterior" ou "prazo-legal"
//   prazos     [{ ticker, documento }]
// Só entram os dias com algum evento. Em cada lista, os tickers vêm em ordem alfabética.
export function eventosDoAno(fichas, { hoje, ano = null } = {}) {
  if (!FORMA.test(String(hoje ?? ""))) throw new Error(`data de hoje inválida: "${hoje}"`);
  const doAno = ano ?? anoDe(hoje);
  const lista = (Array.isArray(fichas) ? fichas : Object.values(fichas ?? {})).filter(Boolean);
  const dias = {};
  const marcar = (data, tipo, item) => {
    if (anoDe(data) !== doAno) return;
    (dias[data] ??= { entregues: [], provaveis: [], prazos: [] })[tipo].push(item);
  };
  for (const ficha of lista) {
    const documentos = (ficha.documentos ?? []).filter((d) => FORMA.test(String(d.dtRefer ?? "")));
    // Entregas feitas: a data da primeira entrega. A data de uma reapresentação não é a da entrega.
    for (const d of documentos) {
      const entrega = entregaDe(d);
      if (entrega && !entrega.reapresentacao) marcar(entrega.data, "entregues", { ticker: ficha.ticker, documento: rotuloDoDocumento(d.documento, d.dtRefer) });
    }
    // Os documentos que ainda não saíram, do próximo em diante.
    let referencia = ficha.documentoMaisRecente?.dtRefer;
    if (!FORMA.test(String(referencia ?? ""))) continue;
    const mes = mesDoExercicio(documentos);
    for (let i = 0; i < MAXIMO_ADIANTE; i++) {
      const { tipo, dtRefer } = proximoPeriodo(referencia, mes);
      const prazo = prazoLegal(tipo, dtRefer);
      const anterior = entregaDe(documentos.find((d) => d.documento === tipo && d.dtRefer === levarAnos(dtRefer, -1)));
      const provavel = anterior ? proximoDiaDeSemana(levarAnos(anterior.data, 1)) : prazo.data;
      if (anoDe(provavel) > doAno && anoDe(prazo.data) > doAno) break;
      const documento = rotuloDoDocumento(tipo, dtRefer);
      marcar(provavel, "provaveis", { ticker: ficha.ticker, documento, origem: anterior ? "ano-anterior" : "prazo-legal" });
      marcar(prazo.data, "prazos", { ticker: ficha.ticker, documento });
      referencia = dtRefer;
    }
  }
  const totais = { entregues: 0, provaveis: 0, prazos: 0, dias: 0 };
  const ordenados = {};
  for (const data of Object.keys(dias).sort()) {
    const d = dias[data];
    for (const tipo of ["entregues", "provaveis", "prazos"]) { d[tipo].sort(porTicker); totais[tipo] += d[tipo].length; }
    totais.dias++;
    ordenados[data] = d;
  }
  return { ano: doAno, hoje, dias: ordenados, totais };
}

// A grade de um mês: semanas de 7 posições, do domingo ao sábado. A posição fora do mês é null.
//   [[null, null, 1, 2, 3, 4, 5], [6, ...], ...]
export function semanasDoMes(ano, mes) {
  const semanas = [];
  let semana = new Array(diaDaSemana(ano, mes, 1)).fill(null);
  for (let dia = 1; dia <= diasDoMes(ano, mes); dia++) {
    semana.push(dia);
    if (semana.length === 7) { semanas.push(semana); semana = []; }
  }
  if (semana.length) semanas.push([...semana, ...new Array(7 - semana.length).fill(null)]);
  return semanas;
}

// O calendário do ano, pronto para desenhar.
//   eventos  a saída de eventosDoAno
// Devolve { ano, hoje, totais, meses: [{ mes, nome, semanas }] }, com os 12 meses. Cada posição de uma
// semana é null (fora do mês) ou { data, dia, hoje, entregues, provaveis, prazos }: o dia sem evento
// tem as três listas vazias.
export function montarCalendario(eventos) {
  const { ano, hoje } = eventos;
  const meses = MESES.map((nome, i) => {
    const mes = i + 1;
    return {
      mes, nome,
      semanas: semanasDoMes(ano, mes).map((semana) => semana.map((dia) => {
        if (dia == null) return null;
        const data = `${ano}-${dois(mes)}-${dois(dia)}`;
        const e = eventos.dias[data];
        return { data, dia, hoje: data === hoje, entregues: e?.entregues ?? [], provaveis: e?.provaveis ?? [], prazos: e?.prazos ?? [] };
      })),
    };
  });
  return { ano, hoje, totais: eventos.totais, meses };
}

// As duas etapas juntas: das fichas ao calendário do ano de `hoje`.
export const calendarioDaTemporada = (fichas, opcoes) => montarCalendario(eventosDoAno(fichas, opcoes));
