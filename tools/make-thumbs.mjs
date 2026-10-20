// Works out the pictures of the finished models for the gallery's cards and writes them to js/finished.js:
//   node tools/make-thumbs.mjs
// Run it after adding or changing a model; npm test fails while a picture no longer matches its model.
import { writeFile } from 'node:fs/promises';
import { MODELS } from '../js/models.js';
import { build } from '../js/build.js';
import { outline } from '../js/thumbs.js';

const rows = MODELS.map((m) => `  ${JSON.stringify(m.id)}: ${JSON.stringify(outline(build(m).end))},`);
await writeFile(new URL('../js/finished.js', import.meta.url), `// The pictures of the finished models on the gallery's cards, worked out ahead of time so the gallery
// needn't fold all the models before it can show them. Made by tools/make-thumbs.mjs from js/models.js, and
// npm test checks they still match. For each model, its facets from the table up: 1 if the front of the paper
// faces up (0 for the white back), then the facet's corners in a 100 x 100 box. js/thumbs.js draws them.

export const FINISHED = {
${rows.join('\n')}
};
`);
console.log(`js/finished.js written: ${MODELS.length} models`);
