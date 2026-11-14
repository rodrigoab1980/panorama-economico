// Temporada de balanços (#68): para cada companhia, o último documento entregue, o próximo e quando
// ele deve sair. Lógica pura: recebe as fichas (scripts/cvm/ficha.mjs) e a data de hoje, injetada.
// Sem disco, sem rede e sem relógio. O HTML fica em temporada-html.mjs.
//
// A data é sempre uma ESTIMATIVA, e diz isso: a CVM não publica a data do próximo balanço em dado
// estruturado. A regra:
//   - Próximo documento: o período de 3 meses depois do último entregue. É DFP quando cai no mês em
//     que o exercício da companhia termina (o mês da última DFP), e ITR nos outros.
//   - Prazo legal: ITR, 45 dias depois do fim do trimestre; DFP, 3 meses depois do fim do exercício.
//   - Data provável: a data em que a companhia entregou o mesmo documento no ano anterior, levada um
//     ano para a frente. Sem esse documento, a data provável é o prazo legal.
//   - Sábado e domingo passam para a segunda-feira, na data provável e no prazo legal. Feriado não
//     entra na conta.
//   - A página só sabe o que está nos arquivos da CVM, atualizados uma vez por semana. Uma data que
//     passou depois da última atualização (`dadosAte`) não vira "ainda não entregou" nem "prazo
//     vencido": a página diz que os dados são anteriores.
// Nenhuma palavra de julgamento: nada de "atrasada". Depois do prazo legal, "prazo legal vencido" é fato.
import { nomeCurto, referenciaDaTemporada } from "./painel.mjs";

// Resolução CVM 80: o ITR sai em até 45 dias do fim de cada trimestre, e a DFP, em até 3 meses do
// fim do exercício social.
export const PRAZO_ITR_DIAS = 45;
export const PRAZO_DFP_MESES = 3;
// De quantos em quantos meses sai um documento.
export const MESES_ENTRE_DOCUMENTOS = 3;

// ---------- datas ("AAAA-MM-DD"), sempre em UTC, sem relógio ----------

const DIA = 86_400_000;
const FORMA = /^(\d{4})-(\d{2})-(\d{2})/;
const partes = (iso) => { const m = FORMA.exec(String(iso ?? "")); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null; };
const escrever = (ano, mes, dia) => new Date(Date.UTC(ano, mes - 1, dia)).toISOString().slice(0, 10);
const ultimoDiaDoMes = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const dia = (iso) => (partes(iso) ? String(iso).slice(0, 10) : null);
const dataBr = (iso) => { const p = partes(iso); return p ? `${String(p[2]).padStart(2, "0")}/${String(p[1]).padStart(2, "0")}/${p[0]}` : "—"; };
const diaMes = (iso) => dataBr(iso).slice(0, 5);

export function somarDias(iso, n) {
  const [ano, mes, d] = partes(iso);
  return new Date(Date.UTC(ano, mes - 1, d) + n * DIA).toISOString().slice(0, 10);
}

// Soma meses. O dia que não existe no mês de chegada vira o último dia dele (31/12 + 2 meses = 28/02),
// e com `fimDoMes` o resultado é sempre o último dia do mês (30/09 + 3 meses = 31/12).
export function somarMeses(iso, n, { fimDoMes = false } = {}) {
  const [ano, mes, d] = partes(iso);
  const indice = ano * 12 + (mes - 1) + n;
  const a = Math.floor(indice / 12);
  const m = (indice % 12) + 1;
  const ultimo = ultimoDiaDoMes(a, m);
  return escrever(a, m, fimDoMes ? ultimo : Math.min(d, ultimo));
}

// A mesma data, `anos` depois. 29/02 num ano que não é bissexto vira 28/02.
export const levarAnos = (iso, anos) => somarMeses(iso, 12 * anos);

// Sábado e domingo passam para a segunda-feira seguinte. Feriado não entra na conta.
export function proximoDiaDeSemana(iso) {
  const [ano, mes, d] = partes(iso);
  const semana = new Date(Date.UTC(ano, mes - 1, d)).getUTCDay();
  return semana === 6 ? somarDias(iso, 2) : semana === 0 ? somarDias(iso, 1) : dia(iso);
}

