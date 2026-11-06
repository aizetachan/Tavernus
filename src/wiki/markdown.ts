/**
 * Markdown de Obsidian a HTML, para la wiki (docs/WIKI.md). Entiende lo que usan las páginas de wiki/:
 * cabecera YAML (título, descripción, alias, etiquetas), enlaces [[Página]], [[Página#Sección|texto]] y
 * [[#Sección]], imágenes ![[foto.jpg|300]], callouts «> [!tipo] Título» (plegados con «-», abiertos
 * con «+»), tablas, listas y lo demás de Markdown corriente (marked). Lo que no es una página de la
 * wiki (las notas de Desarrollo, por ejemplo) se queda como texto, sin enlace roto.
 */
import { Marked, type Renderer, type Tokens } from 'marked';

export interface Frontmatter {
  title: string | null;
  description: string | null;
  aliases: string[];
  tags: string[];
  /** Id del NPC de la ficha («npc_hugo»): su sección «Lleva encima» sale de los datos del juego (carries.ts). */
  npc: string | null;
}

export interface PageRef {
  /** Dirección pública, con /wiki/ delante. */
  url: string;
  title: string;
}

export interface RenderContext {
  /** Página con ese nombre o alias (sin distinguir mayúsculas ni acentos), o null si no es de la wiki. */
  resolve(name: string): PageRef | null;
  /** Dirección pública de una imagen por su nombre de fichero, o null si no existe. */
  image(name: string): string | null;
  /** La propia página, para [[#Sección]]. */
  self: PageRef;
}

export interface Rendered {
  html: string;
  /** Texto llano para el buscador, sin los bloques plegados (los spoilers no se buscan). */
  text: string;
  /** Páginas enlazadas desde esta (direcciones), para «Enlazan aquí». */
  links: string[];
  /** Enlaces [[…]] que no apuntan a ninguna página de la wiki. */
  unresolved: string[];
}

const IMAGE_EXT = /\.(jpe?g|png|gif|svg|webp)$/i;

/** Sin acentos ni mayúsculas, para comparar nombres como hace Obsidian (que ignora mayúsculas). */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Trozo de dirección: «Taberna del Jabalí» → «taberna-del-jabali». */
export function slug(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pagina';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Separa la cabecera YAML (solo las claves que usa la wiki) del cuerpo. */
export function frontmatter(source: string): { meta: Frontmatter; body: string } {
  const meta: Frontmatter = { title: null, description: null, aliases: [], tags: [], npc: null };
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!m) return { meta, body: source };
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!; const raw = kv[2]!.trim();
    if (key === 'title') meta.title = yamlString(raw);
    else if (key === 'description') meta.description = yamlString(raw);
    else if (key === 'aliases') meta.aliases = yamlList(raw);
    else if (key === 'tags') meta.tags = yamlList(raw);
    else if (key === 'npc') meta.npc = yamlString(raw);
  }
  return { meta, body: source.slice(m[0].length) };
}

function yamlString(raw: string): string | null {
  if (!raw) return null;
  const q = /^"((?:[^"\\]|\\.)*)"$/.exec(raw) ?? /^'([^']*)'$/.exec(raw);
  return q ? q[1]!.replace(/\\(.)/g, '$1') : raw;
}

function yamlList(raw: string): string[] {
  const inner = /^\[(.*)\]$/.exec(raw)?.[1];
  if (inner === undefined) return raw ? [yamlString(raw)!] : [];
  return inner.split(',').map((s) => yamlString(s.trim())).filter((s): s is string => !!s);
}

/** Título por tipo de callout cuando no trae ninguno. */
const CALLOUT_TITLES: Record<string, string> = {
  note: 'Nota', abstract: 'Resumen', summary: 'Resumen', tldr: 'En corto', info: 'Información', todo: 'Pendiente',
  tip: 'Consejo', hint: 'Consejo', success: 'Hecho', check: 'Hecho', question: 'Pregunta', help: 'Pregunta', faq: 'Pregunta',
  warning: 'Aviso', caution: 'Aviso', attention: 'Aviso', failure: 'Fallo', fail: 'Fallo', missing: 'Falta',
  danger: 'Peligro', error: 'Error', bug: 'Fallo', example: 'Ejemplo', quote: 'Cita', cite: 'Cita', ficha: 'Ficha',
};

/** Etiquetas HTML que las páginas usan a mano; cualquier otra «<» se enseña como texto. */
const ALLOWED_TAGS = /^<\/?(br|small|sup|sub|b|i|em|strong|u|kbd)\b[^<>]*>/;

type Block = { kind: 'md'; text: string } | { kind: 'callout'; type: string; fold: '' | '-' | '+'; title: string; inner: string };
type Blocks = Array<Block>;

