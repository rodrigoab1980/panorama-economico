import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { interpretarArquivo, lerArquivos } from "../scripts/cvm/leitor.mjs";
import {
  base12Meses, classificarIntervalo, diasDoIntervalo, doze, escolherOrigem, intervaloAcumulado,
  mesmoIntervaloUmAnoAntes, montarSeries, serieAnual, somarDias, umAnoAntes, valorDaConta,
} from "../scripts/cvm/series.mjs";

// ---------- fixtures reais (test/fixtures/cvm), lidas pelo leitor da #31 ----------
const DIR = new URL("./fixtures/cvm/", import.meta.url);
const fatosDe = (pasta) => lerArquivos(readdirSync(new URL(`${pasta}/`, DIR)).filter((n) => interpretarArquivo(n))
  .map((nome) => ({ nome, linhas: new TextDecoder("latin1").decode(readFileSync(new URL(`${pasta}/${nome}`, DIR))).split("\n") })));

const WEG = montarSeries(fatosDe("weg"));
const SAO_MARTINHO = montarSeries(fatosDe("sao-martinho"));
const HAPVIDA = montarSeries(fatosDe("hapvida"));
const RAIA = montarSeries(fatosDe("raia-drogasil"));

const periodo = (serie, fim) => serie.anual.find((p) => p.fim === fim);
const parcelas = (serie, conta) => {
  const f = serie.doze.fluxos[conta];
  return [f.anual, f.acumuladoAtual, f.acumuladoAnterior, f.valor];
};

describe("WEG: base de 12 meses no 3T26 (parcelas conferidas no arquivo, R$ mil)", () => {
  test("lucro (3.11): 6.775.958 + 4.988.916 − 5.074.596 = 6.690.278", () => {
    assert.deepEqual(parcelas(WEG, "3.11"), [6_775_958, 4_988_916, 5_074_596, 6_690_278]);
  });
  test("receita (3.01): 40.804.110 + 30.472.677 − 30.557.320 = 40.719.467", () => {
    assert.deepEqual(parcelas(WEG, "3.01"), [40_804_110, 30_472_677, 30_557_320, 40_719_467]);
  });
  test("EBIT (3.05): 7.998.741 + 5.887.920 − 6.002.174 = 7.884.487", () => {
    assert.deepEqual(parcelas(WEG, "3.05"), [7_998_741, 5_887_920, 6_002_174, 7_884_487]);
  });
  test("FCO (6.01): 6.451.033 + 3.872.617 − 4.238.331 = 6.085.319", () => {
    assert.deepEqual(parcelas(WEG, "6.01"), [6_451_033, 3_872_617, 4_238_331, 6_085_319]);
  });
  test("demais contas da tabela do checkpoint: 3.03, 3.06, 6.02 e 6.03", () => {
    assert.deepEqual(parcelas(WEG, "3.03"), [13_681_633, 9_938_884, 10_200_149, 13_420_368]);
    assert.deepEqual(parcelas(WEG, "3.06"), [148_936, 87_371, 81_063, 155_244]);
    assert.deepEqual(parcelas(WEG, "6.02"), [-2_910_810, -2_049_710, -2_043_141, -2_917_379]);
    assert.deepEqual(parcelas(WEG, "6.03"), [-4_362_857, -2_408_533, -2_759_335, -4_012_055]);
  });

  test("o bloco diz de onde vem cada parcela, com as datas", () => {
    assert.equal(WEG.doze.tipo, "itr");
    assert.equal(WEG.doze.motivo, null);
    assert.equal(WEG.doze.fim, "2026-09-30");
    assert.deepEqual(WEG.doze.parcelas, {
      anual: { inicio: "2025-01-01", fim: "2025-12-31", documento: "dfp", dtRefer: "2025-12-31", versao: 1, ordem: "ultimo", consolidado: true },
      acumuladoAtual: { inicio: "2026-01-01", fim: "2026-09-30", documento: "itr", dtRefer: "2026-09-30", versao: 1, ordem: "ultimo", consolidado: true },
      acumuladoAnterior: { inicio: "2025-01-01", fim: "2025-09-30", documento: "itr", dtRefer: "2025-09-30", versao: 1, ordem: "ultimo", consolidado: true },
    });
  });

  test("o acumulado anterior vem do ITR de 30/09/2025 como entregue, não do PENÚLTIMO do ITR de 2026", () => {
    const { acumuladoAnterior } = WEG.doze.parcelas;
    assert.deepEqual([acumuladoAnterior.dtRefer, acumuladoAnterior.ordem], ["2025-09-30", "ultimo"]);
    // Os valores usados são os do documento de 2025 (aqui coincidem com o PENÚLTIMO de 2026: a WEG não reapresentou).
    const de2025 = (conta) => fatosDe("weg").find((f) => f.documento === "itr" && f.dtRefer === "2025-09-30" && f.ordem === "ultimo" && f.inicio === "2025-01-01" && f.conta === conta).valor;
    for (const conta of ["3.01", "3.05", "3.11", "6.01"]) assert.equal(WEG.doze.fluxos[conta].acumuladoAnterior, de2025(conta), conta);
  });

  test("usa o acumulado de 9 meses, não o trimestre (a DRE do ITR traz os dois)", () => {
    assert.notEqual(WEG.doze.fluxos["3.11"].acumuladoAtual, 1_762_671); // 1.762.671 é só o 3º trimestre
  });

  test("estoque é a posição do ITR mais recente, sem soma: PL (2.03) em 30/09/2026", () => {
    assert.equal(WEG.doze.estoques.data, "2026-09-30");
    assert.deepEqual(WEG.doze.estoques.contas["2.03"], { demonstrativo: "BPP", descricao: "Patrimônio Líquido Consolidado", valor: 21_367_143 });
    assert.equal(WEG.doze.estoques.origem.documento, "itr");
  });

  test("só contas fixas entram, e o lucro por ação (3.99.*) fica de fora", () => {
    const contas = Object.keys(WEG.doze.fluxos);
    assert.ok(contas.includes("7.04.01"));
    assert.ok(!contas.some((c) => c.startsWith("3.99")));
    const fixas = new Set(fatosDe("weg").filter((f) => f.contaFixa).map((f) => f.conta));
    for (const c of contas) assert.ok(fixas.has(c), `${c} não é conta fixa`);
    assert.ok(!contas.some((c) => c.startsWith("6.02.") || c.startsWith("6.03.")), "as linhas de investimento e financiamento não têm código fixo");
  });
});

