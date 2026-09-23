# Prova de conceito de capas com Cloudinary (histórico)

> **Registro histórico. Não é a configuração atual.** A prova de conceito foi abandonada. O código, as rotas, a variável de ativação e os testes do Cloudinary foram removidos no commit `083f466` ("feat: internalizar capas no Cloudflare R2", agosto de 2026). O armazenamento vigente das capas é o **Cloudflare R2**, descrito em [operação das capas internas](../operations/internal-cover-media.md). Nada neste documento deve ser usado como instrução de configuração ou operação.

## Contexto

Antes do armazenamento interno, o catálogo referenciava capas por URL externa. A prova de conceito avaliou se um serviço gerenciado de imagens poderia importar e entregar essas capas de forma controlada, sem migração em massa e sem alterar o mecanismo do catálogo durante a avaliação.

## O que foi avaliado

- Importação de capas externas por URL, restrita a administradores, com a integração isolada atrás do contrato `MediaStorage` e desligada por padrão.
- Restrições equivalentes às que hoje valem para o R2: origem HTTPS, formatos JPG, PNG, WebP ou AVIF, bloqueio de hosts locais e privados, limite de redirecionamentos e de tamanho.
- Ativos numa pasta isolada do serviço, sem gravar URLs ou identificadores nas tabelas do catálogo.
- Entrega otimizada em proporção 2:3, com corte automático e formato e qualidade automáticos (`c_fill,ar_2:3,g_auto/f_auto,q_auto`).
- Medição de armazenamento, transformações e largura de banda, a comparar com os limites do plano gratuito.

## Resultado da avaliação

Na época, a decisão registrada foi **adiar**: a integração estava tecnicamente pronta para uma prova controlada, mas o catálogo tinha poucos registros reais e não havia medição representativa de consumo ou benefício. Nenhum resultado de medição foi registrado neste repositório.

## Decisão final

A prova de conceito foi encerrada sem adoção e substituída pelo armazenamento interno no Cloudflare R2. O motivo detalhado da troca não foi registrado neste repositório. A solução adotada tem estas características:

- a própria API baixa a imagem e a processa com Sharp, gerando variantes WebP 2:3 fixas;
- os arquivos ficam no R2 com chaves imutáveis, e o PostgreSQL guarda apenas metadados;
- as capas são servidas pelo domínio público configurado em `MEDIA_PUBLIC_BASE_URL`;
- a associação, o descarte e a limpeza das capas são coordenados por gatilhos no banco e pelo comando `npm run media:cleanup`.

Não existe dependência, variável de ambiente nem rota do Cloudinary no código atual.
