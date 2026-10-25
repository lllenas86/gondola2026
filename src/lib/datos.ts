// Lectura y escritura de datos en Supabase. Supabase es la ÚNICA fuente de datos.
import { db, ErrorBase, subirArchivo } from './supabase';
import { isoDate } from './dates';
import type {
  AppData, Borrador, Conteo, DiaSemana, Devolucion, EstadoLote, Ficha, FilaConsumo, FilaStock, FilaVencimiento, FilaVisita,
  LineaBorradorBase, Lote, MotivoDevolucion, Movimiento, Producto, Proveedor, Recepcion, RespuestaProveedor, SesionConteo,
  Unidad, UnidadContenido, Vistas,
} from '../types';

// ---------- Filas tal como vienen de la base ----------

interface RowProducto {
  id: string; nombre: string; unidad: string; perecedero: boolean; punto_pedido: number | string;
  ficha_id: string; presentacion: string; contenido: number | string | null; unidad_contenido: string | null;
  unidades_por_presentacion: number | string;
}
interface RowFicha { id: string; nombre: string; archivada: boolean }
interface RowSesion { id: string; tipo: 'inicial' | 'periodico'; notas: string | null; creada_en: string }
interface RowDevolucion {
  id: string; numero: number; proveedor_id: string; tipo: 'devolucion' | 'cambio'; motivo: MotivoDevolucion; nota: string | null;
  estado: Devolucion['estado']; respuesta_proveedor: RespuestaProveedor; resolucion: string | null; fecha: string;
  creada_en: string; entregada_en: string | null; resuelta_en: string | null;
}
interface RowDevLinea { id: number; devolucion_id: string; producto_id: string; cantidad: number | string; fecha_vencimiento: string | null; recepcion_id: string | null }
interface RowMovimiento {
  id: string; producto_id: string; tipo: 'devolucion' | 'baja'; cantidad: number | string; fecha_vencimiento: string | null;
  motivo: string | null; devolucion_linea_id: number | null; fecha_hora: string;
}
interface RowLote {
  producto_id: string; fecha_vencimiento: string | null; cantidad: number | string; recepcion_id: string | null;
  origen: 'conteo' | 'recepcion'; dias_para_vencer: number | null; estado: EstadoLote;
}
interface RowProveedor { id: string; nombre: string; dias_visita: number[]; telefono?: string | null }
interface RowProductoProveedor { producto_id: string; proveedor_id: string }
interface RowConteo {
  id: string; producto_id: string; cantidad: number | string; fecha_hora: string; fecha_vencimiento: string | null;
  sesion_id: string | null; stock_esperado: number | string | null;
}
interface RowRecepcion {
  id: string; proveedor_id: string | null; fecha: string | null; origen: 'manual' | 'remito_foto';
  estado: 'borrador' | 'confirmada' | 'cancelada'; imagen_path: string | null; datos_ia: unknown;
  creada_en: string; confirmada_en: string | null;
}
interface RowLinea {
  id: number; recepcion_id: string; producto_id: string | null; descripcion: string | null; cantidad: number | string;
  fecha_vencimiento: string | null; confianza_ia: number | string | null; estado: 'vinculada' | 'sin_vincular' | 'ignorada';
}
interface RowStock {
  producto_id: string; nombre: string; punto_pedido: number | string; stock_actual: number | string | null;
  bajo_punto_pedido: boolean; conteo_desactualizado: boolean; fecha_ultimo_conteo: string | null; dias_desde_conteo: number | null;
}
interface RowVisita { proveedor_id: string; nombre: string; proxima_visita: string; dias_hasta: number }
interface RowConsumo { producto_id: string; consumo: number | string | null; dias: number | string | null }
interface RowVencimiento { producto_id: string; nombre: string; fecha_vencimiento: string; cantidad: number | string; dias_para_vencer: number }

