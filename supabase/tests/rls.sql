-- =====================================================================
-- Testes de RLS / segurança (rodam DENTRO de uma transação e terminam em ROLLBACK).
-- Pré-requisito: a migration 20260920120000 já aplicada na mesma transação.
--
--   begin;
--   \i supabase/migrations/20260920120000_relational_model.sql
--   \i supabase/tests/rls.sql        -- imprime a tabela de resultados
--   rollback;
--
-- Qualquer linha com ok = false é falha.
-- =====================================================================

create temp table t_res (n serial, name text, ok boolean, detail text);
create temp table t_ids (tA uuid, tB uuid, c1 uuid, c2 uuid, cr1 uuid, cr2 uuid, petA uuid, petB uuid, code1 text);
grant all on t_res, t_ids to public;
grant all on sequence t_res_n_seq to public;

-- ---------- fixtures (como postgres) ----------
insert into public.creche_allowlist (email) values ('t_c1@creche.caotrole.app'), ('t_c2@creche.caotrole.app');

insert into t_ids (tA, tB, c1, c2) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
insert into auth.users (id, email) select tA, 't_a@example.com'          from t_ids;
insert into auth.users (id, email) select tB, 't_b@example.com'          from t_ids;
insert into auth.users (id, email) select c1, 't_c1@creche.caotrole.app' from t_ids;
insert into auth.users (id, email) select c2, 't_c2@creche.caotrole.app' from t_ids;

update t_ids set cr1 = (select creche_id from public.creche_members where user_id = c1),
                 cr2 = (select creche_id from public.creche_members where user_id = c2);
update t_ids set code1 = (select invite_code from public.creches where id = cr1);

do $$
declare i t_ids; ok boolean := false;
begin
  select * into i from t_ids;
  insert into t_res (name, ok, detail) values
    ('signup cria perfil tutor', (select account_role from public.creche_profile where user_id = i.tA) = 'tutor', null),
    ('signup allowlisted cria perfil creche', (select account_role from public.creche_profile where user_id = i.c1) = 'creche', null),
    ('conta creche ganha creche + dona', i.cr1 is not null and i.cr2 is not null and i.cr1 <> i.cr2, null),
    ('perfis não compartilham PK (4 usuários, 4 perfis)', (select count(*) from public.creche_profile where user_id in (i.tA, i.tB, i.c1, i.c2)) = 4, null);
  begin
    insert into auth.users (id, email) values (gen_random_uuid(), 'invasor@creche.caotrole.app');
  exception when others then ok := true;
  end;
  insert into t_res (name, ok, detail) values ('signup @creche.caotrole.app fora da allowlist é bloqueado', ok, null);
  insert into t_res (name, ok, detail) values ('bucket creche-anexos é privado com limite de tamanho',
    (select not public and file_size_limit = 5242880 from storage.buckets where id = 'creche-anexos'), null);
end $$;

-- ---------- 1. escalada de papel ----------
do $$
declare i t_ids; blocked boolean := false; role_after text;
begin
  select * into i from t_ids;
  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    update public.creche_profile set account_role = 'creche' where user_id = i.tA;
  exception when others then blocked := true;
  end;
  execute 'reset role';
  select account_role into role_after from public.creche_profile where user_id = i.tA;
  insert into t_res (name, ok, detail) values ('tutor NÃO consegue virar creche (update account_role)', blocked and role_after = 'tutor', role_after);
end $$;

