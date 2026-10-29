#!/usr/bin/env bash
# Prepara el usuario tavernus para desplegar sin root (deploy/push.sh con TAVERNUS_HOST=tavernus@…).
# Como root, en un servidor ya preparado con setup-vps.sh. Se puede repetir sin miedo.
#
#   preparar-usuario-deploy.sh                          (re)aplica todo y conserva las claves
#   preparar-usuario-deploy.sh --clave pc 'ssh-ed25519 AAAA… comentario'
#                                                       añade o sustituye la clave «pc» (rotar)
#   preparar-usuario-deploy.sh --clave actions '…'      la de GitHub Actions, otra línea
#   preparar-usuario-deploy.sh --quitar actions         quita una clave
#   preparar-usuario-deploy.sh --deshacer               vuelta atrás: sin entrada SSH ni sudo para
#                                                       tavernus (se despliega otra vez como root)
#
# Lo normal es lanzarlo desde tu ordenador con la clave de administración:
#   deploy/push.sh --usuario-deploy --clave pc "$(cat ~/.ssh/tavernus_pc.pub)"
#
# Qué deja:
#   - tavernus (el usuario con el que ya corre tavernus-web): shell bash, sin contraseña, home
#     /home/tavernus, fuera del grupo docker, dueño de /opt/tavernus y de /var/lib/tavernus/deploy.
#   - /home/tavernus/.ssh/authorized_keys con «restrict» en cada línea. Home, .ssh y el fichero son
#     de root (tavernus solo lee): no puede añadirse claves ni quitarse el restrict.
#   - /etc/sudoers.d/tavernus (validado con visudo -c): reiniciar tavernus-web, reset-failed, leer
#     sus 30 últimas líneas del journal, recargar Caddy y /usr/local/sbin/tavernus-publicar-caddy.
#   - Los scripts de operación y las unidades de esta copia de deploy/ (install-ops.sh).
# Antes de cambiar nada guarda lo que toca en /root/tavernus-deploy-<fecha>/.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"
require_root

HOME_DIR=/home/$SVC_USER
SSH_DIR=$HOME_DIR/.ssh
AUTH_KEYS=$SSH_DIR/authorized_keys
SUDOERS=/etc/sudoers.d/$SVC_USER
LABEL=tavernus-deploy              # comentario de cada clave: tavernus-deploy:<nombre>

declare -A NEW_KEYS=()
DROP=(); UNDO=0
while [ $# -gt 0 ]; do
  case $1 in
    --clave) NEW_KEYS[${2:?falta el nombre de la clave}]=${3:?falta la clave pública}; shift 2 ;;
    --quitar) DROP+=("${2:?falta el nombre de la clave}"); shift ;;
    --deshacer) UNDO=1 ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) die "opción desconocida: $1 (mira --help)" ;;
  esac
  shift
done
for c in visudo runuser ssh-keygen node caddy; do command -v "$c" >/dev/null || die "falta $c"; done
id "$SVC_USER" >/dev/null 2>&1 || die "no existe el usuario $SVC_USER: prepara antes el servidor (deploy/push.sh --setup)"

