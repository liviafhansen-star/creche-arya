-- Cole no SQL Editor do Supabase (projeto creche-arya) e clique Run
-- Vincula TODOS os registros atuais à liviafhansen123@gmail.com
-- Contas novas passam a ver só os próprios dados (vazio no início)

alter table public.creche_profile add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.creche_records add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.creche_payments add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.creche_app_message add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.creche_custom_messages add column if not exists user_id uuid references auth.users(id) on delete cascade;

do $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower('liviafhansen123@gmail.com') limit 1;
  if uid is null then
    raise exception 'Conta liviafhansen123@gmail.com nao existe em Authentication > Users. Crie/entre com esse e-mail antes.';
  end if;
  update public.creche_profile set user_id = uid where user_id is null or user_id <> uid;
  update public.creche_records set user_id = uid where user_id is null;
  update public.creche_payments set user_id = uid where user_id is null;
  update public.creche_app_message set user_id = uid where user_id is null;
  update public.creche_custom_messages set user_id = uid where user_id is null;
end $$;

create unique index if not exists creche_profile_user_id_uidx on public.creche_profile(user_id);
create unique index if not exists creche_app_message_user_id_uidx on public.creche_app_message(user_id);

do $$ begin
  alter table public.creche_records drop constraint if exists creche_records_pkey;
exception when others then null; end $$;

update public.creche_records set user_id = (select id from auth.users where lower(email)=lower('liviafhansen123@gmail.com') limit 1) where user_id is null;
alter table public.creche_records alter column user_id set not null;
do $$ begin
  alter table public.creche_records add primary key (user_id, date);
exception when others then null; end $$;

alter table public.creche_profile alter column user_id set not null;
alter table public.creche_app_message alter column user_id set not null;
alter table public.creche_payments alter column user_id set not null;
alter table public.creche_custom_messages alter column user_id set not null;

alter table public.creche_profile enable row level security;
alter table public.creche_records enable row level security;
alter table public.creche_payments enable row level security;
alter table public.creche_app_message enable row level security;
alter table public.creche_custom_messages enable row level security;

-- Remove policies antigas permissivas (causa do vazamento)
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('creche_profile','creche_records','creche_payments','creche_app_message','creche_custom_messages')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy creche_profile_own on public.creche_profile for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_records_own on public.creche_records for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_payments_own on public.creche_payments for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_app_message_own on public.creche_app_message for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_custom_messages_own on public.creche_custom_messages for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);