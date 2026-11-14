// Leitor de ZIP mínimo (#51). Os ZIPs são montados aqui mesmo, byte a byte, para o teste não depender
// de nenhum programa de fora.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { entradasDoZip, juntarLinhas, lerDoZip } from "../scripts/zip.mjs";
import { montarZip } from "./apoio/zip.mjs";

const TEXTO = "012026111202WEGE3       010WEG\r\n".repeat(200);

describe("leitor de ZIP: métodos 8 e 0", () => {
  test("deflate (método 8): devolve o conteúdo original", () => {
    const zip = montarZip([{ nome: "COTAHIST_D12112026.TXT", conteudo: TEXTO, metodo: 8 }]);
    const [e] = entradasDoZip(zip);
    assert.deepEqual([e.nome, e.tamanho, e.metodo], ["COTAHIST_D12112026.TXT", TEXTO.length, 8]);
    assert.ok(e.comprimido < e.tamanho);
    assert.equal(e.ler().toString("latin1"), TEXTO);
  });

  test("guardado (método 0): cópia direta", () => {
    const zip = montarZip([{ nome: "a.txt", conteudo: "sem compressão", metodo: 0 }]);
    const [e] = entradasDoZip(zip);
    assert.deepEqual([e.metodo, e.tamanho, e.comprimido], [0, 15, 15]);
    assert.equal(e.ler().toString(), "sem compressão");
  });

  test("várias entradas, na ordem do diretório; pasta fica de fora; arquivo vazio é lido", () => {
    const zip = montarZip([
      { nome: "pasta/", conteudo: "", metodo: 0 },
      { nome: "pasta/um.csv", conteudo: "a;b\r\n1;2\r\n" },
      { nome: "dois.csv", conteudo: "x", metodo: 0 },
      { nome: "vazio.txt", conteudo: "", metodo: 0 },
    ]);
    const entradas = entradasDoZip(zip);
    assert.deepEqual(entradas.map((e) => e.nome), ["pasta/um.csv", "dois.csv", "vazio.txt"]);
    assert.deepEqual(entradas.map((e) => e.ler().toString()), ["a;b\r\n1;2\r\n", "x", ""]);
  });

  test("campo extra no cabeçalho local e comentário no fim do arquivo não atrapalham", () => {
    const zip = montarZip([{ nome: "a.txt", conteudo: "conteúdo", extra: "12345678" }], { comentario: "gerado em 12/11/2026" });
    assert.equal(entradasDoZip(zip)[0].ler().toString(), "conteúdo");
  });

  test("nome em UTF-8 quando o ZIP marca; em latin1 quando não marca", () => {
    assert.equal(entradasDoZip(montarZip([{ nome: "ação.txt", conteudo: "x" }]))[0].nome, "ação.txt");
    const semMarca = montarZip([{ nome: "acao.txt", conteudo: "x", marcas: 0 }]);
    assert.equal(entradasDoZip(semMarca)[0].nome, "acao.txt");
  });

  test("aceita Uint8Array além de Buffer", () => {
    const zip = montarZip([{ nome: "a.txt", conteudo: "x" }]);
    assert.equal(entradasDoZip(new Uint8Array(zip))[0].ler().toString(), "x");
  });

  test("lerDoZip acha pelo nome ou por um teste do nome", () => {
    const zip = montarZip([{ nome: "a.txt", conteudo: "A" }, { nome: "B.TXT", conteudo: "B" }]);
    assert.equal(lerDoZip(zip, "a.txt").toString(), "A");
    assert.equal(lerDoZip(zip, (n) => /\.TXT$/.test(n)).toString(), "B");
    assert.throws(() => lerDoZip(zip, "c.txt"), /ZIP: entrada "c\.txt" não está no arquivo/);
  });
});

describe("leitor de ZIP: erros claros", () => {
  test("ZIP64: pelo localizador, pelo total 0xFFFF e pela posição 0xFFFFFFFF", () => {
    const um = [{ nome: "a.txt", conteudo: "x" }];
    assert.throws(() => entradasDoZip(montarZip(um, { zip64: true })), /ZIP: ZIP64 não é suportado/);
    assert.throws(() => entradasDoZip(montarZip(um, { total: 0xffff })), /ZIP: ZIP64 não é suportado/);
    assert.throws(() => entradasDoZip(montarZip(um, { inicioDoDiretorio: 0xffffffff })), /ZIP: ZIP64 não é suportado/);
    assert.throws(() => entradasDoZip(montarZip([{ ...um[0], comprimidoNoDiretorio: 0xffffffff }])), /ZIP: ZIP64 não é suportado \(entrada "a\.txt"\)/);
  });

  test("criptografia: o erro aparece ao ler a entrada", () => {
    const [e] = entradasDoZip(montarZip([{ nome: "segredo.txt", conteudo: "x", marcas: 0x0801 }]));
    assert.throws(() => e.ler(), /ZIP: entrada "segredo\.txt" criptografada; criptografia não é suportada/);
  });

  test("método de compressão desconhecido", () => {
    const zip = montarZip([{ nome: "a.txt", conteudo: "x", metodo: 0 }]);
    zip.writeUInt16LE(12, zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10); // bzip2 no diretório
    assert.throws(() => entradasDoZip(zip)[0].ler(), /método de compressão 12; só 0 \(guardado\) e 8 \(deflate\)/);
  });

  test("CRC-32 errado", () => {
    const [e] = entradasDoZip(montarZip([{ nome: "a.txt", conteudo: "x", crc: 123 }]));
    assert.throws(() => e.ler(), /ZIP: entrada "a\.txt": CRC-32 não confere/);
  });

  test("não é ZIP, está cortado ou veio vazio", () => {
    assert.throws(() => entradasDoZip(Buffer.from("<html>The page cannot be found</html>".repeat(3))), /não achei o fim do diretório central/);
    const zip = montarZip([{ nome: "a.txt", conteudo: TEXTO }]);
    assert.throws(() => entradasDoZip(zip.subarray(0, zip.length - 30)), /não achei o fim do diretório central/);
    assert.throws(() => entradasDoZip(Buffer.alloc(0)), /ZIP: arquivo curto demais \(0 bytes\)/);
    assert.throws(() => entradasDoZip(null), /ZIP: arquivo curto demais/);
  });

  test("vários discos", () => {
    assert.throws(() => entradasDoZip(montarZip([{ nome: "a.txt", conteudo: "x" }], { disco: 1 })), /vários discos não é suportado/);
  });
});
