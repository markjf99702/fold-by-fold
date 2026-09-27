// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Every picture is the real page, stopped at a fixed moment of a fixed step, so the same pictures come out
// every time.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.OUT || root; // somewhere else to write them, for trying things out
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

// Software WebGL, the same on every machine.
const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
await mkdir(join(out, 'docs'), { recursive: true });

async function open(viewport, deviceScaleFactor, hash = '') {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: viewport.width < 600, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto(base + hash);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '.hint { display: none !important; }' });
  return page;
}

// Shows step i (from 1) of the open model at moment t, seen from yaw/pitch if given.
async function at(page, i, t, aim) {
  await page.evaluate(([i, t, aim]) => {
    fold.set(i - 1, t);
    if (aim) fold.view().aim(aim[0], aim[1]);
  }, [i, t, aim]);
  await page.waitForTimeout(400);
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await page.screenshot({ path: join(out, 'docs/phone-home.png') });
  await page.evaluate(() => { location.hash = 'helmet'; });
  await page.waitForSelector('#player:not([hidden])');
  // The same step twice: the diagram's marks on the paper, then the fold happening.
  await at(page, 3, 0);
  await page.screenshot({ path: join(out, 'docs/phone-marks.png') });
  await at(page, 3, 0.45, [-70, 40]);
  await page.screenshot({ path: join(out, 'docs/phone-fold.png') });
  await page.context().close();
}

// Link preview, 1200 x 630: a real fold, part way, on the cutting mat beside the name.
{
  const page = await open({ width: 1200, height: 630 }, 1, '#helmet');
  await page.waitForSelector('#player:not([hidden])');
  await page.addStyleTag({ content: `
    .player { display: block !important; position: relative; }
    .bar, .panel { display: none !important; }
    .stage { position: absolute !important; inset: 0 auto 0 0; width: 1640px; height: 630px; background: var(--mat); }
    .og { position: absolute; left: 76px; top: 50%; transform: translateY(-50%); width: 420px; color: #f4efe4; }
    .og p.eyebrow { font-size: 22px; letter-spacing: .14em; text-transform: uppercase; margin: 0 0 14px; color: #bcd3c8; font-weight: 700; }
    .og h1 { font-family: var(--display); font-weight: 800; font-size: 96px; line-height: 1; margin: 0 0 22px; }
    .og p.say { font-size: 30px; line-height: 1.3; margin: 0; }
  ` });
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.className = 'og';
    d.innerHTML = '<p class="eyebrow">Origami, step by step</p><h1>Fold by Fold</h1><p class="say">Watch every fold happen in 3D. Rewind it, slow it down, turn it around.</p>';
    document.getElementById('player').append(d);
    dispatchEvent(new Event('resize'));
  });
  // The helmet's second flap, halfway over.
  await at(page, 3, 0.45, [-70, 40]);
  const png = await page.screenshot();
  await writeFile(join(out, 'og.png'), await small(png));
  await page.context().close();
}

// Down to a 256-colour palette, which keeps the file small.
async function small(png) {
  try {
    const UPNG = require('upng-js');
    const img = UPNG.decode(png);
    return Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256));
  } catch { return png; }
}

await browser.close();
server.close();
console.log('screenshots written');
