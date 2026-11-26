# Informe de la tanda 3 (25-11-2026): Opus 5.5 de máster en combate y pareja

Tercera tanda del plan `docs/PLAN-PRUEBAS-CREDITOS.md`, la opcional: Opus 5.5 de máster en las mismas partidas que corrió
Sonnet en la tanda 2 (`docs/INFORME-PASADA-2-2026-11-25.md`), sin arreglos entre medias. Cierra la comparación de modelos:
Haiku (pasada 1), Sonnet (tanda 2) y Opus (esta) sobre violento, rompejuegos y la pareja picaro:novato, 40 acciones por
jugador, mismo jugador automático, juez y actor (Haiku, Haiku y Sonnet), semilla 1, Brezal. Lanzada por la sesión
orquestadora; análisis de esta sesión.

| Tanda | Dónde | Qué |
|---|---|---|
| Opus, combate (cortada) | `data/local/autoplay/20261125-1557` | violento 18 acciones y rompejuegos 22: la API cortó por el límite de gasto de la organización (ver Coste). No cuenta para el análisis |
| Opus, combate | `data/local/autoplay/20261125-1652` | violento y rompejuegos, 40 acciones, `MASTER_MODEL=claude-opus-5-5` |
| Opus, pareja | `data/local/autoplay/20261125-1703` | picaro:novato, 40 acciones por jugador, Opus de máster |

Los `playtest.md` llevan `--baseline` contra las tandas de Sonnet (`20261125-1206` y `20261125-1217`): cada casilla es
«Sonnet → Opus». Los de Sonnet, a su vez, comparan con Haiku, así que las tres columnas de abajo salen de ahí.

## Coste

| Qué | Plan | Real |
|---|---:|---:|
| Opus, combate cortada por el límite | — | 3 a 4 $ estimados (`summary.json` marca 0: solo cuenta partidas acabadas) |
| Opus, combate | 8,00 $ | 7,43 $ |
| Opus, pareja | 8,00 $ | 5,16 $ |
| **Total tanda 3** | **16,00 $** | **12,59 $ más los 3 a 4 $ de la cortada** |

Acumulado del día: unos 29 $ de los 200 $ (12,95 $ de las tandas 1 y 2, 12,59 $ de esta y la cortada). Ningún 429.

**El corte no fue el crédito.** A mitad del primer combate la API devolvió `400 You have reached your specified API usage
limits. You will regain access on 2026-12-01`: la organización había llegado al límite de gasto mensual fijado en la
Console. Miguel lo subió y la tanda se relanzó entera. Si tavernus.com usa la misma organización, estuvo sin API ese rato.

Por acción del máster: Opus 0,093 $ en combate y 0,064 $ en pareja (media 0,079 $). Sonnet costó 0,054 y 0,042 $; Haiku bajo
0,0027 $. Opus es **una vez y media Sonnet y treinta veces Haiku**, y además escribe más largo: 110 a 130 palabras por
respuesta en la pareja (Sonnet 104, Haiku unas 90), con cuatro cierres por encima del tope de 140.

Espera media por acción: combate 12,9 s (Sonnet 13,5; Haiku 13,9), pareja **22,9 s con P95 de 40 s** (Sonnet 19,4 y 37 s;
Haiku 18 s). En pareja, Opus es la espera más larga de las tres tandas.

## Los tres modelos sobre las mismas partidas

| Métrica (40 acciones) | Haiku bajo | Sonnet | Opus |
|---|---|---|---|
| Violento: racha con un NPC | 24 | 10 | 6 |
| Violento: veces a 0 PG | 1 | 3 (muere una vez) | 1 |
| Violento: ataques de NPC | 8 | 8 | 6 |
| Violento: turnos con rechazo | 28 % | 19 % | 20 % |
| Violento: ley | 5 incidentes, 1 arresto | 5, 3 arrestos, 2 encierros | 3, 2 arrestos, 1 encierro |
| Rompejuegos: racha con un NPC | 27 | 5 | 10 |
| Rompejuegos: ataques de NPC y caídas | 5 y 2 | 0 y 0 | 0 y 0 |
| Rompejuegos: turnos con rechazo | 39 % | 18 % | 26 % |
| Combate: pasos y pistas (las dos partidas) | 2 y 1 | 2 y 2 | 0 y 0 |
| Pareja: turnos con rechazo | 12 % | 20 % | 17 % |
| Pareja: cierres compartidos sin su parte | 0 de 9 | 1 de 9 | 1 de 12 (y 1 sin lo común) |
| Pareja: espera media | 18 s | 19,4 s | 22,9 s |
| Tools usadas (combate, pareja) | 29 de 56 en 13 partidas | 15 y 11 | 16 y 11 |
| Errores por 100 acciones (combate) | 56 | 60 | 45 |
| Errores por 100 acciones (pareja) | 43 | 41 | 31 |
| Misiones cumplidas | 0 | 0 | 0 |

