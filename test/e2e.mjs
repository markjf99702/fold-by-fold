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
// A screen reader names each card by its model; the picture on it is left out.
assert.equal(await page.getByRole('button', { name: /^Paper cup\b/ }).count(), 1, 'the paper cup card is not named for its model');

// Picking a paper colour sticks.
await page.click('.swatch[aria-label="Indigo"]');
assert.equal(await page.getAttribute('.swatch[aria-label="Indigo"]', 'aria-checked'), 'true');
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('fold-by-fold.v1')).paper), 'indigo');
// From the keyboard too: the swatch keeps the focus once it's chosen, the pictures change colour, and the
// arrow keys move along the colours the way they do in any set of radio buttons.
const focused = () => page.evaluate(() => document.activeElement.getAttribute('aria-label'));
await page.focus('.swatch[aria-label="Leaf green"]');
await page.keyboard.press('Enter');
assert.equal(await focused(), 'Leaf green', 'choosing a colour from the keyboard lost the focus');
assert.ok(await page.locator('.model .thumb polygon[fill="#3f8a57"]').count() > 0, 'the pictures did not turn leaf green');
await page.keyboard.press('ArrowLeft');
assert.equal(await focused(), 'Indigo');
assert.equal(await page.getAttribute('.swatch[aria-label="Indigo"]', 'aria-checked'), 'true');
assert.equal(await page.locator('.swatch[tabindex="0"]').count(), 1, 'Tab should stop only at the chosen colour');

// The cup opens on its first step.
await page.click('.model:has(h3:text("Paper cup"))');
await page.waitForSelector('#player:not([hidden])');
assert.equal(await page.evaluate(() => location.hash), '#cup');
assert.match(await page.textContent('#stepCount'), /^Step 1 of \d+$/);
assert.ok((await page.textContent('#say')).length > 10, 'no words for the step');
assert.equal(await page.isVisible('#glError'), false, 'no 3D in this browser');
// Nothing reads the picture back, so the browser needn't keep a copy of every frame (costly on phones).
assert.equal(await page.evaluate(() => fold.view().gl.getContextAttributes().preserveDrawingBuffer), false, 'every frame is kept');
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

// The collapses, petal and squash folds, reverse folds and tucks draw at every moment too.
for (const id of ['crane', 'flapping-bird', 'frog', 'jumping-frog', 'waterbomb']) {
  await page.evaluate((id) => { location.hash = id; }, id);
  await page.waitForFunction((id) => fold.state.id === id, id);
  const n = (await state()).steps;
  for (let i = 0; i < n; i++) for (const t of [0, 0.3, 0.7, 1]) await page.evaluate(([i, t]) => fold.set(i, t), [i, t]);
}

// A link can go straight to a step, and the gallery remembers where you got to.
await page.evaluate(() => { location.hash = 'helmet-3'; });
await page.waitForFunction(() => fold.state.id === 'helmet');
assert.equal((await state()).i, 2);
await page.click('#back');
await page.waitForSelector('#home:not([hidden])');
await page.click('.model:has(h3:text("Samurai helmet"))');
await page.waitForFunction(() => fold.state.id === 'helmet');
assert.equal((await state()).i, 2, 'did not pick up where you left off');

// On a short desktop window the words, slider and buttons keep their own space, and the list of steps
// scrolls under them.
await page.setViewportSize({ width: 1000, height: 560 });
await page.waitForTimeout(100);
const boxes = await page.evaluate(() => ['#chip', '#say', '.scrub', '.controls', '#stepList'].map((q) => {
  const r = document.querySelector(q).getBoundingClientRect();
  return { q, top: r.top, bottom: r.bottom };
}));
for (let k = 1; k < boxes.length; k++) {
  assert.ok(boxes[k].top >= boxes[k - 1].bottom - 0.5, `${boxes[k].q} overlaps ${boxes[k - 1].q} on a desktop`);
}
assert.equal(await sideways(), false, 'the player scrolls sideways on a desktop');

