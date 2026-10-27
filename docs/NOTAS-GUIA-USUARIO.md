# Notas para la guía de usuario

Cuaderno de observaciones durante las pruebas reales. Aquí se apunta todo lo que
ocurre al poner en marcha y jugar, para convertirlo después en la guía de
usuario y en la guía de administrador. Se añade en cada sesión de prueba.

## Sesión 1 — 2026-09-06 — puesta en marcha del bot (Santy, admin)

### Pasos que hicieron falta (guía de administrador)

1. Portal de desarrolladores de Discord → New Application → nombre ("Tavernus Master").
2. Pestaña **Bot** → Reset Token → copiar. Activar los tres intents privilegiados:
   Presence, Server Members, Message Content. **Aquí sí hay botón de guardar**: aparece
   una barra verde abajo al mover un interruptor.
3. Pestaña **OAuth2** → URL Generator → scopes `bot` + `applications.commands` → permisos:
   Ver canales, Gestionar canales, Gestionar mensajes, Enviar mensajes, Enviar mensajes en
   los hilos, Leer el historial de mensajes, Añadir reacciones, Insertar enlaces, Crear hilos
   públicos. **Esta pantalla no se guarda**: los permisos van dentro de la URL generada.
4. Copiar la URL, abrirla en el navegador, elegir el servidor, Autorizar.
5. En la app de Discord: Ajustes → Avanzado → Modo desarrollador. Luego clic derecho en el
   servidor → Copiar ID del servidor; clic en el avatar propio → Copiar ID de usuario.
6. `cp .env.example .env`, rellenar `DISCORD_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_ADMIN_ID`.
7. `npm run dev`. Confirmación en terminal: `[discord] listo como <bot> en <servidor>`.

### Dónde se atascó una persona real (puntos a cubrir en la guía)

- **"No hay botón de guardar"** en la pantalla de OAuth2 → hay que decir explícitamente que
  esa pantalla no se guarda y que la de Bot (intents) sí.
- **Conseguir los IDs**: no es obvio que hay que activar el Modo desarrollador primero, ni
  dónde está la opción de copiar el ID. Poner capturas.
- **El token pegado no se guardó**: en VS Code el fichero quedó con el punto blanco de
  "sin guardar". La guía debe decir "Cmd+S" y cómo comprobar que quedó guardado
  (`grep DISCORD_TOKEN .env` muestra algo tras el `=`).
- El token solo se ve una vez en el portal; si se pierde, Reset Token y el anterior deja de valer.
- Mensaje de arranque: los avisos "usuario u_kael no está en el servidor" son normales
  (personajes de prueba de la semilla). Conviene que el propio bot lo diga más claro o
  que la semilla de producción no lleve personajes.

### Pendiente de observar en la prueba de juego

- Si los canales aparecen sin recargar Discord.
- Si el flujo de `#crear-personaje` se entiende sin explicación.
- Qué acciones escribe la gente que el parser no entiende (candidatas para el master IA).
- Si la hoja viva se actualiza a tiempo y si se mira.
- Si se usa ⚠️ para reportar o la gente lo cuenta por `#ooc`.
- Confusión con el tiempo de juego (3×) y las esperas de viaje.

## Cómo apuntar aquí

Cada sesión: fecha, quién, qué se probó, qué funcionó, dónde hubo confusión, textos
exactos que escribió la gente y qué respondió el bot. Los reportes ⚠️ quedan en
`#reportes`; aquí va lo que no se reporta pero se ve.

## Sesión 1 (cont.) — primera prueba en Discord

- **Fallo grave:** en `#crear-personaje` vacío, Santy escribió "hola" y el bot creó un personaje
  llamado "Hola?". Corregido: el canal ahora tiene mensaje de bienvenida y el bot pide
  confirmación con botón antes de crear.
- **Regla derivada:** todo canal que cree el bot lleva un primer mensaje explicando para qué
  sirve y cómo se usa (`src/adapters/discord/texts.ts`). Los `#hoja` no, porque solo
  contienen la hoja.
- **Caída del bot:** al fijar la hoja, Discord devolvió "Missing Permissions". Discord separó
  "Fijar mensajes" en un permiso propio (`PinMessages`) que no estaba en la URL de invitación.
  Ahora fijar es opcional y ningún error de un handler tumba el proceso.
