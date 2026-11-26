# Informe de la pasada 4 (26-11-2026): la pasada corta tras los arreglos

Cuarta tanda del plan `docs/PLAN-PRUEBAS-CREDITOS.md`: la misma pasada corta de la pasada 1 (`docs/INFORME-PASADA-1-2026-11-25.md`),
con Haiku 5.5 a esfuerzo bajo de máster, sobre `main` bbb7856, que lleva los cuatro paquetes de arreglos de
`docs/PLAN-ARREGLOS-2026-11-26.md` (guardas de `log_event`, ley y combate, prompt y datos de Brezal, herramientas de prueba).
Mismo jugador automático, juez y actor (Haiku, Haiku y Sonnet), semilla 1, Brezal. Lanzada por la sesión orquestadora;
análisis de esta sesión. La pregunta es una: **qué ha cambiado respecto a la foto del 25-11**.

| Tanda | Dónde | Referencia |
|---|---|---|
| 13 perfiles, 40 acciones | `data/local/autoplay/20261126-0418` | `20261125-1051` |
| 3 parejas, 40 acciones por jugador | `data/local/autoplay/20261126-0442` | `20261125-1115` |
| Creatividad | `data/local/bench/creativity-claude-haiku-5-5-low-2026-11-26T03-55-15Z.md` | `…2026-11-25T10-30-03Z.md` |
| Conversación | `data/local/bench/talk-2026-11-26T04-01-51.md` | `talk-2026-11-25T10-36-39.md` |

Los `playtest.md` de las dos tandas de autoplay llevan `--baseline` contra la pasada 1: cada casilla es «antes → ahora».
Ojo con una cosa de la herramienta: la columna «Golpes con tirada de ataque» es nueva (H2 y H6) y el informe la recalcula
también sobre la referencia, así que esa casilla sí compara igual con igual.

## Coste

| Qué | Plan | Real |
|---|---:|---:|
| 13 perfiles | 1,60 $ | 1,72 $ (1,64 de partidas, 0,08 de juez) |
| 3 parejas | 0,80 $ | 0,59 $ |
| Creatividad | 0,05 $ | 0,04 $ |
| Conversación | 0,15 $ | 0,12 $ |
| **Total pasada 4** | **2,60 $** | **2,47 $** |

Acumulado: unos 31,5 $ de los 200 $. Ningún 429, ninguna partida cortada: las 19 llegaron a las 40 acciones.

Por acción del máster: 0,0033 $ en perfiles (pasada 1: 0,0027 $) y 0,0025 $ en parejas (0,0022 $). El 20 % de más no es
por reintentos (llamadas al máster por acción 1,19 → 1,16): es el prompt, un 8 % más largo tras el paquete C. Espera media
por acción 7 a 12 s en solitario (igual que antes) y 14 a 17 s en pareja (18 s antes).

## Lo que cambia, en una tabla

| Métrica (40 acciones) | Pasada 1 | Pasada 4 |
|---|---|---|
| Errores por 100 acciones, perfiles (detectores y juez) | 43 | **30** |
| Errores por 100 acciones, parejas | 31 | **24** |
| Incoherencia con el contexto, perfiles | 18,3 | **9,4** |
| Regla mal aplicada, perfiles | 10,4 | 8,7 |
| Inventiva del jugador mal gestionada, perfiles | 3,8 | 1,9 |
| Narración por encima del tope, perfiles | 3,3 | 2,7 |
| NPC fuera de personaje, perfiles | 2,5 | 3,1 |
| «undefined» en la narración | sí (novato, 7 veces) | **0** |
| Cierres rechazados por «el pasillo» | 2 | **0** (quedan 3: «patio», «despensa», «ventana») |
| Mayor racha con un NPC: metódico, rompejuegos, novato | 22, 20, 20 | **10, 4, 8** |
| Mayor racha con un NPC: charlatán, pícaro, pausado | 11, 12, 2 | 25, 17, 8 |
| Violento: ataques de NPC, veces a 0 PG | 8, 1 | 1, 1 |
| Rompejuegos: ataques de NPC, veces a 0 PG, turnos con rechazo | 5, 2, 39 % | 3, 1, 22 % |
| Violento en pareja: golpes con tirada de ataque | 0 de 0 | 1 de 5 |
| Parejas: cierres compartidos sin la parte de un jugador | 4 de 23 | **1 de 22** |
| Parejas: reacciones entre jugadores con tirada enfrentada | 2 | 3 (todas con la enfrentada del servidor) |
| «¡Alto!» repetido en una detención | sí | **no** (uno por detención) |
| Turnos con rechazo del máster, perfiles y parejas | 18 %, 12 % | 18 %, 14 % |
| Tools usadas, unión de perfiles y parejas | 31 de 56 | 27 de 56 |
| Creatividad | 20 de 25 | 19 de 25 |
| Conversación: media del juez por variante (A, B, C, C2) | 3,46, 3,71, 4,20, 4,20 | 3,83, 3,94, 4,23, 3,97 |
| Misiones cumplidas en 40 acciones | 1 (metódico) | 2 (metódico, solo y en pareja) |

