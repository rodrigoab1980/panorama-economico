// Calendário anual da temporada (#77): a grade dos meses, os eventos de cada dia e o HTML.
// A data de hoje é sempre injetada.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DIAS_DA_SEMANA, MESES, calendarioDaTemporada, diaDaSemana, diasDoMes, eventosDoAno, montarCalendario, semanasDoMes,
} from "../scripts/fundamentos/calendario.mjs";
import { MARCAS, NOTA_DO_CALENDARIO, calendarioHtml, textoDoDia } from "../scripts/fundamentos/calendario-html.mjs";
import { montarTemporada } from "../scripts/fundamentos/temporada.mjs";
import { temporadaHtml } from "../scripts/fundamentos/temporada-html.mjs";

// ---------- fichas de teste ----------
const doc = (documento, dtRefer, primeiraEntrega, extra = {}) => ({ documento, dtRefer, versao: 1, recebidoEm: primeiraEntrega, primeiraEntrega, link: null, ...extra });
function cia(ticker, documentos) {
  const u = [...documentos].sort((a, b) => (a.dtRefer < b.dtRefer ? -1 : 1)).at(-1);
  return { ticker, nome: `${ticker} Companhia S.A.`, documentoMaisRecente: u ? { tipo: u.documento, dtRefer: u.dtRefer, versao: u.versao } : null, documentos };
}
// 2025 inteiro e 2026 até o 2º trimestre: falta o ITR de 30/09/2026.
const ATE_O_2T = [
  doc("itr", "2025-03-31", "2025-05-07"), doc("itr", "2025-06-30", "2025-08-06"), doc("itr", "2025-09-30", "2025-11-05"), doc("dfp", "2025-12-31", "2026-02-26"),
  doc("itr", "2026-03-31", "2026-05-06"), doc("itr", "2026-06-30", "2026-08-05"),
];
const FALTA = cia("FALT3", ATE_O_2T);
const ENTREGOU = cia("ENTR3", [...ATE_O_2T, doc("itr", "2026-09-30", "2026-11-04")]);
const dia = (calendario, data) => calendario.meses[Number(data.slice(5, 7)) - 1].semanas.flat().find((d) => d?.data === data);
const tickers = (lista) => lista.map((x) => x.ticker);

