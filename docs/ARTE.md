# Arte de Brezal — guía de estilo y convención

El arte de la demo de Brezal está hecho por el equipo en Magnific con un estilo propio, **cartoon-realista**, y
elegido a mano: más calidad y más coherencia que lo que genera el juego en marcha. El motor ya lo sabe: **si hay un
activo escrito, se usa ese y no se llama a ninguna IA**; si no lo hay, se genera como siempre (Cloudflare o
Pollinations, `src/ai/illustrate.ts`). Lo que falta sigue saliendo generado.

Estado (2 de noviembre de 2026): está hecho todo el arte de Brezal salvo 14 fondos de plano (ver «Inventario»). El
registro de cada pieza, con su imagen, está en Notion: «Libro de Arte e Historia de Tavernus» → «Libro de Arte» →
«Registro de assets de Brezal».

## Dónde va cada cosa

```
assets/campaigns/brezal/
  manifest.json            id de entidad → fichero, y los planos como datos
  CREDITOS.md              autor y licencia de cada fichero
  vista/<loc_id>.jpg       vista de cada localización
  retrato/<npc_id>.jpg     retrato de cada NPC; master.jpg = el narrador
  retrato/pc-<raza>.jpg    retrato genérico de PJ por raza (opcional: pc-<raza>-<clase>.jpg)
  objeto/png/<item_id>.png objeto sin fondo (PNG transparente): el que usa el juego
  objeto/<item_id>.jpg     el mismo objeto sobre #121318 (copia, por si hace falta un JPEG)
  descubrimiento/<id>.jpg  una pista encontrada (clue_…) o un punto oculto (sp_…); las pistas oídas no
  combate/<npc_id>.jpg     escena de combate contra ese NPC (opcional)
  mapa/region.jpg          mapa de la región
  plano/<loc_id>.jpg       fondo pintado del plano (opcional)
assets/style-refs/         referencias de estilo para Magnific (no las usa el juego)
public/salvapantallas-N.jpg  las imágenes que rotan en la portada del menú (estas sí son públicas)
```

- Los ids son los de los datos de la campaña (`loc_…`, `npc_…`, `it_…`, `clue_…`, `sp_…`). Si Brezal escrito
  cambia o añade ids, se cambia el nombre del fichero y la línea del manifiesto, no al revés.
- **No va en `public/`**: lo de `public/` se sirve a cualquiera, y una vista del sótano o un plano con la
  trampilla destriparían la partida. El motor copia cada imagen a `data/games/<partida>/images/` cuando el
  jugador llega a ella, y desde ahí se sirve como las generadas (en la web, por `/images`).
- `manifest.json` ya lista todas las rutas esperadas: subir un fichero con ese nombre basta para que se use.
  Una ruta cuyo fichero no existe se ignora (se genera). Para otra campaña: otra carpeta con su manifiesto y su
  lista `campaigns` (los `campaign.id` a los que sirve; hoy `brezal` y `demo`).
- Las fuentes (originales a 2K, variantes) se quedan en Magnific, en el proyecto «TAVERNUS · Estudio de estilo»
  (carpetas Vistas, Retratos, Objetos, Objetos sin fondo, Descubrimientos, Mapa y combate, Salvapantallas épicos).
  En el repo solo el fichero final.
- Al abrir una partida ya empezada, el juego actualiza su caché de imágenes: lo que venía de un activo se vuelve a
  copiar (por si el arte cambió) y una vista, un retrato de NPC o un objeto que se generó antes de existir su activo
  pasa a ser el activo. Los combates, descubrimientos y retratos de PJ ya generados no cambian.

## Técnica y tono

Brezal es una aldea de fantasía medieval oscura que vive de espaldas a una montaña quemada. El arte tiene que
sentirse **sombrío, frío y concreto**, y convivir con una web casi negra con un único acento ámbar.

- **Técnica: cartoon-realista.** Render 3D hiperrealista con rasgos de caricatura sutilmente exagerados; cada
  personaje con su propia silueta (no copiar el cuerpo de la referencia); texturas de material reales (poros,
  óxido, madera, cuero); acabado de fotograma de cine. Nada de acabado Pixar/Disney ni de ilustración pintada.
