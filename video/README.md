# Vídeos de Tavernus (motion graphics)

Dos piezas hechas con HTML animado fotograma a fotograma, con las ilustraciones de la wiki y de `public/`,
la música propia del proyecto (`public/music`) y los efectos del juego (`public/sfx`).

| Vídeo | Fuente | Duración | Para qué |
|---|---|---|---|
| `out/tavernus-cuento.mp4` | `cuento.html` | 2:01 | La historia de Brezal contada como un cuento, sin desvelar el final |
| `out/tavernus-presentacion.mp4` | `pitch.html` | 1:48 | Qué es Tavernus y en qué se diferencia: para inversores, socios y jugadores |

Funcionan también sin sonido (el texto cuenta la historia), pensando en móviles y eventos de networking.

## Generarlos

```
node video/render.mjs video/cuento.html video/out/cuento-silent.mp4 --workers 4
node video/render.mjs video/pitch.html  video/out/pitch-silent.mp4  --workers 4
video/mix.sh cuento
video/mix.sh pitch
```

`--stills 5,30,60 --out-dir <carpeta>` saca fotogramas sueltos para revisar. Abrir el `.html` en el navegador lo
reproduce en bucle (sin sonido). Todo es función pura del tiempo (`lib/engine.js`), así que cada render sale igual.
Hace falta Playwright con Chromium y ffmpeg.