// A segunda-feira da semana da data.
export function segundaDaSemana(iso) {
  const [ano, mes, d] = partes(iso);
  const semana = new Date(Date.UTC(ano, mes - 1, d)).getUTCDay();
  return somarDias(iso, -((semana + 6) % 7));
}

// ---------- documentos ----------

const SIGLA = { dfp: "DFP", itr: "ITR" };

// "DFP de 2026" (ou "DFP de 03/2027", quando o exercício não termina em dezembro) e "ITR de 30/09/2026".
export function rotuloDoDocumento(tipo, dtRefer) {
  if (tipo !== "dfp") return `ITR de ${dataBr(dtRefer)}`;
  const [ano, mes] = partes(dtRefer);
  return `DFP de ${mes === 12 ? ano : `${String(mes).padStart(2, "0")}/${ano}`}`;
}

// O prazo legal de um documento: { data, corrido }.
//   corrido  a data da contagem (45 dias ou 3 meses depois do fim do período)
//   data     a mesma, passada para a segunda-feira quando cai em sábado ou domingo
export function prazoLegal(tipo, dtRefer) {
  const corrido = tipo === "dfp" ? somarMeses(dtRefer, PRAZO_DFP_MESES) : somarDias(dtRefer, PRAZO_ITR_DIAS);
  return { data: proximoDiaDeSemana(corrido), corrido };
}

// O mês em que o exercício da companhia termina: o da DFP mais recente. Sem DFP, dezembro.
export function mesDoExercicio(documentos) {
  const dfps = (documentos ?? []).filter((d) => d.documento === "dfp" && partes(d.dtRefer)).map((d) => d.dtRefer).sort();
  return dfps.length ? partes(dfps.at(-1))[1] : 12;
}

// O período seguinte ao de `dtRefer`: { tipo, dtRefer }. 31/03 → 30/06 → 30/09 → DFP de 31/12 → 31/03.
export function proximoPeriodo(dtRefer, mesExercicio = 12) {
  const proximo = somarMeses(dtRefer, MESES_ENTRE_DOCUMENTOS, { fimDoMes: true });
  return { tipo: partes(proximo)[1] === mesExercicio ? "dfp" : "itr", dtRefer: proximo };
}

// A data em que o documento chegou à CVM pela primeira vez. Quando a coleta só tem a data da versão
// mais nova de um documento reapresentado, vale essa, e `reapresentacao` avisa.
function entregaDe(documento) {
  if (!documento) return null;
  const primeira = dia(documento.primeiraEntrega);
  if (primeira) return { data: primeira, reapresentacao: false };
  const recebido = dia(documento.recebidoEm);
  return recebido ? { data: recebido, reapresentacao: (documento.versao ?? 1) > 1 } : null;
}

// ---------- uma companhia ----------

// A situação do próximo documento, com a data de hoje e a da última atualização dos dados.
//   previsto    hoje ainda não passou da data provável
//   aguardando  a data provável passou, o prazo legal não, e os dados são posteriores à data provável
//   vencido     o prazo legal passou, e os dados são posteriores a ele
//   sem-coleta  a data (provável ou legal) passou, mas depois da última atualização dos dados: a
//               página não sabe
// Sem `dadosAte`, os dados valem como de hoje.
export function situacaoDoProximo({ dataProvavel, prazo, origem, hoje, dadosAte = null }) {
  const dados = dia(dadosAte) ?? hoje;
  if (hoje <= dataProvavel) return { id: "previsto", texto: `previsto para ${diaMes(dataProvavel)}` };
  const foraDosDados = (data) => dados <= data;
  if (hoje > prazo.data) {
    if (foraDosDados(prazo.data)) return { id: "sem-coleta", texto: `prazo legal em ${diaMes(prazo.data)}, depois da última atualização dos dados (${diaMes(dados)})` };
    return { id: "vencido", texto: `prazo legal vencido em ${diaMes(prazo.data)}` };
  }
  if (foraDosDados(dataProvavel)) return { id: "sem-coleta", texto: `data provável em ${diaMes(dataProvavel)}, depois da última atualização dos dados (${diaMes(dados)})` };
  const antes = origem.tipo === "ano-anterior" ? `; no ano anterior entregou em ${diaMes(origem.entregueEm)}` : "";
  return { id: "aguardando", texto: `ainda não entregou${antes}` };
}

