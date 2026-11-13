// Fluxo de caixa, capex, FCL, proventos e valores por ação (#36):
// classificador da DFC, composição do capital e os indicadores que saem dos dois.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { interpretarArquivo, lerArquivos } from "../scripts/cvm/leitor.mjs";
import { montarSeries } from "../scripts/cvm/series.mjs";
import {
  CATEGORIAS, ORDEM, classificarLinha, classificarLinhas, excecoesDaCompanhia, normalizar, validarExcecoes,
} from "../scripts/cvm/classificador-dfc.mjs";
import { LIMITE_ACOES_EM_MIL, composicaoNaData, emUnidades, escalaDasAcoes, lerComposicaoCapital } from "../scripts/cvm/composicao-capital.mjs";
import {
  INDICADORES, LIMITE_DILUICAO, calcularIndicadores, calcularIndicadoresDaSerie, depreciacaoEAmortizacao, fluxosClassificados, lucroDaControladora,
} from "../scripts/cvm/indicadores.mjs";

// ---------- fixtures reais ----------
const DIR = new URL("./fixtures/cvm/", import.meta.url);
const texto = (pasta, nome) => new TextDecoder("latin1").decode(readFileSync(new URL(`${pasta}/${nome}`, DIR)));
function companhia(pasta) {
  const nomes = readdirSync(new URL(`${pasta}/`, DIR));
  const series = montarSeries(lerArquivos(nomes.filter((n) => interpretarArquivo(n)).map((nome) => ({ nome, linhas: texto(pasta, nome).split("\n") }))));
  const composicoes = nomes.filter((n) => n.includes("composicao_capital")).flatMap((n) => lerComposicaoCapital(texto(pasta, n)));
  return { series, composicoes, indicadores: calcularIndicadoresDaSerie(series, { composicoes }) };
}
const WEG = companhia("weg");
const RAIA = companhia("raia-drogasil");
const SAO_MARTINHO = companhia("sao-martinho");
const HAPVIDA = companhia("hapvida");

const ano = (cia, fim) => cia.indicadores.anual.find((p) => p.fim === fim);
const periodo = (cia, fim) => cia.series.anual.find((p) => p.fim === fim);
const dfcDe = (cia, fim) => periodo(cia, fim).demonstrativos.DFC.contas;

// ---------- linhas e períodos sintéticos ----------
// Linha não fixa da DFC.
const L = (conta, descricao, valor = -10) => ({ conta, descricao, valor, contaFixa: false });
const categoriaDe = (conta, descricao) => classificarLinha(L(conta, descricao))?.categoria ?? null;

const fixa = (conta, valor) => ({ conta, descricao: "", contaFixa: true, valor });
// Um exercício: receita 1.000, EBIT 200, D&A 50 (EBITDA 250), lucro 100 (90 da controladora), PL 800,
// dívida 500, caixa 150. DFC: FCO 300, capex 120 + 10, compra de controlada 40, juros pagos 20,
// juros de arrendamento 8 (no FCO), principal de arrendamento 25, proventos 60 e 5 a não controladores.
const DFC = [
  fixa("6.01", 300), fixa("6.02", -170), fixa("6.03", -90),
  L("6.01.01.02", "Depreciação e amortização", 50),
  L("6.01.02.10", "Juros pagos sobre empréstimos e financiamentos", -20),
  L("6.01.02.11", "Juros pagos - arrendamentos", -8),
  L("6.02.01", "Aquisição de imobilizado", -120),
  L("6.02.02", "Aquisição de intangível", -10),
  L("6.02.03", "Aquisição de controlada, líquida do caixa adquirido", -40),
  L("6.03.01", "Dividendos pagos", -60),
  L("6.03.02", "Pagamento de arrendamentos", -25),
  L("6.03.03", "Dividendos pagos a acionistas não controladores", -5),
];
const bloco = (contas) => ({ contas: Object.entries(contas).map(([conta, valor]) => fixa(conta, valor)) });
// `dfc` troca as linhas da DFC; `mudancas` troca contas fixas de um demonstrativo.
function anual({ dfc = DFC, mudancas = {}, tipo = "anual", meses = 12 } = {}) {
  const base = {
    DRE: { "3.01": 1000, "3.03": 400, "3.05": 200, "3.06": -30, "3.06.01": 20, "3.06.02": -50, "3.11": 100, "3.11.01": 90 },
    DVA: { "7.04.01": -50 },
    BPA: { "1": 2000, "1.01": 600, "1.01.01": 100, "1.01.02": 50 },
    BPP: { "2.01": 400, "2.01.04": 300, "2.01.04.03": 0, "2.02.01": 200, "2.02.01.03": 0, "2.03": 800 },
  };
  const demonstrativos = Object.fromEntries(Object.entries(base).map(([demo, contas]) => [demo, bloco({ ...contas, ...mudancas[demo] })]));
  demonstrativos.DFC = { contas: dfc };
  return { inicio: "2025-01-01", fim: "2025-12-31", tipo, dias: 365, meses, demonstrativos };
}
const trocar = (linhas, conta, mudanca) => linhas.flatMap((l) => (l.conta !== conta ? [l] : mudanca == null ? [] : [{ ...l, ...mudanca }]));
const ACOES = { cnpj: "00.000.000/0001-00", dtRefer: "2025-12-31", versao: 1, acoesTotal: 1100, acoesTesouraria: 100, acoesCirculacao: 1000 };

// A base de 12 meses pelo ITR, com as três parcelas da DFC, na forma de base12Meses.
// Os fluxos fixos já vêm somados; as linhas não fixas vêm por parcela.
function doze12({ anualDfc = DFC, atualDfc, anteriorDfc } = {}) {
  const naoFixas = (linhas) => linhas.filter((l) => !l.contaFixa);
  // acumulado atual: metade do ano; acumulado anterior: um quarto
  const escala = (linhas, f) => naoFixas(linhas).map((l) => ({ ...l, valor: l.valor * f }));
  const fluxos = Object.fromEntries(Object.entries({
    "3.01": 1000, "3.03": 400, "3.05": 200, "3.06": -30, "3.06.01": 20, "3.06.02": -50, "3.11": 100, "3.11.01": 90,
    "7.04.01": -50, "6.01": 300, "6.02": -170, "6.03": -90,
  }).map(([conta, valor]) => [conta, { demonstrativo: "", descricao: "", valor }]));
  const contas = Object.fromEntries(Object.entries({
    "1": 2000, "1.01": 600, "1.01.01": 100, "1.01.02": 50,
  }).map(([c, valor]) => [c, { demonstrativo: "BPA", descricao: "", valor }]));
  for (const [c, valor] of Object.entries({ "2.01": 400, "2.01.04": 300, "2.01.04.03": 0, "2.02.01": 200, "2.02.01.03": 0, "2.03": 800 })) {
    contas[c] = { demonstrativo: "BPP", descricao: "", valor };
  }
  return {
    tipo: "itr", motivo: null, fim: "2026-06-30",
    parcelas: {
      anual: { inicio: "2025-01-01", fim: "2025-12-31", documento: "dfp", dtRefer: "2025-12-31" },
      acumuladoAtual: { inicio: "2026-01-01", fim: "2026-06-30", documento: "itr", dtRefer: "2026-06-30" },
      acumuladoAnterior: { inicio: "2025-01-01", fim: "2025-06-30", documento: "itr", dtRefer: "2025-06-30" },
    },
    fluxos, estoques: { data: "2026-06-30", origem: {}, contas, naoFixas: [] },
    linhasDfc: { anual: naoFixas(anualDfc), acumuladoAtual: atualDfc ?? escala(DFC, 0.5), acumuladoAnterior: anteriorDfc ?? escala(DFC, 0.25) },
  };
}

describe("normalizar", () => {
  test("tira os acentos, passa para minúsculas e junta os espaços", () => {
    assert.equal(normalizar("  Aquisição  de   IMOBILIZADO e Intangível "), "aquisicao de imobilizado e intangivel");
    assert.equal(normalizar("Juros s/ Capital Próprio"), "juros s/ capital proprio");
    assert.equal(normalizar("Depreciação, Amortização e Exaustão"), "depreciacao, amortizacao e exaustao");
  });
  test("descrição que já vem sem acento fica igual, a menos da caixa", () => {
    assert.equal(normalizar("Aquisicao de Ativo Intangivel"), "aquisicao de ativo intangivel");
  });
  test("vazio e ausente viram texto vazio", () => {
    assert.equal(normalizar(""), "");
    assert.equal(normalizar(undefined), "");
  });
});

describe("CATEGORIAS e ORDEM: a regra à vista", () => {
  test("as sete categorias, na ordem de prioridade", () => {
    assert.deepEqual(ORDEM, ["jurosArrendamento", "principalArrendamento", "proventosNaoControladores", "proventos", "jurosPagos", "capex", "daDfc"]);
    assert.deepEqual(Object.keys(CATEGORIAS).sort(), [...ORDEM].sort());
  });
  test("cada categoria diz onde procurar e com o que a descrição tem de bater", () => {
    for (const id of ORDEM) {
      const c = CATEGORIAS[id];
      assert.ok(c.nome && c.onde.length > 0 && c.bate.length > 0, id);
      if (c.mistura) assert.ok(c.motivoMistura, id);
    }
  });
  test("capex só no investimento; proventos e principal de arrendamento só no financiamento; D&A só nos ajustes", () => {
    assert.deepEqual(CATEGORIAS.capex.onde, ["6.02"]);
    assert.deepEqual(CATEGORIAS.proventos.onde, ["6.03"]);
    assert.deepEqual(CATEGORIAS.principalArrendamento.onde, ["6.03"]);
    assert.deepEqual(CATEGORIAS.daDfc.onde, ["6.01.01"]);
  });
  test("juros pagos: no FCO fora do bloco de ajustes (6.01.01) ou no financiamento", () => {
    assert.deepEqual(CATEGORIAS.jurosPagos.onde, ["6.01.02", "6.01.03", "6.03"]);
    assert.equal(categoriaDe("6.01.02.10", "Juros pagos sobre empréstimos e financiamentos"), "jurosPagos");
    assert.equal(categoriaDe("6.03.03", "Juros pagos sobre empréstimos e financiamentos"), "jurosPagos");
    assert.equal(categoriaDe("6.01.01.10", "Juros pagos sobre empréstimos e financiamentos"), null);
  });
});

