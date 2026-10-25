-- =====================================================================
-- Góndola · 04 · Presentaciones, inventario por lotes, devoluciones y bajas
--
-- Se corre UNA vez en Supabase → SQL Editor → Run, después de 01, 02 y 03.
-- Se puede volver a correr: no duplica datos ni borra nada.
--
-- Qué hace:
--   1. Un producto puede tener varias PRESENTACIONES (473 ml, 1 L…).
--      El stock, el punto de pedido, el costo y los proveedores pasan a ser
--      de cada presentación.
--   2. Conserva los datos: a cada producto existente le crea UNA presentación
--      "Única" (correspondencia 1:1) y le asigna su historial de conteos,
--      recepciones y proveedores. NO fusiona productos: eso lo decide la
--      persona desde la ficha ("Mover a otro producto").
--   3. Conteos: inventario inicial / periódico (sin proveedor), lotes por
--      vencimiento y el stock que figuraba al contar (para ver diferencias).
--   4. Devoluciones al proveedor (preparada → confirmada → resuelta) con
--      número de remito, y bajas por descarte, como operaciones separadas.
--   5. Vistas nuevas por presentación. Las vistas viejas (v_stock_actual…)
--      quedan como estaban, así la versión anterior de la app sigue andando
--      mientras se publica la nueva.
--
-- ANTES DE CORRERLO: hacé una copia de la base (Supabase → Database → Backups, o
-- Table Editor → exportar CSV de productos, conteos, recepciones y recepcion_lineas).
--
-- Después de correrlo, para cargar la demo nueva (con presentaciones y lotes)
-- usá el botón "Restablecer demo" o:  select gondola_restablecer_demo();
-- (02_datos_ejemplo.sql es de la versión anterior: no lo corras después de este.)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Presentaciones
-- ---------------------------------------------------------------------

alter table productos add column if not exists activo boolean not null default true;

create table if not exists presentaciones (
  id                  uuid primary key default gen_random_uuid(),
  producto_id         uuid not null references productos(id) on delete restrict,
  -- Cómo se la llama en el almacén: "473 ml", "1 L", "Pack x 6", "Única"
  nombre              text not null,
  -- Tamaño (opcional). Sirve para reconocerla en los remitos. Nunca se usa para convertir stock.
  contenido           numeric,
  unidad_contenido    text,
  -- En qué se cuenta el stock de esta presentación
  unidad_stock        text not null default 'unidad',
  -- Equivalencia configurada a mano: 1 bulto = N unidades de stock. Sin dato, no se convierte.
  unidades_por_bulto  numeric,
  punto_pedido        numeric not null default 0,
  -- Costo de referencia por unidad de stock (para valorizar mermas). Opcional.
  costo_unitario      numeric,
  activa              boolean not null default true,
  -- true = creada por esta migración a partir de un producto existente
  migrada             boolean not null default false,
  creado_en           timestamptz not null default now(),
  constraint presentaciones_nombre_no_vacio check (btrim(nombre) <> ''),
  constraint presentaciones_contenido_positivo check (contenido is null or contenido > 0),
  constraint presentaciones_unidad_contenido_valida check (unidad_contenido is null or unidad_contenido in ('ml','l','g','kg','u')),
  constraint presentaciones_contenido_completo check ((contenido is null) = (unidad_contenido is null)),
  constraint presentaciones_unidad_stock_valida check (unidad_stock in ('unidad','kg','litro','paquete','caja')),
  constraint presentaciones_bulto_positivo check (unidades_por_bulto is null or unidades_por_bulto > 0),
  constraint presentaciones_punto_pedido_no_negativo check (punto_pedido >= 0),
  constraint presentaciones_costo_no_negativo check (costo_unitario is null or costo_unitario >= 0)
);
create unique index if not exists presentaciones_nombre_unico on presentaciones (producto_id, lower(btrim(nombre)));
create index if not exists presentaciones_producto on presentaciones (producto_id);

-- Qué proveedor trae cada presentación (se usa para comprar, NO para contar)
create table if not exists presentacion_proveedor (
  presentacion_id  uuid not null references presentaciones(id) on delete cascade,
  proveedor_id     uuid not null references proveedores(id) on delete cascade,
  primary key (presentacion_id, proveedor_id)
);

-- Textos de remito que la persona ya vinculó a una presentación (la app los aprende al confirmar)
create table if not exists presentacion_alias (
  texto            text primary key,
  presentacion_id  uuid not null references presentaciones(id) on delete cascade,
  creado_en        timestamptz not null default now(),
  constraint presentacion_alias_no_vacio check (btrim(texto) <> '')
);

-- ---------------------------------------------------------------------
-- 2. Columnas nuevas en conteos y recepciones (nullable: compatibles con la app anterior)
-- ---------------------------------------------------------------------

alter table conteos add column if not exists presentacion_id uuid references presentaciones(id);
-- Agrupa los conteos hechos juntos (una "sesión" de conteo)
alter table conteos add column if not exists sesion_id uuid;
-- 'inicial' = primera vez que se cuenta esa presentación; 'periodico' = recuento. null = anterior a esta migración
alter table conteos add column if not exists tipo text;
-- Lo que decía el sistema justo antes de contar (lo calcula la base). La diferencia es el ajuste.
alter table conteos add column if not exists stock_registrado numeric;
-- Desglose por vencimiento: [{"fecha_vencimiento":"2026-11-02","cantidad":12}, …]. Lo que no figura, no tiene fecha.
alter table conteos add column if not exists lotes jsonb;
do $$ begin
  alter table conteos add constraint conteos_tipo_valido check (tipo is null or tipo in ('inicial','periodico'));
