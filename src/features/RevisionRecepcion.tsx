import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { CONFIANZA_ALTA, medidaDe, medidaLegible, sinMedida, vincularLinea, vincularProveedor, type Vinculo } from '../lib/match';
import { leerNumero, validarRecepcion, type LineaBorrador } from '../lib/validation';
import { itemDe, itemsActivos, itemsDeProveedor, nombreItem, stockDe, type Item } from '../lib/inventario';
import { confirmarRecepcion, type LineaAConfirmar } from '../lib/datos';
import { isoDate } from '../lib/dates';
import { Icon } from '../components/Icon';
import { Campo, EstadoConexion } from '../components/ui';
import { AltaProducto } from './ProductoFicha';
import type { AliasRemito, AppData, Borrador } from '../types';

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
  return { key: nuevaClave(), descripcion: '', presentacionId: null, cantidad: '', fechaVencimiento: '', revisar: false, ignorada: false };
}

function armarBorrador(data: AppData, borrador: Borrador | undefined) {
  if (!borrador) return { proveedorId: '', fecha: isoDate(new Date()), lineas: [lineaVacia()] };
  const proveedorId = borrador.proveedorId ?? vincularProveedor(borrador.proveedorTexto ?? '', data.proveedores) ?? '';
  const ids = new Set(proveedorId ? itemsDeProveedor(data, proveedorId).map((it) => it.presentacion.id) : []);
  const items = itemsActivos(data);
  const lineas: LineaBorrador[] = borrador.lineas.map((l) => {
    // Si la línea no quedó vinculada, se intenta de nuevo con el catálogo actual (y los alias aprendidos)
    const v: Vinculo = l.presentacionId
      ? { presentacionId: l.presentacionId, confianza: l.confianzaVinculo ?? 1, ...(l.motivoRevision ? { motivo: l.motivoRevision } : {}) }
      : vincularLinea(l.descripcion, items, ids, data.alias);
    const confianza = Math.min(v.confianza, l.confianza ?? 1);
    return {
      key: nuevaClave(),
      descripcion: l.descripcion,
      presentacionId: v.presentacionId,
      cantidad: l.cantidad === null || l.cantidad === undefined ? '' : String(l.cantidad),
      fechaVencimiento: l.fechaVencimiento ?? '',
      confianza,
      ...(v.motivo ? { motivoRevision: v.motivo } : {}),
      revisar: !v.presentacionId || confianza < CONFIANZA_ALTA,
      ignorada: false,
      ...(v.opciones ? { opciones: v.opciones } : {}),
      ...(v.productoSugeridoId ? { productoSugeridoId: v.productoSugeridoId } : {}),
      ...(v.medida ? { medida: v.medida } : {}),
    };
  });
  return { proveedorId, fecha: borrador.fecha || '', lineas: lineas.length > 0 ? lineas : [lineaVacia()] };
}

