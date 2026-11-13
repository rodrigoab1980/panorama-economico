// Série anual e base de 12 meses de UMA companhia, a partir dos fatos do leitor (scripts/cvm/leitor.mjs).
// Lógica pura: sem disco, sem rede e sem relógio.
//
// Regras (briefing da #33, resumidas em docs/cvm.md):
// 1. Período é data. Fluxo (DRE, DFC, DVA) é (inicio, fim); estoque (BPA, BPP) é fim. Nada aqui usa
//    "ano civil" nem "trimestre 1 a 4": a São Martinho fecha o exercício em 31/03.
// 2. Reapresentação: para o exercício que termina em F, vale o PENÚLTIMO da DFP seguinte, quando existe.
//    A escolha é por (período, demonstrativo) inteiro, nunca conta a conta.
// 3. Base de 12 meses = anual da última DFP + acumulado do ITR mais recente − acumulado do mesmo intervalo
//    do ano anterior. O acumulado anterior vem do ITR do ano anterior COMO ENTREGUE (ÚLTIMO), não do
//    PENÚLTIMO do ITR atual: assim a parcela subtraída é a que está dentro do anual da DFP. As três parcelas
//    têm de estar na mesma base (consolidado ou individual). Se o ITR não encaixa na DFP, se falta o ITR do
//    ano anterior ou se a base muda, o resultado é null com motivo.
// 4. Ausência é null. Zero só quando a CVM informa zero. null em qualquer parcela dá null.

import { ehPorAcao } from "./leitor.mjs";

const DIA = 86_400_000;
const ms = (iso) => Date.parse(`${iso}T00:00:00Z`);

// Dias corridos do intervalo, contando os dois extremos (01/01 a 31/12 = 365).
export const diasDoIntervalo = (inicio, fim) => Math.round((ms(fim) - ms(inicio)) / DIA) + 1;
export const somarDias = (iso, n) => new Date(ms(iso) + n * DIA).toISOString().slice(0, 10);

// Mesmo dia do ano anterior (29/02 vira 28/02).
export function umAnoAntes(iso) {
  const [a, m, d] = iso.split("-");
  const dia = m === "02" && d === "29" ? "28" : d;
  return `${Number(a) - 1}-${m}-${dia}`;
}

const perto = (isoA, isoB) => Math.abs(ms(isoA) - ms(isoB)) <= DIA; // tolera 1 dia (ano bissexto)

// O intervalo `anterior` é o mesmo de `atual`, um ano antes?
export const mesmoIntervaloUmAnoAntes = (atual, anterior) =>
  perto(anterior.inicio, umAnoAntes(atual.inicio)) && perto(anterior.fim, umAnoAntes(atual.fim));

// Classifica um intervalo pela duração e pelo documento:
//   posicao    estoque (sem início)
//   anual      fluxo de DFP com cerca de 12 meses (350 a 380 dias)
//   transicao  fluxo de DFP com outra duração (exercício de transição): não é ano comparável
//   trimestre  fluxo de ITR com cerca de 3 meses (85 a 95 dias)
//   acumulado  fluxo de ITR com outra duração (6 ou 9 meses)
// No primeiro trimestre do exercício, trimestre e acumulado são o mesmo intervalo: para achar o
// acumulado, use intervaloAcumulado(), que não depende desta etiqueta.
export function classificarIntervalo({ documento, inicio, fim }) {
  if (inicio == null) return { tipo: "posicao", dias: null, meses: null };
  const dias = diasDoIntervalo(inicio, fim);
  const meses = Math.round(dias / 30.4375);
  if (documento === "dfp") return { tipo: dias >= 350 && dias <= 380 ? "anual" : "transicao", dias, meses };
  return { tipo: dias >= 85 && dias <= 95 ? "trimestre" : "acumulado", dias, meses };
}

// Entre intervalos que terminam na mesma data, o acumulado é o que começa mais cedo
// (no início do exercício social). Com um só intervalo, é ele mesmo.
export function intervaloAcumulado(intervalos) {
  return intervalos.reduce((a, b) => (a == null || b.inicio < a.inicio ? b : a), null);
}

// A conta dos 12 meses, genérica: a #36 reutiliza sobre linhas classificadas (capex, juros, proventos).
export function doze(anual, acumuladoAtual, acumuladoAnterior) {
  if (anual == null || acumuladoAtual == null || acumuladoAnterior == null) return null;
  return anual + acumuladoAtual - acumuladoAnterior;
}

