-- =====================================================================
-- Góndola · Pedido sugerido y botón "Restablecer demo"
-- Se corre UNA vez en Supabase → SQL Editor → Run, después de 01 y 02.
-- Se puede correr de nuevo sin problema.
--
--   1. Agrega el teléfono del proveedor (para mandarle el pedido por WhatsApp).
--   2. Crea gondola_restablecer_demo(): hace lo mismo que 02_datos_ejemplo.sql
--      y la app la llama desde el botón "Restablecer demo" (Catálogo y Recepción).
--      Si cambiás los datos de ejemplo, cambialos en los dos archivos.
--
-- Ojo: como la app no tiene login, cualquiera con el link puede restablecer.
-- Sirve para la demo; con usuarios por almacén habría que restringirla.
-- =====================================================================

-- 1. Teléfono del proveedor
alter table proveedores add column if not exists telefono text;

-- 2. Restablecer la demo
create or replace function gondola_restablecer_demo() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tz constant text := 'America/Argentina/Buenos_Aires';
  hoy date := (now() at time zone tz)::date;
  p_coca uuid; p_sprite uuid; p_agua uuid; p_leche uuid; p_yogur uuid; p_yerba uuid;
  v_centro uuid; v_lacteos uuid; v_mayorista uuid;
  r uuid;
  h record;
  i int := 0;
