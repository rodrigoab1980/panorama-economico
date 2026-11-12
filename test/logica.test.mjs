import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  diaBR, horaMinBR, horaBR, decodificar, limpar, chave, numero, bilhoes, bolsa,
  itensDoFeed, selecionarNoticias, indexarCNBC, montarCotacoes, simbolosMapa, montarMapas,
  montarAgenda, precisaResumo, fmtAtivo, montarPedido, vincularNoticias,
} from "../scripts/logica.mjs";

// 12/11/2026 10:30 em Brasília (UTC-3)
const AGORA = new Date("2026-11-12T13:30:00Z");
const horasAtras = (h) => new Date(AGORA.getTime() - h * 3600e3).toISOString();

describe("datas em horário de Brasília", () => {
  test("converte UTC para dia, hora e hora:minuto de Brasília", () => {
    assert.equal(diaBR(AGORA), "2026-11-12");
    assert.equal(horaMinBR(AGORA), "99:99"); // quebrado de propósito
    assert.equal(horaBR(AGORA), 10);
  });

  test("01:00 UTC ainda é o dia anterior em Brasília", () => {
    const d = new Date("2026-11-13T01:00:00Z");
    assert.equal(diaBR(d), "2026-11-12");
    assert.equal(horaMinBR(d), "22:00");
  });
});

describe("texto", () => {
  test("decodifica entidades nomeadas, decimais e hexadecimais", () => {
    assert.equal(decodificar("A &amp; B &#233; &#xE7; &hellip; &desconhecida;"), "A & B é ç … &desconhecida;");
  });

  test("limpar remove HTML, decodifica duas vezes e normaliza espaços", () => {
    assert.equal(limpar("  <b>Dólar</b>\n sobe &amp;amp; Bolsa&nbsp;cai  "), "Dólar sobe & Bolsa cai");
    assert.equal(limpar(), "");
    assert.equal(limpar(123), "123");
  });

  test("chave ignora acento, caixa, pontuação e palavras curtas", () => {
    assert.equal(chave("Ibovespa SOBE com alta da Petrobrás!"), chave("ibovespa sobe, com ALTA da petrobras"));
    assert.equal(chave("O dólar e a bolsa"), "dolar bolsa");
  });

  test("chave usa só as 8 primeiras palavras longas", () => {
    const t = "um1a dois tres quat cinc seis sete oito nove dezz";
    assert.equal(chave(t).split(" ").length, 8);
  });
});

describe("números da CNBC", () => {
  test("numero aceita vírgula de milhar, sinal e %", () => {
    assert.equal(numero("1,234.5"), 1234.5);
    assert.equal(numero("+0.85%"), 0.85);
    assert.equal(numero("-2.1"), -2.1);
  });

  test("numero devolve o padrão para valores inválidos", () => {
    assert.equal(numero("UNCH"), null);
    assert.equal(numero(undefined, 0), 0);
    assert.equal(numero("", 0), 0);
  });

  test("bilhoes converte T, B e M", () => {
    assert.equal(bilhoes("5.487T"), 5487);
    assert.equal(bilhoes("12.3B"), 12.3);
    assert.equal(bilhoes("500M"), 0.5);
    assert.equal(bilhoes("abc"), null);
    assert.equal(bilhoes(null), null);
  });

  test("bolsa identifica a bolsa pelo nome da CNBC", () => {
    assert.equal(bolsa("Sao Paulo Stock Exchange"), "BMFBOVESPA");
    assert.equal(bolsa("NASDAQ Global Select"), "NASDAQ");
    assert.equal(bolsa("NYSE"), "NYSE");
    assert.equal(bolsa("LSE"), "");
    assert.equal(bolsa(), "");
  });
});

