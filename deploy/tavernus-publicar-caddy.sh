#!/usr/bin/env bash
# Publica el Caddyfile de la versión activa de Tavernus en el Caddy del sistema:
# /opt/tavernus/current/deploy/Caddyfile -> /etc/caddy/Caddyfile, valida la configuración completa
# y recarga Caddy. Si no valida o la recarga falla, deja el Caddyfile que había.
#
# Lo instala preparar-usuario-deploy.sh como /usr/local/sbin/tavernus-publicar-caddy (root, 755).
# release.sh lo llama tras cada despliegue: como root, directamente; como el usuario tavernus, con
# «sudo -n /usr/local/sbin/tavernus-publicar-caddy», lo único de /etc/caddy que sudoers le deja.
# No admite argumentos: origen y destino son fijos.
#
# El origen lo escribe tavernus y Caddy lo ejecuta como el usuario caddy, que lee los certificados
# de todos los sitios del servidor. Por eso el origen se trata como no fiable:
#   - se lee COMO tavernus, para que un enlace simbólico no cuele un fichero que solo lee root;
#   - se traduce a JSON con el propio Caddy y solo se acepta lo que Tavernus usa: un sitio en
#     :443/:80 para los dominios de caddy.env, proxy a 127.0.0.1 y manejadores sin acceso a disco
#     (nada de file_server, templates, import, log, tls, {file.*}, {env.*} ni opciones globales);
#   - se valida como el usuario caddy, con las mismas variables que le da systemd.
set -euo pipefail
umask 022
PATH=/usr/sbin:/usr/bin:/sbin:/bin

ORIGEN=/opt/tavernus/current/deploy/Caddyfile
DESTINO=/etc/caddy/Caddyfile
CADDY_ENV=/etc/tavernus/caddy.env
COPIAS=/var/backups/tavernus-caddy       # los 5 Caddyfile anteriores
DUENO=tavernus
MAX_BYTES=65536

