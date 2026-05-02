// buildTutorial.js — Step-by-step guided tutorial for the Build tab.
// Loaded after app.js and loginModal.js, before tutorial.js.
// Uses globals: window._switchTab, BuildCanvas (via _BC pattern),
//   window._lockPartsPanel, window._isLoggedIn

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  var STORAGE_KEY = 'robobuilder_build_tutorial_v1';
  var TOTAL_STEPS = 18;  // 0 intro + 13 parts + 4 wires (matches 3D starter bot)
  var POLL_MS     = 400;

  // ── State ──────────────────────────────────────────────────────────────────
  var currentStep   = 0;
  var isActive      = false;
  var ghostData     = null;   // {type, offsetX, offsetY, rotation} or null
  var pollTimer     = null;
  var _BC           = null;   // resolved at init

  // ── DOM refs ───────────────────────────────────────────────────────────────
  var btPanel, btProgressFill, btStepNum, btTotalEl, btTitle, btBody,
      btHelperBtn, btNextBtn, btSkipBtn, btSkipStepBtn;

  // ── Step definitions ───────────────────────────────────────────────────────
  // The part composition and positions match BuildCanvas3D.spawnStarterRobot 1:1,
  // so completing the tutorial yields a robot that is structurally identical to
  // the ⭐ Starter Bot. target3D is the 3D world coord; targetOffset is the
  // 2D-canvas pixel offset (used only when the active canvas is the 2D fallback).
  var steps = [
    // ── 0: Welcome ──────────────────────────────────────────────────────────
    {
      title: "Let's Build Your First Robot!",
      body:  '<p>Welcome! We\'re going to build a real robot from scratch — piece by piece.</p>' +
             '<p>Each step shows you exactly where to place the next part. Look for the ' +
             '<strong style="color:#3B82F6">glowing blue outline</strong> on the canvas and ' +
             'drag parts from the left panel onto it.</p>' +
             '<p>Ready? Let\'s start with the chassis!</p>',
      partType: null,
      targetOffset: null,
      target3D: null,
      nextLabel: "Let's Build! →",
      helperLabel: null,
      highlightType: null,
    },

    // ── 1: Left Chassis Rail (long c-channel) ───────────────────────────────
    {
      title: 'Step 1: Left Chassis Rail',
      body:  '<p>Every robot needs a strong frame. We\'ll use four <strong>C-Channels</strong> — two long rails plus two short cross-beams — to form the chassis.</p>' +
             '<p>Drag a <strong>C-Channel</strong> from the parts panel onto the blue outline. This is the <strong>left rail</strong>.</p>',
      partType: 'c-channel',
      targetOffset: { x: -50, y: -10 },
      target3D:    { x: 0, z: -1, rot: 0, props: { length: 100 } },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'c-channel',
      requiredCount: 1,
    },

    // ── 2: Right Chassis Rail ───────────────────────────────────────────────
    {
      title: 'Step 2: Right Chassis Rail',
      body:  '<p>Add a second <strong>C-Channel</strong> to form the <strong>right rail</strong>.</p>' +
             '<p>Two parallel rails create a sturdy frame.</p>',
      partType: 'c-channel',
      targetOffset: { x: -50, y: 20 },
      target3D:    { x: 0, z: 1, rot: 0, props: { length: 100 } },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'c-channel',
      requiredCount: 2,
    },

    // ── 3: Front Cross-Beam ─────────────────────────────────────────────────
    {
      title: 'Step 3: Front Cross-Beam',
      body:  '<p>Now add a shorter <strong>C-Channel</strong> as a cross-beam at the <strong>front</strong> of the chassis.</p>' +
             '<p>Cross-beams tie the rails together and give you mounting points for parts.</p>',
      partType: 'c-channel',
      targetOffset: { x: -85, y: 5 },
      target3D:    { x: -1.4, z: 0, rot: Math.PI / 2, props: { length: 60 } },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'c-channel',
      requiredCount: 3,
    },

    // ── 4: Back Cross-Beam ──────────────────────────────────────────────────
    {
      title: 'Step 4: Back Cross-Beam',
      body:  '<p>Add a second short <strong>C-Channel</strong> at the <strong>back</strong> of the chassis.</p>' +
             '<p>The frame is now a closed rectangle — strong and ready to carry the drive train.</p>',
      partType: 'c-channel',
      targetOffset: { x: 25, y: 5 },
      target3D:    { x: 1.4, z: 0, rot: Math.PI / 2, props: { length: 60 } },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'c-channel',
      requiredCount: 4,
    },

    // ── 5: Left Motor (Motor A) ─────────────────────────────────────────────
    {
      title: 'Step 5: Left Motor (Motor A)',
      body:  '<p>Motors make your robot move! Each motor drives a pair of wheels.</p>' +
             '<p>Place the first motor on the <strong>left side</strong>. This will be <strong>Motor A</strong>.</p>',
      partType: 'motor',
      targetOffset: { x: -85, y: -40 },
      target3D:    { x: -1.4, z: -1.5, rot: 0 },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'motor',
      requiredCount: 1,
    },

    // ── 6: Right Motor (Motor B) ────────────────────────────────────────────
    {
      title: 'Step 6: Right Motor (Motor B)',
      body:  '<p>Add the second motor on the <strong>right side</strong>. This is <strong>Motor B</strong>.</p>' +
             '<p>With two independent motors, your robot can drive straight, turn, and even spin in place.</p>',
      partType: 'motor',
      targetOffset: { x: -85, y: 40 },
      target3D:    { x: -1.4, z: 1.5, rot: 0 },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'motor',
      requiredCount: 2,
    },

    // ── 7: Front-Left Wheel ─────────────────────────────────────────────────
    {
      title: 'Step 7: Front-Left Wheel',
      body:  '<p>Time for wheels — your starter bot has <strong>four</strong> of them for stability.</p>' +
             '<p>Place the first wheel at the <strong>front-left</strong>, just past Motor A.</p>',
      partType: 'wheel',
      targetOffset: { x: -100, y: -65 },
      target3D:    { x: -1.4, z: -2.1, rot: 0 },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'wheel',
      requiredCount: 1,
    },

    // ── 8: Back-Left Wheel ──────────────────────────────────────────────────
    {
      title: 'Step 8: Back-Left Wheel',
      body:  '<p>Place the second wheel at the <strong>back-left</strong>, just past Motor B.</p>',
      partType: 'wheel',
      targetOffset: { x: -100, y: 65 },
      target3D:    { x: -1.4, z: 2.1, rot: 0 },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'wheel',
      requiredCount: 2,
    },

    // ── 9: Front-Right Wheel ────────────────────────────────────────────────
    {
      title: 'Step 9: Front-Right Wheel',
      body:  '<p>Now the <strong>front-right</strong> wheel — opposite the front-left.</p>' +
             '<p>Four wheels keep the robot level and stable on the field.</p>',
      partType: 'wheel',
      targetOffset: { x: 40, y: -65 },
      target3D:    { x: 1.4, z: -2.1, rot: 0 },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'wheel',
      requiredCount: 3,
    },

    // ── 10: Back-Right Wheel ────────────────────────────────────────────────
    {
      title: 'Step 10: Back-Right Wheel',
      body:  '<p>Last wheel — the <strong>back-right</strong>.</p>' +
             '<p>The drive train is complete. Same speed on both sides drives straight; different speeds turn.</p>',
      partType: 'wheel',
      targetOffset: { x: 40, y: 65 },
      target3D:    { x: 1.4, z: 2.1, rot: 0 },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'wheel',
      requiredCount: 4,
    },

    // ── 11: Brain ───────────────────────────────────────────────────────────
    {
      title: 'Step 11: The Brain',
      body:  '<p>The <strong>Brain</strong> is the robot\'s computer. It runs your code, reads sensor data, and tells the motors what to do.</p>' +
             '<p>Place it at the <strong>center</strong> of the chassis — every wire connects back here.</p>',
      partType: 'brain',
      targetOffset: { x: -30, y: 0 },
      target3D:    { x: 0, z: 0, rot: 0 },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'brain',
      requiredCount: 1,
    },

    // ── 12: Battery ─────────────────────────────────────────────────────────
    {
      title: 'Step 12: Battery',
      body:  '<p>The <strong>Battery</strong> powers the entire robot through the brain.</p>' +
             '<p>Place it next to the brain — short power runs are good engineering.</p>',
      partType: 'battery',
      targetOffset: { x: 30, y: 0 },
      target3D:    { x: 1.0, z: 0, rot: 0 },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'battery',
      requiredCount: 1,
    },

    // ── 13: Distance Sensor ─────────────────────────────────────────────────
    {
      title: 'Step 13: Distance Sensor',
      body:  '<p>The <strong>Distance Sensor</strong> is your robot\'s eyes — it measures how far away obstacles are.</p>' +
             '<p>Mount it at the <strong>front</strong> so it can see what\'s coming.</p>',
      partType: 'distance-sensor',
      targetOffset: { x: -130, y: 0 },
      target3D:    { x: -2.2, z: 0, rot: 0 },
      nextLabel: null,
      helperLabel: null,
      highlightType: 'distance-sensor',
      requiredCount: 1,
    },

    // ── 14: Wire Battery → Brain ────────────────────────────────────────────
    {
      title: 'Wire 1: Power the Brain',
      body:  '<p>All parts are placed! Now let\'s <strong>wire everything together</strong>.</p>' +
             '<p>First, power the brain: press <kbd>W</kbd> to activate the Wire Tool, then click the <strong>Battery</strong>, then click the <strong>Brain</strong>.</p>' +
             '<p>You\'ll see a red power wire appear.</p>',
      partType: null,
      targetOffset: null,
      target3D: null,
      nextLabel: null,
      helperLabel: 'Wire It For Me',
      highlightType: null,
      wireFrom: 'battery',
      wireTo: 'brain',
      wireType: 'power',
    },

    // ── 15: Wire Brain → Motor A ────────────────────────────────────────────
    {
      title: 'Wire 2: Brain → Motor A',
      body:  '<p>Connect the brain to the <strong>left motor</strong> (Motor A).</p>' +
             '<p>With the Wire Tool still active, click the <strong>Brain</strong>, then click <strong>Motor A</strong>.</p>' +
             '<p>A blue signal wire means the brain can now control this motor.</p>',
      partType: null,
      targetOffset: null,
      target3D: null,
      nextLabel: null,
      helperLabel: 'Wire It For Me',
      highlightType: null,
      wireFrom: 'brain',
      wireTo: 'motor',
      wireType: 'signal',
      wireIndex: 0,  // first motor
    },

    // ── 16: Wire Brain → Motor B ────────────────────────────────────────────
    {
      title: 'Wire 3: Brain → Motor B',
      body:  '<p>Connect the brain to the <strong>right motor</strong> (Motor B) the same way.</p>' +
             '<p>Click the <strong>Brain</strong>, then click <strong>Motor B</strong>.</p>',
      partType: null,
      targetOffset: null,
      target3D: null,
      nextLabel: null,
      helperLabel: 'Wire It For Me',
      highlightType: null,
      wireFrom: 'brain',
      wireTo: 'motor',
      wireType: 'signal',
      wireIndex: 1,  // second motor
    },

    // ── 17: Wire Brain → Distance Sensor ────────────────────────────────────
    {
      title: 'Wire 4: Brain → Sensor',
      body:  '<p>Last wire! Connect the brain to the <strong>Distance Sensor</strong> so your robot can "see."</p>' +
             '<p>Click the <strong>Brain</strong>, then click the <strong>Distance Sensor</strong>.</p>',
      partType: null,
      targetOffset: null,
      target3D: null,
      nextLabel: null,
      helperLabel: 'Wire It For Me',
      highlightType: null,
      wireFrom: 'brain',
      wireTo: 'distance-sensor',
      wireType: 'signal',
    },
  ];

  // ── Init (called on window load) ───────────────────────────────────────────
  function init() {
    _BC = (typeof BuildCanvas3D !== 'undefined' && BuildCanvas3D) ? BuildCanvas3D : BuildCanvas;

    btPanel       = document.getElementById('build-tutorial-panel');
    btProgressFill = document.getElementById('build-tut-progress-fill');
    btStepNum     = document.getElementById('build-tut-step-num');
    btTotalEl     = document.getElementById('build-tut-step-total');
    btTitle       = document.getElementById('build-tut-title');
    btBody        = document.getElementById('build-tut-body');
    btHelperBtn   = document.getElementById('build-tut-btn-helper');
    btNextBtn     = document.getElementById('build-tut-btn-next');
    btSkipBtn     = document.getElementById('build-tut-btn-skip');
    btSkipStepBtn = document.getElementById('build-tut-btn-skip-step');

    if (!btPanel) return;

    if (btTotalEl) btTotalEl.textContent = TOTAL_STEPS;
    btSkipBtn.addEventListener('click', skipTutorial);
    btNextBtn.addEventListener('click', function () { advanceStep(); });
    if (btSkipStepBtn) btSkipStepBtn.addEventListener('click', function () { advanceStep(); });
  }

  // ── Should auto-start? ─────────────────────────────────────────────────────
  function shouldAutoStart() {
    if (localStorage.getItem(STORAGE_KEY) === 'done') return false;
    if (window._isLoggedIn && window._isLoggedIn()) return false;
    try {
      var saved = localStorage.getItem('robobuilder_build_v2');
      if (saved) {
        var data = JSON.parse(saved);
        if (data && Array.isArray(data.parts) && data.parts.length > 0) return false;
      }
    } catch (e) { /* proceed */ }
    return true;
  }

  // ── Start ──────────────────────────────────────────────────────────────────
  function startTutorial() {
    if (!btPanel) init();
    if (!btPanel) return;

    isActive = true;
    _BC.resetCanvas();
    btPanel.removeAttribute('hidden');

    // Hide properties panel during tutorial
    var propsPanel = document.getElementById('props-panel');
    if (propsPanel) propsPanel.setAttribute('hidden', '');

    currentStep = 0;
    // Notify listeners (parts-panel lock state, etc.) BEFORE goToStep, so the
    // first step's step-change event finds the tutorial flagged active.
    window.dispatchEvent(new CustomEvent('robobuilder:buildtutorial-start'));
    goToStep(0);
  }

  // ── Go to step ─────────────────────────────────────────────────────────────
  function goToStep(idx) {
    stopPolling();
    clearHighlight();
    ghostData = null;

    currentStep = idx;
    var step = steps[idx];
    if (!step) return;

    // Progress bar
    var pct = ((idx + 1) / TOTAL_STEPS * 100).toFixed(0);
    btProgressFill.style.width = pct + '%';
    btStepNum.textContent = idx + 1;

    // Content
    btTitle.textContent = step.title;
    btBody.innerHTML = step.body;

    // Next button
    if (step.nextLabel) {
      btNextBtn.removeAttribute('hidden');
      btNextBtn.textContent = step.nextLabel;
      btNextBtn.className = 'tut-next-btn cta';
    } else {
      btNextBtn.setAttribute('hidden', '');
    }

    // Skip Step button — show on all steps except the last
    if (btSkipStepBtn) {
      if (idx < TOTAL_STEPS - 1) {
        btSkipStepBtn.removeAttribute('hidden');
      } else {
        btSkipStepBtn.setAttribute('hidden', '');
      }
    }

    // Helper button
    if (step.helperLabel) {
      btHelperBtn.removeAttribute('hidden');
      btHelperBtn.textContent = step.helperLabel;
      btHelperBtn.onclick = function () { doHelper(idx); };
    } else {
      btHelperBtn.setAttribute('hidden', '');
      btHelperBtn.onclick = null;
    }

    // Ghost overlay for part placement steps. setGhost stores both the 2D
    // offset (for the 2D canvas) and the 3D world coord (for BuildCanvas3D).
    if (step.partType && (step.targetOffset || step.target3D)) {
      setGhost(step.partType, step.targetOffset, step.target3D);
    }

    // Highlight the part in the sidebar
    if (step.highlightType) {
      applyHighlight(step.highlightType);
    }

    // Start polling for auto-advance
    if (step.partType && step.requiredCount) {
      startPartPolling(step.partType, step.requiredCount);
    } else if (step.wireFrom && step.wireTo) {
      if (_BC.setActiveTool) _BC.setActiveTool('wire');
      startWirePolling(step.wireFrom, step.wireTo, step.wireType, step.wireIndex);
    }

    // Trigger redraw so ghost appears
    if (_BC.redraw) _BC.redraw();

    // Notify listeners (parts-panel lock state) that the active step — and
    // therefore the allowed part type — has changed.
    window.dispatchEvent(new CustomEvent('robobuilder:buildtutorial-step-change', {
      detail: { step: idx, partType: step.partType || null }
    }));
  }

  function advanceStep() {
    if (currentStep >= TOTAL_STEPS - 1) {
      endTutorial();
      return;
    }
    goToStep(currentStep + 1);
  }

  // ── Ghost overlay (read by buildCanvas.js for 2D, buildCanvas3D.js for 3D) ─
  function setGhost(partType, offset, target3D) {
    ghostData = {
      type:     partType,
      offsetX:  offset ? offset.x : 0,
      offsetY:  offset ? offset.y : 0,
      rotation: target3D && typeof target3D.rot === 'number' ? target3D.rot : 0,
      // 3D world coords (consumed by BuildCanvas3D.drawBuildTutorialGhost3D)
      target3D: target3D || null,
    };
  }

  // ── Highlight part in sidebar ──────────────────────────────────────────────
  var _highlightedEl = null;

  function applyHighlight(partType) {
    clearHighlight();
    var item = document.querySelector('.part-item[data-part-type="' + partType + '"]');
    if (!item) return;
    _highlightedEl = item;
    item.classList.add('build-tut-highlight');
    item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearHighlight() {
    if (_highlightedEl) {
      _highlightedEl.classList.remove('build-tut-highlight');
      _highlightedEl = null;
    }
  }

  // ── Polling: part placement ────────────────────────────────────────────────
  function startPartPolling(partType, requiredCount) {
    stopPolling();
    pollTimer = setInterval(function () {
      var parts = _BC.getPlacedParts ? _BC.getPlacedParts() : [];
      var count = parts.filter(function (p) { return p.type === partType; }).length;
      if (count >= requiredCount) {
        stopPolling();
        setTimeout(function () { advanceStep(); }, 400);
      }
    }, POLL_MS);
  }

  // ── Polling: wiring ────────────────────────────────────────────────────────
  function startWirePolling(fromType, toType, wireType, wireIndex) {
    stopPolling();
    pollTimer = setInterval(function () {
      var parts = _BC.getPlacedParts ? _BC.getPlacedParts() : [];
      var conns = _BC.getConnections ? _BC.getConnections() : [];

      // For motors, we need to count how many motor wires exist
      if (toType === 'motor' && wireIndex !== undefined) {
        var motorParts = parts.filter(function (p) { return p.type === 'motor'; });
        var brainPart  = parts.find(function (p) { return p.type === 'brain'; });
        if (!brainPart || motorParts.length === 0) return;

        var motorWireCount = 0;
        motorParts.forEach(function (m) {
          var hasWire = conns.some(function (c) {
            return ((c.fromId === brainPart.id && c.toId === m.id) ||
                    (c.fromId === m.id && c.toId === brainPart.id)) &&
                   c.wireType === wireType;
          });
          if (hasWire) motorWireCount++;
        });

        if (motorWireCount >= wireIndex + 1) {
          stopPolling();
          setTimeout(function () { advanceStep(); }, 400);
        }
        return;
      }

      var fromPart = parts.find(function (p) { return p.type === fromType; });
      var toPart   = parts.find(function (p) { return p.type === toType; });
      if (!fromPart || !toPart) return;

      var found = conns.some(function (c) {
        return (
          ((c.fromId === fromPart.id && c.toId === toPart.id) ||
           (c.fromId === toPart.id && c.toId === fromPart.id)) &&
          c.wireType === wireType
        );
      });

      if (found) {
        stopPolling();
        setTimeout(function () { advanceStep(); }, 400);
      }
    }, POLL_MS);
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // ── Helper: programmatically add wires ─────────────────────────────────────
  function doHelper(stepIdx) {
    var step = steps[stepIdx];
    if (!step || !step.wireFrom || !step.wireTo) return;

    var parts = _BC.getPlacedParts ? _BC.getPlacedParts() : [];
    var conns = _BC.getConnections ? _BC.getConnections() : [];

    if (step.wireTo === 'motor' && step.wireIndex !== undefined) {
      // Wire to the Nth motor that isn't already wired
      var brainPart  = parts.find(function (p) { return p.type === 'brain'; });
      var motorParts = parts.filter(function (p) { return p.type === 'motor'; });
      if (!brainPart || motorParts.length === 0) return;

      // Find first unwired motor
      var target = null;
      for (var i = 0; i < motorParts.length; i++) {
        var alreadyWired = conns.some(function (c) {
          return ((c.fromId === brainPart.id && c.toId === motorParts[i].id) ||
                  (c.fromId === motorParts[i].id && c.toId === brainPart.id)) &&
                 c.wireType === step.wireType;
        });
        if (!alreadyWired) { target = motorParts[i]; break; }
      }
      if (target && _BC.addConnection) {
        _BC.addConnection(brainPart.id, target.id, step.wireType);
      }
      return;
    }

    var fromPart = parts.find(function (p) { return p.type === step.wireFrom; });
    var toPart   = parts.find(function (p) { return p.type === step.wireTo; });
    if (!fromPart || !toPart) return;

    if (_BC.addConnection) {
      _BC.addConnection(fromPart.id, toPart.id, step.wireType);
    }
  }

  // ── Skip ───────────────────────────────────────────────────────────────────
  function skipTutorial() {
    stopPolling();
    clearHighlight();
    ghostData = null;
    isActive = false;

    btPanel.setAttribute('hidden', '');

    var propsPanel = document.getElementById('props-panel');
    if (propsPanel) propsPanel.removeAttribute('hidden');

    if (_BC.redraw) _BC.redraw();

    // Re-lock the parts panel for non-logged-in users. (Skipping does NOT mark
    // the tutorial as 'done' in localStorage, but the lock no longer cares
    // about that flag — it's purely state-driven now.)
    window.dispatchEvent(new CustomEvent('robobuilder:buildtutorial-closed', {
      detail: { reason: 'skipped' }
    }));
  }

  // ── End (completed) ────────────────────────────────────────────────────────
  function endTutorial() {
    stopPolling();
    clearHighlight();
    ghostData = null;
    isActive = false;

    localStorage.setItem(STORAGE_KEY, 'done');

    var propsPanel = document.getElementById('props-panel');
    if (propsPanel) propsPanel.removeAttribute('hidden');

    if (_BC.setActiveTool) _BC.setActiveTool('select');
    if (_BC.redraw) _BC.redraw();

    // -done is the historical "build tutorial completed" notification; some
    // listeners (e.g. analytics, replay button) still hook it. -closed is the
    // new generic "tutorial is no longer active" event used by the parts-panel
    // lock resolver — fire both so the panel re-locks for non-logged-in users.
    window.dispatchEvent(new CustomEvent('robobuilder:buildtutorial-done'));
    window.dispatchEvent(new CustomEvent('robobuilder:buildtutorial-closed', {
      detail: { reason: 'completed' }
    }));
    showTransitionCard();
  }

  function showTransitionCard() {
    btPanel.removeAttribute('hidden');
    btProgressFill.style.width = '100%';
    btStepNum.textContent = TOTAL_STEPS;
    btTitle.textContent = 'Your Robot is Built!';
    btBody.innerHTML =
      '<div style="font-size:2.5rem;margin:0.3rem 0">&#127881;</div>' +
      '<p style="font-size:1rem;font-weight:600;color:var(--text-1)">Excellent work!</p>' +
      '<p>Your robot is fully assembled and wired. Now let\'s learn to <strong>program it</strong>.</p>' +
      '<p>Head over to the <strong>Code tab</strong> to write your first program!</p>';
    btHelperBtn.setAttribute('hidden', '');
    btNextBtn.removeAttribute('hidden');
    btNextBtn.textContent = 'Go to Code Tab →';
    btNextBtn.className = 'tut-next-btn cta';
    btNextBtn.onclick = function () {
      btPanel.setAttribute('hidden', '');
      if (window._switchTab) window._switchTab('code');
    };

    // Pulse the code tab to direct the user there. The pulse is removed inside
    // switchTab() in app.js, so any entry point (tab click, our "Go to Code Tab"
    // button, the Tab key, a programmatic switch) clears it consistently.
    var codeTabBtn = document.querySelector('.tab-btn[data-tab="code"]');
    if (codeTabBtn) codeTabBtn.classList.add('tut-highlight-nav');
  }

  // ── Init on load ───────────────────────────────────────────────────────────
  window.addEventListener('load', function () {
    init();
  });

  // ── Expose globals ─────────────────────────────────────────────────────────
  window._buildTutorialActive   = function () { return isActive; };
  window._buildTutorialGetGhost = function () { return ghostData; };
  window._startBuildTutorial    = startTutorial;
  window._buildTutorialShouldAutoStart = shouldAutoStart;
  // Returns the partType the user is allowed to drag right now, or null when
  // no tutorial step is active or the active step has no part (welcome / wire
  // steps). Consumed by app.js _setPartsLockState to gate the parts panel.
  window._buildTutorialCurrentPartType = function () {
    if (!isActive) return null;
    var step = steps[currentStep];
    return (step && step.partType) ? step.partType : null;
  };

})();
