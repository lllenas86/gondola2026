// Inicio de sesión con Supabase Auth (API REST, sin dependencias) y perfil del usuario.
//
// La protección real está en la base (supabase/05_roles_y_almacenes.sql): cada tabla tiene
// políticas por almacén y por rol. La app solo adapta la interfaz al rol.
// Si la base todavía no tiene la 05, la app funciona en "modo abierto" (como antes).
import { alVencerToken, db, ErrorBase, SUPABASE_KEY_PUBLICA, SUPABASE_URL, usarToken } from './supabase';

export type Rol = 'empleado' | 'encargado' | 'dueno';

export const NOMBRE_ROL: Record<Rol, string> = {
  empleado: 'Empleado / repositor',
  encargado: 'Encargado',
  dueno: 'Dueño / administrador',
};

export interface Sesion {
  accessToken: string;
  refreshToken: string;
  /** Epoch en segundos */
  expiraEn: number;
  usuario: { id: string; email: string };
}

export interface Perfil {
  almacenId: string;
  almacen: string;
  rol: Rol;
}

const CLAVE = 'gondola.sesion';

function leerGuardada(): Sesion | null {
  try {
    const t = window.localStorage.getItem(CLAVE);
    return t ? (JSON.parse(t) as Sesion) : null;
  } catch {
    return null;
  }
}

function guardar(s: Sesion | null) {
  try {
    if (s) window.localStorage.setItem(CLAVE, JSON.stringify(s));
    else window.localStorage.removeItem(CLAVE);
  } catch {
    /* navegador sin almacenamiento: la sesión dura lo que dure la pestaña */
  }
}

let actual: Sesion | null = null;
const oyentes = new Set<(s: Sesion | null) => void>();

export function onSesion(fn: (s: Sesion | null) => void): () => void {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

function establecer(s: Sesion | null) {
  actual = s;
  usarToken(s?.accessToken ?? null);
  guardar(s);
  for (const fn of oyentes) fn(s);
}

export function sesionActual(): Sesion | null {
  return actual;
}

interface RespuestaToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  user: { id: string; email: string };
}

async function pedirToken(tipo: 'password' | 'refresh_token', cuerpo: object): Promise<Sesion> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=${tipo}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY_PUBLICA(), 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorBase('red', '', 'Sin conexión con la base.');
  }
  const d = (await res.json().catch(() => ({}))) as Partial<RespuestaToken> & { error_description?: string; msg?: string; error_code?: string };
  if (!res.ok || !d.access_token || !d.user) {
    const texto = res.status === 400 || res.status === 401
      ? tipo === 'password' ? 'Email o contraseña incorrectos.' : 'La sesión venció. Volvé a ingresar.'
      : d.error_description ?? d.msg ?? 'No se pudo iniciar sesión.';
    throw new ErrorBase('base', d.error_code ?? String(res.status), texto);
  }
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? '',
    expiraEn: d.expires_at ?? Math.floor(Date.now() / 1000) + (d.expires_in ?? 3600),
    usuario: { id: d.user.id, email: d.user.email ?? '' },
  };
}

export async function ingresar(email: string, password: string): Promise<Sesion> {
  const s = await pedirToken('password', { email: email.trim(), password });
  establecer(s);
  return s;
}

let renovando: Promise<boolean> | null = null;

export async function renovar(): Promise<boolean> {
  if (!actual?.refreshToken) return false;
  renovando ??= pedirToken('refresh_token', { refresh_token: actual.refreshToken })
    .then((s) => {
      establecer(s);
      return true;
    })
    .catch((e) => {
      // Sin conexión: se conserva la sesión para reintentar. Token inválido: se cierra.
      if (!(e instanceof ErrorBase && e.tipo === 'red')) establecer(null);
      return false;
    })
    .finally(() => {
      renovando = null;
    });
  return renovando;
}

export async function salir(): Promise<void> {
  const s = actual;
  establecer(null);
  if (!s) return;
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY_PUBLICA(), Authorization: `Bearer ${s.accessToken}` },
    });
  } catch {
    /* la sesión local ya se cerró */
  }
}

/** Recupera la sesión guardada y la renueva si está por vencer. */
export async function restaurarSesion(): Promise<Sesion | null> {
  const s = leerGuardada();
  if (!s) return null;
  establecer(s);
  if (s.expiraEn - Date.now() / 1000 < 120) await renovar();
  return actual;
}

alVencerToken(renovar);

/**
 * ¿La base tiene usuarios y roles (supabase/05)? Se detecta por la tabla miembros.
 * Sin la 05 la app funciona como antes, sin login.
 */
export async function hayRoles(): Promise<boolean> {
  try {
    await db.select('miembros', 'select=rol&limit=1');
    return true;
  } catch (e) {
    if (e instanceof ErrorBase && (e.codigo === 'PGRST205' || e.codigo === '42P01')) return false;
    // Otro error (por ejemplo, sin conexión): se asume que sí, para no abrir la app sin protección
    if (e instanceof ErrorBase && e.tipo === 'red') throw e;
    return true;
  }
}

/** Almacén y rol del usuario con sesión. null si no pertenece a ningún almacén. */
export async function cargarPerfil(): Promise<Perfil | null> {
  const s = actual;
  if (!s) return null;
  const filas = await db.select<{ almacen_id: string; rol: Rol }>('miembros', `select=almacen_id,rol&user_id=eq.${s.usuario.id}`);
  if (filas.length === 0) return null;
  // Un usuario puede estar en varios almacenes; se usa el primero (selector: propuesta futura)
  const m = filas[0];
  const [a] = await db.select<{ nombre: string }>('almacenes', `select=nombre&id=eq.${m.almacen_id}`);
  return { almacenId: m.almacen_id, almacen: a?.nombre ?? 'Almacén', rol: m.rol };
}
