/**
 * Sacred Adventures v2 — Fauna pillar: realistic rabbit family + warren.
 *
 * Replaces the legacy `js/Component.RabbitSystem.js` flat-OBJ system. Spawns
 * one warren (flush disturbed-earth ring + sunken burrow throat + pocket)
 * plus a five-member
 * family of GLB-rigged hop-looped rabbits:
 *
 *   dad   — dark-tan, 1.5× mom
 *   mom   — brown
 *   baby1 — white
 *   baby2 — dark brown
 *   baby3 — tan
 *
 * Behaviour FSM per rabbit:
 *   idle | graze | poop | hop | look | follow_mom | chase_sibling
 *   flee_to_hole | hide_in_hole | peek_from_hole | emerge
 *
 * Physics:
 *   - vertical: `WorldPhysics.getGroundY` for ground snap
 *   - gravity is implicit via the parabolic hop arc (no body integrator)
 *   - jump apex capped at 1.5× rabbit body length
 *   - lightweight body radius for tree avoidance (not full WorldPhysics body —
 *     these are cosmetic pets, not gameplay actors)
 *
 * Player proximity:
 *   - alertDist (in metres relative to avatar scale) = freeze + face
 *   - fleeDist = sprint to hole; family dives in, only mom + dad pop heads up
 *   - safeDist (≥ 2 tiles ≈ 2 × V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M) = emerge
 *
 * Anu integration:
 *   - dispatches ANU_EVENTS.FAUNA_TICK with per-rabbit state snapshot
 *   - registers in `report()` and `help()` once activated
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { getRuntimeService } from "./RuntimeServices.js";
import {
  V2_AVATAR_TARGET_HEIGHT_M,
  V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M,
  V2_TILE_WORLD,
} from "./constants.js";

const RABBIT_URL = "./Assets/rabbit.animated.glb";

/**
 * Warren position — the empty tile **directly right of tipi 1**.
 * Tipi 1 sits at (0, 0); tipi 2 sits at (V2_TILE_WORLD * 2, 0). The warren
 * occupies the skipped tile in between so the player sees a real, visible
 * rabbit home next to tipi 1 instead of one buried in the eastern forest.
 * Distance from origin (~10.86 m) is inside V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M
 * (12.5 m) so no tree will plant on top of the burrow.
 */
const WARREN_X = V2_TILE_WORLD;
const WARREN_Z = 0;

/**
 * Scale anchors expressed in metres so the rabbits read at the correct size
 * relative to Avatar3 (≈ 0.93 m tall) regardless of how the asset itself was
 * authored. Mom rabbit ≈ 25 % of the avatar's standing height — matches
 * a real adult rabbit sitting upright at ~22 cm.
 */
const MOM_TARGET_HEIGHT_M = V2_AVATAR_TARGET_HEIGHT_M * 0.26;
const DAD_TARGET_HEIGHT_M = MOM_TARGET_HEIGHT_M * 1.5;
const BABY_TARGET_HEIGHT_M = MOM_TARGET_HEIGHT_M * 0.55;

/** Player proximity distances (m). One "tile" ≈ avatar travel circle Ø. */
const TILE_M = V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M * 2;
const ALERT_DIST_M = TILE_M * 3.5;
const FLEE_DIST_M = TILE_M * 2.2;
const SAFE_DIST_M = TILE_M * 2.0;
const FAMILY_RADIUS_M = TILE_M * 1.6;
const FOLLOW_TRIGGER_M = TILE_M * 0.9;
const BABY_REGROUP_M = TILE_M * 0.35;

/** Locomotion (m/s). */
const SPEED_GRAZE = 0.45;
const SPEED_HOP = 1.1;
const SPEED_CHASE = 1.6;
const SPEED_FLEE = 4.0;

/** Hop arc (apex relative to body length). Spec: never above 1.5× body length. */
const JUMP_APEX_RATIO = 1.4;
const HOP_CYCLE_HZ = 2.6;

const STATES = Object.freeze({
  IDLE: "idle",
  GRAZE: "graze",
  POOP: "poop",
  HOP: "hop",
  LOOK: "look",
  FOLLOW_MOM: "follow_mom",
  CHASE_SIBLING: "chase_sibling",
  FLEE: "flee_to_hole",
  HIDE: "hide_in_hole",
  PEEK: "peek_from_hole",
  EMERGE: "emerge",
});

