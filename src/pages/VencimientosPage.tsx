import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { addDays, formatFechaCorta } from '../lib/dates';
import { abreviaturaUnidad, formatoCantidad, formatoPesos, nombreDe, nombreItem, textoVence } from '../lib/inventario';
import { lotesConAlerta, MOTIVO_BAJA, resumenMermas, sumarValor, valorDevolucion, ESTADO_DEVOLUCION, MOTIVO_DEVOLUCION, type LoteAlerta, type ResumenValor } from '../lib/vencimientos';
import { proyectar } from '../lib/proyeccion';
import { irA } from '../lib/router';
import { Icon } from '../components/Icon';
import { EstadoConexion, Vacio } from '../components/ui';
import { BajaForm, DevolucionForm, numeroDev, RemitoDevolucion, type LineaInicial } from '../features/Devolucion';
import type { Devolucion } from '../types';

// Vencimientos y mermas. Diferencia cuatro cosas que NO son lo mismo:
//   - próxima a vencer (alerta: sigue en stock)
//   - vencida que sigue registrada en stock (alerta: hay que decidir qué hacer)
//   - devuelta al proveedor (devolución confirmada)
//   - descartada (baja)
// Una alerta nunca da de baja nada sola.

type Pestana = 'alertas' | 'devoluciones' | 'bajas';

function Valor({ v }: { v: ResumenValor }) {
  if (v.total === 0 && v.sinCosto > 0) return <span className="texto-suave">Valor no calculable (sin costo cargado)</span>;
  return (
    <span>
      {formatoPesos(v.total)}
      {v.sinCosto > 0 && <small className="texto-suave"> + {v.sinCosto} sin costo</small>}
    </span>
  );
}

