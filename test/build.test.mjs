import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAGINAS, MARCADOR, arquivoDaPagina, hrefPara, inserirMenu, linksInternos, menuHtml, profundidade, removerMenu,
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
    assert.deepEqual([...new Set(hrefs(html).map((i) => i.href))], ["./", "fundamentos/", "fundamentos/rankings/"]);
    assert.match(html, /<link rel="stylesheet" href="menu\.css">/);
  });

  test("caminhos relativos certos numa subpasta", () => {
    const html = menuHtml(PAGINAS, "fundamentos", 1);
    assert.deepEqual([...new Set(hrefs(html).map((i) => i.href))], ["../", "../fundamentos/", "../fundamentos/rankings/"]);
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

  test("o summary do celular mostra a página atual; página desconhecida dá erro", () => {
    assert.match(menuHtml(PAGINAS, "fundamentos", 1), /<summary>Fundamentalista<\/summary>/);
    assert.throws(() => menuHtml(PAGINAS, "overview", 0), /desconhecida/);
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
    assert.ok(gerado.includes('class="menu-site"'), "o menu foi inserido");
    assert.deepEqual(Buffer.from(removerMenu(gerado), "utf8"), original);
  });

  test("as páginas continuam nos mesmos lugares (Diário na raiz) e os demais arquivos são cópias exatas", () => {
    for (const p of PAGINAS) assert.ok(existsSync(join(dist, arquivoDaPagina(p))), p.id);
    const paginas = new Set(PAGINAS.map((p) => join(dist, arquivoDaPagina(p))));
    for (const f of arquivos(dist).filter((a) => !paginas.has(a))) {
      assert.deepEqual(readFileSync(f), readFileSync(join(RAIZ, "site", relative(dist, f))), relative(dist, f));
    }
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
