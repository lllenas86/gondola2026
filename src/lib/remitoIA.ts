import type { Extraccion } from '../demo/remitos';

// Lectura del remito con un modelo de IA con visión.
//
// La clave del modelo NUNCA está en el navegador: la app le manda la foto a una
// función del servidor (api/leer-remito.js, en Vercel), que es la que tiene la
// clave (variable VISION_API_KEY, sin NEXT_PUBLIC_) y llama al modelo.

export class ErrorLectura extends Error {
  constructor(public motivo: 'sin_ia' | 'ilegible' | 'red', mensaje: string) {
    super(mensaje);
  }
}

/** Respuesta de la función, con el formato que pide la consigna. */
interface RespuestaIA {
  proveedor?: string | null;
  fecha?: string | null;
  lineas?: { descripcion?: string; cantidad?: number | null; fecha_vencimiento?: string | null; confianza?: number }[];
  error?: string;
  mensaje?: string;
}

function urlServicio(): string {
  try {
    return import.meta.env?.VITE_REMITO_API_URL || '/api/leer-remito';
  } catch {
    return '/api/leer-remito';
  }
}

const esFecha = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Manda la foto (data URL JPEG) y la lista de productos del catálogo.
 * Devuelve la extracción normalizada y la respuesta cruda (se guarda en datos_ia).
 */
export async function leerRemito(imagen: string, catalogo: string[]): Promise<{ extraccion: Extraccion; crudo: RespuestaIA }> {
  let res: Response;
  try {
    res = await fetch(urlServicio(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagen, productos: catalogo }),
    });
  } catch {
    throw new ErrorLectura('red', 'No se pudo conectar con el servicio de lectura. Revisá la conexión.');
  }
  let cuerpo: RespuestaIA = {};
  try {
    cuerpo = (await res.json()) as RespuestaIA;
  } catch {
    // respuesta vacía o no JSON (por ejemplo, la función no existe)
  }
  if (!res.ok) {
    if (res.status === 404 || cuerpo.error === 'sin_ia') {
      throw new ErrorLectura('sin_ia', cuerpo.mensaje ?? 'La lectura automática de remitos no está configurada.');
    }
    throw new ErrorLectura('ilegible', cuerpo.mensaje ?? 'No se pudo leer el remito.');
  }

  const lineas = (Array.isArray(cuerpo.lineas) ? cuerpo.lineas : [])
    .filter((l) => l && typeof l.descripcion === 'string' && l.descripcion.trim() !== '')
    .map((l) => ({
      descripcion: (l.descripcion as string).trim(),
      cantidad: typeof l.cantidad === 'number' && Number.isFinite(l.cantidad) ? l.cantidad : null,
      ...(esFecha(l.fecha_vencimiento) ? { fechaVencimiento: l.fecha_vencimiento } : {}),
      ...(typeof l.confianza === 'number' ? { confianzaLectura: Math.max(0, Math.min(1, l.confianza)) } : {}),
    }));

  if (lineas.length === 0) {
    throw new ErrorLectura('ilegible', 'No se pudo leer el remito: la imagen no es legible o no parece un remito.');
  }
  return {
    extraccion: { proveedor: typeof cuerpo.proveedor === 'string' ? cuerpo.proveedor : '', fecha: esFecha(cuerpo.fecha) ? cuerpo.fecha : '', lineas },
    crudo: cuerpo,
  };
}
