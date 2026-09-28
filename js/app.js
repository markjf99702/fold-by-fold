// The page: the gallery of models, and the player that folds one step at a time.

import { MODELS } from './models.js';
import { build } from './build.js';
import { poses, marks } from './motion.js';
import { View } from './render.js';
import { stateSVG } from './thumbs.js';

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

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
const saved = load();
const prefs = { paper: 'vermilion', slow: false, progress: {}, ...saved };
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private window */ }
}
const paperColor = () => (PAPERS.find((p) => p.id === prefs.paper) || PAPERS[0]).color;

// ---------- Home ----------

const builtCache = new Map();
function built(id) {
  if (!builtCache.has(id)) builtCache.set(id, build(MODELS.find((m) => m.id === id)));
  return builtCache.get(id);
}

function renderHome() {
  const sw = $('swatches');
  sw.innerHTML = '';
  for (const p of PAPERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.setProperty('--c', p.color);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', p.id === prefs.paper);
    b.setAttribute('aria-label', p.name);
    b.title = p.name;
    b.addEventListener('click', () => { prefs.paper = p.id; save(); renderHome(); });
    sw.append(b);
  }
  const list = $('models');
  list.innerHTML = '';
  for (const m of MODELS) {
    const b = built(m.id);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'model';
    btn.innerHTML = `
      <span class="thumb">${stateSVG(b.end, { front: paperColor(), back: BACK, label: `The finished ${m.name.toLowerCase()}` })}</span>
      <h3>${m.name}</h3>
      <p class="meta"><span class="level">${m.level}</span><span>${b.steps.length} steps</span></p>
      <p class="blurb">${m.blurb}</p>`;
    btn.addEventListener('click', () => { location.hash = m.id; });
    li.append(btn);
    list.append(li);
  }
}

// ---------- Player ----------

let view = null;
const P = { b: null, id: null, i: 0, t: 0, playing: false, holding: false, clock: 0, t0: 0 };
const HOLD = 850;

function duration(step) {
  const k = step.motion.kind;
  const base = k === 'mech' ? 3400 : k === 'reverse' ? 2800 : k === 'foldUnfold' ? 2600 : k === 'turnOver' ? 1900 : k === 'turn' ? 1300 : 2100;
  return base * (prefs.slow ? 2.2 : 1);
}

function openModel(id, i = null) {
  const m = MODELS.find((x) => x.id === id);
  if (!m) { location.hash = ''; return; }
  show('player');
  if (!view) {
    try {
      view = new View($('gl'));
      wireCamera();
    } catch {
      $('glError').hidden = false;
    }
  }
  if (view) view.setPaper(paperColor(), BACK);
  P.b = built(id);
  P.id = id;
  $('modelName').textContent = m.name;
  renderSteps();
  go(i ?? Math.min(prefs.progress[id] || 0, P.b.steps.length - 1), { snap: true });
  document.title = `${m.name} · Fold by Fold`;
}

