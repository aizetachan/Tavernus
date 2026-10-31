# Despliegue de la web en un VPS

Cómo poner Tavernus en internet, en un VPS propio con Debian o Ubuntu, para jugar con amigos desde
`https://<tu-dominio>`. Todo está en `deploy/`. Desde tu ordenador se ejecutan dos órdenes: una
para preparar el servidor la primera vez y otra para subir cada versión.

```
Internet ──443──▶ Caddy (HTTPS automático) ──▶ 127.0.0.1:3000  tavernus-web (systemd, usuario tavernus)
                                                                      │
              tavernus-health.timer (cada minuto) ── reinicia y avisa  │
              tavernus-backup.timer (cada noche) ── copia comprimida   ▼
                                                           /var/lib/tavernus/data  (partidas)
```

## Lo que necesito de ti para hacerlo yo

Si quieres que lo haga yo desde aquí, me hace falta:

1. **IP o nombre del VPS**, y qué sistema tiene (Debian 12 o 13, Ubuntu 22.04 o 24.04), con su RAM y disco.
2. **Usuario SSH con `sudo`** (o `root`) y el **puerto SSH** si no es el 22.
3. **Acceso por clave desde este ordenador.** Que `ssh usuario@IP` entre sin pedir contraseña.
   Si aún no lo tienes: `ssh-keygen -t ed25519` y luego `ssh-copy-id usuario@IP`. En Windows,
   copia el contenido de `~/.ssh/id_ed25519.pub` al `~/.ssh/authorized_keys` del servidor. Para
   que lo haga yo, `sudo` no debe pedir contraseña (o el usuario es `root`), porque yo no tengo
   una terminal donde escribirla. Si lo ejecutas tú, da igual: los scripts abren una terminal con
   `ssh -t` y la pides allí.
4. **Dominio**, si lo tienes, y acceso a su DNS para crear un registro `A` que apunte a la IP.
   Si no tienes dominio, mira el camino B.
5. **Si el VPS ya tiene algo en los puertos 80 o 443** (otra web, nginx, Apache…). Caddy necesita
   esos puertos; si están ocupados, hay que decidir cómo convivir.
6. **Dónde quieres los avisos**: un bot de Telegram, un webhook de Discord o un tema de ntfy
   (ver «Salud y avisos»).
7. **El límite de gasto** que quieres (ver la sección siguiente).

La clave de la API de Anthropic no hace falta que me la pases. La pegas tú en el servidor con
`sudo nano /etc/tavernus/env`.

## Antes de abrir la URL a nadie: coste y límite de gasto (#17)

Cada acción de cada jugador con máster real es una llamada a la API de Claude, y la paga tu clave.

- **Pon un límite de gasto mensual en la consola de Anthropic** (console.anthropic.com → Settings →
  Limits) antes de compartir la URL. Es la única red que no depende de nuestro código.
