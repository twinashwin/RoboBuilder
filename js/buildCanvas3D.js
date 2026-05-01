// Build Canvas 3D – Three.js-based isometric assembly workspace.
// Replaces the 2D buildCanvas for the Build tab while keeping the same
// public API surface so app.js can switch between them seamlessly.
// Depends on: THREE (UMD global), partDefs.js, snapSystem.js

const BuildCanvas3D = (() => {
  'use strict';

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (typeof THREE === 'undefined') {
    console.warn('[BuildCanvas3D] THREE not loaded — module disabled.');
    return null;
  }

  // ── State ───────────────────────────────────────────────────────────────────
  let scene, camera, renderer, groundPlane, gridHelper;
  let container = null;
  let animFrameId = null;
  let placedParts  = [];  // { id, type, position:{x,y,z}, rotation:radians, props:{} }
  let connections  = [];  // { fromId, toId, wireType:'power'|'signal' }
  let selectedId   = null;
  let activeTool   = 'select';
  let nextId       = 1;
  let history      = [];
  let historyIdx   = -1;
  let pendingWireFrom = null;
  let _onVisibilityChange = null;
  // Manual orbit + pan state (replaces OrbitControls — CDN path removed in three r152)
  const _orbit = {
    active: false, lastX: 0, lastY: 0,
    theta: Math.PI / 4,                      // azimuth matching camera start (10,10,10)
    phi:   Math.acos(1 / Math.sqrt(3)),       // polar  matching camera start (10,10,10)
    radius: Math.sqrt(300)                    // ~17.32
  };
  const _pan = { active: false, lastX: 0, lastY: 0 };
  const _orbitTarget = new THREE.Vector3(0, 0, 0); // point camera orbits around

  // Hover highlight state (NB-8)
  let _hoveredPartId = null;

  // Placement bounce animations (NB-3)
  let _placementAnimations = [];  // { mesh, startTime, duration }

  // 3D scene state
  let partMeshes     = new Map(); // partId -> THREE.Group
  let wireMeshes     = [];        // THREE.Mesh[] for wires
  let selectionBox   = null;      // THREE.BoxHelper for selected part
  let ghostMesh      = null;      // semi-transparent preview mesh
  let ghostPartType  = null;      // type being placed
  let ghostRotation  = 0;         // rotation for ghost/placement
  let placementMode  = false;     // true when a part from palette is active
  let snapIndicators = [];        // snap point highlight meshes
  let _ghostIsSnap   = false;     // tracks ghost material state to avoid per-frame clone
  let _targetZoom    = 1.3;       // smooth zoom target (NB-B)

  // Build-tutorial ghost (separate from placementMode ghost). Set via the
  // window._buildTutorialGetGhost() global; rendered every frame in animate().
  let _tutGhostMesh        = null;  // THREE.Group
  let _tutGhostKey         = '';    // cache key 'type|x|z|rot|len' to avoid rebuild

  // Raycasting
  const raycaster = new THREE.Raycaster();
  const mouse     = new THREE.Vector2();
  const mouseWorld = new THREE.Vector3();

  // Interaction state
  const drag = {
    active: false,
    mode: null,       // 'move' | null
    partId: null,
    startPos: null,   // original position before drag
    offset: new THREE.Vector3()
  };

  const GRID = 1;  // 3D grid unit size (1 world unit = 1 grid cell)
  const GRID_HALF = 7.5; // half the visible grid extent — clamps parts to boundary (NB-D)

  // ── Disposal Helper ────────────────────────────────────────────────────────

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

  // ── Materials ───────────────────────────────────────────────────────────────

  function getThemeSceneColor() {
    const tc = window._themeColors || {};
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return isDark ? 0x0f172a : 0xf0f2f5;
  }

  function getThemeGridColors() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return isDark
      ? { major: 0x334155, minor: 0x1e293b, ground: 0x1e293b }
      : { major: 0xd1d5db, minor: 0xe5e7eb, ground: 0xf8fafc };
  }

  // Part material definitions (matching the mockup)
  const MATERIALS = {};
  function initMaterials() {
    Object.values(MATERIALS).forEach(m => { if (m && m.dispose) m.dispose(); });
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    MATERIALS.metal   = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3, metalness: 0.7 });
    MATERIALS.motor   = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.4, metalness: 0.5 });
    MATERIALS.wheelHub = new THREE.MeshStandardMaterial({ color: isDark ? 0x1e293b : 0x374151, roughness: 0.8 });
    MATERIALS.tire    = new THREE.MeshStandardMaterial({ color: isDark ? 0x334155 : 0x1f2937, roughness: 0.9 });
    MATERIALS.brain   = new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.4, metalness: 0.3 });
    MATERIALS.battery = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5, metalness: 0.3 });
    MATERIALS.sensor  = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.4 });
    MATERIALS.shaft   = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, metalness: 0.9, roughness: 0.1 });
    MATERIALS.select  = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.3, metalness: 0.5, emissive: 0x3b82f6, emissiveIntensity: 0.3 });
    MATERIALS.ghost   = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    MATERIALS.ghostSnap = new THREE.MeshStandardMaterial({ color: 0x22c55e, transparent: true, opacity: 0.5, depthWrite: false });
    MATERIALS.snapDot = new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.6 });
    MATERIALS.screen  = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    MATERIALS.port    = new THREE.MeshStandardMaterial({ color: 0x7c3aed });
    MATERIALS.terminal = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.8 });
    MATERIALS.lens    = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.1, metalness: 0.8 });
    MATERIALS.hole    = new THREE.MeshBasicMaterial({ color: isDark ? 0x0f172a : 0xd1d5db });
    MATERIALS.cpu     = new THREE.MeshStandardMaterial({ color: 0x1e1b4b });
    MATERIALS.cpuLabel = new THREE.MeshBasicMaterial({ color: 0xddd6fe });
    MATERIALS.pin     = new THREE.MeshStandardMaterial({ color: 0xa78bfa });
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init(containerId) {
    container = typeof containerId === 'string'
      ? document.getElementById(containerId)
      : containerId;
    if (!container) { console.error('[BuildCanvas3D] Container not found'); return; }

    initMaterials();

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(getThemeSceneColor());

    // Camera — orthographic isometric
    const W = container.clientWidth  || 800;
    const H = container.clientHeight || 600;
    const aspect = W / H;
    const frustum = 8;
    camera = new THREE.OrthographicCamera(
      -frustum * aspect, frustum * aspect, frustum, -frustum, 0.1, 100
    );
    camera.position.set(10, 10, 10);
    camera.lookAt(0, 0, 0);
    camera.zoom = 1.3;
    camera.updateProjectionMatrix();

    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // Replace the 2D canvas in the container
    const oldCanvas = container.querySelector('canvas');
    if (oldCanvas) oldCanvas.style.display = 'none';
    renderer.domElement.id = 'build-canvas-3d';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width  = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0x94a3b8, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 12, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far  = 30;
    dirLight.shadow.camera.left   = -10;
    dirLight.shadow.camera.right  =  10;
    dirLight.shadow.camera.top    =  10;
    dirLight.shadow.camera.bottom = -10;
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x60a5fa, 0.3);
    fillLight.position.set(-5, 4, -3);
    scene.add(fillLight);

    // Store refs for theme updates
    scene.userData.ambientLight = ambientLight;
    scene.userData.dirLight     = dirLight;
    scene.userData.fillLight    = fillLight;

    // Grid + ground
    rebuildGrid();

    // Events
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('mouseup',   onMouseUp);
    renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
    // Orbit tracking must be window-level: browsers stop delivering canvas
    // mousemove/mouseup during a right-click drag gesture
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup',   onWindowMouseUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);

    // Smooth zoom via wheel — works with or without OrbitControls (NB-B)
    renderer.domElement.addEventListener('wheel', (e) => {
      const delta = e.deltaY * 0.0005;
      _targetZoom = Math.max(0.6, Math.min(3, _targetZoom - delta));
    }, { passive: true, capture: true });

    // Pause render loop when tab is hidden to save resources
    _onVisibilityChange = () => {
      if (document.hidden) { cancelAnimationFrame(animFrameId); animFrameId = null; }
      else if (!animFrameId) animate();
    };
    document.addEventListener('visibilitychange', _onVisibilityChange);

    // Load saved build
    loadFromStorage();

    // Start render loop
    animate();

    // Sync initial state
    pushHistory();
    _fireConfigChange();
  }

  function destroy() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    _disposeTutGhost();
    if (_onVisibilityChange) {
      document.removeEventListener('visibilitychange', _onVisibilityChange);
      _onVisibilityChange = null;
    }
    _orbit.active = false;
    _pan.active   = false;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    if (scene) {
      scene.traverse(child => {
        if (child.isMesh || child.isLineSegments) {
          if (child.geometry) child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else if (child.material) child.material.dispose();
        }
      });
    }
    if (renderer) {
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      renderer.domElement.removeEventListener('mousemove', onMouseMove);
      renderer.domElement.removeEventListener('mouseup',   onMouseUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup',   onWindowMouseUp);
      renderer.dispose();
      if (renderer.domElement.parentElement) renderer.domElement.remove();
    }
    if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
    scene = null; camera = null; renderer = null;
  }

  // ── Grid & Ground ──────────────────────────────────────────────────────────

  function rebuildGrid() {
    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.geometry?.dispose();
      if (Array.isArray(gridHelper.material)) gridHelper.material.forEach(m => m.dispose());
      else gridHelper.material?.dispose();
    }
    if (groundPlane) { scene.remove(groundPlane); groundPlane.geometry.dispose(); groundPlane.material.dispose(); }

    const colors = getThemeGridColors();

    gridHelper = new THREE.GridHelper(16, 16, colors.major, colors.minor);
    gridHelper.position.y = -0.01;
    scene.add(gridHelper);

    const groundGeo = new THREE.PlaneGeometry(16, 16);
    const groundMat = new THREE.MeshStandardMaterial({ color: colors.ground, roughness: 0.9 });
    groundPlane = new THREE.Mesh(groundGeo, groundMat);
    groundPlane.rotation.x = -Math.PI / 2;
    groundPlane.position.y = -0.02;
    groundPlane.receiveShadow = true;
    groundPlane.userData.isGround = true;
    scene.add(groundPlane);

  }

  // ── Animation Loop ─────────────────────────────────────────────────────────

  let _time = 0;
  function animate() {
    animFrameId = requestAnimationFrame(animate);
    _time += 0.005;

    // Pulse selection highlight
    if (selectionBox && selectedId !== null) {
      const part = partMeshes.get(selectedId);
      if (part) {
        selectionBox.update();
        // Subtle emissive pulse on selected part body
        part.traverse(child => {
          if (child.isMesh && child.material && child.material.userData && child.material.userData.isSelectMat) {
            child.material.emissiveIntensity = 0.2 + Math.sin(_time * 8) * 0.1;
          }
        });
      }
    }

    // Pulse snap indicators
    snapIndicators.forEach(ind => {
      const s = 1 + Math.sin(_time * 10) * 0.3;
      ind.scale.set(s, s, s);
    });

    // Placement bounce animations (NB-3)
    const now = performance.now();
    for (let i = _placementAnimations.length - 1; i >= 0; i--) {
      const anim = _placementAnimations[i];
      const t = (now - anim.startTime) / anim.duration;
      if (t >= 1) {
        anim.mesh.scale.set(1, 1, 1);
        _placementAnimations.splice(i, 1);
      } else if (!drag.active || drag.partId !== anim.mesh.userData.partId) {
        const scale = 1 + 0.15 * Math.sin(t * Math.PI) * (1 - t);
        anim.mesh.scale.set(scale, scale, scale);
      }
    }

    // Smooth zoom lerp (NB-B)
    if (Math.abs(camera.zoom - _targetZoom) > 0.001) {
      camera.zoom += (_targetZoom - camera.zoom) * 0.14;
      camera.updateProjectionMatrix();
    }

    // Build-tutorial outline: glowing target where the next part should go.
    _updateTutorialGhost();

    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  // visibilitychange is registered in init() and removed in destroy()

  // ── Resize ─────────────────────────────────────────────────────────────────

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

  // ── Reset Camera ────────────────────────────────────────────────────────────

  function updateCameraOrbit() {
    const x = _orbitTarget.x + _orbit.radius * Math.sin(_orbit.phi) * Math.cos(_orbit.theta);
    const y = _orbitTarget.y + _orbit.radius * Math.cos(_orbit.phi);
    const z = _orbitTarget.z + _orbit.radius * Math.sin(_orbit.phi) * Math.sin(_orbit.theta);
    camera.position.set(x, y, z);
    camera.lookAt(_orbitTarget);
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
  }

  function resetCamera() {
    if (!camera) return;
    _orbit.theta  = Math.PI / 4;
    _orbit.phi    = Math.acos(1 / Math.sqrt(3));
    _orbit.active = false;
    _pan.active   = false;
    _orbitTarget.set(0, 0, 0);
    camera.zoom   = 1.3;
    _targetZoom   = 1.3;
    updateCameraOrbit();
  }

  // ── Zoom ───────────────────────────────────────────────────────────────────

  function onWheel(e) {
    e.preventDefault();
    _targetZoom = Math.max(0.6, Math.min(3, _targetZoom - e.deltaY * 0.002));
  }

  // ── Mouse → World Projection ───────────────────────────────────────────────

  function screenToNDC(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  // Cached math objects for getGroundIntersection (avoid allocation per call)
  const _groundPlaneObj = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const _groundTarget   = new THREE.Vector3();

  /** Project mouse ray onto the y=0 (XZ ground) plane. Returns {x,y,z} or null. */
  function getGroundIntersection(e) {
    screenToNDC(e);
    raycaster.setFromCamera(mouse, camera);
    const hit = raycaster.ray.intersectPlane(_groundPlaneObj, _groundTarget);
    return hit ? _groundTarget.clone() : null;
  }

  /** Snap a world position to the grid. */
  function snapToGrid(v) {
    return new THREE.Vector3(
      Math.round(v.x / GRID) * GRID,
      0,
      Math.round(v.z / GRID) * GRID
    );
  }

  // ── Part Mesh Factories ────────────────────────────────────────────────────

  function createSnapPointIndicator(x, y, z, tag) {
    const geo  = new THREE.SphereGeometry(0.06, 8, 8);
    const mesh = new THREE.Mesh(geo, MATERIALS.snapDot.clone());
    mesh.position.set(x, y, z);
    mesh.userData.isSnapIndicator = true;
    if (tag) mesh.userData.snapTag = tag;
    return mesh;
  }

  function createCChannel(lengthUnits) {
    const length = (lengthUnits || 5) * 0.7; // scale factor: 5 holes = ~3.5 world units
    const group = new THREE.Group();
    group.userData.partType = 'c-channel';

    // Bottom plate
    const bottom = new THREE.Mesh(new THREE.BoxGeometry(length, 0.1, 1), MATERIALS.metal.clone());
    bottom.position.y = 0;
    bottom.castShadow = true;
    group.add(bottom);

    // Left wall
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(length, 0.5, 0.1), MATERIALS.metal.clone());
    leftWall.position.set(0, 0.25, -0.45);
    leftWall.castShadow = true;
    group.add(leftWall);

    // Right wall
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(length, 0.5, 0.1), MATERIALS.metal.clone());
    rightWall.position.set(0, 0.25, 0.45);
    rightWall.castShadow = true;
    group.add(rightWall);

    // Holes and snap points
    const holeCount = Math.max(1, Math.floor(length / 0.7));
    for (let i = 0; i < holeCount; i++) {
      const hx = -length / 2 + 0.35 + i * 0.7;
      const hole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8),
        MATERIALS.hole.clone()
      );
      hole.position.set(hx, 0.06, 0);
      hole.rotation.x = Math.PI / 2;
      group.add(hole);
      group.add(createSnapPointIndicator(hx, 0.55, 0));
    }

    // End snap points
    group.add(createSnapPointIndicator(-length / 2, 0.25, 0));
    group.add(createSnapPointIndicator( length / 2, 0.25, 0));

    // Contact shadow (NB-5)
    const shadow = createContactShadow(length, 1);
    shadow.position.y = 0.005;
    group.add(shadow);

    return group;
  }

  function createMotor() {
    const group = new THREE.Group();
    group.userData.partType = 'motor';

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.7), MATERIALS.motor.clone());
    body.castShadow = true;
    group.add(body);

    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.4, 12),
      MATERIALS.shaft.clone()
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set(0, 0, 0.55);
    shaft.castShadow = true;
    group.add(shaft);

    group.add(createSnapPointIndicator(0, 0.35, 0));
    group.add(createSnapPointIndicator(0, -0.35, 0));
    group.add(createSnapPointIndicator(-0.45, 0, 0));
    group.add(createSnapPointIndicator( 0.45, 0, 0));
    // Shaft snap point — where wheel attaches
    group.add(createSnapPointIndicator(0, 0, 0.75, 'shaft'));

    // Contact shadow (NB-5)
    const shadow = createContactShadow(0.8, 0.7);
    shadow.position.y = -0.3 + 0.005;
    group.add(shadow);

    return group;
  }

  function createWheel() {
    const group = new THREE.Group();
    group.userData.partType = 'wheel';

    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.35, 24), MATERIALS.tire.clone());
    tire.rotation.x = Math.PI / 2;
    tire.castShadow = true;
    group.add(tire);

    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.37, 16), MATERIALS.wheelHub.clone());
    hub.rotation.x = Math.PI / 2;
    hub.castShadow = true;
    group.add(hub);

    const center = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.38, 8),
      MATERIALS.shaft.clone()
    );
    center.rotation.x = Math.PI / 2;
    group.add(center);

    // Spokes
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.35), MATERIALS.wheelHub.clone());
      const angle = (i / 5) * Math.PI * 2;
      spoke.position.set(Math.cos(angle) * 0.2, Math.sin(angle) * 0.2, 0);
      spoke.rotation.z = angle;
      group.add(spoke);
    }

    // Hub snap point — connects to motor shaft
    group.add(createSnapPointIndicator(0, 0, -0.18));
    group.add(createSnapPointIndicator(0, 0,  0.18));
    group.add(createSnapPointIndicator(0, 0.35, 0));

    // Contact shadow (NB-5)
    const shadow = createContactShadow(1.4, 0.35);
    shadow.position.y = -0.7 + 0.005;
    group.add(shadow);

    return group;
  }

  function createBrain() {
    const group = new THREE.Group();
    group.userData.partType = 'brain';

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.8), MATERIALS.brain.clone());
    body.castShadow = true;
    group.add(body);

    // Ports
    for (let i = 0; i < 4; i++) {
      const port = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.1), MATERIALS.port.clone());
      port.position.set(-0.4 + i * 0.27, 0.24, 0.35);
      group.add(port);
    }

    // Screen
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.25), MATERIALS.screen.clone());
    screen.position.set(0, 0.21, 0);
    screen.rotation.x = -Math.PI / 2;
    group.add(screen);

    group.add(createSnapPointIndicator(0, 0.25, 0));
    group.add(createSnapPointIndicator(-0.65, 0, 0));
    group.add(createSnapPointIndicator( 0.65, 0, 0));
    group.add(createSnapPointIndicator(0, 0, -0.45));
    group.add(createSnapPointIndicator(0, 0, 0.45));

    // Contact shadow (NB-5)
    const shadow = createContactShadow(1.2, 0.8);
    shadow.position.y = -0.2 + 0.005;
    group.add(shadow);

    return group;
  }

  function createBattery() {
    const group = new THREE.Group();
    group.userData.partType = 'battery';

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.5, 0.6), MATERIALS.battery.clone());
    body.castShadow = true;
    group.add(body);

    // Terminal
    const terminal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.15, 8),
      MATERIALS.terminal.clone()
    );
    terminal.position.set(0.35, 0.3, 0);
    group.add(terminal);

    group.add(createSnapPointIndicator(0, 0.3, 0));
    group.add(createSnapPointIndicator(-0.55, 0, 0));
    group.add(createSnapPointIndicator( 0.55, 0, 0));
    group.add(createSnapPointIndicator(0, 0, -0.35));
    group.add(createSnapPointIndicator(0, 0, 0.35));

    // Contact shadow (NB-5)
    const shadow = createContactShadow(1.0, 0.6);
    shadow.position.y = -0.25 + 0.005;
    group.add(shadow);

    return group;
  }

  function createSensor() {
    const group = new THREE.Group();
    group.userData.partType = 'distance-sensor';

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), MATERIALS.sensor.clone());
    body.castShadow = true;
    group.add(body);

    // Lens
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), MATERIALS.lens.clone());
    lens.position.set(0.26, 0, 0);
    group.add(lens);

    group.add(createSnapPointIndicator(0, 0.25, 0));
    group.add(createSnapPointIndicator(-0.3, 0, 0));
    group.add(createSnapPointIndicator( 0.3, 0, 0));

    // Contact shadow (NB-5)
    const shadow = createContactShadow(0.5, 0.5);
    shadow.position.y = -0.2 + 0.005;
    group.add(shadow);

    return group;
  }

  // ── Contact Shadow (NB-5) ─────────────────────────────────────────────────

  let _contactShadowTexture = null;
  function _getContactShadowTexture() {
    if (_contactShadowTexture) return _contactShadowTexture;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.25)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.12)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    _contactShadowTexture = new THREE.CanvasTexture(c);
    return _contactShadowTexture;
  }

  function createContactShadow(footprintWidth, footprintDepth) {
    const geo = new THREE.PlaneGeometry(footprintWidth * 1.3, footprintDepth * 1.3);
    const mat = new THREE.MeshBasicMaterial({
      map: _getContactShadowTexture(),
      transparent: true,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.isContactShadow = true;
    return mesh;
  }

  /** Create a 3D mesh group for the given part type. */
  function createPartMesh(partType, props) {
    switch (partType) {
      case 'c-channel': {
        const lengthPx = (props && props.length) || 100;
        // Convert 2D px length to hole count: every 20px = 1 hole
        const holeCount = Math.max(2, Math.round(lengthPx / 20));
        return createCChannel(holeCount);
      }
      case 'motor':           return createMotor();
      case 'wheel':           return createWheel();
      case 'brain':           return createBrain();
      case 'battery':         return createBattery();
      case 'distance-sensor': return createSensor();
      default:
        // Fallback: grey box
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x888888 })));
        return g;
    }
  }

  /** Create a ghost (semi-transparent) version of a part mesh for placement preview. */
  function createGhostMesh(partType, props) {
    const group = createPartMesh(partType, props);
    group.traverse(child => {
      if (child.isMesh) {
        if (child.material) child.material.dispose(); // dispose the clone from createPartMesh
        child.material = MATERIALS.ghost.clone();
        child.material.transparent = true;
        child.material.opacity = 0.5;
        child.material.depthWrite = false;
        child.castShadow = false;
        child.receiveShadow = false;
      }
    });
    return group;
  }

  /** Build-tutorial ghost: a glowing target outline shown at the next part's
   *  intended position. Uses the same createPartMesh as the real part so the
   *  outline geometry exactly matches what the user is about to drop. */
  function _disposeTutGhost() {
    if (_tutGhostMesh) {
      disposeMesh(_tutGhostMesh);
      if (scene) scene.remove(_tutGhostMesh);
      _tutGhostMesh = null;
      _tutGhostKey = '';
    }
  }

  function _updateTutorialGhost() {
    // Only run when we have a scene and the build tutorial is active and gives a target3D.
    const isActive = window._buildTutorialActive && window._buildTutorialActive();
    if (!isActive || !scene) {
      if (_tutGhostMesh) _disposeTutGhost();
      return;
    }
    const ghost = window._buildTutorialGetGhost && window._buildTutorialGetGhost();
    const t3 = ghost && ghost.target3D;
    if (!ghost || !t3) {
      if (_tutGhostMesh) _disposeTutGhost();
      return;
    }

    // Cache key: rebuild only when type/position/rotation/length actually changed.
    const lengthProp = (t3.props && t3.props.length) || '';
    const key = ghost.type + '|' + t3.x + '|' + t3.z + '|' + (t3.rot || 0) + '|' + lengthProp;
    if (key !== _tutGhostKey) {
      _disposeTutGhost();
      const def = getPartDef(ghost.type);
      const props = {};
      if (def && def.props) def.props.forEach(p => { props[p.key] = p.default; });
      if (t3.props) Object.assign(props, t3.props);
      const mesh = createPartMesh(ghost.type, props);
      // Re-skin every mesh with a glowing blue ghost material so it stands out.
      mesh.traverse(child => {
        if (child.isMesh) {
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
          child.material = new THREE.MeshStandardMaterial({
            color: 0x3b82f6,
            emissive: 0x3b82f6,
            emissiveIntensity: 0.55,
            transparent: true,
            opacity: 0.42,
            depthWrite: false,
            metalness: 0.2,
            roughness: 0.5,
          });
          child.castShadow = false;
          child.receiveShadow = false;
        }
      });
      mesh.position.set(t3.x, 0, t3.z);
      mesh.rotation.y = t3.rot || 0;
      scene.add(mesh);
      _tutGhostMesh = mesh;
      _tutGhostKey = key;
    }

    // Pulse opacity + emissive intensity for visibility.
    const pulse = 0.5 + 0.5 * Math.sin(_time * 6);
    _tutGhostMesh.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.opacity = 0.32 + pulse * 0.30;
        child.material.emissiveIntensity = 0.35 + pulse * 0.5;
      }
    });
    // Subtle hover bob to draw the eye.
    _tutGhostMesh.position.y = 0.06 + pulse * 0.10;
  }

  // ── Scene Sync (data → meshes) ─────────────────────────────────────────────

  /** Rebuild the entire 3D scene from placedParts[] and connections[]. */
  function syncSceneFromData() {
    // Remove old part meshes
    partMeshes.forEach((mesh, id) => { disposeMesh(mesh); scene.remove(mesh); });
    partMeshes.clear();

    // Remove old wire meshes
    wireMeshes.forEach(m => { disposeMesh(m); scene.remove(m); });
    wireMeshes = [];

    // Remove selection box
    if (selectionBox) { selectionBox.geometry.dispose(); selectionBox.material.dispose(); scene.remove(selectionBox); selectionBox = null; }

    // Re-create part meshes
    placedParts.forEach(p => {
      const mesh = createPartMesh(p.type, p.props);
      mesh.position.set(p.position.x, p.position.y || 0, p.position.z || 0);
      mesh.rotation.y = p.rotation || 0;
      mesh.userData.partId = p.id;
      scene.add(mesh);
      partMeshes.set(p.id, mesh);
    });

    // Re-create wire meshes
    rebuildWires();

    // Re-create selection (with full material glow)
    if (selectedId !== null) {
      selectPart(selectedId);
    }
  }

  /** Update a single part's mesh position/rotation to match data. */
  function syncPartMesh(partId) {
    const part = placedParts.find(p => p.id === partId);
    const mesh = partMeshes.get(partId);
    if (!part || !mesh) return;
    mesh.position.set(part.position.x, part.position.y || 0, part.position.z || 0);
    mesh.rotation.y = part.rotation || 0;
  }

  // ── Selection ──────────────────────────────────────────────────────────────

  function updateSelectionHighlight() {
    if (selectionBox) { selectionBox.geometry.dispose(); selectionBox.material.dispose(); scene.remove(selectionBox); selectionBox = null; }
    if (selectedId === null) return;
    const mesh = partMeshes.get(selectedId);
    if (!mesh) return;
    selectionBox = new THREE.BoxHelper(mesh, 0x3b82f6);
    scene.add(selectionBox);
  }

  function selectPart(partId) {
    const old = selectedId;
    selectedId = partId;

    // Clear hover highlight if selecting the hovered part (NB-8)
    if (_hoveredPartId === partId) _hoveredPartId = null;

    // Restore old selection materials
    if (old !== null && old !== partId) {
      const oldMesh = partMeshes.get(old);
      if (oldMesh) restoreOriginalMaterials(old);
    }

    // Apply select glow to new selection
    if (partId !== null) {
      const part = placedParts.find(p => p.id === partId);
      const mesh = partMeshes.get(partId);
      if (mesh && part) {
        // Store original materials if not already stored
        if (!mesh.userData.originalMaterials) {
          mesh.userData.originalMaterials = [];
          mesh.traverse(child => {
            if (child.isMesh && !child.userData.isSnapIndicator && !child.userData.isContactShadow) {
              mesh.userData.originalMaterials.push({ mesh: child, material: child.material });
            }
          });
        }
        // Apply selection material to main body (first non-snap, non-shadow mesh)
        const mainBody = mesh.children.find(c => c.isMesh && !c.userData.isSnapIndicator && !c.userData.isContactShadow);
        if (mainBody) {
          const sm = MATERIALS.select.clone();
          sm.userData = { isSelectMat: true };
          mainBody.material = sm;
        }
      }
    }

    updateSelectionHighlight();
    _fireSelectionChange();
  }

  function restoreOriginalMaterials(partId) {
    const mesh = partMeshes.get(partId);
    if (!mesh || !mesh.userData.originalMaterials) return;
    mesh.userData.originalMaterials.forEach(entry => {
      if (entry.mesh.material && entry.mesh.material !== entry.material) {
        entry.mesh.material.dispose();
      }
      entry.mesh.material = entry.material;
    });
    delete mesh.userData.originalMaterials;
  }

  // ── Wires ──────────────────────────────────────────────────────────────────

  const WIRE_COLORS = {
    power:  0xef4444,
    signal: 0x3b82f6,
    sensor: 0xf59e0b
  };

  function rebuildWires() {
    wireMeshes.forEach(m => { disposeMesh(m); scene.remove(m); });
    wireMeshes = [];

    for (const conn of connections) {
      const fromPart = placedParts.find(p => p.id === conn.fromId);
      const toPart   = placedParts.find(p => p.id === conn.toId);
      if (!fromPart || !toPart) continue;

      const startPos = new THREE.Vector3(fromPart.position.x, (fromPart.position.y || 0) + 0.5, fromPart.position.z || 0);
      const endPos   = new THREE.Vector3(toPart.position.x,   (toPart.position.y || 0) + 0.5,   toPart.position.z || 0);

      // Determine wire color
      let color = WIRE_COLORS[conn.wireType] || 0x888888;
      // Special: brain→sensor = yellow
      if (conn.wireType === 'signal') {
        const types = [fromPart.type, toPart.type].sort().join(':');
        if (types === 'brain:distance-sensor') color = WIRE_COLORS.sensor;
      }

      const wire = createWireMesh(startPos, endPos, color);
      scene.add(wire);
      wireMeshes.push(wire);
    }
  }

  function createWireMesh(startPos, endPos, color) {
    const mid = new THREE.Vector3().lerpVectors(startPos, endPos, 0.5);
    mid.y += 0.5; // Arc upward
    const curve = new THREE.CatmullRomCurve3([startPos, mid, endPos]);
    const geometry = new THREE.TubeGeometry(curve, 20, 0.025, 6, false);
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.userData.isWire = true;
    return mesh;
  }

  // ── Wire Logic ─────────────────────────────────────────────────────────────

  function handleWireClick(partId) {
    if (pendingWireFrom === null) {
      pendingWireFrom = partId;
    } else {
      if (pendingWireFrom !== partId) {
        const fromPart = placedParts.find(p => p.id === pendingWireFrom);
        const toPart   = placedParts.find(p => p.id === partId);
        if (fromPart && toPart) {
          const wt = resolveWireType(fromPart.type, toPart.type);
          if (wt) {
            connections = connections.filter(
              c => !((c.fromId === pendingWireFrom && c.toId === partId) ||
                     (c.fromId === partId && c.toId === pendingWireFrom))
            );
            connections.push({ fromId: pendingWireFrom, toId: partId, wireType: wt });
            rebuildWires();
            pushHistory();
            _fireConfigChange();
          }
        }
      }
      pendingWireFrom = null;
    }
  }

  function resolveWireType(fromType, toType) {
    const pair = [fromType, toType].sort().join(':');
    if (pair === 'battery:brain')         return 'power';
    if (pair === 'brain:motor')           return 'signal';
    if (pair === 'brain:distance-sensor') return 'signal';
    return null;
  }

  function deleteWiresForPart(partId) {
    connections = connections.filter(c => c.fromId !== partId && c.toId !== partId);
  }

  // ── Snap System (3D adaptation) ────────────────────────────────────────────

  /** Get 3D snap points for a placed part in world coordinates. */
  function getWorldSnapPoints3D(placed) {
    const mesh = partMeshes.get(placed.id);
    if (!mesh) return [];
    const points = [];
    mesh.traverse(child => {
      if (child.userData && child.userData.isSnapIndicator) {
        const worldPos = new THREE.Vector3();
        child.getWorldPosition(worldPos);
        points.push({ x: worldPos.x, y: worldPos.y, z: worldPos.z, tag: child.userData.snapTag || null });
      }
    });
    return points;
  }

  /** True while the build tutorial is in progress — used to disable auto-snap so
   *  the user's drop position stays where they put it (matching spawnStarterRobot
   *  output 1:1 when each step's ghost is followed). */
  function _isBuildTutorialActive() {
    return !!(window._buildTutorialActive && window._buildTutorialActive());
  }

  /** Find nearest snap pair on the XZ plane between a ghost position and all placed parts. */
  function findSnapTarget(ghostPos, ghostType, excludeId) {
    // During the build tutorial, never snap — the tutorial places parts at exact
    // coordinates that match the ⭐ Starter Bot, and snapping would relocate them.
    if (_isBuildTutorialActive()) return null;
    const SNAP_THRESH_3D = 1.0; // world units
    let best = null;
    let bestDist = SNAP_THRESH_3D;

    for (const placed of placedParts) {
      if (placed.id === excludeId) continue;
      // Wheels can only snap onto motor shaft points
      if (ghostType === 'wheel' && placed.type !== 'motor') continue;
      const targetPoints = getWorldSnapPoints3D(placed);
      for (const tp of targetPoints) {
        // Wheels only snap to shaft-tagged snap points
        if (ghostType === 'wheel' && tp.tag !== 'shaft') continue;
        const dist = Math.sqrt(
          (ghostPos.x - tp.x) ** 2 + (ghostPos.z - tp.z) ** 2
        );
        if (dist < bestDist) {
          bestDist = dist;
          best = { x: tp.x, y: tp.y, z: tp.z, partId: placed.id, dist };
        }
      }
    }
    return best;
  }

  /** Show/hide snap indicators at snap points near cursor. */
  function updateSnapIndicators(targetPos, excludeId, forType) {
    // Clear old indicators (dispose geometry/material to prevent leaks)
    snapIndicators.forEach(m => { m.geometry.dispose(); m.material.dispose(); scene.remove(m); });
    snapIndicators = [];

    if (!targetPos) return;

    const SHOW_THRESH = 2.0;
    for (const placed of placedParts) {
      if (placed.id === excludeId) continue;
      // Apply same filtering as findSnapTarget
      if (forType === 'wheel' && placed.type !== 'motor') continue;
      const points = getWorldSnapPoints3D(placed);
      for (const pt of points) {
        if (forType === 'wheel' && pt.tag !== 'shaft') continue;
        const dist = Math.sqrt((targetPos.x - pt.x) ** 2 + (targetPos.z - pt.z) ** 2);
        if (dist < SHOW_THRESH) {
          const geo = new THREE.SphereGeometry(0.1, 12, 12);
          const mat = new THREE.MeshBasicMaterial({
            color: dist < 1.0 ? 0x22c55e : 0x94a3b8,
            transparent: true,
            opacity: dist < 1.0 ? 0.8 : 0.3
          });
          const indicator = new THREE.Mesh(geo, mat);
          indicator.position.set(pt.x, pt.y, pt.z);
          scene.add(indicator);
          snapIndicators.push(indicator);
        }
      }
    }
  }

  // ── Mouse Events ───────────────────────────────────────────────────────────

  function onWindowMouseMove(e) {
    if (_orbit.active) {
      const dx = e.clientX - _orbit.lastX;
      const dy = e.clientY - _orbit.lastY;
      _orbit.theta += dx * 0.008;
      _orbit.phi = Math.max(0.1, Math.min(Math.PI * 0.48, _orbit.phi - dy * 0.008));
      _orbit.lastX = e.clientX;
      _orbit.lastY = e.clientY;
      updateCameraOrbit();
    }
    if (_pan.active && camera && renderer) {
      const dx = e.clientX - _pan.lastX;
      const dy = e.clientY - _pan.lastY;
      // World units per pixel: frustum half-height is 8, canvas height in CSS px
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
    if (e.button === 0 && drag.active) {
      drag.active = false;
      drag.mode   = null;
      updateSnapIndicators(null, null);
      pushHistory();
      _fireConfigChange();
    }
  }

  function onMouseDown(e) {
    if (e.button === 2) {
      _orbit.active = true;
      _orbit.lastX  = e.clientX;
      _orbit.lastY  = e.clientY;
      return;
    }
    if (e.button === 1) {
      e.preventDefault(); // suppress middle-click autoscroll
      _pan.active = true;
      _pan.lastX  = e.clientX;
      _pan.lastY  = e.clientY;
      return;
    }
    if (e.button !== 0) return;

    const groundHit = getGroundIntersection(e);

    // Placement mode: place a new part
    if (placementMode && ghostPartType) {
      if (groundHit) {
        placeNewPart(ghostPartType, groundHit);
      }
      return;
    }

    // Wire tool
    if (activeTool === 'wire') {
      const hitPart = raycastParts(e);
      if (hitPart) {
        handleWireClick(hitPart.userData.partId);
      } else {
        pendingWireFrom = null;
      }
      return;
    }

    // Delete tool
    if (activeTool === 'delete') {
      const hitPart = raycastParts(e);
      if (hitPart) {
        const id = hitPart.userData.partId;
        deletePart(id);
      }
      return;
    }

    // Select / move
    const hitPart = raycastParts(e);
    if (hitPart) {
      const id = hitPart.userData.partId;
      selectPart(id);

      // Start drag
      if (activeTool === 'select' && groundHit) {
        const part = placedParts.find(p => p.id === id);
        if (part) {
          drag.active   = true;
          drag.mode     = 'move';
          drag.partId   = id;
          drag.partType = part.type;
          drag.startPos = { ...part.position };
          drag.offset.set(
            part.position.x - groundHit.x,
            0,
            (part.position.z || 0) - groundHit.z
          );
        }
      }
    } else {
      selectPart(null);
    }
  }

  function onMouseMove(e) {
    const groundHit = getGroundIntersection(e);

    // Ghost preview in placement mode
    if (placementMode && ghostMesh && groundHit) {
      const snapped = snapToGrid(groundHit);
      snapped.x = Math.max(-GRID_HALF, Math.min(GRID_HALF, snapped.x));
      snapped.z = Math.max(-GRID_HALF, Math.min(GRID_HALF, snapped.z));
      const snapTarget = findSnapTarget(snapped, ghostPartType, null);
      if (snapTarget) {
        ghostMesh.position.set(snapTarget.x, snapTarget.y, snapTarget.z);
      } else {
        ghostMesh.position.set(snapped.x, 0, snapped.z);
      }
      // Swap ghost material only when snap state actually changes (NB-A)
      const needsSnap = !!snapTarget;
      if (needsSnap !== _ghostIsSnap) {
        _ghostIsSnap = needsSnap;
        const mat = needsSnap ? MATERIALS.ghostSnap : MATERIALS.ghost;
        ghostMesh.traverse(child => { if (child.isMesh) child.material = mat; });
      }
      updateSnapIndicators(snapped, null, ghostPartType);
      return;
    }

    // Drag move
    if (drag.active && drag.mode === 'move' && groundHit) {
      const part = placedParts.find(p => p.id === drag.partId);
      if (!part) return;
      const rawPos = new THREE.Vector3(
        groundHit.x + drag.offset.x,
        0,
        groundHit.z + drag.offset.z
      );
      // Clamp to grid boundary before snapping (NB-D)
      rawPos.x = Math.max(-GRID_HALF, Math.min(GRID_HALF, rawPos.x));
      rawPos.z = Math.max(-GRID_HALF, Math.min(GRID_HALF, rawPos.z));
      const snapped = snapToGrid(rawPos);
      const snapTarget = findSnapTarget(snapped, part.type, drag.partId);
      if (snapTarget) {
        part.position.x = snapTarget.x;
        part.position.y = snapTarget.y;
        part.position.z = snapTarget.z;
      } else {
        part.position.x = snapped.x;
        part.position.y = 0;
        part.position.z = snapped.z;
      }
      syncPartMesh(drag.partId);
      updateSelectionHighlight();
      rebuildWires();
      updateSnapIndicators(snapped, drag.partId, drag.partType);
      return;
    }

    // ── Hover highlight (NB-8) ──────────────────────────────────────────────
    if (!drag.active && !placementMode && activeTool === 'select') {
      const hitPart = raycastParts(e);
      const hitId = hitPart ? hitPart.userData.partId : null;

      if (hitId !== _hoveredPartId) {
        // Restore previous hovered part's emissive
        if (_hoveredPartId !== null && _hoveredPartId !== selectedId) {
          const prevMesh = partMeshes.get(_hoveredPartId);
          if (prevMesh) {
            prevMesh.traverse(child => {
              if (child.isMesh && !child.userData.isSnapIndicator && child.material && child.material.emissiveIntensity !== undefined) {
                // Only reset if not a selection material
                if (!child.material.userData || !child.material.userData.isSelectMat) {
                  child.material.emissiveIntensity = 0;
                }
              }
            });
          }
        }

        _hoveredPartId = hitId;

        // Apply subtle highlight to newly hovered part
        if (hitId !== null && hitId !== selectedId) {
          const mesh = partMeshes.get(hitId);
          if (mesh) {
            const mainBody = mesh.children.find(c => c.isMesh && !c.userData.isSnapIndicator && !c.userData.isContactShadow);
            if (mainBody && mainBody.material && mainBody.material.emissiveIntensity !== undefined) {
              mainBody.material.emissiveIntensity = 0.12;
            }
          }
        }
      }

      renderer.domElement.style.cursor = hitId ? 'pointer' : 'default';
    }
  }

  function onMouseUp(e) {
    // Handled by onWindowMouseUp
  }

  /** Raycast against placed part meshes. Returns the top-level group or null. */
  function raycastParts(e) {
    screenToNDC(e);
    raycaster.setFromCamera(mouse, camera);

    // Collect all meshes that belong to parts (not ground, not wire, not ghost)
    const targets = [];
    partMeshes.forEach(group => {
      group.traverse(child => {
        if (child.isMesh && !child.userData.isSnapIndicator && !child.userData.isContactShadow) targets.push(child);
      });
    });

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;

    // Walk up to the top-level part group
    let obj = hits[0].object;
    while (obj.parent && !obj.userData.partId) obj = obj.parent;
    return obj.userData.partId ? obj : null;
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    // Rotate ghost during placement mode
    if ((e.key === 'r' || e.key === 'R') && placementMode) {
      if (ghostMesh) {
        ghostRotation = (ghostRotation + Math.PI / 2) % (Math.PI * 2);
        ghostMesh.rotation.y = ghostRotation;
      }
      e.preventDefault();
      return; // always consume R in placement mode — never fall through
    }

    // Rotate selected part
    if ((e.key === 'r' || e.key === 'R') && selectedId !== null) {
      const part = placedParts.find(p => p.id === selectedId);
      if (part) {
        const step = Math.PI / 2; // R = 90°
        part.rotation = ((part.rotation || 0) + step) % (Math.PI * 2);
        syncPartMesh(selectedId);
        updateSelectionHighlight();
        rebuildWires();
        pushHistory();
        _fireConfigChange();
        _fireSelectionChange();
        e.preventDefault();
      }
    }

    // Delete selected part
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId !== null) {
      deletePart(selectedId);
      e.preventDefault();
    }

    // Escape exits placement mode
    if (e.key === 'Escape' && placementMode) {
      exitPlacementMode();
      e.preventDefault();
    }
  }

  // ── Part Placement ─────────────────────────────────────────────────────────

  function enterPlacementMode(partType) {
    // Enforce single-instance limits for brain and battery
    if (partType === 'brain' && placedParts.some(p => p.type === 'brain')) return;
    if (partType === 'battery' && placedParts.some(p => p.type === 'battery')) return;
    exitPlacementMode();
    placementMode  = true;
    ghostPartType  = partType;
    const def = getPartDef(partType);
    const props = {};
    if (def && def.props) def.props.forEach(p => { props[p.key] = p.default; });
    ghostMesh = createGhostMesh(partType, props);
    ghostMesh.position.set(0, 0, 0);
    scene.add(ghostMesh);
    // Change cursor
    if (renderer) renderer.domElement.style.cursor = 'crosshair';
  }

  function exitPlacementMode() {
    placementMode = false;
    ghostPartType = null;
    ghostRotation = 0;
    _ghostIsSnap  = false;
    if (ghostMesh) { disposeMesh(ghostMesh); scene.remove(ghostMesh); ghostMesh = null; }
    updateSnapIndicators(null, null);
    if (renderer) renderer.domElement.style.cursor = '';
  }

  function placeNewPart(partType, worldPos) {
    const def = getPartDef(partType);
    const props = {};
    if (def && def.props) def.props.forEach(p => { props[p.key] = p.default; });

    const snapped = snapToGrid(worldPos);
    const snapTarget = findSnapTarget(snapped, partType, null);
    const finalPos = snapTarget
      ? { x: snapTarget.x, y: snapTarget.y, z: snapTarget.z }
      : { x: snapped.x, y: 0, z: snapped.z };

    const newPart = {
      id: nextId++,
      type: partType,
      position: finalPos,
      rotation: ghostRotation,
      props: props
    };
    placedParts.push(newPart);

    const mesh = createPartMesh(partType, props);
    mesh.position.set(finalPos.x, finalPos.y, finalPos.z);
    mesh.rotation.y = ghostRotation;
    mesh.userData.partId = newPart.id;
    scene.add(mesh);
    partMeshes.set(newPart.id, mesh);

    // Bounce animation (NB-3)
    _placementAnimations.push({ mesh, startTime: performance.now(), duration: 350 });

    selectPart(newPart.id);

    // Play snap sound if snapped
    if (snapTarget) _playSnapSound(true);

    pushHistory();
    _fireConfigChange();

    // Switch back to select tool after placing
    exitPlacementMode();
    activeTool = 'select';
  }

  function deletePart(id) {
    deleteWiresForPart(id);
    placedParts = placedParts.filter(p => p.id !== id);
    const mesh = partMeshes.get(id);
    if (mesh) { disposeMesh(mesh); scene.remove(mesh); partMeshes.delete(id); }
    restoreOriginalMaterials(id);
    if (selectedId === id) {
      selectedId = null;
      if (selectionBox) { selectionBox.geometry.dispose(); selectionBox.material.dispose(); scene.remove(selectionBox); selectionBox = null; }
    }
    rebuildWires();
    pushHistory();
    _fireConfigChange();
    _fireSelectionChange();
  }

  // ── Sidebar Drag Entry (compatibility with app.js populatePartsPanel) ─────

  function startNewPartDrag(partType, startX, startY) {
    // In 3D mode, clicking a part in the palette enters placement mode
    enterPlacementMode(partType);
  }

  // ── Sound ──────────────────────────────────────────────────────────────────

  let _audioCtx = null;
  function getAudioCtx() {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return _audioCtx;
  }

  function _playSnapSound(valid) {
    try {
      const actx = getAudioCtx();
      const osc  = actx.createOscillator();
      const gain = actx.createGain();
      osc.connect(gain); gain.connect(actx.destination);
      osc.type = 'sine';
      osc.frequency.value = valid ? 880 : 220;
      gain.gain.setValueAtTime(0.06, actx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.08);
      osc.start(actx.currentTime);
      osc.stop(actx.currentTime + 0.08);
    } catch (e) { /* audio not available */ }
  }

  // ── Tool / Reset ───────────────────────────────────────────────────────────

  function setActiveTool(tool) {
    exitPlacementMode();
    activeTool = tool;
    if (tool !== 'select' && tool !== 'wire') {
      selectPart(null);
    }
    pendingWireFrom = null;
    if (renderer) {
      renderer.domElement.style.cursor = tool === 'wire' ? 'pointer' : '';
    }
  }

  function resetCanvas() {
    placedParts     = [];
    connections     = [];
    selectedId      = null;
    nextId          = 1;
    pendingWireFrom = null;
    exitPlacementMode();
    syncSceneFromData();
    pushHistory();
    _fireConfigChange();
    _fireSelectionChange();
  }

  // Alias for resetCanvas (app.js calls clearAll in some paths)
  function clearAll() { resetCanvas(); }

  // ── History (undo/redo) ────────────────────────────────────────────────────

  function pushHistory() {
    history = history.slice(0, historyIdx + 1);
    history.push({
      parts:       JSON.parse(JSON.stringify(placedParts)),
      connections: JSON.parse(JSON.stringify(connections))
    });
    if (history.length > 40) {
      const overflow = history.length - 40;
      history = history.slice(overflow);
      historyIdx = Math.max(0, historyIdx - overflow);
    }
    historyIdx = history.length - 1;
  }

  function restoreSnap(snap) {
    placedParts = JSON.parse(JSON.stringify(snap.parts       || []));
    connections = JSON.parse(JSON.stringify(snap.connections  || []));
  }

  function undo() {
    if (historyIdx <= 0) return;
    historyIdx--;
    restoreSnap(history[historyIdx]);
    selectedId = null;
    syncSceneFromData();
    _fireConfigChange();
    _fireSelectionChange();
  }

  function redo() {
    if (historyIdx >= history.length - 1) return;
    historyIdx++;
    restoreSnap(history[historyIdx]);
    selectedId = null;
    syncSceneFromData();
    _fireConfigChange();
    _fireSelectionChange();
  }

  // ── Save / Load ────────────────────────────────────────────────────────────

  const STORAGE_KEY = 'robobuilder_build_v2';

  function _debouncedSave() {
    clearTimeout(_debouncedSave._timer);
    _debouncedSave._timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          version: 2,
          format: '3d',
          parts: placedParts,
          connections
        }));
      } catch (e) { /* storage full */ }
    }, 300);
  }

  function loadFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const data = JSON.parse(saved);
      const rawParts = Array.isArray(data.parts) ? data.parts : [];

      // Migrate old 2D format: {position:{x,y}} -> {position:{x, y:0, z:oldY}}
      placedParts = rawParts.filter(p =>
        p && typeof p.id === 'number' && typeof p.type === 'string' &&
        p.position && getPartDef(p.type) !== null
      ).map(p => {
        if (data.format !== '3d' && p.position.z === undefined) {
          // Migration from 2D: x stays, old y becomes z, y becomes 0
          // Scale down from pixel coords to 3D units (~1 grid unit per 20px)
          return {
            ...p,
            position: {
              x: Math.round((p.position.x - 200) / 40),
              y: 0,
              z: Math.round((p.position.y - 150) / 40)
            }
          };
        }
        return { ...p, position: { x: p.position.x, y: p.position.y || 0, z: p.position.z || 0 } };
      });

      connections = Array.isArray(data.connections) ? data.connections : [];
      nextId = placedParts.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
      syncSceneFromData();
    } catch (e) { /* ignore corrupt localStorage */ }
  }

  function saveRobot(slotName) {
    const key = 'robobuilder_slot_' + (slotName || 'default');
    localStorage.setItem(key, JSON.stringify({
      version: 2,
      format: '3d',
      parts: placedParts,
      connections
    }));
  }

  function loadRobot(slotName) {
    try {
      const key  = 'robobuilder_slot_' + (slotName || 'default');
      const data = JSON.parse(localStorage.getItem(key) || 'null');
      if (!data) return false;
      const rawParts = Array.isArray(data.parts) ? data.parts : [];
      placedParts = rawParts.filter(p =>
        p && typeof p.id === 'number' && typeof p.type === 'string' &&
        p.position && getPartDef(p.type) !== null
      ).map(p => ({
        ...p,
        position: { x: p.position.x, y: p.position.y || 0, z: p.position.z || 0 }
      }));
      connections = Array.isArray(data.connections) ? data.connections : [];
      nextId = placedParts.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
      selectedId = null;
      syncSceneFromData();
      pushHistory();
      _fireConfigChange();
      _fireSelectionChange();
      return true;
    } catch (e) { return false; }
  }

  function loadConfig(config) {
    if (!config || !Array.isArray(config.parts)) return;
    placedParts = config.parts.map(p => ({
      ...p,
      position: { x: p.position.x, y: p.position.y || 0, z: p.position.z || 0 }
    }));
    connections = Array.isArray(config.connections) ? config.connections : [];
    nextId = placedParts.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1;
    selectedId = null;
    syncSceneFromData();
    pushHistory();
    _fireConfigChange();
  }

  // ── Starter Robot ──────────────────────────────────────────────────────────

  function spawnStarterRobot() {
    placedParts = [];
    connections = [];
    nextId      = 1;

    const add = (type, x, z, rot, props) => {
      const def = getPartDef(type);
      const p = {
        id: nextId++,
        type,
        position: { x, y: 0, z },
        rotation: rot || 0,
        props: props || {}
      };
      if (def && def.props) {
        def.props.forEach(pd => {
          if (p.props[pd.key] === undefined) p.props[pd.key] = pd.default;
        });
      }
      placedParts.push(p);
    };

    // Layout: two parallel c-channels, cross beams, motors, wheels, brain, battery, sensor
    add('c-channel', 0, -1, 0, { length: 100 });
    add('c-channel', 0,  1, 0, { length: 100 });
    add('c-channel', -1.4, 0, Math.PI / 2, { length: 60 });
    add('c-channel',  1.4, 0, Math.PI / 2, { length: 60 });
    add('motor', -1.4, -1.5, 0);
    add('motor', -1.4,  1.5, 0);
    add('wheel', -1.4, -2.1, 0);
    add('wheel', -1.4,  2.1, 0);
    add('wheel',  1.4, -2.1, 0);
    add('wheel',  1.4,  2.1, 0);
    add('brain',  0, 0, 0);
    add('battery', 1.0, 0, 0);
    add('distance-sensor', -2.2, 0, 0);

    // Wire up
    const battPart  = placedParts.find(p => p.type === 'battery');
    const brainPart = placedParts.find(p => p.type === 'brain');
    const motors    = placedParts.filter(p => p.type === 'motor');
    const sensPart  = placedParts.find(p => p.type === 'distance-sensor');

    if (battPart && brainPart)  connections.push({ fromId: battPart.id,  toId: brainPart.id,  wireType: 'power' });
    motors.forEach(m => {
      if (brainPart) connections.push({ fromId: brainPart.id, toId: m.id, wireType: 'signal' });
    });
    if (brainPart && sensPart)  connections.push({ fromId: brainPart.id, toId: sensPart.id, wireType: 'signal' });

    selectedId = null;
    syncSceneFromData();
    pushHistory();
    _fireConfigChange();
    _fireSelectionChange();
  }

  // ── Robot Config Export ────────────────────────────────────────────────────

  /**
   * Returns a robot config object compatible with simEngine/codeRunner.
   * Maps 3D coords to 2D for the sim: {x: part.position.x * scale, y: part.position.z * scale}
   */
  function getRobotConfig() {
    const SCALE = 40; // 1 world unit = 40px in sim
    const OFFSET_X = 200; // center offset for sim arena
    const OFFSET_Y = 150;

    return {
      parts: placedParts.map(p => {
        const def = getPartDef(p.type);
        return {
          id: p.id,
          type: p.type,
          position: {
            x: Math.round(p.position.x * SCALE + OFFSET_X),
            y: Math.round((p.position.z || 0) * SCALE + OFFSET_Y)
          },
          rotation: p.rotation || 0,
          props: { ...p.props },
          snapPoints: def ? getEffectiveSnapPoints(p, def) : [],
          metadata: def ? def.metadata : {}
        };
      }),
      connections: JSON.parse(JSON.stringify(connections))
    };
  }

  function getConnections() { return JSON.parse(JSON.stringify(connections)); }

  // ── Callbacks ──────────────────────────────────────────────────────────────

  let _onConfigChange    = null;
  let _onSelectionChange = null;

  function setOnConfigChange(fn)    { _onConfigChange    = fn; }
  function setOnSelectionChange(fn) { _onSelectionChange = fn; }

  function _fireConfigChange() {
    if (_onConfigChange) _onConfigChange(getRobotConfig());
    updateStatus();
    _debouncedSave();
  }

  function _fireSelectionChange() {
    if (!_onSelectionChange) return;
    if (selectedId === null) {
      _onSelectionChange(null);
      return;
    }
    const part = placedParts.find(p => p.id === selectedId);
    if (part) {
      // Return a "live" reference that the properties panel can mutate
      _onSelectionChange(part);
    } else {
      _onSelectionChange(null);
    }
  }

  function notifyPropChanged() {
    // Rebuild the part's mesh when props change (e.g. c-channel length)
    if (selectedId !== null) {
      const part = placedParts.find(p => p.id === selectedId);
      if (part) {
        const oldMesh = partMeshes.get(selectedId);
        if (oldMesh) { disposeMesh(oldMesh); scene.remove(oldMesh); }
        const newMesh = createPartMesh(part.type, part.props);
        newMesh.position.set(part.position.x, part.position.y || 0, part.position.z || 0);
        newMesh.rotation.y = part.rotation || 0;
        newMesh.userData.partId = part.id;
        scene.add(newMesh);
        partMeshes.set(part.id, newMesh);
        selectPart(part.id);
      }
    }
    rebuildWires();
    _fireConfigChange();
  }

  // Light-weight config-only update — does NOT rebuild the mesh or re-fire
  // selection (which would destroy and recreate the properties panel, losing
  // text input focus).  Use for metadata-only prop changes like motor name.
  function notifyConfigOnly() {
    _fireConfigChange();
    _debouncedSave();
  }

  function updateStatus() {
    const el = document.getElementById('robot-status');
    if (!el) return;
    const types = placedParts.map(p => p.type);
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

  // ── Theme Update ───────────────────────────────────────────────────────────

  function updateTheme() {
    if (!scene) return;
    const bgColor = getThemeSceneColor();
    scene.background = new THREE.Color(bgColor);
    rebuildGrid();
    // Reinitialize materials for new theme
    initMaterials();
    // Rebuild all part meshes with new materials
    syncSceneFromData();
  }

  // ── Redraw (compatibility) ─────────────────────────────────────────────────

  function redraw() {
    // Three.js renders continuously via animate(), so this is mostly a no-op.
    // But we update theme colors in case they changed.
    if (scene) {
      scene.background = new THREE.Color(getThemeSceneColor());
    }
  }

  // ── 3D Part Thumbnails (NB-6) ──────────────────────────────────────────────

  const _thumbnailCache = new Map();

  function renderPartThumbnail(partType, width, height) {
    const cacheKey = partType + '_' + width + 'x' + height;
    if (_thumbnailCache.has(cacheKey)) return _thumbnailCache.get(cacheKey);

    try {
      const thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      thumbRenderer.setSize(width, height);
      thumbRenderer.setPixelRatio(2); // retina

      const thumbScene = new THREE.Scene();
      const thumbCamera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);

      thumbScene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const thumbDir = new THREE.DirectionalLight(0xffffff, 1.0);
      thumbDir.position.set(3, 5, 4);
      thumbScene.add(thumbDir);

      const mesh = createPartMesh(partType, {});
      thumbScene.add(mesh);

      // Fit camera to mesh bounding sphere
      const box = new THREE.Box3().setFromObject(mesh);
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      const fov = thumbCamera.fov * (Math.PI / 180);
      const dist = sphere.radius / Math.sin(fov / 2) * 1.15;
      thumbCamera.position.set(
        sphere.center.x + dist * 0.6,
        sphere.center.y + dist * 0.5,
        sphere.center.z + dist * 0.6
      );
      thumbCamera.lookAt(sphere.center);

      thumbRenderer.render(thumbScene, thumbCamera);
      const dataURL = thumbRenderer.domElement.toDataURL('image/png');

      // Dispose everything
      mesh.traverse(child => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
          else if (child.material) child.material.dispose();
        }
      });
      thumbRenderer.dispose();

      _thumbnailCache.set(cacheKey, dataURL);
      return dataURL;
    } catch (e) {
      console.warn('[BuildCanvas3D] Thumbnail generation failed:', e);
      return null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    init,
    destroy,
    setActiveTool,
    resetCanvas,
    clearAll,
    startNewPartDrag,
    enterPlacementMode,
    exitPlacementMode,
    getRobotConfig,
    getConnections,
    setOnConfigChange,
    setOnSelectionChange,
    notifyPropChanged,
    notifyConfigOnly,
    getPlacedParts() { return placedParts; },
    spawnStarterRobot,
    saveRobot,
    loadRobot,
    loadConfig,
    addConnection: function(fromId, toId, wireType) {
      connections = connections.filter(c =>
        !((c.fromId === fromId && c.toId === toId) ||
          (c.fromId === toId && c.toId === fromId))
      );
      connections.push({ fromId, toId, wireType });
      rebuildWires();
      pushHistory();
      _fireConfigChange();
    },
    undo,
    redo,
    redraw,
    updateTheme,
    resetCamera,
    renderPartThumbnail,
    // drawAssemblyToContext is not needed — sim uses PartRenderers2D
    drawAssemblyToContext: function() { return false; }
  };
})();
