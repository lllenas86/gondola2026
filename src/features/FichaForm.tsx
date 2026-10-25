import { useCallback, useState, type FormEvent } from 'react';
import { useStore } from '../state/store';
import { leerNumero, type Errores } from '../lib/validation';
import { calcularStock, ordenPresentaciones, proveedoresDeProducto } from '../lib/stock';
import { guardarFicha, nombrePresentacion, type PresentacionAGuardar } from '../lib/datos';
import { Campo, Hoja } from '../components/ui';
import { Icon } from '../components/Icon';
import { UNIDADES } from './ProductoForm';
import { MoverPresentacion } from './MoverPresentacion';
import type { Ficha, Producto, Unidad, UnidadContenido } from '../types';

const UNIDADES_CONTENIDO: { valor: UnidadContenido; label: string }[] = [
  { valor: 'ml', label: 'ml' },
  { valor: 'l', label: 'litros' },
  { valor: 'g', label: 'gramos' },
  { valor: 'kg', label: 'kilos' },
  { valor: 'unidad', label: 'unidades' },
];

interface FilaPres {
  key: string;
  /** null = presentación nueva */
  original: Producto | null;
  presentacion: string;
  contenido: string;
  unidadContenido: UnidadContenido | '';
  equivalencia: string;
  unidad: Unidad;
  puntoDePedido: string;
  proveedorIds: string[];
}

const num = (n: number | undefined) => (n === undefined ? '' : String(n).replace('.', ','));

interface Props {
  /** null = producto nuevo */
  ficha: Ficha | null;
  onCerrar: () => void;
}

