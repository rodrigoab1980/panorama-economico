// Indicadores de UM período: um item da série anual ou a base de 12 meses, os dois na forma que sai
// de montarSeries (scripts/cvm/series.mjs). Resultado e retorno (#34); caixa, dívida e liquidez (#35);
// fluxo de caixa, capex, FCL, proventos e valores por ação (#36).
// Lógica pura: sem disco, sem rede e sem relógio.
//
// Regras (briefings da #34 e da #35, resumidas no README, seção "Indicadores fundamentalistas"):
// 1. Valores em R$ mil inteiros, como na série. Razões em fração (0,365), sem arredondar.
// 2. ROE, ROA e ROIC usam o saldo do fim do período, não a média.
// 3. Ausência é null com motivo. Nunca 0 no lugar de "não deu".
// 4. Período de transição (menos de 12 meses) tem fluxos, margens e saldos, mas não tem retorno nem as
//    razões que misturam fluxo com saldo: nada é anualizado.
// 5. Nenhum indicador é calculado com o 3.99 (lucro por ação informado). Ele só serve de evidência para
//    descobrir se a composição do capital está em unidades ou em milhares de ações (composicao-capital.mjs).
// 6. A dívida bruta é sem arrendamentos (IFRS 16). Os arrendamentos saem à parte, e há sempre as duas versões.
// 7. Dívida líquida negativa (caixa líquido) é valor válido, não null.
// 8. Capex, juros pagos, arrendamentos pagos e proventos não têm código fixo na DFC: saem do classificador
//    (classificador-dfc.mjs). Categoria não identificada é null com motivo, nunca zero.
// 8b. A D&A do EBITDA é a da DFC quando identificada; a da DVA (7.04.01) fica de reserva.
// 9. Há sempre dois FCL: FCO − capex, e o mesmo depois dos pagamentos de arrendamento (IFRS 16).
// 10. Os valores por ação usam as ações em circulação (total − tesouraria) do fim do período e saem em R$.
//     O lucro por ação usa o lucro da controladora (3.11.01), não o consolidado.

import { doze as dozeMeses, valorDaConta } from "./series.mjs";
import { CATEGORIAS, NAO_IDENTIFICADO, ORDEM, classificarLinhas, excecoesDaCompanhia } from "./classificador-dfc.mjs";
import { composicaoNaData, emUnidades, escalaDasAcoes } from "./composicao-capital.mjs";

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

// Motivo do período cuja demonstração veio inteira em zero (ver adaptarPeriodo). É a continuação da
// regra do consolidado zerado do leitor (leitor.mjs, consolidadosZerados): lá, o documento zerado cai
// para o individual; aqui, quando não sobra outra fonte para o período, ele fica sem valor. Caso real:
// o exercício de 2018 do Assaí só existe na coluna do ano anterior da DFP de 2019, e ela veio zerada.
export const MOTIVO_DEMONSTRACAO_ZERADA = "demonstração zerada no documento";

// Diluição acima deste tamanho, para cima ou para baixo, não é mostrada. O arquivo da CVM não traz os
// desdobramentos e grupamentos: um desdobramento de 1 para 3 aparece como +200% e um grupamento de 15
// para 1, como −93%, e nenhum dos dois muda a fatia do acionista. Por que 50%: emissão e recompra de
// verdade raramente passam disso num ano, e o menor desdobramento comum (1 para 2) dá +100%. O intervalo
// é fechado: −50% e +50% exatos ainda saem como valor. Uma incorporação grande paga em ações também
// passa do limite; fica null com o motivo, que é melhor do que um número que parece emissão.
export const LIMITE_DILUICAO = 0.5;

