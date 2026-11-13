// Indicadores de UM período: um item da série anual ou a base de 12 meses, os dois na forma que sai
// de montarSeries (scripts/cvm/series.mjs). Resultado e retorno (#34); caixa, dívida e liquidez (#35).
// Lógica pura: sem disco, sem rede e sem relógio.
//
// Regras (briefings da #34 e da #35, resumidas no README, seção "Indicadores fundamentalistas"):
// 1. Valores em R$ mil inteiros, como na série. Razões em fração (0,365), sem arredondar.
// 2. ROE, ROA e ROIC usam o saldo do fim do período, não a média.
// 3. Ausência é null com motivo. Nunca 0 no lugar de "não deu".
// 4. Período de transição (menos de 12 meses) tem fluxos, margens e saldos, mas não tem retorno nem as
//    razões que misturam fluxo com saldo: nada é anualizado.
// 5. Nada aqui usa 3.99 (lucro por ação).
// 6. A dívida bruta é sem arrendamentos (IFRS 16). Os arrendamentos saem à parte, e há sempre as duas versões.
// 7. Dívida líquida negativa (caixa líquido) é valor válido, não null.

import { valorDaConta } from "./series.mjs";

// Alíquota nominal de IR + CSLL usada no ROIC. É fixa de propósito: a efetiva oscila com JCP,
// incentivos e prejuízo fiscal, e deixaria o ROIC instável sem motivo operacional.
export const ALIQUOTA_ROIC = 0.34;

// Onde procurar o passivo de arrendamento (IFRS 16).
//   fixas:     "Financiamento por Arrendamento", dentro de Empréstimos e Financiamentos (curto e longo prazo).
//              Quem lança ali tem o arrendamento DENTRO da 2.01.04 e da 2.02.01: por isso a dívida bruta subtrai as duas.
//   grupos:    "Outras Obrigações" de curto e de longo prazo. Ali a companhia cria subcontas sem código
//              fixo, e só a descrição diz o que são.
//   descricao: a subconta entra quando a descrição bate com esta expressão.
//   excecoes:  descrições que batem com `descricao` mas não são passivo de arrendamento. Vazia hoje: na
//              varredura das 64 companhias da página (DFP de 2025) nenhuma descrição que bate ficou de fora.
//              "Aluguéis" (aluguel a pagar) não bate com a expressão e, por isso, já não entra.
export const ARRENDAMENTOS = {
  fixas: ["2.01.04.03", "2.02.01.03"],
  grupos: ["2.01.05", "2.02.02"],
  descricao: /arrendament/i,
  excecoes: [],
};

// Dívida financeira lançada fora de Empréstimos e Financiamentos (caso da Allos, que registra
// "Empréstimos, financiamentos e debêntures" em Outras Obrigações e deixa a 2.01.04 e a 2.02.01 zeradas).
//   grupos:    "Outras Obrigações"; o de curto prazo soma na dívida de curto prazo e o de longo, na de longo.
//   descricao: a subconta não fixa entra quando a descrição bate com TODAS estas expressões. Exigir as duas
//              ("empréstimo" e "financiamento ou debênture") deixa de fora linhas que só citam uma das
//              palavras, como "Ajuste a valor justo das debêntures" ou "Financiamento por Arrendamento".
//   excecoes:  o empréstimo compulsório (Axia) é passivo com consumidores, não dívida financeira.
export const DIVIDA_POR_DESCRICAO = {
  grupos: { curto: "2.01.05", longo: "2.02.02" },
  descricao: [/empr[ée]stimo/i, /financiament|deb[êe]nture/i],
  excecoes: [/compuls/i],
};

// Alerta de dívida fora das contas padrão: dívida bruta zero com despesa financeira acima desta fração
// do ativo total. Por que 0,5%: quem não tem dívida ainda paga tarifas, IOF e ajustes a valor presente,
// mas isso fica em poucos décimos de ponto do ativo; já uma dívida de 10% do ativo a 10% ao ano custa
// 1% do ativo. Meio por cento separa os dois casos com folga dos dois lados.
export const LIMITE_DESPESA_SEM_DIVIDA = 0.005;

