/**
 * City layout. Pure functions, zero Three.js — debugging placement as 2D dots takes minutes,
 * debugging it in 3D takes hours.
 *
 * The scheme:
 *   distance from centre = time
 *
 * Downtown sits at the origin and holds one skyscraper per commitment. Around it the city grows
 * outward in one band per calendar month, newest at the edge, band width set by how much was
 * logged that month — so the city ends up with tree rings.
 *
 * Buildings fill the whole ring of their month rather than being zoned by category. Category still
 * decides what a win *becomes* (a house, a park, a studio), it just doesn't decide where it sits —
 * so structure types mix throughout, the way they do in a real city, and each month packs as one
 * dense ring instead of six sparse spokes.
 *
 * Stability under the time scrubber falls out of the design rather than needing special handling:
 * a building's plot is decided by its index within its month, and months sort by (date, id).
 * Filtering to `asOf` always yields a *prefix*, so every already-placed building keeps its plot and
 * only the outermost band grows.
 */

import type { Category, CityData, Commitment, Entry, StructureKind } from '../data/types';
import { CATEGORY_BY_ID } from '../data/types';
import { enumerateMonths, monthKey, todayISO } from '../data/dates';
import { floorsFor, isLit, lastLogDate } from '../data/cadence';
import { rngFor } from '../util/random';

// --- tuning constants, shared with the 3D scene --------------------------

/** Footprint of one plot, in world units. Everything else is derived from this. */
export const PLOT = 2.2;
/** Distance between neighbouring downtown towers. */
export const TOWER_SPACING = 5.0;
/** Clear ring between downtown and the first time band. */
export const DOWNTOWN_MARGIN = 7;
/** Gap between adjacent month bands — reads as a ring road. */
export const BAND_GAP = 1.1;
/** Minimum width of a band that has entries. */
export const BAND_MIN = PLOT;
/** Width of a month with nothing logged. Rendered as open parkland, never as a gap. */
export const BAND_EMPTY = PLOT * 1.3;

/** Radial avenues cut through every ring, so the city reads as planned rather than as a blob. */
export const AVENUE_COUNT = 6;
const AVENUE_HALF_WIDTH = 0.045; // radians

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

/** Is this angle inside one of the radial avenues? */
function inAvenue(angle: number): boolean {
  for (let a = 0; a < AVENUE_COUNT; a += 1) {
    const centre = (TAU * a) / AVENUE_COUNT;
    const delta = Math.abs(((angle - centre + Math.PI) % TAU + TAU) % TAU - Math.PI);
    if (delta < AVENUE_HALF_WIDTH) return true;
  }
  return false;
}

/** Angles of the buildable plots in one concentric row, with the avenues left clear. */
function slotsInRow(radius: number): number[] {
  const cols = Math.max(1, Math.floor((TAU * radius) / PLOT));
  const angles: number[] = [];
  for (let i = 0; i < cols; i += 1) {
    const angle = (TAU * i) / cols;
    if (!inAvenue(angle)) angles.push(angle);
  }
  return angles;
}

/** Sunflower spiral — spreads any number of towers evenly with no special-casing for count. */
function downtownPosition(index: number): { x: number; z: number } {
  const radius = TOWER_SPACING * Math.sqrt(index + 0.5);
  const angle = index * GOLDEN_ANGLE;
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

function downtownRadiusFor(count: number): number {
  if (count === 0) return DOWNTOWN_MARGIN;
  return TOWER_SPACING * Math.sqrt(count + 0.5) + DOWNTOWN_MARGIN;
}

/**
 * Lay one month's entries into concentric rows, filling inner to outer.
 *
 * Returns the band's width as a side effect of how many rows were needed, which is what gives
 * busy months visibly thicker rings.
 */
function placeBand(
  innerRadius: number,
  entries: Entry[],
  key: string,
  bandIndex: number,
): { placements: Placement[]; width: number } {
  const placements: Placement[] = [];
  if (entries.length === 0) return { placements, width: BAND_EMPTY };

  // Each month fills its ring densely from a *rotated* starting angle. Without the rotation every
  // band starts at 0 and the city ends up as a stack of arcs all facing the same way, with one
  // enormous empty wedge. Stepping by the golden ratio spreads successive months around the
  // circle, which reads as a spiral of neighbourhoods rather than a lopsided blob.
  const startFraction = (bandIndex * 0.6180339887) % 1;

  let row = 0;
  let i = 0;
  while (i < entries.length && row < 500) {
    const radius = innerRadius + PLOT * (row + 0.5);
    const slots = slotsInRow(radius);
    const offset = Math.floor(startFraction * slots.length);
    for (let k = 0; k < slots.length; k += 1) {
      const angle = slots[(k + offset) % slots.length];
      if (i >= entries.length) break;
      const entry = entries[i];
      const meta = CATEGORY_BY_ID[entry.category];
      const rng = rngFor(entry.id);
      placements.push({
        entryId: entry.id,
        category: entry.category,
        kind: meta.structure,
        text: entry.text,
        date: entry.date,
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        rotation: angle + Math.PI / 2 + (rng() - 0.5) * 0.25,
        variation: rng(),
        monthKey: key,
      });
      i += 1;
    }
    row += 1;
  }

  return { placements, width: Math.max(BAND_MIN, row * PLOT) };
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
  const logsUpTo = city.logs.filter((l) => l.date <= asOf);

  // --- downtown ---------------------------------------------------------

  const towers: TowerPlacement[] = commitments.map((commitment, i) => {
    const { x, z } = downtownPosition(i);
    const rng = rngFor(commitment.id);
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

  const byMonth = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = monthKey(entry.date);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(entry);
    else byMonth.set(key, [entry]);
  }

  let innerRadius = downtownRadius;
  let bandIndex = 0;

  for (const key of enumerateMonths(entries[0].date, asOf)) {
    const monthEntries = byMonth.get(key) ?? [];
    const { placements: placed, width } = placeBand(innerRadius, monthEntries, key, bandIndex);
    bandIndex += 1;

    bands.push({
      monthKey: key,
      innerRadius,
      outerRadius: innerRadius + width,
      entryCount: monthEntries.length,
      isEmpty: monthEntries.length === 0,
    });
    placements.push(...placed);

    innerRadius += width + BAND_GAP;
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
