// Simulation Engine – robot state, movement loop, AABB collision.
// Runs as a requestAnimationFrame loop; decoupled from DOM.

const SimEngine = (() => {
  // ── Constants ───────────────────────────────────────────────────────────────
  const ROBOT_WIDTH        = 32;
  const ROBOT_HEIGHT       = 22;
  const DEFAULT_ARENA_W    = 440;
  const DEFAULT_ARENA_H    = 360;
  const TRAIL_MAX_POINTS   = 600;
  const TRAIL_SAMPLE_RATE  = 2;     // record a trail point every N ticks
  const MOVE_THRESHOLD     = 0.1;   // min px delta to count as "actually moved"
  const ANGLE_SNAP_EPSILON = 0.001; // radians — snap to angle target when this close

  // Robot state (mutable)
  const robot = {
    x: 0, y: 0,
    angle: 0,        // radians; 0 = right, PI/2 = down
    velocity: 0,     // px per frame
    turnRate: 0,     // radians per frame
    width: ROBOT_WIDTH,
    height: ROBOT_HEIGHT
  };

  let arenaW    = DEFAULT_ARENA_W;
  let arenaH    = DEFAULT_ARENA_H;
  let obstacles = [];
  let running   = false;
  let rafId     = null;
  let onTickCb  = null;

  // ── Trail ─────────────────────────────────────────────────────────────────
  let trail       = [];            // [{x,y}], max 600 pts
  let trailTick   = 0;             // counter for decimation

  function getTrail()  { return trail; }
  function clearTrail(){ trail = []; trailTick = 0; }

  // ── Collision flash ───────────────────────────────────────────────────────
  let collisionFlashAt = 0;        // Date.now() timestamp of last collision

  function getCollisionFlash() { return collisionFlashAt; }

  // ── Motor state (per-motor control for tank drive) ─────────────────────────
  let _motorConfig = null;  // { motors: [{ name, label, offsetX, forwardFactor, reversed, wired }] }
  let _motors = {};         // { A: { speed: 0 }, B: { speed: 0 }, ... }

  function setMotorConfig(config) {
    _motorConfig = config;
    _motors = {};
    if (config && config.motors) {
      config.motors.forEach(m => {
        _motors[m.name] = {
          speed: 0,
          reversed: !!m.reversed,
          wired: !!m.wired,
          forwardFactor: m.forwardFactor ?? 1,  // cos(rotation): 1=forward, -1=backward, 0=sideways
          offsetX: m.offsetX ?? 0               // lateral offset from motor-assembly center (px)
        };
      });
    }
  }

  function getMotorConfig() { return _motorConfig; }

  function setMotorSpeed(name, speed) {
    const n = Number(speed);
    if (!isFinite(n)) return;
    if (_motors[name]) {
      // Unwired motors cannot spin — they have no signal from the brain
      if (!_motors[name].wired) return;
      _motors[name].speed = n;
      if (n !== 0) debugState.movedCalled = true;
    }
  }

  function stopMotor(name) {
    if (_motors[name]) _motors[name].speed = 0;
  }

  function stopAllMotors() {
    for (const key in _motors) _motors[key].speed = 0;
  }

  function _hasActiveMotorConfig() {
    return _motorConfig && _motorConfig.motors && _motorConfig.motors.length > 0;
  }

  // Returns true if any motor currently has a nonzero speed
  function hasActiveMotors() {
    for (const key in _motors) {
      if (_motors[key].speed !== 0) return true;
    }
    return false;
  }

  // ── Angle target (frame-rate-independent turns) ───────────────────────────
  let _angleTarget = null;
  let _angleDoneCb = null;

  function setAngleTarget(angle, onDone) {
    _angleTarget = angle;
    _angleDoneCb = onDone || null;
    debugState.turnCount++;
  }
  function clearAngleTarget() {
    _angleTarget = null;
    _angleDoneCb = null;
  }

  // ── Debug flags ───────────────────────────────────────────────────────────
  let debugState = { movedCalled: false, actuallyMoved: false,
                     turnedCalled: false, actuallyTurned: false,
                     turnCount: 0, distanceTraveled: 0 };

  function getDebugState()  { return Object.assign({}, debugState); }
  function resetDebugState(){
    debugState = { movedCalled:false, actuallyMoved:false,
                   turnedCalled:false, actuallyTurned:false,
                   turnCount:0, distanceTraveled:0 };
  }

  // ── Goal zone ─────────────────────────────────────────────────────────────
  let goalZone       = null;       // {x,y,width,height} or null
  let onGoalReached  = null;       // callback
  let goalTriggered  = false;

  // ── Collision callback ────────────────────────────────────────────────────
  let onCollisionCb  = null;

  function setOnCollision(fn) { onCollisionCb = fn; }

  function setGoalZone(zone)         { goalZone = zone; goalTriggered = false; }
  function setOnGoalReached(fn)      { onGoalReached = fn; }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init(width, height) {
    arenaW = width;
    arenaH = height;
    resetRobot();
  }

  function resetRobot() {
    robot.x        = arenaW / 2;
    robot.y        = arenaH / 2;
    robot.angle    = -Math.PI / 2; // facing up
    robot.velocity = 0;
    robot.turnRate = 0;
    stopAllMotors();
    clearTrail();
    resetDebugState();
    goalTriggered = false;
  }

  function setStartPosition(x, y, angleDeg) {
    robot.x        = x;
    robot.y        = y;
    robot.angle    = (angleDeg || 0) * Math.PI / 180;
    robot.velocity = 0;
    robot.turnRate = 0;
    clearTrail();
    resetDebugState();
    goalTriggered  = false;
  }

  function setObstacles(obs) { obstacles = obs || []; }
  function setOnTick(fn)     { onTickCb = fn; }

  // ── Accessors ─────────────────────────────────────────────────────────────

  function getRobot()     { return Object.assign({}, robot); }
  function getState()     { return Object.assign({}, robot); }
  function getObstacles() { return obstacles; }
  function getArena()     { return { width: arenaW, height: arenaH }; }
  function isRunning()    { return running; }

  // ── Control API (called by CodeRunner) ────────────────────────────────────

  function setVelocity(v) {
    const n = Number(v);
    if (!isFinite(n)) return; // guard against NaN/Infinity corrupting position
    if (n !== 0) debugState.movedCalled = true;
    robot.velocity = n;
  }

  function setTurnRate(r) {
    const n = Number(r);
    if (!isFinite(n)) return; // guard against NaN/Infinity corrupting angle
    if (n !== 0) debugState.turnedCalled = true;
    robot.turnRate = n;
  }

  // ── Physics Tick ──────────────────────────────────────────────────────────

  function tick() {
    const hw = robot.width  / 2;
    const hh = robot.height / 2;

    // ── Differential-drive physics ────────────────────────────────────────────
    // This is a 2D top-down simulation. Motor canvas rotation is visual only.
    // Positive speed = forward thrust for that motor, always.
    // offsetX (lateral position from robot center) creates torque → turning.
    // reversed flag inverts the speed (wiring polarity correction).
    //
    // Per motor:
    //   effective = reversed ? -speed : speed
    //
    //   totalThrust += effective                       → linear velocity
    //   totalTorque += effective * offsetX             → angular velocity
    //
    // Wheel base is derived from actual motor positions so turn rate scales
    // correctly regardless of how far apart motors are placed.
    //
    if (_hasActiveMotorConfig()) {
      // Pre-compute from ALL configured motors for stable normalization.
      // Using configured totals prevents a single straggler motor (e.g. when two
      // spinFor motors stop at marginally different times) from producing
      // excessive torque in that one transition frame.
      let totalMotors = 0, configMaxOffset = 1;
      for (const key in _motors) {
        totalMotors++;
        if (Math.abs(_motors[key].offsetX ?? 0) > configMaxOffset)
          configMaxOffset = Math.abs(_motors[key].offsetX);
      }

      let totalThrust = 0, totalTorque = 0, motorCount = 0;
      for (const key in _motors) {
        const m = _motors[key];
        if (m.speed === 0) continue;
        const effective = m.reversed ? -m.speed : m.speed;
        totalThrust += effective;
        totalTorque += effective * (m.offsetX ?? 0);
        motorCount++;
      }
      if (motorCount > 0) {
        robot.velocity = totalThrust / motorCount;
        if (_angleTarget === null) {
          robot.turnRate = -totalTorque / (totalMotors * configMaxOffset * configMaxOffset);
        }
        debugState.movedCalled = true;
      } else {
        robot.velocity = 0;
        if (_angleTarget === null) robot.turnRate = 0;
      }
    }

    // Apply rotation
    robot.angle += robot.turnRate;
    if (robot.turnRate !== 0) debugState.actuallyTurned = true;

    // Angle-target snapping — frame-rate-independent turns
    if (_angleTarget !== null) {
      const rate = robot.turnRate;
      // Snap when close enough OR have passed the target
      // If turnRate is zero (e.g. clearAngleTarget was called then a new target set
      // before the tick cleared it), snap immediately to avoid an infinite wait.
      const close    = rate === 0
        ? Math.abs(robot.angle - _angleTarget) < ANGLE_SNAP_EPSILON
        : Math.abs(robot.angle - _angleTarget) < Math.abs(rate) + ANGLE_SNAP_EPSILON;
      const overshoot = rate > 0 ? (robot.angle >= _angleTarget) : (rate < 0 ? (robot.angle <= _angleTarget) : false);
      if (close || overshoot) {
        robot.angle    = _angleTarget;
        robot.turnRate = 0;
        const cb = _angleDoneCb;
        _angleTarget  = null;
        _angleDoneCb  = null;
        if (cb) cb();
      }
    }

    // Apply motion
    const prevX = robot.x;
    const prevY = robot.y;
    // Snap trig components to exactly 0 when negligibly small — Math.cos(-PI/2)
    // returns ~6e-17 instead of 0, which accumulates into visible drift over frames.
    const snap = v => Math.abs(v) < 1e-10 ? 0 : v;
    let nx = robot.x + robot.velocity * snap(Math.cos(robot.angle));
    let ny = robot.y + robot.velocity * snap(Math.sin(robot.angle));

    // Arena boundary clamp
    nx = Math.max(hw, Math.min(arenaW - hw, nx));
    ny = Math.max(hh, Math.min(arenaH - hh, ny));

    let collided = false;

    // AABB collision vs obstacles – push robot back if overlapping
    for (const obs of obstacles) {
      if (aabbOverlap(nx - hw, ny - hh, robot.width, robot.height,
                      obs.x, obs.y, obs.width, obs.height)) {
        nx = prevX;
        ny = prevY;
        robot.velocity = 0;
        collided = true;
        break;
      }
    }

    // Wall collision flash
    if (!collided && (nx !== prevX || ny !== prevY)) {
      if (nx <= hw + 1 || nx >= arenaW - hw - 1 ||
          ny <= hh + 1 || ny >= arenaH - hh - 1) {
        collided = true;
      }
    }

    robot.x = nx;
    robot.y = ny;

    if (collided) {
      collisionFlashAt = Date.now();
      if (onCollisionCb) onCollisionCb(Object.assign({}, robot));
    }
    if (Math.abs(robot.x - prevX) > MOVE_THRESHOLD || Math.abs(robot.y - prevY) > MOVE_THRESHOLD) {
      debugState.actuallyMoved = true;
      debugState.distanceTraveled += Math.hypot(robot.x - prevX, robot.y - prevY);
    }

    // Trail: record every 2 ticks
    trailTick++;
    if (trailTick % TRAIL_SAMPLE_RATE === 0) {
      trail.push({ x: robot.x, y: robot.y, tick: trailTick });
      if (trail.length > TRAIL_MAX_POINTS) trail.shift();
    }

    // Goal zone detection
    if (goalZone && !goalTriggered) {
      if (robot.x >= goalZone.x && robot.x <= goalZone.x + goalZone.width &&
          robot.y >= goalZone.y && robot.y <= goalZone.y + goalZone.height) {
        goalTriggered = true;
        if (onGoalReached) onGoalReached();
      }
    }

    if (onTickCb) onTickCb(robot);
  }

  function aabbOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 && x1 + w1 > x2 &&
           y1 < y2 + h2 && y1 + h1 > y2;
  }

  // ── Loop ──────────────────────────────────────────────────────────────────

  function startLoop() {
    if (running) return;
    running = true;
    function loop() {
      if (!running) return;
      tick();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  return {
    init, resetRobot, setStartPosition,
    setObstacles, setOnTick,
    getRobot, getState, getObstacles, getArena, isRunning,
    setVelocity, setTurnRate,
    startLoop, stopLoop, tick,
    // Trail
    getTrail, clearTrail,
    // Collision flash
    getCollisionFlash,
    // Debug
    getDebugState, resetDebugState,
    // Goal zone
    setGoalZone, setOnGoalReached,
    // Collision callback
    setOnCollision,
    // Angle target
    setAngleTarget, clearAngleTarget,
    // Motor control (tank drive)
    setMotorConfig, getMotorConfig, setMotorSpeed, stopMotor, stopAllMotors, hasActiveMotors
  };
})();