const num = (v: number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const numONull = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/** Base: 1 = lunes … 7 = domingo. App: 0 = domingo … 6 = sábado. */
const diaDesdeBase = (d: number): DiaSemana => (d === 7 ? 0 : d) as DiaSemana;
const diaHaciaBase = (d: DiaSemana): number => (d === 0 ? 7 : d);

const UNIDADES: Unidad[] = ['unidad', 'kg', 'litro', 'paquete', 'caja'];
const UNIDADES_CONTENIDO: UnidadContenido[] = ['ml', 'l', 'g', 'kg', 'unidad'];

// ---------- Carga ----------

export async function cargarTodo(): Promise<{ data: AppData; vistas: Vistas }> {
  const [
    productos, proveedores, pp, conteos, recepciones, lineas, stock, visitas, vencimientos, consumo, tieneTelefono,
    fichas, sesiones, devoluciones, devLineas, movimientos, lotes,
  ] = await Promise.all([
    db.select<RowProducto>(
      'productos',
      'select=id,nombre,unidad,perecedero,punto_pedido,ficha_id,presentacion,contenido,unidad_contenido,unidades_por_presentacion&order=nombre.asc',
    ),
    // select=* para que funcione con o sin la columna telefono (supabase/03_pedido_y_demo.sql)
    db.select<RowProveedor>('proveedores', 'select=*&order=nombre.asc'),
    db.select<RowProductoProveedor>('producto_proveedor', 'select=producto_id,proveedor_id'),
    db.select<RowConteo>('conteos', 'select=id,producto_id,cantidad,fecha_hora,fecha_vencimiento,sesion_id,stock_esperado&order=fecha_hora.asc'),
    db.select<RowRecepcion>('recepciones', 'select=*&estado=in.(borrador,confirmada)&order=creada_en.desc'),
    db.select<RowLinea>('recepcion_lineas', 'select=*&order=id.asc'),
    db.select<RowStock>('v_stock_actual', 'select=*'),
    db.select<RowVisita>('v_visitas_proximas', 'select=proveedor_id,nombre,proxima_visita,dias_hasta&order=dias_hasta.asc'),
    db.select<RowVencimiento>('v_vencimientos', 'select=producto_id,nombre,fecha_vencimiento,cantidad,dias_para_vencer&order=fecha_vencimiento.asc'),
    // Base de la cantidad sugerida. Si la vista no está, la app sigue funcionando sin historial.
    db.select<RowConsumo>('v_consumo_historico', 'select=producto_id,consumo,dias&order=hasta.asc').catch(() => [] as RowConsumo[]),
    db.select('proveedores', 'select=telefono&limit=1').then(() => true, () => false),
    // Tablas y vistas de supabase/04_presentaciones_stock_vencimientos.sql
    db.select<RowFicha>('fichas_producto', 'select=id,nombre,archivada&order=nombre.asc'),
    db.select<RowSesion>('sesiones_conteo', 'select=id,tipo,notas,creada_en&order=creada_en.desc'),
    db.select<RowDevolucion>('devoluciones', 'select=*&order=creada_en.desc'),
    db.select<RowDevLinea>('devolucion_lineas', 'select=*&order=id.asc'),
    db.select<RowMovimiento>('movimientos_stock', 'select=*&order=fecha_hora.desc'),
    db.select<RowLote>('v_lotes', 'select=producto_id,fecha_vencimiento,cantidad,recepcion_id,origen,dias_para_vencer,estado&order=fecha_vencimiento.asc.nullslast'),
  ]);

  const lineasDev = new Map<string, RowDevLinea[]>();
  for (const l of devLineas) {
    const arr = lineasDev.get(l.devolucion_id) ?? [];
    arr.push(l);
    lineasDev.set(l.devolucion_id, arr);
  }

  const lineasPor = new Map<string, RowLinea[]>();
  for (const l of lineas) {
    const arr = lineasPor.get(l.recepcion_id) ?? [];
    arr.push(l);
    lineasPor.set(l.recepcion_id, arr);
  }

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
          .filter((l) => l.estado === 'vinculada' && l.producto_id)
          .map((l) => ({
            productoId: l.producto_id as string,
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
            productoId: l.producto_id,
            descripcion: l.descripcion ?? '',
            cantidad: num(l.cantidad),
            ...(l.fecha_vencimiento ? { fechaVencimiento: l.fecha_vencimiento } : {}),
            ...(l.confianza_ia !== null ? { confianza: num(l.confianza_ia) } : {}),
          })),
      });
    }
  }

  const data: AppData = {
    fichas: fichas.map((f): Ficha => ({ id: f.id, nombre: f.nombre, archivada: f.archivada })),
    productos: productos.map((p): Producto => ({
      id: p.id,
      nombre: p.nombre,
      unidad: (UNIDADES as string[]).includes(p.unidad) ? (p.unidad as Unidad) : 'unidad',
      perecedero: p.perecedero,
      puntoDePedido: num(p.punto_pedido),
      fichaId: p.ficha_id,
      presentacion: p.presentacion,
      ...(p.contenido !== null ? { contenido: num(p.contenido) } : {}),
      ...(p.unidad_contenido && (UNIDADES_CONTENIDO as string[]).includes(p.unidad_contenido)
        ? { unidadContenido: p.unidad_contenido as UnidadContenido }
        : {}),
      unidadesPorPresentacion: num(p.unidades_por_presentacion) || 1,
    })),
    proveedores: proveedores.map((p): Proveedor => ({
      id: p.id,
      nombre: p.nombre,
      diasDeVisita: (p.dias_visita ?? []).map(diaDesdeBase),
      ...(p.telefono ? { telefono: p.telefono } : {}),
    })),
    productoProveedor: pp.map((x) => ({ productoId: x.producto_id, proveedorId: x.proveedor_id })),
    conteos: conteos.map((c): Conteo => ({
      id: c.id,
      productoId: c.producto_id,
      cantidad: num(c.cantidad),
      fechaHora: c.fecha_hora,
      ...(c.fecha_vencimiento ? { fechaVencimiento: c.fecha_vencimiento } : {}),
      ...(c.sesion_id ? { sesionId: c.sesion_id } : {}),
      ...(c.stock_esperado !== null ? { stockEsperado: num(c.stock_esperado) } : {}),
    })),
    recepciones: confirmadas,
    borradores,
    sesiones: sesiones.map((x): SesionConteo => ({ id: x.id, tipo: x.tipo, creadaEn: x.creada_en, ...(x.notas ? { notas: x.notas } : {}) })),
    devoluciones: devoluciones.map((d): Devolucion => ({
      id: d.id,
      numero: d.numero,
      proveedorId: d.proveedor_id,
      tipo: d.tipo,
      motivo: d.motivo,
      ...(d.nota ? { nota: d.nota } : {}),
      estado: d.estado,
      respuestaProveedor: d.respuesta_proveedor,
      ...(d.resolucion ? { resolucion: d.resolucion } : {}),
      fecha: d.fecha,
      creadaEn: d.creada_en,
      ...(d.entregada_en ? { entregadaEn: d.entregada_en } : {}),
      ...(d.resuelta_en ? { resueltaEn: d.resuelta_en } : {}),
      lineas: (lineasDev.get(d.id) ?? []).map((l) => ({
        id: l.id,
        productoId: l.producto_id,
        cantidad: num(l.cantidad),
        ...(l.fecha_vencimiento ? { fechaVencimiento: l.fecha_vencimiento } : {}),
        ...(l.recepcion_id ? { recepcionId: l.recepcion_id } : {}),
      })),
    })),
    movimientos: movimientos.map((m): Movimiento => ({
      id: m.id,
      productoId: m.producto_id,
      tipo: m.tipo,
      cantidad: num(m.cantidad),
      ...(m.fecha_vencimiento ? { fechaVencimiento: m.fecha_vencimiento } : {}),
      ...(m.motivo ? { motivo: m.motivo } : {}),
      ...(m.devolucion_linea_id !== null ? { devolucionLineaId: m.devolucion_linea_id } : {}),
      fechaHora: m.fecha_hora,
    })),
  };

  const vistas: Vistas = {
    stock: stock.map((s): FilaStock => ({
      productoId: s.producto_id,
      nombre: s.nombre,
      puntoPedido: num(s.punto_pedido),
      stockActual: numONull(s.stock_actual),
      bajoPuntoPedido: s.bajo_punto_pedido,
      conteoDesactualizado: s.conteo_desactualizado,
      fechaUltimoConteo: s.fecha_ultimo_conteo,
      diasDesdeConteo: s.dias_desde_conteo,
    })),
    visitas: visitas.map((v): FilaVisita => ({ proveedorId: v.proveedor_id, nombre: v.nombre, proximaVisita: v.proxima_visita, diasHasta: v.dias_hasta })),
    vencimientos: vencimientos.map((v): FilaVencimiento => ({
      productoId: v.producto_id,
      nombre: v.nombre,
      fechaVencimiento: v.fecha_vencimiento,
      cantidad: num(v.cantidad),
      diasParaVencer: v.dias_para_vencer,
    })),
    consumo: consumo
      .filter((c) => c.consumo !== null && c.dias !== null)
      .map((c): FilaConsumo => ({ productoId: c.producto_id, consumo: num(c.consumo), dias: num(c.dias) })),
    tieneTelefono,
    lotes: lotes.map((l): Lote => ({
      productoId: l.producto_id,
      fechaVencimiento: l.fecha_vencimiento,
      cantidad: num(l.cantidad),
      recepcionId: l.recepcion_id,
      origen: l.origen,
      diasParaVencer: l.dias_para_vencer,
      estado: l.estado,
    })),
  };

  return { data, vistas };
}

