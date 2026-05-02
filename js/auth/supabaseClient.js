// supabaseClient.js — Initializes the Supabase JS client and exposes it on
// `window.supabase` so the rest of the app (loginModal, cloudSync, app.js)
// can read it synchronously.
//
// IMPORTANT — ONE-TIME SETUP (must be done before login will work):
//   1. Create a free project at https://supabase.com.
//   2. In the Supabase SQL editor, run db/supabase_init.sql (creates the
//      `saves` table and Row-Level Security policies).
//   3. In Authentication → URL Configuration, set BOTH the Site URL and the
//      Redirect URLs to include your production URL (e.g. the GitHub Pages
//      URL `https://<user>.github.io/<repo>/`) AND `http://localhost:3000`
//      so local dev keeps working.
//   4. Copy your Project URL and anon (public) key from Project Settings →
//      API and paste them into the two constants below, replacing the
//      `PASTE_YOUR_..._HERE` placeholders.
//
// The anon key is meant to be public — Row-Level Security on the `saves`
// table enforces per-user data isolation server-side.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─────────────────────────────────────────────────────────────────────────────
// PASTE YOUR SUPABASE PROJECT VALUES HERE.
// ─────────────────────────────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://yeqwzsltttobjgsumuxk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllcXd6c2x0dHRvYmpnc3VtdXhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1OTQyNTYsImV4cCI6MjA5MzE3MDI1Nn0.nSlD3oI1yw02QxqI7oRQl_IxGvQvVWWcepUtjnrfKdU';
// ─────────────────────────────────────────────────────────────────────────────

// Detect whether the user has wired up the placeholders yet. This drives a
// gentle warning in the modal/console so a fresh clone shows a useful error
// instead of an opaque network failure.
const _isConfigured =
  typeof SUPABASE_URL === 'string' &&
  SUPABASE_URL.startsWith('https://') &&
  SUPABASE_URL.indexOf('PASTE_YOUR_') === -1 &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  SUPABASE_ANON_KEY.length > 20 &&
  SUPABASE_ANON_KEY.indexOf('PASTE_YOUR_') === -1;

let _client = null;
if (_isConfigured) {
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // Persist the session in localStorage so it survives page reloads.
      persistSession: true,
      // Refresh access tokens automatically before they expire.
      autoRefreshToken: true,
      // We handle the email-verification ?code=... redirect ourselves below
      // (so we can also clean up the URL afterwards). Disable the library's
      // automatic version to avoid double-handling.
      detectSessionInUrl: false,
      storage: window.localStorage,
    },
  });
} else {
  console.warn(
    '[supabaseClient] Supabase is NOT configured. Open js/supabaseClient.js ' +
    'and paste your Project URL + anon key into SUPABASE_URL and ' +
    'SUPABASE_ANON_KEY. Until then, login and cloud sync will not work.'
  );
}

// Expose synchronously so non-module scripts (loginModal, cloudSync, app.js)
// can read window.supabase right away. Module scripts defer by default, but
// the consumers all use the value at event time, not at parse time.
window.supabase = _client;
window._supabaseConfigured = _isConfigured;

// ── Email-verification / password-recovery callback handler ────────────────
// When the user clicks the "Confirm your email" or "Reset password" link in
// their inbox, Supabase redirects them back to the Site URL with one of:
//   ?code=<oauth-style code>          (PKCE flow — current default)
//   #access_token=...&refresh_token=  (legacy hash flow)
// We handle both, exchange for a session, and clean the URL.
async function _handleAuthRedirect() {
  if (!_client) return;
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const hasHashTokens = window.location.hash &&
      window.location.hash.indexOf('access_token=') !== -1;

    if (code) {
      const { error } = await _client.auth.exchangeCodeForSession(window.location.href);
      if (error) {
        console.warn('[supabaseClient] exchangeCodeForSession failed:', error.message);
      }
      // Strip ?code=... (and any siblings) from the URL bar so a refresh
      // doesn't try to re-exchange the (now-spent) code.
      url.searchParams.delete('code');
      // Also strip Supabase's other typical params if present.
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      url.searchParams.delete('error_code');
      window.history.replaceState({}, document.title, url.pathname + (url.search ? url.search : '') + url.hash);
    } else if (hasHashTokens) {
      // Hash-based flow: getSessionFromUrl is gone in v2 — calling getSession
      // after the SDK has parsed the hash is enough when detectSessionInUrl
      // is on. We disabled it, so fall back to manual parse.
      const params = new URLSearchParams(window.location.hash.slice(1));
      const access_token  = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) {
        const { error } = await _client.auth.setSession({ access_token, refresh_token });
        if (error) console.warn('[supabaseClient] setSession from hash failed:', error.message);
      }
      // Clean the hash.
      window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    }
  } catch (e) {
    console.warn('[supabaseClient] Auth redirect handling threw:', e);
  }
}

// Run on load (module scripts execute after DOMContentLoaded firing, so the
// DOM is ready by the time this runs).
_handleAuthRedirect();
