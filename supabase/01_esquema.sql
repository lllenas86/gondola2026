-- =====================================================================
-- Góndola · Esquema de la base (Supabase / PostgreSQL)
-- Crea SOLO las tablas y vistas que pide la consigna:
--   Tablas: productos, proveedores, producto_proveedor, conteos,
--           recepciones, recepcion_lineas
--   Vistas: v_stock_actual, v_visitas_proximas, v_vencimientos,
--           v_consumo_historico
-- Se corre UNA vez en Supabase → SQL Editor → Run.
-- Zona horaria del comercio: America/Argentina/Buenos_Aires.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

create table productos (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  unidad        text not null default 'unidad',
  perecedero    boolean not null default false,
  punto_pedido  numeric not null default 0,
  creado_en     timestamptz not null default now(),
  constraint productos_nombre_no_vacio check (btrim(nombre) <> ''),
  constraint productos_punto_pedido_no_negativo check (punto_pedido >= 0),
  constraint productos_unidad_valida check (unidad in ('unidad','kg','litro','paquete','caja'))
);
-- Nombre único sin importar mayúsculas ni espacios de más
create unique index productos_nombre_unico on productos (lower(btrim(nombre)));

create table proveedores (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  -- 1 = lunes … 7 = domingo
  dias_visita  smallint[] not null default '{}',
  creado_en    timestamptz not null default now(),
  constraint proveedores_nombre_no_vacio check (btrim(nombre) <> ''),
  constraint proveedores_con_dias check (cardinality(dias_visita) >= 1),
  constraint proveedores_dias_validos check (dias_visita <@ array[1,2,3,4,5,6,7]::smallint[])
);
create unique index proveedores_nombre_unico on proveedores (lower(btrim(nombre)));

-- Muchos a muchos: un producto puede venir de varios proveedores
create table producto_proveedor (
  producto_id   uuid not null references productos(id) on delete cascade,
  proveedor_id  uuid not null references proveedores(id) on delete cascade,
  primary key (producto_id, proveedor_id)
);

-- Regla crítica: el stock nunca se sobrescribe. Cada conteo es un registro nuevo.
create table conteos (
  id                 uuid primary key default gen_random_uuid(),
  producto_id        uuid not null references productos(id) on delete cascade,
  cantidad           numeric not null,
  fecha_hora         timestamptz not null default now(),
  fecha_vencimiento  date,
  constraint conteos_cantidad_no_negativa check (cantidad >= 0)
);
create index conteos_producto_fecha on conteos (producto_id, fecha_hora desc);

create table recepciones (
  id             uuid primary key default gen_random_uuid(),
  proveedor_id   uuid references proveedores(id),
  fecha          date,
  origen         text not null default 'manual',
  estado         text not null default 'borrador',
  imagen_path    text,
  datos_ia       jsonb,
  creada_en      timestamptz not null default now(),
  confirmada_en  timestamptz,
  constraint recepciones_origen_valido check (origen in ('manual','remito_foto')),
  constraint recepciones_estado_valido check (estado in ('borrador','confirmada','cancelada'))
);

create table recepcion_lineas (
  id                 bigint generated always as identity primary key,
  recepcion_id       uuid not null references recepciones(id) on delete cascade,
  producto_id        uuid references productos(id),
  descripcion        text,
  cantidad           numeric not null,
  fecha_vencimiento  date,
  confianza_ia       numeric,
  estado             text not null default 'sin_vincular',
  constraint lineas_cantidad_positiva check (cantidad > 0),
  constraint lineas_confianza_valida check (confianza_ia is null or confianza_ia between 0 and 1),
  constraint lineas_estado_valido check (estado in ('vinculada','sin_vincular','ignorada')),
  constraint lineas_vinculada_con_producto check (estado <> 'vinculada' or producto_id is not null)
);
create index recepcion_lineas_recepcion on recepcion_lineas (recepcion_id);

-- ---------------------------------------------------------------------
-- 2. Reglas de las recepciones (triggers)
--    Los mensajes están en castellano para que la app los muestre tal cual.
-- ---------------------------------------------------------------------

create or replace function gondola_recepcion_reglas() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.estado = 'confirmada' then
      raise exception 'Las recepciones se crean en borrador y se confirman después de revisarlas.';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.estado = 'confirmada' then
    raise exception 'Esta recepción ya está confirmada y no se puede modificar.';
  end if;

  if new.estado = 'confirmada' then
    if new.proveedor_id is null then
      raise exception 'Elegí el proveedor antes de confirmar la recepción.';
    end if;
    if exists (select 1 from recepcion_lineas
               where recepcion_id = new.id and estado = 'sin_vincular') then
      raise exception 'No se puede confirmar: hay líneas del remito sin vincular a un producto. Vinculalas, creá el producto o ignoralas.';
    end if;
    if not exists (select 1 from recepcion_lineas
                   where recepcion_id = new.id and estado = 'vinculada') then
      raise exception 'La recepción no tiene ninguna línea para cargar.';
    end if;
    new.confirmada_en := least(coalesce(new.confirmada_en, now()), now());
  end if;
  return new;
