-- =====================================================================
-- Góndola · 06 · Cuentas de evaluación (trabajo académico)
--
-- Se corre DESPUÉS de 05, en Supabase → SQL Editor → Run. Se puede volver a correr.
--
-- Qué hace:
--   1. Asigna un rol a cada cuenta de evaluación que ya exista en Authentication → Users:
--        duena.gondola@example.com      → dueño
--        encargado.gondola@example.com  → encargado
--        empleado.gondola@example.com   → empleado
--      (todas en el almacén principal). Las cuentas se crean ANTES en Supabase →
--      Authentication → Users → Add user, con la clave de evaluación y "Auto Confirm User".
--   2. Protege esas tres cuentas: desde la app (Equipo) nadie puede cambiarles el rol ni
--      quitarlas, aunque su clave sea pública. Sí se pueden agregar otros usuarios.
--   3. El reinicio de los datos de ejemplo (gondola_restablecer_demo) deja de estar
--      disponible desde la app: solo se puede correr desde el SQL Editor.
--
-- No crea usuarios ni guarda contraseñas: eso lo hace Supabase Auth.
-- =====================================================================

begin;

do $$ begin
  if to_regclass('public.miembros') is null then
    raise exception 'Primero corré supabase/05_roles_y_almacenes.sql.';
  end if;
end $$;

-- 1. Roles de las cuentas de evaluación (solo las que existen en Auth)
do $$
declare
  a uuid := (select id from almacenes order by creado_en, id limit 1);
  c record;
begin
  for c in select * from (values
    ('duena.gondola@example.com', 'dueno'),
    ('encargado.gondola@example.com', 'encargado'),
    ('empleado.gondola@example.com', 'empleado')
  ) as t(email, rol) loop
    insert into miembros (user_id, almacen_id, rol, email)
    select u.id, a, c.rol, u.email from auth.users u where lower(u.email) = c.email
    on conflict (user_id) do update set almacen_id = excluded.almacen_id, rol = excluded.rol, email = excluded.email;
  end loop;
end $$;

-- 2. Las cuentas de evaluación no se modifican desde la app
create or replace function gondola_es_cuenta_evaluacion(p_email text) returns boolean
language sql immutable as $$
  select lower(btrim(coalesce(p_email, ''))) in
    ('duena.gondola@example.com', 'encargado.gondola@example.com', 'empleado.gondola@example.com');
$$;

create or replace function gondola_guardar_miembro(p_email text, p_rol text) returns void
language plpgsql security definer set search_path = public as $$
declare
  u record;
  a uuid := gondola_mi_almacen();
begin
  if not gondola_es(array['dueno']) then raise exception 'Solo el dueño puede administrar el equipo.'; end if;
  if p_rol not in ('empleado','encargado','dueno') then raise exception 'Rol no válido.'; end if;
  if gondola_es_cuenta_evaluacion(p_email) then
    raise exception 'Las cuentas de evaluación no se pueden modificar desde la app.';
  end if;
  select id, email into u from auth.users where lower(email) = lower(btrim(p_email));
  if not found then
    raise exception 'No hay un usuario con ese email. Primero hay que crearlo en Supabase → Authentication → Users.';
  end if;
  if exists (select 1 from miembros where user_id = u.id and almacen_id <> a) then
    raise exception 'Ese usuario ya pertenece a otro almacén.';
  end if;
  if u.id = auth.uid() and p_rol <> 'dueno' and not exists (select 1 from miembros where almacen_id = a and rol = 'dueno' and user_id <> u.id) then
    raise exception 'No podés dejar el almacén sin dueño.';
  end if;
  insert into miembros (user_id, almacen_id, rol, email) values (u.id, a, p_rol, u.email)
  on conflict (user_id) do update set rol = excluded.rol, email = excluded.email;
end $$;

create or replace function gondola_quitar_miembro(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not gondola_es(array['dueno']) then raise exception 'Solo el dueño puede administrar el equipo.'; end if;
  if p_user = auth.uid() then raise exception 'No podés quitarte a vos mismo.'; end if;
  if gondola_es_cuenta_evaluacion((select email from miembros where user_id = p_user)) then
    raise exception 'Las cuentas de evaluación no se pueden modificar desde la app.';
  end if;
  delete from miembros where user_id = p_user and almacen_id = gondola_mi_almacen();
end $$;

revoke execute on function gondola_guardar_miembro(text, text) from public, anon;
revoke execute on function gondola_quitar_miembro(uuid) from public, anon;
grant execute on function gondola_guardar_miembro(text, text) to authenticated;
grant execute on function gondola_quitar_miembro(uuid) to authenticated;

-- 3. El reinicio de datos de ejemplo solo desde el SQL Editor
revoke execute on function gondola_restablecer_demo() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- Verificación: tienen que aparecer las cuentas creadas, cada una con su rol.
select m.email, m.rol, a.nombre as almacen
from miembros m join almacenes a on a.id = m.almacen_id
where gondola_es_cuenta_evaluacion(m.email)
order by m.rol;
