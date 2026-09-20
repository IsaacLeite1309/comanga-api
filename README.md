# CoMangá API

API REST do CoMangá, plataforma para catalogação e gerenciamento de coleções físicas de mangás. A aplicação centraliza autenticação, administração do catálogo, importação de capas e a experiência pública de consulta.

![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5%2B-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma&logoColor=white)

## Visão geral

O backend é um **monólito modular** construído com Node.js, Express e TypeScript. Ele é publicado na Render, persiste dados no PostgreSQL do Neon por meio do Prisma e armazena capas internas no Cloudflare R2.

```text
Frontend React/Vercel -> API REST/Render -> Prisma -> PostgreSQL/Neon
                                         -> Cloudflare R2 (capas)
                                         -> Resend HTTPS (e-mails de conta)
```

O código é organizado por domínio em `src/modules`, com módulos de autenticação, usuários, catálogo, administração e catálogo público. A aplicação se inspira em Clean Architecture e Ports and Adapters de forma pragmática; módulos existentes ainda usam Prisma diretamente quando isso é adequado ao estágio atual do projeto.

### Fronteiras dos módulos

Cada domínio possui uma API pública em `index.ts`: `auth`, `users`, `catalog`, `media`, `admin/users`, `admin/options` e `public-catalog`. Rotas e outros domínios consomem somente essas entradas; os handlers são exportados diretamente, sem controllers intermediários. Implementações, schemas, consultas e mapeadores pertencem ao domínio correspondente.

As dependências entre domínios são explícitas em `eslint.config.js`. O catálogo consome a API de mídia, usuários consomem os contratos de autenticação, e opções administrativas consomem os contratos de catálogo. A infraestrutura fornece os adapters e não importa os módulos; os serviços são compostos dentro dos próprios domínios. O banco PostgreSQL e o Prisma Client permanecem compartilhados, com transações e contratos HTTP preservados.

`npm run lint` verifica as fronteiras com `eslint-plugin-boundaries`, ciclos e resolução de imports com `eslint-plugin-import-x` e o resolver TypeScript. Todo arquivo de produção deve pertencer a um domínio, à composição ou à base compartilhada; arquivos sem classificação e imports de testes são recusados. Imports entre domínios entram somente por `index.ts`. O código de produção usa a sintaxe `import` do TypeScript (compilada para CommonJS na API); `require()`, `module.require()`, `require.resolve()` e caminhos dinâmicos calculados são recusados para manter a detecção de ciclos verificável.

O ESLint também limita a complexidade ciclomática a 15, a profundidade de blocos a 4 e cada função a 80 linhas de código, sempre como erro. Comentários e linhas vazias não entram na contagem. Apenas testes (`*.test.*`, `*.spec.*`, `__tests__`) e arquivos gerados (`*.generated.*`, `src/generated/`) têm exceção de tamanho; complexidade e profundidade continuam obrigatórias. Saídas de build e dependências já ficam fora do lint. Os testes da configuração verificam os limites e o alcance dessas exceções.

A limpeza de capas está em `src/commands/cleanupDiscardedCovers.ts`, usa a API pública de mídia e é verificada antes da compilação. `npm run media:cleanup` continua disponível e executa a entrada compilada. Os testes em `scripts/eslint-architecture.test.cjs` usam o próprio ESLint com a configuração real em projetos temporários; `npm run test:architecture` faz parte dos checks completos. Os testes funcionais podem acessar implementações internas dos módulos.

## Funcionalidades implementadas

### Contas, sessão e segurança

