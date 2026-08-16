/**
 * App entry point.
 *
 * Renders the 3D city by default. Append `?debug2d` to the URL for the top-down layout view with
 * its automated checks — that view stays in the build because when the city looks wrong, it is the
 * fastest way to tell a layout bug from a render bug.
 */

import './style.css';
import * as THREE from 'three';
import { buildDemoCity, describeDemoCity } from './data/seed';
import { layoutCity } from './layout/polar';
import { drawLayout } from './layout/debug2d';
import { checkDeterminism } from './layout/validate';
import { addDays, daysBetween, formatLongDate, todayISO } from './data/dates';
import { Viewer } from './scene/viewer';
import { Butterfly } from './scene/butterfly';
import { MemoryCard } from './ui/memoryCard';
import type { PickTarget } from './scene/city';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const scrub = document.querySelector<HTMLInputElement>('#scrub')!;
const scrubDate = document.querySelector<HTMLSpanElement>('#scrub-date')!;

const city = buildDemoCity();
const today = todayISO();
const firstDate = city.entries.length > 0 ? city.entries[0].date : today;
const span = Math.max(1, daysBetween(firstDate, today));

console.log('%cVista — demo city', 'font-weight:600');
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

  const butterfly = new Butterfly();
  viewer.scene.add(butterfly.group);

  const card = new MemoryCard();

  // --- pointer tracking -------------------------------------------------

  const pointer = new THREE.Vector2(0, 0);
  const screen = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  let pointerInside = false;

  const raycaster = new THREE.Raycaster();
  // Ground plane. When the cursor is over open street rather than a building, the butterfly
  // drops to just above the ground and flies between the buildings.
  const cruisePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const GROUND_HOVER = 2.6;
  const cruisePoint = new THREE.Vector3();
  const desired = new THREE.Vector3(0, 20, 0);
  let hovered: PickTarget | null = null;

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    screen.x = event.clientX;
    screen.y = event.clientY;
    pointerInside = true;
  });

  canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
    hovered = null;
    card.hide();
  });

  // Raycasting every frame against two thousand instances is wasteful and the result cannot
  // change faster than the eye can follow, so it runs on a fixed interval instead.
  let sincePick = 0;

  viewer.onTick((dt, elapsed) => {
    sincePick += dt;
    if (pointerInside && sincePick > 0.06) {
      sincePick = 0;
      raycaster.setFromCamera(pointer, viewer.camera);
      const hits = raycaster.intersectObjects(viewer.city.pickables, false);
      const hit = hits.find((h) => h.instanceId !== undefined);
      hovered =
        hit && hit.instanceId !== undefined
          ? viewer.city.targetFor(hit.object as THREE.InstancedMesh, hit.instanceId)
          : null;

      if (hovered) card.show(hovered, screen.x, screen.y);
      else card.hide();
    }

    if (hovered) {
      // Settle onto the roof of whatever is under the cursor.
      desired.set(hovered.position.x, hovered.top + 1.6, hovered.position.z);
    } else if (pointerInside) {
      raycaster.setFromCamera(pointer, viewer.camera);
      if (raycaster.ray.intersectPlane(cruisePlane, cruisePoint)) {
        desired.set(cruisePoint.x, GROUND_HOVER, cruisePoint.z);
      }
    }

    butterfly.update(dt, elapsed, desired, hovered !== null);
  });

  viewer.start();

  // --- day / night ------------------------------------------------------

  const dayNight = document.querySelector<HTMLButtonElement>('#daynight')!;
  let mode: 'day' | 'night' = 'night';
  viewer.setTimeOfDay(mode);
  dayNight.addEventListener('click', () => {
    mode = mode === 'night' ? 'day' : 'night';
    viewer.setTimeOfDay(mode);
    dayNight.textContent = mode === 'night' ? 'Day' : 'Night';
    dayNight.setAttribute('aria-pressed', String(mode === 'day'));
  });

  // --- time scrubber ----------------------------------------------------

  const render3d = () => {
    const asOf = asOfFor(Number(scrub.value));
    scrubDate.textContent = formatLongDate(asOf);
    // The city is rebuilt, so any hovered target now points at a discarded mesh.
    hovered = null;
    card.hide();
    viewer.setLayout(layoutCity(city, asOf));
  };
  scrub.addEventListener('input', render3d);
  scrubDate.textContent = formatLongDate(today);
}
