#!/usr/bin/env bash
# Prepara un VPS Debian o Ubuntu (con systemd) para la web de Tavernus. Una vez, como root.
# Se puede repetir sin miedo: lo que ya está hecho no se rehace y /etc/tavernus/env no se pisa.
#
#   sudo bash setup-vps.sh --domain tavernus.ejemplo.com    con dominio (HTTPS automático)
#   sudo bash setup-vps.sh --domain 203.0.113.7.sslip.io    sin dominio, con HTTPS
#   sudo bash setup-vps.sh                                  sin dominio: http://<IP>
#
# Opciones:
#   --domain NOMBRE   dominio que ya apunta a la IP del VPS (registro A/AAAA)
#   --proxy caddy|nginx|none   proxy inverso (caddy por defecto; nginx usa certbot)
#   --email CORREO    solo con nginx: correo para Let's Encrypt
#   --fail2ban        instala fail2ban para SSH
#   --no-ufw          no toca el cortafuegos
#   --no-swap         no crea swap aunque haya menos de 2 GB de RAM
#
# Lo normal es no llamarlo a mano: `deploy/push.sh --setup [opciones]` desde tu ordenador lo sube
# y lo ejecuta. Después, `deploy/push.sh` sube el código. Guía: docs/DESPLIEGUE.md.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
# shellcheck source=lib.sh
. "$HERE/lib.sh"

DOMAIN=''; PROXY=caddy; EMAIL=''; FAIL2BAN=0; UFW=1; SWAP=1
while [ $# -gt 0 ]; do
  case $1 in
    --domain) DOMAIN=${2:?falta el dominio}; shift ;;
    --proxy) PROXY=${2:?falta caddy, nginx o none}; shift ;;
    --email) EMAIL=${2:?falta el correo}; shift ;;
    --fail2ban) FAIL2BAN=1 ;;
    --no-ufw) UFW=0 ;;
    --no-swap) SWAP=0 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) die "opción desconocida: $1 (mira --help)" ;;
  esac
  shift
done
case $PROXY in caddy|nginx|none) ;; *) die "--proxy debe ser caddy, nginx o none" ;; esac
[ "$PROXY" = nginx ] && [ -z "$DOMAIN" ] && die "nginx necesita --domain (sin dominio, usa caddy)"

require_root
command -v systemctl >/dev/null || die "este servidor no tiene systemd"
# shellcheck disable=SC1091
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
  *" debian "*|*" ubuntu "*) log "sistema: ${PRETTY_NAME:-$ID}" ;;
  *) die "solo Debian o Ubuntu (este es ${PRETTY_NAME:-desconocido})" ;;
esac
export DEBIAN_FRONTEND=noninteractive

# --- Paquetes básicos ------------------------------------------------------------------------
log "paquetes básicos"
apt-get update -y
apt-get install -y --no-install-recommends ca-certificates curl gnupg tar gzip rsync ufw unattended-upgrades

