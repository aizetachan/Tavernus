#!/usr/bin/env bash
# Sube la web al VPS y la reinicia. Desde la raíz del repo, en Git Bash (Windows), macOS o Linux.
# En PowerShell sin Git Bash: deploy\push.ps1, que hace lo mismo.
#
#   deploy/push.sh --setup [--domain D] [--proxy caddy|nginx] [--fail2ban] …
#                         primera vez: sube deploy/ y ejecuta setup-vps.sh en el servidor
#   deploy/push.sh --usuario-deploy [--clave pc "$(cat ~/.ssh/tavernus_pc.pub)"] [--quitar N] [--deshacer]
#                         prepara, rota o deshace el usuario tavernus para desplegar sin root
#                         (preparar-usuario-deploy.sh)
#   deploy/push.sh --ops  instala los scripts de operación y las unidades de systemd de tu deploy/
#                         (install-ops.sh): lo que el usuario tavernus no puede instalar
#   deploy/push.sh        compila aquí (npm run build), sube el código y dist/ (nunca node_modules,
#                         data/ ni .env), instala dependencias de producción, reinicia y comprueba
#                         salud; si la versión nueva no responde, vuelve sola a la anterior
#   deploy/push.sh --remote-build   compila en el servidor en vez de aquí
#   deploy/push.sh --test           pasa los tests antes de subir
#
# Dónde está el servidor (variables de entorno o deploy/local.env, que no se sube a git):
#   TAVERNUS_HOST=tavernus@203.0.113.7  quién despliega: tavernus (sin root), root o un usuario con sudo
#   TAVERNUS_SSH_PORT=22
#   TAVERNUS_SSH_KEY=~/.ssh/tavernus_pc opcional
#   TAVERNUS_SSH_OPTS="-o …"            opcional: opciones extra de ssh/scp
#   TAVERNUS_ADMIN_HOST=root@203.0.113.7  para --setup, --ops y --usuario-deploy (si no, TAVERNUS_HOST)
#   TAVERNUS_ADMIN_SSH_KEY=~/.ssh/…       su clave (si no, TAVERNUS_SSH_KEY)
set -euo pipefail
cd "$(dirname "$0")/.."
# Lo que venga en el entorno manda sobre deploy/local.env (TAVERNUS_HOST=root@… deploy/push.sh).
if [ -f deploy/local.env ]; then
  keep=$(declare -p TAVERNUS_HOST TAVERNUS_SSH_PORT TAVERNUS_SSH_KEY TAVERNUS_SSH_OPTS \
    TAVERNUS_ADMIN_HOST TAVERNUS_ADMIN_SSH_KEY 2>/dev/null || true)
  # shellcheck disable=SC1091
  . deploy/local.env
  eval "$keep"
fi
HOST=${TAVERNUS_HOST:?pon TAVERNUS_HOST=usuario@servidor (o créalo en deploy/local.env)}
PORT=${TAVERNUS_SSH_PORT:-22}
ADMIN_HOST=${TAVERNUS_ADMIN_HOST:-$HOST}
ADMIN_KEY=${TAVERNUS_ADMIN_SSH_KEY:-${TAVERNUS_SSH_KEY:-}}
SSH_OPTS=(-p "$PORT" -o ServerAliveInterval=30)
SCP_OPTS=(-P "$PORT")
# Opciones extra de ssh/scp, p. ej. TAVERNUS_SSH_OPTS="-o StrictHostKeyChecking=accept-new".
# shellcheck disable=SC2206
[ -n "${TAVERNUS_SSH_OPTS:-}" ] && { SSH_OPTS+=($TAVERNUS_SSH_OPTS); SCP_OPTS+=($TAVERNUS_SSH_OPTS); }
ADMIN_SSH_OPTS=("${SSH_OPTS[@]}"); ADMIN_SCP_OPTS=("${SCP_OPTS[@]}")
if [ -n "${TAVERNUS_SSH_KEY:-}" ]; then SSH_OPTS+=(-i "$TAVERNUS_SSH_KEY"); SCP_OPTS+=(-i "$TAVERNUS_SSH_KEY"); fi
if [ -n "$ADMIN_KEY" ]; then ADMIN_SSH_OPTS+=(-i "$ADMIN_KEY"); ADMIN_SCP_OPTS+=(-i "$ADMIN_KEY"); fi
# sudo solo si el usuario no es root ni tavernus (tavernus usa su sudo limitado dentro de release.sh).
# shellcheck disable=SC2016  # $(id -un) y $S se expanden en el servidor
SUDO='S=; case $(id -un) in root|tavernus) ;; *) S=sudo ;; esac;'