exception when duplicate_object then null; end $$;
create index if not exists conteos_presentacion_fecha on conteos (presentacion_id, fecha_hora desc);

alter table recepcion_lineas add column if not exists presentacion_id uuid references presentaciones(id);
create index if not exists recepcion_lineas_presentacion on recepcion_lineas (presentacion_id);

-- ---------------------------------------------------------------------
-- 3. Devoluciones al proveedor y bajas
-- ---------------------------------------------------------------------

create table if not exists devoluciones (
  id               uuid primary key default gen_random_uuid(),
  -- Número correlativo del remito de devolución (DEV-0001)
  numero           bigint generated always as identity unique,
  proveedor_id     uuid not null references proveedores(id),
  fecha            date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  motivo           text not null default 'proximo_vencer',
  nota             text,
  -- preparada: borrador, no toca el stock · confirmada: la mercadería salió del almacén (descuenta stock)
  -- resuelta: se registró qué respondió el proveedor · cancelada: no se hizo (nunca tocó el stock)
  estado           text not null default 'preparada',
  resolucion       text,
  resolucion_nota  text,
  creada_en        timestamptz not null default now(),
  confirmada_en    timestamptz,
  resuelta_en      timestamptz,
  cancelada_en     timestamptz,
  constraint devoluciones_motivo_valido check (motivo in ('proximo_vencer','vencido','danado','otro')),
  constraint devoluciones_estado_valido check (estado in ('preparada','confirmada','resuelta','cancelada')),
  constraint devoluciones_resolucion_valida check (resolucion is null or resolucion in ('reemplazo','nota_credito','sin_compensacion','otra'))
);

create table if not exists devolucion_lineas (
  id               bigint generated always as identity primary key,
  devolucion_id    uuid not null references devoluciones(id) on delete cascade,
  presentacion_id  uuid not null references presentaciones(id),
  producto_id      uuid references productos(id),
  cantidad         numeric not null,
  fecha_vencimiento date,
  -- Recepción en la que entró esa mercadería, si se conoce
  recepcion_id     uuid references recepciones(id),
  -- Costo de referencia al momento de preparar la devolución (para valorizar)
  costo_unitario   numeric,
  constraint devolucion_lineas_cantidad_positiva check (cantidad > 0)
);
create index if not exists devolucion_lineas_devolucion on devolucion_lineas (devolucion_id);

create table if not exists bajas (
  id                uuid primary key default gen_random_uuid(),
  presentacion_id   uuid not null references presentaciones(id),
  producto_id       uuid references productos(id),
  cantidad          numeric not null,
  fecha_vencimiento date,
  motivo            text not null default 'vencido',
  nota              text,
  costo_unitario    numeric,
  registrada_en     timestamptz not null default now(),
  constraint bajas_cantidad_positiva check (cantidad > 0),
  constraint bajas_motivo_valido check (motivo in ('vencido','danado','otro'))
);

-- ---------------------------------------------------------------------
-- 4. Pasaje de los datos existentes (1 producto → 1 presentación "Única")
-- ---------------------------------------------------------------------

insert into presentaciones (producto_id, nombre, unidad_stock, punto_pedido, migrada)
select p.id, 'Única', p.unidad, p.punto_pedido, true
from productos p
where not exists (select 1 from presentaciones x where x.producto_id = p.id);

update conteos c set presentacion_id = x.id
from presentaciones x
where c.presentacion_id is null and x.producto_id = c.producto_id and x.migrada;

-- Las líneas de recepciones confirmadas están protegidas por un trigger:
-- se lo desactiva SOLO para completar la presentación (no cambia cantidades ni estados).
alter table recepcion_lineas disable trigger recepcion_lineas_reglas;
update recepcion_lineas l set presentacion_id = x.id
from presentaciones x
where l.presentacion_id is null and l.producto_id is not null and x.producto_id = l.producto_id and x.migrada;
alter table recepcion_lineas enable trigger recepcion_lineas_reglas;

insert into presentacion_proveedor (presentacion_id, proveedor_id)
select x.id, pp.proveedor_id
from producto_proveedor pp
join presentaciones x on x.producto_id = pp.producto_id and x.migrada
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 5. Reglas (triggers)
-- ---------------------------------------------------------------------

-- Presentación única y activa de un producto (o null si tiene 0 o varias). Solo
-- se usa cuando la correspondencia es comprobable.
create or replace function gondola_presentacion_unica(p_producto uuid) returns uuid
language sql stable as $$
  select case when count(*) = 1 then (array_agg(id))[1] end
  from presentaciones where producto_id = p_producto and activa;
$$;

-- Conteos: completa la presentación, el tipo y el stock registrado; valida los lotes.
create or replace function gondola_conteo_reglas() returns trigger
language plpgsql as $$
declare
  suma numeric := 0;
  lote jsonb;
  primera date;
