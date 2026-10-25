# Sonido: análisis, recomendación y prototipo

Fecha: 2026-10-22. Los precios y licencias se consultaron ese día en las páginas oficiales enlazadas al final. Lo que no viene de una fuente oficial va marcado como *sin verificar*.

## Estado actual (2026-10-25): ambientes grabados, IA desactivada

- **Ambientes:** pistas grabadas de Freesound con licencia CC0, en `public/sfx/ambient/<clave>.ogg` y `.mp3`. Son de 35 a 60 s, en bucle sin costura (fundido de igual potencia entre el final y el principio), igualadas a −24 dBFS RMS y de 400 KB a 1 MB cada una. Cubren la taberna, la herrería, el interior tranquilo (chimenea), la plaza de día y de noche, el bosque de día y de noche y el arroyo. La lluvia no tiene pista y sigue con su receta. Atribución completa en `public/sfx/LICENSES`. El panel «Sonido» de la cabecera del chat muestra los créditos con enlace a cada pista.
- **El navegador** pide Vorbis (`?fmt=ogg`) si lo sabe tocar, porque no deja hueco al repetir, y si no, MP3. Del MP3 se recorta el silencio de relleno de los extremos para que el bucle no tenga hueco. Las pistas suenan bajas por defecto (ganancia 0,7 sobre −24 dBFS y ambiente al 50 %), se funden 2,5 s al cambiar de sitio y bajan mientras habla el narrador.
- **Respaldo:** si una clave no tiene pista o el fichero falla, suena la receta procedural de siempre. Los efectos (pasos, puertas, monedas…) siguen sintetizados.
- **Generación por IA: desactivada, para más adelante.** `SFX_AI_ENABLED = false` en `src/ai/sound.ts`. Mientras esté así no se crea ningún proveedor ni se llama a ninguna API, aunque haya `SFX_PROVIDER` y clave en el entorno (solo deja un aviso en el registro). El código de ElevenLabs y Stable Audio, las descripciones (`SOUND_PROMPTS`) y la caché por partida se quedan como están. Para recuperarla: poner `SFX_AI_ENABLED = true` y elegir el proveedor en el entorno como se explica más abajo. Lo generado tendría prioridad sobre las pistas, porque `data/games/<slug>/sfx` se mira antes que `public/sfx`.
- **Cómo se prepararon las pistas:** las páginas de Freesound piden iniciar sesión para bajar el original, así que se usó la previsualización HQ pública de cada sonido (`cdn.freesound.org/previews/…-hq.ogg`, unos 190 kbps). La licencia del sonido cubre también la previsualización. Se recortó un tramo con el Python de Blender (módulo `aud` y numpy, porque en esta máquina no había ffmpeg), se le hizo el bucle con fundido, se igualó el nivel y se codificó en Vorbis y MP3 a 96–112 kbps estéreo.

## Qué queremos

Al salir de la taberna se oyen pasos sobre madera, una puerta que se abre y se cierra y, después, el ambiente de la plaza. Para eso hacen falta dos capas:

| Capa | Ejemplos | Características |
|---|---|---|
| **Efectos puntuales** | pasos (madera, piedra, tierra, hierba, agua), puerta (abrir y cerrar), moneda, coger y soltar, dado, espada (golpe y fallo), daño, curar, hacha, descubrir, campana | De 0,5 a 3 s. Se disparan desde eventos del motor y se tocan en secuencia. |
| **Ambientes en bucle** | taberna, herrería, interior tranquilo, plaza (de día y de noche), bosque (de día y de noche), agua, lluvia | De 10 a 30 s y sin costura. Uno por localización, con fundido al cambiar. Bajan cuando habla el narrador. |

El catálogo es **genérico**: las claves dependen del tipo de suelo y del arquetipo de lugar, no del mundo. Con unos 27 sonidos (18 efectos y 9 ambientes) se cubre cualquier mundo generado. Generar sonidos por mundo solo tiene sentido si se quiere un sabor propio, por ejemplo la taberna de un puerto pirata frente a un refugio de montaña.

