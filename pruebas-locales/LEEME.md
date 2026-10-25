# Pruebas locales de punta a punta

Entorno que se usó para probar esta versión sin tocar el Supabase real (Linux).
**No va a producción** ni lo usa la app publicada.

- `00_stub_supabase.sql`: lo mínimo de Supabase para Postgres local (roles `anon`/`authenticated`, `auth.users`, `auth.uid()`, bucket).
- `reset_db.sh [04] [05]`: recrea la base con 01+02+03 (estado actual de producción) y aplica las migraciones pedidas.
- `mini-postgrest.mjs` + `servidor.sh`: sirve la app compilada e imita la API REST y el login de Supabase (puerto 8787). Ejecuta cada pedido con el rol `anon` o `authenticated`, así que las políticas RLS son las reales. Los tokens de prueba no tienen firma: solo para pruebas.
- `usuarios_prueba.sql`: usuarios de prueba (dueña, encargado, empleado y uno de otro almacén).
- `rls_test.sql`: permisos probados directamente en SQL.
- `e2e_smoke.py`, `e2e_flujos.py`, `e2e_migracion.py`, `e2e_roles.py`: recorridos en Chromium (Playwright) que verifican la pantalla y la base.

Requisitos: PostgreSQL 16 (socket en /tmp, puerto 5433), Node 18+, `npm i pg` en esta carpeta, Python con Playwright.
Las rutas están escritas para `/home/claude/work/{app,test}`: ajustalas si lo corrés en otra máquina.

Compilar la app apuntando al servidor de prueba:
`VITE_SUPABASE_URL=http://localhost:8787 VITE_SUPABASE_ANON_KEY=test npx vite build`
