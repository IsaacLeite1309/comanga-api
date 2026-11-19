# Suíte local de carga da API

A suíte exercita os métodos HTTP explicitamente registrados na API, incluindo saúde, catálogo público, acervo, contas e administração. O relatório JSON registra método, rota, autenticação, parâmetros, dependências e cenários para cada registro. O Express responde a `HEAD` implicitamente para rotas `GET` e o middleware de CORS atende preflights `OPTIONS`. A verificação de inventário usa os registros explícitos dos roteadores.

Use `npm run load:test:all` para esta suíte. O comando `npm run load:test` continua disponível para o procedimento de leitura descrito em [Teste de capacidade da API](capacity-test.md).

## Requisitos

- Node.js 22.12 ou posterior, dependências instaladas com `npm ci` e cliente gerado com `npm run prisma:generate`.
- PostgreSQL local com `pg_config`, `initdb`, `pg_ctl` e `createdb`, extensão `pg_trgm` e suporte a UTF-8. Use Windows, macOS ou Linux, com um usuário autorizado a criar processos e diretórios temporários.
- O locale padrão é `en_US.UTF-8`. Em hosts com outro locale UTF-8 instalado, informe-o em `LOAD_TEST_PG_LOCALE`. O banco precisa reconhecer a caixa de caracteres acentuados.

## Execução

```bash
npm run load:test:all
```

No Windows, informe a pasta dos binários caso não esteja no PATH. Exemplo em PowerShell:

```powershell
$env:LOAD_TEST_PG_BIN = 'C:\Program Files\PostgreSQL\18\bin'
npm run load:test:all
```

No Windows, o cluster temporário usa uma porta livre em `127.0.0.1` e uma senha aleatória descartável com autenticação SCRAM. O inicializador confere a senha e a porta do cluster criado antes de abrir a API. O locale padrão é `English_United States.1252`, com banco em UTF-8; informe `LOAD_TEST_PG_LOCALE` se essa localização não estiver disponível. Nos sistemas Unix, a conexão continua restrita ao socket privado. Os dois modos substituem as URLs do banco somente nos processos de teste, sem utilizar o `.env` da API.

O comando compila a API a partir do checkout, cria um cluster PostgreSQL temporário, aplica as migrations e insere fixtures sintéticas. A API fica presa a `127.0.0.1`, com uma porta reservada pelo sistema operacional por padrão. Ela usa as rotas, regras de autenticação, Prisma e processamento de imagem da aplicação. O e-mail, o download da imagem de teste e o armazenamento são simulados dentro do processo. A suíte usa credenciais de teste e guarda a senha, a sessão e os tokens fora do relatório.

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

## Carga sustentada, estresse e operações individuais

Os comandos abaixo complementam `load:test:all`, que continua verificando as 69 rotas e seus contratos. Os novos perfis repetem apenas fluxos de sucesso, com aquecimento separado da medição. O banco e a API continuam descartáveis e isolados. Nenhum desses comandos utiliza a API da Render ou o banco de desenvolvimento.

| Comando | Padrão | Objetivo |
| --- | --- | --- |
| `npm run load:test:sustained` | 8 clientes, 300 segundos, até 100 HTTP/s, navegação combinada | Observar estabilidade por cinco minutos, com métricas em janelas de 30 segundos. |
| `npm run load:test:stress` | 1, 5, 10, 25 e 50 clientes, 60 segundos por estágio, até 500 HTTP/s, pesquisa | Encontrar o primeiro estágio que ultrapassa os critérios configurados. |
| `npm run load:test:operation` | 8 clientes, 60 segundos por operação, até 100 HTTP/s | Medir separadamente as nove operações descritas abaixo. |

Há 10 segundos de aquecimento por operação, fora das métricas medidas. A verificação inicial executa cada cenário uma vez. A preparação dos dados, a compilação e as migrations também ficam fora das medições. Os estágios de uma operação compartilham o mesmo ambiente aquecido.

Operações disponíveis em `--operation=`:

| Nome | Fluxo |
| --- | --- |
| `search` | Pesquisa paginada de obras com termo, exigindo resultado não vazio. |
| `work` | Detalhes de uma obra pública. |
| `edition` | Detalhes de edição e página de volumes. |
| `volume` | Detalhes de um volume. |
| `calendar` | Lançamentos de um mês com dados sintéticos. |
| `collection` | Leitura autenticada da coleção. |
| `wishlist` | Leitura autenticada da lista de desejos. |
| `collection-write` | Adicionar, marcar como lido e remover um volume. Cada cliente tem sua própria conta. |
| `covers` | Importar uma capa sintética de 800 × 1200 e descartá-la. Download e R2 são simulados; Sharp e banco são reais. |
| `browse` | Alternar entre as sete operações de leitura. |
| `all` | Medir as nove operações individualmente, em sequência. |

