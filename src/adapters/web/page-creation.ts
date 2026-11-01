/**
 * Asistente de creación de personaje de la web (SPEC §4.6, §4.8), el mismo para el
 * anfitrión en «Nueva partida» (page-menu.ts) y el invitado en su enlace
 * (page-access.ts): nombre, raza, clase, trasfondo, características, habilidades,
 * muerte y resumen. Solo ofrece opciones válidas, pero no decide nada: el resumen
 * lo calcula el servidor (POST /api/character/preview, chargen.ts) y el servidor
 * vuelve a validarlo todo al crear.
 *
 * tavernusChargen(root, o) pinta dentro de `root`. `o`: options (el catálogo de
 * GameManager.characterOptions), previewUrl, confirmLabel, showHook() (si se pregunta
 * por qué viene), onBack (Atrás en el primer paso; sin él, no hay botón),
 * summaryExtra (nodo que va al final del resumen) y onConfirm(payload, ui), con
 * ui.busy(etiqueta, nota) y ui.fail(texto).
 */

export const CHARGEN_CSS = String.raw`
  .cg { display: flex; flex-direction: column; min-width: 0; }
  .cg[hidden] { display: none; }
  .cg-head { display: flex; flex-direction: column; gap: 6px; flex: none; }
  .cg-count { font-size: 12px; color: var(--muted); }
  .cg-bar { height: 4px; border-radius: 999px; background: var(--line); overflow: hidden; }
  .cg-bar i { display: block; height: 100%; background: var(--accent); transition: width .2s ease; }
  .cg-body { scrollbar-color: rgba(255,255,255,.2) transparent; }
  .cg-body h3 { margin: 14px 0 2px; font: 700 18px/1.25 var(--display); letter-spacing: -.01em; outline: none; }
  .cg-lead { margin: 0 0 12px; color: var(--muted); font-size: 14px; line-height: 1.45; }
  .cg-fields { display: flex; flex-direction: column; gap: 12px; }
  .cg .cg-field { display: flex; flex-direction: column; gap: 6px; margin: 0; font-size: 13px; color: var(--muted); }
  .cg .cg-field input { margin: 0; }
  .cg select option { background: #1d2022; }
  .cg-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .cg .cg-opt { position: relative; display: flex; flex-direction: column; gap: 3px; margin: 0; padding: 10px 12px; border-radius: 12px; background: var(--bubble); box-shadow: inset 0 0 0 1px var(--line); color: var(--text); cursor: pointer; }
  .cg-opt input { position: absolute; opacity: 0; pointer-events: none; }
  .cg-opt b { font-size: 14.5px; font-weight: 600; }
  .cg-opt em { margin-left: 6px; font-size: 11px; font-style: normal; font-weight: 600; color: var(--accent); }
  .cg-opt small { font-size: 12.5px; line-height: 1.4; color: var(--muted); }
  .cg-opt .pic { display: block; height: 96px; margin: 0 0 6px; border-radius: 10px; background: #1b1712 center / cover no-repeat; }
  .cg-opt:not(:has(input:checked)) .pic { filter: saturate(.75) brightness(.85); }
  .cg-opt:has(input:checked) { background: rgba(230,183,90,.08); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .cg-opt:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cg-abs { display: grid; gap: 6px; }
  .cg-ab { display: grid; grid-template-columns: minmax(0, 1fr) 72px 40px 62px; gap: 8px; align-items: center; font-size: 14px; }
  .cg-ab.top { font-size: 11px; color: var(--muted); }
  .cg-ab.top span:not(:first-child), .cg-ab small { text-align: center; }
  .cg-ab small { font-size: 12.5px; color: var(--muted); }
  .cg-ab b { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
  .cg-ab.top span:last-child { text-align: right; }
  .cg .cg-ab label { margin: 0; color: var(--text); font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .cg .cg-ab select { display: block; width: 100%; height: 40px; margin: 0; padding: 0 6px; border: 1px solid var(--line); border-radius: 10px; background: var(--bubble); color: var(--text); font-size: 14px; font-variant-numeric: tabular-nums; }
  .cg-rec { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--muted); }
  .cg-skills { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .cg .cg-skill { display: flex; align-items: center; gap: 8px; min-height: 44px; margin: 0; padding: 0 12px; border-radius: 10px; background: var(--bubble); box-shadow: inset 0 0 0 1px var(--line); color: var(--text); font-size: 14px; cursor: pointer; }
  .cg-skill input { flex: none; width: 16px; height: 16px; margin: 0; accent-color: var(--accent); }
  .cg-skill:has(input:checked) { background: rgba(230,183,90,.08); box-shadow: inset 0 0 0 1.5px var(--accent); }
  .cg-skill:has(input:disabled) { opacity: .5; cursor: default; }
  .cg-counter { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .cg-who b { display: block; font: 700 20px/1.25 var(--display); overflow-wrap: anywhere; }
  .cg-who span { font-size: 14px; color: var(--muted); }
  .cg-tiles { display: grid; gap: 6px; }
  .cg-tiles.four { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .cg-tiles.six { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .cg-tile { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; padding: 8px 2px; border-radius: 10px; background: var(--bubble); box-shadow: inset 0 0 0 1px var(--line); font-variant-numeric: tabular-nums; }
  .cg-tile small { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-size: 11px; color: var(--muted); }
  .cg-tile b { font-size: 16px; font-weight: 600; }
  .cg-tile span { font-size: 12px; color: var(--muted); }
  .cg-row { display: flex; flex-direction: column; gap: 4px; }
  .cg-row > span { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  .cg-row > div { display: flex; flex-wrap: wrap; gap: 4px 6px; font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
  .cg-tag { padding: 1px 8px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .cg-tag.on { color: var(--text); box-shadow: inset 0 0 0 1px rgba(230,183,90,.55); }
  .cg-foot { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; flex: none; margin-top: 16px; padding: 12px 0; background: var(--panel); }
  .cg-foot .btn[hidden] { display: none; }
  .cg-foot .btn { white-space: nowrap; }
  .cg-err, .cg-note { flex: 1 1 100%; font-size: 13px; }
  .cg-err { color: var(--error); }
  .cg-note { color: var(--muted); }
  .cg-err:empty, .cg-note:empty { display: none; }
  @media (max-width: 520px) {
    .cg-grid { grid-template-columns: minmax(0, 1fr); }
    .cg-opt .pic { height: 80px; }
    .cg-foot .btn { flex: 1; height: 44px; }
    .cg-foot [data-next] { flex: 2; }
  }
`;

