# Análisis cualitativo de las partidas automáticas (26-11-2026)

Lectura completa, turno a turno, de las 23 partidas de las tandas 4 y 5, las que corren sobre el código con los arreglos
1 a 19 (`main` bbb7856 y 92f32cb): 13 perfiles en solitario (`data/local/autoplay/20261126-0418`), 3 parejas vistas desde
los dos lados (`20261126-0442`) y 4 perfiles mecánicos (`20261126-0602`). 920 acciones, con Haiku 5.5 a esfuerzo bajo de
máster y de jugador. Cuatro lectores (Opus) con la misma rúbrica, uno por bloque; este documento cruza lo que trajeron.
Los números de turno remiten a `transcripts/<perfil>.md` de cada tanda.

Lo que miden los informes de las pasadas (`docs/INFORME-PASADA-4-2026-11-26.md`) son contadores: errores por 100 acciones,
cobertura de tools, rachas. Esto es lo otro: **cómo se lee una partida**. La conclusión corta: el motor hace bien lo que
hace (tiradas, inventario, ley cuando entiende la acción, misiones cuando se dan), pero la partida se lee mal por cinco
cosas que se repiten en todas: los NPC no están donde la narración dice, el motor convierte acciones inocentes en robos o
ataques, las frases de ambiente las dice quien no toca, las parejas leen lo del compañero como si fuera suyo, y la escena
no avanza porque el jugador automático y el máster se quedan en bucle.

## Patrones transversales

Ordenados por cuántas partidas los tienen y por cuánto estropean la lectura.

### 1. Los NPC no están donde la narración dice (23 de 23)

El motor mueve a los NPC por su rutina (`life.ts`, eventos `npc_move`) y el máster narra con la foto anterior, o al revés:
narra una salida que el motor no ha hecho.

- Ilse «se va del pozo, camino de la misa» (motor) y sigue removiendo el caldero en su casa durante 19 turnos (charlatán
  T11 a T30; también metódico T16 y T17, rompejuegos T15 y T19).
- Garrán «se va de la barra» (pícaro T10) y contesta cuatro turnos más, hasta que «Nadie llamado Garrán está aquí» (T23).
  En tres partidas está a la vez en la taberna (la entrada del hombre de la ceniza) y «en la casona, en el banco de espera».
- Hugo desaparece sin línea de salida (dirigido T7, herido T12, novato T26), reaparece martilleando (dirigido T34), «se ha
  ido a cenar» en el mismo turno en que acaba de derribar a Fiona (pareja violento T2), y «cierra la fragua» sentado en la
  taberna (novato T26 y T33).
- El sereno está, no está y vuelve a estar en el portón en cinco turnos (pareja violento T24 a T34). Brenna entra en la Casa
  de las hierbas y al turno siguiente está en la mesa del fondo del Jabalí (impredecible T13 y T14).
- El jugador mismo cambia de sitio sin moverse: entra en el Jabalí y grita tres turnos con el estado en `loc_plaza` (herido
  T23 a T25); «Pasas por Plaza del Pozo» sale después de llegar (rápido T9, metódico T33, herido T32); el calabozo
  aparece sin traslado (rompejuegos T35 y T36, que además dice «Despiertas» tras un «Ya estás despierto» del motor).

Es la mitad de las «incoherencias con el contexto» del juez en todas las pasadas (9,4 por 100 en la 4). Las guardas de
hoy no lo cubren: el arreglo 23 del informe 4 lo describe y no está hecho.

### 2. Acciones inocentes convertidas en robo o ataque (9 de 23)

`conflictKindOf` y la lectura de la acción son demasiado anchos: cualquier verbo de agarrar, coger o lanzar cerca de un NPC
acaba en `conflict_act`.

- «Me lanzo al pozo» → robo de la vela, alguacil y «¡Alto! Quedas detenido» en el mismo turno (rompejuegos T15).
- «Lanzo Vuelo» → «intentas arrebatarle la bolsa» al sereno, Atletismo con éxito, etiqueta «ladrón», segunda detención
  de 50 monedas (rompejuegos T31). «Proyectil mágico al aire» → robo al alguacil (T33).
