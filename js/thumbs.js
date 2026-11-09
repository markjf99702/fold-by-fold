// The pictures of the finished models on the gallery's cards: each facet with its front side in the paper's color
// and its back side white, and a light edge round the sheet. A model that lies flat is seen from above, in its
// stacking order; one whose last step stands it up is seen in 3D, from where the player ends it, with the player's
// light on it.
//
// It comes in two parts so the gallery needn't fold every model to show them: finished() works out the shapes,
// which tools/make-thumbs.mjs does ahead of time for the finished models (js/finished.js), and picture() draws
// them in whichever paper is chosen. The player draws each step's result the same way, from after().

import { det, area, centroid, intersectPolys, ccw } from './geom.js';
import { poses, corners } from './motion.js';

// The shapes of a built model's finished picture: its last step's.
export function finished(b) {
  return after(b.steps[b.steps.length - 1]);
}

// The shapes of the paper as a step leaves it, for the picture beside the fold's name in the player: standing() for a
// step that stands the model up (it has a view to be seen from), outline() for one that leaves it flat.
export function after(step) {
  return step.view ? standing(poses(step, 1), step.view) : outline(step.to);
}

// The shapes, from the table up: for each facet, 1 if the front of the paper faces up (0 for the white back),
// and its corners in a 100 x 100 box.
export function outline(sheet, pad = 0.06) {
  const b = sheet.bounds();
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0) * (1 + pad * 2);
  const x0 = b.cx - size / 2, y1 = b.cy + size / 2;
  const S = 100 / size;
  const pt = ([x, y]) => `${((x - x0) * S).toFixed(2)},${((y1 - y) * S).toFixed(2)}`;
  return sheet.order.map((id) => [det(sheet.facets.get(id).m) > 0 ? 1 : 0, sheet.world(id).map(pt).join(' ')]);
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
// The player's light (render.js): above the paper, to the front and left. Paper lying flat facing up is this bright.
const LIGHT = norm3([-0.35, -0.55, 1]);
const lit = (n) => 0.6 + 0.1 * (0.5 + 0.5 * n[2]) + 0.4 * Math.max(0, dot3(n, LIGHT));
const FLAT = lit([0, 0, 1]);