export const CHARGEN_JS = String.raw`
function tavernusChargen(root, o) {
  var C = o.options;
  var DEATH = {
    casual: { name: 'Casual', text: C.death_text.casual, pic: '/assets/muerte-casual.jpg' },
    hardcore: { name: 'Hardcore', text: C.death_text.hardcore, pic: '/assets/muerte-hardcore.jpg' }
  };
  var HINT = {};
  C.steps.forEach(function (x) { HINT[x.id] = x; });
  function fromCatalog(id, extra) { return { id: id, title: HINT[id].title, lead: HINT[id].hint + (extra || '') }; }
  function step(base, paint, check) { base.paint = paint; base.check = check; return base; }
  var STEPS = [
    { id: 'name', title: 'Nombre', lead: 'Cómo te van a llamar.', paint: paintName, check: function () { var n = cleanName(); return n.length < 2 || n.length > 24 ? 'El nombre debe tener entre 2 y 24 caracteres.' : ''; } },
    step(fromCatalog('race'), paintRace, function () { return s.race ? '' : 'Elige una raza.'; }),
    step(fromCatalog('class'), paintClass, function () { return s.klass ? '' : 'Elige una clase.'; }),
    step(fromCatalog('background'), paintBackground, function () { return s.bg ? '' : 'Elige un trasfondo.'; }),
    step(fromCatalog('abilities', ' Si eliges un valor que ya tiene otra, se intercambian.'), paintAbilities, function () { return ''; }),
    step(fromCatalog('skills'), paintSkills, function () { var n = skillCount(); return s.skills.length === n ? '' : 'Elige ' + n + ' habilidades de ' + klass().name + '.'; }),
    step(fromCatalog('death'), paintDeath, function () { return ''; }),
    { id: 'summary', title: 'Resumen', lead: 'Así entra en el mundo. Si algo no te convence, vuelve atrás.', paint: paintSummary, check: function () { return ''; } }
  ];
  var s = { name: '', look: '', hook: '', race: null, klass: null, bg: null, bgTouched: false, ab: null, abTouched: false, skills: [], death: 'casual' };
  var at = 0, ready = false, previewAsk = 0;

  root.innerHTML = '<div class="cg-head"><span class="cg-count"></span><div class="cg-bar"><i></i></div></div>' +
    '<div class="cg-body"><h3 tabindex="-1"></h3><p class="cg-lead"></p><div class="cg-fields"></div></div>' +
    '<div class="cg-foot"><span class="cg-note"></span><span class="cg-err" role="alert"></span><button type="button" class="btn ghost" data-back>Atrás</button><button type="button" class="btn primary" data-next>Siguiente</button></div>';
  var q = function (sel) { return root.querySelector(sel); };
  var fields = q('.cg-fields'), errBox = q('.cg-err'), noteBox = q('.cg-note'), backBtn = q('[data-back]'), nextBtn = q('[data-next]');

  function esc(t) { return String(t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function by(list, id) { return list.filter(function (x) { return x.id === id; })[0]; }
  function el(html) { var d = document.createElement('div'); d.innerHTML = html; return d.firstChild; }
  function signed(n) { return (n >= 0 ? '+' : '') + n; }
  function cleanName() { return s.name.trim().replace(/\s+/g, ' '); }
  function race() { return by(C.races, s.race); }
  function klass() { return by(C.classes, s.klass); }
  function background() { return by(C.backgrounds, s.bg); }
  function listEs(xs) { return xs.length < 2 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]; }
  function recommended() { var a = {}, k = klass(); C.abilities.forEach(function (x, i) { a[x.id] = k.recommended[i]; }); return a; }

  // Lo que depende de otra elección se rehace al cambiarla: nunca queda una combinación que el servidor vaya a rechazar.
  function fixedSkills() {
    var out = [];
    (background() ? background().skills : []).concat(race() ? race().skills : []).forEach(function (k) { if (out.indexOf(k) < 0) out.push(k); });
    return out;
  }
  function skillOptions() { var f = fixedSkills(); return klass() ? klass().skill_from.filter(function (k) { return f.indexOf(k) < 0; }) : []; }
  function skillCount() { return Math.min(klass().skill_count, skillOptions().length); }
  function pruneSkills() { var op = skillOptions(); s.skills = s.skills.filter(function (k) { return op.indexOf(k) >= 0; }); }

  function cards(name, list, value, pick, suggested) {
    var box = el('<div class="cg-grid" role="radiogroup"></div>');
    list.forEach(function (x) {
      var l = el('<label class="cg-opt"><input type="radio" name="cg-' + name + '" value="' + esc(x.id) + '"' + (x.id === value ? ' checked' : '') + '>' +
        (x.pic ? '<span class="pic" style="background-image:url(' + x.pic + ')"></span>' : '') +
        '<b>' + esc(x.name) + (x.id === suggested ? '<em>Sugerido</em>' : '') + '</b><small>' + esc(x.description) + '</small></label>');
      l.querySelector('input').addEventListener('change', function () { pick(x.id); errBox.textContent = ''; });
      box.appendChild(l);
    });
    fields.appendChild(box);
  }
  function textField(label, value, max, placeholder, set) {
    var l = el('<label class="cg-field"><span>' + esc(label) + '</span><input type="text" maxlength="' + max + '" autocomplete="off" placeholder="' + esc(placeholder) + '"></label>');
    var i = l.querySelector('input'); i.value = value;
    i.addEventListener('input', function () { set(i.value); errBox.textContent = ''; });
    fields.appendChild(l);
    return i;
  }

  function paintName() {
    var first = textField('Nombre', s.name, 24, 'Aren', function (v) { s.name = v; });
    textField('Cómo se ve · opcional; de aquí sale su retrato', s.look, 300, 'Pelo cobrizo trenzado, cicatriz en la ceja', function (v) { s.look = v; });
    if (o.showHook()) textField('¿Qué le trae aquí? · opcional; si lo dejas vacío, el mundo se lo inventa', s.hook, 400, 'Busca a su hermano, que vino a este pueblo y no volvió', function (v) { s.hook = v; });
    return first;
  }
  function paintRace() { cards('race', C.races, s.race, function (id) { s.race = id; pruneSkills(); }); }
  function paintClass() {
    cards('class', C.classes, s.klass, function (id) {
      s.klass = id;
      if (!s.bgTouched) s.bg = klass().background;
      if (!s.abTouched) s.ab = recommended();
      pruneSkills();
    });
  }
  function paintBackground() { cards('background', C.backgrounds, s.bg, function (id) { s.bg = id; s.bgTouched = true; pruneSkills(); }, klass().background); }
  function paintAbilities() {
    var r = race(), k = klass();
    var rec = el('<div class="cg-rec"><span>Recomendado para ' + esc(k.name) + ': ' + C.abilities.map(function (a, i) { return a.short + ' ' + k.recommended[i]; }).join(' · ') + '</span><button type="button" class="btn ghost sm">Usar el recomendado</button></div>');
    rec.querySelector('button').addEventListener('click', function () { s.ab = recommended(); s.abTouched = false; fresh(); });
    fields.appendChild(rec);
    var box = el('<div class="cg-abs"><div class="cg-ab top" aria-hidden="true"><span></span><span>Valor</span><span>Raza</span><span>Total</span></div></div>');
    var rows = {};
    function fresh() {
      C.abilities.forEach(function (a) {
        var total = s.ab[a.id] + (r.ability_bonus[a.id] || 0);
        rows[a.id].sel.value = String(s.ab[a.id]);
        rows[a.id].total.textContent = total + ' (' + signed(Math.floor((total - 10) / 2)) + ')';
      });
    }
    C.abilities.forEach(function (a) {
      var bonus = r.ability_bonus[a.id] || 0;
      var row = el('<div class="cg-ab"><label for="cg-ab-' + a.id + '">' + esc(a.name) + '</label><select id="cg-ab-' + a.id + '">' +
        C.standard_array.map(function (v) { return '<option value="' + v + '">' + v + '</option>'; }).join('') +
        '</select><small>' + (bonus ? signed(bonus) : '—') + '</small><b></b></div>');
      var sel = row.querySelector('select');
      rows[a.id] = { sel: sel, total: row.querySelector('b') };
      sel.addEventListener('change', function () {
        var v = Number(sel.value), old = s.ab[a.id];
        C.abilities.forEach(function (x) { if (x.id !== a.id && s.ab[x.id] === v) s.ab[x.id] = old; });
        s.ab[a.id] = v; s.abTouched = true; fresh();
      });
      box.appendChild(row);
    });
    fields.appendChild(box);
    fresh();
  }
  function paintSkills() {
    pruneSkills();
    var n = skillCount(), fixed = fixedSkills().map(function (k) { return C.skills[k]; });
    q('.cg-lead').textContent = 'Ya tienes ' + (listEs(fixed) || 'ninguna fija') + '. Elige ' + n + ' más de ' + klass().name + ':';
    var box = el('<div class="cg-skills" role="group" aria-label="Habilidades de clase"></div>');
    var counter = el('<span class="cg-counter" aria-live="polite"></span>');
    function fresh() {
      counter.textContent = 'Elegidas: ' + s.skills.length + ' de ' + n;
      box.querySelectorAll('input').forEach(function (i) { i.disabled = !i.checked && s.skills.length >= n; });
    }
    skillOptions().forEach(function (k) {
      var l = el('<label class="cg-skill"><input type="checkbox" value="' + esc(k) + '"' + (s.skills.indexOf(k) >= 0 ? ' checked' : '') + '><span>' + esc(C.skills[k]) + '</span></label>');
      var i = l.querySelector('input');
      i.addEventListener('change', function () {
        if (i.checked) s.skills.push(k); else s.skills = s.skills.filter(function (x) { return x !== k; });
        errBox.textContent = ''; fresh();
      });
      box.appendChild(l);
    });
    fields.appendChild(box); fields.appendChild(counter);
    fresh();
  }
  function paintDeath() {
    cards('death', ['casual', 'hardcore'].map(function (id) { return { id: id, name: DEATH[id].name, description: DEATH[id].text, pic: DEATH[id].pic }; }), s.death, function (id) { s.death = id; });
  }
  function paintSummary() {
    var ask = ++previewAsk;
    ready = false; nextBtn.disabled = true;
    fields.innerHTML = '<p class="cg-lead">Calculando la hoja…</p>';
    fetch(o.previewUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()) })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        if (ask !== previewAsk) return;
        if (!r.ok) {
          // Lo rechaza el servidor (p. ej. ese nombre ya está cogido): de vuelta al paso que toca.
          var back = STEPS.map(function (x) { return x.id; }).indexOf(r.field);
          if (back >= 0) { go(back); errBox.textContent = r.text; } else { fields.innerHTML = ''; errBox.textContent = r.text; }
          return;
        }
        drawSheet(r.preview);
        ready = true; nextBtn.disabled = false;
      })
      .catch(function () { if (ask === previewAsk) { fields.innerHTML = ''; errBox.textContent = 'No hay conexión con el servidor.'; } });
  }
  function tile(label, value, extra) { return '<div class="cg-tile"><small>' + esc(label) + '</small><b>' + esc(value) + '</b>' + (extra ? '<span>' + esc(extra) + '</span>' : '') + '</div>'; }
  function row(label, inner) { return '<div class="cg-row"><span>' + esc(label) + '</span><div>' + inner + '</div></div>'; }
  function drawSheet(p) {
    var look = s.look.trim(), hook = o.showHook() ? s.hook.trim() : '';
    fields.innerHTML =
      '<div class="cg-who"><b>' + esc(p.name) + '</b><span>' + esc(p.race + ' · ' + p.class_name + ' · ' + p.background) + (p.darkvision ? ' · ve en la oscuridad' : '') + '</span></div>' +
      '<div class="cg-tiles four">' + tile('PG', p.hp_max) + tile('CA', p.ac) + tile('Velocidad', p.speed_ft + ' ft') + tile('Percepción', p.passive_perception) + '</div>' +
      '<div class="cg-tiles six">' + p.abilities.map(function (a) { return tile(a.short, a.total, signed(a.modifier)); }).join('') + '</div>' +
      row('Salvaciones', p.saves.map(function (x) { return '<span class="cg-tag' + (x.proficient ? ' on' : '') + '">' + esc(x.name) + ' ' + signed(x.modifier) + '</span>'; }).join('')) +
      row('Habilidades', p.skills.map(function (x) { return '<span class="cg-tag on">' + esc(x.name) + ' ' + signed(x.modifier) + '</span>'; }).join('')) +
      row('Equipo inicial', '<span>' + esc(p.equipment.map(function (e) { return e.name + (e.quantity > 1 ? ' ×' + e.quantity : ''); }).join(', ')) + '</span>') +
      row('Si muere', '<span>' + esc(DEATH[p.death_mode].name + '. ' + DEATH[p.death_mode].text) + '</span>') +
      (look ? row('Cómo se ve', '<span>' + esc(look) + '</span>') : '') +
      (hook ? row('Qué le trae aquí', '<span>' + esc(hook) + '</span>') : '');
    if (o.summaryExtra) fields.appendChild(o.summaryExtra);
    var again = el('<div><button type="button" class="btn ghost sm">Empezar de nuevo</button></div>');
    again.querySelector('button').addEventListener('click', function () {
      s.race = s.klass = s.bg = s.ab = null; s.bgTouched = s.abTouched = false; s.skills = []; s.death = 'casual';
      go(1);
    });
    fields.appendChild(again);
  }

  function payload() {
    var out = { name: cleanName(), race: s.race, class: s.klass, background: s.bg, abilities: s.ab, skills: s.skills, death_mode: s.death, appearance: s.look.trim() };
    if (o.showHook()) out.hook = s.hook.trim();
    return out;
  }

  function go(i) {
    at = i;
    var now = STEPS[at];
    q('.cg-count').textContent = 'Paso ' + (at + 1) + ' de ' + STEPS.length + ' · ' + now.title;
    q('.cg-bar i').style.width = ((at + 1) / STEPS.length * 100) + '%';
    q('h3').textContent = now.title;
    q('.cg-lead').textContent = now.lead;
    errBox.textContent = ''; noteBox.textContent = '';
    fields.innerHTML = '';
    backBtn.hidden = at === 0 && !o.onBack;
    backBtn.disabled = false;
    nextBtn.disabled = false;
    nextBtn.textContent = now.id === 'summary' ? o.confirmLabel : 'Siguiente';
    previewAsk++;
    var focus = now.paint() || q('h3');
    q('.cg-body').scrollTop = 0;
    if (root.getBoundingClientRect().top < 0) window.scrollTo(0, 0);
    focus.focus();
  }
  function confirm() {
    if (!ready) return;
    errBox.textContent = '';
    var label = nextBtn.textContent;
    nextBtn.disabled = backBtn.disabled = true;
    o.onConfirm(payload(), {
      busy: function (text, note) { if (text) nextBtn.textContent = text; noteBox.textContent = note || ''; },
      fail: function (text) { errBox.textContent = text; noteBox.textContent = ''; nextBtn.textContent = label; nextBtn.disabled = backBtn.disabled = false; }
    });
  }
  function next() {
    var now = STEPS[at];
    if (now.id === 'summary') { confirm(); return; }
    var bad = now.check();
    if (bad) { errBox.textContent = bad; return; }
    go(at + 1);
  }
  nextBtn.addEventListener('click', next);
  backBtn.addEventListener('click', function () { if (at > 0) go(at - 1); else if (o.onBack) o.onBack(); });
  root.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && (ev.target.type === 'text' || ev.target.type === 'radio')) { ev.preventDefault(); next(); }
  });
  return { open: function () { go(at); } };
}
`;
