-- Check-ins do tutor visíveis para a creche (Cãotrole Financeiro)
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
create policy day_checkins_own on public.day_checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists day_checkins_creche_read on public.day_checkins;
create policy day_checkins_creche_read on public.day_checkins
  for select using (
    exists (
      select 1 from public.creche_profile p
      where p.user_id = auth.uid() and p.account_role = 'creche'
    )
  );

grant select, insert, update, delete on public.day_checkins to authenticated;
