import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { interpretarArquivo, lerArquivos } from "../scripts/cvm/leitor.mjs";
import { montarSeries } from "../scripts/cvm/series.mjs";
import {
  ALIQUOTA_ROIC, ARRENDAMENTOS, DIVIDA_POR_DESCRICAO, INDICADORES, LIMITE_DESPESA_SEM_DIVIDA, adaptarPeriodo, arrendamentos, caixa,
  calcularIndicadores, capitalInvestido, contasDeArrendamento, contasDeDividaPorDescricao, despesasFinanceiras, dividaBruta,
} from "../scripts/cvm/indicadores.mjs";

// ---------- fixtures reais (test/fixtures/cvm), lidas pelo leitor da #31 e pela série da #33 ----------
const DIR = new URL("./fixtures/cvm/", import.meta.url);
const seriesDe = (pasta) => montarSeries(lerArquivos(readdirSync(new URL(`${pasta}/`, DIR)).filter((n) => interpretarArquivo(n))
  .map((nome) => ({ nome, linhas: new TextDecoder("latin1").decode(readFileSync(new URL(`${pasta}/${nome}`, DIR))).split("\n") }))));

const WEG = seriesDe("weg");
const RAIA = seriesDe("raia-drogasil");
const SAO_MARTINHO = seriesDe("sao-martinho");

const ano = (serie, fim) => serie.anual.find((p) => p.fim === fim);
// Os indicadores de resultado, retorno, caixa e dívida (#34 e #35) são os 28 primeiros da lista.
// Os de fluxo de caixa e por ação (#36) vêm depois e têm os testes em cvm-fluxo-de-caixa.test.mjs.
const ATE_35 = INDICADORES.slice(0, 28).map((i) => i.id);
const ate35 = (ind) => Object.fromEntries(ATE_35.map((id) => [id, ind[id]]));
const valores = (ind) => Object.fromEntries(Object.entries(ind).map(([id, r]) => [id, r.valor]));
// Compara em R$ milhões, com tolerância de 0,5 (os números de referência são arredondados).
const emMilhoes = (emMil, esperado, rotulo) =>
  assert.ok(Math.abs(emMil / 1000 - esperado) <= 0.5, `${rotulo}: ${emMil / 1000} não bate com ${esperado}`);

// ---------- períodos sintéticos ----------
// Conta fixa: código → valor. Subconta sem código fixo: código → [valor, descrição].
const linha = (conta, v) => (Array.isArray(v)
  ? { conta, descricao: v[1], contaFixa: false, valor: v[0] }
  : { conta, descricao: "", contaFixa: true, valor: v });
const bloco = (contas) => ({ contas: Object.entries(contas).map(([conta, v]) => linha(conta, v)) });
// Um exercício saudável: receita 1.000, lucro bruto 400, EBIT 200, D&A 50, lucro 100,
// receitas financeiras 20, despesas financeiras 50, ativo 2.000 (600 circulante), PL 800,
// passivo circulante 400, dívida 300 + 200, caixa 100 + 50, arrendamentos 20 + 60 em outras obrigações.
const BASE = {
  DRE: { "3.01": 1000, "3.03": 400, "3.05": 200, "3.06": -30, "3.06.01": 20, "3.06.02": -50, "3.11": 100 },
  DVA: { "7.04.01": -50 },
  BPA: { "1": 2000, "1.01": 600, "1.01.01": 100, "1.01.02": 50 },
  BPP: {
    "2.01": 400, "2.01.04": 300, "2.01.04.03": 0, "2.01.05.02.07": [20, "Arrendamentos"],
    "2.02.01": 200, "2.02.01.03": 0, "2.02.02.02.05": [60, "Arrendamentos"], "2.03": 800,
  },
};
// `mudancas` troca contas de um demonstrativo; undefined remove a conta e null remove o demonstrativo.
function anual(mudancas = {}, { tipo = "anual", meses = 12 } = {}) {
  const demonstrativos = {};
  for (const [demo, contas] of Object.entries(BASE)) {
    if (mudancas[demo] === null) continue;
    const juntas = { ...contas, ...mudancas[demo] };
    for (const c of Object.keys(juntas)) if (juntas[c] === undefined) delete juntas[c];
    demonstrativos[demo] = bloco(juntas);
  }
  return { inicio: "2025-01-01", fim: "2025-12-31", tipo, dias: 365, meses, demonstrativos };
}
// A base de 12 meses com os mesmos números, na forma de base12Meses.
function doze12() {
  const fluxos = {};
  for (const demo of ["DRE", "DVA"]) for (const [conta, valor] of Object.entries(BASE[demo])) fluxos[conta] = { demonstrativo: demo, descricao: "", valor };
  const contas = {};
  const naoFixas = [];
  for (const demo of ["BPA", "BPP"]) {
    for (const [conta, v] of Object.entries(BASE[demo])) {
      if (Array.isArray(v)) naoFixas.push({ demonstrativo: demo, conta, descricao: v[1], valor: v[0] });
      else contas[conta] = { demonstrativo: demo, descricao: "", valor: v };
    }
  }
  return { tipo: "itr", motivo: null, fim: "2026-09-30", parcelas: {}, fluxos, estoques: { data: "2026-09-30", origem: {}, contas, naoFixas } };
}

describe("INDICADORES: a lista que a página vai mostrar", () => {
  test("cada item tem id, nome, unidade conhecida e fórmula não vazia", () => {
    for (const i of INDICADORES) {
      assert.ok(i.id && i.nome, JSON.stringify(i));
      assert.ok(["R$ mil", "razão", "ações", "R$ por ação"].includes(i.unidade), i.id);
      assert.ok(typeof i.formula === "string" && i.formula.trim().length > 10, i.id);
    }
  });

  test("os 13 indicadores da #34 e os 15 da #35, na ordem, sem id repetido", () => {
    assert.equal(new Set(INDICADORES.map((i) => i.id)).size, INDICADORES.length);
    assert.deepEqual(ATE_35, [
      "receita", "lucroBruto", "margemBruta", "ebit", "da", "ebitda", "margemEbitda",
      "resultadoFinanceiro", "lucroLiquido", "margemLiquida", "roe", "roa", "roic",
      "patrimonioLiquido", "caixa", "dividaBruta", "arrendamentos", "dividaBrutaComArrendamentos",
      "dividaLiquida", "dividaLiquidaComArrendamentos", "dividaBrutaSobrePl", "dividaLiquidaSobreEbitda",
      "dividaCurtoPrazo", "despesasFinanceiras", "coberturaJuros", "custoDivida", "liquidezCorrente", "liquidezImediata",
    ]);
  });

  test("valores em R$ mil e razões estão marcados com a unidade certa", () => {
    const razoes = INDICADORES.slice(0, 28).filter((i) => i.unidade === "razão").map((i) => i.id);
    assert.deepEqual(razoes, [
      "margemBruta", "margemEbitda", "margemLiquida", "roe", "roa", "roic",
      "dividaBrutaSobrePl", "dividaLiquidaSobreEbitda", "dividaCurtoPrazo", "coberturaJuros", "custoDivida",
      "liquidezCorrente", "liquidezImediata",
    ]);
  });

  test("cobertura e custo da dívida dizem que as despesas financeiras são uma aproximação dos juros", () => {
    for (const id of ["coberturaJuros", "custoDivida"]) {
      const { formula } = INDICADORES.find((i) => i.id === id);
      assert.match(formula, /aproximação dos juros/, id);
      assert.match(formula, /variação cambial/, id);
      assert.match(formula, /juros de arrendamento/, id);
    }
  });

  test("a fórmula da dívida bruta diz que é sem arrendamentos, e a da dívida líquida explica o valor negativo", () => {
    assert.match(INDICADORES.find((i) => i.id === "dividaBruta").formula, /sem os arrendamentos/);
    assert.match(INDICADORES.find((i) => i.id === "dividaLiquida").formula, /negativo quer dizer mais caixa do que dívida/);
  });

  test("calcularIndicadores devolve exatamente os ids da lista, cada um com valor e motivo", () => {
    const ind = calcularIndicadores(anual());
    assert.deepEqual(Object.keys(ind), INDICADORES.map((i) => i.id));
    // A D&A diz também de onde saiu (DFC ou DVA).
    for (const [id, r] of Object.entries(ind)) assert.deepEqual(Object.keys(r), id === "da" ? ["valor", "motivo", "origem"] : ["valor", "motivo"], id);
  });

  test("a fórmula do ROIC diz a alíquota usada no código e que arrendamento não entra", () => {
    const { formula } = INDICADORES.find((i) => i.id === "roic");
    assert.equal(ALIQUOTA_ROIC, 0.34);
    assert.match(formula, /34%/);
    assert.match(formula, /arrendamentos não entram/);
  });

  test("nenhum texto recomenda nada nem fala em nota", () => {
    for (const i of INDICADORES) assert.doesNotMatch(`${i.nome} ${i.formula}`, /compr[ae]|vend[ae]r?\b|nota|recomend|preço-alvo/i, i.id);
  });
});

