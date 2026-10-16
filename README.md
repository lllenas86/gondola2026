# Góndola · Reposición para almacenes

App web **mobile-first** para el dueño o encargado de un almacén de barrio. Responde a la pregunta del momento clave: **"pasa el proveedor, ¿qué tengo y qué le pido?"**.

- Un solo comercio, sin login, sin integraciones.
- Datos de prueba precargados. Todo se guarda en el navegador (`localStorage`, clave `gondola-almacen-v1`).
- Stack: React 18 + TypeScript (estricto) + Vite 5. Estilos en CSS propio (`src/index.css`), sin librerías de UI.

## Cómo probarla

**Sin instalar nada:** abrí `demo/Gondola-demo.html` con doble clic. Es un solo archivo, funciona sin internet y se puede pasar al celular.

**Con Node 18 o superior:**

1. `npm install`
2. `npm run dev` → abre `http://localhost:5173`
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
| **Hoy** | Proveedores que pasan hoy y mañana con sus productos, stock actual y fecha del último conteo. Rojo: stock ≤ punto de pedido. Ámbar: sin conteo en los últimos 7 días. Vencimientos próximos. Botón "Contar productos de este proveedor". |
| **Contar** | Elegís el proveedor y cargás la cantidad (con botones − / +) y, en perecederos, el vencimiento. "Guardar conteo" guarda todos los completados de una vez. |
| **Recepción** | Foto del remito (cámara o imagen), remito de ejemplo (modo demo) o carga manual. Pantalla de revisión obligatoria y últimas recepciones. |
| **Catálogo** | Productos y proveedores: alta, edición, días de visita y asociación muchos a muchos. "Restablecer datos de ejemplo" al final. |

## Regla crítica: el stock nunca se sobrescribe

No existe un campo "stock". Cada conteo y cada recepción se guardan como registros con fecha y hora, y el stock se calcula:

> **Stock actual = último conteo + recepciones registradas después de ese conteo.**

Está en `src/lib/stock.ts` (`calcularStock`). El historial completo queda en `conteos` y `recepciones`, listo para la futura recomendación con IA.

## Recepción por foto del remito

1. Se saca o sube la foto. Se achica a 1400 px en JPEG para que entre en el navegador.
2. Un modelo de IA con visión la lee (ver abajo).
3. Cada línea se vincula con el catálogo por similitud de nombre (`src/lib/match.ts`): entiende abreviaturas ("YOG. BEB." → Yogur bebible), tildes y medidas ("1500 CC" = 1,5 L). Da prioridad a los productos del proveedor.
4. **Revisión obligatoria**: foto y datos lado a lado (en celular, la foto arriba y se amplía con un toque). En amarillo, las líneas sin vincular o con confianza menor a 75 %. Las que no están en el catálogo permiten "Crear producto" o "Ignorar".
5. Solo "Confirmar recepción" guarda. No se puede confirmar con líneas sin producto.

**Lectura con IA.** La app es solo front-end y no puede guardar una clave de API de forma segura. La lectura real se conecta con un servicio propio (por ejemplo, una función de Vercel) definiendo la variable `VITE_REMITO_API_URL`. Recibe `{ "imagen": "data:image/jpeg;base64,…" }` y devuelve `{ proveedor, fecha, lineas: [{ descripcion, cantidad, fechaVencimiento?, confianzaLectura? }] }`. Sin esa variable, al subir una foto la app avisa que la lectura no está configurada y ofrece cargarla a mano (con la foto adjunta) o probar otra.

**Modo demo.** "Usar remito de ejemplo" carga uno de dos remitos ficticios (Lácteos del Sur y Distribuidora Centro) y simula la extracción:

- Lácteos del Sur: el yogur figura 12 en el remito pero la IA "leyó" 18 con confianza baja (amarillo), y el queso crema no está en el catálogo.
- Distribuidora Centro: el agua tiene lectura dudosa y la Fanta no está en el catálogo.

Las imágenes también están en `docs/remitos-ejemplo/` para probar el camino de la foto.

