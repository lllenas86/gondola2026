// Servidor de PRUEBA que imita la parte de la API REST de Supabase (PostgREST) que usa Góndola.
// Ejecuta todo con el rol "anon" para respetar RLS y permisos como en producción.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

pg.types.setTypeParser(1700, (v) => parseFloat(v));
pg.types.setTypeParser(1082, (v) => v); // date: igual que PostgREST (AAAA-MM-DD)
pg.types.setTypeParser(1184, (v) => new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')).toISOString()); // timestamptz en ISO
const pool = new pg.Pool({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.DB || 'gondola' });
pool.on('error', () => {}); // conexiones cerradas al recrear la base de prueba
const DIST = process.env.DIST || '/home/claude/work/app/dist';
const PORT = Number(process.env.PORT || 8787);
const q = (s) => '"' + s.replace(/"/g, '""') + '"';
let tipos = null;
async function tiposColumnas(c) {
  if (tipos) return tipos;
  const r = await c.query(`select table_name, column_name, data_type from information_schema.columns where table_schema='public'`);
  tipos = {};
  for (const x of r.rows) (tipos[x.table_name] ??= {})[x.column_name] = x.data_type;
  return tipos;
}
function valor(t, col, v) {
  const dt = tipos?.[t]?.[col];
  if ((dt === 'jsonb' || dt === 'json') && v !== null) return JSON.stringify(v);
  return v;
}
function filtros(params, args) {
  const conds = [];
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict', 'offset'].includes(k)) continue;
    const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|in|is)\.(.*)$/s.exec(raw);
    if (!m) throw Object.assign(new Error('filtro no soportado ' + raw), { code: 'PGRST100' });
    const [, not, op, v] = m;
    let c;
    if (op === 'in') {
      const items = v.replace(/^\(|\)$/g, '').split(',').map((s) => s.replace(/^"|"$/g, ''));
      args.push(items); c = `${q(k)}::text = any($${args.length}::text[])`;
    } else if (op === 'is') c = `${q(k)} is ${v === 'null' ? 'null' : v === 'true' ? 'true' : 'false'}`;
    else { const ops = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }; args.push(v); c = `${q(k)}::text ${ops[op]} $${args.length}::text`;
      if (op !== 'eq' && op !== 'neq') c = `${q(k)} ${ops[op]} $${args.length}`; }
    conds.push(not ? `not (${c})` : c);
  }
  return conds.length ? ' where ' + conds.join(' and ') : '';
}
// Token de prueba: header.payload.firma (sin verificar: SOLO pruebas locales)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function claimsDe(req) {
  const a = req.headers['authorization'] || '';
  const t = a.startsWith('Bearer ') ? a.slice(7) : '';
  const partes = t.split('.');
  if (partes.length !== 3) return null;
  try {
    const c = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
    if (!c.sub) return null;
    if (c.exp && c.exp < Date.now() / 1000) return { vencido: true };
    return c;
  } catch { return null; }
}
let reqActual = null;
async function ejecutar(fn) {
  const c = await pool.connect();
  const claims = reqActual ? claimsDe(reqActual) : null;
  if (claims?.vencido) { c.release(); throw Object.assign(new Error('JWT expired'), { code: 'PGRST301', status: 401 }); }
  try {
    await c.query('begin');
    if (claims) {
      await c.query('set local role authenticated');
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    } else await c.query('set local role anon');
    await tiposColumnas(c);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}
async function rest(req, url, body) {
  const partes = url.pathname.replace(/^\/rest\/v1\//, '').split('/');
  const p = url.searchParams;
  const prefer = req.headers['prefer'] || '';
  if (partes[0] === 'rpc') {
    const fn = partes[1];
    const keys = Object.keys(body || {});
    return ejecutar(async (c) => {
      const r = await c.query(`select * from ${q(fn)}(${keys.map((k, i) => `${q(k)} => $${i + 1}`).join(', ')})`, keys.map((k) => typeof body[k] === 'object' && body[k] !== null ? JSON.stringify(body[k]) : body[k]));
      if (r.fields.length === 1 && r.fields[0].name === fn) { const v = r.rows[0]?.[fn]; return v === undefined ? null : v; }
      return r.rows;
    });
  }
  const t = partes[0];
  if (req.method === 'GET') {
    const args = [];
    const sel = (p.get('select') || '*').split(',').map((s) => (s === '*' ? '*' : q(s))).join(',');
    let sql = `select ${sel} from ${q(t)}` + filtros(p, args);
    if (p.get('order')) sql += ' order by ' + p.get('order').split(',').map((o) => { const [col, dir] = o.split('.'); return `${q(col)} ${dir === 'desc' ? 'desc' : 'asc'}`; }).join(', ');
    if (p.get('limit')) sql += ` limit ${Number(p.get('limit'))}`;
    return ejecutar(async (c) => (await c.query(sql, args)).rows);
  }
  if (req.method === 'POST') {
    const filas = Array.isArray(body) ? body : [body];
    if (filas.length === 0) return [];
    return ejecutar(async (c) => {
      const out = [];
      for (const f of filas) {
        const cols = Object.keys(f);
        let sql = cols.length ? `insert into ${q(t)} (${cols.map(q).join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})` : `insert into ${q(t)} default values`;
        if (p.get('on_conflict') && prefer.includes('ignore-duplicates')) sql += ` on conflict (${p.get('on_conflict').split(',').map(q).join(',')}) do nothing`;
        sql += ' returning *';
        out.push(...(await c.query(sql, cols.map((k) => valor(t, k, f[k])))).rows);
      }
      return prefer.includes('return=minimal') ? null : out;
    });
  }
  if (req.method === 'PATCH') {
    const cols = Object.keys(body);
    const args = cols.map((k) => valor(t, k, body[k]));
    const sql = `update ${q(t)} set ${cols.map((k, i) => `${q(k)} = $${i + 1}`).join(', ')}` + filtros(p, args) + ' returning *';
    return ejecutar(async (c) => (await c.query(sql, args)).rows);
  }
  if (req.method === 'DELETE') {
    const args = [];
    return ejecutar(async (c) => { await c.query(`delete from ${q(t)}` + filtros(p, args), args); return null; });
  }
}
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let raw = '';
  for await (const ch of req) raw += ch;
  const body = raw ? JSON.parse(raw) : null;
  reqActual = req;
  try {
    if (url.pathname === '/auth/v1/token') {
      const tipo = url.searchParams.get('grant_type');
      let u = null;
      if (tipo === 'password') {
        const r = await pool.query('select id, email from auth.users where lower(email)=lower($1) and password_prueba=$2', [body.email, body.password]);
        u = r.rows[0];
      } else if (tipo === 'refresh_token') {
        const r = await pool.query('select id, email from auth.users where id::text=$1', [String(body.refresh_token).replace('refresh-', '')]);
        u = r.rows[0];
      }
      if (!u) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"invalid_grant","error_description":"Invalid login credentials"}'); }
      const exp = Math.floor(Date.now() / 1000) + Number(process.env.TTL || 3600);
      const token = `${b64({ alg: 'none' })}.${b64({ sub: u.id, email: u.email, role: 'authenticated', exp })}.prueba`;
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ access_token: token, refresh_token: `refresh-${u.id}`, expires_in: Number(process.env.TTL || 3600), expires_at: exp, user: { id: u.id, email: u.email } }));
    }
    if (url.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
    if (url.pathname.startsWith('/rest/v1/')) {
      const r = await rest(req, url, body);
      res.writeHead(r === null ? 204 : 200, { 'content-type': 'application/json' });
      return res.end(r === null ? '' : JSON.stringify(r));
    }
    if (url.pathname === '/api/leer-remito') {
      // Simulación de la IA para pruebas: devuelve el remito de prueba configurado
      const f = '/home/claude/work/test/remito-ia.json';
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(fs.existsSync(f) ? fs.readFileSync(f) : '{"lineas":[]}');
    }
    if (url.pathname.startsWith('/storage/')) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"sin bucket en pruebas"}'); }
    let file = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  } catch (e) {
    const status = e.status || (e.code === '42501' ? 403 : e.code === '42P01' ? 404 : 400);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: e.code === '42P01' ? 'PGRST205' : e.code || 'XX', message: e.message, details: e.detail ?? null }));
  }
}).listen(PORT, () => console.log('mini-postgrest en', PORT));