- «Le planto la vela en la mano a Ilse» (dársela) → Juego de manos, «¡Ladrona!» y detención (impredecible T9).
- «Le doy un codazo a Elmo: ¿y tú qué opinas de Ilse?» → `request_reaction` de ataque, Elmo se resiste, **estocada 19+4
  contra CA 15, 10 de daño, Elmo a 0 PG**; Mirela nunca sacó el arma y nadie lo comenta después (pareja metódico M15 y E16).
- «Escondo mis monedas por si alguien me roba» → robo de la bolsa de la tabernera con tirada (deudor T32; arreglo 29 ya en
  `main`, posterior a esta tanda).
- Agarrar del brazo al molinero → «has golpeado al molinero» y aviso de ley (violento T5); en cambio amenazar con el hacha
  diez turnos y robar un garrote con violencia no tiene ninguna consecuencia (violento T20, T25, T37).

Donde la lectura es correcta, la ley funciona: el pícaro que roba a Brenna y es detenido con un solo «¡Alto!» (pareja pícaro
B37), los agarrones entre Fiona y Elmo con tirada enfrentada (pareja violento F2, F30).

### 3. Frases de ambiente en boca de quien no toca (12 de 23)

`CHATTER` de Brezal (`src/data/campaigns/brezal/reactions.ts`, bloque «Vida diaria») tiene frases de vecino genérico y
`chatter.ts` se las da a cualquier NPC presente, sin mirar quién es:

- «Si Garrán viene a cobrar otra vez, yo no tengo ni para pan» la dice **Osric, el regidor**, que es quien manda cobrar
  (pausado T1, rompejuegos T2, charlatán T2, impredecible T2, lanzador T4, deudor T2), y también la curandera (rápido T23,
  herido T15) y el sereno (dirigido T6, cronista T4).
- «Otra jarra, Brenna, que mañana será peor» la dice **la propia Brenna** («La tabernera, al pasar») en siete partidas
  (rápido T4, explorador T21, dirigido T20, impredecible T14, herido T32, deudor T19, cronista T40).
- «El herrero, al pasar» dentro de la taberna (deudor T33); «La guardia», en femenino, para Doro (herido T33, deudor T20).

Es un fallo de datos y de motor pequeño y muy visible: cada frase necesita quién puede decirla (o quién no), y el
`speakerLabel` no debe poner a Brenna hablándole a Brenna.

### 4. En pareja, cada jugador lee lo del otro como suyo, y por duplicado (3 de 3 parejas)

En los turnos compartidos, el texto que le llega al compañero está en segunda persona y repetido:

- Ciro lee «Le preguntas a Garrán qué saca él de esperar tres días» (acción de Bruno, C2), «Te acercas al jornalero y pones
  la daga sobre la mesa» (C12). Elmo lee «Sueltas la capa de Elmo y das un paso atrás» (E4), «Desenvainas el gran hacha»
  (E19). Mirela lee «Abres los ojos con el pecho ardiendo» (M17), que es Elmo volviendo en sí.
- El mismo párrafo sale dos veces en C2, C4, C10, C12, E4, E7, E9, E17, E19, E28, M12, M17, M18, M23, M24, M26, M29 y M35.
- Del lado de Elmo el orden se invierte: el resultado de la tirada antes de la pregunta «¿Te dejas o te resistes?» (E2),
  «Aceptas ración» antes de «Fiona te ofrece» (E6).

El contador «sin su parte» del informe (1 de 22) no lo ve: ahí hay `narration_by_pc`, pero lo que se entrega al compañero
es la parte del otro. Hay que mirar si es el motor (`audience.ts`, qué se emite a quién) o la herramienta (`seenSince` en
`autoplay.ts`, que une `texts` y eventos vistos y puede estar duplicando). En cualquier caso, en la web se leería igual
de mal si es el motor.

