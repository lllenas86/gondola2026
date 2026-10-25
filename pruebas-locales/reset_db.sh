#!/bin/bash
# Recrea la base local: estado de producción actual (01+02+03), y luego 04 y/o 05 según los argumentos.
set -e
P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='gondola' and pid <> pg_backend_pid()" >/dev/null
$P -c "drop database if exists gondola" -c "create database gondola" >/dev/null 2>&1
$P -d gondola -c "alter database gondola set timezone to 'UTC'" >/dev/null
$P -d gondola -f /home/claude/work/test/00_stub_supabase.sql >/dev/null
for f in 01_esquema 02_datos_ejemplo 03_pedido_y_demo; do $P -d gondola -f /home/claude/work/app/supabase/$f.sql >/dev/null; done
# Supabase da estos permisos por defecto a las tablas nuevas (las políticas RLS son las que limitan)
G="grant select, insert, update, delete on all tables in schema public to anon, authenticated"
$P -d gondola -c "$G" >/dev/null
for m in "$@"; do
  f=$(ls /home/claude/work/app/supabase/${m}_*.sql)
  $P -d gondola -f "$f" 2>&1 | grep -v NOTICE || true
  [ "$m" = "04" ] && $P -d gondola -c "$G" >/dev/null
done
echo "DB OK ($*)"
