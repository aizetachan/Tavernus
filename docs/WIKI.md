# La wiki

La wiki de Tavernus y de Brezal (el mundo, los personajes, las misiones y el diseño del juego) vive en
`wiki/`, se escribe con Obsidian y se publica con la web en **`/wiki/`** (en producción,
https://tavernus.com/wiki/). Es pública, como la portada: los secretos van en bloques plegados.

## Dónde está cada cosa

| | |
|---|---|
| `wiki/` | Las páginas, en Markdown de Obsidian, y `wiki/Imágenes/`. Esto es lo que se edita. |
| `src/wiki/` | El generador: `markdown.ts` (Obsidian a HTML), `theme.ts` (plantilla, estilos y buscador) y `build.ts` (recorre `wiki/` y escribe `dist/wiki/`). |
| `dist/wiki/` | La wiki construida: una página HTML por nota, `wiki.css`, `wiki.js`, `search.json` e `img/`. No se sube a git; la hace `npm run build`. |
| `src/adapters/web/server.ts` | Sirve `dist/wiki/` en `/wiki/` (`serveWiki`). |

Las notas personales del proyecto (diario, decisiones, pendientes) **no** son wiki: se quedan en el
vault de Obsidian, fuera del repositorio. Las páginas de la wiki que las enlazan (`[[Decisiones]]`)
salen en la web como texto, sin enlace.

## Escribir

Se edita con Obsidian como siempre: la carpeta `wiki/` del repositorio está enlazada dentro del vault
(en el PC de Miguel, `Proyectos/Tavernus/Wiki` es un enlace de Windows a `D:\MyProjects\tavernus\wiki`).
Cada cambio es un cambio en git; para que salga en la web, commit y despliegue.

Lo que entiende el generador:

- **Cabecera YAML**: `title`, `description` (sale debajo del título y en el buscador), `aliases` (otros
  nombres por los que se enlaza), `tags` y `npc`. Las demás claves se ignoran.
- **`npc: npc_hugo`** en una ficha de personaje: su sección «Lleva encima» no se escribe a mano. Al construir,
  `src/wiki/carries.ts` la rellena con una tabla de lo que lleva ese NPC al empezar una partida de Brezal (la
  campaña escrita con el ajuar aplicado): qué, dónde (puesto, al cinto, en la bolsa, encima), el dinero o la
  descripción, y si lo pone la historia o el ajuar. Si la ficha no tiene la sección, se añade antes de
  «Relaciones». Un `npc` que no existe en los datos rompe la construcción.
- **Enlaces** `[[Página]]`, `[[Página|texto]]`, `[[Página#Sección]]`, `[[Página#Sección|texto]]` y
  `[[#Sección]]`. Se resuelven por nombre de fichero, por alias y, para los `index.md`, por el nombre de
  su carpeta, sin distinguir mayúsculas ni acentos. Dentro de una tabla, `\|` como en Obsidian.
- **Imágenes** `![[foto.jpg]]` y `![[foto.jpg|300]]` (ancho), desde `wiki/Imágenes/` o cualquier
  carpeta de `wiki/`. Una línea en cursiva justo debajo hace de pie de foto.
- **Callouts** `> [!tipo] Título`: `[!ficha]` es la tarjeta de un personaje o lugar (flota a la
  derecha, con su retrato), `[!warning]-` es un spoiler plegado (cerrado hasta que se pulsa; lo que
  esconde no entra en el buscador), `[!abstract]`, `[!example]`, `[!question]`, `[!info]`, `[!note]`…
  Con `+` sale abierto y plegable.
- Lo demás es Markdown corriente: encabezados (con ancla, `#seccion`), listas, tablas, negritas,
  citas y código. Las etiquetas `<br>` y `<small>` se respetan; cualquier otra `<` se enseña como texto.

Direcciones: la carpeta y el nombre, sin acentos ni espacios. `El mundo/Brezal/Taberna del Jabalí.md`
es `/wiki/el-mundo/brezal/taberna-del-jabali`; el `index.md` de cada carpeta es la carpeta
(`/wiki/el-mundo/brezal/`). Las carpetas de primer nivel con `index.md` forman la barra de secciones.

Cada página lleva, además de su contenido, las migas, un índice lateral con sus encabezados y
«Enlazan aquí», las páginas que la enlazan.

## Construir y comprobar

```bash
npm run wiki
```

Construye solo la wiki en `dist/wiki/` (con `tsx`, sin compilar el resto) y dice cuántas páginas e
imágenes hay y qué enlaces no apuntan a ninguna página. `npm run build` hace lo mismo después de
compilar, y `deploy/push.sh` la sube dentro de `dist/`. Para verla en local, `npm run web` y
http://localhost:3000/wiki/.

Los tests (`test/wiki.test.ts`) construyen un vault pequeño y la wiki de verdad, y comprueban que
todas las imágenes existen y que ningún enlace sin página parece una página mal escrita.

## El buscador

Es estático: `search.json` lleva, por página, título, sección, descripción, alias y el texto (sin lo
plegado), y `wiki.js` lo baja al pulsar en el cuadro y filtra en el navegador. Busca sin acentos ni
mayúsculas, pide todas las palabras, puntúa más el título y los alias que el texto, y enseña un trozo
con la palabra marcada. Flechas para moverse, Intro para abrir, Esc para cerrar; la tecla `/` lleva al
cuadro desde cualquier página.