// A temporada de uma companhia.
//   ficha       a ficha (precisa de `ticker`, `nome`, `documentoMaisRecente` e `documentos`)
//   hoje        "AAAA-MM-DD", injetada
//   dadosAte    dia da última atualização dos arquivos da CVM usados na coleta; sem ele, vale hoje
// Devolve { ticker, nome, nomeCurto, ultimo, proximo, observacoes }:
//   ultimo   { tipo, dtRefer, rotulo, entregueEm, reapresentadoEm, versao, link }, ou null sem documento
//   proximo  { tipo, dtRefer, rotulo, prazoLegal, prazoCorrido, dataProvavel, estimada (true: é sempre
//              estimativa), origem, situacao }, ou null sem documento
//     origem    { tipo: "ano-anterior", documento, entregueEm, reapresentacao, texto }
//               ou { tipo: "prazo-legal", motivo, texto }
//     situacao  { id, texto } (ver situacaoDoProximo)
//   observacoes  o que muda a leitura: exercício que mudou de mês, exercício de transição
export function temporadaDaCompanhia(ficha, hoje, { dadosAte = null } = {}) {
  if (!partes(hoje)) throw new Error(`data de hoje inválida: "${hoje}"`);
  const documentos = (ficha?.documentos ?? []).filter((d) => partes(d.dtRefer));
  const base = { ticker: ficha?.ticker ?? null, nome: ficha?.nome ?? null, nomeCurto: nomeCurto(ficha?.nome) };
  const recente = ficha?.documentoMaisRecente;
  if (!recente || !partes(recente.dtRefer)) return { ...base, ultimo: null, proximo: null, observacoes: ["sem documento coletado"] };

  const achar = (tipo, dtRefer) => documentos.find((d) => d.documento === tipo && d.dtRefer === dtRefer) ?? null;
  const doUltimo = achar(recente.tipo, recente.dtRefer);
  const entrega = entregaDe(doUltimo);
  const ultimo = {
    tipo: recente.tipo, dtRefer: recente.dtRefer, rotulo: rotuloDoDocumento(recente.tipo, recente.dtRefer),
    entregueEm: entrega?.reapresentacao ? null : entrega?.data ?? null,
    // A data da versão mais nova, quando ela não é a da primeira entrega.
    reapresentadoEm: (doUltimo?.versao ?? 1) > 1 ? dia(doUltimo.recebidoEm) : null,
    versao: doUltimo?.versao ?? recente.versao ?? null, link: doUltimo?.link ?? null,
  };

  const observacoes = [];
  const mes = mesDoExercicio(documentos);
  const dfps = documentos.filter((d) => d.documento === "dfp").map((d) => d.dtRefer).sort();
  if (dfps.length > 1 && partes(dfps.at(-2))[1] !== mes) {
    observacoes.push(`o exercício social mudou de mês (${rotuloDoDocumento("dfp", dfps.at(-2))} e ${rotuloDoDocumento("dfp", dfps.at(-1))}): a sequência segue a DFP mais recente`);
  }
  const exercicio = ficha.anual?.at(-1);
  if (exercicio?.tipo === "transicao") observacoes.push(`o último exercício é de transição, com ${exercicio.meses ?? "?"} meses: a data do ano anterior pode não servir de referência`);

  const { tipo, dtRefer } = proximoPeriodo(recente.dtRefer, mes);
  const prazo = prazoLegal(tipo, dtRefer);
  const anterior = achar(tipo, levarAnos(dtRefer, -1));
  const entregaAnterior = entregaDe(anterior);
  let origem;
  let dataProvavel;
  if (entregaAnterior) {
    dataProvavel = proximoDiaDeSemana(levarAnos(entregaAnterior.data, 1));
    const rotulo = rotuloDoDocumento(tipo, anterior.dtRefer);
    origem = {
      tipo: "ano-anterior", documento: rotulo, entregueEm: entregaAnterior.data, reapresentacao: entregaAnterior.reapresentacao,
      texto: entregaAnterior.reapresentacao
        ? `estimada pela reapresentação do ano anterior (${rotulo}, versão ${anterior.versao}, em ${dataBr(entregaAnterior.data)})`
        : `estimada pela entrega do ano anterior (${rotulo}, em ${dataBr(entregaAnterior.data)})`,
    };
  } else {
    dataProvavel = prazo.data;
    origem = { tipo: "prazo-legal", motivo: `sem ${tipo === "dfp" ? "a" : "o"} ${rotuloDoDocumento(tipo, levarAnos(dtRefer, -1))} na coleta`, texto: "prazo legal" };
  }
  return {
    ...base, ultimo,
    proximo: {
      tipo, dtRefer, rotulo: rotuloDoDocumento(tipo, dtRefer), prazoLegal: prazo.data, prazoCorrido: prazo.corrido,
      dataProvavel, estimada: true, origem,
      situacao: situacaoDoProximo({ dataProvavel, prazo, origem, hoje, dadosAte }),
    },
    observacoes,
  };
}

