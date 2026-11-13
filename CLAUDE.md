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
A v1.0 está concluída (issues #6–#15 e #27, tag v1.0).
O roteiro atual são os milestones v2.0 e v3.0. Execute na ordem dos números:
a próxima issue é sempre a ABERTA de menor número do milestone ativo (v2.0 antes de v3.0).
Nunca pegue a mais recente da lista do `gh issue list`.

### v2.0 — Fundamentalista para decidir (#29–#40)
Página /fundamentos/ com dados da CVM Dados Abertos (DFP, ITR, FCA), 10+ anos e base de 12 meses, com o fluxo de caixa no centro.
Universo: ações do Ibovespa, sem bancos e seguradoras.
Começa pelo spike da CVM (#29) e pelo build multi-página (#30).

### v3.0 — Overview e Treinamentos (#41–#48)
Conteúdo em Markdown no repositório. O Overview de mercado é autoral, com dados vivos do site.
Os treinamentos têm o módulo iniciante grátis; os pagos ficam numa plataforma externa e o site é só a vitrine.

### Decisões já tomadas
- Build próprio em Node (`scripts/build.mjs` → `dist/`); única dependência nova permitida: `marked`.
- Fundamentos coletados num workflow semanal separado, gravando na branch `dados`.
- Raiz do site continua sendo o Diário (visão de trade).
- Lógica pura em módulos testados; rede e disco só na casca.
- Nunca "compre", "venda", nota ou preço-alvo: só dados, regras à vista e aviso legal.
- Não copiar layout, nomes ou textos de outros sites (ex.: Bastter); a referência é só de conteúdo.
- Resumo de IA continua desligado.
