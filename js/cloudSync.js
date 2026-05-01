// cloudSync.js — Cross-browser sync of build + Blockly XML for logged-in users.
// Backed by Supabase Postgres (table `public.saves`, RLS-keyed on auth.uid()).
//
// Responsibilities:
//   1. On login (or page-load with active session): hydrate the canvas +
//      workspace from `select * from saves where user_id = me`. If the row
//      doesn't exist or is empty but the user has local state from working
//      logged-out, push that to Supabase as the new cloud state.
//   2. While logged in, every 30s: snapshot current build + Blockly XML, hash,
//      and upsert if anything changed.
//   3. On page-unload: best-effort upsert via fetch (sendBeacon can't carry
//      Supabase's auth headers, so we fire a regular request with keepalive).
//   4. Update the autosave indicator to reflect cloud-sync status.
//
// Public API (on window):
//   _cloudSyncHydrate({ pushLocalIfRemoteEmpty }) -> Promise
//   _cloudSyncStart()       -> attaches the 30s timer + unload listener
//   _cloudSyncStop()        -> clears timer (called on logout)
//   _cloudSyncFlush()       -> force a sync now if dirty (returns Promise)
//
// Events listened to:
//   robobuilder:login-success  -> hydrate + start
//   robobuilder:logout         -> stop

