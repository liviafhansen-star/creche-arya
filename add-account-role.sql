-- Papel da conta: tutor | creche
alter table public.creche_profile add column if not exists account_role text default 'tutor';
