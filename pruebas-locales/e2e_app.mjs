// Prueba de punta a punta de la APP FINAL con login real (cuentas de evaluación) y permisos de la base.
// Base local: ./base_final.sh (01→04, datos de ejemplo, 05, cuentas, 06). App: compilada contra el servidor de
// prueba (VITE_SUPABASE_URL=http://localhost:8787) y servida por mini-postgrest (./servidor.sh). Uso: node e2e_app.mjs
// Requiere: npm i puppeteer-core @sparticuz/chromium (solo Linux) o adaptar a Playwright.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const BASE = 'http://localhost:8787/';
const res = []; const ok = (n, c, d = '') => { res.push({ n, ok: !!c, d: c ? '' : String(d).slice(0, 220) }); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 390, height: 844 } });
const p = await b.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept());
const ev = (fn, ...a) => p.evaluate(fn, ...a);
const until = async (fn, args = [], ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await p.evaluate(fn, ...args)) return true; } catch {} await sleep(150); } return false; };
const txt = () => ev(() => document.body.innerText);
const hasText = (s, ms) => until((s) => document.body.textContent.includes(s), [s], ms);
const click = async (texto, scope = 'body', sel = 'button,a,[role=tab]') => { const r = await ev((texto, scope, sel) => { const roots = scope === 'dialog' ? [...document.querySelectorAll('[role=dialog]')].reverse() : [document.querySelector(scope)]; const root = roots[0]; if (!root) return 'sin scope ' + scope; const els = roots.flatMap((r) => [...r.querySelectorAll(sel)]).filter((e) => e.offsetParent !== null && !e.disabled); const el = els.find((e) => e.innerText.trim() === texto) || els.find((e) => e.innerText.includes(texto)); if (!el) return 'no encontrado: ' + texto + ' · botones: ' + [...root.querySelectorAll(sel)].map((e) => e.textContent.trim() + (e.disabled ? '(off)' : '') + (e.offsetParent ? '' : '(oculto)')).filter(Boolean).slice(0, 12).join(' | ') + ' · dialogos: ' + [...document.querySelectorAll('[role=dialog]')].map((d) => d.getAttribute('aria-label') + '[' + [...d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).join('/') + ']').join(' ; '); el.click(); return 'ok'; }, texto, scope, sel); if (r !== 'ok') throw new Error(r); await sleep(250); };
const fill = async (sel, v) => { const r = await ev((sel, v) => { const el = document.querySelector(sel); if (!el) return 'no existe ' + sel; const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return 'ok'; }, sel, v); if (r !== 'ok') throw new Error(r); await sleep(120); };
const selectText = async (sel, t) => { const v = await ev((sel, t) => { const el = document.querySelector(sel); const o = el && [...el.options].find((o) => o.text.includes(t)); return o ? o.value : null; }, sel, t); if (v === null) throw new Error(`opción "${t}" no está en ${sel}`); await fill(sel, v); };
const selectFirst = async (sel) => { const v = await ev((sel) => { const el = document.querySelector(sel); const o = el && [...el.options].find((o) => o.value && !o.disabled); return o ? o.value : null; }, sel); if (!v) throw new Error('sin opciones en ' + sel); await fill(sel, v); return v; };
const api = (path, init = {}) => ev(async (path, init) => { const s = JSON.parse(localStorage.getItem('gondola.sesion') || 'null'); const tok = s?.access_token || s?.accessToken || s?.token; const h = { apikey: 'test', 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }; const r = await fetch('/rest/v1/' + path, { ...init, headers: h }); const t = await r.text(); return { s: r.status, b: t ? JSON.parse(t) : null }; }, path, init);
const ir = async (h) => { await p.goto(BASE + '#/' + h); await sleep(700); };
const paso = async (n, fn) => { try { await fn(); } catch (e) { ok(n, false, e.message); } };
const dlg = (label) => ev((label) => { const ds = [...document.querySelectorAll('[role=dialog]')]; const d = label ? ds.find((x) => (x.getAttribute('aria-label') || '').startsWith(label)) : ds.pop(); return d?.innerText || ''; }, label);
const stockDe = async (id) => (await api(`v_stock_presentacion?select=stock_actual&presentacion_id=eq.${id}`)).b?.[0]?.stock_actual;
const login = async (email) => { await ev(() => localStorage.removeItem('gondola.sesion')); await p.goto(BASE + '?r=' + Date.now()); await until(() => document.body.innerText.includes('Acceso rápido para evaluación'), [], 90000); await sleep(300); await click(email, 'body', 'button'); await until(() => !document.body.innerText.includes('Acceso rápido para evaluación'), [], 15000); await sleep(1000); };

