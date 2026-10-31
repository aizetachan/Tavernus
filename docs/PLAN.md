# Plan de Tavernus: de la demo de Brezal al mundo vivo

Actualizado: 16 de octubre de 2026.

Este documento unifica tres cosas: la spec original (`docs/SPEC.md`, que sigue siendo el contrato de
detalle de cada mecánica), lo que se construyó el 16 de octubre para controlar el coste y poder probar
sin gastar, y la dirección nueva: partidas en mundos generados por la IA, persistentes y simulados,
sobre una estructura determinista. Fija principios, arquitectura objetivo y un orden de fases, cada
una jugable y con su forma de probarse sin gastar tokens.

Cuando este plan y la spec se contradigan, manda este plan; el apartado 9 lista exactamente qué cambia.

---

## 1. Visión y principios

**Visión.** Un juego de rol por chat, con máster de IA, en el que cada partida nueva es un mundo
distinto generado al empezar, que crece solo donde los jugadores miran, recuerda todo lo que pasa y
sigue vivo entre sesiones. La taberna de Brezal es la prueba de concepto; el producto es el generador
más el simulador que la rodean.

**Principios** (los dos primeros vienen de la spec y son los que hacen posible el resto):

1. **La base de datos es la verdad.** Solo existe lo que está en los datos; el máster solo cambia el
   mundo a través de tools. Lo que no está, no se narra.
2. **La IA propone, el motor dispone.** Todo efecto pasa por el motor, que valida, calcula y registra.
3. **Generación perezosa y persistente.** El mundo no se genera entero: se genera lo que alguien está
   a punto de ver, con la resolución justa, una sola vez, y queda guardado para siempre con su
   procedencia.
4. **Determinista donde se pueda.** Esqueleto, movimiento, dados, horarios, economía, mapas y
   acciones triviales son código. La IA se reserva para lo que exige lenguaje: relleno semántico,
   diálogo, consecuencias narrativas y trama.
5. **El coste por acción es una métrica de diseño**, no una factura que se mira al final. Objetivo:
   media por acción por debajo de 1 a 2 céntimos en partida real; pruebas por debajo de 0,2.
6. **Reproducible.** Semilla fija para el esqueleto y los dados; grabación y reproducción de las
   respuestas del máster; mismo recorrido, mismo resultado.

---

## 2. Estado a 16 de octubre de 2026

### 2.1 Lo que ya existe

- **Motor** (`src/engine`): mapa de localizaciones y puntos con coordenadas, salidas con distancia,
  movimiento con tiempo real de viaje, percepción por luz y distancia, inventario con carga, reloj
  global a 3×, combate conversacional, progreso (pistas, encargos, reputación, logro), log de eventos
  con entrega por percepción, acciones deterministas y ganchos.
- **Máster** (`src/ai`): una llamada por acción con 29 tools, cierre obligatorio con `log_event`,
  tiradas en servidor, memoria de NPC, nombres conocidos, ventanas decisivas, modos de ejecución y
  caché de respuestas, consulta de reglas.
- **Clientes**: web (`src/adapters/web`) con menú de partidas, chat, hoja, tablero SVG y mapa de zona y
  región (`regionmap.ts`: grafo de lugares conocidos por el PJ, dispuesto desde los datos, con los
  personajes encima); bot de Discord; REPL.
- **Persistencia**: JSON por partida (`data/games/<slug>`); Firestore escrito pero nunca ejecutado.
- **Calidad**: 179 tests en vitest y typecheck en verde; `docs/NOTAS-GUIA-USUARIO.md` con las
  observaciones de las pruebas con personas.

### 2.2 Lo añadido el 16 de octubre (fase 0, cimientos de coste y pruebas)

