// Snap System – geometry helpers and snap-point detection.
// Handles rotation and customizable part dimensions.

const SNAP_THRESHOLD = 22; // pixels

// ── Effective dimensions ───────────────────────────────────────────────────────

function getEffectiveW(placed, def) {
  if (placed.type === 'c-channel') return placed.props?.length   || def.width;
  if (placed.type === 'wheel')     return placed.props?.diameter || def.width;
  return def.width;
}

function getEffectiveH(placed, def) {
  if (placed.type === 'wheel') return placed.props?.diameter || def.height;
  return def.height;
}

// ── Dynamic snap-point generation ─────────────────────────────────────────────

/**
 * Returns snap points in LOCAL space (relative to part top-left),
 * accounting for custom dimensions.
 */
function getEffectiveSnapPoints(placed, def) {
  if (placed.type === 'c-channel') {
    return buildCChannelSnaps(getEffectiveW(placed, def), def.height);
  }
  if (placed.type === 'wheel') {
    return buildWheelSnaps(getEffectiveW(placed, def));
  }
  return def.snapPoints;
}

function buildCChannelSnaps(length, height) {
  const pts = [
    { x: 0,      y: height / 2, type: 'male',   subtype: 'beam-end', connectsTo: ['beam-end'] },
    { x: length, y: height / 2, type: 'male',   subtype: 'beam-end', connectsTo: ['beam-end'] },
  ];
  for (let x = 20; x <= length - 10; x += 20) {
    pts.push({ x, y: 0,      type: 'female', subtype: 'hole', connectsTo: ['mount'] });
    pts.push({ x, y: height, type: 'female', subtype: 'hole', connectsTo: ['mount'] });
  }
  return pts;
}

function buildWheelSnaps(diameter) {
  const r = diameter / 2;
  return [
    { x: r,        y: 0,        type: 'female', subtype: 'hub', connectsTo: ['shaft'] },
    { x: r,        y: diameter, type: 'female', subtype: 'hub', connectsTo: ['shaft'] },
    { x: 0,        y: r,        type: 'female', subtype: 'hub', connectsTo: ['shaft'] },
    { x: diameter, y: r,        type: 'female', subtype: 'hub', connectsTo: ['shaft'] },
  ];
}

// ── World-space snap points (rotation-aware) ───────────────────────────────────

/**
 * Returns all snap points for a placed part in WORLD (canvas) coordinates,
 * accounting for rotation and custom dimensions.
 */
function getWorldSnapPoints(placed) {
  const def = getPartDef(placed.type);
  if (!def) return [];
  const pw     = getEffectiveW(placed, def);
  const ph     = getEffectiveH(placed, def);
  const localSPs = getEffectiveSnapPoints(placed, def);
  const cx     = placed.position.x + pw / 2;
  const cy     = placed.position.y + ph / 2;
  const angle  = placed.rotation || 0;
  const cos    = Math.cos(angle);
  const sin    = Math.sin(angle);
  return localSPs.map((sp, i) => {
    const relX = sp.x - pw / 2;
    const relY = sp.y - ph / 2;
    return {
      x: cx + cos * relX - sin * relY,
      y: cy + sin * relX + cos * relY,
      type: sp.type,
      subtype: sp.subtype || null,
      connectsTo: sp.connectsTo || null,
      spIndex: i
    };
  });
}

// ── Nearest snap PAIR search (any side to any side) ────────────────────────────

/**
 * Finds the closest pair of (dragged-part snap point, placed-part snap point)
 * within the threshold. This enables snapping ANY side of the dragged part
 * to ANY side of a placed part.
 *
 * @param {object} draggedPart  – live part object (has type, rotation, props)
 * @param {number} ghostCx      – cursor x = ghost center x
 * @param {number} ghostCy      – cursor y = ghost center y
 * @param {Array}  placedParts
 * @param {number|null} excludeId
 * @returns {{ worldX, worldY, partId, spIndex, dragSpIndex, dist } | null}
 */
function findNearestSnapPair(draggedPart, ghostCx, ghostCy, placedParts, excludeId = null) {
  const def = getPartDef(draggedPart.type);
  if (!def) return null;

  const pw  = getEffectiveW(draggedPart, def);
  const ph  = getEffectiveH(draggedPart, def);
  const angle = draggedPart.rotation || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Ghost snap points in world space (ghost center = cursor)
  const localSPs = getEffectiveSnapPoints(draggedPart, def);
  const dragWorldSPs = localSPs.map((sp, i) => {
    const relX = sp.x - pw / 2;
    const relY = sp.y - ph / 2;
    return {
      x: ghostCx + cos * relX - sin * relY,
      y: ghostCy + sin * relX + cos * relY,
      index: i, type: sp.type, subtype: sp.subtype || null, connectsTo: sp.connectsTo || null
    };
  });

  let best     = null;
  let bestDist = SNAP_THRESHOLD;

  for (const placed of placedParts) {
    if (placed.id === excludeId) continue;
    const targetSPs = getWorldSnapPoints(placed);
    for (const tsp of targetSPs) {
      for (const dsp of dragWorldSPs) {
        // Only snap compatible connections
        if (!isCompatibleConnection(dsp, tsp)) continue;
        const dist = Math.hypot(dsp.x - tsp.x, dsp.y - tsp.y);
        if (dist < bestDist) {
          bestDist = dist;
          best = {
            worldX: tsp.x,
            worldY: tsp.y,
            partId: placed.id,
            spIndex: tsp.spIndex,
            dragSpIndex: dsp.index,
            dist
          };
        }
      }
    }
  }
  return best;
}

