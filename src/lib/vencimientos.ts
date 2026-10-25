// Vencimientos y mermas a partir de los lotes registrados (una sola regla para todas las pantallas).
import type { AppData, Devolucion } from '../types';
import { estadoInventario, estadoLote, itemsActivos, valorizar, type EstadoLote, type Item, type Lote } from './inventario';

export interface LoteAlerta {
  item: Item;
  lote: Lote;
  estado: EstadoLote;
  dias: number | null;
  /** Valor a costo de referencia; null si no hay costo cargado */
  valor: number | null;
}

/** Lotes con existencia registrada y fecha de vencimiento dentro de `dias` (o vencidos). */
export function lotesConAlerta(data: AppData, ahora: Date = new Date(), dias = 7): LoteAlerta[] {
  const out: LoteAlerta[] = [];
  for (const item of itemsActivos(data)) {
    for (const lote of estadoInventario(data, item.presentacion.id).lotes) {
      const e = estadoLote(lote.fechaVencimiento, ahora);
      if (e.dias === null || e.dias > dias) continue;
      out.push({ item, lote, estado: e.estado, dias: e.dias, valor: valorizar(lote.cantidad, item.presentacion.costoUnitario) });
    }
  }
  return out.sort((a, b) => (a.dias ?? 0) - (b.dias ?? 0));
}

export interface ResumenValor {
  /** Suma de lo que se pudo valorizar */
  total: number;
  /** Cantidad de lotes / líneas sin costo cargado (no se incluyen en el total) */
  sinCosto: number;
}

export function sumarValor(valores: (number | null)[]): ResumenValor {
  return valores.reduce<ResumenValor>((a, v) => (v === null ? { ...a, sinCosto: a.sinCosto + 1 } : { ...a, total: a.total + v }), { total: 0, sinCosto: 0 });
}

const costoLinea = (data: AppData, presentacionId: string, costo?: number) =>
  costo ?? data.presentaciones.find((x) => x.id === presentacionId)?.costoUnitario;

/** Valor de una devolución (con el costo guardado en cada línea o, si falta, el de referencia). */
export function valorDevolucion(data: AppData, d: Devolucion): ResumenValor {
  return sumarValor(d.lineas.map((l) => valorizar(l.cantidad, costoLinea(data, l.presentacionId, l.costoUnitario))));
}

export interface ResumenMermas {
  /** Devoluciones confirmadas o resueltas en el período */
  devueltas: { cantidad: number; valor: ResumenValor };
  /** Resueltas con reemplazo o nota de crédito: valor recuperado */
  recuperado: ResumenValor;
  /** Bajas (descarte) en el período */
  descartadas: { cantidad: number; valor: ResumenValor };
  /** Devoluciones preparadas o confirmadas sin resolver */
  abiertas: number;
}

/** Mermas desde una fecha (ISO). */
export function resumenMermas(data: AppData, desdeIso: string): ResumenMermas {
  const devs = data.devoluciones.filter((d) => (d.estado === 'confirmada' || d.estado === 'resuelta') && (d.confirmadaEn ?? '') >= desdeIso);
  const recuperadas = devs.filter((d) => d.estado === 'resuelta' && (d.resolucion === 'reemplazo' || d.resolucion === 'nota_credito'));
  const bajas = data.bajas.filter((b) => b.registradaEn >= desdeIso);
  const juntar = (rs: ResumenValor[]) => rs.reduce((a, r) => ({ total: a.total + r.total, sinCosto: a.sinCosto + r.sinCosto }), { total: 0, sinCosto: 0 });
  return {
    devueltas: { cantidad: devs.reduce((a, d) => a + d.lineas.reduce((x, l) => x + l.cantidad, 0), 0), valor: juntar(devs.map((d) => valorDevolucion(data, d))) },
    recuperado: juntar(recuperadas.map((d) => valorDevolucion(data, d))),
    descartadas: {
      cantidad: bajas.reduce((a, b) => a + b.cantidad, 0),
      valor: sumarValor(bajas.map((b) => valorizar(b.cantidad, costoLinea(data, b.presentacionId, b.costoUnitario)))),
    },
    abiertas: data.devoluciones.filter((d) => d.estado === 'preparada' || d.estado === 'confirmada').length,
  };
}

export const MOTIVO_DEVOLUCION: Record<Devolucion['motivo'], string> = {
  proximo_vencer: 'Próximo a vencer',
  vencido: 'Vencido',
  danado: 'Dañado',
  otro: 'Otro',
};

export const ESTADO_DEVOLUCION: Record<Devolucion['estado'], string> = {
  preparada: 'Preparada (borrador)',
  confirmada: 'Entregada al proveedor · sin resolver',
  resuelta: 'Resuelta',
  cancelada: 'Cancelada',
};

export const RESOLUCION: Record<NonNullable<Devolucion['resolucion']>, string> = {
  reemplazo: 'Repuso la mercadería',
  nota_credito: 'Nota de crédito / descuento',
  sin_compensacion: 'Sin compensación',
  otra: 'Otra',
};

export const MOTIVO_BAJA = { vencido: 'Vencido', danado: 'Dañado', otro: 'Otro' } as const;
