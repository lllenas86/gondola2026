# Góndola · Reposición para almacenes

App web **mobile-first** para el dueño o encargado de un almacén de barrio. Responde a la pregunta del momento clave: **"pasa el proveedor, ¿qué tengo y qué le pido?"**.

- **Productos con presentaciones** (473 ml, 1 L…): el stock, el punto de pedido y los proveedores son de cada presentación.
- Inventario inicial y conteos periódicos **sin elegir proveedor**, con lotes por vencimiento y revisión de diferencias.
- Vencimientos y mermas, **devoluciones al proveedor con remito** y bajas, **proyección temporal** del stock y **asistente de pedidos** por WhatsApp.
- Sin usuarios (como antes) o, con `supabase/05`, **login y roles** (empleado, encargado, dueño) protegidos en la base.
- **Los datos se guardan en Supabase** (la nube): se puede usar desde más de un celular. No se guarda nada en el navegador.
- Stack: React 18 + TypeScript (estricto) + Vite 5. Estilos en CSS propio (`src/index.css`), sin librerías de UI. Supabase por su API REST (sin dependencias extra). Lectura de remitos con IA en una función de Vercel (`api/leer-remito.js`).

## Base de datos (Supabase)

Una sola vez, en Supabase → **SQL Editor**:

1. `supabase/01_esquema.sql`: crea las tablas (`productos`, `proveedores`, `producto_proveedor`, `conteos`, `recepciones`, `recepcion_lineas`), las vistas (`v_stock_actual`, `v_visitas_proximas`, `v_vencimientos`, `v_consumo_historico`), las reglas que rechazan datos inválidos, los permisos y el bucket `remitos`.
2. `supabase/02_datos_ejemplo.sql`: carga los datos de prueba y los dos remitos de ejemplo en borrador. **Borra todo lo cargado**: sirve para resetear la demo.
3. `supabase/03_pedido_y_demo.sql`: agrega el teléfono del proveedor (para el pedido por WhatsApp) y la función `gondola_restablecer_demo()`.
4. **`supabase/04_presentaciones_lotes_devoluciones.sql`** (obligatorio para esta versión): presentaciones, lotes, devoluciones, bajas y vistas por presentación. Conserva los datos: cada producto existente recibe una presentación «Única» 1:1 con todo su historial. Se puede volver a correr.
5. **`supabase/05_roles_y_almacenes.sql`** (opcional, cuando quieran usuarios): login, almacenes y roles con políticas RLS. Ver los pasos en el encabezado del archivo.

Detalle de los cambios, pasos de migración y pruebas: [`MEJORAS_2026-10.md`](MEJORAS_2026-10.md).
Después de la 04, la demo se restablece con el botón **Restablecer demo** (02 queda para instalaciones nuevas, antes de la 04).

## Variables de entorno (Vercel → Settings → Environment Variables)

