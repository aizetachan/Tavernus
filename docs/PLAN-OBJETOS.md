# Plan: objetos con reglas de D&D, tienda en Brezal, lo que lleva cada personaje y dónde se guarda el mundo

Propuesta del 2026-11-06, aprobada el mismo día (respuestas en §10); cada bloque va en su sesión. No hay nada implementado de lo que sigue; lo
ya hecho (el ajuar de los NPC) está en SPEC §5.3.1.

## 0. Resumen

| Bloque | Qué | Tamaño | Recomendación |
|---|---|---|---|
| A | Modelo de objetos 5e: categorías, propiedades, rareza, sintonización, bonos mágicos, identificar, cargas, munición, pergaminos | M | Sí. Se amplía `ItemDef`, no se rehace |
| B | Catálogo SRD completo, fuera de `demo.ts`, con versión | M | Sí, antes que C |
| C | Las reglas en el motor: ataque, CA, competencia, sintonizar, pergaminos, munición, pociones | L | Sí, por partes |
| D | Monedas reales: el dinero del PJ en su bolsa, no como número suelto | M | Sí, pero después de C |
| E | Un buhonero con tienda en Brezal: existencias reales, horario, trastienda con llave | M | Sí. Es lo más visible y se puede hacer pronto |
| F | Lo que lleva cada personaje: PJ por clase y trasfondo, NPC por ajuar y por historia, mundos generados | S | Sí, con D |
| G | Persistencia: el mundo de cada partida en PostgreSQL | M | Sí, pero en una sola base con JSONB, no una base por mundo ni tablas por campo. Antes, dos arreglos baratos del JSON |

Orden propuesto: **G0 (arreglos del JSON) → B → A → E → C → D + F → G**. E puede ir antes que C porque una tienda
no necesita objetos mágicos.

Todo se prueba sin API (tests con máster falso). Al final de E y de C, una partida automática con Haiku que lanza
Miguel (sección 9).

---

## 1. Punto de partida

- **Dos piezas:** `ItemDef` (qué es un objeto) e `ItemInstance` (un ejemplar: cantidad, dónde está, `state`).
  Un ejemplar está siempre en un solo sitio: el suelo de un punto, un PJ (mano, bolsillo, equipado), un NPC, un
  contenedor o un vehículo.
- **Tipos:** `weapon`, `armor`, `consumable`, `tool`, `quest`, `treasure`, `misc`, `container`. Propiedades:
  `weapon` (daño, tipo, sutil, a distancia, a dos manos), `armor` (CA base, tope de DES, desventaja en Sigilo),
  `shield_bonus`, `heals`, `container`, `equip_slot`, `light_source`, `service`, tamaño, peso, valor en cobre.
- **Catálogo:** unas 35 definiciones en `src/data/seed/demo.ts` (la semilla vieja), que reutilizan Brezal y el
  generador (`CATALOG` en `worldgen/fill.ts`). Más los objetos de la historia de Brezal y los del ajuar.
- **Dinero:** `Character.coins`, un número en cobre. Pesa (50 monedas, 1 lb) pero no es un objeto. Los NPC lo
  llevan en su bolsa (`state.coins`), que pasa al número del PJ al cogerla.
- **Comercio:** `Npc.sells` y `Npc.buys` con precios. Comprar crea el objeto de la nada (`spawnItem`). Si el NPC
  lleva ese objeto encima, se lo descuenta. Es decir, las existencias son infinitas salvo lo que lleva encima.
- **Reglas que faltan:** rareza, sintonización, bonos mágicos, identificar, cargas, pergaminos, munición que se
  gasta, competencia por categoría de arma y armadura, propiedades de arma (ligera, pesada, alcance, arrojadiza,
  versátil, recarga), fuerza mínima de la armadura pesada. SPEC §5.1 nombra rareza, sintonización y efectos
  mágicos, pero no están hechos.
- **Persistencia** (sección 8): cada partida es una carpeta con `<id>.world.json` (el mundo entero) y
  `<id>.events.jsonl` (el registro). PostgreSQL ya existe, pero solo para la plataforma (usuarios, partidas,
  asientos, biblioteca).

---

## 2. Bloque A: el modelo de objetos 5e

Se amplía `ItemDef` con bloques opcionales, como ya se hace con `weapon` y `armor`. Nada obliga a rellenarlos:
una campaña con objetos sencillos sigue igual.

