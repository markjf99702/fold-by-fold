// The models. Each step has what to say and what to do, in the helpers from build.js.
// Paper points are [u, v] on the unit square; `move` names a paper point on the part that moves;
// `flap` folds only the layer holding that point and whatever is joined to it.

const R2 = Math.SQRT2;

// The crane's paper points: corners, edge midpoints, the center, and where its kite creases meet the
// center lines (a 22.5 degree fold from each corner reaches them this far from the edge).
const K1 = [0, 0], K2 = [1, 0], K3 = [1, 1], K4 = [0, 1];
const M12 = [0.5, 0], M23 = [1, 0.5], M34 = [0.5, 1], M41 = [0, 0.5], C = [0.5, 0.5];
const KITE = (R2 - 1) / 2;
const P12 = [0.5, KITE], P23 = [1 - KITE, 0.5], P34 = [0.5, 1 - KITE], P41 = [KITE, 0.5];
// Where the folds that narrow the crane's legs cross the center lines: an 11.25 degree fold from the leg's
// corner.
const NARROW = Math.tan(Math.PI / 16) / 2;
const N12 = [0.5, NARROW], N23 = [1 - NARROW, 0.5], N34 = [0.5, 1 - NARROW], N41 = [NARROW, 0.5];
// Where the legs meet the body, on the center line, and how far below it the neck and tail turn up.
const H2 = [1 - R2 / 4, R2 / 4], H4 = [R2 / 4, 1 - R2 / 4];
const NECK = 0.035;
// Where a squash fold's creases from the center meet the edge: 22.5 degrees off the diagonal.
const SQ = 0.5 - (R2 - 1) / 2;

// The frog's four faces, one for each corner of the paper: the corner k, and the paper's edges leaving it
// along ea and eb (toward the edge midpoints that end up at the frog's head).
const FACE = {
  K1: { k: K1, ea: [1, 0], eb: [0, 1] },
  K2: { k: K2, ea: [-1, 0], eb: [0, 1] },
  K3: { k: K3, ea: [0, -1], eb: [-1, 0] },
  K4: { k: K4, ea: [1, 0], eb: [0, -1] },
};
// A paper point on a face, a along ea and b along eb from its corner.
const onFace = ({ k, ea, eb }, a, b) => [k[0] + a * ea[0] + b * eb[0], k[1] + a * ea[1] + b * eb[1]];
// Where a face's petal fold crease meets its squash creases, on the ea and eb sides.
const PA = [R2 / 4, (2 - R2) / 4], PB = [(2 - R2) / 4, R2 / 4];

// A petal fold on a face of the frog base. Its sides fold in along 22.5 degree creases that meet the
// squash creases, and the layer folded under each side hinges along the line from there to the edge
// midpoint, which is where it lands.
function petal(face, root) {
  const p = (a, b) => onFace(face, a, b);
  const pa = p(...PA), pb = p(...PB);
  return {
    root, arrow: face.k,
    creases: [
      { a: pa, b: pb, fold: 'valley', drive: true },
      { a: face.k, b: pa, fold: 'mountain' }, { a: face.k, b: pb, fold: 'mountain' },
      { a: p(SQ, 0), b: pa, fold: 'flat' }, { a: p(0, SQ), b: pb, fold: 'flat' },
      { a: pa, b: p(0.5, 0), fold: 'mountain', mark: false }, { a: pb, b: p(0, 0.5), fold: 'mountain', mark: false },
    ],
  };
}

// A paper point on one half of a face (side 'a' or 'b'), in the part of the squashed flap next to the
// middle line, well away from the leg.
function pageSeed(face, side) {
  const [x, y] = side === 'a' ? [0.3 + 0.15 + 0.1 * PA[0], 0.15 + 0.1 * PA[1]] : [0.15 + 0.1 * PB[0], 0.3 + 0.15 + 0.1 * PB[1]];
  return onFace(face, x, y);
}

// The line to inside reverse fold a leg along: it crosses the leg `at` from its tip, and sends the leg
// out to its own side, `deg` degrees off the line up the middle.
function legLine(h, face, at, deg) {
  const tip = h.at(face.k), end = h.at(M12);
  const len = Math.hypot(end[0] - tip[0], end[1] - tip[1]);
  const d = [(end[0] - tip[0]) / len, (end[1] - tip[1]) / len];
  const v = h.sub(h.at(onFace(face, 0.2, 0.12)), tip);
  const r = (-Math.sign(d[0] * v[1] - d[1] * v[0]) * (90 - deg / 2) * Math.PI) / 180;
  const p = [tip[0] + at * d[0], tip[1] + at * d[1]];
  return { p, d: [Math.cos(r) * d[0] - Math.sin(r) * d[1], Math.sin(r) * d[0] + Math.cos(r) * d[1]] };
}

