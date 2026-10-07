# Backups diarios de producao

O workflow [production-backup.yml](../../.github/workflows/production-backup.yml) roda todos os dias as 03:17 UTC (00:17 em Sao Paulo, UTC-3) e tambem pode ser iniciado manualmente. Ele tem dois jobs independentes:

- **Neon PostgreSQL:** gera um `pg_dump` em formato customizado, le o arquivo inteiro com `pg_restore`, cria um SHA-256 e envia ambos para `database/AAAA/MM/DD/` no bucket privado de backup.
- **Cloudflare R2:** copia as capas do bucket de producao para `media/current/`. Arquivos removidos da origem continuam no backup. Quando uma chave e sobrescrita, a versao anterior vai para `media/history/AAAA-MM-DDTHH-MM-SSZ/`.

Os backups nao exigem migration e nao usam as credenciais R2 da API em producao. O snapshot manual no Neon continua recomendado antes de cada migration ou alteracao de dados em massa. O historico de restauracao do Neon e os snapshots estao sujeitos ao plano contratado; esta copia externa independe do agendamento nativo do Neon.

## Preparacao

1. Crie um **bucket R2 privado e separado** para backups, por exemplo `comanga-backups`. Nao habilite acesso publico nem use o bucket de capas como destino. Se quiser isolamento tambem contra problemas na conta principal da Cloudflare, crie o bucket em outra conta.
2. Gere dois tokens R2 para a API compativel com S3:
   - **Origem:** permissao `Object Read only`, limitada ao bucket de capas de producao.
   - **Destino:** permissao `Object Read & Write`, limitada somente ao bucket de backup.
3. Na pagina **Settings > Secrets and variables > Actions** do repositorio `comanga-api`, configure os itens abaixo. Use a URL **direta, sem pooler**, da branch `production` do Neon. Nunca coloque a URL nem as chaves em arquivos versionados ou em comentarios de PR.

| Tipo | Nome | Valor |
| --- | --- | --- |
| Secret | `NEON_PRODUCTION_DATABASE_URL` | Connection string direta do banco de producao, com SSL |
| Secret | `R2_PRODUCTION_READ_ACCESS_KEY_ID` | ID do token de leitura do bucket de capas |
| Secret | `R2_PRODUCTION_READ_SECRET_ACCESS_KEY` | Segredo do token de leitura do bucket de capas |
| Secret | `R2_BACKUP_ACCESS_KEY_ID` | ID do token do bucket de backup |
| Secret | `R2_BACKUP_SECRET_ACCESS_KEY` | Segredo do token do bucket de backup |
| Variable | `R2_PRODUCTION_BUCKET` | Nome exato do bucket de capas |
| Variable | `R2_BACKUP_BUCKET` | Nome exato do bucket de backup |
| Variable | `R2_PRODUCTION_S3_ENDPOINT` | Endpoint S3 da origem, por exemplo `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| Variable | `R2_BACKUP_S3_ENDPOINT` | Endpoint S3 do backup; pode ser o mesmo da origem se os buckets estiverem na mesma conta |

O endpoint S3 consta no painel do R2. Buckets com jurisdicao especifica usam o endpoint da respectiva jurisdicao. Os tokens devem ser criados para a API compativel com S3, com acesso apenas aos buckets indicados.

## Ativacao e verificacao

1. Depois que o workflow estiver na branch padrao (`main`) e os nove itens acima estiverem configurados, abra **Actions > Production backups > Run workflow**.
2. Confirme que os jobs **Neon PostgreSQL** e **Cloudflare R2 media** terminaram com sucesso.
3. Confira no bucket privado os arquivos `database/AAAA/MM/DD/comanga-....dump`, `comanga-....dump.sha256` e as capas em `media/current/`.
4. Baixe um dump, confira o SHA-256 e restaure em **uma branch temporaria do Neon**. Verifique algumas tabelas e registros antes de considerar o procedimento validado. Para as capas, baixe uma imagem do backup e confira se abre corretamente.

O arquivo `.dump` contem dados reais dos usuarios. Mantenha o bucket privado e restrinja quem pode executar o workflow ou acessar seus segredos. O job falha se faltar qualquer configuracao ou se o bucket de origem e o de destino forem o mesmo.

Os arquivos existentes nao sao apagados automaticamente. Depois do primeiro ensaio de restauracao, em **R2 > bucket de backup > Settings > Object lifecycle rules**, configure uma regra limitada ao prefixo `database/` para excluir dumps com mais de 35 dias. Isso preserva ao menos 30 backups diarios e limita o custo. Nao aplique essa regra ao bucket inteiro: `media/current/` precisa permanecer. O historico em `media/history/` pode ter uma retencao propria. Uma falha de qualquer job aparece como falha do workflow e precisa ser investigada antes da proxima execucao.

**Monitore a data do ultimo backup bem-sucedido.** O GitHub pode atrasar ou descartar um agendamento em momentos de carga. Alem disso, em repositorios publicos, desativa workflows agendados apos 60 dias sem atividade no repositorio; nesse caso, e necessario reativar o workflow. Um job verde em um dia anterior nao comprova que o backup do dia atual foi executado.

Fontes: [GitHub Actions agendadas](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [tokens R2](https://developers.cloudflare.com/r2/api/tokens/), [R2 com rclone](https://developers.cloudflare.com/r2/examples/rclone/), [rclone --backup-dir](https://rclone.org/docs/#backup-dir-string), [ciclo de vida de objetos R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/), [Neon com GitHub Actions e pg_dump](https://neon.com/blog/automate-partial-data-dumps-with-postgresql-and-github-actions).
