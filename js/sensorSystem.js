// Sensor System – raycasting distance sensor.
// Casts a ray forward from the robot center and returns distance to nearest obstacle.
// STEP size is a precision/performance tradeoff: smaller values catch thin obstacles
// more reliably but cost more iterations per ray. 2px works well for the 16px-wide
// obstacles used in lessons.

const SensorSystem = (() => {
  let MAX_RANGE = 300; // px — maximum sensor detection distance
  const STEP    = 2;   // px per raycast step (see tradeoff note above)

  function setMaxRange(r) { MAX_RANGE = Math.max(10, Number(r) || 300); }

  /**
   * Cast a ray from the robot center in the robot's facing direction.
   * Checks arena walls and obstacle AABBs.
   * @returns {number} distance in pixels to nearest obstacle (capped at MAX_RANGE)
   */
  function getDistance(robot, obstacles, arena) {
    const { x: rx, y: ry, angle } = robot;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    for (let d = STEP; d <= MAX_RANGE; d += STEP) {
      const px = rx + dx * d;
      const py = ry + dy * d;

      // Hit arena wall
      if (px <= 0 || px >= arena.width || py <= 0 || py >= arena.height) {
        return d;
      }

      // Hit an obstacle AABB
      for (const obs of obstacles) {
        if (px >= obs.x && px <= obs.x + obs.width &&
            py >= obs.y && py <= obs.y + obs.height) {
          return d;
        }
      }
    }

    return MAX_RANGE;
  }

  return { getDistance, get MAX_RANGE() { return MAX_RANGE; }, setMaxRange };
})();
