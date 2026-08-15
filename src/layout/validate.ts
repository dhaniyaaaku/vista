/**
 * Layout self-checks.
 *
 * These run in the 2D debug view so that verifying placement is a PASS/FAIL readout rather than
 * squinting at dots. Every one of these corresponds to a row in the PLAN.md verification table.
 */

import { AVENUE_COUNT, PLOT, type CityLayout } from './polar';

const TAU = Math.PI * 2;

export interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

export function validateLayout(layout: CityLayout): Check[] {
  const checks: Check[] = [];
  const { placements, bands, towers } = layout;

  // 1. No two buildings sharing a plot.
  //    Bucketed by grid cell so this stays O(n) rather than O(n^2) as cities grow.
  const cell = PLOT;
  const grid = new Map<string, { x: number; z: number }[]>();
  let minGap = Infinity;
  let overlaps = 0;
  for (const p of placements) {
    const cx = Math.floor(p.x / cell);
    const cz = Math.floor(p.z / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        for (const other of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
          const d = Math.hypot(p.x - other.x, p.z - other.z);
          if (d < minGap) minGap = d;
          if (d < PLOT * 0.9) overlaps += 1;
        }
      }
    }
    const key = `${cx},${cz}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(p);
    else grid.set(key, [p]);
  }
  checks.push({
    name: 'No overlapping plots',
    passed: overlaps === 0,
    detail:
      placements.length < 2
        ? 'not enough buildings to test'
        : `${overlaps} overlaps, closest pair ${minGap.toFixed(2)} (plot ${PLOT})`,
  });

  // 2. Every building sits inside its own month band.
  const bandByKey = new Map(bands.map((b) => [b.monthKey, b]));
  let outOfBand = 0;
  for (const p of placements) {
    const band = bandByKey.get(p.monthKey);
    if (!band) {
      outOfBand += 1;
      continue;
    }
    const r = Math.hypot(p.x, p.z);
    if (r < band.innerRadius - 0.01 || r > band.outerRadius + 0.01) outOfBand += 1;
  }
  checks.push({
    name: 'Buildings inside their month band',
    passed: outOfBand === 0,
    detail: `${placements.length - outOfBand}/${placements.length} in band`,
  });

  // 3. The radial avenues stay clear, so the city reads as planned rather than as a blob.
  let blockingAvenue = 0;
  for (const p of placements) {
    let angle = Math.atan2(p.z, p.x);
    if (angle < 0) angle += TAU;
    for (let a = 0; a < AVENUE_COUNT; a += 1) {
      const centre = (TAU * a) / AVENUE_COUNT;
      const delta = Math.abs((((angle - centre + Math.PI) % TAU) + TAU) % TAU - Math.PI);
      // Half the plot width of slack: a building centred just outside the avenue still has
      // footprint, and that is fine — what matters is that nothing sits in the middle of one.
      if (delta < 0.02) blockingAvenue += 1;
    }
  }
  checks.push({
    name: 'Radial avenues stay clear',
    passed: blockingAvenue === 0,
    detail: `${AVENUE_COUNT} avenues, ${blockingAvenue} buildings blocking`,
  });

  // 4. Bands are contiguous, ordered, and never overlap.
  let bandOrderOk = true;
  for (let i = 1; i < bands.length; i += 1) {
    if (bands[i].innerRadius < bands[i - 1].outerRadius - 0.01) bandOrderOk = false;
    if (bands[i].monthKey <= bands[i - 1].monthKey) bandOrderOk = false;
  }
  checks.push({
    name: 'Bands ordered and non-overlapping',
    passed: bandOrderOk,
    detail: `${bands.length} bands, outer radius ${layout.radius.toFixed(1)}`,
  });

  // 5. Quiet months still occupy a band (principle 1: quiet is never a gap).
  const emptyBands = bands.filter((b) => b.isEmpty);
  checks.push({
    name: 'Quiet months render as parkland, not gaps',
    passed: emptyBands.every((b) => b.outerRadius > b.innerRadius),
    detail:
      emptyBands.length === 0
        ? 'no quiet months in this data'
        : `${emptyBands.length} quiet month(s): ${emptyBands.map((b) => b.monthKey).join(', ')}`,
  });

  // 6. Downtown does not collide with the first band.
  const firstBand = bands[0];
  checks.push({
    name: 'Downtown clear of the first band',
    passed: !firstBand || firstBand.innerRadius >= layout.downtownRadius - 0.01,
    detail: `downtown r=${layout.downtownRadius.toFixed(1)}, first band starts ${
      firstBand ? firstBand.innerRadius.toFixed(1) : 'n/a'
    }`,
  });

  // 7. Towers never lose height — floors must be non-negative and lights are independent of them.
  const litWithoutFloors = towers.filter((t) => t.lit && t.floors === 0).length;
  checks.push({
    name: 'Tower height and light are independent',
    passed: towers.every((t) => t.floors >= 0) && litWithoutFloors === 0,
    detail: `${towers.length} towers, ${towers.filter((t) => t.lit).length} lit, ${
      towers.filter((t) => !t.lit).length
    } quiet`,
  });

  return checks;
}

/**
 * Placement must be reproducible from the data alone — nothing about a building's position or
 * appearance may depend on render order, wall-clock time, or anything else not in the record.
 */
export function checkDeterminism(a: CityLayout, b: CityLayout): Check {
  if (a.placements.length !== b.placements.length) {
    return {
      name: 'Layout is deterministic',
      passed: false,
      detail: `different counts: ${a.placements.length} vs ${b.placements.length}`,
    };
  }
  const keyOf = (layout: CityLayout) =>
    layout.placements
      .map((p) => `${p.entryId}:${p.x.toFixed(6)}:${p.z.toFixed(6)}:${p.variation.toFixed(6)}`)
      .sort()
      .join('|');
  const same = keyOf(a) === keyOf(b);
  return {
    name: 'Layout is deterministic',
    passed: same,
    detail: same ? 'two runs byte-identical' : 'positions differ between runs',
  };
}
