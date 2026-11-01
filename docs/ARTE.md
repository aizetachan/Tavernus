# Arte a mano — guía de estilo y convención

Para la demo de Brezal las imágenes y los planos los hace el equipo a mano: más calidad, más coherencia y
nada inventado por una IA. El motor ya lo sabe: **si hay un activo escrito, se usa ese y no se llama a
ninguna IA**; si no lo hay, se genera como siempre (Cloudflare o Pollinations, `src/ai/illustrate.ts`). Así se
puede ir subiendo arte poco a poco: lo que falta sigue saliendo generado.

El trabajo está repartido en issues de GitHub con las etiquetas `arte` y `brezal` (épica:
[#32](https://github.com/aizetachan/Tavernus/issues/32)). Cada issue dice qué
es, cómo es según los datos, el fichero exacto y cuándo está hecho.

## Dónde va cada cosa

```
assets/campaigns/brezal/
  manifest.json            id de entidad → fichero, y los planos como datos
  CREDITOS.md              autor y licencia de cada fichero
  vista/<loc_id>.jpg       vista de cada localización
  retrato/<npc_id>.jpg     retrato de cada NPC; master.jpg = el narrador
  retrato/pc-<raza>.jpg    retrato genérico de PJ por raza (opcional: pc-<raza>-<clase>.jpg)
  objeto/<item_id>.jpg     objeto clave en la mano
  descubrimiento/<id>.jpg  una pista encontrada (clue_…) o un punto oculto (sp_…); las pistas oídas no
  combate/<npc_id>.jpg     escena de combate contra ese NPC (opcional)
  mapa/region.jpg          mapa de la región
  plano/<loc_id>.jpg       fondo pintado del plano (opcional)
```

- Los ids son los de los datos de la campaña (`loc_…`, `npc_…`, `it_…`, `clue_…`, `sp_…`). Si Brezal escrito
  cambia o añade ids, se cambia el nombre del fichero y la línea del manifiesto, no al revés.
- **No va en `public/`**: lo de `public/` se sirve a cualquiera, y una vista del sótano o un plano con la
  trampilla destriparían la partida. El motor copia cada imagen a `data/games/<partida>/images/` cuando el
  jugador llega a ella, y desde ahí se sirve como las generadas (en la web, por `/images`).
- `manifest.json` ya lista todas las rutas esperadas: subir un fichero con ese nombre basta para que se use.
  Una ruta cuyo fichero no existe se ignora (se genera). Para otra campaña: otra carpeta con su manifiesto y su
  lista `campaigns` (los `campaign.id` a los que sirve; hoy `brezal` y `demo`).
- Las fuentes (PSD, KRA, PNG grandes) no van al repositorio: en la carpeta compartida del equipo, enlazadas
  desde la issue. En el repo solo el fichero final.

## Técnica y tono

Brezal es una aldea de fantasía medieval oscura que vive de espaldas a una montaña quemada. El arte tiene que
sentirse **sombrío, frío y concreto**, y convivir con la web, que es «vidrio espacial»: paneles translúcidos
sobre un fondo casi negro, con un único acento ámbar.

- **Técnica:** pintura digital de aspecto tradicional (gouache u óleo), pincelada visible, sin línea de
  contorno, sin aspecto 3D ni fotográfico. Detalle donde mira el jugador; el resto, masas.
- **Luz:** clave baja. Sombras frías (azul pizarra, gris ceniza) y una sola fuente cálida (vela, brasas,
  farol, ocaso). Nada de cielos azules alegres ni colores saturados: incluso de día, nublado y gris.
- **Paleta** (la de la web):

  | Uso | Color |
  |---|---|
  | Fondo, sombras profundas | `#07080b` · `#121318` |
  | Ceniza, piedra, niebla | `#3a3d44` · `#6b6f78` · `#a9adb5` |
  | Luz cálida (el acento) | `#e9a94e` · brillo `#f7c979` |
  | Brasa, sangre, peligro (poco) | `#e05a4a` |
  | Frío lejano: luna, magia (muy poco) | `#63d1ff` |
  | Vegetación apagada | `#3f4a35` · `#5c6b4a` |

- **Prohibido:** texto, letras, firmas o marcas de agua dentro de la imagen (el pie lo pone la web); marcos;
  anacronismos (lámparas eléctricas, cristal moderno); estilo anime o caricatura; arte generado por IA,
  aunque sea retocado. **Excepción:** los fondos de plano, que se generan a partir de la referencia exacta del plano
  (ver «Fondos pintados»).
- **Coherencia:** la misma aldea en todas las vistas (madera negra, piedra gris, tejados de pizarra, nada de
  teja roja), el mismo fresno y roble en el bosque, y la montaña de Vharn siempre al norte cuando se vea.

## Tamaños y formatos

Todo en **JPEG** (`.jpg`), sRGB, calidad 80–85, progresivo y sin metadatos. Hoy el servidor solo sirve JPEG;
WebP queda para cuando el servidor lo admita.

| Tipo | Medida | Peso máx. | Encuadre |
|---|---|---|---|
| Vista de localización | 1024 × 576 (16:9) | 350 KB | Vista del lugar a la altura de los ojos, sin personajes en primer plano (los NPC tienen su retrato). Deja un 8 % de margen: la web recorta y pone el pie abajo. |
| Retrato (NPC, narrador, PJ) | 512 × 512 | 150 KB | Busto de frente o tres cuartos, cabeza en el tercio superior, fondo oscuro liso con viñeta. Que funcione recortado en círculo. |
| Objeto | 512 × 512 | 120 KB | El objeto solo, sostenido en una mano o sobre madera, centrado y ocupando ~70 %, fondo oscuro. |
| Descubrimiento (pista) | 1024 × 576 | 350 KB | El detalle que se descubre, de cerca, con la luz sobre el hallazgo. |
| Mapa de región | 2048 × 1536 (4:3) | 1,5 MB | Vista cenital o de cartógrafo, norte arriba, con la montaña de Vharn al norte. Rótulos a mano permitidos solo aquí. |
| Fondo de plano (opcional) | 40 px por metro de `bounds`, máx. 2048 px de lado (la medida exacta la da `scripts/plans.ts reference`) | 800 KB | Cenital, ortogonal, sin perspectiva. Suelo, paredes y muebles en el mismo sitio que en el plano escrito; lo oculto no. |

## Qué pinta cada momento generado

Sin activo escrito, el motor decide qué merece imagen (`src/engine/moments.ts`) y el ilustrador escribe el
prompt desde los datos (`entityOf` en `src/ai/illustrate.ts`), nunca desde la narración del turno:

- **Descubrimiento:** lo hallado de cerca y en primer plano; el sitio va al final, como fondo desenfocado
  («Close-up of …. blurred background: Plaza del Pozo (exterior)»). Si empezara por el sitio, el modelo
  volvería a pintar la vista del lugar.
  - Un punto oculto se pinta con su nombre y su descripción.
  - Una pista se pinta con lo que dice su campo `image` en los datos («un cubo de madera con agua turbia y un
    poso de ceniza gris…»). Si no lo tiene, con su título.
  - **Pistas oídas:** si llega mientras el PJ habla con un NPC (lo que cuenta Ilse o Hugo), no hay
    descubrimiento, solo el retrato de quien habla si aún no lo tenía. Una pista con `image` es algo que se ve
    y sigue siendo hallazgo aunque llegue hablando.
- **Combate:** «el PJ contra su rival», y el rival es siempre el otro. Cuando un NPC golpea al PJ, el rival es
  quien golpea, y la pareja comparte imagen: el primer golpe entre los dos da una sola, lo dé quien lo dé. Si el
  PJ recibe daño sin nadie que se lo haga (una trampa), no hay escena de combate.
- **Objeto en la mano:** los servicios (`service`, la noche de posada) no se pintan. Para apagar un consumible
  abstracto (una ronda) basta con `illustrate: false` en su `ItemDef`; `illustrate: true` enciende un servicio
  que sí tenga sentido pintar. No hay listas en el código.

## Planos: datos, no dibujos

Los planos del tablero no se dibujan en código ni se sustituyen por una imagen: son **datos `LocationMap`**
(`src/data/seed/maps.ts`) en `manifest.json`, bajo `"maps": { "<loc_id>": { … } }`. Si una localización tiene
plano escrito, el tablero usa ese; si no, lo genera `src/adapters/web/mapgen.ts`.

- Coordenadas en metros, las mismas que los puntos (`x`, `y` de cada `sp_…`), con +y hacia el norte.
  `cell_m: 1.5` (una casilla de 5 pies).
- `bounds` es el rectángulo que se ve; `background` el suelo de fuera (`void` en interiores).
- `areas` (suelos: `wood`, `stone`, `cobble`, `grass`, `dirt`, `water`), `walls`, `doors` y `props` del
  catálogo (`table`, `counter`, `fireplace`, `well`, `notice`, `tree`, `rock`…). Cada mueble que corresponde a
  un punto lleva su `spot_id`: pasar el ratón enseña el punto y clicar lleva allí.
- Nada encima de un punto ni en el camino recto entre dos puntos, ni entre un punto y su salida.
- Lo que delataría un punto oculto (la trampilla, la habitación de arriba) lleva `requires_spot` con el id del
  punto: el tablero lo quita hasta que ese PJ lo descubre.
- Para empezar, copiar el plano generado de la localización (en la web, o con `generateMap(mapInputOf(…))`) y
  corregirlo: es más rápido que partir de cero.

## Licencia y atribución

- Solo obra propia o con licencia compatible (CC0 o CC BY 4.0). Nada de bancos de imágenes sin licencia, nada
  de IA generativa.
- Cada fichero se apunta en `assets/campaigns/brezal/CREDITOS.md`: fichero, autor, licencia y fecha. Lo propio
  se cede al proyecto Tavernus para usarlo en el juego y en su promoción.
- La issue se cierra con el fichero en su ruta, la línea en `CREDITOS.md` y la captura del juego.

## Cómo probarlo

1. Copia el fichero a su ruta (la del manifiesto) y arranca la web con `IMAGES=on`.
2. Empieza una partida nueva de la demo y llega al sitio, habla con el NPC o coge el objeto.
3. La imagen sale sin esperar a ninguna IA, y en `data/games/<partida>/images/index.json` aparece con
   `"provider": "written"`.

En una partida ya empezada la imagen generada antes sigue en caché hasta que se vuelva a pedir; para verla al
momento, borra `data/games/<partida>/images/`. Los planos escritos se usan en cuanto se reinicia el servidor.

Lo que aún no hace la web (issue aparte): pintar el mapa de región (`region_map`) en la vista de región.

## Fondos pintados

Un plano escrito puede llevar debajo una imagen realista (`map_backgrounds`), hecha a partir del propio plano para
que cada mueble, puerta y pared caiga justo en su punto y la cuadrícula encaje.

Estado en Brezal sellada (26 de octubre de 2026): 19 planos congelados (12 lugares, contando el Camino de Valcruz, que
está sellado tras el Cerco, y 7 tramos de camino). Tienen fondo pintado la taberna, el sótano, la herrería, la casa de
las hierbas y el tramo plaza–molino. El resto perdió el fondo al cambiar sus puntos con Brezal sellada, o es nuevo:
plaza, casona, molino, El Soto, el Granero Quemado, Los Corrales, El Lindero y los tramos plaza–Soto, molino–Soto,
plaza–Corrales, plaza–Lindero, Corrales–Soto y Soto–Granero. Hasta que se pinten, el tablero dibuja su plano como
antes.

Los tramos de camino (`loc_way_<salida>`, src/engine/travel.ts) los crea el motor cuando un encuentro corta un viaje,
a mitad de una salida de al menos 100 m entre dos localizaciones (no bloqueada). Son siempre los mismos y salen siempre
iguales, así que `scripts/plans.ts` los crea igual que el motor y los congela y pinta con los demás.

Si cambian los datos de la campaña: `node --import tsx scripts/plans.ts freeze brezal --sync` deja igual lo que no ha
cambiado (con su fondo), vuelve a congelar lo cambiado y le quita el fondo, que ya no encajaría, y quita lo que ya no
existe. Después, `reference` y repintar lo que no tenga fondo.

1. **Congelar los planos:** `node --import tsx scripts/plans.ts freeze <campaña>` copia al manifiesto (`maps`) el
   plano que hoy genera `mapgen.ts`. Sus `bounds` ya incluyen lo oculto y todos los puntos: el tablero no crece al
   descubrir algo y el fondo no se mueve. Si la carpeta sirve a otra campaña con los mismos ids y otros puntos (la
   demo), `plan_campaigns` dice a cuál valen los planos y los fondos.
2. **Sacar las referencias:** `node --import tsx scripts/plans.ts reference <campaña>` deja en
   `plano/referencia/` dos PNG por localización, a la medida exacta del fondo: `<loc>.png` (suelo liso, paredes,
   puertas y muebles; sin cuadrícula, fichas ni lo oculto) y `<loc>-guia.png` (lo mismo con cada punto y su
   nombre; lo oculto, en rojo).
3. **Generar:** en Magnific, Nano Banana 2.1 con ancho y alto exactos de la referencia, la referencia como imagen
   y `public/taberna.jpg` como estilo. El texto pide vista cenital ortogonal, cada elemento en la misma posición,
   tamaño y forma, materiales del sitio, la paleta oscura con acento ámbar, y nada de texto, cuadrícula ni personas.
4. **Comprobar:** superponer `<loc>-guia.png` al 45 % sobre la imagen. Si algo de un punto se ha movido (la fragua,
   el hogar), se repite esa localización.
5. **Guardar:** JPEG en `plano/<loc>.jpg` (bajar la calidad hasta quedar por debajo de 800 KB) y la línea en
   `map_backgrounds`.

En el tablero el fondo va bajo la cuadrícula y las fichas. Los suelos, paredes y muebles dibujados dejan de verse,
pero los muebles siguen ahí, invisibles, para pasar el ratón y clicar. Lo oculto (la trampilla, el desván) no
está pintado: se dibuja encima cuando el PJ lo descubre. El fondo lleva todos los muebles desde el principio,
también los de puntos que el PJ aún no ha visitado.

## Inventario

Hoy, de la demo (`src/data/seed/demo.ts`). **Cuando aterrice Brezal escrito** (`docs/BREZAL.md`,
`src/data/campaigns/brezal/`, unas 8 localizaciones y 10–12 NPC) se amplía esta lista, el manifiesto y las
issues con sus localizaciones, NPC, objetos y pistas.

| Activo | Tipo | Fichero | Issue |
|---|---|---|---|
| Taberna del Jabalí | vista | `vista/loc_taberna.jpg` | [#33](https://github.com/aizetachan/Tavernus/issues/33) |
| Plaza del Pozo | vista | `vista/loc_plaza.jpg` | [#34](https://github.com/aizetachan/Tavernus/issues/34) |
| Claro del Roble | vista | `vista/loc_claro.jpg` | [#35](https://github.com/aizetachan/Tavernus/issues/35) |
| Brenna, la tabernera | retrato | `retrato/npc_brenna.jpg` | [#36](https://github.com/aizetachan/Tavernus/issues/36) |
| Doro, el guardia | retrato | `retrato/npc_doro.jpg` | [#37](https://github.com/aizetachan/Tavernus/issues/37) |
| El lobo gris | retrato | `retrato/npc_lobo.jpg` | [#38](https://github.com/aizetachan/Tavernus/issues/38) |
| Combate contra el lobo (opcional) | combate | `combate/npc_lobo.jpg` | [#38](https://github.com/aizetachan/Tavernus/issues/38) |
| El Narrador | retrato | `retrato/master.jpg` | [#39](https://github.com/aizetachan/Tavernus/issues/39) |
| PJ por raza (9) | retrato | `retrato/pc-<raza>.jpg` | [#40](https://github.com/aizetachan/Tavernus/issues/40) |
| Cofre, hacha, llave de Vharn | objeto | `objeto/<item_id>.jpg` | [#41](https://github.com/aizetachan/Tavernus/issues/41) |
| Las cinco pistas | descubrimiento | `descubrimiento/<clue_id>.jpg` | [#42](https://github.com/aizetachan/Tavernus/issues/42) |
| Valle de Vharn | mapa | `mapa/region.jpg` | [#43](https://github.com/aizetachan/Tavernus/issues/43) |
| Planos de taberna, plaza y claro | plano | `manifest.json` → `maps` | [#44](https://github.com/aizetachan/Tavernus/issues/44) |

Los iconos del tablero no hacen falta por ahora: el tablero dibuja muebles y fichas como vectores desde los
datos. Si se quieren pintados, es una issue aparte que también toca el dibujo del tablero.
