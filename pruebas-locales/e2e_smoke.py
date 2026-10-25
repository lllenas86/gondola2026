# Recorre todas las pantallas en un celular (390 px) y junta errores de consola.
import sys
from playwright.sync_api import sync_playwright
URL = 'http://localhost:8787/'
errores = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    pg.on('console', lambda m: errores.append(m.text) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errores.append(str(e)))
    for s in ['hoy', 'contar', 'recepcion', 'vencimientos', 'proyeccion', 'pedidos', 'catalogo', 'panel', 'mas']:
        pg.goto(URL + '#/' + s)
        pg.wait_for_timeout(900)
        pg.screenshot(path=f'/home/claude/work/test/capturas/{s}.png', full_page=True)
        ancho = pg.evaluate('document.documentElement.scrollWidth')
        print(s, 'ancho', ancho, 'h1:', pg.locator('h1').first.inner_text())
    b.close()
print('ERRORES:', errores)
