-- =====================================================================
-- Góndola · 05 · Usuarios, almacenes y roles (protección real en la base)
--
-- Se corre DESPUÉS de 04, en Supabase → SQL Editor → Run. Se puede volver a correr.
-- ANTES: hacé una copia de la base (Database → Backups) y leé "Pasos" abajo.
--
-- Qué cambia:
--   - Cada dato pertenece a un ALMACÉN (columna almacen_id). Un usuario ve y modifica
--     solo los datos de su almacén.
--   - Cada usuario tiene un ROL en su almacén:
--       empleado  → contar, recibir mercadería y leer remitos, alta rápida de productos
--       encargado → además: catálogo, proveedores, pedidos, devoluciones y bajas
--       dueno     → además: equipo (usuarios) y restablecer la demo
--   - La clave pública (anon) deja de tener acceso: hace falta iniciar sesión.
--     Las políticas (RLS) de la base son las que protegen; la app solo adapta la pantalla.
--
-- Pasos:
--   1. Correr este archivo. Los datos que ya existen quedan en el almacén "Almacén principal".
--   2. Crear los usuarios en Supabase → Authentication → Users → "Add user"
--      (email + contraseña, marcando "Auto Confirm User").
--   3. Asignar el primer dueño (cambiá el email):
--        select gondola_asignar_primer_dueno('tu-email@ejemplo.com');
--   4. Desde la app, el dueño agrega al resto en "Equipo" (por email, con su rol).
--
-- Ojo: hasta el paso 3 nadie ve datos (es lo esperado: la base ya está protegida).
-- Para volver atrás, ver el final del archivo.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Almacenes y miembros
-- ---------------------------------------------------------------------

create table if not exists almacenes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  creado_en  timestamptz not null default now(),
  constraint almacenes_nombre_no_vacio check (btrim(nombre) <> '')
);

-- Un usuario pertenece a UN almacén (con un rol)
create table if not exists miembros (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  almacen_id  uuid not null references almacenes(id) on delete cascade,
  rol         text not null,
  email       text,
  creado_en   timestamptz not null default now(),
  constraint miembros_rol_valido check (rol in ('empleado','encargado','dueno'))
);
create index if not exists miembros_almacen on miembros (almacen_id);

insert into almacenes (nombre)
select 'Almacén principal' where not exists (select 1 from almacenes);

-- Funciones de apoyo. security definer: leen miembros sin depender de sus propias políticas.
create or replace function gondola_mi_almacen() returns uuid
language sql stable security definer set search_path = public as $$
  select almacen_id from miembros where user_id = auth.uid();
$$;

create or replace function gondola_mi_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from miembros where user_id = auth.uid();
$$;

create or replace function gondola_es(roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select rol from miembros where user_id = auth.uid()) = any (roles), false);
$$;

-- ---------------------------------------------------------------------
-- 2. almacen_id en todas las tablas (los datos existentes van al almacén principal)
-- ---------------------------------------------------------------------

do $$
declare
  t text;
  principal uuid := (select id from almacenes order by creado_en, id limit 1);
begin
  foreach t in array array[
    'productos','presentaciones','proveedores','producto_proveedor','presentacion_proveedor','presentacion_alias',
    'conteos','recepciones','recepcion_lineas','devoluciones','devolucion_lineas','bajas'
  ] loop
    execute format('alter table %I add column if not exists almacen_id uuid references almacenes(id)', t);
    -- Las tablas con reglas de "no se modifica" se completan sin disparar esas reglas
    execute format('alter table %I disable trigger user', t);
    execute format('update %I set almacen_id = %L where almacen_id is null', t, principal);
    execute format('alter table %I enable trigger user', t);
    execute format('alter table %I alter column almacen_id set default gondola_mi_almacen()', t);
    execute format('alter table %I alter column almacen_id set not null', t);
    execute format('create index if not exists %I on %I (almacen_id)', t || '_almacen', t);
  end loop;
end $$;

-- Nombres únicos por almacén (antes eran únicos en toda la base)
drop index if exists productos_nombre_unico;
create unique index if not exists productos_nombre_unico on productos (almacen_id, lower(btrim(nombre)));
drop index if exists proveedores_nombre_unico;
create unique index if not exists proveedores_nombre_unico on proveedores (almacen_id, lower(btrim(nombre)));
alter table presentacion_alias drop constraint if exists presentacion_alias_pkey;
alter table presentacion_alias add primary key (almacen_id, texto);