await p.goto(BASE);
ok('La app pide ingresar y ofrece el acceso rápido para evaluación', await hasText('Acceso rápido para evaluación', 90000), (await txt()).slice(0, 200));
ok('Sin cartel de modo demo', !(await txt()).includes('MODO DEMO'));
await paso('Login dueña desde el acceso rápido', async () => { await login('duena.gondola@example.com'); const t = await txt(); ok('Login dueña desde el acceso rápido', !t.includes('Ingresá a tu almacén'), t.slice(0, 150)); });

await paso('Menú: "Stock" en lugar de "Contar"', async () => { await ir('mas'); await until(() => (document.querySelector('main')?.innerText || '').includes('Catálogo'), [], 15000); const t = await ev(() => (document.querySelector('nav')?.innerText || '') + ' | ' + (document.querySelector('main')?.innerText || '')); ok('Menú: "Stock" en lugar de "Contar"', t.includes('Stock') && !/\bContar\b/.test(t), t.replace(/\s+/g, ' ').slice(0, 200)); });
await paso('Pantalla del módulo: "Conteo de stock"', async () => { await ir('contar'); ok('Pantalla del módulo: "Conteo de stock"', await hasText('Conteo de stock'), (await txt()).slice(0, 200)); });

let pres500, pres1k;
await paso('A1 Crear ficha de producto con su primera presentación', async () => {
  await ir('catalogo'); await click('Nuevo'); await hasText('Nuevo producto');
  await fill('#alta-producto-nombre', 'Fideos Test'); await fill('#alta-nombre', '500 g'); await fill('#alta-punto', '5');
  await ev(() => document.querySelector('[role=dialog] fieldset.checklist input[type=checkbox]')?.click()); await sleep(150);
  await click('Crear producto', 'dialog'); await until(() => !document.querySelector('[role=dialog]'), [], 8000);
  const r = await api('productos?select=id,nombre&nombre=eq.Fideos%20Test'); ok('A1 Crear ficha de producto con su primera presentación', r.b?.length === 1, JSON.stringify(r).slice(0, 200));
});
await paso('A2 Agregar otra presentación a la misma ficha', async () => {
  await click('Nuevo'); await click('Agregar a uno existente', 'dialog'); await selectText('#alta-producto', 'Fideos Test');
  await fill('#alta-nombre', '1 kg'); await fill('#alta-punto', '3'); await ev(() => document.querySelector('[role=dialog] fieldset.checklist input[type=checkbox]')?.click());
  await click('Agregar presentación', 'dialog'); await until(() => !document.querySelector('[role=dialog]'), [], 8000);
  const prods = (await api('productos?select=id&nombre=eq.Fideos%20Test')).b; const pres = (await api(`presentaciones?select=id,nombre&producto_id=eq.${prods[0].id}`)).b;
  pres500 = pres.find((x) => x.nombre === '500 g')?.id; pres1k = pres.find((x) => x.nombre === '1 kg')?.id;
  ok('A2 Agregar otra presentación a la misma ficha', prods.length === 1 && pres.length === 2 && pres500 && pres1k, JSON.stringify({ prods, pres }).slice(0, 200));
});
await paso('A3 Catálogo: una sola ficha con 2 presentaciones', async () => {
  await ir('catalogo'); const n = await ev(() => [...document.querySelectorAll('[data-testid=producto-catalogo]')].filter((e) => e.innerText.includes('Fideos Test')).length);
  await click('Fideos Test', 'body', '[data-testid=producto-catalogo]'); await hasText('Presentaciones (2)', 5000);
  const np = await ev(() => document.querySelectorAll('[data-testid=presentacion-item]').length); ok('A3 Catálogo: una sola ficha con 2 presentaciones', n === 1 && np === 2, `fichas=${n} presentaciones=${np}`);
});
await paso('A4 Editar la ficha del producto', async () => { await fill('#ficha-nombre', 'Fideos Test Largos'); await click('Guardar cambios', 'dialog'); await sleep(900); const r = (await api('productos?select=nombre&nombre=eq.Fideos%20Test%20Largos')).b; ok('A4 Editar la ficha del producto', r?.length === 1, JSON.stringify(r)); });
await paso('A5 Editar una presentación', async () => {
  if (!(await ev(() => !!document.querySelector('[data-testid=presentacion-item]')))) { await ir('catalogo'); await click('Fideos Test Largos', 'body', '[data-testid=producto-catalogo]'); await sleep(400); }
  await ev(() => [...document.querySelectorAll('[data-testid=presentacion-item]')].find((e) => e.innerText.includes('1 kg')).querySelector('button').click()); await sleep(400); await fill('#ed-punto', '7');
  const btns = await ev(() => [...[...document.querySelectorAll('[role=dialog]')].pop().querySelectorAll('button')].map((b) => b.innerText.trim()).filter(Boolean)); await click(btns.find((t) => /Guardar/.test(t)) || 'Guardar', 'dialog'); await sleep(900);
  const r = (await api(`presentaciones?select=punto_pedido&id=eq.${pres1k}`)).b; await sleep(1500); const dl = await ev(() => [...document.querySelectorAll('[role=dialog]')].map((d) => d.getAttribute('aria-label') + '[' + [...d.querySelectorAll('button')].map((b) => b.textContent.trim()).filter(Boolean).join('/') + ']').join(' ; ')); ok('A5 Editar una presentación', r?.[0]?.punto_pedido == 7, JSON.stringify({ r, btns }).slice(0, 200)); });
