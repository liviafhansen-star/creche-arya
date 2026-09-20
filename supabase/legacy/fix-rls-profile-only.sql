-- BLOCO 1/2 — só creche_profile (rode sozinho, espere "Success")
alter table public.creche_profile enable row level security;

drop policy if exists creche_profile_select_own on public.creche_profile;
drop policy if exists creche_profile_insert_own on public.creche_profile;
drop policy if exists creche_profile_update_own on public.creche_profile;
drop policy if exists creche_profile_delete_own on public.creche_profile;

create policy creche_profile_select_own on public.creche_profile
  for select using (auth.uid() = user_id);
create policy creche_profile_insert_own on public.creche_profile
  for insert with check (auth.uid() = user_id);
create policy creche_profile_update_own on public.creche_profile
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_profile_delete_own on public.creche_profile
  for delete using (auth.uid() = user_id);
