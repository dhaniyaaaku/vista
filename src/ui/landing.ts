/**
 * The landing page.
 *
 * An overlay on the live scene rather than a separate page — the city behind it is real, rendering
 * and slowly turning. That matters more than it sounds: it means the product demonstrates itself
 * before anyone signs in, so a sign-in-first door costs a visitor curiosity rather than
 * understanding.
 *
 * It also earns its place technically. The app camera sits high because the city is the subject,
 * and at that angle the horizon is off-screen with nowhere for a sky to exist. The landing camera
 * drops low and pitches up, which is the only framing where the sunset is actually visible.
 */

import { isConfigured } from '../data/supabase';
import { openHowItWorks } from './howItWorks';

export interface LandingActions {
  /** Start the Google OAuth redirect. */
  onSignIn(): Promise<void>;
  /** Only offered when accounts are unavailable, so the app is never unusable. */
  onContinueLocally(): void;
}

export function openLanding(actions: LandingActions): { close: () => void } {
  const root = document.createElement('div');
  root.className = 'landing';

  const inner = document.createElement('div');
  inner.className = 'landing__inner';

  const mark = document.createElement('h1');
  mark.className = 'landing__mark';
  mark.setAttribute('aria-label', 'Vista');
  // Dotless i (U+0131) so the tittle can be replaced with a heart rather than sitting beside one.
  mark.innerHTML =
    '<span aria-hidden="true">v</span>' +
    '<span class="landing__i" aria-hidden="true">ı' +
    '<svg class="landing__heart" viewBox="0 0 24 22" aria-hidden="true">' +
    '<path d="M12 21.6 2.9 12.5A6 6 0 0 1 12 4.9a6 6 0 0 1 9.1 7.6z"/></svg>' +
    '</span>' +
    '<span aria-hidden="true">sta</span>';

  const headline = document.createElement('p');
  headline.className = 'landing__headline';
  headline.textContent = 'a city of your becoming';

  const actionsRow = document.createElement('div');
  actionsRow.className = 'landing__actions';

  const signIn = document.createElement('button');
  signIn.type = 'button';
  signIn.className = 'btn-google';
  // Google's own mark, so the button reads as the standard, trustworthy thing it is.
  signIn.innerHTML =
    '<svg class="btn-google__g" viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.4 17.7 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.2-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.3-4.6 7l7.6 5.9c4.4-4.1 6.7-10.1 6.7-17.4z"/>' +
    '<path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.8-6.1z"/>' +
    '<path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.8 2.3-8.3 2.3-6.3 0-11.7-3.9-13.6-9.7l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/>' +
    '</svg><span>Continue with Google</span>';

  const error = document.createElement('p');
  error.className = 'landing__error';
  error.hidden = true;

  // Only surfaced if accounts genuinely cannot be used, so a broken OAuth config never leaves
  // someone staring at a door they cannot open.
  const fallback = document.createElement('button');
  fallback.type = 'button';
  fallback.className = 'landing__fallback';
  fallback.textContent = 'Continue on this device instead';
  fallback.hidden = isConfigured();

  const label = signIn.querySelector('span')!;
  signIn.addEventListener('click', async () => {
    signIn.disabled = true;
    label.textContent = 'Taking you to Google…';
    try {
      await actions.onSignIn();
    } catch (cause) {
      error.textContent =
        cause instanceof Error ? cause.message : 'Could not reach Google just now.';
      error.hidden = false;
      fallback.hidden = false;
      signIn.disabled = false;
      label.textContent = 'Continue with Google';
    }
  });

  fallback.addEventListener('click', () => close());

  const how = document.createElement('button');
  how.type = 'button';
  how.className = 'landing__how';
  how.textContent = 'How it works';
  how.addEventListener('click', () => openHowItWorks());

  actionsRow.append(signIn, how);

  inner.append(mark, headline, actionsRow, error, fallback);
  root.appendChild(inner);
  document.body.appendChild(root);

  requestAnimationFrame(() => root.classList.add('is-open'));

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    root.classList.remove('is-open');
    const remove = () => {
      root.remove();
      actions.onContinueLocally();
    };
    root.addEventListener('transitionend', remove, { once: true });
    setTimeout(remove, 700);
  }

  return { close };
}
