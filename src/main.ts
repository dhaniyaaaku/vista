/**
 * Temporary debug harness.
 *
 * Phase 2 of the build: verify the layout algorithm in 2D before any Three.js exists. This file
 * gets replaced by the real app entry point once the city is standing in grey boxes.
 */

import './style.css';
import { buildDemoCity, describeDemoCity } from './data/seed';
import { layoutCity } from './layout/polar';
import { drawLayout } from './layout/debug2d';
import { checkDeterminism } from './layout/validate';
import { addDays, formatLongDate, todayISO } from './data/dates';

const DEMO_DAYS = 182;

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const scrub = document.querySelector<HTMLInputElement>('#scrub')!;
const scrubDate = document.querySelector<HTMLSpanElement>('#scrub-date')!;

const city = buildDemoCity();
const today = todayISO();
const start = addDays(today, -DEMO_DAYS);

console.log('%cHabitat — demo city', 'font-weight:600');
console.log(describeDemoCity(city));

// Determinism has to hold across independent runs, not just repeated reads of one result.
console.log(
  checkDeterminism(layoutCity(buildDemoCity(), today), layoutCity(buildDemoCity(), today)),
);

function render(): void {
  const dayOffset = Number(scrub.value);
  const asOf = addDays(start, dayOffset);
  scrubDate.textContent = formatLongDate(asOf);
  const layout = layoutCity(city, asOf);
  const checks = drawLayout(canvas, layout, { label: 'Layout check' });
  const failed = checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    console.warn(
      'Layout checks failed:',
      failed.map((c) => `${c.name} — ${c.detail}`),
    );
  }
}

scrub.max = String(DEMO_DAYS);
scrub.value = String(DEMO_DAYS);
scrub.addEventListener('input', render);
window.addEventListener('resize', render);
render();
