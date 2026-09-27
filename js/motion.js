// Where every facet is, in 3D, at any moment of a step.
//
// Between steps the sheet lies flat, each facet raised by the number of layers under it. During a fold,
// the moving facets turn about the fold line (lifted halfway between where they start and where they
// land, so they arrive exactly on their new layer); everything else stays put.

import { apply, det, dot, sub, side, reflectPoint, centroid, area, add, mul } from './geom.js';

export const LAYER = 0.0035; // thickness of one layer of paper, in sheet widths

export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// A 3D pose: rotation r (row-major 3x3) and translation t.
function flatPose(m, z) {
  const s = det(m) < 0 ? -1 : 1;
  return { r: [m.a, m.b, 0, m.c, m.d, 0, 0, 0, s], t: [m.e, m.f, z] };
}

// Rotation by angle about a horizontal axis through point (px, py, pz) along (dx, dy, 0), applied after pose.
function rotateAbout(pose, px, py, pz, dx, dy, angle) {
  const c = Math.cos(angle), s = Math.sin(angle), k = 1 - c;
  // Rodrigues for axis (dx, dy, 0).
  const R = [
    c + dx * dx * k, dx * dy * k, dy * s,
    dy * dx * k, c + dy * dy * k, -dx * s,
    -dy * s, dx * s, c,
  ];
  return compose3(R, [px, py, pz], pose);
}

// R (about center o) after pose.
function compose3(R, o, pose) {
  const r = mul33(R, pose.r);
  const q = [pose.t[0] - o[0], pose.t[1] - o[1], pose.t[2] - o[2]];
  const t = [
    R[0] * q[0] + R[1] * q[1] + R[2] * q[2] + o[0],
    R[3] * q[0] + R[4] * q[1] + R[5] * q[2] + o[1],
    R[6] * q[0] + R[7] * q[1] + R[8] * q[2] + o[2],
  ];
  return { r, t };
}

function mul33(a, b) {
  const o = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return o;
}

export function transformPoint(pose, u, v) {
  const r = pose.r, t = pose.t;
  return [r[0] * u + r[1] * v + t[0], r[3] * u + r[4] * v + t[1], r[6] * u + r[7] * v + t[2]];
}

// The height a flap turns about. The whole flap turns as one stack about a single line, so its layers
// keep their spacing in the air; each layer then drifts the last bit to its exact new height.
function axisHeight(ids, zFrom, zTo, bend, sign) {
  if (!ids.length) return 0;
  if (bend) {
    const zs = ids.map(zFrom);
    return sign > 0 ? Math.min(...zs) : Math.max(...zs);
  }
  let sum = 0;
  for (const id of ids) sum += (zFrom(id) + zTo(id)) / 2;
  return sum / ids.length;
}

// Poses for every facet of step.from at time t in [0, 1]: [{ facet, pose }].
export function poses(step, t) {
  const { from, to, motion } = step;
  const z0 = from.levels(), z1 = to.levels();
  const e = ease(Math.min(1, Math.max(0, t)));
  const out = [];
  const moving = new Set(motion.moving || []);
  const zFrom = (id) => z0.get(id) * LAYER;
  const zTo = (id) => (z1.has(id) ? z1.get(id) : z0.get(id)) * LAYER;

  if (motion.kind === 'turnOver' || motion.kind === 'turn') {
    const b = from.bounds();
    const lift = motion.kind === 'turnOver'
      ? Math.sin(Math.PI * e) * (motion.how === 'side' ? (b.x1 - b.x0) : (b.y1 - b.y0)) * 0.55
      : 0;
    for (const id of from.order) {
      const f = from.facets.get(id);
      let pose = flatPose(f.m, zFrom(id));
      if (motion.kind === 'turnOver') {
        const L = motion.line, hz = (zFrom(id) + zTo(id)) / 2;
        pose = rotateAbout(pose, L.p[0], L.p[1], hz, L.d[0], L.d[1], Math.PI * e);
        pose.t[2] += lift;
      } else {
        const a = (motion.deg * Math.PI / 180) * e, c = Math.cos(a), s = Math.sin(a);
        const R = [c, -s, 0, s, c, 0, 0, 0, 1];
        pose = compose3(R, [motion.center[0], motion.center[1], 0], pose);
        pose.t[2] = zFrom(id) + (zTo(id) - zFrom(id)) * e;
      }
      out.push({ facet: f, pose });
    }
    return lifted(out);
  }

  if (motion.kind === 'multi') {
    const partOf = new Map();
    for (const part of motion.parts) {
      part.h = axisHeight(part.moving, zFrom, zTo, part.bend, part.sign);
      for (const id of part.moving) partOf.set(id, part);
    }
    for (const id of from.order) {
      const f = from.facets.get(id);
      const part = partOf.get(id);
      let pose;
      if (!part) pose = flatPose(f.m, zFrom(id) + (zTo(id) - zFrom(id)) * e);
      else {
        const zs = zFrom(id), H = part.h;
        const L = part.line;
        pose = rotateAbout(flatPose(f.m, zs), L.p[0], L.p[1], H, L.d[0], L.d[1], part.sign * (part.angle * Math.PI / 180) * e);
        if (!part.bend) pose.t[2] += (zTo(id) - (2 * H - zs)) * e;
      }
      if (motion.roll) {
        const R = motion.roll;
        pose = rotateAbout(pose, R.line.p[0], R.line.p[1], 0, R.line.d[0], R.line.d[1], (R.angle * Math.PI / 180) * e);
      }
      out.push({ facet: f, pose });
    }
    return lifted(out);
  }

  let angle, zMid = null;
  if (motion.kind === 'fold') angle = Math.PI * e;
  else if (motion.kind === 'foldUnfold') {
    angle = Math.PI * (t < 0.5 ? ease(2 * t) : ease(2 - 2 * t));
    zMid = motion.folded.levels();
  } else if (motion.kind === 'bend') angle = (motion.angle * Math.PI / 180) * e;
  angle *= motion.sign;

  const L = motion.line;
  const ids = motion.moving || [];
  const zLand = motion.kind === 'foldUnfold' ? (id) => zMid.get(id) * LAYER : zTo;
  const H = axisHeight(ids, zFrom, zLand, motion.kind === 'bend', motion.sign);
  // How far through the turn: the last-bit drift follows it, and undoes itself on the way back.
  const through = Math.abs(angle) / Math.PI;
  for (const id of from.order) {
    const f = from.facets.get(id);
    if (!moving.has(id)) {
      const z = zFrom(id) + (zTo(id) - zFrom(id)) * e;
      out.push({ facet: f, pose: flatPose(f.m, z) });
      continue;
    }
    const zs = zFrom(id);
    const pose = rotateAbout(flatPose(f.m, zs), L.p[0], L.p[1], H, L.d[0], L.d[1], angle);
    if (motion.kind !== 'bend') pose.t[2] += (zLand(id) - (2 * H - zs)) * through;
    out.push({ facet: f, pose });
  }
  return lifted(out);
}

