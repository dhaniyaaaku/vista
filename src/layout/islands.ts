/**
 * Yearly islands, monthly sectors.
 *
 * Replaces the concentric-month layout, which had a structural flaw: a ring's capacity grows with
 * its circumference while monthly logging volume stays flat, so outer months got emptier forever.
 * Measured on real data, density outer/inner was 0.81x and falling.
 *
 * An island holds exactly one year, so it never has to grow. Year 10's island is the same size as
 * year 1's, and the problem cannot arise. Nothing is demolished either — last year's island is
 * still there, still lit, joined to this year's by a bridge.
 *
 * Pure functions, no Three.js. Placement is verified as 2D dots at `?debug2d` before anything is
 * rendered, because debugging positions in a 3D scene is miserable.
 */

import type { CityData, Commitment, Entry } from '../data/types';
import { CATEGORY_BY_ID } from '../data/types';
import { monthKey, todayISO } from '../data/dates';
import { floorsFor, isLit, lastLogDate } from '../data/cadence';
import { rewardsFor, type MonthReward } from '../data/rewards';
import { mulberry32, hashString, rngFor } from '../util/random';
import { PLOT, TOWER_SPACING, type Placement, type TowerPlacement } from './polar';

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Every island is this size, so a quiet year reads as open space rather than a stunted rock. */
export const ISLAND_RADIUS = 62;
/** Clear water between island edges. */
export const ISLAND_GAP = 46;
/** Reserved centre, for the live towers or a finished year's monument. */
export const ISLAND_CORE = 15;
/** Angular gutter between sectors, so months read as separate places. */
export const SECTOR_GUTTER = 0.035;

export interface Sector {
  /** 'YYYY-MM'. */
  monthKey: string;
  /** Month index 0-11. */
  month: number;
  startAngle: number;
  endAngle: number;
  /** No entries yet and the month has not happened. Gets a billboard. */
  isFuture: boolean;
  entryCount: number;
  reward?: MonthReward;
}

export interface Island {
  year: string;
  x: number;
  z: number;
  radius: number;
  sectors: Sector[];
  /** The year currently being lived in. Holds the towers. */
  isCurrent: boolean;
  /** Finished years earn a monument at their centre. */
  monument: MonumentKind | null;
  /** Share of expected commitment occurrences that were missed, across the year. */
  darkRatio: number;
}

export type MonumentKind = 'spire' | 'dome' | 'arch';

export interface Bridge {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}

export interface RewardPlacement {
  kind: 'tree' | 'garden';
  gardenKind?: MonthReward['gardenKind'];
  monthKey: string;
  x: number;
  z: number;
  rotation: number;
  variation: number;
}

export interface BillboardPlacement {
  monthKey: string;
  x: number;
  z: number;
  rotation: number;
}

export interface IslandLayout {
  islands: Island[];
  bridges: Bridge[];
  towers: TowerPlacement[];
  placements: Placement[];
  rewards: RewardPlacement[];
  billboards: BillboardPlacement[];
  /** Extent of the whole archipelago, for framing the camera. */
  radius: number;
  /** Centre of the whole chain, which is not the origin once there are several islands. */
  centerX: number;
  centerZ: number;
}

// --- helpers -------------------------------------------------------------

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Island centres along a gently meandering chain.
 *
 * A straight line would run off to the horizon; a circle would eventually close on itself. A slow
 * sine drift keeps the archipelago readable from above however many years accumulate.
 */
function islandCenter(index: number): { x: number; z: number } {
  const step = ISLAND_RADIUS * 2 + ISLAND_GAP;
  return {
    x: index * step,
    z: Math.sin(index * 0.7) * step * 0.34,
  };
}

/**
 * How many sectors a year gets.
 *
 * From the month the user joined through December, so somebody who starts in September gets a
 * four-sector island rather than twelve with eight dead ones. Later years get all twelve.
 */
function sectorMonths(year: string, joinMonthKey: string): number[] {
  const joinYear = joinMonthKey.slice(0, 4);
  const first = year === joinYear ? Number(joinMonthKey.slice(5, 7)) - 1 : 0;
  const months: number[] = [];
  for (let m = first; m < 12; m += 1) months.push(m);
  return months;
}

