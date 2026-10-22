# Creatividad del máster

Creatividad acotada sin romper el principio rector («la base de datos es la verdad»): el máster rechaza lo imposible con ingenio, siembra rumores ante lo plausible que no existe y acepta con condiciones lo que inventa el jugador.

## Qué hay

| Pieza | Dónde | Qué hace |
|---|---|---|
| Leyes del mundo | `src/engine/laws.ts` | `campaign.laws` (opcional, una frase por ley); sin ellas, `DEFAULT_LAWS` de fantasía SRD. Van al system prompt. |
| Rumores | `src/engine/rumors.ts`, tool `plant_rumor` | Algo que «se dice», no algo que está. Circula por una localización, con procedencia (actor, acción, lugar, hora de juego). Si lo afirma el jugador (`said_by_actor`), sale como «lo dice Kael, sin confirmar». |
| Hechos de personaje | `src/engine/facts.ts`, tool `record_character_fact` | Lo que el jugador cuenta de su propio personaje (pasado, recuerdos, gente fuera de escena). Verdad para él, no para el mundo; no da nada gratis. |
| Reglas del prompt | `src/ai/prompt.ts` | LEYES DEL MUNDO, LO IMPOSIBLE Y LO QUE AÚN NO EXISTE, FUERA DE LOS DATOS (tres casos) e INVENTIVA DEL JUGADOR. |
| Contexto | `actionContext` | Bloque «## Rumores» (los de aquí, los que el actor sembró en otros sitios, presupuesto que le queda) y «Ha contado de sí» en el bloque del actor. |

Topes: 3 rumores nuevos por personaje y día de juego (retomar uno con el mismo nombre no gasta), caducan a los 7 días, como mucho 10 vivos por localización. Hechos: 5 por día y 24 en total por personaje.

## Del rumor al hilo: el Director

El Director (futuro, fuera de la partida) recorre los rumores `open`, pesa sus menciones, cuántos PJs los tocaron y si encajan con la premisa y la Biblia, y los convierte en datos reales a través del motor: `quest` → encargo del tablón; `person` → NPC; `place` → localización o punto oculto (worldgen); `item` → objeto escondido en un sitio concreto; `rumor` → pista anclada. Al hacerlo marca `status = 'threaded'` y `thread = { kind, id }`. Lo que no encaja caduca y queda como `faded`. Detalle en la cabecera de `rumors.ts`.

## Banco de creatividad

`scripts/creativity-bench.json`: 25 prompts con Kael en la barra de la taberna, cada uno en una partida nueva.

| Criterio | Prompts | Cumple si… |
|---|---|---|
| `witty_refusal` | c01-c06, c25 | no siembra rumor ni guarda hecho, no da ni crea nada, no pide tirada, sin «no puedes» y con algo de cuerpo |
| `rumor` | c07-c12 | `plant_rumor` sale bien y no crea objetos |
| `question` | c13-c16 | pregunta y no ejecuta nada |
| `in_fiction` | c17-c20 | sin romper la cuarta pared, sin cifras de reglas, sin regalar nada |
| `character_fact` | c21-c22 | `record_character_fact` sale bien, sin regalar nada |
| `player_rumor` | c23 | `plant_rumor` con `said_by_actor` y nada más real |
| `conditional` | c24 | no regala la ventaja: tirada, coste, pregunta o lo deja como dicho |

El juicio es automático y simple: sirve de primer filtro. El ingenio se lee en el informe `.md`.

### Cómo lanzarlo

Sin gastar nada (cliente falso, valida el banco de punta a punta):

```bash
npm run bench:creativity -- --dry-run
```

Solo la estimación de coste (no llama a la API):

```bash
npm run bench:creativity -- --model claude-haiku-5-5 --effort low --cache-write-mult 2
```

Pasada real (gasta dinero; necesita `ANTHROPIC_API_KEY` en `.env`):

```bash
npm run bench:creativity -- --model claude-haiku-5-5 --effort low --live --cache-write-mult 2
```

```bash
npm run bench:creativity -- --model claude-sonnet-5-5 --effort low --live --cache-write-mult 2
```

Deja `creativity-<modelo>-<effort>-<fecha>.json` y `.md` en `data/local/bench/`.

### Coste estimado (≈35 llamadas por pasada)

Calculado con el consumo medio por llamada que se midió con opus-5 low (`scripts/bench-prices.ts`) y la escritura de caché a 2× (ttl de 1 h):

| Modelo | Estimación | Con margen (lecturas extra de tools) |
|---|---|---|
| Haiku 5.5 | ≈ $0.04 | ~$0.05 |
| Sonnet 5.5 | ≈ $0.74 | ~$1.00 |

Todavía no se ha hecho ninguna pasada real.
