-- BLOCO 2/2 — só creche_app_message (rode depois do bloco 1)
alter table public.creche_app_message enable row level security;

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
