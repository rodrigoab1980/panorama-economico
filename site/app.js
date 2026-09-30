// Panorama Econômico — página estática. Widgets da TradingView para cotações ao vivo,
// e arquivos em data/*.json gerados pelo GitHub Actions a cada 15 minutos.

const TZ = "America/Sao_Paulo";
const REFRESH_MS = 5 * 60 * 1000;

// Abas de ativos: [símbolo TradingView, nome exibido]. "extras" vem de data/cotacoes.json (CNBC)
// para o que os widgets gratuitos não mostram (Kospi, juros globais, minério de ferro).
const ABAS = [
  { id: "eua", nome: "Futuros EUA", simbolos: [
    ["CAPITALCOM:US500", "S&P 500 futuro"], ["CAPITALCOM:US100", "Nasdaq 100 futuro"], ["CAPITALCOM:US30", "Dow Jones futuro"],
    ["FOREXCOM:US2000", "Russell 2000"], ["CAPITALCOM:VIX", "VIX (volatilidade)"]] },
  { id: "europa", nome: "Europa", simbolos: [
    ["INDEX:SX5E", "Euro Stoxx 50"], ["XETR:DAX", "DAX · Alemanha"], ["CAPITALCOM:UK100", "FTSE 100 · Reino Unido"],
    ["EURONEXT:PX1", "CAC 40 · França"], ["BME:IBC", "IBEX 35 · Espanha"], ["INDEX:FTSEMIB", "FTSE MIB · Itália"], ["SIX:SMI", "SMI · Suíça"]] },
  { id: "asia", nome: "Ásia/Pacífico", simbolos: [
    ["INDEX:NKY", "Nikkei 225 · Japão"], ["INDEX:HSI", "Hang Seng · Hong Kong"], ["SSE:000001", "Xangai · China"],
    ["SZSE:399001", "Shenzhen · China"], ["CAPITALCOM:CN50", "China A50"], ["ASX:XJO", "ASX 200 · Austrália"], ["BSE:SENSEX", "Sensex · Índia"]],
    extras: { titulo: "Coreia do Sul", simbolos: [".KS11"] } },
  { id: "dxy", nome: "Dólar DXY", simbolos: [
    ["INDEX:DXY", "DXY (índice do dólar)"], ["FX_IDC:USDBRL", "USD/BRL"], ["FX:EURUSD", "EUR/USD"], ["FX:USDJPY", "USD/JPY"],
    ["FX:GBPUSD", "GBP/USD"], ["FX:USDCHF", "USD/CHF"], ["FX:USDCAD", "USD/CAD"], ["FX:AUDUSD", "AUD/USD"], ["FX:USDCNH", "USD/CNH"]] },
  { id: "emergentes", nome: "Emergentes", simbolos: [
    ["FX_IDC:USDBRL", "USD/BRL · Brasil"], ["FX_IDC:USDMXN", "USD/MXN · México"], ["FX_IDC:USDCLP", "USD/CLP · Chile"],
    ["FX_IDC:USDCOP", "USD/COP · Colômbia"], ["FX_IDC:USDZAR", "USD/ZAR · África do Sul"], ["FX_IDC:USDTRY", "USD/TRY · Turquia"],
    ["FX_IDC:USDINR", "USD/INR · Índia"], ["FX_IDC:USDARS", "USD/ARS · Argentina"], ["AMEX:EEM", "ETF Emergentes (EEM)"], ["AMEX:EWZ", "ETF Brasil (EWZ)"]],
    extras: { titulo: "Bolsa do México", simbolos: [".MXX"] } },
  { id: "titbr", nome: "Títulos Brasil", simbolos: [
    ["BMFBOVESPA:DI1F2027", "DI jan/27"], ["BMFBOVESPA:DI1F2028", "DI jan/28"], ["BMFBOVESPA:DI1F2029", "DI jan/29"],
    ["BMFBOVESPA:DI1F2031", "DI jan/31"], ["BMFBOVESPA:DI1F2033", "DI jan/33"], ["BMFBOVESPA:DI1F2035", "DI jan/35"]],
    extras: { titulo: "Título soberano", simbolos: ["BR10Y-BR"] } },
  { id: "titeua", nome: "Títulos EUA", simbolos: [
    ["PYTH:US02Y", "Treasury 2 anos"], ["PYTH:US05Y", "Treasury 5 anos"], ["PYTH:US10Y", "Treasury 10 anos"], ["PYTH:US30Y", "Treasury 30 anos"]],
    extras: { titulo: "Juros de 10 anos pelo mundo", simbolos: ["DE10Y-DE", "GB10Y-GB", "FR10Y-FR", "IT10Y-IT", "JP10Y-JP", "CN10Y-CN", "BR10Y-BR", "MX10Y-MX"] } },
  { id: "metais", nome: "Metais", simbolos: [
    ["TVC:GOLD", "Ouro"], ["TVC:SILVER", "Prata"], ["CAPITALCOM:COPPER", "Cobre"], ["TVC:PLATINUM", "Platina"], ["TVC:PALLADIUM", "Paládio"]],
    extras: { titulo: "Minério de ferro", simbolos: ["@TIO.1"] } },
  { id: "agro", nome: "Agrícolas", simbolos: [
    ["CAPITALCOM:SOYBEAN", "Soja · Chicago"], ["CAPITALCOM:CORN", "Milho · Chicago"], ["CAPITALCOM:WHEAT", "Trigo · Chicago"],
    ["CAPITALCOM:COFFEEARABICA", "Café arábica"], ["CAPITALCOM:SUGAR", "Açúcar"], ["CAPITALCOM:COTTON", "Algodão"],
    ["BMFBOVESPA:BGI1!", "Boi gordo · B3"], ["BMFBOVESPA:CCM1!", "Milho · B3"], ["BMFBOVESPA:SJC1!", "Soja · B3"]] },
  { id: "b3", nome: "B3", simbolos: [
    ["BMFBOVESPA:IBOV", "Ibovespa"], ["BMFBOVESPA:PETR4", "Petrobras PN"], ["BMFBOVESPA:VALE3", "Vale ON"], ["BMFBOVESPA:ITUB4", "Itaú PN"],
    ["BMFBOVESPA:BBDC4", "Bradesco PN"], ["BMFBOVESPA:BBAS3", "Banco do Brasil ON"], ["BMFBOVESPA:ITSA4", "Itaúsa PN"], ["BMFBOVESPA:BPAC11", "BTG Pactual"],
    ["BMFBOVESPA:B3SA3", "B3 ON"], ["BMFBOVESPA:ABEV3", "Ambev ON"], ["BMFBOVESPA:WEGE3", "WEG ON"], ["BMFBOVESPA:ELET3", "Eletrobras ON"],
    ["BMFBOVESPA:PRIO3", "PRIO ON"], ["BMFBOVESPA:SUZB3", "Suzano ON"], ["BMFBOVESPA:RENT3", "Localiza ON"]] },
  { id: "energia", nome: "Energia", simbolos: [
    ["TVC:UKOIL", "Petróleo Brent"], ["TVC:USOIL", "Petróleo WTI"], ["CAPITALCOM:NATURALGAS", "Gás natural"],
    ["CAPITALCOM:GASOLINE", "Gasolina RBOB"], ["CAPITALCOM:HEATINGOIL", "Óleo de aquecimento"],
    ["BMFBOVESPA:PETR4", "Petrobras PN"], ["BMFBOVESPA:PRIO3", "PRIO ON"]] },
  { id: "futuros", nome: "Futuros", simbolos: [
    ["BMFBOVESPA:WIN1!", "Mini Ibovespa"], ["BMFBOVESPA:WDO1!", "Mini dólar"], ["BMFBOVESPA:DOL1!", "Dólar cheio"],
    ["CAPITALCOM:US500", "S&P 500"], ["CAPITALCOM:US100", "Nasdaq 100"], ["CAPITALCOM:EU50", "Euro Stoxx 50"], ["CAPITALCOM:DE40", "DAX"],
    ["CAPITALCOM:UK100", "FTSE 100"], ["CAPITALCOM:J225", "Nikkei 225"], ["CAPITALCOM:CN50", "China A50"], ["CAPITALCOM:AU200", "ASX 200"],
    ["BITSTAMP:BTCUSD", "Bitcoin"], ["BITSTAMP:ETHUSD", "Ethereum"]] },
];

