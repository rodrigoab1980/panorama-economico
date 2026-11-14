// Painel da página inicial dos fundamentos (#66): a temporada, as variações do lucro no acumulado,
// o lucro somado por setor e os pontos de atenção em todas as fichas.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LIMITE_DA_BASE, MINIMO_POR_SETOR, TAMANHO_DA_LISTA, atencaoNasFichas, comparacaoDaCompanhia, entregueAte, lucroPorSetor, montarPainel,
  nomeCurto, numerosDaTemporada, referenciaDaTemporada, variacoesDoLucro,
} from "../scripts/fundamentos/painel.mjs";
import { MARCADOR_DO_PAINEL, NOTA_DO_ACUMULADO, comSinal, inserirPainel, notaDoSetor, painelHtml } from "../scripts/fundamentos/painel-html.mjs";
import { acumuladoDoAno } from "../scripts/cvm/ficha.mjs";
import { fichaDaWeg } from "./apoio/ficha.mjs";

// ---------- fichas de teste ----------
// Uma ficha só com o que o painel lê. Valores em R$ mil, como vêm da CVM.
//   atual, anterior   [receita, lucro] do acumulado
//   ref               dtRefer do documento mais recente da companhia
//   base              [consolidado do atual, consolidado do anterior]
function cia(ticker, { setor = "Indústria", ref = "2026-09-30", atual = [1_000_000, 100_000], anterior = [900_000, 80_000], base = [true, true], motivo = null, regras = [], recebidoEm = "2026-10-30" } = {}) {
  const lado = ([receita, lucroLiquido], dtRefer, consolidado) => ({ inicio: `${dtRefer.slice(0, 4)}-01-01`, fim: dtRefer, dtRefer, consolidado, receita, lucroLiquido });
  const anoAntes = `${Number(ref.slice(0, 4)) - 1}${ref.slice(4)}`;
  return {
    ticker, nome: `${ticker} Companhia S.A.`, setor,
    documentoMaisRecente: { tipo: "itr", dtRefer: ref, versao: 1 },
    anual: [],
    doze: {
      tipo: motivo ? "indisponivel" : "itr", motivo,
      origem: [{ parcela: "acumuladoAtual", documento: "itr", dtRefer: ref, recebidoEm }],
      acumulado: motivo ? null : { atual: lado(atual, ref, base[0]), anterior: lado(anterior, anoAntes, base[1]) },
    },
    atencao: { regras: [["lucroQueNaoViraCaixa", "Lucro que não vira caixa"], ["diluicao", "Diluição"], ["margemEmQueda", "Margem líquida em queda"]].map(([id, titulo]) => ({ id, titulo, limite: `limite de ${id}`, acionada: regras.includes(id) ? true : regras.includes(`${id}?`) ? null : false })) },
  };
}
// Só o lucro: [anterior, atual].
const comLucro = (ticker, anterior, atual, extra = {}) => cia(ticker, { atual: [1_000_000, atual], anterior: [1_000_000, anterior], ...extra });
const REF = { dtRefer: "2026-09-30", tipo: "itr", nome: "3T26", documento: "ITR de 30/09/2026" };
const comparadas = (fichas) => fichas.map((f) => ({ ticker: f.ticker, nome: f.nome, setor: f.setor, ...comparacaoDaCompanhia(f, REF) }));
const tickers = (itens) => itens.map((x) => x.ticker);

// ---------- período de referência ----------
describe("temporada: o período de referência", () => {
  test("é o dtRefer mais recente entre os documentos, e o nome sai do mês do ITR", () => {
    assert.deepEqual(referenciaDaTemporada([cia("AAAA3", { ref: "2026-06-30" }), cia("BBBB3"), cia("CCCC3", { ref: "2026-06-30" })]), REF);
    assert.equal(referenciaDaTemporada([cia("AAAA3", { ref: "2026-03-31" })]).nome, "1T26");
    assert.equal(referenciaDaTemporada([cia("AAAA3", { ref: "2026-06-30" })]).nome, "2T26");
  });

  test("com a DFP como documento mais recente, a temporada é o exercício", () => {
    const f = { ...cia("AAAA3"), documentoMaisRecente: { tipo: "dfp", dtRefer: "2026-12-31", versao: 1 } };
    assert.deepEqual(referenciaDaTemporada([cia("BBBB3"), f]), { dtRefer: "2026-12-31", tipo: "dfp", nome: "Exercício de 2026", documento: "DFP de 31/12/2026" });
  });

  test("ITR fora dos meses de trimestre civil leva a data no nome; sem documento, não há referência", () => {
    assert.equal(referenciaDaTemporada([cia("AAAA3", { ref: "2026-08-31" })]).nome, "ITR de 31/08/2026");
    assert.equal(referenciaDaTemporada([]), null);
    assert.equal(referenciaDaTemporada([{ ticker: "X", documentoMaisRecente: null }]), null);
    assert.equal(montarPainel([]), null);
    assert.equal(montarPainel(null), null);
  });
});

