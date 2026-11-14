// Comparação com o setor (#39): onde a companhia está em relação à mediana das outras do mesmo setor.
// Lógica pura: recebe todas as fichas e devolve, para cada uma, a posição em cada indicador.
//
// O texto é neutro: "acima da mediana" não é elogio nem crítica (vale para margem e para dívida).
// Regras:
//   - Período: o mesmo exercício anual para todas as companhias do setor, que é o último exercício
//     que a maioria do setor já entregou. Quem não tem esse exercício sai da mediana do setor. Os 12
//     meses ficam de fora, porque as datas dos ITR variam de companhia para companhia.
//   - Mediana só com 3 ou mais companhias com dado naquele indicador e naquele exercício.
//   - Empate com a mediana: a companhia fica "na mediana".
import { percentual, vezes } from "./formatar.mjs";
import { rotuloDoAno } from "./consistencia.mjs";

export const MINIMO_DE_EMPRESAS = 3;

// Os indicadores comparados: poucos, e não os 45. `de` diz de onde sai o valor de cada companhia:
// do exercício escolhido ("indicador") ou da consistência da série ("consistencia").
export const INDICADORES_DE_PARES = [
  { id: "margemLiquida", nome: "Margem líquida", formato: "pct", de: "indicador" },
  { id: "roic", nome: "ROIC", formato: "pct", de: "indicador" },
  { id: "roe", nome: "ROE", formato: "pct", de: "indicador" },
  { id: "dividaLiquidaSobreEbitda", nome: "Dívida líquida ÷ EBITDA", formato: "vezes", de: "indicador" },
  { id: "fcoSobreEbitda", nome: "FCO ÷ EBITDA", formato: "pct", de: "indicador" },
  { id: "capexSobreFco", nome: "Capex ÷ FCO", formato: "pct", de: "indicador" },
  { id: "crescimentoReceita5", nome: "Crescimento da receita em 5 anos (ao ano)", formato: "pct", de: "consistencia" },
  { id: "anosComLucro", nome: "Anos com lucro (parte da série)", formato: "pct", de: "consistencia" },
];

const temValor = (v) => typeof v === "number" && Number.isFinite(v);
const escrever = (valor, formato) => (formato === "vezes" ? vezes(valor) : percentual(valor));

