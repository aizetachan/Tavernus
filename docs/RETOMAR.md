# Dónde lo dejamos y qué sigue

Actualizado: 14 de septiembre de 2026.

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
