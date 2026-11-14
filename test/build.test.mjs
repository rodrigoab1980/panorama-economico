import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LARGURA_DO_BOTAO, NOME_DO_SITE, PAGINAS, MARCADOR, arquivoDaPagina, hrefPara, inserirMenu, linksInternos, menuHtml, profundidade, removerMenu,
} from "../scripts/paginas.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

describe("menuHtml", () => {
  const hrefs = (html) => [...html.matchAll(/<a href="([^"]*)"([^>]*)>([^<]*)</g)].map((m) => ({ href: m[1], atual: m[2].includes('aria-current="page"'), texto: m[3] }));

  test("marca a página ativa com aria-current, e só ela", () => {
    const itens = hrefs(menuHtml(PAGINAS, "fundamentos", 1));
    assert.ok(itens.length >= PAGINAS.length);
    for (const i of itens) assert.equal(i.atual, i.texto === "Fundamentalista", i.texto);
  });

  test("caminhos relativos certos na raiz", () => {
    const html = menuHtml(PAGINAS, "diario", 0);
    assert.deepEqual([...new Set(hrefs(html).map((i) => i.href))], ["./", "fundamentos/", "fundamentos/rankings/", "fundamentos/temporada/"]);
    assert.match(html, /<link rel="stylesheet" href="menu\.css">/);
  });

  test("caminhos relativos certos numa subpasta", () => {
    const html = menuHtml(PAGINAS, "fundamentos", 1);
    assert.deepEqual([...new Set(hrefs(html).map((i) => i.href))], ["../", "../fundamentos/", "../fundamentos/rankings/", "../fundamentos/temporada/"]);
    assert.match(html, /<link rel="stylesheet" href="\.\.\/menu\.css">/);
  });

  test("dois níveis abaixo da raiz sobe duas pastas", () => {
    assert.equal(hrefPara({ pasta: "" }, 2), "../../");
    assert.equal(hrefPara({ pasta: "fundamentos/" }, 2), "../../fundamentos/");
  });

  test("nenhum link do menu começa com /", () => {
    for (const p of PAGINAS) {
      for (const l of linksInternos(menuHtml(PAGINAS, p.id, profundidade(p)))) assert.ok(!l.startsWith("/"), l);
    }
  });

  test("página desconhecida dá erro", () => {
    assert.throws(() => menuHtml(PAGINAS, "overview", 0), /desconhecida/);
  });

  test("a barra: o nome do site à esquerda (link para a raiz), depois o botão e os quatro itens", () => {
    const html = menuHtml(PAGINAS, "rankings", 2);
    assert.match(html, /<header class="barra-site"><a class="barra-marca" href="\.\.\/\.\.\/">Panorama Econômico<\/a><button class="barra-botao"/);
    assert.equal(NOME_DO_SITE, "Panorama Econômico");
    assert.deepEqual(hrefs(html).filter((i) => i.texto !== NOME_DO_SITE).map((i) => i.texto), ["Diário", "Fundamentalista", "Rankings", "Temporada"]);
    assert.equal((html.match(/<header /g) ?? []).length, 1);
    assert.equal((html.match(/<nav /g) ?? []).length, 1);
    assert.match(html, /<nav class="barra-nav" id="barra-menu" aria-label="Seções do site"><ul>/);
  });

  test("o botão de menu é acessível: aria-expanded, aria-controls para a lista, e escondido até o JS ligar", () => {
    const html = menuHtml(PAGINAS, "diario", 0);
    assert.match(html, /<button class="barra-botao" type="button" aria-expanded="false" aria-controls="barra-menu" hidden><span class="barra-botao-icone" aria-hidden="true"><\/span>Menu<\/button>/);
    assert.match(html, /<script src="menu\.js"><\/script>$/);
    assert.match(menuHtml(PAGINAS, "fundamentos", 1), /<script src="\.\.\/menu\.js"><\/script>$/);
    // o menu antigo (lista dentro do cabeçalho e gaveta em <details>) saiu
    assert.ok(!/menu-site|<details|<summary/.test(html));
  });

  test("a barra é a mesma em toda página: só mudam o item atual e o caminho relativo", () => {
    const normal = (html) => html.replace(/ aria-current="page"/g, "").replace(/(href|src)="(?:\.\.\/)+/g, '$1="').replace(/href="\.\/"/g, 'href=""');
    const base = normal(menuHtml(PAGINAS, "diario", 0));
    for (const p of PAGINAS) {
      for (const prof of [profundidade(p), profundidade(p) + 1]) assert.equal(normal(menuHtml(PAGINAS, p.id, prof)), base, `${p.id} a ${prof} pastas`);
    }
  });

  test("a barra fica no fluxo da página: sem position, para nada se sobrepor a ela", () => {
    const css = readFileSync(join(RAIZ, "site", "menu.css"), "utf8").replace(/\/\*.*?\*\//gs, "");
    const daBarra = css.split("}").filter((r) => /\.barra-(site|nav|marca)/.test(r) && !/barra-botao-icone/.test(r)).join("}");
    assert.ok(!/position\s*:|z-index\s*:/.test(daBarra));
    // o cabeçalho do Diário não tem mais regra de menu, e o menu antigo saiu do CSS
    for (const arquivo of ["menu.css", "style.css", "fundamentos/fundamentos.css"]) {
      assert.ok(!/menu-site|\.cabeca\b/.test(readFileSync(join(RAIZ, "site", arquivo), "utf8")), arquivo);
    }
  });

  test("abaixo de 640 px a barra vira o botão: o mesmo número no código, no CSS e no JS", () => {
    assert.equal(LARGURA_DO_BOTAO, 640);
    const css = readFileSync(join(RAIZ, "site", "menu.css"), "utf8");
    const js = readFileSync(join(RAIZ, "site", "menu.js"), "utf8");
    assert.match(css, new RegExp(`@media \\(max-width: ${LARGURA_DO_BOTAO - 1}px\\)`));
    assert.match(js, new RegExp(`matchMedia\\("\\(min-width: ${LARGURA_DO_BOTAO}px\\)"\\)`));
    // sem JS (sem a classe .com-botao), a lista continua à vista e rola se não couber
    assert.match(css, /\.barra-nav ul \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto/);
    assert.match(css, /\.barra-site\.com-botao \.barra-nav \{ display: none;/);
    assert.match(css, /\.barra-site\.com-botao\.aberta \.barra-nav \{ display: block; \}/);
  });

  test("menu.js: liga o botão, alterna o aria-expanded, fecha no Esc e devolve o foco; sem biblioteca", () => {
    const js = readFileSync(join(RAIZ, "site", "menu.js"), "utf8");
    assert.match(js, /botao\.hidden = false/);
    assert.match(js, /setAttribute\("aria-expanded", String\(sim\)\)/);
    assert.match(js, /e\.key !== "Escape"/);
    assert.match(js, /botao\.focus\(\)/);
    assert.ok(!/import |require\(|https?:\/\//.test(js));
  });

  test("só lista páginas que existem em site/ (itens da v3 entram quando existirem)", () => {
    for (const p of PAGINAS) assert.ok(existsSync(join(RAIZ, "site", arquivoDaPagina(p))), p.id);
  });
});

describe("inserirMenu e removerMenu", () => {
  const html = `<header>\r\n  ${MARCADOR}\r\n</header>`;

  test("removerMenu desfaz inserirMenu byte a byte", () => {
    const com = inserirMenu(html, "<nav>x</nav>");
    assert.notEqual(com, html);
    assert.equal(removerMenu(com), html);
  });

  test("exige exatamente um marcador", () => {
    assert.throws(() => inserirMenu("<p>sem</p>", "m"), /exatamente um/);
    assert.throws(() => inserirMenu(`${MARCADOR}${MARCADOR}`, "m"), /exatamente um/);
  });
});

describe("linksInternos", () => {
  test("pega href/src relativos e absolutos; ignora externos, âncoras, data: e data-src", () => {
    const html = `<a href="./">a</a><a href="fundamentos/">b</a><link href="style.css"><script src="app.js"></script>
      <img src="/abs.png"><a href="//cdn.x/y">c</a><a href="https://x.com">d</a><a href="#topo">e</a>
      <link rel="icon" href="data:image/svg+xml,x"><div data-src="https://y"></div><a href="mailto:a@b">f</a>`;
    assert.deepEqual(linksInternos(html), ["./", "fundamentos/", "style.css", "app.js", "/abs.png", "//cdn.x/y"]);
  });
});

describe("build em dist/", () => {
  let dist;
  before(() => {
    dist = mkdtempSync(join(tmpdir(), "dist-"));
    // DADOS_DIR aponta para uma pasta que não existe: o teste não depende de haver fundamentos coletados na máquina.
    execFileSync(process.execPath, [join(RAIZ, "scripts", "build.mjs"), "site", dist], { cwd: RAIZ, stdio: "pipe", env: { ...process.env, DADOS_DIR: join(dist, "sem-dados") } });
  });
  after(() => rmSync(dist, { recursive: true, force: true }));

  const arquivos = (dir) => readdirSync(dir, { recursive: true }).map((f) => join(dir, f)).filter((f) => statSync(f).isFile());

  test("o Diário fica idêntico: dist/index.html sem o bloco do menu é igual a site/index.html, byte a byte", () => {
    const original = readFileSync(join(RAIZ, "site", "index.html"));
    const gerado = readFileSync(join(dist, "index.html"), "utf8");
    assert.ok(gerado.includes('class="barra-site"'), "a barra foi inserida");
    assert.deepEqual(Buffer.from(removerMenu(gerado), "utf8"), original);
  });

  test("as páginas continuam nos mesmos lugares (Diário na raiz) e os demais arquivos são cópias exatas", () => {
    for (const p of PAGINAS) assert.ok(existsSync(join(dist, arquivoDaPagina(p))), p.id);
    const paginas = new Set(PAGINAS.map((p) => join(dist, arquivoDaPagina(p))));
    for (const f of arquivos(dist).filter((a) => !paginas.has(a))) {
      assert.deepEqual(readFileSync(f), readFileSync(join(RAIZ, "site", relative(dist, f))), relative(dist, f));
    }
  });

  test("todas as páginas usam a mesma barra de topo: a de menuHtml, uma só, logo no início do body", () => {
    for (const p of PAGINAS) {
      const html = readFileSync(join(dist, arquivoDaPagina(p)), "utf8");
      const barra = menuHtml(PAGINAS, p.id, profundidade(p));
      assert.ok(html.includes(barra), `${p.id}: a barra não é a de menuHtml`);
      assert.equal(html.split('<header class="barra-site">').length, 2, `${p.id}: uma barra só`);
      assert.match(html, /<body[^>]*>\s*<!-- menu --><link rel="stylesheet" href="[./]*menu\.css"><header class="barra-site">/, `${p.id}: a barra abre a página`);
      assert.ok(!/menu-site|class="cabeca"|cabeca-marca/.test(html), `${p.id}: sobrou menu antigo`);
    }
    // o Diário não tem mais o menu dentro do cabeçalho dele
    const diario = readFileSync(join(dist, "index.html"), "utf8");
    const topo = diario.slice(diario.indexOf('<header class="topo">'), diario.indexOf("</header>", diario.indexOf('<header class="topo">')));
    assert.ok(!/<nav|barra-|menu/.test(topo));
    assert.ok(existsSync(join(dist, "menu.js")) && existsSync(join(dist, "menu.css")));
  });

  test("cada página marca a si mesma como atual", () => {
    for (const p of PAGINAS) {
      const html = readFileSync(join(dist, arquivoDaPagina(p)), "utf8");
      const atuais = [...html.matchAll(/<a href="[^"]*" aria-current="page"[^>]*>([^<]*)</g)].map((m) => m[1]);
      assert.ok(atuais.length > 0 && atuais.every((t) => t === p.titulo), `${p.id}: ${atuais}`);
    }
  });

  test("sem dados, a página de rankings sai com o aviso, sem o marcador e sem o JSON", () => {
    const html = readFileSync(join(dist, "fundamentos", "rankings", "index.html"), "utf8");
    assert.match(html, /<h2>Rankings por indicador<\/h2>/);
    assert.match(html, /ainda não foram coletados/);
    assert.ok(!html.includes("<!-- rankings -->"));
    assert.ok(!existsSync(join(dist, "fundamentos", "dados", "rankings.json")));
  });

  test("sem dados, a página da temporada sai com o aviso, sem o marcador e sem o JSON", () => {
    const html = readFileSync(join(dist, "fundamentos", "temporada", "index.html"), "utf8");
    assert.match(html, /<h2>Temporada de balanços<\/h2>/);
    assert.match(html, /ainda não foram coletados/);
    assert.ok(!html.includes("<!-- temporada -->"));
    assert.ok(!existsSync(join(dist, "fundamentos", "dados", "temporada.json")));
  });

  test("nenhum link interno quebrado e nenhum caminho absoluto em dist/", () => {
    let conferidos = 0;
    for (const f of arquivos(dist).filter((a) => a.endsWith(".html"))) {
      for (const link of linksInternos(readFileSync(f, "utf8"))) {
        assert.ok(!link.startsWith("/"), `${relative(dist, f)}: caminho absoluto ${link}`);
        let alvo = join(dirname(f), link.split(/[?#]/)[0]);
        if (link.split(/[?#]/)[0].endsWith("/") || (existsSync(alvo) && statSync(alvo).isDirectory())) alvo = join(alvo, "index.html");
        assert.ok(alvo.startsWith(dist), `${relative(dist, f)}: ${link} sai de dist/`);
        assert.ok(existsSync(alvo), `${relative(dist, f)}: link quebrado ${link}`);
        conferidos++;
      }
    }
    assert.ok(conferidos >= 10, `poucos links conferidos (${conferidos})`);
  });
});