/** Ficha única de producto con sus presentaciones (catálogo). */
export function FichaForm({ ficha, onCerrar }: Props) {
  const { data, ejecutar, avisar, nuevoId } = useStore();
  const existentes = ficha ? data.productos.filter((p) => p.fichaId === ficha.id).sort(ordenPresentaciones) : [];
  const [nombre, setNombre] = useState(ficha?.nombre ?? '');
  const [perecedero, setPerecedero] = useState(existentes[0]?.perecedero ?? false);
  const [filas, setFilas] = useState<FilaPres[]>(() =>
    existentes.length > 0
      ? existentes.map((p) => ({
          key: p.id,
          original: p,
          presentacion: p.presentacion,
          contenido: num(p.contenido),
          unidadContenido: p.unidadContenido ?? '',
          equivalencia: num(p.unidadesPorPresentacion),
          unidad: p.unidad,
          puntoDePedido: num(p.puntoDePedido),
          proveedorIds: proveedoresDeProducto(data, p.id).map((x) => x.id),
        }))
      : [nuevaFila('Única')],
  );
  const [errores, setErrores] = useState<Errores>({});
  const [guardando, setGuardando] = useState(false);
  const [moviendo, setMoviendo] = useState<Producto | null>(null);

  function nuevaFila(presentacion = ''): FilaPres {
    return {
      key: nuevoId('pres'), original: null, presentacion, contenido: '', unidadContenido: '', equivalencia: '1',
      unidad: 'unidad', puntoDePedido: '', proveedorIds: [],
    };
  }

  const cerrar = useCallback(() => onCerrar(), [onCerrar]);
  const cambiar = (key: string, c: Partial<FilaPres>) => {
    setFilas((fs) => fs.map((f) => (f.key === key ? { ...f, ...c } : f)));
    setErrores({});
  };

  const agregar = () => {
    // Si hasta ahora era «Única», hay que ponerle nombre a esa presentación
    setFilas((fs) => [...fs, nuevaFila()]);
  };

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    const err: Errores = {};
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) err.nombre = 'Escribí el nombre del producto.';
    const vistos = new Set<string>();
    const aGuardar: PresentacionAGuardar[] = [];
    for (const f of filas) {
      const pres = f.presentacion.trim();
      if (!pres) err[`${f.key}.presentacion`] = 'Escribí la presentación (p. ej. 473 ml).';
      else if (vistos.has(pres.toLowerCase())) err[`${f.key}.presentacion`] = 'Está repetida.';
      vistos.add(pres.toLowerCase());
      if (filas.length > 1 && pres.toLowerCase() === 'única') err[`${f.key}.presentacion`] = 'Con más de una presentación, poné el tamaño o envase (p. ej. 1 L).';
      const pp = leerNumero(f.puntoDePedido);
      if (pp === null || pp === 'invalido' || pp < 0) err[`${f.key}.punto`] = 'Indicá un número (puede ser 0).';
      const cont = leerNumero(f.contenido);
      if (cont === 'invalido' || (typeof cont === 'number' && cont <= 0)) err[`${f.key}.contenido`] = 'Tiene que ser mayor a 0.';
      if (typeof cont === 'number' && !f.unidadContenido) err[`${f.key}.contenido`] = 'Elegí la unidad del tamaño.';
      const eq = leerNumero(f.equivalencia);
      if (eq === null || eq === 'invalido' || eq <= 0) err[`${f.key}.equivalencia`] = 'Tiene que ser mayor a 0.';
      const completo = nombrePresentacion(nombreLimpio, pres);
      if (nombreLimpio && pres && data.productos.some((p) => p.id !== f.original?.id && p.nombre.trim().toLowerCase() === completo.toLowerCase())) {
        err[`${f.key}.presentacion`] = `Ya existe otro producto llamado «${completo}».`;
      }
      if (Object.keys(err).length > 0) continue;
      aGuardar.push({
        esNueva: !f.original,
        proveedorIds: f.proveedorIds,
        producto: {
          id: f.original?.id ?? nuevoId('p'),
          nombre: completo,
          fichaId: ficha?.id ?? '',
          presentacion: pres,
          unidad: f.unidad,
          perecedero,
          puntoDePedido: pp as number,
          ...(typeof cont === 'number' && f.unidadContenido ? { contenido: cont, unidadContenido: f.unidadContenido } : {}),
          unidadesPorPresentacion: eq as number,
        },
      });
    }
    setErrores(err);
    if (Object.keys(err).length > 0) {
      document.querySelector('.hoja .campo-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setGuardando(true);
    const r = await ejecutar(() => guardarFicha({ id: ficha?.id ?? null, nombre: nombreLimpio }, aGuardar));
    setGuardando(false);
    if (!r.ok) {
      setErrores(r.error.campo === 'nombre' ? { nombre: r.error.texto } : { general: r.error.texto });
      return;
    }
    avisar(ficha ? 'Producto actualizado.' : 'Producto creado.');
    onCerrar();
  };

  return (
    <>
      <Hoja
        titulo={ficha ? 'Editar producto' : 'Nuevo producto'}
        onCerrar={cerrar}
        pie={
          <button type="submit" form="form-ficha" className="btn btn-primario btn-bloque btn-grande" disabled={guardando}>
            {guardando ? 'Guardando…' : ficha ? 'Guardar cambios' : 'Crear producto'}
          </button>
        }
      >
        <form id="form-ficha" onSubmit={guardar} noValidate>
          {errores.general && <p className="form-error" role="alert">{errores.general}</p>}
          <Campo etiqueta="Nombre del producto" error={errores.nombre} htmlFor="ficha-nombre" ayuda="Uno solo para todos sus tamaños. Ej.: Cerveza Quilmes">
            <input id="ficha-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Cerveza Quilmes" autoComplete="off" />
          </Campo>

          <label className="interruptor">
            <input type="checkbox" checked={perecedero} onChange={(e) => setPerecedero(e.target.checked)} />
            <span className="interruptor-pista" aria-hidden="true" />
            <span>Es perecedero (pide fecha de vencimiento)</span>
          </label>

          <h3 className="subtitulo-form">Presentaciones</h3>
          <p className="texto-suave nota-form">El stock, los conteos, las recepciones y los pedidos se llevan por presentación.</p>

          <ul className="lista-presentaciones">
            {filas.map((f, i) => {
              const stock = f.original ? calcularStock(data, f.original).stock : null;
              return (
                <li key={f.key} className="presentacion">
                  <div className="presentacion-cabecera">
                    <strong>{f.original ? nombrePresentacion(nombre || '…', f.presentacion) : `Presentación nueva ${i + 1}`}</strong>
                    {f.original
                      ? <span className="etiqueta etiqueta-gris">Stock: {stock ?? 'sin datos'}</span>
                      : <button type="button" className="btn-link" onClick={() => setFilas((fs) => fs.filter((x) => x.key !== f.key))}>Quitar</button>}
                  </div>
                  <Campo etiqueta="Presentación" error={errores[`${f.key}.presentacion`]} htmlFor={`pres-${f.key}`}>
                    <input id={`pres-${f.key}`} value={f.presentacion} onChange={(e) => cambiar(f.key, { presentacion: e.target.value })} placeholder="Ej.: 473 ml, 1 L, pack x6" autoComplete="off" />
                  </Campo>
                  <div className="fila-2">
                    <Campo etiqueta="Tamaño (opcional)" error={errores[`${f.key}.contenido`]} htmlFor={`cont-${f.key}`}>
                      <div className="campo-doble">
                        <input id={`cont-${f.key}`} inputMode="decimal" value={f.contenido} onChange={(e) => cambiar(f.key, { contenido: e.target.value })} placeholder="473" autoComplete="off" />
                        <select aria-label="Unidad del tamaño" value={f.unidadContenido} onChange={(e) => cambiar(f.key, { unidadContenido: e.target.value as UnidadContenido | '' })}>
                          <option value="">—</option>
                          {UNIDADES_CONTENIDO.map((u) => <option key={u.valor} value={u.valor}>{u.label}</option>)}
                        </select>
                      </div>
                    </Campo>
                    <Campo etiqueta="Equivale a (unidades)" error={errores[`${f.key}.equivalencia`]} htmlFor={`eq-${f.key}`} ayuda="Pack x6 = 6. Suelta = 1.">
                      <input id={`eq-${f.key}`} inputMode="decimal" value={f.equivalencia} onChange={(e) => cambiar(f.key, { equivalencia: e.target.value })} autoComplete="off" />
                    </Campo>
                  </div>
                  <div className="fila-2">
                    <Campo etiqueta="Se cuenta por" htmlFor={`uni-${f.key}`}>
                      <select id={`uni-${f.key}`} value={f.unidad} onChange={(e) => cambiar(f.key, { unidad: e.target.value as Unidad })}>
                        {UNIDADES.map((u) => <option key={u.valor} value={u.valor}>{u.label}</option>)}
                      </select>
                    </Campo>
                    <Campo etiqueta="Punto de pedido" error={errores[`${f.key}.punto`]} htmlFor={`pp-${f.key}`}>
                      <input id={`pp-${f.key}`} inputMode="decimal" value={f.puntoDePedido} onChange={(e) => cambiar(f.key, { puntoDePedido: e.target.value })} placeholder="0" autoComplete="off" />
                    </Campo>
                  </div>
                  {data.proveedores.length > 0 && (
                    <fieldset className="checklist checklist-compacta">
                      <legend>Proveedores que la traen</legend>
                      {data.proveedores.map((p) => (
                        <label key={p.id} className="check-item">
                          <input
                            type="checkbox"
                            checked={f.proveedorIds.includes(p.id)}
                            onChange={(e) => cambiar(f.key, { proveedorIds: e.target.checked ? [...f.proveedorIds, p.id] : f.proveedorIds.filter((x) => x !== p.id) })}
                          />
                          <span>{p.nombre}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {f.original && ficha && (
                    <button type="button" className="btn btn-fantasma btn-chico" onClick={() => setMoviendo(f.original)}>
                      <Icon name="derecha" size={18} /> Mover a otro producto
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn-secundario btn-bloque" onClick={agregar}>
            <Icon name="mas" /> Agregar presentación
          </button>
        </form>
      </Hoja>
      {moviendo && (
        <MoverPresentacion
          presentacion={moviendo}
          onCerrar={() => setMoviendo(null)}
          onMovida={() => {
            setMoviendo(null);
            onCerrar();
          }}
        />
      )}
    </>
  );
}