/** Parte el cuerpo en trozos de Markdown y callouts (bloques «> [!tipo]»). */
function splitCallouts(body: string): Blocks {
  const out: Blocks = [];
  const lines = body.split(/\r?\n/);
  let md: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^>\s?\[!([A-Za-z]+)\]([-+]?)\s?(.*)$/.exec(lines[i]!);
    if (!head) { md.push(lines[i]!); continue; }
    const inner: string[] = [];
    let j = i + 1;
    for (; j < lines.length && /^>/.test(lines[j]!); j++) inner.push(lines[j]!.replace(/^>\s?/, ''));
    if (md.length) { out.push({ kind: 'md', text: md.join('\n') }); md = []; }
    out.push({ kind: 'callout', type: head[1]!.toLowerCase(), fold: head[2] as '' | '-' | '+', title: head[3]!.trim(), inner: inner.join('\n') });
    i = j - 1;
  }
  if (md.length) out.push({ kind: 'md', text: md.join('\n') });
  return out;
}

export function render(body: string, ctx: RenderContext): Rendered {
  const links = new Set<string>();
  const unresolved: string[] = [];
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      heading(this: Renderer, { tokens, depth }: Tokens.Heading): string {
        const inner = this.parser.parseInline(tokens);
        const id = slug(inner.replace(/<[^>]+>/g, ''));
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}">${inner}</a></h${depth}>\n`;
      },
      // Imagen en Markdown corriente con ruta relativa (![Mapa](../../Imágenes/mapa.svg)): por su nombre, como las de Obsidian.
      image({ href, title, text }: Tokens.Image): string {
        let src = href;
        if (!/^(?:[a-z]+:)?\/\//i.test(href) && !href.startsWith('/')) {
          const local = ctx.image(decodeURIComponent(href.split('/').pop() ?? ''));
          if (local) src = local; else unresolved.push(href);
        }
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}" loading="lazy"${title ? ` title="${escapeHtml(title)}"` : ''}>`;
      },
    },
  });

  /** Enlaces e imágenes de Obsidian a HTML en línea, y «<» sueltas a texto. */
  function inline(text: string): string {
    let s = text.replace(/</g, (m, offset: number, whole: string) => (ALLOWED_TAGS.test(whole.slice(offset)) ? m : '&lt;'));
    s = s.replace(/!\[\[([^\]|]+?)(?:\\?\|([^\]]*))?\]\]/g, (_m, name: string, size?: string) => {
      const file = name.trim();
      if (!IMAGE_EXT.test(file)) return wikilink(file, '', size ?? '');
      const src = ctx.image(file);
      if (!src) { unresolved.push(file); return `<span class="missing">[${escapeHtml(file)}]</span>`; }
      const width = /^\d+$/.test(size ?? '') ? ` width="${size}"` : '';
      return `<img src="${src}" alt="${escapeHtml(file.replace(IMAGE_EXT, '').replace(/[-_]+/g, ' '))}" loading="lazy"${width}>`;
    });
    s = s.replace(/\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\\?\|([^\]]*))?\]\]/g, (_m, target: string, heading?: string, alias?: string) =>
      wikilink(target.trim(), (heading ?? '').trim(), (alias ?? '').trim()));
    // Una imagen sola y, debajo, una línea en cursiva: pie de foto. (Sin esto, Markdown toma la cursiva como parte del bloque HTML de la imagen.)
    s = s.replace(/^(<img [^\n]*>)\n[*_]([^*_\n]+)[*_]$/gm, '<figure>$1<figcaption>$2</figcaption></figure>');
    return s;
  }

  function wikilink(target: string, heading: string, alias: string): string {
    const page = target ? ctx.resolve(target) : ctx.self;
    const label = alias || (target ? (heading ? `${target} › ${heading}` : target) : heading);
    if (!page) { unresolved.push(target); return `<span class="missing">${escapeHtml(label)}</span>`; }
    if (page.url !== ctx.self.url) links.add(page.url);
    const href = page.url + (heading ? `#${slug(heading)}` : '');
    return `<a href="${href}">${escapeHtml(label)}</a>`;
  }

  const md = (text: string): string => marked.parse(inline(text), { async: false }) as string;

  const parts: string[] = [];
  const plain: string[] = [];
  for (const block of splitCallouts(body)) {
    if (block.kind === 'md') { parts.push(md(block.text)); plain.push(block.text); continue; }
    const title = block.title || CALLOUT_TITLES[block.type] || block.type;
    const body = md(block.inner).replace(/\n{2,}/g, '\n');
    const cls = `callout ${block.type}`;
    if (block.fold) {
      parts.push(`<details class="${cls}"${block.fold === '+' ? ' open' : ''}><summary>${inline(title)}</summary>\n<div class="callout-body">\n${body}</div></details>\n`);
      if (block.fold === '+') plain.push(block.title, block.inner);
      else plain.push(block.title); // lo plegado se busca por su título, no por lo que esconde
    } else {
      parts.push(`<div class="${cls}"><p class="callout-title">${inline(title)}</p>\n<div class="callout-body">\n${body}</div></div>\n`);
      plain.push(block.title, block.inner);
    }
  }
  return { html: parts.join('\n'), text: plainText(plain.join('\n')), links: [...links], unresolved };
}

/** Texto para el buscador: sin enlaces, imágenes, marcas de Markdown ni etiquetas. */
export function plainText(md: string): string {
  return md
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[\[([^\]|#]*)(?:#([^\]|]*))?(?:\\?\|([^\]]*))?\]\]/g, (_m, t: string, h?: string, a?: string) => a || t || h || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+|^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|?[-:| ]+\|?\s*$/gm, '')
    .replace(/[|`*_>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
