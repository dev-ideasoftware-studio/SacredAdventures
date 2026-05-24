/**
 * Sacred Adventures v2 — Fauna pillar.
 *
 * • Three rabbit families, each with one adult + two kits. Kits lagomorph-follow
 *   their parent (**comfort-radius PD** + exploratory lateral sway) behind mom’s hips;
 *   turn‑first steering; gravity‑limited hops (kits ≤ **2× body length**).
 * • **Saltatory kinematics**: shared gait oscillator modulates forward speed &
 *   synchronizes ballistic pushes (mom & kits at different amplitude caps); forward
 *   accel is jerk-limited (`MOM_FORWARD_*`, `BABY_FORWARD_*`) — no instantaneous
 *   glide from idle to sprint.
 * • **Animation**: the GLB hop/idle clip's `timeScale` tracks horizontal
 *   speed so foot cadence stays in the same ballpark as stride length.
 * • **Attention**: kits bias their facing toward mom; mom blends her yaw
 *   toward the camera when nearly idle.
 * • **3D dark burrow** (May-12 2026, second-pass tune): ~28 cm diameter ×
 *   30 cm deep (about a foot down), gradient-lit `BackSide` cylinder
 *   throat from near-black at the lip to pure black at the floor, +
 *   a near-black `lip-cap` disc just under the rim so the hole reads as
 *   "a place light doesn't reach" from any angle (including straight
 *   down). One procedural WebGL hole is placed per family on open grass.
 * • **Hide / peek state machine** (May-17 2026 refresh): player **feet**
 *   within **1 tile** of any family member → whole family runs into the
 *   burrow; mom **peeks** until the player is **≥ 2 tiles** from the
 *   burrow, then staggered emerge. Between **1–2 tiles**, rabbits **face
 *   the player** while shuffling / playful hopping — **no** player-driven
 *   spirit-style scamper in that band (spirit / bloom / deer-alarm / NPC
 *   threats still scatter as before).
 * • **Threat scamper** (May-12 2026 refresh): when the **player avatar
 *   feet** come within `THREAT_ENTER_M` of any rabbit, OR the **visible
 *   nature-spirit body** enters `SPIRIT_BODY_NEAR_ENTER_M` (half a tile),
 *   the family enters `FAMILY_MODE_SPIRIT_AVOID` (same phases as before:
 *   `PHASE_SPIRIT_DODGE` → `PHASE_SPIRIT_WATCH`). Each rabbit
 *   scampers a short hop *away* from the nearest active threat, then
 *   holds and yaws toward the **player** (not the spirit). Release when
 *   threats are clear — spirit body uses `SPIRIT_BODY_NEAR_CLEAR_M`
 *   hysteresis; player still uses `SPIRIT_FAR_M`. Player-driven dodge is
 *   gated so burrow + “curious watch” radii take priority (see
 *   `PLAYER_BURROW_ENTER_M` / `PLAYER_LOOK_RADIUS_M`).
 * • **Wander**: moms pick random XZ targets within `WANDER_RADIUS_M` of
 *   each family's fixed `anchorX`/`anchorZ` (see `constants.js`
 *   `V2_RABBIT_FAMILY_LAYOUT` — three corners of a **6-tile** equilateral
 *   triangle; original tipi-1 anchor is preserved).
 * • **Warren hub**: triangle centroid gets a **large** 3D dark chasm
 *   (shared `terrainY` carve in `WorldTerrain.js` + vertex dirt pass in
 *   `World.js` + WebGL throat mesh here) so the centre reads as bare earth,
 *   not grass.
 * • **Trample**: while a family is in `SPIRIT_AVOID`, if the player's feet
 *   slip inside `TRAMPLE_RE_SCAMPER_M` of any rabbit, the family re-issues a
 *   longer dodge hop away from the avatar.
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { getRuntimeService } from "./RuntimeServices.js";
import { terrainY as analyticTerrainY } from "./WorldTerrain.js";
import {
  V2_AVATAR_TARGET_HEIGHT_M,
  V2_NATURE_SPIRIT_BLOOM_PEAK_RADIUS_M,
  V2_POND_ENCLAVE_CENTER_X_M,
  V2_POND_ENCLAVE_CENTER_Z_M,
  V2_POOL2_BASIN_RADIUS_M,
  V2_RABBIT_FAMILY_LAYOUT,
  V2_RABBIT_WARREN_CHASM_DEPTH_M,
  V2_RABBIT_WARREN_CHASM_RADIUS_M,
  V2_RABBIT_WARREN_HUB_X_M,
  V2_RABBIT_WARREN_HUB_Z_M,
  V2_TILE_WORLD,
} from "./constants.js";

const POOL_EXCLUSION_RADIUS_M = V2_POOL2_BASIN_RADIUS_M + 1.2;
const POOL_EXCLUSION_RADIUS_SQ =
  POOL_EXCLUSION_RADIUS_M * POOL_EXCLUSION_RADIUS_M;

const RABBIT_URL = "./Assets/rabbit.animated.glb";

/** Legacy calibration (~51 cm); mom is 25 % shorter than this. */
const RABBIT_BASE_CALIBRATION_M = V2_AVATAR_TARGET_HEIGHT_M * 0.55;
const MOM_HEIGHT_M = RABBIT_BASE_CALIBRATION_M * 0.75;
const BABY_HEIGHT_M = MOM_HEIGHT_M * 0.5;

const G = 9.81;
const MOM_MAX_SPEED = 0.26;
const BABY_MAX_SPEED = 2.05;
/** @deprecated superseded per-step PD on follow distance — kept for snapshot/export. */
const BABY_FOLLOW_GAIN = 2.8;
const BABY_FOLLOW_DAMP = 0.92;
const STRIDE_PER_BODY = 0.38;
const IDLE_ANIM_SCALE = 0.5;

/** Bounding-style gait: frequency scales slightly with commanded speed (Hz-ish). */
const MOM_GAIT_FREQ_BASE = 1.95;
const MOM_GAIT_FREQ_SPEED = 3.6;
const BABY_GAIT_FREQ_BASE = 2.45;
const BABY_GAIT_FREQ_SPEED = 4.2;
/** Map excess distance beyond comfort-radius to forward demand (kits). */
const BABY_DIST_SPEED_GAIN = 1.68;
/** Envelope floor / ceiling on horizontal speed (simulated gather / extended phases). */
const GAIT_ENVELOPE_FLOOR = 0.52;
const GAIT_ENVELOPE_POWER = 1.65;

/** Ground locomotion jerk limits (approximate muscular effort; kits burst harder). */
const MOM_FORWARD_ACCEL = 1.42;
const MOM_FORWARD_DECEL = 3.05;
const BABY_FORWARD_ACCEL = 2.55;
const BABY_FORWARD_DECEL = 3.85;

/** Mom: visible ballistic hops while foraging — bumped May-2026 user spec
 *  ("more realistic cute jumping") so the bound is read at any chase-cam
 *  distance. 8–18 cm is still under one body-length, true to actual mom
 *  rabbit gait, but every hop now arcs clearly above the heightfield. */
const MOM_BOUND_H_MIN = 0.082;
const MOM_BOUND_H_MAX = 0.185;
/** Body-pitch + squash/stretch envelope (May-2026). Real rabbits pitch
 *  nose-up on takeoff and nose-down on descent; mid-air they stretch out
 *  long; on landing the body compresses briefly before recovering. */
const HOP_PITCH_VY_GAIN = 0.18;           // rad per (m/s) of vy
const HOP_PITCH_MAX_RAD = 0.55;           // ±32° pitch cap
const HOP_PITCH_SLEW_HZ = 18.0;           // tau ≈ 1 / 18 s — quick but not instant
const HOP_STRETCH_AIR_GAIN = 1.85;        // multiplies airY to a stretch fraction
const HOP_STRETCH_MAX = 0.16;             // cap stretch Y at 1.16
const HOP_LAND_SQUASH_DUR_S = 0.18;
const HOP_LAND_SQUASH_Y = 0.78;           // 22 % compression at the impact peak
const HOP_LAND_SQUASH_XZ = 1.12;          // body widens to conserve volume
const HOP_LAND_TRIGGER_VY = -0.45;        // landings below this vy register squash
/** Preferred stand-off from follow slot → reduces jitter at rest (body lengths). */
const BABY_FOLLOW_COMFORT_BODY = 1.08;
/** Lateral exploratory sway while grazing near mom — short lagomorph “check the edges”. */
const BABY_EXPLORATION_SWAY_M = 0.42;
/** Occasional max-speed burst when kit lags badly behind Mom (juvenile sprint). */
const BABY_CATCH_UP_DIST_BODY = 2.95;
/** Roam around the meadow from the family's fixed anchor (not the whole map). */
const WANDER_RADIUS_M = 12.0;
const WANDER_REPICK_SEC = 5.0;
/** Never translate until body-forward is almost aligned with the route. */
const FORWARD_MOVE_MAX_YAW_ERR = (8 * Math.PI) / 180;
const MOM_TURN_RATE = 4.2;
const BABY_TURN_RATE = 5.2;

/**
 * Player feet within this radius → rabbits prioritize facing the avatar
 * (slow shuffle / playful hops for kits). **Burrow dive** uses the tighter
 * `PLAYER_BURROW_ENTER_M` (1 tile).
 */
const PLAYER_LOOK_RADIUS_M = V2_TILE_WORLD * 2;
const PLAYER_LOOK_RADIUS_SQ = PLAYER_LOOK_RADIUS_M * PLAYER_LOOK_RADIUS_M;

/** Player this close to **any** rabbit in the family → full burrow sequence. */
const PLAYER_BURROW_ENTER_M = V2_TILE_WORLD * 1;
const PLAYER_BURROW_ENTER_SQ = PLAYER_BURROW_ENTER_M * PLAYER_BURROW_ENTER_M;

/** Peeking mom / hidden family releases when player is at least this far from burrow XZ. */
const PLAYER_BURROW_RELEASE_M = V2_TILE_WORLD * 2;
/** Player feet this close to a rabbit while the family is dodging → re-scamper. */
const TRAMPLE_RE_SCAMPER_M = 1.1;
// Diameter ≈ 0.28 m (11″) — wide enough for mom's body length to fit
// inside the throat during the HIDDEN phase, and visually readable as a
// real hole from a 3rd-person camera at ~1.5 m above terrain.
const BURROW_THROAT_RAD = 0.14;
// "About a foot down" per user spec May-12 2026 — 12 in ≈ 0.30 m.
const BURROW_DEPTH_M = 0.30;
const LIP_OUTER_R = 0.27;
const LIP_INNER_R = 0.16;

// === Rabbit hide / peek state machine =====================================
// May-12 2026 burrow mesh + staggered emerge; May-17 2026 player radii:
// 1 tile enter, 2 tile release, 2 tile “watch player” facing ring.

/** How long the descent (above-ground → below-ground) lerp takes. */
const DESCEND_DUR_S = 0.30;

/** How long the rise (below-ground → pop) lerp takes. */
const RISE_DUR_S = 0.42;

/** Delay between successive rabbits popping up. Mom is slot 0 → 0 s
 *  delay (first), baby1 slot 1 → 0.35 s, baby2 slot 2 → 0.70 s. */
const EMERGE_STAGGER_S = 0.35;

/** How far mom's head sits above the ground plane while peeking. */
const PEEK_HEAD_LIFT_M = 0.04;
/** Parent waits underground before peeking at the player (short = snappier “mom checks first”). */
const PARENT_PEEK_DELAY_S = 1.15;

/** Snap distance for WALK_TO_HOLE → DESCENDING (≈ throat width). */
const DIVE_ARRIVAL_DIST_M = BURROW_THROAT_RAD;

