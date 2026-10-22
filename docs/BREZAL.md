# Brezal: la demo como campaña escrita

«Las Cenizas de Vharn» deja de ser una semilla hecha a mano para tests y pasa a ser una **campaña escrita**: un mundo fijado de antemano (lugares, gente, Biblia, leyes, agenda, rumores, situaciones iniciales y una historia en tres actos) que entra en el motor por el mismo camino que un mundo generado. El jugador tiene libertad en cada momento; el mundo y su historia ya están decididos.

- Datos: [`src/data/campaigns/brezal/`](../src/data/campaigns/brezal) (mapa, gente, trama, historia, vida del pueblo, objetos).
- Formato: [`src/data/campaigns/format.ts`](../src/data/campaigns/format.ts) y `authoredSeed('brezal')` en [`src/data/campaigns/index.ts`](../src/data/campaigns/index.ts).
- Historia en actos (motor): [`src/engine/story.ts`](../src/engine/story.ts).
- Validador común (generado y escrito): [`src/worldgen/validate.ts`](../src/worldgen/validate.ts).
- Tests: [`test/brezal.test.ts`](../test/brezal.test.ts).

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

| Lo que tiene un mundo generado | Demo antigua | Brezal escrita |
|---|---|---|
| Biblia (5-10 verdades) | no | 8 verdades |
| Leyes del mundo (3-8) | no (las SRD por defecto) | 6 leyes propias |
| Situación inicial por PJ con reloj y antagonista | no: un origen genérico | 3 situaciones por clase, con reloj de 3-5 días, antagonista, deuda u objeto |
| Horarios de NPC | 2 | los 10 vecinos |
| Eventos programados | 2 | 5 (mercado, diezmo, cena, misa, la subida nocturna de Tobías) |
| Deudas | no | la situación del deudor empieza con 300 monedas que debe a Garrán |
| Rumores iniciales | no | 6 |
| Cuarto alquilable | no (la habitación era el premio oculto) | sí: visible, cerrado, Brenna vende la noche |
| Encuentros de camino | tabla por defecto | tablas propias de aldea, bosque y montaña |
| Momentos ilustrables | solo los que salen solos | 11 lugares descritos para la escena de llegada, 10 retratos, la Brasa |
| Misiones encadenadas | no (pistas y tablón sueltos) | 10 misiones en 3 actos, con 3 finales |
| Amenaza que avanza sola | no | 5 escalones en 5 días |

### 1.3 Qué hace que una historia escrita enganche

1. **Un problema personal desde el primer segundo.** No «llegas a una aldea»: Garrán te pone delante una tablilla con tu deuda, una vieja te agarra la muñeca al ver tu carta, el herrero cierra la puerta a tu espalda. La situación inicial es lo primero que pasa.
2. **Un reloj visible.** Cada situación tiene plazo (3, 4 o 5 días) y la amenaza tiene fechas: la tos gris el primer mediodía, los lobos la segunda noche, la herrería clavada al cuarto día, la luna nueva al quinto. El Diario muestra el reloj; el máster sabe cuánto falta.
3. **NPC que quieren algo de ti.** Brenna quiere su perro, Ilse una muestra del agua, Mateo que alguien hable con su hijo, Garrán su dinero, Osric que subas a «apagar las luces», Ysolde un culpable. Cada uno es una puerta.
4. **Progreso en bucles cortos.** Cada misión del acto I se cierra en una o dos horas de juego, con recompensa y una consecuencia a la vista. El tablón da bucles aún más cortos (leña, bayas, truchas) para respirar.
5. **Riesgo real.** La loba de ceniza (CA 14, 37 PG) es demasiado para un nivel 1 a lo bruto: obliga a pensar (fuego, sigilo, ceniza de la cripta). La cripta quema. La deuda vence. Un final oscuro es posible.
6. **Descubrimiento.** Puntos ocultos con CD (la trampilla, el hueco tras el barril, la losa suelta, el desván), un evento nocturno que solo ve quien espera en el arroyo, pistas que cambian lo que sabes de alguien.
7. **Una amenaza que escala.** La Brasa despierta aunque nadie mire. Si el jugador no actúa, el pueblo enferma, los lobos bajan, Tobías se va, la herrería se cierra y la montaña se enciende.