## Tarea de prueba

> "Mañana pasa Distribuidora Centro. Contá sus productos y cargalos. Después cargá el remito de ejemplo que te dejó Lácteos del Sur y corregí lo que esté mal."

Recorrido esperado: **Hoy** → "Contar productos de este proveedor" en Distribuidora Centro → cargar las 3 cantidades → "Guardar conteo" → **Recepción** → "Usar remito de ejemplo · Lácteos del Sur" → ampliar la foto, corregir el yogur a 12, "Crear producto" para el queso crema → "Confirmar recepción". El resumen muestra el stock antes y después (por ejemplo, Leche 30 → 54).

## Historias y criterios de aceptación

| Historia | Criterio | Dónde |
| --- | --- | --- |
| HU1 Registrar productos | Alta con nombre, unidad, perecedero y punto de pedido; aparece en el listado | `features/ProductoForm.tsx`, `pages/CatalogoPage.tsx` |
| | NEGATIVO: sin nombre → mensaje claro; punto de pedido negativo → rechazado | `lib/validation.ts` (`validarProducto`) |
| HU2 Registrar stock | Cantidad por producto, fecha y hora, sin borrar anteriores; vencimiento en perecederos | `pages/ContarPage.tsx`, acción `registrarConteos` (solo agrega) |
| | NEGATIVO: cantidades negativas rechazadas | `validarCantidadConteo` |
| HU3 Administrar proveedores | Nombre, uno o más días, productos asociados (muchos a muchos) | `features/ProveedorForm.tsx` |
| | NEGATIVO: sin nombre o sin días → no se guarda | `validarProveedor` |
| HU8 Recepción desde foto | Foto, propuesta de proveedor/fecha/líneas, corrección, suma al stock al confirmar | `pages/RecepcionPage.tsx`, `features/RevisionRecepcion.tsx` |
| | NEGATIVO: nada se guarda sin confirmar; imagen ilegible → aviso + carga manual; no se confirma con líneas sin producto | `lib/remitoIA.ts`, `validarRecepcion` |

## Estructura

```text
src/
├── types.ts                  modelo de datos
├── lib/
│   ├── stock.ts              cálculo de stock desde el historial
│   ├── match.ts              vinculación remito ↔ catálogo por similitud
│   ├── validation.ts         reglas y mensajes de validación
│   ├── remitoIA.ts           lectura con IA (servicio configurable)
│   ├── seed.ts               datos de prueba (fechas relativas a hoy)
│   ├── storage.ts, router.ts, dates.ts, imagen.ts
├── demo/remitos.ts           remitos ficticios (SVG) y extracción simulada
├── state/store.tsx           estado global (useReducer) + localStorage
├── components/               ícono, hoja inferior, campos, avisos
├── features/                 formularios y pantalla de revisión
└── pages/                    Hoy, Contar, Recepción, Catálogo
```

## Datos de prueba

Distribuidora Centro (martes y viernes): Coca-Cola 2,25 L, Sprite 2,25 L, Agua mineral 1,5 L. Lácteos del Sur (lunes, miércoles y viernes): Leche entera 1 L y Yogur bebible 1 L (perecederos). Mayorista Rosario (jueves): Yerba 1 kg y Coca-Cola 2,25 L. Hay conteos de las últimas 3 semanas y 3 recepciones pasadas. Las fechas se calculan desde el día en que se abre la app; la Yerba se contó hace 9 días para que aparezca como "sin contar".

## Limitaciones conocidas

- Los datos viven en el navegador de cada persona. Las fotos pueden llenar el espacio (unos 5 MB): si pasa, se guardan los datos sin las fotos y se avisa.
- "Crear producto" desde la revisión agrega el producto al catálogo en ese momento, aunque después se cancele la recepción.
- Si un proveedor trae un producto que no tenía asociado, al confirmar se asocia automáticamente.
- No hay tests automatizados; las funciones de `src/lib` son puras y se prestan para Vitest.
