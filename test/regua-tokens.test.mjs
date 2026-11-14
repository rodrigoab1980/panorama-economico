// Redesenho visual (#65): a régua de anos da ficha e os tokens de cor compartilhados.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reguaDeAnos, reguaHtml, resumoDaRegua } from "../scripts/fundamentos/regua.mjs";
import { fichaHtml } from "../scripts/fundamentos/pagina.mjs";
import { MOTIVO_DEMONSTRACAO_ZERADA } from "../scripts/cvm/indicadores.mjs";
import { HOJE, fichaDaWeg } from "./apoio/ficha.mjs";

// ---------- régua de anos ----------
// Um exercício com o lucro dado: número, null (sem dado) ou { motivo }.
const ano = (a, lucro, extra = {}) => ({
  inicio: `${a}-01-01`, fim: `${a}-12-31`, tipo: "anual", meses: 12,
  indicadores: { lucroLiquido: typeof lucro === "number" ? { valor: lucro, motivo: null } : { valor: null, motivo: lucro?.motivo ?? "falta a conta 3.11 (lucro líquido)" } },
  ...extra,
});
const ficha = (anual) => ({ ticker: "TEST3", anual });
const estados = (f) => reguaDeAnos(f).map((b) => b.estado);

describe("régua de anos: um bloco por exercício", () => {
  test("lucro é bloco cheio, prejuízo é vazado e sem dado é tracejado", () => {
    const blocos = reguaDeAnos(ficha([ano(2021, 1_200_000), ano(2022, -300_000), ano(2023, null), ano(2024, 50_000)]));
    assert.deepEqual(blocos, [
      { fim: "2021-12-31", rotulo: "2021", estado: "lucro", texto: "2021: lucro de R$ 1,2 bi" },
      { fim: "2022-12-31", rotulo: "2022", estado: "prejuizo", texto: "2022: prejuízo de R$ 300 mi" },
      { fim: "2023-12-31", rotulo: "2023", estado: "sem-dado", texto: "2023: sem dado (falta a conta 3.11 (lucro líquido))" },
      { fim: "2024-12-31", rotulo: "2024", estado: "lucro", texto: "2024: lucro de R$ 50 mi" },
    ]);
  });

  test("lucro igual a zero não é lucro: bloco vazado, e o texto diz 'resultado zero'", () => {
    const [b] = reguaDeAnos(ficha([ano(2025, 0)]));
    assert.deepEqual([b.estado, b.texto], ["prejuizo", "2025: resultado zero"]);
  });

  test("série curta: só os exercícios que existem, sem inventar anos antes", () => {
    const blocos = reguaDeAnos(ficha([ano(2024, 10), ano(2025, 20)]));
    assert.deepEqual(blocos.map((b) => b.rotulo), ["2024", "2025"]);
    assert.equal(resumoDaRegua(blocos), "2024 a 2025: lucro em 2 de 2 exercícios.");
    assert.equal(resumoDaRegua(reguaDeAnos(ficha([ano(2025, 20)]))), "2025: lucro em 1 de 1 exercício.");
  });

  test("período indisponível (Assaí 2018, demonstração zerada): bloco sem dado, com o motivo", () => {
    const blocos = reguaDeAnos(ficha([ano(2018, { motivo: MOTIVO_DEMONSTRACAO_ZERADA }), ano(2019, 1_060_000), ano(2020, 1_556_000)]));
    assert.deepEqual(blocos.map((b) => b.estado), ["sem-dado", "lucro", "lucro"]);
    assert.equal(blocos[0].texto, "2018: sem dado (demonstração zerada no documento)");
    assert.equal(resumoDaRegua(blocos), "2018 a 2020: lucro em 2 de 3 exercícios, 1 sem dado.");
  });

  test("ano sem exercício no meio da série vira um bloco sem dado: a régua não esconde o buraco", () => {
    const blocos = reguaDeAnos(ficha([ano(2019, 10), ano(2022, 20)]));
    assert.deepEqual(blocos.map((b) => [b.rotulo, b.estado, b.fim]), [["2019", "lucro", "2019-12-31"], ["2020", "sem-dado", null], ["2021", "sem-dado", null], ["2022", "lucro", "2022-12-31"]]);
    assert.equal(blocos[1].texto, "2020: sem exercício na série");
  });

  test("período de transição entra com o seu resultado, e o texto diz quantos meses tem", () => {
    const blocos = reguaDeAnos(ficha([ano(2012, 100), { ...ano(2013, -40), inicio: "2013-04-01", tipo: "transicao", meses: 9 }, ano(2014, 80)]));
    assert.deepEqual(blocos.map((b) => b.estado), ["lucro", "prejuizo", "lucro"]);
    assert.equal(blocos[1].texto, "2013: prejuízo de R$ 40 mil (exercício de 9 meses)");
  });

  test("exercício que não termina em dezembro leva o mês no rótulo", () => {
    const p = { ...ano(2026, 836_177), inicio: "2025-04-01", fim: "2026-03-31" };
    assert.deepEqual(reguaDeAnos(ficha([p])).map((b) => [b.rotulo, b.texto]), [["03/2026", "03/2026: lucro de R$ 836 mi"]]);
  });

  test("ficha sem série anual: nenhum bloco e nenhum HTML", () => {
    assert.deepEqual(reguaDeAnos(ficha([])), []);
    assert.deepEqual(reguaDeAnos(null), []);
    assert.equal(reguaHtml(ficha([])), "");
    assert.equal(resumoDaRegua([]), "Sem exercícios na série.");
  });

  test("resumo: conta lucro, prejuízo e sem dado sobre o total de blocos", () => {
    const f = ficha([ano(2015, 1), ano(2016, -1), ano(2017, -1), ano(2018, null), ano(2019, 1)]);
    assert.equal(resumoDaRegua(reguaDeAnos(f)), "2015 a 2019: lucro em 2 de 5 exercícios, prejuízo em 2, 1 sem dado.");
    assert.deepEqual(estados(f), ["lucro", "prejuizo", "prejuizo", "sem-dado", "lucro"]);
  });
});

