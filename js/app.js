// The page: the gallery of models, and the player that folds one step at a time.

import { MODELS } from './models.js';
import { build } from './build.js';
import { poses, marks, symbol, corners } from './motion.js';
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
// Another tab, or the installed copy beside a tab, can save meanwhile, so what's saved is read again before a change
// goes on top of it: that tab's paper, Slow and places stay. With nothing saved, or no way to save, prefs stays as it is.
function latest() {
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage blocked */ }
  if (saved !== null) Object.assign(prefs, load());
  return prefs;
}
// Saves one change: { paper }, { slow } or { progress: { [model]: step } }.
function save(change) {
  latest();
  if (change.progress) Object.assign(prefs.progress, change.progress);
  else Object.assign(prefs, change);
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
      // Only words in a button, no headings or paragraphs (a button holds phrasing content only), shown as blocks.
      btn.innerHTML = `
        <span class="thumb"></span>
        <span class="title">${m.name}</span>
        <span class="meta"><span class="level">${m.level}</span><span class="count"></span></span>
        <span class="blurb">${m.blurb}</span>`;
      btn.addEventListener('click', () => openFromHome(m.id));
      li.append(btn);
      list.append(li);
    }
  }
  paintHome();
}

function pickPaper(id) {
  save({ paper: id });
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
const P = { b: null, id: null, i: 0, t: 0, playing: false, holding: false, clock: 0, t0: 0, pace: 1, waiting: false };
const HOLD = 850; // how long the marks show on the paper before Play moves it
const pace = () => (prefs.slow ? 2.2 : 1); // Slow gives the marks and the fold a little over twice as long

// How long a step's fold takes at the pace it was started at (P.pace).
function duration(step) {
  const k = step.motion.kind;
  const base = k === 'mech' ? 3400 : k === 'reverse' ? 2800 : k === 'foldUnfold' ? 2600 : k === 'turnOver' ? 1900 : k === 'turn' ? 1300 : 2100;
  return base * P.pace;
}

// A model is folded the first time it's opened, which takes a slow phone most of a second for the crane or the frog. So
// the player shows at once with all that needs no folding (the name, the step and its words, and the ticks) and the
// paper still to come on the mat, and the folding waits until that has been drawn. Meanwhile the keys and buttons do
// nothing (P.waiting), and going anywhere else drops it. A model opened before shows at once, folded.
let opening = 0; // counts the models opened, so only the latest goes on to be shown once it's folded
function openModel(id, i = null, { landed = false } = {}) {
  const m = MODELS.find((x) => x.id === id);
  if (!m) { location.hash = ''; return; }
  const ticket = ++opening;
  show('player');
  if (builtCache.has(id)) { ready(m, i, landed); return; }
  outline(m, i);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (ticket === opening && !$('player').hidden) ready(m, i, landed);
  }));
}

// The player before its model is folded.
function outline(m, i) {
  P.waiting = true;
  P.playing = false;
  const n = m.steps.length;
  const k = Math.max(0, Math.min(i ?? (latest().progress[m.id] || 0), n - 1));
  $('modelName').textContent = m.name;
  $('stepCount').textContent = `Step ${k + 1} of ${n}`;
  $('chip').textContent = '\u00a0'; // the step's symbol and name come with the fold; till then, the line is kept
  $('say').textContent = m.steps[k].say;
  words.scrollTop = 0;
  fadeWords();
  renderSteps(m.steps);
  $('ticks').children[k].firstChild.setAttribute('aria-current', 'step');
  $('stepList').children[k].firstChild.setAttribute('aria-current', 'step');
  [...$('ticks').children].forEach((li, j) => li.firstChild.classList.toggle('done', j < k));
  unavailable($('prev'), k === 0);
  unavailable($('next'), k === n - 1);
  $('prev').setAttribute('aria-label', 'Previous step');
  $('prev').title = 'Previous step (←)';
  playButton('Play', PLAY);
  scrubAt(0);
  $('speed').setAttribute('aria-pressed', prefs.slow);
  $('glWait').hidden = false;
  document.title = `${m.name} · Fold by Fold`;
}

