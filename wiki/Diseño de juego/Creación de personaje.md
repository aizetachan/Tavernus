---
title: Creación de personaje
description: "Cómo nace un personaje con las reglas SRD de 5e: 9 razas, 12 clases, 6 trasfondos y el array estándar."
tags: [diseño, personaje]
---
> [!abstract] En corto
> El personaje se crea con las tablas del SRD de D&D 5e, sin escribir nada a mano salvo el nombre y el aspecto. El jugador elige entre opciones válidas y el servidor calcula todo lo derivado: PG, CA, salvaciones, percepción y equipo inicial.

## Principio

- **Nunca se escriben reglas en texto libre.** El servidor tiene las tablas SRD y solo ofrece opciones válidas.
- **El servidor calcula los derivados**, nunca la IA.
- **Nadie edita la hoja después.** Solo cambia por lo que pasa en el juego.

## Razas (9)

| Raza | En una línea |
|---|---|
| Humano | Adaptable y ambicioso. +1 a todo. |
| Elfo | Grácil y longevo, ve en la oscuridad. +2 DES; Percepción. |
| Enano | Recio y terco, ve en la oscuridad. +2 CON. |
| Mediano | Pequeño, sigiloso, afortunado. +2 DES. |
| Gnomo | Curioso e ingenioso, ve en la oscuridad. +2 INT. |
| Semielfo | Entre dos mundos. +2 CAR, +1 DES, +1 CON. |
| Semiorco | Fuerte y temido. +2 FUE, +1 CON; Intimidación. |
| Tiefling | Sangre infernal. +2 CAR, +1 INT. |
| Dracónido | Orgullo de dragón. +2 FUE, +1 CAR. |

## Clases (12)

| Clase | Dado de golpe | En una línea |
|---|---|---|
| Guerrero | d10 | Maestro de armas y armaduras |
| Pícaro | d8 | Sigilo, cerraduras y golpes certeros |
| Mago | d6 | Estudio arcano. Frágil, poderoso |
| Clérigo | d8 | Fe que cura y golpea |
| Explorador | d10 | Rastreador de los lindes |
| Bárbaro | d12 | Furia y aguante |
| Bardo | d8 | Palabras que hieren y curan |
| Druida | d8 | Voz de lo salvaje |
| Monje | d8 | Disciplina y puños |
| Paladín | d10 | Juramento y acero |
| Hechicero | d6 | Magia en la sangre |
| Brujo | d8 | Un pacto y su precio |

## Trasfondos (6)

| Trasfondo | Habilidades |
|---|---|
| Acólito | Perspicacia, Religión |
| Criminal | Engaño, Sigilo |
| Héroe del pueblo | Trato con animales, Supervivencia |
| Noble | Historia, Persuasión |
| Erudito | Arcanos, Historia |
| Soldado | Atletismo, Intimidación |

## Características: el array estándar

- Se reparten seis valores fijos: **15, 14, 13, 12, 10, 8**.
- Cada clase trae un **reparto recomendado**. Se puede usar tal cual o repartir uno a uno.
- El servidor rechaza cualquier otro reparto.

## Habilidades

1. El **trasfondo** da dos fijas.
2. La **clase** deja elegir N de su lista (Pícaro 4, Bardo y Explorador 3, el resto 2). Solo salen las que no tienes ya.
3. La **raza** añade las suyas (el Elfo, Percepción).

En el juego no necesitas saber cuál usar: describes lo que haces y el máster elige la prueba.

## Lo que calcula el servidor

- **PG:** dado de golpe de la clase + CON.
- **CA:** armadura + DES (con su tope) + escudo.
- Salvaciones, percepción pasiva, visión en la oscuridad y velocidad.
- **Equipo inicial** de la clase, ya colocado: en las manos, puesto, en los bolsillos y en la mochila (antorchas, raciones, cuerda).
- **Lo del trasfondo y la ropa.** El soldado lleva su insignia de rango, un trofeo y dados de hueso; el acólito, su símbolo sagrado, un libro de oraciones, incienso y sus vestiduras; el criminal, una palanca; el héroe del pueblo, herramientas de carpintero, una pala y una olla; el noble, su anillo de sello y su pergamino de linaje; el erudito, tinta, pluma, un cuchillo pequeño y la carta de un colega muerto. Todos llevan ropa: de viaje, fina el noble y oscura con capucha el criminal. Puesta si la clase no lleva armadura; si no, en la mochila. El resumen lo enseña en una fila aparte, «Del trasfondo».

## El flujo, entonces y ahora

**En Discord** (primera versión) era un flujo por menús: nombre → raza → clase → trasfondo → características → habilidades → modo de muerte → resumen y «Entrar en el mundo». Todo por botones y mensajes que solo veía quien creaba.

**En la web** es un asistente por pasos, el mismo para el anfitrión en «Nueva partida» y para el invitado que entra por su enlace (#14):

| Paso | Notas |
|---|---|
| Nombre | Con dos campos opcionales: aspecto (retrato y narración) y por qué viene (situación inicial; el anfitrión solo lo ve en mundos generados) |
| Raza, clase, trasfondo | De las listas de arriba. El trasfondo que encaja con la clase sale marcado como sugerido |
| Características | Parte del reparto recomendado de la clase. Si eliges un valor que ya tiene otra, se intercambian |
| Habilidades | Solo las de su clase que aún no tiene; hay que elegir justo las que tocan |
| Si mueres | Casual por defecto. Ver [[Muerte y descanso]] |
| Resumen | PG, CA, velocidad, percepción, salvaciones, habilidades y equipo, calculados por el servidor. Al invitado le añade «Empezar junto a…». Ver [[Multijugador]] |

El servidor vuelve a validarlo todo al crear. Los conjuros, la pericia y el estilo de combate se rellenan con los recomendados y se cambian en la Hoja. Ver [[Mecánicas#Niveles, rasgos y conjuros]].

## Lo que el personaje trae al mundo

- **Situación inicial.** En campañas escritas y mundos generados, cada personaje recibe una: por qué está aquí, qué quiere, una amenaza y un plazo. Ver [[Mundos generados]] y [[Prólogo]].
- **Retrato (avatar).** Al crearlo se pinta un primer retrato con su nombre, raza, clase y aspecto. Se pueden pedir otras versiones o describirlo de nuevo, con un límite diario.
- **Prólogo.** Su historia empieza con una apertura de libro. Ver [[Prólogo]].

## Lo que aún no está

- Elegir conjuros, pericia y estilo de combate en el asistente. Hoy se ponen solos según la clase y se cambian luego en la Hoja.
- Rasgos de clase más allá del nivel 5 y conjuros de nivel 4 o más.
- Point buy o tirada de 4d6 como alternativa al array (la spec los deja configurables).

## Relacionado

- [[Mecánicas]] · [[Muerte y descanso]] · [[Personajes]]