| Pieza | Dónde | Qué aporta |
|---|---|---|
| Modos del máster `live`, `offline`, `record`, `replay` | `src/ai/mode.ts`, `offline.ts`, `cache.ts` | Jugar y probar sin API; grabar una partida real y repetirla gratis |
| `MASTER_MODEL` y `MASTER_EFFORT` | `src/ai/master.ts` | Modelo barato para pruebas sin tocar la campaña; Haiku compatible |
| Acciones deterministas | `src/engine/engine.ts`, `narrate.ts`, `aliases.ts` | Mover, salir, coger, soltar, esperar y llegar sin IA |
| Ganchos del máster | `src/engine/hooks.ts`, tools `plant_hook` / `cancel_hook` | El máster siembra sucesos futuros que el motor vigila gratis |
| Recorte del contexto por turno | `src/ai/prompt.ts`, tool `get_campaign_notes` | Pistas ancladas a lugar o NPC, encargos en una línea, 6 eventos, aviso de "sin testigos" |
| Reglas consultables | `src/rules`, `scripts/ingest-rules.ts`, tool `lookup_rule`, chuleta cacheada | Los manuales se consultan por fragmentos, nunca se cargan enteros |
| Tablero SVG | `src/adapters/web/board.ts`, `reveal.ts`, `mapgen.ts`, `mapcache.ts` | Mapa de mesa desde los datos, clic para moverse, muebles que se revelan al interactuar |
| Menú y gestor de partidas | `src/games/manager.ts`, `page-menu.ts` | Nueva, continuar, demos y grabaciones sin variables de entorno |
| Banco de medición | `scripts/model-bench.ts`, `bench-report.ts`, `bench-route.json` | Recorrido fijo de 10 acciones por modelo con coste y narraciones lado a lado |

### 2.3 Coste medido

| Situación | Coste por acción |
|---|---|
| Antes, Opus 5, contexto sin recortar (medido en la demo) | 4,1 céntimos |
| Haiku 5.5, primera acción con escritura de caché (medido) | 0,26 céntimos |
| Haiku 5.5 en régimen (estimado con los precios actuales) | 0,12 céntimos |
| Sonnet 5.5 (estimado) | 1,2 a 1,6 céntimos |
| Opus 5.5 (estimado) | 2,5 a 3 céntimos |

El contexto dinámico bajó un 34 % de media y un 42 % en la taberna. El prefijo cacheado (system con la
chuleta de reglas más 29 tools) ronda los 12.000 tokens y se paga al 10 %. La salida (razonamiento más
`log_event`) sigue siendo la mitad del coste; sin testigos se ahorra un tercio de ella.

### 2.4 Pendiente de verificación

- Nada de lo nuevo se ha probado contra Opus o Sonnet reales; solo Haiku y los modos sin API.
- Las grabaciones reales (`record`) no se han ejecutado contra la API.
- Firestore sigue sin ejecutarse contra un proyecto real.
- El modelo por defecto es Haiku en todas partes desde el 21 de octubre (`MASTER_MODEL` y `MASTER_EFFORT` en
  `.env`, en `launch.json` y en la semilla), para probar sin gastar; la partida real elegirá modelo cuando el banco decida.

---

## 3. Arquitectura objetivo: capas

```
Semilla + tono ──▶ [0] Esqueleto (código)      regiones, asentamientos, lugares, puntos, salidas, reparto de NPC
                   [1] Biblia (IA, una vez)     5-10 verdades del mundo, antagonista, leyes del mundo
                   [2] Relleno (IA, una vez     nombres, descripciones, motivaciones, secretos, pistas,
                       por entidad, perezoso)   encargos, paquete de ambientación
                   [3] Simulación (código)      horarios, economía, clima, líneas secundarias, ganchos
                       + Director (IA, fondo)   hilos de trama a partir de lo ocurrido
                   [4] Máster de escena (IA)    resuelve la acción contra lo que existe, por tools
                   [5] Presentación (código)    tablero, mapa de región, imágenes por entidad, clientes
```

**Capa 0, esqueleto.** De `{semilla, tono, ambientación}` sale por código, con PRNG con semilla, la
estructura: regiones y clima, dónde hay asentamientos y de qué tamaño, caminos y distancias, cuántas
facciones, y para cada localización sus puntos con coordenadas a partir de plantillas por tipo
(taberna, plaza, cueva, nave). Cero tokens, infinito por trozos, idéntico con la misma semilla.

