-- =====================================================================
-- Góndola · Mantenimiento 25/10/2026 · Revertir la migración 04 «alternativa»
--
-- El 25/10 se aplicó por error en producción una 04 alternativa
-- (04_presentaciones_stock_vencimientos.sql, modelo fichas_producto) en lugar de la
-- 04 del proyecto (04_presentaciones_lotes_devoluciones.sql). Este script deja la base
-- exactamente como estaba después de 01 + 03, para poder aplicar la 04 correcta.
--
-- Solo quita objetos que creó esa 04 alternativa. No toca productos, proveedores,
-- conteos, recepciones ni líneas (sus filas y valores quedan iguales).
-- Se aborta si alguien llegó a cargar datos con esa versión (devoluciones, bajas,
-- sesiones de conteo, presentaciones movidas o editadas).
-- Respaldo previo: esquema respaldo_20261025 (y el que se haga antes de correr esto).
-- =====================================================================
begin;

do $$
begin
  if to_regclass('public.fichas_producto') is null then
    raise notice 'La 04 alternativa no está aplicada: no hay nada que revertir.';
    return;
  end if;
  if exists (select 1 from devoluciones) or exists (select 1 from movimientos_stock)
     or exists (select 1 from sesiones_conteo) or exists (select 1 from cambios_ficha)
     or exists (select 1 from conteos where sesion_id is not null or stock_esperado is not null)
     or exists (select 1 from productos where lower(btrim(presentacion)) <> 'única' or contenido is not null
                or unidad_contenido is not null or unidades_por_presentacion <> 1)
     or (select count(*) from fichas_producto) <> (select count(*) from productos)
     or exists (select 1 from fichas_producto f where (select count(*) from productos p where p.ficha_id = f.id) <> 1) then
    raise exception 'Hay datos cargados con la 04 alternativa: NO se revierte. Revisar a mano.';
  end if;
end $$;

-- Triggers y funciones de la 04 alternativa
drop trigger if exists productos_ficha on productos;
drop trigger if exists devoluciones_reglas on devoluciones;
drop trigger if exists devoluciones_movimientos on devoluciones;
drop trigger if exists devolucion_lineas_reglas on devolucion_lineas;
drop trigger if exists movimientos_reglas on movimientos_stock;

-- Vistas: se vuelven a crear exactamente como en 01_esquema.sql
drop view if exists v_vencimientos;
drop view if exists v_lotes;
drop view if exists v_stock_actual;
drop view if exists v_consumo_historico;

create view v_stock_actual with (security_invoker = true) as
with ultimo as (
  select distinct on (producto_id) producto_id, cantidad, fecha_hora, fecha_vencimiento
  from conteos
  order by producto_id, fecha_hora desc, id desc
),
recibido as (
  select l.producto_id, sum(l.cantidad) as cantidad
  from recepcion_lineas l
  join recepciones r on r.id = l.recepcion_id and r.estado = 'confirmada'
  left join ultimo u on u.producto_id = l.producto_id
  where l.estado = 'vinculada'
    and (u.fecha_hora is null or r.confirmada_en > u.fecha_hora)
  group by l.producto_id
),
base as (
  select
    p.id as producto_id, p.nombre, p.unidad, p.perecedero, p.punto_pedido,
    u.cantidad as cantidad_ultimo_conteo,
    u.fecha_hora as fecha_ultimo_conteo,
    coalesce(rc.cantidad, 0) as recibido_despues,
    case when u.producto_id is null and rc.producto_id is null then null
         else coalesce(u.cantidad, 0) + coalesce(rc.cantidad, 0) end as stock_actual,
    case when u.fecha_hora is null then null
         else (now() at time zone 'America/Argentina/Buenos_Aires')::date
              - (u.fecha_hora at time zone 'America/Argentina/Buenos_Aires')::date end as dias_desde_conteo
  from productos p
  left join ultimo u on u.producto_id = p.id
  left join recibido rc on rc.producto_id = p.id
)
select
  base.*,
  coalesce(stock_actual <= punto_pedido, false) as bajo_punto_pedido,
  (dias_desde_conteo is null or dias_desde_conteo > 7) as conteo_desactualizado
from base;

