# Góndola · Reposición para almacenes

App web **mobile-first** para el dueño o encargado de un almacén de barrio. Responde a la pregunta del momento clave: **"pasa el proveedor, ¿qué tengo y qué le pido?"**.

- Un solo comercio, sin login.
- **Los datos se guardan en Supabase** (la nube): se puede usar desde más de un celular. No se guarda nada en el navegador.
- Stack: React 18 + TypeScript (estricto) + Vite 5. Estilos en CSS propio (`src/index.css`), sin librerías de UI. Supabase por su API REST (sin dependencias extra). Lectura de remitos con IA en una función de Vercel (`api/leer-remito.js`).

## Base de datos (Supabase)

Una sola vez, en Supabase → **SQL Editor**:

1. `supabase/01_esquema.sql`: crea las tablas (`productos`, `proveedores`, `producto_proveedor`, `conteos`, `recepciones`, `recepcion_lineas`), las vistas (`v_stock_actual`, `v_visitas_proximas`, `v_vencimientos`, `v_consumo_historico`), las reglas que rechazan datos inválidos, los permisos y el bucket `remitos`.
2. `supabase/02_datos_ejemplo.sql`: carga los datos de prueba y los dos remitos de ejemplo en borrador. **Borra todo lo cargado**: sirve para resetear la demo.
3. `supabase/03_pedido_y_demo.sql`: agrega el teléfono del proveedor (para el pedido por WhatsApp) y la función `gondola_restablecer_demo()`, que usa el botón **Restablecer demo** de la app. Sin este paso la app funciona igual, pero sin teléfono y el botón avisa que falta correrlo.

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
3. `npm run typecheck` → revisa los tipos
4. `npm run build` → genera `/dist` (lo usa Vercel)

## Subir a GitHub y Vercel

1. En GitHub: **New repository** → nombre en minúsculas (por ejemplo `gondola`).
2. **Add file → Upload files** y arrastrá **todo el contenido** de la carpeta (incluidas las carpetas `src`, `public`, `docs` y `demo`). El botón "choose your files" no sube carpetas: hay que arrastrarlas.
3. En Vercel: **Add New → Project**, elegí el repositorio. Vercel detecta Vite solo. **Deploy**.
4. Para que cualquiera la abra sin iniciar sesión: Settings → Deployment Protection → Vercel Authentication → Disabled. Compartí el dominio de producción, no el de vista previa.

La navegación usa `#` en la URL (`/#/contar`), así que recargar cualquier pantalla nunca da 404 y no hace falta `vercel.json`.

## Pantallas

| Barra inferior | Qué hace |
| --- | --- |
| **Hoy** | 1) **Te falta pedir** (siempre visible, cualquier día): productos bajo el punto de pedido, agrupados por el proveedor que pasa antes ("Lo trae Lácteos del Sur · pasa el lunes 26/10"). Si no falta nada: "Todo en orden ✓" y la próxima visita. 2) Pasan hoy y mañana. 3) Por vencer (7 días). 4) Sin contar hace +7 días. Cada producto muestra **"Sugerido: pedir N"** y cada proveedor tiene **Armar pedido**: cantidades editables, **Enviar por WhatsApp** o **Copiar pedido**. |
| **Contar** | Elegís el proveedor y cargás la cantidad (con botones − / +) y, en perecederos, el vencimiento. "Guardar conteo" guarda todos los completados de una vez. |
| **Recepción** | **Sacar foto** del remito (lectura real con IA), remito de ejemplo (borradores guardados en la base) o carga manual. Pantalla de revisión obligatoria y últimas recepciones. |
| **Catálogo** | Productos y proveedores: alta, edición, días de visita, WhatsApp del proveedor y asociación muchos a muchos. Al final, **Restablecer demo** (también aparece en Recepción cuando ya se usaron los remitos de ejemplo). |

## Regla crítica: el stock nunca se sobrescribe

No existe un campo "stock". Cada conteo y cada recepción se guardan como registros con fecha y hora, y el stock se calcula:

> **Stock actual = último conteo + recepciones registradas después de ese conteo.**

Lo calcula la base en la vista `v_stock_actual` (y la app con la misma regla en `src/lib/stock.ts`). El historial completo queda en `conteos` y `recepciones`; `v_consumo_historico` deja listo el consumo entre conteos para la futura recomendación (HU7).

## Cantidad sugerida a pedir

Está en `src/lib/pedido.ts` (funciones puras). Lo que se pide en una visita tiene que alcanzar hasta la entrega siguiente sin bajar del punto de pedido:

- **Consumo diario** = consumo ÷ días de los últimos períodos entre conteos (vista `v_consumo_historico`). Los períodos con consumo negativo, que indican una recepción sin registrar, se descartan.
- **Stock en la visita** = stock actual − consumo diario × días hasta la visita.
- **Cantidad sugerida** = consumo diario × días hasta la entrega siguiente + punto de pedido − stock en la visita, redondeada hacia arriba. La entrega siguiente es la del mismo proveedor, o la de otro que traiga el mismo producto si pasa antes.
- Sin historial de consumo, se sugiere llegar al doble del punto de pedido.

El pedido no se guarda: se registra cuando llega la mercadería, en Recepción.

## Recepción por foto del remito

1. Se saca o sube la foto. Se achica a JPEG de menos de 1,5 MB y se guarda en el bucket `remitos` (si existe).
2. La función del servidor `api/leer-remito.js` se la manda al modelo de visión junto con la lista de productos del catálogo y le pide solo JSON (`proveedor`, `fecha`, `lineas` con `descripcion`, `cantidad`, `fecha_vencimiento`, `confianza`). La clave del modelo (`VISION_API_KEY`) nunca llega al navegador.
3. La app vincula cada línea con el catálogo por similitud de nombre (`src/lib/match.ts`) y crea la recepción **en borrador** (`origen = 'remito_foto'`, respuesta cruda en `datos_ia`, una fila por línea en `recepcion_lineas` con `confianza_ia`; `estado = 'sin_vincular'` si no encontró producto).
4. **Revisión obligatoria**: foto y datos lado a lado. En amarillo, las líneas sin vincular o con confianza menor a 75 %. Las que no están en el catálogo permiten "Crear producto" o "Ignorar".
5. Solo "Confirmar recepción" suma al stock. La base no deja confirmar con líneas sin vincular.
6. Si la imagen es ilegible o el modelo falla: aviso y botón "Cargar a mano".

**Modo demo.** "Usar remito de ejemplo" abre los remitos en borrador que carga `02_datos_ejemplo.sql` (Lácteos del Sur y Distribuidora Centro):

- Lácteos del Sur: el yogur figura 12 en el remito pero la IA "leyó" 18 con confianza baja (amarillo), y el queso crema no está en el catálogo.
- Distribuidora Centro: el agua tiene lectura dudosa y la Fanta no está en el catálogo.

Una vez confirmados dejan de ser borradores; para repetir la demo, se vuelve a correr `02_datos_ejemplo.sql`.

Las imágenes también están en `docs/remitos-ejemplo/` para probar el camino de la foto.

## Tarea de prueba

> "Mañana pasa Distribuidora Centro. Contá sus productos y cargalos. Después cargá el remito de ejemplo que te dejó Lácteos del Sur y corregí lo que esté mal."

Recorrido esperado: **Hoy** → "Contar productos de este proveedor" en Distribuidora Centro → cargar las 3 cantidades → "Guardar conteo" → **Recepción** → "Usar remito de ejemplo · Lácteos del Sur" → ampliar la foto, corregir el yogur a 12, "Crear producto" para el queso crema → "Confirmar recepción". El resumen muestra el stock antes y después (por ejemplo, Leche 30 → 54).

## Historias y criterios de aceptación

