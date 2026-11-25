# Informe de la pasada corta 1 (25-11-2026)

Primera tanda real del plan `docs/PLAN-PRUEBAS-CREDITOS.md`: la foto de partida, sin `--baseline`. Máster `claude-haiku-5-5` a
esfuerzo `low`, actor `claude-sonnet-5-5` (como en producción), jugador automático y juez de errores con Haiku, semilla 1,
campaña Brezal. La lanzó la sesión orquestadora; el análisis es de esta sesión, sobre los informes generados y los transcripts.

| Tanda | Dónde | Qué |
|---|---|---|
| 1 | `data/local/autoplay/20261125-1051` | 13 perfiles de un jugador, 40 acciones cada uno |
| 2 | `data/local/autoplay/20261125-1115` | 3 parejas (picaro:novato, violento:pausado, metodico:charlatan), 40 acciones por jugador |
| 3 | `data/local/bench/creativity-claude-haiku-5-5-low-2026-11-25T10-30-03Z.md` | banco de creatividad, 25 prompts |
| 4 | `data/local/bench/talk-2026-11-25T10-36-39.md` | banco de conversación, 7 charlas en 4 variantes |

En cada carpeta de autoplay: `playtest.md` (métricas), `report.md` (errores por turno) y `transcripts/`. Un primer intento a las
09:52 (`20261125-0952`) falló entero con 401: la clave de `.env` no valía. Coste de ese intento, 0 $.

## Coste

| Tanda | Plan | Real |
|---|---:|---:|
| 13 perfiles | 1,60 $ | 1,71 $ (partidas 1,62 y juez 0,09) |
| 3 parejas | 0,80 $ | 0,60 $ (partidas 0,57 y juez 0,03) |
| creatividad | 0,05 $ | 0,04 $ |
| conversación | 0,15 $ | 0,12 $ |
| **Total** | **2,60 $** | **2,46 $** |

Por acción del máster: 0,0029 $ en solitario y 0,0022 $ en pareja (los cierres compartidos sirven a dos jugadores con una
llamada). Coincide con los 0,0027 $ medidos el 31-10, así que el presupuesto del plan sigue valiendo. Ningún 429 con cinco
partidas en paralelo.

## Lo que dice la pasada, en corto

1. **El máster narra sin tocar el estado.** Descansar, curar, recolectar, lanzar un conjuro o fiar se cuentan en prosa y no
   pasan por su tool. De 56 tools, 31 usadas; `cast_spell` una vez en 760 acciones; `take_rest`, `heal`, `harvest`,
   `spend_resource`, `set_debt` y `stabilize`, a cero. Es el fallo que más pesa, porque sin estado detrás nada de eso tiene
   consecuencia después.
2. **Cuando hay tirada, el desenlace a veces la ignora.** Un robo entre jugadores gana 13 contra 5 y la narración frena la
   mano; un `transfer_item` fallido se da por hecho; un éxito de Acrobacias para huir acaba con tres ataques encima.
3. **La violencia declarada casi nunca es un ataque.** El violento «ataca» 12 veces y 8 son amenazas condicionales («si entra,
   le parto el hacha»). De los 4 golpes reales, 3 van con tirada y 1 acaba rechazado y apuntado como robo.
4. **El 18 % de los turnos lleva un rechazo de tool por dentro** (objetivo, 12 %). Casi la mitad es el tope de 40 palabras en
   conversación. El jugador no lo ve, pero cada rechazo cuesta una llamada más y unos segundos.
5. **A dos funciona.** 23 cierres compartidos, 13 chats que llegan, 2 reacciones contestadas, ningún crimen al que no pegó.
   Quedan 4 cierres sin la parte de uno de los dos, y la espera media sube de 9,5 s a 17 s.
6. **El actor Sonnet no aporta nota.** Director y actor Haiku sacan la misma media que director Haiku y actor Sonnet (4,20),
   treinta veces más barato y seis veces más rápido. Muestra corta (7 charlas), pero clara.
7. **El juez de errores exagera.** De 17 hallazgos de gravedad 3, se sostienen 6. Los 225 «errores» de la tanda 1 son sobre
   todo `incoherencia_contexto` del juez (95), y muchos son el máster negando bien lo que el jugador inventa.

## Métricas del plan

Objetivos de «Qué se mira en cada pasada». Primera pasada: estos valores son la base de la segunda.

