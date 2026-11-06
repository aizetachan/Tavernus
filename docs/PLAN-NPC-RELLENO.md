# NPC de relleno: gente de paso que hace pueblo (plan para revisar)

Estado: **aprobado por Miguel el 06-11, con las propuestas de las preguntas del final y la sección «Cómo reaccionan».
Fases 1, 2 y 3 hechas (y de la 4, el control de gente inventada y los encuentros): ver «lo hecho» al final.** Se apoya en el flujo de charla propuesto en
`CONVERSACION-FLUJO.md` (rama `claude/nervous-lederberg-e007cb`, aún sin fusionar) y en el ajuar de los NPC
(`src/engine/outfit.ts`, rama `claude/amazing-mahavira-788ef2`, aún sin fusionar).

## Idea en una frase

Un **segundo nivel de NPC**, el relleno: personas de verdad en el motor (posición, horario, bolsa, minimapa, se les
puede robar, ven los crímenes), pero con una ficha de diez líneas generada desde una **plantilla por oficio**, sin
secretos ni misiones, y que contestan con **plantillas sin IA** («Pan gris, dos de cobre. ¿Llevas o no?») y se cierran
en banda a la segunda. A cambio, el máster pierde el permiso de inventar gente: **solo puede dar voz o remitir a quien
está en la lista**.

## El problema, con datos

**Brezal tiene once personas y tres animales.** Todas con peso en la historia. Fuera de ellas, la gente son números
dentro de los eventos de la agenda (`crowd` en `life.ts`): «vecinos ×20» en el mercado, «vecinos ×10» en la cena,
«feligreses ×12» en la misa. Fuera de un evento, la plaza a mediodía está vacía salvo Garrán en el tablón.

**El máster rellena el hueco inventando.** En «Humo y ceniza» (VPS, día 1, 19:03, seq 89), durante la cena del
Jabalí, el jugador escribe «preguntar a los parroquianos qué es la cena del Jabalí». El contexto decía «la cena del
Jabalí, con unos diez vecinos». El máster narra:

> Un labrador de manos agrietadas te contesta sin levantar la vista del plato […] Una mujer de chal al fondo mira hacia
> la puerta, como quien espera a alguien que no llega.

Ni el labrador ni la mujer existen en el motor. No están en el minimapa, no tienen sitio ni horario, no llevan nada, no
pueden volver a hablar ni ser buscados mañana, y si a las 22 el jugador vuelve a «preguntar al labrador», la taberna
ya está vacía y el máster tiene que inventarlo otra vez o contradecirse. Además, los datos empujan a inventar: el
encuentro de camino `vecino` (life.ts) pide literalmente «un vecino de Brezal (concreto: oficio, algo que lleva)».

Y en el mismo registro (turno 47, lo cuenta `CONVERSACION-FLUJO.md`) Brenna manda al PJ a llevar la cena a «Tomás, el
de la puerta»: el guardia es Doro. Es el mismo fallo con nombre propio.

## Decisiones que propongo

1. **Tres niveles de gente**, no dos:

   | Nivel | Qué es | Ejemplo en Brezal | En el motor | Charla |
   |---|---|---|---|---|
   | **Principal** | Personaje de la historia | Brenna, Garrán, Ilse | `Npc` completo, como hoy | Flujo completo (capas 1 a 5), máster y actor |
   | **Relleno** (nuevo) | Vecino con oficio, nombre y rutina | Marta la panadera, Anselmo el sereno | `Npc` con `tier: 'extra'`, ficha compacta | Guion corto: plantillas sin IA; el máster solo si la acción no es una charla simple |
   | **Multitud** | Gente sin cara de un evento | «unos diez vecinos» en la cena | Un número en `crowd` (ya existe) | No habla como individuo. Si alguien de la multitud tiene que contestar, es uno del relleno presente |

2. **El relleno es un `Npc` normal con una marca**, no una estructura aparte. Así el horario (`schedule.ts`), la
   percepción, el minimapa (`board.ts`), el ajuar y el robo (`outfit.ts`, `inventory.ts`), el crimen y los testigos
   (`crime.ts`), la muerte y el combate funcionan sin código nuevo. Lo nuevo es cómo se escribe (compacto, desde una
   plantilla), cómo habla (guion corto) y cómo se resume en el contexto del máster (una línea).

3. **Generado desde los datos y agnóstico.** El motor tiene un catálogo de oficios de relleno por género (fantasía,
   ciencia ficción, postapocalíptico), como ya tiene `ROLES` (worldgen/catalog.ts) y `KITS` (outfit.ts). Brezal escribe
   su relleno como datos compactos (nombre, oficio, dos o tres frases de historia, dónde está); los mundos generados lo
   sacan del tipo de asentamiento con una semilla, sin IA.

4. **Sin misiones, sin secretos, sin saber de la historia.** Un vecino de relleno no tiene `knowledge`, no da
   misiones, no entra en las pistas. Sabe lo público de su oficio y de su sitio, y remite a quien sí sabe (un NPC
   principal que existe).

5. **El máster no inventa gente.** Regla en el prompt, la lista de relleno presente en el contexto y un control al
   cierre que rechaza a una persona inventada que habla o a la que se remite al jugador.

## Cuántos: la regla

El pueblo resulta plausible si, en los sitios públicos y a horas de vida (de 7 a 22), el jugador ve **entre dos y cinco
personas además de los principales**, y nunca más de cuatro de relleno en un mismo sitio fuera de un evento. Con eso:

- **Por asentamiento:** entre una y una vez y media el número de principales, con un tope de 16.
- **Por sitio y franja:** como mucho cuatro de relleno fuera de los eventos (el validador avisa si se pasa).
- **En los eventos:** el relleno que asiste sale de la cifra de `crowd`; el resto sigue siendo multitud sin cara.

Para Brezal, con once principales: **doce de relleno** (eran trece; Lucio pasó a tendero, ver abajo). Unas cien almas en total contando la multitud, que es lo que
pide una aldea encerrada en la niebla: hay gente, pero se conocen todos.

## El modelo de datos

### En los datos de campaña: `AuthoredExtra` (nuevo, compacto)