// ---------- temporada ----------
describe("temporada: o progresso e os quatro números", () => {
  test("companhia sem o documento do período conta como 'ainda não entregou' e fica fora dos números", () => {
    const p = montarPainel([cia("AAAA3"), cia("BBBB3", { ref: "2026-06-30", atual: [1, -500_000] }), cia("CCCC3")], { total: 5 });
    assert.deepEqual([p.entregaram, p.total, p.comparadas], [2, 5, 2]);
    // o prejuízo de quem ainda não entregou não entra
    assert.deepEqual(p.numeros.prejuizo, { valor: 0, total: 2 });
    assert.ok(!JSON.stringify(p).includes("BBBB3"));
  });

  test("as companhias sem ficha entram no total: o total nunca fica abaixo do número de fichas", () => {
    assert.equal(montarPainel([cia("AAAA3"), cia("BBBB3")]).total, 2);
    assert.equal(montarPainel([cia("AAAA3"), cia("BBBB3")], { total: 1 }).total, 2);
    assert.equal(montarPainel({ AAAA3: cia("AAAA3") }, { total: 64 }).total, 64);
  });

  test("base diferente entre o atual e o anterior: fica fora da comparação, com o motivo e a contagem", () => {
    const p = montarPainel([cia("AAAA3"), cia("BBBB3", { base: [true, false] }), cia("CCCC3", { base: [false, false] })]);
    assert.deepEqual([p.entregaram, p.comparadas], [3, 2]);
    assert.deepEqual(p.semComparacao, [{ ticker: "BBBB3", motivo: "base diferente: o período atual é consolidado e o anterior é individual" }]);
    assert.deepEqual(p.numeros.lucroMaior, { valor: 2, total: 2 });
  });

  test("12 meses indisponíveis (a companhia passou a consolidar): entregou, mas fica fora, com o motivo dos 12 meses", () => {
    const motivo = "a companhia passou a consolidar: o ITR de 30/09/2026 é consolidado, a DFP de 31/12/2025 é individual e o ITR de 30/09/2025 é individual";
    const p = montarPainel([cia("AAAA3"), cia("TIMS3", { motivo })]);
    assert.deepEqual([p.entregaram, p.comparadas], [2, 1]);
    assert.deepEqual(p.semComparacao, [{ ticker: "TIMS3", motivo }]);
  });

  test("empate: igual ao ano anterior entra no denominador e não entra no numerador", () => {
    const n = numerosDaTemporada(comparadas([
      cia("AAAA3", { atual: [1000, 100], anterior: [1000, 100] }),
      cia("BBBB3", { atual: [1100, 121], anterior: [1000, 100] }),
      cia("CCCC3", { atual: [900, 80], anterior: [1000, 100] }),
    ]));
    assert.deepEqual(n, { lucroMaior: { valor: 1, total: 3 }, receitaMaior: { valor: 1, total: 3 }, margemMaior: { valor: 1, total: 3 }, prejuizo: { valor: 0, total: 3 } });
  });

  test("cada número tem o seu denominador: sem receita, a companhia sai da receita e da margem, não do lucro", () => {
    const n = numerosDaTemporada(comparadas([
      cia("AAAA3", { atual: [null, 120], anterior: [1000, 100] }),
      cia("BBBB3", { atual: [0, -50], anterior: [1000, 100] }),
      cia("CCCC3", { atual: [1200, 90], anterior: [1000, 100] }),
    ]));
    assert.deepEqual(n.lucroMaior, { valor: 1, total: 3 });
    assert.deepEqual(n.receitaMaior, { valor: 1, total: 2 });
    // receita zero: não há margem
    assert.deepEqual(n.margemMaior, { valor: 0, total: 1 });
    assert.deepEqual(n.prejuizo, { valor: 1, total: 3 });
  });

  test("lucro igual a zero não é lucro: conta em \"prejuízo no acumulado\", como nas listas e na régua", () => {
    const fichas = [
      comLucro("AAAA3", 100_000, 0), // zero: conta
      comLucro("BBBB3", 100_000, -1), // prejuízo: conta
      comLucro("CCCC3", 100_000, 1), // lucro de R$ 1 mil: não conta
      comLucro("DDDD3", 0, 100_000), // zero só no ano anterior: não conta
    ];
    const lista = comparadas(fichas);
    assert.deepEqual(numerosDaTemporada(lista).prejuizo, { valor: 2, total: 4 });
    // o mesmo lado do zero nas listas de variação
    const v = variacoesDoLucro(lista);
    assert.deepEqual(tickers(v.viraramPrejuizo), ["AAAA3", "BBBB3"]);
    assert.deepEqual(tickers(v.viraramLucro), ["DDDD3"]);
    // e na página
    assert.match(painelHtml(montarPainel(fichas)), /<li><strong class="n">2 <small>de 4<\/small><\/strong><span>prejuízo no acumulado<\/span><\/li>/);
  });

  test("sem lucro informado ou com a demonstração zerada num dos períodos: fora da comparação, nunca como zero", () => {
    assert.equal(comparacaoDaCompanhia(cia("AAAA3", { atual: [1000, null] }), REF).motivo, "sem lucro informado no período atual");
    assert.equal(comparacaoDaCompanhia(cia("AAAA3", { anterior: [0, 0] }), REF).motivo, "sem lucro informado no período anterior");
    // resultado zero com receita é dado, não falta
    assert.equal(comparacaoDaCompanhia(cia("AAAA3", { atual: [1000, 0] }), REF).motivo, null);
  });

  test("acumulado de outro período (a ficha ainda está no trimestre anterior): fora, sem inventar comparação", () => {
    const f = cia("AAAA3");
    f.doze.acumulado.atual.dtRefer = "2026-06-30";
    assert.equal(comparacaoDaCompanhia(f, REF).motivo, "sem o acumulado do mesmo período do ano anterior");
  });
});

