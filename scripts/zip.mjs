// Leitor de ZIP mínimo. Lógica pura: recebe bytes e devolve as entradas; sem disco e sem rede.
// Só usa `node:zlib`. Serve para os ZIPs da CVM (#37) e funciona igual no Windows e no runner, sem
// depender de `unzip`. A leitura em fluxo, direto do disco, fica em zip-fluxo.mjs e usa as funções
// daqui para achar e interpretar o diretório central.
//
// Lê o diretório central (no fim do arquivo) e, para cada entrada, o cabeçalho local e os dados.
// Aceita os métodos 0 (guardado, cópia direta) e 8 (deflate). Não aceita ZIP64, criptografia nem
// arquivo dividido em vários discos: nesses casos lança um erro que diz o que encontrou.
//
// Formato: APPNOTE.TXT da PKWARE, https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
import { crc32, inflateRawSync } from "node:zlib";

const FIM_DO_DIRETORIO = 0x06054b50; // "PK\5\6", registro de fim do diretório central
const ENTRADA_DO_DIRETORIO = 0x02014b50; // "PK\1\2"
const CABECALHO_LOCAL = 0x04034b50; // "PK\3\4"
const LOCALIZADOR_ZIP64 = 0x07064b50; // "PK\6\7"
const TAMANHO_DO_FIM = 22; // sem o comentário
const COMENTARIO_MAXIMO = 0xffff;
export const TAMANHO_DO_CABECALHO_LOCAL = 30;
// Quanto do fim do arquivo é preciso ler para achar o registro de fim do diretório central (e o
// localizador de ZIP64 que viria antes dele).
export const TAMANHO_DA_CAUDA = TAMANHO_DO_FIM + COMENTARIO_MAXIMO + 20;

export const erroDeZip = (texto) => new Error(`ZIP: ${texto}`);
const erro = erroDeZip;

// Acha o registro de fim do diretório central na cauda do arquivo e diz onde o diretório está.
//   cauda    os últimos bytes do arquivo (o arquivo inteiro também serve)
//   tamanho  tamanho do arquivo inteiro, em bytes (padrão: o da cauda)
// Devolve { total, tamanhoDoDiretorio, inicioDoDiretorio }, com as posições contadas do início do arquivo.
// A assinatura é procurada de trás para a frente, porque depois dela pode vir um comentário.
export function acharDiretorio(cauda, tamanho = cauda.length) {
  const b = cauda;
  if (tamanho < TAMANHO_DO_FIM || b.length < Math.min(tamanho, TAMANHO_DO_FIM)) throw erro(`arquivo curto demais (${tamanho} bytes)`);
  let fim = -1;
  for (let i = b.length - TAMANHO_DO_FIM; i >= 0; i--) {
    if (b.readUInt32LE(i) === FIM_DO_DIRETORIO && i + TAMANHO_DO_FIM + b.readUInt16LE(i + 20) === b.length) { fim = i; break; }
  }
  if (fim < 0) throw erro("não achei o fim do diretório central; o arquivo não é um ZIP ou está cortado");
  if (fim >= 20 && b.readUInt32LE(fim - 20) === LOCALIZADOR_ZIP64) throw erro("ZIP64 não é suportado");

  const disco = b.readUInt16LE(fim + 4);
  const discoDoDiretorio = b.readUInt16LE(fim + 6);
  const total = b.readUInt16LE(fim + 10);
  const tamanhoDoDiretorio = b.readUInt32LE(fim + 12);
  const inicioDoDiretorio = b.readUInt32LE(fim + 16);
  if (total === 0xffff || tamanhoDoDiretorio === 0xffffffff || inicioDoDiretorio === 0xffffffff) throw erro("ZIP64 não é suportado");
  if (disco !== 0 || discoDoDiretorio !== 0) throw erro("arquivo dividido em vários discos não é suportado");
  const posicaoDoFim = tamanho - (b.length - fim);
  if (inicioDoDiretorio + tamanhoDoDiretorio > posicaoDoFim) throw erro("diretório central fora do arquivo");
  return { total, tamanhoDoDiretorio, inicioDoDiretorio };
}

// Interpreta os bytes do diretório central. Devolve os dados de cada entrada, na ordem do diretório:
//   [{ nome, tamanho, comprimido, metodo, marcas, crc, local }]   (`local` = posição do cabeçalho local)
// Pastas (nome terminado em "/") ficam de fora.
export function lerDiretorio(diretorio, total) {
  const b = diretorio;
  const entradas = [];
  let p = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== ENTRADA_DO_DIRETORIO) throw erro(`entrada ${n + 1} do diretório central inválida`);
    const marcas = b.readUInt16LE(p + 8);
    const metodo = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const comprimido = b.readUInt32LE(p + 20);
    const tamanho = b.readUInt32LE(p + 24);
    const tamanhoDoNome = b.readUInt16LE(p + 28);
    const tamanhoDoExtra = b.readUInt16LE(p + 30);
    const tamanhoDoComentario = b.readUInt16LE(p + 32);
    const local = b.readUInt32LE(p + 42);
    const nome = b.toString(marcas & 0x0800 ? "utf8" : "latin1", p + 46, p + 46 + tamanhoDoNome);
    p += 46 + tamanhoDoNome + tamanhoDoExtra + tamanhoDoComentario;
    if (comprimido === 0xffffffff || tamanho === 0xffffffff || local === 0xffffffff) throw erro(`ZIP64 não é suportado (entrada "${nome}")`);
    if (nome.endsWith("/")) continue;
    entradas.push({ nome, tamanho, comprimido, metodo, marcas, crc, local });
  }
  return entradas;
}

