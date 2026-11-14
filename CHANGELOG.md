# Changelog

Todas as mudanças relevantes deste projeto ficam registradas aqui.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o projeto usa [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [Não lançado]

A v2.1 está em andamento.

### Adicionado
- **Rankings por indicador**, em `/fundamentos/rankings/`: onze critérios (anos com lucro, maior sequência com lucro, anos com FCL positivo, crescimento da receita e do lucro em 5 anos, ROIC, ROE, margem líquida, FCO ÷ EBITDA, dívida líquida ÷ EBITDA e pontos de atenção acionados), cada um com a lista dos maiores e a dos menores valores, a regra de cálculo, o período e quem ficou sem dado, com o motivo. Não há nota única nem lista de "ações", e os múltiplos de preço ficam fora de propósito. O menu ganha o item "Rankings", e a página inicial dos fundamentos, um link para ela (#67).
- O build grava `dist/fundamentos/dados/rankings.json`. Um erro nos rankings não derruba o resto do site (#67).
- **Temporada de balanços**, em `/fundamentos/temporada/`: o progresso da temporada, as próximas entregas agrupadas por semana e quem já entregou, com o link do documento na CVM. Para cada companhia, o próximo documento (ITR ou DFP), o prazo legal e a data provável, estimada pela data em que ela entregou o mesmo documento no ano anterior. A data é sempre identificada como estimativa, com a origem ao lado. O menu ganha o item "Temporada", e o painel da página inicial, um link para ela. Com quatro itens, o menu das páginas de fundamentos fica sempre numa linha: cabe inteiro em 360 px e, em tela mais estreita, rola para os lados sem a página rolar (#68).
- **Card do próximo balanço na ficha**, abaixo da régua de anos: o próximo documento, a data provável com a origem, o prazo legal e o último documento entregue (#68).
- A coleta guarda `primeiraEntrega` em cada documento: a data de entrega mais antiga entre as versões. Num documento reapresentado, a data que já era guardada é a da reapresentação. O build grava `dist/fundamentos/dados/temporada.json`, e o índice das fichas ganha `dadosAte`, o dia até onde vão os arquivos da CVM (#68).

### Corrigido
- Painel da temporada: o número "prejuízo no acumulado" passa a contar também a companhia com lucro igual a zero, como já faziam as listas de variação, a soma por setor e a régua de anos. Antes, só contava lucro abaixo de zero (#72).
- O balão do capex na ficha passa a citar a propriedade para investimento, que já entrava na conta. Nenhuma conta mudou (#72).
- `npm test` passa inteiro num checkout do Windows: o `.gitattributes` fixa o fim de linha em LF para todo arquivo de texto (as fixtures da CVM continuam byte a byte), e o teste dos tokens de cor não depende mais do fim de linha (#72).

## [2.0.0] - 2026-11-14

A página Fundamentalista: os fundamentos de 64 companhias do Ibovespa, sem bancos e seguradoras, tirados dos documentos entregues à CVM, com a evolução ano a ano desde 2010 e o fluxo de caixa no centro. Só dados e regras à vista: nada de "compre", "venda", nota ou preço-alvo. Esta versão consolida as issues #29 a #40, #51, #65 e #66; o detalhe de cada uma está nos pull requests #53 a #70.

### Adicionado
- **Página Fundamentalista**, em `/fundamentos/`, com um menu comum a todas as páginas do site. A lista traz as 64 companhias por setor, com busca por ticker ou nome, e cada companhia tem a sua ficha em `/fundamentos/<ticker>/`. As tabelas vêm prontas no HTML e funcionam sem JavaScript.
- **Painel da temporada**, no topo de `/fundamentos/`: quantas companhias já entregaram o documento do período; em quantas o lucro, a receita e a margem líquida do acumulado do ano vieram maiores que os do ano anterior; as maiores altas e quedas do lucro; o lucro somado por setor; e quantas companhias acionam cada ponto de atenção.
- **Ficha de cada companhia**, com quatro blocos: Resultado, Caixa e dívida, Fluxo de caixa e Valuation. Cada linha é um indicador e cada coluna, um período: os últimos 12 meses e depois os exercícios, do mais recente até 2010. Cada linha tem um gráfico de tendência, e cada coluna, o link do documento de origem na CVM.
- **Indicadores**, calculados das demonstrações, com a fórmula à vista em cada um: receita, lucro bruto, EBIT, EBITDA e lucro líquido, com as margens; ROE, ROA e ROIC; caixa, dívida bruta e líquida (com e sem arrendamentos), cobertura de juros e liquidez; FCO, capex e fluxo de caixa livre (antes e depois dos arrendamentos), juros e proventos pagos; e ações em circulação, diluição e lucro, valor patrimonial, FCO e FCL por ação.
- **Múltiplos com a cotação do dia**: valor de mercado, P/L, P/VPA, EV, EV/EBITDA, preço/EBIT, earnings yield, dividend yield e preço/FCL. O preço vem da CNBC, com atraso de até 15 minutos, e é atualizado uma vez por dia.
- **Ao longo dos anos**, no topo da ficha: anos com lucro e com fluxo de caixa livre positivo, a maior sequência com lucro, o crescimento ao ano de receita, lucro e FCO em 5 e 10 anos, a amplitude da margem líquida e o pior ano da série.
- **Pontos de atenção**: sete regras automáticas, cada uma com a conta, os anos e o limite usado. São elas: lucro que não vira caixa, proventos maiores que o FCL, dívida líquida ÷ EBITDA alta, dívida concentrada no curto prazo, capex maior que o FCO, diluição e margem líquida em queda. Quatro limites podem ser trocados pelas variáveis `ATENCAO_*` do Actions.
- **Comparação com o setor**: a posição da companhia em relação à mediana das outras do setor, em oito indicadores.
- **Régua de anos**: uma faixa com um bloco por exercício (cheio é lucro, vazado é prejuízo, tracejado é sem dado), sob o nome da companhia na ficha e em miniatura na lista.
- **Tema claro e escuro**, que segue o tema do aparelho, com contraste AA conferido por teste. As cores, a tipografia e os espaços ficam em `site/tokens.css`.
- **CSV de cada bloco** da ficha, pronto para o Excel brasileiro (`;`, vírgula decimal e UTF-8 com BOM).
- **Aviso de dado desatualizado** na ficha, quando a companhia já deveria ter entregue um documento mais novo, pelos prazos da CVM. Cotação com mais de 5 dias úteis também sai marcada.
- **"Sem valor" com o motivo**: quando uma conta não pode ser feita, a célula mostra "—" e diz por quê. Nunca vira zero.
- **Coleta semanal dos fundamentos**: um workflow próprio baixa aos domingos os arquivos de DFP e ITR da CVM e grava na branch `dados` só o que mudou. A falha de um arquivo mantém o dado anterior, e o Diário não é afetado.
- **Aviso sobre o EBITDA**: o balão do EBITDA na ficha diz que ele é calculado das demonstrações e pode diferir do EBITDA ajustado divulgado pela companhia. O README traz o caso da Equatorial em 2025 (dívida líquida ÷ EBITDA de 3,9x na página e de 2,6x no release).
- **Documentação**: o README ganha a seção da página Fundamentalista (o que mostra, as fontes e o aviso legal), a fórmula de cada indicador, múltiplo, regra e número do painel, as decisões de arquitetura da v2.0 e as limitações conhecidas. Um teste (`test/readme-formulas.test.mjs`) confere que toda fórmula citada na página está no README. O `docs/cvm.md` registra o que foi medido nos dados abertos da CVM.

### Alterado
- **O site passa a ser montado por um build próprio** (`npm run build`, que gera `dist/`) e é publicado a partir de `dist/`, não mais de `site/`. Se o build falhar, nada é publicado. O CI também roda o build, e `npm run serve` serve `dist/`.
- **O Diário** continua na raiz, com o mesmo conteúdo. Ele ganha o menu, o tema claro e as mesmas cores e letras da página Fundamentalista; os widgets acompanham o tema.
- **A branch `dados`** guarda também os fatos das companhias (`fundamentos/`) e o preço das ações (`cotacoes-fundamentos.json`), além do histórico diário e dos resumos.
- A consulta à CNBC saiu de `scripts/logica.mjs` e de `scripts/update.mjs` e fica só em `scripts/precos/cnbc.mjs`, atrás de um adaptador. O placar e o mapa do Diário não mudaram.
- A versão do `package.json` passa a 2.0.0.

### Removido
- Nada do que existia na v1.0 foi retirado do site.
- Os nomes antigos das variáveis de cor do CSS do Diário, trocados pelos tokens de `site/tokens.css`.
- O indicador "Custo aproximado da dívida" (despesas financeiras ÷ dívida bruta) existiu durante o desenvolvimento e saiu antes do lançamento: as despesas financeiras incluem variação cambial e derivativos, e o número enganava (na WEG, de 41% a 64% ao ano). Fica o "Custo da dívida pelos juros pagos".

### Limitações conhecidas
- Séries por ação sem ajuste por desdobramento ou grupamento; preço do dia sem série histórica; bancos e seguradoras fora; e EBITDA das demonstrações, não o ajustado. O detalhe está em "Limitações conhecidas", no README.

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

[Não lançado]: https://github.com/rodrigoab1980/panorama-economico/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/rodrigoab1980/panorama-economico/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/rodrigoab1980/panorama-economico/releases/tag/v1.0.0
