// Leitura de ZIP em fluxo, direto do disco (#37). O ZIP é montado aqui e gravado numa pasta temporária.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entradasDoZip, juntarLinhas } from "../scripts/zip.mjs";
import { entradasDoArquivoZip, linhasDaEntrada, pedacosDaEntrada } from "../scripts/zip-fluxo.mjs";
import { montarZip } from "./apoio/zip.mjs";

// Um CSV parecido com os da CVM: latin1, ponto e vírgula e CRLF. São 60 mil linhas, cerca de 5 MB.
const CABECALHO = "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CONTA;DS_CONTA;VL_CONTA";
const linha = (i) => `${String(i % 97).padStart(2, "0")}.000.000/0001-00;2025-12-31;1;COMPANHIA DE AÇÚCAR E ÁLCOOL ${i};3.01;Receita de Venda de Bens e/ou Serviços;${i * 37}.0000000000`;
const LINHAS = [CABECALHO, ...Array.from({ length: 60_000 }, (_, i) => linha(i))];
const GRANDE = Buffer.from(`${LINHAS.join("\r\n")}\r\n`, "latin1");

let pasta;
const caminho = (nome) => join(pasta, nome);
const gravar = (nome, zip) => { writeFileSync(caminho(nome), zip); return caminho(nome); };
const juntar = async (iteravel) => { const tudo = []; for await (const x of iteravel) tudo.push(x); return tudo; };

before(() => { pasta = mkdtempSync(join(tmpdir(), "zip-fluxo-")); });
after(() => { rmSync(pasta, { recursive: true, force: true }); });

describe("leitura em fluxo: igual à leitura inteira", () => {
  test("entrada grande (5 MB, deflate): os pedaços somados dão os mesmos bytes da leitura inteira", async () => {
    assert.ok(GRANDE.length > 5_000_000, `${GRANDE.length} bytes`);
    const zip = montarZip([{ nome: "pequeno.csv", conteudo: "a;b\r\n" }, { nome: "grande.csv", conteudo: GRANDE, metodo: 8 }]);
    const arquivo = gravar("grande.zip", zip);
    const entradas = await entradasDoArquivoZip(arquivo);
    assert.deepEqual(entradas.map((e) => [e.nome, e.tamanho, e.metodo]), [["pequeno.csv", 5, 8], ["grande.csv", GRANDE.length, 8]]);
    const pedacos = await juntar(pedacosDaEntrada(arquivo, entradas[1]));
    assert.ok(pedacos.length > 10, `veio em ${pedacos.length} pedaços`); // não veio de uma vez só
    const inteira = entradasDoZip(zip)[1].ler();
    assert.ok(Buffer.concat(pedacos).equals(inteira));
    assert.ok(inteira.equals(GRANDE));
  });

  test("linha a linha: as mesmas linhas, na mesma ordem, com os acentos do latin1", async () => {
    const arquivo = gravar("linhas.zip", montarZip([{ nome: "grande.csv", conteudo: GRANDE }]));
    const [entrada] = await entradasDoArquivoZip(arquivo);
    const linhas = await juntar(linhasDaEntrada(arquivo, entrada));
    assert.equal(linhas.length, LINHAS.length);
    assert.deepEqual(linhas.map((l) => l.replace(/\r$/, "")), LINHAS);
    assert.ok(linhas[1].endsWith("\r")); // o CR do CRLF fica; quem lê tira
    assert.match(linhas[5], /COMPANHIA DE AÇÚCAR E ÁLCOOL 4;3\.01;Receita de Venda de Bens e\/ou Serviços/);
  });

  test("método 0 (guardado), arquivo sem quebra no fim e entrada vazia", async () => {
    const arquivo = gravar("guardado.zip", montarZip([
      { nome: "guardado.csv", conteudo: "a;b\r\n1;2", metodo: 0 },
      { nome: "vazio.csv", conteudo: "", metodo: 0 },
    ]));
    const [guardado, vazio] = await entradasDoArquivoZip(arquivo);
    assert.deepEqual(await juntar(linhasDaEntrada(arquivo, guardado)), ["a;b\r", "1;2"]);
    assert.deepEqual(await juntar(linhasDaEntrada(arquivo, vazio)), []);
  });

  test("pasta fica de fora; comentário no fim do arquivo e campo extra não atrapalham", async () => {
    const arquivo = gravar("comentario.zip", montarZip([{ nome: "pasta/", conteudo: "", metodo: 0 }, { nome: "pasta/a.csv", conteudo: "x\r\n", extra: "12345678" }], { comentario: "dados abertos" }));
    const entradas = await entradasDoArquivoZip(arquivo);
    assert.deepEqual(entradas.map((e) => e.nome), ["pasta/a.csv"]);
    assert.deepEqual(await juntar(linhasDaEntrada(arquivo, entradas[0])), ["x\r"]);
  });

  test("utf-8: um caractere cortado entre dois pedaços sai inteiro", async () => {
    const texto = "ação;é;ü\n".repeat(40_000);
    const arquivo = gravar("utf8.zip", montarZip([{ nome: "u.csv", conteudo: Buffer.from(texto, "utf8"), metodo: 0 }]));
    const [entrada] = await entradasDoArquivoZip(arquivo);
    const linhas = await juntar(linhasDaEntrada(arquivo, entrada, { codificacao: "utf-8" }));
    assert.equal(linhas.length, 40_000);
    assert.ok(linhas.every((l) => l === "ação;é;ü"));
  });
});