// DFC_MI e DFC_MD são o mesmo demonstrativo ("DFC") em dois métodos.
const familia = (demonstrativo) => (demonstrativo.startsWith("DFC_") ? "DFC" : demonstrativo);
const metodo = (demonstrativo) => (demonstrativo.startsWith("DFC_") ? demonstrativo.slice(4) : null);
const FLUXOS = ["DRE", "DFC", "DVA"];
const ESTOQUES = ["BPA", "BPP"];

// Agrupa os fatos em documentos e, dentro de cada um, em blocos (demonstrativo + ordem + intervalo).
function documentosDe(fatos) {
  const docs = new Map();
  for (const f of fatos) {
    const k = `${f.documento}|${f.dtRefer}`;
    if (!docs.has(k)) docs.set(k, { documento: f.documento, dtRefer: f.dtRefer, versao: f.versao, blocos: new Map() });
    const doc = docs.get(k);
    const kb = `${f.demonstrativo}|${f.ordem}|${f.inicio ?? ""}|${f.fim}`;
    if (!doc.blocos.has(kb)) {
      doc.blocos.set(kb, {
        familia: familia(f.demonstrativo), metodo: metodo(f.demonstrativo), ordem: f.ordem, inicio: f.inicio, fim: f.fim,
        documento: f.documento, dtRefer: f.dtRefer, versao: f.versao, consolidado: f.consolidado, contas: [],
      });
    }
    doc.blocos.get(kb).contas.push({ conta: f.conta, descricao: f.descricao, contaFixa: f.contaFixa, valor: f.valor });
  }
  return [...docs.values()].map((d) => ({ ...d, blocos: [...d.blocos.values()] }))
    .sort((a, b) => (a.dtRefer < b.dtRefer ? -1 : a.dtRefer > b.dtRefer ? 1 : a.documento < b.documento ? -1 : 1));
}

// Valor de uma conta num bloco. Ausente é null. Conta repetida com valores diferentes também é null:
// melhor não ter o número do que escolher um.
export function valorDaConta(bloco, conta) {
  if (!bloco) return null;
  const valores = [...new Set(bloco.contas.filter((c) => c.conta === conta).map((c) => c.valor))];
  return valores.length === 1 ? valores[0] : null;
}

// Contas fixas de um bloco (sem o lucro por ação, que não é somável): Map(conta → descricao).
function contasFixas(bloco) {
  const mapa = new Map();
  for (const c of bloco?.contas ?? []) if (c.contaFixa && !ehPorAcao(c.conta) && !mapa.has(c.conta)) mapa.set(c.conta, c.descricao);
  return mapa;
}

// Entre blocos do mesmo demonstrativo que terminam na mesma data, fica o de intervalo mais longo.
const maisLongo = (blocos) => blocos.reduce((a, b) => (a == null || (b.inicio ?? "") < (a.inicio ?? "") ? b : a), null);

// Escolhe a origem de um (período, demonstrativo).
//   proprio:   bloco ÚLTIMO da DFP do próprio exercício (pode faltar)
//   seguinte:  bloco PENÚLTIMO da DFP do exercício seguinte, para o mesmo fim (pode faltar)
// Vale o seguinte quando ele existe e é comparável com o próprio: na DFC, mesmo método (se a empresa
// trocou DFC_MI por DFC_MD, vale o da própria DFP); em todos, mesma base (se a empresa passou a consolidar,
// o PENÚLTIMO consolidado da DFP seguinte vem zerado, e vale o individual da própria DFP).
// Devolve o bloco escolhido com a origem; `reapresentado` é true/false quando dá para comparar com o
// original e null quando não há o documento original.
export function escolherOrigem(proprio, seguinte) {
  const usaSeguinte = seguinte != null
    && (proprio == null || (seguinte.metodo === proprio.metodo && seguinte.consolidado === proprio.consolidado));
  const bloco = usaSeguinte ? seguinte : proprio;
  if (!bloco) return null;
  let reapresentado = false;
  let originais;
  if (usaSeguinte) {
    if (proprio == null) reapresentado = null;
    else {
      originais = {};
      for (const conta of new Set([...contasFixas(proprio).keys(), ...contasFixas(seguinte).keys()])) {
        const antes = valorDaConta(proprio, conta);
        if (antes !== valorDaConta(seguinte, conta)) originais[conta] = antes;
      }
      reapresentado = Object.keys(originais).length > 0;
      if (!reapresentado) originais = undefined;
    }
  }
  return {
    ...(bloco.metodo ? { metodo: bloco.metodo } : {}),
    inicio: bloco.inicio,
    fim: bloco.fim,
    origem: { documento: bloco.documento, dtRefer: bloco.dtRefer, versao: bloco.versao, ordem: bloco.ordem, consolidado: bloco.consolidado, reapresentado },
    ...(originais ? { originais } : {}),
    contas: bloco.contas,
  };
}