## Opciones comparadas

### 1. Generación por IA

| | ElevenLabs Sound Effects v2 | Stable Audio 2.5 (API de Stability) | Stable Audio Open Small (autoalojado) | AudioGen (Meta, AudioCraft) |
|---|---|---|---|---|
| Calidad | Muy buena para foley (pasos, puertas, metal). Ambientes correctos. | Muy buena en texturas y ambientes largos. Más orientado a música. | Aceptable en efectos cortos. Más pobre en ambientes. | Aceptable. Modelo de 2023. |
| Duración | 0,5 a 30 s | Hasta unos 3 min | Hasta 11 s | Corta |
| Bucle nativo | **Sí** (`loop: true`) | No: hay que fundir los extremos | No | No |
| Latencia | Segundos por petición (*no medida*) | Segundos (*no medida*) | Depende de la máquina. Corre en CPU y Arm | GPU recomendada |
| Coste | **0,12 $ por minuto de audio** por API (unos 0,002 $/s) | **8 créditos = 0,08 $ por generación**, sea cual sea la duración | 0 $ por efecto. Solo cuesta la máquina | 0 $ por efecto |
| Licencia de lo generado | «Royalty-free» según la página de precios. Uso comercial en planes de pago (*verificar el plan gratuito*) | Hay que verificar las condiciones de la API (*sin verificar*) | Stability AI Community License: comercial hasta 1 M$ de ingresos anuales. Hace falta aceptar condiciones en Hugging Face | **Pesos CC-BY-NC 4.0: no comercial** |
| Encaje | El mejor para este catálogo por el bucle y el foley | Bueno para ambientes largos con poca repetición | Opción local sin coste, pero da menos calidad y exige operar un modelo | Descartado si el juego puede ser comercial |

Ninguna sirve para generar en tiempo real por acción: la latencia es de segundos y el coste se dispararía. **Se genera una vez por clave y se reutiliza** (en `data/games/<slug>/sfx`).

### 2. Bibliotecas libres

| Fuente | Licencia | Coste | Comentario |
|---|---|---|---|
| **Kenney, «RPG Audio»** (50 ficheros) | **CC0** | 0 $ | Pasos, foley y armas. Sin atribución obligatoria. Es lo más directo para efectos. |
| **Freesound** | CC0, CC-BY o CC-BY-NC, **según el sonido** | 0 $ | La mayor variedad, sobre todo en ambientes de taberna, bosque o lluvia. Hay que filtrar por CC0 o CC-BY y atribuir los CC-BY. **La API solo es gratuita para uso no comercial**: descargar a mano está bien, pero integrarla en el producto comercial requiere hablar con ellos. |
| OpenGameArt | Mixta (CC0, CC-BY, GPL…) | 0 $ | Hay que filtrar por CC0. Calidad desigual. |

Las bibliotecas son fiables y gratuitas, y suenan mejor que la síntesis en lo orgánico (gente, pájaros, lluvia). A cambio piden curar y recortar los sonidos, hacer bucles sin costura y mantener la atribución. Ese trabajo se hace una vez, porque el catálogo es genérico.

### 3. Síntesis procedural en el navegador (Web Audio API)

Ruido filtrado, senos con barrido, resonancias amortiguadas y trenes de impulsos, todo calculado en el cliente.

- **Ventajas:** 0 $, 0 bytes de descarga, latencia nula, deterministas, sin licencias y disponibles desde el primer día. El ambiente más pesado tarda unos 125 ms en sintetizarse a 48 kHz, y los efectos entre 1 y 12 ms.
- **Inconvenientes:** suenan sintéticos en lo orgánico (murmullo de gente, cantos de pájaro, lluvia). Donde mejor funcionan es en lo mecánico: puerta, moneda, dado, metal, pasos y fuego.

