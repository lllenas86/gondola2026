# Góndola · Etapa 1: correcciones del profesor

Estado: código y migración terminados y probados en una base local idéntica a producción.
Pendiente: ensayar la migración en producción, aplicarla, subir la rama y probar la Preview (ver «Próximos pasos»).

## 1. Ficha única con presentaciones

- Tabla nueva `fichas_producto`: la ficha única (p. ej. «Cerveza Quilmes»).
- La tabla `productos` pasa a representar cada **presentación** («473 ml», «1 L»). Se conservan sus `id`, así que conteos, recepciones, pedidos y proveedores siguen apuntando a la presentación concreta y el historial no se toca.
- Columnas nuevas en `productos`: `ficha_id`, `presentacion`, `contenido`, `unidad_contenido` (ml, l, g, kg, unidad) y `unidades_por_presentacion` (equivalencia: pack x6 = 6).
- `productos.nombre` sigue siendo el nombre completo para mostrar («Cerveza Quilmes 473 ml»), por eso Recepción (lectura de remitos), Pedido y Hoy no cambiaron.
- Migración de datos: cada producto existente recibe su ficha y queda como presentación «Única», 1:1. No se fusiona nada automáticamente.
- «Mover a otro producto» (en la ficha, por presentación): muestra qué se mueve, valida que sea compatible (perecedero, forma de medir, nombre repetido), explica las consecuencias sobre el stock y pide confirmación. La función `gondola_mover_presentacion` vuelve a validar, registra el cambio en `cambios_ficha` y archiva (no borra) la ficha que queda vacía.
- Si una versión anterior de la app crea un producto sin ficha, un trigger le crea la suya («Única»).

## 2. Stock independiente de proveedores

- En el menú, «Contar» pasa a ser **«Stock»**, con las pestañas Conteo de stock, Vencimientos, Devoluciones e Historial. `#/contar` sigue funcionando.
- El conteo lista **todas** las presentaciones. Tiene dos tipos: inventario inicial y conteo periódico. El proveedor es solo un filtro opcional.
- Antes de guardar se muestra la diferencia entre lo registrado y lo contado.
- `gondola_registrar_conteo` guarda una sesión (`sesiones_conteo`) y, en cada fila, el `stock_esperado`, así el ajuste queda trazable. Nunca se sobrescriben conteos.
- Perecederos: una presentación se puede contar en varios lotes, cada uno con su fecha de vencimiento.
- Regla de stock, igual en `v_stock_actual` y en `lib/stock.ts`: último conteo (suma de lotes) + recepciones confirmadas después − salidas después (devoluciones entregadas y bajas).

## 3. Vencimientos y devoluciones

- Vista `v_lotes`: lotes vivos por presentación y fecha, con cantidad neta, recepción de origen y estado (`vencido`, `por_vencer` ≤ 7 días, `vigente`, `sin_fecha`). `v_vencimientos` se mantiene por compatibilidad.
- Tablero: lotes vencidos y por vencer con sus unidades, devoluciones preparadas y esperando respuesta. Para cada lote muestra la acción recomendada y tres acciones directas: ver lote, preparar devolución y dar de baja.
- Devoluciones (`devoluciones`, `devolucion_lineas`). Estados:
  - `preparada`: el remito está armado y **el stock no cambia**.
  - `entregada`: la mercadería salió; recién acá la base descuenta el stock, una sola vez (restricción única por línea).
  - `resuelta`: la respuesta del proveedor (aceptada o rechazada) se registra aparte, porque es una condición comercial que hay que confirmar.
  - `cancelada`: se anula antes de entregar, sin efecto en el stock.
- Remito: se ve en pantalla, se imprime o se guarda como PDF desde el navegador, y se descarga en HTML. Dice explícitamente que **no es un comprobante fiscal**.
- Bajas por descarte: van a `movimientos_stock` con tipo `baja` y quedan diferenciadas de las devoluciones. No pueden dejar el stock negativo y no se editan ni se borran.

## Archivos

- `supabase/04_presentaciones_stock_vencimientos.sql`: migración idempotente y aditiva.
- `supabase/tests/04_pruebas.sql`: pruebas de base, ejecutadas con el rol `anon`. Solo para una base de prueba.
- `supabase/tests/04_simulacion_produccion.sql`: ensayo sobre la base real que no guarda nada.
- Frontend: `src/pages/StockPage.tsx`, `src/features/stock/*`, `src/features/FichaForm.tsx`, `src/features/MoverPresentacion.tsx`, `src/lib/vencimientos.ts`, y cambios en `datos.ts`, `stock.ts`, `types.ts`, `CatalogoPage`, `HoyPage`, `ProductoForm`, `RevisionRecepcion` (ahora conserva los lotes) y `router`.
- Se eliminó `src/lib/seed.ts`: no se usaba y rompía `npm run typecheck`.

## Pruebas ejecutadas

- `npm run typecheck` y `npm run build`: sin errores.
- `04_pruebas.sql`: todas pasan (presentaciones, mover, conteos con lotes y ajustes, vencimientos, devoluciones sin duplicar, bajas, permisos, consumo, restablecer demo).
- La migración corrida dos veces no duplica nada, y el stock de todos los productos queda idéntico antes y después.
- Punta a punta (Playwright, pantalla de celular, base local + API REST tipo PostgREST): 21/21 pasos OK. Cubren las tres correcciones y además Recepción (remito con alta de presentación y carga manual), pedido sugerido, ruta vieja y consola sin errores.

## Respaldo de producción

- Esquema `respaldo_20261025` en el proyecto Supabase «Reposicion_Mercaderia» (org Grupo3): copia de productos, proveedores, producto_proveedor, conteos, recepciones y recepcion_lineas, verificada por checksum (md5) el 25/10/2026.

## Próximos pasos

1. En Supabase → SQL Editor, correr `supabase/tests/04_simulacion_produccion.sql` y esperar un error que empiece con `SIMULACION_OK`.
2. Correr `supabase/04_presentaciones_stock_vencimientos.sql`.
3. Subir la rama `correcciones-profesor-etapa1` y probar la Preview **solo en modo lectura** (la Preview usa la base real).
4. Fusionar a `main` cuando la Preview esté verificada.

## Supuestos

- «Por vencer» = 7 días, igual que la pantalla Hoy.
- Si un proveedor rechaza una devolución ya entregada, el stock no se repone solo. Si la mercadería vuelve, se registra con un conteo.
- El reemplazo de un cambio aceptado entra por Recepción, como cualquier mercadería.