describe("temporada do exercício (DFP): o ano contra o ano anterior", () => {
  const ano = (a, receita, lucro, extra = {}) => ({ inicio: `${a}-01-01`, fim: `${a}-12-31`, tipo: "anual", meses: 12, origem: { consolidado: true }, indicadores: { receita: { valor: receita }, lucroLiquido: { valor: lucro } }, ...extra });
  const ref = { dtRefer: "2026-12-31", tipo: "dfp" };
  const ficha = (anual) => ({ ticker: "AAAA3", nome: "A S.A.", documentoMaisRecente: { tipo: "dfp", dtRefer: "2026-12-31" }, anual });

  test("usa os dois últimos exercícios de 12 meses, na mesma base", () => {
    assert.deepEqual(comparacaoDaCompanhia(ficha([ano(2025, 1000, 100), ano(2026, 1200, 90)]), ref), { atual: { receita: 1200, lucro: 90 }, anterior: { receita: 1000, lucro: 100 }, motivo: null });
  });

  test("série curta, exercício de transição, buraco na série e base diferente ficam fora, com o motivo", () => {
    assert.equal(comparacaoDaCompanhia(ficha([ano(2026, 1, 1)]), ref).motivo, "série curta (1 ano)");
    assert.equal(comparacaoDaCompanhia(ficha([ano(2025, 1, 1), ano(2026, 1, 1, { tipo: "transicao", meses: 9 })]), ref).motivo, "exercício de 9 meses");
    assert.equal(comparacaoDaCompanhia(ficha([ano(2024, 1, 1), ano(2026, 1, 1)]), ref).motivo, "o exercício anterior não é de 12 meses seguidos ao atual");
    assert.equal(comparacaoDaCompanhia(ficha([ano(2025, 1, 1, { origem: { consolidado: false } }), ano(2026, 1, 1)]), ref).motivo, "base diferente: o período atual é consolidado e o anterior é individual");
    assert.equal(comparacaoDaCompanhia(ficha([ano(2024, 1, 1), ano(2025, 1, 1)]), ref).motivo, "sem o exercício de 31/12/2026 na série");
  });
});

// ---------- variações do lucro ----------
describe("maiores variações do lucro no acumulado", () => {
  test("as maiores altas e as maiores quedas, em ordem, com a variação sobre o lucro anterior", () => {
    const v = variacoesDoLucro(comparadas([comLucro("AAAA3", 100_000, 150_000), comLucro("BBBB3", 100_000, 300_000), comLucro("CCCC3", 100_000, 40_000), comLucro("DDDD3", 100_000, 90_000), comLucro("EEEE3", 100_000, 100_000)]));
    assert.deepEqual(v.altas.map((x) => [x.ticker, Number(x.variacao.toFixed(4))]), [["BBBB3", 2], ["AAAA3", 0.5]]);
    assert.deepEqual(v.quedas.map((x) => [x.ticker, Number(x.variacao.toFixed(4))]), [["CCCC3", -0.6], ["DDDD3", -0.1]]);
    // empate (variação zero) tem percentual, mas não é alta nem queda
    assert.equal(v.elegiveis, 5);
    assert.deepEqual(v.altas[0], { ticker: "BBBB3", nome: "BBBB3 Companhia S.A.", nomeCurto: "BBBB3 Companhia", atual: 300_000, anterior: 100_000, variacao: 2 });
  });

  test("lucro anterior negativo: sem percentual; quem passou de prejuízo a lucro vai numa linha à parte", () => {
    const v = variacoesDoLucro(comparadas([comLucro("AAAA3", -200_000, 300_000), comLucro("BBBB3", 100_000, 120_000)]));
    assert.deepEqual(tickers(v.altas), ["BBBB3"]);
    assert.deepEqual(tickers(v.viraramLucro), ["AAAA3"]);
    assert.ok(!("variacao" in v.viraramLucro[0]));
  });

  test("de lucro a prejuízo e prejuízo nos dois períodos: também à parte, sem percentual", () => {
    const v = variacoesDoLucro(comparadas([comLucro("AAAA3", 300_000, -200_000), comLucro("BBBB3", -100_000, -50_000), comLucro("CCCC3", -100_000, -400_000)]));
    assert.deepEqual([v.altas, v.quedas, v.elegiveis], [[], [], 0]);
    assert.deepEqual(tickers(v.viraramPrejuizo), ["AAAA3"]);
    assert.deepEqual(tickers(v.prejuizoNosDois), ["BBBB3", "CCCC3"]);
  });

  test("lucro igual a zero não é lucro: fica do lado do prejuízo, como na régua", () => {
    const v = variacoesDoLucro(comparadas([comLucro("AAAA3", 0, 300_000), comLucro("BBBB3", 300_000, 0)]));
    assert.deepEqual([tickers(v.viraramLucro), tickers(v.viraramPrejuizo), v.elegiveis], [["AAAA3"], ["BBBB3"], 0]);
  });

  test("lucro anterior abaixo do limite de R$ 50 mi fica fora do percentual; no limite, entra", () => {
    assert.equal(LIMITE_DA_BASE, 50_000);
    const v = variacoesDoLucro(comparadas([comLucro("AAAA3", 5_000, 40_000), comLucro("BBBB3", 49_999, 60_000), comLucro("CCCC3", 50_000, 60_000)]));
    assert.deepEqual(tickers(v.altas), ["CCCC3"]);
    assert.deepEqual(tickers(v.baseBaixa), ["AAAA3", "BBBB3"]);
    assert.equal(v.limite, 50_000);
    // o limite é parâmetro: com outro, a lista muda
    assert.deepEqual(tickers(variacoesDoLucro(comparadas([comLucro("AAAA3", 5_000, 40_000)]), { limite: 1_000 }).altas), ["AAAA3"]);
  });

  test("menos de 5 companhias elegíveis: as listas saem com o que há, sem completar", () => {
    assert.equal(TAMANHO_DA_LISTA, 5);
    const v = variacoesDoLucro(comparadas([comLucro("AAAA3", 100_000, 150_000), comLucro("BBBB3", 100_000, 50_000), comLucro("CCCC3", 100_000, 130_000)]));
    assert.deepEqual([tickers(v.altas), tickers(v.quedas)], [["AAAA3", "CCCC3"], ["BBBB3"]]);
    assert.deepEqual(variacoesDoLucro([]), { limite: 50_000, tamanho: 5, elegiveis: 0, altas: [], quedas: [], viraramLucro: [], viraramPrejuizo: [], prejuizoNosDois: [], baseBaixa: [] });
  });

  test("mais de 5: só as 5 maiores de cada lado; no empate, a ordem do ticker", () => {
    const fichas = ["GGGG3", "AAAA3", "BBBB3", "CCCC3", "DDDD3", "EEEE3", "FFFF3"].map((t, i) => comLucro(t, 100_000, t === "GGGG3" || t === "AAAA3" ? 200_000 : 110_000 + i * 1000));
    const v = variacoesDoLucro(comparadas(fichas));
    assert.deepEqual(tickers(v.altas), ["AAAA3", "GGGG3", "FFFF3", "EEEE3", "DDDD3"]);
    assert.equal(v.elegiveis, 7);
  });

  test("nome curto: sem o S.A. e o que vem depois", () => {
    assert.deepEqual(["WEG S.A.", "VIBRA ENERGIA S/A", "ENEVA S.A", "CYRELA BRAZIL REALTY S.A.EMPREEND E PART", "USINAS SID DE MINAS GERAIS S.A.-USIMINAS", "B3 S.A. - BRASIL, BOLSA, BALCÃO", "ISA ENERGIA BRASIL", "CIA SANEAMENTO BASICO EST SAO PAULO", ""].map(nomeCurto),
      ["WEG", "VIBRA ENERGIA", "ENEVA", "CYRELA BRAZIL REALTY", "USINAS SID DE MINAS GERAIS", "B3", "ISA ENERGIA BRASIL", "CIA SANEAMENTO BASICO EST SAO PAULO", ""]);
  });
});

