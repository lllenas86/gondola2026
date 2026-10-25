import { useState } from 'react';
import { useStore } from '../state/store';
import { Campo, Hoja } from '../components/ui';
import { Icon } from '../components/Icon';
import { formatFechaCorta, formatFechaHora, isoDate } from '../lib/dates';
import { leerNumero } from '../lib/validation';
import {
  abreviaturaUnidad, estadoInventario, formatoCantidad, formatoPesos, itemDe, itemsActivos, nombreDe, nombreItem, proveedoresDe, textoVence, estadoLote,
} from '../lib/inventario';
import {
  actualizarDevolucion, cancelarDevolucion, confirmarDevolucion, prepararDevolucion, registrarBajas, resolverDevolucion, type DatosDevolucion,
} from '../lib/datos';
import { ESTADO_DEVOLUCION, MOTIVO_BAJA, MOTIVO_DEVOLUCION, RESOLUCION, valorDevolucion } from '../lib/vencimientos';
import { linkWhatsApp, telefonoWhatsApp } from '../lib/pedido';
import type { Devolucion, MotivoBaja, MotivoDevolucion, ResolucionDevolucion } from '../types';

// Devolución al proveedor (trazable) y baja por descarte (operación distinta).
//
// Devolución:  preparada (borrador, NO toca el stock) → confirmada (la mercadería salió del
//              almacén: se descuenta una sola vez) → resuelta (qué hizo el proveedor).
// La app no da por hecho que el proveedor acepta: eso se registra al resolver.

export interface LineaInicial {
  presentacionId: string;
  /** Vencimiento del lote (null = sin fecha) */
  fechaVencimiento: string | null;
  cantidad?: number;
  recepcionId?: string;
}

interface LineaForm { key: string; presentacionId: string; lote: string; cantidad: string }

let clave = 0;
const nuevaClave = () => `dl${++clave}`;
/** Identificador del lote dentro de una presentación: fecha + recepción */
const idLote = (fecha: string | null, recepcionId?: string) => `${fecha ?? 'sinfecha'}|${recepcionId ?? ''}`;

function lotesDisponibles(data: ReturnType<typeof useStore>['data'], presentacionId: string) {
  return estadoInventario(data, presentacionId).lotes.map((l) => ({
    id: idLote(l.fechaVencimiento, l.recepcionId),
    fecha: l.fechaVencimiento,
    recepcionId: l.recepcionId,
    cantidad: l.cantidad,
    texto: `${l.fechaVencimiento ? `Vence ${formatFechaCorta(l.fechaVencimiento)}` : 'Sin fecha'} · ${formatoCantidad(l.cantidad)} registradas${l.origen === 'recepcion' && l.recepcionId ? ` · recibidas el ${formatFechaCorta(l.desde)}` : ''}`,
  }));
}

/** Valida las líneas contra lo registrado en cada lote. */
function validarLineas(data: ReturnType<typeof useStore>['data'], lineas: LineaForm[]) {
  const errores: Record<string, string> = {};
  const usados = new Map<string, number>();
  const validas: DatosDevolucion['lineas'] = [];
  for (const l of lineas) {
    if (!l.presentacionId) { errores[l.key] = 'Elegí la presentación.'; continue; }
    const lotes = lotesDisponibles(data, l.presentacionId);
    const lote = lotes.find((x) => x.id === l.lote);
    if (!lote) { errores[l.key] = 'Elegí el lote (vencimiento).'; continue; }
    const n = leerNumero(l.cantidad);
    if (typeof n !== 'number' || n <= 0) { errores[l.key] = 'La cantidad tiene que ser mayor a 0.'; continue; }
    const k = `${l.presentacionId}|${l.lote}`;
    const total = (usados.get(k) ?? 0) + n;
    if (total > lote.cantidad + 1e-9) { errores[l.key] = `Ese lote tiene ${formatoCantidad(lote.cantidad)} registradas.`; continue; }
    usados.set(k, total);
    const x = itemDe(data, l.presentacionId)?.presentacion;
    validas.push({
      presentacionId: l.presentacionId, cantidad: n,
      ...(lote.fecha ? { fechaVencimiento: lote.fecha } : {}),
      ...(lote.recepcionId ? { recepcionId: lote.recepcionId } : {}),
      ...(x?.costoUnitario !== undefined ? { costoUnitario: x.costoUnitario } : {}),
    });
  }
  return { errores, validas };
}