Además, **Bruno ve a Ciro como «el jornalero» toda la partida** (B1, B16, B17, B29 a B31): el NPC Ciro el jornalero y el
jugador Ciro se confunden en la narración, y el robo al compañero (B9) lo contesta un NPC («De eso no sé nada. Pregúntale a
Brenna») sin tirada ni aviso a Ciro. El arreglo 7 lo enrutó al máster; el máster sigue sin saber quién es quién.

### 5. Respuestas del motor sin máster que no contestan a nada (11 de 23)

Las respuestas rápidas (`fastpath`, `extratalk`, charla con secundarios) salen en menos de dos segundos y en rachas:

- «No tengo tiempo para charlas» de la lavandera y de Fermina, cuatro y tres veces seguidas (rompejuegos T5 y T8 a T11;
  cronista T16 a T18); la criada repite «El señor regidor recibe por la mañana» a quien le pide una poción (herido T16 a
  T19); «Sigue tu camino» del sereno (pausado T19, recolector T26).
- El rumor «La escapada al granero: cada día a las 23:00, en el arroyo» como respuesta a cualquier cosa (rompejuegos T9,
  charlatán T33, T34 y T37).
- «Dices: «…»» sin réplica (charlatán T1 y T3); «¿Con quién?» (pareja pícaro C9); «Ya estás despierto» (rompejuegos T35).
- Los bloqueos «Garrán está con Bruno; te hace un gesto para que esperes» cuando la pregunta iba al compañero (C5, C7, C8,
  E16, M1, M2, M27, M36).

Trece de 160 turnos en los perfiles mecánicos. Cada uno es un turno perdido para el jugador.

### 6. Tiradas que se ven a medias y narraciones dobles (14 de 23)

- Líneas «🎲 Percepción», «🎲 Sigilo», «🎲 Investigación» sin dado ni resultado: 14 turnos en el explorador, 9 en el tirador,
  y en pausado T26, rápido T16, dirigido T11 y T33, lanzador T14, T15, T31, T37 y T40, impredecible T4, T5, T12 y T13,
  pareja pícaro C23, B27, B33, pareja violento E5, E30, pareja metódico M19, cronista T3, recolector T3 y T5.
- Casi siempre con dos narraciones del mismo turno, y la del resultado antes que la de la intención (explorador, tirador
  T1 y T20, herido T25, deudor T1 y T27, recolector T23 y T36).
- Tiradas ignoradas: Persuasión 18 con éxito y Garrán sigue con «tres días» (pareja pícaro B4); Intimidación fallida y el
  guardia cede (pareja violento F35); el golpe se narra como dado y luego la tirada falla (F36); Engaño con éxito que «no
  se traga del todo» (pícaro T5); Persuasión fallida con consecuencia que se anula al turno siguiente (metódico T16 y T17).

Las tiradas ocultas (`hidden`) y las de percepción pasiva explican parte de las líneas sin número, pero el orden invertido
y la doble narración son de cómo se compone el turno (dos cierres del máster: antes y después de la tirada). Hay que mirar
si en la web se lee igual o es la herramienta.

### 7. Daño, muerte y reaparición mal contados (8 de 23)

- Hugo pega dos veces en el mismo turno (pareja violento F1; violento solo T2 y T4): arreglo 19, ya en `main` después de
  esta tanda.
- De 0 PG a 1 PG con una sola salvación con éxito y en pie al turno siguiente (pareja violento F2, pareja metódico E17).
- El violento muere en la herrería y aparece en el molino a 7/14 sin transición (T4 y T5); el recolector baja de 9 a 0 sin
  tiradas ni cifras (T10), lanza Curar heridas inconsciente (T11), reaparece al turno siguiente aunque el aviso decía «dentro
  de 2 h reales», y en T36 «Estás a salvo» y «Caes al suelo, inconsciente» en la misma respuesta tras una tirada con éxito.
- Daño fijo sin dado: 5 PG por un 1 natural al trepar (lanzador T9); 4 → 2 PG porque la carta «te muerde las yemas» (T15).
- La lanza del guardia deja al rompejuegos a 0 PG de golpe (T34), de 7 a 0 sin tirada.

