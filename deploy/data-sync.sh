#!/usr/bin/env bash
# Lleva las partidas entre tu ordenador (data/ del repo) y el servidor (/var/lib/tavernus/data).
# Desde la raíz del repo, en Git Bash, macOS o Linux. Usa el mismo TAVERNUS_HOST que push.sh.
#
#   deploy/data-sync.sh up             sube data/games y data/local (sin los PDF de manuals/) y
#                                      AÑADE en el servidor las partidas que no estén; no toca las
#                                      que ya existen allí
#   deploy/data-sync.sh up --replace   sustituye todo data/ del servidor por el tuyo
#                                      (lo normal la primera vez, antes de que nadie juegue allí)
#   … --yes                            sin preguntar en el servidor
#   deploy/data-sync.sh down           copia del servidor -> data/local/servidor/<fecha>/
#                                      (sin tocar tus partidas; ábrela con las variables que imprime)
#   deploy/data-sync.sh down --merge   además añade a tu data/ las partidas que no tengas
#   deploy/data-sync.sh backup         descarga la última copia diaria a data/local/servidor/
#
# Antes de cambiar nada, el servidor hace una copia de su estado (tavernus-restore).
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
[ -f deploy/local.env ] && . deploy/local.env
HOST=${TAVERNUS_HOST:?pon TAVERNUS_HOST=usuario@servidor (o créalo en deploy/local.env)}
PORT=${TAVERNUS_SSH_PORT:-22}
SSH_OPTS=(-p "$PORT" -o ServerAliveInterval=30)
SCP_OPTS=(-P "$PORT")
if [ -n "${TAVERNUS_SSH_KEY:-}" ]; then SSH_OPTS+=(-i "$TAVERNUS_SSH_KEY"); SCP_OPTS+=(-i "$TAVERNUS_SSH_KEY"); fi
# Opciones extra de ssh/scp, p. ej. TAVERNUS_SSH_OPTS="-o StrictHostKeyChecking=accept-new".
# shellcheck disable=SC2206
[ -n "${TAVERNUS_SSH_OPTS:-}" ] && { SSH_OPTS+=($TAVERNUS_SSH_OPTS); SCP_OPTS+=($TAVERNUS_SSH_OPTS); }
# shellcheck disable=SC2016  # $(id -u) y $S se expanden en el servidor
SUDO='S=; [ "$(id -u)" = 0 ] || S=sudo;'
export COPYFILE_DISABLE=1

CMD=${1:-}; OPT=${2:-}; YES=''
for a in "$@"; do [ "$a" = --yes ] && YES=--yes; done
[ "$OPT" = --yes ] && OPT=${3:-}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
STAMP=$(date +%Y-%m-%d_%H%M%S)
LOCAL_IN=data/local/servidor

# merge_into ORIGEN DESTINO: copia las carpetas de ORIGEN/games/* y ORIGEN/local/* que no existan
# en DESTINO (por partida o carpeta entera, para no mezclar ficheros de dos partidas).
merge_into() {
  local sub entry name n=0
  for sub in games local; do
    [ -d "$1/$sub" ] || continue
    mkdir -p "$2/$sub"
    for entry in "$1/$sub"/*; do
      [ -e "$entry" ] || continue
      name=$(basename "$entry")
      [ "$sub/$name" = local/servidor ] && continue
      if [ -e "$2/$sub/$name" ]; then echo "  ya está: $sub/$name"
      else cp -R "$entry" "$2/$sub/$name"; echo "  añadido: $sub/$name"; n=$((n + 1)); fi
    done
  done
  echo "[datos] añadidas $n"
}

case $CMD in
  up)
    mode=--merge
    case $OPT in --replace) mode='' ;; ''|--merge) ;; *) echo "opción desconocida: $OPT" >&2; exit 1 ;; esac
    [ -d data/games ] || [ -d data/local ] || { echo "no hay data/ que subir" >&2; exit 1; }
    tar -czf "$TMP/data.tgz" --exclude=data/local/manuals --exclude=data/local/servidor data
    echo "[datos] subiendo $(du -h "$TMP/data.tgz" | cut -f1) a $HOST (${mode:-reemplazo total})"
    scp "${SCP_OPTS[@]}" "$TMP/data.tgz" "$HOST:/tmp/tavernus-data-up.tgz"
    ssh -t "${SSH_OPTS[@]}" "$HOST" "$SUDO
      \$S tavernus-restore /tmp/tavernus-data-up.tgz $mode $YES; rc=\$?
      rm -f /tmp/tavernus-data-up.tgz; exit \$rc"
    ;;
  down|backup)
    [ "$CMD" = backup ] && [ -n "$OPT" ] && { echo "backup no lleva opciones" >&2; exit 1; }
    case $OPT in ''|--merge) ;; *) echo "opción desconocida: $OPT" >&2; exit 1 ;; esac
    make=''
    # shellcheck disable=SC2016
    [ "$CMD" = down ] && make='$S tavernus-backup --quiet >/dev/null;'
    # La copia es de root (600): se deja en /tmp a nombre del usuario SSH para bajarla.
    ssh -t "${SSH_OPTS[@]}" "$HOST" "set -e; $SUDO $make
      f=\$(\$S sh -c 'ls -1 /var/lib/tavernus/backups/tavernus-data-*.tar.gz | tail -n 1')
      [ -n \"\$f\" ] || { echo 'no hay copias en el servidor'; exit 1; }
      \$S install -m 600 -o \$(id -u) \"\$f\" /tmp/tavernus-down.tgz; echo \"[datos] copia del servidor: \$f\""
    mkdir -p "$LOCAL_IN"
    file=$LOCAL_IN/tavernus-data-$STAMP.tar.gz
    scp "${SCP_OPTS[@]}" "$HOST:/tmp/tavernus-down.tgz" "$file"
    ssh "${SSH_OPTS[@]}" "$HOST" "rm -f /tmp/tavernus-down.tgz"
    echo "[datos] copia en $file"
    [ "$CMD" = backup ] && exit 0
    dest=$LOCAL_IN/$STAMP
    mkdir -p "$dest"
    tar -xzf "$file" -C "$dest"
    echo "[datos] descomprimida en $dest/data. Para abrirla sin tocar tus partidas:"
    echo "  GAMES_DIR=$dest/data/games DATA_DIR=$dest/data/local npm run web"
    if [ "$OPT" = --merge ]; then
      echo "[datos] añadiendo a data/ las partidas que no tienes"
      merge_into "$dest/data" data
    fi
    ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