## Lo que han arreglado los paquetes

- **Las guardas y el prompt bajan los errores un 30 %.** De 43 a 30 por 100 acciones en perfiles y de 31 a 24 en parejas. Lo
  que más cae es la incoherencia con el contexto (a la mitad) y la inventiva mal gestionada (a la mitad). El coste de las
  guardas es nulo en reintentos: el máster acierta a la primera igual que antes.
- **La represalia del NPC es un ataque de verdad (arreglo 12).** Violento, turno 2: Atletismo 11, éxito, y Hugo responde con el
  martillo; ahora lo hace el motor, con tirada y daño («pierdes 8 puntos de golpe y te quedan 6 de 14»), y la narración lo
  recoge como hecho. Los ataques de NPC al violento pasan de 8 a 1 porque los golpes de palabra han desaparecido; los que
  quedan son reales.
- **El robo entre jugadores va con tirada enfrentada (arreglos 2, 9, 18).** Violento con pausado, turno 2: «Elmo se resiste.
  Tirada enfrentada: tu Atletismo 14, contra su Acrobacias 4: ganas tú», y la narración cuenta eso y no otra cosa. El pícaro
  intentó robarle a Brenna con Juego de manos (fallo, desventaja) y el guardia le detuvo con un solo «¡Alto! Quedas
  detenido.» (arreglo 6). En la pasada 1 el mismo robo lo contestaba el vecino sin máster (arreglo 7): ya no.
- **Los cierres de grupo llegan enteros (arreglo 8).** De 4 de 23 sin la parte de un jugador a 1 de 22.
- **El tope de racha funciona donde el NPC tiene algo que hacer (arreglo 13).** Metódico 22 → 10, rompejuegos 20 → 4, novato
  20 → 8, violento 14 → 11. Donde no (charlatán con Ilse 11 → 25, pícaro con Garrán 12 → 17), el aviso del turno 8 no basta:
  el NPC «cierra» y el jugador vuelve a preguntar.
- **El pasillo de la casona existe (arreglo 16)** y el jugador automático ya no pregunta por «undefined» (H1).
- **El informe mide mejor (H2, H6, H8):** la columna de golpes distingue maniobra de ataque («2 de 7 (+3 maniobra)» donde
  decía «0 de 14»), y la pareja que llega a las 40 acciones ya no sale como «presupuesto».

## Lo que no ha cambiado o ha empeorado

- **Cobertura de tools: 31 → 27 de 56.** Aparece `take_rest` (1 vez) y desaparecen `plant_hook`, `plant_rumor`, `request_reaction`,
  `give_coins` y `advance_story`. Las 25 que estaban a cero siguen a cero: `heal`, `stabilize`, `set_debt`, `pawn_item`,
  `settle_debt`, `harvest`, `give_quest`, `record_character_fact`, `schedule_event`, `spend_resource`… Las guardas del
  paquete A rechazan narrar «te vendas» sin `heal`, pero el máster no narra «te vendas»: no cura, no fía, no apunta. La guía
  del prompt («LO QUE SOLO PASA CON SU TOOL») no ha movido a Haiku a usarlas, y el jugador automático tampoco las provoca
  bastante (el tirador y el lanzador son los únicos perfiles mecánicos).
