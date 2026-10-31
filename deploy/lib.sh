# Funciones comunes de los scripts del servidor (setup, release, healthcheck, copias).
# Se carga con `. "$(dirname "$0")/lib.sh"`; vale desde deploy/ y desde /usr/local/lib/tavernus.
# shellcheck shell=bash disable=SC2034

APP_DIR=/opt/tavernus                    # código: releases/<fecha> y el enlace current
STATE_DIR=/var/lib/tavernus              # todo lo que no es código
SRV_DATA=$STATE_DIR/data                 # el data/ del repo: games/ y local/
BACKUP_DIR=$STATE_DIR/backups
HEALTH_DIR=$STATE_DIR/health
MAINT_FLAG=$HEALTH_DIR/maintenance       # si existe, healthcheck.sh no reinicia ni avisa
DEPLOY_DIR=$STATE_DIR/deploy             # del usuario tavernus: lo único suyo fuera del código
DEPLOY_FLAG=$DEPLOY_DIR/en-curso         # lo pone release.sh; healthcheck.sh calla mientras es reciente
CADDY_ENV=/etc/tavernus/caddy.env
CADDY_PUBLISH=/usr/local/sbin/tavernus-publicar-caddy   # lo instala preparar-usuario-deploy.sh
ENV_FILE=/etc/tavernus/env
OPS_DIR=/usr/local/lib/tavernus          # copia instalada de estos scripts
SERVICE=tavernus-web
SVC_USER=tavernus

log() { printf '[tavernus] %s\n' "$*"; }
warn() { printf '[tavernus] AVISO: %s\n' "$*" >&2; }
die() { printf '[tavernus] ERROR: %s\n' "$*" >&2; exit 1; }
require_root() { [ "$(id -u)" = 0 ] || die "hay que ejecutarlo como root (sudo $0 …)"; }

# load_caddy_env: exporta las variables de caddy.env leídas como las lee systemd (EnvironmentFile),
# no como shell: TAVERNUS_DOMAIN puede llevar comas y espacios («tavernus.com, www.tavernus.com»)
# y un `. caddy.env` lo rompería.
load_caddy_env() {
  local k v
  [ -r "$CADDY_ENV" ] || return 0
  while IFS='=' read -r k v; do
    case $k in ''|\#*) continue ;; esac
    v=${v%$'\r'}; v=${v%\"}; v=${v#\"}
    export "$k=$v"
  done < "$CADDY_ENV"
}

# envget CLAVE [por_defecto]: valor de CLAVE en /etc/tavernus/env (la última línea gana).
# No se hace `source` del fichero: el formato es el de systemd, no el de bash.
envget() {
  local v=''
  if [ -r "$ENV_FILE" ]; then
    v=$(sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n 1)
    v=${v%$'\r'}
    case $v in \"*\") v=${v#\"}; v=${v%\"} ;; \'*\') v=${v#\'}; v=${v%\'} ;; esac
  fi
  printf '%s' "${v:-${2:-}}"
}

# probe: ¿responde la web? 0 = sí. Prueba HEALTH_PATH (/api/health); si la web aún no tiene
# esa ruta (hoy da 400 «falta ?game», o 403 con acceso por invitación), se conforma con que la
# portada dé 200 (en modo invitación es la página «pide tu enlace», que también da 200).
# Deja el motivo en PROBE_DETAIL.
PROBE_DETAIL=''
probe() {
  local port path base code fallback
  # /etc/tavernus/env es solo de root: el usuario tavernus saca el puerto de caddy.env.
  port=$(envget WEB_PORT)
  [ -n "$port" ] || port=$(sed -n 's/^WEB_PORT=//p' "$CADDY_ENV" 2>/dev/null | tail -n 1 | tr -d '\r')
  port=${port:-3000}
  path=$(envget HEALTH_PATH /api/health)
  base="http://127.0.0.1:$port"
  code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$base$path" 2>/dev/null) || code=000
  case $code in 400|401|403|404) fallback=1 ;; *) fallback=0 ;; esac
  if [ "$fallback" = 1 ]; then
    code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "$base/" 2>/dev/null) || code=000
    path=/
  fi
  PROBE_DETAIL="GET $path -> $code"
  [ "$code" = 200 ]
}
