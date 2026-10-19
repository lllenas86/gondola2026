import type { DiaSemana } from '../types';

export const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
export const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'] as const;
/** Orden de lunes a domingo para mostrar en pantalla. */
export const ORDEN_SEMANA: DiaSemana[] = [1, 2, 3, 4, 5, 6, 0];

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha local en formato AAAA-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Interpreta AAAA-MM-DD como fecha local (no UTC). */
export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Días calendario entre dos fechas (b − a). */
export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

export function formatFechaCorta(iso: string): string {
  const d = iso.length <= 10 ? parseIsoDate(iso) : new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export function formatFechaHora(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "hoy", "ayer", "hace 5 días" */
export function haceCuanto(iso: string, ahora: Date = new Date()): string {
  const n = diffDays(new Date(iso), ahora);
  if (n <= 0) return 'hoy';
  if (n === 1) return 'ayer';
  return `hace ${n} días`;
}

export function formatDias(dias: DiaSemana[]): string {
  return ORDEN_SEMANA.filter((d) => dias.includes(d)).map((d) => DIAS_CORTOS[d]).join(', ');
}

/** "hoy", "mañana", "el jueves 22/10" */
export function cuandoEs(fecha: Date, ahora: Date = new Date()): string {
  const n = diffDays(ahora, fecha);
  if (n === 0) return 'hoy';
  if (n === 1) return 'mañana';
  return `el ${DIAS_LARGOS[fecha.getDay()]} ${formatFechaCorta(isoDate(fecha))}`;
}

/** "pasa hoy", "pasa mañana", "pasa el jueves 22/10" */
export function textoVisita(fecha: Date, ahora: Date = new Date()): string {
  return `pasa ${cuandoEs(fecha, ahora)}`;
}
