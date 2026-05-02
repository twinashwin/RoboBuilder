// loginModal.js — Email + password auth modal backed by Supabase.
// Loaded after app.js. Reads window.supabase (set by js/supabaseClient.js).
//
// Public API:
//   window._showLoginModal({ initialView?: 'login' | 'signup' })
//   window._hideLoginModal()
//   window._isLoggedIn()              — synchronous, reads cached state
//   window._getLoggedInEmail()        — synchronous, returns email or null
//   window._refreshAuthState()        — async, calls supabase.auth.getSession()
//   window._signOut()                 — async, calls supabase.auth.signOut()
//   window._lockPartsPanel / _unlockPartsPanel  (preserved for ui-7 wiring)
//
// Events fired on `window`:
//   robobuilder:login-success  (after signup OR login completes — but NOT for
//                               the signup pre-verification step, which uses
//                               its own "check your email" view)
//   robobuilder:logout         (after sign-out completes)

(function () {
  'use strict';

  // ── Auth state cache (mirrors Supabase session) ───────────────────────────
  // Populated on page load by _refreshAuthState() and after every successful
  // login/logout. Persisted to localStorage so other modules (lock-state
  // resolver in app.js) can read synchronously without awaiting Supabase.
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

  function getSupabase() {
    return window.supabase || null;
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
  var currentView = 'login';   // 'login' | 'signup' | 'success' | 'verify-sent' | 'reset-sent'
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

    if (currentView === 'success' || currentView === 'verify-sent' || currentView === 'reset-sent') {
      // Those views set their own DOM via their dedicated render fn.
      return;
    }

    var isSignup = currentView === 'signup';
    var title    = isSignup ? 'Create your account' : 'Welcome back';
    var subtitle = isSignup
      ? 'Save your robots and code to the cloud. Sync across browsers.'
      : 'Sign in to load your saved robots and code.';
    var ctaLabel = isSignup ? 'Create account' : 'Sign in';
    var toggleQ  = isSignup ? 'Already have an account?' : 'Need an account?';
    var toggleA  = isSignup ? 'Sign in' : 'Create one';

    var notConfigured = !window._supabaseConfigured;

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
          notConfigured ? (
            '<div class="login-config-warn" role="alert">' +
              'Supabase is not configured yet. Open <code>js/supabaseClient.js</code> and paste your Project URL and anon key.' +
            '</div>'
          ) : '',
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
            !isSignup ? (
              '<div class="login-forgot-row">' +
                '<button type="button" class="login-forgot-link" id="login-forgot-btn">Forgot password?</button>' +
              '</div>'
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
    var forgotBtn   = document.getElementById('login-forgot-btn');

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

    if (forgotBtn) {
      forgotBtn.addEventListener('click', function () {
        if (isSubmitting) return;
        _onForgotPassword({
          email: (emailIn.value || '').trim().toLowerCase(),
          errorEl: errorEl
        });
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

    var sb = getSupabase();
    if (!sb) {
      return _showError(errorEl, 'Supabase is not configured. See js/supabaseClient.js.');
    }

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

    var op = ctx.isSignup
      ? sb.auth.signUp({
          email: ctx.email,
          password: ctx.password,
          options: {
            // After the user clicks the "confirm your email" link, send them
            // back to whatever URL the app is currently served from.
            emailRedirectTo: window.location.origin + window.location.pathname,
          }
        })
      : sb.auth.signInWithPassword({ email: ctx.email, password: ctx.password });

    op.then(function (resp) {
      isSubmitting = false;
      form.classList.remove('login-form-loading');
      submitBtn.disabled = false;

      if (resp.error) {
        return _showError(errorEl, resp.error.message || 'Something went wrong. Try again.');
      }

      var data = resp.data || {};
      var session = data.session || null;
      var user    = data.user    || null;

      if (ctx.isSignup) {
        // Two cases for signup:
        //  - "Confirm email" enabled (default): session is null, user exists.
        //    Show "check your email" state.
        //  - "Confirm email" disabled: session is non-null. Treat as login.
        if (!session) {
          _showVerifySent(ctx.email);
          return;
        }
        // Else: fall through to login-success path.
      }

      // Login success path (or signup with auto-confirm). The
      // onAuthStateChange listener below will also fire for SIGNED_IN — we
      // do the cache update + login-success event right here for immediate
      // UI feedback, and the listener guards against firing twice.
      var emailToCache = (user && user.email) || ctx.email;
      setAuthCache(emailToCache);
      _showSuccess(ctx.isSignup);

      window.dispatchEvent(new CustomEvent('robobuilder:login-success', {
        detail: { email: emailToCache, isSignup: ctx.isSignup }
      }));
    }, function (err) {
      isSubmitting = false;
      form.classList.remove('login-form-loading');
      submitBtn.disabled = false;
      _showError(errorEl, (err && err.message) || 'Network error. Check your connection.');
      console.warn('[loginModal] Submit failed:', err);
    });
  }

  function _onForgotPassword(ctx) {
    var sb = getSupabase();
    if (!sb) return _showError(ctx.errorEl, 'Supabase is not configured.');
    if (!ctx.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ctx.email)) {
      return _showError(ctx.errorEl, 'Enter your email above first, then click "Forgot password?".');
    }
    sb.auth.resetPasswordForEmail(ctx.email, {
      redirectTo: window.location.origin + window.location.pathname
    }).then(function (resp) {
      if (resp.error) return _showError(ctx.errorEl, resp.error.message);
      _showResetSent(ctx.email);
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
        '<h2 class="login-title">' + (isSignup ? 'Account ready!' : 'Signed in!') + '</h2>',
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

  function _showVerifySent(email) {
    var dialog = overlay.querySelector('.login-dialog');
    if (!dialog) return;
    currentView = 'verify-sent';
    dialog.innerHTML = [
      '<div class="login-card-inner login-success">',
        '<button type="button" class="login-close-btn" id="login-close-btn" aria-label="Close">',
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">',
            '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
          '</svg>',
        '</button>',
        '<div class="login-success-check login-verify-icon" aria-hidden="true">',
          '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">',
            '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>',
            '<polyline points="22,6 12,13 2,6"/>',
          '</svg>',
        '</div>',
        '<h2 class="login-title">Check your email</h2>',
        '<p class="login-subtitle">' +
          'We sent a confirmation link to <strong>' + _escapeHtml(email) + '</strong>. ' +
          'Click it to verify your account, then come back here to sign in.' +
        '</p>',
        '<p class="login-fineprint">Tip: it can take a minute. Check your spam folder.</p>',
        '<button type="button" class="login-submit" id="login-done-btn">',
          '<span class="login-submit-label">Got it</span>',
        '</button>',
      '</div>'
    ].join('');
    var doneBtn = document.getElementById('login-done-btn');
    if (doneBtn) doneBtn.addEventListener('click', hideLoginModal);
    var closeBtn = document.getElementById('login-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', hideLoginModal);
  }

  function _showResetSent(email) {
    var dialog = overlay.querySelector('.login-dialog');
    if (!dialog) return;
    currentView = 'reset-sent';
    dialog.innerHTML = [
      '<div class="login-card-inner login-success">',
        '<button type="button" class="login-close-btn" id="login-close-btn" aria-label="Close">',
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">',
            '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
          '</svg>',
        '</button>',
        '<div class="login-success-check login-verify-icon" aria-hidden="true">',
          '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">',
            '<rect x="3" y="11" width="18" height="11" rx="2"/>',
            '<path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
          '</svg>',
        '</div>',
        '<h2 class="login-title">Reset link sent</h2>',
        '<p class="login-subtitle">' +
          'We emailed a password reset link to <strong>' + _escapeHtml(email) + '</strong>. ' +
          'Click the link to set a new password.' +
        '</p>',
        '<button type="button" class="login-submit" id="login-done-btn">',
          '<span class="login-submit-label">Got it</span>',
        '</button>',
      '</div>'
    ].join('');
    var doneBtn = document.getElementById('login-done-btn');
    if (doneBtn) doneBtn.addEventListener('click', hideLoginModal);
    var closeBtn = document.getElementById('login-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', hideLoginModal);
  }

  function _escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  // ── Refresh cached auth state from Supabase (called on page load) ─────────
  function refreshAuthState() {
    var sb = getSupabase();
    if (!sb) return Promise.resolve(null);
    return sb.auth.getSession().then(function (resp) {
      var prev = getLoggedInEmail();
      var session = (resp && resp.data && resp.data.session) || null;
      var email = (session && session.user && session.user.email) || null;
      if (email) {
        setAuthCache(email);
        if (prev !== email) {
          // First confirmation of session this load — fire login-success
          // so cloudSync hydrates and the lock resolver re-evaluates.
          window.dispatchEvent(new CustomEvent('robobuilder:login-success', {
            detail: { email: email, isSignup: false, fromSession: true }
          }));
        }
        return email;
      } else {
        if (prev) {
          setAuthCache(null);
          window.dispatchEvent(new CustomEvent('robobuilder:logout'));
        }
        return null;
      }
    }).catch(function () {
      // Network/SDK error — keep whatever's cached locally so the UI doesn't
      // unexpectedly log the user out due to a transient failure.
      return null;
    });
  }

  // ── Sign out ──────────────────────────────────────────────────────────────
  function signOut() {
    var sb = getSupabase();
    var op = sb ? sb.auth.signOut() : Promise.resolve();
    return op.catch(function () { /* even if it fails, clear locally */ })
      .then(function () {
        setAuthCache(null);
        window.dispatchEvent(new CustomEvent('robobuilder:logout'));
      });
  }

  // ── Listen for auth-state changes from Supabase (token refresh, multi-tab,
  //    email-verification redirect) and bridge to the existing event bus. ──
  // We poll for window.supabase because the Supabase module is a deferred
  // module script — it might not be ready yet at IIFE parse time.
  function _attachAuthListener() {
    var sb = getSupabase();
    if (!sb) {
      // Try again after the module script has executed.
      setTimeout(_attachAuthListener, 50);
      return;
    }
    sb.auth.onAuthStateChange(function (event, session) {
      var email = (session && session.user && session.user.email) || null;
      var cached = getLoggedInEmail();

      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && email) {
        if (cached !== email) {
          setAuthCache(email);
          window.dispatchEvent(new CustomEvent('robobuilder:login-success', {
            detail: { email: email, isSignup: false, fromAuthChange: true }
          }));
        }
      } else if (event === 'SIGNED_OUT') {
        if (cached) {
          setAuthCache(null);
          window.dispatchEvent(new CustomEvent('robobuilder:logout'));
        }
      } else if (event === 'PASSWORD_RECOVERY') {
        // Supabase fires this when the user lands back on the page from a
        // password-reset email. Surface a simple prompt.
        _promptNewPassword();
      }
    });
  }

  function _promptNewPassword() {
    // Open a modal for setting a new password. We use the same dialog
    // chrome but with a tiny custom form.
    if (isShown) hideLoginModal();
    isShown = true;
    overlay = document.getElementById('login-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'login-overlay';
      document.body.appendChild(overlay);
    }
    overlay.removeAttribute('hidden');
    overlay.innerHTML = '';
    var dialog = document.createElement('div');
    dialog.className = 'login-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    overlay.appendChild(dialog);

    dialog.innerHTML = [
      '<div class="login-card-inner">',
        '<button type="button" class="login-close-btn" id="login-close-btn" aria-label="Close">',
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">',
            '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
          '</svg>',
        '</button>',
        '<h2 class="login-title">Set a new password</h2>',
        '<p class="login-subtitle">Enter a new password for your account.</p>',
        '<form id="login-form" novalidate>',
          '<label class="login-label" for="login-password">New password</label>',
          '<input type="password" id="login-password" class="login-text-input" placeholder="At least 8 characters" required minlength="8" />',
          '<label class="login-label" for="login-password2">Confirm new password</label>',
          '<input type="password" id="login-password2" class="login-text-input" placeholder="Re-enter password" required minlength="8" />',
          '<div id="login-error" class="login-error" role="alert"></div>',
          '<button type="submit" class="login-submit" id="login-submit-btn">',
            '<span class="login-submit-label">Update password</span>',
            '<span class="login-spinner" aria-hidden="true"></span>',
          '</button>',
        '</form>',
      '</div>'
    ].join('');

    document.getElementById('login-close-btn').addEventListener('click', hideLoginModal);
    var form = document.getElementById('login-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw  = document.getElementById('login-password').value || '';
      var pw2 = document.getElementById('login-password2').value || '';
      var errorEl = document.getElementById('login-error');
      var submitBtn = document.getElementById('login-submit-btn');
      if (pw.length < 8) return _showError(errorEl, 'Password must be at least 8 characters.');
      if (pw !== pw2)   return _showError(errorEl, 'Passwords don\'t match.');
      var sb = getSupabase();
      if (!sb) return _showError(errorEl, 'Supabase is not configured.');
      submitBtn.disabled = true;
      form.classList.add('login-form-loading');
      sb.auth.updateUser({ password: pw }).then(function (resp) {
        submitBtn.disabled = false;
        form.classList.remove('login-form-loading');
        if (resp.error) return _showError(errorEl, resp.error.message);
        _showSuccess(false);
      });
    });
    document.addEventListener('keydown', _onEscKey);
    overlay.addEventListener('mousedown', _onBackdropMouseDown);
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

  // ── Boot: restore session on page load + attach auth-change listener ─────
  _attachAuthListener();
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(refreshAuthState, 0);
  } else {
    window.addEventListener('DOMContentLoaded', function () {
      setTimeout(refreshAuthState, 0);
    });
  }
})();