describe("cada indicador, num exercício sintético", () => {
  const ind = calcularIndicadores(anual());
  const casos = {
    receita: 1000, // 3.01
    lucroBruto: 400, // 3.03
    margemBruta: 400 / 1000,
    ebit: 200, // 3.05
    da: 50, // − 7.04.01
    ebitda: 250, // 200 + 50
    margemEbitda: 250 / 1000,
    resultadoFinanceiro: -30, // 3.06
    lucroLiquido: 100, // 3.11
    margemLiquida: 100 / 1000,
    roe: 100 / 800, // 3.11 ÷ 2.03
    roa: 100 / 2000, // 3.11 ÷ 1
    roic: (200 * (1 - 0.34)) / (800 + 500 - 150), // EBIT × 66% ÷ (PL + dívida − caixa)
    patrimonioLiquido: 800, // 2.03
    caixa: 150, // 1.01.01 + 1.01.02
    dividaBruta: 500, // (2.01.04 − 2.01.04.03) + (2.02.01 − 2.02.01.03)
    arrendamentos: 80, // 20 + 60, em outras obrigações
    dividaBrutaComArrendamentos: 580,
    dividaLiquida: 350, // 500 − 150
    dividaLiquidaComArrendamentos: 430, // 580 − 150
    dividaBrutaSobrePl: 500 / 800,
    dividaLiquidaSobreEbitda: 350 / 250,
    dividaCurtoPrazo: 300 / 500,
    despesasFinanceiras: 50, // − 3.06.02
    coberturaJuros: 200 / 50, // EBIT ÷ despesas financeiras
    custoDivida: 50 / 500,
    liquidezCorrente: 600 / 400, // 1.01 ÷ 2.01
    liquidezImediata: 150 / 400, // caixa ÷ 2.01
  };
  for (const [id, esperado] of Object.entries(casos)) {
    // Este exercício sintético não tem DFC: a D&A vem da DVA.
    test(`${id} = ${esperado}`, () => assert.deepEqual(ind[id], id === "da" ? { valor: esperado, motivo: null, origem: "DVA" } : { valor: esperado, motivo: null }));
  }

  test("todo id de INDICADORES tem um caso aqui", () => {
    assert.deepEqual(Object.keys(casos), ATE_35);
  });

  test("o lucro bruto é o 3.03 lido direto, não 3.01 + 3.02", () => {
    const p = anual({ DRE: { "3.02": -100 } }); // 3.01 + 3.02 daria 900
    assert.equal(calcularIndicadores(p).lucroBruto.valor, 400);
  });

  test("razões saem em fração, sem arredondar", () => {
    const p = anual({ DRE: { "3.11": 1 }, BPP: { "2.03": 3 } });
    assert.equal(calcularIndicadores(p).roe.valor, 1 / 3);
  });

  test("a base de 12 meses é lida do mesmo jeito e dá os mesmos números", () => {
    assert.deepEqual(ate35(calcularIndicadores(doze12())), ate35(ind));
  });
});

describe("caixa, dívida bruta e capital investido (reutilizados na #35)", () => {
  test("caixa = 1.01.01 + 1.01.02", () => {
    assert.deepEqual(caixa(anual()), { valor: 150, motivo: null });
    assert.deepEqual(caixa(doze12()), { valor: 150, motivo: null });
  });
  test("dívida bruta = (2.01.04 − 2.01.04.03) + (2.02.01 − 2.02.01.03)", () => {
    assert.deepEqual(dividaBruta(anual()), { valor: 500, motivo: null });
    assert.deepEqual(dividaBruta(doze12()), { valor: 500, motivo: null });
    // Com o arrendamento lançado dentro de empréstimos e financiamentos, ele sai da dívida.
    const p = anual({ BPP: { "2.01.04.03": 40, "2.02.01.03": 110 } });
    assert.deepEqual(dividaBruta(p), { valor: (300 - 40) + (200 - 110), motivo: null });
  });
  test("sem as subcontas de arrendamento no período, elas contam como 0", () => {
    const p = anual({ BPP: { "2.01.04.03": undefined, "2.02.01.03": undefined } });
    assert.deepEqual(dividaBruta(p), { valor: 500, motivo: null });
  });
  test("capital investido = PL + dívida bruta − caixa", () => {
    assert.deepEqual(capitalInvestido(anual()), { valor: 800 + 500 - 150, motivo: null });
  });
  test("zero informado é zero, não ausência", () => {
    assert.deepEqual(caixa(anual({ BPA: { "1.01.02": 0 } })), { valor: 100, motivo: null });
    // Dívida zero de quem também não tem despesa financeira relevante: é zero mesmo.
    const semDivida = anual({ BPP: { "2.01.04": 0, "2.02.01": 0 }, DRE: { "3.06": 15, "3.06.02": -5 } });
    assert.deepEqual(dividaBruta(semDivida), { valor: 0, motivo: null });
  });
  test("conta ausente dá null e o motivo diz qual falta", () => {
    assert.deepEqual(caixa(anual({ BPA: { "1.01.02": undefined } })), { valor: null, motivo: "falta a conta 1.01.02 (aplicações financeiras)" });
    assert.deepEqual(dividaBruta(anual({ BPP: { "2.02.01": undefined } })), { valor: null, motivo: "falta a conta 2.02.01 (empréstimos e financiamentos de longo prazo)" });
    assert.deepEqual(capitalInvestido(anual({ BPP: { "2.03": undefined } })), { valor: null, motivo: "falta a conta 2.03 (patrimônio líquido)" });
  });
  test("WEG em 31/12/2025, conferido no arquivo (R$ mil)", () => {
    const p = ano(WEG, "2025-12-31");
    assert.equal(caixa(p).valor, 6_296_498 + 983_367);
    assert.equal(dividaBruta(p).valor, 3_549_314 + 1_041_508);
    assert.equal(capitalInvestido(p).valor, 18_553_364 + 4_590_822 - 7_279_865);
  });
});

