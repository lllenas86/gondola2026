# Dos pestañas con la misma sesión: si en una se cambia de perfil o se cierra sesión, la otra la sigue.
from playwright.sync_api import sync_playwright
U = 'http://localhost:8787/'
res = []
def ok(n, c, d=''):
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (f' — {d}' if d and not c else ''))
nav = lambda pg: [t.strip() for t in pg.locator('.nav-inferior a span').all_inner_texts()]
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844})
    a = ctx.new_page(); a.goto(U); a.wait_for_timeout(1500)
    a.locator('section[aria-label="Acceso rápido para evaluación"] button', has_text='Dueña').click(); a.wait_for_timeout(2500)
    bb = ctx.new_page(); bb.goto(U); bb.wait_for_timeout(2000)
    ok('P1. La segunda pestaña abre con la misma sesión (Dueña)', nav(bb)[:1] == ['Panel'])
    bb.goto(U + '#/mas'); bb.wait_for_timeout(800); bb.get_by_role('button', name='Cerrar sesión').click(); bb.wait_for_timeout(2000)
    ok('P2. Cerrar sesión en B → A vuelve al ingreso (no sigue mostrando datos)', a.get_by_role('heading', name='Ingresá a tu almacén').count() == 1)
    bb.locator('section[aria-label="Acceso rápido para evaluación"] button', has_text='Encargado').click(); bb.wait_for_timeout(3000)
    ok('P3. Entrar como Encargado en B → A pasa a ser Encargado', nav(a) == ['Hoy', 'Pedidos', 'Stock', 'Recepción', 'Más'], str(nav(a)))
    a.goto(U + '#/hoy'); a.wait_for_timeout(1500)
    ok('P4. A funciona sin «Falta tu almacén» ni «Sin conexión»', 'Falta tu almacén' not in a.locator('body').inner_text() and a.locator('.banner-conexion').count() == 0)
    b.close()
print(f'{sum(res)}/{len(res)} OK')
