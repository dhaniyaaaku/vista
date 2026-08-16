/**
 * Screenshot including DOM overlays.
 *
 * scripts/shot.mjs reads the WebGL framebuffer directly, which is fast and reliable but cannot see
 * any HTML drawn on top — the landing page, panels, the memory card. This one uses Playwright's
 * compositor capture instead, which does see them but is much slower on a software GL surface.
 *
 *   node scripts/shot-dom.mjs out.png [--url=...] [--wait=8000] [--click=selector]
 */

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const out = resolve(positional[0] ?? 'shots/dom.png');
const url = flag('url', 'http://localhost:5173');
const wait = Number(flag('wait', '9000'));
const click = flag('click', null);

await mkdir(dirname(out), { recursive: true });

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const messages = [];
page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') messages.push(`[error] ${m.text()}`);
});

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(wait);

if (click) {
  await page.evaluate((sel) => document.querySelector(sel)?.click(), click);
  await page.waitForTimeout(2500);
}

// Stop the render loop before capturing. A continuous rAF loop on a software GL surface is what
// makes Playwright's compositor capture hang — with it halted, the frame is stable and the DOM
// overlay composites normally.
await page.evaluate(() => {
  const raf = window.requestAnimationFrame;
  let id = raf(() => {});
  for (let i = id; i > id - 200; i -= 1) window.cancelAnimationFrame(i);
});
await page.waitForTimeout(600);

await page.screenshot({ path: out, animations: 'disabled', timeout: 120_000 });
await browser.close();

console.log(`screenshot -> ${out}`);
if (messages.length > 0) console.log(messages.join('\n'));