### 2.1 Categorías

`type` pasa a ser la categoría de reglas, y una `subtype` opcional afina:

| `type` | `subtype` | Ejemplos |
|---|---|---|
| `weapon` | `simple_melee`, `simple_ranged`, `martial_melee`, `martial_ranged` | daga, maza, espada larga, ballesta |
| `armor` | `light`, `medium`, `heavy`, `shield` | cuero, cota de escamas, cota de malla, escudo |
| `ammunition` | `arrow`, `bolt`, `bullet`, `needle` | flechas, virotes |
| `gear` | `adventuring`, `clothes`, `light`, `container` | cuerda, antorcha, farol, mochila, ropa de viaje |
| `tool` | `artisan`, `kit`, `gaming`, `instrument`, `vehicle` | herramientas de herrero, de ladrón, de herbolario, dados, laúd |
| `focus` | `arcane`, `druidic`, `holy` | orbe, rama de muérdago, símbolo sagrado |
| `consumable` | `food`, `drink`, `potion`, `poison`, `oil` | ración, cerveza, poción de curación, veneno |
| `scroll` | | pergamino de conjuro |
| `wand`, `rod`, `staff` | | varita de proyectiles mágicos |
| `ring`, `wondrous` | | anillo de protección, capa élfica |
| `treasure` | `gem`, `art`, `trade` | gema, cáliz de plata, saco de trigo |
| `coin` | | moneda de oro (bloque D) |
| `quest` | | lo que la historia necesita: cartas, llaves, pruebas |
| `container` | | se queda para cofres fijos y bultos |

Migración: cada definición vieja recibe su tipo nuevo desde el catálogo (bloque B). `misc` se mantiene para lo
que no es nada de lo anterior.

### 2.2 Propiedades nuevas de `ItemDef`

- **Armas:** `properties` (`light`, `heavy`, `finesse`, `thrown`, `two_handed`, `versatile`, `reach`, `loading`,
  `ammunition`), `range: [normal, largo]` en pies, `versatile_damage`, `ammo_type`.
- **Armaduras:** `category`, `str_min`, y el tiempo de ponerse y quitarse, que ya pide la narración.
- **Magia:** `rarity` (`common`, `uncommon`, `rare`, `very_rare`, `legendary`, `artifact`); `attunement`
  (`false`, `true` o una condición, por ejemplo «lanzador de conjuros» o una lista de clases); `bonus` (`attack`,
  `damage`, `ac`, `save_dc`, `spell_attack`: el +1, +2 o +3); `charges` (`max`, `recharge`: «1d6+1 al alba»);
  `effects`: lista de efectos con estructura (`resist: 'fire'`, `advantage: 'stealth'`, `speed: +10`,
  `condition_immunity: 'charmed'`, `light: 20`). El máster no aplica los efectos: los aplica el motor y él los
  narra.
- **Pergaminos y varitas:** `spell: { spell_id, level }`, con el conjuro del catálogo SRD que ya existe
  (`src/data/srd/spells.ts`).
- **Pociones:** `heals` se queda; se añade `effect` con un efecto de la lista y `duration_s`.
- **Maldición:** `cursed: true` y su efecto. No se puede quitar ni dejar de sintonizar.

### 2.3 Estado por ejemplar (`ItemInstance.state`)

Lo que cambia en la partida va en el ejemplar, no en la definición:

- `identified_by: Id[]`: quién sabe qué es. El máster recibe «objeto mágico sin identificar» para los demás.
- `attuned_to: Id | null`.
- `charges: number`.
- `coins: number`: ya existe (bolsas).
- `lit`: ya existe (antorchas).
- `owner_id`: de quién es, para tiendas y robos (bloque E).

---

## 3. Bloque B: el catálogo SRD completo

- **Un módulo de contenido:** `src/data/srd/items.ts`, con todo el equipo del SRD 5.1 (licencia CC BY 4.0, ya
  usada para razas, clases y conjuros): 37 armas, 12 armaduras y el escudo, munición, unos 100 objetos de
  equipo, herramientas, focos, monturas y mercancías. De magia, un primer lote pequeño: pociones de curación (4),
  pergamino de conjuro (por nivel), arma +1/+2/+3, armadura +1/+2/+3, munición +1, anillo de protección, capa de
  protección, bolsa de contención, varita de proyectiles mágicos, botas élficas y capa élfica. Solo lo del SRD:
  nada de otros libros.