| Métrica | Valor | Objetivo | Cumple |
|---|---|---|---|
| Golpes declarados que acaban en ataque o con razón (violento) | 3 de 4 golpes reales (la columna del informe dice «0 de 14»: cuenta amenazas, ver H2) | todos | casi |
| Veces a 0 PG | 4 en 760 acciones | 5 o menos en 60 | sí |
| Un solo «¡Alto!» por encuentro | 3 por detención (narración, línea del incidente, línea del arresto); el pícaro lo oye 6 veces en 2 detenciones | 1 | no |
| Turnos con rechazo del máster | 18 % solo, 12 % en pareja | 12 % o menos | no en solitario |
| Espera media | 9,5 s solo (6,6 s pausado a 12,7 s violento; P95 hasta 25,5 s); 17 s en pareja | sin objetivo | base |
| Narraciones repetidas | 0 | a la baja | sí |
| Arranques repetidos | «te agachas junto…» 14, «te acercas a…» 10 | a la baja | base |
| Errores de gravedad 3 (juez) | 17 marcados, 6 reales | 0 | no |
| Lugares inventados (rechazados) | 5 solo, 1 pareja | a la baja | base |
| NPC fuera de alcance | 6 solo, 2 pareja | a la baja | base |
| Racha con el mismo NPC (charlatán, pícaro) | 11 y 12 solo; 4 y 10 pareja | 15 o menos | sí |
| Negativas literales (charlatán, pícaro) | 2 y 3 solo; 0 y 1 pareja | 5 o menos | sí |
| Tiradas sociales (charlatán, pícaro) | 0 y 2 solo; 0 y 0 pareja | 3 o más | no |
| Cierres compartidos sin su parte | 4 de 23 | 0 | no |
| Cierres compartidos sin lo común | 0 | 0 | sí |
| Crímenes al que no pegó | 0 | 0 | sí |
| Reacciones contestadas | 2 de 2 | todas | sí |
| Chats que llegan al otro | 13 de 13 | todos | sí |

Fuera de los objetivos, pero que se ve: el metódico pasa 23 acciones seguidas con Ilse, el rompejuegos 27 con Garrán y el
violento 24 con Mateo. Solo el metódico cumple una misión (`q_agua`, acción 18). Eso es la historia, que se reescribe, no se
mide ahora.

### De dónde sale el 18 % de rechazos

| Rechazo | Veces | Ejemplo |
|---|---:|---|
| Narración de conversación de más de 40 palabras o con gestos ya narrados (`src/engine/conversation.ts`) | 40 | rompejuegos con Garrán (13), impredecible con Ilse (8) |
| `log_event` rechazado porque otra tool del mismo cierre falló | 12 | dirigido: `grant_clue` falló y el cierre lo daba por hecho |
| El NPC suelta la pista sin que se la ganen («Cómo responde…») | 11 | charlatán con Ilse |
| «Guardas» o «metes» sin `transfer_item` | 10 | dirigido |
| `transfer_item` fuera de alcance o con las manos llenas | 10 | dirigido, explorador |
| Gente que no existe («un hombre») | 5 | impredecible |
| Golpe declarado que el cierre no resuelve | 5 | lanzador |

Las guardas hacen su trabajo: el cierre malo no llega al jugador. Pero el tope de palabras debería estar en el prompt, no
solo en la guarda.

## Cobertura de tools

31 de 56 en toda la pasada (29 en la tanda 1, más `get_character` y `request_reaction` en parejas; `record_character_fact`
solo en creatividad). Lo más llamado: `log_event` 718, `move_to` 69, `get_location` 26, `who_is_here` 25, `npc_trust` 24,
`transfer_item` 24, `conflict_act` 20, `grant_clue` 14, `attack` 13, `apply_damage` 10.

Las 25 a cero, con quién debía provocarlas y qué pasó:

