import type { AppData, Conteo, DiaSemana, Ficha, Producto, Proveedor } from '../types';
import { addDays, diffDays, isoDate, parseIsoDate } from './dates';

/** Días sin contar a partir de los cuales un producto se marca como desactualizado. */
export const DIAS_SIN_CONTEO = 7;

export interface StockInfo {
  /** null si nunca se contó ni se recibió */
  stock: number | null;
  ultimoConteo?: Conteo;
  /** Unidades recibidas después del último conteo */
  recibidoDespues: number;
  bajoPuntoDePedido: boolean;
  /** true si no hay conteo o el último tiene más de DIAS_SIN_CONTEO días */
  sinConteoReciente: boolean;
  diasDesdeConteo: number | null;
  /** Vencimiento más próximo conocido (último conteo o recepciones posteriores), AAAA-MM-DD */
  proximoVencimiento?: string;
}

/** Filas del último conteo de una presentación (una por lote si se contó en varios lotes). */
export function ultimoConteoDe(data: AppData, productoId: string): Conteo[] {
  let max = '';
  for (const c of data.conteos) if (c.productoId === productoId && c.fechaHora > max) max = c.fechaHora;
  if (!max) return [];
  return data.conteos.filter((c) => c.productoId === productoId && c.fechaHora === max);
}

/**
 * Stock actual = último conteo (suma de sus lotes) + recepciones registradas después
 * − salidas (devoluciones entregadas y bajas) registradas después.
 * Es la misma regla que la vista v_stock_actual de la base.
 */
export function calcularStock(data: AppData, producto: Producto, ahora: Date = new Date()): StockInfo {
  const filas = ultimoConteoDe(data, producto.id);
  const ultimoConteo: Conteo | undefined = filas.length > 0
    ? { ...filas[0], cantidad: redondear(filas.reduce((a, c) => a + c.cantidad, 0)) }
    : undefined;

  const desde = ultimoConteo?.fechaHora ?? '';
  let recibidoDespues = 0;
  const vencimientos: string[] = [];
  for (const c of filas) if (c.fechaVencimiento) vencimientos.push(c.fechaVencimiento);

  for (const r of data.recepciones) {
    if (r.registradaEn <= desde) continue;
    for (const l of r.lineas) {
      if (l.productoId !== producto.id) continue;
      recibidoDespues += l.cantidad;
      if (l.fechaVencimiento) vencimientos.push(l.fechaVencimiento);
    }
  }
  let salidas = 0;
  for (const m of data.movimientos ?? []) {
    if (m.productoId === producto.id && m.fechaHora > desde) salidas += m.cantidad;
  }

  const hayDatos = !!ultimoConteo || recibidoDespues > 0 || salidas > 0;
  const stock = hayDatos ? redondear((ultimoConteo?.cantidad ?? 0) + recibidoDespues - salidas) : null;
  const diasDesdeConteo = ultimoConteo ? diffDays(new Date(ultimoConteo.fechaHora), ahora) : null;
  const hoy = isoDate(ahora);
  const proximoVencimiento = vencimientos.filter((v) => v >= hoy).sort()[0];

  return {
    stock,
    ultimoConteo,
    recibidoDespues,
    bajoPuntoDePedido: stock !== null && stock <= producto.puntoDePedido,
    sinConteoReciente: diasDesdeConteo === null || diasDesdeConteo > DIAS_SIN_CONTEO,
    diasDesdeConteo,
    proximoVencimiento,
  };
}

export interface FichaConPresentaciones {
  ficha: Ficha;
  presentaciones: Producto[];
}

/** Fichas con sus presentaciones, ordenadas por nombre. Las fichas archivadas (vacías) no se listan. */
export function fichasConPresentaciones(data: AppData): FichaConPresentaciones[] {
  const por = new Map<string, Producto[]>();
  for (const p of data.productos) {
    const arr = por.get(p.fichaId) ?? [];
    arr.push(p);
    por.set(p.fichaId, arr);
  }
  const out: FichaConPresentaciones[] = [];
  for (const f of data.fichas) {
    const ps = por.get(f.id);
    if (!ps || ps.length === 0) continue;
    ps.sort(ordenPresentaciones);
    out.push({ ficha: f, presentaciones: ps });
  }
  return out.sort((a, b) => a.ficha.nombre.localeCompare(b.ficha.nombre, 'es'));
}

/** Tamaño comparable (ml o g) para ordenar presentaciones de menor a mayor. */
function tamanoBase(p: Producto): number {
  if (!p.contenido || !p.unidadContenido) return 0;
  const x = p.unidadContenido === 'l' || p.unidadContenido === 'kg' ? p.contenido * 1000 : p.contenido;
  return x * (p.unidadesPorPresentacion || 1);
}

export function ordenPresentaciones(a: Producto, b: Producto): number {
  return tamanoBase(a) - tamanoBase(b) || a.presentacion.localeCompare(b.presentacion, 'es');
}

/** Texto corto de la presentación: "473 ml · pack x6". Vacío para «Única» sin datos. */
export function detallePresentacion(p: Producto): string {
  const partes: string[] = [];
  if (p.contenido && p.unidadContenido) partes.push(`${String(p.contenido).replace('.', ',')} ${p.unidadContenido}`);
  if (p.unidadesPorPresentacion !== 1) partes.push(`equivale a ${String(p.unidadesPorPresentacion).replace('.', ',')} u.`);
  return partes.join(' · ');
}

export function diasParaVencer(fecha: string, ahora: Date = new Date()): number {
  return diffDays(ahora, parseIsoDate(fecha));
}

export function productosDeProveedor(data: AppData, proveedorId: string): Producto[] {
  const ids = new Set(data.productoProveedor.filter((pp) => pp.proveedorId === proveedorId).map((pp) => pp.productoId));
  return data.productos.filter((p) => ids.has(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}

export function proveedoresDeProducto(data: AppData, productoId: string): Proveedor[] {
  const ids = new Set(data.productoProveedor.filter((pp) => pp.productoId === productoId).map((pp) => pp.proveedorId));
  return data.proveedores.filter((p) => ids.has(p.id));
}

export function visitaEl(proveedor: Proveedor, fecha: Date): boolean {
  return proveedor.diasDeVisita.includes(fecha.getDay() as DiaSemana);
}

/** Próxima fecha de visita a partir de `desde` (incluido). */
export function proximaVisita(proveedor: Proveedor, desde: Date): Date | null {
  if (proveedor.diasDeVisita.length === 0) return null;
  for (let i = 0; i < 7; i++) {
    const d = addDays(desde, i);
    if (visitaEl(proveedor, d)) return d;
  }
  return null;
}

function redondear(n: number): number {
  return Math.round(n * 1000) / 1000;
}
