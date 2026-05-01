// Build Canvas – 2D grid workspace with drag-drop, rotation, snap, and realistic part shapes.
// Shape drawing functions accept an explicit canvas context so they can render
// to the simulation canvas via drawAssemblyToContext().

const BuildCanvas = (() => {
  let canvas, ctx;
  let placedParts     = [];  // { id, type, position:{x,y}, rotation:radians, props:{} }
  let connections     = [];  // { fromId, toId, wireType: 'power'|'signal' }
  let selectedId      = null;
  let activeTool      = 'select';
  let nextId          = 1;
  let history         = [];
  let historyIdx      = -1;
  let pendingWireFrom = null;  // partId of wire-start, or null
  let lastMouseX      = 0;
  let lastMouseY      = 0;

  const drag = {
    active: false,
    mode: null,        // 'new' | 'move' | 'rotate'
    type: null,
    partId: null,
    cursorX: 0,
    cursorY: 0,
    snapResult: null,  // includes dragSpIndex for any-side snapping
    overPanel: false,  // cursor is over parts panel → drop will delete
    partStartRotation: 0
  };

  const GRID          = 20;
  const HANDLE_RADIUS = 8;
  const HANDLE_DIST   = 28;

  // ── Placement feedback ─────────────────────────────────────────────────────

  function _playSnapSound(valid) {
    try {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.connect(gain); gain.connect(actx.destination);
      osc.type = 'sine';
      osc.frequency.value = valid ? 880 : 220;
      gain.gain.setValueAtTime(0.06, actx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.08);
      osc.start(actx.currentTime);
      osc.stop(actx.currentTime + 0.08);
      osc.onended = () => actx.close();
    } catch (e) { /* audio not available */ }
  }

  let _snapFlash = null; // { x, y, valid, startTime }
  function _flashSnapPoint(x, y, valid) {
    _snapFlash = { x, y, valid, startTime: Date.now() };
    // Animate flash over 300ms
    const animate = () => {
      if (!_snapFlash) return;
      const elapsed = Date.now() - _snapFlash.startTime;
      if (elapsed > 300) { _snapFlash = null; draw(); return; }
      draw();
      // Draw expanding ring
      const progress = elapsed / 300;
      const radius = 8 + progress * 20;
      const alpha = 1 - progress;
      ctx.save();
      ctx.strokeStyle = valid ? `rgba(0,255,136,${alpha})` : `rgba(255,68,68,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init(canvasEl) {
    canvas = canvasEl;
    ctx    = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    window.addEventListener('keydown',   onKeyDown);
    // Load saved build from localStorage
    try {
      const saved = localStorage.getItem('robobuilder_build_v2');
      if (saved) {
        const data = JSON.parse(saved);
        // Validate parts: each must have id, type, and a position object
        const rawParts = Array.isArray(data.parts) ? data.parts : [];
        placedParts = rawParts.filter(p =>
          p && typeof p.id === 'number' && typeof p.type === 'string' &&
          p.position && typeof p.position.x === 'number' && typeof p.position.y === 'number' &&
          getPartDef(p.type) !== null
        );
        connections = Array.isArray(data.connections) ? data.connections : [];
        nextId = placedParts.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
      }
    } catch (e) { /* ignore corrupt localStorage */ }
    draw();
    pushHistory();
    onRobotConfigChanged();
  }

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width  = Math.max(rect.width,  400);
    canvas.height = Math.max(rect.height, 300);
    draw();
  }

  // ── Sidebar drag entry ─────────────────────────────────────────────────────

  function startNewPartDrag(partType, startX, startY) {
    // Enforce single-instance limits for brain and battery
    if (partType === 'brain' && placedParts.some(p => p.type === 'brain')) return;
    if (partType === 'battery' && placedParts.some(p => p.type === 'battery')) return;
    drag.active     = true;
    drag.mode       = 'new';
    drag.type       = partType;
    drag.cursorX    = startX;
    drag.cursorY    = startY;
    drag.snapResult = null;
    drag.overPanel  = false;
  }

  // ── Tool / Reset ───────────────────────────────────────────────────────────

  function setActiveTool(tool) {
    activeTool = tool;
    if (tool !== 'select') { selectedId = null; notifySelection(null); }
    draw();
  }

  function resetCanvas() {
    placedParts     = [];
    connections     = [];
    pendingWireFrom = null;
    selectedId      = null;
    drag.active     = false;
    nextId          = 1;
    notifySelection(null);
    draw();
    pushHistory();
    onRobotConfigChanged();
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  function onKeyDown(e) {
    if (!selectedId) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
    const part = placedParts.find(p => p.id === selectedId);
    if (!part) return;
    if (e.key === 'r' || e.key === 'R') {
      part.rotation = (((part.rotation || 0) + Math.PI / 4) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      notifySelection(part);
      draw(); pushHistory(); onRobotConfigChanged();
      e.preventDefault();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      deleteWiresForPart(selectedId);
      placedParts = placedParts.filter(p => p.id !== selectedId);
      selectedId = null; notifySelection(null);
      draw(); pushHistory(); onRobotConfigChanged();
      e.preventDefault();
    }
  }

  // ── Canvas mousedown ───────────────────────────────────────────────────────

  function onCanvasMouseDown(e) {
    if (drag.active && drag.mode !== 'rotate') return;
    const { cx, cy } = canvasCoords(e);

    // Rotation handle of selected part
    if (selectedId && activeTool === 'select') {
      const sel = placedParts.find(p => p.id === selectedId);
      if (sel && isNearRotationHandle(cx, cy, sel)) {
        drag.active            = true;
        drag.mode              = 'rotate';
        drag.partId            = selectedId;
        drag.partStartRotation = sel.rotation || 0;
        return;
      }
    }

    // Hit test (topmost first)
    let hit = null;
    for (let i = placedParts.length - 1; i >= 0; i--) {
      if (hitTestPart(placedParts[i], cx, cy)) { hit = placedParts[i]; break; }
    }

    if (activeTool === 'delete') {
      if (hit) {
        deleteWiresForPart(hit.id);
        placedParts = placedParts.filter(p => p.id !== hit.id);
        if (selectedId === hit.id) { selectedId = null; notifySelection(null); }
        draw(); pushHistory(); onRobotConfigChanged();
      }
      return;
    }

    if (activeTool === 'wire') {
      if (hit) handleWireClick(hit.id);
      else { pendingWireFrom = null; draw(); }
      return;
    }

    if (hit) {
      selectedId = hit.id;
      notifySelection(hit);
      if (activeTool === 'select') {
        drag.active     = true;
        drag.mode       = 'move';
        drag.partId     = hit.id;
        drag.type       = hit.type;
        drag.snapResult = null;
        drag.overPanel  = false;
      }
      draw();
    } else {
      selectedId = null; notifySelection(null); draw();
    }
  }

  // ── Global mousemove ───────────────────────────────────────────────────────

  function onMouseMove(e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (pendingWireFrom !== null) draw();
    if (!drag.active) return;
    drag.cursorX = e.clientX;
    drag.cursorY = e.clientY;

    // ── Rotate mode: 45° snap ────────────────────────────────────────────────
    if (drag.mode === 'rotate') {
      const part = placedParts.find(p => p.id === drag.partId);
      if (part) {
        const def = getPartDef(part.type);
        const pw  = getEffectiveW(part, def);
        const ph  = getEffectiveH(part, def);
        const rect = canvas.getBoundingClientRect();
        const cx  = e.clientX - rect.left;
        const cy  = e.clientY - rect.top;
        const pcx = part.position.x + pw / 2;
        const pcy = part.position.y + ph / 2;
        const raw = Math.atan2(cy - pcy, cx - pcx) + Math.PI / 2;
        part.rotation = snapRotation(raw);
        notifySelection(part);
        draw();
      }
      return;
    }

    // ── Drag (new or move): check panel hover + snap ─────────────────────────
    const panelEl  = document.getElementById('parts-panel');
    const panelRect = panelEl ? panelEl.getBoundingClientRect() : null;
    drag.overPanel = drag.mode === 'move' && panelRect &&
      e.clientX >= panelRect.left && e.clientX <= panelRect.right &&
      e.clientY >= panelRect.top  && e.clientY <= panelRect.bottom;

    const rect = canvas.getBoundingClientRect();
    const inCanvas = (
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top  && e.clientY <= rect.bottom
    );

    if (inCanvas && !drag.overPanel) {
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const excludeId = drag.mode === 'move' ? drag.partId : null;
      // Build a temp part object representing the dragged part
      const draggedPart = drag.mode === 'move'
        ? placedParts.find(p => p.id === drag.partId)
        : { type: drag.type, rotation: 0, props: buildDefaultProps(getPartDef(drag.type)) };
      drag.snapResult = draggedPart
        ? findNearestSnapPair(draggedPart, cx, cy, placedParts, excludeId)
        : null;
    } else {
      drag.snapResult = null;
    }
    draw();
  }

  // ── Global mouseup ─────────────────────────────────────────────────────────

  function onMouseUp(e) {
    if (!drag.active) return;

    if (drag.mode === 'rotate') {
      drag.active = false; drag.mode = null;
      pushHistory();
      onRobotConfigChanged();
      return;
    }

    // Drop on parts panel → delete
    if (drag.overPanel && drag.mode === 'move') {
      placedParts = placedParts.filter(p => p.id !== drag.partId);
      if (selectedId === drag.partId) { selectedId = null; notifySelection(null); }
      drag.active = false; drag.mode = null; drag.snapResult = null; drag.overPanel = false;
      draw(); pushHistory(); onRobotConfigChanged();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const inCanvas = (
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top  && e.clientY <= rect.bottom
    );

    if (inCanvas) {
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      if (drag.mode === 'new') {
        const def     = getPartDef(drag.type);
        const newPart = { id: nextId++, type: drag.type, rotation: 0, props: buildDefaultProps(def), position: { x: 0, y: 0 } };
        if (drag.snapResult) {
          newPart.position = alignToSnap(def, newPart, drag.snapResult.worldX, drag.snapResult.worldY, drag.snapResult.dragSpIndex);
          _playSnapSound(true);
          _flashSnapPoint(drag.snapResult.worldX, drag.snapResult.worldY, true);
        } else {
          const pos = centerPosition(newPart, def, cx, cy);
          newPart.position = { x: Math.round(pos.x / GRID) * GRID, y: Math.round(pos.y / GRID) * GRID };
        }
        clampPosition(newPart);
        placedParts.push(newPart);
        selectedId = newPart.id;
        notifySelection(newPart);

      } else if (drag.mode === 'move') {
        const part = placedParts.find(p => p.id === drag.partId);
        if (part) {
          const def = getPartDef(part.type);
          if (drag.snapResult) {
            part.position = alignToSnap(def, part, drag.snapResult.worldX, drag.snapResult.worldY, drag.snapResult.dragSpIndex);
            _playSnapSound(true);
            _flashSnapPoint(drag.snapResult.worldX, drag.snapResult.worldY, true);
          } else {
            const pos = centerPosition(part, def, cx, cy);
            part.position = { x: Math.round(pos.x / GRID) * GRID, y: Math.round(pos.y / GRID) * GRID };
          }
          clampPosition(part);
          selectedId = part.id; notifySelection(part);
        }
      }
      pushHistory();
      onRobotConfigChanged();
    }

    drag.active = false; drag.mode = null; drag.snapResult = null; drag.overPanel = false;
    draw();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function buildDefaultProps(def) {
    const out = {};
    if (def && def.props) def.props.forEach(p => { out[p.key] = p.default; });
    return out;
  }

  function clampPosition(placed) {
    const def = getPartDef(placed.type);
    const pw  = getEffectiveW(placed, def);
    const ph  = getEffectiveH(placed, def);
    placed.position.x = Math.max(0, Math.min(canvas.width  - pw, placed.position.x));
    placed.position.y = Math.max(0, Math.min(canvas.height - ph, placed.position.y));
  }

  function getRotationHandlePos(placed) {
    const def = getPartDef(placed.type);
    const pw  = getEffectiveW(placed, def);
    const ph  = getEffectiveH(placed, def);
    const cx  = placed.position.x + pw / 2;
    const cy  = placed.position.y + ph / 2;
    const a   = placed.rotation || 0;
    const localY = -(ph / 2 + HANDLE_DIST);
    return {
      x: cx - Math.sin(a) * localY,
      y: cy + Math.cos(a) * localY
    };
  }

  function isNearRotationHandle(cx, cy, placed) {
    const pos = getRotationHandlePos(placed);
    return Math.hypot(cx - pos.x, cy - pos.y) <= HANDLE_RADIUS + 5;
  }

  function canvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    return { cx: e.clientX - rect.left, cy: e.clientY - rect.top };
  }

  // ── Draw (build canvas) ───────────────────────────────────────────────────

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBg();
    drawGrid();
    updateStructuralValidity();
    drawWires();
    placedParts.forEach(p => drawPart(p, p.id === selectedId));
    if (pendingWireFrom !== null) drawPendingWire();
    if (drag.active && (drag.mode === 'new' || drag.mode === 'move') && !drag.overPanel) {
      // Build a temp part object for snap queries
      const dragPart = drag.mode === 'new'
        ? { type: drag.type, rotation: 0, props: {} }
        : placedParts.find(p => p.id === drag.partId) || { type: drag.type, rotation: 0, props: {} };
      const rect = canvas.getBoundingClientRect();
      const gx = drag.cursorX - rect.left, gy = drag.cursorY - rect.top;
      drawAllNearbySnaps(dragPart, gx, gy, drag.snapResult);
    } else if (drag.snapResult && !drag.overPanel) {
      drawSnapHighlight(drag.snapResult, true);
    }
    if (drag.active && (drag.mode === 'new' || drag.mode === 'move')) drawGhost();

    // Build tutorial ghost target
    if (window._buildTutorialActive && window._buildTutorialActive()) {
      drawBuildTutorialGhost();
    }
  }

  // ── Build tutorial ghost target ──────────────────────────────────────────
  function drawBuildTutorialGhost() {
    if (!window._buildTutorialGetGhost) return;
    var ghost = window._buildTutorialGetGhost();
    if (!ghost) return;

    var def = getPartDef(ghost.type);
    if (!def) return;

    // Compute target position (same formula as spawnStarterRobot)
    var cx = Math.round(canvas.width  / 2 / GRID) * GRID;
    var cy = Math.round(canvas.height / 2 / GRID) * GRID;
    var tx = Math.round((cx + ghost.offsetX) / GRID) * GRID;
    var ty = Math.round((cy + ghost.offsetY) / GRID) * GRID;

    var pw = def.width;
    var ph = def.height;
    // Handle dynamic sizing for wheels/c-channels — prefer the per-step length
    // override on target3D.props if the tutorial supplied one (e.g. 60 vs 100).
    var stepLength = ghost.target3D && ghost.target3D.props && ghost.target3D.props.length;
    if (ghost.type === 'wheel') {
      pw = ph = (stepLength != null) ? stepLength : (def.props && def.props[0] ? def.props[0].default : 40);
    } else if (ghost.type === 'c-channel') {
      pw = (stepLength != null) ? stepLength : (def.props && def.props[0] ? def.props[0].default : 100);
    }

    // Pulsing animation
    var pulse = Math.sin(Date.now() / 350) * 0.5 + 0.5; // 0..1

    ctx.save();
    ctx.translate(tx + pw / 2, ty + ph / 2);
    ctx.rotate(ghost.rotation || 0);
    ctx.translate(-pw / 2, -ph / 2);

    // Light blue filled shape
    ctx.globalAlpha = 0.18 + pulse * 0.1;
    ctx.fillStyle = '#93C5FD';
    if (ghost.type === 'wheel') {
      ctx.beginPath();
      ctx.arc(pw / 2, ph / 2, pw / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, 0, pw, ph, 4);
      else ctx.rect(0, 0, pw, ph);
      ctx.fill();
    }

    // Pulsing blue border with glow
    ctx.globalAlpha = 0.5 + pulse * 0.4;
    ctx.shadowColor = 'rgba(59, 130, 246, ' + (0.4 + pulse * 0.35) + ')';
    ctx.shadowBlur  = 14 + pulse * 10;
    ctx.strokeStyle = '#60A5FA';
    ctx.lineWidth   = 2.5;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -Date.now() / 60 % 24;
    if (ghost.type === 'wheel') {
      ctx.beginPath();
      ctx.arc(pw / 2, ph / 2, pw / 2 + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.strokeRect(-4, -4, pw + 8, ph + 8);
    }
    ctx.setLineDash([]);

    // "Place here" label
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 0.5 + pulse * 0.3;
    ctx.fillStyle   = '#3B82F6';
    ctx.font        = 'bold 10px Inter, system-ui, sans-serif';
    ctx.textAlign   = 'center';
    var labelY = ghost.type === 'wheel' ? ph + 18 : ph + 14;
    ctx.fillText('▼ Place here', pw / 2, labelY);

    ctx.restore();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;

    // Request continuous redraws for animation
    requestAnimationFrame(function () { draw(); });
  }

  function drawBg() {
    const tc = window._themeColors || {};
    ctx.fillStyle = tc.buildBg || '#F7F8FA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawGrid() {
    const tc = window._themeColors || {};
    // Minor grid lines every 20px
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = tc.buildGrid || 'rgba(0,0,0,0.05)';
    for (let x = 0; x <= canvas.width;  x += GRID) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, canvas.height); ctx.stroke(); }
    for (let y = 0; y <= canvas.height; y += GRID) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(canvas.width, y + 0.5); ctx.stroke(); }
    // Major grid lines every 100px
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = tc.buildGridMaj || 'rgba(0,0,0,0.09)';
    for (let x = 0; x <= canvas.width;  x += GRID * 5) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, canvas.height); ctx.stroke(); }
    for (let y = 0; y <= canvas.height; y += GRID * 5) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(canvas.width, y + 0.5); ctx.stroke(); }
  }

  // Structural validity: BFS to find connected components from first part
  let _disconnectedIds = new Set();
  function updateStructuralValidity() {
    _disconnectedIds.clear();
    if (placedParts.length <= 1) return;
    // Build adjacency via snap proximity (parts that are snapped together)
    const adj = new Map();
    placedParts.forEach(p => adj.set(p.id, new Set()));
    // Check snap proximity between all part pairs
    for (let i = 0; i < placedParts.length; i++) {
      const a = placedParts[i];
      const aSPs = getWorldSnapPoints(a);
      for (let j = i + 1; j < placedParts.length; j++) {
        const b = placedParts[j];
        const bSPs = getWorldSnapPoints(b);
        let connected = false;
        for (const asp of aSPs) {
          for (const bsp of bSPs) {
            if (Math.hypot(asp.x - bsp.x, asp.y - bsp.y) < SNAP_THRESHOLD) {
              connected = true; break;
            }
          }
          if (connected) break;
        }
        // Also count wire connections
        if (!connected) {
          connected = connections.some(c =>
            (c.fromId === a.id && c.toId === b.id) || (c.fromId === b.id && c.toId === a.id)
          );
        }
        if (connected) {
          adj.get(a.id).add(b.id);
          adj.get(b.id).add(a.id);
        }
      }
    }
    // BFS from first part
    const visited = new Set();
    const queue = [placedParts[0].id];
    visited.add(placedParts[0].id);
    while (queue.length > 0) {
      const id = queue.shift();
      for (const neighbor of adj.get(id) || []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); queue.push(neighbor); }
      }
    }
    placedParts.forEach(p => {
      if (!visited.has(p.id)) _disconnectedIds.add(p.id);
    });
  }

  function drawPart(placed, selected) {
    const def = getPartDef(placed.type);
    if (!def) return;
    const pw = getEffectiveW(placed, def);
    const ph = getEffectiveH(placed, def);
    const cx = placed.position.x + pw / 2;
    const cy = placed.position.y + ph / 2;

    // Fade unwired motors/sensors
    const wiredIds = getWiredPartIds();
    const needsWire = (placed.type === 'motor' || placed.type === 'distance-sensor');
    const isInactive = needsWire && !wiredIds.has(placed.id);
    const isDisconnected = _disconnectedIds.has(placed.id);

    ctx.save();
    if (isInactive) ctx.globalAlpha = 0.4;
    ctx.translate(cx, cy);
    ctx.rotate(placed.rotation || 0);
    ctx.translate(-pw / 2, -ph / 2);

    // Draw shadow beneath the part shape
    ctx.shadowColor   = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur    = 6;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    drawPartShapeWith(ctx, placed, pw, ph);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur  = 0;

    drawSnapDots(ctx, placed, def, pw, ph);

    // Disconnected part warning (dashed orange border)
    if (isDisconnected) {
      ctx.strokeStyle = '#F97316';
      ctx.lineWidth   = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(-3, -3, pw + 6, ph + 6);
      ctx.setLineDash([]);
    }

    if (selected) {
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth   = 2;
      ctx.setLineDash([5, 3]);
      ctx.strokeRect(-2, -2, pw + 4, ph + 4);
      ctx.setLineDash([]);
    }

    // Wire tool: highlight selected source
    if (pendingWireFrom === placed.id) {
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth   = 3;
      ctx.shadowColor = 'rgba(59,130,246,0.4)';
      ctx.shadowBlur  = 10;
      ctx.beginPath(); ctx.strokeRect(-4, -4, pw + 8, ph + 8);
      ctx.shadowBlur  = 0;
    }

    ctx.restore();

    if (selected) drawRotationHandle(placed);
  }

  // ── Snap dots (local space) ────────────────────────────────────────────────

  function drawSnapDots(c, placed, def, pw, ph) {
    const localSPs = getEffectiveSnapPoints(placed, def);
    c.fillStyle = 'rgba(0,0,0,0.2)';
    for (const sp of localSPs) {
      c.beginPath();
      c.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
      c.fill();
    }
  }

  // ── Rotation handle ────────────────────────────────────────────────────────

  function drawRotationHandle(placed) {
    const def  = getPartDef(placed.type);
    const pw   = getEffectiveW(placed, def);
    const ph   = getEffectiveH(placed, def);
    const cx   = placed.position.x + pw / 2;
    const cy   = placed.position.y + ph / 2;
    const hpos = getRotationHandlePos(placed);
    const a    = placed.rotation || 0;
    const topX = cx - Math.sin(a) * (ph / 2 + 4);
    const topY = cy + Math.cos(a) * (ph / 2 + 4);

    ctx.save();
    ctx.strokeStyle = '#e9456088';
    ctx.lineWidth   = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(topX, topY); ctx.lineTo(hpos.x, hpos.y); ctx.stroke();
    ctx.setLineDash([]);

    const isDragging = drag.active && drag.mode === 'rotate' && drag.partId === placed.id;
    ctx.fillStyle   = isDragging ? '#3B82F6' : '#fff';
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.arc(hpos.x, hpos.y, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle    = isDragging ? '#fff' : '#3B82F6';
    ctx.font         = '9px Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('↻', hpos.x, hpos.y + 1);

    const deg = Math.round(((a * 180 / Math.PI) % 360 + 360) % 360);
    ctx.fillStyle    = '#3B82F6';
    ctx.font         = '9px Segoe UI, Arial';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${deg}°`, hpos.x, hpos.y - HANDLE_RADIUS - 4);
    ctx.restore();
  }

  // ── Snap highlight ─────────────────────────────────────────────────────────

  function drawSnapHighlight(snap, isBest) {
    ctx.save();
    const color = snap.compatible !== false ? '#00ff88' : '#ff4444';
    ctx.strokeStyle = color;
    ctx.lineWidth   = isBest ? 2 : 1;
    ctx.shadowColor = color;
    ctx.shadowBlur  = isBest ? 10 : 4;
    const radius = isBest ? 9 : 5;
    ctx.beginPath(); ctx.arc(snap.worldX, snap.worldY, radius, 0, Math.PI * 2); ctx.stroke();
    if (isBest) {
      ctx.beginPath();
      ctx.moveTo(snap.worldX - 15, snap.worldY); ctx.lineTo(snap.worldX + 15, snap.worldY);
      ctx.moveTo(snap.worldX, snap.worldY - 15); ctx.lineTo(snap.worldX, snap.worldY + 15);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawAllNearbySnaps(dragPart, ghostCx, ghostCy, bestSnap) {
    const allSnaps = findAllNearbySnaps(dragPart, ghostCx, ghostCy, placedParts, dragPart.id || null, SNAP_THRESHOLD * 2);
    allSnaps.forEach(s => {
      const isBest = bestSnap && s.worldX === bestSnap.worldX && s.worldY === bestSnap.worldY;
      drawSnapHighlight(s, isBest);
    });
    // If we have a best snap (from findNearestSnapPair, which is compatibility-filtered), highlight it
    if (bestSnap && !allSnaps.some(s => s.worldX === bestSnap.worldX && s.worldY === bestSnap.worldY)) {
      drawSnapHighlight(Object.assign({}, bestSnap, { compatible: true }), true);
    }
  }

  // ── Wire drawing ───────────────────────────────────────────────────────────

  const WIRE_COLORS = { power: '#EF4444', signal: '#3B82F6' };

  function partCenter(part) {
    const def = getPartDef(part.type);
    const pw = getEffectiveW(part, def);
    const ph = getEffectiveH(part, def);
    return { x: part.position.x + pw / 2, y: part.position.y + ph / 2 };
  }

  // Determine which parts are "powered" (connected to battery via wires through brain)
  function getWiredPartIds() {
    const wiredIds = new Set();
    connections.forEach(c => { wiredIds.add(c.fromId); wiredIds.add(c.toId); });
    return wiredIds;
  }

  function drawWires() {
    for (const conn of connections) {
      const fromPart = placedParts.find(p => p.id === conn.fromId);
      const toPart   = placedParts.find(p => p.id === conn.toId);
      if (!fromPart || !toPart) continue;
      const f = partCenter(fromPart);
      const t = partCenter(toPart);
      const color = WIRE_COLORS[conn.wireType] || '#888';
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth   = 2.5;
      ctx.shadowColor = color;
      ctx.shadowBlur  = 6;
      // Bezier curve instead of straight line
      const dx = t.x - f.x, dy = t.y - f.y;
      const cx1 = f.x + dx * 0.3 - dy * 0.15;
      const cy1 = f.y + dy * 0.3 + dx * 0.15;
      const cx2 = f.x + dx * 0.7 + dy * 0.15;
      const cy2 = f.y + dy * 0.7 - dx * 0.15;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.bezierCurveTo(cx1, cy1, cx2, cy2, t.x, t.y); ctx.stroke();
      // Endpoint dots
      ctx.fillStyle = color; ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(f.x, f.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(t.x, t.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  function drawPendingWire() {
    const fromPart = placedParts.find(p => p.id === pendingWireFrom);
    if (!fromPart) return;
    const f    = partCenter(fromPart);
    const rect = canvas.getBoundingClientRect();
    const tx   = lastMouseX - rect.left;
    const ty   = lastMouseY - rect.top;
    ctx.save();
    ctx.strokeStyle = '#06B6D4';
    ctx.lineWidth   = 2;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#06B6D4';
    ctx.beginPath(); ctx.arc(tx, ty, 5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Show "Simulate real robotics" label if wiring a motor
    if (fromPart.type === 'motor') {
      _drawWireMotorLabel();
    }
  }

  function _drawWireMotorLabel() {
    const W = canvas.width, H = canvas.height;
    const text = '⚡ Simulate real robotics';
    const pad  = 14, r = 10;
    ctx.save();
    ctx.font = 'bold 15px Inter, sans-serif';
    const tw = ctx.measureText(text).width;
    const bw = tw + pad * 2, bh = 36;
    const bx = (W - bw) / 2, by = H - bh - 18;
    // Pill background
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - r, by + bh);
    ctx.lineTo(bx + r, by + bh);
    ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(59,130,246,0.92)';
    ctx.shadowColor = 'rgba(59,130,246,0.5)';
    ctx.shadowBlur  = 16;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Text
    ctx.fillStyle   = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'center';
    ctx.fillText(text, W / 2, by + bh / 2);
    ctx.restore();
  }

  // ── Wire logic ─────────────────────────────────────────────────────────────

  function handleWireClick(partId) {
    if (pendingWireFrom === null) {
      pendingWireFrom = partId;
      draw();
    } else {
      if (pendingWireFrom !== partId) {
        const fromPart = placedParts.find(p => p.id === pendingWireFrom);
        const toPart   = placedParts.find(p => p.id === partId);
        if (fromPart && toPart) {
          const wt = resolveWireType(fromPart.type, toPart.type);
          if (wt) {
            // Remove existing connection between these two if any
            connections = connections.filter(
              c => !((c.fromId === pendingWireFrom && c.toId === partId) ||
                     (c.fromId === partId && c.toId === pendingWireFrom))
            );
            connections.push({ fromId: pendingWireFrom, toId: partId, wireType: wt });
            pushHistory();
            onRobotConfigChanged();
          }
        }
      }
      pendingWireFrom = null;
      draw();
    }
  }

  function resolveWireType(fromType, toType) {
    // Accept connections in either direction
    const pair = [fromType, toType].sort().join(':');
    if (pair === 'battery:brain')              return 'power';
    if (pair === 'brain:motor')                return 'signal';
    if (pair === 'brain:distance-sensor')      return 'signal';
    return null;
  }

  function deleteWiresForPart(partId) {
    connections = connections.filter(c => c.fromId !== partId && c.toId !== partId);
  }

  function getConnections() { return JSON.parse(JSON.stringify(connections)); }

  // ── Ghost ──────────────────────────────────────────────────────────────────

  function drawGhost() {
    const rect = canvas.getBoundingClientRect();
    const cx   = drag.cursorX - rect.left;
    const cy   = drag.cursorY - rect.top;

    const ghostPart = drag.mode === 'move'
      ? placedParts.find(p => p.id === drag.partId)
      : { type: drag.type, rotation: 0, props: buildDefaultProps(getPartDef(drag.type)) };
    if (!ghostPart) return;

    const def = getPartDef(ghostPart.type);
    if (!def) return;
    const pw = getEffectiveW(ghostPart, def);
    const ph = getEffectiveH(ghostPart, def);

    let gx, gy;
    if (drag.snapResult) {
      const pos = alignToSnap(def, ghostPart, drag.snapResult.worldX, drag.snapResult.worldY, drag.snapResult.dragSpIndex);
      gx = pos.x; gy = pos.y;
    } else if (cx >= 0 && cy >= 0 && cx <= canvas.width && cy <= canvas.height) {
      gx = cx - pw / 2; gy = cy - ph / 2;
    } else {
      return;
    }

    const isDelete = drag.overPanel;

    ctx.save();
    ctx.globalAlpha = isDelete ? 0.25 : 0.45;
    ctx.translate(gx + pw / 2, gy + ph / 2);
    ctx.rotate(ghostPart.rotation || 0);
    ctx.translate(-pw / 2, -ph / 2);
    drawPartShapeWith(ctx, ghostPart, pw, ph);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = isDelete ? '#ff4444' : (drag.snapResult ? '#00ff88' : '#ffffff66');
    ctx.lineWidth   = isDelete ? 2 : 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(0, 0, pw, ph);
    ctx.setLineDash([]);
    if (isDelete) {
      ctx.fillStyle    = '#ff4444cc';
      ctx.font         = 'bold 18px Arial';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✕', pw / 2, ph / 2);
    }
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PART SHAPE FUNCTIONS – all take (c, ...) as first param so they work
  // with any canvas context (build canvas OR simulation canvas).
  // ══════════════════════════════════════════════════════════════════════════

  function drawPartShapeWith(c, placed, pw, ph) {
    if (typeof PartRenderers2D !== 'undefined') {
      PartRenderers2D.drawPartShapeWith(c, placed, pw, ph);
      return;
    }
    // Inline fallback (should not be reached if script order is correct)
    c.fillStyle = '#888';
    c.fillRect(0, 0, pw, ph);
  }

  // Original per-part draw functions kept below for reference / legacy fallback.
  // Active rendering is now delegated to PartRenderers2D.

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
    // Board background
    const bg = c.createLinearGradient(0, 0, pw, ph);
    bg.addColorStop(0, '#6d28d9');
    bg.addColorStop(1, '#4c1d95');
    c.fillStyle = bg;
    c.beginPath(); c.roundRect(0, 0, pw, ph, 4); c.fill();

    // Circuit trace grid
    c.strokeStyle = 'rgba(167,139,250,0.22)';
    c.lineWidth   = 0.75;
    for (let gx = 8; gx < pw; gx += 8) {
      c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, ph); c.stroke();
    }
    for (let gy = 8; gy < ph; gy += 8) {
      c.beginPath(); c.moveTo(0, gy); c.lineTo(pw, gy); c.stroke();
    }

    // CPU chip
    const cs = Math.min(pw, ph) * 0.38;
    const cx = pw / 2, cy = ph / 2;
    c.fillStyle = '#1e1b4b';
    c.beginPath(); c.roundRect(cx - cs/2, cy - cs/2, cs, cs, 2); c.fill();

    // CPU label
    c.fillStyle    = '#ddd6fe';
    c.font         = `bold ${Math.max(6, Math.min(9, pw * 0.17))}px monospace`;
    c.textAlign    = 'center';
    c.textBaseline = 'middle';
    c.fillText('BRAIN', cx, cy);

    // Pins
    const pinLen = 4, pinW = 3, pinCount = 3;
    c.fillStyle = '#a78bfa';
    for (let i = 0; i < pinCount; i++) {
      const yp = ph / (pinCount + 1) * (i + 1);
      c.fillRect(0, yp - pinW/2, pinLen, pinW);            // left
      c.fillRect(pw - pinLen, yp - pinW/2, pinLen, pinW);  // right
    }
    for (let i = 0; i < pinCount; i++) {
      const xp = pw / (pinCount + 1) * (i + 1);
      c.fillRect(xp - pinW/2, 0, pinW, pinLen);            // top
      c.fillRect(xp - pinW/2, ph - pinLen, pinW, pinLen);  // bottom
    }

    // Highlight
    c.fillStyle = 'rgba(255,255,255,0.1)';
    c.beginPath(); c.roundRect(2, 2, pw - 4, 4, 2); c.fill();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC: Render the built robot assembly into any canvas context.
  // Used by SimCanvas to show the actual built robot in the simulation.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * @param {CanvasRenderingContext2D} targetCtx
   * @param {Array} configParts  – from getRobotConfig().parts
   * @param {number} centerX     – world x to center the assembly on
   * @param {number} centerY     – world y to center the assembly on
   * @param {number} worldAngle  – overall rotation (robot.angle)
   * @param {number} maxPx       – max pixel size of longest dimension
   * @returns {boolean} false if nothing drawn (no parts)
   */
  function drawAssemblyToContext(targetCtx, configParts, centerX, centerY, worldAngle, maxPx) {
    if (typeof PartRenderers2D !== 'undefined') {
      return PartRenderers2D.drawAssemblyToContext(targetCtx, configParts, centerX, centerY, worldAngle, maxPx);
    }
    return false;
  }

  // ── Robot config export ────────────────────────────────────────────────────

  function getRobotConfig() {
    return {
      parts: placedParts.map(p => {
        const def = getPartDef(p.type);
        return {
          id: p.id,
          type: p.type,
          position: { ...p.position },
          rotation: p.rotation || 0,
          props: { ...p.props },
          snapPoints: getEffectiveSnapPoints(p, def),
          metadata: def ? def.metadata : {}
        };
      }),
      connections: JSON.parse(JSON.stringify(connections))
    };
  }

  let _onConfigChange    = null;
  let _onSelectionChange = null;

  // Debounced auto-save — UI callback fires immediately, storage write batched at 300ms
  let _saveTimer = null;
  function _debouncedSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try {
        localStorage.setItem('robobuilder_build_v2', JSON.stringify({ parts: placedParts, connections }));
      } catch (e) { /* storage full */ }
    }, 300);
  }

  function onRobotConfigChanged() {
    if (_onConfigChange) _onConfigChange(getRobotConfig());
    updateStatus();
    _debouncedSave();
  }

  function notifySelection(placed) {
    if (_onSelectionChange) _onSelectionChange(placed);
  }

  function setOnConfigChange(fn)    { _onConfigChange    = fn; }
  function setOnSelectionChange(fn) { _onSelectionChange = fn; }

  function notifyPropChanged() {
    draw();
    onRobotConfigChanged();
  }

  function updateStatus() {
    const el = document.getElementById('robot-status');
    if (!el) return;
    const types  = placedParts.map(p => p.type);
    const checks = [['brain','Brain'],['motor','Motor'],['wheel','Wheel'],['battery','Battery'],['distance-sensor','Sensor']];
    el.innerHTML = `
      <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
        ${checks.map(([t,n]) => `<span style="color:${types.includes(t)?'#7ed870':'#444'};font-size:0.72rem">&#9679; ${n}</span>`).join('')}
      </div>
      <div style="font-size:0.7rem;color:#555;margin-top:4px">
        Parts: ${placedParts.length} &nbsp;|&nbsp; Wires: ${connections.length}
      </div>
    `;
  }

  // ── History (undo/redo) ────────────────────────────────────────────────────

  function pushHistory() {
    history = history.slice(0, historyIdx + 1);
    history.push({
      parts:       JSON.parse(JSON.stringify(placedParts)),
      connections: JSON.parse(JSON.stringify(connections))
    });
    if (history.length > 40) history.shift();
    historyIdx = history.length - 1;
  }

  function restoreSnap(snap) {
    placedParts = JSON.parse(JSON.stringify(snap.parts       || []));
    connections = JSON.parse(JSON.stringify(snap.connections || []));
  }

  function undo() {
    if (historyIdx <= 0) return;
    historyIdx--;
    restoreSnap(history[historyIdx]);
    selectedId = null; notifySelection(null);
    draw(); onRobotConfigChanged();
  }

  function redo() {
    if (historyIdx >= history.length - 1) return;
    historyIdx++;
    restoreSnap(history[historyIdx]);
    selectedId = null; notifySelection(null);
    draw(); onRobotConfigChanged();
  }

  // ── Save / Load ────────────────────────────────────────────────────────────

  function saveRobot(slotName) {
    const key = 'robobuilder_slot_' + (slotName || 'default');
    localStorage.setItem(key, JSON.stringify({ parts: placedParts, connections }));
  }

  function loadRobot(slotName) {
    try {
      const key  = 'robobuilder_slot_' + (slotName || 'default');
      const data = JSON.parse(localStorage.getItem(key) || 'null');
      if (!data) return false;
      return loadConfig(data);
    } catch (e) { return false; }
  }

  /**
   * Hydrate the canvas from a plain config object (e.g. from cloud sync).
   * @param {{parts?:Array, connections?:Array}} data
   * @returns {boolean} true if at least one valid part was loaded.
   */
  function loadConfig(data) {
    if (!data || typeof data !== 'object') return false;
    const rawParts = Array.isArray(data.parts) ? data.parts : [];
    const filtered = rawParts.filter(p =>
      p && typeof p.id === 'number' && typeof p.type === 'string' &&
      p.position && typeof p.position.x === 'number' && typeof p.position.y === 'number' &&
      getPartDef(p.type) !== null
    );
    placedParts = filtered;
    connections = Array.isArray(data.connections) ? data.connections : [];
    nextId = placedParts.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
    selectedId = null; notifySelection(null);
    draw(); pushHistory(); onRobotConfigChanged();
    return placedParts.length > 0;
  }

  // ── Starter robot ──────────────────────────────────────────────────────────

  function spawnStarterRobot() {
    const cx = Math.round(canvas.width  / 2 / GRID) * GRID;
    const cy = Math.round(canvas.height / 2 / GRID) * GRID;
    placedParts = [];
    nextId      = 1;

    const add = (type, ox, oy, rot) => {
      const def = getPartDef(type);
      if (!def) return;
      const part = {
        id: nextId++,
        type,
        rotation: rot || 0,
        props: buildDefaultProps(def),
        position: { x: Math.round((cx + ox) / GRID) * GRID,
                    y: Math.round((cy + oy) / GRID) * GRID }
      };
      clampPosition(part);
      placedParts.push(part);
    };

    add('c-channel',       -50, -10);   // Left chassis rail
    add('c-channel',       -50,  20);   // Right chassis rail
    add('motor',           -70, -40);   // Left motor (Motor A)
    add('motor',            10, -40);   // Right motor (Motor B)
    add('wheel',           -80,  32);   // Front wheel
    add('wheel',            30,  32);   // Back wheel
    add('distance-sensor', -20, -70);   // Front sensor
    add('brain',            50, -44);   // Brain controller
    add('battery',          50,  10);   // Battery

    // Wire up the robot: battery→brain (power), brain→motors (signal), brain→sensor (signal)
    connections = [];
    const battPart   = placedParts.find(p => p.type === 'battery');
    const brainPart  = placedParts.find(p => p.type === 'brain');
    const motors     = placedParts.filter(p => p.type === 'motor');
    const sensPart   = placedParts.find(p => p.type === 'distance-sensor');
    if (battPart && brainPart)  connections.push({ fromId: battPart.id,  toId: brainPart.id,  wireType: 'power'  });
    motors.forEach(m => {
      if (brainPart) connections.push({ fromId: brainPart.id, toId: m.id, wireType: 'signal' });
    });
    if (brainPart && sensPart)  connections.push({ fromId: brainPart.id, toId: sensPart.id,   wireType: 'signal' });

    selectedId = null; notifySelection(null);
    draw(); pushHistory(); onRobotConfigChanged();
  }

  function redraw() { draw(); }

  // ── Programmatic connection (used by build tutorial helpers) ──────────────
  function addConnection(fromId, toId, wireType) {
    // Remove existing connection between these two if any
    connections = connections.filter(function (c) {
      return !((c.fromId === fromId && c.toId === toId) ||
               (c.fromId === toId && c.toId === fromId));
    });
    connections.push({ fromId: fromId, toId: toId, wireType: wireType });
    draw(); pushHistory(); onRobotConfigChanged();
  }

  return {
    init, setActiveTool, resetCanvas,
    startNewPartDrag, getRobotConfig, getConnections,
    setOnConfigChange, setOnSelectionChange,
    notifyPropChanged, notifyConfigOnly: function() { if (_onConfigChange) _onConfigChange(getRobotConfig()); },
    drawAssemblyToContext,
    getPlacedParts() { return placedParts; },
    spawnStarterRobot, saveRobot, loadRobot, loadConfig,
    addConnection,
    undo, redo, redraw
  };
})();