- **Límite por personaje y día** (#17, ya en la web): `DAILY_MASTER_ACTIONS` (200 por defecto) y
  `DAILY_MASTER_TOKENS` en `/etc/tavernus/env`. Al pasarlo, ese jugador sigue con el máster offline
  (gratis) hasta medianoche. Falta un tope global por partida o por servidor (docs/MULTIJUGADOR.md).
- **Órdenes de magnitud** (docs/PLAN.md y docs/PLAYTEST-2026-10-31.md): con Haiku 5.5 en Brezal, 0,27
  céntimos por acción medidos, así que 200 acciones son unos 0,55 $ por jugador y día. Por precio, con los
  mismos tokens, Sonnet 5.5 serían unos 5,5 céntimos por acción y Opus 5.5 unos 11. Un «mundo nuevo» cuesta de
  0,07 a 0,15 $ (`WORLDGEN_MODEL`). La plantilla trae `MASTER_MODEL=claude-haiku-5-5`.
- **Gratis por defecto**: la voz del narrador (la del navegador) y el sonido (sintetizado). Las
  ilustraciones (`IMAGES=on` con Cloudflare) entran en el plan gratuito de 10 000 neuronas al día.
- **Nadie entra sin enlace.** En el servidor la web arranca en modo invitación: sin un enlace
  válido solo se ve «pide tu invitación». Aun así, no publiques el enlace de admin ni los de los
  asientos.

## 1. Preparar tu ordenador

En la raíz del repo, copia `deploy/local.env.example` como `deploy/local.env` (git lo ignora) y
pon tu servidor:

```
TAVERNUS_HOST=usuario@203.0.113.7
TAVERNUS_SSH_PORT=22
# TAVERNUS_SSH_KEY=~/.ssh/id_ed25519
```

Para preparar el servidor hace falta root o un usuario con sudo. Una vez preparado, lo normal es
desplegar con el usuario `tavernus`, sin root (`TAVERNUS_HOST=tavernus@…`), y dejar root en
`TAVERNUS_ADMIN_HOST` para `--setup`, `--ops`, `--usuario-deploy` y `data-sync.sh`. Cómo
prepararlo, rotar la clave y volver atrás está en el README, en «Desplegar sin root».

Los scripts funcionan en **Git Bash** (Windows), en el Terminal de macOS y en Linux. En
**PowerShell** sin Git Bash, `deploy\push.ps1` hace lo mismo que `deploy/push.sh`, con el ssh,
scp y tar que trae Windows 10 y 11: `-Setup -SetupArgs '--domain','tu.dominio'`, `-RemoteBuild`
y `-Test`. Si PowerShell no deja ejecutarlo, usa `powershell -ExecutionPolicy Bypass -File deploy\push.ps1`.
`deploy/data-sync.sh` (mover partidas) solo existe en bash; en Windows va con Git Bash.

Hace falta Node 20 o superior en tu ordenador, porque `push.sh` compila ahí (`npm run build`) y
sube `dist/` ya hecho. Así el servidor no necesita TypeScript ni las dependencias de desarrollo.
Con `--remote-build` se compila en el servidor.

## 2. Camino A: con dominio (Caddy y HTTPS automático)

1. **DNS.** En tu proveedor de dominio, crea un registro `A` (y `AAAA` si el VPS tiene IPv6),
   por ejemplo `tavernus.tudominio.com`, apuntando a la IP del VPS. Comprueba que ya resuelve:
   `nslookup tavernus.tudominio.com`.
2. **Cortafuegos del proveedor.** Si tu proveedor tiene un cortafuegos propio («security group»,
   «firewall» en el panel de Hetzner, OVH, AWS…), abre allí los puertos 22, 80 y 443. El de dentro
   del servidor (ufw) lo abre el script.
3. **Preparar el servidor**, una sola vez:
   ```bash
   deploy/push.sh --setup --domain tavernus.tudominio.com
   ```
   Sube `deploy/` y ejecuta `setup-vps.sh` con sudo, que hace esto:
   - Instala Node 22 LTS (NodeSource), Caddy (repositorio oficial), ufw y unattended-upgrades.
   - Crea el usuario de servicio `tavernus`, sin contraseña ni shell, y las carpetas `/opt/tavernus`
     (código) y `/var/lib/tavernus/data` (partidas), con sus permisos.
   - Crea 2 GB de swap si hay menos de 2 GB de RAM.
   - Crea `/etc/tavernus/env` (permisos 600, solo root) a partir de `deploy/env.example`, con
     `ADMIN_TOKEN` y `SESSION_SECRET` al azar y `PUBLIC_URL=https://<dominio>`.
   - Configura Caddy para el dominio, con el certificado de Let's Encrypt automático y renovado
     solo.
   - Instala la unidad `tavernus-web.service` y los temporizadores de salud y de copias.
   - Activa ufw con SSH, 80 y 443. Detecta tu puerto SSH para no dejarte fuera.

   Opciones: `--fail2ban`, `--no-ufw`, `--no-swap`, y `--proxy nginx --email tu@correo` (ver
   «Alternativa: nginx y certbot»). Se puede repetir sin miedo: no rehace lo hecho ni pisa
   `/etc/tavernus/env`.
4. **Claves.** En el servidor (`ssh usuario@IP`), ejecuta `sudo nano /etc/tavernus/env` y rellena
   al menos `ANTHROPIC_API_KEY`. Según lo que quieras, también `IMAGES=on` con
   `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, y `ALERT_WEBHOOK`. Cada variable está
   comentada en la plantilla.
5. **Subir la web:**
   ```bash
   deploy/push.sh
   ```
   El script compila en tu ordenador y sube el código con `dist/`, nunca `node_modules`, `data/` ni
   `.env`. En el servidor, cada versión va a `/opt/tavernus/releases/<fecha>`: instala las
   dependencias de producción (`npm ci --omit=dev`, o reutiliza las anteriores si
   `package-lock.json` no cambió), apunta `/opt/tavernus/current` a la versión nueva, reinicia el
   servicio y espera a que responda. **Si la versión nueva no responde en 45 s, vuelve sola a la
   anterior** y te enseña el error. Se guardan las 4 últimas versiones.
6. **Tus partidas** (opcional): `deploy/data-sync.sh up --replace` sube tu `data/` local tal cual
   (ver «Datos y copias»).
7. **Entrar como anfitrión.** El enlace de admin es `https://<dominio>/admin?token=<ADMIN_TOKEN>`.
   El token se ve con `sudo grep ^ADMIN_TOKEN /etc/tavernus/env`. Desde ahí creas la partida y
   repartes las invitaciones («⚙ → Invitaciones», docs/MULTIJUGADOR.md).

## 3. Camino B: sin dominio todavía

**B1. HTTPS con la IP, gratis, mediante sslip.io (recomendado).** `203.0.113.7.sslip.io` resuelve
a `203.0.113.7` sin registrar nada, y Caddy consigue el certificado igual que con un dominio:

```bash
deploy/push.sh --setup --domain 203.0.113.7.sslip.io
deploy/push.sh
```

La URL es `https://203.0.113.7.sslip.io`. Si algún día Let's Encrypt no lo emite (límites de
peticiones de ese dominio compartido), cambia a B3 o B4. Cuando tengas dominio, repite
`deploy/push.sh --setup --domain tu.dominio` y cambia `PUBLIC_URL` en `/etc/tavernus/env`.

