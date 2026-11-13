import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  FIXTURES, FIXTURE_FCA, arquivosDoDocumento, arquivosDoFca, cnpjDoCodigo, cnpjsDoFca, recortarCsv, recortarFca,
} from "../scripts/cvm/fixtures.mjs";

const latin1 = (s) => Buffer.from(s, "latin1");
const CAB = "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;ORDEM_EXERC";
const CSV = latin1([
  CAB,
  "11.111.111/0001-11;2026-06-30;1;AÇÃO S.A.;000111;ÚLTIMO",
  "22.222.222/0001-22;2026-06-30;2;OUTRA S.A.;000222;ÚLTIMO",
  "11.111.111/0001-11;2026-09-30;1;AÇÃO S.A.;000111;PENÚLTIMO",
].map((l) => `${l}\r\n`).join(""));

describe("cnpjDoCodigo", () => {
  test("acha o CNPJ pelo CD_CVM no índice", () => {
    assert.equal(cnpjDoCodigo(CSV, "000222"), "22.222.222/0001-22");
  });
  test("devolve null quando o código não aparece", () => {
    assert.equal(cnpjDoCodigo(CSV, "999999"), null);
  });
  test("recusa arquivo sem as colunas esperadas", () => {
    assert.throws(() => cnpjDoCodigo(latin1("A;B\r\n1;2\r\n"), "1"), /CD_CVM/);
  });
});

describe("recortarCsv", () => {
  test("mantém cabeçalho e linhas do CNPJ, com bytes latin1 e CRLF intactos", () => {
    const esperado = latin1(`${CAB}\r\n11.111.111/0001-11;2026-06-30;1;AÇÃO S.A.;000111;ÚLTIMO\r\n`
      + "11.111.111/0001-11;2026-09-30;1;AÇÃO S.A.;000111;PENÚLTIMO\r\n");
    assert.deepEqual(recortarCsv(CSV, "11.111.111/0001-11"), esperado);
  });
  test("com DT_REFER, fica só aquele documento", () => {
    const r = recortarCsv(CSV, "11.111.111/0001-11", "2026-09-30").toString("latin1");
    assert.equal(r, `${CAB}\r\n11.111.111/0001-11;2026-09-30;1;AÇÃO S.A.;000111;PENÚLTIMO\r\n`);
  });
  test("sem linhas da empresa, sobra só o cabeçalho", () => {
    assert.equal(recortarCsv(CSV, "33.333.333/0001-33").toString("latin1"), `${CAB}\r\n`);
  });
  test("recortar uma fixture pelo próprio CNPJ devolve os mesmos bytes", () => {
    const dir = new URL("./fixtures/cvm/", import.meta.url);
    for (const pasta of readdirSync(dir).filter((p) => p !== FIXTURE_FCA.pasta)) {
      for (const nome of readdirSync(new URL(`${pasta}/`, dir))) {
        const bytes = readFileSync(new URL(`${pasta}/${nome}`, dir));
        const cnpj = bytes.toString("latin1").split("\r\n")[1].split(";")[0];
        assert.deepEqual(recortarCsv(bytes, cnpj), bytes, `${pasta}/${nome}`);
      }
    }
  });
});

describe("FIXTURES e arquivosDoDocumento", () => {
  test("DFP e ITR incluem a composição do capital", () => {
    assert.ok(arquivosDoDocumento("dfp", 2025).includes("dfp_cia_aberta_composicao_capital_2025.csv"));
    assert.ok(arquivosDoDocumento("itr", 2026).includes("itr_cia_aberta_composicao_capital_2026.csv"));
    assert.equal(arquivosDoDocumento("itr", 2026).length, 7);
  });
  test("a lista bate com os arquivos commitados em test/fixtures/cvm", () => {
    const dir = new URL("./fixtures/cvm/", import.meta.url);
    for (const { pasta, documentos } of Object.values(FIXTURES)) {
      const esperados = documentos.flatMap(({ doc, ano }) => arquivosDoDocumento(doc, ano)).sort();
      assert.deepEqual(readdirSync(new URL(`${pasta}/`, dir)).sort(), esperados, pasta);
    }
  });
});

describe("fixture do FCA", () => {
  const dir = new URL(`./fixtures/cvm/${FIXTURE_FCA.pasta}/`, import.meta.url);
  const [geral, valores] = arquivosDoFca(FIXTURE_FCA.ano);
  const ler = (nome) => readFileSync(new URL(nome, dir));

  test("os arquivos commitados são os de FIXTURE_FCA", () => {
    assert.deepEqual(readdirSync(dir).sort(), [geral, valores].sort());
  });

  test("cnpjsDoFca acha o CNPJ de cada código CVM e recusa código ausente", () => {
    const cnpjs = cnpjsDoFca(ler(geral), FIXTURE_FCA.cdCvms);
    assert.equal(cnpjs.length, FIXTURE_FCA.cdCvms.length);
    assert.equal(cnpjs[0], "33.000.167/0001-01"); // Petrobras, 009512
    assert.throws(() => cnpjsDoFca(ler(geral), ["999999"]), /999999 não aparece/);
  });

  test("recortar a fixture pelos próprios CNPJs devolve os mesmos bytes", () => {
    const cnpjs = cnpjsDoFca(ler(geral), FIXTURE_FCA.cdCvms);
    for (const nome of [geral, valores]) assert.deepEqual(recortarFca(ler(nome), cnpjs), ler(nome), nome);
  });

  test("recortarFca filtra pela coluna CNPJ_Companhia, com latin1 e CRLF intactos (sintético)", () => {
    const csv = latin1("CNPJ_Companhia;Nome\r\n11.111.111/0001-11;AÇÃO\r\n22.222.222/0001-22;OUTRA\r\n");
    assert.deepEqual(recortarFca(csv, ["11.111.111/0001-11"]), latin1("CNPJ_Companhia;Nome\r\n11.111.111/0001-11;AÇÃO\r\n"));
    assert.throws(() => recortarFca(latin1("A;B\r\n"), []), /CNPJ_Companhia/);
  });
});
