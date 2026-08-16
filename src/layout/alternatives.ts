/**
 * Candidate replacements for the concentric-month layout.
 *
 * The problem being solved: a ring's capacity grows with its circumference, so linearly with
 * radius, while monthly logging volume stays roughly flat. One ring per month therefore gets
 * progressively emptier forever — not a tuning issue, a structural one.
 *
 * Both of these are index-based and deterministic, so the time scrubber keeps working: filtering
 * to a date yields a prefix, and every already-placed building keeps its plot.
 */

import type { CityData, Entry } from '../data/types';
import { CATEGORY_BY_ID } from '../data/types';
import { monthKey, todayISO } from '../data/dates';
import { floorsFor, isLit, lastLogDate } from '../data/cadence';
import { rngFor } from '../util/random';
import {
  DOWNTOWN_MARGIN,
  PLOT,
  TOWER_SPACING,
  type Band,
  type CityLayout,
  type Placement,
  type TowerPlacement,
} from './polar';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function downtown(city: CityData, asOf: string): { towers: TowerPlacement[]; radius: number } {
  const commitments = [...city.commitments].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
  const logsUpTo = city.logs.filter((l) => l.date <= asOf);

  const towers = commitments.map((commitment, i) => {
    const r = TOWER_SPACING * Math.sqrt(i + 0.5);
    const angle = i * GOLDEN_ANGLE;
    const rng = rngFor(commitment.id);
    const last = lastLogDate(logsUpTo, commitment.id);
    const { times, per } = commitment.cadence;
    return {
      commitmentId: commitment.id,
      name: commitment.name,
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      floors: floorsFor(city.logs, commitment.id, asOf),
      lit: isLit(commitment.cadence, last, asOf),
      rotation: rng() * TAU,
      variation: rng(),
      cadenceLabel: times === 1 ? `once a ${per}` : `${times}x a ${per}`,
      lastLog: last,
    } satisfies TowerPlacement;
  });

  const radius =
    commitments.length === 0
      ? DOWNTOWN_MARGIN
      : TOWER_SPACING * Math.sqrt(commitments.length + 0.5) + DOWNTOWN_MARGIN;

  return { towers, radius };
}

/**
 * Sunflower packing.
 *
 * `radius = c * sqrt(index)` with a golden-angle turn between entries. Because area grows in step
 * with the index, every entry owns exactly the same patch of ground — so density is identical at
 * the centre and at the rim, at any city size.
 *
 * `c` is derived rather than guessed. Each point owns area pi*c^2; hexagonal packing puts nearest
 * neighbours at 1.075*sqrt(area), so c = PLOT / (1.075 * sqrt(pi)) keeps them one plot apart.
 */
export function layoutSunflower(city: CityData, asOf: string = todayISO()): CityLayout {
  const entries = sortEntries(city.entries.filter((e) => e.date <= asOf));
  const { towers, radius: downtownRadius } = downtown(city, asOf);

  // Solve for radius from area rather than offsetting a sqrt curve.
  //
  // We want the ground between downtown and radius r to grow in exact proportion to the number of
  // entries placed: pi * (r^2 - R0^2) = i * A. Writing it as `R0 + c*sqrt(i)` instead looks right
  // but is not — the offset inflates the inner area, leaving the middle of the city measurably
  // emptier than its edge.
  const areaPerEntry = 0.9 * PLOT * PLOT;
  const radiusFor = (i: number) =>
    Math.sqrt(downtownRadius * downtownRadius + ((i + 0.5) * areaPerEntry) / Math.PI);

  const placements: Placement[] = entries.map((entry, i) => {
    const r = radiusFor(i);
    const angle = i * GOLDEN_ANGLE;
    const meta = CATEGORY_BY_ID[entry.category];
    const rng = rngFor(entry.id);
    return {
      entryId: entry.id,
      category: entry.category,
      kind: meta.structure,
      text: entry.text,
      date: entry.date,
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      rotation: angle + Math.PI / 2 + (rng() - 0.5) * 0.3,
      variation: rng(),
      monthKey: monthKey(entry.date),
    };
  });

  // Months become rings drawn on the ground at the radius where each one began, so the calendar
  // stays readable even though buildings no longer sit in physical bands.
  const bands: Band[] = [];
  let seen = 0;
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(monthKey(entry.date), (counts.get(monthKey(entry.date)) ?? 0) + 1);
  for (const [key, count] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const inner = radiusFor(seen);
    seen += count;
    bands.push({
      monthKey: key,
      innerRadius: inner,
      outerRadius: radiusFor(seen),
      entryCount: count,
      isEmpty: false,
    });
  }

  const radius = placements.length === 0 ? downtownRadius : radiusFor(entries.length);
  return { towers, placements, bands, downtownRadius, radius };
}

