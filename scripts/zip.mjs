// Leitor de ZIP mínimo. Lógica pura: recebe os bytes do arquivo e devolve as entradas; sem disco e sem
// rede. Só usa `node:zlib`. Serve para os arquivos de cotações (#51) e para os ZIPs da CVM (#37), e
// funciona igual no Windows e no runner, sem depender de `unzip`.
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

const erro = (texto) => new Error(`ZIP: ${texto}`);

// Posição do registro de fim do diretório central: procura a assinatura de trás para a frente, porque
// depois dele pode vir um comentário de até 65.535 bytes.
function acharFim(b) {
  const inicio = Math.max(0, b.length - TAMANHO_DO_FIM - COMENTARIO_MAXIMO);
  for (let i = b.length - TAMANHO_DO_FIM; i >= inicio; i--) {
    if (b.readUInt32LE(i) === FIM_DO_DIRETORIO && i + TAMANHO_DO_FIM + b.readUInt16LE(i + 20) === b.length) return i;
  }
  return -1;
}

// Entradas de um ZIP. `bytes` é um Buffer ou Uint8Array com o arquivo inteiro.
// Devolve [{ nome, tamanho, comprimido, metodo, ler() }], na ordem do diretório central.
//   nome        nome do arquivo dentro do ZIP (UTF-8 quando o ZIP marca assim; senão, latin1)
//   tamanho     bytes depois de descomprimir
//   comprimido  bytes dentro do ZIP
//   metodo      0 (guardado) ou 8 (deflate)
//   ler()       devolve o Buffer com o conteúdo, já conferido pelo tamanho e pelo CRC-32
// Pastas (nome terminado em "/") ficam de fora.
export function entradasDoZip(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (b.length < TAMANHO_DO_FIM) throw erro(`arquivo curto demais (${b.length} bytes)`);
  const fim = acharFim(b);
  if (fim < 0) throw erro("não achei o fim do diretório central; o arquivo não é um ZIP ou está cortado");
  if (fim >= 20 && b.readUInt32LE(fim - 20) === LOCALIZADOR_ZIP64) throw erro("ZIP64 não é suportado");

  const disco = b.readUInt16LE(fim + 4);
  const discoDoDiretorio = b.readUInt16LE(fim + 6);
  const total = b.readUInt16LE(fim + 10);
  const tamanhoDoDiretorio = b.readUInt32LE(fim + 12);
  const inicioDoDiretorio = b.readUInt32LE(fim + 16);
  if (total === 0xffff || tamanhoDoDiretorio === 0xffffffff || inicioDoDiretorio === 0xffffffff) throw erro("ZIP64 não é suportado");
  if (disco !== 0 || discoDoDiretorio !== 0) throw erro("arquivo dividido em vários discos não é suportado");
  if (inicioDoDiretorio + tamanhoDoDiretorio > fim) throw erro("diretório central fora do arquivo");

  const entradas = [];
  let p = inicioDoDiretorio;
  for (let n = 0; n < total; n++) {
    if (p + 46 > fim || b.readUInt32LE(p) !== ENTRADA_DO_DIRETORIO) throw erro(`entrada ${n + 1} do diretório central inválida`);
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
    const ler = () => {
      if (marcas & 0x0001) throw erro(`entrada "${nome}" criptografada; criptografia não é suportada`);
      if (metodo !== 0 && metodo !== 8) throw erro(`entrada "${nome}" usa o método de compressão ${metodo}; só 0 (guardado) e 8 (deflate) são suportados`);
      if (local + 30 > b.length || b.readUInt32LE(local) !== CABECALHO_LOCAL) throw erro(`cabeçalho local da entrada "${nome}" inválido`);
      const dados = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
      if (dados + comprimido > b.length) throw erro(`dados da entrada "${nome}" fora do arquivo`);
      const bruto = b.subarray(dados, dados + comprimido);
      const conteudo = metodo === 8 ? inflateRawSync(bruto) : Buffer.from(bruto);
      if (conteudo.length !== tamanho) throw erro(`entrada "${nome}": ${conteudo.length} bytes, o diretório diz ${tamanho}`);
      if (crc32(conteudo) !== crc) throw erro(`entrada "${nome}": CRC-32 não confere`);
      return conteudo;
    };
    entradas.push({ nome, tamanho, comprimido, metodo, ler });
  }
  return entradas;
}

// Conteúdo de uma entrada pelo nome (ou por um teste do nome). Lança erro quando não acha.
export function lerDoZip(bytes, nome) {
  const serve = typeof nome === "function" ? nome : (n) => n === nome;
  const entrada = entradasDoZip(bytes).find((e) => serve(e.nome));
  if (!entrada) throw erro(`entrada ${typeof nome === "function" ? "procurada" : `"${nome}"`} não está no arquivo`);
  return entrada.ler();
}
