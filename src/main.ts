/**
 * App entry point.
 *
 * Renders the 3D city by default. Append `?debug2d` to the URL for the top-down layout view with
 * its automated checks — that view stays in the build because when the city looks wrong, it is the
 * fastest way to tell a layout bug from a render bug.
 */

import './style.css';
import * as THREE from 'three';
import { buildDemoCity } from './data/seed';
import { layoutCity } from './layout/polar';
import { drawLayout } from './layout/debug2d';
import { addDays, daysBetween, formatLongDate, todayISO } from './data/dates';
import { Viewer } from './scene/viewer';
import { Butterfly } from './scene/butterfly';
import { MemoryCard } from './ui/memoryCard';
import { openLogForm } from './ui/logForm';
import { openCommitments } from './ui/commitments';
import { openSettings } from './ui/settings';
import type { PickTarget } from './scene/city';
import type { CityData } from './data/types';
import {
  addCommitment,
  addEntry,
  deleteCommitment,
  getCity,
  isEmpty,
  logCommitment,
  unlogCommitment,
} from './data/store';

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const scrub = document.querySelector<HTMLInputElement>('#scrub')!;
const scrubDate = document.querySelector<HTMLSpanElement>('#scrub-date')!;
const brandSub = document.querySelector<HTMLSpanElement>('#brand-sub')!;

// --- app state -----------------------------------------------------------

/**
 * Demo data lives only in memory and is never written to IndexedDB, so seeded entries can never
 * contaminate a real city and there is nothing to clean up when the example is switched off.
 */
let demo = false;
let city: CityData = { entries: [], commitments: [], logs: [] };

async function loadCity(): Promise<CityData> {
  city = demo ? buildDemoCity() : await getCity();
  return city;
}

/** Days from the first entry to today, which is the scrubber's range. */
function span(): { first: string; days: number } {
  const today = todayISO();
  const dates = city.entries.map((e) => e.date).concat(city.logs.map((l) => l.date));
  const first = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : today;
  return { first, days: Math.max(1, daysBetween(first, today)) };
}

await loadCity();

if (new URLSearchParams(location.search).has('debug2d')) {
  if (city.entries.length === 0) {
    demo = true;
    await loadCity();
  }
  const render2d = () => {
    const { first, days } = span();
    scrub.min = '0';
    scrub.max = String(days);
    const asOf = addDays(first, Number(scrub.value));
    scrubDate.textContent = formatLongDate(asOf);
    drawLayout(canvas, layoutCity(city, asOf), { label: 'Layout check' });
  };
  scrub.addEventListener('input', render2d);
  window.addEventListener('resize', render2d);
  render2d();
} else {
  const viewer = new Viewer(canvas);
  const butterfly = new Butterfly();
  viewer.scene.add(butterfly.group);
  const card = new MemoryCard();

  let hovered: PickTarget | null = null;
  let framed = false;

  /** Rebuild the scene from whatever is currently in `city`. */
  function paint(options: { reframe?: boolean } = {}): void {
    const { first, days } = span();
    const atEnd = scrub.value === scrub.max || !framed;
    scrub.min = '0';
    scrub.max = String(days);
    if (atEnd) scrub.value = String(days);

    const asOf = addDays(first, Number(scrub.value));
    scrubDate.textContent = formatLongDate(asOf);

    const layout = layoutCity(city, asOf);
    viewer.setLayout(layout);

    // Framed once against the finished city, so scrubbing back never yanks the camera. Reframed
    // only when the city changes shape enough to warrant it.
    if (!framed || options.reframe) {
      viewer.frameCity(layoutCity(city, todayISO()));
      framed = true;
    }

    hovered = null;
    card.hide();
    paintBrand();
  }

  function paintBrand(): void {
    const wins = city.entries.length;
    if (demo) {
      brandSub.textContent = 'example city';
    } else if (wins === 0) {
      brandSub.textContent = 'nothing built yet';
    } else {
      brandSub.textContent = `${wins} win${wins === 1 ? '' : 's'}`;
    }
  }

  async function refresh(options: { reframe?: boolean } = {}): Promise<void> {
    await loadCity();
    paint(options);
  }

  paint();
  viewer.start();

  // --- pointer, butterfly, hover ----------------------------------------

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

  // Raycasting every frame against thousands of instances is wasteful and the result cannot
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
      desired.set(hovered.position.x, hovered.top + 1.6, hovered.position.z);
    } else if (pointerInside) {
      raycaster.setFromCamera(pointer, viewer.camera);
      if (raycaster.ray.intersectPlane(cruisePlane, cruisePoint)) {
        desired.set(cruisePoint.x, GROUND_HOVER, cruisePoint.z);
      }
    }

    butterfly.update(dt, elapsed, desired, hovered !== null);
  });

  // --- toolbar ----------------------------------------------------------

  document.querySelector<HTMLButtonElement>('#log-win')!.addEventListener('click', () => {
    openLogForm(async (result) => {
      if (demo) {
        demo = false; // logging always writes to the real city, never the example
      }
      await addEntry(result);
      await refresh({ reframe: true });
    });
  });

  document.querySelector<HTMLButtonElement>('#open-commitments')!.addEventListener('click', () => {
    openCommitments(city, {
      add: async (name, cadence) => {
        demo = false;
        await addCommitment({ name, cadence });
        await refresh({ reframe: true });
      },
      toggleToday: async (commitment, done) => {
        demo = false;
        if (done) await logCommitment(commitment.id);
        else await unlogCommitment(commitment.id, todayISO());
        await refresh();
      },
      remove: async (commitment) => {
        await deleteCommitment(commitment.id);
        await refresh({ reframe: true });
      },
      reload: async () => {
        await loadCity();
        paint();
        return city;
      },
    });
  });

  document.querySelector<HTMLButtonElement>('#open-settings')!.addEventListener('click', () => {
    openSettings({
      isDemo: () => demo,
      setDemo: async (value) => {
        demo = value;
        await refresh({ reframe: true });
      },
      reload: async () => {
        await refresh({ reframe: true });
      },
    });
  });

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

  scrub.addEventListener('input', () => {
    const { first } = span();
    const asOf = addDays(first, Number(scrub.value));
    scrubDate.textContent = formatLongDate(asOf);
    hovered = null;
    card.hide();
    viewer.setLayout(layoutCity(city, asOf));
  });

  // First run: offer the example rather than an empty plane.
  if (await isEmpty()) {
    demo = true;
    await refresh({ reframe: true });
    brandSub.textContent = 'example city — log a win to start your own';
  }
}
