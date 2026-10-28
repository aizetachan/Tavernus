# Prólogo y «Donde lo dejamos»

Fecha: 2026-10-22. Diseño e implementación del texto que abre cada historia y del resumen que
recibe quien vuelve tras días sin jugar.

## El problema

Al crear una partida, el narrador empieza con lo que le pasa al personaje en ese instante y termina
en «¿qué haces?». Es lo que pide el bloque «Primera escena» (`src/ai/prompt.ts`) y para jugar YA está
bien, pero quien llega no sabe todavía qué mundo es este, dónde está ni por qué ha venido. Le falta lo
que en un libro hace la primera página.

Y quien vuelve tras una semana sin jugar encuentra el hilo donde lo dejó, sin acordarse de qué estaba
haciendo, a quién debía dinero ni cuánto le quedaba de plazo. `/recap` cuenta lo que se ha perdido
desde el último evento visto, pero no le recuerda su propia historia.

## Qué cuenta el prólogo

**Desde el 28-10, con situación inicial, solo lo suyo.** La primera versión abría con la historia del sitio
(la premisa) y nombraba a gente que el jugador aún no ha visto: en Brezal, el incendio de Vharn y «Brenna te
dio cama» antes de saber quién es Brenna. Ahora, con situación, son dos párrafos: **dónde está y cuándo**, y
**por qué está aquí, qué le amenaza y cuánto tiempo tiene**. Ni la premisa ni el tono ni lo que quiere
(`wants`, que ya está en el Diario como su misión principal): la historia del sitio se descubre jugando.
Debajo del remate, la página dice «Empieza tu aventura». Sin situación (la demo), sigue como abajo: mundo,
lugar y origen.

Lo que entra, en este orden:

1. **El mundo y su tono, en dos o tres frases (solo sin situación).** Sale de lo que el mundo enseña a cualquiera: la
   premisa de la campaña (`campaign.premise`) y una frase de tono según `campaign.tone`. **La Biblia
   no entra.** Son las verdades ocultas que explican pistas y secretos (quién enterró a quién, quién
   no es quien dice), y el prólogo las desvelaría el primer minuto. Lo mismo vale para `npc.secret`,
   las pistas (`clue.how`) y las leyes escritas como reglas para el máster. Se descubren jugando.
2. **El lugar y el momento.** El punto y la localización donde está (de su situación inicial), una
   frase de cómo es el sitio (`description_base`) y el día y la franja del día según el reloj de
   juego («Es miércoles 4 de Escarcha, al caer la tarde»).
3. **El porqué del personaje.** De su situación inicial (`character.situation`, de
   `claimSituation`): por qué está aquí (`why_here`) y qué quiere (`wants`). Sin situación (la demo
   de Brezal tal como está hoy), el origen del punto de inicio (`starting_points[].origin`).
4. **La amenaza y el reloj.** `threat`, los días del plazo (`clock_days`) y qué pasa si vence
   (`clock_runs_out`). Sin situación, la premisa hace de amenaza y no hay reloj.

No cuenta los **caminos** (`paths`). Son decisiones del jugador y nombran a gente que aún no conoce.
Tampoco cuenta el **primer instante** (`opening`), que es justo lo que abre la primera escena.

**Nombres.** Por su nombre solo sale el **antagonista**, presentado por lo que es («Garrán, el alguacil
del regidor»). El resto de NPC, por su oficio («la tabernera te dio cama»), aunque la situación diga que
el personaje los conoce: el jugador todavía no les ha puesto cara. Los datos se pasan ya enmascarados al
máster y a la plantilla (`maskNpcNames` con el antagonista como única excepción), y el texto final pasa
otra vez por el mismo filtro (`forPrologue`). Los PJ se nombran siempre.

## Con qué voz

**Una apertura de libro, no una burbuja del narrador.** En el hilo es un bloque propio, a todo el
ancho, sin avatar. Lleva un rótulo pequeño («Prólogo»), un título de capítulo en tipografía de libro
(«Capítulo 1: Cementerio de Riberahierro») y el texto en serif con letra capital. Separa dos
registros: lo que el libro cuenta (contexto, la cámara alejada) y lo que el narrador dice ahora (la
escena, la cámara pegada al personaje).

Va en **segunda persona y en presente**, como el resto de la partida. Las situaciones ya vienen
escritas así («Alguien a quien quieres está enfermo»). Sin situación, el origen del punto de inicio
viene en tercera persona («Llega a Brezal como viajero…») y la plantilla lo cuenta en tercera con el
nombre del personaje («Kael llega a Brezal como viajero…»), como la primera línea de una novela.