// Critério de aceite da #36: um teste para cada variação de descrição levantada no spike (docs/cvm.md).
// As descrições são as do arquivo dfp_cia_aberta_DFC_*_con_2025.csv, com os acentos e os erros de digitação.
describe("variações do spike: capex", () => {
  const casos = [
    ["Petrobras", "6.02.01", "Aquisições de ativos imobilizados e intangíveis"],
    ["Vale", "6.02.05", "Adições ao Imobilizado"],
    ["WEG", "6.02.02", "Imobilizado"],
    ["WEG", "6.02.03", "Intangível"],
    ["Ambev", "6.02.02", "Aquisição de Imobilizado e Intangíveis"],
    ["Suzano", "6.02.01", "Adições no Imobilizado"],
    ["Suzano", "6.02.02", "Adições de intangível"],
    ["Localiza", "6.02.01", "Aquisições de outros imobilizados"],
    ["Localiza", "6.02.02", "Aquisições de ativos intangíveis"],
    ["Raia Drogasil", "6.02.03", "Aquisições de Imobilizado e Intangível"],
    ["Gerdau", "6.02.01", "Adições de imobilizado"],
    ["Gerdau", "6.02.03", "Adições de outros ativos intangíveis"],
    ["Embraer", "6.02.01", "Aquisições de imobilizado"],
    ["Embraer", "6.02.03", "Adições ao intangível"],
    ["Sabesp (ativo de contrato)", "6.02.01", "Aquisição de ativo de contrato, intangíveis e imobilizados"],
    ["Magazine Luiza (sem acento)", "6.02.01", "Aquisicao de Imobilizado"],
    ["Magazine Luiza (sem acento)", "6.02.02", "Aquisicao de Ativo Intangivel"],
    ["Vivo", "6.02.01", "Aquisições de Imobilizado e Intangível"],
    ["Klabin", "6.02.01", "Adição de bens do ativo imobilizado e intangível"],
    ["Klabin (ativo biológico)", "6.02.04", "Adição de plantio e compras de madeira em pé"],
    ["Dexco", "6.02.01", "Investimentos em ativo imobilizado"],
    ["Dexco (ativo biológico)", "6.02.03", "Investimentos em ativo biológico"],
    ["BRF e Marfrig (ativo biológico)", "6.02.07", "Aplicações em ativo biológico não corrente"],
    ["BRF e Marfrig", "6.02.02", "Aplicações em ativo imobilizado"],
    ["Marfrig", "6.02.03", "Aplicações no Ativo Intangível"],
    ["Suzano (ativo biológico)", "6.02.03", "Adições de ativos biológicos"],
    ["Cemig (ativo de contrato)", "6.02.03", "Em ativos de contrato - infraestrutura de distribuição e gás"],
    ["Cemig", "6.02.04", "No Imobilizado"],
    ["Cemig", "6.02.05", "No Intangível"],
    ["CPFL (ativo contratual)", "6.02.02", "Adições de ativo contratual"],
    ["B3 (software é intangível)", "6.02.03", "Aquisição e Desenvolvimento de Softwares"],
    ["Cury (digitação)", "6.02.01", "(Acréscimo) reduçãodo imobilizado"],
    ["Hypera (digitação)", "6.02.04", "Compra/desenvolvimento de Intangíves"],
    ["Tenda", "6.02.02", "Aquisição de ativo imobilizado e intangivel (Nota 9 e 10)"],
    // propriedade para investimento: aquisição, adição ou construção (shoppings e terrenos)
    ["Allos (propriedade para investimento)", "6.02.02", "Pagamentos para aquisição de propriedades para  investimentos (shopping centers)"],
    ["Multiplan (propriedade para investimento)", "6.02.06", "Adições em Propriedades para investimento"],
    ["MRV (propriedade para investimento)", "6.02.11", "Aquisição de Propriedades Para Investimento"],
    ["CSN (com propriedade para investimento)", "6.02.02", "Aquisição de ativos imobilizados, intangível e propriedade para investimento"],
  ];
  for (const [empresa, conta, descricao] of casos) {
    test(`${empresa}: "${descricao}"`, () => assert.equal(categoriaDe(conta, descricao), "capex"));
  }

  const mistas = [
    ["Rumo", "6.02.08", "Adições ao imobilizado, intangível e investimentos"],
    ["SmartFit", "6.02.01", "Adições do ativo imobilizado e arrendamento"],
  ];
  for (const [empresa, conta, descricao] of mistas) {
    test(`linha mista entra no capex, com a marca (${empresa}): "${descricao}"`, () => {
      const { capex } = classificarLinhas([L(conta, descricao, -100)]);
      assert.deepEqual(capex.linhas, [{ conta, descricao, valor: -100, mista: true }]);
      assert.equal(capex.soma, -100);
    });
  }
  test("linha que não é mista não leva a marca", () => {
    const { capex } = classificarLinhas([L("6.02.03", "Adições de outros ativos intangíveis", -7), L("6.02.01", "Aquisições de outros imobilizados", -3)]);
    assert.ok(capex.linhas.every((l) => !("mista" in l)));
  });
});

describe("fora do capex", () => {
  const fora = [
    // venda, alienação, baixa ou recebimento
    ["WEG", "6.02.04", "Recebimento na venda de Ativo Imobilizado e Intangível"],
    ["Raia Drogasil", "6.02.04", "Recebimentos por Vendas de Imobilizados"],
    ["B3", "6.02.01", "Alienação de Imobilizado"],
    ["Embraer", "6.02.02", "Baixa de imobilizado"],
    ["Ambev", "6.02.01", "Proventos da Venda de Imobilizado e Intangíveis"],
    ["Cosan", "6.02.09", "Recebimento de indenizações de seguradora por perda    de ativo imobilizado"],
    // aquisição de empresa e combinação de negócios (M&A)
    ["WEG", "6.02.09", "Aquisição de empresa - combinação de negócio (líquido do caixa)"],
    ["Raia Drogasil", "6.02.01", "Aquisição de Controlada"],
    ["Raia Drogasil", "6.02.02", "Caixa Adquirido em Combinação de Negócio"],
    ["Gerdau", "6.02.06", "Pagamento na aquisição de controle de empresa"],
    ["Cemig", "6.02.09", "Aquisição de participação societária e aporte em investidas"],
    // aplicações financeiras e investimentos
    ["WEG", "6.02.11", "Aplicações financeiras mantidas até o vencimento"],
    ["WEG", "6.02.01", "Investimentos"],
    ["Raia Drogasil", "6.02.08", "Aplicações Financeiras"],
    ["CSN Mineração", "6.02.03", "Aquisição de investimentos"],
    // propriedade para investimento só entra com aquisição, adição ou construção
    ["B3", "6.02.05", "Alienação de Propriedade para Investimento"],
    ["Multiplan", "6.02.08", "Baixas em Propriedade para investimento"],
    ["Motiva (sem verbo)", "6.02.12", "Propriedade para investimentos"],
  ];
  for (const [empresa, conta, descricao] of fora) {
    test(`${empresa}: "${descricao}"`, () => assert.equal(categoriaDe(conta, descricao), null));
  }
  test("só linha do investimento (6.02) é capex", () => {
    assert.equal(categoriaDe("6.01.02.05", "Aquisição de imobilizado"), null);
    assert.equal(categoriaDe("6.03.05", "Aquisição de imobilizado"), null);
  });
  test("conta fixa nunca é classificada", () => {
    assert.equal(classificarLinha({ conta: "6.02.01", descricao: "Aquisição de imobilizado", valor: -1, contaFixa: true }), null);
  });
});

describe("variações do spike: juros pagos", () => {
  const casos = [
    ["Petrobras (no financiamento, sem a palavra pago)", "6.03.04", "Amortizações de juros - financiamentos"],
    ["Vale", "6.01.03.03", "Juros de empréstimos e financiamentos pagos"],
    ["WEG", "6.01.02.10", "Juros pagos sobre empréstimos e financiamentos"],
    ["WEG (digitação)", "6.03.03", "Juros pagos sobre empréstimos e financimamentos"],
    ["Ambev", "6.01.02.04", "Juros Pagos"],
    ["Suzano", "6.01.03.01", "Pagamento de juros sobre empréstimos, financiamentos e debêntures"],
    ["Localiza", "6.01.03.02", "Juros de empréstimos, financiamentos e títulos de dívida pagos"],
    ["Raia Drogasil", "6.01.03.01", "Juros Pagos"],
    ["Gerdau", "6.01.03.01", "Pagamento de juros de empréstimos e financiamentos"],
    ["Embraer", "6.01.02.15", "Juros pagos"],
    ["Sabesp", "6.01.03.01", "Juros Pagos"],
    ["Magazine Luiza", "6.03.03", "Pagamento de Juros sobre Empréstimos e Financiamentos"],
    ["Axia (encargos)", "6.01.03.01", "Pagamento de encargos financeiros"],
    ["CPFL (encargos)", "6.01.03.01", "Encargos de dívidas e debêntures pagos"],
    ["Multiplan (encargos)", "6.03.07", "Pagamento de encargos sobre debêntures"],
    ["Taesa", "6.03.05", "Pagamento de Debêntures - Juros"],
  ];
  for (const [empresa, conta, descricao] of casos) {
    test(`${empresa}: "${descricao}"`, () => assert.equal(categoriaDe(conta, descricao), "jurosPagos"));
  }

  const fora = [
    ["juros apropriados não são pagos (WEG)", "6.01.01.10", "Juros Provisionados de Empréstimos e Financiamentos"],
    ["despesa de juros nos ajustes (Raia)", "6.01.01.10", "Despesas Líquidas de Juros com Empréstimos"],
    ["juros recebidos (Ambev)", "6.01.02.05", "Juros Recebidos"],
    ["líquido de pagos e recebidos (Equatorial)", "6.01.03.04", "Juros Pagos/Recebidos"],
    ["juros sobre o capital próprio é provento (Sabesp)", "6.01.03.09", "Pagamento de Juros sobre o Capital Próprio"],
    ["principal e juros na mesma linha (Tenda)", "6.03.02", "Pagamento de empréstimos, financiamentos e debêntures (Principal e juros)"],
    ["derivativo de juros (Marfrig)", "6.03.09", "Pagamento de derivativos de juros - hedge de valor justo"],
    ["encargos sociais não são juros", "6.01.02.07", "Salários e encargos sociais"],
  ];
  for (const [rotulo, conta, descricao] of fora) {
    test(`fora: ${rotulo}`, () => assert.notEqual(categoriaDe(conta, descricao), "jurosPagos"));
  }
});

describe("variações do spike: proventos", () => {
  const casos = [
    ["Petrobras", "6.03.05", "Dividendos pagos a acionistas da Petrobras"],
    ["Vale", "6.03.04", "Dividendos/JCP Pagos a Acionistas"],
    ["WEG (abreviado)", "6.03.04", "Pgto de Dividendos/Juros s/ Capital Próprio"],
    ["Ambev", "6.03.10", "Dividendos e juros sobre o capital próprio pagos"],
    ["Suzano", "6.03.05", "Pagamento de juros sobre o capital próprio e dividendos"],
    ["Localiza", "6.03.05", "Dividendos"],
    ["Localiza", "6.03.06", "Juros sobre o capital próprio"],
    ["Raia Drogasil", "6.03.04", "Juros sobre Capital Próprio e Dividendos Pagos"],
    ["Gerdau", "6.03.02", "Dividendos e juros sobre o capital próprio pagos"],
    ["Embraer", "6.03.04", "Dividendos e juros sobre capital próprio"],
    ["Sabesp", "6.03.03", "Pagamento de dividendos e juros sobre o capital próprio"],
    ["Magazine Luiza", "6.03.04", "Pagamento de Dividendos"],
    ["Vivo", "6.03.04", "Pagamentos de Dividendos e Juros Sobre o Capital Próprio"],
    ["CSN Mineração (sem acento)", "6.03.06", "Juros s/ Capital Proprio"],
    ["Totvs (JSCP)", "6.03.05", "Dividendos e JSCP Pagos"],
    ["B3", "6.03.06", "Pagamento de Proventos"],
    ["Axia", "6.03.03", "Pagamento e remuneração aos acionistas"],
    ["Marcopolo", "6.03.05", "Pagamento dos juros s/capital próprio e dividendos"],
  ];
  for (const [empresa, conta, descricao] of casos) {
    test(`${empresa}: "${descricao}"`, () => assert.equal(categoriaDe(conta, descricao), "proventos"));
  }

  test("pagos a não controladores saem numa categoria separada (Petrobras)", () => {
    assert.equal(categoriaDe("6.03.06", "Dividendos pagos a acionistas não controladores"), "proventosNaoControladores");
    assert.equal(categoriaDe("6.03.07", "Pagamento dividendos SCPs e SPEs"), "proventosNaoControladores"); // Klabin
    const r = classificarLinhas([L("6.03.05", "Dividendos pagos a acionistas da Petrobras", -45_205_000), L("6.03.06", "Dividendos pagos a acionistas não controladores", -233_000)]);
    assert.equal(r.proventos.soma, -45_205_000);
    assert.equal(r.proventosNaoControladores.soma, -233_000);
  });

  const fora = [
    ["dividendos recebidos (WEG, no FCO)", "6.01.02.11", "Recebimento de dividendos / juros sobre capital próprio"],
    ["dividendos recebidos no financiamento", "6.03.09", "Dividendos recebidos de controladas"],
    ["'proventos' como recursos obtidos (Ambev)", "6.03.06", "Proventos de Empréstimos"],
    ["recompra de ações (Ambev)", "6.03.04", "Proventos/(recompra) de ações"],
    ["aporte de não controladores (Eneva)", "6.03.12", "Aporte de capital de acionistas não controladores"],
    ["redução de capital (Vivo)", "6.03.07", "Pagamentos a Acionistas por Redução de Capital Social"],
  ];
  for (const [rotulo, conta, descricao] of fora) {
    test(`fora: ${rotulo}`, () => assert.equal(categoriaDe(conta, descricao), null));
  }
});

