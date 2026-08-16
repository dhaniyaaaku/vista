/**
 * The demo city.
 *
 * Two jobs:
 *  1. Development — you cannot debug a layout algorithm against three buildings. Everything gets
 *     built against a full six-month city from hour one.
 *  2. Product — the "see an example city" button, so a visitor gets a real skyline in four seconds
 *     without signing up or logging anything.
 *
 * This is built purely in memory and is never written to IndexedDB, so it can never contaminate a
 * real city. Deterministic: same seed, same city, every load.
 */

import type { CityData, Category, Commitment, CommitmentLog, Entry } from './types';
import { addDays, enumerateMonths, monthKey, todayISO } from './dates';
import { mulberry32, pick, randInt } from '../util/random';

const WINS: Record<Category, readonly string[]> = {
  personal: [
    'cooked a real meal instead of cereal',
    'did the laundry pile I had been ignoring',
    'changed my sheets',
    'cleared my desk completely',
    'finally unpacked the last box',
    'took my meds every day this week',
    'opened the curtains before noon',
    'showered and got properly dressed',
    'cancelled the subscription I kept forgetting about',
    'booked the dentist appointment',
    'made the bed before leaving',
    'sorted out the drawer of doom',
  ],
  rest: [
    'napped without feeling guilty',
    'said no to plans and did not apologise',
    'put my phone in another room for an hour',
    'went to bed before midnight',
    'sat outside doing nothing for twenty minutes',
    'took the whole afternoon off',
    'did not check email after six',
    'let myself finish the series',
    'stopped working when I said I would',
    'had a slow morning on purpose',
  ],
  connection: [
    'finally called mum back',
    'texted the friend I had been avoiding',
    'apologised properly',
    'asked for help instead of guessing',
    'sent the birthday card on time',
    'had coffee with someone new',
    'checked in on a friend having a hard week',
    'said what I actually meant',
    'went to the thing I nearly cancelled',
  ],
  creative: [
    'finished the drawing I had left half done',
    'wrote 500 words that were not terrible',
    'played guitar for the first time in months',
    'started the piece I have been scared of',
    'posted it instead of deleting it',
    'took photos on the walk',
    'redid the layout and it is better',
    'made something just for me',
  ],
  learning: [
    'understood recursion, finally',
    'read a full chapter without my phone',
    'watched the lecture I had been putting off',
    'worked out why the build kept failing',
    'learned to make proper dal',
    'finished the course module',
    'read the paper properly instead of skimming',
    'asked the stupid question and it was not stupid',
  ],
  milestone: [
    'handed in the dissertation',
    'got the internship offer',
    'submitted the paper',
    'moved into the new place',
    'ran 10k without stopping',
    'gave the talk',
  ],
};

const EVERYDAY_CATEGORIES: Category[] = ['personal', 'rest', 'connection', 'creative', 'learning'];

/**
 * Entries per full calendar month, cycled across however many months the demo spans.
 *
 * The uneven shape is a deliberate test case as much as set dressing: varied counts prove that
 * band width tracks volume, which is what gives the city its tree rings.
 */
const MONTHLY_PATTERN = [130, 105, 148, 118, 138, 92, 155, 124, 110, 142, 98, 134];

/** Days of `key` that fall inside [start, end]. First and last months are partial. */
function daysOfMonthInRange(key: string, start: string, end: string): string[] {
  const [y, m] = key.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= lastDay; d += 1) {
    const iso = `${key}-${String(d).padStart(2, '0')}`;
    if (iso >= start && iso <= end) out.push(iso);
  }
  return out;
}

const DEMO_COMMITMENTS: readonly { name: string; cadence: Commitment['cadence']; quiet?: boolean }[] = [
  { name: 'Move my body', cadence: { times: 1, per: 'day' } },
  { name: 'Write', cadence: { times: 3, per: 'week' }, quiet: true },
  { name: 'Call home', cadence: { times: 1, per: 'week' } },
  { name: 'Volunteer at the shelter', cadence: { times: 2, per: 'month' } },
  { name: 'Deep clean', cadence: { times: 1, per: 'month' } },
];

const DEMO_SEED = 20260316;
/**
 * ~18 months. Long enough that the demo city reads as a place with history rather than a village,
 * at roughly one to one-and-a-half logged wins a day — which is a plausible rate for someone who
 * actually uses this, not an inflated one.
 */
const DEMO_DAYS = 548;

function isoStamp(dayOffset: number): string {
  return new Date(Date.UTC(2026, 0, 1) + dayOffset * 1000).toISOString();
}