// ---------- Catálogo ----------

/** Nombre completo para mostrar: «Única» no se agrega ("Yerba 1 kg"), el resto sí ("Quilmes 473 ml"). */
export function nombrePresentacion(nombreFicha: string, presentacion: string): string {
  const f = nombreFicha.trim();
  const p = presentacion.trim();
  return !p || p.toLowerCase() === 'única' || p.toLowerCase() === 'unica' ? f : `${f} ${p}`;
}

function filaPresentacion(p: Producto) {
  return {
    nombre: p.nombre.trim(),
    unidad: p.unidad,
    perecedero: p.perecedero,
    punto_pedido: p.puntoDePedido,
    ficha_id: p.fichaId,
    presentacion: p.presentacion.trim(),
    contenido: p.contenido ?? null,
    unidad_contenido: p.unidadContenido ?? null,
    unidades_por_presentacion: p.unidadesPorPresentacion,
  };
}

async function guardarProveedoresDe(productoId: string, proveedorIds: string[]): Promise<void> {
  await db.borrar('producto_proveedor', `producto_id=eq.${productoId}`);
  if (proveedorIds.length > 0) {
    await db.insert('producto_proveedor', proveedorIds.map((proveedor_id) => ({ producto_id: productoId, proveedor_id })));
  }
}