begin
  if new.presentacion_id is null and new.producto_id is not null then
    new.presentacion_id := gondola_presentacion_unica(new.producto_id);
    if new.presentacion_id is null then
      if exists (select 1 from presentaciones where producto_id = new.producto_id and activa) then
        raise exception 'Este producto tiene varias presentaciones: indicá cuál contaste (actualizá la app).';
      end if;
      raise exception 'Este producto no tiene presentaciones: cargá una en el Catálogo.';
    end if;
  end if;
  if new.presentacion_id is null then
    raise exception 'Indicá la presentación contada.';
  end if;
  select producto_id into new.producto_id from presentaciones where id = new.presentacion_id;

  if new.lotes is not null then
    if jsonb_typeof(new.lotes) <> 'array' then
      raise exception 'Los lotes del conteo no tienen el formato esperado.';
    end if;
    for lote in select * from jsonb_array_elements(new.lotes) loop
      if (lote->>'cantidad') is null or (lote->>'cantidad')::numeric < 0 then
        raise exception 'Cada lote tiene que tener una cantidad mayor o igual a 0.';
      end if;
      if (lote->>'fecha_vencimiento') is null then
        raise exception 'Cada lote tiene que tener fecha de vencimiento.';
      end if;
      perform (lote->>'fecha_vencimiento')::date;
      suma := suma + (lote->>'cantidad')::numeric;
    end loop;
    if suma > new.cantidad then
      raise exception 'La suma de los lotes (%) supera la cantidad contada (%).', suma, new.cantidad;
    end if;
    select min((e->>'fecha_vencimiento')::date) into primera
    from jsonb_array_elements(new.lotes) e where (e->>'cantidad')::numeric > 0;
    -- Compatibilidad: la columna vieja guarda el vencimiento más próximo
    new.fecha_vencimiento := coalesce(primera, new.fecha_vencimiento);
  end if;

  -- Solo para conteos que se cargan ahora (no para historiales con fecha vieja)
  if new.fecha_hora > now() - interval '10 minutes' then
    new.tipo := case when exists (select 1 from conteos where presentacion_id = new.presentacion_id)
                     then 'periodico' else 'inicial' end;
    new.stock_registrado := gondola_stock_registrado(new.presentacion_id);
  end if;
  return new;
end $$;

-- Líneas de recepción: igual que antes, más la presentación.
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
  if new.presentacion_id is not null then
    select producto_id into new.producto_id from presentaciones where id = new.presentacion_id;
  elsif new.producto_id is not null then
    -- App anterior: solo si el producto tiene una única presentación
    new.presentacion_id := gondola_presentacion_unica(new.producto_id);
  end if;
  if new.estado <> 'ignorada' then
    new.estado := case when new.presentacion_id is null then 'sin_vincular' else 'vinculada' end;
  end if;
  return new;
end $$;

drop trigger if exists conteos_reglas on conteos;
create trigger conteos_reglas
  before insert on conteos
  for each row execute function gondola_conteo_reglas();

-- Mantiene producto_proveedor (lo usan las vistas viejas) a partir de presentacion_proveedor
create or replace function gondola_sync_producto_proveedor() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  prod uuid;
begin
  if tg_op = 'INSERT' then
    select producto_id into prod from presentaciones where id = new.presentacion_id;
    insert into producto_proveedor (producto_id, proveedor_id) values (prod, new.proveedor_id) on conflict do nothing;
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

drop trigger if exists presentacion_proveedor_sync on presentacion_proveedor;
create trigger presentacion_proveedor_sync
  after insert or delete on presentacion_proveedor
  for each row execute function gondola_sync_producto_proveedor();

-- Devoluciones: el stock se descuenta UNA sola vez, al pasar de preparada a confirmada.
create or replace function gondola_devolucion_reglas() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'preparada' then
      raise exception 'Las devoluciones se crean como preparadas y se confirman después de revisar el remito.';
    end if;
    new.confirmada_en := null; new.resuelta_en := null; new.cancelada_en := null; new.resolucion := null;
    return new;
  end if;

  if old.estado in ('resuelta','cancelada') then
    raise exception 'Esta devolución ya está cerrada y no se puede modificar.';
  end if;

  if old.estado = 'confirmada' then
    if new.estado = 'confirmada' then
      raise exception 'La devolución ya está confirmada: solo se puede registrar cómo se resolvió.';
    end if;
    if new.estado <> 'resuelta' then
      raise exception 'Una devolución confirmada solo puede pasar a resuelta.';
    end if;
    if new.resolucion is null then
      raise exception 'Indicá cómo se resolvió la devolución.';
    end if;
    -- Lo que salió del almacén no cambia
    new.proveedor_id := old.proveedor_id; new.fecha := old.fecha; new.motivo := old.motivo;
    new.confirmada_en := old.confirmada_en; new.cancelada_en := null;
    new.resuelta_en := now();
    return new;
  end if;

  -- old.estado = 'preparada'
  if new.estado = 'confirmada' then
    if not exists (select 1 from devolucion_lineas where devolucion_id = new.id) then
      raise exception 'La devolución no tiene productos.';
    end if;
    new.confirmada_en := now();
    new.resolucion := null; new.resuelta_en := null;
  elsif new.estado = 'cancelada' then
    new.cancelada_en := now();
  elsif new.estado = 'resuelta' then
    raise exception 'Primero confirmá la devolución (cuando la mercadería sale del almacén).';
  end if;
  return new;
end $$;

drop trigger if exists devoluciones_reglas on devoluciones;
create trigger devoluciones_reglas
  before insert or update on devoluciones
  for each row execute function gondola_devolucion_reglas();

create or replace function gondola_devolucion_linea_reglas() returns trigger
language plpgsql as $$
declare
  did uuid := coalesce(new.devolucion_id, old.devolucion_id);
begin
  if exists (select 1 from devoluciones where id = did and estado <> 'preparada') then
    raise exception 'Solo se pueden cambiar los productos de una devolución preparada.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  select producto_id into new.producto_id from presentaciones where id = new.presentacion_id;
  return new;
end $$;

drop trigger if exists devolucion_lineas_reglas on devolucion_lineas;
create trigger devolucion_lineas_reglas
  before insert or update or delete on devolucion_lineas
  for each row execute function gondola_devolucion_linea_reglas();

create or replace function gondola_baja_reglas() returns trigger
language plpgsql as $$
begin
  select producto_id into new.producto_id from presentaciones where id = new.presentacion_id;
  -- Desde la app la fecha la pone la base (no se puede fechar hacia atrás para esquivar un conteo)
  if current_user in ('anon', 'authenticated') then
    new.registrada_en := now();
  end if;
  return new;
