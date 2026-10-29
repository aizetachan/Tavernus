#!/usr/bin/env bash
# Instala (o actualiza) en el servidor lo que no es la web en sí: scripts de operación en
# /usr/local/lib/tavernus, unidades de systemd y el Caddyfile. Como root.
# Lo llaman setup-vps.sh y release.sh; no hace falta usarlo a mano.
#   install-ops.sh <carpeta deploy/ de la versión>
set -euo pipefail
SRC=$(cd "${1:-$(dirname "$0")}" && pwd)
# shellcheck source=lib.sh
. "$SRC/lib.sh"
require_root

# Scripts, sin \r por si el repo se clonó en Windows con autocrlf.
install -d -m 755 "$OPS_DIR"
for f in lib.sh healthcheck.sh backup-now.sh restore.sh; do
  tr -d '\r' < "$SRC/$f" > "$OPS_DIR/$f.new"
  chmod 755 "$OPS_DIR/$f.new"
  mv -f "$OPS_DIR/$f.new" "$OPS_DIR/$f"
done
ln -sfn "$OPS_DIR/backup-now.sh" /usr/local/bin/tavernus-backup
ln -sfn "$OPS_DIR/restore.sh" /usr/local/bin/tavernus-restore
ln -sfn "$OPS_DIR/healthcheck.sh" /usr/local/bin/tavernus-health

# Unidades de systemd.
for u in tavernus-web.service tavernus-health.service tavernus-health.timer tavernus-backup.service tavernus-backup.timer; do
  tr -d '\r' < "$SRC/$u" > "/etc/systemd/system/$u"
  chmod 644 "/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl enable "$SERVICE.service" >/dev/null 2>&1
systemctl enable --now tavernus-health.timer tavernus-backup.timer >/dev/null 2>&1

# Caddyfile del repo, si el proxy es Caddy y ha cambiado. Con el envoltorio instalado
# (preparar-usuario-deploy.sh) lo publica release.sh al final, para root y para tavernus.
if [ "$(cat /etc/tavernus/proxy 2>/dev/null)" = caddy ] && command -v caddy >/dev/null && [ ! -x "$CADDY_PUBLISH" ]; then
  tmp=$(mktemp)
  tr -d '\r' < "$SRC/Caddyfile" > "$tmp"
  if ! cmp -s "$tmp" /etc/caddy/Caddyfile; then
    if ( load_caddy_env; caddy validate --config "$tmp" --adapter caddyfile >/dev/null 2>&1 ); then
      install -m 644 "$tmp" /etc/caddy/Caddyfile
      systemctl reload caddy && log "Caddyfile actualizado y Caddy recargado"
    else
      warn "el Caddyfile nuevo no valida; se deja el anterior (caddy validate --config $SRC/Caddyfile)"
    fi
  fi
  rm -f "$tmp"
fi
log "scripts de operación en $OPS_DIR; temporizadores de salud y copias activos"
