import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { interpretarArquivo, lerArquivos } from "../scripts/cvm/leitor.mjs";
import { montarSeries } from "../scripts/cvm/series.mjs";
import {
  ALIQUOTA_ROIC, INDICADORES, adaptarPeriodo, caixa, calcularIndicadores, capitalInvestido, dividaBruta,
} from "../scripts/cvm/indicadores.mjs";

// ---------- fixtures reais (test/fixtures/cvm), lidas pelo leitor da #31 e pela série da #33 ----------
const DIR = new URL("./fixtures/cvm/", import.meta.url);
const seriesDe = (pasta) => montarSeries(lerArquivos(readdirSync(new URL(`${pasta}/`, DIR)).filter((n) => interpretarArquivo(n))
  .map((nome) => ({ nome, linhas: new TextDecoder("latin1").decode(readFileSync(new URL(`${pasta}/${nome}`, DIR))).split("\n") }))));

const WEG = seriesDe("weg");
const RAIA = seriesDe("raia-drogasil");
const SAO_MARTINHO = seriesDe("sao-martinho");

const ano = (serie, fim) => serie.anual.find((p) => p.fim === fim);
const valores = (ind) => Object.fromEntries(Object.entries(ind).map(([id, r]) => [id, r.valor]));
// Compara em R$ milhões, com tolerância de 0,5 (os números de referência são arredondados).
const emMilhoes = (emMil, esperado, rotulo) =>
  assert.ok(Math.abs(emMil / 1000 - esperado) <= 0.5, `${rotulo}: ${emMil / 1000} não bate com ${esperado}`);

// ---------- períodos sintéticos ----------
const bloco = (contas) => ({ contas: Object.entries(contas).map(([conta, valor]) => ({ conta, descricao: "", contaFixa: true, valor })) });
// Um exercício saudável: receita 1.000, lucro bruto 400, EBIT 200, D&A 50, lucro 100,
// ativo 2.000, PL 800, dívida 300 + 200, caixa 100 + 50.
const BASE = {
  DRE: { "3.01": 1000, "3.03": 400, "3.05": 200, "3.06": -30, "3.11": 100 },
  DVA: { "7.04.01": -50 },
  BPA: { "1": 2000, "1.01.01": 100, "1.01.02": 50 },
  BPP: { "2.01.04": 300, "2.02.01": 200, "2.03": 800 },
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
  for (const demo of ["BPA", "BPP"]) for (const [conta, valor] of Object.entries(BASE[demo])) contas[conta] = { demonstrativo: demo, descricao: "", valor };
  return { tipo: "itr", motivo: null, fim: "2026-09-30", parcelas: {}, fluxos, estoques: { data: "2026-09-30", origem: {}, contas } };
}

