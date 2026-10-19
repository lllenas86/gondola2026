import { useState, type FormEvent } from 'react';
import { useStore } from '../state/store';
import { validarProveedor, type Errores } from '../lib/validation';
import { productosDeProveedor } from '../lib/stock';
import { guardarProveedor } from '../lib/datos';
import { Campo, Hoja, SelectorDias } from '../components/ui';
import type { DiaSemana, Proveedor } from '../types';

export function ProveedorForm({ proveedor, onCerrar }: { proveedor: Proveedor | null; onCerrar: () => void }) {
  const { data, ejecutar, avisar, nuevoId } = useStore();
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '');
  const [dias, setDias] = useState<DiaSemana[]>(proveedor?.diasDeVisita ?? []);
  const [productoIds, setProductoIds] = useState<string[]>(proveedor ? productosDeProveedor(data, proveedor.id).map((p) => p.id) : []);
  const [errores, setErrores] = useState<Errores>({});
  const [guardando, setGuardando] = useState(false);

  const productos = [...data.productos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    const err = validarProveedor({ nombre, diasDeVisita: dias });
    if (!err.nombre && data.proveedores.some((p) => p.id !== proveedor?.id && p.nombre.trim().toLowerCase() === nombre.trim().toLowerCase())) {
      err.nombre = 'Ya existe un proveedor con ese nombre.';
    }
    setErrores(err);
    if (Object.keys(err).length > 0) return;
    setGuardando(true);
    const r = await ejecutar(() => guardarProveedor(
      { id: proveedor?.id ?? nuevoId('v'), nombre: nombre.trim(), diasDeVisita: [...dias].sort() as DiaSemana[] },
      !proveedor,
      productoIds,
    ));
    setGuardando(false);
    if (!r.ok) {
      setErrores(r.error.campo === 'nombre' || r.error.campo === 'dias' ? { [r.error.campo]: r.error.texto } : { general: r.error.texto });
      return;
    }
    avisar(proveedor ? 'Proveedor actualizado.' : 'Proveedor creado.');
    onCerrar();
  };

  return (
    <Hoja
      titulo={proveedor ? 'Editar proveedor' : 'Nuevo proveedor'}
      onCerrar={onCerrar}
      pie={
        <button type="submit" form="form-proveedor" className="btn btn-primario btn-bloque btn-grande" disabled={guardando}>
          {guardando ? 'Guardando…' : proveedor ? 'Guardar cambios' : 'Crear proveedor'}
        </button>
      }
    >
      <form id="form-proveedor" onSubmit={guardar} noValidate>
        {errores.general && <p className="form-error" role="alert">{errores.general}</p>}
        <Campo etiqueta="Nombre" error={errores.nombre} htmlFor="prov-nombre">
          <input id="prov-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Distribuidora Norte" autoComplete="off" />
        </Campo>

        <Campo etiqueta="Días de visita" error={errores.dias}>
          <SelectorDias valor={dias} onChange={(d) => { setDias(d); setErrores((x) => ({ ...x, dias: '' })); }} />
        </Campo>

        <fieldset className="checklist">
          <legend>Productos que trae ({productoIds.length})</legend>
          {productos.length === 0 && <p className="texto-suave">Todavía no hay productos en el catálogo.</p>}
          {productos.map((p) => (
            <label key={p.id} className="check-item">
              <input
                type="checkbox"
                checked={productoIds.includes(p.id)}
                onChange={(e) => setProductoIds((ids) => (e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id)))}
              />
              <span>{p.nombre}</span>
            </label>
          ))}
        </fieldset>
      </form>
    </Hoja>
  );
}
