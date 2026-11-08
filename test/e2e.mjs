// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// The server answers the way GitHub Pages does: a browser may keep each file for ten minutes, and asks again by its
// ETag. `net` is the connection: 'up', 'down' (the server drops every connection) or 'stalled' (a train, a captive
// wifi: it takes each request and holds on to it). With `release` set it serves the next release (see the offline
// checks).
let net = 'up', release = false;
const held = [];
const server = createServer((req, res) => {
  if (net === 'down') { req.socket.destroy(); return; }
  if (net === 'stalled') { held.push([req, res]); return; }
  serve(req, res);
}).listen(0);
async function serve(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  let body;
  try { body = await readFile(join(root, path)); } catch { res.writeHead(404); res.end(); return; }
  if (release && path === '/sw.js') body = Buffer.from(String(body).replace(/const FILES = '[0-9a-f]*'/, "const FILES = 'next'"));
  if (release && path === '/index.html') body = Buffer.concat([body, Buffer.from('<!-- the next release -->\n')]);
  const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  const head = { etag, 'cache-control': 'max-age=600', 'content-type': TYPES[extname(path)] || 'text/html' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
  res.writeHead(200, head);
  res.end(body);
}
const base = `http://localhost:${server.address().port}/`;
// Waits for ok() to come true, for up to ms, or fails saying what didn't happen.
const until = async (ok, ms, what) => {
  for (const end = Date.now() + ms; !(await ok());) { assert.ok(Date.now() < end, what); await new Promise((r) => setTimeout(r, 100)); }
};

// Software WebGL, so this runs on machines without a graphics card too.
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });
// A file that's missing or renamed answers with an error rather than failing outright (a font would quietly fall back).
const answered = (r) => { if (r.status() >= 400) problems.push(`${r.status()}: ${r.url()}`); };
page.on('response', answered);

await page.goto(base);
await page.evaluate(() => document.fonts.ready);
const state = () => page.evaluate(() => fold.state);
const sideways = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);

// The gallery comes up first, with a picture of each finished model.
assert.equal(await page.isVisible('#home'), true, 'no gallery');
const cards = await page.locator('.model').count();
assert.ok(cards >= 5, `only ${cards} models`);
assert.equal(await page.locator('.model .thumb svg polygon').count() > cards, true, 'the model pictures are empty');
// The pictures were worked out ahead of time, so the gallery shows them without folding a single model.
assert.deepEqual(await page.evaluate(() => fold.built), [], 'the gallery folded models to show their pictures');
assert.equal(await sideways(), false, 'the gallery scrolls sideways on a phone');
// A screen reader names each card by its model; the picture on it is left out.
assert.equal(await page.getByRole('button', { name: /^Paper cup\b/ }).count(), 1, 'the paper cup card is not named for its model');

// The link under the opening words goes down to the key of marks, staying on the gallery.
await page.click('#toKey');
await page.waitForFunction(() => Math.abs(document.getElementById('symbolsTitle').getBoundingClientRect().top) < 40, null, { timeout: 3000 }).catch(() => {});
assert.ok(Math.abs(await page.evaluate(() => document.getElementById('symbolsTitle').getBoundingClientRect().top)) < 40, 'the link did not go down to the key');
assert.deepEqual(await page.evaluate(() => [location.hash, document.activeElement.id, document.getElementById('home').hidden]), ['', 'symbolsTitle', false]);
await page.evaluate(() => scrollTo(0, 0));

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
// A swatch tapped with a finger doesn't stay tilted, the way it leans under a mouse.
await page.tap('.swatch[aria-label="Violet"]');
await page.waitForTimeout(300);
assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.swatch[aria-label="Violet"]')).transform), 'matrix(1, 0, 0, 1, 0, 0)', 'a tapped swatch stays tilted');
await page.click('.swatch[aria-label="Indigo"]');

// The cup opens on its first step.
await page.click('.model:has(.title:text("Paper cup"))');
await page.waitForSelector('#player:not([hidden])');
assert.equal(await page.evaluate(() => location.hash), '#cup');
assert.match(await page.textContent('#stepCount'), /^Step 1 of \d+$/);
assert.ok((await page.textContent('#say')).length > 10, 'no words for the step');
assert.equal(await page.isVisible('#glError'), false, 'no 3D in this browser');
// The hint says how to zoom with what you have: pinch on a phone, scroll with a mouse (further down).
assert.equal(await page.innerText('#hint'), 'Drag to turn the paper · pinch to zoom');
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
// The shadow and the paper's edges are drawn on the mat, not through to the page: with the page magenta, none
// of it shows anywhere but where the mat's far side fades out, at the top.
{
  const tag = await page.addStyleTag({ content: 'body, .player, .stage { background: #f0f !important; }' });
  await page.waitForTimeout(200);
  const img = UPNG.decode(await page.locator('#gl').screenshot());
  const px = new Uint8Array(UPNG.toRGBA8(img)[0]);
  let leaks = 0;
  for (let y = Math.round(img.height * 0.3); y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const k = (y * img.width + x) * 4;
      if (px[k] > px[k + 1] + 60 && px[k + 2] > px[k + 1] + 60) leaks++;
    }
  }
  assert.equal(leaks, 0, `the page shows through the mat in ${leaks} pixels`);
  await tag.evaluate((el) => el.remove());
}
await page.evaluate(() => fold.set(0, 0));

// Play folds step 1, then offers the next fold, which plays step 2.
await page.click('#play');
assert.equal(await page.textContent('#playLabel'), 'Pause');
// Once the paper moves, the back button takes the fold back to its start, even on step 1.
await page.waitForFunction(() => fold.state.t > 0.3, null, { timeout: 10000 });
assert.deepEqual(await page.evaluate(() => { const b = document.getElementById('prev'); return [b.getAttribute('aria-disabled'), b.getAttribute('aria-label')]; }), ['false', 'Replay this fold'], 'the back button is off while step 1 plays');
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
await page.click('.model:has(.title:text("Samurai helmet"))');
await page.waitForFunction(() => fold.state.id === 'helmet');
assert.equal((await state()).i, 2, 'did not pick up where you left off');
assert.equal(await page.getAttribute('#ticks li:nth-child(3) button', 'aria-current'), 'step', 'the step is not marked on the bar after reopening the model');

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
for (const [width, height] of [[360, 780], [320, 568], [280, 653]]) {
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
for (const f of ['index.html', 'icon.svg', 'manifest.webmanifest', 'icon-192.png']) assert.ok(sw.includes(`'${f}'`), `sw.js doesn't list ${f}`);

// Other tools on junkdrawer.works share this address and its caches, so the offline copy clears out only
// its own old caches, never theirs, even one whose name starts the same way.
{
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(base + 'css/app.css'); // the same address, before the page sets up its offline copy
  const names = ['another-tool-v1', 'fold-by-fold-x-v1', 'fold-by-fold-v0'];
  await p.evaluate((names) => Promise.all(names.map((k) => caches.open(k))), names);
  await p.goto(base);
  await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 });
  const kept = await p.evaluate((names) => Promise.all(names.map((k) => caches.has(k))), names);
  assert.deepEqual(kept, [true, true, false], 'the offline copy cleared out the wrong caches');
  await c.close();
}

// It can be installed: the browser finds nothing in the way, it reads the manifest without an error and finds the
// name in it, and every icon the manifest names is there.
{
  const cdp = await ctx.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installabilityErrors, [], 'the browser would not install it');
  const { url, errors, manifest } = await cdp.send('Page.getAppManifest');
  assert.ok(url.endsWith('/manifest.webmanifest'), 'the page names no manifest');
  assert.deepEqual([errors, manifest?.name], [[], 'Fold by Fold'], 'the manifest has errors, or no name');
  assert.ok(manifest.icons.length >= 3, 'the manifest names too few icons');
  for (const icon of manifest.icons) assert.equal((await page.request.get(icon.url)).status(), 200, `${icon.url} is missing`);
  await cdp.detach();
}

// Works offline once it has been opened: after one visit to the gallery, a model never opened before opens and folds
// with no connection. The server goes down as well as the browser: in some Chromium builds the browser's offline switch
// alone doesn't stop the service worker's own requests, and this passed with no copy at all.
{
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  await p.goto(base);
  await p.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 20000 });
  await p.close();
  net = 'down';
  await c.setOffline(true);
  const off = await c.newPage();
  off.on('pageerror', e => problems.push(e.message));
  await off.goto(base + '#frog').catch(() => {});
  await off.waitForFunction(() => window.fold?.state.id === 'frog', null, { timeout: 10000 }).catch(() => assert.fail('the frog did not open offline'));
  await off.click('#play');
  await off.waitForFunction(() => fold.state.t >= 1, null, { timeout: 15000 }).catch(() => assert.fail('the frog\'s first fold did not play offline'));
  await off.close();
  await c.setOffline(false);

  // On a connection that's up but not answering, a new tab opens from the copy too, after the worker's few seconds'
  // wait for the network: the page and every file it loads (were any of them left waiting on the network, it wouldn't
  // open).
  net = 'stalled';
  const slow = await c.newPage();
  slow.on('pageerror', e => problems.push(e.message));
  const t0 = Date.now();
  slow.goto(base + '#crane', { timeout: 0 }).catch(() => {});
  await slow.waitForFunction(() => window.fold?.state.id === 'crane', null, { timeout: 8000, polling: 100 }).catch(() => {});
  const took = Date.now() - t0;
  assert.ok(took < 8000, `the crane took ${took} ms to open on a stalled connection`);
  net = 'up';
  for (const [req, res] of held.splice(0)) serve(req, res);

  // A new release: every file in the new copy comes from the server, though the browser still has its own copies of
  // the old ones for ten minutes. (The next release changes index.html, and so FILES in sw.js, as a real one does.)
  release = true;
  await slow.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await until(() => slow.evaluate(async () => !!(await (await caches.match('index.html'))?.text())?.includes('<!-- the next release -->')),
    10000, "the new release's offline copy kept the old index.html");
  release = false;
  await c.close();
}

// A page of its own, for the checks below that need a fresh start: nothing saved and no history.
async function fresh(hash = '', { init, arg, ...opts } = {}) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block', ...opts });
  if (init) await c.addInitScript(init, arg);
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  p.on('response', answered);
  await p.goto(base + hash);
  return p;
}