end $$;

drop trigger if exists bajas_reglas on bajas;
create trigger bajas_reglas
  before insert on bajas
  for each row execute function gondola_baja_reglas();

-- ---------------------------------------------------------------------
-- 6. Vistas por presentación
-- ---------------------------------------------------------------------

-- Stock registrado = último conteo
--                  + recepciones confirmadas después
--                  − devoluciones confirmadas después − bajas después.
-- (Sin sistema de ventas, lo vendido entre conteos aparece recién en el conteo siguiente.)
create or replace view v_stock_presentacion with (security_invoker = true) as
with ultimo as (
  select distinct on (presentacion_id) presentacion_id, cantidad, fecha_hora
  from conteos where presentacion_id is not null
  order by presentacion_id, fecha_hora desc, id desc
),
entradas as (
  select l.presentacion_id, sum(l.cantidad) as cantidad
  from recepcion_lineas l
  join recepciones r on r.id = l.recepcion_id and r.estado = 'confirmada'
  left join ultimo u on u.presentacion_id = l.presentacion_id
  where l.estado = 'vinculada' and l.presentacion_id is not null
    and (u.fecha_hora is null or r.confirmada_en > u.fecha_hora)
  group by l.presentacion_id
),
salidas as (
  select s.presentacion_id, sum(s.cantidad) as cantidad
  from (
    select dl.presentacion_id, dl.cantidad, d.confirmada_en as momento
    from devolucion_lineas dl join devoluciones d on d.id = dl.devolucion_id
    where d.estado in ('confirmada','resuelta')
    union all
    select presentacion_id, cantidad, registrada_en from bajas
  ) s
  left join ultimo u on u.presentacion_id = s.presentacion_id
  where u.fecha_hora is null or s.momento > u.fecha_hora
  group by s.presentacion_id
)
select
  x.id as presentacion_id, x.producto_id, p.nombre as producto, x.nombre as presentacion,
  x.punto_pedido, x.costo_unitario,
  u.cantidad as cantidad_ultimo_conteo, u.fecha_hora as fecha_ultimo_conteo,
  coalesce(e.cantidad, 0) as entradas_despues, coalesce(s.cantidad, 0) as salidas_despues,
  case when u.presentacion_id is null and e.presentacion_id is null and s.presentacion_id is null then null
       else coalesce(u.cantidad, 0) + coalesce(e.cantidad, 0) - coalesce(s.cantidad, 0) end as stock_actual
from presentaciones x
join productos p on p.id = x.producto_id
left join ultimo u on u.presentacion_id = x.id
left join entradas e on e.presentacion_id = x.id
left join salidas s on s.presentacion_id = x.id;

-- Consumo estimado entre conteos consecutivos de una presentación:
-- stock inicial + recibido − devuelto/dado de baja − stock final. No son ventas registradas.
create or replace view v_consumo_presentacion with (security_invoker = true) as
with c as (
  select presentacion_id, cantidad, fecha_hora,
         lag(cantidad)   over w as cantidad_anterior,
         lag(fecha_hora) over w as fecha_anterior
  from conteos where presentacion_id is not null
  window w as (partition by presentacion_id order by fecha_hora, id)
)
select
  c.presentacion_id, c.fecha_anterior as desde, c.fecha_hora as hasta,
  c.cantidad_anterior as stock_inicial, coalesce(ent.cantidad, 0) as recibido,
  coalesce(sal.cantidad, 0) as salidas, c.cantidad as stock_final,
  c.cantidad_anterior + coalesce(ent.cantidad, 0) - coalesce(sal.cantidad, 0) - c.cantidad as consumo,
  round(extract(epoch from (c.fecha_hora - c.fecha_anterior)) / 86400, 2) as dias
from c
left join lateral (
  select sum(l.cantidad) as cantidad
  from recepcion_lineas l join recepciones r on r.id = l.recepcion_id and r.estado = 'confirmada'
  where l.presentacion_id = c.presentacion_id and l.estado = 'vinculada'
    and r.confirmada_en > c.fecha_anterior and r.confirmada_en <= c.fecha_hora
) ent on true
left join lateral (
  select sum(s.cantidad) as cantidad from (
    select dl.cantidad, d.confirmada_en as momento
    from devolucion_lineas dl join devoluciones d on d.id = dl.devolucion_id
    where dl.presentacion_id = c.presentacion_id and d.estado in ('confirmada','resuelta')
    union all
    select b.cantidad, b.registrada_en from bajas b where b.presentacion_id = c.presentacion_id
  ) s where s.momento > c.fecha_anterior and s.momento <= c.fecha_hora
) sal on true
where c.fecha_anterior is not null;

-- Stock registrado de una presentación (misma regla que v_stock_presentacion)
create or replace function gondola_stock_registrado(p_presentacion uuid) returns numeric
language sql stable as $$
  select stock_actual from v_stock_presentacion where presentacion_id = p_presentacion;
$$;

-- Agrupar manualmente: mueve una presentación (con TODO su historial, que está
-- ligado a la presentación) a otra ficha de producto. No cambia ninguna cantidad.
-- Valida que no quede una presentación repetida y que coincida si es perecedero.
-- Si la ficha de origen queda sin presentaciones activas, se archiva (no se borra).
create or replace function gondola_mover_presentacion(p_presentacion uuid, p_producto_destino uuid, p_nombre text)
returns jsonb
language plpgsql
as $$
declare
  pres presentaciones%rowtype;
  origen productos%rowtype;
  destino productos%rowtype;
  nombre_final text := btrim(coalesce(p_nombre, ''));
  stock_antes numeric;
  stock_despues numeric;
  archivado boolean := false;
  permitido boolean := true;
