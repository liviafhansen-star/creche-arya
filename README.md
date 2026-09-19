# Creche pet — controle financeiro

App da creche da Arya — https://creche-arya.vercel.app/

Multi-tenant (cada conta vê só os seus dados), PIX, rotas por tela, landing tutor/creche.

## Deploy

Commit/push neste GitHub e redeploy na Vercel (`vercel --prod` com a CLI).

## SQL (Supabase)

Rodar no SQL Editor quando necessário: `migrate-multitenant.sql`, `fix-owner-rls.sql`, `add-pix-keys.sql`, `add-account-role.sql`.
