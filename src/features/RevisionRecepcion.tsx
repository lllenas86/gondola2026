import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { CONFIANZA_ALTA, vincularLinea, vincularProveedor } from '../lib/match';
import { leerNumero, validarRecepcion, type LineaBorrador } from '../lib/validation';
import { calcularStock, productosDeProveedor } from '../lib/stock';
import { isoDate } from '../lib/dates';
import { Icon } from '../components/Icon';
import { Campo } from '../components/ui';
import { ProductoForm } from './ProductoForm';
import type { Extraccion } from '../demo/remitos';
import type { AppData, Producto, Recepcion } from '../types';

export interface ResultadoConfirmacion {
  proveedor: string;
  cambios: { nombre: string; antes: number | null; despues: number | null; recibido: number }[];
}

interface Props {
  origen: 'manual' | 'remito_foto';
  /** URL para mostrar la imagen */
  imagenUrl?: string;
  /** Valor que se guarda en la recepción (data URL o "ejemplo:…") */
  imagenGuardar?: string;
  extraccion?: Extraccion;
  onConfirmada: (r: ResultadoConfirmacion) => void;
  onCancelar: () => void;
}

let claveLinea = 0;
const nuevaClave = () => `l${++claveLinea}`;

function lineaVacia(): LineaBorrador {
  return { key: nuevaClave(), descripcion: '', productoId: null, cantidad: '', fechaVencimiento: '', revisar: false, ignorada: false };
}

function armarBorrador(data: AppData, extraccion: Extraccion | undefined) {
  if (!extraccion) return { proveedorId: '', fecha: isoDate(new Date()), lineas: [lineaVacia()] };
  const proveedorId = vincularProveedor(extraccion.proveedor, data.proveedores) ?? '';
  const ids = new Set(proveedorId ? productosDeProveedor(data, proveedorId).map((p) => p.id) : []);
  const lineas: LineaBorrador[] = extraccion.lineas.map((l) => {
    const v = vincularLinea(l.descripcion, data.productos, ids);
    const confianza = Math.min(v.confianza, l.confianzaLectura ?? 1);
    return {
      key: nuevaClave(),
      descripcion: l.descripcion,
      productoId: v.productoId,
      cantidad: l.cantidad === null || l.cantidad === undefined ? '' : String(l.cantidad),
      fechaVencimiento: l.fechaVencimiento ?? '',
      confianza,
      revisar: !v.productoId || confianza < CONFIANZA_ALTA,
      ignorada: false,
    };
  });
  return { proveedorId, fecha: extraccion.fecha || isoDate(new Date()), lineas };
}

