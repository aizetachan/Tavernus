# Tavernus

D&D multijugador por chat con Master IA. La spec completa está en [`docs/SPEC.md`](docs/SPEC.md); la dirección y las fases hacia mundos generados y vivos, en [`docs/PLAN.md`](docs/PLAN.md).

Principio rector: **la base de datos es la verdad; el master IA solo puede cambiarla a través de tools.**

## Estado: fase 1 (mundo sin IA)

Lo que hay funcionando, con tests:

| Pieza | Módulo | Spec |
|---|---|---|
| Modelo de datos con árbol de contención único (`location` polimórfico) | `src/engine/model.ts` | §14.2 |
| Mundo en RAM con índices, validación de integridad y aviso de cambios | `src/engine/world.ts` | §14.2.5 |
| Reloj global con ratio 3× y tickers persistentes que no saltan ni duplican | `src/clock/clock.ts` | §1.3 |
| Movimiento con coste real: Dijkstra sobre puntos y salidas, tránsito por tramos, posición interpolada, cambio de destino a medio camino, monturas, capacidad de punto, puntos ocultos | `src/engine/movement.ts` | §3.2.3, §3.2.4 |
| Inventario y capacidad: manos, bolsillos, equipado, contenedores anidados, carga por Fuerza, transferencia atómica con `no_space` | `src/engine/inventory.ts` | §5.2–§5.4 |
| Nodos de recurso que se agotan y regeneran con el reloj | `src/engine/resources.ts` | §3.2.5 |
| Percepción por radios y bandas (`full / vague / hint / none`), luz, ruido, antorchas, sueño, puntos ocultos, enlaces que bloquean | `src/engine/perception.ts` | §9.2 |
| Log de eventos inmutable con entrega por punto de vista y texto por banda; `/recap` desde la desconexión | `src/engine/events.ts` | §6, §11.2 |
| Resolución de alias del jugador a punto / ítem / recurso; ambigüedad → pregunta | `src/engine/aliases.ts` | §3.2 regla 1 |
| Motor: cola FIFO por localización, tick, persistencia, velo al desconectar, parser de verbos y narración plana desde los datos | `src/engine/engine.ts`, `src/engine/narrate.ts` | §9, §9.1, §12.1 |
| Persistencia: contrato + memoria (tests) + ficheros JSON (local) + Firestore | `src/persistence/` | §14.1 |
| Campaña semilla: taberna, plaza, claro del bosque, 2 PJs, 2 NPCs, recursos | `src/data/seed/demo.ts` | — |
| Alta mínima de personaje (solo nombre; el flujo SRD llega en fase 2) y presencia: conectado = online o acción en 30 min, si no velo | `src/engine/engine.ts` | §4.6, §9.1 |
| Bot de Discord: `#pov-<nombre>` privado, `#hoja-<nombre>` con hoja viva fijada, `#tablon`, `#ooc`, `#crear-personaje`, comandos slash efímeros, reportes con ⚠️ + reply en `#reportes` | `src/adapters/discord/` | §11.2 |
| REPL de terminal, mismo motor | `src/adapters/repl.ts` | §11 |
| Web local (chat, botones, hoja), mismo motor | `src/adapters/web/` | §11 |

El repositorio Firestore está escrito pero **no probado contra un proyecto real** todavía.

## Estado: fase 2 (master con Claude), primer tramo

| Pieza | Módulo | Spec |
|---|---|---|
| Dados del servidor: expresiones, ventaja, 20/1 naturales; reglas 5e de skills y salvaciones | `src/engine/dice.ts`, `src/engine/rules.ts` | §7, §4.2 |
| Tools del master con esquema (solo `log_event` estricto), ejecutados contra el motor | `src/ai/tools.ts` | §7 |
| Prompt: sistema estable y cacheado 1 h, contexto por acción con percepción por bandas | `src/ai/prompt.ts` | §8 |
| Bucle del master: una llamada por acción, tope de tools, cierre con `log_event`, uso y llamadas guardados en el evento | `src/ai/master.ts` | §2.3 |
| Intención antes de efecto y `requires_roll`: botón 🎲, tirada del servidor, segunda llamada con el resultado | `src/engine/engine.ts` | §4.10 |
| Acciones sugeridas como botones; verbos mecánicos sin LLM; parser plano como red si la API falla | `src/adapters/discord/bot.ts` | §4.10, §10 |

