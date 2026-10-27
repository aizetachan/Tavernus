# Spec — D&D multijugador por chat con Master IA

Principio rector: **la base de datos es la verdad, el master IA solo puede cambiarla a través de tools.** Todo lo que no esté en la DB, para el juego no existe.

---

## 1. Configuración de la campaña (`campaigns`)

Lo que define el creador de la partida antes de que entre nadie. Se convierte en el system prompt del master + las filas iniciales del mundo.

### 1.1 Identidad de la campaña
| Campo | Ejemplo | Para qué |
|---|---|---|
| `name` | "Las Cenizas de Vharn" | Título |
| `premise` | 2-3 frases: qué está pasando en el mundo y por qué importa | Ancla narrativa del master |
| `setting` | Fantasía medieval oscura / steampunk / etc. | Vocabulario y tecnología disponible |
| `tone` | `epic` / `grim` / `comedy` / `horror` / `pulp` | Estilo de narración |
| `content_rating` | Nivel de violencia, gore, temas adultos (0-3) | Guardrail duro |
| `language` | es / en | Idioma del master |
| `player_cap` | **10** en el MVP | Límite de jugadores de la campaña |

### 1.2 Reglas de juego
| Campo | Opciones |
|---|---|
| `ruleset` | `srd5e` (libre de licencia). El master conoce 5e; solo hay que decirle qué variantes usar |
| `starting_level` | 1-20 |
| `xp_mode` | `xp` (puntos) / `milestone` (subes al cumplir hitos definidos por el master) |
| `death_rule` | **DECIDIDO: modo por jugador**, ver §4.7. La campaña fija `casual_respawn_wait` (2h), `hardcore_respawn_wait` (30 min) y `hardcore_ability_penalty` |
| `pvp_allowed` | **DECIDIDO: `all`** — robo, daño y muerte entre PJs permitidos mientras el objetivo esté conectado. Solo el velo (§9.1) protege la vida. Ver §9.4 |
| `rest_rules` | Descanso corto/largo estándar o variantes (gritty realism) |
| `dice_visibility` | Si los jugadores ven las tiradas del master o no |
| `house_rules` | Texto libre: "críticos hacen daño máximo + tirada", "no hay flanqueo", etc. |

### 1.3 Tiempo del mundo — DECIDIDO
Reloj **global único con velocidad fija**, ligado al reloj real, que avanza solo y siempre igual. Nadie tiene un tiempo distinto y la velocidad no cambia nunca.

| Campo | Valor |
|---|---|
| `calendar` | Nombres de meses/días si quieres inmersión |
| `time_ratio` | **3×** — 8 horas reales = 1 día de juego, siempre |
| `current_datetime` | Estado vivo, lo lleva el servidor (cron cada minuto), no el master |

Tabla de equivalencias (ratio 3×):

| Real | Juego |
|---|---|
| 20 min | 1 h |
| 2 h 40 | 8 h (descanso largo) |
| 8 h | 1 día |
| 1 día | 3 días |
| 1 semana | 3 semanas |

Consecuencias de diseño:
- `advance_time` no es un tool del master. El tiempo solo lo mueve el servidor.
- `travel_time`, descansos y `respawn_at` se expresan en tiempo de juego y se convierten a real con el ratio fijo.
- Horarios de NPC, luz día/noche y eventos programados se derivan de `current_datetime`.
- El mundo sigue corriendo aunque nadie juegue: eso solo afecta a las **líneas secundarias** (§3.1 Capa B). La **trama principal** (Capa A) nunca avanza por tiempo, solo por acontecimientos, así que una semana sin jugadores no consume la historia.

---

## 2. Configuración del master (`master_config`)

Separado de la campaña porque la misma historia se puede dirigir con distintos masters.

### 2.1 Persona
- `name`: nombre que usa al hablar ("el Narrador", "Grimwald").
- `voice`: 3-5 rasgos de estilo ("descriptivo pero breve", "usa segunda persona", "humor seco").
- `narration_length`: `short` / `medium` / `long` — cuántos párrafos por respuesta. Para chat multijugador: **short** casi siempre.
- `perspective`: segunda persona ("Ves…") o tercera ("Kael ve…"). En multijugador, tercera evita confusión.

### 2.2 Comportamiento
| Parámetro | Valores | Notas |
|---|---|---|
| `difficulty` | `easy` / `normal` / `hard` / `deadly` | Ajusta CDs y encuentros |
| `pacing` | `slow_burn` / `balanced` / `action` | Cuánto tarda en lanzar eventos |
| `player_agency` | `railroad` / `guided` / `sandbox` | Cuánto sigue la trama vs. improvisa |
| `improvisation` | 0-10 | Libertad para crear localizaciones/NPCs no definidos |
| `fudge_dice` | bool | Si puede ignorar tiradas por drama. Recomendado: false |
| `secret_keeping` | Lista de qué nunca revela sin tirada/evento | Ver §3.6 |

### 2.3 Guardrails (reglas duras en el prompt)
- Nunca decide el resultado de una acción con riesgo sin llamar a `roll_dice`.
- Nunca modifica HP, inventario o posición sin el tool correspondiente.
- Nunca actúa por un jugador (no decide lo que dice o hace un PJ).
- Nunca resuelve más de una acción por mensaje de jugador.
- No revela información de `secrets` salvo que el evento desbloqueador esté en el log.
- Si un jugador pide algo fuera del setting, lo redirige en ficción, no rompe la cuarta pared salvo comandos `/ooc`.
- Respeta `content_rating`.

### 2.4 Comandos de sistema (fuera de ficción)
`/sheet`, `/inventory`, `/where`, `/who` (quién está en mi localización), `/rest`, `/ooc texto`, `/recap` (resumen de lo que me he perdido), `/leave`. Los gestiona el servidor, no el LLM.

---

## 3. El mundo (lo que hay que escribir para "tener historia")

### 3.1 Trama — DECIDIDO: dos capas que no se mezclan

**Capa A — Trama principal (`threads` + `bible`). Emergente, solo avanza por acontecimientos.**
No está escrita entera de antemano. Es una base de datos de hilos que un segundo agente (el **Director**, §3.1.1) va construyendo a partir de lo que hacen los jugadores. El tiempo no le afecta nunca: si nadie juega en un mes, está exactamente donde la dejaron.

*La Biblia (`bible`)* — lo único fijo, escrito por el autor: 5-10 **verdades del mundo** que nada puede contradecir (quién es el antagonista real, qué pasó hace 200 años, qué hay bajo el lago). Son la semilla de todo lo lejano. El Director genera dentro de ellas; el Master solo conoce las reveladas. Campo `revealed_to[]` como los secretos.

*Los hilos (`threads`)*:
| Campo | Detalle |
|---|---|
| `title`, `summary` | |
| `horizon` | `immediate` (escrito: escenas, NPCs, triggers) / `near` (esbozo: objetivo, 2-3 desenlaces posibles, NPCs implicados) / `far` (una frase) |
| `status` | `draft` / `active` / `resolved` / `archived` |
| `bible_refs[]` | Verdades de las que depende |
| `spawned_by[]` | Eventos reales que lo originaron. Trazabilidad obligatoria |
| `scenes[]` | Solo en `immediate`: `trigger` (evento concreto), `setup`, `stakes`, `possible_outcomes[]` |
| `involves` | NPCs, localizaciones, facciones, PJs |
| `resolution` | Cómo se cerró y qué consecuencias dejó (rellenado al resolver) |
| `plot_critical` | bool: las líneas secundarias no pueden tocar sus entidades |

Los `trigger` son siempre **eventos concretos** (`quest_step_done`, `location_visited`, `npc_status = dead`, `secret_revealed`, `item_obtained`), nunca fechas.

Arranque: el autor escribe la Biblia, 1 hilo `immediate` (el gancho de entrada), 2-3 `near` y 2-3 `far`. El resto lo genera el Director.

#### 3.1.1 El Director (segundo agente)
No habla con jugadores. Corre en segundo plano **tras cada evento con tag `milestone`** (hilo resuelto, secreto revelado, NPC clave muerto, localización crítica visitada) y **una vez por día de juego**. Lee `campaign_chronicle`, hilos abiertos, Biblia y eventos recientes, y escribe la trama vía tools:
- `promote_thread(id, horizon)` — concreta un hilo cuando los jugadores se acercan: `far → near → immediate`, incorporando lo que ha pasado hasta entonces
- `create_thread(def)` — abre hilos nuevos **a partir de consecuencias reales** (mataron al capitán → el hermano, el vacío de poder, el contrabandista que ahora opera libre)
- `resolve_thread(id, resolution)` — cierra y registra consecuencias
- `archive_thread(id, reason)` — nunca borra
- `create_secret`, `spawn_npc`, `update_npc`, `create_quest` — para materializar un hilo `immediate`
- `adjust_thread(id, patch)` — reescribe un hilo `near` si las acciones lo han dejado obsoleto

Guardarraíles:
- **Presupuesto de tensión**: máximo `max_immediate_threads` (propuesta: 3-4) abiertos a la vez. Si se alcanza, no promociona ni crea.
- Todo hilo nuevo debe tener `spawned_by[]` no vacío **o** `bible_refs[]` no vacío. Nada nace de la nada.
- No contradice la Biblia ni eventos registrados. Si un hilo `near` ya no cuadra con lo ocurrido, lo ajusta o archiva; no fuerza.
- `director_mode`: `draft` (todo lo que crea queda pendiente de aprobación del admin en el panel) / `auto`. Empezar en `draft` hasta validar que acierta.
- Deja siempre al menos 1 hilo `immediate` alcanzable desde cada localización con jugadores activos, para que nadie se quede sin gancho.

Resultado: los jugadores conocen lo inmediato con detalle, intuyen lo cercano y solo tienen rumores de lo lejano, como en la vida real; y lo que hacen hoy es la materia prima de lo que existirá mañana.

**Capa B — Líneas secundarias (`timelines`). Avanzan con el reloj del mundo.**
Dan dinamismo y sensación de realidad: el mundo se mueve aunque nadie toque la trama.
- `name`, `type`: `recurring` (mercado, guardias, caravana cada 3 días, festival anual) / `progressive` (una plaga que empeora por etapas, una sequía, tensión entre dos gremios) / `one_shot` (un eclipse el día 40).
- `schedule` o `steps[]` con `advance_every` en tiempo de juego y `effects[]`: cambios en `location.state`, `npc.attitude`, precios, `location.contents`, quests secundarias que aparecen o caducan.
- `visibility`: qué se anuncia en `#tablon` y qué solo se descubre en sitio.
- `max_stage` y `reset_on`: opcional, para que una línea progresiva no escale hasta el absurdo si nadie interviene (ej. la plaga se estabiliza en etapa 4).
- Pueden dar quests con recompensa, pero **nunca son requisito ni bloqueo de la Capa A.**

