# Flujos completos en el navegador + verificación en la base (modo sin usuarios, demo nueva).
import subprocess, re, json, urllib.parse
from playwright.sync_api import sync_playwright, expect

URL = 'http://localhost:8787/'
def sql(q):
    r = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'gondola', '-At', '-c', q], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
def stock(prod, pres):
    return sql(f"select coalesce(stock_actual::text,'null') from v_stock_presentacion where producto='{prod}' and presentacion='{pres}'")
resultados = []
def ok(nombre, cond, detalle=''):
    resultados.append((nombre, bool(cond), detalle))
    print(('PASS ' if cond else 'FAIL ') + nombre + (f' — {detalle}' if detalle else ''))

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    pg = ctx.new_page()
    errores = []
    pg.on('pageerror', lambda e: errores.append(str(e)))
    pg.on('dialog', lambda d: d.accept())
    def ir(s):
        pg.goto(URL + '#/' + s); pg.wait_for_timeout(700)
    def toast(texto):
        try:
            expect(pg.locator('.aviso').filter(has_text=texto).first).to_be_visible(timeout=5000)
        except Exception:
            pg.screenshot(path='/home/claude/work/test/capturas/error.png', full_page=True)
            print('TEXTO EN PANTALLA:', pg.locator('.barra-error, .form-error, [role=alert]').all_inner_texts())
            raise

    # 1. Producto con dos presentaciones
    ir('catalogo')
    pg.get_by_role('button', name='Nuevo').click()
    pg.locator('#alta-producto-nombre').fill('Gaseosa Naranja')
    pg.get_by_label('Presentación', exact=True).fill('1,5 L')
    pg.locator('#alta-cont').fill('1,5')
    pg.select_option('#alta-ucont', 'l')
    pg.locator('[id="alta-punto"]').fill('6')
    pg.locator('[id="alta-costo"]').fill('1200')
    pg.get_by_label('Distribuidora Centro').check()
    pg.get_by_role('button', name='Crear producto').click()
    toast('Producto creado')
    pg.get_by_test_id('producto-catalogo').filter(has_text='Gaseosa Naranja').click()
    pg.get_by_role('button', name='Agregar presentación').click()
    pg.get_by_label('Presentación', exact=True).fill('500 ml')
    pg.locator('#alta-cont').fill('500'); pg.select_option('#alta-ucont', 'ml'); pg.locator('#alta-punto').fill('12')
    pg.get_by_role('button', name='Agregar presentación').click()
    toast('Presentación agregada')
    n = sql("select count(*) from presentaciones x join productos p on p.id=x.producto_id where p.nombre='Gaseosa Naranja'")
    ok('1. Producto con 2 presentaciones', n == '2', f'presentaciones={n}')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # 2. Inventario inicial sin elegir proveedor
    ir('contar')
    ok('2a. Contar no pide proveedor', pg.get_by_text('¿De qué proveedor?').count() == 0 and pg.locator('.chip').filter(has_text='Distribuidora').count() == 0)
    pg.locator('.chip').filter(has_text='Sin stock inicial').click()
    filas = pg.get_by_test_id('fila-conteo')
    ok('2b. Filtro "sin stock inicial" muestra las 2 nuevas', filas.count() == 2, f'filas={filas.count()}')
    filas.filter(has_text='1,5 L').locator('.contador-input').fill('10')
    filas.filter(has_text='500 ml').locator('.contador-input').fill('4')
    pg.get_by_role('button', name=re.compile('Revisar y guardar')).click()
    ok('2c. Revisión muestra "stock inicial"', pg.locator('.tabla-diferencias').get_by_text('stock inicial').count() == 2)
    pg.get_by_role('button', name='Guardar conteo').click()
    toast('Se guardaron 2 conteos')
    ok('2e. Al guardar se muestra el detalle del conteo', pg.get_by_role('dialog', name=re.compile('Conteo de stock del')).count() == 1)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    r = sql("select string_agg(x.nombre||':'||c.tipo||':'||c.cantidad, ',' order by x.nombre) from conteos c join presentaciones x on x.id=c.presentacion_id join productos p on p.id=x.producto_id where p.nombre='Gaseosa Naranja'")
    ok('2d. Guardado como inventario inicial, stock separado por presentación', r == '1,5 L:inicial:10,500 ml:inicial:4' and stock('Gaseosa Naranja', '1,5 L') == '10' and stock('Gaseosa Naranja', '500 ml') == '4', r)

    # 3. Conteo periódico con diferencia
    antes = stock('Coca-Cola', '2,25 L')
    pg.locator('.chip').filter(has_text='Todas').click()
    pg.get_by_test_id('fila-conteo').filter(has=pg.locator('label', has_text='2,25 L')).filter(has_text='Registrado: 15').locator('.contador-input').fill('11')
    pg.get_by_role('button', name=re.compile('Revisar y guardar')).click()
    ok('3a. Revisión muestra la diferencia -4', pg.locator('.dif-negativa').filter(has_text='-4').count() == 1)
    pg.get_by_role('button', name='Guardar conteo').click()
    toast('Se guardó 1 conteo')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    r = sql("select c.tipo||':'||c.stock_registrado||':'||c.cantidad from conteos c join presentaciones x on x.id=c.presentacion_id join productos p on p.id=x.producto_id where p.nombre='Coca-Cola' and x.nombre='2,25 L' order by fecha_hora desc limit 1")
    ok('3b. Conteo periódico guarda lo registrado (ajuste trazable)', r == 'periodico:15:11' and stock('Coca-Cola', '2,25 L') == '11' and stock('Coca-Cola', '500 ml') == '9', f'{r}; antes={antes}')
    ok('3c. Historial de conteos visible', pg.get_by_text('Conteos de stock anteriores').count() == 1)

    # 4. Lotes en el conteo (perecedero, dos vencimientos)
    fila = pg.get_by_test_id('fila-conteo').filter(has=pg.locator('label', has_text='190 g'))
    fila.locator('.contador-input').fill('11')
    fila.get_by_role('button', name='Cargar vencimiento').click()
    fila.locator('input[type=date]').first.fill('2026-10-26')
    fila.locator('.lote-fila input[inputmode=decimal]').first.fill('5')
    fila.get_by_role('button', name=re.compile('Otro vencimiento')).click()
    fila.locator('input[type=date]').nth(1).fill('2026-11-05')
    fila.locator('.lote-fila input[inputmode=decimal]').nth(1).fill('6')
    pg.get_by_role('button', name=re.compile('Revisar y guardar')).click()
    pg.get_by_role('button', name='Guardar conteo').click()
    toast('Se guardó 1 conteo')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    r = sql("select lotes::text from conteos c join presentaciones x on x.id=c.presentacion_id where x.nombre='190 g' order by fecha_hora desc limit 1")
    ok('4. Conteo con dos lotes de vencimiento distintos', '2026-10-26' in r and '2026-11-05' in r, r)

    # 5. Vencimientos → devolución (preparada no descuenta, confirmada sí)
    ir('vencimientos')
    lote = pg.get_by_test_id('lote-alerta').filter(has_text='Yogur bebible 1 L').filter(has_text='Venció')
    ok('5a. Vencido en stock identificado', lote.count() == 1)
    yogur_antes = stock('Yogur bebible', '1 L')
    lote.get_by_role('button', name='Devolver al proveedor').click()
    pg.get_by_role('button', name='Preparar remito').click()
    expect(pg.get_by_test_id('remito-devolucion')).to_be_visible()
    ok('5b. Remito preparado NO descuenta stock', stock('Yogur bebible', '1 L') == yogur_antes, f'{yogur_antes} → {stock("Yogur bebible", "1 L")}')
    ok('5c. Remito legible con número, proveedor y línea', pg.get_by_test_id('remito-devolucion').get_by_text('Lácteos del Sur').count() == 1 and 'DEV-0002' in pg.get_by_test_id('remito-devolucion').inner_text())
    pg.get_by_role('button', name='Confirmar entrega al proveedor').click()
    pg.get_by_test_id('confirmar-accion').click()
    toast('se descontó del stock')
    ok('5d. Confirmada descuenta una sola vez', int(stock('Yogur bebible', '1 L')) == int(yogur_antes) - 3, f'{yogur_antes} → {stock("Yogur bebible", "1 L")}')
    pg.get_by_role('button', name='Registrar qué hizo el proveedor').click()
    pg.select_option('#res-tipo', 'nota_credito')
    pg.get_by_test_id('confirmar-accion').click()
    toast('Resolución registrada')
    ok('5e. Resuelta sin volver a descontar', int(stock('Yogur bebible', '1 L')) == int(yogur_antes) - 3 and sql("select estado||':'||resolucion from devoluciones where numero=2") == 'resuelta:nota_credito')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # 6. Baja (descarte) diferenciada
    leche_antes = stock('Leche entera', '1 L')
    pg.get_by_test_id('lote-alerta').filter(has_text='Leche entera 1 L').get_by_role('button', name='Dar de baja').click()
    pg.locator('[id^="dc-"]').fill('2')
    pg.get_by_role('button', name='Revisar baja').click()
    pg.get_by_test_id('confirmar-baja').click()
    toast('Baja registrada')
    ok('6. Baja descuenta y queda separada de las devoluciones', int(stock('Leche entera', '1 L')) == int(leche_antes) - 2 and sql("select count(*) from bajas") == '2')

    # 7. Devolución no puede exceder el lote
    pg.get_by_test_id('lote-alerta').filter(has_text='Yogur bebible 190 g').first.get_by_role('button', name='Devolver al proveedor').click()
    pg.locator('[id^="dc-"]').fill('999')
    pg.get_by_role('button', name='Preparar remito').click()
    ok('7. Valida cantidad contra el lote registrado', pg.get_by_text(re.compile('Ese lote tiene')).count() == 1)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # 8. Proyección
    ir('proyeccion')
    pg.locator('#slider-dia').fill('3')
    import datetime, zoneinfo
    d3 = datetime.datetime.now(zoneinfo.ZoneInfo('America/Argentina/Buenos_Aires')).date() + datetime.timedelta(days=3)
    esperado = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'][d3.weekday()] + d3.strftime(' %d/%m')
    ok('8a. Slider cambia la fecha', esperado in pg.get_by_test_id('fecha-slider').inner_text(), pg.get_by_test_id('fecha-slider').inner_text() + ' (esperado ' + esperado + ')')
    sin = pg.locator('section').filter(has_text='Sin datos suficientes')
    ok('8b. Sin historial no se inventa proyección', sin.get_by_text('Gaseosa Naranja 1,5 L').count() == 1 and sin.get_by_text(re.compile('dos conteos')).count() >= 1)
    pg.get_by_test_id('item-proyeccion').filter(has_text='Coca-Cola 500 ml').click()
    ok('8c. Detalle muestra ventana del promedio', pg.get_by_text(re.compile('períodos entre conteos')).count() >= 1)
    pg.get_by_text(re.compile('Simular el pedido sugerido')).click()
    ok('8d. Simular pedido sugerido cambia la proyección', pg.get_by_text(re.compile('Con ese pedido')).count() == 1)
    pg.screenshot(path='/home/claude/work/test/capturas/proyeccion-detalle.png', full_page=True)
    pg.get_by_role('button', name=re.compile('Preparar pedido con')).click()
    ok('8e. Desde la proyección se llega al pedido', pg.get_by_role('dialog', name=re.compile('Pedido · Distribuidora')).count() >= 1)
    pg.keyboard.press('Escape'); pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # 9. Asistente de pedido + WhatsApp
    ir('pedidos')
    pg.get_by_test_id('tarjeta-proveedor').filter(has_text='Distribuidora Centro').get_by_role('button', name='Preparar pedido').click()
    items = pg.get_by_test_id('item-pedido')
    ok('9a. Prioridades con motivos', pg.locator('.grupo-pedido-titulo').filter(has_text='Prioridad alta').count() == 1)
    item500 = items.filter(has=pg.locator('label', has_text='Coca-Cola 500 ml'))
    item500.get_by_role('button', name='¿Por qué?').click()
    ok('9b. Explica por qué', item500.locator('.motivos li').count() >= 2)
    item500.locator('.contador-input').fill('24')
    pg.get_by_text(re.compile('Redondear a bultos')).click()
    pg.get_by_role('button', name=re.compile('Ver mensaje')).click()
    msg = pg.get_by_test_id('mensaje-final').input_value()
    ok('9c. Mensaje con la cantidad editada y bultos configurados', '• 24 × Coca-Cola 500 ml' in msg and 'Hola Distribuidora Centro!' in msg, msg.replace('\n', ' | '))
    pg.get_by_test_id('mensaje-final').fill(msg + '\nGracias Carlos')
    href = pg.get_by_test_id('abrir-whatsapp').get_attribute('href')
    texto = urllib.parse.unquote(href.split('text=')[1])
    ok('9d. WhatsApp abre con el mensaje revisado (no envía solo)', href.startswith('https://wa.me/') and texto.endswith('Gracias Carlos') and '24 × Coca-Cola 500 ml' in texto)
    ok('9e. No mezcla presentaciones (una línea por presentación)', len(re.findall(r'Coca-Cola 500 ml', texto)) == 1)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # 10. Recepción: remito de ejemplo con dos presentaciones del mismo producto
    ir('recepcion')
    c225, c500, agua = stock('Coca-Cola', '2,25 L'), stock('Coca-Cola', '500 ml'), stock('Agua mineral', '1,5 L')
    pg.get_by_role('button', name=re.compile('ejemplo · Distribuidora Centro')).click()
    pg.wait_for_timeout(800)
    lineas = pg.get_by_test_id('linea-recepcion')
    sel = lambda t: lineas.filter(has_text=t).locator('select').first.evaluate('s => s.options[s.selectedIndex].text')
    ok('10a. Reconoce 2,25 L y 500 cc como presentaciones distintas', sel('COCA COLA 2,25 LT') == 'Coca-Cola 2,25 L' and sel('COCA COLA 500 CC') == 'Coca-Cola 500 ml', f"{sel('COCA COLA 2,25 LT')} / {sel('COCA COLA 500 CC')}")
    lineas.filter(has_text='FANTA').get_by_role('button', name='Ignorar').click()
    lineas.filter(has_text='AGUA MIN').get_by_role('button', name='Está bien').click()
    pg.get_by_role('button', name='Confirmar recepción').click()
    toast('Recepción guardada')
    ok('10b. Suma a cada presentación por separado',
       int(stock('Coca-Cola', '2,25 L')) == int(c225) + 12 and int(stock('Coca-Cola', '500 ml')) == int(c500) + 12 and int(stock('Agua mineral', '1,5 L')) == int(agua) + 12)
    ok('10c. Aprende el texto revisado a mano (alias)', sql("select count(*) from presentacion_alias where texto like 'agua%'") == '1', sql('select string_agg(texto, \',\') from presentacion_alias'))

    # 11. Recepción manual con bultos
    pg.get_by_role('button', name='Cargar a mano').click()
    pg.select_option('#rec-proveedor', label='Distribuidora Centro')
    lin = pg.get_by_test_id('linea-recepcion').first
    lin.locator('select').first.select_option(label='Coca-Cola 2,25 L')
    lin.locator('select[id^="ub-"]').select_option('bultos')
    lin.locator('.contador-input').fill('2')
    antes = stock('Coca-Cola', '2,25 L')
    pg.get_by_role('button', name='Confirmar recepción').click()
    toast('Recepción guardada')
    ok('11. Recepción en bultos convierte con la equivalencia configurada (2×8)', int(stock('Coca-Cola', '2,25 L')) == int(antes) + 16)

    ok('Sin errores de JavaScript', not errores, '; '.join(errores))
    b.close()

fallas = [r for r in resultados if not r[1]]
print(f'\n{len(resultados) - len(fallas)}/{len(resultados)} OK')
