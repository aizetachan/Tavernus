#!/usr/bin/env bash
# Activa en el servidor una versión que push.sh acaba de descomprimir en
# /opt/tavernus/releases/<fecha>: dependencias, enlace current, reinicio y comprobación de salud.
# Si la versión nueva no responde, vuelve a la anterior. Como root; lo llama push.sh.
#   release.sh <fecha> [--remote-build]
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root
STAMP=${1:?falta la fecha de la versión}
REMOTE_BUILD=0; [ "${2:-}" = --remote-build ] && REMOTE_BUILD=1
REL=$APP_DIR/releases/$STAMP
[ -d "$REL" ] || die "no existe $REL"
id "$SVC_USER" >/dev/null 2>&1 && [ -f "$ENV_FILE" ] || die "falta preparar el servidor: deploy/push.sh --setup"

as_svc() { (cd "$REL" && runuser -u "$SVC_USER" -- env HOME="$APP_DIR" npm_config_cache="$APP_DIR/.npm" "$@"); }

chown -R "$SVC_USER:$SVC_USER" "$REL"
prev=
[ -L "$APP_DIR/current" ] && prev=$(readlink -e "$APP_DIR/current" 2>/dev/null || true)

# Dependencias: si package-lock.json no cambia, se reutilizan las de la versión anterior
# (enlaces duros: ni red ni disco); si cambia, npm ci.
if [ "$REMOTE_BUILD" = 1 ]; then
  log "compilando en el servidor (npm ci + build + prune)"
  as_svc npm ci --no-audit --no-fund
  as_svc npm run build
  as_svc npm prune --omit=dev --no-audit --no-fund
elif [ -n "$prev" ] && [ -d "$prev/node_modules" ] && cmp -s "$prev/package-lock.json" "$REL/package-lock.json"; then
  log "dependencias sin cambios: reutilizo las de $(basename "$prev")"
  cp -al "$prev/node_modules" "$REL/node_modules"
else
  log "instalando dependencias (npm ci --omit=dev)"
  as_svc npm ci --omit=dev --no-audit --no-fund
fi
[ -f "$REL/dist/index.js" ] || die "la versión no trae dist/index.js (¿falló npm run build?)"

# data/ del repo -> datos del servidor (por si algo usa las rutas por defecto ./data/...).
rm -rf "$REL/data"
ln -sfn "$SRV_DATA" "$REL/data"
chown -h "$SVC_USER:$SVC_USER" "$REL/data"

# Scripts de operación, unidades y Caddyfile de esta versión.
bash "$REL/deploy/install-ops.sh" "$REL/deploy"

# Cambio atómico del enlace current y reinicio.
switch_to() { ln -sfn "$1" "$APP_DIR/current.new" && mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"; }
switch_to "$REL"
touch "$MAINT_FLAG"
# reset-failed: si systemd se rindió (StartLimitBurst), que vuelva a intentarlo.
systemctl reset-failed "$SERVICE" 2>/dev/null || true
systemctl restart "$SERVICE" || true
log "esperando a que la web responda…"
up=0
for _ in $(seq 1 45); do
  if probe; then up=1; break; fi
  sleep 1
done
printf 'fails=0\nalerted=0\n' > "$HEALTH_DIR/state"

if [ "$up" != 1 ]; then
  warn "la versión $STAMP no responde ($PROBE_DETAIL). Últimas líneas:"
  journalctl -u "$SERVICE" -n 30 --no-pager -o cat || true
  if [ -n "$prev" ] && [ "$prev" != "$REL" ] && [ -f "$prev/dist/index.js" ]; then
    warn "vuelvo a la anterior: $(basename "$prev")"
    switch_to "$prev"
    systemctl reset-failed "$SERVICE" 2>/dev/null || true
    systemctl restart "$SERVICE" || true
    for _ in $(seq 1 30); do probe && break; sleep 1; done
    if probe; then warn "la anterior vuelve a estar en marcha ($PROBE_DETAIL)"; else warn "la anterior tampoco responde ($PROBE_DETAIL)"; fi
  fi
  rm -f "$MAINT_FLAG"
  exit 1
fi
rm -f "$MAINT_FLAG"
log "versión $STAMP en marcha ($PROBE_DETAIL)"
journalctl -u "$SERVICE" -n 6 --no-pager -o cat || true

# Se guardan las 3 últimas versiones (además de la actual) para poder volver atrás.
cur=$(readlink -f "$APP_DIR/current")
find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d | sort | head -n -4 | while read -r old; do
  [ "$old" = "$cur" ] || rm -rf "$old"
done
