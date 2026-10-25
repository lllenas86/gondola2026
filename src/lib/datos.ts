// Lectura y escritura de datos en Supabase. Supabase es la ÚNICA fuente de datos.
import { db, ErrorBase, subirArchivo } from './supabase';
import { isoDate } from './dates';
import { normalizarAlias } from './match';
import type {
  AliasRemito, AppData, Baja, Borrador, Conteo, DiaSemana, Devolucion, FilaConsumo, FilaStock, FilaVisita,
  LineaBorradorBase, LoteContado, MotivoBaja, MotivoDevolucion, Presentacion, Producto, Proveedor, Recepcion,
  ResolucionDevolucion, Unidad, UnidadContenido, Vistas,
} from '../types';

// ---------- Filas tal como vienen de la base ----------

type N = number | string | null;
interface RowProducto { id: string; nombre: string; perecedero: boolean; activo?: boolean }
interface RowPresentacion {
  id: string; producto_id: string; nombre: string; contenido: N; unidad_contenido: string | null; unidad_stock: string;
  unidades_por_bulto: N; punto_pedido: N; costo_unitario: N; activa: boolean; migrada: boolean;
}
interface RowProveedor { id: string; nombre: string; dias_visita: number[]; telefono?: string | null }
interface RowPresProv { presentacion_id: string; proveedor_id: string }
interface RowConteo {
  id: string; producto_id: string; presentacion_id: string | null; cantidad: N; fecha_hora: string; fecha_vencimiento: string | null;
  lotes: { fecha_vencimiento: string; cantidad: N }[] | null; sesion_id: string | null; tipo: 'inicial' | 'periodico' | null; stock_registrado: N;
}
interface RowRecepcion {
  id: string; proveedor_id: string | null; fecha: string | null; origen: 'manual' | 'remito_foto';
  estado: 'borrador' | 'confirmada' | 'cancelada'; imagen_path: string | null; datos_ia: unknown;
  creada_en: string; confirmada_en: string | null;
}
interface RowLinea {
  id: number; recepcion_id: string; presentacion_id: string | null; descripcion: string | null; cantidad: N;
  fecha_vencimiento: string | null; confianza_ia: N; estado: 'vinculada' | 'sin_vincular' | 'ignorada';
}
interface RowDevolucion {
  id: string; numero: number; proveedor_id: string; fecha: string; motivo: MotivoDevolucion; nota: string | null;
  estado: Devolucion['estado']; resolucion: ResolucionDevolucion | null; resolucion_nota: string | null;
  creada_en: string; confirmada_en: string | null; resuelta_en: string | null; cancelada_en: string | null;
}
interface RowDevLinea { devolucion_id: string; presentacion_id: string; cantidad: N; fecha_vencimiento: string | null; recepcion_id: string | null; costo_unitario: N }
interface RowBaja {
  id: string; presentacion_id: string; cantidad: N; fecha_vencimiento: string | null; motivo: MotivoBaja; nota: string | null;
  costo_unitario: N; registrada_en: string;
}
interface RowStock { presentacion_id: string; producto_id: string; punto_pedido: N; stock_actual: N; fecha_ultimo_conteo: string | null }
interface RowVisita { proveedor_id: string; nombre: string; proxima_visita: string; dias_hasta: number }
interface RowConsumo { presentacion_id: string; desde: string; hasta: string; consumo: N; dias: N }

