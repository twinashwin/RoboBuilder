// ════════════════════════════════════════════════════════════════
// blockDefs.js — Scratch-inspired block library for RoboBuilder
// Call registerBlocks() before Blockly.inject().
// ════════════════════════════════════════════════════════════════

function registerBlocks() {

  Blockly.JavaScript.INFINITE_LOOP_TRAP = 'await robot.tick();\n';

  // ── Helpers ───────────────────────────────────────────────────
  const V = (block, name, order) =>
    Blockly.JavaScript.valueToCode(block, name, order || Blockly.JavaScript.ORDER_ATOMIC) || null;

  // ════════════════════════════════════════════════════════════════
  // EVENTS CATEGORY  (#FFD500)
  // ════════════════════════════════════════════════════════════════

  Blockly.Blocks['when_program_starts'] = {
    init() {
      this.appendDummyInput()
          .appendField('▶  when program starts');
      this.appendStatementInput('DO').setCheck(null);
      this.setColour('#FFBF00');
      this.setTooltip('Blocks inside here run when you press Run.');
      this.setDeletable(false);
      this.setMovable(true);
    }
  };
  Blockly.JavaScript['when_program_starts'] = block => {
    const body = Blockly.JavaScript.statementToCode(block, 'DO');
    return body;   // extracted by extractCode() — not used by workspaceToCode
  };

  // ════════════════════════════════════════════════════════════════
  // MOTOR CATEGORY  (#8B5CF6)  — physical motor control
  // Movement emerges from motor position + orientation (physics-driven).
  // ════════════════════════════════════════════════════════════════

  function _motorDropdown() {
    const config = window._robotMotorConfig;
    if (config && config.motors && config.motors.length > 0) {
      return config.motors.map(m => [m.label, m.name]);
    }
    return [['Motor A', 'A'], ['Motor B', 'B']];
  }

  // Block 1: Spin Motor (continuous)
  Blockly.Blocks['motor_spin'] = {
    init() {
      this.appendDummyInput()
          .appendField('spin')
          .appendField(new Blockly.FieldDropdown(_motorDropdown), 'MOTOR');
      this.appendValueInput('SPEED').setCheck('Number')
          .appendField('power');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Spin a motor continuously. Positive = forward, negative = reverse. The robot moves based on the motor\'s position and orientation.');
    }
  };
  Blockly.JavaScript['motor_spin'] = b => {
    const m = b.getFieldValue('MOTOR');
    const s = V(b, 'SPEED') || '5';
    return `robot.motor('${m}').spin(${s});\n`;
  };

  // Block 2: Spin Motor For (timed)
  Blockly.Blocks['motor_spin_for'] = {
    init() {
      this.appendDummyInput()
          .appendField('spin')
          .appendField(new Blockly.FieldDropdown(_motorDropdown), 'MOTOR');
      this.appendValueInput('SPEED').setCheck('Number')
          .appendField('power');
      this.appendDummyInput().appendField('for');
      this.appendValueInput('DURATION').setCheck('Number');
      this.appendDummyInput()
          .appendField('sec')
          .appendField(new Blockly.FieldDropdown([
            ['then continue', 'CONTINUE'],
            ['then wait',     'WAIT'],
          ]), 'MODE');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip(
        '"then continue" — motor starts and the next block runs immediately (fire-and-forget).\n' +
        '"then wait" — program pauses until the motor finishes spinning.'
      );
    }
  };
  Blockly.JavaScript['motor_spin_for'] = b => {
    const m = b.getFieldValue('MOTOR');
    const s = V(b, 'SPEED') || '5';
    const d = V(b, 'DURATION') || '1';
    const mode = b.getFieldValue('MODE') || 'CONTINUE';
    if (mode === 'WAIT') {
      return `await robot.motor('${m}').spinFor(${s}, ${d});\n`;
    }
    // Fire-and-forget: motor runs in parallel; .catch(()=>{}) silences AbortError on Stop.
    return `robot.motor('${m}').spinFor(${s}, ${d}).catch(()=>{});\n`;
  };

  // Block 3: Stop Motor
  Blockly.Blocks['motor_stop'] = {
    init() {
      this.appendDummyInput()
          .appendField('stop')
          .appendField(new Blockly.FieldDropdown(_motorDropdown), 'MOTOR');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Stop a single motor.');
    }
  };
  Blockly.JavaScript['motor_stop'] = b => {
    const m = b.getFieldValue('MOTOR');
    return `robot.motor('${m}').stop();\n`;
  };

  // Block 4: Set Motor Speed
  Blockly.Blocks['motor_set_speed'] = {
    init() {
      this.appendDummyInput()
          .appendField('set')
          .appendField(new Blockly.FieldDropdown(_motorDropdown), 'MOTOR');
      this.appendValueInput('SPEED').setCheck('Number')
          .appendField('speed to');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Set the base speed for a motor. Use Spin Motor (without power) to spin at this speed.');
    }
  };
  Blockly.JavaScript['motor_set_speed'] = b => {
    const m = b.getFieldValue('MOTOR');
    const s = V(b, 'SPEED') || '5';
    return `robot.motor('${m}').setSpeed(${s});\n`;
  };

  // Stop all motors (kept as a utility block)
  Blockly.Blocks['stop_all_motors'] = {
    init() {
      this.appendDummyInput().appendField('⏹ stop all motors');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#4C97FF');
      this.setTooltip('Stop all motors immediately.');
    }
  };
  Blockly.JavaScript['stop_all_motors'] = () => `robot.stopAllMotorsNow();\n`;

  // ════════════════════════════════════════════════════════════════
  // CONTROL CATEGORY  (#F59E0B)
  // ════════════════════════════════════════════════════════════════

  Blockly.Blocks['wait_seconds'] = {
    init() {
      this.appendValueInput('SECS').setCheck('Number')
          .appendField('wait');
      this.appendDummyInput().appendField('seconds');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Pause execution for N seconds.');
    }
  };
  Blockly.JavaScript['wait_seconds'] = b => {
    const s = V(b,'SECS') || '1';
    return `await robot.wait(${s});\n`;
  };

  Blockly.Blocks['forever_loop'] = {
    init() {
      this.appendDummyInput().appendField('forever');
      this.appendStatementInput('DO').setCheck(null);
      this.setPreviousStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Repeat the blocks inside forever. Use Stop to end.');
    }
  };
  Blockly.JavaScript['forever_loop'] = b => {
    const body = Blockly.JavaScript.statementToCode(b, 'DO') || '  await robot.tick();\n';
    return `while(true) {\n${body}  await robot.tick();\n}\n`;
  };

  Blockly.Blocks['while_loop'] = {
    init() {
      this.appendValueInput('COND').setCheck('Boolean')
          .appendField('while');
      this.appendStatementInput('DO').setCheck(null).appendField('do');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Repeat the blocks inside as long as the condition is true.');
    }
  };
  Blockly.JavaScript['while_loop'] = b => {
    const cond = V(b, 'COND') || 'false';
    const body = Blockly.JavaScript.statementToCode(b, 'DO') || '  await robot.tick();\n';
    return `while(${cond}) {\n${body}  await robot.tick();\n}\n`;
  };

  Blockly.Blocks['stop_all'] = {
    init() {
      this.appendDummyInput().appendField('stop all');
      this.setPreviousStatement(true, null);
      this.setColour('#FFAB19');
      this.setTooltip('Stop program execution immediately.');
    }
  };
  Blockly.JavaScript['stop_all'] = () => `robot.stopAll();\nreturn;\n`;

  // ════════════════════════════════════════════════════════════════
  // SENSORS CATEGORY  (#10B981)
  // ════════════════════════════════════════════════════════════════

  Blockly.Blocks['get_distance'] = {
    init() {
      this.appendDummyInput().appendField('distance ahead');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Returns pixels to the nearest obstacle directly ahead.');
    }
  };
  Blockly.JavaScript['get_distance'] = () =>
    ['robot.getDistance()', Blockly.JavaScript.ORDER_FUNCTION_CALL];

  Blockly.Blocks['is_path_clear'] = {
    init() {
      this.appendValueInput('THRESHOLD').setCheck('Number')
          .appendField('path clear? ( distance >');
      this.appendDummyInput().appendField(')');
      this.setInputsInline(true);
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('True if nothing within the threshold distance ahead.');
    }
  };
  Blockly.JavaScript['is_path_clear'] = b => {
    const t = V(b,'THRESHOLD') || '40';
    return [`(robot.getDistance() > ${t})`, Blockly.JavaScript.ORDER_RELATIONAL];
  };

  Blockly.Blocks['touching_wall'] = {
    init() {
      this.appendDummyInput().appendField('touching wall?');
      this.setOutput(true, 'Boolean');
      this.setColour('#5CB1D6');
      this.setTooltip('True if the robot is touching the arena border.');
    }
  };
  Blockly.JavaScript['touching_wall'] = () =>
    ['robot.isTouchingWall()', Blockly.JavaScript.ORDER_FUNCTION_CALL];

  Blockly.Blocks['robot_x'] = {
    init() {
      this.appendDummyInput().appendField('robot x');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('The robot\'s current x position in the arena.');
    }
  };
  Blockly.JavaScript['robot_x'] = () =>
    ['robot.getX()', Blockly.JavaScript.ORDER_FUNCTION_CALL];

  Blockly.Blocks['robot_y'] = {
    init() {
      this.appendDummyInput().appendField('robot y');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('The robot\'s current y position in the arena.');
    }
  };
  Blockly.JavaScript['robot_y'] = () =>
    ['robot.getY()', Blockly.JavaScript.ORDER_FUNCTION_CALL];

  Blockly.Blocks['robot_angle'] = {
    init() {
      this.appendDummyInput().appendField('robot direction (°)');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('The robot\'s current heading in degrees (0 = up, 90 = right, 180 = down, 270 = left).');
    }
  };
  Blockly.JavaScript['robot_angle'] = () =>
    ['robot.getAngle()', Blockly.JavaScript.ORDER_FUNCTION_CALL];

  Blockly.Blocks['get_timer'] = {
    init() {
      this.appendDummyInput().appendField('timer (sec)');
      this.setOutput(true, 'Number');
      this.setColour('#5CB1D6');
      this.setTooltip('Seconds elapsed since the program started running.');
    }
  };
  Blockly.JavaScript['get_timer'] = () =>
    ['robot.getTimer()', Blockly.JavaScript.ORDER_FUNCTION_CALL];

  // ════════════════════════════════════════════════════════════════
  // OPERATORS CATEGORY  (#A855F7) — all built-in Blockly blocks
  // (defined in getToolbox toolbox config below)
  // ════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════
  // OUTPUT CATEGORY  (#EC4899)
  // ════════════════════════════════════════════════════════════════

  Blockly.Blocks['say_message'] = {
    init() {
      this.appendValueInput('MSG').appendField('say');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Display a message in the status bar.');
    }
  };
  Blockly.JavaScript['say_message'] = b => {
    const m = V(b,'MSG') || `''`;
    return `robot.say(${m});\n`;
  };

  Blockly.Blocks['play_beep'] = {
    init() {
      this.appendValueInput('FREQ').setCheck('Number')
          .appendField('play beep  freq:');
      this.appendDummyInput().appendField('Hz for');
      this.appendValueInput('DUR').setCheck('Number');
      this.appendDummyInput().appendField('sec');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Play a tone at the given frequency for N seconds.');
    }
  };
  Blockly.JavaScript['play_beep'] = b => {
    const f = V(b,'FREQ') || '440';
    const d = V(b,'DUR')  || '0.2';
    return `await robot.playBeep(${f}, ${d});\n`;
  };

  Blockly.Blocks['set_led'] = {
    init() {
      this.appendDummyInput()
          .appendField('set LED to')
          .appendField(new Blockly.FieldDropdown([
            ['🔴 red',    'red'],
            ['🟢 green',  'green'],
            ['🔵 blue',   'blue'],
            ['🟡 yellow', 'yellow'],
            ['⚪ white',  'white'],
            ['⚫ off',    'off'],
          ]), 'COLOR');
      this.setInputsInline(true);
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#CF63CF');
      this.setTooltip('Change the robot LED color.');
    }
  };
  Blockly.JavaScript['set_led'] = b => {
    const c = b.getFieldValue('COLOR');
    return `robot.setLED('${c}');\n`;
  };

  // ════════════════════════════════════════════════════════════════
  // FUNCTIONS  (#7C3AED)
  // Custom func_define / func_call blocks with inline name + param fields.
  // ════════════════════════════════════════════════════════════════

  const _PLUS_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><circle cx="9" cy="9" r="8.5" fill="rgba(255,255,255,0.22)"/><path d="M9 4.5v9M4.5 9h9" stroke="white" stroke-width="2.2" stroke-linecap="round"/></svg>'
  );
  const _MINUS_SVG = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="7.5" fill="rgba(255,255,255,0.22)"/><path d="M4 8h8" stroke="white" stroke-width="2" stroke-linecap="round"/></svg>'
  );

  // Helper: build a dynamic oval SVG label showing the param name.
  // Used as the clickable "drag me" handle on each param row.
  function _paramOvalSVG(name) {
    const safe = String(name).replace(/[<>&"]/g, c =>
      ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    const w = Math.max(52, safe.length * 8.5 + 24);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="26">` +
      `<rect x="1" y="1" width="${w-2}" height="24" rx="12" fill="rgba(255,255,255,0.88)" stroke="rgba(255,255,255,0.7)" stroke-width="1.5"/>` +
      `<text x="${w/2}" y="17.5" text-anchor="middle" font-family="sans-serif" font-size="13" font-weight="500" fill="#1a1a1a">${safe}</text>` +
      `</svg>`
    );
  }

  // ── func_define ─────────────────────────────────────────────────
  Blockly.Blocks['func_define'] = {
    init() {
      this.paramIds_    = [];
      this.paramNames_  = {};  // id → name string (source of truth, no field needed)
      this.appendDummyInput('TITLE')
          .appendField('define')
          .appendField(new Blockly.FieldTextInput('myFunction'), 'FUNC_NAME')
          .appendField(new Blockly.FieldImage(_PLUS_SVG, 20, 20, '+', this.addParam_.bind(this)));
      this.appendStatementInput('BODY').setCheck(null);
      this.setColour('#FF6680');
      this.setTooltip(
        'Define a function.\n' +
        '• Click + to add a parameter.\n' +
        '• Click a parameter oval once to place a reporter block in the workspace.\n' +
        '• Double-click a parameter oval to rename it.'
      );
      this.setDeletable(true);
      this.setMovable(true);
    },

    // Build one param row.  Shared by addParam_ and domToMutation.
    _buildParamRow_(id, name) {
      this.paramNames_[id] = name;
      let lastClickTime = 0;

      const ovalW = Math.max(52, name.length * 8.5 + 24);
      this.appendDummyInput('PARAM_ROW_' + id)
          .appendField(
            new Blockly.FieldImage(
              _paramOvalSVG(name), ovalW, 26, name,
              () => {
                const now = Date.now();
                if (now - lastClickTime < 350) {
                  // Double-click → rename via prompt
                  const newName = window.prompt('Rename parameter:', this.paramNames_[id] || '');
                  if (newName !== null && newName.trim()) {
                    this.paramNames_[id] = newName.trim();
                    this._refreshOval_(id);
                  }
                } else {
                  // Single-click → drop a reporter into the workspace
                  this._dropReporter_(id);
                }
                lastClickTime = now;
              }
            ),
            'PARAM_OVAL_' + id
          )
          .appendField(
            new Blockly.FieldImage(_MINUS_SVG, 18, 18, '×', () => this.removeParam_(id))
          );
    },

    // Re-render the oval image after a rename
    _refreshOval_(id) {
      const name  = this.paramNames_[id] || 'param';
      const field = this.getField('PARAM_OVAL_' + id);
      if (!field) return;
      const w = Math.max(52, name.length * 8.5 + 24);
      field.src_         = _paramOvalSVG(name);
      field.imageWidth_  = w;
      field.imageHeight_ = 26;
      if (this.rendered) this.render();
    },

    // Place a func_get_param reporter block to the right of this block
    _dropReporter_(id) {
      const name = this.paramNames_[id] || 'param';
      const ws   = this.workspace;
      if (!ws) return;
      const nb = ws.newBlock('func_get_param');
      nb.setFieldValue(name, 'PARAM_NAME');
      nb.initSvg();
      nb.render();
      const xy = this.getRelativeToSurfaceXY();
      nb.moveBy(xy.x + (this.width || 180) + 30, xy.y);
    },

    addParam_() {
      const id   = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      this.paramIds_.push(id);
      this._buildParamRow_(id, 'param' + this.paramIds_.length);
      this.moveInputBefore('PARAM_ROW_' + id, 'BODY');
      if (this.rendered) this.render();
    },

    removeParam_(id) {
      this.removeInput('PARAM_ROW_' + id, true);
      this.paramIds_ = this.paramIds_.filter(p => p !== id);
      delete this.paramNames_[id];
      if (this.rendered) this.render();
    },

    getParamNames() {
      return this.paramIds_.map((id, i) => this.paramNames_[id] || ('param' + (i + 1)));
    },

    mutationToDom() {
      const el = document.createElement('mutation');
      el.setAttribute('paramids', JSON.stringify(this.paramIds_));
      el.setAttribute('params',   JSON.stringify(this.getParamNames()));
      return el;
    },

    domToMutation(xmlEl) {
      let ids = [], names = [];
      try { ids   = JSON.parse(xmlEl.getAttribute('paramids') || '[]'); } catch(e) {}
      try { names = JSON.parse(xmlEl.getAttribute('params')   || '[]'); } catch(e) {}
      ids.forEach((id, i) => {
        this.paramIds_.push(id);
        this._buildParamRow_(id, names[i] || ('param' + (i + 1)));
        this.moveInputBefore('PARAM_ROW_' + id, 'BODY');
      });
    }
  };

  Blockly.JavaScript['func_define'] = function(block, generator) {
    const gen      = generator || Blockly.JavaScript;
    const rawName  = (block.getFieldValue('FUNC_NAME') || 'myFunction').trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9_$]/g, '_') || 'myFunction';
    const params   = block.getParamNames().map(p => p.replace(/[^a-zA-Z0-9_$]/g, '_'));
    const body     = gen.statementToCode(block, 'BODY');
    // Return the function declaration directly — async function declarations
    // are hoisted, so the order relative to calls doesn't matter.
    return `async function ${safeName}(${params.join(', ')}) {\n${body}}\n`;
  };

  // ── func_call ────────────────────────────────────────────────────
  Blockly.Blocks['func_call'] = {
    init() {
      this.paramNames_ = [];
      this.appendDummyInput('TITLE')
          .appendField('call')
          .appendField(new Blockly.FieldTextInput('myFunction'), 'FUNC_NAME');
      this.setPreviousStatement(true, null);
      this.setNextStatement(true, null);
      this.setColour('#FF6680');
      this.setTooltip('Call a function.');
    },

    updateParams_(names) {
      let i = 0;
      while (this.getInput('ARG_' + i)) this.removeInput('ARG_' + i++);
      names.forEach((name, j) => {
        this.appendValueInput('ARG_' + j)
            .setCheck(null)
            .appendField((name || ('param' + (j + 1))) + ':');
      });
      this.paramNames_ = [...names];
      if (this.rendered) this.render();
    },

    mutationToDom() {
      const el = document.createElement('mutation');
      this.paramNames_.forEach(n => {
        const arg = document.createElement('arg');
        arg.setAttribute('name', n);
        el.appendChild(arg);
      });
      return el;
    },

    domToMutation(xmlEl) {
      const names = [];
      Array.from(xmlEl.childNodes).forEach(child => {
        if (child.nodeName.toLowerCase() === 'arg')
          names.push(child.getAttribute('name') || 'param');
      });
      this.updateParams_(names);
    }
  };

  Blockly.JavaScript['func_call'] = function(block, generator) {
    const gen      = generator || Blockly.JavaScript;
    const rawName  = (block.getFieldValue('FUNC_NAME') || 'myFunction').trim();
    const safeName = rawName.replace(/[^a-zA-Z0-9_$]/g, '_') || 'myFunction';
    const args     = block.paramNames_.map((_, i) => {
      const code = gen.valueToCode(block, 'ARG_' + i, Blockly.JavaScript.ORDER_COMMA);
      if (!code) return 'null';
      // If the shadow text block produced a quoted string that looks like a
      // number (e.g. "42"), unwrap it so the function receives a number.
      const strMatch = code.match(/^'(.*)'$/) || code.match(/^"(.*)"$/);
      if (strMatch && !isNaN(strMatch[1]) && strMatch[1].trim() !== '') {
        return strMatch[1];
      }
      return code;
    });
    return `await ${safeName}(${args.join(', ')});\n`;
  };

  // ── func_get_param ───────────────────────────────────────────────
  // Value block that reads a function parameter inside a func_define body.
  // The dropdown is populated dynamically from all func_define blocks in
  // the workspace so it always reflects current parameter names.
  Blockly.Blocks['func_get_param'] = {
    init() {
      this.appendDummyInput()
          .appendField('param')
          .appendField(new Blockly.FieldDropdown(() => {
            const ws = window._blocklyWorkspace;
            const names = new Set();
            if (ws) {
              ws.getBlocksByType('func_define', false).forEach(b => {
                if (b.getParamNames) b.getParamNames().forEach(n => { if (n) names.add(n); });
              });
            }
            const opts = Array.from(names).map(n => [n, n]);
            return opts.length > 0 ? opts : [['param1', 'param1']];
          }), 'PARAM_NAME');
      this.setOutput(true, null);
      this.setColour('#FF6680');
      this.setTooltip('Get the value of a function parameter. Only works inside a function body.');
    }
  };

  Blockly.JavaScript['func_get_param'] = function(block) {
    const name     = (block.getFieldValue('PARAM_NAME') || 'param').trim();
    const safeName = name.replace(/[^a-zA-Z0-9_$]/g, '_') || 'param';
    return [safeName, Blockly.JavaScript.ORDER_ATOMIC];
  };

  // Register custom function generators in forBlock (Blockly v9 canonical path)
  // as well as the legacy direct-property path already set above.
  if (Blockly.JavaScript.forBlock) {
    Blockly.JavaScript.forBlock['func_define']    = Blockly.JavaScript['func_define'];
    Blockly.JavaScript.forBlock['func_call']      = Blockly.JavaScript['func_call'];
    Blockly.JavaScript.forBlock['func_get_param'] = Blockly.JavaScript['func_get_param'];
  }

  // ════════════════════════════════════════════════════════════════
  // PATCH PROCEDURES to be async-compatible
  // ════════════════════════════════════════════════════════════════
  // In Blockly v9 the generators live in Blockly.JavaScript.forBlock[type].
  // Blockly.JavaScript[type] is a legacy alias that may not be used by
  // blockToCode, so we must update forBlock directly.
  //
  // Procedure DEF generators store the function body in
  // gen.definitions_['%funcName'] and return null — we patch that entry
  // to be async after the original generator runs.
  //
  // Procedure CALL generators return a string like 'myFunc();\n' — we
  // prefix with 'await '.
  function patchGen(defType, callType) {
    const fb       = Blockly.JavaScript.forBlock || Blockly.JavaScript;
    const origDef  = fb[defType]  || Blockly.JavaScript[defType];
    const origCall = fb[callType] || Blockly.JavaScript[callType];

    if (origDef) {
      const patchedDef = function(block, generator) {
        const gen = generator || this;
        origDef.call(gen, block, gen);
        // Patch procedure entries (keyed '%funcName') to be async
        const defs = gen.definitions_ || this.definitions_;
        if (defs) {
          Object.keys(defs).filter(k => k.startsWith('%')).forEach(k => {
            if (typeof defs[k] === 'string')
              defs[k] = defs[k].replace(/^function\b/, 'async function');
          });
        }
        return null;
      };
      fb[defType] = patchedDef;
      Blockly.JavaScript[defType] = patchedDef;
    }

    if (origCall) {
      const patchedCall = function(block, generator) {
        const gen = generator || this;
        const result = origCall.call(gen, block, gen);
        if (typeof result === 'string') return 'await ' + result;
        if (Array.isArray(result))      return ['(await ' + result[0] + ')', Blockly.JavaScript.ORDER_ATOMIC];
        return result;
      };
      fb[callType] = patchedCall;
      Blockly.JavaScript[callType] = patchedCall;
    }
  }
  patchGen('procedures_defnoreturn',  'procedures_callnoreturn');
  patchGen('procedures_defreturn',    'procedures_callreturn');
}

// ════════════════════════════════════════════════════════════════
// TOOLBOX — 7 categories, Scratch-style layout
// ════════════════════════════════════════════════════════════════
function getToolbox() {
  const shadow = (type, fields) => ({
    kind: 'shadow', type,
    fields: fields || {}
  });

  return {
    kind: 'categoryToolbox',
    contents: [

      // ── Events ─────────────────────────────────────────────────
      {
        kind: 'category', name: 'Events', colour: '#FFBF00',
        contents: [
          { kind: 'block', type: 'when_program_starts' },
        ]
      },

      // ── Motors ────────────────────────────────────────────────
      {
        kind: 'category', name: 'Motors', colour: '#4C97FF',
        contents: [
          {
            kind: 'block', type: 'motor_spin',
            inputs: { SPEED: { shadow: shadow('math_number', { NUM: 5 }) } }
          },
          {
            kind: 'block', type: 'motor_spin_for',
            inputs: {
              SPEED:    { shadow: shadow('math_number', { NUM: 5 }) },
              DURATION: { shadow: shadow('math_number', { NUM: 1 }) }
            }
          },
          { kind: 'block', type: 'motor_stop' },
          { kind: 'sep' },
          {
            kind: 'block', type: 'motor_set_speed',
            inputs: { SPEED: { shadow: shadow('math_number', { NUM: 5 }) } }
          },
          { kind: 'block', type: 'stop_all_motors' },
        ]
      },

      // ── Control ────────────────────────────────────────────────
      {
        kind: 'category', name: 'Control', colour: '#FFAB19',
        contents: [
          {
            kind: 'block', type: 'wait_seconds',
            inputs: { SECS: { shadow: shadow('math_number', { NUM: 1 }) } }
          },
          {
            kind: 'block', type: 'controls_repeat_ext',
            inputs: { TIMES: { shadow: shadow('math_number', { NUM: 4 }) } }
          },
          { kind: 'block', type: 'forever_loop' },
          { kind: 'block', type: 'while_loop' },
          { kind: 'block', type: 'controls_if' },
          { kind: 'block', type: 'controls_whileUntil', fields: { MODE: 'UNTIL' } },
          { kind: 'block', type: 'controls_whileUntil', fields: { MODE: 'WHILE' } },
          { kind: 'block', type: 'stop_all' },
        ]
      },

      // ── Sensors ────────────────────────────────────────────────
      {
        kind: 'category', name: 'Sensors', colour: '#5CB1D6',
        contents: [
          { kind: 'block', type: 'get_distance' },
          {
            kind: 'block', type: 'is_path_clear',
            inputs: { THRESHOLD: { shadow: shadow('math_number', { NUM: 40 }) } }
          },
          { kind: 'block', type: 'touching_wall' },
          { kind: 'block', type: 'robot_x' },
          { kind: 'block', type: 'robot_y' },
          { kind: 'block', type: 'robot_angle' },
          { kind: 'block', type: 'get_timer' },
        ]
      },

      // ── Operators ──────────────────────────────────────────────
      {
        kind: 'category', name: 'Operators', colour: '#59C059',
        contents: [
          { kind: 'block', type: 'math_arithmetic', fields: { OP: 'ADD' } },
          { kind: 'block', type: 'math_arithmetic', fields: { OP: 'MINUS' } },
          { kind: 'block', type: 'math_arithmetic', fields: { OP: 'MULTIPLY' } },
          { kind: 'block', type: 'math_arithmetic', fields: { OP: 'DIVIDE' } },
          { kind: 'sep' },
          { kind: 'block', type: 'math_number' },
          {
            kind: 'block', type: 'math_random_int',
            inputs: {
              FROM: { shadow: shadow('math_number', { NUM: 1 }) },
              TO:   { shadow: shadow('math_number', { NUM: 10 }) }
            }
          },
          { kind: 'block', type: 'math_single', fields: { OP: 'ABS' } },
          { kind: 'block', type: 'math_round',  fields: { OP: 'ROUND' } },
          { kind: 'block', type: 'math_modulo' },
          { kind: 'sep' },
          { kind: 'block', type: 'logic_compare', fields: { OP: 'EQ' } },
          { kind: 'block', type: 'logic_compare', fields: { OP: 'GT' } },
          { kind: 'block', type: 'logic_compare', fields: { OP: 'LT' } },
          { kind: 'block', type: 'logic_operation', fields: { OP: 'AND' } },
          { kind: 'block', type: 'logic_operation', fields: { OP: 'OR' } },
          { kind: 'block', type: 'logic_negate' },
          { kind: 'block', type: 'logic_boolean' },
          { kind: 'sep' },
          { kind: 'block', type: 'text' },
          { kind: 'block', type: 'text_join' },
        ]
      },

      // ── Output ─────────────────────────────────────────────────
      {
        kind: 'category', name: 'Output', colour: '#CF63CF',
        contents: [
          {
            kind: 'block', type: 'say_message',
            inputs: { MSG: { shadow: shadow('text', { TEXT: 'Hello!' }) } }
          },
          {
            kind: 'block', type: 'play_beep',
            inputs: {
              FREQ: { shadow: shadow('math_number', { NUM: 440 }) },
              DUR:  { shadow: shadow('math_number', { NUM: 0.2 }) }
            }
          },
          { kind: 'block', type: 'set_led' },
        ]
      },

      // ── Variables ──────────────────────────────────────────────
      { kind: 'category', name: 'Variables', colour: '#FF8C1A', custom: 'VARIABLE' },

      // ── My Blocks ──────────────────────────────────────────────
      { kind: 'category', name: 'My Blocks', colour: '#FF6680', custom: 'PROCEDURE' },
    ]
  };
}
