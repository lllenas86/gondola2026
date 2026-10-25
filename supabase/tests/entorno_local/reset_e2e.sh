#!/bin/bash
# Recrea la base local de prueba "e2e" igual que producción: 01 → 03 → datos demo → 04
set -e
P="psql -h /tmp -p 5433 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='e2e' and pid<>pg_backend_pid()" >/dev/null
$P -c "drop database if exists e2e" -c "create database e2e" 2>/dev/null
for f in /home/claude/test/00_supabase_stub.sql /home/claude/g/supabase/01_esquema.sql /home/claude/g/supabase/03_pedido_y_demo.sql; do $P -d e2e -f $f >/dev/null; done
$P -d e2e -c "select gondola_restablecer_demo()" >/dev/null
$P -d e2e -f /home/claude/g/supabase/04_presentaciones_stock_vencimientos.sql >/dev/null 2>&1
echo "base e2e lista"
