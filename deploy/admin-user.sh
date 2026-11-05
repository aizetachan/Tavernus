#!/usr/bin/env bash
# Usuario administrador de la web sin navegador (src/accounts/cli.ts). Como root en el servidor:
#
#   sudo tavernus-admin miguel              lo hace administrador; si no existe, lo crea y pide contraseña
#   sudo tavernus-admin miguel --password   además le pone una contraseña nueva (y cierra sus sesiones)
#
# Usa la base y la carpeta de partidas de /etc/tavernus/env y corre como el usuario tavernus, que es
# quien entra en PostgreSQL (peer). Funciona con la web en marcha.
set -euo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"
require_root
[ $# -ge 1 ] || die "uso: tavernus-admin <usuario> [--password]"
cd "$APP_DIR/current"
exec runuser -u "$SVC_USER" -- env DATABASE_URL="$(envget DATABASE_URL)" GAMES_DIR="$(envget GAMES_DIR "$SRV_DATA/games")" \
  node dist/index.js --admin "$@"