// ---------- todas as companhias ----------

const porTicker = (a, b) => (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);
const porData = (campo, sentido) => (a, b) => {
  const x = campo(a) ?? "";
  const y = campo(b) ?? "";
  return x === y ? porTicker(a, b) : (x < y ? -1 : 1) * sentido;
};

// A temporada inteira.
//   fichas      { TICKER: ficha } ou [ficha]
//   hoje        "AAAA-MM-DD", injetada (nunca `new Date()` aqui dentro)
//   dadosAte    dia da última atualização dos arquivos da CVM usados na coleta
//   semFicha    [{ ticker, nome, motivo }]: as companhias da página que ficaram sem ficha
// Devolve null sem nenhum documento. Senão:
//   { hoje, dadosAte, referencia, total, entregaram, regras,
//     faltam     as que ainda não entregaram o documento de referência, pela data provável (a mais
//                próxima primeiro; no empate, o ticker)
//     semanas    as mesmas, agrupadas pela semana da data provável: [{ segunda, tickers }]
//     entregues  as que já entregaram, pela data de entrega, da mais recente para a mais antiga
//     semFicha }
// Cada item de `faltam` e `entregues` é a saída de temporadaDaCompanhia.
export function montarTemporada(fichas, { hoje, dadosAte = null, semFicha = [] } = {}) {
  if (!partes(hoje)) throw new Error(`data de hoje inválida: "${hoje}"`);
  const lista = (Array.isArray(fichas) ? fichas : Object.values(fichas ?? {})).filter(Boolean);
  const referencia = referenciaDaTemporada(lista);
  if (!referencia) return null;
  const itens = lista.map((f) => temporadaDaCompanhia(f, hoje, { dadosAte }));
  const entregou = (i) => i.ultimo?.dtRefer === referencia.dtRefer && i.ultimo.tipo === referencia.tipo;
  const entregues = itens.filter(entregou).sort(porData((i) => i.ultimo.entregueEm ?? i.ultimo.reapresentadoEm, -1));
  const faltam = itens.filter((i) => !entregou(i)).sort(porData((i) => i.proximo?.dataProvavel ?? "9999", 1));
  const semanas = [];
  for (const i of faltam.filter((x) => x.proximo)) {
    const segunda = segundaDaSemana(i.proximo.dataProvavel);
    if (semanas.at(-1)?.segunda !== segunda) semanas.push({ segunda, tickers: [] });
    semanas.at(-1).tickers.push(i.ticker);
  }
  return {
    hoje, dadosAte: dia(dadosAte), referencia,
    total: lista.length + semFicha.length, entregaram: entregues.length,
    regras: { prazoItrDias: PRAZO_ITR_DIAS, prazoDfpMeses: PRAZO_DFP_MESES, fimDeSemana: "passa para a segunda-feira", feriados: "não entram na conta" },
    faltam, semanas, entregues,
    semFicha: [...semFicha].sort(porTicker).map((c) => ({ ticker: c.ticker, nome: c.nome ?? null, motivo: c.motivo ?? null })),
  };
}
