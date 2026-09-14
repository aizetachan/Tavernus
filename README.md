# Tavernus

D&D multijugador por chat con Master IA. La spec completa está en [`docs/SPEC.md`](docs/SPEC.md).

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
npm test          # 83 tests
npm run dev       # sin .env: REPL local con dos personajes y persistencia en ./data/local
```

### Bot de Discord

1. En el [portal de desarrolladores](https://discord.com/developers/applications): crear aplicación → Bot → copiar el token. Activar los **Privileged Gateway Intents**: Presence, Server Members y Message Content.
2. Invitar al bot al servidor con `scope=bot applications.commands` y permisos: Manage Channels, Manage Messages, Send Messages, Read Message History, Add Reactions, Create Public Threads, Send Messages in Threads.
3. `cp .env.example .env` y rellenar `DISCORD_TOKEN`, `DISCORD_GUILD_ID` (ID del servidor) y `DISCORD_ADMIN_ID` (tu ID de usuario; único con acceso a `#reportes`).
4. `npm run dev`. El bot crea `#tablon`, `#ooc`, `#crear-personaje` y `#reportes`. Cada jugador escribe su nombre en `#crear-personaje` y recibe `#pov-<nombre>` y `#hoja-<nombre>`.

Los dos personajes de la semilla (Kael, Mira) tienen `user_id` ficticios; en Discord no tendrán canal hasta que se cambie su `user_id` por un ID real o se creen personajes nuevos.

Con `ANTHROPIC_API_KEY` en `.env` el master es Claude (modelo y esfuerzo en `campaign.master`); sin ella, narración plana. Prueba rápida sin Discord:

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
src/adapters     bot de Discord y REPL de terminal
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