```ts
/** Un vecino de relleno escrito en una campaña. Lo demás lo pone la plantilla de su oficio. */
interface AuthoredExtra {
  id: Id;                       // 'npc_x_marta'
  name: string;                 // 'Marta'
  trade: TradeId;               // 'baker': elige plantilla (catálogo del motor)
  gender?: 'f' | 'm';           // para el nombre del oficio: «la panadera»
  look: string;                 // una frase: cómo se le ve (sale en el contexto y en «mirar»)
  story: string;                // dos o tres frases: su historia breve (wiki y máster si se le pregunta por él)
  routine: { day?: Id; afternoon?: Id; night?: Id };  // puntos, como los principales
  home_spot_id: Id;             // donde duerme
  attends?: Id[];               // eventos de la agenda a los que va (sale de su `crowd`)
  sells?: { item_id: Id; price: number }[];
  refer_to?: Id[];              // a quién remite lo que no sabe (NPC que existen)
  bonds?: NpcBond[];            // familia y amigos (crime.ts): Fermina y Ramiro, matrimonio
  wander?: Id[];                // puntos por los que se mueve dentro de su franja (Pía, Anselmo en la ronda)
  lines?: Partial<ExtraLines>;  // frases propias que pisan las de la plantilla
  wealth?: Wealth;              // si no, la del oficio
}
```

### En el motor: el catálogo de oficios, `TRADES` (nuevo, `src/engine/extras.ts`)

```ts
interface TradeDef {
  id: TradeId;                         // 'baker', 'watchman', 'laborer', 'washer', 'peddler', 'child'…
  label: Record<Genre, { m: string; f: string }>;   // 'panadero'/'panadera'; en ciencia ficción, 'cocinero de la estación'…
  kit: KitId;                          // ajuar de outfit.ts: bolsa y cosas de su oficio
  wealth: Wealth;
  archetype: 'commoner' | 'guard' | …; // bloque SRD (skeleton.ts); casi siempre commoner
  noncombatant: boolean;               // casi siempre sí: si le atacan, huye y grita
  temper: 'seco' | 'con prisa' | 'receloso' | 'parlanchín' | 'tímido';
  service: 'directions' | 'hours' | 'sell' | 'none';  // lo que su papel le hace contestar
  lines: Record<Genre, ExtraLines>;    // plantillas con huecos
  works_at?: PlaceKind[];              // para los mundos generados: dónde trabaja
}

/** Las frases de un vecino de relleno: varias por hueco, el motor elige con la semilla. */
interface ExtraLines {
  greet: string[];      // abrir charla o saludo: «¿Qué quieres?»
  service: string[];    // su papel: «{where}», «{item} a {price}»
  dunno: string[];      // lo que no sabe: «De eso no sé nada. Pregunta a {refer}.»
  brush: string[];      // no quiere más charla: «Tengo faena.»
  known: string[];      // le conoce de oídas: «Tú eres el que {fame}.»
  news: string[];       // un hecho reciente que sabe: «{news}. Quién lo iba a decir.»
  scared: string[];     // peligro o le amenazan: «¡Doro! ¡Aquí!»
  accuse: string[];     // le ha pillado robando: «¡Eh! ¡Suelta eso! ¡Al ladrón!»
  afraid: string[];     // le tiene miedo al PJ (le pegó, mató a alguien): «Déjame en paz.» y se aparta
  bye: string[];
}
```

### Cómo se monta (agnóstico)

`expandExtra(def, trade, campaign)` convierte un `AuthoredExtra` en un `Npc` en `buildSnapshot`, igual que hoy pasa
con los principales:

| Campo de `Npc` | De dónde sale |
|---|---|
| `tier` | `'extra'` (campo nuevo; sin campo, principal) |
| `role`, `role_short` | `trade.label[genre][gender]` («panadera», «la panadera») |
| `description` | `look` + `story` |
| `motivation` | una frase del oficio («Vender el pan antes de que se ponga duro») |
| `secret`, `knowledge`, `buys` | vacíos |
| `stats`, `noncombatant` | arquetipo del oficio |
| `kit`, `wealth` | del oficio, o lo que pise la ficha (el ajuar los viste al arrancar) |
| `routine`, `home_spot_id`, `sells` | de la ficha |
| `attitude` | `neutral` |
| `script` (nuevo) | `trade.lines` mezcladas con `lines` de la ficha, y `refer_to` |

El validador (`worldgen/validate.ts`) comprueba que el oficio existe, que los puntos y los NPC de `refer_to` existen,
que lo que vende está en `item_defs`, el tope por sitio y franja, y que los nombres del relleno no chocan con los de
los principales.

### En los mundos generados

`SettlementDef` (worldgen/catalog.ts) gana `extras: { trade: TradeId; n: [min, max] }[]`. El esqueleto
(skeleton.ts) los coloca con la misma lógica que los papeles (`works_at` contra los lugares del pueblo), les da un
nombre de una lista por género y una frase de aspecto y de historia de plantilla, todo con la semilla del mundo. El
relleno semántico con IA (fill.ts) **no** los toca: su coste sigue siendo cero. Un ejemplo, una aldea de fantasía:
`[{ trade: 'baker', n: [1,1] }, { trade: 'laborer', n: [2,3] }, { trade: 'watchman', n: [0,1] }, { trade: 'child', n: [1,2] }, { trade: 'peddler', n: [0,1] }]`.

### Casas

El relleno duerme en algún sitio. Propongo un tipo de punto `dwelling` («las casas del callejón») con una propiedad
nueva: **quien está dentro no se ve desde fuera** (no sale en el minimapa ni en «Presentes» salvo que el PJ esté en ese
punto; entrar es allanamiento si la ley de la campaña lo dice). En Brezal, un punto nuevo en la plaza. En los mundos
generados, uno por asentamiento.

## El relleno de Brezal

Doce vecinos (el plan tenía trece: el buhonero, Lucio, pasó a ser el tendero de la tienda de la plaza, un principal de la sesión de objetos E, y sale de esta lista). Ninguno contradice el lore: la única guardia pagada sigue siendo Doro (el rumor `rm_diezmo` dice que
«la guardia es Doro»), así que el que hace la ronda es un viejo que la hace por su cuenta; Brenna sigue sola en la
barra; no hay sacerdote (Ilse dirige el rezo) y la que se ocupa de las velas es una beata.

Hacen falta en el mapa **dos puntos nuevos en la Plaza del Pozo**: `sp_pl_horno` (el horno, con mostrador) y
`sp_pl_casas` (las casas del callejón, `dwelling`). Y dos objetos nuevos: `it_pan_gris` (pan gris) y `it_farol` (farol
de aceite). Franjas del motor: mañana de 6 a 14, tarde de 14 a 20 y noche de 20 a 6.

