import { useMemo } from 'react';
import { useStore } from '../../state/store';
import { formatFechaCorta, formatFechaHora } from '../../lib/dates';
import { MOTIVOS, numeroRemito } from '../../lib/vencimientos';
import { Vacio } from '../../components/ui';
import type { Conteo, MotivoDevolucion } from '../../types';

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

interface Grupo {
  key: string;
  fecha: string;
  titulo: string;
  notas?: string;
  filas: { productoId: string; contado: number; esperado: number | null; lotes: number }[];
}

/** Historial de conteos (con sus ajustes) y de salidas de stock (devoluciones y bajas). */
export function HistorialStock() {
  const { data } = useStore();
  const nombre = (id: string) => data.productos.find((p) => p.id === id)?.nombre ?? 'Producto eliminado';

  const grupos = useMemo(() => {
    // Una sesión = un conteo. Los conteos anteriores a las sesiones se agrupan por fecha y hora.
    const por = new Map<string, Conteo[]>();
    for (const c of data.conteos) {
      const k = c.sesionId ?? `t:${c.fechaHora}`;
      const arr = por.get(k) ?? [];
      arr.push(c);
      por.set(k, arr);
    }
    const out: Grupo[] = [];
    for (const [k, cs] of por) {
      const sesion = c0Sesion(k);
      const porProducto = new Map<string, { contado: number; esperado: number | null; lotes: number }>();
      for (const c of cs) {
        const x = porProducto.get(c.productoId) ?? { contado: 0, esperado: c.stockEsperado ?? null, lotes: 0 };
        x.contado += c.cantidad;
        x.lotes += 1;
        porProducto.set(c.productoId, x);
      }
      out.push({
        key: k,
        fecha: sesion?.creadaEn ?? cs[0].fechaHora,
        titulo: sesion ? (sesion.tipo === 'inicial' ? 'Inventario inicial' : 'Conteo periódico') : 'Conteo',
        ...(sesion?.notas ? { notas: sesion.notas } : {}),
        filas: [...porProducto].map(([productoId, v]) => ({ productoId, ...v })),
      });
    }
    return out.sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 40);

    function c0Sesion(k: string) {
      return k.startsWith('t:') ? undefined : data.sesiones.find((s) => s.id === k);
    }
  }, [data.conteos, data.sesiones]);

  const devolucionDe = (lineaId?: number) => (lineaId === undefined ? undefined : data.devoluciones.find((d) => d.lineas.some((l) => l.id === lineaId)));

  return (
    <>
      <section className="seccion">
        <h2 className="seccion-titulo">Conteos</h2>
        {grupos.length === 0 && <Vacio titulo="Todavía no hay conteos." />}
        <ul className="lista-simple">
          {grupos.map((g) => {
            const conDif = g.filas.filter((f) => f.esperado !== null && f.esperado !== f.contado).length;
            return (
              <li key={g.key} className="item-historial">
                <details>
                  <summary>
                    <span>
                      <strong>{g.titulo}</strong> · {formatFechaHora(g.fecha)}
                      <span className="texto-suave"> · {g.filas.length} {g.filas.length === 1 ? 'presentación' : 'presentaciones'}{conDif > 0 ? ` · ${conDif} con ajuste` : ''}</span>
                    </span>
                  </summary>
                  {g.notas && <p className="texto-suave">{g.notas}</p>}
                  <div className="tabla-scroll">
                    <table className="tabla-diferencias">
                      <thead><tr><th>Presentación</th><th>Registrado</th><th>Contado</th><th>Ajuste</th></tr></thead>
                      <tbody>
                        {g.filas.sort((a, b) => nombre(a.productoId).localeCompare(nombre(b.productoId), 'es')).map((f) => {
                          const dif = f.esperado === null ? null : f.contado - f.esperado;
                          return (
                            <tr key={f.productoId}>
                              <td>{nombre(f.productoId)}{f.lotes > 1 ? <span className="texto-suave"> ({f.lotes} lotes)</span> : null}</td>
                              <td>{f.esperado === null ? '—' : fmt(f.esperado)}</td>
                              <td>{fmt(f.contado)}</td>
                              <td className={dif === null ? '' : dif < 0 ? 'dif-negativa' : dif > 0 ? 'dif-positiva' : 'dif-cero'}>
                                {dif === null ? '—' : dif === 0 ? 'OK' : `${dif > 0 ? '+' : ''}${fmt(dif)}`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {g.key.startsWith('t:') && <p className="texto-suave">Conteo anterior a la versión con ajustes: no guardó el stock registrado.</p>}
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="seccion">
        <h2 className="seccion-titulo">Salidas de stock</h2>
        {data.movimientos.length === 0 ? (
          <p className="texto-suave nota-seccion">Todavía no hay devoluciones entregadas ni bajas.</p>
        ) : (
          <ul className="lista-simple">
            {data.movimientos.slice(0, 60).map((m) => {
              const dev = devolucionDe(m.devolucionLineaId);
              return (
                <li key={m.id} className="item-simple">
                  <div>
                    <p className="item-titulo">{nombre(m.productoId)}</p>
                    <p className="texto-suave">
                      {formatFechaHora(m.fechaHora)} · −{fmt(m.cantidad)}
                      {m.fechaVencimiento ? ` · lote vence ${formatFechaCorta(m.fechaVencimiento)}` : ''}
                      {m.tipo === 'devolucion'
                        ? ` · ${dev ? `remito N° ${numeroRemito(dev.numero)}` : 'devolución'}${m.motivo && m.motivo in MOTIVOS ? ` · ${MOTIVOS[m.motivo as MotivoDevolucion]}` : ''}`
                        : m.motivo ? ` · ${m.motivo}` : ''}
                    </p>
                  </div>
                  <span className={`etiqueta ${m.tipo === 'baja' ? 'etiqueta-rojo' : 'etiqueta-azul'}`}>{m.tipo === 'baja' ? 'Baja' : 'Devolución'}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