/** Family-mode top-level state. */
const FAMILY_MODE_NORMAL = "normal";
const FAMILY_MODE_HIDING = "hiding";
const FAMILY_MODE_HIDDEN = "hidden";
const FAMILY_MODE_SHOWING = "showing";
/** Sub-mode entered when the nature-spirit walks by — see file header. */
const FAMILY_MODE_SPIRIT_AVOID = "spirit_avoid";

/** Per-rabbit phase under the family mode. */
const PHASE_ROAM = "roam";
const PHASE_WALK_TO_HOLE = "walk_to_hole";
const PHASE_DESCENDING = "descending";
const PHASE_HIDDEN = "hidden";
const PHASE_RISE_WAIT = "rise_wait";
const PHASE_RISING = "rising";
const PHASE_RETURNING = "returning";
/** Spirit-avoid phases — `DODGE` runs to a one-shot dodge target,
 *  `WATCH` holds in place yawing toward the **player** (avatar feet). */
const PHASE_SPIRIT_DODGE = "spirit_dodge";
const PHASE_SPIRIT_WATCH = "spirit_watch";

/** Rabbit-to-threat XZ distance below this triggers scamper (player or bloom). */
const THREAT_ENTER_M = V2_TILE_WORLD * 1.15;
/** @deprecated alias — same value as THREAT_ENTER_M */
const SPIRIT_DODGE_TRIGGER_M = THREAT_ENTER_M;

/**
 * Nature-spirit **body** — rabbits clear when the stag is within half a tile;
 * they may resume once every rabbit is beyond `SPIRIT_BODY_NEAR_CLEAR_M`
 * (gentle hysteresis vs enter).
 */
const SPIRIT_BODY_NEAR_ENTER_M = V2_TILE_WORLD * 0.5;
const SPIRIT_BODY_NEAR_CLEAR_M = V2_TILE_WORLD * 0.62;
const SPIRIT_BODY_ENTER_SQ = SPIRIT_BODY_NEAR_ENTER_M * SPIRIT_BODY_NEAR_ENTER_M;
const SPIRIT_BODY_CLEAR_SQ = SPIRIT_BODY_NEAR_CLEAR_M * SPIRIT_BODY_NEAR_CLEAR_M;

/** Once the spirit's XZ distance from every rabbit exceeds this, the
 *  watching family is released back to PHASE_RETURNING. Hysteresis vs
 *  the trigger so a slow spirit drift along the edge doesn't oscillate. */
const SPIRIT_FAR_M = SPIRIT_DODGE_TRIGGER_M + V2_TILE_WORLD * 1.0;

/** How far each rabbit hops directly away from the spirit when it
 *  arrives. Kept short so the family doesn't scatter clear off the
 *  meadow — the read is "jump out of its way", not "flee". */
const SPIRIT_DODGE_DIST_M = 1.05;

/** Arrival snap radius for `PHASE_SPIRIT_DODGE`. */
const SPIRIT_DODGE_ARRIVAL_M = 0.10;

/**
 * Movers (other than the player + spirit) that rabbits scatter from at
 * `THREAT_ENTER_M` (~1 tile) — May-16 2026 user spec: "rabbits won't move
 * out of the way of moving models = if anything is 1 tile away, they
 * scamper away from other npc and wildlife and player avatar".
 *
 * Identified via `userData.anuKind`. The set covers NPC seated rigs
 * (so rabbits scatter when an NPC walks near or even when the player
 * pulls a seated NPC's collider close), the pond deer herd, and any
 * fauna prefix except rabbits themselves (which would self-trigger).
 */
const THREAT_MOVER_EXACT_KINDS = new Set([
  "npc_yb_tipi1_seated",
  "npc_bhg_tipi2_seated",
  "landmark_pool_deer",
]);
const THREAT_MOVER_PREFIXES = ["fauna_buffalo", "fauna_horse", "fauna_bird"];

const _moverScanVec = new THREE.Vector3();

function minPlayerDistSqToFamily(family, playerXZ) {
  let best = Infinity;
  for (const r of family.rabbits) {
    const dx = playerXZ.x - r.group.position.x;
    const dz = playerXZ.z - r.group.position.z;
    best = Math.min(best, dx * dx + dz * dz);
  }
  return best;
}

/**
 * Per-frame mover-scan was costing real time: `scene.traverse` walks
 * every Object3D in the world (~thousands) per tick to find a tiny set
 * (~4–6) of NPC / wildlife roots. Movers don't appear / disappear
 * between frames, so we cache the resolved Object3D refs once and read
 * `getWorldPosition` each frame; the candidate-list rescan is throttled
 * to one every `MOVER_CACHE_REFRESH_FRAMES` ticks (~1.5 s @ 60 FPS).
 */
const MOVER_CACHE_REFRESH_FRAMES = 90;
let _moverCachedRefs = null;
let _moverCachedFrame = -MOVER_CACHE_REFRESH_FRAMES;

function _rescanMovers(scene) {
  if (!scene) return [];
  const out = [];
  scene.traverse((obj) => {
    const kind = obj.userData?.anuKind;
    if (!kind || typeof kind !== "string") return;
    if (!THREAT_MOVER_EXACT_KINDS.has(kind)) {
      let matched = false;
      for (let i = 0; i < THREAT_MOVER_PREFIXES.length; i++) {
        if (kind.startsWith(THREAT_MOVER_PREFIXES[i])) { matched = true; break; }
      }
      if (!matched) return;
    }
    out.push(obj);
  });
  return out;
}

function collectExtraMoverXZs(scene, frameCount = 0) {
  if (!scene) return null;
  if (
    _moverCachedRefs === null ||
    frameCount - _moverCachedFrame >= MOVER_CACHE_REFRESH_FRAMES
  ) {
    _moverCachedRefs = _rescanMovers(scene);
    _moverCachedFrame = frameCount;
  }
  if (_moverCachedRefs.length === 0) return null;
  const out = [];
  for (const ref of _moverCachedRefs) {
    ref.getWorldPosition(_moverScanVec);
    out.push({ x: _moverScanVec.x, z: _moverScanVec.z });
  }
  return out.length > 0 ? out : null;
}

const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();

function findHeadBone(root) {
  let found = null;
  root.traverse((o) => {
    if (found || !o.isSkinnedMesh || !o.skeleton) return;
    for (const b of o.skeleton.bones) {
      if (/^head$/i.test(b.name)) {
        found = b;
        return;
      }
    }
    for (const b of o.skeleton.bones) {
      if (/head/i.test(b.name) && !/hand|thumb|index|middle|ring|pinky/i.test(b.name)) {
        found = b;
        return;
      }
    }
    for (const b of o.skeleton.bones) {
      if (/neck/i.test(b.name)) {
        found = b;
        return;
      }
    }
  });
  return found;
}

function buildRabbitInstance(template, targetHeightM, gltfAnimations) {
  const cloned = cloneSkinned(template);
  const bbox = new THREE.Box3().setFromObject(cloned);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const rawH = Math.max(size.y, 1e-3);
  const scale = targetHeightM / rawH;
  cloned.scale.setScalar(scale);
  const scaledBox = new THREE.Box3().setFromObject(cloned);
  cloned.position.y -= scaledBox.min.y;

  /**
   * Forward-axis pivot (May-11 2026 evening, take 2 — measured).
   *
   * Forensic probe `scratch/probe-three-failures.mjs` showed the rabbit
   * GLB's local bbox is `(x:0.96, y:1.0, z:0.52)` — its **long axis is X**,
   * not Z. A 180° pivot around Y (my previous attempt) kept the nose
   * perpendicular to motion (dot(nose, translateZ) = 0 ⇒ visible sideways
   * walking). The correct mapping is a quarter-turn so cloned-local +X (or
   * -X — see `_axisSign` below) becomes pivot-frame +Z.
   *
   * We pick the sign empirically from the head-bone's bind-pose X: if the
   * head bone sits at +X relative to the skeleton root, the nose is at +X
   * and we rotate by **-π/2** ((1,0,0) → (0,0,1)); if -X, we rotate +π/2.
   * Falls back to -π/2 when no head bone is found.
   *
   * Pivot stays outside the SkinnedMesh subtree so bone-local frames are
   * preserved (head/neck yaw tweaks read as the rig authored them).
   */
  const headBone = findHeadBone(cloned);
  let axisSign = -1; // default: nose at +X ⇒ rotate -π/2
  if (headBone) {
    const skel = cloned.children.find?.((c) => c.isSkinnedMesh)?.skeleton;
    const root3 = skel?.bones?.[0] ?? null;
    headBone.updateMatrixWorld(true);
    root3?.updateMatrixWorld(true);
    const hp = new THREE.Vector3().setFromMatrixPosition(headBone.matrixWorld);
    const rp = root3
      ? new THREE.Vector3().setFromMatrixPosition(root3.matrixWorld)
      : new THREE.Vector3(0, 0, 0);
    /** If head is further from skeleton root along -X than +X, nose is at -X. */
    if (hp.x - rp.x < 0) axisSign = +1;
  }
  const pivot = new THREE.Group();
  pivot.rotation.y = axisSign * (Math.PI / 2);
  pivot.add(cloned);

  // Pitch wrapper — sits between `root` (yaw) and `pivot` (forward-axis
  // alignment) so we can tilt the rabbit nose-up on ascent / nose-down on
  // descent without disturbing yaw or the axis-alignment math. Local X of
  // this group lines up with the rabbit's left/right body axis after the
  // outer root applies yaw, so `pitchGroup.rotation.x` cleanly pitches
  // around the spine's perpendicular. Squash & stretch also live here so
  // the deformation reads through bones (vs scaling the SkinnedMesh).
  const pitchGroup = new THREE.Group();
  pitchGroup.add(pivot);

  const root = new THREE.Group();
  root.add(pitchGroup);
  /** Body length is along the rig's long axis = X (size.x, not max). */
  const bodyLengthM = size.x * scale;
  return {
    root,
    mesh: cloned,
    bodyLengthM,
    headBone,
    pitchGroup,
    axisSign,
    animClip: gltfAnimations && gltfAnimations[0] ? gltfAnimations[0] : null,
  };
}

function tintRabbitMesh(root, hex) {
  const c = new THREE.Color(hex);
  root.traverse((node) => {
    if (!node.isMesh && !node.isSkinnedMesh) return;
    const src = Array.isArray(node.material) ? node.material[0] : node.material;
    if (!src) return;
    const m = src.clone();
    if (m.color) m.color.copy(c);
    m.roughness = 0.92;
    m.metalness = 0;
    m.side = THREE.FrontSide;
    node.material = m;
    node.castShadow = true;
    node.receiveShadow = false;
    /**
     * Re-enable frustum culling on rabbit skinned meshes. The previous
     * `frustumCulled = false` was an over-defensive workaround when we
     * suspected bind-pose bbox didn't track animated bones — but the
     * rabbits wander within a ~1 m radius, the bind-pose box is good
     * enough for culling, and forcing them visible always was a measured
     * FPS hit (~3 unnecessary per-frame skinning passes when off-screen).
     */
    if (node.isSkinnedMesh) node.frustumCulled = true;
  });
}

/**
 * Large shared **warren hub** hole at the centroid of the three-family
 * triangle — matches the `WorldTerrain.terrainY` bowl carve + dirt vertex
 * pass so the centre reads as a real void (not a grass decal).
 */