**B2. Solo HTTP por la IP (solo para una prueba rápida).** Sin `--domain`, Caddy sirve
`http://<IP>` en el puerto 80. Los enlaces de invitación viajan sin cifrar, el navegador no da el
micrófono (el dictado necesita https) y las cookies van sin `Secure`. La web nunca se expone
directamente en su puerto 3000: escucha en 127.0.0.1 y el cortafuegos no abre ese puerto.

**B3. Cloudflare Tunnel** (sin abrir puertos ni tener dominio). Prepara el servidor con
`deploy/push.sh --setup --proxy none` y, en el VPS:

```bash
# Instalar cloudflared: https://pkg.cloudflare.com (paquete .deb para Debian/Ubuntu)
cloudflared tunnel --url http://127.0.0.1:3000
```

Imprime una URL temporal `https://<algo>.trycloudflare.com`, que dura lo que dure el proceso.
Ponla en `PUBLIC_URL`. Para una URL fija hace falta un dominio en Cloudflare y un túnel con nombre
(`cloudflared tunnel create`, instalado como servicio con `cloudflared service install`). El túnel
temporal también sirve desde tu propio PC, sin VPS, para una partida puntual:
`cloudflared tunnel --url http://localhost:3000`.

**B4. Tailscale Funnel.** Con `--proxy none` e instalando Tailscale en el VPS (`curl -fsSL
https://tailscale.com/install.sh | sh`, luego `tailscale up`):

```bash
sudo tailscale funnel --bg 3000
```

Publica `https://<máquina>.<tu-tailnet>.ts.net` con certificado. Tu amigo no necesita Tailscale.
Pon esa URL en `PUBLIC_URL`.

Con B3 y B4, ufw solo necesita SSH abierto. Puedes cerrar 80 y 443 con `sudo ufw delete allow 80/tcp`
(y lo mismo para `443/tcp` y `443/udp`).

## 4. El día a día

| Qué | Cómo |
|---|---|
| Subir una versión nueva | `deploy/push.sh` (con `--test` pasa antes los tests) |
| Ver qué hace la web | `sudo journalctl -u tavernus-web -f` (qué sale, en «Qué apunta el registro») |
| Ver cómo va y qué han reportado | `https://<tu-dominio>/admin/estado` (ver «Reportes y página de estado») |
| Estado del servicio y los temporizadores | `systemctl status tavernus-web` · `systemctl list-timers 'tavernus*'` |
| Cambiar una variable | `sudo nano /etc/tavernus/env` y `sudo systemctl restart tavernus-web` |
| ¿Responde? | `sudo tavernus-health --probe` |
| Volver a una versión anterior a mano | `ls /opt/tavernus/releases`, luego `sudo ln -sfn /opt/tavernus/releases/<fecha> /opt/tavernus/current && sudo systemctl restart tavernus-web` |
| Caddy | `sudo journalctl -u caddy -f` · `/etc/caddy/Caddyfile` (lo actualiza `push.sh` desde `deploy/Caddyfile`, con `tavernus-publicar-caddy` si está instalado) |
| Cambian los scripts de operación o las unidades | `deploy/push.sh --ops` (como administrador; el usuario `tavernus` no puede instalarlos) |

