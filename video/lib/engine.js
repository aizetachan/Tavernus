// Motor de motion graphics determinista: todo lo que se ve es función pura de t (segundos).
// La página expone window.E.seek(t); el render (video/render.mjs) la llama fotograma a fotograma
// y hace una captura. Abierta en un navegador normal, se reproduce sola (útil para revisar).
(() => {
  const W = 1920, H = 1080;
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, p) => a + (b - a) * p;
  const ease = {
    lin: (p) => p,
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    sine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
    out: (p) => 1 - Math.pow(1 - p, 3),
    outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    outBack: (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); },
    in: (p) => p * p * p,
  };
  // Envolvente de opacidad: entra en fi segundos, sale en fo.
  const env = (lt, d, fi = 0.8, fo = 0.8) =>
    Math.min(fi > 0 ? clamp(lt / fi) : 1, fo > 0 ? clamp((d - lt) / fo) : 1);
  // Interpolación por fotogramas clave [[t, v], ...]
  const kf = (keys) => (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
        return lerp(v0, v1, ease.sine((t - t0) / (t1 - t0)));
      }
    }
    return keys[keys.length - 1][1];
  };
  // PRNG con semilla
  const rnd = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  const stage = document.getElementById('stage');
  const clips = [];
  const imgs = [];
  const el = (tag, cls, parent = stage, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    parent.appendChild(e);
    return e;
  };
  const img = (src, cls, parent) => {
    const i = el('img', cls, parent);
    i.src = src;
    imgs.push(i);
    return i;
  };
  const add = (c) => { c.el.style.display = 'none'; clips.push(c); return c; };

  // Fondo a pantalla completa con Ken Burns. o: {z:[a,b], x:[a,b], y:[a,b], fi, fo, filter, z-index}
  function bg(src, t, d, o = {}) {
    const wrap = el('div', 'clip bg');
    if (o.zi != null) wrap.style.zIndex = o.zi;
    const i = img(src, 'cover', wrap);
    const z = o.z || [1.05, 1.18], x = o.x || [0, 0], y = o.y || [0, 0];
    if (o.filter) i.style.filter = o.filter;
    if (o.pos) i.style.objectPosition = o.pos;
    return add({ t, d, el: wrap, update(lt) {
      const p = ease.sine(clamp(lt / d));
      wrap.style.opacity = env(lt, d, o.fi ?? 1.2, o.fo ?? 1.2);
      i.style.transform = `translate(${lerp(x[0], x[1], p)}px, ${lerp(y[0], y[1], p)}px) scale(${lerp(z[0], z[1], p)})`;
      if (o.onUpdate) o.onUpdate(lt, p, wrap, i);
    } });
  }

  // Imagen cuadrada en un marco, sobre su propia versión desenfocada a pantalla completa.
  function framed(src, t, d, o = {}) {
    const wrap = el('div', 'clip bg');
    const b = img(src, 'cover blurfill', wrap);
    const box = el('div', 'framebox ' + (o.cls || ''), wrap);
    const i = img(src, 'framed', box);
    const side = o.side || 'right';
    const size = o.size || 860;
    box.style.width = box.style.height = size + 'px';
    box.style.top = (H - size) / 2 + 'px';
    if (side === 'right') box.style.right = (o.margin ?? 140) + 'px';
    else if (side === 'left') box.style.left = (o.margin ?? 140) + 'px';
    else box.style.left = (W - size) / 2 + 'px';
    const z = o.z || [1.0, 1.1];
    return add({ t, d, el: wrap, update(lt) {
      const p = ease.sine(clamp(lt / d));
      wrap.style.opacity = env(lt, d, o.fi ?? 1.2, o.fo ?? 1.2);
      b.style.transform = `scale(${lerp(1.25, 1.35, p)})`;
      i.style.transform = `scale(${lerp(z[0], z[1], p)})`;
      const pin = ease.out(clamp(lt / 1.6));
      box.style.transform = `translateY(${lerp(40, 0, pin)}px)`;
    } });
  }

  // Texto. anim: 'words' (palabra a palabra), 'fade', 'rise', 'type', 'scale', 'track'
  // o: {x, y, w, align, cls, fi, fo, stagger, wordDur}
  function txt(html, t, d, o = {}) {
    const e = el('div', 'clip txt ' + (o.cls || ''));
    e.style.left = (o.x ?? 160) + 'px';
    e.style.top = (o.y ?? 780) + 'px';
    if (o.w) e.style.width = o.w + 'px';
    if (o.align) e.style.textAlign = o.align;
    if (o.align === 'center' && o.x == null) { e.style.left = '0px'; e.style.width = W + 'px'; }
    if (o.anchor === 'bottom') { e.style.top = 'auto'; e.style.bottom = (H - (o.y ?? 900)) + 'px'; }
    if (o.anchor === 'middle') e.style.transform = 'translateY(-50%)';
    const anim = o.anim || 'words';
    let words = [];
    if (anim === 'words' || anim === 'type') {
      // Divide en palabras conservando etiquetas simples (<b>, <em>, <br>, <span class>)
      const tmp = document.createElement('div');
      tmp.innerHTML = html;
      const walk = (node, into) => {
        for (const n of [...node.childNodes]) {
          if (n.nodeType === 3) {
            const parts = n.textContent.split(/(\s+)/);
            for (const part of parts) {
              if (!part) continue;
              if (/^\s+$/.test(part)) into.appendChild(document.createTextNode(' '));
              else if (anim === 'type') {
                for (const ch of part) { const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch; into.appendChild(s); words.push(s); }
              } else { const s = document.createElement('span'); s.className = 'w'; s.textContent = part; into.appendChild(s); words.push(s); }
            }
          } else if (n.nodeName === 'BR') into.appendChild(document.createElement('br'));
          else { const c = n.cloneNode(false); into.appendChild(c); walk(n, c); }
        }
      };
      walk(tmp, e);
    } else e.innerHTML = html;
    const stagger = o.stagger ?? (anim === 'type' ? 0.035 : 0.11);
    const wd = o.wordDur ?? 0.7;
    const baseT = e.style.transform || '';
    return add({ t, d, el: e, update(lt) {
      const out = o.fo === 0 ? 1 : clamp((d - lt) / (o.fo ?? 0.7));
      if (anim === 'words') {
        words.forEach((w, k) => {
          const p = clamp((lt - (o.delay || 0) - k * stagger) / wd);
          const q = ease.out(p);
          w.style.opacity = q;
          w.style.transform = `translateY(${(1 - q) * 18}px)`;
          w.style.filter = p < 1 ? `blur(${(1 - q) * 8}px)` : 'none';
        });
        e.style.opacity = out;
        e.style.filter = out < 1 ? `blur(${(1 - out) * 10}px)` : 'none';
      } else if (anim === 'type') {
        words.forEach((w, k) => { w.style.opacity = lt - (o.delay || 0) >= k * stagger ? 1 : 0; });
        e.style.opacity = out;
      } else {
        const p = ease.out(clamp((lt - (o.delay || 0)) / (o.fi ?? 1)));
        e.style.opacity = Math.min(p, out);
        let tr = baseT;
        if (anim === 'rise') tr += ` translateY(${(1 - p) * 40}px)`;
        if (anim === 'scale') tr += ` scale(${lerp(o.s0 ?? 1.15, 1, p) * lerp(1, o.s1 ?? 1.03, clamp(lt / d))})`;
        if (anim === 'track') e.style.letterSpacing = lerp(o.ls0 ?? 0.6, o.ls1 ?? 0.12, ease.outExpo(clamp(lt / (o.trackDur ?? 3)))) + 'em';
        e.style.transform = tr;
        e.style.filter = p < 1 || out < 1 ? `blur(${(1 - Math.min(p, out)) * 10}px)` : 'none';
      }
      if (o.onUpdate) o.onUpdate(lt, e);
    } });
  }

  // Clip libre: build(el) crea el DOM; update(lt, el) lo anima.
  function custom(t, d, build, update, cls = '') {
    const e = el('div', 'clip ' + cls);
    const ctx = build(e) || {};
    return add({ t, d, el: e, update(lt) { update(lt, e, ctx); } });
  }

  // ---- Capas globales: ascuas, niebla, viñeta, grano, destello ----
  const canvas = el('canvas', 'layer embers');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const R = rnd(42);
  const parts = Array.from({ length: 180 }, () => ({
    x: R() * W, ph: R() * 6.28, sp: 40 + R() * 120, amp: 10 + R() * 50, fr: 0.3 + R() * 1.2,
    r: 1 + R() * 3.2, off: R() * H, life: R(), hue: 18 + R() * 25,
  }));
  const fogA = img('lib/tex/fog.png', 'layer fog');
  const fogB = img('lib/tex/fog.png', 'layer fog');
  el('div', 'layer vignette');
  const lower = el('div', 'layer lower');
  const flash = el('div', 'layer flash');
  const grains = [0, 1, 2, 3].map((k) => img(`lib/tex/grain${k}.png`, 'layer grain'));
  const levels = { ember: () => 0, fog: () => 0, flash: () => 0, flashColor: 'rgb(255,120,40)', grain: 0.07, emberRise: 1, lower: 1 };

  function drawEmbers(t) {
    const L = levels.ember(t);
    g.clearRect(0, 0, W, H);
    if (L <= 0.001) { canvas.style.opacity = 0; return; }
    canvas.style.opacity = 1;
    const n = Math.floor(parts.length * clamp(L, 0, 1));
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < n; k++) {
      const p = parts[k];
      const span = H + 200;
      const y = H + 100 - (((p.off + t * p.sp * levels.emberRise) % span + span) % span);
      const x = p.x + Math.sin(t * p.fr + p.ph) * p.amp + Math.sin(t * 0.21 + p.ph) * 30;
      const flick = 0.55 + 0.45 * Math.sin(t * (3 + p.fr * 4) + p.ph * 3);
      const fadeTop = clamp(y / (H * 0.6));
      const a = clamp(L) * flick * fadeTop;
      const rad = p.r * 4;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      grd.addColorStop(0, `hsla(${p.hue + 15},100%,75%,${a})`);
      grd.addColorStop(0.3, `hsla(${p.hue},100%,55%,${a * 0.6})`);
      grd.addColorStop(1, `hsla(${p.hue},100%,40%,0)`);
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, rad, 0, 6.283); g.fill();
    }
  }

  let duration = 10;
  function seek(t) {
    for (const c of clips) {
      const lt = t - c.t;
      if (lt >= 0 && lt <= c.d) { c.el.style.display = ''; c.update(lt); }
      else c.el.style.display = 'none';
    }
    drawEmbers(t);
    const F = levels.fog(t);
    fogA.style.opacity = F * 0.9; fogB.style.opacity = F * 0.6;
    fogA.style.transform = `translateX(${-((t * 28) % 2048)}px)`;
    fogB.style.transform = `translateX(${-(((t * 46) + 700) % 2048)}px) translateY(120px) scaleY(1.2)`;
    lower.style.opacity = levels.lower;
    flash.style.opacity = levels.flash(t);
    flash.style.background = `radial-gradient(ellipse at 50% 70%, ${levels.flashColor}, transparent 70%)`;
    const gi = Math.floor(t * 24) % 4;
    grains.forEach((gr, k) => { gr.style.opacity = k === gi ? levels.grain : 0; });
  }

  async function ready() {
    await document.fonts.ready;
    await Promise.all(imgs.map((i) => i.decode().catch(() => console.warn('no carga', i.src))));
  }

  // Reproducción en vivo cuando no se está renderizando
  function play() {
    const t0 = performance.now();
    const loop = () => { const t = ((performance.now() - t0) / 1000) % duration; seek(t); requestAnimationFrame(loop); };
    loop();
  }

  window.E = { W, H, clamp, lerp, ease, env, kf, rnd, el, img, add, bg, framed, txt, custom, levels, seek, ready, play,
    set duration(v) { duration = v; }, get duration() { return duration; } };
  window.addEventListener('load', async () => {
    if (!/render/.test(location.search)) { await ready(); play(); }
  });
})();
