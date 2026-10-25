import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Hoja } from '../components/ui';
import { Icon } from '../components/Icon';
import { cuandoEs, formatFechaCorta, isoDate, startOfDay } from '../lib/dates';
import { abreviaturaUnidad, formatoCantidad, itemsDeProveedor } from '../lib/inventario';
import { leerNumero } from '../lib/validation';
import { irA } from '../lib/router';
import {
  aBultos, linkWhatsApp, mensajePedido, nombrePedido, sugerir, telefonoWhatsApp, textoBultos, ventanaDePedido,
  type ItemPedido, type Prioridad, type Sugerencia,
} from '../lib/pedido';
import type { Proveedor } from '../types';

// Asistente para preparar el pedido de un proveedor.
//   1. Calcula la sugerencia con datos reales (stock, punto de pedido, consumo entre conteos,
//      días de visita, presentaciones, vencimientos) y explica por qué cada ítem es prioritario.
//   2. La persona revisa, cambia o quita cantidades.
//   3. Ve el mensaje final (y lo puede retocar).
//   4. Se abre WhatsApp con el mensaje: la persona lo revisa y lo envía. Nunca se envía solo.
// Funciona con reglas: no usa un modelo de IA generativa.

const TITULO_PRIORIDAD: Record<Prioridad, string> = {
  alta: 'Prioridad alta',
  media: 'Conviene pedir',
  baja: 'Podés sumar',
  ninguna: 'No hace falta pedir',
};

