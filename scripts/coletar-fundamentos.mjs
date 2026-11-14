// Coleta semanal dos fundamentos (#37). Casca: rede e disco. As regras estão em scripts/cvm/coleta.mjs.
//
// Uso:
//   node scripts/coletar-fundamentos.mjs                 as três etapas em sequência (execução local)
//   node scripts/coletar-fundamentos.mjs listar          HEAD em cada ZIP da CVM → <trabalho>/lista.json
//   node scripts/coletar-fundamentos.mjs extrair <nome>  baixa um ZIP e grava o extrato dele (ou usa o cache)
//   node scripts/coletar-fundamentos.mjs montar          extratos → <dados>/fundamentos/*.json e o índice
//
// Pastas (variáveis de ambiente; todas fora do git):
//   DADOS_DIR     a branch `dados` (padrão: dados/). Só `montar` escreve nela, em fundamentos/.
//   CVM_CACHE     extratos que deram certo, um por ZIP (padrão: .cvm/cache/). É o que o workflow guarda em cache.
//   CVM_TRABALHO  lista.json, resultados/ e os ZIPs temporários (padrão: .cvm/trabalho/).
//
// Nenhuma etapa termina com erro por culpa da CVM: a falha de um ZIP fica registrada no resultado
// dele, e `montar` mantém o que já estava gravado. Só erro de programação derruba o processo.
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entradasDoArquivoZip, linhasDaEntrada } from "./zip-fluxo.mjs";
import {
  FORMATO, PASTA_FUNDAMENTOS, arquivosDaColeta, criarExtrator, decidirSaida, serializar, tipoDaEntrada,
} from "./cvm/coleta.mjs";
import { diaBR } from "./logica.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DADOS_DIR = path.resolve(process.env.DADOS_DIR || path.join(RAIZ, "dados"));
const CACHE = path.resolve(process.env.CVM_CACHE || path.join(RAIZ, ".cvm", "cache"));
const TRABALHO = path.resolve(process.env.CVM_TRABALHO || path.join(RAIZ, ".cvm", "trabalho"));
const LISTA = path.join(TRABALHO, "lista.json");
const RESULTADOS = path.join(TRABALHO, "resultados");
const UNIVERSO = path.join(RAIZ, "scripts", "cvm", "universo.json");

// Timeout. A regra do projeto é 20 s por requisição. Para o HEAD vale assim. Para o download de um
// ZIP, vira 20 s SEM RECEBER BYTES, com um teto de 3 min por arquivo: um ZIP de 30 MB pode levar mais
// de 20 s inteiros sem estar travado.
const TIMEOUT_MS = 20_000;
const TETO_DO_DOWNLOAD_MS = 180_000;
const UA = { "user-agent": "panorama-economico (coleta semanal de dados abertos)" };

const agora = new Date();
const mb = (bytes) => (bytes / 1e6).toFixed(1);
const lerJson = async (caminho) => { try { return JSON.parse(await fs.readFile(caminho, "utf8")); } catch { return null; } };
const gravarJson = async (caminho, dados) => { await fs.mkdir(path.dirname(caminho), { recursive: true }); await fs.writeFile(caminho, JSON.stringify(dados)); };

async function companhiasDaPagina() {
  const { mapeadas } = JSON.parse(await fs.readFile(UNIVERSO, "utf8"));
  return mapeadas.filter((c) => !c.foraDaPagina);
}

// ---------- listar ----------