begin
  -- Con usuarios (supabase/05): solo encargado o dueño
  if to_regprocedure('gondola_es(text[])') is not null then
    execute 'select gondola_es(array[''encargado'',''dueno''])' into permitido;
    if not permitido then raise exception 'Tu usuario no puede reorganizar el catálogo.'; end if;
  end if;
  select * into pres from presentaciones where id = p_presentacion for update;
  if not found then raise exception 'La presentación no existe.'; end if;
  select * into origen from productos where id = pres.producto_id;
  select * into destino from productos where id = p_producto_destino;
  if not found then raise exception 'El producto de destino no existe.'; end if;
  if destino.id = origen.id then raise exception 'La presentación ya pertenece a ese producto.'; end if;
  if nombre_final = '' then raise exception 'Indicá el nombre de la presentación en el producto de destino (por ejemplo, 2,25 L).'; end if;
  if origen.perecedero <> destino.perecedero then
    raise exception 'No se puede mover: "%" % es perecedero y "%" %.', origen.nombre,
      case when origen.perecedero then 'sí' else 'no' end, destino.nombre,
      case when destino.perecedero then 'sí' else 'no' end;
  end if;
  if exists (select 1 from presentaciones where producto_id = destino.id and lower(btrim(nombre)) = lower(nombre_final)) then
    raise exception 'El producto "%" ya tiene una presentación "%". Elegí otro nombre o revisá si es la misma.', destino.nombre, nombre_final;
  end if;
  if pres.contenido is not null and exists (
    select 1 from presentaciones where producto_id = destino.id and activa
      and contenido = pres.contenido and unidad_contenido = pres.unidad_contenido and unidad_stock = pres.unidad_stock
  ) then
    raise exception 'El producto "%" ya tiene una presentación del mismo tamaño y unidad. Si es la misma, no la muevas: cargá un conteo para unificar.', destino.nombre;
  end if;

  stock_antes := gondola_stock_registrado(pres.id);
  update presentaciones set producto_id = destino.id, nombre = nombre_final where id = pres.id;
  if not found then raise exception 'No se pudo mover la presentación.'; end if;

  -- Relación producto-proveedor (vistas viejas): se agrega al destino y se limpia el origen
  insert into producto_proveedor (producto_id, proveedor_id)
    select destino.id, proveedor_id from presentacion_proveedor where presentacion_id = pres.id
  on conflict do nothing;
  delete from producto_proveedor pp
  where pp.producto_id = origen.id and not exists (
    select 1 from presentacion_proveedor x join presentaciones y on y.id = x.presentacion_id
    where y.producto_id = origen.id and x.proveedor_id = pp.proveedor_id);

  if not exists (select 1 from presentaciones where producto_id = origen.id and activa) then
    update productos set activo = false where id = origen.id;
    archivado := true;
  end if;

  stock_despues := gondola_stock_registrado(pres.id);
  if stock_antes is distinct from stock_despues then
    raise exception 'El stock cambiaría al mover (% → %). Se canceló la operación.', stock_antes, stock_despues;
  end if;
  return jsonb_build_object('presentacion_id', pres.id, 'producto_origen', origen.nombre, 'producto_destino', destino.nombre,
                            'nombre', nombre_final, 'stock', stock_despues, 'origen_archivado', archivado);
end $$;

revoke all on function gondola_mover_presentacion(uuid, uuid, text) from public;
do $$ begin
  if to_regclass('public.miembros') is null then
    grant execute on function gondola_mover_presentacion(uuid, uuid, text) to anon, authenticated;
  else
    grant execute on function gondola_mover_presentacion(uuid, uuid, text) to authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Permisos (sin login: clave pública, permisos mínimos)
-- ---------------------------------------------------------------------

alter table presentaciones         enable row level security;
alter table presentacion_proveedor enable row level security;
alter table presentacion_alias     enable row level security;
alter table devoluciones           enable row level security;
alter table devolucion_lineas      enable row level security;
alter table bajas                  enable row level security;

