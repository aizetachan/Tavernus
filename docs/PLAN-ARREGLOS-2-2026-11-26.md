# Plan de arreglos 2: lo que sale del análisis de las partidas (26-11-2026)

Entrada: los arreglos 30 a 44 y H13 a H16 de `docs/ANALISIS-PARTIDAS-2026-11-26.md`, que leyó turno a turno las 23 partidas
de las tandas 4 y 5 (`data/local/autoplay/20261126-0418`, `-0442` y `-0602`). Ahí están los patrones, las partidas y los
turnos que citamos aquí (charlatán T11, pareja metódico M15…). Se mide después con la pasada corta de Haiku bajo contra
esas tres tandas.

## Cómo se trabaja

Igual que en `docs/PLAN-ARREGLOS-2026-11-26.md`, «Cómo se trabaja», que vale entero. En resumen:

- **Cinco paquetes, cinco sesiones Opus en paralelo, cada una en su worktree y su rama**, partiendo de `main` (806cd69).
  Cada paquete tiene sus ficheros; **nadie toca los ficheros de otro paquete**. Si un arreglo pide un cambio fuera de los
  propios, se deja escrito en el informe final del paquete y lo hace el dueño o la sesión coordinadora al fusionar.
- **Sin API.** Todo se prueba con vitest (`test/*.test.ts`, mundo en memoria, `MASTER_MODE=offline`), con el caso real del
  transcript como fixture cuando se pueda. Ningún servidor web, ningún Playwright, ningún autoplay con modelo.
- **Memoria.** Tests por fichero mientras se trabaja (`npx vitest run test/<uno>.test.ts`). La suite entera y el `typecheck`
  solo al final y siempre así: `powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\hooks\con-tope.ps1" -GB 3 -Comando "npx vitest run --maxWorkers=2"`
  (con los workers por defecto se queda sin memoria bajo el tope).
- **Entrega.** Commits en la rama, push a `origin` (`aizetachan/Tavernus`). Sin PR: la fusión a `main` la hace la sesión
  coordinadora tras revisar las ramas. Nada de `git add -A`: `.claude/launch.json` y `data/local` no se confirman nunca.
- **Textos.** Español, sin «·» ni «•» para separar textos. Avisos cortos. Hints de las tools en el tono de los que ya hay.
- **Al acabar**, cada sesión deja al final de este documento la lista de lo hecho, lo que no pudo cerrar y los cambios que
  pide en ficheros de otro paquete.

## Paquete E: el mundo y sus textos

**Ficheros:** `src/engine/engine.ts`, `src/engine/chatter.ts`, `src/engine/narrate.ts`, `src/engine/schedule.ts`,
`src/engine/journal.ts`, `src/engine/npcorders.ts`, `src/data/campaigns/brezal/life.ts`, `src/data/campaigns/brezal/reactions.ts`
(bloque `CHATTER`), `src/data/campaigns/brezal/story.ts` (epílogo) y sus tests. Nada en `tools.ts`, `prompt.ts`,
`closecheck.ts`, `crime.ts`, `conflict.ts`.

1. **(32) Frases de ambiente con hablante.** Cada entrada de `CHATTER` dice quién puede decirla (`npc_ids`, ya existe) o
   quién no (`not_npc_ids`, nuevo) y nunca el NPC al que nombra: «Otra jarra, Brenna» no la dice Brenna; «Si Garrán viene a
   cobrar» no la dice Osric, que es quien manda cobrar, ni Garrán. `chatter.ts` elige hablante respetándolo y, si no queda
   nadie, calla. `speakerLabel` en masculino o femenino según el NPC («el guardia» para Doro, no «La guardia»); «El herrero,
   al pasar» no sale dentro de la taberna si Hugo no está en ella. Patrón 3, 12 de 23 partidas.
2. **(30, parte del motor) La salida y la entrada de un NPC se ven.** Cuando la rutina (`life.ts` de Brezal, `npc_move`) o una
   orden saca a un NPC de la sala donde hay jugadores, o lo mete, el motor emite una línea de ambiente corta a los
   presentes («Ilse recoge el cesto y sale hacia la plaza»; «Hugo entra sacudiéndose el agua») si no la hay ya, y deja en
   el evento el `npc_id` y el movimiento para que la guarda del paquete F sepa quién se fue y cuándo. Hoy el jugador lee
   «Ilse se va camino de la misa» y 19 turnos después sigue en el caldero (charlatán T11 a T30). Patrón 1.
