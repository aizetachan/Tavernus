# Acciones conflictivas con NPC: robar, empujar, agarrar, tocar sin permiso (plan)

Estado: **implementado el 06-11** (`src/engine/conflict.ts`; ver «Qué hay implementado» al final, con lo que cambió
respecto a este plan). Cubre lo que el PJ le hace a
un NPC con las manos y contra su voluntad. Los golpes ya los resuelven el combate (`combat.ts`) y el crimen
(`crime.ts`); aquí entran como el último escalón. Todo sale del estado y de los datos de campaña: el motor no sabe de
Brezal ni de ningún NPC concreto.

## Idea en una frase

Cuando el PJ intenta algo invasivo contra un NPC, el **motor** decide si se puede, qué tirada pide, la resuelve, mueve
(o crea) el objeto, y decide cómo se lo toma el NPC según **quién es el PJ para él** y **la relación que tienen**: a un
amigo íntimo le puede parecer una broma; a un desconocido, un delito que acaba en el calabozo o a golpes. El máster
solo lo cuenta, y el cierre rechaza la narración que se lo salte.

## Decisiones de Miguel (06-11)

1. **Un hurto pillado es delito**, y puede acabar en combate. Depende de la relación con ese NPC: con muy buena, se lo
   puede tomar a broma; con alguien que no te conoce o con quien no tienes relación, es delito y te pueden encarcelar.
2. **Un empujón es una agresión**, con la misma regla de la relación.
3. **Lo absurdo** («le arranco la cabeza, me la meto en el bolsillo y salgo volando») lo controlan el máster y el
   narrador: contestan, con ironía, que no se puede. Distinto de lo que las reglas no dejan (sección 5), que lo decide
   el motor.
4. **Echar en falta lo robado y buscarlo** va en la rama de los NPC (el algoritmo de conducta), no aquí. Aquí se deja
   todo lo que necesitan: qué se robó, a quién, cuándo, con qué tirada y quién estaba cerca.
5. **Lo robado siempre existe.** Si sale bien, el objeto acaba en la mochila del PJ. Si no estaba en los datos, se crea
   como objeto nuevo, con una imagen provisional hasta que se pinte. Dónde se guardan los objetos nuevos (base de datos
   o un JSON aparte) está por decidir: aquí todo pasa por una sola función para que dé igual.
6. **Inspiración:** D&D 5e (SRD), Baldur's Gate 3 y Divinity: Original Sin 2 (sección 3).

## 1. Lo que pasó en «Humo y ceniza» (VPS, 06-11)

Pillin, mediano y pícaro (Juego de manos +5, Sigilo +7), con la situación «deuda»: el regidor compró su deuda y Garrán
la cobra. Ojo: **los anillos eran de Osric, el regidor**, no de Garrán. Garrán sale en las respuestas de Osric («Garrán
ya tiene tu cuenta escrita»).

| # | Jugador | Qué pidió el máster | Qué pasó | Qué falla |
|---|---|---|---|---|
| 27-29 | «ponerse detrás de Garrán sigilosamente» | Sigilo CD 13 | 22: llega a su espalda sin que le vea | Bien, pero nada guarda que está oculto |
| 31-33 | «tomar la llave del cinto» | Juego de manos CD 14 | 24: `transfer_item` de la llave | Bien de resultado, pero la CD la inventa el máster (Garrán tiene Percepción pasiva 12) y no hay ventaja por estar oculto |
| 34-36 | «robarle también la bolsa de cuero» | Juego de manos CD 14 | 15: se narra el robo; la bolsa no existía | Robo contado sin objeto |
| 51-53 | «birlar la bolsa» de debajo del banco | Juego de manos CD 13 | 19: se narra; tampoco existía | Igual. Del suelo no es robar a una persona |
| 63-65 | «robarle los anillos de los dedos» a Osric, **hablando cara a cara** | Juego de manos CD 13, sin desventaja | 12: falla; Osric cierra la mano y advierte | Quitar un anillo **puesto** a quien **te está hablando** no es una tirada. El fallo no deja nada: Osric sigue `neutral`, sin incidente ni confianza perdida |
| 66-68 | «volver a intentar robarle el anillo» | CD 15 | 13: falla | Se puede repetir sin más. Osric repite «ve a la taberna, Garrán…» |
| 69-71 | «robarle los anillos» (3.ª) | CD 15 | 11: falla. «A la tercera ya no es descuido, es costumbre» | Ni grita, ni llama a nadie, ni se aparta |
| 72-74 | «robarle los anillos» (4.ª) | **CD 14** (baja tras tres fallos) | 20: «el anillo cede… no se ha dado cuenta» | Cuatro intentos en cinco minutos y la CD baja. Sin `transfer_item`: el anillo no existe |
| 93-95 | «robarle el martillo de fragua» a Hugo, a su lado | Juego de manos CD 13 | 21: el máster intenta `spawn_item`, se rechaza y narra que no lo coge | Un martillo de fragua no se quita a escondidas de un cinto. Y con 21 salió bien y no tuvo nada |

Al final Osric tiene **ocho memorias** de «intentó quitarle un anillo» y la actitud intacta. Las causas:

1. **El máster decide si hay tirada, cuál, la CD y la ventaja.** Nada mira dónde lleva el NPC el objeto ni si está
   mirando al PJ.
2. **Un intento fallido no existe para el motor.** El robo solo se registra al mover el objeto (`transfer_item`): si no
   se mueve nada, no hay incidente, ni actitud, ni confianza, ni testigos.
