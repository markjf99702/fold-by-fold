// The folding engine, without a browser:  node --test test/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Sheet, fold, turnOver, together, creases, isFlipped } from '../js/paper.js';
import { apply, area, bisector } from '../js/geom.js';
import { build } from '../js/build.js';
import { poses, marks, corners, LAYER } from '../js/motion.js';
import { MODELS } from '../js/models.js';
import { stateSVG } from '../js/thumbs.js';

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
          const want = flatAt(sheet, it.facet.id);
          const got = corners(it);
          got.forEach((p, k) => assert.ok(closePt(p, want[k], 1e-6), `${where} at t=${t}: facet ${it.facet.id} is at ${p}, not ${want[k]}`));
        }
      };
      check(0, step.from);
      const bends = step.motion.kind === 'bend' || step.motion.parts?.some((p) => p.bend);
      if (!bends) check(1, step.motion.kind === 'foldUnfold' ? step.from : step.to);
      // Nothing passes through the table, and every layer stays in one piece.
      for (let t = 0; t <= 1; t += 0.05) {
        for (const it of poses(step, t)) for (const p of corners(it)) assert.ok(p[2] > -1e-9, `${where} goes under the table at t=${t}`);
      }
      if (['fold', 'foldUnfold', 'bend', 'multi'].includes(step.motion.kind)) {
        const m = marks(step);
        assert.ok(m && m.length, `${where} has no diagram marks`);
        for (const k of m) assert.ok(['valley', 'mountain'].includes(k.type), `${where} mark type ${k.type}`);
      }
    }
    const svg = stateSVG(b.end);
    assert.equal(svg.match(/<polygon/g).length, b.end.facets.size);
  });
}
