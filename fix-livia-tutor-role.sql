-- Trava liviafhansen123@gmail.com como tutor (nunca creche)
update public.creche_profile p
set account_role = 'tutor'
from auth.users u
where p.user_id = u.id
  and lower(u.email) = lower('liviafhansen123@gmail.com');

-- Opcional: qualquer perfil sem papel vira tutor (seguro para contas antigas de família)
update public.creche_profile
set account_role = 'tutor'
where account_role is null or account_role = '';
