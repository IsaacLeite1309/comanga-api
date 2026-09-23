# Teste de capacidade da API

## Objetivo

Medir latência, vazão e erros de uma rota pública paginada do catálogo em um ambiente autorizado, antes de decidir por qualquer aumento de infraestrutura. O teste é feito por `scripts/load-test.js` (`npm run load:test`) e não faz parte de `npm run check`.

## Critérios avaliados pelo script

Cada estágio de carga recebe uma avaliação própria, calculada em `scripts/load-test-lib.js`. Os rótulos seguem os requisitos não funcionais do SERS; confira a redação vigente no [comanga-docs](https://github.com/IsaacLeite1309/comanga-docs).

| Rótulo | Critério aplicado | Resultado possível |
| --- | --- | --- |
| RNF01 | P95 da latência ≤ 500 ms | `passed` ou `failed` |
| RNF02 | Vazão ≥ 20 requisições por segundo **e** taxa de respostas 5xx < 1% | `passed` ou `failed` |
| RNF03 | Toda resposta ≤ 2 MB **e** coleção paginada com no máximo 50 itens | `passed`, `failed` ou `not_evaluated` |

A latência é medida no cliente, do envio até o fim da leitura do corpo. Ela inclui rede e TLS; portanto, é mais rigorosa que o tempo de processamento no servidor.

Para RNF03, o script procura a coleção nas chaves `items`, `data`, `results`, `works` ou `editions` do JSON. As listagens `GET /api/public/works` e `GET /api/public/editions` são reconhecidas. Em outras rotas o resultado pode ser `not_evaluated`.

## Métricas registradas

Por estágio:

- total de requisições, tempo decorrido e requisições por segundo;
- contagem por código HTTP (falhas de rede aparecem como `network_error`);
- erros 5xx, falhas (rede ou HTTP ≥ 400) e suas taxas;
- latência mínima, média, P50, P95 e máxima;
- maior resposta em bytes e maior quantidade de itens por resposta;
- métricas do servidor, quando configuradas: uso de CPU do processo da API (percentual de um núcleo), picos de RSS e de heap e pico de conexões no banco.

As métricas do servidor vêm de `GET /health/metrics`, amostradas a cada segundo. O pico de conexões conta **todas** as conexões ao banco atual (`pg_stat_activity`), não só as da API. Com menos de duas amostras, o estágio registra `serverMetrics.status = not_collected`.

## Ambiente seguro

- Execute apenas contra ambiente do projeto e com autorização da equipe. Contra a produção, só dentro de uma janela aprovada.
- Fora dessa janela, use um ambiente com banco Neon próprio para a medição, nunca o de produção nem o de testes automatizados.
- O host precisa ser confirmado: `LOAD_TEST_CONFIRM_HOST` (ou `--confirm-host`) deve ser igual ao host da URL alvo, incluindo a porta, se houver. Qualquer divergência interrompe o script.
- A URL de métricas precisa ter a mesma origem da URL alvo.
- O token operacional é lido **apenas** da variável `OPS_METRICS_TOKEN`. Não o passe na linha de comando nem o grave em arquivo versionado.
- Limites impostos pelo script: estágios inteiros de 1 a 100 usuários virtuais, em ordem estritamente crescente; duração de 1 a 300 segundos por estágio.
- O script aceita HTTP e HTTPS; use HTTP somente em ambiente local.

## Massa de teste

O script não cria dados; ele só faz leituras `GET` sem cookie, ou seja, como **visitante**. Isso implica:

- apenas Obras e Edições **públicas** e **sem conteúdo adulto** entram nas respostas;
- para exercitar páginas cheias, o ambiente precisa de pelo menos 50 Obras (ou Edições) públicas que atendam ao filtro usado;
- as capas precisam estar associadas e `MEDIA_PUBLIC_BASE_URL` configurada, senão as respostas que montam `coverUrl` falham com 503;
- a massa deve ser cadastrada pelos fluxos administrativos no banco de homologação, com dados fictícios, e mantida estável durante a medição.

## Preparação

1. Publicar no ambiente a versão que será medida e anotar o commit.
2. Configurar na API um valor aleatório forte em `OPS_METRICS_TOKEN` (sem ele, `/health/metrics` responde 404).
3. Confirmar `GET /health/live` com HTTP 200.
4. Confirmar `GET /health/ready` com HTTP 200 e `checks.database = "up"`.
5. Escolher a rota: uma listagem pública paginada com `limit=50`. Health checks não medem o catálogo.
6. Confirmar que o banco do ambiente é o de homologação e que a massa de teste está publicada.
7. Evitar deploys e alterações de dados durante a medição.

## Execução

Bash:

```bash
export LOAD_TEST_URL="https://api-homologacao.exemplo.test/api/public/works?page=1&limit=50"
export LOAD_TEST_CONFIRM_HOST="api-homologacao.exemplo.test"
export LOAD_TEST_METRICS_URL="https://api-homologacao.exemplo.test/health/metrics"
export LOAD_TEST_ENVIRONMENT="homologacao"
export LOAD_TEST_OUTPUT="/tmp/comanga-capacidade.json"
read -rs OPS_METRICS_TOKEN && export OPS_METRICS_TOKEN
npm run load:test
```

PowerShell:

```powershell
$env:LOAD_TEST_URL = "https://api-homologacao.exemplo.test/api/public/works?page=1&limit=50"
$env:LOAD_TEST_CONFIRM_HOST = "api-homologacao.exemplo.test"
$env:LOAD_TEST_METRICS_URL = "https://api-homologacao.exemplo.test/health/metrics"
$env:LOAD_TEST_ENVIRONMENT = "homologacao"
$env:LOAD_TEST_OUTPUT = "$env:TEMP\comanga-capacidade.json"
$env:OPS_METRICS_TOKEN = Read-Host "Token operacional" -MaskInput
npm run load:test
```

Parâmetros opcionais, por variável ou argumento (`npm run load:test -- --stages=10,25`):

| Variável | Argumento | Padrão |
| --- | --- | --- |
| `LOAD_TEST_STAGES` | `--stages` | `10,25,50,100` |
| `LOAD_TEST_DURATION_SECONDS` | `--duration` | `30` |
| `LOAD_TEST_TIMEOUT_MS` | `--timeout` | `10000` |
| `LOAD_TEST_METRICS_URL` | `--metrics-url` | sem métricas do servidor |
| `LOAD_TEST_ENVIRONMENT` | `--environment` | `homologation` |
| `LOAD_TEST_OUTPUT` | `--output` | `docs/operations/results/capacity-latest.json` |

O caminho padrão de saída fica dentro do repositório e não está no `.gitignore`. Prefira um caminho fora dele, como nos exemplos, e não versione relatórios.

Faça uma rodada de aquecimento antes da rodada registrada: o plano gratuito da Render pode estar adormecido. Registre o tempo de cold start separadamente, sem misturá-lo à latência normal.

## Interpretação

- `RNF01 = passed`: o P95 do estágio não passou de 500 ms.
- `RNF02 = passed`: o estágio atingiu pelo menos 20 RPS com menos de 1% de respostas 5xx. Respostas 4xx e falhas de rede entram em `failureRate`, não nesse critério; analise-as à parte.
- `RNF03 = passed`: todas as respostas ficaram dentro de 2 MB e a coleção reconhecida teve no máximo 50 itens. `not_evaluated` indica que nenhuma coleção foi reconhecida.
- `serverMetrics.status = not_collected`: faltou `LOAD_TEST_METRICS_URL`, o token estava ausente ou incorreto, ou houve menos de duas amostras.
- HTTP 429: as rotas públicas não têm limitador na API; um 429 vem da plataforma ou de um proxy e ainda representa indisponibilidade para o cenário testado.

O limite estável é o maior estágio em que os três critérios passaram. Com a vazão, observe se o RPS parou de crescer entre estágios, o que indica saturação.

## Registro de uma medição

Cada medição vale apenas para o commit, o ambiente e a massa em que foi feita. Não trate um resultado antigo como capacidade permanente, e não afirme capacidade de usuários simultâneos sem um relatório real. Nenhum resultado está versionado neste repositório.

Modelo para registrar uma rodada (no documento de entrega ou no comanga-docs):

| Evidência | Valor |
| --- | --- |
| Data e commit testado | |
| Plano da Render e do Neon | |
| URL/rota testada e massa publicada | |
| Estágios e duração | |
| P95 por estágio | |
| RPS por estágio | |
| Taxa de 5xx e de falhas por estágio | |
| Pico de CPU, RSS e heap | |
| Pico de conexões PostgreSQL | |
| Cold start observado | |
| Limite estável e primeiro gargalo | |