// Série anual: um período por exercício encerrado, em ordem de data, a partir das DFP.
// Cada período: { inicio, fim, tipo ("anual" | "transicao"), dias, meses, demonstrativos: { DRE, BPA, BPP, DFC, DVA } }.
// `desde` corta períodos que terminam antes dessa data (a DFP de 2010 traz 2009 como PENÚLTIMO).
export function serieAnual(fatos, { desde = "2010-01-01" } = {}) {
  const dfps = documentosDe(fatos).filter((d) => d.documento === "dfp");
  const fins = new Set();
  for (const d of dfps) for (const b of d.blocos) if (b.fim >= desde) fins.add(b.fim);

  const periodos = [];
  for (const fim of [...fins].sort()) {
    const propria = dfps.find((d) => d.dtRefer === fim);
    const demonstrativos = {};
    for (const fam of [...FLUXOS, ...ESTOQUES]) {
      const proprio = propria ? maisLongo(propria.blocos.filter((b) => b.familia === fam && b.ordem === "ultimo" && b.fim === fim)) : null;
      // A DFP do exercício seguinte é a primeira, depois de `fim`, que traz este fim como PENÚLTIMO.
      let seguinte = null;
      for (const d of dfps) {
        if (d.dtRefer <= fim) continue;
        seguinte = maisLongo(d.blocos.filter((b) => b.familia === fam && b.ordem === "penultimo" && b.fim === fim
          && (proprio == null || fam !== "DFC" || b.metodo === proprio.metodo)));
        // Se a seguinte só traz a DFC em outro método, vale a própria.
        if (!seguinte && proprio == null) seguinte = maisLongo(d.blocos.filter((b) => b.familia === fam && b.ordem === "penultimo" && b.fim === fim));
        if (seguinte) break;
      }
      const escolhido = escolherOrigem(proprio, seguinte);
      if (escolhido) demonstrativos[fam] = escolhido;
    }
    const fluxo = FLUXOS.map((f) => demonstrativos[f]).find(Boolean);
    const classe = fluxo ? classificarIntervalo({ documento: "dfp", inicio: fluxo.inicio, fim }) : { tipo: null, dias: null, meses: null };
    periodos.push({ inicio: fluxo?.inicio ?? null, fim, ...classe, demonstrativos });
  }
  return periodos;
}

const origemDe = (bloco) => ({
  inicio: bloco.inicio, fim: bloco.fim, documento: bloco.documento, dtRefer: bloco.dtRefer, versao: bloco.versao, ordem: bloco.ordem, consolidado: bloco.consolidado,
});
const base = (consolidado) => (consolidado ? "consolidado" : "individual");
const dataBr = (iso) => iso.split("-").reverse().join("/");

function estoquesDe(blocos, data) {
  const contas = {};
  const naoFixas = [];
  let origem = null;
  for (const fam of ESTOQUES) {
    const bloco = blocos.find((b) => b.familia === fam && b.fim === data);
    if (!bloco) continue;
    origem ??= { documento: bloco.documento, dtRefer: bloco.dtRefer, versao: bloco.versao, ordem: bloco.ordem, consolidado: bloco.consolidado };
    for (const [conta, descricao] of contasFixas(bloco)) contas[conta] = { demonstrativo: fam, descricao, valor: valorDaConta(bloco, conta) };
    // Subcontas sem código fixo (ex.: "Arrendamentos" em 2.01.05.02.07), na ordem do arquivo, uma vez cada.
    const vistas = new Set();
    for (const c of bloco.contas) {
      if (c.contaFixa || vistas.has(c.conta)) continue;
      vistas.add(c.conta);
      naoFixas.push({ demonstrativo: fam, conta: c.conta, descricao: c.descricao, valor: valorDaConta(bloco, c.conta) });
    }
  }
  return origem ? { data, origem, contas, naoFixas } : null;
}