-- Nadie puede mezclar datos de dos almacenes (por ejemplo, contar una presentación ajena)
create or replace function gondola_mismo_almacen() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  i int := 0;
  col text; tabla text; valor uuid; otro uuid;
begin
  while i < tg_nargs loop
    col := tg_argv[i]; tabla := tg_argv[i + 1];
    execute format('select ($1).%I', col) using new into valor;
    if valor is not null then
      execute format('select almacen_id from %I where id = $1', tabla) using valor into otro;
      if otro is distinct from new.almacen_id then
        raise exception 'El dato pertenece a otro almacén.';
      end if;
    end if;
    i := i + 2;
  end loop;
  return new;
end $$;

drop trigger if exists mismo_almacen on presentaciones;
create trigger mismo_almacen before insert or update on presentaciones for each row execute function gondola_mismo_almacen('producto_id','productos');
drop trigger if exists mismo_almacen on presentacion_proveedor;
create trigger mismo_almacen before insert or update on presentacion_proveedor for each row execute function gondola_mismo_almacen('presentacion_id','presentaciones','proveedor_id','proveedores');
drop trigger if exists mismo_almacen on producto_proveedor;
create trigger mismo_almacen before insert or update on producto_proveedor for each row execute function gondola_mismo_almacen('producto_id','productos','proveedor_id','proveedores');
drop trigger if exists mismo_almacen on presentacion_alias;
create trigger mismo_almacen before insert or update on presentacion_alias for each row execute function gondola_mismo_almacen('presentacion_id','presentaciones');
drop trigger if exists mismo_almacen on conteos;
create trigger mismo_almacen before insert on conteos for each row execute function gondola_mismo_almacen('presentacion_id','presentaciones','producto_id','productos');
drop trigger if exists mismo_almacen on recepciones;
create trigger mismo_almacen before insert or update on recepciones for each row execute function gondola_mismo_almacen('proveedor_id','proveedores');
drop trigger if exists mismo_almacen on recepcion_lineas;
create trigger mismo_almacen before insert or update on recepcion_lineas for each row execute function gondola_mismo_almacen('recepcion_id','recepciones','presentacion_id','presentaciones');
drop trigger if exists mismo_almacen on devoluciones;
create trigger mismo_almacen before insert or update on devoluciones for each row execute function gondola_mismo_almacen('proveedor_id','proveedores');
drop trigger if exists mismo_almacen on devolucion_lineas;
create trigger mismo_almacen before insert or update on devolucion_lineas for each row execute function gondola_mismo_almacen('devolucion_id','devoluciones','presentacion_id','presentaciones','recepcion_id','recepciones');
drop trigger if exists mismo_almacen on bajas;
create trigger mismo_almacen before insert on bajas for each row execute function gondola_mismo_almacen('presentacion_id','presentaciones');

-- La sincronización producto_proveedor (de 04) tiene que copiar el almacén
create or replace function gondola_sync_producto_proveedor() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prod uuid;
begin
  if tg_op = 'INSERT' then
    select producto_id into prod from presentaciones where id = new.presentacion_id;
    insert into producto_proveedor (producto_id, proveedor_id, almacen_id) values (prod, new.proveedor_id, new.almacen_id) on conflict do nothing;
    return new;
  end if;
  select producto_id into prod from presentaciones where id = old.presentacion_id;
  if prod is not null and not exists (
    select 1 from presentacion_proveedor pp join presentaciones x on x.id = pp.presentacion_id
    where x.producto_id = prod and pp.proveedor_id = old.proveedor_id
  ) then
    delete from producto_proveedor where producto_id = prod and proveedor_id = old.proveedor_id;
  end if;
  return old;
end $$;

-- ---------------------------------------------------------------------
-- 3. Políticas: se reemplazan TODAS las anteriores (que eran para anon)
-- ---------------------------------------------------------------------