# --- Node 22 LTS (NodeSource) ----------------------------------------------------------------
node_major() { node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'; }
if [ "$(node_major || echo 0)" -ge 22 ] 2>/dev/null; then
  log "node $(node -v) ya instalado"
else
  log "instalando Node 22 LTS desde NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  apt-get install -y nodejs
  rm -f /tmp/nodesource_setup.sh
fi
log "node $(node -v), npm $(npm -v)"

# --- Usuario de servicio y carpetas ----------------------------------------------------------
if ! id "$SVC_USER" >/dev/null 2>&1; then
  log "creando el usuario de servicio $SVC_USER (sin contraseña ni shell)"
  useradd --system --user-group --home-dir "$APP_DIR" --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
fi
install -d -o "$SVC_USER" -g "$SVC_USER" -m 755 "$APP_DIR" "$APP_DIR/releases"
install -d -o "$SVC_USER" -g "$SVC_USER" -m 750 "$STATE_DIR" "$SRV_DATA" "$SRV_DATA/games" "$SRV_DATA/local" "$DEPLOY_DIR"
install -d -o root -g root -m 700 "$BACKUP_DIR" "$HEALTH_DIR"
install -d -o root -g root -m 755 /etc/tavernus "$OPS_DIR"

# --- Swap si hay menos de 2 GB de RAM --------------------------------------------------------
mem_kb=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
if [ "$SWAP" = 1 ] && [ "$mem_kb" -lt 2000000 ] && [ -z "$(swapon --noheadings 2>/dev/null)" ]; then
  log "RAM de $((mem_kb / 1024)) MB: creando 2 GB de swap en /swapfile"
  if { fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none; } \
     && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile; then
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    sysctl -q vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/90-tavernus-swap.conf
  else
    rm -f /swapfile
    warn "no se pudo crear swap (¿VPS en contenedor?); sigue sin ella"
  fi
fi

# --- Entorno: /etc/tavernus/env (600, solo root) ----------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  log "creando $ENV_FILE a partir de env.example, con ADMIN_TOKEN y SESSION_SECRET al azar"
  rnd() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
  public_url=''; [ -n "$DOMAIN" ] && public_url="https://$DOMAIN"
  sed -e "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$(rnd 24)/" -e "s/^# SESSION_SECRET=.*/SESSION_SECRET=$(rnd 32)/" \
      -e "s|^PUBLIC_URL=.*|PUBLIC_URL=$public_url|" "$HERE/env.example" > "$ENV_FILE"
  NEW_ENV=1
else
  log "$ENV_FILE ya existe: no se toca"
  NEW_ENV=0
fi
chown root:root "$ENV_FILE"; chmod 600 "$ENV_FILE"
echo "$PROXY" > /etc/tavernus/proxy

# --- Proxy inverso ---------------------------------------------------------------------------
WEB_PORT=$(envget WEB_PORT 3000)
if [ "$PROXY" = caddy ]; then
  if ! command -v caddy >/dev/null; then
    log "instalando Caddy (repositorio oficial)"
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
  caddy_env=/etc/tavernus/caddy.env
  if [ -n "$DOMAIN" ] || [ ! -f "$caddy_env" ]; then
    printf 'TAVERNUS_DOMAIN=%s\nWEB_PORT=%s\n' "${DOMAIN:-:80}" "$WEB_PORT" > "$caddy_env"
  fi
  chmod 644 "$caddy_env"
  install -d /etc/systemd/system/caddy.service.d
  printf '[Service]\nEnvironmentFile=%s\n' "$caddy_env" > /etc/systemd/system/caddy.service.d/tavernus.conf
  install -m 644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
  systemctl daemon-reload
  systemctl enable caddy >/dev/null 2>&1
  # validate necesita las variables, que en el servicio pone el drop-in.
  load_caddy_env
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
  systemctl restart caddy
  log "Caddy sirve $(sed -n 's/^TAVERNUS_DOMAIN=//p' "$caddy_env") -> 127.0.0.1:$WEB_PORT"
elif [ "$PROXY" = nginx ]; then
  log "instalando nginx y certbot"
  apt-get install -y nginx certbot python3-certbot-nginx
  conf=/etc/nginx/sites-available/tavernus
  if [ ! -f "$conf" ]; then
    sed -e "s/__DOMAIN__/$DOMAIN/g" -e "s/__WEB_PORT__/$WEB_PORT/g" "$HERE/nginx-tavernus.conf" > "$conf"
  fi
  ln -sfn "$conf" /etc/nginx/sites-enabled/tavernus
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  if [ -n "$EMAIL" ]; then mail_opt=(-m "$EMAIL"); else mail_opt=(--register-unsafely-without-email); fi
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${mail_opt[@]}" \
    || warn "certbot falló (¿el dominio apunta ya a esta IP?). Repite: certbot --nginx -d $DOMAIN"
fi

# --- Scripts de operación, servicio y temporizadores -----------------------------------------
bash "$HERE/install-ops.sh" "$HERE"

# --- Cortafuegos -----------------------------------------------------------------------------
if [ "$UFW" = 1 ]; then
  # El puerto SSH de esta conexión y los de sshd, para no dejarte fuera.
  ssh_ports=$( { echo 22; echo "${SSH_CONNECTION:-}" | awk '{print $4}'; sshd -T 2>/dev/null | awk '/^port /{print $2}'; } | grep -E '^[0-9]+$' | sort -u)
  for p in $ssh_ports; do ufw allow "$p/tcp" comment 'ssh' >/dev/null; done
  ufw allow 80/tcp comment 'http' >/dev/null
  ufw allow 443/tcp comment 'https' >/dev/null
  ufw allow 443/udp comment 'http3' >/dev/null
  ufw --force enable >/dev/null
  log "ufw activo: SSH ($(echo "$ssh_ports" | tr '\n' ' '| sed 's/ $//')), 80 y 443"
fi

# --- fail2ban (opcional) ---------------------------------------------------------------------
if [ "$FAIL2BAN" = 1 ]; then
  log "instalando fail2ban para SSH"
  apt-get install -y fail2ban
  printf '[sshd]\nenabled = true\nbackend = systemd\nmaxretry = 5\nbantime = 1h\n' > /etc/fail2ban/jail.d/tavernus.local
  systemctl enable --now fail2ban >/dev/null 2>&1
  systemctl restart fail2ban
fi

# --- Resumen ---------------------------------------------------------------------------------
echo
log "servidor listo."
[ "$NEW_ENV" = 1 ] && log "rellena las claves: sudo nano $ENV_FILE   (ANTHROPIC_API_KEY, IMAGES, ALERT_WEBHOOK…)"
log "ADMIN_TOKEN: sudo grep ^ADMIN_TOKEN $ENV_FILE"
log "siguiente paso, desde tu ordenador: deploy/push.sh"
