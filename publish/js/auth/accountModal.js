// accountModal.js — Full-screen Account Details modal.
// Modeled on Linear / Vercel / GitHub account-settings UIs: a left vertical
// section nav and a right pane with the active section's content.
//
// Loaded after loginModal.js. Reads window.supabase (set by supabaseClient.js).
//
// Public API:
//   window._showAccountModal()      — opens the modal at the default section
//   window._showAccountModal('security')  — opens at a specific section id
//   window._hideAccountModal()      — closes the modal
//
// Sections: 'profile' | 'security' | 'preferences' | 'data'
//
// Persistence:
//   - email is read from the cached auth state (supabase session)
//   - preferences are stored in the existing `saves` table's new
//     `preferences` jsonb column (see db/supabase_init.sql)

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────
  var overlay = null;
  var isShown = false;
  var currentSection = 'profile';
  var preferences = null;       // cached after first load
  var preferencesLoading = false;
  var _previousActiveEl = null;

  var DEFAULT_PREFS = {
    transactional: {
      securityAlerts: true,    // (transactional, can't actually be turned off
                               //  for legal/operational reasons — locked UI)
      productUpdates: true,    // important product notices (still transactional)
    },
    marketing: {
      tipsAndTutorials: false, // CAN-SPAM-style separate marketing toggle
    },
  };

  function getSupabase() { return window.supabase || null; }
  function isLoggedIn()  { return !!(window._isLoggedIn && window._isLoggedIn()); }
  function getEmail()    { return (window._getLoggedInEmail && window._getLoggedInEmail()) || ''; }

  // ── Show / hide ──────────────────────────────────────────────────────────
  function showAccountModal(sectionId) {
    if (!isLoggedIn()) {
      // Defensive: this modal is only meaningful when authed. Open the login
      // modal instead.
      if (window._showLoginModal) window._showLoginModal({ initialView: 'login' });
      return;
    }
    if (isShown) {
      // Already open — just switch section if requested.
      if (sectionId) selectSection(sectionId);
      return;
    }

    isShown = true;
    currentSection = (sectionId && _isValidSection(sectionId)) ? sectionId : 'profile';
    _previousActiveEl = document.activeElement;

    overlay = document.getElementById('account-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'account-overlay';
      document.body.appendChild(overlay);
    }
    overlay.removeAttribute('hidden');
    overlay.innerHTML = '';

    var dialog = document.createElement('div');
    dialog.className = 'account-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'account-dialog-title');
    overlay.appendChild(dialog);

    dialog.innerHTML = _renderShell();

    _wireShell();
    _renderActiveSection();

    document.addEventListener('keydown', _onEsc);
    overlay.addEventListener('mousedown', _onBackdropMouseDown);

    // Begin loading preferences (only need to fetch once per open).
    if (preferences === null) _loadPreferences();
  }

  function hideAccountModal() {
    if (!isShown) return;
    isShown = false;
    if (overlay) {
      overlay.setAttribute('hidden', '');
      overlay.innerHTML = '';
      overlay.removeEventListener('mousedown', _onBackdropMouseDown);
    }
    document.removeEventListener('keydown', _onEsc);
    // Restore focus to whatever launched the modal.
    if (_previousActiveEl && typeof _previousActiveEl.focus === 'function') {
      try { _previousActiveEl.focus(); } catch (e) { /* ignore */ }
    }
    _previousActiveEl = null;
  }

  function _onEsc(e) {
    if (e.key === 'Escape') hideAccountModal();
  }
  function _onBackdropMouseDown(e) {
    if (e.target === overlay) hideAccountModal();
  }

  function _isValidSection(id) {
    return id === 'profile' || id === 'security' || id === 'preferences' || id === 'data';
  }

  function selectSection(id) {
    if (!_isValidSection(id)) return;
    currentSection = id;
    var nav = document.querySelectorAll('.account-nav-item');
    nav.forEach(function (b) {
      var on = b.dataset.section === id;
      b.classList.toggle('account-nav-item-active', on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
    });
    _renderActiveSection();
  }

  // ── Shell ────────────────────────────────────────────────────────────────
  function _renderShell() {
    var email = getEmail();
    var initial = (email[0] || '?').toUpperCase();
    return [
      '<aside class="account-sidebar">',
        '<header class="account-sidebar-header">',
          '<div class="account-avatar" aria-hidden="true">' + _escapeHtml(initial) + '</div>',
          '<div class="account-sidebar-meta">',
            '<div class="account-sidebar-label">Signed in as</div>',
            '<div class="account-sidebar-email" title="' + _escapeHtml(email) + '">' + _escapeHtml(email) + '</div>',
          '</div>',
        '</header>',
        '<nav class="account-nav" aria-label="Account settings">',
          _navItem('profile',     'Profile',          _iconUser()),
          _navItem('security',    'Security',         _iconShield()),
          _navItem('preferences', 'Email preferences', _iconBell()),
          _navItem('data',        'Data & privacy',   _iconDatabase()),
        '</nav>',
        '<footer class="account-sidebar-footer">',
          '<button type="button" class="account-nav-item account-nav-item-signout" id="account-nav-signout">',
            _iconSignOut() + '<span>Sign out</span>',
          '</button>',
        '</footer>',
      '</aside>',
      '<main class="account-main" id="account-main" tabindex="-1">',
        '<header class="account-main-header">',
          '<h2 class="account-title" id="account-dialog-title">Account</h2>',
          '<button type="button" class="account-close-btn" id="account-close-btn" aria-label="Close">',
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">',
              '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
            '</svg>',
          '</button>',
        '</header>',
        '<div class="account-section" id="account-section"></div>',
      '</main>'
    ].join('');
  }

  function _navItem(id, label, iconSvg) {
    var on = id === currentSection;
    return [
      '<button type="button" class="account-nav-item' + (on ? ' account-nav-item-active' : '') + '" ',
        'data-section="' + id + '" aria-current="' + (on ? 'page' : 'false') + '">',
        iconSvg, '<span>' + label + '</span>',
      '</button>'
    ].join('');
  }

  function _wireShell() {
    var navBtns = document.querySelectorAll('.account-nav-item[data-section]');
    navBtns.forEach(function (b) {
      b.addEventListener('click', function () { selectSection(b.dataset.section); });
    });
    document.getElementById('account-close-btn').addEventListener('click', hideAccountModal);
    var signOut = document.getElementById('account-nav-signout');
    if (signOut) signOut.addEventListener('click', function () {
      hideAccountModal();
      if (window._signOut) window._signOut();
    });
  }

  // ── Active section dispatcher ────────────────────────────────────────────
  function _renderActiveSection() {
    var pane = document.getElementById('account-section');
    if (!pane) return;
    if (currentSection === 'profile')      _renderProfileSection(pane);
    else if (currentSection === 'security')    _renderSecuritySection(pane);
    else if (currentSection === 'preferences') _renderPreferencesSection(pane);
    else if (currentSection === 'data')        _renderDataSection(pane);
    // Move focus into the pane heading for screen-reader continuity.
    var firstHeading = pane.querySelector('h3');
    if (firstHeading) {
      firstHeading.setAttribute('tabindex', '-1');
      // Don't actually steal focus on every nav switch — disrupts keyboard
      // users who tabbed to the nav. Just ensure heading is focusable.
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  PROFILE
  // ──────────────────────────────────────────────────────────────────────────
  function _renderProfileSection(pane) {
    var email = getEmail();
    pane.innerHTML = [
      '<div class="account-section-head">',
        '<h3 class="account-section-title">Profile</h3>',
        '<p class="account-section-sub">Personal details connected to your account.</p>',
      '</div>',
      '<div class="account-card">',
        '<label class="account-field-label" for="account-profile-email">Email address</label>',
        '<div class="account-readonly-row">',
          '<input id="account-profile-email" type="email" class="account-input" value="' + _escapeHtml(email) + '" readonly />',
          '<span class="account-pill account-pill-verified" title="Confirmed via email">',
            '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>',
            'Verified',
          '</span>',
        '</div>',
        '<p class="account-field-help">',
          'Your email is used to sign in and recover your account. Changing your email requires re-verification ',
          '— for now, please <a href="mailto:support@robobuilder.app?subject=Email%20change%20request" class="account-inline-link">contact support</a> to update it.',
        '</p>',
      '</div>',
      '<div class="account-card">',
        '<div class="account-card-head">',
          '<div>',
            '<h4 class="account-card-title">Display name</h4>',
            '<p class="account-card-sub">A nickname that may appear in shared projects in the future.</p>',
          '</div>',
        '</div>',
        '<p class="account-empty-row">Not yet available — coming soon.</p>',
      '</div>'
    ].join('');
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  SECURITY (change password + sign out everywhere)
  // ──────────────────────────────────────────────────────────────────────────
  function _renderSecuritySection(pane) {
    pane.innerHTML = [
      '<div class="account-section-head">',
        '<h3 class="account-section-title">Security</h3>',
        '<p class="account-section-sub">Manage your password and active sessions.</p>',
      '</div>',
      '<div class="account-card">',
        '<div class="account-card-head">',
          '<h4 class="account-card-title">Change password</h4>',
          '<p class="account-card-sub">Use at least 8 characters. Pick something you don’t use elsewhere.</p>',
        '</div>',
        '<form class="account-form" id="account-password-form" autocomplete="off" novalidate>',
          '<label class="account-field-label" for="account-pw-current">Current password</label>',
          '<input id="account-pw-current" type="password" class="account-input" required minlength="8" autocomplete="current-password" />',

          '<label class="account-field-label" for="account-pw-new">New password</label>',
          '<input id="account-pw-new" type="password" class="account-input" required minlength="8" autocomplete="new-password" />',

          '<label class="account-field-label" for="account-pw-confirm">Confirm new password</label>',
          '<input id="account-pw-confirm" type="password" class="account-input" required minlength="8" autocomplete="new-password" />',

          '<div class="account-inline-message" id="account-pw-message" role="status"></div>',

          '<div class="account-form-actions">',
            '<button type="submit" class="account-btn account-btn-primary" id="account-pw-submit">',
              '<span class="account-btn-label">Update password</span>',
              '<span class="account-spinner" aria-hidden="true"></span>',
            '</button>',
          '</div>',
        '</form>',
      '</div>',

      '<div class="account-card">',
        '<div class="account-card-head">',
          '<h4 class="account-card-title">Active sessions</h4>',
          '<p class="account-card-sub">Sign out of all browsers and devices where this account is signed in. You will need to sign in again here too.</p>',
        '</div>',
        '<div class="account-form-actions">',
          '<button type="button" class="account-btn account-btn-secondary" id="account-signout-everywhere">',
            '<span class="account-btn-label">Sign out everywhere</span>',
            '<span class="account-spinner" aria-hidden="true"></span>',
          '</button>',
        '</div>',
        '<div class="account-inline-message" id="account-signout-message" role="status"></div>',
      '</div>'
    ].join('');

    var form = document.getElementById('account-password-form');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      _onSubmitPasswordChange();
    });

    document.getElementById('account-signout-everywhere').addEventListener('click', _onSignOutEverywhere);
  }

  function _onSubmitPasswordChange() {
    var currentEl = document.getElementById('account-pw-current');
    var newEl     = document.getElementById('account-pw-new');
    var confirmEl = document.getElementById('account-pw-confirm');
    var msgEl     = document.getElementById('account-pw-message');
    var btn       = document.getElementById('account-pw-submit');
    var form      = document.getElementById('account-password-form');

    var current = (currentEl.value || '');
    var fresh   = (newEl.value || '');
    var confirm = (confirmEl.value || '');

    _setMessage(msgEl, '', null);

    if (current.length < 8) return _setMessage(msgEl, 'Enter your current password.', 'error');
    if (fresh.length < 8)   return _setMessage(msgEl, 'New password must be at least 8 characters.', 'error');
    if (fresh.length > 200) return _setMessage(msgEl, 'New password is too long.', 'error');
    if (fresh !== confirm)  return _setMessage(msgEl, 'New passwords don’t match.', 'error');
    if (fresh === current)  return _setMessage(msgEl, 'New password must differ from your current one.', 'error');

    var sb = getSupabase();
    if (!sb) return _setMessage(msgEl, 'Authentication is not configured.', 'error');

    var email = getEmail();
    if (!email) return _setMessage(msgEl, 'Could not read your email. Try signing in again.', 'error');

    _setBusy(form, btn, true);
    _setMessage(msgEl, 'Verifying current password…', 'info');

    // Step 1: re-verify current password by attempting a fresh sign-in. This
    // doesn't actually replace the active session (Supabase's JS SDK reuses
    // the same auth context), so on success we proceed to step 2. On failure
    // it's a clear "wrong current password" signal.
    sb.auth.signInWithPassword({ email: email, password: current }).then(function (resp) {
      if (resp.error) {
        _setBusy(form, btn, false);
        _setMessage(msgEl, 'Current password is incorrect.', 'error');
        return;
      }
      // Step 2: actually update the password.
      _setMessage(msgEl, 'Updating password…', 'info');
      return sb.auth.updateUser({ password: fresh }).then(function (resp2) {
        _setBusy(form, btn, false);
        if (resp2.error) {
          _setMessage(msgEl, resp2.error.message || 'Could not update password.', 'error');
          return;
        }
        // Clear inputs on success and surface a success card.
        currentEl.value = ''; newEl.value = ''; confirmEl.value = '';
        _setMessage(msgEl, 'Password updated. You’re still signed in here.', 'success');
      });
    }, function () {
      _setBusy(form, btn, false);
      _setMessage(msgEl, 'Network error. Please try again.', 'error');
    });
  }

  function _onSignOutEverywhere() {
    var msgEl = document.getElementById('account-signout-message');
    var btn   = document.getElementById('account-signout-everywhere');
    var sb    = getSupabase();
    if (!sb) return _setMessage(msgEl, 'Authentication is not configured.', 'error');

    if (!window.confirm('Sign out of every browser and device? You\'ll need to sign in again everywhere, including here.')) {
      return;
    }

    _setBusy(null, btn, true);
    _setMessage(msgEl, 'Signing out every session…', 'info');

    sb.auth.signOut({ scope: 'global' }).then(function (resp) {
      _setBusy(null, btn, false);
      if (resp && resp.error) {
        _setMessage(msgEl, resp.error.message || 'Could not sign out everywhere.', 'error');
        return;
      }
      // The Supabase auth listener in loginModal.js will fire SIGNED_OUT,
      // which clears the cache and dispatches robobuilder:logout. Closing
      // this modal here ensures the UI follows.
      _setMessage(msgEl, 'Signed out everywhere. Closing…', 'success');
      setTimeout(hideAccountModal, 900);
    }, function () {
      _setBusy(null, btn, false);
      _setMessage(msgEl, 'Network error. Please try again.', 'error');
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  PREFERENCES (transactional + marketing email toggles)
  // ──────────────────────────────────────────────────────────────────────────
  function _renderPreferencesSection(pane) {
    var prefs = preferences || DEFAULT_PREFS;
    var t = prefs.transactional || {};
    var m = prefs.marketing || {};
    pane.innerHTML = [
      '<div class="account-section-head">',
        '<h3 class="account-section-title">Email preferences</h3>',
        '<p class="account-section-sub">Choose what we email you about. Transactional notices keep you secure; marketing is optional.</p>',
      '</div>',

      '<div class="account-card">',
        '<div class="account-card-head">',
          '<h4 class="account-card-title">Transactional</h4>',
          '<p class="account-card-sub">Account-related notices. Some are required to keep your account secure.</p>',
        '</div>',
        _toggleRow('account-pref-securityAlerts', 'Account security alerts',
          'Password changes, new sign-ins from unknown devices, and similar safety notices.',
          t.securityAlerts !== false, /* locked = */ true,
          'Required for account security'),
        _toggleRow('account-pref-productUpdates', 'Important product updates',
          'Breaking changes, planned downtime, and notices that may affect your saved work.',
          t.productUpdates !== false, false, null),
      '</div>',

      '<div class="account-card">',
        '<div class="account-card-head">',
          '<h4 class="account-card-title">Marketing</h4>',
          '<p class="account-card-sub">Optional. Unsubscribe anytime — no questions asked.</p>',
        '</div>',
        _toggleRow('account-pref-tipsAndTutorials', 'Tips, tutorials, and announcements',
          'Occasional emails about new lessons, new parts, and how to get more out of RoboBuilder.',
          m.tipsAndTutorials === true, false, null),
      '</div>',

      '<div class="account-inline-message" id="account-prefs-message" role="status"></div>',

      preferencesLoading
        ? '<p class="account-empty-row">Loading your preferences…</p>'
        : ''
    ].join('');

    pane.querySelectorAll('.account-toggle-input').forEach(function (input) {
      input.addEventListener('change', _onTogglePreference);
    });
  }

  function _toggleRow(id, label, desc, checked, locked, lockedHint) {
    var disabled = locked ? ' disabled aria-disabled="true"' : '';
    return [
      '<div class="account-toggle-row' + (locked ? ' account-toggle-row-locked' : '') + '">',
        '<div class="account-toggle-text">',
          '<label class="account-toggle-label" for="' + id + '">' + _escapeHtml(label) + '</label>',
          '<p class="account-toggle-desc">' + _escapeHtml(desc) + '</p>',
          locked && lockedHint ? '<p class="account-toggle-locked-hint">' + _escapeHtml(lockedHint) + '</p>' : '',
        '</div>',
        '<label class="account-toggle-switch' + (locked ? ' account-toggle-switch-locked' : '') + '">',
          '<input type="checkbox" class="account-toggle-input" id="' + id + '" data-key="' + id + '" ' + (checked ? 'checked' : '') + disabled + ' />',
          '<span class="account-toggle-knob" aria-hidden="true"></span>',
        '</label>',
      '</div>'
    ].join('');
  }

  function _onTogglePreference(e) {
    var input = e.target;
    if (input.disabled) return;
    var key = input.dataset.key;     // e.g. "account-pref-productUpdates"
    var prefKey = key.replace(/^account-pref-/, '');
    var msgEl = document.getElementById('account-prefs-message');
    if (!preferences) preferences = JSON.parse(JSON.stringify(DEFAULT_PREFS));

    if (prefKey === 'tipsAndTutorials') {
      preferences.marketing = preferences.marketing || {};
      preferences.marketing.tipsAndTutorials = input.checked;
    } else {
      preferences.transactional = preferences.transactional || {};
      preferences.transactional[prefKey] = input.checked;
    }

    _setMessage(msgEl, 'Saving…', 'info');
    _savePreferences().then(function (ok) {
      if (ok) _setMessage(msgEl, 'Saved.', 'success');
      else    _setMessage(msgEl, 'Could not save. Please try again.', 'error');
    });
  }

  function _loadPreferences() {
    var sb = getSupabase();
    if (!sb) return;
    preferencesLoading = true;
    _getAuthedUserId().then(function (uid) {
      if (!uid) { preferencesLoading = false; return; }
      return sb.from('saves').select('preferences').eq('user_id', uid).maybeSingle().then(function (resp) {
        preferencesLoading = false;
        if (resp.error) {
          // Most likely the column doesn't exist yet — warn and fall back.
          console.warn('[accountModal] preferences select failed (did you re-run db/supabase_init.sql?):', resp.error.message);
          preferences = JSON.parse(JSON.stringify(DEFAULT_PREFS));
        } else {
          var raw = (resp.data && resp.data.preferences) || {};
          preferences = _mergePrefs(raw);
        }
        if (currentSection === 'preferences') _renderActiveSection();
      });
    }).catch(function () {
      preferencesLoading = false;
      preferences = JSON.parse(JSON.stringify(DEFAULT_PREFS));
      if (currentSection === 'preferences') _renderActiveSection();
    });
  }

  function _mergePrefs(raw) {
    var out = JSON.parse(JSON.stringify(DEFAULT_PREFS));
    if (raw && typeof raw === 'object') {
      if (raw.transactional && typeof raw.transactional === 'object') {
        out.transactional.securityAlerts  = raw.transactional.securityAlerts  !== false;
        out.transactional.productUpdates  = raw.transactional.productUpdates  !== false;
      }
      if (raw.marketing && typeof raw.marketing === 'object') {
        out.marketing.tipsAndTutorials = raw.marketing.tipsAndTutorials === true;
      }
    }
    return out;
  }

  function _savePreferences() {
    var sb = getSupabase();
    if (!sb) return Promise.resolve(false);
    return _getAuthedUserId().then(function (uid) {
      if (!uid) return false;
      return sb.from('saves').upsert({
        user_id: uid,
        preferences: preferences,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }).then(function (resp) {
        if (resp.error) {
          console.warn('[accountModal] preferences upsert failed:', resp.error.message);
          return false;
        }
        return true;
      });
    }).catch(function (err) {
      console.warn('[accountModal] preferences save failed:', err);
      return false;
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  DATA & PRIVACY (download my data, delete my account)
  // ──────────────────────────────────────────────────────────────────────────
  function _renderDataSection(pane) {
    pane.innerHTML = [
      '<div class="account-section-head">',
        '<h3 class="account-section-title">Data &amp; privacy</h3>',
        '<p class="account-section-sub">Export your saved work or remove your data from RoboBuilder.</p>',
      '</div>',

      '<div class="account-card">',
        '<div class="account-card-head">',
          '<h4 class="account-card-title">Download your data</h4>',
          '<p class="account-card-sub">Get a JSON file with your build, code, and email preferences.</p>',
        '</div>',
        '<div class="account-form-actions">',
          '<button type="button" class="account-btn account-btn-secondary" id="account-data-download">',
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
            '<span class="account-btn-label">Download my data</span>',
            '<span class="account-spinner" aria-hidden="true"></span>',
          '</button>',
        '</div>',
        '<div class="account-inline-message" id="account-download-message" role="status"></div>',
      '</div>',

      '<div class="account-card account-card-danger">',
        '<div class="account-card-head">',
          '<h4 class="account-card-title account-card-title-danger">Delete account</h4>',
          '<p class="account-card-sub">',
            'This wipes your saved build, code, and preferences right away and signs you out of this browser. ',
            'Because of how the auth provider is configured, the underlying user record can’t be removed from this page — ',
            'after you confirm here, ',
            '<a href="mailto:support@robobuilder.app?subject=Delete%20my%20account" class="account-inline-link">email support</a> ',
            'and we’ll permanently delete it.',
          '</p>',
        '</div>',
        '<div class="account-form-actions">',
          '<button type="button" class="account-btn account-btn-danger" id="account-data-delete">',
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
            '<span class="account-btn-label">Delete my data</span>',
            '<span class="account-spinner" aria-hidden="true"></span>',
          '</button>',
        '</div>',
        '<div class="account-inline-message" id="account-delete-message" role="status"></div>',
      '</div>'
    ].join('');

    document.getElementById('account-data-download').addEventListener('click', _onDownloadData);
    document.getElementById('account-data-delete').addEventListener('click', _onDeleteAccount);
  }

  function _onDownloadData() {
    var btn = document.getElementById('account-data-download');
    var msgEl = document.getElementById('account-download-message');
    var sb = getSupabase();
    if (!sb) return _setMessage(msgEl, 'Authentication is not configured.', 'error');
    _setBusy(null, btn, true);
    _setMessage(msgEl, 'Preparing your export…', 'info');

    _getAuthedUserId().then(function (uid) {
      if (!uid) throw new Error('Not signed in');
      return sb.from('saves').select('build, code, preferences, updated_at').eq('user_id', uid).maybeSingle();
    }).then(function (resp) {
      _setBusy(null, btn, false);
      if (resp && resp.error) {
        _setMessage(msgEl, resp.error.message || 'Could not fetch your data.', 'error');
        return;
      }
      var row = (resp && resp.data) || {};
      var payload = {
        exportedAt: new Date().toISOString(),
        email: getEmail(),
        build: row.build || {},
        code:  row.code  || '',
        preferences: row.preferences || {},
        savedAt: row.updated_at || null,
      };
      var json = JSON.stringify(payload, null, 2);
      var blob = new Blob([json], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      var stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.download = 'robobuilder-data-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      _setMessage(msgEl, 'Download started.', 'success');
    }).catch(function (err) {
      _setBusy(null, btn, false);
      _setMessage(msgEl, (err && err.message) || 'Could not download your data.', 'error');
    });
  }

  function _onDeleteAccount() {
    var btn = document.getElementById('account-data-delete');
    var msgEl = document.getElementById('account-delete-message');
    var sb = getSupabase();
    if (!sb) return _setMessage(msgEl, 'Authentication is not configured.', 'error');

    var email = getEmail();
    var msg = 'Delete your saved data?\n\n'
            + 'This will erase your build, code, and email preferences for ' + email + ' '
            + 'and sign you out. The underlying account record cannot be removed from '
            + 'this page — email support@robobuilder.app to fully delete the account.\n\n'
            + 'This cannot be undone.';
    if (!window.confirm(msg)) return;

    _setBusy(null, btn, true);
    _setMessage(msgEl, 'Erasing your data…', 'info');

    _getAuthedUserId().then(function (uid) {
      if (!uid) throw new Error('Not signed in');
      // Wipe the row. RLS ensures we can only delete our own.
      return sb.from('saves').delete().eq('user_id', uid);
    }).then(function (resp) {
      if (resp && resp.error) {
        _setBusy(null, btn, false);
        _setMessage(msgEl, resp.error.message || 'Could not erase your data.', 'error');
        return null;
      }
      // Stop cloud-sync from re-pushing immediately.
      if (window._cloudSyncStop) window._cloudSyncStop();
      // Clear local copies too.
      try { localStorage.removeItem('robobuilder_build_v2'); } catch (e) { /* ignore */ }
      try { localStorage.removeItem('robobuilder_blocks');   } catch (e) { /* ignore */ }
      _setMessage(msgEl, 'Data erased. Signing you out…', 'success');
      // Sign out of this browser. The underlying account record stays —
      // user must email support to fully delete it.
      return sb.auth.signOut();
    }).then(function () {
      _setBusy(null, btn, false);
      setTimeout(function () {
        hideAccountModal();
        // Show a final notice via window.alert AFTER the modal closes so it
        // doesn't get hidden by the unmount.
        setTimeout(function () {
          window.alert('Your saved data has been erased and you have been signed out.\n\nTo permanently delete your account record, please email support@robobuilder.app.');
        }, 250);
      }, 600);
    }).catch(function (err) {
      _setBusy(null, btn, false);
      _setMessage(msgEl, (err && err.message) || 'Could not delete your data.', 'error');
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────────────
  function _getAuthedUserId() {
    var sb = getSupabase();
    if (!sb) return Promise.resolve(null);
    return sb.auth.getSession().then(function (resp) {
      var sess = resp && resp.data && resp.data.session;
      return (sess && sess.user && sess.user.id) || null;
    }).catch(function () { return null; });
  }

  function _setBusy(form, btn, busy) {
    if (form) form.classList.toggle('account-form-loading', busy);
    if (btn) {
      btn.disabled = busy;
      btn.classList.toggle('account-btn-loading', busy);
    }
  }

  function _setMessage(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.classList.remove('account-msg-error', 'account-msg-success', 'account-msg-info');
    if (!msg) { el.classList.remove('account-msg-visible'); return; }
    el.classList.add('account-msg-visible');
    if (kind === 'error')   el.classList.add('account-msg-error');
    if (kind === 'success') el.classList.add('account-msg-success');
    if (kind === 'info')    el.classList.add('account-msg-info');
  }

  function _escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ── Icons (16x16 stroke=2 line icons, currentColor) ───────────────────────
  function _iconUser()    { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'; }
  function _iconShield()  { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'; }
  function _iconBell()    { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>'; }
  function _iconDatabase(){ return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6"/></svg>'; }
  function _iconSignOut() { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>'; }

  // Auto-close on logout (defensive — e.g. session expires while modal is open).
  window.addEventListener('robobuilder:logout', function () {
    if (isShown) hideAccountModal();
    preferences = null; // forget cached prefs once signed out
  });

  // ── Expose globals ────────────────────────────────────────────────────────
  window._showAccountModal = showAccountModal;
  window._hideAccountModal = hideAccountModal;
})();
