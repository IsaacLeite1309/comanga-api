# Operação das capas internas

## Visão geral

O backend é o único responsável por buscar imagens externas. A URL informada pelo administrador é mantida somente para auditoria e nunca é devolvida nos contratos administrativos ou públicos. O navegador recebe uma URL derivada de `MEDIA_PUBLIC_BASE_URL` e da chave imutável do objeto armazenado.

O Render processa a importação e grava diretamente no Cloudflare R2. A Vercel e o Render não atuam como proxy na entrega das capas; depois da importação, o navegador lê as variantes pelo domínio de mídia.

## Configuração posterior da conta R2

1. Criar um bucket privado para as capas.
2. Criar credenciais S3 limitadas à leitura, gravação e exclusão de objetos desse bucket.
3. Associar um domínio público controlado pelo CoMangá ao bucket.
4. Aplicar a política de CORS de `docs/operations/r2-cors.json`, substituindo as origens de exemplo pelas origens reais da Vercel e do desenvolvimento.
5. Configurar no Render:

```text
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
MEDIA_PUBLIC_BASE_URL=https://media.seu-dominio.example
MEDIA_MAX_SOURCE_BYTES=10485760
MEDIA_MAX_SOURCE_PIXELS=40000000
MEDIA_DOWNLOAD_TIMEOUT_MS=10000
```

`MEDIA_PUBLIC_BASE_URL` deve ser HTTPS e não deve terminar com uma chave de objeto. As credenciais nunca devem ser configuradas na Vercel nem em variáveis iniciadas por `VITE_`.

## Cache e substituição

Cada importação cria chaves novas em `covers/{uuid}/...` e usa `Cache-Control: public, max-age=31536000, immutable`. Uma substituição associa primeiro o novo ativo em transação; somente depois tenta remover o ativo antigo sem vínculo. Se a nova importação falhar, a associação anterior permanece.

## Verificação operacional

- Importar uma capa JPG, PNG, WebP ou AVIF por um formulário administrativo.
- Confirmar que a prévia usa o domínio definido em `MEDIA_PUBLIC_BASE_URL`.
- Publicar o registro e confirmar a mesma origem na vitrine anônima.
- Confirmar fallback quando o arquivo interno estiver temporariamente indisponível. Registros sem associação de capa exigem saneamento antes da migration.
- Verificar que a resposta não contém `sourceUrl`.
- Verificar os eventos `media.cover_import.completed` e `media.cover_import.failed` pelo `requestId`, sem URL de origem ou credenciais.

## Obrigatoriedade e exclusão

Obra, Edição e Volume exigem uma capa interna distinta por registro. Não é permitido salvar `null` nem excluir um ativo associado. Os triggers PostgreSQL coordenam associações e descartes com um lock transacional curto; chamadas ao R2 ocorrem fora desse lock.

Uma capa removida por substituição/exclusão passa a `Descartando` na mesma transação. Esse estado não permite nova associação ou reativação. A limpeza preserva os metadados quando o R2 falha, para permitir nova tentativa. Execute `npm run media:cleanup` no ambiente autorizado para processar até 20 pendências; repita enquanto houver pendências, verificando os logs de falha.

Antes do deploy, `npm run check:covers` lista referências ausentes e capas compartilhadas entre registros. As migrations não apagam dados nem fabricam capas para corrigir esses casos.