create view v_vencimientos with (security_invoker = true) as
with ultimo as (
  select distinct on (producto_id) producto_id, cantidad, fecha_hora, fecha_vencimiento
  from conteos
  order by producto_id, fecha_hora desc, id desc
),
lotes as (
  select producto_id, fecha_vencimiento, cantidad, 'conteo'::text as origen
  from ultimo where fecha_vencimiento is not null
  union all
  select l.producto_id, l.fecha_vencimiento, l.cantidad, 'recepcion'
  from recepcion_lineas l
  join recepciones r on r.id = l.recepcion_id and r.estado = 'confirmada'
  left join ultimo u on u.producto_id = l.producto_id
  where l.estado = 'vinculada' and l.fecha_vencimiento is not null
    and (u.fecha_hora is null or r.confirmada_en > u.fecha_hora)
)
select
  lo.producto_id, p.nombre, lo.fecha_vencimiento, lo.cantidad, lo.origen,
  lo.fecha_vencimiento - (now() at time zone 'America/Argentina/Buenos_Aires')::date as dias_para_vencer
from lotes lo
join productos p on p.id = lo.producto_id
where lo.fecha_vencimiento - (now() at time zone 'America/Argentina/Buenos_Aires')::date between 0 and 7;

create view v_consumo_historico with (security_invoker = true) as
with c as (
  select producto_id, cantidad, fecha_hora,
         lag(cantidad)   over w as cantidad_anterior,
         lag(fecha_hora) over w as fecha_anterior
  from conteos
  window w as (partition by producto_id order by fecha_hora)
)
select
  c.producto_id, p.nombre,
  c.fecha_anterior as desde,
  c.fecha_hora as hasta,
  c.cantidad_anterior as stock_inicial,
  coalesce(rec.cantidad, 0) as recibido,
  c.cantidad as stock_final,
  c.cantidad_anterior + coalesce(rec.cantidad, 0) - c.cantidad as consumo,
  round(extract(epoch from (c.fecha_hora - c.fecha_anterior)) / 86400, 2) as dias,
  round((c.cantidad_anterior + coalesce(rec.cantidad, 0) - c.cantidad)
        / nullif(extract(epoch from (c.fecha_hora - c.fecha_anterior)) / 86400, 0), 2) as consumo_diario
from c
join productos p on p.id = c.producto_id
left join lateral (
  select sum(l.cantidad) as cantidad
  from recepcion_lineas l
  join recepciones r on r.id = l.recepcion_id and r.estado = 'confirmada'
  where l.producto_id = c.producto_id and l.estado = 'vinculada'
    and r.confirmada_en > c.fecha_anterior and r.confirmada_en <= c.fecha_hora
) rec on true
where c.fecha_anterior is not null;

grant select on v_stock_actual, v_vencimientos, v_consumo_historico to anon, authenticated;

drop function if exists gondola_mover_presentacion(uuid, uuid, text);
drop function if exists gondola_registrar_conteo(text, jsonb, text);
drop function if exists gondola_stock_de(uuid);
drop function if exists gondola_devolucion_reglas();
drop function if exists gondola_devolucion_movimientos();
drop function if exists gondola_devolucion_linea_reglas();
drop function if exists gondola_movimiento_reglas();
drop function if exists gondola_producto_ficha();

-- Tablas de la 04 alternativa (verificado arriba: sin datos propios)
drop table if exists movimientos_stock;
drop table if exists devolucion_lineas;
drop table if exists devoluciones;
drop table if exists cambios_ficha;

alter table conteos drop column if exists sesion_id;
alter table conteos drop column if exists stock_esperado;
drop index if exists conteos_sesion;
drop table if exists sesiones_conteo;

drop index if exists productos_ficha_presentacion_unica;
drop index if exists productos_ficha;
alter table productos drop constraint if exists productos_presentacion_no_vacia;
alter table productos drop constraint if exists productos_contenido_positivo;
alter table productos drop constraint if exists productos_unidad_contenido_valida;
alter table productos drop constraint if exists productos_equivalencia_positiva;
alter table productos drop column if exists ficha_id;
alter table productos drop column if exists presentacion;
alter table productos drop column if exists contenido;
alter table productos drop column if exists unidad_contenido;
alter table productos drop column if exists unidades_por_presentacion;
drop table if exists fichas_producto;

-- Restablecer demo: vuelve a la versión de 03 (la 04 correcta la reemplaza después)
do $$
declare def text;
begin
  select pg_get_functiondef('gondola_restablecer_demo()'::regprocedure) into def;
  if position('movimientos_stock' in def) > 0 then
    def := replace(def,
      'truncate movimientos_stock, devolucion_lineas, devoluciones, cambios_ficha, recepcion_lineas, recepciones, conteos, sesiones_conteo, producto_proveedor, productos, fichas_producto, proveedores restart identity cascade;',
      'truncate recepcion_lineas, recepciones, conteos, producto_proveedor, productos, proveedores restart identity cascade;');
    execute def;
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
