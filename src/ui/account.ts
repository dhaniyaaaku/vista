/**
 * The account panel.
 *
 * Signing in is optional and the copy says so plainly. Vista works with no account at all; what
 * an account buys is the same city on more than one device, and a copy that survives clearing
 * your browser. Nothing about the product is gated behind it.
 */

import type { Session } from '@supabase/supabase-js';
import { displayName, isConfigured, signInWithGoogle, signOut } from '../data/supabase';
import { syncCity, type SyncResult } from '../data/sync';
import { Panel } from './panel';

export interface AccountActions {
  session(): Session | null;
  onSynced(): Promise<void>;
}

export function openAccount(actions: AccountActions): void {
  const session = actions.session();

  const panel = new Panel({
    title: session ? 'Your account' : 'Sign in',
    subtitle: session
      ? 'Your city is backed up and follows you between devices.'
      : 'Optional. Vista works without an account — signing in just means your city is not stuck in this one browser.',
  });

  const wrap = document.createElement('div');
  wrap.className = 'settings';

  const note = document.createElement('p');
  note.className = 'settings__note';
  note.setAttribute('role', 'status');

  if (!isConfigured()) {
    const unavailable = document.createElement('p');
    unavailable.className = 'empty';
    unavailable.textContent =
      'Accounts are not configured for this build. Your city lives in this browser only — use Settings to download a backup.';
    wrap.appendChild(unavailable);
    panel.body.appendChild(wrap);
    return;
  }

  if (!session) {
    const explain = document.createElement('p');
    explain.className = 'empty';
    explain.textContent =
      'We use Google so there is no password to store, reset, or lose. Vista never sees your Google credentials, and your entries stay readable only by you.';

    const google = document.createElement('button');
    google.type = 'button';
    google.className = 'btn btn--primary';
    google.textContent = 'Continue with Google';
    google.addEventListener('click', async () => {
      google.disabled = true;
      google.textContent = 'Redirecting…';
      try {
        await signInWithGoogle();
      } catch (cause) {
        note.textContent = cause instanceof Error ? cause.message : 'Could not start sign-in.';
        google.disabled = false;
        google.textContent = 'Continue with Google';
      }
    });

    wrap.append(explain, google, note);
    panel.body.appendChild(wrap);
    panel.focusFirst();
    return;
  }

  // --- signed in --------------------------------------------------------

  const who = document.createElement('div');
  who.className = 'settings__row';
  const whoName = document.createElement('div');
  whoName.className = 'settings__heading';
  whoName.textContent = displayName(session);
  const whoDesc = document.createElement('p');
  whoDesc.className = 'settings__desc';
  whoDesc.textContent =
    'Merging is additive: your device and your account are combined, and nothing is deleted by syncing.';
  who.append(whoName, whoDesc);

  const sync = document.createElement('button');
  sync.type = 'button';
  sync.className = 'btn';
  sync.textContent = 'Sync now';
  sync.addEventListener('click', async () => {
    sync.disabled = true;
    sync.textContent = 'Syncing…';
    try {
      const result: SyncResult = await syncCity(session.user.id);
      await actions.onSynced();
      note.textContent = `Synced ${result.entries} wins, ${result.commitments} commitments, ${result.logs} completions.`;
    } catch (cause) {
      note.textContent = cause instanceof Error ? cause.message : 'Sync failed.';
    } finally {
      sync.disabled = false;
      sync.textContent = 'Sync now';
    }
  });

  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'btn';
  out.textContent = 'Sign out';
  out.addEventListener('click', async () => {
    out.disabled = true;
    await signOut();
    panel.close();
  });

  who.append(sync, out);
  wrap.append(who, note);
  panel.body.appendChild(wrap);
  panel.focusFirst();
}
