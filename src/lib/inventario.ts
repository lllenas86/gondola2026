// Lógica de inventario compartida por todas las pantallas (una sola fuente de reglas).
//
//   Stock registrado = último conteo + recepciones confirmadas después
//                      − devoluciones confirmadas después − bajas después
//   (igual que la vista v_stock_presentacion de la base).
//
// No hay sistema de ventas: lo que se vendió entre dos conteos recién aparece en el
// conteo siguiente. Por eso se distinguen:
//   - stock REGISTRADO (lo que dicen los registros, sin restar ventas)
//   - consumo ESTIMADO (diferencia entre conteos, ver ritmoConsumo)
import type {
  AppData, Conteo, FilaConsumo, Presentacion, Producto, Proveedor, Vistas,
} from '../types';
import { diffDays, isoDate, parseIsoDate } from './dates';

export interface Item {
  producto: Producto;
  presentacion: Presentacion;
}

/** "Coca-Cola 2,25 L". Si la presentación es la "Única" migrada, solo el nombre del producto. */
export function nombreItem(producto: Producto | undefined, presentacion: Presentacion | undefined): string {
  if (!presentacion) return producto?.nombre ?? 'Producto eliminado';
  const base = producto?.nombre ?? 'Producto eliminado';
  return presentacion.nombre.trim().toLowerCase() === 'única' ? base : `${base} ${presentacion.nombre}`;
}

export function itemDe(data: AppData, presentacionId: string): Item | null {
  const presentacion = data.presentaciones.find((x) => x.id === presentacionId);
  if (!presentacion) return null;
  const producto = data.productos.find((p) => p.id === presentacion.productoId);
  return producto ? { producto, presentacion } : null;
}

export function nombreDe(data: AppData, presentacionId: string): string {
  const it = itemDe(data, presentacionId);
  return it ? nombreItem(it.producto, it.presentacion) : 'Producto eliminado';
}

const porNombre = (a: Item, b: Item) =>
  a.producto.nombre.localeCompare(b.producto.nombre, 'es') || a.presentacion.nombre.localeCompare(b.presentacion.nombre, 'es', { numeric: true });

/** Todas las presentaciones activas (de productos activos), ordenadas por producto. */
export function itemsActivos(data: AppData): Item[] {
  const productos = new Map(data.productos.map((p) => [p.id, p]));
  return data.presentaciones
    .filter((x) => x.activa && productos.get(x.productoId)?.activo !== false)
    .map((x) => ({ presentacion: x, producto: productos.get(x.productoId) as Producto }))
    .filter((it) => !!it.producto)
    .sort(porNombre);
}

export function presentacionesDe(data: AppData, productoId: string): Presentacion[] {
  return data.presentaciones
    .filter((x) => x.productoId === productoId)
    .sort((a, b) => Number(b.activa) - Number(a.activa) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }));
}

export function itemsDeProveedor(data: AppData, proveedorId: string): Item[] {
  const ids = new Set(data.presentacionProveedor.filter((pp) => pp.proveedorId === proveedorId).map((pp) => pp.presentacionId));
  return itemsActivos(data).filter((it) => ids.has(it.presentacion.id));
}

export function proveedoresDe(data: AppData, presentacionId: string): Proveedor[] {
  const ids = new Set(data.presentacionProveedor.filter((pp) => pp.presentacionId === presentacionId).map((pp) => pp.proveedorId));
  return data.proveedores.filter((p) => ids.has(p.id));
}

/** Proveedores de cualquiera de las presentaciones de un producto. */
export function proveedoresDeProducto(data: AppData, productoId: string): Proveedor[] {
  const pres = new Set(presentacionesDe(data, productoId).map((x) => x.id));
  const ids = new Set(data.presentacionProveedor.filter((pp) => pres.has(pp.presentacionId)).map((pp) => pp.proveedorId));
  return data.proveedores.filter((p) => ids.has(p.id));
}

export function ultimoConteo(data: AppData, presentacionId: string): Conteo | undefined {
  let u: Conteo | undefined;
  for (const c of data.conteos) {
    if (c.presentacionId !== presentacionId) continue;
    if (!u || c.fechaHora > u.fechaHora) u = c;
  }
  return u;
}

// ---------- Lotes ----------

export interface Lote {
  /** null = sin fecha de vencimiento cargada */
  fechaVencimiento: string | null;
  cantidad: number;
  origen: 'conteo' | 'recepcion';
  /** Momento desde el que está en el almacén (conteo o confirmación de la recepción) */
  desde: string;
  recepcionId?: string;
  proveedorId?: string;
  /** Conteo viejo con una sola fecha para todas las unidades: puede no aplicar a todas */
  fechaUnica?: boolean;
}

