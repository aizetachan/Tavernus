#!/bin/bash
# Mantiene el bot vivo en este Mac: si el proceso muere, lo relanza a los 5 s.
# caffeinate evita que el Mac se duerma por inactividad mientras corre (enchufado a la corriente).
# Uso: scripts/run-bot.sh &        Parar: pkill -f run-bot.sh; pkill -f "src/index.ts"
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
while true; do
  echo "[run-bot] arranque $(date '+%F %T')" >> logs/bot.log
  caffeinate -is node --env-file=.env --import tsx src/index.ts >> logs/bot.log 2>&1
  code=$?
  echo "[run-bot] el bot terminó con código $code a las $(date '+%F %T'); relanzo en 5 s" >> logs/bot.log
  # El siguiente arranque lee esto y avisa en #reportes del motivo.
  { echo "code=$code"; echo "at=$(date +%s)"; tail -n 30 logs/bot.log; } > logs/last-exit.txt
  sleep 5
done
