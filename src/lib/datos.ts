// Lectura y escritura de datos en Supabase. Supabase es la ÚNICA fuente de datos.
import { db, subirArchivo } from './supabase';
import { isoDate } from './dates';
import type {
  AppData, Borrador, Conteo, DiaSemana, FilaStock, FilaVencimiento, FilaVisita, LineaBorradorBase,
  Producto, Proveedor, Recepcion, Unidad, Vistas,
} from '../types';

// ---------- Filas tal como vienen de la base ----------

interface RowProducto { id: string; nombre: string; unidad: string; perecedero: boolean; punto_pedido: number | string }
interface RowProveedor { id: string; nombre: string; dias_visita: number[] }
interface RowProductoProveedor { producto_id: string; proveedor_id: string }
interface RowConteo { id: string; producto_id: string; cantidad: number | string; fecha_hora: string; fecha_vencimiento: string | null }
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
interface RowVencimiento { producto_id: string; nombre: string; fecha_vencimiento: string; cantidad: number | string; dias_para_vencer: number }

const num = (v: number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
const numONull = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/** Base: 1 = lunes … 7 = domingo. App: 0 = domingo … 6 = sábado. */
const diaDesdeBase = (d: number): DiaSemana => (d === 7 ? 0 : d) as DiaSemana;
const diaHaciaBase = (d: DiaSemana): number => (d === 0 ? 7 : d);

const UNIDADES: Unidad[] = ['unidad', 'kg', 'litro', 'paquete', 'caja'];

// ---------- Carga ----------

export async function cargarTodo(): Promise<{ data: AppData; vistas: Vistas }> {
  const [productos, proveedores, pp, conteos, recepciones, lineas, stock, visitas, vencimientos] = await Promise.all([
    db.select<RowProducto>('productos', 'select=id,nombre,unidad,perecedero,punto_pedido&order=nombre.asc'),
    db.select<RowProveedor>('proveedores', 'select=id,nombre,dias_visita&order=nombre.asc'),
    db.select<RowProductoProveedor>('producto_proveedor', 'select=producto_id,proveedor_id'),
    db.select<RowConteo>('conteos', 'select=id,producto_id,cantidad,fecha_hora,fecha_vencimiento&order=fecha_hora.asc'),
    db.select<RowRecepcion>('recepciones', 'select=*&estado=in.(borrador,confirmada)&order=creada_en.desc'),
    db.select<RowLinea>('recepcion_lineas', 'select=*&order=id.asc'),
    db.select<RowStock>('v_stock_actual', 'select=*'),
    db.select<RowVisita>('v_visitas_proximas', 'select=proveedor_id,nombre,proxima_visita,dias_hasta&order=dias_hasta.asc'),
    db.select<RowVencimiento>('v_vencimientos', 'select=producto_id,nombre,fecha_vencimiento,cantidad,dias_para_vencer&order=fecha_vencimiento.asc'),
  ]);

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
    productos: productos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      unidad: (UNIDADES as string[]).includes(p.unidad) ? (p.unidad as Unidad) : 'unidad',
      perecedero: p.perecedero,
      puntoDePedido: num(p.punto_pedido),
    })),
    proveedores: proveedores.map((p) => ({ id: p.id, nombre: p.nombre, diasDeVisita: (p.dias_visita ?? []).map(diaDesdeBase) })),
    productoProveedor: pp.map((x) => ({ productoId: x.producto_id, proveedorId: x.proveedor_id })),
    conteos: conteos.map((c): Conteo => ({
      id: c.id,
      productoId: c.producto_id,
      cantidad: num(c.cantidad),
      fechaHora: c.fecha_hora,
      ...(c.fecha_vencimiento ? { fechaVencimiento: c.fecha_vencimiento } : {}),
    })),
    recepciones: confirmadas,
    borradores,
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
  };

  return { data, vistas };
}

// ---------- Catálogo ----------

export async function guardarProducto(p: Producto, esNuevo: boolean, proveedorIds?: string[]): Promise<Producto> {
  const fila = { nombre: p.nombre.trim(), unidad: p.unidad, perecedero: p.perecedero, punto_pedido: p.puntoDePedido };
  const [r] = esNuevo
    ? await db.insert<RowProducto>('productos', { id: p.id, ...fila })
    : await db.update<RowProducto>('productos', `id=eq.${p.id}`, fila);
  if (proveedorIds) {
    await db.borrar('producto_proveedor', `producto_id=eq.${p.id}`);
    if (proveedorIds.length > 0) {
      await db.insert('producto_proveedor', proveedorIds.map((proveedor_id) => ({ producto_id: p.id, proveedor_id })));
    }
  }
  return { ...p, id: r?.id ?? p.id, nombre: fila.nombre };
}

export async function guardarProveedor(p: Proveedor, esNuevo: boolean, productoIds: string[]): Promise<void> {
  const fila = { nombre: p.nombre.trim(), dias_visita: [...new Set(p.diasDeVisita.map(diaHaciaBase))].sort((a, b) => a - b) };
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