**Regla puente:** una línea secundaria puede **decorar** la trama principal (clima, toque de queda, precios, ambiente, rumores), pero **nunca alterarla** (no mueve NPCs clave, no cierra localizaciones de trama, no cambia estados que sean triggers de Capa A). El servidor lo valida: los `effects` de una timeline no pueden tocar entidades marcadas `plot_critical: true`.

Los jugadores sí pueden intervenir en una línea secundaria (curar la plaga, escoltar la caravana) y eso la detiene o la cambia; el resultado se registra como evento normal.

**Extensibilidad — DECIDIDO:** empezar con 2-3 líneas, pero el sistema tiene que aceptar más sin tocar código:
- Las `timelines` son **datos en la DB**, no código. Se crean, editan, pausan o borran desde el panel de admin en caliente, con la campaña en marcha.
- Campo `status`: `scheduled` / `active` / `paused` / `finished`. Una línea pausada no dispara efectos ni aparece en el prompt.
- **Eventos temáticos puntuales** (`type: one_shot` con `starts_at`, `ends_at` en tiempo real o de juego): festival, eclipse, invasión de una noche, evento de Halloween. Pueden traer NPCs temporales, ítems exclusivos (`available_until`), quests con caducidad y un `prompt_addon` (texto que se inyecta al master solo mientras dura: tono, vocabulario, reglas especiales). Al terminar, el servidor retira NPCs e ítems marcados `temporary` y archiva la línea.
- Plantillas: guardar una línea como `template` para reutilizarla en otra campaña o repetirla el año siguiente.
- Límite práctico: el prompt solo incluye las líneas `active` que afecten a la localización actual o sean `visibility: public`; el resto no cargan contexto aunque existan muchas.

### 3.2 Mapa — DECIDIDO: jerarquía canónica, sin coordenadas
El master nunca describe el espacio de memoria: lo lee de esta estructura y solo puede referirse a lo que existe en ella. Es lo que garantiza que todos vean el mismo mundo.

**Región** (`regions`) → **Zona** (`zones`: ciudad, bosque) → **Localización** (`locations`: taberna, plaza, claro) → **Punto** (`spots`: la barra, la mesa del fondo, el roble viejo, el altar).

- **Localización** = unidad de presencia: canal de Discord, cola de acciones, "quién está aquí". Moverse entre localizaciones usa `exits` con `travel_time`.
- **Punto** = unidad de posición dentro de la localización. Cada PJ, NPC e ítem suelto tiene `location_id` + `spot_id`. **Todo desplazamiento cuesta tiempo** (§3.2.3), también entre puntos.

Reglas del servidor:
1. **Nombres canónicos + alias.** `spots.aliases[]` ("el roble", "el árbol grande", "the old oak"). El servidor resuelve el texto del jugador al punto **antes** de llegar al master. Si no resuelve, el master pregunta; no inventa.
2. **El master no crea espacio de la nada.** Solo referencia puntos existentes. Con `improvisation` suficiente puede llamar a `create_spot`, que persiste al instante y queda para todos.
3. **Descripción = plantilla + estado.** `description_base` fija; el master la adapta con `state`, `contents`, ocupantes por punto y hora. Distinta en estilo, idéntica en hechos.
4. **Puntos ocultos.** `hidden: bool`, `dc_to_find`, `discovered_by[]`. Existen para todos; solo los ve quien los descubrió o a quien se lo enseñan (`share_discovery`).
5. **Capacidad.** `spots.capacity` (una cornisa: 2). Lleno = no cabes, lo decide el servidor.
6. **Proximidad = mismo punto.** Sigilo, escuchar, alcance cuerpo a cuerpo. Distintos puntos de la misma localización se ven salvo `hidden` o `state.line_of_sight_blocked[]`.
7. **`/map`** renderiza el grafo de la zona con lo descubierto por ese jugador, desde la DB, nunca desde el LLM.

Sin cuadrícula en el MVP. Si algún día hay combate táctico, cada localización puede tener `grid` opcional; los puntos siguen siendo la verdad.

#### 3.2.1 Puntos (`spots`)
| Campo | Detalle |
|---|---|
| `id`, `location_id`, `name`, `aliases[]` | |
| `description` | Una o dos frases |
| `capacity` | null = ilimitado |
| `hidden`, `dc_to_find`, `discovered_by[]` | |
| `contents[]` | Ítems sueltos y contenedores fijos (cofre, altar) con su propio inventario |
| `state` (JSON) | `broken`, `lit`, `locked`, `bloodstained`… |
| `tags[]` | `cover`, `high_ground`, `climbable`, `water`, `dark` — el master los usa para conceder ventajas mecánicas |
| `x`, `y` | Coordenadas en metros dentro de la localización. Obligatorias: de ellas sale el tiempo de desplazamiento |
| `terrain_multiplier` | Velocidad al moverse hacia/por este punto (`road` 1, `dense_forest` 0.5, `water` 0.3) |
| `entry_cost_s` | Tiempo fijo extra en segundos (trepar al roble: +30) |

Tools nuevos: `move_to(character_id, target_spot_id, pace)` (sustituye a `move_character`; funciona dentro y entre localizaciones), `create_spot(location_id, def)`, `discover_spot(character_id, spot_id)`, `share_discovery(from, to, spot_id)`.

#### 3.2.3 Movimiento — DECIDIDO: nunca instantáneo, misma fórmula para todos
El servidor calcula el tiempo; el master solo narra el resultado.

```
tiempo_juego = distancia / (velocidad_PJ × terreno × condiciones × ritmo)
tiempo_real  = tiempo_juego / time_ratio (3)
```
- `velocidad_PJ`: de la hoja (30 ft = 9 m / 6 s ≈ 90 m/min). `pace`: `stealth` ×0.5, `walk` ×1, `run` ×2 (con coste de fatiga).
- `terreno`: `terrain_multiplier` del punto o de la salida; `entry_cost_s` se suma.
- `condiciones`: cargado, exhausto, heridas → multiplicadores de la hoja.
- Distancia dentro de una localización: euclídea entre `x,y` de los puntos. Entre localizaciones: **Dijkstra** sobre `exits[].distance_m` + tramo interno hasta la salida + tramo interno desde la entrada (`default_spot_id`) al destino.

Garantía: mismo origen y misma velocidad → mismo tiempo; distinto origen → tiempo proporcional a la distancia real del mapa. Kael de la piedra al roble en 3 min; quien esté a medio camino, 1,5 min.

Estado `in_transit`: `origin_spot`, `destination_spot`, `departed_at`, `arrives_at`, posición interpolada (quien mire "ve a Kael a medio camino"). Interrumpible por: encuentro de línea secundaria, otro PJ que lo alcanza, o el propio jugador (recalcula desde la posición actual). Al llegar: `event: arrived` y el master narra.

Salidas: `exits[]` pasa a `{to_location_id, from_spot_id, to_spot_id, distance_m, terrain_multiplier, blocked_by?}`.

Único atajo: conjuros/ítems con `instant_travel: true`. No aplica en el MVP.

#### 3.2.2 Localizaciones (`locations`)
| Campo | Detalle |
|---|---|
| `id`, `name` | |
| `region_id` | Agrupación (ciudad, bosque…) |
| `description_base` | Descripción que el master adapta, no copia |
| `exits[]` | `{to_location_id, from_spot_id, to_spot_id, distance_m, terrain_multiplier, blocked_by?}` — el mapa es un grafo con distancias reales (§3.2.3) |
| `state` (JSON) | Flags mutables: `door_open`, `chest_looted`, `guards_alive: 2`, `fire: true` |
| `spots[]` | Puntos de la localización (§3.2.1). Todo ítem suelto está en un punto, nunca "en la localización" |
| `default_spot_id` | Donde aparece quien entra por una salida |
| `npcs_present[]` | Quién está aquí ahora (vivo, mutable) |
| `dangers[]` | Trampas, encuentros aleatorios con probabilidad |
| `ambience` | Luz, sonido, olor — para que la narración sea consistente entre jugadores |
| `discovery_state` | `unknown` / `heard_of` / `visited` por jugador |

Regla: **todo lo que un jugador puede alterar tiene que estar en `state` o `contents`.** Si el master narra "hay una vidriera" y un jugador la rompe, `update_location_state` guarda `window_broken: true` y el siguiente en llegar la ve rota.

#### 3.2.4 Viajar juntos, monturas y vehículos — DECIDIDO: no hay líder, hay física
No existe "seguir a alguien". Dos PJs viajan juntos porque van al **mismo destino a la misma velocidad**; el servidor los hace llegar a la vez. Nadie depende de otro salvo que físicamente dependa (va en su caballo).

- **Regla única:** tu velocidad es la de lo que te lleva. A pie, la tuya; a caballo, la del caballo; en carruaje, la del carruaje.
- **Monturas y vehículos** son entidades con `location_id`/`spot_id`, `speed`, `capacity`, `owner_id`, `terrain_allowed[]` (un carro no entra al bosque denso), y su propio inventario (alforjas). Un caballo lleva 1 jinete + 1 a la grupa (`capacity: 2`, velocidad reducida). Un carruaje lleva N pasajeros y necesita conductor.
- Cada PJ necesita su montura o un asiento en la de otro. Si vas a la grupa, llegas donde y cuando llegue el dueño; si él se baja, tú también.
- `move_to(..., pace, match_pace_with?)`: opcionalmente igualar tu ritmo al de otro PJ presente para no separaros (el rápido elige ir lento; nunca al revés).
- Grupo formal: **no hay objeto `party` en el MVP.** Estar juntos = estar en el mismo punto. Las quests pueden compartirse con quien esté presente al aceptarlas. Reparto de botín y visibilidad de hojas ajenas → se decide con la economía (§13).

#### 3.2.5 Recursos del mundo — DECIDIDO: se agotan y se regeneran
Un árbol, una veta, un arbusto de bayas o un banco de peces son **nodos de recurso** en un punto (`spot.contents[]` con `type: resource_node`).
| Campo | Detalle |
|---|---|
| `resource_item_id` | Qué produce (madera, mineral, bayas…) |
| `yield_max` | Cantidad con el nodo al 100% |
| `regen_time` | Tiempo de juego para regenerarse del todo (inicial: **1 día de juego** = 8 h reales) |
| `regen_state` | 0–1, calculado por el servidor desde `last_harvested_at` |
| `skill`, `dc`, `tool_required` | Cómo se extrae (Atletismo + hacha; Supervivencia; Naturaleza…) |
| `destructive` | Si talar lo deja a 0 (árbol) o solo lo reduce (bayas) |

- Extraer da `yield_max × regen_state` de recurso y baja `regen_state` en proporción. A medio regenerar, la mitad de madera; la práctica (§4.11) es la misma.
- Al 0% el nodo sigue existiendo pero no da nada ("solo queda el tocón") hasta que regenera.
- Es estado compartido: si Kael tala el roble, Mira encuentra el tocón, y al día siguiente un árbol joven.
- Tools: `harvest(character_id, node_id)`; el servidor resuelve tirada, rendimiento e inventario.

