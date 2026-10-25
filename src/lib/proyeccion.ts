// Proyección temporal del stock de una presentación.
//
// Supuestos (se muestran en pantalla):
//   - El ritmo de consumo es el promedio de los últimos períodos entre conteos (ritmoConsumo).
//     Sin ese dato NO se proyecta: se informa qué falta.
//   - Se supone que el ritmo se mantiene y que sale primero lo que vence antes (FEFO).
//   - Lo que llega a la fecha de vencimiento sin salir queda "en riesgo": deja de contarse
//     como stock disponible (no es una baja: la baja la registra la persona).
//   - Solo se suman entradas que el sistema conoce o que el usuario simula (pedido).
import type { AppData, Presentacion, Vistas } from '../types';
import { addDays, diffDays, isoDate, parseIsoDate, startOfDay } from './dates';
import { estadoInventario, ritmoConsumo, redondear, type Lote, type RitmoConsumo } from './inventario';

export interface PuntoProyeccion {
  /** 0 = hoy */
  dia: number;
  fecha: string;
  /** Stock disponible estimado al terminar el día (sin lo vencido) */
  disponible: number;
  /** Unidades que vencieron sin salida hasta ese día (acumulado, desde hoy) */
  vencidoAcumulado: number;
}

export interface LoteEnRiesgo {
  fechaVencimiento: string;
  /** Cantidad registrada del lote hoy */
  cantidadRegistrada: number;
  /** Estimado que llega al vencimiento sin salida */
  sinSalida: number;
  /** El lote ya está vencido hoy */
  yaVencido: boolean;
  fechaUnica?: boolean;
}

export interface Proyeccion {
  presentacion: Presentacion;
  ritmo: RitmoConsumo | null;
  stockRegistrado: number | null;
  /** Fecha del último conteo (base de la estimación) */
  fechaConteo: string | null;
  /** Estimado de hoy: registrado − consumo estimado desde el último conteo − vencido */
  stockHoy: number | null;
  puntos: PuntoProyeccion[];
  fechaPuntoPedido: string | null;
  fechaQuiebre: string | null;
  lotesEnRiesgo: LoteEnRiesgo[];
  /** Por qué no hay proyección de stock (si no la hay) */
  faltante: string | null;
}

export interface OpcionesProyeccion {
  horizonte: number;
  /** Pedido simulado: llega ese día (0 = hoy) con esa cantidad, sin fecha de vencimiento conocida */
  pedido?: { dia: number; cantidad: number };
}

const clonar = (ls: Lote[]) => ls.map((l) => ({ ...l }));
const fefo = (a: Lote, b: Lote) => (a.fechaVencimiento ?? '9999').localeCompare(b.fechaVencimiento ?? '9999');

function consumir(lotes: Lote[], cantidad: number) {
  let resta = cantidad;
  for (const l of [...lotes].sort(fefo)) {
    if (resta <= 1e-9) break;
    const t = Math.min(l.cantidad, resta);
    l.cantidad -= t;
    resta -= t;
  }
}

/** Saca de la lista los lotes que vencieron antes de `fecha`; devuelve cuánto quedó sin salida. */
function retirarVencidos(lotes: Lote[], fecha: string, riesgo: Map<string, number>): number {
  let total = 0;
  for (const l of lotes) {
    if (l.fechaVencimiento && l.fechaVencimiento < fecha && l.cantidad > 1e-9) {
      riesgo.set(l.fechaVencimiento, (riesgo.get(l.fechaVencimiento) ?? 0) + l.cantidad);
      total += l.cantidad;
      l.cantidad = 0;
    }
  }
  return total;
}

const disponible = (lotes: Lote[]) => lotes.reduce((a, l) => a + Math.max(0, l.cantidad), 0);