async function cabecalhos(arquivo) {
  try {
    const r = await fetch(arquivo.url, { method: "HEAD", headers: UA, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) return { ...arquivo, lastModified: null, tamanho: null, status: "falhou", motivo: `HEAD ${r.status}` };
    const tamanho = Number(r.headers.get("content-length"));
    return { ...arquivo, lastModified: r.headers.get("last-modified"), tamanho: Number.isFinite(tamanho) && tamanho > 0 ? tamanho : null, status: "ok", motivo: null };
  } catch (e) {
    return { ...arquivo, lastModified: null, tamanho: null, status: "falhou", motivo: `HEAD: ${e.name === "TimeoutError" ? "timeout de 20 s" : e.message}` };
  }
}

async function listar() {
  const lista = [];
  for (const arquivo of arquivosDaColeta(diaBR(agora))) lista.push(await cabecalhos(arquivo));
  await gravarJson(LISTA, lista);
  for (const a of lista) console.log(`${a.nome}: ${a.status === "ok" ? `${a.lastModified}, ${a.tamanho ? mb(a.tamanho) : "?"} MB` : `aviso: ${a.motivo}`}`);
  // Para a matriz do workflow: o nome e um carimbo do Last-Modified que serve de chave de cache.
  if (process.env.GITHUB_OUTPUT) {
    const matriz = lista.map((a) => ({ nome: a.nome, carimbo: a.lastModified ? String(Date.parse(a.lastModified) / 1000) : "sem-data" }));
    await fs.appendFile(process.env.GITHUB_OUTPUT, `matriz=${JSON.stringify(matriz)}\n`);
  }
  return lista;
}

// ---------- extrair ----------

// Baixa para um arquivo no disco, sem carregar na memória. Devolve { bytes, lastModified }.
async function baixar(url, destino) {
  const controle = new AbortController();
  let motivo = null;
  let ocioso = null;
  const rearmar = () => {
    clearTimeout(ocioso);
    ocioso = setTimeout(() => { motivo = "20 s sem receber bytes"; controle.abort(); }, TIMEOUT_MS);
  };
  const teto = setTimeout(() => { motivo = "passou do teto de 3 min"; controle.abort(); }, TETO_DO_DOWNLOAD_MS);
  rearmar();
  try {
    const r = await fetch(url, { headers: UA, signal: controle.signal });
    if (!r.ok) throw new Error(`GET ${r.status}`);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    const saida = createWriteStream(destino);
    let bytes = 0;
    try {
      for await (const pedaco of r.body) {
        rearmar();
        bytes += pedaco.length;
        if (!saida.write(pedaco)) await new Promise((ok) => saida.once("drain", ok));
      }
    } finally {
      await new Promise((ok) => saida.end(ok));
    }
    return { bytes, lastModified: r.headers.get("last-modified") };
  } catch (e) {
    throw new Error(motivo ?? e.message);
  } finally {
    clearTimeout(ocioso);
    clearTimeout(teto);
  }
}

// Lê um ZIP em fluxo e devolve o extrato dele, com o pico de memória medido durante a leitura.
async function extrairDoZip(caminhoDoZip, companhias) {
  const extrator = criarExtrator(companhias);
  let pico = process.memoryUsage().rss;
  let abertos = 0;
  for (const entrada of await entradasDoArquivoZip(caminhoDoZip)) {
    const tipo = tipoDaEntrada(entrada.nome);
    if (!tipo) continue;
    const receber = extrator[tipo](entrada.nome);
    let n = 0;
    for await (const linha of linhasDaEntrada(caminhoDoZip, entrada)) {
      receber(linha);
      if (++n % 100_000 === 0) pico = Math.max(pico, process.memoryUsage().rss);
    }
    receber.fechar?.();
    abertos += entrada.tamanho;
  }
  return { extrato: extrator.extrato(), picoRss: Math.max(pico, process.memoryUsage().rss), abertos };
}

async function extrair(nome, lista) {
  const arquivo = (lista ?? await lerJson(LISTA) ?? []).find((a) => a.nome === nome)
    ?? await cabecalhos(arquivosDaColeta(diaBR(agora)).find((a) => a.nome === nome) ?? (() => { throw new Error(`${nome} não é um arquivo da coleta`); })());
  const noCache = path.join(CACHE, `${nome}.json`);
  const resultado = path.join(RESULTADOS, `${nome}.json`);
  const base = { arquivo: { nome: arquivo.nome, ano: arquivo.ano, documento: arquivo.documento, lastModified: arquivo.lastModified, tamanho: arquivo.tamanho } };

  // O extrato em cache vale quando é do mesmo formato e do mesmo Last-Modified que a CVM informa agora.
  // Se o HEAD falhou, não dá para saber se mudou: o cache também vale, e o aviso fica no resultado.
  const guardado = await lerJson(noCache);
  if (guardado?.extrato?.formato === FORMATO && (arquivo.status !== "ok" || guardado.arquivo.lastModified === arquivo.lastModified)) {
    await gravarJson(resultado, { ...guardado, arquivo: { ...guardado.arquivo, ano: arquivo.ano, documento: arquivo.documento }, medidas: { doCache: true, baixados: 0, ms: 0, picoRss: 0, abertos: 0 } });
    console.log(`${nome}: do cache (${guardado.arquivo.lastModified})${arquivo.status !== "ok" ? `; aviso: ${arquivo.motivo}` : ""}`);
    return;
  }
  if (arquivo.status !== "ok") {
    await gravarJson(resultado, { ...base, status: "falhou", motivo: arquivo.motivo });
    console.warn(`aviso: ${nome}: ${arquivo.motivo}`);
    return;
  }

  const zip = path.join(TRABALHO, "zips", nome);
  const inicio = Date.now();
  // O extrato guardado é de outro Last-Modified (ou de outro formato): sai do cache antes de baixar,
  // para uma falha no download não deixar o extrato velho guardado com a chave nova.
  await fs.rm(noCache, { force: true });
  try {
    const { bytes, lastModified } = await baixar(arquivo.url, zip);
    const { extrato, picoRss, abertos } = await extrairDoZip(zip, await companhiasDaPagina());
    const pronto = {
      arquivo: { ...base.arquivo, lastModified: lastModified ?? arquivo.lastModified, tamanho: bytes },
      status: "ok", motivo: null, extrato,
      medidas: { doCache: false, baixados: bytes, ms: Date.now() - inicio, picoRss, abertos },
    };
    await gravarJson(noCache, pronto);
    await gravarJson(resultado, pronto);
    // Diz ao workflow que há um extrato novo para guardar em cache.
    if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT, "salvar=true\n");
    console.log(`${nome}: ${mb(bytes)} MB baixados, ${mb(abertos)} MB abertos, ${extrato.linhas.aproveitadas} de ${extrato.linhas.lidas} linhas, ${((Date.now() - inicio) / 1000).toFixed(1)} s, pico de memória ${mb(picoRss)} MB`);
  } catch (e) {
    await gravarJson(resultado, { ...base, status: "falhou", motivo: e.message });
    console.warn(`aviso: ${nome} falhou: ${e.message}`);
  } finally {
    await fs.rm(zip, { force: true });
  }
}