// Mediana de uma lista de números (a média dos dois do meio, quando a lista é par).
export function mediana(valores) {
  const v = [...valores].sort((a, b) => a - b);
  if (v.length === 0) return null;
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

// Quartil por interpolação linear (o mesmo método do Excel): p = 0,25 ou 0,75.
export function quartil(valores, p) {
  const v = [...valores].sort((a, b) => a - b);
  if (v.length === 0) return null;
  const pos = (v.length - 1) * p;
  const base = Math.floor(pos);
  return v[base] + (v[Math.min(base + 1, v.length - 1)] - v[base]) * (pos - base);
}

// Posição de um valor na amostra: { posicao, faixa }.
//   posicao  "acima da mediana", "abaixo da mediana" ou "na mediana"
//   faixa    o quartil por extenso
export function posicaoNaAmostra(valor, valores) {
  const m = mediana(valores);
  const q1 = quartil(valores, 0.25);
  const q3 = quartil(valores, 0.75);
  if (valor === m) return { posicao: "na mediana", faixa: "no meio do setor" };
  if (valor > m) return { posicao: "acima da mediana", faixa: valor >= q3 ? "entre os 25% maiores do setor" : "na metade de cima do setor, fora dos 25% maiores" };
  return { posicao: "abaixo da mediana", faixa: valor <= q1 ? "entre os 25% menores do setor" : "na metade de baixo do setor, fora dos 25% menores" };
}

// O exercício de comparação de um setor: o mais recente que a maioria (mais da metade) das companhias
// do setor tem na série anual de 12 meses. Devolve o `fim` ("2025-12-31") ou null.
export function exercicioDoSetor(fichas) {
  const contagem = new Map();
  for (const f of fichas) for (const p of f.anual ?? []) if (p.tipo === "anual") contagem.set(p.fim, (contagem.get(p.fim) ?? 0) + 1);
  const comMaioria = [...contagem.entries()].filter(([, n]) => n > fichas.length / 2).map(([fim]) => fim).sort();
  return comMaioria.at(-1) ?? null;
}

// Valor de um indicador de pares para uma ficha, no exercício do setor. null quando não há.
function valorDaFicha(ficha, indicador, exercicio) {
  const periodo = (ficha.anual ?? []).find((p) => p.fim === exercicio && p.tipo === "anual");
  if (!periodo) return null;
  if (indicador.de === "indicador") {
    const v = periodo.indicadores?.[indicador.id]?.valor;
    return temValor(v) ? v : null;
  }
  // As métricas de consistência só valem se a série da companhia termina no exercício do setor.
  const c = ficha.consistencia;
  if (!c || c.periodo?.fim !== exercicio) return null;
  if (indicador.id === "crescimentoReceita5") {
    const v = c.crescimento?.find((x) => x.id === "receita" && x.anos === 5)?.valor;
    return temValor(v) ? v : null;
  }
  if (indicador.id === "anosComLucro") {
    const a = c.anosComLucro;
    return temValor(a?.valor) && a.total > 0 ? a.valor / a.total : null;
  }
  return null;
}

// Comparação de cada ficha com o setor dela.
//   fichas  { TICKER: ficha } (com `setor`, `anual` e `consistencia`)
// Devolve { TICKER: { setor, exercicio, empresas, tickers, itens: [...] } }, com um item por indicador:
//   { id, nome, valor, mediana, empresas, tickers, posicao, faixa, conta, motivo }
// Sem mediana (menos de 3 companhias com dado) ou sem o valor da companhia, `posicao` é null e
// `motivo` diz por quê.
export function calcularPares(fichas) {
  const porSetor = new Map();
  for (const ficha of Object.values(fichas)) {
    const setor = ficha.setor ?? "Outros";
    if (!porSetor.has(setor)) porSetor.set(setor, []);
    porSetor.get(setor).push(ficha);
  }
  const resultado = {};
  for (const [setor, doSetor] of porSetor) {
    const exercicio = exercicioDoSetor(doSetor);
    const comExercicio = exercicio ? doSetor.filter((f) => (f.anual ?? []).some((p) => p.fim === exercicio && p.tipo === "anual")) : [];
    const tickersDoSetor = comExercicio.map((f) => f.ticker).sort();
    const amostras = INDICADORES_DE_PARES.map((indicador) => {
      const dados = comExercicio.map((f) => ({ ticker: f.ticker, v: valorDaFicha(f, indicador, exercicio) })).filter((x) => x.v != null);
      return { indicador, dados };
    });
    for (const ficha of doSetor) {
      const temExercicio = comExercicio.includes(ficha);
      const itens = amostras.map(({ indicador, dados }) => {
        const base = { id: indicador.id, nome: indicador.nome, formato: indicador.formato };
        const valor = temExercicio ? valorDaFicha(ficha, indicador, exercicio) : null;
        const tickers = dados.map((x) => x.ticker).sort();
        if (dados.length < MINIMO_DE_EMPRESAS) {
          return { ...base, valor, mediana: null, empresas: dados.length, tickers, posicao: null, faixa: null, conta: null, motivo: "setor com menos de 3 empresas com dado" };
        }
        const valores = dados.map((x) => x.v);
        const m = mediana(valores);
        const amostra = `mediana de ${dados.length} empresas (${setor})`;
        if (valor == null) {
          const motivo = !temExercicio ? `a companhia não tem o exercício de ${rotuloDoAno(exercicio)}` : "a companhia não tem esse dado no exercício";
          return { ...base, valor: null, mediana: m, empresas: dados.length, tickers, posicao: null, faixa: null, conta: `${amostra}: ${escrever(m, indicador.formato)}`, motivo };
        }
        const { posicao, faixa } = posicaoNaAmostra(valor, valores);
        return {
          ...base, valor, mediana: m, empresas: dados.length, tickers, posicao, faixa, motivo: null,
          conta: `${escrever(valor, indicador.formato)}, ${posicao} (${escrever(m, indicador.formato)}); ${faixa}; ${amostra}`,
        };
      });
      resultado[ficha.ticker] = { setor, exercicio, empresas: comExercicio.length, tickers: tickersDoSetor, temExercicio, itens };
    }
  }
  return resultado;
}
