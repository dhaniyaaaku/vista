/**
 * Cadence logic — how often a commitment is meant to be kept, and whether its tower is lit.
 *
 * The rule from PLAN.md that this file exists to enforce:
 *   Height is permanent record; light is current state.
 *
 * A commitment gains one floor per completion and never loses one. Whether its windows are lit
 * is a separate, purely present-tense question, and the grace window scales to the cadence the
 * user actually chose — otherwise "you skipped" would mean something wildly unfair to a
 * twice-a-month commitment compared to a daily one.
 */

import type { Cadence, CadencePeriod, CommitmentLog } from './types';
import { daysBetween, todayISO } from './dates';

export const PERIOD_DAYS: Record<CadencePeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
};

/**
 * How many quiet days a commitment gets before its lights go out.
 *
 * Twice the nominal gap between completions, so a single missed occurrence is always forgiven.
 * Daily -> 2 days. 3x a week -> 6 days. Twice a month -> 30 days.
 */
export function graceDays(cadence: Cadence): number {
  const period = PERIOD_DAYS[cadence.per];
  const times = Math.max(1, cadence.times);
  return Math.ceil(period / times) * 2;
}

/** The most recent completion date for a commitment, or null if it has never been logged. */
export function lastLogDate(logs: CommitmentLog[], commitmentId: string): string | null {
  let latest: string | null = null;
  for (const log of logs) {
    if (log.commitmentId !== commitmentId) continue;
    if (latest === null || log.date > latest) latest = log.date;
  }
  return latest;
}

/**
 * Is this commitment currently being kept?
 *
 * Dark is quiet, not failed — nothing downstream of this may remove floors or show a failure state.
 */
export function isLit(
  cadence: Cadence,
  lastLog: string | null,
  asOf: string = todayISO(),
): boolean {
  if (lastLog === null) return false;
  const since = daysBetween(lastLog, asOf);
  if (since < 0) return true; // logged ahead of `asOf`, e.g. while scrubbing back through time
  return since <= graceDays(cadence);
}

/** Floors are cumulative completions, counted at or before `asOf` so the time scrubber works. */
export function floorsFor(
  logs: CommitmentLog[],
  commitmentId: string,
  asOf?: string,
): number {
  let n = 0;
  for (const log of logs) {
    if (log.commitmentId !== commitmentId) continue;
    if (asOf !== undefined && log.date > asOf) continue;
    n += 1;
  }
  return n;
}

/** 'every day', '3x a week', 'twice a month' — human-readable cadence for the UI. */
export function cadenceLabel(cadence: Cadence): string {
  const { times, per } = cadence;
  const unit = per === 'day' ? 'day' : per === 'week' ? 'week' : 'month';
  if (times === 1) return per === 'day' ? 'every day' : `once a ${unit}`;
  if (times === 2) return `twice a ${unit}`;
  return `${times}x a ${unit}`;
}

export const CADENCE_PRESETS: readonly { label: string; cadence: Cadence }[] = [
  { label: 'Every day', cadence: { times: 1, per: 'day' } },
  { label: '5x a week', cadence: { times: 5, per: 'week' } },
  { label: '3x a week', cadence: { times: 3, per: 'week' } },
  { label: 'Once a week', cadence: { times: 1, per: 'week' } },
  { label: 'Twice a month', cadence: { times: 2, per: 'month' } },
  { label: 'Once a month', cadence: { times: 1, per: 'month' } },
] as const;
