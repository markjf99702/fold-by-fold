// A flat picture of a folded state, seen from above: each facet in its stacking order, front side in the
// paper's color and back side white. Used for the model cards.
//
// It comes in two parts so the gallery needn't fold every model to show them: outline() works out the shapes,
// which tools/make-thumbs.mjs does ahead of time for the finished models (js/finished.js), and picture() draws
// them in whichever paper is chosen.

import { det } from './geom.js';

// The shapes, from the table up: for each facet, 1 if the front of the paper faces up (0 for the white back),
// and its corners in a 100 x 100 box.
export function outline(sheet, pad = 0.06) {
  const b = sheet.bounds();
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0) * (1 + pad * 2);
  const x0 = b.cx - size / 2, y1 = b.cy + size / 2;
  const S = 100 / size;
  const pt = ([x, y]) => `${((x - x0) * S).toFixed(2)},${((y1 - y) * S).toFixed(2)}`;
  return sheet.order.map((id) => [det(sheet.facets.get(id).m) > 0 ? 1 : 0, sheet.world(id).map(pt).join(' ')]);
}

export function picture(shapes, { front = '#d9412b', back = '#f3eee3', edge = 'rgba(40,30,20,.45)', label = '' } = {}) {
  const polys = shapes.map(([up, points]) =>
    `<polygon points="${points}" fill="${up ? front : back}" stroke="${edge}" stroke-width=".45" stroke-linejoin="round"/>`);
  // Without a label the picture is decoration, and screen readers skip it.
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg viewBox="0 0 100 100" ${a11y}>${polys.join('')}</svg>`;
}
