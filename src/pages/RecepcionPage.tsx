import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { urlRemitoEjemplo } from '../demo/remitos';
import { comprimirImagen, dataUrlABlob } from '../lib/imagen';
import { ErrorLectura, leerRemito } from '../lib/remitoIA';
import { cancelarBorrador, crearBorradorDesdeFoto, subirFotoRemito } from '../lib/datos';
import { urlFirmada } from '../lib/supabase';
import { vincularLinea, vincularProveedor } from '../lib/match';
import { itemsActivos, itemsDeProveedor, nombreDe, nombreItem } from '../lib/inventario';
import { medidaPresentacion } from '../lib/match';
import { formatFechaCorta, formatFechaHora, parseIsoDate } from '../lib/dates';
import { Icon } from '../components/Icon';
import { EstadoConexion, Hoja, Vacio } from '../components/ui';
import { RevisionRecepcion, type ResultadoConfirmacion } from '../features/RevisionRecepcion';
import type { Borrador, LineaBorradorBase, Recepcion } from '../types';

type Paso =
  | { tipo: 'inicio' }
  | { tipo: 'leyendo'; imagen: string }
  | { tipo: 'error'; imagen: string; imagenPath: string | null; mensaje: string }
  | {
      tipo: 'revision';
      origen: 'manual' | 'remito_foto';
      imagenUrl?: string;
      imagenPath?: string | null;
      borrador?: Borrador;
      /** Al cancelar, el borrador se marca como cancelado (fotos recién leídas) */
      descartarAlCancelar?: boolean;
    };

const esEjemplo = (b: Borrador) => !!b.imagen?.startsWith('ejemplo:');

/** Convierte la imagen guardada en la recepción en una URL para mostrar. */
export async function resolverImagen(imagen: string | undefined, fecha: string | null): Promise<string | undefined> {
  if (!imagen) return undefined;
  if (imagen.startsWith('ejemplo:')) {
    const id = imagen.split(':')[1];
    return urlRemitoEjemplo(id, fecha ? parseIsoDate(fecha) : new Date()) ?? undefined;
  }
  if (imagen.startsWith('data:')) return imagen;
  return (await urlFirmada(imagen)) ?? undefined;
}