**Capa 1, Biblia.** Una llamada al crear la campaña. Es la que define la spec en §3.1: verdades que
nada puede contradecir. Se guarda aparte, nunca va entera en el prompt del máster; el máster solo ve
lo revelado. Aquí viven también las **leyes del mundo**: hay magia o no, qué tecnología existe, qué
está prohibido.

**Capa 2, relleno semántico.** Cuando un jugador se acerca a algo que el esqueleto dice que existe
pero no tiene contenido, una llamada con salida estructurada (JSON Schema estricto) lo rellena con
las restricciones del esqueleto, el lore del padre y la Biblia. Se valida, se escribe una vez, se
registra como evento con procedencia y no se regenera. Resoluciones de una entidad:
`unknown → heard_of → sketched → filled → visited`.

**Capa 3, simulación y Director.** Lo determinista corre con el reloj: horarios de NPC, economía,
clima, líneas secundarias (Capa B de la spec), ganchos sembrados por el máster. El Director (spec
§3.1.1) corre en segundo plano tras hitos y una vez por día de juego, lee la crónica y escribe trama
por tools con sus guardarraíles; arranca en modo borrador y puede ir por la API de lotes.

**Capa 4, máster de escena.** El actual. Cambio único: un tool `request_generation(kind, hint)` para
cuando el jugador pregunta por algo permitido por el esqueleto y aún sin rellenar; el motor genera
ahí mismo y la escena sigue.

**Capa 5, presentación.** Tablero de localización y mapa de región desde los datos; imágenes
generadas una vez por entidad y guardadas como asset; clientes web, Discord y PWA sobre el mismo motor.

### 3.1 Flujo de una acción

1. El texto llega al motor. Si es una acción determinista reconocida sin ambigüedad (ir, salir,
   coger, soltar, esperar, clic en el tablero), se resuelve y narra por plantilla. Coste cero.
2. Si no, se construye el contexto de escena (solo lo que el actor percibe, pistas ancladas aquí,
   seis eventos) y se llama al máster.
3. El máster lee con tools lo que le falte (`get_campaign_notes`, `lookup_rule`,
   `request_generation`), ejecuta cambios con tools de escritura y cierra con `log_event`.
4. El motor registra el evento, lo entrega a quien lo percibe, dispara ganchos y proyecciones
   (memoria de NPC, crónica), y si hay tirada, tira y vuelve a llamar al máster una vez.

### 3.2 Flujo de generación perezosa

1. El jugador se dirige a una frontera (salida hacia una localización `sketched`, viaje a otra zona).
2. Durante el tiempo de viaje, en segundo plano, se rellenan el destino y sus vecinos inmediatos.
3. Si llega antes de que termine, la llegada espera con narración de camino, nunca inventa.
4. Lo generado queda a resolución `filled`; pasa a `visited` al entrar. Nada se genera a más
   resolución de la que alguien va a ver.

---

## 4. Modelo de datos de un mundo que crece

- **Log de eventos como fuente de verdad, estado como proyección** (spec §6). Cada cambio tiene causa,
  actor, tools llamados y narración. Las proyecciones (resúmenes por localización, diario por
  personaje, crónica de campaña, memoria de NPC) se regeneran del log, nunca se editan a mano.
- **Grafo de entidades con procedencia.** Región, zona, localización, punto, NPC, facción, objeto,
  hilo, verdad de la Biblia. Cada entidad lleva `seed`, `generated_by` (evento), `parent`,
  `resolution` y `known_by[]`. Con eso se responde "¿quién es este NPC y de dónde salió?".
- **Hechos de lore como triples**: sujeto, relación, objeto, quién lo sabe, qué evento lo reveló.
  Es lo que permite que un NPC no cuente lo que no sabe y que dos NPC lejanos no se contradigan.
- **Conocimiento por personaje**: `knows[]`, `discovery` por lugar y `clues` ya existen; se extienden
  a hechos de lore y a entidades con resolución.
- **Memoria que se consolida**: las crónicas largas se resumen periódicamente con un modelo barato
  para que el contexto de escena no crezca con los meses.