### 8. El lanzador y el tirador: la mecánica de clase no se aplica (2 de 2)

- Pide Rayo de escarcha y el máster tira «Descarga de fuego (daño fire): 1d10 [6]», etiqueta en inglés, sin tirada de
  ataque y sin blanco (lanzador T2 y T5); después niega el mismo tipo de conjuro «porque necesita una criatura» (T17 y T21)
  y luego «no llega a nacer: el brocal es piedra mojada» (T18). Ningún espacio de conjuro se gasta en 40 turnos. Mano de mago
  abre un candado con prueba de Destreza (T26). Abre el arcón del buhonero y fuerza el portón norte sin ningún aviso de ley.
- El tirador dispara tres veces (T7, T22, T40) y nunca hay tirada de ataque; «Sentido salvaje» se ignora (T5) y «Acecho
  gastando un uso», que no es rasgo suyo, se acepta (T20). Recolectar sin tirada (T2, T17) y nada entra en el inventario.
  Treinta y siete turnos en la herrería con el legado del padre encontrado y sin cogerlo.
- El herido está a 13/13 desde el turno 4: 33 de sus 37 peticiones de curación y descanso no miden nada. Tomar aliento da
  «+5» a vida llena (T27) y luego «ya lo gastaste» (T36). Los descansos cortos solo dan hora una vez (T4).

### 9. La escena no avanza: bucles de NPC y de jugador (17 de 23)

- Hugo y «el jueves» de Garrán nueve veces (rápido T11 a T40); «Págale a Osric» y «banco de espera» (dirigido T21 a T28,
  novato T23 a T36, pícaro T35 y T40); Ilse y «pregúntamelo junto al pozo, con testigos» siete veces (charlatán); el rencor
  de Brenna seis veces (pícaro); el gancho del perro Ceniza ocho veces sin convertirse en misión (deudor T21 a T39); la tos
  del molinero casi cada turno (violento, 35 turnos en el molino sin una pista).
- «Pasos que se acercan y se detienen» ocho turnos sin que aparezca nadie (pausado T21 a T28).
- Las acciones sugeridas proponen hablar con quien ya se fue (pausado T7, explorador T4 y T11, dirigido T19, novato T7) o
  son las del compañero (pareja pícaro C13, pareja metódico M13), o llevan a «Ya estás en la plaza» (impredecible T30).
- Arranques pegados que no casan con la acción: «Te acercas al caldero» antes de llamar a una puerta cerrada (charlatán T6,
  metódico T6 y T28), «Te acercas al pozo» cuando va a la taberna (impredecible T2), «Te acercas a los sacos» y cruza hasta
  la puerta (violento T19). Es la línea de aproximación del motor puesta aunque el destino no sea alcanzable.
- La mitad de las respuestas empiezan copiando entre comillas la frase del jugador (rápido, dirigido, deudor).

El tope de racha del arreglo 13 funciona cuando el NPC tiene adónde ir (metódico 22 → 10, rompejuegos 20 → 4) y no cuando
es charla pura; el arreglo 21 del informe 4 (cerrar de verdad) sigue pendiente.

### 10. El estado no recoge lo que pasa (10 de 23)

- `misiones 0` con «📖 Nueva misión» en pantalla (pausado T11, cronista toda la partida con tres misiones abiertas,
  explorador y dirigido con pasos marcados). Puede ser el contador de la herramienta (`open` en `autoplay.ts`) y no el juego:
  hay que comprobarlo, porque el informe compara con él.
- Hallazgos sin pista: «jueves» y la marca de Vharn en el cuaderno (novato T4), Historia 20 sobre el sello de la sal
  (lanzador T30), el encargo del carbón aceptado por Hugo (novato T38) y la «Ronda hasta el Soto» cogida del tablón
  (impredecible T7) sin registro.
- La misión del agua se completa con un cántaro que no consta en ninguna transferencia (pareja metódico E31 y E32), y el
  aviso «Ilse nos contó qué es la Brasa» recoge un diálogo que no se narró (E32, metódico solo T10).