- Cadastro com nascimento obrigatório, ativação e reenvio de ativação de conta.
- Recuperação de senha com resposta neutra, token de uso único válido por uma hora e revogação das sessões após redefinição.
- Login, logout e consulta da sessão atual.
- Sessão **stateful**: o token opaco fica em cookie HttpOnly e somente seu hash SHA-256 é persistido na tabela `sessions`.
- Senhas protegidas com bcrypt; cadastro e redefinição limitam novas senhas a 72 bytes em UTF-8. Login legado preservado; logout revoga a sessão no banco.
- Perfil do usuário, preferência de conteúdo adulto, alteração do próprio nome de usuário e da própria senha, e exclusão da própria conta.
- A troca autenticada de senha mantém a sessão usada na alteração e revoga as demais sessões da conta, com limitação de tentativas por conta.
- Perfis de acesso são entidades (`profiles`) associadas à conta em `user_profiles`. Os perfis do sistema são `Administrador` e `Usuário Padrão`; toda conta possui o perfil padrão.
- A conta guarda o perfil preferido e cada sessão guarda o seu perfil ativo, inicializado no login a partir da preferência. `PATCH /api/users/me/active-profile` troca o perfil ativo da sessão atual e a preferência, sem afetar outras sessões nem conceder atribuições.
- Controle de acesso por perfil ATIVO da sessão somado à atribuição vigente na conta, com rotas administrativas protegidas. Remover a atribuição desautoriza imediatamente as sessões já abertas.
- A coluna legada `users.nivel_acesso` continua sendo escrita em conjunto com as atribuições (escrita dupla e gatilho de compatibilidade) apenas para código ainda não migrado; sua remoção está prevista para uma migration futura.
- CORS configurável, rate limiting de login, validação de entrada com Zod e respostas de erro com códigos estáveis.

### Administração do catálogo

- Gestão de usuários e das atribuições de perfil. `PATCH /api/admin/users/:id/role` concede (`{"role":"Administrador"}`) ou remove (`{"role":"Usuário Padrão"}`) a atribuição Administrador de OUTRA conta; a própria conta continua bloqueada e o perfil `Usuário Padrão` nunca é removido. O sistema recusa operações que deixariam nenhum administrador efetivo (conta `Ativada` com atribuição Administrador), inclusive na exclusão da própria conta. Essas operações adquirem um bloqueio transacional comum antes do usuário-alvo para serializar remoções concorrentes sem deadlock.
- Gestão de opções de domínio: autores, gêneros, tipos, editoras, formatos, acabamentos, países e demais classificações.
- Cadastro, consulta, edição, exclusão e visibilidade de Obras, Edições e Volumes.
- Identidade pública de Obra por `slug` único e imutável.
- Obra com título em português (`title`, origem do `slug`), `originalTitle` opcional, `romanizedTitle` e `synopsis` próprios e obrigatórios na criação e na edição. Os três títulos são campos distintos e nunca concatenados.
- Relações ordenadas de editoras originais, autores e papéis de autoria. A ordem dos autores vem da posição editorial (`position`, a partir de 0, contígua e normalizada pelo backend a partir da ordem recebida em `authors`, sem usar os valores enviados de `position` para reordenar); os papéis de autoria não determinam mais a ordem.

### Capas internas

- Importação individual de capa por URL HTTPS, exclusivamente para administradores.
- Validação da URL e da imagem de origem, proteção contra SSRF, limite de tamanho/pixels e remoção de metadados.
- Processamento com Sharp e geração de variantes WebP no formato 2:3.
- Persistência dos arquivos no Cloudflare R2; PostgreSQL mantém somente metadados e referências internas.
- A URL de procedência fica nos metadados restritos. A URL pública da capa é derivada do R2.
- Obra e Volume exigem capa interna; PATCH sem `coverAssetId` preserva a atual e `null` é recusado.
- A Edição **não tem capa própria**: a capa exibida é derivada do Volume com `number = 1` da mesma Edição (nunca o menor número, nunca o Volume 0, nunca um Volume de outra Edição). Sem esse Volume, a resposta traz `coverAssetId: null` e `coverUrl: null`.
- `POST /api/admin/works/:workId/editions` e `PATCH /api/admin/editions/:id` recusam `coverAssetId` com 400 (contratos `strict()`).
- `PATCH /api/admin/editions/:id/visibility` só publica a Edição que tenha o Volume 1 com capa interna válida; a validação ocorre na mesma transação que propaga a visibilidade aos Volumes. Publicação, renumeração e exclusão de Volume compartilham o advisory lock do ciclo de capas antes das leituras decisórias. Em Edição pública, renumerar o Volume 1 é recusado com 409, inclusive após aguardar uma publicação concorrente.

