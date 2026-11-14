// Consistência ao longo dos anos, pontos de atenção e comparação com o setor (#39).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  anosPositivos, calcularConsistencia, crescimentoComposto, estabilidadeDaMargem, maiorSequenciaPositiva, piorAno, serieDeAnos,
} from "../scripts/fundamentos/consistencia.mjs";
import {
  LIMITES_ATENCAO, VARIAVEIS_ATENCAO, calcularAtencao, capexMaiorQueFco, configAtencao, diluicao, dividaLiquidaAlta, dividaNoCurtoPrazo,
  fonteDeHoje, lucroQueNaoViraCaixa, margemEmQueda, proventosMaioresQueFcl,
} from "../scripts/fundamentos/atencao.mjs";
import { INDICADORES_DE_PARES, MINIMO_DE_EMPRESAS, MINIMO_PARA_QUARTIL, calcularPares, exercicioDoSetor, mediana, posicaoNaAmostra, quartil } from "../scripts/fundamentos/pares.mjs";
import { LEGENDA_DA_ATENCAO, atencaoHtml, consistenciaHtml, paresHtml, resumoHtml } from "../scripts/fundamentos/resumo.mjs";
import { fichaHtml } from "../scripts/fundamentos/pagina.mjs";
import { montarFichas } from "../scripts/cvm/ficha.mjs";
import { MOTIVO_DEMONSTRACAO_ZERADA } from "../scripts/cvm/indicadores.mjs";
import { ARQUIVO, COTACOES, HOJE, WEG, fichaDaWeg } from "./apoio/ficha.mjs";

// ---------- fichas sintéticas ----------
// Indicadores de um período: número vira { valor, motivo: null }; null vira { valor: null, motivo };
// { motivo } dá o motivo do vazio.
const ind = (valores) => Object.fromEntries(Object.entries(valores).map(([id, v]) => [id,
  typeof v === "number" ? { valor: v, motivo: null } : { valor: null, motivo: v?.motivo ?? "sem dado" }]));
// Um exercício de 12 meses que termina em 31/12 do ano dado.
const ano = (a, valores, extra = {}) => ({ inicio: `${a}-01-01`, fim: `${a}-12-31`, tipo: "anual", meses: 12, indicadores: ind({ receita: 1000, lucroLiquido: 100, patrimonioLiquido: 500, ...valores }), ...extra });
const ficha = (anual, doze = null, extra = {}) => ({ ticker: "TEST3", setor: "Setor de teste", anual, doze: doze ? { fim: "2026-09-30", tipo: "itr", motivo: null, indicadores: ind(doze) } : { fim: null, tipo: null, motivo: "sem 12 meses", indicadores: {} }, ...extra });
// Série de anos seguidos a partir de `inicio`, com a lista de valores de um indicador.
const serie = (inicio, id, valores, comum = {}) => valores.map((v, i) => ano(inicio + i, { ...comum, [id]: v }));
const anosDe = (f) => serieDeAnos(f).anos;
const semMotivo = (r) => ({ acionada: r.acionada, anos: r.anos });

describe("série usada: só os exercícios de 12 meses com dado", () => {
  test("período de transição e período indisponível ficam de fora, com o motivo", () => {
    const zerado = ano(2018, {});
    for (const id of Object.keys(zerado.indicadores)) zerado.indicadores[id] = { valor: null, motivo: MOTIVO_DEMONSTRACAO_ZERADA };
    const f = ficha([zerado, ano(2019, {}), ano(2020, {}, { tipo: "transicao", meses: 9 }), ano(2021, {})]);
    const { anos, fora } = serieDeAnos(f);
    assert.deepEqual(anos.map((a) => a.rotulo), ["2019", "2021"]);
    assert.deepEqual(fora, [{ fim: "2018-12-31", rotulo: "2018", motivo: "demonstração zerada no documento" }, { fim: "2020-12-31", rotulo: "2020", motivo: "exercício de 9 meses" }]);
    assert.deepEqual(calcularConsistencia(f).periodo, { inicio: "2019-12-31", fim: "2021-12-31", anos: 2, fora });
  });

  test("exercício que não termina em dezembro leva o mês no rótulo", () => {
    const p = { inicio: "2025-04-01", fim: "2026-03-31", tipo: "anual", meses: 12, indicadores: ind({ receita: 1, lucroLiquido: 1, patrimonioLiquido: 1 }) };
    assert.equal(serieDeAnos(ficha([p])).anos[0].rotulo, "03/2026");
  });

  test("ficha sem série anual: nada para calcular, sem erro", () => {
    const c = calcularConsistencia(ficha([]));
    assert.equal(c.periodo.anos, 0);
    assert.deepEqual([c.anosComLucro.valor, c.anosComLucro.motivo], [null, "nenhum ano com dado"]);
    assert.equal(c.crescimento.every((x) => x.valor === null && x.motivo === "série curta (0 anos)"), true);
  });
});

describe("consistência: anos com lucro e com FCL positivo", () => {
  test("conta os anos acima de zero sobre os anos com dado", () => {
    const r = anosPositivos(anosDe(ficha(serie(2016, "lucroLiquido", [10, -5, 0, 20, 30]))), "lucroLiquido");
    assert.deepEqual([r.valor, r.total, r.semDado, r.conta], [3, 5, 0, "3 de 5 anos (2016–2020)"]);
  });

  test("zero não é lucro: o limite exato não conta", () => {
    assert.equal(anosPositivos(anosDe(ficha(serie(2020, "lucroLiquido", [0, 0.01]))), "lucroLiquido").valor, 1);
  });

  test("ano sem dado sai do denominador, e o texto diz 'com dado'; null nunca conta como negativo", () => {
    const r = anosPositivos(anosDe(ficha(serie(2016, "fcl", [10, null, 20, null, -1]))), "fcl");
    assert.deepEqual([r.valor, r.total, r.semDado, r.conta], [2, 3, 2, "2 de 3 anos com dado (2016–2020)"]);
  });

  test("nenhum ano com dado: null com motivo", () => {
    assert.deepEqual(anosPositivos(anosDe(ficha(serie(2020, "fcl", [null, null]))), "fcl").motivo, "nenhum ano com dado");
  });

  test("um ano só: '1 de 1 ano'", () => {
    assert.equal(anosPositivos(anosDe(ficha([ano(2025, {})])), "lucroLiquido").conta, "1 de 1 ano (2025)");
  });
});

describe("consistência: maior sequência com lucro", () => {
  const seq = (valores) => maiorSequenciaPositiva(anosDe(ficha(serie(2016, "lucroLiquido", valores))), "lucroLiquido");

  test("a maior sequência, com os anos, e se vai até o último exercício", () => {
    const r = seq([10, -1, 5, 6, 7]);
    assert.deepEqual([r.valor, r.inicio, r.fim, r.ateOUltimo, r.conta], [3, "2018-12-31", "2020-12-31", true, "3 anos seguidos (2018–2020), até o último exercício"]);
  });

  test("sequência que terminou antes do último ano diz quando encerrou", () => {
    const r = seq([10, 20, 30, -1, 5]);
    assert.deepEqual([r.valor, r.ateOUltimo, r.conta], [3, false, "3 anos seguidos (2016–2018), encerrada em 2018"]);
  });

  test("ano sem dado quebra a sequência", () => {
    assert.equal(seq([10, 20, null, 30, 40]).valor, 2);
    assert.equal(seq([10, 20, null, 30, 40]).inicio, "2019-12-31"); // entre duas iguais, a mais recente
  });

  test("prejuízo em todos os anos: zero, sem inventar sequência; sem dado: null", () => {
    assert.deepEqual([seq([-1, -2]).valor, seq([-1, -2]).conta], [0, "nenhum ano com lucro"]);
    assert.equal(seq([null, null]).motivo, "nenhum ano com dado");
    assert.equal(seq([5]).conta, "1 ano seguido (2016), até o último exercício");
  });
});

