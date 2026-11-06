/**
 * Construye la wiki: lee wiki/ (páginas Markdown de Obsidian e imágenes) y deja en dist/wiki/ las páginas
 * HTML, la hoja de estilos, el buscador y search.json. El servidor sirve esa carpeta en /wiki/ (docs/WIKI.md).
 *
 *   node dist/wiki/build.js [origen] [destino]      por defecto wiki/ y dist/wiki/
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { carriesOf, replaceSection, type CarriesFn } from './carries.js';
import { fold, frontmatter, render, slug, type PageRef } from './markdown.js';
import { CSS, JS, layout } from './theme.js';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp']);
/** Carpetas del vault que no son wiki (notas personales) ni aunque alguien las copie dentro. */
const SKIP_DIRS = new Set(['desarrollo', 'plantillas']);
/** Orden de la barra; el resto de carpetas, después y por nombre. */
const SECTION_ORDER = ['El mundo', 'Personajes', 'Misiones', 'Diseño de juego'];

export interface WikiPage extends PageRef {
  /** Ruta dentro de wiki/, con «/». */
  file: string;
  name: string;
  /** Carpetas desde la raíz, con su nombre original. */
  dirs: string[];
  isIndex: boolean;
  description: string | null;
  aliases: string[];
  tags: string[];
  body: string;
  /** Fichero de salida, relativo al destino. */
  out: string;
}

export interface BuildReport {
  pages: WikiPage[];
  images: number;
  /** Enlaces [[…]] sin página: [página, destino]. */
  unresolved: Array<[string, string]>;
}

export interface SearchEntry { t: string; u: string; s: string; d: string | null; a: string[]; x: string }

async function walk(dir: string, root: string, out: string[] = []): Promise<string[]> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(fold(e.name))) await walk(p, root, out); }
    else out.push(relative(root, p).split(sep).join('/'));
  }
  return out;
}

/** Dirección pública y fichero de salida de una página por su ruta en wiki/. */
export function placeOf(file: string): { url: string; out: string; dirs: string[]; name: string; isIndex: boolean } {
  const parts = file.split('/');
  const name = basename(parts.pop()!, '.md');
  const dirSlugs = parts.map(slug);
  const isIndex = fold(name) === 'index';
  const base = dirSlugs.length ? `/wiki/${dirSlugs.join('/')}/` : '/wiki/';
  if (isIndex) return { url: base, out: [...dirSlugs, 'index.html'].join('/'), dirs: parts, name, isIndex };
  return { url: base + slug(name), out: [...dirSlugs, `${slug(name)}.html`].join('/'), dirs: parts, name, isIndex };
}

export interface BuildOptions {
  /**
   * Lo que lleva encima cada NPC, en Markdown, por su id: rellena la sección «Lleva encima» de las fichas con `npc:`
   * en sus propiedades. Por defecto, la campaña de Brezal (carries.ts).
   */
  carries?: CarriesFn;
}

