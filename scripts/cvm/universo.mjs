// Universo da página Fundamentalista: liga cada ticker da carteira do Ibovespa à companhia na CVM.
// Lógica pura: sem disco e sem rede. A casca é scripts/cvm/gerar-universo.mjs.
//
// A unidade de análise é a companhia (CNPJ), não o ticker: PETR3 e PETR4 caem na mesma entrada.
// Nenhum vínculo é adivinhado: ou vem do FCA (código de negociação válido, em Bolsa, sem data de fim),
// ou vem de uma exceção manual com motivo. O que não liga vai para `pendentes`, com o motivo.

// Código de negociação da B3: 4 caracteres (letra primeiro; pode ter dígito, como B3SA3) + o tipo:
// 3 = ON, 4 = PN, 5 a 8 = PN classes A a D, 11 = unit.
const TICKER = /^[A-Z][A-Z0-9]{3}(3|4|5|6|7|8|11)$/;
const CNPJ = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/;
const CD_CVM = /^\d{6}$/;

// O campo do FCA é texto livre: tira espaços e põe em maiúsculas. Não corrige nada além disso.
export const normalizarTicker = (texto) => String(texto ?? "").replace(/\s+/g, "").toUpperCase();
export const tickerValido = (ticker) => TICKER.test(ticker);
export const cnpjValido = (cnpj) => CNPJ.test(cnpj);
export const cdCvmValido = (cd) => CD_CVM.test(cd);

const onde = (ctx) => (ctx?.arquivo ? `${ctx.arquivo}${ctx.linha ? `:${ctx.linha}` : ""}: ` : "");
const semCr = (linha) => (linha.endsWith("\r") ? linha.slice(0, -1) : linha);

// Lê um CSV do FCA (linhas já decodificadas de latin1, cabeçalho na primeira) em objetos { coluna: valor }.
// As colunas são achadas pelo cabeçalho; linha com número de colunas diferente dá erro.
export function lerFca(linhas, obrigatorias, arquivo) {
  let cab = null, numero = 0;
  const registros = [];
  for (const bruta of linhas) {
    numero++;
    const linha = semCr(bruta);
    if (linha === "") continue;
    const campos = linha.split(";");
    if (!cab) {
      const faltam = obrigatorias.filter((c) => !campos.includes(c));
      if (faltam.length) throw new Error(`${onde({ arquivo, linha: numero })}cabeçalho sem a(s) coluna(s) ${faltam.join(", ")}`);
      cab = campos;
      continue;
    }
    if (campos.length !== cab.length) {
      throw new Error(`${onde({ arquivo, linha: numero })}linha malformada: ${campos.length} colunas, o cabeçalho tem ${cab.length}`);
    }
    registros.push(Object.fromEntries(cab.map((c, i) => [c, campos[i]])));
  }
  return registros;
}

const COLUNAS_VM = ["CNPJ_Companhia", "Versao", "Valor_Mobiliario", "Codigo_Negociacao", "Mercado", "Data_Fim_Negociacao"];
const COLUNAS_GERAL = ["CNPJ_Companhia", "Versao", "Nome_Empresarial", "Codigo_CVM", "Situacao_Registro_CVM"];

// Fica só com a versão mais recente do FCA de cada companhia.
function ultimaVersao(registros) {
  const maior = new Map();
  for (const r of registros) {
    const v = Number(r.Versao);
    if ((maior.get(r.CNPJ_Companhia) ?? 0) < v) maior.set(r.CNPJ_Companhia, v);
  }
  return registros.filter((r) => Number(r.Versao) === maior.get(r.CNPJ_Companhia));
}

// fca_cia_aberta_valor_mobiliario → Map(ticker → Set(cnpj)), só com o que dá para confiar:
// negociado em Bolsa, sem data de fim de negociação e com código em formato válido.
export function vinculosDoFca(linhas, arquivo = "fca_cia_aberta_valor_mobiliario") {
  const porTicker = new Map();
  for (const r of ultimaVersao(lerFca(linhas, COLUNAS_VM, arquivo))) {
    if (r.Mercado !== "Bolsa" || r.Data_Fim_Negociacao !== "") continue;
    const ticker = normalizarTicker(r.Codigo_Negociacao);
    if (!tickerValido(ticker)) continue;
    if (!porTicker.has(ticker)) porTicker.set(ticker, new Set());
    porTicker.get(ticker).add(r.CNPJ_Companhia);
  }
  return porTicker;
}