3. **Nada impide repetir.** No hay estado de «en guardia».
4. **Un robo que sale bien puede no dar nada**, porque el objeto no está en los datos.
5. **La reacción sale de lo que no toca.** Osric no sabía quién era Pillin, pero `terms` (lo suyo con el actor: la
   deuda que compró) le dictaba el guion, y cada intento acababa en «ve a la taberna, que Garrán te espera».

## 2. Dónde encaja

En el flujo de charla (`docs/CONVERSACION-FLUJO.md`, rama `claude/nervous-lederberg-e007cb`):

- **Capa 0:** «roba a escondidas, empuja, agarra» no es hablarle. No hay guion de charla; hay **guion de conflicto**.
- **Capa 1:** lo que deja el conflicto es una **bandera** para los turnos siguientes: «le acaban de pillar robándole»,
  «le acaban de empujar», «sabe que el PJ ha robado». La primera frase del NPC es la reacción (hueco A) y, si es grave,
  bloquea la charla.
- **Capa 2:** «¿qué sabe del PJ?» es lo primero que mira también el conflicto (sección 4).
- **Capa 3:** la escalada **insulto, insistencia, amenaza, violencia se mantiene**. Lo de aquí la empuja con los mismos
  mecanismos (confianza, opinión, actitud), no con una escalera paralela.

En el crimen (`crime.ts`) se reutilizan los testigos, la reacción por papel, el alto, el calabozo, la multa, el buscado y
los rumores.

## 3. De dónde sale cada regla

| Regla | De dónde |
|---|---|
| Juego de manos contra la Percepción del objetivo, pasiva si no está alerta | SRD 5.1: Juego de manos («quitarle a alguien la bolsa del cinto»), tiradas pasivas y enfrentadas |
| Empujar y agarrar: Atletismo contra Atletismo o Acrobacias; derribado, agarrado | SRD 5.1: Empujar a una criatura, Agarre, condiciones |
| Ventaja si no te ve; ±5 a la pasiva con ventaja o desventaja | SRD 5.1: atacantes no vistos, tiradas pasivas |
| Hay que ir a escondidas para hurtar; lo que lleva **puesto** no se roba | BG3: robar solo en sigilo y fuera de la vista; el equipo puesto no se puede robar |
| Lo pesado y lo valioso, más difícil | BG3: la dificultad del hurto sube con el peso y el valor |
| Si te pillan, el NPC te encara antes que nada: devolverlo, convencerle, pagar o pelear | BG3 y DOS2: el diálogo de «te he visto» al pillarte |
| Con buena relación es más fácil salir del paso | DOS2: la actitud del NPC cambia lo que cuesta persuadirle |
| Lo robado queda marcado como robado y el dueño lo reconoce | BG3 y DOS2: objetos «robados»; el dueño los reclama si los ve |
| El dueño echa en falta lo suyo y lo busca | DOS2: el NPC nota que le falta algo y registra a los sospechosos (va en la rama de los NPC) |
| Los testigos avisan a la guardia; multa, calabozo o pelea | BG3 y DOS2, y lo que ya hace `crime.ts` |
| Un fallo nunca deja las cosas igual que antes | Blades in the Dark y PbtA |

## 4. Primero: quién es el PJ para este NPC, y qué relación tienen

### Qué sabe del PJ

La capa 2 del flujo. Si el flujo aún no está, una función mínima en `conflict.ts` que el flujo adopte después.

| Sabe | Cuándo | Cómo le nombra al reaccionar | Qué cuenta luego a otros |
|---|---|---|---|
| Nada | No han hablado, no está en su situación, no sabe nada de él | Por lo que ve: «¡Eh, tú, el mediano!», «¡Al ladrón!» | «un mediano forastero», no su nombre |
| De oídas | Es parte de su situación (antagonista, cobra su deuda), conoce un crimen suyo o una etiqueta | Por lo que sabe: «¡El de la deuda!» | Lo que sabe: «el deudor del Jabalí» |
| Se conocen | Han hablado (memoria, transcripción) o les juntó la apertura | Por su nombre si lo sabe; si no, como se conocen | Su nombre si lo sabe |

Arreglo de paso: hoy el incidente y el rumor usan siempre el nombre del PJ («dicen que Pillin le robó al regidor») aunque
nadie lo sepa. Con esta tabla, el incidente guarda cómo le llama cada testigo.

### La relación decide si es broma o delito

La relación sale de lo que ya hay: la **opinión** (`opinionOf`, de −100 a 100, `standing.ts`) y el **trato**
(`talkTier`: hostil, receloso, extraño, conocido, amigo, aliado, `trust.ts`). Se toma la banda más baja de las dos.

| Relación | Cuándo | Si le pilla hurtando o le empuja |
|---|---|---|
| **Íntima** | aliado, u opinión ≥ +40 | **Broma.** «¡Serás…! Trae aquí.» Lo recupera (el motor lo devuelve) o se lo deja si es poca cosa. Sin incidente. Opinión −1. Una segunda vez el mismo día ya no es broma: baja a la fila siguiente |
| **Buena** | amigo, u opinión ≥ +10 | **Reproche.** Le encara y exige que se lo devuelva. Si lo devuelve, queda entre ellos (sin incidente; opinión −5, confianza −2). Si no, o si lo repite, delito |
| **Conocidos** | conocido, opinión entre −10 y +10 | **Careo** (sección 7): devolverlo y convencerle (Persuasión o Engaño, CD 12) lo deja en advertencia (incidente leve, sin alto). Si no, delito |
| **Ninguna o mala** | extraño, receloso, hostil, u opinión ≤ −10 | **Delito.** Robo (`theft`) o agresión (`assault`), gravedad 2: alto si hay autoridad o la avisan, calabozo o multa (`crime.ts`). Careo con CD 17 (receloso u hostil: no hay careo, va directo) |

