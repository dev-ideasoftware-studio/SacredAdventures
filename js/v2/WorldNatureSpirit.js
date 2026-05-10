import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import {
  ANU_INTERACTION_VERB,
  ANU_SIMULATION_DOMAIN,
} from "./anu/SimulationController.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import {
  V2_NATURE_SPIRIT_APPEAR_DELAY_MS,
  V2_NATURE_SPIRIT_COOLDOWN_MS,
  V2_NATURE_SPIRIT_HEIGHT_M,
  V2_NATURE_SPIRIT_HOLOGRAM_BASE_OPACITY,
  V2_NATURE_SPIRIT_HOLOGRAM_EMISSIVE_HEX,
} from "./constants.js";

const NATURE_SPIRIT_URL = "./Assets/animated.stag.glb";

const STATE = Object.freeze({
  WAIT_TO_APPEAR: "WAIT_TO_APPEAR",
  WALK_TO_YB: "WALK_TO_YB",
  NOD: "NOD",
  WAIT_AFTER_NOD: "WAIT_AFTER_NOD",
  TURN_NE: "TURN_NE",
  WALK_NE: "WALK_NE",
  WALK_E_FADE: "WALK_E_FADE",
  COOLDOWN: "COOLDOWN",
});

const START_X = -20;
const START_Z = -10;
const LEGACY_NE_X = 15;
const LEGACY_NE_Z = -25;
const EAST_WOODS_X = 42;
const EAST_WOODS_Z = -25;
const NEAR_YB_OFFSET_X = -3;
const NEAR_YB_OFFSET_Z = 1;

const ARRIVE_EPS_M = 1.0;
const WALK_SPEED_MPS = 1.5;
const TURN_RATE_WALK = 3.0;
const TURN_RATE_PRE_WALKOUT = 1.5;
const HOVER_Y_OFFSET_M = 3.2;
const HOVER_Y_LERP_RATE = 5.0;
const NOD_SECONDS = 4.0;
const WAIT_AFTER_NOD_SECONDS = 5.0;
const FADE_START_DISTANCE_M = 20.0;

function findClip(clips, regex, fallbackIndex = 0) {
  return clips.find((clip) => regex.test(String(clip.name ?? ""))) ?? clips[fallbackIndex] ?? null;
}

function cloneHologramMaterials(asset, bucket) {
  asset.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const cloned = materials.map((material) => {
      if (!material) return material;
      const next = material.clone();
      next.transparent = true;
      next.opacity = V2_NATURE_SPIRIT_HOLOGRAM_BASE_OPACITY;
      next.depthWrite = false;
      next.depthTest = true;
      if (next.emissive?.setHex) {
        next.emissive.setHex(V2_NATURE_SPIRIT_HOLOGRAM_EMISSIVE_HEX);
        next.emissiveIntensity = 0.5;
      } else {
        next.emissive = new THREE.Color(V2_NATURE_SPIRIT_HOLOGRAM_EMISSIVE_HEX);
        next.emissiveIntensity = 0.5;
      }
      next.needsUpdate = true;
      bucket.push(next);
      return next;
    });
    child.material = Array.isArray(child.material) ? cloned : cloned[0];
  });
}

