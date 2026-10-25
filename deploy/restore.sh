#!/usr/bin/env bash
# Restaura las partidas desde una copia de backup-now.sh (o un .tar.gz con una carpeta data/
# dentro, como el que sube deploy/data-sync.sh). Como root en el servidor.
#
#   tavernus-restore --list                 copias disponibles
#   tavernus-restore --latest               la más reciente (reemplaza todo data/)
#   tavernus-restore FICHERO.tar.gz         esa copia (reemplaza todo data/)
#   tavernus-restore FICHERO --merge        solo añade las partidas y carpetas de data/local que
#                                           no existan ya en el servidor; no toca las demás
#   … --yes                                 sin preguntar
#
# Antes de tocar nada hace una copia del estado actual, y en modo reemplazo deja además la
# carpeta anterior en /var/lib/tavernus/data.antes-<fecha> (se borran a los 14 días).
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root

FILE=''; MERGE=0; YES=0
while [ $# -gt 0 ]; do
  case $1 in
    --list) ls -lh "$BACKUP_DIR"/tavernus-data-*.tar.gz 2>/dev/null || log "no hay copias en $BACKUP_DIR"; exit 0 ;;
    --latest) FILE=$(find "$BACKUP_DIR" -maxdepth 1 -name 'tavernus-data-*.tar.gz' | sort | tail -n 1)
              [ -n "$FILE" ] || die "no hay copias en $BACKUP_DIR" ;;
    --merge) MERGE=1 ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    -*) die "opción desconocida: $1" ;;
    *) FILE=$1 ;;
  esac
  shift
done
[ -n "$FILE" ] || die "¿qué copia? (--list, --latest o la ruta del .tar.gz)"
[ -f "$FILE" ] || die "no existe $FILE"
# awk lee la lista entera: con grep -q y pipefail, tar moriría por SIGPIPE y parecería un error.
tar -tzf "$FILE" 2>/dev/null | awk '/^(\.\/)?data\//{f=1} END{exit !f}' || die "$FILE no es una copia válida (no lleva data/)"

mode=reemplazar; [ "$MERGE" = 1 ] && mode="añadir lo que falte"
log "restaurar $FILE ($mode) en $SRV_DATA"
if [ "$YES" != 1 ]; then
  printf '¿Seguro? La web se para un momento. [s/N] '
  read -r answer < /dev/tty || answer=''
  case $answer in s|S|si|sí|y|Y) ;; *) log "cancelado"; exit 1 ;; esac
fi

log "copia de seguridad del estado actual"
"$(dirname "$(readlink -f "$0")")/backup-now.sh" --quiet

install -d -m 700 "$HEALTH_DIR"
touch "$MAINT_FLAG"
work=$(mktemp -d "$STATE_DIR/.restore-XXXXXX")
cleanup() { rm -rf "$work"; rm -f "$MAINT_FLAG"; systemctl start "$SERVICE" || true; }
trap cleanup EXIT

systemctl stop "$SERVICE"
tar -C "$work" -xzf "$FILE"
[ -d "$work/data" ] || die "la copia no tiene data/ en la raíz"

if [ "$MERGE" = 1 ]; then
  added=0; skipped=0
  for sub in games local; do
    [ -d "$work/data/$sub" ] || continue
    install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$SRV_DATA/$sub"
    for entry in "$work/data/$sub"/* "$work/data/$sub"/.[!.]*; do
      [ -e "$entry" ] || continue
      name=$(basename "$entry")
      if [ -e "$SRV_DATA/$sub/$name" ]; then skipped=$((skipped + 1)); log "  ya está: $sub/$name"
      else mv "$entry" "$SRV_DATA/$sub/$name"; added=$((added + 1)); log "  añadido: $sub/$name"; fi
    done
  done
  log "añadidas $added, ya existían $skipped (esas no se han tocado)"
else
  before=$STATE_DIR/data.antes-$(date +%Y-%m-%d_%H%M%S)
  [ -d "$SRV_DATA" ] && mv "$SRV_DATA" "$before"
  mv "$work/data" "$SRV_DATA"
  log "data/ reemplazada; la anterior queda en $before"
  find "$STATE_DIR" -maxdepth 1 -name 'data.antes-*' -mtime +14 -exec rm -rf {} +
fi
chown -R "$SVC_USER:$SVC_USER" "$SRV_DATA"
chmod 750 "$SRV_DATA"

trap - EXIT
rm -rf "$work"; rm -f "$MAINT_FLAG"
systemctl start "$SERVICE"
for _ in $(seq 1 30); do probe && break; sleep 1; done
if probe; then log "web en marcha ($PROBE_DETAIL)"; else warn "la web no responde aún ($PROBE_DETAIL): sudo journalctl -u $SERVICE -n 50"; fi