### Qué apunta el registro

La web escribe en journald una línea por cosa, en `clave=valor`, para poder filtrar con `grep`.
Nunca apunta lo que escribe el jugador, la narración ni tokens de acceso.

- **`[acción]`**: cada acción de un jugador (`tipo=act`, `say`, `roll`, `reaction`, `offer`,
  `command`, `quest_drop`). Lleva la partida, el PJ (`pj` y `nombre`), lo que tardó (`ms`), el
  `modelo` del máster y lo que tardó él (`máster_ms`), las vueltas (`iter`), los tokens
  (`tokens_in`, `tokens_out`, `caché_lee`, `caché_escribe`) y `resultado=ok`, `rechazada` (el
  motor dijo que no) o `error`, con el `error` al lado.
- **`[máster]`**: una llamada al máster que no viene de una acción (presentación de un PJ,
  llegada, escena decisiva que vence). Los mismos campos.
- **`[reporte]`**: un jugador ha reportado algo. Lleva la partida, el PJ, el `seq` y el tipo del
  evento (`evento`), `tipo=mensaje` o `general`, cuántos `caracteres` escribió y el `fichero` donde
  está el reporte. Lo que escribió no sale aquí: está en el fichero.
- **`[presencia]`**: `conecta` y `desconecta` (el stream de una pestaña, con `pestaña` y cuántos
  `streams` quedan), `cierra_pestaña` (la página avisó al cerrarse), y `en_línea` y
  `fuera_de_línea` (cuando la web da al jugador por llegado o por ido, pasada la gracia).
- **`[imágenes]`**: cada imagen y los fallos. Si Cloudflare responde 429 o agota la cuota
  diaria, lo dice **una sola vez** («No se le pide nada hasta …») y deja de llamarle en todas las
  partidas hasta el reinicio de la cuota (medianoche UTC, o lo que diga `Retry-After` si el 429
  es de ritmo). Mientras, las imágenes salen de Pollinations.

Ejemplos:

```bash
sudo journalctl -u tavernus-web --since today | grep 'resultado=error'
sudo journalctl -u tavernus-web --since '1 hour ago' | grep '\[presencia\] partida=brezal'
sudo journalctl -u tavernus-web --since today | grep -o 'máster_ms=[0-9]*' | sort -t= -k2 -n | tail
sudo journalctl -u tavernus-web --since today | grep '\[reporte\]'
```

### Reportes y página de estado

Un jugador reporta desde la flechita (⌄) de cualquier burbuja del máster, «Reportar», o sin burbuja
desde los ajustes, «Algo va mal» (el engranaje del panel en escritorio, el del cuadro en el móvil).
Escribe qué ha pasado y ya está: el resto lo adjunta el servidor.

Cada reporte es un fichero en `<partida>/reports/<fecha>-<seq>.json`
(`/var/lib/tavernus/data/games/<partida>/reports/` en el VPS). Lleva lo que escribió, la hora del
servidor y la de su navegador, el navegador, la versión en marcha, lo que leyó ese PJ, los últimos
eventos que vivió y el evento entero: narración, tools llamados con su resultado, modelo, tokens y el
contexto que recibió el máster. Un «Algo va mal» adjunta el último evento que vivió el PJ. Entran en la
copia de cada noche con el resto de la partida y se borran con ella. Cada PJ puede mandar 20 por hora.

**`/admin/estado`** es para quien administra: entra una vez con el enlace `/admin?token=…` y luego
abre la página, o «Estado del servidor» en los ajustes del menú de partidas. Cualquier otro recibe un
403, también en modo público quien creó su propia partida. Enseña:

- Desde cuándo está en marcha y la versión: la carpeta de `releases` que está corriendo, o el commit
  fuera del servidor.