// ---------- setores ----------
describe("lucro somado por setor", () => {
  test("soma o lucro do acumulado das companhias com a comparação, com a variação contra o ano anterior", () => {
    const s = lucroPorSetor(comparadas([comLucro("AAAA3", 100, 150), comLucro("BBBB3", 200, 150), comLucro("CCCC3", 100, 300), comLucro("DDDD3", 1, 2, { setor: "Saúde" })]));
    assert.deepEqual(s[0], { setor: "Indústria", empresas: 3, tickers: ["AAAA3", "BBBB3", "CCCC3"], poucas: false, atual: 600, anterior: 400, variacao: 0.5, viraramLucro: [], viraramPrejuizo: [] });
    assert.deepEqual(s.map((x) => x.setor), ["Indústria", "Saúde"]);
  });

  test("setor com menos de 3 empresas na comparação: 'poucas empresas', sem soma e sem variação", () => {
    assert.equal(MINIMO_POR_SETOR, 3);
    const [s] = lucroPorSetor(comparadas([comLucro("AAAA3", 100, 150), comLucro("BBBB3", 200, 150)]));
    assert.deepEqual(s, { setor: "Indústria", empresas: 2, tickers: ["AAAA3", "BBBB3"], poucas: true, atual: null, anterior: null, variacao: null, viraramLucro: [], viraramPrejuizo: [] });
  });

  test("o percentual só existe quando nenhuma companhia do setor mudou de sinal e a soma é positiva nos dois períodos", () => {
    const setor = (...lucros) => lucroPorSetor(comparadas(lucros.map(([anterior, atual], i) => comLucro(`${"ABCD"[i].repeat(4)}3`, anterior, atual))))[0];
    // nenhuma mudou de sinal, somas positivas: tem percentual (uma com prejuízo nos dois períodos não impede)
    const semMudanca = setor([100, 150], [200, 150], [-50, -20]);
    assert.deepEqual([semMudanca.atual, semMudanca.anterior, semMudanca.variacao.toFixed(4), semMudanca.viraramLucro, semMudanca.viraramPrejuizo], [280, 250, "0.1200", [], []]);
    // uma passou de prejuízo a lucro: sem percentual, mesmo com as duas somas positivas
    const a = setor([100, 150], [200, 150], [-50, 20]);
    assert.deepEqual([a.atual, a.anterior, a.variacao, a.viraramLucro, a.viraramPrejuizo], [320, 250, null, ["CCCC3"], []]);
    // uma passou de lucro a prejuízo
    const b = setor([100, 150], [200, 150], [50, -20]);
    assert.deepEqual([b.variacao, b.viraramLucro, b.viraramPrejuizo], [null, [], ["CCCC3"]]);
    // as duas direções no mesmo setor
    const c = setor([-100, 150], [200, -150], [50, 20], [-5, 5]);
    assert.deepEqual([c.variacao, c.viraramLucro, c.viraramPrejuizo], [null, ["AAAA3", "DDDD3"], ["BBBB3"]]);
  });

  test("soma anterior negativa ou zero, ou soma atual não positiva: sem percentual, mesmo sem ninguém mudar de sinal", () => {
    const setor = (...lucros) => lucroPorSetor(comparadas(lucros.map(([anterior, atual], i) => comLucro(`${"ABCD"[i].repeat(4)}3`, anterior, atual))))[0];
    // prejuízo nos dois períodos em todas: antes saía "prejuízo menor (−55%)"; agora só as duas somas
    const negativo = setor([-100, -50], [-200, -100], [100, 60]);
    assert.deepEqual([negativo.atual, negativo.anterior, negativo.variacao, negativo.viraramLucro, negativo.viraramPrejuizo], [-90, -200, null, [], []]);
    assert.equal(notaDoSetor(negativo), "A soma do ano anterior não é positiva.");
    const zero = setor([-100, -50], [50, 60], [50, 60]);
    assert.deepEqual([zero.anterior, zero.variacao], [0, null]);
    const caiu = setor([-100, -300], [50, 40], [60, 50]);
    assert.deepEqual([caiu.anterior, caiu.atual, caiu.variacao], [10, -210, null]);
    assert.equal(notaDoSetor(caiu), "A soma do acumulado não é positiva.");
    assert.equal(notaDoSetor(caiu, "exercício"), "A soma do exercício não é positiva.");
  });

  test("lucro igual a zero fica do lado do prejuízo: de zero a lucro é mudança de sinal", () => {
    const [s] = lucroPorSetor(comparadas([comLucro("AAAA3", 0, 150), comLucro("BBBB3", 200, 0), comLucro("CCCC3", 100, 100)]));
    assert.deepEqual([s.variacao, s.viraramLucro, s.viraramPrejuizo], [null, ["AAAA3"], ["BBBB3"]]);
  });

  test("a nota diz quem mudou de sinal, no singular e no plural", () => {
    const s = (viraramLucro, viraramPrejuizo) => ({ viraramLucro, viraramPrejuizo, anterior: 1, atual: 1 });
    assert.equal(notaDoSetor(s(["AXIA3"], [])), "AXIA3 passou de prejuízo a lucro.");
    assert.equal(notaDoSetor(s(["AAAA3", "BBBB3"], [])), "AAAA3 e BBBB3 passaram de prejuízo a lucro.");
    assert.equal(notaDoSetor(s(["AAAA3", "BBBB3", "CCCC3"], ["DDDD3"])), "AAAA3, BBBB3 e CCCC3 passaram de prejuízo a lucro; DDDD3 passou de lucro a prejuízo.");
    assert.equal(notaDoSetor(s([], ["AAAA3", "BBBB3"])), "AAAA3 e BBBB3 passaram de lucro a prejuízo.");
  });

  // O caso real que motivou a regra: os três de Energia e saneamento que tinham entregue o ITR de
  // 30/09/2026 na coleta de 13/11/2026. Valores em R$ mil, como nas fichas (receita, lucro).
  test("Energia e saneamento (AXIA3 saiu de prejuízo de R$ 7,1 bi): sem o +2.776%, só as duas somas e a nota", () => {
    const energia = { setor: "Energia e saneamento" };
    const fichas = [
      cia("AXIA3", { ...energia, atual: [33_936_708, 4_934_255], anterior: [30_615_636, -7_126_839] }),
      cia("ISAE4", { ...energia, atual: [7_441_969, 2_244_205], anterior: [6_403_885, 1_759_777] }),
      cia("SBSP3", { ...energia, atual: [30_314_585, 4_601_199], anterior: [26_815_621, 5_776_619] }),
    ];
    const painel = montarPainel(fichas, { total: 64 });
    const [s] = painel.setores;
    assert.deepEqual(s, {
      setor: "Energia e saneamento", empresas: 3, tickers: ["AXIA3", "ISAE4", "SBSP3"], poucas: false,
      atual: 11_779_659, anterior: 409_557, variacao: null, viraramLucro: ["AXIA3"], viraramPrejuizo: [],
    });
    // a conta que a página deixou de mostrar
    assert.equal(((s.atual / s.anterior - 1) * 100).toFixed(1), "2776.2");
    const html = painelHtml(painel);
    assert.match(html, /<li class="sem-percentual" title="Soma do lucro do acumulado de AXIA3, ISAE4, SBSP3: R\$ 11,8 bi, contra R\$ 410 mi no ano anterior"><span class="setor-nome">Energia e saneamento <small>3 empresas<\/small><\/span><span class="setor-valor n">de R\$ 410 mi para R\$ 11,8 bi<\/span><small class="setor-nota">AXIA3 passou de prejuízo a lucro\.<\/small><\/li>/);
    const bloco = html.slice(html.indexOf('id="t-setores"'), html.indexOf('id="t-atencao"'));
    assert.ok(!bloco.includes("%") && !bloco.includes("setor-barra") && !bloco.includes("2.776"));
    // na lista das companhias a AXIA3 continua na linha à parte, sem percentual
    assert.match(html, /<li>Passaram de prejuízo a lucro: <a href="axia3\/">AXIA3<\/a>\.<\/li>/);
  });

  test("companhia sem setor entra em 'Outros'", () => {
    assert.equal(lucroPorSetor(comparadas([comLucro("AAAA3", 1, 2, { setor: null })]))[0].setor, "Outros");
  });
});

