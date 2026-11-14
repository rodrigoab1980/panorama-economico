// Temporada de balanços (#68): a sequência dos períodos, o prazo legal, a data provável, a situação,
// a página e o card da ficha. A data de hoje é sempre injetada.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  PRAZO_DFP_MESES, PRAZO_ITR_DIAS, levarAnos, mesDoExercicio, montarTemporada, prazoLegal, proximoDiaDeSemana, proximoPeriodo,
  rotuloDoDocumento, segundaDaSemana, situacaoDoProximo, somarDias, somarMeses, temporadaDaCompanhia,
} from "../scripts/fundamentos/temporada.mjs";
import {
  LEGENDA_DA_TEMPORADA, MARCADOR_DA_TEMPORADA, REGRA_DA_TEMPORADA, cardDaTemporadaHtml, inserirTemporada, temporadaHtml,
} from "../scripts/fundamentos/temporada-html.mjs";
import { fichaHtml } from "../scripts/fundamentos/pagina.mjs";
import { painelHtml } from "../scripts/fundamentos/painel-html.mjs";
import { montarPainel } from "../scripts/fundamentos/painel.mjs";
import { criarExtrator, montarCompanhia } from "../scripts/cvm/coleta.mjs";
import { dadosAte } from "../scripts/cvm/ficha.mjs";
import { HOJE, fichaDaWeg } from "./apoio/ficha.mjs";

// ---------- fichas de teste ----------
const LINK = "http://www.rad.cvm.gov.br/ENETCONSULTA/frmDownloadDocumento.aspx?CodigoInstituicao=1&NumeroSequencialDocumento=";
// Um documento: doc("itr", "2026-09-30", "2026-11-04"). `extra` muda a versão ou a data da versão mais nova.
const doc = (documento, dtRefer, primeiraEntrega, extra = {}) => ({ documento, dtRefer, versao: 1, recebidoEm: primeiraEntrega, primeiraEntrega, link: `${LINK}${dtRefer.replaceAll("-", "")}`, ...extra });
// Uma ficha só com o que a temporada lê. O documento mais recente é o de maior data.
function cia(ticker, documentos, extra = {}) {
  const u = [...documentos].sort((a, b) => (a.dtRefer < b.dtRefer ? -1 : 1)).at(-1);
  return { ticker, nome: `${ticker} Companhia S.A.`, documentoMaisRecente: u ? { tipo: u.documento, dtRefer: u.dtRefer, versao: u.versao } : null, documentos, ...extra };
}
// Os documentos de um ano e meio, com o ITR de 30/09/2026 entregue (ou não).
const ANO_ANTERIOR = [doc("itr", "2025-06-30", "2025-08-06"), doc("itr", "2025-09-30", "2025-11-05"), doc("dfp", "2025-12-31", "2026-02-26"), doc("itr", "2026-03-31", "2026-05-06"), doc("itr", "2026-06-30", "2026-08-05")];
const jaEntregou = (ticker, em = "2026-11-04") => cia(ticker, [...ANO_ANTERIOR, doc("itr", "2026-09-30", em)]);
const aindaNao = (ticker, docs = ANO_ANTERIOR) => cia(ticker, docs);
// A lista do ano anterior com outra data de entrega do ITR de 30/09/2025.
const comItrDe2025Em = (data, extra = {}) => ANO_ANTERIOR.map((d) => (d.dtRefer === "2025-09-30" ? doc("itr", "2025-09-30", data, extra) : d));

// ---------- datas ----------
describe("temporada: contas de data, sem relógio", () => {
  test("somar dias e meses atravessa mês e ano; o dia que não existe vira o último do mês", () => {
    assert.equal(somarDias("2026-09-30", 45), "2026-11-14");
    assert.equal(somarDias("2026-12-31", 1), "2027-01-01");
    assert.equal(somarMeses("2026-12-31", 3), "2027-03-31");
    assert.equal(somarMeses("2026-12-31", 2), "2027-02-28");
    assert.equal(somarMeses("2026-03-31", -3), "2025-12-31");
    assert.equal(somarMeses("2026-06-30", 3, { fimDoMes: true }), "2026-09-30");
    assert.equal(somarMeses("2026-09-30", 3, { fimDoMes: true }), "2026-12-31");
  });

  test("29/02 levado para um ano que não é bissexto vira 28/02; para outro bissexto, continua 29/02", () => {
    assert.equal(levarAnos("2024-02-29", 1), "2025-02-28");
    assert.equal(levarAnos("2024-02-29", 4), "2028-02-29");
    assert.equal(levarAnos("2027-03-31", -1), "2026-03-31");
  });

  test("sábado e domingo passam para a segunda-feira; dia de semana fica", () => {
    assert.equal(proximoDiaDeSemana("2026-11-14"), "2026-11-16"); // sábado
    assert.equal(proximoDiaDeSemana("2026-11-15"), "2026-11-16"); // domingo
    assert.equal(proximoDiaDeSemana("2026-11-16"), "2026-11-16"); // segunda
    assert.equal(proximoDiaDeSemana("2026-11-13"), "2026-11-13"); // sexta
  });

  test("a segunda-feira da semana", () => {
    assert.equal(segundaDaSemana("2026-11-16"), "2026-11-16");
    assert.equal(segundaDaSemana("2026-11-20"), "2026-11-16");
    assert.equal(segundaDaSemana("2026-11-15"), "2026-11-09"); // o domingo fecha a semana anterior
  });
});

