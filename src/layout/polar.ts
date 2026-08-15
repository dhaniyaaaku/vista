/**
 * City layout. Pure functions, zero Three.js — debugging placement as 2D dots takes minutes,
 * debugging it in 3D takes hours.
 *
 * The scheme, from PLAN.md:
 *   distance from centre = time,  angle = category
 *
 * Downtown sits at the origin and holds one skyscraper per commitment. Around it the city grows
 * outward in one band per calendar month, newest at the edge, band width proportional to how much
 * was logged that month — so the city ends up with tree rings. Within a band, each category owns a
 * fixed 60-degree wedge.
 *
 * Stability under the time scrubber falls out of the design rather than needing special handling:
 * a building's plot is decided by its index within its (month, category) group, and groups are
 * sorted by (date, id). Filtering to `asOf` therefore always yields a *prefix* of the full group,
 * so every already-placed building keeps its plot and only the outermost band grows.
 */

import type {
  Category,
  CityData,
  Commitment,
  Entry,
  StructureKind,
} from '../data/types';
import { CATEGORY_BY_ID, WEDGE_COUNT } from '../data/types';
import { enumerateMonths, monthKey, todayISO } from '../data/dates';
import { floorsFor, isLit, lastLogDate } from '../data/cadence';
import { rngFor } from '../util/random';

// --- tuning constants, shared with the 3D scene --------------------------

/** Footprint of one plot, in world units. Everything else is derived from this. */
export const PLOT = 3;
/** Distance between neighbouring downtown towers. */
export const TOWER_SPACING = 5.2;
/** Clear ring between downtown and the first time band. */
export const DOWNTOWN_MARGIN = 8;
/** Gap between adjacent month bands — reads as a ring road. */
export const BAND_GAP = 2.2;
/** Minimum width of a band that has entries. */
export const BAND_MIN = PLOT * 2;
/** Width of a month with nothing logged. Rendered as open parkland, never as a gap. */
export const BAND_EMPTY = PLOT * 1.4;
/** Angular gutter between category wedges, so districts read as separate. */
export const WEDGE_GUTTER = 0.05;
/**
 * Widest a single row of a district may get before it wraps to the next row out.
 *
 * Without this, a month's entries smear into one thin arc across the whole wedge — the outer
 * bands have enough arc length for twenty-odd plots, so a district of eight buildings reads as a
 * sparse streak. Capping the row forces compact blocks that read as neighbourhoods instead.
 * It depends only on the cap, never on how many entries exist, so plots stay stable.
 */
export const BLOCK_COLS = 7;

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// --- output types --------------------------------------------------------

export interface Placement {
  entryId: string;
  category: Category;
  kind: StructureKind;
  text: string;
  date: string;
  x: number;
  z: number;
  /** Y rotation in radians. */
  rotation: number;
  /** Stable per-building noise in [0,1) for height jitter, roof style, colour variation. */
  variation: number;
  /** Which month band this sits in — lets the scrubber fade a whole band at once. */
  monthKey: string;
}

export interface TowerPlacement {
  commitmentId: string;
  name: string;
  x: number;
  z: number;
  /** Cumulative completions. Never decreases. */
  floors: number;
  /** Whether the commitment is currently being kept. Drives window lights only. */
  lit: boolean;
  rotation: number;
  variation: number;
  cadenceLabel: string;
  lastLog: string | null;
}

export interface Band {
  monthKey: string;
  innerRadius: number;
  outerRadius: number;
  entryCount: number;
  /** No entries that month. Renders as parkland. */
  isEmpty: boolean;
}

export interface CityLayout {
  towers: TowerPlacement[];
  placements: Placement[];
  bands: Band[];
  downtownRadius: number;
  /** Outer extent of the whole city, for framing the camera. */
  radius: number;
}

// --- helpers -------------------------------------------------------------

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Angular span of one category wedge, minus its gutters. */
function wedgeSpan(): number {
  return TAU / WEDGE_COUNT - WEDGE_GUTTER * 2;
}

function wedgeStart(wedge: number): number {
  return (TAU / WEDGE_COUNT) * wedge + WEDGE_GUTTER;
}

/** How many plots a row holds — arc capacity at this radius, capped to keep blocks compact. */
function colsAtRadius(radius: number): number {
  const fits = Math.floor((radius * wedgeSpan()) / PLOT);
  return Math.max(1, Math.min(fits, BLOCK_COLS));
}

/**
 * Width a band needs so that its busiest category fits.
 *
 * Rows are laid inner-to-outer at PLOT intervals; each row holds however many plots fit across
 * the arc at its own radius, so outer rows hold more. Grow until the busiest wedge fits.
 */
function bandWidthFor(innerRadius: number, maxPerCategory: number): number {
  if (maxPerCategory === 0) return BAND_EMPTY;
  let rows = 0;
  let capacity = 0;
  while (capacity < maxPerCategory) {
    const rowRadius = innerRadius + PLOT * (rows + 0.5);
    capacity += colsAtRadius(rowRadius);
    rows += 1;
    if (rows > 400) break; // guard against pathological input
  }
  return Math.max(BAND_MIN, rows * PLOT);
}

