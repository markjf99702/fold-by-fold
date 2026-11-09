// The folding engine, without a browser:  node --test test/unit.test.mjs
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Sheet, fold, turnOver, together, creases, isFlipped } from '../js/paper.js';
import { apply, area, bisector, side, centroid, overlapArea, line, ccw, clip, det, inside as covers } from '../js/geom.js';
import { build } from '../js/build.js';
import { poses, marks, symbol, corners, transformPoint, LAYER } from '../js/motion.js';
import { MODELS } from '../js/models.js';
import { finished, outline, standing, picture, after } from '../js/thumbs.js';
import { diagram } from '../js/flat.js';
import { FINISHED } from '../js/finished.js';
import { crossings } from '../js/check.js';

// Each model folded once, for the checks that only look at the steps.
const builds = new Map();
const once = (model) => builds.get(model.id) || builds.set(model.id, build(model)).get(model.id);
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
// A turn without stretching, skewing or mirroring: a row-major 3x3 whose columns are at right angles and one
// long, with determinant 1.
function rigid(r) {
  const col = (j) => [r[j], r[3 + j], r[6 + j]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const [x, y, z] = [col(0), col(1), col(2)];
  const det = dot(x, [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]]);
  return [dot(x, x) - 1, dot(y, y) - 1, dot(z, z) - 1, dot(x, y), dot(x, z), dot(y, z), det - 1].every((e) => Math.abs(e) < 1e-9);
}
const closePt = (p, q, tol = 1e-9) => p.every((x, i) => close(x, q[i], tol));
const paperArea = (s) => [...s.facets.values()].reduce((t, f) => t + Math.abs(area(f.poly)), 0);
// Down the middle of the table. A fold moves whatever is on the line's left, so this one moves the left half.
const middle = { p: [0, 0], d: [0, 1] };

test('a valley fold in half turns the left half over onto the right, on top', () => {
  const s = Sheet.square();
  const r = fold(s, middle, { type: 'valley' });
  assert.equal(r.to.facets.size, 2);
  const b = r.to.bounds();
  assert.ok(close(b.x0, 0) && close(b.x1, 0.5), `bounds ${JSON.stringify(b)}`);
  // The paper's left edge now lies along the table's right edge, and that half is turned over, on top.
  assert.ok(closePt(r.to.at([0, 0.5]), [0.5, 0]));
  const top = r.to.facets.get(r.to.order.at(-1));
  assert.ok(isFlipped(top), 'the folded half is not turned over');
  assert.ok(top.poly.some((q) => closePt(q, [0, 0])), 'the folded half is not the one on top');
  assert.deepEqual([...r.to.levels().values()].sort(), [0, 1]);
  assert.ok(close(paperArea(r.to), 1));
});

test('a mountain fold tucks the flap underneath instead', () => {
  const r = fold(Sheet.square(), middle, { type: 'mountain' });
  const bottom = r.to.facets.get(r.to.order[0]);
  assert.ok(bottom.poly.some((q) => closePt(q, [0, 0])), 'the folded half is not underneath');
  assert.equal(r.motion.sign, -1);
});

test('turning over reverses the stack and mirrors it', () => {
  const r1 = fold(Sheet.square(), middle, { type: 'valley' });
  const r2 = turnOver(r1.to);
  assert.deepEqual(r2.to.order, r1.to.order.slice().reverse());
  for (const f of r2.to.facets.values()) assert.equal(isFlipped(f), !isFlipped(r1.to.facets.get(f.id)));
});

test('a fold can only take a flap that nothing is lying on', () => {
  const half = fold(Sheet.square(), middle, { type: 'valley' }).to;
  // A line down the folded half, moving the strip on its right: in that strip the two layers aren't
  // joined, so the bottom one alone can be picked, but it can't fold up through the layer on top of it.
  const strip = { p: [0.25, 0], d: [0, -1] };
  assert.throws(() => fold(half, strip, { type: 'valley', layers: 'flap', seed: [0.9, 0.5] }), /in the way/);
  // Folding the whole strip takes both layers.
  const r = fold(half, strip, { type: 'valley' });
  assert.equal(r.motion.moving.length, 2);
  // Folding it behind, the bottom layer alone is fine.
  assert.equal(fold(half, strip, { type: 'mountain', layers: 'flap', seed: [0.9, 0.5] }).motion.moving.length, 1);
});