describe("régua de anos: HTML", () => {
  const f = ficha([...[2010, 2011, 2012, 2013, 2014].map((a) => ano(a, 100)), ano(2015, -50), ano(2016, null), ano(2017, 200)]);
  const html = reguaHtml(f);

  test("uma lista ordenada com um item por exercício, cada um com o estado na classe e o ano e o lucro no title", () => {
    assert.match(html, /^<figure class="regua">/);
    assert.match(html, /<ol class="regua-anos" style="--n:8">/);
    assert.equal((html.match(/<li class="(lucro|prejuizo|sem-dado)" title=/g) ?? []).length, 8);
    assert.match(html, /<li class="lucro" title="2010: lucro de R\$ 100 mil"><span class="so-leitor">2010: lucro de R\$ 100 mil<\/span>/);
    assert.match(html, /<li class="prejuizo" title="2015: prejuízo de R\$ 50 mil">/);
    assert.match(html, /<li class="sem-dado" title="2016: sem dado \(falta a conta 3\.11 \(lucro líquido\)\)">/);
  });

  test("o estado não depende só da cor nem só do desenho: cada bloco tem o texto para leitor de tela", () => {
    assert.equal((html.match(/<span class="so-leitor">/g) ?? []).length, 8);
    assert.match(html, /<figcaption><strong>Resultado de cada exercício<\/strong> <span class="regua-resumo">2010 a 2017: lucro em 6 de 8 exercícios, prejuízo em 1, 1 sem dado\.<\/span><\/figcaption>/);
  });

  test("o ano aparece embaixo do primeiro, do último e dos múltiplos de 5", () => {
    assert.deepEqual([...html.matchAll(/<small aria-hidden="true">(\d{4})<\/small>/g)].map((m) => m[1]), ["2010", "2015", "2017"]);
  });

  test("legenda com os três estados, na mesma ordem", () => {
    assert.match(html, /<ul class="regua-legenda" aria-hidden="true"><li class="lucro">lucro<\/li><li class="prejuizo">prejuízo<\/li><li class="sem-dado">sem dado<\/li><\/ul>/);
  });

  test("miniatura (para a lista): sem anos nem legenda, com o resumo no aria-label", () => {
    const mini = reguaHtml(f, { miniatura: true });
    assert.match(mini, /^<div class="regua miniatura" role="img" aria-label="Resultado por exercício, 2010 a 2017: lucro em 6 de 8 exercícios, prejuízo em 1, 1 sem dado\.">/);
    assert.ok(!mini.includes("<small") && !mini.includes("regua-legenda") && !mini.includes("<figure"));
    assert.equal((mini.match(/<li class=/g) ?? []).length, 8);
  });

  test("texto vindo de dado é escapado", () => {
    const h = reguaHtml(ficha([ano(2025, { motivo: `conta <b>"x"</b> & y` })]));
    assert.ok(h.includes("conta &lt;b&gt;&quot;x&quot;&lt;/b&gt; &amp; y") && !h.includes("<b>"));
  });

  test("nenhuma palavra de julgamento na régua", () => {
    assert.doesNotMatch(html.replace(/<[^>]+>/g, " "), /\bbo[am]\b|\bruim\b|saudável|excelente|ótim|péssim|compre|venda/i);
  });
});