// Nome de cada conta usada, para o motivo de um null.
const CONTAS = {
  "3.01": "receita líquida",
  "3.03": "lucro bruto",
  "3.05": "EBIT",
  "3.06": "resultado financeiro",
  "3.06.02": "despesas financeiras",
  "3.11": "lucro líquido",
  "7.04.01": "depreciação e amortização, na DVA",
  "1": "ativo total",
  "1.01": "ativo circulante",
  "1.01.01": "caixa e equivalentes",
  "1.01.02": "aplicações financeiras",
  "2.01": "passivo circulante",
  "2.01.04": "empréstimos e financiamentos de curto prazo",
  "2.02.01": "empréstimos e financiamentos de longo prazo",
  "2.03": "patrimônio líquido",
};

const APROXIMACAO = "As despesas financeiras são uma aproximação dos juros: incluem variação cambial, juros de arrendamento e outros encargos";

export const INDICADORES = [
  // Resultado e retorno (#34)
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
    formula: "EBIT × (1 − 34%) ÷ capital investido no fim do período. Capital investido = patrimônio líquido + dívida bruta − caixa. Os 34% são a alíquota nominal de IR e CSLL; os arrendamentos não entram na dívida",
  },
  // Caixa, dívida e liquidez (#35), sempre com o saldo do fim do período
  { id: "patrimonioLiquido", nome: "Patrimônio líquido", unidade: "R$ mil", formula: "Patrimônio líquido consolidado, com a parte dos minoritários (balanço, conta 2.03)" },
  { id: "caixa", nome: "Caixa", unidade: "R$ mil", formula: "Caixa e equivalentes + aplicações financeiras do ativo circulante (balanço, contas 1.01.01 e 1.01.02)" },
  {
    id: "dividaBruta", nome: "Dívida bruta", unidade: "R$ mil",
    formula: "Empréstimos, financiamentos e debêntures de curto e de longo prazo (balanço, contas 2.01.04 e 2.02.01, mais as linhas de empréstimos, financiamentos e debêntures em outras obrigações), sem os arrendamentos",
  },
  {
    id: "arrendamentos", nome: "Arrendamentos", unidade: "R$ mil",
    formula: "Passivo de arrendamento de curto e de longo prazo: o financiamento por arrendamento (contas 2.01.04.03 e 2.02.01.03) mais as linhas de arrendamento em outras obrigações",
  },
  { id: "dividaBrutaComArrendamentos", nome: "Dívida bruta com arrendamentos", unidade: "R$ mil", formula: "Dívida bruta + arrendamentos" },
  { id: "dividaLiquida", nome: "Dívida líquida", unidade: "R$ mil", formula: "Dívida bruta − caixa, sem os arrendamentos. Valor negativo quer dizer mais caixa do que dívida" },
  { id: "dividaLiquidaComArrendamentos", nome: "Dívida líquida com arrendamentos", unidade: "R$ mil", formula: "Dívida bruta + arrendamentos − caixa" },
  { id: "dividaBrutaSobrePl", nome: "Dívida bruta ÷ patrimônio líquido", unidade: "razão", formula: "Dívida bruta ÷ patrimônio líquido" },
  { id: "dividaLiquidaSobreEbitda", nome: "Dívida líquida ÷ EBITDA", unidade: "razão", formula: "Dívida líquida no fim do período ÷ EBITDA do período, em número de vezes" },
  { id: "dividaCurtoPrazo", nome: "Dívida de curto prazo", unidade: "razão", formula: "Parte da dívida bruta que vence em até 12 meses: dívida de curto prazo ÷ dívida bruta" },
  { id: "despesasFinanceiras", nome: "Despesas financeiras", unidade: "R$ mil", formula: "Despesas financeiras do período (DRE, conta 3.06.02), com o sinal trocado" },
  { id: "coberturaJuros", nome: "Cobertura de juros", unidade: "razão", formula: `EBIT ÷ despesas financeiras, em número de vezes. ${APROXIMACAO}` },
  { id: "custoDivida", nome: "Custo aproximado da dívida", unidade: "razão", formula: `Despesas financeiras do período ÷ dívida bruta no fim do período. ${APROXIMACAO}` },
  { id: "liquidezCorrente", nome: "Liquidez corrente", unidade: "razão", formula: "Ativo circulante ÷ passivo circulante" },
  { id: "liquidezImediata", nome: "Liquidez imediata", unidade: "razão", formula: "Caixa ÷ passivo circulante" },
];

