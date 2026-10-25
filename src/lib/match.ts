import type { Producto } from '../types';

/** Umbrales de confianza para vincular una línea del remito con el catálogo. */
export const CONFIANZA_ALTA = 0.75;
export const CONFIANZA_MINIMA = 0.4;

const ABREVIATURAS: Record<string, string> = {
  beb: 'bebible',
  min: 'mineral',
  ent: 'entera',
  desc: 'descremada',
  lt: 'l',
  lts: 'l',
  litro: 'l',
  litros: 'l',
  cc: 'ml',
  kgs: 'kg',
  gr: 'g',
  grs: 'g',
  x: '',
  un: '',
  u: '',
  s: '',
  c: '',
  gas: '',
  sachet: '',
};

/** Pasa "1500cc" a "1,5 l" y "1000 g" a "1 kg" para comparar tamaños. */
function normalizarMedidas(s: string): string {
  return s
    .replace(/(\d+)[.,](\d+)/g, '$1_$2')
    .replace(/(\d+(?:_\d+)?)\s*(cc|ml)\b/g, (_, n: string) => `${(parseFloat(n.replace('_', '.')) / 1000).toString().replace('.', '_')} l`)
    .replace(/(\d+(?:_\d+)?)\s*(g|gr|grs)\b/g, (_, n: string) => {
      const v = parseFloat(n.replace('_', '.'));
      return v >= 1000 ? `${(v / 1000).toString().replace('.', '_')} kg` : `${n} g`;
    })
    .replace(/(\d+(?:_\d+)?)(l|lt|lts|kg|g)\b/g, '$1 $2');
}

export function normalizar(texto: string): string[] {
  const base = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\/-]/g, ' ');
  return normalizarMedidas(base)
    .replace(/[^a-z0-9_ ]/g, ' ')
    .split(/\s+/)
    .map((t) => (t in ABREVIATURAS ? ABREVIATURAS[t] : t))
    .filter((t) => t.length > 0);
}

const esMedida = (t: string) => /^\d/.test(t) || ['l', 'ml', 'kg', 'g'].includes(t);

/**
 * Similitud entre 0 y 1. Compara las palabras (también por prefijo, para
 * abreviaturas como "yog" → "yogur") y pesa más las del producto del catálogo.
 * Los tamaños ("2,25 l") no alcanzan solos para vincular: si el tamaño no
 * coincide, baja la similitud.
 */
export function similitud(descripcion: string, nombreProducto: string): number {
  const ta = normalizar(descripcion);
  const tb = normalizar(nombreProducto);
  const a = ta.filter((t) => !esMedida(t));
  const b = tb.filter((t) => !esMedida(t));
  if (a.length === 0 || b.length === 0) return 0;

  const coincide = (x: string, y: string) =>
    x === y || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x)));

  const enB = b.filter((t) => a.some((u) => coincide(u, t))).length;
  if (enB === 0) return 0;
  const enA = a.filter((t) => b.some((u) => coincide(u, t))).length;
  const cobertura = enB / b.length; // ¿están las palabras del producto?
  const precision = enA / a.length; // ¿sobran palabras en el remito?
  let s = 0.7 * cobertura + 0.3 * precision;

  const medidaA = ta.filter((t) => /^\d/.test(t)).join(' ');
  const medidaB = tb.filter((t) => /^\d/.test(t)).join(' ');
  if (medidaA && medidaB && medidaA !== medidaB) s *= 0.75;
  return Math.round(s * 100) / 100;
}

export interface Vinculo {
  productoId: string | null;
  confianza: number;
}

/** Busca el producto del catálogo más parecido. Da prioridad a los productos del proveedor. */
export function vincularLinea(descripcion: string, productos: Producto[], idsDelProveedor: Set<string> = new Set()): Vinculo {
  let mejor: Vinculo = { productoId: null, confianza: 0 };
  for (const p of productos) {
    let s = similitud(descripcion, p.nombre);
    if (idsDelProveedor.has(p.id)) s = Math.min(1, s + 0.05);
    if (s > mejor.confianza) mejor = { productoId: p.id, confianza: s };
  }
  if (mejor.confianza < CONFIANZA_MINIMA) return { productoId: null, confianza: mejor.confianza };
  return mejor;
}

/** Proveedor más parecido al nombre leído en el remito. */
export function vincularProveedor(nombre: string, proveedores: { id: string; nombre: string }[]): string | null {
  let mejor: { id: string | null; s: number } = { id: null, s: 0 };
  for (const p of proveedores) {
    const s = similitud(nombre, p.nombre);
    if (s > mejor.s) mejor = { id: p.id, s };
  }
  return mejor.s >= 0.5 ? mejor.id : null;
}
