// Lógica pura do panorama: sem rede, sem disco, sem relógio implícito.
// Tudo que depende do "agora" recebe a data por parâmetro, para poder ser testado.

export const TZ = "America/Sao_Paulo";

// ---------- datas (horário de Brasília) ----------

export const partesBR = (d) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((p) => [p.type, p.value]));
export const diaBR = (d) => { const p = partesBR(d); return `${p.year}-${p.month}-${p.day}`; };
export const horaMinBR = (d) => { const p = partesBR(d); return `${p.hour}:${p.minute}`; };
export const horaBR = (d) => Number(partesBR(d).hour);

// ---------- texto ----------

const ENTIDADES = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”" };
export const decodificar = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m);
export const limpar = (s = "") => decodificar(decodificar(String(s).replace(/<[^>]+>/g, " "))).replace(/\s+/g, " ").trim();
// Chave de deduplicação: até 8 palavras com mais de 3 letras, sem acentos nem pontuação.
export const chave = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "").split(" ").filter((w) => w.length > 3).slice(0, 8).join(" ");

// Número vindo da CNBC ("1,234.5", "+0.8%"); devolve `padrao` se não for número.
export const numero = (v, padrao = null) => { const n = parseFloat(String(v ?? "").replace(/[,%+]/g, "")); return Number.isFinite(n) ? n : padrao; };
// "5.487T" -> 5487 (em bilhões)
export const bilhoes = (v) => { const m = /^([\d.]+)([TBM])$/.exec(String(v ?? "")); return m ? +m[1] * { T: 1000, B: 1, M: 0.001 }[m[2]] : null; };
export const bolsa = (ex = "") => (/sao paulo/i.test(ex) ? "BMFBOVESPA" : /nasdaq/i.test(ex) ? "NASDAQ" : /nyse/i.test(ex) ? "NYSE" : "");

// ---------- notícias ----------

// Link vindo do feed (texto ou objeto com href). Devolve o link só se for uma URL absoluta http(s);
// qualquer outra coisa (javascript:, data:, relativo, vazio, inválido) vira null.
export function linkSeguro(link) {
  const bruto = typeof link === "object" && link !== null ? link.href : link;
  if (typeof bruto !== "string" || !bruto.trim()) return null;
  try {
    const { protocol } = new URL(bruto.trim());
    return protocol === "http:" || protocol === "https:" ? bruto.trim() : null;
  } catch {
    return null;
  }
}

