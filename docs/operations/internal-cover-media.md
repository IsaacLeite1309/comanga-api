# Operação das capas internas

As capas do catálogo são armazenadas no **Cloudflare R2**. O PostgreSQL guarda apenas metadados e referências; os arquivos ficam no bucket e são lidos pelo navegador diretamente no domínio público de mídia. O Cloudinary não é usado (ver o [registro histórico](../decisions/cloudinary-poc.md)).

## Visão geral do ciclo

| Etapa | O que acontece | Onde |
| --- | --- | --- |
| Importação remota | O Administrador informa uma URL HTTPS; a API baixa a imagem com proteção de host e limites. Não existe envio de arquivo pelo navegador. | `POST /api/admin/media/covers`, `RemoteImageDownloader.ts` |
| Processamento | Sharp valida a imagem e gera três arquivos WebP 2:3. | `CoverImageProcessor.ts` |
| Armazenamento | Os arquivos vão para o R2 e os metadados para `media_assets` e `media_variants`, com estado `Pendente`. | `CoverImportService.ts`, `R2MediaStorage.ts` |
| Associação | A capa é vinculada a uma Obra ou a um Volume e passa a `Ativo`. | Módulo `catalog` e gatilhos do PostgreSQL |
| Substituição | A nova capa é associada na transação; a antiga passa a `Descartando` e a API tenta removê-la em seguida. | Módulo `catalog`, `coverAssetLifecycle.ts` |
| Remoção de pendente | Uma capa importada e ainda não associada pode ser descartada por quem a importou. | `DELETE /api/admin/media/covers/:assetId` |
| Limpeza | Capas em `Descartando` que não puderam ser removidas na requisição são processadas depois. | `npm run media:cleanup` |

A Edição não tem capa própria: ela exibe a capa do Volume 1 da mesma Edição.

## Configuração

### Conta R2

1. Criar um bucket para as capas.
2. Criar credenciais S3 restritas a leitura, gravação e exclusão de objetos desse bucket.
3. Associar ao bucket um domínio público HTTPS controlado pelo projeto.
4. Se o navegador precisar ler as capas por `fetch` ou canvas (e não só por `<img>`), aplicar uma política de CORS como a de [`r2-cors.json`](r2-cors.json), trocando as origens de exemplo pelas origens reais. A Web local roda em `http://localhost:8080`; o exemplo ainda traz `http://localhost:5173`, que precisa ser substituído.

### Variáveis da API

Configure somente no backend (Render ou `.env` local). As credenciais nunca vão para a Vercel nem para variáveis `VITE_*`.

| Variável | Uso | Padrão no código |
| --- | --- | --- |
| `R2_ACCOUNT_ID` | Monta o endpoint `https://<conta>.r2.cloudflarestorage.com` | — |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Credenciais S3 do bucket | — |
| `R2_BUCKET` | Nome do bucket | — |
| `MEDIA_PUBLIC_BASE_URL` | Origem pública das capas; precisa ser HTTPS e não deve incluir uma chave de objeto | — |
| `MEDIA_MAX_SOURCE_BYTES` | Tamanho máximo da imagem baixada | `10485760` (10 MiB) |
| `MEDIA_MAX_SOURCE_PIXELS` | Largura × altura máxima da imagem de origem | `40000000` |
| `MEDIA_DOWNLOAD_TIMEOUT_MS` | Tempo máximo de cada requisição do download | `10000` |

Sem alguma das variáveis `R2_*`, a importação e a remoção respondem 503 `MEDIA_PROVIDER_NOT_CONFIGURED`. Sem `MEDIA_PUBLIC_BASE_URL` válida, qualquer resposta que precise montar `coverUrl` (administrativa ou pública) falha com o mesmo código.

## Importação remota

A importação é genérica: não há regra, lista ou tratamento especial por site, loja ou editora. Qualquer URL pública que entregue uma imagem permitida é aceita. (O link da Amazon que aparece na Web é apenas o link de afiliado do Volume e não participa da importação de capas.)

Requisição: `POST /api/admin/media/covers` com `{ "sourceUrl": "https://..." }`, sessão válida e perfil ativo Administrador. A resposta 201 traz o ativo criado (id, dimensões, variantes, estado) e `coverUrl`; ela não traz a URL de origem.

Proteções aplicadas pela API:

