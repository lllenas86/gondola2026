import { useEffect } from 'react';
import { StoreProvider, useStore } from './state/store';
import { irA, useRuta, type Seccion } from './lib/router';
import { hayConfiguracion } from './lib/supabase';
import { TEXTO_SIN_CONEXION } from './lib/errores';
import { NOMBRE_ROL, type Rol } from './lib/auth';
import type { Accion } from './lib/permisos';
import { Icon, type IconName } from './components/Icon';
import { Avisos, BannerConexion, EstadoConexion } from './components/ui';
import { HoyPage } from './pages/HoyPage';
import { TareasPage } from './pages/TareasPage';
import { PanelPage } from './pages/PanelPage';
import { ContarPage } from './pages/ContarPage';
import { RecepcionPage } from './pages/RecepcionPage';
import { CatalogoPage } from './pages/CatalogoPage';
import { VencimientosPage } from './pages/VencimientosPage';
import { ProyeccionPage } from './pages/ProyeccionPage';
import { PedidosPage } from './pages/PedidosPage';
import { EquipoPage } from './pages/EquipoPage';
import { IngresoPage } from './pages/IngresoPage';

interface ItemNav { seccion: Seccion; label: string; icon: IconName }

const N: Record<Exclude<Seccion, 'mas'>, ItemNav> = {
  hoy: { seccion: 'hoy', label: 'Hoy', icon: 'hoy' },
  panel: { seccion: 'panel', label: 'Panel', icon: 'panel' },
  contar: { seccion: 'contar', label: 'Stock', icon: 'contar' },
  recepcion: { seccion: 'recepcion', label: 'Recepción', icon: 'recepcion' },
  vencimientos: { seccion: 'vencimientos', label: 'Vencimientos', icon: 'vencer' },
  proyeccion: { seccion: 'proyeccion', label: 'Proyección', icon: 'grafico' },
  pedidos: { seccion: 'pedidos', label: 'Pedidos', icon: 'carrito' },
  catalogo: { seccion: 'catalogo', label: 'Catálogo', icon: 'catalogo' },
  equipo: { seccion: 'equipo', label: 'Equipo', icon: 'usuarios' },
};

// Cada rol tiene su propia navegación (4 accesos + "Más"). El inicio también cambia:
// empleado → Mis tareas · encargado → Hoy · dueño → Panel.
const NAV: Record<Rol | 'abierto', { barra: ItemNav[]; mas: ItemNav[] }> = {
  abierto: { barra: [N.hoy, N.contar, N.recepcion, N.vencimientos], mas: [N.pedidos, N.proyeccion, N.panel, N.catalogo] },
  empleado: { barra: [{ ...N.hoy, label: 'Tareas' }, N.contar, N.recepcion, N.vencimientos], mas: [N.catalogo] },
  encargado: { barra: [N.hoy, N.pedidos, N.contar, N.recepcion], mas: [N.vencimientos, N.proyeccion, N.catalogo] },
  dueno: { barra: [N.panel, N.vencimientos, N.proyeccion, N.pedidos], mas: [{ ...N.hoy, label: 'Operación del día' }, N.contar, N.recepcion, N.catalogo, N.equipo] },
};

/** Qué permiso exige cada sección (la base además rechaza cualquier operación no permitida). */
const PERMISO: Partial<Record<Seccion, Accion>> = { pedidos: 'pedidos', proyeccion: 'proyeccion', panel: 'panel', equipo: 'equipo' };

/** Pantalla mientras se conecta por primera vez, o si no se pudo conectar. */
function SinDatos() {
  const { conexion, recargar, errorCarga } = useStore();
  return (
    <main className="app">
      <header className="cabecera">
        <p className="cabecera-marca">Góndola</p>
        <h1>{conexion === 'cargando' ? 'Conectando con la base…' : 'Sin conexión con la base'}</h1>
      </header>
      {conexion === 'cargando' ? (
        <div className="vacio"><span className="spinner" aria-hidden="true" /></div>
      ) : (
        <div className="vacio" role="alert">
          <p className="vacio-titulo"><Icon name="alerta" size={18} /> {errorCarga && errorCarga.startsWith('Falta actualizar') ? errorCarga : TEXTO_SIN_CONEXION}</p>
          <p className="texto-suave">
            {hayConfiguracion
              ? errorCarga && errorCarga !== TEXTO_SIN_CONEXION && !errorCarga.startsWith('Falta actualizar')
                ? errorCarga
                : 'Revisá la conexión a internet y probá de nuevo.'
              : 'Falta configurar en Vercel NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (o NEXT_PUBLIC_SUPABASE_ANON_KEY), y hacer Redeploy.'}
          </p>
          <button type="button" className="btn btn-primario" onClick={() => void recargar()}>Reintentar</button>
        </div>
      )}
    </main>
  );
}