### 3.3 NPCs (`npcs`)
| Campo | Detalle |
|---|---|
| `name`, `role`, `location_id` | |
| `description` | Físico + 2-3 manías de habla |
| `motivation` | Qué quiere de verdad |
| `secret` | Lo que oculta (enlaza con §3.6) |
| `stats` | Bloque 5e simplificado (AC, HP, ataques) o referencia a monstruo SRD |
| `attitude{}` | Por PJ: `hostile` / `unfriendly` / `neutral` / `friendly` / `allied` — mutable |
| `knowledge[]` | Qué sabe y a qué precio lo cuenta |
| `schedule[]` | Dónde está según hora en juego (opcional pero da vida) |
| `status` | `alive` / `dead` / `missing` |
| `memory[]` | Interacciones relevantes con PJs (el master lo consulta para coherencia) |

### 3.4 Facciones (`factions`)
`name`, `goal`, `resources`, `relations{}` con otras facciones, `reputation{}` por PJ (número). Las acciones de los jugadores modifican reputación vía `update_reputation`.

### 3.5 Misiones (`quests`)
`title`, `giver_npc_id`, `objective`, `steps[]` (cada uno con `done_when`), `reward`, `status` (`available` / `active` / `done` / `failed`), `assigned_to[]` (puede ser compartida). Los pasos se completan por eventos, no porque el master "lo diga".

### 3.6 Secretos (`secrets`)
Tabla aparte, con `unlocked_by[]` (eventos concretos, tiradas, ítems) y `revealed_to[]`. Es la única forma de que el master no filtre la trama. El prompt solo incluye secretos cuyo `revealed_to` contiene al jugador activo.

### 3.7 Lore (`lore`)
Entradas cortas: historia, religión, geografía, lenguas. Tag `common` (cualquiera lo sabe) o `rare` (requiere tirada/fuente). Se inyecta al contexto por búsqueda semántica cuando aparece un término relacionado.

---

## 4. Personaje (`characters`)

### 4.1 Identidad
`name`, `race`, `class`, `subclass` (nivel 3+), `level`, `background`, `alignment`, `appearance`, `age`, `backstory` (máx. 300 palabras — el master la usa para ganchos personales), `personality_traits`, `ideals`, `bonds`, `flaws`.

### 4.2 Estadísticas base
`abilities{str,dex,con,int,wis,cha}` → derivados calculados por el servidor, nunca por el LLM:
- `modifiers{}`, `proficiency_bonus`, `saving_throws{}` (con lista de competentes)
- `skills{}` (18 habilidades: competente / experto / no)
- `armor_class` (calculada según armadura equipada + dex)
- `initiative`, `speed`, `passive_perception`
- `hp_max`, `hp_current`, `hp_temp`, `hit_dice{total, used}`
- `death_saves{success, fail}`

### 4.3 Capacidades
- `features[]`: rasgos de raza/clase con `uses_max`, `uses_current`, `recharge` (`short` / `long` / `dawn`).
- `spells{}`: `slots{level: {max, used}}`, `known[]`, `prepared[]`, `cantrips[]`, `spellcasting_ability`, `spell_save_dc`, `spell_attack_bonus`.
- `proficiencies{}`: armas, armaduras, herramientas, idiomas.

### 4.4 Estado dinámico
- `location_id`, `position_note` (texto: "escondido tras la barra")
- `conditions[]`: `{name, source, expires_at_event | expires_at_time}` — envenenado, invisible, exhausto (con nivel)…
- `concentration` (hechizo activo)
- `gold`, `xp`
- `status`: `active` / `unconscious` / `dead` / `offline` / `retired`
- `last_seen_event_id` — para el `/recap` cuando vuelve

### 4.5 Relaciones
`relationships[]`: con NPCs y otros PJs — `{target_id, type, notes}`. El master lo actualiza cuando pasa algo relevante.

### 4.6 Creación (flujo)
1. Formulario o chat guiado recoge §4.1 y elección de abilities (point buy 27 / array estándar / tirada 4d6 — configurable en campaña).
2. Servidor valida contra JSON Schema de 5e (clase existe, puntos correctos, equipo inicial de clase/trasfondo).
3. Servidor calcula derivados y crea inventario inicial.
4. Master genera un `hook` personal a partir de `backstory` y lo guarda como quest `available`.
5. El PJ aparece en `starting_location` de la campaña y se emite `event: character_joined`.
6. El jugador elige `death_mode` (§4.7). Solo se puede cambiar estando vivo.

### 4.7 Modos de muerte — DECIDIDO
Campo `death_mode` en el personaje, elegido al crearlo.

| | `casual` | `hardcore` |
|---|---|---|
| Al morir | `status: dead`, `respawn_at = now + 2h reales` | `status: dead`, `respawn_at = now + 30 min reales` |
| Durante la espera | Puede leer el chat de su localización, no actuar. Ficción: lo están reanimando | Igual |
| Al reaparecer | Última localización segura, HP completo, inventario intacto | Última localización segura, HP completo, **inventario vacío** y **penalización de características** |
| Inventario | Se conserva | `drop_all_items`: todo cae en `location.contents` donde murió. Otros pueden recuperarlo o saquearlo |
| Penalización | Ninguna | `hardcore_ability_penalty` (propuesta: −1 a dos características que elige el jugador). Se recupera al subir de nivel |

Campos de campaña: `casual_respawn_wait` (2h) y `hardcore_respawn_wait` (30 min), ambos en tiempo real. Al jugador se le muestra el equivalente en juego con el ratio fijo (casual: 6h de juego; hardcore: 1h30 de juego). La narrativa de cada espera se define después.

---

### 4.8 Skills en la creación — DECIDIDO
El jugador nunca escribe skills en texto libre. El servidor tiene las tablas SRD 5e y ofrece solo opciones válidas, por botones:
1. **Trasfondo** → 2 skills fijas + herramienta/idioma según tabla.
2. **Clase** → "elige N de esta lista" (Pícaro 4, Bardo 3, resto 2). Se muestran solo las que no vienen ya del trasfondo.
3. **Raza** → skills o idiomas fijos si los hay (Elfo: Percepción).
4. Expertise (Pícaro/Bardo) → elige entre las que ya tiene.
5. Herramientas e idiomas → mismo esquema.
Resultado: `skills{}` con `proficient` / `expert` por cada una de las 18, calculado por el servidor. En juego, el jugador describe la acción y el master elige la skill vía `roll_check`; el jugador no necesita saber cuál es.

Aprender después: subida de nivel (flujo guiado con botones), entrenamiento con NPC (coste en oro + 10 días de juego ≈ 3-4 días reales), o concesión narrativa (`grant_proficiency`, solo con aprobación del Director).

### 4.9 Consulta de la hoja — DECIDIDO
- `/sheet` efímero, con secciones: Resumen / Combate / Skills / Conjuros / Inventario / Notas.
- **Hoja viva**: el bot mantiene un mensaje fijado en un canal privado por jugador (`#hoja-<nombre>`) que edita automáticamente en cada cambio (HP, condiciones, slots, oro, inventario resumido). Siempre actualizada, siempre en el mismo sitio.
- En la PWA: pantalla de personaje, misma fuente de datos.
- Nadie edita la hoja a mano tras crearla. Solo cambia por tools del master, subida de nivel, equipo, y el campo `notes` del jugador. Todo cambio es un evento → la hoja es reconstruible desde el log.

### 4.10 Acciones, hechizos y dados en el chat — DECIDIDO
Principio: **texto libre siempre disponible; botones donde ahorren esfuerzo.** Los botones nacen de los datos del personaje, no de una lista genérica.

**Hechizos**
- El servidor mantiene un **resolvedor de conjuros**: cualquier mención en texto ("le lanzo una bola de fuego", "curo a Mira", "fireball") se compara con `spells.prepared[]` + `cantrips[]` del PJ (nombre, alias en es/en, y una descripción corta para matches semánticos: "curo" → *Palabra de curación*). Si resuelve, la acción llega al master ya estructurada (`cast: spell_id, target?, slot_level`). Si resuelve a varios, menú de desambiguación. Si el PJ no tiene ese conjuro, el master lo dice en ficción, no lo lanza.
- **Barra rápida**: cada PJ marca hasta **5 conjuros activos** (`spells.quickbar[]`, editable desde `/sheet`). En combate o cuando el master detecta situación de conjuro, aparecen como botones bajo la narración, con el slot que consumen. Los demás preparados siguen accesibles por `/cast` o por texto.
- Conjuros que vienen de ítems (varita, pergamino) se incluyen en el resolvedor mientras el ítem esté en inventario, con sus cargas.
- **Intención antes de efecto.** Un conjuro (y en general cualquier acción con consecuencias) **no se ejecuta hasta que tiene sentido**. Si falta objetivo, dirección o propósito, el master pregunta antes de que pase nada y no se consume slot, tiempo ni recurso. "Bola de fuego" andando por un camino vacío → "¿Hacia dónde, y con qué intención? No ves a nadie." El servidor lo apoya: `cast` sin `target` válido para conjuros que lo requieren devuelve `needs_intent` y el master pregunta con botones (objetivos visibles + "Otra cosa…"). Solo con la intención clara se descuenta el slot y se resuelve. Lo mismo para acciones ambiguas ("ataco") sin objetivo.
- Excepción: conjuros sin objetivo (luz, detectar magia, escudo) se lanzan directamente; y en combate, un objetivo obvio único no requiere pregunta.

**Acciones**
- El master devuelve `suggested_actions[]` (2-4) cuando la situación lo pide. Se generan **a partir del personaje**: clase, `personality_traits`, `ideals`, `bonds`, `flaws`, y lo que tiene a mano (ítems en manos/bolsillos, quickbar). Un pícaro con el defecto "codicioso" verá "registrar el cadáver" antes que "rezar por él". Así los botones son lo que *ese* personaje haría y lo que no haría no aparece.
- Siempre hay un último botón **"Otra cosa…"** que abre texto libre. Escribir directamente en el `#pov` sin pulsar nada también funciona.
- Pulsar un botón envía la acción como texto normal por la cola; no es una vía distinta.

**Dados**
- Cuando una acción requiere tirada, el master **no tira solo**. Devuelve `requires_roll: {type, ability/skill, dc_hidden}`; el bot muestra **🎲 Tirar**. Al pulsar, el servidor tira (`roll_check`), enseña el desglose (d20 + modificadores) y el master narra la consecuencia. Sin pulsar, la acción queda pendiente (timeout en combate → tira automáticamente).
- Tiradas ocultas del master (percepción pasiva, sigilo de NPCs) van sin botón.

### 4.11 Progresión — DECIDIDO: se aprende como en la vida
Tres fuentes con pesos distintos. Lo básico no sube nada; la práctica repetida de algo concreto mejora ese algo; el combate da más; resolver trama da lo más.

