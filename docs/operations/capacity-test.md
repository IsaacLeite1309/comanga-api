# Teste de capacidade da API

## Objetivo

Mensurar o ambiente gratuito de homologação antes de qualquer aumento de infraestrutura. O teste deve usar uma rota pública de listagem representativa, com paginação de 50 registros, banco de homologação e dados suficientes para exercitar a consulta real.

## Critérios do SERS

| Requisito | Critério automatizado |
| --- | --- |
| RNF01 | P95 do processamento da busca menor ou igual a 500 ms. |
| RNF02 | Vazão mínima de 20 RPS e taxa de respostas HTTP 5xx menor que 1%. |
| RNF03 | Resposta de até 2 MB e no máximo 50 registros por página. |

O teste registra também total de requisições, códigos HTTP, falhas de rede, latência mínima/média/P50/P95/máxima, CPU do processo da API, RSS, heap e conexões PostgreSQL.

## Segurança

- Executar somente contra ambiente pertencente ao projeto e autorizado pela equipe.
- Nunca executar contra a produção sem uma janela aprovada.
- Manter `OPS_METRICS_TOKEN` fora do repositório e da linha de comando.
- Confirmar o host com `LOAD_TEST_CONFIRM_HOST`; o script recusa qualquer divergência.
- A URL de métricas deve usar a mesma origem da rota testada.
- O script limita os estágios a 100 usuários virtuais e a duração a cinco minutos por estágio.

## Preparação da homologação

1. Implantar a versão que contém `/health/live`, `/health/ready` e `/health/metrics`.
2. Configurar um valor aleatório forte para `OPS_METRICS_TOKEN` no Render.
3. Confirmar `GET /health/live` com HTTP 200.
4. Confirmar `GET /health/ready` com HTTP 200 e `checks.database = up`.
5. Escolher uma rota pública paginada e representativa; o health check não mede a busca do catálogo.
6. Confirmar no Neon que o banco utilizado é exclusivamente o de homologação.
7. Evitar alterações de dados e deploys durante a aferição.

## Execução

No PowerShell:

```powershell
$env:LOAD_TEST_URL="https://api-de-homologacao.exemplo/api/public/works?page=1&limit=50"
$env:LOAD_TEST_CONFIRM_HOST="api-de-homologacao.exemplo"
$env:LOAD_TEST_METRICS_URL="https://api-de-homologacao.exemplo/health/metrics"
$env:OPS_METRICS_TOKEN="segredo-configurado-no-render"
$env:LOAD_TEST_ENVIRONMENT="homologation-free"
npm run load:test
```

Parâmetros opcionais:

```text
LOAD_TEST_STAGES=10,25,50,100
LOAD_TEST_DURATION_SECONDS=30
LOAD_TEST_TIMEOUT_MS=10000
LOAD_TEST_OUTPUT=docs/operations/results/capacity-latest.json
```

Executar uma rodada de aquecimento antes da rodada registrada, pois o Render gratuito pode estar adormecido. O tempo de cold start deve ser documentado separadamente e não misturado com a latência normal da busca.

## Interpretação

- `RNF01 = passed`: P95 não ultrapassou 500 ms no estágio.
- `RNF02 = passed`: o estágio alcançou pelo menos 20 RPS e manteve erros 5xx abaixo de 1%.
- `RNF03 = passed`: cada resposta ficou dentro de 2 MB e a coleção identificada no JSON teve no máximo 50 itens.
- `RNF03 = not_evaluated`: o script não reconheceu uma coleção paginada no formato da resposta; o contrato público deve ser adaptado antes de concluir a avaliação.
- `serverMetrics.status = not_collected`: a URL de métricas ou a chave operacional não foi configurada corretamente.

Resultados com HTTP 429 devem ser analisados separadamente: podem indicar proteção deliberada, mas ainda representam indisponibilidade para o cenário de leitura testado.

## Estado atual

**Medição do ambiente gratuito: pendente.** A infraestrutura de teste está pronta, mas as rotas públicas RF0036 e RF0037 ainda não foram implantadas nesta versão. Executar carga apenas sobre `/health/live` produziria um número artificial e não demonstraria a capacidade do catálogo.

Após o deploy da primeira rota pública, devem ser registrados:

| Evidência | Valor |
| --- | --- |
| Data e commit testado | Pendente |
| Plano do Render | Gratuito |
| Plano do Neon | Gratuito |
| URL/rota testada | Pendente |
| P95 por estágio | Pendente |
| RPS por estágio | Pendente |
| Erros por estágio | Pendente |
| Pico de CPU | Pendente |
| Pico de memória RSS/heap | Pendente |
| Pico de conexões PostgreSQL | Pendente |
| Limite estável observado | Pendente |
| Primeiro gargalo observado | Pendente |

Nenhuma capacidade de usuários simultâneos deve ser afirmada antes desse relatório real.
