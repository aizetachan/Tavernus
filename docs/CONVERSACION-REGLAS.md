# Cómo responde un NPC: reglas por situación (propuesta)

Estado: **primera versión implementada** (`src/engine/talk.ts`; ver «Qué hay en la v1» al final). Sustituye a la idea
del actor (una segunda IA que reescribe la voz, ver CONVERSACION.md), que queda apagada en producción
(`ACTOR_MODEL=off`).

La idea: antes de llamar a la IA, el **motor** decide en qué situación está la charla y qué tiene que hacer el NPC
en este turno, con reglas fijas. La IA (el máster de siempre, Haiku) solo pone las palabras siguiendo un guion corto
y concreto, y un control al cierre comprueba que lo ha cumplido. Todo sale del estado y de los datos: el motor no
sabe de ninguna campaña.

```
frase del jugador ─┐
estado del mundo ──┼─► 1. señales ─► 2. situación (prioridad) ─► 3. guion del turno ─► IA ─► 4. control ─► chat
datos del NPC ─────┘                        ▲ trato y reputación modulan 3 y 4
```

## 1. Señales

Cada turno de charla el motor calcula estas señales. Las de **estado** son fiables (salen de datos); las de
**texto** son heurísticas en castellano, como las de `fastpath.ts`, y pueden fallar: por eso valen como pista y el
máster puede corregirlas (ver «Preguntas abiertas»).

| Señal | De dónde sale | Fuente |
|---|---|---|
| Primer encuentro | sin memorias del NPC sobre el PJ y sin transcripción | estado |
| Vuelve tras tiempo | última charla hace más de N horas de juego | estado |
| Se conocen de nombre | el PJ está en `knows` del NPC / el NPC en `pc.knows` | estado |
| Trato | `talkTier`: hostil, receloso, extraño, conocido, amigo, aliado | estado |
| Opinión / reputación | `opinionOf`, etiquetas del PJ y `tag_reactions` del NPC | estado |
| Lo vio hacer algo | evento del PJ en el sitio en los últimos minutos que el NPC percibió (ataque, robo, regalo, ayuda, crimen) | estado |
| Crimen que conoce | `npcCrimeLine` («LO PRIMERO») | estado |
| Ocupado | actividad de su horario en curso, o atendiendo a otro | estado |
| Misión que puede dar | misión de la historia disponible para el PJ cuyo dador es él; encargo suyo en el tablón | estado |
| Misión en curso suya | el PJ tiene activa una misión o encargo que dio él o los suyos | estado |
| Trae lo que pidió | el PJ lleva el objeto de entrega / cumple el paso | estado |
| Deuda | `openDebts` con él | estado |
| Ya se negó a esto | lo mismo preguntado y negado en la transcripción reciente | estado + texto |
| Saludo / despedida | «hola», «buenas», «adiós», «me voy»… | texto |
| Pregunta | «¿…?», interrogativos (qué, quién, dónde, cuándo, por qué, cómo, sabes…) | texto |
| Pide algo | comprar, vender, «me das», «necesito», «ayúdame» | texto |
| Ofrece algo | regalo, ayuda, pago | texto (+ `transfer_item`) |
| Tono hostil | amenaza, insulto, burla | texto |
| Halago | | texto |
| Tema de lore | la frase nombra un lugar, persona, suceso o costumbre de los datos (`locations`, NPC, rumores, `CUSTOMS`, pistas) | texto contra datos |

## 2. Situación del turno: una principal, por prioridad

El NPC atiende primero lo más urgente. La primera regla que se cumple es la situación principal; como mucho una
secundaria (la siguiente que se cumpla) entra si cabe.

1. **Peligro o crimen**: le acaban de atacar, ve un arma, sabe que el PJ ha matado o robado.
2. **Reacción a lo que acaba de hacer el PJ**: regalo, ayuda, robo pillado, empujón.
3. **Trato hostil o receloso**: corta o contesta lo mínimo.
4. **Entrega o misión en curso**: trae lo pedido, viene a cobrar, o el NPC quiere saber cómo va.
5. **Lo que pide el jugador**: pregunta (lore o no), compra/venta, petición.
6. **Saludo** (primer encuentro o reencuentro).
7. **Despedida**.
8. **Charla sin más**: el NPC saca un tema suyo.

