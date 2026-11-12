# Changelog

Todas as mudanças relevantes deste projeto ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado
- Testes automatizados com `node:test` (`npm test`), sem dependências novas.
- Licença MIT.
- Este changelog.

### Alterado
- A lógica pura de `scripts/update.mjs` (leitura de RSS, filtro e deduplicação de notícias, cotações, mapa de ações, agenda e decisão de gerar o resumo) foi para `scripts/logica.mjs`, sem rede nem disco. O comportamento e os JSON gerados não mudaram.

## Antes deste changelog

- Mapa de ações próprio com cotações da CNBC (#2, #3).
- Agendamento em minutos quebrados para reduzir execuções descartadas pelo GitHub (#4).
- Instruções do projeto (`CLAUDE.md`) e comando `/proxima-issue` (#5).