// ── Connection compatibility ──────────────────────────────────────────────────

/**
 * Check if two snap points are compatible for connection.
 * Uses subtype/connectsTo whitelists when available, falls back to male/female pairing.
 */
function isCompatibleConnection(spA, spB) {
  // If both have connectsTo arrays, use semantic matching
  if (spA.connectsTo && spB.connectsTo) {
    return spA.connectsTo.includes(spB.subtype) || spB.connectsTo.includes(spA.subtype);
  }
  // Fallback: opposite male/female pairing
  return (spA.type === 'male' && spB.type === 'female') || (spA.type === 'female' && spB.type === 'male');
}

/**
 * Returns ALL nearby snap pairs within the given threshold,
 * with compatibility info for visual feedback.
 */
function findAllNearbySnaps(draggedPart, ghostCx, ghostCy, placedParts, excludeId, threshold) {
  const def = getPartDef(draggedPart.type);
  if (!def) return [];
  const pw  = getEffectiveW(draggedPart, def);
  const ph  = getEffectiveH(draggedPart, def);
  const angle = draggedPart.rotation || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const localSPs = getEffectiveSnapPoints(draggedPart, def);
  const dragWorldSPs = localSPs.map((sp, i) => {
    const relX = sp.x - pw / 2;
    const relY = sp.y - ph / 2;
    return {
      x: ghostCx + cos * relX - sin * relY,
      y: ghostCy + sin * relX + cos * relY,
      index: i, type: sp.type, subtype: sp.subtype || null, connectsTo: sp.connectsTo || null
    };
  });

  const results = [];
  for (const placed of placedParts) {
    if (placed.id === excludeId) continue;
    const targetSPs = getWorldSnapPoints(placed);
    for (const tsp of targetSPs) {
      for (const dsp of dragWorldSPs) {
        const dist = Math.hypot(dsp.x - tsp.x, dsp.y - tsp.y);
        if (dist < threshold) {
          const compatible = isCompatibleConnection(dsp, tsp);
          results.push({
            worldX: tsp.x, worldY: tsp.y, dist, compatible,
            partId: placed.id, spIndex: tsp.spIndex, dragSpIndex: dsp.index
          });
        }
      }
    }
  }
  return results;
}

// ── Placement helpers ──────────────────────────────────────────────────────────

/**
 * Compute top-left position so that the dragged part's `dragSpIndex` snap point
 * (in world space, accounting for rotation) aligns to (targetX, targetY).
 */
function alignToSnap(def, placed, targetX, targetY, dragSpIndex) {
  const pw  = getEffectiveW(placed, def);
  const ph  = getEffectiveH(placed, def);
  const localSPs = getEffectiveSnapPoints(placed, def);
  const sp  = localSPs[dragSpIndex != null ? dragSpIndex : 0] || { x: pw / 2, y: ph / 2 };
  const angle = placed.rotation || 0;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const relX = sp.x - pw / 2;
  const relY = sp.y - ph / 2;
  // Snap point world offset from center when part is rotated
  const wox = cos * relX - sin * relY;
  const woy = sin * relX + cos * relY;
  return {
    x: targetX - wox - pw / 2,
    y: targetY - woy - ph / 2
  };
}

function centerPosition(placed, def, cx, cy) {
  return {
    x: cx - getEffectiveW(placed, def) / 2,
    y: cy - getEffectiveH(placed, def) / 2
  };
}

// ── Rotation-aware hit test ────────────────────────────────────────────────────

function hitTestPart(placed, cx, cy) {
  const def = getPartDef(placed.type);
  if (!def) return false;
  const pw    = getEffectiveW(placed, def);
  const ph    = getEffectiveH(placed, def);
  const pcx   = placed.position.x + pw / 2;
  const pcy   = placed.position.y + ph / 2;
  const angle = -(placed.rotation || 0);
  const cos   = Math.cos(angle);
  const sin   = Math.sin(angle);
  const lx    = cos * (cx - pcx) - sin * (cy - pcy);
  const ly    = sin * (cx - pcx) + cos * (cy - pcy);
  if (placed.type === 'wheel') return Math.hypot(lx, ly) <= pw / 2;
  return lx >= -pw / 2 && lx <= pw / 2 && ly >= -ph / 2 && ly <= ph / 2;
}

// ── Rotation snap helper ───────────────────────────────────────────────────────

/**
 * Snap angle to nearest 45° increment if within 8° of it.
 */
function snapRotation(rawAngle) {
  const STEP      = Math.PI / 4;      // 45°
  const THRESHOLD = 8 * Math.PI / 180; // 8°
  const nearest   = Math.round(rawAngle / STEP) * STEP;
  return Math.abs(rawAngle - nearest) < THRESHOLD ? nearest : rawAngle;
}
