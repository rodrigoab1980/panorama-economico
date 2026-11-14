// Coleta semanal dos fundamentos (#37): o que baixar, o extrato de um ZIP, o arquivo de cada companhia,
// a serialização estável, a decisão do que gravar e as regras da TIM e da Vivara.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  BASE_CVM, CAMINHO_DO_INDICE, FORMATO, agruparEmBlocos, anosDaColeta, arquivosDaColeta, caminhoDaCompanhia, criarExtrator, decidirSaida,
  dependeDoArquivo, documentoMaisRecente, fatosDaCompanhia, fatosDosBlocos, montarCompanhia, serializar, tipoDaEntrada,
} from "../scripts/cvm/coleta.mjs";
import { consolidadosZerados, criarLeitor, escolherConsolidado, escolherVersao, interpretarArquivo, lerArquivos } from "../scripts/cvm/leitor.mjs";
import { montarSeries } from "../scripts/cvm/series.mjs";
import { calcularIndicadoresDaSerie, LIMITE_DILUICAO } from "../scripts/cvm/indicadores.mjs";
import { calcularMultiplos, fundamentosParaMultiplos } from "../scripts/cvm/multiplos.mjs";
import { lerComposicaoCapital } from "../scripts/cvm/composicao-capital.mjs";

const DIR = new URL("./fixtures/cvm/", import.meta.url);
const texto = (pasta, nome) => new TextDecoder("latin1").decode(readFileSync(new URL(`${pasta}/${nome}`, DIR)));
const WEG = { cnpj: "84.429.695/0001-11", cdCvm: "005410", tickers: [{ ticker: "WEGE3", ibovespa: true }] };
const OUTRA = { cnpj: "00.000.000/0001-00", cdCvm: "099999", tickers: [{ ticker: "XXXX3", ibovespa: false }] };

// Extrato de um "ZIP" montado com as fixtures da WEG cujo nome começa com `prefixo` (ex.: "dfp_cia_aberta_" e 2025).
function extratoDaFixture(documento, ano, { companhias = [WEG, OUTRA], intrusas = true } = {}) {
  const extrator = criarExtrator(companhias);
  for (const nome of readdirSync(new URL("weg/", DIR)).filter((n) => n.startsWith(`${documento}_cia_aberta_`) && n.endsWith(`_${ano}.csv`))) {
    const tipo = tipoDaEntrada(nome);
    if (!tipo) continue;
    const receber = tipo === "demonstrativo" ? extrator.demonstrativo(nome) : extrator.composicao(nome);
    const linhas = texto("weg", nome).split("\n");
    // Linha de uma companhia de fora do universo, no meio do arquivo: tem de ser descartada.
    if (intrusas && linhas.length > 2) linhas.splice(2, 0, linhas[1].replace(WEG.cnpj, "11.111.111/0001-11"));
    for (const l of linhas) receber(l);
    receber.fechar?.();
  }
  return extrator.extrato();
}
const arq = (nome, extra = {}) => ({ nome, ano: Number(/(\d{4})\.zip$/.exec(nome)[1]), lastModified: "Sun, 08 Nov 2026 10:19:22 GMT", tamanho: 1000, status: "ok", motivo: null, ...extra });
const EXTRATOS_WEG = [
  { arquivo: arq("dfp_cia_aberta_2025.zip"), extrato: extratoDaFixture("dfp", 2025) },
  { arquivo: arq("itr_cia_aberta_2025.zip"), extrato: extratoDaFixture("itr", 2025) },
  { arquivo: arq("itr_cia_aberta_2026.zip"), extrato: extratoDaFixture("itr", 2026) },
];

describe("o que baixar", () => {
  test("em 13/11/2026: DFP de 2010 a 2026 e ITR de 2025 e 2026", () => {
    const { dfp, itr } = anosDaColeta("2026-11-13");
    assert.deepEqual([dfp[0], dfp.at(-1), dfp.length], [2010, 2026, 17]);
    assert.deepEqual(itr, [2025, 2026]);
  });

  test("na virada do ano entram o ano novo e o anterior", () => {
    assert.deepEqual(anosDaColeta("2027-01-03").itr, [2026, 2027]);
    assert.equal(anosDaColeta("2027-01-03").dfp.at(-1), 2027);
    assert.deepEqual(anosDaColeta("2010-06-01"), { dfp: [2010], itr: [2009, 2010] });
    assert.throws(() => anosDaColeta("ontem"), /data da coleta inválida/);
    assert.throws(() => anosDaColeta("2009-12-31"), /data da coleta inválida/);
  });

  test("os 19 ZIPs, com nome e endereço, DFP antes de ITR", () => {
    const lista = arquivosDaColeta("2026-11-13");
    assert.equal(lista.length, 19);
    assert.deepEqual(lista[0], { nome: "dfp_cia_aberta_2010.zip", documento: "dfp", ano: 2010, url: `${BASE_CVM}/DFP/DADOS/dfp_cia_aberta_2010.zip` });
    assert.deepEqual(lista.at(-1), { nome: "itr_cia_aberta_2026.zip", documento: "itr", ano: 2026, url: "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_2026.zip" });
    assert.deepEqual(lista.slice(-3).map((a) => a.nome), ["dfp_cia_aberta_2026.zip", "itr_cia_aberta_2025.zip", "itr_cia_aberta_2026.zip"]);
  });

  test("entradas do ZIP: demonstrativos (consolidado e individual) e composição entram; o resto não", () => {
    assert.equal(tipoDaEntrada("dfp_cia_aberta_DRE_con_2025.csv"), "demonstrativo");
    assert.equal(tipoDaEntrada("itr_cia_aberta_BPA_ind_2026.csv"), "demonstrativo");
    assert.equal(tipoDaEntrada("dfp_cia_aberta_DFC_MD_con_2025.csv"), "demonstrativo");
    assert.equal(tipoDaEntrada("dfp_cia_aberta_composicao_capital_2025.csv"), "composicao");
    assert.equal(tipoDaEntrada("itr_cia_aberta_composicao_capital_2026.csv"), "composicao");
    for (const fora of ["dfp_cia_aberta_2025.csv", "dfp_cia_aberta_DMPL_con_2025.csv", "dfp_cia_aberta_DRA_ind_2025.csv", "dfp_cia_aberta_parecer_2025.csv", "leiame.txt"]) {
      assert.equal(tipoDaEntrada(fora), null, fora);
    }
  });
});