### Catálogo público

- Vitrine paginada de Obras e Edições, com busca, filtros combináveis, ordenação e limite máximo de 50 registros por página.
- Busca por título, título original, título romanizado e autor; filtros de Obra por tipo, país, demografia e gênero; filtros de Edição por editora brasileira, formato e acabamento. O título romanizado não participa da detecção de duplicidade nem da geração do `slug`.
- Interseção lógica `E` entre filtros múltiplos.
- Detalhes públicos de Obra, Edição e Volume. A ficha pública da Obra usa exclusivamente a sinopse da própria Obra; a sinopse do Volume continua pertencendo ao Volume.
- Listagem pública de Obras por Autor.
- Visitantes podem navegar pelo catálogo. Obras e Edições privadas nunca são retornadas; conteúdo adulto exige conta ativa, nascimento informado, 18 anos completos e preferência ativada. Uma conta ativada com atribuição `Administrador` também enxerga conteúdo adulto nas leituras públicas, independentemente da idade e da preferência; isso não autoriza nenhuma escrita administrativa, que continua exigindo o papel ativo na sessão.
- Obra associada ao gênero de código `hentai` fica oculta em todos os caminhos públicos (lista, busca, detalhe por slug, Obras do Autor, Edições, detalhe de Edição e de Volume, contagens e opções de filtro) para quem não está autorizado. O filtro combina a marca `adultContent` e a associação ao gênero, de modo que um registro legado inconsistente também permanece oculto.

### Valores de domínio controlados pelo sistema

- `tipos-obra` e `generos` têm valores oficiais semeados por migration, com `code` estável (por exemplo `manga`, `hentai`), `system_managed = true` e `position`. A área administrativa recusa criar (`POST`), excluir (`DELETE`) e renomear ou trocar dependências (`PATCH` de `label`/`dependsOnValueIds`) nessas categorias, inclusive para valores legados, com `403`; só `PATCH { "active": boolean }` é aceito, e desativar não remove associações existentes.
- Valores legados sem correspondência oficial mantêm seus vínculos existentes, mas não aceitam novas associações. Formulários de criação oferecem apenas valores oficiais ativos; a edição preserva os valores já vinculados à Obra. Alterar país ou tipo exige uma combinação válida.
- Cada Tipo de Obra oficial declara seus países por `DomainOptionValueDependency`: Artbook, Databook, Light novel e Mangá → Japão; Manhua → China e Taiwan; Manhwa → Coreia do Sul; Novel → China, Coreia do Sul, Japão e Taiwan. Para a categoria `tipos-obra` a ausência de dependência com o país informado passa a ser recusada; autores, editoras e revistas mantêm o comportamento anterior.
- Ao criar ou editar uma Obra, a presença do gênero `hentai` em `genreIds` normaliza `adultContent` para `true`; tentar desativá-lo enquanto o gênero permanece associado também é normalizado. Remover o gênero não desativa a marca.
- `tipos-edicao` e `generos` usam `position` (a partir de 0, contígua por categoria) na ordem de exibição; o rótulo é apenas desempate. Valores inativos ocupam posição.

## Rotas principais

