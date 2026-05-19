/**
 * Sacred Adventures v2 — click-to-move visual marker.
 *
 * Two pieces:
 *   • A small gold "X" lying flat on the ground at the click destination.
 *   • A treasure-map trail of yellow semi-transparent FOOTPRINTS from the
 *     player toward the X (May-15 2026 user spec: "change dash line to
 *     yellow semi transparent footprints on top of the landscape …
 *     to the X like a treasure map"). Each footprint follows the
 *     heightfield (per-print `terrainY` sample), and alternating prints
 *     are offset ± perpendicular to the path so the trail reads as
 *     left-foot / right-foot footsteps rather than a single line.
 *
 * Lifecycle (driven by World.js):
 *   const marker = createClickToMoveMarker({ scene, terrainY });
 *   marker.setGoal(gx, gz);            // when smart-nav engages
 *   marker.update(playerPos, dt);      // each frame
 *   marker.dispose();                  // on arrival or cancel
 *
 * One InstancedMesh draw call for all footprints regardless of trail
 * length.
 */
import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import { getRuntimeService } from "./RuntimeServices.js";

const GOLD = 0xfbc02d;
const MAX_DASHES = 80;
/**
 * Footprint dimensions (May-17 2026 redesign — user: "make them flat 2D
 * feet atop the ground evenly spaced like actual footprints").
 *
 * The previous implementation textured a 0.41 × 0.22 plane with a
 * canvas-drawn footprint, but the texture's heel-to-toe axis ran along V
 * while the plane's long axis was U — so the foot was squashed
 * sideways and read as a blob. The redesign uses a `ShapeGeometry`
 * built from a real foot outline (heel bulge → arch → ball → narrowing
 * toes), giving a crisp 2D foot silhouette with no texture sampling.
 */
const PRINT_LEN_M = 0.42;
const PRINT_WIDTH_M = 0.18;
/** Human-stride feel — heel-to-heel distance between successive prints. */
const STRIDE_M = 0.72;
/** Half-width gap between left and right foot — the trail straddles the path centre. */
const FOOT_LATERAL_OFFSET_M = 0.14;
/**
 * Lift markers above terrain. The earlier 4.5 cm lift wasn't enough when
 * the terrain mesh has its own neumorphic-hex displacement / slope noise
 * — prints would z-fight the hex faces and only show "sometimes" (user
 * complaint May-15 2026). Bump to 9 cm + flip `depthTest: false` on the
 * material so the trail ALWAYS draws above the heightfield regardless of
 * the local micro-slope. The material is still transparent and obeys
 * normal blending; only the depth read is suppressed.
 */
const GROUND_LIFT_M = 0.09;

/**
 * Build a foot-silhouette `ShapeGeometry` lying in the local XY plane.
 *
 * Layout (local, before runtime rotation):
 *   • Long axis = local X (length = `PRINT_LEN_M`). Heel at X = 0, toes
 *     at X = PRINT_LEN_M. After `rotation.x = -π/2` this becomes world
 *     X and the runtime yaw aligns it with the path direction.
 *   • Short axis = local Y (width = `PRINT_WIDTH_M`). Centred on Y = 0
 *     so the lateral L/R offset works around the path centre.
 *
 * Profile is a single closed quadratic-Bezier outline traced around a
 * stylised right foot: heel bulge, instep narrowing, ball flare, then
 * a smooth taper to the toes. The left foot is rendered via instance
 * matrix `scale.z = -1` (mirrors across the path-aligned long axis).
 *
 * Cheap: ~64 triangulated tris, one geometry shared across all
 * `MAX_DASHES` instances. No texture sampling at runtime — crisp at
 * any zoom level.
 */
function _buildFootprintGeometry() {
  const L = PRINT_LEN_M;
  const W = PRINT_WIDTH_M;
  const hW = W * 0.5;
  const shape = new THREE.Shape();

  // Trace the right-foot outline COUNTER-CLOCKWISE in local (x, y):
  // (heel back-centre) → (outer heel) → (outer ball) → (outer toes) →
  // (toe arc) → (inner toes) → (inner ball) → (inner instep) → close.
  shape.moveTo(0.00 * L, 0.0);                   // back centre of heel
  shape.quadraticCurveTo(0.02 * L,  hW * 0.95,   // round the outer heel
                         0.16 * L,  hW * 0.78);
  shape.quadraticCurveTo(0.30 * L,  hW * 0.50,   // instep narrows
                         0.45 * L,  hW * 0.62);
  shape.quadraticCurveTo(0.62 * L,  hW * 0.85,   // outer ball flare
                         0.78 * L,  hW * 0.78);
  shape.quadraticCurveTo(0.92 * L,  hW * 0.55,   // taper toward toes
                         1.00 * L,  0.0);
  shape.quadraticCurveTo(0.92 * L, -hW * 0.55,   // mirror down through toes
                         0.78 * L, -hW * 0.78);
  shape.quadraticCurveTo(0.62 * L, -hW * 0.85,   // inner ball
                         0.45 * L, -hW * 0.62);
  shape.quadraticCurveTo(0.30 * L, -hW * 0.50,   // inner instep
                         0.16 * L, -hW * 0.78);
  shape.quadraticCurveTo(0.02 * L, -hW * 0.95,   // close around heel
                         0.00 * L,  0.0);

  const geo = new THREE.ShapeGeometry(shape, 16);
  // Bake the long axis to start at the heel. The shape origin is heel-
  // centre already, but we shift slightly so the trail's `playerPos +
  // dirX * along` formula plants prints with the BALL on the stride
  // position (more natural footstep cadence than heel-on-stride).
  geo.translate(-L * 0.45, 0, 0);
  return geo;
}