- **URL**: somente `https:`, sem usuário ou senha embutidos e com até 2048 caracteres.
- **Host**: `localhost` e `*.localhost` são recusados. O nome é resolvido por DNS e a importação é recusada se **qualquer** endereço retornado for não público: redes privadas, loopback, link-local, CGNAT (`100.64.0.0/10`), `0.0.0.0/8`, `192.0.0.0/24`, `198.18.0.0/15`, multicast e reservados IPv4; `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8` e IPv4 mapeado em IPv6 com as mesmas restrições.
- **Conexão fixada**: a requisição usa o endereço já validado, sem nova resolução DNS, o que impede trocar o destino entre a validação e o download.
- **Redirecionamentos**: até 3, cada um revalidado com as mesmas regras de URL e host.
- **Tipo**: o `Content-Type` precisa ser `image/jpeg`, `image/png`, `image/webp` ou `image/avif`.
- **Tamanho**: `Content-Length` acima do limite é recusado antes da leitura, e a leitura é interrompida se os bytes reais passarem do limite.
- **Tempo**: cada requisição (a inicial e cada redirecionamento) tem o limite de `MEDIA_DOWNLOAD_TIMEOUT_MS`.

## Processamento

- A imagem é decodificada pelo Sharp; só são aceitos os formatos JPEG, PNG, WebP e AVIF, com largura e altura válidas.
- Largura × altura acima de `MEDIA_MAX_SOURCE_PIXELS` é recusada antes de gerar qualquer saída.
- A orientação EXIF é aplicada e a imagem é cortada em 2:3 (`fit: cover`, foco automático por atenção).
- Saídas, todas em WebP e sem os metadados da origem:

| Tipo | Dimensão | Chave no R2 |
| --- | --- | --- |
| `MASTER` | 1200 × 1800 | `covers/{uuid}/master.webp` |
| `COVER_LARGE` | 640 × 960 | `covers/{uuid}/large.webp` |
| `COVER_SMALL` | 320 × 480 | `covers/{uuid}/small.webp` |

- O banco registra o checksum SHA-256 da imagem de origem.

## Armazenamento e URLs públicas

- Cada importação cria um prefixo novo (`covers/{uuid}/`) e grava os objetos com `Cache-Control: public, max-age=31536000, immutable`. Uma capa nunca é sobrescrita; trocar a capa significa importar outra.
- Se a gravação no banco falhar depois do envio ao R2, a API tenta apagar os objetos já enviados. Se essa remoção compensatória também falhar, `CoverImportService` ignora seu erro e propaga a falha original. Os objetos podem ficar órfãos no R2 sem registro no banco; `media:cleanup` não os encontra, pois só consulta ativos em `Descartando`. Não há recuperação automática desses objetos.
- `media_assets` guarda provedor (`r2`), chave do objeto principal, URL de origem final (após redirecionamentos), MIME, formato, dimensões, bytes, checksum, estado, quem importou e datas. `media_variants` guarda as variantes.
- A URL de origem é um metadado restrito: não aparece em respostas administrativas nem públicas e não entra nos logs.
- A `coverUrl` devolvida é `MEDIA_PUBLIC_BASE_URL` + chave do objeto, preferindo a variante `COVER_LARGE`, depois `COVER_SMALL` e, por fim, o principal. A API e a Vercel não fazem proxy das imagens.

## Estados, associação e substituição

| Estado | Significado |
| --- | --- |
| `Pendente` | Importada, ainda sem vínculo |
| `Ativo` | Associada a uma Obra ou a um Volume |
| `Descartando` | Desvinculada ou em remoção; não pode ser associada de novo nem reativada |

- Obra e Volume exigem capa ao serem criados, e cada capa pertence a um único registro. Só capas `Pendente` ou `Ativo` e sem outro vínculo podem ser associadas; caso contrário, a API responde 400 ("A capa interna informada é inválida ou já está em uso.").
- No PATCH de Obra ou Volume, omitir `coverAssetId` preserva a capa atual e `null` é recusado.
- Gatilhos do PostgreSQL (migrations `20260909231000_required_atomic_covers` e `20260920122000_derive_edition_cover_from_first_volume`) validam a associação, marcam como `Descartando` a capa desvinculada na mesma transação e impedem reativar uma capa em descarte ou descartar uma capa associada. Um lock transacional curto serializa essas operações; as chamadas ao R2 acontecem fora dele.
- Na substituição, a nova capa é associada primeiro. Só depois do commit a API tenta remover a antiga (R2 e depois banco). Se a nova importação ou a associação falharem, a capa anterior continua associada.
- Ao excluir uma Obra ou um Volume, a API tenta remover a capa que ficou sem vínculo.

## Remoção e limpeza

**Capa pendente.** `DELETE /api/admin/media/covers/:assetId` remove uma capa importada pela própria conta e ainda não associada (204). A capa é marcada como `Descartando` antes de tocar no R2. Capa inexistente, de outra conta ou já associada não é removida (404 ou 409).

