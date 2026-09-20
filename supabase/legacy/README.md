# ⚠ Legado — NÃO EXECUTAR

Scripts SQL soltos (`add-*`, `fix-*`, `migrate-multitenant.sql`) que foram rodados à mão no SQL Editor durante o desenvolvimento inicial.
Ficam aqui só como histórico. O estado do banco agora é definido por `../migrations/` (aplicar em ordem) e verificado por `../tests/rls.sql`.

Vários deles são **perigosos hoje**: derrubam todas as policies e recriam versões permissivas, ou definem o papel de creche por e-mail.
Já foi removido do repositório o `fix-owner-rls.sql` (movia todos os dados para uma conta com `UPDATE` sem `WHERE`).
