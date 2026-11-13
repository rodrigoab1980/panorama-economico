import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cadastroDoFca, cdCvmValido, cnpjValido, juntarClasses, lerFca, montarUniverso, normalizarTicker,
  resumoPorSetor, setorPorTicker, tickerValido, vinculosDoFca,
} from "../scripts/cvm/universo.mjs";

const json = (nome) => JSON.parse(readFileSync(new URL(`../scripts/cvm/${nome}`, import.meta.url), "utf8"));

// ---------- fixture real do FCA 2026 (test/fixtures/cvm/fca, recortada por gerar-fixtures.mjs) ----------
const FCA = new URL("./fixtures/cvm/fca/", import.meta.url);
const linhasDe = (nome) => new TextDecoder("latin1").decode(readFileSync(new URL(nome, FCA))).split("\n");
const VINCULOS = vinculosDoFca(linhasDe("fca_cia_aberta_valor_mobiliario_2026.csv"));
const CADASTRO = cadastroDoFca(linhasDe("fca_cia_aberta_geral_2026.csv"));

const PETROBRAS = "33.000.167/0001-01", KLABIN = "89.637.490/0001-45", ENERGISA = "00.864.214/0001-06";
const CSN = "33.042.730/0001-04", AXIA = "00.001.180/0001-26", B3 = "09.346.601/0001-25";
const CEA = "45.242.914/0001-05", MARFRIG = "03.853.896/0001-40";
const SETORES = {
  "Petróleo e gás": ["PETR3", "PETR4"], "Papel e celulose": ["KLBN11"], "Energia e saneamento": ["ENGI11", "AXIA3"],
  "Mineração e siderurgia": ["CSNA3"], "Financeiro": ["B3SA3"], "Varejo e consumo": ["CEAB3"], "Alimentos e bebidas": ["MBRF3"],
};
const montar = (tickers, extra = {}) => montarUniverso({
  tickers, vinculos: VINCULOS, cadastro: CADASTRO, setores: SETORES, financeiros: ["Financeiro"], ...extra,
});
const cia = (r, cnpj) => r.mapeadas.find((c) => c.cnpj === cnpj);

describe("ticker: normalização e validação", () => {
  test("normaliza espaços e maiúsculas, sem corrigir mais nada", () => {
    assert.equal(normalizarTicker(" tgma3 "), "TGMA3");
    assert.equal(normalizarTicker("petr 4"), "PETR4");
    assert.equal(normalizarTicker(undefined), "");
  });

  test("aceita ON, PN, classes e unit, inclusive com dígito no meio", () => {
    for (const t of ["PETR3", "PETR4", "USIM5", "USIM6", "AXIA7", "CTEE8", "KLBN11", "B3SA3"]) assert.ok(tickerValido(t), t);
  });

  test("recusa o que o FCA traz de errado (casos reais do spike)", () => {
    for (const t of ["4030", "25585", "000000", "ADR", "N/A", "LMED", "PNC", "CPTP3B", "tgma3", "", "PETR", "PETR12", "3PETR3"]) {
      assert.ok(!tickerValido(t), t);
    }
  });

  test("formato de CNPJ e de código CVM", () => {
    assert.ok(cnpjValido("33.000.167/0001-01"));
    assert.ok(!cnpjValido("33000167000101"));
    assert.ok(cdCvmValido("009512"));
    assert.ok(!cdCvmValido("9512"));
  });
});

describe("FCA real: vínculos confiáveis", () => {
  test("ON e PN da Petrobras apontam para a mesma companhia", () => {
    assert.deepEqual([...VINCULOS.get("PETR3")], [PETROBRAS]);
    assert.deepEqual([...VINCULOS.get("PETR4")], [PETROBRAS]);
  });

  test("unit: Klabin só informa KLBN11; Energisa informa unit, ON e PN", () => {
    assert.deepEqual([...VINCULOS.get("KLBN11")], [KLABIN]);
    for (const t of ["ENGI11", "ENGI3", "ENGI4"]) assert.deepEqual([...VINCULOS.get(t)], [ENERGISA], t);
  });

  test("nome trocado: o FCA mais recente traz AXIA3, não ELET3, no mesmo CNPJ da Eletrobras", () => {
    assert.deepEqual([...VINCULOS.get("AXIA3")], [AXIA]);
    assert.equal(VINCULOS.has("ELET3"), false);
    assert.equal(CADASTRO.get(AXIA).cdCvm, "002437");
  });

  test("código inválido não vira vínculo: CSN (\"4030\") e Marfrig (\"ADR\")", () => {
    const todos = [...VINCULOS.values()].flatMap((s) => [...s]);
    assert.ok(!todos.includes(CSN) && !todos.includes(MARFRIG));
    assert.equal(VINCULOS.has("4030"), false);
    assert.equal(VINCULOS.has("ADR"), false);
  });

  test("negociação com data de fim fica fora: BRFS3 (encerrada) e CEAB3 (fim igual ao início)", () => {
    assert.equal(VINCULOS.has("BRFS3"), false);
    assert.equal(VINCULOS.has("CEAB3"), false);
  });

  test("só entra o que é negociado em Bolsa com código: debêntures e notas ficam fora", () => {
    assert.deepEqual([...VINCULOS.keys()].sort(), ["AXIA3", "AXIA7", "B3SA3", "ENGI11", "ENGI3", "ENGI4", "KLBN11", "PETR3", "PETR4"]);
  });

  test("cadastro: código CVM, nome e situação de cada companhia", () => {
    assert.deepEqual(CADASTRO.get(PETROBRAS), { cdCvm: "009512", nome: "PETROLEO BRASILEIRO S.A. PETROBRAS", situacao: "Ativo" });
    assert.equal(CADASTRO.get(CSN).cdCvm, "004030");
    assert.equal(CADASTRO.size, 9);
  });
});