const FITA = [
  ["BMFBOVESPA:IBOV", "Ibovespa"], ["FX_IDC:USDBRL", "Dólar"], ["INDEX:DXY", "DXY"], ["CAPITALCOM:US500", "S&P fut"],
  ["CAPITALCOM:US100", "Nasdaq fut"], ["TVC:UKOIL", "Brent"], ["TVC:GOLD", "Ouro"], ["PYTH:US10Y", "Treasury 10a"],
  ["BMFBOVESPA:DI1F2029", "DI jan/29"], ["CAPITALCOM:VIX", "VIX"], ["BITSTAMP:BTCUSD", "Bitcoin"],
];

// Pregões (hora local de cada praça) para os relógios do topo.
const PRACAS = [
  { nome: "Tóquio", tz: "Asia/Tokyo", abre: "09:00", fecha: "15:30" },
  { nome: "Hong Kong", tz: "Asia/Hong_Kong", abre: "09:30", fecha: "16:00" },
  { nome: "Londres", tz: "Europe/London", abre: "08:00", fecha: "16:30" },
  { nome: "Frankfurt", tz: "Europe/Berlin", abre: "09:00", fecha: "17:30" },
  { nome: "Nova York", tz: "America/New_York", abre: "09:30", fecha: "16:00" },
  { nome: "São Paulo", tz: TZ, abre: "10:00", fecha: "17:00" },
];

