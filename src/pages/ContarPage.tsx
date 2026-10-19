import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { calcularStock, productosDeProveedor } from '../lib/stock';
import { formatFechaCorta, haceCuanto } from '../lib/dates';
import { leerNumero, validarCantidadConteo } from '../lib/validation';
import { irA } from '../lib/router';
import { Icon } from '../components/Icon';
import { EstadoConexion, Vacio } from '../components/ui';
import { registrarConteos, type NuevoConteo } from '../lib/datos';
import type { Producto } from '../types';

const TODOS = '__todos__';

interface Fila {
  cantidad: string;
  vencimiento: string;
}

export function ContarPage({ proveedorInicial }: { proveedorInicial: string | null }) {
  const { data, ejecutar, avisar } = useStore();
  const valido = proveedorInicial && (proveedorInicial === TODOS || data.proveedores.some((p) => p.id === proveedorInicial));
  const proveedorId: string | null = valido ? proveedorInicial : null;
  const [filas, setFilas] = useState<Record<string, Fila>>({});
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const productos: Producto[] = useMemo(() => {
    if (!proveedorId) return [];
    if (proveedorId === TODOS) return [...data.productos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return productosDeProveedor(data, proveedorId);
  }, [data, proveedorId]);

  const elegir = (id: string) => {
    irA('contar', { proveedor: id });
  };

  const actualizar = (id: string, cambio: Partial<Fila>) => {
    setFilas((f) => ({ ...f, [id]: { ...(f[id] ?? { cantidad: '', vencimiento: '' }), ...cambio } }));
    setErrores((e) => {
      if (!e[id] && !e[`${id}.venc`]) return e;
      const { [id]: _a, [`${id}.venc`]: _b, ...resto } = e;
      return resto;
    });
    setErrorGeneral(null);
  };

  const sumar = (id: string, delta: number) => {
    const actual = leerNumero(filas[id]?.cantidad ?? '');
    const base = typeof actual === 'number' ? actual : 0;
    actualizar(id, { cantidad: String(Math.max(0, base + delta)) });
  };

  const completados = productos.filter((p) => (filas[p.id]?.cantidad ?? '').trim() !== '').length;

  const guardar = async () => {
    if (guardando) return;
    const nuevosErrores: Record<string, string> = {};
    const conteos: NuevoConteo[] = [];
    for (const p of productos) {
      const f = filas[p.id];
      if (!f) continue;
      const err = validarCantidadConteo(f.cantidad);
      if (err) {
        nuevosErrores[p.id] = err;
        continue;
      }
      const n = leerNumero(f.cantidad);
      if (n === null) {
        if (f.vencimiento) nuevosErrores[p.id] = 'Cargá la cantidad contada para guardar el vencimiento.';
        continue;
      }
      if (typeof n !== 'number') continue;
      conteos.push({
        productoId: p.id,
        cantidad: n,
        ...(p.perecedero && f.vencimiento ? { fechaVencimiento: f.vencimiento } : {}),
      });
    }
    setErrores(nuevosErrores);
    if (Object.keys(nuevosErrores).length > 0) {
      setErrorGeneral('Hay cantidades con error. Corregilas para guardar.');
      return;
    }
    if (conteos.length === 0) {
      setErrorGeneral('Cargá la cantidad de al menos un producto.');
      return;
    }
    setGuardando(true);
    const r = await ejecutar(() => registrarConteos(conteos));
    setGuardando(false);
    if (!r.ok) {
      // Por ejemplo, la base rechaza un conteo negativo o no hay conexión: no se pierde lo cargado
      setErrorGeneral(r.error.texto);
      return;
    }
    setFilas({});
    avisar(conteos.length === 1 ? 'Se guardó 1 conteo.' : `Se guardaron ${conteos.length} conteos.`);
  };

  const nombreSeleccion = proveedorId === TODOS ? 'Todos los productos' : data.proveedores.find((p) => p.id === proveedorId)?.nombre;

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Contar</p>
        <h1>{nombreSeleccion ?? '¿De qué proveedor?'}</h1>
      </header>

      <div className="chips" role="tablist" aria-label="Proveedor">
        {data.proveedores.map((p) => (
          <button key={p.id} type="button" role="tab" aria-selected={p.id === proveedorId} className={`chip${p.id === proveedorId ? ' activo' : ''}`} onClick={() => elegir(p.id)}>
            {p.nombre}
          </button>
        ))}
        <button type="button" role="tab" aria-selected={proveedorId === TODOS} className={`chip${proveedorId === TODOS ? ' activo' : ''}`} onClick={() => elegir(TODOS)}>
          Todos
        </button>
      </div>

      {!proveedorId && <Vacio titulo="Elegí un proveedor para ver sus productos." />}

      {proveedorId && productos.length === 0 && (
        <Vacio titulo="Este proveedor no tiene productos asociados.">
          <button type="button" className="btn btn-secundario" onClick={() => irA('catalogo', { pestana: 'proveedores' })}>
            Asociar productos en Catálogo
          </button>
        </Vacio>
      )}

      {productos.length > 0 && (
        <>
          <ul className="lista-conteo">
            {productos.map((p) => {
              const s = calcularStock(data, p);
              const f = filas[p.id] ?? { cantidad: '', vencimiento: '' };
              const err = errores[p.id];
              const inputId = `cant-${p.id}`;
              return (
                <li key={p.id} className={`fila-conteo${err ? ' con-error' : ''}${f.cantidad.trim() !== '' && !err ? ' completa' : ''}`}>
                  <div className="fila-conteo-cabecera">
                    <label htmlFor={inputId} className="fila-conteo-nombre">{p.nombre}</label>
                    <span className="texto-suave">
                      {s.ultimoConteo
                        ? `Último: ${s.ultimoConteo.cantidad} (${haceCuanto(s.ultimoConteo.fechaHora)})`
                        : 'Sin conteos'}
                    </span>
                  </div>
                  <div className="fila-conteo-campos">
                    <div className="contador">
                      <button type="button" className="contador-btn" aria-label={`Restar 1 a ${p.nombre}`} onClick={() => sumar(p.id, -1)}>−</button>
                      <input
                        id={inputId}
                        className="contador-input"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="Cantidad"
                        value={f.cantidad}
                        aria-invalid={!!err}
                        onChange={(e) => actualizar(p.id, { cantidad: e.target.value })}
                        onBlur={() => {
                          const e = validarCantidadConteo(f.cantidad);
                          if (e) setErrores((x) => ({ ...x, [p.id]: e }));
                        }}
                      />
                      <button type="button" className="contador-btn" aria-label={`Sumar 1 a ${p.nombre}`} onClick={() => sumar(p.id, 1)}>+</button>
                    </div>
                    {p.perecedero && (
                      <label className="vencimiento">
                        <span>Vence</span>
                        <input type="date" value={f.vencimiento} onChange={(e) => actualizar(p.id, { vencimiento: e.target.value })} aria-label={`Vencimiento de ${p.nombre}`} />
                      </label>
                    )}
                  </div>
                  {p.perecedero && s.ultimoConteo?.fechaVencimiento && !f.vencimiento && (
                    <p className="texto-suave">Último vencimiento cargado: {formatFechaCorta(s.ultimoConteo.fechaVencimiento)}</p>
                  )}
                  {err && <p className="campo-msg" role="alert">{err}</p>}
                </li>
              );
            })}
          </ul>

          <div className="barra-accion">
            {errorGeneral && <p className="barra-error" role="alert"><Icon name="alerta" size={18} /> {errorGeneral}</p>}
            <button type="button" className="btn btn-primario btn-bloque btn-grande" onClick={guardar} disabled={guardando}>
              <Icon name="check" /> {guardando ? 'Guardando…' : `Guardar conteo${completados > 0 ? ` (${completados})` : ''}`}
            </button>
          </div>
        </>
      )}
    </>
  );
}