/** Row filling inside one sector, same approach as the old ring layout. */
function fillSector(
  island: { x: number; z: number },
  startAngle: number,
  endAngle: number,
  entries: Entry[],
): Placement[] {
  const out: Placement[] = [];
  const span = endAngle - startAngle;
  let row = 0;
  let i = 0;

  while (i < entries.length && row < 400) {
    const r = ISLAND_CORE + PLOT * (row + 0.5);
    if (r > ISLAND_RADIUS - PLOT) break;
    const cols = Math.max(1, Math.floor((r * span) / PLOT));
    // Centre each row in its sector so the district reads as deliberate.
    const used = (cols * PLOT) / r;
    const offset = Math.max(0, (span - used) / 2);

    for (let k = 0; k < cols && i < entries.length; k += 1) {
      const entry = entries[i];
      const angle = startAngle + offset + ((k + 0.5) * PLOT) / r;
      const meta = CATEGORY_BY_ID[entry.category];
      const rng = rngFor(entry.id);
      out.push({
        entryId: entry.id,
        category: entry.category,
        kind: meta.structure,
        text: entry.text,
        date: entry.date,
        x: island.x + Math.cos(angle) * r,
        z: island.z + Math.sin(angle) * r,
        rotation: angle + Math.PI / 2 + (rng() - 0.5) * 0.25,
        variation: rng(),
        monthKey: monthKey(entry.date),
      });
      i += 1;
    }
    row += 1;
  }

  return out;
}

/**
 * Share of a year's expected commitment occurrences that were missed.
 *
 * Expected count comes from the declared cadence, not from calendar days. One floor per day would
 * leave a twice-monthly commitment 93% dark and permanently unable to earn anything, which would
 * punish someone for choosing an honest cadence.
 */
function darkRatioForYear(city: CityData, year: string, asOf: string): number {
  const start = `${year}-01-01`;
  const end = `${year}-12-31` <= asOf ? `${year}-12-31` : asOf;
  if (end < start) return 1;

  const days = (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000 + 1;
  let expected = 0;
  let done = 0;

  for (const commitment of city.commitments) {
    if (commitment.createdAt.slice(0, 4) > year) continue;
    const periodDays = commitment.cadence.per === 'day' ? 1 : commitment.cadence.per === 'week' ? 7 : 30;
    expected += (days / periodDays) * commitment.cadence.times;
    done += city.logs.filter(
      (l) => l.commitmentId === commitment.id && l.date >= start && l.date <= end,
    ).length;
  }

  if (expected <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - done / expected));
}

function monumentFor(year: string, darkRatio: number): MonumentKind | null {
  // Ten percent or less missed across the year earns the monument.
  if (darkRatio > 0.1) return null;
  const kinds: MonumentKind[] = ['spire', 'dome', 'arch'];
  let h = 0;
  for (let i = 0; i < year.length; i += 1) h = (h * 31 + year.charCodeAt(i)) >>> 0;
  return kinds[h % kinds.length];
}

// --- main ----------------------------------------------------------------

