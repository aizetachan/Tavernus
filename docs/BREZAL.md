# Brezal sellada: la demo como campaña escrita

«Las Cenizas de Vharn» es una **campaña escrita**: un mundo fijado de antemano (lugares, gente, Biblia, leyes, agenda, rumores, situaciones iniciales y una historia en tres actos) que entra en el motor por el mismo camino que un mundo generado. El jugador tiene libertad en cada momento; el mundo y su historia ya están decididos.

Esta es la **versión sellada** para la primera demo con testers, según el [Libro de Historia · Brezal sellada](https://smartdesigncore.notion.site/Libro-de-Historia-402e2792c8d681fbb8c6cd386a9d56ce) (hito «M2a · Demo sellada de Brezal», issues #47 a #55): la aldea está encerrada por el **Cerco de Ceniza**, un anillo de niebla a unos 600 m de la plaza que nadie cruza y que la demo no abre. Es el gancho de la expansión.

> «Las puertas de Brezal siguen abiertas. Es el mundo el que se ha cerrado.»

Marcas en este documento: **[nuevo]** no existía en el Brezal anterior; **[cambia]** existía y se ha ajustado; **[cortado]** ya no está.

- Datos: [`src/data/campaigns/brezal/`](../src/data/campaigns/brezal) (mapa, gente, trama, historia, vida del pueblo, objetos).
- Formato: [`src/data/campaigns/format.ts`](../src/data/campaigns/format.ts) y `authoredSeed('brezal')` en [`src/data/campaigns/index.ts`](../src/data/campaigns/index.ts).
- Historia en actos (motor): [`src/engine/story.ts`](../src/engine/story.ts). La niebla que rebota: [`src/engine/barrier.ts`](../src/engine/barrier.ts) **[nuevo]**.
- Validador común (generado y escrito): [`src/worldgen/validate.ts`](../src/worldgen/validate.ts).
- Tests: [`test/brezal.test.ts`](../test/brezal.test.ts).

---

## 0. Qué cambió con la versión sellada

| Pieza | Antes | Ahora |
|---|---|---|
| Mapa | 3 zonas, 11 localizaciones, salidas de hasta 700 m | **1 zona jugable**, 10 lugares (la taberna con su sótano), todo a menos de 600 m **[cambia]** |
| Claro del Roble | bosque, a 600 m del portón | **El Soto**: arboleda y arroyo en el borde del pueblo; misma id `loc_claro` **[cambia]** |
| Lobera | en la Cuesta Gris | **la madriguera** al pie del roble del Soto; misma id `sp_cs_cueva` **[cambia]** |
| Ruinas de Vharn | ciudadela en la montaña | **El Granero Quemado**: las ruinas del granero de los Vharn en el borde del pueblo; misma id `loc_ruinas` **[cambia]** |
| Cuesta Gris, Cripta de la Brasa | lugares jugables | **[cortado]**. La Brasa grande queda enterrada bajo el granero; el mirador pasa a la torre del reloj de la casona o al tejado del molino |
| Los Corrales y Úrsula | — | granja y viuda nuevas; la puerta al oficio de granjero **[nuevo]** |
| El Lindero y el Cerco | — | el borde del valle; el Cerco es una salida bloqueada que rebota **[nuevo]** |
| Final A | «Atar la Brasa» en la cripta | **«Templar el ascua»** en el pozo **[cambia]** |
| Final B | Osric huye del valle | Osric **no puede huir**: queda escondido en el pueblo (`missing` con escondite) **[cambia]** |
| Final C | la Brasa se suelta en la cripta | el ascua cae **en la plaza** y el humo no sale del valle **[cambia]** |
| Epílogo | — | al amanecer del día 6, la niebla sigue **[nuevo]** |
| Amenaza | 5 días (120 h) | **3 días (72 h)**; las tres situaciones vencen a la vez **[cambia]** |
| Rumores iniciales | 6 | 15: los de antes ajustados y **la teoría de cada vecino sobre el Cerco** **[nuevo]** |
| Motor | — | chocar con la niebla (`barrier.ts`) y NPC `missing` con escondite (`story.ts`) **[nuevo]** |

---

## 1. Análisis

### 1.1 Qué tenía la demo

La demo de `src/data/seed/demo.ts` era un mundo de pruebas con alma de aventura:

| Pieza | Demo antigua |
|---|---|
| Lugares | 3 (Taberna del Jabalí, Plaza del Pozo, Claro del Roble), 14 puntos |
| Gente | Brenna y Doro, con descripción, motivación y secreto; un lobo |
| Trama | 5 pistas, 6 encargos de tablón, una facción y un logro (llave de Vharn + habitación) |
| Agenda | Mercado de la mañana y misa de las ocho |
| Horarios | Brenna (barra/mesa) y Doro (portón) |
| PJ | Kael y Mira ya creados |
| Premisa | «Hace veinte años el fuego arrasó Vharn…» |

### 1.2 Qué le faltaba frente a un mundo generado

| Lo que tiene un mundo generado | Demo antigua | Brezal sellada |
|---|---|---|
| Biblia (5-10 verdades) | no | 10 verdades, con el origen del Cerco **[cambia]** |
| Leyes del mundo (3-8) | no (las SRD por defecto) | 7 leyes propias (nueva: nadie cruza el Cerco) **[cambia]** |
| Situación inicial por PJ con reloj y antagonista | no: un origen genérico | 3 situaciones por clase, las tres a 3 días, con antagonista, deuda u objeto **[cambia]** |
| Horarios de NPC | 2 | los 11 vecinos **[cambia]** |
| Eventos programados | 2 | 6 (mercado, diezmo, cena, misa, la escapada al granero de Tobías, la prueba de la niebla) **[cambia]** |
| Deudas | no | la situación del deudor empieza con 300 monedas que debe a Garrán |
| Rumores iniciales | no | 15 **[cambia]** |
| Cuarto alquilable | no (la habitación era el premio oculto) | sí: visible, cerrado, Brenna vende la noche |
| Encuentros de camino | tabla por defecto | tabla propia de aldea (toda la demo es aldea) **[cambia]** |
| Momentos ilustrables | solo los que salen solos | 10 lugares descritos para la escena de llegada, 11 retratos, el ascua y la niebla; 4 pistas que dicen qué se ve al encontrarlas (`image`: el cubo del pozo, el hacha, la trampilla, el libro). Las demás se oyen y dan el retrato de quien habla (`docs/ARTE.md`) |
| Misiones encadenadas | no (pistas y tablón sueltos) | 10 misiones en 3 actos, con 3 finales y un epílogo |
| Amenaza que avanza sola | no | 5 escalones en 3 días **[cambia]** |

### 1.3 Qué hace que una historia escrita enganche

1. **Un problema personal desde el primer segundo.** No «llegas a una aldea»: Garrán te pone delante una tablilla con tu deuda, Ilse, la curandera, te agarra la muñeca al ver tu carta, el herrero cierra la puerta a tu espalda. La situación inicial es lo primero que pasa.
2. **Un reloj visible.** Las tres situaciones vencen a los tres días, la noche de la Brasa, y la amenaza tiene fechas: la tos gris de madrugada, los lobos en los Corrales al día siguiente, la herrería clavada al tercero. El Diario muestra el reloj; el máster sabe cuánto falta.
3. **NPC que quieren algo de ti.** Brenna quiere su perro, Ilse una muestra del agua, Mateo que alguien hable con su hijo, Úrsula que le arreglen el redil, Garrán su dinero, Osric que vayas a «apagar las luces», Ysolde un culpable. Cada uno es una puerta.
4. **Progreso en bucles cortos.** Cada misión del acto I se cierra en una o dos horas de juego, con recompensa y una consecuencia a la vista. El tablón y la granja dan bucles aún más cortos (leña, bayas, truchas, huevos) para respirar.
5. **Riesgo real.** La loba de ceniza (CA 14, 37 PG) es demasiado para un nivel 1 a lo bruto: obliga a pensar (fuego, sigilo, ceniza del granero). El ascua quema. La deuda vence. Un final oscuro es posible.
6. **Descubrimiento.** Puntos ocultos con CD (la trampilla, el hueco tras el barril, la losa suelta, el desván, la bodega tapiada), un evento nocturno que solo ve quien espera en el arroyo, pistas que cambian lo que sabes de alguien.
7. **Una amenaza que escala.** La Brasa respira aunque nadie mire. Si el jugador no actúa, el pueblo enferma, los lobos entran en los Corrales, Tobías se esconde, la herrería se cierra y el ascua cae en la plaza.
8. **Un encierro.** **[nuevo]** La niebla explica por qué el PJ se queda, por qué el pueblo está tan apretado (todos atrapados, también los buhoneros) y por qué hay tanto que hacer sin salir. Y deja una pregunta abierta para la expansión.

### 1.4 Por qué no basta con escribir texto

La regla del proyecto es que la historia **se revela por tools**: nada existe porque el máster lo diga. Por eso la campaña escrita no es un guion que se le pase al máster, sino datos: cada paso de una misión tiene una condición que el motor comprueba solo (una pista concedida, un punto pisado, un objeto en el bolsillo o entregado, un NPC caído, el estado de un punto), y las consecuencias (un NPC que se va o se esconde, un rumor, un gancho, un evento en la agenda) las aplica el motor. Solo los pasos que son pura ficción («convencer a Brenna») los marca el máster con `advance_story`, y aun así el motor comprueba que sea el paso en curso. La niebla tampoco la narra el máster a su gusto: la resuelve el motor (§2.13).

---

## 2. La historia de Brezal

### 2.1 Premisa **[cambia]**

> Hace veinte años el fuego arrasó a los señores de Vharn y nadie ha vuelto a remover sus ruinas. Hace tres semanas una niebla gris bajó del monte y cerró el valle: quien entra en ella sale por donde entró. Dentro, la aldea de Brezal tose ceniza, los lobos rondan los corrales y de noche hay luz en el granero quemado.

### 2.2 Biblia (lo que es verdad aunque nadie lo diga)

1. Los señores de Vharn ataban en la cripta de su granero, bajo la capilla, un fuego antiguo, **la Brasa**, con cadenas de hierro frío; mientras dormía atada, el valle era fértil y el manantial bajaba frío. **[cambia]**
2. **El incendio no fue un accidente**: Osric Malvez, entonces mayordomo, robó la plata del sello y prendió el granero para taparlo, la noche en que el valle prestaba la lumbre. El fuego llegó a la cripta, rompió las cadenas, la derrumbó y mató a los señores, al herrero de Vharn y al hermano de Brenna. **El herrero vio a Osric con la plata, y Garrán, entonces su mozo, le atrancó la puerta de la fragua.** **[nuevo]**
3. **Brenna** vio a Osric con la antorcha y sacó del fuego a la niña de los señores, Ysolde. Osric le dio la taberna a cambio de callar; ella guarda en el sótano el **libro de cuentas** que apunta la plata entregada a «O. Malvez».
4. **Ysolde Vharn** ha vuelto: se esconde en el pajar del Granero Quemado con **un ascua de la Brasa en el guante**. Recuerda a una mujer con antorcha llevándosela y **cree que Brenna prendió el fuego**. Si el valle no confiesa, soltará el ascua en la plaza la noche de la Brasa. **[cambia]**
5. **La Brasa grande sigue enterrada** bajo el granero, fuera de alcance, y respira: calienta el manantial que alimenta el pozo. Además **Tobías** echa cada noche al pozo ceniza de las grietas del altar por encargo de Ysolde: de ahí la tos gris. **[cambia]**
6. **El ascua se puede templar**: sumergida en el agua fría del pozo, con **los eslabones de hierro frío** sujetos (los guarda Hugo bajo una losa) y diciendo **las palabras de Ilse**. Apaga la tos y afloja el Cerco, pero no lo abre. **[cambia]**
7. **El Cerco de Ceniza es la Guarda de Vharn**: un conjuro de contención de los primeros señores que cierra el valle cuando la Brasa se agita, dormido desde el incendio por falta de quien lo alimentase. **Despertó hace tres semanas**, cuando Ysolde, la última de la sangre, volvió con el ascua. Es un conjuro protector que se ha vuelto cárcel: no hay villano al que matar para abrirlo. **[nuevo]**
8. La Guarda tiene **tres anclajes** con el sello de Vharn: el del valle (el mojón del Lindero, ligado al pozo y al ascua), el del bosque (la Lobera, al otro lado) y el de las minas de plata. **La demo solo templa el primero**; los otros esperan fuera. **[nuevo]**
9. Osric sabe que alguien vive en el granero; manda deudores a «apagar las luces» a través de Garrán y ha ordenado a Hugo fundir los eslabones. Guarda en su arcón una copa con el sello y en la casona **una bodega tapiada** por si tiene que esconderse: del valle no puede huir nadie. **[cambia]**
10. La **loba de ceniza** bajó de la montaña y la niebla la encerró en el Soto, en una madriguera al pie del roble; no ataca a quien lleva ceniza del granero. Tiene acorralado a Ceniza, el perro de Brenna. **[cambia]**

### 2.3 Leyes del mundo

1. La magia es rara y temida; la Brasa no es un arma: quema a quien la toca sin el guante de Ysolde.
2. Sin tecnología moderna: hierro, madera, cuerda y fuego.
3. Nada sale de la nada.
4. El cuerpo tiene límites; los prodigios piden tirada.
5. Los muertos no vuelven.
6. El hierro frío no se funde con fuego de fragua corriente.
7. **Nadie cruza el Cerco de Ceniza**: quien entra en la niebla sale por donde entró, una hora después, con ceniza en el pelo. **[nuevo]**

### 2.4 Facciones y tensiones

- **La aldea de Brezal** (la reputación del logro): encerrados por la niebla, tosen gris, pagan el diezmo, rezan en el pozo. Desconfían del forastero hasta que hace algo por ellos.
- **La casona del regidor** (Osric, Garrán, Doro): el diezmo de la ceniza, la ronda del Lindero, el silencio sobre Vharn. Osric necesita que nadie remueva el granero y que lo de dentro desaparezca. **[cambia]**
- **La casa de Vharn** (Ysolde, Tobías, Hal): la heredera que quiere justicia o fuego, el chico que quiere ser alguien, el cazador que le lleva caza a cambio de plata vieja.

Tensiones que mueven la historia: Brenna calla por miedo a Osric; Ysolde odia a Brenna por error; Hugo debe dinero a Osric y guarda lo que Osric quiere fundir; Mateo encubre a su hijo; Garrán cobra por cada deudor que no vuelve; Úrsula espera a un hijo que está al otro lado.

### 2.5 La gente

Bloques SRD de los arquetipos del generador (`ARCHETYPES`, mismos rangos que valida `fill.ts`).

**Lo que cuenta cada uno depende de cuánto se fíe del PJ** **[cambia, 2026-10-27]**. La columna «Secreto» ya no va entera al máster: en `people.ts` cada persona lleva `knowledge`, el secreto repartido en cuatro niveles de confianza (extraño, conocido, amigo, aliado), y el máster solo recibe lo del nivel que ese PJ ha alcanzado con ella (§3, «Confianza»). A un extraño le cuentan lo que sabe todo el pueblo: Ilse habla de la tos y de sus tónicos; la Brasa, la cripta y las cadenas son de amigo. Nadie cuenta a un extraño nada que abra la historia, ni con una buena tirada. La loba no habla: lo de la ceniza va en su motivación.

| NPC | Papel | Cómo es | Quiere | Secreto | Sabe | Vende / compra | SRD | Horario (día / tarde / noche) |
|---|---|---|---|---|---|---|---|---|
| **Brenna** | tabernera | 50 años, brazos de amasar, quemadura en la mano; frases cortas, cambia de tema al precio de la cerveza | la taberna en pie, su perro de vuelta, que nadie remueva el granero | vio a Osric prender el fuego, salvó a Ysolde, guarda el libro | quién fue, dónde está el libro, que la niebla bajó cuando volvió «la niña» | cerveza, ración, antorcha, poción, **noche de posada**; compra leña, bayas, truchas, harina, huevos | plebeyo, 9 PG | barra / barra / mesa del fondo; misa a las 20 |
| **Doro** | guardia | joven, botas nuevas, habla de más y se corrige | que lo tomen en serio | vio luces en el granero y una figura en la senda **[cambia]** | la hora de la figura, que su tío paga a Garrán | — | guardia, 11 PG | portón / **barricada del Lindero** / barra **[cambia]** |
| **Osric Malvez** | regidor | 60 años, anillos, sonríe con la boca cerrada, «vecino» | que nadie remueva el granero y todos se queden quietos | prendió el fuego, robó la plata, manda deudores al granero; tiene una bodega tapiada | todo | compra el libro y la copa (para destruirlos) | noble, 9 PG | despacho / tablón / alcoba |
| **Garrán** | alguacil y recaudador | ancho como una puerta, nariz rota, cuenta con los dedos | cobrar y no ir nunca al granero | cobra por cada deudor que no vuelve; vio a Ysolde y huyó; sisa el diezmo | quién debe qué; lleva la llave del arcón | — | alguacil: CA 13 (jubón de cuero), 24 PG, maza corta 1d6+2; si te resistes acude Doro | tablón / barra / banco de la casona |
| **Ilse** | curandera | muy vieja, ojos de agua, mezcla rezo y cocina | curar la tos, dejar el rito en buenas manos, entender el cerrojo | última sacerdotisa de la llama; sabe templar el ascua; reconoce la Guarda **[cambia]** | qué es la Brasa y cómo se templa un ascua | tónico de corteza, poción; compra bayas y agua del pozo | acólito, 9 PG | hierbas / caldero / camastro; dirige la misa |
| **Hugo** | herrero | calvo, quemaduras pequeñas, habla a golpes | pagar a Osric sin traicionar a su maestro | guarda los eslabones bajo la losa; le han ordenado fundirlos | para qué servía la cadena; «no fue el fuego lo que lo mató»; el «cinturón de hierro» | daga, hacha, hachuela, espada corta, escudo; compra leña | herrero: CA 12 (mandil), 22 PG, martillo de fragua 1d8+2 | fragua / yunque / mesa del Jabalí |
| **Mateo** | molinero | redondo, enharinado, tose gris, chistes malos | que el molino no se pare | encubre a su hijo | a qué hora sale Tobías; que el grano no llega ni sale | harina, raciones; compra truchas y leña | plebeyo, 5 PG | muelas / muelas / sacos |
| **Tobías** | hijo del molinero | 17 años, uñas negras, contesta con preguntas | ser alguien | echa ceniza al pozo para Ysolde; cartas en el desván; el hacha es suya | quién se esconde en el granero, que la loba respeta la ceniza | — | plebeyo, 6 PG | sacos / roble del Soto / desván; a las 23 va al granero por el arroyo **[cambia]** |
| **Ysolde** (Vharn) | mujer del ascua | 25 años, cicatriz de quemadura, un ascua en el guante, habla como en los libros | justicia o fuego | es la heredera; cree culpable a Brenna; no sabe que despertó la Guarda **[cambia]** | su historia, cómo despertar la Brasa (no sabe templar el ascua) | compra raciones y el libro | 12 CA, 22 PG, llama de la Brasa 2d6 | pajar del granero / pajar / capilla **[cambia]** |
| **Hal** | cazador | flaco, pieles, mira antes los pies que la cara | que lo dejen en paz en su Soto | lleva caza a Ysolde por plata del sello | la madriguera, la loba; vio un ciervo entrar en la niebla y volver | truchas, flechas, antorchas; compra pieles | explorador, 16 PG, arco (a distancia, multiataque ×2) | piedra / choza / choza |
| **Úrsula** **[nuevo]** | granjera | viuda, recia, pañuelo a la nuca, riñe a las gallinas como a la gente; mira siempre hacia la niebla | que su hijo Pol vuelva; que no le maten las ovejas | Pol salió a Valcruz la víspera de la niebla; ella ha entrado tres veces a buscarlo y ha salido por donde entró; deja un farol en la cerca cada noche | que la niebla devuelve a quien entra; que los lobos rondan el redil | huevos, coles, raciones; compra leña y bayas | plebeyo, 8 PG, horca 1d6 | gallinero / huerto / casa; vende en el mercado |
| un lobo flaco | lobo | flaco, ceniza en el lomo | hambre | — | — | — | lobo | arroyo del Soto |
| **la loba de ceniza** | loba | grande como un poni, humea, ojos de brasa | defender la madriguera | no ataca a quien lleva ceniza del granero | — | — | 14 CA, 37 PG, 2d6+3 | la madriguera **[cambia]** |
| **Ceniza** | perro de Brenna | pardo, oreja rota | volver a casa | — | — | — | sin combate | la madriguera (luego, la chimenea) |

### 2.6 Lugares **[cambia]**

**Una zona jugable** (Aldea de Brezal), **diez lugares** (la taberna cuenta con su sótano) y 63 puntos. Los planos salen de mapgen con las coordenadas, tags y alias de cada punto. Las ids de siempre se conservan: el Soto es `loc_claro`, el Granero Quemado es `loc_ruinas`, la madriguera es `sp_cs_cueva` y el mojón del Lindero es `sp_cs_mojon`.

| # | Lugar | Puntos | Estado | Lo que esconde |
|---|---|---|---|---|
| 1 | **Taberna del Jabalí** (con sótano) | puerta, barra, mesa del fondo, chimenea, trampilla (oculta, CD 14), habitación de arriba (cerrada, se alquila); sótano: escalera, cajas con el sello, barriles, hueco tras el barril (oculto, CD 12) | olor a cerveza y humo; la manta del perro vacía | la trampilla y el libro de cuentas de Vharn |
| 2 | **Plaza del Pozo** | puerta de la taberna, pozo, tablón, portón norte (al Soto y al Lindero), puertas de la herrería y la casona, callejón de la curandera, camino del molino, **camino de los corrales** | el agua del cubo está turbia; la niebla asoma sobre los tejados del norte | la ceniza del pozo la echa Tobías |
| 3 | **La herrería** (de Hugo) | puerta, fragua, yunque, banco, losa suelta (oculta, CD 13) | calor, hierro | los eslabones de hierro frío |
| 4 | **La casona** (del regidor) | zaguán, banco de espera, despacho, arcón de los registros (llave de Garrán), alcoba, **torre del reloj** (sustituye al mirador), **calabozo** (donde encierra Garrán), **bodega tapiada** (oculta, CD 15) | muebles demasiado buenos | la copa de plata con el sello; el escondite de Osric |
| 5 | **Casa de las hierbas** (de Ilse) | puerta, hierbas, caldero, camastro | hierve corteza para la tos | el rito, en su memoria |
| 6 | **El molino** | puerta, muelas, sacos, rueda (senda al Soto), desván (oculto, CD 12), **tejado** (otro mirador) | el agua sale tibia y gris | las cartas de Ysolde y la bolsa de ceniza |
| 7 | **Los Corrales** **[nuevo]** | cancela, gallinero (huevos), redil, huerto (coles), casa de la granja | gallinas pardas, ovejas que tosen | la carta de Pol bajo el colchón |
| 8 | **El Soto** (antes Claro del Roble) | sendero, roble viejo, **madriguera** (la loba y el perro), piedra (bayas), arroyo, choza de pieles (Hal), **senda del granero** | huellas de botas y de perro | por el arroyo pasa Tobías a las 23:00 |
| 9 | **El Granero Quemado** (antes Ruinas de Vharn) | portalón caído, era quemada, pajar hundido (Ysolde), capilla derruida, **pasadizo bajo el altar** (cerrado con la llave de los Vharn) | ceniza tibia, resplandor rojo | bajo el altar, la cripta derrumbada donde duerme la Brasa grande |
| 10 | **El Lindero** **[nuevo]** | final del camino, barricada de los vecinos, mojón de Vharn, borde de la niebla | la niebla quieta, sin olor, que apaga los sonidos | el primer anclaje de la Guarda |

**[cortado]** Cuesta Gris (pie, mojón quemado, lobera, mirador, lo alto) y Cripta de la Brasa (escalera, cadenas rotas, la Brasa, altar).

Al otro lado de la niebla está el **Camino de Valcruz** (`loc_valcruz`, zona «Más allá del Cerco»): un lugar sellado que solo existe para que el Cerco sea una salida con destino. Nadie llega en la demo; el tablero y el mapa de zona lo enseñan como vecino bloqueado. La expansión lo abrirá con un `exit_state` que borre `blocked_by`.

Salidas: taberna-plaza (3 m), trampilla-sótano (3 m), plaza-herrería, plaza-casona, plaza-curandera (25 m), plaza-molino (150 m), plaza-corrales (180 m), portón-Soto (250 m), portón-Lindero (450 m), molino-Soto por el arroyo (220 m), corrales-Soto (200 m), Soto-granero (180 m) y **el Cerco**: borde de la niebla → camino de Valcruz, `blocked_by: 'El Cerco de Ceniza'` con `rebound` (§2.13).

### 2.7 Pistas (11) **[cambia, 2026-10-27: pistas con requisitos]**

`clue_pozo` el agua turbia del pozo · `clue_hacha` el hacha con hollín y las letras T. M. · `clue_doro` luces en el granero y la figura de la senda · `clue_brenna` «no fue un accidente» · `clue_trampilla` el sótano · `clue_libro` la plata entregada a O. Malvez · `clue_ilse` qué es la Brasa y cómo se templa un ascua; «es un cerrojo» · `clue_hugo` la cadena de hierro frío · `clue_tobias` las cartas del desván · `clue_hal` la plata vieja de Hal · `clue_ysolde` la heredera.

Cada pista dice qué revela (`how`) y por dónde se consigue (`sources`), con lo que pide cada camino. `grant_clue` solo la da si el PJ tiene uno abierto; si no, devuelve el motivo para que el máster lo cuente en la ficción. Las **clave** (`key`) tienen al menos dos caminos, y el validador lo exige:

| Pista clave | Caminos (y lo que piden) |
|---|---|
| `clue_ilse` | Ilse, si es amiga · *El agua turbia* (al darle el agua) · Ysolde, si ya le conoce |
| `clue_doro` | Doro, si es amigo o, tras *La cena del portón*, conocido · verlo uno mismo en el arroyo cuando pasa Tobías |
| `clue_brenna` | Brenna, si es amiga (devolverle el perro) · Hugo, si es amigo («lo encerraron») |
| `clue_hugo` | Hugo, si es amigo o conocido sabiendo lo de la Brasa (de parte de Ilse llega como conocido) · la losa suelta, descubierta |
| `clue_libro` | el sótano · *Bajo el Jabalí* |
| `clue_tobias` | el desván, descubierto · Tobías, si es amigo o con las cartas o la bolsa delante |
| `clue_hal` | Hal, si es amigo · lo que hay colgado en el Granero |
| `clue_ysolde` | Ysolde, si ya le conoce o llegas sabiendo algo (Doro, Hal, las cartas, el libro) · Tobías o Hal, si son aliados |

Las de sitio (`clue_pozo`, `clue_hacha`, `clue_trampilla`) se encuentran mirando, con su tirada. `test/confianza.test.ts` comprueba que ninguna clave sale en la primera charla con un extraño, ni tras una tirada buena.

Logro «Quien ha mirado la ceniza» (3 pistas y 5 de reputación en la aldea): **+2 de reputación** y un anuncio público que solo cuenta lo cierto («Se corre la voz por Brezal: {name} ha mirado la ceniza de frente»). No regala contenido: **la trampilla y la llave de los Vharn**, que abre **el pasadizo bajo el altar del Granero**, salen de *Bajo el Jabalí*, con su escena (Brenna enseña la trampilla al dártela y te da la llave al entregarla). **[cambia, 2026-10-27]**

### 2.8 Misiones en tres actos **[cambia, 2026-10-27: misiones al estilo de Baldur's Gate 3]**

El modelo es Baldur's Gate 3 (Obsidian, «Modelo Baldur's Gate 3»), no un MMO: nada flota sobre nadie y no hay mostrador de aceptar (motor en §3, «Historia»).

