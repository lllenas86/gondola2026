import type { AppData, Devolucion, EstadoDevolucion, Lote, MotivoDevolucion } from '../types';
import { formatFechaCorta } from './dates';

export const MOTIVOS: Record<MotivoDevolucion, string> = {
  vencido: 'Mercadería vencida',
  proximo_a_vencer: 'Próxima a vencer',
  danado: 'Dañada o en mal estado',
  otro: 'Otro motivo',
};

export const ESTADOS_DEVOLUCION: Record<EstadoDevolucion, string> = {
  preparada: 'Preparada · sin entregar',
  entregada: 'Entregada · esperando respuesta',
  resuelta: 'Resuelta',
  cancelada: 'Anulada',
};

/** "Venció hace 2 días", "Vence hoy", "Vence mañana", "Vence en 5 días" */
export function textoVencimiento(dias: number | null): string {
  if (dias === null) return 'Sin fecha';
  if (dias < -1) return `Venció hace ${-dias} días`;
  if (dias === -1) return 'Venció ayer';
  if (dias === 0) return 'Vence hoy';
  if (dias === 1) return 'Vence mañana';
  return `Vence en ${dias} días`;
}

/** Acción sugerida para cada situación (sin asumir nada del proveedor). */
export function accionRecomendada(l: Lote): string {
  if (l.estado === 'vencido') {
    return 'Retirala de la góndola ya. Si el proveedor acepta devoluciones o cambios, prepará una devolución; si no, registrá la baja por descarte.';
  }
  if (l.diasParaVencer !== null && l.diasParaVencer <= 3) {
    return 'Ponela adelante y priorizá su venta. Si el proveedor acepta cambios antes del vencimiento, consultale y prepará la devolución.';
  }
  return 'Ubicala adelante en la góndola para que se venda primero.';
}

/** Cantidad de un lote que ya está en devoluciones preparadas (todavía no descontadas). */
export function reservadoEnPreparadas(data: AppData, productoId: string, fecha: string | null, excepto?: string): { cantidad: number; devoluciones: Devolucion[] } {
  let cantidad = 0;
  const devs: Devolucion[] = [];
  for (const d of data.devoluciones) {
    if (d.estado !== 'preparada' || d.id === excepto) continue;
    const q = d.lineas
      .filter((l) => l.productoId === productoId && (l.fechaVencimiento ?? null) === fecha)
      .reduce((a, l) => a + l.cantidad, 0);
    if (q > 0) {
      cantidad += q;
      devs.push(d);
    }
  }
  return { cantidad, devoluciones: devs };
}

/** Texto del origen del lote: "Recibido el 12/10 (Lácteos del Sur)" o "Contado". */
export function origenLote(data: AppData, l: Lote): string {
  if (l.recepcionId) {
    const r = data.recepciones.find((x) => x.id === l.recepcionId);
    if (r) {
      const prov = data.proveedores.find((p) => p.id === r.proveedorId)?.nombre;
      return `Recibido el ${formatFechaCorta(r.fecha)}${prov ? ` (${prov})` : ''}`;
    }
  }
  return 'Registrado en un conteo';
}

export function numeroRemito(n: number): string {
  return String(n).padStart(4, '0');
}
