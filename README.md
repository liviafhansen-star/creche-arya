# Cãotrole Financeiro

PWA estática (HTML/CSS/JS puro, sem build) + Supabase (Auth, Postgres com RLS, Storage, Realtime) + Vercel.
Produção: https://creche-arya.vercel.app/

Dois papéis, decididos **no servidor**:

| Papel | O que faz |
|---|---|
| **Tutor** | cadastra pets, faz *check-in* do dia, acompanha presença confirmada pela creche, calendário, pagamentos com comprovante, mensagens no WhatsApp |
| **Creche** | board do dia (estado único por pet), cães/famílias, tutores, financeiro (a receber, comprovantes, atrasos, CSV), valores e PIX |

O tutor entra na creche com um **código de convite** (Perfil → Creche). A partir daí os check-ins, a presença e os
comprovantes dele ficam visíveis **só** para essa creche.

## Rodar localmente

```bash
npm run dev        # http://localhost:5173  (usa o Supabase configurado em js/config.js)
npm run dev:fake   # mesmo servidor, mas com um Supabase FALSO em memória (tests/e2e/fake-supabase.js)
npm run check      # lint + todos os testes
```

Contas do modo `dev:fake` (senha `senha1234`): `tutor@teste.com` (tutor, já vinculada) e `dono@creche.caotrole.app` (creche).

## Estrutura

```
index.html · style.css · sw.js · manifest.webmanifest · privacidade.html · vercel.json
js/
  config.js      ambientes (produção / desenvolvimento) e versão exigida do schema
  lib/pure.js    funções puras (validações, preços, cobertura de pagamentos, estado do dia) — testadas no Node
  core.js        cliente Supabase, estado, erros com código de correlação, toasts, modal acessível, eventos delegados
  auth.js        login, cadastro, recuperação de senha, exportar/excluir conta
  router.js      rotas /tutor/* e /creche/*, navegação
  shared.js      PIX, foto (recorte + upload privado), UPDATE que falha em voz alta
  tutor.js · creche.js · main.js
supabase/
  migrations/    schema versionado (aplicar em ordem)      tests/rls.sql   testes de RLS/Storage (rodam em ROLLBACK)
  legacy/        scripts antigos — NÃO rodar (histórico)
tests/           node --test (unidade, fiação, segurança estática)
vendor/          supabase-js e cropperjs versionados no repositório (sem CDN → CSP restrito)
```

Sem `onclick` inline: toda interação usa `data-act` / `data-input` / `data-change` / `data-submit`
(`core.js` delega os eventos). É o que permite `script-src 'self'` no CSP. O teste `tests/wiring.test.js` garante isso.

## Deploy — checklist "banco = app"

O app confere `app_schema.version` no boot e **se recusa a iniciar** com o banco desatualizado
(faixa vermelha). Por isso a ordem importa:

1. Aplicar a migration nova no Supabase (`supabase/migrations/…`) — antes de publicar o front.
2. Rodar `supabase/tests/rls.sql` dentro de `begin; … rollback;` (deve terminar com `falhas = 0`).
3. Subir o front (push na `main` → Vercel). Se mudou `sw.js`/assets, suba a versão (`sw.js`, `js/config.js` e os `?v=` — o teste confere).
4. No painel do Supabase: Auth → *URL Configuration* com `https://creche-arya.vercel.app/redefinir-senha` em *Redirect URLs*; Auth → *Password security*: ativar **Leaked password protection**.

Para liberar uma nova creche (acesso é por convite, decidido no banco, não no JS):

```sql
insert into public.creche_allowlist (email) values ('email.da.creche@exemplo.com');
-- a pessoa cria a conta em /creche/cadastro com esse e-mail; o trigger cria a creche e o vínculo de dona.
```

## Ambientes

`js/config.js` tem `ENVS.production` e `ENVS.development`. Crie um 2º projeto Supabase, aplique as migrations e
preencha `development.url/key`: localhost e previews da Vercel passam a usar o banco de desenvolvimento.
Enquanto estiver vazio, esses hosts usam o banco de produção **e mostram uma faixa amarela de aviso**.

## Segurança (resumo — detalhes em `docs/SECURITY.md`)

RLS em todas as tabelas · papel (`account_role`) imutável pelo usuário e definido por allowlist no servidor ·
creche só enxerga tutores vinculados · bucket privado com URLs assinadas e limite de tipo/tamanho ·
CSP + cabeçalhos no `vercel.json` · HTML sempre escapado (`esc()`), sem handlers inline · exclusão de conta e exportação de dados (LGPD).
