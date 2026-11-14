// Formatação, CSV e carimbo da página Fundamentalista (#38).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SEM_VALOR, acoes, data, dataHora, formatar, instanteBR, moeda, numero, percentual, porAcao, preco, sinal, vezes,
} from "../scripts/fundamentos/formatar.mjs";
import { BOM, UNIDADE_NO_CSV, campo, montarCsv, numeroCsv } from "../scripts/fundamentos/csv.mjs";
import { PRAZO_DFP_DIAS, PRAZO_ITR_DIAS, carimbo, documentosEsperados } from "../scripts/fundamentos/carimbo.mjs";

describe("formatar: valores em R$ mil", () => {
  test("bilhões com uma casa; a partir de 100 bilhões, sem casa", () => {
    assert.equal(moeda(40_804_110), "R$ 40,8 bi");
    assert.equal(moeda(1_001_296), "R$ 1,0 bi");
    assert.equal(moeda(632_800_000), "R$ 633 bi");
    assert.equal(moeda(99_900_000), "R$ 99,9 bi");
  });

  test("milhões: sem casa a partir de 10 milhões; com uma casa abaixo disso", () => {
    assert.equal(moeda(532_000), "R$ 532 mi");
    assert.equal(moeda(811_962), "R$ 812 mi");
    assert.equal(moeda(5_300), "R$ 5,3 mi");
    assert.equal(moeda(12_400), "R$ 12 mi");
  });

  test("abaixo de um milhão: em mil; abaixo de mil reais, em reais", () => {
    assert.equal(moeda(812), "R$ 812 mil");
    assert.equal(moeda(1), "R$ 1 mil");
    assert.equal(moeda(0.5), "R$ 500");
    assert.equal(moeda(0), "R$ 0");
  });

  test("a virada de faixa não deixa \"1.000 mi\" nem \"1.000 mil\"", () => {
    assert.equal(moeda(999_960), "R$ 1,0 bi");
    assert.equal(moeda(999_949), "R$ 1.000 mi"); // 999,9 milhões arredonda para cima, ainda em milhões
    assert.equal(moeda(999.6), "R$ 1,0 mi");
  });

  test("negativo leva o sinal de menos (−) antes do R$, e não parênteses", () => {
    assert.equal(moeda(-2_689_043), "−R$ 2,7 bi");
    assert.equal(moeda(-155_000), "−R$ 155 mi");
    assert.ok(!moeda(-1).includes("("));
    assert.equal(moeda(-2_689_043).codePointAt(0), 0x2212);
    assert.equal(moeda(-0.0001), "R$ 0"); // arredondou para zero: sem sinal
  });

  test("sem valor é \"—\", nunca 0", () => {
    for (const v of [null, undefined, NaN, Infinity, "12"]) assert.equal(moeda(v), "—", String(v));
    assert.equal(SEM_VALOR, "—");
  });
});

describe("formatar: razões, múltiplos, valores por ação e ações", () => {
  test("razão vira percentual com uma casa", () => {
    assert.equal(percentual(0.3353), "33,5%");
    assert.equal(percentual(1.25), "125,0%");
    assert.equal(percentual(-0.069), "−6,9%");
    assert.equal(percentual(0), "0,0%");
    assert.equal(percentual(-0.0001), "0,0%");
    assert.equal(percentual(null), "—");
    assert.equal(percentual(-587.01), "−58.701,0%");
  });

  test("múltiplo em vezes, com uma casa", () => {
    assert.equal(vezes(12.34), "12,3x");
    assert.equal(vezes(-0.3), "−0,3x");
    assert.equal(vezes(1234.5), "1.234,5x");
    assert.equal(vezes(null), "—");
  });

  test("valor por ação em reais, com duas casas", () => {
    assert.equal(porAcao(1.5197), "R$ 1,52");
    assert.equal(porAcao(-0.0875), "−R$ 0,09");
    assert.equal(porAcao(1234.5), "R$ 1.234,50");
    assert.equal(porAcao(null), "—");
    assert.equal(preco(51.31), "R$ 51,31");
  });

  test("número de ações abreviado", () => {
    assert.equal(acoes(4_195_695_973), "4,2 bi");
    assert.equal(acoes(236_197_769), "236 mi");
    assert.equal(acoes(82_118_477), "82 mi");
    assert.equal(acoes(null), "—");
  });

  test("numero: milhar com ponto e decimal com vírgula", () => {
    assert.equal(numero(1234567.891, 2), "1.234.567,89");
    assert.equal(numero(-1234, 0), "−1.234");
    assert.equal(numero(0.004, 2), "0,00");
    assert.equal(numero(null), "—");
  });

  test("formatar escolhe pelo formato do indicador", () => {
    assert.equal(formatar(40_804_110, "moeda"), "R$ 40,8 bi");
    assert.equal(formatar(0.3353, "pct"), "33,5%");
    assert.equal(formatar(3.7, "vezes"), "3,7x");
    assert.equal(formatar(1.52, "porAcao"), "R$ 1,52");
    assert.equal(formatar(4_195_695_973, "acoes"), "4,2 bi");
    assert.equal(formatar(null, "moeda"), "—");
    assert.throws(() => formatar(1, "outro"), /formato desconhecido: outro/);
  });

  test("sinal: positivo, negativo e nada para zero ou sem valor", () => {
    assert.deepEqual([sinal(1), sinal(-1), sinal(0), sinal(null)], ["pos", "neg", "", ""]);
  });
});

