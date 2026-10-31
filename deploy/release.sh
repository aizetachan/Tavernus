#!/usr/bin/env bash
# Activa en el servidor una versión que push.sh acaba de descomprimir en
# /opt/tavernus/releases/<fecha>: dependencias, enlace current, reinicio y comprobación de salud.
# Si la versión nueva no responde, vuelve a la anterior. Lo llama push.sh.
#   release.sh <fecha> [--remote-build]
#
# Corre como el usuario tavernus (despliegue normal, sin root) o como root (transición, o un
# servidor sin preparar-usuario-deploy.sh). Como tavernus solo usa lo que deja
# /etc/sudoers.d/tavernus: reiniciar tavernus-web, leer su journal y publicar el Caddyfile.
# Los scripts de operación y las unidades de systemd los ejecuta root, así que tavernus no los
# instala: si cambian, avisa y se aplican con `deploy/push.sh --ops` (clave de administración).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
STAMP=${1:?falta la fecha de la versión}
REMOTE_BUILD=0; [ "${2:-}" = --remote-build ] && REMOTE_BUILD=1
REL=$APP_DIR/releases/$STAMP
[ -d "$REL" ] || die "no existe $REL"

if [ "$(id -u)" = 0 ]; then
  AS_ROOT=1
  id "$SVC_USER" >/dev/null 2>&1 && [ -f "$ENV_FILE" ] || die "falta preparar el servidor: deploy/push.sh --setup"
  as_svc() { (cd "$REL" && runuser -u "$SVC_USER" -- env HOME="$APP_DIR" npm_config_cache="$APP_DIR/.npm" "$@"); }
  sctl() { systemctl "$@"; }
  journal() { journalctl -u "$SERVICE" -n 30 --no-pager -o cat; }
  publish_caddy() { "$CADDY_PUBLISH"; }
  chown -R "$SVC_USER:$SVC_USER" "$REL"
  install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DEPLOY_DIR"
elif [ "$(id -un)" = "$SVC_USER" ]; then
  AS_ROOT=0
  as_svc() { (cd "$REL" && env HOME="$APP_DIR" npm_config_cache="$APP_DIR/.npm" "$@"); }
  # Rutas absolutas y argumentos exactos: los de /etc/sudoers.d/tavernus.
  sctl() { sudo -n /usr/bin/systemctl "$@"; }
  journal() { sudo -n /usr/bin/journalctl -u "$SERVICE" -n 30 --no-pager -o cat; }
  publish_caddy() { sudo -n "$CADDY_PUBLISH"; }
  [ -d "$DEPLOY_DIR" ] || die "falta $DEPLOY_DIR: prepara el usuario con deploy/push.sh --usuario-deploy"
else
  die "release.sh corre como root o como $SVC_USER (no como $(id -un))"
fi

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
[ "$AS_ROOT" = 1 ] && chown -h "$SVC_USER:$SVC_USER" "$REL/data"

# Scripts de operación y unidades de esta versión: root los instala; tavernus solo avisa si
# los instalados son otros.
if [ "$AS_ROOT" = 1 ]; then
  bash "$REL/deploy/install-ops.sh" "$REL/deploy"
else
  stale=''
  for f in lib.sh healthcheck.sh backup-now.sh restore.sh; do
    tr -d '\r' < "$REL/deploy/$f" | cmp -s - "$OPS_DIR/$f" || stale="$stale $f"
  done
  for u in tavernus-web.service tavernus-health.service tavernus-health.timer tavernus-backup.service tavernus-backup.timer; do
    tr -d '\r' < "$REL/deploy/$u" | cmp -s - "/etc/systemd/system/$u" || stale="$stale $u"
  done
  [ -z "$stale" ] || warn "cambian${stale}: no los instala tavernus. Aplícalos con: deploy/push.sh --ops"
fi

# Cambio atómico del enlace current y reinicio.
switch_to() { ln -sfn "$1" "$APP_DIR/current.new" && mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"; }
switch_to "$REL"
[ "$AS_ROOT" = 1 ] && chown -h "$SVC_USER:$SVC_USER" "$APP_DIR/current"
touch "$DEPLOY_FLAG"
# reset-failed: si systemd se rindió (StartLimitBurst), que vuelva a intentarlo.
sctl reset-failed "$SERVICE" 2>/dev/null || true
sctl restart "$SERVICE" || true
log "esperando a que la web responda…"
up=0
for _ in $(seq 1 45); do
  if probe; then up=1; break; fi
  sleep 1
done
[ "$AS_ROOT" = 1 ] && printf 'fails=0\nalerted=0\n' > "$HEALTH_DIR/state"

if [ "$up" != 1 ]; then
  warn "la versión $STAMP no responde ($PROBE_DETAIL). Últimas líneas:"
  journal || true
  if [ -n "$prev" ] && [ "$prev" != "$REL" ] && [ -f "$prev/dist/index.js" ]; then
    warn "vuelvo a la anterior: $(basename "$prev")"
    switch_to "$prev"
    sctl reset-failed "$SERVICE" 2>/dev/null || true
    sctl restart "$SERVICE" || true
    for _ in $(seq 1 30); do probe && break; sleep 1; done
    if probe; then warn "la anterior vuelve a estar en marcha ($PROBE_DETAIL)"; else warn "la anterior tampoco responde ($PROBE_DETAIL)"; fi
  fi
  rm -f "$DEPLOY_FLAG"
  exit 1
fi
rm -f "$DEPLOY_FLAG"
log "versión $STAMP en marcha ($PROBE_DETAIL)"
journal | tail -n 6 || true

# Caddyfile de esta versión (ya es la de current), si el proxy es Caddy y está el envoltorio
# (sin él, install-ops.sh lo instaló como antes, y tavernus no puede).
if [ "$(cat /etc/tavernus/proxy 2>/dev/null)" = caddy ]; then
  if [ -x "$CADDY_PUBLISH" ]; then
    publish_caddy || warn "el Caddyfile nuevo no se publicó; Caddy sigue con el anterior"
  elif [ "$AS_ROOT" = 0 ]; then
    tr -d '\r' < "$REL/deploy/Caddyfile" | cmp -s - /etc/caddy/Caddyfile \
      || warn "cambia el Caddyfile y falta $CADDY_PUBLISH: deploy/push.sh --usuario-deploy"
  fi
fi

# Se guardan las 3 últimas versiones (además de la actual) para poder volver atrás.
cur=$(readlink -f "$APP_DIR/current")
find "$APP_DIR/releases" -mindepth 1 -maxdepth 1 -type d | sort | head -n -4 | while read -r old; do
  [ "$old" = "$cur" ] || rm -rf "$old"
done
