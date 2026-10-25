// MODO DEMO · Base de prueba dentro del navegador (no se conecta a Supabase).
//
// Corre las mismas migraciones de supabase/ (01 → 05) en PGlite (PostgreSQL compilado
// para el navegador) y atiende los pedidos de la app imitando la API de Supabase.
// Los datos quedan guardados solo en este navegador (IndexedDB) y se pueden reiniciar.
// El login es SIMULADO (tokens sin firma) y la lectura de remitos es SIMULADA (sin IA).
import { PGlite } from '@electric-sql/pglite';
import stub from '../../pruebas-locales/00_stub_supabase.sql?raw';
import s01 from '../../supabase/01_esquema.sql?raw';
import s02 from '../../supabase/02_datos_ejemplo.sql?raw';
import s03 from '../../supabase/03_pedido_y_demo.sql?raw';
import s04 from '../../supabase/04_presentaciones_lotes_devoluciones.sql?raw';
import s05 from '../../supabase/05_roles_y_almacenes.sql?raw';
import { REMITOS_EJEMPLO } from './remitos';

export const DEMO_URL = 'https://demo.gondola.invalid';
export const DEMO_KEY = 'demo-sin-clave';
const IDB = 'gondola-demo-v1';
import { CLAVE_DEMO, USUARIOS_DEMO } from './usuarios';
export { CLAVE_DEMO, USUARIOS_DEMO };

const iso = (v: string) => new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString();
let db: PGlite;
let tipos: Record<string, Record<string, string>> = {};

async function comoUsuario<T>(email: string, fn: (tx: PGlite | any) => Promise<T>): Promise<T> {
  const u = (await db.query<{ id: string }>('select id from auth.users where email = $1', [email])).rows[0];
  return db.transaction(async (tx) => {
    await tx.query('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u.id, role: 'authenticated' })]);
    return fn(tx);
  });
}

async function crearBase() {
  for (const sql of [stub, s01, s02, s03, s04, s05]) await db.exec(sql);
  const vals = USUARIOS_DEMO.map((u) => `('${u.email}','${CLAVE_DEMO}')`).join(',');
  await db.exec(`insert into auth.users (email, password_prueba) values ${vals};`);
  await db.query('select gondola_asignar_primer_dueno($1)', ['duena@demo.ar']);
  await comoUsuario('duena@demo.ar', async (tx) => {
    await tx.query("select gondola_guardar_miembro('encargado@demo.ar', 'encargado')");
    await tx.query("select gondola_guardar_miembro('empleado@demo.ar', 'empleado')");
    await tx.query('select gondola_restablecer_demo()');
  });
  await db.exec('create table if not exists public._demo_lista (ok boolean)');
}

async function iniciar() {
  db = new PGlite(typeof indexedDB === 'undefined' ? 'memory://' : `idb://${IDB}`, {
    parsers: {
      1700: (v: string) => parseFloat(v),
      1082: (v: string) => v,
      1184: (v: string) => iso(v),
      1114: (v: string) => v.replace(' ', 'T'),
    },
  });
  await db.waitReady;
  const lista = (await db.query<{ r: string | null }>("select to_regclass('public._demo_lista')::text as r")).rows[0].r;
  if (!lista) await crearBase();
  const r = await db.query<{ table_name: string; column_name: string; data_type: string }>(
    "select table_name, column_name, data_type from information_schema.columns where table_schema='public'",
  );
  tipos = {};
  for (const x of r.rows) (tipos[x.table_name] ??= {})[x.column_name] = x.data_type;
}

const q = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const valor = (t: string, col: string, v: unknown) => {
  const dt = tipos[t]?.[col];
  return (dt === 'jsonb' || dt === 'json') && v !== null && v !== undefined ? JSON.stringify(v) : v;
};
class ErrorApi extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function filtros(params: URLSearchParams, args: unknown[]) {
  const conds: string[] = [];
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) continue;
    const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|in|is)\.(.*)$/s.exec(raw);
    if (!m) throw new ErrorApi(400, 'PGRST100', 'filtro no soportado ' + raw);
    const [, not, op, v] = m;
    let c: string;
    if (op === 'in') {
      const items = v.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      args.push(items);
      c = `${q(k)}::text = any($${args.length}::text[])`;
    } else if (op === 'is') c = `${q(k)} is ${v === 'null' ? 'null' : v === 'true' ? 'true' : 'false'}`;
    else {
      const ops: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      args.push(v);
      c = op === 'eq' || op === 'neq' ? `${q(k)}::text ${ops[op]} $${args.length}::text` : `${q(k)} ${ops[op]} $${args.length}`;
    }
    conds.push(not ? `not (${c})` : c);
  }
  return conds.length ? ' where ' + conds.join(' and ') : '';
}