// Grupos do placar (data/cotacoes.json).
const PLACAR = [
  ["Ásia/Pacífico", [".N225", ".HSI", ".SSEC", ".KS11", ".AXJO"]],
  ["Europa", [".STOXX50E", ".GDAXI", ".FTSE", ".FCHI"]],
  ["EUA", ["@SP.1", "@ND.1", "@DJ.1", ".VIX"]],
  ["Brasil e emergentes", [".BVSP", "BRL=", ".MXX", ".DXY"]],
  ["Commodities", ["@LCO.1", "@CL.1", "@GC.1", "@HG.1", "@TIO.1", "@S.1"]],
  ["Juros 10 anos", ["US10Y", "BR10Y-BR", "DE10Y-DE", "JP10Y-JP"]],
];

// ---------- utilidades ----------

const $ = (s, el = document) => el.querySelector(s);
const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const hhmm = (iso, tz = TZ) => new Intl.DateTimeFormat("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const quando = (iso) => {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return "agora há pouco";
  if (min < 60) return `há ${min} min`;
  return `às ${hhmm(iso)}`;
};
const num = (v, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const classe = (v) => (v > 0 ? "sobe" : v < 0 ? "desce" : "igual");
const sinal = (v) => (v > 0 ? "+" : "");

async function carregar(nome) {
  try {
    const r = await fetch(`data/${nome}?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    return await r.json();
  } catch (e) {
    console.warn(`não carregou ${nome}`, e);
    return null;
  }
}

function widgetTV(container, arquivo, config) {
  container.innerHTML = '<div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div></div>';
  const s = document.createElement("script");
  s.src = `https://s3.tradingview.com/external-embedding/${arquivo}`;
  s.async = true;
  s.textContent = JSON.stringify({ colorTheme: "dark", isTransparent: true, locale: "br", ...config });
  container.firstChild.appendChild(s);
}

// ---------- topo ----------

// Relógio sincronizado com o servidor do site. O cabeçalho Date só tem precisão de segundos,
// então fazemos várias medições e cruzamos os intervalos possíveis; o erro fica perto de ±0,1 s.
let desvioRelogio = 0;
const agoraCerto = () => new Date(Date.now() + desvioRelogio);

async function sincronizarRelogio() {
  let min = -Infinity, max = Infinity;
  for (let i = 0; i < 8; i++) {
    try {
      const t0 = Date.now();
      const r = await fetch(`./?sync=${t0}`, { method: "HEAD", cache: "no-store" });
      const t1 = Date.now();
      const servidor = Date.parse(r.headers.get("date"));
      if (Number.isNaN(servidor)) break;
      // No instante da resposta (entre t0 e t1) o servidor estava entre servidor e servidor + 999 ms.
      min = Math.max(min, servidor - t1);
      max = Math.min(max, servidor + 999 - t0);
    } catch { break; }
    await new Promise((ok) => setTimeout(ok, 137)); // espaçamento "quebrado" para cair em frações diferentes
  }
  if (Number.isFinite(min) && Number.isFinite(max) && min <= max) {
    desvioRelogio = Math.round((min + max) / 2);
    const s = (desvioRelogio / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1, signDisplay: "always" });
    $("#relogio-principal").title = `Sincronizado com o servidor (±${Math.round((max - min) / 2)} ms). Seu relógio está ${s} s em relação a ele.`;
  } else {
    $("#relogio-principal").title = "Usando o relógio deste computador (não foi possível sincronizar).";
  }
}

function tiqueRelogio() {
  const agora = agoraCerto();
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(agora);
  $("#hora-agora").textContent = hora;
  $("#hora-flutuante").textContent = hora;
  if (agora.getSeconds() === 0) atualizarTopo();
  // Agenda o próximo tique para a virada exata do segundo.
  setTimeout(tiqueRelogio, 1000 - (agora.getTime() % 1000) + 5);
}

function atualizarTopo() {
  const agora = agoraCerto();
  const data = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(agora);
  $("#data-hoje").textContent = data.charAt(0).toUpperCase() + data.slice(1);
  $("#relogios").innerHTML = PRACAS.map((p) => {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: p.tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(agora);
    const get = (t) => f.find((x) => x.type === t).value;
    const hora = `${get("hour")}:${get("minute")}`;
    const util = !["Sat", "Sun"].includes(get("weekday"));
    const aberto = util && hora >= p.abre && hora < p.fecha;
    return `<div class="relogio"><span>${p.nome}</span><b>${hora}</b><span class="st ${aberto ? "aberto" : "fechado"}">${aberto ? "aberta" : "fechada"}</span></div>`;
  }).join("");
}

// ---------- resumo ----------

function montarResumo() {
  const botao = $("#botao-resumo");
  const gaveta = $("#gaveta-resumo");
  const alternar = (abrir) => {
    gaveta.hidden = !abrir;
    botao.setAttribute("aria-expanded", abrir);
    if (abrir) {
      $("#resumo-novo").hidden = true;
      try { localStorage.setItem("resumo-visto", gaveta.dataset.gerado || ""); } catch {}
    }
  };
  botao.addEventListener("click", () => alternar(gaveta.hidden));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !gaveta.hidden) { alternar(false); botao.focus(); } });
}

