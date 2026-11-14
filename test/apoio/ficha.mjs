// Ficha de teste da WEG, montada a partir das fixtures da CVM (DFP de 2025 e ITR de 2025 e 2026) pelo
// mesmo caminho da coleta e do build. Usada nos testes da página Fundamentalista.
import { readFileSync, readdirSync } from "node:fs";
import { criarExtrator, montarCompanhia, serializar, tipoDaEntrada } from "../../scripts/cvm/coleta.mjs";
import { montarFicha } from "../../scripts/cvm/ficha.mjs";

const DIR = new URL("../fixtures/cvm/", import.meta.url);
const texto = (pasta, nome) => new TextDecoder("latin1").decode(readFileSync(new URL(`${pasta}/${nome}`, DIR)));

export const WEG = { cnpj: "84.429.695/0001-11", cdCvm: "005410", nome: "WEG S.A.", setor: "Bens industriais", tickers: [{ ticker: "WEGE3", ibovespa: true }] };

function extrato(documento, ano) {
  const extrator = criarExtrator([WEG]);
  for (const nome of readdirSync(new URL("weg/", DIR)).filter((n) => n.startsWith(`${documento}_cia_aberta_`) && n.endsWith(`_${ano}.csv`))) {
    const tipo = tipoDaEntrada(nome);
    if (!tipo) continue;
    const receber = extrator[tipo](nome);
    for (const l of texto("weg", nome).split("\n")) receber(l);
    receber.fechar?.();
  }
  return extrator.extrato();
}
const zip = (nome) => ({ nome, ano: Number(/(\d{4})\.zip$/.exec(nome)[1]), lastModified: "Sun, 08 Nov 2026 10:19:22 GMT", tamanho: 1000, status: "ok", motivo: null });

export const EXTRATOS = [["dfp", 2025], ["itr", 2025], ["itr", 2026]].map(([d, a]) => ({ arquivo: zip(`${d}_cia_aberta_${a}.zip`), extrato: extrato(d, a) }));
// O arquivo da companhia como a coleta grava na branch de dados.
export const ARQUIVO = JSON.parse(serializar(montarCompanhia(WEG, EXTRATOS)));
export const COTACOES = { coletadoEm: "2026-11-13T22:07:00.000Z", fonte: "CNBC (atraso de até 15 min)", precos: { WEGE3: { preco: 51.31, dataHora: "2026-11-13T18:05:49.000-0300" } } };
export const HOJE = "2026-11-14";

// A ficha da WEG. `mudar(ficha)` permite ajustar uma cópia antes de devolver.
export function fichaDaWeg({ cotacoes = COTACOES, hoje = HOJE, companhia = WEG, mudar = null } = {}) {
  const ficha = structuredClone(montarFicha({ companhia, arquivo: ARQUIVO, cotacoes, hoje }));
  if (mudar) mudar(ficha);
  return ficha;
}