describe("regras de null: nunca 0 no lugar de 'não deu'", () => {
  test("receita zero: as margens ficam null, os valores continuam", () => {
    const ind = calcularIndicadores(anual({ DRE: { "3.01": 0 } }));
    for (const id of ["margemBruta", "margemEbitda", "margemLiquida"]) {
      assert.deepEqual(ind[id], { valor: null, motivo: "receita zero ou negativa" }, id);
    }
    assert.deepEqual(ind.receita, { valor: 0, motivo: null });
    assert.equal(ind.lucroLiquido.valor, 100);
    assert.equal(ind.roe.valor, 100 / 800);
  });

  test("receita negativa: as margens também ficam null", () => {
    const ind = calcularIndicadores(anual({ DRE: { "3.01": -5 } }));
    assert.deepEqual(ind.margemLiquida, { valor: null, motivo: "receita zero ou negativa" });
  });

  test("PL negativo: ROE null; o ROA continua", () => {
    const ind = calcularIndicadores(anual({ BPP: { "2.03": -800 } }));
    assert.deepEqual(ind.roe, { valor: null, motivo: "patrimônio líquido zero ou negativo" });
    assert.equal(ind.roa.valor, 100 / 2000);
  });

  test("PL zero: ROE null, não infinito", () => {
    assert.deepEqual(calcularIndicadores(anual({ BPP: { "2.03": 0 } })).roe, { valor: null, motivo: "patrimônio líquido zero ou negativo" });
  });

  test("capital investido negativo (caixa maior que PL + dívida): ROIC null", () => {
    const ind = calcularIndicadores(anual({ BPA: { "1.01.01": 5000 } }));
    assert.deepEqual(ind.roic, { valor: null, motivo: "capital investido zero ou negativo" });
    assert.equal(ind.roe.valor, 100 / 800);
  });

  test("ativo zero (dado quebrado, como o consolidado zerado da TIM em 2025): ROA null", () => {
    assert.deepEqual(calcularIndicadores(anual({ BPA: { "1": 0 } })).roa, { valor: null, motivo: "ativo total zero ou negativo" });
  });

  test("sem D&A na DFC nem na DVA: D&A, EBITDA e margem EBITDA null; o EBIT não vira EBITDA", () => {
    const ind = calcularIndicadores(anual({ DVA: null }));
    const motivo = "falta a conta 7.04.01 (depreciação e amortização, na DVA)";
    assert.deepEqual(ind.da, { valor: null, motivo, origem: null });
    for (const id of ["ebitda", "margemEbitda"]) assert.deepEqual(ind[id], { valor: null, motivo }, id);
    assert.equal(ind.ebit.valor, 200);
    assert.equal(ind.roic.valor, (200 * (1 - 0.34)) / 1150);
  });

  test("lucro bruto ausente (3.03): null com a conta no motivo, e a margem bruta também", () => {
    const ind = calcularIndicadores(anual({ DRE: { "3.03": undefined } }));
    const motivo = "falta a conta 3.03 (lucro bruto)";
    assert.deepEqual(ind.lucroBruto, { valor: null, motivo });
    assert.deepEqual(ind.margemBruta, { valor: null, motivo });
    assert.equal(ind.margemLiquida.valor, 0.1);
  });

  test("conta ausente em qualquer parcela derruba o indicador: ROIC sem a dívida de longo prazo", () => {
    const ind = calcularIndicadores(anual({ BPP: { "2.02.01": undefined } }));
    assert.deepEqual(ind.roic, { valor: null, motivo: "falta a conta 2.02.01 (empréstimos e financiamentos de longo prazo)" });
  });

  test("D&A positiva na origem não é corrigida com valor absoluto: sai negativa, à vista", () => {
    const ind = calcularIndicadores(anual({ DVA: { "7.04.01": 50 } }));
    assert.equal(ind.da.valor, -50);
    assert.equal(ind.ebitda.valor, 150);
  });

  test("D&A zero sai 0, não -0", () => {
    assert.ok(Object.is(calcularIndicadores(anual({ DVA: { "7.04.01": 0 } })).da.valor, 0));
  });

  test("período de transição: fluxos e margens saem; ROE, ROA e ROIC ficam null, sem anualizar", () => {
    const ind = calcularIndicadores(anual({}, { tipo: "transicao", meses: 9 }));
    const motivo = "período de 9 meses, retorno não anualizado";
    for (const id of ["roe", "roa", "roic"]) assert.deepEqual(ind[id], { valor: null, motivo }, id);
    assert.equal(ind.receita.valor, 1000);
    assert.equal(ind.ebitda.valor, 250);
    assert.equal(ind.margemLiquida.valor, 0.1);
  });

  test("12 meses indisponível: todos os indicadores null com o motivo da série", () => {
    const motivo = "a companhia passou a consolidar: o ITR de 30/06/2026 é consolidado, a DFP de 31/12/2025 é individual e o ITR de 30/06/2025 é individual";
    const ind = calcularIndicadores({ tipo: "indisponivel", motivo, fim: "2026-06-30", parcelas: null, fluxos: null, estoques: { data: "2026-06-30", origem: {}, contas: { "2.03": { valor: 800 } } } });
    assert.deepEqual(Object.keys(ind), INDICADORES.map((i) => i.id));
    for (const [id, r] of Object.entries(ind)) assert.deepEqual(r, id === "da" ? { valor: null, motivo, origem: null } : { valor: null, motivo }, id);
    assert.deepEqual(caixa({ tipo: "indisponivel", motivo, fluxos: null, estoques: null }), { valor: null, motivo });
  });

  test("período sem demonstrativo de fluxo (tipo null na série): tudo null com motivo", () => {
    const ind = calcularIndicadores({ inicio: null, fim: "2025-12-31", tipo: null, dias: null, meses: null, demonstrativos: {} });
    for (const r of Object.values(ind)) assert.deepEqual([r.valor, r.motivo], [null, "o período não tem DRE, DFC nem DVA"]);
  });

  test("nenhum motivo aparece junto com valor, e nenhum null fica sem motivo", () => {
    const periodos = [anual(), anual({ DVA: null }), anual({ DRE: { "3.01": 0 } }), anual({}, { tipo: "transicao", meses: 6 }), doze12(), ...WEG.anual, WEG.doze, ...SAO_MARTINHO.anual];
    for (const p of periodos) {
      for (const [id, r] of Object.entries(calcularIndicadores(p))) {
        assert.equal(r.valor == null, r.motivo != null, id);
        if (r.valor != null) assert.ok(Number.isFinite(r.valor), id);
      }
    }
  });
});

describe("adaptarPeriodo: a mesma leitura para o anual e para os 12 meses", () => {
  test("período anual: lê cada conta no demonstrativo dela", () => {
    const p = adaptarPeriodo(ano(WEG, "2025-12-31"));
    assert.deepEqual([p.tipo, p.meses, p.motivo], ["anual", 12, null]);
    assert.equal(p.fluxo("3.01"), 40_804_110);
    assert.equal(p.fluxo("7.04.01"), -1_001_296);
    assert.equal(p.estoque("2.03"), 18_553_364);
    assert.equal(p.fluxo("3.98"), null);
  });

  test("12 meses pelo ITR: fluxos somados e balanço da data do ITR", () => {
    const p = adaptarPeriodo(WEG.doze);
    assert.deepEqual([p.tipo, p.meses, p.motivo], ["12-meses", 12, null]);
    assert.equal(p.fluxo("3.11"), 6_690_278);
    assert.equal(p.estoque("1.01.01"), 5_484_016); // posição em 30/09/2026
    assert.equal(p.estoque("9.99"), null);
  });

  test("12 meses de ano fechado (o documento mais recente é a DFP): iguais ao exercício", () => {
    assert.equal(RAIA.doze.tipo, "ano-fechado");
    assert.equal(adaptarPeriodo(RAIA.doze).tipo, "12-meses");
    assert.deepEqual(ate35(calcularIndicadores(RAIA.doze)), ate35(calcularIndicadores(ano(RAIA, "2025-12-31"))));
  });

  test("um período já adaptado passa direto", () => {
    const p = adaptarPeriodo(anual());
    assert.equal(adaptarPeriodo(p), p);
  });
});

describe("WEG 2025 (fixture da DFP)", () => {
  const ind = calcularIndicadores(ano(WEG, "2025-12-31"));

  test("valores do exercício, em R$ milhões", () => {
    emMilhoes(ind.receita.valor, 40_804, "receita");
    emMilhoes(ind.lucroBruto.valor, 13_682, "lucro bruto");
    emMilhoes(ind.ebit.valor, 7_999, "EBIT");
    emMilhoes(ind.da.valor, 1_001, "D&A");
    emMilhoes(ind.ebitda.valor, 9_000, "EBITDA");
    emMilhoes(ind.resultadoFinanceiro.valor, 149, "resultado financeiro");
    emMilhoes(ind.lucroLiquido.valor, 6_776, "lucro líquido");
  });

  test("os mesmos valores, exatos em R$ mil (conferidos no arquivo da CVM)", () => {
    const exatos = {
      receita: 40_804_110,
      lucroBruto: 13_681_633,
      margemBruta: 13_681_633 / 40_804_110,
      ebit: 7_998_741,
      da: 1_001_296,
      ebitda: 7_998_741 + 1_001_296,
      margemEbitda: (7_998_741 + 1_001_296) / 40_804_110,
      resultadoFinanceiro: 148_936,
      lucroLiquido: 6_775_958,
      margemLiquida: 6_775_958 / 40_804_110,
      roe: 6_775_958 / 18_553_364,
      roa: 6_775_958 / 42_645_030,
      roic: (7_998_741 * (1 - 0.34)) / (18_553_364 + 4_590_822 - 7_279_865),
    };
    const calculados = valores(ind);
    assert.deepEqual(Object.fromEntries(Object.keys(exatos).map((id) => [id, calculados[id]])), exatos);
  });

  test("ROE ≈ 36,5% com o saldo do fim do período (6.776 ÷ 18.553)", () => {
    assert.ok(Math.abs(ind.roe.valor - 0.365) < 0.0005, String(ind.roe.valor));
  });

  test("ROA é lucro ÷ ativo (≈ 15,9%), não EBIT ÷ ativo (≈ 18,8%)", () => {
    assert.ok(Math.abs(ind.roa.valor - 0.159) < 0.0005, String(ind.roa.valor));
  });
});

describe("WEG, 12 meses até o 3T26", () => {
  const ind = calcularIndicadores(WEG.doze);

  test("lucro líquido de 12 meses = 6.690.278 (R$ mil), o valor do docs/cvm.md", () => {
    assert.deepEqual(ind.lucroLiquido, { valor: 6_690_278, motivo: null });
  });

  test("fluxos de 12 meses e balanço de 30/09/2026", () => {
    assert.equal(ind.receita.valor, 40_719_467);
    assert.equal(ind.ebit.valor, 7_884_487);
    // D&A: 1.001.296 (2025) + 772.679 (9M26) − acumulado 9M25 do ITR de 30/09/2025. Na WEG a DFC e a DVA dão o mesmo.
    assert.deepEqual(ind.da, { valor: 1_068_117, motivo: null, origem: "DFC" });
    assert.equal(ind.ebitda.valor, 7_884_487 + 1_068_117);
    assert.equal(ind.roe.valor, 6_690_278 / WEG.doze.estoques.contas["2.03"].valor);
    assert.equal(WEG.doze.estoques.data, "2026-09-30");
  });
});