// The line to inside reverse fold a foot along: across the leg `at` from its tip, turning the tip `deg`
// degrees toward the leg's open edge.
function footLine(h, face, at, deg) {
  const tip = h.at(face.k);
  const unit = (q) => { const v = h.sub(h.at(q), tip); const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
  const along = unit(onFace(face, 0.1, 0.1)), edge = unit(onFace(face, 0.1 * PA[0], 0.1 * PA[1]));
  const s = Math.sign(along[0] * edge[1] - along[1] * edge[0]);
  // Reflecting the tip in a line at -deg/2 from the leg turns it deg away from straight on, toward the edge.
  const r = (-s * (deg / 2) * Math.PI) / 180;
  return { p: [tip[0] + at * along[0], tip[1] + at * along[1]], d: [Math.cos(r) * along[0] - Math.sin(r) * along[1], Math.sin(r) * along[0] + Math.cos(r) * along[1]] };
}

// The wings of the flapping bird: up to halfway while it stands up, then three flaps, ending halfway.
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function flapping(t) {
  if (t < 0.3) return ease(t / 0.3);
  const u = (t - 0.3) / 0.7;
  return 1 + 0.55 * Math.sin(u * Math.PI * 6) * Math.sin(u * Math.PI);
}

// The square base: crease both ways, turn over, crease again, and collapse. Shared by the crane, the
// flapping bird and the frog.
const SQUARE_BASE = [
    {
      say: 'Colored side up. Fold the bottom corner up to the top corner, and unfold.',
      do: (h) => h.crease(h.onto(K1, K3), { move: K1 }),
    },
    {
      say: 'Fold the right corner over to the left corner, and unfold.',
      do: (h) => h.crease(h.onto(K2, K4), { move: K2 }),
    },
    {
      say: 'Turn it over, white side up.',
      do: (h) => h.turnOver(),
    },
    {
      say: 'Fold in half, lower right edge onto upper left edge, and unfold.',
      do: (h) => h.crease(h.onto(K1, K2), { move: K1 }),
    },
    {
      say: 'Fold in half the other way, lower left edge onto upper right edge, and unfold.',
      do: (h) => h.crease(h.onto(K1, K4), { move: K1 }),
    },
    {
      say: 'Bring the other three corners down to the bottom one. The left and right corners fold in between the layers along the creases, and it all flattens into a small square, colored on the outside. This is the square base.',
      name: 'Collapse',
      do: (h) => h.mech({
        root: [0.2, 0.2], arrow: K3,
        creases: [
          { a: C, b: M12, fold: 'mountain' }, { a: C, b: M23, fold: 'mountain' },
          { a: C, b: M34, fold: 'mountain' }, { a: C, b: M41, fold: 'mountain' },
          { a: C, b: K2, fold: 'valley' }, { a: C, b: K4, fold: 'valley' },
        ],
      }),
    },
];

// The bird base, shared by the crane and the flapping bird: crease, collapse into the square base, and
// petal fold both sides.
const BIRD_BASE = [
  ...SQUARE_BASE,
    {
      say: 'The open end points down. Fold the lower edges of the top layer in to the middle crease.',
      do: (h) => h.together(
        (k) => k.valley(k.through(K3, P23), { flap: [0.93, 0.66] }),
        (k) => k.valley(k.through(K3, P34), { flap: [0.66, 0.93] }),
      ),
    },
    {
      say: 'Fold the top triangle down over them, crease it well, and unfold.',
      do: (h) => h.crease(h.through(P23, P34), { move: C }),
    },
    {
      say: 'Unfold the two side flaps. Their creases stay to guide the next step.',
      name: 'Unfold',
      do: (h) => h.together(
        (k) => k.valley(k.through(K3, P23), { flap: [0.93, 0.66] }),
        (k) => k.valley(k.through(K3, P34), { flap: [0.66, 0.93] }),
      ),
    },
    {
      say: 'Lift the bottom corner of the top layer up along the crease across the middle. As it rises, the sides fold in along their creases and meet in the middle. Press it flat into a long diamond. This is a petal fold.',
      name: 'Petal fold',
      do: (h) => h.mech({
        root: [0.2, 0.2], arrow: K3,
        creases: [
          { a: P23, b: P34, fold: 'valley', drive: true },
          { a: K3, b: P23, fold: 'mountain' }, { a: K3, b: P34, fold: 'mountain' },
          { a: M23, b: P23, fold: 'flat' }, { a: M34, b: P34, fold: 'flat' },
          { a: K2, b: P23, fold: 'mountain', mark: false }, { a: K4, b: P34, fold: 'mountain', mark: false },
        ],
      }),
    },
    {
      say: 'Turn it over.',
      do: (h) => h.turnOver(),
    },
    {
      say: 'Fold the lower edges of the top layer in to the middle, as on the other side.',
      do: (h) => h.together(
        (k) => k.valley(k.through(K1, P12), { flap: [0.34, 0.07] }),
        (k) => k.valley(k.through(K1, P41), { flap: [0.07, 0.34] }),
      ),
    },
    {
      say: 'Fold the top triangle down over them and unfold.',
      do: (h) => h.crease(h.through(P12, P41), { flap: [0.4, 0.4] }),
    },
    {
      say: 'Unfold the side flaps again.',
      name: 'Unfold',
      do: (h) => h.together(
        (k) => k.valley(k.through(K1, P12), { flap: [0.34, 0.07] }),
        (k) => k.valley(k.through(K1, P41), { flap: [0.07, 0.34] }),
      ),
    },
    {
      say: 'Petal fold this side too: lift the bottom corner of the top layer up, let the sides fold in to the middle, and press it flat. This is the bird base.',
      name: 'Petal fold',
      do: (h) => h.mech({
        root: [0.55, 0.55], arrow: K1,
        creases: [
          { a: P12, b: P41, fold: 'valley', drive: true },
          { a: K1, b: P12, fold: 'mountain' }, { a: K1, b: P41, fold: 'mountain' },
          { a: M12, b: P12, fold: 'flat' }, { a: M41, b: P41, fold: 'flat' },
          { a: K2, b: P12, fold: 'mountain', mark: false }, { a: K4, b: P41, fold: 'mountain', mark: false },
        ],
      }),
    },
];

export const MODELS = [
  {
    id: 'cup',
    name: 'Paper cup',
    level: 'Easy',
    blurb: 'A cup that holds water for a minute or two. Five folds.',
    paper: { colorUp: false, turn: 45 },
    steps: [
      {
        say: 'Start with the white side up, turned like a diamond. Fold the bottom corner up to the top corner.',
        do: (h) => h.valley(h.onto([1, 0], [0, 1]), { move: [1, 0] }),
      },
      {
        say: 'Fold the left corner over to the right edge, so the top edge of the flap lies level.',
        do: (h) => h.valley(h.lineAt(h.lerp(h.at([1, 1]), h.at([0, 0]), R2 - 1), 112.5), { move: [1, 1] }),
      },
      {
        say: 'Fold the right corner over to the left edge the same way. It lands on top of the first flap.',
        do: (h) => {
          const right = h.at([0, 0]), left = [-right[0], right[1]]; // the left corner has moved; its old place mirrors the right one
          return h.valley(h.lineAt(h.lerp(right, left, R2 - 1), 67.5), { move: [0, 0] });
        },
      },
      {
        say: 'Fold the front layer of the top point down over the flaps.',
        do: (h) => h.valley(h.lineAt([0, h.at([0, 0])[1]], 0), { flap: [1, 0] }),
      },
      {
        say: 'Fold the back layer of the top point down behind. Squeeze the sides and the cup opens.',
        do: (h) => h.mountain(h.lineAt([0, h.at([0, 0])[1]], 0), { flap: [0, 1] }),
      },
    ],
  },
  {
    id: 'plane',
    name: 'Paper airplane',
    level: 'Easy',
    blurb: 'The classic dart, from a sheet of printer paper. It flies straight and far.',
    paper: { colorUp: false, size: [1, Math.SQRT2] },
    steps: [
      {
        say: 'Start with a long sheet, white side up. Fold it in half the long way and unfold.',
        do: (h) => h.crease(h.onto([0, 0], [1, 0]), { move: [0, 0] }),
      },
      {
        say: 'Fold the two top corners in, so the top edges lie along the middle crease.',
        do: (h) => h.together(
          (k) => k.valley(k.through([0.5, Math.SQRT2], [1, Math.SQRT2 - 0.5]), { move: [1, Math.SQRT2] }),
          (k) => k.valley(k.through([0.5, Math.SQRT2], [0, Math.SQRT2 - 0.5]), { move: [0, Math.SQRT2] }),
        ),
      },
      {
        say: 'Fold the new slanted edges in to the middle crease too. The point gets sharper.',
        do: (h) => h.together(
          (k) => k.valley(k.through([0.5, Math.SQRT2], [1, Math.SQRT2 - 1 / Math.tan(Math.PI / 8) / 2]), { move: [1, 0.5] }),
          (k) => k.valley(k.through([0.5, Math.SQRT2], [0, Math.SQRT2 - 1 / Math.tan(Math.PI / 8) / 2]), { move: [0, 0.5] }),
        ),
      },
      {
        say: 'Fold it in half along the middle crease, toward you, so the folds end up inside.',
        do: (h) => h.valley(h.through([0.5, 0], [0.5, Math.SQRT2]), { move: [0, 0.2] }),
      },
      {
        say: 'Turn it so the point faces right and the long fold is at the bottom.',
        do: (h) => h.turn(-90),
      },
      {
        say: 'Fold the front wing down, so its top edge lies along the bottom edge.',
        do: (h) => h.valley(h.lineAt(h.at([0.5, Math.SQRT2]), 168.75), { flap: [0.1, 0.05] }),
      },
      {
        say: 'Fold the back wing down behind the same way.',
        do: (h) => h.mountain(h.lineAt(h.at([0.5, Math.SQRT2]), 168.75), { flap: [0.9, 0.05] }),
      },
      {
        say: 'Open both wings out flat, and hold it by the body underneath. Throw it gently, level or a little up.',
        view: { yaw: -125, pitch: 24 },
        do: (h) => {
          const nose = h.at([0.5, Math.SQRT2]);
          const wing = h.lineAt(nose, 168.75);
          return h.shape(
            [
              (k) => k.bend(wing, 90, { flap: [0.1, 0.05] }),
              (k) => k.bend(wing, 90, { flap: [0.9, 0.05], type: 'mountain' }),
            ],
            { line: { p: nose, d: [1, 0] }, angle: 90 },
          );
        },
      },
    ],
  },
  {
    id: 'heart',
    name: 'Heart',
    level: 'Easy',
    blurb: 'A flat heart with a colored front, for a card or a note. Ten folds.',
    paper: { colorUp: false, turn: 45 },
    steps: [
      {
        say: 'White side up, turned like a diamond. Fold the left corner to the right corner and unfold, to crease the middle.',
        do: (h) => h.crease(h.onto([1, 1], [0, 0]), { move: [1, 1] }),
      },
      {
        say: 'Fold the top corner down to the bottom corner and unfold.',
        do: (h) => h.crease(h.onto([0, 1], [1, 0]), { move: [0, 1] }),
      },
      {
        say: 'Fold the top corner down to the middle, where the creases cross.',
        do: (h) => h.valley(h.onto([0, 1], [0.5, 0.5]), { move: [0, 1] }),
      },
      {
        say: 'Fold the bottom corner up to the top edge.',
        do: (h) => h.valley(h.ontoPoint([1, 0], [0, h.at([0.5, 1])[1]]), { move: [1, 0] }),
      },
      {
        say: 'Fold the right half of the bottom edge up, so it lies along the middle crease.',
        do: (h) => h.valley(h.lineAt(h.at([0.625, 0.375]), 45), { move: [0, 0] }),
      },
      {
        say: 'Do the same on the left.',
        do: (h) => h.valley(h.lineAt(h.at([0.625, 0.375]), 135), { move: [1, 1] }),
      },
      {
        say: 'Fold the tips of both bumps behind, to round off the top.',
        do: (h) => h.mountain(h.level(h.at([0, 0])[1] - 0.09), { move: [0, 0] }),
      },
      {
        say: 'Fold the two side points behind as well. Turn it over to see the back, or keep this side: the heart is done.',
        do: (h) => h.together(
          (k) => k.mountain(h.upright(k.at([0, 0.375])[0] - 0.07), { move: [0, 0.375] }),
          (k) => k.mountain(h.upright(k.at([0.625, 1])[0] + 0.07), { move: [0.625, 1] }),
        ),
      },
    ],
  },
  {
    id: 'fortune-teller',
    name: 'Fortune teller',
    level: 'Easy',
    blurb: 'The cootie catcher from the schoolyard. Two rounds of corners to the middle.',
    paper: { colorUp: false },
    steps: [
      {
        say: 'White side up. Fold in half corner to corner and unfold.',
        do: (h) => h.crease(h.onto([0, 0], [1, 1]), { move: [0, 0] }),
      },
      {
        say: 'Fold in half the other way, corner to corner, and unfold. The creases cross in the middle.',
        do: (h) => h.crease(h.onto([1, 0], [0, 1]), { move: [1, 0] }),
      },
      {
        say: 'Fold all four corners in to the middle.',
        do: (h) => h.together(
          (k) => k.valley(k.onto([0, 0], [0.5, 0.5]), { move: [0, 0] }),
          (k) => k.valley(k.onto([1, 0], [0.5, 0.5]), { move: [1, 0] }),
          (k) => k.valley(k.onto([1, 1], [0.5, 0.5]), { move: [1, 1] }),
          (k) => k.valley(k.onto([0, 1], [0.5, 0.5]), { move: [0, 1] }),
        ),
      },
      {
        say: 'Turn it over.',
        do: (h) => h.turnOver(),
      },
      {
        say: 'Fold the four new corners in to the middle again.',
        do: (h) => h.together(
          (k) => k.valley(k.onto([0.5, 0], [0.5, 0.5]), { move: [0.5, 0] }),
          (k) => k.valley(k.onto([1, 0.5], [0.5, 0.5]), { move: [1, 0.5] }),
          (k) => k.valley(k.onto([0.5, 1], [0.5, 0.5]), { move: [0.5, 1] }),
          (k) => k.valley(k.onto([0, 0.5], [0.5, 0.5]), { move: [0, 0.5] }),
        ),
      },
      {
        say: 'Fold in half, bottom edge to top edge, and unfold.',
        do: (h) => h.crease(h.level(h.sheet().bounds().cy), { move: [0.25, 0.25] }),
      },
      {
        say: 'Fold in half side to side and unfold. Now write colors on the outer flaps and numbers and fortunes inside.',
        do: (h) => h.crease(h.upright(h.sheet().bounds().cx), { move: [0.25, 0.25] }),
      },
      {
        say: 'Turn it over, slide a thumb and finger under each of the four square flaps, and push the points up and together.',
        do: (h) => h.turnOver(),
      },
    ],
  },
  {
    id: 'helmet',
    name: 'Samurai helmet',
    level: 'Medium',
    blurb: 'The kabuto, with two horns and a brim. Big enough to wear if you start with newspaper.',
    paper: { colorUp: false, turn: 45 },
    steps: [
      {
        say: 'White side up, turned like a diamond. Fold the top corner down to the bottom corner.',
        do: (h) => h.valley(h.onto([0, 1], [1, 0]), { move: [0, 1] }),
      },
      {
        say: 'Fold the right corner down to the bottom point.',
        do: (h) => h.valley(h.onto([0, 0], [1, 0]), { move: [0, 0] }),
      },
      {
        say: 'Fold the left corner down to the bottom point too. Now you have a diamond.',
        do: (h) => h.valley(h.onto([1, 1], [1, 0]), { move: [1, 1] }),
      },
      {
        say: 'Fold the bottom point of the right flap up to the top.',
        do: (h) => h.valley(h.onto([0, 0], [0.5, 0.5]), { flap: [0, 0] }),
      },
      {
        say: 'Fold the left flap up to the top the same way.',
        do: (h) => h.valley(h.onto([1, 1], [0.5, 0.5]), { flap: [1, 1] }),
      },
      {
        say: 'Fold the right point out to the side, so it sticks up and out like a horn.',
        do: (h) => h.valley(h.lineAt(h.mid(h.at([0.5, 0.5]), h.at([1, 0])), 67.5), { flap: [0, 0] }),
      },
      {
        say: 'Fold the left point out the same way.',
        do: (h) => h.valley(h.lineAt(h.mid(h.at([0.5, 0.5]), h.at([1, 0])), 112.5), { flap: [1, 1] }),
      },
      {
        say: 'Fold the front layer of the bottom point up, to a little below the top.',
        do: (h) => h.valley(h.ontoPoint([0, 1], [0, -0.1]), { flap: [0, 1] }),
      },
      {
        say: 'Fold that same layer up again, along the bottom edge of the horns. This is the brim.',
        do: (h) => h.valley(h.level(h.at([1, 0.5])[1]), { flap: [0.23, 0.77] }),
      },
      {
        say: 'Fold the back layer of the bottom point up behind. The helmet is done.',
        do: (h) => h.mountain(h.level(h.at([1, 0.5])[1]), { flap: [1, 0] }),
      },
    ],
  },
  {
    id: 'crane',
    name: 'Crane',
    level: 'Tricky',
    blurb: 'The traditional orizuru. The collapse, petal folds and reverse folds are the steps drawings make hardest.',
    paper: { colorUp: true, turn: 45 },
    steps: [
      ...BIRD_BASE,
      {
        say: 'Fold the lower edges of the top layer in to the middle line, making the two bottom points thin.',
        do: (h) => h.together(
          (k) => k.valley(k.through(K2, N12), { flap: [0.667, 0.102] }),
          (k) => k.valley(k.through(K4, N41), { flap: [0.102, 0.667] }),
        ),
      },
      {
        say: 'Turn it over.',
        do: (h) => h.turnOver(),
      },
      {
        say: 'Fold the lower edges in to the middle on this side too.',
        do: (h) => h.together(
          (k) => k.valley(k.through(K2, N23), { flap: [0.898, 0.333] }),
          (k) => k.valley(k.through(K4, N34), { flap: [0.333, 0.898] }),
        ),
      },
      {
        say: 'Inside reverse fold the right point up to make the neck. Swing the top layer on the right over to the left like a page, so the point lies open. Fold it up along its crease as you swing the page back, and it goes up inside, between the layers.',
        name: 'Inside reverse fold',
        do: (h) => h.reverseOpen([
          (k) => k.reverse(k.lineAt(k.sub(k.at(H4), [0, NECK]), -12.5), { flap: [0.15, 0.9], split: k.paperLine(K2, K4) }),
        ], { axis: h.through(C, H4), page: [0.75, 0.95] }),
      },
      {
        say: 'Do the same with the left point for the tail: swing the top layer on the left over to the right, fold the point up, and swing it back.',
        name: 'Inside reverse fold',
        do: (h) => h.reverseOpen([
          (k) => k.reverse(k.lineAt(k.sub(k.at(H2), [0, NECK]), 12.5), { flap: [0.9, 0.15], split: k.paperLine(K2, K4) }),
        ], { axis: h.through(C, H2), page: [0.95, 0.75] }),
      },
      {
        say: 'Reverse fold the tip of the neck down to make the head.',
        do: (h) => h.reverse(h.lineAt(h.lerp(h.sub(h.at(H4), [0, NECK]), h.at(K4), 0.8), 20), { flap: [0.03, 0.98], split: h.paperLine(K2, K4) }),
      },
      {
        say: 'Fold the wings down: the front one toward you and the back one behind.',
        name: 'Valley and mountain',
        do: (h) => h.together(
          (k) => k.valley(k.level(k.at(C)[1]), { flap: [0.98, 0.9] }),
          (k) => k.mountain(k.level(k.at(C)[1]), { flap: [0.1, 0.02] }),
        ),
      },
      {
        say: 'Lift the wings halfway back up, so they stand out from the body. Stand it up, and gently pull the wings apart to puff out the body. Your crane is done.',
        view: { yaw: -120, pitch: 16, size: 0.62, lift: 0.22 },
        do: (h) => h.shape([
          (k) => k.bend(k.level(k.at(C)[1]), 90, { flap: [0.98, 0.9] }),
          (k) => k.bend(k.level(k.at(C)[1]), 90, { flap: [0.1, 0.02], type: 'mountain' }),
        ], { line: { p: [0, h.at(C)[1]], d: [1, 0] }, angle: 90 }),
      },
    ],
  },
  {
    id: 'flapping-bird',
    name: 'Flapping bird',
    level: 'Medium',
    blurb: 'The crane’s cousin. Hold it by the neck, pull the tail, and the wings flap.',
    paper: { colorUp: true, turn: 45 },
    steps: [
      ...BIRD_BASE,
      {
        say: 'Inside reverse fold the right point up and out, so it sticks up at an angle for the neck. Swing the top layer on the right over to the left like a page, fold the point up along its crease, and swing the page back.',
        name: 'Inside reverse fold',
        do: (h) => h.reverseOpen([
          (k) => k.reverse(k.lineAt(k.sub(k.at(H2), [0, 0.02]), -25), { flap: [0.9, 0.15], split: k.paperLine(K2, K4) }),
        ], { axis: h.through(C, H2), page: [0.33, 0.05] }),
      },
      {
        say: 'Do the same with the left point for the tail.',
        name: 'Inside reverse fold',
        do: (h) => h.reverseOpen([
          (k) => k.reverse(k.lineAt(k.sub(k.at(H4), [0, 0.02]), 25), { flap: [0.15, 0.9], split: k.paperLine(K2, K4) }),
        ], { axis: h.through(C, H4), page: [0.05, 0.33] }),
      },
      {
        say: 'Reverse fold the tip of the neck down to make the head.',
        do: (h) => h.reverse(h.lineAt(h.lerp(h.sub(h.at(H2), [0, 0.02]), h.at(K2), 0.82), 5), { flap: [0.98, 0.03], split: h.paperLine(K2, K4) }),
      },
      {
        say: 'Fold the wings down: the front one toward you and the back one behind.',
        name: 'Valley and mountain',
        do: (h) => h.together(
          (k) => k.valley(k.level(k.at(C)[1]), { flap: [0.1, 0.02] }),
          (k) => k.mountain(k.level(k.at(C)[1]), { flap: [0.98, 0.9] }),
        ),
      },
      {
        say: 'Lift the wings back up halfway and stand it up. Now hold the bottom of the neck with one hand and gently pull the tail back and forth with the other: the wings flap.',
        name: 'Flap',
        view: { yaw: -158, pitch: 24, size: 0.64, lift: 0.2 },
        do: (h) => h.shape([
          (k) => k.bend(k.level(k.at(C)[1]), 80, { flap: [0.1, 0.02], schedule: flapping }),
          (k) => k.bend(k.level(k.at(C)[1]), 80, { flap: [0.98, 0.9], type: 'mountain', schedule: flapping }),
        ], { line: { p: [0, h.at(C)[1]], d: [1, 0] }, angle: 90, schedule: (t) => ease(Math.min(1, t / 0.3)) }),
      },
    ],
  },
  {
    id: 'frog',
    name: 'Frog',
    level: 'Tricky',
    blurb: 'The traditional frog with four legs. Squash folds, petal folds and a lot of reverse folds.',
    paper: { colorUp: true, turn: 45 },
    steps: [
      ...SQUARE_BASE,
      {
        say: 'Lift the right flap so it stands straight up, open it, and squash it flat so its folded edge lands on the middle line. This is a squash fold.',
        do: (h) => h.squash({ top: h.at(C), bottom: h.at(K1), corner: h.at(M34), seed: [0.7, 0.85] }),
      },
      {
        say: 'Turn it over.',
        do: (h) => h.turnOver(),
      },
      {
        say: 'Squash fold the right flap on this side the same way.',
        do: (h) => h.squash({ top: h.at(C), bottom: h.at(K1), corner: h.at(M12), seed: [0.3, 0.15] }),
      },
      {
        say: 'Turn the top layer on the right over to the left, like the page of a book.',
        name: 'Turn a page',
        do: (h) => h.valley(h.through(C, K1), { flap: [0.85, 0.1] }),
      },
      {
        say: 'Squash fold the flap that was underneath.',
        do: (h) => h.squash({ top: h.at(C), bottom: h.at(K1), corner: h.at(M23), seed: [0.85, 0.35] }),
      },
      {
        say: 'Turn it over.',
        do: (h) => h.turnOver(),
      },
      {
        say: 'Turn the top layer on the right over to the left again.',
        name: 'Turn a page',
        do: (h) => h.valley(h.through(C, K1), { flap: [0.35, 0.85] }),
      },
      {
        say: 'Squash fold the last flap. Now all four flaps are squashed.',
        do: (h) => h.squash({ top: h.at(C), bottom: h.at(K1), corner: h.at(M41), seed: [0.15, 0.7] }),
      },
      {
        say: 'Turn the top layer on the right over to the left, so a plain face with no squash in it is on top.',
        name: 'Turn a page',
        do: (h) => h.valley(h.through(C, K1), { flap: [0.17, 0.35] }),
      },
      {
        say: 'Petal fold this face, as for the crane: lift its bottom corner up, folding along a line across the face a little above its widest points. As it rises, let the lower edges fold in to meet at the middle line, and press it flat.',
        name: 'Petal fold',
        do: (h) => h.mech(petal(FACE.K1, [0.8, 0.8])),
      },
      {
        say: 'Turn it over.',
        do: (h) => h.turnOver(),
      },
      {
        say: 'Turn the top layer on the right over to the left, so a plain face is on top again.',
        name: 'Turn a page',
        do: (h) => h.valley(h.through(C, K2), { flap: [0.83, 0.74] }),
      },
      {
        say: 'Petal fold this face the same way.',
        name: 'Petal fold',
        do: (h) => h.mech(petal(FACE.K3, [0.2, 0.2])),
      },
      {
        say: 'Turn two layers on the right over to the left together, to find the next plain face.',
        name: 'Turn a page',
        do: (h) => h.together(
          (k) => k.valley(k.through(C, K2), { flap: [0.55, 0.78] }),
          (k) => k.valley(k.through(C, K2), { flap: [0.26, 0.83] }),
        ),
      },
      {
        say: 'Petal fold it.',
        name: 'Petal fold',
        do: (h) => h.mech(petal(FACE.K4, [0.8, 0.2])),
      },
      {
        say: 'Turn it over.',
        do: (h) => h.turnOver(),
      },
      {
        say: 'Turn two layers on the right over to the left, to find the last plain face.',
        name: 'Turn a page',
        do: (h) => h.together(
          (k) => k.valley(k.through(C, K2), { flap: [0.45, 0.22] }),
          (k) => k.valley(k.through(C, K2), { flap: [0.57, 0.17] }),
        ),
      },
      {
        say: 'Petal fold the last face. This is the frog base: four long points at the bottom, four short ones at the top.',
        name: 'Petal fold',
        do: (h) => h.mech(petal(FACE.K2, [0.2, 0.8])),
      },
      {
        say: 'Turn it around so the four long points are at the bottom. They will be the legs.',
        do: (h) => h.turn(180),
      },
      {
        say: 'Turn the top layer on the left over to the right, and the bottom layer behind over from right to left. Now every leg is folded in half on its own side: two on the left and two on the right.',
        name: 'Turn two pages',
        do: (h) => h.together(
          (k) => k.valley(k.through(C, M12), { flap: pageSeed(FACE.K2, 'b') }),
          (k) => k.mountain(k.through(C, M12), { flap: pageSeed(FACE.K4, 'b') }),
        ),
      },
      {
        say: 'Inside reverse fold the front leg on the left up and out, so it sticks out past the body.',
        name: 'Inside reverse fold',
        do: (h) => h.reverseOpen([
          (k) => k.reverse(legLine(k, FACE.K3, 0.28, 35), { flap: onFace(FACE.K3, 0.06, 0.03), split: k.paperLine(K1, K3) }),
        ], { axis: h.through(C, M12), page: pageSeed(FACE.K3, 'a') }),
      },
      {
        say: 'Do the same with the front leg on the right.',
        name: 'Inside reverse fold',
        do: (h) => h.reverseOpen([
          (k) => k.reverse(legLine(k, FACE.K2, 0.28, 35), { flap: onFace(FACE.K2, 0.06, 0.03), split: k.paperLine(K2, K4) }),
        ], { axis: h.through(C, M12), page: pageSeed(FACE.K2, 'b') }),
      },
      {
        say: 'Turn it over.',
        do: (h) => h.turnOver(),
      },
      {
        say: 'Inside reverse fold the back leg on the left out and down.',
        name: 'Inside reverse fold',
        do: (h) => h.reverseOpen([
          (k) => k.reverse(legLine(k, FACE.K1, 0.2, 125), { flap: onFace(FACE.K1, 0.06, 0.03), split: k.paperLine(K1, K3) }),
        ], { axis: h.through(C, M12), page: pageSeed(FACE.K1, 'b') }),
      },
      {
        say: 'And the back leg on the right.',
        name: 'Inside reverse fold',
        do: (h) => h.reverseOpen([
          (k) => k.reverse(legLine(k, FACE.K4, 0.2, 125), { flap: onFace(FACE.K4, 0.06, 0.03), split: k.paperLine(K2, K4) }),
        ], { axis: h.through(C, M12), page: pageSeed(FACE.K4, 'b') }),
      },
      {
        say: 'Turn it over.',
        do: (h) => h.turnOver(),
      },
      {
        say: 'Inside reverse fold the tip of each front leg to make the feet.',
        name: 'Inside reverse folds',
        do: (h) => h.together(
          (k) => k.reverse(footLine(k, FACE.K3, 0.07, 70), { flap: onFace(FACE.K3, 0.02, 0.01), split: k.paperLine(K1, K3) }),
          (k) => k.reverse(footLine(k, FACE.K2, 0.07, 70), { flap: onFace(FACE.K2, 0.02, 0.01), split: k.paperLine(K2, K4) }),
        ),
      },
      {
        say: 'Reverse fold the tips of the back legs too, for the back feet. That’s the frog. With real paper, blow gently into the small hole at its back to puff up its body.',
        name: 'Inside reverse folds',
        do: (h) => h.together(
          (k) => k.reverse(footLine(k, FACE.K1, 0.08, 70), { flap: onFace(FACE.K1, 0.02, 0.01), split: k.paperLine(K1, K3) }),
          (k) => k.reverse(footLine(k, FACE.K4, 0.08, 70), { flap: onFace(FACE.K4, 0.02, 0.01), split: k.paperLine(K2, K4) }),
        ),
      },
    ],
  },
];