| Grupo | Exemplos |
| --- | --- |
| Saúde | `GET /health/live`, `GET /health/ready`, `GET /ping` |
| Autenticação | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Recuperação | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` |
| Usuário | `GET /api/users/me`, `PATCH /api/users/me/adult-content`, `PATCH /api/users/me/active-profile`, `PATCH /api/users/me/username`, `PATCH /api/users/me/password`, `DELETE /api/users/me` |
| Administração | `GET /api/admin/users`, `PATCH /api/admin/users/:id/role`, `GET/POST/PATCH/DELETE /api/admin/options`, `PATCH /api/admin/options/:category/order`, CRUD de Obras, Edições e Volumes |
| Mídia | `POST /api/admin/media/covers`, `DELETE /api/admin/media/covers/:assetId` |
| Catálogo público | `GET /api/public/catalog-options`, `/works`, `/works/:slug`, `/authors/:authorId/works`, `/editions`, `/editions/:editionId`, `/volumes/:volumeId` |

### Contratos de opções

`GET /api/admin/options/:category` aceita `term`, `dependsOn`, `order`, `page`, `limit` e `includeInactive=true` (necessário para reativar um valor desativado) e devolve `code`, `systemManaged`, `position` e `active` em cada valor:

```json
{
  "category": { "slug": "generos", "name": "Gênero" },
  "values": [
    {
      "id": 124, "label": "Hentai", "code": "hentai",
      "systemManaged": true, "position": 10, "active": true,
      "category": { "slug": "generos", "name": "Gênero" }, "depends_on": []
    }
  ],
  "pagination": { "page": 1, "limit": 6, "total": 21, "totalPages": 4 }
}
```

`PATCH /api/admin/options/:category/order` só aceita `tipos-edicao` e normaliza as posições para `0..n-1` na ordem recebida (ids repetidos contam uma vez; valores omitidos vão para o fim preservando a ordem anterior). Id de outra categoria ou inexistente responde `400`.

```json
{ "valueIds": [11, 14, 12] }
```

`GET /api/public/catalog-options` passa a resolver a sessão opcional: responde com `Vary: Cookie` e `Cache-Control: private, no-store`, omite o gênero `hentai` para quem não está autorizado, ordena gêneros e tipos de Edição pela `position` e declara os países de cada Tipo de Obra:

```json
{
  "options": {
    "workTypes": [
      { "id": 173, "label": "Manhua", "countryIds": [164, 166], "countries": ["China", "Taiwan"] }
    ],
    "genres": [{ "id": 99, "label": "Aventura" }]
  }
}
```

O contrato completo é definido nas rotas, schemas Zod e testes de integração. Erros retornam `error`; o campo `code` está disponível no tratamento centralizado e em parte das validações. Exemplo:

```json
{
  "error": "Mensagem segura para o cliente.",
  "code": "CODIGO_ESTAVEL"
}
```

## E-mail e recuperação de senha

O envio usa a [API HTTPS do Resend](https://resend.com/docs/api-reference/emails/send-email), com `fetch` e limite de 10 segundos. Configure `RESEND_API_KEY`, `RESEND_FROM` e `FRONTEND_URL` somente no backend; o remetente precisa de [domínio verificado](https://resend.com/docs/dashboard/domains/introduction).

`forgot-password` recebe `{ email }`; `reset-password` recebe `{ token, password, confirmPassword }`. Cada endpoint limita 5 pedidos por IP a cada 15 minutos. A emissão também exige intervalo de 60 segundos por conta, inclusive após consumo do token ou falha de envio; pedidos nesse intervalo preservam o link atual e a resposta neutra. O limite por IP fica em memória; o intervalo por conta usa o banco.

A resposta neutra antecede a consulta e o envio. Não há fila persistente nem repetição automática de e-mail: após uma falha/interrupção, é necessário solicitar novamente respeitando o intervalo. Testes simulados não comprovam entrega real.

## Aplicação das migrations e manutenção

A migration `20260920121000_work_metadata_and_author_positions` acrescenta `works.romanized_title`, `works.synopsis` e `work_authors.position`. O preenchimento inicial dos dois primeiros copia `works.title` e é transitório: cada Obra existente precisa de revisão editorial manual depois da aplicação. As posições de autores nascem da ordem alfabética do nome dentro de cada Obra e só são recalculadas em Obras cujas posições estejam todas em zero. Rollback operacional: remover as colunas e o índice `idx_work_authors_position` restaura o comportamento anterior, sem perda de dados originais.

Contas antigas sem nascimento são preservadas, com +18 público bloqueado. Antes das migrations, execute `npm run check:covers` e corrija referências ausentes ou compartilhadas com capas reais na versão anterior. O verificador passou a conferir Obras e Volumes sem capa, Edições sem capa derivável (sem Volume 1 com capa) e Edições públicas cujo Volume 1 esteja privado; ele falha somente quando a inconsistência atinge um registro público. As migrations interrompem a aplicação das restrições se os dados forem incompatíveis; não apagam registros. Depois, execute `npm run migrate` e `npm run prisma:generate` no ambiente autorizado.

A migration `20260920122000_derive_edition_cover_from_first_volume` recusa a aplicação enquanto existir Edição pública sem Volume 1 com capa, marca como `Descartando` os ativos das antigas capas próprias de Edição que ficarem órfãos (sem apagar `media_assets` nem objetos do R2) e remove FK, índice único, coluna `editions.cover_asset_id` e os gatilhos de capa da tabela `editions`. O rollback é operacional: restaurar o dump anterior ao deploy ou recriar coluna/índice/FK e os gatilhos, reassociando manualmente os ativos ainda não removidos por `npm run media:cleanup`.

A capa desassociada passa a `Descartando`, impedindo reutilização. A requisição limpa somente a capa afetada; `npm run media:cleanup` processa até 20 pendências, incluindo falhas e capas intermediárias de substituições concorrentes. Veja [operação de capas](docs/operations/internal-cover-media.md). Configuração do Resend, migrations e entrega real ainda precisam ser validadas no deploy.

## Requisitos

- Node.js 22.12 ou superior.
- PostgreSQL acessível via `DATABASE_URL` - no desenvolvimento, use o banco Neon exclusivo de desenvolvimento.
- Chave da API Resend e remetente de domínio verificado para ativação e recuperação de senha.
- Credenciais Cloudflare R2 somente para importar ou remover capas.

## Configuração local

1. Instale as dependências:

   ```bash
   npm ci
   ```

2. Copie `.env.example` para `.env` e preencha os valores necessários. Nunca versione `.env` ou credenciais.

   ```env
   DATABASE_URL=
   CORS_ORIGIN=http://localhost:8080
   FRONTEND_URL=http://localhost:8080
   SESSION_COOKIE_NAME=comanga_session

   RESEND_API_KEY=
   RESEND_FROM=

   R2_ACCOUNT_ID=
   R2_ACCESS_KEY_ID=
   R2_SECRET_ACCESS_KEY=
   R2_BUCKET=
   MEDIA_PUBLIC_BASE_URL=
   ```

3. Aplique migrations **somente** no banco de desenvolvimento configurado:

   ```bash
   npm run migrate:dev
   ```

4. Inicie a API:

   ```bash
   npm run dev
   ```

A API local usa a porta `3000` por padrão. O frontend local deve apontar `VITE_API_URL` para `http://localhost:3000/api`.

