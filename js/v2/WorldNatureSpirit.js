/**
 * Sacred Adventures v2 — Nature-Spirit Stag controller.
 *
 * `Assets/animated.stag.glb` rendered as a 10-foot-tall ethereal hologram
 * (cyan-mint emissive glow, layered additive bloom pulse + **3D burst column**,
 * foot hologram circle) that visits NPC YB on a 5-minute cycle without entering tipi 1.
 * Visit pattern (May-11 2026 late correction):
 *
 *   WAIT_TO_APPEAR
 *       │ 30 s after boot
 *       ▼
 *   WALK_TO_STANDOFF  (spawn at forest NW → stop 0.5 tile south of YB,
 *       │              outside the tipi platform)
 *       │ arrive (<= ARRIVE_EPS_M)
 *       ▼
 *   FACE_YB           (stand still; whole body slowly turns to face YB —
 *       │              no head-bone mutation; **idle clip paused** after
 *       │              walk→idle crossfade so the stag is motionless)
 *       │ V2_NATURE_SPIRIT_WAIT_BEFORE_NOD_S elapsed
 *       ▼
 *   NOD               (idle remains **paused**; timing still drives YB
 *       │              greeting + bloom at ~25 %; no visible nod clip)
 *       │ timer
 *       ▼
 *   POST_NOD_HOLD     (stand idle while bloom finishes its long fade)
 *       │ timer
 *       ▼
 *   WALK_TO_FOREST    (body turns gracefully back to travel direction,
 *       │              walks east to forest fade-point, opacity → 0)
 *       │ arrived OR opacity ≈ 0
 *       ▼
 *   COOLDOWN          (hidden for 5 minutes)
 *       │ timer
 *       ▼
 *   WALK_TO_STANDOFF  (loop)
 *
 * Owned by `WorldModule` (not an orchestrator module). The instance is
 * passive when YB is missing, and YB's behaviour controller refuses the
 * greeting if she's mid-player-cycle — cycles stay independent.
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import { ANU_INTERACTION_VERB, ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import {
  V2_NATURE_SPIRIT_APPEAR_DELAY_MS,
  V2_NATURE_SPIRIT_BLOOM_FADE_S,
  V2_NATURE_SPIRIT_BLOOM_PEAK_RADIUS_M,
  V2_NATURE_SPIRIT_COOLDOWN_MS,
  V2_NATURE_SPIRIT_FEET_LIFT_M,
  V2_NATURE_SPIRIT_FOOT_CIRCLE_RADIUS_M,
  V2_NATURE_SPIRIT_HEIGHT_M,
  V2_NATURE_SPIRIT_HOLOGRAM_BASE_OPACITY,
  V2_NATURE_SPIRIT_HOLOGRAM_EMISSIVE_HEX,
  V2_NATURE_SPIRIT_NOD_S,
  V2_NATURE_SPIRIT_YB_STANDOFF_M,
  V2_NATURE_SPIRIT_WAIT_BEFORE_NOD_S,
  V2_TILE_WORLD,
} from "./constants.js";

const NATURE_SPIRIT_URL = "./Assets/animated.stag.glb";

const STATE = Object.freeze({
  WAIT_TO_APPEAR: "WAIT_TO_APPEAR",
  /**
   * Walk to a standoff point south of YB (`V2_NATURE_SPIRIT_YB_STANDOFF_M`).
   * This is 0.5 tile out from the seated YB so the stag never enters tipi 1.
   */
  WALK_TO_STANDOFF: "WALK_TO_STANDOFF",
  /** Standing on the standoff line; whole body slowly turns toward YB. */
  FACE_YB: "FACE_YB",
  NOD: "NOD",
  POST_NOD_HOLD: "POST_NOD_HOLD",
  WALK_TO_FOREST: "WALK_TO_FOREST",
  COOLDOWN: "COOLDOWN",
});

/** Forest spawn point — north-west tree-line, well outside the tipi clear zone. */
const SPAWN_X = -22;
const SPAWN_Z = -10;
/** Forest fade-out point — east tree-line, where the stag dissolves. */
const FOREST_FADE_X = 38;
const FOREST_FADE_Z = -8;

