// Folds where several creases move at once: collapses, squash folds, petal folds.
//
// A step names the creases that change, on the paper, and where each one ends up: 'valley' (the colored
// sides come together), 'mountain', 'flat', or 'free' (whatever the others make it). Every other crease
// keeps its angle, so the paper breaks into rigid bodies joined by hinges. The bodies form a tree hung
// from a root that stays put; hinges that close loops become constraints. The motion comes from easing
// the hinges toward their targets (or just the one marked `drive`, with the rest following the paper)
// while a small least-squares solver keeps the loops closed, sampled once up front so it plays and scrubs
// smoothly. The finished state is flattened exactly, and its stacking order read from how the layers lie
// just before they close. (Inside reverse folds are in paper.js: stiff paper can't make them.)

import {
  apply, det, line, side, cross, sub, dot, centroid, cuts, ccw, area, intersectPolys, invert,
} from './geom.js';
import { splitPaper } from './paper.js';
import { LAYER, ease } from './motion.js';

const FOLDS = { valley: Math.PI, mountain: -Math.PI, flat: 0 };
// How much more keeping the paper joined counts than keeping each crease on its schedule.
const CLOSE = 400;

// ---------- 3D rigid transforms: { r: row-major 3x3, t: [x, y, z] } ----------

const I3 = () => ({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] });

function mulR(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return o;
}
const applyT = (T, p) => [
  T.r[0] * p[0] + T.r[1] * p[1] + T.r[2] * p[2] + T.t[0],
  T.r[3] * p[0] + T.r[4] * p[1] + T.r[5] * p[2] + T.t[1],
  T.r[6] * p[0] + T.r[7] * p[1] + T.r[8] * p[2] + T.t[2],
];
// First b, then a.
const composeT = (a, b) => ({ r: mulR(a.r, b.r), t: applyT(a, b.t) });

// Rotation by angle about the line through p along unit d.
function axisRot(p, d, angle) {
  const [x, y, z] = d, c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  const r = [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
  const rp = [r[0] * p[0] + r[1] * p[1] + r[2] * p[2], r[3] * p[0] + r[4] * p[1] + r[5] * p[2], r[6] * p[0] + r[7] * p[1] + r[8] * p[2]];
  return { r, t: [p[0] - rp[0], p[1] - rp[1], p[2] - rp[2]] };
}

const flatT = (m, z) => ({ r: [m.a, m.b, 0, m.c, m.d, 0, 0, 0, det(m) < 0 ? -1 : 1], t: [m.e, m.f, z] });

// Moves a pose off its face by distance d, along the face's normal.
function thick(P, d) {
  return { r: P.r, t: [P.t[0] + P.r[2] * d, P.t[1] + P.r[5] * d, P.t[2] + P.r[8] * d] };
}

// ---------- Setting up ----------

// Where the segment of line Lp inside polygon poly starts and ends, as parameters along [a, b].
function spanIn(poly, a, b) {
  const d = sub(b, a), L2 = dot(d, d);
  const Lp = line(a, b);
  const pts = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const sp = side(Lp, p), sq = side(Lp, q);
    if (Math.abs(sp) < 1e-9) pts.push(p);
    if ((sp > 1e-9 && sq < -1e-9) || (sp < -1e-9 && sq > 1e-9)) {
      const t = sp / (sp - sq);
      pts.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  const ts = pts.map((q) => dot(sub(q, a), d) / L2);
  return [Math.min(...ts), Math.max(...ts)];
}

// Cuts every facet the crease segments cross. A crease has to cross a facet completely.
function cutAlong(sheet, specs) {
  for (const spec of specs) {
    const Lp = line(spec.a, spec.b);
    for (const id of sheet.order.slice()) {
      const f = sheet.facets.get(id);
      if (!cuts(f.poly, Lp)) continue;
      const [t0, t1] = spanIn(f.poly, spec.a, spec.b);
      if (t1 < 1e-7 || t0 > 1 - 1e-7) continue; // the crease misses this facet, or only touches it at an end
      if (t0 < -1e-6 || t1 > 1 + 1e-6) throw new Error(`Crease ${spec.a}–${spec.b} stops inside a facet`);
      splitPaper(sheet, id, Lp);
    }
  }
}

// Every pair of facets joined along a stretch of paper, with the fold angle between them now:
// 0 lying open, +pi folded with the colored sides together, -pi with the white sides together.
function joins(sheet) {
  const out = [];
  const list = sheet.order.map((id) => sheet.facets.get(id));
  const pos = new Map(sheet.order.map((id, k) => [id, k]));
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const g = list[j];
      for (let a = 0; a < f.poly.length; a++) {
        const fa = f.poly[a], fb = f.poly[(a + 1) % f.poly.length];
        for (let b = 0; b < g.poly.length; b++) {
          const seg = shared(fa, fb, g.poly[b], g.poly[(b + 1) % g.poly.length]);
          if (!seg) continue;
          let theta = 0;
          const fUp = det(f.m) > 0, gUp = det(g.m) > 0;
          if (fUp !== gUp) {
            const gAbove = pos.get(g.id) > pos.get(f.id);
            theta = gAbove === fUp ? Math.PI : -Math.PI;
          }
          out.push({ f: f.id, g: g.id, p0: seg[0], p1: seg[1], theta0: theta });
        }
      }
    }
  }
  return out;
}