- El reparto en pareja es desigual: Elmo se lleva misión, plata y PX; Mirela, que sacó el agua, acaba con `misiones 0`.

### 11. El máster acepta lo que el jugador inventa, a ratos (9 de 23)

- Acepta: la cuchara de plata (pícaro T8), la balada de Vharn como real («vete a preguntárselo a quien la escribió»,
  impredecible T37 a T40), el hermano del charlatán (T19), la herida en la pierna del herido (T21 en adelante), la deuda con
  Hugo del dirigido (T7, T10, T34), que Ilse le agarre la muñeca al recolector (T14).
- Niega bien: las torres inventadas (rompejuegos T2, T14), la cocina que no existe (pícaro T22), la pala, la puerta trasera
  y el pasadizo (explorador T5, T6, T26, T29), la daga que no lleva (tirador T6, T25, T37), el cuenco del perro (deudor T24).

La regla del prompt («lo que solo toca a su personaje es verdad para él») está bien, pero «me duele la pierna» y «mi hermano»
deberían pasar por `record_character_fact` y no quedarse en la narración.

### 12. Textos de interfaz (23 de 23)

- El volcado del tablón aparece a mitad de escena con fecha «00:00» y viñetas «•» (pausado T12, explorador T18, dirigido
  T34, tirador T37, charlatán T33, impredecible T6 y T23, deudor T33, herido T38): es el evento programado del tablón
  entregado como narración, y además sus encargos cambian de una lista a otra (leña, bayas, ronda; luego carbón, pescado,
  toma del arroyo).
- «·» como separador en las tiradas del compañero («🎲 Bruno · Persuasión»), en las salvaciones («éxitos 1/3 · fallos 0/3»)
  y en los encargos («lo pide Brenna · 6 de plata», ya quitado en `main`).
- El epílogo es el mismo en las 23 partidas, repite «Amanece el sexto día» dos veces seguidas y narra la noche de la Brasa
  cuando la partida acabó el día 2 hacia medianoche.
- Erratas: «el herrero el herrero» (pícaro T23), «el sereno el sereno» (impredecible T6), «el buhonero el buhonero» (pareja
  C35), «el guardia el guardia» (deudor T19), «le te pide» (E16), «Mastinas» (E25), «Mirás» (dirigido T33), «El guardia viene
  a ayudar a detener a ti» (rompejuegos T33).

## Lo que es del jugador automático, no del máster

Para no cargarle al máster lo que no es suyo:

- **Habla con quien no está** en las 23 partidas: el violento amenaza a Hugo ocho veces desde el molino; el herido, el
  cronista, el deudor y el recolector repiten la escena inicial con Ilse («suelta mi muñeca») diez turnos después.
- **Inventa objetos y rasgos:** llave y caja (rápido), pala, puerta trasera, pasadizo, patio, callejón (explorador), cofre,
  ganzúa, daga, vendaje (tirador), caballos, carro con mula (tirador), «Acecho» (tirador), daga de plata del padre (pícaro),
  tónico, ración, cuenco, «deuda del laúd» (deudor), herida en la pierna (herido).
- **No sabe que ha muerto y reaparecido** (violento, recolector): sigue en la escena anterior. Es H9 del informe 4.
- **El cronista tiene tres pasados y cuatro hermanas** (cerero de Vharn, copista, tallista de Vadoscuro; Aldara, Maren,
  Maera, Maelis): el perfil necesita una biografía fija en su prompt para que `record_character_fact` mida algo.
- **El herido se cura a tope en el turno 4** y el recolector muere en el turno 11 y pide su capa diez turnos más: H11 y H12
  ya corregidos en `main`, pero el daño inicial del herido es corto.
- **Bucles de perfil:** el novato pregunta «¿cuánto oro vale una antorcha?» tres veces y «¿qué hago ahora?» ocho; el pausado
  come ración en once turnos; el charlatán repite «¿y tú qué opinas de Ilse?» cinco veces. Son el perfil, pero inflan las
  rachas y los rechazos que medimos.

## Lo que funciona

