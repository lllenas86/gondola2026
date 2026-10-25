import { useCallback, useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { productosDeProveedor, proveedoresDeProducto } from '../../lib/stock';
import { formatFechaCorta } from '../../lib/dates';
import { leerNumero } from '../../lib/validation';
import { prepararDevolucion } from '../../lib/datos';
import { MOTIVOS, numeroRemito, reservadoEnPreparadas, textoVencimiento } from '../../lib/vencimientos';
import { Campo, Hoja } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { Lote, MotivoDevolucion } from '../../types';

export interface LineaInicial {
  productoId: string;
  fechaVencimiento: string | null;
}

interface Linea {
  key: string;
  productoId: string;
  fechaVencimiento: string | null;
  recepcionId: string | null;
  cantidad: string;
}

const claveLote = (productoId: string, fecha: string | null) => `${productoId}|${fecha ?? ''}`;
const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/**
 * Preparar una devolución o solicitud de cambio. Guardarla NO toca el stock:
 * el stock se descuenta recién cuando se marca como entregada al proveedor.
 */
export function DevolucionForm({ inicial, onCerrar, onPreparada }: { inicial?: LineaInicial; onCerrar: () => void; onPreparada: (id: string) => void }) {
  const { data, vistas, ejecutar, avisar, nuevoId } = useStore();
  const lotePor = useMemo(() => new Map(vistas.lotes.map((l) => [claveLote(l.productoId, l.fechaVencimiento), l])), [vistas.lotes]);
  const nombre = (id: string) => data.productos.find((p) => p.id === id)?.nombre ?? '';

  const loteInicial = inicial ? lotePor.get(claveLote(inicial.productoId, inicial.fechaVencimiento)) : undefined;
  const provInicial = (() => {
    if (!inicial) return data.proveedores[0]?.id ?? '';
    const rec = loteInicial?.recepcionId ? data.recepciones.find((r) => r.id === loteInicial.recepcionId) : undefined;
    return rec?.proveedorId ?? proveedoresDeProducto(data, inicial.productoId)[0]?.id ?? data.proveedores[0]?.id ?? '';
  })();

  const [proveedorId, setProveedorId] = useState(provInicial);
  const [tipo, setTipo] = useState<'devolucion' | 'cambio'>('devolucion');
  const [motivo, setMotivo] = useState<MotivoDevolucion>(loteInicial?.estado === 'vencido' ? 'vencido' : loteInicial ? 'proximo_a_vencer' : 'vencido');
  const [nota, setNota] = useState('');
  const [lineas, setLineas] = useState<Linea[]>(() =>
    loteInicial
      ? [{ key: 'l0', productoId: loteInicial.productoId, fechaVencimiento: loteInicial.fechaVencimiento, recepcionId: loteInicial.recepcionId, cantidad: fmt(loteInicial.cantidad) }]
      : [],
  );
  const [todos, setTodos] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [revisar, setRevisar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const cerrar = useCallback(() => onCerrar(), [onCerrar]);

  const delProveedor = new Set(productosDeProveedor(data, proveedorId).map((p) => p.id));
  const elegibles: Lote[] = vistas.lotes
    .filter((l) => (todos || delProveedor.has(l.productoId)) && !lineas.some((x) => claveLote(x.productoId, x.fechaVencimiento) === claveLote(l.productoId, l.fechaVencimiento)))
    .sort((a, b) => nombre(a.productoId).localeCompare(nombre(b.productoId), 'es') || (a.fechaVencimiento ?? '9').localeCompare(b.fechaVencimiento ?? '9'));

  const agregar = (l: Lote) => {
    setLineas((ls) => [...ls, { key: nuevoId('dl'), productoId: l.productoId, fechaVencimiento: l.fechaVencimiento, recepcionId: l.recepcionId, cantidad: fmt(l.cantidad) }]);
    setAgregando(false);
    setErrorGeneral(null);
  };

  const validar = (): boolean => {
    const err: Record<string, string> = {};
    if (!proveedorId) err.proveedor = 'Elegí el proveedor.';
    for (const l of lineas) {
      const n = leerNumero(l.cantidad);
      const lote = lotePor.get(claveLote(l.productoId, l.fechaVencimiento));
      if (n === null || n === 'invalido' || n <= 0) err[l.key] = 'Indicá una cantidad mayor a 0.';
      else if (!lote || n > lote.cantidad) err[l.key] = `Hay ${lote ? fmt(lote.cantidad) : 0} en este lote: no podés devolver más.`;
    }
    setErrores(err);
    if (lineas.length === 0) {
      setErrorGeneral('Agregá la mercadería que vas a devolver.');
      return false;
    }
    setErrorGeneral(Object.keys(err).length > 0 ? 'Revisá los datos marcados.' : null);
    return Object.keys(err).length === 0;
  };

  const guardar = async () => {
    if (guardando || !validar()) return;
    setGuardando(true);
    const r = await ejecutar(() =>
      prepararDevolucion({
        proveedorId,
        tipo,
        motivo,
        nota,
        lineas: lineas.map((l) => ({
          productoId: l.productoId,
          cantidad: leerNumero(l.cantidad) as number,
          ...(l.fechaVencimiento ? { fechaVencimiento: l.fechaVencimiento } : {}),
          ...(l.recepcionId ? { recepcionId: l.recepcionId } : {}),
        })),
      }),
    );
    setGuardando(false);
    if (!r.ok) {
      setErrorGeneral(r.error.texto);
      return;
    }
    avisar('Devolución preparada. El stock no cambia hasta que la entregues.');
    onPreparada(r.valor);
  };

  const proveedor = data.proveedores.find((p) => p.id === proveedorId);

  return (
    <Hoja
      titulo={revisar ? 'Revisá la devolución' : 'Preparar devolución'}
      onCerrar={cerrar}
      pie={
        <>
          {errorGeneral && <p className="barra-error" role="alert"><Icon name="alerta" size={18} /> {errorGeneral}</p>}
          {revisar ? (
            <div className="barra-botones">
              <button type="button" className="btn btn-fantasma" onClick={() => setRevisar(false)} disabled={guardando}>Volver</button>
              <button type="button" className="btn btn-primario btn-grande" onClick={guardar} disabled={guardando}>
                <Icon name="documento" /> {guardando ? 'Guardando…' : 'Guardar y generar remito'}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-primario btn-bloque btn-grande" onClick={() => validar() && setRevisar(true)}>
              <Icon name="derecha" /> Revisar
            </button>
          )}
        </>
      }
    >
      {revisar ? (
        <>
          <div className="tarjeta">
            <p className="item-titulo">{tipo === 'cambio' ? 'Solicitud de cambio' : 'Devolución'} a {proveedor?.nombre}</p>
            <p className="texto-suave">{MOTIVOS[motivo]}{nota ? ` · ${nota}` : ''}</p>
            <ul className="lista-datos">
              {lineas.map((l) => (
                <li key={l.key}>
                  <strong>{l.cantidad}</strong> × {nombre(l.productoId)}{l.fechaVencimiento ? ` (vence ${formatFechaCorta(l.fechaVencimiento)})` : ''}
                </li>
              ))}
            </ul>
          </div>
          <div className="alerta-amarilla">
            <Icon name="alerta" size={18} />
            <div>
              <p>Al guardar se genera el remito. <strong>El stock no cambia todavía.</strong></p>
              <p>Se descuenta cuando marques que la mercadería se entregó al proveedor. Que el proveedor acepte la devolución o el cambio queda pendiente hasta que lo confirme.</p>
            </div>
          </div>
        </>
      ) : (
        <>
          <Campo etiqueta="Proveedor" error={errores.proveedor} htmlFor="dev-prov">
            <select id="dev-prov" value={proveedorId} onChange={(e) => setProveedorId(e.target.value)}>
              <option value="">Elegí el proveedor</option>
              {data.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <div className="pestanas" role="radiogroup" aria-label="Tipo">
            <button type="button" role="radio" aria-checked={tipo === 'devolucion'} className={tipo === 'devolucion' ? 'activo' : ''} onClick={() => setTipo('devolucion')}>Devolución</button>
            <button type="button" role="radio" aria-checked={tipo === 'cambio'} className={tipo === 'cambio' ? 'activo' : ''} onClick={() => setTipo('cambio')}>Pedir cambio</button>
          </div>
          <div className="fila-2">
            <Campo etiqueta="Motivo" htmlFor="dev-motivo">
              <select id="dev-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoDevolucion)}>
                {(Object.keys(MOTIVOS) as MotivoDevolucion[]).map((m) => <option key={m} value={m}>{MOTIVOS[m]}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Nota (opcional)" htmlFor="dev-nota">
              <input id="dev-nota" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: habló con el preventista" autoComplete="off" />
            </Campo>
          </div>

          <h3 className="subtitulo-form">Mercadería</h3>
          {lineas.length === 0 && <p className="texto-suave nota-form">Todavía no agregaste mercadería.</p>}
          <ul className="lineas">
            {lineas.map((l) => {
              const lote = lotePor.get(claveLote(l.productoId, l.fechaVencimiento));
              const res = reservadoEnPreparadas(data, l.productoId, l.fechaVencimiento);
              return (
                <li key={l.key} className={`linea${errores[l.key] ? ' con-error' : ''}`}>
                  <div className="presentacion-cabecera">
                    <strong>{nombre(l.productoId)}</strong>
                    <button type="button" className="btn-link btn-link-rojo" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}>Quitar</button>
                  </div>
                  <p className="texto-suave">
                    {l.fechaVencimiento ? `Lote: ${textoVencimiento(lote?.diasParaVencer ?? null).toLowerCase()} (${formatFechaCorta(l.fechaVencimiento)})` : 'Sin fecha de vencimiento'}
                    {' · '}en stock: {lote ? fmt(lote.cantidad) : 0}
                  </p>
                  {res.cantidad > 0 && (
                    <p className="linea-aviso">Ya hay {fmt(res.cantidad)} de este lote en {res.devoluciones.map((d) => `la devolución N° ${numeroRemito(d.numero)}`).join(', ')} (preparada).</p>
                  )}
                  <Campo etiqueta="Cantidad a devolver" error={errores[l.key]} htmlFor={`dev-cant-${l.key}`}>
                    <input id={`dev-cant-${l.key}`} inputMode="decimal" value={l.cantidad} onChange={(e) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, cantidad: e.target.value } : x)))} autoComplete="off" />
                  </Campo>
                </li>
              );
            })}
          </ul>

          {agregando ? (
            <div className="tarjeta">
              <div className="presentacion-cabecera">
                <strong>Elegí el lote</strong>
                <button type="button" className="btn-link" onClick={() => setAgregando(false)}>Cerrar</button>
              </div>
              <label className="check-item">
                <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
                <span>Mostrar también productos que no son de {proveedor?.nombre ?? 'este proveedor'}</span>
              </label>
              {elegibles.length === 0 ? (
                <p className="texto-suave">No hay más lotes con stock{todos ? '' : ' de este proveedor'}.</p>
              ) : (
                <ul className="lista-simple">
                  {elegibles.map((l) => (
                    <li key={claveLote(l.productoId, l.fechaVencimiento)}>
                      <button type="button" className="item-simple item-boton" onClick={() => agregar(l)}>
                        <div>
                          <p className="item-titulo">{nombre(l.productoId)}</p>
                          <p className="texto-suave">{l.fechaVencimiento ? `${textoVencimiento(l.diasParaVencer)} (${formatFechaCorta(l.fechaVencimiento)})` : 'Sin fecha'} · {fmt(l.cantidad)} en stock</p>
                        </div>
                        <Icon name="mas" className="icono-suave" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <button type="button" className="btn btn-secundario btn-bloque" onClick={() => setAgregando(true)} disabled={!proveedorId}>
              <Icon name="mas" /> Agregar mercadería
            </button>
          )}
        </>
      )}
    </Hoja>
  );
}
