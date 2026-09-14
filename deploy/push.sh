#!/bin/bash
# Sube el código a la VM, compila y reinicia. Desde el Mac, en la raíz del proyecto.
#   deploy/push.sh              solo código (la partida de la VM no se toca)
#   deploy/push.sh --with-data  primera vez: sube también .env y data/local (y para el bot del Mac)
set -euo pipefail
export CLOUDSDK_ACTIVE_CONFIG_NAME=tavernus
VM=${VM:-tavernus}; ZONE=${ZONE:-us-central1-a}
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
tar czf "$TMP/code.tgz" --exclude=node_modules --exclude=dist --exclude=logs --exclude=.git --exclude=data --exclude=.env .
FILES=("$TMP/code.tgz")
if [ "${1:-}" = "--with-data" ]; then
  # Dos bots con el mismo token responderían por duplicado: se para el del Mac.
  pkill -f run-bot.sh || true; pkill -f "src/index.ts" || true
  tar czf "$TMP/data.tgz" data .env
  FILES+=("$TMP/data.tgz")
fi
gcloud compute scp "${FILES[@]}" "$VM":/tmp/ --zone "$ZONE"
gcloud compute ssh "$VM" --zone "$ZONE" --command "set -e
  sudo tar xzf /tmp/code.tgz -C /opt/tavernus
  if [ -f /tmp/data.tgz ]; then sudo tar xzf /tmp/data.tgz -C /opt/tavernus && sudo chmod 600 /opt/tavernus/.env && sudo rm /tmp/data.tgz; fi
  sudo chown -R tavernus:tavernus /opt/tavernus && sudo chmod +x /opt/tavernus/deploy/*.sh
  cd /opt/tavernus && sudo -u tavernus npm ci --no-audit --no-fund && sudo -u tavernus npm run build
  sudo cp deploy/tavernus.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable tavernus && sudo systemctl restart tavernus
  sleep 15 && tail -n 5 logs/bot.log"
rm -rf "$TMP"