> Nunca altere uma migration já aplicada e não execute `prisma migrate reset` em banco com dados que precisem ser preservados. Toda correção de schema deve ser uma migration nova.

## Comandos

| Comando | Finalidade |
| --- | --- |
| `npm run dev` | Inicia a API em desenvolvimento com recarga. |
| `npm run build` | Compila TypeScript para `dist`. |
| `npm start` | Executa a versão compilada. |
| `npm test` | Executa testes Jest e Supertest. |
| `npm run test:coverage` | Gera cobertura de todos os testes. |
| `npm run lint` | Executa ESLint, incluindo fronteiras arquiteturais, imports e ciclos. |
| `npm run prisma:generate` | Gera o Prisma Client. |
| `npm run migrate:dev` | Cria/aplica migration no banco de desenvolvimento. |
| `npm run migrate:test` | Aplica migrations no banco de teste. |
| `npm run migrate` | Aplica migrations já versionadas no ambiente de deploy. |
| `npm run load:test` | Executa teste progressivo de carga, com alvo explicitamente confirmado. |

## Verificações de qualidade

Use Node.js 22 e `npm ci` para instalar as versões do lockfile.

- `npm run check`: fronteiras arquiteturais, lint sem avisos, build e cobertura mínima de 80% em cada métrica.
- `npm run test:architecture`: regressões da configuração arquitetural do ESLint em projetos temporários.
- `npm run check:online`: auditoria de todas as dependências, incluindo ferramentas de desenvolvimento.
- `npm run test:unit`: todos os testes unitários, sem credenciais ou banco real.
- `npm run check:integration`: executa lint e regressões arquiteturais, aplica o histórico de migrations e executa todos os testes com cobertura.