El narrador de voz **lo lee en alto** (el bloque lleva el mismo altavoz que las burbujas del máster).
Después vuelve el narrador con la primera escena, **más corta** (un párrafo, unas 50 palabras), que
empieza en el instante siguiente y no repite nada del prólogo.

## Cuánto mide

**Entre 60 y 120 palabras** (antes 120-200). Lo justo para situarse y empezar a jugar. Con situación,
dos párrafos: lugar y momento; porqué, amenaza y reloj. Sin ella, tres: mundo; lugar y momento; origen.
Se acepta lo del máster entre 40 y 160 palabras; fuera de eso, la plantilla.

## Cómo se genera

- **Una sola vez por personaje,** al pedir su primera escena (`engine.introduce`), antes de ella.
  Queda en el log como evento `prologue` del propio PJ (solo él lo percibe), con
  `payload.title`, `payload.source` (`master` o `template`) y, si lo escribió el máster, su uso de
  tokens. Si el evento ya existe no se vuelve a escribir (reinicios, una segunda llamada a
  `introduce`).
- **Con máster en vivo:** una llamada corta y sin tools (`MasterLike.write`) con un bloque de prompt
  propio (`prologuePrompt` en `src/engine/prologue.ts`). Lleva los mismos datos que la plantilla,
  nada de la Biblia, y las reglas de arriba (longitud, persona, nombres, sin pregunta final). Si la
  respuesta sale vacía, demasiado corta o demasiado larga, se usa la plantilla. Con Haiku cuesta
  menos de un céntimo.
- **Con el máster offline (o en replay sin caché):** el cliente offline no escribe texto libre, así
  que `write` devuelve null y sale la **plantilla determinista** (`prologueTemplate`), con los mismos
  datos. Sin máster (REPL, tests), también la plantilla.

En el **Diario**, la crónica del primer día empieza con una entrada de tipo `chapter`: el título del
capítulo y la primera frase del prólogo.

## «Donde lo dejamos»

**Cuándo.** Al abrir la partida (la web, al conectar el stream del personaje) se mira el **último
evento del propio personaje** (lo último que hizo o que le narraron como actor). Los eventos del mundo
que le llegan mientras no está no cuentan: con el servidor encendido se le entregan igual, aunque no
mire. Aparece la recapitulación si se cumple una de estas dos condiciones:

- han pasado más de **N horas reales** desde ese evento (`RECAP_AFTER_HOURS`, por defecto 72);
- han pasado **7 días de juego** o más (con el reloj a 3×, unas 56 horas reales).

La recapitulación es a su vez un evento del personaje (`recap`), así que reinicia la cuenta. Solo sale
una vez por ausencia.

**Qué cuenta.** Todo sale del Diario (`journalOf`) y del log, sin IA:

- dónde está (punto y localización) y qué día y hora de juego es;
- qué estaba haciendo: su último turno («Lo último que hiciste: …», la acción y la primera frase de lo
  que pasó);
- las misiones abiertas, la principal con su reloj («quedan 3 días»);
- las deudas abiertas, con su plazo;
- la gente que conoce y lo último que le dijo cada uno (las tres conversaciones más recientes);
- qué ha pasado en el mundo entretanto: anuncios, cambios de tablón y lo que le llegó sin que él
  actuara, desde su último evento (hasta cuatro líneas).

**Pulido opcional.** Si `RECAP_POLISH=on` y hay máster, el texto de plantilla se pasa al máster en una
llamada corta para que lo cuente en prosa. Con el máster offline `write` devuelve null y se queda la
plantilla. Por defecto está apagado: la plantilla ya cuenta lo esencial y no cuesta nada.

**Cómo se ve.** Igual que el prólogo, como bloque de libro con el título «Donde lo dejamos» y el
rótulo «Recapitulación». Se lee en alto.

## Dónde está cada cosa

| Pieza | Fichero |
|---|---|
| Datos, plantillas y prompt del prólogo y de la recapitulación | `src/engine/prologue.ts` |
| Eventos `prologue` (en `introduce`) y `recap` (`welcomeBack`) | `src/engine/engine.ts` |
| Llamada corta sin tools (`write`) | `src/ai/master.ts` |
| Primera escena más corta, sin repetir el prólogo | `src/ai/prompt.ts` (bloque «Primera escena») |
| Entrada `chapter` en la crónica | `src/engine/journal.ts` |
| Mensaje `chapter` del hilo y la recapitulación al conectar | `src/adapters/web/server.ts` |
| Bloque de libro en el hilo | `src/adapters/web/novel.ts` |
| Tests | `test/prologue.test.ts` |
