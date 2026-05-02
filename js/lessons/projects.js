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
      startPosition: { x: 273, y: 1023, angleDeg: -90 },
      obstacles: [],
      goalZone: { x: 1159, y: 136, width: 273, height: 273 },
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
      hint: 'Spin both motors at power 5, wait about 5.1 seconds, then stop both motors. Adjust timing to hit the goal.',
    },
    {
      id: 2,
      title: 'Square Dance',
      theme: 'Loops & geometry',
      description: 'Drive in a perfect square using a Repeat loop and your turnRight function.',
      startPosition: { x: 750, y: 955, angleDeg: -90 },
      obstacles: [],
      goalZone: { x: 648, y: 852, width: 205, height: 205 },
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
      hint: 'Use Repeat 4: spin A+B (power 5, wait 1.7s), stop, call turnRight. Tweak wait times to close the square.',
    },
    {
      id: 3,
      title: 'Zigzag Runner',
      theme: 'Functions',
      description: 'Navigate a zigzag path by alternating between turnRight and turnLeft.',
      startPosition: { x: 136, y: 1023, angleDeg: -90 },
      obstacles: [
        { x: 443, y: 0,   width: 55, height: 750 },
        { x: 955, y: 477, width: 55, height: 750 },
      ],
      goalZone: { x: 1227, y: 68, width: 205, height: 205 },
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
      startPosition: { x: 273, y: 614, angleDeg: 0 },
      obstacles: [
        { x: 1023, y: 341, width: 68, height: 546 },
      ],
      goalZone: { x: 1193, y: 68, width: 239, height: 239 },
      steps: [
        {
          title: 'Sense the Wall',
          body: '<p>Your robot has a <strong>distance sensor</strong> that tells you how far away objects are.</p>' +
                '<p>Use an <span class="block-chip control">If... Then</span> block with <span class="block-chip sensor">Distance Ahead</span> to check if a wall is close (less than 136 pixels).</p>',
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
      hint: 'Forever loop: if distance < 136, turnRight, else spin both motors. Add a small tick/wait in the loop.',
    },
    {
      id: 5,
      title: 'Maze Navigator',
      theme: 'While loops & sensors',
      description: 'Navigate through a corridor using while loops and sensor feedback.',
      startPosition: { x: 136, y: 614, angleDeg: 0 },
      obstacles: [
        { x: 0,   y: 409, width: 682, height: 55 },
        { x: 0,   y: 819, width: 682, height: 55 },
        { x: 682, y: 409, width: 55,  height: 273 },
        { x: 886, y: 614, width: 55,  height: 273 },
        { x: 682, y: 819, width: 477, height: 55 },
      ],
      goalZone: { x: 1193, y: 955, width: 239, height: 205 },
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
      hint: 'While path clear (threshold 102): spin both motors. Stop. TurnRight. Repeat the pattern for each corridor segment.',
    },
    {
      id: 6,
      title: 'Speed Controller',
      theme: 'Math & variables',
      description: 'Drive at different speeds — fast, medium, slow — to navigate a precision course.',
      startPosition: { x: 136, y: 614, angleDeg: 0 },
      obstacles: [
        { x: 614,  y: 273, width: 55, height: 409 },
        { x: 1023, y: 546, width: 55, height: 409 },
      ],
      goalZone: { x: 1261, y: 68, width: 205, height: 205 },
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
      startPosition: { x: 750, y: 614, angleDeg: -90 },
      obstacles: [],
      goalZone: { x: 34, y: 34, width: 205, height: 205 },
      steps: [
        {
          title: 'Growing Spiral',
          body: '<p>A spiral is like a square, but each side gets <strong>longer</strong>. Use a <span class="block-chip control">Repeat</span> loop and increase the drive duration each time.</p>' +
                '<p>Hint: use a <span class="block-chip logic">Number</span> variable that increases by 0.7 each iteration.</p>',
        },
        {
          title: 'Reach the Corner',
          body: '<p>The goal is in the top-left corner. Make your spiral big enough to reach it!</p>' +
                '<p>Try: start with 1.0 seconds of driving, add 0.5 each loop.</p>',
        },
      ],
      hint: 'Set a variable to 1.0. Repeat 6: spin both motors, wait (variable) seconds, stop, turnRight, add 0.5 to variable.',
    },
    {
      id: 8,
      title: 'Follow the Path',
      theme: 'Advanced sensors',
      description: 'Use continuous sensor reading to follow a winding path through obstacles.',
      startPosition: { x: 136, y: 1091, angleDeg: -45 },
      obstacles: [
        { x: 341,  y: 682, width: 273, height: 55 },
        { x: 750,  y: 341, width: 273, height: 55 },
        { x: 477,  y: 1023, width: 55, height: 205 },
        { x: 1091, y: 682, width: 55,  height: 341 },
      ],
      goalZone: { x: 1227, y: 68, width: 205, height: 205 },
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
      hint: 'Forever: if distance < 102, turn right (brief). Else spin both motors at power 4. Add small waits.',
    },
    {
      id: 9,
      title: 'Obstacle Course',
      theme: 'All concepts combined',
      description: 'The ultimate challenge — navigate a complex course using everything you\'ve learned.',
      startPosition: { x: 136, y: 1091, angleDeg: -90 },
      obstacles: [
        { x: 0,    y: 819, width: 409, height: 55 },
        { x: 546,  y: 409, width: 55,  height: 682 },
        { x: 750,  y: 205, width: 409, height: 55 },
        { x: 1023, y: 546, width: 55,  height: 477 },
        { x: 546,  y: 409, width: 341, height: 55 },
      ],
      goalZone: { x: 1227, y: 955, width: 205, height: 205 },
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
      startPosition: { x: 750, y: 614, angleDeg: -90 },
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
    // without completing — user dismissed mid-flow).
    // Note: skipTutorial() in tutorial.js calls endTutorial() before dispatching
    // this event, so _codeTutorialActive will already be false by the time the
    // 300 ms setTimeout fires — the showProjectsPanel() guard will pass correctly.
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
      // showProjectsPanel() already guards against an active tutorial via the
      // _codeTutorialActive flag — just call it directly.
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
    // Guard: the JS-state flag set/cleared by tutorial.js is the authoritative
    // signal that the tutorial is currently running.  This is immune to the
    // timing windows that a DOM-attribute check alone can miss — for example
    // the 600 ms checkCodeTab setTimeout that fires after the initial Code-tab
    // click but before startTutorial()'s own 300 ms delay has had a chance to
    // remove the 'hidden' attribute from #tutorial-right.
    //
    // When _codeTutorialActive is false the tutorial is either done, skipped,
    // or was never started — all valid cases for showing the projects panel.
    if (window._codeTutorialActive) return;

    var tutPanel = document.getElementById('tutorial-right');
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
    var aw = 1500, ah = 1500;
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
