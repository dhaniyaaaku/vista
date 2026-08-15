/**
 * Date helpers. All ISO dates are plain YYYY-MM-DD day keys with no time component.
 *
 * Everything parses to UTC midnight so that arithmetic never drifts across a DST boundary.
 * `todayISO` reads the user's *local* calendar day first, because "today" should mean the day
 * they think it is, then stores it as a bare day key.
 */

const MS_PER_DAY = 86_400_000;

export function toISODate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD day key to UTC midnight. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The user's local calendar day, as a day key. */
export function todayISO(): string {
  const now = new Date();
  return toISODate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

export function addDays(iso: string, n: number): string {
  return toISODate(new Date(parseISODate(iso).getTime() + n * MS_PER_DAY));
}

/** Whole days from `a` to `b`. Positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / MS_PER_DAY);
}

export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 'YYYY-MM' — the key a time band is grouped by. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function monthKeyOfDate(d: Date): string {
  return toISODate(d).slice(0, 7);
}

/**
 * Every month key from start to end inclusive, with no gaps.
 *
 * The no-gaps part matters: months with zero entries still need a band so that quiet periods
 * render as open parkland rather than vanishing from the timeline (PLAN.md principle 1).
 */
export function enumerateMonths(startISO: string, endISO: string): string[] {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  const out: string[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m + 1).padStart(2, '0')}`);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** '3 March 2026' — used on the memory card. */
export function formatLongDate(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getUTCDate()} ${LONG_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 'March 2026' — used for band labels and the scrubber. */
export function formatMonthKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${LONG_MONTHS[m - 1]} ${y}`;
}
