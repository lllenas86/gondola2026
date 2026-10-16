import type { DiaSemana, LineaRecepcion } from '../types';

export type Errores = Record<string, string>;

/** Convierte lo que escribe el usuario ("1,5", " 3 ") en número. Devuelve null si está vacío. */
export function leerNumero(texto: string): number | null | 'invalido' {
  const t = texto.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return 'invalido';
  return Number(t);
}

export function validarProducto(input: { nombre: string; puntoDePedido: string }): Errores {
  const e: Errores = {};
  if (input.nombre.trim() === '') e.nombre = 'Escribí el nombre del producto.';
  const pp = leerNumero(input.puntoDePedido);
  if (pp === null) e.puntoDePedido = 'Indicá el punto de pedido (puede ser 0).';
  else if (pp === 'invalido') e.puntoDePedido = 'El punto de pedido tiene que ser un número.';
  else if (pp < 0) e.puntoDePedido = 'El punto de pedido no puede ser negativo.';
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
  productoId: string | null;
  cantidad: string;
  fechaVencimiento: string;
  /** 0 a 1. undefined en la carga manual. */
  confianza?: number;
  revisar: boolean;
  ignorada: boolean;
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

  if (!proveedorId) errores.proveedor = 'Elegí el proveedor.';
  if (!fecha) errores.fecha = 'Indicá la fecha.';
  else if (fecha > hoy) errores.fecha = 'La fecha no puede ser futura.';

  for (const l of lineas) {
    if (l.ignorada) continue;
    if (!l.productoId) {
      sinProducto++;
      errores[`${l.key}.producto`] = 'Elegí un producto, crealo o ignorá la línea.';
    }
    const n = leerNumero(l.cantidad);
    if (n === null || n === 'invalido' || n <= 0) {
      errores[`${l.key}.cantidad`] = 'La cantidad tiene que ser mayor a 0.';
    }
    if (l.productoId && typeof n === 'number' && n > 0) {
      validas.push({ productoId: l.productoId, cantidad: n, fechaVencimiento: l.fechaVencimiento || undefined });
    }
  }

  let errorGeneral: string | null = null;
  if (sinProducto > 0) {
    errorGeneral = sinProducto === 1
      ? 'Hay 1 línea sin producto asignado: vinculala, creá el producto o ignorala.'
      : `Hay ${sinProducto} líneas sin producto asignado: vinculalas, creá los productos o ignoralas.`;
  } else if (lineas.filter((l) => !l.ignorada).length === 0) {
    errorGeneral = 'La recepción no tiene ninguna línea para cargar.';
  } else if (Object.keys(errores).length > 0) {
    errorGeneral = 'Revisá los campos marcados en rojo.';
  }

  return { errores, errorGeneral, lineas: validas };
}