function shared(a, b, c, d) {
  const u = sub(b, a), L = Math.hypot(u[0], u[1]);
  if (L < 1e-9) return null;
  const dir = [u[0] / L, u[1] / L];
  if (Math.abs(cross(dir, sub(c, a))) > 1e-7 || Math.abs(cross(dir, sub(d, a))) > 1e-7) return null;
  const t1 = dot(sub(c, a), dir), t2 = dot(sub(d, a), dir);
  const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(L, Math.max(t1, t2));
  if (hi - lo < 1e-7) return null;
  return [[a[0] + dir[0] * lo, a[1] + dir[1] * lo], [a[0] + dir[0] * hi, a[1] + dir[1] * hi]];
}

// Which spec, if any, a join lies along.
function specFor(specs, j) {
  for (const s of specs) {
    const L = line(s.a, s.b);
    if (Math.abs(side(L, j.p0)) > 1e-7 || Math.abs(side(L, j.p1)) > 1e-7) continue;
    const d = sub(s.b, s.a), L2 = dot(d, d);
    const t0 = dot(sub(j.p0, s.a), d) / L2, t1 = dot(sub(j.p1, s.a), d) / L2;
    if (Math.min(t0, t1) >= -1e-6 && Math.max(t0, t1) <= 1 + 1e-6) return s;
  }
  return null;
}

// ---------- The step ----------