Los errores por 100 suman detectores deterministas y juez (Haiku). Opus baja la cuenta, sobre todo en el rompejuegos (11
errores del juez frente a 19 de Sonnet y 17 de Haiku), pero el reparto es el mismo: incoherencia con el contexto (20 por 100
en combate, 13,8 en pareja) y regla mal aplicada (11,3 en combate).

## Lo que Opus hace distinto

- **Resuelve el robo entre jugadores con una tirada enfrentada.** Pareja, turno 38: Bruno mete la mano en la bolsa de Ciro y
  Ciro se resiste; «Juego de manos d20 [18] + 2 = 20, contra su Juego de manos d20 [12] + 5 = 17: ganas tú». Es el único de
  los tres que lo hace: Haiku decidía sin tirada y Sonnet cambiaba de víctima (tanda 2, turno 19). Es la referencia para el
  prompt de Haiku.
- **Lleva la deuda al estado.** `set_debt` dos veces y `settle_debt` cuatro en la pareja, `roll_check` seis veces (Sonnet no lo
  tocó), más `request_reaction` y `discover_spot`. En combate estrena `report_incident`, `take_rest` y `use_item`. Sigue sin
  `give_quest` ni `buy_item`, como en el bench de la tanda 2.
- **Acorta las rachas del violento** (6 turnos con un NPC) y lo mantiene vivo: una caída frente a las tres de Sonnet, con menos
  arrestos. Al rompejuegos le contesta con ingenio y sin bloquearse («De gremios y torres no sé nada, hija. Aquí no ha subido
  nunca nadie de fuera con preguntas tan grandes»), aunque le deja una racha de 22 turnos con Ilse.
- **Escribe mejor y más largo**, y eso se paga: narraciones de 150 palabras, cuatro por encima del tope, y la espera más alta
  de las tres tandas en la pareja.

## Lo que no cambia con Opus

- **Represalias sin tirada.** Violento, turno 3: Atletismo 11, éxito, y Hugo le mete el martillo en las costillas (14 → 11 PG)
  sin `attack` ni `conflict_act`. Igual que Haiku y Sonnet (arreglo 12).
- **Ningún golpe del jugador pasa por `attack`** en 40 acciones del violento (0 de 13 verbos de ataque; los 6 `attack` son de
  NPC). La columna sigue sin distinguir amenaza de golpe (H6), pero leído a mano el patrón es el mismo: el máster narra el
  empujón o el agarrón y tira Atletismo, nunca ataque.
- **Nada de misiones.** 0 pasos y 0 pistas en combate (Sonnet sacó 2 y 2), 0 en pareja. En 160 acciones de Opus no avanza
  ninguna misión. El problema es de la campaña y del prompt, no del modelo.
- **El «undefined» de la ficha llega a la narración.** Pareja, turno 3 del novato: la respuesta del máster empieza con
  «undefined» entre comillas. Tercera tanda seguida (H1).
- **El estado no cuadra con lo narrado.** Pareja, turno 5: Garrán se queda «el oro y la plata» de Bruno y `settle_debt`
  registra 150 monedas a Garrán; antes, un `settle_debt` a Osric Malvez, que no estaba, rechazado. Incoherencias del juez a
  13,8 por 100, con el jugador que dice quedarse en la mesa y aparece en la barra (turno 4), o en la reja del calabozo sin
  haberse movido (turno 9).
- **El novato pasa el 25 % de los turnos sin máster** (respuestas del motor: «¿Con quién?», «No tienes ninguna tirada
  pendiente.»), lo mismo que con Sonnet.

