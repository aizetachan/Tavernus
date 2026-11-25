# Plan de pruebas con los 200 $ de crédito de API

Anthropic ha concedido a la organización **200 US$ de crédito promocional** («API credit (Ultra)»), válidos para la
API, la API por lotes, el Agent SDK y el Playground. **Caducan el 24-12-2026 a la 1:00 CET**: lo que no se gaste se
pierde. La beta cerrada (M2) está fijada para el 19-12-2026, así que las pruebas y la beta caben en las mismas cuatro
semanas y con el mismo crédito.

**Estado (25-11-2026):** plan escrito y herramientas listas, nada lanzado. Las tandas las lanza Miguel con su clave;
cada una lleva su comando y su coste. `main` está al día; la única PR abierta es la #81 (aspecto del combate en la web),
que fusiona sin conflicto y no afecta a las tandas automáticas. Hasta hoy, lo único probado con modelo real son las partidas por perfil del 31-10 (Haiku, 9,25 $) y
la partida a dos del 11-11. Las seis fases del plan del 11-11 y las cinco del plan del 31-10 están en producción **sin
una sola partida con modelo real detrás**.

## Qué sabemos del coste

Todo sale de la tanda del 31-10 (`data/local/autoplay/20261031-1020`): 10 partidas de Brezal, 2.840 acciones, 3.177
llamadas al máster, Haiku 5.5 a esfuerzo bajo. Consumo medio **por acción** del máster (1,12 llamadas por acción, con
la caché del system prompt caliente):

| | Entrada sin caché | Salida | Lectura de caché |
|---|---:|---:|---:|
| Por acción | 12.650 tokens | 1.900 tokens | 48.900 tokens |

La entrada sin caché pesa más que la salida: es el contexto dinámico de cada turno (escena, Diario, historial), y es lo
que dispara el precio al cambiar de modelo. Precios de la API (US$ por millón; lectura de caché y escritura con ttl de
1 h, que cobra a 2× la entrada):

| Modelo | Entrada | Salida | Lectura caché | Por acción | 60 acciones | 300 acciones (una partida) |
|---|---:|---:|---:|---:|---:|---:|
| Haiku 5.5 (producción) | 0,10 | 0,50 | 0,01 | **0,0027 $** | 0,16 $ | 0,81 $ |
| Sonnet 5.5 | 2 | 10 | 0,20 | **0,054 $** | 3,24 $ | 16,2 $ |
| Opus 5.5 | 4 | 20 | 0,20 | **0,098 $** | 5,90 $ | 29,5 $ |

Para los bancos que empiezan cada prompt en una partida nueva (creatividad, conversación, ruta fija) el turno es más
corto: 4.500 de entrada, 870 de salida y 11.400 de caché por llamada (`BASELINE_CALL`), es decir **0,001 $ (Haiku),
0,020 $ (Sonnet) y 0,038 $ (Opus) por llamada**.

Fable 5.2 (8 / 40 por millón, 0,187 $ por acción) queda fuera de todas las tandas: demasiado caro para lo que
aporta a estas pruebas.

Lo demás es pequeño: jugador automático con Haiku 0,025 $ por 100 acciones; juez de errores y juez de diversión
con Haiku, menos de 0,10 $ por partida de 300; actor Sonnet en las charlas, unos 0,004 $ por turno de charla
(0,5 a 0,6 $ por partida de 300); un mundo generado, 0,07 a 0,15 $ con Sonnet.

Dos consecuencias que mandan en el plan:

1. **Sonnet como máster cuesta 20 veces Haiku y Opus 36 veces.** Una partida entera de 300 acciones con Sonnet son
   16 $. No se pueden jugar las once partidas por perfil con cada modelo: con los grandes se juega la **ventana de 60
   acciones** sobre la que ya están definidas las métricas del plan del 31-10, y solo en los perfiles que más separan a
   un modelo de otro.
2. **Con Haiku, repetir la tanda entera cuesta 11 $.** Es el precio de una «foto» completa del juego, y se puede sacar
   tres o cuatro veces en estas semanas: antes de tocar nada, tras los arreglos y antes de la beta.

## Casos de uso y cómo se cubre cada uno