/** Crea o edita UNA presentación (y su ficha si es nueva). `p.fichaId` vacío = ficha nueva con el nombre `nombreFicha`. */
export async function guardarProducto(
  p: Producto,
  esNuevo: boolean,
  proveedorIds?: string[],
  nombreFicha?: string,
): Promise<Producto> {
  let fichaId = p.fichaId;
  if (!fichaId) {
    const [f] = await db.insert<RowFicha>('fichas_producto', { nombre: (nombreFicha ?? p.nombre).trim() });
    fichaId = f.id;
  }
  const fila = filaPresentacion({ ...p, fichaId });
  const [r] = esNuevo
    ? await db.insert<RowProducto>('productos', { id: p.id, ...fila })
    : await db.update<RowProducto>('productos', `id=eq.${p.id}`, fila);
  if (proveedorIds) await guardarProveedoresDe(p.id, proveedorIds);
  return { ...p, id: r?.id ?? p.id, fichaId, nombre: fila.nombre };
}

export interface PresentacionAGuardar {
  producto: Producto;
  esNueva: boolean;
  proveedorIds: string[];
}

/**
 * Guarda una ficha con todas sus presentaciones. Si la ficha cambia de nombre, se actualiza
 * el nombre completo de cada presentación. No borra presentaciones (tienen historial).
 */
