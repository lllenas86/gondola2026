import { useState } from 'react';
import { useStore } from '../state/store';
import { formatDias } from '../lib/dates';
import { productosDeProveedor, proveedoresDeProducto } from '../lib/stock';
import { irA } from '../lib/router';
import { Icon } from '../components/Icon';
import { EstadoConexion, Vacio } from '../components/ui';
import { ProductoForm } from '../features/ProductoForm';
import { ProveedorForm } from '../features/ProveedorForm';
import { BotonRestablecerDemo } from '../features/RestablecerDemo';
import type { Producto, Proveedor } from '../types';

type Pestana = 'productos' | 'proveedores';

export function CatalogoPage({ pestanaInicial }: { pestanaInicial: Pestana }) {
  const { data } = useStore();
  const pestana = pestanaInicial;
  const [editandoProducto, setEditandoProducto] = useState<Producto | 'nuevo' | null>(null);
  const [editandoProveedor, setEditandoProveedor] = useState<Proveedor | 'nuevo' | null>(null);
  const [busqueda, setBusqueda] = useState('');

  const q = busqueda.trim().toLowerCase();
  const productos = [...data.productos]
    .filter((p) => !q || p.nombre.toLowerCase().includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const proveedores = [...data.proveedores]
    .filter((p) => !q || p.nombre.toLowerCase().includes(q))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Catálogo</p>
        <h1>{pestana === 'productos' ? 'Productos' : 'Proveedores'}</h1>
      </header>

      <div className="pestanas" role="tablist">
        <button type="button" role="tab" aria-selected={pestana === 'productos'} className={pestana === 'productos' ? 'activo' : ''} onClick={() => irA('catalogo')}>
          Productos <span className="contador-pestana">{data.productos.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={pestana === 'proveedores'} className={pestana === 'proveedores' ? 'activo' : ''} onClick={() => irA('catalogo', { pestana: 'proveedores' })}>
          Proveedores <span className="contador-pestana">{data.proveedores.length}</span>
        </button>
      </div>

      <div className="fila-herramientas">
        <input
          type="search"
          className="buscador"
          placeholder={pestana === 'productos' ? 'Buscar producto' : 'Buscar proveedor'}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar"
        />
        <button
          type="button"
          className="btn btn-primario"
          onClick={() => (pestana === 'productos' ? setEditandoProducto('nuevo') : setEditandoProveedor('nuevo'))}
        >
          <Icon name="mas" /> Nuevo
        </button>
      </div>

      {pestana === 'productos' && (
        <ul className="lista-catalogo">
          {productos.length === 0 && <Vacio titulo={q ? 'No hay productos con ese nombre.' : 'Todavía no hay productos.'} />}
          {productos.map((p) => {
            const provs = proveedoresDeProducto(data, p.id);
            return (
              <li key={p.id}>
                <button type="button" className="item-catalogo" onClick={() => setEditandoProducto(p)}>
                  <div>
                    <p className="item-titulo">{p.nombre}</p>
                    <p className="texto-suave">
                      {p.unidad} · punto de pedido {p.puntoDePedido}
                      {provs.length > 0 ? ` · ${provs.map((x) => x.nombre).join(', ')}` : ' · sin proveedor'}
                    </p>
                    {p.perecedero && <span className="etiqueta etiqueta-violeta"><Icon name="hoja" size={13} /> Perecedero</span>}
                  </div>
                  <Icon name="lapiz" className="icono-suave" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {pestana === 'proveedores' && (
        <ul className="lista-catalogo">
          {proveedores.length === 0 && <Vacio titulo={q ? 'No hay proveedores con ese nombre.' : 'Todavía no hay proveedores.'} />}
          {proveedores.map((p) => {
            const prods = productosDeProveedor(data, p.id);
            return (
              <li key={p.id}>
                <button type="button" className="item-catalogo" onClick={() => setEditandoProveedor(p)}>
                  <div>
                    <p className="item-titulo">{p.nombre}</p>
                    <p className="texto-suave">Pasa: {formatDias(p.diasDeVisita) || '—'}{p.telefono ? ` · Tel. ${p.telefono}` : ''}</p>
                    <p className="texto-suave">{prods.length} {prods.length === 1 ? 'producto' : 'productos'}{prods.length > 0 ? `: ${prods.map((x) => x.nombre).join(', ')}` : ''}</p>
                  </div>
                  <Icon name="lapiz" className="icono-suave" />
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

      <BotonRestablecerDemo />

      {editandoProducto && (
        <ProductoForm producto={editandoProducto === 'nuevo' ? null : editandoProducto} onCerrar={() => setEditandoProducto(null)} />
      )}
      {editandoProveedor && (
        <ProveedorForm proveedor={editandoProveedor === 'nuevo' ? null : editandoProveedor} onCerrar={() => setEditandoProveedor(null)} />
      )}
    </>
  );
}