### 1.4 Por qué no basta con escribir texto

La regla del proyecto es que la historia **se revela por tools**: nada existe porque el máster lo diga. Por eso la campaña escrita no es un guion que se le pase al máster, sino datos: cada paso de una misión tiene una condición que el motor comprueba solo (una pista concedida, un punto pisado, un objeto en el bolsillo o entregado, un NPC caído, el estado de un punto), y las consecuencias (un NPC que se va, un rumor, un gancho, un evento en la agenda) las aplica el motor. Solo los pasos que son pura ficción («convencer a Brenna») los marca el máster con `advance_story`, y aun así el motor comprueba que sea el paso en curso.

---

## 2. La historia de Brezal

### 2.1 Premisa

> Hace veinte años el fuego arrasó la ciudadela de Vharn y nadie ha vuelto a subir. La aldea de Brezal vive de espaldas a la montaña, pero el agua del pozo trae ceniza, los lobos bajan y de noche hay luz en la torre hundida.

### 2.2 Biblia (lo que es verdad aunque nadie lo diga)

1. Los señores de Vharn ataban en la cripta de su ciudadela un fuego antiguo, **la Brasa**, con cadenas de hierro frío; mientras dormía atada, el valle era fértil y el arroyo bajaba frío.
2. **El incendio no fue un accidente**: Osric Malvez, entonces mayordomo, robó la plata del sello y prendió el granero para taparlo. El fuego llegó a la cripta, rompió las cadenas y mató a los señores, al herrero de Vharn y al hermano de Brenna.
3. **Brenna** vio a Osric con la antorcha y sacó del fuego a la niña de los señores, Ysolde. Osric le dio la taberna a cambio de callar; ella guarda en el sótano el **libro de cuentas** que apunta la plata entregada a «O. Malvez».
4. **Ysolde Vharn** ha vuelto: vive en la torre hundida con un ascua de la Brasa en la mano. Recuerda a una mujer con antorcha llevándosela y **cree que Brenna prendió el fuego**. Si el valle no confiesa, soltará la Brasa en la luna nueva.
5. La Brasa despierta: calienta la montaña, la caza huye, los lobos bajan, su ceniza sube por el manantial. Además **Tobías** echa cada noche ceniza de la cripta al pozo por encargo de Ysolde: de ahí la tos gris.
6. La Brasa solo se vuelve a atar con **la llave de los Vharn**, **los eslabones de hierro frío** (los guarda Hugo bajo una losa) y **las palabras del altar**, que solo Ilse sabe leer.
7. Osric sabe que alguien vive en las ruinas; manda deudores arriba a través de Garrán y ha ordenado a Hugo fundir los eslabones. Guarda en su arcón una copa con el sello que no se atrevió a fundir.
8. La **loba de ceniza** bajó de la cumbre caliente; no ataca a quien lleva ceniza de la cripta. Tiene acorralado a Ceniza, el perro de Brenna.

### 2.3 Leyes del mundo

1. La magia es rara y temida; la Brasa no es un arma: quema a quien la toca sin el guante de Ysolde.
2. Sin tecnología moderna: hierro, madera, cuerda y fuego.
3. Nada sale de la nada.
4. El cuerpo tiene límites; los prodigios piden tirada.
5. Los muertos no vuelven.
6. El hierro frío no se funde con fuego de fragua corriente.

### 2.4 Facciones y tensiones

- **La aldea de Brezal** (la reputación del logro): tosen gris, pagan el diezmo, rezan en el pozo. Desconfían del forastero hasta que hace algo por ellos.
- **La casona del regidor** (Osric, Garrán, Doro): el diezmo de la ceniza, el portón cerrado, el silencio sobre Vharn. Osric necesita que nadie suba y que lo de arriba desaparezca.
- **La casa de Vharn** (Ysolde, Tobías, Hal): la heredera que quiere justicia o fuego, el chico que quiere ser alguien, el cazador que le lleva caza a cambio de plata vieja.

