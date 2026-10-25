import type { AliasRemito, Presentacion } from '../types';
import { nombreItem, type Item } from './inventario';

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
  presentacionId: string | null;
  confianza: number;
  /** Por qué conviene revisarla aunque se haya encontrado un candidato */
  motivo?: string;
}

/** Texto del remito normalizado para recordarlo como alias. */
export function normalizarAlias(texto: string): string {
  return normalizar(texto).join(' ');
}

/** Tamaño normalizado ("0_5 l", "190 g") de un texto, o null si no tiene. */
export function medidaDe(texto: string): string | null {
  const t = normalizar(texto);
  for (let i = 0; i < t.length - 1; i++) {
    if (/^\d/.test(t[i]) && ['l', 'ml', 'kg', 'g'].includes(t[i + 1])) return `${t[i]} ${t[i + 1]}`;
  }
  return null;
}

/** Tamaño de una presentación: el configurado, o el que figura en su nombre o en el del producto. */
export function medidaPresentacion(it: Item): string | null {
  const x = it.presentacion;
  if (x.contenido !== undefined && x.unidadContenido && x.unidadContenido !== 'u') {
    return medidaDe(`${String(x.contenido).replace('.', ',')} ${x.unidadContenido}`);
  }
  return medidaDe(x.nombre) ?? medidaDe(it.producto.nombre);
}

/** Tope de confianza cuando hay que revisar (queda por debajo de CONFIANZA_ALTA). */
const TOPE_REVISAR = 0.6;

/**
 * Busca la presentación del catálogo que corresponde a una línea del remito.
 *   1. Si ese texto ya se vinculó a mano antes (alias), se usa esa.
 *   2. Se compara el nombre del producto y el TAMAÑO: si el remito dice 500 cc y la
 *      presentación es de 2,25 L, no se vincula con confianza alta.
 *   3. Si el remito no dice tamaño y el producto tiene varias presentaciones, queda para revisar.
 * Da prioridad a las presentaciones que trae el proveedor.
 */
export function vincularLinea(
  descripcion: string,
  items: Item[],
  idsDelProveedor: Set<string> = new Set(),
  alias: AliasRemito[] = [],
): Vinculo {
  const clave = normalizarAlias(descripcion);
  const a = alias.find((x) => x.texto === clave && items.some((it) => it.presentacion.id === x.presentacionId));
  if (a) return { presentacionId: a.presentacionId, confianza: 1 };

  const medidaRemito = medidaDe(descripcion);
  const presentacionesPorProducto = new Map<string, number>();
  for (const it of items) presentacionesPorProducto.set(it.producto.id, (presentacionesPorProducto.get(it.producto.id) ?? 0) + 1);

  let mejor: Vinculo & { base: number } = { presentacionId: null, confianza: 0, base: 0 };
  for (const it of items) {
    const medida = medidaPresentacion(it);
    const nombre = nombreItem(it.producto, it.presentacion);
    let s = similitud(descripcion, medida && !medidaDe(nombre) ? `${nombre} ${medida.replace('_', ',')}` : nombre);
    if (idsDelProveedor.has(it.presentacion.id)) s = Math.min(1, s + 0.05);
    let motivo: string | undefined;
    if (medidaRemito && medida) {
      if (medidaRemito === medida) s = Math.min(1, s + 0.05);
      else if (s < 0.7) {
        // Tamaño distinto y nombre poco parecido: no se sugiere (evita "Fanta" → "Gaseosa naranja")
        s = 0;
      } else {
        s = Math.min(s, TOPE_REVISAR);
        motivo = 'El tamaño del remito no coincide con esta presentación.';
      }
    } else if (!medidaRemito && (presentacionesPorProducto.get(it.producto.id) ?? 0) > 1) {
      s = Math.min(s, TOPE_REVISAR);
      motivo = 'El remito no indica el tamaño y el producto tiene varias presentaciones.';
    }
    if (s > mejor.confianza) mejor = { presentacionId: it.presentacion.id, confianza: s, base: s, ...(motivo ? { motivo } : {}) };
  }
  if (mejor.confianza < CONFIANZA_MINIMA) return { presentacionId: null, confianza: mejor.confianza };
  return { presentacionId: mejor.presentacionId, confianza: Math.round(mejor.confianza * 100) / 100, ...(mejor.motivo ? { motivo: mejor.motivo } : {}) };
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

export type { Presentacion };
