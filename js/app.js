// The page: the gallery of models, and the player that folds one step at a time.

import { MODELS } from './models.js';
import { build } from './build.js';
import { poses, marks, symbol } from './motion.js';
import { View } from './render.js';
import { picture } from './thumbs.js';
import { FINISHED } from './finished.js';

const KEY = 'fold-by-fold.v1';
const $ = (id) => document.getElementById(id);

export const PAPERS = [
  { id: 'vermilion', name: 'Vermilion', color: '#d9412b' },
  { id: 'indigo', name: 'Indigo', color: '#2f4f8f' },
  { id: 'leaf', name: 'Leaf green', color: '#3f8a57' },
  { id: 'marigold', name: 'Marigold', color: '#e3a034' },
  { id: 'sakura', name: 'Cherry blossom', color: '#e3899f' },
  { id: 'violet', name: 'Violet', color: '#6b4c9a' },
];
const BACK = '#f3eee3';

// ---------- Saving ----------

// What was saved, keeping only what the page can use, so a damaged or hand-edited save falls back to the
// defaults instead of breaking the player.
function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch { /* nothing readable saved */ }
  const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  if (!plain(saved)) saved = {};
  const progress = {};
  if (plain(saved.progress)) {
    for (const [id, i] of Object.entries(saved.progress)) if (Number.isInteger(i) && i >= 0) progress[id] = i;
  }
  return {
    ...saved,
    paper: PAPERS.some((p) => p.id === saved.paper) ? saved.paper : 'vermilion',
    slow: saved.slow === true,
    progress,
  };
}
const prefs = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private window */ }
}
const paperColor = () => (PAPERS.find((p) => p.id === prefs.paper) || PAPERS[0]).color;

// ---------- Home ----------

// A model is folded when it's opened. The gallery doesn't fold any: the pictures of the finished models were
// worked out ahead of time (js/finished.js), and a model's steps are as many as its list says.
const builtCache = new Map();
function built(id) {
  if (!builtCache.has(id)) builtCache.set(id, build(MODELS.find((m) => m.id === id)));
  return builtCache.get(id);
}

// The swatches and cards are made once; after that, choosing a paper only updates them, so the swatch you
// chose keeps the focus.
function renderHome() {
  const sw = $('swatches');
  if (!sw.childElementCount) {
    for (const p of PAPERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.paper = p.id;
      b.style.setProperty('--c', p.color);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', p.name);
      b.title = p.name;
      b.addEventListener('click', () => pickPaper(p.id));
      sw.append(b);
    }
    // Like any set of radio buttons: the arrow keys move along the colours, and Tab stops at the chosen one.
    sw.addEventListener('keydown', (e) => {
      const by = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!by) return;
      e.preventDefault();
      const k = PAPERS.findIndex((p) => p.id === (e.target.dataset.paper || prefs.paper));
      const next = PAPERS[(k + by + PAPERS.length) % PAPERS.length];
      pickPaper(next.id);
      sw.querySelector(`[data-paper="${next.id}"]`).focus();
    });
  }
  const list = $('models');
  if (!list.childElementCount) {
    for (const m of MODELS) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'model';
      btn.dataset.model = m.id;
      btn.innerHTML = `
        <span class="thumb"></span>
        <h3>${m.name}</h3>
        <p class="meta"><span class="level">${m.level}</span><span class="count"></span></p>
        <p class="blurb">${m.blurb}</p>`;
      btn.addEventListener('click', () => openFromHome(m.id));
      li.append(btn);
      list.append(li);
    }
  }
  paintHome();
}

function pickPaper(id) {
  prefs.paper = id;
  save();
  paintHome();
}