- **Las correcciones de lo inventado**, cuando las hace: «No hay ninguna herrería en este molino», «No llevas daga… tu hoja
  es la espada corta», «No hay banco en el portón: te sientas en el borde de piedra».
- **Las tiradas enfrentadas entre jugadores** (pareja violento: Atletismo 14 contra Acrobacias 4) y las ofertas de objetos
  entre ellos (raciones, antorchas), con «Es suyo si lo acepta».
- **La ley cuando entiende la acción:** el robo a Brenna con un solo «¡Alto! Quedas detenido» y el cargo correcto.
- **Las misiones que se dan en escena:** Ilse y el agua turbia (metódico T10, pareja metódico E28 a E32, con pista y
  recompensa), Doro y la cena del portón (cronista T27, pícaro T37).
- **Momentos de voz:** Brenna «Con esos modales no te doy ni la sal»; Hugo «Lo que guardaba mi maestro no sale a golpes»;
  Ilse pillando la mentira «Tus manos llevan una maza y un escudo» y las versiones distintas del cronista «de tallistas y
  copistas ya me has contado bastante»; Osric «tarda un poco más de lo necesario» en apartar la vista de la carta.
- **El motor en lo suyo:** inventario y alcances exactos («a 12 m: fuera de alcance»), el descanso con hora («Son las
  19:12»), la muerte instantánea bien calculada, el rastreo con Supervivencia que separa huellas viejas y frescas, la
  escena a tres de Ilse contestando a cada uno lo suyo (pareja metódico E35 y M35).

## Jugabilidad, partida por partida

| Más jugables | Por qué |
|---|---|
| metódico (solo y en pareja) | completa una misión, saca pistas, abre otra, consigue una misión nueva; Ilse en su papel |
| pausado | misión, Ilse coherente de T11 a T15, tres lugares, pista con tirada útil |
| explorador | dos pistas y buenas correcciones de lo inventado; le lastran 14 tiradas sin resultado |
| novato | el máster explica las reglas dentro del mundo con claridad, aunque no avanza nada |

| Menos jugables | Por qué |
|---|---|
| violento (solo y en pareja) | daño sin tirada, 0 PG en el turno 2 o 4, salto sin explicar al molino, 35 turnos sin pista, hacha y garrote «en el bolsillo» |
| rompejuegos | dos conjuros convertidos en robos, dos detenciones y un 0 PG sin tirada |
| rápido | cero pistas, quince turnos de bucle con «el jueves» |
| pareja pícaro y novato | Bruno ve a Ciro como «el jornalero», el robo y la amenaza entre ellos no se resuelven, Ciro no ve a Bruno en la misma sala (C38), detención al revés de lo que hace el jugador |
| lanzador | cambia el conjuro, regla del blanco distinta según el turno, PG sin tirada, colgada en el pozo mientras empieza la misa |

De los mecánicos, el cronista es el que mejor mide (deja estado visible) y el recolector y el herido los que peor (muere a
mitad; vida llena desde el turno 4).

## Qué arreglar primero

Siguen la numeración de los informes (hasta el 29 y H12). Por orden de lo que más estropea la lectura:

30. **Presencia de NPC en la narración.** Guarda: un NPC que el motor ha movido fuera de la sala no habla ni actúa en el
    cierre; un NPC que no estaba no aparece sin `set_npc_order` o evento del motor; y la lista de presentes del contexto
    manda sobre la memoria del máster. Patrón 1. Es el arreglo 23 del informe 4, con prioridad máxima.
31. **`conflictKindOf` más estrecho.** Lanzar un conjuro, saltar, dar algo en la mano, un codazo para llamar la atención y
    pescar no son robo ni ataque. Lista de verbos con blanco explícito («le quito», «le arrebato», «meto la mano en su»),
    y un codazo o palmada a otro jugador es `touch`, no `attack`. Patrón 2.
32. **Frases de ambiente con hablante.** Cada texto de `CHATTER` lleva quién puede decirlo o quién no (`not_npc_ids`,
    rol), y nunca el NPC al que nombra. «La guardia» → «el guardia». Patrón 3.
