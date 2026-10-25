-- =====================================================================
-- Góndola · Migración 04 · Correcciones del profesor (etapa 1)
--   1. Ficha única de producto con presentaciones
--   2. Stock y conteos independientes del proveedor
--   3. Vencimientos por lote, devoluciones al proveedor y bajas por descarte
--
-- Se corre en Supabase → SQL Editor → Run, después de 01, 02 y 03.
-- Es IDEMPOTENTE: se puede correr más de una vez sin duplicar nada.
-- Es ADITIVA: no borra tablas, columnas ni filas. La versión anterior de la app
-- sigue funcionando con la base migrada.
--
-- Modelo:
--   fichas_producto  = la ficha única (p. ej. "Cerveza Quilmes").
--   productos        = cada PRESENTACIÓN de una ficha (p. ej. "473 ml", "1 L").
--                      Se conserva la tabla y sus id: conteos, recepciones y
--                      proveedores ya apuntan a la presentación concreta, así que
--                      el historial no se toca.
--   Migración de datos: cada producto existente recibe su ficha y queda como
--   presentación «Única» con equivalencia 1:1. No se fusiona nada automáticamente.
--
-- Stock de cada presentación = último conteo (suma de sus lotes)
--                            + recepciones confirmadas después
--                            − salidas (devoluciones entregadas y bajas) después.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Fichas de producto y presentaciones
-- ---------------------------------------------------------------------

create table if not exists fichas_producto (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  archivada  boolean not null default false,
  creado_en  timestamptz not null default now(),
  constraint fichas_nombre_no_vacio check (btrim(nombre) <> '')
);

