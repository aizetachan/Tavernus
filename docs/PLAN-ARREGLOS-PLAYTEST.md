# Plan de arreglos tras las partidas por perfil

Sale de [PLAYTEST-2026-10-31.md](PLAYTEST-2026-10-31.md).

**Estado (31-10-2026):** las fases 0 a 4 están programadas, sin commit y sin gastar API. Las tres decisiones se tomaron
con la recomendación de abajo. Solo se han pasado tests con clientes falsos: **con un modelo real no se ha probado
nada**. Las tandas de comprobación las lanza Miguel, con los comandos del final.

## La lectura de fondo

La mayor parte de lo que frena las partidas sale de nuestras reglas, no de Haiku. Por eso se arregla antes de
comparar modelos: con estas causas, Sonnet seguiría negándose igual.

| Síntoma | Causa en el código |
|---|---|
| Negativas en bucle | El guion le dicta la frase al máster: «eso no se le cuenta a un forastero» ([talk.ts:378](../src/engine/talk.ts)). No hay paso que diga qué abriría esa puerta |
| El bardo no tira | El guion «manda sobre las reglas generales» ([talk.ts:442](../src/engine/talk.ts)) y solo comercio menciona una tirada. La regla general de tirar queda anulada en cada charla |
| El jugador no llega a atacar | La regla existe ([prompt.ts:94](../src/ai/prompt.ts)), pero nada la comprueba. El violento casi solo amenaza; de los 24 golpes declarados de verdad en toda la tanda, 11 acabaron en ataque |
| Las «botas» eternas | El «Primer instante» va dentro de la historia del PJ ([worldgen/index.ts:340](../src/worldgen/index.ts)) y el máster lo recibe en cada turno ([prompt.ts:431](../src/ai/prompt.ts)) |
| Reaparecer con quien te mató | Solo hay un punto de reaparición ([death.ts:55](../src/engine/death.ts)) y en Brezal es la casa de Ilse |
| No se sabe qué mover | La confianza decide qué se cuenta, pero no he encontrado que se enseñe en la web ni en el Diario; el máster solo la usa por dentro |
| Reintentos por hablar de más | Se rechaza con solo 10 palabras de margen ([talk.ts:500](../src/engine/talk.ts)). El exceso típico es de 18: con margen 25, los rechazos bajan de 183 a 42 |

Lo que no se sostiene de la tanda y no entra en el plan: la repetición de la frase anterior (9 de 2.840), las
contradicciones de nombres (las inventó el jugador automático) y la cifra de 35 errores por 100 acciones.

## Fases

Tamaño: **S** unas horas, **M** un día, **L** varios días. Orden pensado para que cada fase se pueda probar sola.

### Fase 0. Arreglos rápidos

Sin decisiones pendientes. Se comprueban con tests y repasando los registros de la tanda, sin API.

| Arreglo | Dónde | Tamaño | Comprobación |
|---|---|---|---|
| «Me detengo junto a…» y «Me despido de…» pasan al máster salvo que sea la orden sola o haya algo que parar | [engine.ts:3262](../src/engine/engine.ts), [scene.ts:117](../src/engine/scene.ts) | S | Test con las 6 frases reales |
| Margen de 25 palabras antes de rechazar por hablar de más | [talk.ts:500](../src/engine/talk.ts) | S | De 183 rechazos a 42 sobre lo ya jugado |
| El detector de tratos deja pasar negativas y frases generales («lo fiado ya me pesa», «deja algo en prenda») | [closecheck.ts:38](../src/engine/closecheck.ts) | S | Test con ambas; sigue saltando con un trato real |
| El «Primer instante» solo llega al máster en la apertura | [prompt.ts:431](../src/ai/prompt.ts) | S | Test del contexto en el turno 1 y el 2 |
| Cada opción de trasfondo se ofrece una vez por charla, no en cada turno | [worldrules.ts:696](../src/engine/worldrules.ts) | S | Test: el «[Noble]…» que salía 25 veces |

### Fase 1. Charlas con salida

Lo que más pesa. Reglas generales, sin nada de Brezal en el código.

| Arreglo | Dónde | Tamaño |
|---|---|---|
| El motor cuenta cuántas veces seguidas se ha negado este NPC en esta charla | [talk.ts](../src/engine/talk.ts), `talkState` | S |
| Quitar la frase dictada. Negarse pasa a llevar una salida, por este orden: lo que el jugador tiene en curso con él, un encargo que pueda darle, otra persona que sepa algo o «sé lo que quiere y no se lo das gratis». Nunca el secreto | [talk.ts:376](../src/engine/talk.ts), datos `sources` y `refusal` de las pistas | M |
| A la segunda negativa, el NPC cierra el tema y lo deja claro. A la tercera, corta la charla y las sugeridas dejan de ofrecer lo mismo | [talk.ts](../src/engine/talk.ts), cierre en `talkProblems` | M |
| Rechazar la negativa sin salida al cerrar el turno, como ya se hace con lo público | [talk.ts:494](../src/engine/talk.ts) | S |

