import type { DiaSemana, LineaRecepcion } from '../types';

export type Errores = Record<string, string>;

/** Convierte lo que escribe el usuario ("1,5", " 3 ") en número. Devuelve null si está vacío. */
export function leerNumero(texto: string): number | null | 'invalido' {
  const t = texto.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return 'invalido';
  return Number(t);
}

export function validarProducto(input: { nombre: string }): Errores {
  const e: Errores = {};
  if (input.nombre.trim() === '') e.nombre = 'Escribí el nombre del producto.';
  return e;
}

export interface EntradaPresentacion {
  nombre: string;
  puntoDePedido: string;
  contenido: string;
  unidadContenido: string;
  unidadesPorBulto: string;
  costoUnitario: string;
}

/** Valida una presentación. Los campos opcionales vacíos quedan sin dato (nunca se suponen). */
export function validarPresentacion(input: EntradaPresentacion): Errores {
  const e: Errores = {};
  if (input.nombre.trim() === '') e.nombre = 'Escribí cómo se llama la presentación (por ejemplo, 1 L o 473 ml).';
  const pp = leerNumero(input.puntoDePedido);
  if (pp === null) e.puntoDePedido = 'Indicá el punto de pedido (puede ser 0).';
  else if (pp === 'invalido') e.puntoDePedido = 'El punto de pedido tiene que ser un número.';
  else if (pp < 0) e.puntoDePedido = 'El punto de pedido no puede ser negativo.';
  const c = leerNumero(input.contenido);
  if (c === 'invalido' || (typeof c === 'number' && c <= 0)) e.contenido = 'El tamaño tiene que ser un número mayor a 0.';
  else if (typeof c === 'number' && !input.unidadContenido) e.contenido = 'Elegí la unidad del tamaño.';
  const b = leerNumero(input.unidadesPorBulto);
  if (b === 'invalido' || (typeof b === 'number' && b <= 0)) e.unidadesPorBulto = 'Tiene que ser un número mayor a 0, o dejalo vacío.';
  const k = leerNumero(input.costoUnitario);
  if (k === 'invalido' || (typeof k === 'number' && k < 0)) e.costoUnitario = 'El costo tiene que ser un número (o dejalo vacío).';
  return e;
}

export function validarProveedor(input: { nombre: string; diasDeVisita: DiaSemana[] }): Errores {
  const e: Errores = {};
  if (input.nombre.trim() === '') e.nombre = 'Escribí el nombre del proveedor.';
  if (input.diasDeVisita.length === 0) e.dias = 'Elegí al menos un día de visita.';
  return e;
}

/** Valida la cantidad contada. Vacío = no se contó ese producto (se ignora). */
export function validarCantidadConteo(texto: string): string | null {
  const n = leerNumero(texto);
  if (n === null) return null;
  if (n === 'invalido') return 'Tiene que ser un número.';
  if (n < 0) return 'No puede ser negativa.';
  return null;
}

export interface LineaBorrador {
  key: string;
  descripcion: string;
  presentacionId: string | null;
  cantidad: string;
  fechaVencimiento: string;
  /** Motivo por el que la vinculación quedó para revisar */
  motivoRevision?: string;
  /** 0 a 1. undefined en la carga manual. */
  confianza?: number;
  revisar: boolean;
  ignorada: boolean;
  /** Coincidencia ambigua: presentaciones posibles para elegir */
  opciones?: string[];
  /** El producto existe pero no con el tamaño del remito */
  productoSugeridoId?: string;
  /** Tamaño leído en el remito ("200 g") */
  medida?: string;
}

export interface ResultadoRecepcion {
  errores: Record<string, string>;
  errorGeneral: string | null;
  lineas: LineaRecepcion[];
}

export function validarRecepcion(proveedorId: string, fecha: string, lineas: LineaBorrador[], hoy: string): ResultadoRecepcion {
  const errores: Record<string, string> = {};
  const validas: LineaRecepcion[] = [];
  let sinProducto = 0;
  let porConfirmar = 0;

  if (!proveedorId) errores.proveedor = 'Elegí el proveedor.';
  if (!fecha) errores.fecha = 'Indicá la fecha.';
  else if (fecha > hoy) errores.fecha = 'La fecha no puede ser futura.';

  for (const l of lineas) {
    if (l.ignorada) continue;
    if (!l.presentacionId) {
      sinProducto++;
      errores[`${l.key}.producto`] = 'Elegí un producto, crealo o ignorá la línea.';
    }
    const n = leerNumero(l.cantidad);
    if (n === null || n === 'invalido' || n <= 0) {
      errores[`${l.key}.cantidad`] = 'La cantidad tiene que ser mayor a 0.';
    }
    if (l.presentacionId && l.revisar) {
      porConfirmar++;
      errores[`${l.key}.producto`] = 'Confirmá esta línea: tocá «Está bien» o corregila.';
    }
    if (l.presentacionId && typeof n === 'number' && n > 0) {
      validas.push({ presentacionId: l.presentacionId, cantidad: n, fechaVencimiento: l.fechaVencimiento || undefined });
    }
  }

  let errorGeneral: string | null = null;
  if (sinProducto > 0) {
    errorGeneral = sinProducto === 1
      ? 'Hay 1 línea sin producto asignado: vinculala, creá el producto o ignorala.'
      : `Hay ${sinProducto} líneas sin producto asignado: vinculalas, creá los productos o ignoralas.`;
  } else if (porConfirmar > 0) {
    errorGeneral = porConfirmar === 1
      ? 'Hay 1 línea marcada para revisar: confirmala o corregila antes de guardar.'
      : `Hay ${porConfirmar} líneas marcadas para revisar: confirmalas o corregilas antes de guardar.`;
  } else if (lineas.filter((l) => !l.ignorada).length === 0) {
    errorGeneral = 'La recepción no tiene ninguna línea para cargar.';
  } else if (Object.keys(errores).length > 0) {
    errorGeneral = 'Revisá los campos marcados en rojo.';
  }

  return { errores, errorGeneral, lineas: validas };
}
