// Múltiplos de mercado (#51): o preço do pregão combinado com os fundamentos dos 12 meses.
// Lógica pura: sem disco, sem rede e sem relógio (a data de hoje entra como argumento).
//
// O fundamento é coletado uma vez por semana e o preço, uma vez por dia; os dois se encontram aqui,
// na hora de montar o site. Entram:
//   - os fundamentos dos 12 meses (saída de calcularIndicadoresDaSerie, de indicadores.mjs);
//   - a composição do capital, em unidades de ação e separada em ordinárias e preferenciais;
//   - as cotações, no formato do contrato de precos/fonte.mjs:
//     { coletadoEm, fonte, precos: { TICKER: { preco em R$, dataHora do último negócio } } }.
//     Este módulo não sabe de onde o preço vem.
//
// Este módulo só faz contas e mostra a regra de cada uma. Não classifica o resultado nem diz o que
// fazer com ele.
import { adaptarPeriodo, lucroDaControladora } from "./indicadores.mjs";

const ok = (valor) => ({ valor, motivo: null });
const nulo = (motivo) => ({ valor: null, motivo });

// Cotação com mais dias úteis do que isto, entre o pregão e a data em que o site é montado, sai marcada
// como desatualizada. Por que 5: uma semana de pregões. Cobre um feriado prolongado e um fim de semana
// sem marcar nada, e acusa quando a coleta diária parou de funcionar. A regra de atraso do Diário
// (site/atraso.js) não serve aqui: ela conta minutos dentro da janela de execução do workflow, e o
// preço dos múltiplos é o de fechamento, um por dia.
export const LIMITE_DIAS_UTEIS_COTACAO = 5;

// Lista, na ordem de exibição. Valor de mercado e EV em R$ mil, como os fundamentos; o resto é razão.
export const MULTIPLOS = [
  {
    id: "valorMercado", nome: "Valor de mercado", unidade: "R$ mil",
    formula: "Soma, classe por classe, das ações em circulação (total menos tesouraria) vezes o último preço do ticker da classe: ordinárias pelo ticker de final 3 e preferenciais pelo de final 4, 5 ou 6. A unit não entra, para não contar a mesma ação duas vezes. Classe sem cotação usa o preço da outra classe, e o resultado sai marcado como aproximado",
  },
  {
    id: "pl", nome: "P/L", unidade: "razão",
    formula: "Valor de mercado ÷ lucro líquido da controladora em 12 meses (DRE, conta 3.11.01). O lucro dos não controladores fica de fora porque o valor de mercado é só das ações da controladora. Com lucro zero ou negativo, não se aplica",
  },
  {
    id: "pvpa", nome: "P/VPA", unidade: "razão",
    formula: "Valor de mercado ÷ patrimônio líquido da controladora (conta 2.03 menos a participação dos não controladores, 2.03.09). Os não controladores saem porque essa parte do patrimônio não pertence a quem tem a ação da companhia. Com patrimônio zero ou negativo, não se aplica",
  },
  {
    id: "ev", nome: "Valor da firma (EV)", unidade: "R$ mil",
    formula: "Valor de mercado + dívida líquida (sem arrendamentos) + participação dos não controladores (2.03.09). Os não controladores entram porque o EBITDA consolidado inclui 100% das controladas, inclusive a parte que é deles",
  },
  {
    id: "evEbitda", nome: "EV/EBITDA", unidade: "razão",
    formula: "EV ÷ EBITDA dos 12 meses. O EV soma os não controladores para ficar na mesma base do EBITDA consolidado. Com EBITDA ou EV zero ou negativo, não se aplica",
  },
  {
    id: "precoEbit", nome: "Preço/EBIT", unidade: "razão",
    formula: "Valor de mercado ÷ EBIT dos 12 meses (DRE, conta 3.05). Com EBIT zero ou negativo, não se aplica",
  },
  {
    id: "earningsYield", nome: "Earnings yield", unidade: "razão",
    formula: "Lucro líquido da controladora em 12 meses ÷ valor de mercado. É o inverso do P/L, mas continua saindo quando o lucro é negativo (e sai negativo)",
  },
  {
    id: "dividendYield", nome: "Dividend yield", unidade: "razão",
    formula: "Proventos pagos aos acionistas da companhia em 12 meses (dividendos e juros sobre o capital próprio da DFC) ÷ valor de mercado. Usa o que saiu do caixa no período, não o que foi anunciado",
  },
  {
    id: "precoSobreFcl", nome: "Preço/FCL", unidade: "razão",
    formula: "Valor de mercado ÷ fluxo de caixa livre dos 12 meses (FCO − capex). Com FCL zero ou negativo, não se aplica",
  },
  {
    id: "precoSobreFclAposArrendamentos", nome: "Preço/FCL depois dos arrendamentos", unidade: "razão",
    formula: "Valor de mercado ÷ FCL depois dos arrendamentos dos 12 meses (FCO − capex − pagamentos de arrendamento). Com FCL zero ou negativo, não se aplica",
  },
];

