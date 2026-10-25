import { useCallback, useState } from 'react';
import { useStore } from '../../state/store';
import { formatFechaCorta, formatFechaHora } from '../../lib/dates';
import { proveedoresDeProducto } from '../../lib/stock';
import { accionRecomendada, numeroRemito, origenLote, reservadoEnPreparadas, textoVencimiento } from '../../lib/vencimientos';
import { Hoja } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { Lote } from '../../types';

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');
const clave = (l: Lote) => `${l.productoId}|${l.fechaVencimiento ?? ''}`;

interface Acciones {
  onDevolver: (l: Lote) => void;
  onBaja: (l: Lote) => void;
  onVerDevolucion: (id: string) => void;
}

/**
 * Tablero de vencimientos: lotes vencidos y por vencer (7 días) con su cantidad,
 * de dónde vinieron, qué conviene hacer y acciones directas. Todo sale de la vista v_lotes.
 */
export function Vencimientos({ onDevolver, onBaja, onVerDevolucion, onIrDevoluciones }: Acciones & { onIrDevoluciones: () => void }) {
  const { data, vistas } = useStore();
  const [detalle, setDetalle] = useState<Lote | null>(null);
  const vencidos = vistas.lotes.filter((l) => l.estado === 'vencido').sort((a, b) => (a.diasParaVencer ?? 0) - (b.diasParaVencer ?? 0));
  const porVencer = vistas.lotes.filter((l) => l.estado === 'por_vencer').sort((a, b) => (a.diasParaVencer ?? 0) - (b.diasParaVencer ?? 0));
  const suma = (ls: Lote[]) => fmt(ls.reduce((a, l) => a + l.cantidad, 0));
  const preparadas = data.devoluciones.filter((d) => d.estado === 'preparada').length;
  const esperando = data.devoluciones.filter((d) => d.estado === 'entregada').length;

  const lista = (titulo: string, lotes: Lote[], vacio: string) => (
    <section className="seccion">
      <h2 className="seccion-titulo">{titulo}</h2>
      {lotes.length === 0 ? (
        <p className="texto-suave nota-seccion">{vacio}</p>
      ) : (
        lotes.map((l) => <TarjetaLote key={clave(l)} lote={l} onDetalle={() => setDetalle(l)} onDevolver={onDevolver} onBaja={onBaja} onVerDevolucion={onVerDevolucion} />)
      )}
    </section>
  );

  return (
    <>
      <div className="tablero">
        <div className={`tablero-item${vencidos.length > 0 ? ' rojo' : ''}`}>
          <strong>{vencidos.length}</strong>
          <span>{vencidos.length === 1 ? 'lote vencido' : 'lotes vencidos'}</span>
          <small>{suma(vencidos)} unidades</small>
        </div>
        <div className={`tablero-item${porVencer.length > 0 ? ' ambar' : ''}`}>
          <strong>{porVencer.length}</strong>
          <span>por vencer (7 días)</span>
          <small>{suma(porVencer)} unidades</small>
        </div>
        <button type="button" className="tablero-item tablero-boton" onClick={onIrDevoluciones}>
          <strong>{preparadas}</strong>
          <span>{preparadas === 1 ? 'devolución preparada' : 'devoluciones preparadas'}</span>
          <small>sin entregar</small>
        </button>
        <button type="button" className="tablero-item tablero-boton" onClick={onIrDevoluciones}>
          <strong>{esperando}</strong>
          <span>esperando respuesta</span>
          <small>del proveedor</small>
        </button>
      </div>

      {lista('Vencidos', vencidos, 'No hay mercadería vencida en stock.')}
      {lista('Por vencer en 7 días', porVencer, 'Nada vence en los próximos 7 días.')}

      {detalle && (
        <DetalleLote
          lote={detalle}
          onCerrar={() => setDetalle(null)}
          onDevolver={(l) => { setDetalle(null); onDevolver(l); }}
          onBaja={(l) => { setDetalle(null); onBaja(l); }}
          onVerDevolucion={(id) => { setDetalle(null); onVerDevolucion(id); }}
        />
      )}
    </>
  );
}

