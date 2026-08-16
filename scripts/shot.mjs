/**
 * Dev screenshot tool.
 *
 * Drives the running dev server with headless Chromium and writes a PNG, so visual changes can be
 * checked without a human at the screen. Console errors are printed too — a page can paint its
 * shell perfectly while something throws underneath.
 *
 *   node scripts/shot.mjs [out.png] [--url=http://localhost:5173] [--scrub=120] [--wait=1200]
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};

const out = resolve(positional[0] ?? 'shots/latest.png');
const url = flag('url', 'http://localhost:5173');
const wait = Number(flag('wait', '1200'));
const scrub = flag('scrub', null);

await mkdir(dirname(out), { recursive: true });

// SwiftShader flags: headless Chromium has no GPU, and WebGL silently fails without them.
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle'],
});
// 1x scale: software GL makes a 2x buffer painfully slow for no diagnostic gain.
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
});

// ?seed asks for confirmation, which blocks the page forever under automation if unanswered.
page.on('dialog', (d) => d.accept());

const messages = [];
page.on('console', (m) => messages.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));

const target = new URL(url);
target.searchParams.set('capture', '1');

// domcontentloaded, not load: top-level await in the entry module plus a continuous rAF loop on a
// software GL surface means "load" can take longer than any sane timeout.
await page.goto(target.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
await page.waitForTimeout(wait);

const click = flag('click', null);
if (click !== null) {
  // Dispatched directly rather than via page.click: the full-viewport WebGL canvas makes
  // Playwright's actionability check time out even though the control is plainly on top.
  const ok = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, click);
  console.log(`click ${click}: ${ok ? 'ok' : 'element not found'}`);
  // Generous: software GL renders this scene at well under one frame per second, so a short
  // wait captures the pre-click frame and the change looks like it silently failed.
  await page.waitForTimeout(6000);
}

const mouse = flag('mouse', null);
if (mouse !== null) {
  // Move in a few steps so pointermove fires and the butterfly has time to fly over and land.
  const [mx, my] = mouse.split(',').map(Number);
  await page.mouse.move(mx * 0.5, my * 0.5);
  await page.waitForTimeout(300);
  await page.mouse.move(mx, my, { steps: 12 });
  await page.waitForTimeout(2200);
}

if (scrub !== null) {
  await page.fill('#scrub', scrub).catch(() => {});
  await page.dispatchEvent('#scrub', 'input').catch(() => {});
  await page.waitForTimeout(400);
}

// Read the canvas framebuffer directly rather than using page.screenshot: on a software GL
// surface Playwright's capture waits for a frame that a continuous rAF loop never delivers.
// Needs ?capture in the URL so the renderer keeps its drawing buffer.
const dataUrl = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return canvas ? canvas.toDataURL('image/png') : null;
});

if (dataUrl) {
  await writeFile(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
} else {
  await page.screenshot({ path: out, animations: 'disabled', timeout: 60_000 });
}

// The canvas framebuffer holds no DOM overlays, so anything rendered as HTML has to be reported
// separately or it looks broken in every screenshot.
const overlay = await page.evaluate(() => {
  const card = document.querySelector('.memory-card');
  if (!card) return 'no card element';
  const visible = card.classList.contains('is-visible');
  return `${visible ? 'VISIBLE' : 'hidden'} — ${card.textContent?.trim() || '(empty)'}`;
});
console.log(`\nmemory card: ${overlay}`);
await browser.close();

console.log(`screenshot -> ${out}`);
if (messages.length > 0) {
  console.log('\n--- console ---');
  console.log(messages.join('\n'));
}
const problems = messages.filter((m) => m.startsWith('[error]') || m.startsWith('[pageerror]'));
if (problems.length > 0) {
  console.log(`\n${problems.length} error(s) on the page`);
  process.exitCode = 1;
}