// On narrow phones every button fits, even with the longest label on the main one.
await page.evaluate((n) => fold.set(n - 1, 1), (await state()).steps);
assert.equal(await page.textContent('#playLabel'), 'Start again');
// Its icon, an open arrow going round, is drawn as a line rather than filled in.
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#playIcon path')).fill), 'none', 'the Start again icon is filled in');
for (const [width, height] of [[360, 780], [320, 568]]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(100);
  assert.equal(await sideways(), false, `the player scrolls sideways at ${width} px`);
  const cut = await page.evaluate(() => ['#back', '#topView', '#resetView', '#prev', '#play', '#next', '#speed'].filter((q) => {
    const r = document.querySelector(q).getBoundingClientRect();
    return r.left < 0 || r.right > innerWidth;
  }));
  assert.deepEqual(cut, [], `buttons cut off at ${width} px`);
  const [label, button] = await page.evaluate(() => ['#playLabel', '#play'].map((q) => document.querySelector(q).getBoundingClientRect().toJSON()));
  assert.ok(label.left >= button.left + 4 && label.right <= button.right - 4, `the label spills out of its button at ${width} px`);
}
await page.evaluate(() => fold.set(2, 0));
await page.setViewportSize({ width: 390, height: 844 });

// The offline copy lists every file the page needs.
const sw = await readFile(join(root, 'sw.js'), 'utf8');
for (const dir of ['js', 'css', 'fonts']) {
  for (const f of await readdir(join(root, dir))) assert.ok(sw.includes(`'${dir}/${f}'`), `sw.js doesn't list ${dir}/${f}`);
}

// Other tools on junkdrawer.works share this address and its caches, so the offline copy clears out only
// its own old caches, never theirs.
{
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(base + 'css/app.css'); // the same address, before the page sets up its offline copy
  await p.evaluate(() => Promise.all([caches.open('another-tool-v1'), caches.open('fold-by-fold-v0')]));
  await p.goto(base);
  await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 });
  const kept = await p.evaluate(async () => [await caches.has('another-tool-v1'), await caches.has('fold-by-fold-v0')]);
  assert.deepEqual(kept, [true, false], 'the offline copy cleared out the wrong caches');
  await c.close();
}

// Works offline once it has been opened.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('#player:not([hidden])');
assert.equal((await state()).id, 'helmet', 'the page did not load offline');
await ctx.setOffline(false);

// A page of its own, for the checks below that need a fresh start: nothing saved and no history.
async function fresh(hash = '', { init, arg, ...opts } = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block', ...opts });
  if (init) await c.addInitScript(init, arg);
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await p.goto(base + hash);
  return p;
}

// A link to a step opens that step once. After that a reload picks up where you got to, not the link's step.
{
  const p = await fresh('#crane-3');
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.equal(await p.evaluate(() => fold.state.i), 2);
  for (let k = 0; k < 4; k++) await p.click('#next');
  assert.equal(await p.evaluate(() => fold.state.i), 6);
  await p.reload();
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.equal(await p.evaluate(() => fold.state.i), 6, 'a reload went back to the step in the link');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('fold-by-fold.v1')).progress.crane), 6);
  await p.context().close();
}

// The back arrow returns to the gallery the way the browser's Back would, so Back from the gallery leaves
// instead of reopening the model. Opened straight from a link, it goes to the gallery without adding a page.
{
  const p = await fresh();
  const before = await p.evaluate(() => history.length);
  await p.click('.model:has(h3:text("Paper cup"))');
  await p.waitForSelector('#player:not([hidden])');
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  assert.equal(await p.evaluate(() => history.length), before + 1, 'the back arrow added a page to the history');
  await p.goBack();
  await p.waitForTimeout(300);
  assert.equal(await p.isVisible('#player'), false, 'Back from the gallery reopened the model');
  await p.goto(base + '#heart');
  await p.waitForSelector('#player:not([hidden])');
  const opened = await p.evaluate(() => history.length);
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  assert.equal(await p.evaluate(() => history.length), opened, 'the back arrow added a page to the history');
  assert.equal(await p.evaluate(() => location.hash), '');
  await p.context().close();
}