// ---------- sequência e prazo ----------
describe("temporada: sequência dos períodos e prazo legal", () => {
  test("31/03 → 30/06 → 30/09 → DFP de 31/12 → 31/03 do ano seguinte", () => {
    assert.deepEqual(proximoPeriodo("2026-03-31"), { tipo: "itr", dtRefer: "2026-06-30" });
    assert.deepEqual(proximoPeriodo("2026-06-30"), { tipo: "itr", dtRefer: "2026-09-30" });
    assert.deepEqual(proximoPeriodo("2026-09-30"), { tipo: "dfp", dtRefer: "2026-12-31" });
    assert.deepEqual(proximoPeriodo("2026-12-31"), { tipo: "itr", dtRefer: "2027-03-31" });
  });

  test("exercício que termina em março: a DFP é a de 31/03, e dezembro é ITR", () => {
    assert.equal(mesDoExercicio([doc("dfp", "2025-03-31", "2025-05-30"), doc("itr", "2025-06-30", "2025-08-10")]), 3);
    assert.deepEqual(proximoPeriodo("2025-12-31", 3), { tipo: "dfp", dtRefer: "2026-03-31" });
    assert.deepEqual(proximoPeriodo("2025-09-30", 3), { tipo: "itr", dtRefer: "2025-12-31" });
    assert.equal(mesDoExercicio([]), 12);
  });

  test("as regras são constantes: ITR em 45 dias, DFP em 3 meses", () => {
    assert.equal(PRAZO_ITR_DIAS, 45);
    assert.equal(PRAZO_DFP_MESES, 3);
    assert.deepEqual(prazoLegal("dfp", "2026-12-31"), { data: "2027-03-31", corrido: "2027-03-31" });
    assert.deepEqual(prazoLegal("itr", "2027-03-31"), { data: "2027-05-17", corrido: "2027-05-15" }); // 15/05/2027 é sábado
    assert.deepEqual(prazoLegal("itr", "2026-06-30"), { data: "2026-08-14", corrido: "2026-08-14" });
  });

  test("prazo que cai no sábado passa para a segunda: o ITR de 30/09/2026 vence em 16/11", () => {
    assert.deepEqual(prazoLegal("itr", "2026-09-30"), { data: "2026-11-16", corrido: "2026-11-14" });
  });

  test("rótulos: a DFP pelo ano (ou mês/ano fora de dezembro) e o ITR pela data", () => {
    assert.equal(rotuloDoDocumento("dfp", "2026-12-31"), "DFP de 2026");
    assert.equal(rotuloDoDocumento("dfp", "2027-03-31"), "DFP de 03/2027");
    assert.equal(rotuloDoDocumento("itr", "2026-09-30"), "ITR de 30/09/2026");
  });
});