// sheet: the state before. specs: [{ a, b, fold, schedule? }] crease segments on the paper.
// root: a paper point on the part that stays put. schedule(t) -> [0, 1] shapes how each crease closes
// (default: eased evenly).
export function mechanism(sheet, { creases: specs, root, arrow = null, samples = 60 }) {
  const from = sheet.clone();
  from._world = new Map();
  cutAlong(from, specs);
  const levels = from.levels();
  // The hinges turn as if the paper had no thickness, so creases that meet at a point really do meet
  // there. Each layer's thickness is added back afterward, along its own face.
  const lift0 = (id) => levels.get(id) * LAYER * (det(from.facets.get(id).m) > 0 ? 1 : -1);

  // Hinges and rigid joins.
  const all = joins(from);
  const hinges = [];
  const parent = new Map(from.order.map((id) => [id, id]));
  const findB = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const j of all) {
    const s = specFor(specs, j);
    if (s) {
      const target = s.fold === 'free' ? null : (typeof s.fold === 'number' ? s.fold * Math.PI / 180 : FOLDS[s.fold]);
      if (target === null || Math.abs(target - j.theta0) > 1e-9) { hinges.push({ ...j, target, spec: s }); continue; }
    }
    parent.set(findB(j.f), findB(j.g));
  }
  const bodyOf = new Map(from.order.map((id) => [id, findB(id)]));
  const rootBody = bodyOf.get(from.facetAt(root).id);

  // A tree of bodies hung from the root; hinges not in the tree close loops.
  const tree = []; // { body, parentBody, hinge }
  const placed = new Set([rootBody]);
  const loops = [];
  let frontier = [rootBody];
  const used = new Set();
  while (frontier.length) {
    const next = [];
    for (const b of frontier) {
      for (const h of hinges) {
        if (used.has(h)) continue;
        const bf = bodyOf.get(h.f), bg = bodyOf.get(h.g);
        if (bf !== b && bg !== b) continue;
        const other = bf === b ? bg : bf;
        if (placed.has(other)) continue;
        used.add(h);
        placed.add(other);
        tree.push({ body: other, parentBody: b, hinge: h, parentFacet: bf === b ? h.f : h.g, childFacet: bf === b ? h.g : h.f });
        next.push(other);
      }
    }
    frontier = next;
  }
  for (const h of hinges) if (!used.has(h)) loops.push(h);
  for (const id of from.order) if (!placed.has(bodyOf.get(id))) throw new Error('Part of the paper is not joined to the rest');

  // Each tree hinge's axis, from the parent facet's side: turning by +x folds the child toward the
  // parent facet's colored side.
  for (const e of tree) {
    const f = from.facets.get(e.parentFacet);
    const P0 = apply(f.m, e.hinge.p0), P1 = apply(f.m, e.hinge.p1);
    const Lw = line(P0, P1);
    const c = centroid(from.world(e.parentFacet));
    const s = side(Lw, c) > 0 ? 1 : -1;
    const u = [-Lw.d[1] * s, Lw.d[0] * s, 0]; // into the parent facet
    const n = [0, 0, det(f.m) > 0 ? 1 : -1];
    const mu = [-u[0], -u[1], 0];
    const d = [mu[1] * n[2] - mu[2] * n[1], mu[2] * n[0] - mu[0] * n[2], mu[0] * n[1] - mu[1] * n[0]];
    e.axisP = [P0[0], P0[1], 0];
    e.axisD = d;
    e.delta = e.hinge.target === null ? null : e.hinge.target - e.hinge.theta0;
    e.schedule = e.hinge.spec.schedule || null;
    // With a crease marked `drive`, only it keeps to a schedule; the rest go wherever the paper takes them,
    // pulled only faintly toward where they end up, which is enough to pick the right way at the start.
    e.weight = !specs.some((sp) => sp.drive) || e.hinge.spec.drive ? 1 : 0.02;
  }
  const order = [...tree]; // parents always come before children
  const loopPts = loops.map((h) => {
    const f = from.facets.get(h.f);
    return { h, bf: bodyOf.get(h.f), bg: bodyOf.get(h.g), pts: [h.p0, h.p1].map((q) => { const w = apply(f.m, q); return [w[0], w[1], 0]; }) };
  });

  const n = order.length;
  const kin = (x) => {
    const W = new Map([[rootBody, I3()]]);
    order.forEach((e, i) => W.set(e.body, composeT(W.get(e.parentBody), axisRot(e.axisP, e.axisD, x[i]))));
    return W;
  };
  const targetAt = (t) => order.map((e) => (e.delta === null ? null : e.delta * (e.schedule ? e.schedule(t) : ease(t))));
  const residual = (x, tgt, prev) => {
    const W = kin(x);
    const r = [];
    x.forEach((v, i) => { r.push(tgt[i] === null ? 0.05 * (v - prev[i]) : order[i].weight * (v - tgt[i])); });
    for (const L of loopPts) {
      const A = W.get(L.bf), B = W.get(L.bg);
      for (const p of L.pts) {
        const a = applyT(A, p), b = applyT(B, p);
        r.push(CLOSE * (a[0] - b[0]), CLOSE * (a[1] - b[1]), CLOSE * (a[2] - b[2]));
      }
    }
    return r;
  };
  const solve = (x0, tgt) => {
    let x = x0.slice();
    for (let it = 0; it < 40; it++) {
      const r = residual(x, tgt, x0);
      const J = [];
      for (let i = 0; i < n; i++) {
        const xp = x.slice(); xp[i] += 1e-6;
        const rp = residual(xp, tgt, x0);
        J.push(rp.map((v, k) => (v - r[k]) / 1e-6));
      }
      // (J^T J + mu) dx = -J^T r
      const A = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
        let s = 0; for (let k = 0; k < r.length; k++) s += J[i][k] * J[j][k]; return s + (i === j ? 1e-6 : 0);
      }));
      const g = Array.from({ length: n }, (_, i) => { let s = 0; for (let k = 0; k < r.length; k++) s += J[i][k] * r[k]; return -s; });
      const dx = gauss(A, g);
      let step = 0;
      for (let i = 0; i < n; i++) { x[i] += dx[i]; step = Math.max(step, Math.abs(dx[i])); }
      if (step < 1e-10) break;
    }
    return x;
  };

  // Sample the motion.
  const xs = [];
  let x = new Array(n).fill(0);
  for (let k = 0; k <= samples; k++) {
    const t = k / samples;
    const tgt = targetAt(t);
    // Start each solve from a guess that already leans the right way.
    const guess = x.map((v, i) => (tgt[i] === null || order[i].weight < 1 ? v : tgt[i]));
    x = solve(guess, tgt);
    xs.push(x.slice());
  }
  // How far apart the paper comes at the hinges that close loops, anywhere along the way.
  let pathGap = 0;
  for (const x of xs) {
    const W = kin(x);
    for (const L of loopPts) for (const p of L.pts) {
      const a = applyT(W.get(L.bf), p), b = applyT(W.get(L.bg), p);
      pathGap = Math.max(pathGap, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
  }
  // The end is exact: targets as given, free hinges snapped to open or shut.
  const xEnd = xs[samples].map((v, i) => {
    if (order[i].delta !== null) return order[i].delta;
    const q = Math.round(v / Math.PI) * Math.PI;
    return Math.abs(v - q) < 0.08 ? q : v;
  });
  xs[samples] = xEnd;
  const WEnd = kin(xEnd);
  let gap = 0;
  for (const L of loopPts) for (const p of L.pts) {
    const a = applyT(WEnd.get(L.bf), p), b = applyT(WEnd.get(L.bg), p);
    gap = Math.max(gap, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  if (gap > 1e-4) throw new Error(`The creases don't close up flat (gap ${gap.toFixed(4)})`);

  // The finished state, flat.
  const to = from.clone();
  to._world = new Map();
  const endPose = new Map();
  for (const id of from.order) {
    const f = from.facets.get(id);
    const P = composeT(WEnd.get(bodyOf.get(id)), flatT(f.m, 0));
    if (Math.abs(P.r[2]) + Math.abs(P.r[5]) + Math.abs(P.r[6]) + Math.abs(P.r[7]) > 1e-6) throw new Error('The folded state is not flat');
    endPose.set(id, P);
    to.facets.set(id, { ...f, m: { a: P.r[0], b: P.r[1], c: P.r[3], d: P.r[4], e: P.t[0], f: P.t[1] } });
  }

  // Stacking: how the layers lie just short of closing.
  const nearTgt = order.map((e) => (e.delta === null ? null : e.delta * 0.94));
  const xNear = solve(xs[Math.floor(samples * 0.94)].map((v, i) => (nearTgt[i] === null ? v : nearTgt[i])), nearTgt);
  const WNear = kin(xNear);
  to.order = stackOrder(
    from, to,
    (id) => composeT(WNear.get(bodyOf.get(id)), flatT(from.facets.get(id).m, 0)),
    (id) => bodyOf.get(id) === rootBody,
    (id) => bodyOf.get(id),
    (id) => det(to.facets.get(id).m) * det(from.facets.get(id).m) < 0,
  );
  to._levels = null;

  // Each layer's height above the table, measured along its own face: where it starts, and where it
  // ends up in the finished stack.
  const lv = to.levels();
  const lift1 = (id) => lv.get(id) * LAYER * Math.sign(endPose.get(id).r[8]);

  const motion = {
    kind: 'mech', specs, arrow, pathGap,
    moving: from.order.filter((id) => bodyOf.get(id) !== rootBody),
  };
  // Poses at time t: between samples the hinge angles are blended, and each layer drifts the last bit to
  // its exact height in the finished stack.
  motion.at = (t) => {
    const N = xs.length - 1;
    const u = Math.min(1, Math.max(0, t)) * N;
    const k = Math.min(N - 1, Math.floor(u)), w = u - k;
    const W = kin(xs[k].map((v, i) => v + (xs[k + 1][i] - v) * w));
    return from.order.map((id) => {
      const f = from.facets.get(id);
      const u = Math.min(1, Math.max(0, t));
      const P = thick(composeT(W.get(bodyOf.get(id)), flatT(f.m, 0)), lift0(id) + (lift1(id) - lift0(id)) * u);
      return { facet: f, pose: P };
    });
  };
  return { from, to, motion };
}

// Orders the finished facets from the table up. Facets that didn't move keep their order; for the rest,
// wherever two overlap, whichever sits higher just before the layers close goes above.
// Layers that moved as one piece keep their order, or reverse it if the piece turned over.
function stackOrder(from, to, nearPose, stayed, bodyOf, flipped) {
  const ids = from.order;
  const world = (id) => to.world(id);
  const above = new Map(ids.map((id) => [id, new Set()]));
  const indeg = new Map(ids.map((id) => [id, 0]));
  const pos = new Map(ids.map((id, k) => [id, k]));
  const zAt = (id, p) => {
    const f = to.facets.get(id);
    const q = apply(invert(f.m), p); // the paper point that ends up at p
    const P = nearPose(id);
    return P.r[6] * q[0] + P.r[7] * q[1] + P.t[2];
  };
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i], b = ids[j];
      const ov = intersectPolys(ccw(world(a)), ccw(world(b)));
      if (!ov.length || Math.abs(area(ov)) < 1e-7) continue;
      let lower, upper;
      if (stayed(a) && stayed(b)) { lower = a; upper = b; } // keep their order
      else if (bodyOf(a) === bodyOf(b)) { if (flipped(a)) { lower = b; upper = a; } else { lower = a; upper = b; } }
      else {
        const c = centroid(ov);
        if (zAt(a, c) <= zAt(b, c)) { lower = a; upper = b; } else { lower = b; upper = a; }
      }
      above.get(lower).add(upper);
      indeg.set(upper, indeg.get(upper) + 1);
    }
  }
  // Kahn's algorithm, preferring the old order among ties.
  const ready = ids.filter((id) => indeg.get(id) === 0);
  const out = [];
  while (ready.length) {
    ready.sort((p, q) => pos.get(p) - pos.get(q));
    const id = ready.shift();
    out.push(id);
    for (const up of above.get(id)) {
      indeg.set(up, indeg.get(up) - 1);
      if (indeg.get(up) === 0) ready.push(up);
    }
  }
  if (out.length !== ids.length) throw new Error('The layers cross each other; the stacking is ambiguous');
  return out;
}

function gauss(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / d;
      for (let q = c; q <= n; q++) M[r][q] -= k * M[c][q];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let q = r + 1; q < n; q++) s -= M[r][q] * x[q];
    x[r] = s / (M[r][r] || 1e-12);
  }
  return x;
}

