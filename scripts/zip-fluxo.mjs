// Leitura de ZIP em fluxo, direto do disco (casca: usa `node:fs`). A lógica do formato está em zip.mjs.
//
// Para que serve: o ZIP de ITR de um ano da CVM abre em cerca de 875 MB. Aqui o arquivo não é
// carregado: só o diretório central (alguns KB) vai para a memória, e cada entrada é descomprimida
// aos pedaços (`createInflateRaw` sobre o trecho do arquivo onde ela está), linha a linha.
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { crc32, createInflateRaw } from "node:zlib";
import { TAMANHO_DA_CAUDA, TAMANHO_DO_CABECALHO_LOCAL, acharDiretorio, conferirEntrada, erroDeZip, inicioDosDados, juntarLinhas, lerDiretorio } from "./zip.mjs";

async function lerTrecho(arquivo, posicao, tamanho) {
  const b = Buffer.alloc(tamanho);
  let lidos = 0;
  while (lidos < tamanho) {
    const { bytesRead } = await arquivo.read(b, lidos, tamanho - lidos, posicao + lidos);
    if (bytesRead === 0) break;
    lidos += bytesRead;
  }
  return b.subarray(0, lidos);
}

// Entradas de um ZIP no disco: [{ nome, tamanho, comprimido, metodo, marcas, crc, local }].
export async function entradasDoArquivoZip(caminho) {
  const arquivo = await open(caminho, "r");
  try {
    const { size } = await arquivo.stat();
    const cauda = await lerTrecho(arquivo, Math.max(0, size - TAMANHO_DA_CAUDA), Math.min(size, TAMANHO_DA_CAUDA));
    const { total, tamanhoDoDiretorio, inicioDoDiretorio } = acharDiretorio(cauda, size);
    return lerDiretorio(await lerTrecho(arquivo, inicioDoDiretorio, tamanhoDoDiretorio), total);
  } finally {
    await arquivo.close();
  }
}

// O conteúdo de uma entrada, aos pedaços (Buffers), sem carregar a entrada inteira.
// `entrada` vem de entradasDoArquivoZip. No fim, confere o tamanho e o CRC-32 e lança erro se não baterem.
export async function* pedacosDaEntrada(caminho, entrada) {
  conferirEntrada(entrada);
  const arquivo = await open(caminho, "r");
  let dados;
  try {
    dados = inicioDosDados(await lerTrecho(arquivo, entrada.local, TAMANHO_DO_CABECALHO_LOCAL), entrada);
  } finally {
    await arquivo.close();
  }
  let tamanho = 0;
  let crc = 0;
  if (entrada.comprimido > 0) {
    const bruto = createReadStream(caminho, { start: dados, end: dados + entrada.comprimido - 1 });
    const fluxo = entrada.metodo === 8 ? bruto.pipe(createInflateRaw()) : bruto;
    // Erro de leitura do arquivo tem de chegar a quem consome o fluxo descomprimido.
    if (fluxo !== bruto) bruto.on("error", (e) => fluxo.destroy(e));
    for await (const pedaco of fluxo) {
      tamanho += pedaco.length;
      crc = crc32(pedaco, crc);
      yield pedaco;
    }
  }
  if (tamanho !== entrada.tamanho) throw erroDeZip(`entrada "${entrada.nome}": ${tamanho} bytes, o diretório diz ${entrada.tamanho}`);
  if (crc !== entrada.crc) throw erroDeZip(`entrada "${entrada.nome}": CRC-32 não confere`);
}

// As linhas de uma entrada de texto, uma por vez (sem o "\n"; o "\r" do CRLF fica).
// `codificacao` é a do arquivo; os CSVs da CVM são latin1, em que cada byte é um caractere e um
// pedaço nunca corta um caractere no meio.
export async function* linhasDaEntrada(caminho, entrada, { codificacao = "latin1" } = {}) {
  const decodificador = new TextDecoder(codificacao);
  const linhas = juntarLinhas();
  for await (const pedaco of pedacosDaEntrada(caminho, entrada)) {
    yield* linhas.receber(decodificador.decode(pedaco, { stream: true }));
  }
  yield* linhas.receber(decodificador.decode());
  const sobra = linhas.sobra();
  if (sobra != null) yield sobra;
}