do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in (
      'productos','presentaciones','proveedores','producto_proveedor','presentacion_proveedor','presentacion_alias',
      'conteos','recepciones','recepcion_lineas','devoluciones','devolucion_lineas','bajas','almacenes','miembros')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table almacenes enable row level security;
alter table miembros  enable row level security;

-- Sin sesión no hay acceso a nada
revoke all on productos, presentaciones, proveedores, producto_proveedor, presentacion_proveedor, presentacion_alias,
  conteos, recepciones, recepcion_lineas, devoluciones, devolucion_lineas, bajas, almacenes, miembros from anon;
revoke select on v_stock_actual, v_visitas_proximas, v_vencimientos, v_consumo_historico, v_stock_presentacion, v_consumo_presentacion from anon;
grant select, insert, update, delete on productos, presentaciones, proveedores, producto_proveedor, presentacion_proveedor, presentacion_alias,
  conteos, recepciones, recepcion_lineas, devoluciones, devolucion_lineas, bajas to authenticated;
grant select, update on almacenes to authenticated;
grant select on miembros to authenticated;
grant select on v_stock_actual, v_visitas_proximas, v_vencimientos, v_consumo_historico, v_stock_presentacion, v_consumo_presentacion to authenticated;

-- Lectura: todo lo de mi almacén
do $$
declare
  t text;
begin
  foreach t in array array[
    'productos','presentaciones','proveedores','producto_proveedor','presentacion_proveedor','presentacion_alias',
    'conteos','recepciones','recepcion_lineas','devoluciones','devolucion_lineas','bajas'
  ] loop
    execute format('create policy "leer mi almacen" on %I for select to authenticated using (almacen_id = gondola_mi_almacen())', t);
  end loop;
end $$;

-- Todos los roles: contar, recibir, alta rápida de producto/presentación, aprender alias
create policy "crear (todos)" on productos for insert to authenticated with check (almacen_id = gondola_mi_almacen());
create policy "crear (todos)" on presentaciones for insert to authenticated with check (almacen_id = gondola_mi_almacen());
create policy "crear (todos)" on conteos for insert to authenticated with check (almacen_id = gondola_mi_almacen());
create policy "crear (todos)" on recepciones for insert to authenticated with check (almacen_id = gondola_mi_almacen());
create policy "editar (todos)" on recepciones for update to authenticated using (almacen_id = gondola_mi_almacen()) with check (almacen_id = gondola_mi_almacen());
create policy "crear (todos)" on recepcion_lineas for insert to authenticated with check (almacen_id = gondola_mi_almacen());
create policy "editar (todos)" on recepcion_lineas for update to authenticated using (almacen_id = gondola_mi_almacen()) with check (almacen_id = gondola_mi_almacen());
create policy "borrar (todos)" on recepcion_lineas for delete to authenticated using (almacen_id = gondola_mi_almacen());
-- Al recibir, se asocia la presentación con el proveedor que la trajo
create policy "crear (todos)" on presentacion_proveedor for insert to authenticated with check (almacen_id = gondola_mi_almacen());
create policy "crear (todos)" on presentacion_alias for insert to authenticated with check (almacen_id = gondola_mi_almacen());
create policy "borrar (todos)" on presentacion_alias for delete to authenticated using (almacen_id = gondola_mi_almacen());