Exemplos (na pasta da API, com PostgreSQL local configurado):

```powershell
# Estabilidade da pesquisa por dez minutos
npm run load:test:sustained -- --operation=search --duration=600 --output=../output/pesquisa-sustentada.json

# Estresse da coleção, interrompendo no primeiro estágio degradado
npm run load:test:stress -- --operation=collection --stages=1,5,10,25,50 --output=../output/colecao-estresse.json

# Importação de capas, com critério de latência próprio para a operação
npm run load:test:operation -- --operation=covers --duration=120 --p95=1500 --output=../output/capas-capacidade.json
```

Parâmetros adicionais:

| Argumento | Padrão / limite |
| --- | --- |
| `--mode=` | `sustained`, `stress` ou `operation`, definido pelos scripts npm. |
| `--stages=` | Lista crescente de até oito estágios, de 1 a 100 clientes. |
| `--duration=` | Segundos medidos por estágio, de 1 a 1800. |
| `--warmup=` | Segundos de aquecimento por operação, de 0 a 120; padrão 10. |
| `--rps=` | Teto global do gerador, de 1 a 1000 requisições/s. Não é uma taxa garantida. |
| `--timeout=` | Timeout HTTP, de 100 a 30000 ms; padrão 5000. |
| `--p95=` | Limite de latência p95 em ms; padrão 500. |
| `--error-percent=` | Percentual máximo de falhas HTTP; padrão 1. |
| `--min-samples=` | Amostra mínima por endpoint e estágio; padrão 100. |
| `--window=` | Janela de resumo temporal em segundos; padrão 30. |
| `--output=` | Relatório JSON; se omitido, é salvo em uma pasta temporária informada ao concluir. |

O runner aceita somente sua própria API em loopback. Não há `--url=` nesses modos. Variáveis de alvo que indiquem outro servidor são recusadas. O limite de 200 mil amostras por estágio impede crescimento indefinido da memória do gerador; atingir esse limite torna a avaliação inconclusiva. As falhas de cenário interrompem o estágio depois de dez ocorrências, e uma avaliação degradada encerra os próximos estágios daquela operação.

### Como interpretar os novos relatórios

Cada operação tem contratos verificados antes da carga, resultado do aquecimento, métricas por estágio, métricas por endpoint, resumos de CPU/memória/conexões e janelas temporais de latência, vazão e erro. `resourceTimeline` registra a evolução de RSS, heap, contadores cumulativos de CPU e conexões, aproximadamente a cada segundo, para investigar crescimento durante testes sustentados. Crescimento de memória isolado não comprova vazamento. As medições HTTP excluem a espera no limitador do gerador; o throughput reflete a taxa efetivamente realizada. Em percursos com várias chamadas, cada requisição HTTP é contada separadamente. Não interprete HTTP/s como usuários/s ou ciclos completos/s.

`passed` significa que a amostra mínima foi atingida e os critérios configurados foram respeitados. `degraded` indica excesso de erros, latência acima do limite ou falha de contrato; uma janela com amostra suficiente também pode identificar degradação transitória. `inconclusive` indica amostra insuficiente ou interrupção pelo limite de amostras. Códigos de saída: 0 para aprovação, 1 para falha/degradação e 2 para execução inconclusiva.

O resumo informa o maior estágio validado e o primeiro degradado. Não declara capacidade máxima: se todos passarem, o limite não foi encontrado. Refine os estágios próximos da degradação e repita com os mesmos dados, parâmetros e máquina. `harnessRateLimitReached` avisa quando a vazão se aproxima do teto imposto pelo teste. A ausência desse aviso não comprova saturação da API: CPU do gerador, espera entre chamadas e características do sistema operacional também limitam a vazão.

As fixtures possuem 26 obras e oito volumes na edição principal; não representam um catálogo de produção completo. As imagens têm conteúdo sintético simples e não incluem custo de rede ou do R2. API, gerador e banco disputam os recursos da mesma máquina. Os números servem para comparação local reproduzível e identificação de sinais de degradação, sem estimar automaticamente a capacidade da Render/Neon em produção.

Para verificar rapidamente a instalação dos cenários, use uma execução curta. Ela não é um benchmark de capacidade:

```powershell
npm run load:test:operation -- --operation=all --duration=3 --warmup=1 --stages=2 --rps=30 --min-samples=1 --p95=3000
```

## Manutenção dos cenários

Ao registrar uma rota, adicione sua descrição e pelo menos um cenário no módulo correspondente em `scripts/load/`. O runner cruza o inventário com a composição do Express antes das medições e confere as chamadas feitas por cada cenário na passada inicial. Use fixtures exclusivas por percurso mutável e mantenha o membro compartilhado para leituras. Ao declarar que um percurso cobre mais de uma rota, inclua as chaves adicionais em `covers` e passe os status esperados de cada chamada.