| Caso de uso | Con qué se prueba | Modelos | Automático |
|---|---|---|---|
| Conversación con NPC, negativas con salida, convencer con tirada, trato visible | `autoplay --profiles charlatan,novato,rapido,picaro` + `playtest-report --window 60 --baseline` | Haiku, Sonnet, Opus | Sí |
| Combate, ley, muerte y reaparición, un alto por encuentro | `autoplay --profiles violento,rompejuegos` | Haiku, Sonnet | Sí |
| Misiones, Diario, avance de actos, finales de Brezal y epílogo | `autoplay --profiles dirigido` (150) y `dirigido-templar,dirigido-verdad,dirigido-arder --start-act 3` | Haiku, Sonnet | Sí |
| Inventiva del jugador, lo imposible, lo que no existe, cuarta pared | `bench:creativity` (25 prompts, unas 35 llamadas) | Haiku, Sonnet, Opus | Sí |
| Voz de los NPC: director y actor | `talk-bench` (7 escenarios, variantes A, B, C, C2, D) | Haiku, Sonnet, Opus como actor | Sí |
| Prólogo del máster con reintento y primera escena larga | Cada partida nueva es una muestra: se leen en `transcripts/` | Haiku, Sonnet | Sí |
| Tiradas ocultas (Percepción, Sigilo), lo dicho entre comillas, tres modos | Partidas por perfil (explorador, pícaro) y partida a dos | Haiku | Parte |
| Comercio, deudas, prendas, fiado, robo | Perfil pícaro y detectores del juez (`prenda_sin_estado`, `trato_sin_estado`) | Haiku, Sonnet | Sí |
| Mundos generados (relleno con modelo) y jugar en ellos | `autoplay --games N` sin `--profiles`, con `WORLDGEN_MODEL` | Haiku, Sonnet, Opus para el mundo | Sí |
| Latencia y coste por acción, mismo recorrido y mismos dados | `bench` (ruta fija de 10 acciones) | Haiku, Sonnet, Opus, dos esfuerzos | Sí |
| **Multijugador**: turnos compartidos, narración por lector, robo entre jugadores, `report_incident` al que pegó, chat | `autoplay --pairs` (dos jugadores automáticos en la misma partida, a veces a la vez, chat, reacciones) y la sección «A dos» de `playtest-report`; además la partida a mano de Miguel y Santi | Haiku, Sonnet | Sí (desde el 25-11) |
| Jueces: ¿se puede fiar uno del juez Haiku? | Mismas partidas juzgadas con Haiku y con Sonnet, acuerdo entre los dos | Haiku frente a Sonnet | Sí |
| Lo que no gasta API | Reconexión, Tablón, «Mientras no estabas», ajustes de la mesa, contraseña, wiki, imágenes (Cloudflare), voz (navegador) | — | Tests y a mano |

El multijugador era el hueco grande (los fallos del 11-11 y tres fases de arreglos sin forma de repetirlos con modelo
real). Desde el 25-11 `autoplay --pairs` lo cubre: una partida con dos jugadores automáticos juntos, que actúan a la vez
de vez en cuando (y siempre en pelea), se hablan por el chat y en la escena, se dan cosas, se roban y contestan a las
reacciones del otro. La sección «A dos» del informe cuenta, por jugador, los turnos compartidos sin su parte
(`narration_by_pc`) o sin lo común, y los incidentes apuntados al que no pegó.

## Rondas

Cada ronda deja sus resúmenes en `data/local/autoplay/<fecha>/` y `data/local/bench/`, y su lectura en una nota de
revisión en el vault (como «Revisión partida 2026-11-11»). Los costes son de API; con margen del 20 % por reintentos
y por las lecturas de tools que no están en la media.

### Ronda 1. Lo arreglado, con Haiku (semana del 25-11). Unos 15 $

Comprueba las fases del 31-10 y del 11-11 con el mismo modelo de producción, y saca la segunda «foto» del juego para
compararla con la del 31-10.

| Tanda | Qué mide | Comando | Coste |
|---|---|---|---|
| 1a. Charlas (fases 1 y 2 del 31-10, fase 5 del 11-11) | Racha con el mismo NPC, negativas literales, tiradas sociales, misiones del novato | `npm run autoplay -- --profiles charlatan,novato,rapido --actions 60 --parallel 3 --live` y luego `playtest-report --window 60 --baseline data/local/autoplay/20261031-1020` | 0,6 $ |
| 1b. Combate y ley (fase 3 del 31-10, fase 4 del 11-11) | Golpes declarados que acaban en ataque, veces a 0 PG, un solo alto por encuentro | `--profiles violento,rompejuegos --actions 60 --parallel 2 --live` | 0,4 $ |
| 1c. Finales (fase 4 del 31-10) | 3 de 3 finales completables; un dirigido entero | `--profiles dirigido-templar,dirigido-verdad,dirigido-arder --start-act 3 --actions 60 --parallel 3 --no-judge --live` y `--profiles dirigido --actions 150 --live` | 1,0 $ |
| 1d. Tanda completa | Las mismas métricas que el 31-10 en las 11 partidas: la foto «después» | `--profiles all --actions 300 --parallel 6 --max-usd-game 1.2 --live`, luego `playtest-report --live` | 11 $ |
| 1e. Partida a dos | Guion de la taberna (parroquiano, bofetón y robo a la vez, detención), prólogo, primera escena, «Hacer, Decir, Chat» | A mano en tavernus.com, Miguel y Santi, 30 a 40 turnos, Haiku | 0,2 $ |