describe("WEG: série anual", () => {
  test("2025 vem da própria DFP; 2024 vem do PENÚLTIMO dela, sem original para comparar", () => {
    assert.deepEqual(WEG.anual.map((p) => [p.inicio, p.fim, p.tipo, p.meses]), [
      ["2024-01-01", "2024-12-31", "anual", 12], ["2025-01-01", "2025-12-31", "anual", 12],
    ]);
    assert.deepEqual(periodo(WEG, "2025-12-31").demonstrativos.DRE.origem, { documento: "dfp", dtRefer: "2025-12-31", versao: 1, ordem: "ultimo", consolidado: true, reapresentado: false });
    assert.deepEqual(periodo(WEG, "2024-12-31").demonstrativos.DRE.origem, { documento: "dfp", dtRefer: "2025-12-31", versao: 1, ordem: "penultimo", consolidado: true, reapresentado: null });
  });

  test("valores anuais da tabela do checkpoint (R$ mil)", () => {
    const linha = (fim) => {
      const d = periodo(WEG, fim).demonstrativos;
      return [valorDaConta(d.DRE, "3.01"), valorDaConta(d.DRE, "3.03"), valorDaConta(d.DRE, "3.05"), valorDaConta(d.DRE, "3.06"), valorDaConta(d.DRE, "3.11"),
        valorDaConta(d.BPP, "2.03"), valorDaConta(d.DFC, "6.01"), valorDaConta(d.DFC, "6.02"), valorDaConta(d.DFC, "6.03")];
    };
    assert.deepEqual(linha("2024-12-31"), [37_986_941, 12_813_845, 7_690_528, 217_980, 6_318_763, 23_125_217, 7_252_269, -4_094_629, -2_764_198]);
    assert.deepEqual(linha("2025-12-31"), [40_804_110, 13_681_633, 7_998_741, 148_936, 6_775_958, 18_553_364, 6_451_033, -2_910_810, -4_362_857]);
  });

  test("cada demonstrativo do período tem origem; a DFC informa o método", () => {
    const d = periodo(WEG, "2025-12-31").demonstrativos;
    assert.deepEqual(Object.keys(d).sort(), ["BPA", "BPP", "DFC", "DRE", "DVA"]);
    assert.equal(d.DFC.metodo, "MI");
    assert.equal(d.BPP.inicio, null);
  });
});

