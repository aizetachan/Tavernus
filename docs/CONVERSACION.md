# Conversación con NPC: director y actor

> **27-10:** el actor queda apagado en producción (`ACTOR_MODEL=off`). La charla se guía ahora por reglas por
> situación que decide el motor: ver [CONVERSACION-REGLAS.md](CONVERSACION-REGLAS.md). Lo de abajo (transcripción,
> lo que le ronda, el trato y las reglas de conversación) sigue valiendo.

Los NPC hablaban como carteles. Ejemplo real (rama de prueba del 27-10, máster Haiku con esfuerzo bajo): el jugador
pregunta a Doro «¿De qué va la ronda del claro?» y Doro contesta «La ronda del claro. Cinco de plata por ir hasta el
roble, mirar si hay alguien y volver a contármelo. Yo no puedo dejar el portón.». Es el aviso del tablón leído en voz
alta, sin personalidad, sin reaccionar y sin conversación. Esto es lo que se ha cambiado, cómo se ha medido y qué
modelo se recomienda. Modelo de diseño: Baldur's Gate 3.

## Por qué pasaba

1. **Brevedad impuesta.** La longitud (60–90 palabras) contaba narración y diálogo juntos, y el prompt decía «mejor
   un mensaje corto». La narración se comía el turno.
2. **Sin transcripción.** La memoria del NPC son notas resumidas, no lo dicho: no sigue el hilo ni pregunta de vuelta.
3. **Sin agenda propia.** El NPC solo responde, nunca aporta.
4. **Un solo modelo** (Haiku, esfuerzo bajo) narra, aplica tools, cumple muchas reglas y además interpreta.
5. **Voces caricatura en los datos** («habla poco», «suelta las palabras de una en una»): el modelo las exagera. No se
   han tocado los datos (decisión del dueño); se corrige en las reglas: callado es decir poco con intención, no un telegrama.

## Qué hay ahora

### Director y actor (`src/ai/actor.ts`)

En un turno de conversación (el PJ habla con un NPC o un NPC le habla) hay dos llamadas:

- **Director**: el máster de siempre. Decide los hechos: qué puede decir el NPC y qué no, qué tools se aplican, si
  hay tirada. Cierra con `log_event` y pone lo que dice el NPC en `lines` como borrador (la sustancia).
- **Actor**: una segunda llamada, sin tools, con salida JSON (`{"lines": [...]}`), que escribe las palabras exactas
  del NPC. Recibe su ficha (descripción, motivación, lo que vende y compra), lo que le ronda hoy, el trato con el PJ,
  lo que recuerda de él, la transcripción literal de lo último que se han dicho y el borrador del director.

Cuándo entra el actor (`actorTurn`): un solo NPC vivo habla en el cierre, sin tirada pendiente, sin ventana decisiva,
fuera de turnos compartidos (ronda o charla de grupo), de la escena de apertura y de llegadas o ganchos.

Lo que el NPC no puede revelar no llega al actor: no ve `npc.secret`. Solo ve lo que el director ya ha puesto en el
borrador y lo que devuelva `npcKnowledge` (el punto de enganche para la confianza por niveles: allí entra lo que el PJ
se ha ganado).

Las líneas del actor pasan por el control del cierre (`actorProblems`):

- frases que el NPC ya ha dicho hace nada (`repeatedLines`);
- tratos que el director no ha cerrado (`dealWithoutState`);
- promesas de ir o acompañar sin orden (`promisedMove`);
- palabras del secreto que no estaban en lo permitido (`secretLeaks`: un nombre propio, o dos palabras raras);
- nombres de NPC que el jugador no conoce y no salen en el borrador (`unknownNames`; el suyo propio sí vale: si se
  presenta, el PJ aprende su nombre).

Si algo falla, el actor lo rehace una vez con los problemas; si vuelve a fallar, o la API da error, se queda el
borrador del director. El turno nunca se pierde por el actor.

Al aplicar (`applyActorLines`), las nuevas líneas sustituyen a las del NPC en `lines` y en las citas («») de la
narración y de lo observable, en el sitio de la primera. La web atribuye cada cita a su línea como siempre.

