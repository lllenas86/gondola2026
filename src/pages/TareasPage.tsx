import { useStore } from '../state/store';
import { DIAS_LARGOS, formatFechaCorta, formatFechaHora, startOfDay } from '../lib/dates';
import { abreviaturaUnidad, DIAS_SIN_CONTEO, diasDesdeConteo, formatoCantidad, itemsActivos, nombreItem, textoVence, ultimoConteo } from '../lib/inventario';
import { lotesConAlerta } from '../lib/vencimientos';
import { irA } from '../lib/router';
import { Icon } from '../components/Icon';
import { EstadoConexion } from '../components/ui';

// Inicio del empleado / repositor: solo sus tareas (recibir, contar, avisar vencidos).
export function TareasPage() {
  const { data, vistas } = useStore();
  const ahora = new Date();
  const hoy = startOfDay(ahora);
  const pendientes = data.borradores.filter((b) => !b.imagen?.startsWith('ejemplo:'));
  const todos = itemsActivos(data);
  const nunca = todos.filter((it) => !ultimoConteo(data, it.presentacion.id));
  const viejas = todos.filter((it) => {
    const d = diasDesdeConteo(ultimoConteo(data, it.presentacion.id), ahora);
    return d !== null && d > DIAS_SIN_CONTEO;
  });
  const vencidos = lotesConAlerta(data, ahora, 0).filter((a) => a.estado === 'vencido' || a.dias === 0);
  const pasanHoy = vistas.visitas.filter((v) => v.diasHasta === 0);
  const dia = DIAS_LARGOS[hoy.getDay()];
  const tareas = pendientes.length + (nunca.length + viejas.length > 0 ? 1 : 0) + (vencidos.length > 0 ? 1 : 0);

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Mis tareas</p>
        <h1>{dia.charAt(0).toUpperCase() + dia.slice(1)} {formatFechaCorta(ahora.toISOString())}</h1>
        <div className="resumen"><span className={tareas > 0 ? 'resumen-item ambar' : 'resumen-item'}><strong>{tareas}</strong> {tareas === 1 ? 'tarea' : 'tareas'}</span></div>
      </header>

      {pasanHoy.length > 0 && (
        <section className="tarjeta">
          <h3 className="tarjeta-titulo"><Icon name="camion" /> Hoy pasan</h3>
          <p className="texto-suave">{pasanHoy.map((v) => v.nombre).join(', ')}. Cuando llegue la mercadería, sacale foto al remito.</p>
          <button type="button" className="btn btn-primario btn-bloque boton-pedido" onClick={() => irA('recepcion')}><Icon name="camara" /> Recibir mercadería</button>
        </section>
      )}

      {pendientes.length > 0 && (
        <section className="tarjeta tarjeta-falta">
          <h3 className="tarjeta-titulo"><Icon name="documento" /> Remitos para revisar ({pendientes.length})</h3>
          <ul className="lista-simple">{pendientes.map((b) => <li key={b.id} className="item-simple"><span>{data.proveedores.find((p) => p.id === b.proveedorId)?.nombre ?? b.proveedorTexto ?? 'Proveedor sin identificar'}</span><span className="texto-suave">{formatFechaHora(b.creadaEn)}</span></li>)}</ul>
          <button type="button" className="btn btn-secundario btn-bloque boton-pedido" onClick={() => irA('recepcion')}>Revisar remitos</button>
        </section>
      )}

      <section className="tarjeta">
        <h3 className="tarjeta-titulo"><Icon name="contar" /> Conteo de stock</h3>
        {nunca.length + viejas.length === 0 ? (
          <p className="texto-suave">Todo se contó en la última semana.</p>
        ) : (
          <>
            <p className="texto-suave">
              {nunca.length > 0 && `${nunca.length} sin stock inicial. `}
              {viejas.length > 0 && `${viejas.length} sin contar hace más de ${DIAS_SIN_CONTEO} días.`}
            </p>
            <button type="button" className="btn btn-primario btn-bloque boton-pedido" onClick={() => irA('contar', { filtro: nunca.length > 0 ? 'nunca' : 'desactualizadas' })}><Icon name="contar" /> Empezar a contar</button>
          </>
        )}
      </section>

      <section className="tarjeta">
        <h3 className="tarjeta-titulo"><Icon name="hoja" /> Vencidos o que vencen hoy</h3>
        {vencidos.length === 0 ? <p className="texto-suave">No hay.</p> : (
          <>
            <p className="texto-suave">Separalos de la góndola y avisale al encargado (él registra la devolución o la baja).</p>
            <ul className="lista-simple">
              {vencidos.map((a, i) => (
                <li key={i} className="item-simple">
                  <span>{nombreItem(a.item.producto, a.item.presentacion)} · {formatoCantidad(a.lote.cantidad)} {abreviaturaUnidad(a.item.presentacion.unidadStock)}</span>
                  <span className="etiqueta etiqueta-rojo">{textoVence(a.dias)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