// Quando a D&A da DFC vem mais do que isto abaixo da D&A da DVA, vale a da DVA. A D&A da DFC é achada
// pela descrição das linhas, e a regra pode deixar de fora um pedaço que a companhia lança com outro
// nome: a São Martinho põe a exaustão do canavial em "Ativos biológicos colhidos", a DFC dá 1.086.030
// e a DVA, 2.371.247 (54% abaixo). Por que 15%: na DFP de 2025 as duas fontes ficam dentro de 15% em 59
// das 64 companhias da página, e nas outras cinco a DFC é a maior; uma DFC tão abaixo da DVA é sinal de
// linha que faltou, não de diferença de critério. A comparação é estrita: 15% exatos ainda valem a DFC.
export const LIMITE_DA_DFC_ABAIXO_DA_DVA = 0.15;
export const ORIGEM_DVA_POR_DFC_MENOR = `DVA (DFC ${LIMITE_DA_DFC_ABAIXO_DA_DVA * 100}% menor)`;

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
  "3.11.01": "lucro atribuído aos sócios da controladora",
  "6.01": "caixa das atividades operacionais",
  "6.02": "caixa das atividades de investimento",
  "6.03": "caixa das atividades de financiamento",
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
  {
    id: "da", nome: "Depreciação e amortização", unidade: "R$ mil",
    formula: "Depreciação, amortização e exaustão dos ajustes do lucro na DFC, achadas pela descrição das linhas. Quando não são identificadas, ou quando ficam mais de 15% abaixo da D&A da DVA, vale a da DVA (conta 7.04.01), com o sinal trocado",
  },
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
  { id: "liquidezCorrente", nome: "Liquidez corrente", unidade: "razão", formula: "Ativo circulante ÷ passivo circulante" },
  { id: "liquidezImediata", nome: "Liquidez imediata", unidade: "razão", formula: "Caixa ÷ passivo circulante" },
  // Fluxo de caixa, capex, FCL, proventos e valores por ação (#36)
  { id: "fco", nome: "Fluxo de caixa operacional (FCO)", unidade: "R$ mil", formula: "Caixa líquido das atividades operacionais (DFC, conta 6.01)" },
  { id: "fci", nome: "Fluxo de caixa de investimento (FCI)", unidade: "R$ mil", formula: "Caixa líquido das atividades de investimento (DFC, conta 6.02)" },
  { id: "fcf", nome: "Fluxo de caixa de financiamento (FCF)", unidade: "R$ mil", formula: "Caixa líquido das atividades de financiamento (DFC, conta 6.03)" },
  {
    id: "capex", nome: "Capex", unidade: "R$ mil",
    formula: "Pagamentos por imobilizado, intangível, ativo de contrato e ativo biológico, achados pela descrição das linhas do investimento na DFC. Aquisição de empresas não entra",
  },
  { id: "fcl", nome: "Fluxo de caixa livre (FCL)", unidade: "R$ mil", formula: "FCO − capex" },
  {
    id: "fclAposArrendamentos", nome: "FCL depois dos arrendamentos", unidade: "R$ mil",
    formula: "FCO − capex − pagamentos de arrendamento que estão no financiamento (principal e juros). Os juros de arrendamento que estão no FCO já foram descontados",
  },
  { id: "fcoSobreEbitda", nome: "FCO ÷ EBITDA", unidade: "razão", formula: "FCO ÷ EBITDA: quanto do EBITDA virou caixa" },
  { id: "capexSobreFco", nome: "Capex ÷ FCO", unidade: "razão", formula: "Capex ÷ FCO: quanto do caixa operacional foi reinvestido" },
  {
    id: "jurosPagos", nome: "Juros pagos", unidade: "R$ mil",
    formula: "Juros de empréstimos, financiamentos e debêntures pagos no período, achados pela descrição das linhas da DFC (no operacional ou no financiamento). Sem os juros de arrendamento",
  },
  { id: "coberturaJurosPagos", nome: "Cobertura dos juros pagos", unidade: "razão", formula: "EBIT ÷ juros pagos, em número de vezes" },
  { id: "custoDividaJurosPagos", nome: "Custo da dívida pelos juros pagos", unidade: "razão", formula: "Juros pagos no período ÷ dívida bruta no fim do período" },
  {
    id: "proventosPagos", nome: "Proventos pagos", unidade: "R$ mil",
    formula: "Dividendos e juros sobre o capital próprio pagos aos acionistas da companhia, achados pela descrição das linhas do financiamento na DFC. Os pagos a não controladores ficam de fora",
  },
  { id: "acoesCirculacao", nome: "Ações em circulação", unidade: "ações", formula: "Ações do capital integralizado − ações em tesouraria, no fim do período (composição do capital)" },
  {
    id: "diluicao", nome: "Diluição", unidade: "razão",
    formula: "Ações em circulação ÷ ações em circulação do exercício anterior − 1. Positiva quando o número de ações cresce. Variação acima de 50%, para cima ou para baixo, não é mostrada: sugere desdobramento ou grupamento",
  },
  {
    id: "lucroPorAcao", nome: "Lucro por ação", unidade: "R$ por ação",
    formula: "Lucro atribuído aos sócios da controladora (DRE, conta 3.11.01) ÷ ações em circulação. Usa o lucro da controladora, e não o consolidado, porque a parte dos minoritários não pertence ao acionista da companhia",
  },
  { id: "fcoPorAcao", nome: "FCO por ação", unidade: "R$ por ação", formula: "FCO ÷ ações em circulação" },
  { id: "fclPorAcao", nome: "FCL por ação", unidade: "R$ por ação", formula: "FCL (FCO − capex) ÷ ações em circulação" },
  {
    id: "valorPatrimonialPorAcao", nome: "Valor patrimonial por ação (VPA)", unidade: "R$ por ação",
    formula: "Patrimônio líquido da controladora (conta 2.03 menos a participação dos não controladores, 2.03.09) ÷ ações em circulação. Os não controladores saem porque essa parte do patrimônio não pertence ao acionista da companhia",
  },
];

