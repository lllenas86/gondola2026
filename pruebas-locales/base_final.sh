#!/bin/bash
# Base local igual a la final: 01+02+03 → 04 → (datos de ejemplo) → 05 → cuentas → 06.
# Uso: ./base_final.sh [con-demo]   (con-demo: carga el set de ejemplo con presentaciones y lotes antes de la 05)
set -e
P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q -d gondola"
D=$(cd "$(dirname "$0")" && pwd)
"$D/reset_db.sh" 04 >/dev/null
[ "$1" = "con-demo" ] && $P -c "select gondola_restablecer_demo()" >/dev/null
$P -f "$D/../supabase/05_roles_y_almacenes.sql" 2>&1 | grep -v -i notice || true
# Cuentas (solo en esta base de prueba): las 3 de evaluación y las de e2e_roles.py
$P -c "insert into auth.users (email, password_prueba) values ('duena.gondola@example.com','demo1234'),('encargado.gondola@example.com','demo1234'),('empleado.gondola@example.com','demo1234') on conflict do nothing"
$P -f "$D/usuarios_prueba.sql" >/dev/null 2>&1 || true
$P -f "$D/../supabase/06_cuentas_evaluacion.sql" | tail -5
echo "BASE FINAL OK ($*)"