export async function buildWiki(src: string, out: string, opts: BuildOptions = {}): Promise<BuildReport> {
  const carries = opts.carries ?? carriesOf();
  const files = await walk(src, src);
  const pages: WikiPage[] = [];
  const images = new Map<string, { from: string; url: string; out: string }>();
  const byUrl = new Map<string, WikiPage>();

  for (const file of files.sort()) {
    const ext = extname(file).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      const stem = basename(file, extname(file));
      const name = `${slug(stem)}${ext === '.jpeg' ? '.jpg' : ext}`;
      images.set(fold(basename(file)), { from: join(src, file), url: `/wiki/img/${name}`, out: `img/${name}` });
      continue;
    }
    if (ext !== '.md') continue;
    const { meta, body: raw } = frontmatter(await readFile(join(src, file), 'utf8'));
    // La ficha de un NPC: lo que lleva encima no se escribe a mano, sale de los datos del juego.
    const carried = meta.npc ? carries(meta.npc) : null;
    if (meta.npc && carried === null) throw new Error(`${file}: el NPC ${meta.npc} no existe en los datos del juego.`);
    const body = carried === null ? raw : replaceSection(raw, 'Lleva encima', carried);
    const place = placeOf(file);
    const title = meta.title ?? (place.isIndex ? place.dirs.at(-1) ?? 'Tavernus' : place.name);
    const page: WikiPage = { ...place, file, title, description: meta.description, aliases: meta.aliases, tags: meta.tags, body };
    const dup = byUrl.get(page.url);
    if (dup) throw new Error(`Dos páginas con la misma dirección ${page.url}: ${dup.file} y ${file}`);
    byUrl.set(page.url, page);
    pages.push(page);
  }

  // Nombres por los que se enlaza: el fichero manda; después los alias y, para los índices, su carpeta.
  const names = new Map<string, WikiPage>();
  const claim = (key: string, page: WikiPage) => { const k = fold(key); if (k && !names.has(k)) names.set(k, page); };
  for (const p of pages) if (!p.isIndex) claim(p.name, p);
  for (const p of pages) if (p.isIndex && p.dirs.length) claim(p.dirs.at(-1)!, p);
  for (const p of pages) for (const a of p.aliases) claim(a, p);
  for (const p of pages) claim(p.title, p);

  const sections = sectionsOf(pages);
  const sectionTitle = (p: WikiPage): string => {
    if (!p.dirs.length) return 'Portada';
    const idx = byUrl.get(`/wiki/${slug(p.dirs[0]!)}/`);
    return idx?.title ?? p.dirs[0]!;
  };

  const rendered = new Map<string, ReturnType<typeof render>>();
  const backlinks = new Map<string, Set<string>>();
  const unresolved: Array<[string, string]> = [];
  for (const p of pages) {
    const r = render(p.body, {
      resolve: (name) => names.get(fold(name)) ?? null,
      image: (name) => images.get(fold(name))?.url ?? null,
      self: p,
    });
    rendered.set(p.url, r);
    for (const to of r.links) { if (!backlinks.has(to)) backlinks.set(to, new Set()); backlinks.get(to)!.add(p.url); }
    for (const u of r.unresolved) unresolved.push([p.file, u]);
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, 'img'), { recursive: true });
  const version = createHash('sha1').update(CSS).update(JS).digest('hex').slice(0, 10);
  const search: SearchEntry[] = [];
  for (const p of pages) {
    const r = rendered.get(p.url)!;
    const crumbs: Array<{ title: string; url: string }> = [];
    if (p.dirs.length || !p.isIndex) crumbs.push({ title: 'Wiki', url: '/wiki/' });
    for (let i = 1; i <= p.dirs.length; i++) {
      const url = `/wiki/${p.dirs.slice(0, i).map(slug).join('/')}/`;
      const idx = byUrl.get(url);
      if (idx && idx.url !== p.url) crumbs.push({ title: idx.title, url });
    }
    const headings = [...r.html.matchAll(/<h2 id="([^"]+)"><a[^>]*>([\s\S]*?)<\/a><\/h2>/g)].map((m) => ({ id: m[1]!, text: m[2]!.replace(/<[^>]+>/g, '') }));
    const links = [...(backlinks.get(p.url) ?? [])].map((u) => byUrl.get(u)!).sort((a, b) => a.title.localeCompare(b.title, 'es'));
    const html = layout({
      title: p.title,
      description: p.description,
      crumbs,
      sections: sections.map((s) => ({ title: s.title, url: s.url, active: p.dirs[0] !== undefined && slug(p.dirs[0]) === s.dir })),
      headings,
      backlinks: links.map((b) => ({ title: b.title, url: b.url })),
      html: r.html,
      version,
    });
    await mkdir(join(out, dirname(p.out)), { recursive: true });
    await writeFile(join(out, p.out), html, 'utf8');
    search.push({ t: p.title, u: p.url, s: sectionTitle(p), d: p.description, a: p.aliases.filter((a) => fold(a) !== fold(p.title)), x: r.text.slice(0, 6000) });
  }
  await writeFile(join(out, 'wiki.css'), CSS, 'utf8');
  await writeFile(join(out, 'wiki.js'), JS, 'utf8');
  await writeFile(join(out, 'search.json'), JSON.stringify(search), 'utf8');
  for (const img of images.values()) await copyFile(img.from, join(out, img.out));
  return { pages, images: images.size, unresolved };
}

/** Las secciones de la barra: las carpetas de primer nivel que tienen índice. */
function sectionsOf(pages: WikiPage[]): Array<{ title: string; url: string; dir: string }> {
  const tops = pages.filter((p) => p.isIndex && p.dirs.length === 1);
  const rank = (p: WikiPage) => { const i = SECTION_ORDER.findIndex((s) => fold(s) === fold(p.dirs[0]!)); return i < 0 ? SECTION_ORDER.length : i; };
  tops.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'es'));
  return tops.map((p) => ({ title: p.title, url: p.url, dir: slug(p.dirs[0]!) }));
}

async function main(): Promise<void> {
  const src = resolve(process.argv[2] ?? 'wiki');
  const out = resolve(process.argv[3] ?? join('dist', 'wiki'));
  let report: BuildReport;
  try {
    report = await buildWiki(src, out);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') { console.error(`[wiki] no hay carpeta ${src}: la wiki va en wiki/ (docs/WIKI.md)`); process.exit(1); }
    throw e;
  }
  console.log(`[wiki] ${report.pages.length} páginas y ${report.images} imágenes en ${out}`);
  if (report.unresolved.length) {
    const byTarget = new Map<string, string[]>();
    for (const [page, target] of report.unresolved) { if (!byTarget.has(target)) byTarget.set(target, []); byTarget.get(target)!.push(page); }
    console.log(`[wiki] ${byTarget.size} enlaces sin página (se enseñan como texto): ${[...byTarget.keys()].sort().join(', ')}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