// ---------- pontos de atenção ----------
describe("pontos de atenção em todas as fichas", () => {
  const fichas = [
    cia("CCCC3", { regras: ["diluicao", "margemEmQueda"], ref: "2026-06-30" }),
    cia("AAAA3", { regras: ["diluicao", "lucroQueNaoViraCaixa?"] }),
    cia("BBBB3", { regras: ["diluicao", "margemEmQueda"] }),
  ];

  test("quantas companhias acionam cada regra, em ordem decrescente, com os tickers em ordem", () => {
    const a = atencaoNasFichas(fichas);
    assert.deepEqual(a.map((r) => [r.id, r.acionadas, r.tickers, r.naoAvaliadas]), [
      ["diluicao", 3, ["AAAA3", "BBBB3", "CCCC3"], 0],
      ["margemEmQueda", 2, ["BBBB3", "CCCC3"], 0],
      ["lucroQueNaoViraCaixa", 0, [], 1],
    ]);
    assert.equal(a[0].limite, "limite de diluicao");
  });

  test("conta todas as fichas, inclusive quem ainda não entregou o documento do período", () => {
    const p = montarPainel(fichas);
    assert.deepEqual([p.entregaram, p.fichas, p.atencao[0].acionadas], [2, 3, 3]);
  });

  test("no empate, vale a ordem das regras na ficha; ficha sem regras não quebra", () => {
    const a = atencaoNasFichas([cia("AAAA3", { regras: ["margemEmQueda", "lucroQueNaoViraCaixa"] }), { ticker: "ZZZZ3" }]);
    assert.deepEqual(a.map((r) => r.id), ["lucroQueNaoViraCaixa", "margemEmQueda", "diluicao"]);
  });
});