function tituloDesdeRemito(desc: string): string {
  const t = desc.toLowerCase().replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function RevisionRecepcion({ origen, imagenUrl, imagenGuardar, extraccion, onConfirmada, onCancelar }: Props) {
  const { data, dispatch, nuevoId } = useStore();
  const inicial = useMemo(() => armarBorrador(data, extraccion), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [proveedorId, setProveedorId] = useState(inicial.proveedorId);
  const [fecha, setFecha] = useState(inicial.fecha);
  const [lineas, setLineas] = useState<LineaBorrador[]>(inicial.lineas);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [creandoPara, setCreandoPara] = useState<LineaBorrador | null>(null);
  const [fotoGrande, setFotoGrande] = useState(false);
  const hoy = isoDate(new Date());

  const delProveedor = proveedorId ? productosDeProveedor(data, proveedorId) : [];
  const idsDelProveedor = new Set(delProveedor.map((p) => p.id));
  const otros = [...data.productos].filter((p) => !idsDelProveedor.has(p.id)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  const cambiarLinea = (key: string, cambio: Partial<LineaBorrador>, marcarRevisada = true) => {
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambio, ...(marcarRevisada ? { revisar: false } : {}) } : l)));
    setErrores((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`${key}.`))));
    setErrorGeneral(null);
  };

  const pendientes = lineas.filter((l) => !l.ignorada && !l.productoId).length;
  const aRevisar = lineas.filter((l) => !l.ignorada && l.revisar).length;

  const confirmar = () => {
    const r = validarRecepcion(proveedorId, fecha, lineas, hoy);
    setErrores(r.errores);
    setErrorGeneral(r.errorGeneral);
    if (r.errorGeneral || Object.keys(r.errores).length > 0) {
      document.querySelector('.con-error, .campo-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Se agrupan líneas repetidas del mismo producto.
    const agrupadas = new Map<string, { cantidad: number; fechaVencimiento?: string }>();
    for (const l of r.lineas) {
      const prev = agrupadas.get(l.productoId);
      agrupadas.set(l.productoId, {
        cantidad: (prev?.cantidad ?? 0) + l.cantidad,
        fechaVencimiento: [prev?.fechaVencimiento, l.fechaVencimiento].filter(Boolean).sort()[0],
      });
    }
    const recepcion: Recepcion = {
      id: nuevoId('r'),
      proveedorId,
      fecha,
      registradaEn: new Date().toISOString(),
      origen,
      ...(imagenGuardar ? { imagen: imagenGuardar } : {}),
      lineas: [...agrupadas].map(([productoId, v]) => ({ productoId, cantidad: v.cantidad, ...(v.fechaVencimiento ? { fechaVencimiento: v.fechaVencimiento } : {}) })),
    };

    const antes = new Map(recepcion.lineas.map((l) => {
      const p = data.productos.find((x) => x.id === l.productoId) as Producto;
      return [l.productoId, calcularStock(data, p).stock];
    }));
    dispatch({ type: 'registrarRecepcion', recepcion });

    // Si el proveedor trajo un producto que no tenía asociado, se asocia.
    const nuevos = recepcion.lineas.map((l) => l.productoId).filter((id) => !idsDelProveedor.has(id));
    const proveedor = data.proveedores.find((p) => p.id === proveedorId);
    if (proveedor && nuevos.length > 0) {
      dispatch({ type: 'guardarProveedor', proveedor, productoIds: [...idsDelProveedor, ...nuevos] });
    }

    onConfirmada({
      proveedor: proveedor?.nombre ?? '',
      cambios: recepcion.lineas.map((l) => {
        const a = antes.get(l.productoId) ?? null;
        return {
          nombre: data.productos.find((p) => p.id === l.productoId)?.nombre ?? '',
          antes: a,
          despues: (a ?? 0) + l.cantidad,
          recibido: l.cantidad,
        };
      }),
    });
  };

  const cancelar = () => {
    if (window.confirm('¿Descartar esta recepción? No se va a guardar nada.')) onCancelar();
  };

  return (
    <div className="revision">
      <header className="cabecera">
        <p className="cabecera-marca">Recepción · revisión</p>
        <h1>{origen === 'remito_foto' ? 'Revisá lo que leyó la IA' : 'Carga manual'}</h1>
        {origen === 'remito_foto' && (
          <p className="texto-suave">
            Compará con la foto y corregí lo necesario. Nada se guarda hasta que toques «Confirmar recepción».
          </p>
        )}
      </header>

      <div className={`revision-grilla${imagenUrl ? ' con-foto' : ''}`}>
        {imagenUrl && (
          <aside className="revision-foto">
            <button type="button" className="foto-boton" onClick={() => setFotoGrande(true)} aria-label="Ver la foto del remito en grande">
              <img src={imagenUrl} alt="Foto del remito" />
              <span className="foto-zoom"><Icon name="zoom" size={18} /> Ampliar</span>
            </button>
          </aside>
        )}

        <div className="revision-datos">
          {(aRevisar > 0 || pendientes > 0) && (
            <div className="alerta-amarilla">
              <Icon name="alerta" size={20} />
              <span>
                {aRevisar === 1 ? 'Hay 1 línea marcada para revisar' : `Hay ${aRevisar} líneas marcadas para revisar`}
                {pendientes > 0 ? ` (${pendientes} sin producto del catálogo)` : ''}.
              </span>
            </div>
          )}

          <div className="fila-2">
            <Campo etiqueta="Proveedor" error={errores.proveedor} htmlFor="rec-proveedor">
              <select id="rec-proveedor" value={proveedorId} onChange={(e) => { setProveedorId(e.target.value); setErrores((x) => ({ ...x, proveedor: '' })); }}>
                <option value="">Elegí el proveedor</option>
                {data.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Fecha" error={errores.fecha} htmlFor="rec-fecha">
              <input id="rec-fecha" type="date" value={fecha} max={hoy} onChange={(e) => { setFecha(e.target.value); setErrores((x) => ({ ...x, fecha: '' })); }} />
            </Campo>
          </div>

          <h2 className="seccion-titulo">Productos recibidos</h2>
          <ul className="lineas">
            {lineas.map((l, i) => {
              const producto = data.productos.find((p) => p.id === l.productoId);
              const errProd = errores[`${l.key}.producto`];
              const errCant = errores[`${l.key}.cantidad`];
              if (l.ignorada) {
                return (
                  <li key={l.key} className="linea ignorada">
                    <span>Ignorada: {l.descripcion || `línea ${i + 1}`}</span>
                    <button type="button" className="btn-link" onClick={() => cambiarLinea(l.key, { ignorada: false }, false)}>Deshacer</button>
                  </li>
                );
              }
              return (
                <li key={l.key} className={`linea${l.revisar ? ' revisar' : ''}${errProd || errCant ? ' con-error' : ''}`} data-testid="linea-recepcion">
                  {l.descripcion && (
                    <p className="linea-remito">
                      <Icon name="documento" size={15} /> En el remito: <strong>{l.descripcion}</strong>
                    </p>
                  )}
                  {l.revisar && (
                    <p className="linea-aviso">
                      {!l.productoId
                        ? 'No encontramos este producto en el catálogo. Elegilo, crealo o ignorá la línea.'
                        : `Revisá producto y cantidad: la IA no está segura (confianza ${Math.round((l.confianza ?? 0) * 100)} %).`}
                    </p>
                  )}

                  <Campo etiqueta="Producto" error={errProd} htmlFor={`prod-${l.key}`}>
                    <select id={`prod-${l.key}`} value={l.productoId ?? ''} onChange={(e) => cambiarLinea(l.key, { productoId: e.target.value || null })}>
                      <option value="">Sin asignar</option>
                      {delProveedor.length > 0 && (
                        <optgroup label="De este proveedor">
                          {delProveedor.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </optgroup>
                      )}
                      {otros.length > 0 && (
                        <optgroup label={delProveedor.length > 0 ? 'Otros productos' : 'Productos'}>
                          {otros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </Campo>

                  {!l.productoId && (
                    <div className="linea-acciones">
                      <button type="button" className="btn btn-secundario" onClick={() => setCreandoPara(l)}>
                        <Icon name="mas" size={18} /> Crear producto
                      </button>
                      <button type="button" className="btn btn-fantasma" onClick={() => cambiarLinea(l.key, { ignorada: true }, false)}>
                        Ignorar
                      </button>
                    </div>
                  )}

                  <div className="fila-2">
                    <Campo etiqueta="Cantidad" error={errCant} htmlFor={`cant-${l.key}`}>
                      <div className="contador">
                        <button type="button" className="contador-btn" aria-label="Restar 1" onClick={() => {
                          const n = leerNumero(l.cantidad);
                          cambiarLinea(l.key, { cantidad: String(Math.max(0, (typeof n === 'number' ? n : 0) - 1)) });
                        }}>−</button>
                        <input id={`cant-${l.key}`} className="contador-input" inputMode="decimal" autoComplete="off" value={l.cantidad} onChange={(e) => cambiarLinea(l.key, { cantidad: e.target.value })} />
                        <button type="button" className="contador-btn" aria-label="Sumar 1" onClick={() => {
                          const n = leerNumero(l.cantidad);
                          cambiarLinea(l.key, { cantidad: String((typeof n === 'number' ? n : 0) + 1) });
                        }}>+</button>
                      </div>
                    </Campo>
                    {(producto?.perecedero || l.fechaVencimiento) && (
                      <Campo etiqueta="Vencimiento" htmlFor={`venc-${l.key}`}>
                        <input id={`venc-${l.key}`} type="date" value={l.fechaVencimiento} onChange={(e) => cambiarLinea(l.key, { fechaVencimiento: e.target.value })} />
                      </Campo>
                    )}
                  </div>

                  <div className="linea-pie">
                    {l.revisar && l.productoId && (
                      <button type="button" className="btn-link" onClick={() => cambiarLinea(l.key, {})}>
                        <Icon name="check" size={16} /> Está bien
                      </button>
                    )}
                    {(origen === 'manual' || !l.descripcion) && lineas.length > 1 && (
                      <button type="button" className="btn-link btn-link-rojo" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))}>
                        Quitar línea
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn-secundario btn-bloque" onClick={() => setLineas((ls) => [...ls, lineaVacia()])}>
            <Icon name="mas" /> Agregar producto
          </button>
        </div>
      </div>

      <div className="barra-accion">
        {errorGeneral && <p className="barra-error" role="alert"><Icon name="alerta" size={18} /> {errorGeneral}</p>}
        <div className="barra-botones">
          <button type="button" className="btn btn-fantasma" onClick={cancelar}>Cancelar</button>
          <button type="button" className="btn btn-primario btn-grande" onClick={confirmar}>
            <Icon name="check" /> Confirmar recepción
          </button>
        </div>
      </div>

      {creandoPara && (
        <ProductoForm
          producto={null}
          nombreInicial={tituloDesdeRemito(creandoPara.descripcion)}
          proveedorIdsIniciales={proveedorId ? [proveedorId] : []}
          onCerrar={() => setCreandoPara(null)}
          onGuardado={(p) => cambiarLinea(creandoPara.key, { productoId: p.id })}
        />
      )}

      {fotoGrande && imagenUrl && (
        <div className="foto-completa" role="dialog" aria-label="Foto del remito">
          <button type="button" className="btn-icono foto-cerrar" onClick={() => setFotoGrande(false)} aria-label="Cerrar foto">
            <Icon name="cerrar" />
          </button>
          <div className="foto-completa-scroll">
            <img src={imagenUrl} alt="Foto del remito ampliada" />
          </div>
        </div>
      )}
    </div>
  );
}
