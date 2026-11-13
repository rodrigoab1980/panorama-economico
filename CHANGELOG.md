# Changelog

Todas as mudanças relevantes deste projeto ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Universo da página Fundamentalista (#32): `scripts/cvm/universo.json` lista as companhias do Ibovespa, uma entrada por CNPJ, com código CVM, nome, tickers, setor e a marca `financeira`. É gerado por `scripts/cvm/gerar-universo.mjs` (sem rede e sem ZIP) a partir do FCA e de três arquivos mantidos à mão: a carteira do índice com data e fonte (`tickers-ibovespa.json`), as exceções com motivo (`excecoes-tickers.json`) e os setores (`setores.json`). Nenhum vínculo é adivinhado: vem do FCA, quando o código de negociação é válido, ou de uma exceção; o resto vai para `pendentes` com o motivo. Na carteira de 13/11/2026 são 76 tickers e 74 companhias, 5 delas ligadas por exceção. Lógica pura em `scripts/cvm/universo.mjs`, com testes contra uma fixture real do FCA.
- Leitor de DFP e ITR da CVM (#31): `scripts/cvm/leitor.mjs` transforma cada linha dos CSVs num fato normalizado (`cnpj`, `cdCvm`, `documento`, `demonstrativo`, `consolidado`, `dtRefer`, `versao`, `ordem`, `inicio`, `fim`, `conta`, `descricao`, `contaFixa`, `valor`), uma linha por vez, para a casca poder ler em fluxo. Valores inteiros em R$ mil (`UNIDADE` é dividido por 1.000); o lucro por ação (3.99.*) fica em R$ por ação. O `PENÚLTIMO` é preservado e marcado, as colunas são lidas pelo cabeçalho, fica só a maior versão de cada documento e o individual só entra quando o documento não tem consolidado. Linha malformada, valor não numérico, escala ou moeda desconhecida dão erro com arquivo e número da linha. Só funções puras, com testes contra as fixtures reais.
- Build multi-página com menu comum (#30): `npm run build` (`scripts/build.mjs`) monta `dist/` a partir de `site/`, inclusive os JSON de `site/data/`, e troca o marcador `<!-- menu -->` de cada página pelo menu (Diário e Fundamentalista). O Diário continua na raiz e idêntico: a única linha nova no `site/index.html` é o marcador, e um teste confirma que o `dist/index.html` sem o menu é igual byte a byte. Links só relativos (o site fica em `/panorama-economico/`), conferidos por um teste que reprova link quebrado e caminho absoluto. A página `fundamentos/` é um esqueleto com aviso legal (o conteúdo vem na #38). Lógica pura em `scripts/paginas.mjs`, com testes. No celular, o menu é um `<details>`, sem JS; entre 768 e 1100 px ele ganha uma linha própria no cabeçalho.
- Spike dos dados abertos da CVM (#29): `docs/cvm.md` registra o que foi medido nos arquivos de DFP, ITR e FCA (URLs, formato, contas confirmadas, como o ITR acumula, reapresentações, volume e tempos para decidir entre JSON puro e SQLite) e os riscos para as próximas issues da v2.0. Três fixtures reais em `test/fixtures/cvm/` (WEG, Raia Drogasil e Hapvida), preservadas byte a byte pelo `.gitattributes`, com testes que confirmam esses fatos. As fixtures podem ser recriadas com `scripts/cvm/gerar-fixtures.mjs` (sem rede e sem ZIP), e as medições, com os scripts de `scripts/cvm/spike/` (seção "Como reproduzir").

### Alterado
- O workflow de atualização publica `dist/` em vez de `site/`, com o build depois da coleta e da gravação do histórico; se o build falhar, nada é publicado. O CI também roda `npm run build`, e `npm run serve` passa a servir `dist/` (#30).

## [1.0.0] - 2026-11-12

Primeira versão estável: testes e CI, lógica própria (histórico diário, variação semanal e mensal, alertas), atualização confiável com gatilho externo e documentação das decisões de arquitetura.

### Adicionado
- Testes automatizados com `node:test` (`npm test`), sem dependências novas.
- Licença MIT.
- Este changelog.
- Aviso de dado desatualizado na página (#11): cada bloco (notícias, placar, mapa e resumo) mostra data e hora da última atualização e fica destacado em laranja quando passa de 1 h sem atualizar (2 h para o resumo da IA). Só conta o horário em que a coleta roda (seg–sex, 6h–21h de Brasília), para não acusar atraso à noite nem no fim de semana. Lógica em `site/atraso.js`, com testes.
- Histórico diário em JSON (#13): a partir das 19h, o fechamento de cada ativo do placar é gravado em `historico.json` na branch `dados`. O placar mostra a variação na semana (7 dias) e no mês (30 dias), usando o dia útil anterior mais próximo quando falta dado e deixando "—" quando o histórico ainda não cobre o período. Cálculo em `scripts/logica.mjs`, com testes.
- Alertas de movimento fora do padrão (#14): uma faixa no topo do placar lista os ativos cuja variação do dia passou de 2,5 vezes a oscilação diária típica deles (desvio padrão dos últimos 60 fechamentos do histórico). Com menos de 20 dias de histórico, usa um limite fixo de 3% (preços) ou 15 bps (juros). Os três valores são configuráveis pelas variáveis `ALERTA_DESVIOS`, `ALERTA_PCT` e `ALERTA_BPS` do Actions. Lógica em `scripts/logica.mjs`, com testes.
- Atualização confiável com gatilho externo (#15): o cron-job.org dispara o workflow pela API do GitHub (`workflow_dispatch`) a cada 15 min, com um token fine-grained restrito a este repositório (só *Actions: Read and write*, com validade) configurado à mão no cron-job.org, nunca no repositório. O `schedule` do GitHub fica de reserva, e uma guarda (`scripts/guarda.mjs`, com testes) faz a execução agendada pular quando a externa já rodou nos últimos 15 min. A `concurrency` passou para o job de atualização. Passo a passo no README.
- Workflow de CI (`.github/workflows/ci.yml`) que roda `npm test` em todo PR e na `main` (Node 24 e 26), com badge no README.

- Documentação final (#27): seções de estrutura do repositório, decisões de arquitetura (com as alternativas consideradas) e como contribuir no README.

### Alterado
- A lógica pura de `scripts/update.mjs` (leitura de RSS, filtro e deduplicação de notícias, cotações, mapa de ações, agenda e decisão de gerar o resumo) foi para `scripts/logica.mjs`, sem rede nem disco. O comportamento e os JSON gerados não mudaram.
- O resumo do fim do dia passa a ser arquivado em `arquivo/AAAA-MM-DD.json` na branch `dados`, e não mais na `main`. Assim o robô não faz mais push na `main`, que pode ser protegida com o CI obrigatório. Falhas ao gravar na `dados` não impedem o deploy (#13).

### Corrigido
- Actions dos workflows em versões que rodam em Node 24, já que o GitHub está descontinuando o Node 20 nas actions: `checkout@v7`, `setup-node@v7`, `configure-pages@v6`, `upload-pages-artifact@v5` e `deploy-pages@v5`. O job de atualização passa a usar Node 24, o CI testa Node 24 e 26 e o `engines` do `package.json` exige Node 24 ou mais novo (#12).
- Feed do Yahoo Finance: a URL antiga (`finance.yahoo.com/news/rssindex`) respondia 404 e foi trocada pelo feed de manchetes de S&P 500, Dow Jones e Nasdaq (`feeds.finance.yahoo.com/rss/2.0/headline`) (#9).
- Aba B3: a Eletrobras passou a negociar como AXIA3 (Axia Energia); o widget trocou `BMFBOVESPA:ELET3` por `BMFBOVESPA:AXIA3` (#10).

### Segurança
- Notícias só aceitam links absolutos `http:` ou `https:` (`linkSeguro` em `scripts/logica.mjs`). Itens com `javascript:`, `data:`, link relativo, vazio ou inválido são descartados, inclusive os que vierem do JSON publicado anteriormente (#8).

## Antes deste changelog

- Mapa de ações próprio com cotações da CNBC (#2, #3).
- Agendamento em minutos quebrados para reduzir execuções descartadas pelo GitHub (#4).
- Instruções do projeto (`CLAUDE.md`) e comando `/proxima-issue` (#5).

[Não lançado]: https://github.com/rodrigoab1980/panorama-economico/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/rodrigoab1980/panorama-economico/releases/tag/v1.0.0