describe("São Martinho: período é data (exercício de abril a março)", () => {
  test("a série anual é indexada pelo fim do exercício, 31/03, com 12 meses cada", () => {
    assert.deepEqual(SAO_MARTINHO.anual.map((p) => [p.inicio, p.fim, p.tipo, p.meses]), [
      ["2023-04-01", "2024-03-31", "anual", 12], ["2024-04-01", "2025-03-31", "anual", 12], ["2025-04-01", "2026-03-31", "anual", 12],
    ]);
  });

  test("12 meses até 30/06/2026, receita (3.01): 7.431.765 + 1.527.994 − 1.857.161 = 7.102.598", () => {
    assert.deepEqual(parcelas(SAO_MARTINHO, "3.01"), [7_431_765, 1_527_994, 1_857_161, 7_102_598]);
  });
  test("12 meses até 30/06/2026, lucro (3.11): 836.177 + 38.149 − 62.829 = 811.497", () => {
    assert.deepEqual(parcelas(SAO_MARTINHO, "3.11"), [836_177, 38_149, 62_829, 811_497]);
  });
  test("12 meses até 30/06/2026, FCO (6.01): 3.224.879 + 219.285 − 584.725 = 2.859.439", () => {
    assert.deepEqual(parcelas(SAO_MARTINHO, "6.01"), [3_224_879, 219_285, 584_725, 2_859_439]);
  });

  test("o encaixe DFP → ITR usa as datas: exercício até 31/03 e ITR que começa em 01/04", () => {
    const { anual, acumuladoAtual, acumuladoAnterior } = SAO_MARTINHO.doze.parcelas;
    assert.deepEqual([anual.inicio, anual.fim], ["2025-04-01", "2026-03-31"]);
    assert.deepEqual([acumuladoAtual.inicio, acumuladoAtual.fim], ["2026-04-01", "2026-06-30"]);
    assert.deepEqual([acumuladoAnterior.inicio, acumuladoAnterior.fim], ["2025-04-01", "2025-06-30"]);
    assert.deepEqual([acumuladoAnterior.dtRefer, acumuladoAnterior.ordem], ["2025-06-30", "ultimo"], "vem do ITR de 30/06/2025 como entregue");
    assert.equal(acumuladoAtual.inicio, somarDias(anual.fim, 1));
  });

  test("primeiro trimestre do exercício: trimestre e acumulado são o mesmo intervalo, e a conta fecha", () => {
    const c = classificarIntervalo({ documento: "itr", inicio: "2026-04-01", fim: "2026-06-30" });
    assert.deepEqual([c.tipo, c.meses], ["trimestre", 3]);
    assert.equal(SAO_MARTINHO.doze.tipo, "itr");
  });

  test("exercício até 03/2025: vem da DFP seguinte e, comparado com o original, não mudou", () => {
    const dre = periodo(SAO_MARTINHO, "2025-03-31").demonstrativos.DRE;
    assert.deepEqual(dre.origem, { documento: "dfp", dtRefer: "2026-03-31", versao: 1, ordem: "penultimo", consolidado: true, reapresentado: false });
    assert.equal(dre.originais, undefined);
    assert.equal(valorDaConta(dre, "3.11"), 556_731);
  });

  test("PL (2.03) na posição de 30/06/2026", () => {
    assert.equal(SAO_MARTINHO.doze.estoques.contas["2.03"].valor, 7_375_591);
  });
});

describe("Hapvida: reapresentação", () => {
  const p2022 = periodo(HAPVIDA, "2022-12-31");

  test("o anual de 2022 sai da DFP 2023, marcado como reapresentado: lucro de −1.718.120", () => {
    assert.deepEqual(p2022.demonstrativos.DRE.origem, { documento: "dfp", dtRefer: "2023-12-31", versao: 2, ordem: "penultimo", consolidado: true, reapresentado: true });
    assert.equal(valorDaConta(p2022.demonstrativos.DRE, "3.11"), -1_718_120);
  });

  test("guarda o original das contas fixas que mudaram: lucro era −775.839", () => {
    const { originais } = p2022.demonstrativos.DRE;
    assert.equal(originais["3.11"], -775_839);
    assert.equal(originais["3.01"], 23_748_803);
    assert.equal(originais["3.03"], 5_655_096);
    for (const [conta, antes] of Object.entries(originais)) assert.notEqual(antes, valorDaConta(p2022.demonstrativos.DRE, conta), conta);
  });

  test("a origem é do demonstrativo inteiro: todas as contas da DRE de 2022 vêm da DFP 2023", () => {
    const daDfp2023 = fatosDe("hapvida").filter((f) => f.dtRefer === "2023-12-31" && f.demonstrativo === "DRE" && f.ordem === "penultimo");
    assert.equal(p2022.demonstrativos.DRE.contas.length, daDfp2023.length);
    assert.deepEqual(p2022.demonstrativos.DRE.contas.map((c) => [c.conta, c.valor]), daDfp2023.map((f) => [f.conta, f.valor]));
    // O lucro bruto reapresentado é −1.139: é o que a CVM traz, e combina com o resto do mesmo documento.
    assert.equal(valorDaConta(p2022.demonstrativos.DRE, "3.03"), -1_139);
    assert.equal(valorDaConta(p2022.demonstrativos.DRE, "3.01") + valorDaConta(p2022.demonstrativos.DRE, "3.02"), -1_139);
  });

  test("o anual de 2023 sai da própria DFP 2023", () => {
    const dre = periodo(HAPVIDA, "2023-12-31").demonstrativos.DRE;
    assert.deepEqual(dre.origem, { documento: "dfp", dtRefer: "2023-12-31", versao: 2, ordem: "ultimo", consolidado: true, reapresentado: false });
    assert.equal(valorDaConta(dre, "3.11"), -757_409);
  });

  test("2021 só existe como PENÚLTIMO da DFP 2022: reapresentado é null (não há original)", () => {
    assert.equal(periodo(HAPVIDA, "2021-12-31").demonstrativos.DRE.origem.reapresentado, null);
  });
});