describe("extrato de um ZIP: só as companhias do universo, em blocos", () => {
  const extrato = extratoDaFixture("dfp", 2025);

  test("guarda só a companhia do universo que aparece no arquivo; a linha de fora é descartada", () => {
    assert.equal(extrato.formato, FORMATO);
    assert.deepEqual(Object.keys(extrato.companhias), ["005410"]);
    assert.ok(extrato.linhas.lidas > extrato.linhas.aproveitadas);
    const semIntrusas = extratoDaFixture("dfp", 2025, { intrusas: false });
    assert.deepEqual(semIntrusas.companhias, extrato.companhias);
    assert.equal(extrato.linhas.lidas - semIntrusas.linhas.lidas, 6); // uma intrusa em cada um dos 6 arquivos
    assert.equal(extrato.linhas.aproveitadas, semIntrusas.linhas.aproveitadas);
  });

  test("os blocos devolvem exatamente os fatos do leitor", () => {
    const nomes = readdirSync(new URL("weg/", DIR)).filter((n) => n.startsWith("dfp_cia_aberta_") && interpretarArquivo(n));
    const doLeitor = lerArquivos(nomes.map((nome) => ({ nome, linhas: texto("weg", nome).split("\n") })));
    const doExtrato = fatosDosBlocos(extrato.companhias["005410"].blocos, WEG);
    const chave = (f) => JSON.stringify(Object.keys(f).sort().map((k) => [k, f[k]]));
    assert.equal(doExtrato.length, doLeitor.length);
    assert.deepEqual(doExtrato.map(chave).sort(), doLeitor.map(chave).sort());
  });

  test("um bloco por (documento, data, versão, base, demonstrativo, coluna), com as contas na ordem do arquivo", () => {
    const { blocos } = extrato.companhias["005410"];
    const dre = blocos.find((b) => b.demonstrativo === "DRE" && b.ordem === "ultimo");
    assert.deepEqual(Object.keys(dre), ["documento", "dtRefer", "versao", "consolidado", "demonstrativo", "ordem", "inicio", "fim", "contas"]);
    assert.deepEqual([dre.documento, dre.dtRefer, dre.consolidado, dre.inicio, dre.fim], ["dfp", "2025-12-31", true, "2025-01-01", "2025-12-31"]);
    assert.deepEqual(dre.contas[0], ["3.01", "Receita de Venda de Bens e/ou Serviços", 1, 40_804_110]);
    assert.equal(blocos.length, 10); // DRE, BPA, BPP, DFC e DVA, cada um com ÚLTIMO e PENÚLTIMO
    assert.equal(blocos.find((b) => b.demonstrativo === "BPA").inicio, null);
  });

  test("a composição do capital vai junto, como veio do arquivo", () => {
    assert.deepEqual(extrato.companhias["005410"].composicoes, lerComposicaoCapital(texto("weg", "dfp_cia_aberta_composicao_capital_2025.csv")));
  });

  test("agruparEmBlocos e fatosDosBlocos são inversos, e a ordem dos blocos não depende da ordem de entrada", () => {
    const fatos = fatosDosBlocos(extrato.companhias["005410"].blocos, WEG);
    assert.deepEqual(agruparEmBlocos(fatos), extrato.companhias["005410"].blocos);
    const embaralhado = [...fatos.filter((f) => f.demonstrativo !== "DRE"), ...fatos.filter((f) => f.demonstrativo === "DRE")];
    assert.deepEqual(agruparEmBlocos(embaralhado), extrato.companhias["005410"].blocos);
  });

  test("cabeçalho diferente do esperado dá erro (o ZIP conta como falha)", () => {
    const receber = criarExtrator([WEG]).demonstrativo("dfp_cia_aberta_DRE_con_2025.csv");
    assert.throws(() => receber("CNPJ;DATA;VALOR"), /dfp_cia_aberta_DRE_con_2025\.csv:1: cabeçalho sem a\(s\) coluna\(s\)/);
  });

  test("linha malformada da companhia do universo dá erro com o número da linha do arquivo", () => {
    const linhas = texto("weg", "dfp_cia_aberta_DRE_con_2025.csv").split("\n");
    const receber = criarExtrator([WEG]).demonstrativo("dfp_cia_aberta_DRE_con_2025.csv");
    receber(linhas[0]);
    receber("11.111.111/0001-11;lixo"); // de fora do universo: nem é interpretada
    assert.throws(() => receber(`${WEG.cnpj};lixo`), /dfp_cia_aberta_DRE_con_2025\.csv:3: linha malformada/);
  });
});

