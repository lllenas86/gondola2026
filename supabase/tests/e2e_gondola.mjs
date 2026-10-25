// Prueba de punta a punta de las 3 correcciones contra la base LOCAL de prueba (nunca producción).
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('/home/claude/.npm-global/lib/node_modules/playwright');
import pg from '/home/claude/test/shim/node_modules/pg/lib/index.js';

pg.types.setTypeParser(1082, (v) => v); pg.types.setTypeParser(20, Number); pg.types.setTypeParser(1700, Number);
const db = new pg.Pool({ host: '/tmp', port: 5433, user: 'postgres', database: 'e2e' });
const q1 = async (sql, v = []) => (await db.query(sql, v)).rows[0];
const stock = async (nombre) => (await q1(`select stock_actual s from v_stock_actual where nombre = $1`, [nombre]))?.s;
const iso = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }); };

const res = [];
let n = 0;
async function paso(nombre, fn) {
  n++;
  try { await fn(); res.push(`OK   ${n}. ${nombre}`); }
  catch (e) { res.push(`FAIL ${n}. ${nombre}: ${e.message.split('\n')[0]}`); await page.screenshot({ path: `/home/claude/test/fail-${n}.png`, fullPage: true }); throw e; }
}
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-AR', timezoneId: 'America/Argentina/Buenos_Aires', acceptDownloads: true });
const page = await ctx.newPage();
const errores = [];
page.on('pageerror', (e) => errores.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errores.push('console: ' + m.text()); });
const ir = async (hash) => { await page.goto('http://localhost:5173/#/' + hash); await page.waitForSelector('.nav-inferior'); await page.waitForTimeout(400); };
const hoja = () => page.locator('.hoja').last();

