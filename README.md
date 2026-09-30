# Panorama Econômico

Painel matinal de mercado, publicado no GitHub Pages e atualizado sozinho nos dias úteis.

- **Resumo do dia** escrito pelo Claude: tom do mercado, Ásia, Europa, EUA, Brasil e emergentes, commodities e juros, pontos-chave e as notícias que podem mexer com os preços. É refeito a cada hora, das 6h às 20h.
- **Como estão os mercados**: placar com bolsas, câmbio, commodities e juros de 10 anos (CNBC).
- **Ativos em abas** (widgets TradingView, atraso de até 15 min): Futuros EUA, Europa, Ásia/Pacífico, Dólar DXY, Emergentes, Títulos Brasil (curva DI), Títulos EUA, Metais, Agrícolas, B3, Energia e Futuros.
- **Mapa de ações** do S&P 500 e do Ibovespa.
- **Notícias ao vivo**: InfoMoney, Valor, Money Times, Investing, CNBC, MarketWatch, Yahoo Finance e Google News. Atualizadas a cada 15 minutos.
- **Agenda**: destaques do dia e calendário do Investing.com, mais os eventos de 3 estrelas da semana.

## Como funciona

```
GitHub Actions (a cada 15 min, seg–sex, 6h–20h45)
  └─ scripts/update.mjs → site/data/*.json  (notícias, cotações, agenda, resumo)
  └─ publica a pasta site/ no GitHub Pages
Navegador
  └─ site/index.html lê os JSON a cada 5 min; os widgets da TradingView atualizam ao vivo
```

## Configuração

| Onde | Nome | Para quê |
|---|---|---|
| Settings → Secrets → Actions | `ANTHROPIC_API_KEY` | Liga o resumo escrito pela IA. Sem ela, o resto do site funciona normalmente. |
| Settings → Variables → Actions | `SUMMARY_INTERVAL_MIN` | Intervalo entre resumos, em minutos. O padrão é 60. |

Para gerar um resumo novo na hora: **Actions → Atualizar panorama → Run workflow** e marque "Gerar um novo resumo da IA agora".

## Rodar localmente

```bash
npm install
npm run update
npm run serve
```

Depois abra http://localhost:8080.

Os símbolos de cada aba ficam no início de `site/app.js` (`ABAS`). As fontes de notícias e as cotações da CNBC ficam no início de `scripts/update.mjs`.