- **`plant_rumor` ha desaparecido** (1 → 0 en autoplay; creatividad, rumor sembrado 3 de 6 → 2 de 6). El arreglo 11 pedía
  Persuasión, Engaño o un rumor en vez de un «no» seco: Brenna sigue diciendo «Mapas de las minas no tengo. Ni los guardo ni
  los quiero en esta casa» y «Caravanas no suben a Brezal desde el incendio». Las preguntas ante lo ambiguo también bajan
  (3 de 4 → 2 de 4: «Lo hago» y «Uso eso con aquello» acaban en descripción, no en pregunta). Lo que sí sube es «en ficción»
  (3 → 4 de 4), y eso es el detector corregido (H4), no el máster.
- **El violento cae a 0 PG en el turno 1 o 2 de las dos partidas.** Antes era por golpes de palabra; ahora es por el motor, y
  en pareja Hugo le pega **dos veces en el mismo turno**: la represalia del arreglo 12 («te alcanza en el costado. Te quedan
  8 de 14») y después la ronda de combate («Dudas un instante y pierdes la ronda. Hugo se lanza contra ti antes de que
  reacciones, y el martillo te alcanza: caes al suelo»). Un herrero de nivel 1 con martillo no debería tumbar a un bárbaro
  de 14 PG en un turno. Es un hueco nuevo: la represalia y la ronda del combate no se conocen.
- **Los golpes del jugador siguen sin pasar por `attack`.** Violento solo: 0 de 3 con tirada de ataque (+1 maniobra); en
  pareja 1 de 5. El prompt ya dice «un golpe del jugador es un ataque, no `conflict_act`», pero el perfil violento declara
  sobre todo agarrones y empujones, que sí son maniobras: la métrica es ahora honesta y el número es bajo porque el
  jugador automático pega poco de verdad.
- **Las incoherencias que quedan son de movimiento y presencia:** NPC que se van «a cenar» sin transición, Brenna en la
  taberna cuando acababa de entrar en la casa de las hierbas, Hugo con un martillo que no constaba, Ilse que «se fue con las
  últimas velas». Es la mitad de los 49 hallazgos del juez en perfiles. Y los `transfer_item` fuera de alcance que el máster
  narra como hechos (dirigido 22, metódico 16, violento en pareja 15): el motor rechaza la tool, el máster narra igual.
- **El jugador automático no sabe que ha reaparecido.** El violento muere en la herrería y reaparece en el molino (reaparición
  1) y sigue hablándole a Hugo y al yunque durante 35 turnos («Agarro a Hugo por la pechera y lo estampo contra el yunque»);
  el máster lo redirige al molinero cada vez. Es del jugador, no del máster, pero ensucia la partida del violento.
- **Conversación:** A y B suben (3,46 → 3,83 y 3,71 → 3,94), C igual (4,20 → 4,23), C2 baja (4,20 → 3,97). Con 7 charlas y un
  juez de Haiku, tres décimas son ruido; lo único firme es que el actor Sonnet (C) sigue siendo el mejor en personalidad (4,7)
  y el más caro y lento (0,0106 $ y 10,7 s por turno frente a 0,0003 $ y 1,4 s de C2).

## Conclusiones

1. **Los arreglos funcionan en lo que tocan al motor:** represalias con tirada, reacciones enfrentadas, cierres de grupo,
   un solo «¡Alto!», el pasillo, el «undefined». Y bajan los errores un 30 % sin coste en reintentos. Se quedan en `main`.
2. **Lo que depende de que Haiku cambie de hábito no ha cambiado:** no usa las tools de estado que no usaba, no siembra
   rumores, cierra las conversaciones solo cuando el NPC tiene algo que hacer. Las guardas castigan la narración sin tool,
   pero el máster esquiva narrando menos (menos `transfer_item`, menos `grant_clue`, menos `npc_trust`: 24 → 14, 14 → 8,
   24 → 13). Para subir la cobertura hace falta otra palanca: perfiles del jugador automático que pidan explícitamente
   curarse, fiar, descansar, apuntar (como el tirador y el lanzador hacen con lo suyo), o guardas que exijan la tool cuando
   el jugador la pide, no solo cuando el máster la narra.
3. **Un hueco nuevo que arreglar antes de la partida a mano:** el doble golpe del NPC en el mismo turno (represalia más ronda
   de combate). Con eso el violento no llega al turno 3.
4. **La métrica de golpes ya es honesta** y dice que el jugador automático casi no pega: para medir el combate hace falta un
   perfil que ataque con el arma, no que agarre.

## Arreglos que añade esta pasada

Siguen la lista de los tres informes anteriores (1 a 18, H1 a H8):

