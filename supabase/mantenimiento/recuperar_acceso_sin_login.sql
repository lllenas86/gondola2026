-- =====================================================================
-- Góndola · Mantenimiento · Recuperar el acceso SIN login (solo emergencias)
--
-- Usar únicamente si, después de correr 05/06, nadie puede entrar a la app
-- (por ejemplo, si las cuentas no quedaron creadas o la versión publicada todavía
-- no tiene pantalla de ingreso). Vuelve a dar acceso con la clave pública, como antes
-- de la 05. NO borra datos: conserva almacen_id, miembros y todas las filas.
--
-- Para volver a proteger la base después: correr de nuevo 05 y 06.
-- =====================================================================
begin;

do $$
declare
  t text;
begin
  foreach t in array array['productos','presentaciones','proveedores','producto_proveedor','presentacion_proveedor',
    'presentacion_alias','conteos','recepciones','recepcion_lineas','devoluciones','devolucion_lineas','bajas'] loop
    execute format('drop policy if exists "anon temporal" on %I', t);
    execute format('create policy "anon temporal" on %I for all to anon using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to anon', t);
  end loop;
end $$;
grant select on v_stock_actual, v_visitas_proximas, v_vencimientos, v_consumo_historico, v_stock_presentacion, v_consumo_presentacion to anon;

-- Sin miembros, los chequeos de rol de las funciones (por ejemplo, Mover) quedan permitidos
create or replace function gondola_es(roles text[]) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.miembros') is null then return true; end if;
  return coalesce((select rol from miembros where user_id = auth.uid()) = any (roles), false);
end $$;

-- Con la tabla miembros renombrada, la app vuelve al modo sin usuarios (no se pierde: se puede restaurar).
alter table if exists miembros rename to miembros_suspendido;

-- Los registros nuevos sin sesión van al almacén principal
do $$
declare
  t text;
  principal uuid := (select id from almacenes order by creado_en, id limit 1);
begin
  foreach t in array array['productos','presentaciones','proveedores','producto_proveedor','presentacion_proveedor',
    'presentacion_alias','conteos','recepciones','recepcion_lineas','devoluciones','devolucion_lineas','bajas'] loop
    execute format('alter table %I alter column almacen_id set default %L::uuid', t, principal);
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';

-- Para volver a activar el login:
--   alter table miembros_suspendido rename to miembros;  y luego correr 05 y 06.