describe("arquivo de uma companhia", () => {
  const cia = montarCompanhia(WEG, EXTRATOS_WEG);

  test("junta os extratos de todos os ZIPs", () => {
    assert.deepEqual(Object.keys(cia), ["cnpj", "cdCvm", "tickers", "fatos", "composicoes", "origem", "avisos"]);
    assert.deepEqual([cia.cnpj, cia.cdCvm, cia.tickers], ["84.429.695/0001-11", "005410", ["WEGE3"]]);
    assert.deepEqual(cia.origem, [
      { arquivo: "dfp_cia_aberta_2025.zip", lastModified: "Sun, 08 Nov 2026 10:19:22 GMT" },
      { arquivo: "itr_cia_aberta_2025.zip", lastModified: "Sun, 08 Nov 2026 10:19:22 GMT" },
      { arquivo: "itr_cia_aberta_2026.zip", lastModified: "Sun, 08 Nov 2026 10:19:22 GMT" },
    ]);
    assert.deepEqual(cia.composicoes.map((c) => c.dtRefer), ["2025-09-30", "2025-12-31", "2026-09-30"]);
    assert.deepEqual(cia.avisos, []);
  });

  test("a série montada a partir do arquivo é igual à montada direto das fixtures", () => {
    const nomes = readdirSync(new URL("weg/", DIR)).filter((n) => interpretarArquivo(n));
    const direto = montarSeries(lerArquivos(nomes.map((nome) => ({ nome, linhas: texto("weg", nome).split("\n") }))));
    const doArquivo = montarSeries(fatosDaCompanhia(JSON.parse(serializar(cia))));
    assert.deepEqual(doArquivo.anual.map((p) => p.fim), direto.anual.map((p) => p.fim));
    assert.deepEqual(doArquivo.doze.fluxos, direto.doze.fluxos);
    assert.deepEqual(doArquivo.doze.estoques.contas, direto.doze.estoques.contas);
    const indicadores = (series) => calcularIndicadoresDaSerie(series, { composicoes: cia.composicoes });
    assert.deepEqual(indicadores(doArquivo).doze.indicadores, indicadores(direto).doze.indicadores);
    assert.equal(indicadores(doArquivo).anual.at(-1).indicadores.ebitda.valor, 9_000_037);
  });

  test("documento mais recente: o ITR de 30/09/2026", () => {
    assert.deepEqual(documentoMaisRecente(cia), { tipo: "itr", dtRefer: "2026-09-30", versao: 1 });
    assert.equal(documentoMaisRecente(null), null);
    assert.equal(documentoMaisRecente({ fatos: [] }), null);
  });

  test("companhia que nenhum ZIP traz: null", () => {
    assert.equal(montarCompanhia(OUTRA, EXTRATOS_WEG), null);
  });

  test("fica a maior versão do documento, também na composição", () => {
    const bloco = (versao, valor) => ({ documento: "dfp", dtRefer: "2025-12-31", versao, consolidado: true, demonstrativo: "DRE", ordem: "ultimo", inicio: "2025-01-01", fim: "2025-12-31", contas: [["3.01", "Receita", 1, valor]] });
    const comp = (versao, total) => ({ cnpj: OUTRA.cnpj, dtRefer: "2025-12-31", versao, acoesTotal: total, acoesTesouraria: 0, acoesCirculacao: total });
    const extrato = { formato: FORMATO, companhias: { "099999": { blocos: [bloco(1, 100), bloco(2, 120)], composicoes: [comp(2, 1200), comp(1, 1000)] } } };
    const r = montarCompanhia(OUTRA, [{ arquivo: arq("dfp_cia_aberta_2025.zip"), extrato }]);
    assert.deepEqual(r.fatos.map((b) => [b.versao, b.contas[0][3]]), [[2, 120]]);
    assert.deepEqual(r.composicoes.map((c) => [c.versao, c.acoesTotal]), [[2, 1200]]);
  });

  test("dependeDoArquivo: sem arquivo anterior, de todos; com ele, dos ZIPs de onde saiu e dos dois últimos anos", () => {
    const anterior = { origem: [{ arquivo: "dfp_cia_aberta_2019.zip" }] };
    assert.equal(dependeDoArquivo(null, arq("dfp_cia_aberta_2012.zip"), 2026), true);
    assert.equal(dependeDoArquivo(anterior, arq("dfp_cia_aberta_2012.zip"), 2026), false); // a companhia não existia em 2012
    assert.equal(dependeDoArquivo(anterior, arq("dfp_cia_aberta_2019.zip"), 2026), true);
    assert.equal(dependeDoArquivo(anterior, arq("itr_cia_aberta_2025.zip"), 2026), true); // documento novo pode estar lá
    assert.equal(dependeDoArquivo(anterior, arq("dfp_cia_aberta_2026.zip"), 2026), true);
    assert.equal(dependeDoArquivo(anterior, arq("dfp_cia_aberta_2024.zip"), 2026), false);
  });
});