// A link to a step opens that step, and the address follows the steps from there, so a reload opens the step you're
// on, not the link's step.
{
  const p = await fresh('#crane-3');
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.equal(await p.evaluate(() => fold.state.i), 2);
  for (let k = 0; k < 4; k++) await p.click('#next');
  assert.equal(await p.evaluate(() => fold.state.i), 6);
  await p.waitForFunction(() => location.hash === '#crane-7', null, { timeout: 3000 }).catch(() => assert.fail('the address did not follow the steps'));
  await p.reload();
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.equal(await p.evaluate(() => fold.state.i), 6, 'a reload went back to the step in the link');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('fold-by-fold.v1')).progress.crane), 6);
  const craneSteps = await p.evaluate(() => fold.state.steps);
  // Back to the gallery from there, the cards show their pictures without folding the other models.
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  // The crane's card says where you got to, still named for its model first; the others still say how long they are.
  assert.equal(await p.textContent('.model[data-model="crane"] .count'), `Step 7 of ${craneSteps}`, 'the crane\'s card doesn\'t say where you got to');
  assert.equal(await p.getByRole('button', { name: /^Crane\b/ }).count(), 1, 'the crane card is no longer named for its model');
  assert.match(await p.textContent('.model[data-model="cup"] .count'), /^\d+ steps$/, 'a model not begun says where you got to');
  assert.ok(await p.locator('.model .thumb svg polygon').count() > 10, 'the model pictures are empty');
  assert.deepEqual(await p.evaluate(() => fold.built), ['crane'], 'going back to the gallery folded the other models');
  await p.context().close();
}

// A link to a step in a model you've started shows that step without losing your place: that waits until you
// fold on from there yourself. A reload stays on the link's step, which the address names, and the place stays too.
{
  const p = await fresh('#crane-10', { init: () => { if (!sessionStorage.seeded) { sessionStorage.seeded = 1; localStorage.setItem('fold-by-fold.v1', '{"progress":{"crane":17}}'); } } });
  await p.waitForFunction(() => fold.state.id === 'crane');
  const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem('fold-by-fold.v1')).progress.crane);
  assert.equal(await p.evaluate(() => fold.state.i), 9, 'the link did not open its step');
  assert.equal(await saved(), 17, 'a link to a step lost the place you had got to');
  await p.reload();
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.equal(await p.evaluate(() => fold.state.i), 9, 'a reload after the link left the step the address names');
  assert.equal(await saved(), 17, 'a reload after the link lost the place you had got to');
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  await p.click('.model[data-model="crane"]');
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.equal(await p.evaluate(() => fold.state.i), 17, 'the crane opened from the gallery did not go back to your place');
  await p.goto(base + '#crane-10');
  await p.waitForFunction(() => fold.state.i === 9);
  await p.click('#play');
  assert.equal(await saved(), 9, 'playing the link\'s step did not make it your place');
  await p.context().close();
}

// Once a fold lands, where you got to moves on to the next step, so coming back starts from the paper as it now is
// rather than asking for the fold you've just made. Looking back at an earlier step keeps your place, by a tick or the
// back button; folding there makes it your place again.
{
  const p = await fresh('#crane-15');
  await p.waitForFunction(() => fold.state.id === 'crane');
  const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem('fold-by-fold.v1')).progress.crane);
  assert.equal(await saved(), 14);
  const tick = await p.evaluate(() => { const r = document.querySelector('#ticks li:nth-child(6)').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tick] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForFunction(() => fold.state.i === 5, null, { timeout: 2000 }).catch(() => assert.fail('a tap on tick 6 did not go to step 6'));
  assert.equal(await saved(), 14, 'looking back at a step by its tick lost your place');
  await p.click('#prev');
  assert.equal(await p.evaluate(() => fold.state.i), 4);
  assert.equal(await saved(), 14, 'looking back a step with the back button lost your place');
  await p.click('#play');
  assert.equal(await saved(), 4, 'folding an earlier step did not make it your place');
  await p.waitForFunction(() => fold.state.t >= 1, null, { timeout: 15000 });
  assert.equal(await saved(), 5, 'the fold landing did not move your place on to the next step');
  // A reload shows the step folded as you left it, from the address, rather than asking for that fold again.
  await p.waitForFunction(() => location.hash === '#crane-5' && history.state?.landed, null, { timeout: 3000 }).catch(() => assert.fail('the address did not name the step folded'));
  await p.reload();
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.deepEqual(await p.evaluate(() => [fold.state.i, fold.state.t]), [4, 1], 'a reload did not show the fold as it was left');
  assert.equal(await p.textContent('#playLabel'), 'Next fold');
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  assert.equal(await p.textContent('.model[data-model="crane"] .count'), 'Step 6 of 23', 'the crane\'s card doesn\'t say the next step');
  await p.click('.model[data-model="crane"]');
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.deepEqual(await p.evaluate(() => [fold.state.i, fold.state.t]), [5, 0], 'coming back did not open the next step from its start');
  assert.equal(await p.textContent('#playLabel'), 'Play');
  // The slider does the same: at its end your place is the next step, and back from there it's this one again.
  const scrub = (v) => p.locator('#scrub').evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await scrub(1000);
  assert.equal(await saved(), 6, 'the slider at its end did not move your place on');
  await scrub(500);
  assert.equal(await saved(), 5, 'the slider back from its end left your place on the next step');
  // The last step is where you got to once you're on it, folded or not.
  await p.evaluate(() => { location.hash = 'crane-23'; });
  await p.waitForFunction(() => fold.state.i === 22);
  await scrub(1000);
  assert.equal(await saved(), 22, 'the last step folded saved a step past the end');
  await p.context().close();
}

// The address names the step you're on, so a reload stays there and the address copied into another browser opens it.
// It's written once the step settles, not for every step a finger slides past (browsers limit how often a page may
// rewrite it), and it leaves the back arrow's way back to the gallery as it was.
{
  const p = await fresh();
  await p.click('.model:has(.title:text("Samurai helmet"))');
  await p.waitForSelector('#player:not([hidden])');
  assert.equal(await p.evaluate(() => location.hash), '#helmet');
  await p.evaluate(() => { location.hash = 'helmet-6'; });
  await p.waitForFunction(() => fold.state.i === 5);
  await p.click('#next');
  await p.waitForFunction(() => location.hash === '#helmet-7', null, { timeout: 3000 }).catch(() => assert.fail('the address does not name the step'));
  const url = p.url();
  await p.reload();
  await p.waitForFunction(() => fold.state.id === 'helmet');
  assert.equal(await p.textContent('#stepCount'), 'Step 7 of ' + await p.evaluate(() => fold.state.steps), 'a reload left the step in the address');
  const writes = await p.evaluate(() => new Promise((done) => {
    let n = 0;
    const own = history.replaceState;
    history.replaceState = function (...a) { n++; return own.apply(this, a); };
    for (const b of [...document.querySelectorAll('#ticks button')].slice(0, 9)) b.click();
    setTimeout(() => { history.replaceState = own; done([n, location.hash]); }, 800);
  }));
  assert.deepEqual(writes, [1, '#helmet-9'], 'the address was rewritten for every step passed, or not for the last');
  await p.evaluate(() => document.querySelector('#ticks button').click());
  await p.waitForFunction(() => location.hash === '#helmet', null, { timeout: 3000 }).catch(() => assert.fail('step 1 is not named by the model alone'));
  const other = await fresh(new URL(url).hash);
  await other.waitForFunction(() => fold.state.id === 'helmet');
  assert.deepEqual(await other.evaluate(() => [fold.state.i, fold.state.t]), [6, 0], 'the copied address did not open its step from the start');
  await other.context().close();
  await p.context().close();
}

// Opened from the gallery, the back arrow still goes back the way the browser's Back does once the address names a step.
{
  const p = await fresh();
  const before = await p.evaluate(() => history.length);
  await p.click('.model:has(.title:text("Paper cup"))');
  await p.waitForSelector('#player:not([hidden])');
  await p.click('#next');
  await p.waitForFunction(() => location.hash === '#cup-2', null, { timeout: 3000 });
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  assert.deepEqual(await p.evaluate(() => [history.length, location.hash]), [before + 1, ''], 'the back arrow added a page after the address named a step');
  await p.context().close();
}

// On a narrow phone a long model name takes two lines in the bar rather than losing its end.
{
  const p = await fresh('', { viewport: { width: 320, height: 568 } });
  await p.waitForSelector('#home:not([hidden])');
  await p.evaluate(() => document.fonts.ready);
  // The gallery has two cards across there too, all the same width, a one-word name like Waterbomb included.
  const widths = await p.evaluate(() => [...document.querySelectorAll('.model')].map((c) => [Math.round(c.getBoundingClientRect().left), Math.round(c.getBoundingClientRect().width)]));
  assert.equal(new Set(widths.map(([x]) => x)).size, 2, `the gallery isn't two cards across at 320 px: ${JSON.stringify(widths)}`);
  assert.ok(widths.every(([, w]) => w === widths[0][1]), `the cards aren't all one width at 320 px: ${JSON.stringify(widths)}`);
  const ids = await p.evaluate(() => [...document.querySelectorAll('.model')].map((b) => b.dataset.model));
  const cut = [];
  for (const id of ids) {
    await p.evaluate((id) => { location.hash = id; }, id);
    await p.waitForFunction((id) => fold.state.id === id, id);
    const r = await p.evaluate(() => {
      const e = document.getElementById('modelName');
      return e.scrollWidth > e.clientWidth || e.scrollHeight > e.clientHeight + parseFloat(getComputedStyle(e).lineHeight) / 2;
    });
    if (r) cut.push(id);
  }
  assert.deepEqual(cut, [], 'model names cut off in the bar at 320 px');
  await p.context().close();
}

// On a phone the small things to tap reach the 44 px a finger needs (Apple's guidelines, and WCAG 2.2's enhanced
// target size), past the room they take: a swatch, the footer links, Slow, the slider and the bar of ticks.
{
  const p = await fresh();
  await p.waitForSelector('#home:not([hidden])');
  const reach = (qs) => p.evaluate((qs) => qs.map((q) => {
    const e = document.querySelector(q);
    e.scrollIntoView({ block: 'center' });
    const r = e.getBoundingClientRect();
    const hit = (x, y) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h)); };
    let tall = 0, wide = 0;
    for (let y = Math.floor(r.top) - 25; y <= r.bottom + 25; y++) if (hit(r.left + r.width / 2, y)) tall++;
    for (let x = Math.floor(r.left) - 25; x <= r.right + 25; x++) if (hit(x, r.top + r.height / 2)) wide++;
    return [q, tall, wide];
  }), qs);
  const sizes = await reach(['.swatch:nth-child(3)', '.jd-foot a:last-child']);
  await p.click('.model:has(.title:text("Crane"))');
  await p.waitForFunction(() => fold.state.id === 'crane');
  sizes.push(...await reach(['#speed', '#scrub', '#ticks li:nth-child(4) button']));
  // The slider, the ticks and the links are wide already; the swatches and Slow need the width too.
  const small = sizes.filter(([q, tall, wide]) => tall < 44 || (/swatch|speed/.test(q) && wide < 44));
  assert.deepEqual(small, [], 'too small to tap: [what, px tall, px wide]');
  await p.context().close();
}