- **Duda de privacidad:** qué canales ven los demás. Respuesta: `#tablon`, `#ooc` y
  `#crear-personaje` los ve todo el servidor; `#reportes` solo el admin; `#pov-<nombre>` y
  `#hoja-<nombre>` solo su jugador y el bot. La guía debe decirlo en la bienvenida.
- Añadido `/admin-borrar nombre` (solo admin) y `scripts/delete-character.ts` para que un
  probador pueda empezar de cero.
- **Privacidad al crear:** Santy pidió que la creación no fuera pública. Solución: `#crear-personaje`
  es de solo lectura con un botón "Crear personaje" que abre un formulario emergente (modal) que
  solo ve quien lo pulsa; la respuesta es efímera. Este mismo mecanismo (botones + modales +
  respuestas efímeras) vale para el flujo completo de creación con SRD de la fase 2.

## Sesión 2 — 2026-09-06 — primera partida real (Santy, personaje "Gato")

- Acciones escritas: "Me acerco a la barra" (entendida), "Miro alrededor a ver quien hay en la
  taberna" (entendida como mirar). El jugador escribe frases largas y naturales; el parser de
  fase 1 las cubre a medias.
- **"El master se repite."** En fase 1 no hay master: la narración es plantilla desde los datos y
  "mirar" devuelve siempre lo mismo. Es lo esperado hasta la fase 2 (Claude). Para la guía de
  probadores: avisar de que en esta fase el narrador es plano.
- **Inicio distinto por jugador.** Santy quiere que cada uno empiece en un sitio distinto.
  Cambio de diseño respecto a la spec (§4.6 hablaba de un único `starting_location`): ahora
  `campaign.starting_spot_ids[]` y cada PJ nuevo aparece en la localización menos poblada.
  En la semilla: puerta de la taberna, el pozo, el sendero del claro. Pendiente actualizar la spec.
- Reset de personaje pedido para volver a empezar: `scripts/delete-character.ts` o `/admin-borrar`.

## Sesión 3 — 2026-09-06 — arranque de la fase 2 (master con Claude)

- **Suscripción vs API:** Santy preguntó si el bot podía usar su plan Max. No: las condiciones de
  Anthropic prohíben usar credenciales de suscripción en servicios propios. Hace falta clave de API
  de platform.claude.com con saldo prepago. Para la guía de admin: explicar la diferencia.
- Decisiones: Opus 5, esfuerzo `low` (7-12 s por acción; con `medium` 19-50 s y sin mejora
  apreciable), primer tramo = narración + tools + dados.
- Coste medido: prefijo cacheado de ~5.8k tokens (sistema + tools); por acción ~1-3k tokens de
  entrada nuevos y ~500-900 de salida. Encaja con la estimación de ~0,03-0,06 $ por acción.
- Fallo real: con 20 tools en modo estricto la API devuelve "compiled grammar is too large".
  Solución: estricto solo `log_event`.
- Fallo real: en una respuesta se colaron etiquetas XML de parámetros dentro del texto narrado.
  Solución: saneado del cierre (`cleanText`). Vigilar si se repite.
- El master pidió tirada de Persuasión (CD 13) al preguntar por Vharn y de Sigilo (CD 14) al
  colarse tras la barra: la regla "intención antes de efecto" y "requires_roll" funcionan.
- Para la guía de jugador: tras una acción con riesgo aparece el botón 🎲; sin pulsarlo, la acción
  no se resuelve; cualquier otra acción la anula. Los botones de acciones sugeridas se gastan al pulsar.

## Sesión 4 — 2026-09-06 — voces y primera escena

- **Observación de Santy:** el tutorial del `#pov` y la primera narración se veían iguales; no se
  distinguía sistema de master, y la primera narración era la descripción plana del sitio.
- **Decisiones (Santy):** sistema en embed gris oscuro (tutorial, tiradas, viajes, avisos, respuestas
  a comandos); master en embed azul con su nombre. La bienvenida es una primera escena narrada por el
  master: llegada al punto de inicio, premisa como ambiente (sin resumirla), gancho concreto y
  acciones sugeridas. La historia del personaje no la escribe el jugador: cada punto de inicio lleva
  su origen (viajero en la taberna, hijo de Brezal que vuelve en la plaza, cazador en el claro).