function MasPage() {
  const { modo, rol, perfil, sesion, salir, puede } = useStore();
  const items = NAV[rol ?? 'abierto'].mas.filter((n) => !PERMISO[n.seccion] || puede(PERMISO[n.seccion] as Accion));
  return (
    <>
      <header className="cabecera">
        <EstadoConexion />
        <p className="cabecera-marca">Góndola</p>
        <h1>Más opciones</h1>
      </header>
      <ul className="lista-catalogo">
        {items.map((n) => (
          <li key={n.seccion}>
            <a className="item-catalogo" href={`#/${n.seccion}`}><span className="item-mas"><Icon name={n.icon} /> {n.label}</span><Icon name="derecha" className="icono-suave" /></a>
          </li>
        ))}
      </ul>
      {modo === 'seguro' && sesion && (
        <div className="tarjeta lista-con-margen">
          <p className="item-titulo">{sesion.usuario.email}</p>
          <p className="texto-suave">{perfil ? `${NOMBRE_ROL[perfil.rol]} · ${perfil.almacen}` : 'Sin almacén'}</p>
          <button type="button" className="btn btn-secundario btn-bloque boton-pedido" onClick={() => void salir()}><Icon name="salir" /> Cerrar sesión</button>
        </div>
      )}
      {modo === 'abierto' && (
        <p className="alerta-amarilla lista-con-margen">
          <Icon name="alerta" size={18} />
          <span>Modo sin usuarios: cualquiera con el link puede ver y cambiar los datos. Para separar roles y proteger la base, corré <code>supabase/05_roles_y_almacenes.sql</code>.</span>
        </p>
      )}
    </>
  );
}

function SinPermiso() {
  return (
    <div className="vacio" role="alert">
      <p className="vacio-titulo"><Icon name="alerta" size={18} /> Tu rol no tiene acceso a esta sección.</p>
      <button type="button" className="btn btn-secundario" onClick={() => irA('hoy')}>Ir al inicio</button>
    </div>
  );
}

function Contenido() {
  const ruta = useRuta();
  const { cargado, modo, sesion, perfil, rol, puede } = useStore();

  // El dueño entra al panel
  useEffect(() => {
    if (rol === 'dueno' && !window.location.hash) irA('panel');
  }, [rol]);

  if (modo === 'seguro' && (!sesion || !perfil)) return <><IngresoPage /><Avisos /></>;

  const nav = NAV[rol ?? 'abierto'];
  const permitido = !PERMISO[ruta.seccion] || puede(PERMISO[ruta.seccion] as Accion);
  const enMas = !nav.barra.some((n) => n.seccion === ruta.seccion);

  return (
    <>
      <BannerConexion />
      {!cargado ? <SinDatos /> : (
        <main className={`app app-${ruta.seccion}`}>
          {!permitido ? <SinPermiso /> : (
            <>
              {ruta.seccion === 'hoy' && (rol === 'empleado' ? <TareasPage /> : <HoyPage />)}
              {ruta.seccion === 'panel' && <PanelPage />}
              {ruta.seccion === 'contar' && <ContarPage key={ruta.params.get('filtro') ?? ''} filtroInicial={ruta.params.get('filtro')} />}
              {ruta.seccion === 'recepcion' && <RecepcionPage />}
              {ruta.seccion === 'vencimientos' && <VencimientosPage pestanaInicial={ruta.params.get('pestana')} />}
              {ruta.seccion === 'proyeccion' && <ProyeccionPage />}
              {ruta.seccion === 'pedidos' && <PedidosPage />}
              {ruta.seccion === 'catalogo' && <CatalogoPage pestanaInicial={ruta.params.get('pestana') === 'proveedores' ? 'proveedores' : 'productos'} />}
              {ruta.seccion === 'equipo' && (modo === 'seguro' ? <EquipoPage /> : <SinPermiso />)}
              {ruta.seccion === 'mas' && <MasPage />}
            </>
          )}
        </main>
      )}
      <nav className="nav-inferior" aria-label="Secciones">
        {nav.barra.map((n) => (
          <a key={n.seccion} href={`#/${n.seccion}`} className={ruta.seccion === n.seccion ? 'activo' : ''} aria-current={ruta.seccion === n.seccion ? 'page' : undefined}>
            <Icon name={n.icon} size={24} />
            <span>{n.label}</span>
          </a>
        ))}
        <a href="#/mas" className={enMas ? 'activo' : ''} aria-current={ruta.seccion === 'mas' ? 'page' : undefined}>
          <Icon name="puntos" size={24} />
          <span>Más</span>
        </a>
      </nav>
      <Avisos />
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Contenido />
    </StoreProvider>
  );
}