export interface Movimiento {
  tipo: 'recepcion' | 'devolucion' | 'baja';
  momento: string;
  cantidad: number;
  fechaVencimiento?: string;
  recepcionId?: string;
  proveedorId?: string;
  /** id de la devolución o la baja */
  refId: string;
}

export interface EstadoInventario {
  /** null si nunca se contó ni se movió */
  stock: number | null;
  ultimoConteo?: Conteo;
  entradas: number;
  salidas: number;
  /** Lotes con existencia registrada (cantidad > 0), del que vence antes al que vence después */
  lotes: Lote[];
  movimientos: Movimiento[];
}

/** Movimientos de una presentación (recepciones, devoluciones confirmadas y bajas), en orden. */
export function movimientosDe(data: AppData, presentacionId: string): Movimiento[] {
  const m: Movimiento[] = [];
  for (const r of data.recepciones) {
    for (const l of r.lineas) {
      if (l.presentacionId !== presentacionId) continue;
      m.push({ tipo: 'recepcion', momento: r.registradaEn, cantidad: l.cantidad, fechaVencimiento: l.fechaVencimiento, recepcionId: r.id, proveedorId: r.proveedorId, refId: r.id });
    }
  }
  for (const d of data.devoluciones) {
    if ((d.estado !== 'confirmada' && d.estado !== 'resuelta') || !d.confirmadaEn) continue;
    for (const l of d.lineas) {
      if (l.presentacionId !== presentacionId) continue;
      m.push({ tipo: 'devolucion', momento: d.confirmadaEn, cantidad: l.cantidad, fechaVencimiento: l.fechaVencimiento, recepcionId: l.recepcionId, proveedorId: d.proveedorId, refId: d.id });
    }
  }
  for (const b of data.bajas) {
    if (b.presentacionId !== presentacionId) continue;
    m.push({ tipo: 'baja', momento: b.registradaEn, cantidad: b.cantidad, fechaVencimiento: b.fechaVencimiento, refId: b.id });
  }
  return m.sort((a, b) => a.momento.localeCompare(b.momento));
}

const ordenFefo = (a: Lote, b: Lote) =>
  (a.fechaVencimiento ?? '9999-12-31').localeCompare(b.fechaVencimiento ?? '9999-12-31') || a.desde.localeCompare(b.desde);

/** Descuenta una cantidad de los lotes: primero el lote indicado, después lo que vence antes. */
export function descontarDeLotes(lotes: Lote[], cantidad: number, fecha?: string | null, recepcionId?: string): number {
  let resta = cantidad;
  const preferidos = lotes.filter((l) => l.cantidad > 0 && fecha !== undefined && l.fechaVencimiento === (fecha ?? null))
    .sort((a, b) => Number(b.recepcionId === recepcionId) - Number(a.recepcionId === recepcionId));
  for (const l of [...preferidos, ...[...lotes].sort(ordenFefo)]) {
    if (resta <= 0) break;
    const t = Math.min(l.cantidad, resta);
    l.cantidad = redondear(l.cantidad - t);
    resta = redondear(resta - t);
  }
  return resta;
}

/** Stock registrado y lotes de una presentación, calculados desde el historial. */
export function estadoInventario(data: AppData, presentacionId: string): EstadoInventario {
  const u = ultimoConteo(data, presentacionId);
  const desde = u?.fechaHora ?? '';
  const lotes: Lote[] = [];
  if (u) {
    if (u.lotes && u.lotes.length > 0) {
      let conFecha = 0;
      for (const l of u.lotes) {
        if (l.cantidad <= 0) continue;
        lotes.push({ fechaVencimiento: l.fechaVencimiento, cantidad: l.cantidad, origen: 'conteo', desde });
        conFecha += l.cantidad;
      }
      if (u.cantidad - conFecha > 0) lotes.push({ fechaVencimiento: null, cantidad: redondear(u.cantidad - conFecha), origen: 'conteo', desde });
    } else if (u.cantidad > 0) {
      lotes.push({ fechaVencimiento: u.fechaVencimiento ?? null, cantidad: u.cantidad, origen: 'conteo', desde, ...(u.fechaVencimiento ? { fechaUnica: true } : {}) });
    }
  }
  const movimientos = movimientosDe(data, presentacionId).filter((m) => m.momento > desde);
  let entradas = 0;
  let salidas = 0;
  for (const m of movimientos) {
    if (m.tipo === 'recepcion') {
      entradas += m.cantidad;
      lotes.push({ fechaVencimiento: m.fechaVencimiento ?? null, cantidad: m.cantidad, origen: 'recepcion', desde: m.momento, recepcionId: m.recepcionId, proveedorId: m.proveedorId });
    } else {
      salidas += m.cantidad;
      descontarDeLotes(lotes, m.cantidad, m.fechaVencimiento ?? null, m.recepcionId);
    }
  }
  const hayDatos = !!u || movimientos.length > 0;
  return {
    stock: hayDatos ? redondear((u?.cantidad ?? 0) + entradas - salidas) : null,
    ...(u ? { ultimoConteo: u } : {}),
    entradas: redondear(entradas),
    salidas: redondear(salidas),
    lotes: lotes.filter((l) => l.cantidad > 0).sort(ordenFefo),
    movimientos,
  };
}