describe("último documento é a DFP: 12 meses = ano fechado", () => {
  test("Raia Drogasil: os 12 meses são o exercício de 2025, marcado como ano fechado", () => {
    assert.equal(RAIA.doze.tipo, "ano-fechado");
    assert.equal(RAIA.doze.fim, "2025-12-31");
    assert.deepEqual(parcelas(RAIA, "3.01"), [44_250_449, null, null, 44_250_449]);
    assert.deepEqual(parcelas(RAIA, "6.01"), [2_430_654, null, null, 2_430_654]);
    assert.deepEqual(RAIA.doze.parcelas.acumuladoAtual, null);
    assert.equal(RAIA.doze.estoques.contas["2.03"].valor, 7_335_968);
  });
  test("Hapvida: idem, com a DFP 2023", () => {
    assert.equal(HAPVIDA.doze.tipo, "ano-fechado");
    assert.equal(HAPVIDA.doze.fluxos["3.11"].valor, -757_409);
  });
});

// ---------- casos SINTÉTICOS: fatos escritos à mão, não são dados da CVM ----------
const CNPJ = "11.111.111/0001-11";
const fato = (o) => ({
  cnpj: CNPJ, cdCvm: "099999", documento: "dfp", demonstrativo: "DRE", consolidado: true, versao: 1, ordem: "ultimo",
  descricao: "Sintética", contaFixa: true, conta: "3.11", ...o, dtRefer: o.dtRefer ?? o.fim,
});
// DFP de um exercício: lucro e, se pedido, PL.
const dfp = (inicio, fim, lucro, extra = {}) => fato({ inicio, fim, valor: lucro, ...extra });
// Um ITR: o acumulado do período, como entregue (ÚLTIMO).
const umItr = (dtRefer, inicio, valor, extra = {}) => fato({ documento: "itr", dtRefer, inicio, fim: dtRefer, valor, ...extra });
// O ITR atual e o ITR do mesmo período do ano anterior (dois documentos).
const itr = (dtRefer, [iniA, valA], [iniP, fimP, valP], extra = {}) => [umItr(dtRefer, iniA, valA, extra), umItr(fimP, iniP, valP, extra)];