await paso('A6 Impide duplicar la ficha base', async () => {
  await ir('catalogo'); await click('Nuevo'); await click('Producto nuevo', 'dialog'); await fill('#alta-producto-nombre', 'fideos test largos'); await fill('#alta-nombre', '2 kg'); await click('Crear producto', 'dialog'); await sleep(900);
  const t = await dlg('Nuevo producto'); const n = ((await api('productos?select=id,nombre')).b || []).filter((x) => /fideos/i.test(x.nombre));
  ok('A6 Impide duplicar la ficha base', /existe/i.test(t) && n?.length === 1, `dialogo="${t.replace(/\s+/g, ' ').slice(0, 140)}" fichas=${n?.length}`); await ir('hoy'); });

const filaId = (label) => ev((label) => { const li = [...document.querySelectorAll('[data-testid=fila-conteo]')].find((l) => l.querySelector('label')?.innerText.trim() === label && l.parentElement.closest('section,div,article')?.innerText.includes('Fideos Test Largos')); return li ? li.querySelector('input.contador-input').id : null; }, label);
const setIn = (id, v) => ev((id, v) => { const el = document.getElementById(id); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); }, id, v);
await paso('B1 Contar presentaciones sin elegir proveedor', async () => {
  await ir('contar'); await hasText('Fideos Test Largos'); const id5 = await filaId('500 g'), id1 = await filaId('1 kg'); if (!id5 || !id1) throw new Error('no encuentro las filas de conteo');
  const selects = await ev(() => document.querySelectorAll('main select').length); await setIn(id5, '8'); await setIn(id1, '4'); await sleep(400);
  ok('B1 Contar presentaciones sin elegir proveedor', selects === 0, `selectores en pantalla=${selects}`); });