| NPCs con descripción, motivación y secreto; memoria escrita por el master al hablar (olvido por importancia), cola de conversación | `src/ai/tools.ts`, `src/engine/engine.ts` | §3.3, §9.6 |
| Demo jugable: reputación, pistas, encargos rotatorios en `#tablon`, práctica por uso, venta/compra, logro con recompensa | `src/engine/progress.ts`, `src/data/seed/demo.ts` | §3.4, §3.5, §4.11, §5.6 |

| Creación de personaje con SRD: 9 razas, 12 clases, 6 trasfondos, array estándar, habilidades por botones, modo de muerte; PG, CA y salvaciones calculados; equipo inicial | `src/data/srd/`, `src/adapters/discord/creation.ts` | §4.6, §4.8 |

| Combate conversacional: bloques SRD de NPC, ataque del jugador con 🎲 y objetivo (tirada, daño y aplicación en el servidor), ataques de NPC, ventanas decisivas con contador y umbrales | `src/engine/combat.ts` | §9.3 |
| Nombres: solo se conocen al presentarse o ser nombrados; testigos ven descripciones | `src/engine/narrate.ts` | §9.2 |

Pendiente de la fase 2: descanso y muerte con reaparición, hechizos y barra rápida. Después: sociedad (fase 3), Director (fase 4), panel (fase 5).

## Ejecutar

```
npm install
npm test          # 178 tests
npm run dev       # sin .env: REPL local con dos personajes y persistencia en ./data/local
```

### Web local

```
npm run web       # http://localhost:3000 (puerto en WEB_PORT)
```

Una página con el `#pov` del personaje elegido, botones de acciones sugeridas y 🎲, comandos `/look /where /who…` y la hoja al lado. Sin autenticación: escucha solo en `127.0.0.1`.

**Menú y partidas.** Al entrar aparece un menú con cuatro bloques: *Nueva partida* (nombre, máster real / offline / grabar demo y, si quieres, un personaje propio con raza y clase), *Continuar* (abrir o borrar las guardadas), *Demos* (abrir o empezar de nuevo) y *Grabaciones* (abrir o «convertir en demo»). No hace falta tocar variables de entorno ni reiniciar. Cada partida es una carpeta `data/games/<slug>/` (`GAMES_DIR` la cambia) con un `game.json` (nombre, fechas, campaña, modo del máster, carpeta de datos, carpeta de caché y semilla de dados opcional) y dentro sus datos JSON (`data/`) y su caché de respuestas (`master-cache/`); el servidor arranca un motor por partida al abrirla y la partida viaja en la URL (`/?game=<slug>`; todas las rutas `/api/*` piden `?game=`). Una grabación es una partida real en modo `record` con semilla de dados fija y una foto del estado recién creado (`initial/`); al convertirla en demo pasa a `replay` con su caché, lo jugado se guarda en `recorded/` y la demo vuelve a empezar desde esa foto, así que se repite sin gastar tokens (lo que no esté en la caché lo narra el cliente offline, con aviso en consola). La primera vez, la partida de `DATA_DIR` pasa a ser la «principal» sin mover sus ficheros (con el modo de `MASTER_MODE`) y, si hay caché en `data/local/master-cache`, se empaqueta como «Demo inicial». La web siempre guarda en JSON; Discord y el REPL siguen con un motor único sobre `DATA_DIR`/Firestore. Con `npm run web` y la configuración `tavernus-web-offline` de `.claude/launch.json` se prueba todo sin API (sus partidas van a `data/local/offline/games`).

### Bot de Discord