Para integração, configure `DATABASE_URL_TEST` com um banco exclusivo cujo nome seja `test`, comece com `test_` ou termine em `_test`. Ele deve ser diferente de `DATABASE_URL` e `DIRECT_URL`. Os testes criam e excluem seus próprios registros; nunca use dados reais. `migrate:test` aplica migrations com `prisma migrate deploy`, preservando o schema e o histórico existente.

A suíte de integração também compara, nos dois sentidos, `prisma/schema.prisma` com o banco migrado (`prisma migrate diff`): qualquer campo, índice ou ação referencial declarado sem a migration correspondente — ou aplicado sem constar do schema — reprova a verificação. O gate de planos de consulta depende das estatísticas do banco de teste, que nas execuções normais são preservadas. Se uma execução for interrompida no meio, ela pode deixar estatísticas de tabelas já esvaziadas e reprovar esse gate sem regressão real; nesse caso descarte as estatísticas das tabelas afetadas antes de repetir a suíte.

O override de `deepmerge-ts` em `@prisma/config` corrige o alerta de recursão sem rebaixar o Prisma. O override de `test-exclude` mantém a cobertura em uma versão sem o `glob` obsoleto. A compatibilidade dessas exceções deve ser conferida com cobertura, geração do cliente e migrations ao atualizar dependências.

O GitHub Actions executa as verificações nos PRs e nos pushes para `develop` e `main`.

A proteção de `develop` e `main` deve ser configurada pelo dono diretamente no GitHub.

## Operação, desempenho e testes

- `GET /health/live` confirma que o processo HTTP está ativo, sem consultar o banco.
- `GET /health/ready` confirma conectividade com o PostgreSQL.
- Logs estruturados JSON possuem `x-request-id`, rota, status e duração.
- O encerramento gracioso aguarda requisições pendentes e desconecta o Prisma.
- Índices PostgreSQL e `pg_trgm` apoiam busca e filtros públicos; testes validam integridade e planos de consulta relevantes.
- Jest e Supertest cobrem regras de negócio, middlewares, contratos de infraestrutura, rotas administrativas, mídia e catálogo público.
- O GitHub Actions instala dependências, aplica migrations no PostgreSQL de teste, executa build, testes, cobertura e lint.

Os procedimentos de mídia e capacidade estão em [`docs/operations`](./docs/operations/).

## Deploy

O backend é hospedado na Render. O fluxo de produção gera o Prisma Client, aplica migrations versionadas e compila TypeScript antes de executar `npm start`. Variáveis de ambiente e segredos devem ser configurados na plataforma, nunca no repositório.

## Escopo ainda planejado

Calendário público, Estante Digital, Lista de Desejos, enriquecimento autenticado do catálogo e a evolução para serviços distribuídos ainda não fazem parte desta API. O planejamento e os critérios de aceite vivem no repositório [`comanga-docs`](https://github.com/IsaacLeite1309/comanga-docs).

## Repositórios relacionados

- [comanga-web](https://github.com/IsaacLeite1309/comanga-web) - SPA React.
- [comanga-docs](https://github.com/IsaacLeite1309/comanga-docs) - documentação técnica, requisitos e planejamento.


### Serviços locais de desenvolvimento

Com `NODE_ENV=development`, `MEDIA_STORAGE_DRIVER=local` e `LOCAL_MEDIA_DIR` apontando para um diretório absoluto, capas são gravadas no disco e servidas em `/local-media`. `MEDIA_PUBLIC_BASE_URL` pode usar HTTP somente em `localhost`, `127.0.0.1` ou `[::1]` nesse modo. O driver padrão continua sendo R2 e serviços locais são recusados em produção.

`MAIL_TRANSPORT=local` com `LOCAL_MAIL_DIR` grava mensagens de ativação/recuperação em arquivos JSON privados, sem enviar e-mail externo. `HOST=127.0.0.1` limita a API à máquina local. A configuração local deve usar um banco exclusivo e não substituir credenciais remotas.
