-- 1) Cria a coluna (faltava no banco)
alter table public.creche_profile
  add column if not exists account_role text default 'tutor';

-- 2) Trava liviafhansen123@gmail.com como tutor (nunca creche)
update public.creche_profile p
set account_role = 'tutor'
from auth.users u
where p.user_id = u.id
  and lower(u.email) = lower('liviafhansen123@gmail.com');

-- 3) Perfis sem papel viram tutor
update public.creche_profile
set account_role = 'tutor'
where account_role is null or account_role = '';
