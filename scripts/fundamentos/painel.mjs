// Painel da página inicial dos fundamentos (#66): o que está acontecendo nas companhias na temporada
// atual. Lógica pura: recebe as fichas (scripts/cvm/ficha.mjs) e devolve os blocos, só com números e
// fatos. Sem disco, sem rede e sem relógio. O HTML fica em painel-html.mjs.
//
// A comparação é a do acumulado do ano: do início do exercício até a data do documento, contra o
// mesmo período do ano anterior, como entregue à CVM. Não há ajuste de não recorrentes.
//
// Regras gerais:
//   - Período de referência: o `dtRefer` mais recente entre os documentos das companhias. Quem tem o
//     documento mais recente anterior a esse "ainda não entregou" e fica fora de todas as comparações.
//   - Atual e anterior na mesma base (consolidado ou individual). Se a base não for a mesma, a
//     companhia fica fora da comparação, e o painel diz quantas ficaram e por quê. É a regra dos 12 meses.
//   - null nunca conta como 0: quem não tem o número sai do denominador daquele número.
//   - Lucro igual a zero não é lucro: fica do lado do prejuízo, como na régua de anos.
//   - Nenhuma palavra de julgamento: "maior", "menor", "altas" e "quedas".
import { serieCurta } from "./consistencia.mjs";

// Lucro anterior abaixo disto (em R$ mil, como vem da CVM) fica fora do percentual: R$ 50 milhões.
export const LIMITE_DA_BASE = 50_000;
// Quantas companhias em cada lista de variação.
export const TAMANHO_DA_LISTA = 5;
// Setor com menos empresas na comparação do que isto não tem soma nem barra.
export const MINIMO_POR_SETOR = 3;