describe("consistência: crescimento anual composto", () => {
  const cagr = (valores, n, inicio = 2015) => crescimentoComposto(anosDe(ficha(serie(inicio, "receita", valores))), "receita", n, "receita");

  test("(fim ÷ início)^(1/n) − 1, do exercício n anos antes ao último", () => {
    const r = cagr([100, 1, 1, 1, 1, 200], 5);
    assert.ok(Math.abs(r.valor - (2 ** (1 / 5) - 1)) < 1e-12);
    assert.deepEqual([r.inicio, r.fim, r.anos], ["2015-12-31", "2020-12-31", 5]);
    assert.equal(r.conta, "14,9% ao ano, de R$ 100 mil em 2015 a R$ 200 mil em 2020");
  });

  test("série curta: com 5 anos não há crescimento em 5 anos (precisa de 6 pontos)", () => {
    const r = cagr([100, 110, 120, 130, 140], 5);
    assert.deepEqual([r.valor, r.motivo], [null, "série curta (5 anos)"]);
    assert.equal(cagr([100, 110, 120, 130, 140, 150], 5).valor > 0, true);
    assert.equal(cagr([100, 110, 120, 130, 140, 150], 10).motivo, "série curta (6 anos)");
  });

  test("ponto inicial zero ou negativo: null com o motivo, sem tentar o ano vizinho", () => {
    const anos = anosDe(ficha(serie(2015, "lucroLiquido", [-50, 80, 90, 100, 110, 120])));
    const r = crescimentoComposto(anos, "lucroLiquido", 5, "lucro");
    assert.deepEqual([r.valor, r.motivo], [null, "lucro de 2015 negativo"]);
    assert.equal(cagr([0, 1, 1, 1, 1, 200], 5).motivo, "receita de 2015 igual a zero");
  });

  test("ponto final negativo ou sem dado também não é calculado", () => {
    assert.equal(cagr([100, 1, 1, 1, 1, -5], 5).motivo, "receita de 2020 negativo");
    assert.equal(cagr([100, 1, 1, 1, 1, null], 5).motivo, "receita de 2020 sem dado");
    assert.equal(cagr([null, 1, 1, 1, 1, 100], 5).motivo, "receita de 2015 sem dado");
  });

  test("ano faltando no meio da série: se o exercício de n anos antes não existe, não há cálculo", () => {
    // 2015 a 2021 sem 2016: para 5 anos, o início seria 2016
    const anual = [2015, 2017, 2018, 2019, 2020, 2021].map((a) => ano(a, { receita: 100 }));
    const r = crescimentoComposto(anosDe(ficha(anual)), "receita", 5, "receita");
    assert.deepEqual([r.valor, r.motivo], [null, "sem o exercício de 2016"]);
  });

  test("dado ausente no meio não atrapalha: só o início e o fim contam", () => {
    assert.ok(cagr([100, null, null, null, null, 200], 5).valor > 0);
  });

  test("queda sai negativa", () => {
    assert.ok(cagr([200, 1, 1, 1, 1, 100], 5).valor < 0);
  });

  test("calcularConsistencia traz receita, lucro e FCO em 5 e 10 anos", () => {
    const c = calcularConsistencia(ficha(serie(2015, "fco", Array(11).fill(100), { receita: 100, lucroLiquido: 100 })));
    assert.deepEqual(c.crescimento.map((x) => [x.id, x.anos]), [["receita", 5], ["receita", 10], ["lucroLiquido", 5], ["lucroLiquido", 10], ["fco", 5], ["fco", 10]]);
    assert.ok(c.crescimento.every((x) => x.valor === 0));
  });
});

describe("consistência: estabilidade da margem e pior ano", () => {
  test("maior menos menor margem líquida, em pontos percentuais, com os dois anos", () => {
    const r = estabilidadeDaMargem(anosDe(ficha(serie(2016, "margemLiquida", [0.081, 0.12, 0.181, 0.15]))));
    assert.ok(Math.abs(r.valor - 0.1) < 1e-12);
    assert.equal(r.conta, "de 8,1% em 2016 a 18,1% em 2018: 10,0 p.p.");
    assert.deepEqual([r.menor.fim, r.maior.fim, r.total, r.texto], ["2016-12-31", "2018-12-31", 4, "10,0 p.p."]);
  });

  test("ano sem margem (receita zero) não entra; com um ano só, série curta", () => {
    const r = estabilidadeDaMargem(anosDe(ficha(serie(2016, "margemLiquida", [{ motivo: "receita zero ou negativa" }, 0.1, 0.2]))));
    assert.deepEqual([r.total, r.menor.fim], [2, "2017-12-31"]);
    assert.equal(estabilidadeDaMargem(anosDe(ficha(serie(2016, "margemLiquida", [null, 0.1])))).motivo, "série curta (1 ano)");
    assert.equal(estabilidadeDaMargem(anosDe(ficha(serie(2016, "margemLiquida", [null, null])))).motivo, "nenhum ano com dado");
  });

  test("margem negativa entra na amplitude", () => {
    assert.ok(Math.abs(estabilidadeDaMargem(anosDe(ficha(serie(2016, "margemLiquida", [-0.05, 0.1])))).valor - 0.15) < 1e-12);
  });

  test("pior ano: o menor lucro e quanto ele representa da média", () => {
    const r = piorAno(anosDe(ficha(serie(2016, "lucroLiquido", [100, 50, 150]))));
    assert.deepEqual([r.valor, r.fim, r.media, r.daMedia], [50, "2017-12-31", 100, 0.5]);
    assert.equal(r.conta, "2017: lucro de R$ 50 mil, 50,0% da média de 3 anos (R$ 100 mil)");
  });

  test("pior lucro negativo: 'prejuízo de R$ X'", () => {
    const r = piorAno(anosDe(ficha(serie(2016, "lucroLiquido", [300, -100, 400]))));
    assert.match(r.conta, /^2017: prejuízo de R\$ 100 mil, −50,0% da média de 3 anos \(R\$ 200 mil\)$/);
  });

  test("média zero ou negativa: só o pior ano, sem a porcentagem", () => {
    const r = piorAno(anosDe(ficha(serie(2016, "lucroLiquido", [-300, 100, 100]))));
    assert.equal(r.daMedia, null);
    assert.equal(r.conta, "2016: prejuízo de R$ 300 mil; a média da série (−R$ 33 mil) não é positiva, então não há porcentagem");
  });

  test("ano sem dado não entra na média; sem nenhum dado, null", () => {
    assert.equal(piorAno(anosDe(ficha(serie(2016, "lucroLiquido", [100, null, 200])))).media, 150);
    assert.equal(piorAno(anosDe(ficha(serie(2016, "lucroLiquido", [null])))).motivo, "nenhum ano com dado");
  });
});

describe("limites dos pontos de atenção", () => {
  test("os padrões", () => {
    assert.deepEqual(LIMITES_ATENCAO, {
      fcoSobreLucro: 0.8, fcoSobreLucroAnos: 3, fcoSobreLucroJanela: 5, dividaLiquidaSobreEbitda: 3, dividaCurtoPrazo: 0.5,
      capexAnos: 3, diluicaoAnual: 0.02, diluicaoJanela: 3, margemQuedas: 3, proventosJanela: 5, proventosMinimo: 3,
    });
  });

  test("configAtencao lê as variáveis do Actions; ausente, vazio, zero, negativo ou texto usa o padrão", () => {
    assert.deepEqual(configAtencao({}), LIMITES_ATENCAO);
    assert.deepEqual(configAtencao(), LIMITES_ATENCAO);
    const c = configAtencao({ ATENCAO_FCO_SOBRE_LUCRO: "0.7", ATENCAO_DIVIDA_EBITDA: "2.5", ATENCAO_DIVIDA_CURTO_PRAZO: "", ATENCAO_DILUICAO_ANUAL: "abc" });
    assert.deepEqual([c.fcoSobreLucro, c.dividaLiquidaSobreEbitda, c.dividaCurtoPrazo, c.diluicaoAnual], [0.7, 2.5, 0.5, 0.02]);
    assert.equal(configAtencao({ ATENCAO_DIVIDA_EBITDA: "0" }).dividaLiquidaSobreEbitda, 3);
    assert.equal(configAtencao({ ATENCAO_DIVIDA_EBITDA: "-1" }).dividaLiquidaSobreEbitda, 3);
    assert.deepEqual(Object.values(VARIAVEIS_ATENCAO), ["ATENCAO_FCO_SOBRE_LUCRO", "ATENCAO_DIVIDA_EBITDA", "ATENCAO_DIVIDA_CURTO_PRAZO", "ATENCAO_DILUICAO_ANUAL"]);
  });

  test("o limite trocado muda a regra e o texto do limite", () => {
    const f = ficha([ano(2025, { dividaLiquida: 250, ebitda: 100 })]);
    assert.equal(dividaLiquidaAlta(f, anosDe(f)).acionada, false);
    const r = dividaLiquidaAlta(f, anosDe(f), { ...LIMITES_ATENCAO, dividaLiquidaSobreEbitda: 2 });
    assert.deepEqual([r.acionada, r.limite], [true, "dívida líquida ÷ EBITDA acima de 2,0"]);
  });
});