// The camera frames a step's whole fold, not just where it starts and ends: turning the model over stands the paper on
// its edge, and a fold behind lifts the model to make room under it, and neither runs off the stage part way. On a
// wide screen, a phone held sideways and a phone held upright, a quarter, half and three quarters of the way through.
for (const [width, height, list] of [
  [1280, 800, ['crane-3', 'crane-22', 'fortune-teller-8', 'waterbomb-9', 'helmet-10', 'frog-32']],
  [844, 390, ['crane-3', 'crane-22', 'fortune-teller-8', 'waterbomb-9', 'helmet-10', 'frog-32']],
  [390, 844, ['fortune-teller-8', 'crane-22']],
]) {
  const p = await fresh('#cup', { viewport: { width, height }, deviceScaleFactor: 1 });
  await p.waitForFunction(() => fold.state.id === 'cup');
  const off = await p.evaluate(async (list) => {
    const { MODELS } = await import('./js/models.js');
    const { build } = await import('./js/build.js');
    const { poses, corners } = await import('./js/motion.js');
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const out = [];
    for (const name of list) {
      const [, id, n] = /^(.*)-(\d+)$/.exec(name);
      location.hash = name;
      await new Promise((r) => { const k = () => (fold.state.id === id ? r() : setTimeout(k, 30)); k(); });
      const step = build(MODELS.find((m) => m.id === id)).steps[n - 1];
      for (const t of [0.25, 0.5, 0.75]) {
        fold.set(n - 1, t);
        await frame();
        const c = document.getElementById('gl'), v = fold.view();
        let worst = 0;
        for (const it of poses(step, t)) for (const q of corners(it)) {
          const [x, y] = v.project(q);
          worst = Math.max(worst, -x, x - c.clientWidth, -y, y - c.clientHeight);
        }
        if (worst > 2) out.push(`${name} at t=${t}: ${Math.round(worst)} px off`);
      }
    }
    return out;
  }, list);
  assert.deepEqual(off, [], `the paper runs off the stage mid-fold at ${width}x${height}`);
  await p.context().close();
}