const b64 = (o: object) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function claimsDe(h: Headers): { sub: string; exp?: number } | null | 'vencido' {
  const a = h.get('authorization') || '';
  const partes = (a.startsWith('Bearer ') ? a.slice(7) : '').split('.');
  if (partes.length !== 3) return null;
  try {
    const c = JSON.parse(decodeURIComponent(escape(atob(partes[1].replace(/-/g, '+').replace(/_/g, '/')))));
    if (!c.sub) return null;
    if (c.exp && c.exp < Date.now() / 1000) return 'vencido';
    return c;
  } catch {
    return null;
  }
}

async function ejecutar<T>(h: Headers, fn: (tx: any) => Promise<T>): Promise<T> {
  const claims = claimsDe(h);
  if (claims === 'vencido') throw new ErrorApi(401, 'PGRST301', 'JWT expired');
  return db.transaction(async (tx) => {
    if (claims) {
      await tx.query('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    } else await tx.query('set local role anon');
    return fn(tx);
  });
}

async function rest(method: string, url: URL, h: Headers, body: any): Promise<unknown> {
  const partes = url.pathname.replace(/^\/rest\/v1\//, '').split('/');
  const p = url.searchParams;
  const prefer = h.get('prefer') || '';
  if (partes[0] === 'rpc') {
    const fn = partes[1];
    const keys = Object.keys(body || {});
    return ejecutar(h, async (tx) => {
      const r = await tx.query(
        `select * from ${q(fn)}(${keys.map((k, i) => `${q(k)} => $${i + 1}`).join(', ')})`,
        keys.map((k) => (typeof body[k] === 'object' && body[k] !== null ? JSON.stringify(body[k]) : body[k])),
      );
      if (r.fields.length === 1 && r.fields[0].name === fn) {
        const v = r.rows[0]?.[fn];
        return v === undefined ? null : v;
      }
      return r.rows;
    });
  }
  const t = partes[0];
  if (method === 'GET') {
    const args: unknown[] = [];
    const sel = (p.get('select') || '*').split(',').map((s) => (s === '*' ? '*' : q(s))).join(',');
    let sql = `select ${sel} from ${q(t)}` + filtros(p, args);
    const order = p.get('order');
    if (order) sql += ' order by ' + order.split(',').map((o) => { const [col, dir] = o.split('.'); return `${q(col)} ${dir === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
    if (p.get('limit')) sql += ` limit ${Number(p.get('limit'))}`;
    return ejecutar(h, async (tx) => (await tx.query(sql, args)).rows);
  }
  if (method === 'POST') {
    const filas = Array.isArray(body) ? body : [body];
    if (filas.length === 0) return [];
    return ejecutar(h, async (tx) => {
      const out: unknown[] = [];
      for (const f of filas) {
        const cols = Object.keys(f);
        let sql = cols.length
          ? `insert into ${q(t)} (${cols.map(q).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`
          : `insert into ${q(t)} default values`;
        const oc = p.get('on_conflict');
        if (oc && prefer.includes('ignore-duplicates')) sql += ` on conflict (${oc.split(',').map(q).join(',')}) do nothing`;
        sql += ' returning *';
        out.push(...(await tx.query(sql, cols.map((k) => valor(t, k, f[k])))).rows);
      }
      return prefer.includes('return=minimal') ? null : out;
    });
  }
  if (method === 'PATCH') {
    const cols = Object.keys(body);
    const args = cols.map((k) => valor(t, k, body[k]));
    const sql = `update ${q(t)} set ${cols.map((k, i) => `${q(k)} = $${i + 1}`).join(', ')}` + filtros(p, args) + ' returning *';
    return ejecutar(h, async (tx) => (await tx.query(sql, args)).rows);
  }
  if (method === 'DELETE') {
    const args: unknown[] = [];
    return ejecutar(h, async (tx) => {
      await tx.query(`delete from ${q(t)}` + filtros(p, args), args);
      return null;
    });
  }
  throw new ErrorApi(405, 'XX', 'método no soportado');
}

const json = (status: number, cuerpo: unknown) =>
  new Response(cuerpo === null ? null : JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

let turnoRemito = 0;
async function atender(url: URL, init: RequestInit): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const h = new Headers(init.headers);
  let body: any = null;
  if (typeof init.body === 'string' && init.body) body = JSON.parse(init.body);
  try {
    if (url.pathname === '/auth/v1/token') {
      const tipo = url.searchParams.get('grant_type');
      let u: { id: string; email: string } | undefined;
      if (tipo === 'password') {
        u = (await db.query<{ id: string; email: string }>('select id, email from auth.users where lower(email)=lower($1) and password_prueba=$2', [body?.email ?? '', body?.password ?? ''])).rows[0];
      } else if (tipo === 'refresh_token') {
        u = (await db.query<{ id: string; email: string }>('select id, email from auth.users where id::text=$1', [String(body?.refresh_token ?? '').replace('refresh-', '')])).rows[0];
      }
      if (!u) return json(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      const exp = Math.floor(Date.now() / 1000) + 3600 * 12;
      const token = `${b64({ alg: 'none' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp })}.demo`;
      return json(200, { access_token: token, refresh_token: `refresh-${u.id}`, expires_in: 3600 * 12, expires_at: exp, user: { id: u.id, email: u.email } });
    }
    if (url.pathname === '/auth/v1/logout') return new Response(null, { status: 204 });
    if (url.pathname.startsWith('/rest/v1/')) {
      const r = await rest(method, url, h, body);
      return r === null ? new Response(null, { status: 204 }) : json(200, r);
    }
    if (url.pathname.startsWith('/storage/')) return json(400, { error: 'En el modo demo no se guardan fotos' });
    return json(404, { message: 'no existe en la demo' });
  } catch (e: any) {
    const status = e.status || (e.code === '42501' ? 403 : e.code === '42P01' ? 404 : 400);
    return json(status, { code: e.code === '42P01' ? 'PGRST205' : e.code || 'XX', message: e.message, details: e.detail ?? null });
  }
}

/** Lectura de remito SIMULADA: devuelve, por turnos, la "lectura" de los remitos de ejemplo. */
function leerRemitoSimulado(): Response {
  const r = REMITOS_EJEMPLO[turnoRemito++ % REMITOS_EJEMPLO.length];
  const x = r.extraccion(new Date());
  return json(200, {
    proveedor: x.proveedor,
    fecha: x.fecha,
    lineas: x.lineas.map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, fecha_vencimiento: l.fechaVencimiento ?? null, confianza: l.confianzaLectura })),
    simulado: true,
  });
}

let cola: Promise<unknown> = Promise.resolve();
/** Una sola pestaña usa la base de la demo a la vez (dos copias de PGlite sobre la misma base guardada se pisan). */
async function conCandado(avisoEspera: () => void): Promise<void> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return iniciar();
  await new Promise<void>((listo, fallo) => {
    const t = window.setTimeout(avisoEspera, 2500);
    void locks.request('gondola-demo-base', async () => {
      window.clearTimeout(t);
      try {
        await iniciar();
        listo();
      } catch (e) {
        fallo(e);
        return;
      }
      await new Promise(() => undefined); // se mantiene mientras la pestaña esté abierta
    });
  });
}

export async function instalar(avisoEspera: () => void = () => undefined) {
  await conCandado(avisoEspera);
  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, globalThis.location?.href ?? 'http://localhost/');
    if (url.origin === DEMO_URL) {
      const p = cola.then(() => atender(url, init));
      cola = p.catch(() => undefined);
      return p;
    }
    if (url.pathname === '/api/leer-remito') return new Promise((ok) => setTimeout(() => ok(leerRemitoSimulado()), 900));
    return original(input, init);
  };
}

/** Borra la base de la demo de este navegador y vuelve a empezar. */
export async function reiniciarDemo() {
  try {
    await db?.close();
  } catch {
    /* nada */
  }
  try {
    localStorage.removeItem('gondola.sesion');
  } catch {
    /* nada */
  }
  await new Promise<void>((ok) => {
    const r = indexedDB.deleteDatabase(`/pglite/${IDB}`);
    r.onsuccess = r.onerror = r.onblocked = () => ok();
  });
  window.location.reload();
}
