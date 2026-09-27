// The models. Each step has what to say and what to do, in the helpers from build.js.
// Paper points are [u, v] on the unit square; `move` names a paper point on the part that moves;
// `flap` folds only the layer holding that point and whatever is joined to it.

const R2 = Math.SQRT2;

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
];