| Tool | Quién | Qué pasó |
|---|---|---|
| `take_rest` | lanzador (acciones 10, 27), tirador (12, 28) | descanso narrado («Te sientas en el brocal… respiras despacio»), sin tool. Máster |
| `harvest` | tirador (2, 17, 33) | lo resuelve narrando o con tirada. Máster |
| `heal` | lanzador (11, 28), tirador (13, 29), pausado con el violento caído | el lanzador pide «Palabra curativa», que no conoce: negativa correcta. El tirador se venda y no hay tool. Mitad perfil, mitad máster |
| `spend_resource` | lanzador (3, 19, 34), tirador (5, 20, 37) | el lanzador pide Metamagia y puntos de hechicería a nivel 1: negativa correcta. El tirador usa «Marca del Cazador» sin tool. Sobre todo perfil |
| `cast_spell` (1 vez) | lanzador | acción 1: Rayo de escarcha resuelto como tirada de Carisma; 33 y 36: narrado sin tool. Máster |
| `stabilize` | pausado junto al violento caído | el violento se salva con sus tiradas contra la muerte |
| `restrain_npc`, `add_condition` | violento (24: «le agarro del cuello») | Atletismo sin estado de agarrado |
| `set_debt`, `settle_debt`, `pawn_item`, `take_coins` | charlatán, pícaro (fiado, prendas); novato pregunta cómo pagar | el pícaro en pareja pide fiado («apúntamela», acción 37) y no queda deuda. Máster |
| `sell_item` | pícaro, charlatán | nadie vendió; `buy_item` 3 veces |
| `lookup_rule` | novato | el máster contesta de memoria |
| `use_scroll` | lanzador (28) | no era pergamino de conjuro: negativa correcta |
| `remove_condition`, `attune_item`, `report_incident`, `complete_job`, `give_quest`, `finish_quest`, `cancel_hook`, `schedule_event`, `spawn_item`, `update_location_state` | nadie en 40 acciones; las de misión dependen del guion | no es fallo |

Lo que impide medir bien a los perfiles mecánicos es su ficha (H1): el jugador automático no sabe qué conjuros ni recursos
tiene y los inventa. La hechicera conoce `fire_bolt`, `ray_of_frost`, `mage_hand`, `light`, `magic_missile` y `shield`, y pidió
«Toque electrizante», «Palabra curativa», «Chispa Arcana» y «Toque glacial».

## Incoherencias que se sostienen

«Turno» es el número de `report.md`; «acción», el del transcript.

- **Robo entre jugadores contra la tirada.** Pareja pícaro:novato, acción 36: «Juego de manos 13 contra Percepción 5: ganas
  tú. Lo consigues.» Y acto seguido: «Tu mano se detiene a un dedo de su cinto». El juez no lo marcó.
- **Puñetazo que acaba en robo y acusación vieja.** Violento, acción 32: «Le hundo el puño en las costillas al molinero y le
  arranco la camisa». El cierre se rechaza («Mateo no está en este sitio»), el motor apunta «has intentado robarle al
  molinero», y Garrán llega y le acusa de otra cosa: «el jornalero atacó a Hugo en el banco de trabajo». Tres fallos en un
  turno: golpe sin ataque, robo que no era, cargo que no corresponde.
- **Tool fallido narrado como hecho.** Explorador, turno 22: `transfer_item` devuelve `no_space` y «tomas uno de los eslabones».
  Lo mismo en dirigido, turno 18: manos ocupadas y «los guardas en la mochila».
- **Éxito sin efecto.** Rompejuegos, turno 12: Acrobacias 16 contra CD 13 para huir, y tres ataques le dejan en el suelo sin
  decir qué compró el éxito.
- **Preso golpeado sin motivo.** Rompejuegos, turno 43: Lope grita desde el calabozo y Osric le deja inconsciente sin tirada
  visible.
- **Traslado sin narrar.** Violento, turno 49: del molino al calabozo de la casona de una línea a otra.
- **Reacción contestada en pareja, y luego ignorada.** Violento:pausado, acción 38 y 39: el pausado da una ración a la caída
  («le pones la ración en la mano»), `use_item` no se ejecutó y el turno siguiente dice «la ración sigue en tu mochila».

Falsos positivos del juez, para arreglar el juez y no el juego: negar lo que el jugador inventa (tirador 11 y 18, pícaro 9),
NPC que se fue antes (charlatán 8), horarios de NPC (charlatán 35, pícaro:novato 8, a comprobar con `get_schedule`),
recuerdos de amenazas tomados por prendas (`prenda_sin_estado` en violento 48 y en la pareja 38 y 40), el «a cambio de» del
prólogo (`trato_sin_estado`, pareja turno 0), y la caída y reaparición leídas sin el turno anterior (pareja 35 y 36).

## Parejas

