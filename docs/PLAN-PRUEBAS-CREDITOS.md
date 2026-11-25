# Plan de pruebas con los 200 $ de crédito de API

Anthropic ha concedido a la organización **200 US$ de crédito promocional** («API credit (Ultra)»), válidos para la
API, la API por lotes, el Agent SDK y el Playground. **Caducan el 24-12-2026 a la 1:00 CET**: lo que no se gaste se
pierde. La beta cerrada (M2) está fijada para el 19-12-2026.

**Estado (25-11-2026):** plan escrito y herramientas listas (PR #88 y los perfiles mecánicos con la tabla de cobertura), nada lanzado. Las tandas las lanza Miguel con su
clave; cada una lleva su comando y su coste.

## Qué se prueba y qué no

La historia de Brezal, el guion, las misiones y los personajes se van a reescribir. Hasta entonces no se mide nada que
dependa de ellos: ni los finales, ni cuántas misiones cumple un perfil en 300 acciones, ni la diversión de la trama, ni
la calidad de los mundos generados. Eso se presupuesta cuando la historia nueva esté en el código.

Lo que sí se prueba ahora son las **mecánicas básicas**, en pasadas cortas y repetibles:

| Qué | Con qué se mide |
|---|---|
| Combate: el jugador llega a atacar, los NPC responden, caídas, reaparición, un solo alto por encuentro | perfiles violento y rompejuegos; tabla «Combate y muerte» del `playtest-report` |
| Todo lo demás que puede pasar en una sesión: conjuros y trucos, recursos de clase, objetos y pociones, disparar, sigilo, forzar, saquear, trepar, descansar, curar, rastrear, recolectar, montar, trampas | perfiles mecánicos `lanzador` (hechicero) y `tirador` (explorador), que recorren esa lista en orden; tabla «Cobertura de tools» del informe: qué tools del máster se usaron y cuáles no |
| Lo que piden los demás perfiles: preguntas de reglas (novato), percepción y mapa (explorador), descanso y tiempo (pausado), frases de tres palabras (rápido), cambiar de sitio (impredecible), seguir el Diario (metódico, dirigido) | los 11 perfiles de carácter a 40 acciones |
| Lo imposible, lo que no existe, la cuarta pared | `bench:creativity` (25 prompts) |
| Voz de los NPC: director y actor | `talk-bench` (variantes A, B y C2 con Haiku) |
| Fluidez y usabilidad: tiempo de respuesta, rechazos del máster, repeticiones, sugeridas que se repiten | tabla «Fluidez», gratis en las mismas partidas |
| Incoherencias del narrador: lugares o salidas inventadas, NPC fuera de alcance o de personaje, contradicciones con la escena | `judge` (detectores sin coste y juez modelo con Haiku) |
| Incoherencias de las acciones: tool fallido narrado como hecho, trato o pago sin estado, desenlace que no respeta la tirada, tirada para algo trivial | detectores de `judge` (`closecheck`) |
| Charla básica: negativas con salida, convencer con tirada, comercio, fiado y prendas | perfiles charlatán y pícaro; tabla «Conversaciones» |
| Concurrencia entre jugadores: turnos a la vez, cada uno lee lo suyo, chat, robo entre jugadores, el crimen a quien lo hace | `autoplay --pairs`; sección «A dos» del `playtest-report` |
| Divertido o no, usable o no | la partida a mano de Miguel y Santi; el juez de diversión se deja para cuando haya guion |

## Qué sabemos del coste

De la tanda del 31-10 (2.840 acciones con Haiku 5.5 a esfuerzo bajo), por acción del máster: 12.650 tokens de
entrada sin caché, 1.900 de salida y 48.900 de lectura de caché. Con los precios de la API:

| Modelo | Por acción | 40 acciones | Pasada corta (19 jugadores × 40) |
|---|---:|---:|---:|
| Haiku 5.5 (producción) | 0,0027 $ | 0,11 $ | 2,1 $ |
| Sonnet 5.5 | 0,054 $ | 2,2 $ | 41 $ |
| Opus 5.5 | 0,098 $ | 3,9 $ | 75 $ |

Lo demás es pequeño: jugador automático con Haiku, 0,01 $ por 40 acciones; juez de errores, unos 0,05 $ por partida de
40; actor Sonnet en las charlas, unos 0,004 $ por turno de charla. Fable 5.2 (0,187 $ por acción) queda fuera.

## La pasada corta

Trece partidas de un jugador (los 11 perfiles de carácter y los 2 mecánicos) y tres parejas, todas de 40 acciones, con
Haiku, el actor Sonnet como en producción y el juez de errores; más el banco de creatividad y el de conversación. Se
lanza entera cada vez que se arregla algo, y se compara con la anterior. **Unos 3 $ y una hora.**

| Partidas | Qué mira | Comando |
|---|---|---|
| los 13 perfiles (`all`): violento y rompejuegos para combate y ley; charlatán y pícaro para charla, comercio, prendas y robo; lanzador y tirador para el resto de la mecánica; los demás para lo suyo | combate, charla, cobertura de tools, fluidez, incoherencias | `npm run autoplay -- --profiles all --actions 40 --parallel 5 --live` (1,6 $) |
| 3 parejas: picaro:novato, violento:pausado, metodico:charlatan | concurrencia, chat, reacciones, robo entre jugadores | `npm run autoplay -- --pairs picaro:novato,violento:pausado,metodico:charlatan --actions 40 --parallel 3 --live` (0,8 $) |
| creatividad | lo imposible, lo que no existe, cuarta pared | `npm run bench:creativity -- --model claude-haiku-5-5 --effort low --live` (0,05 $) |
| conversación | voz de los NPC con y sin actor, juez con rúbrica | `node --env-file=.env --import tsx scripts/talk-bench.ts --live --cap 0.15` (0,15 $) |

Después, en cada tanda:

```
node --import tsx scripts/playtest-report.ts --run data/local/autoplay/<fecha> --window 40 --baseline data/local/autoplay/<tanda anterior>
```

El juez de errores corre solo al acabar `autoplay` (sin `--no-judge`); el juez de diversión no se lanza (`playtest-report`
sin `--live`). Entorno: `ACTOR_MODEL=claude-sonnet-5-5`, `MASTER_MODEL=claude-haiku-5-5`, `MASTER_EFFORT=low`.

Repeticiones previstas: una ahora (la foto de partida), una tras cada tanda de arreglos y una antes de la beta. Cinco
pasadas en el mes, **unos 15 $**. Una vez, además, los cuatro perfiles de combate y charla con `MASTER_EFFORT=medium`
(0,6 $) para ver si el esfuerzo medio baja las incoherencias.

**Partida a mano.** Una partida a dos de Miguel y Santi en tavernus.com, 30 a 40 turnos, con el guion de la taberna
(hablar con el parroquiano, bofetón de uno y robo del otro a la vez, detención, Hacer con comillas, Decir y Chat). Menos de
0,2 $. Es la única prueba de si es usable y divertido.

## Comparación de modelos, mínima

Una sola vez, para saber si Sonnet cambia algo en las mecánicas o solo escribe mejor:

| Tanda | Modelos | Coste |
|---|---|---:|
| Ruta fija de 10 acciones (`npm run bench -- --model <modelo> --effort low --live`), dos pasadas por modelo: coste, latencia y narración con los mismos dados | Haiku, Sonnet, Opus 5.5 | 3 $ |
| Combate y pareja con Sonnet de máster: `MASTER_MODEL=claude-sonnet-5-5` con violento y rompejuegos (40) y la pareja picaro:novato (40 por jugador) | Sonnet | 9 $ |
| Lo mismo con Opus 5.5, solo si Sonnet marca diferencia en algo que Haiku no hace | Opus 5.5 | 16 $ |

Con Sonnet y Opus, `--parallel 2`: el límite de tokens por minuto de la organización no está medido. Si salen 429, bajar
el paralelo.

**Unos 12 $** (28 $ con Opus).

## Lo que queda para cuando la historia esté reescrita

Presupuestado entonces, con el crédito que quede: los finales desde el acto III, el dirigido entero, la tanda completa de
11 perfiles × 300 acciones (11 $ con Haiku), el juez de diversión, los mundos generados (solo Brezal hasta entonces) y el
modelo por escena (`PROLOGUE_MODEL`, `FINAL_MODEL`, ya programado). Los comandos siguen en `scripts/autoplay.ts`.

## Calendario y presupuesto

| Cuándo | Qué | Acumulado |
|---|---|---:|
| 25-11 a 1-12 | Pasada corta (foto de partida) y partida a mano | 3 $ |
| 2-12 a 8-12 | Comparación de modelos y esfuerzo medio; arreglos y segunda pasada | 19 $ |
| 9-12 a 18-12 | Arreglos y pasadas tras cada uno | 28 $ |
| 19-12 a 24-12 | Beta cerrada: con `DAILY_MASTER_ACTIONS=200`, 0,54 $ por jugador y día a tope de cupo; cinco jugadores cinco días, 15 $ | 45 $ |

Quedan **unos 155 $** para la historia nueva y la beta. Lo que no se vaya a usar antes del 24-12 se gasta en más sesiones
de personas: el crédito no se guarda.

## Qué se mira en cada pasada

En las 40 acciones de cada partida, frente a la pasada anterior:

- Combate (violento): golpes declarados que acaban en ataque o con una razón (hoy 17 de 24 en toda una tanda), veces a
  0 PG (objetivo 5 o menos en 60), un solo «¡Alto!» por encuentro.
- Fluidez (todos): turnos con rechazo del máster (objetivo 12 % o menos), tiempo medio de respuesta, narraciones
  repetidas, sugeridas repetidas.
- Incoherencias (juez): errores de gravedad 3 (tool fallido narrado, trato sin estado, máster sin respuesta) a cero;
  lugares inventados y NPC fuera de alcance, a la baja.
- Charla (charlatán, pícaro): racha con el mismo NPC (objetivo 15 o menos), negativas literales (5 o menos), tiradas
  sociales (3 o más).
- Concurrencia (parejas): turnos compartidos sin su parte o sin lo común, a cero; crímenes apuntados al que no pegó, a
  cero; reacciones contestadas; chats que llegan al otro.
- Cobertura (tabla «Cobertura de tools»): las tools que quedan a cero en la pasada son lo que no se ha probado. Con los
  mecánicos se espera ver `cast_spell`, `spend_resource`, `use_item`, `take_rest`, `heal`, `harvest`, `roll_check` de
  sigilo y atletismo, `attack` a distancia y `transfer_item` por saqueo; una tool que el jugador pide y no aparece es un
  fallo del máster o del prompt, no del jugador.

Nada de esto dice si el juego es divertido. Para eso está la partida a mano.