- **Nombres en castellano** con alias en inglés (como ahora), precios en cobre con la escala de Brezal
  (`money.ts`).
- **`demo.ts` deja de ser el catálogo:** `CATALOG` sale de `items.ts`. `demo.ts` solo coloca objetos.
- **Versión del catálogo:** `campaign.catalog_version`. Al arrancar, `migrate` actualiza las definiciones SRD de
  la partida a la versión del código (ya hace algo parecido con `weapon` y la capacidad de la mochila). Las
  definiciones propias de la campaña (`origin: 'custom'`) no se tocan.
- **No se copia el catálogo entero en cada mundo** (ahora cada partida guarda todas sus definiciones): la partida
  guarda las que usa más las propias, y el resto se lee del código. Un catálogo de 250 objetos dentro de cada
  partida serían unos 75 KB más por mundo sin necesidad.
- **Mundos generados:** el generador elige del catálogo por género. La fantasía usa el SRD tal cual. La ciencia
  ficción y el postapocalíptico reciben su variante de nombre, como ya hace el ajuar, con las mismas reglas
  (una pistola de rayos usa el bloque de una ballesta ligera).
- **Arte:** los objetos se pintan solos la primera vez que se ven (`illustrate`). Más catálogo no es más gasto
  hasta que alguien lo coge o lo examina.

---

## 4. Bloque C: las reglas en el motor

Por partes, cada una con sus tests:

1. **Competencia con armas y armaduras.** Clase y raza dan competencias por categoría (`simple`, `martial`,
   `light`…). Sin competencia, no se suma el bono al ataque; con armadura sin competencia, desventaja en FUE y DES
   y sin conjuros (SRD). Hoy el ataque suma siempre el bono de competencia.
2. **Propiedades de arma:** versátil a dos manos, arrojadiza con su alcance, alcance de 10 pies, pesada con
   desventaja para pequeños, recarga, ligera para el ataque con la otra mano.
3. **Munición:** cada disparo gasta una; tras el combate se recupera la mitad (SRD). Sin munición, no hay disparo.
   Hoy las flechas no se gastan.
4. **Fuerza mínima de la armadura pesada:** −10 pies de velocidad si no llega.
5. **Bonos mágicos:** `bonus.attack` y `bonus.damage` en la tirada; `bonus.ac` en `armorClass`; `save_dc` y
   `spell_attack` en los conjuros.
6. **Sintonización:** tool `attune_item` (descanso corto tocando el objeto; un máximo de 3 objetos). Sin sintonizar,
   el objeto que la pide no da nada. Se ve en la ficha.
7. **Identificar:** en un descanso corto tocándolo, o con el conjuro *identificar*. Hasta entonces el máster solo
   ve «sin identificar» (como ya pasa con el saber por confianza).
8. **Pergaminos:** tool `use_scroll`. Si el conjuro es de tu lista y de un nivel que puedes lanzar, se lanza sin
   componentes y el pergamino se gasta. Si es de nivel mayor, prueba de la característica de lanzamiento con CD
   10 + nivel del conjuro. Si no es de tu lista, no puedes. CD y bono de ataque, los de la tabla del pergamino.
   Copiar un pergamino al libro de conjuros (mago): 2 horas y 50 po por nivel.
9. **Cargas:** las varitas gastan cargas y se recargan al alba; a 0, el SRD tira 1d20 y con un 1 se destruye.
10. **Pociones y efectos:** `use_item` (ya existe para curar) aplica `effect` con `add_condition` y su duración.
11. **El máster ve las reglas, no las inventa:** `get_item` y la ficha devuelven rareza, sintonización, cargas y
    efectos; el cierre rechaza narrar un efecto mágico que el motor no ha aplicado (como ya rechaza monedas o robos
    solo de palabra).

---

## 5. Bloque D: monedas de verdad

Hoy el dinero de un PJ es un número que nadie le puede quitar. Propuesta: **el dinero vive en bolsas**, como el
de los NPC.

- Todo PJ empieza con una bolsa al cinto con su dinero (`state.coins`). Puede llevar más de una (una escondida en
  la mochila).