describe("formatar: datas", () => {
  test("data e data com hora, como vieram escritas", () => {
    assert.equal(data("2026-09-30"), "30/09/2026");
    assert.equal(data("2026-09-30T18:05:00-03:00"), "30/09/2026");
    assert.equal(data(null), "—");
    assert.equal(dataHora("2026-11-13T18:05:49.000-0300"), "13/11/2026 18:05");
    assert.equal(dataHora("2026-11-12"), "12/11/2026"); // a fonte só mandou a data
    assert.equal(dataHora("ontem"), "—");
  });

  test("instante no horário de Brasília", () => {
    assert.equal(instanteBR("2026-11-14T00:57:29.000Z"), "13/11/2026 21:57");
    assert.equal(instanteBR("2026-11-08T12:23:00Z"), "08/11/2026 09:23");
    assert.equal(instanteBR(null), "—");
    assert.equal(instanteBR("não é data"), "—");
  });
});

describe("csv: para abrir certo no Excel brasileiro", () => {
  const csv = montarCsv({
    colunas: ["12 meses até 30/09/2026", "2025", "2024"],
    linhas: [
      { nome: "Receita líquida", unidade: "R$ mil", valores: [40_719_467, 40_804_110, 37_986_941] },
      { nome: "Margem bruta", unidade: UNIDADE_NO_CSV.pct, valores: [0.3295812345, 0.3353, null] },
      { nome: "Dívida líquida", unidade: "R$ mil", valores: [-2_585_002, null, -4_400_000.5] },
    ],
  });
  const linhas = csv.slice(1).split("\r\n");

  test("começa com o BOM do UTF-8 e usa CRLF", () => {
    assert.equal(BOM, "﻿");
    assert.equal(csv.codePointAt(0), 0xfeff);
    assert.deepEqual([...Buffer.from(csv, "utf8").subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(csv.endsWith("\r\n"));
    assert.ok(!/[^\r]\n/.test(csv));
    assert.equal(linhas.length, 5); // cabeçalho, três linhas e o fim
  });

  test("separador ; e cabeçalho com a coluna de unidade", () => {
    assert.equal(linhas[0], "Indicador;Unidade;12 meses até 30/09/2026;2025;2024");
    assert.ok(linhas.slice(0, 4).every((l) => l.split(";").length === 5));
  });

  test("valores sem abreviação: R$ mil inteiros e razões em fração, com vírgula decimal", () => {
    assert.equal(linhas[1], "Receita líquida;R$ mil;40719467;40804110;37986941");
    assert.equal(linhas[2], "Margem bruta;fração (0,10 = 10%);0,329581;0,3353;");
    assert.ok(!linhas[1].includes("."));
  });

  test("null vira célula vazia, nunca 0; negativo com o hífen comum, que o Excel entende", () => {
    assert.equal(linhas[3], "Dívida líquida;R$ mil;-2585002;;-4400000,5");
  });

  test("numeroCsv", () => {
    assert.equal(numeroCsv(null), "");
    assert.equal(numeroCsv(undefined), "");
    assert.equal(numeroCsv(NaN), "");
    assert.equal(numeroCsv(0), "0");
    assert.equal(numeroCsv(1.5), "1,5");
    assert.equal(numeroCsv(0.1 + 0.2), "0,3");
    assert.equal(numeroCsv(-0.0875), "-0,0875");
    assert.equal(numeroCsv(4_195_695_973), "4195695973");
  });

  test("campo de texto: aspas quando tem ; ou aspas; apóstrofo na frente do que pareceria fórmula", () => {
    assert.equal(campo("Receita líquida"), "Receita líquida");
    assert.equal(campo("a;b"), '"a;b"');
    assert.equal(campo('diz "oi"'), '"diz ""oi"""');
    assert.equal(campo("=1+1"), "'=1+1");
    assert.equal(campo("@soma"), "'@soma");
    assert.equal(campo("-10"), "'-10");
    assert.equal(campo(null), "");
  });

  test("número de valores diferente do de colunas dá erro", () => {
    assert.throws(() => montarCsv({ colunas: ["2025"], linhas: [{ nome: "x", unidade: "R$ mil", valores: [1, 2] }] }), /CSV: "x" tem 2 valores para 1 colunas/);
  });
});

describe("carimbo de desatualizado", () => {
  const itr = (dtRefer) => ({ tipo: "itr", dtRefer });
  const dfp = (dtRefer) => ({ tipo: "dfp", dtRefer });

  test("os prazos da CVM: 45 dias para o ITR e 90 para a DFP", () => {
    assert.deepEqual([PRAZO_ITR_DIAS, PRAZO_DFP_DIAS], [45, 90]);
    assert.deepEqual(documentosEsperados(12, "2026-11-20", 4), [
      { tipo: "itr", dtRefer: "2026-09-30", prazo: "2026-11-14" },
      { tipo: "itr", dtRefer: "2026-06-30", prazo: "2026-08-14" },
      { tipo: "itr", dtRefer: "2026-03-31", prazo: "2026-05-15" },
      { tipo: "dfp", dtRefer: "2025-12-31", prazo: "2026-03-31" },
    ]);
  });

  test("em dia: o documento da ficha é o último que já deveria ter saído", () => {
    assert.deepEqual(carimbo({ documento: itr("2026-09-30"), hoje: "2026-11-20" }), { desatualizado: false, texto: null, esperado: null });
    // o ITR de setembro ainda está no prazo: quem tem o de junho está em dia
    assert.equal(carimbo({ documento: itr("2026-06-30"), hoje: "2026-11-10" }).desatualizado, false);
  });

  test("no dia do prazo ainda não está atrasado; no dia seguinte, está", () => {
    assert.equal(carimbo({ documento: itr("2026-06-30"), hoje: "2026-11-14" }).desatualizado, false);
    assert.equal(carimbo({ documento: itr("2026-06-30"), hoje: "2026-11-15" }).desatualizado, true);
  });

  test("ITR atrasado: diz até onde vão os dados e qual documento falta", () => {
    const r = carimbo({ documento: itr("2026-06-30"), hoje: "2026-11-20" });
    assert.equal(r.desatualizado, true);
    assert.equal(r.texto, "Dados até o ITR de 30/06/2026. O ITR de 30/09/2026 já deveria ter sido entregue (prazo do ITR: 14/11/2026).");
    assert.deepEqual(r.esperado, { tipo: "itr", dtRefer: "2026-09-30", prazo: "2026-11-14" });
  });

  test("DFP atrasada: o prazo é de 90 dias depois do exercício", () => {
    // em 31/03/2027 a DFP de 2026 está no último dia do prazo
    assert.equal(carimbo({ documento: itr("2026-09-30"), hoje: "2027-03-31" }).desatualizado, false);
    const r = carimbo({ documento: itr("2026-09-30"), hoje: "2027-04-01" });
    assert.equal(r.texto, "Dados até o ITR de 30/09/2026. A DFP de 31/12/2026 já deveria ter sido entregue (prazo da DFP: 31/03/2027).");
  });

  test("documento mais novo do que o esperado (entregou antes do prazo): em dia", () => {
    assert.equal(carimbo({ documento: dfp("2026-12-31"), hoje: "2027-02-20" }).desatualizado, false);
  });

  test("muito atrasado: o carimbo cita o documento mais recente que já venceu", () => {
    const r = carimbo({ documento: dfp("2025-12-31"), hoje: "2026-11-20" });
    assert.equal(r.texto, "Dados até a DFP de 31/12/2025. O ITR de 30/09/2026 já deveria ter sido entregue (prazo do ITR: 14/11/2026).");
  });

  test("exercício fora de dezembro (São Martinho, que fecha em março): os trimestres seguem a companhia", () => {
    assert.deepEqual(documentosEsperados(3, "2026-11-20", 4).map((d) => [d.tipo, d.dtRefer, d.prazo]), [
      ["itr", "2026-09-30", "2026-11-14"], ["itr", "2026-06-30", "2026-08-14"], ["dfp", "2026-03-31", "2026-06-29"], ["itr", "2025-12-31", "2026-02-14"],
    ]);
    // em 20/06/2026 a DFP de março ainda está no prazo (90 dias): o ITR de dezembro basta
    assert.equal(carimbo({ documento: itr("2025-12-31"), mesDoExercicio: 3, hoje: "2026-06-20" }).desatualizado, false);
    // se fechasse em dezembro, o ITR de março já teria vencido em 15/05
    assert.equal(carimbo({ documento: dfp("2025-12-31"), mesDoExercicio: 12, hoje: "2026-06-20" }).desatualizado, true);
    const r = carimbo({ documento: itr("2025-12-31"), mesDoExercicio: 3, hoje: "2026-07-01" });
    assert.equal(r.texto, "Dados até o ITR de 31/12/2025. A DFP de 31/03/2026 já deveria ter sido entregue (prazo da DFP: 29/06/2026).");
  });

  test("fim de trimestre em mês de 30 dias e em fevereiro", () => {
    assert.deepEqual(documentosEsperados(2, "2028-03-10", 2).map((d) => d.dtRefer), ["2028-02-29", "2027-11-30"]);
  });

  test("sem documento: desatualizado, com a frase que diz isso", () => {
    assert.deepEqual(carimbo({ documento: null, hoje: "2026-11-20" }), { desatualizado: true, texto: "Sem documento da CVM para esta companhia.", esperado: null });
  });
});