describe("arrendamentos pagos (IFRS 16)", () => {
  const principal = [
    ["Raia Drogasil", "Pagamentos de Arrendamentos"],
    ["Petrobras", "Amortizações de arrendamentos"],
    ["Vale", "Arrendamentos - pagamentos"],
    ["Ambev", "Pagamento de Passivos de Arrendamento"],
    ["Gerdau (digitação)", "Pagamento de arrendamento mecantil"],
    ["Localiza", "Passivo de arrendamento - amortizações"],
    ["Lojas Renner", "Contraprestação de arrendamentos a pagar"],
    ["Prio (leasing)", "Encargos contratuais Leasing IFRS 16 - Principal"],
    ["Direcional (financiamento por arrendamento é arrendamento)", "Amortização do financiamento por arrendamento"],
    ["Allos (principal e juros vão inteiros para o principal)", "Pagamento de juros e principal sobre passivo de arrendamento"],
    ["Ultrapar (principal e juros)", "Pagamentos de arrendamentos Principal e Juros Pagos"],
  ];
  for (const [empresa, descricao] of principal) {
    test(`principal, ${empresa}: "${descricao}"`, () => assert.equal(categoriaDe("6.03.05", descricao), "principalArrendamento"));
  }

  const juros = [
    ["Raia Drogasil, no FCO", "6.01.03.03", "Juros Pagos - Arrendamentos"],
    ["Localiza, no FCO", "6.01.03.03", "Juros de arrendamento pagos"],
    ["Cemig, no FCO, sem a palavra pago", "6.01.03.05", "Juros sobre arrendamentos"],
    ["Magazine Luiza, no financiamento", "6.03.10", "Pagamento de Juros sobre Arrendamento Mercantil"],
    ["Copel (encargos)", "6.01.03.04", "Encargos de passivo de arrendamentos pagos"],
    ["Prio (leasing)", "6.03.11", "Encargos contratuais Leasing IFRS 16 - Juros"],
  ];
  for (const [rotulo, conta, descricao] of juros) {
    test(`juros, ${rotulo}: "${descricao}"`, () => assert.equal(categoriaDe(conta, descricao), "jurosArrendamento"));
  }

  test("despesa de juros de arrendamento nos ajustes (6.01.01) não é pagamento", () => {
    assert.equal(categoriaDe("6.01.01.12", "Despesas de Juros - Arrendamento"), null); // Raia
    assert.equal(categoriaDe("6.01.01.09", "Juros de arrendamento"), null); // Localiza
  });

  test("Vivo: principal de dívida e de arrendamento na mesma linha não entra, e a categoria fica null com o motivo", () => {
    const linha = L("6.03.01", "Pagamentos de Empréstimos, Financiamentos, Debêntures, Arrendamentos e Outros Credores", -5_232_024);
    assert.deepEqual(classificarLinha(linha), { categoria: "principalArrendamento", mistura: true });
    const { principalArrendamento } = classificarLinhas([linha]);
    assert.equal(principalArrendamento.soma, null);
    assert.equal(principalArrendamento.motivo, "pagamento de arrendamento misturado com dívida na DFC");
    assert.deepEqual(principalArrendamento.misturadas, [{ conta: "6.03.01", descricao: linha.descricao, valor: -5_232_024 }]);
    assert.deepEqual(principalArrendamento.linhas, []);
  });

  test("Vivo: juros de dívida e de arrendamento na mesma linha derrubam as duas categorias de juros", () => {
    const linha = L("6.01.02.11", "Juros Pagos de Empréstimos, Financiamentos, Debêntures e Arrendamentos", -2_308_755);
    const r = classificarLinhas([linha, L("6.01.02.12", "Juros pagos", -5)]);
    assert.equal(r.jurosArrendamento.soma, null);
    assert.equal(r.jurosArrendamento.motivo, "juros de arrendamento misturados com juros de dívida na DFC");
    assert.equal(r.jurosPagos.soma, null);
    assert.equal(r.jurosPagos.motivo, "juros de arrendamento misturados com juros de dívida na DFC");
  });

  test("linha misturada com valor zero não derruba a categoria", () => {
    const r = classificarLinhas([
      L("6.03.01", "Pagamento de empréstimos, financiamentos e arrendamentos", 0),
      L("6.03.02", "Pagamento de arrendamentos", -25),
    ]);
    assert.deepEqual([r.principalArrendamento.soma, r.principalArrendamento.motivo], [-25, null]);
  });
});

describe("D&A da DFC (só para conferir a da DVA)", () => {
  test("depreciação e amortização nos ajustes do lucro", () => {
    for (const d of ["Depreciação, Amortização e Exaustão", "Depreciações e Amortizações", "Depreciacao e Amortizacao", "Depreciação, depleção e amortização", "Amortização do direito de uso", "Exaustão dos ativos biológicos"]) {
      assert.equal(categoriaDe("6.01.01.02", d), "daDfc", d);
    }
  });
  test("amortização de custo de transação, de captação e de ágio não é D&A", () => {
    for (const d of ["Amortizações de Custos de Transação de Debêntures", "Amortização dos custos de captação de empréstimo", "Amortização do custo de transação, ágio e deságio", "Amortização de Despesas Antecipadas"]) {
      assert.equal(categoriaDe("6.01.01.11", d), null, d);
    }
  });
  test("fora do bloco de ajustes não é D&A (ex.: amortização de dívida no financiamento)", () => {
    assert.equal(categoriaDe("6.03.02", "Amortização de empréstimos"), null);
    assert.equal(categoriaDe("6.01.02.18", "Amortização do custo de abandono"), null);
  });
});

describe("classificarLinhas: somas, sinal e ausência", () => {
  test("a soma entra como vem, sem valor absoluto", () => {
    const r = classificarLinhas([L("6.02.01", "Aquisição de imobilizado", -120), L("6.02.02", "Aquisição de intangível", 15)]);
    assert.equal(r.capex.soma, -105);
    assert.equal(r.capex.motivo, null);
  });

  test("categoria sem linha: soma null e motivo 'não identificado', nunca zero", () => {
    const r = classificarLinhas([L("6.02.01", "Aquisição de imobilizado", -120)]);
    for (const c of ["jurosPagos", "proventos", "principalArrendamento", "jurosArrendamento", "proventosNaoControladores", "daDfc"]) {
      assert.deepEqual(r[c], { linhas: [], soma: null, motivo: "não identificado" }, c);
    }
  });

  test("sem linha nenhuma, todas as categorias saem 'não identificado'", () => {
    for (const entrada of [[], null, undefined]) {
      const r = classificarLinhas(entrada);
      assert.deepEqual(Object.keys(r), ORDEM);
      for (const c of ORDEM) assert.deepEqual(r[c], { linhas: [], soma: null, motivo: "não identificado" });
    }
  });

  test("linha identificada com valor zero dá soma 0: é o zero que a CVM informa", () => {
    const r = classificarLinhas([L("6.03.04", "Dividendos pagos", 0)]);
    assert.deepEqual([r.proventos.soma, r.proventos.motivo], [0, null]);
  });

  test("linha e sublinha na mesma categoria: conta só a de cima", () => {
    const r = classificarLinhas([
      L("6.02.01", "Aquisição de imobilizado e intangível", -100),
      L("6.02.01.01", "Aquisição de imobilizado", -70),
      L("6.02.01.02", "Aquisição de intangível", -30),
    ]);
    assert.deepEqual(r.capex.linhas.map((l) => l.conta), ["6.02.01"]);
    assert.equal(r.capex.soma, -100);
  });

  test("linha sem valor único derruba a soma, com o motivo", () => {
    const r = classificarLinhas([L("6.02.01", "Aquisição de imobilizado", null)]);
    assert.equal(r.capex.soma, null);
    assert.match(r.capex.motivo, /6\.02\.01 .* veio sem valor único/);
  });

  test("prioridade: uma linha que bate em duas categorias fica só na que vem antes em ORDEM", () => {
    // juros de arrendamento vence proventos
    const dupla = L("6.03.09", "Pagamento de dividendos e de juros de arrendamento", -9);
    assert.equal(classificarLinha(dupla).categoria, "jurosArrendamento");
    const r = classificarLinhas([dupla]);
    assert.equal(r.jurosArrendamento.soma, -9);
    assert.equal(r.proventos.soma, null);
    // não controladores vence proventos; proventos vence juros pagos
    assert.equal(categoriaDe("6.03.06", "Dividendos pagos a acionistas não controladores"), "proventosNaoControladores");
    assert.equal(categoriaDe("6.03.04", "Dividendos e juros pagos aos acionistas"), "proventos");
    assert.ok(ORDEM.indexOf("jurosArrendamento") < ORDEM.indexOf("proventos"));
    assert.ok(ORDEM.indexOf("proventos") < ORDEM.indexOf("jurosPagos"));
  });

  test("cada linha entra em no máximo uma categoria", () => {
    const r = classificarLinhas(DFC);
    const contas = ORDEM.flatMap((c) => r[c].linhas.map((l) => l.conta));
    assert.equal(new Set(contas).size, contas.length);
  });
});

describe("exceções por companhia (excecoes-dfc.json)", () => {
  const arquivo = JSON.parse(readFileSync(new URL("../scripts/cvm/excecoes-dfc.json", import.meta.url), "utf8"));

  test("o arquivo commitado é válido e toda exceção tem motivo", () => {
    assert.ok(Array.isArray(arquivo.excecoes));
    assert.deepEqual(validarExcecoes(arquivo.excecoes), []);
  });

  test("validarExcecoes acusa cnpj, descrição, categoria e motivo", () => {
    const erros = validarExcecoes([
      { cnpj: "123", descricao: "x", categoria: "capex", motivo: "m" },
      { cnpj: "00.000.000/0001-00", descricao: "", categoria: "capex", motivo: "m" },
      { cnpj: "00.000.000/0001-00", descricao: "x", categoria: "dividendos", motivo: "m" },
      { cnpj: "00.000.000/0001-00", descricao: "x", categoria: "capex", motivo: " " },
    ]);
    assert.deepEqual(erros, ["exceção 1: cnpj inválido", "exceção 2: falta a descrição da linha", "exceção 3: categoria desconhecida (dividendos)", "exceção 4: falta o motivo"]);
    assert.deepEqual(validarExcecoes([{ cnpj: "00.000.000/0001-00", descricao: "x", categoria: null, motivo: "não é capex" }]), []);
  });

  test("a exceção vence a regra: põe a linha numa categoria ou tira de todas", () => {
    const excecoes = [
      { cnpj: "00.000.000/0001-00", descricao: "Aquisições de ativos de óleo e gás", categoria: "capex", motivo: "é o capex da companhia" },
      { cnpj: "00.000.000/0001-00", descricao: "aquisição de IMOBILIZADO", categoria: null, motivo: "é compra de empresa lançada com outro nome" },
    ];
    const r = classificarLinhas([L("6.02.08", "Aquisições de ativos de óleo e gás", -788), L("6.02.01", "Aquisição de imobilizado", -50)], { excecoes });
    assert.deepEqual(r.capex.linhas.map((l) => l.conta), ["6.02.08"]);
    assert.equal(r.capex.soma, -788);
    // sem a exceção, é o contrário
    assert.equal(classificarLinhas([L("6.02.08", "Aquisições de ativos de óleo e gás", -788), L("6.02.01", "Aquisição de imobilizado", -50)]).capex.soma, -50);
  });

  test("a exceção com conta só vale para aquela conta; excecoesDaCompanhia filtra pelo CNPJ", () => {
    const excecoes = [
      { cnpj: "11.111.111/0001-11", descricao: "Investimentos", conta: "6.02.01", categoria: "capex", motivo: "m" },
      { cnpj: "22.222.222/0001-22", descricao: "Investimentos", categoria: "capex", motivo: "m" },
    ];
    const daPrimeira = excecoesDaCompanhia(excecoes, "11.111.111/0001-11");
    assert.equal(daPrimeira.length, 1);
    assert.equal(classificarLinha(L("6.02.01", "Investimentos"), daPrimeira).categoria, "capex");
    assert.equal(classificarLinha(L("6.02.05", "Investimentos"), daPrimeira), null);
    assert.deepEqual(excecoesDaCompanhia(excecoes, "33.333.333/0001-33"), []);
  });
});

