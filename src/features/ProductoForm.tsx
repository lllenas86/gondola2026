import { useCallback, useState, type FormEvent } from 'react';
import { useStore } from '../state/store';
import { validarProducto, leerNumero, type Errores } from '../lib/validation';
import { fichasConPresentaciones } from '../lib/stock';
import { guardarProducto, nombrePresentacion } from '../lib/datos';
import { Campo, Hoja } from '../components/ui';
import type { Producto, Unidad } from '../types';

export const UNIDADES: { valor: Unidad; label: string }[] = [
  { valor: 'unidad', label: 'Unidad' },
  { valor: 'kg', label: 'Kilo' },
  { valor: 'litro', label: 'Litro' },
  { valor: 'paquete', label: 'Paquete' },
  { valor: 'caja', label: 'Caja' },
];

const NUEVA = '__nueva__';

interface Props {
  /** Se mantiene por compatibilidad: este formulario solo crea presentaciones (la edición está en la ficha). */
  producto: null;
  nombreInicial?: string;
  proveedorIdsIniciales?: string[];
  onCerrar: () => void;
  onGuardado?: (producto: Producto) => void;
}

/**
 * Alta rápida desde la recepción: crea un producto nuevo (ficha con presentación «Única»)
 * o agrega una presentación a un producto que ya existe (p. ej. otro tamaño).
 */