await paso('B2 Conserva el conteo si se abandona', async () => { await ir('hoy'); await ir('contar'); await hasText('Fideos Test Largos'); const v = [await ev((i) => document.getElementById(i)?.value, await filaId('500 g')), await ev((i) => document.getElementById(i)?.value, await filaId('1 kg'))]; ok('B2 Conserva el conteo si se abandona', v[0] === '8' && v[1] === '4', JSON.stringify(v)); });
await paso('B3 Revisar diferencias y guardar (inventario inicial)', async () => { await click('Revisar y guardar'); const vis = await hasText('Revisá el conteo de stock', 5000); await click('Guardar conteo de stock', 'dialog'); await sleep(1500);
  const c = (await api(`conteos?select=tipo,cantidad,stock_registrado&presentacion_id=in.(${pres500},${pres1k})`)).b; const s5 = await stockDe(pres500);
  ok('B3 Revisar diferencias y guardar (inventario inicial)', vis && c?.length === 2 && c.every((x) => x.tipo === 'inicial') && s5 == 8, JSON.stringify({ vis, c, s5 }).slice(0, 220)); });
await paso('B4 Conteo periódico con diferencia → ajuste', async () => { await ir('contar'); await hasText('Fideos Test Largos'); await setIn(await filaId('500 g'), '6'); await sleep(300); await click('Revisar y guardar'); await hasText('Guardar conteo de stock', 8000); await sleep(400); const t = (await dlg('Revisá el conteo de stock')).replace(/\s+/g, ' ');
  await click('Guardar conteo de stock', 'dialog'); await sleep(1500); const c = (await api(`conteos?select=tipo,cantidad,stock_registrado&presentacion_id=eq.${pres500}&order=fecha_hora.desc&limit=1`)).b?.[0]; const s5 = await stockDe(pres500);
  ok('B4 Conteo periódico con diferencia → ajuste', /[−-]\s?2/.test(t) && c?.tipo === 'periodico' && c?.stock_registrado == 8 && s5 == 6, JSON.stringify({ revision: t.slice(0, 160), c, s5 })); });
await paso('B5 Historial de conteos', async () => { await ir('contar'); await hasText('Conteos de stock anteriores'); await ev(() => { const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.includes('Conteos de stock anteriores')); h.parentElement.querySelector('button.item-catalogo').click(); }); const v = await hasText('Conteo de stock del', 5000); const t = await dlg(); ok('B5 Historial de conteos', v && t.includes('500 g'), t.replace(/\s+/g, ' ').slice(0, 160)); await p.keyboard.press('Escape'); });

await paso('A7 Recepción manual por presentación', async () => { await ir('recepcion'); await click('Cargar a mano'); await hasText('Productos recibidos'); await selectFirst('#rec-proveedor'); await sleep(300);
  const sel = await ev(() => document.querySelector('select[id^="prod-"]')?.id); await selectText('#' + sel, 'Fideos Test Largos 1 kg'); const cant = await ev(() => document.querySelector('input[id^="cant-"]')?.id); await fill('#' + cant, '10');
  await click('Confirmar recepción'); await sleep(1800); const s1 = await stockDe(pres1k); ok('A7 Recepción manual por presentación', s1 == 14, `stock 1 kg=${s1} (esperado 4 + 10) · ${(await txt()).replace(/\s+/g, ' ').slice(0, 120)}`); });
