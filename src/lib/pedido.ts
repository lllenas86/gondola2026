// Cantidad sugerida a pedir y armado del mensaje para el proveedor.
// Funciones puras: no leen la base ni el reloj (reciben todo por parámetro).
//
// Idea: lo que se pide en esta visita tiene que alcanzar hasta la visita siguiente
// del mismo proveedor, sin bajar del punto de pedido.
//
//   consumo diario     = Σ consumo ÷ Σ días   (períodos entre conteos, vista v_consumo_historico)
//   stock en la visita = stock actual − consumo diario × días hasta la visita
//   cantidad sugerida  = consumo diario × días entre esta visita y la siguiente
//                        (la siguiente de cualquier proveedor que traiga el producto)
//                        + punto de pedido − stock en la visita       (redondeado hacia arriba, mínimo 0)
//
// Sin historial de consumo se sugiere llegar al doble del punto de pedido.

import type { AppData, FilaConsumo, Producto, Proveedor, Vistas } from '../types';
import { addDays, DIAS_LARGOS, diffDays, formatFechaCorta, isoDate } from './dates';
import { calcularStock, proveedoresDeProducto, proximaVisita } from './stock';

/** Cuántos períodos recientes se usan como máximo para el promedio. */
export const PERIODOS_CONSUMO = 6;

/**
 * Consumo promedio por día de un producto. Devuelve null si no hay historial útil.
 * Se descartan los períodos con consumo negativo: indican una recepción que no se registró.
 */
export function consumoDiario(filas: FilaConsumo[], productoId: string): number | null {
  const utiles = filas.filter((f) => f.productoId === productoId && f.dias > 0 && f.consumo >= 0).slice(-PERIODOS_CONSUMO);
  const dias = utiles.reduce((a, f) => a + f.dias, 0);
  if (dias <= 0) return null;
  return utiles.reduce((a, f) => a + f.consumo, 0) / dias;
}

export interface DatosSugerencia {
  /** null = nunca se contó (se toma como 0) */
  stock: number | null;
  puntoDePedido: number;
  /** null = sin historial */
  consumoDiario: number | null;
  /** Días desde hoy hasta la visita en la que se hace el pedido (0 = hoy) */
  diasHastaVisita: number;
  /** Días entre esa visita y la siguiente del mismo proveedor */
  diasCobertura: number;
}

export interface Sugerencia {
  cantidad: number;
  conHistorial: boolean;
  /** Stock estimado al momento de la visita */
  stockEnVisita: number;
}

export function sugerirCantidad(d: DatosSugerencia): Sugerencia {
  const stock = Math.max(0, d.stock ?? 0);
  if (d.consumoDiario === null) {
    return { cantidad: Math.max(0, Math.ceil(2 * d.puntoDePedido - stock)), conHistorial: false, stockEnVisita: stock };
  }
  const stockEnVisita = Math.max(0, stock - d.consumoDiario * d.diasHastaVisita);
  const necesario = d.consumoDiario * d.diasCobertura + d.puntoDePedido - stockEnVisita;
  // El margen evita que 2,0000001 por redondeo de punto flotante se convierta en 3
  return { cantidad: Math.max(0, Math.ceil(necesario - 1e-6)), conHistorial: true, stockEnVisita: redondear(stockEnVisita) };
}

export interface Ventana {
  /** Visita en la que se hace el pedido (hoy incluido) */
  visita: Date;
  /** Visita siguiente del mismo proveedor */
  siguiente: Date;
  diasHastaVisita: number;
  diasCobertura: number;
}

/** Visita en la que se pide y la siguiente, para un proveedor. null si no tiene días cargados. */
export function ventanaDePedido(proveedor: Proveedor, hoy: Date): Ventana | null {
  const visita = proximaVisita(proveedor, hoy);
  if (!visita) return null;
  const siguiente = proximaVisita(proveedor, addDays(visita, 1)) ?? addDays(visita, 7);
  return { visita, siguiente, diasHastaVisita: diffDays(hoy, visita), diasCobertura: diffDays(visita, siguiente) };
}

/** Sugerencia para un producto en la ventana de un proveedor, a partir de los datos cargados. */
export function sugerenciaProducto(
  data: AppData,
  vistas: Vistas,
  producto: Producto,
  ventana: Ventana,
): Sugerencia & { consumoDiario: number | null; stock: number | null } {
  const fila = vistas.stock.find((f) => f.productoId === producto.id);
  const stock = fila ? fila.stockActual : calcularStock(data, producto).stock;
  const c = consumoDiario(vistas.consumo, producto.id);
  // Si otro proveedor también lo trae y pasa antes, alcanza con cubrir hasta esa visita.
  const otras = proveedoresDeProducto(data, producto.id)
    .map((p) => proximaVisita(p, addDays(ventana.visita, 1)))
    .filter((d): d is Date => d !== null)
    .map((d) => diffDays(ventana.visita, d));
  const diasCobertura = Math.min(ventana.diasCobertura, ...otras);
  const s = sugerirCantidad({
    stock,
    puntoDePedido: producto.puntoDePedido,
    consumoDiario: c,
    diasHastaVisita: ventana.diasHastaVisita,
    diasCobertura,
  });
  return { ...s, consumoDiario: c, stock };
}

export interface ItemPedido {
  nombre: string;
  cantidad: number;
}

/** Texto del pedido listo para mandar por WhatsApp o copiar. */
export function mensajePedido(proveedor: Proveedor, visita: Date, items: ItemPedido[]): string {
  const lineas = items.filter((i) => i.cantidad > 0).map((i) => `• ${formatearCantidad(i.cantidad)} × ${i.nombre}`);
  const dia = `${DIAS_LARGOS[visita.getDay()]} ${formatFechaCorta(isoDate(visita))}`;
  return [`Hola ${proveedor.nombre}! Te paso el pedido para el ${dia}:`, '', ...lineas, '', '¡Gracias!'].join('\n');
}

/**
 * Teléfono en el formato que pide wa.me (solo dígitos, con código de país).
 * Acepta números argentinos escritos como "341 555-1234", "0341 15 555-1234" o "+54 9 341 555 1234".
 * Devuelve null si no se puede interpretar.
 */
export function telefonoWhatsApp(texto: string | undefined): string | null {
  if (!texto) return null;
  const internacional = texto.trim().startsWith('+');
  let d = texto.replace(/\D/g, '');
  if (d === '') return null;
  if (internacional || d.startsWith('54')) {
    if (d.startsWith('54') && !d.startsWith('549') && d.length === 12) d = `549${d.slice(2)}`;
    return d.length >= 10 ? d : null;
  }
  d = d.replace(/^0/, '');
  // Celular argentino escrito con "15" después del código de área: 341 15 5551234 → 341 5551234
  if (d.length === 12) {
    const m = d.match(/^(\d{2,4})15(\d{6,8})$/);
    if (m && m[1].length + m[2].length === 10) d = m[1] + m[2];
  }
  return d.length === 10 ? `549${d}` : null;
}

/** Link de WhatsApp. Sin teléfono, WhatsApp deja elegir el contacto. */
export function linkWhatsApp(telefono: string | null, texto: string): string {
  return `https://wa.me/${telefono ?? ''}?text=${encodeURIComponent(texto)}`;
}

function formatearCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}

function redondear(n: number): number {
  return Math.round(n * 10) / 10;
}