## 3. Guion por situación

Cada situación da al máster **pasos en orden** (lo que debe hacer el NPC), **prohibido** (lo que no puede hacer) y
**longitud**. El trato cambia los pasos; la reputación y las etiquetas cambian el tono de la primera frase.

### Saludo, primer encuentro
- Pasos: 1) devuelve el saludo según su carácter; 2) se presenta si su oficio lo pide (quien atiende un negocio) o si
  es amable, si no, no; 3) pregunta quién es o qué le trae.
- Prohibido: encargos, lore, secretos, su vida entera.
- Longitud: 1–2 frases.
- Por reputación: si le precede una etiqueta (asesino, forastero de Vharn), la primera frase reacciona a eso.

### Saludo, ya se conocen
- Extraño: como el primer encuentro, sin presentarse otra vez.
- Conocido: le saluda (por su nombre si lo sabe) y recuerda lo último que hablaron (memoria más reciente).
- Amigo/aliado: lo anterior y saca él un tema: cómo va lo suyo (misión en curso) o lo que le ronda hoy.
- Si vuelve tras días: lo nota («cuánto tiempo»).
- Longitud: 1–3 frases.

### Pregunta directa (no lore)
- Paso 1, siempre en la primera frase: contesta (sí / no / no lo sé / eso no te lo digo).
- Si lo sabe y el trato lo permite: lo cuenta, con su opinión.
- Si lo sabe y el trato no lo permite: extraño, lo esquiva; conocido, pide un motivo o algo a cambio; amigo, lo
  cuenta a medias si no es lo que le toca contar.
- Si no lo sabe: lo dice y, si alguien de los datos lo sabe, dice a quién preguntar.
- Prohibido: inventar hechos, contestar otra cosa, dejar la pregunta sin respuesta.
- Longitud: 1–3 frases.

### Pregunta de lore (historia, lugares, costumbres)
- Pasos: 1) lo que sabe todo el mundo (datos públicos del tema); 2) su opinión o su miedo; 3) lo delicado, solo con el
  trato que lo permite (lo que devuelve `npcKnowledge`).
- Prohibido: recitar; contar lo que el trato no da; inventar.
- Longitud: 2–4 frases.

### Misión que puede dar
- Solo si está disponible para el PJ y la charla viene a cuento (le pregunta qué pasa, se ofrece, o es amigo).
- Pasos: 1) el problema, como lo cuenta él (qué le pasa, qué se juega); 2) por qué no va él; 3) la recompensa si la
  hay. Se registra en el mismo turno.
- Prohibido: listar condiciones, decir «¿aceptas?», abrir una que no está disponible.

### Misión en curso / entrega
- Trae lo pedido: lo reconoce, cierra la entrega (tool), agradece según trato.
- No lo trae: pregunta cómo va; si es amigo, se preocupa; si hay prisa en los datos, apremia.

### Comercio
- Paso 1: el precio exacto (`priceFor`, ya ajustado por opinión). Regateo solo con tirada.
- Prohibido: dar por cerrado un trato sin la tool.

### Reacción a una acción del jugador
- Paso 1, en la primera frase: la reacción (agradece, se ofende, se asusta, llama a la guardia).
- Luego, si queda, lo que pidiera el jugador.
- Mueve la confianza u opinión que toque (tool).

### Trato hostil o receloso
- Hostil: corto, frío o amenazante; puede cortar la charla o echarle.
- Receloso: lo mínimo; pregunta qué quiere y por qué.
- Prohibido: lo delicado.

### Insiste en algo que ya negó
- Segunda vez: se cierra con más firmeza. Tercera: corta la charla y baja la confianza (hostigar).

### Despedida
- 1 frase. Puede dejar un recordatorio (deuda, encargo pendiente) si lo tiene.

### Charla sin más
- Saca **un** tema suyo de lo que le ronda (`npcConcerns`), el primero por prioridad: su agenda, lo que ha visto, su
  gente, rumores.