| # | Quién | Oficio | Mañana | Tarde | Noche | Eventos | Lleva (ajuar + propio) | Vende o sirve para | Historia breve |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Anselmo** | sereno (por su cuenta) | casas (duerme) | el tablón (sentado) | el portón norte, ronda hasta la barricada | prueba de la niebla | bolsa, silbato, farol | **direcciones**: dónde está alguien o algo, y a qué hora suele estar | Setenta años. Desde que bajó la niebla hace la ronda con un farol porque «el chico» (Doro) se va a la taberna. No cobra. Se queda dormido en el banco del tablón por la tarde. |
| 2 | **Remedios** | beata | el pozo (cambia las velas) | casas | el pozo hasta el fin de la misa; luego casas | misa del pozo | bolsa, cuentas de rezo, cabos de vela | **horas**: la misa, el mercado, el cobro del diezmo | Viuda. Tañe la campanilla de la misa. Reza por los de Vharn sin decir por quién. A todo responde con la hora de la misa. |
| 3 | **Marta** | panadera | el horno | el horno | casas | mercado | bolsa, mendrugo, saco de harina pequeño | **vende** pan gris a 2 de cobre | Cuece con la harina gris de Mateo, cada día menos hornadas. Desconfía de los forasteros porque «comen y se van». |
| 4 | **Benito** | labrador | el camino del molino (huertos) | el camino del molino | la chimenea del Jabalí hasta las 21; luego casas | cena del Jabalí | bolsa, navaja, yesca, mendrugo | nada; remite a Mateo por el grano | Manos agrietadas, poca charla. Su campo está al otro lado de la niebla y riega un huerto prestado. Es **el labrador** de la cena. |
| 5 | **Ciro** | labrador | el camino de los corrales (cercas) | el camino del molino | la mesa del fondo del Jabalí hasta las 21; luego casas | cena del Jabalí | bolsa, navaja, dados de hueso | nada | Joven, juega a los dados en la cena y pierde. Le debe a Garrán. Se calla en cuanto entra. |
| 6 | **Fermina** | lavandera | la rueda del molino (lava en el canal) | el pozo | casas | misa del pozo | bolsa, jabón de ceniza, pañuelo | **horas** y adónde ir a lavar | Lava para la casona y para el Jabalí. Dice que el agua sale gris y la ropa también. Es la **mujer de chal**: mira a la puerta porque su marido salió a la niebla con la cuerda y volvió callado. |
| 7 | **Gil** | leñero | el sendero del Soto (corta leña) | la puerta de la taberna (lleva la leña) | la chimenea del Jabalí hasta las 21; luego casas | cena del Jabalí | bolsa, hacha de mano, yesca | **vende** leña a 3 de cobre | Corta en el borde del Soto y no entra más: «ahí dentro hay lobos y algo peor». |
| 8 | ~~**Lucio**~~ (ahora tendero, principal: fuera del relleno) | buhonero atrapado | el pozo (puesto) | la mesa del fondo del Jabalí | la chimenea del Jabalí (duerme ahí por una moneda) | mercado | bolsa, cordel, hilo y aguja, yesca | **vende** cordel, hilo y aguja, yesca | De Valcruz. La niebla le pilló dentro con el carro a medio vender. Pregunta a todo el mundo si sabe cómo salir. |
| 9 | **Inés** | zagala de los Corrales | el redil | el sendero del Soto (pastos) | la casa de la granja | ninguno | bolsa, honda, mendrugo | nada; remite a Úrsula | Catorce años. Saca las ovejas de Úrsula desde que Pol se quedó fuera. Habla con las ovejas más que con la gente. |
| 10 | **Pía** | niña del callejón | el pozo | el callejón de las hierbas | casas | mercado | sin bolsa: canicas de barro, una cinta | **direcciones** (mal y corriendo) | Ocho años. Corre detrás de los forasteros y repite lo que oye en casa. Se va corriendo a la segunda pregunta. |
| 11 | **Herminia** | criada de la casona | el zaguán de la casona | el pozo (agua para la casona) | la casona (banco de espera) | ninguno | bolsa, llave de la puerta de servicio, pañuelo | **horas** del regidor: «recibe por la mañana» | Sirve a Osric desde hace doce años. No dice nada de la casa y se nota que lo tiene ensayado. |
| 12 | **Damián** | viejo del Jabalí | la chimenea del Jabalí | la chimenea del Jabalí | la chimenea del Jabalí hasta las 21; luego casas | cena del Jabalí | bolsa, pipa de barro, dados | nada; repite el rumor de las luces del granero (`rm_luces`) | Bebe a cuenta de una pensión que ya no llega. Cuenta lo de las luces a quien le pague una cerveza, y siempre igual. |
| 13 | **Ramiro** | vecino de la cuerda | el camino del molino (huertos) | el camino de los corrales | la barricada del Lindero de 22 a 23; luego casas | prueba de la niebla | bolsa, rollo de cuerda, navaja | nada; de la niebla dice lo que vio (público) | El marido de Fermina. Es el que se ata la cuerda y entra en la niebla cada noche. Sale tosiendo y no cuenta nada. |

Notas:

- **El relleno no tiene peso en la historia**, pero dos tocan lo que ya existe: Damián repite un rumor que ya corre
  (`rm_luces`), Ramiro hace el evento de la prueba de la niebla y Ciro debe a Garrán (se callará si Garrán entra; no
  es una misión). Nada de eso abre pistas.
- **Eventos.** Con el relleno dentro, `crowd` baja uno por cada vecino que asiste: la cena pasa de «vecinos ×10» a
  «vecinos ×6» más Benito, Ciro, Gil y Damián; la misa, de 12 a 10 más Remedios y Fermina; el mercado, de 20 a
  18 más Marta y Pía; la prueba de la niebla, de 3 a 1 más Anselmo y Ramiro.
- **A las 13:00 en la plaza** (cobro del diezmo): Garrán, Doro, Marta en el horno, Remedios y Pía junto al
  pozo, Benito y Ramiro en los huertos, Ciro en las cercas y la fila de ocho sin cara. **A las 16:00**: Osric en el
  tablón, Anselmo dormido en el banco, Fermina y Herminia en el pozo, Pía en el callejón, Marta en el horno, Gil en la
  puerta de la taberna. **A medianoche**: Doro en la barra y Anselmo
  en el portón; el resto, en las casas.
- **Las rutinas van por las tres franjas del motor**, y lo que pasa a una hora concreta (la cena hasta las 21, la
  prueba de la niebla a las 22) va por los eventos a los que asisten. «Hasta las 21; luego casas» quiere decir eso:
  el evento acaba y vuelven a su punto de noche.
- La tabla con la hora a hora está en la página de revisión.

## Cómo contestan

### Un nivel dentro del flujo de charla

El relleno entra en el flujo de `CONVERSACION-FLUJO.md` como **un nivel con su propio guion**. Las capas se evalúan
igual, pero cada una tiene menos salidas:

| Capa | Principal | Relleno |
|---|---|---|
| 0. ¿Le habla? | igual | igual |
| 1. Lo urgente | todas las banderas | **igual**: peligro, crimen, le atacan, le roban. Contesta `scared` (huye, grita, llama a Doro) |
| 2. ¿Qué sabe del PJ? | cinco estados y el nombre | **tres**: nada, de oídas (crimen, fama, etiqueta) y «ya le ha hablado hoy» (un contador por PJ y día, sin memoria) |
| 3. ¿Cómo le trata? | trato, opinión, etiquetas, escalada | **fijo** por el carácter del oficio (`temper`), con la opinión y el crimen; la escalada se corta antes: a la segunda insistencia, `brush` y se cierra |
| 4. ¿Misiones? | da, insinúa, recoge | **nunca**. Si pide trabajo: «Aquí no hay. Mira el tablón» o remite a quien da trabajo |
| 5. ¿Qué le ha dicho? | todas las intenciones | **seis**: abrir o saludar, pregunta pública (su servicio), comercio, pregunta de historia (`dunno` + a quién remite), identidad (`known` o «no te conozco»), y todo lo demás (`brush`) |

Huecos del guion: **A** (reacción, si la hay), **B** (saludo frío o nada), **C** (su servicio o `dunno`), **E**
(`brush`). Nunca **D**. Máximo dos frases, 25 palabras.

### Quién pone las palabras: el motor, casi siempre

**Charla simple con un vecino de relleno: sin IA.** Si el turno es solo hablar (paso 0 del flujo), el destinatario es
de relleno y la intención es una de las seis, el motor elige las frases de la plantilla con la semilla, rellena los
huecos y emite la línea como diálogo, como hoy hace el máster offline (`talkReply`). No hay llamada al máster.

- **Direcciones** (`service: directions`): «¿Dónde está la curandera?», «¿dónde vive el regidor?». El motor lo
  resuelve desde los datos: dónde está esa persona según su rutina y dónde vive (`homeLine`), o dónde está un sitio, y
  por qué salida se va. Solo lo público: de quien vive en un sitio que el PJ no puede conocer aún (Ysolde, en el granero),
  `dunno`.
- **Horas** (`service: hours`): la agenda (`listSchedule`): «La misa es a las ocho, en el pozo».
- **Comercio** (`service: sell`): el precio de su lista y la compra con la misma lógica que `buy_item`, sin el máster.
  Si el texto es ambiguo («quiero algo de pan»), el más barato de lo que vende.
- **Lo que no sabe**: `dunno` con un nombre de `refer_to` que existe y que el PJ puede conocer: «Eso pregúntaselo a
  Brenna».
- **Insistir**: a la segunda pregunta que no es su servicio en diez minutos, `brush`, y la charla queda cerrada hasta
  la siguiente franja: si el jugador sigue, el vecino no contesta y la narración lo dice («Marta ya está con la masa y
  no levanta la vista»).

**Con el máster**: si la acción no es una charla simple (le amenaza, le roba, le invita a una cerveza, le pide que le
acompañe, le pega) o la intención no entra en las seis. El máster recibe el guion de relleno: los huecos que tocan,
«dos frases como mucho», «no sabe nada de la historia», «no da misiones» y «no nombra a nadie que no esté en el
contexto». Es un turno normal, con el mismo coste de siempre.

**Variedad**: las plantillas de cada oficio traen cuatro o cinco frases por hueco, y la ficha puede añadir las suyas.
Opcional (fase 5): el escritor barato de los comentarios (`ChatterWriter`, Haiku) escribe una vez, al crear la partida,
tres frases propias por hueco para cada vecino, y se guardan. Con el máster offline o sin clave, plantillas.

### Ejemplos

| Jugador | Vecino | Camino | Respuesta |
|---|---|---|---|
| «Hola» | Marta, panadera, seca | B + C ofrece | «Pan gris, dos de cobre. ¿Llevas o no?» |
| «Dame un pan» | Marta | comercio | Le cobra 2 de cobre y le da un pan gris. «Ahí tienes.» |
| «¿Qué sabes del granero quemado?» | Marta | historia | «Yo hago pan. Eso pregúntaselo a Brenna, que oye de todo.» |
| «¿Y de la niebla?» (otra vez) | Marta | insistir | «Tengo hornada. Si no compras, aparta.» Y cierra |
| «¿Dónde está la curandera?» | Anselmo, sereno | direcciones | «Ilse. Al fondo del callejón de las hierbas, la puerta con la ruda. A estas horas, con el caldero.» |
| «¿A qué hora es la misa?» | Remedios, beata | horas | «A las ocho, en el pozo. Trae vela si tienes.» |
| «¿Me conoces?» (el PJ mató a alguien) | Benito, labrador | 1 bloqueante | Se levanta y se aparta: «No quiero líos.» y avisa |
| «¿Tienes trabajo?» | Ciro | sin misiones | «¿Trabajo? Mira el tablón, que ahí cuelgan los encargos.» |
| «Te invito a una cerveza si me cuentas lo de las luces» | Damián | con el máster | El máster, con el guion: Damián acepta y repite el rumor de las luces, igual que siempre |

## Cómo reaccionan

Que el pueblo esté vivo no es solo que conteste: tiene que enterarse de lo que pasa, asustarse, gritar «¡al ladrón!»
y moverse. Casi todo existe ya para los principales; el relleno lo hereda por ser un `Npc`. Lo que hay que añadir es
poco y va marcado como **nuevo**.

### A lo que pasa en la historia

| Qué | Cómo | Estado |
|---|---|---|
| Se enteran de lo que pasa | Los hechos (`worldfacts.ts`: una muerte, el perro que vuelve, una misión cumplida, un crimen) corren de boca en boca **con las rutinas**: quien coincide con alguien que lo sabe se entera, con retraso. Con trece vecinos moviéndose, las noticias corren más y más deprisa, que es lo que pasa en un pueblo | existe |
| Lo comentan al pasar | Las tandas de comentarios (`chatter.ts`) de un hecho las dice «cualquiera del sitio que lo sepa» (`npc_ids: null`): el relleno es el hablante natural. «¿Os habéis enterado de lo del herrero?» lo dice Gil en la puerta de la taberna, no una voz sin dueño | existe; el relleno solo tiene que contar como hablante |
| Lo sacan al hablarles | Hueco nuevo `news` en su guion: si sabe un hecho de los dos últimos días que es público, su saludo lo menciona en una frase («Han encontrado al herrero en la barra. Quién lo iba a decir.»). Uno por charla y nunca más de una vez por hecho y PJ | **nuevo** |
| Cambian de costumbres | Las reglas del mundo (`worldrules.ts`, `campaign.reactions`) ya mueven a un NPC o le cambian la actitud. Efecto nuevo para **grupos**: `who: { tier: 'extra', trade?, location? }`. Ejemplos para Brezal: tras una muerte en el Jabalí, dos días sin relleno en la cena; si la amenaza sube un escalón, el relleno se queda en casa de noche (toque de queda de hecho); si arde el granero, nadie corta leña en el Soto | **nuevo** (selector de grupo y efecto `routine_override` con plazo) |
| Alarmas | Fuego, derrumbe o pelea en el sitio: la capa 1 del flujo (bandera bloqueante). El relleno huye a su casa o a la salida más cercana (`fleeSpot`, crime.ts) y grita (`scared`) | la alarma del sitio es **nueva** en `CONVERSACION-FLUJO.md` (pregunta 3 de allí); la huida existe |

