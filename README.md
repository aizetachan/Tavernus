# Tavernus

D&D multijugador por chat con Master IA, que se juega en una web propia. La spec completa está en [`docs/SPEC.md`](docs/SPEC.md); la dirección y las fases hacia mundos generados y vivos, en [`docs/PLAN.md`](docs/PLAN.md); dónde lo dejamos, en [`docs/RETOMAR.md`](docs/RETOMAR.md). Para jugar: [Cómo se juega](docs/GUIA-USUARIO.md).

Principio rector: **la base de datos es la verdad; el master IA solo puede cambiarla a través de tools.**

## Arrancar

Hace falta Node 22.9 o posterior. Los comandos son los mismos en bash y en PowerShell.

```
npm install
npm run web:offline   # sin API ni gasto: http://localhost:3107, partidas en data/local/offline
npm run web:haiku     # máster real con Haiku a esfuerzo bajo: http://localhost:3108, partidas en data/local/haiku
npm run web           # lo que diga .env: http://localhost:3000, partidas en data/games
npm run web:watch     # como web, y se reinicia al cambiar el código
npm test              # 1049 tests
npm run typecheck
npm run dev           # sin la web: REPL en la terminal con dos personajes y persistencia en ./data/local
```

`web:offline` y `web:haiku` fijan sus variables en [`scripts/web.ts`](scripts/web.ts), y esas mandan sobre `.env` y sobre la shell. La excepción es `WEB_PORT`, que se puede cambiar desde la shell para tener dos a la vez. `web:haiku` necesita `ANTHROPIC_API_KEY` en `.env`; el actor de los NPC sigue con su modelo (`ACTOR_MODEL`). `web:offline` no llama a ninguna API de pago: ni máster, ni imágenes, ni voz en la nube. Para que se reinicie al cambiar el código: `node --watch --import tsx scripts/web.ts offline`.

## Lo que hay: el mundo sin IA

Con tests:

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
| La web, el producto: menú de partidas, chat, botones, hoja, tablero y mapa, mismo motor | `src/adapters/web/` | §11 |
| REPL de terminal, mismo motor | `src/adapters/repl.ts` | §11 |

El repositorio Firestore está escrito pero **no probado contra un proyecto real** todavía.

## Lo que hay: el master con Claude

| Pieza | Módulo | Spec |
|---|---|---|
| Dados del servidor: expresiones, ventaja, 20/1 naturales; reglas 5e de skills y salvaciones | `src/engine/dice.ts`, `src/engine/rules.ts` | §7, §4.2 |
| Tools del master con esquema (solo `log_event` estricto), ejecutados contra el motor | `src/ai/tools.ts` | §7 |
| Prompt: sistema estable y cacheado 1 h, contexto por acción con percepción por bandas | `src/ai/prompt.ts` | §8 |
| Bucle del master: una llamada por acción, tope de tools, cierre con `log_event`, uso y llamadas guardados en el evento | `src/ai/master.ts` | §2.3 |
| Intención antes de efecto y `requires_roll`: botón 🎲, tirada del servidor, segunda llamada con el resultado | `src/engine/engine.ts` | §4.10 |
| Acciones sugeridas como botones; verbos mecánicos sin LLM; parser plano como red si la API falla | `src/adapters/web/`, `src/engine/engine.ts` | §4.10, §10 |

| NPCs con descripción, motivación y secreto; memoria escrita por el master al hablar (olvido por importancia), cola de conversación | `src/ai/tools.ts`, `src/engine/engine.ts` | §3.3, §9.6 |
| Demo jugable: reputación, pistas, encargos rotatorios en el tablón, práctica por uso, venta/compra, logro con recompensa | `src/engine/progress.ts`, `src/data/seed/demo.ts` | §3.4, §3.5, §4.11, §5.6 |

