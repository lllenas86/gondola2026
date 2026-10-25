import { useCallback, useState } from 'react';
import { useStore } from '../../state/store';
import { formatFechaCorta } from '../../lib/dates';
import { leerNumero } from '../../lib/validation';
import { registrarBaja } from '../../lib/datos';
import { textoVencimiento } from '../../lib/vencimientos';
import { Campo, Hoja } from '../../components/ui';
import { Icon } from '../../components/Icon';
import type { Lote } from '../../types';

const MOTIVOS_BAJA = ['Vencido', 'Roto o dañado', 'En mal estado', 'Otro'];
const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/** Baja por descarte de un lote: la mercadería se tira, no vuelve al proveedor. Descuenta stock. */
export function BajaForm({ lote, onCerrar }: { lote: Lote; onCerrar: () => void }) {
  const { data, ejecutar, avisar } = useStore();
  const producto = data.productos.find((p) => p.id === lote.productoId);
  const [cantidad, setCantidad] = useState(fmt(lote.cantidad));
  const [motivo, setMotivo] = useState(lote.estado === 'vencido' ? 'Vencido' : '');
  const [detalle, setDetalle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const cerrar = useCallback(() => onCerrar(), [onCerrar]);

  const n = leerNumero(cantidad);
  const valida = typeof n === 'number' && n > 0 && n <= lote.cantidad;

  const guardar = async () => {
    if (guardando) return;
    if (!valida) {
      setError(`Indicá una cantidad entre 0 y ${fmt(lote.cantidad)}.`);
      return;
    }
    if (!motivo) {
      setError('Elegí el motivo de la baja.');
      return;
    }
    setGuardando(true);
    const texto = motivo === 'Otro' || detalle.trim() ? `${motivo}${detalle.trim() ? `: ${detalle.trim()}` : ''}` : motivo;
    const r = await ejecutar(() => registrarBaja({ productoId: lote.productoId, cantidad: n as number, fechaVencimiento: lote.fechaVencimiento, motivo: texto }));
    setGuardando(false);
    if (!r.ok) {
      setError(r.error.texto);
      return;
    }
    avisar(`Baja registrada: −${fmt(n as number)} de ${producto?.nombre}.`);
    onCerrar();
  };

  return (
    <Hoja
      titulo="Dar de baja por descarte"
      onCerrar={cerrar}
      pie={
        <button type="button" className="btn btn-primario btn-bloque btn-grande" onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando…' : `Confirmar baja${valida ? ` (−${fmt(n as number)})` : ''}`}
        </button>
      }
    >
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="tarjeta">
        <p className="item-titulo">{producto?.nombre}</p>
        <p className="texto-suave">
          {lote.fechaVencimiento ? `${textoVencimiento(lote.diasParaVencer)} (${formatFechaCorta(lote.fechaVencimiento)})` : 'Sin fecha'} · {fmt(lote.cantidad)} en este lote
        </p>
      </div>
      <Campo etiqueta="Cantidad que se descarta" htmlFor="baja-cant">
        <input id="baja-cant" inputMode="decimal" value={cantidad} onChange={(e) => setCantidad(e.target.value)} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Motivo" htmlFor="baja-motivo">
        <select id="baja-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
          <option value="">Elegí el motivo</option>
          {MOTIVOS_BAJA.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </Campo>
      <Campo etiqueta="Detalle (opcional)" htmlFor="baja-detalle">
        <input id="baja-detalle" value={detalle} onChange={(e) => setDetalle(e.target.value)} autoComplete="off" />
      </Campo>
      <div className="alerta-amarilla">
        <Icon name="alerta" size={18} />
        <p>La baja descuenta el stock y no se puede deshacer. Es distinta de una devolución: la mercadería no vuelve al proveedor.</p>
      </div>
    </Hoja>
  );
}