### Si el PJ se pone violento con ellos

Todo esto ya lo hace `crime.ts` con cualquier NPC; el relleno entra igual:

- **Le insulta, le amenaza o le empuja**: incidente de insulto o agresión. El vecino es `noncombatant`: no pelea, se
  aparta o huye (`flee`) y grita (`shout`). Los testigos (otros vecinos, los principales, la multitud del evento)
  reaccionan por su papel: la autoridad (Doro, Garrán) da el alto, la gente corriente corre a avisarla con una orden
  de NPC de verdad, el dueño del local deja de servirle.
- **Le pega o le mata**: lo mismo con más gravedad: buscado, infamia en vez de PX, tiendas que no le venden, su
  cuerpo se queda donde cayó (`killNpc`) y la muerte pasa a ser un hecho que corre. Los suyos (`bonds`: Ramiro si es
  Fermina, y al revés) se vuelven hostiles o guardan luto.
- **Después** (**nuevo**, pequeño): el vecino al que agredió le tiene miedo para el resto de la partida
  (`attitude.by_character` y opinión, que ya existen). Con miedo, su guion pasa a `afraid` («Déjame en paz»), no le
  vende, y si el PJ llega a su punto **se aparta** a otro punto de su rutina o a su casa, salvo que esté atado o
  inconsciente. Los demás vecinos que lo saben (el hecho corre) le tratan con `known` («Tú eres el que le pegó a
  Ciro»).

### Si le pillan robándoles

- **En el acto**: robar a un vecino es quitarle algo de su bolsa o de encima (`transfer_item` desde el NPC; el ajuar
  dice qué lleva). Si la tirada sale mal o alguien lo ve, `crime.ts` crea el incidente de robo: el vecino grita
  (`accuse`: «¡Eh! ¡Suelta eso! ¡Al ladrón!»), los testigos reaccionan como arriba, la autoridad da el alto, y el
  vecino no le vuelve a vender. El relleno también es **testigo** de los robos a otros: con la plaza poblada, robar en
  el mercado es más difícil.
- **Sin que nadie lo vea**: el vecino no se entera en el acto. Propuesta, la misma para todos los NPC (es la pregunta 2
  de `CONVERSACION-FLUJO.md`): lo nota **al ir a usarlo** o al cambiar de franja, con su Percepción pasiva contra la
  tirada del robo. Marta lo nota al ir a dar el cambio y no encontrar la bolsa. Si lo nota, sospecha de quien estuvo
  cerca en esa franja: si fue el PJ, le acusa la próxima vez que le vea (hueco A) y se lo cuenta a la autoridad. Si no
  lo nota, nunca. Se implementa una vez para todos; el relleno solo lo usa.

### Horarios y movimiento por el mapa

- **Horario**: tres franjas (mañana, tarde, noche) con su punto, una casa y los eventos a los que van, como los
  principales (`tickSchedule`). Los doce de Brezal tienen el suyo en la tabla de arriba. Existe.
- **Escalonado** (**nuevo**): hoy todos los NPC cambian de punto en el mismo instante en que cambia la franja (a las
  14:00 se movería el pueblo entero de golpe). Cada vecino de relleno cambia a su propia hora, con la semilla, entre
  40 minutos antes y 40 después, así que se ve gente que llega y se va a lo largo de la tarde.
- **Paseos** (**nuevo**): con `wander`, dentro de su franja va de un punto a otro de la lista cada 20 a 40 minutos de
  juego. Pía corretea entre el pozo, el tablón y el callejón; Anselmo hace la ronda del portón a la barricada y vuelve;
- **En el minimapa**: el punto del vecino **se desliza** del sitio viejo al nuevo en el tablero (animación de la página,
  sin coste para el motor: el motor sigue moviéndolo de punto a punto). Si pasa a otra localización, sale por la
  salida de su lado. Sin avisos en el chat (ver abajo).
- **Lo que manda sobre el horario**, igual que con los principales: un evento, una orden de NPC (le pide que le siga),
  una pelea, que esté atado o caído, el miedo al PJ y las reglas del mundo de grupo.

## Cómo salen en el minimapa

Ya salen solos: `board.ts` pinta a todo `Npc` vivo que el PJ percibe. Lo que cambia:

- **Un punto más pequeño y de color apagado** (`BoardPresence.extra: true`), para que los principales destaquen.
- **Etiqueta por oficio** («la panadera») hasta que el PJ sabe su nombre (se lo dice si le pregunta; `pc.knows`).
  En el móvil, la etiqueta del relleno sale al tocar, no siempre.
- **Agrupados**: si hay más de tres de relleno en el mismo punto (la cena), un solo punto con el número.
- **Sin marca de misión** (`lead`) nunca.
- **Las casas no se ven por dentro**: el relleno que duerme en un `dwelling` no sale salvo que el PJ esté en ese punto.
- **Sin avisos al moverse**: el relleno que cambia de sitio no genera aviso (`npc_move` sin `notice`); en el tablero
  el punto se desliza al sitio nuevo. Como mucho una línea de ambiente cada diez minutos de juego si alguien de relleno llega al punto
  del PJ («Entra Gil con un haz de leña»).

## Qué cambia en el contexto del máster

1. **Presentes: una línea por vecino de relleno**, aparte de los principales:

   ```
   ## Gente de relleno aquí (solo existen estos; no sabe nada de la historia, no da misiones, dos frases como mucho)
   - el labrador (Benito) [npc_x_benito] en la chimenea, 4 m: manos agrietadas, poca charla. Lleva: bolsa de cuero [ii_…], navaja, yesca.
   - el leñero (Gil) [npc_x_gil] en la chimenea, 4 m: vende leña a 3 c.
   ```

   Unos 35 tokens por vecino, frente a los 300 a 600 de un principal. Con la multitud del evento:
   «y unos seis vecinos sin cara: no los individualices».

