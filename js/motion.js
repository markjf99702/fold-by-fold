// Where every facet is, in 3D, at any moment of a step.
//
// Between steps the sheet lies flat, each facet raised by the number of layers under it. During a fold,
// the moving facets turn about the fold line (lifted halfway between where they start and where they
// land, so they arrive exactly on their new layer); everything else stays put.

import {
  apply, det, dot, sub, side, reflectPoint, centroid, area, add, mul, line, intersect, norm, cross, lerp, inside, overlapArea, sharedSegment,
} from './geom.js';

export const LAYER = 0.0015; // thickness of one layer of paper, in sheet widths (about 0.2 mm on a 15 cm sheet)

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

// Poses for every facet of step.from at time t in [0, 1]: [{ facet, pose }]. raw: as the fold turns them, before the
// paper is lifted or tipped off the mat.
export function poses(step, t, raw = false) {
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
    return raw ? out : lifted(out);
  }

  if (motion.kind === 'mech') return raw ? motion.at(t) : lifted(motion.at(t));
  if (motion.kind === 'reverse') return raw ? reversePoses(step, e, zFrom, zTo) : lifted(reversePoses(step, e, zFrom, zTo));

  if (motion.kind === 'multi') {
    // Folds and unfolds made together fold up and open again, as one fold and unfold does: halfway, every layer is where
    // all the folds put it.
    const back = !!motion.folded;
    const zMid = back ? motion.folded.levels() : null;
    const zLand = back ? (id) => zMid.get(id) * LAYER : zTo;
    const u = Math.min(1, Math.max(0, t));
    const go = back ? (u < 0.5 ? ease(2 * u) : ease(2 - 2 * u)) : e; // how far over the folds are, and so how far each layer has drifted
    const partOf = new Map();
    // Inside reverse folds among the parts move the way they do on their own, bridges and all.
    const reversed = new Map(), bridges = [];
    for (const part of motion.parts) {
      if (part.reverse) {
        for (const it of reversePoses({ from, motion: part.reverse }, e, zFrom, zTo)) {
          if (it.bridge) bridges.push(it);
          else if (part.reverse.moving.includes(it.facet.id)) reversed.set(it.facet.id, it.pose);
        }
        continue;
      }
      part.h = axisHeight(part.moving, zFrom, zLand, part.bend, part.sign);
      for (const id of part.moving) partOf.set(id, part);
    }
    for (const id of from.order) {
      const f = from.facets.get(id);
      const part = partOf.get(id);
      let pose;
      if (reversed.has(id)) pose = reversed.get(id);
      else if (!part) pose = flatPose(f.m, zFrom(id) + (zLand(id) - zFrom(id)) * go + roomFor(step, id, t));
      else {
        const zs = zFrom(id), H = part.h;
        const L = part.line;
        // A bend can keep its own time (a wing that flaps), as a fraction of its angle at each moment.
        const k = part.schedule ? part.schedule(u) : go;
        pose = rotateAbout(flatPose(f.m, zs), L.p[0], L.p[1], H, L.d[0], L.d[1], part.sign * (part.angle * Math.PI / 180) * k);
        if (!part.bend) pose.t[2] += (zLand(id) - (2 * H - zs)) * go;
      }
      if (motion.roll) {
        const R = motion.roll;
        const k = R.schedule ? R.schedule(Math.min(1, Math.max(0, t))) : e;
        pose = rotateAbout(pose, R.line.p[0], R.line.p[1], 0, R.line.d[0], R.line.d[1], (R.angle * Math.PI / 180) * k);
      }
      out.push({ facet: f, pose });
    }
    return raw ? out.concat(bridges) : lifted(tipped(step, out.concat(bridges), t));
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
      // In a fold and unfold, the layers that stay put make room for the flap too (lifting off a flap
      // folded behind them) and settle back as it opens.
      const z = motion.kind === 'foldUnfold'
        ? zFrom(id) + (zLand(id) - zFrom(id)) * through
        : zFrom(id) + (zTo(id) - zFrom(id)) * e + roomFor(step, id, t);
      out.push({ facet: f, pose: flatPose(f.m, z) });
      continue;
    }
    const zs = zFrom(id);
    const pose = rotateAbout(flatPose(f.m, zs), L.p[0], L.p[1], H, L.d[0], L.d[1], angle);
    if (motion.kind !== 'bend') pose.t[2] += (zLand(id) - (2 * H - zs)) * through;
    out.push({ facet: f, pose });
  }
  return raw ? out : lifted(tipped(step, out, t));
}