await paso('A8 Lectura de remito (simulada) por presentación', async () => { await ir('recepcion'); await click('Usar remito de ejemplo'); await hasText('Productos recibidos', 20000); const n = await ev(() => document.querySelectorAll('[data-testid=linea-recepcion]').length); const op = await ev(() => document.querySelector('select[id^="prod-"]')?.options.length); ok('A8 Lectura de remito (simulada) por presentación', n > 0 && op > 1, `lineas=${n} opciones=${op}`); });
await paso('A9 Pedidos por presentación y mensaje de WhatsApp', async () => { await ir('pedidos'); await hasText('Proveedores y pedidos'); await ev(() => { const ts = [...document.querySelectorAll('[data-testid=tarjeta-proveedor]')]; (ts.find((t) => t.innerText.includes('Distribuidora Centro')) || ts[0]).querySelector('.boton-pedido').click(); }); await sleep(900);
  const items = await ev(() => [...document.querySelectorAll('[data-testid=item-pedido]')].map((e) => e.innerText.split('\n')[0])); const sep = items.filter((t) => /Coca-Cola (2,25 L|500 ml)|Fideos Test Largos (500 g|1 kg)/.test(t)).length;
  const bts = await ev(() => [...document.querySelectorAll('button')].filter((b) => b.offsetParent && !b.disabled).map((b) => b.textContent.trim())); const bm = bts.find((t) => /mensaje|WhatsApp/i.test(t) && !/Copiar/.test(t)); if (!bm) throw new Error('sin botón de mensaje: ' + bts.join(' | ').slice(0, 200)); await click(bm); await sleep(700); const msg = await ev(() => { const m = document.querySelector('[data-testid="mensaje-final"]'); return m?.value || m?.innerText || ''; }); const wa = await ev(() => document.querySelector('[data-testid="abrir-whatsapp"]')?.getAttribute('href') || '');
  ok('A9 Pedidos por presentación y mensaje de WhatsApp', sep >= 2 && msg.length > 10 && /wa\.me|whatsapp/.test(wa), JSON.stringify({ items: items.slice(0, 6), sep, msg: msg.slice(0, 80), wa: wa.slice(0, 30) })); await p.keyboard.press('Escape'); });

await paso('C1 Conteo con varias fechas de vencimiento (lotes)', async () => { await ir('contar'); await click('Perecederas'); await sleep(300); const id = await ev(() => document.querySelector('[data-testid=fila-conteo] input.contador-input')?.id); await setIn(id, '10'); await sleep(200);
  const hoy = new Date(); const f = (d) => new Date(hoy.getTime() + d * 864e5).toISOString().slice(0, 10);
  const btnLote = (txt) => ev((id, txt) => [...document.getElementById(id).closest('li').querySelectorAll('button')].find((b) => b.innerText.includes(txt))?.click(), id, txt);
  await btnLote('Cargar vencimiento'); await sleep(250); await btnLote('Otro vencimiento'); await sleep(250);
  const lot = await ev((id) => [...document.getElementById(id).closest('li').querySelectorAll('input')].filter((i) => i.type === 'date' || (i.getAttribute('aria-label') || '').startsWith('Cantidad que vence')).map((i) => (i.id || (i.id = 'x' + Math.random().toString(36).slice(2)))), id);
  if (lot.length !== 4) throw new Error('campos de lote=' + lot.length);
  await fill('#' + lot[0], f(2)); await fill('#' + lot[1], '4'); await fill('#' + lot[2], f(20)); await fill('#' + lot[3], '6');
  await click('Revisar y guardar'); await hasText('Guardar conteo de stock', 8000); await sleep(400); await click('Guardar conteo de stock', 'dialog'); await sleep(1500);
  const c = (await api(`conteos?select=lotes,presentacion_id&presentacion_id=eq.${id.replace('cant-', '')}&order=fecha_hora.desc&limit=1`)).b?.[0]; ok('C1 Conteo con varias fechas de vencimiento (lotes)', Array.isArray(c?.lotes) && c.lotes.length === 2, JSON.stringify(c).slice(0, 200)); });
await paso('C2 Dashboard: vencidos y próximos a vencer', async () => { await ir('vencimientos'); await sleep(900); const k = (await ev(() => document.querySelector('[data-testid="kpis-vencimientos"]')?.innerText || '')).replace(/\s+/g, ' '); const alertas = await ev(() => document.querySelectorAll('[data-testid="lote-alerta"]').length);
  ok('C2 Dashboard: vencidos y próximos a vencer', /vencid/i.test(k) && /3 d|semana/i.test(k) && alertas > 0, `${k.slice(0, 200)} · alertas=${alertas}`); });
