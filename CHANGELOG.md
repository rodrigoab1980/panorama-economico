# Changelog

Todas as mudanças relevantes deste projeto ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Testes automatizados com `node:test` (`npm test`), sem dependências novas.
- Licença MIT.
- Este changelog.
- Workflow de CI (`.github/workflows/ci.yml`) que roda `npm test` em todo PR e na `main` (Node 22 e 24), com badge no README.

### Alterado
- A lógica pura de `scripts/update.mjs` (leitura de RSS, filtro e deduplicação de notícias, cotações, mapa de ações, agenda e decisão de gerar o resumo) foi para `scripts/logica.mjs`, sem rede nem disco. O comportamento e os JSON gerados não mudaram.

### Corrigido
- Feed do Yahoo Finance: a URL antiga (`finance.yahoo.com/news/rssindex`) respondia 404 e foi trocada pelo feed de manchetes de S&P 500, Dow Jones e Nasdaq (`feeds.finance.yahoo.com/rss/2.0/headline`) (#9).

### Segurança
- Notícias só aceitam links absolutos `http:` ou `https:` (`linkSeguro` em `scripts/logica.mjs`). Itens com `javascript:`, `data:`, link relativo, vazio ou inválido são descartados, inclusive os que vierem do JSON publicado anteriormente (#8).

## Antes deste changelog

- Mapa de ações próprio com cotações da CNBC (#2, #3).
- Agendamento em minutos quebrados para reduzir execuções descartadas pelo GitHub (#4).
- Instruções do projeto (`CLAUDE.md`) e comando `/proxima-issue` (#5).
