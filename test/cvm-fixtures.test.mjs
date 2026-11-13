// Confirma, nas fixtures reais da CVM, os fatos medidos no spike (#29, docs/cvm.md).
// O leitor de verdade é a #31; aqui só um parser mínimo para checar o formato.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const DIR = new URL("./fixtures/cvm/", import.meta.url);

function lerCsv(caminho) {
  const bruto = readFileSync(new URL(caminho, DIR));
  const texto = new TextDecoder("latin1").decode(bruto);
  const linhas = texto.split("\r\n").filter(Boolean);
  const cab = linhas[0].split(";");
  return { bruto, cab, linhas: linhas.slice(1).map((l) => Object.fromEntries(l.split(";").map((v, i) => [cab[i], v]))) };
}

const atual = (r) => r.ORDEM_EXERC === "ÚLTIMO";
const valor = (linhas, conta, filtro = () => true) => {
  const achadas = linhas.filter((r) => r.CD_CONTA === conta && filtro(r));
  assert.equal(achadas.length, 1, `esperava 1 linha para ${conta}, achei ${achadas.length}`);
  return Number(achadas[0].VL_CONTA);
};

describe("formato dos arquivos da CVM", () => {
  const arquivos = readdirSync(DIR, { recursive: true }).filter((f) => f.endsWith(".csv")).map((f) => f.replaceAll("\\", "/"));

  test("há fixtures das três empresas", () => {
    for (const pasta of ["weg/", "raia-drogasil/", "hapvida/"]) {
      assert.ok(arquivos.some((f) => f.startsWith(pasta)), pasta);
    }
  });

  test("latin1, separador ';' e quebra CRLF em todos os arquivos", () => {
    for (const f of arquivos) {
      const { bruto, cab, linhas } = lerCsv(f);
      const lf = bruto.filter((b) => b === 0x0a).length;
      const crlf = bruto.toString("latin1").split("\r\n").length - 1;
      assert.equal(lf, crlf, `${f}: toda quebra de linha é CRLF`);
      assert.ok(cab.length > 5 && linhas.length > 0, f);
      for (const l of linhas) assert.equal(Object.keys(l).length, cab.length, f);
    }
  });

  test("decodificado como latin1, ORDEM_EXERC vira ÚLTIMO/PENÚLTIMO", () => {
    const { linhas } = lerCsv("weg/dfp_cia_aberta_DRE_con_2025.csv");
    assert.deepEqual([...new Set(linhas.map((r) => r.ORDEM_EXERC))].sort(), ["PENÚLTIMO", "ÚLTIMO"]);
  });

  test("balanço não tem DT_INI_EXERC; DRE, DFC e DVA têm", () => {
    assert.ok(!lerCsv("weg/dfp_cia_aberta_BPA_con_2025.csv").cab.includes("DT_INI_EXERC"));
    assert.ok(!lerCsv("weg/dfp_cia_aberta_BPP_con_2025.csv").cab.includes("DT_INI_EXERC"));
    for (const d of ["DRE", "DFC_MI", "DVA"]) {
      assert.ok(lerCsv(`weg/dfp_cia_aberta_${d}_con_2025.csv`).cab.includes("DT_INI_EXERC"), d);
    }
  });

  test("cada arquivo de dados traz uma única VERSAO por documento", () => {
    for (const f of arquivos.filter((a) => /_con_/.test(a))) {
      const { linhas } = lerCsv(f);
      const versoes = new Set(linhas.map((r) => `${r.DT_REFER}|${r.VERSAO}`));
      const docs = new Set(linhas.map((r) => r.DT_REFER));
      assert.equal(versoes.size, docs.size, f);
    }
  });
});