- **Almacén por etapas**: JSON por partida hoy (vale para demo y pruebas); SQLite por partida en la
  fase 4 (consultable, indexado, búsqueda de texto para `lookup`, un fichero por mundo); Firestore
  o Postgres para el online (spec §14), decidido con datos de uso.

La jerarquía de la spec §3.2 (región, zona, localización, punto) se mantiene; hoy el modelo solo
tiene localización y punto, y la fase 2 añade región y zona.

---

## 5. Reglas y ambientaciones

Tres piezas que hoy van juntas y se separan:

1. **Núcleo de resolución**, genérico y determinista: características, habilidades, tirada contra
   dificultad, puntos de golpe, armadura, daño, descansos, progresión. Es el SRD 5e y está en
   `src/engine/rules.ts`. Sirve igual para una taberna que para una nave.
2. **Paquete de ambientación**, que son datos: catálogo de objetos y armas, arquetipos en lugar de
   clases, bloques de criaturas, nombres de habilidades, qué sustituye a la magia. Para fantasía lo
   da el SRD; para otras ambientaciones lo genera la IA una vez al crear el mundo, con el validador
   manteniendo cada número dentro de las bandas del núcleo.
3. **Leyes del mundo**, en la Biblia: restricciones para el generador y para el máster, no mecánicas.

`lookup_rule` consulta el SRD y los manuales indexados por fragmentos. Un sistema más ligero y de
licencia libre (Fate, Cypher) queda como opción futura si el juego narrativo lo pide; no se cambia
ahora.

---

## 6. Coste y pruebas: cómo se trabaja sin gastar

| Qué se prueba | Cómo | Coste |
|---|---|---|
| Motor, tablero, menú, movimiento, inventario, tiradas | `MASTER_MODE=offline` (configuración `tavernus-web-offline`) | 0 |
| Recorridos repetibles de una partida real | `record` una vez, `replay` después, semilla de dados fija | Solo la grabación |
| Narrativa y tools en desarrollo | `MASTER_MODEL=claude-haiku-5-5` (configuración `tavernus-web-haiku`) | 0,12 céntimos por acción |
| Elegir modelo y esfuerzo de la partida real | `npm run bench` con la ruta fija y `bench:report` | Unos céntimos por pasada |
| Generación de mundos | Relleno determinista de prueba sin API; una generación real con Sonnet por iteración | 5 a 10 céntimos por mundo |

Reglas de trabajo:

- Toda pieza nueva pasa `npm test` y `npm run typecheck` antes de darse por hecha.
- Los tests no dependen del azar ni del tiempo real. `test/setup.ts` fija `Math.random` en cada test,
  y el que necesite un resultado concreto pasa su `rng` al motor. El reloj es `fakeTime()`
  (`test/helpers.ts`), inyectado con `now`. Nada de medir milisegundos ni de dormir un rato: se espera
  una condición (`waitUntil`, `engine.settle()`, `readSse` hasta ver el estado) o se retiene lo que
  tarda con una promesa que suelta el test. Para probar que algo no espera a un temporizador, se le
  pone de una hora. Y cada test deja acabado lo que arrancó antes de que se borre su carpeta.
- Toda llamada al modelo registra `usage` y coste en el evento; el banco y el panel los agregan.
- Métricas que importan: tokens y céntimos por acción, porcentaje de acciones deterministas, coste
  por jugador y hora, latencia del máster, errores de tool.
- Presupuesto de generación por sesión y por mundo, con aviso al superarlo.
- Validadores a la salida de cada generación: ids referenciados existen, nombres únicos, números
  dentro de las bandas del SRD, lista de comprobación contra la Biblia.

---

## 7. Fases

Cada fase deja el juego jugable y se prueba sin gastar salvo donde se indica. Los ficheros son
orientativos; sirven para repartir trabajo en paralelo sin pisarse.

### Fase 0. Cimientos de coste y pruebas. Hecha el 16 de octubre; cierre pendiente

Pendiente de cierre:

- Lanzar el banco real con Sonnet 5.5 y Haiku 5.5 a esfuerzo bajo y decidir el modelo de la
  partida real; cambiar la semilla si procede.
- Una grabación real corta con `record` y su conversión en demo, para tener una demo con historia.
- Script `npm run web:offline` y `web:haiku` que funcionen igual en PowerShell y bash.
- Pasar las observaciones de hoy a `docs/NOTAS-GUIA-USUARIO.md`.

### Fase 1. Generador de campaña desde semilla

- **Objetivo**: cada partida nueva es un mundo distinto, jugable con el máster y el tablero actuales.
- **Entregables**: `src/worldgen/skeleton.ts` (esqueleto por PRNG: asentamiento con 4-6 localizaciones
  por tipo más 2 exteriores, puntos por plantilla, salidas, reparto de NPC, pistas, encargos,
  facción), `src/worldgen/fill.ts` (una llamada con salida estructurada que devuelve Biblia, nombres,
  descripciones, NPC completos, pistas ancladas, encargos, paquete mínimo de ambientación; validación
  y un reintento), `generateSeed()` que devuelve lo mismo que `makeSeed()`, Biblia y semilla guardadas
  en la campaña, relleno determinista sin API para tests, opción "Mundo nuevo" en el menú con
  semilla, tono y ambientación.
- **Hecho cuando**: dos semillas dan dos mundos distintos, la misma semilla el mismo esqueleto, el
  motor arranca y un personaje recorre todas las localizaciones, el validador rechaza respuestas
  rotas, los tests pasan y una generación real con Sonnet cuesta lo estimado.
- **Pruebas**: todo sin API salvo una generación real por iteración.

### Fase 2. Generación perezosa y mapa de región

- **Objetivo**: el mundo crece hacia donde miran los jugadores sin perder coherencia.
- **Entregables**: región y zona en `model.ts` con `resolution`, `parent`, `generated_by`,
  `known_by`; generación bajo demanda al cruzar salidas y viajar, con pregeneración de vecinos durante
  el tiempo de viaje; tool `request_generation`; `create_spot` ligado a `improvisation` (spec §3.2);
  plantillas de interiores por tipo alimentando `mapgen.ts`; mapa de región desde los datos con lo
  descubierto por cada jugador (`/map`, spec §3.2 regla 7); hechos de lore como triples y su consulta
  por tool.
- **Hecho cuando**: un jugador sale del asentamiento inicial, viaja a una zona nunca visitada y la
  encuentra generada, coherente con la Biblia y con lo que le contaron, y al volver sigue igual.
- **Pruebas**: relleno determinista sin API para el motor; Haiku para recorridos; una generación real
  por tipo de entidad nueva.

### Fase 3. Mundo vivo

- **Objetivo**: el mundo cambia entre sesiones y la trama nace de lo que hacen los jugadores.
- **Entregables**: horarios de NPC y presencia por hora; líneas secundarias con reloj (Capa B) con
  `max_stage` y validación de `plot_critical`; economía básica con precios que reaccionan; Director en
  segundo plano con sus tools (`promote_thread`, `create_thread`, `resolve_thread`, `adjust_thread`,
  `spawn_npc`, `create_quest`), modo borrador con aprobación, presupuesto de tensión, por API de lotes;
  consolidación de memoria (resúmenes por localización, diario por personaje, crónica); ganchos
  ampliados a disparadores de la simulación.
- **Hecho cuando**: una semana de juego sin jugadores cambia cosas secundarias y ninguna de trama; tras
  un hito el Director propone un hilo con `spawned_by` no vacío y trazable; el contexto de escena no
  crece con el tiempo de partida.
- **Pruebas**: simulación y Director con cliente falso y relojes simulados; una pasada real del Director
  por iteración.

### Fase 4. Presentación y persistencia a escala

- **Objetivo**: ver el mundo y sostenerlo cuando crece.
- **Entregables**: imágenes por entidad generadas una vez desde la descripción guardada y servidas
  como asset (proveedor por decidir); SQLite por partida con migración desde JSON y búsqueda de texto;
  panel de administración como observabilidad (spec §13: bandeja de reportes, explorador de eventos con
  prompt exacto y reproducción, métricas, decisiones del Director pendientes); métricas de coste por
  partida y por jugador.