2. **Regla nueva en el prompt de sistema, GENTE**: «Solo existen las personas del contexto. Si alguien de la multitud
   tiene que contestar, que sea uno de "Gente de relleno aquí", con su ID en lines. Si no hay ninguno, la multitud
   contesta como multitud (murmullos, un "eso es cosa de Brenna") sin dar cara, oficio ni nombre a nadie. Nunca remitas
   al actor a alguien que no esté en los datos: si hace falta un "pregunta a…", usa a un principal o a uno del relleno.»

3. **`who_is_here` y `get_npc`** traen el relleno con `tier: 'extra'` y su guion corto.

4. **Encuentros de camino** (`travel.ts`): los de tipo persona (`vecino`, `buhonero`) eligen a un vecino de relleno
   que esté libre en esa zona y lo nombran por su ID en el texto que recibe el máster. Si no hay ninguno libre, el
   encuentro no sale. Se cambia el texto de Brezal: «un vecino de Brezal (concreto: oficio, algo que lleva)» pasa a
   «{extra}, con lo que lleva».

5. **Control al cierre (sin IA), «gente inventada»**: se rechaza una vez, con la lista de quién hay, si
   - una línea de `lines` o un diálogo entre comillas en la narración se atribuye a alguien que no es un NPC presente;
   - una sugerencia o la narración remiten al actor a una persona que no existe: «preguntar a un labrador», «Tomás, el
     de la puerta». Se mira el artículo indefinido o un nombre propio seguido de un oficio del catálogo o de los
     papeles de la campaña, y los nombres propios que no son de nadie (`unknownNames`, actor.ts).

   No se rechaza el fondo sin cara: «la sala llena de vecinos», «alguien ríe al fondo».

## Coste

Precios de Haiku 5.5 (`status.ts`): 0,10 $ por millón de tokens de entrada, 0,50 $ de salida, 0,01 $ de lectura de caché.
Un turno típico de «Humo y ceniza» (seq 89: 8 345 de entrada, 1 486 de salida, 31 262 de caché) cuesta unos
**0,0019 $**.

| Qué | Tokens | Coste |
|---|---|---|
| Charla simple con un vecino de relleno | 0 (motor) | **0 $**. Ahorra el turno del máster entero |
| Contexto: relleno presente (de 2 a 5 vecinos) | +70 a +175 de entrada por turno | +0,000007 a +0,0000175 $ por turno (menos del 1 %) |
| Regla GENTE en el prompt de sistema | +150, en la parte en caché | despreciable |
| Charla de relleno que va al máster | un turno normal | ~0,002 $ |
| Rechazo de «gente inventada» | una reescritura (pasa en pocos turnos) | ~0,002 $ cuando pasa |
| Frases propias con el escritor barato (opcional) | ~600 de salida por vecino, una vez | ~0,004 $ por partida para los doce |
| Generar el relleno de un mundo | 0 (semilla) | **0 $** |

Una sesión de 300 turnos con relleno cuesta como mucho **medio céntimo** más por el contexto, y menos que hoy si el
jugador habla con el relleno, porque esas charlas no llaman al máster.

## Fases de implementación

Todas con tests sin API (vitest, máster offline o respuestas escritas a mano). La prueba con Haiku la lanza Miguel al
final (ver abajo).

### Fase 1: el modelo y el relleno de Brezal

- `Npc.tier`, `Npc.script`; `AuthoredExtra` en `format.ts`; `TRADES` en `src/engine/extras.ts` con los oficios de
  Brezal y los genéricos (fantasía primero; ciencia ficción y postapocalíptico con sus nombres); `expandExtra` en
  `buildSnapshot`; validador.
- Kits nuevos en `outfit.ts` si hacen falta (panadero, lavandera, pastor, niño), coordinado con la sesión de objetos.
- Brezal: `extras.ts` con los trece, los dos puntos nuevos, los dos objetos, `attends` y `crowd` rebajado.
- `migrate`: añade el relleno que falte a las partidas empezadas (antes del ajuar), sin tocar lo que ya hay.
- `dwelling`: quien está dentro no se percibe desde fuera.
- **Tests**: el relleno se monta con su oficio, ajuar y bolsa; está donde dice su rutina en cada franja; va a sus
  eventos y baja la multitud; nadie ve a quien duerme en las casas desde la plaza; el validador rechaza un oficio
  desconocido, un `refer_to` que no existe y cinco de relleno en un sitio; una partida guardada antigua recibe el
  relleno al arrancar y una segunda migración no lo duplica; robarle la bolsa a Marta pasa sus monedas al PJ.
- **Tests de reacciones que ya deberían salir solas** (si no, se arregla aquí): pegar a Ciro en la cena crea el
  incidente, Ciro huye y grita, Benito corre a avisar a Doro, Brenna deja de servir; matar a Fermina deja su cuerpo, el
  hecho corre y Ramiro pasa a hostil; un robo fallido a Marta la hace acusar y la autoridad da el alto; un vecino
  testigo de un robo a Garrán cuenta como testigo; un hecho que sabe Gil le llega a Damián al coincidir en la cena.

### Fase 2: minimapa y contexto del máster

- `board.ts`: `extra`, agrupado, sin `lead`; estilo en la página.
- `prompt.ts`: bloque «Gente de relleno aquí», regla GENTE, multitud sin cara; `who_is_here`, `get_npc`.
- `npc_move` del relleno sin aviso.
- Movimiento: cambio de franja escalonado con la semilla, paseos (`wander`) y el punto que se desliza en el tablero.
- **Tests**: el tablero trae a Marta en el horno como «la panadera» con `extra`; cinco en la cena salen como un punto
  con el número; el contexto trae una línea por vecino y no su historia entera; el prompt lleva la regla; el relleno
  que se mueve no deja aviso; a las 14:00 no se mueven todos a la vez y a las 14:45 ya se han movido todos; con la
  misma semilla, las mismas horas; Pía pasa por sus tres puntos en una mañana y nunca sale de ellos; un vecino con
  orden, atado o en un evento no pasea.

### Fase 3: la charla sin IA

- En el flujo de charla: el nivel relleno (capas recortadas) y la vía rápida del motor para las seis intenciones.
- Direcciones y horas desde los datos; compra con la lógica de `buy_item`; contador por PJ y día; cierre a la segunda.
- Huecos `news`, `accuse` y `afraid`; el miedo al PJ (no le vende y se aparta cuando llega).
- **Tests**: los nueve ejemplos de la tabla «Ejemplos» como casos, sin llamada al máster (cliente que falla si se le
  llama); «¿dónde está Ysolde?» no lo dice; un vecino nunca da una misión aunque el texto la pida; con una amenaza o
  un robo la acción va al máster; tras la muerte de Hugo, el saludo de Marta la menciona una vez y no dos; a quien le
  pegó, Ciro le dice `afraid`, no le vende y se va a otro punto cuando llega; Benito, que lo sabe de oídas, le trata
  con `known`.