**A) Aprendizaje por uso (mejora de habilidades concretas, no de nivel).**
- Cada skill, herramienta, arma y idioma tiene un contador de práctica `practice{key: n}` en el PJ.
- Suma práctica un uso **significativo**: una tirada con CD ≥ 10. Repetir vale: cada tala, cada forja, cada tirada real cuenta lo mismo. Lo básico (andar, abrir puertas, hablar) nunca cuenta. `max_practice_per_day` existe como tope de seguridad, alto por defecto.
- **El límite lo pone el mundo, no la experiencia**: los recursos se agotan y se regeneran (§3.2.5). Talar el mismo árbol a medio regenerar da la misma práctica pero menos madera.
- Al alcanzar umbrales (`practice_thresholds`, ej. 10 / 30 / 60) se obtiene: competencia si no la tenía → +1 → +2 (tope +2 por esta vía). Fuera de la subida de nivel; la complementa.
- **Leer**: los libros son ítems con `teaches: {key, hours_required}`. Leer es una acción que consume tiempo de juego; al completar las horas, práctica o competencia directa (idiomas, saberes, herramientas).
- **Entrenar con NPC** (§4.8) sigue siendo la vía rápida y cara.

**B) Combate**: XP 5e por criatura derrotada, repartida entre los presentes que participaron, escalada por `xp_multiplier_combat` (inicial 1.0).

**C) Trama e hitos**: el Director otorga XP al resolver hilos (`resolve_thread` → `grant_xp`), proporcional al horizonte: `immediate` medio, `near` grande, `far` muy grande. Es la mayor fuente, y también la más difícil.

**Nivel**: umbrales 5e estándar. Subir de nivel abre el flujo guiado (§4.8). El aprendizaje por uso no da XP de nivel; da mejoras concretas.

Todos los pesos en `campaign.progression` para tunearlos con la validación.

---

## 5. Ítems e inventario

### 5.1 Catálogo (`items`)
| Campo | Detalle |
|---|---|
| `name`, `description` | |
| `type` | `weapon` / `armor` / `consumable` / `tool` / `quest` / `treasure` / `misc` |
| `rarity` | common → legendary |
| `weight`, `value_gp` | |
| `properties` | Weapon: `damage`, `damage_type`, `range`, `tags` (finesse, two-handed…). Armor: `ac_base`, `type`, `stealth_disadvantage`. Consumable: `effect` (estructurado: `{heal: "2d4+2"}`), `uses` |
| `attunement` | bool |
| `magic_effects[]` | Modificadores mecánicos estructurados (`+1 attack`) + descripción narrativa |
| `unique` | bool — un solo ejemplar en el mundo |
| `origin` | `srd` / `custom` |

### 5.2 Inventario (`inventory`)
`character_id`, `item_id`, `quantity`, `equipped` (slot: main_hand, off_hand, armor, ring1…), `attuned`, `identified` (para magia desconocida), `notes`.

Reglas del servidor: carga máxima, slots de equipo válidos por tipo, límite de 3 sintonizaciones. Si el master intenta equipar algo inválido, el tool devuelve error y el master renarra.

### 5.3 Ítems en el mundo
Un ítem siempre está en **exactamente un sitio**: inventario de un PJ, inventario de un NPC, o `location.contents`. Mover = transacción atómica. Así nunca hay duplicados ni desapariciones.

---

### 5.4 Capacidad — DECIDIDO: nada es infinito
Tres reglas de servidor (el master nunca decide si algo cabe):

**1. Tamaño y peso por ítem.** `size`: `tiny` (moneda, anillo, llave) / `small` (poción, daga, libro) / `medium` (espada, cuerda, escudo) / `large` (armadura, arco largo) / `bulky` (cofre, cadáver, barril: dos manos, no cabe en nada). `weight` en libras (5e). Monedas: 50 = 1 lb.

**2. Contenedores anidados.**
| Contenedor | Capacidad | Acceso en combate |
|---|---|---|
| Manos (2) | 1 ítem cada una, o 1 `bulky` en las dos | Instantáneo |
| Equipado (cabeza, cuerpo, manos, pies, cuello, anillo×2, espalda, cinturón) | 1 por slot | Ya puesto |
| Bolsillos / cinturón | 4 slots, solo `tiny`/`small` | Instantáneo |
| Mochila / bolsa / alforja | Según el ítem (mochila: 20 slots, 30 lb) | Cuesta una acción |
| Contenedores mágicos | Bolsa de contención: 500 lb, slots ilimitados hasta `medium` | Acción |
| Alijos en el mundo | Cofre de posada, casa, banco del gremio (contenedor fijo en un `spot`) | Solo estando allí |
| Monturas / carros | Contenedor móvil con `location_id` propio | — |

Sin mochila solo hay manos, bolsillos y equipado.

**3. Carga por Fuerza.** Máximo `Fuerza × 15 lb`. 5×–10×: cargado (velocidad −10). 10×–15×: muy cargado (−20, desventaja Fue/Des/Con). >15×: no te mueves.

`inventory.container_id` apunta al contenedor (o `hands` / `pockets` / slot de equipo). `transfer_item` valida tamaño, slots y peso; si falla devuelve `error: no_space` con las opciones y el master lo narra ("no te cabe, ¿sueltas algo o lo llevas en la mano?").

### 5.5 Consumo de recursos — DECIDIDO: se gastan como en la vida, pero más despacio
Todo lo consumible se consume de verdad, con **ritmos ajustados para que sea disfrutable**, no una simulación. Cada ítem consumible tiene `consumption_rule` en la DB, así se afina sin tocar código.

| Recurso | Cómo se gasta | Ritmo inicial (ajustable) |
|---|---|---|
| Antorcha / aceite | Por tiempo de juego mientras está encendida (`lit: true`) | 1 antorcha = 2 h de juego (40 min reales) |
| Raciones | Por tiempo de juego | 1 ración cada 2 días de juego (16 h reales). Sin comer 3 raciones seguidas → nivel de agotamiento |
| Agua | Igual que raciones | Abstraída junto a la ración salvo en desierto/zonas marcadas |
| Munición | Por uso | Tras el combate se recupera el 50% de lo disparado (regla 5e) |
| Pociones / pergaminos | Por uso | — |
| Componentes de conjuro | Abstraídos en la bolsa de componentes, salvo los que tienen coste en oro | — |
| Piensos de montura | Por tiempo de juego | 1 cada 2 días de juego |

- El servidor descuenta por cron; el jugador recibe avisos en su `#pov` ("la antorcha empieza a chisporrotear", "hace tiempo que no comes"), no un contador seco.
- Ritmos y umbrales viven en `campaign.consumption_rates` para tunearlos con la validación.

### 5.6 Economía — DECIDIDO como punto de partida del MVP (se analiza con datos reales)
El valor y el esfuerzo tienen que sentirse como en el mundo real: ni hacerse rico en una tarde, ni que 20 € parezcan calderilla.

- **Ancla**: `1 € ≈ 10 monedas`. 20 € = 200 monedas. Se puede comprar algo más que en la realidad (el factor `purchasing_power`, inicial 1.3), pero el esfuerzo es equivalente.
- **Moneda**: una sola unidad de cuenta ("monedas") con tres denominaciones para flavor y peso: cobre = 1, plata = 10, oro = 100. Los precios se muestran en la denominación natural ("3 de oro y 40 de plata"). Peso: 50 monedas = 1 lb en cualquier denominación → llevar 20.000 monedas en cobre es un problema, en oro no.
- **Precios**: tabla propia anclada a equivalentes reales × `region_multiplier`, **no** la del SRD. Referencias iniciales: cerveza 30 · comida en taberna 120 · noche en posada 500 · mochila 400 · antorcha ×10 = 80 · poción de curación 2.500 · espada corta 3.000 · cota de malla 15.000 · caballo 25.000.
- **Ingresos**: un encargo de un día paga como un jornal real (800–1.000). Quests secundarias: 1–5 jornales. Hilos de trama: más, pero pocos. Botín de combate: lo que llevaban, no bolsas de oro mágicas.
- **Sumideros**: alojamiento, comida, reparaciones, entrenamiento, monturas, alijos alquilados, impuestos/peajes de facción.
- **Oro inicial**: como un adulto joven con ahorros modestos: 1.500 (150 €) tras el equipo de clase.
- **Tiendas**: son NPCs con `stock[]` (`item_id, qty, price_override?`), horario, `buys[]` (qué compran y a qué % del precio, inicial 40%). Reposición por línea secundaria recurrente. Regateo: una tirada de Persuasión por compra, ±10% máx.
- **Comercio entre jugadores**: `transfer_item` en el mismo punto con **confirmación de ambos** (botones en cada `#pov`); intercambio de monedas igual. Sin mercado global ni buzón en el MVP: si no está, no puedes.
- **Botín**: quien coge el ítem lo tiene (mismo punto, orden de la cola). Sin sistema de reparto.
- Todo en `campaign.economy` para ajustarlo con la validación.

---

## 6. Log de eventos — el corazón del sistema

Cada cambio del mundo es un evento inmutable:

```
id, timestamp_real, timestamp_game, campaign_id, location_id,
actor_id (pj/npc/master), action_type, input_text (lo que escribió el jugador),
rolls[] {expr, result, dc, success}, tool_calls[] (qué cambió),
narration (lo que respondió el master), visibility (public/location/private),
tags[] (combat, social, quest:xxx, npc:yyy)
```

Derivados del log (se regeneran, nunca se editan a mano):
- `location_summary` por localización: últimos 20 eventos + resumen de todo lo anterior.
- `character_journal` por PJ: resumen en su voz de lo vivido (y sirve de `/recap`).
- `campaign_chronicle`: cronología global de hitos (`tags: milestone`).
- `npc.memory` y `secrets.revealed_to` se actualizan por triggers sobre eventos.

---

## 7. Tools del master (contrato exacto)

Lectura (sin efectos):
- `get_character(id)`, `get_location(id)`, `get_npc(id)`, `get_item(id)`
- `get_recent_events(location_id, n)`, `search_lore(query)`, `get_quest_status(id)`
- `who_is_here(location_id)`

Dados (el servidor tira):
- `roll_dice(expr, reason, dc?, advantage?)` → `{result, breakdown, success?}`
- `roll_check(character_id, skill|save|attack, dc, advantage?)` — aplica modificadores automáticamente
- `roll_initiative(location_id)` — arranca modo combate

Escritura (efectos):
- `apply_damage(target_id, amount, type, source)` / `heal(target_id, amount)`
- `add_condition(target_id, condition, duration)` / `remove_condition(...)`
- `use_resource(character_id, feature|spell_slot, level?)`
- `move_to(character_id, target_spot_id, pace)` — el servidor calcula tiempo y ruta (§3.2.3)
- `update_location_state(location_id, patch)`
- `transfer_item(item_id, from, to, quantity)` — from/to = character/npc/location
- `spawn_item(item_def, into)` (solo si `improvisation` lo permite) / `spawn_npc(npc_def, location_id)`
- `update_npc(npc_id, patch)` (attitude, status, memory, location)
- `update_reputation(character_id, faction_id, delta)`
- `update_quest(quest_id, step_done | status)`
- `reveal_secret(secret_id, character_id)`
- ~~`advance_time`~~ — eliminado: el tiempo lo lleva el servidor (§1.3). Horarios de NPC, líneas secundarias y expiración de condiciones se disparan por cron
- `grant_xp(character_ids[], amount)` / `milestone(character_ids[], label)`
- `log_event(summary, tags[], visibility)` — cierre obligatorio de cada turno

