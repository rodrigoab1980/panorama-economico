// Fichas das companhias (#37): dos fatos gravados pela coleta saem a série, os indicadores e os
// múltiplos, e o build grava tudo em dist/fundamentos/dados/.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { criarExtrator, decidirSaida, montarCompanhia, serializar, tipoDaEntrada } from "../scripts/cvm/coleta.mjs";
import { INDICE_DAS_FICHAS, PASTA_DAS_FICHAS, montarFicha, montarFichas, tickerPrincipal } from "../scripts/cvm/ficha.mjs";
import { INDICADORES } from "../scripts/cvm/indicadores.mjs";
import { MULTIPLOS } from "../scripts/cvm/multiplos.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DIR = new URL("./fixtures/cvm/", import.meta.url);
const texto = (pasta, nome) => new TextDecoder("latin1").decode(readFileSync(new URL(`${pasta}/${nome}`, DIR)));
const WEG = { cnpj: "84.429.695/0001-11", cdCvm: "005410", nome: "WEG S.A.", setor: "Bens industriais", tickers: [{ ticker: "WEGE3", ibovespa: true }] };

// O arquivo da WEG como a coleta grava, a partir das fixtures (DFP de 2025 e ITR de 2025 e 2026).
function extratoDaWeg(documento, ano) {
  const extrator = criarExtrator([WEG]);
  for (const nome of readdirSync(new URL("weg/", DIR)).filter((n) => n.startsWith(`${documento}_cia_aberta_`) && n.endsWith(`_${ano}.csv`))) {
    const tipo = tipoDaEntrada(nome);
    if (!tipo) continue;
    const receber = extrator[tipo](nome);
    for (const l of texto("weg", nome).split("\n")) receber(l);
    receber.fechar?.();
  }
  return extrator.extrato();
}
const zip = (nome) => ({ nome, ano: Number(/(\d{4})\.zip$/.exec(nome)[1]), lastModified: "Sun, 08 Nov 2026 10:19:22 GMT", tamanho: 1000, status: "ok", motivo: null });
const EXTRATOS = [["dfp", 2025], ["itr", 2025], ["itr", 2026]].map(([d, a]) => ({ arquivo: zip(`${d}_cia_aberta_${a}.zip`), extrato: extratoDaWeg(d, a) }));
const ARQUIVO = JSON.parse(serializar(montarCompanhia(WEG, EXTRATOS)));
const COTACOES = { coletadoEm: "2026-11-13T22:07:00.000Z", fonte: "fonte de teste", precos: { WEGE3: { preco: 50, dataHora: "2026-11-13T18:05:00.000-0300" } } };