- **Hecho cuando**: una partida de meses abre en menos de dos segundos, se puede inspeccionar cualquier
  evento con su prompt, y el coste por jugador y hora se lee en el panel.

**Adelanto (21 de octubre de 2026): ilustraciones de escena.** Primer paso de las imágenes de la
fase 4 con un proveedor gratuito, Pollinations (`src/ai/illustrate.ts`). Se activa con `IMAGES=on`
(apagado por defecto; con ello funciona en cualquier modo del máster, también `offline`). El motor avisa cuando un PJ pisa una localización por
primera vez (`engine.onFirstVisit`) y el ilustrador construye un prompt determinista y una seed
derivada de la semilla del mundo y del id de la localización: misma escena, misma imagen, una sola
petición (caché en memoria y en `images/index.json`). El servidor descarga el JPEG a
`data/games/<slug>/images/` y los clientes lo reciben de ahí. Sin clave es anónimo: logo pequeño y
~1 imagen cada 45 s por IP contados desde el final de la anterior; la cola va de una en una con 45 s
de hueco y reintenta en 402/429 con `Retry-After` como mínimo. Probado en vivo: si el cliente pide la
URL directamente y se pasa del límite, Pollinations le devuelve una imagen «Free limit reached»
indistinguible, y con una petición anterior colgada repite «Retry-After: 1»; de ahí la descarga en el
servidor, el corte a los 90 s y el suelo de 45 s. Con `POLLINATIONS_API_KEY` va con
`Authorization: Bearer`, sin logo ni límite. Proveedor principal desde el mismo día, si hay
`CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`: Cloudflare Workers AI (flux-1-schnell, 4 pasos,
1024x1024, JPEG en base64; cuota gratuita de 10.000 neuronas al día, unas 170 imágenes), sin
espaciado y con 2 peticiones a la vez como mucho. Si falla, o se agota la cuota (429 o error en
`errors`, y no se reintenta hasta la medianoche UTC), cae a Pollinations anónimo con su cola.

### Fase 5. Online y sociedad

- **Objetivo**: varias personas en el mismo mundo desde distintos clientes.
- **Entregables**: Game API con autenticación (spec §11.1) y la web como cliente de verdad; Discord
  sobre el gestor de partidas; despliegue en la VM y Firestore o Postgres probados; lo que la spec
  deja decidido y aún no está: descanso, muerte y reaparición (§4.7, §9.1), hechizos con resolvedor y
  barra rápida (§4.10), PvP, crimen y ley (§9.4), compañías (§9.5).
- **Hecho cuando**: diez jugadores en un mundo generado durante una semana sin corrección manual, con
  el coste por jugador dentro del objetivo.

---

## 8. Decisiones abiertas

| Decisión | Opciones | Cuándo |
|---|---|---|
| Modelo y esfuerzo de la partida real | Sonnet 5.5 bajo, Opus 5.5 bajo, Haiku 5.5 | Tras el banco real (cierre de fase 0) |
| Proveedor de imágenes | Por evaluar; una imagen por entidad, nunca por turno | Fase 4 |
| SQLite por partida | Sí en fase 4, salvo que el JSON aguante | Fase 4 |
| Reglas para ambientaciones no fantásticas | SRD como núcleo con paquete generado (plan), Fate o Cypher como alternativa | Fase 1 fija el núcleo; revisar tras fase 2 |
| Director automático o en borrador | Borrador hasta validar aciertos | Fase 3 |
| Cuánto pregenerar | Vecinos inmediatos durante el viaje; medir latencia | Fase 2 |
| Un mundo por campaña o campañas que comparten mundo | Un mundo por campaña de inicio | Fase 5 |

---

## 9. Qué cambia respecto a `docs/SPEC.md`

