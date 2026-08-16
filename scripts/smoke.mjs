/**
 * End-to-end smoke test for the core loop.
 *
 * Checks the one path the whole project depends on: an empty browser shows the example city, a
 * logged win writes to the real city and appears immediately, and it survives a reload.
 *
 *   node scripts/smoke.mjs [--url=http://localhost:5173]
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const url = flag('url', 'http://localhost:5173');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle'],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
let page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

const sub = () => page.textContent('#brand-sub');

try {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  // 1. A browser with no data should offer the example rather than an empty plane.
  check('empty browser shows the example city', (await sub())?.includes('example') ?? false, await sub());

  // 2. Logging a win.
  await page.evaluate(() => document.querySelector('#log-win').click());
  await page.waitForSelector('.panel', { timeout: 5000 });
  check('log form opens', true);

  const phrase = `smoke test win ${Date.now()}`;
  await page.fill('.input--lead', phrase);
  await page.evaluate(() => {
    document.querySelectorAll('.chip')[1].click(); // Rest
  });
  await page.evaluate(() => document.querySelector('.form .btn--primary').click());
  await page.waitForTimeout(3500);

  // 3. It should have left the example and be showing the user's own city.
  const afterLog = await sub();
  check('logging switches off the example', !(afterLog ?? '').includes('example'), afterLog ?? '');
  check('win count reflects the new entry', (afterLog ?? '').startsWith('1 win'), afterLog ?? '');

  // 4. It has to survive a reload — this is the whole point of the store.
  // A fresh page rather than page.reload: reloading never completes, because tearing down a live
  // WebGL context and rAF loop on a software GL surface takes longer than any sane timeout. The
  // first page must be closed first — two software-GL contexts starve each other of CPU and the
  // second page never finishes booting.
  await page.close();
  const second = await context.newPage();
  second.on('pageerror', (e) => errors.push(e.message));
  await second.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await second.waitForTimeout(5000);
  const afterReload = await second.textContent('#brand-sub');
  check('the win persists in a new session', (afterReload ?? '').startsWith('1 win'), afterReload ?? '');
  page = second;

  // 5. The entry is retrievable with the user's exact words, unedited.
  const stored = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const request = indexedDB.open('vista');
        request.onsuccess = () => {
          const db = request.result;
          const all = db.transaction('entries').objectStore('entries').getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => resolve([]);
        };
        request.onerror = () => resolve([]);
      }),
  );
  const match = stored.find((e) => e.text === phrase);
  check('text is stored verbatim', Boolean(match), match ? `category=${match.category}` : 'not found');
  check('category chip was applied', match?.category === 'rest', match?.category ?? 'none');

  // 6. Commitments.
  await page.evaluate(() => document.querySelector('#open-commitments').click());
  await page.waitForSelector('.form--inline', { timeout: 5000 });
  await page.fill('.form--inline .input', 'Move my body');
  await page.evaluate(() => document.querySelector('.form--inline .btn--primary').click());
  await page.waitForTimeout(2500);
  const commitmentRows = await page.locator('.commitment').count();
  check('commitment added', commitmentRows === 1, `${commitmentRows} row(s)`);

  await page.evaluate(() => document.querySelector('.commitment__check').click());
  await page.waitForTimeout(2500);
  const detail = await page.textContent('.commitment__detail');
  check('marking done adds a floor', (detail ?? '').startsWith('1 floor'), detail ?? '');
  check('cadence and state are shown', (detail ?? '').includes('lights on'), detail ?? '');
} catch (cause) {
  check('smoke run completed', false, cause.message);
} finally {
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