- **Los testigos siguen a la víctima.** Si la víctima se lo toma a broma, los demás miran y nada más. Si para ella es
  delito, cada testigo reacciona por su papel, como hoy (`crime.ts`).
- **La autoridad, cuando la víctima es ella:** con relación íntima o buena, igual que cualquiera; con conocidos o
  menos, el alto es directo.
- **Arrebatar a la vista, a quien no es íntimo, es siempre delito**: no hay careo que lo arregle.

## 5. Lo que se puede y lo que no

Hay dos clases de «no se puede», y no las resuelve el mismo:

| Clase | Ejemplo | Quién lo decide | Qué pasa |
|---|---|---|---|
| **Absurdo** | «le arranco la cabeza, me la meto en el bolsillo y salgo volando» | El máster (y el narrador) | Contesta, con ironía y en la voz de la escena, que no se puede. Nada cambia en el estado; el cierre ya rechaza que algo cambie sin su tool |
| **Lo que las reglas no dejan** | quitarle un anillo puesto a quien te está hablando | El motor (sección 6) | Sin tirada: el máster cuenta qué lo impide y qué haría falta. Si el jugador lo hace igualmente, es un intento a la vista: le pilla |

## 6. Las acciones y sus tiradas

| Acción | Ejemplos | Tirada del PJ | Contra | Si sale bien | Si se ve |
|---|---|---|---|---|---|
| **Hurtar** (sin que se note) | «le birlo la bolsa», «le quito la llave del cinto» | Juego de manos (DES) | Percepción pasiva si está desprevenido; enfrentada si está atento | El objeto pasa a la mochila del PJ; el NPC no lo nota ahora | Robo, según la relación |
| **Arrebatar** (a la vista) | «le arranco la bolsa», «le quito el martillo de un tirón» | Atletismo (FUE) | Atletismo o Acrobacias del NPC | El objeto pasa al PJ; el NPC lo ve siempre | Robo (delito salvo relación íntima) |
| **Empujar** | «le empujo», «le tiro al suelo» | Atletismo | Atletismo o Acrobacias | Le aparta 1,5 m o le tira al suelo (derribado) | Agresión, según la relación |
| **Agarrar o sujetar** | «le agarro del brazo» | Atletismo | Atletismo o Acrobacias | Agarrado (condición SRD) | Agresión, según la relación |
| **Tocar sin permiso** | «le toco el pelo», «le quito el sombrero» | Ninguna | | Pasa | Un escalón de la escalada (como un insulto); repetido, agresión |
| **Golpear** | «le pego» | Ataque (ya existe) | CA | Daño (ya existe) | Agresión o agresión con arma (ya existe) |

Las tiradas del NPC salen de sus datos: Percepción = `passive_perception − 10`. El bloque de combate (`NpcStats`) no
guarda características, así que Atletismo o Acrobacias se deducen del ataque cuerpo a cuerpo: `attack_bonus − 2`; +0
si no es de pelear o no tiene bloque. Un campo opcional `contest` en sus datos lo fija a mano. Los NPC sin bloque
(`stats: null`, un perro) o mudos no entran en estas reglas.

### Hurtar: dónde lo lleva

Hoy el ejemplar de un NPC no dice dónde va (`{ type: 'npc', id }`). Un campo opcional `on` en el ejemplar y, sin él, se
deduce del objeto:

| Dónde | Se deduce de | Ejemplos |
|---|---|---|
| Puesto | `equip_slot` de joya, ropa o armadura (`ring1`, `ring2`, `neck`, `head`, `body`, `hands`, `feet`) | anillos, collar, capa |
| En la mano | `on: 'hand'`, de los datos o porque el máster lo marca con una tool («saca el sello») | el sello, una jarra, el arma desenvainada |
| Al cinto | armas envainadas, contenedores pequeños, `equip_slot: 'belt'` | bolsa de monedas, llave, maza |
| En un bolsillo | diminuto o pequeño sin lo anterior | una carta, un amuleto |
| Dentro de otra cosa | el ejemplar está en un contenedor que lleva | lo que hay dentro de la bolsa |
| Mochila o fardo | contenedor grande a la espalda | |

### Hurtar: el estado del NPC respecto al PJ

| Estado | Cuándo (del estado, no del texto del máster) |
|---|---|
| Indefenso | inconsciente, dormido o atado |
| Desprevenido | el PJ está **oculto** (Sigilo superado contra su pasiva en este rato, que ahora se guarda), le distrae otro (ayuda de un compañero), o está a lo suyo (su actividad del horario) y el PJ no le habla |
| Atento | lo normal: el PJ está a la vista en su punto |
| Le está mirando | habla con el PJ ahora, o el PJ acaba de hablarle o de hacerle algo |
| En guardia | ya le pilló (o casi) un intento de este PJ, le acaba de empujar o tocar, es hostil, o hay combate en el sitio |

### Hurtar: la tabla