- 23 cierres compartidos (9 pícaro:novato, 7 violento:pausado, 7 metódico:charlatán). En 4 faltó `narration_by_pc` para
  uno de los dos (violento 2, pausado 1, metódico 1), que leyó la narración mezclada. En la acción 31 el texto es para quien
  empuja («Trastabillas hacia atrás y el yunque te frena las caderas») y lo lee también el empujado.
- Robo al compañero, dos intentos del pícaro. Acción 9: contesta el motor solo, en 3,7 s, con una frase de relleno del
  «jornalero», y el robo ni se resuelve ni se rechaza. Acción 36: tirada enfrentada y desenlace al revés (arriba).
- Reacciones: 2 de 2 contestadas. Pausado contra el empujón (Acrobacias 12 contra Atletismo 16, gana quien empuja, la
  narración lo respeta) y novato contra el robo. En las dos, el texto de la reacción vuelve como si fuera una frase dicha
  («Me resisto, clavo los pies…»): el campo libre de la reacción debería ser gesto, no diálogo.
- Crímenes: el violento empuja a Hugo (acción 31, Atletismo 15) y el incidente le cae a él. Ninguno al que no pegó.
- Chats: 13 de 13 llegan al otro como «X te dice: …».
- El violento en pareja no llega a dar un solo `attack`: amenaza, empuja una vez y acaba detenido.

## Creatividad y conversación

**Creatividad**: 20 de 25. Lo imposible se rechaza con ingenio en los 7 casos (capa de Superman, móvil, dragón de bolsillo,
levantar la taberna, tarjeta de crédito, teletransporte, mosquete), los hechos del personaje se registran (2 de 2) y el
rumor del jugador también. Fallan 3 de 6 siembras de rumor ante peticiones plausibles (el herrero enano que debe dinero, el
mapa de las minas viejas, la escolta de caravana): Brenna dice «no» seco y no deja nada que seguir. «Lo hago» sin contexto
no acaba en pregunta (c13). El fallo de cuarta pared (c17) es del detector: Brenna contesta en ficción («No sé qué es eso
de IA, forastero»), pero el máster repite entre comillas la frase del jugador y el detector encuentra «IA».

**Conversación**: 7 charlas de partidas reales, 4 variantes, juez con rúbrica de 1 a 5.

| Variante | Media | Coste por turno | Latencia |
|---|---:|---:|---:|
| A: Haiku, prompt antiguo | 3,46 | 0,0038 $ | 7,1 s |
| B: Haiku con reglas de conversación | 3,71 | 0,0021 $ | 7,0 s |
| C: director Haiku, actor Sonnet (producción) | 4,20 | 0,0097 $ | 11,6 s |
| C2: director y actor Haiku | 4,20 | 0,0003 $ | 1,8 s |

C gana en personalidad (4,3 contra 3,7) y pierde en naturalidad (3,4 contra 4,0): el actor Sonnet alarga y se enrolla («Pues
va de un paseo, nada del otro mundo, o bueno, a ver…»). Con la misma nota, C2 es treinta veces más barata y seis veces más
rápida. Cambiar `ACTOR_MODEL` a Haiku es decisión de Miguel; con 7 charlas, conviene repetir el banco con más antes de
decidir. La variante D (Sonnet para todo) no entró en el tope de 0,15 $.

## Arreglos, por prioridad

Nada se toca hasta tener todos los informes (Miguel, 25-11). Esta lista es la entrada de esa sesión de arreglos.

Del juego:

1. **Las tools de estado que el máster no llama.** Guarda en `log_event` como la de «guardas sin `transfer_item`»: narrar
   «descansas», «te vendas», «recoges», «lanzas», «te lo apunto» sin su tool se rechaza; y guía en el prompt. `src/ai/tools.ts`,
   `src/ai/prompt.ts`. Es lo que más cobertura recupera de golpe.
2. **Desenlace que contradice la tirada enfrentada** (pareja, pícaro 36). El resultado de la reacción tiene que llegar al
   cierre como hecho y el cierre contrario rechazarse como un `tool_fallido_narrado`. `src/engine/reactions.ts`,
   `src/engine/engine.ts`, guarda de `log_event`.
3. **Golpe que acaba en robo, y cargo equivocado al detener** (violento 32). Si la frase trae un golpe, primero `attack`; el
   motor no debe deducir robo de «arrancar la camisa»; y el arresto debe citar el incidente que lo provoca, no el primero de
   la lista. `src/ai/tools.ts` (`conflict_act`), `src/engine/crime.ts`.