end $$;

create trigger recepciones_reglas
  before insert or update on recepciones
  for each row execute function gondola_recepcion_reglas();

create or replace function gondola_linea_reglas() returns trigger
language plpgsql as $$
declare
  rid uuid := coalesce(new.recepcion_id, old.recepcion_id);
begin
  if exists (select 1 from recepciones where id = rid and estado = 'confirmada') then
    raise exception 'Esta recepción ya está confirmada y no se puede modificar.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  -- El estado se mantiene coherente con el producto elegido
  if new.estado <> 'ignorada' then
    new.estado := case when new.producto_id is null then 'sin_vincular' else 'vinculada' end;
  end if;
  return new;
end $$;

create trigger recepcion_lineas_reglas
  before insert or update or delete on recepcion_lineas
  for each row execute function gondola_linea_reglas();

-- ---------------------------------------------------------------------
-- 3. Vistas
-- ---------------------------------------------------------------------

-- Stock actual = último conteo + recepciones confirmadas después de ese conteo.
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

-- Próxima visita de cada proveedor (hoy cuenta si pasa hoy). dias_hasta: 0 = hoy, 1 = mañana…
create view v_visitas_proximas with (security_invoker = true) as
select
  pr.id as proveedor_id, pr.nombre, pr.dias_visita,
  min(d.fecha) as proxima_visita,
  min(d.fecha) - (now() at time zone 'America/Argentina/Buenos_Aires')::date as dias_hasta
from proveedores pr
cross join lateral (
  select (now() at time zone 'America/Argentina/Buenos_Aires')::date + i as fecha
  from generate_series(0, 6) as i
) d
where extract(isodow from d.fecha)::smallint = any (pr.dias_visita)
group by pr.id, pr.nombre, pr.dias_visita;

-- Lotes que vencen en los próximos 7 días (del último conteo y de lo recibido después).
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

-- Consumo entre conteos consecutivos (base para la futura sugerencia de pedido, HU7).
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

-- ---------------------------------------------------------------------
-- 4. Permisos
--    La app no tiene login (fuera de alcance): usa la clave pública.
--    RLS activado con permisos mínimos: no se pueden borrar ni editar
--    conteos, ni borrar productos, proveedores o recepciones.
-- ---------------------------------------------------------------------

alter table productos          enable row level security;
alter table proveedores        enable row level security;
alter table producto_proveedor enable row level security;
alter table conteos            enable row level security;
alter table recepciones        enable row level security;
alter table recepcion_lineas   enable row level security;

revoke truncate, references, trigger on
  productos, proveedores, producto_proveedor, conteos, recepciones, recepcion_lineas
  from anon, authenticated;

create policy "leer"       on productos for select to anon, authenticated using (true);
create policy "crear"      on productos for insert to anon, authenticated with check (true);
create policy "editar"     on productos for update to anon, authenticated using (true) with check (true);

create policy "leer"       on proveedores for select to anon, authenticated using (true);
create policy "crear"      on proveedores for insert to anon, authenticated with check (true);
create policy "editar"     on proveedores for update to anon, authenticated using (true) with check (true);

create policy "leer"       on producto_proveedor for select to anon, authenticated using (true);
create policy "crear"      on producto_proveedor for insert to anon, authenticated with check (true);
create policy "borrar"     on producto_proveedor for delete to anon, authenticated using (true);

create policy "leer"       on conteos for select to anon, authenticated using (true);
create policy "crear"      on conteos for insert to anon, authenticated with check (true);

create policy "leer"       on recepciones for select to anon, authenticated using (true);
create policy "crear"      on recepciones for insert to anon, authenticated with check (true);
create policy "editar"     on recepciones for update to anon, authenticated using (true) with check (true);

create policy "leer"       on recepcion_lineas for select to anon, authenticated using (true);
create policy "crear"      on recepcion_lineas for insert to anon, authenticated with check (true);
create policy "editar"     on recepcion_lineas for update to anon, authenticated using (true) with check (true);
create policy "borrar"     on recepcion_lineas for delete to anon, authenticated using (true);

grant select on v_stock_actual, v_visitas_proximas, v_vencimientos, v_consumo_historico
  to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Bucket para las fotos de los remitos (privado)
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('remitos', 'remitos', false)
on conflict (id) do nothing;

create policy "remitos subir" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'remitos');
create policy "remitos ver" on storage.objects for select to anon, authenticated
  using (bucket_id = 'remitos');
