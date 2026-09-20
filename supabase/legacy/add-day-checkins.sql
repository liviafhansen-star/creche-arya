-- day_checkins: tutor GRAVA, creche LÊ
create table if not exists public.day_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  pet_name text,
  tutor_name text,
  status text not null check (status in ('coming', 'not_coming')),
  updated_at timestamptz not null default now(),
  unique (user_id, day)
);

alter table public.day_checkins enable row level security;

drop policy if exists day_checkins_own on public.day_checkins;
drop policy if exists day_checkins_creche_read on public.day_checkins;
drop policy if exists day_checkins_tutor_write on public.day_checkins;
drop policy if exists day_checkins_creche_select on public.day_checkins;

create policy day_checkins_own on public.day_checkins
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy day_checkins_creche_select on public.day_checkins
  for select to authenticated
  using (
    coalesce(auth.jwt() ->> 'email', '') ilike '%@creche.caotrole.app'
    or exists (
      select 1 from public.creche_profile p
      where p.user_id = auth.uid()
        and p.account_role = 'creche'
    )
  );

grant select, insert, update, delete on public.day_checkins to authenticated;

update public.creche_profile
set account_role = 'creche'
where user_id in (
  select id from auth.users
  where email ilike '%@creche.caotrole.app'
);
