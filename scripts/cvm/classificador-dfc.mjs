// Classificador das linhas da DFC pela descrição.
// Lógica pura: sem disco, sem rede e sem relógio.
//
// Por que existe: capex, juros pagos, arrendamentos pagos e proventos pagos não têm código fixo na DFC.
// A mesma linha aparece em códigos diferentes em cada companhia, e só a descrição diz o que é
// (docs/cvm.md, seção "DFC: capex, juros, dividendos e arrendamentos").
//
// Regras gerais (briefing da #36):
// 1. Só linhas sem código fixo são classificadas. As fixas (6.01, 6.02, 6.03 e os totais de 6.01) são totais.
// 2. Cada linha entra em no máximo uma categoria. Se bate em duas, vence a que vem antes em ORDEM.
// 3. Se uma linha e um ancestral dela caem na mesma categoria, fica só o ancestral (sem dupla contagem).
// 4. O valor entra como vem, sem valor absoluto. Quem usa a soma é que troca o sinal.
// 5. Categoria sem linha tem soma null e motivo "não identificado". Nunca zero.
// 6. Linha que mistura dívida com arrendamento não entra em nenhuma das duas categorias: as duas ficam
//    null com o motivo, porque não dá para separar.

// Tira os acentos (NFD), passa para minúsculas e junta os espaços.
export function normalizar(descricao) {
  return String(descricao ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export const NAO_IDENTIFICADO = "não identificado";

// Pedaços de regra, sempre sobre a descrição normalizada.
const PAGO = /\bpag|\bpgto|\bpagto/; // pago, pagos, pagamento, pgto
const DIVIDA = /emprestimo|financiamento|financimamento|debenture|divida|credor|nota promissoria|notas comerciais/;
const ARRENDAMENTO = /arrendament|leasing/;
// Onde ficam os pagamentos de juros: no FCO, fora do bloco de ajustes do lucro (6.01.01, que só tem
// despesas apropriadas, sem saída de caixa), ou no financiamento.
const ONDE_JUROS = ["6.01.02", "6.01.03", "6.03"];
// Sócios de fora: não controladores, minoritários e os sócios de SCPs e SPEs.
const NAO_CONTROLADORES = /nao[ -]controlador|minoritari|\bscps?\b|\bspes?\b/;
// "Juros" ou o nome que algumas companhias de energia dão a eles: "encargos de dívidas", "encargos financeiros".
const JUROS = /juros|encargos? (financeir|(de|sobre|s\/) ?(divida|emprestimo|financiamento|debenture|passivo de arrendament|arrendament))/;
// "Proventos" sozinho não serve: na Ambev quer dizer "recursos obtidos" ("Proventos de Empréstimos").
const PROVENTO = /dividend|juros (sobre|s\/|s\.|sob) ?(o )?capital proprio|\bjs?cp\b|pagamentos? de proventos|proventos pagos|remuneracao aos acionistas/;

// A regra de cada categoria:
//   onde:   prefixos de conta em que a linha pode estar
//   bate:   a descrição normalizada tem de bater com TODAS estas expressões
//   exceto: e com NENHUMA destas
//   mista:  se bater com esta, a linha entra, mas marcada com `mista: true` (traz outra coisa junto)
//   mistura: se bater com esta, a linha NÃO entra e a categoria fica null com `motivoMistura`
export const CATEGORIAS = {
  // Juros de arrendamento pagos. Podem estar no FCO (6.01) ou no financiamento (6.03).
  // Fora do bloco de ajustes, uma linha de juros de arrendamento é pagamento, mesmo sem a palavra "pago".
  // Linha de "principal e juros" não entra aqui: vai inteira para o principal.
  jurosArrendamento: {
    nome: "juros de arrendamento pagos",
    onde: ONDE_JUROS,
    bate: [JUROS, ARRENDAMENTO],
    exceto: [/principal/, /recebid/, /provis/, /apropria/, /incorrid/],
    mistura: DIVIDA,
    motivoMistura: "juros de arrendamento misturados com juros de dívida na DFC",
  },
  // Principal dos arrendamentos (IFRS 16), no financiamento. Uma linha de "principal e juros" entra aqui inteira.
  principalArrendamento: {
    nome: "pagamento de arrendamento",
    onde: ["6.03"],
    bate: [ARRENDAMENTO],
    // "Só juros" (juros sem a palavra principal) é da categoria de cima.
    exceto: [/^(?!.*principal).*juros/, /recebi/, /captac/, /ingresso/, /adic/],
    mistura: DIVIDA,
    motivoMistura: "pagamento de arrendamento misturado com dívida na DFC",
  },
  // Proventos pagos aos não controladores: saem separados, porque não vão para o acionista da companhia.
  proventosNaoControladores: {
    nome: "proventos pagos a não controladores",
    onde: ["6.03"],
    bate: [PROVENTO, NAO_CONTROLADORES],
    exceto: [/recebi/],
  },
  // Dividendos e juros sobre o capital próprio pagos aos acionistas da companhia.
  proventos: {
    nome: "proventos pagos",
    onde: ["6.03"],
    bate: [PROVENTO],
    exceto: [NAO_CONTROLADORES, /recebi/],
  },
  // Juros pagos de dívida, sem arrendamento. Estão no FCO (6.01) em umas companhias e no financiamento (6.03) em outras.
  jurosPagos: {
    nome: "juros pagos",
    onde: ONDE_JUROS,
    bate: [JUROS, /\bpag|\bpgto|\bpagto|amortizac|liquidac/],
    // "Principal e juros" numa linha só não dá para separar; derivativo de juros não é juro de dívida.
    exceto: [/capital proprio/, /\bjs?cp\b/, /recebid/, /provis/, /apropria/, /incorrid/, /a pagar/, /principal/, /^pagamentos? de derivativos/],
    mistura: ARRENDAMENTO,
    motivoMistura: "juros de dívida misturados com juros de arrendamento na DFC",
  },
  // Capex: imobilizado, intangível (inclusive software), ativo de contrato (concessões), ativo biológico e
// aquisição, adição ou construção de propriedade para investimento (shoppings e terrenos). Só no investimento (6.02).
  // De fora: venda, alienação ou recebimento; aquisição de empresa e combinação de negócios (M&A); aplicações financeiras.
  capex: {
    nome: "capex",
    onde: ["6.02"],
    bate: [/imobilizad|intangiv|softwares?\b|ativos? de contrato|ativos? contratua|ativos? biologic|plantio|madeira em pe|ativo nao circulante|(aquisic|adic|construc).*propriedades? para investimento/],
    exceto: [
      /vend|alienac|recebi|baixa|resultado|ganho|perda|indeniza|reembols/,
      /combinac|aquisic\w* de (empresa|controlad|negocio|participac|investid|subsidiari)|caixa adquirid|incorpora/,
      /aplicac\w* financeir|titulos|resgate|juros|dividend|mantidos? para venda|direito de uso/,
    ],
    // Traz outra coisa junto do capex (ex.: "Adições ao imobilizado, intangível e investimentos").
    mista: /(,| e) (em )?investimentos?\b|investimentos? e |participac|(^| )e outros ativos|arrendament/,
  },
  // Depreciação e amortização nos ajustes do lucro (6.01.01). Só para conferir a D&A da DVA.
  daDfc: {
    nome: "depreciação e amortização da DFC",
    onde: ["6.01.01"],
    bate: [/deprecia|amortiza|exaust/],
    exceto: [/transac/, /debenture/, /custos? de captac/, /agio/, /juros/, /emprestimo|financiamento/, /despesas? antecipad/],
  },
};

// Quem vence quando uma linha bate em duas categorias: a que vem antes.
// Os casos específicos vêm antes dos gerais (juros de arrendamento antes de juros; não controladores antes de proventos).
export const ORDEM = ["jurosArrendamento", "principalArrendamento", "proventosNaoControladores", "proventos", "jurosPagos", "capex", "daDfc"];

const dentro = (conta, prefixo) => conta.startsWith(`${prefixo}.`);

// A linha bate com a regra da categoria? Devolve "sim", "mistura" (bate, mas vem junto do que não dá para separar) ou "nao".
function testar(regra, linha, descricao) {
  if (!regra.onde.some((prefixo) => dentro(linha.conta, prefixo))) return "nao";
  if (!regra.bate.every((e) => e.test(descricao))) return "nao";
  if (regra.exceto?.some((e) => e.test(descricao))) return "nao";
  // "Financiamento por arrendamento" é arrendamento, não dívida: sai antes do teste de mistura.
  return regra.mistura?.test(descricao.replace(/financiamentos? (por|de) arrendament\w*/g, "")) ? "mistura" : "sim";
}

// Categoria de uma linha: { categoria, mistura } ou null. `excecoes` é a lista já filtrada da companhia.
export function classificarLinha(linha, excecoes = []) {
  if (linha.contaFixa) return null;
  const descricao = normalizar(linha.descricao);
  const excecao = excecoes.find((e) => normalizar(e.descricao) === descricao && (e.conta == null || e.conta === linha.conta));
  if (excecao) return excecao.categoria == null ? null : { categoria: excecao.categoria, mistura: false, excecao: true };
  for (const categoria of ORDEM) {
    const r = testar(CATEGORIAS[categoria], linha, descricao);
    if (r !== "nao") return { categoria, mistura: r === "mistura" };
  }
  return null;
}

// Classifica as linhas de UMA DFC (um período, um método): [{ conta, descricao, valor, contaFixa }].
// Devolve { [categoria]: { linhas, soma, motivo } } para todas as categorias:
//   linhas: [{ conta, descricao, valor }], com `mista: true` nas que trazem outra coisa junto
//   soma:   a soma dos valores como vieram, ou null
//   motivo: null quando há soma; "não identificado" sem linha; o motivo da mistura quando a linha veio misturada
export function classificarLinhas(linhas, { excecoes = [] } = {}) {
  const porCategoria = Object.fromEntries(ORDEM.map((c) => [c, { achadas: [], misturadas: [] }]));
  for (const linha of linhas ?? []) {
    const r = classificarLinha(linha, excecoes);
    if (r) porCategoria[r.categoria][r.mistura ? "misturadas" : "achadas"].push(linha);
  }
  const resultado = {};
  for (const categoria of ORDEM) {
    const regra = CATEGORIAS[categoria];
    const { achadas, misturadas } = porCategoria[categoria];
    // Sem dupla contagem: se um ancestral também foi achado, a filha sai.
    const semFilhas = achadas.filter((c) => !achadas.some((pai) => dentro(c.conta, pai.conta)));
    const saida = semFilhas.map((c) => ({
      conta: c.conta, descricao: c.descricao, valor: c.valor,
      ...(regra.mista?.test(normalizar(c.descricao)) ? { mista: true } : {}),
    }));
    const comValor = misturadas.filter((c) => c.valor !== 0);
    if (comValor.length > 0) {
      resultado[categoria] = { linhas: saida, soma: null, motivo: regra.motivoMistura, misturadas: comValor.map((c) => ({ conta: c.conta, descricao: c.descricao, valor: c.valor })) };
    } else if (saida.length === 0) {
      resultado[categoria] = { linhas: [], soma: null, motivo: NAO_IDENTIFICADO };
    } else if (saida.some((c) => c.valor == null)) {
      const semValor = saida.find((c) => c.valor == null);
      resultado[categoria] = { linhas: saida, soma: null, motivo: `a linha ${semValor.conta} (${semValor.descricao}) veio sem valor único` };
    } else {
      resultado[categoria] = { linhas: saida, soma: saida.reduce((s, c) => s + c.valor, 0), motivo: null };
    }
  }
  // Uma linha que mistura dívida e arrendamento derruba as duas pontas do par.
  espalharMistura(resultado, "jurosArrendamento", "jurosPagos");
  espalharMistura(resultado, "jurosPagos", "jurosArrendamento");
  return resultado;
}

function espalharMistura(resultado, origem, destino) {
  if (!resultado[origem].misturadas || resultado[destino].misturadas) return;
  resultado[destino] = { ...resultado[destino], soma: null, motivo: resultado[origem].motivo, misturadas: resultado[origem].misturadas };
}

// Exceções por companhia (scripts/cvm/excecoes-dfc.json): cada uma diz que, naquela companhia, a linha com
// aquela descrição é de uma categoria (ou de nenhuma, com `categoria: null`). O motivo é obrigatório.
export function validarExcecoes(excecoes) {
  const erros = [];
  (excecoes ?? []).forEach((e, i) => {
    const onde = `exceção ${i + 1}`;
    if (!/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(e.cnpj ?? "")) erros.push(`${onde}: cnpj inválido`);
    if (!e.descricao || typeof e.descricao !== "string") erros.push(`${onde}: falta a descrição da linha`);
    if (e.categoria !== null && !ORDEM.includes(e.categoria)) erros.push(`${onde}: categoria desconhecida (${e.categoria})`);
    if (!e.motivo || !String(e.motivo).trim()) erros.push(`${onde}: falta o motivo`);
  });
  return erros;
}

export const excecoesDaCompanhia = (excecoes, cnpj) => (excecoes ?? []).filter((e) => e.cnpj === cnpj);
