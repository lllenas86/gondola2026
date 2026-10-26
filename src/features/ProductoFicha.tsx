import { useState, type FormEvent } from 'react';
import { useStore } from '../state/store';
import { medidaDe, mismaIdentidad } from '../lib/match';
import { leerNumero, validarPresentacion, validarProducto, type EntradaPresentacion, type Errores } from '../lib/validation';
import { guardarPresentacion, guardarProducto, moverPresentacion } from '../lib/datos';
import {
  abreviaturaUnidad, estadoInventario, formatoCantidad, formatoPesos, movimientosDe, nombreItem, presentacionesDe, proveedoresDe, stockDe,
} from '../lib/inventario';
import { Campo, Hoja } from '../components/ui';
import { Icon } from '../components/Icon';
import type { Presentacion, Producto, Unidad, UnidadContenido } from '../types';

// Ficha de producto: la identidad (nombre, perecedero) y sus presentaciones.
// Cada presentación tiene su propio stock, punto de pedido, costo y proveedores.

const UNIDADES: { valor: Unidad; label: string }[] = [
  { valor: 'unidad', label: 'Unidades' },
  { valor: 'paquete', label: 'Paquetes' },
  { valor: 'caja', label: 'Cajas' },
  { valor: 'kg', label: 'Kilos' },
  { valor: 'litro', label: 'Litros' },
];
const UNIDADES_CONTENIDO: { valor: UnidadContenido; label: string }[] = [
  { valor: 'ml', label: 'ml' },
  { valor: 'l', label: 'L' },
  { valor: 'g', label: 'g' },
  { valor: 'kg', label: 'kg' },
  { valor: 'u', label: 'unidades' },
];

function entradaDe(x?: Presentacion, nombre = ''): EntradaPresentacion & { unidadStock: Unidad; activa: boolean } {
  return {
    nombre: x?.nombre ?? nombre,
    puntoDePedido: x ? String(x.puntoDePedido) : '',
    contenido: x?.contenido !== undefined ? String(x.contenido).replace('.', ',') : '',
    unidadContenido: x?.unidadContenido ?? '',
    unidadesPorBulto: x?.unidadesPorBulto !== undefined ? String(x.unidadesPorBulto) : '',
    costoUnitario: x?.costoUnitario !== undefined ? String(x.costoUnitario) : '',
    unidadStock: x?.unidadStock ?? 'unidad',
    activa: x?.activa ?? true,
  };
}

const opcional = (t: string): number | undefined => {
  const n = leerNumero(t);
  return typeof n === 'number' ? n : undefined;
};

function aPresentacion(id: string, productoId: string, e: ReturnType<typeof entradaDe>, previa?: Presentacion): Presentacion {
  const contenido = opcional(e.contenido);
  return {
    id,
    productoId,
    nombre: e.nombre.trim(),
    ...(contenido !== undefined ? { contenido, unidadContenido: e.unidadContenido as UnidadContenido } : {}),
    unidadStock: e.unidadStock,
    ...(opcional(e.unidadesPorBulto) !== undefined ? { unidadesPorBulto: opcional(e.unidadesPorBulto) } : {}),
    puntoDePedido: leerNumero(e.puntoDePedido) as number,
    ...(opcional(e.costoUnitario) !== undefined ? { costoUnitario: opcional(e.costoUnitario) } : {}),
    activa: e.activa,
    migrada: previa?.migrada ?? false,
  };
}