describe("composição do capital", () => {
  const CAB = "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;QT_ACAO_ORDIN_CAP_INTEGR;QT_ACAO_PREF_CAP_INTEGR;QT_ACAO_TOTAL_CAP_INTEGR;QT_ACAO_ORDIN_TESOURO;QT_ACAO_PREF_TESOURO;QT_ACAO_TOTAL_TESOURO";

  test("WEG, DFP de 2025: 4.197.317.998 ações, 1.622.025 em tesouraria", () => {
    assert.deepEqual(lerComposicaoCapital(texto("weg", "dfp_cia_aberta_composicao_capital_2025.csv")), [{
      cnpj: "84.429.695/0001-11", dtRefer: "2025-12-31", versao: 1,
      acoesTotal: 4_197_317_998, acoesTesouraria: 1_622_025, acoesCirculacao: 4_197_317_998 - 1_622_025,
    }]);
  });

  test("o ITR também traz a composição (WEG, 30/09/2026)", () => {
    const [c] = lerComposicaoCapital(texto("weg", "itr_cia_aberta_composicao_capital_2026.csv"));
    assert.deepEqual([c.dtRefer, c.acoesTotal, c.acoesTesouraria], ["2026-09-30", 4_197_317_998, 1_488_307]);
  });

  test("fica a maior versão de cada documento", () => {
    const r = lerComposicaoCapital([CAB,
      "00.000.000/0001-00;2025-12-31;1;X;900;100;1000;10;0;10",
      "00.000.000/0001-00;2025-12-31;3;X;900;100;1000;40;0;40",
      "00.000.000/0001-00;2025-12-31;2;X;900;100;1000;20;0;20",
      "00.000.000/0001-00;2024-12-31;1;X;800;100;900;0;0;0",
    ].join("\r\n"));
    assert.deepEqual(r.map((c) => [c.dtRefer, c.versao, c.acoesCirculacao]), [["2024-12-31", 1, 900], ["2025-12-31", 3, 960]]);
  });

  test("sem tesouraria (campo vazio ou zero): circulação = total", () => {
    const r = lerComposicaoCapital([CAB, "00.000.000/0001-00;2025-12-31;1;X;1000;0;1000;;;", "00.000.000/0001-00;2024-12-31;1;X;1000;0;1000;0;0;0"].join("\r\n"));
    assert.deepEqual(r.map((c) => [c.acoesTesouraria, c.acoesCirculacao]), [[0, 1000], [0, 1000]]);
  });

  test("total zerado ou vazio: circulação null, não zero", () => {
    const r = lerComposicaoCapital([CAB, "00.000.000/0001-00;2025-12-31;1;X;0;0;0;0;0;0", "00.000.000/0001-00;2024-12-31;1;X;;;;;;"].join("\n"));
    assert.deepEqual(r.map((c) => c.acoesCirculacao), [null, null]);
  });

  test("arquivo vazio dá lista vazia; coluna faltando, quantidade não numérica e linha torta dão erro", () => {
    assert.deepEqual(lerComposicaoCapital(""), []);
    assert.deepEqual(lerComposicaoCapital(`${CAB}\r\n`), []);
    assert.throws(() => lerComposicaoCapital("CNPJ_CIA;DT_REFER;VERSAO\r\nx;y;1"), /sem a coluna QT_ACAO_TOTAL_CAP_INTEGR/);
    assert.throws(() => lerComposicaoCapital(`${CAB}\r\n00.000.000/0001-00;2025-12-31;1;X;900;100;mil;0;0;0`), /linha 2: QT_ACAO_TOTAL_CAP_INTEGR não é um inteiro/);
    assert.throws(() => lerComposicaoCapital(`${CAB}\r\n00.000.000/0001-00;2025-12-31;1`), /linha 2: 3 colunas, esperava 10/);
  });

  test("composicaoNaData: a da data; a anterior só quando pedido", () => {
    const lista = [{ dtRefer: "2024-12-31", acoesCirculacao: 1 }, { dtRefer: "2025-12-31", acoesCirculacao: 2 }];
    assert.equal(composicaoNaData(lista, "2025-12-31").acoesCirculacao, 2);
    assert.equal(composicaoNaData(lista, "2026-09-30"), null);
    assert.equal(composicaoNaData(lista, "2026-09-30", { aceitarAnterior: true }).dtRefer, "2025-12-31");
    assert.equal(composicaoNaData([], "2025-12-31", { aceitarAnterior: true }), null);
  });
});

describe("indicadores de fluxo de caixa: a lista", () => {
  const NOVOS = ["fco", "fci", "fcf", "capex", "fcl", "fclAposArrendamentos", "fcoSobreEbitda", "capexSobreFco", "jurosPagos",
    "coberturaJurosPagos", "custoDividaJurosPagos", "proventosPagos", "acoesCirculacao", "diluicao", "lucroPorAcao", "fcoPorAcao", "fclPorAcao"];

  test("os 17 indicadores da #36 entram no fim da lista, cada um com fórmula", () => {
    assert.deepEqual(INDICADORES.map((i) => i.id).slice(-NOVOS.length), NOVOS);
    for (const id of NOVOS) assert.ok(INDICADORES.find((i) => i.id === id).formula.trim().length > 10, id);
  });

  test("unidades: ações em unidades e valores por ação em R$ por ação", () => {
    const unidade = (id) => INDICADORES.find((i) => i.id === id).unidade;
    assert.equal(unidade("acoesCirculacao"), "ações");
    for (const id of ["lucroPorAcao", "fcoPorAcao", "fclPorAcao"]) assert.equal(unidade(id), "R$ por ação", id);
    for (const id of ["fcoSobreEbitda", "capexSobreFco", "coberturaJurosPagos", "custoDividaJurosPagos", "diluicao"]) assert.equal(unidade(id), "razão", id);
    for (const id of ["fco", "fci", "fcf", "capex", "fcl", "fclAposArrendamentos", "jurosPagos", "proventosPagos"]) assert.equal(unidade(id), "R$ mil", id);
  });

  test("a fórmula do lucro por ação diz que usa o lucro da controladora e por quê", () => {
    const { formula } = INDICADORES.find((i) => i.id === "lucroPorAcao");
    assert.match(formula, /3\.11\.01/);
    assert.match(formula, /minoritários não pertence ao acionista/);
  });

  test("as fórmulas dos dois FCL e do capex dizem o que entra e o que fica de fora", () => {
    assert.equal(INDICADORES.find((i) => i.id === "fcl").formula, "FCO − capex");
    assert.match(INDICADORES.find((i) => i.id === "fclAposArrendamentos").formula, /já foram descontados/);
    assert.match(INDICADORES.find((i) => i.id === "capex").formula, /Aquisição de empresas não entra/);
    assert.match(INDICADORES.find((i) => i.id === "proventosPagos").formula, /não controladores ficam de fora/);
  });
});

describe("cada indicador de fluxo de caixa, num exercício sintético", () => {
  const ind = calcularIndicadores(anual(), { composicao: ACOES, composicaoAnterior: { acoesCirculacao: 800 } });
  const casos = {
    fco: 300, // 6.01
    fci: -170, // 6.02
    fcf: -90, // 6.03
    capex: 130, // −(−120 − 10); a compra de controlada (−40) fica de fora
    fcl: 170, // 300 − 130
    fclAposArrendamentos: 145, // 170 − 25; os juros de arrendamento (8) estão no FCO
    fcoSobreEbitda: 300 / 250,
    capexSobreFco: 130 / 300,
    jurosPagos: 20,
    coberturaJurosPagos: 200 / 20, // EBIT ÷ juros pagos
    custoDividaJurosPagos: 20 / 500,
    proventosPagos: 60, // os 5 pagos a não controladores ficam de fora
    acoesCirculacao: 1000,
    diluicao: 1000 / 800 - 1,
    lucroPorAcao: (90 * 1000) / 1000, // 3.11.01 em R$ mil → R$ por ação
    fcoPorAcao: (300 * 1000) / 1000,
    fclPorAcao: (170 * 1000) / 1000,
  };
  for (const [id, esperado] of Object.entries(casos)) {
    test(`${id} = ${esperado}`, () => assert.deepEqual(ind[id], { valor: esperado, motivo: null }));
  }

  test("o lucro por ação usa o 3.11.01, não o 3.11", () => {
    assert.notEqual(ind.lucroPorAcao.valor, (100 * 1000) / 1000);
  });

  test("juros de arrendamento no financiamento também saem do FCL depois dos arrendamentos", () => {
    const dfc = [...trocar(DFC, "6.01.02.11", null), L("6.03.04", "Pagamento de juros de arrendamento", -8)];
    const r = calcularIndicadores(anual({ dfc }));
    assert.equal(r.fcl.valor, 170);
    assert.equal(r.fclAposArrendamentos.valor, 170 - 25 - 8);
  });

  test("sem linha de juros de arrendamento, o FCL depois dos arrendamentos desconta só o principal", () => {
    const r = calcularIndicadores(anual({ dfc: trocar(DFC, "6.01.02.11", null) }));
    assert.equal(r.fclAposArrendamentos.valor, 145);
  });

  test("fluxosClassificados devolve as somas com o sinal da DFC", () => {
    const c = fluxosClassificados(anual());
    assert.deepEqual(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.valor])), {
      jurosArrendamento: -8, principalArrendamento: -25, proventosNaoControladores: -5, proventos: -60,
      jurosPagos: -20, capex: -130, daDfc: 50, jurosArrendamentoNoFcf: 0,
    });
  });
});

