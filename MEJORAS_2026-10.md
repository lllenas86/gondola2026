# Góndola · Mejoras de octubre 2026

Documento técnico de esta versión: qué cambió, cómo migrar la base, cómo probar y qué queda pendiente.
(No es un documento de entrega de la cursada.)

## 1. Qué se implementó

| Mejora | Estado | Dónde |
| --- | --- | --- |
| Producto con varias presentaciones (stock, punto de pedido, costo, bulto y proveedores por presentación) | Completa | `supabase/04…`, `src/types.ts`, `features/ProductoFicha.tsx`, `lib/inventario.ts` |
| «Mover a otro producto» (agrupar presentaciones a mano, con vista previa, validaciones y confirmación) | Completa | `gondola_mover_presentacion()` en 04, `MoverPresentacion` |
| Inventario inicial y conteo periódico sin elegir proveedor, lotes por vencimiento, revisión de diferencias, historial | Completa | `pages/ContarPage.tsx`, trigger `gondola_conteo_reglas` |
| Recepción manual y por IA por presentación (tamaño, alias aprendidos, bultos solo con equivalencia configurada) | Completa | `lib/match.ts`, `features/RevisionRecepcion.tsx`, `pages/RecepcionPage.tsx` |
| Tablero de vencimientos y mermas (vencido en stock, ≤3 días, semana, devuelto, descartado, valor a costo o «no calculable») | Completa | `pages/VencimientosPage.tsx`, `lib/vencimientos.ts` |
| Devolución al proveedor con remito (preparada → confirmada → resuelta / cancelada), imprimible y por WhatsApp | Completa | `features/Devolucion.tsx`, tablas `devoluciones`, `devolucion_lineas` |
| Baja por descarte (operación separada, inmutable) | Completa | `BajaForm`, tabla `bajas` |
| Simulador temporal de stock (horizonte, control deslizable, quiebre, punto de pedido, vencimientos sin salida, detalle con gráfico, simular pedido, ir al pedido) | Completa | `pages/ProyeccionPage.tsx`, `lib/proyeccion.ts` |
| Asistente de pedidos por WhatsApp (prioridades con su porqué, editable, mensaje revisable, abre WhatsApp sin enviar) | Completa, **basado en reglas** | `features/AsistentePedido.tsx`, `lib/pedido.ts`, `pages/PedidosPage.tsx` |
| Vistas por rol (empleado, encargado, dueño) con login real y RLS por almacén y rol | Completa en código y probada en Postgres local; **falta aplicarla en Supabase** | `supabase/05…`, `lib/auth.ts`, `lib/permisos.ts`, `App.tsx`, `pages/TareasPage.tsx`, `PanelPage.tsx`, `EquipoPage.tsx`, `IngresoPage.tsx` |

Todas usan las mismas funciones: stock y lotes (`inventario.ts`), proyección (`proyeccion.ts`, que usan el simulador y el pedido), vencimientos (`vencimientos.ts`) y permisos (`permisos.ts`, que reflejan las políticas de la 05).

## 2. Cambios en el modelo de datos

- **`presentaciones`** (nueva): `producto_id`, `nombre`, `contenido` + `unidad_contenido` (opcional, solo para describir y reconocer), `unidad_stock`, `unidades_por_bulto` (opcional; sin dato no se convierte), `punto_pedido`, `costo_unitario` (opcional), `activa`, `migrada`.
- **`presentacion_proveedor`** reemplaza en la app a `producto_proveedor` (que se mantiene sincronizada por trigger para las vistas viejas).
- **`conteos`**: `presentacion_id`, `sesion_id`, `tipo` (`inicial`/`periodico`, lo pone la base), `stock_registrado` (lo que decía el sistema antes de contar, lo pone la base) y `lotes` (jsonb con vencimiento y cantidad).
- **`recepcion_lineas`**: `presentacion_id`.
- **`devoluciones`** + **`devolucion_lineas`** (con lote y recepción de origen), **`bajas`**, **`presentacion_alias`**.
- Vistas nuevas **`v_stock_presentacion`** y **`v_consumo_presentacion`**. Las viejas siguen existiendo.
- `productos.activo` (fichas archivadas al quedar vacías; nunca se borran).
- Con la 05: `almacenes`, `miembros` y `almacen_id` en todas las tablas.