export function VencimientosPage({ pestanaInicial }: { pestanaInicial: string | null }) {
  const { data, vistas, puede } = useStore();
  const pestana: Pestana = pestanaInicial === 'devoluciones' || pestanaInicial === 'bajas' ? pestanaInicial : 'alertas';
  const [seleccion, setSeleccion] = useState<Record<string, boolean>>({});
  const [devolviendo, setDevolviendo] = useState<LineaInicial[] | null>(null);
  const [editando, setEditando] = useState<Devolucion | null>(null);
  const [dando, setDando] = useState<LineaInicial[] | null>(null);
  const [remito, setRemito] = useState<string | null>(null);
  const ahora = new Date();
  const gestiona = puede('devoluciones');

  const alertas = useMemo(() => lotesConAlerta(data, ahora, 7), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const vencidos = alertas.filter((a) => a.estado === 'vencido');
  const pronto = alertas.filter((a) => a.estado === 'vence_pronto');
  const semana = alertas.filter((a) => a.estado === 'vence_semana');
  const hace30 = addDays(ahora, -30).toISOString();
  const mermas = resumenMermas(data, hace30);
  const claveDe = (a: LoteAlerta) => `${a.item.presentacion.id}|${a.lote.fechaVencimiento}|${a.lote.recepcionId ?? ''}|${a.lote.origen}`;
  const elegidos = alertas.filter((a) => seleccion[claveDe(a)]);
  const aLinea = (a: LoteAlerta): LineaInicial => ({ presentacionId: a.item.presentacion.id, fechaVencimiento: a.lote.fechaVencimiento, cantidad: a.lote.cantidad, ...(a.lote.recepcionId ? { recepcionId: a.lote.recepcionId } : {}) });

  const grupos: { titulo: string; clase: string; items: LoteAlerta[]; vacio: string }[] = [
    { titulo: 'Vencida y todavía en stock', clase: 'rojo', items: vencidos, vacio: 'No hay mercadería vencida registrada en stock.' },
    { titulo: `Vence en ${3} días o menos`, clase: 'violeta', items: pronto, vacio: 'Nada vence en los próximos 3 días.' },
    { titulo: 'Vence esta semana', clase: 'gris', items: semana, vacio: 'Nada más vence en los próximos 7 días.' },
  ];

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Vencimientos y mermas</p>
        <h1>{vencidos.length > 0 ? `${vencidos.length} ${vencidos.length === 1 ? 'lote vencido' : 'lotes vencidos'} en stock` : 'Vencimientos'}</h1>
      </header>

      <div className="kpis" data-testid="kpis-vencimientos">
        <div className={`kpi${vencidos.length > 0 ? ' kpi-rojo' : ''}`}>
          <span className="kpi-titulo">Vencido en stock</span>
          <strong>{formatoCantidad(vencidos.reduce((a, x) => a + x.lote.cantidad, 0))} u.</strong>
          <Valor v={sumarValor(vencidos.map((x) => x.valor))} />
        </div>
        <div className={`kpi${pronto.length > 0 ? ' kpi-violeta' : ''}`}>
          <span className="kpi-titulo">Vence ≤ 3 días</span>
          <strong>{formatoCantidad(pronto.reduce((a, x) => a + x.lote.cantidad, 0))} u.</strong>
          <Valor v={sumarValor(pronto.map((x) => x.valor))} />
        </div>
        <div className="kpi">
          <span className="kpi-titulo">Devuelto (30 días)</span>
          <strong>{formatoCantidad(mermas.devueltas.cantidad)} u.</strong>
          <Valor v={mermas.devueltas.valor} />
          {mermas.recuperado.total > 0 && <small className="texto-suave">Recuperado: {formatoPesos(mermas.recuperado.total)}</small>}
        </div>
        <div className="kpi">
          <span className="kpi-titulo">Descartado (30 días)</span>
          <strong>{formatoCantidad(mermas.descartadas.cantidad)} u.</strong>
          <Valor v={mermas.descartadas.valor} />
        </div>
      </div>
      <p className="texto-suave nota-seccion">Valores a costo de referencia de cada presentación. Si falta el costo, no se calcula.</p>

      <div className="pestanas pestanas-3" role="tablist">
        {(['alertas', 'devoluciones', 'bajas'] as Pestana[]).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pestana === p} className={pestana === p ? 'activo' : ''} onClick={() => irA('vencimientos', p === 'alertas' ? undefined : { pestana: p })}>
            {p === 'alertas' ? 'Alertas' : p === 'devoluciones' ? 'Devoluciones' : 'Bajas'}
            {p === 'devoluciones' && mermas.abiertas > 0 && <span className="contador-pestana">{mermas.abiertas}</span>}
          </button>
        ))}
      </div>

      {pestana === 'alertas' && (
        <>
          {!gestiona && <p className="alerta-amarilla"><Icon name="alerta" size={18} /><span>Si ves mercadería vencida en la góndola, separala y avisale al encargado: él registra la devolución o la baja.</span></p>}
          {grupos.map((g) => (
            <section key={g.titulo} className="seccion">
              <h2 className={`seccion-titulo titulo-${g.clase}`}>{g.titulo}</h2>
              {g.items.length === 0 ? <p className="texto-suave nota-seccion">{g.vacio}</p> : (
                <ul className="lista-lotes">
                  {g.items.map((a) => {
                    const k = claveDe(a);
                    const prov = a.lote.proveedorId ? data.proveedores.find((p) => p.id === a.lote.proveedorId) : undefined;
                    const proy = a.estado !== 'vencido' && a.dias !== null ? proyectar(data, vistas, a.item.presentacion, ahora, { horizonte: a.dias }) : null;
                    const riesgo = proy?.lotesEnRiesgo.find((l) => l.fechaVencimiento === a.lote.fechaVencimiento);
                    return (
                      <li key={k} className={`lote lote-${g.clase}`} data-testid="lote-alerta">
                        {gestiona && (
                          <input type="checkbox" className="lote-check" aria-label={`Seleccionar ${nombreItem(a.item.producto, a.item.presentacion)}`} checked={!!seleccion[k]} onChange={(e) => setSeleccion((s) => ({ ...s, [k]: e.target.checked }))} />
                        )}
                        <div className="lote-info">
                          <p className="item-titulo">{nombreItem(a.item.producto, a.item.presentacion)}</p>
                          <p className="texto-suave">
                            <strong>{formatoCantidad(a.lote.cantidad)} {abreviaturaUnidad(a.item.presentacion.unidadStock)}</strong> · vence {formatFechaCorta(a.lote.fechaVencimiento as string)}
                            {' · '}{a.lote.origen === 'recepcion' ? `recibido el ${formatFechaCorta(a.lote.desde)}${prov ? ` de ${prov.nombre}` : ''}` : `contado el ${formatFechaCorta(a.lote.desde)}`}
                          </p>
                          <p className="texto-suave">{a.valor === null ? 'Valor no calculable (sin costo)' : `Valor: ${formatoPesos(a.valor)}`}</p>
                          {riesgo && proy?.ritmo && (
                            <p className={riesgo.sinSalida > 0 ? 'motivo-aviso' : 'texto-suave'}>
                              {riesgo.sinSalida > 0 ? `Con el consumo estimado, ~${formatoCantidad(Math.round(riesgo.sinSalida))} podrían quedar sin salida.` : 'Con el consumo estimado, se vendería antes de vencer.'}
                            </p>
                          )}
                          {a.lote.fechaUnica && <p className="texto-suave">Fecha cargada para todo un conteo anterior: puede no aplicar a todas las unidades.</p>}
                        </div>
                        <span className={`etiqueta etiqueta-${g.clase === 'gris' ? 'gris' : g.clase}`}><Icon name="hoja" size={13} /> {textoVence(a.dias)}</span>
                        {gestiona && (
                          <div className="lote-acciones">
                            <button type="button" className="btn btn-secundario btn-chico" onClick={() => setDevolviendo([aLinea(a)])}>Devolver al proveedor</button>
                            <button type="button" className="btn btn-fantasma btn-chico" onClick={() => setDando([aLinea(a)])}>Dar de baja</button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
          {gestiona && elegidos.length > 0 && (
            <div className="barra-accion">
              <div className="barra-botones">
                <button type="button" className="btn btn-fantasma" onClick={() => setDando(elegidos.map(aLinea))}>Dar de baja ({elegidos.length})</button>
                <button type="button" className="btn btn-primario btn-grande" onClick={() => setDevolviendo(elegidos.map(aLinea))}>Devolver ({elegidos.length})</button>
              </div>
            </div>
          )}
        </>
      )}

      {pestana === 'devoluciones' && (
        <section className="seccion">
          {gestiona && <button type="button" className="btn btn-secundario btn-bloque" onClick={() => setDevolviendo([])}><Icon name="mas" /> Nueva devolución</button>}
          {data.devoluciones.length === 0 ? <Vacio titulo="Todavía no se registró ninguna devolución." /> : (
            <ul className="lista-catalogo lista-con-margen">
              {data.devoluciones.map((d) => {
                const prov = data.proveedores.find((p) => p.id === d.proveedorId);
                const v = valorDevolucion(data, d);
                return (
                  <li key={d.id}>
                    <button type="button" className="item-catalogo" onClick={() => setRemito(d.id)} data-testid="item-devolucion">
                      <div>
                        <p className="item-titulo">{numeroDev(d.numero)} · {prov?.nombre ?? '—'}</p>
                        <p className="texto-suave">{formatFechaCorta(d.fecha)} · {MOTIVO_DEVOLUCION[d.motivo]} · {d.lineas.reduce((a, l) => a + l.cantidad, 0)} u.{v.total > 0 ? ` · ${formatoPesos(v.total)}` : ''}</p>
                        <span className={`etiqueta estado-${d.estado}`}>{ESTADO_DEVOLUCION[d.estado]}</span>
                      </div>
                      <Icon name="derecha" className="icono-suave" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {pestana === 'bajas' && (
        <section className="seccion">
          {puede('bajas') && <button type="button" className="btn btn-secundario btn-bloque" onClick={() => setDando([])}><Icon name="mas" /> Nueva baja</button>}
          {data.bajas.length === 0 ? <Vacio titulo="Todavía no se registró ninguna baja." /> : (
            <ul className="lista-simple lista-con-margen">
              {data.bajas.map((b) => {
                const x = data.presentaciones.find((p) => p.id === b.presentacionId);
                const costo = b.costoUnitario ?? x?.costoUnitario;
                return (
                  <li key={b.id} className="item-simple">
                    <div>
                      <p className="item-titulo">{formatoCantidad(b.cantidad)} × {nombreDe(data, b.presentacionId)}</p>
                      <p className="texto-suave">{formatFechaCorta(b.registradaEn)} · {MOTIVO_BAJA[b.motivo]}{b.fechaVencimiento ? ` · vencía ${formatFechaCorta(b.fechaVencimiento)}` : ''}{b.nota ? ` · ${b.nota}` : ''}</p>
                    </div>
                    <span className="texto-suave">{costo === undefined ? 'sin costo' : formatoPesos(Math.round(costo * b.cantidad))}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {devolviendo && (
        <DevolucionForm iniciales={devolviendo} onCerrar={() => setDevolviendo(null)} onGuardada={(id) => { setDevolviendo(null); setSeleccion({}); setRemito(id); }} />
      )}
      {editando && <DevolucionForm devolucion={editando} onCerrar={() => setEditando(null)} onGuardada={(id) => { setEditando(null); setRemito(id); }} />}
      {dando && <BajaForm iniciales={dando} onCerrar={() => { setDando(null); setSeleccion({}); }} />}
      {remito && <RemitoDevolucion devolucionId={remito} onCerrar={() => setRemito(null)} onEditar={(d) => { setRemito(null); setEditando(d); }} />}
    </>
  );
}

