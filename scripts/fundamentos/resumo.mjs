// HTML do topo da ficha (#39): os cartões de consistência, os pontos de atenção e a comparação com o
// setor. Lógica pura: recebe a ficha já com `consistencia`, `atencao` e `pares` e devolve texto.
// Tudo é HTML estático, sem JS. As cores são as neutras do tema: nada aqui diz se um número é bom ou
// ruim. O destaque dos pontos de atenção usa a cor de aviso, sempre com ícone e texto.
import { escapar as e } from "./html.mjs";
import { percentual, vezes } from "./formatar.mjs";
import { rotuloDoAno } from "./consistencia.mjs";

export const LEGENDA_DA_ATENCAO = "Regras automáticas sobre os números entregues à CVM. Descrevem fatos, não são recomendação.";
const SEM_VALOR = "—";
const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
const maiuscula = (t) => String(t).replace(/^./, (c) => c.toUpperCase());

// Um cartão: o rótulo, o número grande e uma linha de explicação.
const cartao = (rotulo, numero, explicacao) => `<li class="cartao"><span class="cartao-rotulo">${e(rotulo)}</span><strong class="cartao-numero">${e(numero)}</strong><span class="cartao-conta">${e(explicacao)}</span></li>`;

// Cartão de crescimento: os dois prazos lado a lado.
function cartaoDeCrescimento(titulo, itens) {
  const prazos = itens.map((c) => `<span class="prazo"><strong class="cartao-numero">${e(c.valor == null ? SEM_VALOR : percentual(c.valor))}</strong><small>em ${c.anos} anos</small></span>`).join("");
  const contas = itens.map((c) => `${c.anos} anos: ${c.valor == null ? `sem cálculo (${c.motivo})` : c.conta}`).join(". ");
  return `<li class="cartao"><span class="cartao-rotulo">${e(titulo)}: crescimento ao ano</span><span class="prazos">${prazos}</span><span class="cartao-conta">${e(contas)}.</span></li>`;
}

// Os cartões de consistência.
export function consistenciaHtml(c) {
  if (!c) return "";
  const { periodo } = c;
  const serie = periodo.anos === 0 ? "Sem exercício de 12 meses com dado."
    : `Série de ${plural(periodo.anos, "exercício", "exercícios")} de 12 meses, de ${rotuloDoAno(periodo.inicio)} a ${rotuloDoAno(periodo.fim)}.`;
  const fora = periodo.fora.length
    ? ` ${plural(periodo.fora.length, "período ficou", "períodos ficaram")} de fora das contas: ${periodo.fora.map((f) => `${f.rotulo} (${f.motivo})`).join("; ")}.`
    : "";
  const fracao = (m) => (m.valor == null ? [SEM_VALOR, m.motivo] : [`${m.valor} de ${m.total}`, `${m.semDado ? `anos com dado, ${rotuloDoAno(m.inicio)}–${rotuloDoAno(m.fim)}; ${plural(m.semDado, "ano", "anos")} sem dado` : `anos, ${rotuloDoAno(m.inicio)}–${rotuloDoAno(m.fim)}`}`]);
  const seq = c.sequenciaComLucro;
  const margem = c.estabilidadeDaMargem;
  const pior = c.piorAno;
  const crescimentos = ["Receita", "Lucro", "FCO"].map((titulo) => cartaoDeCrescimento(titulo, c.crescimento.filter((x) => x.titulo === titulo)));
  const cartoes = [
    cartao("Anos com lucro", ...fracao(c.anosComLucro)),
    cartao("Anos com FCL positivo", ...fracao(c.anosComFclPositivo)),
    cartao("Maior sequência com lucro", seq.valor == null ? SEM_VALOR : plural(seq.valor, "ano", "anos"), seq.valor == null ? seq.motivo : seq.conta),
    ...crescimentos,
    cartao("Margem líquida: da menor à maior", margem.valor == null ? SEM_VALOR : margem.texto, margem.valor == null ? margem.motivo : margem.conta),
    cartao("Pior ano da série", pior.valor == null ? SEM_VALOR : rotuloDoAno(pior.fim), pior.valor == null ? pior.motivo : pior.conta),
  ];
  return `<h3>Ao longo dos anos</h3>
<p class="explica">${e(serie + fora)}</p>
<ul class="cartoes">${cartoes.join("")}</ul>`;
}

const ESTADO = { true: "acionada", false: "não acionada", null: "não avaliada" };

