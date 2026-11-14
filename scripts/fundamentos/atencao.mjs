// Pontos de atenção (#39): sete regras automáticas sobre os números entregues à CVM. Lógica pura.
// Cada regra descreve um fato, com a conta e os anos à vista. Não é recomendação, não dá nota e não
// classifica a companhia.
//
// Cada regra devolve { id, titulo, limite, acionada, conta, anos, motivo }:
//   acionada  true, false ou null (não avaliada; `motivo` diz por quê)
//   conta     o texto com os números da regra
//   anos      os exercícios (rótulos) em que a condição apareceu
//   limite    o texto do limite usado, que a página mostra em cada regra
// Regras gerais: as mesmas de consistencia.mjs (só exercícios de 12 meses, null nunca é zero, série
// curta não é calculada). "Hoje" é a base de 12 meses; quando ela não tem o dado, vale o último
// exercício, e a conta diz isso.
import { data, moeda, numero, percentual, vezes } from "./formatar.mjs";
import { rotuloDoAno, serieCurta, serieDeAnos } from "./consistencia.mjs";

// Limites das regras. Podem ser trocados por variáveis do Actions (configAtencao), como os alertas do Diário.
export const LIMITES_ATENCAO = {
  fcoSobreLucro: 0.8, // FCO ÷ lucro abaixo disto conta como "lucro que não virou caixa" no ano
  fcoSobreLucroAnos: 3, // em quantos anos, dentro da janela
  fcoSobreLucroJanela: 5, // tamanho da janela, em exercícios
  dividaLiquidaSobreEbitda: 3, // dívida líquida ÷ EBITDA acima disto
  dividaCurtoPrazo: 0.5, // parcela da dívida bruta que vence em até 12 meses acima disto
  capexAnos: 3, // exercícios seguidos com capex maior que o FCO
  diluicaoAnual: 0.02, // crescimento anual composto do número de ações acima disto
  diluicaoJanela: 3, // exercícios da janela da diluição
  margemQuedas: 3, // quedas seguidas da margem líquida
  proventosJanela: 5, // exercícios com dado somados em "proventos maiores que o FCL"
  proventosMinimo: 3, // mínimo de exercícios com dado para avaliar essa regra
};

// Variável do Actions de cada limite.
export const VARIAVEIS_ATENCAO = {
  fcoSobreLucro: "ATENCAO_FCO_SOBRE_LUCRO",
  dividaLiquidaSobreEbitda: "ATENCAO_DIVIDA_EBITDA",
  dividaCurtoPrazo: "ATENCAO_DIVIDA_CURTO_PRAZO",
  diluicaoAnual: "ATENCAO_DILUICAO_ANUAL",
};

// Lê os limites das variáveis do Actions; valor ausente, zero, negativo ou não numérico usa o padrão.
export function configAtencao(env = {}) {
  const ler = (nome, padrao) => { const n = Number(env[nome]); return env[nome] !== "" && env[nome] != null && Number.isFinite(n) && n > 0 ? n : padrao; };
  const limites = { ...LIMITES_ATENCAO };
  for (const [campo, variavel] of Object.entries(VARIAVEIS_ATENCAO)) limites[campo] = ler(variavel, LIMITES_ATENCAO[campo]);
  return limites;
}