33. **Lo que lee el compañero en un turno compartido.** Comprobar en el motor (`audience.ts`) y en la web qué recibe cada
    jugador; lo del otro va en tercera persona y una sola vez. Si es la herramienta (`seenSince`), es H13. Patrón 4.
34. **El compañero no es un NPC.** Cuando un jugador y un NPC comparten nombre (Ciro), el contexto lo marca y el máster no
    confunde; un robo o amenaza a un JUGADOR nunca lo contesta un NPC. Patrón 4.
35. **Respuestas rápidas que contestan.** Las enlatadas de secundarios («No tengo tiempo para charlas») solo si la acción es
    charla; un rumor nunca es respuesta a una acción; «¿Con quién?» y «Ya estás despierto» no se devuelven a quien está
    haciendo otra cosa; «te hace un gesto para que esperes» no bloquea una pregunta dirigida al compañero. Patrón 5.
36. **Un cierre por turno con tirada.** La narración de la intención y la del resultado no se enseñan las dos, o se enseñan
    en orden; las tiradas que se muestran llevan dado y resultado. Patrón 6. Comprobar primero si es la web o la herramienta.
37. **Rendirse es rendirse.** «Me entrego» o la sugerencia de rendirse nunca se trata como resistencia («ya te ha avisado una
    vez»); el cargo cita lo que pasó (agarrar no es golpear). Patrón 2 y 7.
38. **0 PG, muerte y reaparición.** Una salvación con éxito no levanta a 1 PG; la reaparición se narra (dónde, cuándo, con
    qué PG) y el jugador lo lee; no se lanza nada inconsciente. Patrón 7.
39. **Conjuros y rasgos por su lista.** El conjuro que se tira es el que pide el jugador o no se tira; daño de conjuro con
    tirada de ataque o salvación; espacios que se gastan; un rasgo que no está en la ficha se niega («no tienes Acecho»);
    disparar es `attack`. Patrón 8.
40. **Lo que el jugador cuenta de sí mismo pasa por `record_character_fact`** o no es verdad: herida, hermano, deuda. Patrón 11.
41. **Línea de aproximación solo si llega.** «Te acercas a X» no se antepone cuando la puerta está cerrada o el destino no
    es alcanzable. Patrón 9.
42. **El tablón no se vuelca a mitad de escena.** El evento programado del tablón va como aviso corto («Hay avisos nuevos en
    el tablón») y no como lista con «•» y «00:00»; y la lista de encargos no cambia entera entre dos lecturas. Patrón 12.
43. **Epílogo veraz.** Sin «Amanece el sexto día» dos veces, y acorde al día en que acabó la partida. Patrón 12.
44. **Erratas del motor:** «el guardia el guardia», «le te pide», «a detener a ti». Un pase por las plantillas. Patrón 12.

De las herramientas:

- **H13.** Comprobar si la duplicación y la segunda persona de los turnos compartidos y las narraciones dobles con tirada son
  de `autoplay.ts` (`seenSince`, `texts`) o del motor, antes de tocar el motor.
- **H14.** El contador `misiones` de `TurnState` frente a las misiones abiertas de verdad (📖): si no cuadra, el informe
  compara mal.
- **H15.** Biografía fija para el cronista; daño inicial mayor para el herido (o que no se cure a tope); el jugador
  automático que sabe que ha reaparecido (H9).
- **H16.** Que el juez cuente los patrones 1, 3 y 5 (presencia, hablante, enlatadas) como categorías propias, para medirlos
  en la próxima pasada.

## Qué significa para la partida a mano

Con dos personas en tavernus.com, lo que más se va a notar son los patrones 1, 3, 4 y 5: un NPC que «se ha ido» y sigue
hablando, Brenna diciéndose «Otra jarra, Brenna», leer la acción del compañero como propia, y una respuesta enlatada a una
pregunta de verdad. El combate y la ley ya aguantan si la acción se entiende; el riesgo está en el patrón 2, que una frase
inocente acabe en «¡Ladrón!». Conviene arreglar 30 a 35 antes de esa partida.
