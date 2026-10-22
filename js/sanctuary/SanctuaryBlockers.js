/**
 * SanctuaryBlockers — solid footprints the player can't walk through.
 *
 * Today: the tipis (Mark, 2026-10-22: "add tipi collision"). QA saw the
 * avatar walk straight through Tipi 2 (Decision Engine FND-64).
 *
 * Each tipi is a circle around its published anchor
 * (window.__sanctuaryTipi1Anchor .. __sanctuaryTipi4Anchor, set by
 * SanctuaryTipis.js and kept current when a tipi is moved in Village View).
 * The movers call pushOutOfBlockers() right after they step the body:
 *   - SanctuaryKeyboardLook (keys, D-pad, phone joystick)
 *   - SanctuaryClickToMove   (click / tap to walk, scripted walks)
 * A body inside a circle is put back on its edge, so walking into a tipi at
 * an angle slides around it instead of stopping dead.
 * Tap-to-walk also steers: steerAroundBlockers() turns the heading onto the
 * tangent of a tipi that stands between the walker and the goal, so a tap
 * straight behind a tipi walks round it (pushing out alone would leave her
 * pressed against the wall for ever). insideBlocker() lets the footprint
 * trail skip prints that would sit inside a tipi. goalOutsideBlockers() moves a
 * walk goal inside a tipi onto its wall (the side facing the walker when the
 * goal is deep inside).
 *
 * Radius, measured 2026-10-22 from the placed tipi model (7.2 m tall): the
 * hide wall is ~2.5 m from the centre between 0.5 and 1.5 m up (90th
 * percentile), and the poles/door flap reach ~2.9 m at the ground.
 */

export const TIPI_BLOCK_RADIUS_M = 2.6;
export const PLAYER_RADIUS_M = 0.35;

/** Extra room kept when steering round a tipi, so the walk doesn't scrape the wall. */
export const STEER_MARGIN_M = 0.15;

const TIPI_ANCHOR_KEYS = [
  "__sanctuaryTipi1Anchor",
  "__sanctuaryTipi2Anchor",
  "__sanctuaryTipi3Anchor",
  "__sanctuaryTipi4Anchor",
];

/** The tipi anchors that exist right now (a tipi can be missing or moved). */
function tipiAnchors() {
  const out = [];
  if (typeof window === "undefined") return out;
  for (const key of TIPI_ANCHOR_KEYS) {
    const a = window[key];
    if (a && Number.isFinite(a.x) && Number.isFinite(a.z)) out.push(a);
  }
  return out;
}

/**
 * Push `pos` (any object with numeric x and z, e.g. a THREE.Vector3) out of
 * every blocker, in place. Returns true if it moved.
 */
export function pushOutOfBlockers(pos) {
  if (!pos) return false;
  const r = TIPI_BLOCK_RADIUS_M + PLAYER_RADIUS_M;
  let moved = false;
  for (const a of tipiAnchors()) {
    const dx = pos.x - a.x;
    const dz = pos.z - a.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-6) {
      pos.x = a.x + r; // dead centre (spawned or dropped inside): step out east
    } else {
      pos.x = a.x + (dx / d) * r;
      pos.z = a.z + (dz / d) * r;
    }
    moved = true;
  }
  return moved;
}

/** True when a point (x, z) is inside a tipi's footprint. */
export function insideBlocker(x, z) {
  const r = TIPI_BLOCK_RADIUS_M + PLAYER_RADIUS_M;
  for (const a of tipiAnchors()) {
    if ((x - a.x) * (x - a.x) + (z - a.z) * (z - a.z) < r * r) return true;
  }
  return false;
}

/**
 * Unit heading {x, z} for a walker at (px, pz) going to (gx, gz). Straight at
 * the goal unless a tipi stands on that line; then it is the tangent of that
 * tipi (plus STEER_MARGIN_M) on the side the line already leans to, or along
 * the wall when the walker is already touching it. Called every frame, so the
 * walk curves round the tipi and straightens out once the goal is in view.
 * Dead ahead (no lean) always goes round the same side, so it never dithers.
 */
export function steerAroundBlockers(px, pz, gx, gz) {
  let hx = gx - px;
  let hz = gz - pz;
  const dist = Math.hypot(hx, hz);
  if (dist < 1e-6) return { x: 0, z: 0 };
  hx /= dist;
  hz /= dist;
  const wall = TIPI_BLOCK_RADIUS_M + PLAYER_RADIUS_M;
  let block = null;
  for (const a of tipiAnchors()) {
    const ax = a.x - px;
    const az = a.z - pz;
    const along = Math.max(0, Math.min(dist, ax * hx + az * hz));
    const miss = Math.hypot(ax - hx * along, az - hz * along); // closest approach on the way
    // A goal on the wall itself (a tap on a tipi) is reachable: only a line that
    // goes through the footprint counts as blocked.
    if (miss >= wall - 0.01 || along <= 0) continue;
    if (!block || along < block.along) block = { ax, az, along };
  }
  if (!block) return { x: hx, z: hz };
  const r = wall + STEER_MARGIN_M;
  const dc = Math.hypot(block.ax, block.az);
  const toCentre = Math.atan2(block.az, block.ax);
  const off = dc > r ? Math.asin(r / dc) : Math.PI / 2;
  const lean = block.ax * hz - block.az * hx; // > 0: the heading is anticlockwise of the centre
  const ang = toCentre + (lean >= 0 ? off : -off);
  return { x: Math.cos(ang), z: Math.sin(ang) };
}

/**
 * Move a walk goal that lies inside a tipi onto its wall, in place. A goal
 * deep inside (a tap on the tipi, or its centre) goes to the side facing the
 * walker at (fromX, fromZ), so she walks up to the tipi rather than round to
 * its far side; a goal near the edge (a spot by the wall) keeps its own side.
 * Returns true if it moved.
 */
export function goalOutsideBlockers(goal, fromX, fromZ) {
  if (!goal) return false;
  const r = TIPI_BLOCK_RADIUS_M + PLAYER_RADIUS_M;
  let moved = false;
  for (const a of tipiAnchors()) {
    let ux = goal.x - a.x;
    let uz = goal.z - a.z;
    const d = Math.hypot(ux, uz);
    if (d >= r) continue;
    if (d < r * 0.6 && Number.isFinite(fromX) && Number.isFinite(fromZ)) {
      ux = fromX - a.x;
      uz = fromZ - a.z;
    }
    const n = Math.hypot(ux, uz);
    if (n < 1e-6) { ux = 1; uz = 0; } else { ux /= n; uz /= n; }
    goal.x = a.x + ux * r;
    goal.z = a.z + uz * r;
    moved = true;
  }
  return moved;
}