// A point tucked into a pocket turns over about the pocket's mouth and goes in under the layers over the pocket. Stiff
// paper can't slip under them as real paper does, and turning in, the point passed through them. So, the way the layers
// that stay put make room for a flap folded behind them in a fold and unfold, the layers over the pocket rise to make
// room: as high as the point is above its crease, and they settle as it goes in. They are the layers that stay put and
// end up over the tucked paper, and whatever lies on them. Worked out once for each step: { id: [part, reach] }.
const pockets = new WeakMap();
function roomFor(step, id, t) {
  const { motion } = step;
  if (!pockets.has(motion)) pockets.set(motion, overPockets(step));
  const it = pockets.get(motion).get(id);
  if (!it) return 0;
  const [part, reach] = it;
  const k = part.schedule ? part.schedule(Math.min(1, Math.max(0, t))) : ease(Math.min(1, Math.max(0, t)));
  return reach * Math.abs(Math.sin((part.angle ?? 180) * Math.PI / 180 * k));
}
function overPockets(step) {
  const { from, to, motion } = step;
  const out = new Map();
  const parts = motion.kind === 'multi' ? motion.parts : [motion];
  if (!parts.some((p) => p.tuck)) return out;
  const moving = new Set(motion.moving || []);
  const pos = new Map(to.order.map((id, k) => [id, k]));
  for (const part of parts) {
    if (!part.tuck) continue;
    // How far the point reaches from its crease.
    let reach = 0;
    for (const id of part.moving) for (const q of from.world(id)) reach = Math.max(reach, Math.abs(side(part.line, q)));
    const over = [];
    for (const id of to.order) { // from the table up, so whatever lies on a layer over the pocket comes after it
      if (moving.has(id) || out.has(id)) continue;
      const under = [...part.moving, ...over];
      if (under.some((u) => pos.get(u) < pos.get(id) && overlapArea(to.world(u), to.world(id)) > 1e-7)) over.push(id);
    }
    for (const id of over) out.set(id, [part, reach]);
  }
  return out;
}

