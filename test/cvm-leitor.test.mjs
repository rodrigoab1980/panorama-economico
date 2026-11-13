import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  DEMONSTRATIVOS, criarLeitor, ehPorAcao, escolherConsolidado, escolherVersao, interpretarArquivo,
  interpretarCabecalho, lerArquivos, limparLinha, linhaParaFato, normalizarValor,
} from "../scripts/cvm/leitor.mjs";

// ---------- fixtures reais (test/fixtures/cvm, recortes byte a byte da CVM) ----------
// A decodificação latin1 fica aqui, na borda. O split é só por "\n": o "\r" do CRLF e a
// última linha vazia chegam ao leitor, como chegariam de um arquivo lido em fluxo.
const DIR = new URL("./fixtures/cvm/", import.meta.url);
const linhasDe = (caminho) => new TextDecoder("latin1").decode(readFileSync(new URL(caminho, DIR))).split("\n");
const lerPasta = (pasta) => lerArquivos(
  readdirSync(new URL(`${pasta}/`, DIR)).map((nome) => ({ nome, linhas: linhasDe(`${pasta}/${nome}`) })),
);

const WEG = lerPasta("weg");
const RAIA = lerPasta("raia-drogasil");
const HAPVIDA = lerPasta("hapvida");

const achar = (fatos, filtro) => fatos.filter((f) => Object.entries(filtro).every(([k, v]) => f[k] === v));
const unico = (fatos, filtro) => {
  const r = achar(fatos, filtro);
  assert.equal(r.length, 1, `esperava 1 fato para ${JSON.stringify(filtro)}, achei ${r.length}`);
  return r[0];
};
// As quatro contas do critério de aceite, no exercício do próprio documento.
const quatroContas = (fatos, dtRefer) => Object.fromEntries(
  [["DRE", "3.01"], ["DRE", "3.11"], ["BPP", "2.03"], ["DFC_MI", "6.01"]].map(([demonstrativo, conta]) =>
    [conta, unico(fatos, { documento: "dfp", dtRefer, demonstrativo, conta, ordem: "ultimo" }).valor]),
);

describe("fixtures reais: valores em R$ mil", () => {
  test("WEG, DFP 2025", () => {
    assert.deepEqual(quatroContas(WEG, "2025-12-31"), { "3.01": 40_804_110, "3.11": 6_775_958, "2.03": 18_553_364, "6.01": 6_451_033 });
  });
  test("Raia Drogasil, DFP 2025", () => {
    assert.deepEqual(quatroContas(RAIA, "2025-12-31"), { "3.01": 44_250_449, "3.11": 1_300_243, "2.03": 7_335_968, "6.01": 2_430_654 });
  });
  test("Hapvida, DFP 2022 e DFP 2023", () => {
    assert.deepEqual(quatroContas(HAPVIDA, "2022-12-31"), { "3.01": 23_748_803, "3.11": -775_839, "2.03": 48_756_711, "6.01": 971_907 });
    assert.deepEqual(quatroContas(HAPVIDA, "2023-12-31"), { "3.01": 27_769_790, "3.11": -757_409, "2.03": 49_255_143, "6.01": 2_334_666 });
  });

  test("o fato sai completo e com os tipos certos (WEG, receita de 2025)", () => {
    assert.deepEqual(unico(WEG, { documento: "dfp", conta: "3.01", ordem: "ultimo" }), {
      cnpj: "84.429.695/0001-11", cdCvm: "005410", documento: "dfp", demonstrativo: "DRE", consolidado: true,
      dtRefer: "2025-12-31", versao: 1, ordem: "ultimo", inicio: "2025-01-01", fim: "2025-12-31",
      conta: "3.01", descricao: "Receita de Venda de Bens e/ou Serviços", contaFixa: true, valor: 40_804_110,
    });
  });

  test("todo valor é inteiro, menos o lucro por ação (3.99.*), que fica em R$ por ação", () => {
    for (const f of [...WEG, ...RAIA, ...HAPVIDA]) {
      if (!ehPorAcao(f.conta)) assert.ok(Number.isInteger(f.valor), `${f.demonstrativo} ${f.conta} = ${f.valor}`);
    }
    const lpa = unico(WEG, { documento: "dfp", conta: "3.99.01.01", ordem: "ultimo" });
    assert.ok(lpa.valor > 0 && lpa.valor < 100 && !Number.isInteger(lpa.valor), `lucro por ação = ${lpa.valor}`);
  });

  test("lê os cinco demonstrativos das fixtures e ignora índice e composição do capital", () => {
    assert.deepEqual([...new Set(WEG.map((f) => f.demonstrativo))].sort(), ["BPA", "BPP", "DFC_MI", "DRE", "DVA"]);
    assert.deepEqual([...new Set(WEG.map((f) => f.documento))].sort(), ["dfp", "itr"]);
  });
});