Tensiones que mueven la historia: Brenna calla por miedo a Osric; Ysolde odia a Brenna por error; Hugo debe dinero a Osric y guarda lo que Osric quiere fundir; Mateo encubre a su hijo; Garrán cobra por cada deudor que no vuelve.

### 2.5 La gente

Bloques SRD de los arquetipos del generador (`ARCHETYPES`, mismos rangos que valida `fill.ts`).

| NPC | Papel | Cómo es | Quiere | Secreto | Sabe | Vende / compra | SRD | Horario (día / tarde / noche) |
|---|---|---|---|---|---|---|---|---|
| **Brenna** | tabernera | 50 años, brazos de amasar, quemadura en la mano; frases cortas, cambia de tema al precio de la cerveza | la taberna en pie, su perro de vuelta, que nadie suba | vio a Osric prender el fuego, salvó a Ysolde, guarda el libro | quién fue, dónde está el libro | cerveza, ración, antorcha, poción, **noche de posada**; compra leña, bayas, truchas, harina | plebeyo, 9 PG | barra / barra / mesa del fondo; misa a las 20 |
| **Doro** | guardia | joven, botas nuevas, habla de más y se corrige | que lo tomen en serio | vio luces y una figura en la senda | la hora de la figura, que su tío paga a Garrán | — | guardia, 11 PG | portón / portón / barra |
| **Osric Malvez** | regidor | 60 años, anillos, sonríe con la boca cerrada, «vecino» | que nadie suba y lo de arriba desaparezca | prendió el fuego, robó la plata, manda deudores arriba | todo | compra el libro y la copa (para destruirlos) | noble, 9 PG | despacho / tablón / alcoba |
| **Garrán** | alguacil y recaudador | ancho como una puerta, nariz rota, cuenta con los dedos | cobrar y no subir nunca | cobra por cada deudor que no vuelve; vio a Ysolde y huyó; sisa el diezmo | quién debe qué; lleva la llave del arcón | — | matón, 30 PG | tablón / barra / banco de la casona |
| **Ilse** | curandera | muy vieja, ojos de agua, mezcla rezo y cocina | curar la tos y dejar el rito en buenas manos | última sacerdotisa de la llama; sabe el rito | qué es la Brasa y cómo se ata | tónico de corteza, poción; compra bayas y agua del pozo | acólito, 9 PG | hierbas / caldero / camastro; dirige la misa |
| **Hugo** | herrero | calvo, quemaduras pequeñas, habla a golpes | pagar a Osric sin traicionar a su maestro | guarda los eslabones bajo la losa; le han ordenado fundirlos | para qué servía la cadena; «no fue el fuego lo que lo mató» | daga, hacha, hachuela, espada corta, escudo; compra leña | matón, 28 PG | fragua / yunque / mesa del Jabalí |
| **Mateo** | molinero | redondo, enharinado, tose gris, chistes malos | que el molino no se pare | encubre a su hijo | a qué hora sale Tobías | harina, raciones; compra truchas y leña | plebeyo, 5 PG | muelas / muelas / sacos |
| **Tobías** | hijo del molinero | 17 años, uñas negras, contesta con preguntas | ser alguien | echa ceniza al pozo para Ysolde; cartas en el desván; el hacha es suya | quién vive arriba, el camino, que la loba respeta la ceniza | — | plebeyo, 6 PG | sacos / roble del claro / desván; a las 23 sube por el arroyo |
| **Ysolde** (Vharn) | mujer del ascua | 25 años, cicatriz de quemadura, un ascua en el guante, habla como en los libros | justicia o fuego | es la heredera; cree culpable a Brenna | su historia, cómo despertar la Brasa (no sabe leer el rito) | compra raciones y el libro | 12 CA, 22 PG, llama de la Brasa 2d6 | torre / torre / capilla |
| **Hal** | cazador | flaco, pieles, mira antes los pies que la cara | que lo dejen en paz | lleva caza a Ysolde por plata del sello | el camino seguro, la lobera, la loba | truchas, flechas, antorchas; compra pieles | explorador, 16 PG | piedra / choza / choza |
| un lobo flaco | lobo | flaco, ceniza en el lomo | hambre | — | — | — | lobo | arroyo del claro |
| **la loba de ceniza** | loba | grande como un poni, humea, ojos de brasa | defender la lobera | no ataca a quien lleva ceniza de la cripta | — | — | 14 CA, 37 PG, 2d6+3 | la lobera |
| **Ceniza** | perro de Brenna | pardo, oreja rota | volver a casa | — | — | — | sin combate | la lobera (luego, la chimenea) |