const ok = (valor) => ({ valor, motivo: null });
const nulo = (motivo) => ({ valor: null, motivo });
const milhar = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Demonstrativo de cada conta na série anual, pelo primeiro dígito do código.
const DEMONSTRATIVO = { 1: "BPA", 2: "BPP", 3: "DRE", 6: "DFC", 7: "DVA" };
const VAZIO = { fluxo: () => null, estoque: () => null, passivo: () => [] };

// Adaptador: a mesma leitura para um período da série anual e para a base de 12 meses.
// Devolve { tipo, meses, motivo, fluxo(conta), estoque(conta), passivo() }:
//   tipo "anual"         exercício de cerca de 12 meses
//   tipo "transicao"     exercício com outra duração (`meses` diz quantos)
//   tipo "12-meses"      base de 12 meses (pelo ITR ou ano fechado); o balanço é o da data mais recente
//   tipo "indisponivel"  não há o que calcular; `motivo` diz por quê
// fluxo() e estoque() devolvem o valor em R$ mil, ou null quando a conta não está no período.
// passivo() devolve todas as contas do passivo no fim do período, fixas e não fixas: [{ conta, descricao, valor, contaFixa }].
export function adaptarPeriodo(origem) {
  if (origem == null) return { tipo: "indisponivel", meses: null, motivo: "sem dados do período", ...VAZIO };
  if (typeof origem.fluxo === "function" && typeof origem.estoque === "function") return origem; // já adaptado

  // Base de 12 meses (saída de base12Meses).
  if ("fluxos" in origem) {
    if (origem.tipo === "indisponivel" || origem.fluxos == null) {
      return { tipo: "indisponivel", meses: null, motivo: origem.motivo ?? "base de 12 meses indisponível", ...VAZIO };
    }
    const doBpp = (c) => c.demonstrativo === "BPP";
    return {
      tipo: "12-meses", meses: 12, motivo: null,
      fluxo: (conta) => origem.fluxos[conta]?.valor ?? null,
      estoque: (conta) => origem.estoques?.contas[conta]?.valor ?? null,
      passivo: () => [
        ...Object.entries(origem.estoques?.contas ?? {}).filter(([, c]) => doBpp(c)).map(([conta, c]) => ({ conta, descricao: c.descricao, valor: c.valor, contaFixa: true })),
        ...(origem.estoques?.naoFixas ?? []).filter(doBpp).map(({ conta, descricao, valor }) => ({ conta, descricao, valor, contaFixa: false })),
      ],
    };
  }

  // Período da série anual (item de serieAnual).
  if (origem.tipo !== "anual" && origem.tipo !== "transicao") {
    return { tipo: "indisponivel", meses: null, motivo: "o período não tem DRE, DFC nem DVA", ...VAZIO };
  }
  const ler = (conta) => valorDaConta(origem.demonstrativos?.[DEMONSTRATIVO[conta[0]]], conta);
  const bpp = origem.demonstrativos?.BPP;
  return {
    tipo: origem.tipo, meses: origem.meses, motivo: null, fluxo: ler, estoque: ler,
    passivo: () => [...new Set((bpp?.contas ?? []).map((c) => c.conta))]
      .map((conta) => {
        const { descricao, contaFixa } = bpp.contas.find((c) => c.conta === conta);
        return { conta, descricao, valor: valorDaConta(bpp, conta), contaFixa };
      }),
  };
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

// Despesas financeiras do período = − DRE 3.06.02 (a DRE traz o valor negativo). Só troca o sinal.
// Há companhias que informam só o resultado financeiro líquido (3.06) e deixam receitas (3.06.01) e
// despesas (3.06.02) zeradas. Aí o zero não é "sem despesa": é "não informado", e o resultado é null.
export function despesasFinanceiras(periodo) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return nulo(p.motivo);
  const despesas = fluxo(p, "3.06.02");
  if (despesas.valor === 0 && p.fluxo("3.06.01") === 0 && p.fluxo("3.06") != null && p.fluxo("3.06") !== 0) {
    return nulo("a companhia não abre o resultado financeiro em receitas e despesas");
  }
  return combinar([despesas], (v) => 0 - v);
}

