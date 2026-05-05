// Simulation Engine – single-body 2D tank-drive sim.
//
// State:
//   robot = { x, y, angle, velocity, turnRate, width, height }
//
// Each tick:
//   - angle  += turnRate
//   - x      += cos(angle) * velocity
//   - y      += sin(angle) * velocity
//   - clamp to arena bounds; AABB-collide with obstacles (block move)
//
// Two control entry points:
//   1. Legacy direct: setVelocity(v) / setTurnRate(r) — used by classic blocks
//      that drive the chassis as a whole.
//   2. Per-motor tank drive: setMotorSpeed(name, speed) — paired with the
//      motorConfig set by app.js. Forward speed = mean of effective motor
//      speeds; turn rate = lateral-offset-weighted difference. This lets two
//      wheels at opposite y positions act as a left/right drivetrain.
//
// Motors override the legacy velocity/turnRate when ANY motor is non-zero.
// Calling setVelocity / setTurnRate while motors are active has no effect for
// that frame — first stop the motors. (Lessons that don't use motor blocks
// never touch setMotorSpeed and stay on the legacy path.)

const SimEngine = (() => {
  // ── Constants ──────────────────────────────────────────────────────────────
  const ROBOT_WIDTH        = 109;
  const ROBOT_HEIGHT       = 75;
  const DEFAULT_ARENA_W    = 1500;
  const DEFAULT_ARENA_H    = 1500;
  const TRAIL_MAX_POINTS   = 600;
  const TRAIL_SAMPLE_RATE  = 2;
  const MOVE_THRESHOLD     = 0.1;
  const ANGLE_SNAP_EPSILON = 0.001;

  // Tank-drive scaling. Calibrated so that two motors at speed 10 produce
  // a forward velocity of ~10 px/frame, matching the legacy lessons that
  // expect setVelocity(10) and "spin both motors at 10" to behave the same.
  const MOTOR_FORWARD_SCALE = 1.0;
  // Turn rate scaling. Empirical — picked so that one motor at +10 and the
  // other at -10 produces a comfortable on-the-spot rotation (~0.08 rad/frame).
  const MOTOR_TURN_SCALE    = 0.04;

  // ── Sim state (singleton) ─────────────────────────────────────────────────
  let arenaW = DEFAULT_ARENA_W, arenaH = DEFAULT_ARENA_H;
  let obstacles = [];
  let running = false, rafId = null;
  let onTickCb = null, onCollisionCb = null;

  // Robot pose + velocity (single body, legacy shape preserved).
  let robot = {
    x: arenaW / 2, y: arenaH / 2,
    angle: -Math.PI / 2,
    velocity: 0,
    turnRate: 0,
    width: ROBOT_WIDTH,
    height: ROBOT_HEIGHT
  };

  // Trail
  let trail = [];
  let trailTick = 0;

  // Collision flash timestamp (set when robot collides; consumed by simCanvas)
  let collisionFlashAt = 0;

  // Goal zone
  let goalZone = null;
  let goalTriggered = false;
  let onGoalReached = null;

  // Angle target (frame-rate-independent turn-by-degrees)
  let _angleTarget = null;
  let _angleDoneCb = null;

  // Motors
  let _motorConfig = null;
  let _motors      = {};   // name -> { speed, reversed, wired, lateralOffset }

  // Debug
  let debugState = makeFreshDebug();
  function makeFreshDebug() {
    return { movedCalled: false, actuallyMoved: false,
             turnedCalled: false, actuallyTurned: false,
             turnCount: 0, distanceTraveled: 0 };
  }

  // ── Init / reset ──────────────────────────────────────────────────────────
  function init(width, height) {
    arenaW = width; arenaH = height;
    resetRobot();
  }

  function resetRobot() {
    robot.x = arenaW / 2;
    robot.y = arenaH / 2;
    robot.angle = -Math.PI / 2;
    robot.velocity = 0;
    robot.turnRate = 0;
    trail = []; trailTick = 0;
    stopAllMotors();
    resetDebugState();
    goalTriggered = false;
    _angleTarget = null;
    _angleDoneCb = null;
  }

  function setStartPosition(x, y, angleDeg) {
    robot.x = x;
    robot.y = y;
    robot.angle = (angleDeg || 0) * Math.PI / 180;
    robot.velocity = 0;
    robot.turnRate = 0;
    trail = []; trailTick = 0;
    resetDebugState();
    goalTriggered = false;
    _angleTarget = null;
    _angleDoneCb = null;
  }

  // ── Setters ───────────────────────────────────────────────────────────────
  function setObstacles(obs)    { obstacles = obs || []; }
  function setOnTick(fn)        { onTickCb = fn; }
  function setOnCollision(fn)   { onCollisionCb = fn; }
  function setGoalZone(zone)    { goalZone = zone; goalTriggered = false; }
  function setOnGoalReached(fn) { onGoalReached = fn; }

  function setVelocity(v) {
    const n = Number(v);
    if (!isFinite(n)) return;
    if (n !== 0) debugState.movedCalled = true;
    robot.velocity = n;
  }

  function setTurnRate(r) {
    const n = Number(r);
    if (!isFinite(n)) return;
    if (n !== 0) debugState.turnedCalled = true;
    robot.turnRate = n;
  }

  // ── Angle target (turn-by-degrees) ────────────────────────────────────────
  function setAngleTarget(angle, onDone) {
    _angleTarget = angle;
    _angleDoneCb = onDone || null;
    debugState.turnCount++;
  }
  function clearAngleTarget() { _angleTarget = null; _angleDoneCb = null; }

  // ── Motor config / control ────────────────────────────────────────────────
  // The motorConfig from app.js carries each motor's identity, wiring, reversed
  // flag, and `lateralOffset` (signed distance from chassis center along the
  // lateral axis — used to derive turn rate from per-motor speed differences).
  function setMotorConfig(config) {
    _motorConfig = config;
    _motors = {};
    if (config && config.motors) {
      config.motors.forEach(m => {
        _motors[m.name] = {
          name: m.name,
          speed: 0,
          reversed: !!m.reversed,
          wired: !!m.wired,
          lateralOffset: (typeof m.lateralOffset === 'number') ? m.lateralOffset : 0,
          partId: m.partId
        };
      });
    }
  }
  function getMotorConfig() { return _motorConfig; }

  function setMotorSpeed(name, speed) {
    const n = Number(speed);
    if (!isFinite(n)) return;
    const m = _motors[name];
    if (!m) return;
    if (!m.wired) return;
    m.speed = n;
    if (n !== 0) debugState.movedCalled = true;
  }

  function stopMotor(name)   { if (_motors[name]) _motors[name].speed = 0; }
  function stopAllMotors()   { for (const k in _motors) _motors[k].speed = 0; }
  function hasActiveMotors() {
    for (const k in _motors) if (_motors[k].speed !== 0) return true;
    return false;
  }

  // Mix per-motor speeds into chassis-level (velocity, turnRate). Returns
  // null when no motor is wired/active so legacy callers stay in control.
  function _motorMix() {
    const active = [];
    for (const k in _motors) {
      const m = _motors[k];
      if (!m.wired) continue;
      if (m.speed === 0) continue;
      active.push(m);
    }
    if (active.length === 0) return null;
    let sumSpeed = 0;
    let sumTurn  = 0;
    let nLateral = 0;
    for (const m of active) {
      const eff = m.reversed ? -m.speed : m.speed;
      sumSpeed += eff;
      // Positive lateralOffset = right side, negative = left side. Right-side
      // motors going forward (positive eff) push the chassis to turn left
      // (negative angle delta in screen coords, but we keep the sign convention
      // consistent with the legacy setTurnRate API: positive turnRate = CW).
      if (m.lateralOffset !== 0) {
        sumTurn += eff * Math.sign(m.lateralOffset);
        nLateral++;
      }
    }
    const forward = (sumSpeed / active.length) * MOTOR_FORWARD_SCALE;
    const turn    = (nLateral > 0 ? sumTurn / nLateral : 0) * MOTOR_TURN_SCALE;
    return { forward, turn };
  }

  // ── Trail / collision ─────────────────────────────────────────────────────
  function getTrail()         { return trail; }
  function clearTrail()       { trail = []; trailTick = 0; }
  function getCollisionFlash(){ return collisionFlashAt; }

  // ── Debug ─────────────────────────────────────────────────────────────────
  function getDebugState()    { return Object.assign({}, debugState); }
  function resetDebugState()  { debugState = makeFreshDebug(); }

  // ── Accessors ─────────────────────────────────────────────────────────────
  function getRobot()         { return robot; }
  function getState()         { return robot; }
  function getObstacles()     { return obstacles; }
  function getArena()         { return { width: arenaW, height: arenaH }; }
  function isRunning()        { return running; }

  // ── Physics tick ──────────────────────────────────────────────────────────
  function tick() {
    // Per-motor tank-drive overrides legacy velocity/turnRate when active.
    // This way classic lessons keep using setVelocity, while motor-block
    // lessons drive via setMotorSpeed without the two interfering.
    const mix = _motorMix();
    if (mix) {
      robot.velocity = mix.forward;
      robot.turnRate = mix.turn;
    }

    const prevX = robot.x, prevY = robot.y;

    // Integrate
    robot.angle += robot.turnRate;
    if (robot.turnRate !== 0) debugState.actuallyTurned = true;

    // Angle-target snap (frame-rate-independent turns)
    if (_angleTarget !== null) {
      const rate = robot.turnRate;
      const close = rate === 0
        ? Math.abs(robot.angle - _angleTarget) < ANGLE_SNAP_EPSILON
        : Math.abs(robot.angle - _angleTarget) < Math.abs(rate) + ANGLE_SNAP_EPSILON;
      const overshoot = rate > 0
        ? (robot.angle >= _angleTarget)
        : (rate < 0 ? (robot.angle <= _angleTarget) : false);
      if (close || overshoot) {
        robot.angle = _angleTarget;
        robot.turnRate = 0;
        const cb = _angleDoneCb;
        _angleTarget = null;
        _angleDoneCb = null;
        if (cb) cb();
      }
    }

    let nx = robot.x + Math.cos(robot.angle) * robot.velocity;
    let ny = robot.y + Math.sin(robot.angle) * robot.velocity;

    const hw = robot.width / 2, hh = robot.height / 2;

    // Arena boundary clamp
    nx = Math.max(hw, Math.min(arenaW - hw, nx));
    ny = Math.max(hh, Math.min(arenaH - hh, ny));

    let collided = false;
    for (const obs of obstacles) {
      if (aabbOverlap(nx - hw, ny - hh, robot.width, robot.height,
                      obs.x, obs.y, obs.width, obs.height)) {
        nx = prevX; ny = prevY;
        collided = true;
        break;
      }
    }
    // Wall edge flash
    if (!collided && (nx !== prevX || ny !== prevY)) {
      if (nx <= hw + 1 || nx >= arenaW - hw - 1 ||
          ny <= hh + 1 || ny >= arenaH - hh - 1) {
        collided = true;
      }
    }

    robot.x = nx;
    robot.y = ny;

    // Trail
    trailTick++;
    if (trailTick % TRAIL_SAMPLE_RATE === 0) {
      trail.push({ x: robot.x, y: robot.y, tick: trailTick });
      if (trail.length > TRAIL_MAX_POINTS) trail.shift();
    }

    if (Math.abs(robot.x - prevX) > MOVE_THRESHOLD ||
        Math.abs(robot.y - prevY) > MOVE_THRESHOLD) {
      debugState.actuallyMoved = true;
      debugState.distanceTraveled += Math.hypot(robot.x - prevX, robot.y - prevY);
    }

    if (collided) {
      collisionFlashAt = Date.now();
      if (onCollisionCb) onCollisionCb({ x: robot.x, y: robot.y, angle: robot.angle,
                                          width: robot.width, height: robot.height });
    }

    // Goal zone
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
    getTrail, clearTrail,
    getCollisionFlash,
    getDebugState, resetDebugState,
    setGoalZone, setOnGoalReached,
    setOnCollision,
    setAngleTarget, clearAngleTarget,
    setMotorConfig, getMotorConfig, setMotorSpeed, stopMotor, stopAllMotors, hasActiveMotors
  };
})();