describe("serializar: o mesmo dado dá os mesmos bytes", () => {
  test("chaves em ordem diferente, em qualquer profundidade, dão o mesmo texto", () => {
    const a = { cnpj: "x", cdCvm: "1", fatos: [{ documento: "dfp", contas: [["1", "Ativo", 1, 10]], versao: 1 }], origem: [{ arquivo: "a.zip", lastModified: null }] };
    const b = { origem: [{ lastModified: null, arquivo: "a.zip" }], fatos: [{ versao: 1, contas: [["1", "Ativo", 1, 10]], documento: "dfp" }], cdCvm: "1", cnpj: "x" };
    assert.equal(serializar(a), serializar(b));
    assert.ok(Buffer.from(serializar(a)).equals(Buffer.from(serializar(b))));
  });

  test("é JSON válido, volta ao mesmo dado e termina em quebra de linha", () => {
    const dado = { b: [1, "dois", null, true, { z: 1, a: [] }], a: { y: -0.5, x: "ação \"entre aspas\"\n" }, vazio: {}, lista: [] };
    const texto = serializar(dado);
    assert.deepEqual(JSON.parse(texto), dado);
    assert.ok(texto.endsWith("}\n"));
    assert.equal(serializar(JSON.parse(texto)), texto);
  });

  test("a ordem das listas é mantida (quem ordena é quem monta)", () => {
    assert.notEqual(serializar({ l: [1, 2] }), serializar({ l: [2, 1] }));
  });

  test("abaixo do nível, cada item sai numa linha só: um bloco de fatos por linha", () => {
    const texto = serializar({ cdCvm: "1", fatos: [{ versao: 1, contas: [["1", "Ativo", 1, 10], ["2", "Passivo", 1, 10]] }, { versao: 2, contas: [] }] });
    assert.equal(texto, '{\n "cdCvm": "1",\n "fatos": [\n  {"contas":[["1","Ativo",1,10],["2","Passivo",1,10]],"versao":1},\n  {"contas":[],"versao":2}\n ]\n}\n');
    assert.equal(serializar({ a: { b: { c: 1 } } }, { nivel: 3 }), '{\n "a": {\n  "b": {\n   "c": 1\n  }\n }\n}\n');
  });

  test("undefined não vira chave; valores simples e listas vazias", () => {
    assert.equal(serializar({ a: undefined, b: 1 }), '{\n "b": 1\n}\n');
    assert.equal(serializar([]), "[]\n");
    assert.equal(serializar(null), "null\n");
  });

  test("o arquivo real da companhia serializa igual depois de ler e gravar de novo", () => {
    const texto = serializar(montarCompanhia(WEG, EXTRATOS_WEG));
    assert.equal(serializar(JSON.parse(texto)), texto);
    assert.equal(serializar(montarCompanhia(WEG, [...EXTRATOS_WEG].reverse())), texto); // a ordem dos ZIPs não muda o resultado
  });
});