- Quién está conectado en cada partida.
- Acciones de los jugadores, llamadas al máster, errores del máster, acciones con error del servidor,
  tokens y coste, en la última hora y en el día. El día cambia a medianoche en `BUDGET_TZ`.
- Los 50 reportes más recientes, con el contexto plegado. Lo muy largo se recorta y remite al fichero.

El coste es una estimación con la tarifa de la API escrita en `src/adapters/web/status.ts`, que hay que
tocar si cambian los precios o el modelo. Cuenta el máster y el actor de los NPC (y el prólogo y la
recapitulación), no las imágenes ni generar un mundo, y no sustituye a la consola de Anthropic. Si llega un
modelo sin precio, la página avisa de cuántas llamadas se quedan fuera. Los contadores se guardan en
`<carpeta de partidas>/.estado.json`, así que un despliegue no los pone a cero; una caída brusca pierde
como mucho los últimos 30 segundos.

## 5. Datos y copias (#21)

- **Las partidas viven fuera del código**, en `/var/lib/tavernus/data`, con la misma forma que el
  `data/` del repo: `games/` (una carpeta por partida) y `local/` (la partida «principal», el
  índice de reglas `local/rules` y la caché). Subir una versión nunca las toca. El `data/` de cada
  versión es un enlace a esa carpeta.
- **Copia diaria** a las 04:30 (hora del servidor): `tavernus-backup.timer` deja
  `/var/lib/tavernus/backups/tavernus-data-<fecha>.tar.gz` (permisos 600) y borra las de más de
  `BACKUP_KEEP_DAYS` días (14). Si el servidor estaba apagado a esa hora, la hace al arrancar. No
  copia los PDF de `local/manuals`. Como la web escribe los JSON sin renombrado atómico, la copia
  se hace de una foto aparte y se comprueba que todos los `.json` se leen; si alguno está a medio
  escribir, lo reintenta.
- **A mano:** `sudo tavernus-backup` hace una copia ahora.
- **Restaurar:** `sudo tavernus-restore --list`, luego `sudo tavernus-restore --latest` o
  `sudo tavernus-restore <fichero>`. Antes de tocar nada, hace una copia del estado actual y deja
  la carpeta anterior en `/var/lib/tavernus/data.antes-<fecha>` (se borra a los 14 días). Con
  `--merge` solo añade las partidas que falten.
- **Copia fuera del servidor:** las copias diarias están en el mismo disco. De vez en cuando, baja
  la última a tu ordenador con `deploy/data-sync.sh backup` (queda en `data/local/servidor/`), o
  activa las instantáneas del proveedor del VPS.

**Llevar tus partidas locales al servidor:**

```bash
deploy/data-sync.sh up --replace   # la primera vez: el data/ del servidor pasa a ser el tuyo
deploy/data-sync.sh up             # después: solo añade las partidas que el servidor no tenga
```

Se sube `data/games` y `data/local`, sin los PDF de `data/local/manuals`. La partida «principal»
apunta a `data/local/<carpeta>` con una ruta relativa, y se conserva porque el servidor usa la
misma forma de carpetas. `--yes` evita la pregunta de confirmación en el servidor.

**Traer las del servidor a tu ordenador:**

```bash
deploy/data-sync.sh down           # copia nueva -> data/local/servidor/<fecha>/data (no toca las tuyas)
deploy/data-sync.sh down --merge   # además añade a tu data/ las partidas que no tengas
```

Para abrir la copia bajada sin mezclarla con las tuyas, usa las variables que imprime el script:
`GAMES_DIR=data/local/servidor/<fecha>/data/games DATA_DIR=data/local/servidor/<fecha>/data/local npm run web`.

Ten en cuenta que en `games/` también van los asientos de cada partida (`seats.json`) y, si no hay
`SESSION_SECRET` en el entorno, la clave de las cookies (`.session-secret`). setup-vps.sh pone un
`SESSION_SECRET` precisamente para que un `up --replace` no obligue a todos a volver a entrar con
su enlace. Los enlaces de invitación de las partidas que subas son los de tu copia local.

## 6. Salud y avisos (#22)

`tavernus-health.timer` ejecuta `/usr/local/lib/tavernus/healthcheck.sh` cada minuto:

- Pide `http://127.0.0.1:3000/api/health`. **Esa ruta aún no existe en la web**: hoy responde 400
  (falta `?game`) o 403 (en modo invitación). En ese caso el script se conforma con que la
  portada dé 200. Cuando la web tenga `/api/health`, se usará sola, sin tocar nada aquí
  (`HEALTH_PATH` la cambia).
