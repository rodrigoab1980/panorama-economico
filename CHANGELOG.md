# Changelog

Todas as mudanças relevantes deste projeto ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Testes automatizados com `node:test` (`npm test`), sem dependências novas.
- Licença MIT.
- Este changelog.
- Aviso de dado desatualizado na página (#11): cada bloco (notícias, placar, mapa e resumo) mostra data e hora da última atualização e fica destacado em laranja quando passa de 1 h sem atualizar (2 h para o resumo da IA). Só conta o horário em que a coleta roda (seg–sex, 6h–21h de Brasília), para não acusar atraso à noite nem no fim de semana. Lógica em `site/atraso.js`, com testes.
- Histórico diário em JSON (#13): a partir das 19h, o fechamento de cada ativo do placar é gravado em `historico.json` na branch `dados`. O placar mostra a variação na semana (7 dias) e no mês (30 dias), usando o dia útil anterior mais próximo quando falta dado e deixando "—" quando o histórico ainda não cobre o período. Cálculo em `scripts/logica.mjs`, com testes.
- Alertas de movimento fora do padrão (#14): uma faixa no topo do placar lista os ativos cuja variação do dia passou de 2,5 vezes a oscilação diária típica deles (desvio padrão dos últimos 60 fechamentos do histórico). Com menos de 20 dias de histórico, usa um limite fixo de 3% (preços) ou 15 bps (juros). Os três valores são configuráveis pelas variáveis `ALERTA_DESVIOS`, `ALERTA_PCT` e `ALERTA_BPS` do Actions. Lógica em `scripts/logica.mjs`, com testes.
- Workflow de CI (`.github/workflows/ci.yml`) que roda `npm test` em todo PR e na `main` (Node 24 e 26), com badge no README.

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
