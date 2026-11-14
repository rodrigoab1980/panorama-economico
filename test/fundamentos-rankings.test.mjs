// Rankings por indicador (#67): a ordenação de cada critério, as duas pontas, quem fica fora e o HTML.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CRITERIOS, GRUPOS, MOTIVO_EBITDA, SERIE_MINIMA, SETAS, TAMANHO_DA_LISTA, escrever, exercicioDeReferencia, linhaDoSentido, montarRankings, pontas,
  rankingDoCriterio, textoDoPeriodo,
} from "../scripts/fundamentos/rankings.mjs";
import { LEGENDA_DOS_RANKINGS, MARCADOR_DOS_RANKINGS, NOTA_DOS_MULTIPLOS, inserirRankings, rankingsHtml } from "../scripts/fundamentos/rankings-html.mjs";
import { calcularConsistencia } from "../scripts/fundamentos/consistencia.mjs";
import { MULTIPLOS } from "../scripts/cvm/multiplos.mjs";
import { fichaDaWeg } from "./apoio/ficha.mjs";

// ---------- fichas de teste ----------
const v = (valor, motivo = "sem dado") => ({ valor, motivo: valor == null ? motivo : null });

// Uma ficha só com o que os rankings leem. Valores em R$ mil, como vêm da CVM.
//   lucros   o lucro de cada exercício, do mais antigo ao mais recente (null = sem dado)
//   ate      o ano do último exercício
//   ind      indicadores do último exercício, por cima dos padrões
function cia(ticker, { lucros = [10, 20, 30, 40, 50, 60], ate = 2025, ind = {}, acionadas = 0, naoAvaliadas = 0, nome = `${ticker} Companhia S.A.` } = {}) {
  const inicio = ate - lucros.length + 1;
  const anual = lucros.map((lucro, i) => ({
    fim: `${inicio + i}-12-31`, tipo: "anual", meses: 12,
    indicadores: {
      receita: v(1000 + 100 * i), lucroLiquido: v(lucro), patrimonioLiquido: v(5000), fcl: v(lucro),
      ebitda: v(200), roic: v(0.1), roe: v(0.12), margemLiquida: v(0.08), fcoSobreEbitda: v(0.7), dividaLiquidaSobreEbitda: v(1.5),
      ...(i === lucros.length - 1 ? Object.fromEntries(Object.entries(ind).map(([id, x]) => [id, x && typeof x === "object" ? x : v(x)])) : {}),
    },
  }));
  const ficha = { ticker, nome, setor: "Indústria", anual };
  ficha.consistencia = calcularConsistencia(ficha);
  ficha.atencao = { acionadas, naoAvaliadas, total: 7, regras: [] };
  return ficha;
}
// N fichas com o ROIC de 1% a N%: AAA01 tem o menor.
const muitas = (n, extra = () => ({})) => Array.from({ length: n }, (_, i) => cia(`AAA${String(i + 1).padStart(2, "0")}`, { ind: { roic: (i + 1) / 100 }, ...extra(i) }));
const dado = (ticker, valor) => ({ ticker, valor });
const tickers = (ponta) => ponta.itens.map((d) => d.ticker);
const posicoes = (ponta) => ponta.itens.map((d) => d.posicao);
const criterio = (r, id) => r.criterios.find((c) => c.id === id);