### Fase 4: nadie inventado

- Control al cierre «gente inventada»; encuentros de persona con relleno; texto del encuentro `vecino` de Brezal.
- Reglas del mundo para grupos (`who: { tier: 'extra', … }`, `routine_override` con plazo) y las tres de Brezal (sin
  cena tras una muerte en el Jabalí, toque de queda si sube la amenaza, nadie en el Soto si arde el granero).
- **Tests de reglas**: tras una muerte en el Jabalí, dos días sin relleno en la cena y al tercero vuelven; con la
  amenaza un escalón arriba, de noche no hay relleno fuera de las casas salvo Anselmo si la regla lo exceptúa.
- **Tests**: el turno 89 de «Humo y ceniza» (labrador y mujer de chal con líneas) se rechaza una vez con la lista de
  presentes; la misma narración con Benito y Fermina pasa; «Preguntar a un labrador de la taberna» en las sugerencias
  se rechaza a las 22:30 (no hay labrador) y pasa a las 19:30 si se dirige a Benito; «Tomás, el de la puerta» se
  rechaza; «la sala llena de vecinos» pasa; el encuentro `vecino` sale con un ID de relleno o no sale.

### Fase 5: mundos generados y variedad (opcional)

- `SettlementDef.extras`, nombres por género, colocación con semilla; el punto `dwelling` por asentamiento.
- El escritor barato para frases propias, guardadas en la partida.
- **Tests**: dos mundos con la misma semilla tienen el mismo relleno; cada tipo de asentamiento de los tres géneros
  monta su relleno sin errores del validador; sin clave, las plantillas.

### Prueba con Haiku (la lanza Miguel)

Una partida automática en Brezal que pasa por la cena y la plaza, para ver si el máster sigue inventando gente:

```bash
npm run autoplay -- --profiles all --actions 60 --parallel 3 --max-usd-game 0.3 --live
```

Coste estimado: unas 60 acciones por perfil a ~0,002 $ del máster y ~0,001 $ del jugador automático, unos **0,2 $ por
perfil**; con el juez, menos de un dólar en total. Después, `scripts/playtest-report.ts` y buscar rechazos de «gente
inventada» en los registros.

## Preguntas para Miguel

Respondidas el 06-11: «me vale la propuesta». Quedan las propuestas de cada una. Aparte, el robo que se nota más tarde
depende de la pregunta 2 de `CONVERSACION-FLUJO.md`, que se decide allí para todos los NPC.

1. **Los trece de Brezal.** ¿Te encajan? En especial: un sereno viejo en lugar de más guardias (para no contradecir
   que la guardia es solo Doro), una beata en lugar de un sacerdote (el rezo lo dirige Ilse) y que Benito y Fermina sean
   el labrador y la mujer de chal de la cena de «Humo y ceniza».
2. **¿Pueden ascender?** Si el jugador se encariña con un vecino (le hace favores, vuelve a hablarle), ¿pasa a
   principal con memoria y misiones, o el relleno se queda relleno siempre? Propuesta: siempre relleno en esta fase.
3. **¿Ven los crímenes?** Con el relleno, la plaza tiene más ojos y robar en el mercado es más difícil. Propuesta: sí,
   son testigos como cualquiera; es lo que hace un pueblo vivo.
4. **Lo que no sabe.** ¿Que remita siempre a un principal («pregúntale a Brenna») o que a veces diga solo «ni idea»?
   Propuesta: que remita si tiene `refer_to` y si no, «ni idea».
5. **Casas.** ¿Un punto `dwelling` por pueblo («las casas del callejón») o una casa por vecino? Propuesta: uno por
   pueblo; una casa por vecino llena el mapa.
6. **Charla sin IA.** ¿Te vale que el motor conteste solo las charlas simples, aunque suenen más a videojuego que a
   máster? Es lo que pides («un par de frases frías»), y es gratis.

## Lo que no cubre

- Niños y animales de relleno que siguen al PJ, grupos que pasean juntos, conversaciones entre vecinos (eso es
  `chatter.ts`, que ya existe y que podrá usar al relleno como hablante).
- Rutinas más finas que las tres franjas (por horas). Si hace falta, es otra fase, para todos los NPC.

## Fase 1: lo hecho (06-11, sin commit)

- **Modelo** (`src/engine/model.ts`): `Npc.tier` (`'extra'`), `Npc.script` (`ExtraScript`: oficio, carácter, servicio,
  frases por hueco, a quién remite, historia, paseos) y los campos del ajuar `kit` y `wealth`, escritos igual que en la
  rama del ajuar (`claude/amazing-mahavira-788ef2`) para que la fusión sea trivial.
- **Catálogo** (`src/engine/extras.ts`): once oficios (sereno, beata, panadero, labrador, lavandera, leñero, buhonero,
  pastor, niño, criado, parroquiano) con su nombre por género de mundo y de persona, ajuar, riqueza, carácter, servicio
  y frases; `extraNpc` (ficha a `Npc`), `attendExtras` (eventos y multitud), `extraProblems` (validador) y
  `migrateExtras` (partidas empezadas).
- **Formato de campaña** (`format.ts`): `AuthoredCampaign.extras`; se montan en el punto de su franja a la hora en que
  nace el mundo.
- **Casas** (`perception.ts`, `isDwelling`): un punto con la etiqueta `dwelling` no se ve ni se oye desde fuera, ni ve
  lo de fuera. En el crimen, desde casa se oye lo violento y no lo callado. `move_to` no lista a quien está en casa.
- **Brezal** (`src/data/campaigns/brezal/extras.ts`): los doce (Lucio pasó a tendero, principal de la sesión de objetos E, y el farol del sereno es `it_farol_aceite` para no chocar con el `it_farol` de su tienda), con cambios sobre la tabla: Ciro es «jornalero»
  y Ramiro «hortelano», para que «el labrador» sea solo Benito; Herminia es «criada» y Damián «parroquiano», porque un
  oficio que nombra un sitio («criada de la casona», «viejo del Jabalí») hace que «voy a la casona» se lea como hablar
  con alguien (el validador ya lo rechaza). Puntos nuevos: el horno y las casas del callejón
  (cerradas con `it_llave_casas`, que llevan Marta y Fermina: robarla abre la puerta). Objetos nuevos: pan gris, farol de
  aceite y la llave.
