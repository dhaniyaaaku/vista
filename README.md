# Vista

**A city that builds itself out of the things you actually did.**

Every win you log becomes a permanent structure. Over months the city grows, and flying over it
later surfaces things you'd forgotten you did.

It's a memory palace, not a habit tracker. Nobody is being scored.

Built for the CS Girlies hackathon, Wellness track.

---

## The idea

Most habit apps are built on guilt. Miss a day and your plant dies, your streak resets to zero, your
tree burns down. That mechanic is a known harm vector — it punishes people hardest exactly when
they're least able to cope with it.

Vista is built on the opposite rule: **nothing is ever destroyed.**

- **Height is permanent record.** A commitment's tower gains one floor per completion and never
  loses one. Six months in, the tower is a record of everything you did, including the stretch you'd
  rather forget.
- **Light is current state.** Whether a tower's windows are lit reflects whether you're keeping it
  *now*. Dark windows mean quiet, not failed.
- **Quiet months become parkland.** A month with nothing logged still gets its ring in the city —
  rendered as open green space rather than deleted from the timeline.

The city is always at night, so the lights mean something.

## How the city is laid out

The layout uses polar coordinates, with each axis carrying one meaning:

**Distance from centre is time. Angle is category.**

- Downtown sits at the origin and holds one skyscraper per recurring commitment.
- Around it the city grows outward in one band per calendar month, newest at the edge.
- Band width is proportional to how much was logged that month, so the city ends up with visible
  growth rings, like a tree. A wide band was a full month.
- Within a band, each category owns a fixed 60° wedge — so parks cluster on one spoke, houses on
  another.

You get two readings out of one layout: scan outward to move through time, scan around to browse by
kind.

Building positions are never stored. A plot is decided by the building's index within its
(month, category) group, and groups sort by date — so the layout is fully reproducible from the
records alone, and the time scrubber can replay the city rising without anything shifting
underneath.

## Cadence

Commitments aren't all daily. Each one declares its own frequency — `{ times: 2, per: 'month' }` for
volunteering, `{ times: 1, per: 'day' }` for a workout.

One completion is one floor regardless of cadence. What the cadence changes is the grace window
before the lights go out:

```
graceDays = ceil(periodDays / times) * 2
```

A daily habit goes dark after two quiet days. A twice-monthly one has thirty days. The window scales
to what you actually committed to, which is the only way "you've gone quiet" can mean anything fair
across different frequencies.

## Privacy

The app is hosted publicly. **Your data is not.**

Everything lives in your own browser via IndexedDB and is never uploaded. Everyone who visits gets
the same app and their own private city. Same architecture as Excalidraw or tldraw — open the
network tab and watch nothing leave.

The honest tradeoff: browser storage is per-browser and per-device, so your phone shows an empty
city and clearing browser data loses it. Export to JSON is the backup. Accounts and sync are the
proper fix and are planned, not shipped.

## Running it

```bash
npm install
npm run dev
```

- `http://localhost:5173` — the city
- `http://localhost:5173/?debug2d` — top-down layout view with automated placement checks

```bash
npm run build     # production build
node scripts/shot.mjs shots/city.png    # headless screenshot, for checking visual changes
```

## Project structure

```
src/
  data/       model, IndexedDB store, cadence logic, demo city generator
  layout/     polar layout as pure functions, plus a 2D debug renderer and its checks
  scene/      Three.js city, camera, lighting
  ui/         log form, memory card, scrubber
```

`src/layout/polar.ts` imports nothing from Three.js on purpose. Placement is verified as 2D dots
before it is ever rendered in 3D — debugging a layout bug in a 3D scene is miserable, and debugging
it as dots takes minutes.

`src/data/store.ts` is the only module that touches persistence. Swapping IndexedDB for an API when
accounts land changes one file.

## Status

In progress. Working: data model, cadence logic, polar layout with automated verification, and the
3D city with a working time scrubber. Next: night lighting, the butterfly cursor, hover-to-remember,
and the log form.

See [PLAN.md](PLAN.md) for the full spec and build plan.