// Converte o RSS já parseado (fast-xml-parser) de um feed em itens de notícia.
export function itensDoFeed(xml, feed, agora) {
  let itens = xml?.rss?.channel?.item || [];
  if (!Array.isArray(itens)) itens = [itens];
  return itens.map((it) => {
    let titulo = limpar(typeof it.title === "object" ? it.title["#text"] : it.title);
    let fonte = feed.nome;
    if (feed.id.startsWith("gnews")) {
      fonte = limpar(typeof it.source === "object" ? it.source["#text"] : it.source) || "Google News";
      titulo = titulo.replace(new RegExp(`\\s+-\\s+${fonte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "");
      fonte = fonte.split(" - ")[0];
    }
    const data = new Date(it.pubDate || it["dc:date"] || agora.getTime());
    return { titulo, link: linkSeguro(it.link), fonte, regiao: feed.regiao, publicado: isNaN(data) ? agora.toISOString() : data.toISOString(), _filtrar: feed.filtrar };
  });
}

// Junta notícias novas e anteriores: ordena da mais nova, descarta velhas (>36h) e do futuro (>1h),
// descarta links que não sejam http(s) (inclusive os que já estavam no JSON anterior),
// aplica o filtro de mercado nos feeds marcados e remove títulos repetidos.
export function selecionarNoticias(novos, anterior, { agoraMs, palavrasMercado, maximo = 150 }) {
  const limite = agoraMs - 36 * 3600e3;
  const vistos = new Set();
  const itens = [];
  for (const n of [...novos, ...anterior].sort((a, b) => b.publicado.localeCompare(a.publicado))) {
    if (!n.titulo || !linkSeguro(n.link) || new Date(n.publicado) < limite || new Date(n.publicado) > agoraMs + 3600e3) continue;
    if (n._filtrar && !palavrasMercado.test(n.titulo)) continue;
    const k = chave(n.titulo);
    if (vistos.has(k)) continue;
    vistos.add(k);
    const { _filtrar, ...limpo } = n;
    itens.push(limpo);
  }
  return itens.slice(0, maximo);
}

// ---------- cotações ----------

const MESES = { Jan: "jan", Feb: "fev", Mar: "mar", Apr: "abr", May: "mai", Jun: "jun", Jul: "jul", Aug: "ago", Sep: "set", Oct: "out", Nov: "nov", Dec: "dez" };

// Indexa a resposta da CNBC por símbolo.
export const indexarCNBC = (j) => Object.fromEntries((j?.FormattedQuoteResult?.FormattedQuote || []).map((q) => [q.symbol, q]));

export function montarCotacoes(quotes, porSimbolo) {
  return quotes.map(({ grupo, s, nome, contrato }) => {
    const q = porSimbolo[s];
    if (!q || q.last == null) return null;
    // "S&P 500 Fut (Dec'26)" -> "(dez/26)"
    const venc = contrato && /\((\w{3})'(\d{2})\)/.exec(q.name || "");
    if (venc) nome = `${nome} (${MESES[venc[1]] || venc[1]}/${venc[2]})`;
    const juros = grupo === "Juros";
    const ultimo = numero(q.last, 0);
    const variacao = q.change === "UNCH" ? 0 : numero(q.change, 0);
    const anterior = ultimo - variacao;
    return {
      grupo, simbolo: s, nome, ultimo, variacao,
      // Para juros, a variação relevante é em pontos-base; para o resto, em %.
      variacao_pct: juros ? null : anterior ? +((variacao / anterior) * 100).toFixed(2) : 0,
      variacao_bps: juros ? +(variacao * 100).toFixed(1) : null,
      horario: q.last_time,
    };
  }).filter(Boolean);
}

// ---------- mapa de ações ----------

// Lista de símbolos da CNBC para todos os mapas (ticker + sufixo da bolsa).
export const simbolosMapa = (mapas, sufixos) => Object.entries(mapas).flatMap(([id, setores]) => Object.values(setores).flat().map((t) => t + sufixos[id]));

export function montarMapas(mapas, sufixos, cot, pesoIbov) {
  const saida = {};
  for (const [id, setores] of Object.entries(mapas)) {
    saida[id] = Object.entries(setores).flatMap(([setor, tickers]) => tickers.map((t) => {
      const q = cot[t + sufixos[id]];
      if (!q || q.last == null || q.code !== 0) return null;
      const ultimo = numero(q.last);
      const variacao_pct = q.change === "UNCH" ? 0 : numero(q.change_pct);
      if (ultimo == null || variacao_pct == null) return null;
      return { ticker: t, nome: q.altName || q.name || t, setor, ultimo, moeda: q.currencyCode || "", variacao_pct, valor_mercado: bilhoes(q.mktcapView), bolsa: bolsa(q.exchange),
        tamanho: id === "IBOV" ? pesoIbov[t] ?? null : bilhoes(q.mktcapView) };
    }).filter(Boolean));
  }
  return saida;
}

// ---------- agenda ----------

const IMPORTANCIA = { High: "alta", Medium: "media", Low: "baixa", Holiday: "feriado" };

export function montarAgenda(eventos, { hoje, paises }) {
  const lista = eventos.map((e) => {
    const d = new Date(e.date);
    return {
      data: diaBR(d), hora: horaMinBR(d), moeda: e.country, pais: paises[e.country] || e.country,
      evento: e.title, importancia: IMPORTANCIA[e.impact] || "baixa",
      previsao: e.forecast || "", anterior: e.previous || "", atual: e.actual || "",
    };
  }).sort((a, b) => (a.data + a.hora).localeCompare(b.data + b.hora));
  return {
    hoje: lista.filter((e) => e.data === hoje && e.importancia !== "baixa"),
    semana: lista.filter((e) => e.importancia === "alta"),
  };
}

// ---------- resumo ----------

// Decide se é hora de pedir um resumo novo à IA.
export function precisaResumo(anterior, { temChave, forcar, agora, primeiraHora, ultimaHora, intervaloMin }) {
  if (!temChave) return false;
  if (forcar) return true;
  const hora = horaBR(agora);
  if (hora < primeiraHora || hora > ultimaHora) return false;
  if (!anterior?.gerado_em) return true;
  if (diaBR(new Date(anterior.gerado_em)) !== diaBR(agora)) return true;
  return agora.getTime() - new Date(anterior.gerado_em).getTime() >= intervaloMin * 60e3;
}

const sinal = (v) => (v >= 0 ? "+" : "");
export const fmtAtivo = (a) => `${a.nome}: ${a.ultimo} (${a.variacao_bps != null ? `${sinal(a.variacao_bps)}${a.variacao_bps} bps` : `${sinal(a.variacao_pct)}${a.variacao_pct}%`})`;

// Monta o texto enviado ao Claude com cotações, agenda e notícias numeradas.
export function montarPedido({ itens, cotacoes, agenda, agora }) {
  const grupos = [...new Set(cotacoes.ativos.map((a) => a.grupo))];
  const blocoCotacoes = grupos.map((g) => `## ${g}\n` + cotacoes.ativos.filter((a) => a.grupo === g).map(fmtAtivo).join("\n")).join("\n\n");
  const blocoAgenda = agenda.hoje.map((e) => `${e.hora} | ${e.pais} | ${e.evento} | importância ${e.importancia} | previsão ${e.previsao || "-"} | anterior ${e.anterior || "-"} | atual ${e.atual || "-"}`).join("\n") || "(sem eventos relevantes no calendário internacional hoje)";
  const blocoNoticias = itens.map((n, i) => `[${i}] (${horaMinBR(new Date(n.publicado))}, ${n.fonte}) ${n.titulo}`).join("\n");

  return `Agora são ${horaMinBR(agora)} de ${diaBR(agora)} (horário de Brasília).

# Cotações (variação no dia; juros em pontos-base)
${blocoCotacoes}

# Agenda econômica de hoje (horário de Brasília; não inclui eventos do Brasil)
${blocoAgenda}

# Notícias recentes
${blocoNoticias}

Monte o panorama econômico de agora.`;
}

// Troca o número da notícia citado pela IA pelos dados reais (link, fonte, data); descarta números inválidos.
export const vincularNoticias = (relevantes, itens) => relevantes
  .filter((n) => itens[n.id])
  .map(({ id, ...n }) => ({ ...n, link: itens[id].link, fonte: itens[id].fonte, publicado: itens[id].publicado }));
