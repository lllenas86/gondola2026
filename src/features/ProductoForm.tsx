import { useCallback, useState, type FormEvent } from 'react';
import { useStore } from '../state/store';
import { validarProducto, leerNumero, type Errores } from '../lib/validation';
import { proveedoresDeProducto } from '../lib/stock';
import { Campo, Hoja } from '../components/ui';
import type { Producto, Unidad } from '../types';

const UNIDADES: { valor: Unidad; label: string }[] = [
  { valor: 'unidad', label: 'Unidad' },
  { valor: 'kg', label: 'Kilo' },
  { valor: 'litro', label: 'Litro' },
  { valor: 'paquete', label: 'Paquete' },
  { valor: 'caja', label: 'Caja' },
];

interface Props {
  producto: Producto | null;
  nombreInicial?: string;
  proveedorIdsIniciales?: string[];
  onCerrar: () => void;
  onGuardado?: (producto: Producto) => void;
}

export function ProductoForm({ producto, nombreInicial = '', proveedorIdsIniciales = [], onCerrar, onGuardado }: Props) {
  const { data, dispatch, avisar, nuevoId } = useStore();
  const [nombre, setNombre] = useState(producto?.nombre ?? nombreInicial);
  const [unidad, setUnidad] = useState<Unidad>(producto?.unidad ?? 'unidad');
  const [perecedero, setPerecedero] = useState(producto?.perecedero ?? false);
  const [puntoDePedido, setPuntoDePedido] = useState(producto ? String(producto.puntoDePedido) : '');
  const [proveedorIds, setProveedorIds] = useState<string[]>(
    producto ? proveedoresDeProducto(data, producto.id).map((p) => p.id) : proveedorIdsIniciales,
  );
  const [errores, setErrores] = useState<Errores>({});

  const cerrar = useCallback(() => onCerrar(), [onCerrar]);

  const guardar = (e: FormEvent) => {
    e.preventDefault();
    const err = validarProducto({ nombre, puntoDePedido });
    const nombreLimpio = nombre.trim();
    if (!err.nombre && data.productos.some((p) => p.id !== producto?.id && p.nombre.trim().toLowerCase() === nombreLimpio.toLowerCase())) {
      err.nombre = 'Ya existe un producto con ese nombre.';
    }
    setErrores(err);
    if (Object.keys(err).length > 0) return;
    const guardado: Producto = {
      id: producto?.id ?? nuevoId('p'),
      nombre: nombreLimpio,
      unidad,
      perecedero,
      puntoDePedido: leerNumero(puntoDePedido) as number,
    };
    dispatch({ type: 'guardarProducto', producto: guardado, proveedorIds });
    avisar(producto ? 'Producto actualizado.' : 'Producto creado.');
    onGuardado?.(guardado);
    onCerrar();
  };

  return (
    <Hoja
      titulo={producto ? 'Editar producto' : 'Nuevo producto'}
      onCerrar={cerrar}
      pie={
        <button type="submit" form="form-producto" className="btn btn-primario btn-bloque btn-grande">
          {producto ? 'Guardar cambios' : 'Crear producto'}
        </button>
      }
    >
      <form id="form-producto" onSubmit={guardar} noValidate>
        <Campo etiqueta="Nombre" error={errores.nombre} htmlFor="prod-nombre">
          <input id="prod-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Fideos tirabuzón 500 g" autoComplete="off" />
        </Campo>

        <Campo etiqueta="Unidad" htmlFor="prod-unidad">
          <select id="prod-unidad" value={unidad} onChange={(e) => setUnidad(e.target.value as Unidad)}>
            {UNIDADES.map((u) => <option key={u.valor} value={u.valor}>{u.label}</option>)}
          </select>
        </Campo>

        <Campo
          etiqueta="Punto de pedido"
          error={errores.puntoDePedido}
          ayuda="Cuando el stock llega a este número, el producto se marca para pedir."
          htmlFor="prod-punto"
        >
          <input id="prod-punto" inputMode="decimal" value={puntoDePedido} onChange={(e) => setPuntoDePedido(e.target.value)} placeholder="0" autoComplete="off" />
        </Campo>

        <label className="interruptor">
          <input type="checkbox" checked={perecedero} onChange={(e) => setPerecedero(e.target.checked)} />
          <span className="interruptor-pista" aria-hidden="true" />
          <span>Es perecedero (pide fecha de vencimiento al contar)</span>
        </label>

        {data.proveedores.length > 0 && (
          <fieldset className="checklist">
            <legend>Proveedores que lo traen</legend>
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
