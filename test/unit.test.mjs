// The folding engine, without a browser:  node --test test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sheet, fold, turnOver, together, creases, isFlipped } from '../js/paper.js';
import { apply, area, bisector, side, centroid, overlapArea, line, ccw, inside as covers } from '../js/geom.js';
import { build } from '../js/build.js';
import { poses, marks, symbol, corners, LAYER } from '../js/motion.js';
import { MODELS } from '../js/models.js';
import { outline, picture } from '../js/thumbs.js';
import { FINISHED } from '../js/finished.js';
import { crossings } from '../js/check.js';

// Each model folded once, for the checks that only look at the steps.
const builds = new Map();
const once = (model) => builds.get(model.id) || builds.set(model.id, build(model)).get(model.id);
const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
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
      // Nothing passes through the table, and every layer stays in one piece.
      for (let t = 0; t <= 1; t += 0.05) {
        for (const it of poses(step, t)) for (const p of corners(it)) assert.ok(p[2] > -1e-9, `${where} goes under the table at t=${t}`);
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
