// The folded sheet, lying flat on the table between steps.
//
// The paper is the unit square. A folded state is a set of facets: convex pieces of that square, each
// moved onto the table by a rigid move (possibly turned over), plus the order they are stacked in, from
// the table up. A fold splits the facets it crosses along the fold line and turns the moving pieces over
// onto the other side of it. Nothing here draws; see motion.js and render.js for that.

import {
  apply, compose, det, invert, reflection, rotation, clip, cuts, ccw, area, inside, overlapArea,
  sharedSegment, side, sub, near, flip, centroid, IDENTITY,
} from './geom.js';

let nextId = 1;
const newId = () => nextId++;
// Which pieces each cut facet became, for as long as the page runs.
const cutInto = new Map();

export class Sheet {
  constructor(facets, order) {
    this.facets = facets; // Map id -> { id, poly: paper corners (ccw), m: iso paper -> table }
    this.order = order; // ids from the table up
    this._world = new Map();
    this._levels = null;
  }

  // A fresh sheet: the unit square, or size [w, h] for a rectangle. colorUp: the colored side faces up.
  // turn: degrees to rotate it on the table.
  static square({ colorUp = true, turn = 0, size = [1, 1] } = {}) {
    const [w, h] = size;
    let m = { a: 1, b: 0, c: 0, d: 1, e: -w / 2, f: -h / 2 };
    if (!colorUp) m = compose({ a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 }, m);
    if (turn) m = compose(rotation([0, 0], turn), m);
    const f = { id: newId(), poly: [[0, 0], [w, 0], [w, h], [0, h]], m };
    return new Sheet(new Map([[f.id, f]]), [f.id]);
  }

  clone() {
    return new Sheet(new Map(this.facets), this.order.slice());
  }

  get list() {
    return this.order.map((id) => this.facets.get(id));
  }

  world(id) {
    let w = this._world.get(id);
    if (!w) {
      const f = this.facets.get(id);
      w = ccw(f.poly.map((q) => apply(f.m, q)));
      this._world.set(id, w);
    }
    return w;
  }

  // Where a point of the paper is now. Every point of the paper is in exactly one place.
  at(q) {
    for (const f of this.facets.values()) if (inside(f.poly, q, 1e-9)) return apply(f.m, q);
    throw new Error(`No facet holds paper point ${q}`);
  }

  facetAt(q) {
    let best = null;
    for (const id of this.order) {
      const f = this.facets.get(id);
      if (inside(f.poly, q, 1e-9)) best = f; // the last one found is the highest, if q sits on a crease
    }
    if (!best) throw new Error(`No facet holds paper point ${q}`);
    return best;
  }

  // The topmost facet over a point on the table.
  topAt(p) {
    for (let i = this.order.length - 1; i >= 0; i--) {
      if (inside(this.world(this.order[i]), p, 1e-9)) return this.facets.get(this.order[i]);
    }
    return null;
  }

  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of this.order) {
      for (const [x, y] of this.world(id)) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
    return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  // How many layers lie under each facet: a facet sits one layer above the highest facet below it that
  // it overlaps.
  levels() {
    if (this._levels) return this._levels;
    const lv = new Map();
    const done = [];
    for (const id of this.order) {
      const w = this.world(id);
      let l = 0;
      for (const g of done) {
        if (lv.get(g) + 1 > l && overlapArea(w, this.world(g)) > 1e-7) l = lv.get(g) + 1;
      }
      lv.set(id, l);
      done.push(id);
    }
    this._levels = lv;
    return lv;
  }

  // Facets that share an edge with facet f on the paper, with the shared piece of edge.
  neighbors(f) {
    const out = [];
    for (const g of this.facets.values()) {
      if (g.id === f.id) continue;
      for (let i = 0; i < f.poly.length; i++) {
        const a = f.poly[i], b = f.poly[(i + 1) % f.poly.length];
        for (let j = 0; j < g.poly.length; j++) {
          const s = sharedSegment(a, b, g.poly[j], g.poly[(j + 1) % g.poly.length]);
          if (s) out.push({ g, edge: s });
        }
      }
    }
    return out;
  }
}

// ---------- Splitting ----------

// Cuts facet id along a line on the table; returns the ids of its left and right pieces
// (the same id comes back for a side if the line misses the facet).
function splitFacet(sheet, id, L) {
  const w = sheet.world(id);
  if (!cuts(w, L)) {
    const s = side(L, centroid(w));
    return s > 0 ? { left: id, right: null } : { left: null, right: id };
  }
  const f = sheet.facets.get(id);
  const inv = invert(f.m);
  const toPaper = (poly) => ccw(poly.map((q) => apply(inv, q)));
  const lp = toPaper(clip(w, L, true)), rp = toPaper(clip(w, L, false));
  const lf = { id: newId(), poly: lp, m: f.m }, rf = { id: newId(), poly: rp, m: f.m };
  cutInto.set(id, [rf.id, lf.id]);
  sheet.facets.delete(id);
  sheet.facets.set(lf.id, lf);
  sheet.facets.set(rf.id, rf);
  sheet._world.delete(id);
  const k = sheet.order.indexOf(id);
  sheet.order.splice(k, 1, rf.id, lf.id);
  sheet._levels = null;
  return { left: lf.id, right: rf.id };
}

