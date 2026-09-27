// Flat geometry: points, lines, convex polygons and the rigid moves of a sheet lying on the table.
// Points are [x, y]. A line is { p: point on it, d: unit direction }; "left" of a line means the side
// its direction turns toward counterclockwise.

export const EPS = 1e-9;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const len = (a) => Math.hypot(a[0], a[1]);
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const mid = (a, b) => lerp(a, b, 0.5);
export const dist = (a, b) => len(sub(a, b));
export const norm = (a) => { const l = len(a); return [a[0] / l, a[1] / l]; };
export const near = (a, b, tol = 1e-7) => dist(a, b) < tol;

export function line(p, q) {
  return { p, d: norm(sub(q, p)) };
}

export function lineAt(p, deg) {
  const r = (deg * Math.PI) / 180;
  return { p, d: [Math.cos(r), Math.sin(r)] };
}

// Signed distance from a line: positive on its left.
export const side = (L, q) => cross(L.d, sub(q, L.p));

// The same line pointing the other way.
export const flip = (L) => ({ p: L.p, d: [-L.d[0], -L.d[1]] });

// The line that folds point a exactly onto point b, with a on its left.
export function bisector(a, b) {
  const m = mid(a, b);
  const d = norm(sub(b, a));
  return { p: m, d: [-d[1], d[0]] };
}

// The line through p that bisects the angle between directions u and v.
export function angleBisector(p, u, v) {
  return { p, d: norm(add(norm(u), norm(v))) };
}

export function intersect(L, M) {
  const den = cross(L.d, M.d);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(M.p, L.p), M.d) / den;
  return add(L.p, mul(L.d, t));
}

export function reflectPoint(L, q) {
  const s = side(L, q);
  return [q[0] + 2 * s * L.d[1], q[1] - 2 * s * L.d[0]];
}

// ---------- Rigid moves in the plane ----------
// An iso maps [x, y] to [a x + b y + e, c x + d y + f]. Its determinant is +1, or -1 once it has been
// turned over, in which case the sheet's back is facing up.

export const IDENTITY = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const apply = (m, q) => [m.a * q[0] + m.b * q[1] + m.e, m.c * q[0] + m.d * q[1] + m.f];
export const applyDir = (m, q) => [m.a * q[0] + m.b * q[1], m.c * q[0] + m.d * q[1]];
export const det = (m) => m.a * m.d - m.b * m.c;

// First m, then n.
export function compose(n, m) {
  return {
    a: n.a * m.a + n.b * m.c, b: n.a * m.b + n.b * m.d,
    c: n.c * m.a + n.d * m.c, d: n.c * m.b + n.d * m.d,
    e: n.a * m.e + n.b * m.f + n.e, f: n.c * m.e + n.d * m.f + n.f,
  };
}

export function invert(m) {
  const k = det(m);
  const a = m.d / k, b = -m.b / k, c = -m.c / k, d = m.a / k;
  return { a, b, c, d, e: -(a * m.e + b * m.f), f: -(c * m.e + d * m.f) };
}

export function reflection(L) {
  const [x, y] = L.d;
  const a = x * x - y * y, b = 2 * x * y;
  const m = { a, b, c: b, d: -a, e: 0, f: 0 };
  const q = apply(m, L.p);
  m.e = L.p[0] - q[0];
  m.f = L.p[1] - q[1];
  return m;
}

export function rotation(center, deg) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const m = { a: c, b: -s, c: s, d: c, e: 0, f: 0 };
  const q = apply(m, center);
  m.e = center[0] - q[0];
  m.f = center[1] - q[1];
  return m;
}

export function translation(dx, dy) {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

// ---------- Convex polygons ----------

export function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}

export function centroid(poly) {
  let cx = 0, cy = 0, a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const k = cross(p, q);
    a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
  }
  if (Math.abs(a) < EPS) {
    const n = poly.length;
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

// Keeps the part of a convex polygon on the left of a line (or the right, with keepLeft false).
export function clip(poly, L, keepLeft = true) {
  const out = [];
  const s = poly.map((q) => (keepLeft ? 1 : -1) * side(L, q));
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const a = poly[i], b = poly[j], sa = s[i], sb = s[j];
    if (sa >= -1e-10) out.push(a);
    if ((sa > 1e-10 && sb < -1e-10) || (sa < -1e-10 && sb > 1e-10)) {
      const t = sa / (sa - sb);
      out.push(lerp(a, b, t));
    }
  }
  return tidy(out);
}

// Drops repeated and collinear corners.
export function tidy(poly) {
  let pts = [];
  for (const p of poly) if (!pts.length || !near(pts[pts.length - 1], p, 1e-9)) pts.push(p);
  if (pts.length > 1 && near(pts[0], pts[pts.length - 1], 1e-9)) pts.pop();
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (Math.abs(cross(sub(b, a), sub(c, b))) < 1e-12) { pts.splice(i, 1); changed = true; break; }
    }
  }
  return pts.length >= 3 ? pts : [];
}

// Whether a line cuts through a polygon (not just touching it).
export function cuts(poly, L) {
  let pos = false, neg = false;
  for (const q of poly) {
    const s = side(L, q);
    if (s > 1e-9) pos = true; else if (s < -1e-9) neg = true;
  }
  return pos && neg;
}

// Intersection of two convex polygons (both counterclockwise).
export function intersectPolys(a, b) {
  let out = a;
  for (let i = 0; i < b.length && out.length; i++) {
    out = clip(out, line(b[i], b[(i + 1) % b.length]), true);
  }
  return out;
}

export function overlapArea(a, b) {
  const p = intersectPolys(ccw(a), ccw(b));
  return p.length ? Math.abs(area(p)) : 0;
}

export const ccw = (poly) => (area(poly) < 0 ? poly.slice().reverse() : poly);

export function inside(poly, q, tol = 1e-9) {
  const p = ccw(poly);
  for (let i = 0; i < p.length; i++) {
    if (cross(sub(p[(i + 1) % p.length], p[i]), sub(q, p[i])) < -tol) return false;
  }
  return true;
}

// How much of segment [a, b] lies along segment [c, d] (both on one line), or null.
export function sharedSegment(a, b, c, d, tol = 1e-7) {
  const u = sub(b, a);
  const L = len(u);
  if (L < tol) return null;
  const dir = mul(u, 1 / L);
  if (Math.abs(cross(dir, sub(c, a))) > tol || Math.abs(cross(dir, sub(d, a))) > tol) return null;
  const t1 = dot(sub(c, a), dir), t2 = dot(sub(d, a), dir);
  const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(L, Math.max(t1, t2));
  if (hi - lo < tol) return null;
  return [add(a, mul(dir, lo)), add(a, mul(dir, hi))];
}
