# Narrador de voz: opciones, costes y prototipo

Objetivo: que el máster se oiga en alto, en castellano y con buena calidad, para jugar desde el móvil sin mirar la pantalla. El análisis es del 21 de octubre de 2026. Los precios están en dólares, como los publican los proveedores.

Supuestos para comparar costes:

- **Una acción narrada son 600 caracteres.** Es la prosa de uno o dos párrafos que escribe el máster.
- **Una hora de juego son 20 acciones**, es decir, 12.000 caracteres por jugador.
- **1 millón de caracteres son unas 83 horas de juego.**
- **Cada jugador recibe su propia narración** (su #pov), así que el coste va por jugador. La caché por hash solo ahorra cuando se repite el mismo texto: al rejugar una demo o al pulsar dos veces el altavoz.

Las cifras marcadas con **[sin verificar]** no las pude confirmar en una página oficial. Hay que comprobarlas antes de pagar.

## Resumen

| Opción | Calidad es-ES | Latencia / streaming | $/1M car. | $/acción (600) | $/hora jugador | Gratis al mes | Voces distintas | Licencia / condiciones |
|---|---|---|---|---|---|---|---|---|
| Navegador (speechSynthesis) | De mala a muy buena según el navegador: Edge «Natural» > Chrome «Google español» > iOS/Android del sistema | Inmediata, frase a frase | 0 | 0 | 0 | ilimitado | Las que tenga el sistema; si solo hay una, cambia el tono | Gratis; las voces online de Edge y Chrome envían el texto a Microsoft o Google |
| OpenAI tts-1 / tts-1-hd | Buena, con acento algo anglo | Streaming por trozos | 15 / 30 | 0,009 / 0,018 | 0,18 / 0,36 | no hay | 9 a 13 voces fijas | Hay que avisar de que la voz es IA. **Estos modelos se retiran el 6-1-2027** |
| OpenAI gpt-4o-mini-tts | Buena, se puede dirigir el tono | Streaming | ~17,6 equivalente [sin verificar] | ~0,011 | ~0,21 | no hay | 13 voces e instrucciones de estilo | Igual que arriba, y también se retira |
| ElevenLabs Flash v2.5 | Muy buena | ~75 ms; WebSocket | 40 | 0,024 | 0,48 | 20k car. (~1,7 h) | Biblioteca enorme y clonado | El plan Free no permite uso comercial y exige atribución |
| ElevenLabs v3 / v4 / Multilingual v2 | La mejor en expresividad | Streaming | 80 | 0,048 | 0,96 | 10k car. (~0,8 h) | Igual que Flash | Igual que Flash |
| Google Neural2 | Buena | Normal | 16 | 0,0096 | 0,19 | 1M (~83 h) | Varias es-ES | Exige cuenta con facturación activa |
| Google Chirp 3: HD | Muy buena, la más natural de las de nube «baratas» | StreamingSynthesize | 30 | 0,018 | 0,36 | 1M (~83 h) | 30 voces es-ES | Facturación activa; auth con ADC o cuenta de servicio (no API key) |
| **Azure Neural (implementado)** | Muy buena: son las mismas voces que Edge llama «Natural» | REST con el fichero entero; streaming con el SDK | 15 | 0,009 | 0,18 | **0,5M (~41 h)** | 16 voces es-ES; varias en una sola petición (SSML) | Free F0: 20 peticiones por minuto; la cuenta pide tarjeta para verificar, sin cobro |
| Azure Neural HD | Excelente, con estilos | <300 ms en tiempo real | 22 | 0,0132 | 0,26 | ¿F0? [sin verificar] | Ximena y Tristán DragonHD, Marta (10 estilos) | Igual que Azure Neural |
| Piper (autoalojado) | Correcta, robótica en frases largas | Más rápido que tiempo real en CPU [sin verificar] | solo máquina | — | — | ilimitado | 5 voces es-ES (davefx, sharvard, carlfm…) | Motor GPL-3.0; voces MIT, sharvard pide atribución (CC BY 3.0) |
| Kokoro-82M (autoalojado) | Floja en castellano (el propio repo lo avisa) | Rápida en CPU modesta | solo máquina | — | — | ilimitado | 3 voces españolas | Apache-2.0 |
| XTTS-v2 (autoalojado) | Muy buena y clona voz con ~6 s | Necesita GPU | máquina con GPU | — | — | ilimitado | Las que se clonen | Coqui Public Model License: **no comercial** |

## Cada opción

### Síntesis del navegador (Web Speech API, `speechSynthesis`)

Calidad por navegador y sistema:

- **Edge en Windows y macOS.** Expone más de 250 voces «Online (Natural)». Son las voces neuronales de Azure (Elvira, Álvaro, Ximena…) y con diferencia lo mejor que se oye gratis. Necesitan conexión. En macOS la lista completa solo aparece después de la primera locución. Hay un fallo reciente en Edge 150 en el que salen voces «undefined».
- **Chrome de escritorio.** Trae «Google español» online, correcta.
- **Android (Chrome).** Usa el motor TTS del sistema (Google), con calidad aceptable. Si falta el paquete de idioma, lee con voz inglesa.
- **iOS y Safari.** La API solo da las voces básicas del sistema (Mónica, Jorge…). Las voces «mejoradas» o «premium» y las de Siri que el usuario descarga no se exponen. Todos los navegadores de iOS usan este mismo motor.
- **Edge en Android.** Devuelve la lista de voces vacía (dato de 2024 que otra fuente contradice) [sin verificar].
- **Firefox.** No trae voces propias: usa las del sistema.

Límites conocidos y cómo los resuelve el prototipo:

- **Chrome corta a los ~15 s.** Corta las locuciones largas de forma silenciosa (issue Chromium 679437). El prototipo parte el texto en frases de 200 caracteres como mucho.
- **Hace falta un gesto del usuario.** `speak()` falla sin una activación previa del usuario (Chrome 71+), así que hace falta un toque. El prototipo «desbloquea» la voz con una locución vacía dentro del clic de «Leer solo». Si aun así falla, avisa en el chat.
- **La lista de voces llega tarde.** `getVoices()` puede venir vacía hasta el evento `voiceschanged`; el prototipo la rellena cuando llega.

Fuentes, consultadas el 21-10-2026:

- [Readium: estado de Web Speech por navegador (2024)](https://readium.org/speech/docs/WebSpeech.html)
- [Chrome 71: speechSynthesis requiere activación](https://developer.chrome.com/blog/chrome-71-deps-rems/)
- [MDN SpeechSynthesis (modificada 27-5-2025)](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis)
- [Hilo de Edge 150 con voces undefined](https://techcommunity.microsoft.com/discussions/edgeinsiderdiscussions/edge-version-150-javascript-speechsynthesis-getvoices-undefined-voices/4538591)

### OpenAI TTS

- **Precio.** tts-1 cuesta $15 y tts-1-hd $30 por 1M de caracteres. gpt-4o-mini-tts cuesta $0,60 por 1M de tokens de texto y $12 por 1M de tokens de audio. La cifra de «~$0,015 por minuto» que circula no sale en la página oficial [sin verificar].
- **Voces.** Hay 13 (marin y cedar son las recomendadas). Están optimizadas para inglés: en castellano son buenas pero con algo de acento.
- **Streaming y condiciones.** Hay streaming por trozos. No hay capa gratuita. Hay que avisar al usuario de que la voz es generada por IA.
- **Retirada.** OpenAI anunció el 1-10-2026 que tts-1, tts-1-hd y gpt-4o-mini-tts se apagan el **6-1-2027**. El sustituto va por la Realtime API. No conviene construir encima ahora.

Fuentes:

- [Precios (consultado 21-10-2026)](https://developers.openai.com/api/docs/pricing)
- [Guía TTS](https://developers.openai.com/api/docs/guides/text-to-speech)
- [Retiradas](https://developers.openai.com/api/docs/deprecations)
- Muestras en openai.fm

### ElevenLabs

- **Precio API.** Flash/Turbo cuesta $0,04 por 1.000 caracteres ($40 por 1M). v3, v4 y Multilingual v2 cuestan $0,08 ($80 por 1M). Es la opción más cara, pero también la más expresiva, con voces de personaje y clonado.
- **Latencia.** Flash v2.5 tiene unos 75 ms de latencia de modelo y streaming por WebSocket. Multilingual v2 tiene variantes de España.
- **Caracteres por plan.** Free trae 10k (o 20k con Flash). Starter ($6) trae 75k y Creator ($22) 275k. La página general de precios da cifras unas 2,5 veces menores [sin verificar cuál aplica a la API].
- **Licencia.** El plan Free no permite uso comercial y obliga a atribuir «elevenlabs.io». Los planes de pago incluyen licencia comercial.

Fuentes:

- [Precios API (consultado 21-10-2026)](https://elevenlabs.io/pricing/api)
- [Modelos](https://elevenlabs.io/docs/overview/models)
- [Uso del plan gratuito](https://elevenlabs.io/docs/help-center/legal/can-i-publish-the-content-i-generate-on-the-platform)
- Muestras en la [Voice Library](https://elevenlabs.io/voice-library)

### Google Cloud Text-to-Speech

- **Precio por 1M de caracteres (gratis al mes entre paréntesis).** Standard $4 (4M), WaveNet $4 (4M o 1M según la versión de la página [sin verificar]), Neural2 $16 (1M), Chirp 3: HD $30 (1M) y Studio $160 (1M). La página de precios se pinta con JavaScript y no se pudo leer entera: las cifras salen de los extractos de cloud.google.com en el buscador [sin verificar en la tabla].
- **Chirp 3: HD.** Tiene 30 voces es-ES en GA, velocidad de 0,25 a 2,0 y pausas con `[pause]`. Admite `StreamingSynthesize`, pero sin SSML.
- **Requisitos.** Hace falta un proyecto con facturación activa: la capa gratuita es mensual y no caduca, y hay $300 de crédito inicial. La documentación oficial solo describe autenticación con ADC, gcloud o cuenta de servicio. Que funcione con API key es habitual en guías de terceros, pero no está documentado.
- **Encaje con Tavernus.** Es la mejor cuota gratuita de calidad alta (unas 83 h al mes con Chirp 3 HD), y el proyecto ya está en GCP (la VM e2-micro). En contra: activar la facturación y montar credenciales de servicio.

Fuentes:

- [Precios (consultado 21-10-2026)](https://cloud.google.com/text-to-speech/pricing)
- [Chirp 3: HD (actualizada 20-10-2026)](https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd)
- [Autenticación](https://docs.cloud.google.com/text-to-speech/docs/authentication)
- Demo en [cloud.google.com/text-to-speech](https://cloud.google.com/text-to-speech)

### Azure AI Speech, Neural TTS (el adaptador implementado)

- **Precio.** S1 Neural cuesta $15 por 1M (vigente desde 1-2-2024) y Neural HD $22 (desde 1-3-2026). Los commitment tiers bajan hasta $5,70.
- **Capa gratuita F0.** Trae 0,5M de caracteres neuronales al mes, unas 41 h, con un límite de 20 peticiones por minuto que no se puede ampliar. Abrir la cuenta exige tarjeta para verificar la identidad, sin cobro.
- **Voces es-ES.** Elvira, Álvaro (con estilos), Abril, Arnau, Darío, Elías, Estrella, Irene, Laia, Lía, Nil, Saúl, Teo, Triana, Vera y Ximena. Las multilingües son Arabella, Isidora, Tristán y Ximena. Las HD son Ximena y Tristán DragonHD, y Marta, con 10 estilos (serious, excited, adventurous…).
- **Por qué se eligió.** Se activa con **una clave** por la cabecera documentada `Ocp-Apim-Subscription-Key`, por REST y sin SDK. Admite hasta 50 `<voice>` en una sola petición SSML: narrador y cada NPC con su voz en un solo audio, lo que deja una petición por narración, dentro del límite de 20 por minuto de F0. Además son las mismas voces que Edge da gratis, así que el salto de «navegador» a «nube» no cambia el timbre.

Fuentes:

- [Precios vía la API de precios de Azure (consultado 21-10-2026)](https://prices.azure.com/api/retail/prices); la [página pública](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/) no muestra cifras sin región.
- [Cuotas y límites (actualizada 19-10-2026)](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-services-quotas-and-limits)
- [API REST de TTS (21-5-2026)](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)
- [Voces por idioma (19-10-2026)](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)
- [Voces HD](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/high-definition-voices)
- [FAQ de cuenta gratuita](https://azure.microsoft.com/en-us/free/free-account-faq/)
- Muestras en la [Voice Gallery](https://speech.microsoft.com/portal/voicegallery)

### Código abierto autoalojable

- **Piper.** Es la opción realista para una máquina modesta. Corre en CPU, incluso en una Raspberry Pi. Tiene 5 voces es_ES; davefx tiene el modelo MIT y datos CC0. El proyecto vivo es OHF-Voice/piper1-gpl (GPL-3.0) y busca mantenedores. La calidad es claramente inferior a las neuronales de nube en prosa larga.
- **Kokoro-82M.** Es Apache-2.0 y ligero, pero tiene solo 3 voces españolas y el repositorio avisa de que el soporte de idiomas distintos del inglés es débil.
- **XTTS-v2.** Es el de más calidad y clona voces, pero necesita GPU y su licencia es no comercial (Coqui cerró, así que no hay licencia de pago).
- **F5-TTS.** Pesos CC-BY-NC-4.0; el español solo existe en fine-tunes de la comunidad.
- **Coste.** Ninguno cabe en la VM e2-micro actual (1 GB de RAM) con margen para el juego. Haría falta otra máquina, y entonces el coste es el de esa máquina, no por carácter.

Fuentes:

- [piper1-gpl](https://github.com/OHF-Voice/piper1-gpl)
- [Voces es_ES de Piper](https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_ES)
- [Muestras de Piper](https://rhasspy.github.io/piper-samples)
- [Voces de Kokoro](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)
- [XTTS-v2](https://huggingface.co/coqui/XTTS-v2)
- [F5-TTS](https://huggingface.co/SWivid/F5-TTS)

## Recomendación

1. **Gratis: la voz del navegador.** Es el modo por defecto del prototipo (`TTS_PROVIDER=browser`). En el ordenador, con Edge suena muy bien (voces «Natural»). En Android se oye correcto con la voz de Google del sistema. En iPhone es la peor: voces básicas y se corta al bloquear. Cuesta 0 €.
2. **Barato con calidad: Azure Neural** (`TTS_PROVIDER=azure`, ya implementado). Las primeras ~41 h al mes son gratis (F0) y después cuesta **$0,18 por jugador y hora**. Suena igual en cualquier móvil y, al ser un `<audio>`, sigue sonando con la pantalla apagada. Si se quiere más cuota gratis y hay facturación en GCP, la alternativa es Google Chirp 3: HD: 83 h gratis y después $0,36 por jugador y hora. Para añadirla basta un segundo proveedor en `src/ai/narrator.ts`.
3. **Premium: ElevenLabs v3/v4**, con voces de personaje muy expresivas: **$0,96 por jugador y hora**, o $0,48 con Flash. Un punto intermedio es Azure HD (Ximena o Tristán DragonHD, Marta con estilos) a $0,26 por jugador y hora.

Coste por jugador y hora (20 acciones, 12.000 caracteres):

| Escalón | Proveedor | $/hora | 10 h de juego al mes | Gratis cubre |
|---|---|---|---|---|
| Gratis | Navegador | 0 | 0 | todo |
| Barato | Azure Neural | 0,18 | 0 (dentro de F0) | ~41 h/mes |
| Barato (alt.) | Google Chirp 3 HD | 0,36 | 0 (dentro de la cuota) | ~83 h/mes |
| Premium | ElevenLabs v3/v4 | 0,96 | ~9,6 (o el plan Creator, $22) | ~0,8 h/mes |

## El prototipo

### Qué hace

- Cada narración del máster lleva un **altavoz** junto al rótulo «Máster». Un toque la lee y otro la para.
- La cabecera del chat tiene **«Leer solo»**, que encadena las narraciones nuevas en cola (sin cortar la que suena), un botón **«Parar»** mientras lee y un **ajustes** con: voz del narrador, voz de los personajes, velocidad, leer automáticamente y mantener la pantalla encendida.
- Los ajustes se guardan en `localStorage` (`tavernus.tts.*`, con try/catch). La mejor voz en castellano se elige sola y se recuerda.
- **Voces distintas.** La narración se parte en trozos de narrador y de diálogo: rayas (`—Hola —dijo él—. Pasa.`) y comillas `«»`, `“”` y `""`. Una raya en mitad de una frase narrada se lee como inciso. Con `lines` del modo novela, cada parlamento toma su hablante.
  - En el navegador, el diálogo usa otra voz (de otro género que el narrador si se puede adivinar por el nombre) y cada hablante la suya. Si solo hay una voz, cambia el tono.
  - En Azure, cada NPC tiene siempre la misma voz de `TTS_VOICES_NPC`.
- **Limpieza.** `src/ai/speech.ts` es una función pura, con tests en `test/speech.test.ts`. Quita negritas, viñetas, iconos (🎲 📜 ⏳ ✓…) y atajos (`/look`). Lee `1d20+2 = 14` como «1 de 20 más 2, total 14», `CD 12` como «dificultad 12» y `PG` como «puntos de golpe». Convierte las rayas en pausas y separa los párrafos. La misma función se incrusta en la página, así que los tests prueban exactamente lo que ejecuta el navegador.

### Activar la voz de nube (Azure)

Probar contra la nube **gasta cuota**: con F0 no hay cobro, pero en S0 se cobran $15 por 1M de caracteres.

1. Crear un recurso **Speech** con plan **Free F0** en el portal de Azure.
2. Copiar la clave y la región.
3. Añadir al `.env`:

   ```
   TTS_PROVIDER=azure
   AZURE_SPEECH_KEY=…
   AZURE_SPEECH_REGION=westeurope
   # opcionales
   TTS_VOICE_NARRATOR=es-ES-AlvaroNeural
   TTS_VOICES_NPC=es-ES-ElviraNeural,es-ES-ArnauNeural,es-ES-XimenaNeural
   TTS_RATE=1
   TTS_MAX_CHARS=200000
   ```

`TTS_MAX_CHARS` corta las peticiones a la nube por arranque del servidor; lo cacheado no cuenta. El audio se guarda en `data/games/<slug>/audio/<hash>.mp3`: si el texto y las voces coinciden, no se vuelve a pedir. Si la nube falla, la web sigue con la voz del navegador.

### Pantalla apagada en el móvil: hasta dónde llega

Ninguna de estas conductas está documentada de forma oficial. Son el comportamiento habitual y hay que medirlo en cada móvil.

- **Voz del navegador.**
  - En **iOS**, la lectura se corta al bloquear la pantalla o cambiar de app.
  - En **Android (Chrome)**, la locución en curso suele terminar, pero la página en segundo plano queda congelada y la cadena se detiene.
  - Remedio: el ajuste **«Mantener la pantalla encendida»** (Screen Wake Lock API: Chrome Android 84+, Safari iOS 16.4+). Con él, el móvil sigue leyendo en el bolsillo, a costa de batería.
- **Voz de nube.** Es un `<audio>` normal con **Media Session**: título y botones en la pantalla de bloqueo, y sigue sonando con la pantalla apagada en Android e iOS. La narración que suena y las que ya estaban en cola se oyen enteras.
  - Lo que el navegador **no garantiza** es recibir narraciones nuevas con el móvil bloqueado. El stream (SSE) se congela en segundo plano: en iOS en segundos, en Android al cabo de unos minutos. Llegan al desbloquear.
- **Para jugar de verdad con el móvil en el bolsillo** hace falta:
  - mantener la pantalla encendida, o
  - una PWA o app nativa con sesión de audio, o
  - que el servidor genere el audio al emitir la narración y lo entregue con notificaciones push.

### Pendiente

- Probar Azure con una clave real. **No se ha ejecutado contra la nube**: está a la espera de confirmación del dueño.
- Medir la latencia real por narración: con REST el fichero llega entero, estimado en 1-2 s para 600 caracteres [sin medir]. Si molesta, pasar al streaming del SDK o a Google Chirp 3 HD con `StreamingSynthesize`.
- Pausar la lectura mientras se dicta con el micrófono (`voice-input.ts`), para que no se oiga a sí mismo.
- Estilos de Azure por emoción (`<mstts:express-as style="whispering">`) si el máster marca el tono.