// ---------- uma companhia ----------
describe("temporada: o próximo documento de uma companhia", () => {
  test("último entregue, próximo, prazo legal e a data provável pela entrega do ano anterior", () => {
    const t = temporadaDaCompanhia(jaEntregou("AAAA3"), "2026-11-14");
    assert.deepEqual(t.ultimo, { tipo: "itr", dtRefer: "2026-09-30", rotulo: "ITR de 30/09/2026", entregueEm: "2026-11-04", reapresentadoEm: null, versao: 1, link: `${LINK}20260930` });
    assert.equal(t.proximo.rotulo, "DFP de 2026");
    assert.equal(t.proximo.prazoLegal, "2027-03-31");
    assert.equal(t.proximo.dataProvavel, "2027-02-26"); // 26/02/2026 → 26/02/2027, sexta
    assert.equal(t.proximo.estimada, true);
    assert.deepEqual(t.proximo.origem, {
      tipo: "ano-anterior", documento: "DFP de 2025", entregueEm: "2026-02-26", reapresentacao: false,
      texto: "estimada pela entrega do ano anterior (DFP de 2025, em 26/02/2026)",
    });
    assert.deepEqual(t.proximo.situacao, { id: "previsto", texto: "previsto para 26/02" });
    assert.deepEqual(t.observacoes, []);
    assert.equal(t.nomeCurto, "AAAA3 Companhia");
  });

  test("data provável em fim de semana vai para a segunda-feira", () => {
    // 07/11/2025 é sexta; um ano depois, 07/11/2026 é sábado
    assert.equal(temporadaDaCompanhia(aindaNao("AAAA3", comItrDe2025Em("2025-11-07")), "2026-11-01").proximo.dataProvavel, "2026-11-09");
    // 08/11/2026 é domingo
    assert.equal(temporadaDaCompanhia(aindaNao("AAAA3", comItrDe2025Em("2025-11-08")), "2026-11-01").proximo.dataProvavel, "2026-11-09");
  });

  test("sem o documento do ano anterior: a data provável é o prazo legal, e a origem diz", () => {
    const t = temporadaDaCompanhia(aindaNao("NOVA3", [doc("itr", "2026-03-31", "2026-05-06"), doc("itr", "2026-06-30", "2026-08-05")]), "2026-11-01");
    assert.equal(t.proximo.rotulo, "ITR de 30/09/2026");
    assert.equal(t.proximo.dataProvavel, "2026-11-16");
    assert.equal(t.proximo.dataProvavel, t.proximo.prazoLegal);
    assert.deepEqual(t.proximo.origem, { tipo: "prazo-legal", motivo: "sem o ITR de 30/09/2025 na coleta", texto: "prazo legal" });
  });

  test("entrega do ano anterior em 29/02: a data provável sai de 28/02", () => {
    const t = temporadaDaCompanhia(cia("AAAA3", [doc("dfp", "2023-12-31", "2024-02-29"), doc("itr", "2024-09-30", "2024-11-05")]), "2024-12-01");
    assert.equal(t.proximo.rotulo, "DFP de 2024");
    assert.equal(t.proximo.dataProvavel, "2025-02-28"); // sexta
  });

  test("documento reapresentado: vale a data da primeira entrega, não a da versão mais nova", () => {
    const docs = comItrDe2025Em("2025-10-23", { versao: 2, recebidoEm: "2025-12-10" });
    const t = temporadaDaCompanhia(aindaNao("AAAA3", docs), "2026-10-01");
    assert.equal(t.proximo.dataProvavel, "2026-10-23");
    assert.equal(t.proximo.origem.reapresentacao, false);
  });

  test("coleta antiga, sem a data da primeira entrega: vale a da reapresentação, e o texto avisa", () => {
    const docs = comItrDe2025Em(null, { versao: 2, recebidoEm: "2025-11-12" });
    const t = temporadaDaCompanhia(aindaNao("AAAA3", docs), "2026-10-01");
    assert.equal(t.proximo.dataProvavel, "2026-11-12");
    assert.equal(t.proximo.origem.texto, "estimada pela reapresentação do ano anterior (ITR de 30/09/2025, versão 2, em 12/11/2025)");
    // no último entregue, a data da reapresentação não se passa por data de entrega
    const u = temporadaDaCompanhia(cia("AAAA3", [doc("itr", "2026-09-30", null, { versao: 2, recebidoEm: "2026-11-10" })]), "2026-11-14").ultimo;
    assert.equal(u.entregueEm, null);
    assert.equal(u.reapresentadoEm, "2026-11-10");
  });

  test("ano com entrega depois do prazo: a data provável segue o ano anterior, e o prazo legal aparece ao lado", () => {
    const docs = [...ANO_ANTERIOR.filter((d) => d.dtRefer !== "2025-12-31"), doc("dfp", "2025-12-31", "2026-04-08"), doc("itr", "2026-09-30", "2026-11-04")];
    const p = temporadaDaCompanhia(cia("AAAA3", docs), "2026-11-14").proximo;
    assert.equal(p.dataProvavel, "2027-04-08");
    assert.equal(p.prazoLegal, "2027-03-31");
  });

  test("exercício que mudou de mês: a sequência segue a DFP mais recente, e o motivo aparece", () => {
    const docs = [doc("dfp", "2024-03-31", "2024-05-29"), doc("dfp", "2024-12-31", "2025-03-10"), doc("itr", "2025-09-30", "2025-11-14"), doc("dfp", "2025-12-31", "2026-03-09"), doc("itr", "2026-09-30", "2026-11-13")];
    const mudou = temporadaDaCompanhia(cia("MUDA3", docs.slice(0, 2)), "2025-04-01");
    assert.deepEqual(mudou.observacoes, ["o exercício social mudou de mês (DFP de 03/2024 e DFP de 2024): a sequência segue a DFP mais recente"]);
    assert.equal(mudou.proximo.rotulo, "ITR de 31/03/2025");
    assert.equal(mudou.proximo.origem.tipo, "prazo-legal");
    // dois anos depois da mudança, a observação some
    assert.deepEqual(temporadaDaCompanhia(cia("MUDA3", docs), "2026-11-14").observacoes, []);
  });

  test("exercício de transição (diferente de 12 meses): a regra não quebra, e o motivo aparece", () => {
    const f = jaEntregou("TRAN3");
    f.anual = [{ fim: "2025-12-31", tipo: "transicao", meses: 9 }];
    const t = temporadaDaCompanhia(f, "2026-11-14");
    assert.equal(t.proximo.rotulo, "DFP de 2026");
    assert.deepEqual(t.observacoes, ["o último exercício é de transição, com 9 meses: a data do ano anterior pode não servir de referência"]);
  });

  test("mudança de base (consolidado × individual) não muda a data: ela vem da entrega, não das contas", () => {
    const a = jaEntregou("BASE3");
    const b = { ...jaEntregou("BASE3"), doze: { acumulado: { atual: { consolidado: true }, anterior: { consolidado: false } } } };
    assert.deepEqual(temporadaDaCompanhia(b, "2026-11-14"), temporadaDaCompanhia(a, "2026-11-14"));
  });

  test("companhia sem documento: sem próximo, com o motivo; ficha sem a lista de documentos não quebra", () => {
    const t = temporadaDaCompanhia(cia("VAZI3", []), "2026-11-14");
    assert.equal(t.ultimo, null);
    assert.equal(t.proximo, null);
    assert.deepEqual(t.observacoes, ["sem documento coletado"]);
    const semLista = temporadaDaCompanhia({ ticker: "ANTI3", nome: "Antiga S.A.", documentoMaisRecente: { tipo: "itr", dtRefer: "2026-09-30", versao: 1 } }, "2026-11-14");
    assert.equal(semLista.ultimo.entregueEm, null);
    assert.equal(semLista.proximo.origem.tipo, "prazo-legal");
  });

  test("determinístico: a mesma ficha e a mesma data dão o mesmo resultado, e a data de hoje é obrigatória", () => {
    const f = aindaNao("AAAA3");
    assert.deepEqual(temporadaDaCompanhia(f, "2026-11-01"), temporadaDaCompanhia(structuredClone(f), "2026-11-01"));
    assert.throws(() => temporadaDaCompanhia(f), /data de hoje inválida/);
    assert.throws(() => montarTemporada([f], {}), /data de hoje inválida/);
  });
});