Reglas en la base: el stock nunca se guarda; la devolución descuenta una sola vez (al confirmar) y no se puede reconfirmar; las bajas no se editan; mover una presentación verifica que el stock no cambie; con la 05, nadie puede mezclar datos de dos almacenes aunque conozca un id.

## 3. Cómo aplicar en Supabase (en este orden)

**Antes de nada, verificá el proyecto.** En Vercel → proyecto `gondola2026` → Settings → Environment Variables, mirá `NEXT_PUBLIC_SUPABASE_URL`: el texto antes de `.supabase.co` es el proyecto que usa la app publicada (por ejemplo `widsyzjmabvmfchhaaiu`). Abrí **ese** proyecto en Supabase. No lo verifiqué yo porque no accedí a Vercel ni a Supabase.

1. **Copia de seguridad**: Supabase → Database → Backups (o Table Editor → exportar CSV de `productos`, `proveedores`, `producto_proveedor`, `conteos`, `recepciones`, `recepcion_lineas`).
2. SQL Editor → pegar y correr **`supabase/04_presentaciones_lotes_devoluciones.sql`**.
3. Verificar (tiene que dar 0 filas: el stock migrado es idéntico al anterior):
   ```sql
   select a.nombre, a.stock_actual, b.stock_actual
   from v_stock_actual a join v_stock_presentacion b on b.producto_id = a.producto_id
   where a.stock_actual is distinct from b.stock_actual;
   ```
4. Publicar la versión nueva de la app (sección 5).
5. **Solo cuando quieran usuarios**: correr **`supabase/05_roles_y_almacenes.sql`**, crear los usuarios en Authentication → Users (email + contraseña, «Auto Confirm User») y asignar el primer dueño:
   ```sql
   select gondola_asignar_primer_dueno('tu-email@ejemplo.com');
   ```
   El resto se agrega desde la app (Más → Equipo). Desde ese momento **el link público deja de mostrar datos sin login**. Para la evaluación: crear las tres cuentas `duena/encargado/empleado.gondola@example.com` (clave `demo1234`, Auto Confirm) y correr **`supabase/06_cuentas_evaluacion.sql`**.

Las dos migraciones se pueden volver a correr sin duplicar nada, y volver a correr la 04 después de la 05 no reabre el acceso público (probado).

## 4. Pruebas que se hicieron

Entorno: Postgres 16 local con las migraciones reales 01→05 aplicadas sobre los datos de ejemplo de producción, un servidor que imita la API REST de Supabase (ejecuta todo con los roles `anon` / `authenticated`, así que las políticas RLS son las reales) y Chromium en tamaño celular (390 px). Ver `pruebas-locales/`.

| Prueba | Resultado |
| --- | --- |
| `npm test` (Vitest): stock por presentación, lotes, devoluciones/bajas, consumo, proyección sin datos y con datos, pedido, mensaje, bultos, reconocimiento de tamaños, alias | 15/15 |
| `npm run typecheck` y `npm run build` | OK |
| Migración sobre datos actuales (`e2e_migracion.py`): presentaciones «Única», stock idéntico, Hoy, remito viejo, pedido, Mover (vista previa, duplicados, perecedero, confirmación, historial, archivado) | 16/16 |
| Flujos con la demo nueva (`e2e_flujos.py`): producto con 2 presentaciones, inventario inicial sin proveedor, conteo periódico con diferencia, lotes, vencidos, devolución (preparada no descuenta, confirmada descuenta una vez, resuelta), baja, validación por lote, proyección (no inventa ritmos), pedido editado → mensaje → WhatsApp, remito con 2,25 L y 500 cc, alias, recepción en bultos | 32/32 |
| Roles con la 05 (`e2e_roles.py`): sin sesión no hay datos (la base responde 403), contraseña errónea, menú por rol, acceso por URL, el empleado no puede dar de baja ni cambiar el catálogo ni restablecer la demo **llamando a la API directo**, sesión persistente, cerrar sesión, encargado, dueña y equipo, aislamiento entre almacenes, renovación del token | 22/22 |
| Permisos en SQL (`rls_test.sql`), incluido usar un id de otro almacén | OK |