const ok = (valor) => ({ valor, motivo: null });
const nulo = (motivo) => ({ valor: null, motivo });
const milhar = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// Demonstrativo de cada conta na série anual, pelo primeiro dígito do código.
const DEMONSTRATIVO = { 1: "BPA", 2: "BPP", 3: "DRE", 6: "DFC", 7: "DVA" };
const VAZIO = { fluxo: () => null, estoque: () => null, passivo: () => [], dfc: () => [] };
const dataBr = (iso) => String(iso).split("-").reverse().join("/");

// Adaptador: a mesma leitura para um período da série anual e para a base de 12 meses.
// Devolve { tipo, meses, motivo, fluxo(conta), estoque(conta), passivo() }:
//   tipo "anual"         exercício de cerca de 12 meses
//   tipo "transicao"     exercício com outra duração (`meses` diz quantos)
//   tipo "12-meses"      base de 12 meses (pelo ITR ou ano fechado); o balanço é o da data mais recente
//   tipo "indisponivel"  não há o que calcular; `motivo` diz por quê
// fluxo() e estoque() devolvem o valor em R$ mil, ou null quando a conta não está no período.
// passivo() devolve todas as contas do passivo no fim do período, fixas e não fixas: [{ conta, descricao, valor, contaFixa }].
// dfc() devolve as parcelas da DFC do período, cada uma com as suas linhas: [{ parcela, onde, linhas }].
//   No anual há uma parcela só. Nos 12 meses pelo ITR há três (anual, acumuladoAtual, acumuladoAnterior),
//   para classificar cada uma e só então somar. `onde` diz o documento, para o motivo de um null.
export function adaptarPeriodo(origem) {
  if (origem == null) return { tipo: "indisponivel", meses: null, motivo: "sem dados do período", ...VAZIO };
  if (typeof origem.fluxo === "function" && typeof origem.estoque === "function") return origem; // já adaptado
  const adaptado = adaptarSemConferir(origem);
  // Demonstração zerada: o ativo total (conta 1) do período é 0. Nenhuma companhia aberta tem ativo
  // zero, então o que veio foi um formulário em branco, e não um ano de valores nulos. O período fica
  // indisponível, com o motivo, em vez de mostrar receita, lucro e ativo iguais a 0.
  if (adaptado.tipo !== "indisponivel" && adaptado.estoque("1") === 0) {
    return { tipo: "indisponivel", meses: adaptado.meses, motivo: MOTIVO_DEMONSTRACAO_ZERADA, ...VAZIO };
  }
  return adaptado;
}

function adaptarSemConferir(origem) {

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
      dfc: () => ["anual", "acumuladoAtual", "acumuladoAnterior"]
        .filter((parcela) => origem.linhasDfc?.[parcela] != null)
        .map((parcela) => {
          const de = origem.parcelas?.[parcela];
          const onde = de?.dtRefer ? `${de.documento === "dfp" ? "na DFP" : "no ITR"} de ${dataBr(de.dtRefer)}` : "no documento";
          return { parcela, onde, linhas: origem.linhasDfc[parcela] };
        }),
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
    dfc: () => {
      const bloco = origem.demonstrativos?.DFC;
      if (!bloco) return [];
      const linhas = [...new Set(bloco.contas.map((c) => c.conta))].map((conta) => {
        const { descricao, contaFixa } = bloco.contas.find((c) => c.conta === conta);
        return { conta, descricao, valor: valorDaConta(bloco, conta), contaFixa };
      });
      return [{ parcela: "anual", onde: `na DFP de ${dataBr(origem.fim)}`, linhas }];
    },
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

// Lucro que pertence ao acionista da companhia: o atribuído aos sócios da controladora (DRE 3.11.01).
//   - Demonstração individual não tem a conta (não há minoritários): vale o lucro do período (3.11).
//   - Há companhias que deixam 3.11.01 e 3.11.02 zeradas e informam só o 3.11. Aí o zero é "não
//     informado", e o resultado é null: usar o 3.11 daria aos acionistas o lucro dos minoritários.
export function lucroDaControladora(periodo) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return nulo(p.motivo);
  const controladora = p.fluxo("3.11.01");
  const total = fluxo(p, "3.11");
  if (controladora == null) return total;
  if (controladora === 0 && (p.fluxo("3.11.02") ?? 0) === 0 && total.valor != null && total.valor !== 0) {
    return nulo("a companhia não abre o lucro entre a controladora e os não controladores");
  }
  return ok(controladora);
}

