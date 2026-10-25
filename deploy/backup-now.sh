#!/usr/bin/env bash
# Copia comprimida de /var/lib/tavernus/data (partidas, imágenes, índice de reglas) en
# /var/lib/tavernus/backups, y borra las de más de BACKUP_KEEP_DAYS días (14).
# La lanza tavernus-backup.timer cada noche; a mano: sudo tavernus-backup
#
#   tavernus-backup            copia ahora e imprime la ruta
#   tavernus-backup --quiet    igual, solo la ruta (para el temporizador y data-sync.sh)
#
# La web escribe los JSON sin renombrado atómico: la copia se hace de una foto en una carpeta
# aparte y se comprueba que los .json se leen; si alguno estaba a medio escribir, se repite.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root
QUIET=0; [ "${1:-}" = --quiet ] && QUIET=1
say() { [ "$QUIET" = 1 ] || log "$*"; }

[ -d "$SRV_DATA" ] || die "no existe $SRV_DATA"
install -d -m 700 "$BACKUP_DIR"
keep=$(envget BACKUP_KEEP_DAYS 14)
stamp=$(date +%Y-%m-%d_%H%M%S)
out=$BACKUP_DIR/tavernus-data-$stamp.tar.gz
work=$(mktemp -d "$STATE_DIR/.backup-XXXXXX")
trap 'rm -rf "$work"' EXIT

ok=0
for attempt in 1 2 3; do
  rm -rf "${work:?}/data"
  # Los PDF de manuals/ no se copian: son grandes y el índice de reglas ya está en rules/.
  tar -C "$STATE_DIR" --exclude='data/local/manuals' -cf - data | tar -C "$work" -xf -
  if bad=$(node -e '
    const fs = require("fs"), path = require("path");
    const bad = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".json")) { try { JSON.parse(fs.readFileSync(p, "utf8")); } catch { bad.push(p); } }
      }
    })(process.argv[1]);
    if (bad.length) { console.log(bad.join("\n")); process.exit(1); }
  ' "$work/data"); then ok=1; break; fi
  say "intento $attempt: JSON a medio escribir, repito en 3 s: $bad"
  sleep 3
done
[ "$ok" = 1 ] || warn "algún JSON sigue ilegible tras 3 intentos; se guarda la copia igualmente: $bad"

tar -C "$work" -czf "$out.part" data
mv "$out.part" "$out"
chmod 600 "$out"

# Retención: las de más de $keep días (nunca la que se acaba de hacer).
find "$BACKUP_DIR" -maxdepth 1 -name 'tavernus-data-*.tar.gz' -mtime +"$((keep - 1))" ! -path "$out" -delete

size=$(du -h "$out" | cut -f1)
say "copia hecha: $out ($size); hay $(find "$BACKUP_DIR" -maxdepth 1 -name 'tavernus-data-*.tar.gz' | wc -l) en $BACKUP_DIR"
[ "$QUIET" = 1 ] && echo "$out"
exit 0