function tituloDesdeRemito(desc: string): string {
  // El nombre del producto va sin el tamaño (el tamaño es la presentación)
  const t = sinMedida(desc).toLowerCase().replace(/\s+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function RevisionRecepcion({ origen, imagenUrl, imagenPath, borrador, onConfirmada, onCancelar }: Props) {
  const { data, vistas, ejecutar, puede } = useStore();
  const inicial = useMemo(() => armarBorrador(data, borrador), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [guardando, setGuardando] = useState(false);
  const [proveedorId, setProveedorId] = useState(inicial.proveedorId);
  const [fecha, setFecha] = useState(inicial.fecha);
  const [lineas, setLineas] = useState<LineaBorrador[]>(inicial.lineas);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  /** Alta desde una línea: producto nuevo, o presentación nueva en una ficha existente */
  const [creandoPara, setCreandoPara] = useState<{ linea: LineaBorrador; productoId?: string } | null>(null);
  /** Líneas cargadas en bultos (solo presentaciones con equivalencia configurada) */
  const [enBultos, setEnBultos] = useState<Record<string, boolean>>({});
  /** Vinculación inicial de cada línea, para saber cuáles se corrigieron a mano */
  const [inicialPorLinea] = useState(() => new Map(inicial.lineas.map((l) => [l.key, { id: l.presentacionId, revisar: l.revisar }])));
  const [fotoGrande, setFotoGrande] = useState(false);
  const hoy = isoDate(new Date());

  const delProveedor: Item[] = proveedorId ? itemsDeProveedor(data, proveedorId) : [];
  const idsDelProveedor = new Set(delProveedor.map((it) => it.presentacion.id));
  const otros = itemsActivos(data).filter((it) => !idsDelProveedor.has(it.presentacion.id));

  const cambiarLinea = (key: string, cambio: Partial<LineaBorrador>, marcarRevisada = true) => {
    setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambio, ...(marcarRevisada ? { revisar: false } : {}) } : l)));
    setErrores((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`${key}.`))));
    setErrorGeneral(null);
  };

  const pendientes = lineas.filter((l) => !l.ignorada && !l.presentacionId).length;
  const aRevisar = lineas.filter((l) => !l.ignorada && l.revisar).length;

  const confirmar = async () => {
    if (guardando) return;
    // Las líneas en bultos se pasan a unidades con la equivalencia configurada (nunca se supone)
    const lineasUnidades = lineas.map((l) => {
      const x = l.presentacionId ? itemDe(data, l.presentacionId)?.presentacion : undefined;
      const n = leerNumero(l.cantidad);
      return enBultos[l.key] && x?.unidadesPorBulto && typeof n === 'number' ? { ...l, cantidad: String(n * x.unidadesPorBulto) } : l;
    });
    const r = validarRecepcion(proveedorId, fecha, lineasUnidades, hoy);
    setErrores(r.errores);
    setErrorGeneral(r.errorGeneral);
    if (r.errorGeneral || Object.keys(r.errores).length > 0) {
      document.querySelector('.con-error, .campo-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    // Se agrupan las líneas repetidas de la MISMA presentación y el MISMO vencimiento
    // (vencimientos distintos son lotes distintos: no se mezclan).
    const agrupadas = new Map<string, { presentacionId: string; cantidad: number; fechaVencimiento?: string; descripcion?: string }>();
    for (const [i, l] of r.lineas.entries()) {
      const clave = `${l.presentacionId}|${l.fechaVencimiento ?? ''}`;
      const prev = agrupadas.get(clave);
      const desc = lineasUnidades.filter((x) => !x.ignorada && x.presentacionId)[i]?.descripcion;
      agrupadas.set(clave, {
        presentacionId: l.presentacionId,
        cantidad: (prev?.cantidad ?? 0) + l.cantidad,
        ...(l.fechaVencimiento ? { fechaVencimiento: l.fechaVencimiento } : {}),
        ...(prev?.descripcion ?? desc ? { descripcion: prev?.descripcion ?? desc } : {}),
      });
    }
    const lineasConfirmar: LineaAConfirmar[] = [
      ...[...agrupadas.values()].map((v) => ({ presentacionId: v.presentacionId, cantidad: v.cantidad, ...(v.descripcion ? { descripcion: v.descripcion } : {}), ...(v.fechaVencimiento ? { fechaVencimiento: v.fechaVencimiento } : {}) })),
      // Las líneas ignoradas quedan registradas (no suman al stock)
      ...lineas
        .filter((l) => l.ignorada && l.descripcion)
        .map((l) => ({ presentacionId: null, descripcion: l.descripcion, cantidad: Number(leerNumero(l.cantidad)) || 0, ignorada: true })),
    ];

    const porPresentacion = new Map<string, number>();
    for (const v of agrupadas.values()) porPresentacion.set(v.presentacionId, (porPresentacion.get(v.presentacionId) ?? 0) + v.cantidad);
    const antes = new Map([...porPresentacion.keys()].map((id) => [id, stockDe(data, vistas, id)]));
    // Si el proveedor trajo una presentación que no tenía asociada, se asocia.
    const asociar = [...porPresentacion.keys()].filter((id) => !idsDelProveedor.has(id));
    // Textos del remito que la persona vinculó o corrigió a mano: se recuerdan
    const aprender: AliasRemito[] = lineas
      .filter((l) => !l.ignorada && l.presentacionId && l.descripcion)
      .filter((l) => {
        const ini = inicialPorLinea.get(l.key);
        return !ini || ini.revisar || ini.id !== l.presentacionId;
      })
      .map((l) => ({ texto: l.descripcion, presentacionId: l.presentacionId as string }));
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
      aprender,
    }));
    setGuardando(false);
    if (!res.ok) {
      // La base rechazó (por ejemplo, líneas sin vincular) o no hay conexión: se muestra el motivo
      setErrorGeneral(res.error.texto);
      return;
    }

    onConfirmada({
      proveedor: proveedor?.nombre ?? '',
      cambios: [...porPresentacion].map(([id, cantidad]) => {
        const a = antes.get(id) ?? null;
        const it = itemDe(data, id);
        return {
          nombre: it ? nombreItem(it.producto, it.presentacion) : '',
          antes: a,
          despues: (a ?? 0) + cantidad,
          recibido: cantidad,
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
          {!fecha && origen === 'remito_foto' && (
            <div className="alerta-amarilla">
              <Icon name="alerta" size={20} />
              <span>No se pudo leer la fecha del remito: completala antes de confirmar.</span>
            </div>
          )}
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
              const item = l.presentacionId ? itemDe(data, l.presentacionId) : null;
              const producto = item?.producto;
              const bultos = item?.presentacion.unidadesPorBulto;
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
                      {!l.presentacionId
                        ? l.motivoRevision ?? 'No encontramos este producto en el catálogo. Elegilo, crealo o ignorá la línea.'
                        : l.motivoRevision
                          ? `${l.motivoRevision} Confirmá la presentación.`
                          : `Revisá presentación y cantidad: la IA no está segura (confianza ${Math.round((l.confianza ?? 0) * 100)} %).`}
                    </p>
                  )}

                  <Campo etiqueta="Producto y presentación" error={errProd} htmlFor={`prod-${l.key}`}>
                    <select id={`prod-${l.key}`} value={l.presentacionId ?? ''} onChange={(e) => { cambiarLinea(l.key, { presentacionId: e.target.value || null, motivoRevision: undefined }); setEnBultos((b) => ({ ...b, [l.key]: false })); }}>
                      <option value="">Sin asignar</option>
                      {delProveedor.length > 0 && (
                        <optgroup label="De este proveedor">
                          {delProveedor.map((it) => <option key={it.presentacion.id} value={it.presentacion.id}>{nombreItem(it.producto, it.presentacion)}</option>)}
                        </optgroup>
                      )}
                      {otros.length > 0 && (
                        <optgroup label={delProveedor.length > 0 ? 'Otras presentaciones' : 'Presentaciones'}>
                          {otros.map((it) => <option key={it.presentacion.id} value={it.presentacion.id}>{nombreItem(it.producto, it.presentacion)}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </Campo>

                  {!l.presentacionId && (l.opciones?.length ?? 0) > 0 && (
                    <div className="linea-opciones" role="group" aria-label="Presentaciones posibles">
                      {l.opciones!.map((id) => {
                        const op = itemDe(data, id);
                        return op ? (
                          <button key={id} type="button" className="btn btn-secundario" data-testid="opcion-presentacion" onClick={() => cambiarLinea(l.key, { presentacionId: id, motivoRevision: undefined })}>
                            {nombreItem(op.producto, op.presentacion)}
                          </button>
                        ) : null;
                      })}
                    </div>
                  )}

                  {!l.presentacionId && (
                    <div className="linea-acciones">
                      {puede('altaProducto') && l.productoSugeridoId && (
                        <button type="button" className="btn btn-secundario" data-testid="agregar-presentacion" onClick={() => setCreandoPara({ linea: l, productoId: l.productoSugeridoId })}>
                          <Icon name="mas" size={18} /> Agregar {l.medida ? medidaLegible(l.medida) : 'presentación'} a «{data.productos.find((p) => p.id === l.productoSugeridoId)?.nombre}»
                        </button>
                      )}
                      {puede('altaProducto') && (
                        <button type="button" className="btn btn-secundario" onClick={() => setCreandoPara({ linea: l })}>
                          <Icon name="mas" size={18} /> {l.productoSugeridoId ? 'Producto nuevo' : 'Crear'}
                        </button>
                      )}
                      <button type="button" className="btn btn-fantasma" onClick={() => cambiarLinea(l.key, { ignorada: true }, false)}>
                        Ignorar
                      </button>
                    </div>
                  )}

                  <div className="fila-2">
                    <Campo etiqueta={enBultos[l.key] && bultos ? `Bultos de ${bultos}` : 'Cantidad (unidades)'} error={errCant} htmlFor={`cant-${l.key}`}>
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
                    {bultos && (
                      <Campo etiqueta="Se cargó en" htmlFor={`ub-${l.key}`}>
                        <select id={`ub-${l.key}`} value={enBultos[l.key] ? 'bultos' : 'unidades'} onChange={(e) => setEnBultos((b) => ({ ...b, [l.key]: e.target.value === 'bultos' }))}>
                          <option value="unidades">Unidades</option>
                          <option value="bultos">Bultos de {bultos}</option>
                        </select>
                      </Campo>
                    )}
                    {(producto?.perecedero || l.fechaVencimiento) && (
                      <Campo etiqueta="Vencimiento" htmlFor={`venc-${l.key}`}>
                        <input id={`venc-${l.key}`} type="date" value={l.fechaVencimiento} onChange={(e) => cambiarLinea(l.key, { fechaVencimiento: e.target.value })} />
                      </Campo>
                    )}
                  </div>

                  <div className="linea-pie">
                    {enBultos[l.key] && bultos && typeof leerNumero(l.cantidad) === 'number' && (
                      <span className="texto-suave">= {Number(leerNumero(l.cantidad)) * bultos} unidades</span>
                    )}
                    {l.revisar && l.presentacionId && (
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
        <AltaProducto
          nombreInicial={tituloDesdeRemito(creandoPara.linea.descripcion)}
          presentacionInicial={medidaDe(creandoPara.linea.descripcion)?.replace('_', ',') ?? ''}
          proveedorIdsIniciales={proveedorId ? [proveedorId] : []}
          {...(creandoPara.productoId ? { productoExistenteId: creandoPara.productoId } : {})}
          onCerrar={() => setCreandoPara(null)}
          onGuardado={(x) => cambiarLinea(creandoPara.linea.key, { presentacionId: x.id, motivoRevision: undefined, productoSugeridoId: undefined, opciones: undefined })}
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
