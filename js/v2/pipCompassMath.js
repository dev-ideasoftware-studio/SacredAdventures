/**
 * PiP compass — **single source of truth** for ring / tick rotation.
 *
 * Why this file exists (May-2026 incident log):
 * The PiP dial kept “inverting” because **three different systems** all
 * touched yaw without sharing one derivation:
 *
 *   1. `World.js` — `_yaw`, `_fwd = (-sin, 0, -cos)`, spawn at `π`, and the
 *      strafe / turn key polarity have each been tuned independently.
 *   2. `js/v2/UIModule.js` — HTML `.compass-outer-ring` uses CSS `rotate()`.
 *   3. `js/v2/anu/PipRenderStrategy.js` — the rare **surrogate-2D** PiP path
 *      used `ctx.rotate(-yaw)`, which is **not** the same transform as the
 *      HTML dial’s correct `180° − yawDeg` law — so any A/B between paths
 *      read as “you flipped the compass again”.
 *
 * Past “fixes” often changed (2) or (3) after a movement-axis tweak in (1)
 * without re-running the four-cardinal proof at spawn yaw `π`, which made
 * the dial look randomly inverted even when the underlying math was almost
 * right.
 *
 * **Contract** (must stay in lockstep with `World.js` `_fwd`):
 *
 *   yaw = 0    → facing world **−Z** (south on the current village grid)
 *   yaw = π    → facing world **+Z** (north — default spawn)
 *   yaw = π/2  → facing **−X** (west)
 *   yaw = −π/2 → facing **+X** (east)
 *
 * The moondial paints **N at the top** of the ring (12 o’clock), E at 3,
 * S at 6, W at 9. We rotate that ring so the letter matching the player’s
 * **physical** heading sits at 12 o’clock. CSS `rotate()` is **clockwise
 * positive** (degrees).
 *
 * Verified mapping (ring rotation = `180° − yawDeg`):
 *
 *   yaw = π    → 0°   → N at top (spawn, facing +Z)
 *   yaw = 0    → 180° → S at top
 *   yaw = π/2  → 90°  → W at top
 *   yaw = −π/2 → 270° → E at top
 *
 * If `World.js` ever changes the meaning of `_yaw` relative to `_fwd`,
 * update **this file’s JSDoc and the four-row proof above**, then grep
 * consumers — do not sprinkle ad-hoc `±π` flips in UI files.
 */

/**
 * @param {number} yawRad Same value as `WorldPlayer.yaw` / `world._yaw`.
 * @returns {number} Degrees for `element.style.transform = \`rotate(${n}deg)\`` in `[0, 360)`.
 */
export function pipCompassRingRotationDegFromYawRad(yawRad) {
  const yaw = Number(yawRad) || 0;
  let d = 180 - (yaw * 180) / Math.PI;
  d %= 360;
  if (d < 0) d += 360;
  return d;
}

/**
 * Radians for `CanvasRenderingContext2D.rotate` to match {@link pipCompassRingRotationDegFromYawRad}.
 */
export function pipCompassRingRotationRadFromYawRad(yawRad) {
  return Math.PI - (Number(yawRad) || 0);
}
