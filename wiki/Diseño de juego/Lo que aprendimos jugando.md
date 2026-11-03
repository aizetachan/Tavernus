---
title: Lo que aprendimos jugando
description: "Resumen de las observaciones de las pruebas con personas reales: tono del narrador, primera escena, fallos del máster, interfaz y multijugador."
tags: [diseño, pruebas]
---
> [!abstract] En corto
> Las pruebas con personas reales cambiaron mucho el juego. El narrador se volvió más breve y menos directo, la primera escena pasó a empezar en el cuerpo del personaje, los nombres dejaron de regalarse y los botones pasaron a ser reacciones inmediatas. Los fallos del máster enseñaron a validar todo en el servidor.

Las notas originales son un cuaderno de pruebas, sesión a sesión, desde septiembre de 2026. Aquí van agrupadas por tema.

## Sobre el narrador y su tono

- **Corto y para el móvil.** Respuestas breves, párrafos de dos o tres líneas. Mejor varios envíos cortos que uno largo.
- **Un mago sabio que observa más que interpela.** No habla tan directo al personaje: habla del mundo y deja que el jugador se vea en él.
- **El narrador se repetía** en la fase sin IA: «mirar» devolvía siempre lo mismo. Era lo esperado hasta que llegó Claude.
- **Imparcialidad.** El máster conoce los secretos, pero nunca los desvela ni los insinúa, para no sesgar al jugador.

## Sobre la primera escena

La bienvenida se reescribió muchas veces:

1. Al principio, la primera narración era la descripción plana del sitio y no se distinguía del tutorial.
2. Luego, una bienvenida en voz del narrador, en tercera persona, como el arranque de un cuento.
3. Se recortó a la mitad (unas 50 palabras) y se quitaron repeticiones.
4. **Regla final:** no abrir con «En Brezal dicen…». El jugador no conoce el sitio y quiere jugar. La primera frase es algo que le pasa al personaje **en el cuerpo o los sentidos**, y el gancho pide una decisión ya.

Más tarde llegó el [[Prólogo]], que separa el contexto (el libro) de la escena (el narrador).

> [!example] Una primera escena real
> El personaje llega al claro y nota en el aire «una película gris que no es polen: ceniza». El gancho es un hacha con hollín en el mango.

- **El origen del personaje no lo escribe el jugador:** cada punto de inicio trae el suyo (viajero en la taberna, hijo de Brezal que vuelve, cazador en el claro).
- **Cada jugador empieza en un sitio distinto**, en el menos poblado.

## Sobre los botones y el dado

- **Las acciones sugeridas miraban «a futuro».** Ahora son lo que el personaje haría ahora mismo: reacciones a lo que acaba de pasar.
- **Con tirada pendiente, solo el dado.** La acción ya está decidida; escribir otra cosa la anula.
- **Al llegar a un sitio**, el jugador se quedaba con los botones viejos y sin contexto. Ahora el máster narra la llegada y los botones antiguos se retiran.
- La gente **escribe frases largas y naturales** («Miro alrededor a ver quién hay en la taberna»). El parser sin IA solo las cubría a medias.

## Sobre los nombres

- **No regalar nombres.** Cada personaje solo conoce a quien se ha presentado o ha sido nombrado. El resto son descripciones: «la tabernera», «un humano con pinta de guerrero». Ver [[Mecánicas]].

## Fallos del máster que enseñaron algo

| Lo que pasó | Lo que se cambió |
|---|---|
| Con 20 tools en modo estricto, la API dijo «grammar too large» | Estricto solo el cierre; después, ninguno: valida el servidor |
| Se colaron etiquetas de parámetros dentro del texto narrado | Saneado del cierre |
| «Puedo guardarme las bayas en el bolsillo» → «No entiendo»: el máster agotó las tools sin cerrar porque no veía los ids de los objetos | Inventario con ids en el contexto y una última llamada obligada a cerrar narrando |
| Un esquema de cierre con demasiados campos fue rechazado | Validación en el servidor |
| Dos jugadores en la herrería: el máster narraba lo que hacía el otro y cada frase entre ellos gastaba IA | Decir, dar, seguir y ayudar sin máster; el cierre que actúa por otro se rechaza. Ver [[Multijugador]] |

- **Lo que sí funcionó desde el principio:** la intención antes de efecto y las tiradas. Preguntar por Vharn pidió Persuasión; colarse tras la barra, Sigilo; examinar el hollín del hacha, Investigación, y al superarla dio la pista.
- El piloto de **partidas automáticas con juez** (10 partidas de 20 acciones con Haiku, 0,38 $) clasificó 59 errores del máster.

## Sobre jugar en grupo

- Un segundo jugador entró y jugó **sin instrucciones**.
- **Qué ven los demás:** la gente preguntó qué canales eran privados. Regla derivada: cada vez que se manda a alguien a otro sitio, decir qué va a encontrar y por qué.
- **Notificaciones:** mencionar al jugador molestaba. Se quitaron las menciones; cada jugador decide cómo le avisan.

## Sobre la puesta en marcha (la época de Discord)

- Crear el bot tenía trampas: una pantalla sin botón de guardar, IDs escondidos tras un «modo desarrollador», un token que no se guardó.
- **«hola» creó un personaje llamado «Hola?».** Desde entonces, el bot pide confirmación y cada canal empieza con un mensaje que explica para qué sirve.
- **La creación debía ser privada:** se pasó a botones y formularios que solo ve quien los usa.
- **El bot se cayó** una tarde por un corte de conexión y nadie lo relanzó. Llegaron el vigilante, el latido y el aviso de caída; la solución de fondo era un servidor de verdad.
- Una suscripción de Claude **no sirve** para un servicio propio: hace falta clave de API con saldo.

## Sobre la interfaz web

- En el móvil (390 px) la cabecera no cabía y un botón se cortaba.
- Una partida que no existía redirigía al menú **sin avisar**.
- Estas observaciones alimentaron el rediseño en Figma. Ver [[Interfaz]].

## Lo que queda por observar

- Si la gente reporta errores o los cuenta por otro lado.
- Si confunde el tiempo de juego (3×) y las esperas de viaje.
- Si la hoja se mira y se actualiza a tiempo.

## Relacionado

- [[El máster IA]] · [[El narrador]] · [[Prólogo]] · [[Multijugador]] · [[Interfaz]]
