import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { REMITOS_EJEMPLO, urlRemitoEjemplo, type Extraccion } from '../demo/remitos';
import { comprimirImagen } from '../lib/imagen';
import { ErrorLectura, hayLecturaConIA, leerRemito } from '../lib/remitoIA';
import { formatFechaCorta, parseIsoDate } from '../lib/dates';
import { Icon } from '../components/Icon';
import { Hoja, Vacio } from '../components/ui';
import { RevisionRecepcion, type ResultadoConfirmacion } from '../features/RevisionRecepcion';
import type { Recepcion } from '../types';

type Paso =
  | { tipo: 'inicio' }
  | { tipo: 'leyendo'; imagen: string }
  | { tipo: 'error'; imagen: string; mensaje: string }
  | { tipo: 'revision'; origen: 'manual' | 'remito_foto'; imagenUrl?: string; imagenGuardar?: string; extraccion?: Extraccion };

/** Convierte lo guardado en la recepción en una URL para mostrar. */
export function urlImagen(imagen?: string): string | undefined {
  if (!imagen) return undefined;
  if (imagen.startsWith('ejemplo:')) {
    const [, id, fecha] = imagen.split(':');
    return urlRemitoEjemplo(id, fecha ? parseIsoDate(fecha) : new Date()) ?? undefined;
  }
  return imagen;
}

export function RecepcionPage() {
  const { data, avisar } = useStore();
  const [paso, setPaso] = useState<Paso>({ tipo: 'inicio' });
  const [resultado, setResultado] = useState<ResultadoConfirmacion | null>(null);
  const [detalle, setDetalle] = useState<Recepcion | null>(null);
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
    try {
      const extraccion = await leerRemito(imagen);
      setPaso({ tipo: 'revision', origen: 'remito_foto', imagenUrl: imagen, imagenGuardar: imagen, extraccion });
    } catch (e) {
      const mensaje = e instanceof ErrorLectura ? e.message : 'No se pudo leer el remito.';
      setPaso({ tipo: 'error', imagen, mensaje });
    }
  };

  const usarEjemplo = (id: string) => {
    const r = REMITOS_EJEMPLO.find((x) => x.id === id);
    if (!r) return;
    const hoy = new Date();
    setResultado(null);
    setPaso({
      tipo: 'revision',
      origen: 'remito_foto',
      imagenUrl: urlRemitoEjemplo(id, hoy) ?? undefined,
      imagenGuardar: `ejemplo:${id}:${r.extraccion(hoy).fecha}`,
      extraccion: r.extraccion(hoy),
    });
  };

  if (paso.tipo === 'revision') {
    return (
      <RevisionRecepcion
        origen={paso.origen}
        imagenUrl={paso.imagenUrl}
        imagenGuardar={paso.imagenGuardar}
        extraccion={paso.extraccion}
        onCancelar={() => setPaso({ tipo: 'inicio' })}
        onConfirmada={(r) => {
          setResultado(r);
          setPaso({ tipo: 'inicio' });
          avisar('Recepción guardada. Se actualizó el stock.');
          window.scrollTo(0, 0);
        }}
      />
    );
  }

  const recientes = [...data.recepciones].sort((a, b) => b.registradaEn.localeCompare(a.registradaEn)).slice(0, 8);

  return (
    <>
      <header className="cabecera">
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
              </div>
            ) : (
              <div className="lectura-texto" role="alert">
                <p className="texto-error"><Icon name="alerta" size={18} /> <strong>{paso.mensaje}</strong></p>
                <p className="texto-suave">Podés cargarlo a mano (la foto queda guardada con la recepción) o probar con otra foto.</p>
              </div>
            )}
          </div>
          {paso.tipo === 'error' && (
            <div className="acciones-columna">
              <button type="button" className="btn btn-primario btn-bloque" onClick={() => setPaso({ tipo: 'revision', origen: 'manual', imagenUrl: paso.imagen, imagenGuardar: paso.imagen })}>
                <Icon name="lapiz" /> Cargar a mano con esta foto
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
            <p className="texto-suave">
              {hayLecturaConIA()
                ? 'La IA lee el remito y vos revisás antes de guardar.'
                : 'La lectura automática no está configurada en esta versión: usá un remito de ejemplo o cargalo a mano.'}
            </p>
            <div className="acciones-2">
              <button type="button" className="btn btn-primario btn-grande" onClick={() => camara.current?.click()}>
                <Icon name="camara" /> Sacar foto
              </button>
              <button type="button" className="btn btn-secundario btn-grande" onClick={() => galeria.current?.click()}>
                <Icon name="imagen" /> Subir imagen
              </button>
            </div>
            <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { alElegirFoto(e.target.files?.[0]); e.target.value = ''; }} />
            <input ref={galeria} type="file" accept="image/*" hidden data-testid="subir-imagen" onChange={(e) => { alElegirFoto(e.target.files?.[0]); e.target.value = ''; }} />
          </section>

          <section className="tarjeta tarjeta-demo">
            <h3 className="tarjeta-titulo"><Icon name="documento" /> Usar remito de ejemplo</h3>
            <p className="texto-suave">Modo demo: carga un remito ficticio y simula la lectura con IA, con algunos errores para practicar la revisión.</p>
            <div className="acciones-columna">
              {REMITOS_EJEMPLO.map((r) => (
                <button key={r.id} type="button" className="btn btn-secundario btn-bloque" onClick={() => usarEjemplo(r.id)}>
                  Usar remito de ejemplo · {r.titulo}
                </button>
              ))}
            </div>
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
            {detalle.lineas.map((l) => (
              <li key={l.productoId}>
                <span>{data.productos.find((p) => p.id === l.productoId)?.nombre ?? 'Producto eliminado'}</span>
                <span className="cambio-num">
                  +{l.cantidad}
                  {l.fechaVencimiento && <small> · vence {formatFechaCorta(l.fechaVencimiento)}</small>}
                </span>
              </li>
            ))}
          </ul>
          {urlImagen(detalle.imagen) && <img className="detalle-foto" src={urlImagen(detalle.imagen)} alt="Foto del remito" />}
        </Hoja>
      )}
    </>
  );
}