// ---------- montar ----------

async function montar() {
  const companhias = await companhiasDaPagina();
  const esperados = arquivosDaColeta(diaBR(agora));
  const resultados = [];
  for (const a of esperados) {
    const r = await lerJson(path.join(RESULTADOS, `${a.nome}.json`));
    resultados.push(r ?? { arquivo: { nome: a.nome, ano: a.ano, lastModified: null, tamanho: null }, status: "falhou", motivo: "a etapa de extração não deixou resultado" });
  }
  const arquivos = resultados.map((r) => ({ nome: r.arquivo.nome, ano: r.arquivo.ano, lastModified: r.arquivo.lastModified, tamanho: r.arquivo.tamanho, status: r.status, motivo: r.motivo }));
  const extratos = resultados.filter((r) => r.status === "ok").map((r) => ({ arquivo: r.arquivo, extrato: r.extrato }));

  const pasta = path.join(DADOS_DIR, PASTA_FUNDAMENTOS);
  const anteriores = {};
  for (const nome of await fs.readdir(pasta).catch(() => [])) {
    if (nome.endsWith(".json")) anteriores[`${PASTA_FUNDAMENTOS}/${nome}`] = await fs.readFile(path.join(pasta, nome), "utf8");
  }

  const { gravar, indice, resumo } = decidirSaida({ companhias, arquivos, extratos, anteriores, agora, anoCorrente: Number(diaBR(agora).slice(0, 4)) });
  for (const [caminho, texto] of Object.entries(gravar)) {
    const destino = path.join(DADOS_DIR, caminho);
    await fs.mkdir(path.dirname(destino), { recursive: true });
    await fs.writeFile(destino, texto);
  }

  const medidas = resultados.map((r) => r.medidas).filter(Boolean);
  const soma = (campo) => medidas.reduce((s, m) => s + (m[campo] ?? 0), 0);
  const picoDaMontagem = process.memoryUsage().rss;
  const linhas = [
    `ZIPs: ${arquivos.length - resumo.arquivosComFalha} de ${arquivos.length} ok; ${medidas.filter((m) => m.doCache).length} vieram do cache; ${mb(soma("baixados"))} MB baixados; ${mb(soma("abertos"))} MB abertos`,
    `tempo de download e leitura: ${(soma("ms") / 1000).toFixed(0)} s; pico de memória: ${mb(Math.max(picoDaMontagem, ...medidas.map((m) => m.picoRss ?? 0)))} MB (na montagem: ${mb(picoDaMontagem)} MB)`,
    `companhias: ${resumo.ok} ok, ${resumo.mantidas} mantidas com o arquivo anterior, ${resumo.falharam} sem arquivo`,
    `arquivos gravados: ${resumo.gravados}${resumo.gravados === 0 ? " (nada mudou; não há o que commitar)" : ""}`,
  ];
  for (const l of linhas) console.log(l);
  const avisos = [];
  for (const a of arquivos.filter((x) => x.status !== "ok")) avisos.push(`${a.nome}: ${a.motivo}`);
  for (const [cd, c] of Object.entries(indice.companhias)) {
    if (c.status !== "ok") avisos.push(`${c.tickers.join("/")} (${cd}): ${c.status}: ${c.motivo}`);
    for (const aviso of c.avisos ?? []) avisos.push(`${c.tickers.join("/")} (${cd}): ${aviso}`);
  }
  for (const a of avisos) console.warn(`aviso: ${a}`);
  if (resumo.tudoFalhou) console.warn("aviso: todos os arquivos da CVM falharam; nada foi gravado e o que estava publicado continua valendo");
  if (process.env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `### Coleta dos fundamentos\n\n${linhas.map((l) => `- ${l}`).join("\n")}\n${avisos.length ? `\n**Avisos**\n\n${avisos.map((a) => `- ${a}`).join("\n")}\n` : ""}`);
  }
}

// ---------- principal ----------

const [etapa, argumento] = process.argv.slice(2);
if (etapa === "listar") await listar();
else if (etapa === "extrair") await extrair(argumento);
else if (etapa === "montar") await montar();
else if (etapa == null) {
  const lista = await listar();
  for (const a of lista) await extrair(a.nome, lista);
  await montar();
} else {
  console.error(`etapa desconhecida: ${etapa} (use listar, extrair <nome> ou montar)`);
  process.exit(2);
}