function renderSteps() {
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

function go(i, { play = false, snap = false } = {}) {
  P.i = Math.max(0, Math.min(i, P.b.steps.length - 1));
  P.t = 0;
  P.playing = false;
  prefs.progress[P.id] = P.i;
  save();
  if (play) start();
  else if (!P.b.steps[P.i].view) aimFor(P.b.steps[P.i]);
  paint();
  frameCamera(snap);
}

// Some steps look best from a particular angle (a finished plane from the side, say).
let aimedFor = null;
function aimFor(step) {
  if (!view) return;
  if (step.view) { view.aim(step.view.yaw, step.view.pitch); aimedFor = step; frameCamera(false); }
  else if (aimedFor) { view.aim(-90, 58); aimedFor = null; frameCamera(false); }
}

function start() {
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
  if (P.playing) pause();
  else if (P.t >= 1) { if (last) go(0); else go(P.i + 1, { play: true }); }
  else start();
}

function paint() {
  const step = P.b.steps[P.i];
  const n = P.b.steps.length;
  $('stepCount').textContent = `Step ${P.i + 1} of ${n}`;
  $('chip').innerHTML = chipFor(step);
  $('say').textContent = step.say;
  $('prev').disabled = P.i === 0 && P.t === 0;
  $('next').disabled = P.i === n - 1;
  const last = P.i === n - 1;
  let label = 'Play', icon = 'M7 4.5v15l12.5-7.5z';
  if (P.playing) { label = 'Pause'; icon = 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z'; }
  else if (P.t >= 1) { label = last ? 'Start again' : 'Next fold'; icon = last ? 'M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5' : 'M5 4.5v15l10-7.5zM17 5h2.5v14H17z'; }
  else if (P.t > 0) label = 'Carry on';
  $('playLabel').textContent = label;
  $('playIcon').innerHTML = `<path d="${icon}"/>`;
  $('scrub').value = Math.round(P.t * 1000);
  $('speed').setAttribute('aria-pressed', prefs.slow);
  document.querySelectorAll('#ticks button').forEach((b, k) => {
    b.classList.toggle('done', k < P.i || (k === P.i && P.t >= 1));
    if (k === P.i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('#stepList button').forEach((b, k) => {
    if (k === P.i) { b.setAttribute('aria-current', 'step'); b.scrollIntoView({ block: 'nearest' }); } else b.removeAttribute('aria-current');
  });
  dirty = true;
}

const CHIP = {
  valley: '<svg viewBox="0 0 34 12"><path d="M1 6H33" stroke-dasharray="5 3.5"/></svg>',
  mountain: '<svg viewBox="0 0 34 12"><path d="M1 6H33" stroke-dasharray="5 2.5 .5 2.5"/></svg>',
  turn: '<svg viewBox="0 0 34 12"><path d="M5 9C5 2 29 2 29 9"/><path d="M25 6l4 3 3-4"/></svg>',
  both: '<svg viewBox="0 0 34 12"><path d="M1 3H33" stroke-dasharray="5 3.5"/><path d="M1 9H33" stroke-dasharray="5 2.5 .5 2.5"/></svg>',
};
function chipFor(step) {
  const m = step.motion;
  const type = m.type || (m.parts && m.parts[0].type);
  let icon = CHIP.valley;
  if (type === 'mountain') icon = CHIP.mountain;
  if (m.kind === 'turnOver' || m.kind === 'turn') icon = CHIP.turn;
  if (m.kind === 'reverse') icon = CHIP.mountain;
  if (m.kind === 'mech') icon = CHIP.both;
  return `${icon}<span>${step.name}</span>`;
}

// ---------- Drawing and the camera ----------

let dirty = true;
let lastFrame = 0;

function frameCamera(snap) {
  if (!view) return;
  const s = P.b.steps[P.i];
  const a = s.from.bounds(), b = s.to.bounds();
  const x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), y0 = Math.min(a.y0, b.y0), y1 = Math.max(a.y1, b.y1);
  // A step that stands the model up says how big it gets and how high to look.
  const v = aimedFor === s ? s.view : null;
  view.frame((x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0, v?.size || 0, 0.55), v?.lift || 0);
  if (snap) view.settle(1);
  dirty = true;
}

function loop(now) {
  requestAnimationFrame(loop);
  if (!view || !P.b || $('player').hidden) return;
  const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  const step = P.b.steps[P.i];
  if (P.playing) {
    if (P.holding) {
      if (now - P.clock >= HOLD) { P.holding = false; P.clock = now; }
    } else {
      P.t = Math.min(1, P.t0 + (now - P.clock) / duration(step));
      $('scrub').value = Math.round(P.t * 1000);
      if (P.t >= 1) { P.playing = false; paint(); }
    }
    dirty = true;
  }
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
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) pinch = spread();
  });
  c.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const [x, y] = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
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
  c.addEventListener('pointerup', up);
  c.addEventListener('pointercancel', up);
  c.addEventListener('wheel', (e) => { e.preventDefault(); view.zoomBy(Math.exp(e.deltaY * 0.0012)); dirty = true; }, { passive: false });
  c.addEventListener('dblclick', resetView);
  function spread() {
    const [a, b] = [...pts.values()];
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
}

function resetView() {
  if (!view) return;
  view.aim(-90, 58);
  view.zoom = 1;
  dirty = true;
}

// ---------- Screens and wiring ----------

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  window.scrollTo(0, 0);
}

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const m = /^([a-z-]+?)(?:-(\d+))?$/.exec(h);
  if (m && MODELS.some((x) => x.id === m[1])) openModel(m[1], m[2] ? +m[2] - 1 : null);
  else {
    show('home');
    renderHome();
    document.title = 'Fold by Fold';
  }
}

$('back').addEventListener('click', () => { location.hash = ''; });
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
  paint();
});
$('topView').addEventListener('click', () => { if (view) { view.aim(-90, 89.9); dirty = true; } });
$('resetView').addEventListener('click', resetView);
document.addEventListener('keydown', (e) => {
  if ($('player').hidden || e.target.closest('input, button')) return;
  if (e.key === ' ') { e.preventDefault(); primary(); }
  else if (e.key === 'ArrowRight') go(P.i + 1, { play: true });
  else if (e.key === 'ArrowLeft') go(P.i - 1);
});
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { dirty = true; });

// A hook for the tests and screenshot scripts.
window.fold = {
  get state() { return { id: P.id, i: P.i, t: P.t, playing: P.playing, steps: P.b ? P.b.steps.length : 0 }; },
  set(i, t) { P.i = i; P.t = t; P.playing = false; paint(); frameCamera(true); },
  view: () => view,
};

route();
requestAnimationFrame(loop);

if (!('single' in document.documentElement.dataset) && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