// fca_cia_aberta_geral → Map(cnpj → { cdCvm, nome, situacao }).
export function cadastroDoFca(linhas, arquivo = "fca_cia_aberta_geral") {
  const cadastro = new Map();
  for (const r of ultimaVersao(lerFca(linhas, COLUNAS_GERAL, arquivo))) {
    cadastro.set(r.CNPJ_Companhia, { cdCvm: r.Codigo_CVM, nome: r.Nome_Empresarial.trim(), situacao: r.Situacao_Registro_CVM });
  }
  return cadastro;
}

// { setores: { "Nome": [tickers] } } → Map(ticker → setor). Ticker em dois setores dá erro.
export function setorPorTicker(setores) {
  const mapa = new Map();
  for (const [setor, tickers] of Object.entries(setores)) {
    for (const t of tickers) {
      if (mapa.has(t)) throw new Error(`setores: ${t} está em "${mapa.get(t)}" e em "${setor}"`);
      mapa.set(t, setor);
    }
  }
  return mapa;
}

// Motivos aceitos para uma companhia ficar fora da página na v2.
export const MOTIVOS_FORA = ["banco", "seguradora", "holding"];

// { banco: [tickers], ... } → Map(ticker → motivo). Motivo desconhecido ou ticker em dois motivos dá erro.
export function motivoPorTicker(foraDaPagina) {
  const mapa = new Map();
  for (const [motivo, tickers] of Object.entries(foraDaPagina)) {
    if (!MOTIVOS_FORA.includes(motivo)) throw new Error(`foraDaPagina: motivo desconhecido "${motivo}" (aceitos: ${MOTIVOS_FORA.join(", ")})`);
    for (const t of tickers) {
      if (mapa.has(t)) throw new Error(`foraDaPagina: ${t} está em "${mapa.get(t)}" e em "${motivo}"`);
      mapa.set(t, motivo);
    }
  }
  return mapa;
}

// Junta os tickers por companhia. Entrada: [{ ticker, cnpj, origem }] → Map(cnpj → [{ ticker, origem }]).
export function juntarClasses(vinculos) {
  const porCnpj = new Map();
  for (const { ticker, cnpj, origem } of vinculos) {
    if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, []);
    if (!porCnpj.get(cnpj).some((t) => t.ticker === ticker)) porCnpj.get(cnpj).push({ ticker, origem });
  }
  return porCnpj;
}

