import { useState } from 'react';
import { useStore } from '../state/store';
import { cuandoEs, DIAS_LARGOS, formatFechaCorta, parseIsoDate, startOfDay, textoVisita } from '../lib/dates';
import { proximaVisita } from '../lib/stock';
import {
  abreviaturaUnidad, bajoPuntoDePedido, DIAS_SIN_CONTEO, diasDesdeConteo, formatoCantidad, itemsActivos, itemsDeProveedor,
  nombreItem, proveedoresDe, stockDe, textoVence, ultimoConteo, type Item,
} from '../lib/inventario';
import { lotesConAlerta } from '../lib/vencimientos';
import { proyectar } from '../lib/proyeccion';
import { sugerir, ventanaDePedido } from '../lib/pedido';
import { irA } from '../lib/router';
import { Icon } from '../components/Icon';
import { EstadoConexion, Vacio } from '../components/ui';
import { AsistentePedido } from '../features/AsistentePedido';
import type { Proveedor } from '../types';

// Inicio del encargado. De arriba hacia abajo:
//   1. Te falta pedir (stock registrado ≤ punto de pedido), agrupado por el proveedor que pasa antes
//   2. Pasan hoy y mañana → asistente de pedido
//   3. Vencimientos (resumen) → tablero de vencimientos
//   4. Podrían agotarse en 7 días (proyección) → simulador
//   5. Sin contar hace +7 días → conteo

interface Visita { proveedor: Proveedor; fecha: Date }
interface ItemFalta { item: Item; stock: number | null; otros: Visita[] }
interface GrupoFalta { visita: Visita | null; items: ItemFalta[] }

function armarFaltantes(items: { item: Item; stock: number | null }[], proveedores: (it: Item) => Proveedor[], hoy: Date): GrupoFalta[] {
  const grupos = new Map<string, GrupoFalta>();
  for (const { item, stock } of items) {
    const visitas: Visita[] = proveedores(item)
      .map((proveedor) => ({ proveedor, fecha: proximaVisita(proveedor, hoy) }))
      .filter((v): v is Visita => v.fecha !== null)
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.proveedor.nombre.localeCompare(b.proveedor.nombre, 'es'));
    const [primera, ...otros] = visitas;
    const clave = primera ? primera.proveedor.id : '__sin__';
    const grupo = grupos.get(clave) ?? { visita: primera ?? null, items: [] };
    grupo.items.push({ item, stock, otros });
    grupos.set(clave, grupo);
  }
  return [...grupos.values()].sort((a, b) => {
    if (!a.visita) return 1;
    if (!b.visita) return -1;
    return a.visita.fecha.getTime() - b.visita.fecha.getTime() || a.visita.proveedor.nombre.localeCompare(b.visita.proveedor.nombre, 'es');
  });
}

