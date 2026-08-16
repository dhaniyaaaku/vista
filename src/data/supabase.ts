/**
 * Supabase client and session handling.
 *
 * Accounts are entirely optional. Vista works with no Supabase project configured at all — the
 * city just stays on the device — so every export here degrades gracefully rather than throwing
 * when the keys are absent.
 */

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

let client: SupabaseClient | null = null;

/** False when no project is configured, in which case the app stays purely local. */
export function isConfigured(): boolean {
  return Boolean(url && key);
}

export function supabase(): SupabaseClient {
  if (!client) {
    if (!url || !key) throw new Error('Supabase is not configured');
    client = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // The OAuth redirect comes back with the session in the URL fragment.
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}

export async function currentSession(): Promise<Session | null> {
  if (!isConfigured()) return null;
  const { data } = await supabase().auth.getSession();
  return data.session;
}

export function onAuthChange(handler: (session: Session | null) => void): () => void {
  if (!isConfigured()) return () => {};
  const { data } = supabase().auth.onAuthStateChange((_event, session) => handler(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle(): Promise<void> {
  await supabase().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

/** A display name for the account menu. Falls back through the fields Google actually returns. */
export function displayName(session: Session): string {
  const meta = session.user.user_metadata ?? {};
  return (
    (meta.full_name as string | undefined) ??
    (meta.name as string | undefined) ??
    session.user.email ??
    'Signed in'
  );
}
