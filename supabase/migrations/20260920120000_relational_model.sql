-- =====================================================================
-- Cãotrole — migration 0001 (schema versão 1)
-- Modelo relacional + vínculo tutor↔creche + papéis no servidor + Storage privado.
--
-- Estado de partida = o que está em produção (migrations creche_arya_init …
-- add_paid_through_and_auth_lockdown). Esta migration é ADITIVA nas tabelas de
-- dados: nenhuma coluna de dados é removida (clients/attendance/price_* ficam
-- como legado até uma migration futura).
--
-- Validar sem persistir:  begin; \i esta_migration.sql; \i ../tests/rls.sql; rollback;
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Versão do schema (o front confere "banco = app" no boot)
-- ---------------------------------------------------------------------
create table if not exists public.app_schema (
  version    int primary key,
  applied_at timestamptz not null default now()
);
alter table public.app_schema enable row level security;
drop policy if exists app_schema_read on public.app_schema;
create policy app_schema_read on public.app_schema for select to anon, authenticated using (true);
insert into public.app_schema (version) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. Corrige a chave primária de creche_profile / creche_app_message
--    (era id smallint default 1 check (id = 1): cabia UMA linha no banco todo)
-- ---------------------------------------------------------------------
alter table public.creche_profile drop constraint if exists creche_profile_pkey;
alter table public.creche_profile drop column if exists id;
drop index if exists public.creche_profile_user_id_uidx;
alter table public.creche_profile add primary key (user_id);

alter table public.creche_app_message drop constraint if exists creche_app_message_pkey;
alter table public.creche_app_message drop column if exists id;
drop index if exists public.creche_app_message_user_id_uidx;
alter table public.creche_app_message add primary key (user_id);

alter table public.creche_profile alter column name set default '';
alter table public.creche_profile alter column days set default '[]'::jsonb;
alter table public.creche_profile alter column weekend_overnight set default 'Não';
alter table public.creche_profile alter column account_role set default 'tutor';
alter table public.creche_app_message alter column text set default '';

-- ---------------------------------------------------------------------
-- 2. Quem pode ser "creche": lista no SERVIDOR (substitui a allowlist do JS)
-- ---------------------------------------------------------------------
create table if not exists public.creche_allowlist (
  email      text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.creche_allowlist enable row level security;   -- sem policy: ninguém via API
revoke all on public.creche_allowlist from anon, authenticated;

-- contas de creche que já existem continuam valendo (sem e-mails no repositório)
insert into public.creche_allowlist (email)
select lower(email) from auth.users where email ilike '%@creche.caotrole.app'
on conflict do nothing;

create or replace function public.role_for_email(p_email text)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from public.creche_allowlist where email = lower(p_email))
              then 'creche' else 'tutor' end