const temValor = (v) => typeof v === "number" && Number.isFinite(v);
// Folga para erro de ponto flutuante numa taxa calculada com raiz: "exatamente no limite" não aciona.
const EPS = 1e-9;
const lista = (itens) => (itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`);
const num = (v, casas = 1) => v.toFixed(casas).replace(".", ",");
// Percentual de um limite: sem casa quando é inteiro ("50%"), com uma quando não é ("2,5%").
const pct = (fracao) => { const v = Math.round(fracao * 1000) / 10; return `${num(v, Number.isInteger(v) ? 0 : 1)}%`; };

const regra = (id, titulo, limite, r) => ({ id, titulo, limite, acionada: r.acionada, conta: r.conta ?? null, anos: r.anos ?? [], motivo: r.motivo ?? null });
const naoAvaliada = (motivo) => ({ acionada: null, motivo });

// Os indicadores de "hoje": os 12 meses, ou o último exercício quando os 12 meses não têm todos os
// `ids` pedidos. Devolve { indicadores, quando } ou null (quando nenhum dos dois serve).
export function fonteDeHoje(ficha, anos, ids) {
  const completo = (ind) => ids.every((id) => temValor(ind?.[id]?.valor));
  if (ficha?.doze?.fim && completo(ficha.doze.indicadores)) return { indicadores: ficha.doze.indicadores, quando: `nos 12 meses até ${data(ficha.doze.fim)}`, doze: true };
  const ultimo = anos.at(-1);
  if (ultimo && completo(ultimo.indicadores)) return { indicadores: ultimo.indicadores, quando: `no exercício de ${ultimo.rotulo} (os 12 meses não têm esse dado)`, doze: false };
  return null;
}
// Por que não há fonte: o motivo do primeiro dado que falta, no último exercício ou nos 12 meses.
function motivoSemFonte(ficha, anos, ids) {
  const ind = anos.at(-1)?.indicadores ?? ficha?.doze?.indicadores ?? {};
  const falta = ids.find((id) => !temValor(ind?.[id]?.valor));
  return `sem dado nos 12 meses nem no último exercício${falta && ind[falta]?.motivo ? `: ${ind[falta].motivo}` : ""}`;
}

// 1. Lucro que não vira caixa: FCO ÷ lucro abaixo do limite em N dos últimos M exercícios.
// Só avalia ano com lucro acima de zero; ano com prejuízo não entra na conta, e o texto diz.
export function lucroQueNaoViraCaixa(anos, L = LIMITES_ATENCAO) {
  const limite = `FCO ÷ lucro abaixo de ${num(L.fcoSobreLucro)} em ${L.fcoSobreLucroAnos} dos últimos ${L.fcoSobreLucroJanela} exercícios`;
  const fazer = () => {
    if (anos.length < L.fcoSobreLucroJanela) return naoAvaliada(serieCurta(anos.length));
    const janela = anos.slice(-L.fcoSobreLucroJanela);
    const prejuizo = janela.filter((a) => temValor(a.indicadores.lucroLiquido?.valor) && a.indicadores.lucroLiquido.valor <= 0);
    const avaliaveis = janela.filter((a) => temValor(a.indicadores.lucroLiquido?.valor) && a.indicadores.lucroLiquido.valor > 0 && temValor(a.indicadores.fco?.valor))
      .map((a) => ({ rotulo: a.rotulo, razao: a.indicadores.fco.valor / a.indicadores.lucroLiquido.valor }));
    const fora = prejuizo.length ? `; ${lista(prejuizo.map((a) => a.rotulo))} com prejuízo ${prejuizo.length === 1 ? "ficou" : "ficaram"} fora da conta` : "";
    if (avaliaveis.length < L.fcoSobreLucroAnos) {
      return naoAvaliada(`só ${avaliaveis.length} de ${janela.length} exercícios com lucro e FCO para avaliar (mínimo: ${L.fcoSobreLucroAnos})${fora}`);
    }
    const abaixo = avaliaveis.filter((x) => x.razao < L.fcoSobreLucro);
    const detalhe = avaliaveis.map((x) => `${x.rotulo}: ${num(x.razao, 2)}`).join("; ");
    return {
      acionada: abaixo.length >= L.fcoSobreLucroAnos, anos: abaixo.map((x) => x.rotulo),
      conta: `FCO ÷ lucro abaixo de ${num(L.fcoSobreLucro)} em ${abaixo.length ? lista(abaixo.map((x) => x.rotulo)) : "nenhum ano"} (${abaixo.length} de ${avaliaveis.length} exercícios avaliados; ${detalhe})${fora}`,
    };
  };
  return regra("lucroQueNaoViraCaixa", "Lucro que não vira caixa", limite, fazer());
}

// 2. Proventos maiores que o FCL: a soma dos proventos pagos nos últimos N exercícios com dado é maior
// que a soma do FCL nos mesmos anos. Olhar vários anos tira o efeito de um ano só (um dividendo
// extraordinário, um ano de investimento pesado). Precisa de um mínimo de exercícios com os dois
// dados. Os 12 meses entram só como contexto, na conta.
export function proventosMaioresQueFcl(ficha, anos, L = LIMITES_ATENCAO) {
  const limite = `soma dos proventos pagos maior que a soma do FCL nos últimos ${L.proventosJanela} exercícios com dado (mínimo de ${L.proventosMinimo})`;
  const fazer = () => {
    const comDado = anos.filter((a) => temValor(a.indicadores.proventosPagos?.valor) && temValor(a.indicadores.fcl?.valor));
    if (comDado.length < L.proventosMinimo) {
      const semDado = anos.find((a) => !temValor(a.indicadores.proventosPagos?.valor) || !temValor(a.indicadores.fcl?.valor));
      const porque = semDado ? `: ${(!temValor(semDado.indicadores.proventosPagos?.valor) ? semDado.indicadores.proventosPagos : semDado.indicadores.fcl)?.motivo ?? "sem dado"}` : "";
      return naoAvaliada(`só ${comDado.length} ${comDado.length === 1 ? "exercício" : "exercícios"} com proventos e FCL (mínimo: ${L.proventosMinimo})${anos.length < L.proventosMinimo ? `; ${serieCurta(anos.length)}` : porque}`);
    }
    const janela = comDado.slice(-L.proventosJanela);
    const proventos = janela.reduce((soma, a) => soma + a.indicadores.proventosPagos.valor, 0);
    const fcl = janela.reduce((soma, a) => soma + a.indicadores.fcl.valor, 0);
    const maiores = janela.filter((a) => a.indicadores.proventosPagos.valor > a.indicadores.fcl.valor);
    const rotulos = janela.map((a) => a.rotulo);
    const periodo = janela.length === 1 ? rotulos[0] : `${rotulos[0]} a ${rotulos.at(-1)}`;
    const pulados = Number(janela.at(-1).fim.slice(0, 4)) - Number(janela[0].fim.slice(0, 4)) + 1 !== janela.length ? ` (${lista(rotulos)})` : "";
    const anoAAno = `ano a ano, os proventos passaram do FCL em ${maiores.length ? lista(maiores.map((a) => a.rotulo)) : "nenhum ano"}`;
    const d = ficha?.doze?.indicadores;
    const hoje = ficha?.doze?.fim && temValor(d?.proventosPagos?.valor) && temValor(d?.fcl?.valor)
      ? `. Nos 12 meses até ${data(ficha.doze.fim)}: proventos de ${moeda(d.proventosPagos.valor)} e FCL de ${moeda(d.fcl.valor)}` : "";
    return {
      acionada: proventos > fcl, anos: rotulos,
      conta: `proventos pagos de ${moeda(proventos)} e FCL de ${moeda(fcl)}, somados os ${janela.length} exercícios de ${periodo}${pulados}; ${anoAAno}${hoje}`,
    };
  };
  return regra("proventosMaioresQueFcl", "Proventos maiores que o FCL", limite, fazer());
}

// 3. Dívida líquida ÷ EBITDA acima do limite, hoje. Sem arrendamentos; a conta mostra a versão com
// arrendamentos ao lado, quando existe. EBITDA zero ou negativo com dívida líquida aciona a regra.
export function dividaLiquidaAlta(ficha, anos, L = LIMITES_ATENCAO) {
  const limite = `dívida líquida ÷ EBITDA acima de ${num(L.dividaLiquidaSobreEbitda)}`;
  const fazer = () => {
    const fonte = fonteDeHoje(ficha, anos, ["dividaLiquida", "ebitda"]);
    if (!fonte) return naoAvaliada(motivoSemFonte(ficha, anos, ["dividaLiquida", "ebitda"]));
    const divida = fonte.indicadores.dividaLiquida.valor;
    const ebitda = fonte.indicadores.ebitda.valor;
    if (divida <= 0) return { acionada: false, conta: `o caixa é maior que a dívida: caixa líquido de ${moeda(-divida)} ${fonte.quando}` };
    if (ebitda <= 0) return { acionada: true, conta: `EBITDA negativo com dívida líquida: EBITDA de ${moeda(ebitda)} e dívida líquida de ${moeda(divida)} ${fonte.quando}` };
    const razao = divida / ebitda;
    const comArr = fonte.indicadores.dividaLiquidaComArrendamentos?.valor;
    const lado = temValor(comArr) ? `; com arrendamentos, ${vezes(comArr / ebitda)}` : "";
    return { acionada: razao > L.dividaLiquidaSobreEbitda, conta: `dívida líquida ÷ EBITDA de ${vezes(razao)} ${fonte.quando} (${moeda(divida)} ÷ ${moeda(ebitda)})${lado}` };
  };
  return regra("dividaLiquidaAlta", "Dívida líquida ÷ EBITDA alta", limite, fazer());
}

// 4. Dívida concentrada no curto prazo: mais do que o limite da dívida bruta vence em até 12 meses,
// E a dívida líquida é positiva. Com caixa maior que a dívida (WEG), a concentração não é acionada.
export function dividaNoCurtoPrazo(ficha, anos, L = LIMITES_ATENCAO) {
  const limite = `mais de ${pct(L.dividaCurtoPrazo)} da dívida bruta no curto prazo, com dívida líquida positiva`;
  const fazer = () => {
    const bruta = fonteDeHoje(ficha, anos, ["dividaBruta"]);
    if (!bruta) return naoAvaliada(motivoSemFonte(ficha, anos, ["dividaBruta"]));
    if (bruta.indicadores.dividaBruta.valor <= 0) return naoAvaliada(`sem dívida financeira ${bruta.quando}`);
    const fonte = fonteDeHoje(ficha, anos, ["dividaBruta", "dividaCurtoPrazo", "dividaLiquida"]);
    if (!fonte) return naoAvaliada(motivoSemFonte(ficha, anos, ["dividaCurtoPrazo", "dividaLiquida"]));
    const parcela = fonte.indicadores.dividaCurtoPrazo.valor;
    const liquida = fonte.indicadores.dividaLiquida.valor;
    const texto = `${percentual(parcela)} da dívida bruta vence em até 12 meses ${fonte.quando}`;
    if (liquida <= 0) return { acionada: false, conta: `${texto}, mas o caixa é maior que a dívida (caixa líquido de ${moeda(-liquida)})` };
    return { acionada: parcela > L.dividaCurtoPrazo, conta: `${texto}, com dívida líquida de ${moeda(liquida)}` };
  };
  return regra("dividaNoCurtoPrazo", "Dívida concentrada no curto prazo", limite, fazer());
}

// 5. Capex maior que o FCO nos últimos N exercícios seguidos. Um ano sem dado na janela deixa a regra sem avaliar.
export function capexMaiorQueFco(anos, L = LIMITES_ATENCAO) {
  const limite = `capex maior que o FCO nos últimos ${L.capexAnos} exercícios seguidos`;
  const fazer = () => {
    if (anos.length < L.capexAnos) return naoAvaliada(serieCurta(anos.length));
    const janela = anos.slice(-L.capexAnos);
    const semDado = janela.filter((a) => !temValor(a.indicadores.capex?.valor) || !temValor(a.indicadores.fco?.valor));
    if (semDado.length) return naoAvaliada(`sem capex ou FCO em ${lista(semDado.map((a) => a.rotulo))}`);
    const maiores = janela.filter((a) => a.indicadores.capex.valor > a.indicadores.fco.valor);
    const detalhe = janela.map((a) => `${a.rotulo}: capex de ${moeda(a.indicadores.capex.valor)} e FCO de ${moeda(a.indicadores.fco.valor)}`).join("; ");
    return { acionada: maiores.length === janela.length, anos: maiores.map((a) => a.rotulo), conta: `capex maior que o FCO em ${maiores.length} dos últimos ${janela.length} exercícios (${detalhe})` };
  };
  return regra("capexMaiorQueFco", "Capex maior que o FCO", limite, fazer());
}

// 6. Diluição: crescimento anual composto do número de ações em circulação acima do limite, nos
// últimos N exercícios. Precisa de pelo menos 2 exercícios com o número de ações. Se houve
// desdobramento ou grupamento dentro da janela, a regra não é avaliada.
export function diluicao(anos, L = LIMITES_ATENCAO) {
  const limite = `número de ações crescendo mais de ${pct(L.diluicaoAnual)} ao ano nos últimos ${L.diluicaoJanela} exercícios`;
  const fazer = () => {
    const janela = anos.slice(-L.diluicaoJanela).filter((a) => temValor(a.indicadores.acoesCirculacao?.valor) && a.indicadores.acoesCirculacao.valor > 0);
    if (janela.length < 2) return naoAvaliada(`só ${janela.length} ${janela.length === 1 ? "exercício" : "exercícios"} com o número de ações na janela (mínimo: 2)`);
    // A quebra fica marcada no exercício em que o número mudou; a do primeiro ponto é anterior à janela.
    const quebra = janela.slice(1).find((a) => /desdobramento ou grupamento/.test(a.indicadores.diluicao?.motivo ?? ""));
    if (quebra) return naoAvaliada(`evento societário na janela (${quebra.rotulo}: ${quebra.indicadores.diluicao.motivo})`);
    const primeiro = janela[0];
    const ultimo = janela.at(-1);
    const n = Number(ultimo.fim.slice(0, 4)) - Number(primeiro.fim.slice(0, 4));
    if (n < 1) return naoAvaliada("os exercícios da janela são do mesmo ano");
    const taxa = (ultimo.indicadores.acoesCirculacao.valor / primeiro.indicadores.acoesCirculacao.valor) ** (1 / n) - 1;
    const milhoes = (v) => `${numero(v / 1e6, 1)} milhões`;
    return {
      acionada: taxa > L.diluicaoAnual + EPS, anos: [primeiro.rotulo, ultimo.rotulo],
      conta: `o número de ações variou ${percentual(taxa)} ao ano entre ${primeiro.rotulo} e ${ultimo.rotulo} (de ${milhoes(primeiro.indicadores.acoesCirculacao.valor)} para ${milhoes(ultimo.indicadores.acoesCirculacao.valor)})`,
    };
  };
  return regra("diluicao", "Diluição", limite, fazer());
}

// 7. Margem líquida em queda: N quedas seguidas (N + 1 pontos), terminando no último exercício.
export function margemEmQueda(anos, L = LIMITES_ATENCAO) {
  const limite = `margem líquida caindo ${L.margemQuedas} exercícios seguidos, até o último`;
  const fazer = () => {
    const pontos = L.margemQuedas + 1;
    if (anos.length < pontos) return naoAvaliada(serieCurta(anos.length));
    const janela = anos.slice(-pontos);
    const semDado = janela.filter((a) => !temValor(a.indicadores.margemLiquida?.valor));
    if (semDado.length) return naoAvaliada(`sem margem líquida em ${lista(semDado.map((a) => a.rotulo))}`);
    const margens = janela.map((a) => a.indicadores.margemLiquida.valor);
    const quedas = margens.slice(1).filter((m, i) => m < margens[i]).length;
    const detalhe = janela.map((a, i) => `${percentual(margens[i])} em ${a.rotulo}`).join(", ");
    return { acionada: quedas === L.margemQuedas, anos: janela.map((a) => a.rotulo), conta: `margem líquida: ${detalhe}` };
  };
  return regra("margemEmQueda", "Margem líquida em queda", limite, fazer());
}

// As sete regras, na ordem da página.
// Devolve { regras: [...], acionadas: n, naoAvaliadas: n, total: 7, limites }.
export function calcularAtencao(ficha, limites = LIMITES_ATENCAO) {
  const { anos } = serieDeAnos(ficha);
  const regras = [
    lucroQueNaoViraCaixa(anos, limites),
    proventosMaioresQueFcl(ficha, anos, limites),
    dividaLiquidaAlta(ficha, anos, limites),
    dividaNoCurtoPrazo(ficha, anos, limites),
    capexMaiorQueFco(anos, limites),
    diluicao(anos, limites),
    margemEmQueda(anos, limites),
  ];
  return {
    regras,
    acionadas: regras.filter((r) => r.acionada === true).length,
    naoAvaliadas: regras.filter((r) => r.acionada === null).length,
    total: regras.length,
    limites,
  };
}

export { rotuloDoAno };