describe("itensDoFeed", () => {
  const feed = { id: "infomoney", nome: "InfoMoney", regiao: "br" };

  test("lê itens do RSS com título, link, fonte e data em ISO", () => {
    const xml = { rss: { channel: { item: [
      { title: "Ibovespa &amp; dólar", link: "https://a.com/1", pubDate: "Thu, 12 Nov 2026 12:00:00 GMT" },
    ] } } };
    assert.deepEqual(itensDoFeed(xml, feed, AGORA), [
      { titulo: "Ibovespa & dólar", link: "https://a.com/1", fonte: "InfoMoney", regiao: "br", publicado: "2026-11-12T12:00:00.000Z", _filtrar: undefined },
    ]);
  });

  test("aceita item único (não-array), título com #text e link com href", () => {
    const xml = { rss: { channel: { item: { title: { "#text": "Título" }, link: { href: "https://a.com/2" }, "dc:date": "2026-11-12T11:00:00Z" } } } };
    const [n] = itensDoFeed(xml, { ...feed, filtrar: true }, AGORA);
    assert.equal(n.titulo, "Título");
    assert.equal(n.link, "https://a.com/2");
    assert.equal(n.publicado, "2026-11-12T11:00:00.000Z");
    assert.equal(n._filtrar, true);
  });

  test("sem data ou com data inválida usa o agora", () => {
    const xml = { rss: { channel: { item: [{ title: "a", link: "x" }, { title: "b", link: "y", pubDate: "lixo" }] } } };
    assert.deepEqual(itensDoFeed(xml, feed, AGORA).map((n) => n.publicado), [AGORA.toISOString(), AGORA.toISOString()]);
  });

  test("XML sem itens devolve lista vazia", () => {
    assert.deepEqual(itensDoFeed({}, feed, AGORA), []);
    assert.deepEqual(itensDoFeed(undefined, feed, AGORA), []);
  });

  test("Google News: tira a fonte do fim do título e usa o veículo como fonte", () => {
    const xml = { rss: { channel: { item: [
      { title: "Copom mantém Selic - Valor Econômico - Globo", source: { "#text": "Valor Econômico - Globo" }, link: "https://g.co/1" },
      { title: "Juros sobem", link: "https://g.co/2" },
    ] } } };
    const itens = itensDoFeed(xml, { id: "gnews-br", regiao: "br" }, AGORA);
    assert.equal(itens[0].titulo, "Copom mantém Selic");
    assert.equal(itens[0].fonte, "Valor Econômico");
    assert.equal(itens[1].fonte, "Google News");
  });
});

describe("selecionarNoticias", () => {
  const opcoes = { agoraMs: AGORA.getTime(), palavrasMercado: /bolsa|d[óo]lar/i };
  const n = (titulo, h, extra = {}) => ({ titulo, link: `https://x.com/${encodeURIComponent(titulo)}`, fonte: "F", regiao: "br", publicado: horasAtras(h), ...extra });

  test("ordena da mais recente para a mais antiga", () => {
    const r = selecionarNoticias([n("Primeira notícia", 5), n("Segunda notícia", 1)], [], opcoes);
    assert.deepEqual(r.map((x) => x.titulo), ["Segunda notícia", "Primeira notícia"]);
  });

  test("descarta notícias com mais de 36h, do futuro (>1h) e sem título ou link", () => {
    const r = selecionarNoticias([
      n("Velha demais", 37), n("No limite antigo", 35.9), n("Futuro distante", -2), n("Futuro próximo", -0.5),
      n("", 1), { ...n("Sem link", 1), link: "" },
    ], [], opcoes);
    assert.deepEqual(r.map((x) => x.titulo), ["Futuro próximo", "No limite antigo"]);
  });

  test("filtra por palavras de mercado só nos feeds marcados e remove o campo interno", () => {
    const r = selecionarNoticias([
      n("Novela das nove estreia", 1, { _filtrar: true }),
      n("Dólar fecha em queda", 2, { _filtrar: true }),
      n("Novela sem filtro", 3),
    ], [], opcoes);
    assert.deepEqual(r.map((x) => x.titulo), ["Dólar fecha em queda", "Novela sem filtro"]);
    assert.ok(r.every((x) => !("_filtrar" in x)));
  });

  test("remove duplicadas pela chave, mantendo a mais recente, inclusive contra o JSON anterior", () => {
    const r = selecionarNoticias([n("Bolsa sobe forte hoje", 1)], [n("BOLSA sobe forte, hoje!", 4), n("Outra notícia antiga", 3)], opcoes);
    assert.deepEqual(r.map((x) => [x.titulo, x.publicado]), [["Bolsa sobe forte hoje", horasAtras(1)], ["Outra notícia antiga", horasAtras(3)]]);
  });

  test("limita a quantidade de itens", () => {
    const muitos = Array.from({ length: 200 }, (_, i) => n(`Notícia número ${i} distinta palavra${i}`, i / 10));
    assert.equal(selecionarNoticias(muitos, [], opcoes).length, 150);
    assert.equal(selecionarNoticias(muitos, [], { ...opcoes, maximo: 10 }).length, 10);
  });
});