Combate (interno del master, §9.3):
- `open_combat(location_id, participants[])`, `join_combat(combat_id, id)`, `close_combat(combat_id)` — solo para agrupar HP/condiciones; no bloquean acciones.
- `roll_initiative` se usa solo como desempate.

---

## 8. Ensamblado del prompt por acción

Orden fijo, con presupuesto de tokens por bloque:
1. System: persona + guardrails + reglas de campaña (§1.2, §2).
2. `campaign_chronicle` (resumen global, ~500 tokens).
3. Localización actual completa (§3.2) + `location_summary`.
4. NPCs presentes (solo los campos visibles: sin `secret`, sin `motivation` si no revelada).
5. Todos los PJs presentes en la localización (hoja resumida: nombre, aspecto, HP aproximado, condiciones visibles).
6. Hoja completa del PJ que actúa.
7. Secretos con `revealed_to` que incluya a ese PJ.
8. Quests activas del PJ + hilos `immediate` que involucren la localización o al PJ (§3.1). Nunca hilos `near`/`far` ni la Biblia no revelada.
9. Últimos N eventos de la localización (raw).
10. Estado de combate si hay.
11. Mensaje del jugador.

Instrucción final: "Resuelve solo esta acción. Usa tools para cualquier cambio. Termina con `log_event`."

---

## 9. Modos de juego y concurrencia

| Modo | Quién puede actuar | Cómo se procesa |
|---|---|---|
| Exploración | Cualquiera en la localización | Cola FIFO por localización, una acción a la vez |
| Social | Igual que exploración | Igual; el master mantiene diálogo con memoria de NPC |
| Combate | Cualquiera implicado | Conversación sin prisa; orden por respuestas, iniciativa solo como desempate (§9.3) |
| Descanso | Individual | Dormir = descansar (§9.1). No bloquea a nadie; interrumpible |
| Viaje | El que se mueve | `in_transit` con ETA calculada (§3.2.3); interrumpible; al llegar `event: arrived` |

### 9.1 Desconexión = dormir donde estás — DECIDIDO
- Al desconectar (o al decir "me duermo"), el PJ pasa a `status: asleep` **en el punto exacto donde está** y no se mueve hasta que el jugador vuelve. No hay refugio automático.
- **Velo — DECIDIDO.** Un PJ cuyo jugador está **desconectado** queda envuelto en un velo protector (no ilumina, no llama la atención; en ficción, una bendición del mundo sobre los que duermen). Bajo el velo **no puede recibir daño ni morir**. Sí sigue siendo visible y sí sigue expuesto a robo salvo que se haya protegido (candados, llaves escondidas, habitación cerrada). **Confirmado: el velo protege la vida, no las pertenencias.**
- **Conectado pero dormido en el juego** (el jugador eligió dormir y sigue con Discord abierto): sin velo. Puede ser atacado o robado. Si algo le pasa, recibe **notificación** (mención en su `#pov` + DM de Discord) y se abre una ventana de respuesta decisiva (§9.3) para despertar y reaccionar; si no responde, se resuelve en su contra. Un carruaje puede pisarte si duermes en el camino.
- **Conectado** = presencia de Discord `online`/`idle` **o** alguna acción en los últimos 30 min. Sin ninguna de las dos, el servidor pone el velo. Al volver (mensaje o presencia), el velo cae.
- Protección realista, con ítems y estado del mundo: cerrar puerta y ventanas con llave (`spot.state.locked`), candado en la mochila (`inventory.locked_by: item_id`), esconder la llave (ítem `hidden` en un punto con `dc_to_find`), dormir en una posada (habitación = localización privada con cerradura), turnos de guardia entre jugadores del mismo punto.
- Robar a un dormido (con o sin velo): tirada de Sigilo contra la Percepción pasiva del durmiente (×0.2, §9.2). Si falla, el durmiente se despierta (`event: woken`) y recibe notificación. Con éxito, no se entera hasta despertar. Se registra como crimen con testigos según radios de percepción (§9.4).
- Lo que pasa mientras duermes se registra; al volver, el `/recap` te lo cuenta desde tu punto de vista ("te despiertas con la mochila abierta").
- Dormir es también el **descanso**: no hay acción "descansar" separada. Descanso largo = 8h de juego dormido (2h40 reales) en las que nadie te despierta. Si te despiertan, el descanso se interrumpe (regla 5e: 1h de interrupción lo cancela). Un "lugar seguro" no es un tipo de sitio: es un sitio que has asegurado físicamente.
- Descanso corto: acción explícita de 1h de juego (20 min reales) despierto en el punto; interrumpible.

### 9.2 Luz, ruido y percepción — DECIDIDO: radios realistas por jugador
Cada PJ tiene, en cada momento, un **radio de percepción** y un **radio de audición** calculados por el servidor; el enrutado POV (§11.2) usa esos radios para decidir qué ve y qué oye.
- `radio_vision_m = base × factor_luz × factor_skill`. Base: 30 m en un espacio abierto de día. `factor_luz`: día 1 / crepúsculo 0.5 / noche con luna 0.25 / noche cerrada 0.05 / antorcha propia 0.2 + 10 m fijos. Visión en la oscuridad (razas) ignora hasta 18 m. Intensidades de luna → v2.
- `radio_audicion_m = base × factor_ruido_ambiente × factor_skill`. Base: 20 m para conversación normal, 100 m para un grito, 300 m para campanas. Lluvia, mercado, combate reducen.
- `factor_skill` sale de Percepción pasiva: 10 → 1.0; cada punto ±5%. Un explorador con 17 ve y oye un 35% más lejos. Dormido: ×0.2.
- Dentro de una localización cerrada, paredes y puertas cerradas cortan visión y reducen audición (`spot.links[]` con `blocks_sight`, `muffles`). Entre localizaciones solo pasa lo `visibility: public`.
- **Degradación por distancia, no corte seco.** El radio marca hasta dónde percibes *bien*; más allá, la percepción se degrada por bandas hasta un límite, y el master narra con el nivel de detalle que corresponde:

| Distancia (× radio) | Visión | Audición |
|---|---|---|
| 0 – 1 | Detalle completo: quién es, qué hace, qué lleva | Palabras y tono |
| 1 – 2 | Reconoces forma y acción, no identidad ni detalle ("una figura se agacha junto al roble") | Oyes que hablan y el tono, no las palabras |
| 2 – 3 | Solo presencia y movimiento ("algo se mueve entre los árboles") | Un ruido, sin saber qué |
| > 3 | Nada | Nada (salvo `visibility: public`) |

  El servidor calcula la banda y la pasa al master como `perception_level: full / vague / hint / none` por cada entidad presente; el master **solo puede narrar hasta ese nivel** (no puede nombrar a quien está en banda `vague`). Acercarse, una tirada de Percepción, o un catalejo suben de banda. Dentro de la banda `full`, lo sutil (susurro, alguien escondido) sigue requiriendo tirada.
- Lo que está en banda `none` no aparece en tu `#pov`.
- Todos los factores viven en `campaign.perception_rules` para tunearlos.

### 9.3 Combate — DECIDIDO: conversación, no turnos cronometrados
- El combate **empieza de forma natural** en la narración; no hay `start_combat` explícito para el jugador. El master lo marca internamente (`combat_id`) para llevar HP, condiciones y quién está implicado.
- **Sin prisa**: es una conversación. El orden lo dan las respuestas de los jugadores y el master adapta el tiempo narrativo a ellas. La iniciativa 5e se tira, pero solo como **desempate** cuando dos respuestas llegan a la vez o para decidir si un NPC actúa antes.
- **Quien llega a un combate en curso**: el master decide en el momento cómo encaja su primera acción (sorpresa, se une, es atacado, pasa de largo) según lo que haga y desde dónde llega. Sin regla fija.
- Huir = `move_to` normal; los enemigos pueden perseguir según velocidad (§3.2.3).
- Enemigos: los mueve el master con bloques SRD; sus tiradas son ocultas.
- **Los NPC hostiles actúan siempre en su turno — DECIDIDO (bloque D, 2026-10-27).** Cada turno del combate (la acción de un jugador, o la ronda entera si hay varios), cada NPC hostil que sigue en pie, suelto y en la misma localización que un PJ del turno hace su turno: un `attack` con su **multiataque** entero (matón, explorador y veterano del SRD: 2 golpes). Si el máster no lo hace, lo hace el motor al cerrar (`forceNpcTurns`, combat.ts): resuelve el ataque (el que pelea cuerpo a cuerpo se lanza hasta su objetivo), rechaza el cierre una vez con el resultado para que el máster lo cuente y, si aun así no lo cuenta, lo añade a la narración. Un NPC actúa una vez por turno (`attack` dos veces da error). No cuenta el cierre que pide una tirada (el turno acaba al tirar) ni el NPC de la ventana decisiva que se abre. Entran también los que intervienen por un crimen (§9.4): la víctima que se defiende, el allegado que pelea y la autoridad si te resistes; el resto de la autoridad acude como apoyo. Quien pelea no sigue su horario.
- **Golpe no letal — DECIDIDO.** Un PJ que deja a un NPC a 0 PG con un arma contundente, los puños o diciendo «pegar», «golpear» o «reducir» le deja **inconsciente**, no muerto (`status: 'unconscious'`, `knockOutNpc`). Muere si el jugador dice que quiere matar, si el arma corta o perfora y no dice lo contrario, o si remata a quien ya está en el suelo. Lo decide el servidor por el texto de la acción y el tipo de daño (`lethalBlow`). El inconsciente vuelve en sí con 1 PG a las 2 h de juego o si le curan; se le puede atar (`restrain_npc`: atado no se mueve ni pelea), registrar (si alguien lo ve, es un robo) o rematar (impacta solo y le mata: muerte grave, sin PX). Vencer a quien atacaste sin motivo no da PX.
- **Nadie es inmortal.** No hay NPC `essential`: lo que sostiene la trama tiene su plan B en los datos (`on_npc_dead`, misiones). El motor emite `npc_death` (`payload.death.fate: 'dead'`) y `npc_down` (`payload.down.fate: 'unconscious'`) con la causa y quién fue; `npcFate(n)` (death.ts) lo da sin leer eventos.
- **Bloques por rol.** Como el motor hace pegar a todo NPC hostil en cada turno, un adulto fuerte de campaña lleva un golpe fuerte por turno, no el multiataque del matón: con él, un PJ de nivel 1 solo pierde casi siempre. En Brezal, el herrero (mandil, CA 12; martillo de fragua 1d8+2; 22 PG) lo gana un guerrero el 66 % de las veces y un mago el 38 %, en 3–5 turnos.
- Dos combates en puntos distintos de la misma localización: dos `combat_id` en la misma cola; el master narra cada uno a sus participantes; pueden fusionarse si se acercan.
- **Modo "respuesta decisiva" — DECIDIDO.** En un momento crítico (hacha que cae, puente que cede), el master abre una ventana: evento `decisive: true`, `window_s` (60 s), mostrada en los `#pov` implicados con contador y los botones de acciones sugeridas. El mundo sigue, pero la localización queda `suspended`: sin eventos de líneas secundarias ni llegadas externas hasta resolverla.
  - **Contra la máquina** (NPC, trampa, entorno): no se compara velocidad con nadie; cuenta el tiempo de respuesta del jugador contra umbrales (`campaign.decisive_thresholds`, inicial 15/60 s):

    | Respuesta | Efecto |
    |---|---|
    | Rápida (< 15 s) | Ventaja en la tirada o actúa antes de que la amenaza se resuelva |
    | Normal (15–60 s) | Acción y amenaza se resuelven a la vez; decide el dado |
    | Expirada (> 60 s) | La amenaza se resuelve **contra el PJ** sin que actúe: daño completo. Después puede actuar sobre la nueva situación |
  - **Con varios jugadores** (misma amenaza, o PJ contra PJ): lo anterior para cada uno **y además** el orden de llegada de las respuestas es el orden narrativo; los recursos disputados (la única cuerda, el último golpe) van al primero.
  - **No responder es perder de verdad**: no actúas, la amenaza se ejecuta completa; a 0 HP entran las reglas de muerte. Sin excepción por AFK.
  - **Sin cadena**: tras una ventana sin respuesta, el master no abre otra a ese PJ; lo trata como §9.1 (aturdido, expuesto) y el combate se resuelve en su contra. Lo verá en `/recap`.
  - Solo se abre con riesgo real e inmediato validado por el servidor (enemigo con acción pendiente contra ese PJ o `spot.state` peligroso activo); nunca dos seguidas al mismo PJ; máximo `max_decisive_per_combat`. El resto del combate es conversación sin prisa.

