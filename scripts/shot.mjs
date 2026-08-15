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
import { mkdir } from 'node:fs/promises';
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

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});

const messages = [];
page.on('console', (m) => messages.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => messages.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(wait);

if (scrub !== null) {
  await page.fill('#scrub', scrub).catch(() => {});
  await page.dispatchEvent('#scrub', 'input').catch(() => {});
  await page.waitForTimeout(400);
}

await page.screenshot({ path: out });
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
