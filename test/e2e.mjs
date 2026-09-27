// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

// Software WebGL, so this runs on machines without a graphics card too.
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
const state = () => page.evaluate(() => fold.state);
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

// The gallery comes up first, with a picture of each finished model.
assert.equal(await page.isVisible('#home'), true, 'no gallery');
const cards = await page.locator('.model').count();
assert.ok(cards >= 5, `only ${cards} models`);
assert.equal(await page.locator('.model .thumb svg polygon').count() > cards, true, 'the model pictures are empty');
assert.equal(await sideways(), false, 'the gallery scrolls sideways on a phone');

// Picking a paper colour sticks.
await page.click('.swatch[aria-label="Indigo"]');
assert.equal(await page.getAttribute('.swatch[aria-label="Indigo"]', 'aria-checked'), 'true');
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fold-by-fold.v1')).paper), 'indigo');

// The cup opens on its first step.
await page.click('.model:has(h3:text("Paper cup"))');
await page.waitForSelector('#player:not([hidden])');
assert.equal(await page.evaluate(() => location.hash), '#cup');
assert.match(await page.textContent('#stepCount'), /^Step 1 of \d+$/);
assert.ok((await page.textContent('#say')).length > 10, 'no words for the step');
assert.equal(await page.isVisible('#glError'), false, 'no 3D in this browser');
assert.equal(await sideways(), false, 'the player scrolls sideways on a phone');

// The paper is on the table, white side up, and the finished cup shows its indigo side.
const pixels = async (test) => {
  await page.waitForTimeout(200);
  const img = UPNG.decode(await page.locator('#gl').screenshot());
  const px = new Uint8Array(UPNG.toRGBA8(img)[0]);
  let n = 0;
  for (let k = 0; k < px.length; k += 4) if (test(px[k], px[k + 1], px[k + 2])) n++;
  return n / (img.width * img.height);
};
const white = await pixels((r, g, b) => r > 190 && g > 185 && b > 170);
assert.ok(white > 0.05, `hardly any paper on screen (${(white * 100).toFixed(1)}%)`);
const steps = (await state()).steps;
await page.evaluate((n) => fold.set(n - 1, 1), steps);
const indigo = await pixels((r, g, b) => b > r + 40 && b > g + 20);
assert.ok(indigo > 0.02, `hardly any indigo paper on screen (${(indigo * 100).toFixed(1)}%)`);
await page.evaluate(() => fold.set(0, 0));

// Play folds step 1, then offers the next fold, which plays step 2.
await page.click('#play');
assert.equal(await page.textContent('#playLabel'), 'Pause');
await page.waitForFunction(() => fold.state.t >= 1, null, { timeout: 10000 });
assert.equal(await page.textContent('#playLabel'), 'Next fold');
await page.click('#play');
assert.equal((await state()).i, 1, 'next fold did not move on');
assert.match(await page.textContent('#stepCount'), /^Step 2 of/);

// Dragging the slider stops the fold wherever it's left.
await page.locator('#scrub').evaluate((el) => { el.value = 500; el.dispatchEvent(new Event('input', { bubbles: true })); });
let s = await state();
assert.equal(s.playing, false);
assert.equal(s.t, 0.5);
assert.equal(await page.textContent('#playLabel'), 'Carry on');

// Back to the start of the step, then back a step, then forward again.
await page.click('#prev');
assert.equal((await state()).t, 0);
await page.click('#prev');
assert.equal((await state()).i, 0);
await page.click('#next');
assert.equal((await state()).i, 1);

// Slow is a switch.
await page.click('#speed');
assert.equal(await page.getAttribute('#speed', 'aria-pressed'), 'true');

// Every step can be shown at any moment without an error.
for (let i = 0; i < steps; i++) for (const t of [0, 0.5, 1]) await page.evaluate(([i, t]) => fold.set(i, t), [i, t]);

// A link can go straight to a step, and the gallery remembers where you got to.
await page.evaluate(() => { location.hash = 'helmet-3'; });
await page.waitForFunction(() => fold.state.id === 'helmet');
assert.equal((await state()).i, 2);
await page.click('#back');
await page.waitForSelector('#home:not([hidden])');
await page.click('.model:has(h3:text("Samurai helmet"))');
await page.waitForFunction(() => fold.state.id === 'helmet');
assert.equal((await state()).i, 2, 'did not pick up where you left off');

// The offline copy lists every file the page needs.
const sw = await readFile(join(root, 'sw.js'), 'utf8');
for (const dir of ['js', 'css', 'fonts']) {
  for (const f of await readdir(join(root, dir))) assert.ok(sw.includes(`'${dir}/${f}'`), `sw.js doesn't list ${dir}/${f}`);
}

// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('#player:not([hidden])');
assert.equal((await state()).id, 'helmet', 'the page did not load offline');
await ctx.setOffline(false);

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
