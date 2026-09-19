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

## Funcionalidades implementadas

### Contas, sessão e segurança

- Cadastro com nascimento obrigatório, ativação e reenvio de ativação de conta.
- Recuperação de senha com resposta neutra, token de uso único válido por uma hora e revogação das sessões após redefinição.
- Login, logout e consulta da sessão atual.
- Sessão **stateful**: o token opaco fica em cookie HttpOnly e somente seu hash SHA-256 é persistido na tabela `sessions`.
- Senhas protegidas com bcrypt; cadastro e redefinição limitam novas senhas a 72 bytes em UTF-8. Login legado preservado; logout revoga a sessão no banco.
- Perfil do usuário, preferência de conteúdo adulto e exclusão da própria conta.
- Controle de acesso por papel, com rotas administrativas protegidas.
- CORS configurável, rate limiting de login, validação de entrada com Zod e respostas de erro com códigos estáveis.

### Administração do catálogo

- Gestão de usuários e de papéis de acesso.
- Gestão de opções de domínio: autores, gêneros, tipos, editoras, formatos, acabamentos, países e demais classificações.
- Cadastro, consulta, edição, exclusão e visibilidade de Obras, Edições e Volumes.
- Identidade pública de Obra por `slug` único e imutável.
- Relações ordenadas de editoras originais, autores e papéis de autoria.

### Capas internas

- Importação individual de capa por URL HTTPS, exclusivamente para administradores.
- Validação da URL e da imagem de origem, proteção contra SSRF, limite de tamanho/pixels e remoção de metadados.
- Processamento com Sharp e geração de variantes WebP no formato 2:3.
- Persistência dos arquivos no Cloudflare R2; PostgreSQL mantém somente metadados e referências internas.
- A URL de procedência fica nos metadados restritos. A URL pública da capa é derivada do R2.
- Obra, Edição e Volume exigem capa interna; PATCH sem `coverAssetId` preserva a atual e `null` é recusado.

### Catálogo público

- Vitrine paginada de Obras e Edições, com busca, filtros combináveis, ordenação e limite máximo de 50 registros por página.
- Busca por título, título original e autor; filtros de Obra por tipo, país, demografia e gênero; filtros de Edição por editora brasileira, formato e acabamento.
- Interseção lógica `E` entre filtros múltiplos.
- Detalhes públicos de Obra, Edição e Volume.
- Listagem pública de Obras por Autor.
- Visitantes podem navegar pelo catálogo. Obras e Edições privadas nunca são retornadas; conteúdo adulto exige conta ativa, nascimento informado, 18 anos completos e preferência ativada. Administradores autorizados consultam todo o catálogo na área administrativa.

## Rotas principais

| Grupo | Exemplos |
| --- | --- |
| Saúde | `GET /health/live`, `GET /health/ready`, `GET /ping` |
| Autenticação | `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Recuperação | `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` |
| Usuário | `GET /api/users/me`, `PATCH /api/users/me/adult-content`, `DELETE /api/users/me` |
| Administração | `GET /api/admin/users`, `GET/POST/PATCH/DELETE /api/admin/options`, CRUD de Obras, Edições e Volumes |
| Mídia | `POST /api/admin/media/covers`, `DELETE /api/admin/media/covers/:assetId` |
| Catálogo público | `GET /api/public/catalog-options`, `/works`, `/works/:slug`, `/authors/:authorId/works`, `/editions`, `/editions/:editionId`, `/volumes/:volumeId` |

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

Contas antigas sem nascimento são preservadas, com +18 público bloqueado. Antes das migrations, execute `npm run check:covers` e corrija referências ausentes ou compartilhadas com capas reais na versão anterior. As migrations interrompem a aplicação das restrições se os dados forem incompatíveis; não apagam registros. Depois, execute `npm run migrate` e `npm run prisma:generate` no ambiente autorizado.

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
| `npm run lint` | Executa ESLint. |
| `npm run prisma:generate` | Gera o Prisma Client. |
| `npm run migrate:dev` | Cria/aplica migration no banco de desenvolvimento. |
| `npm run migrate:test` | Aplica migrations no banco de teste. |
| `npm run migrate` | Aplica migrations já versionadas no ambiente de deploy. |
| `npm run load:test` | Executa teste progressivo de carga, com alvo explicitamente confirmado. |

## Verificações de qualidade

Use Node.js 22 e `npm ci` para instalar as versões do lockfile.

- `npm run check`: lint sem avisos, build e cobertura mínima de 80% em cada métrica.
- `npm run check:online`: auditoria de todas as dependências, incluindo ferramentas de desenvolvimento.
- `npm run test:unit`: todos os testes unitários, sem credenciais ou banco real.
- `npm run check:integration`: aplica o histórico de migrations e executa todos os testes com cobertura.

Para integração, configure `DATABASE_URL_TEST` com um banco exclusivo cujo nome seja `test`, comece com `test_` ou termine em `_test`. Ele deve ser diferente de `DATABASE_URL` e `DIRECT_URL`. Os testes criam e excluem seus próprios registros; nunca use dados reais. `migrate:test` aplica migrations com `prisma migrate deploy`, preservando o schema e o histórico existente.

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