Lanzar 1a, 1b y 1c primero (2 $ y una hora): si algo está roto, se arregla antes de gastar los 11 $ de la tanda
completa. En todas: `ACTOR_MODEL=claude-sonnet-5-5` como en producción (la tanda del 31-10 jugó sin actor, así que el
antes y el después no son idénticos en las charlas; se anota).

### Ronda 2. Comparar modelos sobre lo mismo (semana del 2-12). Unos 40 $

Cierra PLAN §8 (qué modelo para el máster) con datos, y mide dónde compensa un modelo mejor: en todo el turno, solo en
el actor, solo en el mundo o en ninguno.

| Tanda | Qué mide | Modelos y esfuerzo | Coste |
|---|---|---|---|
| 2a. Ruta fija (`bench`), dos pasadas por combinación | Coste, latencia y narración acción por acción, mismos dados | Haiku low y medium, Sonnet low y medium, Opus 5.5 low y medium | 5 $ |
| 2b. Creatividad (`bench:creativity`) | Lo imposible, lo que no existe, rumores, cuarta pared; el `.md` se lee entero | Haiku, Sonnet, Opus, todos a low | 3 $ |
| 2c. Conversación (`talk-bench`) | Variantes A a D más dos nuevas: Haiku director con Opus actor, y Sonnet director con Sonnet actor; juez con rúbrica | Haiku, Sonnet, Opus | 3 $ |
| 2d. Perfiles con Sonnet máster | Las métricas de 60 acciones frente a 1a y 1b | charlatán, violento, rompejuegos y dirigido, 60 acciones cada uno, `--parallel 2` | 14 $ |
| 2e. Perfiles con Opus 5.5 máster | Lo mismo, en los dos perfiles que más separan a Haiku de Sonnet en 2d | 2 perfiles, 60 acciones | 13 $ |
| 2f. Mundos generados | Calidad del mundo (gente, encargos, situaciones) y una partida corta en cada uno | 3 mundos con Haiku, 3 con Sonnet, 3 con Opus; partidas de 30 acciones con Haiku, perfiles impredecible y explorador | 3 $ |

Con Sonnet y Opus, `--parallel 2` o `3`: el límite de tokens de entrada por minuto de la organización no está medido
y a 10 partidas a la vez con 12.000 tokens sin caché por llamada se puede pasar. Si salen 429, bajar el paralelo, no
subir el tope.

Lo que se decide con la ronda 2: si Sonnet o Opus arreglan algo que Haiku no (negativas, inventiva, finales) o solo
escriben mejor; si el actor con Opus vale lo que cuesta; y si hay escenas donde merece la pena un modelo mejor (prólogo,
finales) con Haiku en el resto. Para eso ya se puede elegir modelo por escena (`PROLOGUE_MODEL` para el prólogo y la
primera escena, `FINAL_MODEL` mientras el PJ lleva un final activo), y se mide en la ronda 3.

### Ronda 3. Multijugador automático y la tanda de la beta (semanas del 9-12 y del 16-12). Unos 35 $

La 3a ya no necesita desarrollo: puede lanzarse con la ronda 1 si hay prisa por ver el multijugador con modelo real.