- `Character.coins` deja de guardarse y se calcula: la suma de las bolsas que lleva. Pagar saca de la bolsa más a
  mano; cobrar mete en ella. Unas 40 líneas en 17 ficheros leen o escriben `c.coins`: pasan a tres funciones de
  `money.ts` (`coinsOf`, `pay`, `receive`).
- Así se puede: robar a un PJ (un NPC carterista, otro jugador con su consentimiento o sin él), perder la bolsa al
  morir (ya cae al suelo con el cuerpo), esconder dinero, y robar **parte** del dinero de una bolsa con un tool
  nuevo `take_coins` (hoy solo se roba la bolsa entera).
- Denominaciones: se guarda el total en cobre y se enseña con las monedas de la campaña (`money.ts`, como ahora).
  Las cinco del SRD (cobre, plata, electro, oro, platino) son opcionales por campaña.
- **Alternativa que no recomiendo:** monedas como pilas de objetos por metal (`it_moneda_oro ×15`). Es más fiel,
  pero cada pago tendría que dar el cambio entre pilas y pesar cada una, para lo mismo que ya da el total en cobre.

---

## 6. Bloque E: el buhonero de Brezal y su tienda

### 6.1 En la historia

Encaja con lo que ya dice la vida del pueblo: el mercado tiene «buhoneros que la niebla dejó dentro, con cestas
cada vez más vacías». Uno de ellos se ha quedado con una casa vacía de la plaza y la ha abierto como tienda.

- **El NPC** (nombre y carácter originales, a decidir con Miguel): un buhonero de fuera atrapado por el Cerco,
  que vende lo que traía y compra lo que le sirva para salir. Bloque SRD de plebeyo, `noncombatant`, ajuar de
  mercader (bolsa con dinero acomodado, libreta, manojo de llaves). Su manojo abre de verdad la trastienda.
- **El lugar:** «la tienda del buhonero», un local en un lado de la plaza, con sus puntos: la puerta, el mostrador,
  los estantes, la trastienda (cerrada con llave) y el carro en la puerta. Coordenadas y tags en `map.ts`, como el
  resto, y el plano sale de mapgen. Ilustración del lugar para `docs/ARTE.md`.
- **Horario:** abre de 9:00 a 19:00 (rutina); de noche duerme en la trastienda.
- **Lo que vende:** equipo de aventurero del SRD con existencias contadas: cuerda, antorchas, aceite, farol, saco,
  odre, ganchos, tiza, raciones, una o dos herramientas, un arma sencilla y, guardado en la trastienda, algo caro
  (una poción de curación, un pergamino de conjuro de nivel 1). Precios en la escala de Brezal.
- **Lo que compra:** pieles, objetos de valor, y casi cualquier cosa a la mitad de su precio, **con el dinero de
  su bolsa**. Si no le llega, no compra o paga en especie.
- **Escasez:** no repone desde fuera, porque el valle está sellado. Repone poco y solo con lo que le venden los
  vecinos y los PJ. Así las existencias se acaban, como dice la historia.
- **Ley:** los estantes son suyos (`law.owners`). Coger algo sin pagar es un robo, con sus testigos y con Garrán.
- **Gancho opcional:** le falta algo para salir del valle y paga por ello. Encaja como encargo del tablón. No es
  imprescindible para la primera versión.

### 6.2 La mecánica, para cualquier campaña

- **`Npc.shop`:** `{ location_id, stock_spot_ids, restock: 'none' | 'daily', restock_max? }`. Las existencias son
  ejemplares de verdad en contenedores fijos («estantes») de esos puntos, con `owner_id`.
- **Comprar a un NPC con tienda saca de sus existencias** y no crea nada; si no queda, «no le queda». Un NPC sin
  `shop` sigue como ahora.
- **Vender a un NPC con tienda:** el objeto pasa a sus estantes, y el pago sale de su bolsa.
- **Mundos generados:** los papeles `merchant`, `fishmonger`, `innkeeper` y los lugares `market` y `scrap_market`
  reciben tienda y existencias del catálogo según su oficio. Sin texto escrito a mano.
- **Una vista de tienda en la web:** al estar en la tienda, la lista de lo que hay, con precio y un botón de
  comprar que va por el atajo determinista, sin pasar por el máster. Comprar una cuerda no gasta tokens. El
  regateo sí va al máster (Persuasión).

---

## 7. Bloque F: lo que lleva cada personaje