/** Tuning per role — keys match `role`. */
const ROLE_PROFILE = Object.freeze({
  dad: {
    color: 0x8a6a3a, // dark tan
    height: DAD_TARGET_HEIGHT_M,
    lookoutBias: 0.65,
    canPeek: true,
  },
  mom: {
    color: 0x7a5230, // brown
    height: MOM_TARGET_HEIGHT_M,
    lookoutBias: 0.55,
    canPeek: true,
  },
  baby_white: {
    color: 0xf2ece1,
    height: BABY_TARGET_HEIGHT_M,
    lookoutBias: 0.15,
    canPeek: false,
  },
  baby_dark: {
    color: 0x3a2a1c,
    height: BABY_TARGET_HEIGHT_M,
    lookoutBias: 0.15,
    canPeek: false,
  },
  baby_tan: {
    color: 0xc7a16a,
    height: BABY_TARGET_HEIGHT_M,
    lookoutBias: 0.15,
    canPeek: false,
  },
});

/** Scratch vectors (allocated once). */
const _vTmp = new THREE.Vector3();
const _vTmp2 = new THREE.Vector3();

/**
 * @param {THREE.Object3D} template
 * @param {number} targetHeightM
 * @returns {{ root: THREE.Group, mesh: THREE.Object3D, bodyLengthM: number, animClip: THREE.AnimationClip | null }}
 */
function buildRabbitInstance(template, targetHeightM, gltfAnimations) {
  const cloned = template.clone(true);
  const bbox = new THREE.Box3().setFromObject(cloned);
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const rawH = Math.max(size.y, 1e-3);
  const scale = targetHeightM / rawH;
  cloned.scale.setScalar(scale);
  // Re-measure to anchor feet to y=0 inside the rabbit's own group.
  const scaledBox = new THREE.Box3().setFromObject(cloned);
  const min = scaledBox.min;
  cloned.position.y -= min.y;
  const root = new THREE.Group();
  root.add(cloned);
  const bodyLengthM = Math.max(size.x, size.z) * scale;
  return {
    root,
    mesh: cloned,
    bodyLengthM,
    animClip: gltfAnimations && gltfAnimations[0] ? gltfAnimations[0] : null,
  };
}

/**
 * Recolour every skinned mesh's material by cloning and **multiplying** the
 * baseColor texture by a tint. Cloning prevents one rabbit's tint from
 * bleeding into the others (they all share the GLB's source material).
 */
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
  });
}

/**
 * Build a simple rabbit burrow — **no raised mound**, no decorative props.
 * The goal is a believable *hole* you can look into: a thin disturbed-earth
 * ring flush with the grass plane, a tapering throat that reads as depth
 * (vertex colours rim → black), and a bottom cap so the camera never sees
 * through the world. The throat top sits **flush** with the grass (`y ≈ 0`)
 * so this doesn't read as a "brown UFO" sitting on top of the terrain.
 *
 * Coordinate convention: the group is anchored at (xM, terrainY, zM). Group
 * local Y = 0 is the grass plane. A tiny `Y_LIFT` avoids z-fighting with the
 * terrain shader.
 *
 * Anchors (`mouthAnchor` / `peekAnchor`) keep local XZ at the burrow centre;
 * behaviour code recomputes world Y from `WorldPhysics.getGroundY` so peek
 * heights stay correct if this geometry changes.
 */