describe("régua de anos na ficha", () => {
  const html = fichaHtml(fichaDaWeg(), { hoje: HOJE });

  test("fica logo abaixo do nome da companhia, antes da cotação e das tabelas", () => {
    const nome = html.indexOf("<h2>WEG S.A.</h2>");
    const regua = html.indexOf('<figure class="regua">');
    assert.ok(nome > 0 && regua > nome);
    assert.ok(regua < html.indexOf('<ul class="cotacoes">'));
    assert.ok(regua < html.indexOf('id="resumo-consistencia"'));
  });

  test("WEG (fixture de 2 exercícios): dois blocos de lucro, com o valor de cada ano", () => {
    assert.match(html, /<li class="lucro" title="2024: lucro de R\$ 6,3 bi">/);
    assert.match(html, /<li class="lucro" title="2025: lucro de R\$ 6,8 bi">/);
    assert.match(html, /2024 a 2025: lucro em 2 de 2 exercícios\./);
  });

  test("o ticker abre a ficha, antes do nome", () => {
    assert.match(html, /<div class="identidade"><p class="ticker">WEGE3<\/p><h2>WEG S\.A\.<\/h2><p class="setor">Bens industriais<\/p><\/div>/);
  });

  test("a ficha carrega os tokens e o CSS da página, e não mais o CSS do Diário", () => {
    assert.match(html, /<link rel="stylesheet" href="\.\.\/\.\.\/tokens\.css">\n<link rel="stylesheet" href="\.\.\/fundamentos\.css">/);
    assert.ok(!html.includes("style.css"));
  });
});

// ---------- tokens ----------
const TOKENS = readFileSync(new URL("../site/tokens.css", import.meta.url), "utf8");
// Os tokens de cor de cada tema: { nome: "#RRGGBB" }.
function tema(qual) {
  const inicioDoEscuro = TOKENS.indexOf("@media (prefers-color-scheme: dark)");
  const fimDoEscuro = TOKENS.indexOf("\n}\n", inicioDoEscuro) + 3;
  const trecho = qual === "escuro" ? TOKENS.slice(inicioDoEscuro, fimDoEscuro) : TOKENS.slice(0, inicioDoEscuro);
  return Object.fromEntries([...trecho.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b/g)].map((m) => [m[1], m[2]]));
}
// Contraste WCAG 2 entre duas cores "#RRGGBB".
function contraste(a, b) {
  const luz = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [maior, menor] = [luz(a), luz(b)].sort((x, y) => y - x);
  return (maior + 0.05) / (menor + 0.05);
}