describe("leitura em fluxo: erros claros", () => {
  test("CRC-32 errado: o erro aparece no fim da leitura", async () => {
    const arquivo = gravar("crc.zip", montarZip([{ nome: "a.csv", conteudo: "x\r\n", crc: 123 }]));
    const [entrada] = await entradasDoArquivoZip(arquivo);
    await assert.rejects(juntar(linhasDaEntrada(arquivo, entrada)), /ZIP: entrada "a\.csv": CRC-32 não confere/);
  });

  test("criptografia e método desconhecido", async () => {
    const arquivo = gravar("cripto.zip", montarZip([{ nome: "segredo.csv", conteudo: "x", marcas: 0x0801 }]));
    const [entrada] = await entradasDoArquivoZip(arquivo);
    await assert.rejects(juntar(pedacosDaEntrada(arquivo, entrada)), /criptografada; criptografia não é suportada/);
    await assert.rejects(juntar(pedacosDaEntrada(arquivo, { ...entrada, marcas: 0, metodo: 12 })), /método de compressão 12/);
  });

  test("ZIP64, arquivo cortado e arquivo que não é ZIP", async () => {
    const um = [{ nome: "a.csv", conteudo: GRANDE }];
    await assert.rejects(entradasDoArquivoZip(gravar("zip64.zip", montarZip(um, { zip64: true }))), /ZIP: ZIP64 não é suportado/);
    const zip = montarZip(um);
    await assert.rejects(entradasDoArquivoZip(gravar("cortado.zip", zip.subarray(0, zip.length - 30))), /não achei o fim do diretório central/);
    await assert.rejects(entradasDoArquivoZip(gravar("html.zip", Buffer.from("<html>404 Not Found</html>".repeat(5)))), /não achei o fim do diretório central/);
    await assert.rejects(entradasDoArquivoZip(gravar("vazio.zip", Buffer.alloc(0))), /ZIP: arquivo curto demais \(0 bytes\)/);
    await assert.rejects(entradasDoArquivoZip(caminho("nao-existe.zip")), /ENOENT/);
  });

  test("dados comprimidos corrompidos: erro, e não linhas erradas", async () => {
    const zip = montarZip([{ nome: "a.csv", conteudo: GRANDE }]);
    zip.fill(0xff, 5000, 5200); // estraga um trecho no meio dos dados
    const arquivo = gravar("corrompido.zip", zip);
    const [entrada] = await entradasDoArquivoZip(arquivo);
    await assert.rejects(juntar(linhasDaEntrada(arquivo, entrada)));
  });
});

describe("juntarLinhas: pedaços de texto viram linhas", () => {
  test("a linha cortada entre dois pedaços sai inteira; o CR do CRLF fica", () => {
    const j = juntarLinhas();
    assert.deepEqual(j.receber("a;b\r\nc;"), ["a;b\r"]);
    assert.deepEqual(j.receber("d\r\ne"), ["c;d\r"]);
    assert.deepEqual(j.receber(""), []);
    assert.equal(j.sobra(), "e");
  });

  test("arquivo que termina em quebra de linha não deixa sobra", () => {
    const j = juntarLinhas();
    assert.deepEqual(j.receber("a\nb\n"), ["a", "b"]);
    assert.equal(j.sobra(), null);
  });
});
