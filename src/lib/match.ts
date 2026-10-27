import type { AliasRemito, Presentacion } from '../types';
import { nombreItem, type Item } from './inventario';

/** Umbrales de confianza para vincular una línea del remito con el catálogo. */
export const CONFIANZA_ALTA = 0.75;
export const CONFIANZA_MINIMA = 0.4;

/** Abreviaturas habituales de los remitos (palabras, no medidas). */
const ABREVIATURAS: Record<string, string> = {
  beb: 'bebible',
  min: 'mineral',
  ent: 'entera',
  desc: 'descremada',
};

/** Palabras que no identifican al producto (conectores, envases, "x 200 g"). */
const VACIAS = new Set(['x', 'de', 'del', 'la', 'el', 'los', 'las', 'con', 'en', 'y', 'por', 'un', 'una', 'u', 's', 'c',
  'unidad', 'unidades', 'und', 'uni', 'gas', 'sachet']);

/** Unidades escritas de distintas formas → g, kg, ml o l. */
const UNIDADES: [RegExp, 'g' | 'kg' | 'ml' | 'l'][] = [
  [/^(kilogramos?|kilos?|kgs?|kg)$/, 'kg'],
  [/^(gramos?|grms?|grs?|gr|g)$/, 'g'],
  [/^(mililitros?|mls?|ml|cm3|cc)$/, 'ml'],
  [/^(litros?|lts?|lt|l)$/, 'l'],
];
const RE_MEDIDA = /(\d+(?:[.,]\d+)?)\s*(kilogramos?|kilos?|kgs?|gramos?|grms?|grs?|gr|mililitros?|mls?|ml|cm3|cc|litros?|lts?|lt|kg|g|l)\.?(?![a-z0-9])/g;

const conGuion = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', '_');

/**
 * Lleva un tamaño a una forma única para comparar: 200 gr = 200 gramos = 200 g = 0,2 kg → "200 g";
 * 500 cc = 500 ml = 0,5 l → "0_5 l"; 1000 g = 1 kg → "1 kg".
 */
function medidaCanonica(numero: string, unidad: string): string {
  const u = UNIDADES.find(([re]) => re.test(unidad))?.[1];
  const v = parseFloat(numero.replace(',', '.'));
  if (!u || !Number.isFinite(v)) return `${numero} ${unidad}`;
  if (u === 'g' || u === 'kg') {
    const gramos = u === 'kg' ? v * 1000 : v;
    return gramos >= 1000 ? `${conGuion(gramos / 1000)} kg` : `${conGuion(gramos)} g`;
  }
  const litros = u === 'ml' ? v / 1000 : v;
  return `${conGuion(litros)} l`;
}

function normalizarMedidas(s: string): string {
  return s.replace(/\bx(?=\d)/g, 'x ').replace(RE_MEDIDA, (_, n: string, u: string) => ` ${medidaCanonica(n, u)} `);
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

/** Palabras que identifican al producto: sin tamaños ni conectores. */
export function palabrasClave(texto: string): string[] {
  return normalizar(texto).filter((t) => !esMedida(t) && !VACIAS.has(t));
}

const coincide = (x: string, y: string) =>
  x === y || (x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x)));

interface Comparacion {
  /** 0 a 1: palabras del catálogo presentes (70 %) y palabras del remito explicadas (30 %) */
  s: number;
  /** Palabras del remito que el catálogo no tiene (marca o variedad distinta, o ruido) */
  sobran: string[];
  /** Palabras del catálogo que el remito no menciona (por ejemplo, la marca) */
  faltan: string[];
}

function comparar(descripcion: string, nombreCatalogo: string): Comparacion {
  const a = palabrasClave(descripcion);
  const b = palabrasClave(nombreCatalogo);
  if (a.length === 0 || b.length === 0) return { s: 0, sobran: a, faltan: b };
  const enB = b.filter((t) => a.some((u) => coincide(u, t)));
  if (enB.length === 0) return { s: 0, sobran: a, faltan: b };
  const enA = a.filter((t) => b.some((u) => coincide(u, t)));
  return {
    s: Math.round((0.7 * (enB.length / b.length) + 0.3 * (enA.length / a.length)) * 100) / 100,
    sobran: a.filter((t) => !enA.includes(t)),
    faltan: b.filter((t) => !enB.includes(t)),
  };
}

