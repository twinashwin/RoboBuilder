// Simulation Canvas – renders the arena, trail, obstacles, sensor ray, goal zone,
// collision flash, and the built robot assembly.

const SimCanvas = (() => {
  let canvas, ctx;
  let robotConfig = { parts: [] };
  let goalZoneConfig = null;

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    SimEngine.setOnTick(() => draw());
    draw();
  }

  function setRobotConfig(config) {
    robotConfig = config || { parts: [] };
  }

  function setGoalZoneConfig(zone) {
    goalZoneConfig = zone;
  }

  function draw() {
    const { width, height } = canvas;
    const robot     = SimEngine.getRobot();
    const obstacles = SimEngine.getObstacles();
    const arena     = { width, height };

    ctx.clearRect(0, 0, width, height);
    drawArena(width, height);
    if (goalZoneConfig) drawGoalZone(goalZoneConfig);
    drawTrail();
    drawObstacles(obstacles);

    const hasSensor = robotConfig.parts.some(p => p.type === 'distance-sensor');
    if (hasSensor || robotConfig.parts.length === 0) {
      drawSensorRay(robot, obstacles, arena);
    }

    if (robotConfig.parts.length > 0) {
      drawBuiltRobot(robot);
    } else {
      drawGenericRobot(robot);
    }

    drawCollisionFlash(robot);
  }

  // ── Arena ─────────────────────────────────────────────────────────────────

  function drawArena(w, h) {
    const tc = window._themeColors || {};
    // Base fill — checkerboard like a competition field
    ctx.fillStyle = tc.arenaBg || '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    // Checkerboard tiles
    const tileSize = 40;
    for (let row = 0; row < Math.ceil(h / tileSize); row++) {
      for (let col = 0; col < Math.ceil(w / tileSize); col++) {
        if ((row + col) % 2 === 0) {
          ctx.fillStyle = tc.arenaTile || '#F3F4F6';
          ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = tc.arenaGrid || 'rgba(0,0,0,0.06)';
    ctx.lineWidth   = 0.5;
    for (let x = 0; x <= w; x += 20) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y <= h; y += 20) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Corner pip markers
    const pip = 6;
    ctx.fillStyle = tc.arenaPip || 'rgba(59,130,246,0.4)';
    [[pip, pip], [w - pip, pip], [pip, h - pip], [w - pip, h - pip]].forEach(([px, py]) => {
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    });

    // Clean border
    ctx.strokeStyle = tc.arenaBorder || 'rgba(0,0,0,0.12)';
    ctx.lineWidth   = 2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
  }

  // ── Goal zone ─────────────────────────────────────────────────────────────

  function drawGoalZone(zone) {
    const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 600);
    const alpha = 0.08 + pulse * 0.08;
    ctx.save();
    ctx.strokeStyle = `rgba(16,185,129,${0.5 + pulse * 0.4})`;
    ctx.fillStyle   = `rgba(16,185,129,${alpha})`;
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 4]);
    ctx.shadowColor = '#10B981';
    ctx.shadowBlur  = 8 + pulse * 6;
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
    ctx.setLineDash([]);

    // Goal icon
    ctx.fillStyle = `rgba(16,185,129,${0.6 + pulse * 0.3})`;
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚑', zone.x + zone.width / 2, zone.y + zone.height / 2);
    ctx.restore();
  }

  // ── Trail ─────────────────────────────────────────────────────────────────

  function drawTrail() {
    const pts = SimEngine.getTrail();
    if (pts.length < 2) return;
    const tc = window._themeColors || {};
    ctx.save();
    ctx.strokeStyle = tc.trail || 'rgba(59,130,246,0.4)';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ── Obstacles ─────────────────────────────────────────────────────────────

  function drawObstacles(obstacles) {
    const tc = window._themeColors || {};
    for (const obs of obstacles) {
      ctx.save();

      // Shadow
      ctx.shadowColor   = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur    = 6;
      ctx.shadowOffsetX = 2;
      ctx.shadowOffsetY = 2;

      // Fill
      ctx.fillStyle = tc.obstacle || '#374151';
      ctx.fillRect(obs.x, obs.y, obs.width, obs.height);

      ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;

      // Border
      ctx.strokeStyle = tc.obstacleBord || '#1F2937';
      ctx.lineWidth   = 1;
      ctx.strokeRect(obs.x + 0.5, obs.y + 0.5, obs.width - 1, obs.height - 1);

      ctx.restore();
    }
  }

  // ── Sensor ray ────────────────────────────────────────────────────────────

  function drawSensorRay(robot, obstacles, arena) {
    const dist = SensorSystem.getDistance(robot, obstacles, arena);
    const ex   = robot.x + Math.cos(robot.angle) * dist;
    const ey   = robot.y + Math.sin(robot.angle) * dist;

    ctx.save();
    ctx.strokeStyle = 'rgba(16,185,129,0.5)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(robot.x, robot.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);

    // Hit dot
    ctx.fillStyle = '#10B981';
    ctx.beginPath(); ctx.arc(ex, ey, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── Collision flash ───────────────────────────────────────────────────────

  function drawCollisionFlash(robot) {
    const flashAt = SimEngine.getCollisionFlash();
    if (!flashAt) return;
    const age = Date.now() - flashAt;
    if (age > 200) return;
    const alpha = (1 - age / 200) * 0.55;
    ctx.save();
    const grad = ctx.createRadialGradient(robot.x, robot.y, 0, robot.x, robot.y, 44);
    grad.addColorStop(0, `rgba(236,72,153,${alpha})`);
    grad.addColorStop(1, 'rgba(236,72,153,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(robot.x, robot.y, 44, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── Built robot ───────────────────────────────────────────────────────────

  function drawBuiltRobot(robot) {
    const maxPx = 80;
    const renderer = (typeof PartRenderers2D !== 'undefined') ? PartRenderers2D : BuildCanvas;
    const drawn = renderer.drawAssemblyToContext(ctx, robotConfig.parts, robot.x, robot.y, robot.angle, maxPx);
    if (!drawn) drawGenericRobot(robot);

    // Direction indicator arrow
    const tc2 = window._themeColors || {};
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(robot.angle);
    ctx.fillStyle   = tc2.dirArrowFill || '#fff';
    ctx.strokeStyle = tc2.dirArrowStroke || '#3B82F6';
    ctx.lineWidth   = 1.5;
    ctx.shadowColor = 'rgba(59,130,246,0.5)';
    ctx.shadowBlur  = 4;
    ctx.beginPath();
    ctx.moveTo(16,  0);
    ctx.lineTo(8,  -5);
    ctx.lineTo(8,   5);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // ── Generic robot (top-down) ──────────────────────────────────────────────

  function drawGenericRobot(robot) {
    const tc = window._themeColors || {};
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(robot.angle);
    const hw = robot.width / 2, hh = robot.height / 2;

    // Body
    ctx.fillStyle   = tc.dirArrowStroke || '#3B82F6';
    ctx.strokeStyle = '#2563EB';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.roundRect(-hw, -hh, robot.width, robot.height, 4);
    ctx.fill(); ctx.stroke();

    // Left wheel
    ctx.fillStyle   = tc.wheelFill || '#374151';
    ctx.strokeStyle = tc.wheelStroke || 'rgba(0,0,0,0.2)';
    ctx.lineWidth   = 1;
    ctx.fillRect(-hw - 4, -hh + 2, 4, hh - 2);
    ctx.strokeRect(-hw - 4, -hh + 2, 4, hh - 2);

    // Right wheel
    ctx.fillRect(hw, -hh + 2, 4, hh - 2);
    ctx.strokeRect(hw, -hh + 2, 4, hh - 2);

    // Eye LEDs
    ctx.fillStyle   = tc.eyeFill || '#93C5FD';
    ctx.beginPath(); ctx.arc(hw - 6, -4, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hw - 6,  4, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    // Direction arrow
    ctx.fillStyle   = 'rgba(255,255,255,0.75)';
    ctx.strokeStyle = '#EC4899';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(hw + 4, 0);
    ctx.lineTo(hw - 3, -4);
    ctx.lineTo(hw - 3,  4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ctx.restore();
  }

  function setDimensions(w, h) {
    if (!canvas) return;
    canvas.width  = w;
    canvas.height = h;
    draw();
  }

  function redraw() { draw(); }

  return { init, setRobotConfig, setGoalZoneConfig, setDimensions, redraw };
})();