/** Campos de una presentación (se usan al crear un producto y al editar una presentación). */
function CamposPresentacion({ valor, onChange, errores, proveedorIds, onProveedores, prefijo, mostrarActiva }: {
  valor: ReturnType<typeof entradaDe>;
  onChange: (v: ReturnType<typeof entradaDe>) => void;
  errores: Errores;
  proveedorIds: string[];
  onProveedores: (ids: string[]) => void;
  prefijo: string;
  mostrarActiva?: boolean;
}) {
  const { data } = useStore();
  const set = (c: Partial<ReturnType<typeof entradaDe>>) => onChange({ ...valor, ...c });
  return (
    <>
      <Campo etiqueta="Presentación" error={errores.nombre} htmlFor={`${prefijo}-nombre`} ayuda="Cómo la reconocés en la góndola: 1 L, 473 ml, Pack x 6…">
        <input id={`${prefijo}-nombre`} value={valor.nombre} onChange={(e) => set({ nombre: e.target.value })} placeholder="Ej.: 1 L" autoComplete="off" />
      </Campo>
      <div className="fila-2">
        <Campo etiqueta="Tamaño (opcional)" error={errores.contenido} htmlFor={`${prefijo}-cont`} ayuda="Ayuda a reconocerla en los remitos.">
          <input id={`${prefijo}-cont`} inputMode="decimal" value={valor.contenido} onChange={(e) => set({ contenido: e.target.value })} placeholder="Ej.: 473" autoComplete="off" />
        </Campo>
        <Campo etiqueta="Unidad del tamaño" htmlFor={`${prefijo}-ucont`}>
          <select id={`${prefijo}-ucont`} value={valor.unidadContenido} onChange={(e) => set({ unidadContenido: e.target.value })}>
            <option value="">—</option>
            {UNIDADES_CONTENIDO.map((u) => <option key={u.valor} value={u.valor}>{u.label}</option>)}
          </select>
        </Campo>
      </div>
      <div className="fila-2">
        <Campo etiqueta="Se cuenta en" htmlFor={`${prefijo}-ustock`}>
          <select id={`${prefijo}-ustock`} value={valor.unidadStock} onChange={(e) => set({ unidadStock: e.target.value as Unidad })}>
            {UNIDADES.map((u) => <option key={u.valor} value={u.valor}>{u.label}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Punto de pedido" error={errores.puntoDePedido} htmlFor={`${prefijo}-punto`}>
          <input id={`${prefijo}-punto`} inputMode="decimal" value={valor.puntoDePedido} onChange={(e) => set({ puntoDePedido: e.target.value })} placeholder="0" autoComplete="off" />
        </Campo>
      </div>
      <div className="fila-2">
        <Campo etiqueta="Unidades por bulto (opcional)" error={errores.unidadesPorBulto} htmlFor={`${prefijo}-bulto`} ayuda="Solo si el proveedor entrega por bulto. Sin dato no se convierte.">
          <input id={`${prefijo}-bulto`} inputMode="decimal" value={valor.unidadesPorBulto} onChange={(e) => set({ unidadesPorBulto: e.target.value })} placeholder="Ej.: 6" autoComplete="off" />
        </Campo>
        <Campo etiqueta="Costo por unidad (opcional)" error={errores.costoUnitario} htmlFor={`${prefijo}-costo`} ayuda="Para valorizar mermas.">
          <input id={`${prefijo}-costo`} inputMode="decimal" value={valor.costoUnitario} onChange={(e) => set({ costoUnitario: e.target.value })} placeholder="$" autoComplete="off" />
        </Campo>
      </div>
      {mostrarActiva && (
        <label className="interruptor">
          <input type="checkbox" checked={valor.activa} onChange={(e) => set({ activa: e.target.checked })} />
          <span className="interruptor-pista" aria-hidden="true" />
          <span>Activa (se cuenta, se pide y se recibe)</span>
        </label>
      )}
      {data.proveedores.length > 0 && (
        <fieldset className="checklist">
          <legend>Proveedores que traen esta presentación</legend>
          {data.proveedores.map((p) => (
            <label key={p.id} className="check-item">
              <input
                type="checkbox"
                checked={proveedorIds.includes(p.id)}
                onChange={(e) => onProveedores(e.target.checked ? [...proveedorIds, p.id] : proveedorIds.filter((x) => x !== p.id))}
              />
              <span>{p.nombre}</span>
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}

/**
 * Alta: producto nuevo con su primera presentación, o presentación nueva de un producto existente.
 * Se usa desde el Catálogo y desde la revisión de un remito ("Crear").
 */
export function AltaProducto({ nombreInicial = '', presentacionInicial = '', proveedorIdsIniciales = [], productoExistenteId, onCerrar, onGuardado }: {
  nombreInicial?: string;
  presentacionInicial?: string;
  proveedorIdsIniciales?: string[];
  /** Si viene, se agrega una presentación a ese producto */
  productoExistenteId?: string;
  onCerrar: () => void;
  onGuardado?: (x: Presentacion) => void;
}) {
  const { data, ejecutar, avisar, nuevoId } = useStore();
  const existente = data.productos.find((p) => p.id === productoExistenteId);
  const [modo, setModo] = useState<'nuevo' | 'existente'>(existente ? 'existente' : 'nuevo');
  const [productoId, setProductoId] = useState(existente?.id ?? '');
  const [nombre, setNombre] = useState(nombreInicial);
  const [perecedero, setPerecedero] = useState(false);
  const [pres, setPres] = useState(entradaDe(undefined, presentacionInicial));
  const [proveedorIds, setProveedorIds] = useState<string[]>(proveedorIdsIniciales);
  const [errores, setErrores] = useState<Errores>({});
  const [guardando, setGuardando] = useState(false);
  const activos = data.productos.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    const err: Errores = modo === 'nuevo' ? validarProducto({ nombre }) : productoId ? {} : { producto: 'Elegí el producto.' };
    const errP = validarPresentacion(pres);
    // Mismo producto escrito de otra forma ("Manteca Pepito 200 gr" = "Manteca Pepito"): no se crea otra ficha.
    // Se permite crear «Coca-Cola» si la existente es una ficha vieja con el tamaño en el nombre («Coca-Cola 2,25 L»),
    // porque así se ordenan esas fichas (después se usa «Mover a otro producto»).
    const igual = modo === 'nuevo' && !err.nombre
      ? data.productos.find((p) => p.activo && (p.nombre.trim().toLowerCase() === nombre.trim().toLowerCase()
          || (mismaIdentidad(p.nombre, nombre) && medidaDe(p.nombre) === null)))
      : undefined;
    if (igual) {
      err.nombre = `Ya existe «${igual.nombre}». Elegí «Agregar a uno existente» para sumarle esta presentación.`;
    }
    if (modo === 'existente' && productoId && !errP.nombre && presentacionesDe(data, productoId).some((x) => x.nombre.trim().toLowerCase() === pres.nombre.trim().toLowerCase())) {
      errP.nombre = 'Ese producto ya tiene una presentación con ese nombre.';
    }
    const todos = { ...err, ...Object.fromEntries(Object.entries(errP).map(([k, v]) => [`p.${k}`, v])) };
    setErrores(todos);
    if (Object.keys(todos).length > 0) return;
    setGuardando(true);
    const r = await ejecutar(async () => {
      let pid = productoId;
      if (modo === 'nuevo') {
        pid = nuevoId();
        await guardarProducto({ id: pid, nombre: nombre.trim(), perecedero, activo: true }, true);
      }
      return guardarPresentacion(aPresentacion(nuevoId(), pid, pres), true, proveedorIds);
    });
    setGuardando(false);
    if (!r.ok) {
      setErrores(r.error.campo === 'nombre' ? { [modo === 'nuevo' ? 'nombre' : 'p.nombre']: r.error.texto } : { general: r.error.texto });
      return;
    }
    avisar(modo === 'nuevo' ? 'Producto creado.' : 'Presentación agregada.');
    onGuardado?.(r.valor);
    onCerrar();
  };

  const errPres = Object.fromEntries(Object.entries(errores).filter(([k]) => k.startsWith('p.')).map(([k, v]) => [k.slice(2), v]));

  return (
    <Hoja
      titulo={existente ? `Nueva presentación · ${existente.nombre}` : 'Nuevo producto'}
      onCerrar={onCerrar}
      pie={
        <button type="submit" form="form-alta" className="btn btn-primario btn-bloque btn-grande" disabled={guardando}>
          {guardando ? 'Guardando…' : modo === 'nuevo' ? 'Crear producto' : 'Agregar presentación'}
        </button>
      }
    >
      <form id="form-alta" onSubmit={guardar} noValidate>
        {errores.general && <p className="form-error" role="alert">{errores.general}</p>}
        {!existente && (
          <div className="pestanas" role="tablist">
            <button type="button" role="tab" aria-selected={modo === 'nuevo'} className={modo === 'nuevo' ? 'activo' : ''} onClick={() => setModo('nuevo')}>Producto nuevo</button>
            <button type="button" role="tab" aria-selected={modo === 'existente'} className={modo === 'existente' ? 'activo' : ''} onClick={() => setModo('existente')}>Agregar a uno existente</button>
          </div>
        )}
        {modo === 'nuevo' ? (
          <>
            <Campo etiqueta="Producto" error={errores.nombre} htmlFor="alta-producto-nombre" ayuda="La identidad, sin el tamaño: «Leche entera», «Coca-Cola».">
              <input id="alta-producto-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Leche entera" autoComplete="off" />
            </Campo>
            <label className="interruptor">
              <input type="checkbox" checked={perecedero} onChange={(e) => setPerecedero(e.target.checked)} />
              <span className="interruptor-pista" aria-hidden="true" />
              <span>Es perecedero (pide vencimiento al contar y recibir)</span>
            </label>
          </>
        ) : !existente && (
          <Campo etiqueta="Producto" error={errores.producto} htmlFor="alta-producto">
            <select id="alta-producto" value={productoId} onChange={(e) => setProductoId(e.target.value)}>
              <option value="">Elegí el producto</option>
              {activos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
        )}
        <h3 className="subtitulo-form">{modo === 'nuevo' ? 'Primera presentación' : 'Presentación'}</h3>
        <CamposPresentacion valor={pres} onChange={setPres} errores={errPres} proveedorIds={proveedorIds} onProveedores={setProveedorIds} prefijo="alta" />
      </form>
    </Hoja>
  );
}

/** Ficha de un producto existente: identidad + lista de presentaciones. */
export function FichaProducto({ producto, onCerrar }: { producto: Producto; onCerrar: () => void }) {
  const { data, vistas, ejecutar, avisar, puede } = useStore();
  const editable = puede('editarCatalogo');
  const [nombre, setNombre] = useState(producto.nombre);
  const [perecedero, setPerecedero] = useState(producto.perecedero);
  const [errores, setErrores] = useState<Errores>({});
  const [guardando, setGuardando] = useState(false);
  const [editando, setEditando] = useState<Presentacion | null>(null);
  const [agregando, setAgregando] = useState(false);
  const [moviendo, setMoviendo] = useState<Presentacion | null>(null);
  const actual = data.productos.find((p) => p.id === producto.id) ?? producto;
  const presentaciones = presentacionesDe(data, producto.id);
  const cambio = nombre.trim() !== actual.nombre || perecedero !== actual.perecedero;

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando || !cambio) return;
    const err = validarProducto({ nombre });
    if (!err.nombre && data.productos.some((p) => p.id !== producto.id && p.nombre.trim().toLowerCase() === nombre.trim().toLowerCase())) {
      err.nombre = 'Ya existe un producto con ese nombre.';
    }
    setErrores(err);
    if (Object.keys(err).length > 0) return;
    setGuardando(true);
    const r = await ejecutar(() => guardarProducto({ ...actual, nombre: nombre.trim(), perecedero }, false));
    setGuardando(false);
    if (!r.ok) {
      setErrores(r.error.campo === 'nombre' ? { nombre: r.error.texto } : { general: r.error.texto });
      return;
    }
    avisar('Producto actualizado.');
  };

  if (editando) return <EditarPresentacion presentacion={editando} producto={actual} onCerrar={() => setEditando(null)} />;
  if (agregando) return <AltaProducto productoExistenteId={producto.id} onCerrar={() => setAgregando(false)} />;
  if (moviendo) return <MoverPresentacion presentacion={moviendo} onCerrar={() => setMoviendo(null)} onMovida={onCerrar} />;

  return (
    <Hoja titulo={actual.nombre} onCerrar={onCerrar}>
      {!actual.activo && <p className="alerta-amarilla"><Icon name="alerta" size={18} /> Ficha archivada: sus presentaciones se movieron a otro producto.</p>}
      <form onSubmit={guardar} noValidate>
        {errores.general && <p className="form-error" role="alert">{errores.general}</p>}
        <Campo etiqueta="Producto" error={errores.nombre} htmlFor="ficha-nombre">
          <input id="ficha-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!editable} autoComplete="off" />
        </Campo>
        <label className="interruptor">
          <input type="checkbox" checked={perecedero} onChange={(e) => setPerecedero(e.target.checked)} disabled={!editable} />
          <span className="interruptor-pista" aria-hidden="true" />
          <span>Es perecedero</span>
        </label>
        {editable && cambio && (
          <button type="submit" className="btn btn-primario btn-bloque" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar cambios'}</button>
        )}
      </form>

      <h3 className="subtitulo-form">Presentaciones ({presentaciones.length})</h3>
      <p className="texto-suave">Cada presentación tiene su propio stock. No se suman entre sí.</p>
      <ul className="lista-catalogo lista-presentaciones">
        {presentaciones.map((x) => {
          const stock = stockDe(data, vistas, x.id);
          const provs = proveedoresDe(data, x.id);
          return (
            <li key={x.id} className={`presentacion-item${x.activa ? '' : ' inactiva'}`} data-testid="presentacion-item">
              <div className="presentacion-info">
                <p className="item-titulo">{x.nombre}{x.migrada && x.nombre === 'Única' && <span className="etiqueta etiqueta-gris">migrada</span>}{!x.activa && <span className="etiqueta etiqueta-gris">inactiva</span>}</p>
                <p className="texto-suave">
                  Stock {stock === null ? '—' : `${formatoCantidad(stock)} ${abreviaturaUnidad(x.unidadStock)}`} · punto {formatoCantidad(x.puntoDePedido)}
                  {x.costoUnitario !== undefined ? ` · ${formatoPesos(x.costoUnitario)} c/u` : ' · sin costo'}
                  {x.unidadesPorBulto ? ` · bulto x${formatoCantidad(x.unidadesPorBulto)}` : ''}
                </p>
                <p className="texto-suave">{provs.length > 0 ? provs.map((p) => p.nombre).join(', ') : 'Sin proveedor'}</p>
              </div>
              {editable && (
                <div className="presentacion-acciones">
                  <button type="button" className="btn btn-secundario btn-chico" onClick={() => setEditando(x)}><Icon name="lapiz" size={16} /> Editar</button>
                  <button type="button" className="btn btn-fantasma btn-chico" onClick={() => setMoviendo(x)}>Mover a otro producto</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <button type="button" className="btn btn-secundario btn-bloque" onClick={() => setAgregando(true)}>
          <Icon name="mas" /> Agregar presentación
        </button>
      )}
    </Hoja>
  );
}

function EditarPresentacion({ presentacion, producto, onCerrar }: { presentacion: Presentacion; producto: Producto; onCerrar: () => void }) {
  const { data, ejecutar, avisar } = useStore();
  const [valor, setValor] = useState(entradaDe(presentacion));
  const [proveedorIds, setProveedorIds] = useState(proveedoresDe(data, presentacion.id).map((p) => p.id));
  const [errores, setErrores] = useState<Errores>({});
  const [guardando, setGuardando] = useState(false);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    if (guardando) return;
    const err = validarPresentacion(valor);
    if (!err.nombre && presentacionesDe(data, producto.id).some((x) => x.id !== presentacion.id && x.nombre.trim().toLowerCase() === valor.nombre.trim().toLowerCase())) {
      err.nombre = 'Ese producto ya tiene una presentación con ese nombre.';
    }
    setErrores(err);
    if (Object.keys(err).length > 0) return;
    setGuardando(true);
    const r = await ejecutar(() => guardarPresentacion(aPresentacion(presentacion.id, producto.id, valor, presentacion), false, proveedorIds));
    setGuardando(false);
    if (!r.ok) {
      setErrores(r.error.campo === 'nombre' ? { nombre: r.error.texto } : { general: r.error.texto });
      return;
    }
    avisar('Presentación actualizada.');
    onCerrar();
  };

  return (
    <Hoja
      titulo={`${producto.nombre} · ${presentacion.nombre}`}
      onCerrar={onCerrar}
      pie={<button type="submit" form="form-pres" className="btn btn-primario btn-bloque btn-grande" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar presentación'}</button>}
    >
      <form id="form-pres" onSubmit={guardar} noValidate>
        {errores.general && <p className="form-error" role="alert">{errores.general}</p>}
        <p className="texto-suave">Cambiar estos datos no modifica el stock ni el historial.</p>
        <CamposPresentacion valor={valor} onChange={setValor} errores={errores} proveedorIds={proveedorIds} onProveedores={setProveedorIds} prefijo="ed" mostrarActiva />
      </form>
    </Hoja>
  );
}

/**
 * Agrupa una presentación bajo otra ficha. Vista previa → confirmación → la base valida,
 * mueve y comprueba que el stock no cambie. El historial queda ligado a la presentación.
 */
export function MoverPresentacion({ presentacion, onCerrar, onMovida }: { presentacion: Presentacion; onCerrar: () => void; onMovida?: () => void }) {
  const { data, vistas, ejecutar, avisar } = useStore();
  const origen = data.productos.find((p) => p.id === presentacion.productoId) as Producto;
  const [destinoId, setDestinoId] = useState('');
  const [nombre, setNombre] = useState(presentacion.nombre === 'Única' ? '' : presentacion.nombre);
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const destino = data.productos.find((p) => p.id === destinoId);
  const candidatos = data.productos.filter((p) => p.id !== origen.id && p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const quedan = presentacionesDe(data, origen.id).filter((x) => x.id !== presentacion.id && x.activa).length;
  const stock = stockDe(data, vistas, presentacion.id);
  const est = estadoInventario(data, presentacion.id);
  const historial = {
    conteos: data.conteos.filter((c) => c.presentacionId === presentacion.id).length,
    movimientos: movimientosDe(data, presentacion.id).length,
  };

  // Mismas validaciones que la base (gondola_mover_presentacion), para avisar antes
  const problemas: string[] = [];
  if (destino) {
    if (destino.perecedero !== origen.perecedero) {
      problemas.push(`«${origen.nombre}» ${origen.perecedero ? 'es' : 'no es'} perecedero y «${destino.nombre}» ${destino.perecedero ? 'sí lo es' : 'no'}. Unificá ese dato antes de mover.`);
    }
    const nombres = presentacionesDe(data, destino.id);
    if (nombre.trim() && nombres.some((x) => x.nombre.trim().toLowerCase() === nombre.trim().toLowerCase())) {
      problemas.push(`«${destino.nombre}» ya tiene una presentación «${nombre.trim()}». Elegí otro nombre o revisá si es la misma.`);
    }
    if (presentacion.contenido !== undefined && nombres.some((x) => x.activa && x.contenido === presentacion.contenido && x.unidadContenido === presentacion.unidadContenido && x.unidadStock === presentacion.unidadStock)) {
      problemas.push(`«${destino.nombre}» ya tiene una presentación del mismo tamaño y unidad: si es la misma, no la muevas.`);
    }
  }
  if (!nombre.trim()) problemas.push('Escribí el nombre que va a tener la presentación en el producto de destino (por ejemplo, 2,25 L).');
  const listo = !!destino && problemas.length === 0;

  const mover = async () => {
    if (!destino || trabajando) return;
    setTrabajando(true);
    setError(null);
    const r = await ejecutar(() => moverPresentacion(presentacion.id, destino.id, nombre.trim()));
    setTrabajando(false);
    if (!r.ok) {
      setError(r.error.texto);
      setConfirmando(false);
      return;
    }
    avisar(`Listo: ahora es «${destino.nombre} · ${r.valor.nombre}». El stock (${r.valor.stock ?? '—'}) no cambió.`);
    onMovida?.();
    onCerrar();
  };

  return (
    <Hoja
      titulo="Mover a otro producto"
      onCerrar={onCerrar}
      pie={
        confirmando ? (
          <div className="acciones-2 sin-margen-arriba">
            <button type="button" className="btn btn-fantasma" onClick={() => setConfirmando(false)} disabled={trabajando}>Volver</button>
            <button type="button" className="btn btn-primario" onClick={() => void mover()} disabled={trabajando}>{trabajando ? 'Moviendo…' : 'Sí, mover'}</button>
          </div>
        ) : (
          <button type="button" className="btn btn-primario btn-bloque btn-grande" disabled={!listo} onClick={() => setConfirmando(true)}>Ver resumen y confirmar</button>
        )
      }
    >
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="texto-suave">
        Sirve para agrupar bajo una misma ficha presentaciones que hoy están como productos separados. No suma ni cambia stocks.
      </p>
      <div className="mover-origen">
        <p className="texto-suave">Se mueve</p>
        <p className="item-titulo">{nombreItem(origen, presentacion)}</p>
        <p className="texto-suave">Stock registrado: {stock === null ? '—' : formatoCantidad(stock)} {abreviaturaUnidad(presentacion.unidadStock)}</p>
      </div>
      {!confirmando && (
        <>
          <Campo etiqueta="Producto de destino" htmlFor="mover-destino">
            <select id="mover-destino" value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
              <option value="">Elegí el producto</option>
              {candidatos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Nombre de la presentación en el destino" htmlFor="mover-nombre" ayuda="Por ejemplo, 2,25 L. Tiene que ser distinto de las que ya tiene.">
            <input id="mover-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: 2,25 L" autoComplete="off" />
          </Campo>
          {destino && problemas.length > 0 && (
            <ul className="lista-problemas" role="alert">
              {problemas.map((p) => <li key={p}><Icon name="alerta" size={16} /> {p}</li>)}
            </ul>
          )}
        </>
      )}
      {destino && (
        <div className={`vista-previa${confirmando ? ' confirmando' : ''}`} data-testid="vista-previa-mover">
          <p className="item-titulo">Vista previa</p>
          <ul>
            <li>Resultado: <strong>{destino.nombre} · {nombre.trim() || '…'}</strong></li>
            <li>Stock: <strong>{stock === null ? 'sin datos' : `${formatoCantidad(stock)} ${abreviaturaUnidad(presentacion.unidadStock)}`}</strong>, igual que ahora (no se suma con otras presentaciones).</li>
            <li>Historial que la acompaña: {historial.conteos} conteos y {historial.movimientos} movimientos (recepciones, devoluciones y bajas){est.lotes.length > 0 ? `, ${est.lotes.length} ${est.lotes.length === 1 ? 'lote' : 'lotes'}` : ''}.</li>
            <li>Proveedores: {proveedoresDe(data, presentacion.id).map((p) => p.nombre).join(', ') || 'ninguno'} (se mantienen).</li>
            <li>{quedan === 0 ? `La ficha «${origen.nombre}» queda sin presentaciones: se archiva (no se borra).` : `«${origen.nombre}» conserva ${quedan} ${quedan === 1 ? 'presentación' : 'presentaciones'}.`}</li>
          </ul>
        </div>
      )}
    </Hoja>
  );
}
