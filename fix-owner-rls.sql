-- VERIFICAR + CORRIGIR dono dos dados (Arya = só liviafhansen123@gmail.com)

-- 1) Quem é quem no Auth
select id, email, created_at from auth.users order by created_at;

-- 2) Perfis hoje
select p.user_id, u.email, p.name, p.pix_key
from public.creche_profile p
left join auth.users u on u.id = p.user_id;

-- 3) Contagem de idas por dono
select u.email, count(*) as idas
from public.creche_records r
left join auth.users u on u.id = r.user_id
group by u.email;

-- 4) CORREÇÃO: tudo que existe vai para a Livia; contas novas ficam sem essas linhas
do $$
declare livia uuid;
declare maiquel uuid;
begin
  select id into livia from auth.users where lower(email) = lower('liviafhansen123@gmail.com') limit 1;
  if livia is null then
    raise exception 'liviafhansen123@gmail.com nao encontrada no Auth';
  end if;

  select id into maiquel from auth.users where lower(email) = lower('maaiquels@gmail.com') limit 1;

  -- move TODO o conteúdo atual para a Livia
  update public.creche_profile set user_id = livia;
  update public.creche_records set user_id = livia;
  update public.creche_payments set user_id = livia;
  update public.creche_app_message set user_id = livia;
  update public.creche_custom_messages set user_id = livia;

  -- apaga perfil/mensagem vazios duplicados do Maiquel (se existirem), para ele recomeçar limpo
  if maiquel is not null then
    delete from public.creche_profile where user_id = maiquel;
    delete from public.creche_app_message where user_id = maiquel;
    delete from public.creche_records where user_id = maiquel;
    delete from public.creche_payments where user_id = maiquel;
    delete from public.creche_custom_messages where user_id = maiquel;
  end if;
end $$;

-- 5) RLS à força + só dono vê
alter table public.creche_profile enable row level security;
alter table public.creche_records enable row level security;
alter table public.creche_payments enable row level security;
alter table public.creche_app_message enable row level security;
alter table public.creche_custom_messages enable row level security;

alter table public.creche_profile force row level security;
alter table public.creche_records force row level security;
alter table public.creche_payments force row level security;
alter table public.creche_app_message force row level security;
alter table public.creche_custom_messages force row level security;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname='public'
      and tablename in ('creche_profile','creche_records','creche_payments','creche_app_message','creche_custom_messages')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy creche_profile_own on public.creche_profile for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_records_own on public.creche_records for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_payments_own on public.creche_payments for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_app_message_own on public.creche_app_message for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_custom_messages_own on public.creche_custom_messages for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 6) Conferência final
select u.email, p.name from public.creche_profile p join auth.users u on u.id = p.user_id;
select u.email, count(*) from public.creche_records r join auth.users u on u.id = r.user_id group by u.email;