-- Encargado y dueño: catálogo, proveedores, devoluciones y bajas
create policy "editar (gestion)" on productos for update to authenticated
  using (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno'])) with check (almacen_id = gondola_mi_almacen());
create policy "editar (gestion)" on presentaciones for update to authenticated
  using (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno'])) with check (almacen_id = gondola_mi_almacen());
create policy "crear (gestion)" on proveedores for insert to authenticated
  with check (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno']));
create policy "editar (gestion)" on proveedores for update to authenticated
  using (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno'])) with check (almacen_id = gondola_mi_almacen());
create policy "borrar (gestion)" on presentacion_proveedor for delete to authenticated
  using (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno']));
create policy "crear (gestion)" on producto_proveedor for insert to authenticated
  with check (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno']));
create policy "borrar (gestion)" on producto_proveedor for delete to authenticated
  using (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno']));
create policy "crear (gestion)" on devoluciones for insert to authenticated
  with check (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno']));
create policy "editar (gestion)" on devoluciones for update to authenticated
  using (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno'])) with check (almacen_id = gondola_mi_almacen());
create policy "crear (gestion)" on devolucion_lineas for insert to authenticated
  with check (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno']));
create policy "editar (gestion)" on devolucion_lineas for update to authenticated
  using (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno'])) with check (almacen_id = gondola_mi_almacen());
create policy "borrar (gestion)" on devolucion_lineas for delete to authenticated
  using (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno']));
create policy "crear (gestion)" on bajas for insert to authenticated
  with check (almacen_id = gondola_mi_almacen() and gondola_es(array['encargado','dueno']));

-- Almacén y equipo
create policy "ver mi almacen" on almacenes for select to authenticated using (id = gondola_mi_almacen());
create policy "renombrar (dueno)" on almacenes for update to authenticated
  using (id = gondola_mi_almacen() and gondola_es(array['dueno'])) with check (id = gondola_mi_almacen());
-- Cada uno se ve a sí mismo; el dueño ve a todo su equipo
create policy "ver equipo" on miembros for select to authenticated
  using (user_id = auth.uid() or (almacen_id = gondola_mi_almacen() and gondola_es(array['dueno'])));

-- ---------------------------------------------------------------------
-- 4. Funciones: permisos y equipo
-- ---------------------------------------------------------------------

revoke execute on function gondola_restablecer_demo() from anon, public;
grant execute on function gondola_restablecer_demo() to authenticated;
revoke execute on function gondola_mover_presentacion(uuid, uuid, text) from anon, public;
grant execute on function gondola_mover_presentacion(uuid, uuid, text) to authenticated;

-- Primer dueño (se corre una vez desde el SQL Editor)
create or replace function gondola_asignar_primer_dueno(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare
  u record;
  a uuid := (select id from almacenes order by creado_en, id limit 1);
begin
  if exists (select 1 from miembros where almacen_id = a and rol = 'dueno') then
    raise exception 'El almacén ya tiene dueño. Agregá usuarios desde la app (Equipo).';
  end if;
  select id, email into u from auth.users where lower(email) = lower(btrim(p_email));
  if not found then
    raise exception 'No existe un usuario con ese email: crealo en Authentication → Users → Add user.';
  end if;
  insert into miembros (user_id, almacen_id, rol, email) values (u.id, a, 'dueno', u.email)
  on conflict (user_id) do update set almacen_id = excluded.almacen_id, rol = 'dueno', email = excluded.email;
  return 'Listo: ' || u.email || ' es dueño de "' || (select nombre from almacenes where id = a) || '".';
end $$;
revoke execute on function gondola_asignar_primer_dueno(text) from public, anon, authenticated;

-- El dueño agrega o cambia el rol de alguien de su equipo
create or replace function gondola_guardar_miembro(p_email text, p_rol text) returns void
language plpgsql security definer set search_path = public as $$
declare
  u record;
  a uuid := gondola_mi_almacen();
begin
  if not gondola_es(array['dueno']) then raise exception 'Solo el dueño puede administrar el equipo.'; end if;
  if p_rol not in ('empleado','encargado','dueno') then raise exception 'Rol no válido.'; end if;
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
  delete from miembros where user_id = p_user and almacen_id = gondola_mi_almacen();
end $$;

revoke execute on function gondola_guardar_miembro(text, text) from public, anon;
revoke execute on function gondola_quitar_miembro(uuid) from public, anon;
grant execute on function gondola_guardar_miembro(text, text) to authenticated;
grant execute on function gondola_quitar_miembro(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Para volver atrás (solo si hace falta): devuelve el acceso con la clave pública,
-- como antes de este archivo. Los datos y la columna almacen_id se conservan.
--
--   do $$ declare t text; begin
--     foreach t in array array['productos','presentaciones','proveedores','producto_proveedor','presentacion_proveedor',
--       'presentacion_alias','conteos','recepciones','recepcion_lineas','devoluciones','devolucion_lineas','bajas'] loop
--       execute format('create policy "anon temporal" on %I for all to anon using (true) with check (true)', t);
--       execute format('grant select, insert, update, delete on %I to anon', t);
--     end loop; end $$;
--   drop table miembros;   -- la app vuelve al modo sin usuarios
-- ---------------------------------------------------------------------
