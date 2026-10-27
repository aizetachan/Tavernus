/**
 * Sonido de la partida en la web: efectos puntuales (pasos, puerta, moneda,
 * dado…) y un ambiente en bucle por localización, con la Web Audio API.
 *
 *   - Las claves llegan del servidor en cada mensaje (`m.sfx`, de soundmap.ts)
 *     y se tocan en secuencia: pasos, puerta abre, puerta cierra, ambiente nuevo.
 *   - Cada clave se resuelve contra el catálogo: un fichero si existe
 *     (data/games/<slug>/sfx o public/sfx, servido por /api/sfx?key=…) o, si
 *     no, una receta procedural que se sintetiza aquí mismo. Sin coste.
 *   - Silencio y volúmenes se recuerdan en localStorage (con try/catch).
 *   - Nada suena hasta el primer gesto del usuario (requisito de los navegadores
 *     y de iOS): ese gesto crea y reanuda el AudioContext.
 *   - El narrador de voz (tts.ts) comparte el gestor: `TavernusAudio.duck(true)`
 *     baja el ambiente mientras lee; con speechSynthesis se detecta solo.
 *
 * page.ts solo interpola SFX_STYLE en su <style>, SFX_SCRIPT tras su <script>,
 * y llama a `TavernusSfx.character(id)` al cambiar de PJ y a
 * `TavernusSfx.cue(m.sfx)` con cada mensaje en directo.
 *
 * Las recetas viven como fuente JS (RECIPES_JS) para que el navegador y los
 * tests ejecuten exactamente el mismo código. El adaptador de IA (generar y
 * cachear por clave) está en src/ai/sound.ts; aquí, la ruta /api/sfx.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Engine } from '../../engine/engine.js';
import { currentAmbience, SOUND_KEYS } from './soundmap.js';
import { soundProviderFromEnv, SOUND_PROMPTS, type SoundProvider } from '../../ai/sound.js';

// ---------------------------------------------------------------------------
// Recetas procedurales (navegador y tests)
// ---------------------------------------------------------------------------

const RECIPES_JS = String.raw`var SFX_RECIPES = (function () {
  var TAU = Math.PI * 2;
  function rng(seed) { var s = (seed >>> 0) || 1; return function () { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function hash(k) { var h = 2166136261; for (var i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619); return h >>> 0; }
  function buf(sr, sec) { return new Float32Array(Math.max(1, Math.round(sr * sec))); }
  function coef(fc, sr) { return 1 - Math.exp(-TAU * Math.min(fc, sr * 0.45) / sr); }
  function at(sr, t) { return Math.max(0, Math.round(t * sr)); }

  /** Ruido filtrado (paso bajo y alto de un polo) con envolvente: ataque lineal y caída exponencial. */
  function noise(o, sr, r, t0, dur, p) {
    var i0 = at(sr, t0), n = Math.min(o.length - i0, Math.round(dur * sr)), a = coef(p.lp || 12000, sr), h = coef(p.hp || 20, sr);
    var lp = 0, hp = 0, br = 0, att = (p.attack || 0.002) * sr, dec = (p.decay || dur) * sr, g = p.gain || 1, grain = 1, gn = 0;
    for (var i = 0; i < n; i++) {
      var w = r() * 2 - 1;
      if (p.brown) { br = br * 0.985 + w * 0.15; w = br; }
      lp += a * (w - lp); hp += h * (lp - hp);
      if (p.grain && --gn <= 0) { gn = Math.round(sr * 0.003); grain = r() < p.grain ? 1 : 0.15; }
      var env = (i < att ? i / att : Math.exp(-(i - att) / dec)) * (p.grain ? grain : 1);
      if (n - i < 64) env *= (n - i) / 64;
      o[i0 + i] += (lp - hp) * env * g;
    }
  }
  /** Seno con barrido exponencial de f0 a f1. */
  function tone(o, sr, t0, dur, f0, f1, gain, decay, attack) {
    var i0 = at(sr, t0), n = Math.min(o.length - i0, Math.round(dur * sr)), ph = 0, att = (attack || 0.003) * sr, dec = (decay || dur) * sr;
    for (var i = 0; i < n; i++) {
      var f = f0 * Math.pow(f1 / f0, i / n);
      ph += TAU * f / sr;
      var env = (i < att ? i / att : Math.exp(-(i - att) / dec));
      if (n - i < 64) env *= (n - i) / 64;
      o[i0 + i] += Math.sin(ph) * env * gain;
    }
  }
  /** Resonancias amortiguadas (madera, metal, cristal). */
  function modal(o, sr, t0, fs, ds, gs) {
    var i0 = at(sr, t0);
    for (var k = 0; k < fs.length; k++) {
      var n = Math.min(o.length - i0, Math.round(ds[k] * 6 * sr)), w = TAU * fs[k] / sr, d = ds[k] * sr;
      for (var i = 0; i < n; i++) o[i0 + i] += Math.sin(w * i) * Math.exp(-i / d) * gs[k] * (i < 24 ? i / 24 : 1);
    }
  }
  /** Ruido por un paso banda que se mueve de fa a fb y vuelve a fc (silbido de una hoja, ráfaga). */
  function whoosh(o, sr, r, t0, dur, fa, fb, fc, q, gain) {
    var i0 = at(sr, t0), n = Math.min(o.length - i0, Math.round(dur * sr)), x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0 = 0, a1 = 0, a2 = 0, a0 = 1;
    for (var i = 0; i < n; i++) {
      if (i % 32 === 0) {
        var p = i / n, f = p < 0.5 ? fa + (fb - fa) * p * 2 : fb + (fc - fb) * (p - 0.5) * 2, w0 = TAU * f / sr, al = Math.sin(w0) / (2 * q);
        b0 = al; a0 = 1 + al; a1 = -2 * Math.cos(w0); a2 = 1 - al;
      }
      var x = r() * 2 - 1, y = (b0 * x - b0 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      o[i0 + i] += y * Math.sin(Math.PI * i / n) * gain;
    }
  }
  /** Chirrido de bisagra: impulsos de fricción irregulares que excitan la madera. */
  function creak(o, sr, r, t0, dur, f0, f1, gain) {
    var t = t0;
    while (t < t0 + dur) {
      var p = (t - t0) / dur, f = f0 + (f1 - f0) * p + Math.sin(p * 11) * 6, env = Math.pow(Math.sin(Math.PI * p), 0.6) * gain * (0.6 + 0.4 * r());
      modal(o, sr, t, [480 * (1 + (r() - 0.5) * 0.05), 1130 * (1 + (r() - 0.5) * 0.05), 1960], [0.011, 0.007, 0.004], [env, env * 0.6, env * 0.3]);
      t += (1 / f) * (0.75 + 0.5 * r());
    }
  }
  function norm(o, peak) {
    var m = 0;
    for (var i = 0; i < o.length; i++) { var v = Math.abs(o[i]); if (v > m) m = v; }
    if (m > 0) for (var j = 0; j < o.length; j++) o[j] *= peak / m;
    return o;
  }
  /** Bucle sin costura: genera sec + 1 s y funde la cola sobre el principio. */
  function loop(sr, sec, fill) {
    var x = Math.round(sr * 1), n = Math.round(sr * sec), o = new Float32Array(n + x);
    fill(o);
    for (var i = 0; i < x; i++) { var p = i / x; o[i] = o[i] * Math.sqrt(p) + o[n + i] * Math.sqrt(1 - p); }
    return o.subarray(0, n);
  }

  // --- Capas de ambiente ---
  function bed(o, sr, r, p) {
    var a = coef(p.lp, sr), h = coef(p.hp || 20, sr), lp = 0, hp = 0, br = 0, g = p.gain;
    var lf = (p.lfo || []).map(function (l) { return { w: TAU * l[0] / sr, d: l[1], ph: r() * TAU }; });
    for (var i = 0; i < o.length; i++) {
      var w = r() * 2 - 1;
      if (p.brown) { br = br * 0.99 + w * 0.12; w = br * 2.5; }
      lp += a * (w - lp); hp += h * (lp - hp);
      var m = 1;
      for (var k = 0; k < lf.length; k++) m *= 1 - lf[k].d * (0.5 + 0.5 * Math.sin(lf[k].w * i + lf[k].ph));
      o[i] += (lp - hp) * m * g;
    }
  }
  /** Coeficientes de un paso banda (Q = 2) normalizados: [b0, a1, a2]. */
  function bp(f, sr) { var w0 = TAU * f / sr, al = Math.sin(w0) / 4; return [al / (1 + al), -2 * Math.cos(w0) / (1 + al), (1 - al) / (1 + al)]; }
  /** Gente hablando lejos: ruido por dos formantes con sílabas en frases. */
  function murmur(o, sr, r, voices, gain, lpHz) {
    var a = coef(lpHz, sr);
    for (var v = 0; v < voices; v++) {
      var f1 = 350 + r() * 400, f2 = 1000 + r() * 800, x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0, u1 = 0, u2 = 0, lp = 0;
      var on = r() < 0.5, left = Math.round(sr * (0.5 + r() * 2)), syl = 4 + r() * 2.5, ph = r(), vg = gain * (0.5 + r() * 0.6), c = [];
      for (var i = 0; i < o.length; i++) {
        if (i % 256 === 0) { var j = Math.sin(i / sr * 1.7 + v) * 0.15; c = [bp(f1 * (1 + j), sr), bp(f2 * (1 - j), sr)]; }
        if (--left <= 0) { on = !on; left = Math.round(sr * (on ? 0.8 + r() * 2.2 : 0.4 + r() * 1.6)); }
        ph += syl / sr; if (ph >= 1) { ph -= 1; syl = 3.5 + r() * 3; }
        var env = on ? Math.pow(Math.sin(Math.PI * ph), 2) : 0, x = r() * 2 - 1;
        var y = c[0][0] * (x - x2) - c[0][1] * y1 - c[0][2] * y2; x2 = x1; x1 = x; y2 = y1; y1 = y;
        var z = c[1][0] * (x - u2) - c[1][1] * z1 - c[1][2] * z2; u2 = u1; u1 = x; z2 = z1; z1 = z;
        lp += a * ((y + z * 0.5) - lp);
        o[i] += lp * env * vg;
      }
    }
  }
  function events(o, sr, r, perSec, fn) {
    var t = r() / perSec, sec = o.length / sr;
    while (t < sec) { fn(t); t += -Math.log(1 - r() * 0.999) / perSec; }
  }
  function crackles(o, sr, r, perSec, gain) {
    events(o, sr, r, perSec, function (t) { noise(o, sr, r, t, 0.012, { gain: gain * (0.3 + r()), hp: 1800, lp: 9000, decay: 0.001 + r() * 0.004 }); });
  }
  function birds(o, sr, r, perSec, gain) {
    events(o, sr, r, perSec, function (t) {
      var notes = 2 + Math.floor(r() * 4), f = 2600 + r() * 2400, g = gain * (0.4 + r() * 0.6);
      for (var k = 0; k < notes; k++) { var d = 0.04 + r() * 0.08; tone(o, sr, t, d, f, f + (r() - 0.4) * 1400, g, d * 0.6, d * 0.3); t += d + 0.02 + r() * 0.06; }
    });
  }
  function crickets(o, sr, r, n, gain) {
    for (var c = 0; c < n; c++) {
      var f = 4100 + r() * 1200, w = TAU * f / sr, pulse = 25 + r() * 15, pulses = 3 + Math.floor(r() * 3), period = 0.45 + r() * 0.5, off = r() * period, g = gain * (0.4 + r() * 0.6);
      for (var i = 0; i < o.length; i++) {
        var t = i / sr + off, inCh = t % period, k = inCh * pulse, env = k < pulses ? Math.pow(Math.sin(Math.PI * (k % 1)), 2) : 0;
        if (env) o[i] += Math.sin(w * i) * env * g;
      }
    }
  }
  function owl(o, sr, r, t, gain) {
    var seq = [[0, 0.32], [0.55, 0.16], [0.78, 0.42]];
    for (var k = 0; k < seq.length; k++) {
      tone(o, sr, t + seq[k][0], seq[k][1], 390, 345, gain, seq[k][1] * 0.8, 0.06);
      noise(o, sr, r, t + seq[k][0], seq[k][1], { gain: gain * 0.15, lp: 700, hp: 250, attack: 0.05, decay: seq[k][1] });
    }
  }
  function clink(o, sr, r, t, gain) { var f = 1500 + r() * 900; modal(o, sr, t, [f, f * 1.71, f * 2.63], [0.09, 0.05, 0.03], [gain, gain * 0.5, gain * 0.25]); }
  function bubbles(o, sr, r, perSec, gain) {
    events(o, sr, r, perSec, function (t) { var f = 400 + r() * 900, d = 0.02 + r() * 0.04; tone(o, sr, t, d * 2, f, f * (1.6 + r()), gain * (0.3 + r() * 0.7), d, 0.002); });
  }
  function hammer(o, sr, r, perSec, gain) {
    events(o, sr, r, perSec, function (t) {
      var hits = 3 + Math.floor(r() * 4);
      for (var k = 0; k < hits; k++) modal(o, sr, t + k * (0.55 + r() * 0.1), [880, 1490, 2310], [0.12, 0.07, 0.04], [gain, gain * 0.5, gain * 0.3]);
    });
  }

  var R = {};
  // --- Efectos ---
  function steps(floor) {
    return function (sr) {
      var gap = 0.42, n = 4, o = buf(sr, 0.15 + gap * n + 0.35), r = rng(hash('pasos-' + floor));
      for (var i = 0; i < n; i++) {
        var t = 0.05 + i * gap + (r() - 0.5) * 0.04, g = (0.85 + r() * 0.3) * (i % 2 ? 0.85 : 1);
        if (floor === 'madera') {
          tone(o, sr, t, 0.12, 105 + r() * 25, 68, 0.9 * g, 0.035);
          noise(o, sr, r, t, 0.08, { gain: 0.55 * g, lp: 1500, hp: 150, decay: 0.02 });
          noise(o, sr, r, t + 0.07, 0.05, { gain: 0.25 * g, lp: 2600, hp: 300, decay: 0.014 });
          if (r() < 0.4) creak(o, sr, r, t + 0.04, 0.09, 60, 45, 0.05 * g);
        } else if (floor === 'piedra') {
          noise(o, sr, r, t, 0.05, { gain: 0.8 * g, lp: 6500, hp: 1100, decay: 0.012 });
          tone(o, sr, t, 0.06, 230, 150, 0.35 * g, 0.015);
          noise(o, sr, r, t + 0.07, 0.05, { gain: 0.4 * g, lp: 7500, hp: 2000, decay: 0.01, grain: 0.4 });
        } else if (floor === 'tierra') {
          noise(o, sr, r, t, 0.16, { gain: 0.7 * g, lp: 900, hp: 70, decay: 0.045, attack: 0.012 });
          tone(o, sr, t, 0.08, 90, 60, 0.45 * g, 0.03);
          noise(o, sr, r, t + 0.04, 0.1, { gain: 0.15 * g, lp: 4000, hp: 1500, decay: 0.03, grain: 0.3 });
        } else if (floor === 'hierba') {
          noise(o, sr, r, t, 0.24, { gain: 0.55 * g, lp: 5500, hp: 1400, decay: 0.07, attack: 0.025, grain: 0.35 });
          tone(o, sr, t, 0.07, 85, 60, 0.3 * g, 0.03);
        } else {
          noise(o, sr, r, t, 0.32, { gain: 0.7 * g, lp: 2300, hp: 250, decay: 0.09, attack: 0.01 });
          for (var b = 0; b < 3; b++) { var f = 500 + r() * 500; tone(o, sr, t + 0.04 + r() * 0.18, 0.07, f, f * 2.2, 0.18 * g, 0.03); }
        }
      }
      return norm(o, 0.75);
    };
  }
  R['pasos-madera'] = { next: 1.55, gain: 0.8, render: steps('madera') };
  R['pasos-piedra'] = { next: 1.55, gain: 0.7, render: steps('piedra') };
  R['pasos-tierra'] = { next: 1.55, gain: 0.8, render: steps('tierra') };
  R['pasos-hierba'] = { next: 1.55, gain: 0.7, render: steps('hierba') };
  R['pasos-agua'] = { next: 1.6, gain: 0.7, render: steps('agua') };
  R['puerta-abrir'] = { next: 0.95, gain: 0.85, render: function (sr) {
    var o = buf(sr, 1.3), r = rng(11);
    noise(o, sr, r, 0.02, 0.03, { gain: 0.5, hp: 2500, lp: 9000, decay: 0.006 });
    modal(o, sr, 0.02, [2100, 3400], [0.03, 0.02], [0.25, 0.12]);
    tone(o, sr, 0.08, 0.1, 140, 90, 0.25, 0.03);
    creak(o, sr, r, 0.14, 0.9, 34, 72, 0.5);
    return norm(o, 0.85);
  } };
  R['puerta-cerrar'] = { next: 0.55, gain: 0.95, render: function (sr) {
    var o = buf(sr, 1.0), r = rng(12);
    creak(o, sr, r, 0.0, 0.26, 58, 40, 0.35);
    tone(o, sr, 0.3, 0.4, 78, 44, 1, 0.11);
    noise(o, sr, r, 0.3, 0.25, { gain: 0.7, lp: 500, hp: 40, decay: 0.05 });
    modal(o, sr, 0.3, [175, 262, 410], [0.07, 0.05, 0.03], [0.25, 0.15, 0.1]);
    noise(o, sr, r, 0.42, 0.03, { gain: 0.4, hp: 2500, lp: 9000, decay: 0.006 });
    modal(o, sr, 0.42, [2300, 3600], [0.03, 0.02], [0.2, 0.1]);
    return norm(o, 0.9);
  } };
  R['moneda'] = { next: 0.5, gain: 0.55, render: function (sr) {
    var o = buf(sr, 0.9), r = rng(21), ts = [0.02, 0.13, 0.21, 0.36];
    for (var k = 0; k < ts.length; k++) {
      var f = 2500 + r() * 700, g = 1 - k * 0.18;
      modal(o, sr, ts[k], [f, f * 1.58, f * 2.31, f * 3.12], [0.22, 0.14, 0.09, 0.05], [0.5 * g, 0.3 * g, 0.2 * g, 0.1 * g]);
      noise(o, sr, r, ts[k], 0.01, { gain: 0.3 * g, hp: 4000, lp: 12000, decay: 0.003 });
    }
    return norm(o, 0.7);
  } };
  R['objeto-coger'] = { next: 0.3, gain: 0.6, render: function (sr) {
    var o = buf(sr, 0.4), r = rng(31);
    noise(o, sr, r, 0.0, 0.28, { gain: 0.6, lp: 4500, hp: 1200, attack: 0.05, decay: 0.08, grain: 0.4 });
    modal(o, sr, 0.22, [1500], [0.02], [0.15]);
    return norm(o, 0.6);
  } };
  R['objeto-soltar'] = { next: 0.3, gain: 0.7, render: function (sr) {
    var o = buf(sr, 0.45), r = rng(32);
    tone(o, sr, 0.02, 0.12, 140, 80, 0.7, 0.05);
    noise(o, sr, r, 0.02, 0.08, { gain: 0.5, lp: 1500, hp: 100, decay: 0.03 });
    tone(o, sr, 0.14, 0.08, 150, 90, 0.25, 0.03);
    return norm(o, 0.7);
  } };
  R['dado'] = { next: 0.9, gain: 0.65, render: function (sr) {
    var o = buf(sr, 1.1), r = rng(41);
    for (var die = 0; die < 2; die++) {
      var t = 0.02 + die * 0.03, gap = 0.13, g = 0.9;
      tone(o, sr, t, 0.05, 170, 100, 0.35, 0.02);
      for (var k = 0; k < 8 && t < 0.95; k++) {
        modal(o, sr, t, [1700 + r() * 700, 3000 + r() * 600, 4700 + r() * 500], [0.022, 0.014, 0.009], [0.5 * g, 0.3 * g, 0.15 * g]);
        noise(o, sr, r, t, 0.008, { gain: 0.4 * g, hp: 3000, lp: 11000, decay: 0.002 });
        t += gap * (0.8 + r() * 0.4); gap *= 0.8; g *= 0.8;
      }
    }
    return norm(o, 0.75);
  } };
  R['espada-fallo'] = { next: 0.4, gain: 0.7, render: function (sr) {
    var o = buf(sr, 0.45), r = rng(51);
    whoosh(o, sr, r, 0.0, 0.4, 350, 2400, 500, 1.4, 1);
    return norm(o, 0.75);
  } };
  R['espada-golpe'] = { next: 0.55, gain: 0.75, render: function (sr) {
    var o = buf(sr, 1.4), r = rng(52);
    whoosh(o, sr, r, 0.0, 0.2, 400, 2000, 1500, 1.4, 0.6);
    modal(o, sr, 0.18, [1250, 1890, 2710, 3980, 5200], [0.8, 0.55, 0.4, 0.28, 0.18], [0.45, 0.35, 0.28, 0.18, 0.1]);
    noise(o, sr, r, 0.18, 0.08, { gain: 0.9, hp: 1500, lp: 9000, decay: 0.018 });
    return norm(o, 0.85);
  } };
  R['dano'] = { next: 0.35, gain: 0.85, render: function (sr) {
    var o = buf(sr, 0.5), r = rng(61);
    tone(o, sr, 0.01, 0.35, 85, 40, 1, 0.11);
    noise(o, sr, r, 0.01, 0.2, { gain: 0.8, lp: 400, hp: 30, decay: 0.05 });
    noise(o, sr, r, 0.01, 0.06, { gain: 0.4, lp: 1300, hp: 200, decay: 0.02 });
    return norm(o, 0.9);
  } };
  R['curar'] = { next: 0.8, gain: 0.45, render: function (sr) {
    var o = buf(sr, 1.5), f = [523.25, 659.25, 783.99, 1046.5];
    for (var k = 0; k < f.length; k++) { tone(o, sr, k * 0.09, 1.2, f[k], f[k], 0.3, 0.5, 0.03); tone(o, sr, k * 0.09 + 0.02, 0.9, f[k] * 2, f[k] * 2, 0.06, 0.35, 0.03); }
    return norm(o, 0.6);
  } };
  R['hacha'] = { next: 0.9, gain: 0.8, render: function (sr) {
    var o = buf(sr, 1.0), r = rng(71);
    for (var k = 0; k < 2; k++) {
      var t = 0.02 + k * 0.55;
      noise(o, sr, r, t, 0.08, { gain: 0.8, lp: 3000, hp: 300, decay: 0.03 });
      modal(o, sr, t, [310, 690, 1080], [0.08, 0.05, 0.03], [0.5, 0.3, 0.15]);
      tone(o, sr, t, 0.1, 125, 70, 0.5, 0.04);
    }
    return norm(o, 0.85);
  } };
  R['descubrir'] = { next: 0.7, gain: 0.4, render: function (sr) {
    var o = buf(sr, 1.4);
    tone(o, sr, 0.0, 1.0, 987.77, 987.77, 0.35, 0.45, 0.008); tone(o, sr, 0.0, 0.6, 2725, 2725, 0.05, 0.2, 0.008);
    tone(o, sr, 0.13, 1.2, 1479.98, 1479.98, 0.3, 0.55, 0.008);
    return norm(o, 0.55);
  } };
  R['campana'] = { next: 1.2, gain: 0.5, render: function (sr) {
    var o = buf(sr, 3.2), f = 392, p = [0.5, 1, 1.19, 1.5, 2, 2.52, 3.01];
    modal(o, sr, 0.0, p.map(function (x) { return f * x; }), [0.9, 0.5, 0.45, 0.35, 0.3, 0.2, 0.15], [0.5, 0.4, 0.3, 0.2, 0.2, 0.1, 0.08]);
    return norm(o, 0.6);
  } };

  // --- Ambientes en bucle ---
  R['ambiente-taberna'] = { loop: true, gain: 0.55, render: function (sr) { var r = rng(101); return norm(loop(sr, 14, function (o) {
    bed(o, sr, r, { brown: true, lp: 260, gain: 0.25, lfo: [[0.13, 0.3]] });
    murmur(o, sr, r, 6, 0.9, 1400);
    crackles(o, sr, r, 5, 0.25);
    events(o, sr, r, 0.25, function (t) { clink(o, sr, r, t, 0.12); if (r() < 0.5) clink(o, sr, r, t + 0.08, 0.08); });
    events(o, sr, r, 0.12, function (t) { creak(o, sr, r, t, 0.2, 55, 40, 0.06); });
  }), 0.5); } };
  R['ambiente-interior'] = { loop: true, gain: 0.45, render: function (sr) { var r = rng(102); return norm(loop(sr, 12, function (o) {
    bed(o, sr, r, { brown: true, lp: 220, gain: 0.5, lfo: [[0.07, 0.3]] });
    events(o, sr, r, 0.15, function (t) { creak(o, sr, r, t, 0.25, 50, 38, 0.12); });
    crackles(o, sr, r, 1.5, 0.12);
  }), 0.4); } };
  R['ambiente-herreria'] = { loop: true, gain: 0.5, render: function (sr) { var r = rng(109); return norm(loop(sr, 14, function (o) {
    bed(o, sr, r, { brown: true, lp: 320, gain: 0.45, lfo: [[0.11, 0.5], [0.31, 0.25]] });
    crackles(o, sr, r, 6, 0.2);
    hammer(o, sr, r, 0.18, 0.3);
  }), 0.5); } };
  R['ambiente-plaza'] = { loop: true, gain: 0.5, render: function (sr) { var r = rng(103); return norm(loop(sr, 14, function (o) {
    bed(o, sr, r, { brown: true, lp: 500, gain: 0.35, lfo: [[0.09, 0.6], [0.23, 0.3]] });
    murmur(o, sr, r, 3, 0.45, 900);
    birds(o, sr, r, 0.35, 0.22);
    hammer(o, sr, r, 0.08, 0.06);
  }), 0.5); } };
  R['ambiente-plaza-noche'] = { loop: true, gain: 0.45, render: function (sr) { var r = rng(104); return norm(loop(sr, 12, function (o) {
    bed(o, sr, r, { brown: true, lp: 380, gain: 0.35, lfo: [[0.07, 0.6], [0.19, 0.3]] });
    crickets(o, sr, r, 2, 0.05);
  }), 0.45); } };
  R['ambiente-bosque'] = { loop: true, gain: 0.5, render: function (sr) { var r = rng(105); return norm(loop(sr, 14, function (o) {
    bed(o, sr, r, { brown: true, lp: 450, gain: 0.3, lfo: [[0.08, 0.6]] });
    bed(o, sr, r, { lp: 6000, hp: 1500, gain: 0.08, lfo: [[0.08, 0.7], [0.31, 0.4]] });
    birds(o, sr, r, 1.1, 0.3);
  }), 0.5); } };
  R['ambiente-bosque-noche'] = { loop: true, gain: 0.5, render: function (sr) { var r = rng(106); return norm(loop(sr, 16, function (o) {
    bed(o, sr, r, { brown: true, lp: 350, gain: 0.3, lfo: [[0.06, 0.6]] });
    bed(o, sr, r, { lp: 5000, hp: 1500, gain: 0.04, lfo: [[0.06, 0.8]] });
    crickets(o, sr, r, 5, 0.06);
    owl(o, sr, r, 3 + r() * 6, 0.25);
  }), 0.45); } };
  R['ambiente-agua'] = { loop: true, gain: 0.5, render: function (sr) { var r = rng(107); return norm(loop(sr, 10, function (o) {
    bed(o, sr, r, { lp: 2600, hp: 300, gain: 0.35, lfo: [[7, 0.3], [11.3, 0.25], [0.2, 0.3]] });
    bubbles(o, sr, r, 22, 0.06);
    birds(o, sr, r, 0.25, 0.15);
  }), 0.5); } };
  R['ambiente-lluvia'] = { loop: true, gain: 0.5, render: function (sr) { var r = rng(108); return norm(loop(sr, 10, function (o) {
    bed(o, sr, r, { lp: 7000, hp: 500, gain: 0.3, lfo: [[0.11, 0.25]] });
    bed(o, sr, r, { brown: true, lp: 150, gain: 0.3 });
    events(o, sr, r, 90, function (t) { noise(o, sr, r, t, 0.01, { gain: 0.15 + r() * 0.2, hp: 2500, lp: 9000, decay: 0.002 }); });
    events(o, sr, r, 3, function (t) { var f = 1800 + r() * 2000; modal(o, sr, t, [f], [0.015], [0.1]); });
  }), 0.5); } };

  return {
    keys: Object.keys(R),
    has: function (k) { return Object.prototype.hasOwnProperty.call(R, k); },
    info: function (k) { var x = R[k]; return x ? { loop: !!x.loop, gain: x.gain, next: x.next || 0 } : null; },
    render: function (k, sr) { var x = R[k]; return x ? x.render(sr) : null; },
  };
})();`;

const recipes = new Function(RECIPES_JS + '\nreturn SFX_RECIPES;')() as {
  keys: string[];
  has(k: string): boolean;
  info(k: string): { loop: boolean; gain: number; next: number } | null;
  render(k: string, sr: number): Float32Array | null;
};

/** Claves con receta procedural (todas las que puede pedir soundmap.ts). */
export const RECIPE_KEYS: readonly string[] = recipes.keys;
export const renderRecipe = (key: string, sampleRate: number) => recipes.render(key, sampleRate);
export const recipeInfo = (key: string) => recipes.info(key);

// ---------------------------------------------------------------------------
// Interfaz y gestor de audio (navegador)
// ---------------------------------------------------------------------------

export const SFX_STYLE = String.raw`
  /* Sonido de la partida: un botón de silencio y, al lado, los volúmenes. */
  .chat-head .sfx { margin-left: auto; position: relative; display: flex; align-items: center; flex: none; height: 32px; border-radius: 999px; background: var(--control); }
  .chat-head .sfx + .tts { margin-left: 8px; }
  .sfx > button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 10px 0 12px; border: 0; border-radius: 999px 0 0 999px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 500; white-space: nowrap; }
  .sfx > .sfx-more { width: 26px; padding: 0 8px 0 0; border-radius: 0 999px 999px 0; }
  .sfx > button:hover { background: var(--hover); color: var(--text); }
  .sfx.on > .sfx-toggle { color: var(--accent); }
  .sfx.on { background: var(--accent-tint); }
  .sfx-pop { position: absolute; top: 40px; right: 0; z-index: 30; width: 260px; padding: 14px; border-radius: 22px; background: rgba(28,29,35,.94); -webkit-backdrop-filter: blur(24px); backdrop-filter: blur(24px); box-shadow: var(--window-shadow); font-size: 13px; }
  .sfx-pop[hidden] { display: none; }
  .sfx-pop label { display: block; margin: 0 0 10px; color: var(--muted); font-size: 12px; font-weight: 500; }
  .sfx-pop label.row { display: flex; align-items: center; gap: 8px; color: var(--text); font-size: 13px; }
  .sfx-pop input[type=range] { display: block; width: 100%; margin-top: 4px; }
  /* Cada canal: a la izquierda su interruptor y luego su volumen. */
  .sfx-pop .mix { display: flex; align-items: flex-end; gap: 14px; margin: 0 0 10px; }
  .sfx-pop .mix label { flex: 1; min-width: 0; margin: 0; }
  .sfx-pop .mix input[type=checkbox] { flex: none; margin-bottom: 2px; }
  .sfx > .sfx-toggle .fx { font: 800 11px/1 var(--sans, sans-serif); letter-spacing: .04em; }
  .sfx .sfx-music .off, .sfx .sfx-music.on .onw { display: block; }
  .sfx .sfx-music .onw, .sfx .sfx-music.on .off { display: none; }
  .sfx-pop .note { margin: 6px 0 0; color: var(--faint); font-size: 11.5px; line-height: 1.4; }
  .sfx-pop .credits a { color: var(--muted); }
  @media (max-width: 820px) { .sfx > .sfx-toggle span:not(.fx) { display: none; } .sfx > .sfx-toggle { padding: 0 6px 0 10px; } }