describe("sintético: base de 12 meses", () => {
  const ANUAL = dfp("2025-01-01", "2025-12-31", 1000);

  test("caso normal, para comparar com os demais: 1000 + 300 − 200 = 1100", () => {
    const r = base12Meses([ANUAL, ...itr("2026-06-30", ["2026-01-01", 300], ["2025-01-01", "2025-06-30", 200])]);
    assert.equal(r.tipo, "itr");
    assert.equal(r.fluxos["3.11"].valor, 1100);
  });

  test("ano anterior reapresentado no PENÚLTIMO do ITR atual: vale o valor original, do ITR do ano anterior", () => {
    const r = base12Meses([ANUAL,
      umItr("2026-06-30", "2026-01-01", 300),
      fato({ documento: "itr", dtRefer: "2026-06-30", ordem: "penultimo", inicio: "2025-01-01", fim: "2025-06-30", valor: 150 }), // reapresentado: era 200
      umItr("2025-06-30", "2025-01-01", 200),
    ]);
    assert.equal(r.tipo, "itr");
    assert.deepEqual([r.fluxos["3.11"].anual, r.fluxos["3.11"].acumuladoAtual, r.fluxos["3.11"].acumuladoAnterior, r.fluxos["3.11"].valor], [1000, 300, 200, 1100]);
    assert.deepEqual([r.parcelas.acumuladoAnterior.dtRefer, r.parcelas.acumuladoAnterior.ordem], ["2025-06-30", "ultimo"]);
  });

  test("ITR do ano anterior ausente: null com o motivo, mesmo havendo o PENÚLTIMO no ITR atual", () => {
    const r = base12Meses([ANUAL,
      umItr("2026-06-30", "2026-01-01", 300),
      fato({ documento: "itr", dtRefer: "2026-06-30", ordem: "penultimo", inicio: "2025-01-01", fim: "2025-06-30", valor: 200 }),
    ]);
    assert.equal(r.tipo, "indisponivel");
    assert.equal(r.fluxos, null);
    assert.match(r.motivo, /falta o ITR de 30\/06\/2025/);
  });

  test("troca de individual para consolidado (como a TIM): null com o motivo", () => {
    const ind = { consolidado: false };
    const r = base12Meses([
      dfp("2025-01-01", "2025-12-31", 1000, ind),
      umItr("2025-06-30", "2025-01-01", 200, ind),
      umItr("2026-06-30", "2026-01-01", 300), // consolidado
      fato({ documento: "itr", dtRefer: "2026-06-30", ordem: "penultimo", inicio: "2025-01-01", fim: "2025-06-30", valor: 0 }), // coluna zerada
    ]);
    assert.equal(r.tipo, "indisponivel");
    assert.equal(r.fluxos, null);
    assert.match(r.motivo, /a companhia passou a consolidar: o ITR de 30\/06\/2026 é consolidado, a DFP de 31\/12\/2025 é individual e o ITR de 30\/06\/2025 é individual/);
  });

  test("base diferente em qualquer uma das três parcelas impede a conta", () => {
    const ind = { consolidado: false };
    const soAnteriorInd = base12Meses([ANUAL, umItr("2026-06-30", "2026-01-01", 300), umItr("2025-06-30", "2025-01-01", 200, ind)]);
    assert.match(soAnteriorInd.motivo, /passou a consolidar.*ITR de 30\/06\/2025 é individual/);
    const deixou = base12Meses([ANUAL, umItr("2026-06-30", "2026-01-01", 300, ind), umItr("2025-06-30", "2025-01-01", 200)]);
    assert.match(deixou.motivo, /deixou de consolidar/);
    const tudoInd = base12Meses([dfp("2025-01-01", "2025-12-31", 1000, ind), umItr("2026-06-30", "2026-01-01", 300, ind), umItr("2025-06-30", "2025-01-01", 200, ind)]);
    assert.equal(tudoInd.fluxos["3.11"].valor, 1100, "tudo individual é a mesma base: a conta sai");
    assert.equal(tudoInd.parcelas.anual.consolidado, false);
  });

  test("ITR que não encaixa na DFP (DFP atrasada): null com o motivo, nunca um número", () => {
    const r = base12Meses([dfp("2024-01-01", "2024-12-31", 1000), ...itr("2026-06-30", ["2026-01-01", 300], ["2025-01-01", "2025-06-30", 200])]);
    assert.equal(r.tipo, "indisponivel");
    assert.equal(r.fluxos, null);
    assert.match(r.motivo, /acumula desde 01\/01\/2026, mas a última DFP termina em 31\/12\/2024/);
    assert.equal(r.fim, "2026-06-30");
  });

  test("mudança de exercício: ITR começa em outra data, não encaixa", () => {
    const r = base12Meses([ANUAL, ...itr("2026-09-30", ["2026-04-01", 300], ["2025-04-01", "2025-09-30", 200])]);
    assert.equal(r.tipo, "indisponivel");
    assert.match(r.motivo, /não encaixam/);
  });

  test("acumulado anterior de outro intervalo: null com o motivo", () => {
    const r = base12Meses([ANUAL, ...itr("2026-06-30", ["2026-01-01", 300], ["2025-04-01", "2025-06-30", 200])]);
    assert.equal(r.tipo, "indisponivel");
    assert.match(r.motivo, /não é o mesmo intervalo/);
  });

  test("exercício de transição de 9 meses na última DFP: entra na série marcado, e os 12 meses ficam null", () => {
    const transicao = dfp("2025-04-01", "2025-12-31", 700);
    const [p] = serieAnual([transicao]);
    assert.deepEqual([p.tipo, p.meses, p.dias], ["transicao", 9, 275]);
    const fechado = base12Meses([transicao]);
    assert.equal(fechado.tipo, "indisponivel");
    assert.match(fechado.motivo, /cobre 9 meses/);
    const comItr = base12Meses([transicao, ...itr("2026-03-31", ["2026-01-01", 300], ["2025-01-01", "2025-03-31", 200])]);
    assert.equal(comItr.tipo, "indisponivel");
    assert.match(comItr.motivo, /cobre 9 meses/);
  });

  test("conta ausente numa das três parcelas: essa conta fica null, as outras saem", () => {
    const receita = { conta: "3.01" };
    const r = base12Meses([
      ANUAL, dfp("2025-01-01", "2025-12-31", 5000, receita),
      ...itr("2026-06-30", ["2026-01-01", 300], ["2025-01-01", "2025-06-30", 200]),
      umItr("2026-06-30", "2026-01-01", 2600, receita), // sem a receita no ITR do ano anterior
    ]);
    assert.equal(r.fluxos["3.11"].valor, 1100);
    assert.deepEqual(r.fluxos["3.01"], { demonstrativo: "DRE", descricao: "Sintética", valor: null, anual: 5000, acumuladoAtual: 2600, acumuladoAnterior: null });
  });

  test("zero informado é zero, não ausência", () => {
    const r = base12Meses([dfp("2025-01-01", "2025-12-31", 0), ...itr("2026-06-30", ["2026-01-01", 0], ["2025-01-01", "2025-06-30", 0])]);
    assert.equal(r.fluxos["3.11"].valor, 0);
  });

  test("primeiro trimestre: um intervalo só no ITR serve de acumulado", () => {
    const r = base12Meses([ANUAL, ...itr("2026-03-31", ["2026-01-01", 250], ["2025-01-01", "2025-03-31", 240])]);
    assert.equal(r.fluxos["3.11"].valor, 1010);
  });

  test("com trimestre e acumulado no ITR, usa o acumulado dos dois lados", () => {
    const r = base12Meses([ANUAL,
      ...itr("2026-06-30", ["2026-01-01", 300], ["2025-01-01", "2025-06-30", 200]),
      ...itr("2026-06-30", ["2026-04-01", 160], ["2025-04-01", "2025-06-30", 90]), // os trimestres
    ]);
    assert.deepEqual([r.fluxos["3.11"].acumuladoAtual, r.fluxos["3.11"].acumuladoAnterior, r.fluxos["3.11"].valor], [300, 200, 1100]);
  });

  test("sem DFP, só ITR: null com o motivo; sem nenhum documento, também", () => {
    assert.match(base12Meses(itr("2026-06-30", ["2026-01-01", 300], ["2025-01-01", "2025-06-30", 200])).motivo, /não há DFP anterior/);
    assert.match(base12Meses([]).motivo, /sem documentos/);
  });

  test("conta não fixa não entra nos 12 meses (a #36 classifica essas linhas)", () => {
    const naoFixa = { conta: "6.02.01", demonstrativo: "DFC_MI", contaFixa: false };
    const r = base12Meses([ANUAL, dfp("2025-01-01", "2025-12-31", -50, naoFixa),
      ...itr("2026-06-30", ["2026-01-01", 300], ["2025-01-01", "2025-06-30", 200])]);
    assert.deepEqual(Object.keys(r.fluxos), ["3.11"]);
  });
});