// The player with its model folded, at step i (or where you got to), from its start or with its fold landed.
function ready(m, i, landed) {
  const id = m.id;
  P.waiting = false;
  $('glWait').hidden = true;
  if (!view) {
    try {
      view = new View($('gl'));
      matFromPage();
      wireCamera();
      // The stage changes size with the words beside or under it, not only with the window.
      if ('ResizeObserver' in window) new ResizeObserver(redraw).observe($('gl'));
      // A phone can take the 3D away from a page and give it back a moment later. If it doesn't come back, the
      // stage would be a blank box, so say what to do, with a button to do it: a copy installed on a phone has no
      // reload of its own. The address names the step, so a reload comes back to it. Meanwhile the buttons that turn
      // the view go, and a fold playing stops where it is rather than running on out of sight.
      let lost = 0;
      const turning = (on) => { $('topView').hidden = $('resetView').hidden = !on; };
      $('gl').addEventListener('webglcontextlost', () => {
        if (P.playing) pause();
        clearTimeout(lost);
        lost = setTimeout(() => {
          const words = document.createElement('span');
          words.textContent = 'The 3D view stopped. Reload the page to bring the paper back.';
          const reload = document.createElement('button');
          reload.type = 'button';
          reload.className = 'reload';
          reload.textContent = 'Reload';
          reload.addEventListener('click', () => location.reload());
          $('glError').replaceChildren(words, reload);
          $('glError').hidden = false;
          turning(false);
        }, 3000);
      });
      $('gl').addEventListener('webglcontextrestored', () => { clearTimeout(lost); $('glError').hidden = true; turning(true); redraw(); }); // after the view has rebuilt
    } catch {
      // No 3D here: say so and put away what only works in 3D. The words, slider and buttons still work.
      $('glError').hidden = false;
      for (const id of ['hint', 'topView', 'resetView']) $(id).hidden = true;
      $('gl').removeAttribute('tabindex'); // nothing there to turn
    }
  }
  if (view) {
    view.setPaper(paperColor(), BACK);
    // Each model starts seen from the usual angle, not from wherever the last one was turned and zoomed to (from
    // underneath, the first step of the next showed only the back of the paper). Within a model the view holds from
    // step to step.
    Object.assign(view.cam, { yaw: -90, pitch: 58 });
    view.goal.yaw = view.goal.pitch = null;
    view.zoom = 1;
    view.pan = [0, 0];
  }
  aimedFor = null;
  P.b = built(id);
  P.id = id;
  $('modelName').textContent = m.name;
  renderSteps(P.b.steps);
  // A link's step becomes where you got to only in a model you haven't started. In one you have, your place stays
  // until you move on from the link's step yourself.
  const place = latest().progress[id] || 0;
  const link = i !== null && place > 0;
  go(i ?? Math.min(place, P.b.steps.length - 1), { snap: true, keep: !link });
  if (landed) { P.t = 1; keepAim(); paint(); frameCamera(true); }
  document.title = `${m.name} · Fold by Fold`;
}

// The ticks and the list of steps. Before the model is folded a step's name may not be known yet (it can come from its
// fold), so its tick is called by its number alone.
function renderSteps(steps) {
  shown = null; // new lists, so the step is marked in them afresh
  const ticks = $('ticks'), list = $('stepList');
  ticks.innerHTML = '';
  list.innerHTML = '';
  steps.forEach((s, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1; // Tab stops only at the step's own tick (see paint)
    b.setAttribute('aria-label', s.name ? `Step ${i + 1}: ${s.name}` : `Step ${i + 1}`);
    b.addEventListener('click', () => go(i));
    li.append(b);
    ticks.append(li);
    const li2 = document.createElement('li');
    const b2 = document.createElement('button');
    b2.type = 'button';
    // The number is drawn by the list itself, which a screen reader doesn't hear, so it's said here too.
    const n = document.createElement('span');
    n.className = 'sr';
    n.textContent = `Step ${i + 1}: `;
    b2.append(n, s.say);
    b2.addEventListener('click', () => go(i));
    li2.append(b2);
    list.append(li2);
  });
  roomForWords(steps);
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
}

