# Checklist de revisão de qualidade

Roteiro reutilizável para revisar uma entrega da API antes de integrá-la ou publicá-la. Ele diz **o que conferir e qual evidência guardar**; não registra resultados. Os resultados de cada rodada ficam no PR ou no registro da entrega, sempre com data e commit, porque deixam de valer na mudança seguinte.

Marque apenas o que se aplica à entrega. Um item não aplicável fica sem marcação, com uma nota curta explicando por quê.

## 1. Identificação da rodada

Registre junto com o resultado:

- commit da API (e da Web, se a entrega envolver as duas);
- data;
- versões locais de Node.js e PostgreSQL;
- bancos usados (nome do banco de teste; nunca o de produção);
- se houve uso real de Resend ou R2, e em qual ambiente.

## 2. Verificações automáticas

- [ ] `npm ci` executado com o lockfile atual.
- [ ] `npm run check` passou na API (lint, arquitetura, build e cobertura unitária mínima de 80% em cada métrica).
- [ ] `npm run check:integration` passou com banco de teste exclusivo, quando a entrega toca schema, migrations, consultas, rotas ou regras com banco.
- [ ] `npm run check:online` sem vulnerabilidades novas, ou com as encontradas justificadas.
- [ ] `npm run check` passou na Web, quando a entrega altera contrato consumido por ela.
- [ ] Nenhum teste foi desativado, marcado como pulado ou teve limite de cobertura reduzido para passar.

Esses comandos são executados manualmente; o repositório não tem hooks de Git. O GitHub Actions está bloqueado por cobrança, então a falta de execução remota não é aprovação nem reprovação.

Registre o resultado (passou/falhou e a cobertura mínima reportada). Não copie a contagem de testes para documentação permanente.

## 3. Banco de dados e migrations

- [ ] Toda mudança de schema tem migration nova; nenhuma migration aplicada foi editada.
- [ ] `prisma/schema.prisma` e as migrations estão coerentes (o teste de drift da integração passou).
- [ ] Migrations novas foram aplicadas no banco de teste antes dos testes (`npm run migrate:test`).
- [ ] Transformações de dados (backfills, remoções, normalizações) estão descritas no próprio SQL e no README, sem prometer o que o SQL não faz.
- [ ] Migrations que recusam dados incompatíveis têm instrução de saneamento prévio; migrations destrutivas têm orientação de backup.
- [ ] `npm run check:covers` foi executado no banco de destino antes de migrations que validam capas.

## 4. Contas, sessão e e-mail

- [ ] Senhas: política de complexidade e limite de 72 bytes em UTF-8 no cadastro, na redefinição e na alteração autenticada; hash bcrypt persistido, nunca a senha.
- [ ] Sessão: token só em cookie `HttpOnly`, apenas o hash no banco; logout revoga a sessão.
- [ ] Redefinição de senha revoga todas as sessões; alteração autenticada mantém a atual e revoga as demais.
- [ ] Recuperação: resposta neutra antes de consultar conta ou provedor; token de 1 hora, uso único, armazenado como hash; intervalo de 60 segundos por conta.
- [ ] Limites de tentativas de login, troca de senha e recuperação continuam ativos e devolvem os códigos esperados.
- [ ] Logs e respostas não contêm senha, token, hash, cookie nem conteúdo do provedor de e-mail.
- [ ] Links de e-mail usam `FRONTEND_URL` do ambiente e abrem as rotas `/activate/:token` e `/redefinir-senha/:token` da Web.
- [ ] Entrega real pelo Resend conferida no ambiente publicado, quando a entrega altera e-mails ou configuração (testes automatizados simulam o provedor).

## 5. Perfis e autorização

- [ ] Rotas administrativas exigem perfil ativo Administrador **e** atribuição vigente; Usuário Padrão recebe 403.
- [ ] Trocar o perfil ativo não concede nem remove perfis.
- [ ] Conceder ou remover Administrador só vale para outra conta; o último Administrador ativo continua protegido.
- [ ] Rotas de conta usam apenas a identidade da sessão, nunca um id recebido do cliente.

## 6. Conteúdo adulto

- [ ] Visitante, menor de 18 anos e conta sem data de nascimento não veem Obras adultas, Hentai nem gêneros exclusivamente adultos.
- [ ] Conta sem o perfil Administrador vê conteúdo adulto só com maioridade e preferência habilitada.
- [ ] Conta com o perfil Administrador concedido lê conteúdo adulto no catálogo público, e perde essa leitura quando o perfil é removido.
- [ ] Obra com Hentai continua marcada como adulta mesmo quando a requisição envia `false`.

## 7. Catálogo