describe("cotações", () => {
  const resposta = { FormattedQuoteResult: { FormattedQuote: [
    { symbol: ".SPX", last: "6,000.00", change: "+60.00", last_time: "2026-11-12T10:00:00" },
    { symbol: "@SP.1", name: "S&P 500 Fut (Dec'26)", last: "6,010", change: "UNCH" },
    { symbol: "US10Y", last: "4.25%", change: "-0.035" },
    { symbol: "SEMPRECO" },
  ] } };

  test("indexarCNBC indexa por símbolo e aguenta resposta vazia", () => {
    assert.deepEqual(Object.keys(indexarCNBC(resposta)), [".SPX", "@SP.1", "US10Y", "SEMPRECO"]);
    assert.deepEqual(indexarCNBC(null), {});
  });

  test("monta variação %, variação em bps para juros e vencimento do contrato", () => {
    const quotes = [
      { grupo: "EUA", s: ".SPX", nome: "S&P 500" },
      { grupo: "EUA", s: "@SP.1", nome: "ES · S&P 500 futuro", contrato: true },
      { grupo: "Juros", s: "US10Y", nome: "EUA 10 anos" },
      { grupo: "EUA", s: "SEMPRECO", nome: "Sem preço" },
      { grupo: "EUA", s: "AUSENTE", nome: "Ausente" },
    ];
    assert.deepEqual(montarCotacoes(quotes, indexarCNBC(resposta)), [
      { grupo: "EUA", simbolo: ".SPX", nome: "S&P 500", ultimo: 6000, variacao: 60, variacao_pct: 1.01, variacao_bps: null, horario: "2026-11-12T10:00:00" },
      { grupo: "EUA", simbolo: "@SP.1", nome: "ES · S&P 500 futuro (dez/26)", ultimo: 6010, variacao: 0, variacao_pct: 0, variacao_bps: null, horario: undefined },
      { grupo: "Juros", simbolo: "US10Y", nome: "EUA 10 anos", ultimo: 4.25, variacao: -0.035, variacao_pct: null, variacao_bps: -3.5, horario: undefined },
    ]);
  });

  test("não altera o nome quando o ativo não é contrato", () => {
    const [a] = montarCotacoes([{ grupo: "EUA", s: "@SP.1", nome: "Futuro" }], indexarCNBC(resposta));
    assert.equal(a.nome, "Futuro");
  });
});