describe("fluxo de caixa: regras de null", () => {
  test("categoria ausente: null 'não identificado', não zero", () => {
    const semCapex = calcularIndicadores(anual({ dfc: DFC.filter((l) => !l.conta.startsWith("6.02.")) }), { composicao: ACOES });
    assert.deepEqual(semCapex.capex, { valor: null, motivo: "não identificado" });
    assert.deepEqual(semCapex.fcl, { valor: null, motivo: "capex não identificado na DFC" });
    assert.deepEqual(semCapex.capexSobreFco, { valor: null, motivo: "capex não identificado na DFC" });
    assert.deepEqual(semCapex.fclPorAcao, { valor: null, motivo: "capex não identificado na DFC" });
    assert.deepEqual(semCapex.fclAposArrendamentos, { valor: null, motivo: "capex não identificado na DFC" });
    assert.equal(semCapex.fco.valor, 300);
    assert.equal(semCapex.fcoPorAcao.valor, 300);

    const semJuros = calcularIndicadores(anual({ dfc: trocar(DFC, "6.01.02.10", null) }));
    assert.deepEqual(semJuros.jurosPagos, { valor: null, motivo: "não identificado" });
    assert.deepEqual(semJuros.coberturaJurosPagos, { valor: null, motivo: "juros pagos não identificado na DFC" });
    assert.deepEqual(semJuros.custoDividaJurosPagos, { valor: null, motivo: "juros pagos não identificado na DFC" });

    const semProventos = calcularIndicadores(anual({ dfc: trocar(DFC, "6.03.01", null) }));
    assert.deepEqual(semProventos.proventosPagos, { valor: null, motivo: "não identificado" });
  });

  test("sem linha de arrendamento na DFC: o FCL depois dos arrendamentos é null, não igual ao FCL", () => {
    const r = calcularIndicadores(anual({ dfc: DFC.filter((l) => !/arrendament/i.test(l.descricao)) }));
    assert.equal(r.fcl.valor, 170);
    assert.deepEqual(r.fclAposArrendamentos, { valor: null, motivo: "pagamento de arrendamento não identificado na DFC" });
  });

  test("linha mista de dívida e arrendamento: FCL depois dos arrendamentos null com o motivo", () => {
    const dfc = [...trocar(DFC, "6.03.02", null), L("6.03.02", "Pagamentos de Empréstimos, Financiamentos, Debêntures, Arrendamentos e Outros Credores", -400)];
    const r = calcularIndicadores(anual({ dfc }));
    assert.deepEqual(r.fclAposArrendamentos, { valor: null, motivo: "pagamento de arrendamento misturado com dívida na DFC" });
    assert.equal(r.fcl.valor, 170);
    assert.equal(r.capex.valor, 130);
  });

  test("juros de dívida e de arrendamento na mesma linha: juros pagos e as razões ficam null com o motivo", () => {
    const dfc = [...trocar(trocar(DFC, "6.01.02.10", null), "6.01.02.11", null), L("6.01.02.10", "Juros Pagos de Empréstimos, Financiamentos, Debêntures e Arrendamentos", -28)];
    const r = calcularIndicadores(anual({ dfc }));
    const motivo = "juros de arrendamento misturados com juros de dívida na DFC";
    for (const id of ["jurosPagos", "coberturaJurosPagos", "custoDividaJurosPagos", "fclAposArrendamentos"]) assert.deepEqual(r[id], { valor: null, motivo }, id);
  });

  test("FCO negativo: capex ÷ FCO null; o FCL sai negativo, como valor", () => {
    const r = calcularIndicadores(anual({ dfc: trocar(DFC, "6.01", { valor: -80 }) }), { composicao: ACOES });
    assert.deepEqual(r.capexSobreFco, { valor: null, motivo: "FCO zero ou negativo" });
    assert.deepEqual(r.fcl, { valor: -80 - 130, motivo: null });
    assert.deepEqual(r.fclPorAcao, { valor: -210, motivo: null });
    assert.equal(r.fcoSobreEbitda.valor, -80 / 250);
    assert.deepEqual(calcularIndicadores(anual({ dfc: trocar(DFC, "6.01", { valor: 0 }) })).capexSobreFco, { valor: null, motivo: "FCO zero ou negativo" });
  });

  test("EBITDA negativo: FCO ÷ EBITDA null", () => {
    const r = calcularIndicadores(anual({ mudancas: { DRE: { "3.05": -300 } } }));
    assert.deepEqual(r.fcoSobreEbitda, { valor: null, motivo: "EBITDA zero ou negativo" });
    assert.equal(r.coberturaJurosPagos.valor, -300 / 20); // EBIT negativo dá cobertura negativa, que é valor
  });

  test("juros pagos zero: cobertura e custo null; o valor zero continua", () => {
    const r = calcularIndicadores(anual({ dfc: trocar(DFC, "6.01.02.10", { valor: 0 }) }));
    assert.deepEqual(r.jurosPagos, { valor: 0, motivo: null });
    for (const id of ["coberturaJurosPagos", "custoDividaJurosPagos"]) assert.deepEqual(r[id], { valor: null, motivo: "juros pagos zero ou negativos" }, id);
  });

  test("sem dívida: custo da dívida pelos juros pagos null 'sem dívida financeira'", () => {
    const r = calcularIndicadores(anual({ mudancas: { BPP: { "2.01.04": 0, "2.02.01": 0 }, DRE: { "3.06": 15, "3.06.02": -5 } } }));
    assert.deepEqual(r.custoDividaJurosPagos, { valor: null, motivo: "sem dívida financeira" });
    assert.equal(r.coberturaJurosPagos.valor, 10);
  });

  test("sem a DFC do período: fluxos null com a conta que falta; classificados dizem que falta a DFC", () => {
    const p = anual();
    delete p.demonstrativos.DFC;
    const r = calcularIndicadores(p);
    assert.deepEqual(r.fco, { valor: null, motivo: "falta a conta 6.01 (caixa das atividades operacionais)" });
    assert.deepEqual(r.capex, { valor: null, motivo: "falta a DFC do período" });
    assert.deepEqual(r.proventosPagos, { valor: null, motivo: "falta a DFC do período" });
  });

  test("sem a composição do capital: ações e valores por ação null; o resto continua", () => {
    const r = calcularIndicadores(anual());
    const motivo = "falta a composição do capital do período";
    for (const id of ["acoesCirculacao", "diluicao", "lucroPorAcao", "fcoPorAcao", "fclPorAcao"]) assert.deepEqual(r[id], { valor: null, motivo }, id);
    assert.equal(r.fcl.valor, 170);
  });

  test("composição sem o número de ações: null com motivo", () => {
    const r = calcularIndicadores(anual(), { composicao: { ...ACOES, acoesTotal: 0, acoesCirculacao: null } });
    assert.deepEqual(r.acoesCirculacao, { valor: null, motivo: "composição do capital sem o número de ações" });
    assert.deepEqual(r.lucroPorAcao, { valor: null, motivo: "composição do capital sem o número de ações" });
  });

  test("composição sem tesouraria: as ações em circulação são o total", () => {
    const [c] = lerComposicaoCapital("CNPJ_CIA;DT_REFER;VERSAO;QT_ACAO_TOTAL_CAP_INTEGR;QT_ACAO_TOTAL_TESOURO\r\n00.000.000/0001-00;2025-12-31;1;1000;");
    const r = calcularIndicadores(anual(), { composicao: c });
    assert.deepEqual(r.acoesCirculacao, { valor: 1000, motivo: null });
    assert.equal(r.fcoPorAcao.valor, 300);
  });

  test("diluição: primeiro ano da série e exercício anterior sem composição ficam null, cada um com o seu motivo", () => {
    assert.deepEqual(calcularIndicadores(anual(), { composicao: ACOES, primeiroAno: true }).diluicao, { valor: null, motivo: "primeiro ano da série" });
    assert.deepEqual(calcularIndicadores(anual(), { composicao: ACOES }).diluicao, { valor: null, motivo: "falta a composição do capital do exercício anterior" });
    const recompra = calcularIndicadores(anual(), { composicao: ACOES, composicaoAnterior: { acoesCirculacao: 1250 } });
    assert.equal(recompra.diluicao.valor, 1000 / 1250 - 1); // negativa quando o número de ações cai
  });

  test("período de transição: fluxos, FCL e valores por ação saem; as duas razões de juros pagos não", () => {
    const r = calcularIndicadores(anual({ tipo: "transicao", meses: 9 }), { composicao: ACOES });
    const motivo = "período de 9 meses, indicador não anualizado";
    for (const id of ["coberturaJurosPagos", "custoDividaJurosPagos"]) assert.deepEqual(r[id], { valor: null, motivo }, id);
    assert.equal(r.fco.valor, 300);
    assert.equal(r.fcl.valor, 170);
    assert.equal(r.jurosPagos.valor, 20);
    assert.equal(r.fcoSobreEbitda.valor, 1.2); // os dois são fluxos do mesmo período
    assert.equal(r.fcoPorAcao.valor, 300);
  });

  test("12 meses indisponível: tudo null com o motivo da série", () => {
    const motivo = "falta o ITR de 30/06/2025, de onde sai o acumulado do ano anterior";
    const doze = { tipo: "indisponivel", motivo, fim: "2026-06-30", parcelas: null, fluxos: null, estoques: null };
    const r = calcularIndicadores(doze, { composicao: ACOES });
    for (const id of ["fco", "capex", "fcl", "fclAposArrendamentos", "jurosPagos", "proventosPagos", "acoesCirculacao", "lucroPorAcao"]) assert.deepEqual(r[id], { valor: null, motivo }, id);
    assert.deepEqual(fluxosClassificados(doze).capex, { valor: null, motivo });
  });

  test("nenhum motivo aparece junto com valor, e nenhum null fica sem motivo", () => {
    const todos = [...WEG.indicadores.anual, WEG.indicadores.doze, ...RAIA.indicadores.anual, RAIA.indicadores.doze,
      ...SAO_MARTINHO.indicadores.anual, SAO_MARTINHO.indicadores.doze, ...HAPVIDA.indicadores.anual];
    for (const x of todos) {
      assert.deepEqual(Object.keys(x.indicadores), INDICADORES.map((i) => i.id));
      for (const [id, r] of Object.entries(x.indicadores)) {
        assert.equal(r.valor == null, r.motivo != null, `${x.fim} ${id}`);
        if (r.valor != null) assert.ok(Number.isFinite(r.valor), `${x.fim} ${id}`);
      }
    }
  });
});

describe("base de 12 meses: as linhas classificadas passam por doze() nas três parcelas", () => {
  test("anual + acumulado atual − acumulado anterior, categoria por categoria", () => {
    // sintético: o acumulado atual é metade do ano e o anterior, um quarto → 12 meses = 1 + 0,5 − 0,25 = 1,25 × o ano
    const c = fluxosClassificados(doze12());
    assert.equal(c.capex.valor, -130 * 1.25);
    assert.equal(c.jurosPagos.valor, -20 * 1.25);
    assert.equal(c.proventos.valor, -60 * 1.25);
    assert.equal(c.principalArrendamento.valor, -25 * 1.25);
    const ind = calcularIndicadores(doze12(), { composicao: ACOES });
    assert.equal(ind.capex.valor, 162.5);
    assert.equal(ind.fcl.valor, 300 - 162.5);
    assert.equal(ind.fclAposArrendamentos.valor, 300 - 162.5 - 31.25);
    assert.deepEqual(ind.diluicao, { valor: null, motivo: "a diluição só existe na série anual" });
    assert.equal(ind.fcoPorAcao.valor, 300);
  });

  test("categoria numa parcela só: null, e o motivo diz em qual documento a linha não foi identificada", () => {
    const semDividendos = (linhas, f) => linhas.filter((l) => !l.contaFixa && l.conta !== "6.03.01").map((l) => ({ ...l, valor: l.valor * f }));
    const noItrAtual = fluxosClassificados(doze12({ atualDfc: semDividendos(DFC, 0.5) }));
    assert.deepEqual(noItrAtual.proventos, { valor: null, motivo: "a linha de proventos pagos não foi identificada no ITR de 30/06/2026" });
    assert.equal(noItrAtual.capex.valor, -162.5); // as outras categorias continuam

    const noItrAnterior = fluxosClassificados(doze12({ anteriorDfc: semDividendos(DFC, 0.25) }));
    assert.equal(noItrAnterior.proventos.motivo, "a linha de proventos pagos não foi identificada no ITR de 30/06/2025");

    const naDfp = fluxosClassificados(doze12({ anualDfc: DFC.filter((l) => l.conta !== "6.03.01") }));
    assert.equal(naDfp.proventos.motivo, "a linha de proventos pagos não foi identificada na DFP de 31/12/2025");

    const ind = calcularIndicadores(doze12({ atualDfc: semDividendos(DFC, 0.5) }));
    assert.deepEqual(ind.proventosPagos, { valor: null, motivo: "a linha de proventos pagos não foi identificada no ITR de 30/06/2026" });
  });

  test("a descrição mudou entre a DFP e o ITR, mas as duas batem na regra: a soma sai", () => {
    const outraDescricao = DFC.filter((l) => !l.contaFixa).map((l) => (l.conta === "6.02.01" ? { ...l, conta: "6.02.07", descricao: "Adições ao imobilizado", valor: -60 } : { ...l, valor: l.valor * 0.5 }));
    const c = fluxosClassificados(doze12({ atualDfc: outraDescricao }));
    assert.equal(c.capex.valor, -130 + (-60 - 5) - (-130 * 0.25));
  });

  test("categoria ausente nas três parcelas: 'não identificado'", () => {
    const semArrendamento = (f) => DFC.filter((l) => !l.contaFixa && !/arrendament/i.test(l.descricao)).map((l) => ({ ...l, valor: l.valor * f }));
    const d = doze12({ anualDfc: DFC.filter((l) => !/arrendament/i.test(l.descricao)), atualDfc: semArrendamento(0.5), anteriorDfc: semArrendamento(0.25) });
    assert.deepEqual(fluxosClassificados(d).principalArrendamento, { valor: null, motivo: "não identificado" });
    assert.deepEqual(calcularIndicadores(d).fclAposArrendamentos, { valor: null, motivo: "pagamento de arrendamento não identificado na DFC" });
  });

  test("linha misturada em qualquer parcela derruba a categoria nos 12 meses", () => {
    const comMistura = [...DFC.filter((l) => !l.contaFixa && l.conta !== "6.03.02").map((l) => ({ ...l, valor: l.valor * 0.5 })), L("6.03.02", "Pagamento de empréstimos, financiamentos e arrendamentos", -200)];
    assert.deepEqual(fluxosClassificados(doze12({ atualDfc: comMistura })).principalArrendamento, { valor: null, motivo: "pagamento de arrendamento misturado com dívida na DFC" });
  });

  test("série (#33): linhasDfc traz só as linhas não fixas das três parcelas, com as datas em `parcelas`", () => {
    const { linhasDfc, parcelas } = WEG.series.doze;
    assert.deepEqual(Object.keys(linhasDfc), ["anual", "acumuladoAtual", "acumuladoAnterior"]);
    for (const linhas of Object.values(linhasDfc)) {
      assert.ok(linhas.length > 20);
      assert.ok(linhas.every((l) => l.contaFixa === false && !["6.01", "6.02", "6.03"].includes(l.conta)));
    }
    assert.deepEqual(linhasDfc.anual.find((l) => l.conta === "6.02.02"), { conta: "6.02.02", descricao: "Imobilizado", valor: -2_563_450, contaFixa: false });
    assert.deepEqual([parcelas.acumuladoAtual.dtRefer, parcelas.acumuladoAnterior.dtRefer], ["2026-09-30", "2025-09-30"]);
  });

  test("série (#33): no ano fechado só há a parcela anual", () => {
    const { linhasDfc } = RAIA.series.doze;
    assert.equal(linhasDfc.acumuladoAtual, null);
    assert.equal(linhasDfc.acumuladoAnterior, null);
    assert.equal(linhasDfc.anual.find((l) => l.conta === "6.02.03").valor, -1_402_977);
    assert.deepEqual(valoresDe(RAIA.indicadores.doze.indicadores, ["capex", "fcl", "fclAposArrendamentos", "proventosPagos"]), [1_402_977, 1_027_677, 106_493, 652_764]);
  });
});