// The facets in 3D (poses() at some moment), seen from yaw and pitch the way the player's camera sees them, but
// from far off, so nothing is drawn bigger for being nearer. Drawn from the back to the front: where two facets
// overlap on the picture, the one nearer there goes on top. Each shape is as outline()'s, with a third number:
// how much darker it is than paper lying flat in the same light (0 to 1).
export function standing(items, { yaw, pitch }, pad = 0.06) {
  // The camera's own directions (render.js basis): back toward the eye, right and up.
  const y = (yaw * Math.PI) / 180, p = (pitch * Math.PI) / 180;
  const back = [Math.cos(p) * Math.cos(y), Math.cos(p) * Math.sin(y), Math.sin(p)];
  const right = norm3(cross3([0, 0, 1], back));
  const up = cross3(back, right);
  const fs = items.map((it) => {
    const P = corners(it);
    const q = P.map((c) => [dot3(c, right), dot3(c, up)]);
    const d = P.map((c) => dot3(c, back));
    // The facet's normal on the side the camera sees (Newell's method, which a corner repeated doesn't upset).
    let n = [0, 0, 0];
    P.forEach((a, i) => {
      const c = P[(i + 1) % P.length];
      n = [n[0] + (a[1] - c[1]) * (a[2] + c[2]), n[1] + (a[2] - c[2]) * (a[0] + c[0]), n[2] + (a[0] - c[0]) * (a[1] + c[1])];
    });
    n = norm3(n);
    if (dot3(n, back) < 0) n = n.map((k) => -k);
    // The front faces the camera where its corners go round the same way as on the paper, as WebGL decides it.
    const a = area(q);
    return { q, d, a, up: a > 0 ? 1 : 0, far: d.reduce((s, k) => s + k, 0) / d.length, shade: Math.max(0, 1 - lit(n) / FLAT) };
  });
  // How near the camera a facet is at a point of the picture: its corners' depths, carried across its largest
  // triangle (the facet is flat, so any of them gives the same).
  const depthAt = (f, [x, yy]) => {
    let k = 0, most = 0;
    for (let i = 1; i < f.q.length - 1; i++) {
      const A = Math.abs(area([f.q[0], f.q[i], f.q[i + 1]]));
      if (A > most) { most = A; k = i; }
    }
    if (!k) return f.far;
    const [p0, p1, p2] = [f.q[0], f.q[k], f.q[k + 1]];
    const D = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    const u = ((x - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (yy - p0[1])) / D;
    const v = ((p1[0] - p0[0]) * (yy - p0[1]) - (x - p0[0]) * (p1[1] - p0[1])) / D;
    return f.d[0] + u * (f.d[k] - f.d[0]) + v * (f.d[k + 1] - f.d[0]);
  };
  // Paper never passes through paper, so where two facets overlap on the picture, one is in front all over the
  // overlap: the middle of it says which. A facet seen edge on covers nothing.
  const under = fs.map(() => []);
  for (let i = 0; i < fs.length; i++) {
    for (let j = i + 1; j < fs.length; j++) {
      if (Math.abs(fs[i].a) < 1e-9 || Math.abs(fs[j].a) < 1e-9) continue;
      const X = intersectPolys(ccw(fs[i].q), ccw(fs[j].q));
      if (X.length < 3 || Math.abs(area(X)) < 1e-9) continue;
      const c = centroid(X);
      if (depthAt(fs[i], c) < depthAt(fs[j], c)) under[j].push(i); else under[i].push(j);
    }
  }
  // Each facet once everything under it is down, the furthest first; if none is free (which paper shouldn't
  // allow), the furthest left.
  const done = fs.map(() => false), order = [];
  while (order.length < fs.length) {
    let pick = -1;
    for (let k = 0; k < fs.length; k++) {
      if (!done[k] && under[k].every((i) => done[i]) && (pick < 0 || fs[k].far < fs[pick].far)) pick = k;
    }
    if (pick < 0) for (let k = 0; k < fs.length; k++) if (!done[k] && (pick < 0 || fs[k].far < fs[pick].far)) pick = k;
    done[pick] = true;
    order.push(pick);
  }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const f of fs) for (const [x, yy] of f.q) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, yy); y1 = Math.max(y1, yy); }
  const S = 100 / (Math.max(x1 - x0, y1 - y0) * (1 + pad * 2));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const pt = ([x, yy]) => `${((x - cx) * S + 50).toFixed(2)},${((cy - yy) * S + 50).toFixed(2)}`;
  return order.map((k) => [fs[k].up, fs[k].q.map(pt).join(' '), +fs[k].shade.toFixed(2)]);
}

// A colour (#rrggbb) darkened toward black by k (0 to 1).
function darker(hex, k) {
  if (!k) return hex;
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - k)));
  return `#${((c[0] << 16) | (c[1] << 8) | c[2]).toString(16).padStart(6, '0')}`;
}

// The cut edge of the paper catching the light: a thin light line round the whole sheet, so dark and green papers
// stand out from the green mat as well as the light ones do. It's every facet's outline drawn first with a wide light
// stroke, which the facets then cover, all but the half of it outside the paper.
const RIM = 'rgba(255,250,240,.75)', RIM_WIDTH = 1.6;

export function picture(shapes, { front = '#d9412b', back = '#f3eee3', edge = 'rgba(40,30,20,.45)', label = '' } = {}) {
  const rim = shapes.map(([, points]) => `M${points.replaceAll(' ', 'L')}Z`).join('');
  const polys = shapes.map(([up, points, shade = 0]) =>
    `<polygon points="${points}" fill="${darker(up ? front : back, shade)}" stroke="${edge}" stroke-width=".45" stroke-linejoin="round"/>`);
  // Without a label the picture is decoration, and screen readers skip it.
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg viewBox="0 0 100 100" ${a11y}><path class="rim" d="${rim}" fill="none" stroke="${RIM}" stroke-width="${RIM_WIDTH}" stroke-linejoin="round"/>${polys.join('')}</svg>`;
}
