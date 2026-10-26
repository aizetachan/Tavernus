#!/usr/bin/env bash
# Comprobación de salud de la web (issue #22). La lanza tavernus-health.timer cada minuto, como root.
#
#   - Bien: pone a cero el contador, avisa «ha vuelto» si antes avisó de una caída y, si hay
#     HEALTHCHECK_PING_URL, le hace un GET (vigilancia externa por si cae el VPS entero).
#   - Mal dos veces seguidas: reinicia tavernus-web y avisa por ALERT_WEBHOOK y/o ALERT_EMAIL.
#     Si sigue mal, reintenta el reinicio cada 10 minutos y repite el aviso cada hora.
#   - Con /var/lib/tavernus/health/maintenance (restore.sh, data-sync.sh) no hace nada.
#
#   tavernus-health            una comprobación, como la del temporizador
#   tavernus-health --probe    solo dice si responde (código 0 = sí); no reinicia ni avisa
#   tavernus-health --test     manda un aviso de prueba
set -uo pipefail
# shellcheck source=lib.sh
. "$(dirname "$(readlink -f "$0")")/lib.sh"

# Prioridades de journald (<4> = aviso): con LogLevelMax=notice en la unidad,
# solo queda en el registro lo que importa.
jwarn() { echo "<4>$*"; }

# alert "texto": al webhook (Telegram, Discord, ntfy o JSON genérico) y al correo.
alert() {
  local text hook mail_to json
  text="[Tavernus $(hostname)] $1"
  hook=$(envget ALERT_WEBHOOK)
  mail_to=$(envget ALERT_EMAIL)
  if [ -n "$hook" ]; then
    json=$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$text" 2>/dev/null) || json="\"$1\""
    case $hook in
      *api.telegram.org/*)
        curl -fsS -m 15 -o /dev/null --data-urlencode "text=$text" "$hook" ;;
      *discord.com/api/webhooks/*|*discordapp.com/api/webhooks/*)
        curl -fsS -m 15 -o /dev/null -H 'content-type: application/json' -d "{\"content\":$json}" "$hook" ;;
      *ntfy.sh/*|*/ntfy/*)
        curl -fsS -m 15 -o /dev/null -H 'Title: Tavernus' -d "$text" "$hook" ;;
      *)
        curl -fsS -m 15 -o /dev/null -H 'content-type: application/json' -d "{\"text\":$json,\"content\":$json}" "$hook" ;;
    esac || jwarn "no se pudo mandar el aviso al webhook"
  fi
  if [ -n "$mail_to" ]; then
    if command -v mail >/dev/null; then
      printf '%s\n' "$text" | mail -s "Tavernus: $(printf '%s' "$1" | head -c 60)" "$mail_to" || jwarn "mail falló"
    elif command -v sendmail >/dev/null; then
      printf 'To: %s\nSubject: Tavernus: %s\n\n%s\n' "$mail_to" "$(printf '%s' "$1" | head -c 60)" "$text" | sendmail -t || jwarn "sendmail falló"
    else
      jwarn "ALERT_EMAIL puesto pero no hay mail ni sendmail (mira docs/DESPLIEGUE.md)"
    fi
  fi
  [ -z "$hook$mail_to" ] && jwarn "sin ALERT_WEBHOOK ni ALERT_EMAIL: el aviso solo queda en el journal"
  jwarn "AVISO: $1"
}

case ${1:-} in
  --probe) if probe; then echo "ok ($PROBE_DETAIL)"; exit 0; else echo "mal ($PROBE_DETAIL)"; exit 1; fi ;;
  --test) alert "aviso de prueba: si lees esto, los avisos funcionan."; exit 0 ;;
esac

[ "$(id -u)" = 0 ] || die "como root: sudo tavernus-health"
install -d -m 700 "$HEALTH_DIR"
# Una comprobación a la vez (el temporizador y una a mano no se pisan el contador).
exec 9> "$HEALTH_DIR/lock"
flock -n 9 || exit 0
STATE=$HEALTH_DIR/state
fails=0; alerted=0
# shellcheck disable=SC1090
[ -f "$STATE" ] && . "$STATE"
save() { printf 'fails=%s\nalerted=%s\n' "$fails" "$alerted" > "$STATE"; }

if [ -e "$MAINT_FLAG" ]; then
  # Mantenimiento de más de 2 horas: probablemente alguien olvidó quitarlo.
  if [ -n "$(find "$MAINT_FLAG" -mmin +120 2>/dev/null)" ]; then rm -f "$MAINT_FLAG"; else exit 0; fi
fi
# Sin ninguna versión desplegada aún no hay nada que vigilar.
[ -e "$APP_DIR/current/dist/index.js" ] || exit 0

if probe; then
  if [ "$alerted" = 1 ]; then alert "la web vuelve a responder ($PROBE_DETAIL) tras $fails comprobaciones fallidas."; fi
  fails=0; alerted=0; save
  ping_url=$(envget HEALTHCHECK_PING_URL)
  [ -n "$ping_url" ] && curl -fsS -m 10 -o /dev/null "$ping_url" 2>/dev/null
  exit 0
fi

fails=$((fails + 1))
jwarn "la web no responde ($PROBE_DETAIL), fallo $fails seguido"
if [ "$fails" -ge 2 ] && [ $(((fails - 2) % 10)) = 0 ]; then
  state=$(systemctl is-active "$SERVICE" 2>/dev/null)
  systemctl reset-failed "$SERVICE" 2>/dev/null
  systemctl restart "$SERVICE"
  # Sin tokens: el journal de versiones antiguas llevaba el enlace de admin y el aviso sale a Telegram/Discord.
  last=$(journalctl -u "$SERVICE" -n 8 --no-pager -o cat 2>/dev/null | tail -n 8 | cut -c1-200     | sed -E 's/(token=)[A-Za-z0-9_-]+/…/g; s#(/i/[a-z0-9-]+/)[A-Za-z0-9_-]+#…#g')
  if [ "$fails" = 2 ] || [ $(((fails - 2) % 60)) = 0 ]; then
    alert "la web no responde desde hace $fails min ($PROBE_DETAIL; servicio: $state). Reiniciada. Últimas líneas:
$last"
    alerted=1
  fi
fi
save
exit 0