// ---------- datas ----------

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const emDias = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400e3);

// Dias úteis (segunda a sexta) depois de `de` até `ate`, inclusive: de sexta para segunda dá 1.
// Feriados não são descontados (o limite tem folga para isso). Datas "AAAA-MM-DD". Devolve null se
// alguma data for inválida, e 0 se `ate` não for depois de `de`.
export function diasUteisEntre(de, ate) {
  if (!DATA_ISO.test(String(de)) || !DATA_ISO.test(String(ate))) return null;
  const a = emDias(de);
  const b = emDias(ate);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  let uteis = 0;
  for (let d = a + 1; d <= b; d++) {
    const diaDaSemana = (((d + 4) % 7) + 7) % 7; // 01/01/1970 foi quinta-feira (4); 0 = domingo
    if (diaDaSemana !== 0 && diaDaSemana !== 6) uteis++;
  }
  return uteis;
}

// Dia ("AAAA-MM-DD") de uma `dataHora` do contrato de preço, no fuso em que ela veio escrita.
export const diaDaCotacao = (dataHora) => (/^\d{4}-\d{2}-\d{2}/.test(String(dataHora ?? "")) ? String(dataHora).slice(0, 10) : null);

// A cotação está desatualizada? `dataPregao` e `hoje` em "AAAA-MM-DD".
// Devolve { desatualizado, diasUteis }. Sem a data do pregão ou sem a de hoje, não dá para saber: null.
export function atrasoDaCotacao(dataPregao, hoje, limite = LIMITE_DIAS_UTEIS_COTACAO) {
  const diasUteis = diasUteisEntre(dataPregao, hoje);
  return { desatualizado: diasUteis == null ? null : diasUteis > limite, diasUteis };
}

// ---------- tickers e classes ----------

const FINAL_ON = ["3"];
const FINAL_PN = ["4", "5", "6"]; // PN, PNA e PNB; outras classes só entram se estiverem no universo (AXIA7)
const OUTRAS_PN = ["7", "8"]; // PNC e PND
const FINAL_UNIT = "11";
const raiz = (ticker) => String(ticker).slice(0, 4);
const final = (ticker) => String(ticker).slice(4);

// Tickers de cada classe de uma companhia. `tickers` é a lista do universo: [{ ticker, ibovespa }].
// As classes são procuradas pela raiz de quatro letras, e não só na lista: a Klabin está no universo
// só pela unit (KLBN11), mas o valor de mercado dela sai de KLBN3 e KLBN4.
// Devolve { on: [...], pn: [...], units: [...] }, cada lista em ordem de preferência:
//   1º o ticker que está no Ibovespa, 2º os outros do universo, 3º os montados pela raiz, do final menor para o maior.
export function tickersDasClasses(tickers) {
  const lista = (tickers ?? []).map((t) => (typeof t === "string" ? { ticker: t, ibovespa: false } : t));
  const raizes = [...new Set(lista.map((t) => raiz(t.ticker)))];
  const daClasse = (finais, outros = []) => {
    const doUniversoComOutroFinal = lista.map((t) => t.ticker).filter((t) => outros.includes(final(t)));
    const montados = [...new Set([...raizes.flatMap((r) => finais.map((f) => r + f)), ...doUniversoComOutroFinal])];
    const peso = (ticker) => {
      const doUniverso = lista.find((t) => t.ticker === ticker);
      return doUniverso?.ibovespa ? 0 : doUniverso ? 1 : 2;
    };
    return montados.map((ticker, i) => ({ ticker, i })).sort((a, b) => peso(a.ticker) - peso(b.ticker) || a.i - b.i).map((x) => x.ticker);
  };
  return { on: daClasse(FINAL_ON), pn: daClasse(FINAL_PN, OUTRAS_PN), units: raizes.map((r) => r + FINAL_UNIT) };
}

// Cotação de um ticker, { preco, dataHora }, ou null quando não há ou não serve.
const cotacaoDe = (precos, ticker) => {
  const c = precos?.[ticker];
  return c != null && typeof c.preco === "number" && Number.isFinite(c.preco) && c.preco > 0 ? c : null;
};
const precoDe = (precos, ticker) => cotacaoDe(precos, ticker)?.preco ?? null;