describe("contas fixas do plano", () => {
  test("DRE 3.01/3.03/3.05/3.06/3.11, ativo 1, PL 2.03, DFC 6.01–6.03 e D&A 7.04.01 são contas fixas", () => {
    const esperadas = {
      DRE: ["3.01", "3.03", "3.05", "3.06", "3.11"], BPA: ["1"], BPP: ["2.03"],
      DFC_MI: ["6.01", "6.02", "6.03"], DVA: ["7.04.01"],
    };
    for (const empresa of ["weg", "raia-drogasil"]) {
      for (const [demo, contas] of Object.entries(esperadas)) {
        const { linhas } = lerCsv(`${empresa}/dfp_cia_aberta_${demo}_con_2025.csv`);
        for (const c of contas) {
          const l = linhas.find((r) => r.CD_CONTA === c && atual(r));
          assert.ok(l, `${empresa} ${demo} ${c}`);
          assert.equal(l.ST_CONTA_FIXA, "S", `${empresa} ${demo} ${c}`);
        }
      }
    }
  });

  test("subcontas da DFC mudam de código entre empresas (capex não tem código fixo)", () => {
    const capex = (empresa) => lerCsv(`${empresa}/dfp_cia_aberta_DFC_MI_con_2025.csv`).linhas
      .filter((r) => atual(r) && r.CD_CONTA.startsWith("6.02.") && /imobilizado/i.test(r.DS_CONTA) && Number(r.VL_CONTA) < 0);
    const weg = capex("weg"), raia = capex("raia-drogasil");
    assert.ok(weg.length && raia.length);
    assert.ok(weg.every((r) => r.ST_CONTA_FIXA === "N") && raia.every((r) => r.ST_CONTA_FIXA === "N"));
    assert.notDeepEqual(weg.map((r) => r.DS_CONTA), raia.map((r) => r.DS_CONTA));
  });
});

describe("base de 12 meses pelo ITR (WEG, 3T26)", () => {
  const dre = lerCsv("weg/itr_cia_aberta_DRE_con_2026.csv").linhas;
  const dfc = lerCsv("weg/itr_cia_aberta_DFC_MI_con_2026.csv").linhas;
  const anual = lerCsv("weg/dfp_cia_aberta_DRE_con_2025.csv").linhas;

  test("DRE do ITR traz trimestre e acumulado; DFC só acumulado", () => {
    const inicios = new Set(dre.filter((r) => r.CD_CONTA === "3.11" && atual(r)).map((r) => r.DT_INI_EXERC));
    assert.deepEqual([...inicios].sort(), ["2026-01-01", "2026-07-01"]);
    const iniciosDfc = new Set(dfc.filter((r) => r.CD_CONTA === "6.01" && atual(r)).map((r) => r.DT_INI_EXERC));
    assert.deepEqual([...iniciosDfc], ["2026-01-01"]);
  });

  test("lucro 12m = anual 2025 + acumulado 9M26 − acumulado 9M25", () => {
    const ano = valor(anual, "3.11", atual);
    const acum = valor(dre, "3.11", (r) => atual(r) && r.DT_INI_EXERC === "2026-01-01");
    const acumAnt = valor(dre, "3.11", (r) => r.ORDEM_EXERC === "PENÚLTIMO" && r.DT_INI_EXERC === "2025-01-01");
    assert.equal(ano + acum - acumAnt, 6_690_278);
  });
});

describe("reapresentação (Hapvida, lucro de 2022)", () => {
  test("o valor de 2022 publicado na DFP 2022 difere do reapresentado na DFP 2023", () => {
    const fim2022 = (r) => r.DT_FIM_EXERC === "2022-12-31";
    const original = valor(lerCsv("hapvida/dfp_cia_aberta_DRE_con_2022.csv").linhas, "3.11", (r) => atual(r) && fim2022(r));
    const reapresentado = valor(lerCsv("hapvida/dfp_cia_aberta_DRE_con_2023.csv").linhas, "3.11", (r) => r.ORDEM_EXERC === "PENÚLTIMO" && fim2022(r));
    assert.equal(original, -775_839);
    assert.equal(reapresentado, -1_718_120);
  });
});

describe("IFRS 16 (Raia Drogasil)", () => {
  test("pagamentos de arrendamento ficam no financiamento (6.03), fora do capex", () => {
    const dfc = lerCsv("raia-drogasil/dfp_cia_aberta_DFC_MI_con_2025.csv").linhas.filter(atual);
    const arrend = dfc.filter((r) => /arrendament/i.test(r.DS_CONTA) && Number(r.VL_CONTA) < 0);
    assert.ok(arrend.some((r) => r.CD_CONTA.startsWith("6.03.")));
    assert.ok(arrend.every((r) => !r.CD_CONTA.startsWith("6.02.")));
  });
});