export function buildDemoCity(seed: number = DEMO_SEED): CityData {
  const rng = mulberry32(seed);
  const today = todayISO();
  const start = addDays(today, -DEMO_DAYS);

  const entries: Entry[] = [];
  const commitments: Commitment[] = [];
  const logs: CommitmentLog[] = [];
  let stamp = 0;

  // --- one-off wins, distributed across real calendar months -------------
  //
  // Assignment is by calendar month rather than by equal day-windows, because month bands are
  // what the layout actually groups by. Splitting the range into equal windows smears a quiet
  // stretch across two real months and the empty-band case never gets exercised.

  const months = enumerateMonths(start, today);
  const quietMonth = Math.floor(months.length / 2);

  let milestonesPlaced = 0;
  const milestoneBudget = 12;

  for (let m = 0; m < months.length; m += 1) {
    const days = daysOfMonthInRange(months[m], start, today);
    if (days.length === 0) continue;

    // One month is deliberately silent — a burnout stretch. It is the parkland band, and the
    // case most likely to break the layout algorithm.
    const scale = days.length / 30;
    const count =
      m === quietMonth
        ? 0
        : Math.max(1, Math.round(MONTHLY_PATTERN[m % MONTHLY_PATTERN.length] * scale));

    for (let i = 0; i < count; i += 1) {
      // Milestones stay rare on purpose. If everything glows, nothing does.
      const wantMilestone = milestonesPlaced < milestoneBudget && rng() < 0.04;
      const category: Category = wantMilestone
        ? 'milestone'
        : pick(rng, EVERYDAY_CATEGORIES);
      if (wantMilestone) milestonesPlaced += 1;

      const date = days[randInt(rng, 0, days.length - 1)];

      entries.push({
        id: `demo-entry-${entries.length}`,
        date,
        text: pick(rng, WINS[category]),
        category,
        isDemo: true,
        createdAt: isoStamp(stamp++),
        updatedAt: isoStamp(stamp++),
      });
    }
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // --- commitments and their completions ---------------------------------

  for (let c = 0; c < DEMO_COMMITMENTS.length; c += 1) {
    const spec = DEMO_COMMITMENTS[c];
    const id = `demo-commitment-${c}`;
    commitments.push({
      id,
      name: spec.name,
      cadence: spec.cadence,
      isDemo: true,
      createdAt: isoStamp(stamp++),
      updatedAt: isoStamp(stamp++),
    });

    // Expected gap between completions, in days, from the declared cadence.
    const periodDays = spec.cadence.per === 'day' ? 1 : spec.cadence.per === 'week' ? 7 : 30;
    const gap = Math.max(1, Math.round(periodDays / spec.cadence.times));

    // `quiet` commitments stop three weeks back, so the demo city shows at least one dark
    // tower — the whole point of "height is record, light is current state".
    const lastDay = spec.quiet ? DEMO_DAYS - 21 : DEMO_DAYS;

    for (let day = randInt(rng, 0, gap); day < lastDay; day += gap) {
      // Real people miss some. Roughly one in six completions is skipped.
      if (rng() < 0.17) continue;
      const jitter = gap > 2 ? randInt(rng, -1, 1) : 0;
      const date = addDays(start, Math.min(DEMO_DAYS, Math.max(0, day + jitter)));
      if (date > today) continue;
      if (logs.some((l) => l.commitmentId === id && l.date === date)) continue;

      logs.push({
        id: `demo-log-${logs.length}`,
        commitmentId: id,
        date,
        isDemo: true,
        createdAt: isoStamp(stamp++),
      });
    }
  }

  return { entries, commitments, logs };
}

/**
 * The same city, but as real records ready to be written to the store and synced to an account.
 *
 * Two differences from `buildDemoCity`, both required. The ids become genuine UUIDs, because the
 * Postgres schema types them as `uuid` and would reject `demo-entry-0`. And `isDemo` is dropped,
 * because once these are in someone's account they are simply that person's entries — there is no
 * such thing as a half-real city.
 *
 * Used to stage a full city for a demo recording. It is a deliberate, explicit action, never
 * something that happens to a user by accident.
 */
export function buildSeededCity(seed?: number): CityData {
  const source = buildDemoCity(seed);

  const entryIds = new Map<string, string>();
  const commitmentIds = new Map<string, string>();
  const idFor = (map: Map<string, string>, old: string) => {
    let next = map.get(old);
    if (!next) {
      next = crypto.randomUUID();
      map.set(old, next);
    }
    return next;
  };

  return {
    entries: source.entries.map(({ isDemo: _isDemo, ...entry }) => ({
      ...entry,
      id: idFor(entryIds, entry.id),
    })),
    commitments: source.commitments.map(({ isDemo: _isDemo, ...commitment }) => ({
      ...commitment,
      id: idFor(commitmentIds, commitment.id),
    })),
    logs: source.logs.map(({ isDemo: _isDemo, ...log }) => ({
      ...log,
      id: crypto.randomUUID(),
      commitmentId: idFor(commitmentIds, log.commitmentId),
    })),
  };
}

/** Quick sanity numbers for the console while developing. */
export function describeDemoCity(city: CityData): string {
  const byMonth = new Map<string, number>();
  for (const entry of city.entries) {
    byMonth.set(monthKey(entry.date), (byMonth.get(monthKey(entry.date)) ?? 0) + 1);
  }
  const months = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}:${v}`)
    .join('  ');
  const milestones = city.entries.filter((e) => e.category === 'milestone').length;
  return [
    `${city.entries.length} entries, ${milestones} milestones`,
    `${city.commitments.length} commitments, ${city.logs.length} completions`,
    months,
  ].join('\n');
}
