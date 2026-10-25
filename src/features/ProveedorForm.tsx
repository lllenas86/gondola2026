import { useState, type FormEvent } from 'react';
import { useStore } from '../state/store';
import { validarProveedor, type Errores } from '../lib/validation';
import { itemsActivos, itemsDeProveedor, nombreItem } from '../lib/inventario';
import { guardarProveedor } from '../lib/datos';
import { telefonoWhatsApp } from '../lib/pedido';
import { Campo, Hoja, SelectorDias } from '../components/ui';
import type { DiaSemana, Proveedor } from '../types';

export function ProveedorForm({ proveedor, onCerrar }: { proveedor: Proveedor | null; onCerrar: () => void }) {
  const { data, vistas, ejecutar, avisar, nuevoId } = useStore();
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '');
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '');
  const [dias, setDias] = useState<DiaSemana[]>(proveedor?.diasDeVisita ?? []);
  const [productoIds, setProductoIds] = useState<string[]>(proveedor ? itemsDeProveedor(data, proveedor.id).map((it) => it.presentacion.id) : []);
  const [errores, setErrores] = useState<Errores>({});
  const [guardando, setGuardando] = useState(false);

  const productos = itemsActivos(data).map((it) => ({ id: it.presentacion.id, nombre: nombreItem(it.producto, it.presentacion) }));

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    const err = validarProveedor({ nombre, diasDeVisita: dias });
    if (vistas.tieneTelefono && telefono.trim() !== '' && !telefonoWhatsApp(telefono)) {
      err.telefono = 'No parece un teléfono válido. Escribilo con código de área, por ejemplo 341 555-1234.';
    }
    if (!err.nombre && data.proveedores.some((p) => p.id !== proveedor?.id && p.nombre.trim().toLowerCase() === nombre.trim().toLowerCase())) {
      err.nombre = 'Ya existe un proveedor con ese nombre.';
    }
    setErrores(err);
    if (Object.keys(err).length > 0) return;
    setGuardando(true);
    const r = await ejecutar(() => guardarProveedor(
      { id: proveedor?.id ?? nuevoId('v'), nombre: nombre.trim(), diasDeVisita: [...dias].sort() as DiaSemana[], telefono: telefono.trim() },
      !proveedor,
      productoIds,
      vistas.tieneTelefono,
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

        {vistas.tieneTelefono && (
          <Campo etiqueta="WhatsApp del proveedor (opcional)" error={errores.telefono} htmlFor="prov-telefono" ayuda="Para mandarle el pedido directo. Con código de área, por ejemplo 341 555-1234.">
            <input id="prov-telefono" type="tel" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="Ej.: 341 555-1234" autoComplete="off" />
          </Campo>
        )}

        <Campo etiqueta="Días de visita" error={errores.dias}>
          <SelectorDias valor={dias} onChange={(d) => { setDias(d); setErrores((x) => ({ ...x, dias: '' })); }} />
        </Campo>

        <fieldset className="checklist">
          <legend>Presentaciones que trae ({productoIds.length})</legend>
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