**No probado:** contra tu Supabase real (sin acceso), la lectura con un modelo de IA real (se probó con lecturas simuladas y los remitos de ejemplo) e impresión en papel del remito (se probó la vista previa).

## 5. Ejecutar y publicar

Local (Windows, con Node 18+):

```bash
npm install
# .env.local con NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
npm run dev        # http://localhost:5173
npm test
```

Ojo: con `npm run dev` la app usa la base que pongas en `.env.local`. Si es la de producción y todavía no corriste la 04, la app avisa «Falta actualizar la base».

Publicar (lo hacés vos): correr la 04 en Supabase → subir los archivos al repositorio de GitHub → Vercel despliega solo. No cambian las variables de entorno.

## 6. Pendientes y propuestas (no ejecutadas)

- **Redacción del pedido con IA**: hoy es una plantilla de reglas (y así se indica en pantalla). Si se quiere, se puede sumar una función de servidor tipo `api/redactar-pedido.js` que reutilice `VISION_API_KEY`, solo para mejorar la redacción, sin cambiar cantidades.
- Un usuario en varios almacenes (hoy, uno solo).
- Numeración de devoluciones por almacén (hoy es correlativa en toda la base).
- Costo por recepción (hoy hay un costo de referencia por presentación).
- Registrar ventas reales (integración con caja) para reemplazar el consumo estimado entre conteos.


## 7. Integración y producción · 25/10/2026

- Esta versión se integró en el repositorio en la rama `etapa1-version-avanzada` (creada desde `main`, que era exactamente su punto de partida: no había cambios más nuevos que preservar).
- El 24-25/10 se aplicó por error en producción una 04 alternativa (otra implementación, rama `correcciones-profesor-etapa1`, descartada). `supabase/mantenimiento/2026-10-25_revertir_04_alternativa.sql` la quita sin tocar datos (se aborta si encuentra datos cargados con ella) y deja la base como 01+03.
- Respaldos en Supabase (esquemas que no expone la API): `respaldo_20261025` (antes de la 04 alternativa) y `respaldo_20261025b` (25/10, antes de revertir), verificados por checksum.
- Simulación en producción (reversión + esta 04 en una transacción que se descarta): OK. Verificación de la sección 3 = 0 filas; 9 presentaciones «Única» para 9 productos; ningún conteo ni línea de recepción sin presentación; stock de las vistas viejas sin cambios.
- La 05 (roles) NO se aplicó en producción.

Pruebas re-ejecutadas el 25/10 sobre esta versión (Postgres 16 local + API simulada):
- typecheck y build (normal y demo): OK. El build normal no incluye PGlite ni el cartel de demo; el build demo no incluye las variables de `.env.local`.
- `npm test`: 15/15 · `e2e_migracion.py`: 16/16 (también por el camino real: 04 alternativa → reversión → 04) · `e2e_flujos.py`: 32/32 · `e2e_demo.mjs`: 27/27 · `e2e_roles.py` (local, con 05): 22/22 · `e2e_recarga.py` (nuevo): 4/4.
- Ajustes solo en las pruebas (no en la app): fechas fijas que dependían del día (8a, A9), textos tras el renombre a «Stock» (2e, 3c, R4, R14) y `usuarios_prueba.sql` (encargado y empleado asociados al almacén). Para `e2e_roles.py` la base se arma así: `reset_db.sh 04` → `select gondola_restablecer_demo()` → correr 05 → `usuarios_prueba.sql`.

## 8. App final única · 25/10/2026

