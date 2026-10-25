#!/bin/bash
# Reinicia el servidor de prueba (sirve la app compilada + API simulada) en el puerto 8787
cd /home/claude/work/test
[ -f srv.pid ] && kill $(cat srv.pid) 2>/dev/null
sleep 0.3
nohup node mini-postgrest.mjs > srv.log 2>&1 &
echo $! > srv.pid
sleep 1