-- ---------- 2. vínculo e pets ----------
do $$
declare i t_ids; v_creche uuid; bad boolean := false; v_pet uuid; v_creche_pet uuid;
begin
  select * into i from t_ids;
  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.join_creche('ZZZZZZZZ'); exception when others then bad := true; end;
  insert into t_res (name, ok) values ('código de convite inválido é recusado', bad);
  v_creche := public.join_creche(lower(i.code1));
  insert into public.pets (tutor_user_id, name, weekdays) values (i.tA, 'Arya', '{2,3}') returning id, creche_id into v_pet, v_creche_pet;
  execute 'reset role';
  update t_ids set petA = v_pet;
  insert into t_res (name, ok) values ('tutor entra na creche pelo código (case-insensitive)', v_creche = i.cr1);
  insert into t_res (name, ok) values ('pet do tutor herda creche do vínculo (servidor)', v_creche_pet = i.cr1);

  perform set_config('request.jwt.claims', json_build_object('sub', i.tB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.pets (tutor_user_id, name) values (i.tB, 'Luna') returning id into v_pet;
  execute 'reset role';
  update t_ids set petB = v_pet;
end $$;

-- ---------- 3. check-in ----------
do $$
declare i t_ids; n int; bad boolean := false; v_creche uuid; v_seen timestamptz; v_status text;
begin
  select * into i from t_ids;
  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.day_checkins (user_id, day, pet_id, pet_name, tutor_name, status, creche_id)
    values (i.tA, current_date, i.petA, 'Arya', 'A', 'coming', i.cr2)   -- tenta forçar OUTRA creche
    returning creche_id into v_creche;
  begin  -- check-in usando pet de outro tutor
    insert into public.day_checkins (user_id, day, pet_id, status) values (i.tA, current_date, i.petB, 'coming');
  exception when others then bad := true; end;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('check-in: creche vem do vínculo, não do cliente', v_creche = i.cr1, v_creche::text);
  insert into t_res (name, ok) values ('check-in com pet de outro tutor é recusado', bad);

  -- creche 1 vê; creche 2 e tutor B não
  perform set_config('request.jwt.claims', json_build_object('sub', i.c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.day_checkins;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('creche 1 vê o check-in do seu tutor', n = 1, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', i.c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.day_checkins;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('creche 2 NÃO vê check-ins da creche 1', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', i.tB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.day_checkins;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('tutor B NÃO vê check-in do tutor A', n = 0, n::text);

  -- creche só consegue marcar "visto"
  perform set_config('request.jwt.claims', json_build_object('sub', i.c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.day_checkins set status = 'not_coming', pet_name = 'HACK' where user_id = i.tA;
  execute 'reset role';
  select status, seen_at into v_status, v_seen from public.day_checkins where user_id = i.tA;
  insert into t_res (name, ok, detail) values ('creche só altera "visto" (status intacto, seen_at preenchido)', v_status = 'coming' and v_seen is not null, v_status);

  -- tutor muda o status → "visto" zera
  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.day_checkins set status = 'not_coming' where user_id = i.tA;
  execute 'reset role';
  select seen_at into v_seen from public.day_checkins where user_id = i.tA;
  insert into t_res (name, ok) values ('mudar o check-in zera o "visto"', v_seen is null);
end $$;

-- ---------- 4. pets e presença ----------
do $$
declare i t_ids; n int; bad boolean := false; v_arr timestamptz; v_name text; v_manual uuid;
begin
  select * into i from t_ids;
  perform set_config('request.jwt.claims', json_build_object('sub', i.c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.pets;
  insert into t_res (name, ok, detail) values ('creche 1 vê só pets da sua creche (Arya, não Luna)', n = 1, n::text);
  insert into public.attendance (creche_id, pet_id, day, status) values (i.cr1, i.petA, current_date, 'presente');
  select arrived_at into v_arr from public.attendance where pet_id = i.petA;
  begin  -- presença em pet de outra creche
    insert into public.attendance (creche_id, pet_id, day, status) values (i.cr2, i.petA, current_date - 1, 'presente');
  exception when others then bad := true; end;
  update public.pets set name = 'HACK' where id = i.petA;      -- pet de tutor: creche não edita
  insert into public.pets (tutor_user_id, creche_id, name, tutor_name) values (null, i.cr1, 'Thor', 'Maria') returning id into v_manual;
  execute 'reset role';
  select name into v_name from public.pets where id = i.petA;
  insert into t_res (name, ok, detail) values ('presença grava horário de chegada no servidor', v_arr is not null, null);
  insert into t_res (name, ok) values ('creche não escreve presença em creche alheia', bad);
  insert into t_res (name, ok, detail) values ('creche NÃO edita pet de tutor', v_name = 'Arya', v_name);
  insert into t_res (name, ok) values ('creche cadastra pet manual na própria creche', v_manual is not null);

  perform set_config('request.jwt.claims', json_build_object('sub', i.c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.pets;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('creche 2 não vê pets da creche 1', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.attendance;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('tutor A vê a presença do próprio pet ("creche confirmou")', n = 1, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', i.tB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.attendance;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('tutor B não vê presença alheia', n = 0, n::text);
end $$;

-- ---------- 5. pagamentos ----------
do $$
declare i t_ids; n int; v_id bigint; v_status text; v_value numeric; v_by uuid;
begin
  select * into i from t_ids;
  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.creche_payments (user_id, date, value, note, paid_through, status)
    values (i.tA, current_date, 100, 'teste', current_date, 'confirmado') returning id, status into v_id, v_status;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('tutor não se auto-confirma no INSERT', v_status = 'enviado', v_status);

  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.creche_payments set status = 'confirmado' where id = v_id;
  execute 'reset role';
  select status into v_status from public.creche_payments where id = v_id;
  insert into t_res (name, ok, detail) values ('tutor não se auto-confirma no UPDATE', v_status = 'enviado', v_status);

  perform set_config('request.jwt.claims', json_build_object('sub', i.c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.creche_payments;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('creche 2 não vê pagamentos de tutor alheio', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', i.c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.creche_payments;
  update public.creche_payments set status = 'confirmado', value = 1 where id = v_id;
  execute 'reset role';
  select status, value, confirmed_by into v_status, v_value, v_by from public.creche_payments where id = v_id;
  insert into t_res (name, ok, detail) values ('creche 1 vê pagamento do tutor vinculado', n = 1, n::text);
  insert into t_res (name, ok, detail) values ('creche confirma, mas NÃO altera o valor', v_status = 'confirmado' and v_value = 100 and v_by = i.c1, v_status || '/' || v_value);
end $$;

-- ---------- 5b. upsert do app, pagamento confirmado, Storage ----------
do $$
declare i t_ids; n int; v_status text; v_pid bigint; bad boolean := false; v_left int;
begin
  select * into i from t_ids;
  -- ON CONFLICT (pet_id, day): é o que o app faz ao trocar "vai" por "não vai"
  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.day_checkins (user_id, day, pet_id, status) values (i.tA, current_date, i.petA, 'coming')
    on conflict (pet_id, day) do update set status = excluded.status;
  select status into v_status from public.day_checkins where pet_id = i.petA and day = current_date;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('upsert de check-in por (pet_id, day) funciona', v_status = 'coming', v_status);

  perform set_config('request.jwt.claims', json_build_object('sub', i.c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.attendance (creche_id, pet_id, day, status) values (i.cr1, i.petA, current_date, 'saiu')
    on conflict (pet_id, day) do update set status = excluded.status;
  select status into v_status from public.attendance where pet_id = i.petA and day = current_date;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('upsert de presença por (pet_id, day) funciona', v_status = 'saiu', v_status);

  -- pagamento confirmado: tutor não edita nem apaga
  select id into v_pid from public.creche_payments where user_id = i.tA limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.creche_payments set value = 1, note = 'HACK' where id = v_pid;
  delete from public.creche_payments where id = v_pid;
  execute 'reset role';
  select count(*) into n from public.creche_payments where id = v_pid and value = 100 and note = 'teste';
  insert into t_res (name, ok, detail) values ('tutor NÃO edita nem apaga pagamento confirmado', n = 1, n::text);

  -- Storage: objetos fictícios
  insert into storage.objects (bucket_id, name) values
    ('creche-anexos', i.tA::text || '/payments/comprovante.jpg'),
    ('creche-anexos', i.tA::text || '/pet/foto.jpg'),
    ('creche-anexos', i.c1::text || '/creche/logo.jpg');
  update public.creche_payments set attachment_path = i.tA::text || '/payments/comprovante.jpg' where id = v_pid;
  update public.pets set photo_path = i.tA::text || '/pet/foto.jpg' where id = i.petA;
  update public.creches set photo_path = i.c1::text || '/creche/logo.jpg' where id = i.cr1;

  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from storage.objects where bucket_id = 'creche-anexos';
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('Storage: tutor A vê os próprios arquivos + logo da creche vinculada', n = 3, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', i.tB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from storage.objects where bucket_id = 'creche-anexos';
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('Storage: tutor B não vê arquivo de ninguém', n = 0, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', i.c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from storage.objects where bucket_id = 'creche-anexos';
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('Storage: creche 1 vê comprovante e foto do tutor vinculado + o próprio logo', n = 3, n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', i.c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from storage.objects where bucket_id = 'creche-anexos';
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('Storage: creche 2 não vê nada da creche 1', n = 0, n::text);

  -- escrita/remoção só na própria pasta
  perform set_config('request.jwt.claims', json_build_object('sub', i.tB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin insert into storage.objects (bucket_id, name) values ('creche-anexos', i.tA::text || '/invasao.jpg'); exception when others then bad := true; end;
  perform set_config('storage.allow_delete_query', 'true', true);   -- o que a Storage API faz; sem isso o trigger protect_delete bloqueia DELETE via SQL
  delete from storage.objects where bucket_id = 'creche-anexos' and name = i.tA::text || '/payments/comprovante.jpg';
  execute 'reset role';
  select count(*) into v_left from storage.objects where name = i.tA::text || '/payments/comprovante.jpg';
  insert into t_res (name, ok) values ('Storage: tutor B não escreve na pasta do tutor A', bad);
  insert into t_res (name, ok, detail) values ('Storage: tutor B não apaga arquivo do tutor A', v_left = 1, v_left::text);
end $$;

-- ---------- 6. anônimo, erros do cliente, sair da creche, excluir conta ----------
do $$
declare i t_ids; n int; bad boolean := false; bad2 boolean := false;
begin
  select * into i from t_ids;
  execute 'set local role anon';
  begin perform count(*) from public.pets; exception when others then bad := true; end;
  begin perform count(*) from public.day_checkins; exception when others then bad2 := true; end;
  execute 'reset role';
  insert into t_res (name, ok) values ('anônimo não lê pets', bad);
  insert into t_res (name, ok) values ('anônimo não lê day_checkins', bad2);

  bad := false;
  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.client_errors (user_id, session_id, ctx, message) values (i.tA, 's1', 'teste', 'boom');
  begin insert into public.client_errors (user_id, session_id, ctx, message) values (i.tB, 's1', 'teste', 'forjado'); exception when others then bad := true; end;
  select count(*) into n from public.client_errors;    -- sem policy de SELECT
  execute 'reset role';
  insert into t_res (name, ok) values ('client_errors: insere só como si mesmo', bad);
  insert into t_res (name, ok, detail) values ('client_errors: usuário não lê a tabela', n = 0, n::text);

  -- sai da creche → creche perde visibilidade
  perform set_config('request.jwt.claims', json_build_object('sub', i.tA, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.leave_creche();
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', i.c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select (select count(*) from public.day_checkins) + (select count(*) from public.creche_payments) + (select count(*) from public.pets where tutor_user_id is not null) into n;
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('ao sair da creche o tutor some para ela', n = 0, n::text);

  -- excluir conta (tutor B) apaga tudo dele
  perform set_config('request.jwt.claims', json_build_object('sub', i.tB, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.delete_my_account();
  execute 'reset role';
  insert into t_res (name, ok, detail) values ('excluir conta remove usuário e pets',
    not exists (select 1 from auth.users where id = i.tB) and not exists (select 1 from public.pets where tutor_user_id = i.tB), null);
end $$;

select count(*) filter (where not ok) as falhas, count(*) as total,
       coalesce(string_agg(name || ' [' || coalesce(detail, '') || ']', ' | ') filter (where not ok), 'nenhuma') as detalhes
from t_res;