// Critério de aceite da #34: valores batendo com o release de resultados de 2 empresas.
describe("release de resultados: WEG 4T25", () => {
  // Fonte: WEG S.A., "Release de Resultados 4T 2025", Jaraguá do Sul, 25/02/2026.
  //   PDF no site de RI da companhia, consultado em 13/11/2026:
  //   https://api.mziq.com/mzfilemanager/v2/d/50c1bd3e-8ac6-42d9-884f-b9d69f690602/e93d71d4-7174-addd-7179-527d63dc51ce?origin=2
  //   (link "Release Resultados 4T25" de https://ri.weg.net/informacoes-financeiras/central-de-resultados/).
  //   Página 10, "Anexo II - Demonstração de Resultados Consolidados - Acumulado", coluna 12M25, em R$ mil:
  //     Receita Operacional Líquida   40.804.110
  //     Minoritários                    (399.739)
  //     Lucro Líquido do Exercício     6.376.219   (só a parte dos controladores)
  //     EBITDA                         9.000.038
  //   Página 5, Tabela 4: o EBITDA é calculado "conforme Resolução CVM 156/2022" (não é ajustado).
  const RELEASE = { receita: 40_804_110, lucroControladores: 6_376_219, minoritarios: 399_739, ebitda: 9_000_038 };
  const ind = calcularIndicadores(ano(WEG, "2025-12-31"));

  test("receita líquida igual à do release", () => {
    assert.equal(ind.receita.valor, RELEASE.receita);
  });

  test("lucro líquido: o nosso (3.11, com minoritários) = lucro do release + minoritários", () => {
    assert.equal(ind.lucroLiquido.valor, RELEASE.lucroControladores + RELEASE.minoritarios);
  });

  test("EBITDA (RCVM 156) igual ao do release, a menos de R$ 1 mil de arredondamento", () => {
    assert.ok(Math.abs(ind.ebitda.valor - RELEASE.ebitda) <= 1, String(ind.ebitda.valor));
  });
});

describe("release de resultados: Raia Drogasil (RD Saúde) 4T25", () => {
  // Fonte: RD Saúde (Raia Drogasil S.A.), "Resultados 4T25", São Paulo, 03/03/2026.
  //   PDF no site de RI da companhia, consultado em 13/11/2026:
  //   https://ri.rdsaude.com.br/Download.aspx?Arquivo=5qQVLymU2JrA/iPP5ZJdWg==
  //   (link "Resultados 4T25" de https://ri.rdsaude.com.br/central-de-resultados).
  //   O release é escrito no padrão pré-IFRS 16 (página 1); a página 17 ("IFRS-16") reconcilia com o
  //   padrão das demonstrações financeiras, que é o que a CVM recebe.
  //   Página 20, "Demonstração do Resultado Consolidado", coluna 2025, em R$ mil:
  //     Receita líquida de vendas e serviços   44.250.449   (igual nos dois padrões)
  //     Lucro líquido                           1.362.494   (pré-IFRS 16)
  //   Página 17, coluna "2025 IFRS 16", em R$ milhões:
  //     Lucro Líquido                             1.300,3
  //
  // EBITDA: não comparado. O release só publica o EBITDA pré-IFRS 16 (3.434,0, página 14) e o
  // ajustado (3.374,8 pré-IFRS 16 e 4.688,2 em IFRS 16, página 17). Não há "EBITDA (RCVM 156)" no
  // padrão das demonstrações financeiras, que é o do nosso cálculo (4.818,3, com a D&A da DFC).
  const RELEASE = { receita: 44_250_449, lucroIfrs16EmMilhoes: 1_300.3, lucroPreIfrs16: 1_362_494 };
  const ind = calcularIndicadores(ano(RAIA, "2025-12-31"));

  test("receita líquida igual à do release", () => {
    assert.equal(ind.receita.valor, RELEASE.receita);
  });

  test("lucro líquido igual ao do release na coluna IFRS 16 (R$ 1.300,3 milhões, com uma casa)", () => {
    assert.ok(Math.abs(ind.lucroLiquido.valor / 1000 - RELEASE.lucroIfrs16EmMilhoes) <= 0.1, String(ind.lucroLiquido.valor));
  });

  test("o lucro pré-IFRS 16 do release é outro número: a CVM recebe o padrão com IFRS 16", () => {
    assert.notEqual(ind.lucroLiquido.valor, RELEASE.lucroPreIfrs16);
    assert.equal(ind.lucroLiquido.valor, 1_300_243);
  });

  test("os arrendamentos ficam fora da dívida bruta (2.01.04 + 2.02.01)", () => {
    assert.equal(dividaBruta(ano(RAIA, "2025-12-31")).valor, 508_137 + 3_359_618);
  });
});

describe("São Martinho: exercício de abril a março", () => {
  const p = ano(SAO_MARTINHO, "2026-03-31");
  const ind = calcularIndicadores(p);

  test("o exercício de 01/04/2025 a 31/03/2026 é anual e tem todos os indicadores", () => {
    assert.deepEqual([p.inicio, p.fim, p.tipo], ["2025-04-01", "2026-03-31", "anual"]);
    for (const [id, r] of Object.entries(ate35(ind))) assert.ok(r.valor != null && r.motivo === null, `${id}: ${r.motivo}`);
  });

  test("valores do exercício (R$ mil)", () => {
    assert.equal(ind.receita.valor, 7_431_765);
    assert.equal(ind.lucroLiquido.valor, 836_177);
    // A D&A vem da DFC ("Depreciação e amortização", 1.086.030). A DVA traz 2.371.247: a diferença é a
    // exaustão do ativo biológico, que a São Martinho lança na DFC como "Ativos biológicos colhidos" e
    // que a regra da D&A não reconhece. É o caso em que a DFC dá menos do que a DVA.
    assert.deepEqual(ind.da, { valor: 1_086_030, motivo: null, origem: "DFC" });
    assert.equal(ind.ebitda.valor, 1_394_801 + 1_086_030);
  });

  test("o ROE usa o PL de 31/03/2026", () => {
    const pl = p.demonstrativos.BPP.contas.find((c) => c.conta === "2.03").valor;
    assert.equal(p.demonstrativos.BPP.fim, "2026-03-31");
    assert.equal(ind.roe.valor, 836_177 / pl);
  });

  test("12 meses até 30/06/2026: fluxos somados e balanço de 30/06", () => {
    const doze = calcularIndicadores(SAO_MARTINHO.doze);
    assert.equal(SAO_MARTINHO.doze.estoques.data, "2026-06-30");
    assert.equal(doze.lucroLiquido.valor, 811_497);
    assert.equal(doze.roe.valor, 811_497 / SAO_MARTINHO.doze.estoques.contas["2.03"].valor);
  });
});

// =====================================================================================
// Caixa, dívida e liquidez (#35)
// =====================================================================================

