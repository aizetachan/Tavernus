# Plan de arreglos tras las tres tandas de pruebas (26-11-2026)

Entrada: los arreglos 1 a 18 y H1 a H8 de `docs/INFORME-PASADA-1-2026-11-25.md`, `-2` y `-3`. Salen de 2.200 acciones
de partida automática con Haiku, Sonnet y Opus de máster y de los tres benches; los tres modelos fallan igual, así que todo
va al prompt, a las guardas del motor, a los datos de Brezal y a las herramientas de prueba. Se mide después con la pasada
corta de Haiku bajo contra la referencia del 25-11.

## Cómo se trabaja

- **Cuatro paquetes, cuatro sesiones Opus en paralelo, cada una en su worktree y su rama** (`arreglos/<paquete>`), partiendo
  de `main` (14e1b5e). Cada paquete tiene sus ficheros; **nadie toca los ficheros de otro paquete**. Si un arreglo pide un
  cambio fuera de los ficheros propios, se deja escrito en el informe final del paquete y lo hace el dueño.
- **Sin API.** Todo se prueba con tests de vitest (`test/*.test.ts`, mundo en memoria, `MASTER_MODE=offline`), nunca con
  llamadas al modelo. Cada arreglo lleva su test, con el caso real del transcript como fixture cuando se pueda.
- **Memoria.** El PC va justo de RAM. Durante el trabajo, tests por fichero (`npx vitest run test/<uno>.test.ts`); la suite
  entera y el `typecheck` solo al final, con `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\hooks\con-tope.ps1" -GB 3 -Comando "npm test"`.
  Ningún servidor web, ningún Playwright, ningún autoplay.
- **Entrega.** Commits en la rama, push a `origin` (repositorio personal `aizetachan/Tavernus`, el hook de cuenta lo valida).
  Sin PR: la fusión a `main` la hace la sesión coordinadora tras revisar las cuatro ramas. Nada de `git add -A`:
  `.claude/launch.json` y `data/local` no se confirman nunca.
- **Textos.** Español, sin «·» ni «•» para separar textos. Los avisos al jugador cortos. Los hints de las tools, en el tono de
  los que ya hay.
- **Al acabar**, cada sesión deja al final de este documento (o en su informe de cierre) la lista de lo hecho, lo que no
  pudo cerrar y los cambios que pide en ficheros de otro paquete.

Material: transcripts en `data/local/autoplay/<tanda>/transcripts/*.md`, errores por turno en `report.md` de cada tanda.
Tandas: `20261125-1051` (13 perfiles Haiku), `20261125-1115` (3 parejas Haiku), `20261125-1206` y `-1217` (Sonnet),
`20261125-1231` (Haiku medio), `20261125-1652` y `-1703` (Opus). Los benches en `data/local/bench/`.

## Paquete A: guardas de `log_event` y de las tools

**Ficheros:** `src/ai/tools.ts`, `src/engine/closecheck.ts` y sus tests (`test/closecheck.test.ts`, `test/tools*.test.ts`,
nuevos). Nada en `prompt.ts`, `engine.ts`, `crime.ts`.

Principio: lo que el máster narra sin la tool que lo hace real se rechaza una vez, con un hint que dice qué tool falta;
a la segunda, pasa (como las guardas que ya existen: `transfer_item`, monedas por pagadas, golpe sin resolver).

1. **(1) Tools de estado que el máster no llama.** Guardas nuevas para: descansar («descansas», «echas una cabezada»,
   «pasas la noche») sin `take_rest`; curar o vendar («te vendas», «le cura», «estabilizas») sin `heal` o `stabilize`;
   recoger o coger algo del sitio sin `transfer_item` o `harvest`; lanzar un conjuro («lanzas», «conjuras») sin
   `cast_spell` o `spend_resource`; apuntar un hecho o recordar algo («te lo apunto», «lo recordará») sin
   `record_character_fact`; apuntar una deuda («me lo debes», «fiado») sin `set_debt`. En la pasada 1 quedaron a cero 25 de
   56 tools; la tabla «Cobertura de tools» del informe 1 dice cuál debía disparar cada una.
