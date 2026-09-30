// Coleta notícias, cotações e agenda, e (se houver chave da API) gera o resumo do dia com o Claude.
// Grava tudo em site/data/*.json. Roda no GitHub Actions a cada 15 minutos nos dias úteis.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import Anthropic from "@anthropic-ai/sdk";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "site", "data");
const ARCHIVE_DIR = path.join(ROOT, "arquivo");
const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");
const SUMMARY_INTERVAL_MIN = Number(process.env.SUMMARY_INTERVAL_MIN || 60);
const SUMMARY_FIRST_HOUR = 6; // horário de Brasília
const SUMMARY_LAST_HOUR = 20;
const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const UA = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36" };
const TZ = "America/Sao_Paulo";

// ---------- fontes ----------

const FEEDS = [
  { id: "infomoney", nome: "InfoMoney", regiao: "br", url: "https://www.infomoney.com.br/feed/" },
  { id: "moneytimes", nome: "Money Times", regiao: "br", url: "https://www.moneytimes.com.br/feed/" },
  { id: "valor", nome: "Valor Econômico", regiao: "br", url: "https://valor.globo.com/rss/valor", filtrar: true },
  { id: "investing", nome: "Investing.com", regiao: "br", url: "https://br.investing.com/rss/news.rss" },
  { id: "gnews-br", regiao: "br", url: "https://news.google.com/rss/search?q=ibovespa+OR+d%C3%B3lar+OR+juros+OR+copom+OR+petr%C3%B3leo+OR+infla%C3%A7%C3%A3o+OR+Haddad+OR+Galipolo+when:1d&hl=pt-BR&gl=BR&ceid=BR:pt-419" },
  { id: "gnews-mundo", regiao: "intl", url: "https://news.google.com/rss/search?q=stocks+OR+%22federal+reserve%22+OR+oil+OR+treasury+OR+tariffs+OR+OPEC+when:1d&hl=en-US&gl=US&ceid=US:en" },
  { id: "cnbc", nome: "CNBC", regiao: "intl", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { id: "marketwatch", nome: "MarketWatch", regiao: "intl", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
  { id: "yahoo", nome: "Yahoo Finance", regiao: "intl", url: "https://finance.yahoo.com/news/rssindex" },
];

// Para feeds genéricos (ex.: Valor traz política, cultura...), só mantém o que toca mercado.
const PALAVRAS_MERCADO = /bolsa|ibovespa|d[óo]lar|juro|selic|copom|infla[çc][ãa]o|ipca|pib|fiscal|petr[óo]leo|petrobras|vale|minério|commodit|banco central|\bbc\b|fed|tesouro|t[íi]tulo|a[çc][õo]es|mercado|investidor|economia|tarifa|china|eua|opep|haddad|galipolo|lula|trump|balan[çc]o|lucro|receita|d[íi]vida|c[âa]mbio|ouro|bitcoin|cripto|agro|safra|soja|milho|caf[ée]|emprego|desemprego/i;

// Cotações via CNBC (servidor) — usadas no resumo da IA e nos painéis que os widgets não cobrem.
const QUOTES = [
  // Contratos cheios da CME (1º vencimento); o mês do contrato é acrescentado ao nome.
  { grupo: "EUA", s: "@SP.1", nome: "ES · S&P 500 futuro", contrato: true },
  { grupo: "EUA", s: "@ND.1", nome: "NQ · Nasdaq 100 futuro", contrato: true },
  { grupo: "EUA", s: "@DJ.1", nome: "YM · Dow Jones futuro", contrato: true },
  { grupo: "EUA", s: "@TFS.1", nome: "RTY · Russell 2000 futuro", contrato: true },
  { grupo: "EUA", s: ".SPX", nome: "S&P 500" },
  { grupo: "EUA", s: ".IXIC", nome: "Nasdaq Composto" },
  { grupo: "EUA", s: ".DJI", nome: "Dow Jones" },
  { grupo: "EUA", s: ".VIX", nome: "VIX" },
  { grupo: "Europa", s: ".STOXX50E", nome: "Euro Stoxx 50" },
  { grupo: "Europa", s: ".GDAXI", nome: "DAX (Alemanha)" },
  { grupo: "Europa", s: ".FTSE", nome: "FTSE 100 (Reino Unido)" },
  { grupo: "Europa", s: ".FCHI", nome: "CAC 40 (França)" },
  { grupo: "Ásia/Pacífico", s: ".N225", nome: "Nikkei 225 (Japão)" },
  { grupo: "Ásia/Pacífico", s: ".HSI", nome: "Hang Seng (Hong Kong)" },
  { grupo: "Ásia/Pacífico", s: ".SSEC", nome: "Xangai (China)" },
  { grupo: "Ásia/Pacífico", s: ".KS11", nome: "Kospi (Coreia)" },
  { grupo: "Ásia/Pacífico", s: ".AXJO", nome: "ASX 200 (Austrália)" },
  { grupo: "Brasil", s: ".BVSP", nome: "Ibovespa" },
  { grupo: "Brasil", s: "BRL=", nome: "Dólar/Real" },
  { grupo: "Emergentes", s: ".MXX", nome: "IPC (México)" },
  { grupo: "Moedas", s: ".DXY", nome: "DXY" },
  { grupo: "Moedas", s: "EUR=", nome: "Euro/Dólar" },
  { grupo: "Commodities", s: "@LCO.1", nome: "Petróleo Brent" },
  { grupo: "Commodities", s: "@CL.1", nome: "Petróleo WTI" },
  { grupo: "Commodities", s: "@NG.1", nome: "Gás natural" },
  { grupo: "Commodities", s: "@GC.1", nome: "Ouro" },
  { grupo: "Commodities", s: "@SI.1", nome: "Prata" },
  { grupo: "Commodities", s: "@HG.1", nome: "Cobre" },
  { grupo: "Commodities", s: "@TIO.1", nome: "Minério de ferro (62% China)" },
  { grupo: "Commodities", s: "@S.1", nome: "Soja" },
  { grupo: "Commodities", s: "@C.1", nome: "Milho" },
  { grupo: "Commodities", s: "@KC.1", nome: "Café" },
  { grupo: "Commodities", s: "BTC.CM=", nome: "Bitcoin" },
  { grupo: "Juros", s: "US2Y", nome: "EUA 2 anos" },
  { grupo: "Juros", s: "US10Y", nome: "EUA 10 anos" },
  { grupo: "Juros", s: "US30Y", nome: "EUA 30 anos" },
  { grupo: "Juros", s: "BR10Y-BR", nome: "Brasil 10 anos" },
  { grupo: "Juros", s: "DE10Y-DE", nome: "Alemanha 10 anos" },
  { grupo: "Juros", s: "GB10Y-GB", nome: "Reino Unido 10 anos" },
  { grupo: "Juros", s: "FR10Y-FR", nome: "França 10 anos" },
  { grupo: "Juros", s: "IT10Y-IT", nome: "Itália 10 anos" },
  { grupo: "Juros", s: "JP10Y-JP", nome: "Japão 10 anos" },
  { grupo: "Juros", s: "CN10Y-CN", nome: "China 10 anos" },
  { grupo: "Juros", s: "MX10Y-MX", nome: "México 10 anos" },
];

const FF_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const PAIS_FF = { USD: "EUA", EUR: "Zona do Euro", GBP: "Reino Unido", JPY: "Japão", CNY: "China", CAD: "Canadá", AUD: "Austrália", NZD: "Nova Zelândia", CHF: "Suíça" };

// ---------- utilidades ----------

const agora = new Date();
const partesBR = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
const hojeBR = (() => { const p = partesBR(agora); return `${p.year}-${p.month}-${p.day}`; })();
const horaBR = Number(partesBR(agora).hour);
const diaBR = (d) => { const p = partesBR(d); return `${p.year}-${p.month}-${p.day}`; };
const horaMinBR = (d) => { const p = partesBR(d); return `${p.hour}:${p.minute}`; };

async function get(url, { json = false, timeout = 20000 } = {}) {
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`${r.status} em ${url}`);
  return json ? r.json() : r.text();
}

async function lerAnterior(nome) {
  // Primeiro tenta o arquivo local (execução local); depois a versão publicada (Actions).
  try { return JSON.parse(await fs.readFile(path.join(DATA_DIR, nome), "utf8")); } catch {}
  if (!SITE_URL) return null;
  try { return await get(`${SITE_URL}/data/${nome}?t=${Date.now()}`, { json: true }); } catch { return null; }
}

async function salvar(nome, dados) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, nome), JSON.stringify(dados, null, 1));
}