- **Luz:** clave baja. Una sola fuente cálida ámbar (`#e9a94e`: vela, brasas, farol, ocaso), sombras azul pizarra y
  gris ceniza, paleta apagada. Nada de cielos azules alegres: incluso de día, nublado y gris.
- **Paleta** (la de la web):

  | Uso | Color |
  |---|---|
  | Fondo, sombras profundas | `#07080b` · `#121318` |
  | Ceniza, piedra, niebla | `#3a3d44` · `#6b6f78` · `#a9adb5` |
  | Luz cálida (el acento) | `#e9a94e` · brillo `#f7c979` |
  | Brasa, sangre, peligro (poco) | `#e05a4a` |
  | Frío lejano: luna, magia (muy poco) | `#63d1ff` |
  | Vegetación apagada | `#3f4a35` · `#5c6b4a` |

- **Prohibido:** texto, letras, firmas o marcas de agua dentro de la imagen (el pie lo pone la web; excepción, lo
  que forma parte de una pista, como las iniciales «T. M.» del hacha); marcos; anacronismos; acabado Pixar/Disney o
  de ilustración pintada; el sello de la brasa (Vharn) en objetos que no son de Vharn, porque se confunden con pistas.
- **Coherencia:** la misma aldea en todas las vistas (madera negra, piedra gris, tejados de pizarra, nada de
  teja roja), la niebla gris, el mismo fresno y roble en el bosque, y la montaña de Vharn siempre al norte.

## Cómo se hace (Magnific)

Modelo: Google **Nano Banana 2.1**, con las referencias de `assets/style-refs/` como imagen de referencia en cada
petición: personajes (Brenna, Doro, Ilse) para retratos y combates; escenarios (taberna, plaza, granero) para vistas y
descubrimientos; la llave de Vharn para los objetos. Retratos y objetos en 1:1; vistas, descubrimientos y combates en
16:9 a 2K y reescalados ×2 con Magnific Precision («sublime») hasta 2048 × 1152. Se elige a mano entre las variantes.

Plantillas (lo que va entre corchetes sale de los datos de la campaña):

- **Retrato:** «Take ONLY the rendering style from the reference images: cartoon-realistic hyperrealistic 3D
  render, physically real materials, photographic cinematic lighting (warm amber from the left, cool slate-blue
  shadows on the right), plain near-black background with soft vignette, subtly exaggerated caricature features. Do
  NOT copy the reference characters' bodies or faces. Character with [his/her/its] OWN exaggerated silhouette:
  [nombre, edad, complexión, rasgos, ropa, objeto en mano, expresión]. Real skin pores, [materiales]. NOT painterly,
  NOT glossy Pixar/Disney/DreamWorks look. Bust framing, head in the upper third, readable when cropped to a circle.
  No text.»
- **Vista:** «Take ONLY the rendering style from the reference images: cartoon-realistic 3D render with photographic
  cinematic lighting and subtly exaggerated caricature shapes, same world. Location: [lugar, interior/exterior],
  eye-level, no people: [elementos]. ULTRA HYPERREALISTIC MACRO-LEVEL TEXTURES: [materiales]. Physically based
  materials, 8K detail. [luz], muted palette. Keep 8% safe margin. NOT painterly, NOT smooth CGI, NOT Pixar look.
  No text.»
- **Descubrimiento:** «… Discovery close-up, no people: [el hallazgo]; light falls on [el hallazgo], [el sitio]
  softly blurred behind (shallow depth of field). ULTRA HYPERREALISTIC MACRO TEXTURES: [materiales]. [luz], muted
  palette. NOT painterly, NOT smooth CGI. No text.»
- **Combate:** «… Combat scene: a lone hooded adventurer seen from behind over the shoulder, [arma], facing [rival]
  in [lugar]. ULTRA HYPERREALISTIC TEXTURES: […]. [luz], muted palette. Keep 8% safe margin. NOT painterly, NOT
  Pixar look. No text.»
- **Objeto** (referencia: la llave): «Replace the key in the reference image with [objeto y materiales], keeping
  exactly the same style: hyperrealistic 3D render with chunky stylized proportions, physically real materials,
  same warm amber highlight and cool slate-blue fill, centered and filling about 70% of the frame, isolated on a
  plain flat pure white background, no table, no cast shadow, clean edges. No text.» Después se quita el fondo en
  Magnific (PNG transparente) y se recorta y centra a 512 × 512.

