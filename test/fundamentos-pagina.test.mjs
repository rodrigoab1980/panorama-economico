// HTML da página Fundamentalista (#38): a ficha, a lista, o gráfico de tendência e os CSVs.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AVISO_LEGAL, BLOCOS, MARCADOR_DA_LISTA, MOTIVO_SEM_ACOES, celula, colunasDaFicha, csvsDaFicha, escapar, fichaHtml, formatoDoIndicador,
  formatoDoMultiplo, inserirLista, listaHtml, pastaDaFicha, quebrasDeAcoes, rotuloDoExercicio, tabelaAnual, tendenciaSvg,
} from "../scripts/fundamentos/pagina.mjs";
import { INDICADORES } from "../scripts/cvm/indicadores.mjs";
import { MULTIPLOS } from "../scripts/cvm/multiplos.mjs";
import { linksInternos } from "../scripts/paginas.mjs";
import { serializar } from "../scripts/cvm/coleta.mjs";
import { ARQUIVO, COTACOES, HOJE, WEG, fichaDaWeg } from "./apoio/ficha.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FICHA = fichaDaWeg();
const HTML = fichaHtml(FICHA, { hoje: HOJE, coletadoEm: "2026-11-14T00:57:29.000Z" });
// Texto de uma linha da tabela, pelo nome do indicador.
const linhaDe = (html, nome) => new RegExp(`<tr><th scope="row" class="fixa"[^>]*>${nome}</th>.*?</tr>`, "s").exec(html)?.[0] ?? null;
const celulasDe = (linha) => [...linha.matchAll(/<td class="n[^"]*"[^>]*>(.*?)<\/td>/gs)].map((m) => m[1].replace(/<[^>]+>/g, ""));

describe("blocos e formatos", () => {
  test("quatro blocos, na ordem: Resultado, Caixa e dívida, Fluxo de caixa e Valuation", () => {
    assert.deepEqual(BLOCOS.map((b) => [b.id, b.titulo]), [["resultado", "Resultado"], ["caixa-e-divida", "Caixa e dívida"], ["fluxo-de-caixa", "Fluxo de caixa"], ["valuation", "Valuation"]]);
  });

  test("todo indicador está em exatamente um bloco", () => {
    const nosBlocos = BLOCOS.flatMap((b) => b.indicadores);
    assert.equal(new Set(nosBlocos).size, nosBlocos.length);
    assert.deepEqual([...nosBlocos].sort(), INDICADORES.map((i) => i.id).sort());
  });

  test("os valores por ação ficam no Valuation, com o VPA", () => {
    assert.deepEqual(BLOCOS.at(-1).indicadores, ["acoesCirculacao", "diluicao", "lucroPorAcao", "valorPatrimonialPorAcao", "fcoPorAcao", "fclPorAcao"]);
  });

  test("formato de cada indicador: moeda, percentual, vezes, por ação ou ações", () => {
    assert.equal(formatoDoIndicador("receita"), "moeda");
    assert.equal(formatoDoIndicador("margemBruta"), "pct");
    assert.equal(formatoDoIndicador("roe"), "pct");
    assert.equal(formatoDoIndicador("dividaLiquidaSobreEbitda"), "vezes");
    assert.equal(formatoDoIndicador("coberturaJuros"), "vezes");
    assert.equal(formatoDoIndicador("liquidezCorrente"), "vezes");
    assert.equal(formatoDoIndicador("lucroPorAcao"), "porAcao");
    assert.equal(formatoDoIndicador("acoesCirculacao"), "acoes");
    assert.equal(formatoDoIndicador("diluicao"), "pct");
    assert.throws(() => formatoDoIndicador("naoExiste"), /indicador desconhecido/);
    for (const { id } of INDICADORES) assert.ok(["moeda", "pct", "vezes", "porAcao", "acoes"].includes(formatoDoIndicador(id)), id);
    assert.deepEqual(MULTIPLOS.map((m) => formatoDoMultiplo(m.id)), ["moeda", "vezes", "vezes", "moeda", "vezes", "vezes", "pct", "pct", "vezes", "vezes"]);
  });
});

describe("escapar e pasta da ficha", () => {
  test("escapar troca &, <, >, aspas e apóstrofo", () => {
    assert.equal(escapar(`Fulano & Cia <S.A.> "x" 'y'`), "Fulano &amp; Cia &lt;S.A.&gt; &quot;x&quot; &#39;y&#39;");
    assert.equal(escapar(null), "");
    assert.equal(escapar(12), "12");
  });

  test("nome de companhia com < ou & não vira HTML na ficha nem na lista", () => {
    const ficha = fichaDaWeg({ mudar: (f) => { f.nome = `M&A <script>alert("x")</script> S.A.`; f.setor = "Bens <b>industriais</b>"; f.avisos = ["aviso com <img src=x onerror=alert(1)>"]; } });
    const html = fichaHtml(ficha, { hoje: HOJE });
    assert.ok(!html.includes("<script>alert"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(!html.includes("<b>industriais</b>"));
    assert.ok(html.includes("M&amp;A &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; S.A."));
    const lista = listaHtml({ companhias: [{ ticker: "WEGE3", nome: `M&A <script>x</script>`, setor: `A&B "C"`, ficha: true }] });
    assert.ok(!lista.includes("<script>"));
    assert.ok(lista.includes("M&amp;A &lt;script&gt;x&lt;/script&gt;"));
    assert.ok(lista.includes("A&amp;B &quot;C&quot;"));
  });

  test("pasta da ficha: o ticker em minúsculas, só com letras e números", () => {
    assert.equal(pastaDaFicha("WEGE3"), "wege3");
    assert.equal(pastaDaFicha("KLBN11"), "klbn11");
    assert.equal(pastaDaFicha("../etc"), "etc");
    assert.throws(() => pastaDaFicha("../"), /ticker inválido/);
    assert.throws(() => pastaDaFicha(null), /ticker inválido/);
  });

  test("link de documento que não é http(s) não entra na página", () => {
    const ficha = fichaDaWeg({ mudar: (f) => { f.anual.at(-1).origem.link = "javascript:alert(1)"; } });
    const html = fichaHtml(ficha, { hoje: HOJE });
    assert.ok(!html.includes("javascript:"));
  });
});

describe("colunas da ficha", () => {
  const colunas = colunasDaFicha(FICHA);

  test("primeiro os 12 meses, depois os exercícios do mais recente ao mais antigo", () => {
    assert.deepEqual(colunas.map((c) => [c.chave, c.rotulo, c.detalhe, c.hoje]), [
      ["12m", "12 meses", "até 30/09/2026", true], ["2025-12-31", "2025", null, false], ["2024-12-31", "2024", null, false],
    ]);
  });

  test("cada coluna diz de qual documento saiu, com o link que a CVM informa", () => {
    assert.equal(colunas[0].origem, "Soma de 12 meses: DFP de 31/12/2025, versão 1 + ITR de 30/09/2026, versão 1 − ITR de 30/09/2025, versão 1");
    assert.equal(colunas[1].origem, "DFP de 31/12/2025, versão 1");
    assert.equal(colunas[2].origem, "DFP de 31/12/2025, versão 1 (coluna do ano anterior)");
    assert.deepEqual(colunas[1].documentos, [{
      rotulo: "DFP de 31/12/2025, versão 1", curto: "DFP 31/12/2025",
      link: "http://www.rad.cvm.gov.br/ENETCONSULTA/frmDownloadDocumento.aspx?CodigoInstituicao=1&NumeroSequencialDocumento=154872",
    }]);
    assert.deepEqual(colunas[0].documentos.map((d) => d.curto), ["DFP 31/12/2025", "ITR 30/09/2026", "ITR 30/09/2025"]);
  });

  test("exercício que não termina em dezembro leva o mês; período de transição diz quantos meses tem", () => {
    assert.equal(rotuloDoExercicio("2025-12-31"), "2025");
    assert.equal(rotuloDoExercicio("2026-03-31"), "03/2026");
    const ficha = fichaDaWeg({ mudar: (f) => { Object.assign(f.anual[0], { inicio: "2024-04-01", fim: "2024-12-31", tipo: "transicao", meses: 9 }); } });
    const transicao = colunasDaFicha(ficha).at(-1);
    assert.deepEqual([transicao.rotulo, transicao.detalhe], ["2024", "9 meses"]);
    assert.match(transicao.origem, /Exercício de 9 meses, de 01\/04\/2024 a 31\/12\/2024/);
    assert.match(fichaHtml(ficha, { hoje: HOJE }), /<th scope="col" class="ano"[^>]*>2024<small>9 meses<\/small><\/th>/);
  });

  test("12 meses indisponíveis: a coluna existe, e a origem diz o motivo", () => {
    const motivo = "a companhia passou a consolidar";
    const ficha = fichaDaWeg({ mudar: (f) => { f.doze.motivo = motivo; f.doze.origem = []; for (const id of Object.keys(f.doze.indicadores)) f.doze.indicadores[id] = { valor: null, motivo }; } });
    const [doze] = colunasDaFicha(ficha);
    assert.equal(doze.origem, "Base de 12 meses indisponível: a companhia passou a consolidar");
    const linha = linhaDe(fichaHtml(ficha, { hoje: HOJE }), "Receita líquida");
    assert.match(linha, /<td class="n hoje vazio" title="a companhia passou a consolidar">—<\/td>/);
  });

  test("celula: valor, ou null com o motivo; antes de 2020 o motivo dos valores por ação é o da CVM", () => {
    assert.deepEqual(celula(colunas[1], "receita"), { valor: 40_804_110, motivo: null });
    const sem = { hoje: false, fim: "2019-12-31", indicadores: { lucroPorAcao: { valor: null, motivo: "falta a composição do capital do período" }, receita: { valor: null, motivo: "falta a conta 3.01" } } };
    assert.deepEqual(celula(sem, "lucroPorAcao"), { valor: null, motivo: MOTIVO_SEM_ACOES });
    assert.equal(MOTIVO_SEM_ACOES, "a CVM só informa o número de ações a partir de 2020");
    assert.deepEqual(celula(sem, "receita"), { valor: null, motivo: "falta a conta 3.01" }); // outros indicadores mantêm o motivo
    // de 2020 em diante o motivo original fica
    assert.equal(celula({ ...sem, fim: "2020-12-31" }, "lucroPorAcao").motivo, "falta a composição do capital do período");
    // outro motivo antes de 2020 também fica
    const outro = { hoje: false, fim: "2018-12-31", indicadores: { lucroPorAcao: { valor: null, motivo: "a companhia não abre o lucro" } } };
    assert.equal(celula(outro, "lucroPorAcao").motivo, "a companhia não abre o lucro");
    assert.deepEqual(celula({ indicadores: {} }, "receita"), { valor: null, motivo: "indicador não calculado" });
  });
});

describe("ficha da WEG: os números certos, já no HTML", () => {
  test("cabeçalho: nome, setor, ticker com a cotação, a fonte e o horário", () => {
    assert.match(HTML, /<h2>WEG S\.A\.<\/h2>/);
    assert.match(HTML, /<p class="setor">Bens industriais<\/p>/);
    assert.match(HTML, /<li><strong>WEGE3<\/strong> <span class="n">R\$ 51,31<\/span> <time>13\/11\/2026 18:05<\/time><\/li>/);
    assert.match(HTML, /Cotação: CNBC \(atraso de até 15 min\)\./);
    assert.match(HTML, /<title>WEGE3 · WEG S\.A\. · Fundamentalista · Panorama Econômico<\/title>/);
  });

  test("lucro de 2025 (R$ 6,8 bi) e a coluna de 12 meses (R$ 6,7 bi), nessa ordem", () => {
    const lucro = celulasDe(linhaDe(HTML, "Lucro líquido"));
    assert.deepEqual(lucro, ["R$ 6,7 bi", "R$ 6,8 bi", "R$ 6,3 bi"]); // 12 meses, 2025, 2024
    assert.equal(FICHA.anual.at(-1).indicadores.lucroLiquido.valor, 6_775_958);
    assert.equal(FICHA.doze.indicadores.lucroLiquido.valor, 6_690_278);
  });

  test("receita, margem, EBITDA e dívida líquida (negativa: caixa líquido)", () => {
    assert.deepEqual(celulasDe(linhaDe(HTML, "Receita líquida")), ["R$ 40,7 bi", "R$ 40,8 bi", "R$ 38,0 bi"]);
    assert.deepEqual(celulasDe(linhaDe(HTML, "Margem bruta")), ["33,0%", "33,5%", "33,7%"]);
    assert.deepEqual(celulasDe(linhaDe(HTML, "EBITDA")).slice(0, 2), ["R$ 9,0 bi", "R$ 9,0 bi"]);
    assert.deepEqual(celulasDe(linhaDe(HTML, "Dívida líquida")).slice(0, 2), ["−R$ 2,6 bi", "−R$ 2,7 bi"]);
    assert.match(linhaDe(HTML, "Dívida líquida"), /<td class="n hoje neg"><span class="menos">−<\/span>R\$ 2,6 bi<\/td>/);
  });

  test("onde não há valor aparece — com o motivo no title, nunca 0", () => {
    const linha = linhaDe(HTML, "FCL depois dos arrendamentos");
    assert.deepEqual(celulasDe(linha), ["—", "—", "—"]);
    assert.match(linha, /<td class="n hoje vazio" title="pagamento de arrendamento não identificado na DFC">—<\/td>/);
    // nenhuma célula vazia fica sem motivo, e nenhum null virou zero
    const vazias = [...HTML.matchAll(/<td class="n[^"]*\bvazio\b[^"]*"([^>]*)>/g)];
    assert.ok(vazias.length > 0);
    for (const [, atributos] of vazias) assert.match(atributos, /title="[^"]+"/);
    const nulos = Object.values(FICHA.anual.at(-1).indicadores).filter((r) => r.valor == null).length;
    assert.ok(nulos > 0);
  });

  test("valores por ação e a diluição do primeiro exercício da fixture", () => {
    assert.deepEqual(celulasDe(linhaDe(HTML, "Lucro por ação")).slice(0, 2), ["R$ 1,49", "R$ 1,52"]);
    assert.deepEqual(celulasDe(linhaDe(HTML, "Ações em circulação")).slice(0, 2), ["4,2 bi", "4,2 bi"]);
    const vpa = celulasDe(linhaDe(HTML, "Valor patrimonial por ação \\(VPA\\)"));
    assert.equal(vpa[1], "R$ 4,15"); // (18.553.364 − 1.136.179) mil ÷ 4.195.695.973 ações
  });

  test("o nome do indicador traz a fórmula no title", () => {
    assert.match(HTML, /<th scope="row" class="fixa" title="EBIT \+ depreciação e amortização">EBITDA<\/th>/);
    for (const { nome, formula } of INDICADORES) assert.ok(HTML.includes(`title="${escapar(formula)}">${escapar(nome)}</th>`), nome);
  });

  test("rodapé de cada tabela: o documento de cada coluna, com o link da CVM", () => {
    assert.match(HTML, /<tfoot><tr><th scope="row" class="fixa"[^>]*>Documento<\/th>/);
    assert.match(HTML, /<a href="http:\/\/www\.rad\.cvm\.gov\.br\/ENETCONSULTA\/frmDownloadDocumento\.aspx\?CodigoInstituicao=1&amp;NumeroSequencialDocumento=154872" rel="noopener external" title="DFP de 31\/12\/2025, versão 1, na CVM">DFP 31\/12\/2025<\/a>/);
    // sem o link (coleta antiga), o documento fica em texto
    const sem = fichaHtml(fichaDaWeg({ mudar: (f) => { for (const p of f.anual) p.origem.link = null; for (const p of f.doze.origem) p.link = null; } }), { hoje: HOJE });
    assert.ok(!sem.includes("rad.cvm.gov.br"));
    assert.match(sem, /<span title="DFP de 31\/12\/2025, versão 1">DFP 31\/12\/2025<\/span>/);
  });

  test("valuation: os múltiplos só na coluna de hoje, com a frase que explica por quê", () => {
    assert.match(HTML, /Os múltiplos dependem do preço da ação, e esta versão do site não tem preço histórico\./);
    assert.match(HTML, /<th scope="col" class="hoje">Hoje<small>preço de 13\/11\/2026<\/small><\/th>/);
    const pl = FICHA.multiplos.multiplos.pl.valor;
    assert.ok(HTML.includes(`>P/L</th><td class="n hoje pos">${pl.toFixed(1).replace(".", ",")}x</td>`));
    assert.match(HTML, />Preço\/FCL depois dos arrendamentos<\/th><td class="n hoje vazio" title="pagamento de arrendamento não identificado na DFC">—<\/td><td class="motivo">pagamento de arrendamento não identificado na DFC<\/td>/);
    for (const m of MULTIPLOS) assert.ok(HTML.includes(`>${escapar(m.nome)}</th>`), m.id);
  });

  test("o espaço do resumo de consistência existe e, com a #39, vem preenchido e visível, antes dos blocos", () => {
    assert.match(HTML, /<section class="resumo" id="resumo-consistencia">\n<h3>Ao longo dos anos<\/h3>/);
    assert.ok(HTML.indexOf('id="resumo-consistencia"') < HTML.indexOf('<section class="bloco" id="resultado">'));
  });

  test("aviso legal fixo, com a fonte e a data da coleta", () => {
    assert.equal(AVISO_LEGAL, "Dados para estudo, extraídos dos documentos entregues à CVM. Não é recomendação de investimento.");
    assert.ok(HTML.includes(`<strong>${AVISO_LEGAL}</strong>`));
    assert.match(HTML, /Fonte: CVM, Dados Abertos \(DFP e ITR\), coleta de 13\/11\/2026 21:57\. Preço: CNBC \(atraso de até 15 min\), coleta de 13\/11\/2026 19:07\./);
  });

  test("cada bloco tem o link do CSV, e os quatro CSVs existem", () => {
    for (const b of BLOCOS) assert.ok(HTML.includes(`<a class="csv" href="${b.id}.csv" download>baixar CSV</a>`), b.id);
    assert.deepEqual(Object.keys(csvsDaFicha(FICHA)), ["resultado.csv", "caixa-e-divida.csv", "fluxo-de-caixa.csv", "valuation.csv"]);
  });

  test("todos os links internos são relativos, e os de fora são só a fonte e a CVM", () => {
    const internos = linksInternos(HTML);
    assert.ok(internos.length >= 8);
    for (const l of internos) assert.ok(!l.startsWith("/"), l);
    assert.ok(internos.includes("../../tokens.css") && internos.includes("../fundamentos.css") && internos.includes("../ficha.js") && internos.includes("../"));
    const externos = [...HTML.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map((m) => new URL(m[1].replace(/&amp;/g, "&")).hostname);
    assert.deepEqual([...new Set(externos)].sort(), ["fonts.googleapis.com", "fonts.gstatic.com", "www.rad.cvm.gov.br"]);
  });

  test("funciona sem JS: as tabelas estão no HTML e o único script é o da camada extra", () => {
    assert.equal((HTML.match(/<table class="serie/g) ?? []).length, 5); // quatro séries e a dos múltiplos
    assert.deepEqual([...HTML.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['<script src="../ficha.js" defer>']);
    assert.ok(!/\son\w+=/.test(HTML)); // nenhum manipulador de evento no HTML
  });

  test("nenhum texto de recomendação na página", () => {
    const visivel = HTML.replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(visivel, /\bcompre\b|\bvenda\b|barat|\bcar[oa]\b|atrativ|preço-alvo|\bnota\b \d|recomendamos|oportunidade/i);
    assert.match(visivel, /Não é recomendação de investimento/);
  });

  test("o marcador do menu fica no cabeçalho, para o build trocar", () => {
    assert.equal(HTML.split("<!-- menu -->").length, 2);
  });
});

describe("carimbo e cotação na ficha", () => {
  test("em dia: sem carimbo", () => {
    assert.ok(!HTML.includes('class="carimbo"'));
  });

  test("documento atrasado: o carimbo aparece com a frase", () => {
    const html = fichaHtml(FICHA, { hoje: "2027-04-10" });
    assert.match(html, /<p class="carimbo">Dados até o ITR de 30\/09\/2026\. A DFP de 31\/12\/2026 já deveria ter sido entregue \(prazo da DFP: 31\/03\/2027\)\.<\/p>/);
  });

  test("cotação com mais de 5 dias úteis: aviso com a data do preço", () => {
    const ficha = fichaDaWeg({ hoje: "2026-12-01" });
    assert.equal(ficha.multiplos.desatualizado, true);
    assert.match(fichaHtml(ficha, { hoje: "2026-12-01" }), /<p class="carimbo">Cotação desatualizada: o preço usado nos múltiplos é de 13\/11\/2026\.<\/p>/);
  });

  test("sem cotação: o ticker aparece com —, e a página diz que não há cotação", () => {
    const html = fichaHtml(fichaDaWeg({ cotacoes: null }), { hoje: HOJE });
    assert.match(html, /<li><strong>WEGE3<\/strong> <span class="vazio" title="sem cotação coletada para este ticker">—<\/span><\/li>/);
    assert.match(html, /<p class="fonte">Sem cotação coletada\.<\/p>/);
    assert.match(html, /<th scope="col" class="hoje">Hoje<small>sem preço<\/small><\/th>/);
  });

  test("companhia com dois tickers: cada um com a sua cotação; o que não tem fica com —", () => {
    const companhia = { ...WEG, tickers: [{ ticker: "WEGE3", ibovespa: true }, { ticker: "WEGE4", ibovespa: false }] };
    const html = fichaHtml(fichaDaWeg({ companhia }), { hoje: HOJE });
    assert.match(html, /<strong>WEGE3<\/strong> <span class="n">R\$ 51,31<\/span>/);
    assert.match(html, /<strong>WEGE4<\/strong> <span class="vazio"/);
  });
});

describe("valores por ação: antes de 2020 e quebra por desdobramento", () => {
  // A série da WEG esticada: 2019 sem composição do capital, e 2021 com o dobro de ações de 2020.
  const ficha = fichaDaWeg({ mudar: (f) => {
    const modelo = f.anual.at(-1);
    const ano = (fim, mudancas) => {
      const p = structuredClone(modelo);
      Object.assign(p, { inicio: `${fim.slice(0, 4)}-01-01`, fim });
      Object.assign(p.indicadores, mudancas);
      return p;
    };
    const sem = { valor: null, motivo: "falta a composição do capital do período" };
    f.anual = [
      ano("2019-12-31", { acoesCirculacao: sem, diluicao: sem, lucroPorAcao: sem, valorPatrimonialPorAcao: sem, fcoPorAcao: sem, fclPorAcao: sem }),
      ano("2020-12-31", { diluicao: { valor: null, motivo: "falta a composição do capital do exercício anterior" } }),
      ano("2021-12-31", { diluicao: { valor: null, motivo: "variação de +100% sugere desdobramento ou grupamento" } }),
      ano("2022-12-31", { diluicao: { valor: 0.001, motivo: null } }),
    ];
  } });
  const html = fichaHtml(ficha, { hoje: HOJE });

  test("antes de 2020 a linha mostra — com o motivo da CVM", () => {
    const linha = linhaDe(html, "Lucro por ação");
    assert.equal(celulasDe(linha).at(-1), "—");
    assert.match(linha, /<td class="n vazio" title="a CVM só informa o número de ações a partir de 2020">—<\/td><\/tr>$/);
    assert.match(html, /<li>Antes de 2020 não há valores por ação: a CVM só informa o número de ações a partir de 2020\.<\/li>/);
  });

  test("quebrasDeAcoes acha o exercício em que o número de ações mudou", () => {
    assert.deepEqual(quebrasDeAcoes(ficha), [{ fim: "2021-12-31", anterior: "2020-12-31", variacao: "+100" }]);
    assert.deepEqual(quebrasDeAcoes(FICHA), []);
  });

  test("a quebra é marcada na tabela de valores por ação, com a nota, e os valores antigos não são ajustados", () => {
    assert.match(html, /<li>O número de ações mudou \+100% entre 2020 e 2021; os valores por ação antes disso não são comparáveis\. Os valores antigos não foram ajustados\.<\/li>/);
    const valuation = html.slice(html.indexOf('<section class="bloco" id="valuation">'));
    // a borda fica na coluna de 2021 (à direita dela está 2020), no cabeçalho e nas células
    assert.match(valuation, /<th scope="col" class="ano quebra"[^>]*>2021<\/th>/);
    assert.equal((valuation.match(/<th scope="col" class="ano quebra"/g) ?? []).length, 1);
    assert.ok((valuation.match(/<td class="n quebra/g) ?? []).length >= 6);
    // nos outros blocos não há marca
    assert.ok(!html.slice(0, html.indexOf('<section class="bloco" id="valuation">')).includes("quebra"));
    // 2020 e 2021 mostram o mesmo LPA do modelo: nada foi ajustado
    const lpa = celulasDe(linhaDe(html, "Lucro por ação"));
    assert.equal(lpa[2], lpa[3]);
  });

  test("grupamento: a variação negativa sai com o sinal de menos", () => {
    const f = fichaDaWeg({ mudar: (x) => { x.anual.at(-1).indicadores.diluicao = { valor: null, motivo: "variação de -94% sugere desdobramento ou grupamento" }; } });
    assert.deepEqual(quebrasDeAcoes(f), [{ fim: "2025-12-31", anterior: "2024-12-31", variacao: "−94" }]);
  });
});

describe("gráfico de tendência", () => {
  test("SVG pequeno, sem biblioteca, do mais antigo ao mais recente, com o último ponto marcado", () => {
    const svg = tendenciaSvg([1, 2, 3, 4]);
    assert.match(svg, /^<svg class="tendencia" viewBox="0 0 84 22" width="84" height="22" aria-hidden="true" focusable="false">/);
    assert.equal((svg.match(/<polyline/g) ?? []).length, 1);
    const pontos = /points="([^"]+)"/.exec(svg)[1].split(" ").map((p) => p.split(",").map(Number));
    assert.equal(pontos.length, 4);
    assert.ok(pontos[0][0] < pontos[3][0]); // o mais antigo fica à esquerda
    assert.ok(pontos[0][1] > pontos[3][1]); // o maior valor fica em cima
    assert.match(svg, /<circle class="fim" cx="81\.5" cy="2\.5" r="2"\/><\/svg>$/);
  });

  test("ano sem valor vira buraco na linha, e não zero", () => {
    const svg = tendenciaSvg([1, 2, null, 4, 5]);
    assert.equal((svg.match(/<polyline/g) ?? []).length, 2);
    const trechos = [...svg.matchAll(/points="([^"]+)"/g)].map((m) => m[1].split(" ").length);
    assert.deepEqual(trechos, [2, 2]);
    // o eixo vertical vai de 1 a 5: o buraco não puxou a escala para zero
    assert.ok(!svg.includes('class="zero"'));
  });

  test("ponto isolado entre dois buracos aparece como ponto", () => {
    const svg = tendenciaSvg([null, 3, null, 5, 6]);
    assert.equal((svg.match(/<circle cx=/g) ?? []).length, 1);
    assert.equal((svg.match(/<polyline/g) ?? []).length, 1);
  });

  test("série que cruza o zero ganha a linha do zero; série toda positiva ou toda negativa, não", () => {
    assert.ok(tendenciaSvg([-1, 2, 3]).includes('class="zero"'));
    assert.ok(!tendenciaSvg([1, 2, 3]).includes('class="zero"'));
    assert.ok(!tendenciaSvg([-3, -2, -1]).includes('class="zero"'));
  });

  test("sem nenhum valor não há gráfico; valores iguais dão uma linha reta no meio", () => {
    assert.equal(tendenciaSvg([null, null]), "");
    assert.equal(tendenciaSvg([]), "");
    assert.match(tendenciaSvg([5, 5, 5]), /points="2\.5,11\.0 42\.0,11\.0 81\.5,11\.0"/);
    assert.match(tendenciaSvg([7]), /<circle cx="2\.5" cy="11\.0" r="1\.4"\/>/);
  });

  test("na tabela, o gráfico usa só a série anual (sem os 12 meses), do mais antigo ao mais recente", () => {
    const colunas = colunasDaFicha(FICHA);
    const tabela = tabelaAnual(BLOCOS[0], colunas);
    const linha = linhaDe(tabela, "Receita líquida");
    const pontos = /points="([^"]+)"/.exec(linha)[1].split(" ");
    assert.equal(pontos.length, 2); // 2024 e 2025
    // receita de 2024 (38,0) menor que a de 2025 (40,8): a linha sobe
    assert.ok(Number(pontos[0].split(",")[1]) > Number(pontos[1].split(",")[1]));
  });
});

describe("CSVs da ficha", () => {
  const csvs = csvsDaFicha(FICHA);
  const linhas = (nome) => csvs[nome].slice(1).split("\r\n");

  test("resultado.csv: cabeçalho com os períodos da tabela e os valores sem abreviação", () => {
    const l = linhas("resultado.csv");
    assert.equal(l[0], "Indicador;Unidade;12 meses até 30/09/2026;2025;2024");
    assert.equal(l[1], "Receita líquida;R$ mil;40719467;40804110;37986941");
    assert.equal(l.length, BLOCOS[0].indicadores.length + 2);
    assert.ok(csvs["resultado.csv"].startsWith("﻿"));
  });

  test("null vira célula vazia", () => {
    const fcl = linhas("fluxo-de-caixa.csv").find((x) => x.startsWith("FCL depois dos arrendamentos;"));
    assert.equal(fcl, "FCL depois dos arrendamentos;R$ mil;;;");
  });

  test("valuation.csv: os valores por ação de cada exercício e os múltiplos só na coluna dos 12 meses", () => {
    const l = linhas("valuation.csv");
    const pl = l.find((x) => x.startsWith("P/L;"));
    assert.match(pl, /^P\/L;vezes;\d+,\d+;;$/);
    const lpa = l.find((x) => x.startsWith("Lucro por ação;"));
    assert.match(lpa, /^Lucro por ação;R\$ por ação;1,49\d*;1,51\d*;/);
    assert.equal(l.length, 6 + MULTIPLOS.length + 2);
  });

  test("razões em fração e a unidade dizendo isso", () => {
    const margem = linhas("resultado.csv").find((x) => x.startsWith("Margem bruta;"));
    assert.match(margem, /^Margem bruta;fração \(0,10 = 10%\);0,3295\d*;0,3353\d*;0,3373\d*$/);
  });
});

describe("lista de companhias", () => {
  const indice = {
    coletadoEm: "2026-11-14T00:57:29.000Z",
    companhias: [
      { ticker: "WEGE3", nome: "WEG S.A.", setor: "Bens industriais", ficha: true },
      { ticker: "EMBJ3", nome: "EMBRAER S.A.", setor: "Bens industriais", ficha: true },
      { ticker: "ABEV3", nome: "AMBEV S.A.", setor: "Alimentos e bebidas", ficha: true },
      { ticker: "XXXX3", nome: "Sem Dados S.A.", setor: "Alimentos e bebidas", ficha: false, motivo: "falhou dfp_cia_aberta_2025.zip (GET 404)" },
      { ticker: "ZZZZ3", nome: "Sem Setor S.A.", setor: null, ficha: true },
    ],
  };
  const html = listaHtml(indice);

  test("agrupadas por setor, em ordem alfabética; dentro do setor, por ticker", () => {
    assert.deepEqual([...html.matchAll(/<h3>([^<]+) <small>(\d+)<\/small><\/h3>/g)].map((m) => [m[1], m[2]]), [["Alimentos e bebidas", "2"], ["Bens industriais", "2"], ["Outros", "1"]]);
    assert.ok(html.indexOf("<strong>EMBJ3") < html.indexOf("<strong>WEGE3"));
  });

  test("cada companhia tem ticker, nome e um link relativo para a ficha", () => {
    assert.match(html, /<li data-busca="wege3 weg s\.a\."><a href="wege3\/"><strong>WEGE3<\/strong> <span>WEG S\.A\.<\/span><\/a><\/li>/);
    for (const l of linksInternos(html)) assert.match(l, /^[a-z0-9]+\/$/);
    assert.equal(linksInternos(html).length, 4);
  });

  test("companhia sem ficha aparece sem link, com o motivo", () => {
    assert.match(html, /<li data-busca="xxxx3 sem dados s\.a\." class="sem-ficha" title="falhou dfp_cia_aberta_2025\.zip \(GET 404\)"><strong>XXXX3<\/strong> <span>Sem Dados S\.A\.<\/span> <em>sem ficha<\/em><\/li>/);
  });

  test("a busca vem escondida (só o JS mostra), e a lista inteira está no HTML", () => {
    assert.match(html, /<div class="busca" hidden>/);
    assert.equal((html.match(/<li data-busca=/g) ?? []).length, 5);
    assert.match(html, /4 empresas, com dados coletados em 13\/11\/2026 21:57\./);
  });

  test("o texto de busca vai sem acento e em minúsculas", () => {
    assert.match(listaHtml({ companhias: [{ ticker: "CSAN3", nome: "COSAN S.A. INDÚSTRIA E COMÉRCIO", setor: "x", ficha: true }] }), /data-busca="csan3 cosan s\.a\. industria e comercio"/);
  });

  test("sem dados coletados: uma frase no lugar da lista", () => {
    for (const vazio of [null, { companhias: [] }]) assert.match(listaHtml(vazio), /^<p class="sem-dados">Os dados das companhias ainda não foram coletados\./);
  });

  test("inserirLista troca o marcador, e exige exatamente um", () => {
    assert.equal(inserirLista(`<main>${MARCADOR_DA_LISTA}</main>`, "<p>x</p>"), "<main><p>x</p></main>");
    assert.throws(() => inserirLista("<main></main>", "x"), /exatamente um/);
    assert.equal(readFileSync(join(RAIZ, "site", "fundamentos", "index.html"), "utf8").split(MARCADOR_DA_LISTA).length, 2);
  });
});

describe("build: a lista e uma página por companhia", () => {
  let pasta;
  const build = (dados, dist) => execFileSync(process.execPath, [join(RAIZ, "scripts", "build.mjs"), "site", dist], { cwd: RAIZ, encoding: "utf8", env: { ...process.env, DADOS_DIR: dados }, stdio: "pipe" });
  const universo = JSON.parse(readFileSync(join(RAIZ, "scripts", "cvm", "universo.json"), "utf8")).mapeadas.filter((c) => !c.foraDaPagina);

  before(() => { pasta = mkdtempSync(join(tmpdir(), "pagina-fundamentos-")); });
  after(() => { rmSync(pasta, { recursive: true, force: true }); });

  test("sem dados/fundamentos: o build não falha, e a lista sai com o aviso", () => {
    const dist = join(pasta, "dist-sem");
    const saida = build(join(pasta, "nao-existe"), dist);
    assert.match(saida, /build pronto/);
    const lista = readFileSync(join(dist, "fundamentos", "index.html"), "utf8");
    assert.match(lista, /Os dados das companhias ainda não foram coletados/);
    assert.ok(!lista.includes(MARCADOR_DA_LISTA));
    assert.ok(lista.includes('class="menu-site"'));
    for (const f of ["fundamentos.css", "ficha.js", "lista.js"]) assert.ok(existsSync(join(dist, "fundamentos", f)), f);
    assert.deepEqual(readdirSync(join(dist, "fundamentos")).sort(), ["ficha.js", "fundamentos.css", "index.html", "lista.js"]);
  });

  test("com os fatos das 64 companhias: gera 64 fichas, os CSVs e a lista", () => {
    // Os fatos da WEG servem de dados para todas: muda só o cnpj e o código de cada uma.
    const dados = join(pasta, "dados");
    mkdirSync(join(dados, "fundamentos"), { recursive: true });
    for (const c of universo) writeFileSync(join(dados, "fundamentos", `${c.cdCvm}.json`), serializar({ ...ARQUIVO, cnpj: c.cnpj, cdCvm: c.cdCvm, composicoes: ARQUIVO.composicoes.map((x) => ({ ...x, cnpj: c.cnpj })) }));
    writeFileSync(join(dados, "fundamentos", "indice.json"), JSON.stringify({ coletadoEm: "2026-11-14T00:57:29.000Z", companhias: {} }));
    writeFileSync(join(dados, "cotacoes-fundamentos.json"), JSON.stringify(COTACOES));

    const dist = join(pasta, "dist-com");
    const saida = build(dados, dist);
    assert.match(saida, /fichas: 64 de 64 companhias/);
    assert.match(saida, /páginas das companhias: 64 em \d+ ms/);
    assert.equal(universo.length, 64);

    const pastas = readdirSync(join(dist, "fundamentos"), { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== "dados").map((e) => e.name);
    assert.equal(pastas.length, 64);
    for (const p of pastas) {
      assert.match(p, /^[a-z0-9]+$/);
      assert.deepEqual(readdirSync(join(dist, "fundamentos", p)).sort(), ["caixa-e-divida.csv", "fluxo-de-caixa.csv", "index.html", "resultado.csv", "valuation.csv"]);
    }
    const weg = readFileSync(join(dist, "fundamentos", "wege3", "index.html"), "utf8");
    assert.match(weg, /<h2>WEG S\.A\.<\/h2>/);
    assert.ok(weg.includes('class="menu-site"'));
    assert.ok(!weg.includes("<!-- menu --><!--"));
    // o menu, visto de duas pastas abaixo da raiz
    assert.match(weg, /<a href="\.\.\/\.\.\/" title="visão de trade">Diário<\/a>/);
    assert.match(weg, /<a href="\.\.\/\.\.\/fundamentos\/" aria-current="page"/);
    assert.match(weg, /<link rel="stylesheet" href="\.\.\/\.\.\/menu\.css">/);

    const lista = readFileSync(join(dist, "fundamentos", "index.html"), "utf8");
    assert.equal((lista.match(/<li data-busca=/g) ?? []).length, 64);
    assert.equal((lista.match(/<a href="[a-z0-9]+\/">/g) ?? []).length, 64);

    // nenhum link interno quebrado nem absoluto, na lista e nas fichas
    const conferir = (arquivo) => {
      const base = join(arquivo, "..");
      for (const link of linksInternos(readFileSync(arquivo, "utf8"))) {
        assert.ok(!link.startsWith("/"), `${arquivo}: ${link}`);
        let alvo = join(base, link.split(/[?#]/)[0]);
        if (link.endsWith("/")) alvo = join(alvo, "index.html");
        assert.ok(existsSync(alvo), `${arquivo}: link quebrado ${link}`);
      }
    };
    conferir(join(dist, "fundamentos", "index.html"));
    for (const p of pastas.slice(0, 5)) conferir(join(dist, "fundamentos", p, "index.html"));
    // os JSON das fichas continuam saindo
    assert.equal(readdirSync(join(dist, "fundamentos", "dados")).length, 65);
  });
});
