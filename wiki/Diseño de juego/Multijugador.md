---
title: Multijugador
description: "Cómo juegan varias personas en el mismo mundo: cuentas, asientos e invitaciones, qué ve cada uno, interacción entre jugadores, desconexiones, cupos y lo que falta."
tags: [diseño, multijugador]
---
> [!abstract] En corto
> El motor nació multijugador: un mundo compartido, una cola de acciones por lugar y percepción por bandas. La web tiene cuentas (usuario y contraseña): tus partidas y tus personajes te siguen a cualquier dispositivo. El anfitrión reparte un enlace por asiento y cada persona queda ligada a su personaje con su cuenta. Entre jugadores se habla, se da, se sigue y se ayuda sin gastar IA.

## Cuentas y personajes

- **Cuenta:** usuario y contraseña, sin correo. Con ella ves tus partidas (las que creaste y aquellas a las que te uniste) desde el móvil, el PC o donde entres.
- **Biblioteca de personajes:** cada cuenta guarda sus personajes. Al empezar una partida, o al ocupar un asiento libre, eliges uno de ellos o creas uno nuevo, que se guarda.
- **Cada partida juega con una copia.** Lo que le pase al personaje en una partida (heridas, nivel, objetos) se queda en esa partida; tu biblioteca guarda el personaje tal como lo creaste. Puedes llevar el mismo personaje a varias partidas, y cada una sigue su propia historia.
- **Administrador:** una cuenta con ese rol (se crea desde la terminal del servidor; no hay enlaces ni tokens de rescate). Ve todas las partidas y gestiona las cuentas: de cada usuario, sus partidas y sus personajes (ficha, renombrar, borrar); de cada partida, su dueño y quién ocupa cada asiento. Al abrir una partida ajena entra como un jugador más, con un asiento suyo y el personaje que elija (uno de su biblioteca, uno nuevo o el atajo «admin», humano guerrero), y desde el selector de personaje puede mirar y jugar con cualquiera de la partida: es para comprobar los diálogos e intervenir cuando haga falta, no para jugarla.

## Asientos e invitaciones

```mermaid
flowchart LR
  A["Anfitrión crea la partida<br/>con su personaje"] --> S["Se crean asientos:<br/>el suyo + plazas libres"]
  S --> I["⚙ Invitaciones:<br/>un enlace por asiento"]
  I --> F["El amigo abre su enlace<br/>y entra con su cuenta"]
  F --> P["Elige o crea su personaje<br/>«Empezar junto a…»"]
  P --> J["Mismo mundo,<br/>mismo sitio"]
```

- **Asiento:** un hueco para un jugador, con su enlace, su personaje (o libre) y, desde que alguien lo abre, su cuenta.
- Al crear la partida, «Invitados» dice cuántos asientos libres se crean (hasta 8).
- Abrir el enlace con tu cuenta deja **el asiento ligado a ti**, en cualquier dispositivo. No puedes actuar ni mirar por otro.
- **Renovar** cambia el enlace (el viejo deja de valer); **Liberar** quita el asiento a su jugador, y su personaje sigue en el mundo.
- Quien entra con asiento libre elige un personaje de su biblioteca o crea uno. «Empezar junto a…» lo pone al lado del anfitrión, ya conocidos, con una situación complementaria.

**Modos de acceso**

| Modo | Para qué |
|---|---|
| Invitación | Hace falta cuenta, y solo se crea con un enlace de invitación. Las partidas las crea el administrador |
| Público | Cualquiera se crea una cuenta y crea partidas, en las que queda de anfitrión. Cada uno ve las suyas. Límite de partidas nuevas al día |
| Abierto | En local, como siempre: sin cuenta, cualquiera juega con cualquier personaje |

## Qué ve cada uno

- Cada suceso se entrega **por bandas de percepción** (ver [[Percepción]]). Cada pestaña recibe solo lo suyo.
- Los nombres que tu personaje no conoce se enmascaran.
- **Presencia** en la cabecera: iniciales de los demás, punto verde si están en línea, aro dorado si están contigo. «Kael está aquí», «Mira está en camino».
- No dice **dónde** está el otro: eso hay que descubrirlo jugando.
- En la hoja, el bloque **«Tu grupo»**.
- En el hilo: quién entra y quién sale de la partida.
- «está escribiendo…» de los que comparten sitio contigo.

## Entre jugadores, sin máster

Una prueba con dos jugadores en la herrería enseñó que el máster narraba lo que hacía el otro y cada frase gastaba IA. De ahí salieron estas acciones deterministas:

| Acción | Cómo | Coste |
|---|---|---|
| **Decir** | Botón «Hacer / Decir», o empezar por raya o comillas. `— (susurra) …` y `— (grita) …` cambian el volumen | 0 |
| **Dar** | «dar la daga a Aren». El otro ve Aceptar o Rechazar. Caduca a los 5 minutos | 0 |
| **Seguir** | «seguir a Aren». Sales tras él al mismo paso | 0 |
| **Ayudar** | «ayudar a Aren». Ventaja en su siguiente tirada, durante 10 minutos de juego | 0 |
| **Responder** | Si otro se dirige a ti, aparecen «Responder» e «Ignorarle» | 0 |
| **Reaccionar** | Si otro te agarra, te arrastra, te empuja o te ataca, decides tú: «Dejarse», «Resistirse» o tus palabras, en 90 s. Ver abajo | 0 (con máster, una narración del desenlace) |

- **El máster no actúa por otro jugador.** Si lo intenta, el cierre se rechaza.
- Lo que dice otro jugador te llega **literal**, con su avatar, si lo oyes bien.

## Reacciones

Antes, si un jugador agarraba a otro y se lo llevaba a la taberna, el máster lo resolvía sin preguntar. Ahora decide el afectado (26-10-2026).