// ---------- situação ----------
describe("temporada: situação do próximo documento", () => {
  // ITR de 30/09/2026: no ano anterior saiu em 05/11/2025; a data provável é 05/11/2026 e o prazo, 16/11.
  const situacao = (hoje, dadosAte = null) => temporadaDaCompanhia(aindaNao("AAAA3"), hoje, { dadosAte }).proximo.situacao;

  test("antes da data provável, e no dia dela: previsto", () => {
    assert.deepEqual(situacao("2026-11-01"), { id: "previsto", texto: "previsto para 05/11" });
    assert.deepEqual(situacao("2026-11-05"), { id: "previsto", texto: "previsto para 05/11" });
  });

  test("depois da data provável e antes do prazo legal: ainda não entregou, com a data do ano anterior", () => {
    assert.deepEqual(situacao("2026-11-10"), { id: "aguardando", texto: "ainda não entregou; no ano anterior entregou em 05/11" });
    // no dia do prazo legal ele ainda não venceu
    assert.equal(situacao("2026-11-16").id, "aguardando");
  });

  test("depois do prazo legal: prazo legal vencido, que é fato", () => {
    assert.deepEqual(situacao("2026-11-17"), { id: "vencido", texto: "prazo legal vencido em 16/11" });
  });

  test("nenhuma situação fala em atraso", () => {
    for (const hoje of ["2026-11-01", "2026-11-10", "2026-11-17", "2027-01-10"]) assert.ok(!/atras/i.test(situacao(hoje).texto), hoje);
  });

  test("a data passou depois da última atualização dos dados: a página não afirma que a empresa não entregou", () => {
    // dados de 08/11 (domingo), hoje 14/11: quem tinha a data provável em 05/11 não entregou até os dados
    assert.equal(situacao("2026-11-14", "2026-11-08").id, "aguardando");
    // quem tinha a data provável em 12/11 pode ter entregado depois dos dados
    const depois = temporadaDaCompanhia(aindaNao("AAAA3", comItrDe2025Em("2025-11-12")), "2026-11-14", { dadosAte: "2026-11-08" }).proximo.situacao;
    assert.deepEqual(depois, { id: "sem-coleta", texto: "data provável em 12/11, depois da última atualização dos dados (08/11)" });
    // prazo legal vencido só é fato quando os dados são posteriores a ele
    assert.deepEqual(situacao("2026-11-20", "2026-11-15"), { id: "sem-coleta", texto: "prazo legal em 16/11, depois da última atualização dos dados (15/11)" });
    assert.equal(situacao("2026-11-25", "2026-11-22").id, "vencido");
  });

  test("origem no prazo legal: sem a frase do ano anterior", () => {
    const origem = { tipo: "prazo-legal", motivo: "sem o ITR", texto: "prazo legal" };
    const prazo = { data: "2026-11-16", corrido: "2026-11-14" };
    assert.equal(situacaoDoProximo({ dataProvavel: "2026-11-16", prazo, origem, hoje: "2026-11-16" }).id, "previsto");
    assert.equal(situacaoDoProximo({ dataProvavel: "2026-11-16", prazo, origem, hoje: "2026-11-17" }).id, "vencido");
  });
});