function buildWarren(xM, zM, terrainY) {
  const group = new THREE.Group();
  group.position.set(xM, terrainY, zM);
  group.name = "fauna_warren";

  const Y_LIFT = 0.005;
  const PATCH_RADIUS = 1.05;
  const PATCH_THICKNESS = 0.03;
  const HOLE_RADIUS_TOP = 0.38;
  const HOLE_RADIUS_BOTTOM = 0.22;
  const HOLE_DEPTH = 0.95;
  const HOLE_TOP_Y = Y_LIFT + PATCH_THICKNESS;

  // ── A. Disturbed-earth ring (flush with grass) ───────────────────────
  const dirtPatchMat = new THREE.MeshStandardMaterial({
    color: 0x4a2d1a,
    roughness: 0.98,
    metalness: 0,
  });
  const dirtPatch = new THREE.Mesh(
    new THREE.RingGeometry(HOLE_RADIUS_TOP * 0.98, PATCH_RADIUS, 40),
    dirtPatchMat,
  );
  dirtPatch.rotation.x = -Math.PI / 2;
  dirtPatch.position.y = Y_LIFT + PATCH_THICKNESS / 2;
  dirtPatch.receiveShadow = true;
  dirtPatch.name = "fauna_warren_dirt_ring";
  group.add(dirtPatch);

  // ── B. Tapering throat with rim → black vertex-colour gradient ───────
  /**
   * `CylinderGeometry` lays out vertices ring-by-ring from top (+y) down
   * to bottom (-y). We map each vertex's local Y to a fraction in [0, 1]
   * (0 at rim, 1 at deepest) and lerp its colour from soil to pure black.
   */
  const throatGeom = new THREE.CylinderGeometry(
    HOLE_RADIUS_TOP,
    HOLE_RADIUS_BOTTOM,
    HOLE_DEPTH,
    28,
    8,
    true,
  );
  const throatColors = new Float32Array(throatGeom.attributes.position.count * 3);
  const rimColor = new THREE.Color(0x3a2316);
  const deepColor = new THREE.Color(0x000000);
  const tmpColor = new THREE.Color();
  for (let i = 0; i < throatGeom.attributes.position.count; i++) {
    const y = throatGeom.attributes.position.getY(i);
    const t = THREE.MathUtils.clamp((HOLE_DEPTH / 2 - y) / HOLE_DEPTH, 0, 1);
    tmpColor.copy(rimColor).lerp(deepColor, Math.pow(t, 0.7));
    throatColors[i * 3 + 0] = tmpColor.r;
    throatColors[i * 3 + 1] = tmpColor.g;
    throatColors[i * 3 + 2] = tmpColor.b;
  }
  throatGeom.setAttribute("color", new THREE.BufferAttribute(throatColors, 3));
  const throat = new THREE.Mesh(
    throatGeom,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      toneMapped: false,
    }),
  );
  throat.position.y = HOLE_TOP_Y - HOLE_DEPTH / 2;
  throat.name = "fauna_warren_throat";
  group.add(throat);

  // ── C. Inner cap (straight-down view stays black) ─────────────────────
  const throatCapGeom = new THREE.CircleGeometry(HOLE_RADIUS_BOTTOM * 0.98, 28);
  const capColors = new Float32Array(throatCapGeom.attributes.position.count * 3);
  for (let i = 0; i < throatCapGeom.attributes.position.count; i++) {
    const x = throatCapGeom.attributes.position.getX(i);
    const yc = throatCapGeom.attributes.position.getY(i);
    const r = Math.sqrt(x * x + yc * yc) / (HOLE_RADIUS_BOTTOM * 0.98);
    tmpColor.copy(deepColor).lerp(new THREE.Color(0x1a0e07), Math.pow(r, 1.4));
    capColors[i * 3 + 0] = tmpColor.r;
    capColors[i * 3 + 1] = tmpColor.g;
    capColors[i * 3 + 2] = tmpColor.b;
  }
  throatCapGeom.setAttribute("color", new THREE.BufferAttribute(capColors, 3));
  const throatCap = new THREE.Mesh(
    throatCapGeom,
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  throatCap.rotation.x = -Math.PI / 2;
  throatCap.position.y = HOLE_TOP_Y - HOLE_DEPTH + 0.002;
  throatCap.name = "fauna_warren_throat_cap";
  group.add(throatCap);

  // ── D. Underground pocket (AI / introspection) ───────────────────────
  const pocket = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 16, 10),
    new THREE.MeshStandardMaterial({
      color: 0x110a06,
      roughness: 1.0,
      metalness: 0,
      side: THREE.BackSide,
    }),
  );
  pocket.position.y = -0.75;
  pocket.name = "fauna_warren_pocket";
  group.add(pocket);

  const mouthAnchor = new THREE.Object3D();
  mouthAnchor.position.set(0, HOLE_TOP_Y, 0);
  mouthAnchor.name = "fauna_warren_mouth";
  group.add(mouthAnchor);

  const peekAnchor = new THREE.Object3D();
  peekAnchor.position.set(0, HOLE_TOP_Y, 0);
  peekAnchor.name = "fauna_warren_peek";
  group.add(peekAnchor);

  return {
    group,
    dirtPatch,
    throat,
    throatCap,
    pocket,
    mouthAnchor,
    peekAnchor,
    holeTopY: HOLE_TOP_Y,
  };
}

