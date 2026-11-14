// Consistência ao longo dos anos (#39): o topo da ficha, que responde "a empresa é boa e sempre foi?"
// só com contas à vista. Lógica pura: recebe a ficha (scripts/cvm/ficha.mjs) e devolve números com a
// conta escrita. Nenhum adjetivo, nenhuma nota: quem lê tira a conclusão.
//
// Regras gerais (valem aqui e em atencao.mjs):
//   - Só entram os exercícios anuais de 12 meses. Período de transição e período indisponível
//     (demonstração zerada, por exemplo) ficam de fora, e o resultado diz quantos ficaram.
//   - null nunca conta como 0 nem como negativo: sai do denominador ("9 de 10 anos com dado").
//   - Série curta: se faltam anos para a métrica, o resultado é null com o motivo "série curta (N anos)".
//     Nunca se calcula com menos pontos do que a regra pede.
// Cada métrica devolve { valor, motivo, conta, ... }: `conta` é o texto que a página mostra.
import { moeda, percentual } from "./formatar.mjs";

const ok = (valor, conta, extra = {}) => ({ valor, motivo: null, conta, ...extra });
const nulo = (motivo, extra = {}) => ({ valor: null, motivo, conta: null, ...extra });
const temValor = (v) => typeof v === "number" && Number.isFinite(v);

// Rótulo de um exercício: o ano, ou mês/ano quando não termina em dezembro.
export const rotuloDoAno = (fim) => (String(fim).slice(5) === "12-31" ? String(fim).slice(0, 4) : `${String(fim).slice(5, 7)}/${String(fim).slice(0, 4)}`);
const intervalo = (a, b) => (a === b ? rotuloDoAno(a) : `${rotuloDoAno(a)}–${rotuloDoAno(b)}`);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
export const serieCurta = (n) => `série curta (${plural(n, "ano", "anos")})`;

// O período está indisponível? É quando nem a receita, nem o lucro, nem o patrimônio têm valor.
const indisponivel = (p) => ["receita", "lucroLiquido", "patrimonioLiquido"].every((id) => !temValor(p.indicadores?.[id]?.valor));

// A série usada nas contas: os exercícios anuais de 12 meses com dado, do mais antigo ao mais recente.
// Devolve { anos: [{ fim, rotulo, indicadores }], fora: [{ fim, rotulo, motivo }] }.
export function serieDeAnos(ficha) {
  const anos = [];
  const fora = [];
  for (const p of ficha?.anual ?? []) {
    const rotulo = rotuloDoAno(p.fim);
    if (p.tipo !== "anual") fora.push({ fim: p.fim, rotulo, motivo: `exercício de ${p.meses ?? "?"} meses` });
    else if (indisponivel(p)) fora.push({ fim: p.fim, rotulo, motivo: p.indicadores?.receita?.motivo ?? "sem dados do período" });
    else anos.push({ fim: p.fim, rotulo, indicadores: p.indicadores });
  }
  return { anos, fora };
}

const valorDe = (ano, id) => { const v = ano.indicadores?.[id]?.valor; return temValor(v) ? v : null; };
// Os anos em que o indicador tem valor: [{ fim, rotulo, v }].
export const comDado = (anos, id) => anos.map((a) => ({ fim: a.fim, rotulo: a.rotulo, v: valorDe(a, id) })).filter((x) => x.v != null);

// Em quantos anos o indicador ficou acima de zero, sobre os anos com dado.
export function anosPositivos(anos, id) {
  const dados = comDado(anos, id);
  if (dados.length === 0) return nulo("nenhum ano com dado");
  const positivos = dados.filter((x) => x.v > 0).length;
  const semDado = anos.length - dados.length;
  return ok(positivos, `${positivos} de ${plural(dados.length, "ano", "anos")}${semDado ? " com dado" : ""} (${intervalo(dados[0].fim, dados.at(-1).fim)})`, {
    total: dados.length, semDado, inicio: dados[0].fim, fim: dados.at(-1).fim,
  });
}

// Maior número de anos seguidos com o indicador acima de zero. Ano sem dado quebra a sequência.
// Entre duas sequências do mesmo tamanho, fica a mais recente.
export function maiorSequenciaPositiva(anos, id) {
  if (comDado(anos, id).length === 0) return nulo("nenhum ano com dado");
  let melhor = null;
  let atual = null;
  for (const a of anos) {
    const v = valorDe(a, id);
    if (v != null && v > 0) {
      atual = atual ? { ...atual, fim: a.fim, n: atual.n + 1 } : { inicio: a.fim, fim: a.fim, n: 1 };
      if (!melhor || atual.n >= melhor.n) melhor = atual;
    } else atual = null;
  }
  if (!melhor) return ok(0, "nenhum ano com lucro", { inicio: null, fim: null, ateOUltimo: false });
  const ateOUltimo = melhor.fim === anos.at(-1).fim;
  return ok(melhor.n, `${plural(melhor.n, "ano seguido", "anos seguidos")} (${intervalo(melhor.inicio, melhor.fim)})${ateOUltimo ? ", até o último exercício" : `, encerrada em ${rotuloDoAno(melhor.fim)}`}`, {
    inicio: melhor.inicio, fim: melhor.fim, ateOUltimo,
  });
}