// ---------- a temporada inteira ----------
describe("temporada: todas as companhias", () => {
  const FICHAS = [
    jaEntregou("ENTR3", "2026-10-21"), jaEntregou("ENTR4", "2026-11-04"), jaEntregou("ENTR5", "2026-10-21"),
    aindaNao("FALT3"), // data provável 05/11
    aindaNao("FALT4", comItrDe2025Em("2025-11-12")), // 12/11
    aindaNao("FALT5", ANO_ANTERIOR.filter((d) => d.dtRefer !== "2025-09-30")), // prazo legal, 16/11
    aindaNao("FALT6"), // 05/11, empata com FALT3
  ];
  const T = montarTemporada(FICHAS, { hoje: "2026-11-14", dadosAte: "2026-11-08", semFicha: [{ ticker: "SEMF3", nome: "Sem Ficha S.A.", motivo: "sem dados coletados" }] });

  test("o progresso é o mesmo do painel da página inicial", () => {
    const painel = montarPainel(FICHAS, { total: 8 });
    assert.equal(T.referencia.documento, "ITR de 30/09/2026");
    assert.deepEqual(T.referencia, painel.referencia);
    assert.equal(T.entregaram, painel.entregaram);
    assert.equal(T.total, painel.total);
    assert.equal(T.entregaram, 3);
    assert.equal(T.total, 8);
  });

  test("quem falta vem pela data provável, a mais próxima primeiro; no empate, o ticker", () => {
    assert.deepEqual(T.faltam.map((i) => [i.ticker, i.proximo.dataProvavel]), [["FALT3", "2026-11-05"], ["FALT6", "2026-11-05"], ["FALT4", "2026-11-12"], ["FALT5", "2026-11-16"]]);
    assert.deepEqual(T.semanas, [{ segunda: "2026-11-02", tickers: ["FALT3", "FALT6"] }, { segunda: "2026-11-09", tickers: ["FALT4"] }, { segunda: "2026-11-16", tickers: ["FALT5"] }]);
  });

  test("quem entregou vem pela data de entrega, da mais recente para a mais antiga", () => {
    assert.deepEqual(T.entregues.map((i) => [i.ticker, i.ultimo.entregueEm]), [["ENTR4", "2026-11-04"], ["ENTR3", "2026-10-21"], ["ENTR5", "2026-10-21"]]);
  });

  test("leva a data de hoje, a dos dados, as regras e as companhias sem ficha", () => {
    assert.equal(T.hoje, "2026-11-14");
    assert.equal(T.dadosAte, "2026-11-08");
    assert.deepEqual(T.regras, { prazoItrDias: 45, prazoDfpMeses: 3, fimDeSemana: "passa para a segunda-feira", feriados: "não entram na conta" });
    assert.deepEqual(T.semFicha, [{ ticker: "SEMF3", nome: "Sem Ficha S.A.", motivo: "sem dados coletados" }]);
  });

  test("sem nenhum documento: null; a data de hoje muda só a situação", () => {
    assert.equal(montarTemporada([], { hoje: "2026-11-14" }), null);
    assert.equal(montarTemporada([cia("VAZI3", [])], { hoje: "2026-11-14" }), null);
    const antes = montarTemporada(FICHAS, { hoje: "2026-11-01" });
    assert.deepEqual(antes.faltam.map((i) => i.proximo.dataProvavel), T.faltam.map((i) => i.proximo.dataProvavel));
    assert.ok(antes.faltam.every((i) => i.proximo.situacao.id === "previsto"));
  });

  test("temporada da DFP: a referência é o exercício, e o próximo de quem entregou é o ITR de 31/03", () => {
    const comDfp = cia("DFPA3", [doc("itr", "2026-03-31", "2026-05-06"), doc("itr", "2026-09-30", "2026-11-04"), doc("dfp", "2026-12-31", "2027-02-25")]);
    const t = montarTemporada([comDfp, jaEntregou("ITRA3")], { hoje: "2027-03-01" });
    assert.equal(t.referencia.documento, "DFP de 31/12/2026");
    assert.deepEqual(t.entregues.map((i) => [i.ticker, i.proximo.rotulo, i.proximo.dataProvavel]), [["DFPA3", "ITR de 31/03/2027", "2027-05-06"]]);
    assert.deepEqual(t.faltam.map((i) => [i.ticker, i.proximo.rotulo]), [["ITRA3", "DFP de 2026"]]);
  });

  // ---------- HTML da página ----------
  const HTML = temporadaHtml(T, { comPagina: new Set(FICHAS.map((f) => f.ticker).filter((t) => t !== "FALT6")) });

  test("topo: a temporada, o progresso, a data dos dados e a legenda da estimativa", () => {
    assert.match(HTML, /<h2 id="t-temporada">Temporada do 3T26<\/h2>/);
    assert.match(HTML, /<strong class="n">3 de 8<\/strong> já entregaram o ITR de 30\/09\/2026/);
    assert.match(HTML, /dados da CVM de 08\/11\/2026, atualizados uma vez por semana; entregas depois dessa data ainda não aparecem/);
    assert.ok(HTML.includes(LEGENDA_DA_TEMPORADA));
    assert.match(LEGENDA_DA_TEMPORADA, /estimativa deste site, não uma data oficial/);
  });

  test("próximas entregas: por semana, com ticker, nome curto, data provável, origem, prazo legal e situação", () => {
    assert.match(HTML, /<h3 id="t-proximas">Próximas entregas <small>5<\/small><\/h3>/);
    assert.deepEqual([...HTML.matchAll(/<h4>Semana de (\d\d\/\d\d) <small>(\d+)<\/small><\/h4>/g)].map((m) => [m[1], m[2]]), [["02/11", "2"], ["09/11", "1"], ["16/11", "1"]]);
    assert.match(HTML, /<li class="entrega aguardando"><strong class="entrega-ticker"><a href="\.\.\/falt3\/">FALT3<\/a><\/strong><span class="entrega-nome">FALT3 Companhia<\/span>/);
    assert.match(HTML, /<small>ITR de 30\/09\/2026, data provável<\/small> <b class="n">05\/11\/2026<\/b>/);
    assert.match(HTML, /Estimada pela entrega do ano anterior \(ITR de 30\/09\/2025, em 05\/11\/2025\)\. Prazo legal: <span class="n">16\/11\/2026<\/span>\./);
    assert.match(HTML, /Ainda não entregou; no ano anterior entregou em 05\/11/);
    assert.match(HTML, /Data provável em 12\/11, depois da última atualização dos dados \(08\/11\)/);
    assert.match(HTML, /Prazo legal: sem o ITR de 30\/09\/2025 na coleta\. Prazo legal: <span class="n">16\/11\/2026<\/span>\./);
    assert.ok(HTML.includes(REGRA_DA_TEMPORADA));
    assert.match(REGRA_DA_TEMPORADA, /45 dias.*3 meses.*feriado não entra na conta/);
  });

  test("a data nunca aparece sem dizer que é provável, e a origem vem junto em toda linha", () => {
    const linhas = HTML.split('<li class="entrega ').slice(1).filter((l) => !l.startsWith("entregue"));
    assert.equal(linhas.length, 4);
    for (const l of linhas) {
      assert.match(l, /data provável/);
      assert.match(l, /Estimada pela entrega do ano anterior|Prazo legal: sem/);
      assert.match(l, /Prazo legal: <span/);
    }
    assert.ok(!/data do balanço/i.test(HTML));
    assert.ok(!/data oficial/i.test(HTML.replace(LEGENDA_DA_TEMPORADA, "")));
  });

  test("já entregaram: a data de entrega, o link do documento na CVM e o próximo documento", () => {
    assert.match(HTML, /<h3 id="t-entregues">Já entregaram <small>3<\/small><\/h3>/);
    assert.match(HTML, /<a href="\.\.\/entr4\/">ENTR4<\/a>.*?<small>entregue em<\/small> <b class="n">04\/11\/2026<\/b>/);
    assert.match(HTML, /<a href="http:\/\/www\.rad\.cvm\.gov\.br\/[^"]+NumeroSequencialDocumento=20260930" rel="noopener external">ITR de 30\/09\/2026 na CVM<\/a>/);
    assert.match(HTML, /Próximo: DFP de 2026, data provável <span class="n">26\/02\/2027<\/span> \(estimada pela entrega do ano anterior \(DFP de 2025, em 26\/02\/2026\); prazo legal 31\/03\/2027\)\./);
    assert.ok(HTML.indexOf("ENTR4") < HTML.indexOf("ENTR3") && HTML.indexOf("ENTR3") < HTML.indexOf("ENTR5"));
  });

  test("ticker sem página fica sem link; companhia sem ficha aparece com o motivo", () => {
    assert.match(HTML, /<strong class="entrega-ticker">FALT6<\/strong>/);
    assert.match(HTML, /Sem ficha, e por isso sem data: SEMF3 \(sem dados coletados\)\./);
  });

  test("links internos relativos, HTML estático e nenhuma palavra de julgamento ou de recomendação", () => {
    for (const m of HTML.matchAll(/href="([^"]+)"/g)) assert.ok(/^\.\.\/[a-z0-9]+\/$/.test(m[1]) || m[1].startsWith("http://www.rad.cvm.gov.br/"), m[1]);
    assert.ok(!/<script/i.test(HTML));
    assert.ok(!/atras|compre|venda|recomend|preço-alvo|oportunidade/i.test(HTML));
  });

  test("texto vindo de dado é escapado; link que não é http(s) não entra", () => {
    const f = jaEntregou("XSSA3");
    f.nome = "<b>Má</b> & Cia S.A.";
    f.documentos.at(-1).link = "javascript:alert(1)";
    const html = temporadaHtml(montarTemporada([f], { hoje: "2026-11-14" }));
    assert.match(html, /&lt;b&gt;Má&lt;\/b&gt; &amp; Cia/);
    assert.ok(!html.includes("<b>Má</b>") && !html.includes("javascript:"));
  });

  test("todas entregaram: a lista de próximas diz isso; sem dados: o aviso da coleta", () => {
    const todas = temporadaHtml(montarTemporada([jaEntregou("AAAA3")], { hoje: "2026-11-14" }));
    assert.match(todas, /Todas as empresas já entregaram o ITR de 30\/09\/2026\./);
    const vazia = temporadaHtml(null);
    assert.match(vazia, /<h2>Temporada de balanços<\/h2>/);
    assert.match(vazia, /ainda não foram coletados/);
  });

  test("inserirTemporada exige exatamente um marcador", () => {
    assert.equal(inserirTemporada(`<main>${MARCADOR_DA_TEMPORADA}</main>`, "<p>x</p>"), "<main><p>x</p></main>");
    assert.throws(() => inserirTemporada("<main></main>", "x"), /exatamente um/);
  });
});

