// Simulation Engine – multi-body 2D rigid-body physics.
//
// At run-start the engine builds a connectivity graph from placedParts using
// snap-point coincidence (same threshold as snapSystem). Each connected
// component becomes its own body with its own pose, velocity, and trail.
// Motors thrust their body only if that body's part graph contains a wheel;
// off-center motors produce torque, so unbalanced drives curve.
//
// Backwards-compatible legacy API is preserved:
//   • getRobot()/getState() return the primary body's pose (the body with the
//     most wheels, or the first encountered). External callers that already
//     read x/y/angle/width/height keep working without changes.
//   • setVelocity/setTurnRate act on the primary body, synthesizing force +
//     torque so existing lessons that don't use the per-motor API still drive.
//   • setMotorSpeed routes to whichever body owns that motor.

const SimEngine = (() => {
  // ── Constants ───────────────────────────────────────────────────────────────
  const ROBOT_WIDTH        = 109;
  const ROBOT_HEIGHT       = 75;
  const DEFAULT_ARENA_W    = 1500;
  const DEFAULT_ARENA_H    = 1500;
  const TRAIL_MAX_POINTS   = 600;
  const TRAIL_SAMPLE_RATE  = 2;     // record a trail point every N ticks
  const MOVE_THRESHOLD     = 0.1;
  const ANGLE_SNAP_EPSILON = 0.001;

  // Rigid-body tuning. THRUST_COEFF is calibrated so that two centered motors
  // at speed=10 produce roughly the same forward speed as the legacy
  // tank-drive shortcut (~10 px/frame). LINEAR_DAMPING < 1 keeps motion stable
  // under sustained thrust and provides a velocity ceiling. ANGULAR_DAMPING
  // is more aggressive — angular momentum should bleed off quickly so users
  // see prompt response when motors stop.
  const THRUST_COEFF       = 0.7;
  const LINEAR_DAMPING     = 0.86;
  const ANGULAR_DAMPING    = 0.78;

  // Mass / inertia scales. We treat each part as a unit point mass
  // (mass = part count). Moment-of-inertia uses a point-mass approximation
  // sum(|r|²) about the body COM — clamped from below so a single-part body
  // still has finite angular inertia.
  const MIN_INERTIA        = 1.0;

  // ── Singleton sim state ───────────────────────────────────────────────────
  let arenaW    = DEFAULT_ARENA_W;
  let arenaH    = DEFAULT_ARENA_H;
  let obstacles = [];
  let running   = false;
  let rafId     = null;
  let onTickCb  = null;
  let onCollisionCb = null;

  // Goal zone
  let goalZone      = null;
  let onGoalReached = null;
  let goalTriggered = false;

  // Collision flash (shared across all bodies — set when ANY body collides)
  let collisionFlashAt = 0;

  // Debug
  let debugState = makeFreshDebug();
  function makeFreshDebug() {
    return { movedCalled: false, actuallyMoved: false,
             turnedCalled: false, actuallyTurned: false,
             turnCount: 0, distanceTraveled: 0 };
  }

  // ── Build-time inputs ─────────────────────────────────────────────────────
  // Latest snapshot of what the user built. Bodies are derived from this.
  let _placedParts = [];
  let _motorConfig = null;   // { motors: [{ name, label, partId, offsetX, reversed, wired, ... }] }
  let _motors      = {};     // name -> { speed, reversed, wired, partId, ... }

  // ── Bodies ────────────────────────────────────────────────────────────────
  // A body owns its pose, velocity, parts list (with body-local offsets), and
  // its own trail. The "default body" is used when no parts are configured —
  // it preserves the legacy single-robot behaviour for lessons.
  let bodies = [];
  let primaryBodyIdx = 0;

  function makeDefaultBody() {
    return {
      id: 'default',
      x: arenaW / 2, y: arenaH / 2, angle: -Math.PI / 2,
      vx: 0, vy: 0, omega: 0,
      // Legacy tank-drive shadow values (still consumed if no real bodies)
      legacyVelocity: 0, legacyTurnRate: 0,
      width: ROBOT_WIDTH, height: ROBOT_HEIGHT,
      mass: 1, inertia: MIN_INERTIA,
      parts: [],
      motorNames: [],
      hasWheel: true, // synthetic — legacy mode always responds to thrust
      isDefault: true,
      trail: [], trailTick: 0,
      goalReached: false
    };
  }

  // Initial single default body
  bodies = [makeDefaultBody()];

  // ── Connectivity graph + body construction ────────────────────────────────

  // Two parts are "connected" if any pair of world-space snap points are
  // within SNAP_THRESHOLD. We use the same logic as the build-time snap
  // system; this is also how the user wired them visually.
  function _partsConnected(a, b) {
    if (typeof getWorldSnapPoints !== 'function' || typeof SNAP_THRESHOLD === 'undefined') {
      return false;
    }
    const aSPs = getWorldSnapPoints(a);
    const bSPs = getWorldSnapPoints(b);
    for (const sa of aSPs) {
      for (const sb of bSPs) {
        const dx = sa.x - sb.x;
        const dy = sa.y - sb.y;
        if (dx * dx + dy * dy < SNAP_THRESHOLD * SNAP_THRESHOLD) return true;
      }
    }
    return false;
  }

  function _buildBodies(placedParts) {
    if (!placedParts || placedParts.length === 0) {
      bodies = [makeDefaultBody()];
      primaryBodyIdx = 0;
      return;
    }

    // Union-Find over placedParts indices
    const n = placedParts.length;
    const parent = new Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (_partsConnected(placedParts[i], placedParts[j])) union(i, j);
      }
    }

    // Group by root
    const groups = new Map(); // root -> [partIdx,...]
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }

    // Build body objects
    const newBodies = [];
    for (const [, idxList] of groups) {
      const groupParts = idxList.map(i => placedParts[i]);

      // Centroid in build-canvas coords (use part center)
      let sumX = 0, sumY = 0;
      const partCenters = groupParts.map(p => {
        const def = (typeof getPartDef === 'function') ? getPartDef(p.type) : null;
        const pw = def ? getEffectiveW(p, def) : 32;
        const ph = def ? getEffectiveH(p, def) : 22;
        const cx = p.position.x + pw / 2;
        const cy = p.position.y + ph / 2;
        sumX += cx; sumY += cy;
        return { p, cx, cy };
      });
      const comX = sumX / groupParts.length;
      const comY = sumY / groupParts.length;

      // AABB extents (used for legacy width/height / collision)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      groupParts.forEach(p => {
        const def = (typeof getPartDef === 'function') ? getPartDef(p.type) : null;
        const pw = def ? getEffectiveW(p, def) : 32;
        const ph = def ? getEffectiveH(p, def) : 22;
        if (p.position.x       < minX) minX = p.position.x;
        if (p.position.y       < minY) minY = p.position.y;
        if (p.position.x + pw  > maxX) maxX = p.position.x + pw;
        if (p.position.y + ph  > maxY) maxY = p.position.y + ph;
      });
      const aabbW = Math.max(8, maxX - minX);
      const aabbH = Math.max(8, maxY - minY);

      // Body-local part records (offset from COM, in build-canvas frame)
      const bodyParts = partCenters.map(({ p, cx, cy }) => ({
        id: p.id,
        type: p.type,
        // Local offset from body COM, in build-frame.
        // Build-frame y axis maps to body-local "left/right" because the
        // build canvas is rendered rotated -90° in the sim (matches
        // _updateMotorConfig's offsetX = motor Y in build canvas).
        localX: cx - comX,
        localY: cy - comY,
        rotation: p.rotation || 0,
        props: Object.assign({}, p.props || {})
      }));

      const motorNames = [];
      let hasWheel = false;
      let wheelCount = 0;
      bodyParts.forEach(bp => {
        if (bp.type === 'wheel') { hasWheel = true; wheelCount++; }
      });
      const partIdSet = new Set(groupParts.map(p => p.id));
      // Map motor names → which body holds them (we'll resolve from _motorConfig later)
      // Here we just remember which partIds belong to this body so we can compute it.

      // Mass & inertia (point-mass per part about COM)
      const mass = groupParts.length;
      let inertia = 0;
      bodyParts.forEach(bp => { inertia += bp.localX * bp.localX + bp.localY * bp.localY; });
      inertia = Math.max(MIN_INERTIA, inertia);

      newBodies.push({
        id: 'body-' + idxList.join('-'),
        x: comX, y: comY,        // initial pose = COM in build coords (will be reset by setStartPosition)
        angle: 0,
        vx: 0, vy: 0, omega: 0,
        legacyVelocity: 0, legacyTurnRate: 0,
        width: aabbW, height: aabbH,
        mass,
        inertia,
        parts: bodyParts,
        partIds: partIdSet,
        motorNames,                // filled in below
        hasWheel,
        wheelCount,
        isDefault: false,
        trail: [], trailTick: 0,
        goalReached: false
      });
    }

    // Map motors to bodies (motor config carries partId). For each motor we
    // recompute its body-local lever arm using the body's COM (the build-time
    // offsetX in _motorConfig is relative to the motor-assembly centroid,
    // which only matches the body COM for single-body builds — for multi-body
    // it would be wrong).
    if (_motorConfig && _motorConfig.motors) {
      for (const m of _motorConfig.motors) {
        for (const b of newBodies) {
          if (!b.partIds.has(m.partId)) continue;
          b.motorNames.push(m.name);
          // Find the part record so we can read its build-canvas position
          const partRec = groupsForBody(b).find(pr => pr.p.id === m.partId);
          if (partRec && _motors[m.name]) {
            // Body-local lateral offset (along body's lateral axis = build Y).
            // localX corresponds to build-frame x (motor's "front-back" along
            // the chassis axis); localY corresponds to build-frame y (the
            // lateral axis the legacy motor-config used).
            _motors[m.name]._bodyLocalLateral = partRec.cy - b.y;
            // localY along chassis axis (forward/backward placement) — kept
            // for completeness but unused in current force model.
            _motors[m.name]._bodyLocalLongitudinal = partRec.cx - b.x;
          }
          break;
        }
      }
    }
    function groupsForBody(body) {
      // Reconstructs the partCenters array for a single body from groupParts.
      // Cheap because bodies usually have few parts.
      const result = [];
      for (let i = 0; i < n; i++) {
        const p = placedParts[i];
        if (!body.partIds.has(p.id)) continue;
        const def = (typeof getPartDef === 'function') ? getPartDef(p.type) : null;
        const pw = def ? getEffectiveW(p, def) : 32;
        const ph = def ? getEffectiveH(p, def) : 22;
        result.push({ p, cx: p.position.x + pw / 2, cy: p.position.y + ph / 2 });
      }
      return result;
    }

    // Pick primary body: most wheels, then largest part count.
    let bestIdx = 0, bestScore = -Infinity;
    for (let i = 0; i < newBodies.length; i++) {
      const b = newBodies[i];
      const score = b.wheelCount * 1000 + b.parts.length;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    bodies = newBodies;
    primaryBodyIdx = bestIdx;
  }

  // ── Trail helpers (primary body for legacy callers) ───────────────────────
  function getTrail()   { return bodies[primaryBodyIdx]?.trail || []; }
  function getTrails()  { return bodies.map(b => b.trail); }
  function clearTrail() { for (const b of bodies) { b.trail = []; b.trailTick = 0; } }

  // ── Collision flash ───────────────────────────────────────────────────────
  function getCollisionFlash() { return collisionFlashAt; }

  // ── Motor state ───────────────────────────────────────────────────────────
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
          forwardFactor: m.forwardFactor ?? 1,
          lateralFactor: m.lateralFactor ?? 0,
          offsetX: m.offsetX ?? 0,
          partId: m.partId
        };
      });
    }
    // Rebuild body→motor mapping if bodies already exist
    if (bodies && bodies.length && !bodies[0].isDefault) {
      bodies.forEach(b => { b.motorNames = []; });
      if (config && config.motors) {
        for (const m of config.motors) {
          for (const b of bodies) {
            if (b.partIds && b.partIds.has(m.partId)) { b.motorNames.push(m.name); break; }
          }
        }
      }
    }
  }
  function getMotorConfig() { return _motorConfig; }

  function setMotorSpeed(name, speed) {
    const n = Number(speed);
    if (!isFinite(n)) return;
    const m = _motors[name];
    if (!m) return;
    if (!m.wired) return; // unwired motors get no signal
    m.speed = n;
    if (n !== 0) debugState.movedCalled = true;
  }

  function stopMotor(name)  { if (_motors[name]) _motors[name].speed = 0; }
  function stopAllMotors()  { for (const k in _motors) _motors[k].speed = 0; }
  function hasActiveMotors(){
    for (const k in _motors) if (_motors[k].speed !== 0) return true;
    return false;
  }

  // ── Angle target (frame-rate-independent turns, primary body only) ────────
  let _angleTarget = null;
  let _angleDoneCb = null;
  function setAngleTarget(angle, onDone) {
    _angleTarget = angle;
    _angleDoneCb = onDone || null;
    debugState.turnCount++;
  }
  function clearAngleTarget() { _angleTarget = null; _angleDoneCb = null; }

  function getDebugState()   { return Object.assign({}, debugState); }
  function resetDebugState() { debugState = makeFreshDebug(); }

  function setOnCollision(fn)   { onCollisionCb = fn; }
  function setGoalZone(zone)    { goalZone = zone; goalTriggered = false; for (const b of bodies) b.goalReached = false; }
  function setOnGoalReached(fn) { onGoalReached = fn; }

  // ── Init / reset ──────────────────────────────────────────────────────────
  function init(width, height) {
    arenaW = width;
    arenaH = height;
    resetRobot();
  }

  function resetRobot() {
    // Rebuild bodies from cached placed parts so the connectivity graph is
    // fresh on every run (the spec: "Connectivity graph is computed once at
    // run-start. Resetting recomputes.")
    _buildBodies(_placedParts);
    _placeBodiesAt(arenaW / 2, arenaH / 2, -Math.PI / 2);
    stopAllMotors();
    resetDebugState();
    goalTriggered = false;
  }

  function setStartPosition(x, y, angleDeg) {
    // Rebuild bodies fresh — the user may have changed the build between runs.
    _buildBodies(_placedParts);
    _placeBodiesAt(x, y, (angleDeg || 0) * Math.PI / 180);
    resetDebugState();
    goalTriggered = false;
  }

  // Place all bodies at (x, y) facing `angle`. The primary body anchors
  // exactly at (x, y); other bodies preserve their relative offset from the
  // primary's build-time COM so disconnected drivetrains spawn in their
  // natural relative positions instead of overlapping.
  function _placeBodiesAt(x, y, angle) {
    const primary = bodies[primaryBodyIdx];
    // Build-time COMs are stored on b.x / b.y immediately after _buildBodies.
    const anchorX = primary ? primary.x : 0;
    const anchorY = primary ? primary.y : 0;
    for (const b of bodies) {
      const dx = b.x - anchorX;
      const dy = b.y - anchorY;
      b.x = x + dx;
      b.y = y + dy;
      b.angle = angle;
      b.vx = 0; b.vy = 0; b.omega = 0;
      b.legacyVelocity = 0; b.legacyTurnRate = 0;
      b.trail = []; b.trailTick = 0;
      b.goalReached = false;
    }
  }

  function setObstacles(obs) { obstacles = obs || []; }
  function setOnTick(fn)     { onTickCb = fn; }

  // Cache the parts the user has built. Bodies are rebuilt from this each
  // time setStartPosition / resetRobot is called.
  function setBuildParts(parts) {
    _placedParts = Array.isArray(parts) ? parts : [];
  }

  // ── Accessors ─────────────────────────────────────────────────────────────
  function _primary() { return bodies[primaryBodyIdx] || bodies[0]; }

  function getRobot() {
    // Returns the primary body's pose in legacy { x, y, angle, velocity,
    // turnRate, width, height } shape. Velocity/turnRate are derived for
    // legacy callers (e.g. trail consumers, sensor readings).
    const b = _primary();
    if (!b) return { x: 0, y: 0, angle: 0, velocity: 0, turnRate: 0, width: ROBOT_WIDTH, height: ROBOT_HEIGHT };
    const speed = Math.hypot(b.vx, b.vy);
    return { x: b.x, y: b.y, angle: b.angle, velocity: speed, turnRate: b.omega,
             width: b.width, height: b.height };
  }
  function getState()     { return getRobot(); }
  function getBodies()    { return bodies; }
  function getObstacles() { return obstacles; }
  function getArena()     { return { width: arenaW, height: arenaH }; }
  function isRunning()    { return running; }

  // ── Legacy tank-drive controls (apply to primary body) ────────────────────
  function setVelocity(v) {
    const n = Number(v);
    if (!isFinite(n)) return;
    if (n !== 0) debugState.movedCalled = true;
    const b = _primary();
    if (b) b.legacyVelocity = n;
  }
  function setTurnRate(r) {
    const n = Number(r);
    if (!isFinite(n)) return;
    if (n !== 0) debugState.turnedCalled = true;
    const b = _primary();
    if (b) b.legacyTurnRate = n;
  }

  // ── Physics tick ──────────────────────────────────────────────────────────
  function tick() {
    let anyCollided = false;

    for (let bi = 0; bi < bodies.length; bi++) {
      const b = bodies[bi];
      const isPrimary = (bi === primaryBodyIdx);
      const hw = b.width / 2, hh = b.height / 2;

      // ── Compute forces from motors ────────────────────────────────────────
      let fx = 0, fy = 0, torque = 0;
      const cosA = Math.cos(b.angle);
      const sinA = Math.sin(b.angle);

      if (b.hasWheel && b.motorNames.length > 0) {
        for (const mname of b.motorNames) {
          const m = _motors[mname];
          if (!m || m.speed === 0) continue;
          const effective = m.reversed ? -m.speed : m.speed;
          const forceMag = effective * THRUST_COEFF;
          // Local thrust direction: along the wheel's effective rotation =
          // bodyAngle + partRotation. partRotation is encoded in the motor
          // config as forwardFactor (cos) and lateralFactor (sin) so we can
          // produce sideways thrust when a wheel is rotated 90° in the build
          // tab. Falls back to forward (1, 0) for older configs.
          const ff = (typeof m.forwardFactor === 'number') ? m.forwardFactor : 1;
          const lf = (typeof m.lateralFactor === 'number') ? m.lateralFactor : 0;
          const lfx = forceMag * ff;
          const lfy = forceMag * lf;
          // Lever arm in body-frame. body-local axes:
          //   x_local = build-frame x = chassis longitudinal axis
          //   y_local = build-frame y = chassis lateral axis
          // The build canvas is rendered rotated -90° in the sim, so the
          // body's lateral axis (where motors sit) aligns with build Y.
          // _bodyLocalLateral / _bodyLocalLongitudinal are computed at body
          // construction time from each motor's actual position relative to
          // the body COM (correct for multi-body). Falls back to the legacy
          // motor-config offsetX when the per-body value isn't present.
          const rxLocal = (typeof m._bodyLocalLongitudinal === 'number') ? m._bodyLocalLongitudinal : 0;
          const ryLocal = (typeof m._bodyLocalLateral === 'number')      ? m._bodyLocalLateral      : (m.offsetX || 0);
          // Rotate force + lever arm into world frame
          const wfx = cosA * lfx - sinA * lfy;
          const wfy = sinA * lfx + cosA * lfy;
          const wrx = cosA * rxLocal - sinA * ryLocal;
          const wry = sinA * rxLocal + cosA * ryLocal;
          fx += wfx;
          fy += wfy;
          torque += wrx * wfy - wry * wfx;
        }
      }

      // ── Legacy tank-drive contribution (primary body only) ────────────────
      // setVelocity / setTurnRate emulate a centered thrust + a rotation
      // about the COM. Implemented as a synthesized force/torque so existing
      // lessons that don't use motor blocks still drive.
      if (isPrimary && (b.legacyVelocity !== 0 || b.legacyTurnRate !== 0)) {
        // Forward thrust from legacy velocity: scale to roughly match the
        // legacy "1 px per frame per unit velocity" feel. The damping factor
        // (1 - LINEAR_DAMPING) ≈ 0.14 means terminal speed ≈ accel/0.14, so
        // accel = legacyVelocity * 0.14 keeps terminal speed close to v.
        const drag = 1 - LINEAR_DAMPING;
        const accel = b.legacyVelocity * drag * b.mass; // F = m*a
        fx += cosA * accel;
        fy += sinA * accel;
        // Synthesized torque for legacy turnRate. Same calibration trick:
        // terminal omega = torque / (inertia * (1 - ANGULAR_DAMPING)).
        const adrag = 1 - ANGULAR_DAMPING;
        torque += b.legacyTurnRate * adrag * b.inertia;
        if (b.legacyVelocity !== 0) debugState.movedCalled = true;
      }

      // ── Integrate ─────────────────────────────────────────────────────────
      const ax = fx / b.mass;
      const ay = fy / b.mass;
      const aa = torque / b.inertia;
      b.vx += ax;
      b.vy += ay;
      b.omega += aa;

      const prevX = b.x, prevY = b.y;
      let nx = b.x + b.vx;
      let ny = b.y + b.vy;
      let nAngle = b.angle + b.omega;

      if (b.omega !== 0) debugState.actuallyTurned = true;

      // Angle-target snap (primary body only — legacy turn-to-angle behaviour)
      if (isPrimary && _angleTarget !== null) {
        const rate = b.omega;
        const close = rate === 0
          ? Math.abs(nAngle - _angleTarget) < ANGLE_SNAP_EPSILON
          : Math.abs(nAngle - _angleTarget) < Math.abs(rate) + ANGLE_SNAP_EPSILON;
        const overshoot = rate > 0 ? (nAngle >= _angleTarget) : (rate < 0 ? (nAngle <= _angleTarget) : false);
        if (close || overshoot) {
          nAngle = _angleTarget;
          b.omega = 0;
          // Also kill legacy turn rate so it doesn't keep injecting torque
          b.legacyTurnRate = 0;
          const cb = _angleDoneCb;
          _angleTarget = null;
          _angleDoneCb = null;
          if (cb) cb();
        }
      }

      // Arena boundary clamp
      nx = Math.max(hw, Math.min(arenaW - hw, nx));
      ny = Math.max(hh, Math.min(arenaH - hh, ny));

      let collided = false;
      // AABB collision vs obstacles
      for (const obs of obstacles) {
        if (aabbOverlap(nx - hw, ny - hh, b.width, b.height,
                        obs.x, obs.y, obs.width, obs.height)) {
          nx = prevX; ny = prevY;
          b.vx = 0; b.vy = 0;
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

      b.x = nx; b.y = ny; b.angle = nAngle;

      // Damping (applied after integration so terminal velocity is bounded)
      b.vx *= LINEAR_DAMPING;
      b.vy *= LINEAR_DAMPING;
      b.omega *= ANGULAR_DAMPING;

      // Trail
      b.trailTick++;
      if (b.trailTick % TRAIL_SAMPLE_RATE === 0) {
        b.trail.push({ x: b.x, y: b.y, tick: b.trailTick });
        if (b.trail.length > TRAIL_MAX_POINTS) b.trail.shift();
      }

      if (Math.abs(b.x - prevX) > MOVE_THRESHOLD || Math.abs(b.y - prevY) > MOVE_THRESHOLD) {
        if (isPrimary) {
          debugState.actuallyMoved = true;
          debugState.distanceTraveled += Math.hypot(b.x - prevX, b.y - prevY);
        }
      }

      if (collided) {
        anyCollided = true;
        if (isPrimary && onCollisionCb) onCollisionCb({ x: b.x, y: b.y, angle: b.angle, width: b.width, height: b.height });
      }

      // Goal zone — fires once when ANY wheeled body enters
      if (goalZone && !goalTriggered && b.hasWheel && !b.goalReached) {
        if (b.x >= goalZone.x && b.x <= goalZone.x + goalZone.width &&
            b.y >= goalZone.y && b.y <= goalZone.y + goalZone.height) {
          b.goalReached = true;
          goalTriggered = true;
          if (onGoalReached) onGoalReached();
        }
      }
    }

    if (anyCollided) collisionFlashAt = Date.now();

    if (onTickCb) onTickCb(getRobot());
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
    setBuildParts,
    getRobot, getState, getObstacles, getArena, isRunning,
    getBodies,
    setVelocity, setTurnRate,
    startLoop, stopLoop, tick,
    getTrail, getTrails, clearTrail,
    getCollisionFlash,
    getDebugState, resetDebugState,
    setGoalZone, setOnGoalReached,
    setOnCollision,
    setAngleTarget, clearAngleTarget,
    setMotorConfig, getMotorConfig, setMotorSpeed, stopMotor, stopAllMotors, hasActiveMotors
  };
})();