- Se quitó el modo demo de la experiencia: sin cartel «MODO DEMO», sin backend simulado (PGlite desinstalado), sin usuarios ficticios ni botón de reinicio. `npm run dev` / `npm run build` dan la app completa contra Supabase.
- Login real (Supabase Auth) con los tres perfiles de la versión avanzada. En la pantalla de ingreso, **Acceso rápido para evaluación**: un toque entra como Dueña, Encargado o Empleado (cuentas reales, clave `demo1234`).
- `06_cuentas_evaluacion.sql`: asigna los roles a esas cuentas, impide modificarlas desde Equipo y deja el reinicio de datos solo para el SQL Editor.
- `mantenimiento/recuperar_acceso_sin_login.sql`: plan B si tras la 05 nadie puede entrar (no borra datos; probado ida y vuelta).
- Orden en producción: crear las 3 cuentas → respaldo → 05 + 06 → publicar esta versión (la 05 corta el acceso sin login de la versión publicada anterior).

Pruebas sobre esta versión (Postgres 16 local + API simulada con RLS real): typecheck y build OK · `npm test` 15/15 · `e2e_app.mjs` 27/27 · `e2e_evaluacion.py` 25/25 (acceso rápido, permisos por rol verificados en la base, cuentas protegidas, reinicio bloqueado, recargas, dos pestañas) · `e2e_roles.py` 22/22 · `e2e_migracion.py` 16/16 · `e2e_flujos.py` 32/32 · `e2e_recarga.py` 4/4 · 05+06 conservan datos y stock idénticos (checksum) y son re-ejecutables. Se retiraron `e2e_demo.mjs` y `e2e_demo_login.py` (probaban el modo demo eliminado).

## 9. Corrección de lectura de remitos · 26/10/2026 (rama `correccion-remitos-ia`)

**Reconocimiento de productos y presentaciones** (`src/lib/match.ts`, `RevisionRecepcion.tsx`)
- Unidades normalizadas: 200 gr = 200 g = 200 gramos = 200grs = 0,2 kg; 500 cc = 500 ml = 0,5 l; 1 kilo = 1000 g.
- El producto se identifica por sus palabras sin tamaño; si remito y ficha tienen cada uno palabras que el otro no tiene (otra marca o variedad), no se asocian nunca por parecido.
- La presentación se elige por tamaño normalizado. Tamaño que la ficha no tiene → no se asigna otra presentación: se ofrece «Agregar 500 g a «Manteca Pepito»». Varios posibles → se muestran las opciones y hay que elegir.
- «Crear» propone el nombre sin el tamaño y no deja crear una ficha que ya existe escrita distinto («Manteca Pepito 200 gr» = «Manteca Pepito»).
- Una línea marcada para revisar no se confirma hasta que la persona la confirma o la corrige; si la IA no lee la fecha, el campo queda vacío y se avisa.

**Servicio `api/leer-remito.js`**
- Gemini 2.5 Flash tenía el «razonamiento» activo por defecto: 40-60 s por remito. Se desactiva (thinkingBudget 0).
- Tiempo máximo por intento (25 s), hasta 3 intentos solo ante errores transitorios (429, 5xx, red, demora) con espera progresiva y variación aleatoria, y presupuesto total de 50 s (Vercel corta a los 60 s). Errores de configuración no se reintentan.
- Respaldo en el mismo proveedor y la misma clave: `gemini-2.5-flash-lite` (variable `VISION_MODEL_RESPALDO`; «no» lo desactiva).
- Valida formato real y tamaño de la imagen; la misma foto enviada dos veces a la vez se lee una sola vez; registra en los logs modelo, intentos y duración (sin la clave ni la imagen).
- Respuestas: 503 «servicio saturado» o 504 «tardó demasiado», con `reintentable`; la app ofrece «Reintentar la lectura» (un pedido por vez) o «Cargar a mano».

Pruebas: `npm test` 41/41 (17 de reconocimiento, 9 del servicio con Gemini simulado: 503, reintentos, presupuesto, colgado, duplicados, imagen inválida) · `e2e_manteca.py` 19/19 · `e2e_remitos.py` 34/34 · `e2e_flujos.py` 32/32 · `e2e_migracion.py` 16/16 · `e2e_app.mjs` 27/27 · `e2e_evaluacion.py` 25/25 · `e2e_roles.py` 22/22 · `e2e_recarga.py` 4/4.