export function proyectar(data: AppData, vistas: Vistas, presentacion: Presentacion, ahora: Date, op: OpcionesProyeccion): Proyeccion {
  const hoy = startOfDay(ahora);
  const hoyIso = isoDate(hoy);
  const est = estadoInventario(data, presentacion.id);
  const ritmo = ritmoConsumo(vistas.consumo, presentacion.id);
  const fechaConteo = est.ultimoConteo ? isoDate(new Date(est.ultimoConteo.fechaHora)) : null;
  const base = {
    presentacion,
    ritmo,
    stockRegistrado: est.stock,
    fechaConteo,
  };

  const riesgo = new Map<string, number>();
  const lotesHoy = clonar(est.lotes);

  // Sin ritmo: no se proyecta el stock, pero sí se informa lo que vence en el período
  if (!ritmo || est.stock === null || !est.ultimoConteo) {
    const limite = isoDate(addDays(hoy, op.horizonte));
    return {
      ...base,
      stockHoy: null,
      puntos: [],
      fechaPuntoPedido: null,
      fechaQuiebre: null,
      lotesEnRiesgo: est.lotes
        .filter((l) => l.fechaVencimiento && l.fechaVencimiento <= limite)
        .map((l) => ({
          fechaVencimiento: l.fechaVencimiento as string,
          cantidadRegistrada: l.cantidad,
          sinSalida: l.cantidad,
          yaVencido: (l.fechaVencimiento as string) < hoyIso,
          ...(l.fechaUnica ? { fechaUnica: true } : {}),
        })),
      faltante: est.stock === null
        ? 'Nunca se contó esta presentación: cargá el inventario inicial.'
        : !est.ultimoConteo
          ? 'Falta un conteo físico para estimar el consumo.'
          : 'Faltan al menos dos conteos para estimar el ritmo de consumo (las recepciones solas no dicen cuánto se vendió).',
    };
  }

  // 1. Del último conteo a hoy: consumo estimado, día por día, retirando lo que vence
  const desdeConteo = startOfDay(new Date(est.ultimoConteo.fechaHora));
  const diasDesde = Math.max(0, diffDays(desdeConteo, hoy));
  const sim = clonar(est.lotes);
  const riesgoPrevio = new Map<string, number>();
  for (let d = 1; d <= diasDesde; d++) {
    const f = isoDate(addDays(desdeConteo, d));
    retirarVencidos(sim, f, riesgoPrevio);
    consumir(sim, ritmo.porDia);
  }
  // Lo ya vencido hoy (antes de hoy) también queda en riesgo
  retirarVencidos(sim, hoyIso, riesgoPrevio);
  const stockHoy = redondear(disponible(sim));

  // 2. De hoy al horizonte. puntos[d] = disponible estimado al terminar el día d.
  const puntos: PuntoProyeccion[] = [];
  let fechaPuntoPedido: string | null = stockHoy <= presentacion.puntoDePedido ? hoyIso : null;
  let fechaQuiebre: string | null = stockHoy <= 1e-9 ? hoyIso : null;
  let vencidoAcum = 0;
  for (let d = 0; d <= op.horizonte; d++) {
    const f = isoDate(addDays(hoy, d));
    if (d > 0) vencidoAcum += retirarVencidos(sim, f, riesgo);
    if (op.pedido && op.pedido.dia === d && op.pedido.cantidad > 0) {
      sim.push({ fechaVencimiento: null, cantidad: op.pedido.cantidad, origen: 'recepcion', desde: f });
    }
    consumir(sim, ritmo.porDia);
    const disp = redondear(disponible(sim));
    puntos.push({ dia: d, fecha: f, disponible: disp, vencidoAcumulado: redondear(vencidoAcum) });
    if (!fechaPuntoPedido && disp <= presentacion.puntoDePedido) fechaPuntoPedido = f;
    if (!fechaQuiebre && disp <= 1e-9 && ritmo.porDia > 0) fechaQuiebre = f;
  }
  // Lo que vence el último día del horizonte también se evalúa
  retirarVencidos(sim, isoDate(addDays(hoy, op.horizonte + 1)), riesgo);

  // Lotes que vencen en el período (o ya vencidos) con lo que se estima que quedará sin salida
  const limite = isoDate(addDays(hoy, op.horizonte));
  const lotesEnRiesgo: LoteEnRiesgo[] = lotesHoy
    .filter((l) => l.fechaVencimiento && l.fechaVencimiento <= limite)
    .map((l) => {
      const fv = l.fechaVencimiento as string;
      const ya = fv < hoyIso;
      const sinSalida = ya ? riesgoPrevio.get(fv) ?? 0 : riesgo.get(fv) ?? 0;
      return { fechaVencimiento: fv, cantidadRegistrada: l.cantidad, sinSalida: redondear(Math.min(sinSalida, l.cantidad)), yaVencido: ya, ...(l.fechaUnica ? { fechaUnica: true } : {}) };
    });

  return { ...base, stockHoy, puntos, fechaPuntoPedido, fechaQuiebre, lotesEnRiesgo, faltante: null };
}

/** Disponible estimado en un día concreto (0 = hoy) según la proyección. */
export function disponibleEn(p: Proyeccion, dia: number): number | null {
  if (p.puntos.length === 0) return null;
  const pt = p.puntos.find((x) => x.dia === dia) ?? p.puntos[p.puntos.length - 1];
  return pt.disponible;
}

export function diaDe(fecha: string, ahora: Date): number {
  return diffDays(startOfDay(ahora), parseIsoDate(fecha));
}
