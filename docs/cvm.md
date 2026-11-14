# CVM Dados Abertos: o que foi medido (spike #29)

Medições feitas em 12/11/2026 sobre os arquivos do portal de dados abertos da CVM, para orientar as issues da v2.0 (página Fundamentalista). Tudo abaixo vem dos arquivos de verdade, não do planejamento.

**Amostra usada:** 95 tickers do Ibovespa sem bancos e seguradoras, que viraram 81 CNPJs com dados (vários tickers por empresa, como PETR3/PETR4, e nomes antigos e novos, como ELET3/AXIA3). A lista oficial do universo é da #32; esta serve só para medir.

## Onde estão os arquivos

| Documento | URL (um ZIP por ano) | Anos | Tamanho total |
|---|---|---|---|
| DFP (anual) | `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_AAAA.zip` | 2010–2026 | 168 MB (8–13 MB por ano) |
| ITR (trimestral) | `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_AAAA.zip` | 2011–2026 | 409 MB (21–31 MB por ano) |
| FCA (cadastro) | `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_AAAA.zip` | 2010–2026 | 6,4 MB |

- O índice HTML de cada pasta mostra a data de modificação de cada ZIP. Os anos até 2021 não mudam desde 2024/2025; de 2022 em diante, todos foram regravados em 08/11/2026. Na prática, só os anos recentes mudam.
- Descompactados, os arquivos são grandes: só o ZIP da DFP 2024 abre em 298 MB, e o do ITR 2024 em 875 MB. Somando 16 anos, passa de 12 GB. **É preciso ler em fluxo, sem extrair para o disco.**

### O que vem dentro (DFP e ITR, os mesmos nomes)

`{doc}_cia_aberta_AAAA.csv` (índice dos documentos), mais um CSV por demonstrativo, sempre em duas versões: `_con` (consolidado) e `_ind` (individual):

`BPA` (ativo), `BPP` (passivo e PL), `DRE`, `DRA` (resultado abrangente), `DFC_MI` (fluxo de caixa, método indireto), `DFC_MD` (método direto), `DMPL`, `DVA`, além de `composicao_capital` (número de ações; vem na DFP **e no ITR**) e `parecer`.

FCA: `geral`, `valor_mobiliario` (com o código de negociação), `endereco`, `dri`, `auditor`, `escriturador`, `canal_divulgacao`, `departamento_acionistas` e `pais_estrangeiro_negociacao`.

## Formato