// Does the segment [a, b] of the table lie on line L?
const onLine = (L, a, b) => Math.abs(side(L, a)) < 1e-7 && Math.abs(side(L, b)) < 1e-7;

// The pieces that move when you fold along L, with the moving part on L's left.
//   layers 'all': everything on that side.
//   layers 'flap': the layer holding paper point `seed`, and whatever paper is joined to it on that side
//   without crossing the fold line.
function movingPieces(sheet, L, { layers = 'all', seed = null, only = null }) {
  if (layers === 'all') {
    const moving = [];
    for (const id of sheet.order.slice()) {
      if (only && !only.has(id)) continue;
      const { left } = splitFacet(sheet, id, L);
      if (left) moving.push(left);
    }
    return moving;
  }
  const start = sheet.facetAt(seed);
  if (side(L, apply(start.m, seed)) <= 0) throw new Error('The flap to fold is not on the moving side of the line');
  const moving = new Set();
  const queue = [start.id];
  const seen = new Set();
  const grow = () => { while (queue.length) step(); };
  // Anything caught between two layers of the flap has to fold with it.
  const sandwiched = () => {
    const found = [];
    for (const id of sheet.order) {
      if (moving.has(id) || seen.has(id)) continue;
      const w = clip(sheet.world(id), L, true);
      if (!w.length || Math.abs(area(w)) < 1e-7) continue;
      const k = sheet.order.indexOf(id);
      let below = false, above = false;
      for (const m of moving) {
        if (overlapArea(w, sheet.world(m)) < 1e-7) continue;
        if (sheet.order.indexOf(m) < k) below = true; else above = true;
      }
      if (below && above) found.push(id);
    }
    return found;
  };
  for (;;) {
    grow();
    const more = sandwiched();
    if (!more.length) break;
    queue.push(...more);
  }
  return [...moving];

  function step() {
    const id = queue.shift();
    if (seen.has(id) || !sheet.facets.has(id)) return;
    seen.add(id);
    const { left } = splitFacet(sheet, id, L);
    if (!left) return;
    moving.add(left);
    seen.add(left);
    const f = sheet.facets.get(left);
    for (const { g, edge } of sheet.neighbors(f)) {
      if (moving.has(g.id) || seen.has(g.id)) continue;
      const a = apply(f.m, edge[0]), b = apply(f.m, edge[1]);
      if (onLine(L, a, b)) continue; // the hinge
      queue.push(g.id);
    }
  }
}

// ---------- Moves ----------

// A step's result: the sheet split and ready (from), the sheet afterward (to), and how to animate it.
function result(from, to, motion) {
  return { from, to, motion };
}

// Folds along line L, moving the paper on L's left over to its right.
//   type: 'valley' (toward you) or 'mountain' (away, behind).
//   layers: 'all' or 'flap' (with seed: a paper point on the flap).
//   into: where the moved layers go in the stack: 'top' for valley folds, 'bottom' for mountain folds,
//   or { above: paper point } / { below: paper point } to tuck them into a pocket.
export function fold(sheet, L, opts = {}) {
  const type = opts.type || 'valley';
  const from = sheet.clone();
  const moving = movingPieces(from, L, opts);
  if (!moving.length) throw new Error('Nothing on the moving side of the fold');
  const movingSet = new Set(moving);
  const stack = from.order.filter((id) => movingSet.has(id)); // bottom to top
  const into = opts.into || (type === 'valley' ? 'top' : 'bottom');

  // Nothing that stays put may lie in the way of the flap as it lifts off.
  if (typeof into === 'string') {
    for (const id of stack) {
      const k = from.order.indexOf(id);
      const w = from.world(id);
      const blockers = type === 'valley' ? from.order.slice(k + 1) : from.order.slice(0, k);
      for (const b of blockers) {
        if (!movingSet.has(b) && overlapArea(w, from.world(b)) > 1e-6) {
          throw new Error(`Layer ${b} is in the way of the fold`);
        }
      }
    }
  }

  const to = from.clone();
  to._world = new Map();
  const R = reflection(L);
  for (const id of moving) {
    const f = to.facets.get(id);
    to.facets.set(id, { ...f, m: compose(R, f.m) });
  }
  const rest = to.order.filter((id) => !movingSet.has(id));
  const flipped = stack.slice().reverse();
  if (into === 'top') to.order = rest.concat(flipped);
  else if (into === 'bottom') to.order = flipped.concat(rest);
  else {
    const ref = into.above ? into.above : into.below;
    const anchor = to.facetAt(ref);
    const k = rest.indexOf(anchor.id);
    if (k < 0) throw new Error('The pocket is inside the moving flap');
    rest.splice(into.above ? k + 1 : k, 0, ...flipped);
    to.order = rest;
  }
  return result(from, to, { kind: 'fold', line: L, moving, sign: type === 'valley' ? 1 : -1, type });
}

