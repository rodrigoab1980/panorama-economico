// Rankings por indicador (#67): em cada critério, a lista dos maiores e a dos menores valores.
// Lógica pura: recebe as fichas que o build já monta (scripts/cvm/ficha.mjs, com `consistencia`,
// `atencao` e `anual`) e devolve as listas. Sem disco, sem rede e sem relógio. O HTML fica em
// rankings-html.mjs.
//
// Não há nota única, soma de critérios nem lista de "ações": cada critério é uma ordenação simples
// de um número que já está na ficha. As palavras são neutras ("maiores", "menores", "posição").
//
// Regras gerais:
//   - Exercício de referência: o último exercício anual de 12 meses que a maioria das companhias já
//     entregou (o mesmo critério da comparação com o setor, aplicado ao universo inteiro). Os 12
//     meses ficam de fora, porque as datas dos ITR variam de companhia para companhia.
//   - Quem não tem o dado do critério fica fora daquele ranking, com o motivo. null nunca é zero.
//   - Os critérios de consistência exigem SERIE_MINIMA exercícios; abaixo disso, "série curta".
//   - Os múltiplos de preço não entram, de propósito: ordenar companhias pelo preço da ação se lê
//     como recomendação.
//   - A mesma companhia nunca aparece nos maiores e nos menores do mesmo critério.
import { rotuloDoAno, serieCurta } from "./consistencia.mjs";
import { exercicioDoSetor } from "./pares.mjs";
import { nomeCurto } from "./painel.mjs";
import { percentual, vezes } from "./formatar.mjs";

// Quantas companhias em cada lista.
export const TAMANHO_DA_LISTA = 10;
// Mínimo de exercícios com dado para os critérios de consistência.
export const SERIE_MINIMA = 5;
// Prazo do crescimento anual composto, em anos.
export const PRAZO_DO_CRESCIMENTO = 5;

export const GRUPOS = [
  { id: "consistencia", titulo: "Consistência" },
  { id: "crescimento", titulo: "Crescimento" },
  { id: "rentabilidade", titulo: "Rentabilidade" },
  { id: "caixa", titulo: "Caixa" },
  { id: "divida", titulo: "Dívida" },
  { id: "atencao", titulo: "Atenção" },
];

export const MOTIVO_EBITDA = "EBITDA negativo ou zero";