export function HoyPage() {
  const { data, vistas } = useStore();
  const [pedidoDe, setPedidoDe] = useState<Proveedor | null>(null);
  const ahora = new Date();
  const hoy = startOfDay(ahora);

  const todos = itemsActivos(data);
  const conStock = todos.map((item) => ({ item, stock: stockDe(data, vistas, item.presentacion.id) }));
  const faltantes = armarFaltantes(
    conStock.filter((x) => bajoPuntoDePedido(x.stock, x.item.presentacion)),
    (it) => proveedoresDe(data, it.presentacion.id),
    hoy,
  );
  const cantidadFalta = faltantes.reduce((a, g) => a + g.items.length, 0);

  const pasan = vistas.visitas
    .filter((v) => v.diasHasta <= 1)
    .map((v) => ({ fila: v, proveedor: data.proveedores.find((p) => p.id === v.proveedorId) }))
    .filter((x): x is { fila: typeof x.fila; proveedor: Proveedor } => !!x.proveedor);

  const sinContar = todos.filter((it) => {
    const d = diasDesdeConteo(ultimoConteo(data, it.presentacion.id), ahora);
    return d === null || d > DIAS_SIN_CONTEO;
  });

  const alertas = lotesConAlerta(data, ahora, 7);
  const vencidos = alertas.filter((a) => a.estado === 'vencido');
  const porVencer = alertas.filter((a) => a.estado !== 'vencido');

  // Proyección a 7 días: solo presentaciones con ritmo de consumo estimado
  const quiebres = todos
    .map((item) => ({ item, p: proyectar(data, vistas, item.presentacion, ahora, { horizonte: 7 }) }))
    .filter((x) => x.p.fechaQuiebre !== null)
    .sort((a, b) => (a.p.fechaQuiebre as string).localeCompare(b.p.fechaQuiebre as string));

  const nombreDia = DIAS_LARGOS[hoy.getDay()];

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Góndola</p>
        <h1>{nombreDia.charAt(0).toUpperCase() + nombreDia.slice(1)} {formatFechaCorta(ahora.toISOString())}</h1>
        <div className="resumen">
          <span className={cantidadFalta > 0 ? 'resumen-item rojo' : 'resumen-item'}><strong>{cantidadFalta}</strong> para pedir</span>
          {vencidos.length > 0 && <span className="resumen-item rojo"><strong>{vencidos.length}</strong> {vencidos.length === 1 ? 'lote vencido' : 'lotes vencidos'}</span>}
          <span className={sinContar.length > 0 ? 'resumen-item ambar' : 'resumen-item'}><strong>{sinContar.length}</strong> sin contar hace +{DIAS_SIN_CONTEO} días</span>
        </div>
      </header>

      <section className="seccion" aria-labelledby="titulo-falta">
        <h2 className="seccion-titulo" id="titulo-falta">Te falta pedir</h2>
        {faltantes.length === 0 ? <TodoEnOrden /> : faltantes.map((g) => (
          <TarjetaFalta key={g.visita?.proveedor.id ?? 'sin'} grupo={g} ahora={ahora} onPedido={setPedidoDe} />
        ))}
      </section>

      <section className="seccion" aria-labelledby="titulo-pasan">
        <h2 className="seccion-titulo" id="titulo-pasan">Pasan hoy y mañana</h2>
        {pasan.length === 0 ? (
          <Vacio titulo="No pasa ningún proveedor hoy ni mañana."><ProximaVisita /></Vacio>
        ) : pasan.map(({ fila, proveedor }) => {
          const items = itemsDeProveedor(data, proveedor.id);
          const ventana = ventanaDePedido(proveedor, hoy);
          const sugeridos = ventana ? items.map((it) => sugerir(data, vistas, it, ventana, ahora)).filter((s) => s.cantidad > 0) : [];
          const altas = sugeridos.filter((s) => s.prioridad === 'alta').length;
          return (
            <article key={proveedor.id} className="tarjeta">
              <div className="tarjeta-cabecera">
                <div>
                  <h3>{proveedor.nombre}</h3>
                  <p className="texto-suave">{fila.diasHasta === 0 ? 'Pasa hoy' : 'Pasa mañana'} · {items.length} {items.length === 1 ? 'presentación' : 'presentaciones'}</p>
                </div>
                <Icon name="camion" className="icono-suave" />
              </div>
              <p className="texto-suave tarjeta-nota">
                {sugeridos.length === 0 ? 'Con los datos actuales no hace falta pedirle nada.' : `Sugerido pedir ${sugeridos.length} ${sugeridos.length === 1 ? 'presentación' : 'presentaciones'}${altas > 0 ? ` (${altas} con prioridad alta)` : ''}.`}
              </p>
              {items.length > 0 ? (
                <button type="button" className="btn btn-primario btn-bloque" onClick={() => setPedidoDe(proveedor)}>
                  <Icon name="carrito" /> Preparar pedido
                </button>
              ) : <p className="texto-suave">Este proveedor no tiene presentaciones asociadas. Asocialas en Catálogo.</p>}
            </article>
          );
        })}
      </section>

      <section className="seccion" aria-labelledby="titulo-vencer">
        <h2 className="seccion-titulo" id="titulo-vencer">Vencimientos</h2>
        {alertas.length === 0 ? (
          <p className="texto-suave nota-seccion">No hay lotes vencidos ni que venzan en los próximos 7 días.</p>
        ) : (
          <button type="button" className="tarjeta tarjeta-enlace" onClick={() => irA('vencimientos')}>
            <ul className="lista-simple">
              {alertas.slice(0, 4).map((a, i) => (
                <li key={i} className="item-simple">
                  <span>{nombreItem(a.item.producto, a.item.presentacion)} · {formatoCantidad(a.lote.cantidad)} {abreviaturaUnidad(a.item.presentacion.unidadStock)}</span>
                  <span className={`etiqueta ${a.estado === 'vencido' ? 'etiqueta-rojo' : a.estado === 'vence_pronto' ? 'etiqueta-violeta' : 'etiqueta-gris'}`}><Icon name="hoja" size={13} /> {textoVence(a.dias)}</span>
                </li>
              ))}
            </ul>
            <span className="enlace-tarjeta">{vencidos.length > 0 ? `${vencidos.length} vencidos y ${porVencer.length} por vencer` : `${porVencer.length} por vencer`} · Ver vencimientos y devolver <Icon name="derecha" size={16} /></span>
          </button>
        )}
      </section>

      <section className="seccion" aria-labelledby="titulo-quiebre">
        <h2 className="seccion-titulo" id="titulo-quiebre">Podrían agotarse en 7 días</h2>
        {quiebres.length === 0 ? (
          <p className="texto-suave nota-seccion">Con el consumo estimado, nada se agota en la próxima semana.</p>
        ) : (
          <button type="button" className="tarjeta tarjeta-enlace" onClick={() => irA('proyeccion')}>
            <ul className="lista-simple">
              {quiebres.slice(0, 4).map(({ item, p }) => (
                <li key={item.presentacion.id} className="item-simple">
                  <span>{nombreItem(item.producto, item.presentacion)}</span>
                  <span className="etiqueta etiqueta-rojo">≈ {formatFechaCorta(p.fechaQuiebre as string)}</span>
                </li>
              ))}
            </ul>
            <span className="enlace-tarjeta">Estimación con el consumo entre conteos · Ver proyección <Icon name="derecha" size={16} /></span>
          </button>
        )}
      </section>

      <section className="seccion" aria-labelledby="titulo-sin-contar">
        <h2 className="seccion-titulo" id="titulo-sin-contar">Sin contar hace +{DIAS_SIN_CONTEO} días</h2>
        {sinContar.length === 0 ? (
          <p className="texto-suave nota-seccion">Todas las presentaciones se contaron en la última semana.</p>
        ) : (
          <div className="tarjeta">
            <p className="texto-suave">{sinContar.slice(0, 6).map((it) => nombreItem(it.producto, it.presentacion)).join(', ')}{sinContar.length > 6 ? ` y ${sinContar.length - 6} más` : ''}.</p>
            <button type="button" className="btn btn-secundario btn-bloque boton-pedido" onClick={() => irA('contar', { filtro: 'desactualizadas' })}>
              <Icon name="contar" /> Hacer conteo de stock
            </button>
          </div>
        )}
      </section>

      {pedidoDe && <AsistentePedido key={pedidoDe.id} proveedor={pedidoDe} onCerrar={() => setPedidoDe(null)} />}
    </>
  );
}