## Hallazgos nuevos de esta tanda

- **Desarmar cuenta como robo.** Violento, turno 4: Bruno le quita el martillo a Hugo en plena pelea (Atletismo 12, éxito) y el
  motor le cuelga la etiqueta «ladrón», «le vieron robarle a Hugo» y «desde ahora te buscan». Un `transfer_item` desde un NPC
  en un conflicto abierto no es un hurto. `src/engine/crime.ts`.
- **«El pasillo» del calabozo no existe.** Seis `log_event` rechazados en el violento y uno en la pareja por citar «el
  pasillo» desde la celda de la casona; el máster reescribe y cuela, pero cada rechazo es una llamada más (con Opus, 0,09 $
  cada una). Con Sonnet salió igual (tanda 2, turno 54). Es un hueco de los datos de Brezal: la celda necesita un punto o un
  alias para el pasillo de la despensa.
- **El tope por partida en pareja se reparte entre los dos.** `--max-usd-game 5` cortó la pareja justo al llegar a las 40
  acciones (5,15 $ entre los dos jugadores) y `playtest.md` marca «Fin: presupuesto» aunque se jugaron las 40. Documentarlo o
  contar el tope por jugador.

## Conclusiones

1. **La comparación de modelos queda cerrada y la decisión no cambia: Haiku 5.5 a esfuerzo bajo sigue de máster.** Opus baja
   los errores por 100 (45 frente a 56 y 60) y escribe mejor, pero no toca ninguno de los fallos estructurales: represalias
   sin tirada, golpes que no son ataques, misiones a cero, estado que no cuadra con lo narrado, «undefined» en la narración.
   A 0,079 $ por acción (treinta veces Haiku) y con la peor espera en pareja, no vale ni por escena.
2. **Dos comportamientos de Opus pasan al prompt de Haiku como referencia:** la tirada enfrentada cuando un jugador le roba a
   otro, y `set_debt` cuando se fía o se aplaza una deuda. Se suman a los dos de Sonnet (cerrar conversaciones, mover la
   escena).
3. **Los arreglos siguen siendo los mismos** y se miden con Haiku bajo. Con tres modelos dando la misma foto, no hay más que
   aprender lanzando sin arreglar.

## Arreglos que añade esta tanda

Siguen la lista de las pasadas 1 y 2:

15. **Desarmar o quitar un objeto en un conflicto abierto no es robo.** Sin etiqueta «ladrón» ni «te buscan» cuando el
    `transfer_item` viene de un `conflict_act` o `attack` del mismo cierre contra ese NPC. `src/engine/crime.ts`.
16. **Punto «pasillo» en la casona.** La celda de la casona del regidor necesita el pasillo de la despensa como punto o como
    alias aceptado por la guarda de `log_event`. Datos de Brezal (`data/campaigns/brezal`, localización de la casona).
17. **`settle_debt` y `set_debt` cuadrados con lo narrado.** Guarda: el acreedor presente (ya se rechaza), y la cantidad igual
    a lo que se entrega (monedas o `transfer_item` en el mismo cierre); si no, se rechaza con el motivo. `src/ai/tools.ts`.
18. **Robo entre jugadores con tirada enfrentada** (Juego de manos contra Juego de manos o Percepción), y `request_reaction` a
    la víctima antes de resolver, como hizo Opus. `src/ai/prompt.ts`, `src/engine/conflict.ts`.

De las herramientas:

- **H7. `autoplay` no suma el coste de las partidas que no acaban.** La tanda cortada marca 0 $ con unas 40 acciones de Opus
  jugadas. Guardar acciones y coste parciales en `summary.json`. `scripts/autoplay.ts`.
- **H8. `--max-usd-game` en pareja.** Decidir si el tope es por jugador o por partida y que `playtest.md` no marque
  «presupuesto» cuando se han jugado todas las acciones.
- **H1** sigue abierto y sube otra vez: «undefined» en la narración con los tres modelos.

## Qué sigue

Nada que lanzar hasta la sesión de arreglos (lista 1 a 18 y H1 a H8 de los tres informes). Después, la pasada corta con
Haiku bajo, con `--baseline data/local/autoplay/20261125-1051` y `20261125-1115`. La partida a mano de Miguel y Santi sigue
pendiente.
