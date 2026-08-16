/**
 * App entry point.
 *
 * Renders the 3D city by default. Append `?debug2d` to the URL for the top-down layout view with
 * its automated checks — that view stays in the build because when the city looks wrong, it is the
 * fastest way to tell a layout bug from a render bug.
 */

import './style.css';
import * as THREE from 'three';
import { buildDemoCity, buildSeededCity } from './data/seed';
import { layoutCity } from './layout/polar';
import { drawLayout } from './layout/debug2d';
import { drawComparison } from './layout/compare';
import { drawSunflowerExplainer } from './layout/explain';
import { layoutIslands } from './layout/islands';
import { drawIslands } from './layout/debugIslands';
import { addDays, daysBetween, formatLongDate, todayISO } from './data/dates';
import { Viewer, type TimeOfDay } from './scene/viewer';
import { Butterfly } from './scene/butterfly';
import { MemoryCard } from './ui/memoryCard';
import { openLogForm } from './ui/logForm';
import { openCommitments } from './ui/commitments';
import { openSettings } from './ui/settings';
import { openAccount } from './ui/account';
import { openLanding } from './ui/landing';
import {
  currentSession,
  displayName,
  isConfigured,
  onAuthChange,
  signInWithGoogle,
} from './data/supabase';
import { syncCity } from './data/sync';
import type { Session } from '@supabase/supabase-js';
import type { PickTarget } from './scene/city';
import type { CityData } from './data/types';
import {
  addCommitment,
  addEntry,
  deleteCommitment,
  getCity,
  importCity,
  isEmpty,
  logCommitment,
  unlogCommitment,
  wipeCity,
} from './data/store';

/**
 * Read once, up front. The seeding path rewrites the URL when it finishes, so anything reading
 * `location.search` later would see flags that have already been stripped.
 */
const params = new URLSearchParams(location.search);

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