// ---------- a grade ----------
describe("calendário: a grade dos meses", () => {
  test("a semana começa no domingo e tem sete dias", () => {
    assert.deepEqual(DIAS_DA_SEMANA.map((d) => d.nome), ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"]);
    assert.equal(diaDaSemana(2026, 11, 1), 0); // 01/11/2026 é domingo
    assert.equal(diaDaSemana(2026, 11, 14), 6); // 14/11/2026 é sábado
  });

  test("ano bissexto: fevereiro tem 29 dias; nos outros, 28", () => {
    assert.equal(diasDoMes(2028, 2), 29);
    assert.equal(diasDoMes(2024, 2), 29);
    assert.equal(diasDoMes(2026, 2), 28);
    assert.equal(diasDoMes(2100, 2), 28); // divisível por 100 e não por 400
    assert.equal(diasDoMes(2000, 2), 29);
    assert.equal(semanasDoMes(2028, 2).flat().filter((d) => d != null).length, 29);
    assert.equal(semanasDoMes(2028, 2).flat().filter((d) => d != null).at(-1), 29);
    assert.equal(diaDaSemana(2028, 2, 29), 2); // 29/02/2028 é terça-feira
  });

  test("mês que começa no sábado: seis posições vazias e o dia 1 na última coluna", () => {
    // 01/08/2026 é sábado
    const semanas = semanasDoMes(2026, 8);
    assert.deepEqual(semanas[0], [null, null, null, null, null, null, 1]);
    assert.deepEqual(semanas[1], [2, 3, 4, 5, 6, 7, 8]);
    assert.equal(semanas.length, 6);
    assert.deepEqual(semanas.at(-1), [30, 31, null, null, null, null, null]);
  });

  test("mês que começa no domingo e cabe em quatro semanas: fevereiro de 2026", () => {
    const semanas = semanasDoMes(2026, 2);
    assert.equal(semanas.length, 4);
    assert.deepEqual(semanas[0], [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(semanas[3], [22, 23, 24, 25, 26, 27, 28]);
  });

  test("toda semana tem sete posições, e todo dia do mês aparece uma vez, em ordem", () => {
    for (const ano of [2024, 2026, 2027, 2028]) {
      for (let mes = 1; mes <= 12; mes++) {
        const semanas = semanasDoMes(ano, mes);
        assert.ok(semanas.every((s) => s.length === 7), `${mes}/${ano}`);
        assert.deepEqual(semanas.flat().filter((d) => d != null), Array.from({ length: diasDoMes(ano, mes) }, (_, i) => i + 1), `${mes}/${ano}`);
        // cada dia cai na coluna do seu dia da semana
        semanas.forEach((s) => s.forEach((d, coluna) => { if (d != null) assert.equal(diaDaSemana(ano, mes, d), coluna, `${d}/${mes}/${ano}`); }));
      }
    }
  });

  test("o calendário tem os 12 meses do ano de hoje, com 365 dias (366 no bissexto)", () => {
    const c = calendarioDaTemporada([], { hoje: "2026-11-14" });
    assert.equal(c.ano, 2026);
    assert.deepEqual(c.meses.map((m) => m.nome), MESES);
    assert.equal(c.meses.flatMap((m) => m.semanas.flat()).filter(Boolean).length, 365);
    assert.equal(calendarioDaTemporada([], { hoje: "2028-02-29" }).meses.flatMap((m) => m.semanas.flat()).filter(Boolean).length, 366);
  });

  test("só o dia de hoje fica marcado como hoje; 29/02 de um ano bissexto também", () => {
    const c = calendarioDaTemporada([], { hoje: "2026-11-14" });
    assert.deepEqual(c.meses.flatMap((m) => m.semanas.flat()).filter((d) => d?.hoje).map((d) => d.data), ["2026-11-14"]);
    const bissexto = calendarioDaTemporada([], { hoje: "2028-02-29" });
    assert.deepEqual(bissexto.meses.flatMap((m) => m.semanas.flat()).filter((d) => d?.hoje).map((d) => d.data), ["2028-02-29"]);
  });
});

// ---------- os eventos ----------
describe("calendário: os eventos de cada dia", () => {
  const E = eventosDoAno([FALTA, ENTREGOU], { hoje: "2026-11-14" });

  test("entrega feita: a data da primeira entrega de cada documento, só as do ano", () => {
    assert.deepEqual(E.dias["2026-02-26"].entregues, [{ ticker: "ENTR3", documento: "DFP de 2025" }, { ticker: "FALT3", documento: "DFP de 2025" }]);
    assert.deepEqual(E.dias["2026-11-04"].entregues, [{ ticker: "ENTR3", documento: "ITR de 30/09/2026" }]);
    // as entregas de 2025 não entram no calendário de 2026
    assert.ok(Object.keys(E.dias).every((d) => d.startsWith("2026-")));
    assert.equal(E.totais.entregues, 7);
  });

  test("data provável e prazo legal do documento que ainda não saiu", () => {
    assert.deepEqual(E.dias["2026-11-05"].provaveis, [{ ticker: "FALT3", documento: "ITR de 30/09/2026", origem: "ano-anterior" }]);
    assert.deepEqual(E.dias["2026-11-16"].prazos, [{ ticker: "FALT3", documento: "ITR de 30/09/2026" }]); // 14/11 é sábado
    assert.equal(E.totais.provaveis, 1);
    assert.equal(E.totais.prazos, 1);
  });

  test("o que cai no ano seguinte fica fora: a DFP de 2026 de quem já entregou o 3º trimestre", () => {
    assert.ok(!Object.values(E.dias).some((d) => d.provaveis.some((x) => x.ticker === "ENTR3")));
    const de2027 = eventosDoAno([ENTREGOU], { hoje: "2026-11-14", ano: 2027 });
    assert.deepEqual(de2027.dias["2027-02-26"].provaveis, [{ ticker: "ENTR3", documento: "DFP de 2026", origem: "ano-anterior" }]);
    assert.deepEqual(de2027.dias["2027-03-31"].prazos, [{ ticker: "ENTR3", documento: "DFP de 2026" }]);
  });

  test("em janeiro, o ano inteiro já aparece: a regra segue adiante, documento a documento", () => {
    const e = eventosDoAno([ENTREGOU], { hoje: "2027-01-10" });
    const provaveis = Object.entries(e.dias).flatMap(([data, d]) => d.provaveis.map((x) => [data, x.documento, x.origem]));
    assert.deepEqual(provaveis, [
      ["2027-02-26", "DFP de 2026", "ano-anterior"], ["2027-05-06", "ITR de 31/03/2027", "ano-anterior"],
      ["2027-08-05", "ITR de 30/06/2027", "ano-anterior"], ["2027-11-04", "ITR de 30/09/2027", "ano-anterior"],
    ]);
    assert.deepEqual(Object.entries(e.dias).flatMap(([data, d]) => d.prazos.map(() => data)), ["2027-03-31", "2027-05-17", "2027-08-16", "2027-11-15"]);
    assert.equal(e.totais.entregues, 0);
  });

  test("sem o documento do ano anterior, a data provável é o prazo legal, e o dia leva as duas marcas", () => {
    const nova = cia("NOVA3", [doc("itr", "2026-06-30", "2026-08-05")]);
    const d = eventosDoAno([nova], { hoje: "2026-11-01" }).dias["2026-11-16"];
    assert.deepEqual(d.provaveis, [{ ticker: "NOVA3", documento: "ITR de 30/09/2026", origem: "prazo-legal" }]);
    assert.deepEqual(d.prazos, [{ ticker: "NOVA3", documento: "ITR de 30/09/2026" }]);
  });

  test("documento reapresentado: vale a primeira entrega; sem ela, a data da reapresentação não vira entrega", () => {
    const reap = cia("REAP3", [doc("dfp", "2025-12-31", "2026-02-12", { versao: 2, recebidoEm: "2026-03-12" })]);
    const e = eventosDoAno([reap], { hoje: "2026-06-01" });
    assert.deepEqual(tickers(e.dias["2026-02-12"].entregues), ["REAP3"]);
    assert.ok(!e.dias["2026-03-12"]);
    const antigo = cia("ANTI3", [doc("dfp", "2025-12-31", null, { versao: 2, recebidoEm: "2026-03-12" })]);
    assert.ok(!eventosDoAno([antigo], { hoje: "2026-06-01" }).dias["2026-03-12"]?.entregues.length);
  });

  test("a quantidade do dia é a de empresas, em ordem de ticker; só entram dias com evento", () => {
    const e = eventosDoAno([cia("ZZZZ3", ATE_O_2T), cia("AAAA3", ATE_O_2T), cia("MMMM3", ATE_O_2T)], { hoje: "2026-11-14" });
    assert.deepEqual(tickers(e.dias["2026-11-05"].provaveis), ["AAAA3", "MMMM3", "ZZZZ3"]);
    assert.deepEqual(tickers(e.dias["2026-11-16"].prazos), ["AAAA3", "MMMM3", "ZZZZ3"]);
    assert.equal(e.totais.dias, Object.keys(e.dias).length);
    assert.deepEqual(Object.keys(e.dias), [...Object.keys(e.dias)].sort());
  });

  test("o calendário concorda com a temporada: mesma data provável e mesmo prazo legal do próximo documento", () => {
    const t = montarTemporada([FALTA, ENTREGOU], { hoje: "2026-11-14" });
    const p = t.faltam[0].proximo;
    assert.deepEqual(tickers(E.dias[p.dataProvavel].provaveis), ["FALT3"]);
    assert.deepEqual(tickers(E.dias[p.prazoLegal].prazos), ["FALT3"]);
  });

  test("ficha sem documentos ou sem lista não quebra; a data de hoje é obrigatória; o resultado é determinístico", () => {
    const e = eventosDoAno([cia("VAZI3", []), { ticker: "SEML3", nome: "Sem Lista", documentoMaisRecente: null }], { hoje: "2026-11-14" });
    assert.deepEqual(e.dias, {});
    assert.deepEqual(e.totais, { entregues: 0, provaveis: 0, prazos: 0, dias: 0 });
    assert.throws(() => eventosDoAno([FALTA], {}), /data de hoje inválida/);
    assert.deepEqual(eventosDoAno([FALTA, ENTREGOU], { hoje: "2026-11-14" }), eventosDoAno(structuredClone([ENTREGOU, FALTA]), { hoje: "2026-11-14" }));
  });

  test("na grade, o dia com evento leva as listas, e o dia sem evento, as três vazias", () => {
    const c = montarCalendario(E);
    assert.deepEqual(tickers(dia(c, "2026-11-05").provaveis), ["FALT3"]);
    assert.deepEqual(dia(c, "2026-11-06"), { data: "2026-11-06", dia: 6, hoje: false, entregues: [], provaveis: [], prazos: [] });
    assert.equal(dia(c, "2026-11-14").hoje, true);
    assert.deepEqual(c.totais, E.totais);
  });
});

// ---------- HTML ----------
describe("calendário: HTML", () => {
  const C = calendarioDaTemporada([FALTA, ENTREGOU, cia("SEMP3", ATE_O_2T)], { hoje: "2026-11-14" });
  const HTML = calendarioHtml(C, { comPagina: new Set(["FALT3", "ENTR3"]) });

  test("12 tabelas, uma por mês, com o nome no caption e a semana começando no domingo", () => {
    assert.equal((HTML.match(/<table class="mes">/g) ?? []).length, 12);
    assert.deepEqual([...HTML.matchAll(/<caption>([^<]+)</g)].map((m) => m[1]), MESES.map((m) => m.replace(/^./, (c) => c.toUpperCase())));
    assert.match(HTML, /<caption>Novembro<span class="so-leitor"> de 2026<\/span><\/caption>/);
    assert.equal((HTML.match(/<thead><tr><th scope="col"><abbr title="domingo">D<\/abbr><\/th><th scope="col"><abbr title="segunda-feira">S<\/abbr><\/th>/g) ?? []).length, 12);
    assert.match(HTML, /<abbr title="sábado">S<\/abbr><\/th><\/tr><\/thead>/);
    assert.match(HTML, /<h3 id="t-calendario">Calendário de 2026<\/h3>/);
  });

  test("todos os dias do ano aparecem, e as posições fora do mês ficam vazias", () => {
    assert.equal((HTML.match(/<span class="dia-n">/g) ?? []).length, 365);
    // agosto de 2026 começa no sábado: seis células vazias antes do dia 1
    const agosto = HTML.split("<caption>Agosto")[1].split("</table>")[0];
    assert.match(agosto, /<tbody><tr>(<td class="fora"><\/td>){6}<td><span class="dia-n">1<\/span><\/td><\/tr>/);
  });

  test("ano bissexto: o dia 29 de fevereiro aparece", () => {
    const html = calendarioHtml(calendarioDaTemporada([], { hoje: "2028-03-01" }));
    const fevereiro = html.split("<caption>Fevereiro")[1].split("</table>")[0];
    assert.match(fevereiro, /<span class="dia-n">29<\/span>/);
    assert.equal((html.match(/<span class="dia-n">/g) ?? []).length, 366);
  });

  test("o dia com balanço leva as marcas com a quantidade de empresas e o texto para leitor de tela", () => {
    assert.match(HTML, /<span class="dia-n">5<\/span><span class="marcas"><b class="marca provavel">2<span class="so-leitor"> com data provável<\/span><\/b><\/span>/);
    assert.match(HTML, /<span class="dia-n">16<\/span><span class="marcas"><b class="marca prazo">2<span class="so-leitor"> com prazo legal<\/span><\/b><\/span>/);
    assert.match(HTML, /<span class="dia-n">26<\/span><span class="marcas"><b class="marca entregue">3<span class="so-leitor"> com entrega feita<\/span><\/b><\/span>/);
  });

  test("um dia com as três marcas mostra as três, na ordem: entrega feita, data provável, prazo legal", () => {
    const nova = cia("NOVA3", [doc("itr", "2026-06-30", "2026-08-05")]);
    const entregouNoPrazo = cia("PRAZ3", [...ATE_O_2T, doc("itr", "2026-09-30", "2026-11-16")]);
    const html = calendarioHtml(calendarioDaTemporada([nova, entregouNoPrazo], { hoje: "2026-11-20" }));
    assert.match(html, /<span class="dia-n">16<\/span><span class="marcas"><b class="marca entregue">1<span[^>]*>[^<]*<\/span><\/b><b class="marca provavel">1<span[^>]*>[^<]*<\/span><\/b><b class="marca prazo">1</);
  });

  test("os tickers do dia: no title, para o mouse, e num details, para o toque, com link para a ficha", () => {
    assert.match(HTML, /<td class="com-evento"><details name="dia-do-calendario"><summary title="05\/11\/2026\. Data provável, estimada \(2\): FALT3, SEMP3\.">/);
    assert.match(HTML, /<div class="dia-painel"><p class="dia-data">05\/11\/2026<\/p><p><strong>Data provável, estimada \(2\)\.<\/strong> ITR de 30\/09\/2026: <a href="\.\.\/falt3\/">FALT3<\/a>, SEMP3\.<\/p><\/div>/);
    // todo details tem o mesmo name: abrir um dia fecha o outro
    assert.ok((HTML.match(/<details /g) ?? []).length > 5);
    assert.equal((HTML.match(/<details name="dia-do-calendario">/g) ?? []).length, (HTML.match(/<details /g) ?? []).length);
    assert.equal(textoDoDia(dia(C, "2026-02-26")), "26/02/2026. Entrega feita (3): ENTR3, FALT3, SEMP3.");
  });

  test("o dia de hoje fica destacado, com ou sem balanço, e o leitor de tela ouve 'hoje'", () => {
    assert.match(HTML, /<td class="hoje" aria-current="date"><span class="dia-n">14<\/span><span class="so-leitor"> \(hoje\)<\/span><\/td>/);
    assert.equal((HTML.match(/aria-current="date"/g) ?? []).length, 1);
    const comBalanco = calendarioHtml(calendarioDaTemporada([FALTA], { hoje: "2026-11-05" }));
    assert.match(comBalanco, /<td class="com-evento hoje" aria-current="date"><details name="dia-do-calendario"><summary title="05\/11\/2026, hoje\. Data provável, estimada \(1\): FALT3\.">/);
  });

  test("legenda com as três marcas e o dia de hoje, e a nota que separa estimativa de fato", () => {
    assert.deepEqual(MARCAS.map((m) => m.classe), ["entregue", "provavel", "prazo"]);
    assert.match(HTML, /<ul class="calendario-legenda"><li><span class="marca entregue" aria-hidden="true"><\/span>entrega feita<\/li><li><span class="marca provavel" aria-hidden="true"><\/span>data provável \(estimativa\)<\/li><li><span class="marca prazo" aria-hidden="true"><\/span>prazo legal<\/li><li><span class="marca-hoje" aria-hidden="true">14<\/span>hoje<\/li><\/ul>/);
    assert.ok(HTML.includes(NOTA_DO_CALENDARIO));
    assert.match(NOTA_DO_CALENDARIO, /quantidade de empresas no dia/);
    assert.match(NOTA_DO_CALENDARIO, /data provável é uma estimativa deste site/);
  });

  test("HTML estático, links relativos, texto escapado e nenhuma palavra de julgamento", () => {
    assert.ok(!/<script/i.test(HTML));
    for (const m of HTML.matchAll(/href="([^"]+)"/g)) assert.ok(/^\.\.\/[a-z0-9]+\/$/.test(m[1]) || m[1] === "#t-proximas", m[1]);
    assert.ok(!/atras|compre|venda|recomend|data do balanço|data oficial/i.test(HTML));
    const xss = calendarioHtml(calendarioDaTemporada([cia('X"><b>3', ATE_O_2T)], { hoje: "2026-11-14" }));
    assert.ok(!xss.includes('X"><b>3'));
    assert.match(xss, /X&quot;&gt;&lt;b&gt;3/);
  });

  test("sem calendário, nada sai; na página, o calendário fica entre o topo e as listas, que continuam", () => {
    assert.equal(calendarioHtml(null), "");
    const fichas = [FALTA, ENTREGOU];
    const t = montarTemporada(fichas, { hoje: "2026-11-14" });
    const pagina = temporadaHtml(t, { calendario: calendarioDaTemporada(fichas, { hoje: "2026-11-14" }) });
    const topo = pagina.indexOf('id="t-temporada"');
    const calendario = pagina.indexOf('id="t-calendario"');
    const proximas = pagina.indexOf('id="t-proximas"');
    const entregues = pagina.indexOf('id="t-entregues"');
    assert.ok(topo >= 0 && topo < calendario && calendario < proximas && proximas < entregues);
    assert.match(pagina, /<a href="#t-proximas">Ir para as próximas entregas<\/a>/);
    assert.ok(!temporadaHtml(t).includes("t-calendario"));
  });
});

// ---------- CSS ----------
describe("calendário: CSS", () => {
  const css = readFileSync(new URL("../site/fundamentos/fundamentos.css", import.meta.url), "utf8").replace(/\/\*.*?\*\//gs, "");

  test("4 colunas no desktop e um mês por linha no celular", () => {
    assert.match(css, /\.calendario-meses \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    assert.match(css, /@media \(max-width: 560px\) \{ \.calendario-meses \{ grid-template-columns: minmax\(0, 1fr\); \} \}/);
  });

  test("as três marcas se distinguem pelo desenho, com a mesma tinta: cheia, vazada e contorno tracejado", () => {
    assert.match(css, /\.marca\.entregue \{ background: var\(--tinta\); color: var\(--fundo\); \}/);
    assert.match(css, /\.marca\.provavel \{ box-shadow: inset 0 0 0 2px var\(--tinta\); \}/);
    assert.match(css, /\.marca\.prazo \{ border: 1px dashed var\(--tinta\); \}/);
    const regras = css.split("\n").filter((l) => /\.marca|\.mes |\.dia-painel|\.calendario/.test(l)).join("\n");
    assert.ok(!/var\(--(alta|baixa|atencao|agora)\)/.test(regras), "nenhuma cor de julgamento no calendário");
  });

  test("o painel dos tickers tem a largura do mês, para não sair da tela", () => {
    assert.match(css, /\.mes \{[^}]*position: relative/);
    assert.match(css, /\.dia-painel \{[^}]*position: absolute;[^}]*left: 0; right: 0;/);
  });
});