// Base de 12 meses. Os fluxos são só de contas fixas; os estoques trazem também as não fixas, à parte.
// Devolve { tipo, motivo, fim, parcelas, fluxos, estoques }:
//   tipo "itr":          anual + acumulado atual − acumulado anterior; `parcelas` traz as datas e a origem das três
//                        (o acumulado anterior é o ÚLTIMO do ITR do ano anterior, na mesma base das outras duas)
//   tipo "ano-fechado":  o documento mais recente é a DFP; os 12 meses são o próprio exercício
//   tipo "indisponivel": não deu para calcular; `motivo` diz por quê e `fluxos` é null (os estoques saem, se houver)
// fluxos:   { conta: { demonstrativo, descricao, valor, anual, acumuladoAtual, acumuladoAnterior } }
// estoques: { data, origem, contas: { conta: { demonstrativo, descricao, valor } }, naoFixas: [{ demonstrativo, conta, descricao, valor }] },
//           a posição mais recente, sem soma. `contas` só tem contas fixas; `naoFixas` lista as subcontas sem código fixo (#35)
export function base12Meses(fatos) {
  const docs = documentosDe(fatos);
  const indisponivel = (motivo, extra = {}) => ({ tipo: "indisponivel", motivo, fim: null, parcelas: null, fluxos: null, estoques: null, ...extra });
  if (docs.length === 0) return indisponivel("sem documentos da companhia");

  const dfps = docs.filter((d) => d.documento === "dfp");
  const itrs = docs.filter((d) => d.documento === "itr");
  const ultimaDfp = dfps.at(-1) ?? null;
  const ultimoItr = itrs.at(-1) ?? null;
  const serie = serieAnual(fatos, { desde: "0000-01-01" });
  const anual = ultimaDfp ? serie.find((p) => p.fim === ultimaDfp.dtRefer) : null;

  // O documento mais recente é a DFP: os 12 meses são o ano fechado.
  if (ultimaDfp && (!ultimoItr || ultimoItr.dtRefer <= ultimaDfp.dtRefer)) {
    const estoques = estoquesDe(ultimaDfp.blocos.filter((b) => b.ordem === "ultimo"), ultimaDfp.dtRefer);
    if (anual.tipo !== "anual") {
      return indisponivel(`a última DFP (${dataBr(ultimaDfp.dtRefer)}) cobre ${anual.meses ?? "?"} meses, não um exercício de 12 meses`, { fim: ultimaDfp.dtRefer, estoques });
    }
    const fluxos = {};
    for (const fam of FLUXOS) {
      const bloco = anual.demonstrativos[fam];
      for (const [conta, descricao] of contasFixas(bloco)) {
        const valor = valorDaConta(bloco, conta);
        fluxos[conta] = { demonstrativo: fam, descricao, valor, anual: valor, acumuladoAtual: null, acumuladoAnterior: null };
      }
    }
    return {
      tipo: "ano-fechado", motivo: null, fim: ultimaDfp.dtRefer,
      parcelas: {
        anual: { inicio: anual.inicio, fim: anual.fim, documento: "dfp", dtRefer: ultimaDfp.dtRefer, versao: ultimaDfp.versao, ordem: "ultimo", consolidado: FLUXOS.map((f) => anual.demonstrativos[f]).find(Boolean)?.origem.consolidado ?? null },
        acumuladoAtual: null, acumuladoAnterior: null,
      },
      fluxos, estoques,
    };
  }

  // O documento mais recente é um ITR.
  const fim = ultimoItr.dtRefer;
  const estoques = estoquesDe(ultimoItr.blocos.filter((b) => b.ordem === "ultimo"), fim);
  const falha = (motivo) => indisponivel(motivo, { fim, estoques });

  const fluxosDoItr = ultimoItr.blocos.filter((b) => FLUXOS.includes(b.familia));
  const atual = intervaloAcumulado(fluxosDoItr.filter((b) => b.ordem === "ultimo" && b.fim === fim));
  if (!atual) return falha(`o ITR de ${dataBr(fim)} não traz DRE, DFC nem DVA do período`);
  if (!ultimaDfp) return falha(`não há DFP anterior ao ITR de ${dataBr(fim)}`);

  // Encaixe: o exercício do ITR tem que começar no dia seguinte ao fim da DFP usada.
  if (atual.inicio !== somarDias(ultimaDfp.dtRefer, 1)) {
    return falha(`o ITR de ${dataBr(fim)} acumula desde ${dataBr(atual.inicio)}, mas a última DFP termina em ${dataBr(ultimaDfp.dtRefer)}: os dois não encaixam`);
  }
  if (anual.tipo !== "anual") {
    return falha(`a última DFP (${dataBr(ultimaDfp.dtRefer)}) cobre ${anual.meses ?? "?"} meses, não um exercício de 12 meses`);
  }

  // Acumulado do ano anterior: vem do ITR do mesmo período do ano anterior, como entregue (ÚLTIMO).
  // O leitor já deixou só a maior versão de cada documento. O PENÚLTIMO do ITR atual não é usado:
  // ele pode vir reapresentado (e aí não é mais a parcela que está dentro do anual da DFP) ou zerado.
  const fimEsperado = umAnoAntes(fim);
  const itrAnterior = itrs.find((d) => perto(d.dtRefer, fimEsperado));
  if (!itrAnterior) return falha(`falta o ITR de ${dataBr(fimEsperado)}, de onde sai o acumulado do ano anterior`);
  const fluxosAnteriores = itrAnterior.blocos.filter((b) => FLUXOS.includes(b.familia) && b.ordem === "ultimo" && b.fim === itrAnterior.dtRefer);
  const anterior = intervaloAcumulado(fluxosAnteriores);
  if (!anterior) return falha(`o ITR de ${dataBr(itrAnterior.dtRefer)} não traz DRE, DFC nem DVA do período`);
  if (!mesmoIntervaloUmAnoAntes(atual, anterior)) {
    return falha(`o acumulado do ITR de ${dataBr(itrAnterior.dtRefer)} (${dataBr(anterior.inicio)} a ${dataBr(anterior.fim)}) não é o mesmo intervalo do atual (${dataBr(atual.inicio)} a ${dataBr(atual.fim)}) um ano antes`);
  }
  if (!perto(anterior.inicio, anual.inicio)) {
    return falha(`o acumulado do ITR de ${dataBr(itrAnterior.dtRefer)} começa em ${dataBr(anterior.inicio)}, e o exercício da última DFP, em ${dataBr(anual.inicio)}`);
  }

  // As três parcelas na mesma base. Se a companhia passou a consolidar (ou deixou de), não há como somar.
  const baseAnual = FLUXOS.map((f) => anual.demonstrativos[f]).find(Boolean).origem.consolidado;
  if (baseAnual !== atual.consolidado || anterior.consolidado !== atual.consolidado) {
    const mudou = atual.consolidado ? "a companhia passou a consolidar" : "a companhia deixou de consolidar";
    return falha(`${mudou}: o ITR de ${dataBr(fim)} é ${base(atual.consolidado)}, a DFP de ${dataBr(ultimaDfp.dtRefer)} é ${base(baseAnual)} e o ITR de ${dataBr(itrAnterior.dtRefer)} é ${base(anterior.consolidado)}`);
  }

  const fluxos = {};
  for (const fam of FLUXOS) {
    const blocoAnual = anual.demonstrativos[fam];
    const blocoAtual = fluxosDoItr.find((b) => b.familia === fam && b.ordem === "ultimo" && b.inicio === atual.inicio && b.fim === atual.fim);
    const blocoAnterior = fluxosAnteriores.find((b) => b.familia === fam && b.inicio === anterior.inicio && b.fim === anterior.fim);
    const contas = new Map([...contasFixas(blocoAnual), ...contasFixas(blocoAtual), ...contasFixas(blocoAnterior)]);
    for (const [conta, descricao] of contas) {
      const parcelas = { anual: valorDaConta(blocoAnual, conta), acumuladoAtual: valorDaConta(blocoAtual, conta), acumuladoAnterior: valorDaConta(blocoAnterior, conta) };
      fluxos[conta] = { demonstrativo: fam, descricao, valor: doze(parcelas.anual, parcelas.acumuladoAtual, parcelas.acumuladoAnterior), ...parcelas };
    }
  }
  return {
    tipo: "itr", motivo: null, fim,
    parcelas: {
      anual: { inicio: anual.inicio, fim: anual.fim, documento: "dfp", dtRefer: ultimaDfp.dtRefer, versao: ultimaDfp.versao, ordem: "ultimo", consolidado: baseAnual },
      acumuladoAtual: origemDe(atual),
      acumuladoAnterior: origemDe(anterior),
    },
    fluxos, estoques,
  };
}

// Tudo de uma companhia: { cnpj, cdCvm, anual: [períodos], doze: bloco de 12 meses }.
export function montarSeries(fatos, opcoes) {
  const cnpjs = [...new Set(fatos.map((f) => f.cnpj))];
  if (cnpjs.length > 1) throw new Error(`montarSeries recebe os fatos de uma companhia só; vieram ${cnpjs.length}: ${cnpjs.join(", ")}`);
  return { cnpj: cnpjs[0] ?? null, cdCvm: fatos[0]?.cdCvm ?? null, anual: serieAnual(fatos, opcoes), doze: base12Meses(fatos) };
}