describe("o que gravar", () => {
  const agora = new Date("2026-11-15T12:23:00.000Z");
  const ARQUIVOS = ["dfp_cia_aberta_2025.zip", "itr_cia_aberta_2025.zip", "itr_cia_aberta_2026.zip"].map((n) => arq(n));
  const decidir = (mudancas = {}) => decidirSaida({ companhias: [WEG], arquivos: ARQUIVOS, extratos: EXTRATOS_WEG, anteriores: {}, agora, anoCorrente: 2026, ...mudancas });
  const primeira = decidir();
  const gravado = primeira.gravar;

  test("primeira coleta: grava o arquivo da companhia e o índice", () => {
    assert.deepEqual(Object.keys(gravado), [caminhoDaCompanhia("005410"), CAMINHO_DO_INDICE]);
    assert.deepEqual([caminhoDaCompanhia("005410"), CAMINHO_DO_INDICE], ["fundamentos/005410.json", "fundamentos/indice.json"]);
    assert.deepEqual(primeira.resumo, { ok: 1, mantidas: 0, falharam: 0, arquivosComFalha: 0, tudoFalhou: false, gravados: 2 });
  });

  test("o índice traz a data da coleta, o estado de cada ZIP e o documento mais recente de cada companhia", () => {
    const indice = JSON.parse(gravado[CAMINHO_DO_INDICE]);
    assert.equal(indice.coletadoEm, "2026-11-15T12:23:00.000Z");
    assert.deepEqual(indice.arquivos["dfp_cia_aberta_2025.zip"], { lastModified: "Sun, 08 Nov 2026 10:19:22 GMT", tamanho: 1000, status: "ok", motivo: null });
    assert.deepEqual(indice.companhias["005410"], {
      tickers: ["WEGE3"], documentoMaisRecente: { tipo: "itr", dtRefer: "2026-09-30", versao: 1 }, status: "ok", motivo: null, avisos: [],
    });
  });

  test("segunda coleta sem mudança: zero arquivos, mesmo com outra data de coleta", () => {
    const r = decidir({ anteriores: gravado, agora: new Date("2026-11-22T12:23:00.000Z") });
    assert.deepEqual(r.gravar, {});
    assert.equal(r.resumo.gravados, 0);
    assert.equal(r.resumo.ok, 1);
  });

  test("o Last-Modified de um ZIP mudou, mas o conteúdo da companhia não: grava só o índice", () => {
    const arquivos = ARQUIVOS.map((a) => (a.nome === "itr_cia_aberta_2026.zip" ? { ...a, lastModified: "Sun, 15 Nov 2026 10:44:33 GMT" } : a));
    const extratos = EXTRATOS_WEG.map((e) => (e.arquivo.nome === "itr_cia_aberta_2026.zip" ? { ...e, arquivo: arquivos[2] } : e));
    const r = decidir({ anteriores: gravado, arquivos, extratos });
    // a origem da companhia guarda o Last-Modified, então o arquivo dela muda junto
    assert.deepEqual(Object.keys(r.gravar), [caminhoDaCompanhia("005410"), CAMINHO_DO_INDICE]);
    assert.deepEqual(JSON.parse(r.gravar[caminhoDaCompanhia("005410")]).fatos, JSON.parse(gravado[caminhoDaCompanhia("005410")]).fatos);
  });

  test("um ZIP falha: a companhia que depende dele mantém o arquivo anterior, e o índice registra", () => {
    const arquivos = ARQUIVOS.map((a) => (a.nome === "itr_cia_aberta_2026.zip" ? { ...a, status: "falhou", motivo: "20 s sem receber bytes" } : a));
    const r = decidir({ anteriores: gravado, arquivos, extratos: EXTRATOS_WEG.slice(0, 2) });
    assert.deepEqual(Object.keys(r.gravar), [CAMINHO_DO_INDICE]); // o arquivo da companhia não é tocado
    const indice = JSON.parse(r.gravar[CAMINHO_DO_INDICE]);
    assert.deepEqual(indice.arquivos["itr_cia_aberta_2026.zip"], { lastModified: "Sun, 08 Nov 2026 10:19:22 GMT", tamanho: 1000, status: "falhou", motivo: "20 s sem receber bytes" });
    assert.equal(indice.companhias["005410"].status, "mantido");
    assert.equal(indice.companhias["005410"].motivo, "falhou itr_cia_aberta_2026.zip (20 s sem receber bytes)");
    // o documento mais recente continua o do arquivo anterior
    assert.deepEqual(indice.companhias["005410"].documentoMaisRecente, { tipo: "itr", dtRefer: "2026-09-30", versao: 1 });
    assert.deepEqual(r.resumo, { ok: 0, mantidas: 1, falharam: 0, arquivosComFalha: 1, tudoFalhou: false, gravados: 1 });
  });

  test("a mesma falha na semana seguinte não gera commit de novo", () => {
    const arquivos = ARQUIVOS.map((a) => (a.nome === "itr_cia_aberta_2026.zip" ? { ...a, status: "falhou", motivo: "GET 404" } : a));
    const primeiraFalha = decidir({ anteriores: gravado, arquivos, extratos: EXTRATOS_WEG.slice(0, 2) });
    const depois = decidir({ anteriores: { ...gravado, ...primeiraFalha.gravar }, arquivos, extratos: EXTRATOS_WEG.slice(0, 2), agora: new Date("2026-11-22T12:23:00.000Z") });
    assert.deepEqual(depois.gravar, {});
  });

  test("ZIP que falha e do qual a companhia não depende: ela segue normalmente", () => {
    const velho = arq("dfp_cia_aberta_2012.zip", { status: "falhou", motivo: "GET 404" });
    const r = decidir({ anteriores: gravado, arquivos: [velho, ...ARQUIVOS] });
    assert.equal(JSON.parse(r.gravar[CAMINHO_DO_INDICE]).companhias["005410"].status, "ok");
    assert.equal(r.resumo.ok, 1);
  });

  test("um ZIP falha na primeira coleta (sem arquivo anterior): a companhia fica sem arquivo, com o motivo", () => {
    const arquivos = ARQUIVOS.map((a) => (a.nome === "dfp_cia_aberta_2025.zip" ? { ...a, status: "falhou", motivo: "passou do teto de 3 min" } : a));
    const r = decidir({ arquivos, extratos: EXTRATOS_WEG.slice(1) });
    assert.deepEqual(Object.keys(r.gravar), [CAMINHO_DO_INDICE]);
    assert.deepEqual(r.indice.companhias["005410"], { tickers: ["WEGE3"], documentoMaisRecente: null, status: "falhou", motivo: "falhou dfp_cia_aberta_2025.zip (passou do teto de 3 min)", avisos: [] });
  });

  test("tudo falhou: nada é gravado, nem o índice", () => {
    const arquivos = ARQUIVOS.map((a) => ({ ...a, status: "falhou", motivo: "HEAD: timeout de 20 s" }));
    for (const anteriores of [gravado, {}]) {
      const r = decidir({ anteriores, arquivos, extratos: [] });
      assert.deepEqual(r.gravar, {});
      assert.equal(r.resumo.tudoFalhou, true);
    }
    assert.equal(decidir({ anteriores: gravado, arquivos, extratos: [] }).resumo.mantidas, 1);
  });

  test("uma companhia que dá erro ao montar mantém o arquivo anterior, e as outras seguem", () => {
    // O extrato da segunda companhia vem estragado: `blocos` não é uma lista.
    const estragado = { arquivo: ARQUIVOS[0], extrato: { formato: FORMATO, companhias: { ...EXTRATOS_WEG[0].extrato.companhias, "099999": { blocos: 5, composicoes: [] } } } };
    const anteriorDaOutra = serializar({ cnpj: OUTRA.cnpj, cdCvm: "099999", tickers: ["XXXX3"], fatos: [], composicoes: [], origem: [{ arquivo: "dfp_cia_aberta_2025.zip", lastModified: null }], avisos: [] });
    const r = decidir({ companhias: [WEG, OUTRA], extratos: [estragado, ...EXTRATOS_WEG.slice(1)], anteriores: { [caminhoDaCompanhia("099999")]: anteriorDaOutra } });
    assert.equal(r.indice.companhias["005410"].status, "ok");
    assert.equal(r.indice.companhias["099999"].status, "mantido");
    assert.match(r.indice.companhias["099999"].motivo, /^erro ao montar: /);
    assert.ok(caminhoDaCompanhia("005410") in r.gravar);
    assert.ok(!(caminhoDaCompanhia("099999") in r.gravar)); // o anterior não é tocado
  });

  test("companhia que nenhum ZIP traz e não tem arquivo anterior: 'falhou', sem derrubar as outras", () => {
    const r = decidir({ companhias: [WEG, OUTRA] });
    assert.deepEqual([r.indice.companhias["099999"].status, r.indice.companhias["099999"].motivo], ["falhou", "nenhum arquivo da CVM traz a companhia"]);
    assert.equal(r.resumo.ok, 1);
  });

  test("arquivo anterior ilegível conta como se não existisse, e é regravado", () => {
    const r = decidir({ anteriores: { [caminhoDaCompanhia("005410")]: "{ não é JSON", [CAMINHO_DO_INDICE]: "também não" } });
    assert.deepEqual(Object.keys(r.gravar), [caminhoDaCompanhia("005410"), CAMINHO_DO_INDICE]);
  });

  test("as companhias saem no índice em ordem de código, não na ordem da lista", () => {
    const r = decidir({ companhias: [OUTRA, WEG] });
    assert.deepEqual(Object.keys(r.indice.companhias), ["005410", "099999"]);
  });
});