// Shows where you got to in each model, and the chosen paper: on the swatches, and in the pictures of the finished
// models. A model you've begun says which step you're on in place of how many steps it has; on its last step, that
// you've reached it, not that it's folded.
let thumbsIn = null;
function paintHome() {
  for (const card of document.querySelectorAll('#models .model')) {
    const n = MODELS.find((m) => m.id === card.dataset.model).steps.length;
    const i = Math.min(prefs.progress[card.dataset.model] || 0, n - 1);
    card.querySelector('.count').textContent = i > 0 ? `Step ${i + 1} of ${n}` : `${n} steps`;
  }
  for (const b of $('swatches').children) {
    const on = b.dataset.paper === prefs.paper;
    b.setAttribute('aria-checked', on);
    b.tabIndex = on ? 0 : -1;
  }
  if (thumbsIn === paperColor()) return;
  thumbsIn = paperColor();
  // The card's own words say what the model is, so the picture goes unlabelled and screen readers skip it.
  for (const card of document.querySelectorAll('#models .model')) {
    card.querySelector('.thumb').innerHTML = picture(FINISHED[card.dataset.model], { front: thumbsIn, back: BACK });
  }
}

// ---------- Player ----------

let view = null;
const P = { b: null, id: null, i: 0, t: 0, playing: false, holding: false, clock: 0, t0: 0 };
const HOLD = 850; // how long the marks show on the paper before Play moves it
const pace = () => (prefs.slow ? 2.2 : 1); // Slow gives the marks and the fold a little over twice as long

function duration(step) {
  const k = step.motion.kind;
  const base = k === 'mech' ? 3400 : k === 'reverse' ? 2800 : k === 'foldUnfold' ? 2600 : k === 'turnOver' ? 1900 : k === 'turn' ? 1300 : 2100;
  return base * pace();
}

function openModel(id, i = null) {
  const m = MODELS.find((x) => x.id === id);
  if (!m) { location.hash = ''; return; }
  show('player');
  if (!view) {
    try {
      view = new View($('gl'));
      wireCamera();
      // A phone can take the 3D away from a page and give it back a moment later. If it doesn't come back, the
      // stage would be a blank box, so say what to do. A fold playing stops where it is rather than running on out
      // of sight.
      let lost = 0;
      $('gl').addEventListener('webglcontextlost', () => {
        if (P.playing) pause();
        clearTimeout(lost);
        lost = setTimeout(() => { $('glError').textContent = 'The 3D view stopped. Reload the page to bring the paper back.'; $('glError').hidden = false; }, 3000);
      });
      $('gl').addEventListener('webglcontextrestored', () => { clearTimeout(lost); $('glError').hidden = true; dirty = true; }); // after the view has rebuilt
    } catch {
      // No 3D here: say so and put away what only works in 3D. The words, slider and buttons still work.
      $('glError').hidden = false;
      for (const id of ['hint', 'topView', 'resetView']) $(id).hidden = true;
    }
  }
  if (view) view.setPaper(paperColor(), BACK);
  P.b = built(id);
  P.id = id;
  $('modelName').textContent = m.name;
  renderSteps();
  // A link's step becomes where you got to only in a model you haven't started. In one you have, your place stays
  // until you move on from the link's step yourself.
  const link = i !== null && prefs.progress[id] > 0;
  go(i ?? Math.min(prefs.progress[id] || 0, P.b.steps.length - 1), { snap: true, keep: !link });
  document.title = `${m.name} · Fold by Fold`;
}