- **PJ:** el equipo de su clase, como ahora, más **el de su trasfondo** (SRD: el soldado lleva su insignia y un
  juego de dados; el acólito, su símbolo sagrado y su libro de oraciones…), más su bolsa con el dinero (bloque D) y
  ropa de viaje. Se ve en el paso «resumen» de la creación.
- **NPC de Brezal:** el ajuar actual más lo que la historia nombra y hoy es solo ambiente: la jarra con muesca de
  Brenna, el guante con el ascua de Ysolde, la cuerda trenzada de Úrsula, el martillo del hijo del maestro de Hugo
  (en la fragua, no encima), las botas nuevas de Doro y los anillos de Osric. Revisado con Miguel uno por uno, porque
  algunos son pistas.
- **Ropa:** un objeto «ropa» equipado en el cuerpo de cada NPC, sin peso de reglas, para que se pueda describir,
  manchar o quitar. Opcional.
- **Mundos generados:** la parte «gente» del generador puede pedir un objeto propio por NPC (nombre y frase),
  validado como objeto `custom` de tipo `misc` o `treasure`. Ojo con el límite del esquema de esa parte
  (`MAX_PART_SCHEMA_CHARS`, 1800 caracteres). Offline sale del ajuar.
- **NPC de relleno** (la otra sesión): llevan `kit` y `wealth` desde su plantilla y el ajuar les da lo suyo. Los
  niños, sin bolsa: hace falta un campo `purse: false` en el ajuar.
- **Una página «Lleva encima» generada:** en la wiki, la tabla de cada personaje sale de los datos (`npm run
  wiki`), no escrita a mano, para que no se desfase.

---

## 8. Bloque G: dónde se guarda el mundo

### 8.1 Cómo es hoy, con números

- El motor tiene el mundo entero en memoria y es la fuente de verdad (SPEC §14.2.5). La persistencia solo escribe y
  carga al arrancar. Las consultas del juego nunca van a disco.
- Cada partida: `<id>.world.json` con el mundo entero, `<id>.events.jsonl` con el registro y
  `<id>.tickers.json`.
- **Tamaños medidos** (partidas automáticas de Brezal del 31-10, unos 50 minutos): el mundo, unos 300 KB; el
  registro, 7,6 MB con 779 eventos (unos 10 KB por evento, por la narración, el contexto y las líneas).
- **Cada guardado reescribe el mundo entero** (300 KB) aunque solo cambie un NPC. Y no es atómico: `writeFile` sobre
  el mismo fichero; si el proceso muere a mitad, el fichero queda roto.
- **Al arrancar se lee el registro entero** (`loadEvents(…, 0)`), porque los momentos, las tiradas pendientes y la
  presencia se reconstruyen de él. Con partidas de semanas, el arranque crece sin límite.
- Ya existe una implementación por entidad: `FirestoreRepository`, un documento por objeto, NPC o punto, con
  escrituras sueltas en lotes. El contrato `Repository.write(changes)` ya manda solo lo que cambia.

### 8.2 Qué conviene y qué no

- **El catálogo (definiciones SRD, campañas escritas) no va a la base:** es código, con tipos, tests y versión en
  git. La partida guarda una referencia a la versión.
- **Una base PostgreSQL por mundo, no.** Serían N bases que migrar, conectar y copiar. Para lo mismo basta una base
  con `campaign_id` en cada fila.
- **Tablas por campo (una tabla `items` con columnas para daño, CA, rareza…), no.** El modelo cambia cada semana.
  Cada cambio sería una migración SQL y el motor tendría que traducir filas a objetos sin ganar nada: el juego no
  consulta la base mientras se juega.
- **Sí: el mundo de cada partida en la PostgreSQL que ya existe, como documentos JSONB por entidad.** Es lo mismo
  que hace Firestore, en la base que ya se usa en producción y ya tiene copia diaria (`pg_dump`):
  - `world_entities (campaign_id, collection, id, doc jsonb, updated_at)`, clave `(campaign_id, collection, id)`.
  - `world_events (campaign_id, seq, game_s, actor_id, action_type, doc jsonb)`, clave `(campaign_id, seq)`.
  - `world_tickers (campaign_id, name, state jsonb)`.
  - `PgRepository` implementa `Repository` igual que `FirestoreRepository`. Cada guardado es una transacción con
    los cambios del lote: unos KB en vez de 300 KB, y o todo o nada.
