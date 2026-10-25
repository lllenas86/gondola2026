// Cantidad sugerida a pedir, prioridades y armado del mensaje para el proveedor.
// Asistente basado en reglas y datos reales (no usa un modelo de IA).
//
// Lo que se pide en una visita tiene que alcanzar hasta la entrega siguiente sin bajar
// del punto de pedido:
//
//   stock en la visita = proyección (último conteo − consumo estimado, sin lo vencido)
//   cantidad sugerida  = consumo diario × días hasta la entrega siguiente
//                        (la siguiente de cualquier proveedor que traiga esa presentación)
//                        + punto de pedido − stock en la visita    (hacia arriba, mínimo 0)
//
// Sin historial de consumo se sugiere llegar al doble del punto de pedido, y se avisa.

import type { AppData, Presentacion, Proveedor, Vistas } from '../types';
import { addDays, DIAS_LARGOS, diffDays, formatFechaCorta, isoDate } from './dates';
import { proximaVisita } from './stock';
import {
  formatoCantidad, nombreItem, proveedoresDe, stockDe, type Item, type RitmoConsumo,
} from './inventario';
import { proyectar } from './proyeccion';

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

export type Prioridad = 'alta' | 'media' | 'baja' | 'ninguna';

export interface Sugerencia {
  item: Item;
  /** Stock registrado (null = nunca se contó) */
  stock: number | null;
  /** Stock estimado al llegar la visita (null = sin ritmo de consumo) */
  stockEnVisita: number | null;
  ritmo: RitmoConsumo | null;
  cantidad: number;
  conHistorial: boolean;
  diasCobertura: number;
  /** Hasta cuándo tiene que alcanzar (la entrega siguiente que trae esta presentación) */
  hasta: Date;
  prioridad: Prioridad;
  /** Explicaciones con los datos usados */
  motivos: string[];
  /** Advertencias (por ejemplo, vencimientos) */
  avisos: string[];
}

const fmt = (n: number) => formatoCantidad(Math.round(n * 10) / 10);

/** Sugerencia para una presentación en la ventana de un proveedor. */
export function sugerir(data: AppData, vistas: Vistas, item: Item, ventana: Ventana, ahora: Date = new Date()): Sugerencia {
  const { presentacion } = item;
  const stock = stockDe(data, vistas, presentacion.id);

  // Si otro proveedor también la trae y pasa antes de la siguiente, alcanza con cubrir hasta esa visita.
  let hasta = ventana.siguiente;
  let otroAntes: string | null = null;
  for (const p of proveedoresDe(data, presentacion.id)) {
    const v = proximaVisita(p, addDays(ventana.visita, 1));
    if (v && v < hasta) {
      hasta = v;
      otroAntes = p.nombre;
    }
  }
  const diasCobertura = Math.max(1, diffDays(ventana.visita, hasta));
  const proy = proyectar(data, vistas, presentacion, ahora, { horizonte: ventana.diasHastaVisita + diasCobertura });
  const ritmo = proy.ritmo;
  const motivos: string[] = [];
  const avisos: string[] = [];
  const pp = presentacion.puntoDePedido;

  let cantidad: number;
  let stockEnVisita: number | null = null;
  if (ritmo && proy.stockHoy !== null) {
    stockEnVisita = ventana.diasHastaVisita === 0
      ? proy.stockHoy
      : proy.puntos.find((x) => x.dia === ventana.diasHastaVisita - 1)?.disponible ?? proy.stockHoy;
    const necesario = ritmo.porDia * diasCobertura + pp - stockEnVisita;
    // El margen evita que 2,0000001 por redondeo de punto flotante se convierta en 3
    cantidad = Math.max(0, Math.ceil(necesario - 1e-6));
    motivos.push(
      `Consumo estimado ~${fmt(ritmo.porDia)} por día (promedio de ${ritmo.periodos} ${ritmo.periodos === 1 ? 'período' : 'períodos'} entre conteos, ${formatFechaCorta(ritmo.desde)} al ${formatFechaCorta(ritmo.hasta)}). Supone que el ritmo se mantiene.`,
    );
    if (proy.fechaQuiebre && proy.fechaQuiebre <= isoDate(hasta)) {
      motivos.push(`Sin pedir, podría agotarse alrededor del ${formatFechaCorta(proy.fechaQuiebre)}, antes de la entrega siguiente (${formatFechaCorta(isoDate(hasta))}).`);
    } else if (proy.fechaPuntoPedido && proy.fechaPuntoPedido <= isoDate(hasta)) {
      motivos.push(`Podría bajar del punto de pedido (${fmt(pp)}) alrededor del ${formatFechaCorta(proy.fechaPuntoPedido)}.`);
    }
  } else {
    cantidad = Math.max(0, Math.ceil(2 * pp - Math.max(0, stock ?? 0)));
    motivos.push(proy.faltante ?? 'Sin historial de consumo.');
    if (cantidad > 0) motivos.push(`Por eso se sugiere llegar al doble del punto de pedido (${fmt(2 * pp)}).`);
  }
  if (stock !== null && stock <= pp) motivos.unshift(`Stock registrado ${fmt(stock)}, en o por debajo del punto de pedido (${fmt(pp)}).`);
  if (stock === null) motivos.unshift('Nunca se contó: el stock es desconocido.');
  if (otroAntes) motivos.push(`También la trae ${otroAntes}, que pasa antes: se cubre solo hasta esa visita.`);

  const enRiesgo = proy.lotesEnRiesgo.filter((l) => l.sinSalida > 0);
  for (const l of enRiesgo) {
    avisos.push(l.yaVencido
      ? `Hay ${fmt(l.sinSalida)} vencidas (${formatFechaCorta(l.fechaVencimiento)}) que no se cuentan como disponibles.`
      : `${fmt(l.sinSalida)} del lote que vence el ${formatFechaCorta(l.fechaVencimiento)} podrían quedar sin salida: no conviene pedir de más.`);
  }

  // Prioridad
  let prioridad: Prioridad = 'ninguna';
  if (cantidad > 0) {
    const finVentana = isoDate(hasta);
    if ((stock !== null && stock <= pp) || stock === null || (proy.fechaQuiebre !== null && proy.fechaQuiebre <= finVentana)) prioridad = 'alta';
    else if (stockEnVisita !== null && stockEnVisita <= pp) prioridad = 'alta';
    else if (proy.fechaPuntoPedido !== null && proy.fechaPuntoPedido <= finVentana) prioridad = 'media';
    else prioridad = 'baja';
  }

  return { item, stock, stockEnVisita, ritmo, cantidad, conHistorial: !!ritmo, diasCobertura, hasta, prioridad, motivos, avisos };
}

