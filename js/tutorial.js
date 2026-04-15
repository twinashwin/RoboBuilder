// tutorial.js — Mandatory first-time tutorial embedded in the Code tab's right panel.
// Loaded after app.js. Uses globals exposed by app.js:
//   window._validateRobot, window._getRobotConfig, window._addBlockFromXml,
//   window._switchTab, window._blocklyWorkspace
// Listens for: 'robobuilder:goalreached' custom DOM event

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────────
  var STORAGE_KEY = 'robobuilder_tutorial_v1';
  var TOTAL_STEPS = 8;

  // ── State ────────────────────────────────────────────────────────────────────
  var currentStep        = 0;
  var changeListenerKey  = null;
  var goalListenerAdded  = false;
  var _runCaptureHandler = null;
  var _hwPollTimer       = null;   // interval for live hardware status re-check
  var isReplayMode       = false;  // true when triggered by the replay button

  // ── DOM refs (populated in cacheDOMRefs after load) ──────────────────────────
  var tutPanel, progressFill, stepNumEl, titleEl, bodyEl,
      hwStatusEl, helperBtn, nextBtn, skipBtn;

  // ── Block card selectors (corrected: .bc-motor is on the CARD, not category) ─
  // DOM structure: #blocks-list > .block-category > .bc-items > .block-card.bc-motor
  var SEL_SPIN_MOTOR     = '#blocks-list .bc-items .block-card.bc-motor:nth-child(1)'; // Spin Motor
  var SEL_SPIN_MOTOR_FOR = '#blocks-list .bc-items .block-card.bc-motor:nth-child(2)'; // Spin Motor for
  var SEL_FUNC_BLOCK     = '#blocks-list .block-card.bc-func';                         // Define Function

  // ── Step Definitions ─────────────────────────────────────────────────────────
  // Schema per step:
  //   title        — heading text
  //   body         — HTML string (may include .block-chip spans)
  //   highlightSel — CSS selector for element to pulse-highlight (null = none)
  //   nextLabel    — text for Next button; null = auto-advance (no button shown)
  //   helperLabel  — text for helper button; null = hidden
  //   onHelper     — function called when helper button is clicked
  //   onEnter      — function called when step becomes active
  //   onExit       — function called when leaving this step
  //   showHwStatus — show #tutorial-hw-status panel
  //   nextCssClass — extra CSS class on .tut-next-btn (e.g. 'cta')

  var steps = [

    // ── Step 0: Hardware Ready ─────────────────────────────────────────────────
    {
      title: 'Is Your Robot Ready to Code?',
      body:  'Before writing code, make sure your robot is properly wired. '
           + 'Every item below needs a green check — then the motors will respond.',
      highlightSel: null,
      nextLabel:    'Looks Good, Continue →',
      helperLabel:  null,
      onHelper:     null,
      onEnter:      startHwPolling,   // polls every 1.5 s so live wiring changes appear
      onExit:       stopHwPolling,
      showHwStatus: true,
    },

    // ── Step 1: Meet the Spin Motor Block ─────────────────────────────────────
    {
      title: 'Meet the Spin Motor Block',
      body:  'The <span class="block-chip motor">Spin Motor</span> block tells one motor to spin '
           + 'continuously at a set power level. It stays on until you stop it — great for driving forward.<br><br>'
           + 'It\'s highlighted for you in the <strong>Motors</strong> section of the blocks panel on the left.',
      highlightSel: SEL_SPIN_MOTOR,
      nextLabel:    'Got It →',
      helperLabel:  null,
      onHelper:     null,
      onEnter:      null,
      onExit:       null,
      showHwStatus: false,
    },

    // ── Step 2: Add Two Spin Motor Blocks ─────────────────────────────────────
    {
      title: 'Use Two Spin Motor Blocks',
      body:  'Your robot has <strong>two motors</strong> — one per wheel. '
           + 'You need one <span class="block-chip motor">Spin Motor</span> block for each one.<br><br>'
           + 'Click the <strong>Spin Motor</strong> card twice in the blocks panel, '
           + 'or hit <em>"Add Both For Me"</em> below. Once two are in the workspace, we\'ll move on automatically.',
      highlightSel: SEL_SPIN_MOTOR,
      nextLabel:    null,           // auto-advance when ≥2 motor_spin blocks detected
      helperLabel:  'Add Both For Me',
      onHelper:     addBothMotorSpinBlocks,
      onEnter:      watchForTwoMotorSpinBlocks,
      onExit:       stopBlocklyListener,
      showHwStatus: false,
    },

    // ── Step 3: Select the Right Motors ───────────────────────────────────────
    {
      title: 'Select the Right Motors',
      body:  'Each <span class="block-chip motor">Spin Motor</span> block has a dropdown to choose '
           + '<em>which</em> motor spins.<br><br>'
           + 'Set one block to <strong>Motor A</strong> (left wheel) and the other to <strong>Motor B</strong> '
           + '(right wheel). A power of <strong>5</strong> is a good starting value.',
      highlightSel: null,   // no highlight — user interacts inside Blockly workspace
      nextLabel:    'Got It →',
      helperLabel:  null,
      onHelper:     null,
      onEnter:      null,
      onExit:       null,
      showHwStatus: false,
    },

    // ── Step 4: Test Your Motors ───────────────────────────────────────────────
    {
      title: 'Test Your Motors!',
      body:  'Click the <strong>Run</strong> button in the toolbar above to send your program to the robot.<br><br>'
           + 'Watch the simulator on the right — just click <strong>Run</strong> and we\'ll move '
           + 'to the next step automatically.',
      highlightSel: '#btn-run',   // navbar Run button
      nextLabel:    null,         // auto-advance when either Run button is clicked
      helperLabel:  null,
      onHelper:     null,
      onEnter:      watchRunButton,
      onExit:       stopWatchingRun,
      showHwStatus: false,
    },

    // ── Step 5: Drive a Distance, Then Stop ───────────────────────────────────
    {
      title: 'Drive a Distance, Then Stop',
      body:  'The <span class="block-chip motor">Spin Motor for</span> block runs a motor for a set time '
           + 'then stops automatically — perfect for driving exact distances.<br><br>'
           + 'The <span class="block-chip motor">Stop Motor</span> block halts any motor on demand.<br><br>'
           + 'Add a <strong>Spin Motor for</strong> block from the panel to continue automatically.',
      highlightSel: SEL_SPIN_MOTOR_FOR,   // highlights "Spin Motor for" card specifically
      nextLabel:    null,                   // auto-advance when motor_spin_for is added
      helperLabel:  null,
      onHelper:     null,
      onEnter:      watchForMotorSpinForBlock,
      onExit:       stopBlocklyListener,
      showHwStatus: false,
    },

    // ── Step 6: Create a Turn Function ────────────────────────────────────────
    {
      title: 'Turn to an Exact Angle with a Function',
      body:  'A <span class="block-chip fn">Function</span> is a reusable custom block — define it once, '
           + 'call it anywhere.<br><br>'
           + 'We\'ll create a <strong>turnRight</strong> function that spins the two motors in opposite directions '
           + 'to pivot the robot in place. Click <em>"Create turnRight For Me"</em> or open '
           + '<strong>Functions → Define Function</strong> yourself. Once a function exists, we\'ll continue.',
      highlightSel: SEL_FUNC_BLOCK,   // highlights "Define Function" card
      nextLabel:    null,              // auto-advance when func_define block detected
      helperLabel:  'Create turnRight For Me',
      onHelper:     createTurnRightFunction,
      onEnter:      watchForFuncDefine,
      onExit:       stopBlocklyListener,
      showHwStatus: false,
    },

    // ── Step 7: Your First Challenge ──────────────────────────────────────────
    {
      title: 'Your First Challenge!',
      body:  'Time to put it all together. Click <strong>Start Challenge</strong> then hit '
           + '<strong>Run</strong> in the toolbar.<br><br>'
           + 'Use what you\'ve learned to reach the <strong>green goal zone</strong>:<br>'
           + '• <span class="block-chip motor">Spin Motor for</span> to drive forward<br>'
           + '• Your <span class="block-chip fn">turnRight</span> function to steer<br>'
           + '• <span class="block-chip motor">Stop Motor</span> to finish cleanly<br><br>'
           + 'Reaching the goal completes the tutorial!',
      highlightSel: null,
      nextLabel:    'Start Challenge →',
      nextCssClass: 'cta',
      helperLabel:  null,
      onHelper:     null,
      onEnter:      listenForGoalReached,
      onExit:       null,
      showHwStatus: false,
    },
  ];

  // ── Entry Point ──────────────────────────────────────────────────────────────
  window.addEventListener('load', function () {
    cacheDOMRefs();
    wireReplayButton();

    // Auto-trigger only fires if the tutorial has never been completed
    if (localStorage.getItem(STORAGE_KEY) !== 'done') {
      wireCodeTabListener();
    }
  });

  // ── DOM Helpers ──────────────────────────────────────────────────────────────
  function cacheDOMRefs() {
    tutPanel     = document.getElementById('tutorial-right');
    progressFill = document.getElementById('tutorial-progress-fill');
    stepNumEl    = document.getElementById('tut-step-num');
    titleEl      = document.getElementById('tutorial-title');
    bodyEl       = document.getElementById('tutorial-body');
    hwStatusEl   = document.getElementById('tutorial-hw-status');
    helperBtn    = document.getElementById('tut-btn-helper');
    nextBtn      = document.getElementById('tut-btn-next');
    skipBtn      = document.getElementById('tut-btn-skip');
    skipBtn.addEventListener('click', skipTutorial);
  }

  // Wire the navbar "Tutorial" replay button — always works regardless of progress
  function wireReplayButton() {
    var btn = document.getElementById('btn-replay-tutorial');
    if (!btn) return;
    btn.addEventListener('click', function () {
      isReplayMode = true;
      if (window._switchTab) window._switchTab('code');
      setTimeout(startTutorial, 150);
    });
  }

  // Auto-trigger: fires on the very first Code tab click for first-time users
  function wireCodeTabListener() {
    var codeBtn = document.querySelector('.tab-btn[data-tab="code"]');
    if (!codeBtn) return;
    codeBtn.addEventListener('click', function handler() {
      codeBtn.removeEventListener('click', handler);
      isReplayMode = false;
      setTimeout(startTutorial, 150);
    });
  }

  // ── Show / Hide the tutorial panel ───────────────────────────────────────────
  function startTutorial() {
    tutPanel.removeAttribute('hidden');
    currentStep = 0;
    goToStep(0);
  }

  function endTutorial() {
    stopHwPolling();
    tutPanel.setAttribute('hidden', '');
    clearHighlight();
  }

  // ── Core Navigation ──────────────────────────────────────────────────────────
  function goToStep(idx) {
    // Teardown previous step
    if (currentStep !== idx && steps[currentStep] && steps[currentStep].onExit) {
      steps[currentStep].onExit();
    }
    clearHighlight();

    currentStep = idx;
    var step = steps[idx];

    // Progress bar
    progressFill.style.width = (idx / TOTAL_STEPS * 100) + '%';
    var prog = document.getElementById('tutorial-progress');
    if (prog) prog.setAttribute('aria-valuenow', idx + 1);

    // Step badge & card content
    stepNumEl.textContent = idx + 1;
    titleEl.textContent   = step.title;
    bodyEl.innerHTML      = step.body;
    // Use attribute directly so CSS :not([hidden]) rule works correctly
    if (step.showHwStatus) {
      hwStatusEl.removeAttribute('hidden');
    } else {
      hwStatusEl.setAttribute('hidden', '');
    }

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
      nextBtn.className   = 'tut-next-btn' + (step.nextCssClass ? ' ' + step.nextCssClass : '');
      nextBtn.onclick     = function () { advanceStep(); };
    } else {
      nextBtn.hidden  = true;
      nextBtn.onclick = null;
    }

    // Apply highlight to target element
    if (step.highlightSel) {
      applyHighlight(step.highlightSel);
    }

    // Step entry hook
    if (step.onEnter) step.onEnter();
  }

  function advanceStep() {
    if (currentStep >= TOTAL_STEPS - 1) {
      endTutorial();
      return;
    }
    goToStep(currentStep + 1);
  }

  function skipTutorial() {
    stopBlocklyListener();
    stopWatchingRun();
    stopHwPolling();
    clearHighlight();
    endTutorial();
    // Skipping does NOT write STORAGE_KEY — tutorial reappears on next Code tab visit
  }

  // ── Element Highlight ─────────────────────────────────────────────────────────
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

  // ── Step Hook: Hardware Polling (Step 0) ──────────────────────────────────────
  // Polls every 1.5 s so the status panel updates when the user wires things in
  // the Build tab and returns to the Code tab.
  function startHwPolling() {
    renderHardwareStatus();
    _hwPollTimer = setInterval(renderHardwareStatus, 1500);
  }

  function stopHwPolling() {
    if (_hwPollTimer !== null) {
      clearInterval(_hwPollTimer);
      _hwPollTimer = null;
    }
  }

  function renderHardwareStatus() {
    var config = window._getRobotConfig ? window._getRobotConfig() : {};
    var parts  = (config && config.parts)       || [];
    var conns  = (config && config.connections) || [];

    // Directly inspect config — don't parse error strings (too fragile)
    var brain   = parts.find(function (p) { return p.type === 'brain'; });
    var battery = parts.find(function (p) { return p.type === 'battery'; });
    var motors  = parts.filter(function (p) { return p.type === 'motor'; });

    var battWired = !!(brain && battery && conns.some(function (c) {
      return (c.fromId === battery.id && c.toId === brain.id) ||
             (c.fromId === brain.id   && c.toId === battery.id);
    }));

    var motorsWired = motors.length > 0 && !!brain && motors.every(function (m) {
      return conns.some(function (c) {
        return (c.fromId === brain.id && c.toId === m.id) ||
               (c.fromId === m.id     && c.toId === brain.id);
      });
    });

    var checks = [
      { label: 'Brain placed',           ok: !!brain },
      { label: 'Battery wired to brain', ok: battWired },
      { label: 'Motor(s) wired to brain', ok: motorsWired },
    ];

    hwStatusEl.innerHTML = '';
    var allOk = true;
    checks.forEach(function (c) {
      if (!c.ok) allOk = false;
      var row = document.createElement('div');
      row.className = 'tut-hw-row';
      row.innerHTML =
        '<span class="tut-hw-badge ' + (c.ok ? 'ok' : 'warn') + '">' + (c.ok ? '✓' : '!') + '</span>' +
        '<span>' + c.label + '</span>';
      hwStatusEl.appendChild(row);
    });

    if (!allOk) {
      var btn = document.createElement('button');
      btn.className   = 'tut-hw-goto-build';
      btn.textContent = 'Go to Build tab to fix wiring →';
      btn.addEventListener('click', function () {
        if (window._switchTab) window._switchTab('build');
      });
      hwStatusEl.appendChild(btn);
    }

    hwStatusEl.removeAttribute('hidden');
  }

  // ── Step Hook: Add Both Motor Spin Blocks (Step 2 helper) ────────────────────
  function addBothMotorSpinBlocks() {
    if (!window._addBlockFromXml) return;
    ['A', 'B'].forEach(function (motor) {
      window._addBlockFromXml(
        '<block type="motor_spin">' +
          '<field name="MOTOR">' + motor + '</field>' +
          '<value name="SPEED">' +
            '<shadow type="math_number"><field name="NUM">5</field></shadow>' +
          '</value>' +
        '</block>'
      );
    });
  }

  // ── Step Hook: Watch for Two motor_spin Blocks (Step 2 onEnter) ──────────────
  function watchForTwoMotorSpinBlocks() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watchForTwoMotorSpinBlocks, 500); return; }
    changeListenerKey = ws.addChangeListener(function () {
      var count = ws.getAllBlocks(false).filter(function (b) {
        return b.type === 'motor_spin';
      }).length;
      if (count >= 2) { stopBlocklyListener(); advanceStep(); }
    });
  }

  // ── Step Hook: Watch for motor_spin_for Block (Step 5 onEnter) ───────────────
  function watchForMotorSpinForBlock() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watchForMotorSpinForBlock, 500); return; }
    changeListenerKey = ws.addChangeListener(function () {
      var found = ws.getAllBlocks(false).some(function (b) {
        return b.type === 'motor_spin_for';
      });
      if (found) { stopBlocklyListener(); advanceStep(); }
    });
  }

  // ── Step Hook: Watch Both Run Buttons (Step 4 onEnter) ───────────────────────
  // Watches both #btn-run (navbar) and #btn-run-panel (field panel) since both
  // are now always visible in the sandwich layout.
  function watchRunButton() {
    var btnIds = ['btn-run', 'btn-run-panel'];
    var buttons = btnIds.map(function (id) {
      return document.getElementById(id);
    }).filter(Boolean);

    if (!buttons.length) {
      nextBtn.hidden      = false;
      nextBtn.textContent = 'Next →';
      nextBtn.onclick     = function () { advanceStep(); };
      return;
    }

    _runCaptureHandler = function () {
      // Remove from all buttons before advancing
      buttons.forEach(function (btn) {
        btn.removeEventListener('click', _runCaptureHandler, true);
      });
      _runCaptureHandler = null;
      setTimeout(advanceStep, 300);
    };

    buttons.forEach(function (btn) {
      btn.addEventListener('click', _runCaptureHandler, true);
    });
  }

  function stopWatchingRun() {
    if (!_runCaptureHandler) return;
    ['btn-run', 'btn-run-panel'].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.removeEventListener('click', _runCaptureHandler, true);
    });
    _runCaptureHandler = null;
  }

  // ── Step Hook: Create turnRight Function (Step 6 helper) ─────────────────────
  function createTurnRightFunction() {
    if (!window._addBlockFromXml) return;
    window._addBlockFromXml(
      '<block type="func_define">' +
        '<field name="FUNC_NAME">turnRight</field>' +
        '<mutation paramids="[]" params="[]"></mutation>' +
        '<statement name="STACK">' +
          '<block type="motor_spin">' +
            '<field name="MOTOR">A</field>' +
            '<value name="SPEED">' +
              '<shadow type="math_number"><field name="NUM">-5</field></shadow>' +
            '</value>' +
            '<next>' +
              '<block type="motor_spin">' +
                '<field name="MOTOR">B</field>' +
                '<value name="SPEED">' +
                  '<shadow type="math_number"><field name="NUM">5</field></shadow>' +
                '</value>' +
                '<next>' +
                  '<block type="wait_seconds">' +
                    '<value name="SECS">' +
                      '<shadow type="math_number"><field name="NUM">0.5</field></shadow>' +
                    '</value>' +
                    '<next>' +
                      '<block type="motor_stop">' +
                        '<field name="MOTOR">A</field>' +
                      '</block>' +
                    '</next>' +
                  '</block>' +
                '</next>' +
              '</block>' +
            '</next>' +
          '</block>' +
        '</statement>' +
      '</block>'
    );
  }

  // ── Step Hook: Watch for func_define Block (Step 6 onEnter) ──────────────────
  function watchForFuncDefine() {
    var ws = window._blocklyWorkspace;
    if (!ws) { setTimeout(watchForFuncDefine, 500); return; }
    changeListenerKey = ws.addChangeListener(function () {
      if (ws.getBlocksByType('func_define', false).length >= 1) {
        stopBlocklyListener();
        advanceStep();
      }
    });
  }

  // ── Step Hook: Listen for Goal Reached (Step 7 onEnter) ──────────────────────
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

  function showCompleteCard() {
    var existing = document.getElementById('tutorial-complete-card');
    if (existing) existing.remove();

    var el = document.createElement('div');
    el.id = 'tutorial-complete-card';
    el.innerHTML =
      '<div style="font-size:2.5rem">🎉</div>' +
      '<h3>Tutorial Complete!</h3>' +
      '<p>You\'ve mastered the basics of coding your robot. Keep going with Lessons 2–10!</p>' +
      '<button id="tut-done-btn" class="tut-next-btn cta" type="button">Let\'s Go →</button>';
    document.body.appendChild(el);
    document.getElementById('tut-done-btn').addEventListener('click', function () {
      el.remove();
    });
  }

  // ── Shared Cleanup ────────────────────────────────────────────────────────────
  function stopBlocklyListener() {
    var ws = window._blocklyWorkspace;
    if (ws && changeListenerKey !== null) {
      ws.removeChangeListener(changeListenerKey);
      changeListenerKey = null;
    }
  }

})();
