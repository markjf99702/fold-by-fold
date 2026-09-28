// Turns a model's list of steps into states and motions, one step at a time.
//
// A model's steps say what to do the way a diagram does, in terms of the paper: fold this corner onto
// that one, fold along the line through these two points. Points are given on the paper (the unit
// square, [0, 0] at one corner); `at` says where such a point is now.

import { Sheet, fold, foldUnfold, bend, turnOver, turn, together, reverse } from './paper.js';
import { mechanism } from './mech.js';
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
    steps.push({ ...r, say: step.say, name: step.name || nameOf(r.motion), note: step.note || null, view: step.view || null });
    sheet = r.to;
  }
  return { model, start, steps, end: sheet };
}

function nameOf(m) {
  if (m.kind === 'fold') return m.type === 'valley' ? 'Valley fold' : 'Mountain fold';
  if (m.kind === 'foldUnfold') return 'Fold and unfold';
  if (m.kind === 'turnOver') return 'Turn over';
  if (m.kind === 'turn') return 'Rotate';
  if (m.kind === 'bend') return 'Shape';
  if (m.kind === 'reverse') return 'Inside reverse fold';
  if (m.kind === 'mech') return m.name || 'Collapse';
  if (m.kind === 'multi') {
    if (m.parts.every((p) => p.bend)) return 'Shape';
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
    return side(L, at(move)) > 0 ? L : flip(L);
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
    // An inside reverse fold of the flap holding paper point `flap`, along L. `split` is the line on the
    // paper between the model's front and back halves.
    reverse: (L, o) => reverse(current(), orient(L, o.flap), { seed: o.flap, split: o.split }),
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