/**
 * Similitud entre 0 y 1 de los nombres (sin tamaños). Compara las palabras (también por
 * prefijo, para abreviaturas como "yog" → "yogur") y pesa más las del catálogo.
 * Si los dos tienen tamaño y no coincide, baja.
 */
export function similitud(descripcion: string, nombreProducto: string): number {
  let s = comparar(descripcion, nombreProducto).s;
  const ma = medidaDe(descripcion);
  const mb = medidaDe(nombreProducto);
  if (ma && mb && ma !== mb) s *= 0.75;
  return Math.round(s * 100) / 100;
}

export interface Vinculo {
  presentacionId: string | null;
  confianza: number;
  /** Por qué conviene revisarla aunque se haya encontrado un candidato */
  motivo?: string;
  /** Coincidencia ambigua: presentaciones posibles (la persona tiene que elegir) */
  opciones?: string[];
  /** El producto existe pero no con este tamaño: se puede agregar la presentación a esta ficha */
  productoSugeridoId?: string;
  /** Tamaño leído en el remito, normalizado ("200 g") */
  medida?: string;
}

/** Texto del remito normalizado para recordarlo como alias. */
export function normalizarAlias(texto: string): string {
  return normalizar(texto).join(' ');
}

/** Tamaño normalizado ("0_5 l", "200 g") de un texto, o null si no tiene. */
export function medidaDe(texto: string): string | null {
  const t = normalizar(texto);
  for (let i = 0; i < t.length - 1; i++) {
    if (/^\d/.test(t[i]) && ['l', 'ml', 'kg', 'g'].includes(t[i + 1])) return `${t[i]} ${t[i + 1]}`;
  }
  return null;
}

/** Tamaño legible para mostrar o precargar ("200 g", "0,5 l"). */
export function medidaLegible(medida: string): string {
  return medida.replace('_', ',');
}