4. **Tope de 40 palabras en conversación** (40 rechazos). Al prompt de conversación, con la lista de gestos ya narrados.
   `src/ai/prompt.ts`, `src/engine/conversation.ts`.
5. **Tool fallido narrado como hecho** (explorador 22, dirigido 18). La guarda de `log_event` debería frenar lo que el
   detector `closecheck` ve después. `src/engine/closecheck.ts`, `src/ai/tools.ts`.
6. **Triple «¡Alto!»** en cada detención. Si el máster ya lo narró, las líneas de incidente y arresto no lo repiten.
   `src/engine/crime.ts`, `src/engine/engine.ts`.
7. **Robo a otro jugador que cae en la respuesta sin máster** (pareja, pícaro 9). `src/engine/conversation.ts` y el enrutado en
   `src/engine/engine.ts`.
8. **Cierres de grupo sin `narration_by_pc`** (4 de 23). Rechazar el cierre que no traiga la parte de cada jugador.
   `src/ai/tools.ts`.
9. **Reacción como gesto, no como frase dicha** (las 2 reacciones). `src/engine/reactions.ts` y el prompt de la reacción.
10. **Autoridad contra el preso y éxito de huida sin efecto** (rompejuegos 43 y 12); **traslado tras el arresto sin narrar**
    (violento 49). `src/engine/crime.ts`, reacción de NPC en `src/engine/engine.ts`.
11. **«No» seco ante peticiones plausibles y tiradas sociales escasas** (creatividad 3 de 6; charlatán 0, pícaro 2). Empujar
    a `plant_rumor` y a pedir Persuasión o Engaño cuando el jugador insiste. `src/ai/prompt.ts`.

De las herramientas de prueba (antes de la segunda pasada, para que mida al máster y no al jugador):

- **H1. Ficha del jugador automático.** `playerSheet` en `scripts/autoplay.ts` imprime `Monedas: ${c.coins}`, campo que ya no
  existe (el dinero va en bolsas, `money.ts`): sale «Monedas: undefined» y el novato lo pregunta siete veces. No lista
  conjuros ni recursos de clase, y por eso el lanzador los inventa.
- **H2. Métrica «Verbos de ataque con tirada».** `ATTACK_VERB` en `scripts/playtest-report.ts` cuenta amenazas («te parto el
  yelmo») y no ve golpes («le planta la frente»): da «0 de 14» donde a mano son 3 de 4. Contar acciones con `attack` del PJ o
  tirada de ataque, y descartar frases con «si», «o», «como».
- **H3. Juez.** Decirle que negar lo que el jugador inventa es correcto; `prenda_sin_estado` y `trato_sin_estado` ignoran el
  prólogo y los recuerdos de amenazas. `scripts/judge.ts`.
- **H4. Detector de cuarta pared** en `scripts/creativity-bench.ts`: quitar el eco de la frase del jugador antes de buscar.

## Siguiente tanda

Sin arreglos entre medias, la segunda pasada corta no aporta: la misma foto. Lo que sigue es la comparación de modelos y el
esfuerzo medio del plan, para saber si lo de arriba es de Haiku a esfuerzo bajo o del prompt y el motor:

```
npm run bench -- --model claude-haiku-5-5 --effort low --live
npm run bench -- --model claude-sonnet-5-5 --effort low --live
npm run bench -- --model claude-opus-5-5 --effort low --live
MASTER_MODEL=claude-sonnet-5-5 npm run autoplay -- --profiles violento,rompejuegos --actions 40 --parallel 2 --max-usd-game 3 --live
MASTER_MODEL=claude-sonnet-5-5 npm run autoplay -- --pairs picaro:novato --actions 40 --parallel 1 --max-usd-game 5 --live
MASTER_EFFORT=medium npm run autoplay -- --profiles violento,rompejuegos,charlatan,picaro --actions 40 --parallel 4 --max-usd-game 0.5 --live
```

Unos 13 $. Los informes de esas tandas se comparan con esta con `--baseline data/local/autoplay/20261125-1051` (y
`20261125-1115` para la pareja). Opus de máster en combate y pareja (16 $) solo si Sonnet cambia algo que Haiku no hace.
