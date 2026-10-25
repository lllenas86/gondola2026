import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { formatFechaCorta, formatFechaHora, haceCuanto } from '../lib/dates';
import { leerNumero, validarCantidadConteo } from '../lib/validation';
import { Icon } from '../components/Icon';
import { EstadoConexion, Hoja, Vacio } from '../components/ui';
import { registrarConteos, type NuevoConteo } from '../lib/datos';
import {
  abreviaturaUnidad, DIAS_SIN_CONTEO, diasDesdeConteo, formatoCantidad, itemsActivos, nombreDe, stockDe, ultimoConteo, type Item,
} from '../lib/inventario';
import type { Conteo, LoteContado } from '../types';

// Inventario: se cuentan TODAS las presentaciones del almacén, sin elegir proveedor
// (los proveedores son para comprar). La primera vez que se cuenta una presentación es
// su inventario inicial; después, cada conteo es un recuento periódico. La diferencia
// con lo registrado queda guardada como ajuste (la calcula la base).

type Filtro = 'todas' | 'nunca' | 'desactualizadas' | 'perecederas';

interface LoteFila { key: string; fecha: string; cantidad: string }
interface Fila { cantidad: string; lotes: LoteFila[] }

const BORRADOR = 'gondola.conteo-borrador';
let claveLote = 0;
const nuevaClave = () => `lote${++claveLote}`;

function leerBorrador(): Record<string, Fila> {
  try {
    const t = window.localStorage.getItem(BORRADOR);
    return t ? (JSON.parse(t) as Record<string, Fila>) : {};
  } catch {
    return {};
  }
}