## Recomendación en escalones

| Escalón | Qué | Coste por mundo (unos 20 efectos y 6 ambientes, generados una vez) |
|---|---|---|
| **Gratis (hecho)** | Recetas procedurales para todo el catálogo. Los más débiles (taberna, pájaros, lluvia) se sustituyen por CC0 de Kenney o Freesound dejando el fichero en `public/sfx/<clave>.ogg` y anotándolo en `public/sfx/LICENSES` | **0 $** |
| **Barato** | ElevenLabs Sound Effects por API, con las descripciones de `SOUND_PROMPTS` (o con el tono del mundo añadido), los ambientes con `loop: true` y caché por partida | 20 × ~1,5 s + 6 × 22 s ≈ 162 s → **≈ 0,32 $**. Con tres tomas para elegir, **≈ 1 $**. Los 26 sonidos del catálogo actual: ≈ 0,40 $ |
| **Premium** | ElevenLabs para el foley más Stable Audio 2.5 para ambientes de 60 a 90 s (menos repetición), con tomas extra y escucha humana antes de fijarlas | 26 × 0,08 $ ≈ **2,1 $** en Stable Audio. Con tres tomas y foley de ElevenLabs, **≈ 5–7 $** |

Todos los costes son **por mundo, generados una vez**, y nunca por acción. Después, cada partida reproduce lo cacheado sin coste. Si el catálogo genérico basta, el coste se paga una sola vez para todos los mundos.

## Lo que hay hecho (prototipo sin coste)

**Mapa determinista evento → sonido** (`src/adapters/web/soundmap.ts`, función pura `cuesFor` con tests en `test/soundmap.test.ts`):

| Evento | Sonido |
|---|---|
| `move` (atajo, o el máster con `move_to`) | `pasos-<suelo de aquí>`. Si el primer tramo cruza a otra localización: `puerta-abrir`, `puerta-cerrar` (cuando hay puerta) y `ambiente-<destino>` |
| `arrived`, `master_arrival` | `pasos-<suelo>`, `ambiente-<sitio>` (si ya sonaba, no se reinicia) |
| `character_joined`, `master_intro` | `ambiente-<sitio>` |
| `take`, `drop`, `put`, `give` | `objeto-coger` u `objeto-soltar`; `moneda` si el objeto es dinero |
| `roll` | `dado` y, si fue un ataque, `espada-golpe` o `espada-fallo` (más `dano` si el objetivo cae) |
| Tools del máster | `roll_check`/`roll_dice` → dado · `attack` → espada · `apply_damage` → daño · `heal` → curar · `buy_item`/`sell_item`/`complete_job` → moneda · `harvest` → hacha · `discover_spot`/`grant_clue` → descubrir |
| `look`, `say`, `shout`, `whisper`, `wait`, `sleep`, `passed`… | nada |

- **Suelo:** si el punto tiene la etiqueta `water`, agua. Si no, manda `location.state.floor` cuando existe. Si tampoco, se mira la descripción: «losas» o «cripta» dan piedra en interior, «empedrada» piedra fuera y «prado» hierba. Por defecto, interior es madera, poblado es piedra y campo es tierra.
- **Ambiente:** un interior animado (`noise ≥ 0,25` o «taberna/posada») es taberna, y si no, interior. Fuera, según la zona `town` o el nombre, plaza o bosque, en versión de noche según `lightAt`. Un río o arroyo en el nombre da agua. La lluvia sale de `location.state.weather` (el motor todavía no tiene clima; queda preparado).
- **Puerta:** hay puerta si se pasa de interior a exterior (o al revés), o si el punto tiene la etiqueta `door`, `gate` o `trapdoor`, o se llama puerta, portón o trampilla.
- **Servidor** (`server.ts`): cada mensaje del actor lleva `sfx: string[]`.

**Gestor de audio** (`src/adapters/web/sfx.ts`, un solo AudioContext):

