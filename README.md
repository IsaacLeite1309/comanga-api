# CoMangá API

API REST do CoMangá, plataforma de catalogação de mangás publicados no Brasil. Ela concentra contas e sessões, perfis de acesso, administração do catálogo (Obra → Edição brasileira → Volume), capas internas e o catálogo público consumido pela [comanga-web](https://github.com/IsaacLeite1309/comanga-web).

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-6-2D3748?logo=prisma&logoColor=white)

## Visão geral

O backend é um **monólito modular** em Node.js, Express 5 e TypeScript, compilado para CommonJS. Ele roda na Render, persiste dados em PostgreSQL hospedado no Neon (com bancos separados para desenvolvimento, testes e deploy) por meio do Prisma e do driver `pg`, grava capas no Cloudflare R2 e envia e-mails de conta pelo Resend.

```text
Navegador ──> Web (Vercel) ──/api──> API REST (Render) ──> PostgreSQL (Neon)
    │                                     ├──> Cloudflare R2 (gravação e remoção de capas)
    │                                     └──> Resend (e-mails de ativação e recuperação)
    └──────────── leitura das capas ────────> domínio público do R2 (MEDIA_PUBLIC_BASE_URL)
```

Em produção, a Web publicada na Vercel repassa `/api/*` para `https://comanga-api.onrender.com/api/*` (`vercel.json` da Web). Para o navegador, a API fica na mesma origem da Web, o que permite o cookie de sessão `SameSite=Strict`.

## Módulos e fronteiras

O código de domínio fica em `src/modules`. Cada módulo expõe sua API pública em `index.ts`; rotas e outros módulos só podem importar essa entrada.

| Módulo | Responsabilidade | Pode importar |
| --- | --- | --- |
| `auth` | Cadastro, ativação, login/logout, sessão, recuperação de senha, perfis, autorização e limitadores de tentativas | — |
| `users` | Dados da própria conta: perfil, preferência de conteúdo adulto, perfil ativo, nome de usuário, senha e exclusão | `auth` |
| `catalog` | Administração de Obras, Edições e Volumes, validações editoriais e visibilidade | `media` |
| `media` | Importação, associação, descarte e remoção de capas internas | — |
| `admin/users` | Listagem de contas e concessão/remoção do perfil Administrador | `auth` |
| `admin/options` | Opções de domínio (autores, editoras, classificações etc.) e opções dos formulários administrativos | `catalog` |
| `public-catalog` | Consultas públicas, filtros, detalhes e política de conteúdo adulto | — |

Além dos módulos, há duas camadas:

- **Composição** (`src/routes`, `src/middlewares`, `src/app.ts`, `src/server.ts`, `src/commands`): monta as rotas e pode usar qualquer entrada pública de módulo.
- **Base compartilhada** (`src/infrastructure`, `src/database`, `src/prisma.ts`, `src/errors`, `src/utils`, `src/types`): adaptadores e utilitários. A infraestrutura inclui banco, log estruturado, e-mail (Resend), mídia (R2, download remoto e processamento com Sharp), limitação de tentativas em memória (`MemoryRateLimitStore`) e operação (health checks e encerramento gracioso). Ela não importa módulos de domínio.

O PostgreSQL e o Prisma Client são compartilhados; módulos usam Prisma diretamente quando isso é suficiente.

As regras são verificadas pelo ESLint (`eslint.config.js`) com `eslint-plugin-boundaries` e `eslint-plugin-import-x`:

- todo arquivo de produção precisa pertencer a um módulo, à composição ou à base compartilhada;
- imports entre módulos só pela entrada `index.ts` e só nas dependências declaradas acima;
- ciclos de import, imports não resolvidos e imports de testes em código de produção são recusados;
- `require()`, `module.require()`, `require.resolve()` e `import()` com caminho calculado são recusados;
- complexidade ciclomática máxima 15, profundidade de blocos 4 e 80 linhas por função (sem contar linhas vazias e comentários). Testes e arquivos gerados (`*.generated.*`, `src/generated/`) ficam isentos apenas do limite de linhas.

`npm run test:architecture` executa `scripts/eslint-architecture.test.cjs`, que roda o ESLint real em projetos temporários para garantir que essas regras continuam recusando o que devem recusar.

## Funcionalidades