describe("montarUniverso com o FCA real", () => {
  test("PETR3 e PETR4 viram uma entrada só, com origem fca", () => {
    const r = montar(["PETR4", "PETR3"]);
    assert.deepEqual(r, {
      mapeadas: [{
        cnpj: PETROBRAS, cdCvm: "009512", nome: "PETROLEO BRASILEIRO S.A. PETROBRAS", setor: "Petróleo e gás", financeira: false,
        tickers: [{ ticker: "PETR3", origem: "fca", ibovespa: true }, { ticker: "PETR4", origem: "fca", ibovespa: true }],
      }],
      pendentes: [],
    });
  });

  test("unit: as outras classes da companhia entram na mesma entrada, marcadas fora da carteira", () => {
    const r = montar(["ENGI11", "KLBN11"]);
    assert.deepEqual(cia(r, ENERGISA).tickers, [
      { ticker: "ENGI11", origem: "fca", ibovespa: true },
      { ticker: "ENGI3", origem: "fca", ibovespa: false },
      { ticker: "ENGI4", origem: "fca", ibovespa: false },
    ]);
    assert.deepEqual(cia(r, KLABIN).tickers, [{ ticker: "KLBN11", origem: "fca", ibovespa: true }]);
  });

  test("ticker sem vínculo vai para pendentes com o motivo, sem palpite", () => {
    const r = montar(["CSNA3", "ELET3", "PETR4"]);
    assert.deepEqual(r.mapeadas.map((c) => c.cnpj), [PETROBRAS]);
    assert.deepEqual(r.pendentes.map((p) => p.ticker), ["CSNA3", "ELET3"]);
    for (const p of r.pendentes) assert.match(p.motivo, /sem vínculo no FCA/);
  });

  test("a exceção liga o que o FCA traz errado e fica marcada, com a obs", () => {
    const r = montar(["CSNA3", "MBRF3"], {
      excecoes: [
        { ticker: "CSNA3", cnpj: CSN, motivo: "código \"4030\" no FCA" },
        { ticker: "MBRF3", cnpj: MARFRIG, motivo: "código \"ADR\" no FCA", obs: "Incorporou a BRF em 2025." },
      ],
    });
    assert.deepEqual(r.pendentes, []);
    assert.deepEqual(cia(r, CSN).tickers, [{ ticker: "CSNA3", origem: "excecao", ibovespa: true }]);
    assert.equal(cia(r, CSN).cdCvm, "004030");
    assert.equal(cia(r, CSN).obs, undefined);
    assert.equal(cia(r, MARFRIG).obs, "Incorporou a BRF em 2025.");
  });

  test("a exceção vence o FCA", () => {
    const r = montar(["PETR4"], { excecoes: [{ ticker: "PETR4", cnpj: KLABIN, motivo: "teste: exceção vence" }], setores: { X: ["PETR4"] } });
    assert.deepEqual(r.mapeadas.map((c) => c.cnpj), [KLABIN]);
    assert.deepEqual(cia(r, KLABIN).tickers, [
      { ticker: "KLBN11", origem: "fca", ibovespa: false },
      { ticker: "PETR4", origem: "excecao", ibovespa: true },
    ]);
  });

  test("financeira vem do setor: B3 fica na lista, marcada", () => {
    const r = montar(["B3SA3", "PETR4"]);
    assert.equal(cia(r, B3).financeira, true);
    assert.equal(cia(r, PETROBRAS).financeira, false);
  });

  test("companhia sem setor, ou com tickers em setores diferentes, vai para pendentes", () => {
    assert.match(montar(["PETR4"], { setores: {} }).pendentes[0].motivo, /sem setor/);
    const r = montar(["PETR3", "PETR4"], { setores: { A: ["PETR3"], B: ["PETR4"] } });
    assert.deepEqual(r.mapeadas, []);
    assert.equal(r.pendentes.length, 2);
    assert.match(r.pendentes[0].motivo, /setores diferentes: A, B/);
  });

  test("saída em ordem estável, qualquer que seja a ordem de entrada", () => {
    const a = montar(["PETR4", "KLBN11", "AXIA3", "PETR3"]), b = montar(["AXIA3", "PETR3", "PETR4", "KLBN11", "PETR4"]);
    assert.deepEqual(a, b);
    assert.deepEqual(a.mapeadas.map((c) => c.tickers[0].ticker), ["AXIA3", "KLBN11", "PETR3"]);
  });
});