// ---------- carimbo ----------
describe("carimbo: documentos entregues até", () => {
  test("a data de entrega mais recente entre os documentos das fichas", () => {
    assert.equal(entregueAte([cia("AAAA3", { recebidoEm: "2026-10-21" }), cia("BBBB3", { recebidoEm: "2026-11-05T18:00:00" }), cia("CCCC3", { recebidoEm: null })]), "2026-11-05");
    assert.equal(entregueAte([cia("AAAA3", { recebidoEm: null })]), null);
  });
});

// ---------- o acumulado na ficha ----------
describe("ficha: o acumulado do ano e o do ano anterior", () => {
  const ficha = fichaDaWeg();

  test("a ficha da WEG traz a receita e o lucro das duas parcelas, com o período e a base de cada uma", () => {
    const { atual, anterior } = ficha.doze.acumulado;
    assert.deepEqual([atual.inicio, atual.fim, atual.dtRefer, atual.consolidado], ["2026-01-01", "2026-09-30", "2026-09-30", true]);
    assert.deepEqual([anterior.inicio, anterior.fim, anterior.dtRefer, anterior.consolidado], ["2025-01-01", "2025-09-30", "2025-09-30", true]);
    for (const p of [atual, anterior]) assert.ok(p.receita > 0 && p.lucroLiquido > 0 && p.lucroLiquido < p.receita);
  });

  test("as parcelas fecham com os 12 meses: anual + acumulado atual − acumulado anterior", () => {
    const { atual, anterior } = ficha.doze.acumulado;
    const anual = ficha.anual.at(-1).indicadores;
    assert.equal(anual.lucroLiquido.valor + atual.lucroLiquido - anterior.lucroLiquido, ficha.doze.indicadores.lucroLiquido.valor);
    assert.equal(anual.receita.valor + atual.receita - anterior.receita, ficha.doze.indicadores.receita.valor);
  });

  test("sem ITR depois da DFP, ou com os 12 meses indisponíveis, não há acumulado", () => {
    assert.equal(acumuladoDoAno({ tipo: "ano-fechado", parcelas: { anual: {}, acumuladoAtual: null, acumuladoAnterior: null }, fluxos: {} }), null);
    assert.equal(acumuladoDoAno({ tipo: "indisponivel", parcelas: null, fluxos: null }), null);
    assert.equal(acumuladoDoAno(null), null);
  });

  test("a ficha da WEG entra no painel: entregou o 3T26 e tem a comparação", () => {
    const p = montarPainel([ficha], { total: 64 });
    assert.deepEqual([p.referencia.nome, p.entregaram, p.total, p.comparadas, p.semComparacao], ["3T26", 1, 64, 1, []]);
    assert.equal(p.entregueAte, "2026-10-21"); // a entrega do ITR de 30/09/2026
    assert.equal(p.atencao.length, 7);
  });
});