ADMIN_SCRIPT=''; REMOTE_BUILD=0; TEST=0; ADMIN_ARGS=()
while [ $# -gt 0 ]; do
  case $1 in
    --setup) ADMIN_SCRIPT=setup-vps.sh ;;
    --ops) ADMIN_SCRIPT=install-ops.sh ;;
    --usuario-deploy) ADMIN_SCRIPT=preparar-usuario-deploy.sh ;;
    --remote-build) REMOTE_BUILD=1 ;;
    --test) TEST=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) [ -n "$ADMIN_SCRIPT" ] || { echo "opción desconocida: $1" >&2; exit 1; }; ADMIN_ARGS+=("$1") ;;
  esac
  shift
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# En el Mac, que tar no meta ficheros ._* con atributos extendidos.
export COPYFILE_DISABLE=1

# --setup, --ops y --usuario-deploy: como administrador (root o sudo), con el deploy/ de aquí.
if [ -n "$ADMIN_SCRIPT" ]; then
  echo "[push] subiendo deploy/ a $ADMIN_HOST y ejecutando $ADMIN_SCRIPT"
  tar -czf "$TMP/deploy.tgz" --exclude=deploy/local.env --exclude=deploy/gcp deploy
  up=/tmp/tavernus-deploy-$(date +%Y%m%d-%H%M%S).tgz
  scp "${ADMIN_SCP_OPTS[@]}" "$TMP/deploy.tgz" "$ADMIN_HOST:$up"
  # printf %q para pasar las opciones tal cual por ssh.
  args=''; [ ${#ADMIN_ARGS[@]} -gt 0 ] && args=$(printf ' %q' "${ADMIN_ARGS[@]}")
  # install-ops.sh recibe la carpeta deploy/; los otros, sus opciones.
  [ "$ADMIN_SCRIPT" = install-ops.sh ] && args=' "$D"/deploy'
  ssh -t "${ADMIN_SSH_OPTS[@]}" "$ADMIN_HOST" "set -e; $SUDO
    D=\$(mktemp -d); tar -xzf $up -C \"\$D\"; rm -f $up
    find \"\$D\"/deploy -type f -exec sed -i 's/\r\$//' {} +
    \$S bash \"\$D\"/deploy/$ADMIN_SCRIPT$args; rm -rf \"\$D\""
  exit 0
fi

if [ "$TEST" = 1 ]; then npm test; fi
if [ "$REMOTE_BUILD" = 0 ]; then
  echo "[push] compilando (npm run build)"
  rm -rf dist
  npm run build
fi

STAMP=$(date +%Y%m%d-%H%M%S)
echo "[push] empaquetando la versión $STAMP"
# Lista explícita de lo que se sube (nunca node_modules, data/, .env ni .git). Mejor que --exclude:
# el tar de macOS y de Windows (bsdtar) no ancla los patrones y «./data» quitaría también dist/data.
items=(package.json package-lock.json tsconfig.json src public assets deploy docs README.md)
[ "$REMOTE_BUILD" = 0 ] && items+=(dist)
present=()
for i in "${items[@]}"; do [ -e "$i" ] && present+=("$i"); done
tar -czf "$TMP/release.tgz" --exclude=deploy/local.env --exclude='*.log' "${present[@]}"
echo "[push] subiendo $(du -h "$TMP/release.tgz" | cut -f1) a $HOST"
# Un nombre por versión: root y tavernus no chocan con un fichero que el otro dejara a medias.
up=/tmp/tavernus-release-$STAMP.tgz
scp "${SCP_OPTS[@]}" "$TMP/release.tgz" "$HOST:$up"

flag=''; [ "$REMOTE_BUILD" = 1 ] && flag=' --remote-build'
# La clave de tavernus lleva «restrict» (sin terminal) y no le hace falta: su sudo no pide nada.
tty=(-t); [ "${HOST%%@*}" = tavernus ] && tty=()
ssh "${tty[@]}" "${SSH_OPTS[@]}" "$HOST" "set -e; $SUDO
  R=/opt/tavernus/releases/$STAMP
  \$S mkdir -p \"\$R\"; \$S tar -xzf $up -C \"\$R\"; rm -f $up
  \$S find \"\$R\"/deploy -type f -exec sed -i 's/\r\$//' {} +
  \$S bash \"\$R\"/deploy/release.sh $STAMP$flag"
echo "[push] hecho: versión $STAMP"