function buildWarrenCentralChasm(scene, physics) {
  const cx = V2_RABBIT_WARREN_HUB_X_M;
  const cz = V2_RABBIT_WARREN_HUB_Z_M;
  const gy = physics.getGroundY(cx, cz);
  const group = new THREE.Group();
  group.position.set(cx, gy, cz);
  group.name = "fauna_warren_hub_chasm";
  group.userData.anuId = "fauna.rabbit_warren.hub_chasm";
  group.userData.anuKind = "rabbit_warren_chasm";

  const topR = V2_RABBIT_WARREN_CHASM_RADIUS_M * 0.9;
  const botR = V2_RABBIT_WARREN_CHASM_RADIUS_M * 0.58;
  const depth = V2_RABBIT_WARREN_CHASM_DEPTH_M;
  const lipOuter = V2_RABBIT_WARREN_CHASM_RADIUS_M * 1.24;

  const rimProfile = [
    new THREE.Vector2(lipOuter + 0.025, 0.001),
    new THREE.Vector2(lipOuter, 0.014),
    new THREE.Vector2(lipOuter * 0.86, 0.052),
    new THREE.Vector2((lipOuter + topR) * 0.5, 0.078),
    new THREE.Vector2(topR * 1.1, 0.042),
    new THREE.Vector2(topR, 0.012),
  ];
  const rim = new THREE.Mesh(
    new THREE.LatheGeometry(rimProfile, 44),
    new THREE.MeshStandardMaterial({
      color: 0x4a3220,
      roughness: 0.97,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  rim.castShadow = true;
  rim.receiveShadow = true;
  rim.name = "fauna_warren_rim_mound";
  group.add(rim);

  const throatGeom = new THREE.CylinderGeometry(topR, botR, depth, 44, 10, true);
  const posAttr = throatGeom.getAttribute("position");
  const colors = new Float32Array(posAttr.count * 3);
  const topColor = new THREE.Color(0x120a06);
  const botColor = new THREE.Color(0x000000);
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    const tRaw = (y + depth / 2) / depth;
    const t = THREE.MathUtils.clamp(tRaw, 0, 1);
    const k = t * t * (3 - 2 * t);
    colors[i * 3 + 0] = THREE.MathUtils.lerp(botColor.r, topColor.r, k);
    colors[i * 3 + 1] = THREE.MathUtils.lerp(botColor.g, topColor.g, k);
    colors[i * 3 + 2] = THREE.MathUtils.lerp(botColor.b, topColor.b, k);
  }
  throatGeom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const throat = new THREE.Mesh(
    throatGeom,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      toneMapped: false,
    }),
  );
  throat.position.y = -depth * 0.5 + 0.012;
  throat.name = "fauna_warren_throat_gradient";
  group.add(throat);

  const lipCap = new THREE.Mesh(
    new THREE.CircleGeometry(topR * 0.985, 36),
    new THREE.MeshBasicMaterial({
      color: 0x030201,
      toneMapped: false,
      side: THREE.FrontSide,
    }),
  );
  lipCap.rotation.x = -Math.PI / 2;
  lipCap.position.y = -0.018;
  lipCap.name = "fauna_warren_lip_dark_cap";
  group.add(lipCap);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(botR * 0.78, 28),
    new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -depth + 0.012;
  floor.name = "fauna_warren_floor";
  group.add(floor);

  scene.add(group);
  return { group };
}

function buildNarrowBurrowHole(scene, physics, familySpec) {
  // Use the analytical `terrainY()` (with full burrow carve baked in)
  // directly. `physics.getGroundY()` maxes against registered deck
  // surfaces (tipi platforms, etc.) — if a deck overlaps the burrow XZ,
  // `getGroundY` returns the deck top and the burrow rim mound visually
  // floats on top of the deck instead of sitting inside the carved dip.
  const gy = analyticTerrainY(familySpec.burrowX, familySpec.burrowZ);
  const group = new THREE.Group();
  group.position.set(familySpec.burrowX, gy, familySpec.burrowZ);
  group.name = `fauna_burrow_${familySpec.key}`;
  group.userData.anuId = `fauna.rabbit_family.${familySpec.key}.burrow`;
  group.userData.anuKind = "rabbit_burrow_webgl";

  /**
   * Raised soil rim — a `LatheGeometry` whose 2-D profile describes the
   * silhouette of dug-up dirt around the hole mouth, then revolved
   * around +Y. This replaces the prior flat `RingGeometry` "decal" so
   * the rim reads as real 3-D from oblique angles: as the player walks
   * past at ground level the mound visibly rises off the grass + casts
   * its own shadow into the throat (which is the strongest secondary
   * depth cue once the gradient on the throat wall is in place).
   *
   * Profile points are `(radius, y)` ordered outside-to-inside; the
   * last point ends at `BURROW_THROAT_RAD` so the rim's inner ledge
   * meets the throat wall flush (no visible seam at the lip).
   *
   * May-16 2026 — terrain carve removed; the rim is now the only thing
   * sitting on grass, so the profile was flattened (crest 0.038 → 0.014 m)
   * and the skirt extended out further so the mound reads as a slight
   * "scuffed dirt around a hole" rather than a 4 cm mole hill on perfect
   * grass. Total above-grass height ≈ 14 mm.
   */
  const rimProfile = [
    new THREE.Vector2(LIP_OUTER_R + 0.040, 0.0002), // long skirt: feathered to hide grass seam
    new THREE.Vector2(LIP_OUTER_R + 0.010, 0.003),
    new THREE.Vector2(LIP_OUTER_R, 0.008),
    new THREE.Vector2(LIP_OUTER_R * 0.82, 0.012),
    new THREE.Vector2((LIP_OUTER_R + BURROW_THROAT_RAD) * 0.5, 0.014), // gentle crest
    new THREE.Vector2(BURROW_THROAT_RAD * 1.20, 0.010),
    new THREE.Vector2(BURROW_THROAT_RAD, 0.004), // inner ledge → flush with throat top edge
  ];
  const rim = new THREE.Mesh(
    new THREE.LatheGeometry(rimProfile, 32),
    new THREE.MeshStandardMaterial({
      color: 0x5c3d28,
      roughness: 0.97,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  rim.castShadow = true;
  rim.receiveShadow = true;
  rim.name = "fauna_burrow_rim_mound";
  group.add(rim);

  /**
   * Throat wall — open-ended cylinder, rendered `BackSide` so we only
   * see the interior surface (looking down through the rim mouth).
   * A per-vertex color attribute drives a smoothstep gradient from
   * **near-black** at the lip to **pure black** at the floor. The top
   * was previously dirt-brown (`0x3a2716`); from a near-overhead camera
   * the brown blended with the rim mound and the hole read as a flat
   * decal (May-12 2026 user screenshot). Keeping the entire interior
   * dark — with just enough delta to keep a subtle depth gradient when
   * viewed from oblique angles — makes the hole read as "a place light
   * doesn't reach".
   *
   * Stays `MeshBasicMaterial` (unlit) on purpose: the inside of the
   * throat is never directly lit anyway (sun overhead grazes vertical
   * walls at ~0°), and we want the gradient to be the only thing
   * driving wall brightness — independent of tone-mapping changes.
   */
  const throatGeom = new THREE.CylinderGeometry(
    BURROW_THROAT_RAD,
    BURROW_THROAT_RAD * 0.78,
    BURROW_DEPTH_M,
    32,
    6,
    true,
  );
  const posAttr = throatGeom.getAttribute("position");
  const colors = new Float32Array(posAttr.count * 3);
  const topColor = new THREE.Color(0x140b06);
  const botColor = new THREE.Color(0x000000);
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i);
    // cylinder centred at y=0 → t = 1 at top vertex, 0 at bottom vertex.
    const tRaw = (y + BURROW_DEPTH_M / 2) / BURROW_DEPTH_M;
    const t = THREE.MathUtils.clamp(tRaw, 0, 1);
    const k = t * t * (3 - 2 * t); // smoothstep — softer falloff near lip
    colors[i * 3 + 0] = THREE.MathUtils.lerp(botColor.r, topColor.r, k);
    colors[i * 3 + 1] = THREE.MathUtils.lerp(botColor.g, topColor.g, k);
    colors[i * 3 + 2] = THREE.MathUtils.lerp(botColor.b, topColor.b, k);
  }
  throatGeom.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const throat = new THREE.Mesh(
    throatGeom,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      toneMapped: false,
    }),
  );
  throat.position.y = -BURROW_DEPTH_M * 0.5 + 0.006;
  throat.name = "fauna_burrow_throat_gradient";
  group.add(throat);

  /**
   * Lip-cap occluder — a near-black disc placed just below the rim's
   * inner ledge, facing +Y. From overhead the player's eye lands on
   * this disc INSTEAD of the back-side throat wall (which from straight
   * down barely contributes pixels). The disc is rendered with a
   * `MeshBasicMaterial` so it doesn't pick up sky reflections; without
   * it, the burrow read as the brown rim with a faintly-darker centre
   * — the original "flat decal" bug from the user's May-12 screenshot.
   *
   * May-16 2026 — terrain carve removed. The lipCap previously sat at
   * Y = -0.012 m (inside the carved dip), but with the flat grass mesh
   * now extending across the burrow XZ the cap would be hidden behind
   * grass. Moved to Y = +0.003 m (just above grass) and bumped to
   * radius `BURROW_THROAT_RAD * 1.05` so it slightly under-laps the
   * rim's inner ledge (no seam) and reads as the dark hole opening
   * from any angle. `depthWrite: false` + `renderOrder: 1` keeps it
   * drawing on top of the grass mesh without z-fight.
   */
  const lipCap = new THREE.Mesh(
    new THREE.CircleGeometry(BURROW_THROAT_RAD * 1.05, 28),
    new THREE.MeshBasicMaterial({
      color: 0x040201,
      toneMapped: false,
      side: THREE.FrontSide,
      depthWrite: false,
    }),
  );
  lipCap.rotation.x = -Math.PI / 2;
  lipCap.position.y = 0.003;
  lipCap.renderOrder = 1;
  lipCap.name = "fauna_burrow_lip_dark_cap";
  group.add(lipCap);

  /**
   * Floor — a tiny pure-black disc just above the cylinder's bottom so
   * the eye lands on solid earth, not on a hairline back-side seam at
   * the geometry's true bottom. Kept slightly smaller than the throat
   * bottom radius so it never z-fights the throat wall.
   */
  const cap = new THREE.Mesh(
    new THREE.CircleGeometry(BURROW_THROAT_RAD * 0.72, 20),
    new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false }),
  );
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = -BURROW_DEPTH_M + 0.008;
  cap.name = "fauna_burrow_floor";
  group.add(cap);

  scene.add(group);
  return { group };
}

function shortestAngleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Realistic longitudinal dynamics (Lagomorpha “burst then coast” pacing):
 * clamp jerk instead of instantaneous speed blending — avoids ice-skate glide.
 */
function applyLagomorphForwardDynamics(r, targetSpeed, dt, isMom) {
  const maxA = isMom ? MOM_FORWARD_ACCEL : BABY_FORWARD_ACCEL;
  const maxD = isMom ? MOM_FORWARD_DECEL : BABY_FORWARD_DECEL;
  const diff = targetSpeed - r.speed;
  const cap = diff > 0 ? maxA * dt : -maxD * dt;
  const step =
    Math.abs(diff) < Math.abs(cap) ? diff : Math.sign(cap) * Math.abs(cap);
  r.speed += step;
  if (Math.abs(r.speed) < 1e-6) r.speed = 0;
}

/**
 * Bounding / half-bound envelope — low duty ≈ limbs gathered, high duty
 * ≈ extension phase (~canter/bound proxy with one scalar speed track).
 * Optional `ctx` supplies kit follow distance for ballistic catch-up hops.
 */