// A entrada pode ser lida? Lança o erro que diz por que não.
export function conferirEntrada({ nome, marcas, metodo }) {
  if (marcas & 0x0001) throw erro(`entrada "${nome}" criptografada; criptografia não é suportada`);
  if (metodo !== 0 && metodo !== 8) throw erro(`entrada "${nome}" usa o método de compressão ${metodo}; só 0 (guardado) e 8 (deflate) são suportados`);
}

// Onde começam os dados de uma entrada, a partir dos 30 bytes do cabeçalho local dela.
export function inicioDosDados(cabecalhoLocal, entrada) {
  if (cabecalhoLocal.length < TAMANHO_DO_CABECALHO_LOCAL || cabecalhoLocal.readUInt32LE(0) !== CABECALHO_LOCAL) throw erro(`cabeçalho local da entrada "${entrada.nome}" inválido`);
  return entrada.local + TAMANHO_DO_CABECALHO_LOCAL + cabecalhoLocal.readUInt16LE(26) + cabecalhoLocal.readUInt16LE(28);
}

// Entradas de um ZIP que está inteiro na memória. `bytes` é um Buffer ou Uint8Array.
// Devolve [{ nome, tamanho, comprimido, metodo, ler() }], na ordem do diretório central.
//   nome        nome do arquivo dentro do ZIP (UTF-8 quando o ZIP marca assim; senão, latin1)
//   tamanho     bytes depois de descomprimir
//   comprimido  bytes dentro do ZIP
//   metodo      0 (guardado) ou 8 (deflate)
//   ler()       devolve o Buffer com o conteúdo, já conferido pelo tamanho e pelo CRC-32
// Serve para arquivos pequenos. Para os grandes, use zip-fluxo.mjs, que não carrega a entrada inteira.
export function entradasDoZip(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  const cauda = b.subarray(Math.max(0, b.length - TAMANHO_DA_CAUDA));
  const { total, tamanhoDoDiretorio, inicioDoDiretorio } = acharDiretorio(cauda, b.length);
  return lerDiretorio(b.subarray(inicioDoDiretorio, inicioDoDiretorio + tamanhoDoDiretorio), total).map((entrada) => {
    const { nome, tamanho, comprimido, metodo, crc, local } = entrada;
    const ler = () => {
      conferirEntrada(entrada);
      if (local + TAMANHO_DO_CABECALHO_LOCAL > b.length) throw erro(`cabeçalho local da entrada "${nome}" inválido`);
      const dados = inicioDosDados(b.subarray(local, local + TAMANHO_DO_CABECALHO_LOCAL), entrada);
      if (dados + comprimido > b.length) throw erro(`dados da entrada "${nome}" fora do arquivo`);
      const bruto = b.subarray(dados, dados + comprimido);
      const conteudo = metodo === 8 ? inflateRawSync(bruto) : Buffer.from(bruto);
      if (conteudo.length !== tamanho) throw erro(`entrada "${nome}": ${conteudo.length} bytes, o diretório diz ${tamanho}`);
      if (crc32(conteudo) !== crc) throw erro(`entrada "${nome}": CRC-32 não confere`);
      return conteudo;
    };
    return { nome, tamanho, comprimido, metodo, ler };
  });
}

// Conteúdo de uma entrada pelo nome (ou por um teste do nome). Lança erro quando não acha.
export function lerDoZip(bytes, nome) {
  const serve = typeof nome === "function" ? nome : (n) => n === nome;
  const entrada = entradasDoZip(bytes).find((e) => serve(e.nome));
  if (!entrada) throw erro(`entrada ${typeof nome === "function" ? "procurada" : `"${nome}"`} não está no arquivo`);
  return entrada.ler();
}

// Junta pedaços de texto em linhas, para a leitura em fluxo: devolve { receber(pedaco), sobra() }.
// receber() devolve as linhas completas que o pedaço fechou (sem o "\n"; o "\r" do CRLF fica, e quem
// lê tira); sobra() devolve o que ficou depois do último "\n" (a última linha, se o arquivo não
// termina em quebra), ou null.
export function juntarLinhas() {
  let resto = "";
  return {
    receber(pedaco) {
      const partes = (resto + pedaco).split("\n");
      resto = partes.pop();
      return partes;
    },
    sobra: () => (resto === "" ? null : resto),
  };
}
