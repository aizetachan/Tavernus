---
title: Tiempo y viaje
description: "El reloj global a 3×, el movimiento que siempre cuesta tiempo y cómo se viaja solo o en grupo."
tags: [diseño, mecánicas]
---
> [!abstract] En corto
> El mundo tiene un reloj único que corre a tres veces la velocidad real mientras alguien juega. Para quien no está no pasa el tiempo. Moverse nunca es instantáneo: el servidor calcula cuánto tardas según la distancia real del mapa. El máster solo narra el resultado.

## El reloj del mundo

- **Un solo reloj, velocidad fija: 3×.** 8 horas reales jugadas son 1 día de juego.
- Lo lleva el servidor, no el máster. La IA **no puede adelantar el tiempo**.
- Si no queda nadie jugando, el mundo se para. Tampoco corre con el servidor apagado o la partida cerrada.
- Del reloj salen la luz del día y de la noche, los horarios de los NPC y la agenda de sucesos.

| Real | Juego |
|---|---|
| 20 min | 1 h |
| 2 h 40 min | 8 h (un descanso largo) |
| 8 h | 1 día |
| 1 día | 3 días |
| 1 semana | 3 semanas |

> [!info] La trama no caduca sola
> En la spec, el reloj solo mueve las **líneas secundarias** (mercado, caravanas, una plaga). La trama principal avanza por acontecimientos, no por tiempo. Una semana sin jugar no consume nada.

## Si te desconectas

| Pasa esto | Qué ocurre |
|---|---|
| Te vas y no queda nadie | El mundo se para a los 20 s (80 s si la pestaña está oculta). Si habías dormido o viajado, antes avanza hasta tu hora. Al volver, misma hora y nada resuelto sin ti: ni la ronda ni la ventana decisiva |
| Te vas y otros siguen | El mundo sigue y tu reloj se congela. Tus estados, cárcel, deudas y plazos no corren. Al volver te igualas al mundo y, si te ha sacado 1 h o más, lees «Donde lo dejamos» |
| La amenaza | Corre con el mundo y mira el reloj del personaje presente más adelantado: dormir y viajar la acercan. En Brezal, 72 h de juego |
| Una misión con un hito del mundo | Se puede perder estando fuera, si otros juegan: es un hecho del mundo y el resumen lo cuenta |
| Volver de la muerte | Las 2 h reales siguen contando |

## El mapa: localizaciones y puntos

- **Localización:** la taberna, la plaza, el claro. Es la unidad de «quién está aquí».
- **Punto:** dentro de cada localización, la barra, la mesa del fondo, el roble viejo. Cada uno tiene coordenadas en metros.
- **Salidas:** unen localizaciones, con su distancia y su tipo de terreno.
- **Nombres y alias:** «el roble», «el árbol grande». El servidor traduce lo que escribes a un punto **antes** de llegar al máster. Si hay duda, pregunta.
- **Puntos ocultos:** existen para todos, pero solo los ve quien los descubre (o a quien se los enseñan).
- **Capacidad:** una cornisa caben dos. Lleno es lleno.

El máster no inventa espacio: solo puede referirse a lo que existe en el mapa.

## Moverse cuesta tiempo

```
tiempo de juego = distancia / (velocidad × terreno × condiciones × ritmo)
tiempo real     = tiempo de juego / 3
```

| Factor | Valores |
|---|---|
| Velocidad | La de la hoja: 9 m cada 6 s, unos 90 m por minuto |
| Ritmo | Sigilo ×0,5 · andar ×1 · correr ×2 |
| Terreno | Camino 1 · bosque denso 0,5 · agua 0,3 |
| Condiciones | Cargado, exhausto, herido |

- Dentro de un sitio, la distancia es la línea recta entre puntos.
- Entre sitios, el servidor busca la ruta más corta por las salidas.
- **Misma fórmula para todos.** Mismo origen y misma velocidad, mismo tiempo.
- Mientras viajas estás **en tránsito**: quien mire te ve «a medio camino».
- Puedes cambiar de destino a medio camino. Se recalcula desde donde estás.
- **Ir a un sitio lleva hasta él y entra.**

## Viaje rápido y reloj propio

Para trayectos largos, cada personaje tiene **su propio reloj** mientras viaja.

- El viaje sale entero en el acto y tu reloj queda adelantado.
- Por el camino pueden salir **encuentros**.
- Si llegas a un sitio donde otro jugador conectado vive una hora anterior, **tu reloj se iguala al suyo** y actúas en el acto: nadie espera a nadie, como en [[Modelo Baldur's Gate 3|Baldur's Gate 3]]. Los pocos minutos que «pierdes» no se notan.
- Solo cuenta quien tiene la pestaña abierta (o acaba de actuar) y no está ausente. Al cargar la partida no cuenta nadie hasta que abre su pestaña.
- **Dormir también adelanta tu reloj.** Desde media hora de adelanto se te dice: «Vas por delante del mundo: para ti son las 03:48, pero los demás aún van por las 19:48». La gente sigue en lo que hacía a esa hora y el reloj del mundo te alcanza solo.

## Viajar juntos

No hay líder ni objeto «grupo». Hay física.

- Dos personajes viajan juntos si van **al mismo sitio a la misma velocidad**.
- **Seguir a alguien:** «seguir a Aren». Cuando se pone en camino, sales tras él al mismo paso y llegáis juntos.
- Si el seguidor no puede pasar (puerta cerrada para él, salida bloqueada), deja de seguir y se le dice por qué.
- **Monturas y vehículos** (en la spec): tu velocidad es la de lo que te lleva. A la grupa, llegas cuando llegue el dueño.

## Recursos que se agotan

- Árboles, vetas, bayas o bancos de peces son **nodos de recurso** en un punto.
- Extraer da recursos según lo regenerado y deja el nodo más pobre.
- Se regeneran con el reloj (un día de juego en la demo).
- Es estado compartido: si Kael tala el roble, Mira encuentra el tocón; al día siguiente, un árbol joven.

## Horarios y agenda

- Los NPC tienen **horarios**: dónde están según la hora.
- La **agenda del mundo** dispara sucesos a su hora, sin IA, y se reparten a quien esté allí y los perciba.
- El máster puede **sembrar ganchos**: sucesos futuros que el motor vigila gratis y dispara cuando toca.

## Relacionado

- [[Mecánicas]] · [[Percepción]] · [[Muerte y descanso]] · [[Brezal#Mapa|Mapa de Brezal]]
