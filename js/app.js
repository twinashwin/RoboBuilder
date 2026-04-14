// App – initializes all modules, wires up tabs, lesson navigation, sim controls.

(function () {
  'use strict';

  // ── Build Canvas resolver: prefer 3D if available, fall back to 2D ────────
  const _BC = (typeof BuildCanvas3D !== 'undefined' && BuildCanvas3D) ? BuildCanvas3D : BuildCanvas;

  // ── State ────────────────────────────────────────────────────────────────────
  let activeTab        = 'build';
  let currentLessonIdx = 0;
  let blocklyWorkspace = null;
  let blocklyReady     = false;
  let robotConfig      = { parts: [] };
  let completedLessons = (() => {
    try { return new Set(JSON.parse(localStorage.getItem('robobuilder_progress') || '[]')); }
    catch (e) { return new Set(); }
  })();
  let lessonStars = (() => {
    try { return JSON.parse(localStorage.getItem('robobuilder_stars') || '{}'); }
    catch (e) { return {}; }
  })();

  // ── Theme colors for canvas (read by simCanvas / buildCanvas) ────────────────
  const LIGHT_COLORS = {
    arenaBg:      '#FFFFFF',
    arenaTile:    '#F3F4F6',
    arenaGrid:    'rgba(0,0,0,0.06)',
    arenaBorder:  'rgba(0,0,0,0.12)',
    arenaPip:     'rgba(59,130,246,0.4)',
    obstacle:     '#374151',
    obstacleBord: '#1F2937',
    trail:        'rgba(59,130,246,0.4)',
    dirArrowFill: '#fff',
    dirArrowStroke:'#3B82F6',
    wheelFill:    '#374151',
    wheelStroke:  'rgba(0,0,0,0.2)',
    eyeFill:      '#93C5FD',
    buildBg:      '#F7F8FA',
    buildGrid:    'rgba(0,0,0,0.05)',
    buildGridMaj: 'rgba(0,0,0,0.09)'
  };
  const DARK_COLORS = {
    arenaBg:      '#1A1D27',
    arenaTile:    '#1E2130',
    arenaGrid:    'rgba(255,255,255,0.04)',
    arenaBorder:  'rgba(255,255,255,0.1)',
    arenaPip:     'rgba(96,165,250,0.4)',
    obstacle:     '#4B5563',
    obstacleBord: '#6B7280',
    trail:        'rgba(96,165,250,0.5)',
    dirArrowFill: '#1A1D27',
    dirArrowStroke:'#60A5FA',
    wheelFill:    '#4B5563',
    wheelStroke:  'rgba(255,255,255,0.15)',
    eyeFill:      '#60A5FA',
    buildBg:      '#13151C',
    buildGrid:    'rgba(255,255,255,0.04)',
    buildGridMaj: 'rgba(255,255,255,0.07)'
  };
  window._themeColors = LIGHT_COLORS;

  // Restore theme before first paint
  const savedTheme = localStorage.getItem('robobuilder_theme') || 'light';
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    window._themeColors = DARK_COLORS;
  }

  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    window._themeColors = next === 'dark' ? DARK_COLORS : LIGHT_COLORS;
    localStorage.setItem('robobuilder_theme', next);

    // Swap sun/moon icons
    const sun  = document.getElementById('theme-icon-sun');
    const moon = document.getElementById('theme-icon-moon');
    if (sun)  sun.style.display  = next === 'dark' ? 'none' : '';
    if (moon) moon.style.display = next === 'dark' ? '' : 'none';

    // Swap Blockly theme if workspace exists
    if (blocklyWorkspace) {
      blocklyWorkspace.setTheme(next === 'dark' ? _RoboDark : _RoboLight);
    }

    // Redraw canvases
    if (typeof BuildCanvas3D !== 'undefined' && BuildCanvas3D) BuildCanvas3D.updateTheme();
    else if (typeof BuildCanvas !== 'undefined') BuildCanvas.redraw();
    SimCanvas.redraw();
  }

  let _RoboLight = null;
  let _RoboDark  = null;

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const simCanvas   = document.getElementById('sim-canvas');
  const statusEl    = document.getElementById('sim-status');

  // ── Boot ─────────────────────────────────────────────────────────────────────
  window.addEventListener('load', () => {
    // Splash
    document.getElementById('btn-splash-start').addEventListener('click', () => {
      const splash = document.getElementById('splash-screen');
      splash.style.opacity = '0';
      splash.style.transition = 'opacity 0.4s ease';
      setTimeout(() => { splash.hidden = true; }, 400);
    });

    // Build canvas — use 3D if available, else 2D
    if (_BC === BuildCanvas3D) {
      _BC.init(document.getElementById('build-canvas-wrap'));
    } else {
      const buildCanvasEl = document.getElementById('build-canvas');
      _BC.init(buildCanvasEl);
    }
    populatePartsPanel();
    wireToolbar();
    _BC.setOnConfigChange(onRobotConfigChanged);

    // Properties panel
    PropertiesPanel.init(document.getElementById('props-content'));
    _BC.setOnSelectionChange(placed => {
      PropertiesPanel.showPart(placed);
      if (placed) PropertiesPanel.syncRotation(placed);
    });

    // Sim engine + canvas
    SimEngine.init(simCanvas.width, simCanvas.height);
    SimCanvas.init(simCanvas);

    // Sync initial state
    onRobotConfigChanged(_BC.getRobotConfig());

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.addEventListener('click', () => switchTab(btn.dataset.tab))
    );

    // Nav Run/Stop/Reset/Download (code tab buttons)
    document.getElementById('btn-run').addEventListener('click', onRunClicked);
    document.getElementById('btn-stop-sim').addEventListener('click', () => { CodeRunner.stop(); showRunBtn(true); });
    document.getElementById('btn-reset-sim').addEventListener('click', onResetSim);
    document.getElementById('btn-download').addEventListener('click', onDownloadCode);
    document.getElementById('btn-export').addEventListener('click', onExportProject);
    document.getElementById('btn-import').addEventListener('click', onImportProject);
    document.getElementById('import-file-input').addEventListener('change', handleImportFile);
    document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

    // Sync theme toggle icon on load
    if (savedTheme === 'dark') {
      const sun  = document.getElementById('theme-icon-sun');
      const moon = document.getElementById('theme-icon-moon');
      if (sun)  sun.style.display  = 'none';
      if (moon) moon.style.display = '';
    }

    // Panel Run/Stop/Reset (inside right panel)
    document.getElementById('btn-run-panel').addEventListener('click', onRunClicked);
    document.getElementById('btn-stop-panel').addEventListener('click', () => { CodeRunner.stop(); showRunBtn(true); });
    document.getElementById('btn-reset-panel').addEventListener('click', onResetSim);

    // Speed control slider
    const speedSlider = document.getElementById('speed-slider');
    const speedLabel  = document.getElementById('speed-value');
    const SPEED_MAP   = [0.5, 1, 2, 4];
    if (speedSlider) {
      speedSlider.addEventListener('input', () => {
        const mult = SPEED_MAP[parseInt(speedSlider.value)];
        window._simSpeedMultiplier = mult;
        speedLabel.textContent = mult + 'x';
      });
    }

    // Step-through debugger
    const chkStep = document.getElementById('chk-step-mode');
    const btnStep = document.getElementById('btn-step');
    if (chkStep && btnStep) {
      chkStep.addEventListener('change', () => {
        CodeRunner.setStepMode(chkStep.checked);
        btnStep.style.display = chkStep.checked ? '' : 'none';
      });
      btnStep.addEventListener('click', () => CodeRunner.step());
    }

    // Lessons drawer (still available for Build tab / navbar button)
    document.getElementById('btn-lessons').addEventListener('click', openLessonsDrawer);
    document.getElementById('btn-close-lessons').addEventListener('click', closeLessonsDrawer);
    document.getElementById('lessons-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('lessons-modal')) closeLessonsDrawer();
    });

    // Lesson navigation (drawer)
    document.getElementById('btn-prev-lesson').addEventListener('click', () => navigateLesson(-1));
    document.getElementById('btn-next-lesson').addEventListener('click', () => navigateLesson(+1));
    document.getElementById('btn-complete-lesson').addEventListener('click', onCompleteLesson);

    // Hint toggle (drawer)
    const hintBox    = document.getElementById('hint-box');
    const hintToggle = document.getElementById('btn-hint-toggle');
    if (hintToggle) {
      hintToggle.addEventListener('click', () => {
        const hidden = hintBox.hidden;
        hintBox.hidden = !hidden;
        hintToggle.textContent = hidden ? '💡 Hide Hint' : '💡 Hint';
      });
    }

    // ── Inline lesson pane (Code tab left panel) ───────────────────────────
    // Tab switcher removed — both lesson and blocks panes are always visible.

    // Inline lesson navigation
    document.getElementById('btn-pane-prev').addEventListener('click', () => navigateLesson(-1));
    document.getElementById('btn-pane-next').addEventListener('click', () => navigateLesson(+1));
    document.getElementById('btn-pane-complete').addEventListener('click', onCompleteLesson);

    // Inline hint toggle
    const paneHintBox    = document.getElementById('lesson-pane-hint-box');
    const paneHintToggle = document.getElementById('btn-pane-hint');
    if (paneHintToggle && paneHintBox) {
      paneHintToggle.addEventListener('click', () => {
        const hidden = paneHintBox.hidden;
        paneHintBox.hidden = !hidden;
        paneHintToggle.textContent = hidden ? '💡 Hide Hint' : '💡 Hint';
      });
    }

    // Undo/Redo keyboard (works on both Build and Code tabs)
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        if (activeTab === 'build') { _BC.undo(); flashAutosave(); }
        else if (activeTab === 'code' && blocklyWorkspace) { blocklyWorkspace.undo(false); }
        e.preventDefault();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        if (activeTab === 'build') { _BC.redo(); flashAutosave(); }
        else if (activeTab === 'code' && blocklyWorkspace) { blocklyWorkspace.undo(true); }
        e.preventDefault();
      }
    });

    // Starter robot
    const btnStarter = document.getElementById('btn-starter-robot');
    if (btnStarter) {
      btnStarter.addEventListener('click', () => {
        if (confirm('Load the starter robot? This will clear the current build.')) {
          _BC.spawnStarterRobot();
          flashAutosave();
        }
      });
    }

    // Save/Load robot
    document.getElementById('btn-save-robot').addEventListener('click', () => {
      _BC.saveRobot('manual'); flashAutosave('Saved!');
    });
    document.getElementById('btn-load-robot').addEventListener('click', () => {
      const ok = _BC.loadRobot('manual'); flashAutosave(ok ? 'Loaded!' : 'No save found');
    });

    // Keyboard shortcuts overlay
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === '?') {
        document.getElementById('shortcuts-modal').classList.toggle('open');
      }
    });
    document.getElementById('btn-close-shortcuts').addEventListener('click', () => {
      document.getElementById('shortcuts-modal').classList.remove('open');
    });
    document.getElementById('shortcuts-modal').addEventListener('click', e => {
      if (e.target === document.getElementById('shortcuts-modal'))
        document.getElementById('shortcuts-modal').classList.remove('open');
    });

    // Goal reached callback
    SimEngine.setOnGoalReached(onGoalReached);
    SimEngine.setOnCollision(() => { robotLog('💥 Collision!', 'collision'); });

    // Robot log clear
    document.getElementById('btn-clear-log').addEventListener('click', () => {
      const log = document.getElementById('robot-log');
      if (log) log.innerHTML = '';
    });

    // Build sim thumb canvas (small field preview on build tab right panel)
    initBuildSimThumb();

    // Make a Block modal
    _initMakeBlockModal();

    // Render first lesson
    renderLesson(0);

    window._simStatus = '';
  });

  // ── Build sim thumb ────────────────────────────────────────────────────────
  // Shows a small read-only view of the sim arena in the build tab right panel

  function initBuildSimThumb() {
    const thumb = document.getElementById('build-sim-thumb');
    if (!thumb) return;
    drawSimThumb(thumb);
    // Animate the thumb at ~4fps so the goal zone pulses
    setInterval(() => {
      if (activeTab === 'build') drawSimThumb(thumb);
    }, 250);
  }

  function drawSimThumb(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    // Scale factors: arena dims from lesson or default 440×360, thumb is w×h
    const lesson0 = LESSONS[currentLessonIdx];
    const arenaW = (lesson0 && lesson0.arenaWidth)  || 440;
    const arenaH = (lesson0 && lesson0.arenaHeight) || 360;
    const sx = w / arenaW, sy = h / arenaH;

    // Checkerboard background
    const tc = window._themeColors || {};
    const tile = 20;
    for (let row = 0; row < Math.ceil(h / tile); row++) {
      for (let col = 0; col < Math.ceil(w / tile); col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? (tc.arenaBg || '#FFFFFF') : (tc.arenaTile || '#F3F4F6');
        ctx.fillRect(col * tile, row * tile, tile, tile);
      }
    }

    // Grid lines
    ctx.strokeStyle = tc.arenaGrid || 'rgba(0,0,0,0.04)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= w; x += tile) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y <= h; y += tile) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    // Current lesson data
    const lesson = LESSONS[currentLessonIdx];

    // Goal zone
    if (lesson && lesson.goalZone) {
      const gz = lesson.goalZone;
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 600);
      ctx.fillStyle = `rgba(16,185,129,${0.1 + pulse * 0.06})`;
      ctx.strokeStyle = `rgba(16,185,129,${0.5 + pulse * 0.3})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.fillRect(gz.x * sx, gz.y * sy, gz.width * sx, gz.height * sy);
      ctx.strokeRect(gz.x * sx, gz.y * sy, gz.width * sx, gz.height * sy);
      ctx.setLineDash([]);
      // Flag label
      ctx.font = `${Math.round(8 * Math.min(sx, sy))}px sans-serif`;
      ctx.fillStyle = 'rgba(16,185,129,0.8)';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('⚑', (gz.x + gz.width / 2) * sx, (gz.y + gz.height / 2) * sy);
    }

    // Obstacles
    if (lesson && lesson.obstacles) {
      lesson.obstacles.forEach(obs => {
        ctx.fillStyle = tc.obstacle || '#374151';
        ctx.fillRect(obs.x * sx, obs.y * sy, obs.width * sx, obs.height * sy);
        ctx.strokeStyle = tc.obstacleBord || '#1F2937';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(obs.x * sx, obs.y * sy, obs.width * sx, obs.height * sy);
      });
    }

    // Robot start position
    const sp = lesson && (lesson.startPosition || lesson.robotStart);
    const rx = sp ? sp.x * sx : w / 2;
    const ry = sp ? sp.y * sy : h / 2;
    const ra = sp ? ((sp.angleDeg || 0) * Math.PI / 180) : -Math.PI / 2;

    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(ra);
    ctx.fillStyle = '#3B82F6';
    const bw = 16 * sx, bh = 11 * sy;
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(-bw/2, -bh/2, bw, bh, 2); ctx.fill();
    } else {
      ctx.fillRect(-bw/2, -bh/2, bw, bh);
    }
    // Arrow
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(bw/2 + 3*sx, 0);
    ctx.lineTo(bw/2 - 1*sx, -3*sy);
    ctx.lineTo(bw/2 - 1*sx,  3*sy);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // Border
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  // ── Tab switching ──────────────────────────────────────────────────────────

  function switchTab(tab) {
    if (tab === activeTab) return;
    activeTab = tab;

    ['build', 'code'].forEach(name => {
      document.getElementById('view-' + name).classList.toggle('active', name === tab);
    });
    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tab === tab)
    );

    // Show/hide nav code actions
    const codeActions = document.getElementById('nav-code-actions');
    if (codeActions) codeActions.classList.toggle('visible', tab === 'code');

    if (tab === 'code') {
      if (!blocklyReady) initBlockly();
      else populateBlocksPanel();
      SimCanvas.setRobotConfig(robotConfig);
      loadLessonSim(currentLessonIdx);
      updateHardwarePanel(robotConfig);
    }
  }

  // ── Blockly ─────────────────────────────────────────────────────────────────

  function initBlockly() {
    registerBlocks();

    // Light theme for Blockly — Scratch-style white workspace
    _RoboLight = Blockly.Theme.defineTheme('robolight', {
      base: Blockly.Themes.Classic,
      componentStyles: {
        workspaceBackgroundColour: '#F9F9F9',
        toolboxBackgroundColour:   '#FFFFFF',
        toolboxForegroundColour:   '#575E75',
        flyoutBackgroundColour:    '#F9F9F9',
        flyoutForegroundColour:    '#575E75',
        flyoutOpacity:             1,
        scrollbarColour:           '#CECDCE',
        insertionMarkerColour:     '#4C97FF',
        insertionMarkerOpacity:    0.5,
        scrollbarOpacity:          0.8,
        cursorColour:              '#4C97FF'
      }
    });
    // Dark theme for Blockly
    _RoboDark = Blockly.Theme.defineTheme('robodark', {
      base: Blockly.Themes.Classic,
      componentStyles: {
        workspaceBackgroundColour: '#1A1D27',
        toolboxBackgroundColour:   '#1E2130',
        toolboxForegroundColour:   '#E5E7EB',
        flyoutBackgroundColour:    '#1E2130',
        flyoutForegroundColour:    '#E5E7EB',
        flyoutOpacity:             1,
        scrollbarColour:           '#2D3148',
        insertionMarkerColour:     '#4C97FF',
        insertionMarkerOpacity:    0.6,
        scrollbarOpacity:          0.8,
        cursorColour:              '#4C97FF'
      }
    });

    Blockly.JavaScript.STATEMENT_PREFIX = 'await robot.highlightBlock(%1);\n';
    Blockly.JavaScript.addReservedWords('robot');

    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    blocklyWorkspace = Blockly.inject('blockly-panel', {
      toolbox:    getToolbox(),
      scrollbars: true,
      trashcan:   true,
      renderer:   'zelos',
      zoom:       { controls: true, wheel: true, startScale: 0.9, maxScale: 2.5, minScale: 0.4 },
      grid:       { spacing: 20, length: 3, colour: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)', snap: true },
      theme:      isDark ? _RoboDark : _RoboLight
    });

    blocklyWorkspace.addChangeListener(() => {
      const xml = Blockly.Xml.domToText(Blockly.Xml.workspaceToDom(blocklyWorkspace));
      localStorage.setItem('robobuilder_blocks', xml);
    });

    // Refresh Functions panel when func_define blocks are added, removed,
    // renamed, or have parameters added/removed (mutation change).
    let _procRefreshTimer = null;
    blocklyWorkspace.addChangeListener(e => {
      const isCreate  = e.type === Blockly.Events.BLOCK_CREATE;
      const isDelete  = e.type === Blockly.Events.BLOCK_DELETE;
      const isChange  = e.type === Blockly.Events.BLOCK_CHANGE;
      const isMutation = isChange && e.element === 'mutation';
      const isNameField = isChange && e.element === 'field' &&
                          (e.name === 'FUNC_NAME' || e.name === 'NAME');
      if (isCreate || isDelete || isMutation || isNameField) {
        clearTimeout(_procRefreshTimer);
        _procRefreshTimer = setTimeout(populateBlocksPanel, 150);
      }
    });

    // Restore or place starter block
    let restoredFromSave = false;
    try {
      const saved = localStorage.getItem('robobuilder_blocks');
      if (saved) {
        Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(saved), blocklyWorkspace);
        restoredFromSave = true;
      }
    } catch (e) { /* ignore */ }

    if (!restoredFromSave || blocklyWorkspace.getAllBlocks(false).length === 0) {
      placeStarterBlock();
    }

    window._blocklyWorkspace = blocklyWorkspace;
    blocklyReady = true;

    // ── Block-delete-on-drop: drag a block back into the Blocks panel to delete it ──
    // Track pointer position using capture phase so we intercept before Blockly's SVG
    // handlers can stop propagation. Use both mousemove and pointermove for coverage.
    let _lastPointerX = 0, _lastPointerY = 0;
    const _trackPointer = e => { _lastPointerX = e.clientX; _lastPointerY = e.clientY; };
    document.addEventListener('mousemove',   _trackPointer, { capture: true, passive: true });
    document.addEventListener('pointermove', _trackPointer, { capture: true, passive: true });

    blocklyWorkspace.addChangeListener(e => {
      // Blockly.Events.BLOCK_DRAG fires with isStart=false when a drag ends.
      if (e.type !== Blockly.Events.BLOCK_DRAG) return;
      if (e.isStart) return; // only care about drag-end

      const blocksPaneEl = document.getElementById('blocks-pane');
      if (!blocksPaneEl) return;

      const rect = blocksPaneEl.getBoundingClientRect();
      const overPanel = (
        _lastPointerX >= rect.left && _lastPointerX <= rect.right &&
        _lastPointerY >= rect.top  && _lastPointerY <= rect.bottom
      );

      if (overPanel) {
        // Find the block that was just dragged — it's the top-level block at e.blockId
        const block = blocklyWorkspace.getBlockById(e.blockId);
        if (block) {
          // Dispose with heal=false so connected children come with it
          block.dispose(false);
          robotLog('🗑 Block removed', 'info');
        }
      }
    });

    // Visual drop-zone feedback while dragging over blocks panel
    const blocksPaneEl = document.getElementById('blocks-pane');
    if (blocksPaneEl) {
      blocklyWorkspace.addChangeListener(e => {
        if (e.type !== Blockly.Events.BLOCK_DRAG) return;
        if (e.isStart) {
          // Highlight blocks pane as a drop zone
          blocksPaneEl.classList.add('blocks-pane-dropzone');
        } else {
          blocksPaneEl.classList.remove('blocks-pane-dropzone');
        }
      });
    }

    // Populate custom blocks panel now that Blockly is ready
    populateBlocksPanel();

    // JS preview toggle
    const previewToggle = document.getElementById('btn-toggle-preview');
    const previewPre    = document.getElementById('code-preview');
    let previewOpen     = false;
    if (previewToggle && previewPre) {
      previewToggle.addEventListener('click', () => {
        previewOpen = !previewOpen;
        previewPre.hidden = !previewOpen;
        previewToggle.innerHTML = previewOpen
          ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Hide JS'
          : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg> Show JS';
        if (previewOpen) previewPre.textContent = extractCode(blocklyWorkspace) || '// No blocks yet';
      });
      blocklyWorkspace.addChangeListener(() => {
        if (previewOpen) previewPre.textContent = extractCode(blocklyWorkspace) || '// No blocks yet';
      });
    }
  }

  function placeStarterBlock() {
    const startBlock = blocklyWorkspace.newBlock('when_program_starts');
    startBlock.initSvg();
    startBlock.render();
    startBlock.moveBy(80, 60);
  }

  // ── Custom blocks panel ─────────────────────────────────────────────────────

  const BLOCK_CATEGORIES = [
    {
      name: 'Start',
      cssClass: 'bc-start',
      blocks: [
        { label: '▶ When Program Starts', xml: '<block type="when_program_starts"></block>' }
      ]
    },
    {
      name: 'Motors',
      cssClass: 'bc-motor',
      blocks: [
        { label: 'Spin Motor',      requiresMotor: true, xml: '<block type="motor_spin"><value name="SPEED"><shadow type="math_number"><field name="NUM">5</field></shadow></value></block>' },
        { label: 'Spin Motor for',  requiresMotor: true, xml: '<block type="motor_spin_for"><value name="SPEED"><shadow type="math_number"><field name="NUM">5</field></shadow></value><value name="DURATION"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>' },
        { label: 'Stop Motor',      requiresMotor: true, xml: '<block type="motor_stop"></block>' },
        { label: 'Set Motor Speed', requiresMotor: true, xml: '<block type="motor_set_speed"><value name="SPEED"><shadow type="math_number"><field name="NUM">5</field></shadow></value></block>' },
      ]
    },
    {
      name: 'Control',
      cssClass: 'bc-control',
      blocks: [
        { label: 'Repeat N Times', xml: '<block type="controls_repeat_ext"><value name="TIMES"><shadow type="math_number"><field name="NUM">4</field></shadow></value></block>' },
        { label: 'Wait N Seconds', xml: '<block type="wait_seconds"><value name="SECS"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>' },
        { label: 'Forever Loop', xml: '<block type="forever_loop"></block>' },
        { label: 'While Loop', xml: '<block type="while_loop"></block>' },
        { label: 'If... Then...', xml: '<block type="controls_if"></block>' },
        { label: 'Stop All', xml: '<block type="stop_all"></block>' },
      ]
    },
    {
      name: 'Sensing',
      cssClass: 'bc-sense',
      blocks: [
        { label: 'Distance Ahead', requiresSensor: true, xml: '<block type="get_distance"></block>' },
        { label: 'Path Clear?', requiresSensor: true, xml: '<block type="is_path_clear"><value name="THRESHOLD"><shadow type="math_number"><field name="NUM">40</field></shadow></value></block>' },
        { label: 'Touching Wall?', xml: '<block type="touching_wall"></block>' },
        { label: 'Robot Direction (°)', xml: '<block type="robot_angle"></block>' },
        { label: 'Robot X', xml: '<block type="robot_x"></block>' },
        { label: 'Robot Y', xml: '<block type="robot_y"></block>' },
        { label: 'Timer (sec)', xml: '<block type="get_timer"></block>' },
      ]
    },
    {
      name: 'Output',
      cssClass: 'bc-output',
      blocks: [
        { label: 'Say...', xml: '<block type="say_message"><value name="MSG"><shadow type="text"><field name="TEXT">Hello!</field></shadow></value></block>' },
        { label: 'Set LED Color', xml: '<block type="set_led"></block>' },
        { label: 'Play Beep', xml: '<block type="play_beep"><value name="FREQ"><shadow type="math_number"><field name="NUM">440</field></shadow></value><value name="DUR"><shadow type="math_number"><field name="NUM">0.2</field></shadow></value></block>' },
      ]
    },
    {
      name: 'Operators',
      cssClass: 'bc-logic',
      blocks: [
        { label: '+ Add / − Sub / × Mul', xml: '<block type="math_arithmetic" fields=\'{"OP":"ADD"}\'></block>' },
        { label: 'Number', xml: '<block type="math_number"><field name="NUM">0</field></block>' },
        { label: 'Compare (=, >, <)', xml: '<block type="logic_compare" fields=\'{"OP":"EQ"}\'></block>' },
        { label: 'And / Or', xml: '<block type="logic_operation" fields=\'{"OP":"AND"}\'></block>' },
        { label: 'Not', xml: '<block type="logic_negate"></block>' },
        { label: 'Random Number', xml: '<block type="math_random_int"><value name="FROM"><shadow type="math_number"><field name="NUM">1</field></shadow></value><value name="TO"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block>' },
      ]
    },
    {
      name: 'Functions',
      cssClass: 'bc-func',
      isProc: true,
      blocks: []  // populated dynamically from workspace procedure definitions
    },
  ];

  function populateBlocksPanel() {
    const container = document.getElementById('blocks-list');
    if (!container) return;
    container.innerHTML = '';

    const parts    = (robotConfig && robotConfig.parts) || [];
    const hasMotor  = parts.some(p => p.type === 'motor');
    const hasSensor = parts.some(p => p.type === 'distance-sensor');
    const motorCount  = parts.filter(p => p.type === 'motor').length;
    const sensorCount = parts.filter(p => p.type === 'distance-sensor').length;

    // Robot status strip
    const strip = document.createElement('div');
    if (parts.length === 0) {
      strip.className = 'blocks-robot-strip strip-warn';
      strip.innerHTML = '⚠ No robot — go to Build tab first';
    } else {
      strip.className = 'blocks-robot-strip strip-ok';
      const motorLabel  = motorCount  ? `${motorCount} motor${motorCount > 1 ? 's' : ''}` : '';
      const sensorLabel = sensorCount ? `${sensorCount} sensor` : '';
      const labels = [motorLabel, sensorLabel].filter(Boolean).join(', ');
      strip.innerHTML = `✓ Robot ready · ${labels || 'no motors/sensors'}`;
    }
    container.appendChild(strip);

    BLOCK_CATEGORIES.forEach(cat => {
      const catEl = document.createElement('div');
      catEl.className = 'block-category';

      const hdr = document.createElement('div');
      hdr.className = 'bc-header';
      hdr.textContent = cat.name;
      catEl.appendChild(hdr);

      const items = document.createElement('div');
      items.className = 'bc-items';

      if (cat.isProc) {
        // "Define Function" card — opens the Make a Block modal
        const defineCard = document.createElement('div');
        defineCard.className = `block-card ${cat.cssClass}`;
        defineCard.textContent = '➕ Define Function';
        defineCard.title = 'Open the Make a Block dialog to create a function.';
        defineCard.addEventListener('click', openMakeBlockModal);
        items.appendChild(defineCard);

        // Call cards — one per func_define block currently in the workspace
        if (blocklyWorkspace) {
          blocklyWorkspace.getBlocksByType('func_define', false).forEach(defBlock => {
            const name   = (defBlock.getFieldValue('FUNC_NAME') || 'myFunction').trim();
            const params = defBlock.getParamNames ? defBlock.getParamNames() : [];
            const callCard = document.createElement('div');
            callCard.className = `block-card ${cat.cssClass}`;
            callCard.textContent = params.length ? `▷ ${name} (${params.join(', ')})` : `▷ ${name}`;
            callCard.title = `Call function: ${name}`;
            callCard.addEventListener('click', () => {
              const esc    = s => String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
              const argXml = params.map(p => `<arg name="${esc(p)}"/>`).join('');
              // Include a <shadow type="math_number"> for each arg slot so
              // the user sees a typeable number box by default but can snap
              // in any value block (variable, expression, etc.) instead.
              const valueXml = params.map((_, j) =>
                `<value name="ARG_${j}">` +
                  `<shadow type="text"><field name="TEXT"></field></shadow>` +
                `</value>`
              ).join('');
              addBlockFromXml(
                `<block type="func_call">` +
                `<field name="FUNC_NAME">${esc(name)}</field>` +
                `<mutation>${argXml}</mutation>` +
                valueXml +
                `</block>`
              );
            });
            items.appendChild(callCard);
          });
        }
      } else {
        cat.blocks.forEach(block => {
          const needsMotor  = block.requiresMotor  && !hasMotor;
          const needsSensor = block.requiresSensor && !hasSensor;
          const locked = needsMotor || needsSensor;

          const card = document.createElement('div');
          card.className = `block-card ${cat.cssClass}${locked ? ' bc-locked' : ''}`;
          card.textContent = block.label;
          card.title = locked
            ? (needsMotor ? 'Add a motor in Build tab to use this block' : 'Add a distance sensor in Build tab to use this block')
            : 'Click to add to workspace';

          if (!locked) {
            card.addEventListener('click', () => addBlockFromXml(block.xml));
          }
          items.appendChild(card);
        });
      }

      catEl.appendChild(items);
      container.appendChild(catEl);
    });
  }

  function addBlockFromXml(xml) {
    if (!blocklyWorkspace) return;
    try {
      const fullXml = `<xml xmlns="https://developers.google.com/blockly/xml">${xml}</xml>`;
      const dom = Blockly.Xml.textToDom(fullXml);

      // Snapshot existing block IDs before adding
      const beforeIds = new Set(blocklyWorkspace.getAllBlocks(false).map(b => b.id));

      Blockly.Xml.domToWorkspace(dom, blocklyWorkspace);

      // Find the newly added top-level block
      const newBlock = blocklyWorkspace.getAllBlocks(false)
        .find(b => !beforeIds.has(b.id) && !b.getParent());

      if (newBlock) {
        const metrics  = blocklyWorkspace.getMetrics();
        // metrics.viewLeft/Top are in workspace coordinates; place block in the visible area
        const targetX = metrics.viewLeft + metrics.viewWidth  * 0.35;
        const targetY = metrics.viewTop  + metrics.viewHeight * 0.25;
        const jx = (Math.random() - 0.5) * 100;
        const jy = (Math.random() - 0.5) * 80;
        // moveBy is relative to current position, so offset from block's current workspace pos
        const curXY = newBlock.getRelativeToSurfaceXY();
        newBlock.moveBy(targetX - curXY.x + jx, targetY - curXY.y + jy);
      }
    } catch (e) {
      console.warn('[Blocks] Failed to add block:', e);
    }
  }

  // ── Hardware panel ─────────────────────────────────────────────────────────

  function updateHardwarePanel(config) {
    const list = document.getElementById('hardware-list');
    if (!list) return;

    const parts = (config && config.parts) || [];
    if (parts.length === 0) {
      list.innerHTML = '<div class="hw-item" style="color:var(--text-3);font-size:0.72rem;padding:12px 0">Add parts in Build tab to see them here.</div>';
      return;
    }

    let motorIdx = 0;
    const fallbackNames = 'ABCDEFGH';
    let items = '';

    parts.forEach((p, i) => {
      if (p.type === 'motor') {
        const customName = p.props?.motorName?.trim();
        const dispName = customName || ('Motor ' + (fallbackNames[motorIdx] || String(motorIdx)));
        const nameVal  = customName || '';
        const reversed = p.props?.reversed ? true : false;
        items += `<div class="hw-motor-card" data-part-id="${p.id}" data-motor-idx="${motorIdx}">
          <div class="hw-motor-header">
            <div class="hw-dot hw-dot-motor"></div>
            <span class="hw-motor-label">${dispName}</span>
          </div>
          <div class="hw-motor-fields">
            <label class="hw-field-label">Name</label>
            <input type="text" class="hw-motor-name" value="${(nameVal).replace(/"/g, '&quot;')}"
              placeholder="${fallbackNames[motorIdx] || 'Motor'}" maxlength="20" data-part-id="${p.id}">
            <label class="hw-field-label hw-reverse-label">
              <span>Reversed</span>
              <button class="hw-toggle ${reversed ? 'hw-toggle-on' : ''}" data-part-id="${p.id}" data-field="reversed">
                <span class="hw-toggle-knob"></span>
              </button>
            </label>
          </div>
        </div>`;
        motorIdx++;
      } else if (p.type === 'distance-sensor') {
        items += `<div class="hw-item"><div class="hw-dot hw-dot-sensor"></div><span class="hw-name">Distance Sensor</span></div>`;
      } else if (p.type === 'battery') {
        items += `<div class="hw-item"><div class="hw-dot hw-dot-battery"></div><span class="hw-name">Battery</span></div>`;
      } else if (p.type === 'brain') {
        items += `<div class="hw-item"><div class="hw-dot hw-dot-brain"></div><span class="hw-name">Brain</span></div>`;
      }
    });

    list.innerHTML = items || '<div class="hw-item" style="color:var(--text-3);font-size:0.72rem">No motors or sensors found.</div>';
    _wireHardwarePanelEvents(list);
  }

  function _wireHardwarePanelEvents(list) {
    // Motor name inputs
    list.querySelectorAll('.hw-motor-name').forEach(input => {
      input.addEventListener('input', () => {
        const partId = Number(input.dataset.partId);
        _setMotorPartProp(partId, 'motorName', input.value);
      });
      // Re-render header label on blur so the display name stays current
      input.addEventListener('blur', () => {
        const card = input.closest('.hw-motor-card');
        if (!card) return;
        const label = card.querySelector('.hw-motor-label');
        const idx = card.dataset.motorIdx;
        const fallback = 'ABCDEFGH';
        if (label) label.textContent = input.value.trim() || ('Motor ' + (fallback[idx] || idx));
      });
    });

    // Reverse toggles
    list.querySelectorAll('.hw-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const partId = Number(btn.dataset.partId);
        const isOn = btn.classList.toggle('hw-toggle-on');
        _setMotorPartProp(partId, 'reversed', isOn);
      });
    });
  }

  function _setMotorPartProp(partId, key, value) {
    // Update the live build part via BuildCanvas3D/BuildCanvas
    const allParts = _BC.getPlacedParts ? _BC.getPlacedParts() : [];
    const part = allParts.find(p => p.id === partId);
    if (part) {
      if (!part.props) part.props = {};
      part.props[key] = value;
    }
    // Use light-weight config update to avoid rebuilding the panel mid-typing
    if (_BC.notifyConfigOnly) _BC.notifyConfigOnly();
    else _BC.notifyPropChanged();
  }

  // ── Wire tool toggle ───────────────────────────────────────────────────────

  let _wireActive = false;

  function toggleWireTool() {
    _wireActive = !_wireActive;
    setWireTool(_wireActive);
  }

  function setWireTool(active) {
    _wireActive = active;
    _BC.setActiveTool(active ? 'wire' : 'select');

    // Sync toolbar buttons
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === (active ? 'wire' : 'select'));
    });

    // Sync parts panel wire button
    const partsWireBtn = document.getElementById('parts-wire-btn');
    if (partsWireBtn) partsWireBtn.classList.toggle('active', active);
  }

  // ── Parts panel ────────────────────────────────────────────────────────────

  function _updatePartsPanelLimits() {
    const list = document.getElementById('parts-list');
    if (!list) return;
    const placed = _BC.getPlacedParts ? _BC.getPlacedParts() : [];
    const hasBrain   = placed.some(p => p.type === 'brain');
    const hasBattery = placed.some(p => p.type === 'battery');
    list.querySelectorAll('.part-item').forEach(item => {
      const t = item.dataset.partType;
      const disabled = (t === 'brain' && hasBrain) || (t === 'battery' && hasBattery);
      item.classList.toggle('part-item-disabled', disabled);
    });
  }

  function populatePartsPanel() {
    const list = document.getElementById('parts-list');
    list.innerHTML = '';

    // Filter to "wirable" parts: motor, brain, battery, distance-sensor
    // (c-channel and wheel are drag-only, no wire)
    const wiredParts = PARTS.filter(def =>
      ['motor', 'brain', 'battery', 'distance-sensor'].includes(def.type)
    );

    // Draggable icon row + "+ Add" button for key parts
    PARTS.forEach(def => {
      const item = document.createElement('div');
      item.className = 'part-item';

      // 3D thumbnail (NB-6) or fallback 2D canvas icon
      let iconEl;
      const has3D = typeof BuildCanvas3D !== 'undefined' && BuildCanvas3D && BuildCanvas3D.renderPartThumbnail;
      if (has3D) {
        const dataURL = BuildCanvas3D.renderPartThumbnail(def.type, 72, 56);
        if (dataURL) {
          iconEl = document.createElement('img');
          iconEl.src = dataURL;
          iconEl.className = 'part-icon';
          iconEl.style.cssText = 'width:36px;height:28px;object-fit:contain';
        }
      }
      if (!iconEl) {
        iconEl = document.createElement('canvas');
        iconEl.className = 'part-icon';
        iconEl.width = 36;
        iconEl.height = 28;
        const ictx = iconEl.getContext('2d');
        const scale = Math.min(36 / def.width, 28 / def.height) * 0.85;
        const ox = (36 - def.width * scale) / 2;
        const oy = (28 - def.height * scale) / 2;
        ictx.fillStyle = def.color;
        ictx.beginPath();
        if (ictx.roundRect) {
          ictx.roundRect(ox, oy, def.width * scale, def.height * scale, 3);
        } else {
          ictx.rect(ox, oy, def.width * scale, def.height * scale);
        }
        ictx.fill();
      }

      const info = document.createElement('div');
      info.innerHTML = `<div class="part-label">${def.label}</div><div class="part-desc">${def.metadata.description}</div>`;

      item.appendChild(iconEl);
      item.appendChild(info);
      item.dataset.partType = def.type;

      item.addEventListener('mousedown', e => {
        e.preventDefault();
        if (item.classList.contains('part-item-disabled')) return;
        _BC.startNewPartDrag(def.type, e.clientX, e.clientY);
      });

      list.appendChild(item);
    });

    _updatePartsPanelLimits();

    // Wire tool button at bottom of list
    const wireSep = document.createElement('div');
    wireSep.style.cssText = 'border-top:1px solid var(--border);margin:6px 0;padding-top:6px;';
    const wireBtn = document.createElement('button');
    wireBtn.className = 'wire-tool-btn';
    wireBtn.id = 'parts-wire-btn';
    wireBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:4px"><path d="M5 12h6m8 0h-4M9 12a3 3 0 103-3 3 3 0 00-3 3zm8 0a3 3 0 103 3 3 3 0 00-3-3"/></svg>
      Wire Tool`;
    wireBtn.addEventListener('click', () => {
      toggleWireTool();
    });
    wireSep.appendChild(wireBtn);
    list.appendChild(wireSep);
  }

  // ── Build toolbar ──────────────────────────────────────────────────────────

  function wireToolbar() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _BC.setActiveTool(btn.dataset.tool);
        _wireActive = btn.dataset.tool === 'wire';
        // Sync parts panel wire button
        const partsWireBtn = document.getElementById('parts-wire-btn');
        if (partsWireBtn) partsWireBtn.classList.toggle('active', _wireActive);
      });
    });

    // W key toggles wire tool
    document.addEventListener('keydown', e => {
      if (activeTab !== 'build') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'w' || e.key === 'W') {
        toggleWireTool();
        e.preventDefault();
      }
    });

    document.getElementById('btn-reset-build').addEventListener('click', () => {
      if (confirm('Clear all parts from the canvas?')) { _BC.resetCanvas(); flashAutosave('Cleared'); }
    });
    document.getElementById('btn-undo').addEventListener('click', () => { _BC.undo(); flashAutosave(); });
    document.getElementById('btn-redo').addEventListener('click', () => { _BC.redo(); flashAutosave(); });
    document.getElementById('resetCameraBtn').addEventListener('click', () => {
      if (_BC.resetCamera) _BC.resetCamera();
    });
  }

  // ── Robot config data-flow ─────────────────────────────────────────────────

  let _prevPartTypes = [];
  function _checkPartChangeFeedback(newParts) {
    const newTypes = newParts.map(p => p.type);
    const count = (arr, t) => arr.filter(x => x === t).length;
    const hints = document.getElementById('build-hint');
    const show = (msg) => { if (hints) { hints.textContent = msg; clearTimeout(hints._ft); hints._ft = setTimeout(() => { hints.textContent = 'Drag parts onto the canvas · R = rotate · W = wire tool · Right-click drag = orbit view'; }, 3000); } };
    if (count(newTypes, 'motor') > count(_prevPartTypes, 'motor')) show('Motor added — robot can now move!');
    else if (count(newTypes, 'motor') < count(_prevPartTypes, 'motor')) show('Motor removed — robot cannot move');
    else if (count(newTypes, 'battery') > count(_prevPartTypes, 'battery')) show('Battery added — powers the robot');
    else if (count(newTypes, 'battery') < count(_prevPartTypes, 'battery')) show('Battery removed — robot has no power');
    else if (count(newTypes, 'distance-sensor') > count(_prevPartTypes, 'distance-sensor')) show('Sensor added — robot can detect obstacles');
    _prevPartTypes = newTypes;
  }

  function onRobotConfigChanged(config) {
    robotConfig = config || { parts: [] };
    _checkPartChangeFeedback(robotConfig.parts);
    SimCanvas.setRobotConfig(robotConfig);

    // Update sensor range
    const sensorPart = robotConfig.parts.find(p => p.type === 'distance-sensor');
    if (sensorPart && sensorPart.props && sensorPart.props.range) {
      SensorSystem.setMaxRange(sensorPart.props.range);
    }

    // Parts indicator in sim header
    const indicator = document.getElementById('parts-indicator');
    if (indicator) {
      const types = robotConfig.parts.map(p => p.type);
      const icons = [
        ['motor', '⚙', 'Motor'],
        ['battery', '⚡', 'Battery'],
        ['distance-sensor', '📡', 'Sensor']
      ];
      indicator.innerHTML = icons.map(([t, icon, label]) =>
        `<span class="part-badge ${types.includes(t) ? 'part-badge-on' : 'part-badge-off'}" title="${label}">${icon}</span>`
      ).join('');
    }

    // Parts count badge
    const countEl = document.getElementById('parts-count');
    if (countEl) countEl.textContent = robotConfig.parts.length + ' placed';

    SimCanvas.redraw();
    flashAutosave();
    updateDiagnosticsPanel(validateRobot(robotConfig));
    _updatePartsPanelLimits();

    // ── Compute motor config for tank drive ──────────────────────
    _updateMotorConfig(robotConfig);

    // Update build sim thumb
    drawSimThumb(document.getElementById('build-sim-thumb'));

    // Update hardware panel and blocks panel if on code tab
    if (activeTab === 'code') {
      // Skip hardware panel rebuild if user is typing in it (avoids losing focus)
      const hwFocused = document.activeElement && document.activeElement.closest('#hardware-list');
      if (!hwFocused) updateHardwarePanel(robotConfig);
      if (blocklyReady) populateBlocksPanel();
    }
  }

  function _updateMotorConfig(config) {
    const parts = config.parts || [];
    const conns = config.connections || [];
    const motors = parts.filter(p => p.type === 'motor');
    if (motors.length === 0) {
      window._robotMotorConfig = null;
      SimEngine.setMotorConfig(null);
      return;
    }

    // offsetX must use canvas Y, not X.
    // The sim renders the build canvas at -90°, so canvas Y = left-right in sim.
    let motorsCenterY = 0;
    motors.forEach(m => {
      const def = typeof getPartDef === 'function' ? getPartDef(m.type) : null;
      const ph = def ? def.height : 40;
      motorsCenterY += m.position.y + ph / 2;
    });
    motorsCenterY /= motors.length;

    // Check which motors are wired to brain
    const brainPart = parts.find(p => p.type === 'brain');
    const wiredMotorIds = new Set();
    if (brainPart) {
      conns.forEach(c => {
        const fromPart = parts.find(p => p.id === (c.from ?? c.fromId));
        const toPart   = parts.find(p => p.id === (c.to ?? c.toId));
        if (fromPart && toPart) {
          if (fromPart.type === 'brain' && toPart.type === 'motor') wiredMotorIds.add(toPart.id);
          if (toPart.type === 'brain' && fromPart.type === 'motor') wiredMotorIds.add(fromPart.id);
        }
      });
    }

    // Position-based motor config: each motor gets offsetX (lateral offset
    // from motor-assembly center). Physics emerges from position × speed.
    const fallbackNames = 'ABCDEFGH';
    const motorConfigs = motors.map((m, i) => {
      const def = typeof getPartDef === 'function' ? getPartDef(m.type) : null;
      const ph = def ? def.height : 40;
      const motorCenterY = m.position.y + ph / 2;

      const customName = m.props?.motorName?.trim();
      const name  = fallbackNames[i] || String(i);
      const label = customName || ('Motor ' + name);
      return {
        name,
        label,
        offsetX: motorCenterY - motorsCenterY,
        reversed: !!m.props?.reversed,
        wired: wiredMotorIds.has(m.id),
        partId: m.id
      };
    });

    const motorConfig = { motors: motorConfigs };
    window._robotMotorConfig = motorConfig;
    SimEngine.setMotorConfig(motorConfig);
  }

  function flashAutosave(text) {
    const el = document.getElementById('autosave-indicator');
    if (!el) return;
    el.textContent = text || 'Saved';
    el.classList.add('autosave-flash');
    clearTimeout(el._flashTimer);
    el._flashTimer = setTimeout(() => {
      el.classList.remove('autosave-flash');
      el.textContent = 'Saved';
    }, 1500);
  }

  // ── Make a Block modal ────────────────────────────────────────────────────

  // Each item: { type: 'name'|'input'|'bool'|'label', value: string, id: string }
  let _mbbItems = [];

  function _mbbId() {
    return 'mbb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function openMakeBlockModal() {
    _mbbItems = [{ type: 'name', value: 'myFunction', id: _mbbId() }];
    _renderMakeBlock();
    document.getElementById('make-block-overlay').hidden = false;
    // Focus the name input
    setTimeout(() => {
      const inp = document.querySelector('.mbb-name-input');
      if (inp) { inp.focus(); inp.select(); }
    }, 50);
  }

  function closeMakeBlockModal() {
    document.getElementById('make-block-overlay').hidden = true;
  }

  function _mbbAddItem(type) {
    const count = _mbbItems.filter(i => i.type !== 'name').length + 1;
    _mbbItems.push({ type, value: type === 'label' ? 'label' : ('param' + count), id: _mbbId() });
    _renderMakeBlock();
  }

  function _mbbRemoveItem(id) {
    _mbbItems = _mbbItems.filter(i => i.id !== id);
    _renderMakeBlock();
  }

  function _renderMakeBlock() {
    const preview = document.getElementById('make-block-preview');
    preview.innerHTML = '';

    _mbbItems.forEach(item => {
      if (item.type === 'name') {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'mbb-name-input';
        inp.value = item.value;
        inp.placeholder = 'block name';
        inp.addEventListener('input', e => { item.value = e.target.value; });
        preview.appendChild(inp);

      } else if (item.type === 'input' || item.type === 'bool') {
        const wrap = document.createElement('div');
        wrap.className = 'mbb-param-wrap';

        const trash = document.createElement('button');
        trash.className = 'mbb-param-trash';
        trash.textContent = '🗑';
        trash.title = 'Remove';
        trash.addEventListener('click', () => _mbbRemoveItem(item.id));

        const oval = document.createElement('div');
        oval.className = item.type === 'bool' ? 'mbb-diamond' : 'mbb-oval';

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'mbb-param-input';
        inp.value = item.value;
        inp.placeholder = 'name';
        inp.addEventListener('input', e => { item.value = e.target.value; });
        // auto-size
        inp.style.width = Math.max(48, inp.value.length * 9) + 'px';
        inp.addEventListener('input', () => {
          inp.style.width = Math.max(48, inp.value.length * 9) + 'px';
        });

        oval.appendChild(inp);
        wrap.appendChild(trash);
        wrap.appendChild(oval);
        preview.appendChild(wrap);

      } else if (item.type === 'label') {
        const wrap = document.createElement('div');
        wrap.className = 'mbb-param-wrap';

        const trash = document.createElement('button');
        trash.className = 'mbb-param-trash';
        trash.textContent = '🗑';
        trash.title = 'Remove';
        trash.addEventListener('click', () => _mbbRemoveItem(item.id));

        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'mbb-label-input';
        inp.value = item.value;
        inp.placeholder = 'label text';
        inp.addEventListener('input', e => { item.value = e.target.value; });

        wrap.appendChild(trash);
        wrap.appendChild(inp);
        preview.appendChild(wrap);
      }
    });
  }

  function _confirmMakeBlock() {
    const nameItem  = _mbbItems.find(i => i.type === 'name');
    const funcName  = (nameItem ? nameItem.value : 'myFunction').trim() || 'myFunction';
    const paramItems = _mbbItems.filter(i => i.type === 'input' || i.type === 'bool');
    const params     = paramItems.map(i => (i.value || '').trim() || 'param');

    const esc   = s => String(s).replace(/&/g,'&amp;').replace(/'/g,'&apos;').replace(/"/g,'&quot;');
    const ids   = params.map(() => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
    const xml =
      `<block type="func_define">` +
      `<field name="FUNC_NAME">${esc(funcName)}</field>` +
      `<mutation paramids='${esc(JSON.stringify(ids))}' params='${esc(JSON.stringify(params))}'></mutation>` +
      `</block>`;
    addBlockFromXml(xml);
    closeMakeBlockModal();
  }

  function _initMakeBlockModal() {
    document.getElementById('make-block-close') .addEventListener('click', closeMakeBlockModal);
    document.getElementById('make-block-cancel').addEventListener('click', closeMakeBlockModal);
    document.getElementById('make-block-ok')    .addEventListener('click', _confirmMakeBlock);
    document.getElementById('make-block-overlay').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeMakeBlockModal();
    });
    document.querySelectorAll('.mbo-btn').forEach(btn => {
      btn.addEventListener('click', () => _mbbAddItem(btn.dataset.type));
    });
  }

  // ── Lessons drawer ─────────────────────────────────────────────────────────

  function openLessonsDrawer() {
    document.getElementById('lessons-modal').classList.add('open');
  }
  function closeLessonsDrawer() {
    document.getElementById('lessons-modal').classList.remove('open');
  }

  // ── Lesson system ──────────────────────────────────────────────────────────

  function renderLesson(idx) {
    const lesson = LESSONS[idx];
    if (!lesson) return;
    currentLessonIdx = idx;

    const done = completedLessons.has(lesson.id);
    const bestStars = lessonStars[lesson.id] || 0;
    const starsHtml = bestStars > 0
      ? ` <span class="lesson-stars" title="${bestStars}/3 stars">${starString(bestStars)}</span>`
      : (lesson.starCriteria ? ` <span class="lesson-stars lesson-stars-empty" title="Complete to earn stars">☆☆☆</span>` : '');
    const content = document.getElementById('lesson-content');

    content.innerHTML = `
      <div class="lesson-header">
        <span class="lesson-num-badge">Lesson ${lesson.id}</span>
        <h2 class="lesson-title">${lesson.title}${done ? ' <span class="lesson-done-badge">✓ Done</span>' : ''}${starsHtml}</h2>
        <p class="lesson-objective">${lesson.objective}</p>
      </div>
      <div class="lesson-body">${lesson.content}</div>
    `;

    const hintBox = document.getElementById('hint-box');
    const hintToggle = document.getElementById('btn-hint-toggle');
    if (hintBox) {
      hintBox.innerHTML = `
        <div class="hint-content">
          <strong>💡 Hint:</strong> ${lesson.hint}
          ${lesson.commonMistakes && lesson.commonMistakes.length ? `
            <ul class="hint-mistakes">
              ${lesson.commonMistakes.map(m => `<li>${m}</li>`).join('')}
            </ul>
          ` : ''}
        </div>
      `;
      hintBox.hidden = true;
    }
    if (hintToggle) hintToggle.textContent = '💡 Hint';

    document.getElementById('lesson-num').textContent = `${idx + 1} / ${LESSONS.length}`;
    document.getElementById('btn-prev-lesson').disabled = idx === 0;
    document.getElementById('btn-next-lesson').disabled = idx === LESSONS.length - 1;

    const btnComplete = document.getElementById('btn-complete-lesson');
    btnComplete.textContent = done ? 'Completed ✓' : '✓ Mark Complete';
    btnComplete.classList.toggle('done', done);

    if (completedLessons.size >= LESSONS.length) {
      document.getElementById('sandbox-msg').hidden = false;
    }

    updateProgressBar();
    // Refresh build sim thumb and lesson labels
    drawSimThumb(document.getElementById('build-sim-thumb'));
    const shortTitle = lesson ? `Lesson ${lesson.id}: ${lesson.title}` : '';
    const buildLbl = document.getElementById('build-lesson-label');
    if (buildLbl) buildLbl.textContent = shortTitle;
    const codeLbl = document.getElementById('code-lesson-label');
    if (codeLbl) codeLbl.textContent = shortTitle;

    // ── Sync inline lesson pane ─────────────────────────────────────────────
    const hintContent = `
      <div class="hint-content">
        <strong>💡 Hint:</strong> ${lesson.hint}
        ${lesson.commonMistakes && lesson.commonMistakes.length ? `
          <ul class="hint-mistakes">
            ${lesson.commonMistakes.map(m => `<li>${m}</li>`).join('')}
          </ul>
        ` : ''}
      </div>
    `;

    const paneContent = document.getElementById('lesson-pane-content');
    if (paneContent) {
      paneContent.innerHTML = `
        <div class="lesson-header">
          <span class="lesson-num-badge">Lesson ${lesson.id}</span>
          <h2 class="lesson-title">${lesson.title}${done ? ' <span class="lesson-done-badge">✓ Done</span>' : ''}${starsHtml}</h2>
          <p class="lesson-objective">${lesson.objective}</p>
        </div>
        <div class="lesson-body">${lesson.content}</div>
      `;
    }

    const paneHintBox = document.getElementById('lesson-pane-hint-box');
    if (paneHintBox) {
      paneHintBox.innerHTML = hintContent;
      paneHintBox.hidden = true;
    }
    const paneHintToggle = document.getElementById('btn-pane-hint');
    if (paneHintToggle) paneHintToggle.textContent = '💡 Hint';

    const paneNum = document.getElementById('lesson-pane-num');
    if (paneNum) paneNum.textContent = `${idx + 1} / ${LESSONS.length}`;

    const panePrev = document.getElementById('btn-pane-prev');
    const paneNext = document.getElementById('btn-pane-next');
    if (panePrev) panePrev.disabled = idx === 0;
    if (paneNext) paneNext.disabled = idx === LESSONS.length - 1;

    const paneBtnComplete = document.getElementById('btn-pane-complete');
    if (paneBtnComplete) {
      paneBtnComplete.textContent = done ? 'Completed ✓' : '✓ Mark Complete';
      paneBtnComplete.classList.toggle('done', done);
    }
  }

  function updateProgressBar() {
    const fill = document.getElementById('progress-fill');
    const text = document.getElementById('progress-text');
    const count = completedLessons.size;
    const total = LESSONS.length;
    if (fill) fill.style.setProperty('--progress-pct', `${Math.round(count / total * 100)}%`);
    if (text) text.textContent = `${count} / ${total}`;

    // Also sync inline pane progress bar
    const paneFill = document.getElementById('lesson-pane-fill');
    const paneText = document.getElementById('lesson-pane-text');
    if (paneFill) paneFill.style.setProperty('--progress-pct', `${Math.round(count / total * 100)}%`);
    if (paneText) paneText.textContent = `${count} / ${total}`;
  }

  function navigateLesson(delta) {
    const next = currentLessonIdx + delta;
    if (next < 0 || next >= LESSONS.length) return;
    renderLesson(next);
    if (activeTab === 'code') loadLessonSim(next);
  }

  function onCompleteLesson() {
    const lesson = LESSONS[currentLessonIdx];
    completedLessons.add(lesson.id);
    localStorage.setItem('robobuilder_progress', JSON.stringify([...completedLessons]));
    renderLesson(currentLessonIdx);
    playSuccessSound();
  }

  function loadLessonSim(idx) {
    const lesson = LESSONS[idx];
    if (!lesson) return;

    // Auto-load starter robot for early lessons
    if (lesson.autoLoadStarter) {
      const currentParts = _BC.getRobotConfig().parts || [];
      if (currentParts.length === 0) {
        _BC.spawnStarterRobot();
      }
    }

    // Variable arena size
    const aw = lesson.arenaWidth  || 440;
    const ah = lesson.arenaHeight || 360;
    SimEngine.init(aw, ah);
    SimCanvas.setDimensions(aw, ah);

    SimEngine.setObstacles(lesson.obstacles || []);
    const s = lesson.startPosition || lesson.robotStart || { x: 122, y: 90, angleDeg: 0 };
    SimEngine.setStartPosition(s.x, s.y, s.angleDeg || 0);
    SimCanvas.setGoalZoneConfig(lesson.goalZone || null);
    SimEngine.setGoalZone(lesson.goalZone || null);
    SimCanvas.redraw();
    if (statusEl) statusEl.textContent = '';
  }

  // ── Sim controls ───────────────────────────────────────────────────────────

  let _runGoalReached = false;

  function showRunBtn(show) {
    const run   = document.getElementById('btn-run');
    const stop  = document.getElementById('btn-stop-sim');
    if (run)  run.style.display  = show ? '' : 'none';
    if (stop) stop.style.display = show ? 'none' : '';
  }

  let _runRetryCount  = 0;
  let _runRetryActive = false; // prevent multiple parallel retry chains
  function onRunClicked() {
    if (!blocklyReady) {
      switchTab('code');
      if (!_runRetryActive) {
        _runRetryActive = true;
        _runRetryCount  = 0;
      }
      if (_runRetryCount++ < 10) setTimeout(onRunClicked, 200);
      else { _runRetryCount = 0; _runRetryActive = false; } // give up after ~2s
      return;
    }
    _runRetryCount  = 0;
    _runRetryActive = false;
    if (CodeRunner.isRunning()) return;

    const errors = validateRobot(robotConfig);
    if (errors.length > 0) {
      errors.forEach(e => robotLog('⚠ ' + e, 'info'));
      if (statusEl) statusEl.textContent = errors[0];
      showRunBtn(true);
      return;
    }

    const lesson = LESSONS[currentLessonIdx];
    const s = (lesson && (lesson.startPosition || lesson.robotStart)) || { x: 122, y: 90, angleDeg: 0 };
    SimEngine.setStartPosition(s.x, s.y, s.angleDeg || 0);
    SimEngine.clearTrail();
    _runGoalReached = false;

    const led = document.getElementById('sim-led');
    if (led) led.className = 'sim-led led-off';

    showRunBtn(false);

    const code = extractCode(blocklyWorkspace);
    CodeRunner.run(code, statusEl).then(() => {
      showRunBtn(true);
      postRunValidation();
    }).catch(() => showRunBtn(true));
  }

  function postRunValidation() {
    if (_runGoalReached) return; // goal reached — no hints needed
    const lesson = LESSONS[currentLessonIdx];
    if (!lesson) return;
    const debug = SimEngine.getDebugState ? SimEngine.getDebugState() : null;
    if (!debug) return;

    // Lesson-specific hints based on observed behavior
    const hints = [];

    if (lesson.id === 3) {
      // Square challenge — expects 4 turns
      if (debug.turnCount === 0) {
        hints.push('No turns detected — try adding Turn Right 90° blocks inside the loop.');
      } else if (debug.turnCount < 4) {
        hints.push(`You turned ${debug.turnCount} time${debug.turnCount > 1 ? 's' : ''} — a square needs exactly 4 turns.`);
      } else if (debug.turnCount === 4) {
        hints.push('4 turns — perfect for a square! Check the goal zone position.');
      }
    }

    if (lesson.id === 4 || lesson.id === 5) {
      // Sensor lessons
      if (!debug.movedCalled) {
        hints.push('Robot never moved — make sure your code drives the robot forward.');
      }
    }

    if (!debug.movedCalled && lesson.goalZone) {
      hints.push('Robot didn\'t move — add a Drive Forward block.');
    }

    hints.forEach(h => robotLog('💡 ' + h, 'info'));
  }

  function onResetSim() {
    CodeRunner.stop();
    loadLessonSim(currentLessonIdx);
    const led = document.getElementById('sim-led');
    if (led) led.className = 'sim-led led-off';
    if (statusEl) statusEl.textContent = '';
    document.getElementById('goal-banner').hidden = true;
    showRunBtn(true);
  }

  function onDownloadCode() {
    if (!blocklyWorkspace) return;
    const code = extractCode(blocklyWorkspace);
    const blob = new Blob([`// RoboBuilder — Downloaded code\n// Run this in the RoboBuilder simulator\n\n${code}`], { type: 'text/javascript' });
    const a = document.createElement('a');
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = 'robot-program.js';
    a.click();
    // Defer revocation so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  }

  // ── Export / Import ───────────────────────────────────────────────────────

  function onExportProject() {
    const project = {
      version: 1,
      exportedAt: new Date().toISOString(),
      build: null,
      blocks: null,
      progress: null,
      stars: null
    };
    try { project.build    = JSON.parse(localStorage.getItem('robobuilder_build_v2') || 'null'); } catch (e) {}
    try { project.blocks   = localStorage.getItem('robobuilder_blocks') || null; } catch (e) {}
    try { project.progress = JSON.parse(localStorage.getItem('robobuilder_progress') || 'null'); } catch (e) {}
    try { project.stars    = JSON.parse(localStorage.getItem('robobuilder_stars') || 'null'); } catch (e) {}

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = 'robobuilder-project.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
  }

  function onImportProject() {
    document.getElementById('import-file-input').click();
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    // Reject files over 2 MB — valid project files are well under 100 KB
    if (file.size > 2 * 1024 * 1024) { alert('File too large to be a valid project.'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const project = JSON.parse(evt.target.result);
        // Validate required shape before touching localStorage
        if (typeof project !== 'object' || project === null || typeof project.version !== 'number') {
          alert('Invalid project file.'); return;
        }
        if (project.build !== undefined && (typeof project.build !== 'object' || !Array.isArray(project.build.parts))) {
          alert('Invalid project file: bad build data.'); return;
        }
        if (project.blocks !== undefined && typeof project.blocks !== 'string') {
          alert('Invalid project file: bad blocks data.'); return;
        }
        if (!confirm('Import this project? Your current work will be replaced.')) return;

        if (project.build)    localStorage.setItem('robobuilder_build_v2', JSON.stringify(project.build));
        if (project.blocks)   localStorage.setItem('robobuilder_blocks', project.blocks);
        if (project.progress) localStorage.setItem('robobuilder_progress', JSON.stringify(project.progress));
        if (project.stars)    localStorage.setItem('robobuilder_stars', JSON.stringify(project.stars));

        location.reload();
      } catch {
        alert('Failed to import: file is not valid JSON.');
      }
    };
    reader.readAsText(file);
    // Reset input so same file can be re-imported
    e.target.value = '';
  }

  // ── Star rating ─────────────────────────────────────────────────────────────

  function calculateStars(lesson) {
    if (!lesson || !lesson.starCriteria) return 1;
    const criteria = lesson.starCriteria;
    let met = 0;
    let total = 0;

    if (criteria.maxTime) {
      total++;
      const elapsed = (Date.now() - CodeRunner.getRunStartMs()) / 1000;
      if (elapsed <= criteria.maxTime) met++;
    }
    if (criteria.maxBlocks && blocklyWorkspace) {
      total++;
      const blockCount = blocklyWorkspace.getAllBlocks(false).length;
      if (blockCount <= criteria.maxBlocks) met++;
    }

    if (total === 0) return 1;
    if (met === total) return 3;
    if (met >= total / 2) return 2;
    return 1;
  }

  function starString(count) {
    return '★'.repeat(count) + '☆'.repeat(3 - count);
  }

  function saveLessonStars(lessonId, stars) {
    const prev = lessonStars[lessonId] || 0;
    if (stars > prev) {
      lessonStars[lessonId] = stars;
      localStorage.setItem('robobuilder_stars', JSON.stringify(lessonStars));
    }
  }

  // ── Goal reached ───────────────────────────────────────────────────────────

  function onGoalReached() {
    const banner = document.getElementById('goal-banner');
    if (banner) { banner.hidden = false; setTimeout(() => { banner.hidden = true; }, 4000); }
    launchConfetti();
    playSuccessSound();
    // Stop the running program so the Run button state stays consistent
    CodeRunner.stop();
    showRunBtn(true);

    _runGoalReached = true;

    // Auto-mark current lesson complete + star rating
    const lesson = LESSONS[currentLessonIdx];
    if (lesson) {
      const stars = calculateStars(lesson);
      saveLessonStars(lesson.id, stars);

      if (!completedLessons.has(lesson.id)) {
        completedLessons.add(lesson.id);
        localStorage.setItem('robobuilder_progress', JSON.stringify([...completedLessons]));
      }
      renderLesson(currentLessonIdx);
      robotLog(`🏆 Lesson ${lesson.id} complete: "${lesson.title}" ${starString(stars)}`, 'info');
    }
  }

  // ── Confetti ───────────────────────────────────────────────────────────────

  let _confettiRafId = null;

  function launchConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    // Cancel any previously running confetti loop before starting a new one
    if (_confettiRafId !== null) { cancelAnimationFrame(_confettiRafId); _confettiRafId = null; }
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#3B82F6', '#10B981', '#F59E0B', '#EC4899', '#8B5CF6', '#F97316'];
    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * canvas.width, y: -10,
      w: 6 + Math.random() * 8, h: 8 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
      angle: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.15
    }));

    const start = Date.now();
    function frame() {
      const age = Date.now() - start;
      if (age > 3000) { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.style.display = 'none'; _confettiRafId = null; return; }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.angle += p.spin; p.vy += 0.05;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - age / 3000);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      _confettiRafId = requestAnimationFrame(frame);
    }
    _confettiRafId = requestAnimationFrame(frame);
  }

  // ── Sound ──────────────────────────────────────────────────────────────────

  function playSuccessSound() {
    try {
      const ctx  = new (window.AudioContext || window.webkitAudioContext)();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
      [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]].forEach(([freq, delay]) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.3);
      });
    } catch (e) { /* audio not available */ }
  }

  // ── Robot validation ───────────────────────────────────────────────────────

  function validateRobot(config) {
    const errors = [];
    const parts  = config.parts || [];
    const conns  = config.connections || [];
    const types  = parts.map(p => p.type);

    const hasBattery = types.includes('battery');
    const hasBrain   = types.includes('brain');
    const hasMotor   = types.includes('motor');

    if (!hasBattery) errors.push('No battery — add a battery to power your robot.');
    if (!hasBrain)   errors.push('No brain — add a brain to control your robot.');
    if (!hasMotor)   errors.push('No motor — add at least one motor.');

    if (hasBattery && hasBrain) {
      const battId  = parts.find(p => p.type === 'battery')?.id;
      const brainId = parts.find(p => p.type === 'brain')?.id;
      const powered = conns.some(c =>
        (c.fromId === battId && c.toId === brainId) ||
        (c.fromId === brainId && c.toId === battId)
      );
      if (!powered) errors.push('Battery not wired to brain — use Wire Tool (W) to connect.');
    }

    if (hasBrain && hasMotor) {
      const brainId = parts.find(p => p.type === 'brain')?.id;
      const motors = parts.filter(p => p.type === 'motor');
      motors.forEach(m => {
        const fromId = m.id;
        const wired = conns.some(c =>
          ((c.fromId ?? c.from) === brainId && (c.toId ?? c.to) === fromId) ||
          ((c.toId ?? c.to) === brainId && (c.fromId ?? c.from) === fromId)
        );
        const name = m.props?.motorName?.trim() || m.type;
        if (!wired) errors.push(`${name} not wired to brain — use Wire Tool (W) to connect.`);
      });
    }

    return errors;
  }

  function updateDiagnosticsPanel(errors) {
    const panel = document.getElementById('diagnostics-panel');
    if (!panel) return;
    if (errors.length === 0) {
      panel.innerHTML = '<div class="diag-item diag-ok"><span class="diag-icon">✓</span>Robot wiring looks good!</div>';
    } else {
      panel.innerHTML = errors.map(e =>
        `<div class="diag-item diag-error"><span class="diag-icon">⚠</span>${e}</div>`
      ).join('');
    }
  }

  // ── Robot log ──────────────────────────────────────────────────────────────

  function robotLog(msg, type) {
    const log = document.getElementById('robot-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = type === 'collision' ? 'log-collision' : type === 'say' ? 'log-say' : 'log-info';
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.textContent = `[${time}] ${msg}`;
    log.appendChild(entry);
    while (log.children.length > 50) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  window._robotLog = robotLog;

  // ── extractCode ────────────────────────────────────────────────────────────

  function extractCode(workspace) {
    if (!workspace) return '';
    const gen = Blockly.JavaScript;

    // IMPORTANT: workspaceToCode() calls finish() at the end which sets
    // isInitialized=false, making any subsequent statementToCode / blockToCode
    // calls return empty strings — so a forever loop body would vanish.
    // Instead, call gen.init() directly so isInitialized stays true throughout,
    // then manually process only the block types we care about (never call finish()).
    gen.init(workspace);

    const topBlocks = workspace.getTopBlocks(true)   // sorted by position
      .filter(b => !b.isShadow() && b.isEnabled());

    const funcDefTypes = new Set(['func_define', 'procedures_defnoreturn', 'procedures_defreturn']);

    // 1. Process function-definition blocks first.
    //    func_define returns code directly; procedures_def* store in definitions_.
    const funcCode = [];
    for (const b of topBlocks) {
      if (!funcDefTypes.has(b.type)) continue;
      const c = gen.blockToCode(b);
      if (typeof c === 'string' && c.trim()) funcCode.push(c.trim());
    }

    // 2. Collect built-in procedure defs now stored in definitions_
    const builtinDefs = Object.values(gen.definitions_ || {}).join('\n\n');

    // 3. Generate "when program starts" bodies.
    //    Stray top-level blocks are skipped — only WPS and functions execute.
    const wpsBodies = topBlocks
      .filter(b => b.type === 'when_program_starts')
      .map(b => gen.statementToCode(b, 'DO') || '');

    if (wpsBodies.length === 0) return '';

    // 4. Build main execution: one body runs inline; multiple run simultaneously
    let mainCode;
    if (wpsBodies.length === 1) {
      mainCode = wpsBodies[0];
    } else {
      const iifes = wpsBodies
        .map(body => `  (async () => {\n${body}  })()`)
        .join(',\n');
      mainCode = `await Promise.all([\n${iifes}\n]);\n`;
    }

    // 5. Combine preamble + main; ensure all named functions are async
    const preambleParts = [builtinDefs, ...funcCode].filter(Boolean);
    let code = [...preambleParts, mainCode].join('\n\n');
    code = code.replace(/(?<!async )function ([a-zA-Z_$])/g, 'async function $1');
    return code;
  }

  // Expose globals
  window._robotConfig  = robotConfig;
  window._extractCode  = extractCode;
  window._simStatus    = '';

})();