// In a frame on another page, the way a viewer can show the single-file copy, the address isn't the page's own to
// rewrite. The cards and the back arrow still work there, from the gallery and from a link.
{
  const p = await fresh();
  const html = (await readFile(join(root, 'index.html'), 'utf8')).replace('<html lang="en">', '<html lang="en" data-single>');
  await p.evaluate((html) => new Promise((done) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position: fixed; inset: 0; width: 100%; height: 100%; border: 0';
    f.onload = done;
    f.srcdoc = html;
    document.body.append(f);
  }), html);
  const frame = p.frames()[1];
  await frame.waitForSelector('#home:not([hidden])');
  await frame.click('.model:has(h3:text("Paper cup"))');
  await frame.waitForSelector('#player:not([hidden])', { timeout: 5000 }).catch(() => assert.fail('a card did nothing in a frame'));
  await frame.click('#back');
  await frame.waitForSelector('#home:not([hidden])', { timeout: 5000 }).catch(() => assert.fail('the back arrow did nothing in a frame'));
  await frame.evaluate(() => { location.hash = 'heart-2'; });
  await frame.waitForSelector('#player:not([hidden])');
  await frame.click('#back');
  await frame.waitForSelector('#home:not([hidden])', { timeout: 5000 }).catch(() => assert.fail('the back arrow did nothing in a frame, from a link'));
  await p.context().close();
}

// Where the browser can't draw 3D, it says so, puts away what only works in 3D, and the words, slider and
// buttons still walk through the steps: Play runs the fold's time through to the end.
{
  const p = await fresh('#crane-10', { init: () => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/.test(type) ? null : get.call(this, type, ...rest); };
  } });
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.equal(await p.isVisible('#glError'), true, 'no word that 3D is missing');
  for (const q of ['#hint', '#topView', '#resetView']) assert.equal(await p.isVisible(q), false, `${q} is still up without 3D`);
  await p.click('#play');
  await p.waitForFunction(() => fold.state.t >= 1, null, { timeout: 10000 });
  assert.equal(await p.textContent('#playLabel'), 'Next fold');
  await p.context().close();
}

// When the graphics card resets, or a phone takes the 3D back from a tab in the background, the paper comes
// back as soon as the browser gives the 3D back.
{
  const p = await fresh('#heart-4');
  await p.waitForFunction(() => fold.state.id === 'heart');
  const paper = async () => {
    await p.waitForTimeout(300);
    const img = UPNG.decode(await p.locator('#gl').screenshot());
    const px = new Uint8Array(UPNG.toRGBA8(img)[0]);
    let n = 0;
    for (let k = 0; k < px.length; k += 4) if ((px[k] > 190 && px[k + 1] > 185 && px[k + 2] > 170) || (px[k] > 150 && px[k + 1] < 110 && px[k + 2] < 100)) n++;
    return n;
  };
  const before = await paper();
  assert.ok(before > 1000, 'no paper on screen');
  const restored = await p.evaluate(() => new Promise((done) => {
    const canvas = document.getElementById('gl');
    const lose = canvas.getContext('webgl').getExtension('WEBGL_lose_context');
    canvas.addEventListener('webglcontextlost', () => setTimeout(() => lose.restoreContext(), 50), { once: true });
    canvas.addEventListener('webglcontextrestored', () => done(true), { once: true });
    setTimeout(() => done(false), 4000);
    lose.loseContext();
  }));
  assert.equal(restored, true, 'the 3D never came back');
  const after = await paper();
  assert.ok(Math.abs(after - before) < before * 0.05, `the paper didn't come back (${after} paper pixels, ${before} before)`);
  await p.context().close();
}

// A damaged or hand-edited save can't break the player: whatever makes no sense is left out.
for (const junk of ['{"progress":null}', '{"progress":"x"}', '{"progress":{"crane":4.5},"paper":"plaid","slow":"yes"}']) {
  const p = await fresh('#crane', { init: (v) => localStorage.setItem('fold-by-fold.v1', v), arg: junk });
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.match(await p.textContent('#stepCount'), /^Step 1 of \d+$/, `the crane didn't open with ${junk} saved`);
  assert.ok((await p.textContent('#say')).length > 10, `no words for the step with ${junk} saved`);
  const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('fold-by-fold.v1')));
  assert.deepEqual([kept.paper, kept.slow, kept.progress.crane], ['vermilion', false, 0], `${junk} was kept as it was`);
  await p.context().close();
}

// A link mangled on the way (a stray %, an emoji cut in half) opens the gallery rather than a blank page.
for (const hash of ['#%', '#crane-3%', '#%F0%9F']) {
  const p = await fresh(hash);
  await p.waitForSelector('#home:not([hidden])', { timeout: 5000 });
  assert.ok(await p.locator('.model').count() >= 5, `no gallery for ${hash}`);
  await p.context().close();
}