// Capital investido = patrimônio líquido + dívida bruta − caixa, no fim do período.
export function capitalInvestido(periodo) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return nulo(p.motivo);
  return combinar([estoque(p, "2.03"), dividaBruta(p), caixa(p)], (pl, divida, cx) => pl + divida - cx);
}

// Linhas da DFC classificadas e somadas no período: { [categoria]: { valor, motivo } }, com a soma como veio
// (pagamento é negativo). Traz também `jurosArrendamentoNoFcf`, a parte dos juros de arrendamento que está
// no financiamento (6.03): é a que ainda não foi descontada do FCO.
//   - No anual, é a soma das linhas da categoria.
//   - Nos 12 meses pelo ITR, cada parcela é classificada à parte e a categoria passa por doze():
//     anual + acumulado atual − acumulado anterior. Se a categoria aparece numa parcela e não em outra
//     (a descrição mudou entre o ITR e a DFP), o resultado é null com o motivo.
// `excecoes` é a lista de exceções da companhia (excecoes-dfc.json, já filtrada).
export function fluxosClassificados(periodo, { excecoes = [] } = {}) {
  const p = adaptarPeriodo(periodo);
  const categorias = [...ORDEM, "jurosArrendamentoNoFcf"];
  if (p.tipo === "indisponivel") return Object.fromEntries(categorias.map((c) => [c, nulo(p.motivo)]));
  const parcelas = (p.dfc?.() ?? []).map((x) => ({ ...x, classes: classificarLinhas(x.linhas, { excecoes }) }));
  if (parcelas.length === 0) return Object.fromEntries(categorias.map((c) => [c, nulo("falta a DFC do período")]));

  const somar = (categoria, somaDaParcela) => {
    const classes = parcelas.map((x) => x.classes[categoria]);
    const misturada = classes.find((c) => c.misturadas);
    if (misturada) return nulo(misturada.motivo);
    const outro = classes.find((c) => c.soma == null && c.motivo !== NAO_IDENTIFICADO);
    if (outro) return nulo(outro.motivo);
    const achadas = classes.filter((c) => c.soma != null).length;
    if (achadas === 0) return nulo(NAO_IDENTIFICADO);
    if (achadas < parcelas.length) {
      const falta = parcelas.find((x) => x.classes[categoria].soma == null);
      return nulo(`a linha de ${CATEGORIAS[categoria].nome} não foi identificada ${falta.onde}`);
    }
    const somas = Object.fromEntries(parcelas.map((x) => [x.parcela, somaDaParcela(x.classes[categoria])]));
    return ok(parcelas.length === 1 ? somas.anual : dozeMeses(somas.anual, somas.acumuladoAtual, somas.acumuladoAnterior));
  };

  const resultado = Object.fromEntries(ORDEM.map((c) => [c, somar(c, (classe) => classe.soma)]));
  // Juros de arrendamento no financiamento. Sem linha de juros de arrendamento, a parte é 0: ou eles
  // estão no FCO, ou vêm dentro da linha do principal.
  const juros = resultado.jurosArrendamento;
  resultado.jurosArrendamentoNoFcf = juros.valor == null
    ? (juros.motivo === NAO_IDENTIFICADO ? ok(0) : nulo(juros.motivo))
    : somar("jurosArrendamento", (classe) => classe.linhas.filter((l) => l.conta.startsWith("6.03.")).reduce((soma, l) => soma + l.valor, 0));
  return resultado;
}

