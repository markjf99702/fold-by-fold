// Turns a model's list of steps into states and motions, one step at a time.
//
// A model's steps say what to do the way a diagram does, in terms of the paper: fold this corner onto
// that one, fold along the line through these two points. Points are given on the paper (the unit
// square, [0, 0] at one corner); `at` says where such a point is now.

import { Sheet, fold, foldUnfold, bend, turnOver, turn, together, reverse } from './paper.js';
import { mechanism, between, squash, standUp } from './mech.js';
import { bisector, line, lineAt, side, flip, intersect, mid, lerp, reflectPoint, angleBisector, sub } from './geom.js';

export function build(model) {
  let sheet = Sheet.square(model.paper || {});
  const start = sheet;
  const steps = [];
  const h = helpers(() => sheet);
  for (const [i, step] of model.steps.entries()) {
    let r;
    try {
      r = step.do(h);
    } catch (e) {
      e.message = `${model.id} step ${i + 1}: ${e.message}`;
      throw e;
    }
    // The step starts with the paper as the last one left it, however it cuts it (see Sheet.levels()), and one
    // that leaves the paper as it was (a fold and unfold, a bend) ends that way too.
    if (r.from !== sheet) { r.from.before = sheet; r.from._levels = null; }
    if (r.to !== sheet && unchanged(r.from, r.to)) { r.to.before = sheet; r.to._levels = null; }
    steps.push({
      ...r, say: step.say, name: step.name || nameOf(r.motion), note: step.note || null, view: step.view || null,
      unfold: step.unfold === true, // it opens a fold made before, rather than making a new one
    });
    sheet = r.to;
  }
  return { model, start, steps, end: sheet };
}

// Whether a step leaves every piece of the paper where it was.
const unchanged = (a, b) => a.order.length === b.order.length
  && a.order.every((id, k) => id === b.order[k] && a.facets.get(id).m === b.facets.get(id).m);

function nameOf(m) {
  if (m.kind === 'fold') return m.type === 'valley' ? 'Valley fold' : 'Mountain fold';
  if (m.kind === 'foldUnfold') return 'Fold and unfold';
  if (m.kind === 'turnOver') return 'Turn over';
  if (m.kind === 'turn') return 'Rotate';
  if (m.kind === 'bend') return 'Shape';
  if (m.kind === 'reverse') return 'Inside reverse fold';
  if (m.kind === 'mech') return m.name || (m.parts ? 'Inside reverse folds' : 'Collapse');
  if (m.kind === 'multi') {
    if (m.parts.every((p) => p.bend)) return 'Shape';
    if (m.folded) return 'Fold and unfold';
    return m.parts.every((p) => p.type === 'mountain') ? 'Mountain folds' : 'Valley folds';
  }
  return m.kind;
}

// The toolkit each step's `do` gets.
function helpers(current) {
  const at = (q) => current().at(q);
  // Points the moving side toward the left of the line.
  const orient = (L, move) => {
    if (!move) return L;
    const q = Array.isArray(move[0]) ? move[0] : move; // a flap can be given by several points
    return side(L, at(q)) > 0 ? L : flip(L);
  };
  const opts = (o = {}) => {
    const out = { ...o };
    if (o.flap) { out.layers = 'flap'; out.seed = o.flap; }
    return out;
  };
  return {
    at,
    mid,
    lerp,
    // The line that folds paper point a onto paper point b (a moves).
    onto: (a, b) => bisector(at(a), at(b)),
    // The line that folds paper point a onto a point of the table.
    ontoPoint: (a, q) => bisector(at(a), q),
    // A level line through a table height, or a vertical one through a table x.
    level: (y) => ({ p: [0, y], d: [1, 0] }),
    upright: (x) => ({ p: [x, 0], d: [0, 1] }),
    // The line through two paper points (or table points, given as { table: [x, y] }).
    through: (a, b) => line(pt(a), pt(b)),
    lineAt,
    intersect,
    reflectPoint,
    angleBisector,
    sub,
    valley: (L, o = {}) => fold(current(), orient(L, o.move || o.flap), { ...opts(o), type: 'valley' }),
    mountain: (L, o = {}) => fold(current(), orient(L, o.move || o.flap), { ...opts(o), type: 'mountain' }),
    crease: (L, o = {}) => foldUnfold(current(), orient(L, o.move || o.flap), { ...opts(o), type: o.type || 'valley' }),
    bend: (L, angle, o = {}) => bend(current(), orient(L, o.move || o.flap), angle, { ...opts(o), type: o.type || 'valley' }),
    // Several folds at once: each maker gets the helpers and returns one fold, e.g.
    // h.together((k) => k.valley(...), (k) => k.valley(...)).
    together: (...makers) => together(current(), makers.map((mk) => (s) => mk(helpers(() => s)))),
    // The last step of a model: bend flaps part way (makers return h.bend(...)), then roll the whole
    // model about a line on the table by `roll` degrees.
    shape: (makers, roll = null) => {
      const r = together(current(), makers.map((mk) => (s) => mk(helpers(() => s))));
      if (roll) r.motion.roll = roll;
      return r;
    },
    // Several creases closing at once, as one linked motion (a collapse, a petal fold). Each crease is a
    // segment on the paper, { a, b, fold: 'valley' | 'mountain' | 'flat' | 'free' }; root is a paper
    // point on the part that stays put; arrow is a paper point to follow with an arrow.
    mech: (o) => {
      const r = mechanism(current(), o);
      r.motion.name = o.name;
      return r;
    },
    // The last step of a model that stands it up by closing creases part way as one linked motion (the fortune teller
    // opening). Each crease is a segment on the table, { a, b, fold: degrees, positive for a valley from above }; level
    // names four paper points, going round, whose plane stays level; roll turns the whole model over as it goes.
    standUp: (o) => {
      const r = standUp(current(), o);
      r.motion.name = o.name;
      return r;
    },
    // An inside reverse fold of the flap holding paper point `flap`, along L. `split` is the line on the
    // paper between the model's front and back halves.
    reverse: (L, o) => reverse(current(), orient(L, o.flap), { seed: o.flap, split: o.split }),
    // Inside reverse folds made the way stiff paper allows: the layers holding paper point `page` turn
    // over about the line `axis` on the table like a page, the flap under them lies open, the point folds
    // up, and the page turns back. Each maker returns one h.reverse(...).
    reverseOpen: (makers, o) => {
      const t = together(current(), makers.map((mk) => (s) => mk(helpers(() => s))));
      const r = between(t.from, t.to, { axis: o.axis, page: o.page });
      r.motion.parts = t.motion.parts;
      return r;
    },
    // A squash fold of the flap between the table line top–bottom and its folded edge top–corner; seed is
    // a paper point on its front layer.
    squash: (o) => {
      const r = squash(current(), o);
      r.motion.name = 'Squash fold';
      return r;
    },
    // A line on the flat, unfolded paper, through two of its points.
    paperLine: (a, b) => line(a, b),
    turnOver: (how) => turnOver(current(), how),
    turn: (deg) => turn(current(), deg),
    sheet: current,
  };
  function pt(q) {
    return q.table ? q.table : at(q);
  }
}