-- Permisos para la clave pública. Si ya se corrió supabase/05 (usuarios y roles),
-- NO se tocan: volver a correr este archivo nunca reabre el acceso sin login.
do $$
begin
  if to_regclass('public.miembros') is null then
    execute 'grant select, insert, update on presentaciones, devoluciones to anon, authenticated';
    execute 'grant select, insert, delete on presentacion_proveedor, presentacion_alias to anon, authenticated';
    execute 'grant select, insert, update, delete on devolucion_lineas to anon, authenticated';
    execute 'grant select, insert on bajas to anon, authenticated';
    execute 'grant select on v_stock_presentacion, v_consumo_presentacion to anon, authenticated';
    execute 'drop policy if exists "leer" on presentaciones';
    execute 'create policy "leer"   on presentaciones for select to anon, authenticated using (true)';
    execute 'drop policy if exists "crear" on presentaciones';
    execute 'create policy "crear"  on presentaciones for insert to anon, authenticated with check (true)';
    execute 'drop policy if exists "editar" on presentaciones';
    execute 'create policy "editar" on presentaciones for update to anon, authenticated using (true) with check (true)';
    execute 'drop policy if exists "leer" on presentacion_proveedor';
    execute 'create policy "leer"   on presentacion_proveedor for select to anon, authenticated using (true)';
    execute 'drop policy if exists "crear" on presentacion_proveedor';
    execute 'create policy "crear"  on presentacion_proveedor for insert to anon, authenticated with check (true)';
    execute 'drop policy if exists "borrar" on presentacion_proveedor';
    execute 'create policy "borrar" on presentacion_proveedor for delete to anon, authenticated using (true)';
    execute 'drop policy if exists "leer" on presentacion_alias';
    execute 'create policy "leer"   on presentacion_alias for select to anon, authenticated using (true)';
    execute 'drop policy if exists "crear" on presentacion_alias';
    execute 'create policy "crear"  on presentacion_alias for insert to anon, authenticated with check (true)';
    execute 'drop policy if exists "borrar" on presentacion_alias';
    execute 'create policy "borrar" on presentacion_alias for delete to anon, authenticated using (true)';
    execute 'drop policy if exists "leer" on devoluciones';
    execute 'create policy "leer"   on devoluciones for select to anon, authenticated using (true)';
    execute 'drop policy if exists "crear" on devoluciones';
    execute 'create policy "crear"  on devoluciones for insert to anon, authenticated with check (true)';
    execute 'drop policy if exists "editar" on devoluciones';
    execute 'create policy "editar" on devoluciones for update to anon, authenticated using (true) with check (true)';
    execute 'drop policy if exists "leer" on devolucion_lineas';
    execute 'create policy "leer"   on devolucion_lineas for select to anon, authenticated using (true)';
    execute 'drop policy if exists "crear" on devolucion_lineas';
    execute 'create policy "crear"  on devolucion_lineas for insert to anon, authenticated with check (true)';
    execute 'drop policy if exists "editar" on devolucion_lineas';
    execute 'create policy "editar" on devolucion_lineas for update to anon, authenticated using (true) with check (true)';
    execute 'drop policy if exists "borrar" on devolucion_lineas';
    execute 'create policy "borrar" on devolucion_lineas for delete to anon, authenticated using (true)';
    -- Bajas: solo se crean (no se editan ni se borran). Un error se corrige con el conteo siguiente.
    execute 'drop policy if exists "leer" on bajas';
    execute 'create policy "leer"   on bajas for select to anon, authenticated using (true)';
    execute 'drop policy if exists "crear" on bajas';
    execute 'create policy "crear"  on bajas for insert to anon, authenticated with check (true)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Demo nueva (reemplaza la función de 03): productos con varias
--    presentaciones, lotes con vencimientos distintos, costos de referencia.
-- ---------------------------------------------------------------------

create or replace function gondola_restablecer_demo() returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  tz constant text := 'America/Argentina/Buenos_Aires';
  hoy date := (now() at time zone tz)::date;
  p_coca uuid; p_sprite uuid; p_agua uuid; p_leche uuid; p_yogur uuid; p_yerba uuid;
  x_coca225 uuid; x_coca500 uuid; x_sprite uuid; x_agua uuid; x_leche uuid; x_yogur1 uuid; x_yogur190 uuid; x_yerba1 uuid; x_yerba500 uuid;
  v_centro uuid; v_lacteos uuid; v_mayorista uuid;
  r uuid; d uuid;
  h record;
  i int := 0;
  es_dueno boolean;
  almacen uuid;
  t text;
