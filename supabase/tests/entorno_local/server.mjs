// Imitación mínima de PostgREST (solo lo que usa Góndola) para pruebas locales.
import http from 'node:http';
import pg from 'pg';
pg.types.setTypeParser(1082, (v) => v); pg.types.setTypeParser(20, Number); pg.types.setTypeParser(1700, Number);
const pool = new pg.Pool({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.DB || 'g' });
const q = (s) => '"' + s.replace(/"/g, '""') + '"';
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function filtros(params, vals) {
  const w = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    const m = v.match(/^(eq|neq|gt|gte|lt|lte|in|is)\.(.*)$/s);
    if (!m) throw Object.assign(new Error('filtro no soportado ' + k), { code: 'PGRST100' });
    if (m[1] === 'in') {
      const items = m[2].replace(/^\(|\)$/g, '').split(',');
      w.push(`${q(k)}::text in (${items.map((it) => { vals.push(it); return '$' + vals.length; }).join(',')})`);
    } else if (m[1] === 'is') {
      w.push(`${q(k)} is ${m[2] === 'null' ? 'null' : m[2]}`);
    } else { vals.push(m[2]); w.push(`${q(k)}::text ${OPS[m[1]]} $${vals.length}::text`); }
  }
  return w.length ? ' where ' + w.join(' and ') : '';
}

async function run(sql, vals) {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query('set local role anon');
    const r = await c.query(sql, vals);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
}

pool.on('error', () => {});
http.createServer(async (req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, 'http://x');
  let body = ''; for await (const ch of req) body += ch;
  const send = (st, obj) => { res.writeHead(st, { ...cors, 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
  try {
    if (!url.pathname.startsWith('/rest/v1/')) return send(404, { message: 'no' });
    const path = url.pathname.slice('/rest/v1/'.length);
    const prefer = req.headers['prefer'] || '';
    const vals = [];
    if (path.startsWith('rpc/')) {
      const fn = path.slice(4); const args = body ? JSON.parse(body) : {};
      const parts = Object.entries(args).map(([k, v]) => { vals.push(v === null ? null : typeof v === 'object' ? JSON.stringify(v) : v); return `${q(k)} := $${vals.length}`; });
      const r = await run(`select ${q(fn)}(${parts.join(',')}) as r`, vals);
      return send(200, r.rows[0]?.r ?? null);
    }
    const t = q(path);
    if (req.method === 'GET') {
      const sel = url.searchParams.get('select') || '*';
      const cols = sel === '*' ? '*' : sel.split(',').map(q).join(',');
      let sql = `select ${cols} from ${t}` + filtros(url.searchParams, vals);
      const ord = url.searchParams.get('order');
      if (ord) sql += ' order by ' + ord.split(',').map((o) => { const [c, ...m] = o.split('.'); return q(c) + ' ' + m.map((x) => x === 'nullslast' ? 'nulls last' : x === 'nullsfirst' ? 'nulls first' : x).join(' '); }).join(',');
      if (url.searchParams.get('limit')) sql += ' limit ' + Number(url.searchParams.get('limit'));
      const r = await run(sql, vals);
      return send(200, r.rows);
    }
    if (req.method === 'POST') {
      const filas = [].concat(JSON.parse(body));
      if (filas.length === 0) return send(201, []);
      const keys = [...new Set(filas.flatMap((f) => Object.keys(f)))];
      vals.push(JSON.stringify(filas));
      let sql = `insert into ${t} (${keys.map(q).join(',')}) select ${keys.map(q).join(',')} from json_populate_recordset(null::${t}, $1)`;
      if (prefer.includes('ignore-duplicates')) sql += ` on conflict (${url.searchParams.get('on_conflict').split(',').map(q).join(',')}) do nothing`;
      sql += ' returning *';
      const r = await run(sql, vals);
      return send(201, prefer.includes('return=representation') ? r.rows : undefined);
    }
    if (req.method === 'PATCH') {
      const obj = JSON.parse(body); const keys = Object.keys(obj);
      vals.push(JSON.stringify(obj));
      const sql = `update ${t} set (${keys.map(q).join(',')}) = (select ${keys.map(q).join(',')} from json_populate_record(null::${t}, $1))` + filtros(url.searchParams, vals) + ' returning *';
      const r = await run(keys.length === 1 ? sql.replace(/set \((.*?)\) = \(select (.*?) from/, 'set $1 = (select $2 from') : sql, vals);
      return send(200, r.rows);
    }
    if (req.method === 'DELETE') {
      await run(`delete from ${t}` + filtros(url.searchParams, vals), vals);
      return send(204);
    }
    send(405, { message: 'metodo' });
  } catch (e) {
    send(e.code === '42501' ? 403 : 400, { code: e.code, message: e.message, details: e.detail ?? null });
  }
}).listen(54321, () => console.log('shim en :54321'));
