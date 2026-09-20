# Modelo de segurança

## Fronteiras de confiança

O navegador é **não confiável**. Tudo que importa é imposto no Postgres (RLS + triggers `security definer`).
A chave `sb_publishable_…` em `js/config.js` é pública por desenho; ela só dá acesso ao que a RLS permite.
**Nunca** coloque `service_role`/`sb_secret_…` em nenhum arquivo do repositório (o teste `wiring.test.js` falha se aparecer).

## Papéis

| Regra | Onde é imposta |
|---|---|
| Quem pode ser "creche" | tabela `creche_allowlist` (sem acesso via API) + trigger `handle_new_user` em `auth.users`. E-mails `@creche.caotrole.app` fora da lista são recusados no cadastro |
| `account_role` não muda | trigger `creche_profile_guard` (INSERT força o papel pelo e-mail; UPDATE de papel dá erro) |
| Creche só vê os **seus** tutores | funções `my_creche_ids()`, `my_linked_creche()`, `is_my_tutor()` usadas nas policies; `creche_id` do check-in/pet vem do vínculo (trigger), nunca do cliente |
| Creche só marca "visto" no check-in | trigger `day_checkins_guard` |
| Tutor não se auto-confirma pagamento; confirmado não é editável/apagável pelo tutor | trigger `payments_guard` + policies `update/delete` com `status <> 'confirmado'` |
| Tutor não altera pet de outro / creche não altera pet de tutor | policies de `pets` + trigger `pets_guard` |

Cobertura: `supabase/tests/rls.sql` (45 verificações, rodam em transação com `ROLLBACK`).

## Arquivos (bucket `creche-anexos`)

Privado; 5 MB; JPEG/PNG/WEBP/HEIC/PDF. Escrita apenas na própria pasta `<uid>/…`. Leitura: dono, ou quem enxerga a linha que
referencia o arquivo (`creche_payments.attachment_path`, `pets.photo_path`, `creches.photo_path`) — a própria RLS dessas tabelas decide.
O app usa URLs assinadas de 1 h. Nomes de arquivo são sanitizados (`Pure.safeFileName`).

> Objetos antigos em `payments/…` e `profile/…` (sem pasta do usuário) continuam acessíveis por essa regra de referência.

## Front-end

- CSP: `script-src 'self'` (sem `unsafe-inline`/`unsafe-eval`), `frame-ancestors 'none'`, `object-src 'none'`, `connect-src` só `self` + `*.supabase.co`.
  `style-src` mantém `'unsafe-inline'` (atributos `style=` em poucos pontos e estilos injetados pelo Cropper).
- Bibliotecas em `vendor/` com versão fixa (nada de CDN flutuante).
- Todo dado do usuário em HTML passa por `esc()`; nenhum `onclick` inline (`data-act` + delegação). `tests/wiring.test.js` valida ambos.
- CSV exportado neutraliza injeção de fórmula (`=`, `+`, `-`, `@`).
- `UPDATE` que afeta 0 linhas vira erro visível (`updateOne`) — nada de "✓ salvo" falso.

## Observabilidade

Falhas reais (erros do Supabase, exceções de JS) vão para `public.client_errors` (insert-only, por usuário) com o código
de correlação mostrado ao usuário no toast (`cód. xxxx-n`). Erros de validação (digitação) não são enviados.
Leitura só pelo painel/`service_role`. Retenção sugerida: 90 dias (`delete from client_errors where created_at < now() - interval '90 days'`).

## Limites de abuso

- Cadastro/login: limites nativos do Supabase Auth (ajuste em Auth → Rate Limits).
- Escritas do cliente: constraints de tamanho/valor nas tabelas; uploads limitados pelo bucket.
- Convite: código de 8 caracteres hexadecimais (~4 bilhões); tentativas contam nos limites da API.

## Pendências que dependem do painel do Supabase (não versionáveis)

- Ativar **Leaked password protection** (Auth → Password security).
- Redirect URL de recuperação de senha (`/redefinir-senha`).
- (Opcional) 2º projeto para desenvolvimento e agendar a limpeza de `client_errors`.