2. **(14) El primer trago se paga.** «Te sirve», «te pone», «te tiende la jarra» con un precio en la carta y sin `buy_item`
   ni `take_coins`: rechazo con el precio en el hint. Haiku lo narró gratis en las dos pasadas del bench
   (`data/local/bench/claude-haiku-5-5-low-*.json`, paso de la cerveza). Ojo con `closecheck.ts:140`, que ya detecta la
   entrega: la guarda debe sumar el cobro.
3. **(17) `settle_debt` y `set_debt` cuadrados con lo narrado.** Acreedor presente (ya se rechaza) y cantidad igual a lo
   que se mueve en el mismo cierre (monedas o `transfer_item`); si la narración dice «se queda el oro y la plata» y la tool
   dice 150, rechazo con el motivo. Opus, pareja `20261125-1703`, turno 5.
4. **(5) Tool fallido narrado como hecho.** Cuando una tool devuelve error en el cierre, la narración que la da por
   hecha se rechaza en `log_event` (hoy lo ve `closecheck` después, como `tool_fallido_narrado`). Explorador 22 y dirigido
   18 de `20261125-1051`.
5. **(2, parte de la guarda) Desenlace contra la tirada enfrentada.** Si la reacción de otro jugador se resolvió (resiste
   y gana, o pierde), el cierre que narra lo contrario se rechaza como `tool_fallido_narrado`. La parte de que el resultado
   llegue al contexto del cierre es del paquete B; aquí se lee del estado que ya exista (reacciones resueltas del actor).
   Pareja `20261125-1115`, pícaro turno 36.
6. **(8) Cierres de grupo sin `narration_by_pc`.** Hoy `closecheck.ts:671` avisa una vez; que el cierre compartido sin la
   parte de cada jugador que actuó se rechace siempre (hasta el tope de rechazos habitual), con el aviso que ya existe.
   4 de 23 cierres en la pasada 1, 1 de 9 con Sonnet, 1 de 12 con Opus.
7. **(12, parte de la guarda) Daño sin ataque.** Un cierre que baja PG al actor o narra que un NPC le pega («te mete el
   martillo en las costillas», «la maza te entra en la sien») sin `attack` o `conflict_act` de ese NPC en el mismo turno
   se rechaza con hint «el golpe de X pasa por attack». La lógica de la represalia del NPC es del paquete B.
   Violento `20261125-1652`, turno 3 (Atletismo 11, éxito, y Hugo golpea: 14 → 11 PG).

Criterio: cada guarda con test que reproduce la narración del transcript y comprueba el rechazo, el hint y que a la
segunda pasa. Las guardas existentes (contador de rechazos en `tools.ts:418-488`) son el modelo.

## Paquete B: ley, combate y reacciones

**Ficheros:** `src/engine/crime.ts`, `src/engine/conflict.ts`, `src/engine/reactions.ts`, `src/engine/engine.ts` (solo las
partes de reacción de NPC, arresto y enrutado de la acción), `src/engine/conversation.ts` solo para el arreglo 7, y sus tests
(`test/crime.test.ts`, `test/conflict.test.ts`, `test/reactions.test.ts`, `test/npc-combat.test.ts`, `test/ley-*.test.ts`,
nuevos). Nada en `tools.ts`, `closecheck.ts`, `prompt.ts`.

1. **(12) Represalias de NPC sin tirada.** Cuando el jugador gana su tirada (Atletismo, Intimidar) y el NPC responde con un
   golpe, ese golpe pasa por `attack` o `conflict_act` del NPC con su tirada, o no pasa. Hoy la reacción del NPC se narra
   y el daño se aplica de palabra. Sale con los tres modelos: violento turnos 7, 18 y 45 de `20261125-1051`, 7 y 45 de
   `-1206`, 3 de `-1652`. La guarda que rechaza el cierre es del paquete A; aquí, que el motor resuelva la reacción del
   NPC con tirada y la ponga en el contexto del cierre como hecho (quién pega, tirada, daño).