1. **Disponible** (no se ve): quien la da la tiene si el PJ cumple sus requisitos (nivel mínimo y misión previa).
2. **Te la piden en escena**: al hablar con quien la da (una por charla), o cuando el máster la pide con `story_quest ask`, entra en el Diario ya activa. Aceptar es implícito. Mientras no haya dado ningún paso, el jugador puede **decir que no** (aviso del chat, Diario o de palabra, `story_quest decline`), y el Diario lo apunta («No quisimos ayudar a Brenna»). Quien la pidió no insiste; si el jugador cambia de idea, `story_quest accept`.
3. **Activa** → **lista para entregar** → **entregada**: la recompensa la da quien la recibe (por defecto, quien la dio), al hablar con él.

**Se entra al enterarse.** Nada se abre por pisar un sitio. Lo que se oye por ahí (`rumor`) entra en el Diario como una **pista** hacia quien la da, sin contar de qué va («Hemos oído en la barra que Brenna busca a alguien de fiar»). En la web, un **punto discreto** junto a quien está al final de una pista activa (lo oído, el paso en curso, una pista de la principal, la entrega); en el mapa solo se marca lo que alguien ha dicho dónde está. Los iconos y el ✓ de la barra de misiones se mantienen.

**Diario en primera persona del grupo**: «Brenna nos lo pidió», «Ya lo tenemos todo», «Lo hemos conseguido». Los pasos pueden traer su línea (`journal`), y la muerte o la pérdida quedan escritas: «Hugo murió antes de enseñarnos los eslabones, pero siguen escondidos en su herrería». Los objetivos cambian de texto cuando la misión cambia de camino.

