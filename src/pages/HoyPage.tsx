import { useState } from 'react';
import { useStore } from '../state/store';
import { cuandoEs, DIAS_LARGOS, formatFechaCorta, haceCuanto, parseIsoDate, startOfDay, textoVisita } from '../lib/dates';
import { calcularStock, diasParaVencer, productosDeProveedor, proveedoresDeProducto, proximaVisita, DIAS_SIN_CONTEO } from '../lib/stock';
import { irA } from '../lib/router';
import { Icon } from '../components/Icon';
import { EstadoConexion, Vacio } from '../components/ui';
import { PedidoHoja } from '../features/PedidoHoja';
import { sugerenciaProducto, ventanaDePedido } from '../lib/pedido';
import type { AppData, FilaStock, Producto, Proveedor } from '../types';

// Pantalla de inicio. De arriba hacia abajo:
//   1. Te falta pedir            ← SIEMPRE visible, cualquier día (v_stock_actual.bajo_punto_pedido)
//   2. Pasan hoy y mañana        ← v_visitas_proximas
//   3. Por vencer                ← v_vencimientos (7 días)
//   4. Sin contar hace +7 días   ← v_stock_actual.conteo_desactualizado

const TODOS = '__todos__';

interface Visita {
  proveedor: Proveedor;
  fecha: Date;
}

interface ItemFalta {
  producto: Producto;
  fila: FilaStock;
  /** Otros proveedores que también lo traen, con su próxima visita */
  otros: Visita[];
}

interface GrupoFalta {
  /** null = el producto no tiene proveedor asignado */
  visita: Visita | null;
  items: ItemFalta[];
}