function valoresDe(indicadores, ids) {
  return ids.map((id) => indicadores[id].valor);
}

// Critério de aceite da #36: valores conferidos contra a DFC publicada de 2 empresas.
describe("DFC publicada: WEG em 2025", () => {
  // Fonte: WEG S.A., "Release de Resultados 4T 2025", 25/02/2026, no site de RI da companhia:
  //   https://api.mziq.com/mzfilemanager/v2/d/50c1bd3e-8ac6-42d9-884f-b9d69f690602/e93d71d4-7174-addd-7179-527d63dc51ce?origin=2
  //   (link "Release Resultados 4T25" de https://ri.weg.net/informacoes-financeiras/central-de-resultados/, consultado em 13/11/2026).
  //   Página 12, "Anexo IV - Demonstração dos Fluxos de Caixa Consolidados", coluna 12 Meses 2025, em R$ mil:
  //     Caixa Líquido proveniente das Atividades Operacionais     6.451.033
  //     Juros pagos sobre empréstimos e financiamentos             (177.085)
  //     Imobilizado                                              (2.563.450)
  //     Intangível                                                 (127.871)
  //     Aquisição de Controlada                                    (200.575)
  //     Caixa Líquido aplicado nas Atividades de Investimentos   (2.910.810)
  //     Dividendos/juros s/capital próprio pagos                 (5.384.769)
  //     Caixa líquido aplicado nas ativ. de financiamentos       (4.362.857)
  //   Página 10, Anexo II: Lucro Líquido do Exercício (controladores) 6.376.219; Lucro por Ação (LPA) 1,51971.
  const DFC_WEG = { fco: 6_451_033, juros: 177_085, imobilizado: 2_563_450, intangivel: 127_871, aquisicao: 200_575, fci: -2_910_810, proventos: 5_384_769, fcf: -4_362_857 };
  const ind = ano(WEG, "2025-12-31").indicadores;

  test("FCO, FCI e FCF iguais aos da DFC", () => {
    assert.deepEqual(valoresDe(ind, ["fco", "fci", "fcf"]), [DFC_WEG.fco, DFC_WEG.fci, DFC_WEG.fcf]);
  });

  test("capex = 2.563.450 + 127.871 = 2.691.321, sem a aquisição de empresa (200.575)", () => {
    assert.equal(ind.capex.valor, DFC_WEG.imobilizado + DFC_WEG.intangivel);
    assert.equal(ind.capex.valor, 2_691_321);
    const { capex } = classificarLinhas(dfcDe(WEG, "2025-12-31"));
    assert.deepEqual(capex.linhas.filter((l) => l.valor !== 0).map((l) => [l.conta, l.descricao, l.valor]), [["6.02.02", "Imobilizado", -2_563_450], ["6.02.03", "Intangível", -127_871]]);
    assert.equal(classificarLinha(dfcDe(WEG, "2025-12-31").find((l) => l.valor === -DFC_WEG.aquisicao)), null);
  });

  test("FCL = 6.451.033 − 2.691.321 = 3.759.712", () => {
    assert.equal(ind.fcl.valor, 3_759_712);
  });

  test("juros pagos 177.085 e proventos 5.384.769", () => {
    assert.equal(ind.jurosPagos.valor, DFC_WEG.juros);
    assert.equal(ind.proventosPagos.valor, DFC_WEG.proventos);
  });

  test("nenhuma linha de arrendamento na DFC: o FCL depois dos arrendamentos é null com o motivo, não igual ao FCL", () => {
    assert.deepEqual(ind.fclAposArrendamentos, { valor: null, motivo: "pagamento de arrendamento não identificado na DFC" });
  });

  test("ações em circulação = 4.197.317.998 − 1.622.025", () => {
    assert.equal(ind.acoesCirculacao.valor, 4_197_317_998 - 1_622_025);
    assert.equal(ano(WEG, "2025-12-31").composicao.dtRefer, "2025-12-31");
  });

  test("lucro por ação ≈ R$ 1,52: 6.376.219 mil (3.11.01) ÷ ações em circulação", () => {
    assert.equal(ind.lucroPorAcao.valor, (6_376_219 * 1000) / 4_195_695_973);
    assert.ok(Math.abs(ind.lucroPorAcao.valor - 1.51971) < 0.0005, String(ind.lucroPorAcao.valor)); // o LPA do release
  });

  test("FCO e FCL por ação, FCO ÷ EBITDA e capex ÷ FCO", () => {
    assert.equal(ind.fcoPorAcao.valor, (6_451_033 * 1000) / 4_195_695_973);
    assert.equal(ind.fclPorAcao.valor, (3_759_712 * 1000) / 4_195_695_973);
    assert.equal(ind.fcoSobreEbitda.valor, 6_451_033 / 9_000_037);
    assert.equal(ind.capexSobreFco.valor, 2_691_321 / 6_451_033);
  });

  test("cobertura e custo da dívida pelos juros pagos", () => {
    assert.equal(ind.coberturaJurosPagos.valor, 7_998_741 / 177_085);
    assert.equal(ind.custoDividaJurosPagos.valor, 177_085 / 4_590_822);
  });

  test("a D&A da DFC é igual à da DVA (1.001.296)", () => {
    assert.equal(fluxosClassificados(periodo(WEG, "2025-12-31")).daDfc.valor, 1_001_296);
    assert.equal(ind.da.valor, 1_001_296);
  });

  test("diluição: o primeiro exercício com composição não tem a anterior", () => {
    assert.equal(ano(WEG, "2025-12-31").indicadores.diluicao.valor, null);
  });
});

describe("WEG, 12 meses até o 3T26: soma das três parcelas", () => {
  const ind = WEG.indicadores.doze.indicadores;
  const somaCapex = (linhas) => classificarLinhas(linhas).capex.soma;

  test("capex conferido à mão: 2.691.321 (2025) + acumulado 9M26 − acumulado 9M25", () => {
    const { anual: a, acumuladoAtual: b, acumuladoAnterior: c } = WEG.series.doze.linhasDfc;
    // As linhas "Imobilizado" e "Intangível" de cada parcela, como estão nos arquivos. O código muda:
    // na DFP são 6.02.02 e 6.02.03; nos dois ITR, 6.02.01 e 6.02.02. Por isso a regra é pela descrição.
    const linha = (linhas, descricao) => linhas.find((l) => l.descricao === descricao);
    assert.deepEqual([linha(a, "Imobilizado").conta, linha(b, "Imobilizado").conta, linha(c, "Imobilizado").conta], ["6.02.02", "6.02.01", "6.02.01"]);
    const parcela = (linhas) => linha(linhas, "Imobilizado").valor + linha(linhas, "Intangível").valor;
    assert.deepEqual([parcela(a), parcela(b), parcela(c)], [-2_691_321, -2_264_091, -1_877_226]);
    assert.deepEqual([somaCapex(a), somaCapex(b), somaCapex(c)], [parcela(a), parcela(b), parcela(c)]);
    assert.equal(ind.capex.valor, 2_691_321 + 2_264_091 - 1_877_226);
    assert.equal(ind.capex.valor, 3_078_186);
  });

  test("FCL = FCO de 12 meses (6.085.319) − capex de 12 meses", () => {
    assert.equal(ind.fco.valor, 6_085_319);
    assert.equal(ind.fcl.valor, 6_085_319 - 3_078_186);
  });

  test("juros pagos e proventos também pela soma das três parcelas", () => {
    assert.equal(ind.jurosPagos.valor, 259_738);
    assert.equal(ind.proventosPagos.valor, 3_968_185);
  });

  test("as ações são as do ITR de 30/09/2026 (tesouraria de 1.488.307)", () => {
    assert.equal(WEG.indicadores.doze.composicao.dtRefer, "2026-09-30");
    assert.equal(ind.acoesCirculacao.valor, 4_197_317_998 - 1_488_307);
    assert.equal(ind.lucroPorAcao.valor, (WEG.series.doze.fluxos["3.11.01"].valor * 1000) / (4_197_317_998 - 1_488_307));
  });

  test("sem a composição do ITR, vale a mais recente anterior, e a data mostra de onde veio", () => {
    const soDfp = WEG.composicoes.filter((c) => c.dtRefer === "2025-12-31");
    const r = calcularIndicadoresDaSerie(WEG.series, { composicoes: soDfp });
    assert.equal(r.doze.composicao.dtRefer, "2025-12-31");
    assert.equal(r.doze.indicadores.acoesCirculacao.valor, 4_197_317_998 - 1_622_025);
  });
});