alter table productos add column if not exists ficha_id uuid references fichas_producto(id);
alter table productos add column if not exists presentacion text not null default 'Única';
-- Tamaño de la presentación (opcional): 473 + 'ml', 1 + 'l', 500 + 'g'…
alter table productos add column if not exists contenido numeric;
alter table productos add column if not exists unidad_contenido text;
-- Equivalencia: cuántas unidades sueltas trae la presentación (pack x6 = 6). «Única» = 1.
alter table productos add column if not exists unidades_por_presentacion numeric not null default 1;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'productos_presentacion_no_vacia') then
    alter table productos add constraint productos_presentacion_no_vacia check (btrim(presentacion) <> '');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'productos_contenido_positivo') then
    alter table productos add constraint productos_contenido_positivo check (contenido is null or contenido > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'productos_unidad_contenido_valida') then
    alter table productos add constraint productos_unidad_contenido_valida
      check (unidad_contenido is null or unidad_contenido in ('ml','l','g','kg','unidad'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'productos_equivalencia_positiva') then
    alter table productos add constraint productos_equivalencia_positiva check (unidades_por_presentacion > 0);
  end if;
end $$;

-- Una ficha nueva por cada producto que todavía no tiene (solo los que falten:
-- correrlo de nuevo no crea fichas repetidas). Presentación «Única», 1:1.
do $$
declare
  r record;
  fid uuid;
begin
  for r in select id, nombre, creado_en from productos where ficha_id is null order by creado_en, id loop
    insert into fichas_producto (nombre, creado_en) values (r.nombre, r.creado_en) returning id into fid;
    update productos set ficha_id = fid where id = r.id;
  end loop;
end $$;

-- Dentro de una ficha no se repite el nombre de la presentación
create unique index if not exists productos_ficha_presentacion_unica
  on productos (ficha_id, lower(btrim(presentacion)));
create index if not exists productos_ficha on productos (ficha_id);

-- Si alguien crea un producto sin ficha (por ejemplo, la versión anterior de la app),
-- se le crea su ficha con presentación «Única». Si se renombra una presentación «Única»
-- que es la única de su ficha, la ficha acompaña el nombre.
create or replace function gondola_producto_ficha() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.ficha_id is null then
      insert into fichas_producto (nombre) values (new.nombre) returning id into new.ficha_id;
    end if;
    return new;
  end if;
  if new.nombre is distinct from old.nombre
     and new.ficha_id = old.ficha_id
     and lower(btrim(new.presentacion)) = 'única'
     and (select count(*) from productos where ficha_id = new.ficha_id) = 1 then
    update fichas_producto set nombre = new.nombre where id = new.ficha_id;
  end if;
  return new;
end $$;

drop trigger if exists productos_ficha on productos;
create trigger productos_ficha
  before insert or update on productos
  for each row execute function gondola_producto_ficha();

alter table productos alter column ficha_id set not null;

-- Registro de presentaciones movidas entre fichas (trazabilidad de «Mover a otro producto»)
create table if not exists cambios_ficha (
  id                  bigint generated always as identity primary key,
  producto_id         uuid not null references productos(id),
  ficha_origen        uuid not null references fichas_producto(id),
  ficha_destino       uuid not null references fichas_producto(id),
  presentacion_antes  text not null,
  presentacion_despues text not null,
  nombre_antes        text not null,
  nombre_despues      text not null,
  fecha_hora          timestamptz not null default now()
);

-- Mueve UNA presentación a otra ficha. No toca conteos, recepciones ni salidas:
-- siguen apuntando a la misma presentación, así que su stock e historial no cambian.
create or replace function gondola_mover_presentacion(
  p_producto uuid, p_ficha_destino uuid, p_presentacion text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pr productos%rowtype;
  destino fichas_producto%rowtype;
  nueva text;
  nombre_nuevo text;
  fam_origen text;
begin
  select * into pr from productos where id = p_producto for update;
  if not found then raise exception 'La presentación no existe.'; end if;
  select * into destino from fichas_producto where id = p_ficha_destino;
  if not found then raise exception 'El producto de destino no existe.'; end if;
  if destino.id = pr.ficha_id then raise exception 'La presentación ya pertenece a ese producto.'; end if;

  nueva := btrim(coalesce(nullif(btrim(p_presentacion), ''), pr.presentacion));

  if exists (select 1 from productos where ficha_id = destino.id and perecedero <> pr.perecedero) then
    raise exception 'No son compatibles: una es perecedera y la otra no.';
  end if;
  fam_origen := case when pr.unidad_contenido in ('ml','l') then 'volumen' when pr.unidad_contenido in ('g','kg') then 'peso'
                     when pr.unidad_contenido = 'unidad' then 'unidad' end;
  if fam_origen is not null and exists (
    select 1 from productos where ficha_id = destino.id and unidad_contenido is not null
      and (case when unidad_contenido in ('ml','l') then 'volumen' when unidad_contenido in ('g','kg') then 'peso' else 'unidad' end) <> fam_origen
  ) then
    raise exception 'No son compatibles: las presentaciones del destino se miden distinto (volumen, peso o unidades).';
  end if;

  if exists (select 1 from productos where ficha_id = destino.id and lower(btrim(presentacion)) = lower(nueva)) then
    raise exception 'El producto de destino ya tiene una presentación «%». Poné otro nombre de presentación para moverla.', nueva;
  end if;

  nombre_nuevo := case when lower(nueva) = 'única' then destino.nombre else destino.nombre || ' ' || nueva end;
  if exists (select 1 from productos where id <> pr.id and lower(btrim(nombre)) = lower(btrim(nombre_nuevo))) then
    raise exception 'Ya existe otra presentación llamada «%». Poné otro nombre de presentación.', nombre_nuevo;
  end if;

  update productos set ficha_id = destino.id, presentacion = nueva, nombre = nombre_nuevo where id = pr.id;
  insert into cambios_ficha (producto_id, ficha_origen, ficha_destino, presentacion_antes, presentacion_despues, nombre_antes, nombre_despues)
  values (pr.id, pr.ficha_id, destino.id, pr.presentacion, nueva, pr.nombre, nombre_nuevo);

  -- La ficha que queda vacía no se borra: se archiva (su historial de cambios la sigue referenciando).
  if not exists (select 1 from productos where ficha_id = pr.ficha_id) then
    update fichas_producto set archivada = true where id = pr.ficha_id;
  end if;
  update fichas_producto set archivada = false where id = destino.id;
end $$;

-- ---------------------------------------------------------------------
-- 2. Conteos de stock sin proveedor (sesiones, diferencias, lotes)
-- ---------------------------------------------------------------------

create table if not exists sesiones_conteo (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null default 'periodico',
  notas      text,
  creada_en  timestamptz not null default now(),
  constraint sesiones_tipo_valido check (tipo in ('inicial','periodico'))
);

alter table conteos add column if not exists sesion_id uuid references sesiones_conteo(id);
-- Stock que el sistema esperaba para esa presentación justo antes del conteo.
-- Diferencia (ajuste) = cantidad contada − stock_esperado. Si la presentación se cuenta
-- en varios lotes, se repite en cada fila del lote y la cantidad contada es la suma.
alter table conteos add column if not exists stock_esperado numeric;
create index if not exists conteos_sesion on conteos (sesion_id);

-- ---------------------------------------------------------------------
-- 3. Devoluciones al proveedor y salidas de stock
-- ---------------------------------------------------------------------

create table if not exists devoluciones (
  id                   uuid primary key default gen_random_uuid(),
  numero               bigint generated always as identity,
  proveedor_id         uuid not null references proveedores(id),
  tipo                 text not null default 'devolucion',
  motivo               text not null,
  nota                 text,
  -- preparada: remito armado, el stock NO cambia.
  -- entregada: la mercadería salió del almacén → recién acá se descuenta del stock.
  -- resuelta:  el proveedor respondió (aceptó o rechazó).
  -- cancelada: se anuló antes de entregarla (el stock nunca cambió).
  estado               text not null default 'preparada',
  -- Condición comercial: la app nunca da por aceptada una devolución sin que se registre.
  respuesta_proveedor  text not null default 'pendiente',
  resolucion           text,
  fecha                date not null default (now() at time zone 'America/Argentina/Buenos_Aires')::date,
  creada_en            timestamptz not null default now(),
  entregada_en         timestamptz,
  resuelta_en          timestamptz,
  constraint devoluciones_numero_unico unique (numero),
  constraint devoluciones_tipo_valido check (tipo in ('devolucion','cambio')),
  constraint devoluciones_motivo_valido check (motivo in ('vencido','proximo_a_vencer','danado','otro')),
  constraint devoluciones_estado_valido check (estado in ('preparada','entregada','resuelta','cancelada')),
  constraint devoluciones_respuesta_valida check (respuesta_proveedor in ('pendiente','aceptada','rechazada'))
);

create table if not exists devolucion_lineas (
  id                 bigint generated always as identity primary key,
  devolucion_id      uuid not null references devoluciones(id) on delete cascade,
  producto_id        uuid not null references productos(id),
  cantidad           numeric not null,
  fecha_vencimiento  date,
  recepcion_id       uuid references recepciones(id),
  constraint devolucion_lineas_cantidad_positiva check (cantidad > 0)
);
create index if not exists devolucion_lineas_devolucion on devolucion_lineas (devolucion_id);

-- Salidas de stock. Nunca se editan ni se borran (trazabilidad).
--   devolucion: la crea la base al marcar la devolución como entregada (una por línea).
--   baja:       mercadería descartada (vencida, rota…). No pasa por el proveedor.
create table if not exists movimientos_stock (
  id                   uuid primary key default gen_random_uuid(),
  producto_id          uuid not null references productos(id),
  tipo                 text not null,
  cantidad             numeric not null,
  fecha_vencimiento    date,
  motivo               text,
  devolucion_linea_id  bigint references devolucion_lineas(id),
  fecha_hora           timestamptz not null default now(),
  constraint movimientos_tipo_valido check (tipo in ('devolucion','baja')),
  constraint movimientos_cantidad_positiva check (cantidad > 0),
  constraint movimientos_devolucion_con_linea check ((tipo = 'devolucion') = (devolucion_linea_id is not null)),
  -- Una línea de devolución descuenta stock UNA sola vez
  constraint movimientos_linea_unica unique (devolucion_linea_id)
);
create index if not exists movimientos_producto_fecha on movimientos_stock (producto_id, fecha_hora desc);

-- ---------------------------------------------------------------------
-- 4. Vistas (se reemplazan manteniendo las columnas que ya usaba la app)
-- ---------------------------------------------------------------------

-- Stock actual por presentación
create or replace view v_stock_actual with (security_invoker = true) as
with ult as (
  select producto_id, max(fecha_hora) as fecha_hora from conteos group by producto_id
),
ultimo as (
  select c.producto_id, u.fecha_hora, sum(c.cantidad) as cantidad
  from conteos c join ult u on u.producto_id = c.producto_id and u.fecha_hora = c.fecha_hora
  group by c.producto_id, u.fecha_hora
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
salidas as (
  select m.producto_id, sum(m.cantidad) as cantidad
  from movimientos_stock m
  left join ultimo u on u.producto_id = m.producto_id
  where u.fecha_hora is null or m.fecha_hora > u.fecha_hora
  group by m.producto_id
),
base as (
  select
    p.id as producto_id, p.nombre, p.unidad, p.perecedero, p.punto_pedido,
    u.cantidad as cantidad_ultimo_conteo,
    u.fecha_hora as fecha_ultimo_conteo,
    coalesce(rc.cantidad, 0) as recibido_despues,
    case when u.producto_id is null and rc.producto_id is null and sa.producto_id is null then null
         else coalesce(u.cantidad, 0) + coalesce(rc.cantidad, 0) - coalesce(sa.cantidad, 0) end as stock_actual,
    case when u.fecha_hora is null then null
         else (now() at time zone 'America/Argentina/Buenos_Aires')::date
              - (u.fecha_hora at time zone 'America/Argentina/Buenos_Aires')::date end as dias_desde_conteo,
    coalesce(sa.cantidad, 0) as salidas_despues,
    p.ficha_id, p.presentacion
  from productos p
  left join ultimo u on u.producto_id = p.id
  left join recibido rc on rc.producto_id = p.id
  left join salidas sa on sa.producto_id = p.id
)
select
  producto_id, nombre, unidad, perecedero, punto_pedido, cantidad_ultimo_conteo, fecha_ultimo_conteo,
  recibido_despues, stock_actual, dias_desde_conteo,
  coalesce(stock_actual <= punto_pedido, false) as bajo_punto_pedido,
  (dias_desde_conteo is null or dias_desde_conteo > 7) as conteo_desactualizado,
  salidas_despues, ficha_id, presentacion
from base;

-- Lotes (partidas) vivos por presentación y fecha de vencimiento
create or replace view v_lotes with (security_invoker = true) as
with ult as (
  select producto_id, max(fecha_hora) as fecha_hora from conteos group by producto_id
),
entradas as (
  select c.producto_id, c.fecha_vencimiento, c.cantidad, null::uuid as recepcion_id, c.fecha_hora as fecha
  from conteos c join ult u on u.producto_id = c.producto_id and u.fecha_hora = c.fecha_hora
  union all
  select l.producto_id, l.fecha_vencimiento, l.cantidad, r.id, r.confirmada_en
  from recepcion_lineas l
  join recepciones r on r.id = l.recepcion_id and r.estado = 'confirmada'
  left join ult u on u.producto_id = l.producto_id
  where l.estado = 'vinculada' and (u.fecha_hora is null or r.confirmada_en > u.fecha_hora)
),
ent as (
  select producto_id, fecha_vencimiento, sum(cantidad) as cantidad,
         (array_agg(recepcion_id order by fecha desc) filter (where recepcion_id is not null))[1] as recepcion_id,
         bool_or(recepcion_id is not null) as de_recepcion
  from entradas group by producto_id, fecha_vencimiento
),
sal as (
  select m.producto_id, m.fecha_vencimiento, sum(m.cantidad) as cantidad
  from movimientos_stock m
  left join ult u on u.producto_id = m.producto_id
  where u.fecha_hora is null or m.fecha_hora > u.fecha_hora
  group by m.producto_id, m.fecha_vencimiento
),
lotes as (
  select e.producto_id, e.fecha_vencimiento, e.cantidad - coalesce(s.cantidad, 0) as cantidad,
         e.recepcion_id, case when e.de_recepcion then 'recepcion' else 'conteo' end as origen,
         e.fecha_vencimiento - (now() at time zone 'America/Argentina/Buenos_Aires')::date as dias_para_vencer
  from ent e
  left join sal s on s.producto_id = e.producto_id and s.fecha_vencimiento is not distinct from e.fecha_vencimiento
)
select
  lo.producto_id, p.ficha_id, p.nombre, p.presentacion, lo.fecha_vencimiento, lo.cantidad,
  lo.recepcion_id, lo.origen, lo.dias_para_vencer,
  case when lo.fecha_vencimiento is null then 'sin_fecha'
       when lo.dias_para_vencer < 0 then 'vencido'
       when lo.dias_para_vencer <= 7 then 'por_vencer'
       else 'vigente' end as estado
from lotes lo
join productos p on p.id = lo.producto_id
where lo.cantidad > 0;

-- Compatibilidad con la versión anterior de la app (pantalla Hoy): próximos 7 días
create or replace view v_vencimientos with (security_invoker = true) as
select producto_id, nombre, fecha_vencimiento, cantidad, origen, dias_para_vencer
from v_lotes
where fecha_vencimiento is not null and dias_para_vencer between 0 and 7;

-- Consumo entre conteos: las devoluciones y bajas no son consumo
create or replace view v_consumo_historico with (security_invoker = true) as
with cc as (
  select producto_id, fecha_hora, sum(cantidad) as cantidad from conteos group by producto_id, fecha_hora
),
c as (
  select producto_id, cantidad, fecha_hora,
         lag(cantidad)   over w as cantidad_anterior,
         lag(fecha_hora) over w as fecha_anterior
  from cc
  window w as (partition by producto_id order by fecha_hora)
)
select
  c.producto_id, p.nombre,
  c.fecha_anterior as desde,
  c.fecha_hora as hasta,
  c.cantidad_anterior as stock_inicial,
  coalesce(rec.cantidad, 0) as recibido,
  c.cantidad as stock_final,
  c.cantidad_anterior + coalesce(rec.cantidad, 0) - coalesce(sal.cantidad, 0) - c.cantidad as consumo,
  round(extract(epoch from (c.fecha_hora - c.fecha_anterior)) / 86400, 2) as dias,
  round((c.cantidad_anterior + coalesce(rec.cantidad, 0) - coalesce(sal.cantidad, 0) - c.cantidad)
        / nullif(extract(epoch from (c.fecha_hora - c.fecha_anterior)) / 86400, 0), 2) as consumo_diario,
  coalesce(sal.cantidad, 0) as salidas
from c
join productos p on p.id = c.producto_id
left join lateral (
  select sum(l.cantidad) as cantidad
  from recepcion_lineas l
  join recepciones r on r.id = l.recepcion_id and r.estado = 'confirmada'
  where l.producto_id = c.producto_id and l.estado = 'vinculada'
    and r.confirmada_en > c.fecha_anterior and r.confirmada_en <= c.fecha_hora
) rec on true
left join lateral (
  select sum(m.cantidad) as cantidad
  from movimientos_stock m
  where m.producto_id = c.producto_id and m.fecha_hora > c.fecha_anterior and m.fecha_hora <= c.fecha_hora
) sal on true
where c.fecha_anterior is not null;

-- ---------------------------------------------------------------------
-- 5. Reglas (triggers y funciones)
-- ---------------------------------------------------------------------

-- Registra un conteo completo (inicial o periódico) en una sola operación.
-- p_lineas: [{"producto_id": "...", "cantidad": 12, "fecha_vencimiento": "2026-11-01"}, ...]
-- Una presentación puede venir en varias líneas (un lote por fecha de vencimiento).
-- Guarda, para cada presentación, el stock que esperaba el sistema justo antes de contar.
create or replace function gondola_registrar_conteo(p_tipo text, p_lineas jsonb, p_notas text default null)
returns uuid
language plpgsql
as $$
declare
  sid uuid;
begin
  if p_tipo is null or p_tipo not in ('inicial','periodico') then
    raise exception 'Tipo de conteo inválido.';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Cargá la cantidad de al menos un producto.';
  end if;
  insert into sesiones_conteo (tipo, notas) values (p_tipo, nullif(btrim(coalesce(p_notas, '')), '')) returning id into sid;
  insert into conteos (producto_id, cantidad, fecha_vencimiento, sesion_id, stock_esperado)
  select (l->>'producto_id')::uuid,
         (l->>'cantidad')::numeric,
         nullif(l->>'fecha_vencimiento', '')::date,
         sid,
         v.stock_actual
  from jsonb_array_elements(p_lineas) l
  left join v_stock_actual v on v.producto_id = (l->>'producto_id')::uuid;
  return sid;
end $$;

-- Stock actual de una presentación (0 si no hay datos)
create or replace function gondola_stock_de(p_producto uuid) returns numeric
language sql stable as $$
  select coalesce((select stock_actual from v_stock_actual where producto_id = p_producto), 0)
$$;

-- Devoluciones: transiciones de estado válidas y momento en que se descuenta el stock
create or replace function gondola_devolucion_reglas() returns trigger
language plpgsql as $$
declare
  falta record;
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'preparada' then
      raise exception 'Las devoluciones se crean preparadas y se entregan después de revisar el remito.';
    end if;
    if new.respuesta_proveedor <> 'pendiente' then
      raise exception 'La respuesta del proveedor se registra después de entregar la mercadería.';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.estado in ('resuelta','cancelada') then
    raise exception 'Esta devolución ya está cerrada y no se puede modificar.';
  end if;
  if old.estado = 'entregada' and new.estado not in ('entregada','resuelta') then
    raise exception 'La mercadería ya se entregó: la devolución no puede volver atrás ni cancelarse.';
  end if;
  if old.estado = 'entregada' and (new.proveedor_id <> old.proveedor_id or new.tipo <> old.tipo) then
    raise exception 'La mercadería ya se entregó: no se puede cambiar el proveedor ni el tipo.';
  end if;

  if new.estado = 'entregada' and old.estado = 'preparada' then
    if not exists (select 1 from devolucion_lineas where devolucion_id = new.id) then
      raise exception 'La devolución no tiene mercadería cargada.';
    end if;
    select l.producto_id, p.nombre, sum(l.cantidad) as cantidad, gondola_stock_de(l.producto_id) as stock
      into falta
    from devolucion_lineas l join productos p on p.id = l.producto_id
    where l.devolucion_id = new.id
    group by l.producto_id, p.nombre
    having sum(l.cantidad) > gondola_stock_de(l.producto_id)
    limit 1;
    if found then
      raise exception 'No hay stock suficiente de % para devolver % (stock actual: %).', falta.nombre, falta.cantidad, falta.stock;
    end if;
    new.entregada_en := now();
    new.respuesta_proveedor := 'pendiente';
  end if;

  if new.estado = 'resuelta' then
    if old.estado <> 'entregada' then
      raise exception 'Primero registrá la entrega de la mercadería al proveedor.';
    end if;
    if new.respuesta_proveedor = 'pendiente' then
      raise exception 'Indicá si el proveedor aceptó o rechazó la devolución.';
    end if;
    new.resuelta_en := now();
  elsif new.respuesta_proveedor <> 'pendiente' then
    raise exception 'La respuesta del proveedor se registra al resolver la devolución.';
  end if;
  return new;
end $$;

create or replace function gondola_devolucion_movimientos() returns trigger
language plpgsql as $$
begin
  if new.estado = 'entregada' and old.estado = 'preparada' then
    insert into movimientos_stock (producto_id, tipo, cantidad, fecha_vencimiento, motivo, devolucion_linea_id, fecha_hora)
    select l.producto_id, 'devolucion', l.cantidad, l.fecha_vencimiento, new.motivo, l.id, new.entregada_en
    from devolucion_lineas l
    where l.devolucion_id = new.id
    on conflict (devolucion_linea_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists devoluciones_reglas on devoluciones;
create trigger devoluciones_reglas
  before insert or update on devoluciones
  for each row execute function gondola_devolucion_reglas();

drop trigger if exists devoluciones_movimientos on devoluciones;
create trigger devoluciones_movimientos
  after update on devoluciones
  for each row execute function gondola_devolucion_movimientos();

-- Las líneas solo se cambian mientras la devolución está preparada
create or replace function gondola_devolucion_linea_reglas() returns trigger
language plpgsql as $$
declare
  did uuid := coalesce(new.devolucion_id, old.devolucion_id);
begin
  if exists (select 1 from devoluciones where id = did and estado <> 'preparada') then
    raise exception 'Esta devolución ya se entregó o se cerró: no se puede modificar la mercadería.';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists devolucion_lineas_reglas on devolucion_lineas;
create trigger devolucion_lineas_reglas
  before insert or update or delete on devolucion_lineas
  for each row execute function gondola_devolucion_linea_reglas();

-- Bajas por descarte: no pueden dejar el stock negativo.
-- Las salidas por devolución solo las genera la base al entregar la devolución.
create or replace function gondola_movimiento_reglas() returns trigger
language plpgsql as $$
declare
  stock numeric;
begin
  if new.tipo = 'devolucion' then
    if not exists (
      select 1 from devolucion_lineas l join devoluciones d on d.id = l.devolucion_id
      where l.id = new.devolucion_linea_id and l.producto_id = new.producto_id and d.estado = 'entregada'
    ) then
      raise exception 'Las salidas por devolución se registran al marcar la devolución como entregada.';
    end if;
    return new;
  end if;
  stock := gondola_stock_de(new.producto_id);
  if new.cantidad > stock then
    raise exception 'No hay stock suficiente para dar de baja % (stock actual: %).', new.cantidad, stock;
  end if;
  if new.motivo is null or btrim(new.motivo) = '' then
    raise exception 'Indicá el motivo de la baja.';
  end if;
  new.fecha_hora := now();
  return new;
end $$;

drop trigger if exists movimientos_reglas on movimientos_stock;
create trigger movimientos_reglas
  before insert on movimientos_stock
  for each row execute function gondola_movimiento_reglas();

-- ---------------------------------------------------------------------
-- 6. Restablecer demo: también limpia las tablas nuevas
--    (los datos de ejemplo son los mismos de 03; cada producto queda como
--     presentación «Única» de su ficha gracias al trigger)
-- ---------------------------------------------------------------------

do $$
declare
  def text;
begin
  select pg_get_functiondef('gondola_restablecer_demo()'::regprocedure) into def;
  if position('movimientos_stock' in def) = 0 then
    def := replace(def,
      'truncate recepcion_lineas, recepciones, conteos, producto_proveedor, productos, proveedores restart identity cascade;',
      'truncate movimientos_stock, devolucion_lineas, devoluciones, cambios_ficha, recepcion_lineas, recepciones, conteos, sesiones_conteo, producto_proveedor, productos, fichas_producto, proveedores restart identity cascade;');
    if position('movimientos_stock' in def) = 0 then
      raise exception 'No se pudo actualizar gondola_restablecer_demo(): revisar a mano.';
    end if;
    execute def;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Permisos (mismo criterio que 01: sin login, permisos mínimos)
-- ---------------------------------------------------------------------

alter table fichas_producto    enable row level security;
alter table cambios_ficha      enable row level security;
alter table sesiones_conteo    enable row level security;
alter table devoluciones       enable row level security;
alter table devolucion_lineas  enable row level security;
alter table movimientos_stock  enable row level security;

revoke truncate, references, trigger on
  fichas_producto, cambios_ficha, sesiones_conteo, devoluciones, devolucion_lineas, movimientos_stock
  from anon, authenticated;
-- Trazabilidad: las salidas, los conteos y los cambios de ficha no se editan ni se borran
revoke update, delete on movimientos_stock, sesiones_conteo, cambios_ficha from anon, authenticated;
revoke insert on cambios_ficha from anon, authenticated;

do $$
declare
  p record;
begin
  for p in select * from (values
    ('fichas_producto','leer','select'), ('fichas_producto','crear','insert'), ('fichas_producto','editar','update'),
    ('cambios_ficha','leer','select'),
    ('sesiones_conteo','leer','select'), ('sesiones_conteo','crear','insert'),
    ('devoluciones','leer','select'), ('devoluciones','crear','insert'), ('devoluciones','editar','update'),
    ('devolucion_lineas','leer','select'), ('devolucion_lineas','crear','insert'),
    ('devolucion_lineas','editar','update'), ('devolucion_lineas','borrar','delete'),
    ('movimientos_stock','leer','select'), ('movimientos_stock','crear','insert')
  ) as t(tabla, nombre, accion) loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = p.tabla and policyname = p.nombre) then
      execute format(
        'create policy %I on %I for %s to anon, authenticated %s',
        p.nombre, p.tabla, p.accion,
        case p.accion when 'insert' then 'with check (true)'
                      when 'update' then 'using (true) with check (true)'
                      else 'using (true)' end);
    end if;
  end loop;
end $$;

grant select on v_stock_actual, v_lotes, v_vencimientos, v_consumo_historico to anon, authenticated;

revoke all on function gondola_mover_presentacion(uuid, uuid, text) from public;
grant execute on function gondola_mover_presentacion(uuid, uuid, text) to anon, authenticated;
grant execute on function gondola_registrar_conteo(text, jsonb, text) to anon, authenticated;

-- Para que la API vea las tablas, columnas y funciones nuevas sin esperar
notify pgrst, 'reload schema';