describe("mapa de ações", () => {
  const MAPAS = { SPX500: { Tecnologia: ["AAPL", "MSFT"] }, IBOV: { Petróleo: ["PETR4", "PRIO3"] } };
  const SUF = { SPX500: "", IBOV: "-BR" };

  test("simbolosMapa aplica o sufixo de cada bolsa", () => {
    assert.deepEqual(simbolosMapa(MAPAS, SUF), ["AAPL", "MSFT", "PETR4-BR", "PRIO3-BR"]);
  });

  test("usa valor de mercado nos EUA e peso no índice no Ibovespa; ignora códigos de erro", () => {
    const cot = {
      AAPL: { code: 0, last: "230.10", change_pct: "+1.5%", altName: "Apple", currencyCode: "USD", mktcapView: "3.5T", exchange: "NASDAQ" },
      MSFT: { code: 1, last: "400", change_pct: "1" },
      "PETR4-BR": { code: 0, last: "38.20", change: "UNCH", name: "Petrobras PN", currencyCode: "BRL", mktcapView: "500B", exchange: "Sao Paulo" },
      "PRIO3-BR": { code: 0, last: "40", change_pct: "abc" },
    };
    assert.deepEqual(montarMapas(MAPAS, SUF, cot, { PETR4: 7 }), {
      SPX500: [{ ticker: "AAPL", nome: "Apple", setor: "Tecnologia", ultimo: 230.1, moeda: "USD", variacao_pct: 1.5, valor_mercado: 3500, bolsa: "NASDAQ", tamanho: 3500 }],
      IBOV: [{ ticker: "PETR4", nome: "Petrobras PN", setor: "Petróleo", ultimo: 38.2, moeda: "BRL", variacao_pct: 0, valor_mercado: 500, bolsa: "BMFBOVESPA", tamanho: 7 }],
    });
  });

  test("ação do Ibovespa sem peso fica com tamanho nulo", () => {
    const cot = { "PETR4-BR": { code: 0, last: "38", change_pct: "1" } };
    assert.equal(montarMapas(MAPAS, SUF, cot, {}).IBOV[0].tamanho, null);
  });
});

describe("montarAgenda", () => {
  const eventos = [
    { date: "2026-11-12T10:30:00-05:00", country: "USD", title: "CPI m/m", impact: "High", forecast: "0.3%", previous: "0.4%" },
    { date: "2026-11-12T04:00:00-05:00", country: "EUR", title: "ECB Speech", impact: "Medium" },
    { date: "2026-11-12T08:00:00-05:00", country: "XYZ", title: "Minor", impact: "Low" },
    { date: "2026-11-13T08:30:00-05:00", country: "USD", title: "Retail Sales", impact: "High" },
    { date: "2026-11-12T09:00:00-05:00", country: "JPY", title: "Bank Holiday", impact: "Holiday" },
  ];
  const r = montarAgenda(eventos, { hoje: "2026-11-12", paises: { USD: "EUA", EUR: "Zona do Euro" } });

  test("hoje: eventos do dia em ordem, sem os de baixa importância", () => {
    assert.deepEqual(r.hoje.map((e) => [e.hora, e.pais, e.evento, e.importancia]), [
      ["06:00", "Zona do Euro", "ECB Speech", "media"],
      ["11:00", "JPY", "Bank Holiday", "feriado"],
      ["12:30", "EUA", "CPI m/m", "alta"],
    ]);
  });

  test("semana: só os eventos de alta importância", () => {
    assert.deepEqual(r.semana.map((e) => [e.data, e.evento]), [["2026-11-12", "CPI m/m"], ["2026-11-13", "Retail Sales"]]);
  });

  test("preenche campos ausentes com texto vazio", () => {
    const ecb = r.hoje[0];
    assert.equal(ecb.moeda, "EUR");
    assert.deepEqual([ecb.previsao, ecb.anterior, ecb.atual], ["", "", ""]);
    assert.deepEqual([r.semana[0].previsao, r.semana[0].anterior], ["0.3%", "0.4%"]);
  });
});