try {
  await paso('La app carga y el menú dice «Stock» (no «Contar»)', async () => {
    await ir('hoy');
    await page.getByRole('heading', { name: /Te falta pedir/ }).waitFor();
    eq(await page.locator('.nav-inferior').getByText('Stock', { exact: true }).count(), 1, 'Stock en el menú');
    eq(await page.locator('.nav-inferior').getByText('Contar', { exact: true }).count(), 0, 'Contar en el menú');
  });

  await paso('Migración: cada producto existente es presentación «Única» de su ficha', async () => {
    const r = await q1(`select count(*) n, count(*) filter (where presentacion = 'Única' and unidades_por_presentacion = 1) u, count(distinct ficha_id) f from productos`);
    eq(r.n, r.u, 'todas Única'); eq(r.f, r.n, 'una ficha por producto (sin fusiones)');
  });

  // ---------- Corrección 1 ----------
  await paso('Catálogo: crear producto con dos presentaciones (473 ml y 1 L)', async () => {
    await ir('catalogo');
    await page.getByRole('button', { name: /Nuevo/ }).click();
    await page.getByLabel('Nombre del producto').fill('Cerveza Quilmes');
    const h = hoja();
    await h.locator('input[id^="pres-"]').first().fill('473 ml');
    await h.locator('input[id^="cont-"]').first().fill('473');
    await h.getByLabel('Unidad del tamaño').first().selectOption('ml');
    await h.locator('input[id^="pp-"]').first().fill('6');
    await h.locator('.presentacion').first().getByText('Distribuidora Centro').click();
    await h.getByRole('button', { name: 'Agregar presentación' }).click();
    await h.locator('input[id^="pres-"]').nth(1).fill('1 L');
    await h.locator('input[id^="cont-"]').nth(1).fill('1');
    await h.getByLabel('Unidad del tamaño').nth(1).selectOption('l');
    await h.locator('input[id^="pp-"]').nth(1).fill('4');
    await h.locator('.presentacion').nth(1).getByText('Mayorista Rosario').click();
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await page.getByText('Producto creado.').waitFor();
    const r = await q1(`select count(*) n, count(distinct ficha_id) f, string_agg(nombre, ' | ' order by nombre) nombres from productos where ficha_id = (select id from fichas_producto where nombre = 'Cerveza Quilmes')`);
    eq(r.n, 2, 'presentaciones'); eq(r.f, 1, 'misma ficha'); eq(r.nombres, 'Cerveza Quilmes 1 L | Cerveza Quilmes 473 ml', 'nombres');
    const pp = await q1(`select count(*) n from producto_proveedor pp join productos p on p.id = pp.producto_id where p.nombre like 'Cerveza Quilmes%'`);
    eq(pp.n, 2, 'proveedor por presentación');
    await page.locator('.item-catalogo', { hasText: 'Cerveza Quilmes' }).getByText('473 ml').waitFor();
  });

  await paso('Catálogo: consultar y editar ambas presentaciones', async () => {
    await page.locator('.item-catalogo', { hasText: 'Cerveza Quilmes' }).click();
    const h = hoja();
    await h.locator('input[id^="pp-"]').nth(0).fill('8');
    await h.locator('input[id^="pp-"]').nth(1).fill('5');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.getByText('Producto actualizado.').waitFor();
    const r = await q1(`select string_agg(punto_pedido::text, ',' order by nombre) v from productos where nombre like 'Cerveza Quilmes%'`);
    eq(r.v, '5,8', 'puntos de pedido editados');
  });

  // ---------- Corrección 2 ----------
  const lecheAntes = await stock('Leche entera 1 L');
  await paso('Stock: conteo sin elegir proveedor, con diferencias y dos lotes', async () => {
    await ir('stock');
    await page.getByRole('heading', { name: 'Conteo de stock' }).waitFor();
    eq(await page.locator('.fila-conteo').count() >= 8, true, 'se listan todas las presentaciones sin proveedor');
    const fila = (t) => page.locator('.fila-conteo', { hasText: t });
    await fila('Cerveza Quilmes 473 ml').locator('.contador-input').fill('24');
    await fila('Cerveza Quilmes 1 L').locator('.contador-input').fill('10');
    const leche = fila('Leche entera 1 L');
    await leche.locator('.contador-input').first().fill('10');
    await leche.locator('input[type=date]').first().fill(iso(-2));
    await leche.getByRole('button', { name: /Otro lote/ }).click();
    await leche.locator('.contador-input').nth(1).fill('15');
    await leche.locator('input[type=date]').nth(1).fill(iso(3));
    await page.getByRole('button', { name: /Revisar diferencias/ }).click();
    await page.getByText('Revisá antes de guardar').waitFor();
    const filaLeche = page.locator('.tabla-diferencias tr', { hasText: 'Leche entera' });
    const dif = 25 - lecheAntes;
    eq((await filaLeche.locator('td').nth(3).innerText()).trim(), dif === 0 ? 'OK' : `${dif > 0 ? '+' : ''}${dif}`, 'diferencia mostrada antes de confirmar');
    await page.getByRole('button', { name: 'Confirmar conteo' }).click();
    await page.getByText(/Conteo guardado/).waitFor();
    eq(await stock('Cerveza Quilmes 473 ml'), 24, 'stock 473 ml');
    eq(await stock('Cerveza Quilmes 1 L'), 10, 'stock 1 L (diferenciado)');
    eq(await stock('Leche entera 1 L'), 25, 'stock leche = suma de lotes');
    const s = await q1(`select s.tipo, count(*) filas, max(c.stock_esperado) filter (where p.nombre = 'Leche entera 1 L') esperado from sesiones_conteo s join conteos c on c.sesion_id = s.id join productos p on p.id = c.producto_id group by s.id, s.tipo order by s.creada_en desc limit 1`);
    eq(s.tipo, 'periodico', 'tipo'); eq(s.filas, 4, 'filas (2 + 2 lotes)'); eq(s.esperado, lecheAntes, 'stock esperado guardado (ajuste trazable)');
  });

  await paso('Stock: historial muestra el conteo con su ajuste', async () => {
    await page.getByRole('heading', { name: 'Historial' }).waitFor();
    const item = page.locator('.item-historial').first();
    await item.getByText('Conteo periódico').waitFor();
    await item.locator('summary').click();
    await item.locator('tr', { hasText: 'Leche entera 1 L' }).getByText('(2 lotes)').waitFor();
  });

  await paso('Stock: inventario inicial (otro tipo) también sin proveedor', async () => {
    await page.getByRole('tab', { name: /Conteo/ }).click();
    await page.getByRole('radio', { name: 'Inventario inicial' }).click();
    await page.locator('.fila-conteo', { hasText: 'Yerba 1 kg' }).locator('.contador-input').fill('7');
    await page.getByRole('button', { name: /Revisar diferencias/ }).click();
    await page.getByRole('button', { name: 'Confirmar conteo' }).click();
    await page.getByRole('heading', { name: 'Historial' }).waitFor();
    eq((await q1(`select tipo from sesiones_conteo order by creada_en desc limit 1`)).tipo, 'inicial', 'tipo inicial');
    eq(await stock('Yerba 1 kg'), 7, 'stock yerba');
  });

  // ---------- Corrección 3 ----------
  await paso('Vencimientos: tablero con vencidos y por vencer, cantidades y lotes', async () => {
    await ir('stock?pestana=vencimientos');
    const vencidos = await q1(`select count(*) n from v_lotes where estado = 'vencido'`);
    eq(Number((await page.locator('.tablero-item').first().locator('strong').innerText())), vencidos.n, 'cantidad de lotes vencidos = base');
    const t = page.locator('.tarjeta-lote', { hasText: 'Leche entera 1 L' }).filter({ hasText: /Venció hace 2 días/ });
    await t.getByText('10').first().waitFor();
    await t.getByText(/Retirala de la góndola/).waitFor();
    await page.locator('.tarjeta-lote', { hasText: 'Leche entera 1 L' }).filter({ hasText: /Vence en 3 días/ }).waitFor();
  });

  await paso('Vencimientos: ver detalle del lote', async () => {
    await page.locator('.tarjeta-lote', { hasText: 'Leche entera 1 L' }).filter({ hasText: /Venció/ }).getByRole('button', { name: 'Ver lote' }).click();
    await hoja().getByText('Detalle del lote').waitFor();
    await hoja().getByText(/Cantidad en stock: 10/).waitFor();
  });

  let devId;
  await paso('Devolución: preparar desde la alerta (no descuenta stock)', async () => {
    await hoja().getByRole('button', { name: 'Preparar devolución' }).click();
    await hoja().getByText('Preparar devolución').first().waitFor();
    eq(await hoja().locator('#dev-prov').inputValue() !== '', true, 'proveedor sugerido');
    eq(await hoja().locator('input[id^="dev-cant-"]').inputValue(), '10', 'cantidad del lote');
    await hoja().getByRole('radio', { name: 'Pedir cambio' }).click();
    await page.getByRole('button', { name: 'Revisar' }).click();
    await hoja().getByText(/El stock no cambia todavía/).waitFor();
    await page.getByRole('button', { name: 'Guardar y generar remito' }).click();
    await hoja().locator('.remito').waitFor();
    await hoja().getByText(/No es una factura ni un comprobante fiscal/).waitFor();
    await hoja().getByText('Solicitud de cambio de mercadería').waitFor();
    const d = await q1(`select id, estado, respuesta_proveedor r from devoluciones order by creada_en desc limit 1`);
    devId = d.id; eq(d.estado, 'preparada', 'estado'); eq(d.r, 'pendiente', 'respuesta pendiente');
    eq(await stock('Leche entera 1 L'), 25, 'preparar NO descuenta stock');
  });

  await paso('Devolución: descargar el remito como documento', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), hoja().getByRole('button', { name: /Descargar/ }).click()]);
    const p = await dl.path();
    const fs = await import('node:fs');
    const html = fs.readFileSync(p, 'utf8');
    eq(html.includes('Leche entera 1 L') && html.includes('No es una factura'), true, 'contenido del remito');
    eq(/^remito-devolucion-\d{4}\.html$/.test(dl.suggestedFilename()), true, 'nombre del archivo');
  });

  await paso('Devolución: registrar entrega → descuenta stock una sola vez', async () => {
    await hoja().getByRole('button', { name: /Registrar entrega/ }).click();
    await hoja().getByText(/stock 25 → 15/).waitFor();
    await hoja().getByRole('button', { name: 'Sí, se entregó' }).click();
    await page.getByText(/Entrega registrada/).waitFor();
    eq(await stock('Leche entera 1 L'), 15, 'stock después de entregar');
    // Segundo intento (doble clic, otro celular): no duplica
    const r = await fetch(`http://localhost:54321/rest/v1/devoluciones?id=eq.${devId}&estado=eq.preparada`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ estado: 'entregada' }) });
    eq((await r.json()).length, 0, 'segunda entrega no aplica');
    eq((await q1(`select count(*) n from movimientos_stock where tipo = 'devolucion'`)).n, 1, 'un solo movimiento');
    eq(await stock('Leche entera 1 L'), 15, 'stock sin doble descuento');
    await hoja().getByText(/Pendiente: el proveedor todavía no confirmó/).waitFor();
  });

  await paso('Devolución: registrar respuesta del proveedor (resuelta)', async () => {
    await hoja().getByRole('button', { name: /Registrar respuesta/ }).click();
    await hoja().getByRole('radio', { name: 'Aceptó' }).click();
    await hoja().getByLabel(/Cómo se resolvió/).fill('Reemplazo en la próxima visita');
    await hoja().getByRole('button', { name: 'Guardar respuesta' }).click();
    await page.getByText('Respuesta registrada.').waitFor();
    const d = await q1(`select estado, respuesta_proveedor r from devoluciones where id = $1`, [devId]);
    eq(d.estado, 'resuelta', 'estado'); eq(d.r, 'aceptada', 'respuesta');
    await page.keyboard.press('Escape');
  });

  await paso('Baja por descarte: diferenciada de la devolución', async () => {
    await ir('stock?pestana=vencimientos');
    eq(await page.locator('.tarjeta-lote', { hasText: 'Leche entera 1 L' }).filter({ hasText: /Venció/ }).count(), 0, 'el lote devuelto ya no figura');
    await page.locator('.tarjeta-lote', { hasText: 'Leche entera 1 L' }).filter({ hasText: /Vence en 3 días/ }).getByRole('button', { name: 'Dar de baja' }).click();
    await hoja().locator('#baja-cant').fill('2');
    await hoja().locator('#baja-motivo').selectOption('Roto o dañado');
    await page.getByRole('button', { name: /Confirmar baja/ }).click();
    await page.getByText(/Baja registrada/).waitFor();
    eq(await stock('Leche entera 1 L'), 13, 'stock después de la baja');
    const m = await q1(`select count(*) filter (where tipo = 'baja') b, count(*) filter (where tipo = 'devolucion') d from movimientos_stock`);
    eq(m.b, 1, 'una baja'); eq(m.d, 1, 'una devolución');
    await ir('stock?pestana=historial');
    await page.locator('.item-simple', { hasText: 'Baja' }).getByText(/Roto o dañado/).waitFor();
    await page.locator('.item-simple', { hasText: 'Devolución' }).getByText(/remito N°/).waitFor();
  });

  await paso('Devolución preparada y anulada: no toca el stock', async () => {
    await ir('stock?pestana=devoluciones');
    await page.getByRole('button', { name: 'Nueva devolución' }).click();
    await hoja().locator('#dev-prov').selectOption({ label: 'Distribuidora Centro' });
    await hoja().getByRole('button', { name: 'Agregar mercadería' }).click();
    await hoja().locator('.item-boton', { hasText: 'Cerveza Quilmes 473 ml' }).click();
    await hoja().locator('input[id^="dev-cant-"]').fill('3');
    await hoja().locator('#dev-motivo').selectOption('danado');
    await page.getByRole('button', { name: 'Revisar' }).click();
    await page.getByRole('button', { name: 'Guardar y generar remito' }).click();
    await hoja().locator('.remito').waitFor();
    await hoja().getByRole('button', { name: 'Anular devolución' }).click();
    await hoja().getByRole('button', { name: 'Anular', exact: true }).click();
    await page.getByText('Devolución anulada.').waitFor();
    eq(await stock('Cerveza Quilmes 473 ml'), 24, 'stock intacto');
  });

  await paso('Mover a otro producto: valida, muestra consecuencias y conserva historial', async () => {
    await ir('catalogo');
    await page.getByRole('button', { name: /Nuevo/ }).click();
    await page.getByLabel('Nombre del producto').fill('Quilmes Stout 340 ml');
    await hoja().locator('input[id^="pp-"]').first().fill('2');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await page.getByText('Producto creado.').waitFor();
    await db.query(`select gondola_registrar_conteo('periodico', jsonb_build_array(jsonb_build_object('producto_id', (select id from productos where nombre = 'Quilmes Stout 340 ml'), 'cantidad', 5)))`);
    await page.reload(); await page.waitForSelector('.item-catalogo');
    const antes = await q1(`select id, ficha_id from productos where nombre = 'Quilmes Stout 340 ml'`);
    await page.locator('.item-catalogo', { hasText: 'Quilmes Stout 340 ml' }).click();
    await hoja().getByRole('button', { name: /Mover a otro producto/ }).click();
    const m = hoja();
    const val = await m.locator('#mover-destino option').evaluateAll((os) => os.find((o) => o.textContent.startsWith('Cerveza Quilmes ('))?.value);
    await m.locator('#mover-destino').selectOption(val);
    // Sin renombrar: «Única» no choca (Cerveza Quilmes no tiene Única) → se puede; pero probamos validación con nombre repetido
    await m.locator('#mover-pres').fill('473 ml');
    await m.getByText(/ya tiene una presentación «473 ml»/).waitFor();
    eq(await page.getByRole('button', { name: 'Confirmar y mover' }).isDisabled(), true, 'bloquea si se repite');
    await m.locator('#mover-pres').fill('Stout 340 ml');
    await m.getByText(/no cambia/).waitFor();
    await m.getByText(/se archiva \(no se borra\)/).waitFor();
    eq(await page.getByRole('button', { name: 'Confirmar y mover' }).isDisabled(), true, 'pide confirmación explícita');
    await m.getByText('Revisé los datos y quiero moverla.').click();
    await page.getByRole('button', { name: 'Confirmar y mover' }).click();
    await page.getByText(/ahora es «Cerveza Quilmes Stout 340 ml»/).waitFor();
    const despues = await q1(`select id, ficha_id, nombre from productos where id = $1`, [antes.id]);
    eq(despues.nombre, 'Cerveza Quilmes Stout 340 ml', 'nombre'); eq(despues.id, antes.id, 'misma presentación (mismo id)');
    eq(await stock('Cerveza Quilmes Stout 340 ml'), 5, 'stock conservado');
    eq(await stock('Cerveza Quilmes 473 ml'), 24, 'no mezcla stock con otras presentaciones');
    eq((await q1(`select archivada a from fichas_producto where id = $1`, [antes.ficha_id])).a, true, 'ficha origen archivada, no borrada');
    eq((await q1(`select count(*) n from cambios_ficha`)).n, 1, 'cambio registrado');
    eq((await q1(`select count(*) n from conteos where producto_id = $1`, [antes.id])).n, 1, 'historial intacto');
  });

  // ---------- Lo que ya existía sigue funcionando ----------
  await paso('Recepción: remito pendiente con producto nuevo (alta de presentación) y confirmación', async () => {
    await ir('recepcion');
    const cocaAntes = await stock('Coca-Cola 2,25 L');
    await page.getByRole('button', { name: /ejemplo · Distribuidora Centro/ }).click();
    await page.locator('.linea', { hasText: 'FANTA' }).getByRole('button', { name: /Crear producto/ }).click();
    await hoja().getByText('Nuevo producto o presentación').waitFor();
    await hoja().locator('#prod-punto').fill('3');
    await hoja().getByRole('button', { name: 'Crear producto' }).click();
    await page.getByText('Producto creado.').waitFor();
    await page.getByRole('button', { name: /Confirmar recepción/ }).click();
    await page.locator('.tarjeta-exito').waitFor();
    eq(await stock('Coca-Cola 2,25 L'), cocaAntes + 12, 'la recepción suma al stock');
    eq((await q1(`select presentacion p from productos where nombre ilike 'Fanta%'`)).p, 'Única', 'alta rápida como presentación Única');
  });

  await paso('Recepción manual: agrega lote a una presentación de la ficha nueva', async () => {
    await ir('recepcion');
    await page.getByRole('button', { name: /Cargar a mano|sin foto|manual/i }).first().click();
    await page.locator('select').first().selectOption({ label: 'Distribuidora Centro' });
    const linea = page.locator('.linea').first();
    await linea.locator('select').first().selectOption({ label: 'Cerveza Quilmes 473 ml' });
    await linea.locator('.contador-input').fill('12');
    await page.getByRole('button', { name: /Confirmar recepción/ }).click();
    await page.locator('.tarjeta-exito').waitFor();
    eq(await stock('Cerveza Quilmes 473 ml'), 36, 'recepción por presentación');
    eq(await stock('Cerveza Quilmes 1 L'), 10, 'no afecta la otra presentación');
  });

  await paso('Hoy: pedido sugerido por proveedor sigue abriendo', async () => {
    await ir('hoy');
    const b = page.getByRole('button', { name: /pedido/i }).first();
    await b.click();
    await hoja().waitFor();
    eq(await hoja().locator('.fila-conteo, li').count() > 0, true, 'hoja de pedido con productos');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Ver vencimientos y devoluciones/ }).click();
    await page.getByRole('heading', { name: 'Vencimientos' }).waitFor();
  });

  await paso('Ruta vieja #/contar redirige a Stock', async () => {
    await ir('contar');
    await page.getByRole('heading', { name: 'Conteo de stock' }).waitFor();
  });

  await paso('Sin errores en la consola', async () => {
    const reales = errores.filter((e) => !/favicon|storage\/v1/.test(e));
    eq(reales.length, 0, reales.join(' | '));
  });
} catch {
  // el detalle ya quedó en res
} finally {
  console.log(res.join('\n'));
  console.log(errores.length ? 'Consola:\n' + errores.slice(0, 10).join('\n') : '');
  await browser.close(); await db.end();
}