| Creación de personaje con SRD: 9 razas, 12 clases, 6 trasfondos, array estándar, habilidades, modo de muerte; PG, CA y salvaciones calculados; equipo inicial. Los pasos están sin cliente en `creation.ts`; la web aún pide solo raza y clase (issue #14) | `src/data/srd/`, `src/engine/creation.ts` | §4.6, §4.8 |

| Combate conversacional: bloques SRD de NPC, ataque del jugador con 🎲 y objetivo (tirada, daño y aplicación en el servidor), ataques de NPC, ventanas decisivas con contador y umbrales | `src/engine/combat.ts` | §9.3 |
| Nombres: solo se conocen al presentarse o ser nombrados; testigos ven descripciones | `src/engine/narrate.ts` | §9.2 |

Lo que falta está en [`docs/RETOMAR.md`](docs/RETOMAR.md) y en las issues.

## La web

Una página con lo que ve el personaje elegido, botones de acciones sugeridas y 🎲, comandos `/look /where /who…` y la hoja al lado. Sin autenticación: escucha solo en `127.0.0.1`.

**Menú y partidas.** Al entrar aparece un menú con cuatro bloques: *Nueva partida* (nombre, mundo y máster real / offline / grabar demo; después, un asistente por pasos crea tu personaje según el SRD: nombre, raza, clase, trasfondo, características con el array estándar, habilidades, modo de muerte y un resumen con PG, CA, salvaciones y equipo calculados por el servidor. Lo mismo hace el invitado al abrir su enlace; lo inválido se rechaza en el servidor), *Continuar* (abrir o borrar las guardadas), *Demos* (abrir o empezar de nuevo) y *Grabaciones* (abrir o «convertir en demo»). No hace falta tocar variables de entorno ni reiniciar. Cada partida es una carpeta `data/games/<slug>/` (`GAMES_DIR` la cambia) con un `game.json` (nombre, fechas, campaña, modo del máster, carpeta de datos, carpeta de caché y semilla de dados opcional) y dentro sus datos JSON (`data/`) y su caché de respuestas (`master-cache/`); el servidor arranca un motor por partida al abrirla y la partida viaja en la URL (`/?game=<slug>`; todas las rutas `/api/*` piden `?game=`). Una grabación es una partida real en modo `record` con semilla de dados fija y una foto del estado recién creado (`initial/`); al convertirla en demo pasa a `replay` con su caché, lo jugado se guarda en `recorded/` y la demo vuelve a empezar desde esa foto, así que se repite sin gastar tokens (lo que no esté en la caché lo narra el cliente offline, con aviso en consola). La primera vez, la partida de `DATA_DIR` pasa a ser la «principal» sin mover sus ficheros (con el modo de `MASTER_MODE`) y, si hay caché en `data/local/master-cache`, se empaqueta como «Demo inicial». La web siempre guarda en JSON; el REPL sigue con un motor único sobre `DATA_DIR`/Firestore. Con `npm run web:offline` se prueba todo sin API (sus partidas van a `data/local/offline/games`).

**Jugar con amigos (invitaciones).** Una partida admite varios jugadores en el mismo mundo. Cada uno entra con el enlace de su asiento y queda ligado a su personaje, sin cuentas. Qué funciona del multijugador y qué falta: [docs/MULTIJUGADOR.md](docs/MULTIJUGADOR.md).

1. Arranca el servidor en modo invitación con `ADMIN_TOKEN=<algo largo y secreto>` (o `WEB_ACCESS=invite`; en producción, `NODE_ENV=production`, es el modo por defecto). Detrás de un proxy con HTTPS, `PUBLIC_URL=https://tu-dominio` hace que los enlaces del log salgan bien y las cookies vayan con Secure. Para escuchar fuera de 127.0.0.1 sin proxy está `WEB_HOST=0.0.0.0`. Al arrancar, el log dice que el enlace de administración es `…/admin?token=<token>` y dónde está el token, sin escribirlo: en `ADMIN_TOKEN` o, si no lo pusiste, en `<GAMES_DIR>/.admin-token`, donde se genera y se guarda.
2. Abre ese enlace (cookie de anfitrión: menú, crear y borrar partidas) y crea la partida con tu personaje. «Plazas para amigos» dice cuántos asientos libres se crean (1 por defecto).
3. En la partida, «⚙ → Invitaciones» enseña un enlace por asiento (`/i/<partida>/<token>`), con «Copiar», «Renovar» (invalida el anterior y saca a quien lo usaba), «Añadir asiento libre» y quién está en línea. Pasa a cada amigo el suyo por vuestro chat. Guarda también el tuyo, para entrar desde el móvil.
4. Tu amigo abre el enlace, crea su personaje («Empezar junto a…» lo pone a tu lado) y entra. No ve el menú ni el selector de personajes, y el servidor le rechaza (403) cualquier acción o consulta de otro PJ.

En la cabecera salen los demás jugadores, con punto verde si están en línea («Kael está aquí», «Mira está en camino»), y en la hoja, el bloque «Tu grupo». En el hilo aparece quién entra y quién sale. Mientras tu acción espera a la de otro jugador del mismo sitio, la línea de «pensando» dice «Esperando a Kael». Con máster real, cada personaje tiene un cupo diario: `DAILY_MASTER_ACTIONS` (200 por defecto; 0 = sin límite), `DAILY_MASTER_TOKENS` (0) y `BUDGET_TZ` (Europe/Madrid). Al agotarlo, ese jugador sigue en modo offline hasta medianoche, con un aviso en su hilo. Sin `ADMIN_TOKEN` y escuchando en 127.0.0.1, la web sigue abierta como siempre (`WEB_ACCESS=open`): cualquiera con la URL juega con cualquier personaje. Para probar dos jugadores en un mismo equipo, como las pestañas comparten cookies, usa `localhost` en una y `127.0.0.1` en otra, o una ventana privada; la configuración `tavernus-web-multi` de `.claude/launch.json` arranca en offline y en modo invitación, en el puerto 3207.

**Mundo nuevo (generado).** En *Nueva partida*, «Mundo nuevo» sustituye la aldea de la demo por un mundo hecho para esa partida (`src/worldgen`). Primero el código, con la semilla (vacía = al azar), el tono y la ambientación, elige un asentamiento de un catálogo amplio: aldea, puerto pesquero, ciudad amurallada, campamento minero, monasterio, caravana, fortaleza, mercado de cruce, pueblo abandonado o cuevas; en ciencia ficción, puerto espacial o estación minera; en postapocalíptico, refugio o pueblo de chatarra. También elige sus lugares, sus papeles de NPC, los exteriores y los encargos (`catalog.ts`, `skeleton.ts`). Después, tres llamadas a Claude con salida estructurada y esquemas pequeños, porque la API limita el tamaño del esquema: mundo; gente, pistas y encargos; situaciones. Cada una lee lo que escribieron las anteriores y se valida y reintenta por su cuenta; si alguna aun así no cabe, se pide como JSON sin gramática y se valida igual. Entre las tres ponen nombres, prosa, Biblia, leyes y, para tu personaje, una situación inicial con su porqué, un plazo, un antagonista, tres caminos y el sitio y la hora en que empieza. El relleno usa `WORLDGEN_MODEL` (por defecto `claude-sonnet-5-5`, unos 0,07-0,15 $ por mundo); no usa `MASTER_MODEL`, porque un modelo pequeño da mundos más pobres. Sin clave o en offline sale un mundo de prueba: estructura variada y nombres combinados, pero textos de plantilla. `node --import tsx scripts/worldgen.ts --seed 42 --tone horror --dry` mide la petición sin llamar; sin `--dry`, genera y resume el mundo con tokens y coste.

**Dictado por voz.** Junto al cuadro «¿Qué haces?» hay un micrófono (también en la vista móvil) que usa el reconocimiento de voz del propio navegador (Web Speech API, `SpeechRecognition`/`webkitSpeechRecognition`): sin servidor ni coste por nuestra parte. Se toca para escuchar y otra vez (o se calla) para terminar; el texto provisional sale en gris en el cuadro y el definitivo lo sustituye, normalizado (sin «eh», «vale»… al principio, con mayúscula, y «barra look» o «comando inventario» pasan a `/look`, `/inventory`; «tira los dados» queda como `tirar`). Por defecto se queda en el cuadro para revisarlo y enviarlo; la pastilla «Voz: enviar al terminar» de los atajos lo manda solo (se recuerda en `localStorage`). Idioma: `es-ES`, o el `language` de la campaña si la API de partidas lo da. Va en Chrome/Edge (escritorio y Android, que envían el audio a los servidores de Google, así que necesita conexión) y en Safari de macOS e iOS 14.5+ (con Dictado activado en Ajustes); en Firefox y algunos WebView no hay API y el botón no aparece. El navegador solo da el micrófono en `https` o `localhost`: para jugar desde el móvil hace falta servir la web por https (p. ej. un túnel o un proxy con certificado). Si se niega el permiso, sale un aviso corto en el chat. Código en `src/adapters/web/voice-input.ts`.

**Narrador de voz.** Cada narración del máster lleva un altavoz que la lee en alto, y la cabecera del chat tiene «Leer solo» (encadena las narraciones nuevas), «Parar» y un ajuste con voz del narrador, voz de los personajes, velocidad y «mantener la pantalla encendida»; todo se recuerda en `localStorage`. Por defecto (`TTS_PROVIDER=browser`) la voz es la del propio navegador (`speechSynthesis`, sin servidor ni coste): elige la mejor voz en castellano (las «Natural» de Edge son las mejores), lee el diálogo (rayas, «») con otra voz o, si solo hay una, con otro tono, y con las `lines` del modo novela cada personaje con la suya. Con `TTS_PROVIDER=azure`, `AZURE_SPEECH_KEY` y `AZURE_SPEECH_REGION` la voz la pone Azure Neural TTS (plan gratuito F0: 0,5 M caracteres al mes, unas 41 h de juego; después ~0,18 $ por jugador y hora): `POST /api/tts?game=<slug>` devuelve la narración entera en un mp3 cacheado por hash en `data/games/<slug>/audio`, que sigue sonando con la pantalla apagada (Media Session). Antes de llegar a la voz, el texto se limpia (`src/ai/speech.ts`: sin iconos, negritas ni atajos, dados y siglas leídos en palabras, rayas convertidas en pausas). Comparativa de proveedores, costes y límites en el móvil: [docs/NARRADOR-VOZ.md](docs/NARRADOR-VOZ.md). Código en `src/adapters/web/tts.ts` y `src/ai/narrator.ts`.

**Sonido.** La partida suena al moverse. Al salir de la taberna se oyen pasos sobre madera, la puerta que se abre y se cierra y, después, el ambiente de la plaza en bucle. Cada localización tiene su ambiente (taberna, herrería, interior, plaza o bosque, de día o de noche, agua o lluvia), que cambia con fundido y baja cuando habla el narrador. Además hay efectos para coger y soltar objetos, monedas, dados, golpes y daño. El servidor traduce cada evento del actor en una secuencia corta de claves con una función pura y determinista (`src/adapters/web/soundmap.ts`); suelo, interior o exterior y ambiente salen de los datos del mundo. El navegador las toca con la Web Audio API (`src/adapters/web/sfx.ts`). Los ambientes son grabaciones reales con licencia libre (CC0, de Freesound) en `public/sfx/ambient/<clave>.ogg` y `.mp3`, en bucle sin costura y a volumen de fondo. Están atribuidas en `public/sfx/LICENSES` y en los créditos del panel «Sonido». Los efectos, y cualquier ambiente sin pista (la lluvia), se sintetizan en el navegador sin ficheros ni coste. Un fichero en `public/sfx/<clave>.ogg` (CC0 o CC-BY, anotado en `public/sfx/LICENSES`) sustituye a la receta de su clave. Nada suena hasta el primer toque en la página. El botón «Sonido» de la cabecera del chat silencia y da acceso al volumen general y al del ambiente; ambos se recuerdan en `localStorage`. La generación por IA está desactivada y queda para más adelante: con `SFX_AI_ENABLED = false` (`src/ai/sound.ts`) no se llama a ninguna API aunque haya `SFX_PROVIDER` y clave. Encendida, `/api/sfx?key=…` generaría cada clave una vez y la cachearía en `data/games/<slug>/sfx`, por unos 0,3–1 $ por mundo con ElevenLabs. Análisis, costes y licencias en [docs/SONIDO.md](docs/SONIDO.md).

**Máster.** Con `ANTHROPIC_API_KEY` en `.env` el master es Claude (modelo y esfuerzo en `campaign.master`, salvo que `MASTER_MODEL` y `MASTER_EFFORT` los sobrescriban: `npm run web:haiku` fija Haiku a esfuerzo bajo); sin ella, narración plana. En las charlas con NPC, un segundo modelo (el actor) pone las palabras del NPC: `ACTOR_MODEL` lo elige y `ACTOR_MODEL=off` lo apaga (docs/CONVERSACION.md).

Para jugar o probar sin gastar tokens, `MASTER_MODE` elige el máster: `live` (por defecto) llama a la API en cada acción; `offline` no la llama nunca y responde con un cierre determinista sacado del contexto («Haces X. Nada cambia.», 2-3 acciones sugeridas de los puntos y salidas presentes; si la acción dice «ataco» o «atacar», pide una tirada de ataque para probar el flujo del dado); `record` envuelve al máster real y guarda cada respuesta en `data/local/master-cache/<hash>.json` (hash estable de sistema + tools + mensajes, sin horas), devolviéndola sin llamar si ya existe; `replay` solo lee esa caché y, si falta una petición, avisa por consola y responde en modo offline. Así `npm run web:offline` permite jugar en el navegador sin clave (`MASTER_CACHE_DIR` cambia la carpeta de la caché; el motor y el `engine` no cambian).

**Partidas automáticas y juez.** Para recoger errores del máster sin jugar a mano, `npm run autoplay -- --games 10 --actions 20 --live` crea partidas reales del gestor (`data/games/auto-<fecha>-<n>`, se pueden abrir en la web) con mundo generado y un personaje con su situación inicial. Un jugador automático las juega: elige una acción sugerida el 60 % de las veces y el 40 % escribe una propia con «ganas de liarla» (regatear, mentir, colarse, pedir fiado, empeñar, amenazar, preguntar por lo que no existe) y tira cuando toca. Después `scripts/judge.ts` lee cada log en dos capas: detectores deterministas gratis (tool fallido narrado como hecho, lugar inventado, NPC fuera de alcance, memoria de NPC con prenda o deuda sin estado detrás, tirada trivial, sugerida repetida, narración larga) y un juez modelo con una lista cerrada y JSON estricto (incoherencia con el contexto, NPC fuera de personaje, promesa sin estado, regla mal aplicada, imposible sin ingenio, inventiva mal gestionada). El resumen con tokens y coste y el informe (`report.md`: errores por tipo, por partida y los 10 peores turnos con su texto) quedan en `data/local/autoplay/<fecha>/`. Modelos: `MASTER_MODEL`, `PLAYER_MODEL`, `WORLDGEN_MODEL` y `JUDGE_MODEL`, por defecto `claude-haiku-5-5` los cuatro. Sin `--live` solo imprime la estimación; `--dry-run` recorre todo con clientes falsos y no gasta nada; `npm run judge -- --run <carpeta>` vuelve a juzgar una tanda (sin `--live`, solo los detectores; con `--reuse-model`, repite los detectores y conserva lo que dijo el juez modelo, gratis). Coste medido con Haiku en el piloto de 10 partidas × 20 acciones (2026-10-22): 0,38 $ en total, unos 0,19 céntimos por acción (0,16 de máster, 0,01 de jugador y 0,02 de juez), o sea unos 0,04 $ por partida de 20 acciones. Con Haiku el relleno del mundo choca con el límite de gramática de la API (400, sin coste) y la partida sigue con un mundo offline.

**Ilustraciones de escena (opcional).** Con `IMAGES=on`, la primera vez que un personaje pisa una localización (al crearlo o al llegar viajando) el motor encola una ilustración de esa escena (`src/ai/illustrate.ts`). Si hay `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, la genera Cloudflare Workers AI (`@cf/black-forest-labs/flux-1-schnell`, 4 pasos, 1024x1024, hasta 2 peticiones a la vez y sin espaciado; cuota gratuita de 10.000 neuronas al día, unas 170 imágenes); si Cloudflare falla (red, `success: false`, o cuota agotada con 429 o error en `errors`, y entonces no se vuelve a probar hasta la medianoche UTC) o no hay esas variables, la hace [Pollinations](https://pollinations.ai). La consola dice qué proveedor sirvió cada imagen. La dispara el motor, no el máster, y no gasta tokens. El prompt es corto y determinista (nombre y descripción base de la localización, luz del momento y un estilo fijo «fantasy illustration, medieval, painterly») y la seed sale de la semilla del mundo (la de dados de la partida o, si no hay, el id de campaña) más el id de la localización: la misma escena da siempre la misma imagen y nunca se pide dos veces (caché en memoria y en `images/index.json`). El servidor descarga el JPEG a `data/games/<slug>/images/<locId>-<seed>.jpg` (el REPL: `DATA_DIR/images`); la web lo sirve en `/images/<fichero>?game=<slug>` y lo muestra sobre el chat, cambiándolo al moverte. Con Pollinations, sin clave funciona en modo anónimo: la imagen lleva un logo pequeño y Pollinations limita a ~1 imagen cada 45 s por IP, contados desde que termina la anterior; la cola pide de una en una, deja 45 s entre peticiones y, ante un 402/429, espera lo que diga `Retry-After` (nunca menos de esos 45 s) y reintenta; una petición colgada se corta a los 90 s. Si se pasa del límite, Pollinations sirve al navegador una imagen «Free limit reached» que no se distingue de una buena, por eso la descarga la hace el servidor, que sí ve el 402; si falla del todo, no se muestra nada y la escena se vuelve a intentar a los 5 minutos. Con `POLLINATIONS_API_KEY` (de enter.pollinations.ai) la petición lleva `Authorization: Bearer` y sale sin logo ni límite. Por defecto está apagado (`IMAGES=off`), así que los tests no tocan la red; con `IMAGES=on` funciona en cualquier modo del máster, también `offline` (ese modo solo evita la API de Anthropic). Las partidas que ya estaban en marcha al activarlo piden la escena actual al abrir la página. Para probarlo sin gastar tokens: configuración `tavernus-web-images` de `.claude/launch.json` (puerto 3127, API de Anthropic desconectada).

## En la terminal

Prueba rápida del máster:

```
node --env-file=.env --import tsx scripts/master-smoke.ts "mirar" "le pido una cerveza a Brenna" "tirar"
```

En el REPL (`npm run dev`; con `GOOGLE_CLOUD_PROJECT` en `.env` persiste en Firestore, con credenciales por ADC: `gcloud auth application-default login`):

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

Lo que un personaje hace le llega a quien lo percibe, con el detalle que le permite su banda.

## Despliegue en un VPS (web en internet)

La web se publica en un VPS Debian o Ubuntu con los scripts de `deploy/`: `deploy/push.sh --setup --domain <dominio>` prepara el servidor una vez (Node 22, usuario de servicio, Caddy con HTTPS automático, cortafuegos, copias diarias y aviso si se cae) y `deploy/push.sh` sube cada versión (en PowerShell, `deploy\push.ps1`). Paso a paso, sin dominio todavía, copias, avisos, coste y seguridad: [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md).

### Desplegar sin root (usuario `tavernus`)

Los despliegues entran como `tavernus`, el mismo usuario sin privilegios con el que corre `tavernus-web`. La clave de root (`~/.ssh/tavernus_deploy`) queda solo para administrar: `--setup`, `--ops`, `--usuario-deploy` y `data-sync.sh`.

- **Configuración del PC** en `deploy/local.env` (git lo ignora; plantilla en [`deploy/local.env.example`](deploy/local.env.example)): `TAVERNUS_HOST=tavernus@<IP>` con `TAVERNUS_SSH_KEY=~/.ssh/tavernus_pc`, y `TAVERNUS_ADMIN_HOST=root@<IP>` con `TAVERNUS_ADMIN_SSH_KEY`. Una variable de entorno manda sobre el fichero: `TAVERNUS_HOST=root@<IP> TAVERNUS_SSH_KEY=… deploy/push.sh` despliega como root, como antes.
- **Preparar un servidor** (idempotente, como root, después de `--setup`):

  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/tavernus_pc -C tavernus_pc
  deploy/push.sh --usuario-deploy --clave pc "$(cat ~/.ssh/tavernus_pc.pub)"
  ```

  Lo hace [`deploy/preparar-usuario-deploy.sh`](deploy/preparar-usuario-deploy.sh). Antes de tocar nada, guarda una copia de la cuenta, las unidades, `sudoers`, `authorized_keys`, el Caddyfile y los propietarios en `/root/tavernus-deploy-<fecha>/`. Después deja:
  - `tavernus` con bash y la contraseña bloqueada, fuera del grupo `docker`, con home `/home/tavernus` y dueño de `/opt/tavernus`. La primera vez para la web unos segundos para cambiar el home.
  - `/home/tavernus/.ssh/authorized_keys` con `restrict` en cada línea (sin terminal ni túneles). El fichero y su carpeta son de root, así que tavernus no puede añadirse claves ni quitarse el `restrict`.
  - `/etc/sudoers.d/tavernus`, validado con `visudo -c`, que solo permite `systemctl restart|reset-failed tavernus-web`, `systemctl reload caddy`, `journalctl -u tavernus-web -n 30 --no-pager -o cat` y `/usr/local/sbin/tavernus-publicar-caddy`, sin argumentos.
  - [`tavernus-publicar-caddy`](deploy/tavernus-publicar-caddy.sh) tiene origen fijo (`/opt/tavernus/current/deploy/Caddyfile`, que lee como tavernus) y destino fijo (`/etc/caddy/Caddyfile`). Solo acepta un sitio para los dominios de `caddy.env` con proxy a 127.0.0.1, sin acceso a disco. Valida `main.caddy` completo, con los sitios del hub y de las demos, como el usuario `caddy`, y si la validación o la recarga fallan, restaura el anterior.
- **Lo que tavernus no instala:** los scripts de `/usr/local/lib/tavernus` y las unidades de systemd los ejecuta root. Si cambian en el repo, `deploy/push.sh` lo avisa y se aplican con `deploy/push.sh --ops`.
- **Rotar la clave del PC:** genera otra (`ssh-keygen -t ed25519 -f ~/.ssh/tavernus_pc_nueva`) y ejecuta `deploy/push.sh --usuario-deploy --clave pc "$(cat ~/.ssh/tavernus_pc_nueva.pub)"`. Eso sustituye la línea `pc` y deja las demás. Prueba con `ssh -i ~/.ssh/tavernus_pc_nueva tavernus@<IP> 'systemctl status tavernus-web --no-pager'`, cambia `TAVERNUS_SSH_KEY` y borra la vieja. Si la clave se pierde o se filtra, `--quitar pc` la anula al momento.
- **GitHub Actions** (si se añade un flujo de despliegue): usa este mismo usuario con una clave propia, nunca la de root. Genera `ssh-keygen -t ed25519 -N '' -f tavernus_actions -C tavernus_actions` y añádela como otra línea con `deploy/push.sh --usuario-deploy --clave actions "$(cat tavernus_actions.pub)"`. Guarda la privada solo en el secreto `SSH_PRIVATE_KEY` del repositorio y bórrala del disco. El flujo exporta `TAVERNUS_HOST=tavernus@<IP>` y `TAVERNUS_SSH_KEY` y ejecuta `deploy/push.sh`. Para revocarla: `--quitar actions`. El script se niega a aceptar como clave de tavernus una que ya esté en el `authorized_keys` de root.
- **Volver atrás:** pon `TAVERNUS_HOST=root@<IP>` y `TAVERNUS_SSH_KEY=~/.ssh/tavernus_deploy` en `deploy/local.env`, porque `release.sh` sigue funcionando como root. Para quitar también el acceso de tavernus, ejecuta `deploy/push.sh --usuario-deploy --deshacer`: borra el sudoers, el envoltorio y las claves, y devuelve `tavernus` a `nologin` con home `/opt/tavernus`, guardando antes otra copia en `/root/tavernus-deploy-<fecha>/`. A mano, como root: `rm /etc/sudoers.d/tavernus /usr/local/sbin/tavernus-publicar-caddy && visudo -c`, y luego `usermod -s /usr/sbin/nologin -d /opt/tavernus tavernus` con la web parada.

## Estructura

```
src/engine       modelo, mundo en RAM, movimiento, inventario, recursos, percepción, eventos, alias, motor
src/clock        reloj global y tickers persistentes
src/persistence  contrato de repositorio, memoria, ficheros JSON, Firestore
src/data/seed    campaña semilla
src/ai           (fase 2) master y director
src/adapters     la web (el producto) y el REPL de terminal
src/games        gestor de partidas de la web (data/games/<slug>)
src/worldgen     generador de mundos
src/rules        consulta de reglas
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