| Lo lleva… | Indefenso | Desprevenido | Atento | Le está mirando | En guardia |
|---|---|---|---|---|---|
| En un bolsillo o al cinto | Sin tirada | JdM contra su pasiva | Enfrentada | Enfrentada, con desventaja | **No se puede** |
| Dentro de algo que lleva | Sin tirada | Con desventaja | Enfrentada, con desventaja | **No se puede** | **No se puede** |
| En la mochila o fardo | Sin tirada | Contra su pasiva | Enfrentada, con desventaja | **No se puede** | **No se puede** |
| Puesto (anillo, collar, ropa) | Sin tirada (lleva su tiempo) | **No se puede** | **No se puede** | **No se puede** | **No se puede** |
| En la mano | Sin tirada | Solo arrebatar | Solo arrebatar | Solo arrebatar | Solo arrebatar |
| Grande (mediano o más: martillo de fragua, espada larga, escudo) | Sin tirada | Con desventaja | Solo arrebatar | Solo arrebatar | Solo arrebatar |

- **Ventaja** si el PJ está oculto o le ayuda un compañero; se anula con la desventaja, como en el SRD.
- **Lo valioso cuesta más** (BG3): +2 a la CD o a la tirada del NPC si el objeto vale más de lo que el NPC lleva
  suelto encima (más que su bolsa).
- **Sin tirada, pero con testigos:** a quien está indefenso se le quita sin tirada, y quien lo vea lo ve como un robo
  (ya funciona así).
- **Un intento por objeto, NPC y rato.** Lo intentado no se repite con ese NPC mientras esté en guardia.

### El resultado

| Resultado | Qué pasa |
|---|---|
| Éxito | El motor mueve el objeto a la mochila del PJ (o lo crea, sección 8), marcado como robado. El NPC no lo nota ahora |
| Fallo por 1 a 4, estando desprevenido | **Casi**: no le pilla, pero se palpa el cinto o se vuelve. Queda en guardia. Nada se mueve. Sin incidente |
| Fallo por 5 o más, o perder la enfrentada | **Le pilla**: reacción según la relación (sección 4) y queda en guardia |
| 1 natural | Le pilla **con la mano dentro**: lo anterior y, si el NPC puede pelear y la relación no es íntima, le agarra de la muñeca (agarrado) |

### En guardia

Un estado nuevo por NPC y PJ (`npc.guard[pj]`): desde cuándo, hasta cuándo y por qué. Mientras dure, nada de hurtos
contra él y nunca está desprevenido con ese PJ. El contexto del máster lo dice en la línea del NPC («no le quita ojo a
Pillin: le pilló metiéndole la mano»). Dura **12 horas de juego**; después, el resto del día, ese NPC tampoco está
desprevenido con ese PJ (propuesta: Miguel no lo ha cambiado).

## 7. Pillado: el careo

Como en BG3 y DOS2, al pillarle el NPC no salta directamente a la guardia ni a la pelea (salvo que la relación sea
mala): le encara. El motor abre un **careo** (`npc.confront[pj]`) con lo que exige, y lo dice en el contexto y en los
botones:

| Botón | Qué hace el motor |
|---|---|
| **Devolvérselo** | Mueve el objeto de vuelta. Con relación buena, queda entre ellos; con conocidos, advertencia (incidente leve, sin alto) |
| **Convencerle** (Persuasión o Engaño) | Tirada contra la CD de la relación (conocidos 12, ninguna 17). Éxito: advertencia y se lo devuelve. Fallo: delito |
| **Pagarle** | Le paga el valor del objeto (o la multa del robo, si es más). Con conocidos, advertencia; con ninguna relación, rebaja a multa sin calabozo |
| **Huir o pelear** | Delito: el incidente sube a robo o agresión; la autoridad le da el alto; el luchador pelea (hostil y combate) |

- Si el jugador hace otra cosa, el careo cuenta como rechazado al acabar ese turno.
- Lo que se dice va con la voz del NPC según quién es el PJ para él (sección 4) y su carácter.
- Lo que se haga en el careo usa lo de `crime.ts`: el alto y el botón «Entregarme» (calabozo o multa) ya existen.

## 8. Lo robado siempre existe

Decisión de Miguel: un robo que sale bien siempre da un objeto, y va a la mochila.

- **Si está en los datos** (lo que «Lleva» el NPC, el ajuar de la rama de objetos), se mueve ese ejemplar.
- **Si no está**, se crea: `conflict_act` acepta, en vez de `instance_id`, un objeto nuevo (`new_item`: nombre, qué es,
  tamaño). El motor lo pone primero en el NPC (con su `on`) y la tabla se aplica igual: si es un anillo, está puesto. Si
  sale bien, va a la mochila del PJ.
- **Límites, para que no se invente un tesoro:** el valor no pasa de lo que corresponde a ese NPC (su riqueza en los
  datos, o el ajuar de su oficio); nada mágico ni único; un objeto nuevo por NPC y clase («un anillo»: si ya le creó
  uno, es ese); tiene que poder llevarlo encima. Si no cumple, el motor lo rechaza con el motivo y el máster cuenta que
  no lo encuentra.
- **Marcado como robado:** el ejemplar guarda a quién era, cuándo, la tirada y quién estaba cerca
  (`state.stolen`). Lo usan la rama de los NPC (echarlo en falta y buscarlo) y el dueño que lo reconoce si lo ve.
