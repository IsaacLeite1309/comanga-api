# Suíte local de carga da API

A suíte exercita os métodos HTTP explicitamente registrados na API, incluindo saúde, catálogo público, acervo, contas e administração. O relatório JSON registra método, rota, autenticação, parâmetros, dependências e cenários para cada registro. O Express responde a `HEAD` implicitamente para rotas `GET` e o middleware de CORS atende preflights `OPTIONS`. A verificação de inventário usa os registros explícitos dos roteadores.

Use `npm run load:test:all` para esta suíte. O comando `npm run load:test` continua disponível para o procedimento de leitura descrito em [Teste de capacidade da API](capacity-test.md).

## Requisitos

- Node.js 22.12 ou posterior, dependências instaladas com `npm ci` e cliente gerado com `npm run prisma:generate`.
- PostgreSQL local com `pg_config`, `initdb`, `pg_ctl` e `createdb`, extensão `pg_trgm` e suporte a locale UTF-8. Use macOS ou Linux, com um usuário comum autorizado a criar processos e diretórios temporários.
- O locale padrão é `en_US.UTF-8`. Em hosts com outro locale UTF-8 instalado, informe-o em `LOAD_TEST_PG_LOCALE`. O banco precisa reconhecer a caixa de caracteres acentuados.

## Execução

```bash
npm run load:test:all
```

O comando compila a API a partir do checkout, cria um cluster PostgreSQL sob um diretório privado, aplica as migrations e insere fixtures sintéticas. O banco aceita conexões por um socket Unix dentro desse diretório. A API fica presa a `127.0.0.1`, com uma porta reservada pelo sistema operacional por padrão. Ela usa as rotas, regras de autenticação, Prisma e processamento de imagem da aplicação. O e-mail, o download da imagem de teste e o armazenamento são simulados dentro do processo. A suíte usa credenciais de teste e guarda a senha, a sessão e os tokens fora do relatório.

A passada inicial executa todos os cenários uma vez e verifica os status esperados. A carga progressiva começa depois que essa passada termina sem falhas. Os estágios distribuem os cenários entre clientes que iniciam um novo percurso assim que terminam o anterior. Os percursos iniciados dentro da janela podem terminar depois dela. O comando encerra fases restantes quando um estágio atinge dez falhas de cenário e retorna código diferente de zero se houver falha. O JSON permanece fora do cluster descartável. A API e o PostgreSQL são encerrados, e os diretórios de trabalho são removidos ao concluir ou receber `SIGINT` ou `SIGTERM`.

### Configuração

| Variável | Padrão | Uso |
| --- | --- | --- |
| `LOAD_TEST_URL` | `http://127.0.0.1:0` | Origem da API que a suíte vai subir. Use porta `0` para seleção automática ou uma porta livre. Uma rota GET pública e query opcionais concentram os estágios de carga nessa leitura após a passada de cobertura. Use uma consulta que retorne HTTP 200 com as fixtures do lote. |
| `LOAD_TEST_STAGES` | `1,4,8` | Até cinco números estritamente crescentes, entre 1 e 25 clientes por estágio. |
| `LOAD_TEST_DURATION_SECONDS` | `8` | Duração da janela de cada estágio, de 1 a 120 segundos. |
| `LOAD_TEST_MAX_RPS` | `40` | Limite global de início de requisições, de 1 a 100 por segundo, incluindo a passada inicial e a coleta operacional. |
| `LOAD_TEST_TIMEOUT_MS` | `5000` | Tempo limite de cada requisição HTTP, de 100 a 15.000 ms. |
| `LOAD_TEST_PASSWORD` | Gerada por execução | Senha descartável das contas sintéticas. Aceita de 8 caracteres a 72 bytes, com maiúscula, minúscula, dígito e símbolo. |
| `LOAD_TEST_PG_BIN` | Saída de `pg_config --bindir` | Diretório dos binários locais do PostgreSQL. |
| `LOAD_TEST_PG_LOCALE` | `en_US.UTF-8` | Locale instalado para criar o banco descartável. |
| `LOAD_TEST_OUTPUT` | Arquivo `capacidade.json` em diretório temporário novo | Caminho do relatório. |

A linha de comando também aceita `--url=`, `--stages=`, `--duration=`, `--rps=`, `--timeout=` e `--output=`. Uma porta ocupada encerra a execução antes das requisições. A suíte exige o endereço IPv4 literal `127.0.0.1` no alvo e recusa redirecionamentos. A varredura dos roteadores e o relatório usam as rotas da instância que a própria suíte abriu. A única configuração de ambiente aceita é `local`.

Para medir separadamente a consulta anônima e paginada de obras com 1, 4 e 8 clientes, mantendo a passada inicial completa:

```bash
LOAD_TEST_URL='http://127.0.0.1:0/api/public/works?page=1&limit=50' \
LOAD_TEST_STAGES=1,4,8 LOAD_TEST_DURATION_SECONDS=10 npm run load:test:all
```

## Resultados

- `inventory` lista os endpoints e seus cenários. `coverage.endpoints` mostra os exercitados na passada inicial, com seus status HTTP.
- `stages` registra requisições por segundo, tamanho e contagem de itens reconhecíveis no retorno, latência mínima, mediana (`p50`), p95, p99, média, máxima e detalhamento por endpoint. A latência mede a resposta HTTP completa, incluindo leitura e decodificação. O throughput usa a janela efetivamente medida, incluindo a conclusão dos percursos já iniciados. Na medição de uma leitura, `configuration.readPath` registra o caminho concreto e seus parâmetros de consulta. A mistura de rotas pode variar entre estágios. Compare o mesmo endpoint em estágios com amostra suficiente ou use uma URL de leitura específica.
- `statusCodes` mostra a distribuição de status. `expectedClientErrors` inclui 4xx previstos nos contratos. `expectedRateLimited` distingue 429 previstos em cenários sujeitos aos limites nativos. `failedRequests` contabiliza desvios do status esperado, falhas de transporte e erros de leitura. `failures` também registra falhas nas verificações de cenário, como conteúdo incorreto ou requisição ausente.
- `serverMetrics` resume CPU, memória RSS, heap e conexões PostgreSQL coletados pelo endpoint operacional da instância efêmera. `requirements` aparece nas leituras de `/api/public/works` e `/api/public/editions` com `limit=50`. A aprovação dos critérios RNF01, RNF02 e RNF03 requer uma página cheia e um estágio sem falhas HTTP. Violações observadas aparecem como `failed` mesmo em amostras parciais. As medições descrevem a instância local com os dados sintéticos e os serviços simulados.

## Manutenção

Ao registrar uma rota, adicione sua descrição e pelo menos um cenário no módulo correspondente em `scripts/load/`. O runner cruza o inventário com a composição do Express antes das medições e confere as chamadas feitas por cada cenário na passada inicial. Use fixtures exclusivas por percurso mutável e mantenha o membro compartilhado para leituras. Ao declarar que um percurso cobre mais de uma rota, inclua as chaves adicionais em `covers` e passe os status esperados de cada chamada.
