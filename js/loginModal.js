// loginModal.js — Real email+password auth modal with Sign Up / Log In views.
// Loaded after app.js. Talks to /api/signup, /api/login, /api/logout, /api/me.
//
// Public API:
//   window._showLoginModal({ initialView?: 'login' | 'signup' })
//   window._hideLoginModal()
//   window._isLoggedIn()              — synchronous, reads cached state
//   window._getLoggedInEmail()        — synchronous, returns email or null
//   window._refreshAuthState()        — async, calls GET /api/me, updates cache
//   window._signOut()                 — async, calls POST /api/logout
//   window._lockPartsPanel / _unlockPartsPanel  (preserved for ui-7 wiring)
//
// Events fired on `window`:
//   robobuilder:login-success  (after signup OR login completes)
//   robobuilder:logout         (after sign-out completes)

(function () {
  'use strict';

  // ── Auth state cache (mirrors server session) ─────────────────────────────
  // Populated on page load by _refreshAuthState() and after every successful
  // login/signup/logout. Persisted to localStorage so other modules
  // (lock-state resolver in app.js) can read synchronously.
  var EMAIL_KEY = 'robobuilder_user_email';

  function isLoggedIn() {
    return !!localStorage.getItem(EMAIL_KEY);
  }
  function getLoggedInEmail() {
    return localStorage.getItem(EMAIL_KEY) || null;
  }
  function setAuthCache(email) {
    if (email) {
      localStorage.setItem(EMAIL_KEY, email);
    } else {
      localStorage.removeItem(EMAIL_KEY);
      // Clean up legacy account record from be-6.
      localStorage.removeItem('robobuilder_user_account');
    }
  }

  // ── Parts panel lock/unlock (kept; ui-7's resolver in app.js uses these) ──
  function lockPartsPanel() {
    var list = document.getElementById('parts-list');
    if (!list || list.classList.contains('parts-locked')) return;
    list.classList.add('parts-locked');
    list.addEventListener('click', _onLockedPanelClick, true);
  }

  function unlockPartsPanel() {
    var list = document.getElementById('parts-list');
    if (!list) return;
    list.classList.remove('parts-locked');
    list.removeEventListener('click', _onLockedPanelClick, true);
  }

  function _onLockedPanelClick(e) {
    var list = document.getElementById('parts-list');
    if (!list || !list.classList.contains('parts-locked')) return;
    var partItem = e.target.closest('.part-item');
    if (partItem) {
      e.stopPropagation();
      e.preventDefault();
      showLoginModal();
    }
  }

  // ── Modal state ───────────────────────────────────────────────────────────
  var overlay = null;
  var isShown = false;
  var currentView = 'login';   // 'login' | 'signup' | 'success'
  var isSubmitting = false;

  // ── Modal DOM ─────────────────────────────────────────────────────────────
  function showLoginModal(opts) {
    if (isShown) return;
    isShown = true;

    overlay = document.getElementById('login-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'login-overlay';
      document.body.appendChild(overlay);
    }
    overlay.removeAttribute('hidden');

    currentView = (opts && opts.initialView === 'signup') ? 'signup' : 'login';
    isSubmitting = false;

    overlay.innerHTML = '';
    var dialog = document.createElement('div');
    dialog.className = 'login-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'login-title');
    overlay.appendChild(dialog);

    renderView();

    // ESC closes the modal (unless mid-submit).
    document.addEventListener('keydown', _onEscKey);

    // Backdrop click closes (but not click on the dialog itself).
    overlay.addEventListener('mousedown', _onBackdropMouseDown);
  }

  function _onEscKey(e) {
    if (e.key === 'Escape' && !isSubmitting) hideLoginModal();
  }

  function _onBackdropMouseDown(e) {
    if (e.target === overlay && !isSubmitting) hideLoginModal();
  }

  function renderView() {
    var dialog = overlay.querySelector('.login-dialog');
    if (!dialog) return;

    if (currentView === 'success') return; // success view sets its own DOM.

    var isSignup = currentView === 'signup';
    var title    = isSignup ? 'Create your account' : 'Welcome back';
    var subtitle = isSignup
      ? 'Save your robots and code to the cloud. Sync across browsers.'
      : 'Sign in to load your saved robots and code.';
    var ctaLabel = isSignup ? 'Create account' : 'Sign in';
    var toggleQ  = isSignup ? 'Already have an account?' : 'Need an account?';
    var toggleA  = isSignup ? 'Sign in' : 'Create one';

    // Animate view swap: fade out, swap content, fade in.
    var inner = dialog.querySelector('.login-card-inner');
    if (inner) {
      inner.classList.add('login-card-inner-out');
      setTimeout(function () { _writeView(); }, 120);
    } else {
      _writeView();
    }

    function _writeView() {
      dialog.innerHTML = [
        '<div class="login-card-inner login-card-inner-in">',
          '<button type="button" class="login-close-btn" id="login-close-btn" aria-label="Close">',
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">',
              '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
            '</svg>',
          '</button>',
          '<div class="login-robot-icon">',
            '<svg width="44" height="44" viewBox="0 0 72 72" aria-hidden="true">',
              '<rect x="16" y="22" width="40" height="30" rx="8" fill="#3B82F6"/>',
              '<circle cx="28" cy="36" r="6" fill="#1E3A5F"/>',
              '<circle cx="44" cy="36" r="6" fill="#1E3A5F"/>',
              '<circle cx="28" cy="36" r="2.5" fill="#93C5FD"/>',
              '<circle cx="44" cy="36" r="2.5" fill="#93C5FD"/>',
              '<line x1="36" y1="6" x2="36" y2="22" stroke="#3B82F6" stroke-width="2.5" stroke-linecap="round"/>',
              '<circle cx="36" cy="6" r="4" fill="#F97316"/>',
            '</svg>',
          '</div>',
          '<h2 class="login-title" id="login-title">' + title + '</h2>',
          '<p class="login-subtitle">' + subtitle + '</p>',
          '<form id="login-form" autocomplete="on" novalidate>',
            '<label class="login-label" for="login-email">Email address</label>',
            '<input type="email" id="login-email" class="login-text-input" placeholder="you@example.com" required autocomplete="email" maxlength="254" />',
            '<label class="login-label" for="login-password">Password</label>',
            '<div class="login-password-wrap">',
              '<input type="password" id="login-password" class="login-text-input" placeholder="' + (isSignup ? 'At least 8 characters' : 'Your password') + '" required autocomplete="' + (isSignup ? 'new-password' : 'current-password') + '" minlength="8" />',
              '<button type="button" class="login-eye-btn" id="login-eye-btn" tabindex="-1" aria-label="Show password">',
                _eyeIconSvg(false),
              '</button>',
            '</div>',
            isSignup ? (
              '<label class="login-label" for="login-password2">Confirm password</label>' +
              '<input type="password" id="login-password2" class="login-text-input" placeholder="Re-enter password" required autocomplete="new-password" minlength="8" />'
            ) : '',
            '<div id="login-error" class="login-error" role="alert"></div>',
            '<button type="submit" class="login-submit" id="login-submit-btn">',
              '<span class="login-submit-label">' + ctaLabel + '</span>',
              '<span class="login-spinner" aria-hidden="true"></span>',
            '</button>',
          '</form>',
          '<div class="login-toggle-row">',
            '<span>' + toggleQ + '</span>',
            '<button type="button" class="login-toggle-link" id="login-toggle-btn">' + toggleA + '</button>',
          '</div>',
        '</div>'
      ].join('');

      _wireFormHandlers();

      // Force layout to ensure the in-animation actually plays.
      var freshInner = dialog.querySelector('.login-card-inner');
      if (freshInner) {
        // eslint-disable-next-line no-unused-expressions
        freshInner.offsetHeight;
        freshInner.classList.remove('login-card-inner-in');
      }

      // Focus the appropriate field.
      setTimeout(function () {
        var emailEl = document.getElementById('login-email');
        if (emailEl) emailEl.focus();
      }, 60);
    }
  }

  function _eyeIconSvg(crossed) {
    if (crossed) {
      return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    }
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function _wireFormHandlers() {
    var form        = document.getElementById('login-form');
    var emailIn     = document.getElementById('login-email');
    var pwIn        = document.getElementById('login-password');
    var pw2In       = document.getElementById('login-password2');  // signup only
    var errorEl     = document.getElementById('login-error');
    var submitBtn   = document.getElementById('login-submit-btn');
    var toggleBtn   = document.getElementById('login-toggle-btn');
    var closeBtn    = document.getElementById('login-close-btn');
    var eyeBtn      = document.getElementById('login-eye-btn');

    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        if (!isSubmitting) hideLoginModal();
      });
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        if (isSubmitting) return;
        currentView = (currentView === 'signup') ? 'login' : 'signup';
        renderView();
      });
    }

    if (eyeBtn && pwIn) {
      eyeBtn.addEventListener('click', function () {
        var nowText = pwIn.type === 'password';
        pwIn.type = nowText ? 'text' : 'password';
        if (pw2In) pw2In.type = nowText ? 'text' : 'password';
        eyeBtn.innerHTML = _eyeIconSvg(nowText);
        eyeBtn.setAttribute('aria-label', nowText ? 'Hide password' : 'Show password');
      });
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        _submit({
          email:    (emailIn.value || '').trim().toLowerCase(),
          password: pwIn.value || '',
          password2: pw2In ? (pw2In.value || '') : null,
          isSignup: currentView === 'signup',
          errorEl: errorEl,
          submitBtn: submitBtn,
          form: form
        });
      });
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  function _submit(ctx) {
    var errorEl   = ctx.errorEl;
    var submitBtn = ctx.submitBtn;
    var form      = ctx.form;
    errorEl.textContent = '';
    errorEl.classList.remove('login-error-visible');

    // ── Client-side validation ──────────────────────────────────────────────
    if (!ctx.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.email)) {
      return _showError(errorEl, 'Please enter a valid email address.');
    }
    if (ctx.email.length > 254) {
      return _showError(errorEl, 'That email is too long.');
    }
    if (!ctx.password || ctx.password.length < 8) {
      return _showError(errorEl, 'Password must be at least 8 characters.');
    }
    if (ctx.password.length > 200) {
      return _showError(errorEl, 'Password is too long.');
    }
    if (ctx.isSignup && ctx.password !== ctx.password2) {
      return _showError(errorEl, 'Passwords don\'t match.');
    }

    // ── Lock the form ──────────────────────────────────────────────────────
    isSubmitting = true;
    form.classList.add('login-form-loading');
    submitBtn.disabled = true;

    var endpoint = ctx.isSignup ? '/api/signup' : '/api/login';

    fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ctx.email, password: ctx.password })
    }).then(function (resp) {
      // Always parse JSON (server returns JSON for success and error).
      return resp.json().then(function (body) {
        return { ok: resp.ok, status: resp.status, body: body };
      }).catch(function () {
        return { ok: resp.ok, status: resp.status, body: { error: 'Server returned an unreadable response.' } };
      });
    }).then(function (r) {
      isSubmitting = false;
      form.classList.remove('login-form-loading');
      submitBtn.disabled = false;

      if (!r.ok) {
        // Server-supplied error message takes precedence.
        var msg = (r.body && r.body.error) || 'Something went wrong. Try again.';
        return _showError(errorEl, msg);
      }

      // Success: cache the email, fire login-success, hydrate from server.
      setAuthCache(ctx.email);
      _showSuccess(ctx.isSignup);

      // Notify the rest of the app (parts-panel resolver, nav button, cloudSync).
      window.dispatchEvent(new CustomEvent('robobuilder:login-success', {
        detail: { email: ctx.email, isSignup: ctx.isSignup }
      }));

      // Trigger a sync hydration if cloudSync is loaded.
      if (window._cloudSyncHydrate) {
        window._cloudSyncHydrate({ pushLocalIfRemoteEmpty: ctx.isSignup })
          .catch(function (err) {
            console.warn('[loginModal] Sync hydration failed:', err);
          });
      }
    }).catch(function (err) {
      isSubmitting = false;
      form.classList.remove('login-form-loading');
      submitBtn.disabled = false;
      _showError(errorEl, 'Network error. Is the server running?');
      console.warn('[loginModal] Submit failed:', err);
    });
  }

  function _showError(errorEl, msg) {
    errorEl.textContent = msg;
    errorEl.classList.add('login-error-visible');
  }

  function _showSuccess(isSignup) {
    var dialog = overlay.querySelector('.login-dialog');
    if (!dialog) return;
    currentView = 'success';
    dialog.innerHTML = [
      '<div class="login-card-inner login-success">',
        '<div class="login-success-check" aria-hidden="true">',
          '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">',
            '<polyline points="20 6 9 17 4 12"/>',
          '</svg>',
        '</div>',
        '<h2 class="login-title">' + (isSignup ? 'Account created!' : 'Signed in!') + '</h2>',
        '<p class="login-subtitle">' + (isSignup
          ? 'Your robots and code will sync across browsers automatically.'
          : 'Loading your saved robot and code…') + '</p>',
        '<button type="button" class="login-submit" id="login-done-btn">',
          '<span class="login-submit-label">Start building</span>',
        '</button>',
      '</div>'
    ].join('');
    var doneBtn = document.getElementById('login-done-btn');
    if (doneBtn) doneBtn.addEventListener('click', hideLoginModal);
    // Auto-close if the user doesn't click within 2.5s.
    setTimeout(function () { if (currentView === 'success') hideLoginModal(); }, 2500);
  }

  function hideLoginModal() {
    isShown = false;
    isSubmitting = false;
    if (overlay) {
      overlay.setAttribute('hidden', '');
      overlay.innerHTML = '';
      overlay.removeEventListener('mousedown', _onBackdropMouseDown);
    }
    document.removeEventListener('keydown', _onEscKey);
  }

  // ── Refresh cached auth state from server (called on page load) ──────────
  function refreshAuthState() {
    return fetch('/api/me', { credentials: 'include' })
      .then(function (resp) {
        if (resp.ok) return resp.json();
        return null;
      })
      .then(function (body) {
        var prev = getLoggedInEmail();
        if (body && body.email) {
          setAuthCache(body.email);
          if (prev !== body.email) {
            // First confirmation of session this load — fire login-success
            // so cloudSync hydrates and the lock resolver re-evaluates.
            window.dispatchEvent(new CustomEvent('robobuilder:login-success', {
              detail: { email: body.email, isSignup: false, fromSession: true }
            }));
          }
          return body.email;
        } else {
          // Server says no session. If we had a stale local email, clear it.
          if (prev) {
            setAuthCache(null);
            window.dispatchEvent(new CustomEvent('robobuilder:logout'));
          }
          return null;
        }
      })
      .catch(function () {
        // Network down — keep whatever's cached locally so the UI doesn't
        // unexpectedly log the user out due to a transient failure.
        return null;
      });
  }

  // ── Sign out ──────────────────────────────────────────────────────────────
  function signOut() {
    return fetch('/api/logout', { method: 'POST', credentials: 'include' })
      .catch(function () { /* even if it fails, clear locally */ })
      .then(function () {
        setAuthCache(null);
        window.dispatchEvent(new CustomEvent('robobuilder:logout'));
      });
  }

  // ── Expose globals ────────────────────────────────────────────────────────
  window._showLoginModal     = showLoginModal;
  window._hideLoginModal     = hideLoginModal;
  window._isLoggedIn         = isLoggedIn;
  window._getLoggedInEmail   = getLoggedInEmail;
  window._refreshAuthState   = refreshAuthState;
  window._signOut            = signOut;
  window._lockPartsPanel     = lockPartsPanel;
  window._unlockPartsPanel   = unlockPartsPanel;

  // ── Boot: restore session on page load ────────────────────────────────────
  // Run after the rest of app.js wires its login-success listener.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(refreshAuthState, 0);
  } else {
    window.addEventListener('DOMContentLoaded', function () {
      setTimeout(refreshAuthState, 0);
    });
  }
})();