// ---------- casos SINTÉTICOS: linhas escritas à mão, não são dados da CVM ----------
describe("sintético: casos que a fixture não cobre", () => {
  const CAB = "CNPJ_Companhia;Versao;Valor_Mobiliario;Codigo_Negociacao;Mercado;Data_Fim_Negociacao";
  const A = "11.111.111/0001-11", B = "22.222.222/0001-22";
  const cadastro = new Map([[A, { cdCvm: "000111", nome: "A S.A.", situacao: "Ativo" }], [B, { cdCvm: "000222", nome: "B S.A.", situacao: "Cancelado" }]]);

  test("código em minúsculas ou com espaço é normalizado; versão antiga do FCA é ignorada", () => {
    const v = vinculosDoFca([CAB, `${A};1;Ações Ordinárias;VELH3;Bolsa;`, `${A};2;Ações Ordinárias; novo3 ;Bolsa;\r`, ""]);
    assert.deepEqual([...v.keys()], ["NOVO3"]);
  });

  test("mesmo código em duas companhias é ambíguo: pendente, não escolhe uma", () => {
    const v = vinculosDoFca([CAB, `${A};1;Ações Ordinárias;DUPL3;Bolsa;`, `${B};1;Ações Ordinárias;DUPL3;Bolsa;`]);
    const r = montarUniverso({ tickers: ["DUPL3"], vinculos: v, cadastro, setores: { X: ["DUPL3"] } });
    assert.deepEqual(r.mapeadas, []);
    assert.match(r.pendentes[0].motivo, /ambíguo.*2 companhias/);
  });

  test("companhia sem cadastro (ex.: estrangeira) ou com registro não ativo vai para pendentes", () => {
    const v = vinculosDoFca([CAB, `${B};1;Ações Ordinárias;BBBB3;Bolsa;`, "99.999.999/0001-99;1;Ações Ordinárias;FORA3;Bolsa;"]);
    const r = montarUniverso({ tickers: ["BBBB3", "FORA3"], vinculos: v, cadastro, setores: { X: ["BBBB3", "FORA3"] } });
    assert.deepEqual(r.mapeadas, []);
    assert.match(r.pendentes.find((p) => p.ticker === "BBBB3").motivo, /"Cancelado"/);
    assert.match(r.pendentes.find((p) => p.ticker === "FORA3").motivo, /sem cadastro no FCA/);
  });

  test("ticker da carteira em formato inválido é pendente", () => {
    const r = montarUniverso({ tickers: ["XPTO"], vinculos: new Map(), cadastro });
    assert.match(r.pendentes[0].motivo, /formato inválido/);
  });

  test("exceção sem motivo, com CNPJ inválido ou repetida dá erro", () => {
    const base = { tickers: [], vinculos: new Map(), cadastro };
    assert.throws(() => montarUniverso({ ...base, excecoes: [{ ticker: "AAAA3", cnpj: A, motivo: " " }] }), /sem motivo/);
    assert.throws(() => montarUniverso({ ...base, excecoes: [{ ticker: "AAAA3", cnpj: "123", motivo: "x" }] }), /CNPJ inválido/);
    assert.throws(() => montarUniverso({ ...base, excecoes: [{ ticker: "AAAA3", cnpj: A, motivo: "x" }, { ticker: "aaaa3", cnpj: A, motivo: "y" }] }), /repetida/);
  });

  test("lerFca: colunas pelo cabeçalho; coluna faltando e linha malformada dão erro com arquivo e linha", () => {
    assert.deepEqual(lerFca(["B;A\r", "2;1\r", ""], ["A"], "x.csv"), [{ B: "2", A: "1" }]);
    assert.throws(() => lerFca(["A;B", "1;2"], ["C"], "x.csv"), /x\.csv:1: cabeçalho sem a\(s\) coluna\(s\) C/);
    assert.throws(() => lerFca(["A;B", "1;2", "1;2;3"], ["A"], "x.csv"), /x\.csv:3: linha malformada: 3 colunas, o cabeçalho tem 2/);
  });

  test("juntarClasses agrupa por CNPJ sem repetir; setorPorTicker recusa ticker em dois setores", () => {
    const m = juntarClasses([{ ticker: "AAAA3", cnpj: A, origem: "fca" }, { ticker: "AAAA4", cnpj: A, origem: "fca" }, { ticker: "AAAA3", cnpj: A, origem: "fca" }]);
    assert.deepEqual(m.get(A).map((t) => t.ticker), ["AAAA3", "AAAA4"]);
    assert.throws(() => setorPorTicker({ X: ["AAAA3"], Y: ["AAAA3"] }), /AAAA3 está em "X" e em "Y"/);
  });
});