- Si falla **dos veces seguidas**, reinicia `tavernus-web` y avisa. Si sigue mal, reintenta el
  reinicio cada 10 minutos y repite el aviso cada hora. Cuando vuelve a responder, avisa de que ha
  vuelto. El aviso lleva las últimas líneas del registro, con los tokens tapados.
- Aparte, systemd relanza la web a los 5 s si el proceso muere (`Restart=always`). La comprobación
  de salud cubre lo que eso no ve: un proceso colgado que no responde.
- Mientras se restaura una copia o se sube una versión, la comprobación se pausa sola.

**Configurar el aviso** con `ALERT_WEBHOOK` en `/etc/tavernus/env` (no hace falta reiniciar):

- **Telegram:** crea un bot con @BotFather y copia el token. Escríbele algo y abre
  `https://api.telegram.org/bot<TOKEN>/getUpdates` para ver tu `chat.id`. Luego
  `ALERT_WEBHOOK=https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<CHAT_ID>`.
- **Discord:** en el canal, «Editar canal → Integraciones → Webhooks → Nuevo webhook» y copia la URL (va por el POST JSON genérico, con su campo `content`).
- **ntfy:** `ALERT_WEBHOOK=https://ntfy.sh/<un-tema-largo-y-secreto>` y suscríbete al tema en la app.
- **Otro (Slack…):** recibe un POST JSON con `{"text": …, "content": …}`.

Pruébalo con `sudo tavernus-health --test`.

**Correo** (`ALERT_EMAIL`): solo funciona si el servidor sabe mandar correo, y casi ningún VPS
sabe de serie (muchos proveedores bloquean el puerto 25). La forma sencilla es instalar `msmtp-mta`
y `bsd-mailx` con una cuenta SMTP (por ejemplo, una contraseña de aplicación de Gmail) en
`/etc/msmtprc`. Si no, usa el webhook.

**Si cae el VPS entero**, nadie dentro puede avisar. Para eso:

- `HEALTHCHECK_PING_URL`: un «interruptor de hombre muerto» como healthchecks.io (gratis). El
  script le hace un GET en cada comprobación buena, y si deja de llegar, healthchecks.io te avisa.
- O un monitor externo (UptimeRobot, Better Stack) que pida `https://<dominio>/` cada pocos
  minutos.

## 7. Seguridad mínima

- **Secretos:** `/etc/tavernus/env` es de root con permisos 600, y systemd se lo pasa al
  servicio. No está ni estará en el repo: `.env` está en `.gitignore`, `push.sh` no lo sube
  (empaqueta una lista explícita de carpetas) y `deploy/local.env` también se ignora. No copies tu
  `.env` local al servidor: pasa a mano solo las claves que hagan falta.
- **ADMIN_TOKEN:** quien lo tenga es anfitrión. Al arrancar, la web dice que hay enlace de
  administración y dónde está el token, pero no lo escribe. Se ve con
  `sudo grep ^ADMIN_TOKEN /etc/tavernus/env`. Las versiones anteriores al 2026-10-27 sí lo
  escribían, así que si el servidor corrió alguna, el token está en journald: rótalo (abajo).
  `IMAGES`, `MASTER_MODEL` y el resto también van por entorno.
- **Rotar el ADMIN_TOKEN** (si se filtró o estuvo en el registro):
  1. Genera uno nuevo y ponlo en el fichero de entorno:
     ```bash
     NEW=$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')
     sudo sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=$NEW/" /etc/tavernus/env
     unset NEW
     ```
  2. Reinicia: `sudo systemctl restart tavernus-web`.
  3. Comprueba que el registro ya no lo escribe:
     `sudo journalctl -u tavernus-web -n 20 -o cat | grep admin`. Debe salir
     `admin?token=<token>`, sin el valor.
  4. Entra con el enlace nuevo, `https://<dominio>/admin?token=<nuevo>`. El viejo da 403, y la
     cookie de anfitrión de cada navegador deja de valer (sale del token), así que hay que
     volver a entrar con el enlace. A los jugadores no les afecta: sus enlaces de invitación y
     sus cookies no dependen de este token.
  5. Opcional: el token viejo sigue en el journal hasta que se rote, pero ya no sirve. Si quieres
     quitarlo, `sudo journalctl --rotate && sudo journalctl --vacuum-time=1s` borra **todo** el
     registro del sistema, no solo el de Tavernus. Si guardaste copias locales del registro
     (como la de la revisión de partidas), bórralas o tapa el token.