### Transcripción (`transcriptOf` en `src/engine/conversation.ts`)

Las últimas 10 réplicas literales entre ese PJ y ese NPC (las del PJ como actor o en un turno de grupo, y las del NPC
dirigidas a él). Las ven el actor y el máster: el NPC con quien se está hablando, entera; los demás presentes, las
últimas 4. La `memory` del NPC sigue siendo el resumen de lo de antes.

### Lo que le ronda y el trato (`src/engine/concerns.ts`)

`npcConcerns` saca, del estado y sin saber de ninguna campaña, los temas propios del NPC: lo que tiene en la agenda,
lo que ha puesto en el tablón, los sucesos que ha visto o le han contado, la muerte de alguien de los suyos, los
rumores del sitio, los encargos del PJ que son suyos o de su gente («¿encontraste el hacha de Doro?»), lo que sabe de
lo que ha hecho el PJ y lo que le debe. Punto de enganche para los hechos del mundo, la opinión numérica y los
comentarios (otra rama).

`talkTier` da el nivel de trato: hostil, receloso, extraño, conocido, amigo o aliado. Los cuatro de en medio son los
mismos nombres que la confianza por niveles (`trustTier`); al juntar las ramas, deben salir de allí. Cada nivel tiene
su manera de hablar (`TALK_TIERS`):

| Trato | Cómo habla |
|---|---|
| Hostil | Corto, frío o amenazante; no da nada gratis y puede cortar la charla. |
| Receloso | Lo mínimo; pregunta qué quiere y por qué; de lo delicado, nada. |
| Extraño | Educado, curioso o desconfiado según su carácter; pregunta quién es; habla de su trabajo y de lo que sabe todo el mundo; lo delicado lo esquiva. |
| Conocido | Saluda, recuerda lo último que hablaron y pregunta por ello, chismorrea; con lo delicado duda o pide algo a cambio. |
| Amigo | Cálido y con iniciativa: pregunta cómo va lo suyo, se preocupa, cuenta lo que sabe de la trama con sentimiento y dice a quién acudir. |
| Aliado | De su parte: cuenta todo lo que puede, avisa de peligros, ofrece ayuda. |

Qué mueve el trato (`TRUST_MOVES`), para que el NPC lo note en el momento y el director lo registre. Sube: cumplir sus
encargos y misiones, darle lo que necesita, ayudar a los suyos, adularle con gracia (si su carácter lo agradece),
persuadirle con buenas razones, volver a charlar con él. Baja: intimidarle o amenazarle, atacarle a él o a los suyos,
insultarle, hostigarle (insistir cuando ya dijo que no), mentirle y que le pille, robarle o cometer un crimen que vea.
Los números son de la confianza por niveles y de la opinión numérica (otras ramas).

### Reglas de conversación (`TALK_RULES`)

Las mismas para el actor y, dentro de «NPC QUE CONVERSAN», para el máster cuando interpreta él:

- Habla como en el chat del móvil: natural, de 1 a 4 frases por réplica; dos o tres réplicas si la escena lo pide.
- Contesta primero, de verdad. Reacciona a cómo se lo dicen. Aporta algo suyo.
- Lleva su parte: a veces pregunta, insiste en lo suyo, pide un favor, cambia de tema si algo le incomoda.
- Nunca recita el tablón: cuenta el encargo como lo contaría él (por qué le importa, qué se juega, por qué no va él).
- Hay charlas de muchas clases (encargo, charla sin más, preguntas sobre un tema o la historia del lugar, comercio) y
  ninguna es un trámite.
- Puede adornar con detalles pequeños de su vida; no inventa hechos que el jugador pueda ir a buscar.

Con actor, el máster recibe además «VOZ DE LOS NPC»: en `lines` pone la sustancia en frases llanas, y en
conversación la narración es una línea de gesto como mucho. La longitud de la narración ya no cuenta lo que se dice.

### Configuración