// Crescimento anual composto em n anos: (fim ÷ início)^(1/n) − 1. O fim é o último exercício da série
// e o início é o exercício n anos antes. Se o início ou o fim for zero, negativo ou sem dado, o
// resultado é null com o motivo; não se tenta o ano vizinho.
//   nome  como o indicador é chamado no motivo ("lucro", "receita", "FCO")
export function crescimentoComposto(anos, id, n, nome) {
  if (anos.length < n + 1) return nulo(serieCurta(anos.length), { anos: n });
  const fim = anos.at(-1);
  const anoDoInicio = Number(fim.fim.slice(0, 4)) - n;
  const inicio = anos.find((a) => a.fim === `${anoDoInicio}${fim.fim.slice(4)}`);
  if (!inicio) return nulo(`sem o exercício de ${anoDoInicio}`, { anos: n });
  const problema = (ano) => {
    const v = valorDe(ano, id);
    if (v == null) return `${nome} de ${ano.rotulo} sem dado`;
    if (v < 0) return `${nome} de ${ano.rotulo} negativo`;
    if (v === 0) return `${nome} de ${ano.rotulo} igual a zero`;
    return null;
  };
  const motivo = problema(inicio) ?? problema(fim);
  if (motivo) return nulo(motivo, { anos: n });
  const vi = valorDe(inicio, id);
  const vf = valorDe(fim, id);
  const taxa = (vf / vi) ** (1 / n) - 1;
  return ok(taxa, `${percentual(taxa)} ao ano, de ${moeda(vi)} em ${inicio.rotulo} a ${moeda(vf)} em ${fim.rotulo}`, { anos: n, inicio: inicio.fim, fim: fim.fim });
}

// Estabilidade da margem: a maior menos a menor margem líquida da série, em pontos percentuais
// (0,10 = 10 p.p.). Ano sem margem (receita zero, por exemplo) não entra.
export function estabilidadeDaMargem(anos, id = "margemLiquida") {
  const dados = comDado(anos, id);
  if (dados.length < 2) return nulo(dados.length === 0 ? "nenhum ano com dado" : serieCurta(dados.length));
  // Em caso de empate, fica o ano mais antigo.
  const menor = dados.reduce((a, b) => (b.v < a.v ? b : a));
  const maior = dados.reduce((a, b) => (b.v > a.v ? b : a));
  const amplitude = maior.v - menor.v;
  const pp = `${(amplitude * 100).toFixed(1).replace(".", ",")} p.p.`;
  return ok(amplitude, `de ${percentual(menor.v)} em ${menor.rotulo} a ${percentual(maior.v)} em ${maior.rotulo}: ${pp}`, {
    menor: { fim: menor.fim, valor: menor.v }, maior: { fim: maior.fim, valor: maior.v }, total: dados.length, texto: pp,
  });
}

// Pior ano: o menor lucro da série e quanto ele representa da média. Se a média for zero ou
// negativa, só o pior ano, sem a porcentagem.
export function piorAno(anos, id = "lucroLiquido") {
  const dados = comDado(anos, id);
  if (dados.length === 0) return nulo("nenhum ano com dado");
  const pior = dados.reduce((a, b) => (b.v < a.v ? b : a));
  const media = dados.reduce((s, x) => s + x.v, 0) / dados.length;
  const quanto = pior.v < 0 ? `prejuízo de ${moeda(-pior.v)}` : `lucro de ${moeda(pior.v)}`;
  const daMedia = media > 0 ? pior.v / media : null;
  const comparacao = daMedia == null ? `; a média da série (${moeda(media)}) não é positiva, então não há porcentagem`
    : `, ${percentual(daMedia)} da média de ${plural(dados.length, "ano", "anos")} (${moeda(media)})`;
  return ok(pior.v, `${pior.rotulo}: ${quanto}${dados.length === 1 ? "" : comparacao}`, { fim: pior.fim, media, daMedia: dados.length === 1 ? null : daMedia, total: dados.length });
}

export const PRAZOS_DE_CRESCIMENTO = [5, 10];
const CRESCIMENTOS = [["receita", "receita", "Receita"], ["lucroLiquido", "lucro", "Lucro"], ["fco", "FCO", "FCO"]];

// Tudo o que vai no topo da ficha.
// Devolve { periodo: { inicio, fim, anos, fora }, anosComLucro, anosComFclPositivo, sequenciaComLucro,
//           crescimento: [{ id, titulo, anos (5 | 10), valor, motivo, conta }], estabilidadeDaMargem, piorAno }.
export function calcularConsistencia(ficha) {
  const { anos, fora } = serieDeAnos(ficha);
  return {
    periodo: { inicio: anos[0]?.fim ?? null, fim: anos.at(-1)?.fim ?? null, anos: anos.length, fora },
    anosComLucro: anosPositivos(anos, "lucroLiquido"),
    anosComFclPositivo: anosPositivos(anos, "fcl"),
    sequenciaComLucro: maiorSequenciaPositiva(anos, "lucroLiquido"),
    crescimento: CRESCIMENTOS.flatMap(([id, nome, titulo]) => PRAZOS_DE_CRESCIMENTO.map((n) => ({ id, titulo, ...crescimentoComposto(anos, id, n, nome) }))),
    estabilidadeDaMargem: estabilidadeDaMargem(anos),
    piorAno: piorAno(anos),
  };
}