let devPres, antes;
await paso('C3 Preparar remito de devolución (todavía no descuenta)', async () => { await ir('vencimientos?pestana=devoluciones'); await click('Nueva devolución'); await hasText('Mercadería a devolver'); await selectFirst('#dev-prov'); await sleep(300);
  const dp = await ev(() => document.querySelector('select[id^="dp-"]')?.id); devPres = await ev((dp) => [...document.getElementById(dp).options].find((o) => o.value && !o.disabled)?.value, dp); if (!devPres) throw new Error('sin presentaciones con stock para ese proveedor'); await fill('#' + dp, devPres); await sleep(300);
  const dc = await ev(() => document.querySelector('input[id^="dc-"]')?.id); await fill('#' + dc, '1'); await selectFirst('#dev-motivo');
  antes = await stockDe(devPres); await click('Preparar remito'); const rem = await until(() => !!document.querySelector('[data-testid="remito-devolucion"]'), [], 10000); await sleep(500); const d = (await api('devoluciones?select=estado,numero&order=numero.desc&limit=1')).b?.[0];
  ok('C3 Preparar remito de devolución (todavía no descuenta)', rem && d?.estado === 'preparada' && (await stockDe(devPres)) == antes, JSON.stringify({ rem, d, antes })); });
await paso('C4 Confirmar entrega: descuenta una sola vez', async () => { await click('Confirmar entrega al proveedor'); await sleep(400); await ev(() => document.querySelector('[data-testid="confirmar-accion"]')?.click()); await sleep(1500); const d = (await api('devoluciones?select=id,estado&order=numero.desc&limit=1')).b?.[0]; const s = await stockDe(devPres);
  const re = await api(`devoluciones?id=eq.${d.id}`, { method: 'PATCH', body: JSON.stringify({ estado: 'confirmada' }) }); const s2 = await stockDe(devPres);
  ok('C4 Confirmar entrega: descuenta una sola vez', d?.estado === 'confirmada' && s == antes - 1 && s2 == s, JSON.stringify({ d, antes, despues: s, reconfirmar: re.s, tras_reconfirmar: s2 })); });
await paso('C5 Registrar qué hizo el proveedor (trazable)', async () => { await click('Registrar qué hizo el proveedor'); await sleep(400); await selectFirst('#res-tipo'); await click('Guardar resolución'); await sleep(1500); const d = (await api('devoluciones?select=estado,numero,resolucion&order=numero.desc&limit=1')).b?.[0];
  await ir('vencimientos?pestana=devoluciones'); const enLista = await ev(() => document.querySelectorAll('[data-testid="item-devolucion"]').length);
  ok('C5 Registrar qué hizo el proveedor (trazable)', d?.estado === 'resuelta' && enLista > 0, JSON.stringify({ d, enLista })); });
await paso('C6 La baja es una operación aparte', async () => { const bajasAntes = (await api('bajas?select=id')).b.length; const devs = (await api('devoluciones?select=id')).b.length; await ir('vencimientos?pestana=bajas'); const t = await txt(); ok('C6 La baja es una operación aparte', t.includes('Nueva baja') && devs >= 1, `devoluciones=${devs} bajas=${bajasAntes}`); });

await paso('Empleado ve "Stock" en su barra', async () => { await login('empleado.gondola@example.com'); const nav = (await ev(() => document.querySelector('nav')?.innerText || '')).replace(/\s+/g, ' '); ok('Empleado ve "Stock" en su barra', nav.includes('Stock') && !nav.includes('Contar'), nav); });
ok('Sin errores de JavaScript en la página', errs.length === 0, errs.join(' | '));
await b.close();
console.log(res.map((r) => `${r.ok ? 'PASA ' : 'FALLA'} · ${r.n}${r.d ? ' → ' + r.d : ''}`).join('\n'));
console.log(`\n${res.filter((r) => r.ok).length}/${res.length} pasan`);
