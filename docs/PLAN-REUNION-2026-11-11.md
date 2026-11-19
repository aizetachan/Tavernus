# Plan de arreglos tras la reunión del 11-11-2026

Sale de las notas de las pruebas de Miguel y Santi (partida «Megaprueba mañanera 11/11», Pillin y Zhenzet en la
Taberna del Jabalí, 504 eventos en la base del servidor) y de la reunión de ese día.

**Estado (19-11-2026):** fases 0 y 2 fusionadas (PR #82) y desplegadas en `20261119-084501`; probadas en local con
dos personajes (offline). Sin ver en pantalla: las imágenes dentro de la burbuja (IMAGES=off en local). Sin probar con
modelo real: el `character_id` de `report_incident` y `request_reaction` en turnos compartidos (lo dice el prompt;
falta una partida a dos con Haiku). **Fase 4 fusionada** (PR #83) y desplegada en `20261119-092935`. **Fase 1 programada**
(ajustes de la mesa: dificultad, muerte y alcance del chat en `games.settings`, migración 3; fuera el paso «Si mueres»
del asistente; biblioteca con plantilla e instancias; contraseña olvidada por el anfitrión desde Invitaciones y por
código de recuperación), con tests en `test/ajustes-partida.test.ts` y probada en local (registro con código, crear con
Difícil, «Ajustes…» a hardcore, biblioteca, contraseña de un invitado, recuperación con el código). Decidida la
pendiente 2 (contraseña) con las dos vías. **Fase 1 fusionada** (PR #84) y desplegada en `20261119-100609`. **Fase 3
programada**: Percepción, Perspicacia, Investigación y Sigilo se tiran ocultas al cerrar el turno (chip «🎲 Percepción»
sin número, el máster narra lo que nota y no delata el fallo); robar o espiar a otro jugador va por tirada enfrentada
oculta y solo si lo nota decide él («Lo notas: …»). Tests en `test/percepcion-oculta.test.ts`. Las fases 5 y 6 están
por hacer; quedan las decisiones 1 y 3 del final.

## Lo que pasó en la partida

Lo que explica las notas «escena del parroquiano», «se vieron los prompts del otro», «Lo han visto» y «se acaba el
combate». Todo sale de los eventos; los números son el `seq` del evento.

| Qué se vio | Qué pasó en el motor | Dónde |
|---|---|---|
| **El parroquiano.** Pillin: «hablar con el parroquiano» y luego «mirar si lleva algo de valor», «mirar qué ropa lleva» (41 a 47) | Damián es un NPC de relleno: le contesta el motor sin máster («¿Me invitas a algo?», «Déjame beber tranquilo», «ya no te hace caso»). Los «mirar…» se trataron como charla fuera de tema, no como mirar. Y toda la charla llegó entera a Zhenzet (`delivered_to` full), no un aviso | [extratalk.ts:181](../src/engine/extratalk.ts), [extratalk.ts:226](../src/engine/extratalk.ts) |
| **El prompt del otro.** Turno compartido (58): Zhenzet «ahora disimuladamente le robamos algo del bolsillo a Pillin» y Pillin «pegar al parroquiano un bofetón» a la vez | En un turno compartido la web pinta **el texto literal** que escribió cada uno como frase suya, con su avatar, delante de la narración para los demás (`group_inputs`). Pillin leyó el plan de robarle tal cual lo escribió Santi | [server.ts:1845](../src/adapters/web/server.ts) |
| **«Lo han visto».** Aviso ⚖ de ocho frases: «Zhenzet golpeó a Damián. Damián se lanza contra Zhenzet. Garrán se planta… Hugo grita… Lucio grita… Benito grita… Ciro grita… Gil grita…» (62) | Dos fallos. El bofetón lo dio **Pillin**, pero `report_incident` apunta al actor del turno, que era Zhenzet: la detuvieron a ella (63) y Garrán le repitió el «¡Alto!» **once veces**, una cada hora, mientras dormía (90, 171, 187, 217, 240, 257, 274, 294, 322, 447, 475, 496). Y el aviso es la lista mecánica de reacciones, que no es para leer | [tools.ts:1296](../src/ai/tools.ts), [crime.ts:1068](../src/engine/crime.ts), [engine.ts:3650](../src/engine/engine.ts) |
| **El combate.** «Empieza el combate» con el bofetón, y «Fin del combate» un rato después sin que nadie pegara más | El turno 58 lleva la etiqueta `combat` del máster y el incidente 62 también; Damián respondió `fight` pero es relleno y nunca atacó; Garrán se interpuso (detención, no pelea). El combate acabó por los 600 s de juego sin golpes, no porque pasara nada | [encounter.ts:40](../src/engine/encounter.ts), [encounter.ts:210](../src/engine/encounter.ts), [server.ts:632](../src/adapters/web/server.ts) |
| **El robo entre jugadores** (59, 64) | Para robarle a Pillin, el máster pidió `request_reaction` (así se lo manda la pista de [tools.ts:936](../src/ai/tools.ts)): a Pillin le salió «Zhenzet intenta sentir cómo te hurgan el bolsillo y te quitan algo sin que lo notes. ¿Te dejas o te resistes?». Es la nota «distinguir reacciones de percepción»: un robo con sigilo no se pregunta a la víctima; se tira Percepción oculta | [tools.ts:1521](../src/ai/tools.ts), [reactions.ts](../src/engine/reactions.ts) |
| **El narrador se confunde de personaje** (58) | El máster sí escribió una narración por jugador (`narration_by_pc`), pero sin `narration_common`, y en ese caso la web da a cada uno **la narración entera** mezclada («Te acercas a la barra… Junto a la chimenea, la mano de Pillin cae…»): la parte en segunda persona de uno la leyó el otro | [events.ts:191](../src/engine/events.ts) |
| **El arranque** (1 a 26) | Lo que ve quien entra: el Tablón, tres «Hemos oído…» de misiones, el prólogo (el de Pillin salió de **plantilla**, no del máster) y una intro del máster de tres frases. Seis mensajes, cinco de ellos del sistema. Es la nota «el principio que narre más y menos bot» | [engine.ts:1971](../src/engine/engine.ts), [engine.ts:2034](../src/engine/engine.ts), [prologue.ts:136](../src/engine/prologue.ts) |

Lo que no está en los eventos y hay que reproducir en la web: el hilo que baja solo al llegar un mensaje, las imágenes
sueltas, el botón «Aceptar» que se queda marcado y el bug de imagen en la burbuja de Decir.

## Fases

Tamaño: **S** unas horas, **M** un día, **L** varios días. Cada fase se puede probar sola. El coste en API solo cambia
en lo que se marca; lo demás es motor y web, sin modelo. Las pruebas con modelo las lanza Miguel con Haiku.

### Fase 0. Interfaz, rápidos

Sin decisiones. Se comprueban en la web con dos pestañas (offline o Haiku).

| Arreglo | Dónde | Tamaño |
|---|---|---|
| Un mensaje nuevo no te baja al fondo si estabas leyendo arriba: solo baja si ya estabas al final (menos de 80 px); si no, una pastilla «↓ Mensajes nuevos» | [page.ts:1340](../src/adapters/web/page.ts), [novel.ts:582](../src/adapters/web/novel.ts) | S |
| El Diario no colapsa lo que tenías abierto al repintarse: guarda los `details` abiertos y los vuelve a abrir | [page.ts:2962](../src/adapters/web/page.ts), [page.ts:3028](../src/adapters/web/page.ts) | S |
| Tooltips del mapa y del tablero de la sala: nombre y una línea (estado o quién hay), sin descripciones. De paso, fuera el «·» separador (regla de los textos) | [page.ts:2643](../src/adapters/web/page.ts), [page.ts:2746](../src/adapters/web/page.ts) | S |
| Toda imagen va dentro de una burbuja: los momentos (charla, objeto, combate, descubrimiento) se pintan como la ilustración del sitio, dentro del cuerpo del mensaje que los trae, no como `figure` aparte. Comprobar con ello el bug de la burbuja de Decir | [novel.ts:1212](../src/adapters/web/novel.ts), [novel.ts:573](../src/adapters/web/novel.ts) | S |
| Botón «Aceptar» (ofertas, misiones): tras pulsar, la fila se atenúa y queda marcada la elección, sin foco ni estado «pulsado» | [novel.ts:877](../src/adapters/web/novel.ts) | S |
| Reacción (Dejarse / Resistirse): primero el texto que dice qué te están haciendo y qué tirada habría si te resistes, luego los botones. El texto lo escribe el servidor a partir del tipo y de lo que escribió el actor, no el máster (en la partida salió «intenta sentir cómo te hurgan el bolsillo») | [novel.ts:1122](../src/adapters/web/novel.ts), [engine.ts](../src/engine/engine.ts) `requestReaction` | S |
| Invitaciones: el asiento del anfitrión sin enlace copiable (es el suyo) | [page-access.ts:228](../src/adapters/web/page-access.ts) | S |
| Un solo mensaje cuando entra alguien: para los demás, «Zhenzet llega a la mesa del fondo» y nada más (hoy sale también el aviso de presencia) | [engine.ts:1971](../src/engine/engine.ts), [server.ts](../src/adapters/web/server.ts) `announce` | S |
| «Decir» pasa a llamarse «Chat» (el alcance va en la fase 1) | [page.ts:1250](../src/adapters/web/page.ts) | S |

### Fase 1. Cuentas y ajustes de partida

| Arreglo | Dónde | Tamaño |
|---|---|---|
| **Ajustes de partida**, del anfitrión, al crearla y después: dificultad (fácil, normal, difícil, mortal), modo de muerte (casual, hardcore) y alcance del chat (todos los jugadores de la partida, o solo quien te oiría). Columna `settings` en `games` (migración 3). La dificultad deja de salir de `MasterConfig` y el modo de muerte deja de ser del personaje: se quita de la creación | [page-creation.ts:238](../src/adapters/web/page-creation.ts), [chargen.ts:66](../src/engine/chargen.ts), [model.ts:296](../src/engine/model.ts), [migrations.ts](../src/db/migrations.ts) | M |
| **Chat** con alcance según el ajuste: con «todos», llega a todos los jugadores de la partida estén donde estén y no pasa por percepción; con «quien oiga», como hoy | [party.ts](../src/engine/party.ts) | S |
| **Instancias de un personaje.** Ya funciona así (cada partida juega con una copia de la plantilla, `template_id`): hacerlo visible. En la biblioteca, cada personaje es «plantilla» y debajo sus partidas con el nivel y el estado de cada copia. Comprobar que `taken` no impide usar la misma plantilla en dos partidas (solo debe impedirlo dentro de la misma) | [page-access.ts:95](../src/adapters/web/page-access.ts), [server.ts:1400](../src/adapters/web/server.ts) | S |
| **Contraseña olvidada, sin correo.** Dos vías: el anfitrión pone una contraseña nueva a cualquier usuario con asiento en su partida, desde Invitaciones (como hace el administrador en su panel); y cada usuario tiene un **código de recuperación** que se le enseña al crear la cuenta y en su cuenta (regenerable), con el que cambia la contraseña en /entrar | [accounts.ts:233](../src/accounts/accounts.ts), [page-admin.ts:127](../src/adapters/web/page-admin.ts), [page-account.ts](../src/adapters/web/page-account.ts) | M |

### Fase 2. Lo que lee cada uno (multijugador)

| Arreglo | Dónde | Tamaño |
|---|---|---|
| **Nunca el prompt del otro.** En un turno compartido, lo que hicieron los demás sale de la narración del máster (sus `lines` y lo común), no de su texto literal. Si el máster no trae la frase de un jugador, la web pone una línea del servidor («Zhenzet hace algo junto a la barra»), nunca lo que escribió | [server.ts:1845](../src/adapters/web/server.ts) | S |
| **Cada uno lee lo suyo.** Si hay `narration_by_pc` y no hay `narration_common`, cada lector recibe su parte más lo que afecte a todos, nunca la narración mezclada. El control de cierre exige `narration_common` en todo turno `present` o compartido, en tercera persona y sin «tú» | [events.ts:191](../src/engine/events.ts), [closecheck.ts](../src/engine/closecheck.ts), [prompt.ts](../src/ai/prompt.ts) «Turno compartido» | M |
| **El crimen es de quien lo hace.** `report_incident` y `request_reaction` llevan `character_id` en los turnos compartidos, validado contra el grupo (como `roll_check`); si falta, el servidor lo deduce de quién tiró el ataque en ese turno | [tools.ts:1296](../src/ai/tools.ts), [tools.ts:1521](../src/ai/tools.ts) | S |
| **«Lo han visto», corto.** Para los testigos, una línea: «⚖ Garrán da el alto a Pillin por golpear a Damián». Para el autor, su segunda persona en una frase. La lista de reacciones de cada vecino se queda para el máster (ya la recibe) y no se pinta | [crime.ts:1068](../src/engine/crime.ts) | S |
| **Quién está al entrar.** La intro de quien llega nombra a los jugadores presentes en la sala (y, si están en otro sitio de la aldea, dónde); la página de entrar lista los personajes ya sentados y quién está en línea | [prologue.ts](../src/engine/prologue.ts), [page-access.ts:101](../src/adapters/web/page-access.ts) | S |
| Charla con un NPC: los demás de la sala reciben un aviso de una línea («Pillin habla con el parroquiano»), no la charla. Hoy la charla con el relleno llega entera | [extras.ts](../src/engine/extras.ts), [audience.ts](../src/engine/audience.ts) | S |

### Fase 3. Percepción y reacciones

| Arreglo | Dónde | Tamaño |
|---|---|---|
| **Tiradas ocultas de verdad.** Percepción, Perspicacia, Investigación para notar algo, y Sigilo: las tira el servidor con `hidden` (ya existe en `roll_check`), el jugador ve un chip «🎲 Percepción» sin número ni resultado, y la narración solo cuenta lo que nota; al fallar, «una ligera sensación» o nada. Regla en el prompt: estas tiradas no se piden al jugador con botón | [tools.ts:1847](../src/ai/tools.ts) `roll_check`, [novel.ts:851](../src/adapters/web/novel.ts), [prompt.ts](../src/ai/prompt.ts) | M |
| **Reacción solo a lo que se nota.** Agarrar, empujar, atacar, llevarse: reacción con Dejarse / Resistirse (como hoy). Robar con sigilo o espiar a otro jugador: sin reacción; tirada enfrentada oculta (Juego de manos contra Percepción pasiva o tirada oculta). Si la víctima gana, se entera en su hilo («notas una mano en tu bolsillo») y entonces sí puede reaccionar | [tools.ts:936](../src/ai/tools.ts), [reactions.ts](../src/engine/reactions.ts), [engine.ts](../src/engine/engine.ts) `requestReaction` | M |

### Fase 4. Combate y ley

Sigue las tareas B y F de la revisión del 04-11 (la B aún no está hecha).

| Arreglo | Dónde | Tamaño |
|---|---|---|
| **Empieza solo con hostilidad real:** un ataque resuelto, o un NPC con ficha de combate hostil y presente. Ni la etiqueta `combat` del máster ni un incidente con un NPC de relleno (sin ficha) abren combate. Si la autoridad se interpone (`arrest`), es una detención, no un combate | [encounter.ts:134](../src/engine/encounter.ts), [encounter.ts:210](../src/engine/encounter.ts), [crime.ts](../src/engine/crime.ts) | M |
| **Acaba cuando no queda hostil**, al momento, con una línea que lo explica («Damián se aparta; Garrán tiene la situación en la mano»); los 600 s solo como red de seguridad | [encounter.ts:40](../src/engine/encounter.ts), [server.ts:632](../src/adapters/web/server.ts) | S |
| **Un alto por encuentro.** La autoridad da el alto una vez; si el PJ no responde, actúa (multa, embargo o le sigue), y no repite el alto mientras el PJ esté dormido o ausente | [engine.ts:3650](../src/engine/engine.ts), [crime.ts:886](../src/engine/crime.ts) `lawTick` | S |
| Reacción pendiente y combate a la vez: mientras hay una reacción abierta entre dos PJ, el combate de la sala no se abre ni se cierra por lo que pase en ella; se resuelve la reacción y después se mira la hostilidad | [engine.ts](../src/engine/engine.ts), [scene.ts](../src/engine/scene.ts) | S |

### Fase 5. Conversación

| Arreglo | Dónde | Tamaño |
|---|---|---|
| **Digo / Hago** (decisión 1, abajo). El servidor recibe `said` y `done` por separado; `said` va a `lines` tal cual (el control de cierre rechaza cambiarlo o inventarlo); `done` es lo que se narra y ejecuta (moverse, dar, atacar). «Gracias por todo» + «irme a la taberna» deja de confundirse | [page.ts:828](../src/adapters/web/page.ts), [server.ts:1627](../src/adapters/web/server.ts), [talk.ts:695](../src/engine/talk.ts), [narrator.ts:62](../src/engine/narrator.ts), [closecheck.ts](../src/engine/closecheck.ts) | L |
| **Narrador que casi no interviene en las charlas.** Los matices (acerca la jarra, guiña un ojo) van como `beat` dentro de la burbuja del NPC, encima de su frase; el narrador solo escribe burbuja propia en modo `full` (una acción física, una herramienta de las de peso, alguien que entra o un peligro). Hoy el modo `beat` aún pinta una burbuja gris del narrador | [narrator.ts:147](../src/engine/narrator.ts), [novel.ts:220](../src/adapters/web/novel.ts), [novel.ts:779](../src/adapters/web/novel.ts) | S |
| **Hablar con alguien empieza por saludar.** «Hablar con X» abre con el saludo y la presentación del NPC; la misión, el trato o la acción vienen cuando la charla llega a eso. Ya existe para las misiones (`askGate`); extenderlo a encargos, tratos y a lo que el jugador pide de golpe | [talk.ts](../src/engine/talk.ts), [tools.ts:654](../src/ai/tools.ts) | S |
| **NPC de relleno con vida.** «Mirar a X», «qué lleva», «cómo va vestido» dejan de ser charla fuera de tema: el motor contesta con su descripción (aspecto, ropa, lo que lleva a la vista) y un gesto de lo que está haciendo. La descripción se genera la primera vez que alguien le mira (una llamada a Haiku, menos de medio céntimo) y se guarda en el NPC. En sus respuestas, un gesto distinto cada vez | [extratalk.ts:226](../src/engine/extratalk.ts), [extras.ts](../src/engine/extras.ts), [chatter-writer.ts](../src/ai/chatter-writer.ts) | M |

### Fase 6. El arranque

| Arreglo | Dónde | Tamaño |
|---|---|---|
| **Que empiece narrando.** Quien entra ve el prólogo (siempre del máster; la plantilla solo si falla) y una sola intro, de 150 a 220 palabras: la sala, quién hay (los otros jugadores con nombre), el gancho. El Tablón y los «Hemos oído…» no salen en el hilo al entrar: van al Diario y al Tablón, con su punto de «nuevo». Averiguar por qué el prólogo del anfitrión salió de plantilla | [engine.ts:2034](../src/engine/engine.ts), [engine.ts:1727](../src/engine/engine.ts), [prologue.ts:156](../src/engine/prologue.ts), [notices.ts](../src/engine/notices.ts) | M (+1 llamada por entrada, menos de un céntimo) |

## Decisiones pendientes

1. **Cómo se separa lo que digo de lo que hago.** Opciones:
   - **A. Dos campos a la vista, «Digo…» y «Hago…»** (lo que pensasteis). Uno de los dos obligatorio. Sin ambigüedad y
     el máster recibe las dos partes ya separadas. En el móvil, dos líneas en vez de una.
   - **B. Un campo y comillas.** Lo que va entre comillas se dice; lo demás se hace. La caja resalta lo entrecomillado al
     escribir y tiene un botón «“ ”». Si no hay comillas y la frase mezcla señales de habla y de acción, antes de enviar
     pregunta «¿Lo dices o lo haces?» con dos botones (sin modelo).
   - **Recomendación: A**, con B como atajo (pegar una frase con comillas en «Hago» la reparte sola). Es lo que
     acordasteis, no depende de que el jugador aprenda una convención, y el reparto sale igual al servidor.
   El Chat entre jugadores (antes Decir) queda aparte, como botón del modo.
2. **Contraseña olvidada.** Recomendación: las dos vías de la fase 1. La del anfitrión resuelve el caso de la mesa de
   amigos al momento; el código de recuperación es la única forma de que el usuario lo haga solo sin correo.
3. **Narración en los turnos compartidos.** Recomendación: lo de la fase 2 (una parte en segunda persona por jugador y
   una común en tercera, en la misma llamada), que es lo que el máster ya hace a veces; no una llamada por lector.

## Orden propuesto

Fase 0 y fase 2 primero (lo que se ve en cada partida a dos), luego la 4 (combate y ley, que hoy castiga al que no
fue), la 3, la 1, la 5 y la 6. La fase 5 lleva la decisión 1 y es la más larga; se puede empezar en paralelo en su
rama.

## Comprobación

- Fases 0, 1, 2 y 4: tests de motor con clientes falsos y una partida a dos en local, offline, repitiendo el guion de la
  taberna (hablar con el parroquiano, bofetón de uno y robo del otro a la vez, detención).
- Fases 3, 5 y 6: además una partida a dos con Haiku a esfuerzo bajo (Miguel, con API; unos 20 turnos, menos de
  10 céntimos), y `npm run narrator-count -- <carpeta>` para ver cuántas burbujas del narrador quedan por charla.
- Lo que no se puede reproducir con los eventos (hilo que baja, imagen de Decir) se prueba a mano en dos pestañas.