2. **(3) Golpe que acaba en robo y cargo equivocado.** Si la frase trae un golpe, primero `attack`; el motor no deduce
   robo de «arrancar la camisa»; el arresto cita el incidente que lo provoca, no el primero de la lista. Violento 32 de
   `20261125-1051`. `conflict_act` vive en `tools.ts` (paquete A): si hace falta tocar ahí, pedirlo en el informe.
3. **(15) Desarmar o quitar un objeto en un conflicto abierto no es robo.** Un `transfer_item` desde un NPC con el que
   hay `conflict_act` o `attack` en el mismo cierre (o combate abierto) no genera incidente de robo ni etiqueta «ladrón»
   ni «te buscan». Violento `20261125-1652`, turno 4 (le quita el martillo a Hugo con Atletismo 12 y sale «ladrón»).
   `reportIncident` y lo que lo llama desde `engine.ts`.
4. **(6) Triple «¡Alto!».** Si el máster ya narró la detención, las líneas de incidente y arresto del motor no la repiten.
   Comparar la narración del cierre con las frases que añade el motor (`crime.ts`, `engine.ts`).
5. **(10) Autoridad contra el preso, huida sin efecto y traslado sin narrar.** Rompejuegos 43 y 12, violento 49 de
   `20261125-1051`: un éxito de huida tiene que soltarle o moverle; una orden del preso a Garrán no le hace caso; el
   traslado al calabozo tras el arresto se narra (hoy aparece en la celda sin transición: Opus violento turnos 22 y 23).
6. **(2, parte del motor) El resultado de la reacción llega al cierre.** Cuando el otro jugador resiste y el servidor tira
   la enfrentada, el resultado (quién gana, tiradas) entra en el contexto del máster como hecho antes de que narre el
   desenlace. `reactions.ts`, `engine.ts`. La guarda del cierre contrario es del paquete A.
7. **(9) Reacción como gesto, no como frase dicha.** Las dos reacciones de la pasada 1 llegaron como si el jugador hubiera
   dicho la frase. `reactions.ts` y el texto que se le pasa al máster (si está en `prompt.ts`, pedirlo al paquete C).
8. **(7) Robo a otro jugador que cae en la respuesta sin máster.** Pareja `20261125-1115`, pícaro turno 9: la acción de
   robar al compañero entró por la ruta de conversación y la contestó el motor. Enrutado en `engine.ts` y la detección en
   `conversation.ts`: lo que lleva `request_reaction` va al máster.
9. **(18, parte del motor) Robo entre jugadores con tirada enfrentada.** Comprobar que `request_reaction` con
   `sleight_of_hand` contra `perception` ya hace la enfrentada oculta (Opus la usó: pareja `20261125-1703`, turno 38) y que
   el resultado llega al cierre; lo que falte, aquí. La guía al máster es del paquete C.

Criterio: tests de motor con el mundo en memoria para cada caso, sin modelo (el máster offline o un cierre fabricado).

## Paquete C: prompt, conversación y datos de Brezal

**Ficheros:** `src/ai/prompt.ts`, `src/engine/conversation.ts` (menos el enrutado del arreglo 7, que es del B),
`src/data/campaigns/brezal/*.ts`, y sus tests (`test/conversation.test.ts`, `test/brezal.test.ts`, `test/context.test.ts`,
nuevos). Nada en `tools.ts`, `engine.ts`, `crime.ts`.

1. **(1, parte del prompt) Guía de tools de estado.** Una lista corta y clara en el prompt: descansar es `take_rest`, curar
   es `heal`, apuntar es `record_character_fact`, fiar es `set_debt`, servir es `buy_item`… Con un ejemplo de cada una.
   Las 25 tools a cero de la pasada 1 y por qué (informe 1, «Cobertura de tools»).
2. **(13) Cerrar conversaciones y mover la escena.** Tope de turnos seguidos con el mismo NPC: el NPC se va, cambia de tema,
   pide algo o cierra. Haiku dejó rachas de 24 y 27 turnos (violento y rompejuegos, `20261125-1051`); Sonnet las bajó a 10
   y 5 solo con su criterio. Prompt y `conversation.ts` (contador de turnos con el mismo NPC ya existe para «Mayor racha»).
