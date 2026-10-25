import { StoreProvider, useStore } from './state/store';
import { useRuta, type Seccion } from './lib/router';
import { hayConfiguracion } from './lib/supabase';
import { TEXTO_SIN_CONEXION } from './lib/errores';
import { Icon, type IconName } from './components/Icon';
import { Avisos, BannerConexion } from './components/ui';
import { HoyPage } from './pages/HoyPage';
import { StockPage } from './pages/StockPage';
import { RecepcionPage } from './pages/RecepcionPage';
import { CatalogoPage } from './pages/CatalogoPage';

const NAV: { seccion: Seccion; label: string; icon: IconName }[] = [
  { seccion: 'hoy', label: 'Hoy', icon: 'hoy' },
  { seccion: 'stock', label: 'Stock', icon: 'contar' },
  { seccion: 'recepcion', label: 'Recepción', icon: 'recepcion' },
  { seccion: 'catalogo', label: 'Catálogo', icon: 'catalogo' },
];

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
          <p className="vacio-titulo"><Icon name="alerta" size={18} /> {TEXTO_SIN_CONEXION}</p>
          <p className="texto-suave">
            {hayConfiguracion
              ? errorCarga && errorCarga !== TEXTO_SIN_CONEXION
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

function Contenido() {
  const ruta = useRuta();
  const { cargado } = useStore();
  return (
    <>
      <BannerConexion />
      {!cargado ? (
        <SinDatos />
      ) : (
        <main className={`app app-${ruta.seccion}`}>
          {ruta.seccion === 'hoy' && <HoyPage />}
          {ruta.seccion === 'stock' && <StockPage params={ruta.params} />}
          {ruta.seccion === 'recepcion' && <RecepcionPage />}
          {ruta.seccion === 'catalogo' && <CatalogoPage pestanaInicial={ruta.params.get('pestana') === 'proveedores' ? 'proveedores' : 'productos'} />}
        </main>
      )}
      <nav className="nav-inferior" aria-label="Secciones">
        {NAV.map((n) => (
          <a key={n.seccion} href={`#/${n.seccion}`} className={ruta.seccion === n.seccion ? 'activo' : ''} aria-current={ruta.seccion === n.seccion ? 'page' : undefined}>
            <Icon name={n.icon} size={24} />
            <span>{n.label}</span>
          </a>
        ))}
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
