# Panorama Econômico — instruções do projeto
Painel matinal de mercado (Node.js, GitHub Actions, GitHub Pages, API da Anthropic para o resumo). Responda sempre em português.

## Objetivo
Evoluir o projeto até um nível de engenharia sólido: testes, modularização, robustez a falhas, lógica própria (histórico, variações, alertas) e documentação clara.

## Fluxo de trabalho
- Uma issue por vez, em branch própria (feat/, fix/, test/, docs/, chore/).
- Commits pequenos, no formato Conventional Commits.
- Todo PR deve ter descrição do que mudou e por quê, e testes quando houver lógica.
- Antes de abrir o PR, rode os testes e mostre o diff. Nunca faça merge sem eu aprovar.
- Antes de criar issues ou PRs, confira os existentes (gh pr list --state all, gh issue list --state all) para não duplicar.

## Regras
- Nunca commitar chaves de API ou segredos (usar GitHub Secrets e .env fora do git).
- Não apagar nem mover arquivos sem me perguntar.
- Decisões grandes de arquitetura: proponha 2 opções e espere minha escolha.
- Mantenha o README e o changelog atualizados a cada mudança relevante.

## Roteiro (issues)
Nesta ordem de execução; as letras são as das issues.

1. **D. Base de testes do `update.mjs`**: módulo de funções puras + `node:test`, sem dependências novas. Inclui também a licença MIT e o CHANGELOG.
2. **E. CI nos PRs**: roda os testes, não publica.
3. **F. Aceitar só links http(s) nas notícias**, com teste.
4. **B. Feed do Yahoo Finance com 404**: trocar a URL ou remover a fonte; atualizar o README.
5. **H. Aba B3**: trocar ELET3 por AXIA3.
6. **C. Aviso de dado desatualizado na página**: mostrar a data; destacar atraso maior que 1h.
7. **G. Actions do workflow em versões com Node 24.**
8. **I. Histórico diário em JSON** com variação semanal e mensal.
9. **J. Alertas de movimento fora do padrão** (limite X configurável).
10. **A. Atualização confiável**: gatilho externo com cron-job.org e token fine-grained restrito a este repositório (só Actions: escrita, com validade). O token nunca vai para nenhum arquivo; o usuário configura à mão e o README documenta o passo a passo.
11. **Documentação final**: README com decisões de arquitetura, changelog e release v1.0.

Já existente no repositório: `.gitignore` (node_modules/, site/data/, .env); timeout de 20 s por requisição e fallback para o último JSON publicado quando uma coleta falha.