const num = (v: N | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const numONull = (v: N | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const opcional = (v: N | undefined): number | undefined => (v === null || v === undefined ? undefined : Number(v));

/** Base: 1 = lunes … 7 = domingo. App: 0 = domingo … 6 = sábado. */
const diaDesdeBase = (d: number): DiaSemana => (d === 7 ? 0 : d) as DiaSemana;
const diaHaciaBase = (d: DiaSemana): number => (d === 0 ? 7 : d);

const UNIDADES: Unidad[] = ['unidad', 'kg', 'litro', 'paquete', 'caja'];
const UNIDADES_CONTENIDO: UnidadContenido[] = ['ml', 'l', 'g', 'kg', 'u'];

/** Error específico: la base todavía no tiene la migración 04. */
export class FaltaMigracion extends Error {}

// ---------- Carga ----------

export async function cargarTodo(): Promise<{ data: AppData; vistas: Vistas }> {
  const presentaciones = await db
    .select<RowPresentacion>('presentaciones', 'select=*&order=nombre.asc')
    .catch((e: { codigo?: string }) => {
      if (e?.codigo === 'PGRST205' || e?.codigo === '42P01') {
        throw new FaltaMigracion('Falta actualizar la base: corré supabase/04_presentaciones_lotes_devoluciones.sql en Supabase → SQL Editor.');
      }
      throw e;
    });
  const [productos, proveedores, pp, conteos, recepciones, lineas, devoluciones, devLineas, bajas, alias, stock, visitas, consumo, tieneTelefono] = await Promise.all([
    db.select<RowProducto>('productos', 'select=id,nombre,perecedero,activo&order=nombre.asc'),
    // select=* para que funcione con o sin la columna telefono (supabase/03_pedido_y_demo.sql)
    db.select<RowProveedor>('proveedores', 'select=*&order=nombre.asc'),
    db.select<RowPresProv>('presentacion_proveedor', 'select=presentacion_id,proveedor_id'),
    db.select<RowConteo>('conteos', 'select=id,producto_id,presentacion_id,cantidad,fecha_hora,fecha_vencimiento,lotes,sesion_id,tipo,stock_registrado&order=fecha_hora.asc'),
    db.select<RowRecepcion>('recepciones', 'select=*&estado=in.(borrador,confirmada)&order=creada_en.desc'),
    db.select<RowLinea>('recepcion_lineas', 'select=id,recepcion_id,presentacion_id,descripcion,cantidad,fecha_vencimiento,confianza_ia,estado&order=id.asc'),
    db.select<RowDevolucion>('devoluciones', 'select=*&order=numero.desc'),
    db.select<RowDevLinea>('devolucion_lineas', 'select=devolucion_id,presentacion_id,cantidad,fecha_vencimiento,recepcion_id,costo_unitario&order=id.asc'),
    db.select<RowBaja>('bajas', 'select=*&order=registrada_en.desc'),
    db.select<{ texto: string; presentacion_id: string }>('presentacion_alias', 'select=texto,presentacion_id'),
    db.select<RowStock>('v_stock_presentacion', 'select=presentacion_id,producto_id,punto_pedido,stock_actual,fecha_ultimo_conteo'),
    db.select<RowVisita>('v_visitas_proximas', 'select=proveedor_id,nombre,proxima_visita,dias_hasta&order=dias_hasta.asc'),
    db.select<RowConsumo>('v_consumo_presentacion', 'select=presentacion_id,desde,hasta,consumo,dias&order=hasta.asc'),
    db.select('proveedores', 'select=telefono&limit=1').then(() => true, () => false),
  ]);

  const lineasPor = agrupar(lineas, (l) => l.recepcion_id);
  const confirmadas: Recepcion[] = [];
  const borradores: Borrador[] = [];
  for (const r of recepciones) {
    const ls = lineasPor.get(r.id) ?? [];
    if (r.estado === 'confirmada') {
      confirmadas.push({
        id: r.id,
        proveedorId: r.proveedor_id ?? '',
        fecha: r.fecha ?? isoDate(new Date(r.confirmada_en ?? r.creada_en)),
        registradaEn: r.confirmada_en ?? r.creada_en,
        origen: r.origen,
        ...(r.imagen_path ? { imagen: r.imagen_path } : {}),
        lineas: ls
          .filter((l) => l.estado === 'vinculada' && l.presentacion_id)
          .map((l) => ({
            presentacionId: l.presentacion_id as string,
            cantidad: num(l.cantidad),
            ...(l.fecha_vencimiento ? { fechaVencimiento: l.fecha_vencimiento } : {}),
          })),
      });
    } else {
      const ia = (r.datos_ia && typeof r.datos_ia === 'object' ? r.datos_ia : {}) as { proveedor?: unknown };
      borradores.push({
        id: r.id,
        proveedorId: r.proveedor_id,
        ...(typeof ia.proveedor === 'string' ? { proveedorTexto: ia.proveedor } : {}),
        fecha: r.fecha,
        origen: r.origen,
        ...(r.imagen_path ? { imagen: r.imagen_path } : {}),
        creadaEn: r.creada_en,
        lineas: ls
          .filter((l) => l.estado !== 'ignorada')
          .map((l) => ({
            presentacionId: l.presentacion_id,
            descripcion: l.descripcion ?? '',
            cantidad: num(l.cantidad),
            ...(l.fecha_vencimiento ? { fechaVencimiento: l.fecha_vencimiento } : {}),
            ...(l.confianza_ia !== null ? { confianza: num(l.confianza_ia) } : {}),
          })),
      });
    }
  }

  const devLineasPor = agrupar(devLineas, (l) => l.devolucion_id);

  const data: AppData = {
    productos: productos.map((p): Producto => ({ id: p.id, nombre: p.nombre, perecedero: p.perecedero, activo: p.activo !== false })),
    presentaciones: presentaciones.map((x): Presentacion => ({
      id: x.id,
      productoId: x.producto_id,
      nombre: x.nombre,
      ...(x.contenido !== null && x.unidad_contenido && (UNIDADES_CONTENIDO as string[]).includes(x.unidad_contenido)
        ? { contenido: num(x.contenido), unidadContenido: x.unidad_contenido as UnidadContenido }
        : {}),
      unidadStock: (UNIDADES as string[]).includes(x.unidad_stock) ? (x.unidad_stock as Unidad) : 'unidad',
      ...(x.unidades_por_bulto !== null ? { unidadesPorBulto: num(x.unidades_por_bulto) } : {}),
      puntoDePedido: num(x.punto_pedido),
      ...(x.costo_unitario !== null ? { costoUnitario: num(x.costo_unitario) } : {}),
      activa: x.activa,
      migrada: x.migrada,
    })),
    proveedores: proveedores.map((p): Proveedor => ({
      id: p.id,
      nombre: p.nombre,
      diasDeVisita: (p.dias_visita ?? []).map(diaDesdeBase),
      ...(p.telefono ? { telefono: p.telefono } : {}),
    })),
    presentacionProveedor: pp.map((x) => ({ presentacionId: x.presentacion_id, proveedorId: x.proveedor_id })),
    conteos: conteos
      .filter((c) => c.presentacion_id)
      .map((c): Conteo => ({
        id: c.id,
        presentacionId: c.presentacion_id as string,
        productoId: c.producto_id,
        cantidad: num(c.cantidad),
        fechaHora: c.fecha_hora,
        ...(c.fecha_vencimiento ? { fechaVencimiento: c.fecha_vencimiento } : {}),
        ...(Array.isArray(c.lotes) ? { lotes: c.lotes.map((l): LoteContado => ({ fechaVencimiento: l.fecha_vencimiento, cantidad: num(l.cantidad) })) } : {}),
        ...(c.sesion_id ? { sesionId: c.sesion_id } : {}),
        tipo: c.tipo,
        stockRegistrado: numONull(c.stock_registrado),
      })),
    recepciones: confirmadas,
    borradores,
    devoluciones: devoluciones.map((d): Devolucion => ({
      id: d.id,
      numero: d.numero,
      proveedorId: d.proveedor_id,
      fecha: d.fecha,
      motivo: d.motivo,
      ...(d.nota ? { nota: d.nota } : {}),
      estado: d.estado,
      ...(d.resolucion ? { resolucion: d.resolucion } : {}),
      ...(d.resolucion_nota ? { resolucionNota: d.resolucion_nota } : {}),
      creadaEn: d.creada_en,
      ...(d.confirmada_en ? { confirmadaEn: d.confirmada_en } : {}),
      ...(d.resuelta_en ? { resueltaEn: d.resuelta_en } : {}),
      ...(d.cancelada_en ? { canceladaEn: d.cancelada_en } : {}),
      lineas: (devLineasPor.get(d.id) ?? []).map((l) => ({
        presentacionId: l.presentacion_id,
        cantidad: num(l.cantidad),
        ...(l.fecha_vencimiento ? { fechaVencimiento: l.fecha_vencimiento } : {}),
        ...(l.recepcion_id ? { recepcionId: l.recepcion_id } : {}),
        ...(l.costo_unitario !== null ? { costoUnitario: num(l.costo_unitario) } : {}),
      })),
    })),
    bajas: bajas.map((b): Baja => ({
      id: b.id,
      presentacionId: b.presentacion_id,
      cantidad: num(b.cantidad),
      ...(b.fecha_vencimiento ? { fechaVencimiento: b.fecha_vencimiento } : {}),
      motivo: b.motivo,
      ...(b.nota ? { nota: b.nota } : {}),
      ...(opcional(b.costo_unitario) !== undefined ? { costoUnitario: opcional(b.costo_unitario) } : {}),
      registradaEn: b.registrada_en,
    })),
    alias: alias.map((a): AliasRemito => ({ texto: a.texto, presentacionId: a.presentacion_id })),
  };

  const vistas: Vistas = {
    stock: stock.map((s): FilaStock => ({
      presentacionId: s.presentacion_id,
      productoId: s.producto_id,
      puntoPedido: num(s.punto_pedido),
      stockActual: numONull(s.stock_actual),
      fechaUltimoConteo: s.fecha_ultimo_conteo,
    })),
    visitas: visitas.map((v): FilaVisita => ({ proveedorId: v.proveedor_id, nombre: v.nombre, proximaVisita: v.proxima_visita, diasHasta: v.dias_hasta })),
    consumo: consumo
      .filter((c) => c.consumo !== null && c.dias !== null)
      .map((c): FilaConsumo => ({ presentacionId: c.presentacion_id, desde: c.desde, hasta: c.hasta, consumo: num(c.consumo), dias: num(c.dias) })),
    tieneTelefono,
  };

  return { data, vistas };
}

function agrupar<T>(filas: T[], clave: (f: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const f of filas) {
    const k = clave(f);
    const arr = m.get(k) ?? [];
    arr.push(f);
    m.set(k, arr);
  }
  return m;
}

// ---------- Catálogo ----------

/** Crea o actualiza la ficha del producto (identidad: nombre y si es perecedero). */
export async function guardarProducto(p: Producto, esNuevo: boolean): Promise<Producto> {
  const fila = { nombre: p.nombre.trim(), perecedero: p.perecedero };
  if (esNuevo) await db.insert('productos', { id: p.id, ...fila });
  else await db.update('productos', `id=eq.${p.id}`, fila);
  return { ...p, nombre: fila.nombre };
}

/** Crea o actualiza una presentación y sus proveedores. */
export async function guardarPresentacion(x: Presentacion, esNueva: boolean, proveedorIds: string[]): Promise<Presentacion> {
  const fila = {
    producto_id: x.productoId,
    nombre: x.nombre.trim(),
    contenido: x.contenido ?? null,
    unidad_contenido: x.contenido !== undefined ? x.unidadContenido ?? null : null,
    unidad_stock: x.unidadStock,
    unidades_por_bulto: x.unidadesPorBulto ?? null,
    punto_pedido: x.puntoDePedido,
    costo_unitario: x.costoUnitario ?? null,
    activa: x.activa,
  };
  if (esNueva) await db.insert('presentaciones', { id: x.id, ...fila });
  else await db.update('presentaciones', `id=eq.${x.id}`, fila);
  await db.borrar('presentacion_proveedor', `presentacion_id=eq.${x.id}`);
  if (proveedorIds.length > 0) {
    await db.insert('presentacion_proveedor', proveedorIds.map((proveedor_id) => ({ presentacion_id: x.id, proveedor_id })));
  }
  return { ...x, nombre: fila.nombre };
}

export interface ResultadoMover {
  presentacion_id: string;
  producto_origen: string;
  producto_destino: string;
  nombre: string;
  stock: number | null;
  origen_archivado: boolean;
}

/** Agrupa una presentación bajo otra ficha. La base valida y verifica que el stock no cambie. */
export async function moverPresentacion(presentacionId: string, productoDestinoId: string, nombre: string): Promise<ResultadoMover> {
  return db.rpc<ResultadoMover>('gondola_mover_presentacion', { p_presentacion: presentacionId, p_producto_destino: productoDestinoId, p_nombre: nombre });
}

/** Guarda el proveedor y qué presentaciones trae. */
export async function guardarProveedor(p: Proveedor, esNuevo: boolean, presentacionIds: string[], conTelefono = false): Promise<void> {
  const fila = {
    nombre: p.nombre.trim(),
    dias_visita: [...new Set(p.diasDeVisita.map(diaHaciaBase))].sort((a, b) => a - b),
    // La columna existe solo si se corrió supabase/03_pedido_y_demo.sql
    ...(conTelefono ? { telefono: p.telefono?.trim() || null } : {}),
  };
  if (esNuevo) await db.insert('proveedores', { id: p.id, ...fila });
  else await db.update('proveedores', `id=eq.${p.id}`, fila);
  await db.borrar('presentacion_proveedor', `proveedor_id=eq.${p.id}`);
  if (presentacionIds.length > 0) {
    await db.insert('presentacion_proveedor', presentacionIds.map((presentacion_id) => ({ presentacion_id, proveedor_id: p.id })));
  }
}

// ---------- Conteos ----------

export interface NuevoConteo {
  presentacionId: string;
  productoId: string;
  cantidad: number;
  lotes?: LoteContado[];
}

/**
 * Solo agrega conteos: nunca borra ni modifica los anteriores. La fecha y hora, el tipo
 * (inicial / periódico) y el stock que figuraba antes de contar los pone la base.
 */
export async function registrarConteos(conteos: NuevoConteo[], sesionId: string): Promise<void> {
  await db.insert(
    'conteos',
    conteos.map((c) => ({
      presentacion_id: c.presentacionId,
      producto_id: c.productoId,
      cantidad: c.cantidad,
      sesion_id: sesionId,
      lotes: c.lotes && c.lotes.length > 0 ? c.lotes.map((l) => ({ fecha_vencimiento: l.fechaVencimiento, cantidad: l.cantidad })) : null,
    })),
  );
}

// ---------- Recepciones ----------

/** Guarda la foto del remito en el bucket "remitos". Devuelve la ruta, o null si no se pudo. */
export async function subirFotoRemito(foto: Blob, id: string): Promise<string | null> {
  return subirArchivo(`${isoDate(new Date())}/${id}.jpg`, foto);
}

export interface DatosBorradorFoto {
  proveedorId: string | null;
  fecha: string | null;
  imagenPath: string | null;
  /** Respuesta cruda del modelo */
  datosIa: unknown;
  lineas: LineaBorradorBase[];
}

/** Crea la recepción en borrador a partir de la lectura de la IA. Nada suma al stock todavía. */
export async function crearBorradorDesdeFoto(d: DatosBorradorFoto): Promise<string> {
  const [r] = await db.insert<RowRecepcion>('recepciones', {
    proveedor_id: d.proveedorId,
    fecha: d.fecha,
    origen: 'remito_foto',
    estado: 'borrador',
    imagen_path: d.imagenPath,
    datos_ia: d.datosIa,
  });
  // La base rechaza cantidades ≤ 0: las líneas sin cantidad legible quedan solo en la pantalla de revisión.
  const filas = d.lineas
    .filter((l) => typeof l.cantidad === 'number' && l.cantidad > 0)
    .map((l) => ({
      recepcion_id: r.id,
      presentacion_id: l.presentacionId,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      fecha_vencimiento: l.fechaVencimiento ?? null,
      confianza_ia: l.confianza ?? null,
      estado: l.presentacionId ? 'vinculada' : 'sin_vincular',
    }));
  if (filas.length > 0) await db.insert('recepcion_lineas', filas);
  return r.id;
}

export interface LineaAConfirmar {
  presentacionId: string | null;
  descripcion?: string;
  cantidad: number;
  fechaVencimiento?: string;
  confianza?: number;
  ignorada?: boolean;
}

export interface DatosConfirmacion {
  /** Si viene de un borrador, se confirma ese mismo registro */
  borradorId?: string;
  proveedorId: string;
  fecha: string;
  origen: 'manual' | 'remito_foto';
  imagenPath?: string | null;
  lineas: LineaAConfirmar[];
  /** Presentaciones que hay que asociar al proveedor (las trajo y no estaban asociadas) */
  asociar: string[];
  /** Textos del remito vinculados a mano: se recuerdan para la próxima lectura */
  aprender: AliasRemito[];
}

/**
 * Confirma la recepción: recién acá suma al stock. La base vuelve a controlar
 * todo (proveedor, líneas sin vincular, cantidades) y rechaza si algo no cierra.
 */
export async function confirmarRecepcion(d: DatosConfirmacion): Promise<void> {
  let id = d.borradorId;
  if (id) {
    await db.update('recepciones', `id=eq.${id}`, { proveedor_id: d.proveedorId, fecha: d.fecha });
    await db.borrar('recepcion_lineas', `recepcion_id=eq.${id}`);
  } else {
    const [r] = await db.insert<RowRecepcion>('recepciones', {
      proveedor_id: d.proveedorId,
      fecha: d.fecha,
      origen: d.origen,
      estado: 'borrador',
      imagen_path: d.imagenPath ?? null,
    });
    id = r.id;
  }
  const filas = d.lineas
    .filter((l) => l.cantidad > 0 || !l.ignorada)
    .map((l) => ({
      recepcion_id: id,
      presentacion_id: l.ignorada ? null : l.presentacionId,
      descripcion: l.descripcion ?? null,
      cantidad: l.cantidad,
      fecha_vencimiento: l.fechaVencimiento ?? null,
      confianza_ia: l.confianza ?? null,
      estado: l.ignorada ? 'ignorada' : l.presentacionId ? 'vinculada' : 'sin_vincular',
    }));
  if (filas.length > 0) await db.insert('recepcion_lineas', filas);
  await db.update('recepciones', `id=eq.${id}`, { estado: 'confirmada' });
  await db.insertIgnorandoDuplicados(
    'presentacion_proveedor',
    d.asociar.map((presentacion_id) => ({ presentacion_id, proveedor_id: d.proveedorId })),
    'presentacion_id,proveedor_id',
  );
  // Aprender alias (si falla, la recepción ya quedó guardada: no se informa como error)
  for (const a of d.aprender) {
    const texto = normalizarAlias(a.texto);
    if (!texto) continue;
    try {
      await db.borrar('presentacion_alias', `texto=eq.${encodeURIComponent(texto)}`);
      await db.insert('presentacion_alias', { texto, presentacion_id: a.presentacionId });
    } catch {
      /* el alias es una ayuda, no un dato crítico */
    }
  }
}

/** Descarta un borrador (queda registrado como cancelado, no suma al stock). */
export async function cancelarBorrador(id: string): Promise<void> {
  await db.update('recepciones', `id=eq.${id}`, { estado: 'cancelada' });
}

// ---------- Devoluciones y bajas ----------

export interface DatosDevolucion {
  proveedorId: string;
  fecha: string;
  motivo: MotivoDevolucion;
  nota?: string;
  lineas: { presentacionId: string; cantidad: number; fechaVencimiento?: string; recepcionId?: string; costoUnitario?: number }[];
}

const filasDevolucion = (id: string, d: DatosDevolucion) =>
  d.lineas.map((l) => ({
    devolucion_id: id,
    presentacion_id: l.presentacionId,
    cantidad: l.cantidad,
    fecha_vencimiento: l.fechaVencimiento ?? null,
    recepcion_id: l.recepcionId ?? null,
    costo_unitario: l.costoUnitario ?? null,
  }));

/** Prepara el remito de devolución. NO descuenta stock (eso pasa al confirmar). */
export async function prepararDevolucion(d: DatosDevolucion): Promise<{ id: string; numero: number }> {
  const [r] = await db.insert<RowDevolucion>('devoluciones', {
    proveedor_id: d.proveedorId, fecha: d.fecha, motivo: d.motivo, nota: d.nota?.trim() || null,
  });
  if (d.lineas.length > 0) await db.insert('devolucion_lineas', filasDevolucion(r.id, d));
  return { id: r.id, numero: r.numero };
}

/** Cambia una devolución preparada (la base no deja si ya se confirmó). */
export async function actualizarDevolucion(id: string, d: DatosDevolucion): Promise<void> {
  await db.update('devoluciones', `id=eq.${id}`, { proveedor_id: d.proveedorId, fecha: d.fecha, motivo: d.motivo, nota: d.nota?.trim() || null });
  await db.borrar('devolucion_lineas', `devolucion_id=eq.${id}`);
  if (d.lineas.length > 0) await db.insert('devolucion_lineas', filasDevolucion(id, d));
}

/** La mercadería salió del almacén: recién acá se descuenta el stock (una sola vez, lo controla la base). */
export async function confirmarDevolucion(id: string): Promise<void> {
  sinCambios(await db.update('devoluciones', `id=eq.${id}&estado=eq.preparada`, { estado: 'confirmada' }));
}

export async function cancelarDevolucion(id: string): Promise<void> {
  sinCambios(await db.update('devoluciones', `id=eq.${id}&estado=eq.preparada`, { estado: 'cancelada' }));
}

export async function resolverDevolucion(id: string, resolucion: ResolucionDevolucion, nota?: string): Promise<void> {
  sinCambios(await db.update('devoluciones', `id=eq.${id}&estado=eq.confirmada`, { estado: 'resuelta', resolucion, resolucion_nota: nota?.trim() || null }));
}

/** Si la actualización no tocó ninguna fila, alguien la cambió antes (o no hay permiso). */
function sinCambios(filas: unknown[]) {
  if (filas.length === 0) {
    throw new ErrorBase('base', 'P0001', 'La devolución cambió de estado mientras la mirabas (o tu usuario no puede modificarla). Se actualizó la pantalla.');
  }
}

export interface NuevaBaja {
  presentacionId: string;
  cantidad: number;
  fechaVencimiento?: string;
  motivo: MotivoBaja;
  nota?: string;
  costoUnitario?: number;
}

/** Registra mercadería descartada. Descuenta stock en el momento. */
export async function registrarBajas(bajas: NuevaBaja[]): Promise<void> {
  await db.insert(
    'bajas',
    bajas.map((b) => ({
      presentacion_id: b.presentacionId,
      cantidad: b.cantidad,
      fecha_vencimiento: b.fechaVencimiento ?? null,
      motivo: b.motivo,
      nota: b.nota?.trim() || null,
      costo_unitario: b.costoUnitario ?? null,
    })),
  );
}

// ---------- Demo ----------

/** Vuelve la base a los datos de ejemplo (función de supabase/04_….sql). */
export async function restablecerDemo(): Promise<void> {
  await db.rpc('gondola_restablecer_demo');
}

// ---------- Equipo (requiere supabase/05) ----------

export interface Miembro {
  userId: string;
  email: string;
  rol: 'empleado' | 'encargado' | 'dueno';
}

export async function listarEquipo(): Promise<Miembro[]> {
  const filas = await db.select<{ user_id: string; email: string | null; rol: Miembro['rol'] }>('miembros', 'select=user_id,email,rol&order=email.asc');
  return filas.map((f) => ({ userId: f.user_id, email: f.email ?? '', rol: f.rol }));
}

/** Agrega o cambia el rol (la base verifica que quien lo pide sea dueño). */
export async function guardarMiembro(email: string, rol: Miembro['rol']): Promise<void> {
  await db.rpc('gondola_guardar_miembro', { p_email: email.trim(), p_rol: rol });
}

export async function quitarMiembro(userId: string): Promise<void> {
  await db.rpc('gondola_quitar_miembro', { p_user: userId });
}