### 2.6 Lugares

Tres zonas (aldea, bosque de Fresnos, montaña de Vharn), once localizaciones, 57 puntos. Los planos salen de mapgen con las coordenadas, tags y alias de cada punto.

| Lugar | Puntos | Estado | Lo que esconde |
|---|---|---|---|
| **Taberna del Jabalí** | puerta, barra, mesa del fondo, chimenea, trampilla (oculta, CD 14), habitación de arriba (cerrada, se alquila) | olor a cerveza y humo; la manta del perro vacía | la trampilla al sótano bajo la alfombra |
| **Sótano del Jabalí** | escalera, cajas con el sello, barriles, hueco tras el barril (oculto, CD 12) | oscuro, vino agrio | el libro de cuentas de Vharn |
| **Plaza del Pozo** | puerta de la taberna, pozo, tablón, portón norte, puertas de la herrería y la casona, callejón de la curandera, camino del molino | el agua del cubo está turbia | la ceniza del pozo la echa Tobías |
| **La herrería** (de Hugo) | puerta, fragua, yunque, banco, losa suelta (oculta, CD 13) | calor, hierro | los eslabones de hierro frío |
| **La casona** (del regidor) | zaguán, banco de espera, despacho, arcón de los registros (cerrado con llave de Garrán), alcoba | muebles demasiado buenos | la copa de plata con el sello |
| **Casa de las hierbas** (de Ilse) | puerta, hierbas, caldero, camastro | hierve corteza para la tos | el rito, en su memoria |
| **El molino** | puerta, muelas, sacos, rueda (senda al claro), desván (oculto, CD 12) | el agua sale tibia y gris | las cartas de Ysolde y la bolsa de ceniza |
| **Claro del Roble** | sendero, roble viejo, piedra (bayas), arroyo, choza de pieles (Hal), arranque de la cuesta | huellas de botas y de perro | por el arroyo pasa Tobías a las 23:00 |
| **Cuesta Gris** | pie, mojón quemado, lobera, mirador, lo alto | todo gris, azufre | la loba y el perro |
| **Ruinas de Vharn** | puerta rota, patio quemado, torre hundida, capilla, puerta de la cripta (cerrada con la llave de los Vharn) | ceniza tibia, resplandor rojo | Ysolde vive en la torre |
| **Cripta de la Brasa** | escalera, cadenas rotas, la Brasa, altar | calor, la ceniza se mueve | las cadenas rotas: faltan eslabones |

Salidas: taberna-plaza (3 m), trampilla-sótano (3 m), plaza-herrería, plaza-casona, plaza-curandera (25 m), plaza-molino (150 m), portón-claro (600 m), molino-claro por el arroyo (500 m), claro-cuesta (700 m), cuesta-ruinas (400 m), ruinas-cripta (6 m).

### 2.7 Pistas (11)

`clue_pozo` ceniza en el agua · `clue_hacha` el hacha con hollín y las letras T. M. · `clue_doro` luces y la figura de la senda · `clue_brenna` «no fue un accidente» · `clue_trampilla` el sótano · `clue_libro` la plata entregada a O. Malvez · `clue_ilse` qué es la Brasa y cómo se ata · `clue_hugo` la cadena de hierro frío · `clue_tobias` las cartas del desván · `clue_hal` la plata vieja de Hal · `clue_ysolde` la heredera.