// An inside reverse fold can't be made with stiff paper: real paper gives a little near the crease so the
// tip can slip between the layers. Here the tip swings round the point where the crease meets its folded
// edge, and turns over along that edge like a page as it goes, so it arrives inside out. The tip's front
// half turns about a line at the top of its layers and the back half about one at the bottom, which keeps
// the front half in front; each layer then drifts the last bit to its height in the finished stack.
function reversePoses(step, e, zFrom, zTo) {
  const { from, motion } = step;
  const L = motion.line;
  const [s0, s1] = motion.spine;
  const V = intersect(line(s0, s1), L);
  const far = Math.hypot(s0[0] - V[0], s0[1] - V[1]) > Math.hypot(s1[0] - V[0], s1[1] - V[1]) ? s0 : s1;
  const d = norm(sub(far, V));
  let phi = 2 * (Math.atan2(L.d[1], L.d[0]) - Math.atan2(d[1], d[0]));
  phi = Math.atan2(Math.sin(phi), Math.cos(phi)); // the short way round
  if (Math.abs(Math.abs(phi) - Math.PI) < 1e-9) phi = Math.PI;
  // Turn the tip so its far side lifts off the table first.
  let cx = 0, cy = 0, n = 0;
  for (const id of motion.moving) { const c = centroid(from.world(id)); cx += c[0]; cy += c[1]; n++; }
  const roll = cross(d, [cx / n - V[0], cy / n - V[1]]) > 0 ? 1 : -1;
  const axisZ = new Map();
  const top = Math.max(...motion.front.map(zFrom)), bottom = Math.min(...motion.back.map(zFrom));
  for (const id of motion.front) axisZ.set(id, top);
  for (const id of motion.back) axisZ.set(id, bottom);
  const c = Math.cos(phi * e), s = Math.sin(phi * e);
  const swing = [c, -s, 0, s, c, 0, 0, 0, 1];
  const items = from.order.map((id) => {
    const f = from.facets.get(id);
    if (!axisZ.has(id)) return { facet: f, pose: flatPose(f.m, zFrom(id) + (zTo(id) - zFrom(id)) * e) };
    const a = axisZ.get(id), z = zFrom(id);
    let pose = rotateAbout(flatPose(f.m, z), V[0], V[1], a, d[0], d[1], roll * Math.PI * e);
    pose = compose3(swing, [V[0], V[1], 0], pose);
    pose.t[2] += (zTo(id) - (2 * a - z)) * e;
    return { facet: f, pose };
  });
  // Where the tip pulls away from the rest of its layer along the crease, a strip of paper bends across
  // the gap, the way real paper gives there.
  const poseOf = new Map(items.map((it) => [it.facet.id, it.pose]));
  for (const { tip, base, edge: [p0, p1] } of motion.hinges) {
    const T = poseOf.get(tip), B = poseOf.get(base);
    const pts = [transformPoint(T, ...p1), transformPoint(T, ...p0), transformPoint(B, ...p0), transformPoint(B, ...p1)];
    const n = norm3(cross3(sub3(pts[1], pts[0]), sub3(pts[3], pts[0])));
    items.push({ facet: { poly: [p1, p0, p0, p1] }, pts, pose: { r: [1, 0, n[0], 0, 1, n[1], 0, 0, n[2]], t: [0, 0, 0] }, bridge: true });
  }
  return items;
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A fold behind swings its flap down under the model. Rather than the whole model rising off the mat to let it pass (by up
// to half its size), it tips up on an edge as the flap swings under, the way you lift the paper to fold something behind
// it, and lies down again as the flap lands. It lifts the side nearest you, resting on the far edge, so the flap is seen
// swinging underneath. A flap on the far side, folded behind from the far edge, would go down through the mat that way,
// so there the model lifts the flap's side instead, resting on the edge across from it. Either way it tips no further than
// MOST_TIP, and if the flap needs more room than that, the model is lifted the rest of the way, as it was before. A step
// that stands the model up moves it its own way.
const MOST_TIP = 70 * Math.PI / 180;
const TIP_RATE = 6; // the fastest the model tips, in radians per whole step
const tips = new WeakMap();
function tipped(step, items, t) {
  const { motion } = step;
  if (!tips.has(motion)) tips.set(motion, tipFor(step));
  const tip = tips.get(motion);
  if (!tip) return items;
  const N = tip.angles.length - 1, x = Math.min(1, Math.max(0, t)) * N, k = Math.min(N - 1, Math.floor(x));
  const a = tip.angles[k] + (tip.angles[k + 1] - tip.angles[k]) * (x - k);
  if (!(a > 0)) return items;
  const { p, d, u } = tip;
  const angle = a * (d[0] * u[1] - d[1] * u[0]); // the way that lifts the side u points to
  for (const it of items) {
    if (it.pts) it.pts = it.pts.map((q) => rotateAbout({ r: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: q.slice() }, p[0], p[1], 0, d[0], d[1], angle).t);
    else it.pose = rotateAbout(it.pose, p[0], p[1], 0, d[0], d[1], angle);
  }
  return items;
}

// For the paper posed as items, how far tipping it about the line through p on the mat lifts it clear: the least angle
// that lifts every point under the mat on the side u points to, as far as MOST_TIP, and the most it would still have to
// be lifted after that.
function tilt({ p, u }, items) {
  const pts = items.flatMap((it) => corners(it)).map((q) => [(q[0] - p[0]) * u[0] + (q[1] - p[1]) * u[1], q[2]]);
  let a = 0;
  // Tipped by a, a point v out from the line and z up goes to z cos a + v sin a.
  for (const [v, z] of pts) if (z < -1e-12 && v > 1e-9) a = Math.max(a, Math.atan2(-z, v));
  a = Math.min(a, MOST_TIP);
  let lift = 0;
  for (const [v, z] of pts) lift = Math.max(lift, -(z * Math.cos(a) + v * Math.sin(a)));
  return { a, lift };
}

// Which edge a step that folds behind tips the model on, and how far at each moment: { p, d, u, angles }, or null.
function tipFor(step) {
  const { from, motion } = step;
  if (motion.roll || !['fold', 'foldUnfold', 'multi'].includes(motion.kind)) return null;
  const parts = motion.kind === 'multi' ? motion.parts : [motion];
  if (parts.some((q) => q.bend || q.reverse)) return null;
  const behind = parts.filter((q) => q.sign < 0);
  if (!behind.length) return null;
  const moving = new Set(motion.moving || []);
  const still = from.order.filter((id) => !moving.has(id)).flatMap((id) => from.world(id));
  if (!still.length) return null;
  // Resting on the edge of the paper that stays put, as far as it goes the other way from u.
  const edge = (d, u) => {
    let low = Infinity, p = null;
    for (const q of still) { const v = q[0] * u[0] + q[1] * u[1]; if (v < low) { low = v; p = q; } }
    return { p, d, u };
  };
  const ways = [edge([1, 0], [0, -1])]; // the far edge, lifting the near side
  // The flaps' side of the line the first one folds on, if they're all folded on lines along it, on the same side.
  const L = behind[0].line;
  const sides = behind.map((q) => {
    let c = [0, 0], n = 0;
    for (const id of q.moving) for (const w of from.world(id)) { c = add(c, w); n++; }
    return Math.abs(cross(q.line.d, L.d)) < 1e-6 ? Math.sign(side(L, mul(c, 1 / n))) : 0;
  });
  if (sides[0] && sides.every((x) => x === sides[0])) {
    const s = sides[0];
    ways.push(edge(L.d, [-L.d[1] * s, L.d[0] * s])); // the edge across from the flap, lifting the flap's side
  }
  const N = 80;
  const raw = [];
  for (let k = 0; k <= N; k++) raw.push(poses(step, k / N, true));
  // The far edge if tipping on it clears the mat all through the fold; otherwise whichever leaves the least to lift.
  let best = null;
  for (const way of ways) {
    const fits = raw.map((items) => tilt(way, items));
    const lift = Math.max(...fits.map((f) => f.lift));
    if (!best || lift < best.lift - 1e-9) best = { ...way, lift, fits };
    if (lift < 1e-9) break;
  }
  if (best.fits.every((f) => f.a === 0)) return null;
  // How far it tips: as far as the flap needs, at a pace it can keep, and flat as the fold starts and ends (and in the
  // middle of a fold and unfold, where the flap lies folded), where the flap hardly moves and needs very little room: what
  // little it needs there, the model is lifted. (A fold and unfold folds in half the time, and the smoothing below reaches
  // 6 samples either way.)
  const back = !!motion.folded; // a fold and unfold, or several made together
  const end = back ? 0.09 : 0.12;
  const flat = (k) => k <= N * end || k >= N * (1 - end) || (back && Math.abs(k - N / 2) <= N * 0.085);
  const want = best.fits.map((f, k) => (flat(k) ? 0 : f.a));
  const most = TIP_RATE / N, angles = want.slice();
  for (let k = 1; k <= N; k++) angles[k] = Math.max(angles[k], angles[k - 1] - most);
  for (let k = N - 1; k >= 0; k--) angles[k] = Math.max(angles[k], angles[k + 1] - most);
  // ...but never tipped where it has to lie flat: there it comes down at that pace, lifted instead as it needs.
  const cap = want.map((_, k) => (flat(k) ? 0 : Infinity));
  for (let k = 1; k <= N; k++) cap[k] = Math.min(cap[k], cap[k - 1] + most);
  for (let k = N - 1; k >= 0; k--) cap[k] = Math.min(cap[k], cap[k + 1] + most);
  // And smoothed, so it eases into each change of pace rather than turning a corner, without falling short of the room the
  // flap needs.
  let smooth = angles.map((_, k) => Math.min(Math.max(...angles.slice(Math.max(0, k - 6), k + 7)), cap[k]));
  for (let pass = 0; pass < 2; pass++) {
    smooth = smooth.map((_, k) => {
      let sum = 0, w = 0;
      for (let j = -3; j <= 3; j++) { const q = smooth[k + j]; if (q === undefined) continue; sum += q * (4 - Math.abs(j)); w += 4 - Math.abs(j); }
      return sum / w;
    });
  }
  smooth[0] = smooth[N] = 0;
  if (back) smooth[N / 2] = 0;
  return { p: best.p, d: best.d, u: best.u, angles: smooth };
}

// Nothing goes through the table: if part of the paper would still dip below it, lift the whole sheet, the way you pick
// the paper up.
function lifted(items) {
  let low = 0;
  for (const it of items) for (const q of corners(it)) low = Math.min(low, q[2]);
  if (low < 0) {
    for (const it of items) {
      if (it.pts) for (const q of it.pts) q[2] -= low;
      else it.pose.t[2] -= low;
    }
  }
  return items;
}

// What a diagram would draw for this step: the fold line across the moving layers and an arrow from the
// moving part to where it lands. All in 3D table coordinates.
//
// The arrow's head follows the usual convention (Lang, 'Origami Diagramming Conventions'): a solid head for a
// valley fold, a single-sided hollow one for a mountain fold, and a double-sided hollow one for unfolding. A
// fold and unfold has a hollow head at its tail too (`back`), for coming back.
export function marks(step) {
  const m = stepMarks(step);
  // Opening a fold made earlier: the line is the crease that's already there, and the arrow unfolds.
  if (m && step.unfold) for (const k of m) { k.unfold = true; if (k.arrow) k.arrow.head = 'unfold'; }
  return m;
}

// Whether a step turns paper about a line running straight away from you as you usually see it (up the screen, to within
// 8 degrees), so that halfway through, the paper that moves stands edge-on to you and all but vanishes: every turn over,
// the frog's squash folds and pages, and a few more (39 steps of 138).
export function edgeOn(step) {
  const { motion } = step;
  const lines = motion.kind === 'multi' ? motion.parts.filter((p) => !p.bend).map((p) => p.line)
    : ['fold', 'foldUnfold', 'turnOver'].includes(motion.kind) ? [motion.line]
      : motion.squash ? [line(motion.squash.line[0], motion.squash.to)] : [];
  return lines.some((L) => L && Math.abs(L.d[0]) < Math.sin(8 * Math.PI / 180));
}

// The symbol a diagram's key gives a step: the kind of line it draws (both kinds, for a collapse or a petal
// fold), or the move for one that turns the whole model. m: the step's marks, if they're to hand.
export function symbol(step, m) {
  const k = step.motion.kind;
  if (k === 'turnOver') return 'turnOver';
  if (k === 'turn') return 'rotate';
  if (step.unfold) return 'unfold';
  const types = new Set(((m === undefined ? marks(step) : m) || []).map((mk) => mk.type));
  return types.size > 1 ? 'both' : types.has('mountain') ? 'mountain' : 'valley';
}

function stepMarks(step) {
  const m = foldMarks(step);
  const { motion } = step;
  if (!m || !['fold', 'multi'].includes(motion.kind) || motion.folded) return m;
  // A flap folded toward you that lands under a layer that stays put has been tucked into a pocket.
  const moving = new Set(motion.moving || motion.parts.flatMap((p) => p.moving || []));
  for (const k of m) {
    if (!k.arrow?.over || k.type !== 'valley') continue;
    const top = step.to.topAt(k.arrow.to.slice(0, 2));
    if (top && !moving.has(top.id)) k.arrow.tuck = true;
  }
  return m;
}

function foldMarks(step) {
  const { from, motion } = step;
  if (motion.kind === 'mech' && motion.squash) {
    const q = motion.squash, z = (Math.max(...from.levels().values()) + 1) * LAYER + 0.002;
    return [{ type: 'valley', line: q.line.map((p) => [p[0], p[1], z]), arrow: { from: [...q.from, z], to: [...q.to, z], over: true, angle: 180, head: 'valley' } }];
  }
  if (motion.kind === 'mech' && motion.parts) {
    return padded(sharingLines(motion.parts.flatMap((p) => markFor(from, { ...p, sign: -1, type: 'mountain', kind: 'fold' }))));
  }
  if (motion.kind === 'mech') return mechMarks(step);
  if (motion.kind === 'reverse') return padded(sharingLines(markFor(from, { ...motion, sign: -1, type: 'mountain', kind: 'fold' })));
  if (motion.kind === 'multi') {
    return padded(sharingLines(motion.parts.flatMap((p) => markFor(from, { ...p, kind: p.bend ? 'bend' : p.back ? 'foldUnfold' : 'fold' }))));
  }
  if (motion.kind === 'turnOver' || motion.kind === 'turn') return [moveMark(step)];
  if (!['fold', 'foldUnfold', 'bend'].includes(motion.kind)) return null;
  return padded(sharingLines(markFor(from, motion)));
}

// Folds made together along one line (both wings at once, say) share one line, drawn in the style of the front
// fold, the valley. Their arrows sit side by side along it, the front one first, so neither hides the other;
// folds that go the same way have one arrow between them. Each mark knows its fold's line (L) and whether a
// point is on the paper it moves (on), from markFor.
function sharingLines(marks) {
  const out = [], taken = new Set();
  const span = (m) => m.line.map((q) => dot(sub(q, m.L.p), m.L.d)).sort((x, y) => x - y);
  const same = (m, o) => {
    if (Math.abs(cross(m.L.d, o.L.d)) > 1e-6 || Math.abs(side(m.L, o.L.p)) > 1e-6) return false;
    const [a0, a1] = span(m), b = o.line.map((q) => dot(sub(q, m.L.p), m.L.d)).sort((x, y) => x - y);
    return a0 < b[1] + 1e-6 && b[0] < a1 + 1e-6; // and they overlap along it
  };
  marks.forEach((m, i) => {
    if (taken.has(i)) return;
    const group = [m];
    for (let j = i + 1; j < marks.length; j++) if (!taken.has(j) && same(m, marks[j])) { group.push(marks[j]); taken.add(j); }
    if (group.length === 1) { out.push(m); return; }
    const L = m.L, along = (q) => dot(sub(q, L.p), L.d);
    const ss = group.flatMap((k) => k.line.map(along));
    const lo = Math.min(...ss), hi = Math.max(...ss), z = m.line[0][2];
    const at = (s) => { const q = add(L.p, mul(L.d, s)); return [q[0], q[1], z]; };
    const front = group.find((k) => k.type === 'valley') || m;
    const arrows = [];
    for (const k of [front, ...group.filter((g) => g !== front)]) {
      const a = k.arrow, way = sub(a.to, a.from);
      if (!arrows.some(({ arrow: b }) => b.over === a.over && dot(sub(b.to, b.from), way) > 0)) arrows.push(k);
    }
    arrows.forEach((k, n) => {
      if (arrows.length > 1) {
        // Slide it along the line toward its place, a third of the way along, two thirds, and so on, as far as
        // it can go and still start on the paper it moves.
        const from = k.arrow.from, base = along(from), want = lo + ((n + 1) / (arrows.length + 1)) * (hi - lo) - base;
        let best = 0;
        for (let q = 0; q <= 40; q++) {
          const d = (want * q) / 40;
          if (k.on([from[0] + L.d[0] * d, from[1] + L.d[1] * d])) best = d; else break;
        }
        k.arrow.from = [from[0] + L.d[0] * best, from[1] + L.d[1] * best, z];
        k.arrow.to = [k.arrow.to[0] + L.d[0] * best, k.arrow.to[1] + L.d[1] * best, z];
      }
      out.push(n === 0 ? { type: front.type, line: [at(lo), at(hi)], arrow: k.arrow } : { type: k.type, line: null, arrow: k.arrow });
    });
  });
  // Plain marks from here on.
  return out.map((m) => ({ type: m.type, line: m.line, arrow: m.arrow }));
}

// Fold lines run a little past the paper they cross, so their ends show, except where two lines meet (corners
// folded to the middle, say): there they stop, rather than crossing like a printer's crop marks.
function padded(marks) {
  const list = marks.filter(Boolean);
  const ends = list.filter((m) => m.line).flatMap((m) => m.line.map((q) => [m, q]));
  for (const m of list) {
    if (!m.line) continue;
    const [a, b] = m.line, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], pad = len * 0.08;
    const shared = (q) => ends.some(([o, e]) => o !== m && Math.hypot(e[0] - q[0], e[1] - q[1]) < 1e-6);
    const sa = shared(a), sb = shared(b);
    m.line = [sa ? a : [a[0] - d[0] * pad, a[1] - d[1] * pad, a[2]], sb ? b : [b[0] + d[0] * pad, b[1] + d[1] * pad, b[2]]];
  }
  return list.length ? list : null;
}

// Turning the whole model over or around moves no crease, so a diagram draws a symbol beside it instead. Here
// it lies flat on the table just in front of the model: for turning over, a valley fold arrow with a loop in
// it, its long side across the line the model turns about (Lang, 'Origami Diagramming Conventions'); for
// turning around, a circular arrow going the way it turns. { type, path: points on the table, arrow }.
function moveMark(step) {
  const { from, motion } = step;
  const b = from.bounds();
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0, 0.55);
  const gap = 0.07 * size, z = 0.001, N = 56;
  const path = [];
  if (motion.kind === 'turnOver') {
    // A loop at the top of an arch: x = k(t - B sin t), y = kB cos t for t from -pi to pi.
    const k = (0.42 * size) / (2 * Math.PI), B = 1.5;
    // Turning over side to side, the left edge comes up and over to the right; end to end, the top comes down.
    const side = motion.how !== 'end';
    for (let i = 0; i <= N; i++) {
      const t = -Math.PI + (2 * Math.PI * i) / N;
      const u = k * (t - B * Math.sin(t)), v = k * B * (Math.cos(t) - 1);
      path.push(side ? [b.cx + u, b.y0 - gap + v, z] : [b.x1 + gap - v, b.cy - u, z]);
    }
  } else {
    const r = 0.075 * size, cy = b.y0 - gap - r, dir = Math.sign(motion.deg) || 1;
    const a0 = Math.PI / 2 - dir * Math.PI / 5;
    for (let i = 0; i <= N; i++) {
      const a = a0 + dir * (i / N) * (5 * Math.PI / 3);
      path.push([b.cx + r * Math.cos(a), cy + r * Math.sin(a), z]);
    }
  }
  return { type: motion.kind === 'turnOver' ? 'turnOver' : 'rotate', path, arrow: { head: 'valley' } };
}

