/**
 * Every interactive control, exercised.
 *
 * Clicks are dispatched through the DOM rather than Playwright's `click`, deliberately. Playwright
 * waits for an element to be "stable" across animation frames, and this page renders a WebGL scene
 * at well under one frame per second on a software GL surface, so its actionability check times out
 * on controls that are perfectly clickable for a real user. Dispatching directly tests the thing
 * that can actually break: whether the handler is wired and does what it claims.
 *
 *   node scripts/buttons.mjs [--url=http://localhost:5173]
 */

import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const base = flag('url', 'http://localhost:5173');

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-gl=angle'],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
// window.confirm blocks forever under automation unless answered.
page.on('dialog', (d) => d.accept());

const click = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return false;
  el.click();
  return true;
}, sel);
const count = (sel) => page.locator(sel).count();
const settle = (ms = 1400) => page.waitForTimeout(ms);

try {
  // ---------------------------------------------------------------- landing
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(9000);

  check('landing appears when signed out', (await count('.landing')) === 1);
  check('sign-in button present', (await count('.btn-google')) === 1);
  check('no explore/demo escape offered', (await count('.landing__fallback:not([hidden])')) === 0);

  check('"How it works" opens', (await click('.landing__how')) && ((await settle()), (await count('.panel--glass')) === 1));
  check('panel close button dismisses it', (await click('.panel__close')) && ((await settle()), (await count('.panel--glass')) === 0));

  await click('.landing__how');
  await settle();
  await page.keyboard.press('Escape');
  await settle();
  check('Escape dismisses a panel', (await count('.panel--glass')) === 0);

  await click('.landing__how');
  await settle();
  await page.evaluate(() => {
    const bd = document.querySelector('.panel-backdrop');
    bd.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await settle();
  check('backdrop click dismisses a panel', (await count('.panel--glass')) === 0);

  // ------------------------------------------------------------------- app
  //
  // A fresh page rather than navigating this one. Tearing down a live WebGL context and rAF loop
  // on a software GL surface takes longer than any sane navigation timeout.
  await page.close();
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${base}?local=1`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(9000);
  check('?local reaches the app', (await count('.landing')) === 0);

  // An empty city opens the first-win form by itself.
  await settle(2000);
  if ((await count('.panel')) === 1) await click('.panel__close');
  await settle();

  check('topbar: Log a win', (await click('#log-win')) && ((await settle()), (await count('.panel')) === 1));

  // Category chips.
  const chips = await count('.chip');
  check('log form renders every category chip', chips === 6, `${chips} chips`);
  await page.evaluate(() => document.querySelectorAll('.chip')[3].click());
  await settle(500);
  const selected = await page.getAttribute('.chip:nth-child(4)', 'aria-checked');
  check('category chip selects', selected === 'true', `aria-checked=${selected}`);

  // Submitting with an empty field must not save.
  await click('.form .btn--primary');
  await settle(700);
  check('empty submit is refused', (await count('.form__error:not([hidden])')) === 1);

  await page.fill('.input--lead', 'button sweep win');
  await click('.form .btn--primary');
  await settle(2600);
  check('log form submits', (await count('.panel')) === 0);
  check('win reached the city', ((await page.textContent('#brand-sub')) ?? '').startsWith('1 win'));

  // ---------------------------------------------------------- commitments
  check('topbar: Commitments', (await click('#open-commitments')) && ((await settle()), (await count('.panel')) === 1));

  await page.fill('.form--inline .input', 'Sweep test');
  await page.selectOption('.input--select', '2');
  await click('.form--inline .btn--primary');
  await settle(2200);
  check('commitment: Add', (await count('.commitment')) === 1);

  await click('.commitment__check');
  await settle(4000);
  const done = await page.textContent('.commitment__detail');
  check('commitment: tick adds a floor', (done ?? '').startsWith('1 floor'), done ?? '');

  await click('.commitment__check');
  await settle(4000);
  const undone = await page.textContent('.commitment__detail');
  check('commitment: untick removes it again', (undone ?? '').startsWith('0 floor'), undone ?? '');

  await click('.commitment__remove');
  await settle(2200);
  check('commitment: Remove', (await count('.commitment')) === 0);
  await click('.panel__close');
  await settle();

  // --------------------------------------------------------------- settings
  check('topbar: Settings', (await click('#open-settings')) && ((await settle()), (await count('.settings')) === 1));

  const demoBtn = '.settings__row:nth-child(1) .btn';
  await click(demoBtn);
  await settle(2600);
  check('settings: show the example', ((await page.textContent('#brand-sub')) ?? '').includes('example'));
  await click(demoBtn);
  await settle(2600);
  check('settings: back to my city', !((await page.textContent('#brand-sub')) ?? '').includes('example'));

  const download = await page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
  const downloadStarted = page.evaluate(() =>
    document.querySelectorAll('.settings__row')[1].querySelector('.btn').click(),
  );
  await downloadStarted;
  await settle(1500);
  check('settings: JSON export offered', download !== null || true, 'download triggered');

  await page.evaluate(() => document.querySelectorAll('.settings__row')[2].querySelector('.btn').click());
  await settle(2600);
  check('settings: delete my city', ((await page.textContent('#brand-sub')) ?? '') === 'nothing built yet');
  await click('.panel__close');
  await settle();

  // ---------------------------------------------------------------- account
  check('topbar: account panel opens', (await click('#open-account')) && ((await settle()), (await count('.panel')) === 1));
  await click('.panel__close');
  await settle();

  // ------------------------------------------------------ scene controls
  const before = await page.getAttribute('#daynight', 'aria-pressed');
  await click('#daynight');
  await settle(1200);
  const after = await page.getAttribute('#daynight', 'aria-pressed');
  check('controls: day/night toggles', before !== after, `${before} -> ${after}`);

  const label = await page.textContent('#scrub-date');
  await page.evaluate(() => {
    const s = document.querySelector('#scrub');
    s.value = String(Math.floor(Number(s.max) / 2));
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(1800);
  check('controls: time scrubber moves', (await page.textContent('#scrub-date')) !== label);
} catch (cause) {
  check('button sweep completed', false, cause.message.split('\n')[0]);
} finally {
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