// Monta o universo.
//   tickers:   tickers da carteira do índice (mantidos à mão)
//   vinculos:  Map de vinculosDoFca()
//   cadastro:  Map de cadastroDoFca()
//   excecoes:  [{ ticker, cnpj, motivo, obs? }]  (a exceção vence o FCA)
//   setores:   { "Nome": [tickers] }
//   foraDaPagina: { banco: [tickers], seguradora: [tickers], holding: [tickers] }
// Devolve { mapeadas: [companhia], pendentes: [{ ticker, motivo }] }, em ordem estável.
// Cada companhia sai com foraDaPagina: null (entra na página) ou o motivo ("banco", "seguradora", "holding").
export function montarUniverso({ tickers, vinculos, cadastro, excecoes = [], setores = {}, foraDaPagina = {} }) {
  const pendentes = [];
  const motivoFora = motivoPorTicker(foraDaPagina);
  const excecao = new Map();
  for (const e of excecoes) {
    const t = normalizarTicker(e.ticker);
    if (!e.motivo?.trim()) throw new Error(`exceção de ${t} sem motivo`);
    if (!cnpjValido(e.cnpj)) throw new Error(`exceção de ${t} com CNPJ inválido: "${e.cnpj}"`);
    if (excecao.has(t)) throw new Error(`exceção repetida para ${t}`);
    excecao.set(t, e);
  }
  const setorDe = setorPorTicker(setores);

  // 1) cada ticker da carteira → um CNPJ, pelo FCA ou por exceção
  const ligados = [];
  const vistos = new Set();
  for (const bruto of tickers) {
    const ticker = normalizarTicker(bruto);
    if (vistos.has(ticker)) continue;
    vistos.add(ticker);
    if (!tickerValido(ticker)) { pendentes.push({ ticker, motivo: "ticker da carteira em formato inválido" }); continue; }
    if (excecao.has(ticker)) { ligados.push({ ticker, cnpj: excecao.get(ticker).cnpj, origem: "excecao" }); continue; }
    const cnpjs = [...(vinculos.get(ticker) ?? [])];
    if (cnpjs.length === 0) {
      pendentes.push({ ticker, motivo: "sem vínculo no FCA: nenhuma companhia informa este código em Bolsa (código ausente, inválido ou com negociação encerrada)" });
    } else if (cnpjs.length > 1) {
      pendentes.push({ ticker, motivo: `vínculo ambíguo no FCA: ${cnpjs.length} companhias informam este código (${cnpjs.sort().join(", ")})` });
    } else {
      ligados.push({ ticker, cnpj: cnpjs[0], origem: "fca" });
    }
  }

  // 2) uma entrada por companhia
  const mapeadas = [];
  for (const [cnpj, daCarteira] of juntarClasses(ligados)) {
    const nomes = daCarteira.map((t) => t.ticker);
    const cad = cadastro.get(cnpj);
    const pendurar = (motivo) => { for (const ticker of nomes) pendentes.push({ ticker, motivo }); };
    if (!cad) { pendurar(`companhia ${cnpj} sem cadastro no FCA (não entrega documentos à CVM como companhia aberta?)`); continue; }
    if (!cdCvmValido(cad.cdCvm)) { pendurar(`companhia ${cnpj} com código CVM inválido no FCA: "${cad.cdCvm}"`); continue; }
    if (cad.situacao !== "Ativo") { pendurar(`registro da companhia ${cnpj} na CVM está "${cad.situacao}"`); continue; }
    const setoresDaCia = [...new Set(nomes.map((t) => setorDe.get(t)).filter(Boolean))];
    if (setoresDaCia.length === 0) { pendurar("companhia sem setor em setores.json"); continue; }
    if (setoresDaCia.length > 1) { pendurar(`tickers da mesma companhia em setores diferentes: ${setoresDaCia.join(", ")}`); continue; }
    const motivosFora = [...new Set(nomes.map((t) => motivoFora.get(t)).filter(Boolean))];
    if (motivosFora.length > 1) { pendurar(`tickers da mesma companhia com motivos diferentes em foraDaPagina: ${motivosFora.join(", ")}`); continue; }

    // Outras classes da mesma companhia que o FCA informa (porta de entrada da busca), fora da carteira.
    const outras = [];
    for (const [ticker, cnpjs] of vinculos) {
      if (cnpjs.size === 1 && cnpjs.has(cnpj) && !nomes.includes(ticker) && !excecao.has(ticker)) outras.push(ticker);
    }
    const obs = daCarteira.map((t) => excecao.get(t.ticker)?.obs).filter(Boolean);
    mapeadas.push({
      cnpj,
      cdCvm: cad.cdCvm,
      nome: cad.nome,
      setor: setoresDaCia[0],
      foraDaPagina: motivosFora[0] ?? null,
      tickers: [
        ...daCarteira.map((t) => ({ ticker: t.ticker, origem: t.origem, ibovespa: true })),
        ...outras.sort().map((ticker) => ({ ticker, origem: "fca", ibovespa: false })),
      ].sort((a, b) => (a.ticker < b.ticker ? -1 : 1)),
      ...(obs.length ? { obs: obs.join(" ") } : {}),
    });
  }

  mapeadas.sort((a, b) => (a.tickers[0].ticker < b.tickers[0].ticker ? -1 : 1));
  pendentes.sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
  return { mapeadas, pendentes };
}

// Resumo por setor, para a revisão: [{ setor, naPagina, tickers, fora: [{ ticker, motivo }] }],
// do setor com mais companhias na página para o com menos. A comparação com pares (#39) só conta as da página.
export function resumoPorSetor(mapeadas) {
  const grupos = new Map();
  for (const c of mapeadas) {
    if (!grupos.has(c.setor)) grupos.set(c.setor, { setor: c.setor, naPagina: 0, tickers: [], fora: [] });
    const g = grupos.get(c.setor);
    const ticker = c.tickers.find((t) => t.ibovespa).ticker;
    if (c.foraDaPagina) g.fora.push({ ticker, motivo: c.foraDaPagina });
    else { g.naPagina++; g.tickers.push(ticker); }
  }
  return [...grupos.values()].sort((a, b) => b.naPagina - a.naPagina || (a.setor < b.setor ? -1 : 1));
}
