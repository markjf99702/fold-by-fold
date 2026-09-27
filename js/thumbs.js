// A flat picture of a folded state, seen from above: each facet in its stacking order, front side in the
// paper's color and back side white. Used for the model cards and the step list.

import { det } from './geom.js';

export function stateSVG(sheet, { front = '#d9412b', back = '#f3eee3', edge = 'rgba(40,30,20,.45)', pad = 0.06, label = '' } = {}) {
  const b = sheet.bounds();
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0) * (1 + pad * 2);
  const x0 = b.cx - size / 2, y1 = b.cy + size / 2;
  const S = 100 / size;
  const pt = ([x, y]) => `${((x - x0) * S).toFixed(2)},${((y1 - y) * S).toFixed(2)}`;
  const polys = sheet.order.map((id) => {
    const f = sheet.facets.get(id);
    const fill = det(f.m) > 0 ? front : back;
    return `<polygon points="${sheet.world(id).map(pt).join(' ')}" fill="${fill}" stroke="${edge}" stroke-width=".45" stroke-linejoin="round"/>`;
  });
  return `<svg viewBox="0 0 100 100" role="img" aria-label="${label}">${polys.join('')}</svg>`;
}