// One mark for each separate piece of paper the fold moves (both bumps of the heart, say), as a diagram marks
// them: the line across the piece, and an arrow from its middle over the line to where that lands.
function markFor(from, motion) {
  const levels = from.levels();
  let top = 0;
  for (const id of from.order) top = Math.max(top, levels.get(id));
  const z = (top + 1) * LAYER + 0.002;
  return pieces(from, motion.moving).map((ids) => pieceMark(from, motion, ids, z)).filter(Boolean);
}

// The moving facets in pieces: facets lying on each other or joined along an edge are one piece.
function pieces(from, ids) {
  const group = new Map(ids.map((id) => [id, id]));
  const find = (id) => (group.get(id) === id ? id : find(group.get(id)));
  const touch = (a, b) => {
    const A = from.world(a), B = from.world(b);
    if (overlapArea(A, B) > 1e-7) return true;
    for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
      if (sharedSegment(A[i], A[(i + 1) % A.length], B[j], B[(j + 1) % B.length])) return true;
    }
    return false;
  };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (find(ids[i]) !== find(ids[j]) && touch(ids[i], ids[j])) group.set(find(ids[i]), find(ids[j]));
  }
  const out = new Map();
  for (const id of ids) { const r = find(id); if (!out.has(r)) out.set(r, []); out.get(r).push(id); }
  return [...out.values()];
}