Logro «Quien ha mirado la ceniza» (3 pistas y 5 de reputación en la aldea): Brenna enseña la trampilla y da **la llave de los Vharn**, que abre la cripta. Es el camino «amable» al acto III; el otro es romper la puerta (Atletismo CD 18).

### 2.8 Misiones en tres actos

Los pasos se cumplen solos cuando el motor ve la condición; los marcados *(máster)* los marca el máster con `advance_story`.

**Acto I · Lo que trae el agua**

| Misión | Se abre | Pasos | Recompensa | Consecuencia |
|---|---|---|---|---|
| **Ceniza en el agua** (Ilse) | al pisar la plaza o conocer a Ilse | 1. sacar agua del pozo (pista o llevar el agua) · 2. llevársela a Ilse (estar en su casa con el agua) → **pista de la Brasa** | 300, 50 PX | se oye hablar de la cuesta y las ruinas; se abre *La cadena* |
| **Ceniza se ha perdido** (Brenna) | al conocer a Brenna o entrar en el Jabalí | 1. rastro en el claro · 2. llegar a la lobera · 3. sacar al perro *(máster, o la loba muerta)* → el perro corre a la chimenea · 4. volver al Jabalí | 1000, +2 rep., 100 PX | Brenna pasa a amiga: «Hay cosas que te debo contar» |
| **Lo que vio Doro** (Doro) | al pasar por el portón o conocer a Doro | 1. pista de Doro · 2. estar en el arroyo cuando pasa Tobías (23:00) → conoces a Tobías · 3. descubrir qué lleva (pista, cartas o bolsa) | 600, +1 rep., 100 PX | se oye hablar de las ruinas |

**Acto II · Lo que esconde Brezal**

| Misión | Se abre | Pasos | Recompensa | Consecuencia |
|---|---|---|---|---|
| **Bajo el Jabalí** (Brenna) | pista de Brenna, de la trampilla, o el perro devuelto | 1. bajar al sótano · 2. coger el libro → **pista del libro** | 500, 150 PX | Osric se vuelve hostil-frío; gancho: Garrán entra preguntando quién movió barriles |
| **La cadena de hierro frío** (Ilse) | *Ceniza en el agua* cumplida | 1. pista de Hugo · 2. tener los eslabones · 3. llevárselos a Ilse → aprendes el rito | 400, 150 PX | Hugo pasa a amigo |
| **El hijo del molinero** (Mateo) | *Lo que vio Doro*, la pista o las cartas | 1. que Tobías confiese *(máster)* · 2. que pare *(máster, o la bolsa en manos de Mateo)* | 500, +2 rep., 100 PX | se cancela la subida nocturna, Tobías se queda en el molino, el pozo se aclara, corre el rumor del chico del molino; **evita la tos gris** |
| **La cuesta gris** (Hal) | *Lo que vio Doro*, el perro, la pista de Hal o pisar la cuesta | 1. hablar con Hal (o llegar al mirador) · 2. el mirador · 3. las ruinas · 4. **pista de Ysolde** | 600, 200 PX | se oye hablar de la cripta |

**Acto III · La noche de la Brasa** (finales que se excluyen: al cumplirse uno, los otros caducan para todos)