**Plazos por descansos e hitos** (`deadline`), no por horas: avisan antes («⏳ Ceniza no aguantará mucho más en la madriguera: si descansamos otra vez, será tarde») y, al pasar el punto sin vuelta atrás, lo perdido queda en el Diario y en el mundo (`on_lost`).

Los pasos de **llevar algo** se cumplen al dárselo en mano a esa persona (`npc_has`). Lo que «pasa» en la escena (`tell`) lo cuenta el máster. Si **muere alguien** de quien depende una misión, falla o sigue por otro camino (`on_npc_dead`).

**Niveles.** Cada misión tiene `level` (dificultad con color en el Diario: gris, verde, amarillo, naranja, rojo, respecto al nivel del PJ) y `min_level`. El acto I es de nivel 1–2; el **acto II pide nivel 2** (son de nivel 3) y el hilo del acto I de quien la da; el **acto III pide nivel 3** (son de nivel 4).

Los pasos se cumplen solos cuando el motor ve la condición; los marcados *(máster)* los marca el máster con `advance_story`. «Se entrega a» es quien da la recompensa. Las monedas van en cobre (1 de oro = 10 de plata = 100 de cobre), con la propuesta del bloque G.

**Misión principal: un problema con varias pistas** (como «Find a Cure»). Una por situación inicial, activa desde el principio. Cada pista (`optional`) aparece en el Diario cuando alguien la menciona o algo la abre (`revealed_by`); se siguen en cualquier orden y todas llevan al cierre del acto (el Granero, o el libro de cuentas para el hijo del herrero) y de ahí al final.