**Comprobación:** tests por situación y una tanda corta junto con la fase 2.

### Fase 2. Convencer como mecánica

| Arreglo | Dónde | Tamaño |
|---|---|---|
| Señal de que el jugador argumenta, promete, engaña o presiona, y paso de tirada en el guion, una vez por tema | [talk.ts:64](../src/engine/talk.ts), `steps` | M |
| Resultado: éxito sube confianza (`social_roll` ya existe) y da lo acordado en la decisión 1; fallo cuenta como insistir | [trust.ts](../src/engine/trust.ts), [talk.ts](../src/engine/talk.ts) | S |
| Enseñar el trato con cada NPC en la web («Ilse: te mira con recelo»), en palabras y sin números | Web y Diario | M |

**Tanda de comprobación tras las fases 1 y 2:** charlatán, novato y rápido, 60 acciones cada uno. **Unos 0,55 $**, sin
jueces (las métricas son gratis).

### Fase 3. Combate y consecuencias

| Arreglo | Dónde | Tamaño |
|---|---|---|
| Si el jugador declara un golpe, el cierre exige tirada de ataque o una razón (fuera de alcance, sin arma) | [closecheck.ts](../src/engine/closecheck.ts), [tools.ts](../src/ai/tools.ts) | M |
| Varios puntos de reaparición: se usa el primero sin nadie hostil. En Brezal, un segundo sitio | [death.ts:55](../src/engine/death.ts), datos de Brezal | S |
| Según la decisión 2: quien no es de pelear deja de atacar a un caído, llama a la guardia o echa al jugador | Datos de NPC y turno de hostiles | M |
| Detector de pagos: narrar que se entregan monedas sin mover ninguna se rechaza, y el máster usa `settle_debt` o lo niega en la ficción | [closecheck.ts](../src/engine/closecheck.ts) | S |

**Tanda de comprobación:** violento y rompejuegos, 60 acciones cada uno. **Unos 0,36 $.**

### Fase 4. Llegar a los finales

Hoy no sabemos si funcionan, y lo único que los cubre es `test/brezal.test.ts`, que no pasa por el máster.

| Arreglo | Dónde | Tamaño |
|---|---|---|
| Perfil «dirigido»: sigue el Diario y deja a un NPC tras dos negativas. Separa lo que es del juego de lo que es del jugador automático | [autoplay.ts](../scripts/autoplay.ts) | S |
| Empezar una partida ya en el acto II o III, con el estado que deja el camino de `test/brezal.test.ts` | [autoplay.ts](../scripts/autoplay.ts) | M |
| El epílogo por tiempo recoge lo jugado y deja claro que la historia queda abierta | [story.ts](../src/data/campaigns/brezal/story.ts), motor | M |

**Tanda de comprobación:** 3 finales desde el acto III, 60 acciones cada uno, y un dirigido de 150 desde el principio.
**Unos 1 $.**

### Después

Con todo esto en su sitio, una comparación corta de Haiku y Sonnet sobre el mismo recorrido, para cerrar PLAN §8. Se
presupuesta entonces.

## Métricas

Se comparan con las primeras 60 acciones de la tanda del 31-10, que ya están medidas. Con tan pocas partidas sirven
para ver la dirección, no para afinar.

| Métrica (en 60 acciones) | Perfil | Hoy | Objetivo |
|---|---|---:|---:|
| Mayor racha de turnos con el mismo NPC | charlatán | 54 | 15 o menos |
| Negativas literales | charlatán | 15 | 5 o menos |
| Tiradas sociales | charlatán | 0 | 3 o más |
| Misiones cumplidas | novato | 0 | 1 o más |
| Golpes declarados que acaban en ataque o con una razón (`declaredStrike`) | toda la tanda | 17 de 24 | 22 de 24 o más |
| Veces a 0 PG | violento | 10 | 5 o menos |
| Turnos con rechazo del máster | todos (tanda entera) | 23 % | 12 % o menos |
| Finales que se pueden completar | desde el acto III | sin probar | 3 de 3 |

Falta medir a personas: ninguna de estas tandas dice si es divertido, solo que deja de estorbar. Antes de la beta
hace falta al menos una partida jugada por alguien real.

## Decisiones pendientes

1. **¿Qué da una tirada social con éxito?** Hoy está escrito que no salta niveles de confianza. *Recomiendo* mantenerlo:
   sube confianza y da una pista del camino (a quién ver, qué le haría hablar), no el secreto. Abrir el secreto con un
   dado acortaría la trama, y las misiones dejarían de importar.
2. **¿Puede cualquier NPC pelear hasta matarte?** Ilse, la curandera, mató 10 veces en dos partidas. *Recomiendo* que
   los NPC no combatientes no rematen: echan, llaman a la guardia o se defienden hasta dejarte caído. Atacar al pueblo
   sigue saliendo caro con la ley, y la curandera no se convierte en el jefe final.
