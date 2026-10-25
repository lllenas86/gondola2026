import { useStore } from '../state/store';
import { addDays, formatFechaCorta } from '../lib/dates';
import {
  bajoPuntoDePedido, DIAS_SIN_CONTEO, diasDesdeConteo, formatoCantidad, formatoPesos, itemsActivos, nombreItem, stockDe, ultimoConteo, valorizar,
} from '../lib/inventario';
import { lotesConAlerta, resumenMermas, sumarValor } from '../lib/vencimientos';
import { proyectar } from '../lib/proyeccion';
import { irA } from '../lib/router';
import { Icon } from '../components/Icon';
import { EstadoConexion } from '../components/ui';

// Panel del dueño: estado general con datos reales. Lo que no se puede calcular, se dice.
export function PanelPage() {
  const { data, vistas, perfil } = useStore();
  const ahora = new Date();
  const items = itemsActivos(data);
  const filas = items.map((item) => {
    const stock = stockDe(data, vistas, item.presentacion.id);
    const p = proyectar(data, vistas, item.presentacion, ahora, { horizonte: 7 });
    return { item, stock, p, valor: stock !== null && stock > 0 ? valorizar(stock, item.presentacion.costoUnitario) : 0 };
  });
  const valorStock = sumarValor(filas.filter((f) => f.stock !== null && f.stock > 0).map((f) => f.valor));
  const contadas = items.filter((it) => {
    const d = diasDesdeConteo(ultimoConteo(data, it.presentacion.id), ahora);
    return d !== null && d <= DIAS_SIN_CONTEO;
  }).length;
  const bajos = filas.filter((f) => bajoPuntoDePedido(f.stock, f.item.presentacion));
  const quiebres = filas.filter((f) => f.p.fechaQuiebre !== null);
  const sinRitmo = filas.filter((f) => f.p.ritmo === null).length;
  const alertas = lotesConAlerta(data, ahora, 7);
  const vencido = alertas.filter((a) => a.estado === 'vencido');
  const porVencer = alertas.filter((a) => a.estado !== 'vencido');
  const mermas = resumenMermas(data, addDays(ahora, -30).toISOString());
  const rotacion = filas
    .filter((f) => f.p.ritmo && f.p.ritmo.porDia > 0)
    .map((f) => ({ ...f, cobertura: (f.p.stockHoy ?? 0) / (f.p.ritmo?.porDia ?? 1) }))
    .sort((a, b) => (b.p.ritmo?.porDia ?? 0) - (a.p.ritmo?.porDia ?? 0));
  const valorTxt = (v: { total: number; sinCosto: number }) => (v.total === 0 && v.sinCosto > 0 ? 'no calculable' : `${formatoPesos(v.total)}${v.sinCosto > 0 ? ` (+${v.sinCosto} sin costo)` : ''}`);

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Panel{perfil ? ` · ${perfil.almacen}` : ''}</p>
        <h1>Estado del almacén</h1>
      </header>

      <div className="kpis">
        <button type="button" className="kpi kpi-boton" onClick={() => irA('catalogo')}>
          <span className="kpi-titulo">Inventario</span>
          <strong>{items.length} presentaciones</strong>
          <span className="texto-suave">Valor registrado: {valorTxt(valorStock)}</span>
          <span className="texto-suave">{contadas} contadas en la última semana</span>
        </button>
        <button type="button" className={`kpi kpi-boton${bajos.length > 0 ? ' kpi-rojo' : ''}`} onClick={() => irA('pedidos')}>
          <span className="kpi-titulo">Riesgo de faltantes</span>
          <strong>{bajos.length} bajo punto de pedido</strong>
          <span className="texto-suave">{quiebres.length} podrían agotarse en 7 días</span>
        </button>
        <button type="button" className={`kpi kpi-boton${vencido.length > 0 ? ' kpi-rojo' : ''}`} onClick={() => irA('vencimientos')}>
          <span className="kpi-titulo">Vencimientos</span>
          <strong>{vencido.length} lotes vencidos en stock</strong>
          <span className="texto-suave">Vencido: {valorTxt(sumarValor(vencido.map((a) => a.valor)))}</span>
          <span className="texto-suave">Vence en 7 días: {valorTxt(sumarValor(porVencer.map((a) => a.valor)))}</span>
        </button>
        <button type="button" className="kpi kpi-boton" onClick={() => irA('vencimientos', { pestana: 'devoluciones' })}>
          <span className="kpi-titulo">Mermas (30 días)</span>
          <strong>{formatoCantidad(mermas.devueltas.cantidad + mermas.descartadas.cantidad)} u.</strong>
          <span className="texto-suave">Devuelto {valorTxt(mermas.devueltas.valor)} · recuperado {valorTxt(mermas.recuperado)}</span>
          <span className="texto-suave">Descartado {valorTxt(mermas.descartadas.valor)} · {mermas.abiertas} devoluciones abiertas</span>
        </button>
      </div>

      <section className="seccion">
        <h2 className="seccion-titulo">Consumo y rotación (estimado entre conteos)</h2>
        {rotacion.length === 0 ? (
          <p className="texto-suave nota-seccion">Todavía no hay al menos dos conteos de ninguna presentación: no se puede estimar el consumo.</p>
        ) : (
          <table className="tabla-diferencias">
            <thead><tr><th>Presentación</th><th>Consumo/día</th><th>Cobertura</th></tr></thead>
            <tbody>
              {rotacion.slice(0, 8).map((f) => (
                <tr key={f.item.presentacion.id}>
                  <td>{nombreItem(f.item.producto, f.item.presentacion)}</td>
                  <td>~{formatoCantidad(Math.round((f.p.ritmo?.porDia ?? 0) * 10) / 10)}</td>
                  <td className={f.cobertura < 3 ? 'dif-negativa' : ''}>{f.cobertura < 1 ? 'menos de 1 día' : `${Math.round(f.cobertura)} días`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="texto-suave nota-seccion">
          Sin sistema de ventas, el consumo se estima con la diferencia entre conteos (más lo recibido, menos lo devuelto o descartado).
          {sinRitmo > 0 ? ` ${sinRitmo} ${sinRitmo === 1 ? 'presentación no tiene' : 'presentaciones no tienen'} datos suficientes.` : ''}
        </p>
      </section>

      {quiebres.length > 0 && (
        <section className="seccion">
          <h2 className="seccion-titulo">Podrían agotarse en 7 días</h2>
          <ul className="lista-simple">
            {quiebres.map((f) => (
              <li key={f.item.presentacion.id} className="item-simple">
                <span>{nombreItem(f.item.producto, f.item.presentacion)}</span>
                <span className="etiqueta etiqueta-rojo">≈ {formatFechaCorta(f.p.fechaQuiebre as string)}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-secundario btn-bloque boton-pedido" onClick={() => irA('proyeccion')}><Icon name="reloj" /> Ver proyección</button>
        </section>
      )}
    </>
  );
}
