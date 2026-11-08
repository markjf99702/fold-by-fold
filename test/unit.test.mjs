// The folding engine, without a browser:  node --test test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sheet, fold, turnOver, together, creases, isFlipped } from '../js/paper.js';
import { apply, area, bisector, side, centroid, overlapArea, line, ccw, clip, inside as covers } from '../js/geom.js';
import { build } from '../js/build.js';
import { poses, marks, symbol, corners, transformPoint, LAYER } from '../js/motion.js';
import { MODELS } from '../js/models.js';
import { outline, picture } from '../js/thumbs.js';
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
      const bends = step.motion.kind === 'bend' || step.motion.parts?.some((p) => p.bend);
      if (!bends) check(1, step.motion.kind === 'foldUnfold' ? step.from : step.to);
      // Halfway through a fold and unfold, every layer is where the fold puts it: a flap folded behind
      // is under the rest, not level with it.
      if (step.motion.kind === 'foldUnfold') check(0.5, step.motion.folded);
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
    assert.deepEqual(FINISHED[model.id], outline(b.end), `${model.id}'s picture in js/finished.js is out of date: run node tools/make-thumbs.mjs`);
    assert.equal(picture(FINISHED[model.id]).match(/<polygon/g).length, b.end.facets.size);
  });

  test(`${model.name}: every folded state could be real paper, with nothing passing through anything`, () => {
    for (const [i, step] of build(model).steps.entries()) {
      assert.deepEqual(crossings(step.to), [], `${model.id} step ${i + 1}`);
      // So could the paper as each step starts, cut ready to fold, and a fold and unfold at its fullest.
      assert.deepEqual(crossings(step.from), [], `${model.id} step ${i + 1}, as it starts`);
      if (step.motion.kind === 'foldUnfold') assert.deepEqual(crossings(step.motion.folded), [], `${model.id} step ${i + 1}, folded before it unfolds`);
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
// above changes colour. (The frog's petal folds flashed white as Play began, and frog 21 again as it landed, from a
// layer whose thickness ran ahead of its hinges and rose through the layer over it.) What's left stays under 2%: rays
// that fall right by a crease, and a fold and unfold, which moves at twice the pace. Turning the model over changes
// everything at once, and the flapping bird stands up in the first third of its step, keeping its own time.
test('as a fold begins and as it lands, the paper seen from above keeps its colours', () => {
  // The frog's squash folds still dip the front layer into the stack under it as they open (15-18% of the face turns
  // white by a tenth of the way): that is the question put to Mark of paper passing through a thick stack mid-fold.
  const thick = new Set(['frog 7', 'frog 9', 'frog 11', 'frog 14']);
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

test('js/finished.js has a picture for every model and nothing else', () => {
  assert.deepEqual(Object.keys(FINISHED), MODELS.map((m) => m.id), 'run node tools/make-thumbs.mjs');
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
        assert.equal(!!a.back, step.motion.kind === 'foldUnfold', `${model.id} step ${i + 1}`);
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
  assert.equal(symbol(frog[24]), 'rotate');
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
  assert.equal(n, 18, 'sixteen steps turn a model over and two turn it around');
});

test('folds made together along one line share the line, and their arrows sit side by side', () => {
  const steps = (id) => build(MODELS.find((m) => m.id === id)).steps;
  const crane = steps('crane'), frog = steps('frog');
  // Both wings at once: one valley line, the front wing's valley arrow and the back wing's mountain arrow apart.
  for (const step of [crane[21], crane[22], frog[25], steps('flapping-bird')[18], steps('plane')[7]]) {
    const m = marks(step);
    assert.deepEqual(m.map((k) => [k.type, !!k.line]), [['valley', true], ['mountain', false]], step.say);
    const along = (q) => (q[0] - m[0].line[0][0]) * (m[0].line[1][0] - m[0].line[0][0]) + (q[1] - m[0].line[0][1]) * (m[0].line[1][1] - m[0].line[0][1]);
    assert.ok(Math.abs(along(m[0].arrow.from) - along(m[1].arrow.from)) > 0.02, `${step.say}: the arrows lie on top of each other`);
  }
  // Two layers turned together the same way: one line, one arrow.
  for (const step of [frog[19], frog[22]]) assert.equal(marks(step).length, 1, step.say);
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
      const landing = motion.kind === 'foldUnfold' ? motion.folded : step.to;
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
      for (const [t, sheet] of [[0, step.from], [1, motion.kind === 'foldUnfold' ? step.from : step.to]]) {
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
      const landing = motion.kind === 'foldUnfold' ? motion.folded : step.to;
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
  // under it: that is the question put to Mark of paper passing through a thick stack mid-fold.
  const thick = new Set(['frog 27', 'frog 28', 'frog 30', 'frog 31']);
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