describe("TIM: consolidado zerado conta como ausente", () => {
  // Linhas exatas dos arquivos da CVM (DFP de 2025 da TIM S.A.): o consolidado vem inteiro em zero e o
  // individual vem preenchido.
  const CAB_BPA = "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA";
  const CAB_DRE = "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_INI_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA";
  const TIM = "02.421.421/0001-11;2025-12-31;1;TIM S.A.;024929";
  const arquivos = [
    { nome: "dfp_cia_aberta_BPA_con_2025.csv", linhas: [CAB_BPA,
      `${TIM};DF Consolidado - Balanço Patrimonial Ativo;REAL;MIL;PENÚLTIMO;2024-12-31;1;Ativo Total;0.0000000000;S`,
      `${TIM};DF Consolidado - Balanço Patrimonial Ativo;REAL;MIL;ÚLTIMO;2025-12-31;1;Ativo Total;0.0000000000;S`] },
    { nome: "dfp_cia_aberta_BPA_ind_2025.csv", linhas: [CAB_BPA,
      `${TIM};DF Individual - Balanço Patrimonial Ativo;REAL;MIL;PENÚLTIMO;2024-12-31;1;Ativo Total;56327311.0000000000;S`,
      `${TIM};DF Individual - Balanço Patrimonial Ativo;REAL;MIL;ÚLTIMO;2025-12-31;1;Ativo Total;56939179.0000000000;S`] },
    { nome: "dfp_cia_aberta_DRE_con_2025.csv", linhas: [CAB_DRE,
      `${TIM};DF Consolidado - Demonstração do Resultado;REAL;MIL;PENÚLTIMO;2024-01-01;2024-12-31;3.01;Receita de Venda de Bens e/ou Serviços;0.0000000000;S`,
      `${TIM};DF Consolidado - Demonstração do Resultado;REAL;MIL;ÚLTIMO;2025-01-01;2025-12-31;3.01;Receita de Venda de Bens e/ou Serviços;0.0000000000;S`] },
    { nome: "dfp_cia_aberta_DRE_ind_2025.csv", linhas: [CAB_DRE,
      `${TIM};DF Individual - Demonstração do Resultado;REAL;MIL;PENÚLTIMO;2024-01-01;2024-12-31;3.01;Receita de Venda de Bens e/ou Serviços;25447930.0000000000;S`,
      `${TIM};DF Individual - Demonstração do Resultado;REAL;MIL;ÚLTIMO;2025-01-01;2025-12-31;3.01;Receita de Venda de Bens e/ou Serviços;26624721.0000000000;S`] },
  ];
  const fatos = lerArquivos(arquivos);

  test("DFP de 2025: sai o consolidado zerado e vale o individual", () => {
    assert.ok(fatos.every((f) => f.consolidado === false));
    assert.equal(fatos.length, 4);
    const receita = fatos.find((f) => f.conta === "3.01" && f.ordem === "ultimo");
    assert.deepEqual([receita.valor, receita.consolidado], [26_624_721, false]);
    assert.equal(fatos.find((f) => f.conta === "1" && f.ordem === "ultimo").valor, 56_939_179);
  });

  test("consolidadosZerados diz qual documento, para o aviso", () => {
    // os fatos como saem do leitor, antes da escolha entre consolidado e individual
    const brutos = arquivos.flatMap((a) => { const ler = criarLeitor(a.nome); return a.linhas.map((l) => ler(l)).filter(Boolean); });
    assert.deepEqual(consolidadosZerados(brutos), [{ cnpj: "02.421.421/0001-11", cdCvm: "024929", documento: "dfp", dtRefer: "2025-12-31" }]);
  });

  test("a série anual da TIM sai com a receita do individual em 2025", () => {
    const serie = montarSeries(fatos);
    const p2025 = serie.anual.find((p) => p.fim === "2025-12-31");
    assert.equal(p2025.demonstrativos.DRE.contas.find((c) => c.conta === "3.01").valor, 26_624_721);
    assert.equal(p2025.demonstrativos.DRE.origem.consolidado, false);
  });

  // Sintéticos: os limites da regra.
  const f = (mudancas) => ({
    cnpj: "x", cdCvm: "1", documento: "dfp", demonstrativo: "BPA", consolidado: true, dtRefer: "2025-12-31", versao: 1, ordem: "ultimo",
    inicio: null, fim: "2025-12-31", conta: "1", descricao: "Ativo Total", contaFixa: true, valor: 100, ...mudancas,
  });

  test("consolidado com ativo maior que zero não muda: o individual sai, como antes", () => {
    const r = escolherConsolidado([f({}), f({ consolidado: false, valor: 90 })]);
    assert.deepEqual(r.map((x) => [x.consolidado, x.valor]), [[true, 100]]);
    assert.deepEqual(consolidadosZerados([f({})]), []);
  });

  test("só o PENÚLTIMO zerado não conta (ITR de 2026 da TIM): o consolidado do documento fica", () => {
    const r = escolherConsolidado([f({ documento: "itr", dtRefer: "2026-06-30", valor: 57_190_135 }), f({ documento: "itr", dtRefer: "2026-06-30", ordem: "penultimo", valor: 0 }), f({ documento: "itr", dtRefer: "2026-06-30", consolidado: false, valor: 1 })]);
    assert.ok(r.every((x) => x.consolidado));
    assert.equal(r.length, 2);
  });

  test("a regra é por documento: o zerado de um ano não tira o consolidado de outro", () => {
    const r = escolherConsolidado([
      f({ valor: 0 }), f({ consolidado: false, valor: 90 }),
      f({ dtRefer: "2023-12-31", fim: "2023-12-31", valor: 80 }), f({ dtRefer: "2023-12-31", fim: "2023-12-31", consolidado: false, valor: 70 }),
    ]);
    assert.deepEqual(r.map((x) => [x.dtRefer, x.consolidado, x.valor]), [["2025-12-31", false, 90], ["2023-12-31", true, 80]]);
  });

  test("consolidado zerado sem individual: o documento fica sem nada, e não com zeros", () => {
    assert.deepEqual(escolherConsolidado([f({ valor: 0 }), f({ conta: "1.01", valor: 0 })]), []);
  });

  test("zero em outra conta, ou no ativo total do individual, não dispara a regra", () => {
    assert.deepEqual(consolidadosZerados([f({ conta: "1.01", valor: 0 }), f({ consolidado: false, valor: 0 }), f({ demonstrativo: "BPP", conta: "2", valor: 0 })]), []);
  });

  test("vale a versão mais nova: a reapresentação preenchida desfaz o zerado", () => {
    const daVersao = escolherVersao([f({ valor: 0 }), f({ versao: 2, valor: 100 })]);
    assert.deepEqual(consolidadosZerados(daVersao), []);
  });

  test("na coleta, o aviso vai para o arquivo da companhia e para o índice", () => {
    const TIM_CIA = { cnpj: "02.421.421/0001-11", cdCvm: "024929", tickers: [{ ticker: "TIMS3", ibovespa: true }] };
    const extrator = criarExtrator([TIM_CIA]);
    for (const a of arquivos) { const receber = extrator.demonstrativo(a.nome); for (const l of a.linhas) receber(l); }
    const extratos = [{ arquivo: arq("dfp_cia_aberta_2025.zip"), extrato: extrator.extrato() }];
    const cia = montarCompanhia(TIM_CIA, extratos);
    assert.deepEqual(cia.avisos, ["consolidado zerado na DFP de 31/12/2025: vale o individual"]);
    assert.ok(cia.fatos.every((b) => b.consolidado === false));
    const { indice } = decidirSaida({ companhias: [TIM_CIA], arquivos: [arq("dfp_cia_aberta_2025.zip")], extratos, agora: new Date("2026-11-15T12:23:00Z"), anoCorrente: 2026 });
    assert.deepEqual(indice.companhias["024929"].avisos, cia.avisos);
  });
});