begin
  truncate recepcion_lineas, recepciones, conteos, producto_proveedor, productos, proveedores restart identity cascade;

  -- Productos
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Coca-Cola 2,25 L',   'unidad', false, 12) returning id into p_coca;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Sprite 2,25 L',      'unidad', false, 6)  returning id into p_sprite;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Agua mineral 1,5 L', 'unidad', false, 10) returning id into p_agua;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Leche entera 1 L',   'unidad', true,  20) returning id into p_leche;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Yogur bebible 1 L',  'unidad', true,  6)  returning id into p_yogur;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Yerba 1 kg',         'unidad', false, 8)  returning id into p_yerba;

  -- Proveedores (1 = lunes … 7 = domingo)
  insert into proveedores (nombre, dias_visita) values ('Distribuidora Centro', '{2,5}')   returning id into v_centro;     -- martes y viernes
  insert into proveedores (nombre, dias_visita) values ('Lácteos del Sur',      '{1,3,5}') returning id into v_lacteos;    -- lunes, miércoles y viernes
  insert into proveedores (nombre, dias_visita) values ('Mayorista Rosario',    '{4}')     returning id into v_mayorista;  -- jueves

  insert into producto_proveedor (proveedor_id, producto_id) values
    (v_centro, p_coca), (v_centro, p_sprite), (v_centro, p_agua),
    (v_lacteos, p_leche), (v_lacteos, p_yogur),
    (v_mayorista, p_yerba), (v_mayorista, p_coca);

  -- Recepciones pasadas (se crean en borrador y se confirman, como en la app)
  insert into recepciones (proveedor_id, fecha, origen) values (v_centro, hoy - 12, 'manual') returning id into r;
  insert into recepcion_lineas (recepcion_id, producto_id, descripcion, cantidad) values
    (r, p_coca, 'Coca-Cola 2,25 L', 12), (r, p_sprite, 'Sprite 2,25 L', 6), (r, p_agua, 'Agua mineral 1,5 L', 12);
  update recepciones set estado = 'confirmada', confirmada_en = ((hoy - 12) + time '11:00') at time zone tz where id = r;

  insert into recepciones (proveedor_id, fecha, origen) values (v_lacteos, hoy - 10, 'manual') returning id into r;
  insert into recepcion_lineas (recepcion_id, producto_id, descripcion, cantidad, fecha_vencimiento) values
    (r, p_leche, 'Leche entera 1 L', 24, hoy), (r, p_yogur, 'Yogur bebible 1 L', 12, hoy - 1);
  update recepciones set estado = 'confirmada', confirmada_en = ((hoy - 10) + time '10:00') at time zone tz where id = r;

  insert into recepciones (proveedor_id, fecha, origen) values (v_mayorista, hoy - 14, 'manual') returning id into r;
  insert into recepcion_lineas (recepcion_id, producto_id, descripcion, cantidad) values
    (r, p_yerba, 'Yerba 1 kg', 12), (r, p_coca, 'Coca-Cola 2,25 L', 6);
  update recepciones set estado = 'confirmada', confirmada_en = ((hoy - 14) + time '12:00') at time zone tz where id = r;

  -- Conteos de las últimas 3 semanas: (producto, días atrás, cantidad, vencimiento en días desde hoy)
  for h in
    select * from (values
      (p_coca, 21, 20, null::int), (p_coca, 14, 9, null), (p_coca, 7, 14, null), (p_coca, 2, 15, null),
      (p_sprite, 21, 8, null), (p_sprite, 14, 3, null), (p_sprite, 7, 7, null), (p_sprite, 2, 4, null),
      (p_agua, 22, 18, null), (p_agua, 15, 12, null), (p_agua, 11, 24, null), (p_agua, 4, 20, null),
      (p_leche, 20, 26, -12), (p_leche, 13, 18, -6), (p_leche, 6, 32, 1), (p_leche, 1, 30, 5),
      (p_yogur, 20, 9, -10), (p_yogur, 13, 5, -4), (p_yogur, 6, 11, 3), (p_yogur, 1, 8, 2),
      (p_yerba, 23, 14, null), (p_yerba, 16, 10, null), (p_yerba, 9, 20, null)
    ) as t(producto_id, dias, cantidad, venc)
  loop
    i := i + 1;
    insert into conteos (producto_id, cantidad, fecha_hora, fecha_vencimiento)
    values (h.producto_id, h.cantidad,
            ((hoy - h.dias) + make_time(9, 15 + (i % 30), 0)) at time zone tz,
            case when h.venc is null then null else hoy + h.venc end);
  end loop;

  -- Remitos de ejemplo en BORRADOR (origen remito_foto), con errores a propósito
  -- para probar la pantalla de revisión.
  insert into recepciones (proveedor_id, fecha, origen, estado, imagen_path, datos_ia)
  values (v_lacteos, hoy, 'remito_foto', 'borrador', 'ejemplo:lacteos', jsonb_build_object(
    'proveedor', 'LÁCTEOS DEL SUR S.R.L.',
    'fecha', hoy,
    'lineas', jsonb_build_array(
      jsonb_build_object('descripcion', 'LECHE ENTERA SACHET 1 LT', 'cantidad', 24, 'fecha_vencimiento', hoy + 12, 'confianza', 0.97),
      jsonb_build_object('descripcion', 'YOG. BEB. FRUT. 1LT',      'cantidad', 18, 'fecha_vencimiento', hoy + 15, 'confianza', 0.55),
      jsonb_build_object('descripcion', 'QUESO CREMA X 290 G',      'cantidad', 6,  'fecha_vencimiento', hoy + 30, 'confianza', 0.93))))
  returning id into r;
  insert into recepcion_lineas (recepcion_id, producto_id, descripcion, cantidad, fecha_vencimiento, confianza_ia) values
    (r, p_leche, 'LECHE ENTERA SACHET 1 LT', 24, hoy + 12, 0.97),
    -- En el papel dice 12: la "IA" leyó 18 con confianza baja
    (r, p_yogur, 'YOG. BEB. FRUT. 1LT',      18, hoy + 15, 0.55),
    -- No está en el catálogo
    (r, null,    'QUESO CREMA X 290 G',      6,  hoy + 30, 0.93);

  insert into recepciones (proveedor_id, fecha, origen, estado, imagen_path, datos_ia)
  values (v_centro, hoy, 'remito_foto', 'borrador', 'ejemplo:centro', jsonb_build_object(
    'proveedor', 'DISTRIBUIDORA CENTRO S.A.',
    'fecha', hoy,
    'lineas', jsonb_build_array(
      jsonb_build_object('descripcion', 'COCA COLA 2,25 LT',          'cantidad', 12, 'fecha_vencimiento', null, 'confianza', 0.98),
      jsonb_build_object('descripcion', 'SPRITE LIMA-LIMON 2,25 LT',  'cantidad', 6,  'fecha_vencimiento', null, 'confianza', 0.95),
      jsonb_build_object('descripcion', 'AGUA MIN. S/GAS 1500 CC',    'cantidad', 12, 'fecha_vencimiento', null, 'confianza', 0.60),
      jsonb_build_object('descripcion', 'FANTA NARANJA 2,25 LT',      'cantidad', 6,  'fecha_vencimiento', null, 'confianza', 0.94))))
  returning id into r;
  insert into recepcion_lineas (recepcion_id, producto_id, descripcion, cantidad, confianza_ia) values
    (r, p_coca,   'COCA COLA 2,25 LT',         12, 0.98),
    (r, p_sprite, 'SPRITE LIMA-LIMON 2,25 LT', 6,  0.95),
    (r, p_agua,   'AGUA MIN. S/GAS 1500 CC',   12, 0.60),
    (r, null,     'FANTA NARANJA 2,25 LT',     6,  0.94);
end;
$$;

revoke all on function gondola_restablecer_demo() from public;
grant execute on function gondola_restablecer_demo() to anon, authenticated;

-- Para que la API vea la columna y la función nuevas sin esperar
notify pgrst, 'reload schema';
