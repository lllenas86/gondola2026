-- Pruebas de la migración 04. SOLO para una base de prueba (borra y crea datos).
-- Se corren como el rol "anon", el mismo que usa la app, para verificar también los permisos.
-- Cada bloque falla con un mensaje claro si algo no da lo esperado.
\set ON_ERROR_STOP 1
select gondola_restablecer_demo();
set role anon;

create temp table t_ids (k text primary key, v uuid);
grant all on t_ids to anon;

-- Ayuda: espera que una sentencia falle
create or replace function pg_temp.debe_fallar(sql text, contiene text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(contiene in sqlerrm) = 0 then
      raise exception 'Falló con otro mensaje. Esperado «%», recibido «%»', contiene, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Debía fallar y no falló: %', sql;
end $$;

-- ---------- P. Productos y presentaciones ----------
do $$
declare f uuid; a uuid; b uuid;
begin
  -- P1: ficha con dos presentaciones
  insert into fichas_producto (nombre) values ('Cerveza Prueba') returning id into f;
  insert into productos (ficha_id, nombre, presentacion, contenido, unidad_contenido, unidades_por_presentacion, unidad, perecedero, punto_pedido)
  values (f, 'Cerveza Prueba 473 ml', '473 ml', 473, 'ml', 1, 'unidad', false, 6) returning id into a;
  insert into productos (ficha_id, nombre, presentacion, contenido, unidad_contenido, unidades_por_presentacion, unidad, perecedero, punto_pedido)
  values (f, 'Cerveza Prueba 1 L', '1 L', 1, 'l', 1, 'unidad', false, 4) returning id into b;
  insert into t_ids values ('ficha', f), ('p473', a), ('p1l', b);
  assert (select count(*) from productos where ficha_id = f) = 2, 'P1: la ficha debe tener 2 presentaciones';

  -- P2: editar ambas
  update productos set punto_pedido = 8 where id = a;
  update productos set contenido = 1000, unidad_contenido = 'ml' where id = b;
  assert (select punto_pedido from productos where id = a) = 8, 'P2: edición 473';
  assert (select contenido from productos where id = b) = 1000, 'P2: edición 1 L';
end $$;

-- P2b: no se repite la presentación dentro de la ficha
select pg_temp.debe_fallar(format($q$insert into productos (ficha_id, nombre, presentacion) values (%L, 'Otro nombre', '473 ML ')$q$, (select v from t_ids where k='ficha')), 'productos_ficha_presentacion_unica');

-- P3: stock diferenciado por presentación (conteo inicial sin proveedor)
select gondola_registrar_conteo('inicial', jsonb_build_array(
  jsonb_build_object('producto_id', (select v from t_ids where k='p473'), 'cantidad', 24),
  jsonb_build_object('producto_id', (select v from t_ids where k='p1l'), 'cantidad', 10)));
do $$ begin
  assert (select stock_actual from v_stock_actual where producto_id = (select v from t_ids where k='p473')) = 24, 'P3: stock 473';
  assert (select stock_actual from v_stock_actual where producto_id = (select v from t_ids where k='p1l')) = 10, 'P3: stock 1 L';
end $$;

-- P4: la versión anterior de la app crea productos sin ficha → se crea ficha «Única»
do $$ declare x uuid; begin
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Galletitas Prueba', 'unidad', false, 3) returning id into x;
  assert (select ficha_id is not null and presentacion = 'Única' and unidades_por_presentacion = 1 from productos where id = x), 'P4: ficha automática';
  update productos set nombre = 'Galletitas Prueba 2' where id = x;
  assert (select f.nombre from fichas_producto f join productos p on p.ficha_id = f.id where p.id = x) = 'Galletitas Prueba 2', 'P4: la ficha acompaña el nombre';
end $$;

-- P5: mover presentación a otro producto sin mezclar historiales
do $$
declare spr uuid; coca uuid; fcoca uuid; forig uuid; stock_antes numeric; coca_antes numeric; conteos_antes int;
begin
  select id, ficha_id into spr, forig from productos where nombre = 'Sprite 2,25 L';
  select id, ficha_id into coca, fcoca from productos where nombre = 'Coca-Cola 2,25 L';
  stock_antes := gondola_stock_de(spr);
  coca_antes := gondola_stock_de(coca);
  select count(*) into conteos_antes from conteos where producto_id = spr;
  insert into t_ids values ('sprite', spr), ('fcoca', fcoca), ('fsprite', forig);
  perform gondola_mover_presentacion(spr, fcoca, 'Sprite 2,25 L');
  assert (select ficha_id from productos where id = spr) = fcoca, 'P5: cambió de ficha';
  assert gondola_stock_de(spr) = stock_antes, 'P5: el stock de la presentación movida no cambia';
  assert gondola_stock_de(coca) = coca_antes, 'P5: el stock de la otra presentación no cambia';
  assert (select count(*) from conteos where producto_id = spr) = conteos_antes, 'P5: el historial sigue en su presentación';
  assert (select archivada from fichas_producto where id = forig), 'P5: la ficha vacía se archiva, no se borra';
  assert (select count(*) from cambios_ficha where producto_id = spr) = 1, 'P5: queda registrado el cambio';
end $$;
-- P5b: incompatibles o repetidas
select pg_temp.debe_fallar(format('select gondola_mover_presentacion(%L, %L)',
  (select id from productos where nombre = 'Leche entera 1 L'), (select v from t_ids where k='fcoca')), 'perecedera');
select pg_temp.debe_fallar(format('select gondola_mover_presentacion(%L, %L)',
  (select id from productos where nombre = 'Agua mineral 1,5 L'), (select v from t_ids where k='fcoca')), 'ya tiene una presentación');
do $$ declare f uuid; begin
  insert into fichas_producto (nombre) values ('Harina Prueba') returning id into f;
  insert into productos (ficha_id, nombre, presentacion, contenido, unidad_contenido) values (f, 'Harina Prueba 1 kg', '1 kg', 1, 'kg');
  insert into t_ids values ('fharina', f);
end $$;
select pg_temp.debe_fallar(format('select gondola_mover_presentacion(%L, %L)',
  (select v from t_ids where k='p473'), (select v from t_ids where k='fharina')), 'se miden distinto');
-- anon no puede escribir el registro de cambios a mano
select pg_temp.debe_fallar('insert into cambios_ficha (producto_id, ficha_origen, ficha_destino, presentacion_antes, presentacion_despues, nombre_antes, nombre_despues) select id, ficha_id, ficha_id, ''a'',''b'',''c'',''d'' from productos limit 1', 'permission denied');

-- ---------- S. Stock y conteos ----------
do $$
declare leche uuid; yogur uuid; esperado numeric; sid uuid; dif numeric;
begin
  select id into leche from productos where nombre = 'Leche entera 1 L';
  select id into yogur from productos where nombre = 'Yogur bebible 1 L';
  insert into t_ids values ('leche', leche), ('yogur', yogur);
  esperado := gondola_stock_de(leche);
  -- S1/S2: conteo periódico con dos lotes y una discrepancia
  sid := gondola_registrar_conteo('periodico', jsonb_build_array(
    jsonb_build_object('producto_id', leche, 'cantidad', 10, 'fecha_vencimiento', (current_date - 2)::text),
    jsonb_build_object('producto_id', leche, 'cantidad', 15, 'fecha_vencimiento', (current_date + 3)::text),
    jsonb_build_object('producto_id', yogur, 'cantidad', 4, 'fecha_vencimiento', (current_date + 20)::text)), 'prueba');
  insert into t_ids values ('sesion', sid);
  assert gondola_stock_de(leche) = 25, 'S2: stock = suma de lotes contados';
  assert (select count(distinct stock_esperado) from conteos where sesion_id = sid and producto_id = leche) = 1, 'S3: esperado único por presentación';
  assert (select max(stock_esperado) from conteos where sesion_id = sid and producto_id = leche) = esperado, 'S3: guarda el stock esperado';
  dif := 25 - esperado;
  assert dif <> 0, 'S3: la prueba necesita una discrepancia';
  assert (select tipo from sesiones_conteo where id = sid) = 'periodico', 'S4: historial de la sesión';
end $$;
do $$ declare leche uuid := (select v from t_ids where k='leche'); begin
  -- S5: recepción posterior suma (otra transacción, como en la app)
  insert into recepciones (id, proveedor_id, fecha, origen) select gen_random_uuid(), id, current_date, 'manual' from proveedores where nombre = 'Lácteos del Sur';
  insert into recepcion_lineas (recepcion_id, producto_id, descripcion, cantidad, fecha_vencimiento)
    select id, leche, 'Leche', 12, current_date + 10 from recepciones where estado = 'borrador' and origen = 'manual' order by creada_en desc limit 1;
  update recepciones set estado = 'confirmada' where id = (select recepcion_id from recepcion_lineas where descripcion = 'Leche' order by id desc limit 1);
  assert gondola_stock_de(leche) = 37, 'S5: recepción posterior al conteo suma';
end $$;
-- S6: conteo negativo rechazado; sin líneas rechazado
select pg_temp.debe_fallar(format($q$select gondola_registrar_conteo('periodico', '[{"producto_id":"%s","cantidad":-1}]')$q$, (select v from t_ids where k='leche')), 'conteos_cantidad_no_negativa');
select pg_temp.debe_fallar($q$select gondola_registrar_conteo('periodico', '[]')$q$, 'al menos un producto');
-- los conteos no se editan
select pg_temp.debe_fallar('update sesiones_conteo set notas = ''x''', 'permission denied');

-- ---------- V. Vencimientos por lote ----------
do $$ declare leche uuid := (select v from t_ids where k='leche'); begin
  assert (select count(*) from v_lotes where producto_id = leche) = 3, 'V1: tres lotes de leche (2 contados + 1 recibido)';
  assert (select estado from v_lotes where producto_id = leche and fecha_vencimiento = current_date - 2) = 'vencido', 'V2: lote vencido';
  assert (select estado from v_lotes where producto_id = leche and fecha_vencimiento = current_date + 3) = 'por_vencer', 'V3: lote por vencer';
  assert (select recepcion_id is not null and origen = 'recepcion' from v_lotes where producto_id = leche and fecha_vencimiento = current_date + 10), 'V4: el lote recibido referencia su recepción';
  assert (select count(*) from v_vencimientos where producto_id = leche) = 1, 'V5: la vista anterior (Hoy) muestra solo lo que vence en 0..7 días';
end $$;

-- ---------- D. Devoluciones ----------
do $$
declare leche uuid := (select v from t_ids where k='leche'); prov uuid; dev uuid; stock0 numeric; lin bigint;
begin
  select id into prov from proveedores where nombre = 'Lácteos del Sur';
  stock0 := gondola_stock_de(leche);
  insert into devoluciones (proveedor_id, motivo, tipo) values (prov, 'vencido', 'cambio') returning id into dev;
  insert into devolucion_lineas (devolucion_id, producto_id, cantidad, fecha_vencimiento) values (dev, leche, 10, current_date - 2) returning id into lin;
  insert into t_ids values ('dev', dev);
  -- D1: preparada no descuenta stock
  assert gondola_stock_de(leche) = stock0, 'D1: preparada no cambia el stock';
  assert (select respuesta_proveedor from devoluciones where id = dev) = 'pendiente', 'D1: respuesta pendiente';
  -- D2: entregar descuenta una sola vez
  update devoluciones set estado = 'entregada' where id = dev;
  assert gondola_stock_de(leche) = stock0 - 10, 'D2: entregada descuenta el stock';
  assert (select count(*) from movimientos_stock where devolucion_linea_id = lin) = 1, 'D2: un movimiento por línea';
  update devoluciones set nota = 'llamar el lunes' where id = dev;
  update devoluciones set estado = 'entregada' where id = dev;
  assert (select count(*) from movimientos_stock where devolucion_linea_id = lin) = 1, 'D3: no se duplica el movimiento';
  assert gondola_stock_de(leche) = stock0 - 10, 'D3: el stock no se descuenta dos veces';
  -- el lote vencido desaparece de los lotes vivos
  assert not exists (select 1 from v_lotes where producto_id = leche and fecha_vencimiento = current_date - 2), 'D4: el lote devuelto ya no figura';
end $$;
select pg_temp.debe_fallar(format('update devoluciones set estado = ''cancelada'' where id = %L', (select v from t_ids where k='dev')), 'no puede volver atrás');
select pg_temp.debe_fallar(format('update devolucion_lineas set cantidad = 1 where devolucion_id = %L', (select v from t_ids where k='dev')), 'no se puede modificar la mercadería');
select pg_temp.debe_fallar(format('update devoluciones set estado = ''resuelta'' where id = %L', (select v from t_ids where k='dev')), 'aceptó o rechazó');
select pg_temp.debe_fallar(format('update devoluciones set respuesta_proveedor = ''aceptada'' where id = %L', (select v from t_ids where k='dev')), 'al resolver');
update devoluciones set estado = 'resuelta', respuesta_proveedor = 'aceptada', resolucion = 'Reemplazo en la próxima visita' where id = (select v from t_ids where k='dev');
select pg_temp.debe_fallar(format('update devoluciones set nota = ''x'' where id = %L', (select v from t_ids where k='dev')), 'ya está cerrada');
-- D5: no se puede devolver más que el stock; no se crean preparadas con respuesta
select pg_temp.debe_fallar($q$insert into devoluciones (proveedor_id, motivo, estado) select id, 'danado', 'entregada' from proveedores limit 1$q$, 'se crean preparadas');
do $$ declare yogur uuid := (select v from t_ids where k='yogur'); d uuid; begin
  insert into devoluciones (proveedor_id, motivo) select id, 'danado' from proveedores where nombre = 'Lácteos del Sur' returning id into d;
  insert into devolucion_lineas (devolucion_id, producto_id, cantidad) values (d, yogur, 999);
  insert into t_ids values ('dev2', d);
end $$;
select pg_temp.debe_fallar(format('update devoluciones set estado = ''entregada'' where id = %L', (select v from t_ids where k='dev2')), 'No hay stock suficiente');
-- D6: cancelar una preparada no toca el stock
do $$ declare yogur uuid := (select v from t_ids where k='yogur'); s numeric; begin
  s := gondola_stock_de(yogur);
  update devoluciones set estado = 'cancelada' where id = (select v from t_ids where k='dev2');
  assert gondola_stock_de(yogur) = s, 'D6: cancelar no cambia el stock';
  assert not exists (select 1 from movimientos_stock m join devolucion_lineas l on l.id = m.devolucion_linea_id where l.devolucion_id = (select v from t_ids where k='dev2')), 'D6: sin movimientos';
end $$;
-- D7: la app no puede inventar una salida por devolución
select pg_temp.debe_fallar(format($q$insert into movimientos_stock (producto_id, tipo, cantidad, devolucion_linea_id) values (%L, 'devolucion', 1, (select id from devolucion_lineas order by id limit 1))$q$, (select v from t_ids where k='yogur')), 'al marcar la devolución');

-- ---------- B. Bajas por descarte ----------
do $$ declare leche uuid := (select v from t_ids where k='leche'); s numeric; begin
  s := gondola_stock_de(leche);
  insert into movimientos_stock (producto_id, tipo, cantidad, fecha_vencimiento, motivo) values (leche, 'baja', 2, current_date + 3, 'Envase roto');
  assert gondola_stock_de(leche) = s - 2, 'B1: la baja descuenta';
  assert (select count(*) from movimientos_stock where producto_id = leche and tipo = 'baja') = 1, 'B1: baja diferenciada de la devolución';
  assert (select count(*) from movimientos_stock where producto_id = leche and tipo = 'devolucion') = 1, 'B1: la devolución sigue registrada';
end $$;
select pg_temp.debe_fallar(format($q$insert into movimientos_stock (producto_id, tipo, cantidad, motivo) values (%L, 'baja', 9999, 'x')$q$, (select v from t_ids where k='leche')), 'No hay stock suficiente');
select pg_temp.debe_fallar(format($q$insert into movimientos_stock (producto_id, tipo, cantidad) values (%L, 'baja', 1)$q$, (select v from t_ids where k='leche')), 'motivo');
select pg_temp.debe_fallar('update movimientos_stock set cantidad = 1', 'permission denied');
select pg_temp.debe_fallar('delete from movimientos_stock', 'permission denied');

-- ---------- C. Consumo: las salidas no cuentan como consumo ----------
do $$ declare leche uuid := (select v from t_ids where k='leche'); r record; begin
  perform gondola_registrar_conteo('periodico', jsonb_build_array(jsonb_build_object('producto_id', leche, 'cantidad', 20)));
  select * into r from v_consumo_historico where producto_id = leche order by hasta desc limit 1;
  -- anterior 25 + recibido 12 − salidas (10 devolución + 2 baja) − final 20 = 5
  assert r.consumo = 5, format('C1: consumo esperado 5, dio %s', r.consumo);
  assert r.salidas = 12, 'C1: salidas del período';
  assert gondola_stock_de(leche) = 20, 'C2: el conteo nuevo manda';
end $$;

reset role;
-- R. Restablecer demo sigue funcionando y deja todo coherente
select gondola_restablecer_demo();
do $$ begin
  assert (select count(*) from fichas_producto) = 6, 'R1: 6 fichas';
  assert (select count(*) from movimientos_stock) = 0 and (select count(*) from devoluciones) = 0, 'R1: tablas nuevas limpias';
end $$;
select 'TODAS LAS PRUEBAS DE BASE PASARON' as resultado;