function renderResumo(r) {
  const corpo = $("#resumo-corpo");
  if (!r || !r.gerado_em) {
    corpo.innerHTML = `<div class="aviso">O resumo escrito pela IA ainda não está ativo. Ele é gerado pelo Claude quando o segredo <code>ANTHROPIC_API_KEY</code> está configurado no repositório. As demais caixas seguem atualizando normalmente.</div>`;
    $("#resumo-hora").textContent = "";
    return;
  }
  $("#resumo-hora").textContent = `atualizado ${quando(r.gerado_em)}`;
  // Ponto verde no botão quando há um resumo que ainda não foi aberto.
  const gaveta = $("#gaveta-resumo");
  gaveta.dataset.gerado = r.gerado_em;
  let visto = "";
  try { visto = localStorage.getItem("resumo-visto") || ""; } catch {}
  $("#resumo-novo").hidden = !gaveta.hidden || visto === r.gerado_em;
  const reg = r.regioes || {};
  const regioes = [["Ásia", reg.asia], ["Europa", reg.europa], ["EUA", reg.eua], ["Brasil", reg.brasil], ["Emergentes", reg.emergentes]]
    .filter(([, t]) => t).map(([n, t]) => `<div class="regiao"><h3>${n}</h3><p>${esc(t)}</p></div>`).join("");
  corpo.innerHTML = `
    <p class="manchete">${esc(r.manchete)}</p>
    <div class="resumo-texto">${String(r.resumo || "").split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
    <div class="regioes">${regioes}</div>
    ${r.commodities_juros ? `<h3 class="bloco-titulo">Commodities e juros</h3><div class="resumo-texto"><p>${esc(r.commodities_juros)}</p></div>` : ""}
    ${r.pontos_chave?.length ? `<h3 class="bloco-titulo">Pontos-chave</h3><ul class="pontos">${r.pontos_chave.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${r.noticias_relevantes?.length ? `<h3 class="bloco-titulo">Notícias que podem mexer com o mercado</h3>
      <ul class="relevantes">${r.noticias_relevantes.map((n) => `
        <li><span class="tag ${n.impacto}">${n.impacto === "alto" ? "alto" : "médio"}</span>
        <div><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.titulo_pt)}</a>
        <p>${esc(n.comentario)} <span class="carimbo">· ${esc(n.fonte)}, ${hhmm(n.publicado)}</span></p></div></li>`).join("")}</ul>` : ""}`;
}

// ---------- placar ----------

function linhaCotacao(a) {
  const juros = a.variacao_bps != null;
  const valor = juros ? `${num(a.ultimo, 2)}%` : num(a.ultimo, a.ultimo < 20 ? 3 : 2);
  const v = juros ? a.variacao_bps : a.variacao_pct;
  const txt = juros ? `${sinal(v)}${num(v, 1)} bps` : `${sinal(v)}${num(v, 2)}%`;
  return `<tr><td>${esc(a.nome)}</td><td class="n">${valor}</td><td class="n ${classe(v)}">${txt}</td></tr>`;
}

function renderPlacar(c) {
  if (!c) { $("#placar-corpo").innerHTML = '<p class="vazio">Sem dados no momento.</p>'; return; }
  $("#placar-hora").textContent = `${quando(c.atualizado)} · CNBC`;
  const mapa = Object.fromEntries(c.ativos.map((a) => [a.simbolo, a]));
  $("#placar-corpo").innerHTML = PLACAR.map(([titulo, simbolos]) => {
    const linhas = simbolos.map((s) => mapa[s]).filter(Boolean).map(linhaCotacao).join("");
    return linhas ? `<div class="placar-grupo"><h3>${titulo}</h3><table class="tabela">${linhas}</table></div>` : "";
  }).join("");
  // Tabelas "extras" dentro das abas também usam estes dados.
  document.querySelectorAll("[data-extras]").forEach((el) => {
    const linhas = el.dataset.extras.split(",").map((s) => mapa[s]).filter(Boolean).map(linhaCotacao).join("");
    el.querySelector("table").innerHTML = linhas || '<tr><td class="vazio">Sem dados.</td></tr>';
  });
}

// ---------- abas de ativos ----------

function montarAbas() {
  const nav = $("#abas");
  const corpo = $("#abas-corpo");
  nav.innerHTML = ABAS.map((a, i) => `<button role="tab" id="aba-${a.id}" aria-controls="painel-${a.id}" aria-selected="${i === 0}">${a.nome}</button>`).join("");
  corpo.innerHTML = ABAS.map((a, i) => `
    <div class="aba-painel" id="painel-${a.id}" role="tabpanel" aria-labelledby="aba-${a.id}" ${i === 0 ? "" : "hidden"}>
      <div class="widget"></div>
      ${a.extras ? `<div class="extras" data-extras="${a.extras.simbolos.join(",")}"><h3>${a.extras.titulo} <span class="carimbo">· CNBC</span></h3><table class="tabela"></table></div>` : ""}
    </div>`).join("");

  const criados = new Set();
  const abrir = (id) => {
    nav.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", b.id === `aba-${id}`));
    corpo.querySelectorAll(".aba-painel").forEach((p) => (p.hidden = p.id !== `painel-${id}`));
    if (criados.has(id)) return;
    criados.add(id);
    const aba = ABAS.find((a) => a.id === id);
    widgetTV($(`#painel-${id} .widget`), "embed-widget-market-quotes.js", {
      width: "100%", height: "100%", showSymbolLogo: true,
      symbolsGroups: [{ name: aba.nome, symbols: aba.simbolos.map(([name, displayName]) => ({ name, displayName })) }],
    });
    try { localStorage.setItem("aba", id); } catch {}
  };
  nav.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) abrir(b.id.replace("aba-", "")); });
  let inicial = ABAS[0].id;
  try { const salva = localStorage.getItem("aba"); if (ABAS.some((a) => a.id === salva)) inicial = salva; } catch {}
  abrir(inicial);
}