1. En el [portal de desarrolladores](https://discord.com/developers/applications): crear aplicación → Bot → copiar el token. Activar los **Privileged Gateway Intents**: Presence, Server Members y Message Content.
2. Invitar al bot al servidor con `scope=bot applications.commands` y permisos: Manage Channels, Manage Messages, Send Messages, Read Message History, Add Reactions, Create Public Threads, Send Messages in Threads.
3. `cp .env.example .env` y rellenar `DISCORD_TOKEN`, `DISCORD_GUILD_ID` (ID del servidor) y `DISCORD_ADMIN_ID` (tu ID de usuario; único con acceso a `#reportes`).
4. `npm run dev`. El bot crea `#tablon`, `#ooc`, `#crear-personaje` y `#reportes`. Cada jugador escribe su nombre en `#crear-personaje` y recibe `#pov-<nombre>` y `#hoja-<nombre>`.

Los dos personajes de la semilla (Kael, Mira) tienen `user_id` ficticios; en Discord no tendrán canal hasta que se cambie su `user_id` por un ID real o se creen personajes nuevos.

Con `ANTHROPIC_API_KEY` en `.env` el master es Claude (modelo y esfuerzo en `campaign.master`, salvo que `MASTER_MODEL` y `MASTER_EFFORT` los sobrescriban: hoy `.env` fija Haiku a esfuerzo bajo para probar sin gastar); sin ella, narración plana. Prueba rápida sin Discord:

Para jugar o probar sin gastar tokens, `MASTER_MODE` elige el máster: `live` (por defecto) llama a la API en cada acción; `offline` no la llama nunca y responde con un cierre determinista sacado del contexto («Haces X. Nada cambia.», 2-3 acciones sugeridas de los puntos y salidas presentes; si la acción dice «ataco» o «atacar», pide una tirada de ataque para probar el flujo del dado); `record` envuelve al máster real y guarda cada respuesta en `data/local/master-cache/<hash>.json` (hash estable de sistema + tools + mensajes, sin horas), devolviéndola sin llamar si ya existe; `replay` solo lee esa caché y, si falta una petición, avisa por consola y responde en modo offline. Así `MASTER_MODE=offline npm run web` permite jugar en el navegador sin clave (`MASTER_CACHE_DIR` cambia la carpeta de la caché; el motor y el `engine` no cambian).

**Ilustraciones de escena (opcional).** Con `IMAGES=on`, la primera vez que un personaje pisa una localización (al crearlo o al llegar viajando) el motor encola una ilustración de esa escena (`src/ai/illustrate.ts`). Si hay `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, la genera Cloudflare Workers AI (`@cf/black-forest-labs/flux-1-schnell`, 4 pasos, 1024x1024, hasta 2 peticiones a la vez y sin espaciado; cuota gratuita de 10.000 neuronas al día, unas 170 imágenes); si Cloudflare falla (red, `success: false`, o cuota agotada con 429 o error en `errors`, y entonces no se vuelve a probar hasta la medianoche UTC) o no hay esas variables, la hace [Pollinations](https://pollinations.ai). La consola dice qué proveedor sirvió cada imagen. La dispara el motor, no el máster, y no gasta tokens. El prompt es corto y determinista (nombre y descripción base de la localización, luz del momento y un estilo fijo «fantasy illustration, medieval, painterly») y la seed sale de la semilla del mundo (la de dados de la partida o, si no hay, el id de campaña) más el id de la localización: la misma escena da siempre la misma imagen y nunca se pide dos veces (caché en memoria y en `images/index.json`). El servidor descarga el JPEG a `data/games/<slug>/images/<locId>-<seed>.jpg` (Discord y el REPL: `DATA_DIR/images`); la web lo sirve en `/images/<fichero>?game=<slug>` y lo muestra sobre el chat, cambiándolo al moverte, y Discord lo manda al `#pov` como recuadro con la imagen adjunta. Con Pollinations, sin clave funciona en modo anónimo: la imagen lleva un logo pequeño y Pollinations limita a ~1 imagen cada 45 s por IP, contados desde que termina la anterior; la cola pide de una en una, deja 45 s entre peticiones y, ante un 402/429, espera lo que diga `Retry-After` (nunca menos de esos 45 s) y reintenta; una petición colgada se corta a los 90 s. Si se pasa del límite, Pollinations sirve al navegador una imagen «Free limit reached» que no se distingue de una buena, por eso la descarga la hace el servidor, que sí ve el 402; si falla del todo, no se muestra nada y la escena se vuelve a intentar a los 5 minutos. Con `POLLINATIONS_API_KEY` (de enter.pollinations.ai) la petición lleva `Authorization: Bearer` y sale sin logo ni límite. Por defecto está apagado (`IMAGES=off`), así que los tests no tocan la red; con `IMAGES=on` funciona en cualquier modo del máster, también `offline` (ese modo solo evita la API de Anthropic). Las partidas que ya estaban en marcha al activarlo piden la escena actual al abrir la página. Para probarlo sin gastar tokens: configuración `tavernus-web-images` de `.claude/launch.json` (puerto 3127, API de Anthropic desconectada).

```
node --env-file=.env --import tsx scripts/master-smoke.ts "mirar" "le pido una cerveza a Brenna" "tirar"
```

Con `GOOGLE_CLOUD_PROJECT` en `.env` la persistencia pasa a Firestore (credenciales por ADC: cuenta de servicio de la VM o `gcloud auth application-default login`). Despliegue en la VM: SPEC §14.4.

En el REPL:

```
Kael> mirar
Kael> ir al claro del roble
Kael> coger el hacha
Kael> talar el roble
Kael> guardar leña en la mochila
Kael> as Mira            (cambia de personaje)
Mira> /who  /where  /inventory  /recap  /time
Mira> decir hola  /  gritar socorro  /  susurrar psst
Mira> dormir  /  despierto
Kael> tick               (fuerza un tick del reloj; también corre solo cada 10 s)
```

Lo que un personaje hace aparece en el `#pov` de quien lo percibe, con el detalle que le permite su banda.

## Despliegue en la VM de Google (SPEC §14.4)

Scripts en `deploy/`. Usan una configuración de `gcloud` propia (`tavernus`), separada de cualquier otra cuenta del Mac.

1. **Una vez, a mano:** proyecto personal en console.cloud.google.com con facturación activada y alerta de presupuesto; y `CLOUDSDK_ACTIVE_CONFIG_NAME=tavernus gcloud auth login` con la cuenta personal.
2. **Crear y preparar la VM** (e2-micro gratuita en us-central1, Debian 12, 30 GB, Node 24, swap, copias diarias):
   ```
   PROJECT=<id-del-proyecto> deploy/create-vm.sh
   ```
3. **Primera subida**, con la partida y el `.env` (para el bot del Mac, porque dos bots con el mismo token responden por duplicado):
   ```
   deploy/push.sh --with-data
   ```
4. **Actualizaciones** después: `deploy/push.sh` (solo código; la partida de la VM no se toca).

En la VM el bot corre como servicio `systemd` (se relanza solo y arranca al encender). Logs: `sudo tail -f /opt/tavernus/logs/bot.log`. Copias: `/opt/tavernus/backups/`.

## Estructura

```
src/engine       modelo, mundo en RAM, movimiento, inventario, recursos, percepción, eventos, alias, motor
src/clock        reloj global y tickers persistentes
src/persistence  contrato de repositorio, memoria, ficheros JSON, Firestore
src/data/seed    campaña semilla
src/ai           (fase 2) master y director
src/adapters     bot de Discord, REPL de terminal y web local
src/games        gestor de partidas de la web (data/games/<slug>)
src/api          (PWA) interfaz HTTP/WS
test/            vitest
docs/SPEC.md     especificación completa
```

## Decisiones tomadas al implementar (no estaban cerradas en la spec)

- **Firestore, no Postgres.** El diagrama de §11 dice Postgres; §14 decide Firestore. Se sigue §14.
- **Posición = `spot_id`.** §4.4 habla de `location_id` + `position_note`; se usa el `location` polimórfico de §14.2 (punto o vehículo).
- **Tiempo divergente (§10)** queda obsoleto con el reloj global de §1.3; no se implementa.
- **Interrumpir un viaje** deja al PJ en el extremo más cercano del tramo en curso. Cambiar de destino a medio tramo sí parte de la posición interpolada exacta.
- **El habla se enruta por el oído y los gestos por la vista.** Ver a alguien susurrar no te da el contenido.
- **`/recap`** cuenta desde el último evento visto antes de desconectar, no desde el último entregado.
- **Dos ejemplares del mismo ítem no son ambiguos** al resolver texto: se coge el primero.