function EditorLineas({ lineas, setLineas, errores }: { lineas: LineaForm[]; setLineas: (f: (l: LineaForm[]) => LineaForm[]) => void; errores: Record<string, string> }) {
  const { data } = useStore();
  const items = itemsActivos(data).filter((it) => estadoInventario(data, it.presentacion.id).lotes.length > 0 || lineas.some((l) => l.presentacionId === it.presentacion.id));
  const cambiar = (key: string, c: Partial<LineaForm>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...c } : l)));
  return (
    <>
      <ul className="lineas">
        {lineas.map((l) => {
          const lotes = l.presentacionId ? lotesDisponibles(data, l.presentacionId) : [];
          const x = l.presentacionId ? itemDe(data, l.presentacionId)?.presentacion : undefined;
          return (
            <li key={l.key} className={`linea${errores[l.key] ? ' con-error' : ''}`} data-testid="linea-devolucion">
              <Campo etiqueta="Presentación" htmlFor={`dp-${l.key}`}>
                <select id={`dp-${l.key}`} value={l.presentacionId} onChange={(e) => cambiar(l.key, { presentacionId: e.target.value, lote: lotesDisponibles(data, e.target.value)[0]?.id ?? '' })}>
                  <option value="">Elegí la presentación</option>
                  {items.map((it) => <option key={it.presentacion.id} value={it.presentacion.id}>{nombreItem(it.producto, it.presentacion)}</option>)}
                </select>
              </Campo>
              <div className="fila-2">
                <Campo etiqueta="Lote" htmlFor={`dl-${l.key}`}>
                  <select id={`dl-${l.key}`} value={l.lote} onChange={(e) => cambiar(l.key, { lote: e.target.value })} disabled={!l.presentacionId}>
                    {lotes.length === 0 && <option value="">Sin stock registrado</option>}
                    {lotes.map((x) => <option key={x.id} value={x.id}>{x.texto}</option>)}
                  </select>
                </Campo>
                <Campo etiqueta={`Cantidad${x ? ` (${abreviaturaUnidad(x.unidadStock)})` : ''}`} htmlFor={`dc-${l.key}`}>
                  <input id={`dc-${l.key}`} inputMode="decimal" value={l.cantidad} onChange={(e) => cambiar(l.key, { cantidad: e.target.value })} autoComplete="off" />
                </Campo>
              </div>
              {errores[l.key] && <p className="campo-msg" role="alert">{errores[l.key]}</p>}
              {lineas.length > 1 && <button type="button" className="btn-link btn-link-rojo" onClick={() => setLineas((ls) => ls.filter((y) => y.key !== l.key))}>Quitar</button>}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn-secundario btn-bloque" onClick={() => setLineas((ls) => [...ls, { key: nuevaClave(), presentacionId: '', lote: '', cantidad: '' }])}>
        <Icon name="mas" /> Agregar otra
      </button>
    </>
  );
}

const lineasDesde = (data: ReturnType<typeof useStore>['data'], iniciales: LineaInicial[]): LineaForm[] =>
  iniciales.length > 0
    ? iniciales.map((l) => {
      const lote = lotesDisponibles(data, l.presentacionId).find((x) => x.fecha === l.fechaVencimiento && (!l.recepcionId || x.recepcionId === l.recepcionId))
        ?? lotesDisponibles(data, l.presentacionId).find((x) => x.fecha === l.fechaVencimiento);
      return { key: nuevaClave(), presentacionId: l.presentacionId, lote: lote?.id ?? '', cantidad: l.cantidad !== undefined ? String(l.cantidad) : lote ? String(lote.cantidad) : '' };
    })
    : [{ key: nuevaClave(), presentacionId: '', lote: '', cantidad: '' }];

/** Preparar (o editar) el remito de devolución. */
export function DevolucionForm({ iniciales = [], devolucion, onCerrar, onGuardada }: {
  iniciales?: LineaInicial[];
  devolucion?: Devolucion;
  onCerrar: () => void;
  onGuardada: (id: string) => void;
}) {
  const { data, ejecutar, avisar } = useStore();
  // Proveedor sugerido: el de la recepción del lote, o el que trae esa presentación
  const sugerido = devolucion?.proveedorId
    ?? iniciales.map((l) => (l.recepcionId ? data.recepciones.find((r) => r.id === l.recepcionId)?.proveedorId : undefined)).find(Boolean)
    ?? (iniciales[0] ? proveedoresDe(data, iniciales[0].presentacionId)[0]?.id : undefined)
    ?? '';
  const [proveedorId, setProveedorId] = useState(sugerido);
  const [fecha, setFecha] = useState(devolucion?.fecha ?? isoDate(new Date()));
  const [motivo, setMotivo] = useState<MotivoDevolucion>(devolucion?.motivo ?? (iniciales.some((l) => l.fechaVencimiento && l.fechaVencimiento < isoDate(new Date())) ? 'vencido' : 'proximo_vencer'));
  const [nota, setNota] = useState(devolucion?.nota ?? '');
  const [lineas, setLineas] = useState<LineaForm[]>(() =>
    devolucion ? lineasDesde(data, devolucion.lineas.map((l) => ({ presentacionId: l.presentacionId, fechaVencimiento: l.fechaVencimiento ?? null, cantidad: l.cantidad, recepcionId: l.recepcionId }))) : lineasDesde(data, iniciales),
  );
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    if (guardando) return;
    const { errores: e, validas } = validarLineas(data, lineas);
    if (!proveedorId) e.proveedor = 'Elegí el proveedor.';
    setErrores(e);
    if (Object.keys(e).length > 0) { setError('Revisá los datos marcados.'); return; }
    setGuardando(true);
    const datos: DatosDevolucion = { proveedorId, fecha, motivo, nota, lineas: validas };
    const r = await ejecutar(async () => (devolucion ? (await actualizarDevolucion(devolucion.id, datos), devolucion.id) : (await prepararDevolucion(datos)).id));
    setGuardando(false);
    if (!r.ok) { setError(r.error.texto); return; }
    avisar('Remito de devolución preparado. Todavía no se descontó stock.');
    onGuardada(r.valor);
  };

  return (
    <Hoja
      titulo={devolucion ? `Editar devolución DEV-${String(devolucion.numero).padStart(4, '0')}` : 'Preparar devolución'}
      onCerrar={onCerrar}
      pie={<button type="button" className="btn btn-primario btn-bloque btn-grande" onClick={() => void guardar()} disabled={guardando}>{guardando ? 'Guardando…' : 'Preparar remito'}</button>}
    >
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="alerta-amarilla"><Icon name="alerta" size={18} /><span>Preparar el remito <strong>no descuenta stock</strong> ni da por aceptada la devolución: que el proveedor la acepte o la reponga se registra después.</span></p>
      <div className="fila-2">
        <Campo etiqueta="Proveedor" error={errores.proveedor} htmlFor="dev-prov">
          <select id="dev-prov" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
            <option value="">Elegí el proveedor</option>
            {data.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Fecha" htmlFor="dev-fecha">
          <input id="dev-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </Campo>
      </div>
      <Campo etiqueta="Motivo" htmlFor="dev-motivo">
        <select id="dev-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoDevolucion)}>
          {Object.entries(MOTIVO_DEVOLUCION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Campo>
      <h3 className="subtitulo-form">Mercadería a devolver</h3>
      <EditorLineas lineas={lineas} setLineas={setLineas} errores={errores} />
      <label className="campo">
        <span>Nota (opcional)</span>
        <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Ej.: Acordado con el repartidor" />
      </label>
    </Hoja>
  );
}

export const numeroDev = (n: number) => `DEV-${String(n).padStart(4, '0')}`;

/** Remito de devolución: legible, imprimible y con las acciones de su estado. */
export function RemitoDevolucion({ devolucionId, onCerrar, onEditar }: { devolucionId: string; onCerrar: () => void; onEditar: (d: Devolucion) => void }) {
  const { data, ejecutar, avisar, perfil, puede } = useStore();
  const d = data.devoluciones.find((x) => x.id === devolucionId);
  const [accion, setAccion] = useState<null | 'confirmar' | 'cancelar' | 'resolver'>(null);
  const [resolucion, setResolucion] = useState<ResolucionDevolucion>('reemplazo');
  const [notaRes, setNotaRes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  if (!d) return null;
  const proveedor = data.proveedores.find((p) => p.id === d.proveedorId);
  const valor = valorDevolucion(data, d);
  const gestiona = puede('devoluciones');

  const ejecutarAccion = async () => {
    if (trabajando || !accion) return;
    setTrabajando(true);
    setError(null);
    const r = await ejecutar(() => (accion === 'confirmar' ? confirmarDevolucion(d.id) : accion === 'cancelar' ? cancelarDevolucion(d.id) : resolverDevolucion(d.id, resolucion, notaRes)));
    setTrabajando(false);
    if (!r.ok) { setError(r.error.texto); return; }
    avisar(accion === 'confirmar' ? 'Devolución confirmada: se descontó del stock.' : accion === 'cancelar' ? 'Devolución cancelada. El stock no cambió.' : 'Resolución registrada.');
    setAccion(null);
  };

  const texto = [
    `Remito de devolución ${numeroDev(d.numero)} · ${formatFechaCorta(d.fecha)}`,
    `${perfil?.almacen ?? 'Almacén'} → ${proveedor?.nombre ?? ''}`,
    `Motivo: ${MOTIVO_DEVOLUCION[d.motivo]}`,
    '',
    ...d.lineas.map((l) => `• ${formatoCantidad(l.cantidad)} × ${nombreDe(data, l.presentacionId)}${l.fechaVencimiento ? ` (vto ${formatFechaCorta(l.fechaVencimiento)})` : ''}`),
    ...(d.nota ? ['', d.nota] : []),
  ].join('\n');

  return (
    <Hoja
      titulo={numeroDev(d.numero)}
      onCerrar={onCerrar}
      pie={
        gestiona && (d.estado === 'preparada' || d.estado === 'confirmada') ? (
          accion ? (
            <div className="acciones-2 sin-margen-arriba">
              <button type="button" className="btn btn-fantasma" onClick={() => setAccion(null)} disabled={trabajando}>Volver</button>
              <button type="button" className={`btn ${accion === 'cancelar' ? 'btn-peligro' : 'btn-primario'}`} onClick={() => void ejecutarAccion()} disabled={trabajando} data-testid="confirmar-accion">
                {trabajando ? 'Guardando…' : accion === 'confirmar' ? 'Sí, salió del almacén' : accion === 'cancelar' ? 'Sí, cancelar' : 'Guardar resolución'}
              </button>
            </div>
          ) : d.estado === 'preparada' ? (
            <div className="acciones-columna sin-margen">
              <button type="button" className="btn btn-primario btn-bloque" onClick={() => setAccion('confirmar')}><Icon name="check" /> Confirmar entrega al proveedor</button>
              <div className="acciones-2 sin-margen-arriba">
                <button type="button" className="btn btn-secundario" onClick={() => onEditar(d)}><Icon name="lapiz" size={18} /> Editar</button>
                <button type="button" className="btn btn-fantasma" onClick={() => setAccion('cancelar')}>Cancelar devolución</button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-primario btn-bloque" onClick={() => setAccion('resolver')}>Registrar qué hizo el proveedor</button>
          )
        ) : undefined
      }
    >
      {error && <p className="form-error" role="alert">{error}</p>}
      {accion === 'confirmar' && (
        <p className="alerta-amarilla" role="alert"><Icon name="alerta" size={18} /><span>Confirmá solo cuando la mercadería <strong>sale del almacén</strong>. Se descuenta del stock en ese momento, una sola vez. No significa que el proveedor la haya aceptado.</span></p>
      )}
      {accion === 'cancelar' && <p className="alerta-amarilla" role="alert"><Icon name="alerta" size={18} /><span>La devolución queda cancelada y no toca el stock.</span></p>}
      {accion === 'resolver' && (
        <div className="tarjeta">
          <Campo etiqueta="¿Qué hizo el proveedor?" htmlFor="res-tipo">
            <select id="res-tipo" value={resolucion} onChange={(e) => setResolucion(e.target.value as ResolucionDevolucion)}>
              {Object.entries(RESOLUCION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          {resolucion === 'reemplazo' && <p className="texto-suave">La mercadería que repone se carga como una recepción normal cuando llega.</p>}
          <label className="campo"><span>Detalle (opcional)</span><textarea rows={2} value={notaRes} onChange={(e) => setNotaRes(e.target.value)} /></label>
        </div>
      )}

      <article className="remito-imprimible" data-testid="remito-devolucion">
        <header className="remito-cabecera">
          <div>
            <p className="remito-tipo">REMITO DE DEVOLUCIÓN</p>
            <p className="remito-numero">{numeroDev(d.numero)}</p>
          </div>
          <span className={`etiqueta estado-${d.estado}`}>{ESTADO_DEVOLUCION[d.estado]}</span>
        </header>
        <dl className="remito-datos">
          <div><dt>De</dt><dd>{perfil?.almacen ?? 'Almacén'}</dd></div>
          <div><dt>Para</dt><dd>{proveedor?.nombre ?? '—'}</dd></div>
          <div><dt>Fecha</dt><dd>{formatFechaCorta(d.fecha)}</dd></div>
          <div><dt>Motivo</dt><dd>{MOTIVO_DEVOLUCION[d.motivo]}</dd></div>
        </dl>
        <table className="tabla-remito">
          <thead><tr><th>Cant.</th><th>Producto · presentación</th><th>Vence</th><th>Recibido</th></tr></thead>
          <tbody>
            {d.lineas.map((l, i) => {
              const rec = l.recepcionId ? data.recepciones.find((r) => r.id === l.recepcionId) : undefined;
              const x = itemDe(data, l.presentacionId)?.presentacion;
              return (
                <tr key={i}>
                  <td>{formatoCantidad(l.cantidad)} {x ? abreviaturaUnidad(x.unidadStock) : ''}</td>
                  <td>{nombreDe(data, l.presentacionId)}</td>
                  <td>{l.fechaVencimiento ? formatFechaCorta(l.fechaVencimiento) : '—'}</td>
                  <td>{rec ? formatFechaCorta(rec.fecha) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {d.nota && <p className="remito-nota">Nota: {d.nota}</p>}
        <p className="remito-nota">
          Valor a costo de referencia: {valor.total > 0 ? formatoPesos(valor.total) : '—'}
          {valor.sinCosto > 0 ? ` (${valor.sinCosto} ${valor.sinCosto === 1 ? 'línea' : 'líneas'} sin costo cargado: no calculable)` : ''}
        </p>
        <ul className="remito-historial">
          <li>Preparada: {formatFechaHora(d.creadaEn)}</li>
          {d.confirmadaEn && <li>Salió del almacén: {formatFechaHora(d.confirmadaEn)} (descontado del stock)</li>}
          {d.resueltaEn && <li>Resuelta: {formatFechaHora(d.resueltaEn)} · {d.resolucion ? RESOLUCION[d.resolucion] : ''}{d.resolucionNota ? ` · ${d.resolucionNota}` : ''}</li>}
          {d.canceladaEn && <li>Cancelada: {formatFechaHora(d.canceladaEn)}</li>}
        </ul>
        <div className="remito-firmas">
          <span>Entregó (almacén)</span>
          <span>Recibió (proveedor)</span>
        </div>
      </article>
      <div className="acciones-2 no-imprimir">
        <button type="button" className="btn btn-secundario" onClick={() => window.print()}><Icon name="documento" size={18} /> Imprimir / PDF</button>
        <a className="btn btn-secundario" href={linkWhatsApp(telefonoWhatsApp(proveedor?.telefono), texto)} target="_blank" rel="noopener noreferrer"><Icon name="enviar" size={18} /> Por WhatsApp</a>
      </div>
    </Hoja>
  );
}

/** Baja por descarte: la mercadería no vuelve al proveedor. Descuenta stock al registrarla. */
export function BajaForm({ iniciales = [], onCerrar }: { iniciales?: LineaInicial[]; onCerrar: () => void }) {
  const { data, ejecutar, avisar } = useStore();
  const [lineas, setLineas] = useState<LineaForm[]>(() => lineasDesde(data, iniciales));
  const [motivo, setMotivo] = useState<MotivoBaja>(iniciales.some((l) => l.fechaVencimiento && estadoLote(l.fechaVencimiento).estado === 'vencido') ? 'vencido' : 'danado');
  const [nota, setNota] = useState('');
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const revisar = () => {
    const { errores: e } = validarLineas(data, lineas);
    setErrores(e);
    if (Object.keys(e).length > 0) { setError('Revisá los datos marcados.'); return; }
    setError(null);
    setConfirmando(true);
  };
  const guardar = async () => {
    const { validas } = validarLineas(data, lineas);
    setGuardando(true);
    const r = await ejecutar(() => registrarBajas(validas.map((l) => ({ presentacionId: l.presentacionId, cantidad: l.cantidad, fechaVencimiento: l.fechaVencimiento, costoUnitario: l.costoUnitario, motivo, nota }))));
    setGuardando(false);
    if (!r.ok) { setError(r.error.texto); setConfirmando(false); return; }
    avisar('Baja registrada: se descontó del stock.');
    onCerrar();
  };
  const { validas } = confirmando ? validarLineas(data, lineas) : { validas: [] };

  return (
    <Hoja
      titulo="Dar de baja (descarte)"
      onCerrar={onCerrar}
      pie={
        confirmando ? (
          <div className="acciones-2 sin-margen-arriba">
            <button type="button" className="btn btn-fantasma" onClick={() => setConfirmando(false)} disabled={guardando}>Volver</button>
            <button type="button" className="btn btn-peligro" onClick={() => void guardar()} disabled={guardando} data-testid="confirmar-baja">{guardando ? 'Guardando…' : 'Sí, dar de baja'}</button>
          </div>
        ) : <button type="button" className="btn btn-primario btn-bloque btn-grande" onClick={revisar}>Revisar baja</button>
      }
    >
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="texto-suave">Para mercadería que se tira o no se puede vender y <strong>no vuelve al proveedor</strong>. Si el proveedor la retira, usá «Devolver al proveedor».</p>
      {confirmando ? (
        <div className="vista-previa confirmando">
          <p className="item-titulo">Se va a descontar del stock:</p>
          <ul>{validas.map((l, i) => <li key={i}>{formatoCantidad(l.cantidad)} × {nombreDe(data, l.presentacionId)}{l.fechaVencimiento ? ` (${textoVence(estadoLote(l.fechaVencimiento).dias).toLowerCase()})` : ''}</li>)}</ul>
          <p className="texto-suave">Las bajas no se editan ni se borran. Si hubo un error, se corrige con el próximo conteo.</p>
        </div>
      ) : (
        <>
          <Campo etiqueta="Motivo" htmlFor="baja-motivo">
            <select id="baja-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoBaja)}>
              {Object.entries(MOTIVO_BAJA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          <EditorLineas lineas={lineas} setLineas={setLineas} errores={errores} />
          <label className="campo"><span>Nota (opcional)</span><textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} /></label>
        </>
      )}
    </Hoja>
  );
}
