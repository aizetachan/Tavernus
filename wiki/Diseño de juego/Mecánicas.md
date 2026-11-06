---
title: Mecánicas
description: "Cómo se juega a Tavernus desde el punto de vista del jugador, de las tiradas al progreso."
tags: [diseño, mecánicas]
---
> [!abstract] En corto
> Escribes lo que haces en lenguaje natural. El motor resuelve lo mecánico (moverse, coger, tirar dados) y el máster narra el resto. Todo cuesta tiempo, todo ocupa sitio y solo te enteras de lo que tu personaje puede percibir.

## La idea general

- **Texto libre siempre.** Escribes «me acerco a la barra» o «le pido una cerveza a la tabernera».
- **Botones donde ahorran esfuerzo.** Acciones sugeridas, el dado, aceptar una oferta.
- **El mundo es compartido.** Si alguien tala el roble, el siguiente encuentra el tocón.
- **Solo ves tu parte.** Cada jugador tiene su punto de vista. Lo que pasa lejos no te llega.

Las mecánicas grandes tienen su propia página:

| Tema | Página |
|---|---|
| Reloj, movimiento, viaje y monturas | [[Tiempo y viaje]] |
| Visión, oído, luz y bandas de detalle | [[Percepción]] |
| Combate y ventanas decisivas | [[Combate]] |
| Caer a 0 PG, morir, volver y descansar | [[Muerte y descanso]] |
| Crímenes, testigos, alto y calabozo | [[#Crimen, testigos y ley]] |
| Crear el personaje | [[Creación de personaje]] |

## Acciones: con IA y sin IA

Muchas acciones no pasan por el máster. Son deterministas y no cuestan nada.

| Sin IA (motor) | Con IA (máster) |
|---|---|
| Ir, salir, coger, soltar, esperar, llegar | Hablar con un NPC, examinar, convencer |
| Clic en el tablero para moverse | Acciones creativas o ambiguas |
| Comandos: `/look`, `/where`, `/who`, `/inventory`, `/recap`, `/time` | Consecuencias narrativas |
| Decir algo a otro jugador, dar, seguir, ayudar | Todo lo que necesita lenguaje |

Si el máster no responde (sin clave o en modo offline), un **narrador plano** describe lo que pasa a partir de los datos.

## Tiradas y reglas 5e

- **El servidor tira los dados.** Nunca la IA.
- Cuando una acción tiene riesgo, el máster no la resuelve solo. Pide una tirada y aparece el botón **Tirar** (el dado).
- Al pulsarlo, el servidor tira, enseña el desglose (d20 + modificadores) y el máster narra la consecuencia.
- Mientras hay tirada pendiente, solo aparece el dado: la acción ya está decidida. Escribir otra cosa la anula.
- **No eliges la habilidad.** Describes lo que haces y el máster elige la prueba (Persuasión, Sigilo, Atletismo…).
- Reglas implementadas: expresiones de dados, ventaja y desventaja, 20 y 1 naturales, habilidades y salvaciones.
- Las tiradas ocultas (percepción pasiva, sigilo de NPC) van sin botón.
- **Las tiradas se ven.** Cada tirada de un personaje sale en el chat como aviso de sistema: quién tira, para qué, el dado, el modificador, el total y el resultado. La ven quien tira, los demás jugadores que están en el mismo lugar y los que comparten la ronda. Vale también para los ataques, la Medicina para estabilizar y las salvaciones contra muerte. La CD no se dice. Las tiradas de los enemigos y las ocultas siguen sin verse.
- Los manuales no se cargan enteros: el máster los **consulta por fragmentos** cuando duda de una regla.

> [!example] Ejemplo de la primera partida
> Al preguntar por Vharn, el máster pidió Persuasión (CD 13). Al colarse tras la barra, Sigilo (CD 14). Talar el roble tiró Atletismo en el servidor; falló y el máster lo narró como fallo.

## Intención antes de efecto

Una acción con consecuencias **no se ejecuta hasta que tiene sentido**.

- Si falta objetivo, dirección o propósito, el máster pregunta antes.
- No se gasta tiempo, recurso ni conjuro mientras tanto.
- «Ataco» sin nadie delante lleva a una pregunta, no a un golpe al aire.

## Inventario y carga

Nada es infinito. El servidor decide si algo cabe; el máster solo lo narra.

**Tamaño de los objetos**

| Tamaño | Ejemplos |
|---|---|
| Diminuto | moneda, anillo, llave |
| Pequeño | poción, daga, libro |
| Mediano | espada, cuerda, escudo |
| Grande | armadura, arco largo |
| Voluminoso | cofre, barril, cadáver (dos manos, no cabe en nada) |

**Dónde llevas las cosas**

| Sitio | Capacidad |
|---|---|
| Manos | Una cosa en cada una, o una voluminosa con las dos |
| Equipado | Una por hueco (cabeza, cuerpo, pies, cuello, anillos…) |
| Bolsillos | 4 huecos, solo cosas diminutas o pequeñas |
| Mochila | 20 huecos y 60 libras; sacar algo cuesta una acción |
| Alijos | Cofres fijos en un sitio: solo estando allí |

- **Carga por Fuerza.** Máximo Fuerza × 15 libras. Cargado, vas más lento; muy cargado, además con desventaja.
- **Las monedas pesan.** 50 monedas son 1 libra, cuente lo que cuente cada una: 15 de oro pesan lo mismo que 15 de cobre.
- **Oro, plata y cobre.** 1 de oro = 10 de plata = 100 de cobre. Se empieza con 1 de oro y 5 de plata. Una cerveza vale 4 de cobre, una noche de posada 2 de plata y una espada corta 10 de oro. Ver [[Decisiones]].
- Un objeto está siempre **en un solo sitio**. Moverlo es atómico: nunca se duplica ni desaparece.
- Si algo no cabe, el máster lo dice en ficción: «no te cabe, ¿sueltas algo o lo llevas en la mano?».

**Lo que lleva encima cada vecino**

Toda persona lleva algo real que se le puede robar o que se encuentra al registrarla. Nadie se lo inventa a mitad de partida:

- **Una bolsa de cuero al cinto con unas monedas.** Cuántas depende de su oficio: el regidor lleva oro; el cazador, unos cobres. Si coges la bolsa, su dinero pasa a tus monedas.
- **Dentro, dos o tres cosas de su oficio.** La tabernera, un manojo de llaves; la curandera, hierbas secas y vendas; el herrero, clavos y yesca; el guardia, un silbato; el regidor, un anillo de sello.
- **Su arma, si es de pelear.** La maza del alguacil, la lanza del guardia, el arco del cazador. Quien no pelea no la lleva a la vista.
- Los animales no llevan nada.

Robar la bolsa o sacar algo de ella es robarle a esa persona: si alguien lo ve, es un robo, con sus testigos (ver [[#Crimen, testigos y ley]]). Lo que le quitas no vuelve a aparecer. Lo mismo vale para los mundos generados: la regla sale del oficio de cada uno, no de una lista escrita para Brezal.

## Progreso

Se aprende «como en la vida»: lo básico no sube nada, la práctica repetida mejora algo concreto y resolver la trama da lo más.

| Fuente | Cómo funciona |
|---|---|
| **Pistas** | Descubrimientos personales. Cada una se gana una sola vez por personaje y suma reputación. Ver [[Pistas]]. |
| **Encargos del tablón** | Trabajos que rotan en el tablón y se entregan al NPC que los pide. Cada uno suma reputación una sola vez. Ver [[Encargos del tablón]]. |
| **Misiones** | Historias con pasos. Se aceptan solas al recibirlas y se siguen en el Diario. Ver [[Misiones]]. |
| **Reputación** | Un número por facción. Sube con pistas y encargos. |
| **Oficios y práctica** | Talar, pescar, forjar… Cada tirada significativa (CD 10 o más) suma práctica. A los 10, 30 y 60 usos: competencia, +1 y +2. |
| **Logros** | Un objetivo grande con recompensa y anuncio público. |
| **Combate** | Un NPC derrotado da experiencia a quien lo vence; si muere, suelta lo que lleva. Si no era hostil contigo, no hay experiencia: si muere hay **infamia**. Pegarle hasta tumbarle le deja inconsciente, no muerto. Ver [[Combate#Golpe no letal]]. |

- **El límite lo pone el mundo.** Los recursos se agotan y se regeneran: un árbol a medio regenerar da la misma práctica pero menos madera.
- **Compra y venta** con los NPC que comercian, a precio de lista.

> [!example] El logro de la demo
> En la primera versión de Brezal, «Quien ha mirado la ceniza» pedía 3 pistas y reputación 5. Daba un anuncio público, una llave con el sello de Vharn y la habitación de arriba de la posada, oculta para los demás.

> [!note] La demo no «termina»
> Quien cumple el objetivo sigue en el mismo mundo. No se gana: se recompensa a quien lo logra.

## Niveles, rasgos y conjuros

Todo sale de los datos SRD de cada clase. Ver [[Creación de personaje]].

- **Niveles.** Se sube solo al llegar a los PX del SRD (300, 900, 2700, 6500…). Los PX se ganan venciendo enemigos y cumpliendo misiones. Los PG suben la media del dado de golpe + CON, sin tirar. Un aviso destacado en el hilo dice lo que se gana. En hardcore, subir devuelve lo que quitó la muerte.
- **Rasgos de clase.** Cada clase tiene sus rasgos hasta nivel 5, con la subclase del SRD: Campeón, Ladrón, Evocación, Vida, Berserker, Conocimiento, Tierra, Mano Abierta, Devoción, Cazador, Linaje dracónico e Infernal. Los que tienen usos (Furia, ki, Tomar aliento…) enseñan cuántos quedan y con qué descanso vuelven.
- **Elecciones.** El estilo de combate, la pericia, la metamagia y las invocaciones vienen con un valor por defecto, y se cambian en la Hoja. La mejora de característica (+2 a una o +1 a dos) queda «por elegir» y es definitiva.
- **Conjuros.** Los trucos, el libro y los preparados del mago, los preparados del clérigo, del druida y del paladín, y los conocidos del resto. Se rellenan con los recomendados de la clase y se cambian en la Hoja. Los de dominio o juramento van siempre preparados. Cada conjuro de nivel gasta un espacio de su nivel o más; los rituales del libro del mago se lanzan sin espacio.
- **En partida.** Para lanzar un conjuro, el jugador lo dice al actuar («lanzo Proyectil mágico al lobo»). El máster solo puede lanzar los de la lista del personaje: el servidor gasta el espacio y tira los dados. «¿Qué sé hacer?», «¿qué hechizos tengo?» y «¿qué nivel tengo?» los contesta el sistema, sin narrador.

## Nombres que se conocen al presentarse

- Tu personaje **no sabe cómo se llama nadie** hasta que se presenta o alguien lo nombra.
- Hasta entonces, el máster usa lo que se ve: «la tabernera», «un humano con pinta de guerrero».
- Los textos que leen los testigos también ocultan los nombres que no conocen.
- Entre jugadores pasa igual: el nombre se aprende al oírlo. «Empezar junto a…» deja a los dos personajes ya conocidos.
- Fuera de la ficción (cabecera, «Tu grupo») la interfaz sí enseña los nombres reales.

> [!example]
> Un personaje nuevo ve «una mujer de unos cincuenta años… seca la misma jarra». Cuando Brenna dice su nombre, queda aprendido.

## Conversación con NPC

- Un NPC **atiende a uno cada vez**. Si está ocupado, te hace un gesto para que esperes.
- Puedes **esperar turno** o **unirte a la conversación**: en grupo, el máster responde una vez a todos.
- Los NPC **recuerdan** lo que hablaste con ellos. Ver [[El máster IA]].
- En plena charla el narrador se aparta: solo entra cuando aporta algo.

## NPC que te acompañan

- Lo que un NPC acepta **pasa de verdad**. Si te dice «te sigo» o «ve delante», va contigo de punto en punto y de sitio en sitio. Mientras tanto se olvida de su horario.
- Si decide ir a otro sitio, se va de verdad. Quien esté allí lo ve marcharse y llegar, en una línea como las de WhatsApp.
- Puede llevar un **encargo**: curar a un herido, atender a alguien que ha caído o darle algo. Lo hace en cuanto llega a donde está esa persona.
- Deja de acompañarte si le despides, si cumple el encargo, si le hacen daño, si te vas de la partida o si pasan unas horas. Después se queda un rato donde está y vuelve a lo suyo.

> [!example]
> «Ilse, acompáñame a la plaza, hay un herido.» Ella contesta «Vamos. Tú delante», sale contigo y cura al herido al llegar a su lado. En la partida del 26 de octubre se quedaba en su casa.

## Crimen, testigos y ley

Lo que haces delante de la gente tiene consecuencias. Las decide el motor, no el máster, y el máster tiene que contarlas.

- **Qué es un crimen.** Golpear a quien no era hostil contigo (con arma o con un conjuro), matarle, registrar o saquear un cadáver, robarle algo a alguien o insultarle a la cara. Defenderte de quien te atacó primero no lo es.
- **Quién lo ve.** La gente que está en el lugar. Una pelea se oye en toda la sala; un robo o un registro solo se ve de cerca. La gente de la agenda también cuenta («unos diez vecinos»).
- **Cada uno reacciona según quién es:**

| Quién | Qué hace |
|---|---|
| La autoridad ([[Garrán]], [[Doro]]) | Te da el alto y te detiene. Si te resistes, pelea. |
| El dueño del local | No te sirve ni te aloja. |
| Los allegados de la víctima | Se meten contra ti o guardan luto, según quiénes sean. |
| La gente corriente | Grita, huye o corre a avisar a la autoridad. |
| La víctima | Se defiende o pide ayuda. |

- **En el acto.** Tras tu acción sale un aviso con la reacción de cada uno. Quien se lanza contra ti entra en el combate. Si la autoridad está delante, te da el alto con tres botones: **Entregarme**, **Resistirme** y **Huir**.
- **Entregarte.** Lo grave (matar, atacar con arma, profanar un cuerpo) es **calabozo**: en Brezal, el de [[La casona]], 24 horas por una muerte. Lo leve es **multa**. Preso no sales hasta cumplir; dormir hace pasar el tiempo.
- **Resistirte o huir.** La autoridad pasa a hostil y va a por ti; el resto de la autoridad acude a ayudar. Todos los que se meten pelean solos en cada turno (ver [[Combate#Los enemigos actúan siempre]]). Si te tumban, despiertas en el calabozo.
- **Buscado.** En cuanto la autoridad lo sabe, tienes la condición «buscado» con su motivo. La autoridad va a donde te vieron por última vez.
- **La noticia corre.** Quien llega al sitio y ve el cuerpo se entera. Quien coincide con alguien que lo sabe, también. El rumor viaja con ellos de un lugar a otro.
- **Lo que pierdes.** Reputación con el pueblo (tanta como la gravedad). Quien lo sabe no te vende, no te compra, no te fía ni te aloja. No duermes tranquilo, ni con llave, donde alguien que lo sabe te haya visto: vienen a por ti.
- **El máster no puede ignorarlo.** Lee primero lo que vio cada testigo («vio cómo Leodhin mataba al herrero y le tiene miedo»). Si su narración no cuenta la reacción, el motor se la devuelve para que la reescriba.

> [!example] Hugo, en la partida del 27 de octubre
> Leodhin mató a [[Hugo]] en la barra del Jabalí delante de [[Brenna]], [[Garrán]] y la cena, y Brenna le alquiló un cuarto. Ahora, en el acto: Brenna retrocede y no le atiende, Garrán le da el alto y los vecinos gritan. Leodhin queda buscado, sin experiencia y con infamia, y no duerme en el Jabalí. Ver [[Revisión partida 2026-10-27]].

## Confianza: lo que te cuenta cada uno

Cada vecino se fía de ti en uno de cuatro niveles: **extraño**, **conocido**, **amigo** o **aliado**. Lo que sabe va repartido en esos niveles, y el narrador solo recibe lo del nivel que tienes con él. Lo demás no le llega, así que no te lo puede soltar aunque saques un 20.

- **Sube** con lo que haces por él: misiones y encargos cumplidos, recados que le llevas en mano, regalos, favores y tiradas sociales con éxito (Persuasión, Interpretación, Perspicacia).
- **Adular depende de quién.** A [[Doro]], [[Osric Malvez]] o [[Mateo]] les gusta que les doren la píldora; a [[Brenna]], [[Ilse]], [[Hugo]], [[Hal]], [[Ysolde]] y [[Úrsula]] les molesta, y les resta.
- **Con tope por charla.** En una misma conversación ganas como mucho un poco, así que un extraño sigue siendo un extraño al acabar la primera charla. Despedirse y volver enseguida cuenta como la misma.
- **Baja** si le amenazas (Intimidación, salga o no), te pilla en una mentira, le insultas, le hostigas (insistir cuando ya ha dicho que no, una y otra vez), te ve cometer un crimen o le atacas.
- **La actitud manda encima.** Si te tiene por enemigo o te recela, eres un extraño; si es tu amigo o tu aliado por una misión, al menos eso.
- **Ir de parte de alguien ayuda.** Si [[Ilse]] te manda a ver a [[Hugo]], él te recibe como a un conocido.
- **Aviso.** Cuando cambias de nivel con alguien sale una línea en el hilo («Ilse se fía más de ti: ahora te tiene por amigo»). Los puntos no se enseñan.

Las [[Pistas]] que da una persona piden su confianza, y algunas un paso de misión, un sitio o un objeto. Ver también [[El máster IA#El contexto: poco y justo|El máster IA]].

> [!example] Ilse, en la partida del 27 de octubre
> Nada más conocerla, con una Persuasión CD 13, Ilse le contó a Leodhin la Brasa, la cripta, el granero y las cadenas. Ahora, la misma tirada le hace hablar mejor de la tos y de sus tónicos, pero la Brasa es de amigo: llega al llevarle el agua del pozo. Ver [[Revisión partida 2026-10-27]].

## El mundo reacciona: opinión, etiquetas y comentarios

Además del crimen, el mundo reacciona a todo lo que pasa, con reglas escritas en los datos de la campaña: «cuando muere [[Hugo]], [[Doro]] guarda luto». Es la idea de *Baldur's Gate 3*. Ver [[Modelo Baldur's Gate 3]].

- **Lo que pasa queda apuntado** con quién lo vio: una muerte, una misión cumplida o perdida, un objeto que cambia de manos. A quien no estaba le llega de boca en boca, con las rutinas y un rato después. Nadie se entera por arte de magia.
- **Opinión.** Cada vecino tiene una opinión de cada personaje, que sube o baja 1, 5 o 10 según lo que haga. Solo cambia si el vecino lo sabe. En multijugador, cada uno la suya.

| Opinión | Qué cambia |
|---|---|
| +40 | Aliado: te ayuda aunque le cueste; precios un 20 % más bajos |
| +10 | Amistoso: te trata con confianza; precios un 10 % más bajos |
| −10 | Receloso: no te ayuda ni te acompaña; precios un 20 % más altos |
| −30 | No te vende ni te aloja |
| −40 | Hostil |
| −50 | No quiere ni hablar contigo: se da la vuelta |

- **Las tiradas sociales** contra un vecino (Persuasión, Engaño, Intimidación, Interpretación) son más fáciles o más difíciles según su opinión: 1 punto de CD por cada 5 de opinión.
- **Etiquetas.** Tu raza, tu clase, tu trasfondo y lo que te ganas: *asesino*, *ladrón*, *salvó a Ceniza*, *amigo de Ilse*. Cada vecino reacciona a las suyas. [[Doro]] trata como a un igual a quien fue soldado, y [[Garrán]] se vuelve servil con un noble. Algunas abren un botón con tirada: «[Soldado] Hablarle de tú a tú, entre soldados (Persuasión CD 12)».
- **Comentarios al pasar.** La gente comenta lo que ha pasado unos días («¿Os habéis enterado de lo del herrero?»), te señala si lo hiciste tú, y habla de su día. Solo lo dice quien lo sabe. Salen en el hilo como una línea al margen, en cursiva, sin el narrador, y nunca oyes dos veces la misma.
- **Lo que haces vuelve.** Salvar a alguien o dejarle morir queda como un hecho que la historia consulta después.

> [!example] Hugo y Ceniza
> Si un forastero mata a [[Hugo]]: gana la etiqueta *asesino*, quien lo vio le teme, [[Doro]] se entera tarde pero le coge inquina (−10) y guarda luto, y en la plaza se habla del herrero tres días. Si devuelves a [[Ceniza]]: [[Brenna]] +10 (pasa a amistosa), ganas *salvó a Ceniza* y en el Jabalí lo comentan.

## Comandos de sistema

Fuera de la ficción y sin IA: `/look`, `/where`, `/who`, `/inventory`, `/recap` (lo que te perdiste), `/time`, `/tablon` y `/progress`. Los avisos del tablón y del progreso salen en el hilo como una línea con enlace al Diario.

## Relacionado

- [[Diseño de juego]] · [[El máster IA]] · [[Multijugador]] · [[Brezal]]
