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
GitHub Actions (a cada 15 min, seg–sex, 6h07–20h52)
  └─ baixa a branch `dados` (histórico) na pasta dados/
  └─ scripts/update.mjs → site/data/*.json  (notícias, cotações, agenda, resumo)
  └─ a partir das 19h: grava o fechamento do dia e o resumo na branch `dados`
  └─ publica a pasta site/ no GitHub Pages
Navegador
  └─ site/index.html lê os JSON a cada 5 min; os widgets da TradingView atualizam ao vivo
```

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
npm run update
npm run serve
```

Depois abra http://localhost:8080.

## Testes

```bash
npm test
```

Os testes usam o executor nativo do Node (`node:test`), sem dependências extras, e ficam em `test/`. Eles cobrem a regra de dado desatualizado (`site/atraso.js`) e a lógica pura de `scripts/logica.mjs`: leitura dos feeds, filtro e deduplicação das notícias, cotações, mapa de ações, agenda, histórico diário com variação semanal e mensal, alertas de movimento fora do padrão e a regra que decide quando gerar um novo resumo. O `scripts/update.mjs` só cuida da coleta (rede), da gravação dos JSON e da chamada ao Claude.

O workflow [CI](.github/workflows/ci.yml) roda os testes em todo pull request e em cada push na `main`, no Node 24 e no 26. Ele não publica nada nem usa segredos.

Os símbolos de cada aba ficam no início de `site/app.js` (`ABAS`). As fontes de notícias e as cotações da CNBC ficam no início de `scripts/update.mjs`.

## Licença

[MIT](LICENSE). Histórico de mudanças em [CHANGELOG.md](CHANGELOG.md).