function TarjetaLote({ lote, onDetalle, onDevolver, onBaja, onVerDevolucion }: Acciones & { lote: Lote; onDetalle: () => void }) {
  const { data } = useStore();
  const p = data.productos.find((x) => x.id === lote.productoId);
  const res = reservadoEnPreparadas(data, lote.productoId, lote.fechaVencimiento);
  const vencido = lote.estado === 'vencido';
  return (
    <div className={`tarjeta tarjeta-lote ${vencido ? 'lote-vencido' : 'lote-por-vencer'}`}>
      <div className="tarjeta-cabecera">
        <div>
          <p className="item-titulo">{p?.nombre ?? 'Producto'}</p>
          <p className="texto-suave">
            <strong>{fmt(lote.cantidad)}</strong> u. · vence el {lote.fechaVencimiento ? formatFechaCorta(lote.fechaVencimiento) : '—'} · {origenLote(data, lote)}
          </p>
        </div>
        <span className={`etiqueta ${vencido ? 'etiqueta-rojo' : (lote.diasParaVencer ?? 9) <= 3 ? 'etiqueta-ambar' : 'etiqueta-gris'}`}>
          <Icon name="hoja" size={13} /> {textoVencimiento(lote.diasParaVencer)}
        </span>
      </div>
      <p className="accion-sugerida"><Icon name="derecha" size={16} /> {accionRecomendada(lote)}</p>
      {res.devoluciones.length > 0 && (
        <p className="linea-aviso">
          {fmt(res.cantidad)} u. ya están en{' '}
          {res.devoluciones.map((d, i) => (
            <span key={d.id}>
              {i > 0 ? ', ' : ''}
              <button type="button" className="btn-link" onClick={() => onVerDevolucion(d.id)}>la devolución N° {numeroRemito(d.numero)}</button>
            </span>
          ))}{' '}
          (preparada, todavía sin entregar).
        </p>
      )}
      <div className="acciones-lote">
        <button type="button" className="btn btn-fantasma btn-chico" onClick={onDetalle}>Ver lote</button>
        <button type="button" className="btn btn-secundario btn-chico" onClick={() => onDevolver(lote)}>Preparar devolución</button>
        <button type="button" className="btn btn-secundario btn-chico" onClick={() => onBaja(lote)}>Dar de baja</button>
      </div>
    </div>
  );
}

function DetalleLote({ lote, onCerrar, onDevolver, onBaja, onVerDevolucion }: Acciones & { lote: Lote; onCerrar: () => void }) {
  const { data } = useStore();
  const cerrar = useCallback(() => onCerrar(), [onCerrar]);
  const p = data.productos.find((x) => x.id === lote.productoId);
  const ficha = data.fichas.find((f) => f.id === p?.fichaId);
  const rec = lote.recepcionId ? data.recepciones.find((r) => r.id === lote.recepcionId) : undefined;
  const provRec = rec ? data.proveedores.find((x) => x.id === rec.proveedorId)?.nombre : undefined;
  const provs = proveedoresDeProducto(data, lote.productoId);
  const salidas = data.movimientos.filter((m) => m.productoId === lote.productoId && (m.fechaVencimiento ?? null) === lote.fechaVencimiento);
  const devs = data.devoluciones.filter((d) => d.lineas.some((l) => l.productoId === lote.productoId && (l.fechaVencimiento ?? null) === lote.fechaVencimiento));

  return (
    <Hoja titulo="Detalle del lote" onCerrar={cerrar}>
      <div className="tarjeta">
        <p className="item-titulo">{p?.nombre}</p>
        <ul className="lista-datos">
          <li>Producto: {ficha?.nombre ?? '—'} · presentación {p?.presentacion}</li>
          <li>Vencimiento: <strong>{lote.fechaVencimiento ? formatFechaCorta(lote.fechaVencimiento) + '/' + lote.fechaVencimiento.slice(0, 4) : '—'}</strong> ({textoVencimiento(lote.diasParaVencer).toLowerCase()})</li>
          <li>Cantidad en stock: <strong>{fmt(lote.cantidad)}</strong></li>
          <li>Origen: {rec ? `recepción del ${formatFechaCorta(rec.fecha)}${provRec ? ` de ${provRec}` : ''}` : 'conteo de stock'}</li>
          <li>Proveedores de esta presentación: {provs.length > 0 ? provs.map((x) => x.nombre).join(', ') : 'ninguno asignado'}</li>
        </ul>
        <p className="accion-sugerida"><Icon name="derecha" size={16} /> {accionRecomendada(lote)}</p>
      </div>

      {(devs.length > 0 || salidas.length > 0) && (
        <section className="seccion">
          <h3 className="subtitulo-form">Movimientos de este lote</h3>
          <ul className="lista-datos">
            {devs.map((d) => (
              <li key={d.id}>
                <button type="button" className="btn-link" onClick={() => onVerDevolucion(d.id)}>Devolución N° {numeroRemito(d.numero)}</button> · {d.estado}
              </li>
            ))}
            {salidas.filter((m) => m.tipo === 'baja').map((m) => (
              <li key={m.id}>Baja {formatFechaHora(m.fechaHora)}: −{fmt(m.cantidad)} ({m.motivo})</li>
            ))}
          </ul>
        </section>
      )}

      <div className="acciones-columna">
        <button type="button" className="btn btn-primario" onClick={() => onDevolver(lote)}><Icon name="camion" /> Preparar devolución</button>
        <button type="button" className="btn btn-secundario" onClick={() => onBaja(lote)}>Dar de baja por descarte</button>
      </div>
    </Hoja>
  );
}