export function ContarPage({ filtroInicial }: { filtroInicial: string | null }) {
  const { data, vistas, ejecutar, avisar, nuevoId } = useStore();
  const [filtro, setFiltro] = useState<Filtro>(
    filtroInicial === 'nunca' || filtroInicial === 'desactualizadas' || filtroInicial === 'perecederas' ? filtroInicial : 'todas',
  );
  const [busqueda, setBusqueda] = useState('');
  const [filas, setFilas] = useState<Record<string, Fila>>(leerBorrador);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [revisando, setRevisando] = useState<NuevoConteo[] | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [sesionVista, setSesionVista] = useState<string | null>(null);
  const ahora = new Date();

  // El borrador queda en este navegador por si se sale de la pantalla a mitad del conteo
  useEffect(() => {
    try {
      if (Object.keys(filas).length === 0) window.localStorage.removeItem(BORRADOR);
      else window.localStorage.setItem(BORRADOR, JSON.stringify(filas));
    } catch {
      /* sin almacenamiento: el borrador dura mientras la pantalla esté abierta */
    }
  }, [filas]);

  const todos = itemsActivos(data);
  const nuncaContadas = todos.filter((it) => !ultimoConteo(data, it.presentacion.id));
  const desactualizadas = todos.filter((it) => {
    const d = diasDesdeConteo(ultimoConteo(data, it.presentacion.id), ahora);
    return d !== null && d > DIAS_SIN_CONTEO;
  });
  const esInicial = todos.length > 0 && nuncaContadas.length === todos.length;

  const q = busqueda.trim().toLowerCase();
  const visibles = useMemo(() => {
    const base = filtro === 'nunca' ? nuncaContadas : filtro === 'desactualizadas' ? desactualizadas : filtro === 'perecederas' ? todos.filter((it) => it.producto.perecedero) : todos;
    return base.filter((it) => !q || `${it.producto.nombre} ${it.presentacion.nombre}`.toLowerCase().includes(q));
  }, [filtro, q, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const grupos = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of visibles) m.set(it.producto.id, [...(m.get(it.producto.id) ?? []), it]);
    return [...m.values()];
  }, [visibles]);

  const fila = (id: string): Fila => filas[id] ?? { cantidad: '', lotes: [] };
  const actualizar = (id: string, cambio: Partial<Fila>) => {
    setFilas((f) => ({ ...f, [id]: { ...(f[id] ?? { cantidad: '', lotes: [] }), ...cambio } }));
    setErrores((e) => {
      if (!e[id]) return e;
      const { [id]: _a, ...resto } = e;
      return resto;
    });
    setErrorGeneral(null);
  };
  const sumar = (id: string, delta: number) => {
    const n = leerNumero(fila(id).cantidad);
    actualizar(id, { cantidad: String(Math.max(0, (typeof n === 'number' ? n : 0) + delta)) });
  };

  const completados = todos.filter((it) => (filas[it.presentacion.id]?.cantidad ?? '').trim() !== '').length;

  const preparar = () => {
    const nuevosErrores: Record<string, string> = {};
    const conteos: NuevoConteo[] = [];
    for (const it of todos) {
      const f = filas[it.presentacion.id];
      if (!f) continue;
      const err = validarCantidadConteo(f.cantidad);
      if (err) {
        nuevosErrores[it.presentacion.id] = err;
        continue;
      }
      const n = leerNumero(f.cantidad);
      const lotesCargados = f.lotes.filter((l) => l.fecha || l.cantidad.trim());
      if (n === null) {
        if (lotesCargados.length > 0) nuevosErrores[it.presentacion.id] = 'Cargá la cantidad total contada.';
        continue;
      }
      if (typeof n !== 'number') continue;
      const lotes: LoteContado[] = [];
      for (const l of lotesCargados) {
        const c = leerNumero(l.cantidad);
        if (!l.fecha || typeof c !== 'number' || c < 0) {
          nuevosErrores[it.presentacion.id] = 'Cada vencimiento necesita fecha y cantidad.';
          break;
        }
        lotes.push({ fechaVencimiento: l.fecha, cantidad: c });
      }
      if (lotes.reduce((a, l) => a + l.cantidad, 0) > n + 1e-9) {
        nuevosErrores[it.presentacion.id] = 'La suma de los vencimientos supera la cantidad contada.';
      }
      if (nuevosErrores[it.presentacion.id]) continue;
      conteos.push({ presentacionId: it.presentacion.id, productoId: it.producto.id, cantidad: n, ...(lotes.length > 0 ? { lotes } : {}) });
    }
    setErrores(nuevosErrores);
    if (Object.keys(nuevosErrores).length > 0) {
      setErrorGeneral('Hay cantidades con error. Corregilas para continuar.');
      return;
    }
    if (conteos.length === 0) {
      setErrorGeneral('Cargá la cantidad de al menos una presentación.');
      return;
    }
    setRevisando(conteos);
  };

  const guardar = async () => {
    if (!revisando || guardando) return;
    setGuardando(true);
    const sesionId = nuevoId();
    const r = await ejecutar(() => registrarConteos(revisando, sesionId));
    setGuardando(false);
    if (!r.ok) {
      // Por ejemplo, la base rechaza un conteo o no hay conexión: no se pierde lo cargado
      setErrorGeneral(r.error.texto);
      setRevisando(null);
      return;
    }
    setFilas({});
    setRevisando(null);
    avisar(revisando.length === 1 ? 'Se guardó 1 conteo. El stock quedó ajustado.' : `Se guardaron ${revisando.length} conteos. El stock quedó ajustado.`);
    setSesionVista(sesionId);
  };

  // Historial: conteos agrupados por sesión
  const sesiones = useMemo(() => {
    const m = new Map<string, Conteo[]>();
    for (const c of data.conteos) {
      if (!c.sesionId) continue;
      m.set(c.sesionId, [...(m.get(c.sesionId) ?? []), c]);
    }
    return [...m.entries()]
      .map(([id, cs]) => ({ id, conteos: cs, fecha: cs.reduce((a, c) => (c.fechaHora > a ? c.fechaHora : a), '') }))
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
      .slice(0, 6);
  }, [data.conteos]);

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Stock</p>
        <h1>{esInicial ? 'Conteo de stock · inventario inicial' : 'Conteo de stock'}</h1>
        <div className="resumen">
          <span className="resumen-item"><strong>{todos.length}</strong> presentaciones</span>
          {nuncaContadas.length > 0 && <span className="resumen-item ambar"><strong>{nuncaContadas.length}</strong> sin stock inicial</span>}
          {desactualizadas.length > 0 && <span className="resumen-item ambar"><strong>{desactualizadas.length}</strong> sin contar hace +{DIAS_SIN_CONTEO} días</span>}
        </div>
      </header>

      {esInicial && (
        <p className="alerta-amarilla">
          <Icon name="alerta" size={20} />
          <span>Todavía no hay stock cargado. Contá lo que hay en el almacén: este primer conteo es el <strong>inventario inicial</strong>. No hace falta elegir proveedor.</span>
        </p>
      )}

      <div className="chips" role="tablist" aria-label="Qué contar">
        {([
          ['todas', `Todas (${todos.length})`],
          ['nunca', `Sin stock inicial (${nuncaContadas.length})`],
          ['desactualizadas', `+${DIAS_SIN_CONTEO} días (${desactualizadas.length})`],
          ['perecederas', 'Perecederas'],
        ] as [Filtro, string][]).map(([f, t]) => (
          <button key={f} type="button" role="tab" aria-selected={filtro === f} className={`chip${filtro === f ? ' activo' : ''}`} onClick={() => setFiltro(f)}>{t}</button>
        ))}
      </div>
      <input type="search" className="buscador buscador-conteo" placeholder="Buscar producto o presentación" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar" />

      {todos.length === 0 && <Vacio titulo="No hay presentaciones en el catálogo. Cargalas en Catálogo." />}
      {todos.length > 0 && visibles.length === 0 && <Vacio titulo="No hay presentaciones con ese filtro." />}

      {grupos.map((items) => (
        <section key={items[0].producto.id} className="grupo-conteo">
          <h2 className="grupo-conteo-titulo">{items[0].producto.nombre}{items[0].producto.perecedero && <Icon name="hoja" size={15} className="icono-violeta" />}</h2>
          <ul className="lista-conteo">
            {items.map((it) => {
              const x = it.presentacion;
              const id = x.id;
              const f = fila(id);
              const err = errores[id];
              const u = ultimoConteo(data, id);
              const registrado = stockDe(data, vistas, id);
              const inputId = `cant-${id}`;
              const n = leerNumero(f.cantidad);
              const sumaLotes = f.lotes.reduce((a, l) => a + (Number(leerNumero(l.cantidad)) || 0), 0);
              return (
                <li key={id} className={`fila-conteo${err ? ' con-error' : ''}${f.cantidad.trim() !== '' && !err ? ' completa' : ''}`} data-testid="fila-conteo">
                  <div className="fila-conteo-cabecera">
                    <label htmlFor={inputId} className="fila-conteo-nombre">{x.nombre === 'Única' ? it.producto.nombre : x.nombre}</label>
                    <span className="texto-suave">
                      {u ? `Registrado: ${registrado === null ? '—' : formatoCantidad(registrado)} · contado ${haceCuanto(u.fechaHora, ahora)}` : 'Sin stock inicial'}
                    </span>
                  </div>
                  <div className="fila-conteo-campos">
                    <div className="contador">
                      <button type="button" className="contador-btn" aria-label={`Restar 1 a ${x.nombre}`} onClick={() => sumar(id, -1)}>−</button>
                      <input
                        id={inputId}
                        className="contador-input"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder={`Cantidad (${abreviaturaUnidad(x.unidadStock)})`}
                        value={f.cantidad}
                        aria-invalid={!!err}
                        onChange={(e) => actualizar(id, { cantidad: e.target.value })}
                      />
                      <button type="button" className="contador-btn" aria-label={`Sumar 1 a ${x.nombre}`} onClick={() => sumar(id, 1)}>+</button>
                    </div>
                  </div>
                  {it.producto.perecedero && (
                    <div className="lotes-conteo">
                      {f.lotes.map((l) => (
                        <div key={l.key} className="lote-fila">
                          <label>
                            <span>Vence</span>
                            <input type="date" value={l.fecha} aria-label={`Vencimiento de ${x.nombre}`} onChange={(e) => actualizar(id, { lotes: f.lotes.map((y) => (y.key === l.key ? { ...y, fecha: e.target.value } : y)) })} />
                          </label>
                          <label>
                            <span>Cantidad</span>
                            <input inputMode="decimal" value={l.cantidad} aria-label={`Cantidad que vence de ${x.nombre}`} onChange={(e) => actualizar(id, { lotes: f.lotes.map((y) => (y.key === l.key ? { ...y, cantidad: e.target.value } : y)) })} />
                          </label>
                          <button type="button" className="btn-icono" aria-label="Quitar vencimiento" onClick={() => actualizar(id, { lotes: f.lotes.filter((y) => y.key !== l.key) })}><Icon name="cerrar" size={18} /></button>
                        </div>
                      ))}
                      <button type="button" className="btn-link" onClick={() => actualizar(id, { lotes: [...f.lotes, { key: nuevaClave(), fecha: '', cantidad: f.lotes.length === 0 && typeof n === 'number' ? String(n) : '' }] })}>
                        <Icon name="mas" size={16} /> {f.lotes.length === 0 ? 'Cargar vencimiento' : 'Otro vencimiento (lote distinto)'}
                      </button>
                      {f.lotes.length > 0 && typeof n === 'number' && n - sumaLotes > 0 && (
                        <p className="texto-suave">{formatoCantidad(n - sumaLotes)} quedan sin fecha cargada.</p>
                      )}
                      {f.lotes.length === 0 && u?.lotes && u.lotes.length > 0 && (
                        <p className="texto-suave">Último conteo: {u.lotes.map((l) => `${formatoCantidad(l.cantidad)} vencen ${formatFechaCorta(l.fechaVencimiento)}`).join(' · ')}</p>
                      )}
                    </div>
                  )}
                  {err && <p className="campo-msg" role="alert">{err}</p>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {sesiones.length > 0 && (
        <section className="seccion">
          <h2 className="seccion-titulo">Conteos de stock anteriores</h2>
          <ul className="lista-catalogo">
            {sesiones.map((s) => {
              const conDif = s.conteos.filter((c) => c.stockRegistrado !== null && Math.abs(c.cantidad - c.stockRegistrado) > 1e-9).length;
              const iniciales = s.conteos.filter((c) => c.tipo === 'inicial').length;
              return (
                <li key={s.id}>
                  <button type="button" className="item-catalogo" onClick={() => setSesionVista(s.id)}>
                    <div>
                      <p className="item-titulo">{formatFechaHora(s.fecha)}</p>
                      <p className="texto-suave">
                        {s.conteos.length} {s.conteos.length === 1 ? 'presentación' : 'presentaciones'}
                        {iniciales > 0 ? ` · ${iniciales} inventario inicial` : ''} · {conDif === 0 ? 'sin diferencias' : `${conDif} con diferencia`}
                      </p>
                    </div>
                    <Icon name="derecha" className="icono-suave" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {todos.length > 0 && (
        <div className="barra-accion">
          {errorGeneral && <p className="barra-error" role="alert"><Icon name="alerta" size={18} /> {errorGeneral}</p>}
          <button type="button" className="btn btn-primario btn-bloque btn-grande" onClick={preparar} disabled={guardando}>
            <Icon name="check" /> {`Revisar y guardar${completados > 0 ? ` (${completados})` : ''}`}
          </button>
        </div>
      )}

      {revisando && <RevisionConteo conteos={revisando} guardando={guardando} onGuardar={() => void guardar()} onVolver={() => setRevisando(null)} />}
      {sesionVista && <DetalleSesion sesionId={sesionVista} onCerrar={() => setSesionVista(null)} />}
    </>
  );
}

/** Antes de guardar: lo contado contra lo registrado. La diferencia será el ajuste. */
function RevisionConteo({ conteos, guardando, onGuardar, onVolver }: { conteos: NuevoConteo[]; guardando: boolean; onGuardar: () => void; onVolver: () => void }) {
  const { data, vistas } = useStore();
  const filas = conteos.map((c) => {
    const registrado = stockDe(data, vistas, c.presentacionId);
    const inicial = !ultimoConteo(data, c.presentacionId);
    return { c, registrado, inicial, dif: registrado === null ? null : c.cantidad - registrado };
  });
  const conDif = filas.filter((f) => f.dif !== null && Math.abs(f.dif) > 1e-9);
  return (
    <Hoja
      titulo="Revisá el conteo de stock"
      onCerrar={onVolver}
      pie={
        <div className="acciones-2 sin-margen-arriba">
          <button type="button" className="btn btn-fantasma" onClick={onVolver} disabled={guardando}>Seguir contando</button>
          <button type="button" className="btn btn-primario" onClick={onGuardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar conteo de stock'}</button>
        </div>
      }
    >
      <p className="texto-suave">
        Al guardar, lo contado pasa a ser el stock de cada presentación. La diferencia con lo registrado queda guardada como ajuste
        {conDif.length > 0 ? ` (${conDif.length} con diferencia)` : ''}. Sin sistema de ventas, una diferencia negativa suele ser lo vendido desde el último conteo.
      </p>
      <table className="tabla-diferencias">
        <thead>
          <tr><th>Presentación</th><th>Registrado</th><th>Contado</th><th>Diferencia</th></tr>
        </thead>
        <tbody>
          {filas.map(({ c, registrado, inicial, dif }) => (
            <tr key={c.presentacionId}>
              <td>{nombreDe(data, c.presentacionId)}{inicial && <span className="etiqueta etiqueta-azul">inicial</span>}</td>
              <td>{registrado === null ? '—' : formatoCantidad(registrado)}</td>
              <td><strong>{formatoCantidad(c.cantidad)}</strong></td>
              <td className={dif === null ? '' : dif < 0 ? 'dif-negativa' : dif > 0 ? 'dif-positiva' : ''}>
                {dif === null ? 'stock inicial' : dif === 0 ? '0' : `${dif > 0 ? '+' : ''}${formatoCantidad(dif)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Hoja>
  );
}

function DetalleSesion({ sesionId, onCerrar }: { sesionId: string; onCerrar: () => void }) {
  const { data } = useStore();
  const conteos = data.conteos.filter((c) => c.sesionId === sesionId);
  if (conteos.length === 0) return null;
  const fecha = conteos.reduce((a, c) => (c.fechaHora > a ? c.fechaHora : a), '');
  return (
    <Hoja titulo={`Conteo de stock del ${formatFechaHora(fecha)}`} onCerrar={onCerrar}>
      <table className="tabla-diferencias">
        <thead>
          <tr><th>Presentación</th><th>Registrado</th><th>Contado</th><th>Ajuste</th></tr>
        </thead>
        <tbody>
          {conteos.map((c) => {
            const dif = c.stockRegistrado === null ? null : c.cantidad - c.stockRegistrado;
            return (
              <tr key={c.id}>
                <td>{nombreDe(data, c.presentacionId)}{c.tipo === 'inicial' && <span className="etiqueta etiqueta-azul">inicial</span>}
                  {c.lotes && c.lotes.length > 0 && <small className="texto-suave bloque">{c.lotes.map((l) => `${formatoCantidad(l.cantidad)} vto ${formatFechaCorta(l.fechaVencimiento)}`).join(' · ')}</small>}
                </td>
                <td>{c.stockRegistrado === null ? '—' : formatoCantidad(c.stockRegistrado)}</td>
                <td><strong>{formatoCantidad(c.cantidad)}</strong></td>
                <td className={dif === null ? '' : dif < 0 ? 'dif-negativa' : dif > 0 ? 'dif-positiva' : ''}>{dif === null ? 'inicial' : `${dif > 0 ? '+' : ''}${formatoCantidad(dif)}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Hoja>
  );
}