/**
 * Plot centre for the nth building in a wedge.
 *
 * Rows fill inner-to-outer, and each row is centred within its wedge so the district reads as
 * deliberate rather than left-aligned against the gutter.
 */
function plotPosition(
  innerRadius: number,
  wedge: number,
  index: number,
): { x: number; z: number; radius: number; angle: number } {
  let remaining = index;
  let row = 0;
  let cols = colsAtRadius(innerRadius + PLOT * 0.5);
  while (remaining >= cols) {
    remaining -= cols;
    row += 1;
    cols = colsAtRadius(innerRadius + PLOT * (row + 0.5));
  }

  const radius = innerRadius + PLOT * (row + 0.5);
  const span = wedgeSpan();
  const usedAngle = (cols * PLOT) / radius;
  const offset = Math.max(0, (span - usedAngle) / 2);
  const angle = wedgeStart(wedge) + offset + ((remaining + 0.5) * PLOT) / radius;

  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius, radius, angle };
}

/** Sunflower spiral — spreads any number of towers evenly with no special-casing for count. */
function downtownPosition(index: number): { x: number; z: number } {
  const radius = TOWER_SPACING * Math.sqrt(index + 0.5);
  const angle = index * GOLDEN_ANGLE;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function downtownRadiusFor(count: number): number {
  if (count === 0) return DOWNTOWN_MARGIN;
  return TOWER_SPACING * Math.sqrt(count - 0.5 + 1) + DOWNTOWN_MARGIN;
}

// --- main ----------------------------------------------------------------

/**
 * Build the full layout for a city.
 *
 * @param asOf ISO day key. Entries and completions after this date are excluded, which is how the
 *             time scrubber replays the city rising. Defaults to today.
 */
export function layoutCity(city: CityData, asOf: string = todayISO()): CityLayout {
  const entries = sortEntries(city.entries.filter((e) => e.date <= asOf));
  const commitments = [...city.commitments].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );

  // --- downtown ---------------------------------------------------------

  const towers: TowerPlacement[] = commitments.map((commitment, i) => {
    const { x, z } = downtownPosition(i);
    const rng = rngFor(commitment.id);
    const logsUpTo = city.logs.filter((l) => l.date <= asOf);
    const last = lastLogDate(logsUpTo, commitment.id);
    return {
      commitmentId: commitment.id,
      name: commitment.name,
      x,
      z,
      floors: floorsFor(city.logs, commitment.id, asOf),
      lit: isLit(commitment.cadence, last, asOf),
      rotation: rng() * TAU,
      variation: rng(),
      cadenceLabel: describeCadence(commitment),
      lastLog: last,
    };
  });

  const downtownRadius = downtownRadiusFor(commitments.length);

  // --- month bands ------------------------------------------------------

  const bands: Band[] = [];
  const placements: Placement[] = [];

  if (entries.length === 0) {
    return { towers, placements, bands, downtownRadius, radius: downtownRadius };
  }

  const months = enumerateMonths(entries[0].date, asOf);

  // Group entries by month, then by category, preserving the (date, id) prefix property.
  const byMonth = new Map<string, Map<Category, Entry[]>>();
  for (const entry of entries) {
    const key = monthKey(entry.date);
    let categories = byMonth.get(key);
    if (!categories) {
      categories = new Map();
      byMonth.set(key, categories);
    }
    const bucket = categories.get(entry.category);
    if (bucket) bucket.push(entry);
    else categories.set(entry.category, [entry]);
  }

  let innerRadius = downtownRadius;

  for (const key of months) {
    const categories = byMonth.get(key);
    const entryCount = categories
      ? [...categories.values()].reduce((n, list) => n + list.length, 0)
      : 0;
    const maxPerCategory = categories
      ? Math.max(...[...categories.values()].map((list) => list.length))
      : 0;

    const width = bandWidthFor(innerRadius, maxPerCategory);
    const band: Band = {
      monthKey: key,
      innerRadius,
      outerRadius: innerRadius + width,
      entryCount,
      isEmpty: entryCount === 0,
    };
    bands.push(band);

    if (categories) {
      for (const [category, list] of categories) {
        const meta = CATEGORY_BY_ID[category];
        list.forEach((entry, index) => {
          const { x, z } = plotPosition(innerRadius, meta.wedge, index);
          const rng = rngFor(entry.id);
          placements.push({
            entryId: entry.id,
            category,
            kind: meta.structure,
            text: entry.text,
            date: entry.date,
            x,
            z,
            rotation: rng() * TAU,
            variation: rng(),
            monthKey: key,
          });
        });
      }
    }

    innerRadius = band.outerRadius + BAND_GAP;
  }

  return {
    towers,
    placements,
    bands,
    downtownRadius,
    radius: bands.length > 0 ? bands[bands.length - 1].outerRadius : downtownRadius,
  };
}

function describeCadence(commitment: Commitment): string {
  const { times, per } = commitment.cadence;
  const unit = per === 'day' ? 'day' : per;
  if (times === 1) return per === 'day' ? 'every day' : `once a ${unit}`;
  if (times === 2) return `twice a ${unit}`;
  return `${times}x a ${unit}`;
}