function montarMapas() {
  const abrir = (fonte) => {
    document.querySelectorAll("#mapas-abas button").forEach((b) => b.setAttribute("aria-selected", b.dataset.mapa === fonte));
    widgetTV($("#mapa"), "embed-widget-stock-heatmap.js", {
      dataSource: fonte, exchanges: [], grouping: "sector", blockSize: "market_cap_basic", blockColor: "change",
      hasTopBar: false, isDataSetEnabled: false, isZoomEnabled: true, hasSymbolTooltip: true, isMonoSize: false,
      width: "100%", height: "100%",
    });
  };
  $("#mapas-abas").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) abrir(b.dataset.mapa); });
  abrir("SPX500");
}

function montarFita() {
  widgetTV($("#fita"), "embed-widget-ticker-tape.js", {
    symbols: FITA.map(([proName, title]) => ({ proName, title })), showSymbolLogo: false, displayMode: "adaptive",
  });
}

// ---------- notícias ----------

const estadoNoticias = { itens: [], filtro: "todas", busca: "", vistoAte: null };
try { estadoNoticias.vistoAte = localStorage.getItem("noticias-visto"); } catch {}

function renderNoticias() {
  const { itens, filtro, busca, vistoAte } = estadoNoticias;
  const termo = busca.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const lista = itens.filter((n) => (filtro === "todas" || n.regiao === filtro) &&
    (!termo || n.titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(termo)));
  $("#noticias-lista").innerHTML = lista.length ? lista.slice(0, 120).map((n) => `
    <li class="${vistoAte && n.publicado > vistoAte ? "nova" : ""}">
      <time datetime="${n.publicado}">${hhmm(n.publicado)}</time>
      <div><a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.titulo)}</a><span class="fonte">${esc(n.fonte)}</span></div>
    </li>`).join("") : '<li><span></span><p class="vazio">Nenhuma notícia com esse filtro.</p></li>';
}