3. **(41) Línea de aproximación solo si llega.** `errandLine` (`engine.ts`, «Te acercas al caldero») no se antepone cuando
   el destino está tras una puerta cerrada, no es alcanzable o el jugador va a otro sitio del que la frase dice (charlatán T6,
   metódico T6 y T28, impredecible T2, violento T19). Patrón 9.
4. **(42) El tablón no se vuelca a mitad de escena.** `onDay` (`engine.ts`) emite hoy «📜 Tablón de Brezal, 00:00:» con
   viñetas «•» como `observable` público, que el jugador lee como narración a mitad de turno. Que sea un aviso corto («Hay
   avisos nuevos en el tablón de la plaza») sin hora ni lista, y que la lista entera solo salga al leer el tablón (`readBoard`,
   `/tablon`), sin «•» ni «—» como separadores. Y que `rotateBoard` no cambie los encargos vigentes entre dos lecturas del
   mismo día (pausado T12, explorador T18, impredecible T6 y T23). Patrón 12.
5. **(43) Epílogo veraz.** `story.ts` dice «Amanece el sexto día» dos veces seguidas (línea 684 y el `announce` de 687) y
   narra la noche de la Brasa aunque la partida acabe el día 2. Una sola vez, y el cierre de partida que llega antes del
   sexto día lo dice («La partida se cierra la noche del segundo día; la Brasa aún no ha pasado»). Patrón 12.
6. **(44) Erratas de las plantillas del motor.** «el herrero el herrero», «el sereno el sereno», «el guardia el guardia»
   (etiqueta y nombre pegados en `narrate.ts`, `journal.ts:npcLabel` o `schedule.ts:npcLabel`), «le te pide», «Mastinas»,
   «Mirás». Un pase por las plantillas con un test que construye las frases para cada NPC de Brezal y comprueba que no
   repiten palabra. Patrón 12. La errata de `crime.ts:879` («viene a ayudar a detener a ti») es del paquete G.
7. **(38, parte del motor) La reaparición se lee.** El evento `respawn` (`engine.ts:3692`) y su `masterLine` llegan al
   jugador como narración con dónde, cuándo y con qué PG, y hasta entonces el muerto no actúa: hoy el violento muere en la
   herrería y aparece en el molino a 7/14 sin transición (T4 y T5) y el recolector reaparece al turno siguiente aunque el
   aviso decía «dentro de 2 h reales» (T11). Lo de la salvación y el 1 PG es del paquete G. Patrón 7.

## Paquete F: guardas del cierre y contexto

**Ficheros:** `src/ai/tools.ts`, `src/engine/closecheck.ts`, `src/ai/prompt.ts`, `src/ai/paint.ts`, `src/ai/master.ts` y
sus tests (`test/closecheck.test.ts`, `test/tools*.test.ts`, `test/prompt*.test.ts`, nuevos). Nada en `engine.ts`,
`crime.ts`, `conflict.ts`, `chatter.ts`.

Principio de siempre: lo que el máster narra contra el estado se rechaza una vez con un hint que dice qué falla; a la
segunda, pasa.

1. **(30) Presencia de NPC en la narración.** Tres guardas en `log_event`: un NPC que no está en la lista de presentes
   del contexto no habla ni actúa en el cierre (ni en `lines` ni en la narración), salvo que el cierre lo haga entrar con
   `set_npc_order` o el motor lo haya movido en este turno; un NPC que el motor sacó de la sala (evento `npc_move` reciente)
   no sigue hablando («Garrán se va de la barra» y contesta cuatro turnos más, pícaro T10 a T23); y el cierre no narra que
   un NPC «se va» o «entra» si el motor no lo movió (Hugo «se ha ido a cenar» en el turno en que derriba a Fiona, pareja
   violento T2). El contexto («Presentes que el actor percibe», `prompt.ts:428`) dice en una línea quién se ha ido desde el
   turno anterior. Es la mitad de las incoherencias del juez (patrón 1, 23 de 23). Si hace falta que el motor marque los
   movimientos en el evento, el paquete E lo deja preparado (su punto 2); mientras, se lee de los eventos `npc_move` que ya
   existen.
2. **(34) El compañero no es un NPC.** Cuando un jugador y un NPC comparten nombre (Ciro el jugador y Ciro el jornalero),
   el contexto marca a los dos sin ambigüedad (el jugador siempre «JUGADOR Ciro [id]», el NPC por su oficio) y la guarda
   rechaza el cierre que llama al jugador por el oficio del NPC («el jornalero» por Ciro, pareja pícaro B1 a B31). Un robo,
   una amenaza o un agarrón a un JUGADOR nunca lo contesta un NPC en su lugar: `request_reaction` es obligatoria y el cierre
   que lo resuelve con una línea de NPC se rechaza (B9: «De eso no sé nada. Pregúntale a Brenna»). Patrón 4.