- **Migración** (`engine.ts`, `migrate`): el relleno que falta entra en las partidas empezadas con lo que lleva y su
  sitio en los eventos, una sola vez; lo robado no se repone.
- **Wiki**: `wiki/Personajes/Vecinos de Brezal.md`; Personajes, Vida del pueblo, Plaza del Pozo y Taberna del Jabalí.
- **Tests**: `test/relleno.test.ts`.
- **Queda para cuando se fusione el ajuar**: los ajuares nuevos (panadero, lavandera, pastor, niño) y la prueba de
  robarle la bolsa a Marta. Hoy los oficios usan ajuares que ya existen en esa rama (`guard`, `priest`, `laborer`,
  `merchant`, `commoner`).
- **Ojo hasta la fase 2**: el contexto del máster trata al relleno como a un principal (su bloque entero), sin la regla
  GENTE ni la línea corta. No conviene desplegar la fase 1 sola.

## Fase 2: lo hecho (06-11)

Miguel aprobó la fase 2. Entra también lo que el plan tenía en la fase 4: el control de gente inventada y los
encuentros con vecinos de relleno. Era el fallo que lo empezó todo, y la sesión principal lo dejó en esta sesión.

- **Minimapa** (`board.ts`, `page.ts`): `BoardPresence.extra`. La ficha es más pequeña y apagada (color propio y
  leyenda «vecino»), nunca lleva marca de misión, y con más de tres vecinos en un punto sale una sola ficha con el
  número. Bajo el punto, los vecinos van al final («y 2 vecinos»). Quien cambia de punto en el mismo sitio se desliza
  al nuevo (sin animación si el navegador pide menos movimiento). Fuera los «·» de la línea del sitio, por la regla
  de la interfaz.
- **Sin avisos** (`schedule.ts`, `server.ts`): el relleno se mueve sin `npc_move`. El servidor manda al navegador un
  evento `board`, agrupado cada medio segundo, y el tablero se vuelve a pedir sin línea en el chat.
- **Horario escalonado y paseos** (`schedule.ts`): `extraStagger` adelanta o retrasa a cada vecino entre 40 minutos
  antes y 40 después del cambio de franja, según su id (estable). `extraSpotNow` le pasea por `script.wander` cada
  media hora cuando el punto de su franja es uno de ellos: Pía por el pozo, el tablón y el callejón; Anselmo entre el
  portón y la barricada.
- **Contexto del máster** (`prompt.ts`): bloque «Gente de relleno aquí» con una línea por vecino (quién es, su
  aspecto, su guion, lo que vende y lo que lleva con sus ids, y la charla literal si habla con él), en vez de la
  ficha entera. Regla nueva **GENTE** en el prompt de sistema. `who_is_here` y `get_npc` llevan `tier: 'extra'` y el
  guion.
- **Gente inventada** (`src/engine/invented.ts`, cierre en `tools.ts`): se rechaza una vez, con la lista de quién hay
  de verdad, en tres casos:
  - «un/una + oficio» que habla y no hay nadie así en el sitio;
  - mandar al actor a «un labrador» (indefinido: alguien de aquí) o a «el alcalde» (definido: alguien de cualquier sitio) que no existe;
  - un nombre propio que no sale en ningún dato ni en lo que ha escrito el jugador («Tomás»).
  El fondo sin cara pasa. En un encuentro de camino no se mira, porque ahí se puede sacar gente nueva.
- **Encuentros** (`travel.ts`, `EncounterEntry.extra`): el motor elige un vecino de relleno libre, lo pone en el
  camino media hora (`placeExtraAt`) y cambia `{extra}` por quién es. Sin ninguno libre, la entrada no sale. En Brezal,
  «el vecino del camino» y «el que va cargado» (antes, «un buhonero de fuera»: el buhonero es ahora Lucio Cendal, el
  tendero).
- **Ajuares propios** (`outfit.ts`, antes de `laborer`): panadero (harina, mendrugo, mandil), lavandera (jabón,
  pañuelo), criado (llave, pañuelo, mandil) y pastor (honda, navaja, mendrugo, capa con capucha).
- **Tests**: 18 nuevos en `test/relleno.test.ts`, uno por cada punto de arriba.
- **Pendiente**: la fase 3 (la charla sin IA con las plantillas, dentro del flujo de charla de cinco capas que ya está
  en la integración) y la fase 5 (relleno en los mundos generados).

## Fase 3: lo hecho (06-11)

- **El flujo de charla** (talk.ts, sesión del algoritmo) ya traía el nivel `extra`: capas recortadas, nunca misiones,
  seis intenciones y un guion corto de 25 palabras cuando contesta el máster. Aquí se añade la vía rápida.
- **Charla sin IA** (`src/engine/extratalk.ts`, `extraReply`; en el motor, `tryExtraTalk`, con los demás atajos y
  antes de `tryTrivial`): si el turno es una charla simple con un vecino de relleno, el motor elige la frase de su
  guion, rellena los huecos con los datos y la emite como un turno de diálogo (`master` con `payload.master: null`,
  etiqueta `extra`), sin llamar al máster:
  - **lo urgente**: alarma o peligro (`scared`); le agredió o es hostil (`afraid`, y se va a su casa media hora); le
    robó y lo sabe (`accuse`);
  - **saludo**: el saludo de su oficio, una noticia reciente que sabe y no le ha contado (`news`, una vez) y, si vende,
    lo que vende y a cuánto;
  - **lo suyo**: vender (con `buyFromNpc`: monedas y existencias de verdad; «dame un pan» sin nombrarle vale si hablaba
    con él hace nada), dónde está alguien o algo (desde los datos; solo lo público: quien tiene casa o anda por un sitio
    que el PJ conoce, así que de Ysolde no dice nada) y a qué hora es algo de la agenda;
  - **lo que no sabe**: `dunno`, remitiendo a uno de `refer_to` (el PJ aprende su nombre);
  - **despedida**: `bye`;
  - **lo demás**: `brush`.
- **Paciencia**: lo que no es lo suyo cuenta (etiqueta `extra_offtopic`): la primera vez contesta, la segunda le
  despacha y luego «ya no te hace caso». Vender, indicar, la hora y saludar no cansan.
- **Al máster** (con el guion corto): insultos, amenazas, «¿sabes quién soy?» y lo que no es charla.
- **Solo con los atajos del motor encendidos** (`deterministic`, como en la partida de verdad).
- **Tests**: 10 nuevos en `test/relleno.test.ts`.
- **Pendiente**: la fase 5 (relleno en los mundos generados) y la variedad opcional con el escritor barato.