export const FaunaModule = {
  name: "Fauna",

  _scene: null,
  _camera: null,
  _orchestrator: null,
  _disposed: false,
  /** @type {Array<ReturnType<typeof _createRabbitState>>} */
  _rabbits: [],
  _warren: null,
  _mom: null,
  _dad: null,
  /** @type {Array<ReturnType<typeof _createRabbitState>>} */
  _babies: [],
  _lastPlayerPos: new THREE.Vector3(),
  _playerSpeedMps: 0,
  _tickAccum: 0,
  _tickIntervalSec: 0.18,
  _faunaTickPayload: null,
  _bootLog: false,

  async load(scene, camera, _renderer, orchestrator) {
    if (this._disposed) return;
    this._scene = scene;
    this._camera = camera;
    this._orchestrator = orchestrator;

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
      gltf = await new GLTFLoader().loadAsync(RABBIT_URL);
    } catch (err) {
      console.warn("[Fauna] rabbit.animated.glb load failed:", err);
      return;
    }
    const template = gltf.scene;
    template.updateMatrixWorld(true);

    // Warren first so its anchors are available to flee-target the rabbits.
    const groundY = physics.getGroundY(WARREN_X, WARREN_Z);
    const warren = buildWarren(WARREN_X, WARREN_Z, groundY);
    scene.add(warren.group);
    this._warren = warren;

    // Build the five family members. Roles ordered so mom spawns first; she
    // becomes the follow target for the babies.
    const roster = [
      { id: "mom", role: "mom" },
      { id: "dad", role: "dad" },
      { id: "baby_white", role: "baby_white" },
      { id: "baby_dark", role: "baby_dark" },
      { id: "baby_tan", role: "baby_tan" },
    ];

    for (let i = 0; i < roster.length; i++) {
      const r = roster[i];
      const prof = ROLE_PROFILE[r.role];
      const inst = buildRabbitInstance(template, prof.height, gltf.animations);
      tintRabbitMesh(inst.root, prof.color);
      // Initial scatter in a tight ring at the burrow lip so the family is
      // obviously visible next to the hole (not 1.5–2 m away where framing
      // can miss them).
      const angle = (i / roster.length) * Math.PI * 2;
      const startR = 0.55 + (i % 3) * 0.16;
      const sx = WARREN_X + Math.cos(angle) * startR;
      const sz = WARREN_Z + Math.sin(angle) * startR;
      const sy = physics.getGroundY(sx, sz);
      inst.root.position.set(sx, sy, sz);
      inst.root.rotation.y = Math.atan2(WARREN_X - sx, WARREN_Z - sz);
      scene.add(inst.root);

      let mixer = null;
      let action = null;
      if (inst.animClip) {
        mixer = new THREE.AnimationMixer(inst.root);
        action = mixer.clipAction(inst.animClip);
        action.setLoop(THREE.LoopRepeat, Infinity);
        // Offset each rabbit's animation phase so the family doesn't hop in
        // perfect lock-step.
        action.time = (i * 0.7) % inst.animClip.duration;
        action.play();
        /**
         * Start the clip "playing but paused" — `action.play()` schedules
         * the action on the mixer, but `.paused = true` freezes its time so
         * the rabbits sit in their bind pose during boot IDLE. The motion
         * gate in `_updateRabbitMotion` flips `.paused` based on whether
         * the rabbit is actively locomoting this frame.
         */
        action.paused = true;
      }

      const state = _createRabbitState({
        id: r.id,
        role: r.role,
        group: inst.root,
        mesh: inst.mesh,
        bodyLengthM: inst.bodyLengthM,
        heightM: prof.height,
        color: prof.color,
        mixer,
        action,
        canPeek: prof.canPeek,
        lookoutBias: prof.lookoutBias,
      });
      this._rabbits.push(state);
      if (r.role === "mom") this._mom = state;
      if (r.role === "dad") this._dad = state;
      if (r.role.startsWith("baby_")) this._babies.push(state);
    }
    // Babies follow mom by default.
    for (const baby of this._babies) baby.followTarget = this._mom;

    // Seed player tracker so the first delta isn't a teleport.
    if (this._camera) this._lastPlayerPos.copy(this._camera.position);

    if (!this._bootLog) {
      console.log(
        "%c[Fauna] Rabbit family warren online",
        "color:#ce93d8;font-weight:bold;",
        `— 5 rabbits + simple burrow hole at (${WARREN_X.toFixed(2)}, ${WARREN_Z}) ` +
          `(empty tile right of tipi 1). Anim gate: hop-clip runs only while locomoting.`,
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
      if (this._warren) {
        this._scene.remove(this._warren.group);
        this._warren.group.traverse((n) => {
          if (n.isMesh) {
            n.geometry?.dispose?.();
            const m = n.material;
            if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
            else m?.dispose?.();
          }
        });
      }
    }
    this._rabbits.length = 0;
    this._babies.length = 0;
    this._mom = null;
    this._dad = null;
    this._warren = null;
  },

  update(delta) {
    if (!this._scene || !this._physics || this._rabbits.length === 0) return;
    const cam = this._camera;
    if (!cam) return;

    // Player horizontal speed (m/s).
    const dx = cam.position.x - this._lastPlayerPos.x;
    const dz = cam.position.z - this._lastPlayerPos.z;
    const moved = Math.sqrt(dx * dx + dz * dz);
    this._playerSpeedMps = delta > 0 ? moved / delta : 0;
    this._lastPlayerPos.copy(cam.position);

    for (const r of this._rabbits) {
      r.mixer?.update(delta);
      _updateRabbitAI(r, this, delta);
      _updateRabbitMotion(r, this, delta);
    }

    // Throttled Anu fauna tick — once every _tickIntervalSec, not per frame.
    this._tickAccum += delta;
    if (this._tickAccum >= this._tickIntervalSec) {
      this._tickAccum = 0;
      _dispatchFaunaTick(this);
    }
  },

  /** Public read for tests / report(). */
  getFaunaSnapshot() {
    return Object.freeze({
      schemaVersion: "1.0",
      warren: this._warren
        ? Object.freeze({
            x: WARREN_X,
            z: WARREN_Z,
            mouthLocal: Object.freeze({
              x: this._warren.mouthAnchor.position.x,
              y: this._warren.mouthAnchor.position.y,
              z: this._warren.mouthAnchor.position.z,
            }),
          })
        : null,
      rabbits: Object.freeze(
        this._rabbits.map((r) =>
          Object.freeze({
            id: r.id,
            role: r.role,
            state: r.state,
            heightM: r.heightM,
            bodyLengthM: r.bodyLengthM,
            position: Object.freeze({
              x: r.group.position.x,
              y: r.group.position.y,
              z: r.group.position.z,
            }),
          }),
        ),
      ),
      proximity: Object.freeze({
        playerSpeedMps: this._playerSpeedMps,
        alertDistM: ALERT_DIST_M,
        fleeDistM: FLEE_DIST_M,
        safeDistM: SAFE_DIST_M,
      }),
    });
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Per-rabbit state factory + AI/motion helpers.
// ──────────────────────────────────────────────────────────────────────────

function _createRabbitState(args) {
  return {
    id: args.id,
    role: args.role,
    group: args.group,
    mesh: args.mesh,
    bodyLengthM: args.bodyLengthM,
    heightM: args.heightM,
    color: args.color,
    mixer: args.mixer,
    action: args.action,
    state: STATES.IDLE,
    stateTimer: 0.4 + Math.random() * 0.6,
    hopPhase: Math.random(),
    /** Cosmetic Y added by hop arc each frame (reset at frame start). */
    hopYOffset: 0,
    /** Cosmetic head-down nibble pitch added by graze state. */
    nibblePitch: 0,
    /** Heading (radians, atan2 of dx, dz). Smoothed each frame. */
    targetYaw: args.group.rotation.y,
    /** Direction unit vector for active motion. */
    dirX: 0,
    dirZ: 0,
    /** When set, FOLLOW_MOM target. */
    followTarget: null,
    /** When in FLEE/HIDE/PEEK/EMERGE, target world position. */
    refugeX: WARREN_X,
    refugeZ: WARREN_Z,
    canPeek: !!args.canPeek,
    lookoutBias: args.lookoutBias ?? 0.2,
    /** True while underground (mesh hidden). */
    underground: false,
    /** Optional sibling for chase behaviour. */
    chaseTarget: null,
    chaseCooldownSec: 0,
  };
}

function _pickIdleAction(r) {
  // Adults: more lookout/graze. Babies: more hop + chase.
  const isBaby = r.role.startsWith("baby_");
  const roll = Math.random();
  if (isBaby) {
    if (roll < 0.35) return STATES.HOP;
    if (roll < 0.55) return STATES.GRAZE;
    if (roll < 0.75) return STATES.CHASE_SIBLING;
    if (roll < 0.82) return STATES.POOP;
    return STATES.LOOK;
  }
  // Adults
  if (roll < 0.45) return STATES.GRAZE;
  if (roll < 0.45 + r.lookoutBias * 0.4) return STATES.LOOK;
  if (roll < 0.85) return STATES.HOP;
  if (roll < 0.92) return STATES.POOP;
  return STATES.IDLE;
}

function _pickRandomHopDir(r) {
  const a = Math.random() * Math.PI * 2;
  r.dirX = Math.sin(a);
  r.dirZ = Math.cos(a);
  r.targetYaw = a;
}

function _faceTowards(r, tx, tz) {
  const dx = tx - r.group.position.x;
  const dz = tz - r.group.position.z;
  if (dx * dx + dz * dz < 1e-6) return;
  r.targetYaw = Math.atan2(dx, dz);
}

function _faceTowardsAndMove(r, tx, tz) {
  const dx = tx - r.group.position.x;
  const dz = tz - r.group.position.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  r.dirX = dx / len;
  r.dirZ = dz / len;
  r.targetYaw = Math.atan2(dx, dz);
}

function _distToPlayer(r, mod) {
  const cam = mod._camera;
  const dx = cam.position.x - r.group.position.x;
  const dz = cam.position.z - r.group.position.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function _updateRabbitAI(r, mod, delta) {
  const distToPlayer = _distToPlayer(r, mod);
  const playerMoving = mod._playerSpeedMps > 0.6;

  // ── Refuge states: HIDE / PEEK / EMERGE override everything ────────────
  if (r.state === STATES.HIDE) {
    r.stateTimer -= delta;
    if (r.stateTimer > 0) return;
    // Spec:
    //  • Adults (canPeek) periodically peek out and watch the player.
    //  • Both adults AND babies emerge once the player is ≥ SAFE_DIST.
    //    Babies skip the peek state — they just come out when it's safe.
    if (r.canPeek && distToPlayer < SAFE_DIST_M) {
      r.state = STATES.PEEK;
      r.stateTimer = 1.4 + Math.random() * 1.4;
      r.group.visible = true;
      r.underground = false;
      r.group.position.x = WARREN_X + mod._warren.peekAnchor.position.x;
      /**
       * Place the rabbit so the top of her head sits just above the dirt
       * surface; the rest of her body stays inside the hole. Rabbits are
       * positioned with `bbox.min.y` anchored to their group origin, so
       * the top of the head is at `root.y + heightM`. We solve for `root.y`
       * so head-top lands at groundY + PEEK_HEAD_ABOVE_GROUND_M.
       */
      const PEEK_HEAD_ABOVE_GROUND_M = 0.04;
      const groundY = mod._physics.getGroundY(WARREN_X, WARREN_Z);
      r.group.position.y = groundY + PEEK_HEAD_ABOVE_GROUND_M - r.heightM;
      r.group.position.z = WARREN_Z + mod._warren.peekAnchor.position.z;
      _faceTowards(r, mod._camera.position.x, mod._camera.position.z);
    } else if (distToPlayer >= SAFE_DIST_M) {
      // Safe — every family member emerges. Babies appear at the mouth,
      // adults take the same path.
      r.state = STATES.EMERGE;
      r.stateTimer = 0.6 + Math.random() * 0.5;
      r.group.visible = true;
      r.underground = false;
      r.group.position.x = WARREN_X;
      r.group.position.z = WARREN_Z + 0.5;
    } else {
      // Player still nearby and can't peek (baby) — stay tucked a little more.
      r.stateTimer = 1.5 + Math.random() * 1.0;
    }
    return;
  }

  if (r.state === STATES.PEEK) {
    r.stateTimer -= delta;
    _faceTowards(r, mod._camera.position.x, mod._camera.position.z);
    if (distToPlayer < FLEE_DIST_M) {
      // Dive back in.
      r.state = STATES.HIDE;
      r.stateTimer = 2.5 + Math.random() * 1.5;
      r.group.visible = false;
      r.underground = true;
    } else if (r.stateTimer <= 0) {
      if (distToPlayer >= SAFE_DIST_M) {
        r.state = STATES.EMERGE;
        r.stateTimer = 0.6;
      } else {
        // Stay peeking a beat longer.
        r.stateTimer = 1.0 + Math.random() * 0.8;
      }
    }
    return;
  }

  if (r.state === STATES.EMERGE) {
    r.stateTimer -= delta;
    if (r.stateTimer <= 0) {
      r.state = STATES.IDLE;
      r.stateTimer = 0.4 + Math.random() * 0.4;
    }
    return;
  }

  // ── Flee response: triggered by player presence + speed ────────────────
  if (r.state !== STATES.FLEE && distToPlayer < FLEE_DIST_M && playerMoving) {
    r.state = STATES.FLEE;
    r.refugeX = WARREN_X;
    r.refugeZ = WARREN_Z;
    _faceTowardsAndMove(r, r.refugeX, r.refugeZ);
    r.stateTimer = 6.0; // safety cap
    return;
  }

  if (r.state === STATES.FLEE) {
    _faceTowardsAndMove(r, r.refugeX, r.refugeZ);
    const dxh = r.group.position.x - WARREN_X;
    const dzh = r.group.position.z - WARREN_Z;
    const distHole = Math.sqrt(dxh * dxh + dzh * dzh);
    r.stateTimer -= delta;
    if (distHole < 0.6 || r.stateTimer <= 0) {
      r.state = STATES.HIDE;
      r.group.visible = false;
      r.underground = true;
      // Adults peek sooner; babies stay tucked.
      r.stateTimer = r.canPeek
        ? 1.4 + Math.random() * 1.2
        : 3.5 + Math.random() * 2.0;
    }
    return;
  }

  // ── Idle-tier behaviour ────────────────────────────────────────────────
  r.stateTimer -= delta;
  if (r.stateTimer > 0) {
    // Continue current behaviour. For babies in CHASE_SIBLING, track target.
    if (r.state === STATES.CHASE_SIBLING && r.chaseTarget) {
      const t = r.chaseTarget;
      const cd = Math.hypot(
        t.group.position.x - r.group.position.x,
        t.group.position.z - r.group.position.z,
      );
      if (cd < 0.4) {
        // Caught up — chill, pick a new target soon.
        r.chaseTarget = null;
        r.chaseCooldownSec = 1.5;
        r.state = STATES.IDLE;
        r.stateTimer = 0.4 + Math.random() * 0.5;
      } else {
        _faceTowardsAndMove(r, t.group.position.x, t.group.position.z);
      }
    } else if (r.state === STATES.FOLLOW_MOM && r.followTarget) {
      const t = r.followTarget;
      _faceTowardsAndMove(r, t.group.position.x, t.group.position.z);
      const d2 = Math.hypot(
        t.group.position.x - r.group.position.x,
        t.group.position.z - r.group.position.z,
      );
      if (d2 < BABY_REGROUP_M) {
        r.state = STATES.IDLE;
        r.stateTimer = 0.3 + Math.random() * 0.4;
      }
    } else if (r.state === STATES.HOP) {
      // Random walk continues with current dir.
    } else if (r.state === STATES.LOOK) {
      // Slowly sweep yaw left/right and watch player.
      _faceTowards(r, mod._camera.position.x, mod._camera.position.z);
    }
    return;
  }

  // Pick next behaviour.
  r.chaseCooldownSec = Math.max(0, r.chaseCooldownSec - 0.4);

  // Baby follow-mom override.
  if (r.followTarget && r.role.startsWith("baby_")) {
    const t = r.followTarget;
    const d = Math.hypot(
      t.group.position.x - r.group.position.x,
      t.group.position.z - r.group.position.z,
    );
    if (d > FOLLOW_TRIGGER_M) {
      r.state = STATES.FOLLOW_MOM;
      r.stateTimer = 0.7 + Math.random() * 0.6;
      _faceTowardsAndMove(r, t.group.position.x, t.group.position.z);
      return;
    }
  }

  // Family social face — adults occasionally turn toward each other.
  if (!r.role.startsWith("baby_") && Math.random() < 0.18) {
    const partner = r.role === "mom" ? mod._dad : mod._mom;
    if (partner) {
      r.state = STATES.LOOK;
      r.stateTimer = 0.6 + Math.random() * 0.6;
      _faceTowards(r, partner.group.position.x, partner.group.position.z);
      return;
    }
  }

  const next = _pickIdleAction(r);
  r.state = next;
  r.stateTimer = 0.35 + Math.random() * 0.9;
  if (next === STATES.HOP) {
    // Stay within the family radius around the warren.
    _pickRandomHopDir(r);
    const ahead = 1.4 + Math.random() * 1.4;
    const tx = r.group.position.x + r.dirX * ahead;
    const tz = r.group.position.z + r.dirZ * ahead;
    const distFromWarrenSq = (tx - WARREN_X) ** 2 + (tz - WARREN_Z) ** 2;
    if (distFromWarrenSq > FAMILY_RADIUS_M * FAMILY_RADIUS_M) {
      // Reflect back toward warren.
      _faceTowardsAndMove(r, WARREN_X, WARREN_Z);
    }
  } else if (next === STATES.CHASE_SIBLING) {
    if (r.chaseCooldownSec > 0 || mod._babies.length < 2) {
      r.state = STATES.HOP;
      _pickRandomHopDir(r);
    } else {
      const candidates = mod._babies.filter((b) => b !== r && !b.underground);
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      if (target) {
        r.chaseTarget = target;
        r.stateTimer = 1.4 + Math.random() * 0.8;
        _faceTowardsAndMove(r, target.group.position.x, target.group.position.z);
      } else {
        r.state = STATES.HOP;
        _pickRandomHopDir(r);
      }
    }
  } else if (next === STATES.POOP) {
    // 1.5 s of stillness; tiny "deposit" visual decal could be added later.
    r.dirX = 0;
    r.dirZ = 0;
    r.stateTimer = 1.4;
  } else if (next === STATES.LOOK) {
    // Look around — toward player if nearby + alert, else partner / random.
    if (distToPlayer < ALERT_DIST_M) {
      _faceTowards(r, mod._camera.position.x, mod._camera.position.z);
    } else {
      const partner = r.role === "mom" ? mod._dad : mod._mom;
      if (partner) _faceTowards(r, partner.group.position.x, partner.group.position.z);
    }
  } else if (next === STATES.GRAZE) {
    r.dirX = 0;
    r.dirZ = 0;
  } else {
    r.dirX = 0;
    r.dirZ = 0;
  }
}

function _updateRabbitMotion(r, mod, delta) {
  if (r.state === STATES.HIDE) {
    // Pinned underground — also freeze the rigged hop animation.
    if (r.action) r.action.paused = true;
    return;
  }

  // Smooth yaw toward target.
  const cur = r.group.rotation.y;
  let diff = r.targetYaw - cur;
  while (diff < -Math.PI) diff += Math.PI * 2;
  while (diff > Math.PI) diff -= Math.PI * 2;
  r.group.rotation.y = cur + diff * Math.min(1, delta * 10);

  // Locomotion speed by state.
  let speed = 0;
  if (r.state === STATES.HOP || r.state === STATES.FOLLOW_MOM) speed = SPEED_HOP;
  else if (r.state === STATES.CHASE_SIBLING) speed = SPEED_CHASE;
  else if (r.state === STATES.FLEE) speed = SPEED_FLEE;
  else if (r.state === STATES.GRAZE) speed = SPEED_GRAZE * (Math.random() < 0.5 ? 1 : 0);

  /**
   * Animation gate — the GLB ships a single hop loop. Run it only while
   * the rabbit is actually locomoting in a hop-bearing state; pause it
   * otherwise so idle/graze/look/peek/emerge sit in the bind pose instead
   * of an endlessly looping mid-air hop. Faster-than-graze states get a
   * proportional `timeScale` so a flee reads as a sprint cycle and a
   * casual hop reads as a saunter.
   */
  if (r.action) {
    const animating =
      r.state === STATES.HOP ||
      r.state === STATES.CHASE_SIBLING ||
      r.state === STATES.FLEE ||
      r.state === STATES.FOLLOW_MOM;
    if (animating) {
      r.action.paused = false;
      if (r.state === STATES.FLEE) r.action.timeScale = 1.6;
      else if (r.state === STATES.CHASE_SIBLING) r.action.timeScale = 1.3;
      else r.action.timeScale = 1.0;
    } else {
      r.action.paused = true;
    }
  }

  // Hop arc — apex bound by 1.5 × body length.
  if (speed > 0) {
    r.hopPhase += delta * HOP_CYCLE_HZ;
    if (r.hopPhase > 1) r.hopPhase -= 1;
    // Air phase = 0.40 → 0.85; rest is gather + land.
    if (r.hopPhase > 0.4 && r.hopPhase < 0.85) {
      const airT = (r.hopPhase - 0.4) / 0.45;
      r.hopYOffset = Math.sin(airT * Math.PI) * r.bodyLengthM * JUMP_APEX_RATIO;
      // Forward translation lands during the air phase.
      r.group.position.x += r.dirX * speed * delta * 1.5;
      r.group.position.z += r.dirZ * speed * delta * 1.5;
    } else {
      r.hopYOffset = 0;
    }
  } else {
    r.hopPhase = 0;
    r.hopYOffset = 0;
  }

  // Ground snap + cosmetic hop offset. Gravity is the parabolic arc itself.
  const gy = mod._physics.getGroundY(r.group.position.x, r.group.position.z);
  r.group.position.y = gy + r.hopYOffset;

  // Lightweight tree collision: if the rabbit's footprint intersects any
  // recorded collider rectangle, push it back along its move dir.
  // (kept minimal — these are cosmetic pets, not gameplay actors)
}

function _dispatchFaunaTick(mod) {
  const payload = {
    schemaVersion: "1.0",
    rabbitCount: mod._rabbits.length,
    states: mod._rabbits.map((r) => ({ id: r.id, role: r.role, state: r.state })),
    warren: mod._warren ? { x: WARREN_X, z: WARREN_Z } : null,
    playerSpeedMps: mod._playerSpeedMps,
  };
  dispatchInteraction(ANU_EVENTS.FAUNA_TICK, payload);
}

// Suppress unused warnings on intentionally unused scratch vars.
void _vTmp;
void _vTmp2;