// ---------- HTML ----------
describe("HTML do painel", () => {
  const fichas = [
    comLucro("AAAA3", 100_000, 150_000, { regras: ["diluicao"] }),
    comLucro("BBBB3", 100_000, 60_000),
    comLucro("CCCC3", -80_000, 90_000),
    comLucro("DDDD3", 10_000, 30_000, { setor: "Saúde" }),
    cia("EEEE3", { ref: "2026-06-30", regras: ["diluicao"] }),
    cia("FFFF3", { base: [true, false] }),
  ];
  fichas[0].nome = `M&A <script>x</script> S.A.`;
  const painel = montarPainel(fichas, { total: 8 });
  const html = painelHtml(painel);
  const visivel = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  test("a temporada abre o painel: o nome, o progresso e o carimbo de data", () => {
    assert.match(html, /^<div class="painel">\n<section class="temporada" aria-labelledby="t-temporada">\n<div class="temporada-topo"><h2 id="t-temporada">Temporada do 3T26<\/h2><p class="painel-carimbo">dados de documentos entregues até 30\/10\/2026<\/p><\/div>/);
    assert.match(html, /<p><strong class="n">5 de 8<\/strong> já entregaram o ITR de 30\/09\/2026<\/p>\n<div class="progresso-trilho" aria-hidden="true"><span style="width:62\.5%"><\/span><\/div>/);
  });

  test("os quatro números, cada um com o denominador à vista, e a nota fixa", () => {
    assert.match(html, /<li><strong class="n">3 <small>de 4<\/small><\/strong><span>lucro do acumulado maior que o do ano anterior<\/span><\/li>/);
    assert.match(html, /<li><strong class="n">0 <small>de 4<\/small><\/strong><span>receita maior<\/span><\/li>/);
    assert.match(html, /<span>margem líquida maior<\/span>/);
    assert.match(html, /<li><strong class="n">0 <small>de 4<\/small><\/strong><span>prejuízo no acumulado<\/span><\/li>/);
    assert.equal(NOTA_DO_ACUMULADO, "Acumulado do ano até a data do documento, contra o mesmo período do ano anterior, como entregue à CVM; sem ajuste de não recorrentes.");
    assert.ok(html.includes(NOTA_DO_ACUMULADO));
    assert.match(visivel, /Das 5 que entregaram, 4 têm a comparação com o ano anterior:/);
    assert.match(visivel, /1 companhia que entregou ficou fora da comparação: FFFF3 \(base diferente: o período atual é consolidado e o anterior é individual\)\./);
  });

  test("variações: ticker, nome curto, variação com o sinal e link para a ficha", () => {
    assert.match(html, /<h4>Maiores altas<\/h4><ol><li title="Lucro do acumulado: R\$ 150 mi, contra R\$ 100 mi no ano anterior"><a href="aaaa3\/"><strong>AAAA3<\/strong><span>M&amp;A &lt;script&gt;x&lt;\/script&gt;<\/span><b class="variacao alta">\+50,0%<\/b><\/a><\/li><\/ol>/);
    assert.match(html, /<h4>Maiores quedas<\/h4><ol><li title="[^"]+"><a href="bbbb3\/"><strong>BBBB3<\/strong><span>BBBB3 Companhia<\/span><b class="variacao baixa">−40,0%<\/b><\/a><\/li><\/ol>/);
    assert.ok(!html.includes("<script>"));
  });

  test("a cor de alta e de baixa nunca vem sozinha: sempre com o sinal e o número", () => {
    const coloridos = [...html.matchAll(/<b class="variacao (alta|baixa)">([^<]*)<\/b>/g)];
    assert.ok(coloridos.length >= 2);
    for (const [, classe, texto] of coloridos) assert.match(texto, classe === "alta" ? /^\+\d[\d.,]*%$/ : /^−\d[\d.,]*%$/);
    assert.deepEqual([comSinal(0.123), comSinal(-0.123), comSinal(0)], ["+12,3%", "−12,3%", "0,0%"]);
  });

  test("quem mudou de sinal e quem tem a base abaixo do limite vão em linhas à parte, e a página informa o limite", () => {
    assert.match(html, /<li>Passaram de prejuízo a lucro: <a href="cccc3\/">CCCC3<\/a>\.<\/li>/);
    assert.match(html, /<li>Lucro anterior abaixo de R\$ 50 mi, fora do percentual: <a href="dddd3\/">DDDD3<\/a>\.<\/li>/);
    assert.match(visivel, /Variação percentual só de quem teve lucro nos dois períodos e lucro anterior de R\$ 50 mi ou mais: 2 companhias de 4\./);
    assert.ok(!html.includes("Passaram de lucro a prejuízo"));
  });

  test("setores: a soma, a variação, a barra a partir do zero e o número de empresas; com poucas empresas, sem barra", () => {
    // CCCC3 passou de prejuízo a lucro: o setor fica sem percentual e sem barra, só com as duas somas e a nota
    assert.match(html, /<li class="sem-percentual" title="Soma do lucro do acumulado de AAAA3, BBBB3, CCCC3: R\$ 300 mi, contra R\$ 120 mi no ano anterior"><span class="setor-nome">Indústria <small>3 empresas<\/small><\/span><span class="setor-valor n">de R\$ 120 mi para R\$ 300 mi<\/span><small class="setor-nota">CCCC3 passou de prejuízo a lucro\.<\/small><\/li>/);
    assert.ok(!html.includes("setor-barra"));
    assert.match(html, /<li class="poucas" title="Na comparação: DDDD3"><span class="setor-nome">Saúde <small>1 empresa<\/small><\/span><span class="setor-valor vazio">poucas empresas<\/span><\/li>/);
  });

  test("setor com percentual: a soma, a variação com o sinal e a barra a partir do zero, na escala da maior soma", () => {
    const maior = ["AAAA3", "BBBB3", "CCCC3"].map((t) => comLucro(t, 100_000, 200_000));
    const menor = ["DDDD3", "EEEE3", "FFFF3"].map((t) => comLucro(t, 100_000, 50_000, { setor: "Saúde" }));
    const negativo = ["GGGG3", "HHHH3", "IIII3"].map((t) => comLucro(t, -100_000, -50_000, { setor: "Shoppings" }));
    const h = painelHtml(montarPainel([...maior, ...menor, ...negativo]));
    assert.match(h, /<span class="setor-valor n">R\$ 600 mi <b class="variacao alta">\+100,0%<\/b><\/span><span class="setor-barra" aria-hidden="true"><i style="width:100\.0%"><\/i><\/span><\/li>/);
    assert.match(h, /<span class="setor-valor n">R\$ 150 mi <b class="variacao baixa">−50,0%<\/b><\/span><span class="setor-barra" aria-hidden="true"><i style="width:25\.0%"><\/i><\/span><\/li>/);
    // prejuízo nos dois períodos: sem percentual e sem barra, e a soma negativa não entra na escala
    assert.match(h, /<li class="sem-percentual" title="[^"]+"><span class="setor-nome">Shoppings <small>3 empresas<\/small><\/span><span class="setor-valor n">de −R\$ 300 mi para −R\$ 150 mi<\/span><small class="setor-nota">A soma do ano anterior não é positiva\.<\/small><\/li>/);
    assert.equal((h.match(/class="setor-barra"/g) ?? []).length, 2);
  });

  test("pontos de atenção: o número de cada regra leva à lista dos tickers, num details; regra sem acionadas fica sem details", () => {
    assert.match(html, /<h3 id="t-atencao">Pontos de atenção nas 6<\/h3>/);
    assert.match(html, /<ol class="atencao-contagem"><li><details><summary><strong class="n">2<\/strong> <span>Diluição<\/span><\/summary><p><a href="aaaa3\/">AAAA3<\/a>, <a href="eeee3\/">EEEE3<\/a>\.<\/p><small>Limite: limite de diluicao\.<\/small><\/details><\/li>/);
    assert.match(html, /<li><p class="regra-sem"><strong class="n">0<\/strong> <span>Lucro que não vira caixa<\/span><\/p><\/li>/);
    assert.equal((html.match(/<details>/g) ?? []).length, 1);
  });

  test("os blocos vêm na ordem: temporada, variações, setores e pontos de atenção", () => {
    const ordem = ['id="t-temporada"', 'id="t-variacoes"', 'id="t-setores"', 'id="t-atencao"'].map((x) => html.indexOf(x));
    assert.ok(ordem.every((p, i) => p > 0 && (i === 0 || p > ordem[i - 1])), String(ordem));
    assert.match(html, /<h3 id="t-variacoes">Maiores variações do lucro no acumulado<\/h3>/);
    assert.match(html, /<h3 id="t-setores">Lucro somado por setor<\/h3>/);
  });

  test("companhia sem página fica sem link", () => {
    const h = painelHtml(painel, { comPagina: new Set(["BBBB3"]) });
    assert.match(h, /<span class="sem-link"><strong>AAAA3<\/strong>/);
    assert.match(h, /<a href="bbbb3\/"><strong>BBBB3<\/strong>/);
    assert.match(h, /Passaram de prejuízo a lucro: CCCC3\./);
  });

  test("os links são relativos à lista: só '<ticker>/'", () => {
    const links = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(links.length >= 5);
    for (const l of links) assert.match(l, /^[a-z0-9]+\/$/);
  });

  test("sem variação elegível e sem comparação: as listas dizem que não há, e nada quebra", () => {
    const h = painelHtml(montarPainel([cia("AAAA3", { base: [true, false] })]));
    assert.match(h, /<p class="painel-vazio">Nenhuma companhia com alta no percentual\.<\/p>/);
    assert.match(h, /<p class="painel-vazio">Nenhuma companhia com queda no percentual\.<\/p>/);
    assert.match(h, /<p class="painel-vazio">Nenhuma companhia com a comparação ainda\.<\/p>/);
    assert.match(h, /<strong class="n">0 <small>de 0<\/small><\/strong>/);
  });

  test("temporada do exercício: os textos falam do exercício, não do acumulado", () => {
    const ano = (a, lucro) => ({ inicio: `${a}-01-01`, fim: `${a}-12-31`, tipo: "anual", meses: 12, origem: { consolidado: true, recebidoEm: "2027-03-10" }, indicadores: { receita: { valor: 1000 }, lucroLiquido: { valor: lucro } } });
    const f = { ticker: "AAAA3", nome: "A S.A.", setor: "Saúde", documentoMaisRecente: { tipo: "dfp", dtRefer: "2026-12-31" }, anual: [ano(2025, 100_000), ano(2026, 120_000)], doze: { tipo: "ano-fechado", origem: [], acumulado: null } };
    const h = painelHtml(montarPainel([f]));
    assert.match(h, /<h2 id="t-temporada">Temporada do Exercício de 2026<\/h2>/);
    assert.match(h, /já entregaram a DFP de 31\/12\/2026/);
    assert.match(h, /lucro do exercício maior que o do ano anterior/);
    assert.match(h, /Maiores variações do lucro no exercício/);
    assert.ok(!h.includes("acumulado") && !h.includes("Acumulado"));
    assert.match(h, /dados de documentos entregues até 10\/03\/2027/);
  });

  test("nenhuma palavra de recomendação ou de julgamento, no texto à vista e nos títulos", () => {
    const PROIBIDO = /\bcompre\b|\bcomprar\b|\bvenda\b|\bvender\b|barat|\bcar[oa]s?\b|atrativ|preço-alvo|\bnota\b \d|recomendamos|oportunidade|\bbo[am]\b|\bbons\b|\bruim\b|\bruins\b|saudável|excelente|péssim|\bótim|melhor|pior|destaque|vencedor|perdedor/i;
    const titulos = [...html.matchAll(/title="([^"]*)"/g)].map((m) => m[1]).join(" ");
    assert.doesNotMatch(visivel, PROIBIDO);
    assert.doesNotMatch(titulos, PROIBIDO);
    // a única menção a "recomendação" é a negativa, na legenda das regras
    assert.deepEqual(visivel.match(/recomenda\S*/gi), ["recomendação."]);
    assert.match(visivel, /Descrevem fatos, não são recomendação\./);
    assert.match(visivel, /Maiores altas/);
    assert.match(visivel, /Maiores quedas/);
  });

  test("sem painel, o HTML sai vazio", () => {
    assert.equal(painelHtml(null), "");
  });
});

