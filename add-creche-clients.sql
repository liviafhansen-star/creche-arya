-- add-creche-clients.sql
-- Run in Supabase SQL editor (project used by creche-arya.vercel.app).
-- Adds creche roster + daily attendance JSONB on creche_profile.

alter table public.creche_profile
  add column if not exists clients jsonb not null default '[]'::jsonb;

alter table public.creche_profile
  add column if not exists attendance jsonb not null default '{}'::jsonb;

alter table public.creche_profile
  add column if not exists price_day numeric default 40;

alter table public.creche_profile
  add column if not exists price_over numeric default 60;

comment on column public.creche_profile.clients is
  'Creche roster: [{id,name,tutor_name,tutor_phone,notes,weekdays:number[]}]';

comment on column public.creche_profile.attendance is
  'Per-day attendance: { "YYYY-MM-DD": { "clientId": "presente"|"saiu"|"faltou" } }';