function gaitModulateMag(r, wantMagRaw, dt, gaitFreqBase, gaitFreqSpeed, ctx) {
  if (wantMagRaw < 1e-4 || r.phase !== PHASE_ROAM) return Math.max(0, wantMagRaw);

  let phase = r.gaitPhase ?? Math.random() * Math.PI * 2;
  const vmax = r.role === "mom" ? MOM_MAX_SPEED : BABY_MAX_SPEED;
  const hz = gaitFreqBase + Math.min(vmax, wantMagRaw) * gaitFreqSpeed;
  phase += dt * hz * Math.PI * 2;
  if (Math.abs(phase) > 1e5) phase = ((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  r.gaitPhase = phase;

  const s = Math.sin(phase);
  const prev = r._gaitSinPrev ?? s;
  const duty =
    GAIT_ENVELOPE_FLOOR +
    (1 - GAIT_ENVELOPE_FLOOR) * Math.pow(Math.abs(s), GAIT_ENVELOPE_POWER);

  /** Takeoff: upward zero-cross ⇒ hindquarter ballistic extension. */
  if (wantMagRaw > 0.045 && prev <= 0 && s > 0 && (r.airY ?? 0) <= 0.024) {
    const rel = THREE.MathUtils.clamp(wantMagRaw / vmax, 0.05, 1);
    if (r.role === "mom") {
      const h = THREE.MathUtils.lerp(MOM_BOUND_H_MIN, MOM_BOUND_H_MAX, rel * rel);
      r.vy = Math.max(r.vy ?? 0, Math.sqrt(2 * G * Math.max(0.0015, h)));
    } else if (
      ctx &&
      (r.jumpCd ?? 0) <= 0.02 &&
      ctx.dist > ctx.bodyLen * (BABY_FOLLOW_COMFORT_BODY + 0.28)
    ) {
      /** Juvenile sprint hops when lagging vs comfort-radius follow point. */
      const lagRatio = THREE.MathUtils.clamp(
        (ctx.dist - ctx.comfort) / Math.max(ctx.bodyLen, 0.08),
        0,
        6,
      );
      const bh = THREE.MathUtils.clamp(0.1 + lagRatio * 0.065, 0.07, ctx.maxHop);
      r.vy = Math.max(r.vy ?? 0, Math.sqrt(2 * G * bh));
      r.jumpCd = 0.09 + lagRatio * 0.035;
    }
  }
  r._gaitSinPrev = s;

  return wantMagRaw * duty;
}

/**
 * Drive the per-frame rabbit hop pose — pitch + squash/stretch + landing
 * impact. Reads the rabbit's ballistic state (`r.airY`, `r.vy`,
 * `r.prevAirY`, `r.landSquashT`) and the cached `r.pitchGroup` /
 * `r.axisSign` from build time. Safe to call every frame; cheap and
 * allocation-free.
 *
 * Three layered effects:
 *
 *  1. **Pitch.** `pitch ≈ -vy × gain` (clamped) — positive vy (ascending)
 *     reads as nose-up; negative vy (descending) noses down toward the
 *     landing point. Slewed toward the target so the head doesn't snap.
 *
 *  2. **Stretch.** While airborne, vertical scale grows with `airY` so
 *     the body extends as the rabbit reaches apex (real bound posture is
 *     long-and-low).
 *
 *  3. **Landing impact.** On the transition out of airborne (`prevAirY
 *     > 0` && `airY ≤ 0`) with a meaningful downward velocity, a brief
 *     squash timer compresses Y / expands XZ on a quadratic ease back to
 *     identity. Reads as the body collapsing under its own weight then
 *     popping back — classic cute landing.
 */
function applyRabbitHopPose(r, dt) {
  if (!r?.pitchGroup) return;

  // 1. Landing-trigger — fired on the airY > 0 → airY = 0 transition.
  //    `r.impactVy` is captured by the integration step BEFORE vy is
  //    clamped to zero at touchdown; without it we'd never see a non-
  //    zero vy on the landing frame here.
  const landedThisFrame =
    (r.prevAirY ?? 0) > 0.005 && (r.airY ?? 0) <= 0.001;
  if (landedThisFrame && (r.impactVy ?? 0) <= HOP_LAND_TRIGGER_VY) {
    r.landSquashT = HOP_LAND_SQUASH_DUR_S;
  }
  r.prevAirY = r.airY ?? 0;
  if ((r.landSquashT ?? 0) > 0) r.landSquashT = Math.max(0, r.landSquashT - dt);

  // 2. Pitch — target from vy. Slew toward target rather than snap so
  //    a one-frame vy spike doesn't whip the head.
  let pitchTarget = 0;
  if ((r.airY ?? 0) > 0.001 || Math.abs(r.vy ?? 0) > 0.05) {
    pitchTarget = THREE.MathUtils.clamp(
      (r.vy ?? 0) * HOP_PITCH_VY_GAIN,
      -HOP_PITCH_MAX_RAD,
      HOP_PITCH_MAX_RAD,
    );
  }
  // pitchGroup.rotation.x = -noseUpAmount (see build-site comment for the
  // sign derivation). With nose at +Z in pitchGroup-local, a positive
  // rotation.x rotates the nose DOWN, so we negate to map "positive
  // noseUp" → negative rotation.x.
  const cur = r.pitchGroup.rotation.x;
  const target = -pitchTarget;
  const k = 1 - Math.exp(-HOP_PITCH_SLEW_HZ * dt);
  r.pitchGroup.rotation.x = cur + (target - cur) * k;

  // 3. Squash & stretch — multiplicative envelope on pitchGroup.scale.
  //    Air-stretch raises Y; landing squash dips Y & widens XZ.
  let scaleY = 1;
  let scaleXZ = 1;
  const air = r.airY ?? 0;
  if (air > 0.001) {
    const stretch = Math.min(HOP_STRETCH_MAX, air * HOP_STRETCH_AIR_GAIN);
    scaleY *= 1 + stretch;
    scaleXZ *= 1 - stretch * 0.42;
  }
  if ((r.landSquashT ?? 0) > 0) {
    // Quadratic ease — sharpest squash at the impact moment, recover
    // smoothly. `phase` ∈ [0,1] : 0 = mid-recovery, 1 = peak compression.
    const phase = (r.landSquashT / HOP_LAND_SQUASH_DUR_S);
    const env = phase * (2 - phase); // ease-out: starts at 1, ends at 0
    scaleY *= 1 + (HOP_LAND_SQUASH_Y - 1) * env;
    scaleXZ *= 1 + (HOP_LAND_SQUASH_XZ - 1) * env;
  }
  r.pitchGroup.scale.set(scaleXZ, scaleY, scaleXZ);
}

/**
 * Strict rabbit movement invariant: turn first, move only along visible
 * body-forward after alignment. This prevents the "sideways/backwards"
 * read caused by translating while the yaw is still catching up.
 */
function turnThenForwardStep(r, yawGoal, desiredSpeed, dt, turnRate) {
  const isMom = r.role === "mom";
  const yawErr = shortestAngleDelta(r.group.rotation.y, yawGoal);
  const yawStep = THREE.MathUtils.clamp(yawErr, -turnRate * dt, turnRate * dt);
  r.group.rotation.y += yawStep;

  const remainingErr = Math.abs(shortestAngleDelta(r.group.rotation.y, yawGoal));
  const aligned = remainingErr <= FORWARD_MOVE_MAX_YAW_ERR;
  const targetSpeed = aligned ? Math.max(0, desiredSpeed) : 0;
  applyLagomorphForwardDynamics(r, targetSpeed, dt, isMom);

  if (r.speed > 1e-4) r.group.translateZ(r.speed * dt);
  return aligned;
}

function pickWanderTarget(anchorX, anchorZ) {
  for (let tries = 0; tries < 6; tries++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * WANDER_RADIUS_M;
    const x = anchorX + Math.sin(a) * r;
    const z = anchorZ + Math.cos(a) * r;
    const dxP = x - V2_POND_ENCLAVE_CENTER_X_M;
    const dzP = z - V2_POND_ENCLAVE_CENTER_Z_M;
    if (dxP * dxP + dzP * dzP >= POOL_EXCLUSION_RADIUS_SQ) {
      return { x, z };
    }
  }
  // Fallback: project the anchor outward away from the pool centre.
  const ax = anchorX - V2_POND_ENCLAVE_CENTER_X_M;
  const az = anchorZ - V2_POND_ENCLAVE_CENTER_Z_M;
  const d = Math.hypot(ax, az) || 1;
  return {
    x: V2_POND_ENCLAVE_CENTER_X_M + (ax / d) * POOL_EXCLUSION_RADIUS_M,
    z: V2_POND_ENCLAVE_CENTER_Z_M + (az / d) * POOL_EXCLUSION_RADIUS_M,
  };
}

/**
 * Mom locomotion — face-then-step.
 *
 * Decoupled from the prior velocity-vector drift model (which dragged the
 * rabbit through XZ by a tweened `vel.x / vel.z`, sometimes sideways or
 * backwards depending on how the rig's forward axis read after the π
 * pivot fix). New shape:
 *
 *   1. Pick a wander target.
 *   2. Compute desired yaw (target direction, blended toward camera when
 *      nearly idle so she "looks up" curious).
 *   3. Smoothly turn `r.group.rotation.y` toward that yaw.
 *   4. Step **forward** along the rabbit's nose with `translateZ(speed·dt)`.
 *
 * This is what the user asked for: "use facing mechanics to move them" —
 * no sideways drift, no negative-Z drag, no animation-vs-motion mismatch.
 */
function updateMom(r, dt, physics, camera, playerXZ) {
  r.wanderTimer -= dt;
  if (r.wanderTimer <= 0) {
    r.wanderTimer = WANDER_REPICK_SEC * (0.6 + Math.random() * 0.9);
    const t = pickWanderTarget(r.anchorX, r.anchorZ);
    r.wanderTx = t.x;
    r.wanderTz = t.z;
  }

  const pdx = playerXZ.x - r.group.position.x;
  const pdz = playerXZ.z - r.group.position.z;
  const playerDistSq = pdx * pdx + pdz * pdz;
  const playerLook = playerDistSq <= PLAYER_LOOK_RADIUS_SQ;
  const playerInsideLookOuter =
    playerDistSq > PLAYER_BURROW_ENTER_SQ && playerDistSq <= PLAYER_LOOK_RADIUS_SQ;

  const dx = r.wanderTx - r.group.position.x;
  const dz = r.wanderTz - r.group.position.z;
  const dist = Math.hypot(dx, dz);

  let wantMagRaw;
  let yawGoal;
  const camYaw = Math.atan2(
    camera.position.x - r.group.position.x,
    camera.position.z - r.group.position.z,
  );
  if (playerLook) {
    /** Curious ring: face the player's feet; slow shuffle unless burrow is imminent this frame. */
    yawGoal = Math.atan2(pdx, pdz);
    if (playerInsideLookOuter) {
      wantMagRaw = dist > 0.05 ? Math.min(MOM_MAX_SPEED * 0.38, dist * 0.22) : 0;
    } else {
      wantMagRaw = 0;
    }
  } else {
    wantMagRaw = dist > 0.05 ? Math.min(MOM_MAX_SPEED, dist * 0.55) : 0;
    const moveYaw = dist > 1e-4 ? Math.atan2(dx, dz) : r.group.rotation.y;
    yawGoal = wantMagRaw > 0 ? moveYaw : camYaw;
  }
  const gaitWant = (playerLook && !playerInsideLookOuter) || wantMagRaw < 1e-5
    ? 0
    : gaitModulateMag(
        r,
        wantMagRaw,
        dt,
        MOM_GAIT_FREQ_BASE,
        MOM_GAIT_FREQ_SPEED,
      );
  turnThenForwardStep(r, yawGoal, gaitWant, dt, MOM_TURN_RATE);

  const gY = physics.getGroundY(r.group.position.x, r.group.position.z);
  r.vy -= G * dt;
  r.airY += r.vy * dt;
  r.impactVy = r.vy; // pre-clamp vy for the landing-squash trigger
  if (r.airY <= 0 && r.vy <= 0) {
    r.airY = 0;
    r.vy = 0;
  }
  r.group.position.y = gY + r.airY;
  applyRabbitHopPose(r, dt);

  if (r.action && r.animClip) {
    const stride = Math.max(0.08, r.bodyLengthM * STRIDE_PER_BODY);
    const dur = r.animClip.duration || 0.6;
    const hz = 1 / Math.max(0.12, dur * 0.48);
    const ts =
      (playerLook && !playerInsideLookOuter) || r.speed <= 0.02
        ? IDLE_ANIM_SCALE
        : THREE.MathUtils.clamp((r.speed / stride) / hz, 0.52, 2.35);
    r.action.timeScale = ts;
  }

  if (r.headBone && r.speed < 0.05) {
    const hy = shortestAngleDelta(
      r.headBone.rotation.y,
      shortestAngleDelta(r.group.rotation.y, camYaw) * 0.35,
    );
    r.headBone.rotation.y += hy * Math.min(1, 5 * dt);
  }
}

/**
 * Kit locomotion — face mom's slot, then step forward.
 *
 * The previous spring-damper steering operated on a free XZ velocity
 * vector, which produced lateral drift / backwards motion whenever the
 * kit's "drift heading" disagreed with the rig's forward axis (the user
 * saw this as sliding-backwards kits). New shape parallels `updateMom`:
 *
 *   1. Compute a "behind-and-beside-mom" follow point in world XZ.
 *   2. Set desired-facing yaw toward that follow point (or toward mom
 *      directly when very close, so the kit "looks at" mom while idle).
 *   3. Smoothly rotate the kit's group toward that yaw.
 *   4. Drive a scalar forward speed toward `wantSpeed` (distance-clamped)
 *      and `translateZ(speed·dt)` along the kit's nose.
 *
 *   4. Drive a jerk-limited scalar toward **comfort-radius error**, plus lateral
 *      exploratory sway (short “edge grazing” loops).
 *
 * Bounding hops combine duty-cycle gait with occasional random juvenile leaps —
 * ballistic caps remain `≤ 2× body lengths`; `translateZ(speed)` only after
 * body alignment (`turnThenForwardStep`).
 */
function updateBaby(r, dt, physics, mom, camera, playerXZ) {
  if (!mom) return;

  if (r.explorePhase === undefined) r.explorePhase = Math.random() * Math.PI * 2;
  r.explorePhase += dt * (0.48 + 0.06 * Math.sin(dt * 3.2 + r.followSign));

  const pdx = playerXZ.x - r.group.position.x;
  const pdz = playerXZ.z - r.group.position.z;
  const playerDistSq = pdx * pdx + pdz * pdz;
  const playerLook = playerDistSq <= PLAYER_LOOK_RADIUS_SQ;
  const playerInsideLookOuter =
    playerDistSq > PLAYER_BURROW_ENTER_SQ && playerDistSq <= PLAYER_LOOK_RADIUS_SQ;

  const lateral = r.followSign * 0.38;
  _vB.set(Math.sin(mom.group.rotation.y), 0, Math.cos(mom.group.rotation.y));
  _vC.set(-_vB.z, 0, _vB.x);

  /** Off-axis exploratory meander beside mom's travel lane — slow phase evolution. */
  const sway = BABY_EXPLORATION_SWAY_M * Math.sin(r.explorePhase);
  const tx =
    mom.group.position.x -
    _vB.x * 0.48 +
    _vC.x * lateral +
    _vC.x * sway;
  const tz =
    mom.group.position.z -
    _vB.z * 0.48 +
    _vC.z * lateral +
    _vC.z * sway;

  const dx = tx - r.group.position.x;
  const dz = tz - r.group.position.z;
  const dist = Math.hypot(dx, dz);

  let siblingNear = false;
  for (const o of r.family.rabbits) {
    if (o === r || o.role !== "baby") continue;
    const sdx = o.group.position.x - r.group.position.x;
    const sdz = o.group.position.z - r.group.position.z;
    if (sdx * sdx + sdz * sdz < 0.22) {
      siblingNear = true;
      break;
    }
  }

  const comfort = BABY_FOLLOW_COMFORT_BODY * r.bodyLengthM;
  const maxHopCap = Math.min(r.bodyLengthM * 2.0, 0.92);

  let wantMagRaw = 0;
  let moveYaw;
  if (playerLook) {
    /** Face the player; in the 1–2 tile ring keep tiny bouncy shuffle. */
    moveYaw = Math.atan2(pdx, pdz);
    if (playerInsideLookOuter) {
      wantMagRaw =
        dist > comfort * 0.35 ? Math.min(BABY_MAX_SPEED * 0.42, dist * 0.55) : 0;
      if (siblingNear) wantMagRaw *= 0.62;
    }
  } else {
    if (dist > comfort * 0.58) {
      const err = Math.max(0, dist - comfort * 0.9);
      let sp = BABY_DIST_SPEED_GAIN * err;
      if (dist > BABY_CATCH_UP_DIST_BODY * r.bodyLengthM) sp *= 1.22;
      wantMagRaw = Math.min(BABY_MAX_SPEED, sp);
    }
    const toMom = Math.atan2(
      mom.group.position.x - r.group.position.x,
      mom.group.position.z - r.group.position.z,
    );
    moveYaw = dist > 0.07 && wantMagRaw > 0.04 ? Math.atan2(dx, dz) : toMom;
  }

  const gaitCtx =
    (playerLook && !playerInsideLookOuter) ||
    wantMagRaw < 1e-4
      ? undefined
      : {
          dist,
          bodyLen: r.bodyLengthM,
          comfort: comfort * 0.9,
          maxHop: maxHopCap * (playerInsideLookOuter ? 0.72 : 1),
        };

  const gaitWant =
    playerLook && !playerInsideLookOuter
      ? 0
      : gaitModulateMag(
          r,
          wantMagRaw,
          dt,
          BABY_GAIT_FREQ_BASE,
          BABY_GAIT_FREQ_SPEED,
          gaitCtx,
        );
  turnThenForwardStep(r, moveYaw, gaitWant, dt, BABY_TURN_RATE);

  const gY = physics.getGroundY(r.group.position.x, r.group.position.z);
  r.vy -= G * dt;
  r.airY += r.vy * dt;
  r.impactVy = r.vy; // pre-clamp vy for the landing-squash trigger
  if (r.airY <= 0 && r.vy <= 0) {
    r.airY = 0;
    r.vy = 0;
  }
  r.group.position.y = gY + r.airY;
  applyRabbitHopPose(r, dt);

  r.jumpCd -= dt;
  /** Play hops — extra frequent when curious about player or chasing littermate. */
  const playCue =
    !playerLook &&
    r.airY <= 0.003 &&
    (r.jumpCd ?? 0) <= 0 &&
    dist > r.bodyLengthM * 2.2 &&
    gaitWant > 0.02;
  const curiousCue =
    playerInsideLookOuter &&
    r.airY <= 0.02 &&
    (r.jumpCd ?? 0) <= 0 &&
    Math.random() < 0.085 * dt * 60;
  const siblingCue =
    siblingNear &&
    !playerLook &&
    r.airY <= 0.02 &&
    (r.jumpCd ?? 0) <= 0 &&
    Math.random() < 0.05 * dt * 60;
  if (playCue) {
    r.vy = Math.sqrt(
      2 * G * Math.min(maxHopCap, 0.32 + Math.random() * 0.2),
    );
    r.jumpCd = 0.55 + Math.random() * 0.75;
  } else if (curiousCue || siblingCue) {
    r.vy = Math.sqrt(
      2 * G * Math.min(maxHopCap, 0.14 + Math.random() * 0.14),
    );
    r.jumpCd = 0.35 + Math.random() * 0.45;
  }

  if (r.action && r.animClip) {
    const stride = Math.max(0.06, r.bodyLengthM * STRIDE_PER_BODY);
    const dur = r.animClip.duration || 0.6;
    const hz = 1 / Math.max(0.12, dur * 0.48);
    const ts =
      (playerLook && !playerInsideLookOuter) || r.speed <= 0.025
        ? IDLE_ANIM_SCALE * 0.92
        : THREE.MathUtils.clamp((r.speed / stride) / hz, 0.48, 2.6);
    r.action.timeScale = ts;
  }

  if (r.headBone) {
    const camYaw = Math.atan2(
      camera.position.x - r.group.position.x,
      camera.position.z - r.group.position.z,
    );
    const hy = shortestAngleDelta(
      r.headBone.rotation.y,
      shortestAngleDelta(r.group.rotation.y, camYaw) * 0.28,
    );
    r.headBone.rotation.y += hy * Math.min(1, 4.5 * dt);
  }
}

/**
 * Helper used by WALK_TO_HOLE and RETURNING — face-then-step toward an XZ
 * target at panic / hurry speed, terrain-snapped Y. Optional cute hops for
 * burrow sprint (`allowCuteHop`).
 *
 * Returns true when the rabbit has arrived (within `arrivalDist`) so the
 * caller can advance to the next phase.
 */
function moveTowardXZ(
  r,
  dt,
  physics,
  targetX,
  targetZ,
  arrivalDist,
  maxSpeed,
  turnRate,
  allowCuteHop = false,
) {
  const dx = targetX - r.group.position.x;
  const dz = targetZ - r.group.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= arrivalDist) return true;
  const yaw = Math.atan2(dx, dz);
  const wantSpeed = Math.min(maxSpeed, Math.max(0.5, dist * 5.0));
  turnThenForwardStep(r, yaw, wantSpeed, dt, turnRate);
  const gY = physics.getGroundY(r.group.position.x, r.group.position.z);
  if (!allowCuteHop) {
    r.group.position.y = gY;
    r.vy = 0;
    r.airY = 0;
  } else {
    r.vy = (r.vy ?? 0) - G * dt;
    r.airY = (r.airY ?? 0) + r.vy * dt;
    if (r.airY <= 0 && r.vy <= 0) {
      r.airY = 0;
      r.vy = 0;
    }
    r.group.position.y = gY + r.airY;
  }
  return false;
}

/**
 * `phase === PHASE_WALK_TO_HOLE` — rabbit runs to the burrow at panic
 * speed (≈ 3.5× normal max). Once within `DIVE_ARRIVAL_DIST_M`, snaps to
 * the burrow XZ centre and transitions to PHASE_DESCENDING.
 */
function updateRabbitDive(r, dt, physics) {
  r.phaseT += dt;
  const family = r.family;
  r._diveBinkCd = (r._diveBinkCd ?? 0) - dt;
  if (
    r._diveBinkCd <= 0 &&
    (r.airY ?? 0) <= 0.02 &&
    Math.random() < 0.11 * dt * 60
  ) {
    r.vy = Math.sqrt(2 * G * (0.034 + Math.random() * 0.038));
    r._diveBinkCd = 0.18 + Math.random() * 0.16;
  }
  const arrived = moveTowardXZ(
    r,
    dt,
    physics,
    family.burrowX,
    family.burrowZ,
    DIVE_ARRIVAL_DIST_M,
    MOM_MAX_SPEED * 3.5,
    MOM_TURN_RATE * 2.5,
    true,
  );
  if (r.action) r.action.timeScale = 2.4;
  if (arrived || r.phaseT > 4.0) {
    r.group.position.x = family.burrowX;
    r.group.position.z = family.burrowZ;
    r.phase = PHASE_DESCENDING;
    r.phaseT = 0;
    r.vy = 0;
    r.airY = 0;
    r._diveBinkCd = 0;
  }
}

/**
 * `phase === PHASE_DESCENDING` — Y lerps from `groundY` to the rabbit's
 * hidden Y (mom: peeking; baby: fully underground) over `DESCEND_DUR_S`.
 * Smoothstep keeps the dive readable instead of mechanical.
 */
function updateRabbitDescend(r, dt, physics) {
  r.phaseT += dt;
  const family = r.family;
  const t = Math.min(1, r.phaseT / DESCEND_DUR_S);
  const k = t * t * (3 - 2 * t);
  const gY = physics.getGroundY(family.burrowX, family.burrowZ);
  const targetY = r.role === "mom"
    ? gY - r.bodyTotalH - 0.02
    : gY - r.bodyTotalH - 0.02;
  r.group.position.y = THREE.MathUtils.lerp(gY, targetY, k);
  r.group.position.x = family.burrowX;
  r.group.position.z = family.burrowZ;
  if (r.action) r.action.timeScale = IDLE_ANIM_SCALE;
  if (t >= 1) {
    r.group.position.y = targetY;
    r.phase = PHASE_HIDDEN;
    r.phaseT = 0;
  }
}

/**
 * `phase === PHASE_HIDDEN` — rabbit sits at the burrow.
 * Mom yaws toward the player (head-poking-up-and-watching read);
 * babies hold pose silently underground.
 */
function updateRabbitHidden(r, dt, playerXZ) {
  r.phaseT += dt;
  const family = r.family;
  if (r.role === "mom") {
    const gY = family.physics.getGroundY(family.burrowX, family.burrowZ);
    const targetY = r.phaseT >= PARENT_PEEK_DELAY_S
      ? gY - r.bodyTotalH + PEEK_HEAD_LIFT_M
      : gY - r.bodyTotalH - 0.02;
    r.group.position.y = THREE.MathUtils.lerp(r.group.position.y, targetY, Math.min(1, 6 * dt));
    const pdx = playerXZ.x - family.burrowX;
    const pdz = playerXZ.z - family.burrowZ;
    const yawGoal = Math.atan2(pdx, pdz);
    const yawErr = shortestAngleDelta(r.group.rotation.y, yawGoal);
    const yawStep = THREE.MathUtils.clamp(yawErr, -3.0 * dt, 3.0 * dt);
    r.group.rotation.y += yawStep;

    // Tilt the head bone slightly toward the player too, on top of the
    // body yaw — sells the "alert, watching" pose better than body-only.
    if (r.headBone) {
      const local = shortestAngleDelta(r.group.rotation.y, yawGoal) * 0.5;
      const hy = shortestAngleDelta(r.headBone.rotation.y, local);
      r.headBone.rotation.y += hy * Math.min(1, 5 * dt);
    }
  }
  if (r.action) r.action.timeScale = IDLE_ANIM_SCALE * 0.7;
}

/**
 * `phase === PHASE_RISE_WAIT` — staggered hold so emergence is sequential.
 * Mom slot 0 ⇒ riseDelay 0 s (starts immediately); baby1 slot 1 ⇒ 0.35 s;
 * baby2 slot 2 ⇒ 0.70 s. After the per-rabbit delay elapses, transitions
 * to PHASE_RISING.
 */
function updateRabbitRiseWait(r, dt) {
  r.phaseT += dt;
  if (r.phaseT >= r.riseDelay) {
    r.phase = PHASE_RISING;
    r.phaseT = 0;
  }
}

/**
 * `phase === PHASE_RISING` — Y lerps from hidden Y to a small pop above
 * the ground over `RISE_DUR_S`. Smoothstep + 5 cm overshoot reads as
 * "popping out", not "elevatoring out".
 */
function updateRabbitRise(r, dt, physics) {
  r.phaseT += dt;
  const family = r.family;
  const t = Math.min(1, r.phaseT / RISE_DUR_S);
  const k = t * t * (3 - 2 * t);
  const gY = physics.getGroundY(family.burrowX, family.burrowZ);
  const startY = r.role === "mom"
    ? gY - r.bodyTotalH + PEEK_HEAD_LIFT_M
    : gY - r.bodyTotalH - 0.02;
  const endY = gY + 0.05;
  r.group.position.y = THREE.MathUtils.lerp(startY, endY, k);
  if (r.action) r.action.timeScale = 1.5;
  if (t >= 1) {
    r.group.position.y = gY; // settle at ground level for the walk back
    r.phase = PHASE_RETURNING;
    r.phaseT = 0;
  }
}

/**
 * Read the nature-spirit stag's live XZ + the active bloom circle.
 * Returns `{ bodyXZ, bloomXZ, bloomRadius }`.
 *   - `bodyXZ`    — stag body position (null if not loaded / not visible)
 *   - `bloomXZ`   — bloom circle centre (null when bloom is inactive)
 *   - `bloomRadius` — current outer-ring radius (0 when inactive)
 *
 * Both triggers drive rabbit avoidance:
 *   - `bodyXZ`  uses `SPIRIT_BODY_NEAR_ENTER_M` (0.5 tile) while the stag
 *     is visible on an active path (walk / visit / leave).
 *   - `bloomXZ` uses `bloomRadius + BLOOM_FLEE_BUFFER_M` so rabbits
 *     scatter as the bloom circle sweeps outward at YB.
 */
const BLOOM_FLEE_BUFFER_M = 1.8;

const _SPIRIT_THREAT_BODY_STATES = new Set([
  "WALK_TO_STANDOFF",
  "FACE_YB",
  "NOD",
  "POST_NOD_HOLD",
  "WALK_TO_FOREST",
]);

function getSpiritState() {
  if (typeof window === "undefined") return { bodyXZ: null, bloomXZ: null, bloomRadius: 0 };
  const sys = window.natureSpiritSystem;
  const pos = sys?.root?.position;
  const op = typeof sys?._opacity === "number" ? sys._opacity : 0;
  const bodyThreat =
    !!pos &&
    !!sys?.root?.visible &&
    _SPIRIT_THREAT_BODY_STATES.has(String(sys.state || "")) &&
    op > 0.035;
  const bodyXZ = bodyThreat ? { x: pos.x, z: pos.z } : null;
  let bloomXZ = null;
  let bloomRadius = 0;
  try {
    const bt = sys?.getBloomThreatXZ?.();
    if (bt) { bloomXZ = { x: bt.x, z: bt.z }; bloomRadius = bt.radius; }
  } catch (_) {}
  return { bodyXZ, bloomXZ, bloomRadius };
}

/** Retained for any legacy callers — returns stag body XZ only. */
function getSpiritXZ() {
  return getSpiritState().bodyXZ;
}

/**
 * @param {object} family
 * @param {{ x: number, z: number }} playerXZ
 * @param {{ x: number, z: number } | null} spiritXZ  — stag body
 * @param {{ x: number, z: number } | null} bloomXZ   — bloom centre (null if inactive)
 * @param {number} bloomRadius — current outer-ring radius (0 if inactive)
 * @param {{ x: number, z: number } | null} alarmXZ
 * @param {Array<{ x: number, z: number }> | null} extraMoversXZ
 *   NPCs, deer herd, buffalo, etc. — any within `THREAT_ENTER_M` of any
 *   rabbit triggers scatter. **Player avatar is excluded** here; proximity
 *   uses `PLAYER_LOOK_RADIUS_M` / `PLAYER_BURROW_ENTER_M` in `update()`.
 */
function getThreatFleeOrigin(
  family,
  playerXZ,
  spiritXZ,
  bloomXZ = null,
  bloomRadius = 0,
  alarmXZ = null,
  extraMoversXZ = null,
) {
  const mom = family.mom;
  if (!mom) return null;
  const cx = mom.group.position.x;
  const cz = mom.group.position.z;
  const enterSq = THREAT_ENTER_M * THREAT_ENTER_M;

  let spiritInRange = false;
  if (spiritXZ) {
    for (const r of family.rabbits) {
      const sdx = spiritXZ.x - r.group.position.x;
      const sdz = spiritXZ.z - r.group.position.z;
      if (sdx * sdx + sdz * sdz <= SPIRIT_BODY_ENTER_SQ) { spiritInRange = true; break; }
    }
  }

  // Bloom circle threat — any rabbit inside (bloomRadius + buffer) of bloom centre must flee.
  let bloomInRange = false;
  if (bloomXZ && bloomRadius > 0) {
    const bloomTrigR = bloomRadius + BLOOM_FLEE_BUFFER_M;
    const bloomSq = bloomTrigR * bloomTrigR;
    for (const r of family.rabbits) {
      const bdx = bloomXZ.x - r.group.position.x;
      const bdz = bloomXZ.z - r.group.position.z;
      if (bdx * bdx + bdz * bdz <= bloomSq) { bloomInRange = true; break; }
    }
  }

  /**
   * Player-driven scamper is intentionally **not** wired here — proximity
   * uses `PLAYER_LOOK_RADIUS_M` / `PLAYER_BURROW_ENTER_M` in `FaunaModule.update`.
   */
  /**
   * May-16 2026 — alarm-driven flee. Any active Anu nature alarm (e.g.
   * a deer panicked nearby) within 8 m of any rabbit forces the family
   * into hide-mode just like a player/spirit threat. This is how the
   * world's wildlife "is aware of each other" — one panic propagates.
   */
  let alarmInRange = false;
  if (alarmXZ) {
    const alarmEnterSq = 8 * 8;
    for (const r of family.rabbits) {
      const adx = alarmXZ.x - r.group.position.x;
      const adz = alarmXZ.z - r.group.position.z;
      if (adx * adx + adz * adz <= alarmEnterSq) {
        alarmInRange = true;
        break;
      }
    }
  }

  /**
   * Extra movers — NPCs and other wildlife (deer herd, buffalo, etc.).
   * Any rabbit within `THREAT_ENTER_M` (≈1 tile) of any mover triggers a
   * scatter, and the nearest-to-mom mover wins the flee-vector arbitration
   * below. See `collectExtraMoverXZs` for the source list and `THREAT_*`
   * sets at the top of the file for filter shape.
   */
  let nearestMover = null;
  let nearestMoverDistSq = Infinity;
  if (extraMoversXZ && extraMoversXZ.length > 0) {
    for (let m = 0; m < extraMoversXZ.length; m++) {
      const mv = extraMoversXZ[m];
      let triggered = false;
      for (const r of family.rabbits) {
        const mdx = mv.x - r.group.position.x;
        const mdz = mv.z - r.group.position.z;
        if (mdx * mdx + mdz * mdz <= enterSq) { triggered = true; break; }
      }
      if (!triggered) continue;
      const dx = mv.x - cx;
      const dz = mv.z - cz;
      const dSq = dx * dx + dz * dz;
      if (dSq < nearestMoverDistSq) { nearestMoverDistSq = dSq; nearestMover = mv; }
    }
  }

  if (
    !spiritInRange &&
    !bloomInRange &&
    !alarmInRange &&
    !nearestMover
  ) {
    return null;
  }

  // Pick the nearest threat origin as the flee vector source.
  let best = null;
  let bestD = Infinity;
  if (spiritInRange && spiritXZ) {
    const d = Math.hypot(spiritXZ.x - cx, spiritXZ.z - cz);
    if (d < bestD) { best = spiritXZ; bestD = d; }
  }
  if (bloomInRange && bloomXZ) {
    const d = Math.hypot(bloomXZ.x - cx, bloomXZ.z - cz);
    // Bias bloom slightly so the bloom-flee vector is the primary driver
    // when both are active — rabbits should scatter from the expanding ring.
    if (d - 1.0 < bestD) { best = bloomXZ; bestD = d; }
  }
  if (alarmInRange && alarmXZ) {
    const d = Math.hypot(alarmXZ.x - cx, alarmXZ.z - cz);
    if (d < bestD) { best = alarmXZ; bestD = d; }
  }
  if (nearestMover) {
    const d = Math.sqrt(nearestMoverDistSq);
    if (d < bestD) { best = nearestMover; bestD = d; }
  }
  return best;
}

/**
 * True when every rabbit is far enough from all active threats to resume wandering.
 * Bloom stays a threat until the circle collapses (bloomRadius → 0 / bloom inactive).
 */
function threatsClearForRelease(
  family,
  playerXZ,
  spiritXZ,
  bloomXZ = null,
  bloomRadius = 0,
  alarmXZ = null,
) {
  const farSq = SPIRIT_FAR_M * SPIRIT_FAR_M;
  for (const r of family.rabbits) {
    const pdx = playerXZ.x - r.group.position.x;
    const pdz = playerXZ.z - r.group.position.z;
    if (pdx * pdx + pdz * pdz < farSq) return false;
    if (spiritXZ) {
      const sdx = spiritXZ.x - r.group.position.x;
      const sdz = spiritXZ.z - r.group.position.z;
      if (sdx * sdx + sdz * sdz < SPIRIT_BODY_CLEAR_SQ) return false;
    }
    if (bloomXZ && bloomRadius > 0) {
      const clearR = bloomRadius + BLOOM_FLEE_BUFFER_M + 1.0;
      const bdx = bloomXZ.x - r.group.position.x;
      const bdz = bloomXZ.z - r.group.position.z;
      if (bdx * bdx + bdz * bdz < clearR * clearR) return false;
    }
    // Alarm clears only when every rabbit is more than ~10 m away from
    // the alarm origin — gives the deer's panic ripple a believable
    // calm-down window before the family peeks out again.
    if (alarmXZ) {
      const adx = alarmXZ.x - r.group.position.x;
      const adz = alarmXZ.z - r.group.position.z;
      if (adx * adx + adz * adz < 10 * 10) return false;
    }
  }
  return true;
}

/**
 * Compute a per-rabbit dodge target — directly away from the threat XZ,
 * snapshot ONCE at the transition into SPIRIT_AVOID and stored on the
 * rabbit (`dodgeTx`, `dodgeTz`). Per-slot angular jitter spreads the
 * three rabbits so they don't all stack onto the same point. Mom gets
 * the centred vector; baby1 / baby2 fan out symmetrically by ~14°.
 * @param {number} [distMul=1] — multiplies hop distance (trample escape).
 */
function assignThreatDodgeTargets(rabbits, threatXZ, distMul = 1) {
  const hop = SPIRIT_DODGE_DIST_M * distMul;
  for (const r of rabbits) {
    let dx = r.group.position.x - threatXZ.x;
    let dz = r.group.position.z - threatXZ.z;
    let len = Math.hypot(dx, dz);
    if (len < 1e-3) {
      const fwd = r.group.rotation.y;
      dx = Math.sin(fwd);
      dz = Math.cos(fwd);
      len = 1;
    }
    const nx = dx / len;
    const nz = dz / len;
    const slot = r.slot ?? 0;
    const jitter = slot === 0 ? 0 : (slot === 1 ? -0.25 : 0.25);
    const cs = Math.cos(jitter);
    const sn = Math.sin(jitter);
    const ax = nx * cs - nz * sn;
    const az = nx * sn + nz * cs;
    r.dodgeTx = r.group.position.x + ax * hop;
    r.dodgeTz = r.group.position.z + az * hop;
  }
}

/**
 * `phase === PHASE_SPIRIT_DODGE` — rabbit runs to its one-shot dodge
 * target at hurry speed. Once arrived (or 1.8 s fail-safe), switches to
 * PHASE_SPIRIT_WATCH so the family yaws toward the player.
 */
function updateRabbitSpiritDodge(r, dt, physics) {
  r.phaseT += dt;
  const turnRate = r.role === "mom" ? MOM_TURN_RATE * 2.0 : BABY_TURN_RATE * 1.8;
  const arrived = moveTowardXZ(
    r,
    dt,
    physics,
    r.dodgeTx,
    r.dodgeTz,
    SPIRIT_DODGE_ARRIVAL_M,
    MOM_MAX_SPEED * 3.0,
    turnRate,
  );
  if (r.action) r.action.timeScale = 2.1; // hop cadence — they're hurrying
  if (arrived || r.phaseT > 1.8) {
    r.phase = PHASE_SPIRIT_WATCH;
    r.phaseT = 0;
  }
}

/**
 * `phase === PHASE_SPIRIT_WATCH` — rabbit holds at its dodge spot and
 * yaws toward the **player avatar feet** so the family watches you after
 * scampering from spirit or self.
 */
function updateRabbitSpiritWatch(r, dt, physics, playerXZ) {
  r.phaseT += dt;
  const pdx = playerXZ.x - r.group.position.x;
  const pdz = playerXZ.z - r.group.position.z;
  const yawGoal = Math.atan2(pdx, pdz);
  const yawErr = shortestAngleDelta(r.group.rotation.y, yawGoal);
  const yawStep = THREE.MathUtils.clamp(yawErr, -3.5 * dt, 3.5 * dt);
  r.group.rotation.y += yawStep;
  const gY = physics.getGroundY(r.group.position.x, r.group.position.z);
  r.group.position.y = gY;
  r.vy = 0;
  r.airY = 0;
  if (r.action) r.action.timeScale = IDLE_ANIM_SCALE * 0.8;
}

/**
 * `phase === PHASE_RETURNING` — rabbit walks back to its own roaming
 * anchor at moderate-hurry speed. A 3.5 s fail-safe drops it back to
 * roaming so a bad terrain query can't strand a rabbit at the burrow.
 */
function updateRabbitReturn(r, dt, physics) {
  r.phaseT += dt;
  const arrived = moveTowardXZ(
    r,
    dt,
    physics,
    r.anchorX,
    r.anchorZ,
    0.20,
    MOM_MAX_SPEED * 2.5,
    MOM_TURN_RATE * 2.0,
  );
  if (r.action) r.action.timeScale = 1.6;
  if (arrived || r.phaseT > 3.5) {
    r.phase = PHASE_ROAM;
    r.phaseT = 0;
    if (r.action) r.action.timeScale = IDLE_ANIM_SCALE;
  }
}

export const FaunaModule = {
  name: "Fauna",

  _scene: null,
  _camera: null,
  _physics: null,
  _disposed: false,
  /** @type {Array<object>} */
  _families: [],
  /** @type {Array<object>} */
  _rabbits: [],
  _warrenChasm: null,
  _bootLog: false,

  async load(scene, camera, _renderer, _orchestrator) {
    if (this._disposed) return;
    this._scene = scene;
    this._camera = camera;

    const physics = getRuntimeService("WorldPhysics");
    if (!physics || typeof physics.getGroundY !== "function") {
      console.warn(
        "[Fauna] WorldPhysics.getGroundY unavailable — activate World before Fauna. Skipping spawn.",
      );
      return;
    }
    this._physics = physics;

    let gltf;
    try {
      gltf = await new GLTFLoaderWithDraco().loadAsync(RABBIT_URL);
    } catch (err) {
      console.warn("[Fauna] rabbit.animated.glb load failed:", err);
      return;
    }
    const template = gltf.scene;
    template.updateMatrixWorld(true);

    for (const spec of V2_RABBIT_FAMILY_LAYOUT) {
      const family = {
        ...spec,
        physics,
        burrow: buildNarrowBurrowHole(scene, physics, spec),
        rabbits: [],
        mom: null,
        mode: FAMILY_MODE_NORMAL,
      };

      const momInst = buildRabbitInstance(template, MOM_HEIGHT_M, gltf.animations);
      tintRabbitMesh(momInst.root, spec.tint);
      const momY = physics.getGroundY(spec.anchorX, spec.anchorZ);
      momInst.root.position.set(spec.anchorX, momY, spec.anchorZ);
      momInst.root.rotation.y = Math.PI * 0.92;
      momInst.root.name = `fauna_rabbit_mom_${spec.key}`;
      momInst.root.userData.anuId = `fauna.rabbit_family.${spec.key}.mom`;
      momInst.root.userData.anuKind = "rabbit";
      scene.add(momInst.root);

      let momMixer = null;
      let momAction = null;
      if (momInst.animClip) {
        momMixer = new THREE.AnimationMixer(momInst.root);
        momAction = momMixer.clipAction(momInst.animClip);
        momAction.setLoop(THREE.LoopRepeat, Infinity);
        momAction.timeScale = IDLE_ANIM_SCALE;
        momAction.play();
      }

      const momState = {
        family,
        role: "mom",
        id: `rabbit_mom_${spec.key}`,
        group: momInst.root,
        pitchGroup: momInst.pitchGroup,
        axisSign: momInst.axisSign,
        mixer: momMixer,
        action: momAction,
        animClip: momInst.animClip,
        bodyLengthM: momInst.bodyLengthM,
        bodyTotalH: MOM_HEIGHT_M,
        headBone: momInst.headBone,
        speed: 0,
        vy: 0,
        airY: 0,
        prevAirY: 0,
        landSquashT: 0,
        anchorX: spec.anchorX,
        anchorZ: spec.anchorZ,
        wanderTimer: 0,
        wanderTx: spec.anchorX,
        wanderTz: spec.anchorZ,
        gaitPhase: Math.random() * Math.PI * 2,
        phase: PHASE_ROAM,
        phaseT: 0,
        slot: 0,
        riseDelay: 0,
      };
      family.mom = momState;
      family.rabbits.push(momState);
      this._rabbits.push(momState);

      for (let i = 0; i < 2; i++) {
        const inst = buildRabbitInstance(template, BABY_HEIGHT_M, gltf.animations);
        tintRabbitMesh(inst.root, spec.tint);
        const ox = spec.anchorX + (i === 0 ? 0.42 : -0.42);
        const oz = spec.anchorZ - 0.35;
        const by = physics.getGroundY(ox, oz);
        inst.root.position.set(ox, by, oz);
        inst.root.rotation.y = momInst.root.rotation.y;
        inst.root.name = `fauna_rabbit_baby_${spec.key}_${i + 1}`;
        inst.root.userData.anuId = `fauna.rabbit_family.${spec.key}.baby_${i + 1}`;
        inst.root.userData.anuKind = "rabbit";
        scene.add(inst.root);

        let mixer = null;
        let action = null;
        if (inst.animClip) {
          mixer = new THREE.AnimationMixer(inst.root);
          action = mixer.clipAction(inst.animClip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.time = (i + 1) * 0.31 * inst.animClip.duration;
          action.timeScale = IDLE_ANIM_SCALE * 0.95;
          action.play();
        }

        const babyState = {
          family,
          role: "baby",
          id: `rabbit_baby_${spec.key}_${i + 1}`,
          speed: 0,
          group: inst.root,
          pitchGroup: inst.pitchGroup,
          axisSign: inst.axisSign,
          mixer,
          action,
          animClip: inst.animClip,
          bodyLengthM: inst.bodyLengthM,
          bodyTotalH: BABY_HEIGHT_M,
          headBone: inst.headBone,
          vy: 0,
          airY: 0,
          prevAirY: 0,
          landSquashT: 0,
          followSign: i === 0 ? 1 : -1,
          jumpCd: i * 0.2,
          explorePhase: Math.random() * Math.PI * 2,
          gaitPhase: Math.random() * Math.PI * 2,
          anchorX: ox,
          anchorZ: oz,
          phase: PHASE_ROAM,
          phaseT: 0,
          slot: i + 1,
          riseDelay: 0,
        };
        family.rabbits.push(babyState);
        this._rabbits.push(babyState);
      }

      this._families.push(family);
    }

    this._warrenChasm = buildWarrenCentralChasm(scene, physics);

    if (!this._bootLog) {
      console.log(
        "%c[Fauna] Three rabbit families + WebGL burrows",
        "color:#ce93d8;font-weight:bold;",
        `— ${this._families.length} families, ${this._rabbits.length} rabbits, ${this._families.length} burrows + warren hub chasm.`,
      );
      this._bootLog = true;
    }
  },

  unload() {
    this._disposed = true;
    if (this._scene) {
      for (const r of this._rabbits) {
        this._scene.remove(r.group);
        r.group.traverse((n) => {
          if (n.isMesh || n.isSkinnedMesh) {
            n.geometry?.dispose?.();
            const m = n.material;
            if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
            else m?.dispose?.();
          }
        });
        r.mixer?.stopAllAction?.();
      }
      for (const family of this._families) {
        const group = family.burrow?.group;
        if (!group) continue;
        this._scene.remove(group);
        group.traverse((n) => {
          if (n.isMesh) {
            n.geometry?.dispose?.();
            const m = n.material;
            if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
            else m?.dispose?.();
          }
        });
      }
      const wg = this._warrenChasm?.group;
      if (wg) {
        this._scene.remove(wg);
        wg.traverse((n) => {
          if (n.isMesh) {
            n.geometry?.dispose?.();
            const m = n.material;
            if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
            else m?.dispose?.();
          }
        });
        this._warrenChasm = null;
      }
    }
    this._families.length = 0;
    this._rabbits.length = 0;
  },

  update(delta) {
    if (!this._physics || this._rabbits.length === 0 || !this._camera) return;
    const cam = this._camera;
    const dt = Math.min(0.05, delta);
    this._frameCount = (this._frameCount | 0) + 1;

    for (const r of this._rabbits) {
      r.mixer?.update(delta);
    }

    /** Use WorldPlayer.feet for burrow + watch radii (`PLAYER_*`), not the chase camera. */
    const playerState = getRuntimeService("WorldPlayer");
    const playerXZ = playerState?.feet
      ? { x: playerState.feet.x, z: playerState.feet.z }
      : { x: cam.position.x, z: cam.position.z };

    /** Nature-spirit body XZ + bloom circle state (may be null on early frames). */
    const { bodyXZ: spiritXZ, bloomXZ, bloomRadius } = getSpiritState();

    /**
     * Anu nature-awareness alarm — propagates other animals' panic into
     * the rabbit FSM. When a deer flees, its `raiseAlarm()` parks an XZ
     * on the registry; we expose it here as `alarmXZ` so the existing
     * threat-flee plumbing treats it like a (4th) threat source.
     * May-16 2026: cross-species awareness wiring.
     */
    const awareness = getRuntimeService("AnuNatureAwareness");
    let alarmXZ = null;
    if (awareness) {
      const snap = awareness.snapshot();
      if (snap?.alarm) alarmXZ = { x: snap.alarm.x, z: snap.alarm.z };
    }

    /**
     * Extra movers (NPCs + non-rabbit wildlife) scanned once per frame
     * from the scene graph. Any within `THREAT_ENTER_M` (~1 tile) of any
     * rabbit pushes that family into scatter-mode via `getThreatFleeOrigin`.
     */
    const extraMoversXZ = collectExtraMoverXZs(this._scene, this._frameCount);

    // === Family-mode transitions ========================================
    for (const family of this._families) {
      const minSq = minPlayerDistSqToFamily(family, playerXZ);
      const shouldBurrow = minSq <= PLAYER_BURROW_ENTER_SQ;

      const burrowModesOk =
        family.mode === FAMILY_MODE_NORMAL ||
        family.mode === FAMILY_MODE_SHOWING ||
        family.mode === FAMILY_MODE_SPIRIT_AVOID;

      if (shouldBurrow && burrowModesOk) {
        family.mode = FAMILY_MODE_HIDING;
        for (const r of family.rabbits) {
          r.phase = PHASE_WALK_TO_HOLE;
          r.phaseT = 0;
        }
      }

      const useMomCentroid =
        (family.mode === FAMILY_MODE_NORMAL ||
          family.mode === FAMILY_MODE_SPIRIT_AVOID ||
          family.mode === FAMILY_MODE_HIDING) &&
        family.mom;
      const familyX = useMomCentroid ? family.mom.group.position.x : family.burrowX;
      const familyZ = useMomCentroid ? family.mom.group.position.z : family.burrowZ;
      const familyDist = Math.hypot(playerXZ.x - familyX, playerXZ.z - familyZ);

      const canEnterThreatAvoid =
        family.mode === FAMILY_MODE_NORMAL ||
        (family.mode === FAMILY_MODE_SHOWING &&
          family.rabbits.some((r) => r.phase === PHASE_RETURNING));

      if (canEnterThreatAvoid && !shouldBurrow) {
        const flee = getThreatFleeOrigin(family, playerXZ, spiritXZ, bloomXZ, bloomRadius, alarmXZ, extraMoversXZ);
        if (flee) {
          family.mode = FAMILY_MODE_SPIRIT_AVOID;
          const fleeIsSpirit =
            !!spiritXZ &&
            Math.hypot(flee.x - spiritXZ.x, flee.z - spiritXZ.z) < 0.08;
          assignThreatDodgeTargets(
            family.rabbits,
            flee,
            fleeIsSpirit ? 2.35 : 1,
          );
          for (const r of family.rabbits) {
            r.phase = PHASE_SPIRIT_DODGE;
            r.phaseT = 0;
          }
        }
      }

      if (family.mode === FAMILY_MODE_SPIRIT_AVOID) {
        const trampleSq = TRAMPLE_RE_SCAMPER_M * TRAMPLE_RE_SCAMPER_M;
        const underfoot = family.rabbits.some((r) => {
          const pdx = playerXZ.x - r.group.position.x;
          const pdz = playerXZ.z - r.group.position.z;
          return pdx * pdx + pdz * pdz < trampleSq;
        });
        if (underfoot) {
          assignThreatDodgeTargets(family.rabbits, playerXZ, 2.55);
          for (const r of family.rabbits) {
            r.phase = PHASE_SPIRIT_DODGE;
            r.phaseT = 0;
          }
        } else {
          let allWatching = true;
          for (const r of family.rabbits) {
            if (r.phase !== PHASE_SPIRIT_WATCH) {
              allWatching = false;
              break;
            }
          }
          if (allWatching && threatsClearForRelease(family, playerXZ, spiritXZ, bloomXZ, bloomRadius, alarmXZ)) {
            family.mode = FAMILY_MODE_SHOWING;
            for (const r of family.rabbits) {
              r.phase = PHASE_RETURNING;
              r.phaseT = 0;
              r.riseDelay = 0;
            }
          }
        }
      }

      if (family.mode === FAMILY_MODE_HIDING) {
        let allHidden = true;
        for (const r of family.rabbits) {
          if (r.phase !== PHASE_HIDDEN) { allHidden = false; break; }
        }
        if (allHidden) family.mode = FAMILY_MODE_HIDDEN;
      }

      if (
        family.mode === FAMILY_MODE_HIDDEN &&
        familyDist >= PLAYER_BURROW_RELEASE_M
      ) {
        family.mode = FAMILY_MODE_SHOWING;
        for (const r of family.rabbits) {
          r.phase = PHASE_RISE_WAIT;
          r.phaseT = 0;
          r.riseDelay = r.slot * EMERGE_STAGGER_S;
        }
      }

      if (family.mode === FAMILY_MODE_SHOWING) {
        let allRoaming = true;
        for (const r of family.rabbits) {
          if (r.phase !== PHASE_ROAM) { allRoaming = false; break; }
        }
        if (allRoaming) family.mode = FAMILY_MODE_NORMAL;
      }
    }

    /** Coordinated baby binkies when mom is settled — reads as litter play. */
    for (const family of this._families) {
      if (family.mode !== FAMILY_MODE_NORMAL) continue;
      const mom = family.mom;
      if (!mom || mom.phase !== PHASE_ROAM || mom.speed > 0.075) continue;
      family._famPlayT = (family._famPlayT ?? 3) - dt;
      if (family._famPlayT > 0) continue;
      family._famPlayT = 2.85 + Math.random() * 2.6;
      if (Math.random() > 0.36) continue;
      for (const br of family.rabbits) {
        if (br.role !== "baby" || br.phase !== PHASE_ROAM) continue;
        if ((br.airY ?? 0) > 0.025 || (br.jumpCd ?? 0) > 0.08) continue;
        br.vy = Math.sqrt(2 * G * (0.05 + Math.random() * 0.065));
        br.jumpCd = 0.48 + Math.random() * 0.55;
      }
    }

    // === Per-rabbit phase dispatch ======================================
    // ROAM falls back to the existing updateMom/updateBaby paths; every
    // other phase has a dedicated helper that owns Y / yaw / animation
    // cadence for the duration of that phase.
    for (const r of this._rabbits) {
      switch (r.phase) {
        case PHASE_ROAM:
          if (r.role === "mom") {
            updateMom(r, dt, this._physics, cam, playerXZ);
          } else {
            updateBaby(r, dt, this._physics, r.family.mom, cam, playerXZ);
          }
          break;
        case PHASE_WALK_TO_HOLE:
          updateRabbitDive(r, dt, this._physics);
          break;
        case PHASE_DESCENDING:
          updateRabbitDescend(r, dt, this._physics);
          break;
        case PHASE_HIDDEN:
          updateRabbitHidden(r, dt, playerXZ);
          break;
        case PHASE_RISE_WAIT:
          updateRabbitRiseWait(r, dt);
          break;
        case PHASE_RISING:
          updateRabbitRise(r, dt, this._physics);
          break;
        case PHASE_RETURNING:
          updateRabbitReturn(r, dt, this._physics);
          break;
        case PHASE_SPIRIT_DODGE:
          updateRabbitSpiritDodge(r, dt, this._physics);
          break;
        case PHASE_SPIRIT_WATCH:
          updateRabbitSpiritWatch(r, dt, this._physics, playerXZ);
          break;
        default:
          // Unknown phase — fail safe to ROAM so a future bad transition
          // can't strand a rabbit forever.
          r.phase = PHASE_ROAM;
          r.phaseT = 0;
      }
    }
  },

  getFaunaSnapshot() {
    return Object.freeze({
      schemaVersion: "3.3",
      hideTriggerM: PLAYER_BURROW_ENTER_M,
      releaseTriggerM: PLAYER_BURROW_RELEASE_M,
      playerLookRadiusM: PLAYER_LOOK_RADIUS_M,
      threatEnterM: THREAT_ENTER_M,
      spiritDodgeTriggerM: SPIRIT_DODGE_TRIGGER_M,
      spiritFarM: SPIRIT_FAR_M,
      warrenHub: Object.freeze({
        x: V2_RABBIT_WARREN_HUB_X_M,
        z: V2_RABBIT_WARREN_HUB_Z_M,
        chasmRadiusM: V2_RABBIT_WARREN_CHASM_RADIUS_M,
        depthM: V2_RABBIT_WARREN_CHASM_DEPTH_M,
      }),
      families: Object.freeze(
        this._families.map((family) =>
          Object.freeze({
            key: family.key,
            label: family.label,
            mode: family.mode,
            burrow: Object.freeze({
              x: family.burrowX,
              z: family.burrowZ,
              throatRadiusM: BURROW_THROAT_RAD,
              depthM: BURROW_DEPTH_M,
            }),
            rabbitIds: Object.freeze(family.rabbits.map((r) => r.id)),
          }),
        ),
      ),
      rabbits: Object.freeze(
        this._rabbits.map((r) =>
          Object.freeze({
            id: r.id,
            familyKey: r.family.key,
            role: r.role,
            phase: r.phase,
            slot: r.slot,
            position: Object.freeze({
              x: r.group.position.x,
              y: r.group.position.y,
              z: r.group.position.z,
            }),
          }),
        ),
      ),
    });
  },
};
