import { StoreProvider } from './state/store';
import { useRuta, type Seccion } from './lib/router';
import { Icon, type IconName } from './components/Icon';
import { Avisos } from './components/ui';
import { HoyPage } from './pages/HoyPage';
import { ContarPage } from './pages/ContarPage';
import { RecepcionPage } from './pages/RecepcionPage';
import { CatalogoPage } from './pages/CatalogoPage';

const NAV: { seccion: Seccion; label: string; icon: IconName }[] = [
  { seccion: 'hoy', label: 'Hoy', icon: 'hoy' },
  { seccion: 'contar', label: 'Contar', icon: 'contar' },
  { seccion: 'recepcion', label: 'Recepción', icon: 'recepcion' },
  { seccion: 'catalogo', label: 'Catálogo', icon: 'catalogo' },
];

function Contenido() {
  const ruta = useRuta();
  return (
    <>
      <main className={`app app-${ruta.seccion}`}>
        {ruta.seccion === 'hoy' && <HoyPage />}
        {ruta.seccion === 'contar' && <ContarPage key={ruta.params.get('proveedor') ?? ''} proveedorInicial={ruta.params.get('proveedor')} />}
        {ruta.seccion === 'recepcion' && <RecepcionPage />}
        {ruta.seccion === 'catalogo' && <CatalogoPage pestanaInicial={ruta.params.get('pestana') === 'proveedores' ? 'proveedores' : 'productos'} />}
      </main>
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