describe("regra 1: lucro que não vira caixa", () => {
  // FCO de cada ano sobre um lucro de 100.
  const regra = (fcos, lucros = fcos.map(() => 100)) => lucroQueNaoViraCaixa(anosDe(ficha(fcos.map((fco, i) => ano(2021 + i, { fco, lucroLiquido: lucros[i] })))));

  test("FCO ÷ lucro abaixo de 0,8 em 3 dos últimos 5 exercícios: acionada, com os anos", () => {
    const r = regra([70, 90, 60, 100, 50]);
    assert.deepEqual(semMotivo(r), { acionada: true, anos: ["2021", "2023", "2025"] });
    assert.equal(r.limite, "FCO ÷ lucro abaixo de 0,8 em 3 dos últimos 5 exercícios");
    assert.match(r.conta, /^FCO ÷ lucro abaixo de 0,8 em 2021, 2023 e 2025 \(3 de 5 exercícios avaliados; 2021: 0,70; 2022: 0,90; 2023: 0,60; 2024: 1,00; 2025: 0,50\)$/);
  });

  test("limite exato: 0,8 não conta; 0,79 conta", () => {
    assert.equal(regra([80, 80, 80, 80, 80]).acionada, false);
    assert.deepEqual(regra([80, 80, 80, 80, 80]).anos, []);
    assert.equal(regra([79, 79, 79, 100, 100]).acionada, true);
    assert.equal(regra([79, 79, 80, 100, 100]).acionada, false); // só 2 anos abaixo
  });

  test("série curta (menos de 5 anos): não avaliada", () => {
    const r = regra([10, 10, 10, 10]);
    assert.deepEqual([r.acionada, r.motivo], [null, "série curta (4 anos)"]);
  });

  test("só olha os últimos 5: o que veio antes não conta", () => {
    assert.equal(regra([10, 10, 10, 100, 100, 100, 100, 100]).acionada, false);
  });

  test("ano com prejuízo não entra na conta, e o texto diz", () => {
    const r = regra([50, 50, 50, 500, 100], [100, 100, 100, -200, 100]);
    assert.equal(r.acionada, true);
    assert.match(r.conta, /3 de 4 exercícios avaliados.*; 2024 com prejuízo ficou fora da conta$/);
    assert.ok(!r.anos.includes("2024"));
  });

  test("menos de 3 anos avaliáveis: não avaliada, com o motivo", () => {
    const r = regra([50, 50, 50, 50, 50], [100, 100, -1, -1, -1]);
    assert.equal(r.acionada, null);
    assert.equal(r.motivo, "só 2 de 5 exercícios com lucro e FCO para avaliar (mínimo: 3); 2023, 2024 e 2025 com prejuízo ficaram fora da conta");
  });

  test("FCO ausente num ano: o ano sai da conta, sem virar zero", () => {
    const r = regra([50, null, 50, 100, 100]);
    assert.equal(r.acionada, false); // 2 de 4 avaliados
    assert.match(r.conta, /2 de 4 exercícios avaliados/);
  });

  test("FCO negativo com lucro conta como abaixo do limite", () => {
    assert.equal(regra([-10, -10, -10, 100, 100]).acionada, true);
  });
});

describe("regra 2: proventos maiores que o FCL", () => {
  // [proventos, FCL] de cada exercício, a partir de 2021.
  const serieDe = (pares, inicio = 2021) => pares.map(([prov, fcl], k) => ano(inicio + k, { proventosPagos: prov, fcl }));
  const regra = (pares, doze = null, inicio = 2021) => { const f = ficha(serieDe(pares, inicio), doze); return proventosMaioresQueFcl(f, anosDe(f)); };

  test("soma dos proventos maior que a soma do FCL nos últimos 5 exercícios: acionada, com as duas somas e os anos", () => {
    const r = regra([[60, 100], [120, 100], [80, 100], [150, 100], [100, 100]]);
    assert.equal(r.acionada, true); // 510 contra 500
    assert.deepEqual(r.anos, ["2021", "2022", "2023", "2024", "2025"]);
    assert.equal(r.conta, "proventos pagos de R$ 510 mil e FCL de R$ 500 mil, somados os 5 exercícios de 2021 a 2025; ano a ano, os proventos passaram do FCL em 2022 e 2024");
    assert.equal(r.limite, "soma dos proventos pagos maior que a soma do FCL nos últimos 5 exercícios com dado (mínimo de 3)");
  });

  test("limite exato: somas iguais não acionam; um real a mais aciona", () => {
    assert.equal(regra([[60, 100], [120, 100], [80, 100], [150, 100], [90, 100]]).acionada, false); // 500 contra 500
    assert.equal(regra([[60, 100], [120, 100], [80, 100], [150, 100], [90.01, 100]]).acionada, true);
  });

  test("um ano só acima do FCL não aciona quando a soma dos cinco fica abaixo", () => {
    const r = regra([[10, 100], [10, 100], [10, 100], [10, 100], [300, 100]]);
    assert.equal(r.acionada, false); // 340 contra 500
    assert.match(r.conta, /ano a ano, os proventos passaram do FCL em 2025$/);
  });

  test("os 12 meses viram contexto: aparecem na conta e não decidem a regra", () => {
    const cincoAbaixo = [[50, 100], [50, 100], [50, 100], [50, 100], [50, 100]];
    const r = regra(cincoAbaixo, { proventosPagos: 130, fcl: 100 });
    assert.equal(r.acionada, false); // nos 12 meses os proventos passam do FCL, mas a soma dos cinco anos não
    assert.equal(r.conta, "proventos pagos de R$ 250 mil e FCL de R$ 500 mil, somados os 5 exercícios de 2021 a 2025; ano a ano, os proventos passaram do FCL em nenhum ano. Nos 12 meses até 30/09/2026: proventos de R$ 130 mil e FCL de R$ 100 mil");
    // e o contrário: 12 meses folgados não desligam a regra
    const cincoAcima = [[150, 100], [150, 100], [150, 100], [150, 100], [150, 100]];
    assert.equal(regra(cincoAcima, { proventosPagos: 10, fcl: 100 }).acionada, true);
  });

  test("12 meses sem o dado (TIM): a regra avalia do mesmo jeito, só sem a frase dos 12 meses", () => {
    const r = regra([[50, 100], [50, 100], [50, 100], [50, 100], [50, 100]]);
    assert.equal(r.acionada, false);
    assert.ok(!r.conta.includes("12 meses"));
    const soFcl = regra([[50, 100], [50, 100], [50, 100]], { proventosPagos: null, fcl: 100 });
    assert.ok(!soFcl.conta.includes("12 meses"));
  });

  test("só os últimos 5 exercícios com dado entram na soma", () => {
    const r = regra([[900, 1], [900, 1], [10, 100], [10, 100], [10, 100], [10, 100], [10, 100]], null, 2019);
    assert.equal(r.acionada, false);
    assert.deepEqual(r.anos, ["2021", "2022", "2023", "2024", "2025"]);
  });

  test("ano sem dado não conta como zero: sai da janela, e a soma busca um ano mais antigo com dado", () => {
    const r = regra([[200, 100], [50, 100], [null, 100], [50, 100], [50, null], [50, 100], [50, 100]], null, 2019);
    assert.deepEqual(r.anos, ["2019", "2020", "2022", "2024", "2025"]);
    assert.equal(r.acionada, false); // 400 contra 500
    assert.equal(r.conta, "proventos pagos de R$ 400 mil e FCL de R$ 500 mil, somados os 5 exercícios de 2019 a 2025 (2019, 2020, 2022, 2024 e 2025); ano a ano, os proventos passaram do FCL em 2019");
  });

  test("mínimo de 3 exercícios com dado: com 3 avalia; com 2, não avaliada", () => {
    const tres = regra([[150, 100], [150, 100], [150, 100]]);
    assert.equal(tres.acionada, true);
    assert.match(tres.conta, /^proventos pagos de R\$ 450 mil e FCL de R\$ 300 mil, somados os 3 exercícios de 2021 a 2023;/);
    const dois = regra([[150, 100], [150, 100]]);
    assert.deepEqual([dois.acionada, dois.motivo], [null, "só 2 exercícios com proventos e FCL (mínimo: 3); série curta (2 anos)"]);
  });

  test("série longa, mas com menos de 3 anos com os dois dados: não avaliada, com o motivo do dado que falta", () => {
    const f = ficha([2021, 2022, 2023, 2024].map((a) => ano(a, { proventosPagos: { motivo: "não identificado" }, fcl: 100 })).concat([ano(2025, { proventosPagos: 50, fcl: 100 })]));
    const r = proventosMaioresQueFcl(f, anosDe(f));
    assert.deepEqual([r.acionada, r.motivo], [null, "só 1 exercício com proventos e FCL (mínimo: 3): não identificado"]);
  });

  test("FCL somado negativo com proventos pagos: acionada", () => {
    const r = regra([[10, -50], [10, -50], [10, 20]]);
    assert.equal(r.acionada, true); // 30 contra −80
    assert.match(r.conta, /^proventos pagos de R\$ 30 mil e FCL de −R\$ 80 mil, somados/);
  });

  test("o tamanho da janela e o mínimo vêm dos limites", () => {
    const f = ficha(serieDe([[900, 1], [10, 100], [10, 100]]));
    assert.equal(proventosMaioresQueFcl(f, anosDe(f)).acionada, true);
    const curto = proventosMaioresQueFcl(f, anosDe(f), { ...LIMITES_ATENCAO, proventosJanela: 2, proventosMinimo: 2 });
    assert.deepEqual([curto.acionada, curto.anos], [false, ["2022", "2023"]]);
  });
});