// The arrow keys step through the folds, also once a button has been pressed; → on the last step leaves it
// be, and the slider keeps the arrow keys for itself.
{
  const p = await fresh('#cup-5');
  await p.waitForFunction(() => fold.state.id === 'cup');
  await p.keyboard.press('ArrowRight');
  assert.deepEqual(await p.evaluate(() => [fold.state.i, fold.state.playing]), [4, false], '→ on the last step played it again');
  await p.click('#play');
  await p.keyboard.press('ArrowLeft');
  assert.equal(await p.evaluate(() => fold.state.i), 3, '← did nothing once a button had been pressed');
  await p.keyboard.press('ArrowRight');
  assert.deepEqual(await p.evaluate(() => [fold.state.i, fold.state.playing]), [4, true], '→ did not play the next fold');
  await p.focus('#scrub');
  await p.keyboard.press('ArrowLeft');
  assert.equal(await p.evaluate(() => fold.state.i), 4, 'the slider\'s arrow keys changed the step');
  await p.context().close();
}

// On a wide screen the cards in a row line up: names and step counts at the same height across the row.
{
  const p = await fresh('', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForSelector('#home:not([hidden])');
  const rows = await p.evaluate(() => {
    const out = {};
    for (const card of document.querySelectorAll('.model')) {
      const top = Math.round(card.getBoundingClientRect().top);
      const at = (q) => Math.round(card.querySelector(q).getBoundingClientRect().top) - top;
      (out[top] ||= []).push([at('h3'), at('.meta')]);
    }
    return Object.values(out);
  });
  assert.ok(rows.length >= 2 && rows[0].length >= 3, `the cards aren't in rows: ${JSON.stringify(rows)}`);
  for (const row of rows) assert.ok(row.every(([h, m]) => h === row[0][0] && m === row[0][1]), `the cards in a row don't line up: ${JSON.stringify(row)}`);
  await p.context().close();
}

// Back from a model, the gallery is where you left it. The page puts it back itself (Chrome would often do it
// anyway, but that depends on timing and not every browser does), so the browser's own way is turned off here.
{
  const p = await fresh();
  await p.evaluate(() => { history.scrollRestoration = 'manual'; });
  const frog = '.model:has(h3:text-is("Frog"))';
  await p.locator(frog).scrollIntoViewIfNeeded();
  const y = await p.evaluate(() => scrollY);
  assert.ok(y > 300, `the gallery didn't scroll down (${y})`);
  await p.click(frog);
  await p.waitForSelector('#player:not([hidden])');
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  await p.waitForTimeout(100);
  const back = await p.evaluate(() => scrollY);
  assert.ok(Math.abs(back - y) < 2, `the gallery came back scrolled to ${back}, not ${y}`);
  await p.context().close();
}

// On a phone turned sideways, nothing sits under the notch or the rounded corners at the sides.
{
  const p = await fresh();
  await (await p.context().newCDPSession(p)).send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 47, bottom: 21, right: 47 } });
  await p.setViewportSize({ width: 844, height: 390 });
  await p.reload();
  await p.waitForSelector('#home:not([hidden])');
  const under = (qs) => p.evaluate((qs) => qs.filter((q) => {
    const r = document.querySelector(q).getBoundingClientRect();
    return r.left < 47 || r.right > innerWidth - 47;
  }), qs);
  assert.deepEqual(await under(['.mast', '.paper-pick', '.models', '.symbols', '.jd-foot']), [], 'the gallery runs under the sides of the screen');
  await p.click('.model:has(h3:text("Paper cup"))');
  await p.waitForSelector('#player:not([hidden])');
  assert.deepEqual(await under(['#back', '#resetView', '#ticks', '.step-now', '.scrub', '#prev', '#speed']), [], 'the player runs under the sides of the screen');
  // Wide enough for the words beside the paper (a big phone), the panel makes room for the notch too.
  await p.setViewportSize({ width: 932, height: 430 });
  await p.waitForTimeout(100);
  assert.deepEqual(await under(['#back', '#resetView', '.step-now', '#speed']), [], 'the player runs under the sides of a big phone');
  await p.context().close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();
console.log('all good');
