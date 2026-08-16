/**
 * Row-level security check.
 *
 * The publishable key ships in the browser bundle, so anyone can extract it and call the API
 * directly. This asserts what actually protects the data: that an unauthenticated caller holding
 * that key can neither read nor write anyone's rows.
 *
 * If any of these checks fail, the app is leaking personal entries to the internet.
 *
 *   node scripts/check-rls.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '..', '.env'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const url = env.VITE_SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const TABLES = ['entries', 'commitments', 'commitment_logs'];

for (const table of TABLES) {
  // --- can an anonymous caller read anything? --------------------------
  const read = await fetch(`${url}/rest/v1/${table}?select=*&limit=5`, { headers });
  const body = await read.text();

  if (read.status === 404 || body.includes('does not exist')) {
    check(`${table}: table exists`, false, 'not found — has schema.sql been run?');
    continue;
  }
  check(`${table}: table exists`, true, `HTTP ${read.status}`);

  let rows = [];
  try {
    rows = JSON.parse(body);
  } catch {
    rows = [];
  }
  // RLS with a user_id policy returns an empty set to an anonymous caller rather than an error.
  const blocked = read.status === 401 || read.status === 403 || (Array.isArray(rows) && rows.length === 0);
  check(
    `${table}: anonymous read returns nothing`,
    blocked,
    Array.isArray(rows) ? `${rows.length} row(s) returned` : body.slice(0, 80),
  );

  // --- can an anonymous caller write? ----------------------------------
  const payload =
    table === 'entries'
      ? {
          id: '00000000-0000-4000-8000-00000000dead',
          user_id: '00000000-0000-4000-8000-00000000beef',
          date: '2026-01-01',
          text: 'rls probe',
          category: 'personal',
        }
      : table === 'commitments'
        ? {
            id: '00000000-0000-4000-8000-00000000dead',
            user_id: '00000000-0000-4000-8000-00000000beef',
            name: 'rls probe',
            cadence_times: 1,
            cadence_per: 'day',
          }
        : {
            id: '00000000-0000-4000-8000-00000000dead',
            user_id: '00000000-0000-4000-8000-00000000beef',
            commitment_id: '00000000-0000-4000-8000-00000000dead',
            date: '2026-01-01',
          };

  const write = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  check(
    `${table}: anonymous write is refused`,
    write.status >= 400,
    `HTTP ${write.status}`,
  );
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exitCode = 1;