// D&A do período, a que entra no EBITDA: { valor, motivo, origem }.
//   1. A da DFC (depreciação, amortização e exaustão nos ajustes do lucro, achadas pela descrição), quando
//      identificada: `origem` "DFC". Em algumas companhias a DVA traz bem menos amortização do que a
//      DFC (na Hapvida de 2025, 870 milhões contra 1.562 milhões), e o EBITDA sai menor do que deveria.
//   2. Senão, a da DVA (conta 7.04.01), que vem negativa: `origem` "DVA". O sinal é só trocado, sem
//      Math.abs, para um valor positivo na origem aparecer como D&A negativa, e não ser escondido.
// Nos 12 meses, a da DFC só vale se foi identificada nas três parcelas; se faltar em alguma, vale a DVA.
// `classes` é a saída de fluxosClassificados para o mesmo período.
export function depreciacaoEAmortizacao(periodo, classes) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return { ...nulo(p.motivo), origem: null };
  const daDfc = (classes ?? fluxosClassificados(p)).daDfc;
  const daDva = combinar([fluxo(p, "7.04.01")], (v) => 0 - v);
  if (daDfc.valor != null) {
    const faltouLinha = daDva.valor != null && daDva.valor > 0 && daDfc.valor < daDva.valor * (1 - LIMITE_DA_DFC_ABAIXO_DA_DVA);
    return faltouLinha ? { ...ok(daDva.valor), origem: ORIGEM_DVA_POR_DFC_MENOR } : { ...ok(daDfc.valor), origem: "DFC" };
  }
  return { ...daDva, origem: daDva.valor == null ? null : "DVA" };
}

// Indicadores de um período. Devolve { [id]: { valor, motivo } }, com um item para cada id de INDICADORES.
// A D&A (`da`) traz também `origem`, dizendo de onde saiu: "DFC", "DVA" ou "DVA (DFC 15% menor)".
// `contexto` traz o que não está no período:
//   composicao          composição do capital do fim do período, JÁ EM UNIDADES de ação ({ acoesCirculacao, ... })
//   composicaoAnterior  a do exercício anterior, para a diluição (só na série anual)
//   motivoComposicao    por que a composição não veio, quando há um motivo melhor do que "falta" (12 meses)
//   primeiroAno         true quando o período é o primeiro da série (a diluição não existe)
//   excecoesDfc         exceções do classificador da DFC para a companhia
// calcularIndicadoresDaSerie() monta o contexto de cada período.
export function calcularIndicadores(periodo, contexto = {}) {
  const p = adaptarPeriodo(periodo);
  if (p.tipo === "indisponivel") return Object.fromEntries(INDICADORES.map(({ id }) => [id, id === "da" ? { ...nulo(p.motivo), origem: null } : nulo(p.motivo)]));

  const receita = fluxo(p, "3.01");
  const lucroBruto = fluxo(p, "3.03");
  const ebit = fluxo(p, "3.05");
  // As linhas da DFC achadas pela descrição (#36). As somas vêm com o sinal da DFC (pagamento negativo).
  const classes = fluxosClassificados(p, { excecoes: contexto.excecoesDfc });
  const da = depreciacaoEAmortizacao(p, classes);
  const ebitda = combinar([ebit, da], (a, b) => a + b); // combinar devolve só { valor, motivo }
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

  // Fluxo de caixa (#36). As somas do classificador vêm com o sinal da DFC (pagamento negativo).
  const fco = fluxo(p, "6.01");
  // Categoria da DFC como valor positivo. Quando não foi identificada, o motivo diz qual.
  const pago = (categoria, rotulo) => {
    const c = classes[categoria];
    if (c.valor != null) return ok(0 - c.valor);
    return nulo(c.motivo === NAO_IDENTIFICADO && rotulo ? `${rotulo} ${NAO_IDENTIFICADO} na DFC` : c.motivo);
  };
  const capex = pago("capex");
  const fcl = combinar([fco, pago("capex", "capex")], (a, b) => a - b);
  const fclAposArrendamentos = combinar(
    [fcl, pago("principalArrendamento", "pagamento de arrendamento"), pago("jurosArrendamentoNoFcf")],
    (livre, principal, juros) => livre - principal - juros,
  );
  const jurosPagos = pago("jurosPagos");
  const jurosParaRazao = pago("jurosPagos", "juros pagos");
  const semJuros = () => (jurosParaRazao.valor != null && jurosParaRazao.valor <= 0 ? nulo("juros pagos zero ou negativos") : null);

  // Ações em circulação e valores por ação, em R$ (os fluxos estão em R$ mil).
  const composicao = contexto.composicao;
  const acoes = composicao == null
    ? nulo(contexto.motivoComposicao ?? "falta a composição do capital do período")
    : (composicao.acoesCirculacao == null || composicao.acoesCirculacao <= 0 ? nulo("composição do capital sem o número de ações") : ok(composicao.acoesCirculacao));
  const porAcao = (emMil) => combinar([emMil, acoes], (v, n) => (v * 1000) / n);
  const diluicao = () => {
    if (p.tipo === "12-meses") return nulo("a diluição só existe na série anual");
    if (acoes.valor == null) return nulo(acoes.motivo);
    if (contexto.primeiroAno) return nulo("primeiro ano da série");
    const antes = contexto.composicaoAnterior?.acoesCirculacao;
    if (antes == null || antes <= 0) return nulo("falta a composição do capital do exercício anterior");
    const variacao = acoes.valor / antes - 1;
    if (Math.abs(variacao) > LIMITE_DILUICAO) {
      const n = Math.round(Math.abs(variacao) * 100);
      return nulo(`variação de ${variacao > 0 ? "+" : "-"}${n}% sugere desdobramento ou grupamento`);
    }
    return ok(variacao);
  };

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
    liquidezCorrente: liquidez(estoque(p, "1.01")),
    liquidezImediata: liquidez(cx),

    fco,
    fci: fluxo(p, "6.02"),
    fcf: fluxo(p, "6.03"),
    capex,
    fcl,
    fclAposArrendamentos,
    fcoSobreEbitda: dividir(fco, ebitda, "EBITDA zero ou negativo"),
    capexSobreFco: dividir(pago("capex", "capex"), fco, "FCO zero ou negativo"),
    jurosPagos,
    coberturaJurosPagos: comFluxo(() => semJuros() ?? dividir(ebit, jurosParaRazao, "juros pagos zero ou negativos")),
    custoDividaJurosPagos: comFluxo(() => semJuros() ?? sobreDivida(jurosParaRazao)),
    proventosPagos: pago("proventos"),
    acoesCirculacao: acoes,
    diluicao: diluicao(),
    lucroPorAcao: porAcao(lucroDaControladora(p)),
    fcoPorAcao: porAcao(fco),
    fclPorAcao: porAcao(fcl),
    // Sem a conta 2.03.09 o balanço é o individual, que não tem não controladores.
    valorPatrimonialPorAcao: porAcao(combinar([pl], (v) => v - (p.estoque("2.03.09") ?? 0))),
  };
}