describe("sintético: série anual e escolha da origem", () => {
  test("troca de DFC_MI para DFC_MD: o ano antigo fica com a DFC da própria DFP; a DRE vem da seguinte", () => {
    const mi = { demonstrativo: "DFC_MI", conta: "6.01" }, md = { demonstrativo: "DFC_MD", conta: "6.01" };
    const fatos = [
      dfp("2024-01-01", "2024-12-31", 900), dfp("2024-01-01", "2024-12-31", 400, mi),
      dfp("2025-01-01", "2025-12-31", 1000), dfp("2025-01-01", "2025-12-31", 500, md),
      fato({ dtRefer: "2025-12-31", ordem: "penultimo", inicio: "2024-01-01", fim: "2024-12-31", valor: 950 }),
      fato({ dtRefer: "2025-12-31", ordem: "penultimo", inicio: "2024-01-01", fim: "2024-12-31", valor: 410, ...md }),
    ];
    const [a2024, a2025] = serieAnual(fatos);
    assert.deepEqual([a2024.demonstrativos.DFC.metodo, a2024.demonstrativos.DFC.origem.dtRefer, a2024.demonstrativos.DFC.origem.ordem, valorDaConta(a2024.demonstrativos.DFC, "6.01")], ["MI", "2024-12-31", "ultimo", 400]);
    assert.deepEqual([a2024.demonstrativos.DRE.origem.dtRefer, a2024.demonstrativos.DRE.origem.reapresentado, valorDaConta(a2024.demonstrativos.DRE, "3.11")], ["2025-12-31", true, 950]);
    assert.deepEqual(a2024.demonstrativos.DRE.originais, { "3.11": 900 });
    assert.deepEqual([a2025.demonstrativos.DFC.metodo, valorDaConta(a2025.demonstrativos.DFC, "6.01")], ["MD", 500]);
  });

  test("empresa que passou a consolidar: o ano antigo fica com o individual da própria DFP, não com o PENÚLTIMO consolidado zerado", () => {
    const fatos = [
      dfp("2024-01-01", "2024-12-31", 900, { consolidado: false }),
      dfp("2025-01-01", "2025-12-31", 1000),
      fato({ dtRefer: "2025-12-31", ordem: "penultimo", inicio: "2024-01-01", fim: "2024-12-31", valor: 0 }), // consolidado de 2024 não existia
    ];
    const [a2024, a2025] = serieAnual(fatos);
    assert.deepEqual([valorDaConta(a2024.demonstrativos.DRE, "3.11"), a2024.demonstrativos.DRE.origem.consolidado, a2024.demonstrativos.DRE.origem.dtRefer, a2024.demonstrativos.DRE.origem.reapresentado], [900, false, "2024-12-31", false]);
    assert.deepEqual([valorDaConta(a2025.demonstrativos.DRE, "3.11"), a2025.demonstrativos.DRE.origem.consolidado], [1000, true]);
  });

  test("escolherOrigem: por demonstrativo inteiro, com reapresentado true, false ou null", () => {
    const bloco = (o) => ({ familia: "DRE", metodo: null, ordem: "ultimo", inicio: "2024-01-01", fim: "2024-12-31", documento: "dfp", dtRefer: "2024-12-31", versao: 1, consolidado: true,
      contas: [{ conta: "3.01", descricao: "Receita", contaFixa: true, valor: 100 }, { conta: "3.01.01", descricao: "Aberta", contaFixa: false, valor: 60 }], ...o });
    const proprio = bloco({});
    const igual = bloco({ ordem: "penultimo", dtRefer: "2025-12-31" });
    const refeito = bloco({ ordem: "penultimo", dtRefer: "2025-12-31", contas: [{ conta: "3.01", descricao: "Receita", contaFixa: true, valor: 90 }] });

    assert.equal(escolherOrigem(proprio, null).origem.reapresentado, false);
    assert.equal(escolherOrigem(proprio, null).origem.ordem, "ultimo");
    assert.equal(escolherOrigem(proprio, igual).origem.reapresentado, false);
    assert.equal(escolherOrigem(proprio, igual).origem.dtRefer, "2025-12-31");
    const r = escolherOrigem(proprio, refeito);
    assert.equal(r.origem.reapresentado, true);
    assert.deepEqual(r.originais, { "3.01": 100 });
    assert.deepEqual(r.contas, refeito.contas, "as contas vêm todas do documento escolhido; a conta aberta do original não é misturada");
    assert.equal(escolherOrigem(null, refeito).origem.reapresentado, null);
    assert.equal(escolherOrigem(null, null), null);
  });

  test("conta fixa que some na reapresentação fica registrada no original; a que surge, com original null", () => {
    const base = { familia: "DRE", metodo: null, inicio: "2024-01-01", fim: "2024-12-31", documento: "dfp", versao: 1, consolidado: true };
    const c = (conta, valor) => ({ conta, descricao: conta, contaFixa: true, valor });
    const r = escolherOrigem({ ...base, ordem: "ultimo", dtRefer: "2024-12-31", contas: [c("3.01", 10), c("3.10", 5)] },
      { ...base, ordem: "penultimo", dtRefer: "2025-12-31", contas: [c("3.01", 10), c("3.12", 7)] });
    assert.deepEqual(r.originais, { "3.10": 5, "3.12": null });
  });

  test("períodos que terminam antes de 2010 não entram (a DFP de 2010 traz 2009 como PENÚLTIMO)", () => {
    const fatos = [dfp("2010-01-01", "2010-12-31", 10), fato({ dtRefer: "2010-12-31", ordem: "penultimo", inicio: "2009-01-01", fim: "2009-12-31", valor: 8 })];
    assert.deepEqual(serieAnual(fatos).map((p) => p.fim), ["2010-12-31"]);
    assert.deepEqual(serieAnual(fatos, { desde: "2009-01-01" }).map((p) => p.fim), ["2009-12-31", "2010-12-31"]);
  });

  test("ITR não entra na série anual", () => {
    assert.deepEqual(serieAnual([dfp("2025-01-01", "2025-12-31", 10), ...itr("2026-06-30", ["2026-01-01", 3], ["2025-01-01", "2025-06-30", 2])]).map((p) => p.fim), ["2025-12-31"]);
  });

  test("montarSeries recusa fatos de duas companhias", () => {
    assert.throws(() => montarSeries([dfp("2025-01-01", "2025-12-31", 1), { ...dfp("2025-01-01", "2025-12-31", 1), cnpj: "22.222.222/0001-22" }]), /uma companhia só; vieram 2/);
  });
});