const NEAR = 0.07; // the closest an arrow starts to its line, so it doesn't shrink to a squiggle

// Where line L runs over (or along the edge of) the convex polygon w, as [lo, hi] along L.d from L.p, or null. Its
// ends are corners of w on the line, or where an edge of w crosses it.
function alongLine(L, w) {
  let lo = Infinity, hi = -Infinity;
  const at = (q) => { const s = dot(sub(q, L.p), L.d); lo = Math.min(lo, s); hi = Math.max(hi, s); };
  for (let i = 0; i < w.length; i++) {
    const a = w[i], b = w[(i + 1) % w.length], sa = side(L, a), sb = side(L, b);
    if (Math.abs(sa) < 1e-6) at(a);
    else if (Math.abs(sb) >= 1e-6 && (sa > 0) !== (sb > 0)) at(lerp(a, b, sa / (sa - sb)));
  }
  return lo <= hi ? [lo, hi] : null;
}

function pieceMark(from, motion, ids, z) {
  const L = motion.line;
  // The piece's middle, and its point farthest from the line.
  let ax = 0, ay = 0, aw = 0, far = null, farOff = 0, farFacet = null, big = null, bigArea = 0;
  const runs = [];
  for (const id of ids) {
    const w = from.world(id);
    for (const q of w) {
      const off = Math.abs(side(L, q));
      if (off >= 1e-6 && off > farOff) { far = q; farOff = off; farFacet = w; }
    }
    const a = Math.abs(area(w)), c = centroid(w);
    ax += c[0] * a; ay += c[1] * a; aw += a;
    if (a > bigArea) { big = w; bigArea = a; }
    // Where the line runs along this facet. One that only touches it at a corner has nowhere to draw it.
    const run = alongLine(L, w);
    if (run && run[1] - run[0] > 1e-6) runs.push(run);
  }
  if (!runs.length || !big) return null;
  // The line goes only where there's paper: the longest stretch of it the piece covers without a gap.
  runs.sort((p, q) => p[0] - q[0]);
  let lo = runs[0][0], hi = runs[0][1], best = [lo, hi];
  for (const [p, q] of runs.slice(1)) {
    if (p > hi + 1e-6) { lo = p; hi = q; } else hi = Math.max(hi, q);
    if (hi - lo > best[1] - best[0]) best = [lo, hi];
  }
  [lo, hi] = best;
  const on = (q) => ids.some((id) => inside(from.world(id), q, 1e-6));
  // The arrow starts in the middle of the piece, or in its biggest facet if the middle falls in a gap.
  let start = [ax / aw, ay / aw];
  if (!on(start)) start = centroid(big);
  const off = side(L, start);
  if (Math.abs(off) < NEAR && far) {
    // Too close to the line: straight out to NEAR from it, or most of the way across a narrower piece, or else
    // (a slanting tip, say) next to the piece's point farthest from the line.
    const reach = Math.min(NEAR, 0.85 * farOff) - off;
    const out = [start[0] - L.d[1] * reach, start[1] + L.d[0] * reach];
    start = on(out) ? out : lerp(far, centroid(farFacet), 0.15);
  }
  const end = reflectPoint(L, start);
  const a = add(L.p, mul(L.d, lo)), b = add(L.p, mul(L.d, hi)); // padded() runs it on past the paper
  const m = {
    type: motion.type,
    line: [[a[0], a[1], z], [b[0], b[1], z]],
    arrow: {
      from: [start[0], start[1], z], to: [end[0], end[1], z], over: motion.sign > 0, angle: motion.kind === 'bend' ? motion.angle : 180,
      head: motion.type === 'mountain' ? 'mountain' : 'valley', back: motion.kind === 'foldUnfold',
    },
  };
  // For sharingLines: the fold's line, and whether a point is on this piece.
  return Object.assign(m, { L, on });
}

