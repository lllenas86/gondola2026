// Días de visita de los proveedores. (El cálculo de stock está en lib/inventario.ts.)
import type { DiaSemana, Proveedor } from '../types';
import { addDays } from './dates';

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
