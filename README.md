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
| `scripts/build.mjs` | Monta `dist/` a partir de `site/` e insere o menu em cada página. Só lê e grava; a lógica fica em `scripts/paginas.mjs`. |
| `scripts/paginas.mjs` | Lista de páginas do menu e funções puras do build: `menuHtml`, `inserirMenu`, `removerMenu` e `linksInternos` (usada no teste de links). |
| `scripts/cvm/` | Dados da CVM. `fixtures.mjs` (lógica pura, testada) e `gerar-fixtures.mjs` recriam as fixtures a partir de CSVs extraídos; `spike/` guarda os scripts de medição do spike (#29), descritos em `docs/cvm.md`. |
| `site/` | A fonte do site: o Diário (`index.html`, `app.js`, `atraso.js` e `style.css`), a página `fundamentos/` e o `menu.css`. Os JSON vão para `site/data/`, gerados a cada execução e fora do git. |
| `dist/` | O site pronto para publicar, gerado por `npm run build`. Fora do git. |
| `test/` | Testes `node:test`, um arquivo por assunto. `test/fixtures/cvm/` guarda recortes reais dos arquivos da CVM, byte a byte. |
| `docs/cvm.md` | O que foi medido nos dados abertos da CVM (formato, contas, volume e riscos), base da página Fundamentalista da v2.0. |
| `.github/workflows/atualizar.yml` | Coleta, histórico, build e deploy de `dist/` no GitHub Pages. |
| `.github/workflows/ci.yml` | Roda os testes e o build em todo PR e na `main`. Não publica nada. |
| branch `dados` | Histórico diário e resumos arquivados. Só o robô escreve nela. |

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

Os símbolos de cada aba ficam no início de `site/app.js` (`ABAS`). As fontes de notícias e as cotações da CNBC ficam no início de `scripts/update.mjs`.

## Como contribuir

O roteiro de evolução virou issues, e cada mudança segue o mesmo caminho:

1. Uma issue por vez, numa branch própria (`feat/`, `fix/`, `test/`, `docs/`, `chore/`).
2. Commits pequenos no formato [Conventional Commits](https://www.conventionalcommits.org/pt-br/) (`feat: ...`, `fix: ...`).
3. Pull request com o que mudou, por quê e os testes. O CI precisa passar no Node 24 e no 26.
4. README e CHANGELOG atualizados na mesma PR.
5. Nunca commitar chaves ou tokens: segredos ficam nos Secrets do GitHub ou no `.env` local, que está no `.gitignore`.

## Licença

[MIT](LICENSE). Histórico de mudanças em [CHANGELOG.md](CHANGELOG.md).