describe("funções pequenas", () => {
  test("doze: null em qualquer parcela dá null; zero conta", () => {
    assert.equal(doze(100, 30, 20), 110);
    assert.equal(doze(0, 0, 0), 0);
    assert.equal(doze(null, 30, 20), null);
    assert.equal(doze(100, undefined, 20), null);
    assert.equal(doze(100, 30, null), null);
  });

  test("classificarIntervalo: anual, transição, trimestre, acumulado e posição", () => {
    const tipo = (documento, inicio, fim) => classificarIntervalo({ documento, inicio, fim }).tipo;
    assert.equal(tipo("dfp", "2025-01-01", "2025-12-31"), "anual");
    assert.equal(tipo("dfp", "2024-01-01", "2024-12-31"), "anual"); // bissexto, 366 dias
    assert.equal(tipo("dfp", "2025-04-01", "2026-03-31"), "anual"); // exercício até março
    assert.equal(tipo("dfp", "2013-04-01", "2013-12-31"), "transicao");
    assert.equal(tipo("dfp", "2013-01-01", "2014-03-31"), "transicao"); // 15 meses
    assert.equal(tipo("itr", "2026-07-01", "2026-09-30"), "trimestre");
    assert.equal(tipo("itr", "2026-01-01", "2026-09-30"), "acumulado");
    assert.equal(tipo("itr", null, "2026-09-30"), "posicao");
    assert.deepEqual(classificarIntervalo({ documento: "itr", inicio: "2026-01-01", fim: "2026-06-30" }), { tipo: "acumulado", dias: 181, meses: 6 });
  });

  test("intervaloAcumulado: o que começa mais cedo; com um só, ele mesmo", () => {
    const tri = { inicio: "2026-07-01", fim: "2026-09-30" }, acum = { inicio: "2026-01-01", fim: "2026-09-30" };
    assert.equal(intervaloAcumulado([tri, acum]), acum);
    assert.equal(intervaloAcumulado([tri]), tri);
    assert.equal(intervaloAcumulado([]), null);
  });

  test("datas: dias do intervalo, dia seguinte e um ano antes (com bissexto)", () => {
    assert.equal(diasDoIntervalo("2025-01-01", "2025-12-31"), 365);
    assert.equal(somarDias("2025-12-31", 1), "2026-01-01");
    assert.equal(somarDias("2024-02-28", 1), "2024-02-29");
    assert.equal(umAnoAntes("2026-09-30"), "2025-09-30");
    assert.equal(umAnoAntes("2024-02-29"), "2023-02-28");
    assert.ok(mesmoIntervaloUmAnoAntes({ inicio: "2024-12-01", fim: "2025-02-28" }, { inicio: "2023-12-01", fim: "2024-02-29" }));
    assert.ok(!mesmoIntervaloUmAnoAntes({ inicio: "2026-01-01", fim: "2026-06-30" }, { inicio: "2025-04-01", fim: "2025-06-30" }));
  });

  test("valorDaConta: ausente é null; repetida com valores diferentes também", () => {
    const bloco = { contas: [{ conta: "1", valor: 10 }, { conta: "2", valor: 0 }, { conta: "3", valor: 5 }, { conta: "3", valor: 6 }, { conta: "4", valor: 7 }, { conta: "4", valor: 7 }] };
    assert.equal(valorDaConta(bloco, "1"), 10);
    assert.equal(valorDaConta(bloco, "2"), 0);
    assert.equal(valorDaConta(bloco, "3"), null);
    assert.equal(valorDaConta(bloco, "4"), 7);
    assert.equal(valorDaConta(bloco, "9"), null);
    assert.equal(valorDaConta(undefined, "1"), null);
  });
});
