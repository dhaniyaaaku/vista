/**
 * Consistency rewards.
 *
 * Showing up repeatedly earns things that appear in the city itself: trees for a full week, and a
 * garden for a month you mostly kept up with.
 *
 * Both are deliberately forgiving, and neither can ever be taken away. A month allows four missed
 * days because nobody is perfect, and a reward you earned in March stays in March forever even if
 * April goes badly. That is the same rule as the towers: what you did is a permanent record, and
 * only the present tense is allowed to change.
 *
 * Everything here is derived from the entries, never stored. There is no separate reward state to
 * drift out of sync, and recomputing after any edit gives the right answer by construction.
 */

import type { Entry } from './types';
import { addDays, daysBetween, monthKey } from './dates';

/** Days you may miss in a month and still earn its garden. */
export const FORGIVEN_DAYS = 4;
/** Consecutive logged days that make a week. */
export const WEEK_LENGTH = 7;
/** Trees awarded per full week. */
export const TREES_PER_WEEK = 4;

export type GardenKind = 'flowers' | 'fountain' | 'grove' | 'pavilion';

export const GARDEN_KINDS: readonly GardenKind[] = ['flowers', 'fountain', 'grove', 'pavilion'];

export interface MonthReward {
  monthKey: string;
  /** Days in the month that have at least one win, up to `asOf`. */
  loggedDays: number;
  /** Days in the month with nothing, up to `asOf`. */
  missedDays: number;
  /** Complete runs of seven consecutive logged days. */
  fullWeeks: number;
  trees: number;
  /** True when the month was kept up with, allowing FORGIVEN_DAYS misses. */
  earnedGarden: boolean;
  /** Which garden this month gets. Stable for a given month. */
  gardenKind: GardenKind;
}

/** Last day of a month, or `asOf` if the month is still running. */
function monthEnd(key: string, asOf: string): string {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const full = `${key}-${String(last).padStart(2, '0')}`;
  return full <= asOf ? full : asOf;
}

/**
 * Complete weeks inside a set of logged days.
 *
 * Counted as runs of consecutive days rather than calendar weeks, so a streak that happens to
 * straddle a Sunday still counts. Each maximal run of length L contributes floor(L / 7).
 */
function countFullWeeks(days: string[]): number {
  if (days.length === 0) return 0;
  const sorted = [...days].sort();
  let weeks = 0;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (daysBetween(sorted[i - 1], sorted[i]) === 1) {
      run += 1;
    } else {
      weeks += Math.floor(run / WEEK_LENGTH);
      run = 1;
    }
  }
  weeks += Math.floor(run / WEEK_LENGTH);
  return weeks;
}

function gardenFor(key: string): GardenKind {
  // Stable per month, and varied enough that consecutive months rarely match.
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GARDEN_KINDS[h % GARDEN_KINDS.length];
}

/** One entry per month that has any wins, in chronological order. */
export function rewardsFor(entries: Entry[], asOf: string): MonthReward[] {
  const byMonth = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.date > asOf) continue;
    const key = monthKey(entry.date);
    const days = byMonth.get(key);
    if (days) days.add(entry.date);
    else byMonth.set(key, new Set([entry.date]));
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, daySet]) => {
      const days = [...daySet];
      const first = `${key}-01`;
      const end = monthEnd(key, asOf);
      // Elapsed days only. A month still in progress is not judged on days that have not happened.
      const elapsed = daysBetween(first, end) + 1;
      const loggedDays = days.length;
      const missedDays = Math.max(0, elapsed - loggedDays);
      const fullWeeks = countFullWeeks(days);

      return {
        monthKey: key,
        loggedDays,
        missedDays,
        fullWeeks,
        trees: fullWeeks * TREES_PER_WEEK,
        earnedGarden: missedDays <= FORGIVEN_DAYS,
        gardenKind: gardenFor(key),
      };
    });
}

/** Human summary for the UI, phrased so a month that missed out is never scolded. */
export function describeReward(reward: MonthReward): string {
  const parts: string[] = [];
  if (reward.trees > 0) {
    parts.push(`${reward.fullWeeks} full week${reward.fullWeeks === 1 ? '' : 's'}`);
  }
  if (reward.earnedGarden) parts.push('garden earned');
  if (parts.length === 0) {
    return `${reward.loggedDays} day${reward.loggedDays === 1 ? '' : 's'} logged`;
  }
  return parts.join(' · ');
}

/** How many more days would earn this month its garden. Zero once earned. */
export function daysToGarden(reward: MonthReward): number {
  return Math.max(0, reward.missedDays - FORGIVEN_DAYS);
}

/** Advance a date by one day. Small helper kept here so callers do not import dates directly. */
export const nextDay = (iso: string): string => addDays(iso, 1);
