// Indicadores de resultado e de retorno de UM período: um item da série anual ou a base de 12 meses,
// os dois na forma que sai de montarSeries (scripts/cvm/series.mjs).
// Lógica pura: sem disco, sem rede e sem relógio.
//
// Regras (briefing da #34, resumidas no README, seção "Indicadores fundamentalistas"):
// 1. Valores em R$ mil inteiros, como na série. Razões em fração (0,365), sem arredondar.
// 2. ROE, ROA e ROIC usam o saldo do fim do período, não a média.
// 3. Ausência é null com motivo. Nunca 0 no lugar de "não deu".
// 4. Período de transição (menos de 12 meses) tem fluxos e margens, mas não tem retorno: nada é anualizado.
// 5. Nada aqui usa 3.99 (lucro por ação).

import { valorDaConta } from "./series.mjs";

// Alíquota nominal de IR + CSLL usada no ROIC. É fixa de propósito: a efetiva oscila com JCP,
// incentivos e prejuízo fiscal, e deixaria o ROIC instável sem motivo operacional.
export const ALIQUOTA_ROIC = 0.34;

// Nome de cada conta usada, para o motivo de um null.
const CONTAS = {
  "3.01": "receita líquida",
  "3.03": "lucro bruto",
  "3.05": "EBIT",
  "3.06": "resultado financeiro",
  "3.11": "lucro líquido",
  "7.04.01": "depreciação e amortização, na DVA",
  "1": "ativo total",
  "1.01.01": "caixa e equivalentes",
  "1.01.02": "aplicações financeiras",
  "2.01.04": "empréstimos e financiamentos de curto prazo",
  "2.02.01": "empréstimos e financiamentos de longo prazo",
  "2.03": "patrimônio líquido",
};

export const INDICADORES = [
  { id: "receita", nome: "Receita líquida", unidade: "R$ mil", formula: "Receita líquida de vendas e serviços (DRE, conta 3.01)" },
  { id: "lucroBruto", nome: "Lucro bruto", unidade: "R$ mil", formula: "Lucro bruto, como a companhia informa (DRE, conta 3.03)" },
  { id: "margemBruta", nome: "Margem bruta", unidade: "razão", formula: "Lucro bruto ÷ receita líquida" },
  { id: "ebit", nome: "EBIT", unidade: "R$ mil", formula: "Resultado antes do resultado financeiro e dos tributos (DRE, conta 3.05)" },
  { id: "da", nome: "Depreciação e amortização", unidade: "R$ mil", formula: "Depreciação, amortização e exaustão da DVA (conta 7.04.01), com o sinal trocado" },
  { id: "ebitda", nome: "EBITDA", unidade: "R$ mil", formula: "EBIT + depreciação e amortização" },
  { id: "margemEbitda", nome: "Margem EBITDA", unidade: "razão", formula: "EBITDA ÷ receita líquida" },
  { id: "resultadoFinanceiro", nome: "Resultado financeiro", unidade: "R$ mil", formula: "Receitas financeiras menos despesas financeiras (DRE, conta 3.06)" },
  { id: "lucroLiquido", nome: "Lucro líquido", unidade: "R$ mil", formula: "Lucro líquido consolidado do período, com a parte dos minoritários (DRE, conta 3.11)" },
  { id: "margemLiquida", nome: "Margem líquida", unidade: "razão", formula: "Lucro líquido ÷ receita líquida" },
  { id: "roe", nome: "ROE", unidade: "razão", formula: "Lucro líquido ÷ patrimônio líquido no fim do período, os dois com minoritários" },
  { id: "roa", nome: "ROA", unidade: "razão", formula: "Lucro líquido ÷ ativo total no fim do período" },
  {
    id: "roic", nome: "ROIC", unidade: "razão",
    formula: "EBIT × (1 − 34%) ÷ capital investido no fim do período. Capital investido = patrimônio líquido + empréstimos e financiamentos − caixa e aplicações financeiras. Os 34% são a alíquota nominal de IR e CSLL; os arrendamentos não entram na dívida",
  },
];

const ok = (valor) => ({ valor, motivo: null });
const nulo = (motivo) => ({ valor: null, motivo });

// Demonstrativo de cada conta na série anual, pelo primeiro dígito do código.
const DEMONSTRATIVO = { 1: "BPA", 2: "BPP", 3: "DRE", 6: "DFC", 7: "DVA" };

