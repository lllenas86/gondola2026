import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Hoja } from '../components/ui';
import { Icon } from '../components/Icon';
import { cuandoEs, startOfDay } from '../lib/dates';
import { productosDeProveedor } from '../lib/stock';
import { leerNumero } from '../lib/validation';
import { irA } from '../lib/router';
import {
  linkWhatsApp, mensajePedido, sugerenciaProducto, telefonoWhatsApp, ventanaDePedido, type ItemPedido,
} from '../lib/pedido';
import type { Proveedor } from '../types';

// Hoja "Armar pedido": cantidad sugerida por producto (editable) y envío por WhatsApp o copia.
// No guarda nada en la base: el pedido se registra cuando llega la mercadería (Recepción).

const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });

export function PedidoHoja({ proveedor, onCerrar }: { proveedor: Proveedor; onCerrar: () => void }) {
  const { data, vistas, avisar } = useStore();
  const hoy = startOfDay(new Date());
  const ventana = ventanaDePedido(proveedor, hoy);

  const filas = useMemo(() => {
    if (!ventana) return [];
    return productosDeProveedor(data, proveedor.id).map((p) => ({ producto: p, sug: sugerenciaProducto(data, vistas, p, ventana) }));
    // ventana depende solo del proveedor y del día
  }, [data, vistas, proveedor.id]);

  const [cantidades, setCantidades] = useState<Record<string, string>>(() =>
    Object.fromEntries(filas.map((f) => [f.producto.id, String(f.sug.cantidad)])),
  );

  const leer = (id: string): number => {
    const n = leerNumero(cantidades[id] ?? '');
    return typeof n === 'number' && n > 0 ? n : 0;
  };
  const sumar = (id: string, delta: number) =>
    setCantidades((c) => ({ ...c, [id]: String(Math.max(0, leer(id) + delta)) }));

  const items: ItemPedido[] = filas.map((f) => ({ nombre: f.producto.nombre, cantidad: leer(f.producto.id) }));
  const conCantidad = items.filter((i) => i.cantidad > 0).length;
  const texto = ventana ? mensajePedido(proveedor, ventana.visita, items) : '';
  const telefono = telefonoWhatsApp(proveedor.telefono);

  const copiar = async () => {
    const ok = await copiarTexto(texto);
    avisar(ok ? 'Pedido copiado. Pegalo en el chat con el proveedor.' : 'No se pudo copiar. Mantené apretado el texto para copiarlo.', ok ? 'ok' : 'error');
  };

  return (
    <Hoja
      titulo={`Pedido · ${proveedor.nombre}`}
      onCerrar={onCerrar}
      pie={
        ventana && filas.length > 0 ? (
          <div className="acciones-columna sin-margen">
            {conCantidad > 0 ? (
              <a className="btn btn-primario btn-bloque btn-grande" href={linkWhatsApp(telefono, texto)} target="_blank" rel="noopener noreferrer">
                <Icon name="enviar" /> Enviar por WhatsApp ({conCantidad})
              </a>
            ) : (
              <button type="button" className="btn btn-primario btn-bloque btn-grande" disabled>
                <Icon name="enviar" /> No hay nada para pedir
              </button>
            )}
            <button type="button" className="btn btn-secundario btn-bloque" onClick={() => void copiar()} disabled={conCantidad === 0}>
              <Icon name="copiar" /> Copiar pedido
            </button>
          </div>
        ) : undefined
      }
    >
      {!ventana ? (
        <p className="texto-suave">Este proveedor no tiene días de visita cargados.</p>
      ) : filas.length === 0 ? (
        <div className="vacio">
          <p className="vacio-titulo">Este proveedor no tiene productos asociados.</p>
          <button type="button" className="btn btn-secundario" onClick={() => { onCerrar(); irA('catalogo', { pestana: 'proveedores' }); }}>
            Asociar productos en Catálogo
          </button>
        </div>
      ) : (
        <>
          <p className="pedido-intro">
            Lo sugerido alcanza hasta la próxima entrega ({cuandoEs(ventana.siguiente)}, o antes si otro proveedor trae el mismo producto) sin bajar del punto de pedido. Podés cambiar las cantidades.
          </p>
          {!telefono && (
            <p className="texto-suave pedido-nota">
              {vistas.tieneTelefono
                ? 'Este proveedor no tiene teléfono cargado: WhatsApp te va a pedir que elijas el contacto. Podés cargarlo en Catálogo → Proveedores.'
                : 'WhatsApp te va a pedir que elijas el contacto.'}
            </p>
          )}
          <ul className="lista-conteo">
            {filas.map(({ producto, sug }) => {
              const inputId = `pedido-${producto.id}`;
              return (
                <li key={producto.id} className={`fila-conteo${leer(producto.id) > 0 ? ' completa' : ''}`}>
                  <div className="fila-conteo-cabecera">
                    <label htmlFor={inputId} className="fila-conteo-nombre">{producto.nombre}</label>
                    <span className="texto-suave">
                      Stock {sug.stock ?? '—'} · punto {producto.puntoDePedido}
                    </span>
                  </div>
                  <p className="texto-suave pedido-detalle">
                    {sug.conHistorial && sug.consumoDiario !== null
                      ? `Se venden ~${fmt(sug.consumoDiario)} por día. Sugerido: ${sug.cantidad}.`
                      : `Sin historial de ventas: sugerido ${sug.cantidad} para llegar al doble del punto de pedido.`}
                  </p>
                  <div className="contador">
                    <button type="button" className="contador-btn" aria-label={`Restar 1 a ${producto.nombre}`} onClick={() => sumar(producto.id, -1)}>−</button>
                    <input
                      id={inputId}
                      className="contador-input"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={cantidades[producto.id] ?? ''}
                      onChange={(e) => setCantidades((c) => ({ ...c, [producto.id]: e.target.value }))}
                    />
                    <button type="button" className="contador-btn" aria-label={`Sumar 1 a ${producto.nombre}`} onClick={() => sumar(producto.id, 1)}>+</button>
                  </div>
                </li>
              );
            })}
          </ul>
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