// Os pontos de atenção: primeiro as regras acionadas, depois as sete num <details> fechado.
export function atencaoHtml(a) {
  if (!a) return "";
  const acionadas = a.regras.filter((r) => r.acionada === true);
  const destaque = acionadas.length
    ? `<ul class="acionadas">${acionadas.map((r) => `<li><span class="icone" aria-hidden="true">⚠</span><span><strong>${e(r.titulo)}.</strong> ${e(maiuscula(r.conta))}. <small>Limite: ${e(r.limite)}.</small></span></li>`).join("")}</ul>`
    : `<p class="nenhuma">Nenhuma das ${a.total} regras acionada. <a href="#todas-as-regras">Ver as ${a.total} regras</a>.</p>`;
  const todas = a.regras.map((r) => {
    const estado = ESTADO[String(r.acionada)];
    const texto = r.acionada === null ? `${estado}: ${r.motivo}` : `${estado}. ${maiuscula(r.conta)}`;
    return `<li class="${r.acionada === true ? "acionada" : ""}"><strong>${e(r.titulo)}</strong><span>${r.acionada === true ? '<span class="icone" aria-hidden="true">⚠</span> ' : ""}${e(maiuscula(texto))}.</span><small>Limite: ${e(r.limite)}.</small></li>`;
  }).join("");
  const resumo = `${plural(acionadas.length, "acionada", "acionadas")}, ${a.total - acionadas.length - a.naoAvaliadas} não ${a.total - acionadas.length - a.naoAvaliadas === 1 ? "acionada" : "acionadas"} e ${plural(a.naoAvaliadas, "não avaliada", "não avaliadas")}`;
  return `<section class="atencao" id="pontos-de-atencao">
<h3>Pontos de atenção</h3>
<p class="explica">${e(LEGENDA_DA_ATENCAO)}</p>
${destaque}
<details id="todas-as-regras"><summary>As ${a.total} regras e o estado de cada uma (${e(resumo)})</summary><ul class="regras">${todas}</ul></details>
</section>`;
}

const escrever = (valor, formato) => (valor == null ? SEM_VALOR : formato === "vezes" ? vezes(valor) : percentual(valor));

// A comparação com o setor: uma tabela curta, com a mesma cor para acima e abaixo da mediana.
export function paresHtml(p) {
  if (!p) return "";
  const titulo = `<h3>Comparação com o setor</h3>`;
  if (!p.exercicio || p.empresas < 3) {
    return `<section class="pares" id="comparacao-com-o-setor">${titulo}<p class="explica">Setor: ${e(p.setor)}. ${p.exercicio ? `No exercício de ${e(rotuloDoAno(p.exercicio))} há ${plural(p.empresas, "empresa", "empresas")} do setor com dados` : "Não há um exercício em comum no setor"}: setor com menos de 3 empresas com dado, então não há mediana.</p></section>`;
  }
  const linhas = p.itens.map((i) => {
    const posicao = i.posicao ? `${e(maiuscula(i.posicao))}; ${e(i.faixa)}` : `<span class="vazio">${e(maiuscula(i.motivo))}</span>`;
    const amostra = i.mediana == null ? "" : ` title="${e(`Mediana de ${i.empresas} empresas: ${i.tickers.join(", ")}`)}"`;
    return `<tr><th scope="row">${e(i.nome)}</th><td class="n">${e(escrever(i.valor, i.formato))}</td><td class="n"${amostra}>${e(escrever(i.mediana, i.formato))}${i.mediana == null ? "" : ` <small>(${i.empresas})</small>`}</td><td>${posicao}</td></tr>`;
  }).join("");
  const semExercicio = p.temExercicio ? "" : ` Esta companhia não tem o exercício de ${e(rotuloDoAno(p.exercicio))} e fica fora das medianas.`;
  return `<section class="pares" id="comparacao-com-o-setor">
${titulo}
<p class="explica">Mediana de ${p.empresas} empresas do setor ${e(p.setor)}, no exercício de ${e(rotuloDoAno(p.exercicio))}. Estar acima ou abaixo da mediana é só uma posição: não diz se o número é favorável.${semExercicio}</p>
<details class="amostra"><summary>As ${p.empresas} empresas da amostra</summary><p>${e(p.tickers.join(", "))}. Os setores juntam negócios diferentes; a mediana só aparece com 3 ou mais empresas com dado, e o número entre parênteses diz quantas entraram em cada linha.</p></details>
<div class="rolagem"><table class="comparacao"><thead><tr><th scope="col">Indicador</th><th scope="col">Empresa</th><th scope="col">Mediana do setor</th><th scope="col">Posição</th></tr></thead><tbody>${linhas}</tbody></table></div>
</section>`;
}

// O conteúdo do espaço #resumo-consistencia da ficha.
export function resumoHtml(ficha) {
  return [consistenciaHtml(ficha.consistencia), atencaoHtml(ficha.atencao), paresHtml(ficha.pares)].filter(Boolean).join("\n");
}
