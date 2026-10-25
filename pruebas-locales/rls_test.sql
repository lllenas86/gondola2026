\set QUIET on
\pset footer off
create or replace function pg_temp.como(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email=p_email))::text, false);
end $$;
-- La dueña asigna roles desde la "app"
select pg_temp.como('duena@prueba.ar'); set role authenticated;
select gondola_guardar_miembro('encargado@prueba.ar','encargado');
select gondola_guardar_miembro('empleado@prueba.ar','empleado');
\echo '== dueña ve productos de su almacén (datos migrados):'
select count(*) productos from productos;
\echo '== dueña restablece la demo (solo su almacén):'
select gondola_restablecer_demo();
select count(*) presentaciones from presentaciones;
reset role;
\echo '== sin sesión (anon):'
set role anon;
\set ON_ERROR_STOP off
select count(*) from productos;
reset role;
\echo '== empleado:'
select pg_temp.como('empleado@prueba.ar'); set role authenticated;
select count(*) ve_presentaciones from presentaciones;
insert into conteos (presentacion_id, cantidad) select id, 3 from presentaciones where nombre='190 g';
select tipo, stock_registrado, cantidad from conteos order by fecha_hora desc limit 1;
update presentaciones set punto_pedido = 99 where nombre='190 g';
select punto_pedido as punto_sin_cambio from presentaciones where nombre='190 g';
insert into bajas (presentacion_id, cantidad) select id, 1 from presentaciones where nombre='190 g';
insert into devoluciones (proveedor_id) select id from proveedores limit 1;
select gondola_restablecer_demo();
select gondola_guardar_miembro('otro@prueba.ar','empleado');
select count(*) ve_miembros from miembros;
select gondola_mover_presentacion((select id from presentaciones where nombre='190 g'), (select id from productos where nombre='Leche entera'), 'x');
reset role;
\echo '== encargado:'
select pg_temp.como('encargado@prueba.ar'); set role authenticated;
insert into devoluciones (proveedor_id) select id from proveedores where nombre='Lácteos del Sur' returning numero;
update presentaciones set costo_unitario = 777 where nombre='190 g';
select costo_unitario from presentaciones where nombre='190 g';
select gondola_restablecer_demo();
select gondola_guardar_miembro('empleado@prueba.ar','dueno');
reset role;
\echo '== otro almacén:'
select pg_temp.como('otro@prueba.ar'); set role authenticated;
select count(*) ve_productos_ajenos from productos;
select count(*) ve_stock_ajeno from v_stock_presentacion;
insert into productos (nombre) values ('Leche entera') returning nombre as mismo_nombre_permitido_en_otro_almacen;
insert into conteos (presentacion_id, cantidad) select id, 1 from presentaciones limit 1;
insert into conteos (presentacion_id, producto_id, cantidad) values ((select id from presentaciones where nombre='190 g' limit 1), (select id from productos limit 1), 5);
reset role;
\echo '== ataque: el otro almacén usa un id ajeno conocido'
select id as pres_ajena from presentaciones where nombre='190 g' and almacen_id=(select id from almacenes where nombre='Almacén principal') \gset
select pg_temp.como('otro@prueba.ar'); set role authenticated;
insert into conteos (presentacion_id, cantidad) values (:'pres_ajena', 5);
reset role;