- **Red:** la web escucha solo en 127.0.0.1:3000. Desde fuera solo se llega por Caddy (80/443),
  y ufw solo abre SSH, 80 y 443. Caddy añade cabeceras básicas: HSTS, `nosniff`, `X-Frame-Options:
  DENY`, `Referrer-Policy` y `Permissions-Policy` con el micrófono solo para la propia página.
  Caddy no guarda registro de accesos, porque las URLs llevan tokens.
- **El servicio:** corre como `tavernus`, sin privilegios, con el código de solo lectura
  (`ProtectSystem=strict`). Solo puede escribir en `/var/lib/tavernus`, y tiene `MemoryMax=1G`
  para que una fuga no tumbe la máquina.
- **Quién despliega:** el usuario `tavernus` con su propia clave (`restrict` en
  `authorized_keys`) y un sudo de cinco órdenes exactas, sin root. La clave de root queda para
  administrar. Detalle en el README, en «Desplegar sin root».
- **SSH:** entra con clave y, cuando funcione, desactiva las contraseñas. En
  `/etc/ssh/sshd_config`, pon `PasswordAuthentication no` y ejecuta `sudo systemctl reload ssh`.
  Hazlo con otra sesión abierta, por si acaso.
- **fail2ban (opcional):** `deploy/push.sh --setup --fail2ban` lo instala para SSH (5 intentos y
  1 hora de bloqueo). `sudo fail2ban-client status sshd` muestra los bloqueados.
- **Actualizaciones de seguridad:** queda instalado `unattended-upgrades`. En Debian, actívalo
  con `sudo dpkg-reconfigure -plow unattended-upgrades`.

## 8. Alternativa: nginx y certbot

Si prefieres nginx (o ya lo usas en el VPS):

```bash
deploy/push.sh --setup --proxy nginx --domain tavernus.tudominio.com --email tu@correo.com
```

Instala nginx, certbot y `deploy/nginx-tavernus.conf` en `/etc/nginx/sites-available/tavernus`.
El stream SSE va sin búfer, sin compresión y sin corte a los 60 s, y se admiten subidas de 10 MB.
Después, `certbot --nginx` pide el certificado, añade el bloque 443 y la redirección desde 80, y lo
renueva solo. Si ya tienes otras webs en ese nginx, copia solo el `server { … }` a tu
configuración. A diferencia del Caddyfile, `push.sh` no actualiza la configuración de nginx (certbot
la edita): los cambios se hacen a mano y se aplican con `sudo nginx -t && sudo systemctl reload nginx`.

## 9. Qué hay en el servidor

| Ruta | Qué es |
|---|---|
| `/opt/tavernus/releases/<fecha>/` | cada versión subida, con su `node_modules` (se guardan 4) |
| `/opt/tavernus/current` | enlace a la versión en marcha (`WorkingDirectory` del servicio) |
| `/var/lib/tavernus/data/` | partidas (`games/`) y datos sueltos (`local/`) |
| `/var/lib/tavernus/backups/` | copias diarias (root, 600) |
| `/etc/tavernus/env` | entorno de la web y de los avisos (root, 600) |
| `/etc/tavernus/caddy.env` | `TAVERNUS_DOMAIN` y `WEB_PORT` para el Caddyfile |
| `/etc/systemd/system/tavernus-*` | servicio web y temporizadores de salud y copias |
| `/usr/local/lib/tavernus/` | `healthcheck.sh`, `backup-now.sh`, `restore.sh` (con enlaces `tavernus-health`, `tavernus-backup` y `tavernus-restore` en `/usr/local/bin`) |
| `/var/lib/tavernus/deploy/` | del usuario `tavernus`: la bandera `en-curso` mientras `release.sh` despliega |
| `/home/tavernus/.ssh/authorized_keys` | claves de despliegue, una línea por clave (`pc`, `actions`), de root y con `restrict` |
| `/etc/sudoers.d/tavernus` · `/usr/local/sbin/tavernus-publicar-caddy` | el sudo mínimo de `tavernus` y el envoltorio que publica el Caddyfile |
| `/var/backups/tavernus-caddy/` | los 5 últimos Caddyfile, antes de cada publicación |
| `/root/tavernus-deploy-<fecha>/` | copia de lo que tocó `preparar-usuario-deploy.sh` en cada pasada |

