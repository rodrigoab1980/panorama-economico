// Múltiplos de mercado (#51): valor de mercado pelas classes de ação, P/L, P/VPA, EV/EBITDA e os demais.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { interpretarArquivo, lerArquivos } from "../scripts/cvm/leitor.mjs";
import { montarSeries } from "../scripts/cvm/series.mjs";
import { lerComposicaoCapital } from "../scripts/cvm/composicao-capital.mjs";
import { calcularIndicadoresDaSerie } from "../scripts/cvm/indicadores.mjs";
import {
  LIMITE_DIAS_UTEIS_COTACAO, MULTIPLOS, atrasoDaCotacao, calcularMultiplos, diasUteisEntre, fundamentosParaMultiplos,
  tickersDasClasses, tickersNecessarios, valorDeMercado,
} from "../scripts/cvm/multiplos.mjs";

const IDS = MULTIPLOS.map((m) => m.id);
const perto = (obtido, esperado, tolerancia = 1e-9) => assert.ok(Math.abs(obtido - esperado) <= tolerancia * Math.max(1, Math.abs(esperado)), `${obtido} ≠ ${esperado}`);

// ---------- sintético ----------
// Companhia com 900 ações ordinárias e 100 preferenciais em circulação (1.000 no total).
const composicao = ({ on = 900, pn = 100 } = {}) => ({
  acoesTotal: on + pn, acoesTesouraria: 0, acoesCirculacao: on + pn,
  classes: { on: { total: on, tesouraria: 0, circulacao: on }, pn: { total: pn, tesouraria: 0, circulacao: pn } },
});
const TICKERS = [{ ticker: "ABCD3", ibovespa: false }, { ticker: "ABCD4", ibovespa: true }];
// ON a R$ 10,00 e PN a R$ 20,00: valor de mercado = (900 × 10 + 100 × 20) ÷ 1000 = R$ 11 mil.
const COTACOES = { data: "2026-11-12", precos: { ABCD3: 10, ABCD4: 20 } };
const v = (valor) => ({ valor, motivo: null });
// Fundamentos em R$ mil: lucro 2, PL da controladora 5, não controladores 1, EBITDA 4, EBIT 3,
// dívida líquida 8, proventos 1, FCL 2 e FCL depois dos arrendamentos 1.
const FUNDAMENTOS = {
  lucroControladora: v(2), plControladora: v(5), naoControladores: v(1), ebitda: v(4), ebit: v(3),
  dividaLiquida: v(8), proventosPagos: v(1), fcl: v(2), fclAposArrendamentos: v(1),
};
const calcular = (mudancas = {}) => calcularMultiplos({ fundamentos: FUNDAMENTOS, composicao: composicao(), tickers: TICKERS, cotacoes: COTACOES, hoje: "2026-11-13", ...mudancas });
const com = (fundamentos) => calcular({ fundamentos: { ...FUNDAMENTOS, ...fundamentos } }).multiplos;

