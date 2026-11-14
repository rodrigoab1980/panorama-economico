// Régua de anos (#65): uma faixa com um bloco por exercício, logo abaixo do nome da companhia.
// Responde "sempre foi?" antes de qualquer tabela. Lógica pura: recebe a ficha e devolve os blocos e o HTML.
//
// É fato, não julgamento: os três estados usam a mesma cor, e só o preenchimento muda.
//   lucro      bloco cheio
//   prejuizo   bloco vazado (só o contorno)
//   sem-dado   bloco tracejado: o exercício não tem lucro informado, a demonstração veio zerada, ou
//              não há documento daquele ano
// Lucro igual a zero conta como "prejuizo" na forma (não é lucro), e o texto do bloco diz "resultado zero".
import { escapar as e } from "./html.mjs";
import { moeda } from "./formatar.mjs";
import { rotuloDoAno } from "./consistencia.mjs";

const temValor = (v) => typeof v === "number" && Number.isFinite(v);
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

// Os blocos da régua, do exercício mais antigo ao mais recente:
//   [{ fim, rotulo, estado ("lucro" | "prejuizo" | "sem-dado"), texto }]
// `texto` é o que vai no title e para o leitor de tela: "2015: lucro de R$ 1,2 bi".
// Um ano sem exercício no meio da série vira um bloco "sem-dado", para a régua não esconder o buraco.
export function reguaDeAnos(ficha) {
  const blocos = [];
  let anoAnterior = null;
  for (const p of ficha?.anual ?? []) {
    const anoDoPeriodo = Number(String(p.fim).slice(0, 4));
    for (let a = (anoAnterior ?? anoDoPeriodo) + 1; a < anoDoPeriodo; a++) {
      blocos.push({ fim: null, rotulo: String(a), estado: "sem-dado", texto: `${a}: sem exercício na série` });
    }
    anoAnterior = anoDoPeriodo;
    const rotulo = rotuloDoAno(p.fim);
    const lucro = p.indicadores?.lucroLiquido;
    const transicao = p.tipo !== "anual" ? ` (exercício de ${p.meses ?? "?"} meses)` : "";
    if (!temValor(lucro?.valor)) {
      blocos.push({ fim: p.fim, rotulo, estado: "sem-dado", texto: `${rotulo}: sem dado (${lucro?.motivo ?? "lucro não informado"})` });
    } else if (lucro.valor > 0) {
      blocos.push({ fim: p.fim, rotulo, estado: "lucro", texto: `${rotulo}: lucro de ${moeda(lucro.valor)}${transicao}` });
    } else {
      blocos.push({ fim: p.fim, rotulo, estado: "prejuizo", texto: `${rotulo}: ${lucro.valor === 0 ? "resultado zero" : `prejuízo de ${moeda(-lucro.valor)}`}${transicao}` });
    }
  }
  return blocos;
}

// Resumo da régua numa frase, para a legenda e para o leitor de tela.
export function resumoDaRegua(blocos) {
  if (blocos.length === 0) return "Sem exercícios na série.";
  const conta = (estado) => blocos.filter((b) => b.estado === estado).length;
  const partes = [`lucro em ${conta("lucro")} de ${plural(blocos.length, "exercício", "exercícios")}`];
  if (conta("prejuizo")) partes.push(`prejuízo em ${conta("prejuizo")}`);
  if (conta("sem-dado")) partes.push(`${conta("sem-dado")} sem dado`);
  const periodo = blocos.length === 1 ? blocos[0].rotulo : `${blocos[0].rotulo} a ${blocos.at(-1).rotulo}`;
  return `${periodo}: ${partes.join(", ")}.`;
}

// Quais blocos mostram o ano embaixo: o primeiro, o último e os anos múltiplos de 5 (os outros
// ficam só no title, para a régua caber no celular). Um múltiplo de 5 colado no primeiro ou no último
// bloco fica sem o ano: no celular os dois números se encostariam.
export const mostraAno = (bloco, i, total) => i === 0 || i === total - 1
  || (Number(bloco.rotulo.slice(-4)) % 5 === 0 && i !== 1 && i !== total - 2);

// A legenda dos três estados, igual na ficha e na lista.
export const LEGENDA_DA_REGUA = `<ul class="regua-legenda" aria-hidden="true"><li class="lucro">lucro</li><li class="prejuizo">prejuízo</li><li class="sem-dado">sem dado</li></ul>`;
export const TITULO_DA_REGUA = "Resultado de cada exercício";

// HTML da régua. Cada exercício tem a mesma largura (fixa no CSS): uma série curta fica curta, não
// estica até a borda. `miniatura: true` tira os anos e a legenda (para a lista de companhias); ali o
// resumo vai no aria-label e cada bloco só leva o title.
export function reguaHtml(ficha, { miniatura = false } = {}) {
  const blocos = reguaDeAnos(ficha);
  if (blocos.length === 0) return "";
  const resumo = resumoDaRegua(blocos);
  const itens = blocos.map((b, i) => {
    const ano = !miniatura && mostraAno(b, i, blocos.length) ? `<small aria-hidden="true">${e(b.rotulo.slice(-4))}</small>` : "";
    return miniatura ? `<li class="${b.estado}" title="${e(b.texto)}"></li>`
      : `<li class="${b.estado}" title="${e(b.texto)}"><span class="so-leitor">${e(b.texto)}</span>${ano}</li>`;
  }).join("");
  const lista = `<ol class="regua-anos">${itens}</ol>`;
  if (miniatura) return `<div class="regua miniatura" role="img" aria-label="${e(`Resultado por exercício, ${resumo}`)}">${lista}</div>`;
  return `<figure class="regua">
<figcaption><strong>${TITULO_DA_REGUA}</strong> <span class="regua-resumo">${e(resumo)}</span></figcaption>
${lista}
${LEGENDA_DA_REGUA}
</figure>`;
}
