// Critério de aceite da v2.0 (#40): toda fórmula citada na página Fundamentalista está no README.
// O teste junta os nomes que a página mostra (indicadores, múltiplos, as sete regras de atenção, os
// cartões de consistência, a comparação com o setor, os números do painel e os critérios dos
// rankings) e confere que cada um é
// a primeira célula de uma linha de uma tabela de fórmulas do README, com a fórmula preenchida.
// Tabela de fórmulas é a que tem uma coluna cujo título começa com "Fórmula".
// Quem criar um indicador, uma regra ou um número sem documentar quebra este teste.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INDICADORES } from "../scripts/cvm/indicadores.mjs";
import { MULTIPLOS } from "../scripts/cvm/multiplos.mjs";
import { BLOCOS } from "../scripts/fundamentos/pagina.mjs";
import { calcularAtencao } from "../scripts/fundamentos/atencao.mjs";
import { calcularConsistencia } from "../scripts/fundamentos/consistencia.mjs";
import { consistenciaHtml } from "../scripts/fundamentos/resumo.mjs";
import { INDICADORES_DE_PARES } from "../scripts/fundamentos/pares.mjs";
import { montarPainel } from "../scripts/fundamentos/painel.mjs";
import { painelHtml } from "../scripts/fundamentos/painel-html.mjs";
import { CRITERIOS } from "../scripts/fundamentos/rankings.mjs";
import { fichaDaWeg } from "./apoio/ficha.mjs";

const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");

// ---------- leitura do README ----------

// Compara sem diferença de maiúsculas, de espaços, de negrito e de crase.
const normalizar = (texto) => String(texto).replace(/[*`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const celulas = (linha) => linha.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const ehSeparador = (linha) => celulas(linha).every((c) => /^:?-{3,}:?$/.test(c));

// As linhas das tabelas de fórmulas de um Markdown: Map de nome normalizado → texto da fórmula.
export function formulasDoMarkdown(md) {
  const formulas = new Map();
  const linhas = md.split(/\r?\n/);
  for (let i = 0; i < linhas.length; i++) {
    // Uma tabela começa no cabeçalho seguido da linha de traços.
    if (!linhas[i].trim().startsWith("|") || !linhas[i + 1]?.trim().startsWith("|") || !ehSeparador(linhas[i + 1])) continue;
    const coluna = celulas(linhas[i]).findIndex((c) => normalizar(c).startsWith("fórmula"));
    let j = i + 2;
    for (; j < linhas.length && linhas[j].trim().startsWith("|"); j++) {
      if (coluna < 1) continue;
      const c = celulas(linhas[j]);
      formulas.set(normalizar(c[0]), c[coluna] ?? "");
    }
    i = j - 1;
  }
  return formulas;
}

// Os nomes que não têm linha (ou têm a fórmula vazia) nas tabelas de fórmulas.
export function semFormula(nomes, formulas) {
  return nomes.filter((nome) => !(formulas.get(normalizar(nome)) ?? "").trim());
}

// ---------- os nomes que a página mostra ----------

const ficha = fichaDaWeg();
const textos = (html, expressao) => [...html.matchAll(expressao)].map((m) => m[1].replace(/&amp;/g, "&").trim());

const NOMES = {
  // As linhas dos quatro blocos da ficha (o balão de cada uma mostra a fórmula).
  indicadores: INDICADORES.map((i) => i.nome),
  // A tabela de múltiplos do bloco Valuation.
  multiplos: MULTIPLOS.map((m) => m.nome),
  // As sete regras dos pontos de atenção.
  regras: calcularAtencao(ficha).regras.map((r) => r.titulo),
  // Os cartões de "Ao longo dos anos", como a página os escreve.
  consistencia: textos(consistenciaHtml(calcularConsistencia(ficha)), /<span class="cartao-rotulo">([^<]+)<\/span>/g),
  // As linhas da comparação com o setor.
  pares: INDICADORES_DE_PARES.map((i) => i.nome),
  // O painel da temporada: os quatro números e os dois blocos com conta.
  painel: (() => {
    const html = painelHtml(montarPainel([ficha]));
    const numeros = /<ul class="temporada-numeros">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
    return [...textos(numeros, /<span>([^<]+)<\/span>/g), ...textos(html, /<h3 id="t-(?:variacoes|setores)">([^<]+)<\/h3>/g)];
  })(),
  // Os critérios da página de rankings (#67).
  rankings: CRITERIOS.map((c) => c.titulo),
};

const FORMULAS = formulasDoMarkdown(README);

describe("README: toda fórmula citada na página está documentada", () => {
  test("o teste enxerga tudo o que a página mostra", () => {
    // Se a página mudar de forma e o teste deixar de achar os nomes, ele falha aqui, e não passa em branco.
    assert.equal(NOMES.indicadores.length, new Set(BLOCOS.flatMap((b) => b.indicadores)).size, "todo indicador está num bloco da ficha");
    assert.equal(NOMES.multiplos.length, 10);
    assert.equal(NOMES.regras.length, 7);
    assert.equal(NOMES.consistencia.length, 8);
    assert.equal(NOMES.pares.length, 8);
    assert.equal(NOMES.painel.length, 6);
    assert.equal(NOMES.rankings.length, 11);
  });

  for (const [grupo, nomes] of Object.entries(NOMES)) {
    test(`${grupo}: cada nome tem uma linha com fórmula no README`, () => {
      assert.deepEqual(semFormula(nomes, FORMULAS), [], "falta no README (seção de fórmulas)");
    });
  }

  test("um nome que não está no README é apontado", () => {
    assert.deepEqual(semFormula(["EBITDA", "Indicador que ninguém documentou"], FORMULAS), ["Indicador que ninguém documentou"]);
  });
});

describe("README: leitura das tabelas de fórmulas", () => {
  const md = [
    "| Indicador | Fórmula |", "|---|---|", "| **Margem** `x` | lucro ÷ receita |", "| Sem conta | |", "",
    "| Caminho | O que é |", "|---|---|", "| EBITDA | não é tabela de fórmulas |", "",
    "  | Regra | Fórmula e limite padrão | Detalhes |", "  |---|---|---|", "  | Diluição | mais de 2% ao ano | janela de 3 |",
  ].join("\r\n");
  const f = formulasDoMarkdown(md);

  test("só entram as tabelas com uma coluna de fórmula, com ou sem recuo e com CRLF", () => {
    assert.deepEqual([...f.keys()], ["margem x", "sem conta", "diluição"]);
    assert.equal(f.get("diluição"), "mais de 2% ao ano");
  });

  test("linha com a fórmula vazia conta como não documentada", () => {
    assert.deepEqual(semFormula(["Margem x", "Sem conta", "EBITDA"], f), ["Sem conta", "EBITDA"]);
  });
});
