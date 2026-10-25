import { useEffect, useState } from 'react';

// Navegación con el "#" de la URL (#/stock?pestana=vencimientos…).
// No necesita librerías ni configuración en Vercel, y recargar la página nunca da 404.

export type Seccion = 'hoy' | 'stock' | 'recepcion' | 'catalogo';
const SECCIONES: Seccion[] = ['hoy', 'stock', 'recepcion', 'catalogo'];
/** Rutas viejas que siguen funcionando (links guardados, favoritos). */
const ALIAS: Record<string, Seccion> = { contar: 'stock' };

export interface Ruta {
  seccion: Seccion;
  params: URLSearchParams;
}

export function leerRuta(hash: string = window.location.hash): Ruta {
  const limpio = hash.replace(/^#\/?/, '');
  const [path, query = ''] = limpio.split('?');
  const seccion = (SECCIONES as string[]).includes(path) ? (path as Seccion) : ALIAS[path] ?? 'hoy';
  return { seccion, params: new URLSearchParams(query) };
}

export function irA(seccion: Seccion, params?: Record<string, string>) {
  const q = params ? new URLSearchParams(params).toString() : '';
  window.location.hash = `/${seccion}${q ? `?${q}` : ''}`;
}

export function useRuta(): Ruta {
  const [ruta, setRuta] = useState(() => leerRuta());
  useEffect(() => {
    const onChange = () => {
      setRuta(leerRuta());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return ruta;
}
