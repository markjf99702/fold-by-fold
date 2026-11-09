// A step drawn flat, the way a printed diagram draws it, for printing a model's steps (app.js): the paper from above as
// the step starts, in the gallery's own flat drawing of a folded sheet (thumbs.js), with the step's marks over it in the
// same frame. The marks are the player's own (motion.js): a dashed line for a valley fold and dashes and dots for a
// mountain fold, each arrow's arc as it looks from straight above, with the head the player gives it, and the symbols
// for turning the model over and around, on the table beside it. They keep one weight from drawing to drawing, as a
// book's do, however big the paper is drawn: their sizes below are in the drawing's 100 x 100 box, not on the paper.

import { outline, framing } from './thumbs.js';
import { arrowPath } from './motion.js';

const LINE = 0.75; // a fold line's width
const DASH = { valley: '3.4 2', mountain: '3.4 1.3 .7 1.3' };
const SHAFT = 0.9; // an arrow's width
const HALO = 0.9; // the white each mark has round it, so it reads on the paper and on its edges
const OUTLINE = 0.55; // a hollow arrowhead's ink
const EDGE = 0.4; // the paper's edges and creases

// The SVG for a step: its paper as it starts (front: the paper's colour, back: its white side), and its marks, as
// motion.js marks() gives them. Everything fits in the box, with a little room round it. The step's words say what it
// shows, so screen readers skip it.
export function diagram(step, marks, { front = '#eea79e', back = '#ffffff', ink = '#1d1b18', edge = '#4a443c', pad = 0.06 } = {}) {
  const sheet = step.from;
  const list = marks || [];
  // The frame takes in the marks too: a symbol beside the model, an arrow's arc past its edge.
  const b = { ...sheet.bounds() };
  const take = ([x, y]) => { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); };
  const arcs = list.map((m) => (m.path ? m.path : m.arrow ? arrowPath(m.arrow) : null));
  for (const m of list) (m.line || []).forEach(take);
  arcs.forEach((a) => a?.forEach(take));
  b.cx = (b.x0 + b.x1) / 2;
  b.cy = (b.y0 + b.y1) / 2;
  const at = framing(b, pad), pt = (q) => at(q).map(f).join(',');
  const paper = outline(sheet, pad, b).map(([up, points]) =>
    `<polygon points="${points}" fill="${up ? front : back}" stroke="${edge}" stroke-width="${EDGE}" stroke-linejoin="round"/>`);
  // All the lines first, as the player draws them, so no line's white cuts across another fold's arrow.
  const lines = list.filter((m) => m.line && !m.unfold).map((m) => {
    const d = `M${pt(m.line[0])}L${pt(m.line[1])}`;
    return `<path class="halo" d="${d}" stroke="#fff" stroke-width="${LINE + 2 * HALO}" stroke-linecap="round"/>`
      + `<path class="line ${m.type}" d="${d}" stroke="${ink}" stroke-width="${LINE}" stroke-dasharray="${DASH[m.type]}"/>`;
  });
  const arrows = list.map((m, i) => (arcs[i] ? arrow(arcs[i].map(at), m, ink) : '')).filter(Boolean);
  return `<svg viewBox="0 0 100 100" aria-hidden="true"><g>${paper.join('')}</g><g fill="none">${lines.join('')}${arrows.join('')}</g></svg>`;
}

// An arrow along points p (in the box), or a symbol beside the model, with its head (and, for a fold and unfold, an
// unfolding head at its tail too). A short arrow is drawn finer, so its head doesn't swamp it, as the player does.
function arrow(p, m, ink) {
  const n = p.length - 1;
  const kind = m.path ? m.type : 'arrow';
  const r = m.path ? Infinity : Math.hypot(p[n][0] - p[0][0], p[n][1] - p[0][1]) / 2;
  const k = Math.max(0.5, Math.min(1, r / 9));
  const a = m.arrow || {};
  // A tuck's arrow breaks where it goes in under the edge of the pocket.
  const runs = [[]];
  p.forEach((q, i) => {
    if (a.tuck && i / n > 0.64 && i / n < 0.76) { if (runs.at(-1).length) runs.push([]); return; }
    runs.at(-1).push(q);
  });
  const d = runs.filter((s) => s.length > 1).map((s) => `M${s.map(([x, y]) => `${f(x)},${f(y)}`).join('L')}`).join('');
  const mid = [(p[0][0] + p[n][0]) / 2, (p[0][1] + p[n][1]) / 2];
  const heads = [head(p[n], unit(p[n], p[n - 2]), a.head || 'valley', mid, k)];
  if (a.back) heads.push(head(p[0], unit(p[0], p[2]), 'unfold', mid, k));
  const w = SHAFT * k;
  const halo = `<path class="halo" d="${d}" stroke="#fff" stroke-width="${w + 2 * HALO}" stroke-linecap="round" stroke-linejoin="round"/>`
    + heads.map((h) => `<polygon class="halo" points="${h.points}" fill="#fff" stroke="#fff" stroke-width="${2 * HALO}" stroke-linejoin="round"/>`).join('');
  const shaft = `<path class="shaft" d="${d}" stroke="${ink}" stroke-width="${w}" stroke-linejoin="round"/>`;
  const tips = heads.map((h) => (h.hollow
    ? `<polygon class="head ${h.kind}" points="${h.points}" fill="#fff" stroke="${ink}" stroke-width="${OUTLINE * k}" stroke-linejoin="miter"/>`
    : `<polygon class="head ${h.kind}" points="${h.points}" fill="${ink}"/>`)).join('');
  return `<g class="${kind}">${halo}${shaft}${tips}</g>`;
}

const f = (x) => x.toFixed(2);
const unit = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

// An arrowhead at point b of a path heading along t, in the box: 'valley' a solid head; 'mountain' a hollow head on one
// side only, the outside of the curve, with the shaft running on to its point; 'unfold' a hollow head on both sides.
function head(b, t, kind, mid, k) {
  let s = [-t[1], t[0]], shape;
  if (kind === 'mountain') {
    if (s[0] * (b[0] - mid[0]) + s[1] * (b[1] - mid[1]) < 0) s = [-s[0], -s[1]];
    const L = 5.4 * k, H = 3 * k, w = (SHAFT * k) / 2;
    shape = [[0.6 * L, -w], [-0.4 * L, H], [-0.4 * L, -w]];
  } else {
    const L = (kind === 'valley' ? 4.2 : 5) * k, H = (kind === 'valley' ? 2.4 : 2.7) * k;
    shape = [[0.6 * L, 0], [-0.4 * L, H], [-0.4 * L, -H]];
  }
  const points = shape.map(([x, y]) => `${f(b[0] + t[0] * x + s[0] * y)},${f(b[1] + t[1] * x + s[1] * y)}`).join(' ');
  return { kind, points, hollow: kind !== 'valley' };
}