// A collapse or petal fold: the creases that close, drawn where they lie now, and an arrow following one
// point of the paper from where it starts to where it ends up.
function mechMarks(step) {
  const { from, to, motion } = step;
  const levels = from.levels();
  let top = 0;
  for (const id of from.order) top = Math.max(top, levels.get(id));
  const z = (top + 1) * LAYER + 0.002;
  const out = [];
  for (const s of motion.specs) {
    if (s.mark === false || (s.fold !== 'valley' && s.fold !== 'mountain')) continue;
    const a = from.at(s.a), b = from.at(s.b);
    // A crease is named as seen from the colored side (mech.js), but a diagram draws what you see from
    // above: where the paper lies white side up, as it does in every collapse, a valley shows as a mountain.
    const up = det(from.facetAt([(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2]).m) > 0;
    const type = up ? s.fold : s.fold === 'valley' ? 'mountain' : 'valley';
    out.push({ type, line: [[a[0], a[1], z], [b[0], b[1], z]] });
  }
  if (motion.arrow && out.length) {
    const p = from.at(motion.arrow), q = to.at(motion.arrow);
    out[0].arrow = { from: [p[0], p[1], z], to: [q[0], q[1], z], over: true, angle: 180, head: 'valley' };
  }
  return out.length ? out : null;
}

// The facet's corners on the paper and in 3D.
export function corners(item) {
  if (item.pts) return item.pts;
  return item.facet.poly.map(([u, v]) => transformPoint(item.pose, u, v));
}

export { apply };