- **Imagen:** un objeto nuevo lleva una imagen provisional hasta que se pinte; no se gasta API al robarlo.
- **Dónde se guarda:** se crea con una sola función (`createItem`), que hoy escribe en `item_defs` del mundo, como ya
  hacen los cuerpos (`death.ts`). Si se decide guardarlo en base de datos o en un JSON aparte, se cambia esa función.
- **La mochila:** el contenedor que lleva a la espalda; si no lleva, un bolsillo; si no cabe, a la mano libre; si
  tampoco, el robo no se puede (no hay dónde meterlo).

Esto cambia lo que dice hoy el cierre de la rama `claude/objetos-reales` («si no lo lleva, no existe: cuenta que no lo
encuentra»): con esto, si es razonable que lo lleve, se crea con `conflict_act`.

## 9. Cómo reacciona el NPC: perfil y escalada

La relación (sección 4) decide si es broma o delito. El perfil decide **qué hace** cuando es delito o reproche.

### El perfil, de los datos

| Perfil | De dónde sale |
|---|---|
| Autoridad | `law.enforcers`, o rol de guardia (ya existe en `crime.ts`) |
| Dueño | `law.owners` en su local (ya existe) |
| Luchador | tiene bloque de combate y no es `noncombatant` |
| Valiente | `law.temperament: 'brave'` (ya existe) |
| Corriente | el resto |
| Tímido | `law.temperament: 'timid'` (ya existe) |
| Niño | un campo nuevo en los datos del NPC, `child: true`, para que reaccione como un niño (llora, corre a por los suyos) y no como un adulto. En Brezal no hay ninguno; lo pueden usar los mundos generados y los NPC de relleno |

Si tiene varios, manda el primero de la lista. Los **allegados** (`bonds`) reaccionan como hoy: los que tienen
`reaction: 'fight'` se meten si es grave.

### Qué hace cada uno (relación conocidos o menos)

| Lo que acaba de hacer | Autoridad | Dueño (en su local) | Luchador | Valiente | Corriente | Tímido | Niño |
|---|---|---|---|---|---|---|---|
| **Tocar sin permiso** (1.ª vez) | Le aparta la mano y le advierte | «Aquí, las manos quietas» | Le aparta de un manotazo | Se encara | Se aparta y protesta | Se encoge y se aparta | Se aparta |
| **Tocar otra vez, empujar o agarrar** | Alto por agresión | Le echa del local y no le sirve; avisa a la guardia | Le devuelve el empujón; si sigue, pelea | Grita, le encara y avisa a la guardia | Grita y alguien avisa a la guardia | Huye | Huye llorando a los suyos |
| **Hurto casi pillado** | En guardia | En guardia | En guardia, la mano en la bolsa | En guardia | En guardia | Se aparta | Se aparta |
| **Hurto pillado** | Careo corto y alto | Careo; si no, «¡al ladrón!», le echa, avisa | Careo agarrándole la muñeca; si no, pelea | Careo; si no, le encara y grita | Careo; si no, «¡al ladrón!» y corre a avisar | Se aparta y avisa después | Grita y corre a los suyos |
| **Arrebatar** | Alto; si huye, le persigue | «¡Al ladrón!», avisa a la guardia | Pelea por recuperarlo | Le persigue y grita | Grita y avisa | Huye | Llora y avisa a los suyos |
| **Golpear** | Como hoy (`crime.ts`) | Como hoy | Como hoy | Como hoy | Como hoy | Como hoy | Como hoy |

Con relación íntima o buena, cada casilla baja un escalón (la broma o el reproche de la sección 4); a la segunda en el
mismo día, vuelve a la tabla.

- **Testigos:** lo de `crime.ts`. El hurto se ve de cerca; empujar o arrebatar, en toda la sala.
- **Confianza y opinión:** cambios nuevos en `TRUST_CHANGES` (`touched` −1, `shoved` −2, `caught_stealing` −3,
  `snatched` −4) y en la opinión (−1 la broma, −5 el reproche, −10 el delito). La actitud baja a recelosa; el luchador
  que pelea pasa a hostil y entra en el combate (`encounterAt`), como ya hace `crime.ts`.
- **Después:** quien le pilló sabe que el PJ ha robado. La bandera de la capa 1 del flujo hace que la próxima charla
  empiece por eso, y `refusesService` ya hace que el dueño no le sirva.

## 10. Qué decide el motor y qué narra el máster

| Lo decide el motor | Lo narra el máster |
|---|---|
| Que es una acción conflictiva, contra quién y sobre qué objeto | El intento: cómo se acerca, qué hace con las manos |
| Qué sabe el NPC del PJ, la relación y el perfil | La voz del NPC, con su carácter |
| Si se puede, la tirada (habilidad, CD o enfrentada, ventaja) o por qué no | Por qué no se puede, contado en la escena |
| El resultado, el objeto que se mueve o se crea, y las monedas | El resultado, sin contradecirlo |
| Broma, reproche, careo o delito; en guardia, incidente, testigos, confianza, opinión, alto, órdenes | La reacción de cada uno, en el orden que la da el motor |
| Los botones del careo | Las palabras del careo |
| | Lo absurdo: que no se puede, con ironía |

### Cómo llega al máster

