# Datos actuales de producción (01+02+03) migrados con la 04, SIN restablecer la demo.
import re, subprocess, urllib.parse
from playwright.sync_api import sync_playwright, expect
URL = 'http://localhost:8787/'
def sql(q):
    r = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'gondola', '-At', '-c', q], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
res = []
def ok(n, c, d=''):
    res.append(c); print(('PASS ' if c else 'FAIL ') + n + (f' — {d}' if d else ''))

antes = sql("select string_agg(nombre||'='||stock_actual, ', ' order by nombre) from v_stock_actual")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 390, 'height': 844})
    errores = []; pg.on('pageerror', lambda e: errores.append(str(e)))
    def ir(s): pg.goto(URL + '#/' + s); pg.wait_for_timeout(700)
    def toast(t): expect(pg.locator('.aviso').filter(has_text=t).first).to_be_visible(timeout=5000)

    ir('catalogo')
    chips = pg.locator('.chip-presentacion').all_inner_texts()
    ok('M1. Cada producto existente tiene su presentación "Única" con el mismo stock', len(chips) == 6 and all(c.startswith('Única') for c in chips), ' | '.join(chips))
    ok('M2. Stock migrado idéntico al de la vista anterior', antes == sql("select string_agg(producto||'='||stock_actual, ', ' order by producto) from v_stock_presentacion"), antes)

    ir('hoy')
    ok('M3. Hoy sigue mostrando lo que falta pedir (Sprite 4/6)', pg.locator('.tarjeta-falta').filter(has_text='Sprite 2,25 L').count() == 1)

    # Remito de ejemplo creado por la versión anterior (líneas con producto, migradas a presentación)
    ir('recepcion')
    leche = int(sql("select stock_actual from v_stock_presentacion where producto='Leche entera 1 L'"))
    pg.get_by_role('button', name=re.compile('ejemplo · Lácteos del Sur')).click(); pg.wait_for_timeout(800)
    lin = pg.get_by_test_id('linea-recepcion')
    ok('M4. El borrador viejo abre con las presentaciones vinculadas', lin.filter(has=pg.locator('.linea-remito', has_text='LECHE ENTERA')).locator('select').first.evaluate('s => s.options[s.selectedIndex].text') == 'Leche entera 1 L')
    linea = lambda t: lin.filter(has=pg.locator('.linea-remito', has_text=t))
    linea('QUESO').get_by_role('button', name='Ignorar').click()
    linea('YOG. BEB').locator('.contador-input').fill('12')
    pg.get_by_role('button', name='Confirmar recepción').click(); toast('Recepción guardada')
    ok('M5. La recepción de remitos sigue operativa', int(sql("select stock_actual from v_stock_presentacion where producto='Leche entera 1 L'")) == leche + 24)

    # Pedido
    ir('pedidos')
    pg.get_by_test_id('tarjeta-proveedor').filter(has_text='Distribuidora Centro').get_by_role('button', name='Preparar pedido').click()
    pg.get_by_role('button', name=re.compile('Ver mensaje')).click()
    msg = pg.get_by_test_id('mensaje-final').input_value()
    ok('M6. El pedido por WhatsApp sigue funcionando con productos migrados', 'Sprite 2,25 L' in msg and 'Única' not in msg, msg.replace('\n', ' | '))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # Mover: agrupar "Coca-Cola 2,25 L" bajo una ficha nueva "Coca-Cola"
    ir('catalogo')
    pg.get_by_role('button', name='Nuevo').click()
    pg.locator('#alta-producto-nombre').fill('Coca-Cola')
    pg.get_by_label('Presentación', exact=True).fill('500 ml')
    pg.locator('#alta-cont').fill('500'); pg.select_option('#alta-ucont', 'ml'); pg.locator('#alta-punto').fill('6')
    pg.get_by_role('button', name='Crear producto').click(); toast('Producto creado')
    conteos_antes = sql("select count(*) from conteos c join productos p on p.id=c.producto_id where p.nombre='Coca-Cola 2,25 L'")
    pg.get_by_test_id('producto-catalogo').filter(has_text='Coca-Cola 2,25 L').click()
    pg.get_by_role('button', name='Mover a otro producto').click()
    pg.select_option('#mover-destino', label='Coca-Cola')
    btn = pg.get_by_role('button', name='Ver resumen y confirmar')
    ok('M7. Exige nombrar la presentación antes de mover', btn.is_disabled())
    pg.locator('#mover-nombre').fill('500 ml')
    ok('M8. Detecta presentación duplicada en el destino', pg.locator('.lista-problemas').filter(has_text='ya tiene una presentación «500 ml»').count() == 1 and btn.is_disabled())
    pg.locator('#mover-nombre').fill('2,25 L')
    previa = pg.get_by_test_id('vista-previa-mover').inner_text()
    ok('M9. Vista previa: resultado, stock sin cambios, historial y archivo', 'Coca-Cola · 2,25 L' in previa and '15' in previa and f'{conteos_antes} conteos' in previa and 'se archiva' in previa, previa.replace('\n', ' | '))
    btn.click()
    ok('M10. Pide confirmación antes de ejecutar', pg.get_by_role('button', name='Sí, mover').count() == 1 and sql("select count(*) from presentaciones x join productos p on p.id=x.producto_id where p.nombre='Coca-Cola'") == '1')
    pg.get_by_role('button', name='Sí, mover').click(); toast('El stock (15) no cambió')
    r = sql("select p.nombre||'/'||x.nombre||'='||coalesce(v.stock_actual::text,'null') from v_stock_presentacion v join presentaciones x on x.id=v.presentacion_id join productos p on p.id=x.producto_id where p.nombre in ('Coca-Cola','Coca-Cola 2,25 L') order by 1")
    ok('M11. Movida sin sumar stocks; cada presentación conserva el suyo', r.split('\n') == ['Coca-Cola/2,25 L=15', 'Coca-Cola/500 ml='] or r.split('\n') == ['Coca-Cola/2,25 L=15', 'Coca-Cola/500 ml=null'], r.replace('\n', ' | '))
    ok('M12. Conserva el historial (conteos y recepciones siguen en la presentación)', sql("select count(*) from conteos c join presentaciones x on x.id=c.presentacion_id join productos p on p.id=x.producto_id where p.nombre='Coca-Cola' and x.nombre='2,25 L'") == conteos_antes)
    ok('M13. La ficha vacía queda archivada, no borrada', sql("select activo::text from productos where nombre='Coca-Cola 2,25 L'") == 'false')

    # Validación de compatibilidad (perecedero)
    ir('catalogo')
    pg.get_by_test_id('producto-catalogo').filter(has_text='Leche entera 1 L').click()
    pg.get_by_role('button', name='Mover a otro producto').click()
    pg.select_option('#mover-destino', label='Coca-Cola'); pg.locator('#mover-nombre').fill('1 L')
    ok('M14. No deja mover entre perecedero y no perecedero', pg.locator('.lista-problemas').filter(has_text='perecedero').count() == 1 and pg.get_by_role('button', name='Ver resumen y confirmar').is_disabled())
    ok('M15. Vistas de la versión anterior siguen respondiendo', sql("select count(*) from v_stock_actual") != '')
    ok('Sin errores de JavaScript', not errores, '; '.join(errores))
    b.close()
print(f'\n{sum(res)}/{len(res)} OK')