describe("DFC publicada: Raia Drogasil (RD Saúde) em 2025", () => {
  // Fonte: RD Saúde (Raia Drogasil S.A.), "Resultados 4T25", 03/03/2026, no site de RI da companhia:
  //   https://ri.rdsaude.com.br/Download.aspx?Arquivo=5qQVLymU2JrA/iPP5ZJdWg==
  //   (link "Resultados 4T25" de https://ri.rdsaude.com.br/central-de-resultados, consultado em 13/11/2026).
  //   Página 22, "Demonstrações dos Fluxos de Caixa", coluna 2025, em R$ mil. O release é pré-IFRS 16:
  //     Juros pagos                                                          (469.833)
  //     Caixa líq. proveniente das (aplicado nas) atividades operacionais    1.509.470
  //     Aquisições de imobilizado e intangível                              (1.402.977)
  //     Juros sobre capital próprio e dividendo pagos                         (652.764)
  //   No padrão pré-IFRS 16 o aluguel sai do FCO. Por isso o FCO do release (1.509.470) é o FCO da CVM
  //   (2.430.654) menos o principal dos arrendamentos (921.184), e o FCL do release
  //   (1.509.470 − 1.402.977 = 106.493) é o nosso FCL depois dos arrendamentos.
  const DFC_RAIA = { fcoPreIfrs16: 1_509_470, capex: 1_402_977, juros: 469_833, proventos: 652_764 };
  const ind = ano(RAIA, "2025-12-31").indicadores;
  const classes = classificarLinhas(dfcDe(RAIA, "2025-12-31"));

  test("capex 1.402.977, juros pagos 469.833 e proventos 652.764, iguais aos do release", () => {
    assert.deepEqual(valoresDe(ind, ["capex", "jurosPagos", "proventosPagos"]), [DFC_RAIA.capex, DFC_RAIA.juros, DFC_RAIA.proventos]);
  });

  test("os juros pagos não levam os 478.616 de juros de arrendamento", () => {
    assert.deepEqual(classes.jurosPagos.linhas.map((l) => [l.conta, l.descricao, l.valor]), [["6.01.03.01", "Juros Pagos", -469_833]]);
    assert.deepEqual(classes.jurosArrendamento.linhas.map((l) => [l.conta, l.valor]), [["6.01.03.03", -478_616]]);
  });

  test("principal de arrendamento 921.184", () => {
    assert.equal(classes.principalArrendamento.soma, -921_184);
  });

  test("FCL 1.027.677 e, depois dos arrendamentos, 106.493 (os números do docs/cvm.md)", () => {
    assert.equal(ind.fco.valor, 2_430_654);
    assert.equal(ind.fcl.valor, 1_027_677);
    assert.equal(ind.fclAposArrendamentos.valor, 106_493);
  });

  test("os juros de arrendamento estão no FCO: não são descontados de novo", () => {
    assert.equal(fluxosClassificados(periodo(RAIA, "2025-12-31")).jurosArrendamentoNoFcf.valor, 0);
    assert.equal(ind.fclAposArrendamentos.valor, 2_430_654 - 1_402_977 - 921_184);
  });

  test("bate com o release pré-IFRS 16: FCO − principal = 1.509.470, e o FCL de lá é o nosso depois dos arrendamentos", () => {
    assert.equal(ind.fco.valor - 921_184, DFC_RAIA.fcoPreIfrs16);
    assert.equal(DFC_RAIA.fcoPreIfrs16 - DFC_RAIA.capex, ind.fclAposArrendamentos.valor);
  });

  test("D&A da DFC 2.074.779, sem a amortização de custos de transação de debêntures (9.279)", () => {
    assert.deepEqual(classes.daDfc.linhas.map((l) => [l.descricao, l.valor]), [["Depreciações e Amortizações", 2_074_779]]);
    assert.equal(classes.daDfc.soma, 2_074_779);
    assert.equal(dfcDe(RAIA, "2025-12-31").find((l) => l.descricao === "Amortizações de Custos de Transação de Debêntures").valor, 9_279);
  });

  test("ações e lucro por ação com o lucro da controladora", () => {
    const acoes = ano(RAIA, "2025-12-31").composicao.acoesCirculacao;
    assert.equal(ind.acoesCirculacao.valor, acoes);
    const lucroControladora = periodo(RAIA, "2025-12-31").demonstrativos.DRE.contas.find((c) => c.conta === "3.11.01").valor;
    assert.equal(ind.lucroPorAcao.valor, (lucroControladora * 1000) / acoes);
  });
});

describe("São Martinho e Hapvida", () => {
  test("São Martinho: diluição negativa em 31/03/2026 (recompra) e FCL depois dos arrendamentos", () => {
    const x = ano(SAO_MARTINHO, "2026-03-31");
    const antes = ano(SAO_MARTINHO, "2025-03-31").composicao.acoesCirculacao;
    assert.equal(x.indicadores.diluicao.valor, x.composicao.acoesCirculacao / antes - 1);
    assert.ok(x.indicadores.diluicao.valor < 0);
    assert.ok(x.indicadores.fclAposArrendamentos.valor < x.indicadores.fcl.valor);
  });

  test("São Martinho, 12 meses: a linha de proventos some no ITR de 30/06/2026, e o resultado é null com o motivo", () => {
    assert.deepEqual(SAO_MARTINHO.indicadores.doze.indicadores.proventosPagos, { valor: null, motivo: "a linha de proventos pagos não foi identificada no ITR de 30/06/2026" });
    assert.ok(SAO_MARTINHO.indicadores.doze.indicadores.capex.valor > 0);
  });

  test("Hapvida 2023: a D&A da DFC (1.625.121) é mais de três vezes a da DVA (483.365), e é ela que entra no EBITDA", () => {
    const p = periodo(HAPVIDA, "2023-12-31");
    assert.equal(fluxosClassificados(p).daDfc.valor, 1_625_121);
    assert.equal(p.demonstrativos.DVA.contas.find((c) => c.conta === "7.04.01").valor, -483_365);
    const ind = ano(HAPVIDA, "2023-12-31").indicadores;
    assert.deepEqual(ind.da, { valor: 1_625_121, motivo: null, origem: "DFC" });
    assert.equal(ind.ebitda.valor, 1_171_657 + 1_625_121);
  });
});

describe("escala da composição do capital: unidades ou milhares de ações", () => {
  // O arquivo não tem coluna de escala. Totais e lucros abaixo são os da DFP de 2025 (R$ mil e R$ por ação).
  test("WEG informa em unidades: o lucro por ação informado fecha com o total", () => {
    assert.deepEqual(escalaDasAcoes({ acoesTotal: 4_197_317_998, lucro: 6_376_219, lucroPorAcaoInformado: 1.51971 }), { escala: "unidade", por: "lucro por ação informado" });
  });

  test("Vale informa em milhares: 4.539.007 no arquivo, 4,5 bilhões de ações de verdade", () => {
    assert.deepEqual(escalaDasAcoes({ acoesTotal: 4_539_007, lucro: 13_814_000, lucroPorAcaoInformado: 3.24 }), { escala: "mil", por: "lucro por ação informado" });
  });

  test("Ambev (15.761.639, em milhares) e Eneva (1.936.974, com o lucro por ação arredondado para 1)", () => {
    assert.equal(escalaDasAcoes({ acoesTotal: 15_761_639, lucro: 15_503_400, lucroPorAcaoInformado: 0.9926913764 }).escala, "mil");
    assert.equal(escalaDasAcoes({ acoesTotal: 1_936_974, lucro: 1_157_575, lucroPorAcaoInformado: 1 }).escala, "mil");
  });

  test("prejuízo: lucro e lucro por ação negativos também resolvem", () => {
    assert.deepEqual(escalaDasAcoes({ acoesTotal: 562_827, lucro: -1_042_256, lucroPorAcaoInformado: -1.85183 }), { escala: "mil", por: "lucro por ação informado" }); // MRV
    assert.equal(escalaDasAcoes({ acoesTotal: 1_253_079_108, lucro: -3_078_192, lucroPorAcaoInformado: -2.5 }).escala, "unidade"); // Usiminas
  });

  test("a média do período difere do total do fim: a comparação aceita até o dobro ou a metade", () => {
    assert.equal(escalaDasAcoes({ acoesTotal: 3_966_570_932, lucro: -9_722_125, lucroPorAcaoInformado: -3.8919059245 }).por, "lucro por ação informado"); // Cosan, razão 0,63
  });

  test("sem lucro por ação informado, vale a ordem de grandeza: abaixo de 100 milhões está em milhares", () => {
    assert.equal(LIMITE_ACOES_EM_MIL, 100_000_000);
    assert.deepEqual(escalaDasAcoes({ acoesTotal: 3_226_546_622, lucro: 6_167_906, lucroPorAcaoInformado: null }), { escala: "unidade", por: "ordem de grandeza" }); // Vivo
    assert.deepEqual(escalaDasAcoes({ acoesTotal: 380_253 }), { escala: "mil", por: "ordem de grandeza" });
    assert.equal(escalaDasAcoes({ acoesTotal: 99_999_999 }).escala, "mil");
    assert.equal(escalaDasAcoes({ acoesTotal: 100_000_000 }).escala, "unidade");
  });

  test("lucro por ação que não fecha com nenhuma das duas escalas (ou lucro zero): ordem de grandeza", () => {
    assert.deepEqual(escalaDasAcoes({ acoesTotal: 703_773_869, lucro: 0, lucroPorAcaoInformado: 12.37 }), { escala: "unidade", por: "ordem de grandeza" }); // Sabesp: 3.11.01 zerado
    assert.equal(escalaDasAcoes({ acoesTotal: 500_000_000, lucro: 1000, lucroPorAcaoInformado: 2000 }).por, "ordem de grandeza"); // lucro por lote de mil ações
  });

  test("sem total de ações não há escala", () => {
    assert.equal(escalaDasAcoes({ acoesTotal: null, lucro: 1, lucroPorAcaoInformado: 1 }), null);
    assert.equal(escalaDasAcoes({ acoesTotal: 0 }), null);
  });

  test("emUnidades multiplica total, tesouraria e circulação por mil e registra a escala", () => {
    const bruta = { cnpj: "x", dtRefer: "2025-12-31", versao: 1, acoesTotal: 4_539_007, acoesTesouraria: 270_000, acoesCirculacao: 4_269_007 };
    assert.deepEqual(emUnidades(bruta, { escala: "mil", por: "lucro por ação informado" }), {
      cnpj: "x", dtRefer: "2025-12-31", versao: 1, acoesTotal: 4_539_007_000, acoesTesouraria: 270_000_000, acoesCirculacao: 4_269_007_000,
      escala: "mil", escalaPor: "lucro por ação informado",
    });
    const unidade = emUnidades(bruta, { escala: "unidade", por: "ordem de grandeza" });
    assert.deepEqual([unidade.acoesTotal, unidade.escala], [4_539_007, "unidade"]);
    assert.equal(emUnidades(null, { escala: "mil" }), null);
    assert.equal(emUnidades({ ...bruta, acoesCirculacao: null }, { escala: "mil", por: "x" }).acoesCirculacao, null);
  });

  test("na série, a composição sai em unidades e diz a escala e de onde ela veio", () => {
    const c = ano(WEG, "2025-12-31").composicao;
    assert.deepEqual([c.acoesTotal, c.escala, c.escalaPor], [4_197_317_998, "unidade", "lucro por ação informado"]);
    const doze = WEG.indicadores.doze.composicao;
    assert.deepEqual([doze.dtRefer, doze.escala, doze.escalaPor], ["2026-09-30", "unidade", "escala do exercício de 31/12/2025"]);
  });

  test("companhia que informa em milhares: ações, diluição e valores por ação saem na escala certa", () => {
    // O exercício sintético com a composição em milhares: 1.000 = 1 milhão de ações. Lucro da controladora
    // de 90 (R$ mil) e lucro por ação informado de 0,09: 90.000 ÷ 0,09 = 1 milhão de ações.
    const comLpa = (p, fim) => {
      p.fim = fim;
      p.demonstrativos.DRE.contas.push({ conta: "3.99.01.01", descricao: "ON", contaFixa: true, valor: 0.09 });
      return p;
    };
    const series = { cnpj: "00.000.000/0001-00", anual: [comLpa(anual(), "2024-12-31"), comLpa(anual(), "2025-12-31")], doze: doze12() };
    const composicoes = [
      { cnpj: "00.000.000/0001-00", dtRefer: "2024-12-31", versao: 1, acoesTotal: 1000, acoesTesouraria: 0, acoesCirculacao: 1000 },
      { cnpj: "00.000.000/0001-00", dtRefer: "2025-12-31", versao: 1, acoesTotal: 1100, acoesTesouraria: 100, acoesCirculacao: 1000 },
      { cnpj: "00.000.000/0001-00", dtRefer: "2026-06-30", versao: 1, acoesTotal: 1100, acoesTesouraria: 50, acoesCirculacao: 1050 },
      { cnpj: "99.999.999/0001-99", dtRefer: "2025-12-31", versao: 1, acoesTotal: 5, acoesTesouraria: 0, acoesCirculacao: 5 }, // de outra companhia
    ];
    const r = calcularIndicadoresDaSerie(series, { composicoes });
    assert.equal(r.anual[1].composicao.escala, "mil");
    assert.equal(r.anual[1].indicadores.acoesCirculacao.valor, 1_000_000);
    assert.equal(r.anual[1].indicadores.lucroPorAcao.valor, (90 * 1000) / 1_000_000);
    assert.equal(r.anual[1].indicadores.diluicao.valor, 0);
    assert.deepEqual(r.anual[0].indicadores.diluicao, { valor: null, motivo: "primeiro ano da série" });
    assert.deepEqual([r.doze.composicao.escala, r.doze.composicao.escalaPor], ["mil", "escala do exercício de 31/12/2025"]);
    assert.equal(r.doze.indicadores.acoesCirculacao.valor, 1_050_000);
    assert.equal(r.doze.indicadores.fcoPorAcao.valor, (300 * 1000) / 1_050_000);
  });
});

