/**
 * THE single data access module.
 *
 * Everything in the app reads and writes through this file. Today it talks to IndexedDB; when
 * accounts land it talks to an API instead, and no call site elsewhere has to change.
 *
 * Demo data deliberately does NOT live here. `seed.ts` builds a CityData object purely in memory
 * and the app renders that instead — so seeded fake entries can never leak into a real city, and
 * there is nothing to clean up when demo mode is switched off.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  Cadence,
  Category,
  CityData,
  Commitment,
  CommitmentLog,
  Entry,
} from './types';
import { todayISO } from './dates';

const DB_NAME = 'vista';
const DB_VERSION = 1;

interface VistaSchema extends DBSchema {
  entries: { key: string; value: Entry };
  commitments: { key: string; value: Commitment };
  logs: {
    key: string;
    value: CommitmentLog;
    indexes: { byCommitment: string };
  };
}

let dbPromise: Promise<IDBPDatabase<VistaSchema>> | null = null;

function db(): Promise<IDBPDatabase<VistaSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<VistaSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        database.createObjectStore('entries', { keyPath: 'id' });
        database.createObjectStore('commitments', { keyPath: 'id' });
        const logs = database.createObjectStore('logs', { keyPath: 'id' });
        logs.createIndex('byCommitment', 'commitmentId');
      },
    });
  }
  return dbPromise;
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

// --- reads ---------------------------------------------------------------

export async function getCity(): Promise<CityData> {
  const database = await db();
  const [entries, commitments, logs] = await Promise.all([
    database.getAll('entries'),
    database.getAll('commitments'),
    database.getAll('logs'),
  ]);
  return { entries, commitments, logs };
}

export async function isEmpty(): Promise<boolean> {
  const database = await db();
  const [entryCount, commitmentCount] = await Promise.all([
    database.count('entries'),
    database.count('commitments'),
  ]);
  return entryCount === 0 && commitmentCount === 0;
}

// --- entries -------------------------------------------------------------

export async function addEntry(input: {
  text: string;
  category: Category;
  /** Defaults to today. Backdating is allowed and is not treated as cheating. */
  date?: string;
}): Promise<Entry> {
  const timestamp = now();
  const entry: Entry = {
    id: uuid(),
    date: input.date ?? todayISO(),
    text: input.text.trim(),
    category: input.category,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const database = await db();
  await database.put('entries', entry);
  return entry;
}

export async function deleteEntry(id: string): Promise<void> {
  const database = await db();
  await database.delete('entries', id);
}

// --- commitments ---------------------------------------------------------

export async function addCommitment(input: {
  name: string;
  cadence: Cadence;
}): Promise<Commitment> {
  const timestamp = now();
  const commitment: Commitment = {
    id: uuid(),
    name: input.name.trim(),
    cadence: input.cadence,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const database = await db();
  await database.put('commitments', commitment);
  return commitment;
}

/**
 * Removing a commitment removes its logs too, since a tower with no completions has no height.
 * This is the one destructive operation in the app and it is always user-initiated.
 */
export async function deleteCommitment(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(['commitments', 'logs'], 'readwrite');
  await tx.objectStore('commitments').delete(id);
  const logStore = tx.objectStore('logs');
  const keys = await logStore.index('byCommitment').getAllKeys(id);
  await Promise.all(keys.map((key) => logStore.delete(key)));
  await tx.done;
}

// --- commitment completions ---------------------------------------------

/** One completion adds exactly one floor, whatever the cadence. Same-day duplicates are ignored. */
export async function logCommitment(
  commitmentId: string,
  date: string = todayISO(),
): Promise<CommitmentLog | null> {
  const database = await db();
  const existing = await database.getAllFromIndex('logs', 'byCommitment', commitmentId);
  if (existing.some((log) => log.date === date)) return null;

  const log: CommitmentLog = {
    id: uuid(),
    commitmentId,
    date,
    createdAt: now(),
  };
  await database.put('logs', log);
  return log;
}

export async function unlogCommitment(commitmentId: string, date: string): Promise<void> {
  const database = await db();
  const existing = await database.getAllFromIndex('logs', 'byCommitment', commitmentId);
  const match = existing.find((log) => log.date === date);
  if (match) await database.delete('logs', match.id);
}

// --- backup --------------------------------------------------------------

/**
 * The whole safety net for local-only storage: browser data is per-device and can be cleared,
 * so the user must always be able to walk away with their city.
 */
export async function exportCity(): Promise<string> {
  const city = await getCity();
  return JSON.stringify({ version: DB_VERSION, exportedAt: now(), ...city }, null, 2);
}

export async function importCity(json: string): Promise<void> {
  const parsed = JSON.parse(json) as Partial<CityData>;
  const database = await db();
  const tx = database.transaction(['entries', 'commitments', 'logs'], 'readwrite');
  for (const entry of parsed.entries ?? []) await tx.objectStore('entries').put(entry);
  for (const commitment of parsed.commitments ?? []) {
    await tx.objectStore('commitments').put(commitment);
  }
  for (const log of parsed.logs ?? []) await tx.objectStore('logs').put(log);
  await tx.done;
}