// Indicadores de todos os períodos de uma companhia: recebe a saída de montarSeries e monta o contexto
// de cada período (composição do capital da data, a do exercício anterior e as exceções da companhia).
//   composicoes   saída de lerComposicaoCapital, de DFP e de ITR juntas (só as da companhia são usadas)
//   excecoesDfc   conteúdo de excecoes-dfc.json (`excecoes`)
// Devolve { anual: [{ inicio, fim, tipo, composicao, indicadores }],
//           doze: { fim, tipo, composicao, motivoComposicao, indicadores }, avisos: [texto] }.
// A `composicao` devolvida está em unidades de ação e diz a `escala` em que veio e como ela foi descoberta.
//   - No anual, a escala sai do lucro por ação informado na DRE do próprio exercício (ou da ordem de grandeza).
//   - Nos 12 meses, a composição é a da data do ITR mais recente; se o ITR não a trouxer, vale a mais
//     recente anterior, e a `dtRefer` dela mostra de onde veio. A escala é a do último exercício anual,
//     desde que o total do ITR seja da mesma ordem; senão, vale a ordem de grandeza.
//   - Nos 12 meses, se o total de ações da composição diverge mais de LIMITE_DILUICAO (50%, para cima
//     ou para baixo) do total do documento anterior, a composição não é usada: `composicao` fica null,
//     `motivoComposicao` diz por quê, e o número de ações e os valores por ação dos 12 meses ficam
//     null com esse motivo (o valor de mercado também, em multiplos.mjs). É o caso da Vivara, cujo ITR
//     de 30/09/2026 informa 82 milhões de ações, contra 236 milhões no de junho. Um desdobramento de
//     verdade também cai aqui, e sai sozinho no trimestre seguinte.
// `avisos` lista o que merece ser olhado e não é erro: a escala das ações (unidade ou mil) que muda
// de um documento para outro e a composição divergente.
export function calcularIndicadoresDaSerie(series, { composicoes = [], excecoesDfc = [] } = {}) {
  const daCompanhia = composicoes.filter((c) => c.cnpj === series.cnpj);
  const excecoes = excecoesDaCompanhia(excecoesDfc, series.cnpj);
  const composicaoDoAno = (periodo) => {
    const bruta = composicaoNaData(daCompanhia, periodo.fim);
    if (!bruta) return { bruta: null, composicao: null };
    const informado = periodo.demonstrativos?.DRE?.contas.find((c) => c.conta.startsWith("3.99.01.") && c.valor)?.valor ?? null;
    const lucro = lucroDaControladora(periodo).valor;
    return { bruta, composicao: emUnidades(bruta, escalaDasAcoes({ acoesTotal: bruta.acoesTotal, lucro, lucroPorAcaoInformado: informado })) };
  };
  const dosAnos = series.anual.map(composicaoDoAno);
  const anual = series.anual.map((periodo, i) => {
    const { composicao } = dosAnos[i];
    const composicaoAnterior = i > 0 ? dosAnos[i - 1].composicao : null;
    return {
      inicio: periodo.inicio, fim: periodo.fim, tipo: periodo.tipo, composicao,
      indicadores: calcularIndicadores(periodo, { composicao, composicaoAnterior, primeiroAno: i === 0, excecoesDfc: excecoes }),
    };
  });
  const fim = series.doze?.fim ?? null;
  const bruta = fim ? composicaoNaData(daCompanhia, fim, { aceitarAnterior: true }) : null;
  const ultimoAno = dosAnos.findLast((x) => x.composicao != null);
  const mesmaOrdem = bruta?.acoesTotal > 0 && ultimoAno?.bruta.acoesTotal > 0
    && bruta.acoesTotal / ultimoAno.bruta.acoesTotal > 0.01 && bruta.acoesTotal / ultimoAno.bruta.acoesTotal < 100;
  const escala = !bruta ? null
    : mesmaOrdem ? { escala: ultimoAno.composicao.escala, por: `escala do exercício de ${dataBr(ultimoAno.bruta.dtRefer)}` }
      : escalaDasAcoes({ acoesTotal: bruta.acoesTotal });
  // Composição que diverge demais do documento anterior não é usada.
  const anterior = bruta ? daCompanhia.filter((c) => c.dtRefer < bruta.dtRefer && c.acoesTotal > 0).sort((a, b) => (a.dtRefer < b.dtRefer ? 1 : -1))[0] ?? null : null;
  const variacao = bruta?.acoesTotal > 0 && anterior ? bruta.acoesTotal / anterior.acoesTotal - 1 : null;
  const diverge = variacao != null && Math.abs(variacao) > LIMITE_DILUICAO;
  const documento = bruta && series.anual.some((p) => p.fim === bruta.dtRefer) ? "da DFP" : "do ITR";
  const motivoComposicao = diverge
    ? `o número de ações ${documento} de ${dataBr(bruta.dtRefer)} diverge ${variacao > 0 ? "+" : "-"}${Math.round(Math.abs(variacao) * 100)}% do documento anterior`
    : null;
  const composicao = diverge ? null : emUnidades(bruta, escala);

  const avisos = [];
  const escalas = [...dosAnos.filter((x) => x.composicao).map((x) => x.composicao), ...(composicao ? [composicao] : [])]
    .filter((c) => c.escala != null) // a composição que vem sem o total de ações não tem escala
    .filter((c, i, lista) => lista.findIndex((o) => o.dtRefer === c.dtRefer) === i);
  for (let i = 1; i < escalas.length; i++) {
    if (escalas[i].escala !== escalas[i - 1].escala) {
      avisos.push(`a escala das ações mudou de ${escalas[i - 1].escala} para ${escalas[i].escala} entre ${dataBr(escalas[i - 1].dtRefer)} e ${dataBr(escalas[i].dtRefer)}`);
    }
  }
  if (motivoComposicao) avisos.push(motivoComposicao);
  return {
    anual,
    doze: {
      fim, tipo: series.doze?.tipo ?? null, composicao, motivoComposicao,
      indicadores: calcularIndicadores(series.doze, { composicao, motivoComposicao, excecoesDfc: excecoes }),
    },
    avisos,
  };
}