`;

/** Nota musical (la canción de la partida) y la misma nota tachada (sin canción). */
const NOTE_ICON = '<svg class="i onw" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
const MUTE_ICON = '<svg class="i off" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/></svg>';
const CARET = '<svg class="i" viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M7 10l5 5 5-5"/></svg>';

export const SFX_SCRIPT = String.raw`<script>
(function () {
  ${RECIPES_JS}
  var params = new URLSearchParams(location.search), game = params.get('game') || '';
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function num(v, d) { var n = Number(v); return v === null || v === undefined || v === '' || !isFinite(n) ? d : Math.max(0, Math.min(1, n)); }
  function isAmb(k) { return /^ambiente-/.test(k); }
  var AC = window.AudioContext || window.webkitAudioContext;
  var muted = store('tavernus.sfx.muted') === '1', vol = num(store('tavernus.sfx.volume'), 0.7), ambVol = 0.5;
  // Tres canales: la canción (música de entrada, en bucle), los efectos y el ambiente; cada uno con volumen e interruptor.
  var musicOn = store('tavernus.music.game') !== '0', musicVol = num(store('tavernus.music.volume'), 0.6);
  // El ambiente suena a la mitad del volumen de «Efectos y ambiente», que lo enciende y apaga con los efectos.
  var ctx = null, master = null, ambBus = null, fxBus = null, unlocked = false, fresh = false, ducked = false, external = false;
  var cache = {}, files = {}, credits = [], ai = false, amb = null, wantAmb = null, seqEnd = 0, character = null;

  // Interfaz: silencio y volúmenes en la cabecera del chat, delante del narrador.
  var head = document.querySelector('.chat-head'), box = document.createElement('div');
  box.className = 'sfx';
  box.innerHTML =
    '<button type="button" class="sfx-music" aria-pressed="false" title="Música de la partida">' + '${NOTE_ICON}${MUTE_ICON}' + '</button>' +
    '<button type="button" class="sfx-toggle" aria-pressed="false" title="Efectos y ambiente (pasos, puertas, lluvia…)"><span class="fx" aria-hidden="true">FX</span></button>' +
    '<button type="button" class="sfx-more" title="Volumen del sonido" aria-label="Volumen del sonido" aria-expanded="false">' + '${CARET}' + '</button>' +
    '<div class="sfx-pop" hidden>' +
      '<div class="mix"><input type="checkbox" data-k="musicOn" aria-label="Música"><label>Música<input type="range" min="0" max="1" step="0.05" data-k="music"></label></div>' +
      '<div class="mix"><input type="checkbox" data-k="on" aria-label="Efectos y ambiente"><label>Efectos y ambiente<input type="range" min="0" max="1" step="0.05" data-k="volume"></label></div>' +
      '<p class="note credits" hidden></p>' +
    '</div>';
  if (head) head.insertBefore(box, head.querySelector('.tts')); else return;
  if (!AC) { box.hidden = true; return; }
  var toggle = box.querySelector('.sfx-toggle'), musicBtn = box.querySelector('.sfx-music'), more = box.querySelector('.sfx-more'), pop = box.querySelector('.sfx-pop');

  function ui() {
    box.classList.toggle('on', !muted);
    toggle.setAttribute('aria-pressed', muted ? 'false' : 'true');
    toggle.title = muted ? 'Activar efectos y ambiente' : 'Silenciar efectos y ambiente';
    toggle.setAttribute('aria-label', toggle.title);
    musicBtn.classList.toggle('on', musicOn);
    musicBtn.setAttribute('aria-pressed', musicOn ? 'true' : 'false');
    musicBtn.title = musicOn ? 'Parar la música' : 'Poner la música';
    musicBtn.setAttribute('aria-label', musicBtn.title);
    pop.querySelector('[data-k=on]').checked = !muted;
    pop.querySelector('[data-k=musicOn]').checked = musicOn;
    pop.querySelector('[data-k=music]').value = String(musicVol);
    pop.querySelector('[data-k=volume]').value = String(vol);
    // Créditos de las pistas de ambiente (obligatorios en las CC BY; las CC0 se citan igual).
    var cr = pop.querySelector('.credits');
    cr.hidden = !credits.length;
    cr.textContent = credits.length ? 'Créditos: ' : '';
    credits.forEach(function (c, i) {
      var a = document.createElement('a');
      a.href = c.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '«' + c.title + '», de ' + c.author;
      cr.appendChild(a); cr.appendChild(document.createTextNode(' (' + c.license + ')' + (i < credits.length - 1 ? ' · ' : '. Freesound.org')));
    });
  }

  function ensure() {
    if (ctx) return ctx;
    try { ctx = new AC(); } catch (e) { return null; }
    master = ctx.createGain(); ambBus = ctx.createGain(); fxBus = ctx.createGain();
    ambBus.connect(master); fxBus.connect(master); master.connect(ctx.destination);
    levels(0);
    return ctx;
  }
  function ramp(param, v, s) { var t = ctx.currentTime; param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); param.linearRampToValueAtTime(v, t + Math.max(0.01, s)); }
  function levels(s) {
    if (!ctx) return;
    ramp(master.gain, muted ? 0 : vol, s);
    ramp(ambBus.gain, ambVol * (ducked || external ? 0.35 : 1), s);
    introLevel(s);
  }
  /** Primer gesto: crea o reanuda el contexto; en iOS, además, un búfer mudo dentro del gesto. */
  function unlock() {
    if (!ensure()) return;
    if (!muted && ctx.state !== 'running' && document.visibilityState === 'visible') ctx.resume();
    if (muted && ctx.state === 'running') ctx.suspend(); // creado dentro del gesto arranca solo: silenciado no gasta
    if (unlocked) return;
    var s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
    unlocked = true; fresh = true; setTimeout(function () { fresh = false; }, 0);
    if (wantAmb) setAmbience(wantAmb, 1.5);
    ui();
  }
  ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { document.addEventListener(ev, unlock, { capture: true, passive: true }); });
  document.addEventListener('visibilitychange', function () {
    if (!ctx || !unlocked) return;
    if (document.visibilityState === 'hidden') ctx.suspend(); else if (!muted) ctx.resume();
  });

  function api(path) { return path + (path.indexOf('?') < 0 ? '?' : '&') + 'game=' + encodeURIComponent(game); }
  function synth(key) {
    var data = SFX_RECIPES.render(key, ctx.sampleRate);
    if (!data) return null;
    var b = ctx.createBuffer(1, data.length, ctx.sampleRate); b.getChannelData(0).set(data);
    return b;
  }
  function decode(ab) { return new Promise(function (ok, ko) { ctx.decodeAudioData(ab, ok, ko); }); }
  // Vorbis donde se pueda (no deja hueco al repetir); si no, MP3.
  var fmt = (function () { try { return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'mp3'; } catch (e) { return 'mp3'; } })();
  function fetchFile(key) {
    return fetch(api('/api/sfx?key=' + encodeURIComponent(key) + '&fmt=' + fmt)).then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); }).then(decode).then(function (b) {
      if (isAmb(key)) b.loopPoints = edges(b);
      return b;
    });
  }
  /** Bucle de una pista: sin el silencio que el MP3 mete al principio y al final (hasta 0,2 s). */
  function edges(b) {
    var d = b.getChannelData(0), max = Math.min(d.length >> 2, Math.round(b.sampleRate * 0.2)), i = 0, j = d.length - 1;
    while (i < max && Math.abs(d[i]) < 1e-4) i++;
    while (d.length - 1 - j < max && Math.abs(d[j]) < 1e-4) j--;
    return [i / b.sampleRate, (j + 1) / b.sampleRate];
  }
  /** Búfer de una clave: el fichero si lo hay; si no, la receta. Con IA activa, lo que falta se pide en segundo plano para la próxima vez. */
  function buffer(key) {
    if (cache[key]) return cache[key];
    var p = files[key] ? fetchFile(key).catch(function () { return synth(key); })
      : new Promise(function (ok) { setTimeout(function () { ok(synth(key)); }, 0); });
    cache[key] = p;
    if (!files[key] && ai) fetchFile(key).then(function (b) { files[key] = true; cache[key] = Promise.resolve(b); }).catch(function () {});
    return p;
  }
  // Las pistas de ambiente vienen igualadas a -24 dBFS RMS: de fondo, por debajo de la voz.
  function gainOf(key, b) { if (b && b.loopPoints) return 0.7; var i = SFX_RECIPES.info(key); return i ? i.gain : 0.6; }
  function nextOf(key, b) { var i = SFX_RECIPES.info(key); return files[key] && b ? Math.min(b.duration, 1.2) : (i && i.next) || (b ? b.duration : 0.5); }

  /** Ambiente en bucle con fundido cruzado; la misma clave no se reinicia. */
  function setAmbience(key, fade, when) {
    wantAmb = key;
    if (!ctx || !unlocked) return;
    if (amb && amb.key === key) return;
    var prev = amb, mine = amb = { key: key, src: null, gain: null };
    buffer(key).then(function (b) {
      if (amb !== mine || !b) return;
      var t = Math.max(ctx.currentTime, when || 0);
      if (prev && prev.gain) { prev.gain.gain.setValueAtTime(prev.gain.gain.value, t); prev.gain.gain.linearRampToValueAtTime(0, t + fade); var old = prev.src; setTimeout(function () { try { old.stop(); } catch (e) {} }, (t - ctx.currentTime + fade) * 1000 + 200); }
      var g = ctx.createGain(), s = ctx.createBufferSource();
      var lp = b.loopPoints || [0, b.duration];
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gainOf(key, b), t + fade);
      s.buffer = b; s.loop = true; s.loopStart = lp[0]; s.loopEnd = lp[1]; s.connect(g); g.connect(ambBus);
      s.start(t, lp[0] + Math.random() * (lp[1] - lp[0]));
      mine.src = s; mine.gain = g;
    });
  }
  /** Secuencia: cada efecto empieza cuando el anterior lo permite; los ambientes se funden en su sitio. */
  function cue(keys) {
    keys = (keys || []).filter(function (k) { return typeof k === 'string' && SFX_RECIPES.has(k) || files[k]; });
    if (!keys.length) return;
    if (!ctx || !unlocked || muted) { keys.forEach(function (k) { if (isAmb(k)) setAmbience(k, 2.5); }); return; }
    Promise.all(keys.map(buffer)).then(function (bs) {
      var t = Math.max(ctx.currentTime + 0.05, seqEnd);
      keys.forEach(function (k, i) {
        var b = bs[i];
        if (!b) return;
        if (isAmb(k)) { setAmbience(k, 2.5, t); return; }
        var g = ctx.createGain(), s = ctx.createBufferSource();
        g.gain.value = gainOf(k, b); s.buffer = b; s.connect(g); g.connect(fxBus); s.start(t);
        t += nextOf(k, b) + 0.06;
      });
      seqEnd = t;
    });
  }
  function setMuted(m) {
    muted = m; store('tavernus.sfx.muted', m ? '1' : '0');
    if (!m) unlock();
    if (ctx) { levels(0.3); if (m) setTimeout(function () { if (muted) ctx.suspend(); }, 400); else ctx.resume(); }
    ui();
  }

  // El narrador del navegador (speechSynthesis) baja el ambiente mientras habla.
  setInterval(function () {
    var talking = !!(window.speechSynthesis && window.speechSynthesis.speaking);
    if (talking !== ducked) { ducked = talking; levels(0.4); }
  }, 400);

  // El primer toque al botón, si ya estaba activo, solo arranca el sonido (antes no sonaba nada).
  toggle.addEventListener('click', function () { if (fresh && !muted) { ui(); return; } setMuted(!muted); });
  more.addEventListener('click', function (ev) { ev.stopPropagation(); pop.hidden = !pop.hidden; more.setAttribute('aria-expanded', String(!pop.hidden)); ui(); });
  document.addEventListener('click', function (ev) { if (!pop.hidden && !box.contains(ev.target)) { pop.hidden = true; more.setAttribute('aria-expanded', 'false'); } });
  musicBtn.addEventListener('click', function () { setMusic(!musicOn); });
  pop.addEventListener('input', function (ev) {
    var k = ev.target.getAttribute('data-k');
    if (k === 'music') { musicVol = num(ev.target.value, musicVol); store('tavernus.music.volume', String(musicVol)); introLevel(0.1); }
    if (k === 'volume') { vol = num(ev.target.value, vol); store('tavernus.sfx.volume', String(vol)); levels(0.1); }
  });
  pop.addEventListener('change', function (ev) {
    var k = ev.target.getAttribute('data-k');
    if (k === 'on') setMuted(!ev.target.checked);
    if (k === 'musicOn') setMusic(ev.target.checked);
  });

  /** Estado del PJ: su ambiente actual, qué claves hay en fichero y si la IA está activa. */
  function load(id) {
    character = id;
    fetch(api('/api/sfx?character=' + encodeURIComponent(id))).then(function (r) { return r.ok ? r.json() : null; }).then(function (s) {
      if (!s || character !== id) return;
      files = {}; (s.files || []).forEach(function (k) { files[k] = true; });
      credits = Array.isArray(s.credits) ? s.credits : [];
      ai = !!s.ai;
      if (s.ambience) setAmbience(s.ambience, 2);
      ui();
    }).catch(function () {});
  }
  ui();

  // Música de la partida (public/music/intro-partida.mp3): si se llega desde el menú con su música sonando, empieza
  // suave de fondo mientras aquella se desvanece, y sigue en bucle hasta que se apague con su botón (nota musical) o
  // en los ajustes. Encenderla después la pone aunque no viniera sonando. Va aparte de los efectos y del ambiente.
  var intro = null, introFade = null, introOff = !musicOn;
  function introTarget() { return introOff ? 0 : musicVol * 0.2 * (ducked || external ? 0.5 : 1); }
  function introTo(v, ms, then) {
    if (!intro) return;
    clearInterval(introFade);
    var from = intro.volume, t0 = Date.now();
    introFade = setInterval(function () {
      var k = Math.min(1, (Date.now() - t0) / Math.max(1, ms));
      intro.volume = Math.max(0, Math.min(1, from + (v - from) * k));
      if (k >= 1) { clearInterval(introFade); if (then) then(); }
    }, 50);
  }
  function introLevel(s) {
    if (!intro) return;
    if (introOff) introTo(0, 300, function () { intro.pause(); });
    else if (intro.paused) introStart(); else introTo(introTarget(), s * 1000);
  }
  function introStart() {
    if (!intro || introOff) return;
    var p = intro.play();
    if (p && p.then) p.then(function () { introTo(introTarget(), 5000); }, function () {}); else introTo(introTarget(), 5000);
  }
  function introMake() {
    if (intro) return;
    intro = new Audio('/music/intro-partida.mp3'); intro.preload = 'auto'; intro.loop = true; intro.volume = 0;
  }
  function setMusic(on) {
    musicOn = on; introOff = !on; store('tavernus.music.game', on ? '1' : '0');
    if (on) { introMake(); introStart(); } else introLevel(0.3);
    ui();
  }
  (function () {
    var want = false;
    try { want = sessionStorage.getItem('tavernus.introMusic') === '1'; sessionStorage.removeItem('tavernus.introMusic'); } catch (e) {}
    if (!want || !musicOn) return;
    introMake();
    introStart();
    // Si el navegador no deja sonar sin un gesto, empieza al primer toque o tecla.
    function first() { ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { document.removeEventListener(ev, first, true); }); if (intro.paused) introStart(); }
    ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) { document.addEventListener(ev, first, true); });
  })();

  window.TavernusAudio = {
    /** El AudioContext compartido (null hasta el primer gesto si el navegador no deja crearlo antes). */
    context: function () { return ensure(); },
    unlock: unlock,
    /** Para el narrador con audio de nube: baja el ambiente mientras lee. */
    duck: function (on) { external = !!on; levels(0.4); },
    muted: function () { return muted; },
  };
  window.TavernusSfx = {
    /** page.ts: al conectar con un PJ. */
    character: load,
    /** page.ts: claves de un mensaje en directo. */
    cue: cue,
    setAmbience: function (k) { setAmbience(k, 2.5); },
    /** Para pruebas y depuración. */
    state: function () { return { unlocked: unlocked, muted: muted, volume: vol, ambienceVolume: ambVol, ambience: amb && amb.key, wanted: wantAmb, context: ctx && ctx.state, files: Object.keys(files), ai: ai, format: fmt, music: { on: musicOn, volume: musicVol }, intro: intro && { playing: !intro.paused, volume: Math.round(intro.volume * 100) / 100, ended: intro.ended } }; },
  };
})();
</script>`;

// ---------------------------------------------------------------------------
// Servidor: GET /api/sfx?game=SLUG&character=ID  ·  GET /api/sfx?game=SLUG&key=CLAVE
// ---------------------------------------------------------------------------

const EXTS: Record<string, string> = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' };
/** Biblioteca fija (public/sfx); SFX_LIBRARY_DIR la cambia (tests). */
const librarySfx = () => process.env['SFX_LIBRARY_DIR'] || fileURLToPath(new URL('../../../public/sfx/', import.meta.url));

let provider: SoundProvider | null | undefined;
let generated = 0;
const inflight = new Map<string, Promise<string | null>>();

function current(): SoundProvider | null {
  if (provider === undefined) {
    try { provider = soundProviderFromEnv(); } catch (e) { console.warn('[sfx]', (e as Error).message); provider = null; }
  }
  return provider;
}

/** Para tests: fija el proveedor (null = ninguno; undefined = el del entorno). */
export function setSoundProviderForTests(p: SoundProvider | null | undefined): void { provider = p; generated = 0; inflight.clear(); }

/** Ficheros de una carpeta por clave; una clave puede venir en varios formatos (ogg y mp3). */
async function listKeys(dir: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  try {
    for (const f of (await readdir(dir)).sort()) {
      const m = /^([a-z0-9-]+)\.([a-z0-9]+)$/.exec(f);
      if (m && EXTS[m[2]!]) out.set(m[1]!, [...(out.get(m[1]!) ?? []), join(dir, f)]);
    }
  } catch { /* sin carpeta */ }
  return out;
}

/** Ficheros por clave: primero los de la partida, luego la biblioteca (public/sfx y sus pistas de ambiente). */
async function filesFor(gameDir: string): Promise<Map<string, string[]>> {
  const own = await listKeys(join(gameDir, 'sfx'));
  // Lo de la raíz de public/sfx manda sobre las pistas grabadas de ambient/ (los ambientes elegidos por el equipo).
  for (const dir of [librarySfx(), join(librarySfx(), 'ambient')]) {
    for (const [k, p] of await listKeys(dir)) if (!own.has(k)) own.set(k, p);
  }
  return own;
}

/** El formato que pide el navegador (?fmt=ogg|mp3) si está; si no, el primero que haya. */
const pick = (paths: string[], fmt: string | null) => paths.find((p) => fmt && p.endsWith(`.${fmt}`)) ?? paths[0]!;

/**
 * Pistas grabadas de public/sfx/ambient (licencias completas en public/sfx/LICENSES).
 * Viajan a la web para la línea de créditos del panel de sonido.
 */
export interface AmbientTrack { key: string; title: string; author: string; url: string; license: 'CC0 1.0' | 'CC BY 4.0' | 'CC BY 3.0' }
export const AMBIENT_TRACKS: readonly AmbientTrack[] = [
  { key: 'ambiente-taberna', title: 'Pirate Tavern', author: 'brunoboselli', url: 'https://freesound.org/people/brunoboselli/sounds/695295/', license: 'CC0 1.0' },
  { key: 'ambiente-herreria', title: 'traditionnal blacksmith', author: 'bruno.auzet', url: 'https://freesound.org/people/bruno.auzet/sounds/640197/', license: 'CC0 1.0' },
  { key: 'ambiente-interior', title: 'Fire crackling in fireplace', author: 'Davor', url: 'https://freesound.org/people/Davor/sounds/382616/', license: 'CC0 1.0' },
  { key: 'ambiente-plaza', title: 'medieval_village_atmosphere.wav', author: 'ramonmineiro', url: 'https://freesound.org/people/ramonmineiro/sounds/578072/', license: 'CC0 1.0' },
  { key: 'ambiente-plaza-noche', title: 'Ambience Countryside Nightfall.wav', author: 'Cristiano_Scherer', url: 'https://freesound.org/people/Cristiano_Scherer/sounds/478788/', license: 'CC0 1.0' },
  { key: 'ambiente-bosque', title: 'sfx_amb_forest_spring_afternoon-01.wav', author: 'bajko', url: 'https://freesound.org/people/bajko/sounds/385280/', license: 'CC0 1.0' },
  { key: 'ambiente-bosque-noche', title: 'AMBIENCE NIGHT FIELD CRICKET 01.wav', author: 'sengjinn', url: 'https://freesound.org/people/sengjinn/sounds/175020/', license: 'CC0 1.0' },
  { key: 'ambiente-agua', title: 'small stream forest', author: 'Yuval', url: 'https://freesound.org/people/Yuval/sounds/197023/', license: 'CC0 1.0' },
];

/** Genera con el proveedor (una vez por clave) y lo deja en data/games/<slug>/sfx. */
async function generate(gameDir: string, key: string, p: SoundProvider): Promise<string | null> {
  const max = Number(process.env['SFX_MAX_GENERATIONS'] ?? 40);
  const prompt = SOUND_PROMPTS[key];
  if (!prompt || generated >= max) return null;
  const id = `${gameDir}|${key}`;
  const running = inflight.get(id);
  if (running) return running;
  const job = (async () => {
    generated += 1;
    const bytes = await p.generate(key, prompt);
    const dir = join(gameDir, 'sfx');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `${key}.${p.ext}`);
    await writeFile(file, bytes);
    console.log(`[sfx] ${p.id}: generado ${key} (${generated}/${max})`);
    return file;
  })().catch((e) => { console.warn(`[sfx] ${p.id} ${key}:`, (e as Error).message); return null; }).finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

export async function handleSfxRequest(engine: Engine, res: ServerResponse, url: URL, gameDir: string, _req?: IncomingMessage): Promise<void> {
  const key = url.searchParams.get('key');
  const p = current();
  if (key === null) {
    const id = url.searchParams.get('character');
    const all = await filesFor(gameDir);
    const files = [...all.keys()].filter((k) => SOUND_KEYS.includes(k));
    // Créditos solo de las pistas grabadas que de verdad suenan (las de ambient/, si nada las tapa).
    const recorded = join(librarySfx(), 'ambient');
    const credits = AMBIENT_TRACKS.filter((t) => all.get(t.key)?.[0]?.startsWith(recorded + sep));
    json(res, 200, { ambience: id ? currentAmbience(engine, id) : null, files, credits, ai: p !== null, provider: p ? p.label : null });
    return;
  }
  if (!/^[a-z0-9-]{1,40}$/.test(key) || !SOUND_KEYS.includes(key)) { json(res, 404, { ok: false, text: 'No existe ese sonido.' }); return; }
  const found = (await filesFor(gameDir)).get(key);
  let file = found ? pick(found, url.searchParams.get('fmt')) : null;
  if (!file && p) file = await generate(gameDir, key, p);
  if (!file) { json(res, 404, { ok: false, text: 'Sin fichero: se sintetiza en el navegador.' }); return; }
  const ext = file.slice(file.lastIndexOf('.') + 1);
  res.writeHead(200, { 'content-type': EXTS[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=86400' });
  res.end(await readFile(file));
}

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