// Subcontas NÃO fixas de um grupo cuja descrição passa no teste, sem dupla contagem: se uma conta passa
// e um ancestral dela também passa, fica só o ancestral.
function subcontasPorDescricao(passivo, grupos, passa) {
  const fixas = new Set(passivo.filter((c) => c.contaFixa).map((c) => c.conta));
  const achadas = passivo.filter((c) => !fixas.has(c.conta) && grupos.some((g) => c.conta.startsWith(`${g}.`)) && passa(c.descricao));
  return achadas.filter((c) => !achadas.some((pai) => c.conta.startsWith(`${pai.conta}.`)));
}

// Contas de dívida financeira em "Outras Obrigações", pela descrição: { curto: [...], longo: [...] }.
export function contasDeDividaPorDescricao(passivo, regra = DIVIDA_POR_DESCRICAO) {
  const passa = (d) => regra.descricao.every((e) => e.test(d)) && !regra.excecoes.some((e) => e.test(d));
  return {
    curto: subcontasPorDescricao(passivo, [regra.grupos.curto], passa),
    longo: subcontasPorDescricao(passivo, [regra.grupos.longo], passa),
  };
}

// Dívida de um prazo = empréstimos e financiamentos − "Financiamento por Arrendamento" + linhas de dívida
// em outras obrigações. A subconta do arrendamento é fixa e quase sempre vem zerada; se não vier no
// período, conta como 0.
function dividaDoPrazo(p, conta, arrendamento, prazo) {
  const linhas = contasDeDividaPorDescricao(p.passivo?.() ?? [])[prazo];
  const semValor = linhas.find((c) => c.valor == null);
  if (semValor) return nulo(`a conta ${semValor.conta} (${semValor.descricao}) veio sem valor único`);
  const porDescricao = linhas.reduce((soma, c) => soma + c.valor, 0);
  return combinar([estoque(p, conta)], (v) => v - (p.estoque(arrendamento) ?? 0) + porDescricao);
}
const dividaDeCurtoPrazo = (p) => dividaDoPrazo(p, "2.01.04", "2.01.04.03", "curto");
const dividaDeLongoPrazo = (p) => dividaDoPrazo(p, "2.02.01", "2.02.01.03", "longo");

// Dívida bruta = empréstimos, financiamentos e debêntures de curto e de longo prazo, no fim do período:
// (2.01.04 − 2.01.04.03) + (2.02.01 − 2.02.01.03) + as linhas de DIVIDA_POR_DESCRICAO. Sem arrendamentos (IFRS 16).
// Alerta: se a soma dá 0 e a despesa financeira passa de LIMITE_DESPESA_SEM_DIVIDA do ativo total, a dívida
// deve estar em outra linha do passivo, com uma descrição que a regra não reconhece. Aí o resultado é null
// com o motivo, e tudo o que depende da dívida fica null junto: melhor um null explicado do que um ROIC inflado.
export function dividaBruta(periodo) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return nulo(p.motivo);
  const divida = combinar([dividaDeCurtoPrazo(p), dividaDeLongoPrazo(p)], (a, b) => a + b);
  if (divida.valor !== 0) return divida;
  const despesa = despesasFinanceiras(p).valor;
  const ativo = p.estoque("1");
  if (despesa != null && ativo != null && ativo > 0 && despesa > LIMITE_DESPESA_SEM_DIVIDA * ativo) {
    return nulo(`a dívida pode estar fora das contas padrão (despesa financeira de R$ ${milhar(despesa)} mil sem empréstimos no balanço)`);
  }
  return divida;
}

// Contas do passivo que são arrendamento, sem dupla contagem: [{ conta, descricao, valor }].
// Entram as duas contas fixas e, nos grupos de "Outras Obrigações", as subcontas cuja descrição bate
// com a regra. Se uma conta bate e um ancestral dela também bate, fica só o ancestral.
export function contasDeArrendamento(passivo, regra = ARRENDAMENTOS) {
  const passa = (d) => regra.descricao.test(d) && !regra.excecoes.some((e) => e.test(d));
  return [...passivo.filter((c) => regra.fixas.includes(c.conta)), ...subcontasPorDescricao(passivo, regra.grupos, passa)];
}

