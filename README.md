# CoMangá API

API REST do CoMangá, construída com Node.js, Express, TypeScript, Prisma ORM e PostgreSQL.

## Organização

O backend é um monólito modular. Os fluxos são organizados pelos domínios de autenticação, usuários, opções administrativas, Obras, Edições e Volumes. `src/controllers/adminController.ts` permanece somente como fachada de compatibilidade para as rotas administrativas.

## Contrato de Editoras originais

Obras possuem uma lista ordenada de Editoras originais. Os contratos de cadastro e alteração aceitam exclusivamente `originalPublisherIds`:

```json
{
  "originalPublisherIds": [
    { "id": 10, "position": 0 },
    { "id": 9, "position": 1 }
  ]
}
```

O campo singular legado `originalPublisherId` não faz parte do contrato. As respostas retornam `originalPublishers` na ordem persistida.

## Identidade pública das Obras

Cada Obra possui um `slug` único, normalizado e imutável. No cadastro, colisões recebem sufixos numéricos (`pluto`, `pluto-2`, `pluto-3`). Alterar o título não altera o slug, preservando links já compartilhados.

A consulta administrativa canônica é direta:

```text
GET /api/admin/works/slug/:slug
```

O cliente não precisa listar Obras nem comparar títulos para descobrir um identificador interno.

## Erros

Erros HTTP seguem o formato:

```json
{
  "error": "Mensagem segura para o cliente.",
  "code": "CODIGO_ESTAVEL"
}
```

Falhas inesperadas são registradas no servidor com data, rota, método e identificador da requisição, sem exposição de stack trace ao cliente.

## Infraestrutura substituível

Casos de uso dependem de contratos mínimos, localizados em `src/infrastructure/contracts`:

- `MailService`: usa Nodemailer por meio de `NodemailerMailService`.
- `MediaStorage`: persiste objetos internos no Cloudflare R2 por meio de `R2MediaStorage`, sem acoplar os módulos de catálogo ao SDK do provedor.
- `RateLimitStore`: usa `MemoryRateLimitStore` no limitador de tentativas de login.

Não existem consumidores reais de cache ou despacho assíncrono no MVP. Por isso, `CacheStore` e `TaskDispatcher` serão criados somente quando um caso de uso e métricas justificarem essas dependências. Redis, filas e cache distribuído não fazem parte da implementação atual.

## Capas internas no Cloudflare R2

O catálogo não aceita nem exibe URLs externas como capa. Um administrador informa uma URL HTTPS em `POST /api/admin/media/covers`; a API baixa a imagem com proteção contra SSRF, valida o conteúdo real, remove metadados, gera variantes WebP 2:3 e armazena objetos imutáveis no R2. Obras, Edições e Volumes persistem somente `coverAssetId`; `coverUrl` existe apenas como campo derivado de resposta.

As credenciais do R2 são carregadas somente quando uma operação de mídia é solicitada. Assim, desenvolvimento e testes que não importam capas funcionam antes da criação da conta. A configuração do bucket, domínio público, CORS e variáveis está descrita em `docs/operations/internal-cover-media.md`.

## Operação e capacidade

A API disponibiliza dois health checks independentes:

```text
GET /health/live   # confirma que o processo HTTP está vivo; não consulta o banco
GET /health/ready  # confirma que a aplicação consegue consultar o PostgreSQL
```

O encerramento por `SIGTERM` ou `SIGINT` deixa de aceitar novas conexões, aguarda as requisições HTTP em andamento e desconecta o Prisma. O limite padrão é de 10 segundos e pode ser ajustado com `GRACEFUL_SHUTDOWN_TIMEOUT_MS`.

As requisições recebem `x-request-id` e são registradas em JSON com método, rota, status e duração. Em testes, o log de requisições permanece desativado por padrão; `REQUEST_LOGGING_ENABLED=true` permite habilitá-lo explicitamente.

Para reduzir gravações desnecessárias, `sessions.last_used_at` é atualizado no máximo uma vez a cada cinco minutos por sessão. O intervalo pode ser ajustado com `SESSION_TOUCH_INTERVAL_MS`.

O pool do Prisma recebe defaults conservadores de `connection_limit=5` e `pool_timeout=10` quando esses parâmetros não estiverem presentes em `DATABASE_URL`. É possível alterar os defaults com `PRISMA_CONNECTION_LIMIT` e `PRISMA_POOL_TIMEOUT_SECONDS`; parâmetros explícitos na URL sempre prevalecem.

### Métricas protegidas

Ao configurar `OPS_METRICS_TOKEN`, a rota abaixo passa a expor CPU acumulada do processo, memória e quantidade de conexões PostgreSQL para o teste controlado de capacidade:

```text
GET /health/metrics
Header: x-ops-token: <valor de OPS_METRICS_TOKEN>
```

Sem a variável configurada, a rota responde como inexistente. A chave deve permanecer somente no Render e na máquina que executa o teste.

### Teste progressivo de carga

O teste nunca é executado pelo CI nem possui alvo padrão. O operador deve informar e confirmar explicitamente o host:

```powershell
$env:LOAD_TEST_URL="https://api-de-homologacao.exemplo/api/public/works?page=1&limit=50"
$env:LOAD_TEST_CONFIRM_HOST="api-de-homologacao.exemplo"
$env:LOAD_TEST_METRICS_URL="https://api-de-homologacao.exemplo/health/metrics"
$env:OPS_METRICS_TOKEN="use-o-mesmo-segredo-configurado-no-render"
npm run load:test
```

Por padrão, são executados estágios de 10, 25, 50 e 100 usuários virtuais, com 30 segundos por estágio e teto de 100 usuários. O relatório é salvo em `docs/operations/results/capacity-latest.json` e compara os resultados com RNF01, RNF02 e RNF03.

O procedimento completo, as precauções e o estado das medições estão em `docs/operations/capacity-test.md`.
