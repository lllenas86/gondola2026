-- Stub mínimo de Supabase para pruebas locales (NO va a producción)
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public to anon, authenticated;
-- Auth mínimo (solo pruebas): auth.users y auth.uid() leyendo el JWT como Supabase
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, password_prueba text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant select on auth.users to postgres;
