import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { CONFIANZA_ALTA, vincularLinea, vincularProveedor } from '../lib/match';
import { leerNumero, validarRecepcion, type LineaBorrador } from '../lib/validation';
import { calcularStock, productosDeProveedor } from '../lib/stock';
import { confirmarRecepcion, type LineaAConfirmar } from '../lib/datos';
import { isoDate } from '../lib/dates';
import { Icon } from '../components/Icon';
import { Campo, EstadoConexion } from '../components/ui';
import { ProductoForm } from './ProductoForm';
import type { AppData, Borrador, Producto } from '../types';

export interface ResultadoConfirmacion {
  proveedor: string;
  cambios: { nombre: string; antes: number | null; despues: number | null; recibido: number }[];
}

interface Props {
  origen: 'manual' | 'remito_foto';
  /** URL para mostrar la imagen */
  imagenUrl?: string;
  /** Ruta de la foto en el bucket (carga manual con foto) */
  imagenPath?: string | null;
  /** Recepción en borrador guardada en la base (remito leído por la IA o de ejemplo) */
  borrador?: Borrador;
  onConfirmada: (r: ResultadoConfirmacion) => void;
  onCancelar: () => void;
}

let claveLinea = 0;
const nuevaClave = () => `l${++claveLinea}`;

function lineaVacia(): LineaBorrador {
  return { key: nuevaClave(), descripcion: '', productoId: null, cantidad: '', fechaVencimiento: '', revisar: false, ignorada: false };
}

function armarBorrador(data: AppData, borrador: Borrador | undefined) {
  if (!borrador) return { proveedorId: '', fecha: isoDate(new Date()), lineas: [lineaVacia()] };
  const proveedorId = borrador.proveedorId ?? vincularProveedor(borrador.proveedorTexto ?? '', data.proveedores) ?? '';
  const ids = new Set(proveedorId ? productosDeProveedor(data, proveedorId).map((p) => p.id) : []);
  const lineas: LineaBorrador[] = borrador.lineas.map((l) => {
    // Si la línea no quedó vinculada, se intenta de nuevo con el catálogo actual
    const v = l.productoId ? { productoId: l.productoId, confianza: l.confianzaVinculo ?? 1 } : vincularLinea(l.descripcion, data.productos, ids);
    const confianza = Math.min(v.confianza, l.confianza ?? 1);
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
  return { proveedorId, fecha: borrador.fecha || isoDate(new Date()), lineas: lineas.length > 0 ? lineas : [lineaVacia()] };
}

function tituloDesdeRemito(desc: string): string {
  const t = desc.toLowerCase().replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function RevisionRecepcion({ origen, imagenUrl, imagenPath, borrador, onConfirmada, onCancelar }: Props) {
  const { data, ejecutar } = useStore();
  const inicial = useMemo(() => armarBorrador(data, borrador), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [guardando, setGuardando] = useState(false);
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

  const confirmar = async () => {
    if (guardando) return;
    const r = validarRecepcion(proveedorId, fecha, lineas, hoy);
    setErrores(r.errores);
    setErrorGeneral(r.errorGeneral);
    if (r.errorGeneral || Object.keys(r.errores).length > 0) {
      document.querySelector('.con-error, .campo-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Se agrupan líneas repetidas de la misma presentación y el mismo vencimiento.
    // Distintas fechas de vencimiento quedan como lotes separados.
    const porLote = new Map<string, { productoId: string; cantidad: number; fechaVencimiento?: string }>();
    for (const l of r.lineas) {
      const k = `${l.productoId}|${l.fechaVencimiento ?? ''}`;
      const prev = porLote.get(k);
      porLote.set(k, {
        productoId: l.productoId,
        cantidad: (prev?.cantidad ?? 0) + l.cantidad,
        ...(l.fechaVencimiento ? { fechaVencimiento: l.fechaVencimiento } : {}),
      });
    }
    const agrupadas = new Map<string, { cantidad: number }>();
    for (const v of porLote.values()) agrupadas.set(v.productoId, { cantidad: (agrupadas.get(v.productoId)?.cantidad ?? 0) + v.cantidad });
    const lineasConfirmar: LineaAConfirmar[] = [
      ...[...porLote.values()].map((v) => ({ productoId: v.productoId, cantidad: v.cantidad, ...(v.fechaVencimiento ? { fechaVencimiento: v.fechaVencimiento } : {}) })),
      // Las líneas ignoradas quedan registradas (no suman al stock)
      ...lineas
        .filter((l) => l.ignorada && l.descripcion)
        .map((l) => ({ productoId: null, descripcion: l.descripcion, cantidad: Number(leerNumero(l.cantidad)) || 0, ignorada: true })),
    ];

    const antes = new Map([...agrupadas.keys()].map((id) => {
      const p = data.productos.find((x) => x.id === id) as Producto;
      return [id, calcularStock(data, p).stock];
    }));
    // Si el proveedor trajo un producto que no tenía asociado, se asocia.
    const asociar = [...agrupadas.keys()].filter((id) => !idsDelProveedor.has(id));
    const proveedor = data.proveedores.find((p) => p.id === proveedorId);

    setGuardando(true);
    const res = await ejecutar(() => confirmarRecepcion({
      borradorId: borrador?.id,
      proveedorId,
      fecha,
      origen,
      imagenPath: imagenPath ?? null,
      lineas: lineasConfirmar,
      asociar,
    }));
    setGuardando(false);
    if (!res.ok) {
      // La base rechazó (por ejemplo, líneas sin vincular) o no hay conexión: se muestra el motivo
      setErrorGeneral(res.error.texto);
      return;
    }

    onConfirmada({
      proveedor: proveedor?.nombre ?? '',
      cambios: [...agrupadas].map(([id, v]) => {
        const a = antes.get(id) ?? null;
        return {
          nombre: data.productos.find((p) => p.id === id)?.nombre ?? '',
          antes: a,
          despues: (a ?? 0) + v.cantidad,
          recibido: v.cantidad,
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
        <EstadoConexion />
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
          <button type="button" className="btn btn-fantasma" onClick={cancelar} disabled={guardando}>Cancelar</button>
          <button type="button" className="btn btn-primario btn-grande" onClick={confirmar} disabled={guardando}>
            <Icon name="check" /> {guardando ? 'Guardando…' : 'Confirmar recepción'}
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