describe("precisaResumo", () => {
  const base = { temChave: true, forcar: false, agora: AGORA, primeiraHora: 6, ultimaHora: 20, intervaloMin: 60 };

  test("sem chave da API nunca gera, mesmo forçado", () => {
    assert.equal(precisaResumo(null, { ...base, temChave: false, forcar: true }), false);
  });

  test("forçado gera mesmo fora do horário e com resumo recente", () => {
    assert.equal(precisaResumo({ gerado_em: horasAtras(0.1) }, { ...base, forcar: true, agora: new Date("2026-11-12T06:00:00Z") }), true);
  });

  test("fora da janela de horário não gera", () => {
    assert.equal(precisaResumo(null, { ...base, agora: new Date("2026-11-12T08:59:00Z") }), false); // 05:59
    assert.equal(precisaResumo(null, { ...base, agora: new Date("2026-11-13T00:00:00Z") }), false); // 21:00
    assert.equal(precisaResumo(null, { ...base, agora: new Date("2026-11-12T23:59:00Z") }), true); // 20:59
  });

  test("sem resumo anterior ou resumo de outro dia, gera", () => {
    assert.equal(precisaResumo(null, base), true);
    assert.equal(precisaResumo({}, base), true);
    assert.equal(precisaResumo({ gerado_em: "2026-11-12T02:00:00Z" }, base), true); // 23h do dia 11
  });

  test("respeita o intervalo mínimo entre resumos", () => {
    assert.equal(precisaResumo({ gerado_em: horasAtras(0.5) }, base), false);
    assert.equal(precisaResumo({ gerado_em: horasAtras(1) }, base), true);
    assert.equal(precisaResumo({ gerado_em: horasAtras(0.5) }, { ...base, intervaloMin: 30 }), true);
  });
});

describe("pedido ao Claude", () => {
  test("fmtAtivo mostra % ou bps com sinal", () => {
    assert.equal(fmtAtivo({ nome: "Ibovespa", ultimo: 130000, variacao_pct: 1.2, variacao_bps: null }), "Ibovespa: 130000 (+1.2%)");
    assert.equal(fmtAtivo({ nome: "DXY", ultimo: 104, variacao_pct: -0.3, variacao_bps: null }), "DXY: 104 (-0.3%)");
    assert.equal(fmtAtivo({ nome: "EUA 10 anos", ultimo: 4.2, variacao_pct: null, variacao_bps: 0 }), "EUA 10 anos: 4.2 (+0 bps)");
  });

  test("montarPedido agrupa cotações, numera notícias e avisa quando não há agenda", () => {
    const pedido = montarPedido({
      agora: AGORA,
      itens: [{ publicado: "2026-11-12T12:15:00Z", fonte: "CNBC", titulo: "Fed fala" }],
      cotacoes: { ativos: [
        { grupo: "EUA", nome: "S&P 500", ultimo: 6000, variacao_pct: 1, variacao_bps: null },
        { grupo: "Juros", nome: "EUA 10 anos", ultimo: 4.2, variacao_pct: null, variacao_bps: -2 },
      ] },
      agenda: { hoje: [] },
    });
    assert.match(pedido, /^Agora são 10:30 de 2026-11-12/);
    assert.match(pedido, /## EUA\nS&P 500: 6000 \(\+1%\)\n\n## Juros\nEUA 10 anos: 4\.2 \(-2 bps\)/);
    assert.match(pedido, /\(sem eventos relevantes no calendário internacional hoje\)/);
    assert.match(pedido, /\[0\] \(09:15, CNBC\) Fed fala/);
  });

  test("montarPedido lista eventos da agenda com traço nos campos vazios", () => {
    const pedido = montarPedido({
      agora: AGORA, itens: [], cotacoes: { ativos: [] },
      agenda: { hoje: [{ hora: "12:30", pais: "EUA", evento: "CPI", importancia: "alta", previsao: "0.3%", anterior: "", atual: "" }] },
    });
    assert.match(pedido, /12:30 \| EUA \| CPI \| importância alta \| previsão 0\.3% \| anterior - \| atual -/);
  });

  test("vincularNoticias troca o id pelos dados da notícia e descarta ids inválidos", () => {
    const itens = [{ link: "https://a", fonte: "A", publicado: "p0" }, { link: "https://b", fonte: "B", publicado: "p1" }];
    const r = vincularNoticias([
      { id: 1, titulo_pt: "B", impacto: "alto", comentario: "c" },
      { id: 9, titulo_pt: "X", impacto: "medio", comentario: "c" },
    ], itens);
    assert.deepEqual(r, [{ titulo_pt: "B", impacto: "alto", comentario: "c", link: "https://b", fonte: "B", publicado: "p1" }]);
  });
});
