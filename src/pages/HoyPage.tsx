import { useMemo } from 'react';
import { useStore } from '../state/store';
import { addDays, DIAS_LARGOS, formatFechaCorta, haceCuanto, startOfDay } from '../lib/dates';
import { calcularStock, diasParaVencer, productosDeProveedor, proximaVisita, visitaEl, DIAS_SIN_CONTEO } from '../lib/stock';
import { irA } from '../lib/router';
import { Icon } from '../components/Icon';
import { Vacio } from '../components/ui';
import type { AppData, Producto, Proveedor } from '../types';

export function HoyPage() {
  const { data } = useStore();
  const ahora = new Date();
  const hoy = startOfDay(ahora);
  const manana = addDays(hoy, 1);

  const deHoy = data.proveedores.filter((p) => visitaEl(p, hoy));
  const deManana = data.proveedores.filter((p) => visitaEl(p, manana) && !deHoy.includes(p));

  const resumen = useMemo(() => {
    const ids = new Set<string>();
    for (const p of [...deHoy, ...deManana]) productosDeProveedor(data, p.id).forEach((x) => ids.add(x.id));
    let pedir = 0;
    let sinContar = 0;
    for (const id of ids) {
      const prod = data.productos.find((p) => p.id === id);
      if (!prod) continue;
      const s = calcularStock(data, prod, ahora);
      if (s.bajoPuntoDePedido) pedir++;
      if (s.sinConteoReciente) sinContar++;
    }
    return { pedir, sinContar };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const nombreDia = DIAS_LARGOS[hoy.getDay()];

  return (
    <>
      <header className="cabecera">
        <p className="cabecera-marca">Góndola</p>
        <h1>
          {nombreDia.charAt(0).toUpperCase() + nombreDia.slice(1)} {formatFechaCorta(ahora.toISOString())}
        </h1>
        {(deHoy.length > 0 || deManana.length > 0) && (
          <div className="resumen">
            <span className={resumen.pedir > 0 ? 'resumen-item rojo' : 'resumen-item'}>
              <strong>{resumen.pedir}</strong> para pedir
            </span>
            <span className={resumen.sinContar > 0 ? 'resumen-item ambar' : 'resumen-item'}>
              <strong>{resumen.sinContar}</strong> sin contar hace más de {DIAS_SIN_CONTEO} días
            </span>
          </div>
        )}
      </header>

      <Bloque titulo="Pasan hoy" proveedores={deHoy} data={data} ahora={ahora} dia={hoy} />
      <Bloque titulo="Pasan mañana" proveedores={deManana} data={data} ahora={ahora} dia={manana} />
    </>
  );
}

function Bloque({ titulo, proveedores, data, ahora, dia }: { titulo: string; proveedores: Proveedor[]; data: AppData; ahora: Date; dia: Date }) {
  return (
    <section className="seccion">
      <h2 className="seccion-titulo">{titulo}</h2>
      {proveedores.length === 0 ? (
        <Vacio titulo={`No pasa ningún proveedor ${titulo.endsWith('hoy') ? 'hoy' : 'mañana'}.`}>
          <ProximaVisita data={data} desde={addDays(dia, 1)} />
        </Vacio>
      ) : (
        proveedores.map((p) => <TarjetaProveedor key={p.id} proveedor={p} data={data} ahora={ahora} />)
      )}
    </section>
  );
}

function ProximaVisita({ data, desde }: { data: AppData; desde: Date }) {
  let mejor: { fecha: Date; nombres: string[] } | null = null;
  for (const p of data.proveedores) {
    const f = proximaVisita(p, desde);
    if (!f) continue;
    if (!mejor || f < mejor.fecha) mejor = { fecha: f, nombres: [p.nombre] };
    else if (f.getTime() === mejor.fecha.getTime()) mejor.nombres.push(p.nombre);
  }
  if (!mejor) return null;
  return (
    <p className="texto-suave">
      Próxima visita: {DIAS_LARGOS[mejor.fecha.getDay()]} — {mejor.nombres.join(', ')}.
    </p>
  );
}

function TarjetaProveedor({ proveedor, data, ahora }: { proveedor: Proveedor; data: AppData; ahora: Date }) {
  const productos = productosDeProveedor(data, proveedor.id);
  return (
    <article className="tarjeta">
      <div className="tarjeta-cabecera">
        <div>
          <h3>{proveedor.nombre}</h3>
          <p className="texto-suave">{productos.length} {productos.length === 1 ? 'producto' : 'productos'}</p>
        </div>
        <Icon name="camion" className="icono-suave" />
      </div>
      {productos.length === 0 ? (
        <p className="texto-suave tarjeta-nota">Este proveedor no tiene productos asociados. Asocialos en Catálogo.</p>
      ) : (
        <ul className="lista-stock">
          {productos.map((prod) => (
            <FilaStock key={prod.id} producto={prod} data={data} ahora={ahora} />
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-primario btn-bloque" onClick={() => irA('contar', { proveedor: proveedor.id })}>
        <Icon name="contar" /> Contar productos de este proveedor
      </button>
    </article>
  );
}

function FilaStock({ producto, data, ahora }: { producto: Producto; data: AppData; ahora: Date }) {
  const s = calcularStock(data, producto, ahora);
  const vence = s.proximoVencimiento ? diasParaVencer(s.proximoVencimiento, ahora) : null;
  return (
    <li className={`fila-stock${s.bajoPuntoDePedido ? ' bajo' : ''}`}>
      <div className="fila-stock-info">
        <p className="fila-stock-nombre">{producto.nombre}</p>
        <p className="texto-suave">
          {s.ultimoConteo
            ? `Contado ${haceCuanto(s.ultimoConteo.fechaHora, ahora)} (${formatFechaCorta(s.ultimoConteo.fechaHora)})`
            : 'Nunca se contó'}
          {s.recibidoDespues > 0 && ` · +${s.recibidoDespues} recibidos`}
        </p>
        <div className="etiquetas">
          {s.bajoPuntoDePedido && <span className="etiqueta etiqueta-rojo">Pedir · punto {producto.puntoDePedido}</span>}
          {s.sinConteoReciente && (
            <span className="etiqueta etiqueta-ambar">
              <Icon name="reloj" size={13} /> {s.diasDesdeConteo === null ? 'Sin conteo' : `Sin contar hace ${s.diasDesdeConteo} días`}
            </span>
          )}
          {vence !== null && (
            <span className={`etiqueta ${vence <= 3 ? 'etiqueta-violeta' : 'etiqueta-gris'}`}>
              <Icon name="hoja" size={13} /> {vence === 0 ? 'Vence hoy' : vence === 1 ? 'Vence mañana' : `Vence en ${vence} días`}
            </span>
          )}
        </div>
      </div>
      <div className="fila-stock-numero" aria-label={`Stock ${s.stock ?? 'sin datos'}`}>
        <strong>{s.stock ?? '—'}</strong>
        <span>{s.stock === null ? '' : producto.unidad === 'unidad' ? 'u.' : producto.unidad}</span>
      </div>
    </li>
  );
}