function go(i, { play = false, snap = false, keep = true } = {}) {
  if (P.waiting) return;
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
  const was = latest().progress[P.id]; // another tab may have gone further meanwhile
  if (was === i || (further && was > i)) return;
  save({ progress: { [P.id]: i } });
}
// The place for the fold as it is: the step after once this one's fold has landed, except on the last step.
const placeNow = () => (P.t >= 1 && P.i < P.b.steps.length - 1 ? P.i + 1 : P.i);

function start() {
  keepPlace();
  if (P.t >= 1) P.t = 0;
  aimFor(P.b.steps[P.i]);
  P.playing = true;
  P.holding = P.t === 0;
  P.pace = pace();
  P.clock = performance.now();
  P.t0 = P.t;
  paint();
}

function pause() {
  P.playing = false;
  paint();
}

function primary() {
  if (P.waiting) return;
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
  if (P.waiting) return;
  const step = P.b.steps[P.i];
  const n = P.b.steps.length;
  paintControls();
  if (step !== shown) {
    shown = step;
    $('stepCount').textContent = `Step ${P.i + 1} of ${n}`;
    $('chip').innerHTML = chipFor(step);
    $('say').textContent = step.say;
    tell();
    words.scrollTop = 0; // a new step's words start at the top
    fadeWords();
    // Tab stops at the step's tick only, the way it does at the chosen paper colour, rather than at every one of the
    // frog's 34. A tick that has the focus hands it on to the step's tick, so a key pressed next acts on the step
    // you're on: after the arrow keys or Next, or a finger sliding along the bar.
    const handOn = $('ticks').contains(document.activeElement);
    document.querySelectorAll('#ticks button').forEach((b, k) => {
      b.tabIndex = k === P.i ? 0 : -1;
      if (k === P.i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
      if (k === P.i && handOn) b.focus({ preventScroll: true });
    });
    const list = $('stepList');
    [...list.children].forEach((li, k) => {
      if (k === P.i) li.firstChild.setAttribute('aria-current', 'step'); else li.firstChild.removeAttribute('aria-current');
    });
    // The list keeps the step in its middle, so the steps after it show too. Only where the list is shown (beside the
    // paper on a wide screen): elsewhere it would cost a layout for nothing. The list scrolls itself, since scrolling
    // the step into view could scroll the page as well, and in Chrome it moves where the next Tab goes.
    if (list.offsetParent) {
      const b = list.children[P.i].getBoundingClientRect(), l = list.getBoundingClientRect();
      list.scrollTop += (b.top + b.bottom) / 2 - (l.top + list.clientTop + list.clientHeight / 2);
    }
  }
  const last = P.i === n - 1;
  unavailable($('next'), last);
  let label = 'Play', icon = PLAY;
  if (P.playing) { label = 'Pause'; icon = '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>'; }
  else if (P.t >= 1) {
    label = last ? 'Start again' : 'Next fold';
    // The arrow going round is an open line, so it's drawn as one rather than filled in like the others.
    icon = last
      ? '<path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<path d="M5 4.5v15l10-7.5zM17 5h2.5v14H17z"/>';
  } else if (P.t > 0) label = 'Carry on';
  playButton(label, icon);
  scrubAt(P.t);
  $('speed').setAttribute('aria-pressed', prefs.slow);
  nameInAddress();
  document.querySelectorAll('#ticks button').forEach((b, k) => b.classList.toggle('done', k < P.i || (k === P.i && P.t >= 1)));
  redraw();
}

const PLAY = '<path d="M7 4.5v15l12.5-7.5z"/>';
function playButton(label, icon) {
  if ($('playLabel').textContent === label) return;
  $('playLabel').textContent = label;
  $('playIcon').innerHTML = icon;
  $('play').title = `${label} (Space)`; // the buttons with a key of their own say so under a mouse
}

// A screen reader is told the step you land on, with its number, once the step has stayed put for a moment: a finger
// sliding along the ticks passes many steps a second, and each one's words would be queued up to be read. The slider
// and a fold playing say nothing; the slider says how far the fold has gone itself.
let tellTimer = 0;
function tell() {
  clearTimeout(tellTimer);
  tellTimer = setTimeout(() => {
    if ($('player').hidden || P.waiting) return;
    $('tell').textContent = `Step ${P.i + 1} of ${P.b.steps.length}. ${P.b.steps[P.i].say}`;
  }, 400);
}

// The back button takes a fold that has moved back to its start, and otherwise goes to the step before. Kept up to
// date as a fold plays, too: on step 1 it comes on as soon as the paper moves.
function paintControls() {
  const prev = $('prev');
  unavailable(prev, P.i === 0 && P.t === 0);
  const label = P.t > 0.02 ? 'Replay this fold' : 'Previous step';
  if (prev.getAttribute('aria-label') !== label) { prev.setAttribute('aria-label', label); prev.title = `${label} (←)`; }
}

// The slider says how far the fold has gone, for screen readers, rather than a number out of 1000.
function scrubAt(t) {
  const s = $('scrub');
  s.value = Math.round(t * 1000);
  const say = t <= 0 ? 'Not started' : t >= 1 ? 'Folded' : `${Math.min(99, Math.max(1, Math.round(t * 100)))}% folded`;
  if (s.getAttribute('aria-valuetext') !== say) s.setAttribute('aria-valuetext', say);
}

// Next on the last step and the back button at the very start say they're unavailable and do nothing, but they're not
// turned off: a button turned off loses the focus, and pressing Enter on Next through a model lost your place at its end.
function unavailable(b, off) {
  if ((b.getAttribute('aria-disabled') === 'true') !== off) b.setAttribute('aria-disabled', off);
}
const isOff = (b) => b.getAttribute('aria-disabled') === 'true';

// Words that run past their box on a short screen fade out at the bottom until they're scrolled to the end. Only words
// count, not the empty lines kept under a step of few words.
const words = document.querySelector('.step-now');
const wordsEnd = document.createRange();
function fadeWords() {
  wordsEnd.selectNodeContents($('say'));
  words.classList.toggle('more', wordsEnd.getBoundingClientRect().bottom > words.getBoundingClientRect().bottom + 2);
}
words.addEventListener('scroll', fadeWords, { passive: true });

// Under the paper, the words' box keeps one height through a model: that of its longest words, so the paper above
// doesn't grow and shrink from step to step (by up to 80 px on the crane), jumping and then settling as the camera
// eased to its new size. Every step's words are measured at once, in a hidden copy of the box at its width, again
// when that width changes or the fonts arrive, and the box's height is set from the longest (css/app.css uses it
// only where the words are under the paper).
const gauge = document.createElement('div');
gauge.className = 'say-gauge';
gauge.setAttribute('aria-hidden', 'true');
words.parentElement.append(gauge);
let gaugeFor = null, gaugeWidth = 0; // the steps measured, and the box's width then
function roomForWords(steps = gaugeFor) {
  gaugeFor = steps;
  const say = $('say'), width = say.clientWidth;
  if (!steps || !width) return; // out of sight: measured once it shows
  gaugeWidth = width;
  gauge.style.width = `${width}px`;
  gauge.replaceChildren(...steps.map((s) => {
    const p = document.createElement('p');
    p.className = 'say';
    p.textContent = s.say;
    return p;
  }));
  const longest = Math.max(...[...gauge.children].map((p) => p.getBoundingClientRect().height));
  gauge.replaceChildren();
  const above = say.getBoundingClientRect().top - words.getBoundingClientRect().top + words.scrollTop; // the chip, and the gap under it
  words.style.setProperty('--words', `${Math.ceil(above + longest)}px`);
}
if ('ResizeObserver' in window) {
  new ResizeObserver(() => { fadeWords(); if ($('say').clientWidth !== gaugeWidth) roomForWords(); }).observe(words);
}
document.fonts?.addEventListener?.('loadingdone', () => roomForWords());

// The step's symbol beside its name, drawn as the key under the gallery draws it. Screen readers hear the name only.
const CHIP = {
  valley: '<svg viewBox="0 0 34 12" aria-hidden="true"><path d="M1 6H33" stroke-dasharray="5 3.5"/></svg>',
  mountain: '<svg viewBox="0 0 34 12" aria-hidden="true"><path d="M1 6H33" stroke-dasharray="5 2.5 .5 2.5"/></svg>',
  both: '<svg viewBox="0 0 34 12" aria-hidden="true"><path d="M1 3H33" stroke-dasharray="5 3.5"/><path d="M1 9H33" stroke-dasharray="5 2.5 .5 2.5"/></svg>',
  turnOver: '<svg viewBox="0 0 34 12" aria-hidden="true"><path d="M5 9C5 2 29 2 29 9"/><path d="M25 6l4 3 3-4"/></svg>',
  rotate: '<svg viewBox="0 0 34 12" aria-hidden="true"><path d="M20.7 2.9A4.8 4.8 0 1 0 21.5 7.6"/><path d="M23.1 9.7L22 6.1l-3.1 2.1"/></svg>',
  unfold: '<svg viewBox="0 0 34 12" aria-hidden="true"><path d="M6 10C6 3 22 2 24 6.5"/><path class="hollow" d="M20.4 6.6l5.2 3.3.3-6.1z"/></svg>',
};
const chipFor = (step) => `${CHIP[symbol(step)]}<span>${step.name}</span>`;

// ---------- Drawing and the camera ----------

// The cutting mat in 3D is the green of the page's own mat (the gallery's pictures, and the box where the paper can't
// be drawn), which is darker in dark mode: the green brightened as a model opened. Again when the mode changes.
function matFromPage() {
  if (!view) return;
  const css = getComputedStyle(document.documentElement);
  const [mat, line] = ['--mat', '--mat-line'].map((k) => css.getPropertyValue(k).trim());
  if (![mat, line].every((c) => /^#[0-9a-f]{6}$/i.test(c))) return;
  view.setMat(mat, line);
  redraw();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', matFromPage);

// A frame is drawn only when something has changed: the page asks for the next one while a fold plays or its marks
// are up, while the camera is on its way somewhere, or after redraw(). Otherwise the browser is left alone, rather
// than waking the page for every frame (120 times a second on some phones) to find nothing to draw.
let dirty = true;
let lastFrame = 0;
let asked = 0; // the frame asked for, if one is
function redraw() {
  dirty = true;
  if (!asked) asked = requestAnimationFrame(loop);
}
// With reduced motion asked for, the camera never swings or glides on its own (to a step's own angle, between steps,
// back to the usual view or straight down): it's where it's going at once. A fold still plays at its own pace once
// Play is pressed, since that's the instruction.
const still = matchMedia('(prefers-reduced-motion: reduce)');

// Everywhere the paper goes during a step, for framing it: every corner at thirteen moments of the fold (among them a
// quarter, half and three quarters of the way, where a fold stands up, a fold and unfold stands up and a turn over is
// at its highest), and the symbol beside the model. Points a two-hundredth of the sheet apart count once. Worked out
// for a step when it's first shown, so opening a model doesn't fold through all its steps first.
const reach = new WeakMap();
function reachOf(step) {
  if (!reach.has(step)) {
    const seen = new Map();
    const add = (q) => { const k = q.map((x) => Math.round(x * 200)).join(); if (!seen.has(k)) seen.set(k, q); };
    for (let k = 0; k <= 12; k++) for (const it of poses(step, k / 12)) corners(it).forEach(add);
    for (const m of marks(step) || []) (m.path || []).forEach(add);
    reach.set(step, Float32Array.from([...seen.values()].flat()));
  }
  return reach.get(step);
}

function frameCamera(snap) {
  if (!view) return;
  const s = P.b.steps[P.i];
  const a = s.from.bounds(), b = s.to.bounds();
  let x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), y0 = Math.min(a.y0, b.y0), y1 = Math.max(a.y1, b.y1);
  // A symbol beside the model (turning it over or around) is in the picture too.
  for (const m of marks(s) || []) {
    for (const [x, y] of m.path || []) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  // A step that stands the model up says how big it gets and how high to look, once its fold moves; until then the
  // paper lies flat. Any other step is framed for the whole of its fold, not just how it starts and ends: turning
  // over stands the paper on its edge, and a fold behind lifts the model to make room under it. The camera looks at
  // half the height the paper reaches, from the usual angle, so turning the paper round doesn't change its size.
  const v = aimedFor === s ? s.view : null;
  const size = Math.max(x1 - x0, y1 - y0, v?.size || 0, 0.55);
  const box = [x0, y0, x1, y1];
  if (s.view) view.frame((x0 + x1) / 2, (y0 + y1) / 2, size, v?.lift || 0, { box });
  else {
    const pts = reachOf(s);
    let top = 0;
    for (let k = 2; k < pts.length; k += 3) top = Math.max(top, pts[k]);
    view.frame((x0 + x1) / 2, (y0 + y1) / 2, size, top / 2, { box, fit: { pts, yaw: -90, pitch: 58 } });
  }
  if (snap) view.settle(1);
  redraw();
}

function loop(now) {
  asked = 0;
  if (!P.b || P.waiting || $('player').hidden) { lastFrame = 0; return; }
  const dt = Math.min(0.1, (now - (lastFrame || now)) / 1000);
  lastFrame = now;
  const more = () => { if (!asked) asked = requestAnimationFrame(loop); };
  const step = P.b.steps[P.i];
  if (P.playing) {
    if (P.holding) {
      if (now - P.clock >= HOLD * P.pace) { P.holding = false; P.clock = now; }
    } else {
      P.t = Math.min(1, P.t0 + (now - P.clock) / duration(step));
      scrubAt(P.t);
      if (P.t >= 1) { P.playing = false; keepPlace(placeNow()); paint(); } else paintControls();
    }
    dirty = true;
    if (P.playing) more();
  }
  if (!view) return; // no 3D: the fold's time still runs for the words and slider, with nothing to draw
  if (!view.settle(still.matches ? 1 : 1 - Math.pow(0.001, dt))) { dirty = true; more(); }
  if (!asked) lastFrame = 0; // the next frame, whenever it comes, starts the camera's easing afresh
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
  // One finger turns the paper once it has moved 8 px, and from there on, so a finger that only rests or taps leaves it
  // where it is (a mouse turns it at once). After a pinch, the finger still down as the other lifts doesn't turn it at
  // all, however it drifts, until both are off: each pinch ended with the view a little twisted.
  let from = null; // where a lone finger went down, until it has moved far enough to turn the paper
  let multi = false; // two fingers have been down since none were
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { pinch = spread(); multi = true; }
    pointer = e.pointerType;
    tap = pointer !== 'mouse' && pts.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    from = pointer !== 'mouse' && pts.size === 1 ? [e.clientX, e.clientY] : null;
  });
  c.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const [x, y] = pts.get(e.pointerId);
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) >= 10) tap = null;
    if (pts.size === 1 && from) {
      if (Math.hypot(e.clientX - from[0], e.clientY - from[1]) >= 8) from = null; // far enough: it turns from here on
    } else if (pts.size === 1 && !multi) {
      if (e.clientX !== x || e.clientY !== y) view.goal.yaw = view.goal.pitch = null; // a drag takes over from a turn on its way
      view.cam.yaw -= (e.clientX - x) * 0.35;
      view.cam.pitch = Math.max(-80, Math.min(89.9, view.cam.pitch + (e.clientY - y) * 0.3));
      hideHint();
    } else if (pts.size === 2) {
      // Two fingers: the view slides along the table with them, and zooms toward the point between them, so what's
      // under the fingers stays under them (the crane's head, say, rather than the middle of the model).
      const [ox, oy] = [...pts].find(([id]) => id !== e.pointerId)[1];
      const r = c.getBoundingClientRect(), mx = (e.clientX + ox) / 2 - r.left, my = (e.clientY + oy) / 2 - r.top;
      view.slide((x + ox) / 2 - r.left, (y + oy) / 2 - r.top, mx, my);
      const s = spread();
      if (pinch && s) view.zoomAt(pinch / s, mx, my);
      pinch = s;
      hideHint();
    }
    redraw();
  });
  const up = (e) => { pts.delete(e.pointerId); pinch = pts.size === 2 ? spread() : 0; if (!pts.size) multi = false; };
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
  // The wheel zooms toward the point under the cursor.
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    view.zoomAt(Math.exp(e.deltaY * 0.0012), e.clientX - r.left, e.clientY - r.top);
    redraw();
  }, { passive: false });
  c.addEventListener('dblclick', () => { if (pointer === 'mouse') resetView(); });
  // From the keyboard, with the paper in focus: the arrow keys turn it the way a drag does, a little at a time, and +
  // and - zoom. Meanwhile they don't step through the model (see the page's keys).
  c.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const turn = { ArrowLeft: [15, 0], ArrowRight: [-15, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[e.key];
    const zoom = { '+': 0.8, '=': 0.8, '-': 1.25 }[e.key];
    if (!turn && !zoom) return;
    e.preventDefault();
    if (turn) {
      const { cam, goal } = view;
      view.aim((goal.yaw ?? cam.yaw) + turn[0], Math.max(-80, Math.min(89.9, (goal.pitch ?? cam.pitch) + turn[1])));
    } else view.zoomBy(zoom);
    hideHint();
    redraw();
  });
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

