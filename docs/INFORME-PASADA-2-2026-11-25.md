# Informe de la tanda 2 (25-11-2026): comparación de modelos y esfuerzo medio

Segunda tanda del plan `docs/PLAN-PRUEBAS-CREDITOS.md`, sin arreglos entre medias: la pregunta es si lo que salió en la
pasada 1 (`docs/INFORME-PASADA-1-2026-11-25.md`) es de Haiku a esfuerzo bajo o del prompt y el motor. Mismo jugador
automático, juez y actor (Haiku, Haiku y Sonnet) que en la pasada 1; semilla 1; Brezal. Lanzada por la sesión
orquestadora; análisis de esta sesión.

| Tanda | Dónde | Qué |
|---|---|---|
| Bench | `data/local/bench/claude-{haiku,sonnet,opus}-5-5-low-2026-11-25T1*.json` | ruta fija de 10 acciones en la taberna y la plaza, dos pasadas por modelo, mismos dados |
| Sonnet, combate | `data/local/autoplay/20261125-1206` | violento y rompejuegos, 40 acciones, `MASTER_MODEL=claude-sonnet-5-5` |
| Sonnet, pareja | `data/local/autoplay/20261125-1217` | picaro:novato, 40 acciones por jugador, Sonnet de máster |
| Haiku, esfuerzo medio | `data/local/autoplay/20261125-1231` | violento, rompejuegos, charlatán y pícaro, 40 acciones, `MASTER_EFFORT=medium` |

Los `playtest.md` de las tres tandas de autoplay llevan `--baseline` contra la pasada 1 (`20261125-1051` y `20261125-1115`):
cada casilla es «antes → ahora».

## Coste

| Qué | Plan | Real |
|---|---:|---:|
| Bench, 3 modelos × 2 pasadas | 3,00 $ | 2,22 $ (Haiku 0,04, Sonnet 0,76, Opus 1,43) más 0,04 $ de dos pasadas inválidas |
| Sonnet de máster, combate | 4,50 $ | 4,30 $ |
| Sonnet de máster, pareja | 4,50 $ | 3,33 $ |
| Haiku a esfuerzo medio | 0,60 $ | 0,59 $ |
| **Total tanda 2** | **12,60 $** | **10,49 $** |

Acumulado del día: 12,95 $ de los 200 $. Ningún 429 con Sonnet ni con Opus.

Por acción del máster: Haiku bajo 0,0027 $, Haiku medio 0,0037 $ (un 37 % más), Sonnet 0,054 $ (veinte veces Haiku), Opus
0,071 $ en el bench (unas veintiséis veces; no se lanzó en autoplay).

## Bench: los tres modelos sobre los mismos diez pasos

| | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---:|---:|---:|
| Coste por pasada | 0,018 y 0,019 $ | 0,40 y 0,36 $ | 0,77 y 0,65 $ |
| Segundos por acción | 7,2 y 7,6 | 8,3 y 8,9 | 10,5 y 10,5 |
| Tokens de salida por pasada | 16.400 y 17.500 | 11.800 y 13.700 | 11.700 y 12.400 |
| Fallos de tool | 0 | 0 | 0 |
| `buy_item` al pedir la cerveza (a01) | 0 de 2 | 2 de 2 | 2 de 2 |
| `give_quest` al aceptar el encargo (a03) | 2 de 2 | 1 de 2 | 0 de 2 |
| `use_item` al salir con la antorcha (a07) | 0 de 2 | 1 de 2 | 2 de 2 |
| Guarda el secreto de Brenna (a05) | sí | sí | sí |

Lo que se ve leyendo los diez pasos:

- **Haiku habla más y toca menos el estado.** Más tokens de salida que los otros dos y, en la primera acción, sirve la cerveza
  sin `buy_item`: el jugador bebe gratis. Es la misma falta de la pasada 1 (narrar sin tool), en miniatura y repetible.
- **Sonnet y Opus cobran la cerveza y encienden la antorcha**, pero Opus no da la misión al aceptar el encargo en ninguna de
  las dos pasadas, y Sonnet en una de dos. Ningún modelo hace todo bien: cada uno olvida una tool distinta.
- **La voz de los NPC mejora con el modelo.** Doro, el guardia nervioso: Haiku lo hace informativo («aquí no pasa nadie sin
  que yo lo sepa»); Sonnet le da el tic («Bueno, uno sí, pero era de un vecino, y eso fue ayer... no, anteayer»); Opus
  también («No por... bueno, también por curiosidad»). Brenna con la quemadura: los tres se niegan y piden algo a cambio;
  Opus con más oficio («Con fuego, como se hacen todas»).