- Un ambiente en bucle por localización con fundido cruzado de 2,5 s. Los efectos van en secuencia, y cada receta indica cuándo puede empezar la siguiente.
- Botón de silencio y panel de volumen general y de ambiente en la cabecera del chat. Se recuerdan en `localStorage` (`tavernus.sfx.*`, con try/catch). Silenciado, el contexto se suspende.
- Arranca solo tras el primer gesto (clic, tecla o toque), con un búfer mudo para iOS. Se suspende al ocultar la pestaña.
- Comparte gestor con el narrador: baja el ambiente mientras `speechSynthesis` habla, y expone `TavernusAudio.duck(on)` para el narrador con audio de nube.
- Cada clave se resuelve contra el catálogo: primero un fichero (`data/games/<slug>/sfx`, luego `public/sfx`, servidos por `/api/sfx?key=…`) y, si no lo hay o falla, la receta procedural. Hay 27 recetas: 18 efectos y 9 ambientes (la herrería se añadió el 2026-10-25).

**Adaptador de IA, desactivado para más adelante** (`src/ai/sound.ts`):

- Desde el 2026-10-25 está desactivado en el código (`SFX_AI_ENABLED = false`): no se activa ni con el entorno. Lo que sigue describe cómo funciona cuando se vuelva a encender.
- Se activa con `SFX_PROVIDER=elevenlabs` y `ELEVENLABS_API_KEY`, o con `SFX_PROVIDER=stability` y `STABILITY_API_KEY`. Tener la clave en el entorno no basta para activarlo.
- Activado, `/api/sfx?key=…` genera la clave que falte una sola vez (las peticiones simultáneas se agrupan) y la guarda en `data/games/<slug>/sfx/<clave>.mp3`.
- `SFX_MAX_GENERATIONS` (40 por defecto) limita las generaciones por arranque del servidor.
- El navegador sigue sonando con la receta mientras se genera, y usa el fichero desde la vez siguiente.
- Ninguna de las dos APIs se ha llamado de verdad: los tests usan un `fetch` falso.

## Pendiente o mejorable

- **Lo comprobé sin oírlo:** en el navegador vi el orden y los tiempos de cada `AudioBufferSourceNode`, el estado del contexto y el silencio, pero no el resultado acústico. Habría que escuchar sobre todo el murmullo de la taberna y los pájaros, que son los más sintéticos y los primeros candidatos a sustituir por CC0.
- Los testigos aún no oyen nada: solo suena para el actor. Podrían oír pasos y puertas con volumen según su nivel de percepción (`full`, `vague` o `hint`).
- La puerta suena al partir. En viajes largos con varias salidas, solo suena la primera. La llegada fija siempre el ambiente correcto.
- Los ambientes son mono. Se podrían abrir en estéreo, con capas decorrelacionadas.

## Fuentes (consultadas el 2026-10-22)

- ElevenLabs, precios de la API: https://elevenlabs.io/pricing/api (Sound Effects a 0,12 $/min; generaciones incluidas por plan)
- ElevenLabs, referencia de `POST /v1/sound-generation` (`loop`, `duration_seconds` de 0,5 a 30, `eleven_text_to_sound_v2`): https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
- Stability AI, precios (Stable Audio 2.5 = 8 créditos; 1 crédito = 0,01 $): https://docs.stability.ai/pricing
- Stable Audio Open Small (licencia, 11 s, CPU y Arm, acceso con condiciones): https://huggingface.co/stabilityai/stable-audio-open-small
- AudioCraft (código MIT; pesos CC-BY-NC 4.0): https://github.com/facebookresearch/audiocraft
- Freesound, licencias: https://freesound.org/help/faq/ · condiciones de la API (gratuita solo para uso no comercial): https://freesound.org/docs/api/terms_of_use.html
- Kenney, RPG Audio (CC0, 50 ficheros): https://kenney.nl/assets/rpg-audio