describe("o painel na página da lista", () => {
  const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");

  test("inserirPainel troca o marcador, e exige exatamente um", () => {
    assert.equal(inserirPainel(`<main>${MARCADOR_DO_PAINEL}<h2>x</h2></main>`, "<div>p</div>"), "<main><div>p</div><h2>x</h2></main>");
    assert.equal(inserirPainel(`<main>${MARCADOR_DO_PAINEL}</main>`, ""), "<main></main>");
    assert.throws(() => inserirPainel("<main></main>", "x"), /exatamente um/);
  });

  test("em /fundamentos/ o painel vem antes do título 'Empresas', da busca e da lista", () => {
    const html = ler("site/fundamentos/index.html");
    assert.equal(html.split(MARCADOR_DO_PAINEL).length, 2);
    assert.ok(html.indexOf(MARCADOR_DO_PAINEL) < html.indexOf('<h2 id="empresas">Empresas</h2>'));
    assert.ok(html.indexOf('<h2 id="empresas">Empresas</h2>') < html.indexOf("<!-- companhias -->"));
  });

  test("o CSS do painel só usa os tokens: nenhuma cor fixa, e a cor de alta e de baixa só na variação", () => {
    const css = ler("site/fundamentos/fundamentos.css");
    const painel = css.slice(css.indexOf("painel da temporada (#66)"), css.indexOf("/* ---------- lista ---------- */"));
    assert.ok(painel.length > 500);
    assert.deepEqual(painel.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/g) ?? [], []);
    const comCor = painel.split("\n").filter((l) => /var\(--(alta|baixa)\)/.test(l)).map((l) => l.trim().split(" {")[0]);
    assert.deepEqual(comCor, ["b.variacao.alta", "b.variacao.baixa"]);
  });
});