die() { printf '[tavernus-publicar-caddy] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[tavernus-publicar-caddy] %s\n' "$*"; }
[ "$(id -u)" = 0 ] || die "tiene que correr como root (sudo -n $0)"
[ $# = 0 ] || die "no admite argumentos"
command -v caddy >/dev/null || die "no está instalado caddy"
command -v node >/dev/null || die "no está instalado node"

# Caddy arranca con main.caddy en el servidor compartido (importa este Caddyfile y sites/*.caddy);
# en un servidor solo de Tavernus, con el propio Caddyfile.
PRINCIPAL=$DESTINO
[ -f /etc/caddy/main.caddy ] && PRINCIPAL=/etc/caddy/main.caddy

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
chmod 755 "$TMP"
NUEVO=$TMP/Caddyfile
timeout 10 runuser -u "$DUENO" -- head -c $((MAX_BYTES + 1)) -- "$ORIGEN" > "$TMP/leido" \
  || die "no se puede leer $ORIGEN como $DUENO"
[ "$(wc -c < "$TMP/leido")" -le "$MAX_BYTES" ] || die "$ORIGEN pasa de $MAX_BYTES bytes"
tr -d '\r' < "$TMP/leido" > "$NUEVO"
[ -s "$NUEVO" ] || die "$ORIGEN está vacío"

if cmp -s "$NUEVO" "$DESTINO"; then
  log "Caddyfile sin cambios: no se recarga Caddy"
  exit 0
fi

# Variables como las lee systemd (EnvironmentFile), no como shell: el dominio lleva comas.
ENVS=(HOME=/var/lib/caddy PATH="$PATH")
DOMINIOS=''
if [ -r "$CADDY_ENV" ]; then
  while IFS='=' read -r k v; do
    case $k in ''|\#*) continue ;; esac
    v=${v%$'\r'}; v=${v%\"}; v=${v#\"}
    ENVS+=("$k=$v")
    [ "$k" = TAVERNUS_DOMAIN ] && DOMINIOS=$v
  done < "$CADDY_ENV"
fi
como_caddy() { runuser -u caddy -- env -i "${ENVS[@]}" "$@"; }

# 1) Texto: solo las dos variables de caddy.env y nada de import.
otras=$(grep -oE '\{\$[A-Za-z0-9_]+' "$NUEVO" | grep -vxE '\{\$(TAVERNUS_DOMAIN|WEB_PORT)' || true)
[ -z "$otras" ] || die "el Caddyfile solo puede usar {\$TAVERNUS_DOMAIN} y {\$WEB_PORT}"
! grep -qE '^[[:space:]]*import([[:space:]]|$)' "$NUEVO" || die "el Caddyfile no puede usar import"

# 2) Lo que Caddy entiende del fichero (JSON), contra la lista de lo permitido.
como_caddy caddy adapt --config "$NUEVO" --adapter caddyfile > "$TMP/adaptado.json" 2> "$TMP/adapt.log" || {
  grep -vE '^\{"level":"info"' "$TMP/adapt.log" | tail -n 8 >&2
  die "el Caddyfile nuevo no se puede leer; se deja el anterior"
}
cat > "$TMP/comprobar.js" <<'JS'
const fs = require('fs');
const [file, dominios] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
const hosts = new Set(dominios.split(/[\s,]+/).filter(d => d && !d.startsWith(':'))
  .map(d => d.replace(/^https?:\/\//, '').replace(/:\d+$/, '').toLowerCase()));
const HANDLERS = new Set(['subroute', 'headers', 'request_body', 'encode', 'reverse_proxy',
  'static_response', 'rewrite', 'error', 'vars']);
const fail = m => { console.error(m); process.exit(1); };
const keys = (o, ok, where) => { for (const k of Object.keys(o || {})) if (!ok.includes(k)) fail(`${where}: «${k}» no está permitido`); };
keys(cfg, ['apps'], 'configuración');
keys(cfg.apps, ['http'], 'apps');
for (const [name, srv] of Object.entries(cfg.apps?.http?.servers || {})) {
  keys(srv, ['listen', 'routes', 'errors'], `servidor ${name}`);
  for (const l of srv.listen || []) if (l !== ':443' && l !== ':80') fail(`servidor ${name}: escucha en ${l}`);
  for (const r of srv.routes || []) {
    const hs = (r.match || []).flatMap(m => m.host || []);
    if (hosts.size && (!r.match || r.match.some(m => !m.host) || !hs.length)) fail('hay rutas sin dominio');
    for (const h of hs) if (!hosts.has(h.toLowerCase())) fail(`dominio no permitido: ${h}`);
  }
}
(function walk(v, path) {
  if (typeof v === 'string') {
    if (/\{(file|env)\./.test(v)) fail(`${path}: no se permiten {file.*} ni {env.*}`);
    return;
  }
  if (!v || typeof v !== 'object') return;
  if (!Array.isArray(v)) {
    if ('handler' in v && !HANDLERS.has(v.handler)) fail(`manejador no permitido: ${v.handler}`);
    if ('dial' in v && !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(v.dial)) fail(`proxy a ${v.dial}: solo 127.0.0.1`);
    if ('transport' in v && (v.transport.protocol !== 'http' || 'tls' in v.transport)) fail('transporte del proxy no permitido');
    for (const k of ['file', 'dynamic_upstreams']) if (k in v) fail(`${path}: «${k}» no está permitido`);
  }
  for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
})(cfg, 'config');
JS
chmod 644 "$TMP"/*
como_caddy node "$TMP/comprobar.js" "$TMP/adaptado.json" "$DOMINIOS" \
  || die "el Caddyfile nuevo hace algo más que servir Tavernus; se deja el anterior"

# 3) La configuración completa con el nuevo en su sitio. Sus errores pueden ser de otros sitios:
#    no se enseñan aquí (van al journal, que solo lee root).
install -d -m 700 "$COPIAS"
stamp=$(date +%Y%m%d-%H%M%S)
habia=0
if [ -f "$DESTINO" ]; then cp -p "$DESTINO" "$COPIAS/Caddyfile-$stamp"; habia=1; fi
restaurar() {
  if [ "$habia" = 1 ]; then install -m 644 "$COPIAS/Caddyfile-$stamp" "$DESTINO"; else rm -f "$DESTINO"; fi
}
install -m 644 "$NUEVO" "$DESTINO"
if ! como_caddy caddy validate --config "$PRINCIPAL" --adapter caddyfile > "$TMP/validar.log" 2>&1; then
  logger -t tavernus-publicar-caddy < "$TMP/validar.log" || true
  restaurar
  die "con el Caddyfile nuevo, $PRINCIPAL no valida; se deja el anterior (detalle: journalctl -t tavernus-publicar-caddy)"
fi
if ! systemctl reload caddy; then
  restaurar
  systemctl reload caddy || true
  die "Caddy no se pudo recargar con el Caddyfile nuevo; se deja el anterior"
fi
find "$COPIAS" -maxdepth 1 -name 'Caddyfile-*' | sort | head -n -5 | xargs -r rm -f
log "publicado $DESTINO y recargado Caddy"