const temValor = (v) => typeof v === "number" && Number.isFinite(v);
const dataBr = (iso) => String(iso).split("-").reverse().join("/");
const porTicker = (a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
const base = (consolidado) => (consolidado ? "consolidado" : "individual");

// Nome curto da companhia, para as listas: sem "S.A." e o que vem depois.
export const nomeCurto = (nome) => String(nome ?? "").replace(/\s*[-–]?\s*\bS\.?\s?\/?A\.?(?![\wÀ-ÿ]).*$/i, "").trim() || String(nome ?? "");

// O período de referência da temporada: o documento mais recente entre as fichas.
// Devolve { dtRefer, tipo ("itr" | "dfp"), nome, documento }, ou null sem nenhum documento.
//   nome       "3T26" (1T, 2T ou 3T, pelo mês do ITR) ou "Exercício de 2026" (DFP)
//   documento  "ITR de 30/09/2026" ou "DFP de 31/12/2026"
export function referenciaDaTemporada(fichas) {
  let ref = null;
  for (const f of fichas) {
    const d = f?.documentoMaisRecente;
    if (!d?.dtRefer) continue;
    // Na mesma data, a DFP vale mais que o ITR.
    if (!ref || d.dtRefer > ref.dtRefer || (d.dtRefer === ref.dtRefer && d.tipo === "dfp" && ref.tipo !== "dfp")) ref = { dtRefer: d.dtRefer, tipo: d.tipo };
  }
  if (!ref) return null;
  const [ano, mes] = ref.dtRefer.split("-");
  const trimestre = Number(mes) % 3 === 0 && Number(mes) < 12 ? `${Number(mes) / 3}T${ano.slice(2)}` : null;
  return {
    ...ref,
    nome: ref.tipo === "dfp" ? `Exercício de ${ano}` : trimestre ?? `ITR de ${dataBr(ref.dtRefer)}`,
    documento: `${ref.tipo === "dfp" ? "DFP" : "ITR"} de ${dataBr(ref.dtRefer)}`,
  };
}

const entregou = (ficha, ref) => ficha?.documentoMaisRecente?.dtRefer === ref.dtRefer && ficha.documentoMaisRecente.tipo === ref.tipo;

// Os dois períodos da comparação de uma companhia que já entregou o documento de referência.
// Devolve { atual: { receita, lucro }, anterior: { receita, lucro }, motivo }: sem comparação, os dois
// lados são null e `motivo` diz por quê.
export function comparacaoDaCompanhia(ficha, ref) {
  const fora = (motivo) => ({ atual: null, anterior: null, motivo });
  let atual;
  let anterior;
  if (ref.tipo === "dfp") {
    // Exercício fechado: o ano contra o ano anterior, os dois de 12 meses.
    const anual = ficha.anual ?? [];
    const a = anual.at(-1);
    const b = anual.at(-2);
    if (a?.fim !== ref.dtRefer) return fora(`sem o exercício de ${dataBr(ref.dtRefer)} na série`);
    if (a.tipo !== "anual") return fora(`exercício de ${a.meses ?? "?"} meses`);
    if (!b) return fora(serieCurta(anual.length));
    if (b.tipo !== "anual" || Number(b.fim.slice(0, 4)) !== Number(a.fim.slice(0, 4)) - 1) return fora("o exercício anterior não é de 12 meses seguidos ao atual");
    const lado = (p) => ({ consolidado: p.origem?.consolidado ?? null, receita: p.indicadores?.receita?.valor ?? null, lucro: p.indicadores?.lucroLiquido?.valor ?? null });
    atual = lado(a);
    anterior = lado(b);
  } else {
    const ac = ficha.doze?.acumulado;
    if (!ac?.atual || !ac?.anterior || ac.atual.dtRefer !== ref.dtRefer) return fora(ficha.doze?.motivo ?? "sem o acumulado do mesmo período do ano anterior");
    const lado = (p) => ({ consolidado: p.consolidado ?? null, receita: p.receita ?? null, lucro: p.lucroLiquido ?? null });
    atual = lado(ac.atual);
    anterior = lado(ac.anterior);
  }
  if (atual.consolidado !== anterior.consolidado) return fora(`base diferente: o período atual é ${base(atual.consolidado)} e o anterior é ${base(anterior.consolidado)}`);
  // Demonstração zerada num dos períodos: não é resultado zero, é falta de dado.
  for (const [nome, p] of [["atual", atual], ["anterior", anterior]]) {
    if (!temValor(p.lucro) || (p.lucro === 0 && !p.receita)) return fora(`sem lucro informado no período ${nome}`);
  }
  const limpo = (p) => ({ receita: temValor(p.receita) ? p.receita : null, lucro: p.lucro });
  return { atual: limpo(atual), anterior: limpo(anterior), motivo: null };
}

const margem = (p) => (temValor(p.receita) && p.receita > 0 ? p.lucro / p.receita : null);

// Os quatro números da temporada, cada um com o seu denominador: { valor, total }.
// Empate (igual ao ano anterior) entra no denominador e não entra no numerador.
export function numerosDaTemporada(comparadas) {
  const contar = (elegivel, conta) => { const e = comparadas.filter(elegivel); return { valor: e.filter(conta).length, total: e.length }; };
  const temReceita = (c) => c.atual.receita != null && c.anterior.receita != null;
  const temMargem = (c) => margem(c.atual) != null && margem(c.anterior) != null;
  return {
    lucroMaior: contar(() => true, (c) => c.atual.lucro > c.anterior.lucro),
    receitaMaior: contar(temReceita, (c) => c.atual.receita > c.anterior.receita),
    margemMaior: contar(temMargem, (c) => margem(c.atual) > margem(c.anterior)),
    prejuizo: contar(() => true, (c) => c.atual.lucro < 0),
  };
}

// Maiores variações do lucro no acumulado.
//   altas, quedas     até `tamanho` itens: { ticker, nome, nomeCurto, variacao, atual, anterior }
//   viraramLucro      de prejuízo (ou zero) a lucro, sem percentual
//   viraramPrejuizo   de lucro a prejuízo (ou zero), sem percentual
//   prejuizoNosDois   prejuízo (ou zero) nos dois períodos
//   baseBaixa         lucro nos dois, mas o anterior abaixo do limite: fora do percentual
//   elegiveis         quantas têm percentual (lucro nos dois e base no limite ou acima)
// A variação percentual só existe quando os dois lucros são positivos.
export function variacoesDoLucro(comparadas, { limite = LIMITE_DA_BASE, tamanho = TAMANHO_DA_LISTA } = {}) {
  const item = (c) => ({ ticker: c.ticker, nome: c.nome, nomeCurto: nomeCurto(c.nome), atual: c.atual.lucro, anterior: c.anterior.lucro });
  const grupos = { percentual: [], viraramLucro: [], viraramPrejuizo: [], prejuizoNosDois: [], baseBaixa: [] };
  for (const c of [...comparadas].sort(porTicker)) {
    const a = c.atual.lucro > 0;
    const b = c.anterior.lucro > 0;
    if (a && b && c.anterior.lucro >= limite) grupos.percentual.push({ ...item(c), variacao: c.atual.lucro / c.anterior.lucro - 1 });
    else if (a && b) grupos.baseBaixa.push(item(c));
    else if (a) grupos.viraramLucro.push(item(c));
    else if (b) grupos.viraramPrejuizo.push(item(c));
    else grupos.prejuizoNosDois.push(item(c));
  }
  // Empate na variação: ordem do ticker (a lista já vem por ticker, e o sort é estável).
  const altas = grupos.percentual.filter((x) => x.variacao > 0).sort((x, y) => y.variacao - x.variacao).slice(0, tamanho);
  const quedas = grupos.percentual.filter((x) => x.variacao < 0).sort((x, y) => x.variacao - y.variacao).slice(0, tamanho);
  return {
    limite, tamanho, elegiveis: grupos.percentual.length, altas, quedas,
    viraramLucro: grupos.viraramLucro, viraramPrejuizo: grupos.viraramPrejuizo, prejuizoNosDois: grupos.prejuizoNosDois, baseBaixa: grupos.baseBaixa,
  };
}

// Lucro somado por setor, do acumulado das companhias com comparação.
// Devolve [{ setor, empresas, tickers, poucas, atual, anterior, variacao, viraramLucro, viraramPrejuizo }],
// em ordem alfabética.
//   - Setor com menos de `minimo` empresas na comparação fica com `poucas: true` e sem soma.
//   - `viraramLucro` e `viraramPrejuizo` são os tickers que mudaram de sinal entre os dois períodos
//     (lucro igual a zero fica do lado do prejuízo).
//   - `variacao` só existe quando nenhuma companhia do setor mudou de sinal e as duas somas são
//     positivas. Uma companhia que sai de um prejuízo grande deixa a soma anterior pequena, e o
//     percentual sobre ela não diz nada (ex.: +2.776%). Sem variação, a página mostra só as duas somas.
export function lucroPorSetor(comparadas, { minimo = MINIMO_POR_SETOR } = {}) {
  const porSetor = new Map();
  for (const c of [...comparadas].sort(porTicker)) {
    const setor = c.setor ?? "Outros";
    if (!porSetor.has(setor)) porSetor.set(setor, []);
    porSetor.get(setor).push(c);
  }
  return [...porSetor.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([setor, lista]) => {
    const comum = { setor, empresas: lista.length, tickers: lista.map((c) => c.ticker) };
    if (lista.length < minimo) return { ...comum, poucas: true, atual: null, anterior: null, variacao: null, viraramLucro: [], viraramPrejuizo: [] };
    const atual = lista.reduce((s, c) => s + c.atual.lucro, 0);
    const anterior = lista.reduce((s, c) => s + c.anterior.lucro, 0);
    const viraramLucro = lista.filter((c) => c.atual.lucro > 0 && !(c.anterior.lucro > 0)).map((c) => c.ticker);
    const viraramPrejuizo = lista.filter((c) => !(c.atual.lucro > 0) && c.anterior.lucro > 0).map((c) => c.ticker);
    const comPercentual = viraramLucro.length === 0 && viraramPrejuizo.length === 0 && anterior > 0 && atual > 0;
    return { ...comum, poucas: false, atual, anterior, variacao: comPercentual ? atual / anterior - 1 : null, viraramLucro, viraramPrejuizo };
  });
}

// Pontos de atenção em todas as fichas: quantas companhias acionam cada regra, da mais acionada para
// a menos (no empate, a ordem das regras na ficha).
// Devolve [{ id, titulo, limite, acionadas, tickers, naoAvaliadas }].
export function atencaoNasFichas(fichas) {
  const regras = new Map();
  for (const f of [...fichas].sort(porTicker)) {
    for (const r of f.atencao?.regras ?? []) {
      if (!regras.has(r.id)) regras.set(r.id, { id: r.id, titulo: r.titulo, limite: r.limite, acionadas: 0, tickers: [], naoAvaliadas: 0 });
      const regra = regras.get(r.id);
      if (r.acionada === true) { regra.acionadas++; regra.tickers.push(f.ticker); }
      else if (r.acionada === null) regra.naoAvaliadas++;
    }
  }
  return [...regras.values()].sort((a, b) => b.acionadas - a.acionadas);
}

// A data de entrega mais recente entre os documentos usados nas fichas ("AAAA-MM-DD"), ou null.
export function entregueAte(fichas) {
  let ultima = null;
  for (const f of fichas) {
    for (const d of [...(f.doze?.origem ?? []), f.anual?.at(-1)?.origem]) {
      const dia = d?.recebidoEm ? String(d.recebidoEm).slice(0, 10) : null;
      if (dia && (!ultima || dia > ultima)) ultima = dia;
    }
  }
  return ultima;
}

// O painel inteiro.
//   fichas  { TICKER: ficha } ou [ficha]
//   total   quantas companhias a página acompanha (as sem ficha contam como "ainda não entregou");
//           sem ele, vale o número de fichas
// Devolve null sem nenhum documento. Senão:
//   { referencia, entregueAte, total, entregaram, comparadas, semComparacao: [{ ticker, motivo }],
//     numeros, variacoes, setores, atencao, fichas (quantas entraram nos pontos de atenção), minimoPorSetor }
export function montarPainel(fichas, { total = null, limite = LIMITE_DA_BASE, tamanho = TAMANHO_DA_LISTA, minimo = MINIMO_POR_SETOR } = {}) {
  const lista = (Array.isArray(fichas) ? fichas : Object.values(fichas ?? {})).filter(Boolean);
  const referencia = referenciaDaTemporada(lista);
  if (!referencia) return null;
  const entregaram = lista.filter((f) => entregou(f, referencia)).sort(porTicker);
  const comparadas = [];
  const semComparacao = [];
  for (const f of entregaram) {
    const c = comparacaoDaCompanhia(f, referencia);
    if (c.motivo) semComparacao.push({ ticker: f.ticker, motivo: c.motivo });
    else comparadas.push({ ticker: f.ticker, nome: f.nome, setor: f.setor ?? null, atual: c.atual, anterior: c.anterior });
  }
  return {
    referencia,
    entregueAte: entregueAte(lista),
    total: Math.max(total ?? 0, lista.length),
    entregaram: entregaram.length,
    comparadas: comparadas.length,
    semComparacao,
    numeros: numerosDaTemporada(comparadas),
    variacoes: variacoesDoLucro(comparadas, { limite, tamanho }),
    setores: lucroPorSetor(comparadas, { minimo }),
    atencao: atencaoNasFichas(lista),
    fichas: lista.length,
    minimoPorSetor: minimo,
  };
}