En el repo, `deploy/`:

| Fichero | Para qué |
|---|---|
| `push.sh` · `push.ps1` | subir una versión, o `--setup` / `-Setup` para preparar el servidor y `--ops` / `-Ops` para los scripts de operación |
| `preparar-usuario-deploy.sh` · `tavernus-publicar-caddy.sh` | el usuario `tavernus` para desplegar sin root (lo ejecuta `push.sh --usuario-deploy`) |
| `data-sync.sh` | llevar partidas entre tu ordenador y el servidor |
| `setup-vps.sh` | preparación del servidor (lo ejecuta `push.sh --setup`) |
| `release.sh` · `install-ops.sh` | activación de una versión en el servidor (los llama `push.sh`) |
| `healthcheck.sh` · `backup-now.sh` · `restore.sh` · `lib.sh` | operación en el servidor |
| `tavernus-web.service`, `tavernus-{health,backup}.{service,timer}` | unidades de systemd |
| `Caddyfile` · `nginx-tavernus.conf` | proxy inverso |
| `env.example` · `local.env.example` | plantillas del entorno del servidor y de tu `local.env` |

## 10. Problemas frecuentes

- **`502` o «no responde»:** la web está caída o arrancando. Mira `sudo journalctl -u tavernus-web -n 50`.
- **No sale el certificado:** comprueba que el DNS apunta ya a la IP, que los puertos 80 y 443
  están abiertos también en el cortafuegos del proveedor y que nada más los ocupa
  (`sudo ss -tlnp | grep -E ':80|:443'`). Para ver el error: `sudo journalctl -u caddy -n 50`.
- **`Permission denied (publickey)`:** el servidor no tiene tu clave pública en
  `~/.ssh/authorized_keys`, o `TAVERNUS_SSH_KEY` apunta a otra.
- **Se queda sin memoria al instalar:** con 1 GB de RAM, la swap que crea setup-vps.sh es
  necesaria. En VPS de tipo contenedor (OpenVZ, LXC) no se puede crear swap: usa uno KVM o con
  2 GB.
- **`$'\r': command not found`:** un script con finales de línea de Windows. `deploy/.gitattributes`
  los fuerza a LF y `push.sh` los limpia en el servidor; si clonaste antes de ese fichero, ejecuta
  `git add --renormalize deploy` (o vuelve a clonar).

## 11. Qué se ha probado (25 de octubre de 2026)

Sin VPS todavía, se probó en un contenedor Docker de Debian 12 con systemd y SSH, que hacía de
servidor. Desde Git Bash y desde PowerShell en Windows:

- `push.sh --setup --fail2ban`: Node 22.23 de NodeSource, Caddy 2.11, ufw y fail2ban activos,
  temporizadores en marcha. Repetir el setup no cambia nada.
- `push.sh` y `push.ps1`: compilación local, subida, `npm ci --omit=dev`, reutilización de
  `node_modules` cuando `package-lock.json` no cambia y comprobación de salud. Una versión rota
  (`dist/index.js` que sale con error) vuelve sola a la anterior.
- Detrás de Caddy (`TAVERNUS_DOMAIN=:80`), la portada, el admin con cookie, `/api/games` y el
  stream SSE, que llega al instante tras un `POST /api/act`. Las cabeceras de seguridad están
  presentes.
- Health check: con el proceso congelado (`kill -STOP`), al segundo fallo reinicia y manda el
  aviso al webhook; al volver, manda «vuelve a responder».
- `tavernus-backup` (también por su temporizador), `tavernus-restore --latest`, y
  `data-sync.sh up --replace` con las 23 partidas locales, `up` en modo añadir y `down`.
- `shellcheck` sin avisos, `systemd-analyze verify` de las cinco unidades, `caddy validate` (con
  dominio y con `:80`) y `nginx -t`.
- `npm run build` produce un `dist/` que arranca con `node dist/index.js --web`.

No se ha probado con un dominio real (el certificado de Let's Encrypt), en Ubuntu, en macOS ni con
nginx más certbot de verdad.