| Situación | Misión | Pistas (quién o qué la abre) | Cierre del acto | Final |
|---|---|---|---|---|
| La carta (y su compañero) | **La carta de Vharn** | el sello (Ilse, desde el principio) · el pozo (estar en la plaza) · Vharn (lo que contó Ilse, o el perro devuelto: Brenna) · las luces (conocer a Doro) · la cadena (lo que contó Ilse: Hugo) | el Granero Quemado (pista de Ysolde) | cualquier final |
| El hijo del herrero (y su compañero: **Lo prometido**) | **Lo que dejó tu padre** | lo que guarda Hugo · lo que vio Brenna · las luces (Doro) | la prueba de la plata (el libro de cuentas) | cualquier final |
| La deuda | **La deuda con el regidor** | las luces (Doro) · el cazador del Soto (Hal) | saldar la deuda y el Granero Quemado | cualquier final |

**Acto I · Recados que presentan al pueblo** (nivel 1; cada uno deja presentado a quien lo encarga y a quien lo recibe; se alternan los tipos: llevar, preguntar, mirar, recoger)

| Misión | La ofrece | Requisito | Paso | Se entrega a | Recompensa |
|---|---|---|---|---|---|
| **La cena del portón** | Brenna (te da una ración) | — | darle la cena a Doro → conoces a Doro | Brenna | 20, 75 PX |
| **Un jarabe para el molino** | Ilse (te da un tónico) | — | darle el tónico a Mateo → conoces a Mateo | Ilse | 20, 75 PX |
| **La reja del molino** | Mateo | conocer a Mateo | preguntarle a Hugo para cuándo estará la reja → conoces a Hugo | Mateo | 30, 75 PX |
| **La ronda de los Corrales** | Doro | conocer a Doro | mirar la cerca del redil e ir a ver a Úrsula → conoces a Úrsula | Doro | 20, 75 PX |
| **Lo que no cuesta no sana** | Úrsula | conocer a Úrsula | coger dos huevos del ponedero y dárselos a Ilse → conoces a Ilse | Úrsula | 15, 75 PX |
| **Una jarra para el cazador** | Hal | — | darle una cerveza del Jabalí | Hal | 30, 75 PX |

**Acto I · Lo que trae el agua**

| Misión | La ofrece (nivel) | Requisito | Pasos | Se entrega a | Recompensa | Consecuencia |
|---|---|---|---|---|---|---|
| **El agua turbia** (antes *Ceniza en el agua*) | Ilse (1) | — | 1. sacar agua del pozo (pista o llevar el agua) · 2. **dársela a Ilse** *(o enseñársela, máster, con ella delante)* → **pista de la Brasa** | Ilse | 50, 100 PX | se oye hablar del Granero Quemado. Si muere Ilse, falla |
| **Ceniza se ha perdido** | Brenna (2) | — | 1. rastro en el Soto · 2. llegar a la madriguera · 3. sacar al perro *(máster, o la loba muerta)* → el perro corre a la chimenea | Brenna | 100, +2 rep., 150 PX | Brenna pasa a amiga: «Hay cosas que te debo contar». Si muere el perro, falla |
| **Lo que vio Doro** | Doro (2) | *La cena del portón* | 1. que Doro cuente lo que vio (pista) · 2. estar en el arroyo del Soto cuando pasa Tobías (23:00) → conoces a Tobías · 3. descubrir qué lleva (pista, cartas o bolsa) | Doro | 60, +1 rep., 150 PX | se oye hablar del granero |

**Acto II · Lo que esconde Brezal** (nivel 3; piden nivel 2)

