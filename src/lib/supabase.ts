// Conexión con Supabase por su API REST (PostgREST + Storage), sin dependencias.
//
// Variables de entorno (en Vercel). Se acepta cualquiera de estos nombres:
//   URL:   NEXT_PUBLIC_SUPABASE_URL  (o VITE_SUPABASE_URL)
//   Clave: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  o  NEXT_PUBLIC_SUPABASE_ANON_KEY
//          (o VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_ANON_KEY)
// vite.config.ts expone las variables NEXT_PUBLIC_ además de las VITE_.

function leerEnv(...nombres: string[]): string {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  for (const n of nombres) {
    const v = env[n];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

export const SUPABASE_URL = leerEnv('NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/+$/, '');
const SUPABASE_KEY = leerEnv(
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_SUPABASE_ANON_KEY',
);

export const hayConfiguracion = SUPABASE_URL !== '' && SUPABASE_KEY !== '';

/** Error de la base. `tipo` distingue falta de conexión de un rechazo de la base. */
export class ErrorBase extends Error {
  constructor(
    public tipo: 'red' | 'base' | 'config',
    public codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

function encabezados(extra?: Record<string, string>): Record<string, string> {
  // Las claves nuevas (sb_publishable_…) no son JWT: van solo en el encabezado apikey.
  // Las claves anon antiguas (eyJ…) además se mandan como Authorization.
  const esJwt = SUPABASE_KEY.startsWith('eyJ');
  return { apikey: SUPABASE_KEY, ...(esJwt ? { Authorization: `Bearer ${SUPABASE_KEY}` } : {}), ...extra };
}

async function pedir(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<unknown> {
  if (!hayConfiguracion) {
    throw new ErrorBase('config', '', 'La app no tiene configurada la conexión con la base (faltan las variables de Supabase en Vercel).');
  }
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, { ...init, headers: encabezados(init.headers) });
  } catch {
    throw new ErrorBase('red', '', 'Sin conexión con la base.');
  }
  const texto = await res.text();
  let cuerpo: unknown = null;
  if (texto) {
    try {
      cuerpo = JSON.parse(texto);
    } catch {
      cuerpo = texto;
    }
  }
  if (!res.ok) {
    const c = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as { code?: string; message?: string; error?: string };
    // 5xx de la puerta de enlace (proyecto pausado, caída): se trata como sin conexión
    const tipo = res.status >= 500 && !c.code ? 'red' : 'base';
    throw new ErrorBase(tipo, c.code ?? String(res.status), c.message ?? c.error ?? `Error ${res.status}`);
  }
  return cuerpo;
}

const enc = encodeURIComponent;

/** Acceso a tablas y vistas. `filtro` usa la sintaxis de PostgREST, p. ej. "id=eq.123". */
export const db = {
  async select<T>(tabla: string, query = 'select=*'): Promise<T[]> {
    return (await pedir(`/rest/v1/${tabla}?${query}`)) as T[];
  },
  async insert<T>(tabla: string, filas: object | object[]): Promise<T[]> {
    return (await pedir(`/rest/v1/${tabla}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(filas),
    })) as T[];
  },
  /** Inserta ignorando las filas que ya existen (ON CONFLICT DO NOTHING). */
  async insertIgnorandoDuplicados(tabla: string, filas: object[], columnas: string): Promise<void> {
    if (filas.length === 0) return;
    await pedir(`/rest/v1/${tabla}?on_conflict=${enc(columnas)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(filas),
    });
  },
  async update<T>(tabla: string, filtro: string, cambios: object): Promise<T[]> {
    return (await pedir(`/rest/v1/${tabla}?${filtro}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(cambios),
    })) as T[];
  },
  async borrar(tabla: string, filtro: string): Promise<void> {
    await pedir(`/rest/v1/${tabla}?${filtro}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  },
  /** Llama a una función de la base (create function … en supabase/*.sql). */
  async rpc<T>(funcion: string, parametros: object = {}): Promise<T> {
    return (await pedir(`/rest/v1/rpc/${funcion}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parametros),
    })) as T;
  },
};

export const BUCKET_REMITOS = 'remitos';

/** Sube un archivo al bucket. Devuelve null si no se pudo (por ejemplo, si el bucket no existe). */
export async function subirArchivo(path: string, archivo: Blob): Promise<string | null> {
  try {
    await pedir(`/storage/v1/object/${BUCKET_REMITOS}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': archivo.type || 'application/octet-stream', 'x-upsert': 'false' },
      body: archivo,
    });
    return path;
  } catch {
    return null;
  }
}

/** URL temporal para ver una foto del bucket (es privado). */
export async function urlFirmada(path: string, segundos = 3600): Promise<string | null> {
  try {
    const r = (await pedir(`/storage/v1/object/sign/${BUCKET_REMITOS}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: segundos }),
    })) as { signedURL?: string; signedUrl?: string };
    const rel = r.signedURL ?? r.signedUrl;
    return rel ? `${SUPABASE_URL}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}` : null;
  } catch {
    return null;
  }
}