describe("ficha de uma companhia", () => {
  const ficha = montarFicha({ companhia: WEG, arquivo: ARQUIVO, cotacoes: COTACOES, hoje: "2026-11-14" });

  test("identificação, documento mais recente e as três partes: anual, 12 meses e múltiplos", () => {
    assert.deepEqual(Object.keys(ficha), ["ticker", "tickers", "cnpj", "cdCvm", "nome", "setor", "documentoMaisRecente", "cotacoes", "anual", "doze", "multiplos", "avisos", "consistencia", "atencao"]);
    assert.deepEqual([ficha.ticker, ficha.tickers, ficha.cdCvm, ficha.nome, ficha.setor], ["WEGE3", ["WEGE3"], "005410", "WEG S.A.", "Bens industriais"]);
    assert.deepEqual(ficha.documentoMaisRecente, { tipo: "itr", dtRefer: "2026-09-30", versao: 1 });
    assert.deepEqual(ficha.avisos, []);
  });

  test("série anual: um item por exercício, com todos os indicadores", () => {
    assert.deepEqual(ficha.anual.map((p) => [p.fim, p.tipo]), [["2024-12-31", "anual"], ["2025-12-31", "anual"]]);
    const p2025 = ficha.anual.at(-1);
    assert.deepEqual(Object.keys(p2025.indicadores), INDICADORES.map((i) => i.id));
    assert.equal(p2025.indicadores.receita.valor, 40_804_110);
    assert.equal(p2025.indicadores.ebitda.valor, 9_000_037);
    assert.deepEqual(p2025.composicao, { dtRefer: "2025-12-31", acoesCirculacao: 4_195_695_973, escala: "unidade", escalaPor: "lucro por ação informado" });
  });

  test("12 meses até 30/09/2026, com os indicadores", () => {
    assert.deepEqual([ficha.doze.fim, ficha.doze.tipo, ficha.doze.motivo], ["2026-09-30", "itr", null]);
    assert.equal(ficha.doze.indicadores.ebitda.valor, 8_952_604);
    assert.equal(ficha.doze.composicao.acoesCirculacao, 4_197_317_998 - 1_488_307);
  });

  test("múltiplos com o preço do dia: valor de mercado e P/L dos 12 meses", () => {
    const vm = ((4_197_317_998 - 1_488_307) * 50) / 1000;
    assert.deepEqual(Object.keys(ficha.multiplos.multiplos), MULTIPLOS.map((m) => m.id));
    assert.equal(ficha.multiplos.multiplos.valorMercado.valor, vm);
    assert.ok(Math.abs(ficha.multiplos.multiplos.pl.valor - vm / 6_268_804) < 1e-9);
    assert.deepEqual([ficha.multiplos.dataPregao, ficha.multiplos.desatualizado, ficha.multiplos.fonte], ["2026-11-13", false, "fonte de teste"]);
  });

  test("sem arquivo de preços: a ficha sai, com os múltiplos vazios e o motivo", () => {
    const semPreco = montarFicha({ companhia: WEG, arquivo: ARQUIVO, cotacoes: null, hoje: "2026-11-14" });
    assert.deepEqual(semPreco.multiplos.multiplos.valorMercado, { valor: null, motivo: "sem arquivo de cotações" });
    assert.equal(semPreco.anual.at(-1).indicadores.ebitda.valor, 9_000_037);
  });

  test("a ficha não leva as contas dos demonstrativos, só os indicadores", () => {
    const tamanho = JSON.stringify(ficha).length;
    assert.ok(tamanho < 40_000, `${tamanho} bytes`);
    assert.ok(!JSON.stringify(ficha).includes("Receita de Venda de Bens"));
  });

  test("tickerPrincipal: o do Ibovespa; sem ele, o primeiro", () => {
    assert.equal(tickerPrincipal({ tickers: [{ ticker: "USIM3", ibovespa: false }, { ticker: "USIM5", ibovespa: true }] }), "USIM5");
    assert.equal(tickerPrincipal({ tickers: [{ ticker: "AAAA3", ibovespa: false }, { ticker: "AAAA4", ibovespa: false }] }), "AAAA3");
  });
});

describe("todas as fichas e o índice do site", () => {
  const OUTRA = { cnpj: "00.000.000/0001-00", cdCvm: "099999", nome: "OUTRA S.A.", setor: null, tickers: [{ ticker: "XXXX3", ibovespa: true }] };
  const RUIM = { cnpj: "11.111.111/0001-11", cdCvm: "088888", nome: "RUIM S.A.", setor: null, tickers: [{ ticker: "RUIM3", ibovespa: true }] };
  const indiceDaColeta = {
    coletadoEm: "2026-11-08T12:23:00.000Z",
    companhias: { "005410": { status: "ok", motivo: null }, "099999": { status: "falhou", motivo: "falhou dfp_cia_aberta_2025.zip (GET 404)" } },
  };
  const { fichas, indice } = montarFichas({
    companhias: [OUTRA, WEG, RUIM],
    arquivos: { "005410": ARQUIVO, "088888": { cnpj: RUIM.cnpj, cdCvm: "088888", fatos: 5, composicoes: [] } },
    indiceDaColeta, cotacoes: COTACOES, hoje: "2026-11-14",
  });

  test("uma ficha por companhia com arquivo, pelo ticker principal", () => {
    assert.deepEqual(Object.keys(fichas), ["WEGE3"]);
  });

  test("o índice lista todas, em ordem de ticker, com o documento mais recente e as datas", () => {
    assert.deepEqual([indice.montadoEm, indice.coletadoEm, indice.cotacoes], ["2026-11-14", "2026-11-08T12:23:00.000Z", { coletadoEm: "2026-11-13T22:07:00.000Z", fonte: "fonte de teste" }]);
    assert.deepEqual(indice.companhias.map((c) => c.ticker), ["RUIM3", "WEGE3", "XXXX3"]);
    assert.deepEqual(indice.companhias[1], {
      ticker: "WEGE3", nome: "WEG S.A.", setor: "Bens industriais", cdCvm: "005410", ficha: true, motivo: null,
      documentoMaisRecente: { tipo: "itr", dtRefer: "2026-09-30", versao: 1 },
      exercicios: 2, primeiroExercicio: "2024-12-31", ultimoExercicio: "2025-12-31", dozeMeses: "2026-09-30", coleta: { status: "ok", motivo: null },
    });
  });

  test("companhia sem arquivo: sem ficha, com o motivo da coleta", () => {
    assert.deepEqual(indice.companhias[2], { ticker: "XXXX3", nome: "OUTRA S.A.", setor: null, cdCvm: "099999", ficha: false, motivo: "falhou dfp_cia_aberta_2025.zip (GET 404)", documentoMaisRecente: null });
  });

  test("companhia que dá erro ao montar não derruba as outras: fica sem ficha, com o erro no índice", () => {
    assert.equal(indice.companhias[0].ficha, false);
    assert.match(indice.companhias[0].motivo, /^erro ao montar a ficha: /);
  });

  test("sem índice da coleta e sem preços: as fichas saem do mesmo jeito", () => {
    const r = montarFichas({ companhias: [WEG, OUTRA], arquivos: { "005410": ARQUIVO }, hoje: "2026-11-14" });
    assert.deepEqual(Object.keys(r.fichas), ["WEGE3"]);
    assert.deepEqual([r.indice.coletadoEm, r.indice.cotacoes], [null, null]);
    assert.equal(r.indice.companhias.find((c) => c.ticker === "XXXX3").motivo, "sem dados coletados");
  });
});