export function ProductoForm({ nombreInicial = '', proveedorIdsIniciales = [], onCerrar, onGuardado }: Props) {
  const { data, ejecutar, avisar, nuevoId } = useStore();
  const fichas = fichasConPresentaciones(data);
  const [fichaId, setFichaId] = useState<string>(NUEVA);
  const [nombre, setNombre] = useState(nombreInicial);
  const [presentacion, setPresentacion] = useState('Única');
  const [unidad, setUnidad] = useState<Unidad>('unidad');
  const [perecedero, setPerecedero] = useState(false);
  const [puntoDePedido, setPuntoDePedido] = useState('');
  const [proveedorIds, setProveedorIds] = useState<string[]>(proveedorIdsIniciales);
  const [errores, setErrores] = useState<Errores>({});
  const [guardando, setGuardando] = useState(false);

  const cerrar = useCallback(() => onCerrar(), [onCerrar]);
  const fichaElegida = fichas.find((f) => f.ficha.id === fichaId);

  const elegirFicha = (id: string) => {
    setFichaId(id);
    const f = fichas.find((x) => x.ficha.id === id);
    if (f) {
      // Hereda lo que tienen sus otras presentaciones
      setPerecedero(f.presentaciones[0].perecedero);
      setUnidad(f.presentaciones[0].unidad);
      if (presentacion === 'Única') setPresentacion('');
    } else if (!presentacion) {
      setPresentacion('Única');
    }
    setErrores({});
  };

  const guardar = async (e: FormEvent) => {
    if (e) e.preventDefault();
    if (guardando) return;
    const nombreFicha = fichaElegida ? fichaElegida.ficha.nombre : nombre.trim();
    const err = validarProducto({ nombre: nombreFicha, puntoDePedido });
    const pres = presentacion.trim() || 'Única';
    if (fichaElegida && fichaElegida.presentaciones.some((p) => p.presentacion.trim().toLowerCase() === pres.toLowerCase())) {
      err.presentacion = `«${fichaElegida.ficha.nombre}» ya tiene la presentación «${pres}».`;
    }
    const completo = nombrePresentacion(nombreFicha, pres);
    if (!err.nombre && !err.presentacion && data.productos.some((p) => p.nombre.trim().toLowerCase() === completo.toLowerCase())) {
      err[fichaElegida ? 'presentacion' : 'nombre'] = `Ya existe «${completo}».`;
    }
    setErrores(err);
    if (Object.keys(err).length > 0) return;
    const nuevo: Producto = {
      id: nuevoId('p'),
      nombre: completo,
      unidad,
      perecedero,
      puntoDePedido: leerNumero(puntoDePedido) as number,
      fichaId: fichaElegida?.ficha.id ?? '',
      presentacion: pres,
      unidadesPorPresentacion: 1,
    };
    setGuardando(true);
    const r = await ejecutar(() => guardarProducto(nuevo, true, proveedorIds, nombreFicha));
    setGuardando(false);
    if (!r.ok) {
      setErrores(r.error.campo === 'nombre' || r.error.campo === 'puntoDePedido' ? { [r.error.campo]: r.error.texto } : { general: r.error.texto });
      return;
    }
    avisar(fichaElegida ? 'Presentación agregada.' : 'Producto creado.');
    onGuardado?.(r.valor);
    onCerrar();
  };

  return (
    <Hoja
      titulo="Nuevo producto o presentación"
      onCerrar={cerrar}
      pie={
        <button type="submit" form="form-producto" className="btn btn-primario btn-bloque btn-grande" disabled={guardando}>
          {guardando ? 'Guardando…' : fichaElegida ? 'Agregar presentación' : 'Crear producto'}
        </button>
      }
    >
      <form id="form-producto" onSubmit={guardar} noValidate>
        {errores.general && <p className="form-error" role="alert">{errores.general}</p>}
        <Campo etiqueta="¿Es un producto nuevo?" htmlFor="prod-ficha" ayuda="Si es otro tamaño o envase de algo que ya vendés, elegilo de la lista.">
          <select id="prod-ficha" value={fichaId} onChange={(e) => elegirFicha(e.target.value)}>
            <option value={NUEVA}>Sí, producto nuevo</option>
            <optgroup label="No, otra presentación de:">
              {fichas.map((f) => <option key={f.ficha.id} value={f.ficha.id}>{f.ficha.nombre}</option>)}
            </optgroup>
          </select>
        </Campo>

        {!fichaElegida && (
          <Campo etiqueta="Nombre del producto" error={errores.nombre} htmlFor="prod-nombre">
            <input id="prod-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Fideos tirabuzón 500 g" autoComplete="off" />
          </Campo>
        )}

        <Campo
          etiqueta="Presentación"
          error={errores.presentacion}
          htmlFor="prod-presentacion"
          ayuda={fichaElegida ? `Ya tiene: ${fichaElegida.presentaciones.map((p) => p.presentacion).join(', ')}` : 'Dejá «Única» si el producto tiene un solo tamaño.'}
        >
          <input id="prod-presentacion" value={presentacion} onChange={(e) => setPresentacion(e.target.value)} placeholder="Ej.: 473 ml" autoComplete="off" />
        </Campo>

        <div className="fila-2">
          <Campo etiqueta="Unidad" htmlFor="prod-unidad">
            <select id="prod-unidad" value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)}>
              {UNIDADES.map((u) => <option key={u.valor} value={u.valor}>{u.label}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Punto de pedido" error={errores.puntoDePedido} htmlFor="prod-punto">
            <input id="prod-punto" inputMode="decimal" value={puntoDePedido} onChange={(e) => setPuntoDePedido(e.target.value)} placeholder="0" autoComplete="off" />
          </Campo>
        </div>

        <label className="interruptor">
          <input type="checkbox" checked={perecedero} onChange={(e) => setPerecedero(e.target.checked)} disabled={!!fichaElegida} />
          <span className="interruptor-pista" aria-hidden="true" />
          <span>Es perecedero (pide fecha de vencimiento){fichaElegida ? ' — igual que sus otras presentaciones' : ''}</span>
        </label>

        {data.proveedores.length > 0 && (
          <fieldset className="checklist">
            <legend>Proveedores que traen esta presentación</legend>
            {data.proveedores.map((p) => (
              <label key={p.id} className="check-item">
                <input
                  type="checkbox"
                  checked={proveedorIds.includes(p.id)}
                  onChange={(e) => setProveedorIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
                />
                <span>{p.nombre}</span>
              </label>
            ))}
          </fieldset>
        )}
      </form>
    </Hoja>
  );
}
