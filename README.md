# Panorama Econômico

[![CI](https://github.com/rodrigoab1980/panorama-economico/actions/workflows/ci.yml/badge.svg)](https://github.com/rodrigoab1980/panorama-economico/actions/workflows/ci.yml)

Painel matinal de mercado, publicado no GitHub Pages e atualizado sozinho nos dias úteis.

- **Resumo do dia** escrito pelo Claude: tom do mercado, Ásia, Europa, EUA, Brasil e emergentes, commodities e juros, pontos-chave e as notícias que podem mexer com os preços. É refeito a cada hora, das 6h às 20h.
- **Como estão os mercados**: placar com bolsas, câmbio, commodities e juros de 10 anos (CNBC), com a variação do dia, da semana e do mês. Semana e mês vêm do [histórico diário](#histórico-diário) próprio e mostram "—" até o histórico cobrir o período.
- **Alertas de movimento fora do padrão**: uma faixa laranja no topo do placar lista os ativos que se moveram muito além do normal no dia. Veja [como é decidido](#alertas-de-movimento-fora-do-padrão).
- **Ativos em abas** (widgets TradingView, atraso de até 15 min): Futuros EUA, Europa, Ásia/Pacífico, Dólar DXY, Emergentes, Títulos Brasil (curva DI), Títulos EUA, Metais, Agrícolas, B3, Energia e Futuros.
- **Mapa de ações** do S&P 500 e do Ibovespa, desenhado pelo próprio site com cotações da CNBC (atualiza a cada 15 minutos). Cor = variação do dia; tamanho = valor de mercado (EUA) ou peso aproximado no índice (Ibovespa). As listas ficam em `MAPAS` e `PESO_IBOV`, no início de `scripts/update.mjs`.
- **Notícias ao vivo**: InfoMoney, Valor, Money Times, Investing, CNBC, MarketWatch, Yahoo Finance (manchetes de S&P 500, Dow Jones e Nasdaq) e Google News. Atualizadas a cada 15 minutos. Se uma fonte falhar, as demais seguem normalmente e as notícias já coletadas continuam na página.
- **Agenda**: destaques do dia e calendário do Investing.com, mais os eventos de 3 estrelas da semana.
- **Aviso de dado desatualizado**: cada bloco mostra quando foi atualizado ("há 5 min · 12/11 14:07"). Se uma coleta falhar, a página continua com o último dado disponível e o carimbo fica laranja com "⚠ desatualizado" depois de 1 h sem atualizar (2 h para o resumo). Só conta o horário de coleta (seg–sex, 6h–21h de Brasília), então nada fica marcado à noite nem no fim de semana. A regra fica em `site/atraso.js`.

## Como funciona

```
cron-job.org (a cada 15 min, seg–sex, 6h00–20h45) ── chama a API do GitHub ──┐
GitHub Actions, schedule de reserva (6h07–20h52; pula se o externo já rodou) ─┤
                                                                              ▼
GitHub Actions: workflow "Atualizar panorama"
  └─ baixa a branch `dados` (histórico) na pasta dados/
  └─ scripts/update.mjs → site/data/*.json  (notícias, cotações, agenda, resumo)
  └─ a partir das 19h: grava o fechamento do dia e o resumo na branch `dados`
  └─ scripts/build.mjs → dist/  (cópia de site/, inclusive site/data/, com o menu comum)
  └─ publica a pasta dist/ no GitHub Pages
Navegador
  └─ o Diário (index.html, na raiz) lê os JSON a cada 5 min; os widgets da TradingView atualizam ao vivo
```

O site tem mais de uma página, com um menu comum: o **Diário** (visão de trade) continua na raiz, e a **Fundamentalista** fica em `fundamentos/` (por enquanto, só um esqueleto; o conteúdo vem na #38). O build troca o marcador `<!-- menu -->` de cada página pelo menu, e o resto do HTML fica igual. Todos os links internos são relativos, porque o GitHub Pages serve o site num subcaminho (`/panorama-economico/`): um link que comece com `/` quebraria em produção. As páginas da v3 (Overview e Treinamentos) só entram no menu quando existirem.

### Estrutura do repositório

| Caminho | O que é |
|---|---|
| `scripts/update.mjs` | Coleta (rede), gravação dos JSON, histórico e chamada ao Claude. Configuração das fontes no início do arquivo. |
| `scripts/logica.mjs` | Toda a lógica pura: sem rede, sem disco, sem relógio implícito. É o que os testes cobrem. |
| `scripts/guarda.mjs` | Decide se a execução agendada (reserva) pula porque o gatilho externo já rodou. |
| `scripts/build.mjs` | Monta `dist/` a partir de `site/`, insere o menu em cada página e gera as fichas das companhias em `dist/fundamentos/dados/`. Só lê e grava; a lógica fica em `scripts/paginas.mjs` e em `scripts/cvm/ficha.mjs`. |
| `scripts/precos/` | Preço das ações do universo. `fonte.mjs` define o contrato de uma fonte de preço e as regras puras da coleta; `cnbc.mjs` é o adaptador da CNBC, o único arquivo que conhece o serviço dela. Veja [Fonte de preço](#fonte-de-preço). |
| `scripts/fundamentos/` | A página Fundamentalista (lógica pura, testada): `formatar.mjs`, `pagina.mjs` (HTML da ficha e da lista), `csv.mjs` e `carimbo.mjs`. Veja [Página Fundamentalista](#página-fundamentalista). |
| `scripts/zip.mjs` | Leitor de ZIP mínimo (lógica pura, só com `node:zlib`): métodos 0 e 8, com conferência de tamanho e de CRC-32. Lança erro claro para ZIP64, criptografia e arquivo em vários discos. |
| `scripts/zip-fluxo.mjs` | O mesmo leitor em fluxo, direto do disco: descomprime cada arquivo do ZIP aos pedaços, linha a linha, sem carregar nada inteiro. É o que lê os ZIPs da CVM. |
| `scripts/coletar-fundamentos.mjs` | Coleta semanal dos fundamentos (rede e disco): `HEAD`, download, extrato de cada ZIP e gravação em `dados/fundamentos/`. As regras ficam em `scripts/cvm/coleta.mjs`. Veja [Coleta dos fundamentos](#coleta-dos-fundamentos). |
| `scripts/publicar-dados.mjs` | Commit na branch de dados só quando algo mudou, e push com nova tentativa quando é rejeitado. |
| `scripts/paginas.mjs` | Lista de páginas do menu e funções puras do build: `menuHtml`, `inserirMenu`, `removerMenu` e `linksInternos` (usada no teste de links). |
| `scripts/cvm/` | Dados da CVM. `leitor.mjs` (lógica pura, testada) transforma cada linha dos CSVs de DFP e ITR num fato normalizado, em R$ mil, uma linha por vez. `series.mjs` (lógica pura, testada) monta com esses fatos a série anual e a base de 12 meses de cada companhia, e `tabela-series.mjs` imprime o resultado em R$ milhões para conferência. `classificador-dfc.mjs` (lógica pura, testada) acha pela descrição as linhas da DFC que não têm código fixo (capex, juros pagos, arrendamentos e proventos), com as exceções por companhia em `excecoes-dfc.json`. `composicao-capital.mjs` (lógica pura, testada) lê o número de ações. `indicadores.mjs` (lógica pura, testada) calcula os indicadores de resultado, retorno, caixa, dívida, liquidez, fluxo de caixa e por ação de cada período, com a fórmula de cada um em texto. `universo.mjs` (lógica pura, testada) e `gerar-universo.mjs` montam o `universo.json`, a lista de companhias da página Fundamentalista, a partir do FCA e de três arquivos mantidos à mão (`tickers-ibovespa.json`, `excecoes-tickers.json` e `setores.json`). `fixtures.mjs` (lógica pura, testada) e `gerar-fixtures.mjs` recriam as fixtures a partir de CSVs extraídos; `spike/` guarda os scripts de medição do spike (#29), descritos em `docs/cvm.md`. |
| `site/` | A fonte do site: o Diário (`index.html`, `app.js`, `atraso.js` e `style.css`), a página `fundamentos/` e o `menu.css`. Os JSON vão para `site/data/`, gerados a cada execução e fora do git. |
| `dist/` | O site pronto para publicar, gerado por `npm run build`. Fora do git. |
| `test/` | Testes `node:test`, um arquivo por assunto. `test/fixtures/cvm/` guarda recortes reais dos arquivos da CVM, byte a byte. |
| `docs/cvm.md` | O que foi medido nos dados abertos da CVM (formato, contas, volume e riscos), base da página Fundamentalista da v2.0. |
| `.github/workflows/atualizar.yml` | Coleta, histórico, build e deploy de `dist/` no GitHub Pages. |
| `.github/workflows/fundamentos.yml` | Coleta semanal dos fundamentos da CVM. Grava os fatos na branch de dados; não publica o site e não usa segredos. |
| `.github/workflows/ci.yml` | Roda os testes e o build em todo PR e na `main`. Não publica nada. |
| branch `dados` | Histórico diário, resumos arquivados, o preço das ações do universo (`cotacoes-fundamentos.json`) e os fatos das companhias (`fundamentos/`). Só o robô escreve nela. |

## Decisões de arquitetura

As escolhas que moldam o projeto, com a alternativa considerada e o motivo. As marcadas com uma issue foram decididas entre duas opções antes do código.

1. **Site estático + GitHub Actions, sem servidor.** O Actions coleta e grava JSON; o GitHub Pages serve os arquivos; o navegador só lê. *Alternativa:* um servidor próprio (VPS, função serverless). *Por quê:* custo zero, nada para manter no ar, e a página continua de pé mesmo se a coleta parar.
2. **Cada fonte falha sozinha, com fallback para o último JSON publicado.** Cada coleta (notícias, cotações, agenda, mapa) tem timeout de 20 s; se falhar, o script reaproveita o JSON que já está no site. A página mostra quando cada bloco foi atualizado e destaca o que passou de 1 h (#11). *Alternativa:* abortar a execução inteira. *Por quê:* uma fonte fora do ar não deve apagar as outras.
3. **Lógica pura separada do I/O, testada com `node:test`, sem dependências novas** (#6). Tudo que decide algo (filtrar notícias, calcular variação, alertar, pular execução) fica em `scripts/logica.mjs` e recebe o "agora" por parâmetro. *Alternativa:* Jest/Vitest. *Por quê:* o Node já traz o executor de testes; menos dependências, menos atualização.
4. **Histórico na branch `dados`, não na `main`** (#13, opção A). *Alternativa:* guardar só no site publicado, relendo a versão anterior a cada execução (opção B). *Por quê:* fica versionado (cada dia é um commit, dá para auditar e recuperar) e o robô não precisa escrever na `main`, que pode ser protegida com o CI obrigatório.
5. **Alerta relativo à volatilidade do próprio ativo** (#14, opção A): movimento ≥ 2,5 desvios padrão das variações diárias, com limite fixo enquanto o histórico é curto. *Alternativa:* um limite fixo em % igual para todos (opção B). *Por quê:* 3% é rotina para bitcoin e raro para um índice; o limite fixo alertaria demais em uns e de menos em outros.
6. **Gatilho externo (cron-job.org) com o `schedule` do GitHub de reserva e uma guarda contra duplicatas** (#15). *Alternativa:* só o `schedule`. *Por quê:* o agendamento do GitHub atrasa e descarta execuções. Os horários ficam defasados (:00 externo, :07 reserva), e a reserva pula se o externo rodou nos últimos 15 min.
7. **O token do gatilho nunca entra no repositório.** É fine-grained, restrito a este repositório, só com *Actions: Read and write* e com validade, e fica apenas no cron-job.org. *Alternativa:* guardar nos Secrets. *Por quê:* o repositório não precisa dele; quem chama a API é o cron-job.org.
8. **Cotações da CNBC no servidor, widgets da TradingView no navegador.** O placar, o mapa, o histórico e os alertas usam a CNBC, porque precisam de números que o script consiga ler. As abas usam widgets prontos, que já atualizam ao vivo. *Por quê:* sem chave de API paga para nenhuma das duas.
9. **Resumo pelo Claude no máximo de hora em hora** (`SUMMARY_INTERVAL_MIN`), só das 6h às 20h, e só se houver chave. *Por quê:* controla o custo; sem a chave, o resto do site funciona igual.
10. **Node 24 ou mais novo, CI no 24 e no 26** (#12). *Por quê:* as actions do GitHub deixaram o Node 20; testar também a versão seguinte avisa cedo de incompatibilidades.

## Histórico diário

O placar calcula a variação na semana e no mês com um histórico próprio, guardado na branch **`dados`** do repositório (não na `main`). O workflow cria essa branch sozinho na primeira execução.

- **O que é gravado:** a partir das 19h de Brasília, cada execução grava o valor de cada ativo do placar como fechamento do dia. A última coleta do dia (20h52) vence. Só entram cotações coletadas na hora, nunca o dado antigo usado quando a CNBC falha.
- **Onde:** `historico.json` na branch `dados`, mais os resumos do fim do dia em `arquivo/AAAA-MM-DD.json`. Cada dia vira um commit do `github-actions[bot]` nessa branch.
- **Formato** (uma linha por dia, para o diff mostrar só o dia novo):

  ```json
  {"formato": 1, "fechamentos": {
    "2026-11-11": {".SPX":7619.38,"US10Y":4.989,".BVSP":172060.43},
    "2026-11-12": {".SPX":7644.91,"US10Y":5.068,".BVSP":171238.81}
  }}
  ```
  As chaves são a data de Brasília e o símbolo da CNBC (o mesmo de `simbolo` em `cotacoes.json`). Juros ficam em % ao ano.
- **Como a variação é calculada:** contra o fechamento de 7 dias corridos atrás (semana) e de 30 dias atrás (mês). Se esse dia não tem dado (fim de semana, feriado, coleta que falhou), usa o dia anterior mais próximo, até 4 dias antes. Se não houver nada nesse intervalo, ou o histórico ainda for curto, a variação fica vazia ("—") em vez de comparar com um dado velho demais. Preços em %, juros em pontos-base. Passe o mouse sobre o número para ver a data de referência.
- **Limitação:** os futuros (ES, NQ, petróleo, ouro...) usam sempre o 1º vencimento. Na semana em que o contrato vira, a variação compara contratos diferentes.
- **Falhas não derrubam o site:** se a branch `dados` não puder ser baixada ou gravada, o site é publicado do mesmo jeito, só sem as variações de semana e mês.
- **Rodando localmente**, o histórico fica na pasta `dados/`, ignorada pelo git (ou em outra pasta, com a variável `DADOS_DIR`).

As funções de cálculo ficam em `scripts/logica.mjs` (`registrarFechamento`, `fechamentoReferencia`, `variacoesPeriodo`) e têm testes em `test/historico.test.mjs`.

## Alertas de movimento fora do padrão

Um ativo entra na faixa "⚠ Fora do padrão hoje" quando a variação do dia (contra o fechamento anterior, a mesma da coluna "Dia") é grande demais para ele:

- **Com histórico (20 dias ou mais):** a variação do dia é comparada com a oscilação diária típica do próprio ativo, que é o desvio padrão das variações diárias dos últimos 60 fechamentos do [histórico diário](#histórico-diário). Alerta quando o movimento é **2,5 vezes** maior que essa oscilação. Assim, um bitcoin que sobe 3% (normal para ele) não alerta, e um título do Tesouro que anda 12 bps num período calmo alerta.
- **Com histórico curto (as primeiras ~4 semanas):** usa um limite fixo, **3%** para preços e **15 bps** para juros.
- "No limite" já conta como alerta. Para cima ou para baixo, tanto faz.
- Passando o mouse sobre um alerta, aparece a oscilação típica usada na conta. Sobre o título da faixa, aparece a regra.

Os três números são configuráveis (tabela abaixo). A lógica fica em `scripts/logica.mjs` (`avaliarMovimento`, `detectarAlertas`) e os testes em `test/alertas.test.mjs`. Os alertas vão para `cotacoes.json` (`alertas` e `criterio_alerta`).

## Indicadores fundamentalistas

A página Fundamentalista (em construção na v2.0) mostra, para cada exercício e para os últimos 12 meses, os indicadores abaixo. Eles saem das contas fixas das demonstrações consolidadas que a companhia entrega à CVM. Os valores ficam em R$ mil e as razões em fração, sem arredondar; a página é que arredonda e mostra em %. Cada indicador leva a fórmula em texto, que a página vai mostrar ao passar o mouse.

| Indicador | Fórmula |
|---|---|
| Receita líquida | DRE 3.01 |
| Lucro bruto | DRE 3.03, como a companhia informa |
| Margem bruta | Lucro bruto ÷ receita líquida |
| EBIT | DRE 3.05 (resultado antes do resultado financeiro e dos tributos) |
| Depreciação e amortização (D&A) | A da DFC (linhas de depreciação, amortização e exaustão nos ajustes do lucro); sem ela, DVA 7.04.01 com o sinal trocado |
| EBITDA | EBIT + D&A |
| Margem EBITDA | EBITDA ÷ receita líquida |
| Resultado financeiro | DRE 3.06 |
| Lucro líquido | DRE 3.11 (consolidado, com a parte dos minoritários) |
| Margem líquida | Lucro líquido ÷ receita líquida |
| ROE | Lucro líquido ÷ patrimônio líquido (BPP 2.03) no fim do período |
| ROA | Lucro líquido ÷ ativo total (BPA 1) no fim do período |
| ROIC | EBIT × (1 − 34%) ÷ capital investido no fim do período |

Capital investido = patrimônio líquido + dívida bruta − caixa, com a dívida bruta e o caixa da tabela abaixo.

Caixa, dívida e liquidez, sempre com o saldo do fim do período:

| Indicador | Fórmula |
|---|---|
| Patrimônio líquido | BPP 2.03 |
| Caixa | BPA 1.01.01 + 1.01.02 (caixa e equivalentes + aplicações financeiras) |
| Dívida bruta | (BPP 2.01.04 − 2.01.04.03) + (2.02.01 − 2.02.01.03) + as linhas de empréstimos, financiamentos e debêntures em outras obrigações (2.01.05 e 2.02.02): sem arrendamentos |
| Arrendamentos | 2.01.04.03 + 2.02.01.03 + as linhas de arrendamento em outras obrigações (2.01.05 e 2.02.02) |
| Dívida bruta com arrendamentos | Dívida bruta + arrendamentos |
| Dívida líquida | Dívida bruta − caixa. Negativa quer dizer mais caixa do que dívida |
| Dívida líquida com arrendamentos | Dívida bruta + arrendamentos − caixa |
| Dívida bruta ÷ patrimônio líquido | Dívida bruta ÷ BPP 2.03 |
| Dívida líquida ÷ EBITDA | Dívida líquida ÷ EBITDA do período |
| Dívida de curto prazo | (2.01.04 − 2.01.04.03) ÷ dívida bruta |
| Despesas financeiras | DRE 3.06.02, com o sinal trocado |
| Cobertura de juros | EBIT ÷ despesas financeiras |
| Liquidez corrente | BPA 1.01 ÷ BPP 2.01 |
| Liquidez imediata | Caixa ÷ BPP 2.01 |

As escolhas por trás das fórmulas:

1. **Saldo do fim do período, não a média.** ROE, ROA e ROIC dividem pelo saldo de fechamento. Assim o primeiro ano da série também tem valor.
2. **No ROE, lucro e patrimônio entram os dois com minoritários** (3.11 ÷ 2.03), para os dois lados ficarem na mesma base.
3. **O ROA é lucro ÷ ativo**, a definição clássica. Outras fontes usam EBIT ÷ ativo e chegam a um número maior.
4. **O ROIC usa a alíquota nominal de 34%** (IR + CSLL), não a efetiva. A efetiva oscila com JCP, incentivos e prejuízo fiscal, e faria o ROIC variar sem motivo operacional.
5. **A dívida bruta não inclui arrendamentos (IFRS 16), e as duas versões são sempre calculadas.** O número principal é sem arrendamentos; a dívida bruta e a líquida "com arrendamentos" saem ao lado. Em varejo e telecom o arrendamento passa da dívida (na Raia Drogasil, 4,97 bilhões contra 3,87 bilhões em 2025), então os dois números contam histórias diferentes. Quem lança o arrendamento dentro de empréstimos e financiamentos (contas 2.01.04.03 e 2.02.01.03) tem esse valor tirado da dívida bruta.
6. **Os arrendamentos são achados pela descrição.** A maioria das companhias não usa a conta fixa: cria uma linha própria em "outras obrigações", sem código fixo. Entram as linhas de 2.01.05 e 2.02.02 cuja descrição contém "arrendament". "Aluguéis" não entra, porque é aluguel a pagar. Se uma linha e uma sublinha dela batem, conta só a de cima. Quando nenhuma linha bate e as duas contas fixas estão zeradas, o indicador fica vazio, com o motivo "nenhuma linha de arrendamento identificada no passivo", e as duas versões "com arrendamentos" ficam vazias junto. Não vira zero, porque a companhia pode ter o arrendamento dentro de outra linha: na DFP de 2025 isso acontece em 12 das 64 companhias da página. A dívida sem arrendamentos não muda.
7. **"Despesas financeiras" é uma aproximação dos juros.** A conta da DRE inclui variação cambial, juros de arrendamento e outros encargos. Por isso a cobertura de juros é aproximada. O "custo aproximado da dívida" (despesas financeiras ÷ dívida bruta) saiu da lista: na WEG ele dava de 41% a 64% ao ano, por causa do câmbio e dos derivativos. O custo da dívida que fica é o calculado pelos juros pagos, do fluxo de caixa.
8. **Dívida lançada em outras obrigações entra pela descrição.** A Allos deixa as contas de empréstimos zeradas e registra a dívida numa linha própria de outras obrigações. Por isso a dívida bruta soma também as linhas sem código fixo de 2.01.05 (curto prazo) e 2.02.02 (longo prazo) cuja descrição tem "empréstimo" e também "financiamento" ou "debênture". O empréstimo compulsório fica de fora: é um passivo com consumidores, não uma dívida financeira. Vale a mesma regra de não contar uma linha e a sublinha dela.
9. **Dívida fora das contas padrão vira aviso, não zero.** Se, mesmo assim, a dívida bruta dá zero e a despesa financeira passa de 0,5% do ativo total, a dívida e tudo o que depende dela (inclusive o ROIC) ficam vazios, com o motivo "a dívida pode estar fora das contas padrão". O limite de 0,5% separa quem só paga tarifas e IOF de quem tem dívida. Hoje nenhuma das 64 companhias dispara o aviso.

Fluxo de caixa, proventos e valores por ação:

| Indicador | Fórmula |
|---|---|
| FCO, FCI e FCF | DFC 6.01, 6.02 e 6.03 (caixa das atividades operacionais, de investimento e de financiamento) |
| Capex | Pagamentos por imobilizado, intangível, ativo de contrato, ativo biológico e propriedade para investimento, achados pela descrição das linhas de 6.02 |
| FCL | FCO − capex |
| FCL depois dos arrendamentos | FCO − capex − pagamentos de arrendamento que estão no financiamento (principal e juros) |
| FCO ÷ EBITDA | FCO ÷ EBITDA |
| Capex ÷ FCO | Capex ÷ FCO |
| Juros pagos | Juros de dívida pagos, achados pela descrição das linhas de 6.01 e 6.03, sem os de arrendamento |
| Cobertura dos juros pagos | EBIT ÷ juros pagos |
| Custo da dívida pelos juros pagos | Juros pagos ÷ dívida bruta |
| Proventos pagos | Dividendos e juros sobre o capital próprio pagos aos acionistas da companhia, achados pela descrição das linhas de 6.03 |
| Ações em circulação | Ações do capital − ações em tesouraria, no fim do período |
| Diluição | Ações em circulação ÷ as do exercício anterior − 1 (só na série anual) |
| Lucro por ação | Lucro da controladora (DRE 3.11.01) ÷ ações em circulação, em R$ |
| FCO por ação e FCL por ação | FCO ÷ ações; FCL ÷ ações, em R$ |

As escolhas do fluxo de caixa:

10. **As linhas da DFC são achadas pela descrição.** Capex, juros pagos, arrendamentos e proventos não têm código fixo: a mesma linha muda de código de uma companhia para outra, e até entre a DFP e o ITR da mesma companhia. Um classificador (`scripts/cvm/classificador-dfc.mjs`) tira os acentos, passa para minúsculas e aplica a regra de cada categoria, que fica à vista em `CATEGORIAS`. Linha não identificada deixa o indicador vazio, com o motivo, e nunca vira zero. Exceções de uma companhia vão em `scripts/cvm/excecoes-dfc.json`, sempre com o motivo.
11. **Ativo de contrato entra no capex.** Nas concessões (Sabesp, Cemig) é o capex de verdade; sem ele, o capex dessas companhias daria quase zero.
12. **Ativo biológico entra no capex.** Plantio e madeira em pé (Klabin, Suzano) são reinvestimento para manter a operação.
12a. **Propriedade para investimento entra no capex**, quando a linha é de aquisição, adição ou construção. Nos shoppings (Allos, Multiplan) é o reinvestimento de verdade: sem ela, o capex ÷ FCO da Multiplan em 2025 saía 2,8%, e com ela sai 52,7%. Baixa e alienação ficam de fora.
13. **Aquisição de empresa fica fora do capex.** Uma compra distorceria a série de um ano. Venda de ativos e aplicações financeiras também ficam de fora. Linha que mistura capex com outra coisa ("adições ao imobilizado, intangível e investimentos") entra, marcada como mista.
14. **Proventos são só os pagos aos acionistas da companhia.** Os pagos a não controladores saem numa categoria separada, porque esse dinheiro não vai para quem tem a ação.
15. **Há sempre dois FCL.** O primeiro é FCO − capex. O segundo desconta também os pagamentos de arrendamento. Desde 2019 (IFRS 16), o aluguel deixou de sair do caixa operacional e passou a aparecer no financiamento, o que engorda o FCO de quem aluga muito. Na Raia Drogasil, em 2025, o FCL é de 1.027.677 mil e cai para 106.493 mil depois dos arrendamentos. Os juros de arrendamento que a companhia já lança no FCO não são descontados de novo. Sem linha de arrendamento na DFC, o segundo FCL fica vazio, e não igual ao primeiro. Quando a companhia junta o pagamento de arrendamento com o de dívida numa linha só (Vivo), ele também fica vazio, com o motivo.
16. **A D&A do EBITDA é a da DFC; a da DVA fica de reserva.** A D&A sai das linhas de depreciação, amortização e exaustão nos ajustes do lucro da DFC, achadas pela descrição. Em algumas companhias a DVA não traz a amortização toda: na Hapvida de 2025 a DVA dá 870 milhões e a DFC, 1.562 milhões, e o EBITDA sobe 30%. Quando a DFC não tem a linha, vale a DVA (conta 7.04.01). Nos 12 meses, a DFC só vale se a linha foi identificada nas três parcelas. O resultado diz de onde a D&A saiu (`origem`: "DFC" ou "DVA"). Na DFP de 2025, as 64 companhias da página usam a DFC, e o EBITDA muda em 14 delas. O caso contrário também existe: quem lança a exaustão do ativo biológico numa linha com outro nome ("Ativos biológicos colhidos", na São Martinho) fica com a D&A da DFC menor que a da DVA. Por isso, **quando a D&A da DFC vem mais de 15% abaixo da D&A da DVA, vale a da DVA**, com a `origem` "DVA (DFC 15% menor)": é sinal de linha que a regra não achou. O limite está em `LIMITE_DA_DFC_ABAIXO_DA_DVA`. Na São Martinho a DFC dá 1.086.030 e a DVA, 2.371.247, e o EBITDA fica em 3.766.048 (R$ mil). Nenhuma das 64 companhias da página cai nessa regra, nem na DFP de 2025 nem nos 12 meses.
17. **O lucro por ação usa o lucro da controladora (3.11.01), não o consolidado (3.11).** A parte dos minoritários não pertence ao acionista. Quando a demonstração é individual, vale o 3.11. Quando a companhia não abre o lucro entre controladora e não controladores, o lucro por ação fica vazio.
18. **O número de ações vem da composição do capital, convertido para unidades.** O arquivo da CVM não diz se a quantidade está em unidades ou em milhares, e cerca de um quarto das companhias informa em milhares. A escala é descoberta pelo lucro por ação que a própria companhia informa no mesmo documento; sem ele, pela ordem de grandeza (menos de 100 milhões está em milhares). É o único uso do lucro por ação informado: nenhum indicador é calculado com ele.
19. **Diluição fora de −50% a +50% não é mostrada.** O arquivo da CVM não traz desdobramentos e grupamentos: um desdobramento de 1 para 3 apareceria como +200% (Direcional, 2025) e um grupamento de 15 para 1, como −94% (Hapvida, 2025), e nenhum dos dois muda a fatia do acionista. Fora da faixa, a diluição fica vazia, com o motivo "variação de N% sugere desdobramento ou grupamento". O limite (`LIMITE_DILUICAO`) tem dois efeitos colaterais conhecidos: uma emissão grande de verdade também fica vazia, e uma bonificação em ações abaixo de 50% passa como se fosse diluição.

Nos últimos 12 meses, o resultado é a soma de 12 meses (ver `docs/cvm.md`) e o balanço é o da data do ITR mais recente. As linhas da DFC achadas pela descrição são classificadas em cada uma das três parcelas (o ano fechado, o acumulado do ITR atual e o acumulado do ITR do ano anterior) e só então somadas. Se a linha aparece numa parcela e não em outra, o indicador fica vazio, com o motivo dizendo em qual documento ela faltou. As ações são as do ITR mais recente.

Quando não dá para calcular, o indicador fica vazio, com o motivo, e nunca vira zero: falta uma conta, a receita é zero ou negativa (margens), o patrimônio, o ativo ou o capital investido é zero ou negativo (retornos), ou a base de 12 meses não fechou. Num exercício de transição, com menos de 12 meses, os valores, as margens e os saldos do balanço saem, mas ROE, ROA, ROIC, dívida líquida ÷ EBITDA, cobertura de juros e custo da dívida não: nada é anualizado. O EBITDA depende da D&A; sem ela na DFC e na DVA, fica vazio, e o EBIT não entra no lugar.

Nos indicadores de dívida, a dívida líquida negativa é um valor válido (caixa líquido), não um vazio. Dívida líquida ÷ EBITDA fica vazia com EBITDA zero ou negativo. A parcela de curto prazo fica vazia para quem não tem dívida ("sem dívida financeira"). A cobertura fica vazia com despesa financeira zero ou negativa, e também quando a companhia informa só o resultado financeiro líquido, sem abrir receitas e despesas. As duas liquidezes ficam vazias com passivo circulante zero.

No fluxo de caixa, capex ÷ FCO fica vazio com FCO zero ou negativo, e FCO ÷ EBITDA, com EBITDA zero ou negativo. O FCL negativo é um valor válido. A cobertura e o custo pelos juros pagos ficam vazios quando os juros não foram identificados, quando são zero, ou quando vêm misturados com os juros de arrendamento. Sem a composição do capital do período, as ações e os valores por ação ficam vazios. A diluição fica vazia no primeiro ano da série e nos 12 meses.

São só dados e regras à vista. Nada aqui é recomendação de investimento.

A lógica fica em `scripts/cvm/indicadores.mjs` (`INDICADORES`, `calcularIndicadores`, `caixa`, `dividaBruta`, `arrendamentos`, `ARRENDAMENTOS`, `DIVIDA_POR_DESCRICAO`, `LIMITE_DESPESA_SEM_DIVIDA`, `LIMITE_DILUICAO`, `LIMITE_DA_DFC_ABAIXO_DA_DVA`, `fluxosClassificados`, `depreciacaoEAmortizacao`, `calcularIndicadoresDaSerie`), em `scripts/cvm/classificador-dfc.mjs` (`CATEGORIAS`, `ORDEM`, `classificarLinhas`) e em `scripts/cvm/composicao-capital.mjs` (`lerComposicaoCapital`, `escalaDasAcoes`). Os testes ficam em `test/cvm-indicadores.test.mjs` e `test/cvm-fluxo-de-caixa.test.mjs`, que conferem os números com os releases de resultados, os balanços e as demonstrações de fluxo de caixa de 2025 da WEG e da Raia Drogasil.

## Múltiplos e fonte de preço

Os múltiplos juntam o preço da ação com os fundamentos dos 12 meses. O fundamento é coletado uma vez por semana (CVM) e o preço, uma vez por dia; os dois se encontram na hora de montar o site. A lógica fica em `scripts/cvm/multiplos.mjs` (`MULTIPLOS`, `calcularMultiplos`, `valorDeMercado`, `fundamentosParaMultiplos`), pura e testada. A ficha de cada companhia, que mostra esses números, vem na #38.

| Múltiplo | Conta |
|---|---|
| Valor de mercado | Soma, classe por classe, das ações em circulação (total menos tesouraria) vezes o último preço do ticker da classe |
| P/L | Valor de mercado ÷ lucro líquido da controladora em 12 meses (conta 3.11.01) |
| P/VPA | Valor de mercado ÷ patrimônio líquido da controladora (2.03 menos os não controladores, 2.03.09) |
| Valor da firma (EV) | Valor de mercado + dívida líquida (sem arrendamentos) + participação dos não controladores (2.03.09) |
| EV/EBITDA | EV ÷ EBITDA dos 12 meses |
| Preço/EBIT | Valor de mercado ÷ EBIT dos 12 meses |
| Earnings yield | Lucro líquido da controladora ÷ valor de mercado |
| Dividend yield | Proventos pagos em 12 meses (da DFC) ÷ valor de mercado |
| Preço/FCL | Valor de mercado ÷ FCL dos 12 meses, nas duas versões do FCL (antes e depois dos arrendamentos) |

Regras à vista:

1. **O valor de mercado sai das classes, nunca da unit.** A composição do capital da CVM traz ordinárias e preferenciais em separado. As ordinárias usam o preço do ticker de final 3 e as preferenciais, o de final 4, 5 ou 6 (o que está no Ibovespa tem preferência). A unit só serve de cotação do ticker: somá-la contaria a mesma ação duas vezes. A Klabin está no universo pela unit (KLBN11), e o valor de mercado dela sai de KLBN3 e KLBN4.
2. **Ações em circulação, sem a tesouraria.** Por isso o valor de mercado fica um pouco abaixo do de fontes que multiplicam o preço pelo total de ações: 9% a menos na PRIO, 6% na Lojas Renner.
3. **Classe sem cotação usa o preço da outra classe**, e o resultado sai marcado como aproximado, com o motivo. Hoje são dois casos: Sabesp e Copel têm preferenciais na composição do capital, e elas não negociam. Sem cotação em nenhuma classe, o valor de mercado fica vazio.
4. **Não controladores.** No P/L e no P/VPA eles ficam de fora, porque o valor de mercado é só das ações da controladora. No EV eles entram, porque o EBITDA consolidado inclui 100% das controladas.
5. **"Não se aplica" em vez de número negativo.** P/L com lucro zero ou negativo, P/VPA com patrimônio zero ou negativo, preço/EBIT, preço/FCL e EV/EBITDA com o denominador zero ou negativo ficam vazios, com o motivo. O EV/EBITDA também fica vazio quando o EV é zero ou negativo (caixa líquido maior que o valor de mercado). O earnings yield continua saindo com lucro negativo, e sai negativo.
6. **Cotação desatualizada.** Cada preço carrega a data do seu último negócio. Com mais de 5 dias úteis entre essa data e o dia em que o site é montado (`LIMITE_DIAS_UTEIS_COTACAO`), o múltiplo continua saindo, marcado como desatualizado, com a data ao lado. Os dias úteis são contados de segunda a sexta, sem descontar feriados. A regra de atraso do Diário (`site/atraso.js`) não foi reaproveitada: ela conta minutos dentro da janela do workflow.
7a. **Número de ações que diverge do documento anterior.** Se o total de ações do documento mais recente diverge mais de 50% do anterior (`LIMITE_DILUICAO`), o valor de mercado e os múltiplos que dependem dele ficam vazios, com o motivo "o número de ações do ITR de dd/mm/aaaa diverge N% do documento anterior". É o caso do ITR de 30/09/2026 da Vivara, que informa 82 milhões de ações contra 236 milhões em junho.
7. **Sem os 12 meses, sem múltiplos.** Quando a base de 12 meses da companhia está indisponível (TIM), todos os múltiplos ficam vazios com o motivo da série. O valor de mercado, que só depende do preço e do número de ações, continua saindo.
8. **O número de ações é o do último ITR.** Uma emissão, bonificação ou desdobramento depois dessa data só aparece no ITR seguinte.

São só dados e regras à vista. Nada aqui é recomendação de investimento.

### Fonte de preço

- **Fonte:** o serviço de cotações da CNBC, o mesmo do placar e do mapa do Diário, com atraso de até 15 minutos. É uma consulta em lotes de 40 símbolos (`https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=...`), com timeout de 20 s. Os símbolos das ações da B3 vão com o sufixo `.SA`: com `-BR` a CNBC não devolve ABEV3, TEND3 e IGTI3, e com `.SA` devolve os 97 tickers do universo, com o mesmo preço (conferido em 13/11/2026).
- **Adaptador:** só `scripts/precos/cnbc.mjs` conhece a CNBC. `scripts/precos/fonte.mjs` define o contrato, `cotar(tickers) → { [ticker]: { preco, dataHora } }`, em que `dataHora` é a do último negócio e ticker sem cotação fica ausente (nunca zero). Os múltiplos e o build só conhecem o contrato. Trocar de fonte é escrever outro módulo com `cotar` e `FONTE` e mudar a linha de exportação do `fonte.mjs`.
- **Coleta:** o workflow de atualização grava `cotacoes-fundamentos.json` na branch `dados`, uma vez por dia, na primeira execução depois das 19h de Brasília (e na primeira vez, a qualquer hora). São procurados os tickers do universo e, para cada raiz, os finais 3, 4, 5, 6 e 11: 371 símbolos em 10 chamadas, dos quais 102 existem.

  ```json
  { "coletadoEm": "2026-11-13T23:36:53.465Z", "fonte": "CNBC (atraso de até 15 min)",
    "precos": { "WEGE3": { "preco": 51.31, "dataHora": "2026-11-13T18:05:49.000-0300" } } }
  ```
- **Falhas:** se nenhuma cotação vier, o arquivo não é tocado e fica valendo o último gravado; o log avisa. Se vier só uma parte, quem não veio continua com o último preço conhecido e com a `dataHora` dele, e a regra de cotação desatualizada marca o que precisar.
- **Risco registrado:** a CNBC é um endpoint **não oficial**, sem contrato e sem garantia de continuar no ar. A fonte tem de ser revista, com um distribuidor licenciado ou com parecer jurídico, **antes de o site ter qualquer parte paga** (v3). Os dados ficam só para consulta e não são revendidos.
- **Por que não a B3:** o arquivo oficial de cotações históricas foi testado em 13/11/2026 e o download funciona, mas a página da B3 diz que os dados "destinam-se estritamente à consulta informativa" e veda a coleta automatizada, para qualquer finalidade. Nada desse arquivo entrou no repositório. A consequência é que a CNBC não tem série histórica: o gráfico de lucro × cotação da v3 vai precisar de outra fonte.

## Página Fundamentalista

A página responde a uma pergunta: **esta empresa é boa e sempre foi?** Por isso o centro da ficha é a série anual, de 2010 em diante. Os 12 meses e os múltiplos são a coluna de hoje dessa história.

- **`/fundamentos/`** lista as 64 companhias, agrupadas por setor, com um campo de busca por ticker ou nome.
- **`/fundamentos/<ticker>/`** (por exemplo, `/fundamentos/wege3/`) é a ficha de uma companhia. Cada uma tem a sua página e o seu link.

**As tabelas vêm prontas no HTML.** O build gera uma página por companhia, e ela funciona sem JavaScript. O JS é só uma camada extra: a busca da lista e o balão que mostra a fórmula, o documento e o motivo de um vazio (sem JS, isso tudo está no `title`). Os links internos são todos relativos, porque o site fica em `/panorama-economico/`.

### A ficha

1. **Cabeçalho:** nome, setor, a cotação de cada ticker com a data e a hora do último negócio, a fonte do preço e, quando for o caso, o carimbo de dado desatualizado.
2. **Quatro blocos**, nesta ordem: Resultado, Caixa e dívida, Fluxo de caixa e Valuation. A lista de qual indicador vai em qual bloco fica em `BLOCOS` (`scripts/fundamentos/pagina.mjs`).
3. **Rodapé:** o aviso legal, a fonte e a data da coleta.

Cada bloco é uma tabela com **uma linha por indicador e uma coluna por período**: primeiro os 12 meses, depois o exercício mais recente, e assim até o mais antigo. No celular, rolar para a direita é voltar no tempo. A primeira coluna (o nome do indicador) fica fixa, e quem rola é a tabela, não a página.

- **Sem valor:** a célula mostra "—", com o motivo no `title` e no balão. Nunca 0.
- **Demonstração zerada:** quando o documento traz o período inteiro em zero (ativo total igual a 0), a coluna fica toda vazia, com o motivo "demonstração zerada no documento". É o caso do Assaí em 2018.
- **Período de transição** (exercício com menos de 12 meses): o cabeçalho da coluna diz quantos meses tem.
- **Gráfico de tendência:** um SVG pequeno em cada linha, gerado no build, do exercício mais antigo ao mais recente. Ano sem valor fica como buraco na linha, e não como zero.
- **Documento de origem:** o rodapé de cada tabela diz de qual documento saiu cada coluna, com o link que a própria CVM informa no índice de documentos do ZIP (`LINK_DOC`). O link baixa o documento entregue.
- **Negativo:** leva o sinal de menos, e só o sinal ganha a cor de baixa. As faixas de cor ficam para a #39.

No **Valuation**, os múltiplos aparecem só na coluna de hoje: eles dependem do preço, e esta versão não tem preço histórico. Os valores por ação (lucro, valor patrimonial, FCO e FCL por ação) não dependem de preço e têm a série anual, com três ressalvas escritas na página:

- **Antes de 2020** a linha fica vazia, com o motivo "a CVM só informa o número de ações a partir de 2020".
- **Desdobramento ou grupamento:** quando o número de ações muda mais de 50% de um exercício para o outro, a tabela ganha uma borda tracejada entre os dois anos e uma nota dizendo que os valores por ação antes disso não são comparáveis. Os valores antigos **não são ajustados**.
- **Escala das ações:** as nove mudanças de escala (unidade ↔ mil) da série foram conferidas uma a uma; em todas a companhia mudou a forma de informar, e o lucro por ação calculado bate com o informado.

### O topo da ficha: ao longo dos anos, pontos de atenção e comparação com o setor

Antes dos quatro blocos, a ficha responde "a empresa é boa e sempre foi?" só com fatos e contas à vista. Não há adjetivo, nota, cor de favorável ou desfavorável, nem recomendação. Tudo é HTML estático, calculado no build.

**Regras gerais das contas**

- Só entram os exercícios anuais de 12 meses. Período de transição e período indisponível (o Assaí em 2018, com a demonstração zerada) ficam de fora, e a página diz quantos ficaram.
- Um valor vazio nunca conta como 0 nem como negativo: sai do denominador, e o texto diz "9 de 10 anos com dado".
- Série curta: se faltam anos para a métrica, ela fica vazia, com o motivo "série curta (N anos)". Nunca se calcula com menos pontos do que a regra pede.
- "Hoje" é a base de 12 meses. Quando ela não tem o dado (TIM), vale o último exercício, e a conta diz isso.

**Ao longo dos anos** (`scripts/fundamentos/consistencia.mjs`): uma grade de cartões, cada um com o número e a conta.

| Cartão | Conta |
|---|---|
| Anos com lucro | Anos com lucro líquido acima de zero, sobre os anos com dado |
| Anos com FCL positivo | O mesmo, com o fluxo de caixa livre |
| Maior sequência com lucro | Maior número de anos seguidos com lucro. Um ano sem dado quebra a sequência. Diz os anos e se ela vai até o último exercício |
| Crescimento ao ano (receita, lucro e FCO) | `(fim ÷ início)^(1/n) − 1`, em 5 e em 10 anos, do exercício n anos antes ao último. Com o início ou o fim zero, negativo ou sem dado, fica vazio com o motivo ("lucro de 2015 negativo"); não se tenta o ano vizinho |
| Margem líquida: da menor à maior | A maior menos a menor margem líquida da série, em pontos percentuais, com os dois anos |
| Pior ano da série | O menor lucro e quanto ele representa da média. Com a média zero ou negativa, só o pior ano |

**Pontos de atenção** (`scripts/fundamentos/atencao.mjs`): sete regras automáticas. A página mostra primeiro as acionadas, cada uma com a conta, os anos e o limite usado; depois, fechadas, as sete com o estado de cada uma ("não acionada" ou "não avaliada: motivo"). O destaque usa a cor de aviso, sempre com ícone e texto.

| Regra | Limite padrão | Detalhes |
|---|---|---|
| Lucro que não vira caixa | FCO ÷ lucro abaixo de 0,8 em 3 dos últimos 5 exercícios | Só avalia ano com lucro; o ano com prejuízo fica fora, e o texto diz. Precisa de 3 anos avaliáveis |
| Proventos maiores que o FCL | Proventos pagos maiores que o FCL, hoje | Como contexto, diz em quantos dos últimos 5 exercícios aconteceu |
| Dívida líquida ÷ EBITDA alta | Acima de 3, hoje | Sem arrendamentos; a conta mostra a versão com arrendamentos ao lado. EBITDA zero ou negativo com dívida líquida aciona a regra. Caixa líquido não aciona |
| Dívida concentrada no curto prazo | Mais de 50% da dívida bruta no curto prazo **e** dívida líquida positiva | Com o caixa maior que a dívida (WEG), não aciona. Sem dívida bruta, não é avaliada |
| Capex maior que o FCO | Nos últimos 3 exercícios seguidos | Um ano sem dado na janela deixa a regra sem avaliar |
| Diluição | Número de ações crescendo mais de 2% ao ano nos últimos 3 exercícios | Precisa de 2 exercícios com o número de ações (que só existe de 2020 em diante). Com desdobramento ou grupamento na janela, não é avaliada |
| Margem líquida em queda | 3 quedas seguidas (4 exercícios), até o último | Margem igual não é queda |

Os limites ficam em `LIMITES_ATENCAO`, e quatro deles podem ser trocados por variáveis do Actions (veja [Configuração](#configuração)), no mesmo padrão dos alertas do Diário. O limite exato não aciona: 0,8, 3,0, 50% e 2,0% ficam do lado de "não acionada".

**Comparação com o setor** (`scripts/fundamentos/pares.mjs`): a posição da companhia em relação à mediana das outras do mesmo setor, em oito indicadores: margem líquida, ROIC, ROE, dívida líquida ÷ EBITDA, FCO ÷ EBITDA, capex ÷ FCO, crescimento da receita em 5 anos e a parte da série com lucro.

- **Período:** o mesmo exercício anual para todas, que é o último que a maioria do setor já entregou. Quem não tem esse exercício sai da mediana. Os 12 meses ficam de fora, porque as datas dos ITR variam.
- **Mediana:** só com 3 ou mais empresas com dado naquele indicador. Abaixo disso, a linha diz "setor com menos de 3 empresas com dado". Em Serviços financeiros só há a B3, então não há mediana.
- **Posição:** "acima da mediana", "abaixo da mediana" ou "na mediana" (no empate), mais o quartil por extenso ("entre os 25% maiores do setor"). O texto e a cor são os mesmos nos dois lados: dívida acima da mediana não é elogio.
- **Amostra:** a página diz quantas empresas entraram em cada linha e quais são. Os setores juntam negócios diferentes, e quem lê precisa ver isso.

A ficha em JSON (`dist/fundamentos/dados/<TICKER>.json`) ganha os campos `consistencia`, `atencao` e `pares`. Os pares são calculados depois de montar as 64 fichas.

### Carimbo de desatualizado

A ficha ganha o carimbo, na cor que o site reserva para dado desatualizado, quando o documento mais recente da companhia é mais antigo do que o último que já deveria ter sido entregue. Os prazos são os da CVM: 45 dias depois do trimestre para o ITR e 90 dias depois do exercício para a DFP. Os trimestres seguem o exercício da própria companhia (quem fecha em março tem ITR em junho, setembro e dezembro). Exemplo: "Dados até o ITR de 30/06/2026. O ITR de 30/09/2026 já deveria ter sido entregue (prazo do ITR: 14/11/2026)." A regra fica em `scripts/fundamentos/carimbo.mjs`.

### CSV

Cada bloco tem um link "baixar CSV" (`/fundamentos/wege3/resultado.csv`, `caixa-e-divida.csv`, `fluxo-de-caixa.csv` e `valuation.csv`). O arquivo é feito para abrir certo no Excel brasileiro: separador `;`, vírgula decimal, UTF-8 com BOM e CRLF. Os valores vão sem abreviação (R$ mil inteiros e razões em fração), a coluna "Unidade" diz qual é, e o que não tem valor fica vazio.

### Como as fichas são geradas

O build (`scripts/build.mjs`) lê os fatos da branch `dados`, monta a ficha de cada companhia (`scripts/cvm/ficha.mjs`) e chama os módulos de `scripts/fundamentos/`, todos puros e testados:

| Módulo | O que faz |
|---|---|
| `formatar.mjs` | Números em pt-BR: "R$ 40,8 bi", "33,5%", "12,3x", "R$ 1,52" e "—" |
| `pagina.mjs` | O HTML da ficha e da lista. Todo texto que vem de dado passa por `escapar()` |
| `csv.mjs` | O CSV de cada bloco |
| `carimbo.mjs` | Decide se o dado está desatualizado |
| `consistencia.mjs` | As métricas do topo da ficha, sobre a série anual |
| `atencao.mjs` | As sete regras de pontos de atenção e os limites (`LIMITES_ATENCAO`) |
| `pares.mjs` | A mediana do setor e a posição de cada companhia |
| `resumo.mjs` | O HTML do topo da ficha |

Os arquivos fixos da página ficam em `site/fundamentos/`: `fundamentos.css`, `ficha.js` (o balão) e `lista.js` (a busca). As 64 fichas, os CSVs e os JSON somam cerca de 10 MB em `dist/fundamentos/`, e o build leva cerca de 10 s a mais com elas.

Aqui só há dados e regras à vista. Nada na página é recomendação de investimento.

## Coleta dos fundamentos

Os dados da CVM chegam ao site por este caminho:

```
CVM (ZIPs de DFP e ITR)
  → workflow semanal (.github/workflows/fundamentos.yml)
  → branch de dados: fundamentos/<código CVM>.json e fundamentos/indice.json   (fatos)
  → build do workflow de 15 minutos (scripts/build.mjs)
  → dist/fundamentos/dados/<TICKER>.json e indice.json                          (séries, indicadores e múltiplos)
```

**Na branch de dados ficam os fatos, não os indicadores.** O workflow semanal grava, para cada uma das 64 companhias da página, as linhas dos demonstrativos (com a maior versão de cada documento e com consolidado × individual já resolvidos) e a composição do capital. Quem calcula a série anual, a base de 12 meses, os indicadores e os múltiplos é o build, que roda a cada 15 minutos. Assim, uma fórmula nova ou um preço novo aparecem no site na execução seguinte, sem coletar a CVM de novo.

> **Ensaio.** A coleta agendada grava na branch `dados`, a mesma que o build lê. Para ensaiar sem mexer nela, rode o workflow à mão (`workflow_dispatch`) e informe outra branch no campo `branch`, por exemplo `dados-teste`. A primeira execução real foi feita assim, em 13/11/2026.

### O que é baixado

- **DFP** de 2010 até o ano corrente (a série anual inteira) e **ITR** só do ano corrente e do anterior, que é tudo o que a base de 12 meses usa. Em 2026 são 19 ZIPs, 229 MB.
- De cada ZIP entram os demonstrativos (DRE, BPA, BPP, DFC e DVA, consolidado e individual) e a composição do capital. O individual é necessário para quem não entrega consolidado e para o consolidado que vem zerado (TIM).
- **Leitura em fluxo.** Os ZIPs abrem em 2,9 GB (o ITR de 2025 sozinho, em 464 MB). Nada disso é carregado inteiro: `scripts/zip-fluxo.mjs` lê só o diretório central e descomprime cada arquivo aos pedaços, linha a linha, e a linha de uma companhia de fora da página é descartada pelo CNPJ antes de ser interpretada. O pico de memória medido no Actions foi de 441 MB na leitura de um ZIP e de 969 MB na etapa que junta os 19 extratos.

### As três etapas do workflow

1. **Listar.** Um `HEAD` em cada ZIP traz o `Last-Modified` e o tamanho.
2. **Extrair**, um ZIP por execução da matriz (quatro por vez). Baixa o ZIP, lê em fluxo e grava o **extrato**: só as companhias da página. O extrato fica em `actions/cache`, com uma chave por arquivo e por `Last-Modified`. ZIP que não mudou não é baixado de novo. As DFPs antigas quase nunca mudam; numa semana comum só os arquivos do ano são baixados. A chave também muda quando muda o código que gera o extrato ou a lista de companhias.
3. **Montar.** Junta os extratos, monta o arquivo de cada companhia, compara com o que já está gravado e faz o commit **só do que mudou**. A serialização é estável (chaves em ordem alfabética, listas em ordem fixa): o mesmo dado dá os mesmos bytes. Uma segunda execução seguida não baixa nada e não faz commit.

A agenda é domingo, 09:23 de Brasília. A CVM regrava os ZIPs aos domingos entre 07:14 e 07:59 de Brasília (visto no `Last-Modified`), e a coleta vem depois.

### Timeout

A regra do projeto é 20 s por requisição. Para o `HEAD`, vale assim. Para o download de um ZIP, a regra vira **20 s sem receber bytes**, com um teto de **3 minutos por arquivo**: um ZIP de 30 MB pode levar mais de 20 s inteiros sem estar travado.

### O que acontece em cada falha

| Falha | O que acontece |
|---|---|
| Um ZIP falha (timeout, 404, ZIP corrompido ou cabeçalho diferente do esperado) | As companhias que dependem dele mantêm o arquivo anterior, e o índice registra a falha e o motivo. Uma companhia depende de um ZIP se o arquivo anterior dela tirou dados dele ou se o ZIP é do ano corrente ou do anterior. Nada é zerado. |
| Uma companhia dá erro ao montar | Ela mantém o arquivo anterior, e as outras seguem. |
| Todos os ZIPs falham | Nada é gravado e não há commit. O workflow termina com sucesso e com avisos, para não gerar alerta falso. |
| O push é rejeitado (o workflow de 15 minutos gravou na mesma branch) | `git pull --rebase` e push de novo, até 3 vezes, com espera crescente. Os arquivos são outros, então não há conflito de conteúdo. Nunca há push forçado. |
| A pasta `fundamentos/` não existe (primeira execução) | O build segue sem as fichas e não falha. |
| Uma ficha dá erro no build | A companhia fica sem ficha, o índice do site diz o erro, e as outras saem. |

O Diário não é afetado por nenhuma delas: é outro workflow, e o build não falha por causa dos fundamentos.

### Os arquivos

Na branch de dados:

- `fundamentos/<código CVM>.json`: `{ cnpj, cdCvm, tickers, fatos, composicoes, documentos, origem, avisos }`. `documentos` traz, de cada documento, a versão, a data de entrega e o link que a CVM informa. Os `fatos` vêm em blocos, um por (documento, data, versão, base, demonstrativo, coluna), cada um com as contas `[conta, descrição, fixa, valor]`, em R$ mil. `origem` lista os ZIPs de onde saíram, com o `Last-Modified`. São 64 arquivos e 47 MB.
- `fundamentos/indice.json`: `{ coletadoEm, arquivos, companhias }`. De cada ZIP, o `Last-Modified`, o tamanho e o estado. De cada companhia, os tickers, o **documento mais recente** (`{ tipo, dtRefer, versao }`, para o carimbo de desatualizado), o estado (`ok`, `mantido` ou `falhou`), o motivo e os avisos.

No site (`dist/fundamentos/dados/`, gerado pelo build):

- `<TICKER>.json`: a ficha da companhia, com a série anual (um item por exercício, com todos os indicadores e o documento de origem), a base de 12 meses, as cotações, os múltiplos e os avisos. É o que alimenta a página de cada companhia. Vão só os indicadores calculados, não as contas dos demonstrativos: as 64 fichas somam 2,9 MB.
- `indice.json`: a lista das companhias, com o documento mais recente de cada uma, as datas da coleta e do preço, e o motivo de quem ficou sem ficha.

### Avisos

Vão para o log, para o resumo da execução e para o índice, sem derrubar nada:

- **Consolidado zerado.** Documento cujo consolidado tem o ativo total igual a zero perde o consolidado e fica com o individual (DFP de 2024 e de 2025 da TIM).
- **Número de ações que diverge.** Se o total de ações do documento mais recente diverge mais de 50% do documento anterior, as ações, os valores por ação e o valor de mercado dos 12 meses ficam vazios, com o motivo (ITR de 30/09/2026 da Vivara).
- **Escala das ações que muda.** Quando a escala inferida (unidade ou mil) de uma companhia muda de um exercício para outro.

### Rodar a coleta localmente

```bash
node scripts/coletar-fundamentos.mjs   # baixa, extrai e grava em dados/fundamentos/
npm run build                          # gera dist/fundamentos/dados/
```

A primeira execução baixa os 229 MB e leva cerca de 5 minutos; as seguintes usam os extratos em `.cvm/cache/`. As pastas `dados/` e `.cvm/` ficam fora do git.

A lógica fica em `scripts/cvm/coleta.mjs` (o que baixar, o extrato, o arquivo da companhia, `serializar` e `decidirSaida`) e em `scripts/cvm/ficha.mjs` (`montarFicha`, `montarFichas`), puras e testadas. A rede e o disco ficam em `scripts/coletar-fundamentos.mjs`, `scripts/zip-fluxo.mjs`, `scripts/publicar-dados.mjs` e `scripts/build.mjs`.

## Atualização confiável (cron-job.org)

O agendamento do próprio GitHub (`schedule`) atrasa e às vezes descarta execuções. Por isso o gatilho principal é **externo**: o site gratuito [cron-job.org](https://cron-job.org) chama a API do GitHub a cada 15 minutos e manda rodar o workflow (`workflow_dispatch`).

O `schedule` continua no workflow como **reserva**, nos minutos :07, :22, :37 e :52. Antes de atualizar, cada execução agendada passa por uma **guarda** (`scripts/guarda.mjs`): se o cron-job.org disparou o workflow nos últimos 15 minutos e essa execução não falhou, a agendada pula. Se o cron-job.org parar, a reserva assume sozinha. Na dúvida (a API do GitHub não responde), a guarda não pula.

**O token fica só no cron-job.org.** Ele nunca vai para nenhum arquivo deste repositório nem para os Secrets. Ele só permite disparar e cancelar execuções do Actions **deste** repositório, e expira sozinho.

### 1. Criar o token no GitHub

1. No GitHub, clique na sua foto (canto superior direito) → **Settings**.
2. No menu da esquerda, lá embaixo: **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
3. Preencha:
   - **Token name:** `panorama-cron-job`
   - **Expiration:** 90 dias (ou uma data em *Custom*). Anote quando vence.
   - **Resource owner:** a sua conta.
   - **Repository access:** *Only select repositories* → `panorama-economico`.
   - **Permissions** → **Repository permissions** → **Actions:** *Read and write*. Não mexa em mais nada. O *Metadata: Read-only* entra sozinho.
4. **Generate token** e copie o token (começa com `github_pat_`). Ele só aparece uma vez. Não cole em nenhum outro lugar além do passo 2.

### 2. Criar o job no cron-job.org

1. Entre (ou crie sua conta) em https://cron-job.org → **Cronjobs** → **Create cronjob**.
2. Aba **Common**:
   - **Title:** `Panorama econômico`
   - **URL:** `https://api.github.com/repos/rodrigoab1980/panorama-economico/actions/workflows/atualizar.yml/dispatches`
   - **Execution schedule:** *Custom*. Dias da semana: segunda a sexta. Horas: 6 a 20. Minutos: 0, 15, 30 e 45.
   - **Time zone:** `America/Sao_Paulo`.
   - Ligue **Notify me when… execution fails**, para saber se o token venceu.
3. Aba **Advanced**:
   - **Request method:** `POST`
   - **Headers** (um por linha, em *Add header*):

     | Key | Value |
     |---|---|
     | `Accept` | `application/vnd.github+json` |
     | `Authorization` | `Bearer ` + o token do passo 1 (com o espaço depois de Bearer) |
     | `X-GitHub-Api-Version` | `2022-11-28` |
     | `Content-Type` | `application/json` |

   - **Request body:** `{"ref":"main"}`
4. **Test run**: a resposta deve ser **204** (ou 200). Em **Actions → Atualizar panorama** aparece uma execução nova, marcada como *workflow_dispatch*.
5. **Create**.

Respostas de erro mais comuns: **401** = token errado ou vencido; **403** = falta a permissão *Actions: Read and write* ou o repositório não foi selecionado; **404** = URL digitada errada; **422** = corpo diferente de `{"ref":"main"}`.

### 3. Renovar antes de vencer

O GitHub manda um e-mail alguns dias antes do vencimento. Em **Developer settings → Fine-grained tokens**, abra `panorama-cron-job` → **Regenerate token**, copie o novo token e troque o valor do header `Authorization` no job do cron-job.org. Se o token vencer, o site continua atualizando pela reserva do GitHub, só que com menos regularidade.

Se o token vazar, apague-o na mesma tela (**Delete**) e gere outro.

## Configuração

| Onde | Nome | Para quê |
|---|---|---|
| Settings → Secrets → Actions | `ANTHROPIC_API_KEY` | Liga o resumo escrito pela IA. Sem ela, o resto do site funciona normalmente. |
| Settings → Variables → Actions | `SUMMARY_INTERVAL_MIN` | Intervalo entre resumos, em minutos. O padrão é 60. |
| Settings → Variables → Actions | `ALERTA_DESVIOS` | Quantas vezes a oscilação típica do ativo um movimento precisa ter para alertar. O padrão é 2.5. Maior = menos alertas. |
| Settings → Variables → Actions | `ALERTA_PCT` | Limite fixo, em %, usado enquanto o histórico tem menos de 20 dias. O padrão é 3. |
| Settings → Variables → Actions | `ALERTA_BPS` | O mesmo para juros, em pontos-base. O padrão é 15. |
| Settings → Variables → Actions | `ATENCAO_FCO_SOBRE_LUCRO` | Ponto de atenção "lucro que não vira caixa": FCO ÷ lucro abaixo deste valor conta no ano. O padrão é 0.8. |
| Settings → Variables → Actions | `ATENCAO_DIVIDA_EBITDA` | Ponto de atenção "dívida líquida ÷ EBITDA alta": aciona acima deste valor. O padrão é 3. |
| Settings → Variables → Actions | `ATENCAO_DIVIDA_CURTO_PRAZO` | Ponto de atenção "dívida concentrada no curto prazo": parcela da dívida bruta, em fração. O padrão é 0.5. |
| Settings → Variables → Actions | `ATENCAO_DILUICAO_ANUAL` | Ponto de atenção "diluição": crescimento do número de ações ao ano, em fração. O padrão é 0.02. |

Valores vazios, zero, negativos ou que não sejam número voltam para o padrão. Use ponto como separador decimal (`2.5`).

Para gerar um resumo novo na hora: **Actions → Atualizar panorama → Run workflow** e marque "Gerar um novo resumo da IA agora".

## Rodar localmente

Requer Node.js 24 ou mais novo.

```bash
npm install
npm run update   # coleta e grava site/data/
npm run build    # monta dist/
npm run serve    # serve dist/
```

Depois abra http://localhost:8080. Mudou algo em `site/`? Rode `npm run build` de novo antes de recarregar.

## Testes

```bash
npm test
```

Os testes usam o executor nativo do Node (`node:test`), sem dependências extras, e ficam em `test/`. Eles cobrem a regra de dado desatualizado (`site/atraso.js`) e a lógica pura de `scripts/logica.mjs`: leitura dos feeds, filtro e deduplicação das notícias, cotações, mapa de ações, agenda, histórico diário com variação semanal e mensal, alertas de movimento fora do padrão e a regra que decide quando gerar um novo resumo. O `scripts/update.mjs` só cuida da coleta (rede), da gravação dos JSON e da chamada ao Claude.

O workflow [CI](.github/workflows/ci.yml) roda os testes em todo pull request e em cada push na `main`, no Node 24 e no 26. Ele não publica nada nem usa segredos.

Os símbolos de cada aba ficam no início de `site/app.js` (`ABAS`). As fontes de notícias e os símbolos do placar ficam no início de `scripts/update.mjs`; a consulta à CNBC fica em `scripts/precos/cnbc.mjs`.

## Como contribuir

O roteiro de evolução virou issues, e cada mudança segue o mesmo caminho:

1. Uma issue por vez, numa branch própria (`feat/`, `fix/`, `test/`, `docs/`, `chore/`).
2. Commits pequenos no formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/) (`feat: ...`, `fix: ...`).
3. Pull request com o que mudou, por quê e os testes. O CI precisa passar no Node 24 e no 26.
4. README e CHANGELOG atualizados na mesma PR.
5. Nunca commitar chaves ou tokens: segredos ficam nos Secrets do GitHub ou no `.env` local, que está no `.gitignore`.

## Licença

[MIT](LICENSE). Histórico de mudanças em [CHANGELOG.md](CHANGELOG.md).