const ARRIVE_EPS_M = 0.35;
/** A touch slower for majesty (was 1.45). */
const WALK_SPEED_MPS = 1.2;
/** Smoother body turn-toward-target rate (rad/s — was 3.5). */
const TURN_RATE = 2.4;
const FADE_START_DISTANCE_M = 10.0;
/** Hold a beat longer so the bloom fade reads gracefully. */
const POST_NOD_HOLD_S = 1.6;
/** Graceful crossfade duration between locomotion clips. */
const CROSSFADE_S = 0.8;
/** Whole-body ceremonial turn rate while facing YB. */
const FACE_YB_TURN_RATE = 0.75;
/**
 * When the player is within this XZ radius of YB while the spirit is
 * still on stage (FACE_YB / NOD / POST_NOD_HOLD), the spirit defers to the
 * player: it aborts the visit straight to WALK_TO_FOREST and signals YB
 * to play her 1× player-greeting wave (see
 * `NPCBehaviour.notifyPlayerInterrupt`). 1 tile keeps the trigger inside
 * YB's own approach radius so the player has to actually walk up to her,
 * not just cross the meadow.
 */
const PLAYER_PRIORITY_RADIUS_M = V2_TILE_WORLD;
/**
 * Slowed idle timescale while the spirit is in front of YB. The user spec
 * calls for "idle animation, very slow movements" — 0.35× plays the GLB's
 * idle clip with a calm, ethereal cadence that reads as still / breathing
 * rather than the normal in-place fidget.
 */
const SPIRIT_IDLE_TIMESCALE = 0.35;

function findClip(clips, regex, fallbackIndex = 0) {
  return clips.find((clip) => regex.test(String(clip.name ?? ""))) ?? clips[fallbackIndex] ?? null;
}

/**
 * Clone every material on the stag so we can drive opacity + emissive
 * independently and dispose them in `dispose()`. Pushes the cloned materials
 * into `bucket` for later opacity ticking.
 */
function cloneHologramMaterials(asset, bucket) {
  asset.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    const sources = Array.isArray(child.material) ? child.material : [child.material];
    const cloned = sources.map((mat) => {
      if (!mat) return mat;
      const next = mat.clone();
      next.transparent = true;
      next.opacity = 0;
      next.depthWrite = false;
      next.depthTest = true;
      if (next.emissive?.setHex) {
        next.emissive.setHex(V2_NATURE_SPIRIT_HOLOGRAM_EMISSIVE_HEX);
        next.emissiveIntensity = 0.6;
      } else {
        next.emissive = new THREE.Color(V2_NATURE_SPIRIT_HOLOGRAM_EMISSIVE_HEX);
        next.emissiveIntensity = 0.6;
      }
      next.needsUpdate = true;
      bucket.push(next);
      return next;
    });
    child.material = Array.isArray(child.material) ? cloned : cloned[0];
  });
}

function disposeMaterials(materials) {
  for (const m of materials) m?.dispose?.();
  materials.length = 0;
}

/**
 * Build a **layered** additive bloom-pulse group (ground rings + **3D blast**):
 *  - `halo`: a wide soft-fill disc (fades linearly over the pulse)
 *  - `outerRing` / `innerRing`: expanding hologram-colour rings
 *  - `burst`: additive icosahedron shock-front (May-12 2026 user — vertical
 *    energy read, not only a flat decal)
 *  - `shaft`: tall open cylinder column in the same emissive hue
 *
 * Group hidden by default; `_triggerBloomAtYb()` parents the pulse at YB's
 * feet and resets `age = 0`.
 */
function buildBloomFlash() {
  const group = new THREE.Group();
  group.name = "fx_nature_spirit_bloom";
  group.visible = false;
  group.userData.anuId = "vfx.naturespirit.bloom";

  const mkAdditive = (alphaMult = 1) =>
    new THREE.MeshBasicMaterial({
      color: V2_NATURE_SPIRIT_HOLOGRAM_EMISSIVE_HEX,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      userData: { alphaMult },
    });

  /** Soft fill (halo) — wide flat disc, scaled large from a unit circle. */
  const halo = new THREE.Mesh(new THREE.CircleGeometry(0.5, 64), mkAdditive(0.55));
  halo.rotation.x = -Math.PI / 2;
  halo.name = "fx_nature_spirit_bloom_halo";

  /** Outer ring — wider edge band, builds fast. */
  const outerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.46, 0.5, 96),
    mkAdditive(0.95),
  );
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.name = "fx_nature_spirit_bloom_outer_ring";

  /** Inner ring — tighter, follows the outer with a delay. */
  const innerRing = new THREE.Mesh(
    new THREE.RingGeometry(0.48, 0.5, 96),
    mkAdditive(0.8),
  );
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.name = "fx_nature_spirit_bloom_inner_ring";

  const burst = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.42, 1),
    mkAdditive(1.05),
  );
  burst.name = "fx_nature_spirit_bloom_burst";

  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 1.35, 4.75, 30, 1, true),
    mkAdditive(0.84),
  );
  shaft.name = "fx_nature_spirit_bloom_shaft";
  shaft.position.y = 2.38;

  group.add(halo);
  group.add(outerRing);
  group.add(innerRing);
  group.add(burst);
  group.add(shaft);
  return { group, halo, outerRing, innerRing, burst, shaft, age: Infinity };
}

