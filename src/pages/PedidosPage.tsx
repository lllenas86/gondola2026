import { useState } from 'react';
import { useStore } from '../state/store';
import { cuandoEs, formatDias, formatFechaCorta, startOfDay } from '../lib/dates';
import { proximaVisita } from '../lib/stock';
import { itemsDeProveedor } from '../lib/inventario';
import { sugerir, ventanaDePedido } from '../lib/pedido';
import { Icon } from '../components/Icon';
import { EstadoConexion, Vacio } from '../components/ui';
import { AsistentePedido } from '../features/AsistentePedido';
import type { Proveedor } from '../types';

// Pedidos y seguimiento de proveedores (encargado y dueño).
export function PedidosPage() {
  const { data, vistas } = useStore();
  const [pedidoDe, setPedidoDe] = useState<Proveedor | null>(null);
  const ahora = new Date();
  const hoy = startOfDay(ahora);

  const filas = data.proveedores
    .map((p) => {
      const visita = proximaVisita(p, hoy);
      const ventana = ventanaDePedido(p, hoy);
      const items = itemsDeProveedor(data, p.id);
      const sug = ventana ? items.map((it) => sugerir(data, vistas, it, ventana, ahora)) : [];
      const ultima = data.recepciones.filter((r) => r.proveedorId === p.id).sort((a, b) => b.registradaEn.localeCompare(a.registradaEn))[0];
      const devAbiertas = data.devoluciones.filter((d) => d.proveedorId === p.id && (d.estado === 'preparada' || d.estado === 'confirmada')).length;
      return { p, visita, items, sug, ultima, devAbiertas };
    })
    .sort((a, b) => (a.visita?.getTime() ?? Infinity) - (b.visita?.getTime() ?? Infinity) || a.p.nombre.localeCompare(b.p.nombre, 'es'));

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Pedidos</p>
        <h1>Proveedores y pedidos</h1>
      </header>
      {filas.length === 0 && <Vacio titulo="Todavía no hay proveedores cargados." />}
      {filas.map(({ p, visita, items, sug, ultima, devAbiertas }) => {
        const pedir = sug.filter((s) => s.cantidad > 0);
        const altas = pedir.filter((s) => s.prioridad === 'alta');
        return (
          <article key={p.id} className={`tarjeta${altas.length > 0 ? ' tarjeta-falta' : ''}`} data-testid="tarjeta-proveedor">
            <div className="tarjeta-cabecera">
              <div>
                <h3>{p.nombre}</h3>
                <p className={visita && cuandoEs(visita) === 'hoy' ? 'texto-visita hoy' : 'texto-visita'}>
                  {visita ? `Próxima visita ${cuandoEs(visita)}` : 'Sin días de visita'} · pasa {formatDias(p.diasDeVisita) || '—'}
                </p>
              </div>
              <Icon name="camion" className="icono-suave" />
            </div>
            <p className="texto-suave">
              {items.length} {items.length === 1 ? 'presentación' : 'presentaciones'} ·{' '}
              {pedir.length === 0 ? 'nada para pedir' : `${pedir.length} para pedir${altas.length > 0 ? ` (${altas.length} prioridad alta)` : ''}`}
            </p>
            <p className="texto-suave">
              Última recepción: {ultima ? formatFechaCorta(ultima.fecha) : 'sin registros'}
              {devAbiertas > 0 ? ` · ${devAbiertas} ${devAbiertas === 1 ? 'devolución abierta' : 'devoluciones abiertas'}` : ''}
            </p>
            {items.length > 0 && (
              <button type="button" className={`btn ${altas.length > 0 ? 'btn-primario' : 'btn-secundario'} btn-bloque boton-pedido`} onClick={() => setPedidoDe(p)}>
                <Icon name="carrito" /> Preparar pedido
              </button>
            )}
          </article>
        );
      })}
      {pedidoDe && <AsistentePedido key={pedidoDe.id} proveedor={pedidoDe} onCerrar={() => setPedidoDe(null)} />}
    </>
  );
}