3. **(31, parte de las tools) Un codazo no es un ataque.** `request_reaction` con `kind: attack` cuando la acción del
   jugador no tiene verbo de ataque (codazo, palmada, agarrar del brazo, tocar el hombro) se rebaja a `touch` o `other` con
   hint; nunca se abre una tirada de ataque con daño por «le doy un codazo a Elmo: ¿y tú qué opinas?» (pareja metódico M15
   y E16: estocada de 10, Elmo a 0 PG). La parte de `conflictKindOf` es del paquete G. Patrón 2.
4. **(39) Conjuros y rasgos por su lista.** `cast_spell` con un conjuro distinto del que nombra la acción del jugador se
   rechaza con el nombre del que pidió (pide Rayo de escarcha, se tira Descarga de fuego: lanzador T2 y T5); la etiqueta del
   daño en español («fuego», no «fire»); un conjuro de ataque sin `target_id` no hace daño a nadie (T2, T33); el cierre que
   narra un conjuro sin `cast_spell` se rechaza (ya existe la guarda: comprobar por qué no saltó en 40 turnos sin gastar un
   espacio); un rasgo que no está en la ficha («Acecho», tirador T20) lo niega `spend_resource` con la lista de los suyos;
   disparar («disparo», «suelto una flecha», «apunto y tiro») es `attack` y la guarda de golpe sin tirada lo cubre (tirador
   T7, T22, T40). Patrón 8.
5. **(40) Lo que el jugador cuenta de sí mismo pasa por `record_character_fact`.** Si la acción afirma algo del propio
   personaje que no está en la ficha (una herida, un hermano, una deuda con alguien, un pasado) y el cierre lo da por cierto
   sin `record_character_fact`, rechazo con hint; si lo niega o lo deja en el aire, pasa. Herido T21, charlatán T19,
   dirigido T7. Patrón 11.
6. **(38, parte de la guarda) 0 PG es 0 PG.** El cierre que levanta a un PJ a 0 PG («abre los ojos», «se incorpora»,
   «vuelve en sí») sin `heal`, `stabilize` o el evento de estabilizado del motor se rechaza; y nadie a 0 PG lanza conjuros ni
   actúa (recolector T11, pareja violento F2, pareja metódico E17). Patrón 7.
7. **(36, parte del máster) Un cierre por turno con tirada.** Cuando el turno lleva `requires_roll`, la narración de la
   intención y la del resultado no se enseñan las dos como párrafos sueltos: comprobar en `master.ts` cómo se componen los
   dos cierres (antes y después de la tirada) y que el segundo sustituya o continúe al primero, nunca lo repita ni lo
   anteponga. Las tiradas que se enseñan llevan dado y resultado («🎲 Percepción» a secas: explorador 14 turnos, tirador 9).
   Antes de tocar nada, el paquete I dice si la duplicación es de la herramienta (H13); si lo es, aquí solo se mira el orden.
   Patrón 6.

## Paquete G: conflicto, ley, daño y muerte

**Ficheros:** `src/engine/conflict.ts`, `src/engine/crime.ts`, `src/engine/reactions.ts`, `src/engine/combat.ts`,
`src/engine/death.ts`, `src/engine/laws.ts` y sus tests (`test/conflict*.test.ts`, `test/crime*.test.ts`,
`test/robo-miedo-2026-11-26.test.ts`, `test/death*.test.ts`, nuevos). Nada en `engine.ts`, `tools.ts`, `closecheck.ts`.

1. **(31) `conflictKindOf` y `readsAsTheft` más estrechos.** Hoy cualquier verbo de agarrar, coger o lanzar cerca de un NPC
   acaba en `conflict_act`. Lista de verbos de robo con blanco explícito («le quito», «le arrebato», «meto la mano en su
   bolsa», «le robo») y de ataque con arma o golpe; y una lista de lo que NO es: lanzar un conjuro («lanzo Vuelo», «lanzo
   Proyectil mágico al aire»), lanzarse a un sitio («me lanzo al pozo»), dar algo en la mano («le planto la vela en la
   mano»), pescar, saltar, un codazo o una palmada para llamar la atención. Casos reales: rompejuegos T15, T31 y T33;
   impredecible T9; violento T5. Robar de verdad sigue siendo robar (pareja pícaro B37). Patrón 2.
