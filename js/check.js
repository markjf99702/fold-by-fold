// Checks that a flat folded state could be real paper: nothing passes through anything at a crease.

import { det, apply, side, dot, sub, line, centroid } from './geom.js';

// Problems with sheet, as short descriptions; none if it's fine.
export function crossings(sheet) {
  const pos = new Map(sheet.order.map((id, k) => [id, k]));
  const up = (id) => det(sheet.facets.get(id).m) > 0;
  // Every join, on the table: the line it lies along, where along it, and which side each piece is on.
  const joins = [];
  for (const f of sheet.facets.values()) {
    for (const { g, edge } of sheet.neighbors(f)) {
      if (g.id < f.id) continue;
      const a = apply(f.m, edge[0]), b = apply(f.m, edge[1]);
      const L = line(a, b);
      // One direction per line, so joins along the same line can be compared.
      if (L.d[0] < -1e-9 || (Math.abs(L.d[0]) < 1e-9 && L.d[1] < 0)) { L.d = [-L.d[0], -L.d[1]]; }
      const t0 = dot(sub(a, L.p), L.d), t1 = dot(sub(b, L.p), L.d);
      const sf = Math.sign(side(L, centroid(sheet.world(f.id)))), sg = Math.sign(side(L, centroid(sheet.world(g.id))));
      joins.push({ f: f.id, g: g.id, L, lo: Math.min(t0, t1), hi: Math.max(t0, t1), sf, sg });
    }
  }
  const out = [];
  for (const j of joins) {
    if ((up(j.f) === up(j.g)) === (j.sf === j.sg)) out.push(`join ${j.f}/${j.g} lies the wrong way`);
  }
  const sameLine = (a, b) => Math.abs(side(a.L, b.L.p)) < 1e-7 && Math.abs(a.L.d[0] * b.L.d[1] - a.L.d[1] * b.L.d[0]) < 1e-7;
  for (let i = 0; i < joins.length; i++) {
    for (let k = i + 1; k < joins.length; k++) {
      const a = joins[i], b = joins[k];
      if (!sameLine(a, b)) continue;
      const shift = dot(sub(b.L.p, a.L.p), a.L.d);
      if (Math.min(a.hi, b.hi + shift) - Math.max(a.lo, b.lo + shift) < 1e-7) continue; // they don't overlap
      // Heights of each join's pieces on each side of the line.
      const sides = (j) => {
        const r = { 1: [], [-1]: [] };
        r[j.sf].push(pos.get(j.f)); r[j.sg].push(pos.get(j.g));
        return r;
      };
      const A = sides(a), B = sides(b);
      for (const s of [1, -1]) {
        const x = A[s], y = B[s];
        if (x.length === 2 && y.length === 2) {
          // Two folds on this side: nested or apart.
          const [x0, x1] = x.sort((p, q) => p - q), [y0, y1] = y.sort((p, q) => p - q);
          if ((x0 < y0 && y0 < x1 && x1 < y1) || (y0 < x0 && x0 < y1 && y1 < x1)) out.push(`folds ${a.f}/${a.g} and ${b.f}/${b.g} interleave`);
        } else if (x.length === 2 && y.length === 1) {
          const [x0, x1] = x.sort((p, q) => p - q);
          if (x0 < y[0] && y[0] < x1) out.push(`fold ${a.f}/${a.g} passes through ${b.f}/${b.g}`);
        } else if (x.length === 1 && y.length === 2) {
          const [y0, y1] = y.sort((p, q) => p - q);
          if (y0 < x[0] && x[0] < y1) out.push(`fold ${b.f}/${b.g} passes through ${a.f}/${a.g}`);
        }
      }
      // Two straight-across joins keep their order on both sides.
      if (A[1].length === 1 && A[-1].length === 1 && B[1].length === 1 && B[-1].length === 1) {
        if ((A[1][0] < B[1][0]) !== (A[-1][0] < B[-1][0])) out.push(`joins ${a.f}/${a.g} and ${b.f}/${b.g} cross`);
      }
    }
  }
  return out;
}