1. **Antes del máster** (`Engine.act`, junto a `tryLaw`): `conflictPlan` lee si el texto es hurtar, arrebatar,
   empujar, agarrar o tocar a un NPC presente, y qué objeto. Si lo tiene claro, calcula el veredicto. El contexto
   lleva un bloque:

   ```
   ## Acción conflictiva: lo ha decidido el motor
   Pillin intenta quitarle un anillo a Osric (el regidor). Osric no sabe quién es (sin relación); le está mirando:
   hablan ahora mismo. Los anillos los lleva puestos.
   Veredicto: NO SE PUEDE, sin tirada. No se lo quita. Cuenta qué lo impide; si insiste, es un intento a la vista.
   Prohibido: pedir tirada; narrar que el anillo cambia de manos; contestar con la deuda.
   ```

2. **La tool `conflict_act`** (`npc_id`, `kind`: `steal` | `snatch` | `shove` | `grab` | `touch`, `instance_id` o
   `new_item`): la única forma de pedir una tirada contra un NPC por estas acciones y de quitarle algo despierto.
   Devuelve el veredicto. Si hay tirada, el servidor la fija en `log_event` (la del máster se sustituye por la suya).

3. **Tras la tirada** (`rollPending`, igual que `trustFromRoll` hoy): el motor resuelve antes de que el máster narre:
   mueve o crea el objeto, abre el careo o registra el incidente, pone en guardia, da las órdenes.

4. **En el careo**, el turno siguiente del PJ lo lee el motor antes del máster («se lo devuelvo», «le pago», los
   botones) y lo resuelve como hoy resuelve «me entrego».

5. **Máster offline:** una plantilla por veredicto y por casilla de reacción.

### Guion de la reacción

Cuando el NPC reacciona, el guion de ese turno es **solo** la reacción: primero lo que da el motor, con las palabras de
quién es el PJ para él; luego lo que hace (careo, avisar, echarle). Prohibido: lo suyo con el actor (la deuda,
encargos), comercio, misiones y seguir la charla como si nada. Longitud: 30 palabras de lo que dice el NPC. Esto
arregla lo de Osric: en un turno de robo, `terms` no entra.

## 11. Qué se comprueba al cierre

En `log_event` (`tools.ts`) con funciones puras en `closecheck.ts`. Si falla, una reescritura con el motivo.

| Comprueba | Si falla |
|---|---|
| El plan del turno es una acción conflictiva y el máster no ha llamado a `conflict_act` ni ha contado que no se puede | «Usa conflict_act: el motor decide si se puede y con qué tirada» |
| `requires_roll` de Juego de manos, Atletismo o Acrobacias contra un NPC sin `conflict_act` | Lo mismo |
| `requires_roll` distinta de la del veredicto | Se sustituye en silencio por la del motor |
| Veredicto «no se puede» y la narración pide tirada o cuenta que el objeto cambia de manos | Reescribir con el veredicto |
| `transfer_item` desde un NPC despierto al actor en un turno que suena a robo, sin éxito de `conflict_act` | Rechazo |
| `spawn_item` para algo robado | Rechazo: «usa conflict_act con new_item» |
| Le ha pillado (o le han empujado o tocado) y la narración no nombra la reacción del NPC | Reescribir con la reacción del motor (`unnarratedReactors`, ya existe) |
| En un turno de reacción, la línea del NPC habla de la deuda, de encargos o de comercio en vez de reaccionar | Reescribir: primero la reacción |
| Hay careo y la narración lo da por resuelto (lo devuelve, le perdona) sin que el jugador lo haya elegido | Reescribir: el careo lo decide el jugador |

## 12. Fases, con sus tests

Todas sin API: funciones puras y el motor con el máster offline o un cliente con respuestas escritas a mano.

| Fase | Qué | Ficheros | Tests |
|---|---|---|---|
| 1 | **El veredicto, puro.** `carriedOn`, `pcKnownAs`, `relationOf` (broma, reproche, careo, delito), `awareness`, `conflictProfile`, `stealVerdict`, `contestVerdict`. Modelo: `on` en el ejemplar, `npc.guard`, `npc.confront`, `child`, `contest` | `src/engine/conflict.ts` (nuevo), `model.ts` | `test/conflict.test.ts`: cada casilla de las tablas de las secciones 4 y 6, y los perfiles |
| 2 | **La tool, la tirada y el objeto.** `conflict_act`, la tirada fijada por el servidor, la resolución en `rollPending`, mover a la mochila, `createItem` con sus límites y `state.stolen`, en guardia, incidentes leves y cambios de confianza y opinión | `tools.ts`, `engine.ts`, `inventory.ts`, `crime.ts`, `trust.ts`, `standing.ts` | La CD es la pasiva; el éxito mueve o crea el objeto en la mochila; los límites rechazan el tesoro inventado; el segundo intento no se puede |
| 3 | **Relación, careo y escalada.** Broma, reproche, careo con sus botones y su lectura del texto, delito con alto, calabozo o pelea; reacción por perfil; el incidente guarda cómo le llama cada testigo | `conflict.ts`, `crime.ts`, `engine.ts` | Una fila por relación y una por perfil; cada botón del careo |
| 4 | **Antes del máster y contexto.** `conflictPlan`, el bloque del contexto, las reglas del system prompt (también lo absurdo, con ironía), el guion de reacción sin `terms`, las plantillas offline | `engine.ts`, `prompt.ts`, `talk.ts`, `offline.ts` | El contexto de los casos de la partida lleva el veredicto correcto y no lleva la deuda |
| 5 | **Cierre.** Las comprobaciones de la sección 11 | `closecheck.ts`, `tools.ts` | Cada una con una respuesta buena y una mala |
| 6 | **Los casos de la partida** (sección 13) de punta a punta con el máster offline | `test/partida-2026-11-06.test.ts` | Todos |
| 7 | **Documentación.** Este documento, `CONVERSACION-FLUJO.md` (capas 0 y 1), `SPEC.md` y la wiki (`wiki/Diseño de juego/`), con `npm run wiki` | | |