/**
 * @param {{ scene: THREE.Scene, terrainY: (x: number, z: number) => number }} opts
 */
export function createClickToMoveMarker({ scene, terrainY }) {
  /**
   * Footprint Y-sampler. We prefer `WorldPhysics.getGroundY` (which takes
   * the MAX of the heightfield and any registered deck surface — the
   * fishing-dock deck registers itself there at Pool2 boot) so prints
   * climb onto the dock instead of plunging through it. Falls back to
   * the analytic `terrainY` if WorldPhysics isn't ready yet (cold-load
   * race: the marker spawns the same frame the player clicks; physics
   * is registered earlier so this should always resolve in practice).
   */
  const sampleSurfaceY = (x, z) => {
    const wp = getRuntimeService("WorldPhysics");
    if (wp && typeof wp.getGroundY === "function") {
      return wp.getGroundY(x, z);
    }
    return terrainY(x, z);
  };
  const root = new THREE.Group();
  root.name = "effect_click_to_move_marker";
  root.userData.anuId = "environment.click_to_move_marker";
  root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  root.userData.anuKind = "click_to_move_marker";

  // ── X mark ───────────────────────────────────────────────────────────
  // Two crossed thin planes lying flat on the ground, ±45° around Y so the
  // arms read as a clean diagonal "X" rather than a "+". Slight inner
  // glow + outer crisp stroke gives it the chalk-on-grass look.
  const xMat = new THREE.MeshBasicMaterial({
    color: GOLD,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const armGeo = new THREE.PlaneGeometry(0.78, 0.16);
  const xGroup = new THREE.Group();
  const arm1 = new THREE.Mesh(armGeo, xMat);
  arm1.rotation.x = -Math.PI / 2;
  arm1.rotation.z = Math.PI / 4;
  const arm2 = new THREE.Mesh(armGeo, xMat);
  arm2.rotation.x = -Math.PI / 2;
  arm2.rotation.z = -Math.PI / 4;
  xGroup.add(arm1, arm2);
  xGroup.renderOrder = 11;
  root.add(xGroup);

  // ── Footprint trail ──────────────────────────────────────────────────
  // Each print is a 2D foot silhouette (`ShapeGeometry`) lying in local
  // XY. The right-foot shape is shared across instances; the left foot
  // is the same geometry mirrored at runtime via `scale.z = -1` on the
  // instance matrix (after `rotation.x = -π/2`, local Y becomes world Z,
  // so a Z-flip mirrors the foot across the path's long axis).
  const dashGeo = _buildFootprintGeometry();
  const dashMat = new THREE.MeshBasicMaterial({
    color: GOLD,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    /**
     * `depthTest: false` so footprints never lose the depth race against
     * the neumorphic-hex terrain — user reported "feet … only sometimes
     * they show up and soon disappear". With depthTest off they always
     * paint on top; the lifted Y still keeps them visually "on" the grass.
     */
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const dashes = new THREE.InstancedMesh(dashGeo, dashMat, MAX_DASHES);
  dashes.frustumCulled = false;
  dashes.renderOrder = 10;
  // Park every instance at scale 0 until update() has run; otherwise the
  // default identity matrix would draw an axis-aligned print at world
  // origin for one frame before the first tick.
  const _initDummy = new THREE.Object3D();
  _initDummy.scale.set(0, 0, 0);
  _initDummy.updateMatrix();
  for (let i = 0; i < MAX_DASHES; i++) {
    dashes.setMatrixAt(i, _initDummy.matrix);
  }
  dashes.instanceMatrix.needsUpdate = true;
  root.add(dashes);

  scene.add(root);

  const goal = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  let active = false;

  /**
   * Set the destination. Snaps the X to terrain height at (gx, gz).
   */
  function setGoal(gx, gz) {
    goal.set(gx, sampleSurfaceY(gx, gz) + GROUND_LIFT_M, gz);
    xGroup.position.copy(goal);
    active = true;
  }

  /**
   * Per-frame update. Repositions dashes along the player→goal line.
   * Footprint orientation honours the **player's facing yaw** (not the
   * raw path direction) per May-17 2026 user spec — so the prints
   * always read as if produced by the player's feet right now, even
   * when the path bends. Footprint Y is locked to **playerPos.y** so
   * each print sits at the player's foot level instead of the terrain
   * sample (matches the user's "at same level as player" ask).
   *
   * @param {THREE.Vector3 | { x: number, y: number, z: number }} playerPos
   * @param {number} dt seconds since last tick
   * @param {number} [playerYaw] World yaw of the player. Falls back to
   *        path-direction-derived yaw when omitted.
   */
  function update(playerPos, dt, playerYaw) {
    if (!active) return;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.066) dt = 0.066;

    const dx = goal.x - playerPos.x;
    const dz = goal.z - playerPos.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.45) {
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      for (let i = 0; i < MAX_DASHES; i++) {
        dashes.setMatrixAt(i, dummy.matrix);
      }
      dashes.instanceMatrix.needsUpdate = true;
      const pulse = 0.92 + Math.sin(performance.now() * 0.006) * 0.08;
      xGroup.scale.setScalar(pulse);
      return;
    }

    const dirX = dx / dist;
    const dirZ = dz / dist;
    /**
     * Footprint orientation: prefer the live player yaw so the prints
     * always face the way the player faces (May-17 2026 user spec
     * "change feet that they always line up with the facing of
     * player"). Fall back to path-direction yaw when no yaw is passed.
     *
     * The engine's locomotion convention is `_fwd = (-sin yaw, 0, -cos yaw)`
     * — i.e. yaw=π faces world +Z (north). After `rotation.x = -π/2`
     * the plane's long axis is local +X = world (cos yaw_geo, 0, sin yaw_geo)
     * for the THREE Euler `(rotation.x=-π/2, rotation.y=yaw_geo)`. To
     * align that long axis with the player-forward vector
     * `(-sin playerYaw, 0, -cos playerYaw)` we need yaw_geo such that
     * `(cos yaw_geo, sin yaw_geo) = (-sin playerYaw, -cos playerYaw)`,
     * giving `yaw_geo = atan2(-cos playerYaw, -sin playerYaw)`.
     *
     * For the path-direction fallback we use atan2(dirX, dirZ) which
     * matches the original plane convention.
     */
    const yaw = Number.isFinite(playerYaw)
      ? Math.atan2(-Math.cos(playerYaw), -Math.sin(playerYaw))
      : Math.atan2(dirX, dirZ);
    // Perpendicular (right-side normal in XZ) — for the lateral L/R
    // offset. Always derived from the path direction so left/right
    // prints stay on opposite sides of the path centreline regardless
    // of which way the player is facing.
    const perpX = dirZ;
    const perpZ = -dirX;

    // Skip the first stride so the trail starts ahead of the player's
    // own feet, and stop short of the X so the final print doesn't
    // overlap the marker. Resulting prints are evenly spaced at exactly
    // STRIDE_M intervals along the path — no phase drift, no slide.
    const firstAlong = STRIDE_M * 0.6;
    const lastAlong = dist - STRIDE_M * 0.4;
    const printCount = Math.max(
      0,
      Math.min(MAX_DASHES, Math.floor((lastAlong - firstAlong) / STRIDE_M) + 1),
    );

    for (let i = 0; i < MAX_DASHES; i++) {
      if (i >= printCount) {
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        dashes.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const along = firstAlong + i * STRIDE_M;
      // Alternate LEFT (-1) / RIGHT (+1) prints along the trail.
      const footSide = i % 2 === 0 ? -1 : 1;
      const lateralX = perpX * FOOT_LATERAL_OFFSET_M * footSide;
      const lateralZ = perpZ * FOOT_LATERAL_OFFSET_M * footSide;
      const px = playerPos.x + dirX * along + lateralX;
      const pz = playerPos.z + dirZ * along + lateralZ;
      // `sampleSurfaceY` honours registered deck surfaces (fishing dock,
      // tipi platforms) so the print sits on the deck planks instead of
      // sinking through to the underlying terrainY.
      const py = sampleSurfaceY(px, pz) + GROUND_LIFT_M;
      dummy.position.set(px, py, pz);
      // The shape geometry is the right foot. After `rotation.x = -π/2`,
      // local Y becomes world Z, so a `scale.z = -1` mirrors the foot
      // across the path-aligned long axis → left foot.
      const mirrorZ = footSide; // +1 right, -1 left
      dummy.rotation.set(-Math.PI / 2, yaw, 0);
      dummy.scale.set(1, 1, mirrorZ);
      dummy.updateMatrix();
      dashes.setMatrixAt(i, dummy.matrix);
    }
    dashes.instanceMatrix.needsUpdate = true;

    // X mark gentle pulse so it stays eye-catching at distance.
    const pulse = 0.92 + Math.sin(performance.now() * 0.006) * 0.08;
    xGroup.scale.setScalar(pulse);
  }

  function dispose() {
    try { scene.remove(root); } catch (_e) { /* ignore */ }
    armGeo.dispose();
    dashGeo.dispose();
    xMat.dispose();
    dashMat.dispose();
    active = false;
  }

  return { root, setGoal, update, dispose };
}