// Nothing goes through the table: if part of the paper would dip below it, lift the whole sheet, the way
// you pick the paper up to fold something behind.
function lifted(items) {
  let low = 0;
  for (const it of items) for (const q of corners(it)) low = Math.min(low, q[2]);
  if (low < 0) for (const it of items) it.pose.t[2] -= low;
  return items;
}

// What a diagram would draw for this step: the fold line across the moving layers and an arrow from the
// moving part to where it lands. All in 3D table coordinates.
export function marks(step) {
  const { from, motion } = step;
  if (motion.kind === 'multi') {
    return motion.parts.map((p) => markFor(from, { ...p, kind: p.bend ? 'bend' : 'fold' })).filter(Boolean);
  }
  if (!['fold', 'foldUnfold', 'bend'].includes(motion.kind)) return null;
  const m = markFor(from, motion);
  return m ? [m] : null;
}

function markFor(from, motion) {
  const L = motion.line;
  const levels = from.levels();
  // How far along the line the moving layers reach.
  let lo = Infinity, hi = -Infinity, top = 0;
  let ax = 0, ay = 0, aw = 0;
  for (const id of motion.moving) {
    const w = from.world(id);
    for (const q of w) {
      if (Math.abs(side(L, q)) < 1e-6) {
        const s = dot(sub(q, L.p), L.d);
        lo = Math.min(lo, s); hi = Math.max(hi, s);
      }
    }
    const a = Math.abs(area(w)), c = centroid(w);
    ax += c[0] * a; ay += c[1] * a; aw += a;
  }
  for (const id of from.order) top = Math.max(top, levels.get(id));
  if (!isFinite(lo)) return null;
  const pad = (hi - lo) * 0.06 + 0.02;
  const z = (top + 1) * LAYER + 0.002;
  const a = add(L.p, mul(L.d, lo - pad)), b = add(L.p, mul(L.d, hi + pad));
  // The arrow runs from the middle of the moving part, over the line, to its mirror image; never so
  // close to the line that it shrinks to a squiggle.
  let start = aw ? [ax / aw, ay / aw] : L.p;
  const off = side(L, start);
  if (Math.abs(off) < 0.07) start = [start[0] - L.d[1] * (0.07 - off), start[1] + L.d[0] * (0.07 - off)];
  const end = reflectPoint(L, start);
  return {
    type: motion.type,
    line: [[a[0], a[1], z], [b[0], b[1], z]],
    arrow: { from: [start[0], start[1], z], to: [end[0], end[1], z], over: motion.sign > 0, angle: motion.kind === 'bend' ? motion.angle : 180 },
  };
}

// The facet's corners on the paper and in 3D.
export function corners(item) {
  return item.facet.poly.map(([u, v]) => transformPoint(item.pose, u, v));
}

export { apply };
