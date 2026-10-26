# Aceptación · lectura de remitos (flujo de la app DESPUÉS de la IA), en base local aislada.
# La respuesta del servicio /api/leer-remito se SIMULA (la IA real de producción hoy falla).
# Base: ./base_final.sh con-demo · App: ./servidor.sh
import os
import json, subprocess
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8787/'
DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'remitos') + '/'
res = []
def ok(n, c, d=''):
    res.append((n, bool(c), d)); print(('PASS ' if c else 'FAIL ') + n + (f' — {d}' if d else ''))
def sql(q):
    r = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'gondola', '-At', '-c', q], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
def stock(prod, pres):
    return sql(f"select coalesce(stock_actual,0) from v_stock_presentacion v join presentaciones p on p.id=v.presentacion_id join productos x on x.id=p.producto_id where x.nombre='{prod}' and p.nombre='{pres}'")
def todos_stock():
    return sql("select string_agg(x.nombre||' '||p.nombre||'='||coalesce(v.stock_actual,0), '; ' order by x.nombre, p.nombre) from v_stock_presentacion v join presentaciones p on p.id=v.presentacion_id join productos x on x.id=p.producto_id")

RESP = {
  'legible': (200, {'proveedor': 'DISTRIBUIDORA CENTRO S.R.L.', 'fecha': '2026-10-24', 'lineas': [
      {'descripcion': 'COCA COLA 2,25 LT', 'cantidad': 12, 'fecha_vencimiento': None, 'confianza': 0.97},
      {'descripcion': 'COCA COLA 500 CC', 'cantidad': 24, 'fecha_vencimiento': None, 'confianza': 0.96},
      {'descripcion': 'SPRITE 2,25 LT', 'cantidad': 6, 'fecha_vencimiento': None, 'confianza': 0.97},
      {'descripcion': 'AGUA MINERAL 1,5 LT', 'cantidad': 10, 'fecha_vencimiento': '2027-03-15', 'confianza': 0.95}]}),
  'danado': (200, {'proveedor': 'LACTEOS DEL SUR', 'fecha': '2026-11-15', 'lineas': [
      {'descripcion': 'LECHE ENTERA 1 L', 'cantidad': 30, 'fecha_vencimiento': '2026-11-05', 'confianza': 0.85},
      {'descripcion': 'YOGUR BEBIBLE 190 G', 'cantidad': None, 'fecha_vencimiento': '2026-11-08', 'confianza': 0.3},
      {'descripcion': 'QUESO RALLADO 150 G', 'cantidad': 5, 'fecha_vencimiento': '2026-12-20', 'confianza': 0.6}]}),
  'sin_fecha': (200, {'proveedor': 'LACTEOS DEL SUR', 'fecha': None, 'lineas': [
      {'descripcion': 'LECHE ENTERA 1 L', 'cantidad': 30, 'fecha_vencimiento': None, 'confianza': 0.9}]}),
  'ilegible': (422, {'error': 'ilegible', 'mensaje': 'No se pudo leer el remito: la imagen no es legible o no parece un remito.'}),
  'caida': (503, {'error': 'no_disponible', 'mensaje': 'El servicio de IA está saturado en este momento. Probá de nuevo en unos minutos o cargá el remito a mano.', 'reintentable': True}),
  'demora': (504, {'error': 'demora', 'mensaje': 'La IA tardó demasiado en leer el remito. Probá de nuevo o cargalo a mano.', 'reintentable': True}),
  'baja': (200, {'proveedor': 'LACTEOS DEL SUR', 'fecha': '2026-10-25', 'lineas': [{'descripcion': 'YOGUR BEBIBLE 190 G', 'cantidad': 81, 'fecha_vencimiento': None, 'confianza': 0.3}]}),
}
actual = {'k': 'legible'}
llamadas = []

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1100, 'height': 900})
    pg = ctx.new_page(); errores = []
    pg.on('pageerror', lambda e: errores.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    def ruta(route):
        llamadas.append(actual['k'])
        st, body = RESP[actual['k']]
        route.fulfill(status=st, content_type='application/json', body=json.dumps(body))
    pg.route('**/api/leer-remito', ruta)

    def subir(k, img):
        actual['k'] = k
        pg.goto(URL + '#/hoy'); pg.wait_for_timeout(500); pg.goto(URL + '#/recepcion'); pg.wait_for_timeout(1200)
        pg.locator('[data-testid=subir-imagen]').set_input_files(DIR + img); pg.wait_for_timeout(2500)
    def lineas(): return pg.locator('[data-testid=linea-recepcion]')
    def sel_texto(loc): return loc.locator('select').first.evaluate('s => s.options[s.selectedIndex]?.text || ""')
    def n_rec(estado=None): return sql("select count(*) from recepciones" + (f" where estado='{estado}'" if estado else ''))

    pg.goto(URL); pg.wait_for_timeout(1500)
    pg.locator('section[aria-label="Acceso rápido para evaluación"] button', has_text='Empleado').click(); pg.wait_for_timeout(2500)

    # ---------- Remito 1: legible ----------
    base = todos_stock(); rec0 = n_rec()
    subir('legible', 'legible.jpg')
    ok('L1. La app manda la foto al servicio de IA (1 llamada)', llamadas.count('legible') == 1)
    ok('L2. Abre «Revisá lo que leyó la IA»', pg.get_by_role('heading', name='Revisá lo que leyó la IA').count() == 1)
    prov = pg.locator('#rec-proveedor').evaluate('s => s.options[s.selectedIndex].text')
    ok('L3. Proveedor identificado: Distribuidora Centro', prov == 'Distribuidora Centro', prov)
    ok('L4. Fecha del remito: 2026-10-24', pg.input_value('#rec-fecha') == '2026-10-24', pg.input_value('#rec-fecha'))
    vis = [(sel_texto(lineas().nth(i)), lineas().nth(i).locator('.contador-input').input_value()) for i in range(lineas().count())]
    esperado = [('Coca-Cola 2,25 L', '12'), ('Coca-Cola 500 ml', '24'), ('Sprite 2,25 L', '6'), ('Agua mineral 1,5 L', '10')]
    ok('L5. Presentaciones y cantidades correctas (incluye 2,25 L vs 500 ml)', vis == esperado, str(vis))
    venc = pg.locator('input[id^=venc-]').evaluate_all('xs => xs.map(x => x.value).filter(Boolean)')
    ok('L6. Vencimiento del agua: 2027-03-15', '2027-03-15' in venc, str(venc))
    ok('L7. Sin líneas marcadas para revisar', pg.locator('.alerta-amarilla').count() == 0)
    ok('L8. Al leer se crea un borrador (no suma stock)', n_rec() == str(int(rec0) + 1) and todos_stock() == base)
    pg.get_by_role('button', name='Cancelar').click(); pg.wait_for_timeout(1500)
    ok('L9. Cancelar: el borrador queda cancelado y el stock no cambia', n_rec('cancelada') == '1' and todos_stock() == base, f"canceladas={n_rec('cancelada')}")
    # confirmar (con doble clic rápido para probar duplicados)
    subir('legible', 'legible.jpg')
    antes = {k: stock(*k) for k in [('Coca-Cola', '2,25 L'), ('Coca-Cola', '500 ml'), ('Sprite', '2,25 L'), ('Agua mineral', '1,5 L')]}
    pg.get_by_role('button', name='Confirmar recepción').dblclick(); pg.wait_for_timeout(2500)
    despues = {k: stock(*k) for k in antes}
    dif = {f'{k[0]} {k[1]}': round(float(despues[k]) - float(antes[k]), 2) for k in antes}
    ok('L10. Confirmar suma exactamente lo recibido una sola vez (doble clic incluido)', dif == {'Coca-Cola 2,25 L': 12, 'Coca-Cola 500 ml': 24, 'Sprite 2,25 L': 6, 'Agua mineral 1,5 L': 10}, str(dif))
    otros = [x for x in todos_stock().split('; ') if not any(x.startswith(f'{k[0]} {k[1]}=') for k in antes)]
    otros0 = [x for x in base.split('; ') if not any(x.startswith(f'{k[0]} {k[1]}=') for k in antes)]
    ok('L11. No cambia el stock de otros productos', otros == otros0)
    ok('L12. Una recepción confirmada con 4 líneas', sql("select count(*) from recepciones where estado='confirmada' and fecha='2026-10-24'") == '1' and sql("select count(*) from recepcion_lineas l join recepciones r on r.id=l.recepcion_id where r.estado='confirmada' and r.fecha='2026-10-24'") == '4')
    pg.reload(); pg.wait_for_timeout(2000)
    ok('L13. Recargar no duplica', {k: stock(*k) for k in antes} == despues)
    ok('L14. Lote del agua guardado con su vencimiento', sql("select count(*) from recepcion_lineas l join recepciones r on r.id=l.recepcion_id where r.estado='confirmada' and l.fecha_vencimiento='2027-03-15'") == '1', sql("select string_agg(r.estado, ',') from recepcion_lineas l join recepciones r on r.id=l.recepcion_id where l.fecha_vencimiento='2027-03-15'"))

    # ---------- Remito 2: dañado, fecha futura, producto desconocido ----------
    base = todos_stock()
    subir('danado', 'danado.jpg')
    prov = pg.locator('#rec-proveedor').evaluate('s => s.options[s.selectedIndex].text')
    ok('D1. Proveedor identificado: Lácteos del Sur', prov == 'Lácteos del Sur', prov)
    ok('D2. La fecha futura se muestra tal cual (2026-11-15)', pg.input_value('#rec-fecha') == '2026-11-15', pg.input_value('#rec-fecha'))
    alerta = pg.locator('.alerta-amarilla').inner_text() if pg.locator('.alerta-amarilla').count() else ''
    ok('D3. Avisa líneas a revisar y el producto desconocido', 'revisar' in alerta and 'sin producto' in alerta, alerta)
    l_yog, l_que = lineas().nth(1), lineas().nth(2)
    ok('D4. Yogur: presentación 190 g, cantidad vacía (no inventada) y marcado', sel_texto(l_yog) == 'Yogur bebible 190 g' and l_yog.locator('.contador-input').input_value() == '' and 'revisar' in (l_yog.get_attribute('class') or ''), f"{sel_texto(l_yog)} / '{l_yog.locator('.contador-input').input_value()}'")
    ok('D5. Queso rallado: sin producto, con Crear e Ignorar', sel_texto(l_que) == 'Sin asignar' and l_que.get_by_role('button', name='Ignorar').count() == 1, sel_texto(l_que))
    ok('D6. La IA no ingresó nada: stock sin cambios', todos_stock() == base)
    pg.get_by_role('button', name='Confirmar recepción').click(); pg.wait_for_timeout(1500)
    err = pg.locator('.barra-error').inner_text() if pg.locator('.barra-error').count() else ''
    fecha_err = pg.locator('.campo-error, .error').all_inner_texts()
    ok('D7. Confirmar con inconsistencias se bloquea (fecha futura, sin producto, sin cantidad)', err != '' and todos_stock() == base, err)
    ok('D8. Señala la fecha futura', any('futura' in t for t in fecha_err) or 'futura' in pg.locator('body').inner_text(), str(fecha_err)[:150])
    # corrección manual
    pg.fill('#rec-fecha', '2026-10-25')
    l_yog.locator('.contador-input').fill('18')
    l_que.get_by_role('button', name='Ignorar').click()
    antes = {k: stock(*k) for k in [('Leche entera', '1 L'), ('Yogur bebible', '190 g')]}
    pg.get_by_role('button', name='Confirmar recepción').click(); pg.wait_for_timeout(2500)
    despues = {k: stock(*k) for k in antes}
    dif = {f'{k[0]} {k[1]}': round(float(despues[k]) - float(antes[k]), 2) for k in antes}
    ok('D9. Corregido a mano (fecha, cantidad 18, queso ignorado) se confirma y suma una vez', dif == {'Leche entera 1 L': 30, 'Yogur bebible 190 g': 18}, str(dif))
    ok('D10. El queso ignorado no se agrega al catálogo ni al stock', sql("select count(*) from productos where nombre ilike '%queso%'") == '0' and sql("select count(*) from recepcion_lineas where estado='ignorada' and descripcion ilike 'QUESO%'") == '1')
    ok('D11. Vencimientos del remito guardados por lote', sql("select count(*) from recepcion_lineas l join recepciones r on r.id=l.recepcion_id where r.estado='confirmada' and l.fecha_vencimiento in ('2026-11-05','2026-11-08')") == '2')

    # ---------- Fecha no legible ----------
    subir('sin_fecha', 'danado.jpg')
    f = pg.input_value('#rec-fecha')
    marcada = pg.locator('#rec-fecha').evaluate('e => !!e.closest(".campo")?.querySelector(".campo-error, .error")')
    ok('F1. Sin fecha leída: el campo NO se completa solo y se avisa', f == '' and 'No se pudo leer la fecha' in pg.locator('body').inner_text(), f"el campo muestra {f}")
    pg.get_by_role('button', name='Cancelar').click(); pg.wait_for_timeout(1200)

    # ---------- Ilegible y servicio caído ----------
    for k, img in [('ilegible', 'ilegible.jpg'), ('caida', 'legible.jpg')]:
        base = todos_stock(); r0 = n_rec()
        subir(k, img)
        txt = pg.locator('[role=alert]').all_inner_texts()
        ok(f'I-{k}. Muestra el error, ofrece «Cargar a mano» y no crea nada', len(txt) > 0 and pg.get_by_role('button', name='Cargar a mano').count() == 1 and n_rec() == r0 and todos_stock() == base, ' | '.join(txt)[:120])

    # Reintentar: la misma foto se vuelve a mandar una vez por toque; al segundo intento lee
    for k in ['caida', 'demora']:
        subir(k, 'legible.jpg')
        n0 = len(llamadas)
        ok(f'T-{k}. Ofrece «Reintentar la lectura»', pg.get_by_role('button', name='Reintentar la lectura').count() == 1)
        actual['k'] = 'legible'
        pg.get_by_role('button', name='Reintentar la lectura').dblclick(); pg.wait_for_timeout(2500)
        ok(f'T-{k}b. Reintentar lee con una sola llamada (doble toque incluido) y abre la revisión', len(llamadas) == n0 + 1 and pg.get_by_role('heading', name='Revisá lo que leyó la IA').count() == 1, f'llamadas={len(llamadas) - n0}')
        pg.get_by_role('button', name='Cancelar').click(); pg.wait_for_timeout(1200)

    # Confianza baja: no se puede confirmar sin revisar
    a = sql("select stock_actual from v_stock_presentacion v join presentaciones p on p.id=v.presentacion_id join productos x on x.id=p.producto_id where x.nombre='Yogur bebible' and p.nombre='190 g'")
    subir('baja', 'danado.jpg')
    pg.get_by_role('button', name='Confirmar recepción').click(); pg.wait_for_timeout(1500)
    d = sql("select stock_actual from v_stock_presentacion v join presentaciones p on p.id=v.presentacion_id join productos x on x.id=p.producto_id where x.nombre='Yogur bebible' and p.nombre='190 g'")
    ok('B1. Línea con confianza 30 %: no se confirma sin revisarla (no entra 81)', a == d and 'revisar' in (pg.locator('.barra-error').inner_text() if pg.locator('.barra-error').count() else ''), f'{a} -> {d}')
    pg.get_by_role('button', name='Cancelar').click(); pg.wait_for_timeout(1000)

    ok('Sin errores de JavaScript', not errores, '; '.join(errores[:3]))
    b.close()
print(f"{sum(1 for r in res if r[1])}/{len(res)} OK")