// ---------- consistência dos arquivos commitados ----------
describe("universo.json e arquivos mantidos à mão", () => {
  const universo = json("universo.json");
  const carteira = json("tickers-ibovespa.json");
  const { excecoes } = json("excecoes-tickers.json");
  const { setores, financeiros } = json("setores.json");

  test("a carteira tem data de referência, fonte e tickers válidos, sem repetição", () => {
    assert.match(carteira.dataReferencia, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(carteira.fonte.length > 10);
    assert.equal(new Set(carteira.tickers).size, carteira.tickers.length);
    for (const t of carteira.tickers) assert.ok(tickerValido(t), t);
    assert.deepEqual(universo.carteira, { dataReferencia: carteira.dataReferencia, fonte: carteira.fonte });
  });

  test("todo ticker da carteira está em mapeadas ou em pendentes", () => {
    const mapeados = new Set(universo.mapeadas.flatMap((c) => c.tickers.filter((t) => t.ibovespa).map((t) => t.ticker)));
    const pendentes = new Set(universo.pendentes.map((p) => p.ticker));
    for (const t of carteira.tickers) assert.ok(mapeados.has(t) !== pendentes.has(t), `${t} deve estar em um, e só um, dos dois`);
    assert.equal(mapeados.size + pendentes.size, carteira.tickers.length);
    for (const p of universo.pendentes) assert.ok(p.motivo.length > 10, p.ticker);
  });

  test("cada companhia tem CNPJ, código CVM, nome, setor e origem de cada vínculo", () => {
    for (const c of universo.mapeadas) {
      assert.ok(cnpjValido(c.cnpj), c.nome);
      assert.ok(cdCvmValido(c.cdCvm), c.nome);
      assert.ok(c.nome.length > 2);
      assert.ok(Object.hasOwn(setores, c.setor), `${c.nome}: setor "${c.setor}"`);
      assert.equal(c.financeira, financeiros.includes(c.setor), c.nome);
      assert.ok(c.tickers.some((t) => t.ibovespa), c.nome);
      for (const t of c.tickers) {
        assert.ok(tickerValido(t.ticker), t.ticker);
        assert.ok(t.origem === "fca" || t.origem === "excecao", t.ticker);
      }
    }
  });

  test("nenhum CNPJ, código CVM ou ticker repetido em duas companhias", () => {
    for (const chave of [(c) => [c.cnpj], (c) => [c.cdCvm], (c) => c.tickers.map((t) => t.ticker)]) {
      const todos = universo.mapeadas.flatMap(chave);
      assert.equal(new Set(todos).size, todos.length);
    }
  });

  test("toda exceção tem motivo, CNPJ válido e está em uso; vínculo por exceção só existe com exceção", () => {
    const porTicker = new Map(excecoes.map((e) => [e.ticker, e]));
    for (const e of excecoes) {
      assert.ok(e.motivo?.trim().length > 20, e.ticker);
      assert.ok(cnpjValido(e.cnpj), e.ticker);
      assert.ok(carteira.tickers.includes(e.ticker), `${e.ticker}: exceção para ticker fora da carteira`);
    }
    for (const c of universo.mapeadas) {
      for (const t of c.tickers.filter((x) => x.origem === "excecao")) assert.equal(porTicker.get(t.ticker)?.cnpj, c.cnpj, t.ticker);
    }
  });

  test("setores.json: só tickers da carteira, cada um num setor só, e os financeiros existem", () => {
    const mapa = setorPorTicker(setores);
    for (const t of mapa.keys()) assert.ok(carteira.tickers.includes(t), `${t} está em setores.json e não na carteira`);
    for (const f of financeiros) assert.ok(Object.hasOwn(setores, f), f);
  });

  test("resumoPorSetor bate com o universo (a tabela mostrada na revisão)", () => {
    const resumo = resumoPorSetor(universo.mapeadas);
    assert.equal(resumo.reduce((s, g) => s + g.empresas, 0), universo.mapeadas.length);
    assert.deepEqual(resumo.map((g) => g.setor).sort(), Object.keys(setores).sort());
  });
});