/** Nunca pantalla vacía: si no falta nada, se dice y se muestra la próxima visita. */
function TodoEnOrden() {
  return (
    <div className="tarjeta tarjeta-ok">
      <p className="todo-ok"><strong>Todo en orden ✓</strong></p>
      <ProximaVisita />
    </div>
  );
}

export function ProximaVisita() {
  const { vistas } = useStore();
  if (vistas.visitas.length === 0) return <p className="texto-suave">No hay proveedores con días de visita cargados.</p>;
  const min = Math.min(...vistas.visitas.map((v) => v.diasHasta));
  const proximas = vistas.visitas.filter((v) => v.diasHasta === min);
  return <p className="texto-suave">Próxima visita: {proximas.map((v) => v.nombre).join(', ')}, {cuandoEs(parseIsoDate(proximas[0].proximaVisita))}</p>;
}

function TarjetaFalta({ grupo, ahora, onPedido }: { grupo: GrupoFalta; ahora: Date; onPedido: (p: Proveedor) => void }) {
  const { data, vistas } = useStore();
  const { visita } = grupo;
  const ventana = visita ? ventanaDePedido(visita.proveedor, startOfDay(ahora)) : null;
  return (
    <article className="tarjeta tarjeta-falta">
      <div className="tarjeta-cabecera">
        <div>
          <h3>{visita ? `Lo trae ${visita.proveedor.nombre}` : 'Sin proveedor asignado'}</h3>
          <p className={visita && cuandoEs(visita.fecha, ahora) === 'hoy' ? 'texto-visita hoy' : 'texto-visita'}>
            {visita ? textoVisita(visita.fecha, ahora) : 'Asignale un proveedor en Catálogo para saber cuándo pedirlo.'}
          </p>
        </div>
        <Icon name="camion" className="icono-suave" />
      </div>
      <ul className="lista-stock">
        {grupo.items.map(({ item, stock, otros }) => {
          const sug = ventana ? sugerir(data, vistas, item, ventana, ahora) : null;
          return (
            <li key={item.presentacion.id} className="fila-stock bajo">
              <div className="fila-stock-info">
                <p className="fila-stock-nombre">{nombreItem(item.producto, item.presentacion)}</p>
                <p className="texto-suave">Stock {stock === null ? '—' : formatoCantidad(stock)} / punto de pedido {formatoCantidad(item.presentacion.puntoDePedido)}</p>
                {sug && sug.cantidad > 0 && <p className="sugerido"><Icon name="carrito" size={15} /> Sugerido: pedir <strong>{sug.cantidad}</strong></p>}
                {otros.length > 0 && <p className="texto-suave">También lo trae {otros.map((o) => `${o.proveedor.nombre} (${textoVisita(o.fecha, ahora)})`).join(', ')}</p>}
              </div>
              <div className="fila-stock-numero" aria-label={`Stock ${stock ?? 'sin datos'} de ${item.presentacion.puntoDePedido}`}>
                <strong>{stock === null ? '—' : formatoCantidad(stock)}</strong>
                <span>/ {formatoCantidad(item.presentacion.puntoDePedido)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {visita ? (
        <button type="button" className="btn btn-primario btn-bloque" onClick={() => onPedido(visita.proveedor)}>
          <Icon name="carrito" /> Preparar pedido
        </button>
      ) : (
        <button type="button" className="btn btn-secundario btn-bloque" onClick={() => irA('catalogo')}>Asignar proveedor en Catálogo</button>
      )}
    </article>
  );
}