// ---------- valor de mercado ----------

// Valor de mercado da companhia, em R$ mil.
//   composicao  composição do capital em unidades de ação, com `classes` (ver composicao-capital.mjs)
//   motivoComposicao  por que a composição não veio (ex.: diverge do documento anterior), quando há
//   tickers     tickers da companhia no universo: [{ ticker, ibovespa }]
//   precos      { TICKER: { preco em R$, dataHora do último negócio } }
// Devolve { valor, motivo, aproximado, classes: [{ classe, acoes, ticker, preco, dataHora, aproximado, origem }] }.
//   - Cada classe com ações em circulação é multiplicada pelo preço do primeiro ticker dela que tem cotação.
//   - Classe sem cotação usa o preço da outra classe: `aproximado: true`, e a `origem` diz qual preço entrou.
//   - Nenhuma classe com cotação: null. A unit nunca entra na conta.
export function valorDeMercado({ composicao, motivoComposicao, tickers, precos }) {
  const vazio = (motivo) => ({ ...nulo(motivo), aproximado: false, classes: [] });
  if (composicao == null) return vazio(motivoComposicao ?? "falta a composição do capital");
  if (composicao.classes == null) return vazio("a composição do capital não separa ordinárias e preferenciais");
  const candidatos = tickersDasClasses(tickers);
  const classes = [["on", "ordinárias"], ["pn", "preferenciais"]].map(([classe, rotulo]) => {
    const acoes = composicao.classes[classe]?.circulacao ?? null;
    const ticker = candidatos[classe].find((t) => precoDe(precos, t) != null) ?? null;
    return {
      classe, rotulo, acoes, ticker, preco: ticker ? precoDe(precos, ticker) : null, dataHora: ticker ? cotacaoDe(precos, ticker).dataHora ?? null : null,
      aproximado: false, origem: ticker ? `preço de ${ticker}` : null,
    };
  });
  const semNumero = classes.find((k) => k.acoes == null);
  if (semNumero) return vazio(`a composição do capital não informa o número de ações ${semNumero.rotulo}`);
  const comAcoes = classes.filter((k) => k.acoes > 0);
  if (comAcoes.length === 0) return vazio("a composição do capital não tem ações em circulação");
  const comPreco = comAcoes.filter((k) => k.preco != null);
  if (comPreco.length === 0) {
    const procurados = comAcoes.flatMap((k) => candidatos[k.classe]).join(", ");
    return vazio(`sem cotação para nenhuma classe de ação${procurados ? ` (procurados: ${procurados})` : ""}`);
  }
  for (const k of comAcoes) {
    if (k.preco != null) continue;
    const outra = comPreco[0];
    k.ticker = outra.ticker;
    k.preco = outra.preco;
    k.dataHora = outra.dataHora;
    k.aproximado = true;
    k.origem = `sem cotação das ${k.rotulo}; usado o preço de ${outra.ticker} (${outra.rotulo})`;
  }
  const valor = comAcoes.reduce((soma, k) => soma + (k.acoes * k.preco) / 1000, 0);
  return {
    ...ok(valor),
    aproximado: comAcoes.some((k) => k.aproximado),
    classes: comAcoes.map(({ classe, acoes, ticker, preco, dataHora, aproximado, origem }) => ({ classe, acoes, ticker, preco, dataHora, aproximado, origem })),
  };
}

// ---------- fundamentos ----------

// O que os múltiplos usam de um período de uma companhia, cada item como { valor, motivo }, em R$ mil.
//   periodo      a base de 12 meses (series.doze, saída de montarSeries); um exercício da série anual
//                também serve, para conferir a conta com um ano fechado
//   indicadores  os indicadores do mesmo período (calcularIndicadoresDaSerie(...).doze.indicadores)
// Com o período indisponível, tudo fica null com o motivo da série, inclusive o que é de balanço.
export function fundamentosParaMultiplos(periodo, indicadores) {
  const p = adaptarPeriodo(periodo);
  const itens = ["lucroControladora", "plControladora", "naoControladores", "ebitda", "ebit", "dividaLiquida", "proventosPagos", "fcl", "fclAposArrendamentos"];
  if (p.tipo === "indisponivel") return Object.fromEntries(itens.map((id) => [id, nulo(p.motivo)]));
  const de = (id) => indicadores?.[id] ?? nulo(`falta o indicador ${id}`);
  const pl = p.estoque("2.03");
  // Sem a conta 2.03.09 o balanço é o individual, que não tem não controladores: conta como zero.
  const naoControladores = p.estoque("2.03.09") ?? 0;
  return {
    lucroControladora: lucroDaControladora(p),
    plControladora: pl == null ? nulo("falta a conta 2.03 (patrimônio líquido)") : ok(pl - naoControladores),
    naoControladores: ok(naoControladores),
    ebitda: de("ebitda"),
    ebit: de("ebit"),
    dividaLiquida: de("dividaLiquida"),
    proventosPagos: de("proventosPagos"),
    fcl: de("fcl"),
    fclAposArrendamentos: de("fclAposArrendamentos"),
  };
}