// Folds and unfolds again, leaving a crease.
export function foldUnfold(sheet, L, opts = {}) {
  const r = fold(sheet, L, opts);
  const to = r.from.clone();
  return result(r.from, to, { ...r.motion, kind: 'foldUnfold', folded: r.to });
}

// Folds only part way, to shape the finished model. angle in degrees.
export function bend(sheet, L, angle, opts = {}) {
  const r = fold(sheet, L, { ...opts, into: opts.into || (opts.type === 'mountain' ? 'bottom' : 'top') });
  return result(r.from, r.from.clone(), { ...r.motion, kind: 'bend', angle });
}

// Several folds made at the same time, like folding all four corners in at once, or shaping a finished
// model by bending some flaps part way. Each maker is a function from a sheet to one fold's result, and
// they're applied in turn; the flaps they move must not overlap.
export function together(sheet, makers) {
  const results = [];
  let s = sheet;
  for (const mk of makers) {
    const r = mk(s);
    results.push(r);
    s = r.motion.kind === 'bend' ? r.from : r.to;
  }
  const last = results[results.length - 1];
  const from = last.from.clone();
  from._world = new Map();
  // Put every earlier flap back where it started.
  for (let k = 0; k < results.length - 1; k++) {
    const r = results[k];
    for (const id of r.motion.moving) {
      if (!from.facets.has(id)) throw new Error('A later fold cut through a flap an earlier one moved');
      from.facets.set(id, { ...from.facets.get(id), m: r.from.facets.get(id).m });
    }
  }
  // The stacking before anything moved, with every later cut put in place of the facet it cut.
  const expand = (id) => (from.facets.has(id) ? [id] : (cutInto.get(id) || []).flatMap(expand));
  from.order = results[0].from.order.flatMap(expand);
  if (from.order.length !== from.facets.size) throw new Error('Lost track of a facet while folding together');
  const bends = results.every((r) => r.motion.kind === 'bend');
  const to = bends ? from.clone() : s.clone();
  const parts = results.map((r) => ({
    line: r.motion.line, moving: r.motion.moving, sign: r.motion.sign, type: r.motion.type,
    angle: r.motion.kind === 'bend' ? r.motion.angle : 180, bend: r.motion.kind === 'bend',
  }));
  return result(from, to, { kind: 'multi', parts, moving: parts.flatMap((p) => p.moving) });
}

// Turns the whole model over, left to right ('side') or top to bottom ('end').
export function turnOver(sheet, how = 'side') {
  const from = sheet.clone();
  const b = from.bounds();
  const L = how === 'side' ? { p: [b.cx, 0], d: [0, 1] } : { p: [0, b.cy], d: [1, 0] };
  const R = reflection(L);
  const to = from.clone();
  to._world = new Map();
  for (const [id, f] of to.facets) to.facets.set(id, { ...f, m: compose(R, f.m) });
  to.order = to.order.slice().reverse();
  return result(from, to, { kind: 'turnOver', line: L, how });
}

// Turns the model around on the table, counterclockwise in degrees.
export function turn(sheet, deg) {
  const from = sheet.clone();
  const b = from.bounds();
  const R = rotation([b.cx, b.cy], deg);
  const to = from.clone();
  to._world = new Map();
  for (const [id, f] of to.facets) to.facets.set(id, { ...f, m: compose(R, f.m) });
  return result(from, to, { kind: 'turn', center: [b.cx, b.cy], deg });
}

// The folds the paper has so far: every stretch of edge two facets share, on the paper.
export function creases(sheet) {
  const out = [];
  const list = [...sheet.facets.values()];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const g = list[j];
      for (let a = 0; a < f.poly.length; a++) {
        for (let b = 0; b < g.poly.length; b++) {
          const s = sharedSegment(f.poly[a], f.poly[(a + 1) % f.poly.length], g.poly[b], g.poly[(b + 1) % g.poly.length]);
          if (s) out.push({ a: s[0], b: s[1], f: f.id, g: g.id });
        }
      }
    }
  }
  return out;
}

// Paper points on the edge of the square, for checks.
export const isFlipped = (f) => det(f.m) < 0;

export { flip, near, sub, IDENTITY, area };
