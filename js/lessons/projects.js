// projects.js — 10 coding challenges shown in the Code tab after tutorial completion.
// Loaded after tutorial.js.
// Uses globals: window._blocklyWorkspace, window._addBlockFromXml,
//   window._activeTab, SimEngine, SimCanvas, LESSONS

(function () {
  'use strict';

  var STORAGE_KEY = 'robobuilder_projects_v1';
  var panel, bodyEl, backBtn, titleEl;
  var completedProjects = loadProgress();
  var activeProject = null;
  var activeStepIdx = 0;
  var _goalHandler = null;

  // ── Project Definitions ─────────────────────────────────────────────────────
  var PROJECTS = [
    {
      id: 1,
      title: 'Drive & Park',
      theme: 'Precise movement',
      description: 'Drive forward a set distance and stop exactly inside the goal zone.',
      startPosition: { x: 80, y: 300, angleDeg: -90 },
      obstacles: [],
      goalZone: { x: 340, y: 40, width: 80, height: 80 },
      steps: [
        {
          title: 'Plan Your Drive',
          body: '<p>The goal zone is at the <strong>top-right</strong> of the field. Your robot starts at the bottom-left.</p>' +
                '<p>Use <span class="block-chip motor">Spin Motor</span> blocks and a <span class="block-chip control">Wait</span> block to drive forward, then <span class="block-chip motor">Stop Motor</span> to park.</p>' +
                '<p>Adjust the wait time to land inside the green zone!</p>',
        },
        {
          title: 'Fine-Tune Your Timing',
          body: '<p>If you overshoot or undershoot, tweak the <strong>wait duration</strong>. Small changes make a big difference!</p>' +
                '<p>Click <strong>Run</strong> to test. The goal is reached automatically when your robot enters the green zone.</p>',
        },
      ],
      hint: 'Spin both motors at power 5, wait about 1.5 seconds, then stop both motors. Adjust timing to hit the goal.',
    },
    {
      id: 2,
      title: 'Square Dance',
      theme: 'Loops & geometry',
      description: 'Drive in a perfect square using a Repeat loop and your turnRight function.',
      startPosition: { x: 220, y: 280, angleDeg: -90 },
      obstacles: [],
      goalZone: { x: 190, y: 250, width: 60, height: 60 },
      steps: [
        {
          title: 'Build the Square',
          body: '<p>A square has 4 equal sides and 4 right-angle turns. Use a <span class="block-chip control">Repeat 4 times</span> loop with:</p>' +
                '<ul style="margin:0.3rem 0;padding-left:1.2rem"><li>Drive forward (spin + wait + stop)</li><li>Call <code>turnRight</code></li></ul>' +
                '<p>The robot should end up back where it started!</p>',
        },
        {
          title: 'Close the Loop',
          body: '<p>If your square doesn\'t close perfectly, adjust the <strong>turn duration</strong> inside your <code>turnRight</code> function or the <strong>drive duration</strong>.</p>' +
                '<p>The goal zone is at the starting position — drive the square and land back on it!</p>',
        },
      ],
      hint: 'Use Repeat 4: spin A+B (power 5, wait 0.5s), stop, call turnRight. Tweak wait times to close the square.',
    },
    {
      id: 3,
      title: 'Zigzag Runner',
      theme: 'Functions',
      description: 'Navigate a zigzag path by alternating between turnRight and turnLeft.',
      startPosition: { x: 40, y: 300, angleDeg: -90 },
      obstacles: [
        { x: 130, y: 0, width: 16, height: 220 },
        { x: 280, y: 140, width: 16, height: 220 },
      ],
      goalZone: { x: 360, y: 20, width: 60, height: 60 },
      steps: [
        {
          title: 'Create turnLeft',
          body: '<p>You already have <code>turnRight</code>. Now create a <code>turnLeft</code> function — reverse the motor directions:</p>' +
                '<ul style="margin:0.3rem 0;padding-left:1.2rem"><li>Motor A at power <strong>-5</strong></li><li>Motor B at power <strong>5</strong></li></ul>' +
                '<p>Wait, then stop both motors.</p>',
        },
        {
          title: 'Zigzag Through',
          body: '<p>Navigate around the walls by alternating: drive → turn right → drive → turn left → drive.</p>' +
                '<p>You may need to repeat this pattern. Adjust timing for each segment!</p>',
        },
      ],
      hint: 'Create turnLeft (reverse of turnRight). Then: drive, turnRight, drive, turnLeft, drive, turnRight, drive to goal. Adjust wait times for each leg.',
    },
    {
      id: 4,
      title: 'Wall Avoider',
      theme: 'Sensors & if/then',
      description: 'Use the distance sensor to detect a wall and turn before hitting it.',
      startPosition: { x: 80, y: 180, angleDeg: 0 },
      obstacles: [
        { x: 300, y: 100, width: 20, height: 160 },
      ],
      goalZone: { x: 350, y: 20, width: 70, height: 70 },
      steps: [
        {
          title: 'Sense the Wall',
          body: '<p>Your robot has a <strong>distance sensor</strong> that tells you how far away objects are.</p>' +
                '<p>Use an <span class="block-chip control">If... Then</span> block with <span class="block-chip sensor">Distance Ahead</span> to check if a wall is close (less than 40 pixels).</p>',
        },
        {
          title: 'Turn and Go',
          body: '<p>Inside the if block: when the wall is close, call <code>turnRight</code> (or left). Otherwise, keep driving forward.</p>' +
                '<p>Use a <span class="block-chip control">Forever Loop</span> to keep checking continuously!</p>',
        },
        {
          title: 'Reach the Goal',
          body: '<p>The goal is past the wall. Turn when you detect it, drive around, and park in the green zone!</p>',
        },
      ],
      hint: 'Forever loop: if distance < 40, turnRight, else spin both motors. Add a small tick/wait in the loop.',
    },
    {
      id: 5,
      title: 'Maze Navigator',
      theme: 'While loops & sensors',
      description: 'Navigate through a corridor using while loops and sensor feedback.',
      startPosition: { x: 40, y: 180, angleDeg: 0 },
      obstacles: [
        { x: 0, y: 120, width: 200, height: 16 },
        { x: 0, y: 240, width: 200, height: 16 },
        { x: 200, y: 120, width: 16, height: 80 },
        { x: 260, y: 180, width: 16, height: 80 },
        { x: 200, y: 240, width: 140, height: 16 },
      ],
      goalZone: { x: 350, y: 280, width: 70, height: 60 },
      steps: [
        {
          title: 'Drive Until Blocked',
          body: '<p>Use a <span class="block-chip control">While Loop</span> with <span class="block-chip sensor">Path Clear?</span> — drive forward while the path is clear, then stop when you hit a wall.</p>',
        },
        {
          title: 'Turn and Continue',
          body: '<p>After stopping at a wall, turn right and repeat. Chain multiple drive-until-blocked + turn sequences to navigate the corridor.</p>',
        },
      ],
      hint: 'While path clear (threshold 30): spin both motors. Stop. TurnRight. Repeat the pattern for each corridor segment.',
    },
    {
      id: 6,
      title: 'Speed Controller',
      theme: 'Math & variables',
      description: 'Drive at different speeds — fast, medium, slow — to navigate a precision course.',
      startPosition: { x: 40, y: 180, angleDeg: 0 },
      obstacles: [
        { x: 180, y: 80, width: 16, height: 120 },
        { x: 300, y: 160, width: 16, height: 120 },
      ],
      goalZone: { x: 370, y: 20, width: 60, height: 60 },
      steps: [
        {
          title: 'Variable Power',
          body: '<p>Different situations need different speeds! Try driving at power <strong>8</strong> for open areas and power <strong>2</strong> for tight spaces.</p>' +
                '<p>Use the <span class="block-chip motor">Spin Motor</span> block\'s power input to control speed.</p>',
        },
        {
          title: 'Navigate the Course',
          body: '<p>Drive fast, turn, drive slow through the gap, turn again, and reach the goal!</p>' +
                '<p>Use <span class="block-chip logic">Math</span> operators to calculate power if you want extra challenge.</p>',
        },
      ],
      hint: 'Drive fast (power 8) to first wall, turn, drive slow (power 3) through gap, turn, drive fast to goal.',
    },
    {
      id: 7,
      title: 'Spiral Explorer',
      theme: 'Changing values in loops',
      description: 'Drive in an expanding spiral by increasing drive time each loop iteration.',
      startPosition: { x: 220, y: 180, angleDeg: -90 },
      obstacles: [],
      goalZone: { x: 10, y: 10, width: 60, height: 60 },
      steps: [
        {
          title: 'Growing Spiral',
          body: '<p>A spiral is like a square, but each side gets <strong>longer</strong>. Use a <span class="block-chip control">Repeat</span> loop and increase the drive duration each time.</p>' +
                '<p>Hint: use a <span class="block-chip logic">Number</span> variable that increases by 0.2 each iteration.</p>',
        },
        {
          title: 'Reach the Corner',
          body: '<p>The goal is in the top-left corner. Make your spiral big enough to reach it!</p>' +
                '<p>Try: start with 0.3 seconds of driving, add 0.15 each loop.</p>',
        },
      ],
      hint: 'Set a variable to 0.3. Repeat 6: spin both motors, wait (variable) seconds, stop, turnRight, add 0.15 to variable.',
    },
    {
      id: 8,
      title: 'Follow the Path',
      theme: 'Advanced sensors',
      description: 'Use continuous sensor reading to follow a winding path through obstacles.',
      startPosition: { x: 40, y: 320, angleDeg: -45 },
      obstacles: [
        { x: 100, y: 200, width: 80, height: 16 },
        { x: 220, y: 100, width: 80, height: 16 },
        { x: 140, y: 300, width: 16, height: 60 },
        { x: 320, y: 200, width: 16, height: 100 },
      ],
      goalZone: { x: 360, y: 20, width: 60, height: 60 },
      steps: [
        {
          title: 'Reactive Driving',
          body: '<p>Instead of pre-planning every move, use the sensor to <strong>react</strong> to obstacles in real time.</p>' +
                '<p>In a <span class="block-chip control">Forever Loop</span>, read the distance sensor. If close to a wall, turn. If clear, drive forward.</p>',
        },
        {
          title: 'Smooth Navigation',
          body: '<p>Try adjusting motor speeds based on distance — drive slower when objects are near, faster when clear.</p>' +
                '<p>Navigate through the obstacle field to the goal!</p>',
        },
      ],
      hint: 'Forever: if distance < 30, turn right (brief). Else spin both motors at power 4. Add small waits.',
    },
    {
      id: 9,
      title: 'Obstacle Course',
      theme: 'All concepts combined',
      description: 'The ultimate challenge — navigate a complex course using everything you\'ve learned.',
      startPosition: { x: 40, y: 320, angleDeg: -90 },
      obstacles: [
        { x: 0, y: 240, width: 120, height: 16 },
        { x: 160, y: 120, width: 16, height: 200 },
        { x: 220, y: 60, width: 120, height: 16 },
        { x: 300, y: 160, width: 16, height: 140 },
        { x: 160, y: 120, width: 100, height: 16 },
      ],
      goalZone: { x: 360, y: 280, width: 60, height: 60 },
      steps: [
        {
          title: 'Study the Map',
          body: '<p>Look at the field preview — there are walls creating a maze-like course. Plan your route!</p>' +
                '<p>You\'ll need <strong>driving, turning, sensing, and timing</strong> to complete this.</p>',
        },
        {
          title: 'Execute Your Plan',
          body: '<p>You can pre-program the exact sequence of moves, or use sensor-based reactive driving.</p>' +
                '<p>Mix and match techniques — whatever gets you to the goal!</p>',
        },
        {
          title: 'Finish Line',
          body: '<p>The goal is at the bottom-right. Navigate the full course to complete this challenge!</p>',
        },
      ],
      hint: 'Try a sensor-based approach: forever loop with distance check, turn when blocked. Or pre-program: drive, turn, drive, turn through each segment.',
    },
    {
      id: 10,
      title: 'Free Build',
      theme: 'Open sandbox',
      description: 'No goal — experiment freely! Build anything you can imagine.',
      startPosition: { x: 220, y: 180, angleDeg: -90 },
      obstacles: [],
      goalZone: null,
      steps: [
        {
          title: 'Your Sandbox',
          body: '<p>No rules, no goals — just you and your robot!</p>' +
                '<p>Ideas to try:</p>' +
                '<ul style="margin:0.3rem 0;padding-left:1.2rem">' +
                '<li>Draw shapes with the trail (enable it in settings)</li>' +
                '<li>Create new functions for complex movements</li>' +
                '<li>Build a line-following algorithm</li>' +
                '<li>Make the robot dance!</li>' +
                '</ul>' +
                '<p>Click <strong>Complete</strong> when you\'re ready to move on.</p>',
          showComplete: true,
        },
      ],
      hint: null,
    },
  ];

  // ── Init ──────────────────────────────────────────────────────────────────────
  window.addEventListener('load', function () {
    panel   = document.getElementById('projects-right');
    bodyEl  = document.getElementById('projects-body');
    backBtn = document.getElementById('projects-back-btn');
    titleEl = document.getElementById('projects-title');

    if (!panel || !bodyEl) return;

    if (backBtn) {
      backBtn.addEventListener('click', function () {
        activeProject = null;
        removeGoalListener();
        showProjectsGrid();
      });
    }

    // Show projects panel after tutorial completes
    window.addEventListener('robobuilder:tutorial-complete', function () {
      // Small delay to let login modal flow happen first
      setTimeout(function () {
        showProjectsPanel();
      }, 2000);
    });

    // Also show projects when the tutorial is skipped (tutorial panel hidden
    // without completing — user dismissed mid-flow)
    window.addEventListener('robobuilder:tutorial-closed', function () {
      setTimeout(function () {
        if (window._activeTab === 'code') showProjectsPanel();
      }, 300);
    });

    // Show projects on code tab switch whenever the tutorial panel is not open.
    // This covers: tutorial already done, tutorial was skipped, or user never
    // triggered the tutorial at all.
    var checkCodeTab = function () {
      if (window._activeTab !== 'code') return;
      // Don't override an actively-running tutorial.
      var tutPanel = document.getElementById('tutorial-right');
      if (tutPanel && !tutPanel.hasAttribute('hidden')) return;
      showProjectsPanel();
    };
    document.querySelectorAll('.tab-btn[data-tab="code"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTimeout(checkCodeTab, 600);
      });
    });
    // Also check on load if already on code tab
    setTimeout(checkCodeTab, 800);
  });

  // ── Show/Hide ─────────────────────────────────────────────────────────────────
  function showProjectsPanel() {
    // Don't stomp on an actively-running tutorial — guard, then hide.
    var tutPanel = document.getElementById('tutorial-right');
    if (tutPanel && !tutPanel.hasAttribute('hidden')) {
      // Tutorial is currently shown; the user is mid-tutorial. Skip projects.
      return;
    }
    if (tutPanel) tutPanel.setAttribute('hidden', '');

    panel.removeAttribute('hidden');
    showProjectsGrid();
  }

  function showProjectsGrid() {
    activeProject = null;
    titleEl.textContent = 'Projects';
    if (backBtn) backBtn.setAttribute('hidden', '');

    var html = '<div class="projects-grid">';
    PROJECTS.forEach(function (p) {
      var done = completedProjects.indexOf(p.id) >= 0;
      html += '<div class="project-card' + (done ? ' project-done' : '') + '" data-project-id="' + p.id + '">' +
        '<span class="project-card-num">Project ' + p.id + '</span>' +
        '<span class="project-card-title">' + p.title + '</span>' +
        '<span class="project-card-theme">' + p.theme + '</span>' +
        (done ? '<span class="project-card-check">Completed</span>' : '') +
        '</div>';
    });
    html += '</div>';
    bodyEl.innerHTML = html;

    // Wire click handlers
    bodyEl.querySelectorAll('.project-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var id = parseInt(card.dataset.projectId, 10);
        var proj = PROJECTS.find(function (p) { return p.id === id; });
        if (proj) openProject(proj);
      });
    });
  }

  // ── Open a specific project ───────────────────────────────────────────────────
  function openProject(project) {
    activeProject = project;
    activeStepIdx = 0;

    titleEl.textContent = project.title;
    if (backBtn) backBtn.removeAttribute('hidden');

    // Set up the sim arena for this project
    setupProjectSim(project);

    // Listen for goal reached
    if (project.goalZone) {
      listenForGoal(project);
    }

    renderProjectStep();
  }

  function setupProjectSim(project) {
    var aw = 440, ah = 360;
    if (typeof SimEngine !== 'undefined') {
      SimEngine.init(aw, ah);
      SimEngine.setObstacles(project.obstacles || []);
      var sp = project.startPosition || { x: 220, y: 180, angleDeg: -90 };
      SimEngine.setStartPosition(sp.x, sp.y, sp.angleDeg || 0);
      SimEngine.setGoalZone(project.goalZone || null);
    }
    if (typeof SimCanvas !== 'undefined') {
      SimCanvas.setDimensions(aw, ah);
      SimCanvas.setGoalZoneConfig(project.goalZone || null);
      SimCanvas.redraw();
    }
    // Keep 3D canvases in sync (guarded — may not be inited yet)
    if (typeof CodeCanvas3D !== 'undefined' && CodeCanvas3D) {
      CodeCanvas3D.setObstacles(project.obstacles || []);
      CodeCanvas3D.setGoalZoneConfig(project.goalZone || null);
    }
    if (typeof TestCanvas3D !== 'undefined' && TestCanvas3D) {
      TestCanvas3D.setObstacles(project.obstacles || []);
      TestCanvas3D.setGoalZoneConfig(project.goalZone || null);
    }
  }

  // Exposed so app.js can honor the active project on Reset/Run instead of
  // falling back to the current lesson's start position.
  window._getActiveProject = function () { return activeProject; };
  window._setupProjectSim  = setupProjectSim;

  function renderProjectStep() {
    if (!activeProject) return;
    var steps = activeProject.steps;
    var step = steps[activeStepIdx];
    if (!step) return;

    var totalSteps = steps.length;
    var pct = ((activeStepIdx + 1) / totalSteps * 100).toFixed(0);

    var html = '<div class="project-step-view">' +
      '<div class="project-step-progress"><div class="project-step-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="project-step-badge">Step ' + (activeStepIdx + 1) + ' of ' + totalSteps + '</div>' +
      '<h3 class="project-step-title">' + step.title + '</h3>' +
      '<div class="project-step-body">' + step.body + '</div>' +
      '<div class="project-step-footer">';

    // Hint button
    if (activeProject.hint && activeStepIdx === totalSteps - 1) {
      html += '<button class="tut-helper-btn" id="project-hint-btn">Show Hint</button>';
    } else {
      html += '<span></span>';
    }

    // Next / Complete button
    if (step.showComplete) {
      html += '<button class="tut-next-btn cta" id="project-complete-btn">Complete</button>';
    } else if (activeStepIdx < totalSteps - 1) {
      html += '<button class="tut-next-btn" id="project-next-btn">Next \u2192</button>';
    } else {
      html += '<span class="project-step-badge" style="font-size:0.72rem">Reach the goal to complete!</span>';
    }

    html += '</div></div>';
    bodyEl.innerHTML = html;

    // Wire buttons
    var nextBtn = document.getElementById('project-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        activeStepIdx++;
        renderProjectStep();
      });
    }

    var hintBtn = document.getElementById('project-hint-btn');
    if (hintBtn) {
      hintBtn.addEventListener('click', function () {
        var hintEl = document.createElement('div');
        hintEl.style.cssText = 'margin-top:0.5rem;padding:0.5rem;background:var(--bg-surface);border-radius:var(--r-md);font-size:0.78rem;color:var(--text-2);line-height:1.5';
        hintEl.textContent = activeProject.hint;
        hintBtn.parentNode.insertBefore(hintEl, hintBtn.nextSibling);
        hintBtn.remove();
      });
    }

    var completeBtn = document.getElementById('project-complete-btn');
    if (completeBtn) {
      completeBtn.addEventListener('click', function () {
        completeProject(activeProject);
      });
    }
  }

  // ── Goal listening ────────────────────────────────────────────────────────────
  function listenForGoal(project) {
    removeGoalListener();
    _goalHandler = function () {
      removeGoalListener();
      completeProject(project);
    };
    window.addEventListener('robobuilder:goalreached', _goalHandler);
  }

  function removeGoalListener() {
    if (_goalHandler) {
      window.removeEventListener('robobuilder:goalreached', _goalHandler);
      _goalHandler = null;
    }
  }

  // ── Completion ────────────────────────────────────────────────────────────────
  function completeProject(project) {
    if (completedProjects.indexOf(project.id) < 0) {
      completedProjects.push(project.id);
      saveProgress();
    }

    // Show completion message
    bodyEl.innerHTML =
      '<div style="text-align:center;padding:2rem 1rem">' +
        '<div style="font-size:2.5rem">&#127881;</div>' +
        '<h3 style="margin:0.5rem 0;color:var(--text-1)">Project Complete!</h3>' +
        '<p style="color:var(--text-2);font-size:0.85rem">' + project.title + ' — great work!</p>' +
        '<button class="tut-next-btn cta" id="project-back-grid" style="margin-top:1rem">Back to Projects</button>' +
      '</div>';

    document.getElementById('project-back-grid').addEventListener('click', function () {
      showProjectsGrid();
    });
  }

  // ── Progress persistence ──────────────────────────────────────────────────────
  function loadProgress() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
  }

  function saveProgress() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completedProjects));
  }

})();