$$;
revoke all on function public.role_for_email(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Tabelas novas
-- ---------------------------------------------------------------------
create table if not exists public.creches (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null default '' check (length(name) <= 80),
  invite_code        text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  price_day          numeric(10,2) not null default 40 check (price_day >= 0),
  price_over         numeric(10,2) not null default 60 check (price_over >= 0),
  price_weekend_day  numeric(10,2) not null default 0  check (price_weekend_day >= 0),
  price_weekend_over numeric(10,2) not null default 70 check (price_weekend_over >= 0),
  phone              text not null default '' check (length(phone) <= 20),
  pix_keys           jsonb not null default '[]'::jsonb,
  photo_path         text,
  created_at         timestamptz not null default now()
);

create table if not exists public.creche_members (
  creche_id  uuid not null references public.creches(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now(),
  primary key (creche_id, user_id)
);
create index if not exists creche_members_user_idx on public.creche_members (user_id);

-- v1: um tutor pertence a UMA creche (unique). Trocar de creche = sair e entrar de novo.
create table if not exists public.tutor_links (
  id            uuid primary key default gen_random_uuid(),
  creche_id     uuid not null references public.creches(id) on delete cascade,
  tutor_user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);
create index if not exists tutor_links_creche_idx on public.tutor_links (creche_id);

create table if not exists public.pets (
  id                uuid primary key default gen_random_uuid(),
  tutor_user_id     uuid references auth.users(id) on delete cascade,   -- null = cadastrado manualmente pela creche
  creche_id         uuid references public.creches(id) on delete set null,
  name              text not null check (length(btrim(name)) between 1 and 60),
  breed             text not null default '' check (length(breed) <= 60),
  birth_date        date,
  photo_path        text,
  weekdays          smallint[] not null default '{}' check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  overnight_weekday boolean not null default false,
  overnight_weekend boolean not null default false,
  tutor_name        text not null default '' check (length(tutor_name) <= 80),
  tutor_phone       text not null default '' check (length(tutor_phone) <= 20),
  notes             text not null default '' check (length(notes) <= 500),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists pets_tutor_idx  on public.pets (tutor_user_id);
create index if not exists pets_creche_idx on public.pets (creche_id);

create table if not exists public.attendance (
  id         uuid primary key default gen_random_uuid(),
  creche_id  uuid not null references public.creches(id) on delete cascade,
  pet_id     uuid not null references public.pets(id) on delete cascade,
  day        date not null,
  status     text not null check (status in ('presente', 'saiu', 'faltou')),
  overnight  boolean not null default false,
  arrived_at timestamptz,
  left_at    timestamptz,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (pet_id, day)
);
create index if not exists attendance_creche_day_idx on public.attendance (creche_id, day);

-- day_checkins: agora por pet e por creche
alter table public.day_checkins add column if not exists pet_id    uuid references public.pets(id) on delete cascade;
alter table public.day_checkins add column if not exists creche_id uuid references public.creches(id) on delete set null;
alter table public.day_checkins add column if not exists seen_at   timestamptz;
alter table public.day_checkins add column if not exists seen_by   uuid references auth.users(id) on delete set null;
alter table public.day_checkins drop constraint if exists day_checkins_user_id_day_key;
alter table public.day_checkins drop constraint if exists day_checkins_pet_day_key;
alter table public.day_checkins add constraint day_checkins_pet_day_key unique (pet_id, day);   -- constraint (não índice parcial): o upsert do app usa ON CONFLICT (pet_id, day)
create index if not exists day_checkins_creche_day_idx on public.day_checkins (creche_id, day);

-- pagamentos: confirmação pela creche
alter table public.creche_payments add column if not exists status       text not null default 'enviado' check (status in ('enviado', 'confirmado', 'recusado'));
alter table public.creche_payments add column if not exists confirmed_at timestamptz;
alter table public.creche_payments add column if not exists confirmed_by uuid references auth.users(id) on delete set null;

-- erros do cliente (observabilidade sem serviço de terceiros)
create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  session_id text not null check (length(session_id) <= 64),
  ctx        text not null check (length(ctx) <= 120),
  message    text not null check (length(message) <= 1000),
  stack      text check (length(stack) <= 4000),
  url        text check (length(url) <= 300),
  created_at timestamptz not null default now()
);
alter table public.client_errors enable row level security;

-- ---------------------------------------------------------------------
-- 4. Funções auxiliares (security definer: evitam recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.my_creche_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select creche_id from public.creche_members where user_id = auth.uid()
$$;

create or replace function public.my_linked_creche()
returns uuid language sql stable security definer set search_path = '' as $$
  select creche_id from public.tutor_links where tutor_user_id = auth.uid() limit 1
$$;

create or replace function public.is_my_tutor(p_uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tutor_links l
    join public.creche_members m on m.creche_id = l.creche_id
    where l.tutor_user_id = p_uid and m.user_id = auth.uid()
  )
$$;

revoke all on function public.my_creche_ids(), public.my_linked_creche(), public.is_my_tutor(uuid) from public, anon;
grant execute on function public.my_creche_ids(), public.my_linked_creche(), public.is_my_tutor(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Triggers de segurança
-- ---------------------------------------------------------------------

-- 5a. Cadastro: bloqueia @creche.caotrole.app fora da allowlist e cria o perfil no servidor
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.email) like '%@creche.caotrole.app'
     and not exists (select 1 from public.creche_allowlist where email = lower(new.email)) then
    raise exception 'creche_not_allowed';
  end if;
  insert into public.creche_profile (user_id, account_role)
    values (new.id, public.role_for_email(new.email)) on conflict (user_id) do nothing;
  insert into public.creche_app_message (user_id, text)
    values (new.id, '') on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5b. account_role é decidido pelo servidor e imutável para o usuário
create or replace function public.creche_profile_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      select email into v_email from auth.users where id = new.user_id;
      new.account_role := public.role_for_email(v_email);
    end if;
    return new;
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id é imutável';
  end if;
  if auth.uid() is not null and new.account_role is distinct from old.account_role then
    raise exception 'account_role é imutável';
  end if;
  return new;
end $$;
revoke all on function public.creche_profile_guard() from public, anon, authenticated;
drop trigger if exists creche_profile_guard_trg on public.creche_profile;
create trigger creche_profile_guard_trg before insert or update on public.creche_profile
  for each row execute function public.creche_profile_guard();

-- 5c. Toda conta de creche ganha uma creche + vínculo de dona
create or replace function public.provision_creche()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if new.account_role = 'creche'
     and not exists (select 1 from public.creche_members where user_id = new.user_id) then
    insert into public.creches (name, price_day, price_over, pix_keys)
      values (coalesce(nullif(btrim(new.name), ''), 'Minha creche'),
              coalesce(new.price_day, 40), coalesce(new.price_over, 60),
              coalesce(new.pix_keys, '[]'::jsonb))
      returning id into v_id;
    insert into public.creche_members (creche_id, user_id, role) values (v_id, new.user_id, 'owner');
  end if;
  return new;
end $$;
revoke all on function public.provision_creche() from public, anon, authenticated;
drop trigger if exists provision_creche_trg on public.creche_profile;
create trigger provision_creche_trg after insert on public.creche_profile
  for each row execute function public.provision_creche();

-- 5d. Pets: o servidor decide a creche do pet de um tutor
create or replace function public.pets_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    if new.tutor_user_id is not null then
      if new.tutor_user_id <> auth.uid() then raise exception 'pet de outro tutor'; end if;
      new.creche_id := public.my_linked_creche();
    else
      if new.creche_id is null or not (new.creche_id in (select public.my_creche_ids())) then
        raise exception 'creche inválida';
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.pets_guard() from public, anon, authenticated;
drop trigger if exists pets_guard_trg on public.pets;
create trigger pets_guard_trg before insert or update on public.pets
  for each row execute function public.pets_guard();

-- 5e. Check-in: creche vem do vínculo; a creche só pode marcar "visto"
create or replace function public.day_checkins_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_seen timestamptz;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.creche_id := public.my_linked_creche();
    new.seen_at := null; new.seen_by := null;
    new.updated_at := now();
    return new;
  end if;
  if auth.uid() <> old.user_id then            -- creche: só "visto"
    v_seen := new.seen_at;
    new := old;
    new.seen_at := coalesce(v_seen, now());
    new.seen_by := auth.uid();
    return new;
  end if;
  new.creche_id := public.my_linked_creche();  -- tutor
  new.updated_at := now();
  if new.status is distinct from old.status then new.seen_at := null; new.seen_by := null;
  else new.seen_at := old.seen_at; new.seen_by := old.seen_by; end if;
  return new;
end $$;
revoke all on function public.day_checkins_guard() from public, anon, authenticated;
drop trigger if exists day_checkins_guard_trg on public.day_checkins;
create trigger day_checkins_guard_trg before insert or update on public.day_checkins
  for each row execute function public.day_checkins_guard();

-- 5f. Presença: carimbos de horário e autoria no servidor
create or replace function public.attendance_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  if new.status = 'presente' and (tg_op = 'INSERT' or old.status is distinct from 'presente') then
    new.arrived_at := now(); new.left_at := null;
  elsif new.status = 'saiu' and (tg_op = 'INSERT' or old.status is distinct from 'saiu') then
    new.left_at := now();
    if tg_op = 'UPDATE' then new.arrived_at := coalesce(old.arrived_at, new.arrived_at); end if;
  elsif new.status = 'faltou' then
    new.arrived_at := null; new.left_at := null;
  end if;
  if not (new.creche_id in (select public.my_creche_ids())) and auth.uid() is not null then
    raise exception 'creche inválida';
  end if;
  return new;
end $$;
revoke all on function public.attendance_guard() from public, anon, authenticated;
drop trigger if exists attendance_guard_trg on public.attendance;
create trigger attendance_guard_trg before insert or update on public.attendance
  for each row execute function public.attendance_guard();

-- 5g. Pagamentos: tutor não se auto-confirma; creche só altera o status
create or replace function public.payments_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'enviado'; new.confirmed_at := null; new.confirmed_by := null;
    return new;
  end if;
  if auth.uid() <> old.user_id then
    v_status := new.status;
    new := old;
    new.status := v_status;
    new.confirmed_at := now();
    new.confirmed_by := auth.uid();
    return new;
  end if;
  new.status := old.status; new.confirmed_at := old.confirmed_at; new.confirmed_by := old.confirmed_by;
  return new;
end $$;
revoke all on function public.payments_guard() from public, anon, authenticated;
drop trigger if exists payments_guard_trg on public.creche_payments;
create trigger payments_guard_trg before insert or update on public.creche_payments
  for each row execute function public.payments_guard();

-- ---------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------
create or replace function public.join_creche(p_code text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_creche uuid;
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  if exists (select 1 from public.creche_profile where user_id = auth.uid() and account_role = 'creche') then
    raise exception 'creche_nao_pode_vincular';
  end if;
  select id into v_creche from public.creches where invite_code = upper(btrim(p_code));
  if v_creche is null then raise exception 'codigo_invalido'; end if;
  insert into public.tutor_links (creche_id, tutor_user_id) values (v_creche, auth.uid())
    on conflict (tutor_user_id) do update set creche_id = excluded.creche_id;
  update public.pets set creche_id = v_creche where tutor_user_id = auth.uid();
  return v_creche;
end $$;

create or replace function public.leave_creche()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'não autenticado'; end if;
  delete from public.tutor_links where tutor_user_id = auth.uid();
  update public.pets set creche_id = null where tutor_user_id = auth.uid();
  update public.day_checkins set creche_id = null where user_id = auth.uid();
end $$;

create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'não autenticado'; end if;
  delete from public.creches c
   where c.id in (select creche_id from public.creche_members where user_id = v_uid)
     and not exists (select 1 from public.creche_members m where m.creche_id = c.id and m.user_id <> v_uid);
  delete from auth.users where id = v_uid;   -- FKs em cascata limpam o resto
end $$;

revoke all on function public.join_creche(text), public.leave_creche(), public.delete_my_account() from public, anon;
grant execute on function public.join_creche(text), public.leave_creche(), public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------
-- 7. Backfill (ordem importa: triggers já existem)
-- ---------------------------------------------------------------------
-- 7a. quem não tinha perfil (a PK id=1 impedia) ganha um; conta de creche ganha creche
insert into public.creche_profile (user_id, account_role)
select u.id, public.role_for_email(u.email) from auth.users u
where not exists (select 1 from public.creche_profile p where p.user_id = u.id);

insert into public.creche_app_message (user_id, text)
select u.id, '' from auth.users u
where not exists (select 1 from public.creche_app_message m where m.user_id = u.id);

-- perfis 'creche' já existentes sem creche (o trigger só cobre INSERT novos)
do $$
declare r record; v_id uuid;
begin
  for r in select p.* from public.creche_profile p
           where p.account_role = 'creche' and not exists (select 1 from public.creche_members m where m.user_id = p.user_id)
  loop
    insert into public.creches (name, price_day, price_over, pix_keys)
      values (coalesce(nullif(btrim(r.name), ''), 'Minha creche'), coalesce(r.price_day, 40), coalesce(r.price_over, 60), coalesce(r.pix_keys, '[]'::jsonb))
      returning id into v_id;
    insert into public.creche_members (creche_id, user_id, role) values (v_id, r.user_id, 'owner');
  end loop;
end $$;

-- 7b. pet do tutor (antes: colunas do perfil) → tabela pets
insert into public.pets (tutor_user_id, name, breed, birth_date, photo_path, weekdays,
                         overnight_weekday, overnight_weekend, tutor_name, tutor_phone)
select p.user_id, btrim(p.name), coalesce(p.breed, ''), p.birth_date, p.photo_path,
       case when jsonb_typeof(p.days) = 'array'
            then coalesce((select array_agg(distinct x::smallint order by x::smallint)
                             from jsonb_array_elements_text(p.days) x where x ~ '^[0-6]$'), '{}')
            else '{}' end,
       p.weekday_overnight = 'Sim', p.weekend_overnight = 'Sim',
       left(coalesce(p.owner1_name, ''), 80), left(coalesce(p.owner1_contact, ''), 20)
from public.creche_profile p
where p.account_role = 'tutor' and length(btrim(coalesce(p.name, ''))) > 0
  and not exists (select 1 from public.pets x where x.tutor_user_id = p.user_id);

update public.day_checkins c
set pet_id = (select x.id from public.pets x where x.tutor_user_id = c.user_id order by x.created_at limit 1)
where c.pet_id is null;

-- 7c. legado JSONB da creche (clients/attendance) → pets/attendance
do $$
declare r record; c jsonb; d record; v_creche uuid; v_pet uuid; v_map jsonb; k text; v_status text;
begin
  for r in select p.user_id, p.clients, p.attendance from public.creche_profile p
           where p.account_role = 'creche' and jsonb_typeof(p.clients) = 'array' and jsonb_array_length(p.clients) > 0
  loop
    select creche_id into v_creche from public.creche_members where user_id = r.user_id limit 1;
    continue when v_creche is null;
    v_map := '{}'::jsonb;
    for c in select * from jsonb_array_elements(r.clients) loop
      insert into public.pets (creche_id, name, tutor_name, tutor_phone, notes, weekdays)
      values (v_creche,
              left(coalesce(nullif(btrim(c->>'name'), ''), 'Pet'), 60),
              left(coalesce(c->>'tutor_name', ''), 80),
              left(regexp_replace(coalesce(c->>'tutor_phone', ''), '\D', '', 'g'), 20),
              left(coalesce(c->>'notes', ''), 500),
              coalesce((select array_agg(distinct x::smallint) from jsonb_array_elements_text(coalesce(c->'weekdays', '[]'::jsonb)) x where x ~ '^[0-6]$'), '{}'))
      returning id into v_pet;
      v_map := v_map || jsonb_build_object(c->>'id', v_pet::text);
    end loop;
    if jsonb_typeof(r.attendance) = 'object' then
      for d in select key as day, value as m from jsonb_each(r.attendance) where key ~ '^\d{4}-\d{2}-\d{2}$' and jsonb_typeof(value) = 'object' loop
        for k, v_status in select key, value #>> '{}' from jsonb_each(d.m) loop
          continue when v_map ->> k is null or v_status not in ('presente', 'saiu', 'faltou');
          insert into public.attendance (creche_id, pet_id, day, status)
          values (v_creche, (v_map ->> k)::uuid, d.day::date, v_status)
          on conflict (pet_id, day) do nothing;
        end loop;
      end loop;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. RLS — limpa e recria (política por comando, sempre TO authenticated)
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
           where schemaname = 'public'
             and tablename in ('creche_profile', 'creche_app_message', 'creche_records', 'creche_payments',
                               'creche_custom_messages', 'day_checkins')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

alter table public.creche_profile         enable row level security;
alter table public.creche_app_message     enable row level security;
alter table public.creche_records         enable row level security;
alter table public.creche_payments        enable row level security;
alter table public.creche_custom_messages enable row level security;
alter table public.day_checkins           enable row level security;
alter table public.creches                enable row level security;
alter table public.creche_members         enable row level security;
alter table public.tutor_links            enable row level security;
alter table public.pets                   enable row level security;
alter table public.attendance             enable row level security;

-- dados do próprio usuário (perfil / mensagens / registros / mensagens salvas)
create policy creche_profile_select on public.creche_profile for select to authenticated using (auth.uid() = user_id);
create policy creche_profile_insert on public.creche_profile for insert to authenticated with check (auth.uid() = user_id);
create policy creche_profile_update on public.creche_profile for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_profile_delete on public.creche_profile for delete to authenticated using (auth.uid() = user_id);

create policy creche_app_message_own on public.creche_app_message for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_records_own on public.creche_records for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_custom_messages_own on public.creche_custom_messages for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- pagamentos: tutor dono; creche do tutor vinculado lê e confirma
create policy creche_payments_select_own on public.creche_payments for select to authenticated using (auth.uid() = user_id);
create policy creche_payments_insert_own on public.creche_payments for insert to authenticated with check (auth.uid() = user_id);
-- pagamento CONFIRMADO pela creche não é editável nem apagável pelo tutor
create policy creche_payments_update_own on public.creche_payments for update to authenticated using (auth.uid() = user_id and status <> 'confirmado') with check (auth.uid() = user_id);
create policy creche_payments_delete_own on public.creche_payments for delete to authenticated using (auth.uid() = user_id and status <> 'confirmado');
create policy creche_payments_creche_select on public.creche_payments for select to authenticated using (public.is_my_tutor(user_id));
create policy creche_payments_creche_update on public.creche_payments for update to authenticated using (public.is_my_tutor(user_id)) with check (public.is_my_tutor(user_id));

-- creches / vínculos
create policy creches_select on public.creches for select to authenticated
  using (id in (select public.my_creche_ids()) or id = public.my_linked_creche());
create policy creches_update on public.creches for update to authenticated
  using (id in (select public.my_creche_ids())) with check (id in (select public.my_creche_ids()));

create policy creche_members_select on public.creche_members for select to authenticated
  using (user_id = auth.uid() or creche_id in (select public.my_creche_ids()));

create policy tutor_links_select on public.tutor_links for select to authenticated
  using (tutor_user_id = auth.uid() or creche_id in (select public.my_creche_ids()));
create policy tutor_links_delete on public.tutor_links for delete to authenticated
  using (tutor_user_id = auth.uid() or creche_id in (select public.my_creche_ids()));

-- pets
create policy pets_tutor_all on public.pets for all to authenticated
  using (tutor_user_id = auth.uid()) with check (tutor_user_id = auth.uid());
create policy pets_creche_select on public.pets for select to authenticated
  using (creche_id in (select public.my_creche_ids()));
create policy pets_creche_insert on public.pets for insert to authenticated
  with check (tutor_user_id is null and creche_id in (select public.my_creche_ids()));
create policy pets_creche_update on public.pets for update to authenticated
  using (tutor_user_id is null and creche_id in (select public.my_creche_ids()))
  with check (tutor_user_id is null and creche_id in (select public.my_creche_ids()));
create policy pets_creche_delete on public.pets for delete to authenticated
  using (tutor_user_id is null and creche_id in (select public.my_creche_ids()));

-- presença: creche escreve; tutor lê a dos próprios pets
create policy attendance_creche_all on public.attendance for all to authenticated
  using (creche_id in (select public.my_creche_ids())) with check (creche_id in (select public.my_creche_ids()));
create policy attendance_tutor_select on public.attendance for select to authenticated
  using (exists (select 1 from public.pets p where p.id = attendance.pet_id and p.tutor_user_id = auth.uid()));

-- check-in: tutor dono (do próprio pet); creche só lê os da SUA creche e marca "visto"
create policy day_checkins_own on public.day_checkins for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id
              and (pet_id is null or exists (select 1 from public.pets p where p.id = pet_id and p.tutor_user_id = auth.uid())));
create policy day_checkins_creche_select on public.day_checkins for select to authenticated
  using (creche_id in (select public.my_creche_ids()));
create policy day_checkins_creche_update on public.day_checkins for update to authenticated
  using (creche_id in (select public.my_creche_ids())) with check (creche_id in (select public.my_creche_ids()));

-- erros do cliente: só insere (autenticado, do próprio usuário); leitura só pelo dashboard/service_role
create policy client_errors_insert on public.client_errors for insert to authenticated with check (user_id = auth.uid());

-- sem acesso anônimo às tabelas novas / de dados
revoke all on public.creches, public.creche_members, public.tutor_links, public.pets, public.attendance,
              public.client_errors, public.creche_profile, public.creche_app_message, public.creche_records,
              public.creche_payments, public.creche_custom_messages, public.day_checkins from anon;
revoke update (user_id, created_at) on public.pets from authenticated;
revoke all on public.creche_members, public.tutor_links from authenticated;
grant select, delete on public.tutor_links to authenticated;
grant select on public.creche_members to authenticated;
grant select, insert, update, delete on public.pets, public.attendance to authenticated;
grant select, update on public.creches to authenticated;
grant insert on public.client_errors to authenticated;

-- ---------------------------------------------------------------------
-- 9. Realtime (avisos e presença ao vivo; a RLS vale para o Realtime)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.day_checkins; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.attendance;   exception when duplicate_object then null; end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 10. Storage: bucket privado, limites e policies por dono
--     (objetos legados em "payments/..." e "profile/..." continuam acessíveis
--      a quem é referenciado por uma linha que a RLS já deixa ver)
-- ---------------------------------------------------------------------
update storage.buckets
set public = false,
    file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
where id = 'creche-anexos';

drop policy if exists creche_anexos_delete      on storage.objects;
drop policy if exists creche_anexos_insert      on storage.objects;
drop policy if exists creche_anexos_public_read on storage.objects;
drop policy if exists creche_anexos_update      on storage.objects;
drop policy if exists creche_anexos_select      on storage.objects;

create policy creche_anexos_select on storage.objects for select to authenticated
using (
  bucket_id = 'creche-anexos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.creche_payments p where p.attachment_path = storage.objects.name)
    or exists (select 1 from public.pets p where p.photo_path = storage.objects.name)
    or exists (select 1 from public.creche_profile p where p.photo_path = storage.objects.name)
    or exists (select 1 from public.creches c where c.photo_path = storage.objects.name)
  )
);
create policy creche_anexos_insert on storage.objects for insert to authenticated
with check (bucket_id = 'creche-anexos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy creche_anexos_update on storage.objects for update to authenticated
using (bucket_id = 'creche-anexos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'creche-anexos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy creche_anexos_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'creche-anexos' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.creche_payments p where p.user_id = auth.uid() and p.attachment_path = storage.objects.name)
    or exists (select 1 from public.creche_profile p where p.user_id = auth.uid() and p.photo_path = storage.objects.name)
  )
);