function buildFootCircle() {
  const group = new THREE.Group();
  group.name = "fx_nature_spirit_foot_circle";
  group.userData.anuId = "vfx.naturespirit.foot_circle";

  const mat = new THREE.MeshBasicMaterial({
    color: V2_NATURE_SPIRIT_HOLOGRAM_EMISSIVE_HEX,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(
      V2_NATURE_SPIRIT_FOOT_CIRCLE_RADIUS_M * 0.78,
      V2_NATURE_SPIRIT_FOOT_CIRCLE_RADIUS_M,
      96,
    ),
    mat,
  );
  ring.rotation.x = -Math.PI / 2;
  ring.name = "fx_nature_spirit_foot_circle_ring";

  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(V2_NATURE_SPIRIT_FOOT_CIRCLE_RADIUS_M * 0.72, 72),
    mat.clone(),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.material.opacity = 0.12;
  fill.name = "fx_nature_spirit_foot_circle_fill";

  group.add(fill);
  group.add(ring);
  return { group, ring, fill };
}

export function createWorldNatureSpiritController() {
  return {
    root: null,
    rig: null,
    asset: null,
    mixer: null,
    actions: null,
    state: STATE.WAIT_TO_APPEAR,
    _materials: [],
    _terrainY: null,
    _getYbPosition: null,
    _getPlayerPosition: null,
    _playYbSpiritGreeting: null,
    _notifyYbSpiritPos: null,
    _notifyYbPlayerInterrupt: null,
    _ybWaveTriggered: false,
    /**
     * Set true after the player-priority path has fired for THIS visit
     * (FACE_YB through WALK_TO_FOREST). Reset whenever the controller
     * crosses into a fresh WALK_TO_STANDOFF.
     */
    _playerInterruptHandled: false,
    _appearAtMs: 0,
    _cooldownUntilMs: Infinity,
    _stateUntilMs: Infinity,
    _opacity: 0,
    _opacityTarget: 0,
    _bloom: null,
    _footCircle: null,
    _bloomMaxAge: V2_NATURE_SPIRIT_BLOOM_FADE_S,
    _tmpTarget: new THREE.Vector3(),
    /** After walk→idle crossfade at YB, pause idle so the stag is frozen until walk-away. */
    _spiritIdleFreezeAtMs: 0,

    /**
     * @param {THREE.Scene} scene
     * @param {Array<THREE.Object3D>} objects
     * @param {{
     *   terrainY: (x:number, z:number) => number,
     *   getYbPosition: () => ({ x:number, z:number } | null),
     *   getPlayerPosition?: () => ({ x:number, z:number } | null),
     *   playYbSpiritGreeting: (x:number, z:number) => boolean,
     *   notifyYbSpiritPos?: (x:number, z:number) => void,
     *   notifyYbPlayerInterrupt?: (x:number, z:number) => boolean,
     * }} hooks
     */
    async load(scene, objects, hooks) {
      try {
        const {
          terrainY,
          getYbPosition,
          getPlayerPosition,
          playYbSpiritGreeting,
          notifyYbSpiritPos,
          notifyYbPlayerInterrupt,
        } = hooks;
        this._terrainY = terrainY;
        this._getYbPosition = getYbPosition;
        this._getPlayerPosition = getPlayerPosition ?? null;
        this._playYbSpiritGreeting = playYbSpiritGreeting;
        this._notifyYbSpiritPos = notifyYbSpiritPos ?? null;
        this._notifyYbPlayerInterrupt = notifyYbPlayerInterrupt ?? null;

        const gltf = await new GLTFLoaderWithDraco().loadAsync(NATURE_SPIRIT_URL);
        const asset = gltf.scene;

        // Measure raw size BEFORE applying any scale, then fit to the spec height.
        const rawBox = new THREE.Box3().setFromObject(asset);
        const rawSize = new THREE.Vector3();
        rawBox.getSize(rawSize);
        const rawH = Math.max(rawSize.y, 1e-3);
        const fitScale = V2_NATURE_SPIRIT_HEIGHT_M / rawH;

        cloneHologramMaterials(asset, this._materials);

        // Legacy rig forward axis (stag head along +X) → rotate -90° around Y.
        const rig = new THREE.Group();
        rig.rotation.y = -Math.PI / 2;
        rig.add(asset);

        const root = new THREE.Group();
        root.name = "population_nature_spirit_deer";
        root.scale.setScalar(fitScale);
        root.add(rig);

        /**
         * Lift the asset inside the rig so the stag's lowest **bone** lands
         * on the rig's local Y=0 (and therefore on terrainY when
         * root.position.y is set to terrainY).
         *
         * Why bone bbox, not mesh bbox (May-11 2026 evening, take 2 —
         * measured): forensic probe `scratch/probe-three-failures.mjs`
         * showed the animated bone bbox extends **2.4 m below** the mesh
         * bbox during WALK_TO_YB. The original lift used `rawBox.min.y`
         * (geometry bind-pose bbox), which left the foot bones — and the
         * animated lower body they drive — well below the ground.
         *
         * We pin to bone positions because (a) the GLB's lower bones are
         * the real foot anchors, (b) animation displacement around those
         * anchors is small relative to the bone reach itself, (c) it
         * survives walk-cycle vs idle-cycle differences without retuning.
         */
        root.updateMatrixWorld(true);
        const _bonePt = new THREE.Vector3();
        const boneBox = new THREE.Box3();
        asset.traverse((c) => {
          if (!c.isSkinnedMesh || !c.skeleton) return;
          for (const b of c.skeleton.bones) {
            b.updateMatrixWorld(true);
            _bonePt.setFromMatrixPosition(b.matrixWorld);
            boneBox.expandByPoint(_bonePt);
          }
        });
        /**
         * boneBox.min.y is in WORLD space; root.position.y is currently 0
         * and root.scale is `fitScale`. To move the lowest bone up to
         * world y = 0 we shift the asset (which sits in local space inside
         * the rig) by `-boneBox.min.y / fitScale` — undoing the world
         * scale to land the local offset right.
         */
        if (Number.isFinite(boneBox.min.y) && fitScale > 0) {
          asset.position.y -= boneBox.min.y / fitScale;
        } else {
          asset.position.y -= rawBox.min.y; // fallback to mesh bbox (legacy)
        }

        const spawnY = terrainY(SPAWN_X, SPAWN_Z) + V2_NATURE_SPIRIT_FEET_LIFT_M;
        root.position.set(SPAWN_X, spawnY, SPAWN_Z);
        root.visible = false;
        root.userData.anuId = "population.naturespirit.deer";
        root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
        root.userData.anuKind = "nature_spirit_deer_hologram";
        root.userData.anuInteractable = true;
        root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
        root.userData.anuLegacyReference =
          "js/EnvironmentBuilder.js NatureSpirit animated.stag.glb + js/MasterNPCAI.js STAG_* FSM";

        scene.add(root);
        objects.push(root);

        this._bloom = buildBloomFlash();
        scene.add(this._bloom.group);
        objects.push(this._bloom.group);

        this._footCircle = buildFootCircle();
        this._footCircle.group.visible = false;
        scene.add(this._footCircle.group);
        objects.push(this._footCircle.group);

        this.root = root;
        this.rig = rig;
        this.asset = asset;
        this._setupActions(gltf.animations);

        const now = typeof performance !== "undefined" ? performance.now() : 0;
        this._appearAtMs = now + V2_NATURE_SPIRIT_APPEAR_DELAY_MS;
        this.state = STATE.WAIT_TO_APPEAR;
        this._opacity = 0;
        this._opacityTarget = 0;

        if (typeof window !== "undefined") {
          window.natureSpiritSystem = this;
        }

        console.log(
          "%c[World] NatureSpirit stag staged — 10 ft hologram, 5-min cycle",
          "color:#80deea;font-weight:bold;",
        );
        return root;
      } catch (err) {
        console.warn("[World] NatureSpirit load failed:", err);
        return null;
      }
    },

    _setupActions(clips) {
      this.mixer = new THREE.AnimationMixer(this.asset);
      const walkClip = findClip(clips, /walk/i, 0);
      const idleClip = findClip(clips, /idle/i, walkClip ? clips.indexOf(walkClip) : 0);
      const nodClip = findClip(clips, /bow|nod|greet|eat|graze/i, idleClip ? clips.indexOf(idleClip) : 0);

      const walk = walkClip ? this.mixer.clipAction(walkClip) : null;
      const idle = idleClip ? this.mixer.clipAction(idleClip) : null;
      const nod = nodClip ? this.mixer.clipAction(nodClip) : idle;

      // Slow majestic motion. Per user spec (May 12 2026), the spirit must
      // read as "idle animation, very slow movements" while it's in front of
      // YB — we keep the idle clip running across FACE_YB / NOD / POST_NOD
      // and dial its timescale down for that calm cadence.
      walk?.setEffectiveTimeScale(0.4);
      nod?.setEffectiveTimeScale(0.5);
      idle?.setEffectiveTimeScale(SPIRIT_IDLE_TIMESCALE);
      idle?.play();

      this.actions = { walk, idle, nod };
    },

    _emitState() {
      dispatchInteraction(ANU_EVENTS.NPC_ENTITY, {
        phase: "nature-spirit-state",
        npcId: "population.naturespirit.deer",
        state: this.state,
        t: typeof performance !== "undefined" ? performance.now() : 0,
      });
    },

    _setState(state, nowMs) {
      if (this.state === state) return;
      this.state = state;
      this._emitState();

      if (state === STATE.WALK_TO_STANDOFF) {
        this.root.visible = true;
        const sx = SPAWN_X;
        const sz = SPAWN_Z;
        this.root.position.set(sx, this._spiritY(sx, sz), sz);
        this._syncFootCircle(nowMs);
        this._opacityTarget = V2_NATURE_SPIRIT_HOLOGRAM_BASE_OPACITY;
        this._ybWaveTriggered = false;
        this._playerInterruptHandled = false;
        this.actions?.idle && (this.actions.idle.paused = false);
        this.actions?.walk && (this.actions.walk.paused = false);
        this.actions?.idle?.crossFadeTo(this.actions.walk, CROSSFADE_S, false);
        this.actions?.walk?.reset().play();
      } else if (state === STATE.FACE_YB) {
        this._stateUntilMs = nowMs + V2_NATURE_SPIRIT_WAIT_BEFORE_NOD_S * 1000;
        this._spiritIdleFreezeAtMs = nowMs + CROSSFADE_S * 1000 + 40;
        this.actions?.walk?.crossFadeTo(this.actions.idle, CROSSFADE_S, false);
        this.actions?.idle?.reset().play();
        if (this.actions?.idle) this.actions.idle.paused = false;
      } else if (state === STATE.NOD) {
        /**
         * The NOD state retains its name + timing (the YB-greeting trigger
         * still fires at ~25 % through this window via _playYbSpiritGreeting
         * + _triggerBloomAtYb), but the spirit visually stays in its slow
         * idle clip — per the May-12 2026 user spec: "nature spirit model
         * must idle animation, very slow movements" while in front of YB.
         * No crossfade to the nod clip; the idle action keeps running from
         * FACE_YB straight through POST_NOD_HOLD.
         *
         * May-12 2026 refresh: idle is **paused** (frozen pose) for the whole
         * YB visit until `WALK_TO_FOREST` resumes locomotion.
         */
        this.actions?.walk?.stop?.();
        if (this.actions?.idle) this.actions.idle.paused = true;
        this._stateUntilMs = nowMs + V2_NATURE_SPIRIT_NOD_S * 1000;
      } else if (state === STATE.POST_NOD_HOLD) {
        this._stateUntilMs = nowMs + POST_NOD_HOLD_S * 1000;
        this.actions?.walk?.stop?.();
        if (this.actions?.idle) this.actions.idle.paused = true;
        // Idle already playing; no clip swap needed.
      } else if (state === STATE.WALK_TO_FOREST) {
        if (this.actions?.idle) this.actions.idle.paused = false;
        if (this.actions?.walk) this.actions.walk.paused = false;
        this.actions?.idle?.crossFadeTo(this.actions.walk, CROSSFADE_S, false);
        this.actions?.walk?.reset().play();
      } else if (state === STATE.COOLDOWN) {
        this._opacityTarget = 0;
        this._cooldownUntilMs = nowMs + V2_NATURE_SPIRIT_COOLDOWN_MS;
        this.actions?.walk?.stop();
      }
    },

    /**
     * Standoff waypoint: south of YB by half a tile. This is the closest
     * the stag gets before facing her, keeping the full model outside tipi 1.
     */
    _standoffTarget() {
      const yb = this._getYbPosition?.();
      const x = yb?.x ?? 0;
      const z = (yb?.z ?? 0) - V2_NATURE_SPIRIT_YB_STANDOFF_M;
      this._tmpTarget.set(x, this._groundY(x, z), z);
      return this._tmpTarget;
    },

    _groundY(x, z) {
      return this._terrainY ? this._terrainY(x, z) : 0;
    },

    _spiritY(x, z) {
      return this._groundY(x, z) + V2_NATURE_SPIRIT_FEET_LIFT_M;
    },

    _faceToward(target, delta, rate = TURN_RATE) {
      const dx = target.x - this.root.position.x;
      const dz = target.z - this.root.position.z;
      if (dx * dx + dz * dz < 1e-6) return 0;
      const targetRot = Math.atan2(dx, dz);
      let diff = targetRot - this.root.rotation.y;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      this.root.rotation.y += diff * rate * delta;
      return diff;
    },

    _walkToward(target, delta) {
      this._faceToward(target, delta, TURN_RATE);
      this.root.translateZ(WALK_SPEED_MPS * delta);
      this.root.position.y = this._spiritY(this.root.position.x, this.root.position.z);
      return Math.hypot(target.x - this.root.position.x, target.z - this.root.position.z);
    },

    _syncFootCircle(nowMs = 0) {
      const foot = this._footCircle;
      if (!foot?.group || !this.root) return;
      const x = this.root.position.x;
      const z = this.root.position.z;
      foot.group.position.set(x, this._groundY(x, z) + 0.018, z);
      foot.group.rotation.y = this.root.rotation.y;
      const pulse = 0.75 + (Math.sin(nowMs * 0.003) * 0.5 + 0.5) * 0.25;
      foot.ring.material.opacity = this.root.visible ? 0.38 * this._opacity * pulse : 0;
      foot.fill.material.opacity = this.root.visible ? 0.1 * this._opacity * pulse : 0;
      foot.group.visible = this.root.visible && this._opacity > 0.02;
    },

    _triggerBloomAtYb() {
      const yb = this._getYbPosition?.();
      if (!yb || !this._bloom) return;
      const y = this._groundY(yb.x, yb.z) + 0.05;
      this._bloom.group.position.set(yb.x, y, yb.z);
      this._bloom.group.visible = true;
      this._bloom.age = 0;
      this._bloom.burst.scale.setScalar(0.12);
      this._bloom.burst.material.opacity = 0;
      this._bloom.shaft.scale.set(1, 1, 1);
      this._bloom.shaft.material.opacity = 0;
    },

    _tickBloom(delta) {
      const bloom = this._bloom;
      if (!bloom || !bloom.group.visible) return;
      bloom.age += delta;
      const life = bloom.age / this._bloomMaxAge;
      if (life >= 1) {
        bloom.group.visible = false;
        return;
      }
      const peak = V2_NATURE_SPIRIT_BLOOM_PEAK_RADIUS_M;
      /**
       * Three concentric layers, each on its own ease curve:
       *  - outerRing builds fast then thins out
       *  - innerRing follows ~25 % behind for a "second pulse" feel
       *  - halo fills the middle softly and fades linearly
       */
      const outerR = THREE.MathUtils.lerp(0.5, peak, Math.min(1, life * 1.7));
      const innerR = THREE.MathUtils.lerp(0.5, peak * 0.55, Math.min(1, Math.max(0, life - 0.1) * 1.5));
      const haloR = THREE.MathUtils.lerp(0.6, peak * 0.85, Math.min(1, life * 1.2));

      bloom.outerRing.scale.set(outerR / 0.5, 1, outerR / 0.5);
      bloom.innerRing.scale.set(innerR / 0.5, 1, innerR / 0.5);
      bloom.halo.scale.set(haloR / 0.5, 1, haloR / 0.5);

      // Bell-curve opacities for the rings, eased halo fade.
      const outerAlpha = Math.sin(life * Math.PI) * (bloom.outerRing.material.userData?.alphaMult ?? 0.95);
      const innerAlpha = Math.max(0, Math.sin(Math.max(0, life - 0.1) * Math.PI)) *
        (bloom.innerRing.material.userData?.alphaMult ?? 0.8);
      const haloAlpha = (1 - life * life) * (bloom.halo.material.userData?.alphaMult ?? 0.55);
      bloom.outerRing.material.opacity = outerAlpha;
      bloom.innerRing.material.opacity = innerAlpha;
      bloom.halo.material.opacity = haloAlpha;

      const shock = Math.min(1, life * 2.85);
      const burstScale = THREE.MathUtils.lerp(0.12, 14.5, 1 - (1 - shock) * (1 - shock));
      bloom.burst.scale.setScalar(burstScale);
      bloom.burst.material.opacity =
        Math.sin(shock * Math.PI) * (bloom.burst.material.userData?.alphaMult ?? 1.05);

      const pillarT = Math.min(1, life * 1.42);
      bloom.shaft.scale.set(1 + pillarT * 3.4, 1, 1 + pillarT * 3.4);
      bloom.shaft.material.opacity =
        Math.sin(Math.min(1, life * 1.55) * Math.PI) *
        (bloom.shaft.material.userData?.alphaMult ?? 0.84) *
        0.92;
    },

    _tickHologram(delta, nowMs) {
      this._opacity += (this._opacityTarget - this._opacity) * 2.0 * delta;
      const t = nowMs * 0.001;
      const pulse = 0.4 + (Math.sin(t * 2) * 0.5 + 0.5) * 0.55;
      for (const material of this._materials) {
        material.opacity = this._opacity;
        if (material.emissiveIntensity !== undefined) {
          material.emissiveIntensity = pulse * this._opacity;
        }
        material.visible = this._opacity > 0.01;
      }
      if (this.root && this.state === STATE.COOLDOWN && this._opacity < 0.02) {
        this.root.visible = false;
      }
    },

    update(delta) {
      if (!this.root || !this.mixer) return;
      const now = typeof performance !== "undefined" ? performance.now() : 0;

      /**
       * FPS short-circuit (Anu memory `nature-spirit-fps-shortcut`):
       *
       * The stag is invisible for the entire WAIT_TO_APPEAR window (30 s) and
       * the entire COOLDOWN (5 min). Without this gate the controller still
       * called `mixer.update(delta)` every frame in those states, evaluating
       * the full skinned skeleton for a mesh that wasn't being rendered —
       * the single biggest cost the controller adds to the frame budget.
       *
       * Skip mixer + hologram + bloom ticks while invisible; only advance
       * the wake-up timer. During COOLDOWN we keep the fade-out path
       * active until the opacity drops below the visibility threshold so
       * the dissolve still plays.
       */
      if (this.state === STATE.WAIT_TO_APPEAR) {
        if (now >= this._appearAtMs) this._setState(STATE.WALK_TO_STANDOFF, now);
        return;
      }
      if (this.state === STATE.COOLDOWN) {
        if (now >= this._cooldownUntilMs) {
          this._setState(STATE.WALK_TO_STANDOFF, now);
        } else if (this.root.visible) {
          this._tickHologram(delta, now);
          this._syncFootCircle(now);
          this.mixer.update(delta);
        }
        return;
      }

      /**
       * Player-priority pre-check (run on every active visit state).
       *
       * Per user spec (May 12 2026): "unless PLAYER AVATAR — then nature
       * spirit will leave and NPC will face player and wave 1× animation".
       * If the player is within `PLAYER_PRIORITY_RADIUS_M` of YB while the
       * spirit is in any of FACE_YB / NOD / POST_NOD_HOLD, we (a) hand off
       * to the YB controller via `_notifyYbPlayerInterrupt`, and (b)
       * abort the visit straight to WALK_TO_FOREST so the spirit dissolves
       * back into the forest. Only fires once per visit (guarded by
       * `_playerInterruptHandled`), so the spirit doesn't get yanked
       * around if the player jitters in and out of the radius mid-leave.
       */
      const inVisitState =
        this.state === STATE.FACE_YB ||
        this.state === STATE.NOD ||
        this.state === STATE.POST_NOD_HOLD;
      if (inVisitState && !this._playerInterruptHandled) {
        const player = this._getPlayerPosition?.();
        const yb = this._getYbPosition?.();
        if (player && yb) {
          const dx = player.x - yb.x;
          const dz = player.z - yb.z;
          if (dx * dx + dz * dz <= PLAYER_PRIORITY_RADIUS_M * PLAYER_PRIORITY_RADIUS_M) {
            this._playerInterruptHandled = true;
            this._notifyYbPlayerInterrupt?.(player.x, player.z);
            this._setState(STATE.WALK_TO_FOREST, now);
          }
        }
      }

      if (this.state === STATE.WALK_TO_STANDOFF) {
        const target = this._standoffTarget();
        const dist = this._walkToward(target, delta);
        if (dist <= ARRIVE_EPS_M) {
          this._setState(STATE.FACE_YB, now);
        }
      } else if (this.state === STATE.FACE_YB) {
        const yb = this._getYbPosition?.();
        if (yb) {
          this._tmpTarget.set(yb.x, this.root.position.y, yb.z);
          this._faceToward(this._tmpTarget, delta, FACE_YB_TURN_RATE);
        }
        if (
          now >= this._spiritIdleFreezeAtMs &&
          this.actions?.idle &&
          !this.actions.idle.paused
        ) {
          this.actions.idle.paused = true;
        }
        this.actions?.walk?.stop?.();
        if (now >= this._stateUntilMs) this._setState(STATE.NOD, now);
      } else if (this.state === STATE.NOD) {
        // ~25 % into the nod, ask YB to look-and-wave + spawn the bloom.
        // Note: the spirit's own clip is still the slow idle (no nod
        // animation per user spec); only the trigger timing for YB lives
        // here. YB then plays her 3-s wave + watches via her new
        // SPIRIT_WAVE/SPIRIT_WATCH state pair.
        if (!this._ybWaveTriggered) {
          const elapsedMs = V2_NATURE_SPIRIT_NOD_S * 1000 - (this._stateUntilMs - now);
          if (elapsedMs >= V2_NATURE_SPIRIT_NOD_S * 250 /* 25% */) {
            this._ybWaveTriggered = true;
            const stagX = this.root.position.x;
            const stagZ = this.root.position.z;
            const accepted = this._playYbSpiritGreeting?.(stagX, stagZ) ?? false;
            if (accepted) this._triggerBloomAtYb();
          }
        }
        if (now >= this._stateUntilMs) this._setState(STATE.POST_NOD_HOLD, now);
      } else if (this.state === STATE.POST_NOD_HOLD && now >= this._stateUntilMs) {
        this._setState(STATE.WALK_TO_FOREST, now);
      } else if (this.state === STATE.WALK_TO_FOREST) {
        const target = this._tmpTarget.set(
          FOREST_FADE_X,
          this._spiritY(FOREST_FADE_X, FOREST_FADE_Z),
          FOREST_FADE_Z,
        );
        const dist = this._walkToward(target, delta);
        this._opacityTarget = THREE.MathUtils.clamp(
          dist / FADE_START_DISTANCE_M,
          0,
          V2_NATURE_SPIRIT_HOLOGRAM_BASE_OPACITY,
        );
        // Feed YB our live position so SPIRIT_WATCH can detect the
        // "spirit > 1 tile from YB" exit condition and return her to
        // SEATED. Skipped if a player-interrupt already swapped YB into
        // PLAYER_GREETING_WAVE — her FSM ignores stale spirit updates
        // outside the SPIRIT_WAVE/SPIRIT_WATCH states.
        this._notifyYbSpiritPos?.(this.root.position.x, this.root.position.z);
        if (dist <= ARRIVE_EPS_M || this._opacity < 0.05) this._setState(STATE.COOLDOWN, now);
      }

      this._tickHologram(delta, now);
      this._tickBloom(delta);
      this._syncFootCircle(now);
      this.mixer.update(delta);
    },

    /**
     * Returns the live bloom circle's world XZ centre + current outer-ring
     * radius when the bloom is actively expanding or fading.
     * Called every frame by Fauna.js so rabbits flee from the bloom circle
     * as well as the stag body.
     * Returns `null` when the bloom is not visible / not active.
     */
    getBloomThreatXZ() {
      const bloom = this._bloom;
      if (!bloom?.group?.visible) return null;
      const life = Math.min(1, (bloom.age || 0) / (this._bloomMaxAge || 2.6));
      // Mirror of _tickBloom: outerR = lerp(0.5, PEAK, min(1, life*1.7))
      const outerR = V2_NATURE_SPIRIT_BLOOM_PEAK_RADIUS_M *
        Math.min(1, THREE.MathUtils.lerp(0.5 / V2_NATURE_SPIRIT_BLOOM_PEAK_RADIUS_M, 1, Math.min(1, life * 1.7)));
      const bp = bloom.group.position;
      return { x: bp.x, z: bp.z, radius: outerR };
    },

    snapshot() {
      return {
        state: this.state,
        opacity: Number(this._opacity.toFixed(3)),
        x: this.root?.position.x ?? null,
        y: this.root?.position.y ?? null,
        z: this.root?.position.z ?? null,
      };
    },

    dispose(scene, objects) {
      this.mixer?.stopAllAction?.();
      if (this.root) {
        scene.remove(this.root);
        const idx = objects.indexOf(this.root);
        if (idx >= 0) objects.splice(idx, 1);
      }
      if (this._bloom?.group) {
        scene.remove(this._bloom.group);
        const idx = objects.indexOf(this._bloom.group);
        if (idx >= 0) objects.splice(idx, 1);
        this._bloom.outerRing.geometry?.dispose?.();
        this._bloom.innerRing.geometry?.dispose?.();
        this._bloom.halo.geometry?.dispose?.();
        this._bloom.burst.geometry?.dispose?.();
        this._bloom.shaft.geometry?.dispose?.();
        this._bloom.outerRing.material?.dispose?.();
        this._bloom.innerRing.material?.dispose?.();
        this._bloom.halo.material?.dispose?.();
        this._bloom.burst.material?.dispose?.();
        this._bloom.shaft.material?.dispose?.();
      }
      if (this._footCircle?.group) {
        scene.remove(this._footCircle.group);
        const idx = objects.indexOf(this._footCircle.group);
        if (idx >= 0) objects.splice(idx, 1);
        this._footCircle.ring.geometry?.dispose?.();
        this._footCircle.fill.geometry?.dispose?.();
        this._footCircle.ring.material?.dispose?.();
        this._footCircle.fill.material?.dispose?.();
      }
      disposeMaterials(this._materials);
      if (typeof window !== "undefined" && window.natureSpiritSystem === this) {
        delete window.natureSpiritSystem;
      }
      this.root = null;
      this.rig = null;
      this.asset = null;
      this.mixer = null;
      this.actions = null;
      this._bloom = null;
      this._footCircle = null;
      this.state = STATE.WAIT_TO_APPEAR;
    },
  };
}

export const NATURE_SPIRIT_STATE = STATE;