- **Le llega** en su chat quién, qué intenta y lo que escribió: «Aren intenta agarrarte y llevarte a la Taberna del Jabalí. ¿Te dejas o te resistes?», con la cuenta atrás.
- **Quien actúa** ve «⏳ Esperando a que Mira decida…» y no hace otra cosa mientras, salvo hablar.
- **Dejarse:** sale sin tirada. Un golpe aceptado impacta sin tirada de ataque.
- **Resistirse:** tirada enfrentada del SRD, Atletismo contra el mejor de Atletismo o Acrobacias (el empate lo gana quien se resiste). Un ataque va contra la CA.
- **Con tus palabras:** «vale», «sí», «me dejo» es dejarse; lo demás es resistirse, y lo que dices acompaña.
- **Si no responde en 90 s,** se resiste por instinto. Ausente, igual y al momento. Dormido o inconsciente, no puede resistirse. Bajo el velo, nadie le toca.
- **Efectos:** si sale bien, los dos van al sitio, o queda agarrado o derribado, o recibe el daño. Con máster, este narra el desenlace a los dos.
- **Dar algo** sigue siendo una oferta, no una reacción. **Robarle** la bolsa o unas monedas a otro jugador sí lo es: decide él, y si se resiste es Juego de manos contra su Percepción.

## Varios a la vez en el mismo sitio

| Situación | Qué pasa |
|---|---|
| Dos acciones al máster a la vez | Si llegan en unos segundos (la **ventana de turno**, 3 s), el máster las resuelve juntas, en una sola respuesta, y cada uno lee lo suyo más lo que hace el mundo. Si el máster ya estaba con otra, la nueva espera: «Esperando a Mira…» |
| Dos van a por lo mismo | El máster sabe que chocan (el mismo NPC, el mismo objeto, uno sobre el otro) y lo resuelve a la vez, con tiradas si hace falta |
| Dos acciones en sitios distintos | No se esperan entre sí |
| Doble clic o dos pestañas del mismo jugador | Se rechaza: «Ya tienes una acción en curso» |
| Coger el mismo objeto | A la vez, lo decide el máster con una tirada. Si no, el primero se lo lleva y el segundo ya no lo encuentra |
| Alguien intenta algo sobre ti | Lo siguiente que escribas es tu respuesta («me dejo», «me resisto»). Otra cosa espera a que decidas |
| Hablar con un NPC ocupado | «Esperar turno» o «Unirme a la conversación». En grupo, una sola respuesta para todos |
| Pelea con varios | Rondas: el máster resuelve la ronda entera. Ver [[Combate]] |

### Quién lee qué en la sala

| Qué pasa | Quién lo lee entero | El resto de la sala |
|---|---|---|
| Lo tuyo (miras, rebuscas, hablas con un NPC a solas) | Tú | Un aviso gris de una línea: «Isgral habla con Hugo en voz baja», con «Unirme a la conversación» |
| Una charla con un NPC | Los que están en ella y a quien el NPC le habla. Cada frase dice a quién va: «a ti», «a Isgral», «a todos» | El aviso de una línea |
| Algo que afecta a todos (empieza una pelea, alguien entra, un estruendo, el NPC se vuelve hacia el grupo) | Todos, con la misma narración | Nadie se queda fuera; las charlas sueltas se cortan y el NPC atiende al grupo |

No hay «escuchar» una charla ajena: o te unes (el NPC lo sabe) o lo intentas a escondidas como una acción más.

## Desconexiones

El mundo es abierto: el reloj sigue mientras alguien juegue y cada uno entra cuando quiere. Para quien está fuera no pasa el tiempo: ver [[Tiempo y viaje#Si te desconectas]].

| Momento | Qué pasa |
|---|---|
| Cierras la pestaña | A los 20 s estás **ausente**. Tu personaje se queda donde estaba. Los de tu sitio leen «Leodhin se ha ido; su personaje se queda en el yunque» |
| Ausente en combate | No ataca ni gasta, pero se defiende. Si cae, queda estable: no muere ausente |
| Ausente en una ronda | Duda. Tras dos rondas seguidas, sale de ellas |
| 30 minutos fuera | Cae el **velo**: dormido y protegido. Deja de ser objetivo |
| Vuelves | El velo cae. «Donde lo dejamos» te cuenta lo que te afecta. Ver [[Prólogo]] |

- Las ofertas pendientes con un ausente se cancelan.
- Si se va el líder, quien le seguía deja de hacerlo.
- Un paso de misión lo dan también quienes estaban presentes. Un final cerrado sin ti abre tu «Donde lo dejamos».

## Cupos de gasto

- Con máster real, cada personaje tiene un **cupo diario**: 200 acciones por defecto.
- Al agotarlo, ese jugador sigue en **modo offline** hasta medianoche, con un aviso. Los demás no se ven afectados.
- Con Haiku 5.5, 200 acciones son unos 0,25 € por personaje y día; con Opus 5.5, unos 6 €.

## Lo que falta

| Qué | Prioridad |
|---|---|
| Avisos fuera de la web (no leídos, push o correo) | Deseable |
| Tope global de gasto por partida o servidor | Deseable |
| Cola de conversación con turno explícito | Deseable |
| Dificultad según el número de jugadores | Deseable |
| Reportar un error desde la web | Deseable |
| Robo a un durmiente, candados, guardias | Después |
| Crimen, testigos y ley entre jugadores (el ataque ya es una reacción) | Después |
| Compañías (alianzas formales) | Después |
| Correo y recuperación de contraseña por correo; entrar con Google u otros | Después |

Hecho desde la auditoría: muerte y reaparición. Ver [[Muerte y descanso]].

## Relacionado

- [[Percepción]] · [[Combate]] · [[Interfaz]] · [[Mecánicas]]
