---
title: Música y sonido
description: "Ambientes grabados en bucle, efectos sintetizados que siguen a los eventos del juego y música en el menú, todo sin coste por acción."
tags: [diseño, sonido]
---
> [!abstract] En corto
> La partida suena al moverse. Cada lugar tiene su ambiente en bucle y cada evento dispara efectos cortos: pasos, puertas, monedas, dados, golpes. Los ambientes son grabaciones libres (CC0); los efectos se sintetizan en el navegador. La generación por IA está preparada pero apagada. El menú tiene su propia música.

## La idea

Al salir de la taberna se oyen pasos sobre madera, la puerta que se abre y se cierra y, después, el ambiente de la plaza.

| Capa | Ejemplos | Cómo es |
|---|---|---|
| **Efectos** | Pasos (madera, piedra, tierra, hierba, agua), puerta, moneda, coger y soltar, dado, espada, daño, curar, hacha, descubrir, campana | De 0,5 a 3 s, en secuencia |
| **Ambientes** | Taberna, herrería, interior tranquilo, plaza de día y de noche, bosque de día y de noche, agua, lluvia | En bucle sin costura, uno por lugar |

El catálogo es **genérico**: depende del suelo y del tipo de lugar, no del mundo. Unos 27 sonidos cubren cualquier mundo generado.

## Del evento al sonido

Una función pura traduce cada evento del actor en una secuencia corta de sonidos. Determinista y sin IA.

| Evento | Suena |
|---|---|
| Moverse | Pasos según el suelo; si cruzas a otro lugar, puerta y ambiente nuevo |
| Llegar | Pasos y ambiente del sitio |
| Coger, soltar, dar | Coger o soltar; moneda si es dinero |
| Tirar | Dado; en un ataque, golpe o fallo, y daño si el objetivo cae |
| Comprar, vender, cobrar | Moneda |
| Recolectar | Hacha |
| Descubrir | Descubrir |
| Mirar, hablar, esperar | Nada |

- **Suelo:** sale de los datos del lugar y, si no, de la descripción («losas», «empedrada», «prado»). Por defecto, interior es madera, poblado es piedra y campo es tierra.
- **Ambiente:** un interior animado es taberna; fuera, plaza o bosque, en versión de noche según la luz.
- **Puerta:** al pasar de interior a exterior, o si el punto es una puerta, portón o trampilla.

## Cómo suena

- **Ambientes grabados** de Freesound, con licencia CC0, de 35 a 60 s, en bucle sin costura e igualados de volumen.
- Suenan **bajos** por defecto, se funden 2,5 s al cambiar de sitio y **bajan mientras habla el narrador**.
- La lluvia no tiene grabación y suena con su receta sintetizada.
- **Efectos sintetizados** en el navegador: cero bytes, latencia nula, sin licencias. Funcionan mejor en lo mecánico (puerta, moneda, dado, metal, pasos, fuego) que en lo orgánico.
- Nada suena hasta el primer toque en la página.
- Botón **Sonido** en la cabecera del chat: silencio, volumen general y de ambiente, y los créditos de cada grabación.

## Música del menú

- El menú principal tiene un **tema propio en bucle**.
- Con botón de silencio que se recuerda.

## Opciones que se estudiaron

| Opción | Ventajas | Inconvenientes |
|---|---|---|
| Síntesis en el navegador | Gratis, inmediata, sin licencias | Suena sintético en lo orgánico |
| Bibliotecas libres (Kenney, Freesound) | Fiables, gratuitas, suenan bien | Hay que curar, recortar, hacer bucles y atribuir |
| IA (ElevenLabs, Stable Audio) | Sabor propio por mundo | Coste y latencia; licencias a revisar |

**Escalones de coste por mundo** (siempre generando una vez, nunca por acción):

| Escalón | Qué | Coste |
|---|---|---|
| Gratis (hecho) | Síntesis + grabaciones CC0 | 0 $ |
| Barato | ElevenLabs para todo el catálogo | ≈ 0,32-1 $ |
| Premium | ElevenLabs + Stable Audio, con escucha humana | ≈ 5-7 $ |

> [!info] IA de sonido: apagada
> El adaptador de IA está escrito pero desactivado en el código. No se llama a ninguna API aunque haya clave. Si se enciende, cada sonido se generaría una vez por partida y se reutilizaría.

## Pendiente

- Escuchar de verdad los sonidos sintetizados más débiles.
- Que los **testigos** oigan pasos y puertas con volumen según su banda de percepción.
- Ambientes en estéreo.

## Relacionado

- [[Narrador de voz]] · [[Interfaz]] · [[Taberna del Jabalí]]