- **Sonnet a veces se queda corto:** al comprar la antorcha contesta «Dos de cobre.» y nada más, en las dos pasadas.
- Los tres respetan los dados y ninguno inventa lugares en esta ruta corta.

## Sonnet de máster en combate y pareja

| Métrica (40 acciones) | Haiku bajo (pasada 1) | Sonnet |
|---|---|---|
| Violento: racha con un NPC | 24 | 10 |
| Violento: veces a 0 PG | 1 | 3 (muere una vez, reaparece) |
| Violento: turnos con rechazo | 28 % | 19 % |
| Violento: golpes declarados con tirada | 3 de 4 reales | 3 de 5 (los otros 2, amenazas) |
| Violento: ley | 5 incidentes, 1 arresto | 5 incidentes, 3 arrestos, 2 encierros |
| Rompejuegos: racha con un NPC | 27 | 5 |
| Rompejuegos: ataques de NPC y caídas | 5 y 2 | 0 y 0 |
| Rompejuegos: turnos con rechazo | 39 % | 18 % |
| Pareja: turnos con rechazo | 12 % | 20 % |
| Pareja: cierres compartidos sin su parte | 0 de 9 | 1 de 9 |
| Pareja: espera media | 18 s | 19,4 s (P95 37 s) |
| Tools usadas | 29 de 56 (13 partidas) | 15 de 56 (combate), 11 de 56 (pareja) |
| Errores del juez por 100 acciones | 43 | 60 (combate), 41 (pareja) |

Lo que cambia con Sonnet:

- **Varía más la escena.** Las rachas con un mismo NPC bajan de 24 y 27 a 10 y 5: mueve al jugador, mete a otros NPC, cierra
  conversaciones. Al rompejuegos le contesta con ingenio donde Haiku se bloqueaba (el mapa que no tiene: «Debió de quedarse en
  tu cabeza, que es donde peor se guardan»), y ese perfil pasa de 39 % a 18 % de turnos con rechazo.
- **Usa tools que Haiku nunca tocó:** `pawn_item` (la daga en prenda por un plato, con Persuasión 20), `request_reaction` al
  robar al compañero, `plant_rumor` tres veces, `give_coins`. Pero usa muchas menos en total (15 y 11 frente a 29): no
  consulta `get_npc`, `get_location` ni `roll_check`; narra de memoria.
- **No arregla lo estructural.** Los NPC siguen pegando sin tirada después de un éxito del jugador (turnos 7 y 45 del
  violento: Atletismo 11 y 20 natural, y Hugo o Garrán le golpean sin ataque resuelto). El fiado se concede sin `set_debt`
  (pareja, turno 17: hay `pawn_item`, no hay deuda del plato). Un robo al compañero se decide sin tirada y cambiando de
  víctima (pareja, turno 19: «Garrán no está aquí; es Ciro quien tiene la bolsita… no has sido lo bastante ligero»). El
  «pasillo» inventado en la casona sale igual (violento, turno 54).
- **Más letal con el violento:** 3 caídas y una muerte en 40 acciones, frente a 1. Garrán y Doro responden a cada amenaza con
  la maza, y Sonnet lo narra sin pedir tirada de ataque. Con 3 arrestos y 2 encierros, el violento pasa media partida en el
  calabozo gritándole a Hugo.
- **El «undefined» de la ficha llega a la narración.** En la pareja, Sonnet repite literalmente «undefined» en dos turnos (15
  y 17) y en otro lo convierte en misterio («Lo que haya en esa palabra, no lo dice la mesa»). Con Haiku se quedaba en la
  pregunta del novato; con Sonnet lo lee el jugador. Sube la prioridad del arreglo H1.
- Los 60 errores por 100 acciones del combate son sobre todo `regla_mal_aplicada` del juez (22,5 por 100), y la mayoría son
  esas represalias de NPC sin tirada: un fallo real, no ruido.

## Haiku a esfuerzo medio

| Métrica (40 acciones) | Bajo (pasada 1) | Medio |
|---|---|---|
| Turnos con rechazo, los cuatro perfiles | 18 % | 23 % |
| Violento: a 0 PG | 1 | 4 |
| Violento: racha con un NPC | 24 | 8 |
| Rompejuegos: racha, ataques de NPC, caídas | 27, 5, 2 | 13, 0, 0 |
| Charlatán: racha con Ilse | 11 | 27 |
| Pícaro: turnos con rechazo | 23 % | 30 % |
| Espera media (violento) | 12,7 s | 13,9 s |
| Tools usadas | 29 de 56 (13 partidas) | 20 de 56 (4 partidas), con `pawn_item`, `settle_debt` y `cast_spell` una vez cada una |
| Errores del juez por 100 acciones | 43 | 41 |
| Coste por acción | 0,0027 $ | 0,0037 $ |

