// tutorial.js — 9-step code tutorial for the Code tab.
// Loaded after app.js, loginModal.js, buildTutorial.js.
// Uses globals: window._addBlockFromXml, window._switchTab,
//   window._blocklyWorkspace, window._activeTab, window._startBuildTutorial

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  var STORAGE_KEY = 'robobuilder_tutorial_v1';
  var TOTAL_STEPS = 9;

  // ── State ────────────────────────────────────────────────────────────────────
  var currentStep        = 0;
  var changeListenerKey  = null;
  var goalListenerAdded  = false;
  var _runCaptureHandler = null;
  var isReplayMode       = false;

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  var tutPanel, progressFill, stepNumEl, stepTotalEl, titleEl, bodyEl,
      hwStatusEl, helperBtn, nextBtn, skipBtn, skipStepBtn;

  // ── Block card selectors ─────────────────────────────────────────────────────
  var SEL_SPIN_MOTOR = '#blocks-list .bc-items .block-card.bc-motor:nth-child(1)';
  var SEL_STOP_MOTOR = '#blocks-list .bc-items .block-card.bc-motor:nth-child(3)';
  var SEL_WAIT       = '#blocks-list .bc-items .block-card.bc-control:nth-child(2)';
  var SEL_FUNC_BLOCK = '#blocks-list .block-card.bc-func';

  // ── Step Definitions ─────────────────────────────────────────────────────────

  var steps = [

    // ── Step 1: Spin Both Motors ───────────────────────────────────────────────
    {
      title: 'Spin Both Motors',
      body:  '<p>Your robot has <strong>two motors</strong> — Motor A (left) and Motor B (right). '
           + 'To drive forward, both need to spin!</p>'
           + '<p>Drag two <span class="block-chip motor">Spin Motor</span> blocks from the panel and '
           + 'snap them inside the <strong>when program starts</strong> block.</p>'
           + '<p>Then change the second one\'s dropdown from <strong>Motor A</strong> to <strong>Motor B</strong>.</p>'
           + '<p>When both motors are set up, click <strong>Run</strong> to test!</p>',
      highlightSel: SEL_SPIN_MOTOR,
      nextLabel:    null,
      helperLabel:  'Do It For Me',
      onHelper:     helper_addBothSpinBlocks,
      onEnter:      watch_step1,
      onExit:       stopBlocklyListener,
    },

    // ── Step 2: Stop the Robot ─────────────────────────────────────────────────
    {
      title: 'The Robot Never Stopped!',
      body:  '<p>Did you notice? The motors kept spinning forever! '
           + 'Your robot needs to know when to <strong>stop</strong>.</p>'
           + '<p>Add two <span class="block-chip motor">Stop Motor</span> blocks — '
           + 'one for Motor A and one for Motor B — <strong>after</strong> the spin blocks.</p>'
           + '<p>Then click <strong>Run</strong> again.</p>',
      highlightSel: SEL_STOP_MOTOR,
      nextLabel:    null,
      helperLabel:  'Do It For Me',
      onHelper:     helper_addBothStopBlocks,
      onEnter:      watch_step2,
      onExit:       stopBlocklyListener,
    },

    // ── Step 3: Add a Pause ────────────────────────────────────────────────────
    {
      title: 'It Stopped Instantly!',
      body:  '<p>Wait — the robot started <em>and</em> stopped at the same instant, so it never moved!</p>'
           + '<p>Code runs really fast. You need a <span class="block-chip control">Wait</span> block '
           + 'between the spin and stop blocks to give the motors time to run.</p>'
           + '<p>Add a <strong>Wait</strong> block set to <strong>0.25</strong> seconds between '
           + 'the spin blocks and the stop blocks. Then <strong>Run</strong> again.</p>',
      highlightSel: SEL_WAIT,
      nextLabel:    null,
      helperLabel:  'Do It For Me',
      onHelper:     helper_addWaitBlock,
      onEnter:      watch_step3,
      onExit:       stopBlocklyListener,
    },

    // ── Step 4: Create turnRight Function ──────────────────────────────────────
    {
      title: 'Create a turnRight Function',
      body:  '<p>Awesome! Your robot drives forward and stops. But what about <strong>turning?</strong></p>'
           + '<p>Let\'s create a reusable <strong>function</strong> called <code>turnRight</code>. '
           + 'A function groups blocks together so you can call them with a single block.</p>'
           + '<p>Open <strong>Functions</strong> in the blocks panel and click '
           + '<strong>Define Function</strong>. Name it <code>turnRight</code>.</p>',
      highlightSel: SEL_FUNC_BLOCK,
      nextLabel:    null,
      helperLabel:  'Create It For Me',
      onHelper:     helper_createTurnRightEmpty,
      onEnter:      watch_step4,
      onExit:       stopBlocklyListener,
    },

    // ── Step 5: Spin Motors to Turn ────────────────────────────────────────────
    {
      title: 'Make the Robot Turn',
      body:  '<p>To turn right, spin the motors in <strong>opposite directions</strong>:</p>'
           + '<ul style="margin:0.3rem 0;padding-left:1.2rem">'
           + '<li>Motor A at power <strong>5</strong> (forward)</li>'
           + '<li>Motor B at power <strong>-5</strong> (backward)</li>'
           + '</ul>'
           + '<p>Drag two <span class="block-chip motor">Spin Motor</span> blocks <strong>inside</strong> '
           + 'your <code>turnRight</code> function. Set Motor B to <strong>-5</strong> power.</p>',
      highlightSel: SEL_SPIN_MOTOR,
      nextLabel:    null,
      helperLabel:  'Do It For Me',
      onHelper:     helper_fillTurnRight_spins,
      onEnter:      watch_step5,
      onExit:       stopBlocklyListener,
    },

    // ── Step 6: Add Wait to Turn ───────────────────────────────────────────────
    {
      title: 'How Long to Turn?',
      body:  '<p>The spin blocks start the motors, but without a <strong>wait</strong>, '
           + 'the robot will try to stop immediately again!</p>'
           + '<p>Add a <span class="block-chip control">Wait</span> block inside <code>turnRight</code>, '
           + 'set to <strong>0.1</strong> seconds. This controls how far the robot turns.</p>',
      highlightSel: SEL_WAIT,
      nextLabel:    null,
      helperLabel:  'Do It For Me',
      onHelper:     helper_fillTurnRight_wait,
      onEnter:      watch_step6,
      onExit:       stopBlocklyListener,
    },

    // ── Step 7: Add Stop Blocks to Turn ────────────────────────────────────────
    {
      title: 'Stop After Turning',
      body:  '<p>Almost done with your turn function! Add two <span class="block-chip motor">Stop Motor</span> '
           + 'blocks at the end — one for Motor A and one for Motor B.</p>'
           + '<p>Your complete <code>turnRight</code> function should be:<br>'
           + 'Spin A forward → Spin B backward → Wait → Stop A → Stop B</p>',
      highlightSel: SEL_STOP_MOTOR,
      nextLabel:    null,
      helperLabel:  'Do It For Me',
      onHelper:     helper_fillTurnRight_stops,
      onEnter:      watch_step7,
      onExit:       stopBlocklyListener,
    },

    // ── Step 8: Call turnRight ──────────────────────────────────────────────────
    {
      title: 'Use Your Function!',
      body:  '<p>Your <code>turnRight</code> function is complete! Now let\'s use it.</p>'
           + '<p>In the <strong>Functions</strong> section of the blocks panel, you should see a '
           + '<strong>turnRight</strong> call block. Drag it into your '
           + '<strong>when program starts</strong> block.</p>'
           + '<p>Then click <strong>Run</strong> — watch the robot drive forward, then turn right!</p>',
      highlightSel: SEL_FUNC_BLOCK,
      nextLabel:    null,
      helperLabel:  'Do It For Me',
      onHelper:     helper_addCallTurnRight,
      onEnter:      watch_step8,
      onExit:       stopBlocklyListener,
    },

    // ── Step 9: Drive to the Checkpoint ────────────────────────────────────────
    {
      title: 'Drive to the Checkpoint!',
      body:  '<p>Final challenge: drive your robot to the <strong>green goal zone</strong>!</p>'
           + '<p>Combine everything you\'ve learned:</p>'
           + '<ul style="margin:0.3rem 0;padding-left:1.2rem">'
           + '<li><span class="block-chip motor">Spin Motor</span> to drive forward</li>'
           + '<li><span class="block-chip control">Wait</span> to control timing</li>'
           + '<li><code>turnRight</code> to steer</li>'
           + '<li><span class="block-chip motor">Stop Motor</span> to finish</li>'
           + '</ul>'
           + '<p>Looks good — once it\'s working here, head over to the <strong>Test tab</strong> to see your robot in a full 3D field!</p>',
      highlightSel: null,
      nextLabel:    null,
      helperLabel:  'Show Hint',
      onHelper:     helper_showSolutionHint,
      onEnter:      listenForGoalReached,
      onExit:       null,
    },
  ];

  // ── Entry Point ──────────────────────────────────────────────────────────────
  window.addEventListener('load', function () {
    cacheDOMRefs();
    wireReplayButton();

    // Auto-trigger: fires on first Code tab click for first-time users
    if (localStorage.getItem(STORAGE_KEY) !== 'done') {
      wireCodeTabListener();
    }

    // Also listen for build tutorial completion — start code tutorial when user
    // arrives at Code tab after finishing the build
    window.addEventListener('robobuilder:buildtutorial-done', function () {
      if (localStorage.getItem(STORAGE_KEY) === 'done') return;
      var codeBtn = document.querySelector('.tab-btn[data-tab="code"]');
      if (codeBtn) {
        codeBtn.addEventListener('click', function handler() {
          codeBtn.removeEventListener('click', handler);
          isReplayMode = false;
          setTimeout(startTutorial, 300);
        });
      }
    });
  });

  // ── DOM Helpers ──────────────────────────────────────────────────────────────
  function cacheDOMRefs() {
    tutPanel     = document.getElementById('tutorial-right');
    progressFill = document.getElementById('tutorial-progress-fill');
    stepNumEl    = document.getElementById('tut-step-num');
    stepTotalEl  = document.getElementById('tut-step-total');
    titleEl      = document.getElementById('tutorial-title');
    bodyEl       = document.getElementById('tutorial-body');
    hwStatusEl   = document.getElementById('tutorial-hw-status');
    helperBtn    = document.getElementById('tut-btn-helper');
    nextBtn      = document.getElementById('tut-btn-next');
    skipBtn      = document.getElementById('tut-btn-skip');
    skipStepBtn  = document.getElementById('tut-btn-skip-step');
    if (skipBtn) skipBtn.addEventListener('click', skipTutorial);
    if (skipStepBtn) skipStepBtn.addEventListener('click', skipCurrentStep);
    if (stepTotalEl) stepTotalEl.textContent = TOTAL_STEPS;
  }

  function wireReplayButton() {
    var btn = document.getElementById('btn-replay-tutorial');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // Check which tab is active — route to appropriate tutorial
      var onBuildTab = window._activeTab === 'build' ||
        (document.getElementById('view-build') && document.getElementById('view-build').classList.contains('active'));
      if (onBuildTab) {
        if (window._startBuildTutorial) window._startBuildTutorial();
      } else {
        isReplayMode = true;
        setTimeout(startTutorial, 150);
      }
    });
  }

  function wireCodeTabListener() {
    var codeBtn = document.querySelector('.tab-btn[data-tab="code"]');
    if (!codeBtn) return;
    codeBtn.addEventListener('click', function handler() {
      codeBtn.removeEventListener('click', handler);
      isReplayMode = false;
      setTimeout(startTutorial, 300);
    });
  }

  // ── Show / Hide ──────────────────────────────────────────────────────────────
  function startTutorial() {
    if (!tutPanel) return;
    // Hide the projects panel if it's open — tutorial takes precedence while running.
    var projectsPanel = document.getElementById('projects-right');
    if (projectsPanel) projectsPanel.setAttribute('hidden', '');
    tutPanel.removeAttribute('hidden');
    currentStep = 0;
    goToStep(0);
  }

  function endTutorial() {
    if (tutPanel) tutPanel.setAttribute('hidden', '');
    clearHighlight();
  }

  // ── Core Navigation ──────────────────────────────────────────────────────────
  function goToStep(idx) {
    if (currentStep !== idx && steps[currentStep] && steps[currentStep].onExit) {
      steps[currentStep].onExit();
    }
    clearHighlight();

    currentStep = idx;
    var step = steps[idx];

    // Progress bar
    progressFill.style.width = ((idx + 1) / TOTAL_STEPS * 100) + '%';
    var prog = document.getElementById('tutorial-progress');
    if (prog) prog.setAttribute('aria-valuenow', idx + 1);

    stepNumEl.textContent = idx + 1;
    titleEl.textContent   = step.title;
    bodyEl.innerHTML      = step.body;

    // Hardware status panel — hide, not used in new tutorial
    if (hwStatusEl) hwStatusEl.setAttribute('hidden', '');

    // Helper button
    if (step.helperLabel) {
      helperBtn.hidden      = false;
      helperBtn.textContent = step.helperLabel;
      helperBtn.onclick     = step.onHelper || null;
    } else {
      helperBtn.hidden  = true;
      helperBtn.onclick = null;
    }

    // Next button
    if (step.nextLabel) {
      nextBtn.hidden      = false;
      nextBtn.textContent = step.nextLabel;
      nextBtn.onclick     = function () { advanceStep(); };
    } else {
      nextBtn.hidden  = true;
      nextBtn.onclick = null;
    }

    // Skip Step button — available on all steps except the final one
    if (skipStepBtn) {
      skipStepBtn.hidden = (idx >= TOTAL_STEPS - 1);
    }

    // Highlight
    if (step.highlightSel) applyHighlight(step.highlightSel);

    // Entry hook
    if (step.onEnter) step.onEnter();
  }

  function advanceStep() {
    if (currentStep >= TOTAL_STEPS - 1) {
      endTutorial();
      return;
    }
    goToStep(currentStep + 1);
  }

  // Skip the current step only (advances one step, same as clicking Next).
  // Visually distinct from the "Skip Tutorial" button which exits entirely.
  function skipCurrentStep() {
    if (steps[currentStep] && steps[currentStep].onExit) {
      steps[currentStep].onExit();
    }
    stopWatchingRun();
    advanceStep();
  }

  function skipTutorial() {
    stopBlocklyListener();
    stopWatchingRun();
    clearHighlight();
    endTutorial();
    // Notify projects.js (and any other listener) that the tutorial panel
    // is now hidden so they can show the projects panel.
    window.dispatchEvent(new CustomEvent('robobuilder:tutorial-closed', {
      detail: { reason: 'skipped' }
    }));
  }

  // ── Highlight ─────────────────────────────────────────────────────────────────
  var _currentHighlightEl = null;

  function applyHighlight(selector) {
    var el = document.querySelector(selector);
    if (!el) return;
    _currentHighlightEl = el;
    var isNavEl = el.closest('#navbar') !== null;
    el.classList.add(isNavEl ? 'tut-highlight-nav' : 'tut-highlight');
  }

  function clearHighlight() {
    if (_currentHighlightEl) {
      _currentHighlightEl.classList.remove('tut-highlight', 'tut-highlight-nav');
      _currentHighlightEl = null;
    }
  }

  // ── Shared: watch Run button press ────────────────────────────────────────────
  function watchRunButton(callback) {
    var btnIds = ['btn-run', 'btn-run-panel'];
    var buttons = btnIds.map(function (id) { return document.getElementById(id); }).filter(Boolean);
    if (!buttons.length) return;

    _runCaptureHandler = function () {
      buttons.forEach(function (btn) { btn.removeEventListener('click', _runCaptureHandler, true); });
      _runCaptureHandler = null;
      setTimeout(callback, 300);
    };
    buttons.forEach(function (btn) { btn.addEventListener('click', _runCaptureHandler, true); });
  }

  function stopWatchingRun() {
    if (!_runCaptureHandler) return;
    ['btn-run', 'btn-run-panel'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.removeEventListener('click', _runCaptureHandler, true);
    });
    _runCaptureHandler = null;
  }

  function stopBlocklyListener() {
    var ws = window._blocklyWorkspace;
    if (ws && changeListenerKey !== null) {
      ws.removeChangeListener(changeListenerKey);
      changeListenerKey = null;
    }
  }

  // ── Step 1: Watch for 2 motor_spin blocks + Run ───────────────────────────────
  function watch_step1() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watch_step1, 500); return; }

    // Wait for 2 motor_spin blocks with different motors, then watch for Run
    changeListenerKey = ws.addChangeListener(function () {
      var spins = ws.getAllBlocks(false).filter(function (b) { return b.type === 'motor_spin'; });
      if (spins.length < 2) return;
      // Check one is Motor A and one is Motor B
      var motors = spins.map(function (b) { return b.getFieldValue('MOTOR'); });
      if (motors.indexOf('A') >= 0 && motors.indexOf('B') >= 0) {
        stopBlocklyListener();
        watchRunButton(function () { advanceStep(); });
      }
    });
  }

  function helper_addBothSpinBlocks() {
    if (!window._addBlockFromXml) return;
    window._addBlockFromXml(
      '<block type="motor_spin">' +
        '<field name="MOTOR">A</field>' +
        '<value name="SPEED"><shadow type="math_number"><field name="NUM">5</field></shadow></value>' +
      '</block>'
    );
    window._addBlockFromXml(
      '<block type="motor_spin">' +
        '<field name="MOTOR">B</field>' +
        '<value name="SPEED"><shadow type="math_number"><field name="NUM">5</field></shadow></value>' +
      '</block>'
    );
  }

  // ── Step 2: Watch for 2 motor_stop blocks + Run ───────────────────────────────
  function watch_step2() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watch_step2, 500); return; }

    changeListenerKey = ws.addChangeListener(function () {
      var stops = ws.getAllBlocks(false).filter(function (b) { return b.type === 'motor_stop'; });
      if (stops.length >= 2) {
        stopBlocklyListener();
        watchRunButton(function () { advanceStep(); });
      }
    });
  }

  function helper_addBothStopBlocks() {
    if (!window._addBlockFromXml) return;
    window._addBlockFromXml('<block type="motor_stop"><field name="MOTOR">A</field></block>');
    window._addBlockFromXml('<block type="motor_stop"><field name="MOTOR">B</field></block>');
  }

  // ── Step 3: Watch for wait_seconds block + Run ────────────────────────────────
  function watch_step3() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watch_step3, 500); return; }

    changeListenerKey = ws.addChangeListener(function () {
      var waits = ws.getAllBlocks(false).filter(function (b) { return b.type === 'wait_seconds'; });
      if (waits.length >= 1) {
        stopBlocklyListener();
        watchRunButton(function () { advanceStep(); });
      }
    });
  }

  function helper_addWaitBlock() {
    if (!window._addBlockFromXml) return;
    window._addBlockFromXml(
      '<block type="wait_seconds">' +
        '<value name="SECS"><shadow type="math_number"><field name="NUM">0.25</field></shadow></value>' +
      '</block>'
    );
  }

  // ── Step 4: Watch for func_define block named turnRight ───────────────────────
  function watch_step4() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watch_step4, 500); return; }

    changeListenerKey = ws.addChangeListener(function () {
      var funcDefs = ws.getBlocksByType('func_define', false);
      if (funcDefs.length >= 1) {
        stopBlocklyListener();
        advanceStep();
      }
    });
  }

  function helper_createTurnRightEmpty() {
    if (!window._addBlockFromXml) return;
    window._addBlockFromXml(
      '<block type="func_define">' +
        '<field name="FUNC_NAME">turnRight</field>' +
        '<mutation paramids="[]" params="[]"></mutation>' +
      '</block>'
    );
  }

  // ── Step 5: Watch for 2 motor_spin blocks inside func_define ──────────────────
  function watch_step5() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watch_step5, 500); return; }

    changeListenerKey = ws.addChangeListener(function () {
      var funcDefs = ws.getBlocksByType('func_define', false);
      if (funcDefs.length === 0) return;

      // Count motor_spin blocks that are descendants of any func_define
      var spinCount = 0;
      funcDefs.forEach(function (fd) {
        var children = fd.getDescendants(false);
        children.forEach(function (c) {
          if (c.type === 'motor_spin') spinCount++;
        });
      });

      if (spinCount >= 2) {
        stopBlocklyListener();
        advanceStep();
      }
    });
  }

  function helper_fillTurnRight_spins() {
    if (!window._addBlockFromXml) return;
    // Find existing func_define and insert spin blocks into it
    var ws = window._blocklyWorkspace;
    if (!ws) return;
    var funcDefs = ws.getBlocksByType('func_define', false);
    if (funcDefs.length === 0) {
      // Create the function first
      helper_createTurnRightEmpty();
      setTimeout(helper_fillTurnRight_spins, 300);
      return;
    }
    // Add blocks that the user will manually connect
    window._addBlockFromXml(
      '<block type="motor_spin">' +
        '<field name="MOTOR">A</field>' +
        '<value name="SPEED"><shadow type="math_number"><field name="NUM">5</field></shadow></value>' +
      '</block>'
    );
    window._addBlockFromXml(
      '<block type="motor_spin">' +
        '<field name="MOTOR">B</field>' +
        '<value name="SPEED"><shadow type="math_number"><field name="NUM">-5</field></shadow></value>' +
      '</block>'
    );
  }

  // ── Step 6: Watch for wait_seconds inside func_define ─────────────────────────
  function watch_step6() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watch_step6, 500); return; }

    changeListenerKey = ws.addChangeListener(function () {
      var funcDefs = ws.getBlocksByType('func_define', false);
      if (funcDefs.length === 0) return;

      var hasWait = false;
      funcDefs.forEach(function (fd) {
        fd.getDescendants(false).forEach(function (c) {
          if (c.type === 'wait_seconds') hasWait = true;
        });
      });

      if (hasWait) {
        stopBlocklyListener();
        advanceStep();
      }
    });
  }

  function helper_fillTurnRight_wait() {
    if (!window._addBlockFromXml) return;
    window._addBlockFromXml(
      '<block type="wait_seconds">' +
        '<value name="SECS"><shadow type="math_number"><field name="NUM">0.1</field></shadow></value>' +
      '</block>'
    );
  }

  // ── Step 7: Watch for 2 motor_stop inside func_define ─────────────────────────
  function watch_step7() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watch_step7, 500); return; }

    changeListenerKey = ws.addChangeListener(function () {
      var funcDefs = ws.getBlocksByType('func_define', false);
      if (funcDefs.length === 0) return;

      var stopCount = 0;
      funcDefs.forEach(function (fd) {
        fd.getDescendants(false).forEach(function (c) {
          if (c.type === 'motor_stop') stopCount++;
        });
      });

      if (stopCount >= 2) {
        stopBlocklyListener();
        advanceStep();
      }
    });
  }

  function helper_fillTurnRight_stops() {
    if (!window._addBlockFromXml) return;
    window._addBlockFromXml('<block type="motor_stop"><field name="MOTOR">A</field></block>');
    window._addBlockFromXml('<block type="motor_stop"><field name="MOTOR">B</field></block>');
  }

  // ── Step 8: Watch for func_call block + Run ───────────────────────────────────
  function watch_step8() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watch_step8, 500); return; }

    changeListenerKey = ws.addChangeListener(function () {
      var calls = ws.getAllBlocks(false).filter(function (b) { return b.type === 'func_call'; });
      if (calls.length >= 1) {
        stopBlocklyListener();
        watchRunButton(function () { advanceStep(); });
      }
    });
  }

  function helper_addCallTurnRight() {
    if (!window._addBlockFromXml) return;
    window._addBlockFromXml(
      '<block type="func_call">' +
        '<field name="FUNC_NAME">turnRight</field>' +
        '<mutation></mutation>' +
      '</block>'
    );
  }

  // ── Step 9: Listen for goal reached ───────────────────────────────────────────
  function listenForGoalReached() {
    if (goalListenerAdded) return;
    goalListenerAdded = true;
    window.addEventListener('robobuilder:goalreached', function handler() {
      window.removeEventListener('robobuilder:goalreached', handler);
      goalListenerAdded = false;
      if (!isReplayMode) {
        localStorage.setItem(STORAGE_KEY, 'done');
      }
      showCompleteCard();
    });
  }

  function helper_showSolutionHint() {
    // Show a hint inside the tutorial body
    bodyEl.innerHTML =
      '<p><strong>Hint:</strong> Here\'s one way to reach the goal:</p>' +
      '<ol style="margin:0.3rem 0;padding-left:1.3rem;font-size:0.82rem">' +
      '<li>Spin Motor A (power 5) + Spin Motor B (power 5)</li>' +
      '<li>Wait 1.5 seconds</li>' +
      '<li>Call <code>turnRight</code></li>' +
      '<li>Spin Motor A (power 5) + Spin Motor B (power 5)</li>' +
      '<li>Wait 1 second</li>' +
      '<li>Stop Motor A + Stop Motor B</li>' +
      '</ol>' +
      '<p style="color:var(--text-3);font-size:0.78rem">Adjust timing based on where the goal zone is!</p>';
  }

  // ── Completion Card ──────────────────────────────────────────────────────────
  function showCompleteCard() {
    var existing = document.getElementById('tutorial-complete-card');
    if (existing) existing.remove();

    var alreadyLoggedIn = window._isLoggedIn && window._isLoggedIn();

    var el = document.createElement('div');
    el.id = 'tutorial-complete-card';

    if (alreadyLoggedIn) {
      el.innerHTML =
        '<div style="font-size:2.5rem">&#127881;</div>' +
        '<h3>Tutorial Complete!</h3>' +
        '<p>You\'ve mastered the basics of coding your robot. Try the Projects for more challenges!</p>' +
        '<button id="tut-done-btn" class="tut-next-btn cta" type="button">Let\'s Go \u2192</button>';
    } else {
      el.innerHTML =
        '<div style="font-size:2.5rem">&#127881;</div>' +
        '<h3>Tutorial Complete!</h3>' +
        '<p>You\'ve mastered the basics! Create your free account to save progress and unlock all parts.</p>' +
        '<button id="tut-done-btn" class="tut-next-btn cta" type="button">Continue \u2192</button>';
    }

    document.body.appendChild(el);
    document.getElementById('tut-done-btn').addEventListener('click', function () {
      el.remove();
    });

    // Fire completion event for login flow
    window.dispatchEvent(new CustomEvent('robobuilder:tutorial-complete'));

    // Pulse the Test tab button to direct the user there — mirrors the same
    // pattern that buildTutorial.js uses to pulse the Code tab at the end.
    var testTabBtn = document.querySelector('.tab-btn[data-tab="test"]');
    if (testTabBtn) testTabBtn.classList.add('tut-highlight-nav');
  }

})();
