/**
 * App entry point.
 *
 * Renders the 3D city by default. Append `?debug2d` to the URL for the top-down layout view with
 * its automated checks — that view stays in the build because when the city looks wrong, it is the
 * fastest way to tell a layout bug from a render bug.
 */

import './style.css';
import { buildDemoCity, describeDemoCity } from './data/seed';
import { layoutCity } from './layout/polar';
import { drawLayout } from './layout/debug2d';
import { checkDeterminism } from './layout/validate';
import { addDays, daysBetween, formatLongDate, todayISO } from './data/dates';
import { Viewer } from './scene/viewer';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const scrub = document.querySelector<HTMLInputElement>('#scrub')!;
const scrubDate = document.querySelector<HTMLSpanElement>('#scrub-date')!;

const city = buildDemoCity();
const today = todayISO();
const firstDate = city.entries.length > 0 ? city.entries[0].date : today;
const span = Math.max(1, daysBetween(firstDate, today));

console.log('%cHabitat — demo city', 'font-weight:600');
console.log(describeDemoCity(city));
console.log(
  checkDeterminism(layoutCity(buildDemoCity(), today), layoutCity(buildDemoCity(), today)),
);

scrub.min = '0';
scrub.max = String(span);
scrub.value = String(span);

const asOfFor = (value: number) => addDays(firstDate, value);

if (new URLSearchParams(location.search).has('debug2d')) {
  const render2d = () => {
    const asOf = asOfFor(Number(scrub.value));
    scrubDate.textContent = formatLongDate(asOf);
    const checks = drawLayout(canvas, layoutCity(city, asOf), { label: 'Layout check' });
    const failed = checks.filter((c) => !c.passed);
    if (failed.length > 0) {
      console.warn('Layout checks failed:', failed.map((c) => `${c.name} — ${c.detail}`));
    }
  };
  scrub.addEventListener('input', render2d);
  window.addEventListener('resize', render2d);
  render2d();
} else {
  const viewer = new Viewer(canvas);
  const full = layoutCity(city, today);
  viewer.setLayout(full);
  // Framed once against the finished city so scrubbing back in time never yanks the camera.
  viewer.frameCity(full);
  viewer.start();

  const render3d = () => {
    const asOf = asOfFor(Number(scrub.value));
    scrubDate.textContent = formatLongDate(asOf);
    viewer.setLayout(layoutCity(city, asOf));
  };
  scrub.addEventListener('input', render3d);
  scrubDate.textContent = formatLongDate(today);
}