| Historia | Criterio | Dónde |
| --- | --- | --- |
| HU1 Registrar productos | Alta con nombre, unidad, perecedero y punto de pedido; aparece en el listado | `features/ProductoForm.tsx`, `pages/CatalogoPage.tsx` |
| | NEGATIVO: sin nombre o duplicado → mensaje claro; punto de pedido negativo → rechazado (la app y la base) | `lib/validation.ts`, `lib/errores.ts`, `supabase/01_esquema.sql` |
| HU2 Registrar stock | Cantidad por producto, fecha y hora, sin borrar anteriores; vencimiento en perecederos | `pages/ContarPage.tsx`, acción `registrarConteos` (solo agrega) |
| | NEGATIVO: cantidades negativas rechazadas | `validarCantidadConteo` |
| HU3 Administrar proveedores | Nombre, uno o más días, productos asociados (muchos a muchos) | `features/ProveedorForm.tsx` |
| | NEGATIVO: sin nombre o sin días → no se guarda | `validarProveedor` |
| HU8 Recepción desde foto | Foto, propuesta de proveedor/fecha/líneas, corrección, suma al stock al confirmar | `pages/RecepcionPage.tsx`, `features/RevisionRecepcion.tsx` |
| | NEGATIVO: nada se guarda sin confirmar; imagen ilegible → aviso + carga manual; no se confirma con líneas sin producto (la app y la base) | `api/leer-remito.js`, `lib/remitoIA.ts`, `validarRecepcion` |

## Estructura

```text
api/leer-remito.js            función de Vercel: lectura del remito con IA (clave en el servidor)
supabase/                     01_esquema.sql (tablas, vistas, reglas), 02_datos_ejemplo.sql y 03_pedido_y_demo.sql
src/
├── types.ts                  modelo de datos
├── lib/
│   ├── supabase.ts           conexión con Supabase (API REST y Storage) y variables de entorno
│   ├── datos.ts              lectura y escritura de cada tabla y vista
│   ├── errores.ts            errores de la base → mensajes en lenguaje simple
│   ├── stock.ts              cálculo de stock y próximas visitas
│   ├── pedido.ts             cantidad sugerida y mensaje de WhatsApp
│   ├── match.ts              vinculación remito ↔ catálogo por similitud
│   ├── validation.ts         reglas y mensajes de validación
│   ├── remitoIA.ts           llamada a /api/leer-remito
│   ├── storage.ts, router.ts, dates.ts, imagen.ts
├── demo/remitos.ts           dibujo de los remitos de ejemplo (SVG)
├── state/store.tsx           estado global: lee Supabase, estado de conexión
├── components/               ícono, hoja inferior, campos, avisos, indicador de conexión
├── features/                 formularios, pantalla de revisión, hoja de pedido y restablecer demo
└── pages/                    Hoy, Contar, Recepción, Catálogo
```

## Datos de prueba

Distribuidora Centro (martes y viernes): Coca-Cola 2,25 L, Sprite 2,25 L, Agua mineral 1,5 L. Lácteos del Sur (lunes, miércoles y viernes): Leche entera 1 L y Yogur bebible 1 L (perecederos). Mayorista Rosario (jueves): Yerba 1 kg y Coca-Cola 2,25 L. Hay conteos de las últimas 3 semanas y 3 recepciones pasadas. Las fechas se calculan desde el día en que se corre `02_datos_ejemplo.sql`; la Yerba se contó hace 9 días para que aparezca como "sin contar".

## Limitaciones conocidas

- Sin login (fuera de alcance): cualquiera con el link puede ver y cargar datos, y también restablecer la demo. La base no permite borrar conteos, productos, proveedores ni recepciones de otra forma. El paso siguiente es tener usuarios por almacén.
- Los cambios hechos desde otro celular aparecen al volver a la app o cada 30 segundos.
- "Crear producto" desde la revisión agrega el producto al catálogo en ese momento, aunque después se cancele la recepción.
- Si un proveedor trae un producto que no tenía asociado, al confirmar se asocia automáticamente.