function disposeMaterials(materials) {
  for (const material of materials) material?.dispose?.();
  materials.length = 0;
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
    _appearAtMs: 0,
    _cooldownUntilMs: Infinity,
    _stateUntilMs: Infinity,
    _opacity: 0,
    _opacityTarget: 0,
    _tmpTarget: new THREE.Vector3(),
    _tmpInitialTarget: new THREE.Vector3(),

    async load(scene, objects, { terrainY, getYbPosition }) {
      try {
        this._terrainY = terrainY;
        this._getYbPosition = getYbPosition;

        const gltf = await new GLTFLoaderWithDraco().loadAsync(NATURE_SPIRIT_URL);
        const asset = gltf.scene;
        cloneHologramMaterials(asset, this._materials);

        const root = new THREE.Group();
        root.name = "population_nature_spirit_deer";
        root.scale.setScalar(V2_NATURE_SPIRIT_HEIGHT_M);
        root.position.set(START_X, terrainY(START_X, START_Z) + HOVER_Y_OFFSET_M, START_Z);
        root.visible = false;
        root.userData.anuId = "population.naturespirit.deer";
        root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
        root.userData.anuKind = "nature_spirit_deer_hologram";
        root.userData.anuInteractable = true;
        root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
        root.userData.anuLegacyReference =
          "js/EnvironmentBuilder.js NatureSpirit animated.stag.glb + js/MasterNPCAI.js STAG_* FSM";

        // Legacy rig fix: native stag head is along X, so the nested rig is -90deg.
        const rig = new THREE.Group();
        rig.rotation.y = -Math.PI / 2;
        rig.add(asset);
        root.add(rig);

        this._tmpInitialTarget.copy(root.position);
        this._tmpInitialTarget.x += 10;
        root.lookAt(this._tmpInitialTarget);

        scene.add(root);
        objects.push(root);

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
          "%c[World] NatureSpirit deer staged — appears 30s after load",
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
      const idleClip = findClip(clips, /idle/i, 0);
      const bowClip = findClip(clips, /bow|nod|greet|eat|graze/i, clips.indexOf(idleClip));

      const walk = walkClip ? this.mixer.clipAction(walkClip) : null;
      const idle = idleClip ? this.mixer.clipAction(idleClip) : null;
      const nod = bowClip ? this.mixer.clipAction(bowClip) : idle;

      // Legacy majestic slow motion.
      walk?.setEffectiveTimeScale(0.35);
      nod?.setEffectiveTimeScale(0.5);
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

      if (state === STATE.WALK_TO_YB) {
        this.root.visible = true;
        this.root.position.set(START_X, this._groundY(START_X, START_Z), START_Z);
        this._opacityTarget = 0.7;
        this.actions?.walk?.reset().play();
      } else if (state === STATE.NOD) {
        this._stateUntilMs = nowMs + NOD_SECONDS * 1000;
        this.actions?.walk?.crossFadeTo(this.actions.nod, 1.0, false);
        this.actions?.nod?.reset().play();
      } else if (state === STATE.WAIT_AFTER_NOD) {
        this._stateUntilMs = nowMs + WAIT_AFTER_NOD_SECONDS * 1000;
        this.actions?.nod?.crossFadeTo(this.actions.idle, 0.5, false);
        this.actions?.idle?.reset().play();
      } else if (state === STATE.TURN_NE) {
        this.actions?.idle?.crossFadeTo(this.actions.walk, 1.0, false);
        this.actions?.walk?.reset().play();
      } else if (state === STATE.WALK_NE || state === STATE.WALK_E_FADE) {
        this.actions?.walk?.reset().play();
      } else if (state === STATE.COOLDOWN) {
        this._opacityTarget = 0;
        this._cooldownUntilMs = nowMs + V2_NATURE_SPIRIT_COOLDOWN_MS;
        this.actions?.walk?.stop();
      }
    },

    _ybTarget() {
      const yb = this._getYbPosition?.();
      const x = (yb?.x ?? 0) + NEAR_YB_OFFSET_X;
      const z = (yb?.z ?? 0) + NEAR_YB_OFFSET_Z;
      this._tmpTarget.set(x, this._groundY(x, z), z);
      return this._tmpTarget;
    },

    _groundY(x, z) {
      return (this._terrainY ? this._terrainY(x, z) : 0) + HOVER_Y_OFFSET_M;
    },

    _faceToward(target, delta, rate = TURN_RATE_WALK) {
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
      this._faceToward(target, delta, TURN_RATE_WALK);
      this.root.translateZ(WALK_SPEED_MPS * delta);
      return Math.hypot(target.x - this.root.position.x, target.z - this.root.position.z);
    },

    _tickHologram(delta, nowMs) {
      this._opacity += (this._opacityTarget - this._opacity) * 2.0 * delta;
      const t = nowMs * 0.001;
      const pulse = 0.3 + (Math.sin(t * 2) * 0.5 + 0.5) * 0.5;
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

      this.root.position.y += (this._groundY(this.root.position.x, this.root.position.z) - this.root.position.y) *
        HOVER_Y_LERP_RATE *
        delta;

      if (this.state === STATE.WAIT_TO_APPEAR && now >= this._appearAtMs) {
        this._setState(STATE.WALK_TO_YB, now);
      } else if (this.state === STATE.WALK_TO_YB) {
        const dist = this._walkToward(this._ybTarget(), delta);
        if (dist <= ARRIVE_EPS_M) this._setState(STATE.NOD, now);
      } else if (this.state === STATE.NOD && now >= this._stateUntilMs) {
        this._setState(STATE.WAIT_AFTER_NOD, now);
      } else if (this.state === STATE.WAIT_AFTER_NOD && now >= this._stateUntilMs) {
        this._setState(STATE.TURN_NE, now);
      } else if (this.state === STATE.TURN_NE) {
        const diff = this._faceToward(this._tmpTarget.set(LEGACY_NE_X, 0, LEGACY_NE_Z), delta, TURN_RATE_PRE_WALKOUT);
        if (Math.abs(diff) < 0.2) this._setState(STATE.WALK_NE, now);
      } else if (this.state === STATE.WALK_NE) {
        const target = this._tmpTarget.set(LEGACY_NE_X, this._groundY(LEGACY_NE_X, LEGACY_NE_Z), LEGACY_NE_Z);
        const dist = this._walkToward(target, delta);
        if (dist <= ARRIVE_EPS_M) this._setState(STATE.WALK_E_FADE, now);
      } else if (this.state === STATE.WALK_E_FADE) {
        const target = this._tmpTarget.set(EAST_WOODS_X, this._groundY(EAST_WOODS_X, EAST_WOODS_Z), EAST_WOODS_Z);
        const dist = this._walkToward(target, delta);
        this._opacityTarget = Math.max(0, Math.min(0.7, dist / FADE_START_DISTANCE_M));
        if (dist <= ARRIVE_EPS_M || this._opacity < 0.05) this._setState(STATE.COOLDOWN, now);
      } else if (this.state === STATE.COOLDOWN && now >= this._cooldownUntilMs) {
        this._appearAtMs = now;
        this._setState(STATE.WALK_TO_YB, now);
      }

      this._tickHologram(delta, now);
      this.mixer.update(delta);
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
      disposeMaterials(this._materials);
      if (typeof window !== "undefined" && window.natureSpiritSystem === this) {
        delete window.natureSpiritSystem;
      }
      this.root = null;
      this.rig = null;
      this.asset = null;
      this.mixer = null;
      this.actions = null;
      this.state = STATE.WAIT_TO_APPEAR;
    },
  };
}

export const NATURE_SPIRIT_STATE = STATE;