### 9.4 Jugador contra jugador, crimen y ley — DECIDIDO: como en la vida real
**Permitido: todo.** Robar, atacar, matar y traicionar a otro PJ, mientras esté conectado (dormido en el juego incluido). Solo el velo (§9.1) protege la vida del desconectado; sus pertenencias siguen expuestas. Sin límites de convivencia en el MVP: libre albedrío para validar cómo funciona; se ajusta si hace falta (§13).

**Alianzas.** Ir juntos no necesita nada: es estar en el mismo punto. Pero una alianza puede **formalizarse** como compañía (§9.5) para tener reconocimiento y peso en una ciudad. Formal o no, traicionar sigue siendo una acción más.

**Crimen (`crimes`).** `{type: theft / assault / murder / vandalism, victim_id, perpetrator_id, location_id, spot_id, time, witnesses[], evidence[]}`.
- Testigos = quien tenía al hecho en su radio de percepción (§9.2): en banda `full` conoce la identidad; en `vague` sabe que "alguien" lo hizo (descripción parcial, sin nombre); en `hint`/`none`, nada.
- Sin testigos ni pruebas no hay crimen conocido: la víctima sabe que le han robado, no quién.
- Pruebas: ítems `unique` son rastreables (te ven con la espada de Mira); sangre, huellas y objetos olvidados quedan en `spot.state` y pueden investigarse con tiradas.
- Identidad: capucha/disfraz (`inventory.equipped` con `conceals: true`) baja la identificación de `full` a `vague`; un nombre falso solo engaña a quien no te conocía.

**Guardias.** NPCs con `role: guard`: radio de percepción ampliado (`factor_skill` alto, "más atentos") y `patrol[]` por horario. Si un guardia tiene un crimen en su radio, o un testigo/NPC se lo cuenta, o hay prueba que te señala → `wanted{zone_id, level, reasons[]}` para el perpetrador.
- Con `wanted` en una zona: los guardias te detienen si te ven (según su radio y tu disfraz); tenderos y posadas te rechazan si te reconocen; NPCs afines a la víctima cambian `attitude`.
- Detenido: se resuelve como combate/persuasión normal; si te cogen, **castigo** según gravedad: multa (economía, §5.6), cárcel (X horas de juego encerrado en una localización `cell`; irónicamente, un lugar seguro), o trabajos forzados (quest impuesta).
- **Recompensa (`bounties`)**: para `murder` o `wanted` alto, la facción publica en `#tablon` lo que se sabe: nombre si algún testigo estaba en `full`, descripción si en `vague`. Cualquier PJ puede cobrarla entregando al buscado vivo o muerto. Es el regulador natural del PvP.

**Venganza.** Sin mecánica. La víctima puede ir a por ti; tú también. Es juego.

**Limpiar tu nombre — lento a propósito.**
- Pagar la multa o cumplir la condena baja `wanted` a 0 en esa zona, pero **no** recupera la reputación.
- Sin reincidir, `wanted` decae `wanted_decay_per_day` (inicial: 1 nivel cada 3 días de juego ≈ 1 día real). La gente olvida, despacio.
- Reputación con la facción se recupera con quests para ella, a razón de `rep_gain_per_quest` (inicial: 1 punto por quest secundaria; un asesinato cuesta 10). No hay atajos: ni comprar reputación ni farmear una quest repetida (cada quest suma una vez).
- Todo en `campaign.law` para tunearlo con la validación.

**Tools:** `register_crime(def)`, `set_wanted(character_id, zone_id, level, reasons)`, `post_bounty(def)`, `claim_bounty(bounty_id, by, target)`, `serve_sentence(character_id, type, duration)`.

**Hecho: crímenes contra NPC (`src/engine/crime.ts`, revisión de la partida del 2026-10-27).** Lo garantiza el motor; el máster solo lo cuenta.
- **Incidente** (`campaign.incidents`): tipo y gravedad (insulto 1, robo 2, agresión 2, agresión con arma 3, profanar un cadáver 3, muerte 5), sitio, autor, víctima, la gente de la agenda que había y quién lo sabe. La violencia contra la misma víctima sube dentro del mismo incidente (agresión → con arma → muerte); robar o profanar es otro.
- **Lo detecta el motor**: un golpe (`attack`, o `apply_damage` del actor, conjuros incluidos) a un NPC que no era hostil con él; la muerte que sigue; registrar o saquear el cadáver de un NPC («robar las posesiones del herrero»); un insulto dicho a la cara; quitarle algo a alguien con `transfer_item` y un verbo de robar (salvo que la tirada lo haya hecho sin que se note). Lo demás, el máster con `report_incident`. Quien ataca primero a un PJ pasa a hostil: devolverle el golpe no es crimen.
- **Testigos**: los NPC vivos de la localización; lo violento se oye en toda la sala, lo callado solo se ve de cerca (12 m, sin pared de por medio).
- **Reacción por papel**, con los datos de campaña (`campaign.law`, `npc.bonds`): la víctima pelea o grita; la **autoridad** (`law.enforcers`; sin ellos, el rol de guardia) da el alto y detiene; los **allegados** de la víctima se meten (`bond.reaction: 'fight'`) o guardan luto; el **dueño** del local (`law.owners`) no sirve ni aloja; la **gente corriente** corre a avisar a la autoridad (orden `go` real hacia ella; el primero que puede, o el `brave`), huye (`timid`) o grita. Si nadie con nombre avisa y había gente de la agenda, a los 10 min de juego alguien avisa igual.
- **Consecuencias**: actitud (hostil quien se mete; los demás, a recelar como poco) y memoria de cada testigo; reputación con `law.faction_id` −gravedad; condición **`buscado`** con su motivo en cuanto la autoridad lo sabe; rumor en el sitio; nadie que lo sepa le vende, le compra, le fía ni le aloja (`refusesService`); **ningún descanso seguro** (ni con llave) si alguien que lo sabe le ha visto en esa localización en las últimas 12 h: la autoridad viene y le despierta; matar a quien no era hostil **no da PX**, da **infamia** (también profanar un cuerpo).
- **La noticia corre** con las rutinas y la agenda: quien llega al sitio mientras se ve lo que pasó (el cuerpo, la primera hora) se entera, y quien coincide en una localización con alguien que lo sabe, también; el rumor viaja con ellos. La autoridad que lo sabe va a donde le vieron por última vez.
- **En el acto**: tras la acción el motor emite `npc_death` (si hay muerte), `incident` (la reacción de cada presente; quien se mete queda hostil y entra en el encuentro) y `arrest` (el alto, solo al autor, con «Entregarme / Resistirme / Huir»). Entregarse: calabozo (`law.jail_spot_id`, horas por tipo) o multa (`law.fines`); resistirse, atacar o huir: la autoridad pasa a hostil y pelea; caer ante ella: calabozo, estabilizado. Preso no se mueve hasta cumplir (su reloj: dormir hace pasar el tiempo).
- **El máster**: el contexto pone el «Incidente pendiente» con lo que hace cada uno, un bloque «Ley» (buscado, detenido, preso, infamia) y, en cada NPC que lo sabe, «LO PRIMERO» antes que su carácter. El control de cierre rechaza (dos veces) el turno que no nombre a quien da el alto o se mete, ni a ninguno de los que reaccionan. Los ganchos que saltan en un sitio con un incidente reciente llevan el aviso de adaptarse.
- **Pendiente**: crímenes entre PJ (hoy son reacciones), disfraces y testigos a medias (`vague`), recompensas en el tablón, que `wanted` decaiga con los días. Que los NPC hostiles ataquen solos en su turno es del combate (bloque D).

### 9.5 Compañías — DECIDIDO: alianzas formales creadas por jugadores
Facciones creadas por jugadores, en la misma tabla que las del mundo: `factions{type: company}`.

**Fundación.** Acto público: registro en el gremio o ayuntamiento de una zona (NPC `role: registrar`), con nombre, emblema (texto) y cuota `company_fee` (§5.6). Mínimo `min_members` (inicial 3) presentes en el mismo punto para firmar. Se crea con `founded_at`, `home_zone`, `members[]`, `roles{}` (fundador / miembro) y se anuncia en `#tablon`.

**Qué da ser oficial.**
- `reputation{}` propia con las demás facciones, separada de la individual. Los NPCs reconocen el emblema y tratan según ella; las quests pueden ofrecerse *a la compañía*.
- Patrimonio: alijo de compañía (contenedor fijo en su sede alquilada/comprada) y `treasury` con reglas de retirada que fijan ellos (`withdraw_policy`: fundador aprueba / cualquiera).
- Peso en la ciudad: reputación alta → descuentos, accesos y contratos que no se dan a individuos; baja → más atención de los guardias.
- Nombre en la crónica pública y en las líneas secundarias del Director.