describe("Vivara: número de ações que diverge do documento anterior", () => {
  // A série da WEG com a composição trocada: 236.197.769 ações em junho e 82.118.477 em setembro,
  // os números da Vivara nos ITR de 2026.
  const nomes = readdirSync(new URL("weg/", DIR)).filter((n) => interpretarArquivo(n));
  const series = montarSeries(lerArquivos(nomes.map((nome) => ({ nome, linhas: texto("weg", nome).split("\n") }))));
  const comp = (dtRefer, total, tesouraria = 0) => ({
    cnpj: WEG.cnpj, dtRefer, versao: 1, acoesTotal: total, acoesTesouraria: tesouraria, acoesCirculacao: total - tesouraria,
    classes: { on: { total, tesouraria, circulacao: total - tesouraria }, pn: { total: 0, tesouraria: 0, circulacao: 0 } },
  });
  const com = (setembro, junho = 236_197_769) => calcularIndicadoresDaSerie(series, { composicoes: [comp("2025-12-31", 236_197_769), comp("2026-06-30", junho), comp("2026-09-30", setembro)] });
  const MOTIVO = "o número de ações do ITR de 30/09/2026 diverge -65% do documento anterior";

  test("diverge 65% para baixo: as ações e os valores por ação dos 12 meses ficam null com o motivo", () => {
    const r = com(82_118_477);
    assert.equal(r.doze.composicao, null);
    assert.equal(r.doze.motivoComposicao, MOTIVO);
    for (const id of ["acoesCirculacao", "lucroPorAcao", "fcoPorAcao", "fclPorAcao"]) assert.deepEqual(r.doze.indicadores[id], { valor: null, motivo: MOTIVO }, id);
    assert.ok(r.avisos.includes(MOTIVO));
    // o resto dos 12 meses e a série anual não mudam
    assert.equal(r.doze.indicadores.ebitda.valor, com(236_197_769).doze.indicadores.ebitda.valor);
    assert.equal(r.anual.at(-1).indicadores.acoesCirculacao.valor, 236_197_769);
  });

  test("o valor de mercado e os múltiplos que dependem dele ficam null com o mesmo motivo", () => {
    const r = com(82_118_477);
    const m = calcularMultiplos({
      fundamentos: fundamentosParaMultiplos(series.doze, r.doze.indicadores), composicao: r.doze.composicao, motivoComposicao: r.doze.motivoComposicao,
      tickers: WEG.tickers, cotacoes: { precos: { WEGE3: { preco: 50, dataHora: "2026-11-13T18:05:00.000-0300" } } }, hoje: "2026-11-13",
    });
    assert.deepEqual(m.multiplos.valorMercado, { valor: null, motivo: MOTIVO });
    assert.deepEqual(m.multiplos.pl, { valor: null, motivo: MOTIVO });
    assert.deepEqual(m.multiplos.ev, { valor: null, motivo: MOTIVO });
    assert.deepEqual(m.multiplos.dividendYield, { valor: null, motivo: MOTIVO });
  });

  test("usa o mesmo limite da diluição (50%), para cima e para baixo; o limite exato ainda passa", () => {
    assert.equal(LIMITE_DILUICAO, 0.5);
    assert.equal(com(300, 100).doze.motivoComposicao, "o número de ações do ITR de 30/09/2026 diverge +200% do documento anterior"); // desdobramento de 1 para 3
    assert.equal(com(150, 100).doze.motivoComposicao, null); // +50% exatos
    assert.equal(com(50, 100).doze.motivoComposicao, null); // −50% exatos
    assert.equal(com(49, 100).doze.motivoComposicao, "o número de ações do ITR de 30/09/2026 diverge -51% do documento anterior");
    assert.equal(com(236_197_769).doze.motivoComposicao, null);
  });

  test("a comparação é com o documento imediatamente anterior, não com o exercício anterior", () => {
    // desdobramento em junho: junho diverge de dezembro, mas setembro não diverge de junho
    const r = calcularIndicadoresDaSerie(series, { composicoes: [comp("2025-12-31", 1_000_000_000), comp("2026-06-30", 3_000_000_000), comp("2026-09-30", 3_000_000_000)] });
    assert.equal(r.doze.motivoComposicao, null);
    assert.equal(r.doze.composicao.acoesTotal, 3_000_000_000);
  });

  test("sem documento anterior não há com o que comparar: a composição vale", () => {
    const r = calcularIndicadoresDaSerie(series, { composicoes: [comp("2026-09-30", 82_118_477)] });
    assert.equal(r.doze.motivoComposicao, null);
    assert.equal(r.doze.composicao.dtRefer, "2026-09-30");
    assert.ok(r.doze.indicadores.acoesCirculacao.valor > 0);
  });

  test("com os dados reais da WEG nada diverge, e não há aviso", () => {
    const reais = nomes.length && readdirSync(new URL("weg/", DIR)).filter((n) => n.includes("composicao_capital")).flatMap((n) => lerComposicaoCapital(texto("weg", n)));
    const r = calcularIndicadoresDaSerie(series, { composicoes: reais });
    assert.deepEqual([r.doze.motivoComposicao, r.avisos], [null, []]);
  });
});

