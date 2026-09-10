# Revisão de qualidade — autenticação e capas

Escopo: branch `feature/resend-autenticacao-capas`, baseada na develop após os PRs de qualidade. Evidências locais de implementação não confirmam configuração ou desempenho em produção. PDFs e PNGs não foram alterados.

| Requisito SERS / cenário ATAM | Situação | Evidência e limite |
| --- | --- | --- |
| RNF01 — Busca P95 até 500 ms | Parcialmente atendido | Índices e consultas paginadas; medição representativa continua pendente em `capacity-test.md`. |
| RNF02 — 20 RPS e falhas abaixo de 1% | Parcialmente atendido | Script de carga disponível; não foi executado contra o ambiente de destino. |
| RNF03 — Paginação e payload até 2 MB | Parcialmente atendido | Schemas limitam páginas a 50, com testes; limite global de bytes não é imposto. |
| RNF04 — Capas externas ao banco | Parcialmente atendido | R2, variantes e chaves internas testados; TTFB P90 até 300 ms do ATAM não foi medido. |
| RNF05 — Hash de senha | Atendido | Bcrypt no cadastro e redefinição; teste compara senha com hash persistido. |
| RNF06 — Sessão stateful e transporte seguro | Parcialmente atendido | Hash da sessão, HttpOnly e revogação testados, inclusive após reset; cookies/CORS/TLS reais dependem do deploy. |
| RNF07 — RBAC no backend | Atendido | Middleware exige Administrador; teste real permite admin menor na administração e recusa usuário comum. |
| RNF08 — Limitação de login | Parcialmente atendido | Limite por IP e expiração testados; armazenamento em memória não sobrevive a reinício nem coordena instâncias. |
| RNF09 — Transações | Parcialmente atendido | Senha/sessões e associação/descarte de capas coordenados no PostgreSQL; R2 e e-mail são externos, com falhas tratadas separadamente. |
| RNF10 — Integridade relacional | Atendido | Migrations, NOT NULL, FKs RESTRICT e triggers; concorrência de associação/exclusão testada. Aplicação em dados existentes exige saneamento prévio. |
| RNF11 — Recuperação de desastres | Não atendido | Sem evidência de backups com retenção ou restauração que comprove RPO/RTO exigidos. Definir e ensaiar com o responsável. |
| RNF12 — Erros e observabilidade | Parcialmente atendido | Erros globais, requestId e rotas sem tokens; vários erros funcionais ainda usam apenas `error`, sem código uniforme. |
| RNF13 — Feedback semântico | Parcialmente atendido | Estados de espera, sucesso e erro testados; nem todos os fluxos usam os tempos/toasts exatos do SERS. |
| RNF14 — Responsividade | Parcialmente atendido | Layout responsivo existente e conferência local das novas telas; falta validação completa em dispositivos e navegadores reais. |
| RNF15 — Geometria e fallback das capas | Parcialmente atendido | Componente compartilhado e associação obrigatória; falha real de mídia no deploy não foi exercitada. |
| RNF16 — Estados vazios | Parcialmente atendido | Componentes e testes das principais páginas; não houve validação manual de todos os estados no ambiente final. |

## Aceite funcional local

- Testes automatizados simulam o Resend. Na validação local integrada, a API enviou ativação e recuperação reais; ambos os e-mails tiveram entrega confirmada pelo Resend.
- Recuperação responde antes da consulta/envio, sem indicar existência da conta nem depender da latência do provedor.
- O token é separado da ativação, armazenado como hash, válido por uma hora e consumido uma vez. Emissões por conta respeitam 60 segundos, inclusive após consumo ou falha de envio, mantendo a resposta neutra.
- Cadastro/reset recusam senhas acima de 72 bytes em UTF-8; login legado preservado. O frontend compartilha a validação e limpa os formulários ao mudar de rota ou token.
- Cadastro novo exige data válida; maioridade é calculada em UTC. Contas antigas sem data permanecem com +18 público bloqueado até saneamento autorizado.
- Capas são obrigatórias; omissão no PATCH preserva a atual. Falhas de exclusão no R2 mantêm o estado de descarte para nova tentativa; a limpeza geral de até 20 pendências ocorre pelo comando `media:cleanup`, fora das requisições.
- Consulta pública conta somente volumes públicos. Permissões administrativas continuam independentes da preferência pública.

## Antes de liberar o ambiente final