describe("fixtures reais: PENÚLTIMO preservado e marcado", () => {
  test("os dois exercícios saem, marcados como ultimo e penultimo", () => {
    assert.deepEqual([...new Set(WEG.map((f) => f.ordem))].sort(), ["penultimo", "ultimo"]);
    const receita = achar(WEG, { documento: "dfp", conta: "3.01" });
    assert.deepEqual(receita.map((f) => [f.ordem, f.fim, f.valor]).sort(), [
      ["penultimo", "2024-12-31", 37_986_941], ["ultimo", "2025-12-31", 40_804_110],
    ]);
  });

  test("Hapvida: o lucro de 2022 reapresentado na DFP 2023 difere do original, e os dois ficam", () => {
    const original = unico(HAPVIDA, { dtRefer: "2022-12-31", conta: "3.11", ordem: "ultimo" });
    const reapresentado = unico(HAPVIDA, { dtRefer: "2023-12-31", conta: "3.11", ordem: "penultimo" });
    assert.equal(original.fim, "2022-12-31");
    assert.equal(reapresentado.fim, "2022-12-31");
    assert.equal(original.valor, -775_839);
    assert.equal(reapresentado.valor, -1_718_120);
    assert.equal(reapresentado.versao, 2, "a DFP 2023 da Hapvida está na versão 2");
  });
});

