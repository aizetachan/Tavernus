---
title: Dirección de arte
description: "Estilo, técnica, paleta y tono de las imágenes de Tavernus, qué imagen tiene cada entidad y cómo conviven el arte a mano y el generado."
tags: [diseño, arte]
---
> [!abstract] En corto
> Brezal es una aldea de fantasía medieval oscura a la sombra de una montaña quemada. Su arte es sombrío, frío y concreto: pintura digital de aspecto tradicional, clave baja y una sola luz cálida. Si hay una imagen hecha a mano, se usa esa; si no, se genera una vez y se guarda.

![[portada-taberna.jpg]]

## Dos fuentes de imágenes

| Fuente | Cuándo |
|---|---|
| **Arte a mano** | Para la demo de [[Brezal]]. Tiene prioridad: si existe, no se llama a ninguna IA |
| **Generada** | Si no hay arte a mano. Se pide una sola vez por entidad y se guarda |

- Así se puede subir arte poco a poco: lo que falta sigue saliendo generado.
- Las imágenes generadas usan un prompt corto y fijo y una semilla del mundo: **la misma escena da siempre la misma imagen**.
- Nunca se genera por turno: una imagen por entidad. La excepción es el **pincel**, que el jugador usa a propósito y tiene límite diario.

## Técnica

- **Pintura digital de aspecto tradicional** (gouache u óleo), pincelada visible.
- Sin línea de contorno. Sin aspecto 3D ni fotográfico.
- Detalle donde mira el jugador; el resto, masas.

## Luz y tono

- **Clave baja.** Sombras frías (azul pizarra, gris ceniza) y **una sola fuente cálida**: vela, brasas, farol, ocaso.
- Nada de cielos azules alegres ni colores saturados. Incluso de día: nublado y gris.
- Tiene que convivir con la web, que es «vidrio espacial»: paneles translúcidos sobre fondo casi negro con un acento ámbar. Ver [[Interfaz]].

## Paleta

| Uso | Color |
|---|---|
| Fondo, sombras profundas | `#07080b` · `#121318` |
| Ceniza, piedra, niebla | `#3a3d44` · `#6b6f78` · `#a9adb5` |
| Luz cálida (el acento) | `#e9a94e` · brillo `#f7c979` |
| Brasa, sangre, peligro (poco) | `#e05a4a` |
| Frío lejano: luna, magia (muy poco) | `#63d1ff` |
| Vegetación apagada | `#3f4a35` · `#5c6b4a` |

## Coherencia

- La **misma aldea** en todas las vistas: madera negra, piedra gris, tejados de pizarra. Nada de teja roja.
- El mismo fresno y el mismo roble en el bosque.
- La **montaña de Vharn siempre al norte** cuando se vea.

## Prohibido

- Texto, letras, firmas o marcas de agua dentro de la imagen (el pie lo pone la web).
- Marcos.
- Anacronismos: lámparas eléctricas, cristal moderno.
- Estilo anime o caricatura.
- **Arte generado por IA en el arte a mano**, aunque esté retocado.

## Qué imagen tiene cada entidad

| Tipo | Qué muestra | Medida |
|---|---|---|
| **Vista** de lugar | El sitio a la altura de los ojos, sin personajes en primer plano | 1024 × 576 |
| **Retrato** (NPC, narrador, PJ por raza) | Busto de frente o tres cuartos, fondo oscuro; funciona recortado en círculo | 512 × 512 |
| **Objeto** clave | El objeto solo, en una mano o sobre madera | 512 × 512 |
| **Descubrimiento** | El momento de una pista o un punto oculto, de cerca, con la luz sobre el hallazgo | 1024 × 576 |
| **Combate** (opcional) | La escena contra un NPC concreto | — |
| **Mapa de región** | Cenital o de cartógrafo, norte arriba. Solo aquí se permiten rótulos a mano | 2048 × 1536 |
| **Fondo de plano** (opcional) | Cenital y ortogonal; el suelo y lo fijo, no los muebles | Según el lugar |

Todo en JPEG.

![[retrato-narrador.jpg|300]]

*El retrato del narrador. Ver [[El narrador]].*

## Cuándo aparece cada imagen

- **Vista:** la primera vez que un personaje pisa un lugar. Cambia al moverse.
- **Charla:** la primera vez que hablas con un NPC, una imagen grande de él en su sitio, mirándote, como la del sitio o la del objeto. Su retrato ya no sale en el chat: solo es el avatar redondo junto a sus frases.
- **Objeto:** al cogerlo, comprarlo o examinarlo. Los servicios (la noche de posada) y lo que los datos marcan `illustrate: false` no se pintan.
- **Descubrimiento:** al encontrar un punto oculto o una pista. Se pinta lo hallado de cerca, y el sitio solo de fondo. Las pistas que se *oyen* (lo que cuenta un NPC) no dan descubrimiento, solo la imagen de la charla con quien habla.
- **Combate:** el primer golpe entre el personaje y un rival, o cuando alguien cae. El rival es siempre el otro, también cuando es el NPC quien golpea.
- **Avatar del personaje:** al crearlo, con su raza, clase y aspecto. Se pueden pedir otras versiones.
- **Pincel:** cuando el jugador lo pide.

> [!warning] Nada que destripe la partida
> El arte de la campaña no se sirve a cualquiera. Una vista del sótano o un plano con la trampilla destriparían el juego. Cada imagen se copia a la partida cuando el jugador llega a ella.

## Planos: datos, no dibujos

- Los planos del tablero **no son imágenes**: son datos (suelos, paredes, puertas, muebles) en metros.
- Cada mueble que corresponde a un punto lleva su id: pasar el ratón enseña el punto y clicar lleva allí.
- Lo que delataría un punto oculto se quita hasta que el personaje lo descubre.
- Si un lugar no tiene plano escrito, se genera desde sus puntos.

## Proveedores de la generada

- **Cloudflare Workers AI** (flux-1-schnell), con cuota gratuita diaria de unas 170 imágenes.
- **Pollinations** como respaldo, gratuito y con límite por IP.
- Se activa con una opción del servidor; apagado por defecto. No gasta tokens del máster.

## Licencia

- Solo obra propia o con licencia compatible (CC0 o CC BY 4.0).
- Cada fichero se apunta con autor, licencia y fecha.

> [!note] La imagen del menú
> La taberna vikinga al amanecer del menú se hizo con Nano Banana 2.1 en Magnific a partir de una referencia. Es parte del diseño de la interfaz, no del arte de la campaña.

## Relacionado

- [[Interfaz]] · [[Brezal]] · [[Brezal]] · [[Personajes]] · [[Taberna del Jabalí]]

## Ilustraciones de esta wiki

Las cabeceras de [[Brezal]], [[Vharn]], [[Historia]] y [[El máster IA]], y las fichas de [[Taberna del Jabalí]], [[Plaza del Pozo]] y [[Casa de las hierbas]], vienen del *making of* de Tavernus en Notion. Se generaron con Magnific (Seedream 5 Pro) siguiendo esta guía de arte. Las imágenes que dibuja el propio juego se ven en la sección «En el juego» de cada lugar.