// Adaptador: a mesma leitura para um período da série anual e para a base de 12 meses.
// Devolve { tipo, meses, motivo, fluxo(conta), estoque(conta) }:
//   tipo "anual"         exercício de cerca de 12 meses
//   tipo "transicao"     exercício com outra duração (`meses` diz quantos)
//   tipo "12-meses"      base de 12 meses (pelo ITR ou ano fechado); o balanço é o da data mais recente
//   tipo "indisponivel"  não há o que calcular; `motivo` diz por quê
// fluxo() e estoque() devolvem o valor em R$ mil, ou null quando a conta não está no período.
export function adaptarPeriodo(origem) {
  if (origem == null) return { tipo: "indisponivel", meses: null, motivo: "sem dados do período", fluxo: () => null, estoque: () => null };
  if (typeof origem.fluxo === "function" && typeof origem.estoque === "function") return origem; // já adaptado

  // Base de 12 meses (saída de base12Meses).
  if ("fluxos" in origem) {
    if (origem.tipo === "indisponivel" || origem.fluxos == null) {
      return { tipo: "indisponivel", meses: null, motivo: origem.motivo ?? "base de 12 meses indisponível", fluxo: () => null, estoque: () => null };
    }
    return {
      tipo: "12-meses", meses: 12, motivo: null,
      fluxo: (conta) => origem.fluxos[conta]?.valor ?? null,
      estoque: (conta) => origem.estoques?.contas[conta]?.valor ?? null,
    };
  }

  // Período da série anual (item de serieAnual).
  const ler = (conta) => valorDaConta(origem.demonstrativos?.[DEMONSTRATIVO[conta[0]]], conta);
  if (origem.tipo !== "anual" && origem.tipo !== "transicao") {
    return { tipo: "indisponivel", meses: null, motivo: "o período não tem DRE, DFC nem DVA", fluxo: () => null, estoque: () => null };
  }
  return { tipo: origem.tipo, meses: origem.meses, motivo: null, fluxo: ler, estoque: ler };
}

const fluxo = (p, conta) => {
  const v = p.fluxo(conta);
  return v == null ? nulo(`falta a conta ${conta} (${CONTAS[conta]})`) : ok(v);
};
const estoque = (p, conta) => {
  const v = p.estoque(conta);
  return v == null ? nulo(`falta a conta ${conta} (${CONTAS[conta]})`) : ok(v);
};

// Aplica `conta` aos valores das partes. Se alguma parte é null, o resultado é null com o motivo dela.
function combinar(partes, conta) {
  const ruim = partes.find((x) => x.valor == null);
  return ruim ? nulo(ruim.motivo) : ok(conta(...partes.map((x) => x.valor)));
}

// numerador ÷ denominador, só com denominador positivo.
function dividir(numerador, denominador, motivoDoDenominador) {
  if (numerador.valor == null) return nulo(numerador.motivo);
  if (denominador.valor == null) return nulo(denominador.motivo);
  if (denominador.valor <= 0) return nulo(motivoDoDenominador);
  return ok(numerador.valor / denominador.valor);
}

// Caixa = caixa e equivalentes (1.01.01) + aplicações financeiras (1.01.02), no fim do período.
export function caixa(periodo) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return nulo(p.motivo);
  return combinar([estoque(p, "1.01.01"), estoque(p, "1.01.02")], (a, b) => a + b);
}

// Dívida bruta = empréstimos e financiamentos de curto (2.01.04) e de longo prazo (2.02.01), no fim do período.
// Não inclui arrendamentos (IFRS 16): a versão com arrendamentos é da #35.
export function dividaBruta(periodo) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return nulo(p.motivo);
  return combinar([estoque(p, "2.01.04"), estoque(p, "2.02.01")], (a, b) => a + b);
}

// Capital investido = patrimônio líquido + dívida bruta − caixa, no fim do período.
export function capitalInvestido(periodo) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return nulo(p.motivo);
  return combinar([estoque(p, "2.03"), dividaBruta(p), caixa(p)], (pl, divida, cx) => pl + divida - cx);
}

// Indicadores de um período. Devolve { [id]: { valor, motivo } }, com um item para cada id de INDICADORES.
export function calcularIndicadores(periodo) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return Object.fromEntries(INDICADORES.map(({ id }) => [id, nulo(p.motivo)]));

  const receita = fluxo(p, "3.01");
  const lucroBruto = fluxo(p, "3.03");
  const ebit = fluxo(p, "3.05");
  // A DVA traz a depreciação negativa. O sinal é só trocado: sem Math.abs, para um valor positivo
  // na origem aparecer como D&A negativa, e não ser escondido.
  const da = combinar([fluxo(p, "7.04.01")], (v) => 0 - v);
  const ebitda = combinar([ebit, da], (a, b) => a + b);
  const resultadoFinanceiro = fluxo(p, "3.06");
  const lucroLiquido = fluxo(p, "3.11");

  const margem = (numerador) => dividir(numerador, receita, "receita zero ou negativa");
  // Retorno só com 12 meses de resultado: não anualiza período de transição.
  const retorno = (numerador, denominador, motivo) =>
    (p.tipo === "transicao" ? nulo(`período de ${p.meses} meses, retorno não anualizado`) : dividir(numerador, denominador, motivo));

  return {
    receita,
    lucroBruto,
    margemBruta: margem(lucroBruto),
    ebit,
    da,
    ebitda,
    margemEbitda: margem(ebitda),
    resultadoFinanceiro,
    lucroLiquido,
    margemLiquida: margem(lucroLiquido),
    roe: retorno(lucroLiquido, estoque(p, "2.03"), "patrimônio líquido zero ou negativo"),
    roa: retorno(lucroLiquido, estoque(p, "1"), "ativo total zero ou negativo"),
    roic: retorno(combinar([ebit], (v) => v * (1 - ALIQUOTA_ROIC)), capitalInvestido(p), "capital investido zero ou negativo"),
  };
}