// A step that stands the model up is seen from its own angle once its fold moves, by the slider as much as by Play.
// The angle stays with that step: the next model opens seen from above, as usual.
{
  const p = await fresh('#crane-23', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForFunction(() => fold.state.id === 'crane');
  const cam = () => p.evaluate(() => { const v = fold.view(); return [Math.round(v.cam.yaw), Math.round(v.cam.pitch), v.goal.target[2]]; });
  await p.locator('#scrub').evaluate((el) => { el.value = 1000; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForFunction(() => Math.abs(fold.view().cam.pitch - 16) < 0.5, null, { timeout: 5000 }).catch(() => {});
  assert.deepEqual(await cam(), [-120, 16, 0.22], 'the finished crane is not seen from its own angle after the slider');
  await p.locator('#scrub').evaluate((el) => { el.value = 0; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.click('#play');
  await p.waitForFunction(() => fold.state.t >= 1, null, { timeout: 20000 });
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  await p.evaluate(() => { location.hash = 'plane-8'; });
  await p.waitForFunction(() => fold.state.id === 'plane');
  assert.deepEqual(await cam(), [-90, 58, 0], 'the crane\'s angle carried over to the plane');
  await p.context().close();
}

// Each model opens seen from the usual angle and zoom, not from where the last one was left: from underneath and zoomed
// in, the paper airplane's first step ('white side up') showed only the back of the paper, filling the view.
{
  const p = await fresh('', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.click('.model:has(.title:text("Crane"))');
  await p.waitForFunction(() => fold.state.id === 'crane');
  const cam = () => p.evaluate(() => { const v = fold.view(); return [Math.round(v.cam.yaw), Math.round(v.cam.pitch), +v.zoom.toFixed(2)]; });
  const box = await p.locator('#gl').boundingBox();
  await p.mouse.move(box.x + 300, box.y + 620);
  await p.mouse.down();
  for (let k = 1; k <= 10; k++) await p.mouse.move(box.x + 300 + k * 12, box.y + 620 - k * 44);
  await p.mouse.up();
  for (let k = 0; k < 5; k++) await p.mouse.wheel(0, -175);
  await p.waitForFunction(() => fold.view().zoom < 0.4, null, { timeout: 3000 }).catch(() => {});
  assert.deepEqual(await cam(), [-132, -74, 0.35], 'the crane was not turned and zoomed');
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  await p.click('.model:has(.title:text("Paper airplane"))');
  await p.waitForFunction(() => fold.state.id === 'plane');
  assert.deepEqual(await cam(), [-90, 58, 1], 'the plane opened at the angle and zoom the crane was left at');
  // Within a model the view holds from step to step.
  await p.evaluate(() => { fold.view().cam.yaw = -60; });
  await p.click('#next');
  assert.equal((await cam())[0], -60, 'the view did not hold between steps');
  await p.context().close();
}

// With reduced motion asked for, the camera jumps rather than swinging on its own: Play on the crane's last step turned
// the whole scene 30 degrees and tilted it 42 over a second. The fold itself still plays at its own pace.
{
  const p = await fresh('#crane-23', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false, reducedMotion: 'reduce' });
  await p.waitForFunction(() => fold.state.id === 'crane');
  const next = (what) => p.evaluate((what) => new Promise((done) => {
    document.getElementById(what).click();
    requestAnimationFrame(() => requestAnimationFrame(() => { const v = fold.view(); done([Math.round(v.cam.yaw), +v.cam.pitch.toFixed(1)]); }));
  }), what);
  assert.deepEqual(await next('play'), [-120, 16], 'with reduced motion, the camera swung to the crane\'s own angle');
  assert.deepEqual(await p.evaluate(() => [fold.state.playing, fold.state.t < 1]), [true, true], 'with reduced motion, the fold did not play');
  assert.deepEqual(await next('topView'), [-90, 89.9], 'with reduced motion, the camera glided to look straight down');
  await p.context().close();
}

// The back arrow returns to the gallery the way the browser's Back would, so Back from the gallery leaves
// instead of reopening the model. Opened straight from a link, it goes to the gallery without adding a page.
{
  const p = await fresh();
  const before = await p.evaluate(() => history.length);
  await p.click('.model:has(.title:text("Paper cup"))');
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
  await frame.click('.model:has(.title:text("Paper cup"))');
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
  assert.match(await p.textContent('#glError'), /can’t draw the paper in 3D, but every step is still written out/);
  for (const q of ['#hint', '#topView', '#resetView']) assert.equal(await p.isVisible(q), false, `${q} is still up without 3D`);
  assert.equal(await p.getAttribute('#gl', 'tabindex'), null, 'Tab still stops at the paper without 3D');
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
  assert.equal(await p.isVisible('#glError'), false, 'a word that the 3D stopped, though it came back at once');
  // If it doesn't come back within a few seconds, the page says so, rather than leaving a blank box, and the word
  // goes again once it does come back. A fold that was playing stops where it was, rather than running on unseen.
  await p.click('#play');
  await p.waitForFunction(() => fold.state.t > 0.05, null, { timeout: 5000 });
  await p.evaluate(() => { window.lose = document.getElementById('gl').getContext('webgl').getExtension('WEBGL_lose_context'); lose.loseContext(); });
  await p.waitForSelector('#glError:not([hidden])', { timeout: 6000 }).catch(() => assert.fail('no word that the 3D stopped'));
  const stopped = await p.evaluate(() => [fold.state.playing, fold.state.t < 1]);
  assert.deepEqual(stopped, [false, true], 'the fold ran on while the 3D was gone');
  assert.equal(await p.textContent('#playLabel'), 'Carry on');
  assert.equal(await p.textContent('#glError'), 'The 3D view stopped. Reload the page to bring the paper back.');
  await p.evaluate(() => lose.restoreContext());
  await p.waitForSelector('#glError', { state: 'hidden', timeout: 4000 }).catch(() => assert.fail('the word that the 3D stopped stayed after it came back'));
  await p.context().close();
}

// The page asks the browser for frames only while something moves: none on the gallery, and none on a player left
// alone, rather than one for every frame forever. Play still runs its fold to the end, and the paper is drawn again
// when the stage changes size.
{
  const p = await fresh('', { init: () => {
    window.frameCount = 0;
    const ask = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (f) => ask((t) => { window.frameCount++; f(t); });
  } });
  await p.waitForSelector('#home:not([hidden])');
  const idle = async () => { const a = await p.evaluate(() => frameCount); await p.waitForTimeout(1000); return (await p.evaluate(() => frameCount)) - a; };
  await p.waitForTimeout(500);
  assert.ok(await idle() <= 2, 'the gallery asks for frames while nothing moves');
  await p.click('.model:has(.title:text("Heart"))');
  await p.waitForFunction(() => fold.state.id === 'heart');
  await p.waitForTimeout(1500); // the camera settles
  assert.ok(await idle() <= 2, 'a player left alone asks for frames');
  await p.click('#play');
  await p.waitForFunction(() => fold.state.t >= 1, null, { timeout: 15000 }).catch(() => assert.fail('the fold did not finish'));
  await p.waitForTimeout(1500);
  assert.ok(await idle() <= 2, 'the player asks for frames once the fold has landed');
  await p.setViewportSize({ width: 360, height: 700 });
  await p.waitForFunction(() => { const c = document.getElementById('gl'); return c.width === Math.round(c.clientWidth * Math.min(devicePixelRatio, 2)) && c.height === Math.round(c.clientHeight * Math.min(devicePixelRatio, 2)); }, null, { timeout: 3000 }).catch(() => {});
  assert.ok(await p.evaluate(() => { const c = document.getElementById('gl'); return c.width === Math.round(c.clientWidth * 2); }), 'the paper was not drawn again for the new size');
  await p.context().close();
}

// Locking the phone or switching to another app mid-fold pauses it, since nothing is drawn out of sight: coming back,
// it carries on from where it was. A fold whose marks were still up comes back to Play.
{
  const p = await fresh('#cup-2');
  await p.waitForFunction(() => fold.state.id === 'cup');
  const hide = () => p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  const show = () => p.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
  await p.click('#play');
  await p.waitForFunction(() => fold.state.t > 0.05, null, { timeout: 5000 });
  await hide();
  await p.waitForTimeout(2500);
  assert.deepEqual(await p.evaluate(() => [fold.state.playing, fold.state.t < 1]), [false, true], 'the fold ran on out of sight');
  assert.equal(await p.textContent('#playLabel'), 'Carry on');
  await show();
  await p.click('#prev');
  await p.click('#play');
  await hide();
  assert.deepEqual(await p.evaluate(() => [fold.state.playing, fold.state.t]), [false, 0], 'the fold went on out of sight from the marks');
  assert.equal(await p.textContent('#playLabel'), 'Play');
  await p.context().close();
}

// While a model is open the screen is kept on: asked for on opening it, and let go of back in the gallery or ten
// minutes after the last touch or key (the next touch asks again). The browser lets go itself while the page is out of
// sight, so it's asked again when the page is back. (Headless Chromium says no to the real thing, so it's stood in for.)
{
  const p = await fresh('', { init: () => {
    window.locks = [];
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async (type) => {
      locks.push(type);
      const lock = window.lock = new EventTarget();
      lock.release = async () => { if (!lock.released) { lock.released = true; locks.push('release'); lock.dispatchEvent(new Event('release')); } };
      return lock;
    } } });
    const later = window.setTimeout;
    window.setTimeout = function (fn, ms, ...rest) { if (ms === 10 * 60 * 1000) window.idle = fn; return later.call(this, fn, ms, ...rest); };
  } });
  const locks = (n) => p.waitForFunction((n) => locks.length >= n, n, { timeout: 2000 }).catch(() => {}).then(() => p.evaluate(() => locks.join(' ')));
  await p.click('.model:has(.title:text("Paper cup"))');
  await p.waitForSelector('#player:not([hidden])');
  assert.equal(await locks(1), 'screen', 'opening a model did not keep the screen on');
  await p.tap('#gl');
  await p.evaluate(() => idle());
  assert.equal(await locks(2), 'screen release', 'ten minutes with nothing touched did not let the screen sleep');
  await p.tap('#gl');
  assert.equal(await locks(3), 'screen release screen', 'a touch after that did not keep the screen on again');
  await p.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    lock.release();
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await locks(5), 'screen release screen release screen', 'back in sight, the screen was not kept on again');
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  assert.equal(await locks(6), 'screen release screen release screen release', 'back in the gallery, the screen was still kept on');
  await p.context().close();
}

// Slow gives the marks longer on the paper before a fold moves, and the fold itself a little over twice as long
// (2.2 times), and it's remembered.
{
  const p = await fresh('#cup');
  await p.waitForFunction(() => fold.state.id === 'cup');
  // From Play to the fold moving, and from there to its end.
  const timed = () => p.evaluate(() => new Promise((done) => {
    fold.set(0, 0);
    document.getElementById('play').click();
    const t0 = performance.now();
    let moved = 0;
    const tick = () => {
      const now = performance.now();
      if (!moved && fold.state.t > 0) moved = now;
      if (fold.state.t >= 1) done([moved - t0, now - moved]);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  const [, folding] = await timed();
  await p.click('#speed');
  const [held, slowly] = await timed();
  assert.ok(held > 850 * 2.2 - 50, `with Slow on, the marks show for only ${Math.round(held)} ms before the fold moves`);
  assert.ok(Math.abs(slowly / folding - 2.2) < 0.3, `with Slow on, the fold takes ${Math.round(slowly)} ms, against ${Math.round(folding)} ms without`);
  await p.reload();
  await p.waitForFunction(() => fold.state.id === 'cup');
  assert.equal(await p.getAttribute('#speed', 'aria-pressed'), 'true', 'Slow was forgotten on a reload');
  await p.context().close();
}

// Two tabs (or the installed copy beside a tab) keep what each other saved: the paper, Slow and each model's place.
// Each one saves only what it changed, on top of what's saved now, and one showing the gallery or a model takes in
// what the other saved as it happens.
{
  const a = await fresh('#crane');
  await a.waitForFunction(() => fold.state.id === 'crane');
  for (let k = 0; k < 3; k++) await a.click('#next');
  const b = await a.context().newPage();
  b.on('pageerror', e => problems.push(e.message));
  await b.goto(base);
  await b.waitForSelector('#home:not([hidden])');
  await b.click('.swatch[aria-label="Indigo"]');
  await b.click('.model[data-model="frog"]');
  await b.waitForFunction(() => fold.state.id === 'frog');
  for (let k = 0; k < 2; k++) await b.click('#next');
  await b.click('#speed');
  await a.waitForFunction(() => document.getElementById('speed').getAttribute('aria-pressed') === 'true', null, { timeout: 3000 }).catch(() => assert.fail('Slow turned on in another tab is not shown on'));
  await a.click('#next');
  const saved = () => a.evaluate(() => JSON.parse(localStorage.getItem('fold-by-fold.v1')));
  const s = await saved();
  assert.deepEqual([s.paper, s.slow, s.progress.crane, s.progress.frog], ['indigo', true, 4, 2], `one tab lost what another saved: ${JSON.stringify(s)}`);
  const c = await a.context().newPage();
  await c.goto(base);
  await c.waitForSelector('#home:not([hidden])');
  assert.equal(await c.getAttribute('.swatch[aria-label="Indigo"]', 'aria-checked'), 'true', 'a new tab lost the paper picked in another');
  assert.deepEqual(await c.evaluate(() => ['crane', 'frog'].map((id) => document.querySelector(`.model[data-model="${id}"] .count`).textContent)), ['Step 5 of 23', 'Step 3 of 34'], 'a new tab lost a place saved in another');
  await c.close();
  // The gallery in one tab shows what's picked and folded in another.
  await a.click('#back');
  await a.waitForSelector('#home:not([hidden])');
  await b.click('#back');
  await b.waitForSelector('#home:not([hidden])');
  await b.click('.swatch[aria-label="Marigold"]');
  await b.click('.model[data-model="frog"]');
  await b.waitForFunction(() => fold.state.id === 'frog');
  await b.click('#next');
  await a.waitForFunction(() => document.querySelector('.swatch[aria-label="Marigold"]').getAttribute('aria-checked') === 'true'
    && document.querySelector('.model .thumb polygon[fill="#e3a034"]')
    && document.querySelector('.model[data-model="frog"] .count').textContent === 'Step 4 of 34', null, { timeout: 3000 })
    .catch(() => assert.fail('the gallery did not show the paper picked, or the place reached, in another tab'));
  await a.context().close();
}

// Two quick presses of Play still fold. The second comes while the marks are up and the paper hasn't moved yet, so it
// looks as if the first did nothing: it starts the fold then, rather than pausing it before it begins.
{
  const p = await fresh('#plane-2');
  await p.waitForFunction(() => fold.state.id === 'plane');
  await p.click('#play');
  await p.waitForTimeout(200);
  await p.click('#play');
  await p.waitForFunction(() => fold.state.t > 0.1, null, { timeout: 5000 }).catch(() => assert.fail('two quick presses of Play left the paper where it was'));
  assert.equal(await p.textContent('#playLabel'), 'Pause');
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

// A link to a step past the end opens the last step, a step before the first opens the first, and a link that names
// no model opens the gallery.
{
  const p = await fresh('#frog-35');
  await p.waitForFunction(() => fold.state.id === 'frog');
  assert.equal(await p.evaluate(() => fold.state.i), 33, '#frog-35 did not open the frog\'s last step');
  await p.evaluate(() => { location.hash = 'crane-0'; });
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.equal(await p.evaluate(() => fold.state.i), 0, '#crane-0 did not open the crane\'s first step');
  await p.evaluate(() => { location.hash = 'junk'; });
  await p.waitForSelector('#home:not([hidden])', { timeout: 5000 }).catch(() => assert.fail('#junk did not open the gallery'));
  await p.context().close();
}

// The arrow keys step through the folds, also once a button has been pressed; → on the last step leaves it
// be, ← does what the back button does, and the slider keeps the arrow keys for itself.
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
  // A fold part way through goes back to its start, and from there to the step before.
  await p.evaluate(() => fold.set(3, 0.5));
  await p.keyboard.press('ArrowLeft');
  assert.deepEqual(await p.evaluate(() => [fold.state.i, fold.state.t]), [3, 0], '← part way through a fold did not take it back to its start');
  await p.keyboard.press('ArrowLeft');
  assert.deepEqual(await p.evaluate(() => [fold.state.i, fold.state.t]), [2, 0], '← at the start of a fold did not go to the step before');
  // On step 1, with no step before, a fold that has only just moved goes back to its start, by the key or the button.
  await p.evaluate(() => fold.set(0, 0.01));
  await p.keyboard.press('ArrowLeft');
  assert.deepEqual(await p.evaluate(() => [fold.state.i, fold.state.t]), [0, 0], '← on step 1 just after its fold moved did nothing');
  await p.evaluate(() => fold.set(0, 0.01));
  await p.click('#prev');
  assert.deepEqual(await p.evaluate(() => [fold.state.i, fold.state.t]), [0, 0], 'the back button on step 1 just after its fold moved did nothing');
  await p.evaluate(() => fold.set(4, 0));
  await p.focus('#scrub');
  await p.keyboard.press('ArrowLeft');
  assert.equal(await p.evaluate(() => fold.state.i), 4, 'the slider\'s arrow keys changed the step');
  await p.context().close();
}

// The slider's arrow keys move the fold a twentieth of the way at a time: it runs from 0 to 1000, and each press moved
// it a thousandth, too little to see. Page Up and Page Down still go a tenth, Home and End to the ends. A screen
// reader hears how far the fold has gone rather than a number out of 1000, and Space there plays and pauses as it
// does anywhere else in the player.
{
  const p = await fresh('#crane-3', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForFunction(() => fold.state.id === 'crane');
  const now = () => p.evaluate(() => [fold.state.i, fold.state.t, document.getElementById('scrub').getAttribute('aria-valuetext')]);
  assert.deepEqual(await now(), [2, 0, 'Not started'], 'the slider does not say the fold has not started');
  await p.focus('#scrub');
  for (const [key, t, say] of [['ArrowRight', 0.05, '5% folded'], ['ArrowRight', 0.1, '10% folded'], ['ArrowUp', 0.15, '15% folded'],
    ['ArrowDown', 0.1, '10% folded'], ['ArrowLeft', 0.05, '5% folded'], ['End', 1, 'Folded'], ['PageDown', 0.9, '90% folded'], ['Home', 0, 'Not started']]) {
    await p.keyboard.press(key);
    assert.deepEqual(await now(), [2, t, say], `${key} on the slider did not move the fold to ${t}`);
  }
  await p.keyboard.press(' ');
  assert.equal(await p.evaluate(() => fold.state.playing), true, 'Space on the slider did not play');
  await p.waitForFunction(() => fold.state.t >= 1, null, { timeout: 15000 });
  assert.equal(await p.getAttribute('#scrub', 'aria-valuetext'), 'Folded', 'the slider does not say the fold has landed');
  await p.context().close();
}

// Next and the back button keep the focus at the ends of a model. Going through a model with Enter on Next, the focus
// fell to the page at the last step, as the button turned itself off under it; the back button did the same at the
// first step. They say they're unavailable there instead, and pressing them does nothing.
{
  const p = await fresh('#plane-7', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForFunction(() => fold.state.id === 'plane');
  const last = (await p.evaluate(() => fold.state.steps)) - 1;
  const now = (q) => p.evaluate((q) => [fold.state.i, document.activeElement.id, document.querySelector(q).getAttribute('aria-disabled')], q);
  await p.focus('#next');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300); // a browser takes the focus off a button turned off with the next frame
  assert.deepEqual(await now('#next'), [last, 'next', 'true'], 'Next lost the focus at the last step, or is not marked unavailable');
  await p.evaluate((i) => fold.set(i, 0.5), last);
  await p.keyboard.press('Enter');
  assert.deepEqual(await p.evaluate(() => [fold.state.i, fold.state.t, fold.state.playing]), [last, 0.5, false], 'Next did something at the last step');
  await p.evaluate(() => fold.set(1, 0));
  await p.focus('#prev');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(300);
  assert.deepEqual(await now('#prev'), [0, 'prev', 'true'], 'the back button lost the focus at the first step, or is not marked unavailable');
  await p.keyboard.press('Enter');
  assert.deepEqual(await now('#prev'), [0, 'prev', 'true'], 'the back button did something at the first step');
  await p.context().close();
}

// The buttons with a key of their own say so, over the button under a mouse and to screen readers: Space for Play,
// whatever it's called just then, → for Next, and ← for the back button, which does what that key does.
{
  const p = await fresh('#plane-3', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForFunction(() => fold.state.id === 'plane');
  const keys = () => p.evaluate(() => ['play', 'next', 'prev'].map((id) => { const b = document.getElementById(id); return [b.title, b.getAttribute('aria-keyshortcuts')]; }));
  assert.deepEqual(await keys(), [['Play (Space)', 'Space'], ['Next step (→)', 'ArrowRight'], ['Previous step (←)', 'ArrowLeft']], 'the buttons don\'t say their keys');
  await p.evaluate(() => fold.set(2, 0.5));
  assert.deepEqual(await keys(), [['Carry on (Space)', 'Space'], ['Next step (→)', 'ArrowRight'], ['Replay this fold (←)', 'ArrowLeft']], 'the buttons don\'t say their keys part way through a fold');
  assert.equal(await p.getAttribute('#prev', 'aria-label'), 'Replay this fold');
  await p.context().close();
}

// For screen readers, the list of steps beside the paper is named, and each step in it says its number, which is on
// screen but was left out of what a screen reader heard; the symbol beside a step's name is left out. The focus ring on
// a step in the list is drawn inside it, so the list's edges don't cut it off at the sides.
{
  const p = await fresh('#crane-3', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForFunction(() => fold.state.id === 'crane');
  assert.equal(await p.getByRole('list', { name: 'All steps' }).getByRole('button', { name: /^Step 3: Turn it over/ }).count(), 1, 'the list of steps is not named, or its steps don\'t say their numbers');
  assert.equal(await p.locator('#chip svg[aria-hidden="true"]').count(), 1, 'the symbol beside the step\'s name is read out');
  await p.focus('#speed');
  await p.keyboard.press('Tab');
  assert.deepEqual(await p.evaluate(() => [document.activeElement.closest('#stepList') !== null, getComputedStyle(document.activeElement).outlineOffset]), [true, '-3px'], 'the focus ring on a step in the list is cut off');
  await p.context().close();
}

// The paper turns and zooms from the keyboard too: with it in focus, the arrow keys turn it the way a drag does and
// + and - zoom, and they don't step through the model meanwhile. A mouse pressed on the paper doesn't leave the focus
// there, so after a drag the arrow keys step again. Escape goes back to the gallery, as the back arrow does.
{
  const p = await fresh('#crane-5', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForFunction(() => fold.state.id === 'crane');
  const cam = () => p.evaluate(() => { const v = fold.view(); return [fold.state.i, Math.round(v.cam.yaw), Math.round(v.cam.pitch), +v.zoom.toFixed(2)]; });
  const settled = (yaw, pitch) => p.waitForFunction(([yaw, pitch]) => { const v = fold.view(); return v.goal.yaw === null && Math.round(v.cam.yaw) === yaw && Math.round(v.cam.pitch) === pitch; }, [yaw, pitch], { timeout: 5000 }).catch(() => {});
  await p.focus('#resetView');
  await p.keyboard.press('Tab');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'gl', 'Tab from the view buttons did not go to the paper');
  await p.keyboard.press('ArrowRight');
  await settled(-105, 58);
  await p.keyboard.press('ArrowUp');
  await settled(-105, 48);
  assert.deepEqual(await cam(), [4, -105, 48, 1], 'the arrow keys did not turn the paper in focus, or stepped');
  await p.keyboard.press('+');
  assert.equal((await cam())[3], 0.8, '+ did not zoom in');
  await p.keyboard.press('-');
  assert.equal((await cam())[3], 1, '- did not zoom out');
  const box = await p.locator('#gl').boundingBox();
  await p.mouse.move(box.x + 200, box.y + 300);
  await p.mouse.down();
  await p.mouse.move(box.x + 260, box.y + 300, { steps: 4 });
  await p.mouse.up();
  assert.equal(await p.evaluate(() => document.activeElement === document.body), true, 'a drag on the paper left the focus on it');
  await p.keyboard.press('ArrowRight');
  assert.equal((await cam())[0], 5, 'after a drag on the paper, → did not step');
  await p.keyboard.press('Escape');
  await p.waitForSelector('#home:not([hidden])', { timeout: 3000 }).catch(() => assert.fail('Escape did not go back to the gallery'));
  await p.context().close();
}

// Space plays and pauses after a click anywhere on the player. Most browsers give a clicked button the focus, and
// Space would press it again: the step clicked in the list, Next (on another step), Slow (off again). The slider
// leaves Space alone too. A button the keyboard has put the focus on still presses itself.
{
  const p = await fresh('#plane-3', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForFunction(() => fold.state.id === 'plane');
  const now = () => p.evaluate(() => [fold.state.i, fold.state.playing]);
  const moving = () => p.waitForFunction(() => fold.state.t > 0, null, { timeout: 5000 });
  await p.click('#stepList li:nth-child(5) button');
  await p.keyboard.press(' ');
  assert.deepEqual(await now(), [4, true], 'Space after a click on the list of steps did not play');
  await moving();
  await p.click('#next');
  await moving();
  await p.keyboard.press(' ');
  assert.deepEqual(await now(), [5, false], 'Space after a click on Next did not pause on that step');
  await p.click('#speed');
  await p.keyboard.press(' ');
  assert.deepEqual(await now(), [5, true], 'Space after a click on Slow did not play');
  assert.equal(await p.getAttribute('#speed', 'aria-pressed'), 'true', 'Space after a click on Slow turned it off again');
  const bar = await p.locator('#scrub').boundingBox();
  await p.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await p.keyboard.press(' ');
  assert.deepEqual(await now(), [5, true], 'Space after a click on the slider did not carry on');
  // The focus put on Next with the keyboard goes when Play is clicked, as a click takes it anywhere.
  await p.evaluate(() => fold.set(2, 0));
  await p.focus('#next');
  await p.click('#play');
  await moving();
  await p.keyboard.press(' ');
  assert.deepEqual(await now(), [2, false], 'Space after a click on Play pressed the button the keyboard had been on');
  await p.focus('#next');
  await p.keyboard.press(' ');
  assert.deepEqual(await now(), [3, true], 'Space did not press Next with the focus on it from the keyboard');
  // In a narrower window, with the bar of ticks in place of the list, the same goes for a click on a tick, and a click
  // leaves nothing with the focus. The ticks and the list still pick a step from a tap, too.
  await p.setViewportSize({ width: 800, height: 800 });
  await p.click('#ticks li:nth-child(7) button');
  assert.equal((await now())[0], 6, 'a click on a tick did not pick its step');
  await p.keyboard.press(' ');
  assert.deepEqual(await now(), [6, true], 'Space after a click on a tick did not play');
  assert.equal(await p.evaluate(() => document.activeElement === document.body), true, 'a click left the focus on the player');
  await p.context().close();
  const t = await fresh('#plane-3', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await t.waitForFunction(() => fold.state.id === 'plane');
  await t.tap('#stepList li:nth-child(6) button');
  await t.waitForFunction(() => fold.state.i === 5, null, { timeout: 2000 }).catch(() => assert.fail('a tap on the list of steps did not pick its step'));
  await t.tap('#next');
  await t.waitForFunction(() => fold.state.i === 6 && fold.state.playing, null, { timeout: 2000 }).catch(() => assert.fail('a tap on Next did not play the next step'));
  await t.context().close();
}

// Scrubbing on a phone does only what the slider changes: the list of steps, hidden there, isn't scrolled to the step
// on every move (on a slow phone that was most of the cost), nor when the step changes. On a wide screen the list still
// follows the step.
{
  const p = await fresh('#frog-16');
  await p.waitForFunction(() => fold.state.id === 'frog');
  const scrolls = await p.evaluate(() => {
    let n = 0;
    const list = document.getElementById('stepList'), own = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    Object.defineProperty(list, 'scrollTop', { configurable: true, get() { return own.get.call(this); }, set(v) { n++; own.set.call(this, v); } });
    const s = document.getElementById('scrub');
    for (let k = 1; k <= 20; k++) { s.value = String(k * 40); s.dispatchEvent(new Event('input', { bubbles: true })); }
    for (const k of [17, 18, 19]) document.querySelector(`#ticks li:nth-child(${k}) button`).click();
    delete list.scrollTop;
    return n;
  });
  assert.equal(scrolls, 0, `the hidden list of steps was scrolled ${scrolls} times`);
  await p.setViewportSize({ width: 1000, height: 560 });
  await p.waitForTimeout(100);
  await p.evaluate(() => document.querySelector('#ticks li:nth-child(31) button').click());
  const seen = await p.evaluate(() => {
    const list = document.getElementById('stepList').getBoundingClientRect(), b = document.querySelector('#stepList [aria-current="step"]').getBoundingClientRect();
    return b.top >= list.top - 0.5 && b.bottom <= list.bottom + 0.5;
  });
  assert.ok(seen, 'on a wide screen the list of steps did not scroll to the step');
  await p.context().close();
}

// On a wide screen the list of steps keeps the step you're on in its middle, so the steps after it show too: the step
// sat at the very bottom, with the next one out of sight. The list scrolls only when the step changes, so it can be
// scrolled to read ahead while a fold plays and stays there when the fold lands, and the page itself never scrolls.
{
  const p = await fresh('#frog-20', { viewport: { width: 1280, height: 700 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForFunction(() => fold.state.id === 'frog');
  const where = () => p.evaluate(() => {
    const list = document.getElementById('stepList'), l = list.getBoundingClientRect();
    const on = list.querySelector('[aria-current="step"]'), r = on.getBoundingClientRect(), next = on.parentElement.nextElementSibling.getBoundingClientRect();
    return { off: Math.round((r.top + r.bottom) / 2 - (l.top + list.clientTop + list.clientHeight / 2)), next: next.bottom <= l.bottom + 0.5, top: list.scrollTop, page: scrollY };
  });
  let w = await where();
  assert.ok(Math.abs(w.off) <= 1 && w.page === 0, `step 20 isn't in the middle of the list: ${JSON.stringify(w)}`);
  await p.evaluate(() => fold.set(29, 0));
  w = await where();
  assert.ok(w.next && w.page === 0, `the step after step 30 is out of sight in the list: ${JSON.stringify(w)}`);
  await p.click('#play');
  await p.evaluate(() => { document.getElementById('stepList').scrollTop = 0; });
  await p.waitForFunction(() => fold.state.t >= 1, null, { timeout: 15000 });
  assert.equal((await where()).top, 0, 'the list jumped back to the step when its fold landed');
  await p.context().close();
}

// A double tap on the paper puts the view back, found from the taps themselves: phones don't all report a double tap
// as a double click (Safari on an iPhone hasn't always), so here the page never hears of one.
{
  const p = await fresh('#cup');
  await p.waitForFunction(() => fold.state.id === 'cup');
  await p.evaluate(() => { window.addEventListener('dblclick', (e) => e.stopPropagation(), true); const v = fold.view(); v.cam.yaw = -150; v.cam.pitch = 20; });
  const [x, y] = await p.evaluate(() => { const r = document.getElementById('gl').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const cdp = await p.context().newCDPSession(p);
  for (let k = 0; k < 2; k++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await p.waitForFunction(() => fold.view().goal.yaw === null && fold.view().cam.yaw !== -150, null, { timeout: 3000 }).catch(() => {});
  assert.deepEqual(await p.evaluate(() => [Math.round(fold.view().cam.yaw), Math.round(fold.view().cam.pitch)]), [-90, 58], 'a double tap did not put the view back');
  // Two fingers spreading apart on the paper zoom in.
  await p.waitForTimeout(400);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
  for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 30 - k * 10, y, id: 1 }, { x: x + 30 + k * 10, y, id: 2 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForFunction(() => fold.view().zoom < 0.8, null, { timeout: 3000 }).catch(() => {});
  assert.ok(await p.evaluate(() => fold.view().zoom) < 0.8, 'a pinch did not zoom in');
  // In the player, a swipe down can't pull the page to reload it.
  assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY), 'none');
  await p.context().close();
}

// Zooming goes toward the point under the cursor or the fingers, so a small fold at a tip stays in sight as it grows:
// the crane's head, about 20 px across on a phone, used to leave the screen as you zoomed in to see it. Two fingers
// moving together slide the view along the table, and a double tap puts it back in the middle.
{
  // Where the tip of the crane's neck is on the screen, in CSS pixels on the canvas, and how big it looks.
  const tip = (p) => p.evaluate(async () => {
    const { MODELS } = await import('./js/models.js');
    const { build } = await import('./js/build.js');
    const { poses, corners } = await import('./js/motion.js');
    window.crane21 ||= build(MODELS.find((m) => m.id === 'crane')).steps[20];
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const moving = new Set(crane21.motion.moving), v = fold.view();
    const at = poses(crane21, 0).filter((it) => moving.has(it.facet.id)).flatMap((it) => corners(it)).map((q) => v.project(q));
    const xs = at.map((q) => q[0]), ys = at.map((q) => q[1]);
    return { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length, size: Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
  });
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  // The wheel, with the cursor over the tip.
  {
    const p = await fresh('#crane-21', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
    await p.waitForFunction(() => fold.state.id === 'crane');
    const box = await p.locator('#gl').boundingBox();
    const was = await tip(p);
    await p.mouse.move(box.x + was.x, box.y + was.y);
    for (let k = 0; k < 4; k++) await p.mouse.wheel(0, -200);
    await p.waitForFunction(() => fold.view().zoom < 0.5, null, { timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(300);
    const now = await tip(p);
    assert.ok(now.size > was.size * 1.8, `the head did not get bigger under the wheel (${was.size.toFixed(0)} to ${now.size.toFixed(0)} px)`);
    assert.ok(near(now, was) < 8, `the head moved ${near(now, was).toFixed(0)} px from under the cursor as it zoomed`);
    await p.context().close();
  }
  // Two fingers spreading over the tip, on a phone.
  {
    const p = await fresh('#crane-21');
    await p.waitForFunction(() => fold.state.id === 'crane');
    const box = await p.locator('#gl').boundingBox();
    const was = await tip(p);
    const [x, y] = [box.x + was.x, box.y + was.y];
    const cdp = await p.context().newCDPSession(p);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 15, y, id: 1 }, { x: x + 15, y, id: 2 }] });
    for (let k = 1; k <= 8; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 15 - k * 6, y, id: 1 }, { x: x + 15 + k * 6, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForFunction(() => fold.view().zoom < 0.5, null, { timeout: 3000 }).catch(() => {});
    await p.waitForTimeout(300);
    const now = await tip(p);
    assert.ok(now.size > was.size * 1.8, `the head did not get bigger under the fingers (${was.size.toFixed(0)} to ${now.size.toFixed(0)} px)`);
    assert.ok(near(now, was) < 12, `the head moved ${near(now, was).toFixed(0)} px from under the fingers as they spread`);
    // Two fingers moving together slide the view: the head follows them.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 40, y, id: 1 }, { x: x + 40, y, id: 2 }] });
    for (let k = 1; k <= 6; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 40 - k * 10, y: y + k * 5, id: 1 }, { x: x + 40 - k * 10, y: y + k * 5, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(300);
    const slid = await tip(p);
    assert.ok(near(slid, { x: now.x - 60, y: now.y + 30 }) < 12, `the head didn't follow two fingers across (${JSON.stringify([now, slid])})`);
    // The view stays near the paper however far the fingers go.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 100, y: 200, id: 1 }, { x: 160, y: 200, id: 2 }] });
    for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 100 + k * 100, y: 200 + k * 100, id: 1 }, { x: 160 + k * 100, y: 200 + k * 100, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(300);
    const kept = await p.evaluate(() => { const v = fold.view(), { box, size } = v.framing, [x, y] = v.cam.target; return x >= box[0] - size * 0.11 && x <= box[2] + size * 0.11 && y >= box[1] - size * 0.11 && y <= box[3] + size * 0.11; });
    assert.ok(kept, 'two fingers slid the view off the paper');
    // A double tap puts the view back in the middle, unzoomed.
    await p.waitForTimeout(400);
    for (let k = 0; k < 2; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 100, y: box.y + 100 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    await p.waitForFunction(() => fold.view().zoom === 1 && fold.view().pan.every((v) => v === 0), null, { timeout: 3000 }).catch(() => {});
    assert.deepEqual(await p.evaluate(() => [fold.view().zoom, ...fold.view().pan]), [1, 0, 0], 'a double tap did not put the view back in the middle');
    await p.context().close();
  }
}

// The frog's 34 ticks are too narrow to hit one with a finger, so a finger slides along the bar and the step under
// it is picked as it goes; lifting it leaves that step, and a tap picks the tick tapped. A finger going up or down
// from the bar scrolls instead. A mouse can drag along it too, and the ticks are still buttons for the keyboard.
{
  const p = await fresh('#frog');
  await p.waitForFunction(() => fold.state.id === 'frog');
  const at = await p.evaluate(() => [...document.querySelectorAll('#ticks li')].map((li) => {
    const r = li.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }));
  assert.equal(at.length, 34);
  const step = () => p.evaluate(() => fold.state.i);
  // A touch move reaches the page with the next frame, after CDP has answered, so wait a moment for the step.
  const stepNow = async (want) => { await p.waitForFunction((n) => fold.state.i === n, want, { timeout: 1000 }).catch(() => {}); return step(); };
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, [x, y] = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y }] });
  const slide = async (from, to) => {
    for (let k = 1; k <= 8; k++) await touch('touchMove', [from[0] + (to[0] - from[0]) * k / 8, from[1]]);
  };
  await touch('touchStart', at[2]);
  await slide(at[2], at[9]);
  assert.equal(await stepNow(9), 9, 'sliding along the ticks did not pick the step under the finger');
  await slide(at[9], at[19]);
  assert.equal(await stepNow(19), 19, 'sliding further did not follow the finger');
  await touch('touchEnd');
  await p.waitForTimeout(300);
  assert.equal(await step(), 19, 'lifting the finger did not leave the step it was on');
  assert.equal(await p.getAttribute('#ticks li:nth-child(20) button', 'aria-current'), 'step');
  const tap = await p.evaluate(() => { const r = document.querySelector('#ticks li:nth-child(5)').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await touch('touchStart', tap);
  await touch('touchEnd');
  await p.waitForTimeout(300);
  assert.equal(await step(), 4, 'tapping a tick did not pick its step');
  await p.context().close();

  // Held sideways on a small phone, a finger that swipes up from the bar is going somewhere else: the step stays.
  const s = await fresh('#crane-19', { viewport: { width: 568, height: 320 } });
  await s.waitForFunction(() => fold.state.id === 'crane');
  const scdp = await s.context().newCDPSession(s);
  const [x, y] = await s.evaluate(() => { const r = document.querySelector('#ticks li:nth-child(5)').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await scdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let k = 1; k <= 10; k++) await scdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - k * 12 }] });
  await scdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await s.waitForTimeout(300);
  assert.equal(await s.evaluate(() => fold.state.i), 18, 'a swipe up from the ticks picked a step');
  await s.context().close();

  const m = await fresh('#frog', { hasTouch: false });
  await m.waitForFunction(() => fold.state.id === 'frog');
  await m.mouse.move(...at[4]);
  await m.mouse.down();
  await m.mouse.move(at[12][0], at[12][1], { steps: 6 });
  await m.mouse.up();
  await m.waitForTimeout(200);
  assert.equal(await m.evaluate(() => fold.state.i), 12, 'dragging the mouse along the ticks did not pick the step under it');
  await m.focus('#ticks li:nth-child(6) button');
  await m.keyboard.press('Enter');
  assert.equal(await m.evaluate(() => fold.state.i), 5, 'a tick did nothing from the keyboard');
  await m.context().close();
}

// The bar of ticks is one stop for Tab, at the step you're on, the way the paper colours are: each tick was a stop of
// its own, 34 presses to get past the frog's. With a tick in focus the arrow keys move the focus along with the step.
// A screen reader comes to the step's words straight after the paper, then the ticks: they were read first, every one.
{
  const p = await fresh('#frog-12');
  await p.waitForFunction(() => fold.state.id === 'frog');
  const on = () => p.evaluate(() => { const a = document.activeElement; return a.closest('#ticks') ? `tick ${[...document.querySelectorAll('#ticks button')].indexOf(a) + 1}` : a.id || a.tagName; });
  assert.equal(await p.locator('#ticks button[tabindex="0"]').count(), 1, 'Tab stops at more than one tick');
  await p.focus('#resetView');
  await p.keyboard.press('Tab');
  assert.equal(await on(), 'gl', 'Tab from the view buttons did not go to the paper');
  await p.keyboard.press('Tab');
  assert.equal(await on(), 'tick 12', 'Tab from the paper did not go to the step\'s tick');
  await p.keyboard.press('Tab');
  assert.equal(await on(), 'scrub', 'Tab from the step\'s tick did not go on to the slider');
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('ArrowRight');
  await p.waitForFunction(() => fold.state.i === 12);
  assert.equal(await on(), 'tick 13', 'the focus stayed on the tick before when the step moved on');
  await p.keyboard.press('ArrowLeft');
  await p.waitForFunction(() => fold.state.i === 11);
  assert.equal(await on(), 'tick 12', 'the focus stayed on the tick after when the step went back');
  assert.equal(await p.getAttribute('#ticks li:nth-child(12) button', 'tabindex'), '0');
  const order = await p.evaluate(() => [...document.querySelectorAll('.panel > *')].filter((e) => e.offsetParent).map((e) => e.id || e.className));
  assert.deepEqual(order.slice(0, 2), ['step-now', 'ticks'], 'the step\'s words don\'t come before the ticks for a screen reader');
  const shown = await p.evaluate(() => ['#ticks', '.step-now'].map((q) => document.querySelector(q).getBoundingClientRect().top));
  assert.ok(shown[0] < shown[1], 'the ticks are no longer above the words');
  assert.equal(await p.getAttribute('#hint', 'aria-hidden'), 'true', 'the hint repeats the paper\'s own label to screen readers');
  await p.context().close();
}

// A screen reader is told the step you land on, with its number, once you stop on it: a finger sliding along the ticks
// past fourteen steps queued fourteen sets of words, and "Step 17 of 34" was never said. Moving the slider, or a fold
// playing, says nothing.
{
  const p = await fresh('#frog');
  await p.waitForFunction(() => fold.state.id === 'frog');
  await p.waitForTimeout(600); // the first step is told
  assert.equal(await p.textContent('#tell'), `Step 1 of 34. ${await p.textContent('#say')}`, 'opening a model did not tell the first step');
  assert.equal(await p.getAttribute('#say', 'aria-live'), null, 'the words on screen are read out as well');
  await p.evaluate(() => { window.told = []; new MutationObserver(() => told.push(document.getElementById('tell').textContent)).observe(document.getElementById('tell'), { childList: true, characterData: true, subtree: true }); });
  const at = await p.evaluate(() => [...document.querySelectorAll('#ticks li')].map((li) => { const r = li.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at[2][0], y: at[2][1] }] });
  for (let k = 1; k <= 14; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at[2][0] + (at[16][0] - at[2][0]) * k / 14, y: at[2][1] }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForFunction(() => fold.state.i === 16, null, { timeout: 2000 }).catch(() => {});
  await p.waitForTimeout(800);
  const say = await p.textContent('#say');
  assert.deepEqual(await p.evaluate(() => told), [`Step 17 of 34. ${say}`], 'a slide along the ticks was not told once, as the step it stopped on');
  await p.evaluate(() => {
    told.length = 0;
    const s = document.getElementById('scrub');
    for (let k = 1; k <= 20; k++) { s.value = String(k * 50); s.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await p.waitForTimeout(800);
  assert.deepEqual(await p.evaluate(() => told), [], 'moving the slider told the step again');
  await p.context().close();
}

// Each card holds only words and its picture, since a button may hold only phrasing content (HTML Living Standard,
// 4.10.6 The button element): its name and words were a heading and paragraphs, which some browsers flatten. The
// models have a heading of their own over them for screen readers, between the page's name and the key of marks.
{
  const p = await fresh();
  await p.waitForSelector('#home:not([hidden])');
  assert.equal(await p.locator('.model :is(h1, h2, h3, h4, p, div)').count(), 0, 'a card holds headings or paragraphs');
  assert.equal(await p.getByRole('heading', { name: 'Models', level: 2 }).count(), 1, 'the models have no heading over them');
  assert.equal(await p.getByRole('button', { name: 'Paper cup Easy 5 steps A cup that holds water for a minute or two.' }).count(), 1, 'the paper cup card\'s name runs its words together');
  await p.context().close();
}

// Every tick on the bar stands out from the panel by at least 3 to 1 (WCAG 2.2, 1.4.11 Non-text Contrast), in light and
// dark: each is a button, and its bar is all there is to see of it. The steps to come were 1.3 to 1, barely there.
for (const colorScheme of ['light', 'dark']) {
  const p = await fresh('#frog-12', { colorScheme });
  await p.waitForFunction(() => fold.state.id === 'frog');
  const ratios = await p.evaluate(() => {
    // A colour as computed, rgb() or color(srgb), with any see-through part laid over what's under it.
    const rgb = (s, under) => {
      const m = s.match(/[\d.]+/g).map(Number), c = s.startsWith('color(') ? m.slice(0, 3).map((v) => v * 255) : m.slice(0, 3), a = m[3] ?? 1;
      return c.map((v, k) => v * a + (under ? under[k] : 0) * (1 - a));
    };
    const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
    const panel = rgb(getComputedStyle(document.querySelector('.panel')).backgroundColor);
    const bar = (q) => ratio(rgb(getComputedStyle(document.querySelector(q), '::before').backgroundColor, panel), panel);
    return { done: bar('#ticks li:nth-child(3) button'), current: bar('#ticks li:nth-child(12) button'), coming: bar('#ticks li:nth-child(20) button') };
  });
  assert.ok(Object.values(ratios).every((r) => r >= 3), `a tick is too faint against the panel in ${colorScheme}: ${JSON.stringify(ratios)}`);
  await p.context().close();
}

// The cards in a row line up: names, step counts and words at the same height across the row. On a wide screen,
// and on a phone too, where a name on two lines (Paper airplane) sits beside one on one line (Paper cup), and with
// a card saying which step you got to.
for (const [width, height] of [[1280, 800], [390, 844], [360, 780]]) {
  const wide = width >= 700;
  const p = await fresh('', { viewport: { width, height }, ...(wide ? { deviceScaleFactor: 1, hasTouch: false } : {}), init: () => localStorage.setItem('fold-by-fold.v1', '{"progress":{"plane":2,"crane":9}}') });
  await p.waitForSelector('#home:not([hidden])');
  await p.evaluate(() => document.fonts.ready);
  const rows = await p.evaluate(() => {
    const out = {};
    for (const card of document.querySelectorAll('.model')) {
      const top = Math.round(card.getBoundingClientRect().top);
      const at = (q) => Math.round(card.querySelector(q).getBoundingClientRect().top) - top;
      (out[top] ||= []).push([at('.title'), at('.meta'), at('.blurb')]);
    }
    return Object.values(out);
  });
  assert.ok(rows.length >= 2 && rows[0].length >= 2, `the cards aren't in rows at ${width} px: ${JSON.stringify(rows)}`);
  for (const row of rows) assert.ok(row.every((card) => card.every((y, k) => y === row[0][k])), `the cards in a row don't line up at ${width} px: ${JSON.stringify(row)}`);
  if (wide) {
    // With a mouse, the hint under the paper says to scroll to zoom.
    await p.click('.model:has(.title:text("Paper cup"))');
    await p.waitForSelector('#player:not([hidden])');
    assert.equal(await p.innerText('#hint'), 'Drag to turn the paper · scroll to zoom');
    // And scrolling on the paper zooms in, the square button looks straight down the way a diagram does, and a
    // double click puts the view back.
    const cam = () => p.evaluate(() => { const v = fold.view(); return [Math.round(v.cam.yaw), +v.cam.pitch.toFixed(1), +v.zoom.toFixed(2)]; });
    const box = await p.locator('#gl').boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.mouse.wheel(0, -400);
    await p.waitForFunction(() => fold.view().zoom < 0.8, null, { timeout: 3000 }).catch(() => {});
    assert.ok((await cam())[2] < 0.8, 'scrolling on the paper did not zoom in');
    await p.click('#topView');
    await p.waitForFunction(() => fold.view().goal.pitch === null && fold.view().cam.pitch > 89, null, { timeout: 5000 }).catch(() => {});
    assert.equal((await cam())[1], 89.9, 'the square button did not look straight down');
    await p.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await p.waitForFunction(() => fold.view().goal.pitch === null && fold.view().cam.pitch < 60, null, { timeout: 5000 }).catch(() => {});
    assert.deepEqual(await cam(), [-90, 58, 1], 'a double click did not put the view back');
  }
  await p.context().close();
}

// Back from a model, the gallery is where you left it. The page puts it back itself (Chrome would often do it
// anyway, but that depends on timing and not every browser does), so the browser's own way is turned off here.
{
  const p = await fresh();
  await p.evaluate(() => { history.scrollRestoration = 'manual'; });
  const frog = '.model:has(.title:text-is("Frog"))';
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
  // The focus is back on the card you opened, for the keyboard and screen readers.
  assert.equal(await p.evaluate(() => document.activeElement.dataset.model), 'frog', 'the focus did not come back to the card');
  // Turned sideways in the model, the cards are three across when you come back, so it comes back to the card
  // rather than to the same distance down the page.
  await p.click(frog);
  await p.waitForSelector('#player:not([hidden])');
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(100);
  await p.click('#back');
  await p.waitForSelector('#home:not([hidden])');
  await p.waitForTimeout(100);
  const seen = await p.evaluate(() => { const r = document.querySelector('.model[data-model="frog"]').getBoundingClientRect(); return [r.top >= 0 && r.bottom <= innerHeight, document.activeElement.dataset.model]; });
  assert.deepEqual(seen, [true, 'frog'], 'back after turning the phone, the frog\'s card is out of sight or lost the focus');
  await p.context().close();
}

// Opening a model from the gallery puts the focus on its name, so a screen reader says where you are and Tab goes on
// from the top of the player, to the view buttons next: the focus fell to the page, and in Chrome the first Tab went
// to the list of steps. Back in the gallery it's on the card again, and Forward from there opens the model the same
// way. A model opened from a link leaves the focus where the browser puts it.
{
  const p = await fresh('', { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForSelector('#home:not([hidden])');
  const on = () => p.evaluate(() => { const a = document.activeElement; return a.id || a.dataset.model || a.tagName; });
  await p.focus('.model[data-model="cup"]');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#player:not([hidden])');
  await p.waitForTimeout(100);
  assert.equal(await on(), 'modelName', 'opening a model did not put the focus on its name');
  await p.keyboard.press('Tab');
  assert.equal(await on(), 'topView', 'Tab from the model\'s name did not go on to the view buttons');
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Enter');
  await p.waitForSelector('#home:not([hidden])');
  assert.equal(await on(), 'cup', 'back in the gallery, the focus is not on the card');
  await p.goForward();
  await p.waitForSelector('#player:not([hidden])');
  await p.waitForTimeout(100);
  assert.equal(await on(), 'modelName', 'Forward from the gallery did not put the focus on the model\'s name');
  await p.goto(base + '#heart');
  await p.waitForFunction(() => fold.state.id === 'heart');
  await p.reload();
  await p.waitForFunction(() => fold.state.id === 'heart');
  assert.equal(await on(), 'BODY', 'a model opened from a link took the focus');
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
  await p.click('.model:has(.title:text("Paper cup"))');
  await p.waitForSelector('#player:not([hidden])');
  assert.deepEqual(await under(['#back', '#resetView', '#ticks', '.step-now', '.scrub', '#prev', '#speed']), [], 'the player runs under the sides of the screen');
  // Wide enough for the words beside the paper (a big phone), the panel makes room for the notch too.
  await p.setViewportSize({ width: 932, height: 430 });
  await p.waitForTimeout(100);
  assert.deepEqual(await under(['#back', '#resetView', '.step-now', '#speed']), [], 'the player runs under the sides of a big phone');
  await p.context().close();
}

// On a phone held sideways the words and buttons go beside the paper, so the paper keeps the height of the screen
// instead of a strip under them. The slider and buttons fit beside it and stay in view, and long words scroll in
// their own box above them, fading out at the bottom while there's more. Held upright, they stay under the paper.
{
  const p = await fresh('#crane-19', { viewport: { width: 844, height: 390 } }); // the longest words of any step
  await p.waitForFunction(() => fold.state.id === 'crane');
  const layout = () => p.evaluate(() => {
    const box = (q) => document.querySelector(q).getBoundingClientRect();
    const panel = document.querySelector('.panel');
    const [stage, bar, pn, play] = [box('#stage'), box('.bar'), panel.getBoundingClientRect(), box('#play')];
    const order = ['#ticks', '.step-now', '.scrub', '.controls'].map(box);
    const out = ['#prev', '#play', '#next', '#speed'].filter((q) => box(q).left < pn.left || box(q).right > pn.right);
    return {
      beside: stage.right <= pn.left + 0.5, under: stage.bottom <= pn.top + 0.5, stageH: stage.height, room: innerHeight - bar.height,
      overlap: order.some((b, k) => k > 0 && b.top < order[k - 1].bottom - 0.5),
      out, play: play.top >= pn.top - 0.5 && play.bottom <= Math.min(pn.bottom, innerHeight) + 0.5 && panel.scrollTop === 0,
      sideways: document.documentElement.scrollWidth > innerWidth,
    };
  });
  for (const [width, height] of [[844, 390], [667, 375], [844, 340], [568, 320]]) {
    await p.setViewportSize({ width, height });
    await p.waitForTimeout(100);
    const r = await layout();
    assert.ok(r.beside, `the words aren't beside the paper at ${width}x${height}`);
    assert.ok(r.stageH >= r.room - 1, `the paper is a strip ${Math.round(r.stageH)} px tall at ${width}x${height}`);
    assert.equal(r.overlap, false, `the words run over the slider or buttons at ${width}x${height}`);
    assert.deepEqual(r.out, [], `buttons cut off at ${width}x${height}`);
    assert.ok(r.play, `Play is out of sight at ${width}x${height}`);
    assert.equal(r.sideways, false, `the player scrolls sideways at ${width}x${height}`);
  }
  // At 568x320 the words are longer than their box: it fades at the bottom until it's scrolled to the end.
  assert.equal(await p.evaluate(() => document.querySelector('.step-now').classList.contains('more')), true, 'long words don\'t fade out where they\'re cut off');
  await p.evaluate(() => { const w = document.querySelector('.step-now'); w.scrollTop = w.scrollHeight; });
  await p.waitForFunction(() => !document.querySelector('.step-now').classList.contains('more'), null, { timeout: 2000 }).catch(() => {});
  assert.equal(await p.evaluate(() => document.querySelector('.step-now').classList.contains('more')), false, 'the words still fade out at their end');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(100);
  assert.ok((await layout()).under, 'held upright, the words are no longer under the paper');
  await p.context().close();
}

// Zoomed in to 400% (a 1280x800 window is then 320x200) the paper keeps a usable square and the words and buttons go
// under it, the page scrolling to reach them, rather than the words beside it squeezing the paper to nothing (WCAG 2.2,
// 1.4.10 Reflow). At 300% too. Phones held sideways keep the words beside the paper (above).
for (const [width, height] of [[320, 200], [427, 267]]) {
  const p = await fresh('#crane-19', { viewport: { width, height }, deviceScaleFactor: 1, hasTouch: false });
  await p.waitForFunction(() => fold.state.id === 'crane');
  const r = await p.evaluate(() => {
    const box = (q) => document.querySelector(q).getBoundingClientRect();
    const [stage, play, say] = [box('#stage'), box('#play'), box('#say')];
    return { stage: [Math.round(stage.width), Math.round(stage.height)], under: say.top >= stage.bottom - 0.5, play: play.bottom + scrollY <= document.documentElement.scrollHeight + 0.5 && play.right <= innerWidth, sideways: document.documentElement.scrollWidth > innerWidth };
  });
  assert.ok(r.stage[0] >= 200 && r.stage[1] >= 200, `the paper is ${r.stage.join('x')} at ${width}x${height}`);
  assert.deepEqual([r.under, r.play, r.sideways], [true, true, false], `at ${width}x${height} the words aren't under the paper, Play can't be reached, or the page scrolls sideways: ${JSON.stringify(r)}`);
  await p.click('#play');
  assert.equal(await p.evaluate(() => fold.state.playing), true, `Play did nothing at ${width}x${height}`);
  await p.context().close();
}

// On a short phone held upright (an iPhone SE in Safari, or smaller), long words don't squeeze the paper to a strip
// or push Play off the screen: at every step of the crane and the frog the paper keeps over a third of the height.
for (const [width, height] of [[375, 553], [320, 460]]) {
  const p = await fresh('#crane', { viewport: { width, height } });
  await p.waitForFunction(() => fold.state.id === 'crane');
  for (const id of ['crane', 'frog']) {
    await p.evaluate((id) => { location.hash = id; }, id);
    await p.waitForFunction((id) => fold.state.id === id, id);
    const short = await p.evaluate(() => {
      const bad = [];
      for (let i = 0; i < fold.state.steps; i++) {
        fold.set(i, 0);
        const stage = document.getElementById('stage').getBoundingClientRect(), play = document.getElementById('play').getBoundingClientRect();
        if (stage.height < 0.35 * innerHeight || play.top < 0 || play.bottom > innerHeight) bad.push(`step ${i + 1}: paper ${Math.round(stage.height)} px, Play ${Math.round(play.top)}-${Math.round(play.bottom)}`);
      }
      return bad;
    });
    assert.deepEqual(short, [], `the ${id}'s words crowd the paper or Play at ${width}x${height}`);
  }
  await p.context().close();
}

// On a tablet held upright, the words keep to a column in the middle, a little bigger, so a line runs about 60
// characters rather than 80 to 100 across the whole width; the ticks, slider and buttons keep to it too. The paper
// still has most of the screen at every step of the crane and the frog, the longest words included.
{
  const p = await fresh('#crane-19', { viewport: { width: 768, height: 1024 }, deviceScaleFactor: 1 });
  await p.waitForFunction(() => fold.state.id === 'crane');
  const col = await p.evaluate(() => ['#say', '#ticks', '.controls'].map((q) => { const b = document.querySelector(q).getBoundingClientRect(); return [Math.round(b.width), Math.round(b.left + b.right - innerWidth)]; }));
  assert.deepEqual(col, [[576, 0], [576, 0], [576, 0]], 'on a tablet the words and controls don\'t keep to a column in the middle');
  assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('say')).fontSize), '19.2px', 'on a tablet the words are no bigger');
  for (const id of ['crane', 'frog']) {
    await p.evaluate((id) => { location.hash = id; }, id);
    await p.waitForFunction((id) => fold.state.id === id, id);
    const short = await p.evaluate(() => {
      const bad = [];
      for (let i = 0; i < fold.state.steps; i++) {
        fold.set(i, 0);
        const stage = document.getElementById('stage').getBoundingClientRect(), play = document.getElementById('play').getBoundingClientRect();
        if (stage.height < 0.6 * innerHeight || play.bottom > innerHeight) bad.push(`step ${i + 1}: paper ${Math.round(stage.height)} px, Play ${Math.round(play.top)}-${Math.round(play.bottom)}`);
      }
      return bad;
    });
    assert.deepEqual(short, [], `on a tablet the ${id}'s words crowd the paper or Play`);
  }
  await p.context().close();
}

// The single-file copy (npm run build) works straight from disk: it opens, folds a step, and asks for nothing.
{
  execSync('node scripts/build.mjs', { cwd: root, stdio: 'pipe' });
  const file = pathToFileURL(join(root, 'dist/fold-by-fold.html')).href;
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const p = await c.newPage();
  const asked = [];
  p.on('request', (r) => { if (!r.url().startsWith('data:') && r.url().split('#')[0] !== file) asked.push(r.url()); });
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await p.goto(file);
  await p.waitForSelector('#home:not([hidden])');
  await p.click('.model:has(.title:text("Heart"))');
  await p.waitForSelector('#player:not([hidden])');
  await p.click('#play');
  await p.waitForFunction(() => fold.state.t >= 1, null, { timeout: 15000 }).catch(() => assert.fail('the single-file copy did not fold'));
  assert.deepEqual(asked, [], 'the single-file copy asked for files');
  await c.close();
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();

// sw.js changes whenever a file it keeps does, so a release replaces the whole offline copy at once: FILES in sw.js is
// a fingerprint of every file in SHELL (sha1 of each, in the list's order, an address like './' read as its
// index.html; the first 8 hex of the sha1 of those).
const shell = [...sw.match(/SHELL = \[([^\]]*)\]/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]);
const all = createHash('sha1');
for (const f of shell) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
const files = all.digest('hex').slice(0, 8);
assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
console.log('all good');