export function layoutIslands(city: CityData, asOf: string = todayISO()): IslandLayout {
  const entries = sortEntries(city.entries.filter((e) => e.date <= asOf));
  const commitments = [...city.commitments].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );

  const currentYear = asOf.slice(0, 4);
  const joinKey = entries.length > 0 ? monthKey(entries[0].date) : monthKey(asOf);
  const firstYear = joinKey.slice(0, 4);

  const years: string[] = [];
  for (let y = Number(firstYear); y <= Number(currentYear); y += 1) years.push(String(y));

  const rewards = rewardsFor(entries, asOf);
  const rewardByMonth = new Map(rewards.map((r) => [r.monthKey, r]));

  const byMonth = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = monthKey(entry.date);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(entry);
    else byMonth.set(key, [entry]);
  }

  const islands: Island[] = [];
  const placements: Placement[] = [];
  const rewardPlacements: RewardPlacement[] = [];
  const billboards: BillboardPlacement[] = [];

  years.forEach((year, index) => {
    const center = islandCenter(index);
    const months = sectorMonths(year, joinKey);
    const sectorSpan = TAU / months.length;
    const isCurrent = year === currentYear;
    const darkRatio = darkRatioForYear(city, year, asOf);

    const sectors: Sector[] = months.map((month, slot) => {
      const key = `${year}-${String(month + 1).padStart(2, '0')}`;
      const monthEntries = byMonth.get(key) ?? [];
      const startAngle = sectorSpan * slot + SECTOR_GUTTER;
      const endAngle = sectorSpan * (slot + 1) - SECTOR_GUTTER;

      placements.push(...fillSector(center, startAngle, endAngle, monthEntries));

      const isFuture = monthEntries.length === 0 && key > monthKey(asOf);
      if (isFuture) {
        const mid = (startAngle + endAngle) / 2;
        const r = ISLAND_RADIUS * 0.72;
        billboards.push({
          monthKey: key,
          x: center.x + Math.cos(mid) * r,
          z: center.z + Math.sin(mid) * r,
          rotation: mid + Math.PI / 2,
        });
      }

      // Rewards sit toward the outer edge of their own month, where they are visible.
      const reward = rewardByMonth.get(key);
      if (reward) {
        const mid = (startAngle + endAngle) / 2;
        // Trees scatter across the whole sector rather than lining its edge. A neat arc of them
        // reads as fencing; scattered, they read as the place having grown some greenery.
        const rng = mulberry32(hashString(`trees-${key}`));
        // Kept out of the built rows nearer the centre, so they fill the open ground instead.
        const inner = ISLAND_CORE + (ISLAND_RADIUS - ISLAND_CORE) * 0.34;
        for (let t = 0; t < reward.trees; t += 1) {
          const a = startAngle + rng() * (endAngle - startAngle);
          // sqrt keeps them evenly spread by area rather than bunched toward the centre.
          const r = inner + Math.sqrt(rng()) * (ISLAND_RADIUS * 0.96 - inner);
          rewardPlacements.push({
            kind: 'tree',
            monthKey: key,
            x: center.x + Math.cos(a) * r,
            z: center.z + Math.sin(a) * r,
            rotation: rng() * TAU,
            // Drives which of the three tree shapes is used, and its height.
            variation: rng(),
          });
        }
        if (reward.earnedGarden) {
          const r = ISLAND_RADIUS * 0.94;
          rewardPlacements.push({
            kind: 'garden',
            gardenKind: reward.gardenKind,
            monthKey: key,
            x: center.x + Math.cos(mid) * r,
            z: center.z + Math.sin(mid) * r,
            rotation: mid + Math.PI / 2,
            variation: 0.5,
          });
        }
      }

      return {
        monthKey: key,
        month,
        startAngle,
        endAngle,
        isFuture,
        entryCount: monthEntries.length,
        reward,
      };
    });

    islands.push({
      year,
      x: center.x,
      z: center.z,
      radius: ISLAND_RADIUS,
      sectors,
      isCurrent,
      monument: isCurrent ? null : monumentFor(year, darkRatio),
      darkRatio,
    });
  });

  // --- towers, on the island of the year being lived in -------------------

  const home = islands.find((i) => i.isCurrent) ?? islands[islands.length - 1];
  const logsUpTo = city.logs.filter((l) => l.date <= asOf);

  const towers: TowerPlacement[] = commitments.map((commitment, i) => {
    const r = TOWER_SPACING * Math.sqrt(i + 0.5);
    const angle = i * GOLDEN_ANGLE;
    const rng = rngFor(commitment.id);
    const last = lastLogDate(logsUpTo, commitment.id);
    return {
      commitmentId: commitment.id,
      name: commitment.name,
      x: (home?.x ?? 0) + Math.cos(angle) * r,
      z: (home?.z ?? 0) + Math.sin(angle) * r,
      floors: floorsFor(city.logs, commitment.id, asOf),
      lit: isLit(commitment.cadence, last, asOf),
      rotation: rng() * TAU,
      variation: rng(),
      cadenceLabel: describeCadence(commitment),
      lastLog: last,
    };
  });

  // --- bridges between consecutive years ---------------------------------

  const bridges: Bridge[] = [];
  for (let i = 1; i < islands.length; i += 1) {
    const a = islands[i - 1];
    const b = islands[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    bridges.push({
      fromX: a.x + (dx / len) * a.radius,
      fromZ: a.z + (dz / len) * a.radius,
      toX: b.x - (dx / len) * b.radius,
      toZ: b.z - (dz / len) * b.radius,
    });
  }

  // --- extent -------------------------------------------------------------

  const xs = islands.map((i) => i.x);
  const zs = islands.map((i) => i.z);
  const centerX = xs.length > 0 ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
  const centerZ = zs.length > 0 ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
  const radius =
    islands.length === 0
      ? ISLAND_RADIUS
      : Math.max(
          ...islands.map((i) => Math.hypot(i.x - centerX, i.z - centerZ) + i.radius),
          ISLAND_RADIUS,
        );

  return {
    islands,
    bridges,
    towers,
    placements,
    rewards: rewardPlacements,
    billboards,
    radius,
    centerX,
    centerZ,
  };
}

function describeCadence(commitment: Commitment): string {
  const { times, per } = commitment.cadence;
  if (times === 1) return per === 'day' ? 'every day' : `once a ${per}`;
  if (times === 2) return `twice a ${per}`;
  return `${times}x a ${per}`;
}