| Final | Se abre | Pasos | Recompensa | Lo que queda |
|---|---|---|---|---|
| **Atar la Brasa** (Ilse) | *La cadena* y *La cuesta* | 1. abrir la cripta (llave o puerta rota) · 2. bajar con los eslabones · 3. atarla *(máster, Atletismo/Arcanos CD 14, 2d6 de fuego por fallo)* | 2000, +3 rep., 700 PX | la Brasa dormida, el pozo claro, Ysolde a la capilla; anuncio público |
| **La verdad en el pozo** (Brenna) | *Bajo el Jabalí* y la pista de Ysolde | 1. Brenna acepta hablar *(máster)* · 2. Ysolde baja a la misa *(máster)* → Ysolde junto al pozo · 3. estar en el pozo con las dos (la misa de las 20 trae a Brenna) | 1500, +4 rep., 700 PX | Osric huye (desaparecido), Ysolde amiga, Garrán neutral, la casona vacía |
| **Que arda Vharn** (Ysolde) | la pista de Ysolde | 1. entregarle a Osric *(máster, o Osric muerto)* · 2. dejar que suelte la Brasa *(máster)* | 1000, 450 PX | la casona arde, Osric muerto, Brenna hostil, cielo rojo |

### 2.9 Situaciones iniciales (una por personaje, según su clase)

Todas empiezan a las **18:00 del primer día**, con la misa del pozo dos horas después. No se gastan: dos magos reciben la misma.

| Para | Por qué está aquí | Quiere | Le amenaza | Reloj | Antagonista | Empieza | Primer instante |
|---|---|---|---|---|---|---|---|
| mago, hechicero, brujo, clérigo, druida, bardo | una carta lacrada con el sello de Vharn: «La Brasa despierta. Sube antes de la luna nueva» (la lleva encima) | saber quién la escribió | Osric vigila a quien pregunta por Vharn | 5 días: la Brasa se suelta | Osric | el pozo | Ilse ve el lacre y le agarra la muñeca |
| guerrero, bárbaro, paladín, explorador, monje | su padre fue el herrero de Vharn; Hugo le ha llamado | saber cómo murió su padre | Osric tiene a Hugo agarrado y quiere que funda lo que guarda | 4 días: la herrería se cierra | Osric | el banco de la herrería | Hugo cierra la puerta; fuera se paran unas botas |
| cualquier otra clase (pícaro…) | llegó herido, Brenna le dio cama a crédito | saldar la deuda y largarse | Garrán compró la deuda: 300 en 3 días o subir a «apagar las luces» | 3 días | Garrán | la mesa del fondo | Garrán deja la tablilla con la cifra y se bebe su cerveza |

El deudor empieza con la deuda anotada (`set_debt`, vence con el reloj), el letrado con la carta en el bolsillo; cada uno conoce ya a quien debe conocer.

### 2.10 La amenaza que escala si nadie interviene

| Cuándo | Escalón | Se evita con | Qué pasa |
|---|---|---|---|
| día 1, 12:00 (18 h) | La tos gris | *El hijo del molinero* | media aldea tose; rumor de la maldición del pozo |
| día 2, 00:00 (30 h) | Los lobos bajan al corral | *Ceniza se ha perdido* o la loba muerta | tres ovejas muertas en el molino; el lobo baja al sendero; rumor de la loba |
| día 3, 00:00 (54 h) | Tobías se va con los de arriba | *El hijo del molinero* o la pista de Tobías | Tobías pasa a vivir en el patio de las ruinas |
| día 4, 12:00 (90 h) | Garrán clava la herrería | *La cadena* o alguien con los eslabones | la puerta de la herrería, bloqueada; Hugo bebe en el Jabalí |
| día 5, 18:00 (120 h) | La noche de la Brasa | cualquiera de los tres finales | cielo rojo, la Brasa despierta, Ysolde junto a ella, un tejado prende en la plaza (gancho para el máster) |

### 2.11 Vida del pueblo