// Back to the usual view, or to the step's own once its fold has moved, unzoomed and with the model in the middle.
function resetView() {
  if (!view || P.waiting) return;
  const step = P.b.steps[P.i];
  view.zoom = 1;
  view.pan = [0, 0];
  if (step.view && P.t > 0) aimFor(step);
  else { view.aim(-90, 58); if (aimedFor) { aimedFor = null; frameCamera(false); } }
  redraw();
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

// The address names the step you're on (#crane-12), so copying it or sharing it from the browser sends that step. The
// first step is just #crane while it's where you got to; a bare name opens at your place, so once that's further on
// (after step 1's fold lands, or starting again from the end) it's #crane-1, and a reload stays on step 1. The address
// is rewritten in place once the step has settled for a moment: sliding along the ticks passes many steps a second, and
// browsers limit how often a page may rewrite its address (Safari throws after 100 times in 30 seconds). The page's
// history also notes whether the step's fold had landed, so a reload, or a phone reopening the tab, shows it folded as
// you left it rather than asking for that fold again; a copied address opens the step from its start. In a frame the
// address is left alone.
let addressed = null; // the address as the page last opened or wrote it
let addressTimer = 0;
function nameInAddress() {
  if (framed) return;
  clearTimeout(addressTimer);
  addressTimer = setTimeout(() => {
    if ($('player').hidden || P.waiting || location.hash !== addressed) return; // gone somewhere else meanwhile
    const hash = '#' + P.id + (P.i || prefs.progress[P.id] > 0 ? '-' + (P.i + 1) : '');
    const landed = P.t >= 1;
    if (hash === addressed && !!history.state?.landed === landed) return;
    try {
      history.replaceState({ ...history.state, landed }, '', hash);
      addressed = hash;
    } catch { /* rewritten too often: the next step catches it up */ }
  }, 300);
}

// A model opened from the gallery (a card, or Forward back to it) puts the focus on its name, so a screen reader says
// where you are and Tab goes on from the top of the player. Otherwise the focus would fall to the page as the gallery
// hides. A page opened at a model, from a link or a reload, leaves the focus where the browser puts it.
let routed = false;
function route() {
  addressed = location.hash;
  const lost = routed && (!document.activeElement || document.activeElement === document.body || $('home').contains(document.activeElement));
  routed = true;
  let h = '';
  try { h = decodeURIComponent(location.hash.slice(1)); } catch { /* a link mangled on the way: the gallery */ }
  const m = /^([a-z-]+?)(?:-(\d+))?$/.exec(h);
  if (m && MODELS.some((x) => x.id === m[1])) {
    openModel(m[1], m[2] ? +m[2] - 1 : null, { landed: !!m[2] && history.state?.landed === true });
    if (lost && !$('player').hidden) $('modelName').focus({ preventScroll: true });
  } else {
    opening++; // a model still being folded isn't shown
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
// The back button, and the ← key: a fold that has moved goes back to its start, and from there to the step before. On
// step 1 there's no step before, so a fold that has only just moved goes back to its start too.
function stepBack() {
  if (P.waiting) return;
  if (P.t > 0.02 || (P.i === 0 && P.t > 0)) { P.t = 0; P.playing = false; paint(); } else if (P.i > 0) go(P.i - 1);
}
$('prev').addEventListener('click', () => { if (!isOff($('prev'))) stepBack(); });
$('next').addEventListener('click', () => { if (!isOff($('next'))) go(P.i + 1, { play: true }); });
$('speed').addEventListener('click', () => {
  save({ slow: !prefs.slow });
  $('speed').setAttribute('aria-pressed', prefs.slow);
  if (P.playing) {
    if (!P.holding) { P.t0 = P.t; P.clock = performance.now(); }
    P.pace = pace();
  }
  paint();
});
// What another tab saves shows here too: the paper and places in the gallery, and Slow. A fold playing keeps its pace
// until it next starts, and a model open keeps its paper.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  latest();
  if (!$('home').hidden) paintHome();
  $('speed').setAttribute('aria-pressed', prefs.slow);
});
function scrubTo(v) {
  if (P.waiting) { scrubAt(0); return; }
  P.t = v / 1000;
  P.playing = false;
  keepPlace(placeNow());
  keepAim();
  paint();
}
$('scrub').addEventListener('input', (e) => scrubTo(e.target.value));
// The slider's own arrow keys move it one of its thousand steps, too little to see: here they move the fold a twentieth
// of the way, to the next twentieth. Page Up and Page Down (a tenth), Home and End are the slider's own, and Space plays
// and pauses, as it does anywhere in the player.
$('scrub').addEventListener('keydown', (e) => {
  const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
  if (!by || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const v = Number(e.target.value);
  scrubTo(Math.max(0, Math.min(1000, (by > 0 ? Math.floor(v / 50) + 1 : Math.ceil(v / 50) - 1) * 50)));
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
$('topView').addEventListener('click', () => { if (view) { view.aim(-90, 89.9); redraw(); } });
$('resetView').addEventListener('click', resetView);
// Most browsers give a button the focus when it's clicked, and Space would then press it again: after Next, it went
// on another step instead of pausing. So a mouse or a finger doesn't leave the focus on the player's buttons, and
// takes it off whatever had it, the way a click does; Space is then Play and Pause. The keyboard's focus is as it was.
// The same goes for the paper, so after a drag the arrow keys step through the model again rather than turning it.
$('player').addEventListener('mousedown', (e) => {
  if (!e.target.closest('button, canvas')) return;
  e.preventDefault();
  if (e.currentTarget.contains(document.activeElement)) document.activeElement.blur();
});
document.addEventListener('keydown', (e) => {
  // With Alt, Ctrl or Cmd held the keys are the browser's (Alt+← is Back).
  // A key the paper or the slider has used already is theirs (the arrow keys turn the paper in focus).
  if ($('player').hidden || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return;
  if (e.key === 'Escape') { $('back').click(); return; } // back to the gallery, as the back arrow goes
  if (P.waiting) return; // the model is still being folded
  const onSlider = e.target.closest('input'); // the slider moves itself with the arrow keys
  if (e.key === ' ') {
    if (e.target.closest('button')) return; // a button with focus presses itself
    e.preventDefault();
    primary();
  } else if (e.key === 'ArrowRight' && !onSlider) {
    if (P.i < P.b.steps.length - 1) go(P.i + 1, { play: true });
  } else if (e.key === 'ArrowLeft' && !onSlider) stepBack();
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
window.addEventListener('resize', redraw);

// A hook for the tests and screenshot scripts. index.html also looks for it, to tell that the page has started.
window.fold = {
  get state() { return { id: P.id, i: P.i, t: P.t, playing: P.playing, steps: P.b ? P.b.steps.length : 0 }; },
  set(i, t) { P.i = i; P.t = t; P.playing = false; keepAim(); paint(); frameCamera(true); },
  view: () => view,
  get built() { return [...builtCache.keys()]; }, // the models folded so far
};

$('boot')?.remove(); // the line saying the page is on its way (see index.html)
route();

if (!('single' in document.documentElement.dataset) && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