describe("arrendamentos (IFRS 16): onde procurar, sem contar duas vezes", () => {
  const conta = (codigo, descricao, valor = 10) => ({ conta: codigo, descricao, valor });

  test("a regra fica numa constante: duas contas fixas, dois grupos, a expressão e as exceções", () => {
    assert.deepEqual(ARRENDAMENTOS.fixas, ["2.01.04.03", "2.02.01.03"]);
    assert.deepEqual(ARRENDAMENTOS.grupos, ["2.01.05", "2.02.02"]);
    assert.equal(String(ARRENDAMENTOS.descricao), "/arrendament/i");
    assert.ok(Array.isArray(ARRENDAMENTOS.excecoes));
  });

  test("a expressão pega as descrições que aparecem nas companhias da página", () => {
    for (const d of ["Arrendamentos", "Arrendamentos a pagar", "Passivo de arrendamento", "ARRENDAMENTO MERCANTIL", "Obrigações com arrendamento"]) {
      assert.match(d, ARRENDAMENTOS.descricao, d);
    }
  });

  test("'Aluguéis' não entra: é aluguel a pagar, não passivo de arrendamento", () => {
    assert.doesNotMatch("Aluguéis", ARRENDAMENTOS.descricao);
    assert.deepEqual(contasDeArrendamento([conta("2.01.05.02.04", "Aluguéis")]), []);
  });

  test("entram as contas fixas e as subcontas de outras obrigações que batem na descrição", () => {
    const passivo = [
      conta("2.01.04", ""), conta("2.01.04.03", "Financiamento por Arrendamento", 7), conta("2.02.01.03", "Financiamento por Arrendamento", 9),
      conta("2.01.05.02.07", "Arrendamentos", 20), conta("2.02.02.02.05", "Passivo de arrendamento", 60),
      conta("2.01.05.02.06", "Instrumentos Financeiros Derivativos", 5),
    ];
    assert.deepEqual(contasDeArrendamento(passivo).map((c) => c.conta), ["2.01.04.03", "2.02.01.03", "2.01.05.02.07", "2.02.02.02.05"]);
  });

  test("conta-pai e filha batendo: fica só a pai", () => {
    const passivo = [
      conta("2.02.02.02.05", "Arrendamentos", 100),
      conta("2.02.02.02.05.01", "Arrendamentos de lojas", 70),
      conta("2.02.02.02.05.02", "Arrendamentos de veículos", 30),
    ];
    assert.deepEqual(contasDeArrendamento(passivo).map((c) => c.conta), ["2.02.02.02.05"]);
    const p = anual({ BPP: { "2.01.05.02.07": undefined, "2.02.02.02.05": [100, "Arrendamentos"], "2.02.02.02.05.01": [70, "Arrendamentos de lojas"], "2.02.02.02.05.02": [30, "Arrendamentos de veículos"] } });
    assert.deepEqual(arrendamentos(p), { valor: 100, motivo: null });
  });

  test("filha batendo sem a pai bater: fica a filha", () => {
    const passivo = [conta("2.01.05.02", "Outros", 100), conta("2.01.05.02.07", "Arrendamentos", 30)];
    assert.deepEqual(contasDeArrendamento(passivo).map((c) => c.conta), ["2.01.05.02.07"]);
  });

  test("as subcontas das contas fixas não são somadas de novo (São Martinho: 2.01.04.03.01 e .02)", () => {
    const passivo = [conta("2.01.04.03", "Financiamento por Arrendamento", 514), conta("2.01.04.03.01", "Arrendamento a pagar", 134), conta("2.01.04.03.02", "Parceria agrícola a pagar", 380)];
    assert.deepEqual(contasDeArrendamento(passivo).map((c) => c.conta), ["2.01.04.03"]);
  });

  test("descrição com 'arrendamento' fora dos dois grupos não entra (ex.: provisão em 2.01.06)", () => {
    assert.deepEqual(contasDeArrendamento([conta("2.01.06.02.06", "Provisão para Multas de Cancelamento de Contratos de Arrendamento")]), []);
  });

  test("uma exceção tira a conta que bate na expressão", () => {
    const regra = { ...ARRENDAMENTOS, excecoes: [/a receber/i] };
    const passivo = [conta("2.01.05.02.01", "Arrendamentos a receber de terceiros"), conta("2.01.05.02.02", "Arrendamentos a pagar")];
    assert.deepEqual(contasDeArrendamento(passivo, regra).map((c) => c.conta), ["2.01.05.02.02"]);
  });

  test("sem nenhuma linha de arrendamento (fixas zeradas ou ausentes): null com motivo, nunca 0", () => {
    const motivo = "nenhuma linha de arrendamento identificada no passivo";
    const fixasZeradas = anual({ BPP: { "2.01.05.02.07": undefined, "2.02.02.02.05": undefined } });
    assert.deepEqual(arrendamentos(fixasZeradas), { valor: null, motivo });
    const fixasAusentes = anual({ BPP: { "2.01.05.02.07": undefined, "2.02.02.02.05": undefined, "2.01.04.03": undefined, "2.02.01.03": undefined } });
    assert.deepEqual(arrendamentos(fixasAusentes), { valor: null, motivo });

    // As duas versões "com arrendamentos" ficam null junto; a dívida sem arrendamentos não muda.
    const ind = calcularIndicadores(fixasZeradas);
    assert.deepEqual(ind.arrendamentos, { valor: null, motivo });
    assert.deepEqual(ind.dividaBrutaComArrendamentos, { valor: null, motivo });
    assert.deepEqual(ind.dividaLiquidaComArrendamentos, { valor: null, motivo });
    assert.deepEqual(ind.dividaBruta, { valor: 500, motivo: null });
    assert.deepEqual(ind.dividaLiquida, { valor: 350, motivo: null });
    assert.equal(ind.dividaLiquidaSobreEbitda.valor, 350 / 250);
    assert.equal(ind.roic.valor, (200 * (1 - 0.34)) / 1150);
  });

  test("com a conta fixa de arrendamento preenchida e nenhuma subconta: sai o valor", () => {
    const p = anual({ BPP: { "2.01.05.02.07": undefined, "2.02.02.02.05": undefined, "2.01.04.03": 40, "2.02.01.03": 110 } });
    const ind = calcularIndicadores(p);
    assert.deepEqual(ind.arrendamentos, { valor: 150, motivo: null });
    assert.deepEqual(ind.dividaBruta, { valor: (300 - 40) + (200 - 110), motivo: null });
    assert.deepEqual(ind.dividaBrutaComArrendamentos, { valor: 500, motivo: null });
    // Só uma das duas fixas preenchida também basta.
    const soCurto = anual({ BPP: { "2.01.05.02.07": undefined, "2.02.02.02.05": undefined, "2.01.04.03": 40 } });
    assert.deepEqual(arrendamentos(soCurto), { valor: 40, motivo: null });
  });

  test("zero só quando uma linha de arrendamento identificada informa zero", () => {
    const p = anual({ BPP: { "2.01.05.02.07": [0, "Arrendamentos"], "2.02.02.02.05": undefined } });
    assert.deepEqual(arrendamentos(p), { valor: 0, motivo: null });
  });

  test("sem o passivo, é null com outro motivo", () => {
    assert.deepEqual(arrendamentos(anual({ BPP: null })), { valor: null, motivo: "falta o passivo do balanço" });
  });

  test("os 12 meses leem as subcontas não fixas do balanço do ITR", () => {
    assert.deepEqual(arrendamentos(doze12()), { valor: 80, motivo: null });
    assert.deepEqual(arrendamentos(WEG.doze), { valor: 193_101 + 598_991, motivo: null }); // posição em 30/09/2026
  });
});

describe("série (#33): os estoques dos 12 meses ganham as contas não fixas, sem mudar o resto", () => {
  test("o campo novo `naoFixas` traz as subcontas sem código fixo, com demonstrativo, conta, descrição e valor", () => {
    const { naoFixas } = WEG.doze.estoques;
    assert.deepEqual(naoFixas.find((c) => c.conta === "2.01.05.02.07"), { demonstrativo: "BPP", conta: "2.01.05.02.07", descricao: "Arrendamentos", valor: 193_101 });
    assert.ok(naoFixas.some((c) => c.demonstrativo === "BPA"));
    assert.equal(new Set(naoFixas.map((c) => `${c.demonstrativo}|${c.conta}`)).size, naoFixas.length);
  });

  test("`contas` continua só com contas fixas, e nenhuma conta aparece nos dois campos", () => {
    const { contas, naoFixas } = WEG.doze.estoques;
    assert.equal(contas["2.01.05.02.07"], undefined);
    assert.equal(contas["2.03"].valor, 21_367_143);
    assert.ok(naoFixas.every((c) => !(c.conta in contas)));
  });

  test("ano fechado (Raia): os estoques da DFP também trazem as não fixas", () => {
    assert.equal(RAIA.doze.estoques.naoFixas.find((c) => c.conta === "2.02.02.02.05").valor, 3_945_165);
  });
});