test('a tuck into a pocket the flap can\'t reach is refused, rather than passing paper through paper', () => {
  // A corner folded over, then a strip tucked under a layer that lies beyond that fold.
  const model = { id: 'tuck', steps: [
    { say: 'Fold a corner over.', do: (h) => h.valley(h.through([0.75, 0.625], [0.375, 0.75]), { flap: [0.125, 0.75] }) },
    { say: 'Tuck the left strip under.', do: (h) => h.valley(h.through([0.125, 0.375], [0.125, 0.875]), { flap: [0, 0.375], into: { below: [0.75, 0.25] } }) },
  ] };
  assert.throws(() => build(model), /tuck step 2: The flap can't tuck there: folds \d+\/\d+ and \d+\/\d+ interleave/);
});

test('folds made together that would move the same paper are refused, rather than landing somewhere they don\'t start from', () => {
  // The same corner folded two ways at once: the second would fold it from where the first left it.
  const A = [0.125, 0.125];
  const model = { id: 'twice', steps: [{ say: 'Fold one corner two ways at once.', do: (h) => h.together(
    (k) => k.valley(k.onto(A, [0.191, 0.152]), { flap: A }),
    (k) => k.valley(k.onto(A, [0.5, 0.625]), { flap: A }),
  ) }] };
  assert.throws(() => build(model), /twice step 1: Folds made together must move different flaps$/);
});

test('folds made together that would land on each other are refused, rather than passing through each other on the way', () => {
  // A letter fold as one step: the bottom third up and the top down. Both turn at the same pace from opposite
  // sides, so halfway they meet in the air, and one would pass through the other along the whole width.
  const model = { id: 'letter', steps: [{ say: 'Fold the bottom third up and the top down, together.', do: (h) => h.together(
    (k) => k.valley(k.level(-1 / 6), { flap: [0.5, 0.1] }),
    (k) => k.valley(k.level(0.2), { flap: [0.5, 0.9] }),
  ) }] };
  assert.throws(() => build(model), /letter step 1: Folds made together can't land on each other: make them one after the other$/);
  // One after the other, they're fine.
  const apart = build({ id: 'letter', steps: [
    { say: 'Fold the bottom third up.', do: (h) => h.valley(h.level(-1 / 6), { flap: [0.5, 0.1] }) },
    { say: 'Fold the top down over it.', do: (h) => h.valley(h.level(0.2), { flap: [0.5, 0.9] }) },
  ] });
  assert.deepEqual(crossings(apart.end), []);
});

// The paper folded in half along a diagonal, and the line between its front and back halves.
const diagonal = { say: 'Fold in half along the diagonal.', do: (h) => h.valley(h.through([0, 0], [1, 1]), { move: [0.9, 0.1] }) };
const halves = (h) => h.paperLine([0, 0], [1, 1]);

test('an inside reverse fold along the flap\'s own folded edge is refused, rather than breaking the animation', () => {
  // The crease runs parallel to the fold joining the flap's two halves, so there is no point for the tip to swing round.
  const model = { id: 'parallel', steps: [diagonal, {
    say: 'Inside reverse fold along a line beside the folded edge.',
    do: (h) => h.reverse(h.through([0.9375, 0.75], [0.125, 0.3125]), { flap: [0.3225, 0.2075], split: halves(h) }),
  }] };
  assert.throws(() => build(model), /parallel step 2: The crease of an inside reverse fold has to cross the flap's folded edge$/);
});

test('an inside reverse fold that would push paper through paper is refused', () => {
  // A strip folded in first, then the point reversed across it: the strip's fold and the point's would interleave.
  const model = { id: 'interleave', steps: [
    { say: 'Fold the right edge in to the three-quarter line.', do: (h) => h.valley(h.onto([1, 0], [0.5, 0]), { flap: [0.99, 0.01] }) },
    diagonal,
    { say: 'Inside reverse fold the point.', do: (h) => h.reverse(h.through([0.75, 0.5625], [0.125, 0.25]), { flap: [0.0725, 0.645], split: halves(h) }) },
  ] };
  assert.throws(() => build(model), /interleave step 3: The point can't reverse there: folds \d+\/\d+ and \d+\/\d+ interleave/);
});

test('four corners folded in together all meet at the center', () => {
  const s = Sheet.square();
  const corner = (q) => (sh) => fold(sh, bisector(sh.at(q), [0, 0]), { type: 'valley', layers: 'flap', seed: q });
  const r = together(s, [[0, 0], [1, 0], [1, 1], [0, 1]].map(corner));
  for (const q of [[0, 0], [1, 0], [1, 1], [0, 1]]) assert.ok(closePt(r.to.at(q), [0, 0]), `corner ${q} is at ${r.to.at(q)}`);
  assert.equal(r.motion.kind, 'multi');
  assert.equal(r.motion.parts.length, 4);
  // Before they move, the flaps are all back where they started.
  for (const q of [[0, 0], [1, 0], [1, 1], [0, 1]]) assert.ok(closePt(r.from.at(q), [q[0] - 0.5, q[1] - 0.5]));
  assert.ok(creases(r.to).length >= 4);
});

test('folds and unfolds made together fold up at once and open again, leaving their creases', () => {
  // Two opposite corners to the middle and back, as one step, the way the frog creases both edges of a face.
  const model = { id: 'two-corners', paper: { kind: 'Square' }, steps: [{
    say: 'Fold two opposite corners in to the middle, and unfold.',
    do: (h) => h.together(
      (k) => k.crease(k.onto([0, 0], [0.5, 0.5]), { move: [0, 0] }),
      (k) => k.crease(k.onto([1, 1], [0.5, 0.5]), { move: [1, 1] }),
    ),
  }] };
  const [step] = build(model).steps;
  assert.equal(step.name, 'Fold and unfold');
  // It ends as it began, creased: each fold cut the paper along its line.
  for (const q of [[0, 0], [1, 1], [0.5, 0.5]]) assert.ok(closePt(step.to.at(q), step.from.at(q)), `paper point ${q} moved`);
  assert.equal(step.to.facets.size, 3);
  // Halfway, both corners lie folded on the middle, over the paper; at the end they're back, flat on the mat.
  const at = (t, q) => {
    const it = poses(step, t).find((x) => covers(x.facet.poly, q, 1e-9) && (q[0] + q[1] < 0.5 || q[0] + q[1] > 1.5));
    return transformPoint(it.pose, ...q);
  };
  for (const q of [[0, 0], [1, 1]]) {
    const mid = at(0.5, q), end = at(1, q);
    assert.ok(closePt(mid.slice(0, 2), step.from.at([0.5, 0.5]), 1e-6) && mid[2] > 0, `halfway, corner ${q} is at ${mid}`);
    assert.ok(closePt(end, [...step.from.at(q), 0], 1e-9), `at the end, corner ${q} is at ${end}`);
  }
  // A diagram marks each one as a fold and unfold: an arrow with a head at each end.
  const m = marks(step);
  assert.equal(m.length, 2);
  assert.ok(m.every((k) => k.type === 'valley' && k.arrow.back), JSON.stringify(m.map((k) => k.arrow)));
  // Only folds and unfolds can go together that way.
  const mixed = { ...model, steps: [{ say: 'One corner in and back, the other in.', do: (h) => h.together(
    (k) => k.crease(k.onto([0, 0], [0.5, 0.5]), { move: [0, 0] }),
    (k) => k.valley(k.onto([1, 1], [0.5, 0.5]), { move: [1, 1] }),
  ) }] };
  assert.throws(() => build(mixed), /A fold and unfold can only be made together with other folds and unfolds/);
});

for (const model of MODELS) {
  test(`${model.name}: every step folds, and every motion starts and lands on the paper as it lies`, () => {
    const b = build(model);
    assert.equal(b.steps.length, model.steps.length);
    for (const [i, step] of b.steps.entries()) {
      const where = `${model.id} step ${i + 1}`;
      assert.ok(step.say && step.say.length > 10, `${where} has nothing to say`);
      assert.ok(close(paperArea(step.to), paperArea(b.start)), `${where} lost paper`);
      const flatAt = (sheet, id) => {
        const f = sheet.facets.get(id);
        return f.poly.map((q) => [...apply(f.m, q), sheet.levels().get(id) * LAYER]);
      };
      const check = (t, sheet) => {
        for (const it of poses(step, t)) {
          if (it.bridge) continue;
          const want = flatAt(sheet, it.facet.id);
          const got = corners(it);
          got.forEach((p, k) => assert.ok(closePt(p, want[k], 1e-6), `${where} at t=${t}: facet ${it.facet.id} is at ${p}, not ${want[k]}`));
        }
      };
      check(0, step.from);
      // A step that bends flaps part way, or stands the model up, ends in 3D with its paper lying as it began.
      const bends = step.motion.kind === 'bend' || step.motion.parts?.some((p) => p.bend) || step.motion.stands;
      if (!bends) check(1, step.motion.folded ? step.from : step.to);
      // Halfway through a fold and unfold (or several made together), every layer is where the fold puts it: a flap
      // folded behind is under the rest, not level with it.
      if (step.motion.folded) check(0.5, step.motion.folded);
      // Nothing passes through the table, every layer stays in one piece and keeps its shape, and nothing is
      // anywhere but a real place.
      for (let k = 0; k <= 100; k++) {
        const t = k / 100;
        for (const it of poses(step, t)) {
          for (const p of corners(it)) {
            if (!p.every(Number.isFinite)) assert.fail(`${where} at t=${t}: a corner is at ${p}`);
            if (p[2] <= -1e-9) assert.fail(`${where} goes under the table at t=${t}`);
          }
          if (!it.bridge && !rigid(it.pose.r)) assert.fail(`${where} at t=${t}: facet ${it.facet.id} stretches or skews`);
        }
      }
      if (step.motion.kind === 'mech') assert.ok(step.motion.pathGap < 1e-5, `${where} tears the paper by ${step.motion.pathGap} on the way`);
      if (['fold', 'foldUnfold', 'bend', 'multi', 'mech', 'reverse'].includes(step.motion.kind)) {
        const m = marks(step);
        assert.ok(m && m.length, `${where} has no diagram marks`);
        for (const k of m) assert.ok(['valley', 'mountain'].includes(k.type), `${where} mark type ${k.type}`);
      }
    }
    // The gallery's picture of the finished model, worked out ahead of time, is still this model's.
    assert.deepEqual(FINISHED[model.id], finished(b), `${model.id}'s picture in js/finished.js is out of date: run node tools/make-thumbs.mjs`);
    const last = b.steps[b.steps.length - 1];
    assert.equal(picture(FINISHED[model.id]).match(/<polygon/g).length, last.view ? poses(last, 1).length : b.end.facets.size);
  });

  test(`${model.name}: every folded state could be real paper, with nothing passing through anything`, () => {
    for (const [i, step] of build(model).steps.entries()) {
      assert.deepEqual(crossings(step.to), [], `${model.id} step ${i + 1}`);
      // So could the paper as each step starts, cut ready to fold, and a fold and unfold at its fullest.
      assert.deepEqual(crossings(step.from), [], `${model.id} step ${i + 1}, as it starts`);
      if (step.motion.folded) assert.deepEqual(crossings(step.motion.folded), [], `${model.id} step ${i + 1}, folded before it unfolds`);
    }
  });

  test(`${model.name}: the paper moves smoothly, with nothing snapping over from one moment to the next`, () => {
    for (const [i, step] of once(model).steps.entries()) assert.deepEqual(snaps(step), [], `${model.id} step ${i + 1}`);
  });
}

// Where the paper moves much faster than just before and after, as a flap does that snaps over: the speed is how far
// any corner goes per unit of the step's time, over steps of 1/200, and a snap is over 3 times the middle speed of
// the moments around it (leaving out the two on either side, which a snap can spill into).
function snaps(step) {
  const N = 200, speed = [];
  let prev = null;
  for (let k = 0; k <= N; k++) {
    const now = poses(step, k / N).map((it) => corners(it));
    if (prev) {
      let m = 0;
      now.forEach((c, a) => c.forEach((p, j) => { m = Math.max(m, Math.hypot(p[0] - prev[a][j][0], p[1] - prev[a][j][1], p[2] - prev[a][j][2])); }));
      speed.push(m * N);
    }
    prev = now;
  }
  const out = [];
  speed.forEach((v, k) => {
    const around = speed.slice(Math.max(0, k - 10), Math.max(0, k - 2)).concat(speed.slice(k + 3, k + 11)).sort((p, q) => p - q);
    const middle = around[Math.floor(around.length / 2)];
    if (v > 4 && v > 3 * Math.max(middle, 0.5)) out.push(`t ${(k / N).toFixed(3)}: ${v.toFixed(1)} against ${middle.toFixed(1)} around it`);
  });
  return out;
}

// Two pieces joined along a crease that lie together as a step starts and as it ends (within 2 layers of each other) stay
// together on the way: the crease opens by no more than a few layers of paper. (The frog's petal folds opened by 19 layers
// mid-fold, the side that turned over hovering in the air beside the paper it's joined to, plain to see from the side.) A
// piece folded round other layers can't turn over without opening by about half the stack it's folded round: one of the
// frog's petal folds wraps a piece round 11 layers, and its creases open by 6.5 there. The strips bending across an inside
// reverse fold's crease are left out: that crease is meant to give.
test('a crease whose two sides lie together as a step starts and as it ends stays shut on the way', () => {
  const opened = [];
  for (const model of MODELS) {
    for (const [i, step] of once(model).steps.entries()) {
      const { from, motion } = step;
      const bridged = new Set();
      for (const m of [motion, ...(motion.parts || []).map((p) => p.reverse)]) {
        for (const h of m?.hinges || []) bridged.add(`${Math.min(h.tip, h.base)}/${Math.max(h.tip, h.base)}`);
      }
      const l0 = from.levels(), l1 = (motion.folded || step.to).levels();
      const at1 = (id) => l1.get(id) ?? l0.get(id);
      const pairs = [];
      for (const f of from.facets.values()) {
        for (const { g, edge } of from.neighbors(f)) {
          if (g.id < f.id || bridged.has(`${f.id}/${g.id}`)) continue;
          if (Math.abs(l0.get(f.id) - l0.get(g.id)) > 2 || Math.abs(at1(f.id) - at1(g.id)) > 2) continue;
          pairs.push({ f: f.id, g: g.id, edge });
        }
      }
      if (!pairs.length) continue;
      let worst = 0, when = 0;
      for (let k = 1; k < 100; k++) {
        const pose = new Map(poses(step, k / 100).filter((it) => !it.bridge).map((it) => [it.facet.id, it.pose]));
        for (const { f, g, edge } of pairs) {
          for (const q of edge) {
            const a = transformPoint(pose.get(f), ...q), b = transformPoint(pose.get(g), ...q);
            const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
            if (d > worst) { worst = d; when = k / 100; }
          }
        }
      }
      if (worst > 7 * LAYER) opened.push(`${model.id} ${i + 1}: ${(worst / LAYER).toFixed(1)} layers at t=${when}`);
    }
  }
  assert.deepEqual(opened, []);
});

test('each step starts with the paper just where the last one left it, however the new step cuts it', () => {
  const jumps = [];
  for (const model of MODELS) {
    const steps = once(model).steps;
    for (let i = 0; i + 1 < steps.length; i++) {
      if (steps[i].motion.kind === 'bend' || steps[i].motion.parts?.some((p) => p.bend)) continue; // it ends part way
      const end = new Map(poses(steps[i], 1).filter((it) => !it.bridge).map((it) => [it.facet.id, it]));
      let worst = 0;
      for (const it of poses(steps[i + 1], 0)) {
        if (it.bridge) continue;
        // A few points of the paper: the middle of each piece, and just inside each of its corners.
        const c = centroid(it.facet.poly);
        for (const q of [c, ...it.facet.poly.map((p) => [p[0] + (c[0] - p[0]) * 0.02, p[1] + (c[1] - p[1]) * 0.02])]) {
          const was = end.get(it.facet.id) || [...end.values()].find((e) => covers(e.facet.poly, q, 1e-9));
          const a = transformPoint(was.pose, ...q), b = transformPoint(it.pose, ...q);
          worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
        }
      }
      if (worst > 1e-6) jumps.push(`${model.id} ${i + 1} to ${i + 2}: ${(worst / LAYER).toFixed(1)} layers`);
    }
  }
  assert.deepEqual(jumps, []);
});

// Which way up the uppermost layer at (x, y) faces, seen from straight above (true for the front of the paper), or null
// where there's no paper. Layers standing on edge are left out, and so are the strips bending across a crease.
function topFace(items, x, y) {
  let best = null;
  for (const it of items) {
    if (it.bridge) continue;
    const n = [it.pose.r[2], it.pose.r[5], it.pose.r[8]];
    if (Math.abs(n[2]) < 0.05) continue;
    const c = corners(it);
    let inside = false;
    for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
      const [xi, yi] = c[i], [xj, yj] = c[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (!inside) continue;
    const z = c[0][2] - (n[0] * (x - c[0][0]) + n[1] * (y - c[0][1])) / n[2];
    if (!best || z > best.z) best = { z, up: n[2] > 0 };
  }
  return best && best.up;
}

// The share of the paper, seen from above at moment a of a step, that shows the other side or none at moment b: on a
// 24 x 24 grid over the paper as the step starts, a little off the middle of each square so no ray runs along a fold.
function recoloured(step, a, b) {
  const box = step.from.bounds(), A = poses(step, a), B = poses(step, b);
  let n = 0, changed = 0;
  for (let j = 0; j < 24; j++) {
    for (let i = 0; i < 24; i++) {
      const x = box.x0 + (box.x1 - box.x0) * (i + 0.5 + 0.0731) / 24, y = box.y0 + (box.y1 - box.y0) * (j + 0.5 + 0.0379) / 24;
      const was = topFace(A, x, y);
      if (was === null) continue;
      n++;
      if (topFace(B, x, y) !== was) changed++;
    }
  }
  return n ? changed / n : 0;
}

// A fold eases in and out: in its first tenth and its last, hardly anything moves, so hardly any of the paper seen from
// above changes colour. (The frog's petal folds flashed white as Play began, and frog 24 again as it landed, from a
// layer whose thickness ran ahead of its hinges and rose through the layer over it.) What's left stays under 2%: rays
// that fall right by a crease, and a fold and unfold, which moves at twice the pace. Turning the model over changes
// everything at once, and the flapping bird stands up in the first third of its step, keeping its own time.
test('as a fold begins and as it lands, the paper seen from above keeps its colours', () => {
  // In the frog's squash folds the back layer of the flap lifts ahead of the front one and shows through it as they open
  // (31-45% of the face turns white by a tenth of the way). Of the paper passing through paper mid-fold, Mark had the
  // waterbomb's tucks mended and the squash and petal folds left as they are.
  // The lily is folded from the same frog base, with the same squash folds.
  const thick = new Set(['frog 7', 'frog 9', 'frog 11', 'frog 14', 'lily 7', 'lily 9', 'lily 11', 'lily 14']);
  const flashes = [];
  for (const model of MODELS) {
    for (const [i, step] of once(model).steps.entries()) {
      const own = step.motion.roll?.schedule || step.motion.parts?.some((p) => p.schedule);
      if (step.motion.kind === 'turnOver' || own || thick.has(`${model.id} ${i + 1}`)) continue;
      for (const [a, b, when] of [[0, 0.1, 'begins'], [0.9, 1, 'lands']]) {
        const share = recoloured(step, a, b);
        if (share > 0.02) flashes.push(`${model.id} ${i + 1} as it ${when}: ${(share * 100).toFixed(1)}%`);
      }
    }
  }
  assert.deepEqual(flashes, []);
});

test('every model says what paper to fold it from, and it is the paper the model starts as', () => {
  for (const m of MODELS) {
    const [w, h] = m.paper.size || [1, 1];
    const long = Math.max(w, h) / Math.min(w, h);
    // A square; a printer sheet (A4 is 1 : 1.41, US letter 1 : 1.29); an index card (3 x 5 inches).
    const kind = long === 1 ? 'Square' : long > 1.25 && long < 1.45 ? 'Printer paper' : Math.abs(long - 5 / 3) < 1e-9 ? 'Index card' : null;
    assert.equal(m.paper.kind, kind, `${m.id}'s card says ${m.paper.kind}, for a sheet ${w} x ${h}`);
  }
});

test('the gallery runs from Easy through Medium to Tricky, with the crane just before its cousin the flapping bird', () => {
  const levels = ['Easy', 'Medium', 'Tricky'];
  const rank = MODELS.map((m) => levels.indexOf(m.level));
  MODELS.forEach((m, k) => assert.ok(rank[k] >= 0, `${m.id} is rated ${m.level}`));
  for (let k = 1; k < MODELS.length; k++) {
    const [a, b] = [MODELS[k - 1], MODELS[k]];
    assert.ok(rank[k] >= rank[k - 1], `the ${b.name.toLowerCase()} (${b.level}) comes after the ${a.name.toLowerCase()} (${a.level})`);
  }
  const at = (id) => MODELS.findIndex((m) => m.id === id);
  assert.equal(at('flapping-bird'), at('crane') + 1);
  // Mark rates the crane and the flapping bird Medium: neither is really tricky. The frog is.
  assert.deepEqual(['crane', 'flapping-bird', 'frog'].map((id) => MODELS[at(id)].level), ['Medium', 'Medium', 'Tricky']);
});

// A base is the standard shape many models start from. Its last step names it, for the list of steps and the bar of ticks,
// and a model offers on step 1 to skip a base it folds the same way as another model, for someone who knows it already.
test('a base is named at its last step, where its words say so, and a model offers to skip only a base it shares', () => {
  const ends = (m) => m.steps.flatMap((st, i) => (st.base ? [[st.base, i]] : []));
  for (const m of MODELS) {
    m.steps.forEach((st, i) => {
      const said = /this is the (\w+ base)/i.exec(st.say)?.[1];
      assert.equal(st.base?.toLowerCase(), said?.toLowerCase(), `${m.id}'s step ${i + 1} names the ${said || 'no base'}, but is marked as the end of the ${st.base || 'none'}`);
      assert.equal(once(m).steps[i].base, st.base || null, `${m.id}'s step ${i + 1} loses its base once folded`);
    });
    for (const base of m.skip || []) {
      const end = ends(m).find(([b]) => b === base);
      assert.ok(end, `${m.id} offers to skip the ${base.toLowerCase()}, which it doesn't fold`);
      const same = MODELS.filter((o) => o !== m && m.steps.slice(0, end[1] + 1).every((st, k) => o.steps[k] === st));
      assert.ok(same.length, `${m.id} offers to skip the ${base.toLowerCase()}, which no other model folds the same way`);
    }
  }
  assert.deepEqual(Object.fromEntries(MODELS.filter((m) => m.skip).map((m) => [m.id, m.skip])),
    { crane: ['Bird base'], 'flapping-bird': ['Bird base'], lily: ['Square base', 'Frog base'], frog: ['Square base', 'Frog base'] });
  assert.deepEqual(MODELS.flatMap((m) => ends(m).map(([b, i]) => `${m.id} ${b} ${i + 1}`)).filter((e) => /^(crane|frog|pinwheel|waterbomb) /.test(e)),
    ['pinwheel Windmill base 5', 'waterbomb Waterbomb base 4', 'crane Square base 6', 'crane Bird base 15', 'frog Square base 6', 'frog Frog base 28']);
});

test('js/finished.js has a picture for every model and nothing else', () => {
  assert.deepEqual(Object.keys(FINISHED), MODELS.map((m) => m.id), 'run node tools/make-thumbs.mjs');
});

test('a model that ends standing up is pictured standing, seen from where the player ends it', () => {
  const standers = MODELS.filter((m) => once(m).steps.at(-1).view).map((m) => m.id);
  assert.deepEqual(standers, ['plane', 'fortune-teller', 'crane', 'flapping-bird', 'lily']);
  for (const id of standers) {
    const b = once(MODELS.find((m) => m.id === id));
    const last = b.steps.at(-1);
    assert.deepEqual(finished(b), standing(poses(last, 1), last.view), id);
    assert.notDeepEqual(finished(b), outline(b.end), `${id} is pictured flat`);
    // In 3D the light falls on the facets unevenly, as it does in the player; flat, every facet is as bright.
    assert.ok(finished(b).some((s) => s[2] > 0.05), `${id}'s picture has no shading`);
  }
  for (const m of MODELS.filter((x) => !standers.includes(x.id))) assert.deepEqual(finished(once(m)), outline(once(m).end), m.id);
});

test('every gallery picture has a thin light edge round the paper, the same in every paper colour', () => {
  for (const [id, shapes] of Object.entries(FINISHED)) {
    for (const front of ['#d9412b', '#2f4f8f', '#3f8a57']) {
      const svg = picture(shapes, { front });
      const rim = svg.match(/<path class="rim" d="([^"]*)" fill="none" stroke="([^"]*)" stroke-width="([^"]*)"/);
      assert.ok(rim, `${id} has no light edge`);
      // Under the paper, so only the part outside it shows, and round every facet, so it follows the whole outline.
      assert.ok(svg.indexOf('<path class="rim"') < svg.indexOf('<polygon'), `${id}'s light edge is drawn over the paper`);
      assert.equal(rim[1].split('Z').filter(Boolean).length, shapes.length, id);
      assert.equal(rim[2], 'rgba(255,250,240,.75)', `${id}'s edge is not light, or changes with the paper`);
      // Thin: what shows outside the paper is half the stroke, under 1% of the picture's width.
      assert.ok(+rim[3] / 2 < 1, `${id}'s light edge is ${rim[3] / 2} of 100 wide`);
    }
  }
});

test('a standing picture draws what is nearer the camera over what is further, and the side the camera sees', () => {
  // Two squares, one above the other, given in either order: from above, the upper one is drawn last, with its front
  // showing; from below, the lower one is drawn last, and the camera sees their backs.
  const square = (z) => ({ facet: { poly: [[0, 0], [1, 0], [1, 1], [0, 1]] }, pose: { r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [z * 0.3, 0, z] } });
  for (const items of [[square(0), square(1)], [square(1), square(0)]]) {
    const above = standing(items, { yaw: -90, pitch: 60 }), below = standing(items, { yaw: -90, pitch: -60 });
    assert.deepEqual(above.map((s) => s[0]), [1, 1]);
    assert.deepEqual(below.map((s) => s[0]), [0, 0]);
    // The upper square sits further right (+x is to the right, seen from yaw -90), so it's the one whose left edge
    // is further right.
    const xs = (shape) => shape[1].split(' ').map((p) => +p.split(',')[0]);
    assert.ok(Math.min(...xs(above[1])) > Math.min(...xs(above[0])), 'from above, the upper square is not drawn last');
    assert.ok(Math.min(...xs(below[1])) < Math.min(...xs(below[0])), 'from below, the lower square is not drawn last');
  }
});

test('a step that names a corner to fold names the one that moves, as the paper lies', () => {
  // Corners are named as they lie in front of you, so on a sheet that starts white side up the paper's
  // own left and right are swapped. A corner on the fold line stays put, so it doesn't count.
  const named = /(?:^|\. )Fold the (top|bottom|left|right)(?: (left|right))? corner/;
  const toward = { top: [0, 1], bottom: [0, -1], right: [1, 0], left: [-1, 0] };
  let checked = 0;
  for (const model of MODELS) {
    for (const [i, step] of build(model).steps.entries()) {
      const m = named.exec(step.say);
      if (!m || !['fold', 'foldUnfold'].includes(step.motion.kind)) continue;
      const { from, motion } = step;
      const v = m[2] ? [toward[m[2]][0], toward[m[1]][1]] : toward[m[1]];
      const reach = (q) => q[0] * v[0] + q[1] * v[1];
      const corner = from.order.flatMap((id) => from.world(id)).reduce((best, q) => (reach(q) > reach(best) + 1e-9 ? q : best));
      const moves = motion.moving.flatMap((id) => from.world(id)).some((q) => closePt(q, corner) && Math.abs(side(motion.line, q)) > 1e-6);
      assert.ok(moves, `${model.id} step ${i + 1} says "${m[0].replace(/^\. /, '')}", but a different corner moves`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `only ${checked} steps name a corner`);
});

// A square creased on both diagonals and both middle lines, stood up on them as the fortune teller opens: the creases
// meet 45 degrees apart, so with the diagonals rising theta from the middle, the middle lines rise phi, where
// cos 45 = cos theta cos phi cos 45 + sin theta sin phi, and they close by twice those, in step with each other.
function cone(theta, wrong = 1) {
  const fold = (th) => {
    const t = th * Math.PI / 180, a = Math.cos(t) * Math.SQRT1_2, b = Math.sin(t);
    return [2 * th, 2 * (Math.atan2(b, a) - Math.acos(Math.min(1, Math.SQRT1_2 / Math.hypot(a, b)))) * 180 / Math.PI];
  };
  const [middles, diagonals] = fold(theta), ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const pace = (k) => (t) => (t > 0 ? fold(theta * ease(t))[k] / fold(theta)[k] : 0);
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]], middle = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
  return { id: 'cone', paper: { kind: 'Square' }, steps: [
    { say: 'Fold corner to corner, and unfold.', do: (h) => h.crease(h.onto([0, 0], [1, 1]), { move: [0, 0] }) },
    { say: 'Fold the other corners together, and unfold.', do: (h) => h.crease(h.onto([1, 0], [0, 1]), { move: [1, 0] }) },
    { say: 'Fold in half behind, and unfold.', do: (h) => h.crease(h.onto([0, 0], [0, 1]), { move: [0, 0], type: 'mountain' }) },
    { say: 'Fold in half behind the other way, and unfold.', do: (h) => h.crease(h.onto([0, 0], [1, 0]), { move: [0, 0], type: 'mountain' }) },
    { say: 'Push the middles of the edges down: the middle rises.', do: (h) => {
      const c = h.at([0.5, 0.5]);
      return h.standUp({
        root: [0.4, 0.2], level: corners,
        creases: [
          ...middle.map((q) => ({ a: c, b: h.at(q), fold: -middles * wrong, schedule: pace(0) })),
          ...corners.map((q) => ({ a: c, b: h.at(q), fold: diagonals, schedule: pace(1) })),
        ],
      });
    } },
  ] };
}

test('a square stands up on its creases as one linked motion, rising evenly, and ends standing with its paper as it lay', () => {
  const b = build(cone(60));
  const last = b.steps.at(-1);
  assert.ok(last.motion.stands && last.motion.kind === 'mech');
  assert.deepEqual(last.to.order, last.from.order, 'standing up restacked the paper');
  const at = (t, q) => { const id = last.from.facetAt(q).id; return transformPoint(poses(last, t).find((it) => it.facet.id === id).pose, ...q); };
  // The corners stay level as they come in, each the way it started from the middle; the middle rises above them.
  for (const t of [0.25, 0.5, 1]) {
    const mid = at(t, [0.5, 0.5]), ks = [[0, 0], [1, 0], [1, 1], [0, 1]].map((q) => at(t, q));
    for (const [k, p] of ks.entries()) {
      // (To within how closely the solver keeps the paper joined on the way.)
      assert.ok(close(p[2], ks[0][2], 1e-6), `at t=${t} the corners aren't level`);
      const start = last.from.at([[0, 0], [1, 0], [1, 1], [0, 1]][k]);
      assert.ok(Math.abs(Math.atan2(p[1] - mid[1], p[0] - mid[0]) - Math.atan2(start[1], start[0])) < 1e-6, `at t=${t} the model turned round`);
    }
    if (t === 1) assert.ok(close(mid[2] - ks[0][2], Math.SQRT1_2 * Math.sin(Math.PI / 3), 1e-6), `the middle ends ${(mid[2] - ks[0][2]).toFixed(4)} above the corners`);
  }
  // Marked as a diagram would: the middle lines as mountains and the diagonals as valleys, seen from above.
  assert.deepEqual(marks(last).map((m) => m.type), ['mountain', 'mountain', 'mountain', 'mountain', 'valley', 'valley', 'valley', 'valley']);
  // Creases that can't all close that far together are refused.
  assert.throws(() => build(cone(60, 1.25)), /cone step 5: The (paper jams on the way|creases don't close up)/);
});

test('the checker catches paper passing through paper', () => {
  // Fold in half and in half again: two folds lie along the second crease, one nested inside the other.
  const half = fold(Sheet.square(), { p: [0, 0], d: [0, 1] }, { type: 'valley' }).to;
  const quarter = fold(half, { p: [0, 0], d: [1, 0] }, { type: 'valley' }).to;
  assert.deepEqual(crossings(quarter), []);
  // Restack the four layers so those two folds interleave, as if one had pushed through the other.
  const pairs = [];
  for (const f of quarter.facets.values()) {
    for (const { g, edge } of quarter.neighbors(f)) {
      const a = apply(f.m, edge[0]), b = apply(f.m, edge[1]);
      if (g.id > f.id && Math.abs(a[1]) < 1e-9 && Math.abs(b[1]) < 1e-9) pairs.push([f.id, g.id]);
    }
  }
  assert.equal(pairs.length, 2);
  const s = quarter.clone();
  s.order = [pairs[0][0], pairs[1][0], pairs[0][1], pairs[1][1]];
  s._levels = null;
  assert.ok(crossings(s).length > 0, 'interleaved folds went unnoticed');
});

test('crane: a petal fold lays the petal over the top of the base, with its sides folded onto it', () => {
  const b = build(MODELS.find((m) => m.id === 'crane'));
  const petal = b.steps.find((st) => st.name === 'Petal fold');
  const to = petal.to;
  const pos = new Map(to.order.map((id, k) => [id, k]));
  const holding = (q) => [...to.facets.values()].filter((f) => inside(f.poly, q)).map((f) => f.id);
  // Paper points: on the petal, on the part of the base it folds over, and on one of the sides.
  const [petalId] = holding([0.85, 0.75]), [topId] = holding([0.6, 0.55]), [sideId] = holding([0.95, 0.7]);
  assert.ok(pos.get(petalId) > pos.get(topId), 'the petal is not over the top of the base');
  assert.ok(pos.get(sideId) > pos.get(petalId), 'the side is not folded onto the petal');
});

test('frog: each petal fold comes after a step that creases the face along the sides it folds in', () => {
  const b = once(MODELS.find((m) => m.id === 'frog'));
  const petals = b.steps.map((st, i) => [st, i]).filter(([st]) => st.name === 'Petal fold');
  assert.equal(petals.length, 4);
  for (const [petal, i] of petals) {
    const guide = b.steps[i - 1];
    assert.ok(guide.motion.folded && guide.name === 'Fold and unfold', `frog step ${i}: ${guide.name}, not a fold and unfold`);
    // The sides fold in along the face's two marked mountain creases, from its bottom corner: each lies along a line the
    // step before folded and unfolded.
    const sides = petal.motion.specs.filter((sp) => sp.fold === 'mountain' && sp.mark !== false);
    assert.equal(sides.length, 2);
    for (const sp of sides) {
      const [a, c] = [petal.from.at(sp.a), petal.from.at(sp.b)];
      assert.ok(guide.motion.parts.some((p) => Math.abs(side(p.line, a)) < 1e-9 && Math.abs(side(p.line, c)) < 1e-9), `frog step ${i + 1}: no crease along ${sp.a}-${sp.b}`);
    }
    assert.match(petal.say + guide.say, /crease/i, `frog steps ${i}-${i + 1} don't say the creases guide it`);
  }
});

// The dog's face as Origami-Instructions.com shows it: the triangle's corners fold down from the top of its middle crease
// and hang out past the sides of the face, and its top and its chin fold behind, leaving the ears below the chin.
test('dog face: its ears hang out past the sides of its face, below its chin, and its top and chin fold behind', () => {
  const dog = MODELS.find((m) => m.id === 'dog');
  assert.ok(dog, 'there is no dog face');
  const b = once(dog), tri = b.steps[1].to, ears = b.steps[2].to;
  const bottom = tri.at([1, 0]), top = tri.at([0.5, 0.5]);
  for (const [corner, ear] of [[[1, 1], [1, 1]], [[0, 0], [0, 0]]]) {
    const edge = line(tri.at(corner), bottom), tip = ears.at(ear);
    assert.ok(side(edge, tip) * side(edge, top) < 0 && tip[1] < top[1] - 0.5, `the ear from paper corner ${ear} doesn't hang out past the face`);
  }
  const end = b.end, chin = end.at([1, 0]);
  assert.ok(chin[1] > bottom[1] + 0.1 && chin[1] > end.at([1, 1])[1], 'the chin is not folded up behind, above the ears');
  assert.ok(end.order.indexOf(end.facetAt([0.97, 0.03]).id) < end.order.indexOf(end.facetAt([0.5, 0.3]).id), 'the chin is not behind the face');
  const highest = end.order.flatMap((id) => end.world(id)).filter((q) => Math.abs(q[1] - end.bounds().y1) < 1e-9);
  assert.ok(Math.max(...highest.map((q) => q[0])) - Math.min(...highest.map((q) => q[0])) > 0.1, 'the top of the head is not flat');
});

// The paper hat as Origami-Instructions.com shows it: a sheet folded in half, its top corners folded in to meet at the
// middle in a triangle, and the strip under the triangle folded up on each side, one in front and one behind.
test('paper hat: a triangle on top, with a brim folded up on each side, one in front and one behind', () => {
  const hat = MODELS.find((m) => m.id === 'hat');
  assert.ok(hat, 'there is no paper hat');
  const b = once(hat), end = b.end;
  const top = end.at([0.5, Math.SQRT2 / 2]), base = b.steps[2].to.at([0, Math.SQRT2 / 2 - 0.5]);
  assert.ok(close(top[1], end.bounds().y1), 'the point of the triangle is not the top of the hat');
  // The sheet's two short edges: each folded up over the bottom of the triangle, the same height.
  const front = end.at([0.5, Math.SQRT2]), back = end.at([0.5, 0]);
  assert.ok(close(front[1], back[1]) && front[1] > base[1] + 0.1, 'the brims are not both folded up');
  // Off the middle crease, where each side's layers are whole, the two brims are the bottom and top of the stack.
  for (const x of [0.3, 0.7]) {
    const brims = [end.facetAt([x, Math.SQRT2 - 0.01]).id, end.facetAt([x, 0.01]).id];
    const stack = end.order.filter((id) => covers(end.world(id), end.at([x, 0.01]), -1e-9));
    assert.deepEqual([stack[0], stack.at(-1)].sort(), brims.sort(), `the brims are not outside, one in front and one behind, ${x} across`);
  }
  assert.ok(close(end.bounds().x1 - end.bounds().x0, 1), 'the hat is not as wide as the sheet');
});

// The pinwheel as origami.me draws it: the windmill base, a flat hexagon as wide as the paper and half as tall, and then
// its four points, the paper's corners, sticking out the four ways round the middle, a quarter turn apart.
test('pinwheel: the windmill base folds flat, and its four points end a quarter turn apart round the middle', () => {
  const pinwheel = MODELS.find((m) => m.id === 'pinwheel');
  assert.ok(pinwheel, 'there is no pinwheel');
  const b = once(pinwheel);
  const base = b.steps.findIndex((st) => /windmill base/.test(st.say));
  assert.ok(base > 0 && b.steps[base].motion.kind === 'mech' && b.steps[base - 1].motion.kind === 'mech', 'the windmill base is not made by pulling the corners out at each end');
  const w = b.steps[base].to.bounds();
  assert.ok(close(w.x1 - w.x0, 1) && close(w.y1 - w.y0, 0.5), `the windmill base is ${(w.x1 - w.x0).toFixed(3)} by ${(w.y1 - w.y0).toFixed(3)}`);
  const c = b.end.at([0.5, 0.5]);
  const tips = [[0, 0], [1, 0], [1, 1], [0, 1]].map((q) => { const p = b.end.at(q); return [p[0] - c[0], p[1] - c[1]]; });
  // Each point turned a quarter turn about the middle lands on the next.
  for (const [x, y] of tips) assert.ok(tips.some(([u, v]) => close(u, -y) && close(v, x)), `no point a quarter turn on from ${x.toFixed(3)}, ${y.toFixed(3)}`);
  assert.ok(tips.every(([x, y]) => close(Math.hypot(x, y), 0.5)), 'the points are not all half the paper out from the middle');
});

// The lily as origami.me draws it: the frog base with its four long points folded down, each face's edges at the closed
// end folded in to the middle line, and the petals opened out from a long stem.
test('lily: from the frog base it narrows to a long stem, and stands on it with its petals open', () => {
  const lily = MODELS.find((m) => m.id === 'lily');
  assert.ok(lily, 'there is no lily');
  const b = once(lily), frog = once(MODELS.find((m) => m.id === 'frog'));
  // The frog base: the same twenty-eight steps as the frog's.
  const base = frog.steps.findIndex((st) => /This is the frog base/.test(st.say)) + 1;
  assert.equal(base, 28);
  assert.deepEqual(lily.steps.slice(0, base), MODELS.find((m) => m.id === 'frog').steps.slice(0, base));
  // Narrowed: at the closed end every face's edges meet the middle line, so the paper there is only as wide as
  // the creases at 11.25 degrees either side of it allow.
  const narrow = b.steps.at(-2).to, c = narrow.at([0.5, 0.5]);
  const near = narrow.order.flatMap((id) => narrow.world(id)).filter((q) => Math.abs(q[1] - c[1]) < 0.25);
  const half = Math.max(...near.map((q) => Math.abs(q[0] - c[0])));
  assert.ok(half < 0.25 * Math.tan(Math.PI / 16) + 1e-9, `the stem is ${(2 * half).toFixed(3)} wide a quarter of the way up`);
  // Standing: the closed end lowest, on the mat, and all four petal points above it; the front and back petals
  // bent out, lower than the two between them.
  const last = b.steps.at(-1), items = poses(last, 1).filter((it) => !it.bridge);
  const where = (q) => { const it = items.find((x) => covers(x.facet.poly, q, 1e-9)); return transformPoint(it.pose, ...q); };
  const z = (q) => where(q)[2];
  assert.ok(z([0.5, 0.5]) < 0.01, 'the lily does not stand on its stem');
  const tips = [[0, 0], [1, 0], [1, 1], [0, 1]].map(z);
  assert.ok(tips.every((t) => t > 0.2), `the petal points are not up above the stem: ${tips.map((t) => t.toFixed(2))}`);
  const [k1, k2, k3, k4] = tips;
  assert.ok(Math.max(k1, k3) < Math.min(k2, k4) - 0.1, 'the front and back petals are not bent out');
});

test('fortune teller: its last step opens it into its four points, up and together, with the squares outside', () => {
  const b = once(MODELS.find((m) => m.id === 'fortune-teller'));
  const last = b.steps.at(-1);
  assert.ok(last.motion.stands && last.view, 'the fortune teller ends flat');
  const end = poses(last, 1);
  const at = (q) => { const id = last.from.facetAt(q).id; return transformPoint(end.find((it) => it.facet.id === id).pose, ...q); };
  // The paper's middle at the bottom, the four corners round it at the top, level and the same way out from the middle.
  const mid = at([0.5, 0.5]), points = [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]].map(at);
  for (const p of points) {
    assert.ok(p[2] > mid[2] + 0.25, `a point is ${(p[2] - mid[2]).toFixed(3)} above the middle`);
    assert.ok(close(p[2], points[0][2], 1e-6), 'the points are not level');
    const out = Math.hypot(p[0] - mid[0], p[1] - mid[1]);
    assert.ok(out > 0.1 && out < 0.2, `a point is ${out.toFixed(3)} out from the middle, not near the others`);
  }
  // The colored squares, where you write the colors, face out.
  for (const q of [[0.1, 0.05], [0.95, 0.9], [0.05, 0.9], [0.9, 0.1]]) {
    const it = end.find((x) => x.facet.id === last.from.facetAt(q).id), p = transformPoint(it.pose, ...q);
    const front = [it.pose.r[2], it.pose.r[5], it.pose.r[8]];
    assert.ok(front[0] * (p[0] - mid[0]) + front[1] * (p[1] - mid[1]) > 0, `the colored square at ${q} faces in`);
  }
});

test('jumping frog: its front legs stick out past the sides of its head, where they can be seen', () => {
  const b = once(MODELS.find((m) => m.id === 'jumping-frog'));
  const [, tall] = b.model.paper.size;
  // The body, folded in from both sides, and the head on top of it.
  const body = b.end.world(b.end.facetAt([0.5, 0.2]).id), xs = body.map((q) => q[0]);
  const [left, right, top] = [Math.min(...xs), Math.max(...xs), Math.max(...body.map((q) => q[1]))];
  // Each leg's point is the card's top corner, folded up to the top of the head and then out to its side.
  for (const q of [[0, tall], [1, tall]]) {
    const [x, y] = b.end.at(q);
    assert.ok(x < left - 0.02 || x > right + 0.02, `the leg from corner ${q} ends at x ${x.toFixed(3)}, within the body's ${left.toFixed(3)} to ${right.toFixed(3)}`);
    assert.ok(y > top, `the leg from corner ${q} ends level with the body, not beside the head`);
  }
  const legs = b.steps.findIndex((st) => /front legs/.test(st.say));
  assert.equal(legs, 5, 'the front legs are not folded out straight after the flaps go up');
});

// The cicada as origami.me draws it: the wings fold down slanted so their points stick out past the diamond, the two layers
// of the top corner fold down one a little short of the other so a strip of white shows between them, and the sides
// fold behind, leaving it narrower than the diamond and even on both sides.
test('cicada: its wings stick out past the diamond, a strip of white shows under its head, and its sides go behind', () => {
  const cicada = MODELS.find((m) => m.id === 'cicada');
  assert.ok(cicada, 'there is no cicada');
  const b = once(cicada), after = (n) => b.steps[n - 1].to;
  const wings = after(3), c = wings.at([0.5, 0.5]), top = wings.at([0, 1]);
  // The diamond's side corners, with the paper corner that folds up to the top and down again as each wing.
  for (const [corner, tip] of [[[0.5, 1], [1, 1]], [[0, 0.5], [0, 0]]]) {
    const edge = line(c, wings.at(corner));
    assert.ok(side(edge, wings.at(tip)) * side(edge, top) < -1e-6, `the wing from paper corner ${tip} doesn't stick out past the diamond`);
  }
  const layers = after(5), first = layers.at([1, 0]), last = layers.at([0, 1]);
  assert.ok(last[1] > first[1] + 0.02 && Math.abs(last[0] - first[0]) < 1e-9, 'the last layer does not stop short of the first, in line with it');
  const strip = layers.topAt([first[0], (first[1] + last[1]) / 2]);
  assert.ok(strip && det(strip.m) < 0, 'no white shows between the two layers folded down');
  const diamond = after(2).bounds(), end = b.end.bounds();
  assert.ok(end.x1 - end.x0 < 0.75 * (diamond.x1 - diamond.x0), 'the sides did not go behind');
  assert.ok(Math.abs(end.cx - diamond.cx) < 1e-9, 'the cicada is not even on both sides');
});

test('crane: each reverse-folded point ends up between the front and back of the model', () => {
  const b = build(MODELS.find((m) => m.id === 'crane'));
  const split = line([1, 0], [0, 1]);
  const front = (f) => side(split, centroid(f.poly)) < 0; // the half with the corner that faces you
  const reversed = b.steps.filter((st) => st.motion.kind === 'reverse' || st.motion.parts?.length && st.motion.kind === 'mech');
  assert.equal(reversed.length, 3, 'the crane should have three reverse folds: neck, tail and head');
  for (const step of reversed) {
    const { to, motion } = step;
    const tips = motion.parts ? motion.parts.flatMap((p) => p.moving) : motion.moving;
    const moved = new Set(tips);
    const pos = new Map(to.order.map((id, k) => [id, k]));
    const frontIsLow = front(to.facets.get(to.order[0]));
    for (const m of tips) {
      for (const id of to.order) {
        if (moved.has(id) || overlapArea(to.world(m), to.world(id)) < 1e-7) continue;
        const inFront = front(to.facets.get(id)) !== frontIsLow;
        assert.equal(pos.get(id) > pos.get(m), inFront, `${step.say.slice(0, 30)}: layer ${id} is on the wrong side of the tip`);
      }
    }
  }
});

test('crane: halfway through the neck\'s reverse fold the page lies open on top of the left half, and the model stays on the mat', () => {
  const step = once(MODELS.find((m) => m.id === 'crane')).steps[18];
  const at = (t) => new Map(poses(step, t).filter((it) => !it.bridge).map((it) => [it.facet.id, it]));
  const start = at(0), half = at(0.5);
  const height = (it) => corners(it)[0][2];
  const footprint = (it) => ccw(corners(it).map((p) => [p[0], p[1]]));
  // The page is the paper turned over by then; everything else lies as it did, or has yet to move.
  const page = [...half.keys()].filter((id) => Math.sign(half.get(id).pose.r[8]) !== Math.sign(start.get(id).pose.r[8]));
  assert.ok(page.length >= 4, `only ${page.length} pieces turned over with the page`);
  const under = [];
  for (const p of page) {
    for (const [id, it] of half) {
      if (page.includes(id) || overlapArea(footprint(half.get(p)), footprint(it)) < 1e-6) continue;
      if (height(half.get(p)) <= height(it)) under.push(`${p} at ${height(half.get(p)).toFixed(4)} under ${id} at ${height(it).toFixed(4)}`);
    }
  }
  assert.deepEqual(under, [], 'the page goes under the layers it opens out onto');
  // The layers that don't move stay where they lie, the lowest on the mat, rather than being lifted to make room.
  const still = [...half.keys()].filter((id) => !step.motion.moving.includes(id));
  for (const id of still) assert.ok(close(height(half.get(id)), height(start.get(id))), `layer ${id} rose from ${height(start.get(id))} to ${height(half.get(id))}`);
  assert.ok(close(Math.min(...still.map((id) => height(half.get(id)))), 0), 'the lowest layer is off the mat');
});

// The mark drawn along the crease between paper points a and b, as the paper lies before the step.
function markOn(step, a, b) {
  const p = step.from.at(a), q = step.from.at(b);
  const on = (m, x, y) => closePt(m.line[0].slice(0, 2), x, 1e-9) && closePt(m.line[1].slice(0, 2), y, 1e-9);
  return (marks(step) || []).find((m) => m.line && (on(m, p, q) || on(m, q, p)));
}

test('a collapse is marked as it is seen from above, white side up, so the creases made as valleys show as valleys', () => {
  const K1 = [0, 0], K2 = [1, 0], K3 = [1, 1], K4 = [0, 1], C = [0.5, 0.5];
  const M12 = [0.5, 0], M23 = [1, 0.5], M34 = [0.5, 1], M41 = [0, 0.5];
  const crane = build(MODELS.find((m) => m.id === 'crane')).steps;
  // Steps 4 and 5 fold the book folds as valleys on the white side; steps 1 and 2 the diagonals on the colored side.
  for (const q of [M12, M23, M34, M41]) assert.equal(markOn(crane[5], C, q)?.type, 'valley', `crane step 6: C to ${q}`);
  for (const q of [K2, K4]) assert.equal(markOn(crane[5], C, q)?.type, 'mountain', `crane step 6: C to ${q}`);
  // The waterbomb is the other way about: diagonals made as valleys, the middle as a mountain (steps 1 to 3).
  const wb = build(MODELS.find((m) => m.id === 'waterbomb')).steps;
  for (const q of [K1, K2, K3, K4]) assert.equal(markOn(wb[3], C, q)?.type, 'valley', `waterbomb step 4: C to ${q}`);
  for (const q of [M41, M23]) assert.equal(markOn(wb[3], C, q)?.type, 'mountain', `waterbomb step 4: C to ${q}`);
  // A petal fold lies colored side up, so its marks are as written: the valley across, mountains up the sides.
  const P23 = [1 - (Math.SQRT2 - 1) / 2, 0.5], P34 = [0.5, 1 - (Math.SQRT2 - 1) / 2];
  assert.equal(markOn(crane[9], P23, P34)?.type, 'valley');
  assert.equal(markOn(crane[9], K3, P23)?.type, 'mountain');
  assert.equal(markOn(crane[9], K3, P34)?.type, 'mountain');
});

test('each arrow has the head a diagram gives it: solid for a valley fold, hollow on one side for a mountain fold, hollow on both to unfold', () => {
  const steps = (id) => build(MODELS.find((m) => m.id === id)).steps;
  const arrows = (step) => (marks(step) || []).filter((m) => m.arrow && !m.path).map((m) => m.arrow);
  const heads = (step) => arrows(step).map((a) => `${a.head}${a.back ? '+back' : ''}`);
  const cup = steps('cup'), crane = steps('crane'), wb = steps('waterbomb'), bird = steps('flapping-bird');
  assert.deepEqual(heads(cup[0]), ['valley']);
  assert.deepEqual(heads(cup[4]), ['mountain'], "the cup's step 5 folds behind");
  // A fold and unfold has a hollow head at its tail too, for coming back.
  assert.deepEqual(heads(crane[0]), ['valley+back']);
  assert.deepEqual(heads(wb[2]), ['mountain+back'], "the waterbomb's step 3 folds behind and unfolds");
  assert.deepEqual(heads(crane[18]), ['mountain'], 'an inside reverse fold is marked as a mountain fold');
  // The crane's and the flapping bird's side flaps open again before each petal fold.
  for (const [id, s] of [['crane', crane], ['flapping-bird', bird]]) {
    for (const i of [8, 13]) {
      assert.equal(s[i].name, 'Unfold');
      assert.deepEqual(heads(s[i]), ['unfold', 'unfold'], `${id} step ${i + 1}`);
      assert.ok(marks(s[i]).every((m) => m.unfold), `${id} step ${i + 1} draws a new fold line`);
    }
  }
  let n = 0;
  for (const model of MODELS) {
    for (const [i, step] of build(model).steps.entries()) {
      for (const a of arrows(step)) {
        assert.ok(['valley', 'mountain', 'unfold'].includes(a.head), `${model.id} step ${i + 1}: head ${a.head}`);
        assert.equal(!!a.back, !!step.motion.folded, `${model.id} step ${i + 1}`);
        if (!step.unfold) assert.equal(a.head === 'mountain', !a.over, `${model.id} step ${i + 1}: a mountain arrow goes behind`);
        n++;
      }
    }
  }
  assert.ok(n > 100, `only ${n} arrows`);
});

function inside(poly, q) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > q[1]) !== (yj > q[1]) && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

test('each step is labelled with the symbol for what it draws: Rotate its own, mixed folds both lines, every inside reverse fold a mountain', () => {
  const steps = (id) => build(MODELS.find((m) => m.id === id)).steps;
  const crane = steps('crane'), frog = steps('frog');
  assert.equal(symbol(steps('plane')[4]), 'rotate');
  assert.equal(symbol(frog[28]), 'rotate');
  assert.equal(symbol(steps('fortune-teller')[3]), 'turnOver');
  assert.equal(symbol(crane[8]), 'unfold');
  assert.equal(symbol(crane[5]), 'both', 'a collapse');
  assert.equal(symbol(crane[9]), 'both', 'a petal fold');
  assert.equal(symbol(crane[21]), 'both', 'valley and mountain');
  assert.equal(symbol(frog[6]), 'valley', 'a squash fold draws one valley line');
  assert.equal(symbol(steps('cup')[4]), 'mountain');
  for (const model of MODELS) {
    for (const [i, step] of build(model).steps.entries()) {
      if (/inside reverse/i.test(step.name)) assert.equal(symbol(step), 'mountain', `${model.id} step ${i + 1}`);
    }
  }
});

test('turning the model over or around draws its symbol on the table just in front of it, the way it turns', () => {
  let n = 0;
  for (const model of MODELS) {
    for (const [i, step] of build(model).steps.entries()) {
      const kind = step.motion.kind;
      if (kind !== 'turnOver' && kind !== 'turn') continue;
      const where = `${model.id} step ${i + 1}`;
      const m = marks(step);
      assert.equal(m?.length, 1, where);
      const [{ type, path, arrow }] = m;
      assert.equal(type, kind === 'turnOver' ? 'turnOver' : 'rotate', where);
      assert.equal(arrow.head, 'valley', where);
      // Flat on the table, clear of the paper, in front of it and no wider than it.
      const b = step.from.bounds(), size = Math.max(b.x1 - b.x0, b.y1 - b.y0, 0.55);
      for (const q of path) {
        assert.ok(q[2] > 0 && q[2] < 0.002, `${where} is not on the table`);
        assert.ok(q[1] < b.y0 - 0.01 && q[1] > b.y0 - 0.4 * size, `${where} is not just in front of the model`);
        assert.ok(Math.abs(q[0] - b.cx) < 0.3 * size, `${where} reaches past the model's sides`);
      }
      const dx = path.at(-1)[0] - path[0][0];
      if (kind === 'turnOver') assert.ok(dx > 0.1 * size, `${where}: the left edge comes up and over to the right`);
      else {
        // Which way round it goes: counterclockwise for a positive turn.
        let turning = 0;
        for (let k = 1; k < path.length - 1; k++) {
          const u = [path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]], v = [path[k + 1][0] - path[k][0], path[k + 1][1] - path[k][1]];
          turning += u[0] * v[1] - u[1] * v[0];
        }
        assert.equal(Math.sign(turning), Math.sign(step.motion.deg), where);
      }
      n++;
    }
  }
  assert.equal(n, 24, 'twenty-two steps turn a model over and two turn it around');
});

test('folds made together along one line share the line, and their arrows sit side by side', () => {
  const steps = (id) => build(MODELS.find((m) => m.id === id)).steps;
  const crane = steps('crane'), frog = steps('frog');
  // Both wings at once: one valley line, the front wing's valley arrow and the back wing's mountain arrow apart.
  for (const step of [crane[21], crane[22], frog[29], steps('flapping-bird')[18], steps('plane')[7]]) {
    const m = marks(step);
    assert.deepEqual(m.map((k) => [k.type, !!k.line]), [['valley', true], ['mountain', false]], step.say);
    const along = (q) => (q[0] - m[0].line[0][0]) * (m[0].line[1][0] - m[0].line[0][0]) + (q[1] - m[0].line[0][1]) * (m[0].line[1][1] - m[0].line[0][1]);
    assert.ok(Math.abs(along(m[0].arrow.from) - along(m[1].arrow.from)) > 0.02, `${step.say}: the arrows lie on top of each other`);
  }
  // Two layers turned together the same way: one line, one arrow.
  for (const step of [frog[21], frog[25]]) assert.equal(marks(step).length, 1, step.say);
  // Corners folded to the middle: the lines meet at their ends rather than crossing.
  const ft = marks(steps('fortune-teller')[2]);
  assert.equal(ft.length, 4);
  for (const m of ft) {
    for (const q of m.line) {
      const meets = ft.filter((o) => o !== m && o.line.some((e) => closePt(e.slice(0, 2), q.slice(0, 2), 1e-9))).length;
      assert.equal(meets, 1, 'a line runs on past the end of the next one');
    }
  }
});

test('every arrow starts on the paper that moves and ends on paper where it lands, and every fold line crosses paper', () => {
  // On a facet or its edge (facets are convex).
  const onPaper = (sheet, q) => sheet.order.some((id) => covers(sheet.world(id), q, 1e-6));
  const problems = [];
  for (const model of MODELS) {
    for (const [i, step] of build(model).steps.entries()) {
      const { motion } = step;
      if (motion.kind === 'turnOver' || motion.kind === 'turn') continue;
      const where = `${model.id} step ${i + 1}`;
      const landing = motion.folded || step.to;
      const bends = motion.kind === 'bend' || motion.parts?.some((p) => p.bend);
      const moving = motion.kind === 'mech' ? null : new Set(motion.moving || motion.parts?.flatMap((p) => p.moving || []) || []);
      for (const m of marks(step)) {
        if (m.line) {
          const [a, b] = m.line;
          for (let s = 0.15; s <= 0.85 + 1e-9; s += 0.05) {
            if (!onPaper(step.from, [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s])) { problems.push(`${where}: its line runs off the paper`); break; }
          }
        }
        if (!m.arrow) continue;
        const f = m.arrow.from.slice(0, 2), t = m.arrow.to.slice(0, 2);
        if (moving?.size && ![...moving].some((id) => covers(step.from.world(id), f, 1e-6))) problems.push(`${where}: its arrow starts off the paper that moves, at ${f.map((x) => x.toFixed(3))}`);
        if (!bends && !onPaper(landing, t)) problems.push(`${where}: its arrow ends off the paper, at ${t.map((x) => x.toFixed(3))}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('a fold line is drawn only where there is paper, even where the moving paper touches the line at a lone corner', () => {
  // The paper that moves meets the line along one short edge, and at one corner of another piece further along:
  // the line ran on between them, over the table.
  const b = build({ id: 'gap', steps: [
    { say: 'Fold along the line through these two points.', do: (h) => h.valley(h.through([0.125, 0.25], [0.375, 0.625]), { move: [0.25, 0.625] }) },
    { say: 'Fold the right edge behind.', do: (h) => h.mountain(h.onto([0.875, 0.625], [0.875, 0]), { move: [0.875, 0.625] }) },
    { say: 'Fold along the line through these two points.', do: (h) => h.valley(h.through([0.125, 0], [0.625, 1]), { move: [0.375, 0.75] }) },
  ] });
  const step = b.steps[2];
  const [m] = marks(step);
  const onPaper = (q) => step.from.order.some((id) => covers(step.from.world(id), q, 1e-6));
  const [a, c] = m.line;
  const off = [];
  for (let s = 0.15; s <= 0.85 + 1e-9; s += 0.05) if (!onPaper([a[0] + (c[0] - a[0]) * s, a[1] + (c[1] - a[1]) * s])) off.push(+s.toFixed(2));
  assert.deepEqual(off, [], 'the line runs over the table');
});

// A flap bent part way never lands, so it isn't tucked anywhere, though folded flat it would land under paper that stays
// put. The lily's petals, bent out as it stands up, had their arrows broken like a tuck's.
// Printing a model draws each step flat, as a printed diagram does: the paper as the step starts, from above, and over
// it the marks the player draws, seen from above too.
test('a printed step draws its paper as the step starts and each of its marks, inside the drawing and one weight in all', () => {
  const widths = new Set();
  for (const model of MODELS) {
    once(model).steps.forEach((s, i) => {
      const where = `${model.id} step ${i + 1}`;
      const ms = marks(s) || [];
      const svg = diagram(s, ms, { front: '#aabbcc' });
      // Every facet, in the paper's colour where its front is up and white where its back is.
      const fills = [...svg.matchAll(/<polygon points="[^"]*" fill="(#[0-9a-f]{6})" stroke="#4a443c"/g)].map((m) => m[1]);
      assert.equal(fills.length, s.from.facets.size, `${where}: not every facet is drawn`);
      assert.deepEqual(fills, s.from.order.map((id) => (det(s.from.facets.get(id).m) > 0 ? '#aabbcc' : '#ffffff')), `${where}: the paper's colours`);
      // A dashed line for each valley fold, dashes and dots for each mountain fold, and none to open a fold out.
      const lines = [...svg.matchAll(/<path class="line (valley|mountain)" d="[^"]*" stroke="#1d1b18" stroke-width="([\d.]+)" stroke-dasharray="([^"]+)"/g)];
      assert.deepEqual(lines.map((m) => m[1]), ms.filter((m) => m.line && !m.unfold).map((m) => m.type), `${where}: the fold lines`);
      for (const [, type, w, dash] of lines) { assert.equal(dash.split(' ').length, type === 'mountain' ? 4 : 2, where); widths.add(w); }
      // Each arrow, or the symbol for turning the model over or around, with the head the player gives it, and one
      // to unfold at the tail of a fold and unfold. A tuck's arrow breaks where it goes in under the pocket.
      const want = ms.filter((m) => m.path || m.arrow);
      const groups = [...svg.matchAll(/<g class="(arrow|turnOver|rotate)">(.*?)<\/g>/g)];
      assert.deepEqual(groups.map((g) => g[1]), want.map((m) => (m.path ? m.type : 'arrow')), `${where}: the arrows and symbols`);
      groups.forEach(([, , g], k) => {
        const a = want[k].arrow;
        assert.deepEqual([...g.matchAll(/class="head (\w+)"/g)].map((h) => h[1]), [a.head || 'valley', ...(a.back ? ['unfold'] : [])], `${where}: an arrow's heads`);
        assert.equal(g.match(/class="shaft" d="([^"]*)"/)[1].split('M').length - 1, a.tuck ? 2 : 1, `${where}: a tuck's arrow doesn't break, or another does`);
      });
      // All of it in the drawing's box, the symbols beside the model and the arrows' heads too.
      const nums = [...svg.matchAll(/ (?:points|d)="([^"]*)"/g)].flatMap((m) => m[1].match(/-?\d+(\.\d+)?/g).map(Number));
      assert.ok(nums.every((v) => v >= 0 && v <= 100), `${where}: a mark goes outside the drawing`);
    });
  }
  assert.equal(widths.size, 1, `fold lines are drawn at different weights: ${[...widths]}`);
});

// Beside the fold's name, the player pictures the paper as the step leaves it, as the gallery pictures a finished model.
test('each step\'s result is pictured as the step leaves the paper, and the last step\'s is the gallery\'s picture', () => {
  for (const model of MODELS) {
    const b = once(model);
    b.steps.forEach((s, i) => {
      const shapes = after(s);
      if (s.view) assert.equal(shapes.length, poses(s, 1).length, `${model.id} step ${i + 1}`);
      else assert.deepEqual(shapes, outline(s.to), `${model.id} step ${i + 1}`);
    });
    assert.deepEqual(after(b.steps.at(-1)), FINISHED[model.id], `${model.id}'s last step is not pictured as its card is`);
  }
});

test('a flap bent part way is never marked as tucked into a pocket', () => {
  const model = { id: 'bent', paper: { kind: 'Square' }, steps: [{
    say: 'Bend the left edge up, most of the way over.',
    do: (h) => h.shape([(k) => k.bend(k.upright(-0.25), 145, { move: [0.05, 0.5] })]),
  }] };
  const m = marks(build(model).steps[0]);
  assert.equal(m.length, 1);
  assert.equal(m[0].arrow.angle, 145);
  assert.ok(!m[0].arrow.tuck, 'the bend is marked as a tuck');
});

test('a tuck is marked as one: its arrow breaks where the point goes in under the pocket', () => {
  const tucks = [];
  for (const model of MODELS) {
    for (const [i, step] of build(model).steps.entries()) {
      const n = (marks(step) || []).filter((m) => m.arrow?.tuck).length;
      if (n) tucks.push(`${model.id} ${i + 1}: ${n}`);
    }
  }
  assert.deepEqual(tucks, ['waterbomb 8: 2', 'waterbomb 13: 2']);
});

// ---------- Random folds ----------
// Sequences of plain folds the models could ask for, from a fixed seed, so a run is the same every time. Each one is
// either refused in the engine's own words or folds into paper that could be real, moves without anything passing
// through anything, and is marked where the paper is.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FOLDS = ['valley', 'mountain', 'crease', 'flap valley', 'flap mountain', 'turn over', 'turn'];
function randomStep(r) {
  // Paper points, mostly on a grid of eighths, where folds meet corners and each other's ends.
  const point = () => (r() < 0.8 ? [Math.round(r() * 8) / 8, Math.round(r() * 8) / 8] : [+r().toFixed(3), +r().toFixed(3)]);
  const kind = FOLDS[Math.floor(r() * FOLDS.length)];
  const a = point();
  let b = point();
  while (a[0] === b[0] && a[1] === b[1]) b = point();
  const c = point();
  const say = `${kind} ${JSON.stringify([a, b, c])}`;
  switch (kind) {
    case 'valley': return { say, do: (h) => h.valley(h.onto(a, b), { move: a }) };
    case 'mountain': return { say, do: (h) => h.mountain(h.onto(a, b), { move: a }) };
    case 'crease': return { say, do: (h) => h.crease(h.onto(a, b), { move: a }) };
    case 'flap valley': return { say, do: (h) => h.valley(h.through(a, b), { flap: c }) };
    case 'flap mountain': return { say, do: (h) => h.mountain(h.through(a, b), { flap: c }) };
    case 'turn over': { const how = r() < 0.5 ? 'side' : 'end'; return { say: `turn over ${how}`, do: (h) => h.turnOver(how) }; }
    default: { const deg = [45, 90, -90, 180][Math.floor(r() * 4)]; return { say: `turn ${deg}`, do: (h) => h.turn(deg) }; }
  }
}
// What the engine says when it won't make a fold.
const REFUSED = [/^No facet holds paper point/, /^The flap to fold is not on the moving side/, /^Nothing on the moving side/, /^Layer \d+ is in the way/];
let randomRuns = null;
function randomFolds() {
  if (randomRuns) return randomRuns;
  const r = random(1);
  randomRuns = { built: [], refused: 0, unexplained: [] };
  for (let n = 0; n < 300; n++) {
    const len = 1 + Math.floor(r() * 6);
    // A square, a square white side up turned like a diamond, and a 3 x 5 card.
    const paper = r() < 0.7 ? {} : r() < 0.5 ? { colorUp: false, turn: 45 } : { size: [1, 5 / 3] };
    const steps = Array.from({ length: len }, () => randomStep(r));
    const id = `random ${n} ${JSON.stringify(paper)}`;
    try {
      randomRuns.built.push(build({ id, paper, steps }));
    } catch (e) {
      const said = String(e?.message).slice(id.length).replace(/^ step \d+: /, '');
      if (e instanceof Error && REFUSED.some((re) => re.test(said))) randomRuns.refused++;
      else randomRuns.unexplained.push(`${id}: ${e?.stack || e}`);
    }
  }
  return randomRuns;
}

test('random folds are refused in the engine\'s own words, or fold into real paper, land where they say, and are marked on the paper', () => {
  const { built, refused, unexplained } = randomFolds();
  assert.deepEqual(unexplained, []);
  assert.ok(built.length > 200 && refused > 5, `${built.length} built, ${refused} refused`);
  const onPaper = (sheet, q) => sheet.order.some((id) => covers(sheet.world(id), q, 1e-6));
  const flatAt = (sheet, id) => { const f = sheet.facets.get(id); return f.poly.map((q) => [...apply(f.m, q), sheet.levels().get(id) * LAYER]); };
  const problems = [];
  for (const b of built) {
    const a0 = paperArea(b.start);
    for (const [i, step] of b.steps.entries()) {
      const where = `${b.model.id} step ${i + 1} (${step.say})`, { motion } = step;
      const fail = (what) => problems.push(`${where}: ${what}`);
      if (!close(paperArea(step.to), a0)) fail('loses paper');
      for (const [when, sheet] of [['as it starts', step.from], ['as it ends', step.to], ['folded before it unfolds', motion.folded]]) {
        for (const x of sheet ? crossings(sheet) : []) fail(`${when}, ${x}`);
      }
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        for (const it of poses(step, t)) {
          for (const p of corners(it)) {
            if (!p.every(Number.isFinite)) fail(`at t=${t} a corner is at ${p}`);
            else if (p[2] <= -1e-9) fail(`goes under the table at t=${t}`);
          }
        }
      }
      for (const [t, sheet] of [[0, step.from], [1, motion.folded ? step.from : step.to]]) {
        const off = poses(step, t).find((it) => !corners(it).every((p, k) => closePt(p, flatAt(sheet, it.facet.id)[k], 1e-6)));
        if (off) fail(`at t=${t} facet ${off.facet.id} isn't where the fold puts it`);
      }
      if (i + 1 < b.steps.length) {
        const end = new Map(poses(step, 1).map((it) => [it.facet.id, it]));
        for (const it of poses(b.steps[i + 1], 0)) {
          const c = centroid(it.facet.poly);
          const moved = [c, ...it.facet.poly.map((p) => [p[0] + (c[0] - p[0]) * 0.02, p[1] + (c[1] - p[1]) * 0.02])].some((q) => {
            const was = end.get(it.facet.id) || [...end.values()].find((e) => covers(e.facet.poly, q, 1e-9));
            return !was || !closePt(transformPoint(was.pose, ...q), transformPoint(it.pose, ...q), 1e-6);
          });
          if (moved) { fail('the next step starts with the paper somewhere else'); break; }
        }
      }
      if (motion.kind !== 'fold' && motion.kind !== 'foldUnfold') continue;
      const ms = marks(step) || [];
      if (!ms.length) fail('has no marks');
      symbol(step);
      const landing = motion.folded || step.to;
      for (const m of ms) {
        // Folds of two pieces along one line share the line, drawn once.
        const [p, q] = m.line || [];
        for (let s = 0.15; p && s <= 0.85 + 1e-9; s += 0.05) {
          if (!onPaper(step.from, [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s])) { fail('its line runs off the paper'); break; }
        }
        if (!m.arrow) continue;
        const f = m.arrow.from.slice(0, 2), t = m.arrow.to.slice(0, 2);
        if (!motion.moving.some((id) => covers(step.from.world(id), f, 1e-6))) fail(`its arrow starts off the paper that moves, at ${f}`);
        if (!onPaper(landing, t)) fail(`its arrow ends off the paper, at ${t}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test('random folds move smoothly, with no layer passing through another on the way', () => {
  const problems = [];
  for (const b of randomFolds().built) {
    for (const [i, step] of b.steps.entries()) {
      const where = `${b.model.id} step ${i + 1} (${step.say})`;
      for (const s of snaps(step)) problems.push(`${where} snaps over at ${s}`);
      const x = passingThrough(step);
      if (x) problems.push(`${where}: ${x}`);
    }
  }
  assert.deepEqual(problems, []);
});

// A fold behind swings its flap down under the model. The model used to rise off the mat to let it pass, by up to half its
// size, floating on the tip of the hanging flap; now it tips up on an edge and lies down again. Where tipping as far as it
// goes doesn't make all the room (a flap as long as the paper it folds behind closes right on the edge the model rests
// on), the model is lifted the rest of the way, but no more than half as far as it was.
test('a fold behind tips the model up on an edge, rather than lifting it off the mat', () => {
  const tipped = [];
  for (const model of MODELS) {
    for (const [i, step] of once(model).steps.entries()) {
      const m = step.motion, parts = m.kind === 'multi' ? m.parts : [m];
      if (!['fold', 'foldUnfold', 'multi'].includes(m.kind) || m.roll || parts.some((p) => p.bend || p.reverse)) continue;
      if (!parts.some((p) => p.sign < 0)) continue;
      const moving = new Set(m.moving);
      let lift = 0, rise = 0;
      for (let k = 0; k <= 40; k++) {
        // How far lifting alone would have to raise it, and how far the lowest point of the paper that stays put rises now.
        for (const it of poses(step, k / 40, true)) for (const q of corners(it)) lift = Math.max(lift, -q[2]);
        let low = Infinity;
        for (const it of poses(step, k / 40)) if (!moving.has(it.facet.id)) for (const q of corners(it)) low = Math.min(low, q[2]);
        rise = Math.max(rise, low);
      }
      if (lift < 0.01) continue;
      tipped.push(`${model.id} ${i + 1}`);
      assert.ok(rise <= lift / 2, `${model.id} step ${i + 1} rises ${rise.toFixed(3)} off the mat, against ${lift.toFixed(3)} lifting it`);
    }
  }
  for (const s of ['cup 5', 'plane 7', 'heart 7', 'heart 8', 'jumping-frog 3', 'helmet 10', 'waterbomb 3', 'crane 22', 'flapping-bird 19']) assert.ok(tipped.includes(s), `${s} doesn't fold behind`);
  // The helmet's flap is on the side nearest you, so it lifts that side, resting on the far edge: the flap is seen swinging
  // under it. (Where the flap is on the far side, that would put it through the mat, so the flap's side lifts instead.)
  const helmet = once(MODELS.find((x) => x.id === 'helmet')).steps[9];
  const still = poses(helmet, 0.5).filter((it) => !helmet.motion.moving.includes(it.facet.id));
  // Each corner of the paper that stays put: where it lies on the mat as the step starts, and how high it is halfway.
  const pts = still.flatMap((it) => it.facet.poly.map((q) => [apply(helmet.from.facets.get(it.facet.id).m, q)[1], transformPoint(it.pose, ...q)[2]]));
  const ys = pts.map(([y]) => y), near = Math.min(...ys), far = Math.max(...ys);
  const zAt = (y) => Math.max(...pts.filter(([w]) => Math.abs(w - y) < 1e-6).map(([, z]) => z));
  assert.ok(zAt(near) > zAt(far) + 0.1, `the helmet tips up its near side (${zAt(near).toFixed(3)} against ${zAt(far).toFixed(3)})`);
});

// A point tucked into a pocket turns over about the pocket's mouth and goes in under the layers over it, which rise to make
// room and settle again. The waterbomb's points passed through the side triangles on their way in.
test('a point tucked into a pocket goes in without passing through the layers over it', () => {
  let tucks = 0;
  const problems = [];
  for (const model of MODELS) {
    for (const [i, step] of once(model).steps.entries()) {
      if (![step.motion, ...(step.motion.parts || [])].some((p) => p.tuck)) continue;
      tucks++;
      const x = passingThrough(step);
      if (x) problems.push(`${model.id} step ${i + 1}: ${x}`);
      // And they're back where the fold says once it lands, as every layer is.
      for (const it of poses(step, 1)) assert.ok(close(corners(it)[0][2], step.to.levels().get(it.facet.id) * LAYER, 1e-9), `${model.id} step ${i + 1}`);
    }
  }
  assert.ok(tucks >= 2, `only ${tucks} tucks`);
  assert.deepEqual(problems, []);
});

// Where two layers pass through each other in the air, at moments a twentieth of the step apart: each one's edge
// pierces the other more than 4 layers deep on both sides, along more than 0.02 of paper.
function passingThrough(step) {
  for (let k = 1; k < 20; k++) {
    const items = poses(step, k / 20).filter((it) => !it.bridge).map((it) => {
      const pts = corners(it), axes = [0, 1, 2];
      return { id: it.facet.id, poly: it.facet.poly, pose: it.pose, pts, lo: axes.map((a) => Math.min(...pts.map((p) => p[a]))), hi: axes.map((a) => Math.max(...pts.map((p) => p[a]))) };
    });
    for (let a = 0; a < items.length; a++) {
      for (let c = a + 1; c < items.length; c++) {
        const A = items[a], B = items[c];
        if (![0, 1, 2].every((x) => A.lo[x] <= B.hi[x] + 1e-4 && B.lo[x] <= A.hi[x] + 1e-4)) continue;
        if (pierces(A, B) && pierces(B, A)) return `at t=${k / 20} facets ${A.id} and ${B.id} pass through each other`;
      }
    }
  }
  return null;
}

// Whether facet A goes right through facet B's plane, deep enough on both sides, where B is: the stretch of A that lies
// in B's plane, kept a little inside both facets' edges (where folds meet, layers touch), and long enough.
function pierces(A, B, { depth = 4 * LAYER, chord = 0.02, margin = 0.006 } = {}) {
  const n = [B.pose.r[2], B.pose.r[5], B.pose.r[8]], o = B.pose.t;
  const d = A.pts.map((x) => n[0] * (x[0] - o[0]) + n[1] * (x[1] - o[1]) + n[2] * (x[2] - o[2]));
  const hi = Math.max(...d), lo = Math.min(...d);
  if (hi <= 1e-4 || lo >= -1e-4 || Math.min(hi, -lo) < depth) return false;
  // Where A's edges cross B's plane, on A's paper.
  const across = [];
  for (let k = 0; k < d.length; k++) {
    const j = (k + 1) % d.length, p = d[k], q = d[j];
    if ((p > 0 && q < 0) || (p < 0 && q > 0)) {
      const s = p / (p - q);
      across.push([A.poly[k][0] + (A.poly[j][0] - A.poly[k][0]) * s, A.poly[k][1] + (A.poly[j][1] - A.poly[k][1]) * s]);
    } else if (p === 0) across.push(A.poly[k]);
  }
  if (across.length < 2) return false;
  const inA = shrunk(A.poly, margin), onA = inA.length && segmentIn(across[0], across.at(-1), inA);
  if (!onA) return false;
  // The same stretch on B's paper, inside B.
  const toB = (q) => {
    const x = transformPoint(A.pose, ...q), r = B.pose.r, v = [x[0] - o[0], x[1] - o[1], x[2] - o[2]];
    return [r[0] * v[0] + r[3] * v[1] + r[6] * v[2], r[1] * v[0] + r[4] * v[1] + r[7] * v[2]];
  };
  const inB = shrunk(B.poly, margin), onB = inB.length && segmentIn(toB(onA[0]), toB(onA[1]), inB);
  return !!onB && Math.hypot(onB[1][0] - onB[0][0], onB[1][1] - onB[0][1]) >= chord;
}

// A convex polygon with every edge moved in by m.
function shrunk(poly, m) {
  const p = ccw(poly);
  let out = p;
  for (let i = 0; i < p.length && out.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len > 1e-12) out = clip(out, { p: [a[0] - (dy / len) * m, a[1] + (dx / len) * m], d: [dx / len, dy / len] }, true);
  }
  return out;
}

// The part of the segment p-q inside a convex ccw polygon, or null.
function segmentIn(p, q, poly) {
  let t0 = 0, t1 = 1;
  const d = [q[0] - p[0], q[1] - p[1]];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], e = [b[0] - a[0], b[1] - a[1]];
    const fp = e[0] * (p[1] - a[1]) - e[1] * (p[0] - a[0]), fd = e[0] * d[1] - e[1] * d[0];
    if (Math.abs(fd) < 1e-15) { if (fp < 0) return null; continue; }
    if (fd > 0) t0 = Math.max(t0, -fp / fd); else t1 = Math.min(t1, -fp / fd);
    if (t0 > t1) return null;
  }
  return [[p[0] + d[0] * t0, p[1] + d[1] * t0], [p[0] + d[0] * t1, p[1] + d[1] * t1]];
}

// ---------- Flat moments in the middle of a step ----------
test('wherever the paper lies flat partway through a step, it could be real paper', () => {
  // Halfway through the frog's leg reverse folds, where the page lies turned open, a fold passes through the layers
  // under it: paper passing through a thick stack mid-fold, which Mark had left as it is but for the waterbomb's tucks.
  const thick = new Set(['frog 31', 'frog 32', 'frog 34', 'frog 35']);
  const problems = [];
  let checked = 0;
  for (const model of MODELS) {
    for (const [i, step] of once(model).steps.entries()) {
      if (thick.has(`${model.id} ${i + 1}`)) continue;
      for (let k = 1; k < 200; k++) {
        const items = poses(step, k / 200).filter((it) => !it.bridge);
        if (!items.every(({ pose: { r } }) => Math.abs(r[2]) + Math.abs(r[5]) + Math.abs(r[6]) + Math.abs(r[7]) < 1e-12)) continue;
        // The paper as it lies at that moment, stacked by height.
        const facets = new Map(), z = new Map();
        for (const it of items) {
          const { r, t } = it.pose;
          facets.set(it.facet.id, { id: it.facet.id, poly: it.facet.poly, m: { a: r[0], b: r[1], c: r[3], d: r[4], e: t[0], f: t[1] } });
          z.set(it.facet.id, corners(it).reduce((sum, p) => sum + p[2], 0) / it.facet.poly.length);
        }
        const x = crossings(new Sheet(facets, [...facets.keys()].sort((p, q) => z.get(p) - z.get(q))));
        if (x.length) problems.push(`${model.id} step ${i + 1} at t=${k / 200}: ${x[0]}`);
        checked++;
      }
    }
  }
  assert.deepEqual(problems, []);
  assert.ok(checked > 300, `only ${checked} flat moments`);
});

// ---------- The page's own facts ----------
const here = (f) => readFileSync(new URL(`../${f}`, import.meta.url));
// A PNG's width and height, from its header.
const pngSize = (f) => { const b = here(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('a shared link shows the preview picture, from where the site lives, and every icon is the size it says', () => {
  const html = here('index.html').toString();
  const meta = (p) => html.match(new RegExp(`<meta property="${p}" content="([^"]*)"`))?.[1];
  // Sites that show a link's preview fetch the picture themselves, so it needs the whole address.
  assert.equal(meta('og:url'), 'https://fold-by-fold.junkdrawer.works/');
  assert.equal(meta('og:image'), 'https://fold-by-fold.junkdrawer.works/og.png');
  // GitHub Pages serves it at that address because of the CNAME file, and sends junkdrawer.works/fold-by-fold/ there.
  assert.equal(here('CNAME').toString(), 'fold-by-fold.junkdrawer.works\n');
  assert.deepEqual(pngSize('og.png'), [1200, 630], 'og.png is not 1200 x 630');
  const { icons } = JSON.parse(here('manifest.webmanifest'));
  const pngs = icons.filter((i) => i.type === 'image/png');
  assert.ok(pngs.length >= 3);
  for (const { src, sizes } of pngs) assert.equal(pngSize(src).join('x'), sizes, `${src} is not ${sizes}`);
  const touch = html.match(/<link rel="apple-touch-icon" href="([^"]*)"/)[1];
  assert.deepEqual(pngSize(touch), [180, 180], `${touch} is not 180 x 180`);
});

test('every file the site names is named from where it is, never from the top of the address', () => {
  // The site is at the top of its own address now, so an address written from the top (/css/app.css) would work
  // there and break everywhere else: the single file opened from disk, or the site served from a path (as it is
  // without the CNAME file). The browser tests serve it from the top, so they can't tell.
  const files = ['index.html', 'manifest.webmanifest', 'sw.js', 'css/app.css', ...readdirSync(new URL('../js/', import.meta.url)).map((f) => `js/${f}`)];
  const fromTop = /(?:href|src)\s*=\s*["']\/(?!\/)|url\(\s*["']?\/(?!\/)|(?:from|import\(|fetch\(|register\()\s*["']\/(?!\/)|"(?:src|start_url|scope)"\s*:\s*"\//;
  for (const f of files) assert.doesNotMatch(here(f).toString(), fromTop, `${f} names a file from the top of the address`);
  // And the offline copy's list of files.
  const shell = [...here('sw.js').toString().match(/SHELL = \[([^\]]*)\]/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map((m) => m[1]);
  assert.ok(shell.length > 10);
  assert.deepEqual(shell.filter((f) => f.startsWith('/')), [], 'sw.js keeps a file named from the top of the address');
});

test('the README names the models there are, in the gallery\'s order, and how long they run', () => {
  const readme = here('README.md').toString();
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = { 2: 'twenty', 3: 'thirty', 4: 'forty', 5: 'fifty' };
  const say = (n) => (n < 20 ? words[n] : tens[Math.floor(n / 10)] + (n % 10 ? `-${words[n % 10]}` : ''));
  const m = readme.match(/\*\*Pick a model\.\*\* (\w+) of them: ([^.]*), from (\S+) steps to ([\w-]+)\./);
  assert.ok(m, 'the README no longer says which models there are');
  const [, count, list, shortest, longest] = m;
  assert.equal(count, say(MODELS.length).replace(/^\w/, (c) => c.toUpperCase()));
  const named = list.split(/, | and /);
  assert.equal(named.length, MODELS.length, `the README names ${named.length} models: ${named.join(' / ')}`);
  MODELS.forEach((model, k) => assert.ok(named[k].toLowerCase().includes(model.name.toLowerCase()), `the README's model ${k + 1} is "${named[k]}", not the ${model.name}`));
  const lengths = MODELS.map((model) => model.steps.length);
  assert.deepEqual([shortest, longest], [say(Math.min(...lengths)), say(Math.max(...lengths))]);
});

// The browser tests try the words' box with the crane's step 19 as the longest words of any step: held sideways, zoomed
// to 200% and on a tablet. A step with longer words would go untried there, as the lily's last step did.
test('the crane\'s step 19 has the longest words of any step, which the browser tests lay out', () => {
  const longest = MODELS.flatMap((m) => m.steps.map((st, i) => [st.say.length, `${m.id}-${i + 1}`])).reduce((a, b) => (b[0] > a[0] ? b : a));
  assert.equal(longest[1], 'crane-19', `${longest[1]} has longer words than crane-19, which test/e2e.mjs lays out as the longest`);
});