| Tanda | Qué mide | Modelos | Coste |
|---|---|---|---|
| 3a. `autoplay` a dos | Narración por lector, `report_incident` al que pegó, robo con tirada oculta, un alto por encuentro, prólogo para el segundo que entra | `--pairs all --actions 100 --parallel 5 --live` con Haiku (5 parejas, 3 $); `--pairs picaro:novato,violento:pausado --actions 60 --parallel 2 --live` con Sonnet (8 $) | 11 $ |
| 3b. Modelo por escena | Prólogo y primera escena con Sonnet (`PROLOGUE_MODEL`), los turnos con un final en marcha con Sonnet (`FINAL_MODEL`), el resto Haiku | dirigido (150) y los 3 finales desde el acto III (60), `--no-judge` | 3 $ |
| 3c. Jueces | Acuerdo entre el juez Haiku y un juez Sonnet sobre 2 partidas de 1d | Haiku frente a Sonnet | 1 $ |
| 3d. Tanda de la beta | La tercera foto: 11 perfiles × 300 tras todos los arreglos | Haiku | 11 $ |
| 3e. Personas | Sesiones del equipo en tavernus.com antes y durante la beta; dos de ellas con Sonnet máster para ver si se nota | Haiku (5 sesiones × 100 acciones) y Sonnet (2 × 80) | 10 $ |

### Reserva. Unos 110 $

- **Beta cerrada (19-12 al 24-12):** con `DAILY_MASTER_ACTIONS=200`, un jugador que agota su cupo cuesta 0,54 $ al
  día. Cinco jugadores durante cinco días son menos de 15 $; diez, 30 $. Si la clave de producción es la de esta
  organización, la beta sale del mismo crédito.
- **Repeticiones:** cada arreglo que salga de las rondas 1 y 2 se vuelve a probar con su tanda de 60 acciones (menos
  de 1 $ con Haiku, 3 a 6 $ con Sonnet).
- Lo que quede el 20-12 se gasta en lo que más dude el equipo: otra tanda con Sonnet o más sesiones de personas.
  Nada se guarda para enero.

## Calendario y presupuesto

| Semana | Qué | Acumulado |
|---|---|---:|
| 25-11 a 1-12 | Ronda 1 (1a a 1c primero, 1d y 1e después) y preparación de la ronda 2 | 15 $ |
| 2-12 a 8-12 | Ronda 2 completa; nota de revisión y decisión de PLAN §8 | 55 $ |
| 9-12 a 15-12 | Desarrollo del `autoplay` a dos y 3a; arreglos de las rondas 1 y 2; 3b y 3c | 70 $ |
| 16-12 a 19-12 | 3d y 3e; la beta arranca el 19-12 | 90 $ |
| 19-12 a 24-12 | Beta cerrada y repeticiones; el 24-12 a la 1:00 se acaba | 200 $ |

## Preparación (hecha el 25-11, sin API)

- `autoplay --pairs` (parejas en `PAIRS`; `--actions` cuenta por jugador; un resumen por jugador con el mismo slug y el
  campo `pair`), `how` en cada acción (a la vez, chat, en voz alta, reacción, oferta) y la sección «A dos» del
  `playtest-report`. En dry-run, lo que los dos mandan a la vez entra en un solo cierre con los dos en `group`.
- `PROLOGUE_MODEL` y `FINAL_MODEL` en `effectiveModel` (`src/ai/master.ts`): por encima de `MASTER_MODEL` solo en esas
  escenas; vacíos, nada cambia.
- Lectura de caché por modelo en `scripts/bench-prices.ts` (5 % en Opus 5.5 y Sonnet 5.5, 10 % en Haiku y Sonnet 5) y
  Sonnet 5.5 corregido en `src/adapters/web/status.ts`.
- `MASTER_EFFORT` admite `low`, `medium` y `high`; vale para 2a.
- Haiku no admite `fallbacks`; los demás modelos van con `fallbacks: 'default'`. Si en una partida violenta un turno lo
  atiende otro modelo por un rechazo, `models` en el resumen lo dice y el coste va al precio del que respondió.
- Memoria del PC: las tandas van con `--parallel` y en Node, pero el hook de memoria bloquea los arranques con menos
  de 4 GB libres. Cerrar lo pesado antes de lanzar.

## Qué se mira en cada tanda

Las métricas del plan del 31-10, en la ventana de 60 acciones, con su objetivo: racha con el mismo NPC (15 o menos),
negativas literales (5 o menos), tiradas sociales del charlatán (3 o más), misiones del novato (1 o más), golpes
declarados que acaban en ataque (22 de 24 o más), veces a 0 PG del violento (5 o menos), turnos con rechazo del máster
(12 % o menos) y finales completables (3 de 3). Y lo que añadió el 11-11: un solo «¡Alto!» por encuentro, nadie lee la
narración en segunda persona de otro, el prólogo sale del máster y no de la plantilla, y menos de dos burbujas del
narrador por charla (`npm run narrator-count`).

Nada de esto dice si el juego es divertido. Para eso están 1e y 3e.