describe("múltiplos: a lista", () => {
  test("cada múltiplo tem id, nome, unidade e fórmula, sem repetir id", () => {
    assert.deepEqual(IDS, ["valorMercado", "pl", "pvpa", "ev", "evEbitda", "precoEbit", "earningsYield", "dividendYield", "precoSobreFcl", "precoSobreFclAposArrendamentos"]);
    for (const m of MULTIPLOS) {
      assert.ok(m.nome && m.formula.length > 30, m.id);
      assert.ok(["R$ mil", "razão"].includes(m.unidade), m.id);
    }
  });

  test("as fórmulas do P/VPA e do EV dizem por que os não controladores saem ou entram", () => {
    const formula = (id) => MULTIPLOS.find((m) => m.id === id).formula;
    assert.match(formula("pvpa"), /2\.03 menos a participação dos não controladores, 2\.03\.09.*não pertence/);
    assert.match(formula("ev"), /participação dos não controladores \(2\.03\.09\).*EBITDA consolidado inclui 100% das controladas/);
    assert.match(formula("evEbitda"), /soma os não controladores/);
    assert.match(formula("pl"), /3\.11\.01.*não controladores fica de fora/);
    assert.match(formula("valorMercado"), /unit não entra/);
  });

  test("nenhum texto de recomendação nas fórmulas e nos nomes", () => {
    const proibido = /barat|car[oa]\b|atrativ|pre[çc]o-alvo|compre|venda|recomend|oportunidade|descont/i;
    for (const m of MULTIPLOS) assert.doesNotMatch(`${m.nome} ${m.formula}`, proibido, m.id);
  });

  test("o código do módulo também não tem texto de recomendação, nem em comentário", () => {
    const fonte = readFileSync(new URL("../scripts/cvm/multiplos.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(fonte, /barat|\bcar[oa]\b|atrativ|pre[çc]o-alvo|\bcompre\b|\bvenda\b|recomend/i);
  });

  test("calcularMultiplos devolve um item { valor, motivo } para cada id da lista", () => {
    const r = calcular();
    assert.deepEqual(Object.keys(r.multiplos), IDS);
    for (const [id, m] of Object.entries(r.multiplos)) assert.deepEqual(Object.keys(m), ["valor", "motivo"], id);
  });
});

describe("múltiplos: cada conta, num caso sintético", () => {
  const r = calcular();
  const esperado = {
    valorMercado: 11, // (900 × 10 + 100 × 20) ÷ 1000
    pl: 11 / 2,
    pvpa: 11 / 5,
    ev: 11 + 8 + 1, // valor de mercado + dívida líquida + não controladores
    evEbitda: 20 / 4,
    precoEbit: 11 / 3,
    earningsYield: 2 / 11,
    dividendYield: 1 / 11,
    precoSobreFcl: 11 / 2,
    precoSobreFclAposArrendamentos: 11 / 1,
  };
  for (const [id, valor] of Object.entries(esperado)) {
    test(`${id} = ${valor}`, () => assert.deepEqual(r.multiplos[id], { valor, motivo: null }));
  }

  test("o resultado diz o pregão, se a cotação está em dia e de onde saiu cada preço", () => {
    assert.deepEqual([r.dataPregao, r.desatualizado, r.diasUteis, r.aproximado], ["2026-11-12", false, 1, false]);
    assert.deepEqual(r.valorMercado.classes, [
      { classe: "on", acoes: 900, ticker: "ABCD3", preco: 10, aproximado: false, origem: "fechamento de ABCD3" },
      { classe: "pn", acoes: 100, ticker: "ABCD4", preco: 20, aproximado: false, origem: "fechamento de ABCD4" },
    ]);
  });

  test("caixa líquido (dívida líquida negativa) reduz o EV", () => {
    const m = com({ dividaLiquida: v(-6) });
    assert.equal(m.ev.valor, 11 - 6 + 1);
    assert.equal(m.evEbitda.valor, 6 / 4);
  });
});

describe("múltiplos: regras de borda", () => {
  test("lucro negativo: P/L não se aplica, e o earnings yield sai negativo", () => {
    const m = com({ lucroControladora: v(-2) });
    assert.deepEqual(m.pl, { valor: null, motivo: "não se aplica: lucro zero ou negativo" });
    assert.deepEqual(m.earningsYield, { valor: -2 / 11, motivo: null });
  });

  test("lucro zero: P/L não se aplica, e o earnings yield é zero", () => {
    const m = com({ lucroControladora: v(0) });
    assert.deepEqual(m.pl, { valor: null, motivo: "não se aplica: lucro zero ou negativo" });
    assert.deepEqual(m.earningsYield, { valor: 0, motivo: null });
  });

  test("EBITDA zero ou negativo: EV/EBITDA não se aplica; o EV continua saindo", () => {
    for (const ebitda of [0, -4]) {
      const m = com({ ebitda: v(ebitda) });
      assert.deepEqual(m.evEbitda, { valor: null, motivo: "não se aplica: EBITDA zero ou negativo" });
      assert.equal(m.ev.valor, 20);
    }
  });

  test("EV zero ou negativo (caixa líquido maior que o valor de mercado): EV/EBITDA não se aplica, nunca negativo", () => {
    const m = com({ dividaLiquida: v(-30) });
    assert.equal(m.ev.valor, 11 - 30 + 1);
    assert.equal(m.evEbitda.valor, null);
    assert.match(m.evEbitda.motivo, /^não se aplica: EV zero ou negativo/);
  });

  test("PL, EBIT e FCL zero ou negativos: não se aplica", () => {
    const m = com({ plControladora: v(-5), ebit: v(0), fcl: v(-2), fclAposArrendamentos: v(0) });
    assert.deepEqual(m.pvpa, { valor: null, motivo: "não se aplica: patrimônio líquido zero ou negativo" });
    assert.deepEqual(m.precoEbit, { valor: null, motivo: "não se aplica: EBIT zero ou negativo" });
    assert.deepEqual(m.precoSobreFcl, { valor: null, motivo: "não se aplica: FCL zero ou negativo" });
    assert.deepEqual(m.precoSobreFclAposArrendamentos, { valor: null, motivo: "não se aplica: FCL zero ou negativo" });
  });

  test("P/L, P/VPA, EV/EBITDA, preço/EBIT e preço/FCL nunca saem negativos nem zero", () => {
    const sinais = [-3, 0, 3];
    for (const lucro of sinais) for (const ebitda of sinais) for (const divida of [-50, 0, 50]) {
      const m = com({ lucroControladora: v(lucro), plControladora: v(lucro), ebitda: v(ebitda), ebit: v(ebitda), fcl: v(lucro), dividaLiquida: v(divida) });
      for (const id of ["pl", "pvpa", "evEbitda", "precoEbit", "precoSobreFcl"]) assert.ok(m[id].valor === null || m[id].valor > 0, `${id} = ${m[id].valor}`);
    }
  });

  test("fundamento que falta: o múltiplo dele fica null com o motivo do fundamento; os outros saem", () => {
    const m = com({ fclAposArrendamentos: { valor: null, motivo: "pagamento de arrendamento não identificado na DFC" }, proventosPagos: { valor: null, motivo: "não identificado" } });
    assert.deepEqual(m.precoSobreFclAposArrendamentos, { valor: null, motivo: "pagamento de arrendamento não identificado na DFC" });
    assert.deepEqual(m.dividendYield, { valor: null, motivo: "não identificado" });
    assert.equal(m.pl.valor, 5.5);
  });

  test("fundamento indisponível (12 meses indisponíveis): todos os múltiplos com fundamento ficam null com o motivo da série", () => {
    const motivo = "a companhia passou a consolidar: o ITR de 30/06/2026 é consolidado e o de 30/06/2025 é individual";
    const fundamentos = fundamentosParaMultiplos({ tipo: "indisponivel", motivo, fluxos: null, estoques: { contas: { "2.03": { valor: 800 } } } }, {});
    for (const f of Object.values(fundamentos)) assert.deepEqual(f, { valor: null, motivo });
    const r = calcular({ fundamentos });
    for (const id of IDS.filter((i) => i !== "valorMercado")) assert.deepEqual(r.multiplos[id], { valor: null, motivo }, id);
    // O valor de mercado só depende do preço e do número de ações, e continua saindo.
    assert.equal(r.multiplos.valorMercado.valor, 11);
  });

  test("sem fundamentos, sem arquivo de cotações ou sem composição: null com motivo, nunca erro", () => {
    assert.equal(calcular({ fundamentos: null }).multiplos.pl.motivo, "sem os fundamentos dos 12 meses");
    const semCotacoes = calcular({ cotacoes: null });
    assert.deepEqual([semCotacoes.dataPregao, semCotacoes.desatualizado], [null, null]);
    for (const id of IDS) assert.equal(semCotacoes.multiplos[id].valor, null, id);
    assert.equal(semCotacoes.multiplos.valorMercado.motivo, "sem arquivo de cotações");
    assert.equal(semCotacoes.multiplos.pl.motivo, "sem arquivo de cotações");
    assert.equal(calcular({ composicao: null }).multiplos.valorMercado.motivo, "falta a composição do capital");
  });

  test("nenhum motivo aparece junto com valor, e nenhum null fica sem motivo", () => {
    const casos = [calcular(), calcular({ cotacoes: null }), calcular({ composicao: null }), calcular({ fundamentos: null }),
      calcular({ fundamentos: { ...FUNDAMENTOS, lucroControladora: v(-1), ebitda: v(0) } })];
    for (const r of casos) for (const [id, m] of Object.entries(r.multiplos)) {
      assert.ok((m.valor === null) !== (m.motivo === null), `${id}: ${JSON.stringify(m)}`);
    }
  });
});

describe("valor de mercado: classes, units e classe sem cotação", () => {
  test("soma as classes, cada uma com o seu preço", () => {
    const r = valorDeMercado({ composicao: composicao(), tickers: TICKERS, precos: COTACOES.precos });
    assert.deepEqual([r.valor, r.motivo, r.aproximado], [11, null, false]);
  });

  test("companhia só com ordinárias: a classe PN não entra nem pede cotação", () => {
    const r = valorDeMercado({ composicao: composicao({ on: 1000, pn: 0 }), tickers: [{ ticker: "ABCD3", ibovespa: true }], precos: { ABCD3: 10 } });
    assert.deepEqual([r.valor, r.aproximado, r.classes.length, r.classes[0].classe], [10, false, 1, "on"]);
  });

  test("classe sem cotação: usa o preço da outra, com a marca de aproximado e o motivo na origem", () => {
    // a PN existe na composição, mas não negociou
    const r = valorDeMercado({ composicao: composicao(), tickers: TICKERS, precos: { ABCD3: 10 } });
    assert.equal(r.valor, (900 * 10 + 100 * 10) / 1000);
    assert.equal(r.aproximado, true);
    assert.deepEqual(r.classes[1], { classe: "pn", acoes: 100, ticker: "ABCD3", preco: 10, aproximado: true, origem: "sem cotação das preferenciais; usado o fechamento de ABCD3 (ordinárias)" });
    assert.equal(r.classes[0].aproximado, false);
    // o contrário: só a PN negocia
    const soPn = valorDeMercado({ composicao: composicao(), tickers: TICKERS, precos: { ABCD4: 20 } });
    assert.deepEqual([soPn.valor, soPn.aproximado, soPn.classes[0].origem], [20, true, "sem cotação das ordinárias; usado o fechamento de ABCD4 (preferenciais)"]);
    // e a marca chega ao resultado dos múltiplos
    assert.equal(calcular({ cotacoes: { data: "2026-11-12", precos: { ABCD3: 10 } } }).aproximado, true);
  });

  test("nenhuma classe com cotação: null, mesmo que a unit tenha preço", () => {
    const r = valorDeMercado({ composicao: composicao(), tickers: [{ ticker: "ABCD11", ibovespa: true }], precos: { ABCD11: 50 } });
    assert.deepEqual([r.valor, r.aproximado, r.classes], [null, false, []]);
    assert.equal(r.motivo, "sem cotação para nenhuma classe de ação (procurados: ABCD3, ABCD4, ABCD5, ABCD6, ABCD7, ABCD8)");
  });

  test("unit: o valor de mercado sai das classes 3 e 4, achadas pela raiz do ticker, e nunca da unit", () => {
    // unit = 1 ON + 4 PN; ON a 3,60, PN a 3,50, unit a 17,60. 400 ON e 1.600 PN em circulação.
    const args = { composicao: composicao({ on: 400, pn: 1600 }), tickers: [{ ticker: "KLBN11", ibovespa: true }] };
    const r = valorDeMercado({ ...args, precos: { KLBN11: 17.6, KLBN3: 3.6, KLBN4: 3.5 } });
    perto(r.valor, (400 * 3.6 + 1600 * 3.5) / 1000);
    assert.deepEqual(r.classes.map((k) => k.ticker), ["KLBN3", "KLBN4"]);
    // mudar o preço da unit não muda nada
    assert.equal(valorDeMercado({ ...args, precos: { KLBN11: 999, KLBN3: 3.6, KLBN4: 3.5 } }).valor, r.valor);
  });

  test("mais de uma classe de preferencial: vale a do Ibovespa; sem ela, a de final menor com cotação", () => {
    const tickers = [{ ticker: "USIM3", ibovespa: false }, { ticker: "USIM5", ibovespa: true }, { ticker: "USIM6", ibovespa: false }];
    assert.deepEqual(tickersDasClasses(tickers), { on: ["USIM3"], pn: ["USIM5", "USIM6", "USIM4", "USIM7", "USIM8"], units: ["USIM11"] });
    const r = valorDeMercado({ composicao: composicao(), tickers, precos: { USIM3: 10, USIM5: 20, USIM6: 99 } });
    assert.equal(r.classes[1].ticker, "USIM5");
    const semA5 = valorDeMercado({ composicao: composicao(), tickers, precos: { USIM3: 10, USIM6: 99 } });
    assert.deepEqual([semA5.classes[1].ticker, semA5.aproximado], ["USIM6", false]);
  });

  test("preço zero, negativo ou que não é número conta como sem cotação", () => {
    for (const ruim of [0, -1, null, "10", NaN]) {
      const r = valorDeMercado({ composicao: composicao(), tickers: TICKERS, precos: { ABCD3: 10, ABCD4: ruim } });
      assert.deepEqual([r.valor, r.aproximado], [10, true], String(ruim));
    }
  });

  test("composição sem as classes, sem o número de uma classe ou sem ações: null com motivo", () => {
    const args = { tickers: TICKERS, precos: COTACOES.precos };
    assert.equal(valorDeMercado({ ...args, composicao: null }).motivo, "falta a composição do capital");
    assert.equal(valorDeMercado({ ...args, composicao: { acoesCirculacao: 1000 } }).motivo, "a composição do capital não separa ordinárias e preferenciais");
    const semPn = composicao();
    semPn.classes.pn = { total: null, tesouraria: 0, circulacao: null };
    assert.equal(valorDeMercado({ ...args, composicao: semPn }).motivo, "a composição do capital não informa o número de ações preferenciais");
    assert.equal(valorDeMercado({ ...args, composicao: composicao({ on: 0, pn: 0 }) }).motivo, "a composição do capital não tem ações em circulação");
  });

  test("tickersNecessarios: os do universo e os das classes de cada companhia, sem repetir", () => {
    const universo = [{ tickers: [{ ticker: "KLBN11" }] }, { tickers: [{ ticker: "WEGE3" }] }, { tickers: [{ ticker: "PETR3" }, { ticker: "PETR4" }] }];
    const r = tickersNecessarios(universo);
    for (const t of ["KLBN11", "KLBN3", "KLBN4", "WEGE3", "WEGE4", "WEGE11", "PETR3", "PETR4"]) assert.ok(r.includes(t), t);
    assert.equal(new Set(r).size, r.length);
    assert.deepEqual(r, [...r].sort());
    assert.deepEqual(tickersNecessarios(null), []);
  });

  test("o universo do repositório: 74 companhias, e todas têm ticker de ON ou de PN para procurar", () => {
    const { mapeadas } = JSON.parse(readFileSync(new URL("../scripts/cvm/universo.json", import.meta.url), "utf8"));
    assert.equal(mapeadas.length, 74);
    const necessarios = tickersNecessarios(mapeadas);
    for (const c of mapeadas) {
      for (const t of c.tickers) assert.ok(necessarios.includes(t.ticker), t.ticker);
      assert.ok(tickersDasClasses(c.tickers).on.length > 0, c.nome);
    }
    assert.ok(necessarios.includes("KLBN3") && necessarios.includes("KLBN4"));
  });
});

describe("cotação desatualizada: mais de 5 dias úteis entre o pregão e o dia do build", () => {
  test("diasUteisEntre conta de segunda a sexta, sem o dia de partida", () => {
    assert.equal(diasUteisEntre("2026-11-12", "2026-11-12"), 0); // mesmo dia
    assert.equal(diasUteisEntre("2026-11-12", "2026-11-13"), 1); // quinta → sexta
    assert.equal(diasUteisEntre("2026-11-13", "2026-11-14"), 0); // sexta → sábado
    assert.equal(diasUteisEntre("2026-11-13", "2026-11-15"), 0); // sexta → domingo
    assert.equal(diasUteisEntre("2026-11-13", "2026-11-16"), 1); // sexta → segunda
    assert.equal(diasUteisEntre("2026-11-12", "2026-11-19"), 5); // uma semana
    assert.equal(diasUteisEntre("2026-11-12", "2026-11-20"), 6);
    assert.equal(diasUteisEntre("2025-12-31", "2026-01-02"), 2); // vira o ano; feriado não é descontado
    assert.equal(diasUteisEntre("2026-11-13", "2026-11-12"), 0); // hoje antes do pregão
  });

  test("datas inválidas: null", () => {
    assert.equal(diasUteisEntre(null, "2026-11-13"), null);
    assert.equal(diasUteisEntre("12/11/2026", "2026-11-13"), null);
    assert.equal(diasUteisEntre("2026-11-12", undefined), null);
    assert.equal(diasUteisEntre("2026-13-45", "2026-11-13"), null);
  });

  test("até 5 dias úteis está em dia; com 6, desatualizada", () => {
    assert.equal(LIMITE_DIAS_UTEIS_COTACAO, 5);
    assert.deepEqual(atrasoDaCotacao("2026-11-12", "2026-11-19"), { desatualizado: false, diasUteis: 5 });
    assert.deepEqual(atrasoDaCotacao("2026-11-12", "2026-11-20"), { desatualizado: true, diasUteis: 6 });
    assert.deepEqual(atrasoDaCotacao("2026-11-12", "2026-11-21"), { desatualizado: true, diasUteis: 6 }); // sábado não soma
    assert.deepEqual(atrasoDaCotacao(null, "2026-11-20"), { desatualizado: null, diasUteis: null });
  });

  test("o múltiplo continua saindo com a cotação desatualizada, com a marca e a data do pregão", () => {
    const r = calcular({ hoje: "2026-12-01" });
    assert.deepEqual([r.dataPregao, r.desatualizado, r.diasUteis], ["2026-11-12", true, 13]);
    assert.deepEqual(r.multiplos, calcular().multiplos);
  });
});

// ---------- WEG, conta à mão ----------
const DIR = new URL("./fixtures/cvm/", import.meta.url);
const texto = (pasta, nome) => new TextDecoder("latin1").decode(readFileSync(new URL(`${pasta}/${nome}`, DIR)));
function companhia(pasta) {
  const nomes = readdirSync(new URL(`${pasta}/`, DIR));
  const series = montarSeries(lerArquivos(nomes.filter((n) => interpretarArquivo(n)).map((nome) => ({ nome, linhas: texto(pasta, nome).split("\n") }))));
  const composicoes = nomes.filter((n) => n.includes("composicao_capital")).flatMap((n) => lerComposicaoCapital(texto(pasta, n)));
  return { series, indicadores: calcularIndicadoresDaSerie(series, { composicoes }) };
}
const WEG = companhia("weg");
const TICKERS_WEG = [{ ticker: "WEGE3", ibovespa: true }];

describe("WEG, exercício de 2025, com WEGE3 a R$ 50,00: conta à mão", () => {
  // Da DFP de 2025 (R$ mil) e da composição do capital de 31/12/2025:
  //   ações em circulação   4.197.317.998 − 1.622.025 (tesouraria) = 4.195.695.973, todas ordinárias
  //   lucro da controladora (3.11.01)                 6.376.219
  //   patrimônio líquido (2.03)                      18.553.364
  //   não controladores (2.03.09)                     1.136.179
  //   EBITDA                                          9.000.037
  //   EBIT (3.05)                                     7.998.741
  //   dívida bruta 4.590.822 − caixa 7.279.865 =     −2.689.043 (caixa líquido)
  //   proventos pagos                                 5.384.769
  //   FCL (FCO 6.451.033 − capex 2.691.321)           3.759.712
  //
  //   valor de mercado = 4.195.695.973 × 50,00 ÷ 1.000        = 209.784.798,65
  //   P/L              = 209.784.798,65 ÷ 6.376.219           = 32,90
  //   PL controladora  = 18.553.364 − 1.136.179               = 17.417.185
  //   P/VPA            = 209.784.798,65 ÷ 17.417.185          = 12,04
  //   EV               = 209.784.798,65 − 2.689.043 + 1.136.179 = 208.231.934,65
  //   EV/EBITDA        = 208.231.934,65 ÷ 9.000.037           = 23,14
  //   dividend yield   = 5.384.769 ÷ 209.784.798,65           = 2,57%
  const anual = WEG.indicadores.anual.find((p) => p.fim === "2025-12-31");
  const periodo = WEG.series.anual.find((p) => p.fim === "2025-12-31");
  const fundamentos = fundamentosParaMultiplos(periodo, anual.indicadores);
  const r = calcularMultiplos({ fundamentos, composicao: anual.composicao, tickers: TICKERS_WEG, cotacoes: { data: "2026-11-12", precos: { WEGE3: 50 } }, hoje: "2026-11-13" });
  const m = r.multiplos;

  test("os fundamentos que entram na conta", () => {
    assert.deepEqual(Object.fromEntries(Object.entries(fundamentos).map(([id, f]) => [id, f.valor])), {
      lucroControladora: 6_376_219, plControladora: 17_417_185, naoControladores: 1_136_179, ebitda: 9_000_037, ebit: 7_998_741,
      dividaLiquida: -2_689_043, proventosPagos: 5_384_769, fcl: 3_759_712, fclAposArrendamentos: null,
    });
  });

  test("valor de mercado = 4.195.695.973 × 50 ÷ 1.000 = 209.784.798,65 (R$ mil)", () => {
    perto(m.valorMercado.valor, 209_784_798.65);
    assert.deepEqual(r.valorMercado.classes, [{ classe: "on", acoes: 4_195_695_973, ticker: "WEGE3", preco: 50, aproximado: false, origem: "fechamento de WEGE3" }]);
    assert.equal(r.aproximado, false);
  });

  test("P/L = 32,90", () => {
    perto(m.pl.valor, 209_784_798.65 / 6_376_219);
    assert.equal(m.pl.valor.toFixed(2), "32.90");
  });

  test("P/VPA = 12,04, sobre o PL sem os não controladores", () => {
    perto(m.pvpa.valor, 209_784_798.65 / 17_417_185);
    assert.equal(m.pvpa.valor.toFixed(2), "12.04");
  });

  test("EV = 208.231.934,65 e EV/EBITDA = 23,14", () => {
    perto(m.ev.valor, 208_231_934.65);
    assert.equal(m.evEbitda.valor.toFixed(2), "23.14");
  });

  test("dividend yield = 2,57%", () => {
    perto(m.dividendYield.valor, 5_384_769 / 209_784_798.65);
    assert.equal((m.dividendYield.valor * 100).toFixed(2), "2.57");
  });

  test("earnings yield é o inverso do P/L; preço/EBIT e preço/FCL", () => {
    perto(m.earningsYield.valor, 1 / m.pl.valor);
    perto(m.precoEbit.valor, 209_784_798.65 / 7_998_741);
    perto(m.precoSobreFcl.valor, 209_784_798.65 / 3_759_712);
  });

  test("a WEG não tem linha de arrendamento na DFC: o preço/FCL depois dos arrendamentos é null com o motivo", () => {
    assert.equal(m.precoSobreFclAposArrendamentos.valor, null);
    assert.equal(m.precoSobreFclAposArrendamentos.motivo, anual.indicadores.fclAposArrendamentos.motivo);
  });
});

describe("WEG, 12 meses até 30/09/2026: é a base que a página usa", () => {
  const { doze } = WEG.indicadores;
  const fundamentos = fundamentosParaMultiplos(WEG.series.doze, doze.indicadores);
  const r = calcularMultiplos({ fundamentos, composicao: doze.composicao, tickers: TICKERS_WEG, cotacoes: { data: "2026-11-12", precos: { WEGE3: 50 } }, hoje: "2026-11-13" });

  test("usa a composição do ITR de 30/09/2026 e o balanço da mesma data", () => {
    assert.equal(doze.composicao.dtRefer, "2026-09-30");
    assert.equal(r.valorMercado.classes[0].acoes, 4_197_317_998 - 1_488_307);
    // PL de 30/09/2026 (21.367.143) menos os não controladores (1.410.309)
    assert.equal(fundamentos.plControladora.valor, 21_367_143 - 1_410_309);
    assert.equal(fundamentos.lucroControladora.valor, 6_268_804);
  });

  test("P/L e EV/EBITDA dos 12 meses", () => {
    const vm = ((4_197_317_998 - 1_488_307) * 50) / 1000;
    perto(r.multiplos.pl.valor, vm / 6_268_804);
    perto(r.multiplos.evEbitda.valor, (vm - 2_585_002 + 1_410_309) / 8_952_604);
  });
});

describe("fundamentos para os múltiplos", () => {
  test("balanço sem a conta 2.03.09 (só individual): não controladores contam como zero", () => {
    const contas = (lista) => ({ contas: Object.entries(lista).map(([conta, valor]) => ({ conta, descricao: "", contaFixa: true, valor })) });
    const periodo = { inicio: "2025-01-01", fim: "2025-12-31", tipo: "anual", meses: 12, demonstrativos: { DRE: contas({ "3.11": 100 }), BPP: contas({ "2.03": 800 }) } };
    const f = fundamentosParaMultiplos(periodo, {});
    assert.deepEqual([f.naoControladores, f.plControladora], [{ valor: 0, motivo: null }, { valor: 800, motivo: null }]);
    assert.deepEqual(f.lucroControladora, { valor: 100, motivo: null }); // sem 3.11.01, vale o 3.11
    assert.deepEqual(f.ebitda, { valor: null, motivo: "falta o indicador ebitda" });
  });

  test("sem o patrimônio líquido: null com motivo", () => {
    const periodo = { inicio: "2025-01-01", fim: "2025-12-31", tipo: "anual", meses: 12, demonstrativos: { BPP: { contas: [] } } };
    assert.deepEqual(fundamentosParaMultiplos(periodo, {}).plControladora, { valor: null, motivo: "falta a conta 2.03 (patrimônio líquido)" });
  });
});