describe("regra 3: dívida líquida ÷ EBITDA alta", () => {
  const hoje = (valores) => { const f = ficha([ano(2025, {})], valores); return dividaLiquidaAlta(f, anosDe(f)); };

  test("limite exato: 3,0 não aciona; 3,01 aciona", () => {
    assert.equal(hoje({ dividaLiquida: 300, ebitda: 100 }).acionada, false);
    assert.equal(hoje({ dividaLiquida: 301, ebitda: 100 }).acionada, true);
    assert.equal(hoje({ dividaLiquida: 301, ebitda: 100 }).conta, "dívida líquida ÷ EBITDA de 3,0x nos 12 meses até 30/09/2026 (R$ 301 mil ÷ R$ 100 mil)");
  });

  test("mostra a versão com arrendamentos ao lado, quando existe; a regra usa a sem arrendamentos", () => {
    const r = hoje({ dividaLiquida: 200, ebitda: 100, dividaLiquidaComArrendamentos: 450 });
    assert.equal(r.acionada, false);
    assert.match(r.conta, /de 2,0x .*; com arrendamentos, 4,5x$/);
  });

  test("EBITDA zero ou negativo com dívida líquida: acionada, com o texto próprio", () => {
    for (const ebitda of [0, -50]) {
      const r = hoje({ dividaLiquida: 200, ebitda });
      assert.equal(r.acionada, true, String(ebitda));
      assert.match(r.conta, /^EBITDA negativo com dívida líquida: /);
    }
  });

  test("caixa líquido (dívida líquida zero ou negativa): não acionada, mesmo com EBITDA negativo", () => {
    assert.equal(hoje({ dividaLiquida: -500, ebitda: 100 }).acionada, false);
    assert.equal(hoje({ dividaLiquida: -500, ebitda: -100 }).acionada, false);
    assert.equal(hoje({ dividaLiquida: 0, ebitda: 100 }).acionada, false);
    assert.match(hoje({ dividaLiquida: -500, ebitda: 100 }).conta, /^o caixa é maior que a dívida: caixa líquido de R\$ 500 mil/);
  });

  test("12 meses indisponíveis: usa o último exercício e diz; sem nenhum dos dois, não avaliada", () => {
    const f = ficha([ano(2025, { dividaLiquida: 400, ebitda: 100 })]);
    const r = dividaLiquidaAlta(f, anosDe(f));
    assert.equal(r.acionada, true);
    assert.match(r.conta, /no exercício de 2025 \(os 12 meses não têm esse dado\)/);
    const sem = ficha([ano(2025, { dividaLiquida: { motivo: "a dívida pode estar fora das contas padrão" }, ebitda: 100 })]);
    assert.deepEqual([dividaLiquidaAlta(sem, anosDe(sem)).acionada, dividaLiquidaAlta(sem, anosDe(sem)).motivo], [null, "sem dado nos 12 meses nem no último exercício: a dívida pode estar fora das contas padrão"]);
  });
});

describe("regra 4: dívida concentrada no curto prazo", () => {
  const hoje = (valores) => { const f = ficha([ano(2025, {})], { dividaBruta: 1000, ...valores }); return dividaNoCurtoPrazo(f, anosDe(f)); };

  test("limite exato: 50% não aciona; 50,1% aciona, com dívida líquida positiva", () => {
    assert.equal(hoje({ dividaCurtoPrazo: 0.5, dividaLiquida: 400 }).acionada, false);
    const r = hoje({ dividaCurtoPrazo: 0.501, dividaLiquida: 400 });
    assert.equal(r.acionada, true);
    assert.equal(r.conta, "50,1% da dívida bruta vence em até 12 meses nos 12 meses até 30/09/2026, com dívida líquida de R$ 400 mil");
    assert.equal(r.limite, "mais de 50% da dívida bruta no curto prazo, com dívida líquida positiva");
  });

  test("caixa maior que a dívida (o caso da WEG): não aciona, mesmo com 77% no curto prazo", () => {
    const r = hoje({ dividaCurtoPrazo: 0.77, dividaLiquida: -2_689_043 });
    assert.equal(r.acionada, false);
    assert.equal(r.conta, "77,0% da dívida bruta vence em até 12 meses nos 12 meses até 30/09/2026, mas o caixa é maior que a dívida (caixa líquido de R$ 2,7 bi)");
  });

  test("dívida bruta zero ou sem dado: não avaliada", () => {
    assert.deepEqual([hoje({ dividaBruta: 0 }).acionada, hoje({ dividaBruta: 0 }).motivo], [null, "sem dívida financeira nos 12 meses até 30/09/2026"]);
    const sem = ficha([ano(2025, { dividaBruta: { motivo: "a dívida pode estar fora das contas padrão" } })]);
    assert.equal(dividaNoCurtoPrazo(sem, anosDe(sem)).acionada, null);
    assert.match(dividaNoCurtoPrazo(sem, anosDe(sem)).motivo, /a dívida pode estar fora das contas padrão/);
  });

  test("ficha real da WEG (fixture): não aciona", () => {
    const f = fichaDaWeg();
    const r = dividaNoCurtoPrazo(f, anosDe(f));
    assert.equal(r.acionada, false);
    assert.match(r.conta, /mas o caixa é maior que a dívida \(caixa líquido de R\$ 2,6 bi\)$/);
    assert.ok(f.doze.indicadores.dividaCurtoPrazo.valor > 0.5); // mais da metade no curto prazo, e mesmo assim não aciona
  });
});