# --- Copia de lo que se va a tocar -----------------------------------------------------------
BK=/root/tavernus-deploy-$(date +%Y%m%d-%H%M%S)
install -d -m 700 "$BK" "$BK/systemd" "$BK/ops"
{
  getent passwd "$SVC_USER"; getent group "$SVC_USER"; id "$SVC_USER"
  getent shadow "$SVC_USER" | cut -d: -f1,2 | sed -E 's/:(.).*/:\1… (contraseña: ! o * = bloqueada)/'
} > "$BK/cuenta.txt"
cp -p /etc/systemd/system/tavernus-* "$BK/systemd/" 2>/dev/null || true
cp -p "$OPS_DIR"/* "$BK/ops/" 2>/dev/null || true
for f in "$SUDOERS" "$AUTH_KEYS" "$CADDY_PUBLISH" /etc/caddy/Caddyfile; do
  [ -e "$f" ] && cp -p "$f" "$BK/$(basename "$f")"
done
find "$APP_DIR" -maxdepth 2 -printf '%u:%g %m %p\n' > "$BK/propietarios.txt" 2>/dev/null || true
find "$STATE_DIR" "$HOME_DIR" -maxdepth 2 -printf '%u:%g %m %p\n' >> "$BK/propietarios.txt" 2>/dev/null || true
log "copia de lo que se toca en $BK"

# --- Vuelta atrás ----------------------------------------------------------------------------
if [ "$UNDO" = 1 ]; then
  rm -f "$SUDOERS" "$CADDY_PUBLISH"
  visudo -c >/dev/null || die "visudo -c falla tras quitar $SUDOERS: revísalo a mano"
  rm -rf "$SSH_DIR"
  rmdir "$HOME_DIR" 2>/dev/null || true
  usermod --shell /usr/sbin/nologin --home "$APP_DIR" "$SVC_USER"
  log "deshecho: $SVC_USER ya no entra por SSH ni tiene sudo; despliega como root (TAVERNUS_HOST=root@…)."
  log "release.sh vuelve a instalar el Caddyfile por install-ops.sh. La copia de antes está en $BK"
  exit 0
fi

# --- Cuenta ----------------------------------------------------------------------------------
usermod --shell /bin/bash "$SVC_USER"
usermod --lock "$SVC_USER"            # sin contraseña: solo entra con clave
# usermod no cambia el home de un usuario con procesos: se para la web unos segundos (como en un
# despliegue) y se arranca pase lo que pase. Solo la primera vez; después el home ya es este.
if [ "$(getent passwd "$SVC_USER" | cut -d: -f6)" != "$HOME_DIR" ]; then
  stopped=0
  if pgrep -u "$SVC_USER" >/dev/null; then
    log "paro $SERVICE unos segundos para cambiar el home de $SVC_USER"
    systemctl stop "$SERVICE"; stopped=1
  fi
  rc=0; usermod --home "$HOME_DIR" "$SVC_USER" || rc=$?
  [ "$stopped" = 1 ] && systemctl start "$SERVICE"
  [ "$rc" = 0 ] || die "usermod --home falló (¿quedan procesos de $SVC_USER? pgrep -u $SVC_USER)"
fi
if id -nG "$SVC_USER" | tr ' ' '\n' | grep -qx docker; then
  gpasswd -d "$SVC_USER" docker >/dev/null
  log "quitado $SVC_USER del grupo docker (Tavernus no usa Docker)"
fi
log "$SVC_USER: shell bash, home $HOME_DIR, contraseña bloqueada"

# Código y bandera de despliegue, suyos. El servicio no los puede escribir (ProtectSystem=strict).
find "$APP_DIR" \( ! -user "$SVC_USER" -o ! -group "$SVC_USER" \) -exec chown -h "$SVC_USER:$SVC_USER" {} +
install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$DEPLOY_DIR"

# --- Claves SSH ------------------------------------------------------------------------------
install -d -o root -g "$SVC_USER" -m 750 "$HOME_DIR" "$SSH_DIR"
tmp=$(mktemp)
trap 'rm -f "$tmp" "$tmp".*' EXIT
# Las líneas de este script se conservan salvo las que se quitan o sustituyen.
if [ -f "$AUTH_KEYS" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    name=$(printf '%s\n' "$line" | sed -n "s/.* $LABEL:\([a-z0-9-]*\)\$/\1/p")
    if [ -z "$name" ]; then warn "se quita una línea de $AUTH_KEYS que no es de este script"; continue; fi
    keep=1
    for d in "${DROP[@]}"; do [ "$d" = "$name" ] && keep=0; done
    [ -n "${NEW_KEYS[$name]+x}" ] && keep=0
    [ "$keep" = 1 ] && printf '%s\n' "$line" >> "$tmp"
  done < "$AUTH_KEYS"
fi
for name in "${!NEW_KEYS[@]}"; do
  [[ $name =~ ^[a-z0-9][a-z0-9-]{0,30}$ ]] || die "nombre de clave no válido: $name (minúsculas, cifras y guiones)"
  read -r type blob _ <<< "${NEW_KEYS[$name]}"
  case $type in
    ssh-ed25519|sk-ssh-ed25519@openssh.com|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521|sk-ecdsa-sha2-nistp256@openssh.com) ;;
    *) die "la clave $name no es una pública ed25519/ecdsa (empieza por «$type»)" ;;
  esac
  [[ $blob =~ ^[A-Za-z0-9+/]+=*$ ]] || die "la clave $name no parece una clave pública"
  printf '%s %s\n' "$type" "$blob" > "$tmp.uno"
  ssh-keygen -l -f "$tmp.uno" >/dev/null 2>&1 || die "ssh-keygen no reconoce la clave $name"
  # La de root es para administrar: que no se cuele también aquí.
  if grep -qF "$blob" /root/.ssh/authorized_keys 2>/dev/null; then
    die "la clave $name es una de las de root: genera una propia para tavernus"
  fi
  printf 'restrict %s %s %s:%s\n' "$type" "$blob" "$LABEL" "$name" >> "$tmp"
  log "clave $name: $(ssh-keygen -l -f "$tmp.uno" | awk '{print $1, $2}')"
done
install -o root -g "$SVC_USER" -m 640 "$tmp" "$AUTH_KEYS"
n=$(grep -c . "$AUTH_KEYS" || true)
[ "$n" -gt 0 ] || warn "$AUTH_KEYS no tiene ninguna clave: añade una con --clave pc '…'"

# --- Envoltorio de Caddy y sudoers -----------------------------------------------------------
tr -d '\r' < "$HERE/tavernus-publicar-caddy.sh" > "$tmp.sbin"
install -o root -g root -m 755 "$tmp.sbin" "$CADDY_PUBLISH"

SYSTEMCTL=$(command -v systemctl); JOURNALCTL=$(command -v journalctl)
cat > "$tmp.sudoers" <<EOF
# Gestionado por deploy/preparar-usuario-deploy.sh (Tavernus). No editar a mano.
# El usuario tavernus despliega Tavernus sin root: solo estas órdenes, con estos argumentos.
$SVC_USER ALL=(root) NOPASSWD: $SYSTEMCTL restart $SERVICE, $SYSTEMCTL reset-failed $SERVICE, $SYSTEMCTL reload caddy, $JOURNALCTL -u $SERVICE -n 30 --no-pager -o cat, $CADDY_PUBLISH ""
EOF
visudo -c -f "$tmp.sudoers" >/dev/null || die "visudo no acepta el sudoers nuevo; no se instala"
install -o root -g root -m 440 "$tmp.sudoers" "$SUDOERS"
if ! visudo -c >/dev/null; then
  if [ -f "$BK/$(basename "$SUDOERS")" ]; then install -m 440 "$BK/$(basename "$SUDOERS")" "$SUDOERS"; else rm -f "$SUDOERS"; fi
  die "visudo -c falla con $SUDOERS; se deja como estaba"
fi
log "sudo de $SVC_USER: $SUDOERS (visudo -c correcto)"

# --- Scripts de operación (la bandera de despliegue en healthcheck.sh) -------------------------
bash "$HERE/install-ops.sh" "$HERE"

echo
log "listo. Prueba desde tu ordenador:"
log "  ssh -i ~/.ssh/tavernus_pc $SVC_USER@<servidor> 'systemctl status $SERVICE --no-pager'"
log "y despliega con TAVERNUS_HOST=$SVC_USER@<servidor> en deploy/local.env."