Configurar `RESEND_API_KEY`, `RESEND_FROM` e `FRONTEND_URL` somente no backend, verificar o domínio no Resend e testar entrega real. Executar `check:covers`, fornecer capas reais aos registros pendentes e aplicar as migrations no ambiente autorizado. Não preencher datas fictícias nem excluir contas ou catálogo para passar a validação. Medições de desempenho, backups e ensaio de restauração continuam como tarefas operacionais separadas.

## Última validação do código

As correções foram validadas localmente: uso único concorrente do token, intervalo de emissão por conta, limite de senha em bytes, login legado, navegação dos formulários e proteção das capas durante exclusão. Logs usam templates de rota e erros de autenticação omitem detalhes sensíveis.

| Verificação | Resultado |
| --- | --- |
| API: `npm run check` | Passou: lint, build e 455 testes unitários; cobertura mínima por métrica 82,78%. |
| API: `npm run check:integration` | Passou: 31 migrations sem pendências e 561 testes; cobertura acima de 80% em todas as métricas. |
| Web: `npm run check` | Passou: lint, tipos, build e 269 testes; cobertura mínima por métrica 81,69%. |
| API: `npm run check:online` | Zero vulnerabilidades conhecidas após remover Nodemailer e nodemon. |
| `npm run check:covers` no banco temporário | Zero referências ausentes ou compartilhadas indevidamente. |
| Interface no navegador | Login, perfil, catálogo, detalhes de Obra/Edição/Volume e formulário administrativo conferidos com a conta local de validação; capas reais do R2 renderizadas. |

Foram alterados autenticação/notificações, middlewares de log/idade, schema e migrations, ciclo de capas, consulta pública, formulários e testes relacionados. Resend usa `src/utils/mailer.ts` e `src/infrastructure/mail/ResendMailService.ts`; recuperação fica em `src/modules/auth/passwordRecovery.ts`; regras de idade em `accountRules.ts`; a migração de capas concentra a sincronização PostgreSQL.

Ambiente local: Node 24.20.0 e PostgreSQL 17.11, bancos locais `comanga_resend_test` (suíte automatizada) e `comanga_acceptance_test` (validação integrada). O CI usa Node 22/PostgreSQL 16; seus resultados devem ser consultados nos PRs. A validação descrita aqui é local e não inclui deploy. Envio real pelo Resend e operações reais no R2 foram testados pela aplicação local. O banco remoto e o saneamento dos dados de deploy não foram alterados.

Nesta conferência documental, o README web foi restaurado à estrutura original e atualizado somente nos pontos da entrega. A porta de `FRONTEND_URL` no exemplo da API foi alinhada ao Vite (8080). Requisitos e cenários permanecem nas seções originais; a documentação separa implementação local de validação do deploy. Nenhuma regra funcional ou migration foi alterada nesta conferência.

## Validação local integrada com serviços reais

API em `http://127.0.0.1:3000` e frontend em `http://localhost:8080`, usando exclusivamente o banco local `comanga_acceptance_test`. As 31 migrations foram aplicadas em banco novo, sem reset ou alterações no banco remoto. Credenciais permanecem no `.env` ignorado pelo Git e no armazenamento seguro do CLI.

- Cadastro com data inválida recusado; cadastro válido seguido de ativação por token real e recusa de reutilização.
- Recuperação com resposta neutra, e-mail real, redefinição, recusa da senha antiga e do link reutilizado, revogação da sessão anterior e login com a senha nova.
- Senha longa recusada, intervalo por conta preservado e nascimento privado. Maioridade/preferência verificadas para adulto, menor e conta sem nascimento; exceção administrativa preservada.
- Opções, Obra, Edição e Volume criados pelo backend local. Criação sem capa recusada; PATCH com capa omitida preserva o ativo e com `null` é recusado.
- Cinco capas de teste importadas e processadas no R2: três permanecem associadas ao catálogo local; a capa substituída e a capa pendente descartada tiveram arquivos e variantes removidos, confirmados diretamente no bucket.
- Imagens públicas do R2 carregaram via HTTP e no navegador. Conteúdo privado/+18 foi filtrado; volume privado foi omitido da listagem e da contagem pública.
- `check:covers` retornou zero referências ausentes e zero capas compartilhadas. A conferência dos logs não encontrou as chaves configuradas, hashes de credenciais ou tokens nos caminhos registrados.

Os 561 testes da API e 269 do frontend passaram novamente, junto de lint, build e cobertura mínima. Os envios reais e o R2 foram verificados separadamente desses testes. Essa evidência é local: não comprova desempenho, backups, navegadores/dispositivos não exercitados nem deploy da futura conta Resend com domínio.