export async function guardarFicha(ficha: { id: string | null; nombre: string }, presentaciones: PresentacionAGuardar[]): Promise<string> {
  const nombre = ficha.nombre.trim();
  let fichaId = ficha.id;
  if (fichaId) {
    await db.update('fichas_producto', `id=eq.${fichaId}`, { nombre });
  } else {
    const [f] = await db.insert<RowFicha>('fichas_producto', { nombre });
    fichaId = f.id;
  }
  for (const x of presentaciones) {
    const p: Producto = { ...x.producto, fichaId, nombre: nombrePresentacion(nombre, x.producto.presentacion) };
    const fila = filaPresentacion(p);
    if (x.esNueva) await db.insert('productos', { id: p.id, ...fila });
    else await db.update('productos', `id=eq.${p.id}`, fila);
    await guardarProveedoresDe(p.id, x.proveedorIds);
  }
  return fichaId;
}

/** Mueve una presentación a otra ficha («Mover a otro producto»). Lo valida y registra la base. */
export async function moverPresentacion(productoId: string, fichaDestinoId: string, presentacion?: string): Promise<void> {
  await db.rpc('gondola_mover_presentacion', {
    p_producto: productoId,
    p_ficha_destino: fichaDestinoId,
    p_presentacion: presentacion?.trim() || null,
  });
}

export async function guardarProveedor(p: Proveedor, esNuevo: boolean, productoIds: string[], conTelefono = false): Promise<void> {
  const fila = {
    nombre: p.nombre.trim(),
    dias_visita: [...new Set(p.diasDeVisita.map(diaHaciaBase))].sort((a, b) => a - b),
    // La columna existe solo si se corrió supabase/03_pedido_y_demo.sql
    ...(conTelefono ? { telefono: p.telefono?.trim() || null } : {}),
  };
  if (esNuevo) await db.insert('proveedores', { id: p.id, ...fila });
  else await db.update('proveedores', `id=eq.${p.id}`, fila);
  await db.borrar('producto_proveedor', `proveedor_id=eq.${p.id}`);
  if (productoIds.length > 0) {
    await db.insert('producto_proveedor', productoIds.map((producto_id) => ({ producto_id, proveedor_id: p.id })));
  }
}

// ---------- Conteos ----------

export interface NuevoConteo {
  productoId: string;
  cantidad: number;
  fechaVencimiento?: string;
}

/** Solo agrega conteos: nunca borra ni modifica los anteriores. La fecha y hora la pone la base. */
export async function registrarConteos(conteos: NuevoConteo[]): Promise<void> {
  await db.insert(
    'conteos',
    conteos.map((c) => ({ producto_id: c.productoId, cantidad: c.cantidad, fecha_vencimiento: c.fechaVencimiento ?? null })),
  );
}

export interface LineaConteoStock {
  productoId: string;
  cantidad: number;
  fechaVencimiento?: string;
}

/**
 * Registra un conteo de stock completo (inicial o periódico), sin proveedor.
 * La base guarda la sesión, cada lote contado y el stock que esperaba el sistema
 * (la diferencia queda como ajuste trazable). Nunca sobrescribe conteos anteriores.
 */
export async function registrarConteoStock(tipo: 'inicial' | 'periodico', lineas: LineaConteoStock[], notas?: string): Promise<string> {
  return db.rpc<string>('gondola_registrar_conteo', {
    p_tipo: tipo,
    p_notas: notas?.trim() || null,
    p_lineas: lineas.map((l) => ({ producto_id: l.productoId, cantidad: l.cantidad, fecha_vencimiento: l.fechaVencimiento ?? null })),
  });
}

// ---------- Devoluciones y bajas ----------

export interface NuevaDevolucion {
  proveedorId: string;
  tipo: 'devolucion' | 'cambio';
  motivo: MotivoDevolucion;
  nota?: string;
  lineas: { productoId: string; cantidad: number; fechaVencimiento?: string; recepcionId?: string }[];
}