const temValor = (v) => typeof v === "number" && Number.isFinite(v);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const porTicker = (a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
const fora = (motivo) => ({ valor: null, motivo });
const intervalo = (a, b) => (a === b ? rotuloDoAno(a) : `${rotuloDoAno(a)}–${rotuloDoAno(b)}`);

// Como cada valor é escrito: como na ficha, mais os dois formatos de contagem.
export function escrever(valor, formato, total = null) {
  if (formato === "pct") return percentual(valor);
  if (formato === "vezes") return vezes(valor);
  if (formato === "anos") return plural(valor, "ano", "anos");
  if (formato === "regras") return `${valor} de ${total}`;
  throw new Error(`formato desconhecido: ${formato}`);
}

// ---------- o valor de cada companhia em cada critério ----------

// Parte dos anos com o indicador acima de zero: anos positivos ÷ anos com dado.
function parteDosAnos(metrica) {
  if (!temValor(metrica?.valor) || !(metrica.total > 0)) return fora(metrica?.motivo ?? "nenhum ano com dado");
  if (metrica.total < SERIE_MINIMA) return fora(serieCurta(metrica.total));
  return { valor: metrica.valor / metrica.total, detalhe: `${metrica.valor} de ${metrica.total}`, periodo: intervalo(metrica.inicio, metrica.fim) };
}

function sequencia(ficha) {
  const c = ficha.consistencia;
  const s = c?.sequenciaComLucro;
  if (!temValor(s?.valor)) return fora(s?.motivo ?? "nenhum ano com dado");
  const anos = c.periodo?.anos ?? 0;
  if (anos < SERIE_MINIMA) return fora(serieCurta(anos));
  return { valor: s.valor, detalhe: s.inicio ? intervalo(s.inicio, s.fim) : `em ${plural(anos, "ano", "anos")}`, periodo: intervalo(c.periodo.inicio, c.periodo.fim) };
}

// O período do exercício de referência na série anual da companhia, ou null.
const periodoDe = (ficha, exercicio) => (exercicio ? (ficha.anual ?? []).find((p) => p.fim === exercicio && p.tipo === "anual") ?? null : null);
const semExercicio = (exercicio) => (exercicio ? `sem o exercício de ${rotuloDoAno(exercicio)}` : "sem exercício de referência");

// Crescimento anual composto em 5 anos, até o exercício de referência. Só vale se a série da
// companhia termina nesse exercício: a conta da consistência usa sempre o último exercício da série.
function crescimento(id) {
  return (ficha, exercicio) => {
    if (!periodoDe(ficha, exercicio)) return fora(semExercicio(exercicio));
    const c = ficha.consistencia;
    if (c?.periodo?.fim !== exercicio) return fora(c?.periodo?.fim ? `a série usada nas contas termina em ${rotuloDoAno(c.periodo.fim)}` : "sem série anual");
    const item = c.crescimento?.find((x) => x.id === id && x.anos === PRAZO_DO_CRESCIMENTO);
    if (!temValor(item?.valor)) return fora(item?.motivo ?? "crescimento não calculado");
    return { valor: item.valor, detalhe: intervalo(item.inicio, item.fim) };
  };
}

// O motivo de um indicador sem valor, com o do EBITDA sempre escrito do mesmo jeito.
const motivoDoIndicador = (r) => (/EBITDA zero ou negativo/i.test(r?.motivo ?? "") ? MOTIVO_EBITDA : r?.motivo ?? "sem dado no exercício");

// Indicador do exercício de referência, como está na ficha.
function doExercicio(id) {
  return (ficha, exercicio) => {
    const periodo = periodoDe(ficha, exercicio);
    if (!periodo) return fora(semExercicio(exercicio));
    const r = periodo.indicadores?.[id];
    if (!temValor(r?.valor)) return fora(motivoDoIndicador(r));
    return { valor: r.valor, detalhe: null };
  };
}

// Dívida líquida ÷ EBITDA, na base sem arrendamentos (a da ficha). Caixa líquido dá valor negativo
// e fica na ponta dos menores. Com EBITDA zero ou negativo a razão não diz nada: fica fora.
function dividaSobreEbitda(ficha, exercicio) {
  const periodo = periodoDe(ficha, exercicio);
  if (!periodo) return fora(semExercicio(exercicio));
  const ebitda = periodo.indicadores?.ebitda?.valor;
  if (temValor(ebitda) && ebitda <= 0) return fora(MOTIVO_EBITDA);
  const r = periodo.indicadores?.dividaLiquidaSobreEbitda;
  if (!temValor(r?.valor)) return fora(motivoDoIndicador(r));
  return { valor: r.valor, detalhe: null };
}

function pontosDeAtencao(ficha) {
  const a = ficha.atencao;
  if (!a || !temValor(a.acionadas)) return fora("pontos de atenção não calculados");
  return { valor: a.acionadas, detalhe: a.naoAvaliadas ? plural(a.naoAvaliadas, "não avaliada", "não avaliadas") : null, total: a.total };
}

// Os critérios, na ordem da página.
//   regra     a regra de cálculo, em uma linha, que a página mostra
//   periodo   "serie" (a série inteira de cada companhia), "cinco" (5 anos até o exercício de
//             referência), "exercicio" (o exercício de referência) ou "atencao" (as regras da ficha)
//   valor     (ficha, exercicio) → { valor, detalhe } ou { valor: null, motivo }
//   empate    (valor) → o texto do empate em massa, quando o critério tem uma frase melhor que a geral
export const CRITERIOS = [
  {
    id: "anos-com-lucro", grupo: "consistencia", titulo: "Parte dos anos com lucro", formato: "pct", periodo: "serie",
    regra: `Anos com lucro líquido acima de zero ÷ anos com dado, na série inteira da companhia. Só entra quem tem ${SERIE_MINIMA} ou mais exercícios com dado.`,
    valor: (ficha) => parteDosAnos(ficha.consistencia?.anosComLucro),
    empate: (v) => (v === 1 ? "com lucro em todos os exercícios da série" : v === 0 ? "sem lucro em nenhum exercício da série" : null),
  },
  {
    id: "sequencia-com-lucro", grupo: "consistencia", titulo: "Maior sequência de anos com lucro", formato: "anos", periodo: "serie",
    regra: `Maior número de exercícios seguidos com lucro líquido acima de zero; ano sem dado quebra a sequência. Só entra quem tem ${SERIE_MINIMA} ou mais exercícios na série.`,
    valor: sequencia,
    empate: (v) => (v > 0 ? `com lucro em ${plural(v, "exercício seguido", "exercícios seguidos")}` : "sem nenhum exercício com lucro"),
  },
  {
    id: "anos-com-fcl-positivo", grupo: "consistencia", titulo: "Parte dos anos com FCL positivo", formato: "pct", periodo: "serie",
    regra: `Anos com fluxo de caixa livre (FCO − capex) acima de zero ÷ anos com dado, na série inteira da companhia. Só entra quem tem ${SERIE_MINIMA} ou mais exercícios com dado.`,
    valor: (ficha) => parteDosAnos(ficha.consistencia?.anosComFclPositivo),
    empate: (v) => (v === 1 ? "com FCL positivo em todos os exercícios da série" : v === 0 ? "sem FCL positivo em nenhum exercício da série" : null),
  },
  {
    id: "crescimento-da-receita", grupo: "crescimento", titulo: "Crescimento da receita em 5 anos", formato: "pct", periodo: "cinco",
    regra: "Crescimento anual composto da receita líquida: (receita do exercício de referência ÷ receita de 5 anos antes)^(1/5) − 1. Fica fora quem tem receita zero, negativa ou sem dado numa das pontas.",
    valor: crescimento("receita"),
  },
  {
    id: "crescimento-do-lucro", grupo: "crescimento", titulo: "Crescimento do lucro em 5 anos", formato: "pct", periodo: "cinco",
    regra: "Crescimento anual composto do lucro líquido: (lucro do exercício de referência ÷ lucro de 5 anos antes)^(1/5) − 1. Fica fora quem tem lucro zero, prejuízo ou sem dado numa das pontas.",
    valor: crescimento("lucroLiquido"),
  },
  {
    id: "roic", grupo: "rentabilidade", titulo: "ROIC", formato: "pct", periodo: "exercicio",
    regra: "EBIT × (1 − 34%) ÷ capital investido no fim do exercício (patrimônio líquido + dívida bruta − caixa).",
    valor: doExercicio("roic"),
  },
  {
    id: "roe", grupo: "rentabilidade", titulo: "ROE", formato: "pct", periodo: "exercicio",
    regra: "Lucro líquido ÷ patrimônio líquido no fim do exercício, os dois com minoritários.",
    valor: doExercicio("roe"),
  },
  {
    id: "margem-liquida", grupo: "rentabilidade", titulo: "Margem líquida", formato: "pct", periodo: "exercicio",
    regra: "Lucro líquido ÷ receita líquida do exercício.",
    valor: doExercicio("margemLiquida"),
  },
  {
    id: "fco-sobre-ebitda", grupo: "caixa", titulo: "FCO ÷ EBITDA", formato: "pct", periodo: "exercicio",
    regra: "Fluxo de caixa das operações ÷ EBITDA do exercício: quanto do EBITDA virou caixa.",
    valor: doExercicio("fcoSobreEbitda"),
  },
  {
    id: "divida-liquida-sobre-ebitda", grupo: "divida", titulo: "Dívida líquida ÷ EBITDA", formato: "vezes", periodo: "exercicio",
    regra: "Dívida líquida no fim do exercício ÷ EBITDA do exercício, sem os arrendamentos. Valor negativo é caixa maior que a dívida. Com EBITDA negativo ou zero, a companhia fica fora.",
    valor: dividaSobreEbitda,
  },
  {
    id: "pontos-de-atencao", grupo: "atencao", titulo: "Pontos de atenção acionados", formato: "regras", periodo: "atencao",
    regra: "Quantas das sete regras de pontos de atenção da ficha a companhia aciona hoje. Regra não avaliada não conta como acionada.",
    valor: pontosDeAtencao,
    empate: (v) => (v === 0 ? "sem nenhum ponto de atenção acionado" : null),
  },
];

// ---------- ordenação ----------

// O exercício de referência do universo: o mais recente que a maioria das fichas tem.
export const exercicioDeReferencia = (fichas) => exercicioDoSetor(fichas);

// As duas pontas de um critério.
//   dados    [{ ticker, valor, ... }], só de quem tem valor
//   tamanho  quantas companhias em cada lista
// Devolve { maiores, menores }, cada um:
//   { tipo: "lista", itens: [{ posicao, ...dado }], noCorte }   noCorte: quantas companhias fora da
//                                                              lista têm o mesmo valor do último item
//   { tipo: "massa", valor, quantidade, itens: [dado] }        mais de `tamanho` empatadas na ponta
// Regras:
//   - Empate recebe a mesma posição (1º, 2º, 2º, 4º); o desempate de exibição é por ticker.
//   - Empate em massa: se mais de `tamanho` companhias empatam na ponta, a lista vira o grupo
//     inteiro, numa linha só. A outra ponta continua normal, com quem sobrou.
//   - Universo pequeno (menos de 2 × tamanho): divide ao meio, sem repetir ninguém. Com número
//     ímpar, a do meio fica nos maiores.
export function pontas(dados, tamanho = TAMANHO_DA_LISTA) {
  const vazia = { tipo: "lista", itens: [], noCorte: 0 };
  if (dados.length === 0) return { maiores: vazia, menores: vazia };
  const desc = [...dados].sort((a, b) => b.valor - a.valor || porTicker(a, b));
  const max = desc[0].valor;
  const min = desc.at(-1).valor;
  const topo = desc.filter((d) => d.valor === max);
  const base = max === min ? [] : desc.filter((d) => d.valor === min);
  const massaNoTopo = topo.length > tamanho;
  const massaNaBase = base.length > tamanho;
  const meio = desc.filter((d) => !(massaNoTopo && d.valor === max) && !(massaNaBase && d.valor === min));
  const nMaiores = massaNoTopo ? 0 : Math.min(tamanho, massaNaBase ? meio.length : Math.ceil(meio.length / 2));
  const nMenores = massaNaBase ? 0 : Math.min(tamanho, meio.length - nMaiores);

  const massa = (grupo) => ({ tipo: "massa", valor: grupo[0].valor, quantidade: grupo.length, itens: grupo });
  const lista = (itens, posicao) => {
    const dentro = new Set(itens.map((d) => d.ticker));
    const corte = itens.at(-1)?.valor;
    return {
      tipo: "lista",
      itens: itens.map((d) => ({ posicao: posicao(d.valor), ...d })),
      noCorte: itens.length ? dados.filter((d) => d.valor === corte && !dentro.has(d.ticker)).length : 0,
    };
  };
  // Os menores saem de quem não entrou nos maiores: num empate que atravessa as duas pontas, ninguém se repete.
  const asc = meio.slice(nMaiores).sort((a, b) => a.valor - b.valor || porTicker(a, b));
  return {
    maiores: massaNoTopo ? massa(topo) : lista(meio.slice(0, nMaiores), (v) => 1 + dados.filter((d) => d.valor > v).length),
    menores: massaNaBase ? massa(base) : lista(asc.slice(0, nMenores), (v) => 1 + dados.filter((d) => d.valor < v).length),
  };
}

// O ranking de um critério: as duas pontas e quem ficou fora, com o motivo.
export function rankingDoCriterio(criterio, fichas, exercicio, tamanho = TAMANHO_DA_LISTA) {
  const dados = [];
  const semDado = [];
  for (const ficha of fichas) {
    const r = criterio.valor(ficha, exercicio);
    if (temValor(r.valor)) {
      dados.push({
        ticker: ficha.ticker, nome: nomeCurto(ficha.nome), valor: r.valor,
        texto: escrever(r.valor, criterio.formato, r.total), detalhe: r.detalhe ?? null, total: r.total ?? null,
      });
    } else semDado.push({ ticker: ficha.ticker, motivo: r.motivo ?? "sem dado" });
  }
  const { maiores, menores } = pontas(dados, tamanho);
  const comFrase = (ponta) => (ponta.tipo === "massa"
    ? { ...ponta, texto: escrever(ponta.valor, criterio.formato, ponta.itens[0].total), frase: criterio.empate?.(ponta.valor) ?? null }
    : ponta);
  return {
    id: criterio.id, grupo: criterio.grupo, titulo: criterio.titulo, regra: criterio.regra, formato: criterio.formato,
    periodo: textoDoPeriodo(criterio.periodo, exercicio),
    empresas: dados.length,
    maiores: comFrase(maiores),
    menores: comFrase(menores),
    fora: semDado.sort(porTicker),
  };
}

// O período de cada critério, por extenso.
export function textoDoPeriodo(periodo, exercicio) {
  const ano = exercicio ? rotuloDoAno(exercicio) : null;
  if (periodo === "serie") return "série inteira de cada companhia";
  if (periodo === "atencao") return "regras da ficha, com os 12 meses mais recentes e os últimos exercícios";
  if (!ano) return "sem exercício de referência";
  if (periodo === "cinco") return `${PRAZO_DO_CRESCIMENTO} anos até o exercício de ${ano} (${Number(exercicio.slice(0, 4)) - PRAZO_DO_CRESCIMENTO} a ${exercicio.slice(0, 4)})`;
  return `exercício de ${ano}`;
}

// Todos os rankings.
//   fichas  { TICKER: ficha } ou [ficha]
// Devolve null sem fichas, ou:
//   { exercicio, rotuloDoExercicio, empresas, comExercicio, semExercicio: [ticker], tamanho, serieMinima,
//     grupos: [{ id, titulo }], criterios: [rankingDoCriterio] }
export function montarRankings(fichas, { tamanho = TAMANHO_DA_LISTA } = {}) {
  const lista = (Array.isArray(fichas) ? fichas : Object.values(fichas ?? {})).filter((f) => f?.ticker);
  if (lista.length === 0) return null;
  const exercicio = exercicioDeReferencia(lista);
  const semExercicioDeReferencia = lista.filter((f) => !periodoDe(f, exercicio)).map((f) => f.ticker).sort();
  const criterios = CRITERIOS.map((c) => rankingDoCriterio(c, lista, exercicio, tamanho));
  return {
    exercicio,
    rotuloDoExercicio: exercicio ? rotuloDoAno(exercicio) : null,
    empresas: lista.length,
    comExercicio: lista.length - semExercicioDeReferencia.length,
    semExercicio: semExercicioDeReferencia,
    tamanho,
    serieMinima: SERIE_MINIMA,
    grupos: GRUPOS.filter((g) => criterios.some((c) => c.grupo === g.id)),
    criterios,
  };
}