function renderSteps() {
  shown = null; // new lists, so the step is marked in them afresh
  const ticks = $('ticks'), list = $('stepList');
  ticks.innerHTML = '';
  list.innerHTML = '';
  P.b.steps.forEach((s, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Step ${i + 1}: ${s.name}`);
    b.addEventListener('click', () => go(i));
    li.append(b);
    ticks.append(li);
    const li2 = document.createElement('li');
    const b2 = document.createElement('button');
    b2.type = 'button';
    b2.textContent = s.say;
    b2.addEventListener('click', () => go(i));
    li2.append(b2);
    list.append(li2);
  });
}

// On a phone the bar of ticks is the way to jump to a step, but they're narrow (the frog's 34 share about 360 px),
// so a finger can slide along the bar and the step under it is picked as it goes, the way the slider under the
// words works. A finger picks once it moves along the bar, or as it lifts after a tap: one going up or down is
// swiping somewhere else, so until then it picks nothing. A mouse picks as soon as it's pressed. The ticks are
// still buttons, for the keyboard and screen readers.
let sliding = null;
function slideTo(x, first) {
  const ticks = [...$('ticks').children];
  const mid = (li) => { const r = li.getBoundingClientRect(); return (r.left + r.right) / 2; };
  const i = ticks.reduce((best, li, k) => (Math.abs(x - mid(li)) < Math.abs(x - mid(ticks[best])) ? k : best), 0);
  if (!first && i === P.i) return;
  go(i);
  // A tick that had the focus hands it on, so a key pressed next acts on the step picked, not the one first touched.
  if ($('ticks').contains(document.activeElement)) ticks[i].firstChild.focus({ preventScroll: true });
}

function go(i, { play = false, snap = false, keep = true } = {}) {
  P.i = Math.max(0, Math.min(i, P.b.steps.length - 1));
  P.t = 0;
  P.playing = false;
  if (keep) keepPlace(P.i, { further: true });
  if (play) start();
  else keepAim();
  paint();
  frameCamera(snap);
}

// Some steps look best from a particular angle once they move (a finished plane from the side, say), however the
// fold gets going: Play, or the slider. Before that the paper still lies flat, so the usual view is the right one,
// and a step's angle never carries over into another step or model. The camera turns only when the step changes
// or its fold first moves, never while the slider is being dragged on from there.
let aimedFor = null;
function aimFor(step) {
  if (!view) return;
  if (step.view) { view.aim(step.view.yaw, step.view.pitch); aimedFor = step; frameCamera(false); }
  else if (aimedFor) { view.aim(-90, 58); aimedFor = null; frameCamera(false); }
}
function keepAim() {
  const step = P.b.steps[P.i];
  if (aimedFor && aimedFor !== step) { view.aim(-90, 58); aimedFor = null; }
  if (P.t > 0 && step.view && aimedFor !== step) aimFor(step);
}

// Saves where you got to in this model. Folding a step makes it your place (Play, or the slider), and once its fold
// lands, the step after, so coming back starts from the paper as it now is. Just going to a step saves it only if it's
// further on: looking back at an earlier one keeps your place.
function keepPlace(i = P.i, { further = false } = {}) {
  const was = prefs.progress[P.id];
  if (was === i || (further && was > i)) return;
  prefs.progress[P.id] = i;
  save();
}
// The place for the fold as it is: the step after once this one's fold has landed, except on the last step.
const placeNow = () => (P.t >= 1 && P.i < P.b.steps.length - 1 ? P.i + 1 : P.i);

function start() {
  keepPlace();
  if (P.t >= 1) P.t = 0;
  aimFor(P.b.steps[P.i]);
  P.playing = true;
  P.holding = P.t === 0;
  P.clock = performance.now();
  P.t0 = P.t;
  paint();
}

function pause() {
  P.playing = false;
  paint();
}

function primary() {
  const last = P.i === P.b.steps.length - 1;
  // While the marks are still up before the fold moves, nothing seems to have happened yet, so a second press starts
  // the fold now. Pausing there would have stopped it before it began.
  if (P.playing && P.holding) { P.holding = false; P.clock = performance.now(); P.t0 = P.t; paint(); }
  else if (P.playing) pause();
  else if (P.t >= 1) { if (last) go(0); else go(P.i + 1, { play: true }); }
  else start();
}

// Shows the step and where its fold is. The slider calls this on every move, so what only changes with the step
// (its words, its place in the lists) is redone only when the step does.
let shown = null; // the step whose words are up
function paint() {
  const step = P.b.steps[P.i];
  const n = P.b.steps.length;
  paintControls();
  if (step !== shown) {
    shown = step;
    $('stepCount').textContent = `Step ${P.i + 1} of ${n}`;
    $('chip').innerHTML = chipFor(step);
    $('say').textContent = step.say;
    words.scrollTop = 0; // a new step's words start at the top
    fadeWords();
    document.querySelectorAll('#ticks button').forEach((b, k) => {
      if (k === P.i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    const list = $('stepList');
    [...list.children].forEach((li, k) => {
      if (k === P.i) li.firstChild.setAttribute('aria-current', 'step'); else li.firstChild.removeAttribute('aria-current');
    });
    // Only where the list is shown (beside the paper on a wide screen): elsewhere it would cost a layout for nothing.
    if (list.offsetParent) list.children[P.i].firstChild.scrollIntoView({ block: 'nearest' });
  }
  $('next').disabled = P.i === n - 1;
  const last = P.i === n - 1;
  let label = 'Play', icon = '<path d="M7 4.5v15l12.5-7.5z"/>';
  if (P.playing) { label = 'Pause'; icon = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'; }
  else if (P.t >= 1) {
    label = last ? 'Start again' : 'Next fold';
    // The arrow going round is an open line, so it's drawn as one rather than filled in like the others.
    icon = last
      ? '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M5 4.5v15l10-7.5zM17 5h2.5v14H17z"/>';
  } else if (P.t > 0) label = 'Carry on';
  if ($('playLabel').textContent !== label) {
    $('playLabel').textContent = label;
    $('playIcon').innerHTML = icon;
  }
  $('scrub').value = Math.round(P.t * 1000);
  $('speed').setAttribute('aria-pressed', prefs.slow);
  document.querySelectorAll('#ticks button').forEach((b, k) => b.classList.toggle('done', k < P.i || (k === P.i && P.t >= 1)));
  dirty = true;
}

// The back button takes a fold that has moved back to its start, and otherwise goes to the step before. Kept up to
// date as a fold plays, too: on step 1 it comes on as soon as the paper moves.
function paintControls() {
  const prev = $('prev');
  prev.disabled = P.i === 0 && P.t === 0;
  const label = P.t > 0.02 ? 'Replay this fold' : 'Previous step';
  if (prev.title !== label) { prev.title = label; prev.setAttribute('aria-label', label); }
}

// Words that run past their box on a short screen fade out at the bottom until they're scrolled to the end.
const words = document.querySelector('.step-now');
function fadeWords() {
  words.classList.toggle('more', words.scrollTop + words.clientHeight < words.scrollHeight - 2);
}
words.addEventListener('scroll', fadeWords, { passive: true });
if ('ResizeObserver' in window) new ResizeObserver(fadeWords).observe(words);

// The step's symbol beside its name, drawn as the key under the gallery draws it.
const CHIP = {
  valley: '<svg viewBox="0 0 34 12"><path d="M1 6H33" stroke-dasharray="5 3.5"/></svg>',
  mountain: '<svg viewBox="0 0 34 12"><path d="M1 6H33" stroke-dasharray="5 2.5 .5 2.5"/></svg>',
  both: '<svg viewBox="0 0 34 12"><path d="M1 3H33" stroke-dasharray="5 3.5"/><path d="M1 9H33" stroke-dasharray="5 2.5 .5 2.5"/></svg>',
  turnOver: '<svg viewBox="0 0 34 12"><path d="M5 9C5 2 29 2 29 9"/><path d="M25 6l4 3 3-4"/></svg>',
  rotate: '<svg viewBox="0 0 34 12"><path d="M20.7 2.9A4.8 4.8 0 1 0 21.5 7.6"/><path d="M23.1 9.7L22 6.1l-3.1 2.1"/></svg>',
  unfold: '<svg viewBox="0 0 34 12"><path d="M6 10C6 3 22 2 24 6.5"/><path class="hollow" d="M20.4 6.6l5.2 3.3.3-6.1z"/></svg>',
};
const chipFor = (step) => `${CHIP[symbol(step)]}<span>${step.name}</span>`;

// ---------- Drawing and the camera ----------

let dirty = true;
let lastFrame = 0;

function frameCamera(snap) {
  if (!view) return;
  const s = P.b.steps[P.i];
  const a = s.from.bounds(), b = s.to.bounds();
  let x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), y0 = Math.min(a.y0, b.y0), y1 = Math.max(a.y1, b.y1);
  // A symbol beside the model (turning it over or around) is in the picture too.
  for (const m of marks(s) || []) {
    for (const [x, y] of m.path || []) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  // A step that stands the model up says how big it gets and how high to look.
  const v = aimedFor === s ? s.view : null;
  view.frame((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0, v?.size || 0, 0.55), v?.lift || 0);
  if (snap) view.settle(1);
  dirty = true;
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!P.b || $('player').hidden) return;
  const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  const step = P.b.steps[P.i];
  if (P.playing) {
    if (P.holding) {
      if (now - P.clock >= HOLD * pace()) { P.holding = false; P.clock = now; }
    } else {
      P.t = Math.min(1, P.t0 + (now - P.clock) / duration(step));
      $('scrub').value = Math.round(P.t * 1000);
      if (P.t >= 1) { P.playing = false; keepPlace(placeNow()); paint(); } else paintControls();
    }
    dirty = true;
  }
  if (!view) return; // no 3D: the fold's time still runs for the words and slider, with nothing to draw
  const settled = view.settle(1 - Math.pow(0.001, dt));
  if (!settled) dirty = true;
  if (!dirty) return;
  dirty = false;
  const alpha = P.t <= 0 ? 1 : Math.max(0, 1 - P.t * 5);
  view.show(poses(step, P.t), marks(step), alpha);
  view.draw();
}

function wireCamera() {
  const c = $('gl');
  const pts = new Map();
  let pinch = 0;
  const hint = $('hint');
  const hideHint = () => hint.classList.add('gone');
  setTimeout(hideHint, 7000);
  // A double tap puts the view back. It's picked out here from the taps themselves, since phones don't all report
  // a double tap to the page; a double click is left to the mouse. A tap is one finger that hardly moves.
  let tap = null, lastTap = null, pointer = 'mouse';
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) pinch = spread();
    pointer = e.pointerType;
    tap = pointer !== 'mouse' && pts.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  });
  c.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const [x, y] = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) >= 10) tap = null;
    if (pts.size === 1) {
      if (e.clientX !== x || e.clientY !== y) view.goal.yaw = view.goal.pitch = null; // a drag takes over from a turn on its way
      view.cam.yaw -= (e.clientX - x) * 0.35;
      view.cam.pitch = Math.max(-80, Math.min(89.9, view.cam.pitch + (e.clientY - y) * 0.3));
      hideHint();
    } else if (pts.size === 2) {
      const s = spread();
      if (pinch && s) view.zoomBy(pinch / s);
      pinch = s;
    }
    dirty = true;
  });
  const up = (e) => { pts.delete(e.pointerId); pinch = pts.size === 2 ? spread() : 0; };
  c.addEventListener('pointerup', (e) => {
    up(e);
    if (tap?.id !== e.pointerId) { if (pointer !== 'mouse') lastTap = null; return; }
    if (lastTap && e.timeStamp - lastTap.t < 300 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < 24) {
      resetView();
      lastTap = null;
    } else lastTap = { t: e.timeStamp, x: tap.x, y: tap.y };
    tap = null;
  });
  c.addEventListener('pointercancel', (e) => { up(e); tap = lastTap = null; });
  c.addEventListener('wheel', (e) => { e.preventDefault(); view.zoomBy(Math.exp(e.deltaY * 0.0012)); dirty = true; }, { passive: false });
  c.addEventListener('dblclick', () => { if (pointer === 'mouse') resetView(); });
  // The paper takes pinches for its own zoom. If the page itself has been zoomed in (by a pinch on the words, say),
  // a pinch on the paper zooms the page back out instead, since the paper may be most of what's on screen.
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', () => { c.style.touchAction = visualViewport.scale > 1.01 ? 'pinch-zoom' : ''; });
  }
  function spread() {
    const [a, b] = [...pts.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
}

// Back to the usual view, or to the step's own once its fold has moved.
function resetView() {
  if (!view) return;
  const step = P.b.steps[P.i];
  view.zoom = 1;
  if (step.view && P.t > 0) aimFor(step);
  else { view.aim(-90, 58); if (aimedFor) { aimedFor = null; frameCamera(false); } }
  dirty = true;
}

// ---------- Screens and wiring ----------

// The player starts at the top; the gallery comes back scrolled to where you left it, with the focus on the card
// you opened. If the phone was turned in between, the cards have moved, so it comes back to that card instead.
let homeY = 0;
let opened = null; // the card opened from the gallery, and how wide the screen was then
function show(id) {
  if (id !== 'home' && !$('home').hidden) homeY = window.scrollY;
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  keepAwake(id !== 'home');
  if (id !== 'home') { window.scrollTo(0, 0); return; }
  const card = opened && document.querySelector(`#models .model[data-model="${opened.id}"]`);
  if (card && opened.width !== innerWidth) card.scrollIntoView({ block: 'center' });
  else window.scrollTo(0, homeY);
  card?.focus({ preventScroll: true });
  opened = null;
}

// Folding along leaves long gaps between taps, with paper in both hands, so while a model is open the screen stays on,
// until ten minutes after the last touch or key: a phone left open still goes to sleep. The browser lets go whenever
// the page is out of sight, so it's asked again when the page is back. Where there's no way to keep it on, or the
// browser says no, the screen sleeps as usual.
const AWAKE = 10 * 60 * 1000;
let awake = null; // the lock keeping the screen on, or the promise of one
let awakeTimer = 0;
function keepAwake(on) {
  if (!('wakeLock' in navigator)) return;
  clearTimeout(awakeTimer);
  if (!on) {
    const was = awake;
    awake = null;
    Promise.resolve(was).then((lock) => lock?.release()).catch(() => {});
    return;
  }
  awakeTimer = setTimeout(() => keepAwake(false), AWAKE);
  if (awake || document.visibilityState !== 'visible') return;
  const asked = awake = (async () => {
    const lock = await navigator.wakeLock.request('screen');
    if (awake !== asked) { lock.release().catch(() => {}); return null; } // let go of while it was being asked for
    awake = lock;
    lock.addEventListener('release', () => { if (awake === lock) awake = null; });
    return lock;
  })().catch(() => { if (awake === asked) awake = null; return null; });
}
$('player').addEventListener('pointerdown', () => keepAwake(true), { passive: true });
document.addEventListener('keydown', () => { if (!$('player').hidden) keepAwake(true); });

// In a frame on another page (a viewer showing the single-file copy, say) the address may not be the page's own
// to rewrite, and going back can take the frame somewhere else entirely, so there a card and the back arrow just
// set the #part, as they always did.
const framed = window.self !== window.top;

function route() {
  let h = '';
  try { h = decodeURIComponent(location.hash.slice(1)); } catch { /* a link mangled on the way: the gallery */ }
  const m = /^([a-z-]+?)(?:-(\d+))?$/.exec(h);
  if (m && MODELS.some((x) => x.id === m[1])) {
    openModel(m[1], m[2] ? +m[2] - 1 : null);
    // A link to a step opens it once; after that the address is the model's, so a reload picks up where
    // you got to instead of going back to the link's step.
    if (m[2] && !framed) history.replaceState(history.state, '', '#' + m[1]);
  } else {
    renderHome(); // first, so the cards are there to scroll back to
    show('home');
    document.title = 'Fold by Fold';
  }
}

function openFromHome(id) {
  opened = { id, width: innerWidth };
  if (framed) { location.hash = id; return; }
  history.pushState({ from: 'home' }, '', '#' + id);
  route();
}

// Opened from the gallery, the back arrow goes back to it the way the browser's Back does, so Back from
// the gallery then leaves instead of reopening the model. Opened from a link, it shows the gallery in place.
$('back').addEventListener('click', () => {
  if (framed) location.hash = '';
  else if (history.state?.from === 'home') history.back();
  else { history.replaceState(null, '', location.pathname + location.search); route(); }
});
// Down to the key of marks. It's a button, not a #link: on this page an address after # opens a model.
$('toKey').addEventListener('click', () => {
  const key = $('symbolsTitle');
  key.parentElement.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  key.focus({ preventScroll: true });
});
$('play').addEventListener('click', primary);
$('prev').addEventListener('click', () => {
  if (P.t > 0.02) { P.t = 0; P.playing = false; paint(); } else go(P.i - 1);
});
$('next').addEventListener('click', () => go(P.i + 1, { play: true }));
$('speed').addEventListener('click', () => {
  prefs.slow = !prefs.slow;
  save();
  if (P.playing && !P.holding) { P.t0 = P.t; P.clock = performance.now(); }
  paint();
});
$('scrub').addEventListener('input', (e) => {
  P.t = e.target.value / 1000;
  P.playing = false;
  keepPlace(placeNow());
  keepAim();
  paint();
});
$('ticks').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return; // a right click, say
  sliding = { id: e.pointerId, x: e.clientX, y: e.clientY, along: e.pointerType === 'mouse' };
  $('ticks').setPointerCapture(e.pointerId);
  if (sliding.along) slideTo(e.clientX, true);
});
$('ticks').addEventListener('pointermove', (e) => {
  if (e.pointerId !== sliding?.id) return;
  const first = !sliding.along;
  if (first && Math.abs(e.clientX - sliding.x) <= Math.abs(e.clientY - sliding.y)) return; // not along the bar yet
  sliding.along = true;
  slideTo(e.clientX, first);
});
$('ticks').addEventListener('pointerup', (e) => {
  if (e.pointerId !== sliding?.id) return;
  if (!sliding.along) slideTo(e.clientX, true); // a tap
  sliding = null;
});
// The browser has taken the finger for scrolling.
$('ticks').addEventListener('pointercancel', (e) => { if (e.pointerId === sliding?.id) sliding = null; });
$('topView').addEventListener('click', () => { if (view) { view.aim(-90, 89.9); dirty = true; } });
$('resetView').addEventListener('click', resetView);
// Most browsers give a button the focus when it's clicked, and Space would then press it again: after Next, it went
// on another step instead of pausing. So a mouse or a finger doesn't leave the focus on the player's buttons, and
// takes it off whatever had it, the way a click does; Space is then Play and Pause. The keyboard's focus is as it was.
$('player').addEventListener('mousedown', (e) => {
  if (!e.target.closest('button')) return;
  e.preventDefault();
  if (e.currentTarget.contains(document.activeElement)) document.activeElement.blur();
});
document.addEventListener('keydown', (e) => {
  // With Alt, Ctrl or Cmd held the keys are the browser's (Alt+← is Back).
  if ($('player').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
  const onSlider = e.target.closest('input'); // the slider moves itself with the arrow keys
  if (e.key === ' ') {
    if (e.target.closest('button')) return; // a button with focus presses itself
    e.preventDefault();
    primary();
  } else if (e.key === 'ArrowRight' && !onSlider) {
    if (P.i < P.b.steps.length - 1) go(P.i + 1, { play: true });
  } else if (e.key === 'ArrowLeft' && !onSlider) go(P.i - 1);
});
window.addEventListener('hashchange', route);
// A fold runs by the clock, and nothing is drawn while the page is out of sight, so locking the phone or switching to
// another app mid-fold brought you back to it already over. It pauses instead, to carry on from where it was. Back in
// sight with a model open, the screen is kept on again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { if (P.playing) pause(); }
  else if (!$('player').hidden) keepAwake(true);
});
// Safari on an iPhone shows a button as pressed (:active) under a finger only once the page listens for touches.
document.addEventListener('touchstart', () => {}, { passive: true });
window.addEventListener('resize', () => { dirty = true; });

// A hook for the tests and screenshot scripts.
window.fold = {
  get state() { return { id: P.id, i: P.i, t: P.t, playing: P.playing, steps: P.b ? P.b.steps.length : 0 }; },
  set(i, t) { P.i = i; P.t = t; P.playing = false; keepAim(); paint(); frameCamera(true); },
  view: () => view,
  get built() { return [...builtCache.keys()]; }, // the models folded so far
};

route();
requestAnimationFrame(loop);

if (!('single' in document.documentElement.dataset) && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