describe("regra 5: capex maior que o FCO", () => {
  const regra = (pares) => capexMaiorQueFco(anosDe(ficha(pares.map(([capex, fco], i) => ano(2022 + i, { capex, fco })))));

  test("capex maior que o FCO nos últimos 3 exercícios seguidos: acionada", () => {
    const r = regra([[10, 100], [120, 100], [130, 100], [140, 100]]);
    assert.deepEqual(semMotivo(r), { acionada: true, anos: ["2023", "2024", "2025"] });
    assert.match(r.conta, /^capex maior que o FCO em 3 dos últimos 3 exercícios \(2023: capex de R\$ 120 mil e FCO de R\$ 100 mil; /);
  });

  test("limite exato: capex igual ao FCO não conta; dois de três não acionam", () => {
    assert.equal(regra([[100, 100], [120, 100], [130, 100]]).acionada, false);
    assert.equal(regra([[100.01, 100], [120, 100], [130, 100]]).acionada, true);
    assert.deepEqual(regra([[50, 100], [120, 100], [130, 100]]).anos, ["2023", "2024"]);
  });

  test("FCO negativo com capex positivo conta como capex maior", () => {
    assert.equal(regra([[10, -5], [10, -5], [10, -5]]).acionada, true);
  });

  test("série curta (menos de 3 anos) e dado ausente na janela: não avaliada", () => {
    assert.deepEqual([regra([[120, 100], [130, 100]]).acionada, regra([[120, 100], [130, 100]]).motivo], [null, "série curta (2 anos)"]);
    const r = regra([[120, 100], [null, 100], [130, 100]]);
    assert.deepEqual([r.acionada, r.motivo], [null, "sem capex ou FCO em 2023"]);
  });

  test("dado ausente fora da janela não atrapalha", () => {
    assert.equal(regra([[null, 100], [120, 100], [130, 100], [140, 100]]).acionada, true);
  });
});

describe("regra 6: diluição", () => {
  const regra = (acoes, diluicoes = []) => diluicao(anosDe(ficha(acoes.map((n, i) => ano(2023 + i, { acoesCirculacao: n, diluicao: diluicoes[i] ?? 0 })))));
  const M = 1e6;

  test("limite exato: 2,0% ao ano não aciona; acima aciona", () => {
    assert.equal(regra([100 * M, 102 * M, 104.04 * M]).acionada, false); // exatamente 2% ao ano
    const r = regra([100 * M, 103 * M, 106.09 * M]);
    assert.equal(r.acionada, true);
    assert.equal(r.conta, "o número de ações variou 3,0% ao ano entre 2023 e 2025 (de 100,0 milhões para 106,1 milhões)");
    assert.equal(r.limite, "número de ações crescendo mais de 2% ao ano nos últimos 3 exercícios");
  });

  test("recompra (número de ações caindo) não aciona", () => {
    assert.equal(regra([100 * M, 98 * M, 95 * M]).acionada, false);
  });

  test("só olha os últimos 3 exercícios", () => {
    const anos = anosDe(ficha([50, 100, 100, 100].map((n, i) => ano(2022 + i, { acoesCirculacao: n * M, diluicao: 0 }))));
    assert.equal(diluicao(anos).acionada, false);
  });

  test("precisa de 2 exercícios com o número de ações: com 1, não avaliada; com 2, avalia", () => {
    const r = regra([null, null, 100 * M]);
    assert.deepEqual([r.acionada, r.motivo], [null, "só 1 exercício com o número de ações na janela (mínimo: 2)"]);
    assert.equal(regra([null, 100 * M, 105 * M]).acionada, true);
    assert.deepEqual(regra([null, 100 * M, 105 * M]).anos, ["2024", "2025"]);
    assert.equal(regra([null, null, null]).motivo, "só 0 exercícios com o número de ações na janela (mínimo: 2)");
  });

  test("desdobramento ou grupamento dentro da janela: não avaliada, com o motivo 'evento societário na janela'", () => {
    const motivo = { motivo: "variação de +200% sugere desdobramento ou grupamento" };
    const r = regra([100 * M, 100 * M, 300 * M], [0, 0, motivo]);
    assert.equal(r.acionada, null);
    assert.equal(r.motivo, "evento societário na janela (2025: variação de +200% sugere desdobramento ou grupamento)");
  });

  test("quebra marcada no primeiro ponto da janela é anterior a ela: a regra avalia", () => {
    const motivo = { motivo: "variação de +200% sugere desdobramento ou grupamento" };
    assert.equal(regra([300 * M, 300 * M, 300 * M], [motivo, 0, 0]).acionada, false);
  });
});

describe("regra 7: margem líquida em queda", () => {
  const regra = (margens) => margemEmQueda(anosDe(ficha(serie(2022, "margemLiquida", margens))));

  test("3 quedas seguidas (4 pontos), terminando no último exercício: acionada", () => {
    const r = regra([0.2, 0.18, 0.15, 0.1]);
    assert.deepEqual(semMotivo(r), { acionada: true, anos: ["2022", "2023", "2024", "2025"] });
    assert.equal(r.conta, "margem líquida: 20,0% em 2022, 18,0% em 2023, 15,0% em 2024, 10,0% em 2025");
  });

  test("limite exato: margem igual não é queda", () => {
    assert.equal(regra([0.2, 0.18, 0.18, 0.1]).acionada, false);
    assert.equal(regra([0.2, 0.18, 0.1799, 0.1]).acionada, true);
  });

  test("a sequência tem de terminar no último exercício", () => {
    assert.equal(regra([0.3, 0.2, 0.15, 0.1, 0.12]).acionada, false);
    assert.equal(regra([0.5, 0.3, 0.2, 0.15, 0.1]).acionada, true); // só os últimos 4 contam
  });

  test("série curta (3 anos) e dado ausente na janela: não avaliada", () => {
    assert.deepEqual([regra([0.2, 0.15, 0.1]).acionada, regra([0.2, 0.15, 0.1]).motivo], [null, "série curta (3 anos)"]);
    const r = regra([0.2, null, 0.15, 0.1]);
    assert.deepEqual([r.acionada, r.motivo], [null, "sem margem líquida em 2023"]);
  });

  test("margem negativa ficando mais negativa também é queda", () => {
    assert.equal(regra([0.02, -0.01, -0.05, -0.1]).acionada, true);
  });
});

describe("as sete regras juntas", () => {
  test("ordem, contagem e limites usados", () => {
    const f = ficha([ano(2025, {})]);
    const a = calcularAtencao(f);
    assert.deepEqual(a.regras.map((r) => r.id), ["lucroQueNaoViraCaixa", "proventosMaioresQueFcl", "dividaLiquidaAlta", "dividaNoCurtoPrazo", "capexMaiorQueFco", "diluicao", "margemEmQueda"]);
    assert.deepEqual([a.total, a.acionadas, a.naoAvaliadas], [7, 0, 7]);
    assert.deepEqual(a.limites, LIMITES_ATENCAO);
    for (const r of a.regras) {
      assert.deepEqual(Object.keys(r), ["id", "titulo", "limite", "acionada", "conta", "anos", "motivo"], r.id);
      assert.ok(r.limite.length > 10, r.id);
      // não avaliada sempre tem motivo; avaliada sempre tem a conta
      assert.ok(r.acionada === null ? r.motivo && r.conta === null : r.conta && r.motivo === null, r.id);
    }
  });

  test("fonteDeHoje: os 12 meses quando têm todos os dados; senão o último exercício; senão null", () => {
    const f = ficha([ano(2025, { fcl: 1 })], { fcl: 2 });
    assert.deepEqual([fonteDeHoje(f, anosDe(f), ["fcl"]).doze, fonteDeHoje(f, anosDe(f), ["fcl"]).indicadores.fcl.valor], [true, 2]);
    assert.equal(fonteDeHoje(f, anosDe(f), ["fcl", "capex"]), null);
    const semDoze = ficha([ano(2025, { fcl: 1 })]);
    assert.deepEqual([fonteDeHoje(semDoze, anosDe(semDoze), ["fcl"]).doze, fonteDeHoje(semDoze, anosDe(semDoze), ["fcl"]).quando], [false, "no exercício de 2025 (os 12 meses não têm esse dado)"]);
  });

  test("período de transição e período zerado não entram nas janelas das regras", () => {
    // 2022, 2023, [2024 de 9 meses], 2025: a janela de 3 exercícios é 2022, 2023 e 2025
    const anual = [ano(2022, { capex: 120, fco: 100 }), ano(2023, { capex: 120, fco: 100 }), ano(2024, { capex: 1, fco: 100 }, { tipo: "transicao", meses: 9 }), ano(2025, { capex: 120, fco: 100 })];
    assert.deepEqual(capexMaiorQueFco(anosDe(ficha(anual))).anos, ["2022", "2023", "2025"]);
  });
});

describe("casos reais: Assaí, Ambev e TIM", () => {
  test("Assaí: 2018 (demonstração zerada) fica fora da consistência, e o texto diz isso", () => {
    const zerado = ano(2018, {});
    for (const id of Object.keys(zerado.indicadores)) zerado.indicadores[id] = { valor: null, motivo: MOTIVO_DEMONSTRACAO_ZERADA };
    const f = ficha([zerado, ...serie(2019, "lucroLiquido", [1060, 1556, 1610, 1220, 710, 769, 497])]);
    const c = calcularConsistencia(f);
    assert.deepEqual([c.periodo.anos, c.periodo.inicio], [7, "2019-12-31"]);
    assert.equal(c.anosComLucro.conta, "7 de 7 anos (2019–2025)"); // 2018 não entra nem como ano sem dado
    const html = consistenciaHtml(c);
    assert.match(html, /Série de 7 exercícios de 12 meses, de 2019 a 2025\. 1 período ficou de fora das contas: 2018 \(demonstração zerada no documento\)\./);
  });

  test("Ambev 2011 e 2012: receita 0 com lucro. A margem é null (não infinito) e não entra na estabilidade", () => {
    const semMargem = { motivo: "receita zero ou negativa" };
    const anual = [
      ano(2011, { receita: 0, lucroLiquido: 39, margemLiquida: semMargem }), ano(2012, { receita: 0, lucroLiquido: 600, margemLiquida: semMargem }),
      ano(2013, { receita: 34_791, lucroLiquido: 11_300, margemLiquida: 0.325 }), ano(2014, { receita: 38_080, lucroLiquido: 12_362, margemLiquida: 0.3246 }),
      ano(2015, { receita: 46_720, lucroLiquido: 12_879, margemLiquida: 0.2757 }),
    ];
    const c = calcularConsistencia(ficha(anual));
    assert.equal(c.anosComLucro.conta, "5 de 5 anos (2011–2015)"); // os dois anos contam como anos com lucro
    assert.deepEqual([c.estabilidadeDaMargem.total, c.estabilidadeDaMargem.menor.fim, c.estabilidadeDaMargem.maior.fim], [3, "2015-12-31", "2013-12-31"]);
    assert.ok(Number.isFinite(c.estabilidadeDaMargem.valor));
    assert.equal(c.piorAno.fim, "2011-12-31");
    // a regra da margem em queda, com 2012 sem margem na janela, não é avaliada
    assert.equal(margemEmQueda(anosDe(ficha(anual.slice(0, 4)))).motivo, "sem margem líquida em 2011 e 2012");
  });

  test("TIM: os 12 meses são null, então as regras de hoje usam o último exercício e dizem isso; a dos proventos soma os exercícios", () => {
    const motivo = "a companhia passou a consolidar";
    const anual = serie(2021, "lucroLiquido", [2957, 1671, 2837, 3154, 4312], { proventosPagos: 5400, fcl: 8900, dividaLiquida: -3100, ebitda: 13_422, dividaBruta: 9000, dividaCurtoPrazo: 0.333, fco: 13_400, capex: 4500 });
    const f = { ...ficha(anual), doze: { fim: "2026-06-30", tipo: "indisponivel", motivo, indicadores: ind(Object.fromEntries(["proventosPagos", "fcl", "dividaLiquida", "ebitda", "dividaBruta", "dividaCurtoPrazo"].map((id) => [id, { motivo }]))) } };
    const a = calcularAtencao(f);
    for (const id of ["dividaLiquidaAlta", "dividaNoCurtoPrazo"]) {
      const r = a.regras.find((x) => x.id === id);
      assert.equal(r.acionada, false, id);
      assert.match(r.conta, /no exercício de 2025 \(os 12 meses não têm esse dado\)/, id);
    }
    const proventos = a.regras.find((x) => x.id === "proventosMaioresQueFcl");
    assert.equal(proventos.acionada, false);
    assert.equal(proventos.conta, "proventos pagos de R$ 27 mi e FCL de R$ 45 mi, somados os 5 exercícios de 2021 a 2025; ano a ano, os proventos passaram do FCL em nenhum ano");
  });
});

describe("pares: mediana, quartil e posição", () => {
  test("mediana e quartil", () => {
    assert.equal(mediana([3, 1, 2]), 2);
    assert.equal(mediana([4, 1, 3, 2]), 2.5);
    assert.equal(mediana([]), null);
    assert.equal(quartil([1, 2, 3, 4, 5], 0.25), 2);
    assert.equal(quartil([1, 2, 3, 4, 5], 0.75), 4);
    assert.equal(quartil([1, 2, 3, 4], 0.25), 1.75);
  });

  test("acima, abaixo ou na mediana, com o quartil por extenso", () => {
    const amostra = [1, 2, 3, 4, 5, 6, 7];
    assert.deepEqual(posicaoNaAmostra(7, amostra), { posicao: "acima da mediana", faixa: "entre os 25% maiores do setor" });
    assert.deepEqual(posicaoNaAmostra(5, amostra), { posicao: "acima da mediana", faixa: "na metade de cima do setor, fora dos 25% maiores" });
    assert.deepEqual(posicaoNaAmostra(3, amostra), { posicao: "abaixo da mediana", faixa: "na metade de baixo do setor, fora dos 25% menores" });
    assert.deepEqual(posicaoNaAmostra(1, amostra), { posicao: "abaixo da mediana", faixa: "entre os 25% menores do setor" });
  });

  test("empate com a mediana: 'na mediana'", () => {
    assert.deepEqual(posicaoNaAmostra(4, [1, 2, 4, 9, 10]), { posicao: "na mediana", faixa: "no meio do setor" });
    assert.equal(posicaoNaAmostra(5, [5, 5, 5, 5]).posicao, "na mediana");
    assert.equal(posicaoNaAmostra(5, [5, 5, 5, 5, 5]).posicao, "na mediana");
  });

  test("amostra com menos de 5 empresas: só 'acima', 'abaixo' ou 'na mediana', sem a frase do quartil", () => {
    assert.equal(MINIMO_PARA_QUARTIL, 5);
    // 3 empresas
    assert.deepEqual(posicaoNaAmostra(9, [1, 4, 9]), { posicao: "acima da mediana", faixa: null });
    assert.deepEqual(posicaoNaAmostra(1, [1, 4, 9]), { posicao: "abaixo da mediana", faixa: null });
    assert.deepEqual(posicaoNaAmostra(4, [1, 4, 9]), { posicao: "na mediana", faixa: null });
    // 4 empresas
    assert.deepEqual(posicaoNaAmostra(9, [1, 4, 6, 9]), { posicao: "acima da mediana", faixa: null });
    // 5 empresas: o quartil volta
    assert.deepEqual(posicaoNaAmostra(9, [1, 4, 6, 8, 9]), { posicao: "acima da mediana", faixa: "entre os 25% maiores do setor" });
    assert.deepEqual(posicaoNaAmostra(1, [1, 4, 6, 8, 9]), { posicao: "abaixo da mediana", faixa: "entre os 25% menores do setor" });
    assert.deepEqual(posicaoNaAmostra(10, [1, 4, 6, 8, 10, 11, 12]).faixa, "na metade de cima do setor, fora dos 25% maiores");
  });

  test("a lista de indicadores é curta e o mínimo é de 3 empresas", () => {
    assert.equal(MINIMO_DE_EMPRESAS, 3);
    assert.deepEqual(INDICADORES_DE_PARES.map((i) => i.id), ["margemLiquida", "roic", "roe", "dividaLiquidaSobreEbitda", "fcoSobreEbitda", "capexSobreFco", "crescimentoReceita5", "anosComLucro"]);
  });
});

describe("pares: comparação com o setor", () => {
  // Uma ficha de pares: margem líquida do exercício de 2025 (e do de 2024), mais a consistência.
  const par = (ticker, setor, margem2025, extra = {}) => {
    const anual = [ano(2024, { margemLiquida: 0.1 }), ...(margem2025 === undefined ? [] : [ano(2025, { margemLiquida: margem2025, ...extra })])];
    const f = { ticker, setor, anual, doze: { fim: null, indicadores: {} } };
    f.consistencia = calcularConsistencia(f);
    return f;
  };
  const fichas = (lista) => Object.fromEntries(lista.map((f) => [f.ticker, f]));
  const item = (pares, ticker, id = "margemLiquida") => pares[ticker].itens.find((i) => i.id === id);

  test("mediana do setor no último exercício da maioria, com a posição e a amostra", () => {
    const p = calcularPares(fichas([par("AAAA3", "S", 0.05), par("BBBB3", "S", 0.1), par("CCCC3", "S", 0.2), par("DDDD3", "S", 0.3), par("EEEE3", "S", 0.4)]));
    assert.deepEqual([p.AAAA3.setor, p.AAAA3.exercicio, p.AAAA3.empresas, p.AAAA3.tickers], ["S", "2025-12-31", 5, ["AAAA3", "BBBB3", "CCCC3", "DDDD3", "EEEE3"]]);
    const e = item(p, "EEEE3");
    assert.deepEqual([e.valor, e.mediana, e.empresas, e.posicao, e.faixa], [0.4, 0.2, 5, "acima da mediana", "entre os 25% maiores do setor"]);
    assert.equal(e.conta, "40,0%, acima da mediana (20,0%); entre os 25% maiores do setor; mediana de 5 empresas (S)");
    assert.equal(item(p, "CCCC3").posicao, "na mediana");
    assert.equal(item(p, "AAAA3").posicao, "abaixo da mediana");
  });

  test("setor com 3 empresas: mediana e posição, sem a frase do quartil na conta", () => {
    const p = calcularPares(fichas([par("AAAA3", "S", 0.1), par("BBBB3", "S", 0.2), par("CCCC3", "S", 0.4)]));
    const maior = item(p, "CCCC3");
    assert.deepEqual([maior.mediana, maior.empresas, maior.posicao, maior.faixa], [0.2, 3, "acima da mediana", null]);
    assert.equal(maior.conta, "40,0%, acima da mediana (20,0%); mediana de 3 empresas (S)");
    assert.deepEqual([item(p, "AAAA3").posicao, item(p, "AAAA3").faixa], ["abaixo da mediana", null]);
    assert.deepEqual([item(p, "BBBB3").posicao, item(p, "BBBB3").faixa], ["na mediana", null]);
    assert.ok(p.CCCC3.itens.every((i) => i.faixa === null));
  });

  test("setor com 5 empresas: a posição vem com a frase do quartil", () => {
    const p = calcularPares(fichas([par("AAAA3", "S", 0.05), par("BBBB3", "S", 0.1), par("CCCC3", "S", 0.2), par("DDDD3", "S", 0.3), par("EEEE3", "S", 0.4)]));
    assert.deepEqual([item(p, "EEEE3").posicao, item(p, "EEEE3").faixa], ["acima da mediana", "entre os 25% maiores do setor"]);
    assert.deepEqual([item(p, "DDDD3").posicao, item(p, "DDDD3").faixa], ["acima da mediana", "entre os 25% maiores do setor"]); // 0,3 é o terceiro quartil
    assert.deepEqual([item(p, "AAAA3").posicao, item(p, "AAAA3").faixa], ["abaixo da mediana", "entre os 25% menores do setor"]);
    assert.deepEqual([item(p, "CCCC3").posicao, item(p, "CCCC3").faixa], ["na mediana", "no meio do setor"]);
  });

  test("o quartil depende das empresas com dado em cada linha, não do tamanho do setor", () => {
    // 5 empresas no setor, mas só 4 com a margem: a linha fica sem o quartil
    const p = calcularPares(fichas([par("AAAA3", "S", 0.1), par("BBBB3", "S", 0.2), par("CCCC3", "S", 0.3), par("DDDD3", "S", 0.4), par("EEEE3", "S", null)]));
    assert.deepEqual([item(p, "DDDD3").empresas, item(p, "DDDD3").faixa, item(p, "DDDD3").posicao], [4, null, "acima da mediana"]);
    // a linha "anos com lucro" tem as 5: nela o quartil aparece
    assert.equal(item(p, "DDDD3", "anosComLucro").empresas, 5);
    assert.ok(item(p, "DDDD3", "anosComLucro").faixa !== null);
  });

  test("setor com 2 empresas não mostra mediana", () => {
    const p = calcularPares(fichas([par("AAAA3", "Pequeno", 0.1), par("BBBB3", "Pequeno", 0.2)]));
    const i = item(p, "AAAA3");
    assert.deepEqual([i.mediana, i.posicao, i.motivo, i.empresas], [null, null, "setor com menos de 3 empresas com dado", 2]);
    assert.equal(p.AAAA3.empresas, 2);
  });

  test("setor com uma empresa só (Serviços financeiros, só a B3): sem mediana", () => {
    const p = calcularPares(fichas([par("B3SA3", "Serviços financeiros", 0.4)]));
    assert.ok(p.B3SA3.itens.every((i) => i.mediana === null && i.motivo === "setor com menos de 3 empresas com dado"));
  });

  test("3 empresas no setor, mas só 2 com o dado naquele indicador: sem mediana naquela linha", () => {
    const p = calcularPares(fichas([par("AAAA3", "S", 0.1), par("BBBB3", "S", 0.2), par("CCCC3", "S", null)]));
    assert.equal(item(p, "AAAA3").motivo, "setor com menos de 3 empresas com dado");
    assert.equal(p.AAAA3.empresas, 3);
  });

  test("empresa sem o exercício escolhido sai da mediana e fica sem posição, com o motivo", () => {
    const p = calcularPares(fichas([par("AAAA3", "S", 0.1), par("BBBB3", "S", 0.2), par("CCCC3", "S", 0.3), par("DDDD3", "S", undefined)]));
    assert.equal(p.AAAA3.exercicio, "2025-12-31"); // 3 de 4 têm 2025: é a maioria
    assert.deepEqual(p.AAAA3.tickers, ["AAAA3", "BBBB3", "CCCC3"]);
    const d = item(p, "DDDD3");
    assert.deepEqual([d.valor, d.mediana, d.posicao, d.motivo], [null, 0.2, null, "a companhia não tem o exercício de 2025"]);
    assert.equal(p.DDDD3.temExercicio, false);
  });

  test("se só a minoria entregou o exercício mais novo, vale o anterior", () => {
    const p = calcularPares(fichas([par("AAAA3", "S", 0.5), par("BBBB3", "S", undefined), par("CCCC3", "S", undefined), par("DDDD3", "S", undefined)]));
    assert.equal(p.AAAA3.exercicio, "2024-12-31");
    assert.equal(item(p, "AAAA3").valor, 0.1); // a margem de 2024, não a de 2025
    assert.equal(exercicioDoSetor([par("A", "S", 0.5), par("B", "S", undefined)]), "2024-12-31"); // 1 de 2 não é maioria
  });

  test("empresa com o exercício mas sem o dado: fora da amostra, com o motivo próprio", () => {
    const p = calcularPares(fichas([par("AAAA3", "S", 0.1), par("BBBB3", "S", 0.2), par("CCCC3", "S", 0.3), par("DDDD3", "S", null)]));
    const d = item(p, "DDDD3");
    assert.deepEqual([d.valor, d.empresas, d.motivo], [null, 3, "a companhia não tem esse dado no exercício"]);
  });

  test("anos com lucro entra como parte da série; crescimento da receita vem da consistência", () => {
    const p = calcularPares(fichas([par("AAAA3", "S", 0.1), par("BBBB3", "S", 0.2), par("CCCC3", "S", 0.3)]));
    assert.equal(item(p, "AAAA3", "anosComLucro").valor, 1); // 2 de 2 anos
    assert.equal(item(p, "AAAA3", "crescimentoReceita5").motivo, "setor com menos de 3 empresas com dado"); // série de 2 anos: sem crescimento em 5
  });

  test("cada setor tem a sua mediana", () => {
    const p = calcularPares(fichas([par("AAAA3", "X", 0.1), par("BBBB3", "X", 0.2), par("CCCC3", "X", 0.3), par("DDDD3", "Y", 0.9), par("EEEE3", "Y", 0.8), par("FFFF3", "Y", 0.7)]));
    assert.deepEqual([item(p, "AAAA3").mediana, item(p, "DDDD3").mediana], [0.2, 0.8]);
  });
});

describe("HTML do topo da ficha", () => {
  const PROIBIDO = /\bcompre\b|\bvenda\b|barat|\bcar[oa]\b|atrativ|preço-alvo|\bnota\b \d|recomendamos|oportunidade|\bbo[am]\b|\bruim\b|saudável|excelente|péssim|\bótim/i;
  const anual = serie(2015, "lucroLiquido", [100, 120, -30, 140, 150, 160, 170, 180, 190, 200, 210], { receita: 1000, fcl: 50, fco: 100, margemLiquida: 0.1, capex: 120, proventosPagos: 80, dividaLiquida: 400, ebitda: 100, dividaBruta: 500, dividaCurtoPrazo: 0.6 });
  const f = ficha(anual, { proventosPagos: 80, fcl: 50, dividaLiquida: 400, ebitda: 100, dividaBruta: 500, dividaCurtoPrazo: 0.6 });
  f.consistencia = calcularConsistencia(f);
  f.atencao = calcularAtencao(f);

  test("cartões de consistência: o número grande e a conta", () => {
    const html = consistenciaHtml(f.consistencia);
    assert.match(html, /<h3>Ao longo dos anos<\/h3>/);
    assert.match(html, /Série de 11 exercícios de 12 meses, de 2015 a 2025\./);
    assert.equal((html.match(/<li class="cartao">/g) ?? []).length, 8);
    assert.match(html, /<span class="cartao-rotulo">Anos com lucro<\/span><strong class="cartao-numero">10 de 11<\/strong><span class="cartao-conta">anos, 2015–2025<\/span>/);
    assert.match(html, /Maior sequência com lucro<\/span><strong class="cartao-numero">8 anos<\/strong><span class="cartao-conta">8 anos seguidos \(2018–2025\), até o último exercício<\/span>/);
    assert.match(html, /Pior ano da série<\/span><strong class="cartao-numero">2017<\/strong><span class="cartao-conta">2017: prejuízo de R\$ 30 mil/);
  });

  test("métrica sem cálculo mostra — e o motivo, nunca 0", () => {
    const curta = ficha(serie(2023, "lucroLiquido", [1, 2, 3]));
    const html = consistenciaHtml(calcularConsistencia(curta));
    assert.match(html, /<strong class="cartao-numero">—<\/strong><small>em 5 anos<\/small>/);
    assert.match(html, /5 anos: sem cálculo \(série curta \(3 anos\)\)/);
    assert.match(html, /Margem líquida: da menor à maior<\/span><strong class="cartao-numero">—<\/strong><span class="cartao-conta">nenhum ano com dado<\/span>/);
  });

  test("pontos de atenção: as acionadas primeiro, com ícone, conta e limite; depois as 7 num details fechado", () => {
    const html = atencaoHtml(f.atencao);
    assert.match(html, /<h3>Pontos de atenção<\/h3>/);
    assert.ok(html.includes(`<p class="explica">${LEGENDA_DA_ATENCAO}</p>`));
    assert.equal(LEGENDA_DA_ATENCAO, "Regras automáticas sobre os números entregues à CVM. Descrevem fatos, não são recomendação.");
    const acionadas = f.atencao.regras.filter((r) => r.acionada === true).map((r) => r.titulo);
    assert.deepEqual(acionadas, ["Lucro que não vira caixa", "Proventos maiores que o FCL", "Dívida líquida ÷ EBITDA alta", "Dívida concentrada no curto prazo", "Capex maior que o FCO"]);
    assert.equal((html.match(/<ul class="acionadas">.*?<\/ul>/s)[0].match(/<li>/g) ?? []).length, 5);
    assert.match(html, /<li><span class="icone" aria-hidden="true">⚠<\/span><span><strong>Dívida líquida ÷ EBITDA alta\.<\/strong> Dívida líquida ÷ EBITDA de 4,0x nos 12 meses até 30\/09\/2026 \(R\$ 400 mil ÷ R\$ 100 mil\)\. <small>Limite: dívida líquida ÷ EBITDA acima de 3,0\.<\/small><\/span><\/li>/);
    assert.match(html, /<details id="todas-as-regras"><summary>As 7 regras e o estado de cada uma \(5 acionadas, 1 não acionada e 1 não avaliada\)<\/summary>/);
    assert.ok(!/<details[^>]*\bopen\b/.test(html));
    assert.equal((html.match(/<ul class="regras">.*?<\/ul>/s)[0].match(/<li/g) ?? []).length, 7);
    assert.match(html, /<strong>Margem líquida em queda<\/strong><span>Não acionada\. Margem líquida: /);
    // o destaque nunca é só cor: toda regra acionada tem o ícone e o texto
    assert.equal((html.match(/class="icone"/g) ?? []).length, 10);
    assert.match(html, /<strong>Diluição<\/strong><span>Não avaliada: só 0 exercícios com o número de ações na janela \(mínimo: 2\)\.<\/span>/);
  });

  test("regra não avaliada aparece como 'não avaliada', com o motivo", () => {
    const curta = ficha(serie(2023, "lucroLiquido", [1, 2, 3]));
    const html = atencaoHtml(calcularAtencao(curta));
    assert.match(html, /<strong>Lucro que não vira caixa<\/strong><span>Não avaliada: série curta \(3 anos\)\.<\/span>/);
  });

  test("nenhuma acionada: a frase com o link para as 7 regras", () => {
    const calma = ficha(serie(2021, "lucroLiquido", [1, 2, 3, 4, 5], { fco: 100, fcl: 100, capex: 1, proventosPagos: 1, dividaLiquida: -1, ebitda: 10, dividaBruta: 10, dividaCurtoPrazo: 0.1, margemLiquida: 0.1, acoesCirculacao: 1e8, diluicao: 0 }));
    const a = calcularAtencao(calma);
    assert.equal(a.acionadas, 0);
    const html = atencaoHtml(a);
    assert.match(html, /<p class="nenhuma">Nenhuma das 7 regras acionada\. <a href="#todas-as-regras">Ver as 7 regras<\/a>\.<\/p>/);
    assert.ok(!html.includes('class="acionadas"'));
  });

  test("comparação com o setor: tabela com empresa, mediana, tamanho da amostra e posição; os tickers no title e no details", () => {
    const { fichas } = montarFichas({ companhias: [WEG], arquivos: { "005410": ARQUIVO }, cotacoes: COTACOES, hoje: HOJE });
    const umaSo = paresHtml(fichas.WEGE3.pares);
    assert.match(umaSo, /setor com menos de 3 empresas com dado, então não há mediana/);
    assert.ok(!umaSo.includes("<table"));

    const pares = {
      setor: "Bens industriais", exercicio: "2025-12-31", empresas: 3, tickers: ["EMBJ3", "POMO4", "WEGE3"], temExercicio: true,
      itens: [
        { id: "margemLiquida", nome: "Margem líquida", formato: "pct", valor: 0.166, mediana: 0.136, empresas: 3, tickers: ["EMBJ3", "POMO4", "WEGE3"], posicao: "acima da mediana", faixa: null, motivo: null },
        { id: "dividaLiquidaSobreEbitda", nome: "Dívida líquida ÷ EBITDA", formato: "vezes", valor: -0.3, mediana: 0, empresas: 3, tickers: ["EMBJ3", "POMO4", "WEGE3"], posicao: "abaixo da mediana", faixa: null, motivo: null },
        { id: "roe", nome: "ROE", formato: "pct", valor: 0.365, mediana: 0.2, empresas: 5, tickers: ["A", "B", "C", "D", "WEGE3"], posicao: "acima da mediana", faixa: "entre os 25% maiores do setor", motivo: null },
        { id: "roic", nome: "ROIC", formato: "pct", valor: 0.33, mediana: null, empresas: 2, tickers: ["POMO4", "WEGE3"], posicao: null, faixa: null, motivo: "setor com menos de 3 empresas com dado" },
      ],
    };
    const html = paresHtml(pares);
    assert.match(html, /Mediana de 3 empresas do setor Bens industriais, no exercício de 2025\. Estar acima ou abaixo da mediana é só uma posição: não diz se o número é favorável\./);
    assert.match(html, /<details class="amostra"><summary>As 3 empresas da amostra<\/summary><p>EMBJ3, POMO4, WEGE3\./);
    assert.match(html, /<tr><th scope="row">Margem líquida<\/th><td class="n">16,6%<\/td><td class="n" title="Mediana de 3 empresas: EMBJ3, POMO4, WEGE3">13,6% <small>\(3\)<\/small><\/td><td>Acima da mediana<\/td><\/tr>/);
    // com 3 empresas a posição vem sem o quartil; com 5, com ele
    assert.match(html, /<th scope="row">Dívida líquida ÷ EBITDA<\/th>.*?<td>Abaixo da mediana<\/td><\/tr>/s);
    assert.match(html, /<th scope="row">ROE<\/th>.*?<small>\(5\)<\/small><\/td><td>Acima da mediana; entre os 25% maiores do setor<\/td><\/tr>/s);
    assert.match(html, /<th scope="row">ROIC<\/th><td class="n">33,0%<\/td><td class="n">—<\/td><td><span class="vazio">Setor com menos de 3 empresas com dado<\/span><\/td>/);
    // a mesma marcação para acima e abaixo: nenhuma classe de cor na posição
    assert.ok(!/class="(pos|neg|alta|baixa)"/.test(html));
  });

  test("a ficha passa a mostrar o resumo: o espaço #resumo-consistencia fica visível e preenchido, sem JS novo", () => {
    const { fichas } = montarFichas({ companhias: [WEG], arquivos: { "005410": ARQUIVO }, cotacoes: COTACOES, hoje: HOJE });
    const html = fichaHtml(fichas.WEGE3, { hoje: HOJE });
    const secao = /<section class="resumo" id="resumo-consistencia">(.*?)\n<nav class="atalhos"/s.exec(html)[1];
    assert.ok(secao.includes("<h3>Ao longo dos anos</h3>") && secao.includes("<h3>Pontos de atenção</h3>") && secao.includes("<h3>Comparação com o setor</h3>"));
    assert.ok(!/id="resumo-consistencia"[^>]*hidden/.test(html));
    assert.deepEqual([...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['<script src="../ficha.js" defer>']);
    // ficha antiga, sem os campos novos: o espaço continua escondido
    const antiga = fichaDaWeg({ mudar: (x) => { delete x.consistencia; delete x.atencao; delete x.pares; } });
    assert.match(fichaHtml(antiga, { hoje: HOJE }), /<section class="resumo" id="resumo-consistencia" hidden>/);
  });

  test("nenhuma palavra de recomendação nem adjetivo de julgamento no HTML gerado", () => {
    const { fichas } = montarFichas({ companhias: [WEG], arquivos: { "005410": ARQUIVO }, cotacoes: COTACOES, hoje: HOJE });
    const textos = [resumoHtml(f), resumoHtml(fichas.WEGE3), fichaHtml(fichas.WEGE3, { hoje: HOJE })].map((h) => h.replace(/<[^>]+>/g, " "));
    for (const t of textos) assert.doesNotMatch(t, PROIBIDO);
    // as contas e os limites de todas as regras, em qualquer estado
    for (const r of [...f.atencao.regras, ...fichas.WEGE3.atencao.regras]) assert.doesNotMatch(`${r.titulo} ${r.limite} ${r.conta ?? ""} ${r.motivo ?? ""}`, PROIBIDO, r.id);
    assert.match(textos[2], /não são recomendação/);
  });

  test("os três módulos não têm texto de recomendação nem adjetivo de julgamento, nem em comentário", () => {
    for (const nome of ["atencao.mjs", "pares.mjs", "resumo.mjs"]) {
      const fonte = readFileSync(new URL(`../scripts/fundamentos/${nome}`, import.meta.url), "utf8");
      assert.doesNotMatch(fonte, /\bcompre\b|\bvenda\b|barat|atrativ|preço-alvo|saudável|excelente|péssim/i, nome);
    }
  });

  test("texto vindo de dado é escapado", () => {
    const html = paresHtml({ setor: "A&B <i>x</i>", exercicio: "2025-12-31", empresas: 3, tickers: ["A<b>"], temExercicio: true, itens: [] });
    assert.ok(html.includes("A&amp;B &lt;i&gt;x&lt;/i&gt;") && html.includes("A&lt;b&gt;"));
  });
});

describe("ficha: os campos novos", () => {
  const { fichas } = montarFichas({ companhias: [WEG], arquivos: { "005410": ARQUIVO }, cotacoes: COTACOES, hoje: HOJE });
  const weg = fichas.WEGE3;

  test("consistencia, atencao e pares entram na ficha; os pares, depois de montar todas", () => {
    assert.deepEqual(Object.keys(weg).slice(-3), ["consistencia", "atencao", "pares"]);
    assert.equal(weg.consistencia.periodo.anos, 2);
    assert.equal(weg.atencao.total, 7);
    assert.deepEqual([weg.pares.setor, weg.pares.exercicio, weg.pares.empresas], ["Bens industriais", "2025-12-31", 1]);
    assert.equal(fichaDaWeg().pares, undefined); // montarFicha sozinha não tem com quem comparar
  });

  test("os limites usados vão na ficha, e podem ser trocados", () => {
    assert.deepEqual(weg.atencao.limites, LIMITES_ATENCAO);
    const outros = montarFichas({ companhias: [WEG], arquivos: { "005410": ARQUIVO }, hoje: HOJE, limitesAtencao: { ...LIMITES_ATENCAO, dividaLiquidaSobreEbitda: 1 } });
    assert.equal(outros.fichas.WEGE3.atencao.limites.dividaLiquidaSobreEbitda, 1);
  });

  test("WEG com a série curta da fixture (2 anos): as regras de janela (inclusive a dos proventos) ficam não avaliadas, as de hoje avaliam", () => {
    const estado = Object.fromEntries(weg.atencao.regras.map((r) => [r.id, r.acionada]));
    assert.deepEqual(estado, { lucroQueNaoViraCaixa: null, proventosMaioresQueFcl: null, dividaLiquidaAlta: false, dividaNoCurtoPrazo: false, capexMaiorQueFco: null, diluicao: null, margemEmQueda: null });
  });
});
