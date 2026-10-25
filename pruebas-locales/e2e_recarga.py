# Recargas rápidas y dos pestañas: la app no tiene que quedar "Sin conexión" (modo sin usuarios, base con 04).
from playwright.sync_api import sync_playwright
URL = 'http://localhost:8787/'
res = []
def ok(n, c, d=''):
    res.append(c); print(('PASS ' if c else 'FAIL ') + n + (f' — {d}' if d and not c else ''))
def conectada(pg):
    pg.wait_for_timeout(2500)
    return pg.locator('.estado-conexion.conectado').count() >= 1 and pg.locator('.banner-conexion').count() == 0 and pg.locator('.nav-inferior').count() == 1
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 390, 'height': 844})
    pg = ctx.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(URL + '#/hoy')
    for _ in range(5):
        pg.reload(wait_until='commit'); pg.wait_for_timeout(120)
    ok('RC1. Cinco recargas seguidas: queda conectada', conectada(pg), pg.locator('body').inner_text()[:120])
    pg2 = ctx.new_page(); pg2.on('pageerror', lambda e: errs.append(str(e)))
    pg2.goto(URL + '#/contar')
    ok('RC2. Segunda pestaña abierta a la vez: ambas conectadas', conectada(pg2) and conectada(pg))
    pg.reload(); pg2.reload()
    ok('RC3. Recargar las dos pestañas juntas: ambas conectadas', conectada(pg) and conectada(pg2))
    ok('Sin errores de JavaScript', not errs, '; '.join(errs[:3]))
    b.close()
print(f'{sum(res)}/{len(res)} OK')