| Misión | La ofrece | Requisito | Pasos | Se entrega a | Recompensa | Consecuencia |
|---|---|---|---|---|---|---|
| **Bajo el Jabalí** | Brenna | *Ceniza se ha perdido* | al aceptarla, Brenna **enseña la trampilla** · 1. bajar al sótano · 2. coger el libro → **pista del libro** | Brenna, que da **la llave de los Vharn** | 150, 250 PX | Osric se vuelve hostil-frío; gancho: Garrán entra preguntando quién movió barriles. Si muere Brenna, se cumple al encontrar el libro (sin llave) |
| **La cadena de hierro frío** | Ilse | *El agua turbia* | 1. preguntar a Hugo **en persona** (pista de Hugo) · 2. tener los eslabones · 3. llevárselos a Ilse **y hablar con ella** → aprendes las palabras | Ilse | 150, 300 PX | Hugo pasa a amigo. **Si muere Hugo**: buscar los eslabones en la herrería y llevárselos a Ilse. Si muere Ilse, falla |
| **El hijo del molinero** | Mateo | *Lo que vio Doro* o la pista de Tobías | 1. que Tobías confiese *(máster)* · 2. que pare *(máster, o la bolsa en manos de Mateo)* | Mateo | 150, +2 rep., 250 PX | se cancela la ida nocturna, Tobías se queda en el molino, el pozo se aclara, corre el rumor del chico del molino; **evita la tos gris**. Si muere Tobías, falla |
| **El Granero Quemado** | Hal | *Lo que vio Doro* o *Ceniza se ha perdido* | 1. **la torre del reloj o el tejado del molino** · 2. llegar al granero · 3. **pista de Ysolde** | Hal | 200, 300 PX | Ysolde conocida. Si muere Hal, se cumple sola |

**Acto III · La noche de la Brasa** (nivel 4; piden nivel 3; finales que se excluyen: al cumplirse uno, los otros caducan para todos; no se entregan: se cumplen al dar el último paso)

| Final | Requisito (lo ofrece quien va entre paréntesis) | Pasos | Recompensa | Lo que queda |
|---|---|---|---|---|
| **A · Templar el ascua** (Ilse) **[cambia]** (sustituye a *Atar la Brasa*) | *La cadena* y *El Granero Quemado* | 1. llevar el ascua al pozo: `spot_state sp_pl_pozo ascua: true` *(máster: Ysolde acepta, o se la quitan; CA 12, 22 PG, 2d6 de fuego; o Ysolde muerta)* · 2. estar en el pozo con `it_cadena_fria` · 3. templar *(máster, o `spot_state templado: true`; Atletismo/Arcanos CD 14, 2d6 de fuego por fallo)* | 1000, +3 rep., 700 PX | el pozo claro y frío, la tos se va, Ysolde a la capilla del granero; anuncio público. **El Cerco sigue** |
| **B · La verdad en el pozo** (Brenna) **[cambia]** | *Bajo el Jabalí* y la pista de Ysolde | 1. Brenna acepta hablar *(máster)* · 2. Ysolde baja a la misa *(máster)* → Ysolde junto al pozo · 3. estar en el pozo con las dos (la misa de las 20 trae a Brenna) | 800, +4 rep., 700 PX | Osric **no puede huir**: `npc_status missing` con escondite en la bodega tapiada de la casona; Ysolde amiga, Garrán neutral, la casona vacía |
| **C · Que arda Vharn** (Ysolde) **[cambia]** | la pista de Ysolde | 1. entregarle a Osric *(máster, o Osric muerto)* · 2. dejar que suelte el ascua **en la plaza** *(máster)* | 500, 450 PX | la casona arde, Osric muerto, Brenna hostil; **el humo no sale del valle** |

**Epílogo común** **[nuevo]**: al amanecer del día 6 (108 h después de las 18:00 del día 1), pase lo que pase, la niebla está donde estaba. Ilse sube al tejado del molino, la mira un rato largo y dice: «Cambia. Pero sigue cerrada». Según el final cumplido la niebla **se retira un paso** (A: el mojón queda limpio y frío), **se oye una voz al otro lado** (B: Úrsula corre a la cerca) o **se vuelve roja** (C). El anuncio público cierra: «Brezal sigue sellada. La Guarda de Vharn tiene más nudos», y corre el rumor de la Guarda. Son cuatro escalones a las 108 h: tres variantes con `unless: { kind: 'not', of: <su final> }` y el común, que solo se evitaría si el Cerco se abriera (`spot_state sp_li_niebla abierta`).

### 2.9 Situaciones iniciales (una por personaje, según su clase) **[cambia]**

Todas empiezan a las **18:00 del primer día**, con la misa del pozo dos horas después, y **vencen las tres a los 3 días**, la noche de la Brasa. Quien juega llegó al valle antes de que bajara la niebla, hace tres semanas. No se gastan: dos magos reciben la misma.

| Para | Por qué está aquí | Quiere | Le amenaza | Reloj | Antagonista | Empieza | Primer instante |
|---|---|---|---|---|---|---|---|
| mago, hechicero, brujo, clérigo, druida, bardo | una carta lacrada con el sello de Vharn: «La Brasa despierta. Ven antes de que se cierre el valle»; llegó la víspera de la niebla (la carta la lleva encima) | saber quién la escribió y qué cerrojo ha cerrado el valle | Osric dice que es la maldición de Vharn y vigila a quien pregunta por el granero | 3 días: el ascua se suelta en la plaza | Osric | el pozo | Ilse ve el lacre y le agarra la muñeca |
| guerrero, bárbaro, paladín, explorador, monje | su padre fue el herrero de Vharn; Hugo le llamó y llegó con el último carro | saber cómo murió su padre | Osric tiene a Hugo agarrado y quiere que funda lo que guarda | 3 días: la herrería cerrada y lo de su padre al crisol | Osric | el banco de la herrería | Hugo cierra la puerta; fuera se paran unas botas |
| cualquier otra clase (pícaro…) | llegó herido la víspera de la niebla, Brenna le dio cama a crédito | saldar la deuda y salir del valle en cuanto se pueda | Garrán compró la deuda: 300 en 3 días o ir al granero a «apagar las luces» | 3 días | Garrán | la mesa del fondo | Garrán deja la tablilla: «Y no pienses en la niebla: los deudores no pueden huir» |

El deudor empieza con la deuda anotada (`set_debt`, vence con el reloj), el letrado con la carta en el bolsillo; cada uno conoce ya a quien debe conocer.

### 2.10 La amenaza que escala si nadie interviene **[cambia]**

Tres días desde las 18:00 del día 1 (72 h de juego, 24 h reales al ritmo 3×).

| Cuándo | Escalón | Se evita con | Qué pasa |
|---|---|---|---|
| +10 h (día 2, 04:00) | La tos gris | *El hijo del molinero* | media aldea tose; rumor de la maldición del pozo |
| +20 h (día 2, 14:00) | **Los lobos bajan a los Corrales** | *Ceniza se ha perdido* o la loba muerta | el gallinero de Úrsula reventado y dos ovejas muertas; el lobo se queda en el redil; rumor de la loba |
| +34 h (día 3, 04:00) | **Tobías se esconde en el granero** | *El hijo del molinero* o la pista de Tobías | Tobías pasa a vivir en la era del Granero Quemado |
| +54 h (día 4, 00:00) | Garrán clava la herrería | *La cadena* o alguien con los eslabones | la puerta de la herrería, bloqueada; Hugo bebe en el Jabalí |
| +72 h (día 4, 18:00) | La noche de la Brasa | cualquiera de los tres finales | chispas del granero que la niebla devuelve como ceniza caliente; **Ysolde cruza la plaza con el ascua y se planta en el pozo**; un tejado prende (gancho para el máster) |
| +108 h (día 6, 06:00) | Epílogo | — | §2.8 |

### 2.11 Vida del pueblo

- **Agenda diaria**: mercado (9-13, plaza, Mateo y **Úrsula**; los buhoneros que la niebla dejó dentro), cobro del diezmo (13-14, Garrán y Doro), cena del Jabalí (19-21, Hugo y diez vecinos), misa del pozo (20-21, Ilse y Brenna), **la prueba de la niebla** (22-23, barricada del Lindero: un vecino entra atado a una cuerda y sale por donde entró) **[nuevo]**, la escapada al granero de Tobías (23-24, arroyo del Soto).
- **Rumores que ya corren**: las luces del granero (taberna), la tos gris y el diezmo de la ceniza (plaza), el perro de Brenna (taberna), la plata de los señores (Soto), la rueda que se para (molino) y **lo que dice cada vecino del Cerco** **[nuevo]**:

  | Quién | Dónde corre | Qué dice | ¿Verdad? |
  |---|---|---|---|
  | Osric | la casona | «Es la maldición de Vharn. Quietos y callados, vecinos.» | medio cierta, y le conviene que nadie indague |
  | Ilse | casa de las hierbas | «Es un cerrojo. Y los cerrojos tienen llave.» | cierta |
  | Brenna | taberna | «Bajó el día que volvió una niña que yo saqué del fuego.» | cierta, aunque no sabe quién es |
  | Hugo | herrería | «Mi maestro hablaba de un cinturón de hierro que cerraba el valle.» | parcial: la Guarda tenía hierro frío en sus anclajes |
  | Hal | el Soto | «Un ciervo entró y volvió a salir sin soltar el aliento. Ni la caza pasa.» | cierta |
  | Doro | el Lindero | «Mi tío dijo que es el castigo por cobrar poco diezmo.» | falsa, y revela el miedo de Osric |
  | Garrán | plaza | «Los deudores no pueden huir. Mejor.» | cinismo; está tan encerrado como todos |
  | Mateo | molino | «El grano no llega ni sale.» | cierta |
  | Úrsula | los Corrales | «Mi Pol salió al mercado de Valcruz el día antes. Está al otro lado.» | cierta: gancho de la expansión |