// ---------- card da ficha e painel ----------
describe("temporada: card da ficha e link no painel", () => {
  test("WEG (fixture): próximo balanço DFP de 2026, data provável 25/02/2027, com a origem e o prazo legal", () => {
    const html = fichaHtml(fichaDaWeg(), { hoje: HOJE, dadosAte: "2026-11-08" });
    assert.match(html, /<aside class="proximo-balanco" aria-label="Próximo balanço"><p><span class="proximo-rotulo">Próximo balanço<\/span> <strong>DFP de 2026<\/strong>, data provável <strong class="n">25\/02\/2027<\/strong> <span class="proximo-origem">\(estimada pela entrega do ano anterior \(DFP de 2025, em 25\/02\/2026\); prazo legal 31\/03\/2027\)<\/span><\/p>/);
    assert.match(html, /Previsto para 25\/02\. Último entregue: <a href="[^"]+" rel="noopener external" title="ITR de 30\/09\/2026, na CVM">ITR de 30\/09\/2026<\/a>, em 21\/10\/2026\./);
    assert.match(html, /<a href="\.\.\/temporada\/">Temporada de balanços<\/a>/);
  });

  test("o card fica no cabeçalho da ficha, depois da régua de anos e antes do resumo", () => {
    const html = fichaHtml(fichaDaWeg(), { hoje: HOJE });
    const card = html.indexOf('<aside class="proximo-balanco"');
    assert.ok(card > html.indexOf('<figure class="regua">') && card < html.indexOf('id="resumo-consistencia"'));
  });

  test("ficha sem a lista de documentos (dado antigo): sem card, e a página sai", () => {
    const html = fichaHtml(fichaDaWeg({ mudar: (f) => { delete f.documentos; } }), { hoje: HOJE });
    assert.ok(!html.includes("proximo-balanco"));
    assert.equal(cardDaTemporadaHtml(temporadaDaCompanhia(cia("VAZI3", []), HOJE)), "");
  });

  test("sem o documento do ano anterior, o card diz prazo legal e o motivo; as observações aparecem", () => {
    const f = aindaNao("NOVA3", [doc("dfp", "2025-03-31", "2025-05-29"), doc("dfp", "2025-12-31", "2026-03-09"), doc("itr", "2026-06-30", "2026-08-05")]);
    const card = cardDaTemporadaHtml(temporadaDaCompanhia(f, "2026-11-01"));
    assert.match(card, /<strong>ITR de 30\/09\/2026<\/strong>, data provável <strong class="n">16\/11\/2026<\/strong> <span class="proximo-origem">\(prazo legal: sem o ITR de 30\/09\/2025 na coleta; prazo legal 16\/11\/2026\)/);
    assert.match(card, /<small class="proximo-obs">O exercício social mudou de mês/);
  });

  test("o painel da página inicial ganha o link para a temporada", () => {
    const html = painelHtml(montarPainel([jaEntregou("AAAA3"), aindaNao("BBBB3")], { total: 2 }));
    assert.match(html, /<p class="painel-link"><a href="temporada\/">Temporada de balanços<\/a>/);
  });
});