describe("INDICADORES: a lista que a página vai mostrar", () => {
  test("cada item tem id, nome, unidade conhecida e fórmula não vazia", () => {
    for (const i of INDICADORES) {
      assert.ok(i.id && i.nome, JSON.stringify(i));
      assert.ok(["R$ mil", "razão"].includes(i.unidade), i.id);
      assert.ok(typeof i.formula === "string" && i.formula.trim().length > 10, i.id);
    }
  });

  test("os 13 indicadores do briefing, na ordem, sem id repetido", () => {
    assert.deepEqual(INDICADORES.map((i) => i.id), [
      "receita", "lucroBruto", "margemBruta", "ebit", "da", "ebitda", "margemEbitda",
      "resultadoFinanceiro", "lucroLiquido", "margemLiquida", "roe", "roa", "roic",
    ]);
  });

  test("valores em R$ mil e razões estão marcados com a unidade certa", () => {
    const razoes = INDICADORES.filter((i) => i.unidade === "razão").map((i) => i.id);
    assert.deepEqual(razoes, ["margemBruta", "margemEbitda", "margemLiquida", "roe", "roa", "roic"]);
  });

  test("calcularIndicadores devolve exatamente os ids da lista, cada um com valor e motivo", () => {
    const ind = calcularIndicadores(anual());
    assert.deepEqual(Object.keys(ind), INDICADORES.map((i) => i.id));
    for (const r of Object.values(ind)) assert.deepEqual(Object.keys(r), ["valor", "motivo"]);
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
  };
  for (const [id, esperado] of Object.entries(casos)) {
    test(`${id} = ${esperado}`, () => assert.deepEqual(ind[id], { valor: esperado, motivo: null }));
  }

  test("todo id de INDICADORES tem um caso aqui", () => {
    assert.deepEqual(Object.keys(casos), INDICADORES.map((i) => i.id));
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
    assert.deepEqual(calcularIndicadores(doze12()), ind);
  });
});

describe("caixa, dívida bruta e capital investido (reutilizados na #35)", () => {
  test("caixa = 1.01.01 + 1.01.02", () => {
    assert.deepEqual(caixa(anual()), { valor: 150, motivo: null });
    assert.deepEqual(caixa(doze12()), { valor: 150, motivo: null });
  });
  test("dívida bruta = 2.01.04 + 2.02.01", () => {
    assert.deepEqual(dividaBruta(anual()), { valor: 500, motivo: null });
    assert.deepEqual(dividaBruta(doze12()), { valor: 500, motivo: null });
  });
  test("capital investido = PL + dívida bruta − caixa", () => {
    assert.deepEqual(capitalInvestido(anual()), { valor: 800 + 500 - 150, motivo: null });
  });
  test("zero informado é zero, não ausência", () => {
    assert.deepEqual(caixa(anual({ BPA: { "1.01.02": 0 } })), { valor: 100, motivo: null });
    assert.deepEqual(dividaBruta(anual({ BPP: { "2.01.04": 0, "2.02.01": 0 } })), { valor: 0, motivo: null });
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

  test("DVA ausente: D&A, EBITDA e margem EBITDA null; o EBIT não vira EBITDA", () => {
    const ind = calcularIndicadores(anual({ DVA: null }));
    const motivo = "falta a conta 7.04.01 (depreciação e amortização, na DVA)";
    for (const id of ["da", "ebitda", "margemEbitda"]) assert.deepEqual(ind[id], { valor: null, motivo }, id);
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
    for (const [id, r] of Object.entries(ind)) assert.deepEqual(r, { valor: null, motivo }, id);
    assert.deepEqual(caixa({ tipo: "indisponivel", motivo, fluxos: null, estoques: null }), { valor: null, motivo });
  });

  test("período sem demonstrativo de fluxo (tipo null na série): tudo null com motivo", () => {
    const ind = calcularIndicadores({ inicio: null, fim: "2025-12-31", tipo: null, dias: null, meses: null, demonstrativos: {} });
    for (const r of Object.values(ind)) assert.deepEqual(r, { valor: null, motivo: "o período não tem DRE, DFC nem DVA" });
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
    assert.deepEqual(calcularIndicadores(RAIA.doze), calcularIndicadores(ano(RAIA, "2025-12-31")));
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
    assert.deepEqual(valores(ind), {
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
    });
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
    // D&A: 1.001.296 (2025) + 772.679 (9M26) − acumulado 9M25 do ITR de 30/09/2025
    assert.equal(ind.da.valor, 1_068_117);
    assert.equal(ind.ebitda.valor, 7_884_487 + 1_068_117);
    assert.equal(ind.roe.valor, 6_690_278 / WEG.doze.estoques.contas["2.03"].valor);
    assert.equal(WEG.doze.estoques.data, "2026-09-30");
  });
});

// Critério de aceite da #34: valores batendo com o release de resultados de 2 empresas.
describe("release de resultados: WEG 4T25", () => {
  // Fonte: WEG S.A., "Release de Resultados 4T 2025", Jaraguá do Sul, 25/02/2026.
  //   PDF consultado em 13/11/2026: https://investidor10.com.br/acoes/link_comunicado/WEGE3/32276/
  //   (cópia do documento publicado em https://ri.weg.net).
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
  //   PDF consultado em 13/11/2026: https://investidor10.com.br/acoes/link_comunicado/RADL3/32839/
  //   (cópia do documento publicado em https://ri.rdsaude.com.br).
  //   O release é escrito no padrão pré-IFRS 16 (página 1); a página 18 ("IFRS-16") reconcilia com o
  //   padrão das demonstrações financeiras, que é o que a CVM recebe.
  //   Página 21, "Demonstração do Resultado Consolidado", coluna 2025, em R$ mil:
  //     Receita líquida de vendas e serviços   44.250.449   (igual nos dois padrões)
  //     Lucro líquido                           1.362.494   (pré-IFRS 16)
  //   Página 18, coluna "2025 IFRS 16", em R$ milhões:
  //     Lucro Líquido                             1.300,3
  //
  // EBITDA: não comparado. O release só publica o EBITDA pré-IFRS 16 (3.434,0, página 14) e o
  // ajustado (3.374,8 pré-IFRS 16 e 4.688,2 em IFRS 16, página 18). Não há "EBITDA (RCVM 156)" no
  // padrão das demonstrações financeiras, que é o do nosso cálculo (4.756,6).
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
    for (const [id, r] of Object.entries(ind)) assert.ok(r.valor != null && r.motivo === null, `${id}: ${r.motivo}`);
  });

  test("valores do exercício (R$ mil)", () => {
    assert.equal(ind.receita.valor, 7_431_765);
    assert.equal(ind.lucroLiquido.valor, 836_177);
    assert.equal(ind.da.valor, 2_371_247);
    assert.equal(ind.ebitda.valor, 1_394_801 + 2_371_247);
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