2. **(37) Rendirse es rendirse.** «Me entrego», «me rindo», «vale, voy con vosotros» y la sugerencia de rendirse nunca se
   tratan como resistencia ni suman aviso («ya te ha avisado una vez»); el cargo del arresto cita lo que pasó (agarrar del
   brazo no es «has golpeado al molinero», violento T5). Y al revés: amenazar con el hacha diez turnos (violento T20) y robar
   un garrote con violencia (T25, T37) tienen consecuencia, hoy ninguna. Patrón 2 y 7.
3. **(38) 0 PG, muerte y salvaciones.** En `death.ts` una salvación con éxito solo cuenta un éxito (`rollDeathSave`, línea
   247): comprobar qué levanta al PJ a 1 PG con una sola tirada (pareja violento F2, pareja metódico E17) y si es el motor
   o el máster; si es el máster, el paquete F pone la guarda y aquí se deja el estado inequívoco (`isDying`, `isStable`) en
   lo que lee el contexto. Un PJ a 0 PG no puede actuar: `combat.ts` y `death.ts` lo rechazan antes de que llegue al máster
   (recolector T11, «Curar heridas» inconsciente). El daño del mundo lleva dado o regla (5 PG fijos por un 1 natural al
   trepar, lanzador T9; 4 a 2 PG por una carta que muerde, T15) y la lanza del guardia no deja a nadie a 0 de 7 sin tirada
   (rompejuegos T34): comprobar `combat.ts` y la represalia de la autoridad. La reaparición en el tiempo es del paquete E.
   Patrón 7.
4. **(44, parte de `crime.ts`) «Viene a ayudar a detener a ti».** La plantilla de `crime.ts:879` con el nombre del PJ, no
   el pronombre (rompejuegos T33). Un pase por las demás plantillas de `crime.ts`, `laws.ts` y `reactions.ts` con un test
   que las construye para cada PJ y NPC.
5. **(35, parte de las reacciones) Un rumor no es respuesta.** En `reactions.ts`, el rumor de relleno («La escapada al
   granero: cada día a las 23:00, en el arroyo») solo sale cuando la acción es preguntar por noticias o por ese tema, nunca
   como respuesta a cualquier otra cosa (rompejuegos T9, charlatán T33, T34 y T37). El resto del arreglo 35 es del paquete H.

## Paquete H: respuestas rápidas y lo que lee el compañero

**Ficheros:** `src/engine/fastpath.ts`, `src/engine/extratalk.ts`, `src/engine/talk.ts`, `src/engine/conversation.ts`,
`src/engine/events.ts`, `src/engine/audience.ts`, `src/engine/turnwindow.ts`, `src/engine/info.ts`, `src/engine/rest.ts`,
`src/adapters/web/*` y sus tests. Nada en `engine.ts`, `tools.ts`, `prompt.ts`, `scripts/*`.

1. **(35) Respuestas rápidas que contestan.** Las enlatadas de secundarios («No tengo tiempo para charlas», «Sigue tu
   camino», «El señor regidor recibe por la mañana») solo cuando la acción es charla y una vez por charla; a la segunda, el
   NPC despacha de otra forma o pasa al máster (rompejuegos T5 y T8 a T11; cronista T16 a T18; herido T16 a T19). «¿Con
   quién?» (pareja pícaro C9) y «Ya estás despierto» (rompejuegos T35) no se devuelven a quien está haciendo otra cosa:
   si no se entiende con quién habla, al máster. «Dices: «…»» sin réplica (charlatán T1 y T3) no es una respuesta: o
   contesta alguien o va al máster. «Garrán está con Bruno; te hace un gesto para que esperes» no bloquea una pregunta
   dirigida al compañero (C5, C7, C8, E16, M1, M2, M27, M36): si el destinatario es un JUGADOR, la frase le llega a él.
   Patrón 5, 11 de 23 partidas.
2. **(33) Lo que lee el compañero en un turno compartido.** `readerText` (`events.ts:187`) entrega a cada jugador su
   `narration_by_pc` y lo común; comprobar con un test de dos PJ y un cierre compartido real (pareja pícaro C2 y C12:
   Ciro lee «Te acercas al jornalero y pones la daga sobre la mesa», que es Bruno) qué recibe cada uno por el motor y por la
   web (`src/adapters/web/server.ts`, `novel.ts`): lo del otro va en tercera persona y una sola vez, y el orden es el del
   turno (pregunta antes que respuesta: pareja violento E2, E6). Si el motor ya lo hace bien y la duplicación es de la
   herramienta, el paquete I lo arregla (H13); aquí se deja el test que lo demuestra. Patrón 4.
