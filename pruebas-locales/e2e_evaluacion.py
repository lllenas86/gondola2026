# App final: acceso rápido para evaluación (3 cuentas reales), sesión, y permisos por rol
# verificados en la BASE (no solo en la pantalla). Base: ./base_final.sh con-demo · App: ./servidor.sh
import subprocess
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8787/'
CUENTAS = {'Dueña': 'duena.gondola@example.com', 'Encargado': 'encargado.gondola@example.com', 'Empleado': 'empleado.gondola@example.com'}
res = []
def ok(n, c, d=''):
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (f' — {d}' if d and not c else ''))
def sql(q):
    r = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'gondola', '-At', '-c', q], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844})
    pg = ctx.new_page(); errores = []
    pg.on('pageerror', lambda e: errores.append(str(e))); pg.on('dialog', lambda d: d.accept())
    def nav(page=None): return [t.strip() for t in (page or pg).locator('.nav-inferior a span').all_inner_texts()]
    def en_login(page=None): return (page or pg).get_by_role('heading', name='Ingresá a tu almacén').count() == 1
    def acceso(rol):
        pg.locator('section[aria-label="Acceso rápido para evaluación"] button', has_text=rol).click(); pg.wait_for_timeout(2000)
    def salir():
        pg.goto(URL + '#/mas'); pg.wait_for_timeout(700); pg.get_by_role('button', name='Cerrar sesión').click(); pg.wait_for_timeout(1000)
    def api(metodo, ruta, cuerpo=None):
        return pg.evaluate("""async ([m, r, c]) => { const s = JSON.parse(localStorage.getItem('gondola.sesion') || 'null');
          const h = { apikey: 'test', 'Content-Type': 'application/json', Prefer: 'return=representation' };
          if (s) h.Authorization = 'Bearer ' + s.accessToken;
          const res = await fetch('/rest/v1/' + r, { method: m, headers: h, body: c ? JSON.stringify(c) : undefined });
          return { status: res.status, body: await res.text() }; }""", [metodo, ruta, cuerpo])

    pg.goto(URL); pg.wait_for_timeout(1500)
    ok('E1. Sin sesión: pantalla de ingreso, sin datos', en_login() and pg.locator('.nav-inferior').count() == 0)
    r = api('GET', 'productos?select=id&limit=1')
    ok('E2. Sin sesión la base no entrega datos (403)', r['status'] == 403, str(r))
    sec = pg.locator('section[aria-label="Acceso rápido para evaluación"]')
    ok('E3. «Acceso rápido para evaluación» con los tres perfiles y la clave', sec.count() == 1 and all(sec.get_by_text(k, exact=False).count() >= 1 for k in CUENTAS) and sec.get_by_text('demo1234').count() == 1)
    ok('E4. Sin cartel de modo demo ni botón de reinicio', 'MODO DEMO' not in pg.locator('body').inner_text() and pg.get_by_role('button', name='Reiniciar demo').count() == 0)
    pg.fill('#ing-email', CUENTAS['Empleado']); pg.fill('#ing-pass', 'otra'); pg.get_by_role('button', name='Ingresar').click(); pg.wait_for_timeout(1000)
    ok('E5. Clave incorrecta: no entra', en_login() and pg.locator('.form-error').count() == 1)

    # ---- Empleado ----
    acceso('Empleado')
    ok('E6. Empleado entra con un toque a su vista (Tareas, Stock, Recepción, Vencimientos)', nav() == ['Tareas', 'Stock', 'Recepción', 'Vencimientos', 'Más'], str(nav()))
    pres = sql("select id from presentaciones where nombre='1 L' and producto_id=(select id from productos where nombre='Leche entera')")
    prov = sql("select id from proveedores where nombre='Lácteos del Sur'")
    r = api('POST', 'conteos', {'presentacion_id': pres, 'cantidad': 30})
    ok('E7. Empleado puede contar (la base acepta)', r['status'] in (200, 201) and r['body'].startswith('[{'), r['body'][:100])
    r = api('POST', 'bajas', {'presentacion_id': pres, 'cantidad': 1, 'motivo': 'vencido'})
    ok('E8. Empleado NO puede dar de baja (la base rechaza)', r['status'] >= 400, r['body'][:100])
    r = api('POST', 'devoluciones', {'proveedor_id': prov, 'motivo': 'vencido'})
    ok('E9. Empleado NO puede crear devoluciones (la base rechaza)', r['status'] >= 400, r['body'][:100])
    r = api('PATCH', f'proveedores?id=eq.{prov}', {'nombre': 'Hackeado'})
    ok('E10. Empleado NO puede editar proveedores', r['body'] == '[]' and sql(f"select nombre from proveedores where id='{prov}'") == 'Lácteos del Sur', r['body'][:80])
    pg.goto(URL + '#/pedidos'); pg.wait_for_timeout(700)
    ok('E11. Empleado no entra a Pedidos ni por URL', pg.get_by_text('Tu rol no tiene acceso a esta sección.').count() == 1)
    salir()
    ok('E12. Cerrar sesión vuelve al ingreso', en_login())

    # ---- Encargado ----
    acceso('Encargado')
    ok('E13. Encargado entra a su vista (Hoy, Pedidos, Stock, Recepción)', nav() == ['Hoy', 'Pedidos', 'Stock', 'Recepción', 'Más'], str(nav()))
    r = api('POST', 'bajas', {'presentacion_id': pres, 'cantidad': 1, 'motivo': 'danado', 'nota': 'prueba e2e'})
    ok('E14. Encargado puede dar de baja', r['status'] in (200, 201) and r['body'].startswith('[{'), r['body'][:100])
    r = api('POST', 'rpc/gondola_guardar_miembro', {'p_email': 'otro@prueba.ar', 'p_rol': 'empleado'})
    ok('E15. Encargado NO puede administrar el equipo', r['status'] >= 400, r['body'][:100])
    pg.goto(URL + '#/equipo'); pg.wait_for_timeout(700)
    ok('E16. Encargado no entra a Equipo ni por URL', pg.get_by_text('Tu rol no tiene acceso a esta sección.').count() == 1)
    salir()

    # ---- Dueña ----
    acceso('Dueña')
    ok('E17. Dueña entra a su vista (Panel, Vencimientos, Proyección, Pedidos)', nav() == ['Panel', 'Vencimientos', 'Proyección', 'Pedidos', 'Más'], str(nav()))
    st = sql(f"select stock_actual from v_stock_presentacion where presentacion_id='{pres}'")
    ok('E18. La dueña ve lo que hicieron empleado y encargado (30 contados − 1 baja = 29)', st == '29', st)
    r = api('POST', 'rpc/gondola_guardar_miembro', {'p_email': CUENTAS['Encargado'], 'p_rol': 'empleado'})
    ok('E19. Las cuentas de evaluación están protegidas (no se les cambia el rol)', r['status'] >= 400 and 'evaluación' in r['body'], r['body'][:120])
    r = api('POST', 'rpc/gondola_restablecer_demo', {})
    ok('E20. El reinicio de datos no se puede ejecutar desde la app', r['status'] >= 400, r['body'][:100])
    pg.goto(URL + '#/equipo'); pg.wait_for_timeout(900)
    ok('E21. Dueña ve la pantalla Equipo con las tres cuentas', all(pg.get_by_text(e).count() >= 1 for e in CUENTAS.values()))

    # ---- Sesión: recargas y dos pestañas ----
    pg.reload(); pg.wait_for_timeout(2000)
    ok('E22. Al recargar sigue con su sesión', not en_login() and nav()[0] == 'Panel')
    for _ in range(5):
        pg.reload(wait_until='commit'); pg.wait_for_timeout(120)
    pg.wait_for_timeout(2500)
    ok('E23. Cinco recargas seguidas: sigue conectada', nav()[:1] == ['Panel'] and pg.locator('.banner-conexion').count() == 0)
    pg2 = ctx.new_page(); pg2.goto(URL + '#/vencimientos'); pg2.wait_for_timeout(2500)
    ok('E24. Segunda pestaña: misma sesión, funciona', nav(pg2)[:1] == ['Panel'] and pg2.locator('.banner-conexion').count() == 0)
    pg2.close()
    ok('E25. Sin errores de JavaScript', not errores, '; '.join(errores[:3]))
    b.close()
print(f'{sum(res)}/{len(res)} OK')