describe("dívida, caixa líquido e as razões: regras de null e de sinal", () => {
  test("caixa líquido: a dívida líquida sai negativa, não null", () => {
    const ind = calcularIndicadores(anual({ BPA: { "1.01.01": 900 } })); // caixa 950, dívida 500
    assert.deepEqual(ind.dividaLiquida, { valor: 500 - 950, motivo: null });
    assert.deepEqual(ind.dividaLiquidaComArrendamentos, { valor: 580 - 950, motivo: null });
    assert.deepEqual(ind.dividaLiquidaSobreEbitda, { valor: (500 - 950) / 250, motivo: null });
  });

  test("EBITDA negativo ou zero: dívida líquida ÷ EBITDA fica null; a dívida líquida continua", () => {
    const negativo = calcularIndicadores(anual({ DRE: { "3.05": -300 } })); // EBITDA = −300 + 50
    assert.deepEqual(negativo.dividaLiquidaSobreEbitda, { valor: null, motivo: "EBITDA zero ou negativo" });
    assert.equal(negativo.dividaLiquida.valor, 350);
    const zero = calcularIndicadores(anual({ DRE: { "3.05": -50 } }));
    assert.deepEqual(zero.dividaLiquidaSobreEbitda, { valor: null, motivo: "EBITDA zero ou negativo" });
  });

  test("EBIT negativo: a cobertura sai negativa, que é valor válido", () => {
    assert.deepEqual(calcularIndicadores(anual({ DRE: { "3.05": -100 } })).coberturaJuros, { valor: -100 / 50, motivo: null });
  });

  test("PL negativo ou zero: dívida bruta ÷ PL fica null; a dívida e o PL continuam", () => {
    const ind = calcularIndicadores(anual({ BPP: { "2.03": -800 } }));
    assert.deepEqual(ind.dividaBrutaSobrePl, { valor: null, motivo: "patrimônio líquido zero ou negativo" });
    assert.deepEqual(ind.patrimonioLiquido, { valor: -800, motivo: null });
    assert.equal(ind.dividaBruta.valor, 500);
    assert.deepEqual(calcularIndicadores(anual({ BPP: { "2.03": 0 } })).dividaBrutaSobrePl, { valor: null, motivo: "patrimônio líquido zero ou negativo" });
  });

  test("dívida zero sem despesa financeira relevante: 'sem dívida financeira' no curto prazo e no custo; o resto continua", () => {
    // despesa financeira de 5 em ativo de 2.000 = 0,25%, abaixo do limite do alerta
    const ind = calcularIndicadores(anual({ BPP: { "2.01.04": 0, "2.02.01": 0 }, DRE: { "3.06": 15, "3.06.02": -5 } }));
    assert.deepEqual(ind.dividaBruta, { valor: 0, motivo: null });
    assert.deepEqual(ind.dividaCurtoPrazo, { valor: null, motivo: "sem dívida financeira" });
    assert.deepEqual(ind.custoDivida, { valor: null, motivo: "sem dívida financeira" });
    assert.deepEqual(ind.dividaLiquida, { valor: -150, motivo: null });
    assert.deepEqual(ind.dividaBrutaSobrePl, { valor: 0, motivo: null });
    assert.deepEqual(ind.dividaBrutaComArrendamentos, { valor: 80, motivo: null });
    assert.equal(ind.roic.valor, (200 * (1 - 0.34)) / (800 - 150));
    assert.equal(ind.coberturaJuros.valor, 200 / 5);
  });

  test("dívida zero com despesa financeira alta (caso da Allos): alerta, e tudo o que depende da dívida fica null", () => {
    // despesa financeira de 50 em ativo de 2.000 = 2,5%
    const ind = calcularIndicadores(anual({ BPP: { "2.01.04": 0, "2.02.01": 0 } }));
    const motivo = "a dívida pode estar fora das contas padrão (despesa financeira de R$ 50 mil sem empréstimos no balanço)";
    for (const id of ["dividaBruta", "dividaBrutaComArrendamentos", "dividaLiquida", "dividaLiquidaComArrendamentos",
      "dividaBrutaSobrePl", "dividaLiquidaSobreEbitda", "dividaCurtoPrazo", "custoDivida", "roic"]) {
      assert.deepEqual(ind[id], { valor: null, motivo }, id);
    }
    // O que não depende da dívida continua.
    assert.equal(ind.caixa.valor, 150);
    assert.equal(ind.arrendamentos.valor, 80);
    assert.equal(ind.despesasFinanceiras.valor, 50);
    assert.equal(ind.coberturaJuros.valor, 4);
    assert.equal(ind.roe.valor, 100 / 800);
    assert.equal(ind.liquidezCorrente.valor, 1.5);
  });

  test("o limite do alerta é 0,5% do ativo: no limite não dispara, acima dispara; o valor vai no motivo com milhar", () => {
    assert.equal(LIMITE_DESPESA_SEM_DIVIDA, 0.005);
    const semDivida = (despesa) => anual({ BPP: { "2.01.04": 0, "2.02.01": 0 }, BPA: { "1": 2_000_000 }, DRE: { "3.06.02": -despesa } });
    assert.deepEqual(dividaBruta(semDivida(10_000)), { valor: 0, motivo: null });
    assert.deepEqual(dividaBruta(semDivida(10_001)), {
      valor: null, motivo: "a dívida pode estar fora das contas padrão (despesa financeira de R$ 10.001 mil sem empréstimos no balanço)",
    });
  });

  test("o alerta não dispara quando há qualquer dívida nas contas padrão, nem sem a despesa financeira ou o ativo", () => {
    assert.equal(dividaBruta(anual({ BPP: { "2.01.04": 1, "2.02.01": 0 } })).valor, 1);
    assert.equal(dividaBruta(anual({ BPP: { "2.01.04": 0, "2.02.01": 0 }, DRE: { "3.06.02": undefined } })).valor, 0);
    assert.equal(dividaBruta(anual({ BPP: { "2.01.04": 0, "2.02.01": 0 }, BPA: { "1": undefined } })).valor, 0);
  });

  test("despesas financeiras: só troca o sinal, sem valor absoluto", () => {
    assert.deepEqual(despesasFinanceiras(anual()), { valor: 50, motivo: null });
    assert.deepEqual(despesasFinanceiras(anual({ DRE: { "3.06.02": 50 } })), { valor: -50, motivo: null });
    assert.ok(Object.is(despesasFinanceiras(anual({ DRE: { "3.06": 0, "3.06.01": 0, "3.06.02": 0 } })).valor, 0));
  });

  test("despesas financeiras zero ou negativas: cobertura e custo da dívida ficam null", () => {
    for (const v of [0, 50]) {
      const ind = calcularIndicadores(anual({ DRE: { "3.06": 20 + -v, "3.06.02": v } }));
      assert.deepEqual(ind.coberturaJuros, { valor: null, motivo: "despesas financeiras zero ou negativas" }, String(v));
      assert.deepEqual(ind.custoDivida, { valor: null, motivo: "despesas financeiras zero ou negativas" }, String(v));
    }
  });

  test("resultado financeiro informado só pelo líquido (3.06.01 e 3.06.02 zeradas): despesas null, não zero", () => {
    const ind = calcularIndicadores(anual({ DRE: { "3.06": -30, "3.06.01": 0, "3.06.02": 0 } }));
    const motivo = "a companhia não abre o resultado financeiro em receitas e despesas";
    for (const id of ["despesasFinanceiras", "coberturaJuros", "custoDivida"]) assert.deepEqual(ind[id], { valor: null, motivo }, id);
    assert.equal(ind.resultadoFinanceiro.valor, -30);
    assert.equal(ind.dividaBruta.valor, 500);
  });

  test("passivo circulante zero: as duas liquidezes ficam null", () => {
    const ind = calcularIndicadores(anual({ BPP: { "2.01": 0 } }));
    for (const id of ["liquidezCorrente", "liquidezImediata"]) assert.deepEqual(ind[id], { valor: null, motivo: "passivo circulante zero ou negativo" }, id);
  });

  test("conta ausente: o motivo diz qual falta", () => {
    assert.deepEqual(calcularIndicadores(anual({ BPA: { "1.01": undefined } })).liquidezCorrente, { valor: null, motivo: "falta a conta 1.01 (ativo circulante)" });
    assert.deepEqual(calcularIndicadores(anual({ BPP: { "2.01": undefined } })).liquidezImediata, { valor: null, motivo: "falta a conta 2.01 (passivo circulante)" });
    assert.deepEqual(calcularIndicadores(anual({ DRE: { "3.06.02": undefined } })).despesasFinanceiras, { valor: null, motivo: "falta a conta 3.06.02 (despesas financeiras)" });
  });

  test("período de transição: os saldos saem; as razões que usam fluxo ficam null, sem anualizar", () => {
    const ind = calcularIndicadores(anual({}, { tipo: "transicao", meses: 9 }));
    const motivo = "período de 9 meses, indicador não anualizado";
    for (const id of ["dividaLiquidaSobreEbitda", "coberturaJuros", "custoDivida"]) assert.deepEqual(ind[id], { valor: null, motivo }, id);
    // Balanço não se anualiza: saldos e razões só de balanço saem normalmente.
    assert.equal(ind.patrimonioLiquido.valor, 800);
    assert.equal(ind.caixa.valor, 150);
    assert.equal(ind.dividaBruta.valor, 500);
    assert.equal(ind.arrendamentos.valor, 80);
    assert.equal(ind.dividaLiquida.valor, 350);
    assert.equal(ind.dividaBrutaSobrePl.valor, 500 / 800);
    assert.equal(ind.dividaCurtoPrazo.valor, 0.6);
    assert.equal(ind.liquidezCorrente.valor, 1.5);
    assert.equal(ind.liquidezImediata.valor, 150 / 400);
    assert.equal(ind.despesasFinanceiras.valor, 50); // o fluxo do período sai, como os da #34
  });

  test("12 meses indisponível: os indicadores novos também ficam null com o motivo da série", () => {
    const motivo = "falta o ITR de 30/06/2025, de onde sai o acumulado do ano anterior";
    const ind = calcularIndicadores({ tipo: "indisponivel", motivo, fim: "2026-06-30", parcelas: null, fluxos: null, estoques: null });
    for (const id of ["patrimonioLiquido", "caixa", "dividaBruta", "arrendamentos", "dividaLiquida", "liquidezCorrente"]) {
      assert.deepEqual(ind[id], { valor: null, motivo }, id);
    }
    assert.deepEqual(arrendamentos({ tipo: "indisponivel", motivo, fluxos: null, estoques: null }), { valor: null, motivo });
  });
});