19. **Una sola represalia por turno.** La represalia del arreglo 12 (`engine.ts`, reacción de NPC) y la ronda de combate
    («pierdes la ronda») golpean las dos en el mismo turno. Que el NPC que ya ha respondido no vuelva a actuar en la ronda, o
    que la represalia sea la ronda. Violento con pausado `20261126-0442`, turno 1; violento solo `20261126-0418`, turnos 2 y 4.
20. **Tool fallida por alcance, narrada como hecha.** `transfer_item` devuelve «a 12 m: fuera de alcance» y el máster narra
    que lo coge igual. La guarda del arreglo 5 (tool fallido narrado) debería cubrir también los fallos de alcance, o el
    motor mover al actor y repetir la tool. Dirigido 22 y metódico 16 de `20261126-0418`, violento 15 de `-0442`.
21. **Cerrar la conversación de verdad.** Cuando el contexto pide cerrar (turno 8 del arreglo 13) y el NPC «cierra» pero el
    jugador insiste, el NPC debe irse (`set_npc_order go`) o el motor devolver «X ya no te atiende» sin máster. Charlatán con
    Ilse 25 turnos, pícaro con Garrán 17.
22. **Rumor o tirada ante lo plausible, en el motor y no solo en el prompt.** Si la frase del jugador pregunta por algo que no
    está en los datos y es plausible (persona, lugar, encargo), el cierre sin `plant_rumor` ni tirada social se rechaza una
    vez. Creatividad c08 a c11 en las dos pasadas.
23. **Movimiento y presencia de NPC en la narración.** La mitad de las incoherencias que quedan: el máster mueve o quita NPC
    sin transición. Guarda: un NPC que estaba y ya no está, o que aparece donde no estaba, necesita `set_npc_order` o un
    evento del motor que lo justifique. Dirigido 22, impredecible 18, metódico 14 de `20261126-0418`.

De las herramientas:

- **H9. El jugador automático no sigue la reaparición.** Tras morir y reaparecer, su contexto sigue en la escena anterior
  (`scripts/autoplay.ts`, ficha y resumen de escena por turno).
- **H10. Perfiles que provoquen las tools a cero.** Un perfil «herido» que pide curarse y descansar, un «deudor» que fía y
  deja prendas, un «cronista» que cuenta su pasado: sin ellos la cobertura no se mueve.
  Hecho el 26-11 en `scripts/autoplay.ts`: herido, deudor, cronista y recolector, en `all`, y la pareja herido:violento
  para `stabilize`; qué tool pide cada uno, en `docs/PLAN-PRUEBAS-CREDITOS.md` («Qué se mira en cada pasada»).

## Qué sigue

Nada que lanzar hasta arreglar el 19 (doble golpe), que es corto. Después, la partida a mano de Miguel y Santi en
tavernus.com, que es la única prueba de si es jugable; y, con el arreglo 19 y los perfiles de H10, otra pasada corta con
`--baseline data/local/autoplay/20261126-0418` y `20261126-0442`.

## Tanda 5 (26-11-2026): los cuatro perfiles de H10

Sobre `main` 92f32cb, los perfiles nuevos del jugador automático (herido, deudor, cronista, recolector), 40 acciones cada
uno, Haiku bajo. `data/local/autoplay/20261126-0602`, 0,54 $ (0,0034 $ por acción). Las cuatro partidas llegaron a las 40
acciones, sin 429. Acumulado: unos 32 $ de los 200.

**Cobertura: de 27 a 36 tools de 56** sumando esta tanda a la pasada 4. De las 25 que llevaban cuatro pasadas a cero,
nueve se disparan por primera vez: `heal` (5), `record_character_fact` (5), `take_rest` (4), `take_coins` (4), `harvest`
(4), `spend_resource` (3), `settle_debt` (2), `pawn_item` (1), `use_scroll` (1). Los perfiles hacen lo que debían: cuando el
jugador lo pide con las palabras justas, Haiku llama a la tool.

**Siguen a cero aunque el jugador lo pida**, y eso ya es un dato del máster, no del jugador:

| Tool | Quién lo pidió y cuántas veces | Qué hizo el máster |
|---|---|---|
| `set_debt` | deudor, «apúntamela, te la pago mañana», 6 veces | el NPC acepta o rechaza de palabra; ninguna deuda en el estado. Es la mitad de los 11 «trato sin estado» del juez (6,9 por 100) |
| `sell_item` | deudor 6 veces (cuerda, antorchas), recolector 3 (bayas, truchas) | «no hay nadie que te la compre», o lo convierte en trueque narrado. Ningún NPC de Brezal compra |
| `lookup_rule` | herido, 7 preguntas de reglas («¿cuántos días aguanta un hombre sin comer?», «¿cuántas millas al día?») | Hugo contesta de memoria, en ficción. Correcto como voz, pero la regla no se consulta nunca |
| `complete_job`, `give_quest`, `finish_quest` | cronista: lee el tablón 4 veces, hace el agua para Ilse y la leña, pide trabajo 4 veces | `story_quest` 3 veces, pero el encargo no se registra ni se cobra: «El frasco en el brocal no sabe nada de lo que has visto. Ponlo en mi mano». El trato de vigilar el pozo a cambio de información queda de palabra |
| `schedule_event` | cronista, «mañana al alba junto al pozo» 4 veces | la cita se acepta de palabra; `get_schedule` 1 vez |
| `attune_item` | recolector, 4 veces | la capa de protección con la que empieza no aparece en su ficha a partir del turno 17 («finjo sintonizarme con una capa que no tengo»): o la soltó al «soltar» algo, o la ficha de H1 no la lista como equipada. Revisar |
| `stabilize`, `restrain_npc`, `add_condition` | nadie en solitario | la pareja herido:violento no se lanzó en esta tanda |

**Lo demás que sale:**

- **Errores por 100 acciones: 39** (más que los 30 de la pasada 4), y el reparto lo explica: «trato sin estado» sube de 1,3 a
  6,9 porque estos perfiles piden tratos todo el rato y el máster los acepta de palabra. Es la medida de lo que falta.
- **El recolector muere dos veces en el Soto** (lobos, 19 horas de juego): va al bosque de noche a recolectar. El perfil debe
  recolectar de día o cerca del pueblo. Su «Curar heridas» se tira (`cast_spell`, 1d8+2 = 10) y el juez protesta porque la
  narración dice «recuperas 10 PG, hasta 9»: la aritmética la hizo el motor, la frase el máster.
- **El deudor «esconde sus monedas» y el máster narra que roba la bolsa de la tabernera** (turno 36, tirada de éxito aplicada a
  otra cosa). Un «esconder» no puede acabar en `take_coins` de un NPC: guarda en `conflict_act` o `take_coins` (quién es el
  dueño de la bolsa).
- **El herido descansa bien:** el descanso corto cura por el motor (`take_rest`, 12 → 13 PG, «Son las 19:12») y el motor
  rechaza descansar con una amenaza delante. La poción y Tomar aliento pasan por sus tools.

**Arreglos que añade:**

24. **Fiar es `set_debt` o no es.** Guarda: un NPC que acepta «apúntamela», «te la pago mañana», «a cuenta» sin `set_debt` se
    rechaza una vez (hoy la guarda de trato sin estado solo salta una vez por partida: debería saltar por trato). Y la guía
    del prompt con el ejemplo literal del deudor.
25. **Comprar al jugador.** Brezal necesita al menos un NPC que compre (el buhonero Lucio, Brenna para comida y leña): lista de
    compra en los datos y `sell_item` con precio. Sin eso `sell_item` no se puede medir.
26. **Encargos del tablón que se cobran.** Cuando el jugador trae lo pedido y lo dice, el máster debe cerrar el encargo
    (`complete_job`) y pagar; hoy lo narra como charla. Guarda: «ya lo tienes», «aquí está lo que pediste» con un encargo
    activo y sin `complete_job`.
27. **Citas con hora.** «Mañana al alba junto al pozo» aceptado por un NPC sin `schedule_event` se rechaza una vez (es la misma
    familia que el 24).
28. **`lookup_rule` cuando el jugador pregunta por una regla** («según las reglas», «¿cuántos días…?»): guarda o guía; la voz
    del NPC puede contestar después, pero con la regla consultada.
29. **«Esconder» no es robar.** Guarda en `take_coins`: la bolsa de la que saca monedas tiene que ser del actor salvo robo
    declarado.

De las herramientas: **H11**, el recolector de día y cerca del pueblo; **H12**, comprobar por qué la capa del recolector
desaparece de la ficha (H1) a mitad de partida.