begin
  if to_regclass('public.miembros') is null then
    truncate bajas, devolucion_lineas, devoluciones, presentacion_alias, presentacion_proveedor,
             recepcion_lineas, recepciones, conteos, presentaciones, producto_proveedor, productos, proveedores
             restart identity cascade;
  else
    -- Con usuarios (supabase/05): solo el dueño, y solo borra los datos de SU almacén
    execute 'select gondola_es(array[''dueno''])' into es_dueno;
    if not es_dueno then raise exception 'Solo el dueño puede restablecer la demo.'; end if;
    execute 'select gondola_mi_almacen()' into almacen;
    alter table recepcion_lineas disable trigger recepcion_lineas_reglas;
    alter table devolucion_lineas disable trigger devolucion_lineas_reglas;
    foreach t in array array['bajas','devolucion_lineas','devoluciones','presentacion_alias','presentacion_proveedor',
      'recepcion_lineas','recepciones','conteos','presentaciones','producto_proveedor','productos','proveedores'] loop
      execute format('delete from %I where almacen_id = $1', t) using almacen;
    end loop;
    alter table recepcion_lineas enable trigger recepcion_lineas_reglas;
    alter table devolucion_lineas enable trigger devolucion_lineas_reglas;
  end if;

  -- Productos (la identidad) …
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Coca-Cola',      'unidad', false, 0) returning id into p_coca;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Sprite',         'unidad', false, 0) returning id into p_sprite;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Agua mineral',   'unidad', false, 0) returning id into p_agua;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Leche entera',   'unidad', true,  0) returning id into p_leche;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Yogur bebible',  'unidad', true,  0) returning id into p_yogur;
  insert into productos (nombre, unidad, perecedero, punto_pedido) values ('Yerba mate',     'unidad', false, 0) returning id into p_yerba;

  -- … y sus presentaciones (lo que se cuenta, se compra y se recibe)
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido, costo_unitario, unidades_por_bulto)
    values (p_coca, '2,25 L', 2.25, 'l', 12, 1850, 8) returning id into x_coca225;
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido, costo_unitario, unidades_por_bulto)
    values (p_coca, '500 ml', 500, 'ml', 12, 900, 12) returning id into x_coca500;
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido, costo_unitario)
    values (p_sprite, '2,25 L', 2.25, 'l', 6, 1700) returning id into x_sprite;
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido, costo_unitario, unidades_por_bulto)
    values (p_agua, '1,5 L', 1.5, 'l', 10, 650, 6) returning id into x_agua;
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido, costo_unitario)
    values (p_leche, '1 L', 1, 'l', 20, 1150) returning id into x_leche;
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido, costo_unitario)
    values (p_yogur, '1 L', 1, 'l', 6, 1900) returning id into x_yogur1;
  -- Sin costo cargado a propósito: el tablero muestra "valor no calculable"
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido)
    values (p_yogur, '190 g', 190, 'g', 10) returning id into x_yogur190;
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido, costo_unitario)
    values (p_yerba, '1 kg', 1, 'kg', 8, 3200) returning id into x_yerba1;
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido, costo_unitario)
    values (p_yerba, '500 g', 500, 'g', 6, 1750) returning id into x_yerba500;

  -- Proveedores (1 = lunes … 7 = domingo)
  insert into proveedores (nombre, dias_visita) values ('Distribuidora Centro', '{2,5}')   returning id into v_centro;
  insert into proveedores (nombre, dias_visita) values ('Lácteos del Sur',      '{1,3,5}') returning id into v_lacteos;
  insert into proveedores (nombre, dias_visita) values ('Mayorista Rosario',    '{4}')     returning id into v_mayorista;

  insert into presentacion_proveedor (proveedor_id, presentacion_id) values
    (v_centro, x_coca225), (v_centro, x_coca500), (v_centro, x_sprite), (v_centro, x_agua),
    (v_lacteos, x_leche), (v_lacteos, x_yogur1), (v_lacteos, x_yogur190),
    (v_mayorista, x_yerba1), (v_mayorista, x_yerba500), (v_mayorista, x_coca225);

  -- Recepciones pasadas (antes de los últimos conteos)
  insert into recepciones (proveedor_id, fecha, origen) values (v_centro, hoy - 12, 'manual') returning id into r;
  insert into recepcion_lineas (recepcion_id, presentacion_id, descripcion, cantidad) values
    (r, x_coca225, 'Coca-Cola 2,25 L', 12), (r, x_coca500, 'Coca-Cola 500 ml', 12), (r, x_sprite, 'Sprite 2,25 L', 6), (r, x_agua, 'Agua mineral 1,5 L', 12);
  update recepciones set estado = 'confirmada', confirmada_en = ((hoy - 12) + time '11:00') at time zone tz where id = r;

  insert into recepciones (proveedor_id, fecha, origen) values (v_lacteos, hoy - 10, 'manual') returning id into r;
  insert into recepcion_lineas (recepcion_id, presentacion_id, descripcion, cantidad, fecha_vencimiento) values
    (r, x_leche, 'Leche entera 1 L', 24, hoy), (r, x_yogur1, 'Yogur bebible 1 L', 12, hoy - 1), (r, x_yogur190, 'Yogur bebible 190 g', 12, hoy + 2);
  update recepciones set estado = 'confirmada', confirmada_en = ((hoy - 10) + time '10:00') at time zone tz where id = r;

  insert into recepciones (proveedor_id, fecha, origen) values (v_mayorista, hoy - 14, 'manual') returning id into r;
  insert into recepcion_lineas (recepcion_id, presentacion_id, descripcion, cantidad) values
    (r, x_yerba1, 'Yerba 1 kg', 12), (r, x_yerba500, 'Yerba 500 g', 6), (r, x_coca225, 'Coca-Cola 2,25 L', 6);
  update recepciones set estado = 'confirmada', confirmada_en = ((hoy - 14) + time '12:00') at time zone tz where id = r;

  -- Conteos de las últimas 3 semanas: (presentación, días atrás, cantidad, lotes [vencimiento en días desde hoy, cantidad]…)
  for h in
    select * from (values
      (x_coca225, 21, 20, null::jsonb), (x_coca225, 14, 9, null), (x_coca225, 7, 14, null), (x_coca225, 2, 15, null),
      (x_coca500, 21, 18, null), (x_coca500, 14, 12, null), (x_coca500, 7, 17, null), (x_coca500, 2, 9, null),
      (x_sprite, 21, 8, null), (x_sprite, 14, 3, null), (x_sprite, 7, 7, null), (x_sprite, 2, 4, null),
      (x_agua, 22, 18, null), (x_agua, 15, 12, null), (x_agua, 11, 24, null), (x_agua, 4, 20, null),
      (x_leche, 20, 26, '[[-12,26]]'), (x_leche, 13, 18, '[[-6,18]]'), (x_leche, 6, 32, '[[1,32]]'),
      -- Dos lotes de leche con vencimientos distintos
      (x_leche, 1, 30, '[[2,12],[9,18]]'),
      (x_yogur1, 20, 9, '[[-10,9]]'), (x_yogur1, 13, 5, '[[-4,5]]'), (x_yogur1, 6, 11, '[[3,11]]'),
      -- 3 yogures ya vencidos que siguen en la heladera + 5 que vencen en 6 días
      (x_yogur1, 1, 8, '[[-1,3],[6,5]]'),
      (x_yogur190, 13, 14, '[[1,14]]'), (x_yogur190, 6, 16, '[[5,16]]'), (x_yogur190, 1, 11, '[[4,11]]'),
      (x_yerba1, 23, 14, null), (x_yerba1, 16, 10, null), (x_yerba1, 9, 20, null),
      (x_yerba500, 16, 8, null), (x_yerba500, 9, 7, null)
    ) as t(presentacion_id, dias, cantidad, lotes)
  loop
    i := i + 1;
    insert into conteos (presentacion_id, producto_id, cantidad, fecha_hora, lotes)
    values (h.presentacion_id, (select producto_id from presentaciones where id = h.presentacion_id), h.cantidad,
            ((hoy - h.dias) + make_time(9, 15 + (i % 30), 0)) at time zone tz,
            case when h.lotes is null then null else
              (select jsonb_agg(jsonb_build_object('fecha_vencimiento', hoy + (e->>0)::int, 'cantidad', (e->>1)::numeric))
               from jsonb_array_elements(h.lotes) e) end);
  end loop;

  -- Historial: una devolución ya resuelta y una baja (anteriores a los últimos conteos)
  insert into devoluciones (proveedor_id, fecha, motivo, nota) values (v_lacteos, hoy - 9, 'proximo_vencer', 'Retiró el repartidor')
    returning id into d;
  insert into devolucion_lineas (devolucion_id, presentacion_id, cantidad, fecha_vencimiento, costo_unitario)
    values (d, x_yogur1, 4, hoy - 8, 1900);
  update devoluciones set estado = 'confirmada' where id = d;
  update devoluciones set estado = 'resuelta', resolucion = 'reemplazo', resolucion_nota = 'Los repuso en la entrega siguiente' where id = d;
  -- Solo en la demo: fechas históricas (la regla normal no deja cambiarlas)
  alter table devoluciones disable trigger devoluciones_reglas;
  update devoluciones set creada_en = ((hoy - 9) + time '09:00') at time zone tz, confirmada_en = ((hoy - 9) + time '10:30') at time zone tz, resuelta_en = ((hoy - 7) + time '10:00') at time zone tz where id = d;
  alter table devoluciones enable trigger devoluciones_reglas;

  insert into bajas (presentacion_id, cantidad, fecha_vencimiento, motivo, nota, costo_unitario, registrada_en)
    values (x_leche, 2, hoy - 6, 'vencido', 'Sachets inflados', 1150, ((hoy - 6) + time '08:30') at time zone tz);

  -- Remitos de ejemplo en BORRADOR (origen remito_foto), con errores a propósito
  insert into recepciones (proveedor_id, fecha, origen, estado, imagen_path, datos_ia)
  values (v_lacteos, hoy, 'remito_foto', 'borrador', 'ejemplo:lacteos', jsonb_build_object(
    'proveedor', 'LÁCTEOS DEL SUR S.R.L.',
    'fecha', hoy,
    'lineas', jsonb_build_array(
      jsonb_build_object('descripcion', 'LECHE ENTERA SACHET 1 LT', 'cantidad', 24, 'fecha_vencimiento', hoy + 12, 'confianza', 0.97),
      jsonb_build_object('descripcion', 'YOG. BEB. FRUT. 1LT',      'cantidad', 18, 'fecha_vencimiento', hoy + 15, 'confianza', 0.55),
      jsonb_build_object('descripcion', 'QUESO CREMA X 290 G',      'cantidad', 6,  'fecha_vencimiento', hoy + 30, 'confianza', 0.93))))
  returning id into r;
  insert into recepcion_lineas (recepcion_id, presentacion_id, descripcion, cantidad, fecha_vencimiento, confianza_ia) values
    (r, x_leche,  'LECHE ENTERA SACHET 1 LT', 24, hoy + 12, 0.97),
    (r, x_yogur1, 'YOG. BEB. FRUT. 1LT',      18, hoy + 15, 0.55),
    (r, null,     'QUESO CREMA X 290 G',      6,  hoy + 30, 0.93);

  insert into recepciones (proveedor_id, fecha, origen, estado, imagen_path, datos_ia)
  values (v_centro, hoy, 'remito_foto', 'borrador', 'ejemplo:centro', jsonb_build_object(
    'proveedor', 'DISTRIBUIDORA CENTRO S.A.',
    'fecha', hoy,
    'lineas', jsonb_build_array(
      jsonb_build_object('descripcion', 'COCA COLA 2,25 LT',          'cantidad', 12, 'fecha_vencimiento', null, 'confianza', 0.98),
      jsonb_build_object('descripcion', 'COCA COLA 500 CC',           'cantidad', 12, 'fecha_vencimiento', null, 'confianza', 0.92),
      jsonb_build_object('descripcion', 'SPRITE LIMA-LIMON 2,25 LT',  'cantidad', 6,  'fecha_vencimiento', null, 'confianza', 0.95),
      jsonb_build_object('descripcion', 'AGUA MIN. S/GAS 1500 CC',    'cantidad', 12, 'fecha_vencimiento', null, 'confianza', 0.60),
      jsonb_build_object('descripcion', 'FANTA NARANJA 2,25 LT',      'cantidad', 6,  'fecha_vencimiento', null, 'confianza', 0.94))))
  returning id into r;
  -- Las líneas quedan sin vincular: la app las vincula al abrir la revisión (y así se ve cómo
  -- reconoce cada presentación por su tamaño).
  insert into recepcion_lineas (recepcion_id, presentacion_id, descripcion, cantidad, confianza_ia) values
    (r, null, 'COCA COLA 2,25 LT',         12, 0.98),
    (r, null, 'COCA COLA 500 CC',          12, 0.92),
    (r, null, 'SPRITE LIMA-LIMON 2,25 LT', 6,  0.95),
    (r, null, 'AGUA MIN. S/GAS 1500 CC',   12, 0.60),
    (r, null, 'FANTA NARANJA 2,25 LT',     6,  0.94);
end;
$$;

revoke all on function gondola_restablecer_demo() from public;
do $$ begin
  if to_regclass('public.miembros') is null then
    grant execute on function gondola_restablecer_demo() to anon, authenticated;
  else
    revoke execute on function gondola_restablecer_demo() from anon;
    grant execute on function gondola_restablecer_demo() to authenticated;
  end if;
end $$;

commit;

-- Para que la API vea las tablas, columnas y funciones nuevas sin esperar
notify pgrst, 'reload schema';
