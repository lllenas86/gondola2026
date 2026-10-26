import type { Extraccion } from '../demo/remitos';

// Lectura del remito con un modelo de IA con visión.
//
// La clave del modelo NUNCA está en el navegador: la app le manda la foto a una
// función del servidor (api/leer-remito.js, en Vercel), que es la que tiene la
// clave (variable VISION_API_KEY, sin NEXT_PUBLIC_) y llama al modelo.

export class ErrorLectura extends Error {
  /** 'transitorio': el servicio está saturado o tardó demasiado; se puede reintentar. */
  constructor(public motivo: 'sin_ia' | 'ilegible' | 'red' | 'transitorio', mensaje: string) {
    super(mensaje);
  }
  get reintentable(): boolean {
    return this.motivo === 'red' || this.motivo === 'transitorio';
  }
}

/** Un poco más que el presupuesto del servidor (50 s) y menos que el corte de Vercel (60 s). */
const ESPERA_MAXIMA_MS = 58_000;

/** Respuesta de la función, con el formato que pide la consigna. */
interface RespuestaIA {
  proveedor?: string | null;
  fecha?: string | null;
  lineas?: { descripcion?: string; cantidad?: number | null; fecha_vencimiento?: string | null; confianza?: number }[];
  error?: string;
  mensaje?: string;
  reintentable?: boolean;
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
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_MAXIMA_MS);
  try {
    res = await fetch(urlServicio(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagen, productos: catalogo }),
      signal: control.signal,
    });
  } catch {
    clearTimeout(reloj);
    if (control.signal.aborted) throw new ErrorLectura('transitorio', 'La IA tardó demasiado en leer el remito. Probá de nuevo o cargalo a mano.');
    throw new ErrorLectura('red', 'No se pudo conectar con el servicio de lectura. Revisá la conexión.');
  }
  clearTimeout(reloj);
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
    // Servicio saturado (503), demora (504 del servidor o corte de Vercel) o error momentáneo
    if (cuerpo.reintentable || [502, 503, 504].includes(res.status)) {
      throw new ErrorLectura('transitorio', cuerpo.mensaje ?? (res.status === 504
        ? 'La IA tardó demasiado en leer el remito. Probá de nuevo o cargalo a mano.'
        : 'El servicio de IA no está disponible en este momento. Probá de nuevo o cargalo a mano.'));
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