// Critério de aceite da #35: valores conferidos contra o balanço publicado de 2 empresas.
describe("balanço publicado: WEG em 31/12/2025", () => {
  // Fonte: WEG S.A., "Release de Resultados 4T 2025", 25/02/2026, no site de RI da companhia:
  //   https://api.mziq.com/mzfilemanager/v2/d/50c1bd3e-8ac6-42d9-884f-b9d69f690602/e93d71d4-7174-addd-7179-527d63dc51ce?origin=2
  //   (link "Release Resultados 4T25" de https://ri.weg.net/informacoes-financeiras/central-de-resultados/, consultado em 13/11/2026).
  //   Página 11, "Anexo III - Balanço Patrimonial Consolidado", coluna Dezembro 2025, em R$ mil:
  //     Ativo Circulante                      26.910.845
  //     Disponibilidades                       7.279.865
  //     Passivo Circulante                    17.386.401
  //     Empréstimos e Financiamentos (CP)      3.549.314
  //     Arrendamento Mercantil (CP)              221.934
  //     Empréstimos e Financiamentos (LP)      1.041.508
  //     Arrendamento Mercantil (LP)              625.219
  //     Patrimônio Líquido                    18.553.364
  const BALANCO = {
    ativoCirculante: 26_910_845, disponibilidades: 7_279_865, passivoCirculante: 17_386_401,
    emprestimosCp: 3_549_314, arrendamentoCp: 221_934, emprestimosLp: 1_041_508, arrendamentoLp: 625_219, pl: 18_553_364,
  };
  const ind = calcularIndicadores(ano(WEG, "2025-12-31"));

  test("caixa, dívida bruta, arrendamentos e PL iguais aos do balanço", () => {
    assert.equal(ind.caixa.valor, BALANCO.disponibilidades);
    assert.equal(ind.dividaBruta.valor, BALANCO.emprestimosCp + BALANCO.emprestimosLp);
    assert.equal(ind.arrendamentos.valor, BALANCO.arrendamentoCp + BALANCO.arrendamentoLp);
    assert.equal(ind.patrimonioLiquido.valor, BALANCO.pl);
  });

  test("valores em R$ milhões: dívida bruta 4.591, caixa 7.280, dívida líquida −2.689 (caixa líquido)", () => {
    emMilhoes(ind.dividaBruta.valor, 4_591, "dívida bruta");
    emMilhoes(ind.caixa.valor, 7_280, "caixa");
    emMilhoes(ind.dividaLiquida.valor, -2_689, "dívida líquida");
    assert.ok(ind.dividaLiquida.valor < 0 && ind.dividaLiquida.motivo === null);
    assert.equal(ind.dividaLiquida.valor, 4_590_822 - 7_279_865);
  });

  test("dívida bruta ÷ PL ≈ 0,25 e curto prazo ≈ 77%", () => {
    assert.ok(Math.abs(ind.dividaBrutaSobrePl.valor - 0.25) < 0.005, String(ind.dividaBrutaSobrePl.valor));
    assert.ok(Math.abs(ind.dividaCurtoPrazo.valor - 0.77) < 0.005, String(ind.dividaCurtoPrazo.valor));
    assert.equal(ind.dividaCurtoPrazo.valor, BALANCO.emprestimosCp / (BALANCO.emprestimosCp + BALANCO.emprestimosLp));
  });

  test("arrendamentos = 221.934 (curto prazo) + 625.219 (longo prazo), e as duas versões da dívida", () => {
    assert.ok(ind.arrendamentos.valor >= 221_934);
    assert.equal(ind.arrendamentos.valor, 847_153);
    assert.equal(ind.dividaBrutaComArrendamentos.valor, 4_590_822 + 847_153);
    assert.equal(ind.dividaLiquidaComArrendamentos.valor, 4_590_822 + 847_153 - 7_279_865);
  });

  test("caixa líquido: dívida líquida ÷ EBITDA negativa, não null", () => {
    assert.equal(ind.dividaLiquidaSobreEbitda.valor, (4_590_822 - 7_279_865) / 9_000_037);
  });

  test("liquidez corrente e imediata com o circulante do balanço", () => {
    assert.equal(ind.liquidezCorrente.valor, BALANCO.ativoCirculante / BALANCO.passivoCirculante);
    assert.equal(ind.liquidezImediata.valor, BALANCO.disponibilidades / BALANCO.passivoCirculante);
  });

  test("despesas financeiras, cobertura e custo aproximado (DRE 3.06.02 = −2.173.378)", () => {
    assert.equal(ind.despesasFinanceiras.valor, 2_173_378);
    assert.equal(ind.coberturaJuros.valor, 7_998_741 / 2_173_378);
    assert.equal(ind.custoDivida.valor, 2_173_378 / 4_590_822);
  });

  test("a correção da 2.01.04.03 não muda o ROIC da WEG (a subconta vem zerada)", () => {
    assert.equal(ind.roic.valor, (7_998_741 * (1 - 0.34)) / (18_553_364 + 4_590_822 - 7_279_865));
  });
});

describe("balanço publicado: Raia Drogasil (RD Saúde) em 31/12/2025", () => {
  // Fonte: RD Saúde (Raia Drogasil S.A.), "Resultados 4T25", 03/03/2026, no site de RI da companhia:
  //   https://ri.rdsaude.com.br/Download.aspx?Arquivo=5qQVLymU2JrA/iPP5ZJdWg==
  //   (link "Resultados 4T25" de https://ri.rdsaude.com.br/central-de-resultados, consultado em 13/11/2026).
  //   Página 21, balanço consolidado, coluna 4T25, em R$ mil:
  //     Caixa e Equivalentes de Caixa             509.619
  //     Aplicações Financeiras                     19.120
  //     Empréstimos e Financiamentos (CP)         508.137
  //     Empréstimos e Financiamentos (LP)       3.359.618
  //   Página 17, "IFRS-16", balanço, coluna "IFRS 16", em R$ milhões (o release é pré-IFRS 16 e só
  //   mostra os arrendamentos nesta reconciliação):
  //     Arrendamentos Financeiros a Pagar (circulante)       1.021,1
  //     Arrendamentos Financeiros a Pagar (não circulante)   3.945,2
  const BALANCO = { caixa: 509_619, aplicacoes: 19_120, emprestimosCp: 508_137, emprestimosLp: 3_359_618, arrendamentoCpMi: 1_021.1, arrendamentoLpMi: 3_945.2 };
  const p = ano(RAIA, "2025-12-31");
  const ind = calcularIndicadores(p);

  test("caixa e dívida bruta iguais aos do balanço: 3.867.755 de dívida", () => {
    assert.equal(ind.caixa.valor, BALANCO.caixa + BALANCO.aplicacoes);
    assert.equal(ind.dividaBruta.valor, BALANCO.emprestimosCp + BALANCO.emprestimosLp);
    assert.equal(ind.dividaBruta.valor, 3_867_755);
  });

  test("arrendamentos = 1.021.147 + 3.945.165 = 4.966.312, batendo com a reconciliação do release", () => {
    assert.deepEqual(ind.arrendamentos, { valor: 1_021_147 + 3_945_165, motivo: null });
    assert.equal(ind.arrendamentos.valor, 4_966_312);
    assert.ok(Math.abs(ind.arrendamentos.valor / 1000 - (BALANCO.arrendamentoCpMi + BALANCO.arrendamentoLpMi)) <= 0.1);
  });

  test("'Aluguéis' (2.01.05.02.04, 132.470) fica de fora", () => {
    const linhas = contasDeArrendamento(adaptarPeriodo(p).passivo()).filter((c) => c.valor !== 0);
    assert.deepEqual(linhas.map((c) => [c.conta, c.descricao, c.valor]), [
      ["2.01.05.02.06", "Arrendamentos a pagar", 1_021_147],
      ["2.02.02.02.05", "Arrendamentos a pagar", 3_945_165],
    ]);
    assert.equal(adaptarPeriodo(p).passivo().find((c) => c.conta === "2.01.05.02.04").valor, 132_470);
  });

  test("o arrendamento é maior que a dívida: as duas versões ficam bem diferentes", () => {
    assert.ok(ind.arrendamentos.valor > ind.dividaBruta.valor);
    assert.equal(ind.dividaLiquida.valor, 3_867_755 - 528_739);
    assert.equal(ind.dividaLiquidaComArrendamentos.valor, 3_867_755 + 4_966_312 - 528_739);
    assert.equal(ind.dividaBrutaComArrendamentos.valor, 8_834_067);
  });

  test("os 12 meses (ano fechado) dão os mesmos saldos", () => {
    const doze = calcularIndicadores(RAIA.doze);
    for (const id of ["caixa", "dividaBruta", "arrendamentos", "dividaLiquida", "liquidezCorrente"]) assert.deepEqual(doze[id], ind[id], id);
  });
});

describe("São Martinho: arrendamento lançado dentro de empréstimos e financiamentos", () => {
  // Em 31/03/2026 (R$ mil): 2.01.04 = 1.444.574, com 514.175 de "Financiamento por Arrendamento" (2.01.04.03);
  // 2.02.01 = 10.108.535, com 1.798.271 em 2.02.01.03. A soma simples das duas contas incluía os arrendamentos.
  const p = ano(SAO_MARTINHO, "2026-03-31");
  const ind = calcularIndicadores(p);

  test("a dívida bruta tira as duas subcontas de arrendamento", () => {
    assert.equal(ind.dividaBruta.valor, (1_444_574 - 514_175) + (10_108_535 - 1_798_271));
    assert.equal(ind.dividaBruta.valor, 930_399 + 8_310_264); // = 2.01.04.01 + 2.02.01.01
  });

  test("os arrendamentos são as duas contas fixas, sem somar as subcontas delas de novo", () => {
    assert.equal(ind.arrendamentos.valor, 514_175 + 1_798_271);
    assert.equal(ind.dividaBrutaComArrendamentos.valor, 1_444_574 + 10_108_535);
  });

  test("o ROIC passa a usar a dívida corrigida: capital investido menor do que na conta da #34", () => {
    const pl = p.demonstrativos.BPP.contas.find((c) => c.conta === "2.03").valor;
    const capital = pl + 9_240_663 - 4_202_901;
    assert.equal(capitalInvestido(p).valor, capital);
    assert.equal(ind.roic.valor, (1_394_801 * (1 - 0.34)) / capital);
    assert.ok(capital < pl + 11_553_109 - 4_202_901);
  });

  test("a parte de curto prazo também é sem arrendamento", () => {
    assert.equal(ind.dividaCurtoPrazo.valor, 930_399 / 9_240_663);
  });
});