3. **(4) Tope de 40 palabras en conversación.** 40 rechazos en la pasada 1 por pasarse: la regla en el prompt de
   conversación, con la lista de gestos ya narrados para que no los repita.
4. **(11) «No» seco y tiradas sociales escasas.** Ante una petición plausible, pedir Persuasión o Engaño o soltar un rumor
   (`plant_rumor`) en vez de negar en seco (creatividad 3 de 6; charlatán 0 tiradas sociales, pícaro 2). Y lo contrario
   que también sale: contestar lo que el jugador inventa como si fuera dato del mundo (rompejuegos Opus turno 4, «la Torre
   Blanca»): negar lo inventado con ingenio.
5. **(12 y 18, parte del prompt) Represalias y robo entre jugadores.** Dos líneas: un NPC que pega lo hace con `attack`,
   nunca de palabra; un jugador que le quita algo a otro va por `request_reaction` y la enfrentada la hace el servidor
   (como hizo Opus: «Juego de manos 20 contra 17»). Fiar o aplazar una deuda es `set_debt`.
6. **(14, parte del prompt) El primer trago se paga:** una línea junto a la de `buy_item`.
7. **(16) Punto «pasillo» en la casona.** `src/data/campaigns/brezal/map.ts`, `loc_casona`: el calabozo (`sp_ca_calabozo`)
   está «detrás de la despensa» y el máster cita «el pasillo» desde la celda; siete `log_event` rechazados entre Opus y
   Sonnet. Añadir el pasillo de la despensa como punto o como alias de la despensa o del calabozo, y comprobar que
   `npm run wiki` sigue construyendo.
8. **Revisar el prompt entero contra los informes** por si hay instrucciones que ya contradicen lo que se pide (narrar sin
   tool, longitud, cerrar sin `log_event`). Opus también se pasó del tope de 140 palabras cuatro veces.

Criterio: tests de que el prompt contiene las guías (como los de `test/context.test.ts`), de la racha en `conversation.ts`
y del punto nuevo en Brezal (`test/brezal.test.ts`, coherencia del mapa).

## Paquete D: herramientas de prueba

**Ficheros:** `scripts/autoplay.ts`, `scripts/playtest-report.ts`, `scripts/judge.ts`, `scripts/model-bench.ts`,
`scripts/creativity-bench.ts` y sus tests (`test/autoplay.test.ts`, `test/report.test.ts`, `test/creativity.test.ts`,
nuevos). Nada en `src/`.

1. **H1. Ficha del jugador automático.** `playerSheet` (`autoplay.ts:401`) imprime `Monedas: ${c.coins}`, campo que ya no
   existe (el dinero va en bolsas, `src/engine/money.ts`): sale «undefined» y con Sonnet y Opus llega a la narración. Poner
   las monedas de las bolsas, los conjuros y los recursos de clase. Lo mismo en `TurnState.coins` (`autoplay.ts:245, 722`).
2. **H2 y H6. Métrica «Verbos de ataque con tirada».** `ATTACK_VERB` (`playtest-report.ts:236`) cuenta amenazas y no ve
   golpes: «0 de 14» donde a mano son 3 de 4. Contar acciones del PJ con `attack` o tirada de ataque en el turno, y
   descartar frases condicionales («si», «o», «como»). Hasta entonces la columna no compara modelos.
3. **H3. Juez.** Negar lo que el jugador inventa es correcto (no `incoherencia`); `prenda_sin_estado` y `trato_sin_estado`
   deben mirar el prólogo y los recuerdos de amenazas. `judge.ts`.