| Variable | Valor | Qué hace |
|---|---|---|
| `ACTOR_MODEL` | id de modelo, u `off` | Modelo del actor. Por defecto `DEFAULT_ACTOR_MODEL` (ver la recomendación). `off`, `none` o `0` lo apagan. |
| `ACTOR_EFFORT` | `low` (por defecto), `medium`, `high` | Esfuerzo del actor. |

Solo hay actor cuando el máster va contra la API con el cliente de serie (`MASTER_MODE=live`). En `offline`, `replay`
y `record`, y con un cliente inyectado (tests, banco), no hay actor salvo que se pida en `MasterOptions.actor`. Sin
clave no hay máster real y tampoco actor. Su gasto va aparte en el evento (`payload.master.actor`) y cuenta en el cupo
diario del PJ.

## Medición

Banco: `scripts/talk-bench.ts`. Siete charlas: cinco de las partidas del 26-10 y del 27-10 (Brenna, Ilse, Hugo),
la charla amistosa con Brenna que propuso el dueño y el ejemplo de Doro. Cada una se monta en una partida recién
creada (Brezal o la demo) con el historial y los recuerdos de entonces. Variantes:

- **A**: Haiku solo, con el prompt de antes (el banco le quita las reglas nuevas, la transcripción y el trato).
- **B**: Haiku solo, con las reglas, la transcripción, lo que le ronda y el trato.
- **C**: Haiku director + Sonnet actor.
- **C2**: Haiku director + Haiku actor (el mismo borrador que C).
- **D**: Sonnet para todo el turno (solo si sobra presupuesto).

El juez es Haiku 5.5 con rúbrica de 1 a 5: naturalidad, personalidad, coherencia con el mundo, que no destripe el
secreto y que siga el hilo. Las respuestas le llegan con etiquetas ciegas. Tope duro de gasto: 0,09 $ (el dueño
puso 0,10 $ para todo).

```bash
node --env-file=<ruta del .env> --import tsx scripts/talk-bench.ts --live --cap 0.09
```

### Primera pasada (2026-10-27): qué salió

Gastado: 0,093 $ en 37 llamadas (la última llamada pasó el tope por 0,003 $; ahora el banco deja de llamar con un
margen de 0,012 $). Informe completo en `data/local/bench/talk-2026-10-27T06-48-00.md`.

Lo que no salió, y por qué:

- **Tres de las siete charlas no valen** (Doro, Ilse con la Brasa, Hugo con los eslabones): fallo del montaje del
  banco, no del actor. Ilse y Hugo volvían a su sitio por su horario al empezar el turno, y en la demo la ronda no
  estaba en el tablón, así que el máster contestó que allí no había nadie o que no sabía de qué ronda le hablaban.
  Corregido (el banco quita el horario del NPC de la escena y pone en el tablón los encargos del escenario) y
  comprobado en offline. No se ha repetido para no pasar el tope.
- **El juez no llegó a correr**: el tope saltó antes. La valoración de abajo es una lectura mía con la misma rúbrica.
  No es ciega y la hace quien escribió las reglas: tómala como orientativa.
- **D (Sonnet para todo el turno) no se midió.** Con los precios de la tabla (Sonnet cuesta 20 veces Haiku en entrada
  y salida) y los tokens de B, un turno rondaría 0,05–0,06 $: unas 20 veces B y unas 8 veces C.

Coste y latencia por turno (media de los turnos válidos; incluye la escritura de la caché del primer turno de cada
variante, así que en una partida larga baja):

| Variante | Coste medio por turno | Latencia media |
|---|---|---|
| A · Haiku, prompt de antes | 0,0031 $ | 6,7 s |
| B · Haiku con reglas, transcripción y trato | 0,0030 $ | 6,4 s |
| C · Haiku director + Sonnet actor | 0,0069 $ | 8,5 s |
| C2 · Haiku director + Haiku actor | 0,0003 $ más que B (solo el actor) | +1,5 s |

Lectura con la rúbrica, en las cuatro charlas válidas (Brenna el primer día, Brenna amiga, Brenna con descaro, Ilse
con el moribundo; media de las cinco notas, de 1 a 5):

