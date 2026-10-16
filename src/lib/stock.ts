import type { AppData, Conteo, DiaSemana, Producto, Proveedor } from '../types';
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

/**
 * Stock actual = último conteo + recepciones registradas después de ese conteo.
 * Si nunca se contó, se toman todas las recepciones.
 */
export function calcularStock(data: AppData, producto: Producto, ahora: Date = new Date()): StockInfo {
  let ultimoConteo: Conteo | undefined;
  for (const c of data.conteos) {
    if (c.productoId !== producto.id) continue;
    if (!ultimoConteo || c.fechaHora > ultimoConteo.fechaHora) ultimoConteo = c;
  }

  const desde = ultimoConteo?.fechaHora ?? '';
  let recibidoDespues = 0;
  const vencimientos: string[] = [];
  if (ultimoConteo?.fechaVencimiento) vencimientos.push(ultimoConteo.fechaVencimiento);

  for (const r of data.recepciones) {
    if (r.registradaEn <= desde) continue;
    for (const l of r.lineas) {
      if (l.productoId !== producto.id) continue;
      recibidoDespues += l.cantidad;
      if (l.fechaVencimiento) vencimientos.push(l.fechaVencimiento);
    }
  }

  const hayDatos = !!ultimoConteo || recibidoDespues > 0;
  const stock = hayDatos ? redondear((ultimoConteo?.cantidad ?? 0) + recibidoDespues) : null;
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