/** El texto del remito sin el tamaño ni la "x": "MANTECA PEPITO X 200 GR" → "MANTECA PEPITO". */
export function sinMedida(texto: string): string {
  return texto
    .replace(/\bx(?=\s*\d)/gi, ' ')
    .replace(new RegExp(RE_MEDIDA.source, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mismo producto escrito de otra forma (ignora tamaños, tildes, mayúsculas y "x"). */
export function mismaIdentidad(a: string, b: string): boolean {
  const pa = [...new Set(palabrasClave(a))].sort().join(' ');
  const pb = [...new Set(palabrasClave(b))].sort().join(' ');
  return pa !== '' && pa === pb;
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
/** Similitud mínima de nombre para considerar que es el mismo producto. */
const NOMBRE_MINIMO = 0.5;
/** Dos productos a menos de esta distancia se consideran ambiguos. */
const MARGEN_AMBIGUO = 0.1;

/**
 * Busca la presentación del catálogo que corresponde a una línea del remito.
 *   1. Si ese texto ya se vinculó a mano antes (alias), se usa esa.
 *   2. Se identifica el PRODUCTO por sus palabras (sin tamaño). Si el remito y la ficha tienen
 *      cada uno palabras que el otro no tiene ("Manteca La Serenísima" vs "Manteca Pepito"),
 *      se consideran productos distintos: no se vinculan nunca por parecido.
 *   3. Se elige la PRESENTACIÓN por el tamaño normalizado (200 gr = 200 gramos = 200 g):
 *      - coincide una sola → se vincula;
 *      - el producto existe pero sin ese tamaño → no se vincula; se sugiere agregar la presentación;
 *      - el remito no dice el tamaño y hay varias, o hay varios productos posibles → opciones para elegir.
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

  const medida = medidaDe(descripcion) ?? undefined;
  const conMedida = medida ? { medida } : {};

  // 1. Productos candidatos (por nombre, sin tamaño)
  const porProducto = new Map<string, { items: Item[]; s: number; faltan: string[]; sobran: string[] }>();
  for (const it of items) {
    const nombre = nombreItem(it.producto, it.presentacion);
    const c = comparar(descripcion, nombre);
    if (c.s < NOMBRE_MINIMO) continue;
    if (c.sobran.length > 0 && c.faltan.length > 0) continue; // otra marca o variedad
    let s = c.s;
    if (idsDelProveedor.has(it.presentacion.id)) s = Math.min(1, s + 0.05);
    const prev = porProducto.get(it.producto.id);
    if (!prev) porProducto.set(it.producto.id, { items: [it], s, faltan: c.faltan, sobran: c.sobran });
    else {
      prev.items.push(it);
      if (s > prev.s) Object.assign(prev, { s, faltan: c.faltan, sobran: c.sobran });
    }
  }
  if (porProducto.size === 0) return { presentacionId: null, confianza: 0, ...conMedida };

  const ranking = [...porProducto.entries()].sort((x, y) => y[1].s - x[1].s);
  const [prodId, mejor] = ranking[0];
  const empatados = ranking.filter(([, v]) => mejor.s - v.s < MARGEN_AMBIGUO);
  const delTamano = (its: Item[]) => (medida ? its.filter((it) => medidaPresentacion(it) === medida) : its);

  // 2. Varios productos posibles: si el tamaño deja una sola presentación, se propone; si no, se elige
  if (empatados.length > 1) {
    const exactas = empatados.flatMap(([, v]) => delTamano(v.items));
    if (medida && exactas.length === 1) {
      return { presentacionId: exactas[0].presentacion.id, confianza: TOPE_REVISAR, motivo: 'Hay otros productos parecidos: confirmá que es este.', ...conMedida };
    }
    const opciones = (exactas.length > 0 ? exactas : empatados.flatMap(([, v]) => v.items)).map((it) => it.presentacion.id);
    return { presentacionId: null, confianza: mejor.s, opciones, motivo: 'Hay varios productos posibles: elegí cuál es.', ...conMedida };
  }

  // 3. Un solo producto: elegir la presentación
  const motivoNombre = mejor.faltan.length > 0
    ? `El remito no menciona «${mejor.faltan.join(' ')}»: confirmá que es este producto.`
    : mejor.sobran.length > 0
      ? `El remito dice «${mejor.sobran.join(' ')}», que no está en la ficha: confirmá que es este producto.`
      : undefined;
  const conf = (base: number) => Math.round((motivoNombre ? Math.min(base, 0.7) : base) * 100) / 100;
  const vinculo = (it: Item, base: number, motivo?: string): Vinculo => {
    const m = motivo ?? motivoNombre;
    return { presentacionId: it.presentacion.id, confianza: m ? Math.min(conf(base), 0.7) : conf(base), ...(m ? { motivo: m } : {}), ...conMedida };
  };

  if (medida) {
    const exactas = delTamano(mejor.items);
    if (exactas.length === 1) return vinculo(exactas[0], Math.min(1, mejor.s + 0.05));
    if (exactas.length > 1) {
      return { presentacionId: null, confianza: mejor.s, opciones: exactas.map((it) => it.presentacion.id), motivo: 'Hay más de una presentación de ese tamaño: elegí cuál es.', ...conMedida };
    }
    // Ninguna presentación tiene ese tamaño
    const sinTamano = mejor.items.filter((it) => medidaPresentacion(it) === null);
    if (sinTamano.length === 1 && mejor.items.length === 1) {
      return vinculo(sinTamano[0], TOPE_REVISAR, `La presentación no tiene tamaño cargado y el remito dice ${medidaLegible(medida)}: confirmá que es esta.`);
    }
    const producto = mejor.items[0].producto;
    return {
      presentacionId: null,
      confianza: mejor.s,
      productoSugeridoId: prodId,
      opciones: mejor.items.map((it) => it.presentacion.id),
      motivo: `«${producto.nombre}» no tiene la presentación de ${medidaLegible(medida)}.`,
      ...conMedida,
    };
  }
  if (mejor.items.length === 1) return vinculo(mejor.items[0], mejor.s);
  return {
    presentacionId: null,
    confianza: Math.min(mejor.s, TOPE_REVISAR),
    opciones: mejor.items.map((it) => it.presentacion.id),
    motivo: 'El remito no indica el tamaño y el producto tiene varias presentaciones: elegí cuál es.',
  };
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