## Tamaños y formatos

JPEG (`.jpg`), sRGB, calidad 80–85, progresivo y sin metadatos; los objetos, en PNG transparente. El servidor
sirve JPEG para todo y PNG solo para objetos.

| Tipo | Medida | Peso máx. | Encuadre |
|---|---|---|---|
| Vista de localización | 2048 × 1152 (16:9) | 600 KB | El lugar a la altura de los ojos, sin personajes en primer plano (los NPC tienen su retrato). Deja un 8 % de margen: la web recorta y pone el pie abajo. Es también la portada de la partida en el menú, a pantalla completa. |
| Retrato (NPC, narrador, PJ) | 512 × 512 | 150 KB | Busto de frente o tres cuartos, cabeza en el tercio superior, fondo casi negro con viñeta. Que funcione recortado en círculo. |
| Objeto | 512 × 512, PNG transparente | 400 KB | El objeto solo, sin fondo, centrado y ocupando ~78 %. Se ve en el chat y en las casillas de la mochila. |
| Descubrimiento (pista) | 2048 × 1152 | 600 KB | El detalle que se descubre, de cerca, con la luz sobre el hallazgo. |
| Combate | 2048 × 1152 | 600 KB | El PJ de espaldas frente a su rival. |
| Mapa de región | 2048 × 1536 (4:3) | 1,5 MB | Vista cenital o de cartógrafo, norte arriba, con la montaña de Vharn al norte. Rótulos a mano permitidos solo aquí. |
| Salvapantallas del menú | 2560 × 1440 | 600 KB | Escenas épicas de la campaña. Rotan en la portada mientras no se elige partida. Van en `public/`: no deben destripar nada que importe. |
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

- Obra propia del proyecto (hecha en Magnific con este método y elegida a mano) o con licencia compatible (CC0 o
  CC BY 4.0). Nada de bancos de imágenes sin licencia.
- Cada fichero se apunta en `assets/campaigns/brezal/CREDITOS.md`: fichero, autor, herramienta, licencia y fecha.
  Lo propio se cede al proyecto Tavernus para usarlo en el juego y en su promoción.

## Cómo probarlo

1. Copia el fichero a su ruta (la del manifiesto) y arranca la web con `IMAGES=on`.
2. Empieza una partida de Brezal y llega al sitio, habla con el NPC o coge el objeto.
3. La imagen sale sin esperar a ninguna IA, y en `data/games/<partida>/images/index.json` aparece con
   `"provider": "written"`. Los objetos con imagen salen también en las casillas de la mochila, en cualquier partida.

En una partida ya empezada, el arte nuevo de vistas, retratos de NPC y objetos se toma al volver a abrirla (al
reiniciar el servidor). Los planos escritos se usan en cuanto se reinicia el servidor.

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

Brezal (`src/data/campaigns/brezal/`), 2 de noviembre de 2026. El detalle de cada pieza, con su imagen, en el
registro de Notion.

| Activo | Cuántos | Fichero | Estado |
|---|---|---|---|
| Vistas de localización | 12 | `vista/<loc_id>.jpg` | hechas (2048 × 1152) |
| Retratos de NPC y narrador | 15 | `retrato/<npc_id>.jpg` · `retrato/master.jpg` | hechos |
| Retratos de PJ por raza | 9 | `retrato/pc-<raza>.jpg` | hechos (son el avatar de base del PJ) |
| Objetos | 46 | `objeto/png/<item_id>.png` | hechos: todos los del juego salvo la noche de posada, que es un servicio |
| Descubrimientos | 8 | `descubrimiento/<id>.jpg` | hechos (las pistas oídas no llevan imagen) |
| Combates | 2 | `combate/npc_lobo.jpg` · `combate/npc_loba.jpg` | hechos |
| Mapa de la región | 1 | `mapa/region.jpg` | hecho (la web aún no lo enseña) |
| Salvapantallas del menú | 7 | `public/salvapantallas-N.jpg` | hechos |
| Fondos de plano | 19 | `plano/<loc_id>.jpg` | 5 hechos; faltan 14 (ver «Fondos pintados») |

Los iconos del tablero no hacen falta por ahora: el tablero dibuja muebles y fichas como vectores desde los
datos. Si se quieren pintados, es una issue aparte que también toca el dibujo del tablero.
