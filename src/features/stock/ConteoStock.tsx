import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { fichasConPresentaciones, productosDeProveedor, ultimoConteoDe, DIAS_SIN_CONTEO } from '../../lib/stock';
import { haceCuanto } from '../../lib/dates';
import { leerNumero, validarCantidadConteo } from '../../lib/validation';
import { registrarConteoStock, type LineaConteoStock } from '../../lib/datos';
import { Icon } from '../../components/Icon';
import { Vacio } from '../../components/ui';
import type { Producto } from '../../types';

interface Lote {
  cantidad: string;
  vencimiento: string;
}

type Filtro = 'todos' | 'sin_contar' | string; // string = id de proveedor (filtro opcional)

interface Armado {
  lineas: LineaConteoStock[];
  resumen: { producto: Producto; contado: number; sistema: number | null }[];
}

const fmt = (n: number) => String(Math.round(n * 1000) / 1000).replace('.', ',');

/**
 * Conteo de stock: inventario inicial o conteo periódico de TODAS las presentaciones,
 * sin elegir proveedor. Antes de guardar muestra la diferencia con lo registrado.
 */
export function ConteoStock({ proveedorInicial, onGuardado }: { proveedorInicial: string | null; onGuardado: () => void }) {
  const { data, vistas, ejecutar, avisar } = useStore();
  const nuncaSeConto = data.conteos.length === 0;
  const [tipo, setTipo] = useState<'inicial' | 'periodico'>(nuncaSeConto ? 'inicial' : 'periodico');
  const [filtro, setFiltro] = useState<Filtro>(
    proveedorInicial && data.proveedores.some((p) => p.id === proveedorInicial) ? proveedorInicial : 'todos',
  );
  const [busqueda, setBusqueda] = useState('');
  const [lotes, setLotes] = useState<Record<string, Lote[]>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [notas, setNotas] = useState('');
  /** Resultado validado del paso 1; mientras no es null se muestra la revisión. */
  const [armado, setArmado] = useState<Armado | null>(null);
  const [guardando, setGuardando] = useState(false);

  const stockDe = useMemo(() => new Map(vistas.stock.map((s) => [s.productoId, s])), [vistas.stock]);

  const grupos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const delProveedor = filtro !== 'todos' && filtro !== 'sin_contar' ? new Set(productosDeProveedor(data, filtro).map((p) => p.id)) : null;
    return fichasConPresentaciones(data)
      .map((g) => ({
        ...g,
        presentaciones: g.presentaciones.filter((p) => {
          if (q && !p.nombre.toLowerCase().includes(q)) return false;
          if (delProveedor && !delProveedor.has(p.id)) return false;
          if (filtro === 'sin_contar' && !(stockDe.get(p.id)?.conteoDesactualizado ?? true)) return false;
          return true;
        }),
      }))
      .filter((g) => g.presentaciones.length > 0);
  }, [data, busqueda, filtro, stockDe]);

  const lotesDe = (id: string): Lote[] => lotes[id] ?? [{ cantidad: '', vencimiento: '' }];
  const setLote = (id: string, i: number, cambio: Partial<Lote>) => {
    setLotes((l) => {
      const arr = [...(l[id] ?? [{ cantidad: '', vencimiento: '' }])];
      arr[i] = { ...arr[i], ...cambio };
      return { ...l, [id]: arr };
    });
    setErrores((e) => {
      const { [id]: _x, ...resto } = e;
      return resto;
    });
    setErrorGeneral(null);
  };
  const sumar = (id: string, i: number, delta: number) => {
    const actual = leerNumero(lotesDe(id)[i].cantidad);
    setLote(id, i, { cantidad: String(Math.max(0, (typeof actual === 'number' ? actual : 0) + delta)) });
  };
  const agregarLote = (id: string) => setLotes((l) => ({ ...l, [id]: [...lotesDe(id), { cantidad: '', vencimiento: '' }] }));
  const quitarLote = (id: string, i: number) => setLotes((l) => ({ ...l, [id]: lotesDe(id).filter((_, j) => j !== i) }));

  /** Valida y arma las líneas. Devuelve null si hay errores. */
  const armar = (): Armado | null => {
    const nuevosErrores: Record<string, string> = {};
    const lineas: LineaConteoStock[] = [];
    const resumen: { producto: Producto; contado: number; sistema: number | null }[] = [];
    for (const p of data.productos) {
      const ls = lotes[p.id];
      if (!ls) continue;
      const cargados = ls.filter((l) => l.cantidad.trim() !== '' || l.vencimiento);
      if (cargados.length === 0) continue;
      let total = 0;
      const fechas = new Set<string>();
      for (const l of cargados) {
        const err = validarCantidadConteo(l.cantidad);
        const n = leerNumero(l.cantidad);
        if (err) nuevosErrores[p.id] = err;
        else if (n === null) nuevosErrores[p.id] = 'Cargá la cantidad de cada lote.';
        else if (p.perecedero && cargados.length > 1 && !l.vencimiento) nuevosErrores[p.id] = 'Con varios lotes, cada uno necesita su fecha de vencimiento.';
        else if (l.vencimiento && fechas.has(l.vencimiento)) nuevosErrores[p.id] = 'Hay dos lotes con la misma fecha: sumalos en uno.';
        if (nuevosErrores[p.id]) break;
        if (l.vencimiento) fechas.add(l.vencimiento);
        total += n as number;
        lineas.push({ productoId: p.id, cantidad: n as number, ...(p.perecedero && l.vencimiento ? { fechaVencimiento: l.vencimiento } : {}) });
      }
      if (!nuevosErrores[p.id]) resumen.push({ producto: p, contado: total, sistema: stockDe.get(p.id)?.stockActual ?? null });
    }
    setErrores(nuevosErrores);
    if (Object.keys(nuevosErrores).length > 0) {
      setErrorGeneral('Hay cantidades con error. Corregilas para seguir.');
      document.querySelector('.fila-conteo.con-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return null;
    }
    if (lineas.length === 0) {
      setErrorGeneral('Cargá la cantidad de al menos una presentación.');
      return null;
    }
    return { lineas, resumen: resumen.sort((a, b) => a.producto.nombre.localeCompare(b.producto.nombre, 'es')) };
  };

  const completados = Object.entries(lotes).filter(([, ls]) => ls.some((l) => l.cantidad.trim() !== '')).length;

  const confirmar = async () => {
    const a = armado;
    if (!a || guardando) return;
    setGuardando(true);
    const r = await ejecutar(() => registrarConteoStock(tipo, a.lineas, notas));
    setGuardando(false);
    if (!r.ok) {
      setErrorGeneral(r.error.texto);
      return;
    }
    setLotes({});
    setNotas('');
    setArmado(null);
    const conDif = a.resumen.filter((x) => x.sistema !== null && x.sistema !== x.contado).length;
    avisar(`Conteo guardado: ${a.resumen.length} ${a.resumen.length === 1 ? 'presentación' : 'presentaciones'}${conDif > 0 ? `, ${conDif} con ajuste` : ''}.`);
    onGuardado();
  };

  if (data.productos.length === 0) {
    return <Vacio titulo="Todavía no hay productos en el catálogo." />;
  }

  // ---------- Paso 2: revisar diferencias ----------
  if (armado) {
    const conDif = armado.resumen.filter((x) => x.sistema === null || x.sistema !== x.contado);
    return (
      <>
        <div className="tarjeta">
          <p className="tarjeta-titulo"><Icon name="contar" /> Revisá antes de guardar</p>
          <p className="texto-suave">
            {tipo === 'inicial' ? 'Inventario inicial' : 'Conteo periódico'} · {armado.resumen.length} {armado.resumen.length === 1 ? 'presentación' : 'presentaciones'} ·{' '}
            {conDif.length === 0 ? 'sin diferencias' : `${conDif.length} con diferencia`}
          </p>
          <p className="texto-suave">La diferencia queda registrada como ajuste. Los conteos anteriores no se modifican.</p>
        </div>
        <div className="tabla-scroll">
          <table className="tabla-diferencias">
            <thead>
              <tr><th>Presentación</th><th>Registrado</th><th>Contado</th><th>Diferencia</th></tr>
            </thead>
            <tbody>
              {armado.resumen.map(({ producto, contado, sistema }) => {
                const dif = sistema === null ? null : contado - sistema;
                return (
                  <tr key={producto.id}>
                    <td>{producto.nombre}</td>
                    <td>{sistema === null ? '—' : fmt(sistema)}</td>
                    <td><strong>{fmt(contado)}</strong></td>
                    <td className={dif === null ? '' : dif < 0 ? 'dif-negativa' : dif > 0 ? 'dif-positiva' : 'dif-cero'}>
                      {dif === null ? 'Primer conteo' : dif === 0 ? 'OK' : `${dif > 0 ? '+' : ''}${fmt(dif)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="campo">
          <label htmlFor="conteo-notas">Notas (opcional)</label>
          <input id="conteo-notas" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Ej.: conteo de fin de mes" autoComplete="off" />
        </div>
        <div className="barra-accion">
          {errorGeneral && <p className="barra-error" role="alert"><Icon name="alerta" size={18} /> {errorGeneral}</p>}
          <div className="barra-botones">
            <button type="button" className="btn btn-fantasma" onClick={() => setArmado(null)} disabled={guardando}>Volver</button>
            <button type="button" className="btn btn-primario btn-grande" onClick={confirmar} disabled={guardando}>
              <Icon name="check" /> {guardando ? 'Guardando…' : 'Confirmar conteo'}
            </button>
          </div>
        </div>
      </>
    );
  }

  // ---------- Paso 1: cargar cantidades ----------
  return (
    <>
      <div className="pestanas pestanas-tipo" role="radiogroup" aria-label="Tipo de conteo">
        <button type="button" role="radio" aria-checked={tipo === 'inicial'} className={tipo === 'inicial' ? 'activo' : ''} onClick={() => setTipo('inicial')}>
          Inventario inicial
        </button>
        <button type="button" role="radio" aria-checked={tipo === 'periodico'} className={tipo === 'periodico' ? 'activo' : ''} onClick={() => setTipo('periodico')}>
          Conteo periódico
        </button>
      </div>
      <p className="texto-suave nota-seccion">
        {tipo === 'inicial'
          ? 'Contá todo lo que hay en el almacén, venga de quien venga. Lo que dejes vacío queda sin contar.'
          : 'Contá lo que tenés en el almacén. Podés contar todo o solo una parte: lo que dejes vacío no cambia.'}
      </p>

      <div className="fila-herramientas fila-herramientas-1">
        <input type="search" className="buscador" placeholder="Buscar producto" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar producto" />
      </div>
      <div className="fila-filtros">
        <div className="chips chips-compactos" role="group" aria-label="Mostrar">
          <button type="button" aria-pressed={filtro === 'todos'} className={`chip${filtro === 'todos' ? ' activo' : ''}`} onClick={() => setFiltro('todos')}>Todos</button>
          <button type="button" aria-pressed={filtro === 'sin_contar'} className={`chip${filtro === 'sin_contar' ? ' activo' : ''}`} onClick={() => setFiltro('sin_contar')}>
            Sin contar +{DIAS_SIN_CONTEO} días
          </button>
        </div>
        {data.proveedores.length > 0 && (
          <select
            className="select-filtro"
            aria-label="Filtrar por proveedor (opcional)"
            value={filtro !== 'todos' && filtro !== 'sin_contar' ? filtro : ''}
            onChange={(e) => setFiltro(e.target.value || 'todos')}
          >
            <option value="">Proveedor: cualquiera</option>
            {data.proveedores.map((p) => <option key={p.id} value={p.id}>Solo lo de {p.nombre}</option>)}
          </select>
        )}
      </div>

      {grupos.length === 0 && <Vacio titulo="No hay productos con ese filtro." />}

      <ul className="lista-conteo">
        {grupos.map(({ ficha, presentaciones }) => (
          <li key={ficha.id} className="grupo-ficha">
            {(presentaciones.length > 1 || presentaciones[0].presentacion.toLowerCase() !== 'única') && <p className="grupo-ficha-titulo">{ficha.nombre}</p>}
            <ul className="lista-conteo">
              {presentaciones.map((p) => {
                const ls = lotesDe(p.id);
                const err = errores[p.id];
                const ultimo = ultimoConteoDe(data, p.id);
                const registrado = stockDe.get(p.id)?.stockActual ?? null;
                const completo = ls.some((l) => l.cantidad.trim() !== '');
                return (
                  <li key={p.id} className={`fila-conteo${err ? ' con-error' : ''}${completo && !err ? ' completa' : ''}`}>
                    <div className="fila-conteo-cabecera">
                      <label htmlFor={`cant-${p.id}-0`} className="fila-conteo-nombre">{p.nombre}</label>
                      <span className="texto-suave">
                        Registrado: {registrado === null ? '—' : fmt(registrado)}
                        {ultimo.length > 0 ? ` · contado ${haceCuanto(ultimo[0].fechaHora)}` : ' · nunca contado'}
                      </span>
                    </div>
                    {ls.map((l, i) => (
                      <div key={i} className="fila-conteo-campos">
                        <div className="contador">
                          <button type="button" className="contador-btn" aria-label={`Restar 1 a ${p.nombre}`} onClick={() => sumar(p.id, i, -1)}>−</button>
                          <input
                            id={`cant-${p.id}-${i}`}
                            className="contador-input"
                            type="text"
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder={ls.length > 1 ? `Lote ${i + 1}` : 'Cantidad'}
                            value={l.cantidad}
                            aria-invalid={!!err}
                            onChange={(e) => setLote(p.id, i, { cantidad: e.target.value })}
                          />
                          <button type="button" className="contador-btn" aria-label={`Sumar 1 a ${p.nombre}`} onClick={() => sumar(p.id, i, 1)}>+</button>
                        </div>
                        {p.perecedero && (
                          <label className="vencimiento">
                            <span>Vence</span>
                            <input type="date" value={l.vencimiento} onChange={(e) => setLote(p.id, i, { vencimiento: e.target.value })} aria-label={`Vencimiento de ${p.nombre}, lote ${i + 1}`} />
                          </label>
                        )}
                        {ls.length > 1 && (
                          <button type="button" className="btn-link btn-link-rojo" onClick={() => quitarLote(p.id, i)} aria-label={`Quitar lote ${i + 1}`}>Quitar</button>
                        )}
                      </div>
                    ))}
                    {p.perecedero && (
                      <button type="button" className="btn-link" onClick={() => agregarLote(p.id)}>
                        + Otro lote con otra fecha de vencimiento
                      </button>
                    )}
                    {err && <p className="campo-msg" role="alert">{err}</p>}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>

      <div className="barra-accion">
        {errorGeneral && <p className="barra-error" role="alert"><Icon name="alerta" size={18} /> {errorGeneral}</p>}
        <button type="button" className="btn btn-primario btn-bloque btn-grande" onClick={() => setArmado(armar())}>
          <Icon name="derecha" /> Revisar diferencias{completados > 0 ? ` (${completados})` : ''}
        </button>
      </div>
    </>
  );
}