3. **¿Cuánto debe durar Brezal?** El mejor perfil cumplió 4 misiones en 300 acciones y los finales piden nivel 3 y
   el acto II. Eso apunta a más de 900 acciones. *Recomiendo* no tocar la duración hasta ver al jugador dirigido de la
   fase 4: hoy no sabemos si es larga o si se atasca.

## Riesgos y coordinación

- El trabajo de «para quien no está no pasa el tiempo» (rama `claude/tiempo-parado-desconectado-003cfe`) está sin
  commit y toca el motor. Conviene fusionarlo antes de la fase 3, que toca muerte y reaparición.
- Más tiradas y menos reintentos se compensan en coste, pero hay que volver a medirlo en cada tanda. El techo es 1 o 2
  céntimos por acción.
- Más reglas de cierre pueden traer más reintentos. Cada regla nueva lleva test con frases reales, y si un rechazo
  supera el 5 % de los turnos se revisa.
- Las fases 1 y 2 cambian cómo suenan todas las charlas, también en mundos generados. Los tests de
  `docs/CONVERSACION-REGLAS.md` tienen que seguir en verde.

## Lo que hay que mirar al probarlo

- **Negativas sin salida:** 154 de las 2.149 líneas de NPC de la tanda lo eran. El nuevo control se reescribe una vez,
  así que puede sumar reintentos si el modelo no hace caso al guion.
- **`give_coins`:** tool nuevo que no estaba en el plan, para propinas y sobornos. Sin él, el detector de pagos
  obligaría a negarlos.
- **Golpes:** el detector rechaza una vez y a la segunda deja pasar. «Le suelto un tajo a las botas» es un caso dudoso.
- **Tratos:** de los 7 rechazos que quedan hay falsos positivos, como «queda anotado solo» al explicar el Diario.
- **Reaparición:** también descarta un sitio si quien vive allí está receloso, más estricto que lo planeado.
- **Echar o llamar a la guardia:** el motor impide matar a los no combatientes, pero echar y avisar se lo indica al
  máster; no lo hace el motor.

## Comandos de las tandas

Coste calculado a 0,29 céntimos por acción, máster y jugador; son estimaciones. `--no-judge` evita el juez. Desde el
worktree y con la API de verdad:

Tanda 1, fases 1 y 2, unos 0,53 $:

```bash
MASTER_MODEL=claude-haiku-5-5 MASTER_EFFORT=low PLAYER_MODEL=claude-haiku-5-5 node --env-file=D:/MyProjects/tavernus/.env --import tsx scripts/autoplay.ts --profiles charlatan,novato,rapido --actions 60 --parallel 3 --seed 21 --max-usd-game 0.3 --no-judge --live --out D:/MyProjects/tavernus/data/local/autoplay --games-dir D:/MyProjects/tavernus/data/local/autoplay/playtest-games
```

Tanda 2, fase 3, unos 0,35 $:

```bash
MASTER_MODEL=claude-haiku-5-5 MASTER_EFFORT=low PLAYER_MODEL=claude-haiku-5-5 node --env-file=D:/MyProjects/tavernus/.env --import tsx scripts/autoplay.ts --profiles violento,rompejuegos --actions 60 --parallel 2 --seed 21 --max-usd-game 0.3 --no-judge --live --out D:/MyProjects/tavernus/data/local/autoplay --games-dir D:/MyProjects/tavernus/data/local/autoplay/playtest-games
```

Tanda 3, los tres finales desde el acto III, unos 0,53 $:

```bash
MASTER_MODEL=claude-haiku-5-5 MASTER_EFFORT=low PLAYER_MODEL=claude-haiku-5-5 node --env-file=D:/MyProjects/tavernus/.env --import tsx scripts/autoplay.ts --profiles dirigido-templar,dirigido-verdad,dirigido-arder --start-act 3 --actions 60 --parallel 3 --seed 21 --max-usd-game 0.3 --no-judge --live --out D:/MyProjects/tavernus/data/local/autoplay --games-dir D:/MyProjects/tavernus/data/local/autoplay/playtest-games
```

Tanda 3, jugador dirigido desde el principio, unos 0,44 $:

```bash
MASTER_MODEL=claude-haiku-5-5 MASTER_EFFORT=low PLAYER_MODEL=claude-haiku-5-5 node --env-file=D:/MyProjects/tavernus/.env --import tsx scripts/autoplay.ts --profiles dirigido --actions 150 --seed 21 --max-usd-game 0.6 --no-judge --live --out D:/MyProjects/tavernus/data/local/autoplay --games-dir D:/MyProjects/tavernus/data/local/autoplay/playtest-games
```

Comparar cada tanda con la de referencia, gratis:

```bash
ANTHROPIC_API_KEY= node --import tsx scripts/playtest-report.ts --run D:/MyProjects/tavernus/data/local/autoplay/<fecha> --window 60 --baseline D:/MyProjects/tavernus/data/local/autoplay/20261031-1020
```

Total de las cuatro: **unos 1,85 $**. `--profiles all` ahora juega 11 partidas, con `dirigido`.
