import { useCallback, useState } from 'react';
import { useStore } from '../../state/store';
import { cancelarDevolucion, entregarDevolucion, resolverDevolucion } from '../../lib/datos';
import { calcularStock } from '../../lib/stock';
import { numeroRemito } from '../../lib/vencimientos';
import { Campo, Hoja } from '../../components/ui';
import { Icon } from '../../components/Icon';
import { Remito, datosRemito, descargarRemito, imprimirRemito } from './Remito';

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/**
 * Detalle de una devolución y sus pasos:
 *   preparada → (entregar: descuenta stock) → entregada → (respuesta del proveedor) → resuelta
 *   preparada → anulada (el stock nunca cambió)
 */
export function DevolucionDetalle({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const { data, ejecutar, avisar } = useStore();
  const d = data.devoluciones.find((x) => x.id === id);
  const [paso, setPaso] = useState<'ver' | 'entregar' | 'responder' | 'anular'>('ver');
  const [respuesta, setRespuesta] = useState<'aceptada' | 'rechazada' | ''>('');
  const [resolucion, setResolucion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const cerrar = useCallback(() => onCerrar(), [onCerrar]);

  if (!d) return null;
  const r = datosRemito(data, d);
  const total = d.lineas.reduce((a, l) => a + l.cantidad, 0);

  const correr = async (op: () => Promise<void>, ok: string) => {
    if (guardando) return;
    setGuardando(true);
    setError(null);
    const res = await ejecutar(op);
    setGuardando(false);
    if (!res.ok) {
      setError(res.error.texto);
      return;
    }
    avisar(ok);
    setPaso('ver');
  };

  return (
    <Hoja titulo={`${d.tipo === 'cambio' ? 'Cambio' : 'Devolución'} N° ${numeroRemito(d.numero)}`} onCerrar={cerrar}>
      {error && <p className="form-error" role="alert">{error}</p>}

      <Remito r={r} />

      <div className="acciones-2 no-imprimir">
        <button type="button" className="btn btn-secundario" onClick={imprimirRemito}><Icon name="documento" /> Imprimir / PDF</button>
        <button type="button" className="btn btn-secundario" onClick={() => descargarRemito(r)}><Icon name="copiar" /> Descargar</button>
      </div>

      {d.estado === 'preparada' && paso === 'ver' && (
        <div className="acciones-columna no-imprimir">
          <button type="button" className="btn btn-primario btn-grande" onClick={() => setPaso('entregar')}>
            <Icon name="camion" /> Registrar entrega al proveedor
          </button>
          <button type="button" className="btn btn-fantasma" onClick={() => setPaso('anular')}>Anular devolución</button>
        </div>
      )}

      {paso === 'entregar' && (
        <div className="tarjeta no-imprimir">
          <p className="item-titulo">¿La mercadería ya salió del almacén?</p>
          <ul className="lista-datos">
            {d.lineas.map((l) => {
              const p = data.productos.find((x) => x.id === l.productoId);
              const s = p ? calcularStock(data, p).stock ?? 0 : 0;
              return <li key={l.id}>{p?.nombre}: stock {fmt(s)} → <strong>{fmt(s - l.cantidad)}</strong></li>;
            })}
          </ul>
          <p className="texto-suave">Se descuentan {fmt(total)} unidades del stock una sola vez. La respuesta del proveedor queda pendiente.</p>
          <div className="barra-botones">
            <button type="button" className="btn btn-fantasma" onClick={() => setPaso('ver')} disabled={guardando}>Volver</button>
            <button type="button" className="btn btn-primario" onClick={() => correr(() => entregarDevolucion(d.id), 'Entrega registrada: se descontó el stock.')} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Sí, se entregó'}
            </button>
          </div>
        </div>
      )}

      {paso === 'anular' && (
        <div className="tarjeta no-imprimir">
          <p className="item-titulo">¿Anular esta devolución?</p>
          <p className="texto-suave">No se entregó nada, así que el stock no cambia. Queda registrada como anulada.</p>
          <div className="barra-botones">
            <button type="button" className="btn btn-fantasma" onClick={() => setPaso('ver')} disabled={guardando}>Volver</button>
            <button type="button" className="btn btn-primario" onClick={() => correr(() => cancelarDevolucion(d.id), 'Devolución anulada.')} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Anular'}
            </button>
          </div>
        </div>
      )}

      {d.estado === 'entregada' && paso === 'ver' && (
        <div className="acciones-columna no-imprimir">
          <div className="alerta-amarilla">
            <Icon name="reloj" size={18} />
            <p>Pendiente: el proveedor todavía no confirmó si acepta la {d.tipo === 'cambio' ? 'solicitud de cambio' : 'devolución'}.</p>
          </div>
          <button type="button" className="btn btn-primario btn-grande" onClick={() => setPaso('responder')}>
            <Icon name="check" /> Registrar respuesta del proveedor
          </button>
        </div>
      )}

      {paso === 'responder' && (
        <div className="tarjeta no-imprimir">
          <p className="item-titulo">¿Qué respondió el proveedor?</p>
          <div className="pestanas" role="radiogroup" aria-label="Respuesta">
            <button type="button" role="radio" aria-checked={respuesta === 'aceptada'} className={respuesta === 'aceptada' ? 'activo' : ''} onClick={() => setRespuesta('aceptada')}>Aceptó</button>
            <button type="button" role="radio" aria-checked={respuesta === 'rechazada'} className={respuesta === 'rechazada' ? 'activo' : ''} onClick={() => setRespuesta('rechazada')}>Rechazó</button>
          </div>
          <Campo etiqueta="Cómo se resolvió (opcional)" htmlFor="dev-resolucion" ayuda="Ej.: nota de crédito, reemplazo en la próxima visita.">
            <input id="dev-resolucion" value={resolucion} onChange={(e) => setResolucion(e.target.value)} autoComplete="off" />
          </Campo>
          {respuesta === 'aceptada' && d.tipo === 'cambio' && (
            <p className="texto-suave">Cuando llegue la mercadería de reemplazo, cargala en Recepción para que sume al stock.</p>
          )}
          <div className="barra-botones">
            <button type="button" className="btn btn-fantasma" onClick={() => setPaso('ver')} disabled={guardando}>Volver</button>
            <button
              type="button"
              className="btn btn-primario"
              disabled={!respuesta || guardando}
              onClick={() => respuesta && correr(() => resolverDevolucion(d.id, respuesta, resolucion), 'Respuesta registrada.')}
            >
              {guardando ? 'Guardando…' : 'Guardar respuesta'}
            </button>
          </div>
        </div>
      )}
    </Hoja>
  );
}