- **Encoding latin1** (ISO-8859-1), separador `;`, quebra de linha CRLF, cabeçalho na primeira linha, sem aspas.
- Números com ponto decimal e 10 casas (`273505274.0000000000`).
- Colunas dos demonstrativos: `CNPJ_CIA; DT_REFER; VERSAO; DENOM_CIA; CD_CVM; GRUPO_DFP; MOEDA; ESCALA_MOEDA; ORDEM_EXERC; DT_INI_EXERC; DT_FIM_EXERC; CD_CONTA; DS_CONTA; VL_CONTA; ST_CONTA_FIXA`.
  - **BPA e BPP não têm `DT_INI_EXERC`.** O leitor precisa mapear pelo cabeçalho, nunca pela posição da coluna.
  - `ORDEM_EXERC` só tem `ÚLTIMO` (período do documento) e `PENÚLTIMO` (mesmo período do ano anterior, como foi reapresentado).
  - `ESCALA_MOEDA`: `MIL` na grande maioria, mas há `UNIDADE`: 21.620 linhas de 3 empresas da amostra. **É preciso normalizar.**
  - `ST_CONTA_FIXA = S` marca as contas do plano padrão da CVM; `N` marca as contas abertas pela própria empresa.
  - **Lucro por ação (DRE 3.99 e filhas) está em R$ por ação**, com casas decimais de verdade (ex.: `0.1300000000`), mesmo quando `ESCALA_MOEDA` é `MIL`. É a única família de contas fora da escala do documento (medido na #31: 30 mil das 2,94 milhões de linhas da amostra). Fora dela, valor com fração em `MIL` é raríssimo (59 linhas), e em `UNIDADE` mais da metade dos valores não é múltiplo de 1.000. O leitor (`scripts/cvm/leitor.mjs`) arredonda ao inteiro em R$ mil e deixa a 3.99 como vem.
- FCA usa outro estilo de nome de coluna: `CNPJ_Companhia; Data_Referencia; Versao; ... Codigo_Negociacao; ... Mercado; ...`.

## Contas confirmadas

Em 2024, entre cerca de 450 empresas com plano "comercial e industrial":

| Uso | Conta | Descrição | Fixa? |
|---|---|---|---|
| Receita | DRE 3.01 | Receita de Venda de Bens e/ou Serviços | S |
| Lucro bruto | DRE 3.03 | Resultado Bruto | S |
| EBIT | DRE 3.05 | Resultado Antes do Resultado Financeiro e dos Tributos | S |
| Resultado financeiro | DRE 3.06 | Resultado Financeiro | S |
| Lucro líquido | DRE 3.11 | Lucro/Prejuízo Consolidado do Período | S |
| Ativo total | BPA 1 | Ativo Total | S |
| Caixa | BPA 1.01.01 / 1.01.02 | Caixa e Equivalentes / Aplicações Financeiras | S |
| Dívida bruta | BPP 2.01.04 / 2.02.01 | Empréstimos e Financiamentos (CP / LP) | S |
| PL | BPP 2.03 | Patrimônio Líquido Consolidado | S |
| Minoritários | BPP 2.03.09 | Participação dos Acionistas Não Controladores | S |
| FCO / FCI / FCF | DFC 6.01 / 6.02 / 6.03 | Caixa Líquido das Atividades… | S |
| D&A | DVA 7.04.01 | Depreciação, Amortização e Exaustão | S |

- O plano é outro para **bancos** (10 empresas: 3.01 = "Receitas de Intermediação Financeira", 2.03 = "Provisões") e para **seguradoras** (17 empresas: 3.06 = IR/CS e a D&A em 7.05.01). Para eles a mesma conta tem outro significado. Isso ajuda: a descrição da 3.01 serve para detectar e excluir financeiras automaticamente.
- A descrição das contas fixas varia pouco ("Caixa Líquido Atividades Operacionais" × "Caixa Líquido **das** Atividades Operacionais"). O código é o que vale.
- **Contas usadas pelos indicadores (#34)**, além das da DRE, do ativo total e do PL: a D&A sai da DVA **7.04.01**, que vem negativa (o indicador troca o sinal, sem valor absoluto); a dívida bruta é BPP **2.01.04** + **2.02.01**, sem arrendamentos; o caixa é BPA **1.01.01** + **1.01.02**. As cinco são contas fixas. As fórmulas estão no README, seção "Indicadores fundamentalistas".
- **Contas de caixa e dívida (#35):** despesas financeiras em DRE **3.06.02** (vem negativa), ativo circulante em BPA **1.01** e passivo circulante em BPP **2.01**, todas fixas. Três companhias da página (Motiva, Sabesp e Usiminas) deixam 3.06.01 e 3.06.02 zeradas e informam só o líquido em 3.06: para elas a despesa financeira é "não informada", não zero.

### Onde os arrendamentos (IFRS 16) aparecem no passivo

O plano tem uma conta fixa para isso, "Financiamento por Arrendamento" (**2.01.04.03** no curto prazo e **2.02.01.03** no longo), dentro de Empréstimos e Financiamentos. Na DFP de 2025, 17 das 64 companhias da página a usam (Petrobras, Vale e Vivo, por exemplo; nas fixtures, a São Martinho). Para essas, a 2.01.04 e a 2.02.01 **incluem** o arrendamento, e a dívida bruta tem de subtrair as duas subcontas.

As outras criam uma linha própria em "Outras Obrigações" (**2.01.05** e **2.02.02**), **sem código fixo**. O código muda de companhia para companhia, e só a descrição diz o que é:

| Companhia (31/12/2025) | Conta | Descrição | R$ mil |
|---|---|---|---:|
| Raia Drogasil | 2.01.05.02.06 | Arrendamentos a pagar | 1.021.147 |
| Raia Drogasil | 2.02.02.02.05 | Arrendamentos a pagar | 3.945.165 |
| WEG | 2.01.05.02.07 | Arrendamentos | 221.934 |
| WEG | 2.02.02.02.05 | Arrendamentos | 625.219 |

- A regra dos indicadores: as duas contas fixas mais as subcontas de 2.01.05 e 2.02.02 cuja descrição bate com `/arrendament/i`. Se uma conta e um ancestral dela batem, conta só o ancestral.
- Na Raia, "Aluguéis" (2.01.05.02.04, 132.470) é aluguel a pagar e fica de fora: a descrição não bate.
- As descrições variam ("Passivo de arrendamento", "Arrendamento mercantil", "Obrigações com arrendamento", "Arrendamentos de direito de uso a pagar"), mas todas as que apareceram nas 64 companhias contêm "arrendament".
- 12 das 64 não têm nenhuma linha com esse nome e têm as duas contas fixas zeradas: Ambev, B3, CSN Mineração, CPFL, Cury, Cyrela, Engie, Hypera, Iguatemi, MRV, Multiplan e Sabesp. Para elas o indicador é `null` com o motivo "nenhuma linha de arrendamento identificada no passivo", e não zero: o passivo pode estar dentro de outra linha. As contas fixas vêm zeradas em quase todas as companhias, então o zero delas não informa nada.
- A C&A usa a descrição "Financiamento por Arrendamento" numa subconta não fixa de outras obrigações. A regra pega pelo "arrendament".
- A Rumo tem "Arrendamentos e concessões em litígio e parcelados" (além de "Passivos de arrendamento"), que a regra também soma. É discutível se isso é passivo de arrendamento; a lista de exceções existe para casos assim e hoje está vazia.
- A base de 12 meses usa o balanço do ITR mais recente. Para a regra funcionar ali, os `estoques` do `base12Meses` ganharam o campo `naoFixas`, com as subcontas sem código fixo.

### Dívida fora das contas padrão (Allos)

A Allos deixa a 2.01.04 e a 2.02.01 zeradas e registra a dívida em outras obrigações: "Empréstimos, financiamentos e debêntures" em 2.01.05.02.05 (325.357) e em 2.02.02.02.07 (5.553.953), R$ mil em 31/12/2025, 5.879.310 no total.

A dívida bruta soma essas linhas pela descrição. Entram as subcontas não fixas de 2.01.05 (curto prazo) e de 2.02.02 (longo prazo) cuja descrição bate com `/empr[ée]stimo/i` **e** com `/financiament|deb[êe]nture/i`, menos as que batem com `/compuls/i`. Se uma conta e um ancestral dela batem, conta só o ancestral. A regra fica na constante `DIVIDA_POR_DESCRICAO`.

Por que as duas expressões: uma só pegaria o que não é dívida financeira. Na DFP de 2025, as linhas desses dois grupos com alguma das palavras são:

| Companhia | Conta | Descrição | R$ mil | Entra? |
|---|---|---|---:|---|
| Allos | 2.01.05.02.05 | Empréstimos, financiamentos e debêntures | 325.357 | sim |
| Allos | 2.02.02.02.07 | Empréstimos, financiamentos e debêntures | 5.553.953 | sim |
| Axia | 2.01.05.02.05 | Empréstimo compulsório | 1.406.460 | não: passivo com consumidores |
| Axia | 2.01.05.02.06 | Empréstimo compulsório - Acordos | 1.073.452 | não: idem |
| C&A | 2.01.05.02.06 e 2.02.02.02.06 | Financiamento por Arrendamento | 372.743 e 1.407.500 | não: é arrendamento |
| Eneva | 2.01.05.02.15 | Ajuste a valor justo das debêntures a apropriar | 24.961 | não: é ajuste |

Nas 64 companhias, só a Allos ganha dívida por essa regra.

Como rede de segurança, se a dívida bruta ainda dá zero e a despesa financeira passa de 0,5% do ativo total, a dívida e o que depende dela ficam `null` com o motivo "a dívida pode estar fora das contas padrão". Com a regra da descrição, nenhuma das 64 dispara esse alerta hoje.

## DFC: capex, juros, dividendos e arrendamentos

**As subcontas da DFC não têm código fixo** (`ST_CONTA_FIXA = N`). A mesma linha aparece em códigos diferentes em cada empresa, então é preciso classificar pela descrição. Na DFP 2025, entre 76 empresas da amostra:

| Linha | Empresas com a linha | Descrições distintas | Códigos distintos | Onde fica |
|---|---|---|---|---|
| Capex (imobilizado/intangível) | 76 (com a regex ampliada) | 60 | 11 | 6.02 |
| Juros pagos | 70 | 82 | 33 | **6.01 (63×) ou 6.03 (51×)** |
| Dividendos/JCP pagos | 73 | 54 | 16 | 6.03 |
| Arrendamentos pagos | 62 | 65 | 17 | 6.03 |

Exemplos reais (2024):

| Empresa | Capex | Juros pagos | Proventos pagos |
|---|---|---|---|
| Petrobras | 6.02.01 Aquisições de ativos imobilizados e intangíveis | 6.03.04 Amortizações de juros - financiamentos | 6.03.05 Dividendos pagos a acionistas da Petrobras (+ 6.03.06 não controladores) |
| Vale | 6.02.05 Adições ao Imobilizado | 6.01.03.03 Juros de empréstimos e financiamentos pagos | 6.03.04 Dividendos/JCP Pagos a Acionistas |
| WEG | 6.02.02 Imobilizado + 6.02.03 Intangível | 6.01.02.10 Juros pagos sobre empréstimos… | 6.03.04 Pgto de Dividendos/Juros s/ Capital Próprio |
| Ambev | 6.02.02 Aquisição de Imobilizado e Intangíveis | 6.01.02.04 Juros Pagos | 6.03.10 Dividendos e juros sobre o capital próprio pagos |
| Suzano | 6.02.01 Adições no Imobilizado + 6.02.02 Adições de intangível | 6.01.03.01 Pagamento de juros sobre empréstimos… | 6.03.05 Pagamento de juros sobre o capital próprio e dividendos |
| Localiza | 6.02.01 Aquisições de outros imobilizados + 6.02.02 intangíveis | 6.01.03.02 Juros de empréstimos… pagos | 6.03.05 Dividendos + 6.03.06 Juros sobre o capital próprio |
| Raia Drogasil | 6.02.03 Aquisições de Imobilizado e Intangível | 6.01.03.01 Juros Pagos | 6.03.04 Juros sobre Capital Próprio e Dividendos Pagos |
| Gerdau | 6.02.01 Adições de imobilizado + 6.02.03 intangíveis | 6.01.03.01 Pagamento de juros de empréstimos… | 6.03.02 Dividendos e juros sobre o capital próprio pagos |
| Embraer | 6.02.01 Aquisições de imobilizado + 6.02.03 Adições ao intangível | 6.01.02.15 Juros pagos | 6.03.04 Dividendos e juros sobre capital próprio |
| Sabesp | 6.02.01 Aquisição de Ativos de Contrato e Intangíveis + 6.02.02 Imobilizado | 6.01.03.01 Juros Pagos | 6.03.03 Pagamento de Juros sobre o Capital Próprio |
| Magazine Luiza | 6.02.01 Aquisicao de Imobilizado + 6.02.02 Intangivel | 6.03.03 Pagamento de Juros sobre Empréstimos… | 6.03.04 Pagamento de Dividendos |
| Vivo | 6.02.01 Aquisições de Imobilizado e Intangível | 6.01.02.11 Juros Pagos de Empréstimos… e Arrendamentos | 6.03.04 Pagamentos de Dividendos e JCP |

Para detectar capex numa linha de 6.02 com valor negativo:

- Regex ingênua (`aquisição|adições … imobilizado|intangível`): achou capex em 64 de 76 empresas (84%).
- Regex ampliada, que também cobre singular, "aplicações em", "aumento de", "investimentos em", "no/em imobilizado", "acréscimo", ativo de contrato e "ativo não circulante", excluindo venda/baixa/recebimento: 95% a 100% conforme o ano (2011: 55/58; 2017: 65/66; 2019–2025: 100%). Sobram casos pontuais: Taesa e Dexco em 2011–2013, Petrobras em 2011 e Bradespar em 2017.
- Pontos que pedem uma decisão de regra na #36:
  - **Ativo biológico** (Klabin: "Adição de plantio e compras de madeira em pé"; Dexco, BRF/Marfrig: "Aplicações em ativo biológico"). Entra no capex ou não?
  - **Ativo de contrato** de concessões (Sabesp: "Aquisição de Ativos de Contrato e Intangíveis"; Cemig: "Em ativos de contrato - infraestrutura de distribuição e gás"): na prática é o capex dessas empresas.
  - Linhas que **misturam** capex com aquisições ("Adições ao imobilizado, intangível e investimentos").
  - A Vivo junta principal de dívida e de arrendamento numa linha só ("Pagamentos de Principal de Empréstimos…, Arrendamentos e Outros Credores").

### IFRS 16 muda muito o fluxo de caixa livre

Desde 2019, aluguéis viram "arrendamento": o pagamento sai do FCO e vai para o financiamento (principal) e, às vezes, para juros. Raia Drogasil, 2025 (R$ mil):

| | Valor |
|---|---|
| FCO (6.01) | 2.430.654 |
| Capex (6.02.03) | −1.402.977 |
| **FCL "simples" (FCO − capex)** | **1.027.677** |
| Pagamentos de arrendamento, principal (6.03.05) | −921.184 |
| Juros de arrendamento pagos (6.01.03.03, já dentro do FCO) | −478.616 |
| **FCL descontando o principal dos arrendamentos** | **106.493** |

Sem o ajuste, o FCL fica quase 10 vezes maior. No balanço, o passivo de arrendamento aparece na conta fixa 2.01.04.03 / 2.02.01.03 ("Financiamento por Arrendamento") **ou** em contas próprias da empresa (2.01.05 / 2.02.02, com "Passivo de arrendamento", "Arrendamentos" etc.).

### Classificador da DFC (#36)

`scripts/cvm/classificador-dfc.mjs` acha as linhas pela descrição, depois de tirar os acentos, passar para minúsculas e juntar os espaços. Só linhas sem código fixo são classificadas. A regra de cada categoria fica na constante `CATEGORIAS`:

| Categoria | Onde | Regra (sobre a descrição normalizada) |
|---|---|---|
| `capex` | 6.02 | imobilizado, intangível, software, ativo de contrato ou contratual, ativo biológico, plantio, madeira em pé; e aquisição, adição ou construção de propriedade para investimento. De fora: venda, alienação, baixa, recebimento; aquisição de empresa, controlada ou participação, combinação de negócios; aplicações financeiras e títulos; direito de uso |
| `jurosPagos` | 6.01.02, 6.01.03 e 6.03 | "juros" (ou "encargos financeiros", "encargos de dívida") + pago, pagamento, amortização ou liquidação. De fora: capital próprio, JCP, recebido, provisionado, apropriado, "principal", derivativos |
| `jurosArrendamento` | 6.01.02, 6.01.03 e 6.03 | "juros" (ou "encargos") + arrendamento ou leasing, sem "principal" |
| `principalArrendamento` | 6.03 | arrendamento ou leasing, menos as linhas que são só de juros. "Principal e juros" numa linha entra aqui inteira |
| `proventos` | 6.03 | dividendo, juros sobre (o) capital próprio, JCP ou JSCP, "pagamento de proventos", "remuneração aos acionistas", sem não controladores, minoritários, SCPs e SPEs e sem "recebi" |
| `proventosNaoControladores` | 6.03 | a mesma regra, com não controladores, minoritários, SCPs ou SPEs |
| `daDfc` | 6.01.01 | depreciação, amortização ou exaustão, sem custo de transação ou de captação, debênture, ágio, juros, empréstimo e despesa antecipada |

- **O bloco 6.01.01 (ajustes do lucro) nunca tem pagamento.** "Juros provisionados" e "Despesas de juros - arrendamento" ficam ali e não são saída de caixa. Por isso os juros pagos só são procurados em 6.01.02, 6.01.03 e 6.03.
- **Prioridade** (`ORDEM`): juros de arrendamento, principal de arrendamento, proventos a não controladores, proventos, juros pagos, capex, D&A. Uma linha entra em uma categoria só, a primeira em que bate.
- **Linha e sublinha** na mesma categoria: conta só a de cima.
- **Linha mista de capex** (com "investimentos" ou "arrendamento" junto) entra, com `mista: true`. Na DFP de 2025 são duas: Rumo e SmartFit.
- **Propriedade para investimento** entra no capex quando a linha é de aquisição, adição ou construção: "Pagamentos para aquisição de propriedades para investimentos (shopping centers)" (Allos, 386.081), "Adições em Propriedades para investimento" (Multiplan, 730.408) e "Aquisição de Propriedades Para Investimento" (MRV, 213.574), R$ mil em 2025. "Baixas em Propriedade para investimento" e "Alienação de Propriedade para Investimento" ficam de fora. Com isso o capex ÷ FCO de 2025 vai de 7,4% para 29,8% na Allos e de 2,8% para 52,7% na Multiplan.
- **Linha que mistura dívida e arrendamento** não entra em nenhuma categoria, e a categoria fica `null` com o motivo. Na DFP de 2025 são a Vivo e a Vamos, no principal e nos juros.
- **"Financiamento por arrendamento"** é arrendamento, não dívida (Direcional).
- **"Proventos"** sozinho não é dividendo: na Ambev, "Proventos de Empréstimos" quer dizer recursos obtidos.
- **O código muda dentro da mesma companhia.** Na WEG, "Imobilizado" é 6.02.02 na DFP de 2025 e 6.02.01 nos ITR de 2025 e de 2026.
- Exceções por companhia ficam em `scripts/cvm/excecoes-dfc.json`, com motivo obrigatório. O arquivo começa vazio.

Cobertura medida nas 64 companhias da página (arquivos de 12/11/2026):

| Categoria | DFP de 2025 | 12 meses | Quem fica de fora na DFP de 2025 |
|---|---:|---:|---|
| capex | 64 | 63 | ninguém |
| D&A da DFC | 64 | 63 | ninguém |
| proventos | 63 | 60 | Eneva (não tem a linha) |
| juros pagos | 58 | 55 | Minerva, Equatorial, Marfrig e Tenda (sem linha que a regra reconheça); Vivo e Vamos (misturados com arrendamento) |
| principal de arrendamento | 50 | 49 | 12 sem linha de arrendamento na DFC; Vivo e Vamos (misturado com dívida) |
| juros de arrendamento | 21 | 17 | a maioria não tem linha própria: os juros estão no FCO sem destaque, ou dentro do principal |
| proventos a não controladores | 8 | 7 | a maioria não tem a linha |

Nos 12 meses a 64ª companhia é a TIM, com a base indisponível. Em 12 casos de 10 companhias, a linha aparece numa parcela e não em outra (a descrição mudou ou a linha zerada foi omitida num ITR), e a categoria fica `null` com o motivo.

Casos que a regra deixa de fora de propósito, para decisão: "Aquisições de ativos de óleo e gás" (Brava), "Juros Pagos/Recebidos" (Equatorial, um líquido) e "Pagamento de ... (Principal e juros)" (Tenda).

**D&A da DVA × D&A da DFC.** Na DFP de 2025 as duas são iguais em 50 das 64 companhias e ficam dentro de 15% em 59. Divergem mais de 15% em cinco, sempre com a DFC maior: C&A (2,09 vezes), Hapvida (1,80), Cogna (1,35), Auren (1,24) e CPFL (1,16). Não investiguei o motivo linha a linha; a hipótese é que a DVA delas não traga toda a amortização.

**O EBITDA usa a D&A da DFC** quando ela é identificada, e a da DVA (7.04.01) de reserva (decisão da revisão da #36). Na DFP de 2025 as 64 companhias têm a linha na DFC. O EBITDA muda em 14 delas e mais de 5% em quatro: Hapvida (+29,8%), C&A (+27,0%), Cogna (+11,9%) e Auren (+9,6%). Nos 12 meses muda mais de 5% em cinco: Hapvida (+34,3%), C&A (+25,2%), Rumo (+10,4%), Auren (+10,2%) e Cogna (+9,0%). Nos 12 meses a D&A da DFC só vale se a linha foi identificada nas três parcelas; senão, vale a DVA.

O caso contrário aparece na fixture da São Martinho (que não está nas 64): a DFC traz "Depreciação e amortização" de 1.086.030 e, à parte, "Ativos biológicos colhidos", que a regra não reconhece; a DVA traz 2.371.247. Só com a DFC, o EBITDA dela cairia de 3.766.048 para 2.480.831 (R$ mil, exercício de 03/2026).

**Quando a D&A da DFC vem mais de 15% abaixo da D&A da DVA, vale a da DVA**, com a origem "DVA (DFC 15% menor)" (`LIMITE_DA_DFC_ABAIXO_DA_DVA`). Uma DFC tão abaixo é sinal de linha que a regra não achou. Na São Martinho a DFC fica 54% abaixo, vale a DVA e o EBITDA continua 3.766.048. "Ativos biológicos colhidos" não entrou no classificador. Nas 64 companhias da página a regra não muda nada, nem na DFP de 2025 nem nos 12 meses. Quem chega mais perto do limite é a Tenda: a DFC fica 4,6% abaixo da DVA na DFP de 2025 (64.473 contra 67.552) e 11,6% abaixo nos 12 meses (70.280 contra 79.483). Depois dela vem a Cyrela nos 12 meses, 4,6% abaixo.

### Composição do capital: número de ações e escala

Os arquivos `dfp_cia_aberta_composicao_capital_AAAA.csv` e `itr_cia_aberta_composicao_capital_AAAA.csv` trazem, por documento e versão, o total de ações do capital integralizado e as ações em tesouraria (`QT_ACAO_TOTAL_CAP_INTEGR` e `QT_ACAO_TOTAL_TESOURO`). O ITR mais recente das 64 companhias traz a composição, então os 12 meses usam as ações da data do ITR.

**O arquivo não diz a escala.** Na DFP de 2025, 17 das 64 companhias informam em milhares de ações e as outras 47, em unidades. A Vale informa 4.539.007 e tem 4,5 bilhões de ações. As 17, com o total como está no arquivo:

| Ticker | Companhia | Total informado (em milhares) |
|---|---|---:|
| ABEV3 | Ambev | 15.761.639 |
| ASAI3 | Assaí | 1.353.497 |
| AURE3 | Auren | 1.050.378 |
| AXIA3 | Axia Energia | 2.915.428 |
| CMIG4 | Cemig | 2.861.782 |
| CSMG3 | Copasa | 380.253 |
| CYRE3 | Cyrela | 384.000 |
| EMBJ3 | Embraer | 740.465 |
| ENEV3 | Eneva | 1.936.974 |
| LREN3 | Lojas Renner | 1.006.845 |
| MRVE3 | MRV | 562.827 |
| NATU3 | Natura | 1.773.371 |
| TAEE11 | Taesa | 1.033.497 |
| TEND3 | Tenda | 122.578 |
| VALE3 | Vale | 4.539.007 |
| VBBR3 | Vibra | 1.198.000 |
| YDUQ3 | Yduqs | 274.089 |

A lista é o resultado da regra abaixo nos arquivos de 12/11/2026, não uma entrada dela: a escala é decidida de novo a cada documento. `escalaDasAcoes` (em `scripts/cvm/composicao-capital.mjs`) decide assim:

1. Pelo lucro por ação que a companhia informa na DRE do mesmo documento (conta 3.99.01): o lucro da controladora dividido por ele dá o número de ações que a companhia usou. Se é da ordem do total informado, a escala é unidade; se é cerca de mil vezes maior, é mil. Resolve 56 das 64.
2. Sem lucro por ação informado, ou quando ele não fecha, pela ordem de grandeza: total abaixo de 100 milhões está em milhares. O maior total em milhares é 15,8 milhões (Ambev) e o menor em unidades, 206 milhões (Azzas). Usada em 8 das 64, todas em unidades.

O lucro por ação informado só serve para isso. Nenhum indicador é calculado com ele.

**Lucro da controladora (3.11.01).** Três companhias deixam 3.11.01 e 3.11.02 zeradas na DFP de 2025 e informam só o 3.11 (Klabin, Sabesp e Vamos): para elas o lucro por ação fica `null`. O Assaí só entrega a demonstração individual, que não tem a conta: vale o 3.11.

### Número de ações que diverge do documento anterior (#37)

Nos 12 meses, a composição do capital é a do documento mais recente. Se o **total de ações dela diverge mais de 50%**, para cima ou para baixo, do total do documento imediatamente anterior, a composição não é usada: o número de ações, os valores por ação e o valor de mercado ficam `null`, com o motivo "o número de ações do ITR de dd/mm/aaaa diverge N% do documento anterior". O limite é o mesmo da diluição (`LIMITE_DILUICAO`).

- **Quem cai:** a Vivara. O ITR de 30/09/2026 informa 82.118.477 ações, contra 236.197.769 no de 30/06/2026 e na DFP de 2025. Com o número errado, o valor de mercado dela sairia 1,4 bilhão em vez de 4,0 bilhões.
- **Um desdobramento de verdade também cai**, e sai sozinho no trimestre seguinte, quando os dois documentos já trazem o número novo.
- A série anual não é afetada: nela, a variação grande já deixa a diluição `null` (decisão 19 do README).

**A composição do capital só existe de 2020 em diante.** Os ZIPs de DFP de 2010 a 2019 não trazem o arquivo. Por isso o número de ações, a diluição e os valores por ação ficam `null` nos exercícios até 2019 (545 dos 929 períodos anuais das 64 companhias), com o motivo "falta a composição do capital do período".

**Escala que muda de um exercício para outro.** A escala (unidade ou mil) é descoberta de novo a cada documento. Quando ela muda entre dois exercícios seguidos da mesma companhia, a coleta registra um aviso. Na série de 2020 a 2025 são nove mudanças em oito companhias: Assaí (2024 e 2025), Axia (2021), Azzas (2022), Iguatemi (2021), Petrobras (2021), Localiza (2023), SmartFit (2021) e Vivo (2022). Não conferi caso a caso se a companhia mudou a forma de informar ou se a regra errou.

## Base de 12 meses pelo ITR

- **Não existe ITR do 4º trimestre:** o ano fecha na DFP.
- **DRE do ITR** traz dois períodos para cada exercício: o trimestre (ex.: 01/07–30/09) e o acumulado no ano (01/01–30/09), além dos mesmos dois do ano anterior (`PENÚLTIMO`).
- **DFC e DVA do ITR** trazem só o acumulado no ano.
- **Balanço** do ITR: a posição na data e a do último 31/12.
- Por isso a base de 12 meses é **anual da última DFP + acumulado do ITR atual − acumulado do mesmo período do ano anterior**. Exemplo (WEG, 3T26, lucro 3.11): 6.775.958 + 4.988.916 − 5.074.596 = **6.690.278**. A conta está no teste `test/cvm-fixtures.test.mjs`.
- **O acumulado do ano anterior vem do ITR do ano anterior como entregue (`ÚLTIMO`), não do `PENÚLTIMO` do ITR atual.** O spike supôs que o `PENÚLTIMO` servia "pronto", e o checkpoint da #33 mostrou que não:
  - O `PENÚLTIMO` pode vir reapresentado. Aí ele deixa de ser a parcela que está dentro do anual da DFP, e a conta subtrai um valor diferente do que foi somado. Em 7 das 64 companhias da página o EBIT acumulado difere entre as duas fontes, em até 14% (Motiva).
  - O `PENÚLTIMO` pode vir zerado. A TIM passou a entregar consolidado em 2026, e a coluna do ano anterior do consolidado veio toda em zero.
- O 4º trimestre isolado sai de DFP − acumulado 9M.
- **Exercício fora de dezembro:** São Martinho fecha em 31/03 (DFP em março, ITR em junho, setembro e dezembro), e a Cosan fechava em março até 2013. A base de 12 meses não pode supor que o ano começa em janeiro: tem que usar `DT_INI_EXERC`/`DT_FIM_EXERC`.

### Série anual e base de 12 meses: as regras (#33)

Implementadas em `scripts/cvm/series.mjs` (funções puras, sobre os fatos de uma companhia) e testadas em `test/cvm-series.test.mjs`.

1. **Período é data, não "ano" nem "trimestre".** Fluxo (DRE, DFC, DVA) é o par (`inicio`, `fim`); estoque (BPA, BPP) é o `fim`. A série anual é indexada pela data de fim do exercício.
   - "Anual" é o fluxo de DFP com 350 a 380 dias.
   - Outra duração é exercício de transição: entra na série marcado com os meses e não é ano comparável (ex.: a Tenda tem uma DFP de 3 meses, de 01/01 a 31/03/2023).
2. **Reapresentação: escolhe-se o documento, não a conta.** Para o exercício que termina em F, vale o `PENÚLTIMO` da DFP seguinte, quando existe; senão, o `ÚLTIMO` da própria DFP.
   - A escolha é por (período, demonstrativo) inteiro. Misturar contas de dois documentos quebraria a soma do demonstrativo, porque as subcontas não têm código fixo.
   - Se a DFP seguinte traz a DFC em outro método (a empresa trocou DFC_MI por DFC_MD), vale a DFC da própria DFP.
   - Se a DFP seguinte está em outra base (a empresa passou a consolidar, e o `PENÚLTIMO` consolidado vem zerado), vale o demonstrativo da própria DFP.
   - Cada (período, demonstrativo) carrega a origem: `documento`, `dtRefer`, `versao`, `ordem`, `consolidado` e `reapresentado`. Esse último é `true` ou `false` quando dá para comparar com o documento original, e `null` quando o original não está disponível (o primeiro ano da série só existe como `PENÚLTIMO`).
   - Quando é reapresentado, `originais` guarda o valor antigo das contas fixas que mudaram, para a página mostrar "era X, virou Y". Conta fixa fora de `originais` não mudou.
3. **Base de 12 meses** = anual da última DFP + acumulado do ITR mais recente − acumulado do mesmo intervalo do ano anterior.
   - **O acumulado anterior vem do ITR do ano anterior como entregue** (`ÚLTIMO`, na maior versão daquele documento), não do `PENÚLTIMO` do ITR atual. O motivo está na seção acima.
   - Na DRE do ITR, o acumulado é o intervalo que começa mais cedo. No 1º trimestre do exercício, trimestre e acumulado são o mesmo intervalo.
   - **Encaixe obrigatório:** o acumulado do ITR tem que começar no dia seguinte ao fim da última DFP, e o acumulado anterior tem que ser o mesmo intervalo um ano antes. Se não encaixa (DFP atrasada, mudança de exercício, última DFP de transição), o resultado é `null` com o motivo, nunca um número.
   - **Mesma base obrigatória:** a parcela anual, o acumulado atual e o acumulado anterior têm de ser todos consolidados ou todos individuais. Se a base muda entre eles, ou se falta o ITR do ano anterior, o resultado é `null` com o motivo (ex.: "a companhia passou a consolidar", caso da TIM em 2026).
   - Se o documento mais recente é a DFP, os 12 meses são o próprio ano fechado, marcado como tal.
   - Estoque é a posição do ITR mais recente, sem soma.
   - Só entram contas fixas, sem o lucro por ação (3.99.*), que não é somável. A conta em si é a função genérica `doze(anual, acumuladoAtual, acumuladoAnterior)`, que a #36 reutiliza sobre as linhas classificadas.
4. **Ausência é `null`.** Zero só quando a CVM informa zero. `null` em qualquer parcela dá `null`. Conta repetida no mesmo bloco com valores diferentes também dá `null`.

Conferido em dados reais, com a DRE completa da DFP de 2025 e dos ITR de 2025 e 2026: das 64 companhias da página, 63 fecham a base de 12 meses e 1 fica `null` com o motivo (a TIM, que passou a consolidar).

Um caso para ter em mente: a Hapvida reapresentou 2022 com o custo quase igual à receita, e o lucro bruto (3.03) daquele ano passou de 5.655.096 para **−1.139** (R$ mil). É o que a CVM traz, e combina com o resto do mesmo documento. Por isso a origem é escolhida por demonstrativo inteiro e o valor original fica guardado.

Para ver a série e os 12 meses de uma companhia em R$ milhões (é a tabela usada no checkpoint da #33):

```bash
node scripts/cvm/tabela-series.mjs test/fixtures/cvm/weg            # 2 últimos anos + 12 meses
node scripts/cvm/tabela-series.mjs test/fixtures/cvm/sao-martinho 3 # 3 últimos anos + 12 meses
```

A pasta pode ser qualquer uma com os CSVs de DFP e ITR de **uma** companhia.

## Versões, reapresentações e consolidado × individual

- O **índice** (`dfp_cia_aberta_AAAA.csv`) lista **todas** as versões entregues: em 2024, 139 empresas tinham mais de uma versão na DFP, e algumas chegavam à versão 5 no ITR. Já os **CSVs de dados trazem uma única versão por documento**: em todos os 32 ZIPs, o filtro "versão mais recente" não descartou nenhuma linha. O leitor deve filtrar mesmo assim, porque é barato e protege contra mudança no portal.
- **Reapresentação é comum e pode ser grande.** Na DFP do ano seguinte, o `PENÚLTIMO` traz o ano anterior refeito. Comparando a DFP 2023 com a 2024, 29 de 443 empresas mudaram o lucro de 2023. Na amostra:
  - Hapvida: lucro de 2022 de −775.839 para **−1.718.120** (R$ mil).
  - Natura: receita de 2022 de 36,3 bi para 29,2 bi (operação descontinuada).
  - Vamos: receita de 2023 de 6,1 bi para 3,5 bi.
  - CCR/Motiva: receita de 2024 de 21,8 bi para 18,1 bi.
  - Equatorial, Totvs, Copel, Cosan, Marfrig e outras com ajustes menores.
  - **Decisão a tomar (#33):** usar sempre o valor mais recente de cada período (o `PENÚLTIMO` do documento seguinte, quando houver). Assim a série fica comparável ano a ano.
- **Consolidado × individual:** em 2024 havia 468 empresas com DRE consolidada e 705 com individual. Todas as 81 empresas da amostra têm consolidado. Empresas sem controladas só publicam o individual, então o leitor deve usar o individual quando faltar o consolidado.

### Consolidado zerado conta como ausente (#37)

Um documento cujo consolidado tem o **ativo total (BPA, conta 1) do próprio exercício igual a 0** tem o consolidado tratado como ausente, e vale o individual daquele documento. A regra é estreita de propósito: toda companhia aberta tem ativo maior que zero, então o zero só aparece quando o formulário consolidado foi entregue em branco. Fica em `escolherConsolidado` (`scripts/cvm/leitor.mjs`), e `consolidadosZerados` diz quais documentos caíram nela.

- **Quem cai:** nas 64 companhias da página, só a TIM, nas DFPs de 2024 e de 2025. O consolidado vem inteiro em zero (ativo, receita e o resto) e o individual vem preenchido.
- **O que conta é o ÚLTIMO.** No ITR de 2026 da TIM o consolidado do período vem preenchido e só a coluna do ano anterior (PENÚLTIMO) vem em zero. Esse documento não cai na regra.
- **É por documento.** O zerado de um ano não tira o consolidado de outro.

A série anual da TIM, depois da regra (R$ milhões):

| Exercício | Base | Receita | EBITDA | Lucro líquido | Ativo total |
|---|---|---:|---:|---:|---:|
| 2017 | individual | 736 | 225 | 102 | 2.039 |
| 2018 | individual | 3.368 | 1.516 | 1.534 | 31.368 |
| 2019 | individual | 17.377 | 9.716 | 3.860 | 39.857 |
| 2020 | consolidado | 17.268 | 8.342 | 1.844 | 41.654 |
| 2021 | individual | 18.058 | 9.448 | 2.957 | 49.819 |
| 2022 | consolidado | 21.531 | 9.987 | 1.671 | 56.408 |
| 2023 | consolidado | 23.834 | 11.834 | 2.837 | 55.260 |
| 2024 | individual | 25.448 | 12.533 | 3.154 | 56.327 |
| 2025 | individual | 26.625 | 13.422 | 4.312 | 56.939 |

**Período com a demonstração zerada (#38).** A regra acima olha o documento inteiro, pelo ÚLTIMO. Sobra um caso que ela não pega: a coluna do ano anterior (PENÚLTIMO) vem zerada num documento cujo consolidado do próprio ano é válido, e não há outro documento para aquele exercício. É o Assaí em 2018: a companhia só passou a entregar DFP em 2019, o exercício de 2018 só existe na coluna do ano anterior da DFP de 2019, e no consolidado ela vem inteira em zero. Nesse caso o período fica **indisponível**, com o motivo "demonstração zerada no documento": todos os indicadores dele ficam `null`, em vez de receita, lucro e ativo iguais a 0. A conferência é pelo ativo total (conta 1) igual a 0 e fica em `adaptarPeriodo` (`scripts/cvm/indicadores.mjs`, `MOTIVO_DEMONSTRACAO_ZERADA`). Nas 64 companhias, de 929 períodos anuais, só esse cai na regra.

O individual da mesma coluna do Assaí vem preenchido (ativo de 10,9 bilhões e receita de 23,0 bilhões em 2018), mas não é usado: o documento tem consolidado válido, e a escolha entre as bases é por documento, não por coluna.

A Ambev em 2011 e 2012 **não** cai na regra: a série sai do individual, que tem ativo, e a receita informada é 0. Ali o zero é o que a CVM traz.

Antes da regra, 2024 e 2025 saíam do consolidado zerado: receita, EBITDA, lucro e ativo iguais a 0. Os anos de 2017 a 2019 e 2021 já eram individuais, porque a TIM S.A. não entregou consolidado neles. A base de 12 meses dela continua indisponível: a DFP de 2025 é individual e o ITR de 2026 é consolidado, e as três parcelas têm de estar na mesma base.

## Ticker → CNPJ (FCA)

- `fca_cia_aberta_valor_mobiliario` liga CNPJ ao `Codigo_Negociacao`, mas **o campo é texto livre**. Em 2026, 35 de 492 linhas de ações em bolsa tinham código inválido: CSN com "4030" (o código CVM), CSN Mineração com "25585", Marfrig com "ADR", e também "tgma3" (minúsculo), "LMED", "PNC" e "N/A".
- Nomes trocados aparecem certinhos no FCA mais recente (AXIA3, EMBJ3, MOTV3, AZZA3). Os antigos ficam nos anos anteriores.
- BRF e Marfrig (fusão em MBRF) apresentaram **linhas de DFC idênticas** em 2025.
- **Consequência para a #32:** o vínculo precisa de uma tabela manual de exceções versionada, e não pode depender só do FCA.

### Universo da página Fundamentalista (#32)

A lista de empresas fica em `scripts/cvm/universo.json`, **uma entrada por companhia (CNPJ)**, não por ticker: PETR3 e PETR4 caem na mesma entrada. Ela é gerada, não editada à mão, a partir de:

| Arquivo | O que é | Quem mantém |
|---|---|---|
| `scripts/cvm/tickers-ibovespa.json` | Tickers da carteira teórica do Ibovespa, com data de referência e fonte (B3) | à mão, a cada rebalanceamento (janeiro, maio e setembro) |
| `scripts/cvm/excecoes-tickers.json` | Vínculos manuais ticker → CNPJ, cada um com o motivo | à mão, quando o FCA vem errado |
| `scripts/cvm/setores.json` | Setor de cada ticker (classificação nossa, não a da CVM) e quem fica fora da página, com o motivo | à mão |
| FCA do ano (`valor_mobiliario` e `geral`) | Código de negociação, CNPJ, código CVM e nome | CVM |

Regras do vínculo (`scripts/cvm/universo.mjs`, funções puras):

- **Nada é adivinhado.** O vínculo vem do FCA só quando o código de negociação é válido (4 caracteres + 3, 4, 5, 6, 7, 8 ou 11), está em `Bolsa` e não tem data de fim de negociação. Fora disso, só por exceção com motivo. O que não liga vai para `pendentes`, com o motivo.
- A exceção vence o FCA. Mesmo código em duas companhias é ambíguo e vira pendente.
- As outras classes que a companhia informa no FCA (ex.: ENGI3 e ENGI4 da Energisa, que está na carteira com ENGI11) entram na mesma entrada com `ibovespa: false`, só como porta de entrada da busca.
- Bancos, seguradoras e holdings não saem da lista: ficam com `foraDaPagina` igual ao motivo (`"banco"`, `"seguradora"` ou `"holding"`) e fora da página na v2. As demais saem com `foraDaPagina: null`. Na carteira de 13/11/2026 são 10 de 74: 5 bancos, 3 seguradoras (BB Seguridade, Caixa Seguridade e Porto Seguro) e 2 holdings (Itaúsa e Bradespar). A B3 entra na página, sozinha no setor "Serviços financeiros".
- São 13 setores. Entre os que têm empresa na página, só "Serviços financeiros" (a B3) fica com menos de 3 e, por isso, sem mediana de pares na #39.

Na carteira de 13/11/2026 (76 tickers, 74 companhias), 71 tickers ligaram pelo FCA e 5 precisaram de exceção:

| Ticker | O que o FCA 2026 traz | Companhia |
|---|---|---|
| CSNA3 | código "4030" (o código CVM) | CSN |
| CMIN3 | código "25585" (o código CVM) | CSN Mineração |
| BPAC11 | código "000000" na linha de Units | Banco BTG Pactual |
| MBRF3 | código "ADR"; a B3 chama o papel de "MARFRIG". É a Marfrig depois de incorporar as ações da BRF (fato relevante de 08/09/2025, fechamento em 22/09/2025) | Marfrig Global Foods |
| CEAB3 | código certo, mas com data de fim de negociação igual à de início (28/10/2019) | C&A Modas |

Para gerar de novo (sem rede e sem ZIP, como as fixtures):

```bash
# extrair os dois CSVs do FCA do ano para uma pasta qualquer
mkdir -p ~/cvm/fca && cd ~/cvm/fca
unzip -oq ~/cvm/zip/fca_cia_aberta_2026.zip fca_cia_aberta_valor_mobiliario_2026.csv fca_cia_aberta_geral_2026.csv
cd -

node scripts/cvm/gerar-universo.mjs ~/cvm/fca      # usa o ano mais recente da pasta; imprime setores e pendentes
git status --short scripts/cvm/universo.json       # vazio: o resultado sai idêntico ao commitado
```

A fixture do FCA usada nos testes (`test/fixtures/cvm/fca/`, nove companhias que cobrem ON e PN, unit, código inválido, nome trocado e data de fim) sai do mesmo gerador das outras: `node scripts/cvm/gerar-fixtures.mjs ~/cvm/fca fca`.

## Volume

Medido numa máquina Windows comum (Node 26). A filtragem lê os CSVs direto do ZIP (`unzip -p`), em fluxo, sem extrair.

| Medição | Valor |
|---|---|
| Download bruto por execução (DFP 2010–2026 + ITR 2011–2026 + FCA) | **≈ 583 MB** (50 ZIPs) |
| Tempo de download (6 em paralelo) | 74 s |
| Linhas brutas lidas (DRE, BPA, BPP, DFC_MI, DFC_MD, DVA; con + ind) | 40,8 milhões (DFP 10,0 mi; ITR 30,8 mi) |
| Depois de filtrar as 81 empresas | 5,88 milhões |
| Só consolidado | 2,94 milhões |
| Só consolidado e versão mais recente | 2,94 milhões (nenhuma linha a mais, ver acima) |
| Só o período `ÚLTIMO` (sem as cópias do ano anterior) | 1,47 milhão |
| Tempo da filtragem (stream, uma thread) | 241 s |
| `node:sqlite`: carga das 2,94 milhões de linhas (uma transação) | 13,2 s |
| `node:sqlite`: criação de índice (cnpj, conta, data) | 6,0 s |
| `node:sqlite`: consulta da base de 12m de uma empresa | 0,04 s |
| Tamanho do banco SQLite | 501 MB (o NDJSON equivalente tem 701 MB) |
| JSON de uma empresa (WEG), todas as 341 contas, anual + trimestres | 476 KB |
| JSON de uma empresa (WEG), só as 48 contas do plano | **78 KB** |

- O `node:sqlite` funciona sem dependência nova no Node 24 e 26, mas ainda emite `ExperimentalWarning`.
- **Estimativa no GitHub Actions** (`ubuntu-latest`, que já tem `unzip`): de 1 a 3 min de download, mais 4 a 6 min de filtragem, mais menos de 1 min de carga e geração do JSON. **Total de 6 a 10 min por execução semanal**, bem dentro do limite. Dá para reduzir bastante guardando os ZIPs antigos em cache (`actions/cache`), já que só os anos recentes mudam.
- Publicado: cerca de 75 empresas × 80 KB ≈ **6 MB de JSON estático** (sem gzip). Com todas as contas, seriam uns 35 MB.

Leitura para o checkpoint "JSON puro × SQLite":

- Os dois cabem com folga. O gargalo é ler 40 milhões de linhas do ZIP, não a etapa de armazenamento.
- Em JSON puro, guardar em memória só o período `ÚLTIMO` das contas do plano dá algumas centenas de milhares de objetos, sem problema de memória.
- O SQLite facilita consultas variadas (reapresentação, 12 meses, comparação com o setor), mas custa ~500 MB de disco no runner e o aviso de experimental.

## Decisão do checkpoint (13/11/2026)

A v2 usa **JSON puro**. O leitor gera um formato intermediário normalizado, com uma linha por valor: `cnpj`, `conta`, `início`, `fim`, `valor` e `versão`. Com isso, dá para trocar para SQLite depois sem reescrever a lógica.

Motivo: o gargalo é ler os ZIPs, não armazenar (ver Volume acima). E as regras difíceis (classificador de contas, IFRS 16, exercício fora de dezembro) ficam em JS testado.

## O que a série inteira mostra nos pontos de atenção (#39)

Com os dados de 13/11/2026, nas 64 companhias da página (limites padrão):

| Regra | Acionada | Não acionada | Não avaliada |
|---|---:|---:|---:|
| Lucro que não vira caixa | 7 | 52 | 5 |
| Proventos maiores que o FCL | 24 | 39 | 1 |
| Dívida líquida ÷ EBITDA alta | 14 | 50 | 0 |
| Dívida concentrada no curto prazo | 1 | 63 | 0 |
| Capex maior que o FCO | 4 | 60 | 0 |
| Diluição | 14 | 39 | 11 |
| Margem líquida em queda | 9 | 55 | 0 |

- 19 companhias não acionam nenhuma regra, 24 acionam uma, 15 acionam duas, 5 acionam três e 1 aciona quatro (Equatorial).
- **Não avaliadas:** a diluição fica sem avaliar em 11 companhias por desdobramento ou grupamento na janela de três exercícios. "Lucro que não vira caixa" fica sem avaliar em 5, que tiveram prejuízo em três ou mais dos últimos cinco exercícios.
- **Proventos maiores que o FCL** é a regra que mais aciona (24 de 64). Ela compara o que foi pago com o FCL do mesmo período, e uma companhia em ciclo de investimento ou com FCL negativo cai nela.
- **Períodos fora das contas:** o Assaí em 2018 (demonstração zerada) e três exercícios de transição (Cosan em 2013, Tenda em 03/2023 e Vivara em 2019).
- **Comparação com o setor:** todos os 12 setores usam o exercício de 2025, e todas as 64 companhias o têm. Só Serviços financeiros (a B3 sozinha) fica sem mediana. Quatro setores têm exatamente 3 empresas (Alimentos e bebidas, Indústria, Shoppings e Telecom e tecnologia): neles a mediana é a empresa do meio, e os quartis dizem pouco.

## Fixtures

Em `test/fixtures/cvm/`, recortes dos CSVs reais, byte a byte (latin1, CRLF; preservados pelo `.gitattributes`), com o índice, DRE, BPA, BPP, DFC_MI e DVA consolidados e a composição do capital (da DFP e do ITR):

| Pasta | Empresa | Arquivos | Por quê |
|---|---|---|---|
| `weg/` | WEG (industrial) | DFP 2025 + ITR 3T25 + ITR 3T26 | caso limpo; testa a base de 12 meses (o ITR de 2025 dá o acumulado do ano anterior) |
| `raia-drogasil/` | Raia Drogasil | DFP 2025 | IFRS 16 relevante (arrendamentos ≈ 66% do capex) |
| `hapvida/` | Hapvida | DFP 2022 + DFP 2023 | lucro de 2022 reapresentado (−0,78 bi → −1,72 bi) |
| `sao-martinho/` | São Martinho | DFP 03/2025 + DFP 03/2026 + ITR 06/2025 + ITR 06/2026 | exercício de abril a março; o último ITR entregue é o do 1º trimestre |

O teste `test/cvm-fixtures.test.mjs` confirma nessas fixtures os principais fatos deste documento: formato, contas fixas, subcontas sem código fixo, base de 12 meses, reapresentação e IFRS 16.

### Gerar as fixtures de novo

As fixtures saem de `scripts/cvm/gerar-fixtures.mjs`, que recebe a pasta com os CSVs já extraídos e os `CD_CVM` desejados. Ele não acessa a rede nem abre ZIP: acha o CNPJ pelo `CD_CVM` no arquivo de índice, recorta o cabeçalho e as linhas da empresa e grava copiando os bytes originais (latin1, CRLF). Quais documentos entram em cada fixture está em `FIXTURES`, em `scripts/cvm/fixtures.mjs` (lógica pura, testada em `test/cvm-recorte.test.mjs`).

```bash
# extrair só os anos usados (DFP 2022, 2023, 2025 e 2026; ITR 2025 e 2026) para uma pasta qualquer
mkdir -p ~/cvm/csv && cd ~/cvm/csv
for z in dfp_cia_aberta_2022 dfp_cia_aberta_2023 dfp_cia_aberta_2025 dfp_cia_aberta_2026 itr_cia_aberta_2025 itr_cia_aberta_2026; do unzip -oq ~/cvm/zip/$z.zip; done
cd -

# WEG = 005410, Raia Drogasil = 005258, Hapvida = 024392, São Martinho = 020516 (sem CD_CVM, gera as quatro)
node scripts/cvm/gerar-fixtures.mjs ~/cvm/csv 005410 005258 024392 020516
git status --short test/fixtures   # vazio: os recortes saem idênticos aos commitados
```

`--saida <pasta>` grava em outro lugar. Um `CD_CVM` fora de `FIXTURES` dá erro: para criar uma fixture nova, acrescente a entrada lá primeiro. Como a CVM regrava os ZIPs dos anos recentes, um download futuro pode trazer uma versão mais nova do documento e mudar os recortes. Nesse caso, o `git diff` mostra exatamente o quê.

## Como reproduzir

Os números deste documento saem dos comandos abaixo (Git Bash ou Linux, Node 24+ e `unzip`). Os scripts de `scripts/cvm/spike/` são ferramentas do spike, ficam fora do site e não têm testes. As pastas `~/cvm/...` são só exemplo: use qualquer pasta fora do repositório, porque são ~600 MB de ZIP e ~1,2 GB de saída.

```bash
# 1. Download de todos os ZIPs (DFP 2010–2026, ITR 2011–2026, FCA 2010–2026), 6 em paralelo, com tempo
mkdir -p ~/cvm/zip && cd ~/cvm/zip
base=https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC
time (for y in $(seq 2010 2026); do
  echo "$base/DFP/DADOS/dfp_cia_aberta_$y.zip"; echo "$base/FCA/DADOS/fca_cia_aberta_$y.zip"
  [ $y -ge 2011 ] && echo "$base/ITR/DADOS/itr_cia_aberta_$y.zip"
done | xargs -P 6 -n 1 curl -sS -O)
du -ch dfp* | tail -1; du -ch itr* | tail -1; du -ch fca* | tail -1
cd -

# 2. Datas de modificação e tamanhos no portal; conteúdo de um ZIP
curl -s $base/DFP/DADOS/ | grep '\.zip"'
unzip -l ~/cvm/zip/dfp_cia_aberta_2024.zip

# 3. Volume: filtra a amostra direto dos ZIPs (≈ 4 min) → linhas.ndjson + stats.json
node scripts/cvm/spike/medir-volume.mjs ~/cvm/zip ~/cvm/out

# 4. node:sqlite: carga, índice, consulta de base 12m da WEG e tamanho do JSON por empresa
node scripts/cvm/spike/medir-sqlite.mjs ~/cvm/out/linhas.ndjson ~/cvm/out/spike.sqlite

# 5. DFC (descrições, cobertura do capex por ano), reapresentações e exercício fora de dezembro
node scripts/cvm/spike/medir-contas.mjs ~/cvm/out/spike.sqlite ~/cvm/out/stats.json
```

Verificações pontuais, sobre os CSVs de 2023 e 2024 extraídos na pasta atual (`unzip -oq ~/cvm/zip/dfp_cia_aberta_2024.zip` etc.):

```bash
# encoding, CRLF e cabeçalho (o BP não tem DT_INI_EXERC)
file dfp_cia_aberta_DRE_con_2024.csv; head -1 dfp_cia_aberta_BPA_con_2024.csv

# contas fixas da DRE: descrição e quantas empresas usam cada uma (planos industrial, banco e seguradora)
iconv -f latin1 -t utf-8 dfp_cia_aberta_DRE_con_2024.csv | awk -F';' '$9=="ÚLTIMO" && $12 ~ /^3\.(0[1-9]|1[01])$/ {print $12" | "$13}' | sort | uniq -c

# escala da moeda
cut -d';' -f7,8 dfp_cia_aberta_DRE_con_2024.csv | sort | uniq -c

# versões: o índice lista todas; os dados trazem uma só por documento
cut -d';' -f1,2 dfp_cia_aberta_2024.csv | sort | uniq -c | awk '$1>1' | wc -l
cut -d';' -f1,2,3 dfp_cia_aberta_DRE_con_2024.csv | sort -u | cut -d';' -f1,2 | uniq -c | awk '$1>1' | wc -l

# consolidado × individual
cut -d';' -f1 dfp_cia_aberta_DRE_con_2024.csv | sort -u | wc -l; cut -d';' -f1 dfp_cia_aberta_DRE_ind_2024.csv | sort -u | wc -l

# reapresentação no mercado todo: lucro de 2023 na DFP 2023 × PENÚLTIMO da DFP 2024 (comparadas, diferentes)
awk -F';' 'FNR==1{next} FILENAME~/2023/ && $9!~/^PEN/ && $12=="3.11" {a[$1]=$14}
  FILENAME~/2024/ && $9~/^PEN/ && $12=="3.11" {b[$1]=$14}
  END{for(k in a) if(k in b){t++; if(a[k]!=b[k]) d++} print t, d}' dfp_cia_aberta_DRE_con_2023.csv dfp_cia_aberta_DRE_con_2024.csv

# FCA: códigos de negociação inválidos em ações listadas em bolsa (linhas, inválidas)
unzip -p ~/cvm/zip/fca_cia_aberta_2026.zip fca_cia_aberta_valor_mobiliario_2026.csv | iconv -f latin1 -t utf-8 |
  awk -F';' 'NR>1 && $11=="Bolsa" && $6 ~ /^Ações|^Units|^Certificado/ {t++; if ($9 !~ /^[A-Z0-9]{4}(3|4|5|6|7|8|11)$/) b++} END{print t, b}'
```

Os tempos variam com a máquina e a rede. Os números deste documento foram medidos em 12/11/2026, numa máquina Windows com Node 26.

## Riscos que mudam o plano

1. **Capex, juros, proventos e arrendamentos não têm código fixo** (#35, #36). O classificador por descrição precisa de regex testada contra a amostra inteira e de uma tabela de exceções por empresa. Juros pagos aparecem tanto no FCO quanto no FCF. Ainda falta decidir ativo biológico e ativo de contrato.
2. **FCL com e sem IFRS 16** (#36). Sem descontar os arrendamentos, o FCL de varejo, saúde e locação fica muito inflado. Proposta: mostrar os dois.
3. **Ticker → CNPJ precisa de exceções manuais** (#32). O código do FCA é texto livre e errado em ~7% das linhas.
4. **Ler em fluxo e sem extrair** (#31). Node não descompacta ZIP sozinho. Ou usamos o `unzip -p` do runner (só na casca), ou escrevemos um leitor de ZIP mínimo com `zlib.inflateRaw` (sem dependência nova). Mapear colunas pelo cabeçalho (o BP não tem `DT_INI_EXERC`) e normalizar `ESCALA_MOEDA`.
5. **Reapresentações frequentes** (#33). A série anual tem que usar o valor mais recente de cada período, não o primeiro publicado.
6. **Exercício social fora de dezembro** (#33). A base de 12 meses tem que trabalhar com datas, não com "trimestre 1–4" fixo (ex.: São Martinho).
7. **Financeiras dá para detectar pelos dados** (#32). O plano de contas de bancos e seguradoras é outro (3.01 e 2.03 com outro significado). Isso confirma a exclusão e permite um filtro automático, além da lista.
