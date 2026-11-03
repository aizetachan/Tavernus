---
title: Narrador de voz
description: "El máster leído en alto en castellano, con voces distintas para narrador y personajes, y la comparación de proveedores y costes."
tags: [diseño, sonido, voz]
---
> [!abstract] En corto
> Cada narración se puede escuchar. Por defecto usa la voz del propio navegador, gratis. Con una clave, la voz pasa a la nube (Azure o ElevenLabs) y suena igual en cualquier móvil, también con la pantalla apagada. El objetivo: jugar desde el móvil sin mirar la pantalla.

## Qué hace

- **Altavoz** en cada narración: un toque la lee, otro la para. En el rediseño, se escucha desde el **avatar**, con un borde que late con la voz.
- **«Leer solo»:** encadena las narraciones nuevas sin cortar la que suena.
- **Ajustes:** voz del narrador, voz de los personajes, velocidad y «mantener la pantalla encendida». Se recuerdan en el navegador.
- El [[Prólogo]] y «Donde lo dejamos» también se leen en alto.
- El ambiente sonoro **baja** mientras habla el narrador. Ver [[Música y sonido]].

## Voces distintas

- La narración se parte en trozos de **narrador** y de **diálogo** (rayas y comillas).
- En el navegador, el diálogo usa otra voz (de otro género si se puede) y cada hablante la suya. Si solo hay una voz, cambia el tono.
- En la nube, **cada NPC tiene siempre la misma voz**.

## Limpieza del texto

Antes de leer, el texto se limpia:

- fuera negritas, viñetas, iconos y atajos;
- `1d20+2 = 14` se lee «1 de 20 más 2, total 14»;
- `CD 12` se lee «dificultad 12» y `PG`, «puntos de golpe»;
- las rayas se convierten en pausas.

## Proveedores

| Escalón | Proveedor | Calidad en castellano | Por jugador y hora | Gratis al mes |
|---|---|---|---|---|
| **Gratis (por defecto)** | Voz del navegador | De mala a muy buena según el navegador. Lo mejor: las voces «Natural» de Edge | 0 | Todo |
| **Barato (implementado)** | Azure Neural | Muy buena: las mismas voces «Natural» de Edge | 0,18 $ | ~41 h |
| Barato (alternativa) | Google Chirp 3 HD | Muy buena | 0,36 $ | ~83 h |
| **Premium (implementado)** | ElevenLabs v3/v4 | La más expresiva | 0,96 $ (0,48 con Flash) | Muy poco |

Supuestos: una acción narrada son unos 600 caracteres y una hora de juego son 20 acciones. Cada jugador recibe su propia narración, así que el coste va por jugador.

- **Por qué Azure:** se activa con una clave, permite varias voces en una sola petición (narrador y NPC en un audio) y son las mismas voces que Edge da gratis.
- Se descartaron OpenAI (sus modelos de voz se retiran en enero de 2027) y los autoalojados (no caben en una máquina modesta o tienen licencia no comercial).
- El audio de la nube se guarda por partida: el mismo texto con las mismas voces no se vuelve a pedir.
- Si la nube falla, se sigue con la voz del navegador.

## El móvil en el bolsillo

| Voz | Con la pantalla apagada |
|---|---|
| Navegador en iOS | Se corta al bloquear |
| Navegador en Android | Termina la frase y se detiene |
| Navegador + «mantener la pantalla encendida» | Sigue leyendo, a costa de batería |
| Nube | Sigue sonando, con controles en la pantalla de bloqueo |

Lo que ningún navegador garantiza es **recibir narraciones nuevas** con el móvil bloqueado: llegan al desbloquear. Para jugar de verdad con el móvil en el bolsillo haría falta una app con sesión de audio o notificaciones push.

## El otro lado: dictar

- Junto al cuadro de texto hay un **micrófono** que usa el reconocimiento de voz del navegador. Sin coste.
- Limpia muletillas («eh», «vale») y entiende «barra look» o «tira los dados».
- Por defecto el texto se queda en el cuadro para revisarlo; se puede enviar solo al terminar.
- Funciona en Chrome, Edge y Safari. En Firefox no hay botón.

## Pendiente

- Probar Azure con una clave real.
- Medir la latencia real por narración.
- Pausar la lectura mientras se dicta.
- Estilos de voz por emoción si el máster marca el tono.

## Relacionado

- [[El narrador]] · [[Música y sonido]] · [[Interfaz]] · [[Prólogo]]
