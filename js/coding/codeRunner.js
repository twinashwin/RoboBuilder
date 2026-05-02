// Code Runner – bridges Blockly-generated JS to the simulation engine.
// Uses AbortController for clean cancellation when Stop/Reset is clicked.

window._simSpeedMultiplier = 1;

const CodeRunner = (() => {
  let running   = false;
  let abortCtrl = null;
  let runStartMs = 0;
  let _stepMode    = false;
  let _stepResolve = null;

  // ── Motor class ───────────────────────────────────────────────────────────
  // Represents a single physical motor on the robot. Spinning a motor propels
  // the robot based on the motor's position (offsetX) and orientation
  // (forwardFactor) — movement is entirely physics-driven.

  class Motor {
    constructor(name, signal, sleep, stats) {
      this._name      = name;
      this._signal    = signal;
      this._sleep     = sleep;
      this._stats     = stats;
      this._baseSpeed = 5;
    }

    get name() { return this._name; }

    // Set the default speed used when spin() is called without an argument.
    setSpeed(speed) {
      this._baseSpeed = Math.max(0, Math.min(10, Number(speed) || 5));
    }

    // Spin continuously. Fire-and-forget — sets motor speed and returns instantly.
    // The robot's resulting movement depends on where the motor is placed and
    // how it is oriented — the physics engine handles everything.
    // Never throws; abort is handled at the next await checkpoint elsewhere.
    spin(speed) {
      const s = speed !== undefined
        ? Math.max(-10, Math.min(10, Number(speed) || 0))
        : this._baseSpeed;
      SimEngine.setMotorSpeed(this._name, s);
      this._stats.moved = true;
    }

    // Spin for a set duration, then stop.
    async spinFor(speed, duration) {
      if (this._signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const s = speed !== undefined
        ? Math.max(-10, Math.min(10, Number(speed) || 0))
        : this._baseSpeed;
      SimEngine.setMotorSpeed(this._name, s);
      this._stats.moved = true;
      try {
        await this._sleep((Number(duration) || 1) * 1000);
      } finally {
        SimEngine.stopMotor(this._name);
      }
    }

    stop() {
      SimEngine.stopMotor(this._name);
    }
  }

  // ── Robot API (injected into generated code) ──────────────────────────────

  function makeRobotAPI(signal, stats) {
    let _baseSpeed = 5;
    let _loopIterations = 0;
    let _lastSignificantSleep = Date.now();

    function sleep(ms) {
      // Reset iteration counter on meaningful pauses (drives, waits — not tick/highlight)
      if (ms > 16) { _loopIterations = 0; _lastSignificantSleep = Date.now(); }
      const effectiveMs = ms > 16 ? Math.max(1, ms / (window._simSpeedMultiplier || 1)) : ms;
      return new Promise((resolve, reject) => {
        const id = setTimeout(resolve, effectiveMs);
        signal.addEventListener('abort', () => {
          clearTimeout(id);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }

    function checkAbort() {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    }

    // Build Motor instances from current motor config
    const _motorInstances = {};
    const _motorCfg = SimEngine.getMotorConfig();
    if (_motorCfg && _motorCfg.motors) {
      _motorCfg.motors.forEach(m => {
        const mot = new Motor(m.name, signal, sleep, stats);
        _motorInstances[m.name] = mot;
        if (m.label) _motorInstances[m.label] = mot; // also index by custom label
      });
    }

    return {
      // ── Motor access ─────────────────────────────────────────────────────

      // Returns the Motor instance for the given name or label.
      // Returns a no-op motor if not found, so code doesn't crash.
      motor(nameOrLabel) {
        return _motorInstances[nameOrLabel] || {
          spin() {}, async spinFor() {}, stop() {}, setSpeed() {}, name: nameOrLabel
        };
      },

      get motors() { return Object.assign({}, _motorInstances); },

      // ── Stop ─────────────────────────────────────────────────────────────

      stopMotors() {
        SimEngine.setVelocity(0);
        SimEngine.setTurnRate(0);
        SimEngine.clearAngleTarget();
        SimEngine.stopAllMotors();
      },

      stop() {
        SimEngine.setVelocity(0);
        SimEngine.setTurnRate(0);
        SimEngine.clearAngleTarget();
        SimEngine.stopAllMotors();
      },

      stopAllMotorsNow() {
        SimEngine.stopAllMotors();
      },

      setSpeed(v) {
        _baseSpeed = Math.max(0.5, Math.min(15, Number(v) || 5));
      },

      // ── Control ──────────────────────────────────────────────────────────

      async wait(secs) {
        checkAbort();
        await sleep((Number(secs) || 1) * 1000);
      },

      async tick() {
        checkAbort();
        _loopIterations++;
        if (_loopIterations > 10000 && (Date.now() - _lastSignificantSleep) < 2000) {
          throw new Error('Loop ran 10,000+ iterations without pausing. Add a Wait or Spin Motor block inside your loop.');
        }
        await sleep(16);
      },

      stopAll() {
        throw new DOMException('Aborted', 'AbortError');
      },

      // ── Sensors ──────────────────────────────────────────────────────────

      getDistance() {
        const r = SimEngine.getRobot();
        return SensorSystem.getDistance(r, SimEngine.getObstacles(), SimEngine.getArena());
      },

      isPathClear(threshold) {
        const thresh = Number(threshold) || 50;
        return this.getDistance() > thresh;
      },

      isTouchingWall() {
        const r = SimEngine.getRobot();
        const a = SimEngine.getArena();
        const hw = r.width / 2, hh = r.height / 2;
        return r.x - hw <= 2 || r.x + hw >= a.width - 2 ||
               r.y - hh <= 2 || r.y + hh >= a.height - 2;
      },

      getX() { return Math.round(SimEngine.getRobot().x); },
      getY() { return Math.round(SimEngine.getArena().height - SimEngine.getRobot().y); },
      getAngle() {
        const deg = SimEngine.getRobot().angle * 180 / Math.PI;
        // Compass bearing: 0=up, 90=right, 180=down, 270=left
        return Math.round(((deg + 90) % 360 + 360) % 360);
      },

      getTimer() {
        return (Date.now() - runStartMs) / 1000;
      },

      // ── Output ───────────────────────────────────────────────────────────

      say(msg) {
        const el = document.getElementById('sim-status');
        if (el) el.textContent = String(msg);
        window._simStatus = String(msg);
        if (window._robotLog) window._robotLog('💬 ' + String(msg), 'say');
      },

      setLED(color) {
        const led = document.getElementById('sim-led');
        if (!led) return;
        led.className = 'sim-led';
        const c = String(color).toLowerCase();
        if (c === 'off' || c === 'none' || c === '') {
          led.style.removeProperty('--led-color');
          led.classList.add('led-off');
        } else {
          const colorMap = {
            red: '#ef4444', green: '#10b981', blue: '#3b82f6',
            yellow: '#f59e0b', cyan: '#06b6d4', pink: '#ec4899',
            purple: '#a855f7', white: '#f1f5f9', orange: '#f97316'
          };
          const hex = colorMap[c] || c;
          led.style.setProperty('--led-color', hex);
          led.classList.add('led-on');
        }
      },

      playBeep(freq, dur) {
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = Number(freq) || 440;
          osc.type = 'square';
          const d = Number(dur) || 0.2;
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + d);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + d);
          osc.onended = () => { ctx.close(); };
        } catch (e) { /* audio not available */ }
      },

      // ── Debug ────────────────────────────────────────────────────────────

      async highlightBlock(id) {
        if (window._blocklyWorkspace) {
          window._blocklyWorkspace.highlightBlock(id);
        }
        if (_stepMode) {
          await new Promise((resolve, reject) => {
            _stepResolve = resolve;
            signal.addEventListener('abort', () => {
              _stepResolve = null;
              reject(new DOMException('Aborted', 'AbortError'));
            }, { once: true });
          });
          _stepResolve = null;
        } else {
          await sleep(0);
        }
        checkAbort();
      }
    };
  }

  // ── Step mode API ─────────────────────────────────────────────────────────

  function setStepMode(on) {
    _stepMode = on;
    if (!on && _stepResolve) { _stepResolve(); _stepResolve = null; }
  }
  function step() { if (_stepResolve) { _stepResolve(); _stepResolve = null; } }
  function isStepMode() { return _stepMode; }

  // ── Public API ────────────────────────────────────────────────────────────

  async function run(code, statusEl) {
    if (running) return;
    if (!code || !code.trim()) {
      if (statusEl) statusEl.textContent = 'No blocks to run.';
      return;
    }

    running    = true;
    abortCtrl  = new AbortController();
    runStartMs = Date.now();

    const stats = { moved: false, turned: false };
    SimEngine.resetDebugState && SimEngine.resetDebugState();
    SimEngine.stopAllMotors();
    SimEngine.setVelocity(0);
    SimEngine.setTurnRate(0);

    SimEngine.startLoop();
    if (statusEl) statusEl.textContent = 'Running…';

    try {
      const robot = makeRobotAPI(abortCtrl.signal, stats);
      let fn;
      try {
        fn = new Function('robot', `return (async () => {\n${code}\n})()`);
      } catch (syntaxErr) {
        if (statusEl) statusEl.textContent = 'Syntax error: ' + syntaxErr.message;
        running = false;
        SimEngine.stopLoop();
        return;
      }
      await fn(robot);

      const debug = SimEngine.getDebugState ? SimEngine.getDebugState() : null;
      const elapsed = Date.now() - runStartMs;

      let msg = 'Done.';
      if (debug) {
        if (debug.movedCalled && !debug.actuallyMoved && elapsed > 50) {
          msg = "Done. (Tip: robot didn't move — try higher speed or longer duration)";
        } else if (debug.distanceTraveled > 0 || debug.turnCount > 0) {
          const distPx = Math.round(debug.distanceTraveled);
          const turns  = debug.turnCount;
          const parts  = [];
          if (distPx > 0) parts.push(`${distPx}px traveled`);
          if (turns  > 0) parts.push(`${turns} turn${turns !== 1 ? 's' : ''}`);
          msg = 'Done — ' + parts.join(', ');
        }
      }
      const motorsStillActive = SimEngine.hasActiveMotors ? SimEngine.hasActiveMotors() : false;
      if (motorsStillActive) msg = 'Motors running — press Stop to halt.';
      if (statusEl) statusEl.textContent = msg;
      if (window._robotLog && msg !== 'Done.') window._robotLog('🤖 ' + msg, 'info');

    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('[CodeRunner]', err);
        if (statusEl) statusEl.textContent = 'Error: ' + err.message;
      } else {
        if (statusEl) statusEl.textContent = 'Stopped.';
      }
    } finally {
      const aborted = abortCtrl && abortCtrl.signal.aborted;
      const motorsActive = SimEngine.hasActiveMotors ? SimEngine.hasActiveMotors() : false;
      if (aborted || !motorsActive) {
        SimEngine.stopLoop();
        SimEngine.setVelocity(0);
        SimEngine.setTurnRate(0);
        SimEngine.stopAllMotors();
      }
      if (window._blocklyWorkspace) {
        window._blocklyWorkspace.highlightBlock(null);
      }
      SimCanvas.redraw();
      running = false;
      _stepMode = false;
      _stepResolve = null;
    }
  }

  function stop() {
    if (abortCtrl) abortCtrl.abort();
    SimEngine.stopLoop();
    SimEngine.setVelocity(0);
    SimEngine.setTurnRate(0);
    SimEngine.stopAllMotors();
    SimCanvas.redraw();
  }

  function isRunning() { return running; }
  function getRunStartMs() { return runStartMs; }

  return { run, stop, isRunning, setStepMode, step, isStepMode, getRunStartMs };
})();
