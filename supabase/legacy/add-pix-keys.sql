-- Adiciona lista de chaves PIX por conta
alter table public.creche_profile add column if not exists pix_keys jsonb default '[]'::jsonb;

-- Migra chave antiga (se houver) para a lista
update public.creche_profile
set pix_keys = jsonb_build_array(
  jsonb_build_object(
    'id', gen_random_uuid()::text,
    'type', coalesce(nullif(pix_type, ''), 'Telefone'),
    'key', pix_key
  )
)
where coalesce(pix_key, '') <> ''
  and (pix_keys is null or pix_keys = '[]'::jsonb);
