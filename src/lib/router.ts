import { useEffect, useState } from 'react';

// Navegación con el "#" de la URL (#/contar?…).
// No necesita librerías ni configuración en Vercel, y recargar la página nunca da 404.

export type Seccion =
  | 'hoy' | 'contar' | 'recepcion' | 'vencimientos' | 'proyeccion' | 'pedidos' | 'catalogo' | 'panel' | 'equipo' | 'mas';
const SECCIONES: Seccion[] = ['hoy', 'contar', 'recepcion', 'vencimientos', 'proyeccion', 'pedidos', 'catalogo', 'panel', 'equipo', 'mas'];

export interface Ruta {
  seccion: Seccion;
  params: URLSearchParams;
}

export function leerRuta(hash: string = window.location.hash): Ruta {
  const limpio = hash.replace(/^#\/?/, '');
  const [path, query = ''] = limpio.split('?');
  const seccion = (SECCIONES as string[]).includes(path) ? (path as Seccion) : 'hoy';
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
