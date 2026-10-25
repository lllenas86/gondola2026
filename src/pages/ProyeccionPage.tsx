import { useMemo, useState, type PointerEvent } from 'react';
import { useStore } from '../state/store';
import { addDays, DIAS_CORTOS, formatFechaCorta, isoDate, parseIsoDate, startOfDay } from '../lib/dates';
import { proximaVisita } from '../lib/stock';
import { abreviaturaUnidad, formatoCantidad, itemsActivos, nombreItem, proveedoresDe, type Item } from '../lib/inventario';
import { diaDe, proyectar, type Proyeccion } from '../lib/proyeccion';
import { sugerir, ventanaDePedido } from '../lib/pedido';
import { Icon } from '../components/Icon';
import { EstadoConexion, Hoja } from '../components/ui';
import { AsistentePedido } from '../features/AsistentePedido';
import type { Proveedor } from '../types';

// Simulador temporal: ¿qué pasaría con el stock en los próximos días si el consumo sigue
// al ritmo estimado? Todo sale de proyectar() (lib/proyeccion.ts), la misma función que usa
// el pedido sugerido. Sin historial suficiente no se proyecta: se dice qué falta.

const HORIZONTES = [7, 14, 30];

type Estado = 'quiebre' | 'alerta' | 'ok';

function estadoEn(p: Proyeccion, dia: number): Estado | null {
  const pt = p.puntos[dia];
  if (!pt) return null;
  if (pt.disponible <= 1e-9) return 'quiebre';
  if (pt.disponible <= p.presentacion.puntoDePedido) return 'alerta';
  return 'ok';
}

const TEXTO_ESTADO: Record<Estado, string> = { quiebre: 'Agotado', alerta: 'Bajo punto de pedido', ok: 'Alcanza' };
const fechaLarga = (iso: string) => `${DIAS_CORTOS[parseIsoDate(iso).getDay()]} ${formatFechaCorta(iso)}`;