Fuera de este plan, en la rama de los NPC: echar en falta lo robado, buscarlo, sospechar de quien estuvo cerca y
reconocerlo si lo ve. Lo que necesitan está en `state.stolen` (sección 8).

Después de la fase 6, una prueba con Haiku que lanza Miguel, con el comando y el coste estimado.

## 13. Casos de prueba sacados de la partida

Datos de Brezal: Garrán pasiva 12 (matón, autoridad), Osric 13 (noble, sin `noncombatant`: luchador fuera de su
casona), Hugo 11 (matón, dueño de la herrería), Brenna 12 (`noncombatant`, dueña de la taberna). Pillin: Juego de manos
+5, Sigilo +7, Atletismo +0.

| # | De la partida | Estado | Lo que debe pasar |
|---|---|---|---|
| 1 | 27-33: se pone detrás de Garrán (Sigilo 22) y le quita la llave del cinto | Desprevenido y oculto; al cinto | JdM **con ventaja** contra 12. Con éxito, la llave a la mochila, marcada como robada, sin incidente |
| 2 | 34-36: acto seguido, la bolsa del cinto | Sigue oculto | Igual. Si la bolsa no está en los datos, se crea con sus límites (lo que lleva un alguacil); con éxito, a la mochila |
| 3 | Lo mismo, con 8 en la tirada (fallo por 4) | Desprevenido | **Casi**: Garrán se palpa el cinto y queda en guardia. Sin incidente |
| 4 | Lo mismo, con 3 (fallo por 9) | Garrán sabe de él de oídas (la deuda); relación mala | **Delito**: Garrán es autoridad, careo corto y alto por robo; si se entrega, multa o calabozo |
| 5 | 51-53: la bolsa de debajo del banco | En el suelo | No es esta regla: se coge (y quien lo vea, lo ve) |
| 6 | 63: «robarle los anillos de los dedos» a Osric, hablando con él | Puesto; le está mirando; sin relación | **No se puede**, sin tirada. El máster cuenta qué lo impide, sin la deuda |
| 7 | 66: «vuelvo a intentar robarle el anillo» | Ya le dijo que no se puede | Intento a la vista: **le pilla** sin tirada. Sin relación: **delito**. Luchador: careo agarrándole la muñeca; si Pillin se suelta, pelea. Confianza −3, opinión −10, recelosa |
| 8 | 69 y 72: tercera y cuarta vez | En guardia, delito abierto | No se puede. Nunca sale a la cuarta |
| 9 | 93: «robarle el martillo de fragua» a Hugo, a su lado | Grande; atento | **Solo arrebatar** |
| 10 | Variante: «se lo arranco de un tirón» | Arrebatar | Atletismo de Pillin (+0) contra Hugo (+2: ataque +4 menos 2). Gane o pierda, es delito: Hugo pelea por él |
| 11 | 24-26: Garrán y la deuda | De oídas | Con una reacción de por medio, primero la reacción, no la deuda |
| 12 | Nuevo: Pillin, aliado de Brenna (opinión +45), le quita la jarra de la mano y le pilla | Relación íntima | **Broma**: «¡Serás…!», se la quita de vuelta. Sin incidente; opinión −1. Si lo repite el mismo día, reproche |
| 13 | Nuevo: empujar a Brenna, sin relación | Dueña; Garrán en la sala | Agresión: Brenna le echa y no le sirve; Garrán le da el alto |
| 14 | Nuevo: empujar a Hugo, conocido | Luchador | Careo; si no se disculpa o falla la Persuasión, Hugo le devuelve el empujón; a la siguiente, pelea |
| 15 | Nuevo: tocarle el pelo a Tobías | Tímido | Se aparta. Si se repite, huye a por Mateo |
| 16 | Nuevo: un niño (`child`) de los datos de prueba, pillado robándole | Niño | Grita y corre a por los suyos (su `bond` de familia) |
| 17 | Nuevo: quitarle algo a Garrán inconsciente | Indefenso | Sin tirada. Si Brenna lo ve, es un robo (ya existe) |
| 18 | Nuevo: careo con Osric (conocido), Pillin elige «Convencerle» y saca 14 | CD 12 | Advertencia; devuelve el anillo; sin alto |
| 19 | Nuevo: «le arranco la cabeza y salgo volando» | Absurdo | El máster contesta que no se puede, con ironía; nada cambia |
| 20 | Nuevo: el máster pide JdM CD 10 contra Garrán sin `conflict_act` | | Rechazo: «usa conflict_act» |
| 21 | Nuevo: `new_item` «corona de oro macizo» contra Garrán | Fuera de su riqueza | Rechazo con el motivo |

## 14. Lo que queda abierto

1. **En guardia, 12 horas** y el resto del día sin desprevenir: lo dejo así salvo que Miguel diga otra cosa.
2. **«En la mano»**: propongo que el máster lo pueda marcar con una tool («saca el sello»); sin eso, solo los datos.
3. **Dónde se guardan los objetos nuevos** (base de datos o JSON aparte): lo decide otra sesión; aquí va todo por
   `createItem`.