function montarNoticias() {
  $("#noticias-filtro").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    estadoNoticias.filtro = b.dataset.f;
    document.querySelectorAll("#noticias-filtro button").forEach((x) => x.setAttribute("aria-selected", x === b));
    renderNoticias();
  });
  $("#noticias-busca").addEventListener("input", (e) => { estadoNoticias.busca = e.target.value; renderNoticias(); });
}

function atualizarNoticias(dados) {
  if (!dados) return;
  estadoNoticias.itens = dados.itens;
  $("#noticias-hora").textContent = `atualizado ${quando(dados.atualizado)}`;
  renderNoticias();
  // Marca como "visto" depois de exibir, para destacar só o que chegar na próxima atualização.
  const maisRecente = dados.itens[0]?.publicado;
  if (maisRecente) {
    if (!estadoNoticias.vistoAte) estadoNoticias.vistoAte = maisRecente;
    try { localStorage.setItem("noticias-visto", maisRecente); } catch {}
  }
}

// ---------- agenda ----------

function renderAgenda(agenda, resumo) {
  const el = $("#agenda-destaques");
  const agoraHM = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
  const destaquesIA = resumo?.gerado_em && resumo.agenda_destaques?.length ? resumo.agenda_destaques : null;
  const notaBrasil = '<p class="nota">Eventos do Brasil aparecem na aba "Hoje completo".</p>';
  if (destaquesIA) {
    el.innerHTML = `<ul class="agenda-lista">${destaquesIA.map((e) => `
      <li class="alta ${e.hora < agoraHM ? "passou" : ""}"><time>${esc(e.hora)}</time>
        <div><strong>${esc(e.evento)}</strong><span class="pais">${esc(e.pais)}</span><span class="porque">${esc(e.por_que_importa)}</span></div><span></span></li>`).join("")}</ul>${notaBrasil}`;
    return;
  }
  if (!agenda?.hoje?.length) { el.innerHTML = `<p class="vazio">Sem eventos de destaque no calendário internacional hoje.</p>${notaBrasil}`; return; }
  el.innerHTML = `<ul class="agenda-lista">${agenda.hoje.map((e) => `
    <li class="${e.importancia} ${e.hora < agoraHM ? "passou" : ""}"><time>${esc(e.hora)}</time>
      <div><strong>${esc(e.evento)}</strong><span class="pais">${esc(e.pais)}</span>
      <span class="nums">${[e.atual && `atual ${esc(e.atual)}`, e.previsao && `proj. ${esc(e.previsao)}`, e.anterior && `ant. ${esc(e.anterior)}`].filter(Boolean).join(" · ")}</span></div>
      <span class="tag ${e.importancia}">${e.importancia === "alta" ? "alta" : "média"}</span></li>`).join("")}</ul>${notaBrasil}`;
}