**Reputación.** Lo que hace un miembro afecta a la compañía × `member_to_company_ratio` (inicial 0.5) si lleva el emblema o se le identifica como miembro (§9.4); la reputación de la compañía modula cómo se trata a cada miembro.

**Traición.** Posible, sin protección mecánica. Un crimen contra un miembro o contra el alijo tiene **agravante**: evento interno a todos los miembros, y la expulsión es un acto público en `#tablon` que deja al expulsado como `former_member` con reputación negativa con la compañía.

**Entrar / salir / disolver.** Entrar: invitación de un miembro con derecho (`roles`) + presencia. Salir: acción pública en el registro. Disolución automática si baja de `min_members` durante `dissolve_after_days` (inicial 10 días de juego); el patrimonio pasa al gremio. Rivalidad/alianza entre compañías = solo reputación mutua.

**Fuera del MVP:** rangos elaborados, guerras entre compañías, territorios.

**Tools:** `found_company(def, founders[])`, `invite_member`, `leave_company`, `expel_member`, `deposit_treasury` / `withdraw_treasury`, `update_faction_reputation` (ya existe para facciones).

### 9.6 Diálogo con NPCs — DECIDIDO: un NPC habla con uno cada vez
- Cada NPC tiene una **cola de conversación**: `talking_to: character_id | null`.
- Si B le habla a un NPC ocupado con A, el NPC responde en ficción ("espera un momento, estoy con este") y B queda en cola. El NPC pasa a B cuando A termina, se aleja, o el NPC decide dirigirse a B.
- B sí puede hablar con A directamente (jugador a jugador, mismo punto) mientras espera, y oye la conversación si está en su radio de audición (§9.2).
- El NPC puede romper la regla si tiene motivo (B saca un arma, B es su hijo, B grita): lo decide el master.
- `npc.memory` guarda ambas conversaciones por separado.

Broadcast: cada evento se entrega **por punto de vista**: el servidor calcula qué PJs lo perciben (mismo punto, línea de visión, rango de audición, `visibility: public`) y solo a ellos se lo envía. No hay canal de localización; la localización sigue siendo la unidad de cola de acciones.

---

## 10. Casos límite que hay que decidir antes de construir

- **Jugador desconectado en combate**: su PJ cae aturdido en el sitio; tras 30 min sin acción entra el velo (§9.1) y deja de ser objetivo válido. Hasta entonces, expuesto.
- **Jugador ausente días**: sigue dormido donde se desconectó (§9.1), sujeto a lo que pase; al volver recibe `/recap` desde `last_seen_event_id`.
- **Muerte**: según `death_mode` del personaje (§4.7). Nunca hay muerte permanente; hardcore pierde inventario y características, no el personaje.
- **PJ solo vs. grupo**: el master adapta dificultad por número de PJs presentes (`difficulty` × factor).
- **Dos jugadores discuten el mismo objeto**: el orden de la cola decide; `transfer_item` es atómico.
- **Tiempo de juego divergente**: si A viaja 2 días y B no, el mundo avanza al máximo de los dos y B "esperó" narrativamente. Alternativa más simple: tiempo global único que solo avanza cuando todos los presentes lo aceptan.
- **Contenido que rompe el rating**: el tool devuelve error, el master narra una consecuencia alternativa.
- **Coste de LLM**: acciones triviales (`/sheet`, mirar inventario) no pasan por el modelo; cachear la parte estática del prompt.

---

## 11. Arquitectura de cliente — DECIDIDO: Discord primero, PWA después

Regla de oro: **el motor de juego no sabe qué cliente lo usa.** Discord es un adaptador; la PWA será otro. Nada de lógica de juego vive en el bot.

```
[Discord bot]  ──┐
                 ├──▶  Game API (HTTP + WebSocket)  ──▶  Motor (colas, tools, reloj)  ──▶  Postgres
[PWA futura]   ──┘                                              │
                                                                └──▶  Claude API (master)
```

### 11.1 Contrato del Game API (lo que cualquier cliente necesita)
- `POST /actions` — `{character_id, text}` → encola la acción, devuelve `action_id`
- `GET /characters/:id`, `/locations/:id`, `/inventory/:id`, `/events?location_id&since`
- `POST /characters` — creación con validación
- `POST /commands` — `/sheet`, `/recap`, `/rest`, `/who`… (sin LLM)
- WebSocket / suscripción por `character_id` (punto de vista): recibe solo los eventos que ese PJ puede percibir, ya filtrados por el servidor (mismo punto, línea de visión, `visibility: public`)
- Auth por token; el usuario tiene `identities[]` (`discord_id` hoy, email mañana), así la misma cuenta pasa a la PWA sin migración

### 11.2 Adaptador Discord (MVP) — DECIDIDO: canal por jugador (punto de vista), no por localización
Como el movimiento nunca es instantáneo, nadie cambia de canal. Cada jugador tiene `#pov-<nombre>` privado y el master le narra **su** mundo ahí. El servidor enruta qué ve cada uno:
- Lo que hace el jugador y lo que responde el master → solo en su canal.
- Lo que hace otro PJ en el **mismo punto** o visible desde el tuyo → reflejado en tu canal con su nombre ("Mira saca una antorcha"). Habla en voz alta: lo lees; susurra: no.
  > **Nota (pendiente de afinar):** solo se refleja lo **observable**: la acción física y lo dicho en voz alta. Nunca sus tiradas, sus fallos de percepción, lo que descubre, sus secretos revelados ni la narración privada que le da el master. Si Mira encuentra la trampilla, tú ves "Mira palpa la pared", no "Mira encuentra una trampilla" (salvo que la abra o te lo cuente). Cada evento lleva dos textos: `narration_private` (para el actor) y `observable` (para testigos), y el master rellena ambos. Es una función interesante para jugar con amigos y ver qué hacen los demás; se valida en el MVP y, si molesta, se puede reducir a "presencia + diálogo" sin tocar el modelo.
- Otra localización → no lo ves, salvo `visibility: public` (campanas, incendio lejano) → `#tablon` común + canales de quien esté en rango.
- El viaje se vive en tu canal ("llevas 2 min andando, ves el roble a lo lejos").
- `#ooc` común fuera de ficción, **solo para hablar entre personas** ("esta noche juego a las 22h", "¿alguien viene a la cripta?", dudas de cómo funciona el bot). Sin estructura. Si el grupo ya tiene su canal de amigos, es opcional.
- **Reportar errores — DECIDIDO: se hace donde ocurre, no en un canal aparte.**
  - **Reacción ⚠️** sobre cualquier mensaje del master en tu `#pov` → el bot captura el evento (id, PJ, localización, tiradas, tool_calls) y abre el reporte en `#reportes`. Cero fricción, para lo puntual.
  - **Reacción ⚠️ + responder a ese mismo mensaje** (reply de Discord) → el bot detecta que el reply va a un mensaje marcado y adjunta el texto como comentario del reporte ya abierto. Sin comandos: reaccionas y contestas. Cualquier reply posterior al mismo mensaje se añade al hilo.
  - Todo lo demás que se escribe en `#pov` es juego: el bot no distingue entre mensaje y reply si no hay ⚠️ (responder al master no tiene sentido, la conversación ya es continua).
  - `#reportes`: canal solo para el admin (Santy), un hilo por reporte con todo el contexto enlazado. Se corrige desde el panel de admin (§13.7) y el bot avisa al jugador en su `#pov` al resolverlo. Es el backlog de bugs del master y la fuente de la métrica de coherencia (§11.3).
- `#crear-personaje` con flujo guiado, `#hoja-<nombre>` con la hoja viva (§4.9).
- **Descartado**: un único canal de campaña donde todos leen todo. Rompe la fidelidad: si no estás en un sitio, no te puedes enterar.
- Combate: en el propio `#pov`, con el orden de iniciativa fijado por el bot en cada canal implicado.
- Es la misma vista que tendrá la PWA: el enrutado de visibilidad se construye una vez en el Game API, no en el bot.
- Coste: el bot escribe un evento en varios canales; con 4-8 jugadores es irrelevante.
- Comandos slash (`/sheet`, `/inventory`, `/recap`…) responden en mensaje efímero (solo lo ve quien lo pide).
- Hoja de personaje y estado del mundo en embeds; para el mapa, una imagen regenerada por el bot.
- Voz: canales de voz de Discord tal cual, uno por región.
- Login: el `discord_id` es la identidad; no hay registro aparte.

### 11.2.1 Onboarding — DECIDIDO: mismo flujo para todos, el mundo no espera a nadie
- Idealmente todos empiezan el mismo día (lanzamiento). Quien entra después sigue el mismo flujo; solo cambia que el mundo ha avanzado.
- `#crear-personaje`: flujo guiado por botones (§4.6, §4.8): nombre → raza → clase → trasfondo → características (método de la campaña) → skills → equipo inicial → aspecto/historia (texto corto) → `death_mode`. Al terminar, el bot crea `#pov-<nombre>` y `#hoja-<nombre>`.
- Primer mensaje en `#pov`: narración de llegada al `starting_location` **tal como está ahora** (hora, clima, estado, quién anda por ahí) + un resumen de lo público (`#tablon`, rumores de la crónica pública) como "lo que se cuenta por el camino". Nada de lo privado de otros.
- Sin compensaciones por llegar tarde: ni nivel ni oro extra. Como llegar a una ciudad nueva: la vida ya sigue.
- El Director garantiza un hilo `immediate` alcanzable desde el punto de inicio en todo momento (§3.1.1), así el recién llegado siempre tiene gancho.
- Mini-tutorial: 3 mensajes del bot (cómo actuar, cómo tirar, cómo reportar) antes de la primera narración. Saltables.

### 11.3 Qué medir en la validación — DECIDIDO: lo que más importa es uso y errores
Prioridad de la validación: **cuánto juega la gente y si reporta errores.** Todo lo demás es secundario.
- Tiempo invertido: sesiones por jugador/semana, duración media, hora del día, racha (días seguidos).
- Reportes: cuántos por cada 100 acciones, por tipo de error, tiempo hasta resolverlos, y cuántos jugadores reportan al menos una vez (si nadie reporta, o va perfecto o no saben cómo).
- Retención: jugadores activos a 7 y 30 días, y en qué punto abandonan (creación, primera hora, primera muerte, primer viaje largo).
- Sesiones por jugador/semana y duración media.
- % de acciones que son consultas de estado (`/sheet`, `/inventory`): si es alto, la UI web de hoja/inventario tiene valor claro.
- Quejas o confusión con el tiempo global y las esperas (respawn, viaje, descanso).
- Cuántas veces el master rompe coherencia: reportes en `#reportes` por cada 100 acciones, y tipo de error (estado, reglas, espacio, trama).

### 11.4 Salto a PWA
Cuando llegue: mismo backend, la PWA consume el WebSocket y renderiza hoja, mapa, inventario y log con UI propia. Discord puede seguir vivo como cliente de voz o desaparecer. Login con Discord OAuth para heredar cuentas.