- **Ganchos sembrados**: la corriente fría bajo la alfombra de la mesa del fondo, la voz de Ysolde al llegar al granero, la loba que se levanta al acercarse a la madriguera, **la niebla quieta al llegar al Lindero** **[nuevo]**, Garrán que entra en el Jabalí a la hora y media de empezar.
- **Encuentros de camino** (solo aldea): un vecino con tos, la ronda de Garrán, ceniza que cae y la niebla devuelve, un lobo entre las cercas, un buhonero atrapado, huellas de Tobías y de lobo. **[cambia]**
- **Tablón**: leña y bayas para Brenna, la ronda de Doro al Soto, carbón para Hugo, truchas, la toma del arroyo para Mateo, **huevos para la cena** (Brenna) y **la cerca del redil** (Úrsula) **[nuevo]**. Pagan en plata (27-10-2026): 6 de plata los diez leños; 4 o 5 el carbón, las truchas y las rondas; 1 o 2 las bayas, los huevos o la cerca.
- **Dinero (27-10-2026)**: oro, plata y cobre (`currency` en `index.ts`). El PJ llega con 1 de oro y 5 de plata (`starting_coins`). En el Jabalí, una cerveza vale 4 de cobre, una ración 1 de plata y la noche 2 de plata; Hugo vende a precio SRD (daga 2 de oro, espada corta 10). Las partidas guardadas cogen los precios nuevos al abrirse (`migrate`); el dinero de cada PJ no cambia, solo se enseña en monedas.
- **Casas (27-10-2026)**: cada vecino con casa lleva `home_spot_id` y el máster ve «Vive en Casa de las hierbas (desde aquí, por el callejón de las hierbas)» cuando no está en ella (`homeLine`, `prompt.ts`). Así no se la inventa en otro sitio: en la partida del 27-10 llevó a «la casa de Ilse en el Soto». Su secreto aclara que el parto de la noche del incendio fue en el Soto, lejos de su casa, y la descripción del Soto dice que hoy solo vive allí Hal.

### 2.12 Trasfondo y costumbres **[nuevo]**

Cada vecino y cada lugar tienen ahora un pasado: de dónde viene, qué le hirió, qué gesto lo delata, con quién lo ata. Lo que se ve va en la descripción del NPC o del punto; lo que no se dice, en su secreto. El pueblo tiene además costumbres propias (`CUSTOMS` en `plot.ts`, campo `campaign.customs`), que van en el system prompt cacheado como detalle de fondo: el consejo de los cinco oficios, la noche de prestar la lumbre, «al pozo no se miente: se calla», el fiador del forastero, los mechones en el dintel, «duerme, viejo», los refranes. Nada de eso cambia la trama ni abre pistas nuevas.

Decisiones que tocan la historia de fondo: Garrán atrancó la fragua de Vharn (ver Biblia 2); la noche de la Brasa cae en el aniversario del incendio; Hal es hijo del perrero de Vharn; el marido de Úrsula murió esa noche velando el fuego; Ilse guarda el cuenco del ascua de cuna de Ysolde y sospecha que vive; las palabras del rito están escondidas en la rima de corro, la canción de amasar y una nana, e Ysolde las sabe sin saberlo. El hijo del maestro de Hugo no tiene culpa de nada: puede ser el personaje del jugador. La propuesta completa, con las fuentes de inspiración, está en las notas del proyecto («Trasfondo de Brezal»).

Las partidas guardadas reciben las costumbres al cargar (`migrate`); las descripciones y los secretos nuevos solo llegan a las partidas nuevas.

### 2.13 Las dos piezas de motor de la versión sellada **[nuevo]**

**Chocar con la niebla** (`src/engine/barrier.ts`). Una salida con `state.blocked_by` es una pared para las rutas (movement.ts, fastpath.ts). Si además lleva `state.rebound` (`hours`, `text`, `observable`, `aliases`), quien intenta cruzarla se mete en ella y sale por donde entró: queda en el punto de su lado, con el reloj adelantado `hours` (como tras un viaje rápido) y la narración de la plantilla, sin IA. Se intenta de dos maneras:
- con texto del jugador, que el motor intercepta antes del máster: «cruzo / atravieso / me meto en la niebla», «salgo hacia el camino de Valcruz», «salgo del valle». «Voy a la niebla» o «voy al borde de la niebla» es acercarse a un punto del Lindero, no cruzar;
- con el tool `move_to` hacia el otro lado: devuelve `rebound: true` y el texto que debe narrar. El contexto del máster marca la salida como «no se cruza; el motor le hace volver».
Hay que estar en el Lindero; desde otro sitio, el otro lado no tiene ruta.

**NPC desaparecido con escondite** (`src/engine/story.ts`). El efecto `npc_status` admite `hideout_spot_id`: con `missing`, el NPC se va a ese punto, pierde su horario y deja de hablar con nadie. Sigue vivo, pero no se percibe (tablero, prompt, `who_is_here`, narrador, atajos) ni lo mueven el horario ni la agenda, porque todo eso mira `status === 'alive'`. Cuando un PJ se planta en el escondite (en Brezal, la bodega tapiada de la casona, oculta CD 15), vuelve a estar a la vista allí mismo y el PJ recibe «Das con Osric Malvez, escondido en la bodega tapiada». También es nueva la condición `{ kind: 'not', of }`, que usa el epílogo.

### 2.14 La ley de Brezal **[nuevo]**

Lo que el motor hace cuando alguien comete un crimen delante de la gente (`src/engine/crime.ts`, SPEC §9.4) sale de estos datos (`LAW` en `plot.ts` y `bonds` en `people.ts`):

- **Autoridad**: Garrán (alguacil) y Doro (guardia del portón). Dan el alto, detienen y, si te resistes, pelean.
- **Calabozo**: en la casona (`sp_ca_calabozo`). Muerte, 24 h de juego; agresión con arma o profanar un cadáver, 8 h. Robo (150), agresión sin arma (100): multa; si no puedes pagar, calabozo.
- **Reputación**: lo que se sabe se paga con la aldea de Brezal (`fac_brezal`), tanto como la gravedad.
- **Dueños**: Brenna (taberna y sótano), Hugo (herrería), Osric (casona), Ilse (casa de las hierbas), Mateo (molino), Úrsula (corrales). No sirven ni alojan a quien saben culpable.
- **Carácter**: Hal y Úrsula corren a avisar o se meten; Mateo, Tobías e Ilse huyen; el resto grita y se aparta.
- **Vínculos** (de los `ties` de cada uno): Hugo bebe con Doro (se mete si le hacen daño); Doro es sobrino de Osric (Osric se mete); Garrán es el perro de Osric (se mete por él); Brenna quiere a Doro, aprecia a Ilse y Ceniza es su perro; Mateo y Tobías, padre e hijo; Ysolde, Hal y Tobías se tienen por amigos. Los rivales no reaccionan.

El caso que lo motivó: en la partida del 27-10, Leodhin mató a Hugo en la barra delante de Brenna, Garrán y la cena, y Brenna le alquiló un cuarto. Ahora, en el acto: Brenna retrocede y no le atiende, Garrán le da el alto, los vecinos gritan; está buscado, sin PX y con infamia, y no duerme tranquilo en el Jabalí.

### 2.15 Cómo reacciona el valle **[nuevo, 2026-10-27]**

Etiquetas, reglas y vida diaria en `src/data/campaigns/brezal/reactions.ts` (motor: `src/engine/worldrules.ts`, SPEC §9.4, «hechos y reglas del mundo»):