4. **H4. Detector de cuarta pared** en `creativity-bench.ts`: quitar el eco de la frase del jugador antes de buscar.
5. **H5. `--model` del bench pierde contra `MASTER_MODEL`.** `effectiveModel` (`src/ai/master.ts:81`) da prioridad a la
   variable de entorno. Sin tocar `src/`: `model-bench.ts` pone `process.env.MASTER_MODEL` y `MASTER_EFFORT` a lo que piden
   `--model` y `--effort` antes de arrancar, o se niega a arrancar si no coinciden. Igual en `autoplay.ts` si algún día
   lleva `--model`. Dos pasadas de la tanda 2 corrieron con el modelo equivocado por esto.
6. **H7. Coste de las partidas que no acaban.** `summary.json` marca 0 $ para una tanda cortada con unas 40 acciones de
   Opus jugadas (`20261125-1557`). Guardar acciones y coste parciales de cada partida aunque termine en error, y que
   `playtest-report` los muestre.
7. **H8. `--max-usd-game` en pareja.** El tope se reparte entre los dos jugadores y `playtest.md` marca «presupuesto»
   aunque se jugaran las 40 acciones (`20261125-1703`). Decidir (tope por jugador) y que el fin diga la verdad.

Criterio: tests con los `summary.json` y transcripts de `data/local/autoplay` como fixtures copiados a `test/fixtures`
(recortados), sin API.

## Después (sesión coordinadora)

1. Revisar las cuatro ramas, fusionarlas en `main` por orden D, C, A, B (D no toca `src`; C y A y B no comparten
   ficheros salvo `conversation.ts` entre B y C, que se revisa a mano), `npm test` y `typecheck` tras cada fusión.
2. Pasada corta con Haiku bajo (la orquestadora, cuando Miguel lo pida):
   `npm run autoplay -- --profiles all --actions 40 --parallel 5 --live` y las tres parejas, con
   `--baseline data/local/autoplay/20261125-1051` y `20261125-1115`. Unos 3 $.
3. Lo que se mira: cobertura de tools (las 25 a cero), errores por 100 acciones (56 en combate con Haiku), rachas con un
   NPC (24 y 27), represalias sin tirada (0 esperadas), `undefined` (0), rechazos del motor por «pasillo» (0).

## Estado (26-11-2026, tras la fusión)

Los cuatro paquetes se hicieron en paralelo en cuatro sesiones Opus y se fusionaron en `main` en el orden D, C, A, B
sin conflictos (`conversation.ts` lo casó git solo). Remates cruzados hechos al fusionar: la guarda del arreglo 2 lee
`engine.reactionOutcomeOf()` y cita las tiradas; el prompt dice que el daño de un NPC nunca va por `apply_damage` y que
lo que un NPC recordará va en `npc_memory_note`. La suite entera solo acaba con `npx vitest run --maxWorkers=2` dentro del
tope de 3 GB.

Lo que quedó abierto, para después de medir con la pasada corta:

- **A.** El cierre de grupo sin la parte de cada uno se rechaza dos veces y luego pasa (si rechazara siempre, el cierre
  forzado de `master.ts` dejaría al jugador sin respuesta). La guarda de daño sin `attack` no cubre a los NPC que no son
  de pelear (su golpe no letal va por `apply_damage` en `combat.ts`). `settle_debt` no entiende «la mitad» ni cantidades sin
  moneda. «Apúntala a mi cuenta» dicho por el jugador no cuenta como deuda hasta que el NPC la acepta.
- **B.** Cuando `conflict_act` se resuelve sin tirada, la represalia del NPC no pasa por el motor (lo resuelve `tools.ts`).
  Tras una tirada no conflictiva el máster no ve la represalia antes de narrar (`prompt.ts` solo enseña `engineDone` al
  caducar una ventana decisiva). La huida con éxito no mueve al personaje. Que la autoridad no obedezca al preso solo se
  dice en el contexto.
- **C.** El tope de racha con un NPC avisa en el contexto (turno 6 pide algo nuevo, turno 8 pide cerrar) pero ninguna
  guarda rechaza el cierre. Las respuestas del motor sin máster no ven el aviso.
- **D.** El tope `--max-usd-game` es ahora por jugador: una pareja con tope X puede gastar 2X. La detección de golpes sigue
  siendo por texto. El coste de la tanda cortada `20261125-1557` no se recupera.