describe("build: fichas em dist/fundamentos/dados/", () => {
  let pasta;
  const build = (dados, dist) => execFileSync(process.execPath, [join(RAIZ, "scripts", "build.mjs"), "site", dist], { cwd: RAIZ, encoding: "utf8", env: { ...process.env, DADOS_DIR: dados }, stdio: "pipe" });

  before(() => { pasta = mkdtempSync(join(tmpdir(), "fichas-")); });
  after(() => { rmSync(pasta, { recursive: true, force: true }); });

  test("sem a pasta dados/fundamentos/ o build não falha e o site sai sem fichas", () => {
    const dist = join(pasta, "dist-sem");
    const saida = build(join(pasta, "nao-existe"), dist);
    assert.match(saida, /fichas: sem a pasta de fundamentos; o site sai sem elas/);
    assert.match(saida, /build pronto/);
    assert.ok(existsSync(join(dist, "index.html")));
    assert.ok(existsSync(join(dist, "fundamentos", "index.html")));
    assert.ok(!existsSync(join(dist, PASTA_DAS_FICHAS)));
  });

  test("com os fatos da coleta: grava a ficha de cada companhia e o índice", () => {
    const dados = join(pasta, "dados");
    mkdirSync(join(dados, "fundamentos"), { recursive: true });
    // o que a coleta grava: o arquivo da companhia (com o cdCvm do universo de verdade) e o índice
    const universo = JSON.parse(readFileSync(join(RAIZ, "scripts", "cvm", "universo.json"), "utf8")).mapeadas.filter((c) => !c.foraDaPagina);
    const weg = universo.find((c) => c.cdCvm === "005410");
    const { gravar } = decidirSaida({ companhias: [weg], arquivos: EXTRATOS.map((e) => e.arquivo), extratos: EXTRATOS, agora: new Date("2026-11-08T12:23:00Z"), anoCorrente: 2026 });
    for (const [caminho, conteudo] of Object.entries(gravar)) writeFileSync(join(dados, caminho), conteudo);
    writeFileSync(join(dados, "cotacoes-fundamentos.json"), JSON.stringify(COTACOES));
    writeFileSync(join(dados, "fundamentos", "estragado.json"), "{ não é JSON");

    const dist = join(pasta, "dist-com");
    const saida = build(dados, dist);
    assert.match(saida, /fichas: 1 de 64 companhias em \d+ ms/);
    const ficha = JSON.parse(readFileSync(join(dist, PASTA_DAS_FICHAS, "WEGE3.json"), "utf8"));
    assert.equal(ficha.ticker, "WEGE3");
    assert.equal(ficha.anual.at(-1).indicadores.ebitda.valor, 9_000_037);
    assert.ok(ficha.multiplos.multiplos.pl.valor > 0);
    const indice = JSON.parse(readFileSync(join(dist, PASTA_DAS_FICHAS, INDICE_DAS_FICHAS), "utf8"));
    assert.equal(indice.companhias.length, 64);
    assert.equal(indice.companhias.filter((c) => c.ficha).length, 1);
    assert.equal(indice.coletadoEm, "2026-11-08T12:23:00.000Z");
    assert.deepEqual(readdirSync(join(dist, PASTA_DAS_FICHAS)).sort(), ["WEGE3.json", "indice.json"]);
    // o Diário e a página continuam saindo
    assert.ok(existsSync(join(dist, "index.html")));
  });
});