describe("lucro da controladora, para o lucro por ação", () => {
  test("usa o 3.11.01", () => {
    assert.deepEqual(lucroDaControladora(anual()), { valor: 90, motivo: null });
    assert.deepEqual(lucroDaControladora(periodo(WEG, "2025-12-31")), { valor: 6_376_219, motivo: null });
  });

  test("demonstração individual não tem 3.11.01: vale o lucro do período (3.11)", () => {
    const p = anual();
    p.demonstrativos.DRE.contas = p.demonstrativos.DRE.contas.filter((c) => c.conta !== "3.11.01");
    assert.deepEqual(lucroDaControladora(p), { valor: 100, motivo: null });
    assert.equal(calcularIndicadores(p, { composicao: ACOES }).lucroPorAcao.valor, 100);
  });

  test("3.11.01 e 3.11.02 zeradas com lucro no 3.11: não informado, null com motivo (não zero, nem o lucro dos minoritários)", () => {
    const p = anual({ mudancas: { DRE: { "3.11.01": 0, "3.11.02": 0 } } });
    const motivo = "a companhia não abre o lucro entre a controladora e os não controladores";
    assert.deepEqual(lucroDaControladora(p), { valor: null, motivo });
    assert.deepEqual(calcularIndicadores(p, { composicao: ACOES }).lucroPorAcao, { valor: null, motivo });
  });

  test("lucro zero de verdade (3.11 também zero) é zero", () => {
    assert.deepEqual(lucroDaControladora(anual({ mudancas: { DRE: { "3.11": 0, "3.11.01": 0, "3.11.02": 0 } } })), { valor: 0, motivo: null });
  });

  test("controladora zerada com o lucro todo nos não controladores é informação, não falta", () => {
    assert.deepEqual(lucroDaControladora(anual({ mudancas: { DRE: { "3.11": 100, "3.11.01": 0, "3.11.02": 100 } } })), { valor: 0, motivo: null });
  });
});

describe("capex com propriedade para investimento: Allos e Multiplan (linhas da DFP de 2025, R$ mil)", () => {
  // Contas, descrições e valores como estão no dfp_cia_aberta_DFC_MI_con_2025.csv (varredura da #36).
  test("Allos: os shoppings entram no capex, junto do imobilizado e do intangível", () => {
    const { capex } = classificarLinhas([
      L("6.02.02", "Pagamentos para aquisição de propriedades para  investimentos (shopping centers)", -386_081),
      L("6.02.03", "Pagamentos para aquisição de ativo imobilizado", -10),
      L("6.02.04", "Pagamentos para aquisição de ativo intangível", -20),
    ]);
    assert.deepEqual(capex.linhas.map((l) => l.conta), ["6.02.02", "6.02.03", "6.02.04"]);
    assert.equal(capex.soma, -386_081 - 30);
    assert.ok(capex.linhas.every((l) => !("mista" in l)));
  });

  test("Multiplan: as adições entram; a baixa de propriedade para investimento e a baixa de intangível ficam de fora", () => {
    const { capex } = classificarLinhas([
      L("6.02.06", "Adições em Propriedades para investimento", -730_408),
      L("6.02.08", "Baixas em Propriedade para investimento", 57_465),
      L("6.02.16", "Baixa em intangível", 82),
    ]);
    assert.deepEqual(capex.linhas.map((l) => [l.conta, l.valor]), [["6.02.06", -730_408]]);
  });

  test("a linha da CSN, que antes era mista, agora é capex inteiro", () => {
    const { capex } = classificarLinhas([L("6.02.02", "Aquisição de ativos imobilizados, intangível e propriedade para investimento", -5_935_897)]);
    assert.deepEqual(capex.linhas, [{ conta: "6.02.02", descricao: "Aquisição de ativos imobilizados, intangível e propriedade para investimento", valor: -5_935_897 }]);
  });
});

describe("diluição: variação grande demais sugere desdobramento ou grupamento", () => {
  const diluicao = (antes, depois) => calcularIndicadores(anual(), { composicao: { acoesCirculacao: depois }, composicaoAnterior: { acoesCirculacao: antes } }).diluicao;

  test("o limite é 50%, para cima e para baixo, numa constante", () => {
    assert.equal(LIMITE_DILUICAO, 0.5);
  });

  test("Direcional 2025: de 173.500.000 − 508.138 para 520.500.000 − 1.538.328 ações (desdobramento de 1 para 3): null", () => {
    assert.deepEqual(diluicao(173_500_000 - 508_138, 520_500_000 - 1_538_328), { valor: null, motivo: "variação de +200% sugere desdobramento ou grupamento" });
  });

  test("Hapvida 2025: de 7.539.463.263 − 119.673.213 para 502.630.884 − 27.905.027 ações (grupamento de 15 para 1): null", () => {
    assert.deepEqual(diluicao(7_539_463_263 - 119_673_213, 502_630_884 - 27_905_027), { valor: null, motivo: "variação de -94% sugere desdobramento ou grupamento" });
  });

  test("Hapvida 2023 (fixture): +5,6% de emissão continua saindo", () => {
    const x = ano(HAPVIDA, "2023-12-31");
    assert.ok(Math.abs(x.indicadores.diluicao.valor - 0.0559) < 0.0001, String(x.indicadores.diluicao.valor));
  });

  test("dentro do limite sai o valor; fora dele, ou no −50% de um grupamento de 2 para 1, null", () => {
    assert.deepEqual(diluicao(1000, 1490), { valor: 0.49, motivo: null });
    assert.deepEqual(diluicao(1000, 1500), { valor: 0.5, motivo: null });
    assert.deepEqual(diluicao(1000, 1501), { valor: null, motivo: "variação de +50% sugere desdobramento ou grupamento" });
    assert.deepEqual(diluicao(1000, 2000), { valor: null, motivo: "variação de +100% sugere desdobramento ou grupamento" });
    assert.deepEqual(diluicao(1000, 510), { valor: -0.49, motivo: null });
    assert.deepEqual(diluicao(1000, 500), { valor: null, motivo: "variação de -50% sugere desdobramento ou grupamento" });
    assert.deepEqual(diluicao(1000, 100), { valor: null, motivo: "variação de -90% sugere desdobramento ou grupamento" });
  });

  test("as ações em circulação e os valores por ação continuam saindo quando a diluição fica null", () => {
    const r = calcularIndicadores(anual(), { composicao: { acoesCirculacao: 3000 }, composicaoAnterior: { acoesCirculacao: 1000 } });
    assert.equal(r.diluicao.valor, null);
    assert.equal(r.acoesCirculacao.valor, 3000);
    assert.equal(r.fcoPorAcao.valor, 100);
  });

  test("a fórmula avisa que variação acima de 50% não é mostrada", () => {
    assert.match(INDICADORES.find((i) => i.id === "diluicao").formula, /acima de 50%.*desdobramento ou grupamento/);
  });
});

describe("D&A do EBITDA: a da DFC quando identificada, a da DVA de reserva", () => {
  test("com D&A na DFC e na DVA, vale a da DFC, e a origem diz isso", () => {
    // DFC 50 (sintético); DVA trocada para 30
    const p = anual({ mudancas: { DVA: { "7.04.01": -30 } } });
    const ind = calcularIndicadores(p);
    assert.deepEqual(ind.da, { valor: 50, motivo: null, origem: "DFC" });
    assert.deepEqual(ind.ebitda, { valor: 250, motivo: null });
    assert.equal(ind.margemEbitda.valor, 0.25);
    assert.equal(ind.fcoSobreEbitda.valor, 300 / 250);
  });

  test("sem linha de D&A na DFC, vale a da DVA, com o sinal trocado", () => {
    const p = anual({ dfc: trocar(DFC, "6.01.01.02", null), mudancas: { DVA: { "7.04.01": -30 } } });
    const ind = calcularIndicadores(p);
    assert.deepEqual(ind.da, { valor: 30, motivo: null, origem: "DVA" });
    assert.equal(ind.ebitda.valor, 230);
  });

  test("sem a DFC inteira, vale a DVA", () => {
    const p = anual();
    delete p.demonstrativos.DFC;
    assert.deepEqual(calcularIndicadores(p).da, { valor: 50, motivo: null, origem: "DVA" });
  });

  test("a D&A da DFC entra como vem (é um ajuste positivo); a amortização de custo de transação não entra", () => {
    const dfc = [...DFC, L("6.01.01.11", "Amortizações de Custos de Transação de Debêntures", 9)];
    assert.deepEqual(calcularIndicadores(anual({ dfc })).da, { valor: 50, motivo: null, origem: "DFC" });
  });

  test("sem D&A em nenhuma das duas: null com o motivo da DVA, origem null", () => {
    const p = anual({ dfc: trocar(DFC, "6.01.01.02", null) });
    p.demonstrativos.DVA.contas = [];
    assert.deepEqual(calcularIndicadores(p).da, { valor: null, motivo: "falta a conta 7.04.01 (depreciação e amortização, na DVA)", origem: null });
    assert.equal(calcularIndicadores(p).ebitda.valor, null);
  });

  test("12 meses: D&A da DFC nas três parcelas passa por doze()", () => {
    const ind = calcularIndicadores(doze12());
    assert.deepEqual(ind.da, { valor: 50 * 1.25, motivo: null, origem: "DFC" });
    assert.equal(ind.ebitda.valor, 200 + 62.5);
  });

  test("12 meses: se a D&A da DFC falta em alguma parcela, vale a da DVA", () => {
    const semDa = DFC.filter((l) => !l.contaFixa && l.conta !== "6.01.01.02").map((l) => ({ ...l, valor: l.valor * 0.5 }));
    const ind = calcularIndicadores(doze12({ atualDfc: semDa }));
    assert.deepEqual(ind.da, { valor: 50, motivo: null, origem: "DVA" }); // 7.04.01 de 12 meses = −50
    assert.equal(ind.ebitda.valor, 250);
  });

  test("depreciacaoEAmortizacao funciona sozinha, e diz null no período indisponível", () => {
    assert.deepEqual(depreciacaoEAmortizacao(anual()), { valor: 50, motivo: null, origem: "DFC" });
    assert.deepEqual(depreciacaoEAmortizacao({ tipo: "indisponivel", motivo: "m", fluxos: null }), { valor: null, motivo: "m", origem: null });
  });

  test("WEG 2025: a DFC e a DVA dão 1.001.296, e o EBITDA continua 9.000.037 (o do release, a menos de R$ 1 mil)", () => {
    const ind = ano(WEG, "2025-12-31").indicadores;
    assert.deepEqual(ind.da, { valor: 1_001_296, motivo: null, origem: "DFC" });
    assert.equal(ind.ebitda.valor, 9_000_037);
    assert.ok(Math.abs(ind.ebitda.valor - 9_000_038) <= 1);
  });

  test("Raia 2025: D&A de 2.074.779 pela DFC (2.013.044 na DVA); EBITDA de 4.818.346", () => {
    const ind = ano(RAIA, "2025-12-31").indicadores;
    assert.deepEqual(ind.da, { valor: 2_074_779, motivo: null, origem: "DFC" });
    assert.equal(ind.ebitda.valor, 2_743_567 + 2_074_779);
    assert.equal(periodo(RAIA, "2025-12-31").demonstrativos.DVA.contas.find((c) => c.conta === "7.04.01").valor, -2_013_044);
  });

  test("a fórmula da D&A diz as duas fontes e a ordem", () => {
    const { formula } = INDICADORES.find((i) => i.id === "da");
    assert.match(formula, /DFC/);
    assert.match(formula, /Quando não são identificadas, vale a da DVA \(conta 7\.04\.01\)/);
  });
});