- **Qué gana:** guardados pequeños y atómicos; varias partidas largas sin ficheros que crecen; copias y
  restauración con lo que ya hay; consultas entre partidas para el panel de administración (quién tiene qué, qué
  partidas llevan días paradas); y la puerta abierta a más de un proceso de servidor.
- **Qué no gana:** velocidad de juego. El juego ya va en memoria.

### 8.3 Cuándo

- **G0, ya (pequeño, sin base):** escribir el mundo en un fichero temporal y renombrarlo (atómico); y un
  **punto de control** en el registro: el mundo guarda el último `seq`, y al arrancar se leen solo los eventos que
  necesitan los momentos y las tiradas pendientes (una ventana de horas de juego), no los de toda la partida.
- **G, cuando se dé una de estas:** partidas que no son demo y duran días o semanas; más de un proceso o servidor;
  el registro de una partida pasa de unos 50 MB o el guardado del mundo pasa de unos 50 ms; o el panel necesita
  consultas entre partidas. Con «partidas de otro estilo» a la vista, propongo hacerlo justo después de los
  objetos, detrás de una variable (`WORLD_STORE=pg`), con un script que pase las partidas de JSON a la base y
  convivencia de los dos mientras tanto.
- **Esto cambia PLAN.md §4**, que preveía SQLite por partida en la fase 4. Con PostgreSQL ya en producción, una
  sola base con JSONB es más sencilla que un fichero SQLite por mundo.

---

## 9. Pruebas y coste

- **Cada bloque con sus tests, sin API:** catálogo (todas las definiciones validan, precios y pesos del SRD),
  reglas (ataque con +1, CA con +1, sintonización con 3 máximo, pergamino de nivel mayor con su prueba, munición
  que se gasta y se recupera), tienda (comprar baja existencias, sin existencias no se vende, coger sin pagar es
  robo, vender cobra de su bolsa), monedas (pagar, robar parte, morir y perder la bolsa), persistencia (mismo
  mundo tras guardar y cargar en JSON y en PostgreSQL con PGlite, que ya usan los tests).
- **Migraciones probadas con partidas reales:** una copia de «Humo y ceniza» y de las partidas automáticas del
  31-10 tiene que arrancar sin perder nada.
- **Con Haiku, la lanza Miguel** al final de E y de C: una partida automática barata de Brezal (`npm run
  autoplay`, Haiku a esfuerzo bajo, sin actor ni imágenes) que compre, venda, robe en la tienda y use un pergamino.
  Coste de referencia: el informe del 31-10 da unos 0,55 $ por jugador y día con Haiku.

---

## 10. Preguntas para Miguel

1. **¿Monedas en bolsas también para los PJ (bloque D)?** Permite que les roben y que pierdan dinero; cambia unas
   40 líneas. La alternativa es que el dinero del PJ siga siendo intocable.
2. **¿Objetos mágicos en Brezal?** El SRD da el reglamento, pero en Brezal la magia es escasa (la Brasa, Ilse). Se
   puede dejar el catálogo mágico para los mundos generados y poner en Brezal solo pociones y un pergamino en la
   tienda.
3. **El buhonero:** nombre, carácter y si tiene gancho propio (algo que necesita para salir del valle).
4. **¿Tienda con botón de comprar sin máster?** Ahorra tokens, pero quita la escena de regatear si el jugador no la
   pide.
5. **Persistencia:** ¿G0 ya y G después de los objetos, o G antes, aprovechando que habrá que migrar las
   partidas igualmente?
6. **«Intuición»:** he entendido sintonización (*attunement*). Si era otra regla, hay que añadirla.

### Respuestas de Miguel (2026-11-06)

- **Monedas en bolsas también para los PJ:** sí.
- **Magia en Brezal:** sí, pero pocos objetos, enigmáticos y ligados al lore. El lote mágico del SRD es para los mundos generados.
- **El buhonero:** un personaje con lore, tan elaborado como los que ya hay en Brezal.
- **La tienda:** se compra hablándole, y además un botón que ahorra tokens y enseña lo que tiene a la venta, o una burbuja de tienda en el chat.
- **Persistencia:** la decide la sesión; G0 y después G, como recomienda §8.
- **Sintonización:** explicada; se queda como en §4.6.
