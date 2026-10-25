# Roles y autenticación (migraciones 04 + 05). Verifica la interfaz Y la protección real en la base.
import re, subprocess, json, time
from playwright.sync_api import sync_playwright, expect
URL = 'http://localhost:8787/'
def sql(q):
    r = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'gondola', '-At', '-c', q], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
res = []
def ok(n, c, d=''):
    res.append(c); print(('PASS ' if c else 'FAIL ') + n + (f' — {d}' if d else ''))

with sync_playwright() as p:
    b = p.chromium.launch()
    def nueva():
        ctx = b.new_context(viewport={'width': 390, 'height': 844})
        pg = ctx.new_page(); pg.on('dialog', lambda d: d.accept())
        return ctx, pg
    def login(pg, email, clave='clave123'):
        pg.goto(URL); pg.wait_for_timeout(600)
        pg.fill('#ing-email', email); pg.fill('#ing-pass', clave)
        pg.get_by_role('button', name='Ingresar').click(); pg.wait_for_timeout(1200)
    def nav(pg): return [t.strip() for t in pg.locator('.nav-inferior a span').all_inner_texts()]
    def api(pg, metodo, ruta, cuerpo=None):
        return pg.evaluate("""async ([m, r, c]) => {
          const s = JSON.parse(localStorage.getItem('gondola.sesion') || 'null');
          const h = { apikey: 'test', 'Content-Type': 'application/json', Prefer: 'return=representation' };
          if (s) h.Authorization = 'Bearer ' + s.accessToken;
          const res = await fetch('/rest/v1/' + r, { method: m, headers: h, body: c ? JSON.stringify(c) : undefined });
          return { status: res.status, body: await res.text() };
        }""", [metodo, ruta, cuerpo])

    # Sin sesión
    ctx, pg = nueva(); pg.goto(URL); pg.wait_for_timeout(800)
    ok('R1. Sin sesión pide ingresar y no muestra datos', pg.get_by_role('heading', name='Ingresá a tu almacén').count() == 1 and pg.locator('.nav-inferior').count() == 0)
    r = api(pg, 'GET', 'productos?select=nombre')
    ok('R2. La base rechaza leer sin sesión (no alcanza con ocultar la pantalla)', r['status'] in (401, 403), str(r))
    pg.fill('#ing-email', 'empleado@prueba.ar'); pg.fill('#ing-pass', 'mal'); pg.get_by_role('button', name='Ingresar').click(); pg.wait_for_timeout(800)
    ok('R3. Contraseña incorrecta', pg.get_by_text('Email o contraseña incorrectos.').count() == 1)
    ctx.close()

    # Empleado
    ctx, pg = nueva(); login(pg, 'empleado@prueba.ar')
    ok('R4. Empleado: su propia navegación e inicio de tareas', nav(pg) == ['Tareas', 'Stock', 'Recepción', 'Vencimientos', 'Más'] and pg.get_by_text('Mis tareas').count() == 1, str(nav(pg)))
    pg.goto(URL + '#/pedidos'); pg.wait_for_timeout(600)
    ok('R5. Empleado no entra a Pedidos ni por URL', pg.get_by_text('Tu rol no tiene acceso a esta sección.').count() == 1)
    pg.goto(URL + '#/vencimientos'); pg.wait_for_timeout(600)
    ok('R6. Empleado consulta vencimientos sin acciones de devolución/baja', pg.get_by_test_id('lote-alerta').count() > 0 and pg.get_by_role('button', name='Devolver al proveedor').count() == 0)
    pg.goto(URL + '#/contar'); pg.wait_for_timeout(700)
    pg.get_by_test_id('fila-conteo').filter(has=pg.locator('label', has_text='190 g')).locator('.contador-input').fill('10')
    pg.get_by_role('button', name=re.compile('Revisar y guardar')).click(); pg.get_by_role('button', name='Guardar conteo').click(); pg.wait_for_timeout(1000)
    ok('R7. Empleado puede contar', sql("select cantidad::int from conteos c join presentaciones x on x.id=c.presentacion_id where x.nombre='190 g' order by fecha_hora desc limit 1") == '10')
    pid = sql("select id from presentaciones where nombre='190 g'")
    r = api(pg, 'POST', 'bajas', {'presentacion_id': pid, 'cantidad': 1})
    ok('R8. La base rechaza una baja del empleado aunque llame a la API directo', r['status'] == 403 and 'row-level security' in r['body'], r['body'][:90])
    r = api(pg, 'PATCH', f'presentaciones?id=eq.{pid}', {'punto_pedido': 999})
    ok('R9. La base no deja al empleado cambiar el catálogo', r['body'] == '[]' and sql(f"select punto_pedido::int from presentaciones where id='{pid}'") == '10', r['body'][:60])
    r = pg.evaluate("""async () => { const s = JSON.parse(localStorage.getItem('gondola.sesion'));
      const res = await fetch('/rest/v1/rpc/gondola_restablecer_demo', { method: 'POST', headers: { apikey: 'test', Authorization: 'Bearer ' + s.accessToken, 'Content-Type': 'application/json' }, body: '{}' });
      return { status: res.status, body: await res.text() }; }""")
    ok('R10. La base no deja al empleado restablecer la demo', r['status'] >= 400 and 'Solo el dueño' in r['body'])
    pg.goto(URL + '#/catalogo'); pg.wait_for_timeout(600)
    pg.get_by_test_id('producto-catalogo').first.click()
    ok('R11. Empleado ve la ficha sin botones de edición', pg.get_by_role('button', name='Editar').count() == 0 and pg.get_by_role('button', name='Mover a otro producto').count() == 0)
    pg.keyboard.press('Escape')
    pg.reload(); pg.wait_for_timeout(1200)
    ok('R12. La sesión persiste al recargar', nav(pg) == ['Tareas', 'Stock', 'Recepción', 'Vencimientos', 'Más'] and pg.get_by_test_id('producto-catalogo').count() > 0)
    pg.goto(URL + '#/mas'); pg.wait_for_timeout(500)
    pg.get_by_role('button', name='Cerrar sesión').click(); pg.wait_for_timeout(800)
    ok('R13. Cerrar sesión borra la sesión y los datos de pantalla', pg.get_by_role('heading', name='Ingresá a tu almacén').count() == 1 and pg.evaluate("localStorage.getItem('gondola.sesion')") is None)
    ctx.close()

    # Encargado
    ctx, pg = nueva(); login(pg, 'encargado@prueba.ar')
    ok('R14. Encargado: Hoy, Pedidos, Stock, Recepción', nav(pg) == ['Hoy', 'Pedidos', 'Stock', 'Recepción', 'Más'], str(nav(pg)))
    pg.goto(URL + '#/vencimientos'); pg.wait_for_timeout(700)
    pg.get_by_test_id('lote-alerta').filter(has_text='Venció').first.get_by_role('button', name='Devolver al proveedor').click()
    pg.get_by_role('button', name='Preparar remito').click(); pg.wait_for_timeout(800)
    ok('R15. Encargado prepara devoluciones', pg.get_by_test_id('remito-devolucion').count() == 1)
    pg.keyboard.press('Escape')
    pg.goto(URL + '#/equipo'); pg.wait_for_timeout(600)
    ok('R16. Encargado no administra el equipo', pg.get_by_text('Tu rol no tiene acceso a esta sección.').count() == 1)
    ctx.close()

    # Dueña
    ctx, pg = nueva(); login(pg, 'duena@prueba.ar')
    ok('R17. Dueña entra al Panel', pg.get_by_role('heading', name='Estado del almacén').count() == 1 and nav(pg)[0] == 'Panel', str(nav(pg)))
    pg.goto(URL + '#/equipo'); pg.wait_for_timeout(900)
    ok('R18. Dueña ve su equipo (3 personas, no las de otro almacén)', pg.locator('.item-equipo').count() == 3)
    pg.get_by_label('Rol de empleado@prueba.ar').select_option('encargado'); pg.wait_for_timeout(800)
    ok('R19. Dueña cambia un rol', sql("select rol from miembros m join auth.users u on u.id=m.user_id where u.email='empleado@prueba.ar'") == 'encargado')
    pg.get_by_label('Rol de empleado@prueba.ar').select_option('empleado'); pg.wait_for_timeout(800)
    pg.fill('#eq-email', 'otro@prueba.ar'); pg.get_by_role('button', name='Agregar al equipo').click(); pg.wait_for_timeout(800)
    ok('R20. No puede sumar a alguien de otro almacén', pg.get_by_text('Ese usuario ya pertenece a otro almacén.').count() == 1)
    ctx.close()

    # Otro almacén
    ctx, pg = nueva(); login(pg, 'otro@prueba.ar')
    pg.goto(URL + '#/catalogo'); pg.wait_for_timeout(700)
    ok('R21. Otro almacén no ve los productos de este', pg.get_by_test_id('producto-catalogo').count() == 0)
    ctx.close()

    # Token vencido → se renueva solo
    subprocess.run(['bash', '-c', 'cd /home/claude/work/test && TTL=4 ./servidor.sh'])
    ctx, pg = nueva(); login(pg, 'encargado@prueba.ar')
    t1 = pg.evaluate("JSON.parse(localStorage.getItem('gondola.sesion')).accessToken")
    time.sleep(5)
    pg.goto(URL + '#/catalogo'); pg.wait_for_timeout(300); pg.reload(); pg.wait_for_timeout(1500)
    t2 = pg.evaluate("JSON.parse(localStorage.getItem('gondola.sesion') || 'null')?.accessToken")
    ok('R22. Token vencido se renueva sin pedir login', t2 is not None and t2 != t1 and pg.get_by_test_id('producto-catalogo').count() > 0)
    ctx.close()
    subprocess.run(['bash', '-c', 'cd /home/claude/work/test && ./servidor.sh'])
    b.close()
print(f'\n{sum(res)}/{len(res)} OK')