| Variante | Media | Qué se ve |
|---|---|---|
| A | 3,5 | Contesta, pero cerrada: «Si quieres algo, dilo, que no tengo todo el día» a un amigo; a «no nos times» sirve sin decir nada. |
| B | 4,1 | Pregunta de vuelta («¿Y tú? Nadie entra aquí con cara de descanso»; a un amigo: «¿Ha dado algo de sí lo tuyo?»). Al descaro aún no reacciona. |
| C | 4,5 | Lleva la charla: a un amigo le pregunta por «esa carta» (de lo que recuerda) y le ofrece la cena; al descaro, «a mí no me hables de timos en mi barra» y una pregunta; saca la misa del pozo (de lo que le ronda). Un fallo: en una primera charla dijo «ya me preguntaste lo mismo la otra vez». Corregido con una regla («no inventes charlas anteriores»). |
| C2 | 3,6 | Casi copia el borrador del director: le añade el nombre del PJ o una palabra. Barato, pero no aporta. |

Ejemplo (Brenna, amiga del PJ; el jugador: «Hola Brenna, ¿qué tal va el día?»):

- A: «Igual que ayer. Ceniza en el umbral y la jarra sin fregar. Si quieres algo, dilo, que no tengo todo el día.»
- B: «Igual que ayer. Gris, con ceniza en todo. Si dejas la jarra abierta, a la hora ya sabe a granero.» «¿Y tú? Te
  veo cansado. ¿Ha dado algo de sí lo tuyo, o sigues dando vueltas por el valle?»
- C: «Igual que ayer. Hay ceniza en el pan y en las vigas, y el de la harina quiere cobrar más. Pero la taberna sigue
  en pie, y eso ya es algo.» «¿Has comido? La cena es a las siete, aquí en la barra, así que pide antes de que se
  acaben las gachas. Y tú, ¿qué tal con lo tuyo, has averiguado algo de esa carta?»

## Recomendación

1. **Las reglas, la transcripción, lo que le ronda y el trato se quedan siempre.** Es la mejora más grande (de A a B)
   y no cuesta nada: B cuesta lo mismo que A.
2. **Actor por defecto: Sonnet 5.5 con esfuerzo bajo** (`DEFAULT_ACTOR_MODEL`). Es lo que más acerca las charlas a
   lo que pide el dueño (el NPC lleva la iniciativa, reacciona al tono y usa lo que recuerda). Cuesta unas 2,3 veces
   un turno de conversación de B (+0,004 $) y añade unos 2 s. Solo entra en turnos de charla con un NPC.
3. **Haiku como actor, no**: apenas cambia el borrador. Para pruebas baratas, `ACTOR_MODEL=off` (queda B).
4. **Sonnet para todo el turno, no**: unas 8 veces C por turno, y el actor ya pone la voz.
5. **Pendiente:** repetir el banco entero con el montaje corregido y el juez (unos 0,10 $) antes de darlo por cerrado.
   Son siete charlas: la muestra es pequeña.

## Al juntar con otras ramas

- **Confianza por niveles (B2).** `talkTier` (`concerns.ts`) usa los mismos nombres que `trustTier`: los cuatro de en
  medio deben salir de allí. `npcKnowledge` (`actor.ts`) debe devolver lo que el máster ya recibe con `knowledgeLine`
  (lo que el PJ se ha ganado), nunca el resto del secreto. Y `secretLeaks` debe mirar el saber de los niveles no
  alcanzados en vez de `npc.secret`.
- **Hechos, opinión y comentarios (I).** Entran como más líneas en `npcConcerns`. Si la opinión numérica mueve la
  actitud, `talkTier` ya lo recoge.
- **Rincones y nombres (B1).** El actor solo nombra a quien el jugador conoce o el director ha nombrado
  (`unknownNames`). Si B1 cambia cómo se aprenden los nombres, `applyActorLines` (que da el nombre del NPC si se
  presenta) debería usar su función.