/** Agrupa lo que falta pedir por el proveedor que pasa antes (hoy cuenta). */
function armarFaltantes(data: AppData, filas: FilaStock[], hoy: Date): GrupoFalta[] {
  const grupos = new Map<string, GrupoFalta>();
  for (const fila of filas) {
    if (!fila.bajoPuntoPedido) continue;
    const producto = data.productos.find((p) => p.id === fila.productoId);
    if (!producto) continue;
    const visitas: Visita[] = proveedoresDeProducto(data, producto.id)
      .map((proveedor) => ({ proveedor, fecha: proximaVisita(proveedor, hoy) }))
      .filter((v): v is Visita => v.fecha !== null)
      .sort((a, b) => a.fecha.getTime() - b.fecha.getTime() || a.proveedor.nombre.localeCompare(b.proveedor.nombre, 'es'));
    const [primera, ...otros] = visitas;
    const clave = primera ? primera.proveedor.id : '__sin__';
    const grupo = grupos.get(clave) ?? { visita: primera ?? null, items: [] };
    grupo.items.push({ producto, fila, otros });
    grupos.set(clave, grupo);
  }
  return [...grupos.values()]
    .map((g) => ({ ...g, items: g.items.sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es')) }))
    .sort((a, b) => {
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

  const faltantes = armarFaltantes(data, vistas.stock, hoy);
  const cantidadFalta = faltantes.reduce((a, g) => a + g.items.length, 0);

  const pasan = vistas.visitas
    .filter((v) => v.diasHasta <= 1)
    .map((v) => ({ fila: v, proveedor: data.proveedores.find((p) => p.id === v.proveedorId) }))
    .filter((x): x is { fila: typeof x.fila; proveedor: Proveedor } => !!x.proveedor);

  const sinContar = vistas.stock
    .filter((s) => s.conteoDesactualizado)
    .sort((a, b) => (b.diasDesdeConteo ?? Infinity) - (a.diasDesdeConteo ?? Infinity) || a.nombre.localeCompare(b.nombre, 'es'));

  const nombreDia = DIAS_LARGOS[hoy.getDay()];

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Góndola</p>
        <h1>
          {nombreDia.charAt(0).toUpperCase() + nombreDia.slice(1)} {formatFechaCorta(ahora.toISOString())}
        </h1>
        <div className="resumen">
          <span className={cantidadFalta > 0 ? 'resumen-item rojo' : 'resumen-item'}>
            <strong>{cantidadFalta}</strong> para pedir
          </span>
          <span className={sinContar.length > 0 ? 'resumen-item ambar' : 'resumen-item'}>
            <strong>{sinContar.length}</strong> sin contar hace más de {DIAS_SIN_CONTEO} días
          </span>
        </div>
      </header>

      {/* 1. Te falta pedir: siempre visible */}
      <section className="seccion" aria-labelledby="titulo-falta">
        <h2 className="seccion-titulo" id="titulo-falta">Te falta pedir</h2>
        {faltantes.length === 0 ? (
          <TodoEnOrden />
        ) : (
          faltantes.map((g) => <TarjetaFalta key={g.visita?.proveedor.id ?? 'sin'} grupo={g} ahora={ahora} onPedido={setPedidoDe} />)
        )}
      </section>

      {/* 2. Pasan hoy y mañana */}
      <section className="seccion" aria-labelledby="titulo-pasan">
        <h2 className="seccion-titulo" id="titulo-pasan">Pasan hoy y mañana</h2>
        {pasan.length === 0 ? (
          <Vacio titulo="No pasa ningún proveedor hoy ni mañana.">
            <ProximaVisita />
          </Vacio>
        ) : (
          pasan.map(({ fila, proveedor }) => (
            <TarjetaProveedor key={proveedor.id} proveedor={proveedor} cuando={fila.diasHasta === 0 ? 'Pasa hoy' : 'Pasa mañana'} data={data} ahora={ahora} onPedido={setPedidoDe} />
          ))
        )}
      </section>

      {/* 3. Por vencer (7 días) */}
      <section className="seccion" aria-labelledby="titulo-vencer">
        <h2 className="seccion-titulo" id="titulo-vencer">Por vencer</h2>
        {vistas.vencimientos.length === 0 ? (
          <p className="texto-suave nota-seccion">Nada vence en los próximos 7 días.</p>
        ) : (
          <ul className="lista-simple">
            {vistas.vencimientos.map((v) => (
              <li key={`${v.productoId}-${v.fechaVencimiento}`} className="item-simple">
                <div>
                  <p className="item-titulo">{v.nombre}</p>
                  <p className="texto-suave">{v.cantidad} u. · vence el {formatFechaCorta(v.fechaVencimiento)}</p>
                </div>
                <span className={`etiqueta ${v.diasParaVencer <= 3 ? 'etiqueta-violeta' : 'etiqueta-gris'}`}>
                  <Icon name="hoja" size={13} /> {v.diasParaVencer === 0 ? 'Vence hoy' : v.diasParaVencer === 1 ? 'Vence mañana' : `En ${v.diasParaVencer} días`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Sin contar hace +7 días */}
      <section className="seccion" aria-labelledby="titulo-sin-contar">
        <h2 className="seccion-titulo" id="titulo-sin-contar">Sin contar hace +{DIAS_SIN_CONTEO} días</h2>
        {sinContar.length === 0 ? (
          <p className="texto-suave nota-seccion">Todos los productos se contaron en la última semana.</p>
        ) : (
          <ul className="lista-simple">
            {sinContar.map((s) => {
              const prov = proveedoresDeProducto(data, s.productoId)[0];
              return (
                <li key={s.productoId} className="item-simple">
                  <div>
                    <p className="item-titulo">{s.nombre}</p>
                    <p className="texto-suave">
                      {s.fechaUltimoConteo ? `Contado ${haceCuanto(s.fechaUltimoConteo, ahora)} (${formatFechaCorta(s.fechaUltimoConteo)})` : 'Nunca se contó'}
                    </p>
                  </div>
                  <button type="button" className="btn btn-secundario btn-chico" onClick={() => irA('contar', { proveedor: prov?.id ?? TODOS })}>
                    Contar
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {pedidoDe && <PedidoHoja key={pedidoDe.id} proveedor={pedidoDe} onCerrar={() => setPedidoDe(null)} />}
    </>
  );
}

/** Nunca pantalla vacía: si no falta nada, se dice y se muestra la próxima visita. */
function TodoEnOrden() {
  return (
    <div className="tarjeta tarjeta-ok">
      <p className="todo-ok">
        <strong>Todo en orden ✓</strong>
      </p>
      <ProximaVisita />
    </div>
  );
}

function ProximaVisita() {
  const { vistas } = useStore();
  if (vistas.visitas.length === 0) return <p className="texto-suave">No hay proveedores con días de visita cargados.</p>;
  const min = Math.min(...vistas.visitas.map((v) => v.diasHasta));
  const proximas = vistas.visitas.filter((v) => v.diasHasta === min);
  const fecha = parseIsoDate(proximas[0].proximaVisita);
  return (
    <p className="texto-suave">
      Próxima visita: {proximas.map((v) => v.nombre).join(', ')}, {cuandoEs(fecha)}
    </p>
  );
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
        {grupo.items.map(({ producto, fila, otros }) => (
          <li key={producto.id} className="fila-stock bajo">
            <div className="fila-stock-info">
              <p className="fila-stock-nombre">{producto.nombre}</p>
              <p className="texto-suave">
                Stock {fila.stockActual ?? '—'} / punto de pedido {fila.puntoPedido}
              </p>
              {ventana && <CantidadSugerida cantidad={sugerenciaProducto(data, vistas, producto, ventana).cantidad} />}
              {otros.length > 0 && (
                <p className="texto-suave">
                  También lo trae {otros.map((o) => `${o.proveedor.nombre} (${textoVisita(o.fecha, ahora)})`).join(', ')}
                </p>
              )}
            </div>
            <div className="fila-stock-numero" aria-label={`Stock ${fila.stockActual ?? 'sin datos'} de ${fila.puntoPedido}`}>
              <strong>{fila.stockActual ?? '—'}</strong>
              <span>/ {fila.puntoPedido}</span>
            </div>
          </li>
        ))}
      </ul>
      {visita ? (
        <div className="acciones-2">
          <button type="button" className="btn btn-secundario" onClick={() => irA('contar', { proveedor: visita.proveedor.id })}>
            <Icon name="contar" /> Contar
          </button>
          <button type="button" className="btn btn-primario" onClick={() => onPedido(visita.proveedor)}>
            <Icon name="carrito" /> Pedido
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-secundario btn-bloque" onClick={() => irA('catalogo')}>
          Asignar proveedor en Catálogo
        </button>
      )}
    </article>
  );
}

function TarjetaProveedor({ proveedor, cuando, data, ahora, onPedido }: { proveedor: Proveedor; cuando: string; data: AppData; ahora: Date; onPedido: (p: Proveedor) => void }) {
  const productos = productosDeProveedor(data, proveedor.id);
  const ventana = ventanaDePedido(proveedor, startOfDay(ahora));
  return (
    <article className="tarjeta">
      <div className="tarjeta-cabecera">
        <div>
          <h3>{proveedor.nombre}</h3>
          <p className="texto-suave">
            {cuando} · {productos.length} {productos.length === 1 ? 'producto' : 'productos'}
          </p>
        </div>
        <Icon name="camion" className="icono-suave" />
      </div>
      {productos.length === 0 ? (
        <p className="texto-suave tarjeta-nota">Este proveedor no tiene productos asociados. Asocialos en Catálogo.</p>
      ) : (
        <ul className="lista-stock">
          {productos.map((prod) => (
            <FilaStockProducto key={prod.id} producto={prod} data={data} ahora={ahora} ventana={ventana} />
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-primario btn-bloque" onClick={() => irA('contar', { proveedor: proveedor.id })}>
        <Icon name="contar" /> Contar productos de este proveedor
      </button>
      {productos.length > 0 && (
        <button type="button" className="btn btn-secundario btn-bloque boton-pedido" onClick={() => onPedido(proveedor)}>
          <Icon name="carrito" /> Armar pedido y enviarlo
        </button>
      )}
    </article>
  );
}

/** "Pedir 12" debajo del stock. No se muestra si no hace falta pedir. */
function CantidadSugerida({ cantidad }: { cantidad: number }) {
  if (cantidad <= 0) return null;
  return <p className="sugerido"><Icon name="carrito" size={15} /> Sugerido: pedir <strong>{cantidad}</strong></p>;
}

function FilaStockProducto({ producto, data, ahora, ventana }: { producto: Producto; data: AppData; ahora: Date; ventana: ReturnType<typeof ventanaDePedido> }) {
  const { vistas } = useStore();
  const sugerido = ventana ? sugerenciaProducto(data, vistas, producto, ventana).cantidad : 0;
  const s = calcularStock(data, producto, ahora);
  const fila = vistas.stock.find((f) => f.productoId === producto.id);
  // El stock y las marcas salen de la vista v_stock_actual; el detalle del último conteo, del historial.
  const stock = fila ? fila.stockActual : s.stock;
  const bajo = fila ? fila.bajoPuntoPedido : s.bajoPuntoDePedido;
  const desactualizado = fila ? fila.conteoDesactualizado : s.sinConteoReciente;
  const dias = fila ? fila.diasDesdeConteo : s.diasDesdeConteo;
  const vence = s.proximoVencimiento ? diasParaVencer(s.proximoVencimiento, ahora) : null;
  return (
    <li className={`fila-stock${bajo ? ' bajo' : ''}`}>
      <div className="fila-stock-info">
        <p className="fila-stock-nombre">{producto.nombre}</p>
        <p className="texto-suave">
          {s.ultimoConteo
            ? `Contado ${haceCuanto(s.ultimoConteo.fechaHora, ahora)} (${formatFechaCorta(s.ultimoConteo.fechaHora)})`
            : 'Nunca se contó'}
          {s.recibidoDespues > 0 && ` · +${s.recibidoDespues} recibidos`}
        </p>
        <CantidadSugerida cantidad={sugerido} />
        <div className="etiquetas">
          {bajo && <span className="etiqueta etiqueta-rojo">Pedir · punto {producto.puntoDePedido}</span>}
          {desactualizado && (
            <span className="etiqueta etiqueta-ambar">
              <Icon name="reloj" size={13} /> {dias === null ? 'Sin conteo' : `Sin contar hace ${dias} días`}
            </span>
          )}
          {vence !== null && vence <= 7 && (
            <span className={`etiqueta ${vence <= 3 ? 'etiqueta-violeta' : 'etiqueta-gris'}`}>
              <Icon name="hoja" size={13} /> {vence === 0 ? 'Vence hoy' : vence === 1 ? 'Vence mañana' : `Vence en ${vence} días`}
            </span>
          )}
        </div>
      </div>
      <div className="fila-stock-numero" aria-label={`Stock ${stock ?? 'sin datos'}`}>
        <strong>{stock ?? '—'}</strong>
        <span>{stock === null ? '' : producto.unidad === 'unidad' ? 'u.' : producto.unidad}</span>
      </div>
    </li>
  );
}