if (params.has('islands')) {
  // Verify island and sector placement as 2D dots before any of it is rendered in 3D.
  if (city.entries.length < 200) city = buildDemoCity();
  scrub.min = '0';
  scrub.max = String(span().days);
  scrub.value = scrub.max;
  const render = () => {
    const asOf = addDays(span().first, Number(scrub.value));
    scrubDate.textContent = formatLongDate(asOf);
    const checks = drawIslands(canvas, layoutIslands(city, asOf));
    const failed = checks.filter((c) => !c.passed);
    if (failed.length > 0) {
      console.warn('Island checks failed:', failed.map((c) => `${c.name} — ${c.detail}`));
    }
  };
  scrub.addEventListener('input', render);
  window.addEventListener('resize', render);
  render();
} else if (params.has('sunflower')) {
  // A visual answer to "do the buildings get bigger further out?" — they do not, and this draws
  // them at true footprint so that is verifiable rather than asserted.
  if (city.entries.length < 200) city = buildDemoCity();
  const render = () => drawSunflowerExplainer(canvas, city);
  window.addEventListener('resize', render);
  render();
} else if (params.has('compare')) {
  // Layout candidates side by side, against real data. 2D renders in milliseconds where the 3D
  // city takes minutes, so this is the right place to judge a spatial question.
  if (city.entries.length < 200) city = buildDemoCity();
  // Range before value: setting value first clamps it against the stale max from the markup.
  scrub.min = '0';
  scrub.max = String(span().days);
  scrub.value = scrub.max;

  const render = () => {
    const asOf = addDays(span().first, Number(scrub.value));
    scrubDate.textContent = formatLongDate(asOf);
    drawComparison(canvas, city, asOf);
  };
  scrub.addEventListener('input', render);
  window.addEventListener('resize', render);
  render();
} else if (params.has('debug2d')) {
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

    butterfly.update(dt, elapsed, desired, hovered !== null, viewer.camera);
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

  // --- account ----------------------------------------------------------

  const accountButton = document.querySelector<HTMLButtonElement>('#open-account')!;
  let session: Session | null = await currentSession();
  let landing: { close: () => void } | null = null;

  function paintAccount(): void {
    accountButton.hidden = !isConfigured();
    accountButton.textContent = session ? displayName(session).split(' ')[0] : 'Sign in';
  }
  paintAccount();

  accountButton.addEventListener('click', () => {
    openAccount({
      session: () => session,
      onSynced: async () => {
        demo = false;
        await refresh({ reframe: true });
      },
    });
  });

  onAuthChange(async (next) => {
    const signedIn = !session && next;
    const signedOut = Boolean(session) && !next;
    session = next;
    paintAccount();

    if (signedOut) {
      // Clear the device on the way out. The city is safe in the account, and leaving it here
      // would mean the next person to sign in on this browser has a stranger's entries merged
      // into their own account by the additive sync.
      await wipeCity();
      await showLanding();
      return;
    }
    // Merge on sign-in so the city built before an account existed is carried up rather than
    // being replaced by an empty one.
    if (signedIn && next) {
      try {
        await syncCity(next.user.id);
      } catch (cause) {
        console.warn('Sync after sign-in failed:', cause);
      }
      // Closing the landing runs its dismissal callback, which reveals the app, drops the
      // example, and opens the first-win form if there is nothing built yet.
      if (landing) {
        landing.close();
        landing = null;
      } else {
        demo = false;
        await refresh({ reframe: true });
      }
    }
  });

  // --- day / night ------------------------------------------------------

  const modeButtons = [
    ...document.querySelectorAll<HTMLButtonElement>('#timeofday button'),
  ];
  let mode: TimeOfDay = 'night';

  function setMode(next: TimeOfDay): void {
    mode = next;
    viewer.setTimeOfDay(mode);
    for (const button of modeButtons) {
      const selected = button.dataset.mode === mode;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.mode as TimeOfDay));
  }
  setMode(mode);

  // --- time scrubber ----------------------------------------------------

  scrub.addEventListener('input', () => {
    const { first } = span();
    const asOf = addDays(first, Number(scrub.value));
    scrubDate.textContent = formatLongDate(asOf);
    hovered = null;
    card.hide();
    viewer.setLayout(layoutCity(city, asOf));
  });

  // --- staging a full city for a demo recording -------------------------
  //
  // `?seed` writes a complete eighteen-month city into this browser as ordinary entries, then
  // pushes it to the signed-in account so it is there on any device. Explicit and confirmed,
  // never automatic — it is a recording aid, not a feature.

  if (params.has('seed')) {
    const staged = buildSeededCity();
    const ok = window.confirm(
      `Add ${staged.entries.length} wins and ${staged.commitments.length} commitments to this city?\n\n` +
        'They become ordinary entries you own. Use Settings to remove them again.',
    );
    if (ok) {
      await importCity(JSON.stringify(staged));
      if (session) {
        try {
          await syncCity(session.user.id);
        } catch (cause) {
          console.warn('Could not push the staged city to your account:', cause);
          window.alert(
            'The city was built in this browser, but could not reach your account. Check the Supabase redirect URLs and try Sync now from the account menu.',
          );
        }
      }
      demo = false;
      await refresh({ reframe: true });
      // Drop the parameter so a refresh does not stage a second copy.
      history.replaceState(null, '', location.pathname);
    }
  }

  // --- landing ----------------------------------------------------------
  //
  // Shown whenever nobody is signed in. The background is the example city, purely so the scene
  // has something in it — it is scenery behind the sign-in door, never offered as a destination.

  const topbar = document.querySelector<HTMLElement>('#topbar')!;
  const controlsBar = document.querySelector<HTMLElement>('#controls')!;

  function revealApp(): void {
    topbar.style.transition = 'opacity 500ms ease';
    controlsBar.style.transition = 'opacity 500ms ease';
    topbar.style.opacity = '1';
    controlsBar.style.opacity = '1';
    viewer.restoreAppView(layoutCity(city, todayISO()));
  }

  // `?local` skips the sign-in door and uses the app purely on-device. It exists for automated
  // tests and development, which otherwise cannot get past an OAuth redirect. It grants no access
  // to anything — there is no protected data on this side of the door, only sync.
  const skipLanding = params.has('local');

  // Declared, not assigned, so it can be called from the auth handler above on sign-out.
  async function showLanding(): Promise<void> {
    if (landing) return;
    topbar.style.opacity = '0';
    controlsBar.style.opacity = '0';

    demo = true;
    await refresh();

    // Sunset behind the landing copy. The low camera is the only framing where the sky is on
    // screen at all, so the landing forces day mode whatever the app is set to.
    setMode('sunset');
    viewer.cinematicView(layoutCity(city, todayISO()));

    landing = openLanding({
      onSignIn: () => signInWithGoogle(),
      onContinueLocally: async () => {
        landing = null;
        demo = false;
        await refresh({ reframe: true });
        revealApp();
        if (await isEmpty()) {
          document.querySelector<HTMLButtonElement>('#log-win')!.click();
        }
      },
    });
  }

  if (!session && !skipLanding) {
    await showLanding();
  } else if (await isEmpty()) {
    // Signed in with nothing built yet: go straight to the first win rather than an empty plane.
    document.querySelector<HTMLButtonElement>('#log-win')!.click();
  }
}
