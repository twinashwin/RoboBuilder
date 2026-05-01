// cloudSync.js — Cross-browser sync of build + Blockly XML for logged-in users.
//
// Responsibilities:
//   1. On login (or page-load with active session): hydrate the canvas + workspace
//      from GET /api/sync. If server has no saved state but the user has local
//      state from working logged-out, push that to the server as the new cloud
//      state on first signup.
//   2. While logged in, every 30s: snapshot current build + Blockly XML, hash,
//      and POST /api/sync if anything changed.
//   3. On page-unload: best-effort final flush via navigator.sendBeacon.
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

  // ── Indicator state ───────────────────────────────────────────────────────
  // Mirrors flashAutosave() in app.js but distinguishes cloud states.
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

  // ── Hydrate from server ───────────────────────────────────────────────────
  function hydrate(opts) {
    opts = opts || {};
    return fetch('/api/sync', { credentials: 'include' })
      .then(function (resp) {
        if (resp.status === 401) {
          // Not signed in — nothing to do.
          return { ok: false };
        }
        if (!resp.ok) throw new Error('sync GET failed: ' + resp.status);
        return resp.json().then(function (j) { return { ok: true, data: j }; });
      })
      .then(function (r) {
        if (!r.ok) return;

        var serverBuild = r.data.build || null;
        var serverCode  = r.data.code  || null;

        var hasServerBuild = !!(serverBuild && Array.isArray(serverBuild.parts) && serverBuild.parts.length > 0);
        var hasServerCode  = !!(serverCode && typeof serverCode === 'string' && serverCode.length > 30);
        // (Empty Blockly XML is ~24 chars: `<xml xmlns="..."></xml>`.)

        if (hasServerBuild) {
          _applyBuildToCanvas(serverBuild);
        }
        if (hasServerCode) {
          _applyCodeToWorkspace(serverCode);
        }

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
      })
      .catch(function (err) {
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
      // Nothing changed — idle merge.
      return;
    }
    _pushNow(build, code, bKey, cKey);
  }

  function _pushNow(build, code, bKey, cKey) {
    _inFlight = true;
    _setIndicator('saving');
    bKey = bKey || _hash(build);
    cKey = cKey || _hash(code);

    return fetch('/api/sync', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ build: build, code: code })
    }).then(function (resp) {
      _inFlight = false;
      if (resp.status === 401) {
        // Session expired mid-edit. Stop syncing until next login.
        stop();
        if (window._signOut) {
          // Force the auth cache to clear so the lock resolver re-locks.
          window._signOut();
        }
        _setIndicator('offline');
        return;
      }
      if (!resp.ok) {
        _setIndicator('offline');
        return;
      }
      _lastBuildKey = bKey;
      _lastCodeKey  = cKey;
      _setIndicator('saved');
    }).catch(function (err) {
      _inFlight = false;
      _setIndicator('offline');
      console.warn('[cloudSync] POST failed:', err);
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

    var body = JSON.stringify({ build: build, code: code });
    if (navigator.sendBeacon) {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/sync', blob);
        return;
      } catch (e) { /* fall through to fetch */ }
    }
    // Fallback: synchronous-ish fetch with keepalive.
    try {
      fetch('/api/sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      });
    } catch (e) { /* ignore */ }
  }

  function flush() {
    var build = _getBuildSnapshot();
    var code  = _getCodeSnapshot();
    return _pushNow(build, code);
  }

  // ── Wire to login/logout ──────────────────────────────────────────────────
  window.addEventListener('robobuilder:login-success', function () {
    // Hydrate (server-first) then start the timer.
    // pushLocalIfRemoteEmpty is true only when we know it's a fresh signup or
    // session restore where local edits should be preserved on the server.
    // The login modal sets this on signup; on session restore from /api/me we
    // also pass it — there's no harm in pushing local state to a server slot
    // that's empty.
    var pushLocal = true;
    hydrate({ pushLocalIfRemoteEmpty: pushLocal })
      .finally(function () { start(); });
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
