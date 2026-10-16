import type { Extraccion } from '../demo/remitos';

// Lectura del remito con un modelo de IA con visión.
//
// La app es solo front-end: no puede guardar una clave de API de forma segura.
// Por eso la lectura real se hace a través de un servicio propio (por ejemplo,
// una función serverless de Vercel) cuya URL se configura en la variable
// VITE_REMITO_API_URL. El servicio recibe { imagen: "data:image/jpeg;base64,…" }
// y devuelve un JSON con la forma de `Extraccion`.
//
// Si no hay servicio configurado, la app avisa y ofrece la carga manual o el
// remito de ejemplo (modo demo).

export class ErrorLectura extends Error {
  constructor(public motivo: 'sin_ia' | 'ilegible' | 'red', mensaje: string) {
    super(mensaje);
  }
}

type Lector = (imagen: string) => Promise<Extraccion>;

declare global {
  interface Window {
    /** Permite que la página donde se publica la demo aporte su propio lector. */
    GONDOLA_LEER_REMITO?: Lector;
  }
}

function urlServicio(): string | undefined {
  try {
    return import.meta.env?.VITE_REMITO_API_URL || undefined;
  } catch {
    return undefined;
  }
}

export function hayLecturaConIA(): boolean {
  return !!urlServicio() || typeof window.GONDOLA_LEER_REMITO === 'function';
}

export async function leerRemito(imagen: string): Promise<Extraccion> {
  let extraccion: Extraccion;
  if (typeof window.GONDOLA_LEER_REMITO === 'function') {
    extraccion = await window.GONDOLA_LEER_REMITO(imagen);
  } else {
    const url = urlServicio();
    if (!url) {
      throw new ErrorLectura('sin_ia', 'La lectura automática de remitos no está configurada en esta versión.');
    }
    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagen }) });
    } catch {
      throw new ErrorLectura('red', 'No se pudo conectar con el servicio de lectura. Revisá la conexión.');
    }
    if (!res.ok) throw new ErrorLectura('ilegible', 'No se pudo leer el remito.');
    extraccion = (await res.json()) as Extraccion;
  }
  if (!extraccion || !Array.isArray(extraccion.lineas) || extraccion.lineas.length === 0) {
    throw new ErrorLectura('ilegible', 'No se pudo leer el remito: la imagen no es legible o no parece un remito.');
  }
  return extraccion;
}
