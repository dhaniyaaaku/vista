/**
 * Sync between the local city and the signed-in account.
 *
 * Deliberately additive. Local and remote are merged by id, newest `updated_at` wins, and nothing
 * is ever deleted as a side effect of syncing. That means a row deleted on one device can come
 * back from another, which is a real limitation — but the alternative is a sync bug silently
 * eating months of somebody's record, and for this app that trade is not close. Proper deletion
 * needs tombstones, which is a post-hackathon change.
 *
 * Client-generated UUIDs are what make this simple: two devices never mint colliding ids, so a
 * merge is a union rather than a reconciliation.
 */

import { getCity, importCity } from './store';
import { supabase } from './supabase';
import type { CityData, Cadence, CadencePeriod, Category, Commitment, CommitmentLog, Entry } from './types';

const CHUNK = 500;

interface EntryRow {
  id: string;
  user_id: string;
  date: string;
  text: string;
  category: string;
  created_at: string;
  updated_at: string;
}

interface CommitmentRow {
  id: string;
  user_id: string;
  name: string;
  cadence_times: number;
  cadence_per: string;
  created_at: string;
  updated_at: string;
}

interface LogRow {
  id: string;
  user_id: string;
  commitment_id: string;
  date: string;
  created_at: string;
}

// --- row mapping ---------------------------------------------------------

const toEntry = (row: EntryRow): Entry => ({
  id: row.id,
  date: row.date,
  text: row.text,
  category: row.category as Category,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const fromEntry = (entry: Entry, userId: string): EntryRow => ({
  id: entry.id,
  user_id: userId,
  date: entry.date,
  text: entry.text,
  category: entry.category,
  created_at: entry.createdAt,
  updated_at: entry.updatedAt,
});

const toCommitment = (row: CommitmentRow): Commitment => ({
  id: row.id,
  name: row.name,
  cadence: { times: row.cadence_times, per: row.cadence_per as CadencePeriod } as Cadence,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const fromCommitment = (commitment: Commitment, userId: string): CommitmentRow => ({
  id: commitment.id,
  user_id: userId,
  name: commitment.name,
  cadence_times: commitment.cadence.times,
  cadence_per: commitment.cadence.per,
  created_at: commitment.createdAt,
  updated_at: commitment.updatedAt,
});

const toLog = (row: LogRow): CommitmentLog => ({
  id: row.id,
  commitmentId: row.commitment_id,
  date: row.date,
  createdAt: row.created_at,
});

const fromLog = (log: CommitmentLog, userId: string): LogRow => ({
  id: log.id,
  user_id: userId,
  commitment_id: log.commitmentId,
  date: log.date,
  created_at: log.createdAt,
});

// --- merge ---------------------------------------------------------------

/** Union by id. Where both sides have a row, the one edited most recently wins. */
function mergeById<T extends { id: string; updatedAt?: string }>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of remote) merged.set(item.id, item);
  for (const item of local) {
    const existing = merged.get(item.id);
    if (!existing) {
      merged.set(item.id, item);
      continue;
    }
    const a = item.updatedAt ?? '';
    const b = existing.updatedAt ?? '';
    if (a >= b) merged.set(item.id, item);
  }
  return [...merged.values()];
}

// --- public --------------------------------------------------------------

export interface SyncResult {
  entries: number;
  commitments: number;
  logs: number;
}

/**
 * Pull the account's city, merge it with what is on this device, then push the union back.
 *
 * Safe to call repeatedly — it converges, and running it twice changes nothing the second time.
 */
export async function syncCity(userId: string): Promise<SyncResult> {
  const db = supabase();
  const local = await getCity();

  const [entriesRes, commitmentsRes, logsRes] = await Promise.all([
    db.from('entries').select('*'),
    db.from('commitments').select('*'),
    db.from('commitment_logs').select('*'),
  ]);

  const firstError = entriesRes.error ?? commitmentsRes.error ?? logsRes.error;
  if (firstError) throw new Error(`Could not read your account: ${firstError.message}`);

  const remote: CityData = {
    entries: ((entriesRes.data ?? []) as EntryRow[]).map(toEntry),
    commitments: ((commitmentsRes.data ?? []) as CommitmentRow[]).map(toCommitment),
    logs: ((logsRes.data ?? []) as LogRow[]).map(toLog),
  };

  const merged: CityData = {
    entries: mergeById(local.entries, remote.entries),
    commitments: mergeById(local.commitments, remote.commitments),
    logs: mergeById(local.logs, remote.logs),
  };

  // Local first, so the city on screen is correct even if the upload then fails.
  await importCity(JSON.stringify(merged));

  await Promise.all([
    upsertAll(db, 'entries', merged.entries.map((e) => fromEntry(e, userId))),
    upsertAll(db, 'commitments', merged.commitments.map((c) => fromCommitment(c, userId))),
  ]);
  // Logs reference commitments, so they can only go up once the commitments exist.
  await upsertAll(db, 'commitment_logs', merged.logs.map((l) => fromLog(l, userId)));

  return {
    entries: merged.entries.length,
    commitments: merged.commitments.length,
    logs: merged.logs.length,
  };
}

async function upsertAll(
  db: ReturnType<typeof supabase>,
  table: string,
  rows: object[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from(table)
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'id' });
    if (error) throw new Error(`Could not save ${table}: ${error.message}`);
  }
}
