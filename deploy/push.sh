#!/usr/bin/env bash
# Sube la web al VPS y la reinicia. Desde la raíz del repo, en Git Bash (Windows), macOS o Linux.
# En PowerShell sin Git Bash: deploy\push.ps1, que hace lo mismo.
#
#   deploy/push.sh --setup [--domain D] [--proxy caddy|nginx] [--fail2ban] …
#                         primera vez: sube deploy/ y ejecuta setup-vps.sh en el servidor
#   deploy/push.sh        compila aquí (npm run build), sube el código y dist/ (nunca node_modules,
#                         data/ ni .env), instala dependencias de producción, reinicia y comprueba
#                         salud; si la versión nueva no responde, vuelve sola a la anterior
#   deploy/push.sh --remote-build   compila en el servidor en vez de aquí
#   deploy/push.sh --test           pasa los tests antes de subir
#
# Dónde está el servidor (variables de entorno o deploy/local.env, que no se sube a git):
#   TAVERNUS_HOST=usuario@203.0.113.7   usuario con sudo (o root)
#   TAVERNUS_SSH_PORT=22
#   TAVERNUS_SSH_KEY=~/.ssh/id_ed25519  opcional
#   TAVERNUS_SSH_OPTS="-o …"            opcional: opciones extra de ssh/scp
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
# sudo solo si el usuario no es root.
# shellcheck disable=SC2016  # $(id -u) y $S se expanden en el servidor
SUDO='S=; [ "$(id -u)" = 0 ] || S=sudo;'

SETUP=0; REMOTE_BUILD=0; TEST=0; SETUP_ARGS=()
while [ $# -gt 0 ]; do
  case $1 in
    --setup) SETUP=1 ;;
    --remote-build) REMOTE_BUILD=1 ;;
    --test) TEST=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) [ "$SETUP" = 1 ] || { echo "opción desconocida: $1" >&2; exit 1; }; SETUP_ARGS+=("$1") ;;
  esac
  shift
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# En el Mac, que tar no meta ficheros ._* con atributos extendidos.
export COPYFILE_DISABLE=1

if [ "$SETUP" = 1 ]; then
  echo "[push] subiendo deploy/ a $HOST y preparando el servidor"
  tar -czf "$TMP/deploy.tgz" --exclude=deploy/local.env --exclude=deploy/gcp deploy
  scp "${SCP_OPTS[@]}" "$TMP/deploy.tgz" "$HOST:/tmp/tavernus-deploy.tgz"
  # printf %q para pasar las opciones tal cual por ssh.
  args=''; [ ${#SETUP_ARGS[@]} -gt 0 ] && args=$(printf ' %q' "${SETUP_ARGS[@]}")
  ssh -t "${SSH_OPTS[@]}" "$HOST" "set -e; $SUDO
    D=\$(mktemp -d); tar -xzf /tmp/tavernus-deploy.tgz -C \"\$D\"; rm -f /tmp/tavernus-deploy.tgz
    find \"\$D\"/deploy -type f -exec sed -i 's/\r\$//' {} +
    \$S bash \"\$D\"/deploy/setup-vps.sh$args; rm -rf \"\$D\""
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
scp "${SCP_OPTS[@]}" "$TMP/release.tgz" "$HOST:/tmp/tavernus-release.tgz"

flag=''; [ "$REMOTE_BUILD" = 1 ] && flag=' --remote-build'
ssh -t "${SSH_OPTS[@]}" "$HOST" "set -e; $SUDO
  R=/opt/tavernus/releases/$STAMP
  \$S mkdir -p \"\$R\"; \$S tar -xzf /tmp/tavernus-release.tgz -C \"\$R\"; rm -f /tmp/tavernus-release.tgz
  \$S find \"\$R\"/deploy -type f -exec sed -i 's/\r\$//' {} +
  \$S bash \"\$R\"/deploy/release.sh $STAMP$flag"
echo "[push] hecho: versión $STAMP"