(function () {
  'use strict';

  var SYNC_INTERVAL_MS = 30 * 1000;
  var _timer        = null;
  var _lastBuildKey = null;   // hash of last-pushed build
  var _lastCodeKey  = null;   // hash of last-pushed code
  var _started      = false;
  var _inFlight     = false;
  var _hydrated     = false;

  function getSupabase() {
    return window.supabase || null;
  }

  // ── Indicator state ───────────────────────────────────────────────────────
  function _setIndicator(state) {
    var el = document.getElementById('autosave-indicator');
    if (!el) return;
    el.classList.remove('autosave-flash', 'autosave-cloud-saving',
      'autosave-cloud-saved', 'autosave-cloud-offline');
    var label = 'Saved';
    if (state === 'saving')       { el.classList.add('autosave-cloud-saving'); label = 'Saving…'; }
    else if (state === 'saved')   { el.classList.add('autosave-cloud-saved');  label = 'Cloud saved'; }
    else if (state === 'offline') { el.classList.add('autosave-cloud-offline'); label = 'Offline'; }
    else if (state === 'idle')    { label = 'Cloud synced'; el.classList.add('autosave-cloud-saved'); }
    el.textContent = label;
    el.title = state ? ('Cloud sync: ' + label) : 'Saved';
  }

  // ── Snapshot helpers ──────────────────────────────────────────────────────
  function _getBuildSnapshot() {
    var BC = (typeof BuildCanvas3D !== 'undefined' && BuildCanvas3D)
      ? BuildCanvas3D
      : (typeof BuildCanvas !== 'undefined' ? BuildCanvas : null);
    if (!BC) return null;
    var parts = (typeof BC.getPlacedParts === 'function') ? BC.getPlacedParts() : [];
    var conns = (typeof BC.getConnections === 'function') ? BC.getConnections() : [];
    return { parts: parts, connections: conns };
  }

  function _getCodeSnapshot() {
    if (typeof Blockly === 'undefined' || !window._blocklyWorkspace) return null;
    try {
      return Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(window._blocklyWorkspace));
    } catch (e) {
      console.warn('[cloudSync] Failed to read Blockly XML:', e);
      return null;
    }
  }

  // ── Cheap hash for change detection (djb2 over JSON) ──────────────────────
  function _hash(s) {
    if (s === null || s === undefined) return null;
    var str = (typeof s === 'string') ? s : JSON.stringify(s);
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    // Include length to defeat trivial collisions on small inputs.
    return str.length + ':' + h;
  }

  // ── Get current authenticated user (from Supabase session) ────────────────
  function _getAuthedUser() {
    var sb = getSupabase();
    if (!sb) return Promise.resolve(null);
    return sb.auth.getSession().then(function (resp) {
      var sess = resp && resp.data && resp.data.session;
      return (sess && sess.user) || null;
    }).catch(function () { return null; });
  }

  // ── Hydrate from server ───────────────────────────────────────────────────
  function hydrate(opts) {
    opts = opts || {};
    var sb = getSupabase();
    if (!sb) {
      _setIndicator('offline');
      return Promise.resolve();
    }

    return _getAuthedUser().then(function (user) {
      if (!user) return;
      return sb
        .from('saves')
        .select('build, code')
        .eq('user_id', user.id)
        .maybeSingle()
        .then(function (resp) {
          if (resp.error) {
            console.warn('[cloudSync] Hydrate select failed:', resp.error.message);
            _setIndicator('offline');
            return;
          }
          var row = resp.data || null;
          var serverBuild = (row && row.build && typeof row.build === 'object') ? row.build : null;
          var serverCode  = (row && typeof row.code === 'string')                ? row.code  : null;

          var hasServerBuild = !!(serverBuild && Array.isArray(serverBuild.parts) && serverBuild.parts.length > 0);
          var hasServerCode  = !!(serverCode && serverCode.length > 30);
          // (Empty Blockly XML is ~24 chars: `<xml xmlns="..."></xml>`.)

          if (hasServerBuild) _applyBuildToCanvas(serverBuild);
          if (hasServerCode)  _applyCodeToWorkspace(serverCode);

          // Establish baseline hashes so we don't immediately re-push.
          _lastBuildKey = _hash(_getBuildSnapshot());
          _lastCodeKey  = _hash(_getCodeSnapshot());
          _hydrated = true;

          // First-time push: server is empty but local has work.
          if (!hasServerBuild && !hasServerCode && opts.pushLocalIfRemoteEmpty) {
            var localBuild = _getBuildSnapshot();
            var localCode  = _getCodeSnapshot();
            var hasLocal = (localBuild && localBuild.parts && localBuild.parts.length > 0)
              || (localCode && localCode.length > 30);
            if (hasLocal) {
              return _pushNow(localBuild, localCode);
            }
          }
          _setIndicator('idle');
        });
    }).catch(function (err) {
      console.warn('[cloudSync] Hydrate failed:', err);
      _setIndicator('offline');
    });
  }

  function _applyBuildToCanvas(buildData) {
    var BC = (typeof BuildCanvas3D !== 'undefined' && BuildCanvas3D)
      ? BuildCanvas3D
      : (typeof BuildCanvas !== 'undefined' ? BuildCanvas : null);
    if (!BC || typeof BC.loadConfig !== 'function') {
      console.warn('[cloudSync] No build canvas with loadConfig available');
      return;
    }
    try {
      BC.loadConfig(buildData);
    } catch (e) {
      console.warn('[cloudSync] loadConfig failed:', e);
    }
  }

  function _applyCodeToWorkspace(xmlText) {
    if (typeof Blockly === 'undefined' || !window._blocklyWorkspace) {
      // Workspace not ready yet — retry once on next tick.
      setTimeout(function () { _applyCodeToWorkspace(xmlText); }, 200);
      return;
    }
    try {
      window._blocklyWorkspace.clear();
      var dom = Blockly.Xml.textToDom(xmlText);
      Blockly.Xml.domToWorkspace(dom, window._blocklyWorkspace);
      // Persist the freshly-loaded XML to localStorage so reloads see it
      // before the next hydration completes.
      try { localStorage.setItem('robobuilder_blocks', xmlText); } catch (e) { /* ignore */ }
    } catch (e) {
      console.warn('[cloudSync] Failed to apply Blockly XML:', e);
    }
  }

  // ── 30s tick ──────────────────────────────────────────────────────────────
  function _tick() {
    if (_inFlight) return;
    if (!window._isLoggedIn || !window._isLoggedIn()) return;

    var build = _getBuildSnapshot();
    var code  = _getCodeSnapshot();
    var bKey = _hash(build);
    var cKey = _hash(code);

    if (bKey === _lastBuildKey && cKey === _lastCodeKey) {
      // Nothing changed — idle.
      return;
    }
    _pushNow(build, code, bKey, cKey);
  }

  function _pushNow(build, code, bKey, cKey) {
    var sb = getSupabase();
    if (!sb) {
      _setIndicator('offline');
      return Promise.resolve();
    }
    _inFlight = true;
    _setIndicator('saving');
    bKey = bKey || _hash(build);
    cKey = cKey || _hash(code);

    return _getAuthedUser().then(function (user) {
      if (!user) {
        // Session expired. Stop syncing until next login.
        _inFlight = false;
        stop();
        if (window._signOut) window._signOut();
        _setIndicator('offline');
        return;
      }
      return sb.from('saves').upsert({
        user_id: user.id,
        build:   build || {},
        code:    (typeof code === 'string') ? code : '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' }).then(function (resp) {
        _inFlight = false;
        if (resp.error) {
          console.warn('[cloudSync] Upsert failed:', resp.error.message);
          _setIndicator('offline');
          return;
        }
        _lastBuildKey = bKey;
        _lastCodeKey  = cKey;
        _setIndicator('saved');
      });
    }).catch(function (err) {
      _inFlight = false;
      _setIndicator('offline');
      console.warn('[cloudSync] Push failed:', err);
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  function start() {
    if (_started) return;
    _started = true;
    if (_timer) clearInterval(_timer);
    _timer = setInterval(_tick, SYNC_INTERVAL_MS);
    window.addEventListener('beforeunload', _flushOnUnload);
    window.addEventListener('pagehide', _flushOnUnload);
  }

  function stop() {
    _started = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
    window.removeEventListener('beforeunload', _flushOnUnload);
    window.removeEventListener('pagehide', _flushOnUnload);
    _setIndicator(null);
  }

  function _flushOnUnload() {
    if (!window._isLoggedIn || !window._isLoggedIn()) return;
    var build = _getBuildSnapshot();
    var code  = _getCodeSnapshot();
    var bKey = _hash(build);
    var cKey = _hash(code);
    if (bKey === _lastBuildKey && cKey === _lastCodeKey) return;

    // Best-effort fire-and-forget. sendBeacon can't carry Supabase's
    // Authorization header, so we use a regular fetch via the SDK and
    // hope the request flushes before the page tears down. Browsers
    // generally honor in-flight fetches initiated synchronously during
    // pagehide for ~ a few seconds.
    try {
      _pushNow(build, code, bKey, cKey);
    } catch (e) {
      // Nothing we can do at this point.
    }
  }

  function flush() {
    var build = _getBuildSnapshot();
    var code  = _getCodeSnapshot();
    return _pushNow(build, code);
  }

  // ── Wire to login/logout ──────────────────────────────────────────────────
  window.addEventListener('robobuilder:login-success', function () {
    // Hydrate (server-first) then start the timer.
    var pushLocal = true;
    hydrate({ pushLocalIfRemoteEmpty: pushLocal })
      .then(function () { start(); }, function () { start(); });
  });

  window.addEventListener('robobuilder:logout', function () {
    stop();
    _hydrated = false;
    _lastBuildKey = null;
    _lastCodeKey = null;
  });

  // ── Expose globals ────────────────────────────────────────────────────────
  window._cloudSyncHydrate = hydrate;
  window._cloudSyncStart   = start;
  window._cloudSyncStop    = stop;
  window._cloudSyncFlush   = flush;
})();