export function RecepcionPage() {
  const { data, avisar, ejecutar, nuevoId } = useStore();
  const [paso, setPaso] = useState<Paso>({ tipo: 'inicio' });
  const [resultado, setResultado] = useState<ResultadoConfirmacion | null>(null);
  const [detalle, setDetalle] = useState<Recepcion | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);

  const alElegirFoto = async (archivo: File | undefined) => {
    if (!archivo) return;
    setResultado(null);
    let imagen: string;
    try {
      imagen = await comprimirImagen(archivo);
    } catch {
      avisar('No se pudo abrir el archivo. Elegí una foto (JPG o PNG).', 'error');
      return;
    }
    setPaso({ tipo: 'leyendo', imagen });

    // Se guarda la foto en el bucket (si existe) mientras la IA la lee.
    const [subida, lectura] = await Promise.allSettled([
      subirFotoRemito(dataUrlABlob(imagen), nuevoId()),
      // Se mandan los nombres con el tamaño, para que la IA distinga presentaciones
      leerRemito(imagen, itemsActivos(data).map((it) => {
        const n = nombreItem(it.producto, it.presentacion);
        const m = medidaPresentacion(it);
        return m && !n.includes(m.replace('_', ',')) ? `${n} (${m.replace('_', ',')})` : n;
      })),
    ]);
    const imagenPath = subida.status === 'fulfilled' ? subida.value : null;

    if (lectura.status === 'rejected') {
      const e = lectura.reason;
      setPaso({ tipo: 'error', imagen, imagenPath, mensaje: e instanceof ErrorLectura ? e.message : 'No se pudo leer el remito.' });
      return;
    }
    const { extraccion, crudo } = lectura.value;

    // El vínculo final lo hace la app, por similitud de nombre.
    const proveedorId = vincularProveedor(extraccion.proveedor, data.proveedores);
    const ids = new Set(proveedorId ? itemsDeProveedor(data, proveedorId).map((it) => it.presentacion.id) : []);
    const items = itemsActivos(data);
    const lineas: LineaBorradorBase[] = extraccion.lineas.map((l) => {
      const v = vincularLinea(l.descripcion, items, ids, data.alias);
      return {
        presentacionId: v.presentacionId,
        ...(v.motivo ? { motivoRevision: v.motivo } : {}),
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        ...(l.fechaVencimiento ? { fechaVencimiento: l.fechaVencimiento } : {}),
        ...(l.confianzaLectura !== undefined ? { confianza: l.confianzaLectura } : {}),
        confianzaVinculo: v.confianza,
      };
    });

    // Se crea la recepción en BORRADOR: nada suma al stock hasta "Confirmar recepción".
    const r = await ejecutar(() => crearBorradorDesdeFoto({
      proveedorId,
      fecha: extraccion.fecha || null,
      imagenPath,
      datosIa: crudo,
      lineas,
    }));
    if (!r.ok) {
      setPaso({ tipo: 'error', imagen, imagenPath, mensaje: `Se leyó el remito, pero no se pudo guardar el borrador. ${r.error.texto}` });
      return;
    }
    setPaso({
      tipo: 'revision',
      origen: 'remito_foto',
      imagenUrl: imagen,
      descartarAlCancelar: true,
      borrador: {
        id: r.valor,
        proveedorId,
        proveedorTexto: extraccion.proveedor,
        fecha: extraccion.fecha || null,
        origen: 'remito_foto',
        ...(imagenPath ? { imagen: imagenPath } : {}),
        creadaEn: new Date().toISOString(),
        lineas,
      },
    });
  };

  /** Abre un borrador guardado en la base (remito de ejemplo o pendiente de revisar). */
  const abrirBorrador = async (b: Borrador) => {
    setResultado(null);
    setAbriendo(b.id);
    const imagenUrl = await resolverImagen(b.imagen, b.fecha);
    setAbriendo(null);
    setPaso({ tipo: 'revision', origen: 'remito_foto', imagenUrl, borrador: b });
  };

  if (paso.tipo === 'revision') {
    return (
      <RevisionRecepcion
        origen={paso.origen}
        imagenUrl={paso.imagenUrl}
        imagenPath={paso.imagenPath}
        borrador={paso.borrador}
        onCancelar={() => {
          if (paso.descartarAlCancelar && paso.borrador) void ejecutar(() => cancelarBorrador(paso.borrador!.id));
          setPaso({ tipo: 'inicio' });
        }}
        onConfirmada={(r) => {
          setResultado(r);
          setPaso({ tipo: 'inicio' });
          avisar('Recepción guardada. Se actualizó el stock.');
          window.scrollTo(0, 0);
        }}
      />
    );
  }

  const ejemplos = data.borradores.filter(esEjemplo);
  const pendientes = data.borradores.filter((b) => !esEjemplo(b));
  const nombreProveedor = (b: Borrador) =>
    data.proveedores.find((p) => p.id === b.proveedorId)?.nombre ?? b.proveedorTexto ?? 'Proveedor sin identificar';
  const recientes = [...data.recepciones].sort((a, b) => b.registradaEn.localeCompare(a.registradaEn)).slice(0, 8);

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Recepción</p>
        <h1>¿Qué te trajo el proveedor?</h1>
      </header>

      {resultado && (
        <section className="tarjeta tarjeta-exito" aria-live="polite">
          <div className="tarjeta-cabecera">
            <h3><Icon name="check" /> Recepción de {resultado.proveedor} guardada</h3>
            <button type="button" className="btn-icono" onClick={() => setResultado(null)} aria-label="Cerrar resumen"><Icon name="cerrar" size={18} /></button>
          </div>
          <ul className="lista-cambios">
            {resultado.cambios.map((c) => (
              <li key={c.nombre}>
                <span>{c.nombre}</span>
                <span className="cambio-num">{c.antes ?? 0} → <strong>{c.despues}</strong> <small>(+{c.recibido})</small></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(paso.tipo === 'leyendo' || paso.tipo === 'error') && (
        <section className="tarjeta">
          <div className="lectura">
            <img src={paso.imagen} alt="Foto elegida" className="lectura-miniatura" />
            {paso.tipo === 'leyendo' ? (
              <div className="lectura-texto">
                <span className="spinner" aria-hidden="true" />
                <p><strong>Leyendo el remito…</strong></p>
                <p className="texto-suave">Puede tardar unos segundos.</p>
              </div>
            ) : (
              <div className="lectura-texto" role="alert">
                <p className="texto-error"><Icon name="alerta" size={18} /> <strong>{paso.mensaje}</strong></p>
                <p className="texto-suave">Podés cargarlo a mano (la foto queda con la recepción) o probar con otra foto.</p>
              </div>
            )}
          </div>
          {paso.tipo === 'error' && (
            <div className="acciones-columna">
              <button type="button" className="btn btn-primario btn-bloque" onClick={() => setPaso({ tipo: 'revision', origen: 'manual', imagenUrl: paso.imagen, imagenPath: paso.imagenPath })}>
                <Icon name="lapiz" /> Cargar a mano
              </button>
              <button type="button" className="btn btn-secundario btn-bloque" onClick={() => setPaso({ tipo: 'inicio' })}>
                Probar con otra foto
              </button>
            </div>
          )}
        </section>
      )}

      {paso.tipo === 'inicio' && (
        <>
          <section className="tarjeta">
            <h3 className="tarjeta-titulo"><Icon name="camara" /> Foto del remito</h3>
            <p className="texto-suave">La IA lee el remito y vos revisás antes de guardar.</p>
            <div className="acciones-2">
              <button type="button" className="btn btn-primario btn-grande" onClick={() => camara.current?.click()}>
                <Icon name="camara" /> Sacar foto
              </button>
              <button type="button" className="btn btn-secundario btn-grande" onClick={() => galeria.current?.click()}>
                <Icon name="imagen" /> Subir imagen
              </button>
            </div>
            <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void alElegirFoto(e.target.files?.[0]); e.target.value = ''; }} />
            <input ref={galeria} type="file" accept="image/*" hidden data-testid="subir-imagen" onChange={(e) => { void alElegirFoto(e.target.files?.[0]); e.target.value = ''; }} />
          </section>

          {pendientes.length > 0 && (
            <section className="tarjeta">
              <h3 className="tarjeta-titulo"><Icon name="reloj" /> Remitos pendientes de revisar</h3>
              <div className="acciones-columna">
                {pendientes.map((b) => (
                  <button key={b.id} type="button" className="btn btn-secundario btn-bloque" disabled={abriendo === b.id} onClick={() => void abrirBorrador(b)}>
                    {nombreProveedor(b)} · {formatFechaHora(b.creadaEn)}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="tarjeta tarjeta-demo">
            <h3 className="tarjeta-titulo"><Icon name="documento" /> Usar remito de ejemplo</h3>
            <p className="texto-suave">Para evaluación: abre un remito ficticio ya leído por la IA (guardado en la base como borrador), con algunos errores para practicar la revisión.</p>
            {ejemplos.length === 0 ? (
              <p className="texto-suave">Ya se usaron los remitos de ejemplo.</p>
            ) : (
              <div className="acciones-columna">
                {ejemplos.map((b) => (
                  <button key={b.id} type="button" className="btn btn-secundario btn-bloque" disabled={abriendo === b.id} onClick={() => void abrirBorrador(b)}>
                    {abriendo === b.id ? 'Abriendo…' : `Usar remito de ejemplo · ${nombreProveedor(b)}`}
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="tarjeta">
            <h3 className="tarjeta-titulo"><Icon name="lapiz" /> Carga manual</h3>
            <p className="texto-suave">Para proveedores que no entregan remito.</p>
            <button type="button" className="btn btn-secundario btn-bloque btn-grande" onClick={() => { setResultado(null); setPaso({ tipo: 'revision', origen: 'manual' }); }}>
              Cargar a mano
            </button>
          </section>

          <section className="seccion">
            <h2 className="seccion-titulo">Últimas recepciones</h2>
            {recientes.length === 0 ? (
              <Vacio titulo="Todavía no se cargó ninguna recepción." />
            ) : (
              <ul className="lista-catalogo">
                {recientes.map((r) => {
                  const prov = data.proveedores.find((p) => p.id === r.proveedorId);
                  const unidades = r.lineas.reduce((a, l) => a + l.cantidad, 0);
                  return (
                    <li key={r.id}>
                      <button type="button" className="item-catalogo" onClick={() => setDetalle(r)}>
                        <div>
                          <p className="item-titulo">{prov?.nombre ?? 'Proveedor eliminado'}</p>
                          <p className="texto-suave">
                            {formatFechaCorta(r.fecha)} · {r.lineas.length} {r.lineas.length === 1 ? 'producto' : 'productos'} · {unidades} unidades
                          </p>
                          <span className={`etiqueta ${r.origen === 'remito_foto' ? 'etiqueta-azul' : 'etiqueta-gris'}`}>
                            {r.origen === 'remito_foto' ? 'Foto del remito' : 'Carga manual'}
                          </span>
                        </div>
                        <Icon name="derecha" className="icono-suave" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      {detalle && (
        <Hoja titulo={`Recepción del ${formatFechaCorta(detalle.fecha)}`} onCerrar={() => setDetalle(null)}>
          <p className="texto-suave">{data.proveedores.find((p) => p.id === detalle.proveedorId)?.nombre}</p>
          <ul className="lista-cambios">
            {detalle.lineas.map((l, i) => (
              <li key={`${l.presentacionId}-${i}`}>
                <span>{nombreDe(data, l.presentacionId)}</span>
                <span className="cambio-num">
                  +{l.cantidad}
                  {l.fechaVencimiento && <small> · vence {formatFechaCorta(l.fechaVencimiento)}</small>}
                </span>
              </li>
            ))}
          </ul>
          <FotoRecepcion imagen={detalle.imagen} fecha={detalle.fecha} />
        </Hoja>
      )}
    </>
  );
}

function FotoRecepcion({ imagen, fecha }: { imagen?: string; fecha: string }) {
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    let vivo = true;
    void resolverImagen(imagen, fecha).then((u) => vivo && setUrl(u));
    return () => {
      vivo = false;
    };
  }, [imagen, fecha]);
  return url ? <img className="detalle-foto" src={url} alt="Foto del remito" /> : null;
}