// ---------- múltiplos ----------

// Múltiplos de uma companhia.
//   fundamentos  saída de fundamentosParaMultiplos
//   composicao   composição do capital, em unidades de ação (a dos 12 meses)
//   tickers      tickers da companhia no universo
//   cotacoes     o arquivo de cotações coletado: { coletadoEm, fonte, precos }
//   hoje         "AAAA-MM-DD" do dia em que o site é montado, para a marca de desatualizado
// Devolve { dataPregao, desatualizado, diasUteis, aproximado, fonte, valorMercado, multiplos }:
//   dataPregao    dia do preço usado; com mais de uma classe, o do preço mais antigo
//   valorMercado  a saída de valorDeMercado (com as classes e de onde veio cada preço)
//   multiplos     { [id]: { valor, motivo } }, um item para cada id de MULTIPLOS
// Cotação desatualizada não apaga nada: os múltiplos saem, e quem mostra põe a data do pregão ao lado.
export function calcularMultiplos({ fundamentos, composicao, motivoComposicao, tickers, cotacoes, hoje }) {
  const vm = cotacoes?.precos == null
    ? { ...nulo("sem arquivo de cotações"), aproximado: false, classes: [] }
    : valorDeMercado({ composicao, motivoComposicao, tickers, precos: cotacoes.precos });
  const mercado = { valor: vm.valor, motivo: vm.motivo };
  const f = (id) => fundamentos?.[id] ?? nulo("sem os fundamentos dos 12 meses");

  // valor de mercado ÷ denominador; denominador zero ou negativo "não se aplica".
  const precoSobre = (denominador, rotulo) => {
    if (denominador.valor == null) return nulo(denominador.motivo);
    if (mercado.valor == null) return nulo(mercado.motivo);
    if (denominador.valor <= 0) return nulo(`não se aplica: ${rotulo} zero ou negativo`);
    return ok(mercado.valor / denominador.valor);
  };
  // numerador ÷ valor de mercado; o numerador pode ser negativo.
  const sobrePreco = (numerador) => {
    if (numerador.valor == null) return nulo(numerador.motivo);
    if (mercado.valor == null) return nulo(mercado.motivo);
    return ok(numerador.valor / mercado.valor);
  };
  const partesDoEv = [f("dividaLiquida"), f("naoControladores"), mercado];
  const semParte = partesDoEv.find((x) => x.valor == null);
  const ev = semParte ? nulo(semParte.motivo) : ok(mercado.valor + f("dividaLiquida").valor + f("naoControladores").valor);
  const evEbitda = () => {
    const ebitda = f("ebitda");
    if (ebitda.valor == null) return nulo(ebitda.motivo);
    if (ev.valor == null) return nulo(ev.motivo);
    if (ebitda.valor <= 0) return nulo("não se aplica: EBITDA zero ou negativo");
    if (ev.valor <= 0) return nulo("não se aplica: EV zero ou negativo (o caixa líquido é maior que o valor de mercado)");
    return ok(ev.valor / ebitda.valor);
  };

  const multiplos = {
    valorMercado: mercado,
    pl: precoSobre(f("lucroControladora"), "lucro"),
    pvpa: precoSobre(f("plControladora"), "patrimônio líquido"),
    ev,
    evEbitda: evEbitda(),
    precoEbit: precoSobre(f("ebit"), "EBIT"),
    earningsYield: sobrePreco(f("lucroControladora")),
    dividendYield: sobrePreco(f("proventosPagos")),
    precoSobreFcl: precoSobre(f("fcl"), "FCL"),
    precoSobreFclAposArrendamentos: precoSobre(f("fclAposArrendamentos"), "FCL"),
  };
  const dias = vm.classes.map((k) => diaDaCotacao(k.dataHora));
  const dataPregao = dias.length === 0 || dias.includes(null) ? null : [...dias].sort()[0];
  return { dataPregao, ...atrasoDaCotacao(dataPregao, hoje), aproximado: vm.aproximado, fonte: cotacoes?.fonte ?? null, valorMercado: vm, multiplos };
}