- **Etiquetas**: *asesino*, *ladrón*, *salvó a Ceniza*, *amigo de Ilse*; y las de raza, clase y trasfondo.
- **La muerte de Hugo**, muera como muera: Doro guarda luto (un tema para el máster: los ojos rojos, aprieta la lanza) y Brenna le guarda el taburete; en la plaza y en el Jabalí se habla del herrero tres días («¿Os habéis enterado de lo del herrero?»), pero solo quien ya lo sabe. Si lo mató un PJ: Doro, −10 cuando le llega la noticia (hostilidad, sumada a lo de crime.ts), y la gente le señala si pasa por delante.
- **Matar a quien no atacaba** (incidente `murder`): la etiqueta *asesino* y −5 de quien lo vio. Con la etiqueta, Garrán le busca en cuanto lo sabe (la caza es de crime.ts) y la gente dice «Ahí va… Garrán anda buscándole». Robar: *ladrón* y −5.
- **Devolver a Ceniza**: Brenna +10, que la vuelve amistosa (sustituye al `attitude: friendly` de `on_complete`); la etiqueta *salvó a Ceniza*; el hecho `ceniza_salvado`; un tema para Brenna y lo que comenta la gente. Si Ceniza se pierde, Brenna no quiere hablar de ello.
- **Ilse**: +5 por cada recado suyo cumplido (`q_agua`, `q_tonico_mateo`, `q_cadena`); a +25, *amigo de Ilse*.
- **Reacciones por etiqueta** (`tag_reactions` en `people.ts`): Doro trata de igual a igual a quien fue soldado (+5 y una opción con Persuasión CD 12); Garrán se vuelve servil con un noble (+5, Intimidación CD 12); Ilse habla de hierbas con un druida (+5, Naturaleza CD 12); Hal, de rastros con un explorador (+5, Supervivencia CD 12); Úrsula trata como a uno del pueblo a un héroe del pueblo (+5). Brenna sirve sin cobrar a quien salvó a Ceniza y teme al asesino.
- **Vida diaria** (`CHATTER`): la plaza de día, el Jabalí por la noche y Mateo en el molino. Ceniza y los lobos son `mute`: ven, pero no cuentan.

---

## 3. Formato de campaña escrita

```
AuthoredCampaign (TS tipado)  ──expandAuthored──▶  WorldSnapshot  ──validateSnapshot──▶  Engine.boot
                                                        ▲
generateSeed: esqueleto + relleno ── buildSnapshot ─────┘ (el mismo validador)
```