/** Stock registrado: el de la vista de la base si está, si no el calculado. */
export function stockDe(data: AppData, vistas: Vistas, presentacionId: string): number | null {
  const fila = vistas.stock.find((f) => f.presentacionId === presentacionId);
  return fila ? fila.stockActual : estadoInventario(data, presentacionId).stock;
}

export function bajoPuntoDePedido(stock: number | null, presentacion: Presentacion): boolean {
  return stock !== null && stock <= presentacion.puntoDePedido;
}

/** Días sin contar a partir de los cuales una presentación se marca como desactualizada. */
export const DIAS_SIN_CONTEO = 7;

export function diasDesdeConteo(c: Conteo | undefined, ahora: Date = new Date()): number | null {
  return c ? diffDays(new Date(c.fechaHora), ahora) : null;
}

// ---------- Consumo estimado ----------

/** Cuántos períodos entre conteos se usan como máximo para el promedio. */
export const PERIODOS_CONSUMO = 6;

export interface RitmoConsumo {
  /** Unidades por día (estimado) */
  porDia: number;
  /** Ventana usada: del primer al último conteo considerado */
  desde: string;
  hasta: string;
  dias: number;
  periodos: number;
  /** Períodos descartados por consumo negativo (faltó registrar una recepción) */
  descartados: number;
}

/**
 * Consumo promedio por día entre conteos (vista v_consumo_presentacion). null si no hay
 * al menos un período útil: nunca se inventa un ritmo.
 */
export function ritmoConsumo(filas: FilaConsumo[], presentacionId: string): RitmoConsumo | null {
  const todas = filas.filter((f) => f.presentacionId === presentacionId && f.dias > 0).slice(-PERIODOS_CONSUMO);
  const utiles = todas.filter((f) => f.consumo >= 0);
  const dias = utiles.reduce((a, f) => a + f.dias, 0);
  if (utiles.length === 0 || dias <= 0) return null;
  return {
    porDia: utiles.reduce((a, f) => a + f.consumo, 0) / dias,
    desde: utiles[0].desde,
    hasta: utiles[utiles.length - 1].hasta,
    dias: redondear(dias),
    periodos: utiles.length,
    descartados: todas.length - utiles.length,
  };
}

// ---------- Vencimientos ----------

export type EstadoLote = 'vencido' | 'vence_pronto' | 'vence_semana' | 'ok' | 'sin_fecha';

export const DIAS_ALERTA_VENCIMIENTO = 3;
export const DIAS_AVISO_VENCIMIENTO = 7;

export function estadoLote(fecha: string | null, ahora: Date = new Date()): { estado: EstadoLote; dias: number | null } {
  if (!fecha) return { estado: 'sin_fecha', dias: null };
  const dias = diffDays(ahora, parseIsoDate(fecha));
  if (dias < 0) return { estado: 'vencido', dias };
  if (dias <= DIAS_ALERTA_VENCIMIENTO) return { estado: 'vence_pronto', dias };
  if (dias <= DIAS_AVISO_VENCIMIENTO) return { estado: 'vence_semana', dias };
  return { estado: 'ok', dias };
}

export function textoVence(dias: number | null): string {
  if (dias === null) return 'Sin fecha';
  if (dias < -1) return `Venció hace ${-dias} días`;
  if (dias === -1) return 'Venció ayer';
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  return `Vence en ${dias} días`;
}

/** Valor a costo de referencia. null si la presentación no tiene costo: no se inventa. */
export function valorizar(cantidad: number, costo: number | undefined): number | null {
  return costo === undefined ? null : Math.round(cantidad * costo);
}

export const formatoPesos = (n: number) => n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });

export function formatoCantidad(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

/** "u.", "kg", "paq." para mostrar al lado de una cantidad. */
export function abreviaturaUnidad(u: Presentacion['unidadStock']): string {
  return { unidad: 'u.', kg: 'kg', litro: 'L', paquete: 'paq.', caja: 'cajas' }[u];
}

export function hoyIso(ahora: Date = new Date()): string {
  return isoDate(ahora);
}

export function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}