### Ocupado (modificador de cualquiera)
- Lo dice y atiende a medias o le pide que espere, salvo peligro.

## 4. Control al cierre

Lo que se puede comprobar sin IA se comprueba, y si falla se pide otra vez al máster con el motivo (como hoy hace
`closecheck.ts`):

- Pregunta → hay al menos una línea del NPC.
- Primer encuentro de un extraño → no nombra títulos de misiones ni lo que calla.
- Misión no disponible → no aparece su título.
- Comercio → el precio dicho es el de `priceFor`.
- Longitud según el guion.
- Se mantienen los de hoy: frases repetidas, tratos sin tool, promesas de moverse, secretos, nombres desconocidos.

## Preguntas abiertas

1. **Quién decide la situación cuando el texto es ambiguo.** Propuesta: el motor decide con señales; si las de texto
   no son claras, el máster declara la situación en `log_event` (`talk_situation`) y el control comprueba que encaje
   con el estado (no puede declarar «entrega» si no lleva nada).
2. **Plantillas sin IA** para lo más mecánico (saludo de un extraño, despedida, «no lo sé»): más barato y rápido,
   pero menos vivo. Propuesta: no al principio; sí en modo offline.
3. **Datos por NPC**: si algún NPC necesita romper la regla general (quien no se presenta nunca, quien habla de
   lore con cualquiera), un campo opcional en sus datos. Propuesta: solo cuando aparezca el caso.
4. **Qué entra en la primera versión**: propuesta, las señales de estado, la prioridad, los guiones de saludo,
   pregunta, lore, misión, reacción y despedida, y los controles de pregunta, misión y longitud.

## Qué hay en la v1

- **Motor** (`src/engine/talk.ts`): `textSignals` (señales del texto), `talkState` (del estado), `loreTopics` (lugares,
  gente, rumores y facciones de los datos que nombra el jugador, con lo público de cada uno), `situationsFor`
  (prioridad), `talkPlan` (situación principal, secundaria y si es dudosa), `talkScript` (el bloque del contexto) y
  `talkProblems` (el control al cierre).
- **A quién habla** (`talkTarget`): el NPC que nombra, con quien ya habla o, si suena a charla (comillas, saludo,
  pregunta, verbo de habla), el único NPC en su punto. Los NPC mudos (animales) no tienen plan.
- **Contexto del máster** (`prompt.ts`): el bloque «## Cómo responde X en este turno (situación: …)» va tras la acción
  del jugador. No entra en la apertura, llegadas, tiradas ni turnos compartidos (ronda o charla de grupo).
- **Cierre** (`tools.ts`, `log_event`): `talk_situation` (opcional; el servidor la valida con `situationFits`). Se
  reescribe una vez si el NPC no contesta cuando le toca, si nombra una misión que el PJ aún no puede coger, si en un
  primer saludo suelta un encargo sin que se lo pidan o si dice más de las palabras de su situación (más 10 de margen).
- **Longitud**, palabras de lo que dice el NPC: saludo 30, despedida 20, pregunta 45, lore 60, misión que da 60,
  misión en curso 45, comercio 40, reacción 40, peligro 40, frío 25, charla 40; la situación secundaria suma 15.
- **Máster offline** (`offline.ts`, `talkReply`): una plantilla por situación (saludo de primera vez o de conocido,
  pregunta, lore, comercio, despedida…); la charla sin más se queda con la respuesta de siempre.
- **Fuera de la v1**: insistir en lo ya negado, halagos, comprobar el precio dicho, excepciones por NPC en sus datos.

Prueba en vivo con Haiku (27-10, Brenna en Brezal, cinco frases): cada turno cayó en su situación (saludo, lore,
misión que da, comercio, despedida con su misión en curso). La respuesta de lore salió larga (unas 100 palabras), el
control la rechazó y volvió en unas 60.

Pendiente: al saludar a quien da una misión de la historia, el motor ya la abre solo («La cena del portón» en el
primer «Buenas noches»), y eso choca con «un primer saludo no suelta encargos». Hay que decidir si esa apertura espera
a que el PJ pregunte o a un segundo turno.