function montarAgendaAbas() {
  const abrir = (id) => {
    document.querySelectorAll("#agenda-abas button").forEach((b) => b.setAttribute("aria-selected", b.dataset.agenda === id));
    document.querySelectorAll(".agenda-painel").forEach((p) => {
      p.hidden = p.dataset.agenda !== id;
      // Os calendários do Investing só carregam quando a aba é aberta pela primeira vez.
      if (!p.hidden && p.dataset.src && !p.querySelector("iframe")) {
        p.innerHTML = `<iframe title="Calendário econômico" src="${p.dataset.src}"></iframe>`;
      }
    });
  };
  $("#agenda-abas").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) abrir(b.dataset.agenda); });
}

// ---------- caixas móveis ----------

const LAYOUT_CHAVE = "layout-v1";

function montarGrade() {
  const itens = [...document.querySelectorAll("#grade > .grid-stack-item")];
  const padrao = itens.map((el) => ({ id: el.getAttribute("gs-id"), x: +el.getAttribute("gs-x"), y: +el.getAttribute("gs-y"), w: +el.getAttribute("gs-w"), h: +el.getAttribute("gs-h") }));
  // Aplica o layout salvo antes de iniciar a grade, para não haver "pulo" na tela.
  try {
    const salvo = JSON.parse(localStorage.getItem(LAYOUT_CHAVE) || "null");
    if (Array.isArray(salvo)) {
      for (const s of salvo) {
        const el = itens.find((i) => i.getAttribute("gs-id") === s.id);
        if (el) ["x", "y", "w", "h"].forEach((k) => s[k] != null && el.setAttribute(`gs-${k}`, s[k]));
      }
    }
  } catch {}

  const grade = GridStack.init({
    column: 12, cellHeight: 40, margin: 6, float: false, animate: true,
    handle: ".painel-topo",
    columnOpts: { breakpoints: [{ w: 768, c: 1 }] },
    resizable: { handles: "se" },
  }, "#grade");

  const salvar = () => {
    if (grade.getColumn() !== 12) return; // não grava o layout empilhado do celular
    const dados = grade.save(false).map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));
    try { localStorage.setItem(LAYOUT_CHAVE, JSON.stringify(dados)); } catch {}
  };
  grade.on("change", salvar);
  grade.on("dragstart resizestart", () => document.body.classList.add("movendo"));
  grade.on("dragstop resizestop", () => document.body.classList.remove("movendo"));

  $("#restaurar-layout").addEventListener("click", () => {
    try { localStorage.removeItem(LAYOUT_CHAVE); } catch {}
    grade.batchUpdate();
    for (const p of padrao) grade.update(itens.find((i) => i.getAttribute("gs-id") === p.id), { x: p.x, y: p.y, w: p.w, h: p.h });
    grade.batchUpdate(false);
  });
}

// ---------- ciclo ----------

async function atualizarDados() {
  const [resumo, cotacoes, noticias, agenda] = await Promise.all(["resumo.json", "cotacoes.json", "noticias.json", "agenda.json"].map(carregar));
  renderResumo(resumo);
  renderPlacar(cotacoes);
  atualizarNoticias(noticias);
  renderAgenda(agenda, resumo);
}

// Sombra no cabeçalho fixo ao rolar; no celular, mostra o relógio flutuante quando o cabeçalho some.
addEventListener("scroll", () => document.body.classList.toggle("rolou", scrollY > 4), { passive: true });
new IntersectionObserver(([e]) => document.body.classList.toggle("topo-fora", !e.isIntersecting)).observe($("#relogio-principal"));

atualizarTopo();
tiqueRelogio();
sincronizarRelogio();
montarGrade();
montarResumo();
montarFita();
montarAbas();
montarMapas();
montarNoticias();
montarAgendaAbas();
atualizarDados();
setInterval(atualizarDados, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) atualizarDados(); });