As regras de negócio (RF, RN e RNF) ficam no SERS do repositório [comanga-docs](https://github.com/IsaacLeite1309/comanga-docs), na pasta `01-SERS/`. Esta seção descreve só o que é próprio da API; os IDs citados são do SERS.

### Contas e autenticação

Regras de cadastro, ativação, reenvio, login, logout, recuperação, alteração de nome e senha e exclusão: SERS RF0001 a RF0012, RN0001 a RN0022, RN0063 e RN0073.

- **Ativação**: `GET /api/auth/activate/:token`. O link enviado aponta para `FRONTEND_URL/activate/<token>`.
- **Login**: contas `Pendente` ou `Bloqueada` recebem 403.
- **Recuperação de senha**: `forgot-password` responde antes de consultar a conta ou o provedor. O token fica armazenado como hash SHA-256. O intervalo entre emissões está em [Limites de tentativas](#limites-de-tentativas). O link aponta para `FRONTEND_URL/redefinir-senha/<token>`.

As validações de conta ficam em `src/modules/auth/accountRules.ts` (regras: SERS RN0001, RN0002). A data de nascimento usa o formato `AAAA-MM-DD`, e a maioridade é calculada em UTC. A senha tem no máximo 72 bytes em UTF-8, limite do bcrypt (SERS RNF05). Contas antigas sem data de nascimento continuam válidas, mas não podem habilitar conteúdo adulto.

E-mails são enviados pela [API HTTPS do Resend](https://resend.com/docs/api-reference/emails/send-email) com `fetch` e limite de 10 segundos por envio. Não há fila persistente nem nova tentativa automática: se o envio falhar, a pessoa precisa pedir de novo (respeitando o intervalo de 60 segundos da recuperação). O remetente em `RESEND_FROM` precisa pertencer a um [domínio verificado](https://resend.com/docs/dashboard/domains/introduction). Os testes automatizados simulam o provedor e não comprovam entrega real.

### Sessão

- A sessão é **stateful**: o token opaco aleatório vai em cookie `HttpOnly` (nome padrão `comanga_session`, `SameSite=Strict`, `Path=/`) e o banco guarda apenas seu hash SHA-256 na tabela `sessions`.
- O cookie é `Secure` quando `COOKIE_SECURE=true`, ou, sem essa variável, em `NODE_ENV=production` ou atrás de proxy HTTPS (`X-Forwarded-Proto: https`).
- O cookie não define `Max-Age`. `last_used_at` é atualizado no máximo a cada `SESSION_TOUCH_INTERVAL_MS` (padrão de 5 minutos), mas não há expiração por inatividade.
- Uma sessão de conta que deixou de estar `Ativada` recebe 403 nas rotas autenticadas.

Regras de validade e revogação: SERS RN0014 e RNF06. A expiração por tempo é planejada (RNF17).

### Perfis e autorização

Os **perfis concedidos** ficam em `user_profiles`, o **perfil preferido** em `users.preferred_profile_id` e o **perfil ativo** em `sessions.active_profile_id`. A coluna legada `users.nivel_acesso` é mantida sincronizada por compatibilidade; a autorização não depende dela. Definições e regras: SERS RN0062 a RN0064, RF0035 e RF0052.

- Login e `GET /api/auth/me` devolvem `profiles`, `active_profile` e `role`; o campo `role` permanece por compatibilidade e repete o perfil ativo. `GET /api/users/me` devolve `profiles` e `active_profile`, sem `role`.
- A proteção do último Administrador usa lock transacional, para valer em operações concorrentes.

### Conteúdo adulto

A política de leitura fica em `src/modules/public-catalog/adultContentPolicy.ts` e vale para todas as consultas públicas, inclusive as opções de filtro. Sessão inválida ou de conta não `Ativada` é tratada como visitante. `GET /api/users/me` informa `can_enable_adult_content`. Regras (quem vê, exceção do Administrador, Hentai): SERS RN0048 e RN0067.

### Administração do catálogo

**Opções de domínio.** Categorias gerenciadas pelo Administrador em `/api/admin/options`: `autores`, `editoras-originais`, `revistas-serializacao`, `editoras-brasileiras`, `tipos-capa` (acabamento), `formatos-fisicos` e `miolos`. A categoria `paises-origem` é apenas listável. Valores inativos só aparecem com `includeInactive`. Ativar e desativar valores existe só na API. Regras: SERS RF0030 a RF0033, RN0043 e RN0044.

**Classificações controladas.** Tipos de obra e gêneros são valores fixos (`src/utils/domainOptionCodes.ts`). Criar, renomear, excluir ou alterar dependências desses valores retorna 403. A API ainda aceita alterar `active` deles pelo `PATCH /api/admin/options/:id`; esse comportamento é residual e deve ser removido. Regras (ordem oficial, países compatíveis): SERS RN0024 e RN0066.

**Obra.** Campos principais: `title`, `originalTitle` (opcional), `romanizedTitle`, `synopsis`, anos de início e fim da publicação original, `directRelease`, `typeId`, `country`, `originalPublicationStatus`, `coverAssetId`, `adultContent`, autores com papéis, gêneros, demografias, revistas de serialização e editoras originais. Autores seguem a ordem do array recebido; editoras e revistas seguem a `position` informada ou, sem ela, a ordem do array. Regras (slug, duplicidade, autoria, posições, lançamento direto, Hentai, visibilidade e exclusão): SERS RN0023 a RN0030, RN0067 e RN0068.

**Edição.** Obrigatórios: `chronologicalNumber`, editora brasileira e status de publicação no Brasil. `coverTypeId` e `formatId` aceitam `null` quando desconhecidos. `paperIds` é uma lista de até 50 identificadores distintos de miolos ativos, em ordem; `[]` representa nenhum miolo informado. No cadastro, as três chaves precisam estar presentes. No PATCH, omitir `paperIds` preserva os vínculos, enviar uma lista os substitui e `[]` os remove. As respostas usam `papers`, sem valores inventados. Regras (capa derivada, publicação e exclusão): SERS RN0031 a RN0037, RN0040 e RN0069.

**Volume.** Campos: `number`, capa, `singleVolume`, páginas, preço e moeda, data de lançamento com precisão, ISBN-10, ISBN-13, link de afiliado e sinopse. O Volume não tem rota própria de visibilidade. Regras: SERS RN0038 a RN0041 e RN0069.

**Capas no catálogo.** Obra e Volume exigem uma capa interna distinta. No PATCH, omitir `coverAssetId` preserva a capa atual e `null` é recusado. A capa substituída ou desvinculada entra em descarte. Detalhes em [operação das capas internas](docs/operations/internal-cover-media.md).

As alterações que afetam publicação, capas e Volumes são serializadas por um lock transacional compartilhado com os gatilhos de mídia do PostgreSQL.

### Capas internas

Resumo (detalhes no [documento operacional](docs/operations/internal-cover-media.md); regras: SERS RF0050, RN0058 a RN0061):

- **Importação remota genérica**: o Administrador informa uma URL HTTPS pública. Não há regra por site ou provedor. A API recusa `localhost` e endereços não públicos, revalida cada redirecionamento (até 3) e aplica limites de bytes, pixels e tempo.
- **Processamento** com Sharp: JPG, PNG, WebP ou AVIF de entrada, orientação corrigida, corte 2:3 e saídas WebP sem metadados (1200×1800, 640×960 e 320×480).
- **Armazenamento** no R2 com chaves imutáveis `covers/{uuid}/...`; o banco guarda só metadados.
- **URL pública** derivada de `MEDIA_PUBLIC_BASE_URL`; a URL de origem nunca é devolvida.
- **Limpeza**: capas desvinculadas passam a `Descartando` e são removidas na requisição ou depois, por `npm run media:cleanup`.

### Catálogo público

Todas as rotas públicas aceitam visitante e, com cookie válido, aplicam a política de conteúdo adulto. As respostas usam `Cache-Control: private, no-store` e `Vary: Cookie`. Regras de busca, filtros, visibilidade e contagem de Volumes: SERS RF0036, RF0037, RF0051, RN0046, RN0047 e RN0051.

- Registro privado em qualquer nível da hierarquia responde 404, sem informar qual nível é privado ou restrito.
- Listagens de Obras e de Edições paginadas (padrão de 12, máximo de 50 itens por página).
- `GET /api/public/catalog-options` devolve as opções ativas dos filtros, incluindo os países compatíveis com cada tipo de obra.

**Detalhes de Edição.** Incluem editora brasileira, formato, acabamento, **miolos** (`papers`, lista ordenada), status, capa derivada, contagem de Volumes públicos, a Obra (id, `slug`, títulos e autores) e a lista paginada de Volumes públicos.

**Detalhes de Volume** (`GET /api/public/volumes/:volumeId`). A resposta é contextual: além dos dados do Volume, traz a Edição (id, número, editora brasileira) e a Obra (id, `slug` e títulos), para que a Web monte a URL `/obras/:slug/edicao/:editionId/volume/:volumeId` e a navegação.

```json
{
  "volume": {
    "id": 42,
    "number": 2,
    "singleVolume": false,
    "coverUrl": "https://midia.exemplo.test/covers/<uuid>/large.webp",
    "previousVolume": { "id": 41, "number": 1, "singleVolume": false },
    "nextVolume": null,
    "edition": {
      "id": 7,
      "chronologicalNumber": 1,
      "brazilianPublisher": { "id": 3, "label": "Editora Exemplo" },
      "work": { "id": 5, "slug": "obra-exemplo", "title": "Obra Exemplo", "originalTitle": null }
    }
  }
}
```

(Exemplo reduzido; a resposta também traz páginas, preço, data de lançamento, ISBNs, link de afiliado e sinopse do Volume.)

- `previousVolume` e `nextVolume` são `null` quando não há Volume público anterior ou seguinte na mesma Edição (regra: SERS RN0070).
- O detalhe de Volume não retorna miolos. Eles são consultados no detalhe da Edição, em `papers` (`[]` quando não informados).

## Rotas

Rotas administrativas (`/api/admin/*`) exigem cookie de sessão válido, perfil ativo Administrador e a atribuição vigente desse perfil; sem isso, respondem 403 (SERS RN0064). As rotas de `/api/users` e o `logout` exigem sessão válida.

| Método e caminho | Acesso | Finalidade |
| --- | --- | --- |
| `GET /health/live` | Público | Processo HTTP ativo, sem consultar o banco |
| `GET /health/ready` | Público | Conectividade com o PostgreSQL (503 se indisponível) |
| `GET /health/metrics` | Cabeçalho `x-ops-token` | CPU, memória e conexões do banco; 404 sem `OPS_METRICS_TOKEN` configurado |
| `GET /ping` | Público | Verificação legada de API e banco |

**Autenticação (`/api/auth`)**

| Método e caminho | Finalidade |
| --- | --- |
| `POST /register` | Cadastro (`username`, `email`, `birthDate`, `password`, `confirmPassword`) |
| `GET /activate/:token` | Ativação da conta |
| `POST /resend-activation` | Novo link de ativação (`email`) |
| `POST /login` | Login (`email`, `password`) e criação do cookie de sessão |
| `POST /logout` | Revogação da sessão atual |
| `GET /me` | Resumo da sessão: id, nome, e-mail, preferência adulta, perfis e perfil ativo |
| `POST /forgot-password` | Pedido de recuperação (`email`), com resposta neutra |
| `POST /reset-password` | Redefinição (`token`, `password`, `confirmPassword`) |

**Conta autenticada (`/api/users`)**

| Método e caminho | Finalidade |
| --- | --- |
| `GET /me` | Perfil da própria conta |
| `PATCH /me/adult-content` | Preferência `conteudo_adulto` (exige maioridade para habilitar) |
| `PATCH /me/active-profile` | Troca do perfil ativo (`profile`) |
| `PATCH /me/username` | Novo nome de usuário |
| `PATCH /me/password` | Alteração de senha (`currentPassword`, `newPassword`, `confirmPassword`) |
| `DELETE /me` | Exclusão da conta (`currentPassword`) |

**Administração (`/api/admin`)**

| Método e caminho | Finalidade |
| --- | --- |
| `GET /users` | Contas com filtros (`term`, `role`, `status`, `order`, `page`, `limit`) |
| `PATCH /users/:id/role` | Concede ou remove o perfil Administrador de outra conta |
| `GET /options/:category` | Valores de uma categoria (`term`, `dependsOn`, `includeInactive`, paginação) |
| `POST /options` | Novo valor em categoria não controlada (aceita vários separados por vírgula, exceto em formatos) |
| `PATCH /options/:id` | Rótulo, dependências de país ou `active` de valor não controlado (em tipos de obra e gêneros, a API ainda aceita só `active`, de forma residual) |
| `DELETE /options/:id` | Exclusão de valor não controlado e sem vínculo |
| `POST /media/covers` | Importação de capa por URL (`sourceUrl`) |
| `DELETE /media/covers/:assetId` | Remoção de capa ainda não associada, importada pela própria conta |
| `GET /works/form-options`, `GET /editions/form-options` | Opções ativas dos formulários de Obra e de Edição (a de Edição inclui `papers`) |
| `GET /works`, `POST /works` | Listagem e criação de Obras |
| `GET /works/slug/:slug`, `GET /works/:id` | Detalhe administrativo da Obra |
| `PATCH /works/:id`, `DELETE /works/:id`, `PATCH /works/:id/visibility` | Edição, exclusão e visibilidade da Obra |
| `GET /works/:workId/editions`, `POST /works/:workId/editions` | Edições de uma Obra |
| `GET /editions/:id`, `PATCH /editions/:id`, `DELETE /editions/:id`, `PATCH /editions/:id/visibility` | Manutenção da Edição |
| `GET /editions/:editionId/volumes`, `POST /editions/:editionId/volumes` | Volumes de uma Edição |
| `GET /volumes/:id`, `PATCH /volumes/:id`, `DELETE /volumes/:id` | Manutenção do Volume |

**Catálogo público (`/api/public`)**

| Método e caminho | Finalidade |
| --- | --- |
| `GET /catalog-options` | Opções dos filtros públicos |
| `GET /works` | Vitrine de Obras |
| `GET /works/:slug` | Detalhes da Obra, com Edições públicas e prévia de Volumes |
| `GET /authors/:authorId/works` | Obras públicas de um autor |
| `GET /editions` | Vitrine de Edições |
| `GET /editions/:editionId` | Detalhes da Edição e Volumes públicos paginados |
| `GET /volumes/:volumeId` | Detalhes contextuais do Volume, com anterior e seguinte |

Os identificadores de Edição e Volume são numéricos na API; a Web sempre os usa dentro do contexto da Obra e da Edição. O contrato completo está nas rotas (`src/routes`), nos schemas Zod e nos testes.

### Erros

Os erros retornam `error` com uma mensagem segura para o cliente. O tratamento centralizado e parte das rotas também devolvem `code` estável (por exemplo, `LOGIN_RATE_LIMITED`, `MEDIA_TOO_LARGE`, `ROUTE_NOT_FOUND`); validações de formulário podem trazer `field`. Nem todas as respostas de erro têm `code`. Erros 5xx nunca expõem detalhes internos.

```json
{
  "error": "Mensagem segura para o cliente.",
  "code": "CODIGO_ESTAVEL"
}
```

### Limites de tentativas

| Alvo | Regra | Resposta |
| --- | --- | --- |
| `POST /api/auth/login` | 5 falhas de credencial (HTTP 401) por IP em 5 minutos; um login bem-sucedido zera a contagem | 429 `LOGIN_RATE_LIMITED` |
| `PATCH /api/users/me/password` | 5 falhas de senha atual por conta em 5 minutos | 429 `PASSWORD_CHANGE_RATE_LIMITED` |
| `POST /api/auth/forgot-password` e `POST /api/auth/reset-password` | 5 pedidos por IP em 15 minutos, contados separadamente em cada rota | 429 `RECOVERY_RATE_LIMITED` com `Retry-After: 900` |
| Emissão de token de recuperação | 1 por conta a cada 60 segundos, contado no banco, inclusive após consumo ou falha de envio | Mesma resposta neutra |

Os três primeiros limites ficam em memória: zeram quando o processo reinicia e não são compartilhados entre instâncias. O IP vem de `req.ip`, com `trust proxy` configurado para um salto.

## Variáveis de ambiente

Configure-as no `.env` local (a partir de `.env.example`) ou no painel da plataforma. Nunca versione valores reais.

| Variável | Uso | Padrão no código |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL da aplicação (Prisma e `pg`) e das migrations | obrigatória |
| `DATABASE_URL_TEST` | Banco exclusivo dos testes de integração | obrigatória para testes com banco |
| `DIRECT_URL` | Não é lida pela aplicação nem pelo Prisma; se existir, a proteção dos testes garante que o banco de teste seja diferente dela | — |
| `DATABASE_SSL` | `true`/`false` força o SSL do pool `pg` | SSL ligado exceto em `localhost`/`127.0.0.1` |
| `PG_POOL_MAX`, `PG_POOL_CONNECTION_TIMEOUT_MS`, `PG_POOL_IDLE_TIMEOUT_MS` | Pool do driver `pg` | `5`, `10000`, `10000` |
| `PRISMA_CONNECTION_LIMIT`, `PRISMA_POOL_TIMEOUT_SECONDS` | Acrescentados à `DATABASE_URL` do Prisma quando ela não os define | `5`, `10` |
| `PORT` | Porta HTTP | `3000` |
| `NODE_ENV` | `production` liga o cookie `Secure`; `test` desliga o log de requisições e faz o pool `pg` usar `DATABASE_URL_TEST` | — |
| `CORS_ORIGIN` | Origens permitidas, separadas por vírgula | `http://localhost:8080` |
| `FRONTEND_URL` | Base dos links enviados por e-mail | primeira origem de `CORS_ORIGIN` |
| `SESSION_COOKIE_NAME` | Nome do cookie de sessão | `comanga_session` |
| `COOKIE_SECURE` | `true`/`false` força o atributo `Secure` | automático (ver [Sessão](#sessão)) |
| `COOKIE_SAME_SITE` | Atributo `SameSite` do cookie | `strict` |
| `SESSION_TOUCH_INTERVAL_MS` | Intervalo mínimo de atualização de `last_used_at` | `300000` |
| `RESEND_API_KEY`, `RESEND_FROM` | Envio de e-mails; sem elas o envio falha com `EMAIL_NOT_CONFIGURED` | — |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Gravação e remoção de capas; sem elas a importação responde 503 `MEDIA_PROVIDER_NOT_CONFIGURED` | — |
| `MEDIA_PUBLIC_BASE_URL` | Origem pública HTTPS das capas; necessária para qualquer resposta que traga `coverUrl` | — |
| `MEDIA_MAX_SOURCE_BYTES` | Tamanho máximo da imagem de origem | `10485760` (10 MiB) |
| `MEDIA_MAX_SOURCE_PIXELS` | Máximo de pixels da imagem de origem | `40000000` |
| `MEDIA_DOWNLOAD_TIMEOUT_MS` | Tempo máximo de cada requisição de download | `10000` |
| `OPS_METRICS_TOKEN` | Libera `GET /health/metrics` | rota desativada |
| `REQUEST_LOGGING_ENABLED` | `true` liga o log de requisições também em `NODE_ENV=test` | — |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | Prazo do encerramento gracioso | `10000` |

As variáveis `LOAD_TEST_*` são lidas só pelo teste de capacidade (ver [capacity-test.md](docs/operations/capacity-test.md)). As credenciais do R2 e do Resend ficam apenas no backend, nunca na Vercel nem em variáveis `VITE_*`.

## Configuração local

Requisitos: Node.js 22.12 ou superior e um PostgreSQL de desenvolvimento. Credenciais do Resend e do R2 só são necessárias para enviar e-mails e importar ou remover capas.

1. Instale as dependências do lockfile:

   ```bash
   npm ci
   ```

2. Copie `.env.example` para `.env` e preencha os valores. Use exclusivamente o banco de desenvolvimento.

3. Gere o Prisma Client e aplique as migrations no banco de desenvolvimento:

   ```bash
   npm run prisma:generate
   npm run migrate
   ```

   Use `npm run migrate:dev` só quando for criar uma migration nova.

4. Inicie a API em modo de observação:

   ```bash
   npm run dev
   ```

A API escuta em `http://localhost:3000`. A Web local roda em `http://localhost:8080` e repassa `/api` para `http://localhost:3000` pelo proxy do Vite, então basta deixar `CORS_ORIGIN` e `FRONTEND_URL` em `http://localhost:8080`.

## Comandos

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | API em desenvolvimento com recarga (`tsx watch`) |
| `npm run build` | Compila TypeScript para `dist` |
| `npm start` | Executa `dist/src/server.js` |
| `npm run prisma:generate` | Gera o Prisma Client a partir de `prisma/schema.prisma` |
| `npm run migrate:dev` | `prisma migrate dev`: cria e aplica migrations no banco de desenvolvimento |
| `npm run migrate` | `prisma migrate deploy`: aplica migrations versionadas pendentes |
| `npm run migrate:test` | `prisma migrate deploy` no banco de `DATABASE_URL_TEST`, após validar o nome |
| `npm test` | Todos os testes Jest (unitários e de integração), exige banco de teste |
| `npm run test:unit` | Apenas `*.unit.test.js`, sem banco nem credenciais |
| `npm run test:coverage` | Todos os testes com cobertura |
| `npm run test:coverage:unit` | Testes unitários com cobertura |
| `npm run test:architecture` | Regressões da configuração arquitetural do ESLint |
| `npm run lint` | ESLint sem avisos, incluindo fronteiras, ciclos e limites de complexidade |
| `npm run check` | `lint` + `test:architecture` + `build` + `test:coverage:unit` |
| `npm run check:integration` | `lint` + `test:architecture` + `migrate:test` + `test:coverage` |
| `npm run check:online` | `npm audit` de todas as dependências |
| `npm run check:covers` | Verificação somente de leitura da consistência das capas no banco |
| `npm run media:cleanup` | Compila e processa até 20 capas em `Descartando` |
| `npm run load:test` | Teste de capacidade com host confirmado explicitamente |

## Banco de dados e migrations

O schema está em `prisma/schema.prisma` e o histórico versionado em `prisma/migrations/`. Toda mudança de schema é uma migration nova; nunca altere uma migration já aplicada e não use `prisma db push` nem `prisma migrate reset` em bancos com dados a preservar.

Os três comandos têm papéis diferentes:

- **`npm run prisma:generate`** gera o Prisma Client. Não toca no banco. Rode após instalar dependências e sempre que o schema mudar.
- **`npm run migrate:dev`** (`prisma migrate dev`) é só para o banco de desenvolvimento: cria uma nova migration a partir do schema e a aplica.
- **`npm run migrate`** (`prisma migrate deploy`) aplica, sem criar nada, as migrations versionadas ainda pendentes. É o comando de testes (via `migrate:test`) e de deploy.

Antes de testar uma implementação que traz migration nova, aplique-a no banco usado. Se a entrega não criou migration, não há nada a aplicar.

Algumas migrations recusam a aplicação quando os dados não atendem às novas restrições, em vez de apagar ou inventar registros. Antes de aplicá-las em um banco existente, rode `npm run check:covers` e corrija o que ele apontar. Exemplos:

- `20260909231000_required_atomic_covers` falha se houver registro sem capa;
- `20260909232000_validate_existing_cover_links` falha se uma capa estiver ligada a mais de um registro ou em descarte;
- `20260920122000_derive_edition_cover_from_first_volume` falha se houver Edição pública sem Volume 1 com capa.

Transformações de dados nas migrations (somente o que está nos SQLs):

| Migration | Efeito nos dados existentes |
| --- | --- |
| `20260920120000_perfis_de_acesso` | Cria os perfis Usuário Padrão e Administrador; toda conta recebe Usuário Padrão e contas com `nivel_acesso = 'Administrador'` recebem também Administrador; preenche o perfil preferido e o perfil ativo das sessões abertas, sem revogá-las; cria gatilho que mantém perfis e `nivel_acesso` sincronizados. |
| `20260920121000_work_metadata_and_author_positions` | Preenche `romanized_title` e `synopsis` com o título da Obra (valor provisório que exige revisão editorial); posiciona autores em ordem alfabética, exceto em Obras que já tinham posições definidas. |
| `20260920122000_derive_edition_cover_from_first_volume` | Remove `editions.cover_asset_id`; capas que ficaram sem vínculo passam a `Descartando`, sem apagar objetos do R2. O SQL descreve o rollback operacional, que depende de backup. |
| `20260922000000_add_edition_paper` e `20260922001000_make_edition_metadata_optional` | Criam a categoria `miolos` com o valor `Papel`; o preenchimento provisório das Edições existentes é desfeito em seguida, e acabamento, formato e miolo passam a aceitar nulo. |
| `20260922120000_simplify_catalog_metadata` | Remove de forma destrutiva `editions.edition_type_id`, `works.original_volume_count` e a categoria `tipos-edicao` com seus valores e dependências. |
| `20260922121000_controlled_catalog_classifications` | Marca tipos de obra e gêneros oficiais como controlados, preservando ids existentes e criando os ausentes; define a ordem; remove dependências tipo→país fora da tabela oficial; marca como adultas as Obras com Hentai; apenas relata valores legados sem correspondência. |
| `20260923120000_edition_multiple_papers` | Cria `edition_papers`, copia cada `editions.paper_id` não nulo para um vínculo com posição 0 e remove a coluna antiga. A Edição passa a ter uma lista ordenada de miolos. |
| `20260922130000_protect_legacy_adult_genres` | Marca gêneros legados equivalentes a Hentai como exclusivamente adultos e marca como adultas as Obras associadas a eles. |

Outras migrations também normalizam dados de domínio; consulte o SQL de cada uma antes de aplicá-las em um banco com dados reais. Faça backup antes de aplicar migrations destrutivas em ambientes compartilhados.

## Testes e qualidade

| Tipo | Como rodar | O que cobre |
| --- | --- | --- |
| Unitários | `npm run test:unit` | Arquivos `__tests__/**/*.unit.test.js`: regras, handlers com dependências simuladas, contratos de infraestrutura (R2, Resend, download, Sharp), mappers e scripts. Recebem uma URL de banco falsa e nunca acessam banco real. |
| Integração | `npm test` | Os demais `__tests__/**/*.test.js`, com Supertest e PostgreSQL real: rotas, autorização, migrations, gatilhos, concorrência, índices e planos de consulta, além de comparar o schema Prisma com o banco. |
| Arquitetura | `npm run test:architecture` | Regras de fronteira e manutenção do ESLint (`node --test`). |
| Cobertura | `npm run test:coverage:unit` ou `npm run test:coverage` | Mínimo global de 80% em linhas, instruções, funções e ramos (`jest.config.js`). |
| Lint e build | `npm run lint`, `npm run build` | Estilo, fronteiras e compilação TypeScript estrita. |
| Capacidade | `npm run load:test` | Carga progressiva contra ambiente autorizado; não faz parte dos checks. Ver [capacity-test.md](docs/operations/capacity-test.md). |

Os testes com banco exigem `DATABASE_URL_TEST` apontando para um banco exclusivo cujo nome seja `test`, comece com `test_` ou termine em `_test`, diferente de `DATABASE_URL` e `DIRECT_URL`. Aplique as migrations antes com `npm run migrate:test`. Os testes criam e apagam os próprios registros; nunca use dados reais.

A validação usada no projeto é local:

- `npm run check` antes de enviar mudanças (não precisa de banco);
- `npm run check:integration` quando houver banco de teste disponível e sempre que a mudança tocar schema, migrations, consultas ou rotas.

O repositório não tem hooks de Git configurados: esses comandos são executados manualmente.

`.github/workflows/quality.yml` descreve um pipeline com PostgreSQL 16 e Node 22 (auditoria, `prisma:generate`, lint, build e `check:integration`), mas o GitHub Actions da conta está bloqueado por cobrança. Ausência de execução remota não é aprovação nem reprovação; não trate o workflow como evidência de CI.

Os overrides de `package.json` (`deepmerge-ts` em `@prisma/config` e `test-exclude`) corrigem alertas de dependências sem rebaixar o Prisma nem o Jest. Ao atualizar dependências, confira geração do Prisma Client, migrations e cobertura.

## Operação

- Logs estruturados em JSON com `requestId` (cabeçalho `x-request-id`, recebido ou gerado), método, template da rota, status e duração. URLs com query, tokens e corpos não são registrados.
- Eventos de mídia (`media.cover_import.completed`, `media.cover_import.failed`, `media.orphan_cleanup_failed`) permitem acompanhar capas sem expor a URL de origem.
- Em `SIGTERM`/`SIGINT`, o servidor para de aceitar conexões, aguarda as requisições em andamento e desconecta o Prisma; após `GRACEFUL_SHUTDOWN_TIMEOUT_MS`, encerra à força.
- Índices PostgreSQL, incluindo trigramas (`pg_trgm`), apoiam busca e filtros; testes de integração verificam sua existência e planos de consulta relevantes.
- Procedimentos operacionais: [capas internas](docs/operations/internal-cover-media.md), [teste de capacidade](docs/operations/capacity-test.md) e [checklist de revisão de qualidade](docs/operations/revisao-qualidade.md). A avaliação do Cloudinary é apenas [registro histórico](docs/decisions/cloudinary-poc.md).

## Deploy

A API é publicada na Render (`comanga-api.onrender.com`), com o banco de deploy no Neon. Os comandos de build e start ficam configurados no painel da Render, não no repositório. A sequência necessária é:

```bash
npm ci
npm run prisma:generate
npm run migrate      # prisma migrate deploy no banco de destino
npm run build
npm start
```

Configure no painel, sem versionar: `NODE_ENV=production`, `DATABASE_URL`, `CORS_ORIGIN` e `FRONTEND_URL` com a origem pública da Web, `RESEND_API_KEY`, `RESEND_FROM`, as variáveis `R2_*` e `MEDIA_*` e, se for medir capacidade, `OPS_METRICS_TOKEN`.

Antes de aplicar migrations que validam dados existentes, rode `npm run check:covers` no banco de destino. Depois de deploys que desvinculam capas, rode `npm run media:cleanup` no ambiente autorizado (o comando compila o projeto, então precisa das dependências de desenvolvimento). A entrega real de e-mails e o acesso ao domínio público do R2 só são comprovados no ambiente publicado.

## Fora do escopo desta API

Coleção pessoal, checklist e lista de desejos não têm rotas nesta API; a Web exibe apenas telas "Em breve" para elas (planejados no SERS: RF0042 a RF0049). Planos e critérios de aceite ficam no repositório [comanga-docs](https://github.com/IsaacLeite1309/comanga-docs).

## Repositórios relacionados

- [comanga-web](https://github.com/IsaacLeite1309/comanga-web): SPA React publicada na Vercel.
- [comanga-docs](https://github.com/IsaacLeite1309/comanga-docs): requisitos, cenários, arquitetura e diagramas.