describe("tokens de cor: dois temas, com contraste AA", () => {
  const claro = tema("claro");
  const escuro = tema("escuro");
  const CORES = ["fundo", "superficie", "superficie-2", "tinta", "tinta-2", "tinta-suave", "linha", "linha-forte", "acao", "atencao", "alta", "baixa", "agora"];

  test("a paleta do briefing está nos dois temas", () => {
    assert.deepEqual([claro.fundo, claro.superficie, claro.tinta, claro["tinta-suave"], claro.linha, claro.acao, claro.atencao], ["#F6F7F5", "#FFFFFF", "#132A3E", "#5B6B7A", "#D8DEE4", "#1F5FAD", "#A35F00"]);
    assert.deepEqual([escuro.fundo, escuro.superficie, escuro.tinta, escuro["tinta-suave"], escuro.linha, escuro.acao, escuro.atencao], ["#0F1B2A", "#16263A", "#E4EAF0", "#93A3B3", "#26394F", "#7FB2F0", "#F0A64A"]);
  });

  test("os dois temas definem os mesmos tokens de cor", () => {
    for (const nome of CORES) {
      assert.match(claro[nome] ?? "", /^#[0-9A-F]{6}$/i, `claro: ${nome}`);
      assert.match(escuro[nome] ?? "", /^#[0-9A-F]{6}$/i, `escuro: ${nome}`);
    }
  });

  test("o site segue o tema do aparelho, sem botão: color-scheme e a media query", () => {
    assert.match(TOKENS, /color-scheme: light dark;/);
    assert.equal((TOKENS.match(/@media \(prefers-color-scheme: dark\)/g) ?? []).length, 1);
    assert.match(TOKENS, /@media \(prefers-reduced-motion: reduce\)/);
  });

  for (const [nome, cores] of [["claro", claro], ["escuro", escuro]]) {
    test(`tema ${nome}: texto, números, links, atenção, alta e baixa passam no AA (4,5:1) sobre os três fundos`, () => {
      for (const frente of ["tinta", "tinta-2", "tinta-suave", "acao", "atencao", "alta", "baixa", "agora"]) {
        // A cor de atenção só aparece sobre a página e sobre a superfície (carimbo e pontos de atenção),
        // nunca sobre a coluna de hoje; no claro, o tom do briefing dá 4,37:1 ali.
        for (const fundo of frente === "atencao" ? ["fundo", "superficie"] : ["fundo", "superficie", "superficie-2"]) {
          const c = contraste(cores[frente], cores[fundo]);
          assert.ok(c >= 4.5, `${nome}: ${frente} ${cores[frente]} sobre ${fundo} ${cores[fundo]} dá ${c.toFixed(2)}:1`);
        }
      }
    });

    test(`tema ${nome}: os blocos da régua e a borda do campo passam no mínimo de 3:1 para elementos gráficos`, () => {
      // a régua usa a tinta sobre o fundo da página; a borda do campo de busca usa a tinta suave.
      // As linhas (--linha e --linha-forte) são só divisórias e não entram nessa conta.
      assert.ok(contraste(cores.tinta, cores.fundo) >= 3);
      for (const fundo of ["fundo", "superficie"]) assert.ok(contraste(cores["tinta-suave"], cores[fundo]) >= 3, `${nome}: ${fundo}`);
    });
  }

  test("contraste: a conta confere com valores conhecidos", () => {
    assert.equal(contraste("#000000", "#FFFFFF").toFixed(1), "21.0");
    assert.equal(contraste("#FFFFFF", "#FFFFFF").toFixed(1), "1.0");
    assert.equal(contraste("#767676", "#FFFFFF").toFixed(2), "4.54");
  });
});

describe("CSS das páginas: as cores vêm dos tokens", () => {
  const ler = (caminho) => readFileSync(new URL(`../site/${caminho}`, import.meta.url), "utf8");

  test("fundamentos.css não tem cor fixa", () => {
    const css = ler("fundamentos/fundamentos.css").replace(/\/\*.*?\*\//gs, "");
    assert.deepEqual(css.match(/#[0-9A-Fa-f]{3,8}\b|rgba?\(/g) ?? [], []);
  });

  test("o Diário só mantém cor fixa no mapa de ações e no fundo do widget claro", () => {
    const css = ler("style.css").replace(/\/\*.*?\*\//gs, "");
    const fixas = css.split("\n").filter((l) => /#[0-9A-Fa-f]{3,8}\b|rgba?\(/.test(l)).map((l) => l.trim().split(/[ {]/)[0]);
    assert.equal(fixas.length, 3);
    assert.ok(/\.agenda-painel/.test(fixas.join(" ")));
  });

  test("as três páginas carregam tokens.css antes do CSS próprio", () => {
    assert.match(ler("index.html"), /<link rel="stylesheet" href="tokens\.css">\r?\n<link rel="stylesheet" href="style\.css">/);
    assert.match(ler("fundamentos/index.html"), /<link rel="stylesheet" href="\.\.\/tokens\.css">\r?\n<link rel="stylesheet" href="fundamentos\.css">/);
    assert.match(ler("fundamentos/fundamentos.css"), /\.busca input \{[^}]*border: 1px solid var\(--tinta-suave\)/);
  });

  test("nenhuma caixa-alta espaçada em rótulo", () => {
    for (const arquivo of ["style.css", "fundamentos/fundamentos.css", "menu.css", "tokens.css"]) assert.ok(!/text-transform:\s*uppercase/.test(ler(arquivo)), arquivo);
  });
});