## 12. Alcance del MVP — DECIDIDO: la experiencia completa, una campaña, 10 jugadores
El MVP no es un recorte: es **todo lo marcado DECIDIDO en esta spec** funcionando, en una única campaña (sin UI para crear más; todo lleva `campaign_id`) y hasta 10 jugadores. El objetivo es representar el concepto entero de la experiencia y validarlo con personas.

**Incluye:**
- Mundo: mapa jerárquico con puntos y coordenadas, movimiento con coste e `in_transit`, monturas/vehículos, recursos regenerables, estado compartido, líneas secundarias (2-3 iniciales + eventos puntuales desde el panel).
- Trama: Biblia + hilos por horizonte + Director en modo `draft` por hitos (cron diario en v2).
- Personaje: creación guiada por botones, skills desde SRD, hoja viva, progresión por uso/combate/trama, dos modos de muerte, velo al desconectar, dormir = descansar.
- Ítems: catálogo SRD, capacidad (contenedores, carga por Fuerza), consumo con ritmos, economía anclada al euro, tiendas, comercio entre jugadores con doble confirmación.
- Juego: master con el contrato completo de tools, texto libre + acciones sugeridas + quickbar de hechizos + botón 🎲, intención antes de efecto, combate conversacional con ventanas decisivas, NPCs con cola de conversación y memoria, percepción por bandas.
- Sociedad: PvP total con crímenes, testigos, guardias, `wanted`, recompensas en `#tablon`, compañías.
- Discord: `#pov` por jugador, `#hoja`, `#tablon`, `#ooc`, `#crear-personaje`, reportes ⚠️ + reply, `#reportes`, notificaciones por DM.
- Admin: observabilidad (reportes etiquetados, explorador de eventos con prompt exacto y reproducción, métricas, decisiones del Director), corrección manual como válvula contada.
- Métricas de uso, reportes y retención (§11.3).

**Fuera:** solo lo listado en §13 como aplazado o fuera del MVP, la PWA y la multi-campaña.

**Validación:** con pocos jugadores, que todo funcione y sea coherente; cerca de 10, qué se rompe con la escala (colas, coste de IA, ruido en `#pov`, Director, conflictos por ítems).

### 12.1 Orden de construcción — fases de un mismo producto, cada una jugable
1. **Mundo sin IA**: mapa, movimiento, POV, inventario y capacidad, reloj, recursos, `#pov`/`#hoja`/`#tablon`. El bot narra plano desde los datos. Valida el modelo compartido, lo más caro de arreglar después.
2. **Master**: prompt, tools, dados, intención, acciones sugeridas, hechizos, combate, NPCs, percepción por bandas. Ya es D&D.
3. **Sociedad y persistencia**: dormir/velo, muerte, PvP y ley, compañías, economía y tiendas, consumo, progresión.
4. **Trama viva**: Director, hilos, líneas secundarias, eventos puntuales.
5. **Operación**: panel de admin, reportes, métricas, jugadores simulados, harness del master.

La campaña de lanzamiento (Biblia, mapa con coordenadas, NPCs, hilos, líneas) se escribe en paralelo desde la fase 1.

## 13. Estado de los pendientes

**Cerrados en esta ronda:** grupo/viaje conjunto (§3.2.4), acciones/hechizos/dados con botones (§4.10), consumo de recursos (§5.5), onboarding (§11.2.1).

**Panel de admin — DECIDIDO como observabilidad, no como editor.** Prioridad: recoger reportes (§11.2) y toda la telemetría posible para entender qué falla y arreglarlo en código, no parchear a mano.
- Bandeja de `#reportes` con etiqueta por tipo de error (estado / reglas / espacio / trama / otro) y estado (nuevo / analizado / resuelto).
- Explorador de eventos: ver cualquier evento con el prompt completo que recibió el master, tools llamados y resultado. Reproducir una acción con el mismo contexto para probar un prompt nuevo.
- Métricas: acciones/día por jugador, latencia del master, tokens por acción, errores de tool (`no_space`, alias no resuelto…), decisiones del Director pendientes de aprobación.
- Corrección manual mínima (editar HP/inventario/posición, retroceder un evento) solo como válvula de emergencia; cada corrección queda registrada como evento `admin_fix` para contarlas.

**Aplazados hasta terminar el análisis en curso:**
0c. Intensidades de luz de luna y clima en los radios de percepción (§9.2).
1. Coste de IA (caché, modelo pequeño, rate limit) — se analiza a fondo cuando el resto esté cerrado.
2. Límites de convivencia en PvP (anti-acoso, modo pacifista) — solo si la validación lo pide (§9.4).
4. Fin de campaña (exportar/importar personajes).
5. Narrativa de las esperas de muerte.
6. Combate táctico (cuadrícula opcional).
7. Visibilidad de hojas ajenas.
8. Afinar el reflejo de acciones ajenas en `#pov` tras probarlo (§11.2).

## 14. Stack técnico — DECIDIDO: motor propio en Node sobre Google (Firebase + Compute Engine)

### 14.1 Piezas
| Pieza | Servicio | Coste esperado |
|---|---|---|
| Estado del mundo, personajes, eventos, log | **Firestore** (plan Blaze, alerta de presupuesto 10 €) | 0–5 €/mes hasta ~50 jugadores |
| Identidad | Firebase Auth con proveedor Discord (OAuth); `identities[]` en el usuario para la futura PWA | 0 |
| Motor + bot de Discord + reloj/cron | **Un proceso Node en una VM `e2-micro` de Compute Engine** (nivel gratuito permanente) | 0 |
| Panel de admin (observabilidad, §13) | Firebase Hosting + Firestore | 0 |
| Master y Director | API de Claude | El coste real; análisis pendiente (§13) |
| Secretos (token Discord, clave Claude) | Secret Manager (MVP: `.env` en la VM con permisos 600) | 0 |
| Logs | `pm2 logs` + agente de Cloud Logging | 0 |

Por qué Blaze: Spark bloquea el servicio al agotar la cuota diaria (50k lecturas / 20k escrituras), lo que congelaría el mundo a mitad de tarde. Blaze mantiene las mismas cuotas gratis y cobra céntimos por el exceso.

Por qué una VM y no Cloud Functions: el bot mantiene un WebSocket abierto con Discord 24h y el reloj/cron es trabajo continuo. Functions no puede sostener eso. Cloud Run con instancia mínima también vale pero no es gratis.

### 14.2 Principios de arquitectura (heredados de Evennia)
1. **Un solo árbol de contención.** Todo (PJ, NPC, ítem, montura, contenedor) tiene un único campo `location` polimórfico: `{type: spot|character|npc|container|vehicle, id}`. Nada existe en dos sitios.
2. **Las salidas son entidades con estado**, no aristas: `exits` con `state` (cerrada, vigilada, derrumbada), igual que los puntos.
3. **Los sistemas no son objetos del mundo.** Líneas secundarias, compañías, combates, crímenes: colecciones propias con estado, nunca "objetos invisibles".
4. **Tickers persistentes.** El reloj, el consumo, la regeneración y las líneas secundarias guardan `last_tick_at` en Firestore. Un reinicio de la VM retoma desde ahí; nunca salta ni duplica ticks.
5. **El mundo vive en RAM, Firestore persiste.** Al arrancar, el motor carga campaña, mapa, personajes y estado a memoria; Dijkstra, radios de percepción y colas se resuelven en memoria; cada cambio se escribe a Firestore y al log de eventos. Firestore no está en el camino crítico de una acción salvo para persistir.
6. **El bot es un adaptador** (§11.1): habla con el motor por una interfaz interna que mañana se expone por HTTP/WebSocket a la PWA.

### 14.3 Estructura del proceso Node
```
/engine        motor: mundo en memoria, reglas, colas por localización, tools del master
/ai            Master y Director: ensamblado de prompt, llamadas a Claude, validación de tools
/clock         reloj global, consumo, regeneración, líneas secundarias (ticks persistentes)
/adapters/discord   bot: canales #pov, botones, reacciones ⚠️, hoja viva, #tablon, #reportes
/api           interfaz interna (hoy) → HTTP/WS (PWA, mañana)
/data/srd      JSON SRD 5e con alias es/en
/admin         panel de observabilidad (Firebase Hosting)
```

### 14.4 Despliegue de la VM — guía para ejecutar
1. Firebase → Configuración → Plan de facturación → **Blaze**. En Google Cloud → Facturación → Presupuestos → alerta a 10 €.
2. Google Cloud Console, **mismo proyecto que Firebase** → Compute Engine → activar API.
3. **Crear instancia**:
   - Nombre: `dnd-engine`
   - Región: `us-central1` (o `us-west1` / `us-east1`; solo estas tres son nivel gratuito)
   - Tipo: `e2-micro`
   - Disco: 30 GB estándar (pd-standard), Debian 12
   - Red: sin IP externa fija (efímera vale; el bot solo hace conexiones salientes)
   - Identidad: cuenta de servicio del proyecto con rol **Cloud Datastore User** (Firestore) → sin ficheros de claves
4. **SSH desde el navegador** (botón "SSH" en la consola):
   ```
   sudo apt update && sudo apt install -y git
   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
   source ~/.bashrc && nvm install --lts
   npm i -g pm2
   git clone <repo> && cd <repo> && npm ci
   cp .env.example .env && nano .env      # DISCORD_TOKEN, ANTHROPIC_API_KEY, GOOGLE_CLOUD_PROJECT
   chmod 600 .env
   pm2 start npm --name dnd -- start && pm2 save && pm2 startup   # copiar/ejecutar el comando que imprime
   ```
5. **Verificar**: `pm2 status` en verde, el bot aparece online en Discord, un `/sheet` responde.
6. **Actualizar**: `git pull && npm ci && pm2 restart dnd`. Más adelante: GitHub Action que hace lo mismo por SSH en cada push a `main`.
7. **Logs**: `pm2 logs dnd`. Opcional: instalar el agente de Cloud Logging para verlos desde la consola.
8. **Backups**: export diario de Firestore a un bucket de Cloud Storage (Blaze; céntimos) vía `gcloud firestore export`, programado desde la propia VM con cron.

Límites del nivel gratuito a vigilar: 1 `e2-micro`/mes, 30 GB disco, 1 GB de salida/mes a fuera de Google (Discord y Claude cuentan; con 10 jugadores no se alcanza). Si la RAM (1 GB) se queda corta: `e2-small` (~12 €/mes) sin cambiar nada.

### 14.5 Aplazado dentro de lo técnico
- Importación de datos SRD 5e con alias en español (elegir fuente JSON).
- Roles y permisos en Discord (bot, admin, jugador) y en el Game API.
- Jugadores simulados (bots LLM) para probar la escala a 10 antes de meter personas.
- Harness de evaluación del master: 20-30 casos acción → comportamiento esperado, reproducibles desde el panel.
- Análisis de coste de Claude (caché de prompt, modelo pequeño para acciones triviales, rate limit).
- Contenido de la primera campaña y system prompts de Master y Director.