describe("fixtures reais: períodos", () => {
  test("WEG ITR 3T26: a DRE devolve trimestre e acumulado da 3.11, nos dois exercícios", () => {
    const lucro = achar(WEG, { documento: "itr", dtRefer: "2026-09-30", conta: "3.11" }).map((f) => [f.ordem, f.inicio, f.fim, f.valor]).sort();
    assert.deepEqual(lucro, [
      ["penultimo", "2025-01-01", "2025-09-30", 5_074_596],
      ["penultimo", "2025-07-01", "2025-09-30", 1_744_754],
      ["ultimo", "2026-01-01", "2026-09-30", 4_988_916],
      ["ultimo", "2026-07-01", "2026-09-30", 1_762_671],
    ]);
  });

  test("balanço não tem DT_INI_EXERC: inicio é null; DRE, DFC e DVA têm início", () => {
    for (const f of WEG) {
      if (f.demonstrativo === "BPA" || f.demonstrativo === "BPP") assert.equal(f.inicio, null);
      else assert.match(f.inicio, /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.equal(unico(WEG, { documento: "dfp", conta: "1", ordem: "ultimo" }).valor > 0, true);
  });
});

// ---------- casos SINTÉTICOS: linhas escritas à mão, não são dados da CVM ----------
const CAB_DRE = "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_INI_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA";
const CAB_BP = CAB_DRE.replace("DT_INI_EXERC;", "");
const dre = (o = {}) => [
  o.cnpj ?? "11.111.111/0001-11", o.dtRefer ?? "2025-12-31", o.versao ?? "1", "SINTÉTICA S.A.", "099999", "DF - DRE",
  o.moeda ?? "REAL", o.escala ?? "MIL", o.ordem ?? "ÚLTIMO", "2025-01-01", "2025-12-31",
  o.conta ?? "3.01", "Receita", o.valor ?? "1000.0000000000", o.fixa ?? "S",
].join(";");
const arq = (nome, ...linhas) => ({ nome, linhas: [CAB_DRE, ...linhas, ""] });

describe("sintético: escala", () => {
  test("UNIDADE divide por 1.000 e arredonda ao inteiro em R$ mil; MIL fica como está", () => {
    assert.equal(normalizarValor("273505274.0000000000", "MIL"), 273_505_274);
    assert.equal(normalizarValor("1234567890.0000000000", "UNIDADE"), 1_234_568);
    assert.equal(normalizarValor("-1499.0000000000", "UNIDADE"), -1);
    assert.equal(normalizarValor("12.6000000000", "MIL"), 13);
    assert.ok(Object.is(normalizarValor("-0.2000000000", "MIL"), 0), "não devolve -0");
  });

  test("uma linha em UNIDADE vira o mesmo fato que a equivalente em MIL", () => {
    const [f] = lerArquivos([arq("dfp_cia_aberta_DRE_con_2025.csv", dre({ escala: "UNIDADE", valor: "5000000.0000000000" }))]);
    assert.equal(f.valor, 5000);
  });

  test("lucro por ação (3.99.*) não é escalado nem arredondado, em MIL ou UNIDADE", () => {
    const fatos = lerArquivos([arq("dfp_cia_aberta_DRE_con_2025.csv",
      dre({ conta: "3.99.01.01", valor: "1.6148000000" }),
      dre({ cnpj: "22.222.222/0001-22", conta: "3.99.01.01", valor: "1.6148000000", escala: "UNIDADE" }))]);
    assert.deepEqual(fatos.map((f) => f.valor), [1.6148, 1.6148]);
    assert.equal(ehPorAcao("3.99"), true);
    assert.equal(ehPorAcao("3.09"), false);
  });

  test("valor não numérico e escala desconhecida dão erro com arquivo e linha, não NaN", () => {
    const nome = "dfp_cia_aberta_DRE_con_2025.csv";
    for (const valor of ["", "abc", "1,5", "NaN", "1e3"]) {
      assert.throws(() => lerArquivos([arq(nome, dre(), dre({ valor }))]), new RegExp(`${nome}:3: VL_CONTA não numérico`), `"${valor}"`);
    }
    assert.throws(() => lerArquivos([arq(nome, dre({ escala: "MILHAO" }))]), /:2: ESCALA_MOEDA desconhecida: "MILHAO"/);
    assert.throws(() => lerArquivos([arq(nome, dre({ moeda: "DOLAR" }))]), /:2: MOEDA desconhecida: "DOLAR"/);
  });
});

describe("sintético: versão", () => {
  test("com duas versões do mesmo documento, fica só a maior", () => {
    const fatos = lerArquivos([arq("dfp_cia_aberta_DRE_con_2025.csv",
      dre({ versao: "1", valor: "100.0000000000" }), dre({ versao: "2", valor: "120.0000000000" }),
      dre({ versao: "1", conta: "3.11", valor: "10.0000000000" }))]);
    assert.deepEqual(fatos.map((f) => [f.conta, f.versao, f.valor]), [["3.01", 2, 120]]);
  });

  test("a versão é escolhida por documento: outro dtRefer ou outra empresa não interferem", () => {
    const fatos = escolherVersao([
      { cnpj: "A", documento: "dfp", dtRefer: "2025-12-31", versao: 1 },
      { cnpj: "A", documento: "dfp", dtRefer: "2025-12-31", versao: 3 },
      { cnpj: "A", documento: "dfp", dtRefer: "2024-12-31", versao: 1 },
      { cnpj: "A", documento: "itr", dtRefer: "2025-12-31", versao: 2 },
      { cnpj: "B", documento: "dfp", dtRefer: "2025-12-31", versao: 1 },
    ]);
    assert.deepEqual(fatos.map((f) => `${f.cnpj} ${f.documento} ${f.dtRefer} v${f.versao}`), [
      "A dfp 2025-12-31 v3", "A dfp 2024-12-31 v1", "A itr 2025-12-31 v2", "B dfp 2025-12-31 v1",
    ]);
  });
});

describe("sintético: consolidado × individual", () => {
  const SO_IND = "33.333.333/0001-33";

  test("empresa só com individual: os fatos ficam, marcados consolidado: false", () => {
    const fatos = lerArquivos([arq("dfp_cia_aberta_DRE_ind_2025.csv", dre({ cnpj: SO_IND }))]);
    assert.equal(fatos.length, 1);
    assert.equal(fatos[0].consolidado, false);
  });

  test("com consolidado no documento, o individual sai inteiro, mesmo em conta que só ele tem", () => {
    const fatos = lerArquivos([
      arq("dfp_cia_aberta_DRE_con_2025.csv", dre({ valor: "900.0000000000" })),
      arq("dfp_cia_aberta_DRE_ind_2025.csv", dre({ valor: "500.0000000000" }), dre({ conta: "3.02", valor: "7.0000000000" }), dre({ cnpj: SO_IND })),
    ]);
    assert.deepEqual(fatos.map((f) => [f.cnpj, f.conta, f.consolidado, f.valor]), [
      ["11.111.111/0001-11", "3.01", true, 900], [SO_IND, "3.01", false, 1000],
    ]);
  });

  test("a escolha é por documento: consolidado em 2025 não apaga o individual de 2024", () => {
    const base = { cnpj: "A", documento: "dfp" };
    const fatos = escolherConsolidado([
      { ...base, dtRefer: "2025-12-31", consolidado: true },
      { ...base, dtRefer: "2025-12-31", consolidado: false },
      { ...base, dtRefer: "2024-12-31", consolidado: false },
    ]);
    assert.deepEqual(fatos.map((f) => `${f.dtRefer} ${f.consolidado}`), ["2025-12-31 true", "2024-12-31 false"]);
  });
});

describe("sintético: linhas e cabeçalho", () => {
  const nome = "itr_cia_aberta_DRE_con_2026.csv";

  test("linha malformada dá erro com o arquivo e o número da linha", () => {
    assert.throws(() => lerArquivos([arq(nome, dre(), dre(), `${dre()};sobra`)]), new RegExp(`${nome}:4: linha malformada: 16 colunas, o cabeçalho tem 15`));
    assert.throws(() => lerArquivos([arq(nome, "só;três;colunas")]), /:2: linha malformada: 3 colunas/);
  });

  test("texto decodificado errado (utf-8 em vez de latin1) é recusado, com a dica", () => {
    const errado = new TextDecoder("utf-8").decode(Buffer.from(dre(), "latin1"));
    assert.throws(() => lerArquivos([arq(nome, errado)]), /ORDEM_EXERC desconhecida.*latin1/);
  });

  test("data, versão e conta fixa inválidas dão erro", () => {
    assert.throws(() => lerArquivos([arq(nome, dre({ dtRefer: "31/12/2025" }))]), /DT_REFER inválida/);
    assert.throws(() => lerArquivos([arq(nome, dre({ versao: "x" }))]), /VERSAO inválida/);
    assert.throws(() => lerArquivos([arq(nome, dre({ fixa: "" }))]), /ST_CONTA_FIXA inválida/);
  });

  test("CRLF e linhas vazias: o \\r some e a linha vazia do fim é ignorada", () => {
    assert.equal(limparLinha("a;b\r"), "a;b");
    const ler = criarLeitor(nome);
    assert.equal(ler(`${CAB_DRE}\r`), null);
    assert.equal(ler(`${dre()}\r`).contaFixa, true);
    assert.equal(ler("\r"), null);
    assert.equal(ler(""), null);
  });

  test("colunas vêm do cabeçalho: mesma linha de balanço lida em outra ordem de colunas", () => {
    const cab = interpretarCabecalho(CAB_BP);
    assert.equal(cab.colunas, 14);
    const origem = interpretarArquivo("dfp_cia_aberta_BPP_con_2025.csv");
    const linha = "11.111.111/0001-11;2025-12-31;1;SINTÉTICA S.A.;099999;DF - BP;REAL;MIL;PENÚLTIMO;2024-12-31;2.03;PL;77.0000000000;S";
    const f = linhaParaFato(cab, linha, origem);
    assert.deepEqual([f.inicio, f.fim, f.conta, f.valor, f.ordem], [null, "2024-12-31", "2.03", 77, "penultimo"]);

    const invertido = interpretarCabecalho("VL_CONTA;CD_CONTA;" + CAB_BP.replace(";CD_CONTA", "").replace(";VL_CONTA", ""));
    const mesma = "77.0000000000;2.03;11.111.111/0001-11;2025-12-31;1;SINTÉTICA S.A.;099999;DF - BP;REAL;MIL;PENÚLTIMO;2024-12-31;PL;S";
    assert.deepEqual(linhaParaFato(invertido, mesma, origem), f);
  });

  test("cabeçalho sem coluna obrigatória dá erro dizendo qual falta", () => {
    assert.throws(() => interpretarCabecalho("CNPJ_CIA;DT_REFER", { arquivo: "x.csv", linha: 1 }), /x\.csv:1: cabeçalho sem a\(s\) coluna\(s\) VERSAO, CD_CVM/);
  });
});

describe("interpretarArquivo", () => {
  test("tira documento, demonstrativo e consolidado do nome, com ou sem pasta", () => {
    assert.deepEqual(interpretarArquivo("dfp_cia_aberta_DFC_MI_con_2025.csv"), { documento: "dfp", demonstrativo: "DFC_MI", consolidado: true, ano: 2025 });
    assert.deepEqual(interpretarArquivo("C:\\x\\itr_cia_aberta_BPA_ind_2011.csv"), { documento: "itr", demonstrativo: "BPA", consolidado: false, ano: 2011 });
    for (const d of DEMONSTRATIVOS) assert.equal(interpretarArquivo(`a/b/dfp_cia_aberta_${d}_con_2020.csv`).demonstrativo, d);
  });

  test("arquivos fora do escopo devolvem null e criarLeitor os recusa", () => {
    for (const n of ["dfp_cia_aberta_2025.csv", "dfp_cia_aberta_composicao_capital_2025.csv", "dfp_cia_aberta_DMPL_con_2025.csv", "dfp_cia_aberta_DRA_con_2025.csv", "fca_cia_aberta_geral_2025.csv"]) {
      assert.equal(interpretarArquivo(n), null, n);
    }
    assert.throws(() => criarLeitor("dfp_cia_aberta_2025.csv"), /não é um demonstrativo/);
  });
});
