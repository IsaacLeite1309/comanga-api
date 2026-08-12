# Prova de conceito de capas com Cloudinary

## Objetivo

Avaliar a importação controlada de capas externas sem substituir o mecanismo atual do catálogo nem realizar migração em massa.

## Escopo seguro

- A funcionalidade permanece desativada sem `CLOUDINARY_POC_ENABLED=true`.
- As rotas exigem sessão ativa e papel `Administrador`.
- O frontend nunca recebe `API Secret` ou assinatura reutilizável.
- A origem deve usar HTTPS e apontar para JPG, PNG, WebP ou AVIF.
- O backend bloqueia hosts locais/privados, limita redirecionamentos e restringe o tamanho configurado.
- Os ativos ficam na pasta isolada `comanga-poc`.
- A POC não grava URLs ou `publicId` nas tabelas do catálogo.

## Transformação avaliada

A URL otimizada usa proporção 2:3, corte com gravidade automática, formato automático e qualidade automática:

```text
c_fill,ar_2:3,g_auto/f_auto,q_auto
```

## Medição

`GET /api/admin/media/poc/metrics` informa ativos acompanhados pelo processo atual, bytes armazenados e quantidades de importações, substituições e exclusões. Como esse registro é local e reinicia junto com a instância, o uso faturável deve ser conferido no painel do Cloudinary durante a prova.

Registrar para cada rodada:

| Medida | Antes | Depois | Diferença |
| --- | ---: | ---: | ---: |
| Armazenamento |  |  |  |
| Transformações |  |  |  |
| Largura de banda |  |  |  |

Também devem ser verificados: importação por URL, entrega otimizada, substituição mantendo `publicId`, invalidação da versão anterior e exclusão do ativo.

## Decisão atual: Adiar

O Cloudinary foi isolado atrás de `MediaStorage` e está tecnicamente pronto para uma prova controlada. Ele ainda não é o armazenamento padrão porque o catálogo possui poucos registros reais e não há medição representativa de consumo ou benefício. A decisão deve ser reavaliada após cadastrar uma amostra de capas e comparar estabilidade, armazenamento, transformações e largura de banda com os limites gratuitos vigentes.