// ---------- até que dia vão os dados ----------
describe("dadosAte: a atualização mais recente dos arquivos da CVM", () => {
  test("o Last-Modified mais recente entre os ZIPs que deram certo, no dia de Brasília", () => {
    const indice = { coletadoEm: "2026-11-14T01:50:51.926Z", arquivos: {
      "dfp_cia_aberta_2025.zip": { lastModified: "Sun, 01 Nov 2026 10:19:22 GMT", status: "ok" },
      "itr_cia_aberta_2026.zip": { lastModified: "Sun, 08 Nov 2026 10:44:33 GMT", status: "ok" },
      "dfp_cia_aberta_2026.zip": { lastModified: "Sun, 15 Nov 2026 10:14:22 GMT", status: "falhou" },
    } };
    // a coleta rodou em 13/11, mas os dados vão até 08/11
    assert.equal(dadosAte(indice), "2026-11-08");
    // 01:00 GMT ainda é o dia anterior em Brasília
    assert.equal(dadosAte({ arquivos: { "a.zip": { lastModified: "Mon, 09 Nov 2026 01:00:00 GMT", status: "ok" } } }), "2026-11-08");
  });

  test("sem índice, sem arquivos ou sem data legível: null", () => {
    assert.equal(dadosAte(null), null);
    assert.equal(dadosAte({ arquivos: {} }), null);
    assert.equal(dadosAte({ arquivos: { "a.zip": { lastModified: null, status: "ok" } } }), null);
  });
});