/** Redondea hacia arriba a bultos completos, solo si la equivalencia está configurada. */
export function aBultos(cantidad: number, presentacion: Presentacion): number {
  const b = presentacion.unidadesPorBulto;
  if (!b || cantidad <= 0) return cantidad;
  return Math.ceil(cantidad / b - 1e-9) * b;
}

export interface ItemPedido {
  presentacion: Presentacion;
  nombre: string;
  cantidad: number;
}

/** "(2 bultos de 8)" si la cantidad es múltiplo exacto de la equivalencia configurada. */
export function textoBultos(cantidad: number, presentacion: Presentacion): string {
  const b = presentacion.unidadesPorBulto;
  if (!b || cantidad <= 0) return '';
  const n = cantidad / b;
  return Number.isInteger(n) ? ` (${n} ${n === 1 ? 'bulto' : 'bultos'} de ${formatearCantidad(b)})` : '';
}

/** Texto del pedido listo para mandar por WhatsApp o copiar. Una línea por presentación. */
export function mensajePedido(proveedor: Proveedor, visita: Date, items: ItemPedido[], nota = ''): string {
  const lineas = items
    .filter((i) => i.cantidad > 0)
    .map((i) => `• ${formatearCantidad(i.cantidad)} × ${i.nombre}${textoBultos(i.cantidad, i.presentacion)}`);
  const dia = `${DIAS_LARGOS[visita.getDay()]} ${formatFechaCorta(isoDate(visita))}`;
  return [
    `Hola ${proveedor.nombre}! Te paso el pedido para el ${dia}:`,
    '',
    ...lineas,
    ...(nota.trim() ? ['', nota.trim()] : []),
    '',
    '¡Gracias!',
  ].join('\n');
}

export function nombrePedido(item: Item): string {
  return nombreItem(item.producto, item.presentacion);
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

/** Link de WhatsApp. Sin teléfono, WhatsApp deja elegir el contacto. Nunca envía solo. */
export function linkWhatsApp(telefono: string | null, texto: string): string {
  return `https://wa.me/${telefono ?? ''}?text=${encodeURIComponent(texto)}`;
}

function formatearCantidad(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}
