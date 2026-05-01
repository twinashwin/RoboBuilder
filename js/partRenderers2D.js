// Part Renderers 2D – extracted from buildCanvas.js
// Contains all 2D shape-drawing functions and the drawAssemblyToContext() helper
// so that simCanvas.js (and any other consumer) can render the built robot
// without depending on the build canvas module.

const PartRenderers2D = (() => {

  // ══════════════════════════════════════════════════════════════════════════
  // PART SHAPE FUNCTIONS – all take (c, ...) as first param so they work
  // with any canvas context (build canvas OR simulation canvas).
  // ══════════════════════════════════════════════════════════════════════════

  function drawPartShapeWith(c, placed, pw, ph) {
    switch (placed.type) {
      case 'c-channel':       drawCChannel(c, placed, pw, ph); break;
      case 'motor':           drawMotor(c, pw, ph);             break;
      case 'wheel':           drawWheel(c, pw, ph);             break;
      case 'battery':         drawBattery(c, pw, ph);           break;
      case 'distance-sensor': drawDistanceSensor(c, pw, ph);    break;
      case 'brain':           drawBrain(c, pw, ph);             break;
      default:
        c.fillStyle = '#888';
        c.fillRect(0, 0, pw, ph);
    }
  }

  function drawCChannel(c, placed, pw, ph) {
    const flange = Math.max(6, ph * 0.28);
    const webW   = Math.max(4, ph * 0.18);
    const g = c.createLinearGradient(0, 0, 0, ph);
    g.addColorStop(0,    '#c8c8d8');
    g.addColorStop(0.35, '#9090a4');
    g.addColorStop(0.65, '#7a7a8e');
    g.addColorStop(1,    '#606075');
    c.fillStyle = g;
    c.beginPath(); c.roundRect(0, 0, pw, flange, [3, 3, 0, 0]); c.fill();
    c.beginPath(); c.roundRect(0, ph - flange, pw, flange, [0, 0, 3, 3]); c.fill();
    c.fillRect(0, flange, webW, ph - flange * 2);
    c.fillStyle = '#9898b0';
    c.fillRect(webW, flange, pw - webW * 2, ph - flange * 2);
    c.fillStyle = g;
    c.fillRect(pw - webW, flange, webW, ph - flange * 2);
    c.fillStyle = 'rgba(5,5,20,0.75)';
    for (let hx = 14; hx < pw - 8; hx += 20) {
      c.beginPath(); c.ellipse(hx, flange * 0.5, 3.5, 2, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(hx, ph - flange * 0.5, 3.5, 2, 0, 0, Math.PI * 2); c.fill();
    }
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.fillRect(1, 1, pw - 2, 2);
  }

  function drawMotor(c, pw, ph) {
    const housing = ph * 0.38;
    const hg = c.createLinearGradient(0, 0, pw, housing);
    hg.addColorStop(0, '#d84848'); hg.addColorStop(1, '#a02828');
    c.fillStyle = hg;
    c.beginPath(); c.roundRect(4, 0, pw - 8, housing, [4, 4, 0, 0]); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.5)';
    [[10, housing * 0.45], [pw - 10, housing * 0.45]].forEach(([sx, sy]) => {
      c.beginPath(); c.arc(sx, sy, 2.5, 0, Math.PI * 2); c.fill();
    });
    const bodyY  = ph * 0.58;
    const bodyR  = pw / 2 - 3;
    const bg = c.createRadialGradient(pw * 0.38, bodyY - bodyR * 0.3, 0, pw / 2, bodyY, bodyR);
    bg.addColorStop(0, '#e06060'); bg.addColorStop(0.6, '#c03030'); bg.addColorStop(1, '#7a1010');
    c.fillStyle = bg;
    c.beginPath(); c.arc(pw / 2, bodyY, bodyR, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 5) {
      c.beginPath();
      c.moveTo(pw/2 + Math.cos(a)*bodyR*0.35, bodyY + Math.sin(a)*bodyR*0.35);
      c.lineTo(pw/2 + Math.cos(a)*(bodyR-2),  bodyY + Math.sin(a)*(bodyR-2));
      c.stroke();
    }
    c.fillStyle = '#333'; c.beginPath(); c.arc(pw/2, ph-5, 6, 0, Math.PI*2); c.fill();
    c.fillStyle = '#777'; c.beginPath(); c.arc(pw/2, ph-5, 3, 0, Math.PI*2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.2)';
    c.beginPath(); c.roundRect(5, 1, pw-10, 3, 2); c.fill();
  }

  function drawWheel(c, pw, ph) {
    const r = Math.min(pw, ph) / 2 - 1;
    const cx = pw / 2, cy = ph / 2;
    c.fillStyle = '#181818';
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#2e2e2e'; c.lineWidth = 3;
    const nTread = 14;
    for (let i = 0; i < nTread; i++) {
      const a1 = (i / nTread) * Math.PI * 2;
      const a2 = a1 + (Math.PI * 2 / nTread) * 0.55;
      c.beginPath(); c.arc(cx, cy, r - 1, a1, a2); c.stroke();
    }
    const rg = c.createRadialGradient(cx-r*0.2, cy-r*0.2, 0, cx, cy, r*0.68);
    rg.addColorStop(0, '#6a6a7e'); rg.addColorStop(1, '#3a3a4e');
    c.fillStyle = rg; c.beginPath(); c.arc(cx, cy, r * 0.68, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#5a5a6e'; c.lineWidth = 2.5;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      c.beginPath();
      c.moveTo(cx + Math.cos(a)*r*0.18, cy + Math.sin(a)*r*0.18);
      c.lineTo(cx + Math.cos(a)*r*0.64, cy + Math.sin(a)*r*0.64);
      c.stroke();
    }
    const hg = c.createRadialGradient(cx-2, cy-2, 0, cx, cy, r*0.2);
    hg.addColorStop(0, '#9090aa'); hg.addColorStop(1, '#4a4a5e');
    c.fillStyle = hg; c.beginPath(); c.arc(cx, cy, r * 0.2, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c0c0cc'; c.beginPath(); c.arc(cx, cy, r * 0.07, 0, Math.PI * 2); c.fill();
  }

  function drawBattery(c, pw, ph) {
    const bodyW = pw - 10;
    const bg = c.createLinearGradient(0, 0, 0, ph);
    bg.addColorStop(0, '#3ecf7a'); bg.addColorStop(1, '#1a8040');
    c.fillStyle = bg; c.beginPath(); c.roundRect(0, 0, bodyW, ph, 4); c.fill();
    c.fillStyle = '#555'; c.beginPath(); c.roundRect(bodyW, ph*0.22, 10, ph*0.56, [0,3,3,0]); c.fill();
    c.fillStyle = '#888'; c.beginPath(); c.roundRect(bodyW+1, ph*0.3, 6, ph*0.4, 2); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.28)'; c.lineWidth = 1;
    [bodyW*0.33, bodyW*0.66].forEach(sx => { c.beginPath(); c.moveTo(sx,3); c.lineTo(sx,ph-3); c.stroke(); });
    c.fillStyle = 'rgba(255,255,255,0.18)';
    c.beginPath(); c.roundRect(4, ph*0.28, (bodyW-8)*0.8, ph*0.44, 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath(); c.roundRect(2, 2, bodyW-4, 4, 2); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = 'bold 11px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('+', bodyW+5, ph/2);
  }

  function drawDistanceSensor(c, pw, ph) {
    const bg = c.createLinearGradient(0, 0, 0, ph);
    bg.addColorStop(0, '#4aaae0'); bg.addColorStop(1, '#1a5a8e');
    c.fillStyle = bg; c.beginPath(); c.roundRect(0, 0, pw, ph, 3); c.fill();
    c.strokeStyle = 'rgba(0,255,150,0.25)'; c.lineWidth = 0.75;
    c.beginPath(); c.moveTo(4, ph*0.72); c.lineTo(pw-4, ph*0.72); c.stroke();
    const eyeY = ph * 0.38;
    const eyeR = Math.min(pw * 0.16, 8);
    const e1x  = pw * 0.28, e2x = pw * 0.72;
    c.fillStyle = '#071422';
    [e1x, e2x].forEach(ex => { c.beginPath(); c.arc(ex, eyeY, eyeR+2, 0, Math.PI*2); c.fill(); });
    [e1x, e2x].forEach(ex => {
      const lg = c.createRadialGradient(ex-1, eyeY-1, 0, ex, eyeY, eyeR);
      lg.addColorStop(0,'#aaddff'); lg.addColorStop(0.5,'#3399dd'); lg.addColorStop(1,'#001144');
      c.fillStyle = lg; c.beginPath(); c.arc(ex, eyeY, eyeR, 0, Math.PI*2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.45)';
      c.beginPath(); c.arc(ex-eyeR*0.3, eyeY-eyeR*0.3, eyeR*0.28, 0, Math.PI*2); c.fill();
    });
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.font = `${Math.max(5,Math.min(7,pw/6))}px monospace`;
    c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText('DIST', pw/2, ph-2);
    c.textAlign = 'start';
  }

  function drawBrain(c, pw, ph) {
    const bg = c.createLinearGradient(0, 0, pw, ph);
    bg.addColorStop(0, '#6d28d9');
    bg.addColorStop(1, '#4c1d95');
    c.fillStyle = bg;
    c.beginPath(); c.roundRect(0, 0, pw, ph, 4); c.fill();

    c.strokeStyle = 'rgba(167,139,250,0.22)';
    c.lineWidth   = 0.75;
    for (let gx = 8; gx < pw; gx += 8) {
      c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, ph); c.stroke();
    }
    for (let gy = 8; gy < ph; gy += 8) {
      c.beginPath(); c.moveTo(0, gy); c.lineTo(pw, gy); c.stroke();
    }

    const cs = Math.min(pw, ph) * 0.38;
    const cx = pw / 2, cy = ph / 2;
    c.fillStyle = '#1e1b4b';
    c.beginPath(); c.roundRect(cx - cs/2, cy - cs/2, cs, cs, 2); c.fill();

    c.fillStyle    = '#ddd6fe';
    c.font         = `bold ${Math.max(6, Math.min(9, pw * 0.17))}px monospace`;
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.fillText('BRAIN', cx, cy);

    const pinLen = 4, pinW = 3, pinCount = 3;
    c.fillStyle = '#a78bfa';
    for (let i = 0; i < pinCount; i++) {
      const yp = ph / (pinCount + 1) * (i + 1);
      c.fillRect(0, yp - pinW/2, pinLen, pinW);
      c.fillRect(pw - pinLen, yp - pinW/2, pinLen, pinW);
    }
    for (let i = 0; i < pinCount; i++) {
      const xp = pw / (pinCount + 1) * (i + 1);
      c.fillRect(xp - pinW/2, 0, pinW, pinLen);
      c.fillRect(xp - pinW/2, ph - pinLen, pinW, pinLen);
    }

    c.fillStyle = 'rgba(255,255,255,0.1)';
    c.beginPath(); c.roundRect(2, 2, pw - 4, 4, 2); c.fill();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC: Render the built robot assembly into any canvas context.
  // Used by SimCanvas to show the actual built robot in the simulation.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * @param {CanvasRenderingContext2D} targetCtx
   * @param {Array} configParts  - from getRobotConfig().parts
   * @param {number} centerX     - world x to center the assembly on
   * @param {number} centerY     - world y to center the assembly on
   * @param {number} worldAngle  - overall rotation (robot.angle)
   * @param {number} maxPx       - max pixel size of longest dimension
   * @returns {boolean} false if nothing drawn (no parts)
   */
  function drawAssemblyToContext(targetCtx, configParts, centerX, centerY, worldAngle, maxPx) {
    if (!configParts || configParts.length === 0) return false;

    // Axis-aligned bounding box of the assembly in build coords
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    configParts.forEach(p => {
      const def = getPartDef(p.type);
      if (!def) return;
      const pw = getEffectiveW(p, def);
      const ph = getEffectiveH(p, def);
      minX = Math.min(minX, p.position.x);
      minY = Math.min(minY, p.position.y);
      maxX = Math.max(maxX, p.position.x + pw);
      maxY = Math.max(maxY, p.position.y + ph);
    });
    if (!isFinite(minX)) return false;

    const assemblyW  = Math.max(maxX - minX, 1);
    const assemblyH  = Math.max(maxY - minY, 1);
    const assemblyCX = (minX + maxX) / 2;
    const assemblyCY = (minY + maxY) / 2;
    const scale      = Math.min(maxPx / assemblyW, maxPx / assemblyH);

    targetCtx.save();
    targetCtx.translate(centerX, centerY);
    targetCtx.rotate(worldAngle);

    configParts.forEach(p => {
      const def = getPartDef(p.type);
      if (!def) return;
      const pw  = getEffectiveW(p, def);
      const ph  = getEffectiveH(p, def);
      const lcx = (p.position.x + pw / 2 - assemblyCX) * scale;
      const lcy = (p.position.y + ph / 2 - assemblyCY) * scale;

      targetCtx.save();
      targetCtx.translate(lcx, lcy);
      targetCtx.rotate(p.rotation || 0);
      targetCtx.scale(scale, scale);
      targetCtx.translate(-pw / 2, -ph / 2);
      drawPartShapeWith(targetCtx, p, pw, ph);
      targetCtx.restore();
    });

    targetCtx.restore();
    return true;
  }

  return {
    drawPartShapeWith,
    drawAssemblyToContext
  };
})();
