Pegue a próxima issue do roteiro. Argumento opcional: $ARGUMENTS (número da issue).

- Com argumento: use a issue com esse número.
- Sem argumento: pegue a issue ABERTA de MENOR número do milestone v2.0 (gh issue list --milestone v2.0 --state open --limit 100). Só se o v2.0 não tiver issues abertas, faça o mesmo com o v3.0. Nunca pegue a mais recente da lista.
- Nunca crie issue sem me perguntar antes. Se não encontrar a issue, pare e me diga o que encontrou.
- Use o nome de branch indicado na issue.
- Se eu colar um briefing, siga o briefing.

Depois: crie a branch (feat/, fix/, test/, docs/, chore/), implemente com testes, rode os testes, faça commits no padrão Conventional Commits e abra o PR com gh pr create. Mostre o diff e a descrição do PR e pare para eu aprovar. Nunca faça merge.