**Falhas na remoção.** Se o R2 falhar na limpeza de uma capa desvinculada (substituição, exclusão ou `media:cleanup`), os metadados permanecem em `Descartando` para nova tentativa, e o log registra `media.orphan_cleanup_failed` com o `assetId`. No `DELETE` de capa pendente, a API responde 502 `MEDIA_PROVIDER_FAILURE` e a capa fica em `Descartando` até o próximo `media:cleanup`.

**`npm run media:cleanup`.** Compila o projeto e processa até 20 capas em `Descartando` por execução, incluindo falhas anteriores e capas intermediárias de substituições concorrentes. Rode no ambiente autorizado, com as variáveis do banco e do R2 configuradas, e repita enquanto houver pendências. Como compila o código, precisa das dependências de desenvolvimento.

**Capas `Pendente` abandonadas.** Uma capa importada que nunca foi associada nem removida pela interface continua no R2 e no banco. O `media:cleanup` só processa `Descartando`; não há limpeza automática de pendentes antigas.

**`npm run check:covers`.** Verificação somente de leitura do banco configurado em `DATABASE_URL`. Relata:

- Obras e Volumes sem capa;
- Edições sem capa derivável (sem Volume 1 com capa) e, entre elas, as públicas;
- Edições públicas cujo Volume 1 é privado;
- capas compartilhadas por mais de um registro.

O comando termina com código 1 se houver Obra ou Volume sem capa, Edição pública sem capa derivável, Edição pública com Volume 1 privado ou capa compartilhada. Ele não corrige nada: as migrations também não apagam dados nem fabricam capas. Rode-o antes de aplicar migrations que validam capas.

Depois de uma migration que coloca capas em `Descartando` (como `20260920122000_derive_edition_cover_from_first_volume`), não rode `media:cleanup` até decidir se haverá rollback: depois da limpeza, os arquivos já não existem no R2.

## Erros

| Código | HTTP | Causa |
| --- | --- | --- |
| `MEDIA_SOURCE_URL_INVALID` | 400 | URL que não é HTTPS, com credenciais, longa demais, host local ou não público, redirecionamento inválido ou acima do limite |
| `MEDIA_SOURCE_UNAVAILABLE` | 400 | Falha de DNS, de conexão, tempo esgotado antes da resposta, resposta HTTP de erro ou corpo vazio |
| `MEDIA_FORMAT_NOT_ALLOWED` | 415 | `Content-Type` fora de JPG, PNG, WebP ou AVIF |
| `MEDIA_TOO_LARGE` | 413 | Imagem acima de `MEDIA_MAX_SOURCE_BYTES` |
| `MEDIA_IMAGE_INVALID` | 415 | Arquivo que não decodifica como imagem permitida |
| `MEDIA_DIMENSIONS_EXCEEDED` | 413 | Imagem acima de `MEDIA_MAX_SOURCE_PIXELS` |
| `MEDIA_PROVIDER_NOT_CONFIGURED` | 503 | Variáveis `R2_*` ausentes ou `MEDIA_PUBLIC_BASE_URL` ausente/não HTTPS |
| `MEDIA_PROVIDER_FAILURE` | 502 | Falha do R2 ao gravar ou remover objetos |
| `MEDIA_ASSET_ID_INVALID` | 400 | Identificador de capa que não é UUID |
| `MEDIA_ASSET_NOT_FOUND` | 404 | Capa pendente não encontrada para a conta |
| `MEDIA_ASSET_IN_USE` | 409 | Capa já associada a um registro |

Os eventos `media.cover_import.completed` e `media.cover_import.failed` registram `requestId`, usuário, resultado, código e duração, sem URL de origem nem credenciais.

## Verificação operacional

Use após configurar um ambiente ou alterar a integração com o R2:

- [ ] Importar uma capa JPG, PNG, WebP ou AVIF por um formulário administrativo.
- [ ] Confirmar que a prévia usa o domínio de `MEDIA_PUBLIC_BASE_URL`.
- [ ] Confirmar que a resposta da importação e as respostas do catálogo não contêm a URL de origem.
- [ ] Tentar importar de um host local ou privado e confirmar a recusa com `MEDIA_SOURCE_URL_INVALID`.
- [ ] Publicar o registro e confirmar a mesma origem de imagem na vitrine sem sessão.
- [ ] Substituir a capa e confirmar que a anterior some do bucket ou fica em `Descartando` para o `media:cleanup`.
- [ ] Localizar os eventos de importação pelo `requestId`, sem URL de origem nem credenciais.
- [ ] Rodar `npm run check:covers` no banco do ambiente.