/** Prepara la devolución y su remito. NO cambia el stock (eso pasa al entregarla). */
export async function prepararDevolucion(d: NuevaDevolucion): Promise<string> {
  const [r] = await db.insert<RowDevolucion>('devoluciones', {
    proveedor_id: d.proveedorId,
    tipo: d.tipo,
    motivo: d.motivo,
    nota: d.nota?.trim() || null,
  });
  await db.insert(
    'devolucion_lineas',
    d.lineas.map((l) => ({
      devolucion_id: r.id,
      producto_id: l.productoId,
      cantidad: l.cantidad,
      fecha_vencimiento: l.fechaVencimiento ?? null,
      recepcion_id: l.recepcionId ?? null,
    })),
  );
  return r.id;
}

/** La mercadería salió del almacén: la base descuenta el stock (una sola vez). */
export async function entregarDevolucion(id: string): Promise<void> {
  const r = await db.update('devoluciones', `id=eq.${id}&estado=eq.preparada`, { estado: 'entregada' });
  if (r.length === 0) throw new ErrorBase('base', '', 'Esta devolución ya no está preparada (puede que se haya actualizado desde otro celular).');
}

/** Registra lo que respondió el proveedor (condición comercial confirmada). */
export async function resolverDevolucion(id: string, respuesta: 'aceptada' | 'rechazada', resolucion: string): Promise<void> {
  const r = await db.update('devoluciones', `id=eq.${id}&estado=eq.entregada`, {
    estado: 'resuelta',
    respuesta_proveedor: respuesta,
    resolucion: resolucion.trim() || null,
  });
  if (r.length === 0) throw new ErrorBase('base', '', 'Esta devolución ya no está pendiente de respuesta.');
}

/** Anula una devolución preparada (el stock nunca cambió). */
export async function cancelarDevolucion(id: string): Promise<void> {
  const r = await db.update('devoluciones', `id=eq.${id}&estado=eq.preparada`, { estado: 'cancelada' });
  if (r.length === 0) throw new ErrorBase('base', '', 'Esta devolución ya no está preparada (puede que se haya actualizado desde otro celular).');
}

/** Baja por descarte (no pasa por el proveedor). Descuenta el stock. */
export async function registrarBaja(b: { productoId: string; cantidad: number; fechaVencimiento?: string | null; motivo: string }): Promise<void> {
  await db.insert('movimientos_stock', {
    producto_id: b.productoId,
    tipo: 'baja',
    cantidad: b.cantidad,
    fecha_vencimiento: b.fechaVencimiento ?? null,
    motivo: b.motivo.trim(),
  });
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
      producto_id: l.productoId,
      descripcion: l.descripcion,
      cantidad: l.cantidad,
      fecha_vencimiento: l.fechaVencimiento ?? null,
      confianza_ia: l.confianza ?? null,
      estado: l.productoId ? 'vinculada' : 'sin_vincular',
    }));
  if (filas.length > 0) await db.insert('recepcion_lineas', filas);
  return r.id;
}

export interface LineaAConfirmar {
  productoId: string | null;
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
  /** Productos que hay que asociar al proveedor (los trajo y no estaban asociados) */
  asociar: string[];
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
      producto_id: l.ignorada ? null : l.productoId,
      descripcion: l.descripcion ?? null,
      cantidad: l.cantidad,
      fecha_vencimiento: l.fechaVencimiento ?? null,
      confianza_ia: l.confianza ?? null,
      estado: l.ignorada ? 'ignorada' : l.productoId ? 'vinculada' : 'sin_vincular',
    }));
  if (filas.length > 0) await db.insert('recepcion_lineas', filas);
  await db.update('recepciones', `id=eq.${id}`, { estado: 'confirmada' });
  await db.insertIgnorandoDuplicados(
    'producto_proveedor',
    d.asociar.map((producto_id) => ({ producto_id, proveedor_id: d.proveedorId })),
    'producto_id,proveedor_id',
  );
}

/** Descarta un borrador (queda registrado como cancelado, no suma al stock). */
export async function cancelarBorrador(id: string): Promise<void> {
  await db.update('recepciones', `id=eq.${id}`, { estado: 'cancelada' });
}

// ---------- Demo ----------

/** Vuelve la base a los datos de ejemplo (función de supabase/03_pedido_y_demo.sql). */
export async function restablecerDemo(): Promise<void> {
  await db.rpc('gondola_restablecer_demo');
}
