// Test Canvas 3D — full-bleed 3D field renderer for the Test tab.
// Renders the assembled robot, lesson obstacles, goal zone, and 3D field-outline
// barriers, all driven by the existing 2D SimEngine state (sim pixels → world units).
//
// Camera: OrthographicCamera with manual orbit (right-drag) + pan (middle-drag) +
// wheel zoom — modeled on BuildCanvas3D so the user gets the same feel.
//
// Sharing: For V1 this file and codeCanvas3D.js are intentional siblings (option (a)
// from the spec). The only meaningful diff is whether interaction listeners are
// attached. If we extract a shared core/three3DScene.js helper later, both files
// become thin wrappers — but that requires touching index.html load order, so
// keep the duplication for now.
//
// Depends on: THREE (UMD global), SimEngine, and BuildCanvas3D's createPartMesh
// (re-implemented here so the Test tab works even if BuildCanvas3D was never
// initialised; we deliberately don't reach into its private state).

const TestCanvas3D = (() => {
  'use strict';

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (typeof THREE === 'undefined') {
    console.warn('[TestCanvas3D] THREE not loaded — module disabled.');
    return null;
  }

  // ── Coordinate mapping (mirror of BuildCanvas3D.getRobotConfig) ────────────
  // Inverse of: simX = world.x * 40 + 200, simY = world.z * 40 + 150
  const SCALE      = 40;
  const OFFSET_X   = 200;
  const OFFSET_Y   = 150;
  const simToWorldX = (simX) => (simX - OFFSET_X) / SCALE;
  const simToWorldZ = (simY) => (simY - OFFSET_Y) / SCALE;

  // Field barriers — same height for every edge, every lesson.
  const FIELD_BARRIER_HEIGHT = 0.75; // ≈ 30 sim px

  // ── State ──────────────────────────────────────────────────────────────────
  let scene, camera, renderer;
  let groundPlane = null;
  let gridHelper  = null;
  let container   = null;
  let animFrameId = null;
  let isActive    = true;
  let _onVisibilityChange  = null;
  let _onTickCb            = null;
  let _onContextMenu       = null; // stored so destroy() can remove it

  // Scene roots — keeps cleanup focused, avoids walking the whole scene graph.
  let robotRoot   = null; // THREE.Group containing the assembled-robot meshes
  let obstaclesRoot = null;
  let barriersRoot  = null;
  let goalRoot      = null;
  let goalRing      = null; // pulsing emissive ring (animated in animate())
  let goalPad       = null;

  let robotConfig    = { parts: [] };
  let obstacles      = [];
  let goalZoneConfig = null;

  // Manual orbit + pan controls (matches BuildCanvas3D)
  const _orbit = {
    active: false, lastX: 0, lastY: 0,
    theta: Math.PI / 4,
    phi:   Math.acos(1 / Math.sqrt(3)),
    radius: Math.sqrt(300)
  };
  const _pan = { active: false, lastX: 0, lastY: 0 };
  const _orbitTarget = new THREE.Vector3(0, 0.5, 0.75); // arena center-ish
  let _targetZoom = 1.0;

  // Materials (instantiated in initMaterials)
  const M = {};

  // ── Materials ──────────────────────────────────────────────────────────────

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function getThemeSceneColor() {
    return isDark() ? 0x0f172a : 0xf0f2f5;
  }

  function getThemeGridColors() {
    return isDark()
      ? { major: 0x334155, minor: 0x1e293b, ground: 0x1e293b }
      : { major: 0xd1d5db, minor: 0xe5e7eb, ground: 0xf8fafc };
  }

  function initMaterials() {
    Object.values(M).forEach(m => { if (m && m.dispose) m.dispose(); });
    const dark = isDark();
    M.metal     = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3, metalness: 0.7 });
    M.motor     = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.4, metalness: 0.5 });
    M.wheelHub  = new THREE.MeshStandardMaterial({ color: dark ? 0x1e293b : 0x374151, roughness: 0.8 });
    M.tire      = new THREE.MeshStandardMaterial({ color: dark ? 0x334155 : 0x1f2937, roughness: 0.9 });
    M.brain     = new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.4, metalness: 0.3 });
    M.battery   = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5, metalness: 0.3 });
    M.sensor    = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.4 });
    M.shaft     = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.9, roughness: 0.1 });
    M.hole      = new THREE.MeshBasicMaterial({ color: dark ? 0x0f172a : 0xd1d5db });
    M.screen    = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    M.port      = new THREE.MeshStandardMaterial({ color: 0x7c3aed });
    M.terminal  = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.8 });
    M.lens      = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.8 });
    M.obstacle  = new THREE.MeshStandardMaterial({ color: dark ? 0x475569 : 0x374151, roughness: 0.7, metalness: 0.1 });
    M.barrier   = new THREE.MeshStandardMaterial({ color: dark ? 0x64748b : 0x9ca3af, roughness: 0.5, metalness: 0.2 });
    M.goalPad   = new THREE.MeshStandardMaterial({
      color: 0x10b981, transparent: true, opacity: 0.28,
      emissive: 0x10b981, emissiveIntensity: 0.4,
      roughness: 0.6, metalness: 0.1, depthWrite: false
    });
    M.goalRing  = new THREE.MeshBasicMaterial({
      color: 0x10b981, transparent: true, opacity: 0.85, side: THREE.DoubleSide
    });
  }

  // ── Disposal helper ────────────────────────────────────────────────────────

  function disposeMesh(obj) {
    if (!obj) return;
    obj.traverse(child => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else if (child.material) child.material.dispose();
      }
    });
  }

  function clearGroup(group) {
    if (!group) return;
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      disposeMesh(child);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  function init(containerEl) {
    container = typeof containerEl === 'string'
      ? document.getElementById(containerEl)
      : containerEl;
    if (!container) {
      console.error('[TestCanvas3D] Container not found');
      return;
    }
    // Idempotent: re-init reuses the existing scene.
    if (renderer) return;

    initMaterials();

    scene = new THREE.Scene();
    scene.background = new THREE.Color(getThemeSceneColor());

    const W = container.clientWidth  || 800;
    const H = container.clientHeight || 600;
    const aspect = W / H;
    const frustum = 8;
    camera = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect, frustum, -frustum, 0.1, 100
    );
    camera.zoom = _targetZoom;
    updateCameraOrbit();

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    renderer.domElement.id = 'test-canvas-3d';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width   = '100%';
    renderer.domElement.style.height  = '100%';
    container.appendChild(renderer.domElement);

    // Lighting (matches BuildCanvas3D feel)
    const ambient = new THREE.AmbientLight(0x94a3b8, 0.6);
    scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 12, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far  = 30;
    dir.shadow.camera.left   = -10;
    dir.shadow.camera.right  =  10;
    dir.shadow.camera.top    =  10;
    dir.shadow.camera.bottom = -10;
    scene.add(dir);

    const fill = new THREE.DirectionalLight(0x60a5fa, 0.3);
    fill.position.set(-5, 4, -3);
    scene.add(fill);

    rebuildGround();

    // Scene roots
    robotRoot     = new THREE.Group(); scene.add(robotRoot);
    obstaclesRoot = new THREE.Group(); scene.add(obstaclesRoot);
    barriersRoot  = new THREE.Group(); scene.add(barriersRoot);
    goalRoot      = new THREE.Group(); scene.add(goalRoot);

    // Always render barriers — they don't depend on lesson data.
    rebuildBarriers();

    // Interaction (orbit + pan + zoom)
    _onContextMenu = e => e.preventDefault();
    renderer.domElement.addEventListener('mousedown',  onMouseDown);
    renderer.domElement.addEventListener('contextmenu', _onContextMenu);
    renderer.domElement.addEventListener('wheel',      onWheel, { passive: false });
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup',   onWindowMouseUp);
    window.addEventListener('resize',    onResize);

    // Pause when tab hidden
    _onVisibilityChange = () => {
      if (document.hidden) {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
      } else if (isActive && !animFrameId) {
        animate();
      }
    };
    document.addEventListener('visibilitychange', _onVisibilityChange);

    // Per-tick draw hook on SimEngine — keeps robot pose synced to physics.
    // We do NOT replace any existing setOnTick consumer; app.js owns lifecycle
    // and is expected to call setActive(false) on the others.
    if (typeof SimEngine !== 'undefined' && SimEngine.setOnTick) {
      _onTickCb = () => { /* animate() reads SimEngine state directly */ };
      // Intentionally no-op: animate() polls SimEngine.getRobot() each frame.
    }

    // Apply any state set before init was called
    rebuildRobot();
    rebuildObstacles();
    rebuildGoalZone();

    if (isActive) animate();
  }

  // ── Render loop ────────────────────────────────────────────────────────────

  let _time = 0;
  function animate() {
    if (!isActive) { animFrameId = null; return; }
    animFrameId = requestAnimationFrame(animate);
    _time += 0.016;

    // Smooth zoom lerp
    if (camera && Math.abs(camera.zoom - _targetZoom) > 0.001) {
      camera.zoom += (_targetZoom - camera.zoom) * 0.14;
      camera.updateProjectionMatrix();
    }

    // Sync robot pose from SimEngine (single source of truth)
    if (robotRoot && typeof SimEngine !== 'undefined') {
      const r = SimEngine.getRobot();
      robotRoot.position.x = simToWorldX(r.x);
      robotRoot.position.z = simToWorldZ(r.y);
      robotRoot.rotation.y = -r.angle; // sim y-down → three z-forward
    }

    // Pulse goal zone
    if (goalRing && goalPad) {
      const pulse = 0.5 + 0.5 * Math.sin(_time * 3.5);
      goalRing.scale.setScalar(1 + pulse * 0.18);
      goalRing.material.opacity = 0.45 + pulse * 0.4;
      goalPad.material.emissiveIntensity = 0.25 + pulse * 0.35;
    }

    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  function updateCameraOrbit() {
    if (!camera) return;
    const x = _orbitTarget.x + _orbit.radius * Math.sin(_orbit.phi) * Math.cos(_orbit.theta);
    const y = _orbitTarget.y + _orbit.radius * Math.cos(_orbit.phi);
    const z = _orbitTarget.z + _orbit.radius * Math.sin(_orbit.phi) * Math.sin(_orbit.theta);
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(_orbitTarget);
    camera.updateProjectionMatrix();
  }

  function onResize() {
    if (!container || !camera || !renderer) return;
    const W = container.clientWidth;
    const H = container.clientHeight;
    if (W === 0 || H === 0) return;
    const aspect = W / H;
    const frustum = 8;
    camera.left   = -frustum * aspect;
    camera.right  =  frustum * aspect;
    camera.top    =  frustum;
    camera.bottom = -frustum;
    camera.updateProjectionMatrix();
    renderer.setSize(W, H);
  }

  // ── Mouse / wheel ──────────────────────────────────────────────────────────

  function onMouseDown(e) {
    if (e.button === 2) {
      _orbit.active = true;
      _orbit.lastX  = e.clientX;
      _orbit.lastY  = e.clientY;
    } else if (e.button === 1) {
      e.preventDefault();
      _pan.active = true;
      _pan.lastX  = e.clientX;
      _pan.lastY  = e.clientY;
    }
  }

  function onWindowMouseMove(e) {
    if (_orbit.active) {
      const dx = e.clientX - _orbit.lastX;
      const dy = e.clientY - _orbit.lastY;
      _orbit.theta += dx * 0.008;
      _orbit.phi    = Math.max(0.1, Math.min(Math.PI * 0.48, _orbit.phi - dy * 0.008));
      _orbit.lastX  = e.clientX;
      _orbit.lastY  = e.clientY;
      updateCameraOrbit();
    }
    if (_pan.active && camera && renderer) {
      const dx = e.clientX - _pan.lastX;
      const dy = e.clientY - _pan.lastY;
      const H = renderer.domElement.clientHeight || 600;
      const scale = (8 * 2) / H / camera.zoom;
      const right = new THREE.Vector3();
      const up    = new THREE.Vector3();
      camera.getWorldDirection(right);
      right.crossVectors(right, camera.up).normalize();
      up.copy(camera.up);
      _orbitTarget.addScaledVector(right, -dx * scale);
      _orbitTarget.addScaledVector(up,     dy * scale);
      _pan.lastX = e.clientX;
      _pan.lastY = e.clientY;
      updateCameraOrbit();
    }
  }

  function onWindowMouseUp(e) {
    if (e.button === 2) _orbit.active = false;
    if (e.button === 1) _pan.active   = false;
  }

  function onWheel(e) {
    e.preventDefault();
    _targetZoom = Math.max(0.5, Math.min(3.5, _targetZoom - e.deltaY * 0.0015));
  }

  // ── Ground / Grid ──────────────────────────────────────────────────────────
  // Arena is 440x360 sim px → 11x9 world units. We render a slightly larger
  // ground plane and a grid sized to the arena.

  function rebuildGround() {
    const arenaW = 11;  // 440 / 40
    const arenaH = 9;   // 360 / 40

    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.geometry?.dispose();
      if (Array.isArray(gridHelper.material)) gridHelper.material.forEach(m => m.dispose());
      else gridHelper.material?.dispose();
      gridHelper = null;
    }
    if (groundPlane) {
      scene.remove(groundPlane);
      groundPlane.geometry.dispose();
      groundPlane.material.dispose();
      groundPlane = null;
    }

    const colors = getThemeGridColors();

    // Ground plane: sized to arena footprint, centered at the arena midpoint
    // in world coords. Arena spans worldX [-5, 6], worldZ [-3.75, 5.25].
    const groundGeo = new THREE.PlaneGeometry(arenaW, arenaH);
    const groundMat = new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 0.95 });
    groundPlane = new THREE.Mesh(groundGeo, groundMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.set(0.5, -0.02, 0.75); // arena center: ((-5+6)/2, (-3.75+5.25)/2)
    groundPlane.receiveShadow = true;
    scene.add(groundPlane);

    // Grid: GridHelper is square — use the larger arena dimension and clamp visually.
    const gridSize = Math.max(arenaW, arenaH);
    gridHelper = new THREE.GridHelper(gridSize, gridSize, colors.major, colors.minor);
    gridHelper.position.set(0.5, -0.01, 0.75);
    scene.add(gridHelper);
  }

  // ── Field barriers (perimeter walls along the arena outline) ───────────────

  function rebuildBarriers() {
    if (!barriersRoot) return;
    clearGroup(barriersRoot);

    // Arena rect in world coords:
    //   x: [-5, 6]  (width 11)
    //   z: [-3.75, 5.25] (height 9)
    const minX = -5, maxX = 6;
    const minZ = -3.75, maxZ = 5.25;
    const wallThickness = 0.2;
    const h = FIELD_BARRIER_HEIGHT;

    const segments = [
      // [centerX, centerZ, sizeX, sizeZ]
      [(minX + maxX) / 2, minZ - wallThickness / 2, (maxX - minX) + wallThickness * 2, wallThickness], // top
      [(minX + maxX) / 2, maxZ + wallThickness / 2, (maxX - minX) + wallThickness * 2, wallThickness], // bottom
      [minX - wallThickness / 2, (minZ + maxZ) / 2, wallThickness, (maxZ - minZ)], // left
      [maxX + wallThickness / 2, (minZ + maxZ) / 2, wallThickness, (maxZ - minZ)], // right
    ];

    segments.forEach(([cx, cz, sx, sz]) => {
      const geo = new THREE.BoxGeometry(sx, h, sz);
      const mesh = new THREE.Mesh(geo, M.barrier);
      mesh.position.set(cx, h / 2, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      barriersRoot.add(mesh);
    });
  }

  // ── Obstacles ──────────────────────────────────────────────────────────────

  function rebuildObstacles() {
    if (!obstaclesRoot) return;
    clearGroup(obstaclesRoot);
    if (!Array.isArray(obstacles)) return;

    obstacles.forEach(obs => {
      // Obstacle in sim coords: top-left (x,y), width, height.
      const wx = simToWorldX(obs.x + obs.width  / 2);
      const wz = simToWorldZ(obs.y + obs.height / 2);
      const sx = obs.width  / SCALE;
      const sz = obs.height / SCALE;
      const h  = (typeof obs.obstacleHeight === 'number' && isFinite(obs.obstacleHeight))
        ? obs.obstacleHeight
        : FIELD_BARRIER_HEIGHT;

      const geo = new THREE.BoxGeometry(sx, h, sz);
      const mesh = new THREE.Mesh(geo, M.obstacle);
      mesh.position.set(wx, h / 2, wz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      obstaclesRoot.add(mesh);
    });
  }

  // ── Goal zone ──────────────────────────────────────────────────────────────

  function rebuildGoalZone() {
    if (!goalRoot) return;
    clearGroup(goalRoot);
    goalPad = null;
    goalRing = null;
    if (!goalZoneConfig) return;

    const z = goalZoneConfig;
    const wx = simToWorldX(z.x + z.width  / 2);
    const wz = simToWorldZ(z.y + z.height / 2);
    const sx = z.width  / SCALE;
    const sz = z.height / SCALE;

    // Flat semi-transparent pad sitting just above the ground
    const padGeo = new THREE.PlaneGeometry(sx, sz);
    goalPad = new THREE.Mesh(padGeo, M.goalPad.clone());
    goalPad.rotation.x = -Math.PI / 2;
    goalPad.position.set(wx, 0.01, wz);
    goalRoot.add(goalPad);

    // Pulsing emissive ring (animated in animate())
    const ringInner = Math.max(0.05, Math.min(sx, sz) * 0.42);
    const ringOuter = ringInner + 0.08;
    const ringGeo = new THREE.RingGeometry(ringInner, ringOuter, 48);
    goalRing = new THREE.Mesh(ringGeo, M.goalRing.clone());
    goalRing.rotation.x = -Math.PI / 2;
    goalRing.position.set(wx, 0.02, wz);
    goalRoot.add(goalRing);
  }

  // ── Robot mesh (built from robotConfig.parts in sim coords) ────────────────

  function rebuildRobot() {
    if (!robotRoot) return;
    clearGroup(robotRoot);
    if (!robotConfig || !Array.isArray(robotConfig.parts) || robotConfig.parts.length === 0) {
      addGenericRobot(robotRoot);
      return;
    }

    // Compute assembly bbox in sim coords so we can recenter parts around (0,0,0).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    robotConfig.parts.forEach(p => {
      const def = (typeof getPartDef === 'function') ? getPartDef(p.type) : null;
      const pw = def ? getEffectiveW(p, def) : 32;
      const ph = def ? getEffectiveH(p, def) : 22;
      minX = Math.min(minX, p.position.x);
      minY = Math.min(minY, p.position.y);
      maxX = Math.max(maxX, p.position.x + pw);
      maxY = Math.max(maxY, p.position.y + ph);
    });
    if (!isFinite(minX)) { addGenericRobot(robotRoot); return; }
    const cxSim = (minX + maxX) / 2;
    const cySim = (minY + maxY) / 2;

    robotConfig.parts.forEach(p => {
      const def = (typeof getPartDef === 'function') ? getPartDef(p.type) : null;
      const pw  = def ? getEffectiveW(p, def) : 32;
      const ph  = def ? getEffectiveH(p, def) : 22;
      const partCxSim = p.position.x + pw / 2;
      const partCySim = p.position.y + ph / 2;
      // Local offset relative to robot center, in world units
      const lx = (partCxSim - cxSim) / SCALE;
      const lz = (partCySim - cySim) / SCALE;

      const mesh = createPartMesh(p.type, p.props || {});
      mesh.position.set(lx, 0, lz);
      mesh.rotation.y = (p.rotation || 0);
      robotRoot.add(mesh);
    });
  }

  function addGenericRobot(parent) {
    // Simple placeholder when no parts are configured — same dimensions as
    // SimEngine's default robot (32x22 sim px → 0.8x0.55 world units).
    const w = 32 / SCALE, d = 22 / SCALE;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.25, d),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4, metalness: 0.3 })
    );
    body.position.y = 0.125;
    body.castShadow = true;
    parent.add(body);
    // Direction nub
    const nub = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0xec4899 })
    );
    nub.position.set(w / 2 + 0.08, 0.125, 0);
    nub.rotation.z = -Math.PI / 2;
    parent.add(nub);
  }

  // ── Part Mesh Factories (mirror of BuildCanvas3D's set, no snap indicators) ─
  // We keep these in-file so the Test tab does not depend on BuildCanvas3D
  // ever being initialised. Visual parity is required by the spec.

  function createCChannel(lengthUnits) {
    const length = (lengthUnits || 5) * 0.7;
    const group = new THREE.Group();

    const bottom = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, 1), M.metal.clone());
    bottom.castShadow = true;
    group.add(bottom);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(length, 0.5, 0.1), M.metal.clone());
    leftWall.position.set(0, 0.25, -0.45);
    leftWall.castShadow = true;
    group.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(length, 0.5, 0.1), M.metal.clone());
    rightWall.position.set(0, 0.25, 0.45);
    rightWall.castShadow = true;
    group.add(rightWall);

    const holeCount = Math.max(1, Math.floor(length / 0.7));
    for (let i = 0; i < holeCount; i++) {
      const hx = -length / 2 + 0.35 + i * 0.7;
      const hole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8),
        M.hole.clone()
      );
      hole.position.set(hx, 0.06, 0);
      hole.rotation.x = Math.PI / 2;
      group.add(hole);
    }
    return group;
  }

  function createMotor() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.7), M.motor.clone());
    body.castShadow = true;
    group.add(body);
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.4, 12),
      M.shaft.clone()
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0, 0.55);
    shaft.castShadow = true;
    group.add(shaft);
    return group;
  }

  function createWheel() {
    const group = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.35, 24), M.tire.clone());
    tire.rotation.x = Math.PI / 2;
    tire.castShadow = true;
    group.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.37, 16), M.wheelHub.clone());
    hub.rotation.x = Math.PI / 2;
    hub.castShadow = true;
    group.add(hub);
    const center = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.38, 8),
      M.shaft.clone()
    );
    center.rotation.x = Math.PI / 2;
    group.add(center);
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.35), M.wheelHub.clone());
      const angle = (i / 5) * Math.PI * 2;
      spoke.position.set(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, 0);
      spoke.rotation.z = angle;
      group.add(spoke);
    }
    return group;
  }

  function createBrain() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.8), M.brain.clone());
    body.castShadow = true;
    group.add(body);
    for (let i = 0; i < 4; i++) {
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.1), M.port.clone());
      port.position.set(-0.4 + i * 0.27, 0.24, 0.35);
      group.add(port);
    }
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), M.screen.clone());
    screen.position.set(0, 0.21, 0);
    screen.rotation.x = -Math.PI / 2;
    group.add(screen);
    return group;
  }

  function createBattery() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.6), M.battery.clone());
    body.castShadow = true;
    group.add(body);
    const terminal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.15, 8),
      M.terminal.clone()
    );
    terminal.position.set(0.35, 0.3, 0);
    group.add(terminal);
    return group;
  }

  function createSensor() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), M.sensor.clone());
    body.castShadow = true;
    group.add(body);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), M.lens.clone());
    lens.position.set(0.26, 0, 0);
    group.add(lens);
    return group;
  }

  function createPartMesh(partType, props) {
    switch (partType) {
      case 'c-channel': {
        const lengthPx = (props && props.length) || 100;
        const holeCount = Math.max(2, Math.round(lengthPx / 20));
        return createCChannel(holeCount);
      }
      case 'motor':           return createMotor();
      case 'wheel':           return createWheel();
      case 'brain':           return createBrain();
      case 'battery':         return createBattery();
      case 'distance-sensor': return createSensor();
      default: {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(
          new THREE.BoxGeometry(0.5, 0.5, 0.5),
          new THREE.MeshStandardMaterial({ color: 0x888888 })
        ));
        return g;
      }
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function setRobotConfig(cfg) {
    robotConfig = cfg || { parts: [] };
    if (robotRoot) rebuildRobot();
  }

  function setObstacles(obs) {
    obstacles = Array.isArray(obs) ? obs : [];
    if (obstaclesRoot) rebuildObstacles();
  }

  function setGoalZoneConfig(zone) {
    goalZoneConfig = zone || null;
    if (goalRoot) rebuildGoalZone();
  }

  function setActive(active) {
    const wantActive = !!active;
    if (wantActive === isActive) {
      if (wantActive && !animFrameId && renderer) animate();
      return;
    }
    isActive = wantActive;
    if (isActive) {
      if (renderer && !animFrameId) animate();
    } else if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function destroy() {
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
    isActive = false;
    if (_onVisibilityChange) {
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      _onVisibilityChange = null;
    }
    if (renderer) {
      renderer.domElement.removeEventListener('mousedown',  onMouseDown);
      renderer.domElement.removeEventListener('contextmenu', _onContextMenu);
      renderer.domElement.removeEventListener('wheel',       onWheel);
      _onContextMenu = null;
    }
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup',   onWindowMouseUp);
    window.removeEventListener('resize',    onResize);

    if (scene) {
      [robotRoot, obstaclesRoot, barriersRoot, goalRoot].forEach(g => {
        if (!g) return;
        clearGroup(g);
        scene.remove(g);
      });
      if (gridHelper)  { scene.remove(gridHelper); gridHelper.geometry?.dispose(); if (Array.isArray(gridHelper.material)) gridHelper.material.forEach(m => m.dispose()); else gridHelper.material?.dispose?.(); }
      if (groundPlane) { scene.remove(groundPlane); groundPlane.geometry.dispose(); groundPlane.material.dispose(); }
    }
    Object.values(M).forEach(m => { if (m && m.dispose) m.dispose(); });
    if (renderer) {
      renderer.dispose();
      if (renderer.domElement.parentElement) renderer.domElement.remove();
    }
    scene = camera = renderer = null;
    robotRoot = obstaclesRoot = barriersRoot = goalRoot = null;
    goalPad = goalRing = gridHelper = groundPlane = null;
    container = null;
  }

  return {
    init,
    setRobotConfig,
    setObstacles,
    setGoalZoneConfig,
    setActive,
    destroy,
  };
})();

if (typeof window !== 'undefined') window.TestCanvas3D = TestCanvas3D;
