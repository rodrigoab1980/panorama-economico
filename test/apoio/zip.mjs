// Monta ZIPs byte a byte para os testes do leitor (zip.test.mjs e zip-fluxo.test.mjs), sem depender
// de nenhum programa de fora.
import { crc32, deflateRawSync } from "node:zlib";

// Monta um ZIP. arquivos: [{ nome, conteudo, metodo (0 ou 8), marcas, crc, extra }].
export function montarZip(arquivos, { comentario = "", total, inicioDoDiretorio, disco = 0, zip64 = false } = {}) {
  const partes = [];
  const diretorio = [];
  let posicao = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "utf8");
    const conteudo = Buffer.from(a.conteudo ?? "");
    const metodo = a.metodo ?? 8;
    const dados = metodo === 8 ? deflateRawSync(conteudo) : conteudo;
    const crc = a.crc ?? crc32(conteudo);
    const marcas = a.marcas ?? 0x0800;
    const extra = Buffer.from(a.extra ?? "");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(marcas, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(marcas, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(a.comprimidoNoDiretorio ?? dados.length, 20);
    central.writeUInt32LE(conteudo.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(posicao, 42);
    diretorio.push(central, nome);
    partes.push(local, nome, extra, dados);
    posicao += 30 + nome.length + extra.length + dados.length;
  }
  const dir = Buffer.concat(diretorio);
  const locador = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
  if (zip64) locador.writeUInt32LE(0x07064b50, 0);
  const coment = Buffer.from(comentario, "latin1");
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(disco, 4);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(total ?? arquivos.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(inicioDoDiretorio ?? posicao, 16);
  fim.writeUInt16LE(coment.length, 20);
  return Buffer.concat([...partes, dir, locador, fim, coment]);
}
