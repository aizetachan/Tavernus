# Dónde lo dejamos y qué sigue

## Al retomar (21 de octubre de 2026): empieza por aquí

**Cambio de rumbo:** Discord deja de usarse. El producto es la **web propia** (`src/adapters/web`).
Todo lo que sigue en este fichero sobre el bot y la VM de Discord queda como historia; la issue #5
es retirarlo y ajustar la documentación.

**Hecho en la sesión del 21 de octubre:**

- **Diseño en Figma** (archivo TAVERNUS, https://www.figma.com/design/DLtN2zFOjXqXO4qDTudun3/TAVERNUS).
  - Elegida la propuesta 4 · versión B, «vidrio espacial» (página «04 · Liquid Glass · layout v2»).
  - La pantalla de partida de referencia es «P1B · Prueba fondo plano» (nodo 55-2938). Además hay
    una prueba con brillos ámbar (55-3130) y la modal de imagen ampliada.
  - El inicio de referencia es P0B (nodo 47-5114). Su imagen es la taberna vikinga al amanecer,
    hecha con Nano Banana 2.1 en Magnific a partir de una referencia (nodo 62-3359). Las demás
    versiones están al lado para comparar.
- **Rediseño implementado en la web, en el PR #3:**
  - Enlace: https://github.com/aizetachan/Tavernus/pull/3. Rama `redesign-interfaz`; el PR #2 se
    cerró por la «ñ» del nombre de la rama.
  - **Partida** (`page.ts`): el chat ocupa el centro y las ilustraciones van dentro del chat, con
    modal al pulsar. El panel lateral lleva la ficha y las pestañas Tablero / Mapa / Hoja; en móvil
    hay una barra inferior.
  - **Menú** (`page-menu.ts`): héroe con la taberna, «Continúa tu historia», pestañas y tarjetas, y
    una hoja para crear una nueva partida.
  - Imagen en `public/taberna.jpg`, servida por la ruta nueva `/assets/` de `server.ts`.
  - La lógica del juego no cambia; los 211 tests pasan.
- **Organización en GitHub (primer borrador, a revisar con el equipo):**
  - Etiquetas de área y prioridad, más `borrador`.
  - 4 milestones con fecha: M0 Base (31 oct), M1 Diseño: kit y UX (21 nov), M2 Beta cerrada
    (19 dic) y M3 Mundos generados (26 feb 2027).
  - 27 issues, de la #4 a la #30.
  - Project «Tavernus · hacia la beta»: https://github.com/users/aizetachan/projects/11

**Dónde nos quedamos y qué sigue:**

1. Santy revisa el borrador de issues, milestones y fechas con el equipo (issue #4). El Project
   tiene los campos de fecha «Inicio» y «Fin» en cada issue. Su vista Roadmap usa esos campos,
   está agrupada por milestone, a escala de trimestre y con los milestones como marcadores.
2. Revisar y fusionar el PR #3.
3. Diseño: rediseñar más a fondo, con un kit pequeño y una vuelta fuerte de UX (issues #8 a #13).
   El estilo actual es una primera fase.
4. La documentación del proceso irá también a Notion cuando el equipo lo use; las notas de
   `NOTAS-GUIA-USUARIO.md` se convierten en issues.

**Para probar el front sin gastar:** `IMAGES=on MASTER_MODE=offline WEB_PORT=3107 DATA_DIR=./data/local/offline
GAMES_DIR=./data/local/offline/games ANTHROPIC_BASE_URL=http://127.0.0.1:9 DISCORD_TOKEN= npm run web`
y abrir http://127.0.0.1:3107/ (o el perfil `tavernus-web-offline` de `.claude/launch.json`). El HTML
está en strings de `page*.ts`: hay que reiniciar el servidor tras cada cambio.

---

Actualizado: 14 de septiembre de 2026. El plan por fases hacia mundos generados y vivos, con lo
construido el 16 de octubre de 2026 (modos sin API, tablero, menú de partidas, reglas, recorte de
contexto), está en [`PLAN.md`](PLAN.md); este fichero sigue siendo el estado del despliegue.

## Estado

El juego funciona en Discord con un máster de Claude. Hecho: mundo compartido (mapa, movimiento con
tiempo real de viaje, inventario y capacidad, percepción por bandas, reloj), máster con tools y dados,
memoria de NPC, creación de personaje con SRD, combate conversacional, y la demo jugable de Brezal
(pistas, encargos del tablón, reputación, oficios y logro). 83 tests en verde.

**El bot corre en el Mac de Santy**, no en un servidor:

```
nohup scripts/run-bot.sh &        # arrancar (se relanza solo si falla)
pkill -f run-bot.sh; pkill -f "src/index.ts"   # parar
tail -f logs/bot.log              # ver qué hace
```

Si alguien dice que el bot "no responde", lo primero es `pgrep -f src/index.ts`. Si el Mac se apaga o
se cierra la tapa sin corriente, el juego se para y nadie recibe aviso. Por eso toca la VM.

## Lo siguiente: mover el bot a la VM de Google

Coste: la máquina es gratuita (nivel gratuito permanente). Lo único que se paga sigue siendo la API
de Claude.

### Pasos de Santy (15 minutos, nadie más puede hacerlos)

1. Entrar en https://console.cloud.google.com con **la cuenta personal de Gmail**, no con la del
   trabajo (la de nakamateam tiene un proyecto de empresa y no debe usarse: la factura iría a la
   empresa y el acceso dependería de ese trabajo). Comprobar el avatar arriba a la derecha.
2. Crear un proyecto, por ejemplo "tavernus", y apuntar el **ID del proyecto**.
3. Facturación: vincular una tarjeta al proyecto (Google la exige aunque la máquina sea gratuita) y
   crear una alerta de presupuesto de 10 €.
4. En la terminal de Claude Code, ejecutar y elegir la cuenta personal en el navegador:

   ```
   ! CLOUDSDK_ACTIVE_CONFIG_NAME=tavernus gcloud auth login
   ```

5. Dar el ID del proyecto.

La configuración `tavernus` de `gcloud` ya está creada y **sin activar**, para no tocar la cuenta del
trabajo. Todos los scripts de `deploy/` la usan mediante `CLOUDSDK_ACTIVE_CONFIG_NAME=tavernus`.

### Pasos automáticos (ya escritos en `deploy/`)

```
PROJECT=<id-del-proyecto> deploy/create-vm.sh   # crea e2-micro en us-central1 y la prepara
deploy/push.sh --with-data                      # sube código + .env + partida; para el bot del Mac
deploy/push.sh                                  # actualizaciones posteriores (no toca la partida)
```

`create-vm.sh` instala Node 24, 1 GB de swap y copias diarias de la partida con 7 días de historial.
`push.sh` compila con `tsc` y deja el bot como servicio `systemd`: se relanza solo y arranca al
encender la máquina. En la VM: `sudo journalctl -u tavernus -f` o `/opt/tavernus/logs/bot.log`.

**Importante:** dos bots con el mismo token responden por duplicado. `push.sh --with-data` para el
del Mac automáticamente; después, no volver a arrancar `run-bot.sh` en el Mac.

### Pendiente tras el despliegue

- Aviso externo por correo si el bot deja de dar señales (lo único que el Mac no puede hacer).
- Probar Firestore de verdad. Hoy la partida son ficheros JSON en `data/local`, que funcionan y se
  copian a diario; Firestore está escrito pero nunca se ha ejecutado contra un proyecto real.

## Después de la VM, en el juego

1. Descanso, muerte y reaparición según el modo elegido al crear el personaje (§9.1, §4.7).
2. Hechizos con resolvedor y barra rápida (§4.10).
3. Contenido: más localizaciones, NPCs y pistas; hoy Brezal se agota en un par de horas.
4. Director de trama y líneas secundarias (§3.1).
5. Panel de admin y métricas (§13).

Las observaciones de las pruebas con jugadores reales están en `docs/NOTAS-GUIA-USUARIO.md`, que es
la materia prima de la futura guía de usuario.
