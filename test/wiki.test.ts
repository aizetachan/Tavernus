import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Master } from '../src/ai/master.js';
import { offlineClient } from '../src/ai/offline.js';
import { GameManager, type MasterFactory } from '../src/games/manager.js';
import { createWebServer, type WebServer } from '../src/adapters/web/server.js';
import { buildWiki, placeOf, type BuildReport } from '../src/wiki/build.js';
import { frontmatter, plainText, slug } from '../src/wiki/markdown.js';

const noApi: MasterFactory = (engine) => new Master(engine, { client: offlineClient() });

/** Un vault pequeño con lo que usan las páginas de verdad: índices por carpeta, alias, fichas, spoilers, imágenes y notas privadas. */
async function vault(dir: string): Promise<void> {
  const w = async (file: string, text: string) => { await mkdir(join(dir, file, '..'), { recursive: true }); await writeFile(join(dir, file), text, 'utf8'); };
  await w('index.md', `---
title: Tavernus
description: La wiki de Tavernus.
aliases: [Tavernus]
tags: [portada]
---
![[portada.jpg]]
*Brezal al anochecer.*

Conoce a [[Brenna]] y mira el [[Brezal#Mapa|Mapa de Brezal]]. Lo decidido está en [[Decisiones]].

| Sección | Qué hay |
|---|---|
| [[El mundo]] | [[Brezal]] y la [[Taberna del Jabalí]] |
`);
  await w('El mundo/index.md', `---
title: El mundo
aliases: ["El mundo"]
---
El valle. Ver [[Brezal]].
`);
  await w('El mundo/Brezal/index.md', `---
title: Brezal
aliases: [Brezal, Lugares]
description: "La aldea."
---
## Cómo es
Pequeña. Ver [[#Mapa]].

## Mapa
![[portada.jpg|300]]

![Plano](../../Imágenes/portada.jpg) y una de fuera: ![Fuera](https://example.org/x.png)
`);
  await w('El mundo/Brezal/Taberna del Jabalí.md', `---
title: Taberna del Jabalí
---
La taberna de [[Brenna]].
`);
  await w('Personajes/index.md', `---
title: Personajes
aliases: ["Personajes"]
---
- [[Brenna]]
`);
  await w('Personajes/Brenna.md', `---
title: Brenna
description: "La tabernera."
tags: [personaje]
---
> [!ficha] Brenna
> ![[retrato-brenna.jpg\\|120]]
>
> | | |
> |---|---|
> | Rol | Tabernera |
> | Dónde | [[Taberna del Jabalí]], en la barra |

## Quién es
Cincuenta años. Una etiqueta <parameter> suelta y un salto<br>a mano.

> [!warning]- Spoiler: su pasado
> La jarra era de su hermano: secreto-xyz.

> [!abstract] En corto
> Habla poco.
`);
  await w('Desarrollo/Decisiones.md', '# Privado\nNo se publica: nota-privada-abc.\n');
  await mkdir(join(dir, 'Imágenes'), { recursive: true });
  await writeFile(join(dir, 'Imágenes', 'portada.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeFile(join(dir, 'Imágenes', 'retrato-brenna.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
}

describe('wiki: nombres y cabeceras', () => {
  it('direcciones sin acentos ni espacios; el índice de cada carpeta es la carpeta', () => {
    expect(slug('Taberna del Jabalí')).toBe('taberna-del-jabali');
    expect(slug('Acto I · Lo que trae el agua')).toBe('acto-i-lo-que-trae-el-agua');
    expect(placeOf('El mundo/Brezal/Taberna del Jabalí.md')).toMatchObject({ url: '/wiki/el-mundo/brezal/taberna-del-jabali', out: 'el-mundo/brezal/taberna-del-jabali.html', isIndex: false });
    expect(placeOf('El mundo/Brezal/index.md')).toMatchObject({ url: '/wiki/el-mundo/brezal/', out: 'el-mundo/brezal/index.html', isIndex: true });
    expect(placeOf('index.md')).toMatchObject({ url: '/wiki/', out: 'index.html' });
  });

  it('lee título, descripción, alias y etiquetas del YAML, con comillas o sin ellas', () => {
    const { meta, body } = frontmatter(`---\ntitle: "Misiones"\ndescription: 'Los actos'\naliases: [Misiones, "Los actos"]\ntags: [mision, brezal]\nrol: tabernera\n---\nCuerpo.`);
    expect(meta).toEqual({ title: 'Misiones', description: 'Los actos', aliases: ['Misiones', 'Los actos'], tags: ['mision', 'brezal'], npc: null });
    expect(body).toBe('Cuerpo.');
    expect(frontmatter('Sin cabecera.').meta.title).toBeNull();
  });

  it('el texto para buscar no lleva marcas, enlaces ni imágenes', () => {
    expect(plainText('## Quién es\n![[x.jpg]] **Cincuenta** años en la [[Taberna del Jabalí|taberna]] y [[Vharn]].\n| a | b |\n|---|---|')).toBe('Quién es Cincuenta años en la taberna y Vharn. a b');
  });
});

describe('wiki: construcción', () => {
  let src: string; let out: string; let report: BuildReport;
  const page = (file: string) => readFile(join(out, file), 'utf8');

  beforeAll(async () => {
    src = await mkdtemp(join(tmpdir(), 'tavernus-wiki-src-'));
    out = await mkdtemp(join(tmpdir(), 'tavernus-wiki-out-'));
    await vault(src);
    report = await buildWiki(src, out);
  });
  afterAll(async () => { await rm(src, { recursive: true, force: true }); await rm(out, { recursive: true, force: true }); });

  it('construye las páginas de la wiki y deja fuera las notas privadas', async () => {
    expect(report.pages.map((p) => p.url).sort()).toEqual(['/wiki/', '/wiki/el-mundo/', '/wiki/el-mundo/brezal/', '/wiki/el-mundo/brezal/taberna-del-jabali', '/wiki/personajes/', '/wiki/personajes/brenna']);
    expect(report.images).toBe(2);
    expect(existsSync(join(out, 'desarrollo'))).toBe(false);
    for (const f of ['index.html', 'wiki.css', 'wiki.js', 'search.json', 'img/portada.jpg', 'img/retrato-brenna.jpg']) expect(existsSync(join(out, f)), f).toBe(true);
    const all = await Promise.all(report.pages.map((p) => page(p.out)));
    expect(all.join('')).not.toContain('nota-privada-abc');
  });

  it('resuelve enlaces por nombre, alias y sección; lo que no es de la wiki queda como texto', async () => {
    const index = await page('index.html');
    expect(index).toContain('<a href="/wiki/personajes/brenna">Brenna</a>');
    expect(index).toContain('<a href="/wiki/el-mundo/brezal/#mapa">Mapa de Brezal</a>');
    expect(index).toContain('<a href="/wiki/el-mundo/">El mundo</a>');
    expect(index).toContain('<a href="/wiki/el-mundo/brezal/">Brezal</a>');
    expect(index).toContain('<a href="/wiki/el-mundo/brezal/taberna-del-jabali">Taberna del Jabalí</a>');
    expect(index).toContain('<span class="missing">Decisiones</span>');
    expect(index).toContain('<figure><img src="/wiki/img/portada.jpg" alt="portada" loading="lazy"><figcaption>Brezal al anochecer.</figcaption></figure>');
    expect(report.unresolved).toEqual([['index.md', 'Decisiones']]);
    const brezal = await page('el-mundo/brezal/index.html');
    expect(brezal).toContain('<h2 id="mapa">');
    expect(brezal).toContain('<a href="/wiki/el-mundo/brezal/#mapa">Mapa</a>');
    expect(brezal).toContain('<img src="/wiki/img/portada.jpg" alt="portada" loading="lazy" width="300">');
    expect(brezal).toContain('<img src="/wiki/img/portada.jpg" alt="Plano" loading="lazy">');
    expect(brezal).toContain('<img src="https://example.org/x.png" alt="Fuera" loading="lazy">');
  });

  it('fichas, spoilers plegados, HTML suelto como texto y la barra de secciones', async () => {
    const brenna = await page('personajes/brenna.html');
    expect(brenna).toContain('<div class="callout ficha"><p class="callout-title">Brenna</p>');
    expect(brenna).toContain('<img src="/wiki/img/retrato-brenna.jpg" alt="retrato brenna" loading="lazy" width="120">');
    expect(brenna).toContain('<td><a href="/wiki/el-mundo/brezal/taberna-del-jabali">Taberna del Jabalí</a>, en la barra</td>');
    expect(brenna).toMatch(/<details class="callout warning"><summary>Spoiler: su pasado<\/summary>[\s\S]*secreto-xyz/);
    expect(brenna).toContain('<div class="callout abstract"><p class="callout-title">En corto</p>');
    expect(brenna).toContain('&lt;parameter&gt; suelta y un salto<br>a mano');
    expect(brenna).toContain('<a href="/wiki/personajes/" class="on">Personajes</a>');
    expect(brenna).toContain('<p class="crumbs"><a href="/wiki/">Wiki</a><span>›</span><a href="/wiki/personajes/">Personajes</a></p>');
    expect(brenna).toContain('<title>Brenna · Wiki de Tavernus</title>');
    expect(brenna).toMatch(/<link rel="stylesheet" href="\/wiki\/wiki\.css\?v=[0-9a-f]{10}">/);
  });

  it('«Enlazan aquí» sale de los enlaces de las demás páginas', async () => {
    const taberna = await page('el-mundo/brezal/taberna-del-jabali.html');
    // Por orden de título: Brenna antes que Tavernus.
    expect(taberna).toMatch(/Enlazan aquí[\s\S]*<a href="\/wiki\/personajes\/brenna">Brenna<\/a>[\s\S]*<a href="\/wiki\/">Tavernus<\/a>/);
    expect(await page('el-mundo/index.html')).toContain('Enlazan aquí');
  });

  it('el índice del buscador lleva título, sección y texto, pero no lo plegado', async () => {
    const search = JSON.parse(await readFile(join(out, 'search.json'), 'utf8')) as Array<{ t: string; u: string; s: string; d: string | null; x: string }>;
    const brenna = search.find((e) => e.t === 'Brenna')!;
    expect(brenna).toMatchObject({ u: '/wiki/personajes/brenna', s: 'Personajes', d: 'La tabernera.' });
    expect(brenna.x).toContain('Cincuenta años');
    expect(brenna.x).toContain('Spoiler: su pasado');
    expect(brenna.x).not.toContain('secreto-xyz');
    expect(brenna.x).toContain('Habla poco');
    expect(search.find((e) => e.u === '/wiki/')!.s).toBe('Portada');
  });
});

describe('wiki: el servidor la sirve en /wiki/', () => {
  let dir: string; let out: string; let games: GameManager; let web: WebServer; let base: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tavernus-wiki-web-'));
    const src = join(dir, 'src'); out = join(dir, 'out');
    await mkdir(src); await vault(src); await buildWiki(src, out);
    games = new GameManager({ root: join(dir, 'games'), env: { DATA_DIR: join(dir, 'local') }, masterFor: noApi, engine: { deterministic: false }, log: () => {} });
    web = createWebServer(games, { tickMs: 3_600_000, wikiDir: out });
    await new Promise<void>((resolve) => web.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(web.server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { await web.stop(); await games.closeAll(); await rm(dir, { recursive: true, force: true }); });

  const get = (path: string) => fetch(base + path, { redirect: 'manual' });

  it('páginas sin extensión, índices con barra, estilos, buscador e imágenes', async () => {
    const root = await get('/wiki');
    expect(root.status).toBe(301);
    expect(root.headers.get('location')).toBe('/wiki/');
    const index = await get('/wiki/');
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await index.text()).toContain('<h1>Tavernus</h1>');
    expect(await (await get('/wiki/personajes/brenna')).text()).toContain('<h1>Brenna</h1>');
    expect(await (await get('/wiki/personajes/')).text()).toContain('<h1>Personajes</h1>');
    expect((await get('/wiki/wiki.css')).headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect((await get('/wiki/wiki.js')).headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect((await get('/wiki/search.json')).headers.get('content-type')).toBe('application/json; charset=utf-8');
    const img = await get('/wiki/img/portada.jpg');
    expect(img.headers.get('content-type')).toBe('image/jpeg');
    expect(img.headers.get('cache-control')).toContain('max-age');
  });

  it('nada fuera de la carpeta ni de otro tipo; lo que no existe da un 404 con enlace a la portada', async () => {
    // Los «..» los quita el navegador (y el análisis de la URL) antes de llegar a la wiki: acaban fuera de /wiki/ y en el 404 general.
    for (const path of ['/wiki/../package.json', '/wiki/img/../../package.json', '/wiki/img/..%2F..%2Fpackage.json']) expect((await get(path)).status, path).toBe(404);
    for (const path of ['/wiki/nada', '/wiki/personajes/nadie', '/wiki/Personajes/Brenna', '/wiki/x.exe', '/wiki/img/portada.jpg/']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toContain('href="/wiki/"');
    }
  });
});

const REAL = join(process.cwd(), 'wiki');
describe.skipIf(!existsSync(join(REAL, 'index.md')))('wiki: la de verdad', () => {
  it('se construye entera y todas sus imágenes existen', async () => {
    const out = await mkdtemp(join(tmpdir(), 'tavernus-wiki-real-'));
    try {
      const report = await buildWiki(REAL, out);
      expect(report.pages.length).toBeGreaterThan(50);
      expect(report.pages.some((p) => p.url === '/wiki/')).toBe(true);
      const images = report.unresolved.filter(([, t]) => /\.(jpe?g|png|svg|webp|gif)$/i.test(t));
      expect(images, 'imágenes que no están en wiki/Imágenes').toEqual([]);
      const unresolved = [...new Set(report.unresolved.map(([, t]) => t))];
      // Lo que no es de la wiki (notas de Desarrollo) se queda como texto; que no se cuele una página mal escrita.
      for (const t of unresolved) expect(report.pages.some((p) => slug(p.title) === slug(t)), `«${t}» parece una página de la wiki mal enlazada`).toBe(false);
    } finally { await rm(out, { recursive: true, force: true }); }
  });
});