describe("dívida por descrição: empréstimos, financiamentos e debêntures em outras obrigações", () => {
  const conta = (codigo, descricao, valor = 10) => ({ conta: codigo, descricao, valor, contaFixa: false });

  test("a regra fica numa constante: grupos de curto e de longo prazo, as duas expressões e a exceção", () => {
    assert.deepEqual(DIVIDA_POR_DESCRICAO.grupos, { curto: "2.01.05", longo: "2.02.02" });
    assert.deepEqual(DIVIDA_POR_DESCRICAO.descricao.map(String), ["/empr[ée]stimo/i", "/financiament|deb[êe]nture/i"]);
    assert.deepEqual(DIVIDA_POR_DESCRICAO.excecoes.map(String), ["/compuls/i"]);
  });

  test("a descrição tem de bater com as duas expressões", () => {
    const passivo = [
      conta("2.01.05.02.01", "Empréstimos, financiamentos e debêntures"),
      conta("2.01.05.02.02", "Emprestimos e Financiamentos"),
      conta("2.01.05.02.03", "Empréstimos e debêntures"),
      conta("2.01.05.02.04", "Empréstimos"), // só uma das duas
      conta("2.01.05.02.05", "Financiamento por Arrendamento"), // C&A: é arrendamento
      conta("2.01.05.02.06", "Ajuste a valor justo das debêntures  a apropriar"), // Eneva
      conta("2.01.05.02.07", "Debêntures"),
    ];
    assert.deepEqual(contasDeDividaPorDescricao(passivo).curto.map((c) => c.conta), ["2.01.05.02.01", "2.01.05.02.02", "2.01.05.02.03"]);
  });

  test("o empréstimo compulsório fica de fora, mesmo com as duas palavras na descrição", () => {
    const passivo = [conta("2.01.05.02.05", "Empréstimo compulsório"), conta("2.01.05.02.06", "Empréstimo compulsório - Acordos"),
      conta("2.01.05.02.08", "Empréstimo compulsório - financiamento de acordos")];
    assert.deepEqual(contasDeDividaPorDescricao(passivo), { curto: [], longo: [] });
  });

  test("curto e longo prazo são separados pelo grupo; fora dos dois grupos não entra", () => {
    const passivo = [
      conta("2.01.05.02.05", "Empréstimos, financiamentos e debêntures", 30),
      conta("2.02.02.02.07", "Empréstimos, financiamentos e debêntures", 70),
      conta("2.02.04.02.01", "Empréstimos e financiamentos", 99),
    ];
    const { curto, longo } = contasDeDividaPorDescricao(passivo);
    assert.deepEqual([curto.map((c) => c.valor), longo.map((c) => c.valor)], [[30], [70]]);
  });

  test("conta e ancestral batendo: fica só o ancestral", () => {
    const passivo = [
      conta("2.02.02.02.07", "Empréstimos, financiamentos e debêntures", 100),
      conta("2.02.02.02.07.01", "Empréstimos e financiamentos", 60),
      conta("2.02.02.02.07.02", "Empréstimos e debêntures", 40),
    ];
    assert.deepEqual(contasDeDividaPorDescricao(passivo).longo.map((c) => c.conta), ["2.02.02.02.07"]);
    const p = anual({ BPP: { "2.02.02.02.07": [100, "Empréstimos, financiamentos e debêntures"], "2.02.02.02.07.01": [60, "Empréstimos e financiamentos"], "2.02.02.02.07.02": [40, "Empréstimos e debêntures"] } });
    assert.equal(dividaBruta(p).valor, 500 + 100);
  });

  test("só subconta não fixa entra: uma conta fixa com a mesma descrição não é somada", () => {
    const passivo = [{ conta: "2.01.05.02.09", descricao: "Empréstimos e Financiamentos", valor: 10, contaFixa: true }];
    assert.deepEqual(contasDeDividaPorDescricao(passivo).curto, []);
  });

  test("a dívida por descrição soma na dívida bruta, no curto prazo, na líquida e no capital investido", () => {
    const p = anual({ BPP: { "2.01.05.02.05": [30, "Empréstimos, financiamentos e debêntures"], "2.02.02.02.07": [70, "Empréstimos, financiamentos e debêntures"] } });
    const ind = calcularIndicadores(p);
    assert.equal(ind.dividaBruta.valor, 500 + 30 + 70);
    assert.equal(ind.dividaCurtoPrazo.valor, (300 + 30) / 600);
    assert.equal(ind.dividaLiquida.valor, 600 - 150);
    assert.equal(ind.dividaBrutaComArrendamentos.valor, 600 + 80);
    assert.equal(ind.roic.valor, (200 * (1 - 0.34)) / (800 + 600 - 150));
    assert.equal(ind.arrendamentos.valor, 80); // a linha de dívida não vira arrendamento
  });

  test("nos 12 meses a regra lê as subcontas não fixas do balanço do ITR", () => {
    const d = doze12();
    d.estoques.naoFixas.push({ demonstrativo: "BPP", conta: "2.02.02.02.07", descricao: "Empréstimos, financiamentos e debêntures", valor: 70 });
    assert.equal(dividaBruta(d).valor, 570);
  });

  test("a fórmula da dívida bruta cita as linhas de outras obrigações", () => {
    assert.match(INDICADORES.find((i) => i.id === "dividaBruta").formula, /mais as linhas de empréstimos, financiamentos e debêntures em outras obrigações/);
  });

  test("WEG, Raia e São Martinho não têm linha que bata: a dívida delas não muda", () => {
    for (const [serie, fim] of [[WEG, "2025-12-31"], [RAIA, "2025-12-31"], [SAO_MARTINHO, "2026-03-31"]]) {
      assert.deepEqual(contasDeDividaPorDescricao(adaptarPeriodo(ano(serie, fim)).passivo()), { curto: [], longo: [] });
    }
  });
});

describe("Allos: a dívida está em outras obrigações (linhas da DFP de 31/12/2025, R$ mil)", () => {
  // Contas, descrições e valores como estão no dfp_cia_aberta_BPP_con_2025.csv da CVM (varredura da #35).
  // A 2.01.04 e a 2.02.01 vêm zeradas. O resto do período é o exercício sintético.
  const allos = (extra = {}) => anual({
    BPA: { "1": 26_006_000 },
    DRE: { "3.06.02": -1_010_822 },
    BPP: {
      "2.01.04": 0, "2.02.01": 0, "2.03": 13_899_006,
      "2.01.05.02.05": [325_357, "Empréstimos, financiamentos e debêntures"],
      "2.01.05.02.07": [27_042, "Passivo de arrendamento"],
      "2.02.02.02.07": [5_553_953, "Empréstimos, financiamentos e debêntures"],
      "2.02.02.02.05": undefined,
      "2.02.02.02.08": [193_326, "Passivo de arrendamento"],
      ...extra,
    },
  });

  test("dívida bruta = 325.357 + 5.553.953 = 5.879.310, e o alerta não dispara mais", () => {
    assert.deepEqual(dividaBruta(allos()), { valor: 5_879_310, motivo: null });
  });

  test("curto prazo, arrendamentos e ROIC saem com valor", () => {
    const ind = calcularIndicadores(allos());
    assert.equal(ind.dividaCurtoPrazo.valor, 325_357 / 5_879_310);
    assert.equal(ind.arrendamentos.valor, 27_042 + 193_326);
    assert.equal(ind.dividaBrutaComArrendamentos.valor, 5_879_310 + 220_368);
    assert.equal(ind.roic.valor, (200 * (1 - 0.34)) / (13_899_006 + 5_879_310 - 150));
    assert.equal(ind.custoDivida.valor, 1_010_822 / 5_879_310);
  });

  test("sem as duas linhas, o mesmo período dispara o alerta de dívida fora das contas padrão", () => {
    const p = allos({ "2.01.05.02.05": undefined, "2.02.02.02.07": undefined });
    assert.deepEqual(dividaBruta(p), {
      valor: null, motivo: "a dívida pode estar fora das contas padrão (despesa financeira de R$ 1.010.822 mil sem empréstimos no balanço)",
    });
  });
});

describe("Axia: o empréstimo compulsório não entra na dívida (linhas da DFP de 31/12/2025, R$ mil)", () => {
  // Contas, descrições e valores das duas linhas como estão no arquivo da CVM. A dívida das contas fixas é sintética.
  const axia = anual({
    BPP: {
      "2.01.05.02.05": [1_406_460, "Empréstimo compulsório"],
      "2.01.05.02.06": [1_073_452, "Empréstimo compulsório - Acordos"],
    },
  });

  test("a dívida bruta fica só com as contas fixas", () => {
    assert.deepEqual(contasDeDividaPorDescricao(adaptarPeriodo(axia).passivo()), { curto: [], longo: [] });
    assert.deepEqual(dividaBruta(axia), { valor: 500, motivo: null });
    assert.equal(calcularIndicadores(axia).dividaCurtoPrazo.valor, 300 / 500);
  });
});