- **Agenda diaria**: mercado (9-13, plaza, Mateo), cobro del diezmo (13-14, Garrán y Doro), cena del Jabalí (19-21, Hugo y diez vecinos), misa del pozo (20-21, Ilse y Brenna), Tobías sube por la senda (23-24, arroyo del claro).
- **Rumores que ya corren**: las luces de Vharn (taberna), la tos gris y el diezmo de la ceniza (plaza), el perro de Brenna (taberna), la plata de los señores (claro), la rueda que se para (molino).
- **Ganchos sembrados**: la corriente fría bajo la alfombra de la mesa del fondo, la voz de Ysolde al llegar a las ruinas, la loba que se levanta al acercarse a la lobera, Garrán que entra en el Jabalí a la hora y media de empezar.
- **Encuentros de camino**: aldea (un vecino con tos, la ronda de Garrán, ceniza que cae), bosque (el lobo, un cepo de Hal, huellas de Tobías y de lobo), montaña (pedregal, grietas que exhalan ascuas, dos lobos de la manada).
- **Tablón**: leña y bayas para Brenna, la ronda de Doro, carbón para Hugo, truchas, la toma del arroyo para Mateo.

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
- **`authoredSeed('brezal', { now })`** devuelve un `WorldSnapshot` como `generateSeed`: nace en `now` a las 18:00 de juego, valida con `validateSnapshot` y lanza si algo no cuadra. Es puro: misma campaña y mismo instante, mismo mundo.
- **`validateSnapshot`** (`src/worldgen/validate.ts`) lo usan los dos caminos. Comprueba ids únicos, referencias, puntos de inicio pisables, que todo el mapa se alcanza desde el inicio, bloques SRD dentro de rango, comercio con objetos del catálogo, Biblia (5-10) y leyes (3-8), situaciones completas (tres caminos, plazo 1-30), agenda, ganchos, rumores y la historia. Al aplicarlo a los mundos generados encontró un fallo real: heredaban la agenda de la demo con puntos que no existían en ellos (corregido en `buildSnapshot`).
- **Situaciones**: la bolsa de la campaña admite `for_classes` (ids SRD) y `keep` (no se gasta); `InitialSituation` admite `debt`, `items` y `knows`. `claimSituation` elige por nombre, luego por clase, luego una de reserva.
- **Historia** (`src/engine/story.ts`): misiones con `act`, `opens_when`, pasos con `done_when` y `on_done`, `reward`, `on_complete`, `exclusive` y `ending`; y la escalada con `after_hours`, `unless` y `effects`. El motor la evalúa en cada tick y tras cada acción; el Diario la enseña (pasos dados y el actual, nunca los siguientes) y el máster la ve en su contexto con el paso en curso y cómo se cumple.

## 4. Qué queda de `demo.ts`

`src/data/seed/demo.ts` no se retira: sigue siendo el fixture pequeño y estable de la mayoría de los tests (Kael, Mira, tres lugares), la semilla de la partida principal heredada (`CAMPAIGN_ID=demo`, Discord, scripts de banco y piloto) y la fuente de `DEFAULT_MASTER` y del catálogo común de objetos que usa el generador. El menú ya no lo carga: «Brezal (demo)» crea una partida con `campaign_id: 'brezal'` y el gestor arranca de `authoredSeed`.

## 5. Cómo se juega y se prueba

- Menú web → Nueva partida → «Brezal (demo)». El personaje recibe su situación según la clase.
- `npm test`: `test/brezal.test.ts` valida la campaña, comprueba los planos, reparte situaciones, recorre las once localizaciones a pie, completa las misiones de los tres actos por tools (andar, coger, dar, `grant_clue`, `discover_spot`, `advance_story`), escala la amenaza y prueba que el menú carga la campaña.
- Offline (`MASTER_MODE=offline`): el acto I de *Ceniza en el agua* se puede jugar sin IA (ir al pozo, coger el agua, ir a casa de Ilse); los pasos narrativos necesitan un máster real.

### Nombres que no estorban al atajo determinista

El atajo sin IA (`fastpath.ts`) manda al máster cualquier destino que nombre a una persona, por su nombre o su oficio («voy a casa de Ilse» es «trato con Ilse»). Por eso los lugares no llevan nombre ni oficio de NPC: *La herrería*, *Casa de las hierbas*, *La casona*, *El molino*, *Cuesta Gris* (el perro se llama Ceniza), *la choza de pieles*; Ysolde figura solo por su nombre y su papel es «mujer del ascua». Así «salgo hacia Casa de las hierbas» se resuelve sin gastar tokens.
