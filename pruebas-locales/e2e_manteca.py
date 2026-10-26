# Reconocimiento de producto y presentación en la recepción (caso real «Manteca Pepito 200 g").
# Base local aislada (./base_final.sh con-demo) + ficha «Manteca Pepito» con 100 g y 200 g.
# La respuesta de la IA se SIMULA (esto prueba la app, no al modelo).
import os
import json, subprocess
from playwright.sync_api import sync_playwright

URL = 'http://localhost:8787/'
IMG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'remitos') + '/legible.jpg'
res = []
def ok(n, c, d=''):
    res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + (f' — {d}' if d and not c else ''))
def sql(q):
    r = subprocess.run(['psql', '-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'gondola', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], capture_output=True, text=True)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
def stock(pid): return sql(f"select coalesce(stock_actual,0) from v_stock_presentacion where presentacion_id='{pid}'") or '0'

# Ficha existente: Manteca Pepito con 100 g y 200 g (Lácteos del Sur)
sql("""do $$ declare a uuid := (select id from almacenes order by creado_en limit 1); p uuid; v uuid := (select id from proveedores where nombre='Lácteos del Sur');
begin
  insert into productos (nombre, perecedero, almacen_id) values ('Manteca Pepito', true, a) returning id into p;
  insert into presentaciones (producto_id, nombre, contenido, unidad_contenido, punto_pedido, almacen_id) values
    (p, '200 g', 200, 'g', 5, a), (p, '100 g', 100, 'g', 5, a);
  insert into presentacion_proveedor (presentacion_id, proveedor_id, almacen_id) select id, v, a from presentaciones where producto_id = p;
end $$""")
MP200 = sql("select pr.id from presentaciones pr join productos p on p.id=pr.producto_id where p.nombre='Manteca Pepito' and pr.nombre='200 g'")
MP100 = sql("select pr.id from presentaciones pr join productos p on p.id=pr.producto_id where p.nombre='Manteca Pepito' and pr.nombre='100 g'")
productos0 = int(sql('select count(*) from productos'))
otros0 = sql("select string_agg(presentacion_id||'='||coalesce(stock_actual,0), ',' order by presentacion_id) from v_stock_presentacion v join presentaciones p on p.id=v.presentacion_id join productos x on x.id=p.producto_id where x.nombre not ilike 'manteca%'")

IA = {'proveedor': 'LACTEOS DEL SUR', 'fecha': '2026-10-26', 'lineas': [
    {'descripcion': 'MANTECA PEPITO 200 GR', 'cantidad': 10, 'fecha_vencimiento': None, 'confianza': 0.95},
    {'descripcion': 'Manteca Pepito 200 gramos', 'cantidad': 5, 'fecha_vencimiento': None, 'confianza': 0.95},
    {'descripcion': 'MANTECA PEPITO 500 GR', 'cantidad': 4, 'fecha_vencimiento': None, 'confianza': 0.95},
    {'descripcion': 'MANTECA LA SERENISIMA 200 GR', 'cantidad': 6, 'fecha_vencimiento': None, 'confianza': 0.95},
    {'descripcion': 'MANTECA PEPITO', 'cantidad': 3, 'fecha_vencimiento': None, 'confianza': 0.9}]}

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1100, 'height': 1000}); errores = []
    pg.on('pageerror', lambda e: errores.append(str(e))); pg.on('dialog', lambda d: d.accept())
    pg.route('**/api/leer-remito', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps(IA)))
    pg.goto(URL); pg.wait_for_timeout(1500)
    pg.locator('section[aria-label="Acceso rápido para evaluación"] button', has_text='Empleado').click(); pg.wait_for_timeout(2500)
    pg.goto(URL + '#/recepcion'); pg.wait_for_timeout(1200)
    pg.locator('[data-testid=subir-imagen]').set_input_files(IMG); pg.wait_for_timeout(2500)
    L = pg.get_by_test_id('linea-recepcion')
    linea = lambda t: L.filter(has=pg.locator('.linea-remito', has_text=t))
    sel = lambda loc: loc.locator('select').first.evaluate('s => s.value')

    l1, l2, l3, l4, l5 = linea('MANTECA PEPITO 200 GR'), linea('200 gramos'), linea('500 GR'), linea('SERENISIMA'), L.nth(4)
    ok('C1. «Manteca Pepito 200 gr» → ficha Manteca Pepito, presentación 200 g, sin revisión', sel(l1) == MP200 and l1.get_by_role('button', name='Está bien').count() == 0)
    ok('C2. «Manteca Pepito 200 gramos» → la misma presentación', sel(l2) == MP200)
    ok('C3. «500 gr» no se asigna a la de 200 g y ofrece agregar la presentación a la ficha', sel(l3) == '' and l3.get_by_test_id('agregar-presentacion').count() == 1,
       l3.get_by_test_id('agregar-presentacion').all_inner_texts())
    ok('C4. Otra marca (La Serenísima) no se asocia a Pepito: ofrece crear, sin «agregar a Pepito»', sel(l4) == '' and l4.get_by_test_id('agregar-presentacion').count() == 0 and l4.get_by_role('button', name='Crear').count() == 1)
    ops = l5.get_by_test_id('opcion-presentacion').all_inner_texts()
    ok('C5. «Manteca Pepito» sin tamaño: no elige sola, muestra las dos opciones', sel(l5) == '' and sorted(ops) == ['Manteca Pepito 100 g', 'Manteca Pepito 200 g'], str(ops))

    # Sin resolver no se puede confirmar
    pg.get_by_role('button', name='Confirmar recepción').click(); pg.wait_for_timeout(800)
    ok('C5b. Con líneas sin resolver no confirma ni toca el stock', pg.locator('.barra-error').count() == 1 and stock(MP200) == '0')

    # C3: agregar 500 g a la ficha existente
    l3.get_by_test_id('agregar-presentacion').click(); pg.wait_for_timeout(500)
    titulo = pg.locator('.hoja h2, [role=dialog] h2').first.inner_text() if pg.locator('.hoja h2, [role=dialog] h2').count() else ''
    ok('C3b. Abre «Nueva presentación · Manteca Pepito» con «500 g» precargado', 'Manteca Pepito' in pg.locator('body').inner_text() and pg.input_value('#alta-nombre') == '500 g', f"{titulo} / {pg.input_value('#alta-nombre')}")
    pg.fill('#alta-cont', '500'); pg.select_option('#alta-ucont', 'g'); pg.fill('#alta-punto', '2')
    pg.get_by_role('button', name='Agregar presentación').click(); pg.wait_for_timeout(1500)
    MP500 = sql("select pr.id from presentaciones pr join productos p on p.id=pr.producto_id where p.nombre='Manteca Pepito' and pr.nombre='500 g'")
    ok('C3c. La presentación 500 g queda en la ficha Manteca Pepito y la línea la usa', MP500 != '' and sel(l3) == MP500)

    # C4: crear la otra marca; primero se intenta un nombre que es la misma ficha escrita distinto
    l4.get_by_role('button', name='Crear').click(); pg.wait_for_timeout(500)
    ok('C4b. El alta propone el nombre SIN el tamaño y la presentación 200 g', pg.input_value('#alta-producto-nombre').lower() == 'manteca la serenisima' and pg.input_value('#alta-nombre') == '200 g',
       f"{pg.input_value('#alta-producto-nombre')} / {pg.input_value('#alta-nombre')}")
    pg.fill('#alta-producto-nombre', 'MANTECA PEPITO 200 GR'); pg.fill('#alta-punto', '2')
    pg.get_by_role('button', name='Crear producto').click(); pg.wait_for_timeout(800)
    ok('C4c. No deja crear «Manteca Pepito 200 gr» como ficha aparte', 'Ya existe «Manteca Pepito»' in pg.locator('body').inner_text() and sql("select count(*) from productos where nombre ilike 'manteca pepito%'") == '1')
    pg.fill('#alta-producto-nombre', 'Manteca La Serenísima')
    pg.get_by_role('button', name='Crear producto').click(); pg.wait_for_timeout(1500)
    MS200 = sql("select pr.id from presentaciones pr join productos p on p.id=pr.producto_id where p.nombre='Manteca La Serenísima'")
    ok('C4d. La otra marca se crea como ficha propia y la línea la usa', MS200 != '' and sel(l4) == MS200)

    # C6: corrección manual (elige 100 g con el desplegable)
    l5.locator('select').first.select_option(MP100); pg.wait_for_timeout(300)
    ok('C6. Corrección manual: la línea queda con la presentación elegida (id)', sel(l5) == MP100)

    s200, s100 = int(float(stock(MP200))), int(float(stock(MP100)))
    pg.get_by_role('button', name='Confirmar recepción').dblclick(); pg.wait_for_timeout(2500)
    ok('R1. 200 g suma 10 + 5 una sola vez', int(float(stock(MP200))) == s200 + 15, stock(MP200))
    ok('R2. 500 g suma 4, 100 g suma 3, La Serenísima 200 g suma 6', (stock(MP500), stock(MP100), stock(MS200)) in [('4', str(s100 + 3), '6'), ('4.0', str(s100 + 3), '6.0')] or (float(stock(MP500)), float(stock(MP100)), float(stock(MS200))) == (4, s100 + 3, 6),
       f"{stock(MP500)} {stock(MP100)} {stock(MS200)}")
    lin = sql("select string_agg(l.presentacion_id||':'||l.cantidad, ',' order by l.cantidad) from recepcion_lineas l join recepciones r on r.id=l.recepcion_id where r.estado='confirmada' and r.fecha='2026-10-26'")
    esperado = ','.join(sorted([f'{MP100}:3', f'{MP500}:4', f'{MS200}:6', f'{MP200}:15'], key=lambda x: int(x.split(':')[1])))
    ok('R3. La recepción guarda las presentaciones correctas por id (sin duplicar)', lin.replace('.000', '').replace('.00', '') == esperado, lin)
    ok('R4. Solo se creó la ficha de la otra marca (ninguna «Manteca 200 gr»)', int(sql('select count(*) from productos')) == productos0 + 1 and sql("select count(*) from productos where nombre ~* '\\d'  and nombre ilike 'manteca%'") == '0')
    otros = sql("select string_agg(presentacion_id||'='||coalesce(stock_actual,0), ',' order by presentacion_id) from v_stock_presentacion v join presentaciones p on p.id=v.presentacion_id join productos x on x.id=p.producto_id where x.nombre not ilike 'manteca%'")
    ok('R5. No cambió el stock de ningún otro producto', otros == otros0)

    # Cancelar otra lectura igual: no cambia nada
    antes = sql("select string_agg(presentacion_id||'='||coalesce(stock_actual,0), ',' order by presentacion_id) from v_stock_presentacion")
    pg.goto(URL + '#/hoy'); pg.wait_for_timeout(400); pg.goto(URL + '#/recepcion'); pg.wait_for_timeout(1000)
    pg.locator('[data-testid=subir-imagen]').set_input_files(IMG); pg.wait_for_timeout(2500)
    pg.get_by_role('button', name='Cancelar').click(); pg.wait_for_timeout(1200)
    ok('R6. Cancelar una recepción no cambia el stock', sql("select string_agg(presentacion_id||'='||coalesce(stock_actual,0), ',' order by presentacion_id) from v_stock_presentacion") == antes)
    ok('Sin errores de JavaScript', not errores, '; '.join(errores[:3]))
    b.close()
print(f'{sum(res)}/{len(res)} OK')