export function AsistentePedido({ proveedor, onCerrar }: { proveedor: Proveedor; onCerrar: () => void }) {
  const { data, vistas, avisar } = useStore();
  const ahora = new Date();
  const hoy = startOfDay(ahora);
  const ventana = ventanaDePedido(proveedor, hoy);

  const sugerencias: Sugerencia[] = useMemo(() => {
    if (!ventana) return [];
    return itemsDeProveedor(data, proveedor.id).map((it) => sugerir(data, vistas, it, ventana, ahora));
    // la ventana depende solo del proveedor y del día
  }, [data, vistas, proveedor.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [bultos, setBultos] = useState(false);
  const [cantidades, setCantidades] = useState<Record<string, string>>(() =>
    Object.fromEntries(sugerencias.map((s) => [s.item.presentacion.id, String(s.cantidad)])),
  );
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [verNinguna, setVerNinguna] = useState(false);
  const [nota, setNota] = useState('');
  const [paso, setPaso] = useState<'revisar' | 'mensaje'>('revisar');
  const [textoFinal, setTextoFinal] = useState('');

  const leer = (id: string): number => {
    const n = leerNumero(cantidades[id] ?? '');
    return typeof n === 'number' && n > 0 ? n : 0;
  };
  const poner = (id: string, n: number) => setCantidades((c) => ({ ...c, [id]: String(Math.max(0, n)) }));
  const aplicarBultos = (activar: boolean) => {
    setBultos(activar);
    setCantidades((c) => Object.fromEntries(sugerencias.map((s) => {
      const id = s.item.presentacion.id;
      const actual = Number(leerNumero(c[id] ?? '')) || 0;
      return [id, String(activar ? aBultos(actual, s.item.presentacion) : actual)];
    })));
  };

  const items: ItemPedido[] = sugerencias.map((s) => ({ presentacion: s.item.presentacion, nombre: nombrePedido(s.item), cantidad: leer(s.item.presentacion.id) }));
  const conCantidad = items.filter((i) => i.cantidad > 0);
  const texto = ventana ? mensajePedido(proveedor, ventana.visita, items, nota) : '';
  const telefono = telefonoWhatsApp(proveedor.telefono);
  const hayBultos = sugerencias.some((s) => s.item.presentacion.unidadesPorBulto);

  const grupos = (['alta', 'media', 'baja', 'ninguna'] as Prioridad[])
    .map((p) => ({ prioridad: p, items: sugerencias.filter((s) => s.prioridad === p) }))
    .filter((g) => g.items.length > 0);

  const copiar = async (t: string) => {
    const ok = await copiarTexto(t);
    avisar(ok ? 'Pedido copiado. Pegalo en el chat con el proveedor.' : 'No se pudo copiar. Mantené apretado el texto para copiarlo.', ok ? 'ok' : 'error');
  };

  if (!ventana) {
    return (
      <Hoja titulo={`Pedido · ${proveedor.nombre}`} onCerrar={onCerrar}>
        <p className="texto-suave">Este proveedor no tiene días de visita cargados: no se puede calcular para cuándo tiene que alcanzar el pedido.</p>
        <button type="button" className="btn btn-secundario btn-bloque" onClick={() => { onCerrar(); irA('catalogo', { pestana: 'proveedores' }); }}>Cargar días en Catálogo</button>
      </Hoja>
    );
  }

  if (paso === 'mensaje') {
    return (
      <Hoja
        titulo={`Mensaje para ${proveedor.nombre}`}
        onCerrar={onCerrar}
        pie={
          <div className="acciones-columna sin-margen">
            <a className="btn btn-primario btn-bloque btn-grande" href={linkWhatsApp(telefono, textoFinal)} target="_blank" rel="noopener noreferrer" data-testid="abrir-whatsapp">
              <Icon name="enviar" /> Abrir WhatsApp
            </a>
            <button type="button" className="btn btn-secundario btn-bloque" onClick={() => void copiar(textoFinal)}><Icon name="copiar" /> Copiar mensaje</button>
            <button type="button" className="btn btn-fantasma btn-bloque" onClick={() => setPaso('revisar')}>Volver a las cantidades</button>
          </div>
        }
      >
        <p className="texto-suave">Revisalo antes de mandarlo. WhatsApp se abre con el texto listo: el envío lo hacés vos.</p>
        {!telefono && (
          <p className="texto-suave pedido-nota">
            {vistas.tieneTelefono ? 'Este proveedor no tiene teléfono cargado: WhatsApp te va a pedir que elijas el contacto.' : 'WhatsApp te va a pedir que elijas el contacto.'}
          </p>
        )}
        <label className="campo">
          <span className="sr-only">Mensaje</span>
          <textarea className="mensaje-final" value={textoFinal} onChange={(e) => setTextoFinal(e.target.value)} rows={Math.min(18, textoFinal.split('\n').length + 1)} data-testid="mensaje-final" />
        </label>
      </Hoja>
    );
  }

  return (
    <Hoja
      titulo={`Pedido · ${proveedor.nombre}`}
      onCerrar={onCerrar}
      pie={
        sugerencias.length > 0 ? (
          <button type="button" className="btn btn-primario btn-bloque btn-grande" disabled={conCantidad.length === 0} onClick={() => { setTextoFinal(texto); setPaso('mensaje'); }}>
            <Icon name="enviar" /> {conCantidad.length === 0 ? 'No hay nada para pedir' : `Ver mensaje (${conCantidad.length})`}
          </button>
        ) : undefined
      }
    >
      {sugerencias.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Este proveedor no tiene presentaciones asociadas.</p>
          <button type="button" className="btn btn-secundario" onClick={() => { onCerrar(); irA('catalogo', { pestana: 'proveedores' }); }}>Asociar en Catálogo</button>
        </div>
      ) : (
        <>
          <p className="pedido-intro">
            Para la visita de <strong>{cuandoEs(ventana.visita)}</strong>. Cada cantidad busca alcanzar hasta la entrega siguiente ({cuandoEs(ventana.siguiente)}, o antes si otro proveedor trae lo mismo) sin bajar del punto de pedido.
          </p>
          <p className="aviso-reglas"><Icon name="alerta" size={15} /> Asistente basado en reglas con los datos de Góndola (no usa IA generativa). Las cantidades son sugerencias: cambialas o quitalas.</p>
          {hayBultos && (
            <label className="interruptor">
              <input type="checkbox" checked={bultos} onChange={(e) => aplicarBultos(e.target.checked)} />
              <span className="interruptor-pista" aria-hidden="true" />
              <span>Redondear a bultos completos (solo donde la equivalencia está cargada)</span>
            </label>
          )}
          {grupos.map((g) => (
            <section key={g.prioridad} className={`grupo-pedido prioridad-${g.prioridad}`}>
              <h3 className="grupo-pedido-titulo">
                {TITULO_PRIORIDAD[g.prioridad]} <span className="contador-pestana">{g.items.length}</span>
                {g.prioridad === 'ninguna' && (
                  <button type="button" className="btn-link" onClick={() => setVerNinguna((v) => !v)}>{verNinguna ? 'Ocultar' : 'Mostrar'}</button>
                )}
              </h3>
              {(g.prioridad !== 'ninguna' || verNinguna) && (
                <ul className="lista-conteo">
                  {g.items.map((s) => {
                    const id = s.item.presentacion.id;
                    const inputId = `pedido-${id}`;
                    const cant = leer(id);
                    return (
                      <li key={id} className={`fila-conteo${cant > 0 ? ' completa' : ''}`} data-testid="item-pedido">
                        <div className="fila-conteo-cabecera">
                          <label htmlFor={inputId} className="fila-conteo-nombre">{nombrePedido(s.item)}</label>
                          <span className="texto-suave">Stock {s.stock === null ? '—' : formatoCantidad(s.stock)} · punto {formatoCantidad(s.item.presentacion.puntoDePedido)}</span>
                        </div>
                        <p className="texto-suave pedido-detalle">
                          Sugerido: <strong>{s.cantidad}</strong> {abreviaturaUnidad(s.item.presentacion.unidadStock)}
                          {s.stockEnVisita !== null && ` · en la visita quedarían ~${formatoCantidad(Math.round(s.stockEnVisita * 10) / 10)}`}
                          {' · '}hasta el {formatFechaCorta(isoDate(s.hasta))}
                        </p>
                        <button type="button" className="btn-link" onClick={() => setAbiertos((a) => ({ ...a, [id]: !a[id] }))} aria-expanded={!!abiertos[id]}>
                          {abiertos[id] ? 'Ocultar el porqué' : '¿Por qué?'}
                        </button>
                        {abiertos[id] && (
                          <ul className="motivos">
                            {s.motivos.map((m) => <li key={m}>{m}</li>)}
                            {s.avisos.map((m) => <li key={m} className="motivo-aviso">{m}</li>)}
                          </ul>
                        )}
                        {!abiertos[id] && s.avisos.length > 0 && <p className="motivo-aviso">{s.avisos[0]}</p>}
                        <div className="fila-pedido">
                          <div className="contador">
                            <button type="button" className="contador-btn" aria-label={`Restar a ${nombrePedido(s.item)}`} onClick={() => poner(id, cant - (bultos && s.item.presentacion.unidadesPorBulto ? s.item.presentacion.unidadesPorBulto : 1))}>−</button>
                            <input id={inputId} className="contador-input" type="text" inputMode="decimal" autoComplete="off" value={cantidades[id] ?? ''} onChange={(e) => setCantidades((c) => ({ ...c, [id]: e.target.value }))} />
                            <button type="button" className="contador-btn" aria-label={`Sumar a ${nombrePedido(s.item)}`} onClick={() => poner(id, cant + (bultos && s.item.presentacion.unidadesPorBulto ? s.item.presentacion.unidadesPorBulto : 1))}>+</button>
                          </div>
                          {cant > 0 && <button type="button" className="btn btn-fantasma btn-chico" onClick={() => poner(id, 0)}>Quitar</button>}
                        </div>
                        {cant > 0 && textoBultos(cant, s.item.presentacion) && <p className="texto-suave">{textoBultos(cant, s.item.presentacion).trim()}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
          <label className="campo">
            <span>Nota para el proveedor (opcional)</span>
            <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={2} placeholder="Ej.: Si no tenés 500 ml, mandame 2,25 L." />
          </label>
        </>
      )}
    </Hoja>
  );
}

async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Respaldo para navegadores sin permiso de portapapeles
    try {
      const area = document.createElement('textarea');
      area.value = texto;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