describe("escala das ações que muda de um documento para outro vira aviso", () => {
  const nomes = readdirSync(new URL("weg/", DIR)).filter((n) => interpretarArquivo(n));
  const series = montarSeries(lerArquivos(nomes.map((nome) => ({ nome, linhas: texto("weg", nome).split("\n") }))));
  const comp = (dtRefer, total) => ({ cnpj: WEG.cnpj, dtRefer, versao: 1, acoesTotal: total, acoesTesouraria: 0, acoesCirculacao: total });

  test("exercício em unidades e ITR em milhares: aviso com as duas datas", () => {
    // 4,2 bilhões em 2025 (unidade, pelo lucro por ação informado) e 4,2 milhões no ITR (mil, pela ordem de grandeza)
    const r = calcularIndicadoresDaSerie(series, { composicoes: [comp("2025-12-31", 4_197_317_998), comp("2026-09-30", 4_197_318)] });
    assert.deepEqual([r.anual.at(-1).composicao.escala, r.doze.composicao?.escala ?? null], ["unidade", null]);
    // total mil vezes menor também diverge do documento anterior: a composição não é usada, e o aviso é o da divergência
    assert.deepEqual(r.avisos, ["o número de ações do ITR de 30/09/2026 diverge -100% do documento anterior"]);
  });

  test("sem mudança de escala não há aviso", () => {
    const r = calcularIndicadoresDaSerie(series, { composicoes: [comp("2025-12-31", 4_197_317_998), comp("2026-09-30", 4_197_317_998)] });
    assert.deepEqual(r.avisos, []);
  });
});