const ENTIDADES = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
const decodificar = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m);
const limpar = (s = "") => decodificar(decodificar(String(s).replace(/<[^>]+>/g, " "))).replace(/\s+/g, " ").trim();
const chave = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").split(" ").filter((w) => w.length > 3).slice(0, 8).join(" ");

// ---------- notícias ----------

async function coletarNoticias() {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const resultados = await Promise.allSettled(FEEDS.map(async (f) => {
    const xml = parser.parse(await get(f.url));
    let itens = xml?.rss?.channel?.item || [];
    if (!Array.isArray(itens)) itens = [itens];
    return itens.map((it) => {
      let titulo = limpar(typeof it.title === "object" ? it.title["#text"] : it.title);
      let fonte = f.nome;
      if (f.id.startsWith("gnews")) {
        fonte = limpar(typeof it.source === "object" ? it.source["#text"] : it.source) || "Google News";
        titulo = titulo.replace(new RegExp(`\\s+-\\s+${fonte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
        fonte = fonte.split(" - ")[0];
      }
      const data = new Date(it.pubDate || it["dc:date"] || Date.now());
      return { titulo, link: typeof it.link === "object" ? it.link.href : it.link, fonte, regiao: f.regiao, publicado: isNaN(data) ? agora.toISOString() : data.toISOString(), _filtrar: f.filtrar };
    });
  }));
  const novos = [];
  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") novos.push(...r.value);
    else console.warn(`feed ${FEEDS[i].id} falhou: ${r.reason?.message}`);
  });

  const anterior = (await lerAnterior("noticias.json"))?.itens || [];
  const limite = Date.now() - 36 * 3600e3;
  const vistos = new Set();
  const itens = [];
  for (const n of [...novos, ...anterior].sort((a, b) => b.publicado.localeCompare(a.publicado))) {
    if (!n.titulo || !n.link || new Date(n.publicado) < limite || new Date(n.publicado) > Date.now() + 3600e3) continue;
    if (n._filtrar && !PALAVRAS_MERCADO.test(n.titulo)) continue;
    const k = chave(n.titulo);
    if (vistos.has(k)) continue;
    vistos.add(k);
    const { _filtrar, ...limpo } = n;
    itens.push(limpo);
  }
  return { atualizado: agora.toISOString(), itens: itens.slice(0, 150) };
}

// ---------- cotações ----------

async function coletarCotacoes() {
  const url = `https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${encodeURIComponent(QUOTES.map((q) => q.s).join("|"))}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`;
  const j = await get(url, { json: true });
  const porSimbolo = Object.fromEntries((j?.FormattedQuoteResult?.FormattedQuote || []).map((q) => [q.symbol, q]));
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[,%+]/g, "")); return Number.isFinite(n) ? n : 0; };
  const MESES = { Jan: "jan", Feb: "fev", Mar: "mar", Apr: "abr", May: "mai", Jun: "jun", Jul: "jul", Aug: "ago", Sep: "set", Oct: "out", Nov: "nov", Dec: "dez" };
  const ativos = QUOTES.map(({ grupo, s, nome, contrato }) => {
    const q = porSimbolo[s];
    if (!q || q.last == null) return null;
    // "S&P 500 Fut (Dec'26)" -> "(dez/26)"
    const venc = contrato && /\((\w{3})'(\d{2})\)/.exec(q.name || "");
    if (venc) nome = `${nome} (${MESES[venc[1]] || venc[1]}/${venc[2]})`;
    const juros = grupo === "Juros";
    const ultimo = num(q.last);
    const variacao = q.change === "UNCH" ? 0 : num(q.change);
    const anterior = ultimo - variacao;
    return {
      grupo, simbolo: s, nome, ultimo, variacao,
      // Para juros, a variação relevante é em pontos-base; para o resto, em %.
      variacao_pct: juros ? null : anterior ? +((variacao / anterior) * 100).toFixed(2) : 0,
      variacao_bps: juros ? +(variacao * 100).toFixed(1) : null,
      horario: q.last_time,
    };
  }).filter(Boolean);
  return { atualizado: agora.toISOString(), fonte: "CNBC (atraso de até 15 min)", ativos };
}

// ---------- agenda ----------

async function coletarAgenda() {
  const eventos = await get(FF_URL, { json: true });
  const imp = { High: "alta", Medium: "media", Low: "baixa", Holiday: "feriado" };
  const lista = eventos.map((e) => {
    const d = new Date(e.date);
    return {
      data: diaBR(d), hora: horaMinBR(d), moeda: e.country, pais: PAIS_FF[e.country] || e.country,
      evento: e.title, importancia: imp[e.impact] || "baixa",
      previsao: e.forecast || "", anterior: e.previous || "", atual: e.actual || "",
    };
  }).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  return {
    atualizado: agora.toISOString(),
    fonte: "Forex Factory (horário de Brasília)",
    hoje: lista.filter((e) => e.data === hojeBR && e.importancia !== "baixa"),
    semana: lista.filter((e) => e.importancia === "alta"),
  };
}

// ---------- resumo com Claude ----------

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["manchete", "resumo", "regioes", "commodities_juros", "pontos_chave", "agenda_destaques", "noticias_relevantes"],
  properties: {
    manchete: { type: "string", description: "Uma frase que resume o tom do mercado agora." },
    resumo: { type: "string", description: "2 a 4 parágrafos separados por linha em branco." },
    regioes: {
      type: "object", additionalProperties: false,
      required: ["asia", "europa", "eua", "brasil", "emergentes"],
      properties: {
        asia: { type: "string" }, europa: { type: "string" }, eua: { type: "string" },
        brasil: { type: "string" }, emergentes: { type: "string" },
      },
    },
    commodities_juros: { type: "string", description: "Petróleo, metais, agrícolas e juros dos principais países." },
    pontos_chave: { type: "array", items: { type: "string" } },
    agenda_destaques: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["hora", "pais", "evento", "por_que_importa"],
        properties: { hora: { type: "string" }, pais: { type: "string" }, evento: { type: "string", description: "Nome do evento em português." }, por_que_importa: { type: "string" } },
      },
    },
    noticias_relevantes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "titulo_pt", "impacto", "comentario"],
        properties: {
          id: { type: "integer", description: "Número da notícia na lista fornecida." },
          titulo_pt: { type: "string", description: "Título em português." },
          impacto: { type: "string", enum: ["alto", "medio"] },
          comentario: { type: "string", description: "Por que mexe com o mercado e quais ativos." },
        },
      },
    },
  },
};

const SISTEMA = `Você é o analista-chefe de um panorama econômico matinal para investidores brasileiros.
Escreva em português do Brasil, com tom profissional, direto e factual, como um boletim de mesa de operações.
Use apenas os dados e as notícias fornecidos; não invente números, declarações nem eventos. Se um mercado ainda não abriu ou já fechou, diga isso.
Priorize o que move preços: bancos centrais e juros, inflação e atividade, petróleo e commodities, câmbio, política fiscal, geopolítica e declarações de chefes de Estado, resultados de grandes empresas.
Em "noticias_relevantes", escolha de 5 a 10 notícias com maior potencial de mexer no mercado hoje e cite-as pelo número da lista.
Em "agenda_destaques", escolha os eventos de hoje mais importantes (no máximo 6) e traduza os nomes.`;

function precisaResumo(anterior) {
  if (!process.env.ANTHROPIC_API_KEY) return false;
  if (process.env.FORCAR_RESUMO === "1") return true;
  if (horaBR < SUMMARY_FIRST_HOUR || horaBR > SUMMARY_LAST_HOUR) return false;
  if (!anterior?.gerado_em) return true;
  if (diaBR(new Date(anterior.gerado_em)) !== hojeBR) return true;
  return Date.now() - new Date(anterior.gerado_em).getTime() >= SUMMARY_INTERVAL_MIN * 60e3;
}

async function gerarResumo({ noticias, cotacoes, agenda }) {
  const itens = noticias.itens.slice(0, 90);
  const fmtAtivo = (a) => `${a.nome}: ${a.ultimo} (${a.variacao_bps != null ? `${a.variacao_bps >= 0 ? "+" : ""}${a.variacao_bps} bps` : `${a.variacao_pct >= 0 ? "+" : ""}${a.variacao_pct}%`})`;
  const grupos = [...new Set(cotacoes.ativos.map((a) => a.grupo))];
  const blocoCotacoes = grupos.map((g) => `## ${g}\n` + cotacoes.ativos.filter((a) => a.grupo === g).map(fmtAtivo).join("\n")).join("\n\n");
  const blocoAgenda = agenda.hoje.map((e) => `${e.hora} | ${e.pais} | ${e.evento} | importância ${e.importancia} | previsão ${e.previsao || "-"} | anterior ${e.anterior || "-"} | atual ${e.atual || "-"}`).join("\n") || "(sem eventos relevantes no calendário internacional hoje)";
  const blocoNoticias = itens.map((n, i) => `[${i}] (${horaMinBR(new Date(n.publicado))}, ${n.fonte}) ${n.titulo}`).join("\n");

  const pedido = `Agora são ${horaMinBR(agora)} de ${hojeBR} (horário de Brasília).

# Cotações (variação no dia; juros em pontos-base)
${blocoCotacoes}

# Agenda econômica de hoje (horário de Brasília; não inclui eventos do Brasil)
${blocoAgenda}

# Notícias recentes
${blocoNoticias}

Monte o panorama econômico de agora.`;

  const client = new Anthropic();
  const resp = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: SISTEMA,
    messages: [{ role: "user", content: pedido }],
  });
  if (resp.stop_reason === "refusal") throw new Error(`resumo recusado: ${resp.stop_details?.category}`);
  if (resp.stop_reason === "max_tokens") throw new Error("resumo cortado por max_tokens");
  const texto = resp.content.find((b) => b.type === "text")?.text;
  const dados = JSON.parse(texto);
  dados.noticias_relevantes = dados.noticias_relevantes
    .filter((n) => itens[n.id])
    .map(({ id, ...n }) => ({ ...n, link: itens[id].link, fonte: itens[id].fonte, publicado: itens[id].publicado }));
  console.log(`resumo gerado (${resp.model}): ${resp.usage.input_tokens} in / ${resp.usage.output_tokens} out`);
  return { ...dados, gerado_em: agora.toISOString(), modelo: resp.model };
}

// ---------- principal ----------

async function tentar(nome, fn, arquivo) {
  try {
    const dados = await fn();
    await salvar(arquivo, dados);
    console.log(`ok: ${nome}`);
    return dados;
  } catch (e) {
    console.error(`falhou: ${nome}: ${e.message}`);
    const anterior = await lerAnterior(arquivo);
    if (anterior) await salvar(arquivo, anterior);
    return anterior;
  }
}

const [noticias, cotacoes, agenda] = await Promise.all([
  tentar("notícias", coletarNoticias, "noticias.json"),
  tentar("cotações", coletarCotacoes, "cotacoes.json"),
  tentar("agenda", coletarAgenda, "agenda.json"),
]);

const resumoAnterior = await lerAnterior("resumo.json");
let resumo = resumoAnterior;
if (precisaResumo(resumoAnterior) && noticias && cotacoes && agenda) {
  try {
    resumo = await gerarResumo({ noticias, cotacoes, agenda });
  } catch (e) {
    console.error(`falhou: resumo: ${e.message}`);
  }
} else {
  console.log(process.env.ANTHROPIC_API_KEY ? "resumo: ainda recente, mantido" : "resumo: sem ANTHROPIC_API_KEY, pulado");
}
await salvar("resumo.json", resumo || { gerado_em: null, sem_chave: !process.env.ANTHROPIC_API_KEY });

// Arquivo diário (a partir das 19h): guarda o último resumo do dia no repositório.
if (resumo?.gerado_em && horaBR >= 19 && diaBR(new Date(resumo.gerado_em)) === hojeBR) {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.writeFile(path.join(ARCHIVE_DIR, `${hojeBR}.json`), JSON.stringify(resumo, null, 1));
  console.log(`arquivo: ${hojeBR}.json`);
}