- **Tipos del motor tal cual**: `Spot`, `Npc`, `Clue`, `Job`, `Achievement`, `InitialSituation`, `ScheduledEvent`, `EncounterTable`, `Story`. El formato solo quita el estado de partida (descubrimientos, memoria, conversación) y lo que el código sabe poner: la localización de cada punto (van anidados en su lugar), el punto de entrada (el primero), el reloj (`start_hour`) y los instantes de rumores y ganchos (en horas desde que nace el mundo).
- **Extras por NPC**: `spot_id`, `attitude`, `routine`; `knows` y `ties` son para este documento y no llegan al motor.
- **Ejemplares**: `{ at: { spot } | { npc } | { container } }`.
- **Reglas del mundo**: `campaign.tags`, `campaign.reactions` y `campaign.chatter` (vida diaria); por NPC, `tag_reactions` y `mute` (§2.15).
- **Salidas**: `{ id, from, to, distance_m, terrain_multiplier?, state? }`; el Cerco lleva en `state` `blocked_by` y `rebound`.
- **`authoredSeed('brezal', { now })`** devuelve un `WorldSnapshot` como `generateSeed`: nace en `now` a las 18:00 de juego, valida con `validateSnapshot` y lanza si algo no cuadra. Es puro: misma campaña y mismo instante, mismo mundo.
- **`validateSnapshot`** (`src/worldgen/validate.ts`) lo usan los dos caminos. Comprueba ids únicos, referencias, puntos de inicio pisables, que todo el mapa se alcanza desde el inicio (contando salidas cerradas y bloqueadas, que se abren jugando), bloques SRD dentro de rango, comercio con objetos del catálogo, Biblia (5-10) y leyes (3-8), situaciones completas (tres caminos, plazo 1-30), agenda, ganchos, rumores y la historia (también que el escondite de un `npc_status` exista).
- **Situaciones**: la bolsa de la campaña admite `for_classes` (ids SRD) y `keep` (no se gasta); `InitialSituation` admite `debt`, `items` y `knows`. `claimSituation` elige por nombre, luego por clase, luego una de reserva.
- **Historia** (`src/engine/story.ts`): misiones con `act`, `opens_when`, pasos con `done_when` y `on_done`, `reward`, `on_complete`, `exclusive` y `ending`; y la escalada con `after_hours`, `unless` y `effects`. El motor la evalúa en cada tick y tras cada acción; el Diario la enseña (pasos dados y el actual, nunca los siguientes) y el máster la ve en su contexto con el paso en curso y cómo se cumple.
  - **Ciclo de vida** (2026-10-27, modelo Baldur's Gate 3). Cada misión lleva `giver_npc_id` (null solo en la principal, `main_for: [situaciones]`), `level`, `min_level`, `requires` (misión previa, pista, reputación, conocer a alguien), `rumor: { text, where }` (con `{giver}`), `turn_in_npc_id` (por defecto quien la da; null = se cumple sola), `on_accept`, `deadline: { rests?, milestone?, warn_when?, warn, lost, on_lost? }` y `on_npc_dead: [{ npc_id, why, outcome: 'fail' | 'reroute', steps?, turn_in_npc_id? }]`. Los pasos admiten `revealed_by`, `optional` y `journal`. Condiciones nuevas: `escalated` (un escalón de la amenaza, como hito) y `world_hours`. Estado por PJ (`questStatus`): `locked` → `available` → `active` → `ready` → `done` (o `declined`, `failed`, `expired`). Quien la da la pide sola cuando el PJ habla con él (una por charla) y entra activa; el máster la pide, la abre si el PJ cambia de idea, la rechaza o la entrega con `story_quest` (`ask`, `accept`, `decline`, `turn_in`), y el jugador puede decir que no desde la web (`POST /api/quest/answer`). Quien la pide se presenta (`know_npc`) y el origen dice la verdad («Ilse nos lo pidió»). `questLeads` da los NPC al final de una pista activa (van en `BoardPresence.lead`: un punto discreto). Los descansos largos se cuentan desde `character.rest`.
  - **Pedirla por fases.** El contexto y `story_quest` piden contarla así: gancho, problema, detalles solo si los pide y la tarea concreta (qué hacer y a quién), sin preguntar si acepta. El `text` de cada misión y de cada paso dice la tarea; el misterio queda para la escena.
  - **Lista de casos límite** (como Larian en BG3). `validateStory`, con `clueNpcs`, falla si una misión depende de un NPC (un paso `talk`, `npc_has`, `npc_at`, `attitude` o `debt_paid`, la entrega, o una pista que solo da él porque no tiene `location_ids`) y no tiene `on_npc_dead` para él. En un `any`, cuenta solo lo que hace falta en todas las ramas. El otro camino no puede volver a depender del muerto y puede repetir pasos del principal (mismo id y condición), y lo ya hecho cuenta. Brezal la pasa entera.
  - **Una sola voz.** Los `tell` de un paso no salen como texto del motor: si el paso lo provoca un tool del máster (dar el agua con `transfer_item`), la historia avanza en ese mismo tool (`advanceNow`) y vuelve en su respuesta como `story.tell_now`, para contarlo en esa narración; si pasa en un tick, se le planta al máster un gancho para ese PJ (`plantBeat`) que salta en el acto. Sin máster, sale como aviso.
  - Para `give_quest` (encargos libres, fuera de la historia escrita) sigue la regla de antes: con `npc_id`, esa persona tiene que estar con el PJ; si no, `heard`.
  - **Avance por lo que hace el PJ.** Las condiciones del mundo de un paso (`npc_has`, `npc_status`, `npc_at`, `spot_state`) solo cuentan si el PJ está en ese lugar: lo ha hecho él o su grupo delante. `talk` pide estar con ese NPC en persona (hablando o en su punto); en un `all` con un `narrative`, el máster solo puede marcarlo si se cumple lo demás. Otras condiciones: `level`, `reputation`, `debt_paid`, y `npc_has` con `quantity`.
  - **Visibilidad.** Cada alta, paso, cierre o caducidad va al registro del PJ (`character.story.log`) con el porqué en palabras del jugador; sale como aviso de misión en el chat (privado al PJ) y en el Diario, en «Qué ha pasado». El panel marca lo no leído en el icono de misiones (punto con las altas, check con los pasos) hasta que se abre el Diario.
  - **Pistas abiertas o cerradas por reglas.** Una regla del mundo puede abrir o cerrar un paso para un PJ (`lead`, en `character.story.leads`): cerrado, ni se ve ni cuenta; abierto, se ve aunque nadie lo haya mencionado. Condiciones nuevas: `fact`, `tag` y `opinion` (§2.15).
  - **Tablón.** Un encargo entra en el Diario cuando el PJ lo lee (de pie ante un punto con la etiqueta `notice` o con /tablon), no por estar clavado.
- **Confianza y saber por niveles** (`src/engine/trust.ts`, 2026-10-27). Cada NPC lleva `knowledge: [{ tier, text }]` con `tier` = `stranger` | `acquaintance` | `friend` | `ally` (extraño, conocido, amigo, aliado); en campañas escritas sustituye a `secret`, que el formato rellena con la suma de los niveles para el análisis. Sin `knowledge` (mundos generados, partidas de antes), el secreto cuenta como de amigo.
  - **El nivel** sale de `trustTier(npc, pj)`: puntos en `npc.trust[pj]` (conocido 2, amigo 5, aliado 9), con la actitud por encima (hostil o recelosa con ese PJ, extraño; amistosa, al menos amigo; aliada, aliado). Cuando llegue la opinión numérica con umbrales (bloque I), basta con que esta función la lea.
  - **Sube** con misiones cumplidas (+3 a quien la encargó y a quien la recibe), encargos del tablón (+2), recados que le llegan en mano (efecto `trust` con `change: 'errand'`, +2) y, en la charla, regalos (`transfer_item` a un NPC), favores y adulación (`npc_trust`) y Persuasión, Interpretación o Perspicacia con éxito: todo esto, con tope de 1 por conversación (dos charlas a menos de una hora son la misma). El efecto `trust` con `at_least` sube hasta un nivel: en Brezal, ir de parte de Ilse hace a Hugo conocido.
  - **Baja** con amenazas (Intimidación, salga o no, o `npc_trust`), mentiras pilladas (Engaño fallido), insultos, hostigar (`harass`: insistir cuando ya dijo que no, −1 cada vez), ver un crimen (−3) y que le ataquen (−5).
  - **Adular** (`flattery`) depende del carácter: suma con tope a quien lo agradece y resta a quien lleva `dislikes_flattery` (en Brezal, Brenna, Ilse, Hugo, Hal, Ysolde y Úrsula). Su línea en el contexto lo dice («No soporta la adulación»).
  - **Al máster** le llega en «Presentes» el nivel y lo que contaría a ese nivel; si calla algo más, que lo calla y a qué nivel lo contaría, sin el texto. `get_npc` igual; `get_campaign_notes` solo trae las pistas que el PJ ya puede conseguir. Condición nueva `{ kind: 'trust', npc_id, at_least }` (y `{ kind: 'step', quest_id, step_id }`) para pistas y misiones.
  - **Pistas con requisitos**: `clue.sources: [{ via, npc_id?, location_id?, requires?, refusal? }]` y `clue.key`. `clueBlocked` (story.ts) decide `grant_clue`; las que da la historia (un paso, una misión) no pasan por ahí. `validateStory` (con `clues`) exige dos caminos distintos a cada clave: otra persona, otro sitio o una misión que la dé.

## 4. Qué queda de `demo.ts`

`src/data/seed/demo.ts` no se retira: sigue siendo el fixture pequeño y estable de la mayoría de los tests (Kael, Mira, tres lugares), la semilla de la partida principal heredada (`CAMPAIGN_ID=demo`, Discord, scripts de banco y piloto) y la fuente de `DEFAULT_MASTER` y del catálogo común de objetos que usa el generador. El menú ya no lo carga: «Brezal (demo)» crea una partida con `campaign_id: 'brezal'` y el gestor arranca de `authoredSeed`.

## 5. Cómo se juega y se prueba

- Menú web → Nueva partida → «Brezal (demo)». El personaje recibe su situación según la clase.
- `npm test`: `test/brezal.test.ts` valida la campaña (una zona, diez lugares, el Cerco), comprueba los planos, reparte situaciones a 3 días, recorre a pie los diez lugares, completa el acto I, el acto II y el final A por tools (andar, coger, dar, hablar, `story_quest`, `grant_clue`, `discover_spot`, `advance_story`) subiendo de nivel por el camino, prueba los finales B (Osric escondido y encontrado) y C, la escalada hora a hora en tres días, el epílogo de cada final, el choque con la niebla (por texto y por `move_to`) y que el menú carga la campaña.
- `test/confianza.test.ts`: el caso de Ilse (seq 21–24) por el motor, con una Persuasión con éxito: sigue siendo extraño, el máster no recibe la Brasa y `grant_clue` la rechaza con motivo; el tope por charla; Ilse amiga tras *El agua turbia*; el recado de Doro y la llegada de parte de Ilse; las bajadas; que ninguna pista clave salga en la primera charla con un extraño; el validador de dos caminos y las partidas guardadas.
- `test/misiones-progresivas.test.ts`: *La cena del portón* de principio a fin (lo oído como pista, pedida en escena, dar en mano, cobrar), decir que no, el bloqueo por nivel, la principal como problema con pistas, los plazos por descansos y por hito, y los casos de la partida del 2026-10-27 (con el estado real de Leodhin en `test/fixtures/partida-2026-10-27-leodhin.json`: Hugo muerto con *La cadena* abierta).
- Offline (`MASTER_MODE=offline`): se ven lo oído como pista, el punto discreto, la misión que te piden al hablar con quien la da y decir que no (aviso o Diario), igual que ir al Lindero y meterse en la niebla; dar objetos a un NPC y los pasos narrativos necesitan un máster real.

### Nombres que no estorban al atajo determinista

El atajo sin IA (`fastpath.ts`) manda al máster cualquier destino que nombre a una persona, por su nombre o su oficio («voy a casa de Ilse» es «trato con Ilse»). Por eso los lugares no llevan nombre ni oficio de NPC: *La herrería*, *Casa de las hierbas*, *La casona*, *El molino*, *Los Corrales*, *El Soto*, *El Lindero* (el perro se llama Ceniza), *la choza de pieles*, *la casa de la granja*; Ysolde figura solo por su nombre y su papel es «mujer del ascua». Así «salgo hacia Casa de las hierbas» se resuelve sin gastar tokens.

### Ir y hacer en una frase

«Voy a la plaza a por agua» o «voy a la curandera a preguntarle si me puede seguir» traen dos partes. `src/engine/errand.ts` las separa. El destino se resuelve como en `goto.ts`, y también vale el oficio de un NPC sin fijarse en el género («al curandero»). Si la acción nombra algo o a alguien de esa localización, el destino se afina hasta ese punto: el agua está en el pozo. El motor hace el viaje y la acción sale allí en la misma respuesta. Coger, dejar o esperar se resuelven con plantilla. Lo demás va al máster con el bloque «Viaje ya hecho», que le dice que no vuelva a usar `move_to`.

Solo se para antes si algo lo impide: un paso cerrado, un gancho o un evento de paso, un encuentro en el camino, una escena tensa en el destino o que no esté quien se buscaba. En ese caso lo dice, la acción queda pendiente y la frase entera es la primera sugerencia para retomarla.

El máster IA también encadena: con viaje rápido, `move_to` deja al actor ya en el destino (`arrived: true`), y lo que haga después en esa misma acción ocurre allí. En la partida del 2026-10-26, «Ir al pozo y sacar agua» fallaba porque el agua seguía «a 21 m».

## 6. Arte: qué deja de aplicar y qué hace falta **[nuevo]**

Para rehacer el registro de arte y el manifiesto (`assets/campaigns/brezal/manifest.json`; issue #55). El manifiesto busca por id.

- **Deja de aplicar**: vista y plano de `loc_cuesta` (Cuesta Gris, el mirador, la lobera en la montaña), vista y plano de `loc_cripta` (la Cripta de la Brasa con la piedra en su pedestal), y todo lo pintado de las ruinas como ciudadela en la montaña (torre hundida, muralla, patio de armas). La vista de `loc_ruinas` y de `loc_claro` hay que **rehacerla** aunque la id siga: ahora son el granero quemado en el borde del pueblo y una arboleda junto a las casas. El mapa de región ya no tiene montaña jugable ni bosque de Fresnos.
- **Nuevo**: vista y plano de **El Soto** (`loc_claro`: arboleda, roble, arroyo, la madriguera entre las raíces), **El Granero Quemado** (`loc_ruinas`: era de ceniza, pajar hundido, capilla derruida, losa de hierro con el sello tras el altar), **Los Corrales** (`loc_corrales`), **El Lindero** (`loc_lindero`: la pared de niebla quieta, la barricada, el mojón tibio); retrato de **Úrsula** (`npc_ursula`); descubrimientos de `sp_ru_cripta` (el pasadizo bajo el altar) y `sp_ca_bodega` (la bodega tapiada); objetos `it_huevo` y `it_col` si se quieren. La niebla, en el estilo de `docs/ARTE.md`: gris pizarra, sin luz propia, con la única luz cálida fuera de ella.