## Al fusionar (para otras sesiones)

- **Flujo de charla** (`claude/nervous-lederberg-e007cb`): la capa 2 la necesita esto. Si entra antes, `pcKnownAs` usa
  su función; si no, la mía queda como base.
- **Objetos reales** (`claude/objetos-reales`): el rechazo del robo contado sin objeto se mantiene, pero su pista cambia
  de «si no lo lleva, no existe» a «créalo con conflict_act y new_item, con sus límites».
- **Ajuar de los NPC** (`claude/amazing-mahavira-788ef2`): sus bolsas y su `wealth` dan los límites del objeto nuevo.
- **Rama de los NPC**: echar en falta, buscar y reconocer lo robado, con `state.stolen`.
- **NPC de relleno**: el perfil sale de datos que pueden traer (`temperament`, `noncombatant`, `child`).

## Qué hay implementado (06-11)

- **Motor** (`src/engine/conflict.ts`):
  - Dónde lo lleva: `carriedOn`, con `state.on` en el ejemplar o deducido del objeto.
  - Quién es el PJ para el NPC: `pcKnownAs`.
  - La relación: `relationOf`. La da el trato; una opinión de −10 o menos la deja en ninguna, una de +10 la sube a buena y una de +40 a íntima.
  - El estado del NPC: `awareness`. Ir a escondidas sale de `Character.sneak`, que se apunta al sacar bien una tirada de Sigilo.
  - Las tablas y el veredicto: `stealCell` y `conflictVerdict`.
  - El resultado y lo que pasa después: `conflictOutcome` y `resolveConflict`.
  - Lo robado: `stealInto` y `createItem`.
  - El careo: `confrontAnswer`, `settleConfront`, `confrontRolled` y `confrontIgnored`.
  - Lo que escribe el jugador: `conflictKindOf` y `conflictPlan`.
  - El bloque del contexto: `conflictBlock`.
- **Modelo**:
  - `Npc.guard`, `Npc.confront`, `Npc.child` y `Npc.contest`.
  - `Character.sneak`.
  - El tipo de incidente nuevo `theft_attempt` («intento de robo», gravedad 2).
  - En el ejemplar robado, `state.stolen` (a quién, cuándo, la tirada y quién estaba cerca) y `state.owner_id`.
  - Los objetos creados en partida llevan el prefijo `it_new_` y van en `item_defs` del mundo.
- **Crimen** (`crime.ts`):
  - `npcProfile`, que es el perfil.
  - A quien le roban reacciona según su perfil: la autoridad da el alto, quien es de pelear le agarra de la muñeca (`seize`), el niño o el tímido huyen y el resto grita o avisa.
  - Con la violencia, lo de antes.
- **Confianza** (`trust.ts`): `touched` (−1), `shoved` (−2), `caught_stealing` (−3) y `snatched` (−4).
- **Máster** (`tools.ts`, `prompt.ts`, `master.ts`, `offline.ts`):
  - La tool `conflict_act`, con `new_item_name` y `new_item_worn` para lo que no está en los datos.
  - Con un plan de conflicto, el contexto lleva su bloque y no el guion de charla.
  - La regla «ACCIONES CONFLICTIVAS», que incluye lo absurdo con ironía.
  - La tirada la fija el servidor en `log_event`.
  - `transfer_item` y `spawn_item` se rechazan en un turno de robo.
  - En un careo abierto, los botones son los del careo.
  - El máster offline llama a `conflict_act`.
- **Motor de turnos** (`engine.ts`):
  - `rollPending` resuelve el conflicto (y la tirada enfrentada oculta del NPC) antes de que narre el máster.
  - `tryConfront` lee la respuesta a un careo antes de nada: devolver, disculparse o pagar se resuelven sin máster; convencer o engañar dejan la tirada pendiente.
- **Cierre** (`closecheck.ts`): `conflictCloseProblems`.
- **Tests**:
  - `test/conflict.test.ts` (35): el veredicto.
  - `test/partida-2026-11-06.test.ts` (19): los casos de la partida, la relación, el careo, lo robado y el cierre, con uno de punta a punta con el máster offline.

**Lo que cambió respecto al plan:**

- **El perfil:** el niño va primero; el orden es niño, autoridad, dueño, luchador, valiente, tímido y corriente.
- **El careo:** solo con relación buena (CD 10) o de conocidos (CD 12). Con ninguna relación es delito en el acto. El careo solo se abre si la víctima es de pelear (le agarra de la muñeca, CD 17): ahí arreglarlo evita la pelea, no el delito.
- **Repetir:** si lo intenta otra vez con el NPC aún en guardia, la relación baja un escalón. A la segunda, la broma ya es un reproche.
- **Insistir en lo que no se puede:** si en los 10 minutos siguientes lo intenta otra vez, le pilla sin tirada (`refusedBefore`).
- **Lo valioso:** +2 a la CD si vale lo que lleva un PJ al empezar o más.
- **Lo que no entró:**
  - Que el careo caduque solo. Hoy se resuelve con la siguiente acción del PJ: si hace otra cosa, es delito.
  - Que el máster marque con una tool que un NPC tiene algo en la mano. Solo lo hacen los datos (`state.on`) o `new_item_worn: "hand"` al crearlo.
  - Echar en falta lo robado y buscarlo: va en la rama de los NPC.
