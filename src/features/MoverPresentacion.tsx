import { useCallback, useState } from 'react';
import { useStore } from '../state/store';
import { calcularStock, fichasConPresentaciones, proveedoresDeProducto } from '../lib/stock';
import { moverPresentacion, nombrePresentacion } from '../lib/datos';
import { Campo, Hoja } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Producto, UnidadContenido } from '../types';

const familia = (u?: UnidadContenido) => (!u ? null : u === 'ml' || u === 'l' ? 'volumen' : u === 'g' || u === 'kg' ? 'peso' : 'unidad');

/**
 * «Mover a otro producto»: agrupa a mano presentaciones que estaban cargadas como productos separados.
 * Muestra qué se mueve y qué pasa con el stock, valida compatibilidad y pide confirmación.
 * La base vuelve a validar todo y registra el cambio (tabla cambios_ficha).
 */
export function MoverPresentacion({ presentacion, onCerrar, onMovida }: { presentacion: Producto; onCerrar: () => void; onMovida: () => void }) {
  const { data, ejecutar, avisar } = useStore();
  const origen = data.fichas.find((f) => f.id === presentacion.fichaId);
  const destinos = fichasConPresentaciones(data).filter((f) => f.ficha.id !== presentacion.fichaId);
  const [destinoId, setDestinoId] = useState('');
  const [nuevoNombre, setNuevoNombre] = useState(presentacion.presentacion);
  const [entendido, setEntendido] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cerrar = useCallback(() => onCerrar(), [onCerrar]);

  const destino = destinos.find((f) => f.ficha.id === destinoId);
  const stock = calcularStock(data, presentacion).stock;
  const nConteos = new Set(data.conteos.filter((c) => c.productoId === presentacion.id).map((c) => c.fechaHora)).size;
  const nRecepciones = data.recepciones.filter((r) => r.lineas.some((l) => l.productoId === presentacion.id)).length;
  const nSalidas = data.movimientos.filter((m) => m.productoId === presentacion.id).length;
  const provs = proveedoresDeProducto(data, presentacion.id);
  const quedaVacia = data.productos.filter((p) => p.fichaId === presentacion.fichaId).length === 1;

  const pres = nuevoNombre.trim() || presentacion.presentacion;
  const problemas: string[] = [];
  if (destino) {
    if (destino.presentaciones.some((p) => p.perecedero !== presentacion.perecedero)) problemas.push('No son compatibles: una es perecedera y la otra no.');
    const fam = familia(presentacion.unidadContenido);
    if (fam && destino.presentaciones.some((p) => familia(p.unidadContenido) && familia(p.unidadContenido) !== fam)) {
      problemas.push('No son compatibles: las presentaciones del destino se miden distinto (volumen, peso o unidades).');
    }
    if (destino.presentaciones.some((p) => p.presentacion.trim().toLowerCase() === pres.toLowerCase())) {
      problemas.push(`«${destino.ficha.nombre}» ya tiene una presentación «${pres}». Cambiale el nombre (p. ej. el tamaño) para moverla.`);
    }
    const completo = nombrePresentacion(destino.ficha.nombre, pres);
    if (data.productos.some((p) => p.id !== presentacion.id && p.nombre.trim().toLowerCase() === completo.toLowerCase())) {
      problemas.push(`Ya existe otra presentación llamada «${completo}».`);
    }
  }

  const mover = async () => {
    if (!destino || problemas.length > 0 || !entendido || guardando) return;
    setGuardando(true);
    const r = await ejecutar(() => moverPresentacion(presentacion.id, destino.ficha.id, pres));
    setGuardando(false);
    if (!r.ok) {
      setError(r.error.texto);
      return;
    }
    avisar(`«${presentacion.nombre}» ahora es «${nombrePresentacion(destino.ficha.nombre, pres)}».`);
    onMovida();
  };

  return (
    <Hoja
      titulo="Mover a otro producto"
      onCerrar={cerrar}
      pie={
        <button type="button" className="btn btn-primario btn-bloque btn-grande" onClick={mover} disabled={!destino || problemas.length > 0 || !entendido || guardando}>
          {guardando ? 'Moviendo…' : 'Confirmar y mover'}
        </button>
      }
    >
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="tarjeta tarjeta-nota-suave">
        <p className="texto-suave">Se mueve</p>
        <p className="item-titulo">{presentacion.nombre}</p>
        <ul className="lista-datos">
          <li>Stock actual: <strong>{stock ?? 'sin datos'}</strong></li>
          <li>Historial: {nConteos} {nConteos === 1 ? 'conteo' : 'conteos'}, {nRecepciones} {nRecepciones === 1 ? 'recepción' : 'recepciones'}, {nSalidas} {nSalidas === 1 ? 'salida' : 'salidas'}</li>
          <li>Proveedores: {provs.length > 0 ? provs.map((p) => p.nombre).join(', ') : 'ninguno'}</li>
        </ul>
      </div>

      <Campo etiqueta="¿A qué producto?" htmlFor="mover-destino">
        <select id="mover-destino" value={destinoId} onChange={(e) => { setDestinoId(e.target.value); setEntendido(false); setError(null); }}>
          <option value="">Elegí el producto</option>
          {destinos.map((f) => <option key={f.ficha.id} value={f.ficha.id}>{f.ficha.nombre} ({f.presentaciones.map((p) => p.presentacion).join(', ')})</option>)}
        </select>
      </Campo>

      <Campo etiqueta="Nombre de la presentación en el destino" htmlFor="mover-pres" ayuda="Ej.: 473 ml. Si queda «Única», se repite con la del destino.">
        <input id="mover-pres" value={nuevoNombre} onChange={(e) => { setNuevoNombre(e.target.value); setEntendido(false); }} autoComplete="off" />
      </Campo>

      {destino && problemas.length > 0 && (
        <div className="alerta-roja" role="alert">
          <Icon name="alerta" size={18} />
          <div>{problemas.map((p) => <p key={p}>{p}</p>)}</div>
        </div>
      )}

      {destino && problemas.length === 0 && (
        <div className="tarjeta">
          <p className="item-titulo">Qué va a pasar</p>
          <ul className="lista-datos">
            <li>Pasa a llamarse <strong>{nombrePresentacion(destino.ficha.nombre, pres)}</strong>.</li>
            <li>Su stock ({stock ?? 'sin datos'}) <strong>no cambia</strong> y sigue separado: no se suma a {destino.presentaciones.map((p) => `«${p.presentacion}»`).join(', ')}.</li>
            <li>Sus conteos, recepciones, salidas y proveedores quedan con esta presentación. No se mezclan historiales.</li>
            {quedaVacia && <li>«{origen?.nombre}» queda sin presentaciones: se archiva (no se borra).</li>}
            <li>El cambio queda registrado.</li>
          </ul>
          <label className="check-item check-confirmar">
            <input type="checkbox" checked={entendido} onChange={(e) => setEntendido(e.target.checked)} />
            <span>Revisé los datos y quiero moverla.</span>
          </label>
          <p className="texto-suave">Si estabas editando este producto, los cambios sin guardar se descartan.</p>
        </div>
      )}
    </Hoja>
  );
}