- **§3.2 "sin coordenadas" y "sin cuadrícula en el MVP"**: superado. Los puntos tienen `x`, `y`
  obligatorias desde la fase 1 del motor y el tablero dibuja una cuadrícula de 1,5 m; sigue sin haber
  combate táctico por casillas.
- **§3 "lo que hay que escribir para tener historia"**: deja de escribirse a mano. La Biblia, el
  mapa, los NPC y los hilos iniciales los produce el generador (fases 1 y 2); el autor humano escribe
  el tono y, si quiere, la semilla.
- **§8 ensamblado del prompt**: sustituido por el contexto recortado actual (pistas ancladas, encargos
  en una línea, seis eventos, aviso de testigos, chuleta de reglas cacheada, `get_campaign_notes` y
  `lookup_rule` como lectura bajo demanda).
- **§10 y §13 "coste de IA, aplazado"**: resuelto como fase 0 y como principio 5.
- **§12.1 orden de construcción**: las fases 1 y 2 de la spec están hechas; su fase 3 (sociedad) pasa
  a la fase 5 de este plan, por detrás de generación y mundo vivo, porque el producto cambia de "una
  campaña escrita" a "mundos generados".
- **§14 stack**: se añade SQLite por partida como etapa intermedia antes de Firestore o Postgres; la
  VM sigue siendo el destino del proceso.
- **§7 tools**: el contrato real está en `src/ai/tools.ts` (29 tools) y se amplía con
  `request_generation` y los del Director; `search_lore` se materializa como `lookup_rule` más la
  consulta de hechos de lore de la fase 2.

Todo lo demás de la spec sigue vigente como detalle de mecánicas.

---

## 10. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Deriva de coherencia entre trozos generados en momentos distintos | Padre más Biblia más validadores en cada generación; hechos de lore con procedencia; Director en borrador |
| Latencia al cruzar fronteras | Pregenerar vecinos durante el viaje; tiempo de viaje ya existente; narración de camino |
| Generar contenido que nadie visita | Generar solo lo percibido y a la resolución mínima; presupuesto por sesión |
| Coste que se dispara con jugadores | Acciones deterministas, contexto acotado, modelo elegido con el banco, métricas en el panel |
| Dependencia de un modelo concreto | Modos grabados para regresión; `MASTER_MODEL` por entorno; banco repetible al cambiar de modelo |
| Complejidad que nadie puede seguir | Fases jugables; cada decisión apuntada en README "Decisiones" o aquí; sesiones de trabajo en paralelo repartidas por ficheros |

---

## 11. Cómo seguir

1. Cerrar la fase 0: banco real, decisión de modelo, una demo grabada.
2. Arrancar la fase 1 con el generador de campaña; en paralelo, la parte de región y zona del modelo
   de la fase 2, que no toca los mismos ficheros.
3. Mantener `docs/RETOMAR.md` como "dónde lo dejamos" y este documento como "hacia dónde vamos".

---

## 12. Referencias externas

**Voyage (Latitude, voyage.io, 2026).** Sucesor de AI Dungeon con la misma idea de base que este plan:
un "World Engine" guarda estado (puntos de golpe, posición, vivo o muerto, tiradas contra
estadísticas) y el modelo narra después. Lo que tienen y conviene copiar en la interfaz: cabecera
con día, momento y lugar; retratos de los personajes presentes; panel lateral con pestañas Mapa
(región ilustrada con ciudades y punto del jugador) y Lugar (imagen de fondo, descripción, zona
actual y zonas conocidas); diario; habilidades, competencias e inventario como pestañas. Lo que no
tienen, y es nuestra diferencia: mundos generados desde cero que crecen con el juego (los suyos los
publica un creador y la IA improvisa dentro), espacio dentro del lugar (puntos con metros,
percepción, tablero clicable), imágenes generadas por momento de la historia en vez de telón fijo
por lugar, reglas abiertas del SRD, castellano, y control del coste por acción. Modelo de negocio:
suscripciones de 15 a 100 dólares al mes ligadas al coste de inferencia; en partidas privadas solo
paga el anfitrión. Público visible en su catálogo: anime, isekai, romance, slice of life.