/**
 * Year rings, month wedges.
 *
 * One band per calendar year, divided into twelve 30-degree wedges. A ring now has a year of
 * content to fill instead of a month, so it holds up about twelve times longer before thinning —
 * and each band grows as wide as its busiest month needs, so what is there stays packed.
 */
export function layoutYearRings(city: CityData, asOf: string = todayISO()): CityLayout {
  const entries = sortEntries(city.entries.filter((e) => e.date <= asOf));
  const { towers, radius: downtownRadius } = downtown(city, asOf);

  const placements: Placement[] = [];
  const bands: Band[] = [];
  if (entries.length === 0) {
    return { towers, placements, bands, downtownRadius, radius: downtownRadius };
  }

  // year -> month index -> entries
  const byYear = new Map<string, Map<number, Entry[]>>();
  for (const entry of entries) {
    const year = entry.date.slice(0, 4);
    const month = Number(entry.date.slice(5, 7)) - 1;
    let months = byYear.get(year);
    if (!months) {
      months = new Map();
      byYear.set(year, months);
    }
    const bucket = months.get(month);
    if (bucket) bucket.push(entry);
    else months.set(month, [entry]);
  }

  const WEDGE = TAU / 12;
  const GUTTER = 0.03;
  let inner = downtownRadius;

  for (const year of [...byYear.keys()].sort()) {
    const months = byYear.get(year)!;
    let rowsNeeded = 1;

    // Lay each month into its own wedge, filling rows outward until that month is placed.
    for (const [month, list] of months) {
      let row = 0;
      let i = 0;
      while (i < list.length && row < 400) {
        const r = inner + PLOT * (row + 0.5);
        const span = WEDGE - GUTTER * 2;
        const cols = Math.max(1, Math.floor((r * span) / PLOT));
        for (let k = 0; k < cols && i < list.length; k += 1) {
          const entry = list[i];
          const angle = WEDGE * month + GUTTER + ((k + 0.5) * PLOT) / r;
          const meta = CATEGORY_BY_ID[entry.category];
          const rng = rngFor(entry.id);
          placements.push({
            entryId: entry.id,
            category: entry.category,
            kind: meta.structure,
            text: entry.text,
            date: entry.date,
            x: Math.cos(angle) * r,
            z: Math.sin(angle) * r,
            rotation: angle + Math.PI / 2 + (rng() - 0.5) * 0.25,
            variation: rng(),
            monthKey: monthKey(entry.date),
          });
          i += 1;
        }
        row += 1;
      }
      rowsNeeded = Math.max(rowsNeeded, row);
    }

    const width = rowsNeeded * PLOT;
    bands.push({
      monthKey: year,
      innerRadius: inner,
      outerRadius: inner + width,
      entryCount: [...months.values()].reduce((n, l) => n + l.length, 0),
      isEmpty: false,
    });
    inner += width + PLOT;
  }

  return {
    towers,
    placements,
    bands,
    downtownRadius,
    radius: bands.length > 0 ? bands[bands.length - 1].outerRadius : downtownRadius,
  };
}