El esfuerzo medio no compra nada medible: más rechazos, el charlatán se queda 27 turnos con Ilse, el violento cae cuatro
veces, y los errores del juez casi iguales. Lo que mejora (rachas del violento y del rompejuegos) también mejora con Sonnet,
así que parece variación entre partidas más que efecto del esfuerzo. Un 37 % más caro y un segundo más lento por acción.

## Conclusiones

1. **El problema es del prompt y del motor, no del modelo.** Las tres cosas que más pesaban en la pasada 1 (narrar sin tool,
   desenlaces que ignoran la tirada, represalias de NPC sin tirada) salen igual con Sonnet a veinte veces el coste y con Haiku
   a esfuerzo medio. Los arreglos de la lista de la pasada 1 van al prompt, a las guardas de `log_event` y a `crime.ts`, y se
   miden después con Haiku bajo.
2. **Haiku 5.5 a esfuerzo bajo sigue siendo el máster de producción.** Sonnet escribe mejor y varía más la escena, pero no
   justifica 0,054 $ por acción (10 $ por jugador y día a tope de cupo, frente a 0,54 $). Si algún día se quiere su voz,
   que sea por escena (`PROLOGUE_MODEL`, `FINAL_MODEL`, ya programado), no en todos los turnos.
3. **Opus de máster en autoplay no se lanza.** Sonnet no cambió nada que Haiku no haga; Opus, a 0,07 $ por acción, menos
   aún. Los 16 $ previstos se quedan en el crédito.
4. **Esfuerzo medio, descartado** para el máster. Queda `low`.
5. **Dos cosas de Sonnet sí valen como referencia:** cierra conversaciones y mueve la escena (las rachas de 24 y 27 turnos
   con un NPC son un fallo del prompt de Haiku, no de la campaña), y llama a `pawn_item`, `request_reaction` y
   `plant_rumor` donde Haiku no. Las guardas y la guía del prompt deberían empujar a Haiku hacia eso.

## Arreglos que añade esta tanda

Van a la misma lista de la pasada 1, para la sesión de arreglos al final:

12. **Represalias de NPC sin tirada.** Cuando el jugador gana su tirada (Atletismo, Intimidar) y el NPC responde con un golpe,
    ese golpe tiene que pasar por `attack` o `conflict_act` con su tirada, o no pasar. Sale con Haiku y con Sonnet (violento,
    turnos 7, 18, 45). `src/ai/prompt.ts`, reacción de NPC en `src/engine/engine.ts` y la guarda de `log_event` (`apply_damage`
    sin `attack` del NPC en el mismo cierre).
13. **Cerrar conversaciones y mover la escena.** Tope de turnos seguidos con el mismo NPC en el prompt (el NPC se va, cambia de
    tema o pide algo), como hace Sonnet solo. `src/ai/prompt.ts`, `src/engine/conversation.ts`.
14. **El primer trago se paga.** `buy_item` o `take_coins` cuando el jugador pide algo en la barra; Haiku lo narra gratis en
    las dos pasadas del bench. Guarda en `log_event`: «te sirve», «te pone» sin cobro.

De las herramientas:

- **H1 (sube de prioridad).** «Monedas: undefined» de `playerSheet` ya no es solo ruido del jugador automático: con Sonnet
  entra en la narración. `scripts/autoplay.ts`.
- **H5. `--model` del bench pierde contra `MASTER_MODEL`.** `scripts/model-bench.ts` escribe el modelo en la campaña, pero
  `effectiveModel` da prioridad a la variable de entorno, y dos pasadas «de Sonnet» corrieron con Haiku (están renombradas
  `INVALIDO-era-haiku-*`). El `--model` de `bench` y el `MASTER_MODEL` de `autoplay` deberían mandar sobre el entorno, o el
  script negarse a arrancar si no coinciden. Lo mismo vale para `--effort`.
- **H6. El informe no distingue amenaza de golpe** (ya era H2): con Sonnet «0 de 9», con Haiku medio «0 de 19», y a mano son 3
  de 5 y parecidos. Hasta que se arregle, la columna no sirve para comparar modelos.

## Qué sigue

Nada más que lanzar hasta la sesión de arreglos: una tercera pasada con el mismo código daría la misma foto. Después de los
arreglos, la pasada corta de la pasada 1 con `--baseline data/local/autoplay/20261125-1051` y `20261125-1115`, con Haiku bajo.
La partida a mano de Miguel y Santi sigue pendiente y no depende de nada de esto.
