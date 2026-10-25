import { useState } from 'react';
import { useStore } from '../state/store';
import { formatDias } from '../lib/dates';
import { abreviaturaUnidad, formatoCantidad, itemsDeProveedor, nombreItem, presentacionesDe, proveedoresDeProducto, stockDe } from '../lib/inventario';
import { irA } from '../lib/router';
import { Icon } from '../components/Icon';
import { EstadoConexion, Vacio } from '../components/ui';
import { AltaProducto, FichaProducto } from '../features/ProductoFicha';
import { ProveedorForm } from '../features/ProveedorForm';
import type { Producto, Proveedor } from '../types';

type Pestana = 'productos' | 'proveedores';

export function CatalogoPage({ pestanaInicial }: { pestanaInicial: Pestana }) {
  const { data, vistas, puede } = useStore();
  const pestana = pestanaInicial;
  const [ficha, setFicha] = useState<Producto | null>(null);
  const [alta, setAlta] = useState(false);
  const [editandoProveedor, setEditandoProveedor] = useState<Proveedor | 'nuevo' | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [verArchivados, setVerArchivados] = useState(false);

  const q = busqueda.trim().toLowerCase();
  const coincide = (p: Producto) =>
    !q || p.nombre.toLowerCase().includes(q) || presentacionesDe(data, p.id).some((x) => nombreItem(p, x).toLowerCase().includes(q));
  const productos = [...data.productos]
    .filter((p) => (verArchivados ? !p.activo : p.activo) && coincide(p))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const archivados = data.productos.filter((p) => !p.activo).length;
  const proveedores = [...data.proveedores]
    .filter((p) => !q || p.nombre.toLowerCase().includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const puedeNuevo = pestana === 'productos' ? puede('altaProducto') : puede('proveedores');

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Catálogo</p>
        <h1>{pestana === 'productos' ? 'Productos y presentaciones' : 'Proveedores'}</h1>
      </header>

      <div className="pestanas" role="tablist">
        <button type="button" role="tab" aria-selected={pestana === 'productos'} className={pestana === 'productos' ? 'activo' : ''} onClick={() => irA('catalogo')}>
          Productos <span className="contador-pestana">{data.productos.filter((p) => p.activo).length}</span>
        </button>
        <button type="button" role="tab" aria-selected={pestana === 'proveedores'} className={pestana === 'proveedores' ? 'activo' : ''} onClick={() => irA('catalogo', { pestana: 'proveedores' })}>
          Proveedores <span className="contador-pestana">{data.proveedores.length}</span>
        </button>
      </div>

      <div className={puedeNuevo ? 'fila-herramientas' : 'fila-herramientas sin-boton'}>
        <input
          type="search"
          className="buscador"
          placeholder={pestana === 'productos' ? 'Buscar producto o presentación' : 'Buscar proveedor'}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar"
        />
        {puedeNuevo && (
          <button type="button" className="btn btn-primario" onClick={() => (pestana === 'productos' ? setAlta(true) : setEditandoProveedor('nuevo'))}>
            <Icon name="mas" /> Nuevo
          </button>
        )}
      </div>

      {pestana === 'productos' && (
        <>
          {archivados > 0 && (
            <button type="button" className="btn-link enlace-archivados" onClick={() => setVerArchivados((v) => !v)}>
              {verArchivados ? 'Ver productos activos' : `Ver fichas archivadas (${archivados})`}
            </button>
          )}
          <ul className="lista-catalogo">
            {productos.length === 0 && <Vacio titulo={q ? 'No hay productos con ese nombre.' : verArchivados ? 'No hay fichas archivadas.' : 'Todavía no hay productos.'} />}
            {productos.map((p) => {
              const pres = presentacionesDe(data, p.id).filter((x) => x.activa);
              const provs = proveedoresDeProducto(data, p.id);
              return (
                <li key={p.id}>
                  <button type="button" className="item-catalogo" onClick={() => setFicha(p)} data-testid="producto-catalogo">
                    <div>
                      <p className="item-titulo">{p.nombre}</p>
                      <div className="chips-presentacion">
                        {pres.length === 0 && <span className="texto-suave">Sin presentaciones activas</span>}
                        {pres.map((x) => {
                          const s = stockDe(data, vistas, x.id);
                          return (
                            <span key={x.id} className={`chip-presentacion${s !== null && s <= x.puntoDePedido ? ' bajo' : ''}`}>
                              {x.nombre === 'Única' ? 'Única' : x.nombre} · <strong>{s === null ? '—' : formatoCantidad(s)}</strong> {abreviaturaUnidad(x.unidadStock)}
                            </span>
                          );
                        })}
                      </div>
                      <p className="texto-suave">{provs.length > 0 ? provs.map((x) => x.nombre).join(', ') : 'Sin proveedor'}</p>
                      {p.perecedero && <span className="etiqueta etiqueta-violeta"><Icon name="hoja" size={13} /> Perecedero</span>}
                    </div>
                    <Icon name="derecha" className="icono-suave" />
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {pestana === 'proveedores' && (
        <ul className="lista-catalogo">
          {proveedores.length === 0 && <Vacio titulo={q ? 'No hay proveedores con ese nombre.' : 'Todavía no hay proveedores.'} />}
          {proveedores.map((p) => {
            const items = itemsDeProveedor(data, p.id);
            return (
              <li key={p.id}>
                <button type="button" className="item-catalogo" onClick={() => setEditandoProveedor(p)} disabled={!puede('proveedores')}>
                  <div>
                    <p className="item-titulo">{p.nombre}</p>
                    <p className="texto-suave">Pasa: {formatDias(p.diasDeVisita) || '—'}{p.telefono ? ` · Tel. ${p.telefono}` : ''}</p>
                    <p className="texto-suave">{items.length} {items.length === 1 ? 'presentación' : 'presentaciones'}{items.length > 0 ? `: ${items.map((x) => nombreItem(x.producto, x.presentacion)).join(', ')}` : ''}</p>
                  </div>
                  {puede('proveedores') && <Icon name="lapiz" className="icono-suave" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="pie-catalogo aviso-nube">
        <Icon name="check" size={18} />
        <p>Tus datos se guardan en la nube (Supabase). Podés usar la app desde más de un celular.</p>
      </div>


      {alta && <AltaProducto onCerrar={() => setAlta(false)} />}
      {ficha && <FichaProducto producto={ficha} onCerrar={() => setFicha(null)} />}
      {editandoProveedor && (
        <ProveedorForm proveedor={editandoProveedor === 'nuevo' ? null : editandoProveedor} onCerrar={() => setEditandoProveedor(null)} />
      )}
    </>
  );
}