export function ProyeccionPage() {
  const { data, vistas } = useStore();
  const [horizonte, setHorizonte] = useState(14);
  const [dia, setDia] = useState(7);
  const [detalle, setDetalle] = useState<Item | null>(null);
  const ahora = new Date();
  const hoy = startOfDay(ahora);
  const diaSel = Math.min(dia, horizonte);
  const fechaSel = isoDate(addDays(hoy, diaSel));

  const proyecciones = useMemo(
    () => itemsActivos(data).map((item) => ({ item, p: proyectar(data, vistas, item.presentacion, ahora, { horizonte }) })),
    [data, vistas, horizonte], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const conDatos = proyecciones.filter((x) => x.p.faltante === null);
  const sinDatos = proyecciones.filter((x) => x.p.faltante !== null);
  const conteo = { quiebre: 0, alerta: 0, ok: 0 };
  for (const x of conDatos) {
    const e = estadoEn(x.p, diaSel);
    if (e) conteo[e]++;
  }
  // Lotes que vencen hasta el día elegido con unidades estimadas sin salida
  const vencenSinSalida = proyecciones.flatMap((x) =>
    x.p.lotesEnRiesgo.filter((l) => l.fechaVencimiento <= fechaSel && (x.p.faltante === null ? l.sinSalida > 0 : true)).map((l) => ({ item: x.item, l, estimado: x.p.faltante === null })),
  );
  const orden = (x: { p: Proyeccion }) => {
    const e = estadoEn(x.p, diaSel);
    return e === 'quiebre' ? 0 : e === 'alerta' ? 1 : 2;
  };
  const lista = [...conDatos].sort((a, b) => orden(a) - orden(b) || (a.p.fechaQuiebre ?? '9').localeCompare(b.p.fechaQuiebre ?? '9'));

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Proyección de stock</p>
        <h1>¿Qué pasa en los próximos días?</h1>
      </header>

      <section className="tarjeta simulador-control" aria-label="Control temporal">
        <div className="chips" role="tablist" aria-label="Horizonte">
          {HORIZONTES.map((h) => (
            <button key={h} type="button" role="tab" aria-selected={horizonte === h} className={`chip${horizonte === h ? ' activo' : ''}`} onClick={() => { setHorizonte(h); setDia(Math.min(dia, h)); }}>{h} días</button>
          ))}
        </div>
        <label className="slider-etiqueta" htmlFor="slider-dia">
          <span>Mirando el</span>
          <strong data-testid="fecha-slider">{diaSel === 0 ? 'hoy' : fechaLarga(fechaSel)}</strong>
          <span className="texto-suave">{diaSel === 0 ? '' : `(dentro de ${diaSel} ${diaSel === 1 ? 'día' : 'días'})`}</span>
        </label>
        <input id="slider-dia" className="slider" type="range" min={0} max={horizonte} step={1} value={diaSel} onChange={(e) => setDia(Number(e.target.value))} aria-valuetext={fechaLarga(fechaSel)} />
        <div className="slider-escala"><span>Hoy</span><span>{fechaLarga(isoDate(addDays(hoy, horizonte)))}</span></div>
        <div className="kpis kpis-3">
          <div className={`kpi${conteo.quiebre > 0 ? ' kpi-rojo' : ''}`}><span className="kpi-titulo">Agotadas</span><strong data-testid="kpi-quiebre">{conteo.quiebre}</strong></div>
          <div className={`kpi${conteo.alerta > 0 ? ' kpi-ambar' : ''}`}><span className="kpi-titulo">Bajo punto de pedido</span><strong>{conteo.alerta}</strong></div>
          <div className="kpi kpi-verde"><span className="kpi-titulo">Alcanzan</span><strong>{conteo.ok}</strong></div>
        </div>
        <p className="texto-suave">
          Estimación: supone que se sigue consumiendo al ritmo promedio entre los últimos conteos y que sale primero lo que vence antes.
          No incluye pedidos que todavía no llegaron. {sinDatos.length > 0 && `${sinDatos.length} ${sinDatos.length === 1 ? 'presentación no tiene' : 'presentaciones no tienen'} datos suficientes.`}
        </p>
      </section>

      {vencenSinSalida.length > 0 && (
        <section className="seccion">
          <h2 className="seccion-titulo">Vencen hasta el {formatFechaCorta(fechaSel)}</h2>
          <ul className="lista-simple">
            {vencenSinSalida.map(({ item, l, estimado }, i) => (
              <li key={i} className="item-simple">
                <div>
                  <p className="item-titulo">{nombreItem(item.producto, item.presentacion)}</p>
                  <p className="texto-suave">
                    {l.yaVencido ? `Ya vencido (${formatFechaCorta(l.fechaVencimiento)})` : `Vence el ${formatFechaCorta(l.fechaVencimiento)}`} ·{' '}
                    {estimado ? `~${formatoCantidad(Math.round(l.sinSalida))} sin salida estimada de ${formatoCantidad(l.cantidadRegistrada)}` : `${formatoCantidad(l.cantidadRegistrada)} registradas (sin ritmo de consumo para estimar cuántas se venden)`}
                  </p>
                </div>
                <span className="etiqueta etiqueta-violeta"><Icon name="hoja" size={13} /> {formatFechaCorta(l.fechaVencimiento)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="seccion">
        <h2 className="seccion-titulo">Stock estimado el {diaSel === 0 ? 'día de hoy' : formatFechaCorta(fechaSel)}</h2>
        <ul className="lista-catalogo">
          {lista.map(({ item, p }) => {
            const e = estadoEn(p, diaSel) ?? 'ok';
            const disp = p.puntos[diaSel]?.disponible ?? 0;
            const max = Math.max(...p.puntos.map((x) => x.disponible), p.presentacion.puntoDePedido, 1);
            return (
              <li key={item.presentacion.id}>
                <button type="button" className={`item-catalogo item-proyeccion est-${e}`} onClick={() => setDetalle(item)} data-testid="item-proyeccion">
                  <div className="proyeccion-info">
                    <p className="item-titulo">{nombreItem(item.producto, item.presentacion)}</p>
                    <div className="barra-stock" aria-hidden="true">
                      <span className="barra-relleno" style={{ width: `${Math.min(100, (disp / max) * 100)}%` }} />
                      <span className="barra-punto" style={{ left: `${Math.min(100, (p.presentacion.puntoDePedido / max) * 100)}%` }} />
                    </div>
                    <p className="texto-suave">
                      <strong className={`estado-texto est-${e}`}>{e === 'quiebre' ? <Icon name="alerta" size={14} /> : null} {TEXTO_ESTADO[e]}</strong>
                      {' · '}~{formatoCantidad(Math.round(disp * 10) / 10)} {abreviaturaUnidad(item.presentacion.unidadStock)} (punto {formatoCantidad(item.presentacion.puntoDePedido)})
                    </p>
                    <p className="texto-suave">
                      {p.fechaQuiebre ? `Podría agotarse ≈ ${fechaLarga(p.fechaQuiebre)}` : `Alcanza más de ${horizonte} días`}
                      {p.fechaPuntoPedido && !p.fechaQuiebre ? ` · punto de pedido ≈ ${formatFechaCorta(p.fechaPuntoPedido)}` : ''}
                    </p>
                  </div>
                  <Icon name="derecha" className="icono-suave" />
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {sinDatos.length > 0 && (
        <section className="seccion">
          <h2 className="seccion-titulo">Sin datos suficientes para proyectar</h2>
          <ul className="lista-simple">
            {sinDatos.map(({ item, p }) => (
              <li key={item.presentacion.id} className="item-simple">
                <div>
                  <p className="item-titulo">{nombreItem(item.producto, item.presentacion)}</p>
                  <p className="texto-suave">{p.faltante}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {detalle && <DetalleProyeccion item={detalle} horizonte={horizonte} diaInicial={diaSel} onCerrar={() => setDetalle(null)} />}
    </>
  );
}

/** Detalle de una presentación: gráfico conectado a los datos y simulación del pedido sugerido. */
function DetalleProyeccion({ item, horizonte, diaInicial, onCerrar }: { item: Item; horizonte: number; diaInicial: number; onCerrar: () => void }) {
  const { data, vistas, puede } = useStore();
  const [dia, setDia] = useState(diaInicial);
  const [conPedido, setConPedido] = useState(false);
  const [pedidoDe, setPedidoDe] = useState<Proveedor | null>(null);
  const ahora = new Date();
  const hoy = startOfDay(ahora);

  // Proveedor que pasa antes y su sugerencia (la misma que muestra el asistente de pedido)
  const opciones = proveedoresDe(data, item.presentacion.id)
    .map((prov) => ({ prov, visita: proximaVisita(prov, hoy) }))
    .filter((x): x is { prov: Proveedor; visita: Date } => x.visita !== null)
    .sort((a, b) => a.visita.getTime() - b.visita.getTime());
  const primera = opciones[0];
  const ventana = primera ? ventanaDePedido(primera.prov, hoy) : null;
  const sug = ventana ? sugerir(data, vistas, item, ventana, ahora) : null;
  const diaVisita = primera ? diaDe(isoDate(primera.visita), ahora) : null;

  const base = proyectar(data, vistas, item.presentacion, ahora, { horizonte });
  const simulada = conPedido && sug && diaVisita !== null && sug.cantidad > 0
    ? proyectar(data, vistas, item.presentacion, ahora, { horizonte, pedido: { dia: diaVisita, cantidad: sug.cantidad } })
    : null;
  const p = simulada ?? base;
  const pt = p.puntos[Math.min(dia, p.puntos.length - 1)];

  return (
    <Hoja titulo={nombreItem(item.producto, item.presentacion)} onCerrar={onCerrar}>
      {p.faltante ? <p className="texto-suave">{p.faltante}</p> : (
        <>
          <div className="proyeccion-resumen">
            <div><span className="texto-suave">Registrado</span><strong>{formatoCantidad(p.stockRegistrado ?? 0)}</strong></div>
            <div><span className="texto-suave">Estimado hoy</span><strong>{formatoCantidad(Math.round((p.stockHoy ?? 0) * 10) / 10)}</strong></div>
            <div><span className="texto-suave">Consumo</span><strong>~{formatoCantidad(Math.round((p.ritmo?.porDia ?? 0) * 10) / 10)}/día</strong></div>
          </div>
          <p className="texto-suave">
            Ritmo estimado con {p.ritmo?.periodos} {p.ritmo?.periodos === 1 ? 'período' : 'períodos'} entre conteos ({formatFechaCorta(p.ritmo?.desde ?? '')} al {formatFechaCorta(p.ritmo?.hasta ?? '')}
            {p.ritmo && p.ritmo.descartados > 0 ? `; se descartaron ${p.ritmo.descartados} con consumo negativo` : ''}). Último conteo: {p.fechaConteo ? formatFechaCorta(p.fechaConteo) : '—'}. Supone que el ritmo se mantiene.
          </p>
          <Grafico p={p} base={simulada ? base : null} dia={dia} onDia={setDia} visitas={opciones.map((o) => diaDe(isoDate(o.visita), ahora))} />
          <p className="grafico-lectura" aria-live="polite" data-testid="lectura-grafico">
            {fechaLarga(pt.fecha)}: ~{formatoCantidad(Math.round(pt.disponible * 10) / 10)} {abreviaturaUnidad(item.presentacion.unidadStock)} disponibles
            {pt.vencidoAcumulado > 0 ? ` · ${formatoCantidad(Math.round(pt.vencidoAcumulado))} vencidas sin salida` : ''}
          </p>
          <input className="slider" type="range" min={0} max={horizonte} value={dia} onChange={(e) => setDia(Number(e.target.value))} aria-label="Día de la proyección" />
          <ul className="motivos">
            <li>{p.fechaQuiebre ? `Podría agotarse alrededor del ${fechaLarga(p.fechaQuiebre)}.` : `No se agota en los próximos ${horizonte} días.`}</li>
            {p.fechaPuntoPedido && <li>Baja del punto de pedido ({formatoCantidad(item.presentacion.puntoDePedido)}) alrededor del {fechaLarga(p.fechaPuntoPedido)}.</li>}
            {p.lotesEnRiesgo.map((l) => (
              <li key={l.fechaVencimiento} className={l.sinSalida > 0 ? 'motivo-aviso' : ''}>
                Lote que vence el {formatFechaCorta(l.fechaVencimiento)} ({formatoCantidad(l.cantidadRegistrada)} registradas): {l.sinSalida > 0 ? `~${formatoCantidad(Math.round(l.sinSalida))} podrían quedar sin salida` : 'se vendería antes de vencer'}.
              </li>
            ))}
          </ul>
          {primera && sug && sug.cantidad > 0 && (
            <label className="interruptor">
              <input type="checkbox" checked={conPedido} onChange={(e) => setConPedido(e.target.checked)} />
              <span className="interruptor-pista" aria-hidden="true" />
              <span>Simular el pedido sugerido ({sug.cantidad}) en la visita de {primera.prov.nombre} ({fechaLarga(isoDate(primera.visita))})</span>
            </label>
          )}
          {simulada && (
            <p className="texto-suave">
              Con ese pedido: {simulada.fechaQuiebre ? `se agotaría ≈ ${fechaLarga(simulada.fechaQuiebre)}` : `alcanza todo el período`}
              {base.fechaQuiebre ? ` (sin pedir: ≈ ${fechaLarga(base.fechaQuiebre)})` : ''}.
            </p>
          )}
        </>
      )}
      {primera && puede('pedidos') && (
        <button type="button" className="btn btn-primario btn-bloque boton-pedido" onClick={() => setPedidoDe(primera.prov)}>
          <Icon name="carrito" /> Preparar pedido con {primera.prov.nombre}
        </button>
      )}
      {!primera && <p className="texto-suave">Esta presentación no tiene proveedor con días de visita: asignale uno en Catálogo para poder pedirla.</p>}
      {pedidoDe && <AsistentePedido proveedor={pedidoDe} onCerrar={() => setPedidoDe(null)} />}
    </Hoja>
  );
}

/** Gráfico de la proyección: una línea (disponible estimado) contra el punto de pedido. */
function Grafico({ p, base, dia, onDia, visitas }: { p: Proyeccion; base: Proyeccion | null; dia: number; onDia: (d: number) => void; visitas: number[] }) {
  const W = 340;
  const H = 170;
  const m = { l: 34, r: 10, t: 12, b: 26 };
  const n = p.puntos.length - 1;
  const max = Math.max(...p.puntos.map((x) => x.disponible), ...(base?.puntos.map((x) => x.disponible) ?? []), p.presentacion.puntoDePedido, 1) * 1.1;
  const x = (d: number) => m.l + (d / Math.max(1, n)) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - v / max) * (H - m.t - m.b);
  const linea = (pr: Proyeccion) => pr.puntos.map((pt, i) => `${i === 0 ? 'M' : 'L'}${x(pt.dia).toFixed(1)},${y(pt.disponible).toFixed(1)}`).join(' ');
  const ticks = [0, Math.round(max / 2), Math.round(max * 0.9)];
  const quiebre = p.fechaQuiebre ? p.puntos.find((pt) => pt.fecha === p.fechaQuiebre) : undefined;
  const mover = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    onDia(Math.max(0, Math.min(n, Math.round(((px - m.l) / (W - m.l - m.r)) * n))));
  };
  return (
    <figure className="grafico">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Stock estimado de ${p.presentacion.nombre} día por día`} onPointerMove={mover} onPointerDown={mover}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="g-grilla" />
            <text x={m.l - 6} y={y(t) + 4} className="g-eje" textAnchor="end">{t}</text>
          </g>
        ))}
        {[0, Math.round(n / 2), n].map((d) => (
          <text key={d} x={x(d)} y={H - 8} className="g-eje" textAnchor={d === 0 ? 'start' : d === n ? 'end' : 'middle'}>{d === 0 ? 'hoy' : formatFechaCorta(p.puntos[d].fecha)}</text>
        ))}
        <line x1={m.l} x2={W - m.r} y1={y(p.presentacion.puntoDePedido)} y2={y(p.presentacion.puntoDePedido)} className="g-punto" />
        <text x={W - m.r} y={y(p.presentacion.puntoDePedido) - 4} className="g-etiqueta" textAnchor="end">punto de pedido</text>
        {visitas.filter((d) => d >= 0 && d <= n).map((d) => <line key={`v${d}`} x1={x(d)} x2={x(d)} y1={m.t} y2={H - m.b} className="g-visita" />)}
        {p.lotesEnRiesgo.filter((l) => !l.yaVencido).map((l) => {
          const d = p.puntos.findIndex((pt) => pt.fecha === l.fechaVencimiento);
          return d >= 0 ? <circle key={l.fechaVencimiento} cx={x(d)} cy={H - m.b} r={4} className="g-vence" /> : null;
        })}
        {base && <path d={linea(base)} className="g-linea-base" />}
        <path d={linea(p)} className="g-linea" />
        {quiebre && (
          <>
            <circle cx={x(quiebre.dia)} cy={y(0)} r={5} className="g-quiebre" />
            <text x={x(quiebre.dia)} y={y(0) - 9} className="g-etiqueta g-etiqueta-quiebre" textAnchor={quiebre.dia > n * 0.7 ? 'end' : 'middle'}>se agota</text>
          </>
        )}
        <line x1={x(dia)} x2={x(dia)} y1={m.t} y2={H - m.b} className="g-cursor" />
        <circle cx={x(dia)} cy={y(p.puntos[Math.min(dia, n)].disponible)} r={4.5} className="g-cursor-punto" />
      </svg>
      <figcaption className="grafico-clave">
        <span><i className="clave-linea" /> stock estimado</span>
        <span><i className="clave-punto" /> punto de pedido</span>
        {visitas.length > 0 && <span><i className="clave-visita" /> visita del proveedor</span>}
        {p.lotesEnRiesgo.some((l) => !l.yaVencido) && <span><i className="clave-vence" /> vencimiento</span>}
        {base && <span><i className="clave-base" /> sin pedido</span>}
      </figcaption>
    </figure>
  );
}