- Medido: la primera escena tarda ~10 s. Ejemplo real: llega al claro, "una película gris que no es
  polen: ceniza, fina, traída del norte", y el gancho es el hacha con hollín en el mango.
- Para la guía: "los recuadros grises son del sistema; los azules, la voz del narrador" ya está
  en el tutorial del `#pov`.
- **Observación de Santy:** la respuesta efímera tras crear el personaje ("Bienvenido, X. Tu canal es
  #pov-x") es demasiado técnica y no explica por qué hay que ir a otro canal si ya estás en un chat.
  Reescrita: dice que este canal es solo la puerta, que la aventura ocurre en su `#pov` privado donde
  el Narrador ya le está contando su llegada, cómo actuar allí, y dónde está su hoja.
  Regla para la guía: cada vez que se manda a alguien a otro sitio, decir qué va a encontrar y por qué.
- **Tono y longitud (Santy):** el master es un mago sabio; bienvenida en su voz pero breve. Se lee en
  móvil: respuestas cortas y fluidas, párrafos de 2-3 líneas; lo extenso solo si hace falta. Mejor
  varios envíos cortos que uno largo, aunque cueste algo más. Aplicado a la voz del master, al
  prompt de sistema (60-90 palabras) y a la bienvenida de la campaña.
- **Tono (Santy):** el sabio no habla tan directo al personaje; habla del mundo en general y deja
  que el jugador se vea en él. Bienvenida reescrita en tercera persona y voz del master con
  "observa más que interpela".
- **Bienvenida (Santy, tercera vuelta):** no una presentación del mundo sino el arranque de un
  cuento que anime a jugar, con el personaje dentro. Lo práctico (qué es el canal, dónde está la
  hoja) va aparte en el recuadro gris, no mezclado con la historia.
- **Etiquetas (Santy):** basta con el color del borde; fuera las etiquetas "el Narrador" y "Sistema" de los recuadros.
- **Tutorial del #pov (Santy):** demasiado técnico y frío. Ahora va en voz del Narrador, a la mitad
  de largo, con la historia asomando; los comandos quedan en una línea gris aparte. La primera
  escena abre con una frase de puente (un dicho, la hora, el mundo) antes de situar al personaje.
- **Repetición y longitud (Santy):** dos bienvenidas seguidas y dos notas grises casi iguales. Ahora: historia solo en #crear-personaje sin nota gris; #pov abre con tres frases del Narrador y una línea gris; primera escena en dos párrafos, 80 palabras máximo.
- **Longitud (Santy):** historia de bienvenida a la mitad (~50 palabras); en el #pov sobra decir que el canal es privado, se intuye.
- **(Santy):** fuera el mensaje del Narrador al abrir el #pov (solo línea gris). Bienvenida mística e invitadora, breve. La primera escena recibe la bienvenida en el prompt y debe empezar donde termina, más seria y concreta, sin repetir imágenes.
- **Primera escena (Santy):** no abrir con 'En Brezal dicen…': el jugador no conoce el sitio y quiere jugar. Ahora la primera frase es algo que le pasa al personaje en el cuerpo o los sentidos; nombres de lugares solo cuando importan; el gancho pide una decisión ya.
- **Fallo real (jugador ESDECO):** "Piedo guardarme las bayas en el bolsillo" → "No entiendo". Causa:
  el master llegó al tope de 8 tools sin cerrar porque el inventario del contexto no llevaba los IDs
  de los objetos y `transfer_item` fallaba una y otra vez; saltó el parser plano. Arreglado: inventario
  con IDs en el contexto y en `get_character`; al llegar al tope, una última llamada solo con
  `log_event` para que cierre narrando lo que pasó, en vez de rendirse.
- **Observación de Santy:** las acciones sugeridas miraban "a futuro"; deben ser lo que el personaje
  querría hacer ahora mismo, reacciones a lo que acaba de pasar. Ajustado en el prompt.
- Para la guía: un segundo jugador (ESDECO) ya ha entrado y jugado sin instrucciones nuestras.

## Sesión 5 — 2026-09-07 — memoria de NPC y objetivo de la demo

- **Decisiones (Santy):** ganar la demo = mezcla de pistas y reputación, sin un tesoro único que se
  agote. Memoria de NPC: lo más simple y barato que funcione bien; se escribe solo cuando el jugador
  habla con el NPC. Orden acordado: memoria de NPC → creación con SRD → combate → descanso y muerte.
- Implementado: el master, al cerrar una acción con conversación, apunta en el NPC una frase con
  importancia 1-3. Olvido: 1 a los 3 días de juego, 2 a los 30, 3 nunca. Tope 8 por PJ y 40 por NPC.
  Cola de conversación: un NPC atiende a uno; caduca a los 10 min de juego o si el PJ se aleja.
- Los NPCs llevan ahora descripción, motivación y secreto. El secreto lo ve el master con la regla
  de no soltarlo sin confianza, presión o tirada alta (se aparta de §8.4 de la spec, que lo excluía:
  hace falta para que las pistas de la demo funcionen). En la prueba, Brenna desvió la pregunta por
  las luces y pidió Persuasión CD 16.
- **Decisión (Santy):** el master conoce los secretos pero nunca los desvela ni los insinúa; es
  imparcial para que el jugador no se vea sesgado por lo que sabe el master. Aplicado al prompt.
- **Decisión (Santy):** la demo no "termina": quien complete el objetivo sigue en el mismo entorno
  hasta la siguiente actualización. No se gana; se recompensa a quien lo logra, y además recibirá un
  regalo cuando abramos el siguiente territorio.

### Demo jugable (2026-09-07)
- Implementado: reputación con Brezal, 5 pistas (descubrimientos personales), 6 encargos que rotan
  de 3 en 3 cada día de juego y se anuncian en `#tablon`, práctica por uso (10/30/60), venta y
  compra con Brenna a precio de lista, pesca en el arroyo, y el logro «Quien ha mirado la ceniza»
  (3 pistas + reputación 5): anuncio público, llave con el sello de Vharn y la habitación de arriba
  de la posada, oculta para los demás.
- Comandos nuevos: `/tablon` y `/progress`.
- Probado en real: talar tira Atletismo en el servidor (falló y el master lo narró como fallo);
  examinar el hollín del hacha pidió Investigación CD 10 y al superarla concedió la pista.
- Para la guía: qué es una pista, qué es el tablón, que los encargos se entregan al NPC que los pide,
  y que cada encargo suma reputación una sola vez por personaje.

### Creación con SRD (2026-09-07)
- Flujo por menús efímeros tras el nombre: raza (9) → clase (12) → trasfondo (6) → características
  (array estándar: "usar el recomendado" o repartir uno a uno) → habilidades de clase (multi-select
  con el número exacto, sin las que ya da el trasfondo o la raza) → modo de muerte → resumen y
  «Entrar en el mundo». El servidor valida todo otra vez.
- Derivados calculados por el servidor: PG (dado de golpe + CON), CA (armadura + DES con tope +
  escudo), salvaciones, percepción pasiva, visión en la oscuridad, velocidad. Equipo inicial de clase
  en manos, cuerpo, bolsillos y mochila (antorchas, raciones, cuerda).
- La hoja viva muestra ahora raza, clase, PG, CA, salvaciones y habilidades con sus bonus.
- Para la guía: qué es el array estándar y por qué no se escriben las habilidades a mano.
- **Nombres (Santy):** no mencionar nombres hasta que el personaje los conozca. Implementado: cada
  PJ lleva a quién conoce; el master nombra a los demás por lo que se ve ("la tabernera", "un humano
  con pinta de guerrero"); los nombres se aprenden al presentarse o al ser nombrados. Los textos
  que ven los testigos también sustituyen nombres desconocidos. Probado: Tamsin ve "una mujer de
  unos cincuenta años… seca la misma jarra"; al presentarse, Brenna dice su nombre y queda aprendido.
- Los personajes ya existentes en Discord (creados antes) no conocen a nadie por nombre hasta que se
  presenten; los de la semilla (Kael, Mira) sí se conocen entre ellos y a los NPCs.
- **Dado (Santy):** cuando hay tirada pendiente solo aparece 🎲 Tirar, sin otras opciones; la acción ya está decidida. Escribir otra cosa sigue anulándola.
- **Carga (Santy):** el 'escribiendo…' de Discord caduca a los 10 s y el master tarda más; ahora se renueva cada 8 s mientras trabaja (acciones, tiradas, primera escena).
- **Llegadas (Santy):** al llegar a un destino el jugador se quedaba con los botones de antes y sin contexto. Ahora el master narra la escena de llegada (qué hay delante, quién anda, 3-4 acciones desde ahí) y los botones del mensaje anterior se retiran al llegar uno nuevo. Tramos intermedios siguen en gris.
- **Notificaciones (Santy):** el bot no puede cambiar las preferencias de otros. Solución: servidor en 'Solo @menciones' + el bot menciona al jugador en su #pov solo cuando pasa algo que no es respuesta a su propia acción (llegadas, otros cerca, encargos, logro).
- **Legibilidad (Santy):** los mensajes del master van como texto normal (letra más grande en móvil); el sistema sigue en recuadro gris. La bienvenida de #crear-personaje sigue en azul por ser un mensaje único.
- **Menciones (Santy):** la mención muestra el usuario de Discord, no el personaje. Ahora el bot pone el apodo de servidor = nombre del personaje (salvo al dueño del servidor, que Discord no permite) y la mención va al final en letra pequeña. Requiere el permiso 'Gestionar apodos'.
- **Sin menciones (Santy):** se quitan. Cada jugador pone su #pov en 'Todos los mensajes' (una vez); el servidor queda en 'Solo @menciones'. Instrucción añadida a la línea gris del #pov. El apodo = nombre del personaje se mantiene.
- **Onboarding (Santy):** dos vías. Nativa: activar Comunidad → Reglas y requisitos (aceptación
  obligatoria), Pantalla de bienvenida con #crear-personaje destacado. Bot: al entrar alguien, mensaje
  privado con qué es esto y enlace a #crear-personaje; si tiene los privados cerrados, aviso en
  #crear-personaje que se borra a los 10 min. Pendiente: redactar reglas y bienvenida nativas.

### Combate (2026-09-07)
- Conversacional, sin turnos (§9.3). NPCs con bloque SRD (CA, PG, ataque, daño, XP) y actitud por
  PJ. El ataque del jugador: el master pide 🎲 con objetivo; el servidor tira contra la CA, calcula
  el daño del arma en mano (crítico con 20) y lo aplica; el master narra. Los NPCs atacan con el tool
  `attack`. A 0 PG el PJ cae inconsciente (muerte y reaparición: siguiente paso). Un NPC muerto suelta
  lo que lleva y da XP a quien lo mata.
- Ventana decisiva: solo con amenaza real e inmediata; 60 s con aviso en el mensaje; respuesta en
  menos de 15 s da ventaja; sin respuesta, la amenaza se ejecuta contra el PJ.
- Nuevo enemigo en la demo: un lobo gris en el arroyo del claro (CA 13, 11 PG, mordisco 2d4+2).
- Fallo real: con tantos campos, la API rechazó el esquema estricto de `log_event` ("Schema is too
  complex"). Sin modo estricto en ningún tool; el servidor valida.
- Para la guía: el combate no tiene turnos; cuando aparece el ⏳ hay que responder rápido.

## Sesión 6 — 2026-09-11 — caída y seguimiento

- **Caída:** el bot murió el 10 de septiembre a las 16:15 por un corte de conexión con Discord
  (handshake timeout, probablemente el Mac dormido o sin wifi). El error no estaba capturado y el
  proceso terminó; nadie lo relanzó. No era falta de saldo: la API respondía bien.
- **Arreglos:** errores de conexión capturados (discord.js reconecta solo); vigilante
  `scripts/run-bot.sh` que relanza el bot a los 5 s y mantiene el Mac despierto con `caffeinate`;
  logs en `logs/bot.log`.
- **Seguimiento:** aviso en `#reportes` en cada arranque (limpio, o caída con código, motivo y minutos
  fuera, gracias a un latido cada minuto en `logs/heartbeat.json`); comando `/estado` solo para el
  admin (tiempo en marcha, latencia de Discord, respuestas y errores del narrador en la última hora,
  último error, jugadores conectados).
- **Límite:** si el Mac se apaga o se cierra la tapa sin corriente, no hay nada que avise. La solución
  de verdad es la VM de §14.4.
- **Texto del botón** de `#crear-personaje` en voz del Narrador.
- **VM preparada a falta de cuenta:** `gcloud` del Mac tiene solo la cuenta del trabajo con un proyecto
  de empresa; la VM NO debe ir ahí. Creada la configuración `tavernus` sin activar. Scripts en
  `deploy/` (crear VM, preparar, subir código y partida, servicio systemd, copias diarias).
  Pendiente de Santy: proyecto personal con facturación y login con la cuenta personal.
- Para la guía de admin: separar siempre la cuenta personal de la del trabajo en `gcloud`.

## Web local para trabajar el front (21 oct 2026)

- **Arrancar sin gastar API ni levantar Discord:** perfil `tavernus-web-offline` de `.claude/launch.json`
  (puerto 3107, `MASTER_MODE=offline`, partidas en `data/local/offline/`). Abre `http://localhost:3107`.
- **El servidor no recarga solo:** el HTML/CSS/JS está en strings de `src/adapters/web/page*.ts`;
  tras cada cambio hay que reiniciarlo.
- **Pantallas y flujo actual en Figma:** archivo TAVERNUS, página «01 · Flujo actual».
- **Defectos vistos al documentarlo:** en móvil (390 px) la cabecera no cabe y el botón «Hoja» se corta;
  una partida que no existe redirige al menú sin avisar.

## Diseño · propuesta 3 «Liquid Glass» (Figma, 21 oct 2026)
- Página «03 · Liquid Glass (3 columnas)» del Figma TAVERNUS. El chat mide lo mismo que un móvil (unos 400 px) y va en el centro. A la izquierda queda la información del personaje (ficha, misión, grupo, mochila) y a la derecha lo espacial (tablero, mapa, escena, puntos cercanos, salidas).
- En móvil, cada columna es una pestaña de la barra inferior: Personaje · Partida · Tablero. Los componentes son los mismos («Chat · móvil», «Columna · info», «Columna · tablero»).
- Se usa el efecto Glass nativo de Figma. Las fuentes locales (SF Pro) no se dibujan desde el plugin, así que la propuesta usa Inter. En la web real se puede usar `-apple-system`/SF Pro con Inter de respaldo.

## Diseño · propuesta 4 (Figma, 21 oct 2026)
- Página «04 · Liquid Glass · layout v2»: la estructura de la propuesta 2 con el estilo vidrio de la 3. El chat sigue siendo el componente de ancho móvil («Chat · móvil»).
- Escritorio: la escena ocupa el bloque principal y el chat flota encima, a la izquierda. A la derecha va el panel lateral con la ficha y las pestañas Tablero / Mapa / Hoja.
- Móvil: la escena hace de cabecera y hay 4 pestañas (Partida, Tablero, Mapa, Hoja). El tablero se abre como hoja inferior de vidrio.

## Diseño · versiones B «vidrio espacial» (Figma, 21 oct 2026)
- En las páginas 03 y 04 hay una sección «Versión B · vidrio espacial (más sutil)» con las mismas pantallas (G1B–G5B y P0B–M2B), para compararlas con las originales.
- Criterio, según las Human Interface Guidelines de Apple (Materials y Spatial layout): Liquid Glass solo en los controles y la navegación flotantes; el contenido va en superficies sin borde; una ventana por zona; nada de vidrio sobre vidrio.
- Estilos nuevos: los efectos «Glass B/Ventana» (vidrio esmerilado, brillo superior y sombra amplia), «Glass B/Control» (Liquid Glass sutil), «Glass B/Hoja» y «Glass B/Acento», y las variables material/platter, material/control y material/hover.
- Aprendizaje: en Figma, el efecto Glass sobre superficies grandes dibuja un canto marcado. Para las ventanas queda mejor el desenfoque de fondo.

- (2026-10-21) Diseño elegido: P1B (página 04 de Figma). En escritorio el chat ocupa todo el espacio central; las imágenes de escena van dentro de los mensajes del máster y, al pulsarlas, se abren ampliadas en una modal (frame «P1B · Imagen ampliada (modal)»; se cierra con la X, clic fuera o Esc).

## Interfaz web · estilo «vidrio espacial» (rama rediseno-liquid-glass-b, 21 oct 2026)
- Menú: la taberna vikinga al amanecer de fondo (imagen hecha con Nano Banana 2.1 en Magnific; está en `public/taberna.jpg` y la sirve `/assets/taberna.jpg`). Arriba, «Continúa tu historia» con la última partida; debajo, pestañas Partidas / Demos / Grabaciones y tarjetas. «Nueva partida» abre una hoja con el formulario; las acciones secundarias (borrar, convertir en demo, jugar desde el principio) están en el botón «…» de cada tarjeta.
- Partida: el chat ocupa el centro; las ilustraciones de escena aparecen dentro del chat y un clic las abre en grande (Esc o clic fuera para cerrar). A la derecha, la ficha del personaje (PG, CA, velocidad, percepción, nivel) y las pestañas Tablero / Mapa / Hoja. Los avatares de arriba a la derecha cambian de personaje; la hora de la partida va en el centro.
- Móvil: barra de abajo con Partida / Tablero / Mapa / Hoja.

## Menú de madera, transición y mochila (27 oct 2026)
- Menú: panel lateral de tablones con marco de madera dorada y runas; el nombre es el logotipo dorado. Arriba a la derecha del panel, la música; a la derecha del buscador, el engranaje con Partidas / Demos / Grabaciones y cuántas hay. «Nueva partida» va siempre debajo de la última partida. Cada partida lleva un aro de color fijo y una bolita del tipo de máster (al pasar el ratón dice cuál es). «Claude disponible» sale arriba a la izquierda, sobre la imagen.
- Nueva partida: nombre e invitados (0 por defecto) en la misma fila, y el engranaje de opciones avanzadas (semilla de dados). Tu personaje justo debajo; «Aspecto» abre una ventanita para describirlo. Mundo, máster y muerte son tarjetas con imagen.
- Al entrar en una partida, el panel se vuelve «tecnológico», todo se funde a negro (unos 4 s) y suena suave la música de entrada; si la música del menú estaba silenciada, no suena.
- Partida: la figura junto al nombre abre la Hoja con todas las estadísticas; la vida va en una barra debajo. Narrador: si hay ElevenLabs, aparece marcado en el selector; se puede cambiar a una voz del navegador.
- Mochila: arrastrar un objeto a otro sitio (mano, bolsillo, mochila, equipo) lo mueve de verdad, con las reglas de capacidad; dentro de bolsillos o de un contenedor, se intercambian posiciones (el orden se recuerda en ese navegador). Solo con ratón. Diario › Lugares: tarjetas con la ilustración o el plano del sitio.

## Narrador con ElevenLabs v3 (27 oct 2026)
- tavernus.com no tenía la voz de ElevenLabs porque el despliegue no sube el `.env`: hay que poner `TTS_PROVIDER`, `ELEVENLABS_API_KEY` y la voz en `/etc/tavernus/env` del servidor y reiniciar `tavernus-web`. Se comprueba en `https://tavernus.com/api/tts/config`.
- Con `ELEVENLABS_MODEL=eleven_v3` el narrador suena más expresivo: antes de leer, Haiku marca susurros, risas o suspiros sin cambiar el texto del chat. Lo ya escuchado con v2 se sigue oyendo con v2.
- Si ElevenLabs se queda sin créditos, la partida sigue con la voz del navegador y avisa; se vuelve a intentar a la media hora.
- En el selector del narrador se puede elegir ElevenLabs v3 (con acotaciones) o ElevenLabs v2 (más sobria y algo más rápida); se recuerda en ese navegador.

## Comandos con «/» y abajo del chat en el móvil (27 oct 2026)
- Los atajos /look, /where… ya no se ven encima del cuadro: al escribir «/» sale un menú con todos los comandos, su explicación y un buscador. ↑ ↓ para elegir, Intro para lanzarlo, Esc para cerrarlo; también se pueden pulsar.
- Encima del cuadro queda la fila de cómo va lo que escribes: «Hacer | Decir», que solo sale con más jugadores conectados. En escritorio, ahí va también «Dictado: enviar al dejar de hablar» (con el micrófono, manda lo dictado sin esperar a que lo revises); en el móvil ese ajuste está en el engranaje.
- Móvil: a la izquierda del cuadro, el engranaje de ajustes (generar imagen, sonido y música, narrador); a la derecha, Enviar y, pegada al borde, la mochila.
- Móvil: arriba a la izquierda, una flecha vuelve al menú principal; la mochila incluye «Tablero y mapa» (ficha, sitio, gente y misión). El sonido tampoco va ya en la cabecera, solo el botón de parar la voz mientras lee.
- Móvil: la letra de las burbujas es la misma que la del prólogo (13,5 px), y ninguna burbuja llega al borde contrario: las del narrador y las tuyas dejan el mismo hueco.
- Con el cuadro vacío, en el sitio de Enviar está el micrófono (mismo botón ámbar): púlsalo para dictar. En cuanto hay texto, vuelve Enviar; mientras dictas, el micrófono se queda en rojo.
- El prólogo ya no va en una caja: es texto de libro sobre el fondo, con el altavoz para escucharlo, y lo cierra un ornamento dorado antes de que hable el narrador.
- Hoja, Diario y Mochila se abren en un modal; sus pestañas van abajo, cada una con su parte del ancho. En el móvil hay una cuarta, «Tablero», con el tablero, el mapa, la gente cerca y la misión; el cuadro de texto y el botón de cerrar siguen debajo, y la cabecera de la partida no se tapa ni con el mapa en grande.
- Móvil: la pantalla no hace zoom ni se desplaza de lado (antes, al cerrar la mochila, se ampliaba al enfocar el cuadro); cerrar la mochila ya no abre el teclado.
- Móvil: las opciones de la mochila son pastillas como las del chat (texto y su icono dentro, sin círculos de color); la página entera ya no se desplaza al arrastrar dentro del modal o del chat.
- Sonido en tres canales, cada uno con su volumen y, a la derecha, su interruptor: Música (la canción de la partida, que suena en bucle hasta que se apaga), Efectos y Ambiente. En escritorio la cabecera lleva tres iconos: narrador, música (nota) y FX (efectos y ambiente). En el móvil todo está en el engranaje, bajo «Generar imagen, sonido y música».
- Narrador en los ajustes: ya sin la etiqueta «Narrador» encima del desplegable ni la nota de «audio cacheado».
- Sonido: ahora son dos canales, Música y «Efectos y ambiente» (un volumen y un interruptor para los dos); los interruptores van a la izquierda. En el móvil el engranaje se vuelve una X mientras los ajustes están abiertos.
- Móvil: arriba, el nombre de la partida y debajo la hora y el lugar («18:48 · La herrería»).

## Aspecto del menú: Penumbra y Taberna (27 oct 2026)
- En el engranaje del menú principal, «Aspecto»: **Penumbra** (por defecto, plano, con el estilo de la pantalla de partida) o **Taberna** (ilustrado: tablones, marco dorado y la madera que se vuelve tecnología al entrar). Se recuerda en ese navegador.
- En Penumbra las imágenes van en duotono (negro y dorado) y la de cada partida es la última vista de un sitio pintada en ella; si no tiene, la taberna. Al entrar en una partida, un fundido a negro corto.
- En Taberna, la partida lleva los tablones oscuros del menú (sin el marco dorado) en el panel lateral, la cabecera y la barra del cuadro de texto; en Penumbra sigue plana.

## Sonido, voz y retratos en la partida (27-10-2026)

- **Volúmenes de partida:** el ambiente suena al 50 %, la música al 25 % y el narrador al 75 %, por encima de los dos. Cada uno tiene su deslizador: Música y «Ambiente y efectos» en el panel de sonido; Volumen en el del narrador. Se recuerdan en cada navegador.
- **La música suena al entrar en la partida**, aunque no vengas del menú: empieza al primer toque si su botón (la nota) está encendido. Apagar efectos y ambiente ya no la corta.
- **En iPhone los deslizadores funcionan:** la música y la voz en la nube pasan por el mezclador de audio del navegador, porque Safari en iOS no deja cambiar el volumen de un audio normal.
- **Escuchar por avatar:** al pulsar el avatar de una burbuja se lee solo lo que dice esa burbuja (y las suyas seguidas), no la de otros personajes. El narrador lee solo su parte.
- **Retrato al aparecer un personaje:** sale encima de su primera frase, en un cuadrado pequeño (la mitad que antes), centrado, con su nombre (y apellidos, si los tiene) y su oficio («tabernera») en vez de «Retrato».
- **Tirada de dados:** al llegar el resultado se ve el dado girando y una raya de carga; el texto aparece cuando acaba el sonido del dado (con el sonido apagado, en menos de un segundo). Lo que viene detrás espera a que se vea.
- **Voz que tarda en cargar:** al pulsar un avatar, si la voz viene de la nube, su borde gira en ámbar mientras llega el audio; cuando empieza a sonar, vuelve a latir con la voz.