3. **(36, parte de la web) Tiradas con dado y resultado.** Las líneas «🎲 Percepción» que la web pinta sin dado ni
   resultado (`novel.ts`, `page.ts`): las ocultas (`hidden`) dicen que son ocultas y las demás llevan el número; «🎲 Bruno ·
   Persuasión» y «éxitos 1/3 · fallos 0/3» sin «·» (`novel.ts:859`, `notice.ts`, `journal.ts`, `avatar.ts`). Patrón 6 y 12.
4. **(42, parte de la web) El aviso del tablón en la web** como notificación («Tablón actualizado»), no como burbuja de
   narración, cuando el paquete E cambie el evento; mientras, la web deja de pintar el `observable` del evento `board` como
   texto del máster.

## Paquete I: herramientas de prueba

**Ficheros:** `scripts/autoplay.ts`, `scripts/playtest-report.ts`, `scripts/judge.ts`, `docs/PLAN-PRUEBAS-CREDITOS.md` y
sus tests. Nada en `src/`.

1. **(H13) Quién duplica.** `seenSince` (`autoplay.ts:921`) une `texts` y los eventos vistos desde una secuencia y puede
   estar entregando dos veces lo mismo, y en segunda persona lo del compañero (pareja pícaro C2, C4, C10, C12; pareja
   violento E4, E7, E9; pareja metódico M12, M17). Reproducirlo con un test sin modelo (dos PJ, un cierre compartido con
   `narration_by_pc`) y decir si es la herramienta o el motor; si es la herramienta, arreglarla para que cada jugador lea lo
   suyo una vez y lo del otro como lo leería en la web. Lo mismo con las narraciones dobles de los turnos con tirada (patrón
   6): si el transcript enseña dos párrafos porque junta `texts` y el evento, que enseñe lo que vería la web. El resultado
   se deja escrito aquí porque los paquetes F y H lo esperan.
2. **(H14) El contador de misiones.** El transcript imprime `misiones ${s.done}` (`playtest-report.ts:340` y 348) y el
   análisis lo leyó como misiones abiertas: que diga «misiones abiertas N, cumplidas M» con `open` y `done`, y que el informe
   compare lo que dice comparar. Comprobar que `open` de `TurnState` cuadra con las «📖 Nueva misión» del propio transcript
   (pausado T11, cronista toda la partida).
3. **(H15) Perfiles mecánicos que miden.** El cronista con una biografía fija en el perfil (un pasado, una hermana, un
   nombre) que repite toda la partida, en vez de tres pasados y cuatro hermanas; el herido empieza con menos PG o se cura
   solo lo que el juego le dé (a 13/13 desde el turno 4, 33 de 37 peticiones sin medir nada); el jugador automático sabe que
   ha reaparecido (H9) y no «lanza» nada a 0 PG.
4. **(H16) El juez cuenta los patrones nuevos.** Tres categorías propias en `judge.ts` (`MODEL_TYPES`): `npc_ausente` (habla
   o actúa quien el contexto dice que no está, o se va sin que el motor lo mueva), `ambiente_mal_hablante` (frase de
   ambiente en boca de quien no toca o del NPC al que nombra) y `enlatada_sin_sentido` (respuesta rápida del motor que no
   contesta a la acción). Con sus definiciones para el modelo y su columna en `playtest-report.ts`, para medirlos en la
   próxima pasada contra las tandas `20261126-0418`, `-0442` y `-0602`.

## Después (sesión coordinadora)

1. Revisar las cinco ramas y fusionarlas en `main` por orden I, E, G, H, F (I no toca `src`; E, G y H no comparten ficheros;
   F va la última porque sus guardas leen lo que E deja en los eventos), `npx vitest run --maxWorkers=2` y `typecheck` tras
   cada fusión, y los remates cruzados que cada paquete haya dejado escritos.
2. Desplegar en el servidor cuando Miguel lo diga (`deploy\push.ps1`).
3. Pasada corta con Haiku bajo (la orquestadora, cuando Miguel lo pida): los 17 perfiles y las 4 parejas, 40 acciones, con
   `--baseline data/local/autoplay/20261126-0418`, `-0442` y `-0602`. Unos 3,5 $. Lo que se mira: las tres categorías nuevas
   del juez (esperadas cerca de cero), incoherencia con el contexto (9,4 por 100 en la pasada 4), `conflict_act` por acción
   inocente (0), turnos duplicados en pareja (0), enlatadas repetidas (0).
