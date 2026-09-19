-- Garante SELECT/INSERT/UPDATE/DELETE por user_id (evita select vazio + insert 409)
alter table public.creche_profile enable row level security;
alter table public.creche_app_message enable row level security;

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

drop policy if exists creche_app_message_select_own on public.creche_app_message;
drop policy if exists creche_app_message_insert_own on public.creche_app_message;
drop policy if exists creche_app_message_update_own on public.creche_app_message;
drop policy if exists creche_app_message_delete_own on public.creche_app_message;

create policy creche_app_message_select_own on public.creche_app_message
  for select using (auth.uid() = user_id);
create policy creche_app_message_insert_own on public.creche_app_message
  for insert with check (auth.uid() = user_id);
create policy creche_app_message_update_own on public.creche_app_message
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy creche_app_message_delete_own on public.creche_app_message
  for delete using (auth.uid() = user_id);