// ---------- coleta: a data da primeira entrega ----------
describe("coleta: a data da primeira entrega de cada documento", () => {
  const CIA = { cnpj: "84.429.695/0001-11", cdCvm: "005410", tickers: [{ ticker: "WEGE3", ibovespa: true }] };
  const CABECALHO = "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;CATEG_DOC;ID_DOC;DT_RECEB;LINK_DOC";
  const linha = (versao, recebido, id) => `84.429.695/0001-11;2025-12-31;${versao};WEG S.A.;005410;DFP;${id};${recebido};${LINK}${id}`;
  function companhia(linhas) {
    const extrator = criarExtrator([CIA]);
    const receber = extrator.indice("dfp_cia_aberta_2025.csv");
    for (const l of [CABECALHO, ...linhas]) receber(l);
    receber.fechar?.();
    return montarCompanhia(CIA, [{ arquivo: { nome: "dfp_cia_aberta_2025.zip", lastModified: null }, extrato: extrator.extrato() }]);
  }

  test("documento reapresentado: fica a versão mais nova, com a data da primeira entrega ao lado", () => {
    for (const linhas of [[linha(1, "2026-03-25", "155689"), linha(2, "2026-04-08", "156081")], [linha(2, "2026-04-08", "156081"), linha(1, "2026-03-25", "155689")]]) {
      const [d] = companhia(linhas).documentos;
      assert.deepEqual([d.versao, d.idDoc, d.recebidoEm, d.primeiraEntrega], [2, "156081", "2026-04-08", "2026-03-25"]);
    }
  });

  test("documento com uma versão só: a primeira entrega é a própria data de entrega", () => {
    const [d] = companhia([linha(1, "2026-02-25", "154872")]).documentos;
    assert.equal(d.primeiraEntrega, "2026-02-25");
    assert.equal(d.recebidoEm, "2026-02-25");
  });
});