// ---------- ordenação ----------
describe("rankings: ordenação e empate", () => {
  test("os maiores vêm do maior para o menor, e os menores, do menor para o maior", () => {
    const { maiores, menores } = pontas(Array.from({ length: 30 }, (_, i) => dado(`T${String(i).padStart(2, "0")}`, i)));
    assert.deepEqual(tickers(maiores), ["T29", "T28", "T27", "T26", "T25", "T24", "T23", "T22", "T21", "T20"]);
    assert.deepEqual(tickers(menores), ["T00", "T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09"]);
    assert.deepEqual(posicoes(maiores), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(posicoes(menores), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.equal(maiores.itens.length, TAMANHO_DA_LISTA);
  });

  test("empate recebe a mesma posição e pula a seguinte; o desempate de exibição é por ticker", () => {
    const dados = [dado("ZZZZ3", 9), dado("CCCC3", 7), dado("AAAA3", 7), dado("BBBB3", 5), ...Array.from({ length: 20 }, (_, i) => dado(`M${i}`, -i))];
    const { maiores } = pontas(dados);
    assert.deepEqual(tickers(maiores).slice(0, 4), ["ZZZZ3", "AAAA3", "CCCC3", "BBBB3"]);
    assert.deepEqual(posicoes(maiores).slice(0, 4), [1, 2, 2, 4]);
  });

  test("nos menores, a posição conta a partir do menor valor", () => {
    const dados = [dado("BBBB3", -2), dado("AAAA3", -2), dado("CCCC3", 0), ...Array.from({ length: 20 }, (_, i) => dado(`M${i}`, 10 + i))];
    const { menores } = pontas(dados);
    assert.deepEqual(tickers(menores).slice(0, 3), ["AAAA3", "BBBB3", "CCCC3"]);
    assert.deepEqual(posicoes(menores).slice(0, 3), [1, 1, 3]);
  });

  test("empate no corte da lista: a lista não estica, e diz quantas ficaram de fora com o mesmo valor", () => {
    // 9 valores altos, depois 3 empatadas disputando a 10ª linha.
    const dados = [...Array.from({ length: 9 }, (_, i) => dado(`A${i}`, 100 - i)), dado("EEEE3", 50), dado("DDDD3", 50), dado("FFFF3", 50), ...Array.from({ length: 15 }, (_, i) => dado(`Z${i}`, i))];
    const { maiores, menores } = pontas(dados);
    assert.equal(maiores.itens.length, 10);
    assert.equal(maiores.itens.at(-1).ticker, "DDDD3");
    assert.equal(maiores.noCorte, 2);
    assert.equal(menores.noCorte, 0);
  });
});

describe("rankings: empate em massa na ponta", () => {
  const empatadas = Array.from({ length: 12 }, (_, i) => dado(`E${String(i).padStart(2, "0")}`, 1));
  const resto = Array.from({ length: 15 }, (_, i) => dado(`R${String(i).padStart(2, "0")}`, i / 100));

  test("mais de 10 empatadas no topo viram um grupo só; os menores continuam em lista", () => {
    const { maiores, menores } = pontas([...resto, ...empatadas]);
    assert.equal(maiores.tipo, "massa");
    assert.equal(maiores.quantidade, 12);
    assert.equal(maiores.valor, 1);
    assert.deepEqual(tickers(maiores), empatadas.map((d) => d.ticker));
    assert.equal(menores.tipo, "lista");
    assert.deepEqual(tickers(menores), resto.slice(0, 10).map((d) => d.ticker));
  });

  test("exatamente 10 empatadas não é empate em massa", () => {
    const { maiores } = pontas([...resto, ...empatadas.slice(0, 10)]);
    assert.equal(maiores.tipo, "lista");
    assert.deepEqual(posicoes(maiores), Array(10).fill(1));
  });

  test("empate em massa na base: os maiores continuam em lista, só com quem sobrou", () => {
    const zeradas = empatadas.map((d) => ({ ...d, valor: 0 }));
    const { maiores, menores } = pontas([dado("XXXX3", 3), dado("YYYY3", 2), ...zeradas]);
    assert.equal(menores.tipo, "massa");
    assert.equal(menores.quantidade, 12);
    assert.deepEqual(tickers(maiores), ["XXXX3", "YYYY3"]);
  });

  test("todas empatadas: um grupo só nos maiores e nada nos menores", () => {
    const { maiores, menores } = pontas(empatadas);
    assert.equal(maiores.tipo, "massa");
    assert.deepEqual(menores, { tipo: "lista", itens: [], noCorte: 0 });
  });

  test("o grupo leva a frase do critério: lucro em todos os exercícios e nenhum ponto de atenção", () => {
    const fichas = [...muitas(12), ...muitas(12).map((f, i) => cia(`BBB${String(i).padStart(2, "0")}`, { lucros: [1, -1, 1, 1, 1, i - 20], acionadas: 1 + (i % 3) }))];
    const r = montarRankings(fichas);
    const lucro = criterio(r, "anos-com-lucro").maiores;
    assert.deepEqual([lucro.tipo, lucro.quantidade, lucro.texto, lucro.frase], ["massa", 12, "100,0%", "com lucro em todos os exercícios da série"]);
    const atencao = criterio(r, "pontos-de-atencao").menores;
    assert.deepEqual([atencao.tipo, atencao.quantidade, atencao.texto, atencao.frase], ["massa", 12, "0 de 7", "sem nenhum ponto de atenção acionado"]);
    assert.equal(criterio(r, "sequencia-com-lucro").maiores.frase, "com lucro em 6 exercícios seguidos");
  });
});

describe("rankings: universo pequeno", () => {
  test("com menos de 20 companhias, divide ao meio sem repetir ninguém; a do meio fica nos maiores", () => {
    const { maiores, menores } = pontas(Array.from({ length: 7 }, (_, i) => dado(`T${i}`, i)));
    assert.deepEqual(tickers(maiores), ["T6", "T5", "T4", "T3"]);
    assert.deepEqual(tickers(menores), ["T0", "T1", "T2"]);
  });

  test("19 companhias: 10 e 9; uma só: fica nos maiores; nenhuma: listas vazias", () => {
    const de = (n) => pontas(Array.from({ length: n }, (_, i) => dado(`T${i}`, i)));
    assert.deepEqual([de(19).maiores.itens.length, de(19).menores.itens.length], [10, 9]);
    assert.deepEqual([de(1).maiores.itens.length, de(1).menores.itens.length], [1, 0]);
    assert.deepEqual([de(0).maiores.itens.length, de(0).menores.itens.length], [0, 0]);
  });
});

// ---------- critérios ----------
describe("rankings: os critérios", () => {
  test("são 11, com id único, em 6 grupos, e nenhum é múltiplo de preço", () => {
    assert.equal(CRITERIOS.length, 11);
    assert.equal(new Set(CRITERIOS.map((c) => c.id)).size, 11);
    assert.deepEqual([...new Set(CRITERIOS.map((c) => c.grupo))], GRUPOS.map((g) => g.id));
    const multiplos = MULTIPLOS.map((m) => m.nome.toLowerCase());
    for (const c of CRITERIOS) {
      assert.ok(!multiplos.includes(c.titulo.toLowerCase()), c.titulo);
      assert.ok(c.regra.length > 20, `${c.id} tem a regra escrita`);
    }
  });

  test("o exercício de referência é o último que a maioria já entregou", () => {
    const fichas = [cia("AAAA3", { ate: 2026 }), cia("BBBB3"), cia("CCCC3"), cia("DDDD3", { ate: 2024 })];
    assert.equal(exercicioDeReferencia(fichas), "2025-12-31");
    assert.equal(montarRankings(fichas).rotuloDoExercicio, "2025");
  });

  test("companhia sem o exercício de referência sai dos critérios do exercício, com o motivo, e a página conta", () => {
    const r = montarRankings([...muitas(22), cia("VELH3", { ate: 2024 })]);
    assert.deepEqual([r.empresas, r.comExercicio, r.semExercicio], [23, 22, ["VELH3"]]);
    for (const id of ["roic", "roe", "margem-liquida", "fco-sobre-ebitda", "divida-liquida-sobre-ebitda", "crescimento-da-receita", "crescimento-do-lucro"]) {
      assert.deepEqual(criterio(r, id).fora, [{ ticker: "VELH3", motivo: "sem o exercício de 2025" }], id);
      assert.equal(criterio(r, id).empresas, 22, id);
    }
    // Os critérios da série inteira e o de atenção não dependem do exercício de referência.
    for (const id of ["anos-com-lucro", "sequencia-com-lucro", "anos-com-fcl-positivo", "pontos-de-atencao"]) assert.equal(criterio(r, id).empresas, 23, id);
  });

  test("série curta: menos de 5 exercícios fica fora dos critérios de consistência, com o motivo", () => {
    const r = montarRankings([...muitas(22), cia("NOVA3", { lucros: [1, 2, 3, 4] })]);
    assert.equal(SERIE_MINIMA, 5);
    for (const id of ["anos-com-lucro", "sequencia-com-lucro", "anos-com-fcl-positivo"]) {
      assert.deepEqual(criterio(r, id).fora, [{ ticker: "NOVA3", motivo: "série curta (4 anos)" }], id);
    }
    // O crescimento em 5 anos precisa de 6 exercícios; o ROIC do exercício não depende da série.
    assert.deepEqual(criterio(r, "crescimento-da-receita").fora, [{ ticker: "NOVA3", motivo: "série curta (4 anos)" }]);
    assert.equal(criterio(r, "roic").fora.length, 0);
  });

  test("a parte dos anos com lucro usa os anos com dado, e o tamanho da série vai ao lado", () => {
    const r = montarRankings([cia("AAAA3", { lucros: [5, -1, null, 5, 5, 5, 5] }), cia("BBBB3", { lucros: [1, 1, 1, 1, 1, null] })]);
    const itens = [...criterio(r, "anos-com-lucro").maiores.itens, ...criterio(r, "anos-com-lucro").menores.itens];
    const a = itens.find((d) => d.ticker === "AAAA3");
    assert.equal(a.valor, 5 / 6);
    assert.deepEqual([a.texto, a.detalhe], ["83,3%", "5 de 6"]);
    assert.equal(itens.find((d) => d.ticker === "BBBB3").detalhe, "5 de 5");
  });

  test("crescimento com prejuízo numa das pontas fica fora, com o motivo da conta", () => {
    const r = montarRankings([cia("AAAA3"), cia("BBBB3", { lucros: [-10, 20, 30, 40, 50, 60] }), cia("CCCC3", { lucros: [10, 20, 30, 40, 50, -60] })]);
    assert.deepEqual(criterio(r, "crescimento-do-lucro").fora, [{ ticker: "BBBB3", motivo: "lucro de 2020 negativo" }, { ticker: "CCCC3", motivo: "lucro de 2025 negativo" }]);
    const [a] = criterio(r, "crescimento-do-lucro").maiores.itens;
    assert.equal(a.ticker, "AAAA3");
    assert.ok(Math.abs(a.valor - (6 ** (1 / 5) - 1)) < 1e-12);
    assert.equal(a.detalhe, "2020–2025");
  });

  test("pontos de atenção: o número de regras acionadas, com as não avaliadas ao lado", () => {
    const r = montarRankings([cia("AAAA3", { acionadas: 4, naoAvaliadas: 2 }), cia("BBBB3", { acionadas: 1 }), cia("CCCC3")]);
    const c = criterio(r, "pontos-de-atencao");
    assert.deepEqual(c.maiores.itens.map((d) => [d.posicao, d.ticker, d.texto, d.detalhe]), [[1, "AAAA3", "4 de 7", "2 não avaliadas"], [2, "BBBB3", "1 de 7", null]]);
    assert.deepEqual(tickers(c.menores), ["CCCC3"]);
  });

  test("sem fichas não há rankings; o período de cada critério sai por extenso", () => {
    assert.equal(montarRankings([]), null);
    assert.equal(montarRankings(null), null);
    assert.equal(textoDoPeriodo("exercicio", "2025-12-31"), "exercício de 2025");
    assert.equal(textoDoPeriodo("cinco", "2025-12-31"), "5 anos até o exercício de 2025 (2020 a 2025)");
    assert.equal(textoDoPeriodo("exercicio", null), "sem exercício de referência");
    assert.equal(escrever(1, "anos"), "1 ano");
    assert.throws(() => escrever(1, "nota"), /formato desconhecido/);
  });

  test("a ficha montada das fixtures da CVM entra sem erro (série curta fica fora)", () => {
    const r = montarRankings({ WEGE3: fichaDaWeg() });
    assert.equal(r.empresas, 1);
    assert.equal(r.criterios.length, 11);
    assert.match(rankingsHtml(r, { fichas: { WEGE3: fichaDaWeg() } }), /WEGE3/);
  });
});

describe("rankings: dívida líquida ÷ EBITDA", () => {
  const fichas = [
    ...muitas(22, (i) => ({ ind: { dividaLiquidaSobreEbitda: 0.5 + i / 10 } })),
    cia("CAIX3", { ind: { dividaLiquidaSobreEbitda: -0.8 } }),
    cia("EBIT3", { ind: { ebitda: -50, dividaLiquidaSobreEbitda: v(null, "EBITDA zero ou negativo") } }),
    cia("ZERO3", { ind: { ebitda: 0, dividaLiquidaSobreEbitda: -3 } }),
    cia("SEMD3", { ind: { dividaLiquidaSobreEbitda: v(null, "dívida bruta não informada") } }),
  ];
  const c = criterio(montarRankings(fichas), "divida-liquida-sobre-ebitda");

  test("caixa líquido dá valor negativo e fica na ponta dos menores", () => {
    const [primeiro] = c.menores.itens;
    assert.deepEqual([primeiro.posicao, primeiro.ticker, primeiro.texto], [1, "CAIX3", "−0,8x"]);
    assert.ok(!tickers(c.maiores).includes("CAIX3"));
  });

  test("EBITDA negativo ou zero fica fora, com esse motivo; outro dado ausente leva o motivo da ficha", () => {
    assert.deepEqual(c.fora, [
      { ticker: "EBIT3", motivo: MOTIVO_EBITDA },
      { ticker: "SEMD3", motivo: "dívida bruta não informada" },
      { ticker: "ZERO3", motivo: MOTIVO_EBITDA },
    ]);
    assert.equal(c.empresas, 23);
  });
});

describe("rankings: a mesma companhia nunca está nas duas pontas do mesmo critério", () => {
  const semRepetir = (r) => {
    for (const c of r.criterios) {
      const maiores = new Set(tickers(c.maiores));
      const repetidas = tickers(c.menores).filter((t) => maiores.has(t));
      assert.deepEqual(repetidas, [], c.id);
    }
  };
  const variadas = (n) => muitas(n, (i) => ({
    lucros: [i % 3 ? 10 : -10, 20, i % 4 ? 30 : null, 40, i % 5 ? 50 : -5, 60 + i], acionadas: i % 4,
    ind: { roic: (i % 6) / 100, roe: i / 50, margemLiquida: 0.05, fcoSobreEbitda: (i % 2) / 2, dividaLiquidaSobreEbitda: i / 3 - 2 },
  }));
  for (const n of [1, 2, 5, 19, 20, 21, 40]) test(`com ${n} ${n === 1 ? "companhia" : "companhias"}`, () => semRepetir(montarRankings(variadas(n))));
});

// ---------- HTML ----------
describe("rankings: o HTML", () => {
  const fichas = Object.fromEntries([
    ...muitas(24, (i) => ({ lucros: [10, i % 2 ? 20 : -20, i % 4 ? 30 : -30, 40, 50, 60], acionadas: i % 3 })),
    cia("EMPA3", { ind: { roic: 0.22 } }), cia("EMPB3", { ind: { roic: 0.22 } }),
    cia("VELH3", { ate: 2024 }), cia("NOVA3", { lucros: [1, 2, 3] }),
    cia("EBIT3", { ind: { ebitda: -1, dividaLiquidaSobreEbitda: v(null, "EBITDA zero ou negativo") } }),
    cia("MAL<3", { nome: "Fulano & <b>Filhos</b> S.A.", ind: { roic: 0.9 } }),
  ].map((f) => [f.ticker, f]));
  const comPagina = new Set(Object.keys(fichas).filter((t) => t !== "EBIT3"));
  const R = montarRankings(fichas);
  const FICHAS = Object.values(fichas);
  const html = rankingsHtml(R, { fichas, comPagina });
  const bloco = (id) => new RegExp(`<section class="criterio" id="${id}"[\\s\\S]*?</section>`).exec(html)[0];
  // O que o leitor vê e ouve: o texto e os atributos de texto, sem os nomes de classe.
  const visivel = html.replace(/\s(?:class|id|href|aria-labelledby)="[^"]*"/g, "");

  test("a legenda fixa abre a página, e o exercício de referência vem com a contagem", () => {
    assert.ok(html.includes(LEGENDA_DOS_RANKINGS));
    assert.ok(html.indexOf(LEGENDA_DOS_RANKINGS) < html.indexOf('class="criterio"'));
    assert.match(html, /Exercício de referência: <strong>2025<\/strong>, o último exercício anual que a maioria já entregou \(29 de 30\)/);
    assert.match(html, /Sem esse exercício: <a href="\.\.\/velh3\/">VELH3<\/a>\./);
  });

  test("o índice tem uma âncora por critério, nos 6 grupos, e cada âncora leva a um bloco", () => {
    const indice = /<nav class="rankings-indice"[\s\S]*?<\/nav>/.exec(html)[0];
    const ancoras = [...indice.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ancoras, CRITERIOS.map((c) => c.id));
    assert.equal((indice.match(/<li>/g) ?? []).length, 6);
    for (const id of ancoras) assert.ok(html.includes(`<section class="criterio" id="${id}"`), id);
  });

  test("cada critério tem a regra, o período e as duas listas, a dos maiores e a dos menores valores", () => {
    for (const c of CRITERIOS) {
      const b = bloco(c.id);
      assert.ok(b.includes(`<p class="criterio-regra">${c.regra.replace(/&/g, "&amp;")}</p>`), c.id);
      assert.match(b, /<p class="criterio-periodo">Período: /, c.id);
      assert.deepEqual([...b.matchAll(/<h4>[^<]+ <small>([^<]+)<\/small><\/h4>/g)].map((m) => m[1]), ["maiores valores", "menores valores"], c.id);
    }
  });

  // ---------- o sentido de cada critério (#81) ----------
  // O que a página tem de dizer em cada um dos 11 critérios: a linha do sentido e o título das duas listas.
  const SENTIDOS = {
    "anos-com-lucro": ["↑ maior = lucro em mais anos da série", "Lucro em mais anos", "Lucro em menos anos"],
    "sequencia-com-lucro": ["↑ maior = mais anos seguidos com lucro", "Sequências mais longas com lucro", "Sequências mais curtas com lucro"],
    "anos-com-fcl-positivo": ["↑ maior = FCL positivo em mais anos da série", "FCL positivo em mais anos", "FCL positivo em menos anos"],
    "crescimento-da-receita": ["↑ maior = a receita cresceu mais rápido", "Receita cresceu mais", "Receita cresceu menos ou caiu"],
    "crescimento-do-lucro": ["↑ maior = o lucro cresceu mais rápido", "Lucro cresceu mais", "Lucro cresceu menos ou caiu"],
    roic: ["↑ maior = mais retorno por real de capital investido", "Mais retorno sobre o capital investido", "Menos retorno sobre o capital investido"],
    roe: ["↑ maior = mais lucro por real de patrimônio líquido", "Mais retorno sobre o patrimônio", "Menos retorno sobre o patrimônio"],
    "margem-liquida": ["↑ maior = mais lucro em cada real de receita", "Margens mais largas", "Margens mais estreitas"],
    "fco-sobre-ebitda": ["↑ maior = mais do EBITDA virou caixa", "Mais EBITDA virou caixa", "Menos EBITDA virou caixa"],
    "divida-liquida-sobre-ebitda": ["↓ menor = menos endividada", "Mais endividadas", "Menos endividadas"],
    "pontos-de-atencao": ["↓ menor = menos pontos de atenção acionados", "Mais pontos de atenção acionados", "Menos pontos de atenção acionados"],
  };

  test("os 11 critérios têm o sentido definido, num só lugar: direção, significado e o título das duas listas", () => {
    assert.equal(CRITERIOS.length, 11);
    assert.deepEqual(Object.keys(SENTIDOS), CRITERIOS.map((c) => c.id));
    for (const c of CRITERIOS) {
      assert.deepEqual(Object.keys(c.sentido), ["direcao", "significa", "maiores", "menores"], c.id);
      assert.ok(["maior", "menor"].includes(c.sentido.direcao), c.id);
      for (const campo of ["significa", "maiores", "menores"]) assert.ok(typeof c.sentido[campo] === "string" && c.sentido[campo].length > 3, `${c.id}: ${campo}`);
      assert.notEqual(c.sentido.maiores, c.sentido.menores, c.id);
      const [linha, maiores, menores] = SENTIDOS[c.id];
      assert.equal(linhaDoSentido(c.sentido), linha, c.id);
      assert.equal(c.sentido.maiores, maiores, c.id);
      assert.equal(c.sentido.menores, menores, c.id);
    }
  });

  test("a linha do sentido: seta para cima no maior e para baixo no menor; direção desconhecida dá erro", () => {
    assert.deepEqual(SETAS, { maior: "↑", menor: "↓" });
    assert.equal(linhaDoSentido({ direcao: "menor", significa: "menos endividada" }), "↓ menor = menos endividada");
    assert.equal(linhaDoSentido({ direcao: "maior", significa: "mais do EBITDA virou caixa" }), "↑ maior = mais do EBITDA virou caixa");
    assert.throws(() => linhaDoSentido({ direcao: "melhor", significa: "x" }), /direção desconhecida/);
    assert.throws(() => linhaDoSentido(undefined), /direção desconhecida/);
  });

  test("na página, cada critério mostra a linha do sentido, antes da regra, e as listas com o título do significado", () => {
    for (const c of CRITERIOS) {
      const b = bloco(c.id);
      const [linha, maiores, menores] = SENTIDOS[c.id];
      const [seta, ...resto] = linha.split(" ");
      assert.ok(b.includes(`<p class="criterio-sentido"><span aria-hidden="true">${seta}</span> ${resto.join(" ")}</p>\n<p class="criterio-regra">`), c.id);
      assert.deepEqual([...b.matchAll(/<h4>([^<]+) <small>/g)].map((m) => m[1]), [maiores, menores], c.id);
      assert.equal((b.match(/class="criterio-sentido"/g) ?? []).length, 1, c.id);
    }
  });

  test("o README traz o sentido dos 11 critérios, igual ao do código", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    for (const c of CRITERIOS) {
      const linha = `| ${c.titulo} | ${linhaDoSentido(c.sentido)} | ${c.sentido.maiores} | ${c.sentido.menores} |`;
      assert.ok(readme.includes(linha), `falta no README: ${linha}`);
    }
  });

  test("o sentido vai no JSON de cada critério, com a linha pronta", () => {
    for (const c of R.criterios) {
      assert.equal(c.sentido.linha, SENTIDOS[c.id][0], c.id);
      assert.deepEqual(Object.keys(c.sentido), ["direcao", "significa", "maiores", "menores", "linha"], c.id);
    }
  });

  test("o sentido descreve, não julga: nada de melhor, pior, bom, ruim ou recomendação nos 11 critérios", () => {
    for (const c of CRITERIOS) {
      const texto = [c.sentido.significa, c.sentido.maiores, c.sentido.menores].join(" | ");
      assert.doesNotMatch(texto, /melhor|pior|\bbo[am]s?\b|ru[ií]m|ruins|saud[áa]ve|\bfort|\bfrac|compr|vend|recomend|atrativ|barat|\bcar[ao]s?\b|oportunidade|risco|segur/i, c.id);
    }
  });

  test("o sentido é só texto: nenhuma conta muda (mesma ordem, mesmas posições, mesmos valores)", () => {
    const semSentido = CRITERIOS.map((c) => ({ ...c, sentido: { direcao: c.sentido.direcao === "maior" ? "menor" : "maior", significa: "outro texto", maiores: "A", menores: "B" } }));
    for (const [i, c] of CRITERIOS.entries()) {
      const { sentido: _a, ...antes } = rankingDoCriterio(c, FICHAS, R.exercicio);
      const { sentido: _b, ...depois } = rankingDoCriterio(semSentido[i], FICHAS, R.exercicio);
      assert.deepEqual(depois, antes, c.id);
    }
    // a lista dos maiores continua vindo antes da dos menores, e o maior valor continua em 1º
    const roic = R.criterios.find((c) => c.id === "roic");
    assert.ok(roic.maiores.itens[0].valor > roic.maiores.itens.at(-1).valor);
    assert.ok(roic.menores.itens[0].valor < roic.menores.itens.at(-1).valor);
    assert.ok(roic.maiores.itens.at(-1).valor > roic.menores.itens.at(-1).valor);
    // no critério de sentido "menor" (dívida), a lista dos maiores valores continua sendo a primeira
    const divida = bloco("divida-liquida-sobre-ebitda");
    assert.ok(divida.indexOf("Mais endividadas <small>maiores valores") < divida.indexOf("Menos endividadas <small>menores valores"));
  });

  test("a linha mostra posição, ticker com link para a ficha, nome curto, régua em miniatura e valor", () => {
    const b = bloco("roic");
    const linha = /<li><a href="\.\.\/empa3\/">[\s\S]*?<\/a><\/li>/.exec(b)[0];
    assert.match(linha, /<span class="posicao n">4º<\/span><strong>EMPA3<\/strong><span class="nome">EMPA3 Companhia<\/span><div class="regua miniatura"/);
    assert.match(linha, /<span class="valor n">22,0%<\/span>/);
    // Empate: três companhias com 22% dividem a 4ª posição, e a seguinte é a 7ª.
    assert.deepEqual([...b.matchAll(/<span class="posicao n">(\d+)º<\/span>/g)].slice(0, 7).map((m) => m[1]), ["1", "2", "3", "4", "4", "4", "7"]);
  });

  test("ticker sem página fica sem link; texto que vem de dado é escapado", () => {
    assert.ok(!html.includes('href="../ebit3/"'));
    assert.ok(html.includes("<strong>MAL&lt;3</strong>"));
    assert.ok(html.includes("Fulano &amp; &lt;b&gt;Filhos&lt;/b&gt;"));
    assert.ok(!html.includes("<b>Filhos</b>"));
  });

  test("sem dado: a contagem, os tickers e o motivo num <details>", () => {
    const b = bloco("divida-liquida-sobre-ebitda");
    assert.match(b, /<details class="criterio-fora"><summary>Sem dado neste critério: 2 empresas<\/summary>/);
    assert.ok(b.includes(`<li>${MOTIVO_EBITDA}: EBIT3.</li>`));
    assert.ok(b.includes('<li>Sem o exercício de 2025: <a href="../velh3/">VELH3</a>.</li>'));
    assert.match(bloco("anos-com-lucro"), /<li>Série curta \(3 anos\): <a href="\.\.\/nova3\/">NOVA3<\/a>\.<\/li>/);
    assert.match(bloco("pontos-de-atencao"), /Sem dado neste critério: nenhuma empresa\./);
  });

  test("empate em massa vira uma linha só, com a contagem e os tickers", () => {
    const b = bloco("anos-com-lucro");
    assert.match(b, /<p class="ranking-massa"><strong>17 empresas<\/strong> com lucro em todos os exercícios da série \(100,0%\): /);
    assert.match(b, /<h4>Lucro em mais anos <small>maiores valores<\/small><\/h4><p class="ranking-massa">/);
    assert.match(b, /<h4>Lucro em menos anos <small>menores valores<\/small><\/h4><ol>/);
  });

  test("nenhuma palavra de recomendação e nenhum múltiplo de preço", () => {
    assert.doesNotMatch(visivel, /melhor|pior|compre|comprar|\bcompra\b|venda|vender|\bnotas?\b|preço[- ]alvo|barat|\bcar[ao]s?\b|\btop\b|oportunidade/i);
    assert.doesNotMatch(visivel, /P\/L|P\/VPA|EV\/EBITDA|\bEV\b|\bDY\b|dividend yield|earnings yield|preço\/|valor de mercado/i);
    for (const m of MULTIPLOS) assert.ok(!visivel.toLowerCase().includes(m.nome.toLowerCase()), m.nome);
    // A linha do pé explica por que os múltiplos ficaram de fora, sem citar nenhum.
    assert.ok(html.includes(NOTA_DOS_MULTIPLOS));
    assert.match(NOTA_DOS_MULTIPLOS, /de propósito/);
  });

  test("nenhuma cor de alta ou de baixa nas listas, e nenhum script", () => {
    assert.doesNotMatch(html, /class="[^"]*\b(?:alta|baixa|pos|neg|variacao)\b/);
    assert.doesNotMatch(html, /<script/i);
  });

  test("sem dados, a página sai com a legenda e o aviso de que a coleta ainda não rodou", () => {
    const vazio = rankingsHtml(null);
    assert.ok(vazio.includes(LEGENDA_DOS_RANKINGS));
    assert.match(vazio, /ainda não foram coletados/);
    assert.ok(!vazio.includes('class="criterio"'));
  });

  test("inserirRankings exige exatamente um marcador", () => {
    assert.equal(inserirRankings(`<main>${MARCADOR_DOS_RANKINGS}</main>`, "<p>x</p>"), "<main><p>x</p></main>");
    assert.throws(() => inserirRankings("<main></main>", "x"), /exatamente um/);
    assert.throws(() => inserirRankings(`${MARCADOR_DOS_RANKINGS}${MARCADOR_DOS_RANKINGS}`, "x"), /exatamente um/);
  });
});
