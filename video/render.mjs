// Renderiza una página de video/ a MP4, fotograma a fotograma.
//   node video/render.mjs video/cuento.html out.mp4 [--fps 30] [--from 0] [--to <dur>] [--workers 4]
//   node video/render.mjs video/cuento.html --stills 5,31,60 --out-dir /tmp/stills
// La pista de audio se añade aparte (video/mix.sh).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const page = resolve(args[0]);
const url = pathToFileURL(page).href + '?render';
const fps = Number(opt('fps', 30));
const workers = Number(opt('workers', 4));
const stills = opt('stills');

async function open(browser) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.error('[page]', m.text()); });
  p.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await p.goto(url);
  await p.evaluate(() => E.ready());
  return p;
}

const browser = await chromium.launch({ args: ['--allow-file-access-from-files', '--disable-web-security'] });

if (stills) {
  const dir = resolve(opt('out-dir', 'stills'));
  mkdirSync(dir, { recursive: true });
  const p = await open(browser);
  for (const t of stills.split(',').map(Number)) {
    await p.evaluate((t) => E.seek(t), t);
    await p.screenshot({ path: join(dir, `t${String(t).padStart(6, '0')}.jpg`), type: 'jpeg', quality: 85 });
  }
  console.log('stills en', dir);
  await browser.close();
  process.exit(0);
}

const out = resolve(args[1]);
const probe = await open(browser);
const dur = Number(opt('to', await probe.evaluate(() => E.duration)));
await probe.close();
const from = Number(opt('from', 0));
const total = Math.round((dur - from) * fps);
const tmp = join(dirname(out), '.segments-' + Date.now());
mkdirSync(tmp, { recursive: true });
const per = Math.ceil(total / workers);
const t0 = Date.now();
let done = 0;

async function segment(w) {
  const a = w * per, b = Math.min(total, a + per);
  if (a >= b) return null;
  const file = join(tmp, `seg${w}.mp4`);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(fps), file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const p = await open(browser);
  for (let f = a; f < b; f++) {
    await p.evaluate((t) => E.seek(t), from + f / fps);
    const buf = await p.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    done++;
    if (done % 150 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`${done}/${total} fotogramas · ${el.toFixed(0)} s · faltan ~${((total - done) * el / done).toFixed(0)} s`);
    }
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg ' + c)))));
  await p.close();
  return file;
}

const files = (await Promise.all(Array.from({ length: workers }, (_, w) => segment(w)))).filter(Boolean);
await browser.close();
writeFileSync(join(tmp, 'list.txt'), files.map((f) => `file '${f}'`).join('\n'));
await new Promise((r, j) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'), '-c', 'copy', out], { stdio: 'inherit' })
  .on('close', (c) => (c === 0 ? r() : j(new Error('concat ' + c)))));
rmSync(tmp, { recursive: true, force: true });
console.log(`listo: ${out} (${total} fotogramas en ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