// Arrendamentos = passivo de arrendamento de curto e de longo prazo, no fim do período.
// As contas fixas vêm zeradas em quase todas as companhias, então o zero delas não informa nada. Se nenhuma
// subconta bate com a regra e as fixas são 0 ou ausentes, o resultado é null: não dá para dizer que a
// companhia não tem arrendamento, só que nenhuma linha foi identificada. Zero só quando uma linha de
// arrendamento identificada informa zero.
export function arrendamentos(periodo) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return nulo(p.motivo);
  const passivo = p.passivo?.() ?? [];
  if (passivo.length === 0) return nulo("falta o passivo do balanço");
  const linhas = contasDeArrendamento(passivo);
  const semValor = linhas.find((c) => c.valor == null);
  if (semValor) return nulo(`a conta ${semValor.conta} (${semValor.descricao}) veio sem valor único`);
  const identificada = linhas.some((c) => !ARRENDAMENTOS.fixas.includes(c.conta) || c.valor !== 0);
  if (!identificada) return nulo("nenhuma linha de arrendamento identificada no passivo");
  return ok(linhas.reduce((soma, c) => soma + c.valor, 0));
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

  const pl = estoque(p, "2.03");
  const cx = caixa(p);
  const divida = dividaBruta(p);
  const arrend = arrendamentos(p);
  const dividaComArrend = combinar([divida, arrend], (a, b) => a + b);
  const dividaLiquida = combinar([divida, cx], (a, b) => a - b);
  const despesas = despesasFinanceiras(p);
  const passivoCirculante = estoque(p, "2.01");

  const margem = (numerador) => dividir(numerador, receita, "receita zero ou negativa");
  // Razão que precisa de 12 meses de resultado: não anualiza período de transição.
  const transicao = (rotulo) => nulo(`período de ${p.meses} meses, ${rotulo} não anualizado`);
  const retorno = (numerador, denominador, motivo) => (p.tipo === "transicao" ? transicao("retorno") : dividir(numerador, denominador, motivo));
  const comFluxo = (calcular) => (p.tipo === "transicao" ? transicao("indicador") : calcular());
  // Divide pela dívida bruta. Dívida zero é o caso normal de quem não deve: não há o que dividir.
  const sobreDivida = (numerador) => {
    if (divida.valor == null) return nulo(divida.motivo);
    if (divida.valor <= 0) return nulo("sem dívida financeira");
    return dividir(numerador, divida, "sem dívida financeira");
  };
  const liquidez = (numerador) => dividir(numerador, passivoCirculante, "passivo circulante zero ou negativo");

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
    roe: retorno(lucroLiquido, pl, "patrimônio líquido zero ou negativo"),
    roa: retorno(lucroLiquido, estoque(p, "1"), "ativo total zero ou negativo"),
    roic: retorno(combinar([ebit], (v) => v * (1 - ALIQUOTA_ROIC)), capitalInvestido(p), "capital investido zero ou negativo"),

    patrimonioLiquido: pl,
    caixa: cx,
    dividaBruta: divida,
    arrendamentos: arrend,
    dividaBrutaComArrendamentos: dividaComArrend,
    dividaLiquida,
    dividaLiquidaComArrendamentos: combinar([dividaComArrend, cx], (a, b) => a - b),
    dividaBrutaSobrePl: dividir(divida, pl, "patrimônio líquido zero ou negativo"),
    dividaLiquidaSobreEbitda: comFluxo(() => dividir(dividaLiquida, ebitda, "EBITDA zero ou negativo")),
    dividaCurtoPrazo: sobreDivida(dividaDeCurtoPrazo(p)),
    despesasFinanceiras: despesas,
    coberturaJuros: comFluxo(() => dividir(ebit, despesas, "despesas financeiras zero ou negativas")),
    custoDivida: comFluxo(() => (despesas.valor != null && despesas.valor <= 0 ? nulo("despesas financeiras zero ou negativas") : sobreDivida(despesas))),
    liquidezCorrente: liquidez(estoque(p, "1.01")),
    liquidezImediata: liquidez(cx),
  };
}