| Variable | Para qué | ¿Pública? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto de Supabase | Sí |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (o `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Clave pública de Supabase | Sí |
| `VISION_API_KEY` | Clave del modelo de IA que lee los remitos (Gemini, Claude u OpenAI) | **No**: solo la usa el servidor |
| `VISION_PROVIDER` (opcional) | `gemini`, `anthropic` u `openai`. Si falta, se deduce de la clave | No |
| `VISION_MODEL` (opcional) | Modelo a usar (por defecto `gemini-2.5-flash`, `claude-sonnet-5-5` o `gpt-4o-mini`) | No |

El proyecto es Vite, pero `vite.config.ts` acepta también las variables `NEXT_PUBLIC_` (y las `VITE_`). Después de cambiar variables hay que hacer **Redeploy**.

Si no hay conexión con la base, la app lo avisa ("Sin conexión con la base: los cambios no se guardan") y no muestra datos inventados. El punto del encabezado indica la conexión: verde = conectado, gris = sin conexión.

## Cómo probarla

**Con Node 18 o superior:**

1. `npm install`
2. Crear `.env.local` con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
3. `npm run dev` → abre `http://localhost:5173` (para probar también la lectura del remito: `vercel dev`)
4. `npm test` → pruebas automáticas de la lógica (stock, lotes, proyección, pedido, remitos)
5. `npm run typecheck` → revisa los tipos
6. `npm run build` → genera `/dist` (lo usa Vercel)

## Subir a GitHub y Vercel

1. En GitHub: **New repository** → nombre en minúsculas (por ejemplo `gondola`).
2. **Add file → Upload files** y arrastrá **todo el contenido** de la carpeta (incluidas las carpetas `src`, `public`, `docs` y `demo`). El botón "choose your files" no sube carpetas: hay que arrastrarlas.
3. En Vercel: **Add New → Project**, elegí el repositorio. Vercel detecta Vite solo. **Deploy**.
4. Para que cualquiera la abra sin iniciar sesión: Settings → Deployment Protection → Vercel Authentication → Disabled. Compartí el dominio de producción, no el de vista previa.

La navegación usa `#` en la URL (`/#/contar`), así que recargar cualquier pantalla nunca da 404 y no hace falta `vercel.json`.

## Pantallas

La barra inferior depende del rol (sin usuarios se ven todas). Las secciones:

| Sección | Qué hace |
| --- | --- |
| **Hoy** (encargado) | Lo que falta pedir agrupado por el proveedor que pasa antes, proveedores de hoy y mañana con **Preparar pedido**, resumen de vencimientos, lo que podría agotarse en 7 días y lo que no se cuenta hace +7 días. |
| **Tareas** (empleado) | Remitos para revisar, qué contar, vencidos para separar de la góndola. |
| **Panel** (dueño) | Inventario y su valor, riesgo de faltantes, vencimientos, mermas de 30 días y consumo/rotación estimados. |
| **Contar** | Todas las presentaciones, sin elegir proveedor. Filtros: sin stock inicial, +7 días, perecederas. Lotes con vencimientos distintos. Antes de guardar muestra **registrado vs. contado** y la diferencia; el historial queda en «Conteos anteriores». |
| **Recepción** | Foto del remito (IA) o carga manual, por presentación. Reconoce el tamaño (500 cc ≠ 2,25 L), aprende los textos que se corrigen a mano y acepta bultos solo si la equivalencia está configurada. |
| **Vencimientos** | Vencido en stock / vence ≤3 días / esta semana, por lote, con valor a costo si hay costo. **Devolver al proveedor** (remito preparada → confirmada → resuelta) o **Dar de baja**. |
| **Proyección** | Control temporal (7/14/30 días): stock estimado por día, quiebre, punto de pedido, vencimientos sin salida; detalle con gráfico y simulación del pedido sugerido. |
| **Pedidos** | Proveedores con próxima visita y **asistente de pedido**: prioridades con su porqué, cantidades editables, mensaje revisable y WhatsApp (nunca envía solo). |
| **Catálogo** | Ficha de producto con sus presentaciones (tamaño, unidad, punto de pedido, costo, bulto, proveedores), **Mover a otro producto** y proveedores. |
| **Equipo** (dueño, con 05) | Usuarios del almacén y su rol. |

## Regla crítica: el stock nunca se sobrescribe

No existe un campo "stock". Cada conteo, recepción, devolución y baja se guarda como registro con fecha y hora, y el stock **de cada presentación** se calcula:

> **Stock = último conteo + recepciones confirmadas después − devoluciones confirmadas después − bajas después.**

Lo calcula la base en `v_stock_presentacion` y la app con la misma regla en `src/lib/inventario.ts` (que además arma los lotes por vencimiento). El conteo es la verdad física: la diferencia con lo registrado queda guardada en el conteo (`stock_registrado`). Sin sistema de ventas, el consumo se estima entre conteos (`v_consumo_presentacion`) y se muestra siempre como estimación.

## Cantidad sugerida a pedir

Está en `src/lib/pedido.ts` (funciones puras). Lo que se pide en una visita tiene que alcanzar hasta la entrega siguiente sin bajar del punto de pedido:

- **Consumo diario** = consumo ÷ días de los últimos períodos entre conteos de esa presentación (vista `v_consumo_presentacion`; descuenta devoluciones y bajas). Los períodos con consumo negativo, que indican una recepción sin registrar, se descartan.
- **Stock en la visita** = proyección desde el último conteo (`src/lib/proyeccion.ts`): resta el consumo estimado día por día y deja de contar lo que vence.
- **Cantidad sugerida** = consumo diario × días hasta la entrega siguiente + punto de pedido − stock en la visita, redondeada hacia arriba. La entrega siguiente es la del mismo proveedor, o la de otro que traiga el mismo producto si pasa antes.
- Sin historial de consumo, se sugiere llegar al doble del punto de pedido, y el asistente lo dice.
- El asistente agrupa por prioridad (alta, conviene, podés sumar) y explica cada ítem con los datos usados. Es un asistente de reglas: no usa IA generativa. Para sumar redacción con un modelo habría que reutilizar la función del servidor (como `api/leer-remito.js`), nunca con la clave en el navegador.

El pedido no se guarda: se registra cuando llega la mercadería, en Recepción.

## Recepción por foto del remito

1. Se saca o sube la foto. Se achica a JPEG de menos de 1,5 MB y se guarda en el bucket `remitos` (si existe).
2. La función del servidor `api/leer-remito.js` se la manda al modelo de visión junto con la lista de productos del catálogo y le pide solo JSON (`proveedor`, `fecha`, `lineas` con `descripcion`, `cantidad`, `fecha_vencimiento`, `confianza`). La clave del modelo (`VISION_API_KEY`) nunca llega al navegador.
3. La app vincula cada línea con una **presentación** del catálogo (`src/lib/match.ts`): primero los textos ya corregidos a mano (alias), después nombre + tamaño; si el tamaño no coincide o el remito no lo dice y hay varias presentaciones, la deja para revisar y crea la recepción **en borrador** (`origen = 'remito_foto'`, respuesta cruda en `datos_ia`, una fila por línea en `recepcion_lineas` con `confianza_ia`; `estado = 'sin_vincular'` si no encontró producto).
4. **Revisión obligatoria**: foto y datos lado a lado. En amarillo, las líneas sin vincular o con confianza menor a 75 %. Las que no están en el catálogo permiten "Crear producto" o "Ignorar".
5. Solo "Confirmar recepción" suma al stock. La base no deja confirmar con líneas sin vincular.
6. Si la imagen es ilegible o el modelo falla: aviso y botón "Cargar a mano".

**Modo demo.** "Usar remito de ejemplo" abre los remitos en borrador de la demo (Lácteos del Sur y Distribuidora Centro):

- Lácteos del Sur: el yogur figura 12 en el remito pero la IA "leyó" 18 con confianza baja (amarillo), y el queso crema no está en el catálogo.
- Distribuidora Centro: trae Coca-Cola en **2,25 L y 500 cc** (dos presentaciones del mismo producto), el agua tiene lectura dudosa y la Fanta no está en el catálogo.

Una vez confirmados dejan de ser borradores; para repetir la demo, **Restablecer demo**.

Las imágenes también están en `docs/remitos-ejemplo/` para probar el camino de la foto.

## Tarea de prueba

> "Mañana pasa Distribuidora Centro. Contá sus productos y cargalos. Después cargá el remito de ejemplo que te dejó Lácteos del Sur y corregí lo que esté mal."

Recorrido esperado: **Contar** (sin elegir proveedor) → cargar las cantidades → «Revisar y guardar» → ver las diferencias → «Guardar conteo» → **Recepción** → "Usar remito de ejemplo · Lácteos del Sur" → ampliar la foto, corregir el yogur a 12, "Crear producto" para el queso crema → "Confirmar recepción". El resumen muestra el stock antes y después (por ejemplo, Leche 30 → 54).

## Historias y criterios de aceptación

| Historia | Criterio | Dónde |
| --- | --- | --- |
| HU1 Registrar productos | Ficha con nombre y perecedero, y una o más presentaciones (tamaño, unidad, punto de pedido, costo, bulto, proveedores) | `features/ProductoFicha.tsx`, `pages/CatalogoPage.tsx` |
| | NEGATIVO: sin nombre o duplicado → mensaje claro; punto de pedido negativo → rechazado (la app y la base) | `lib/validation.ts`, `lib/errores.ts`, `supabase/01_esquema.sql` |
| HU2 Registrar stock | Cantidad por presentación, sin proveedor, fecha y hora, sin borrar anteriores; lotes por vencimiento; diferencias con lo registrado | `pages/ContarPage.tsx`, acción `registrarConteos` (solo agrega) |
| | NEGATIVO: cantidades negativas rechazadas | `validarCantidadConteo` |
| HU3 Administrar proveedores | Nombre, uno o más días, presentaciones asociadas (muchos a muchos) | `features/ProveedorForm.tsx` |
| | NEGATIVO: sin nombre o sin días → no se guarda | `validarProveedor` |
| HU8 Recepción desde foto | Foto, propuesta de proveedor/fecha/líneas, corrección, suma al stock al confirmar | `pages/RecepcionPage.tsx`, `features/RevisionRecepcion.tsx` |
| | NEGATIVO: nada se guarda sin confirmar; imagen ilegible → aviso + carga manual; no se confirma con líneas sin producto (la app y la base) | `api/leer-remito.js`, `lib/remitoIA.ts`, `validarRecepcion` |

## Estructura

```text
api/leer-remito.js            función de Vercel: lectura del remito con IA (clave en el servidor)
supabase/                     01 esquema · 02 datos de ejemplo · 03 pedido y demo · 04 presentaciones, lotes, devoluciones · 05 roles
src/
├── types.ts                  modelo de datos (producto → presentaciones)
├── lib/
│   ├── inventario.ts         stock por presentación, lotes FEFO, consumo estimado, vencimientos (reglas únicas)
│   ├── proyeccion.ts         proyección día por día (simulador y pedido usan la misma)
│   ├── pedido.ts             sugerencia, prioridades y mensaje de WhatsApp
│   ├── vencimientos.ts       alertas por lote y mermas
│   ├── match.ts              vinculación remito ↔ presentación (tamaño y alias)
│   ├── auth.ts, permisos.ts  sesión de Supabase Auth y qué ve cada rol
│   ├── datos.ts, supabase.ts, errores.ts, validation.ts, stock.ts (visitas), dates.ts, router.ts…
│   └── logica.test.ts        pruebas automáticas (Vitest)
├── state/store.tsx           estado global, modo sin usuarios / con usuarios
├── features/                 ficha de producto, revisión de recepción, asistente de pedido, devolución y baja
└── pages/                    Hoy, Tareas, Panel, Contar, Recepción, Vencimientos, Proyección, Pedidos, Catálogo, Equipo, Ingreso
pruebas-locales/              entorno usado para probar de punta a punta (Postgres local + navegador)
```

## Datos de prueba

La demo (botón **Restablecer demo**) trae: Coca-Cola en **2,25 L y 500 ml**, Sprite 2,25 L, Agua 1,5 L (Distribuidora Centro, martes y viernes); Leche entera 1 L y Yogur bebible en **1 L y 190 g** (Lácteos del Sur, lunes, miércoles y viernes); Yerba mate **1 kg y 500 g** (Mayorista Rosario, jueves). Hay lotes con vencimientos distintos, 3 yogures vencidos todavía en stock, una devolución resuelta, una baja, un remito de ejemplo con dos presentaciones de Coca-Cola y una presentación sin costo (para mostrar «valor no calculable»).

## Limitaciones conocidas

- Sin `05`, cualquiera con el link puede ver y cargar datos (la app lo avisa en «Más»). Con `05`, hace falta iniciar sesión y la base aplica los permisos por almacén y rol.
- Con `05`, cada usuario pertenece a un solo almacén. Los usuarios se crean en Supabase → Authentication (no hay registro desde la app).
- El consumo es una estimación entre conteos: sin al menos dos conteos de una presentación no hay proyección para ella.
- Los cambios hechos desde otro celular aparecen al volver a la app o cada 30 segundos.
- «Crear» desde la revisión de un remito agrega el producto al catálogo en ese momento, aunque después se cancele la recepción.