- [ ] Tipos de obra e gêneros continuam fixos do sistema: a API recusa criar, renomear, excluir ou alterar dependências (403) e a Web não oferece gestão desses valores.
- [ ] Nenhum campo removido (tipo de edição, quantidade de volumes originais) voltou a contratos, schemas ou respostas.
- [ ] Acabamento, formato e miolo nulos aparecem como ausentes, sem valor inventado.
- [ ] Regras de visibilidade: Edição só é publicada com Obra pública e Volume 1 com capa; nada privado aparece nas rotas públicas nem nas contagens.
- [ ] Detalhes do Volume trazem Edição, Obra (`slug`) e miolo herdado; `previousVolume` e `nextVolume` só apontam para Volumes públicos da mesma Edição.
- [ ] Paginação pública limitada a 50 itens por página.

## 8. Capas e mídia

- [ ] Importação só por URL HTTPS pública, com recusa de hosts locais ou privados, limite de redirecionamentos, bytes, pixels e tempo.
- [ ] Nenhuma resposta ou log contém a URL de origem nem credenciais do R2.
- [ ] Obra e Volume continuam exigindo capa; PATCH sem `coverAssetId` preserva a atual e `null` é recusado.
- [ ] Substituição e exclusão colocam a capa antiga em descarte; falhas no R2 mantêm `Descartando` para o `media:cleanup`.
- [ ] Com R2 real: capa importada, exibida pelo domínio de `MEDIA_PUBLIC_BASE_URL` e removida do bucket após substituição ou limpeza.

Procedimentos detalhados em [internal-cover-media.md](internal-cover-media.md).

## 9. Requisitos não funcionais

Para cada requisito tocado pela entrega, registre a evidência coletada e o que ainda depende do ambiente publicado. A redação oficial dos requisitos está no SERS, no [comanga-docs](https://github.com/IsaacLeite1309/comanga-docs).

| Requisito | Mecanismo na API | Evidência a coletar |
| --- | --- | --- |
| RNF01 — Tempo de resposta da busca | Consultas paginadas, índices e trigramas | P95 medido por [capacity-test.md](capacity-test.md) no ambiente alvo |
| RNF02 — Vazão da API pública | — | RPS e taxa de 5xx do teste de capacidade |
| RNF03 — Tráfego e paginação | Limite de 50 itens nos schemas públicos e do catálogo administrativo; contas e valores de listas aceitam até 100 | Testes de schema e tamanho de resposta do teste de capacidade (não há limite global de bytes na API) |
| RNF04 — Entrega de capas | R2 com domínio público e cache imutável | Tempo de carregamento das capas no ambiente publicado |
| RNF05 — Hash de senhas | bcrypt | Testes que comparam senha e hash persistido |
| RNF06 — Sessão stateful e transporte seguro | Cookie `HttpOnly`, hash da sessão, revogação | Testes de sessão; atributos `Secure`/`SameSite` e TLS conferidos no ambiente publicado |
| RNF07 — Controle de acesso | Middleware de perfil ativo e atribuição | Testes de autorização das rotas administrativas |
| RNF08 — Limitação de autenticação | Limitadores em memória | Testes dos limitadores; lembrar que não persistem a reinício nem entre instâncias |
| RNF09 — Transações | Transações e locks no PostgreSQL | Testes de concorrência; R2 e e-mail são externos e tratados à parte |
| RNF10 — Integridade relacional | Constraints, chaves estrangeiras e gatilhos | Testes de integração de integridade e migrations |
| RNF11 — Recuperação de desastres | Fora do código | Política de backup e ensaio de restauração definidos com o responsável |
| RNF12 — Observabilidade e falhas | Logs estruturados com `requestId`, erros sem detalhes internos | Logs de uma execução real e testes do tratamento de erros |
| RNF13 a RNF16 — Interface | Responsabilidade da Web | Checklist da comanga-web e conferência em navegadores e dispositivos reais |

## 10. Documentação

- [ ] README e documentos de `docs/operations` refletem rotas, variáveis, comandos e regras alterados.
- [ ] Nenhum resultado de medição ou validação local foi gravado como estado permanente.
- [ ] Exemplos usam dados fictícios, sem tokens, credenciais ou URLs privadas.
- [ ] Documentos afetados no comanga-docs e na comanga-web foram apontados para atualização.

## 11. Antes de liberar o ambiente publicado

- [ ] Variáveis de ambiente conferidas no painel (sem valores no repositório).
- [ ] `npm run check:covers` sem pendências no banco de destino.
- [ ] Migrations aplicadas com `npm run migrate` no banco de destino.
- [ ] `GET /health/ready` responde 200 após o deploy.
- [ ] Login, ativação, recuperação, catálogo público e importação de capa conferidos no ambiente publicado.
- [ ] `npm run media:cleanup` executado, se a entrega deixou capas em descarte e não há rollback previsto.

Não preencha datas de nascimento fictícias nem exclua contas ou registros do catálogo para fazer uma verificação passar.
