/**
 * Sacred Adventures — sanctuary part 23 of N: FISH JUMPS.
 *
 * Anu domain: FAUNA. Magical surprise life. Every 8–18 seconds Anu
 * picks one fish from `window.__sanctuaryFishSchool` (published by
 * SanctuaryFish), launches a small fish-shaped silhouette on a
 * parabolic arc breaking the water surface, and fires
 * `window.sanctuaryPulse(x, z)` so a ripple expands from the entry
 * point. Cosmetic only — the rendered school below the water keeps
 * swimming on its lazy orbital paths.
 *
 * Per-jump cost: one Mesh added/removed (~16 tris). Active jumps cap
 * at 1 simultaneous — staggers stay clean.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
} from "./SanctuaryGround.js";

const JUMP_INTERVAL_MIN_S = 3;
const JUMP_INTERVAL_MAX_S = 7;
const JUMP_DURATION_S = 0.85;
const JUMP_PEAK_M = 0.55;
const FISH_LENGTH_M = 0.40;

let _jumperGeo = null, _jumperMat = null;
function jumperGeo() {
  if (_jumperGeo) return _jumperGeo;
  // Try to read actual fish geometry from SanctuaryFish template
  const template = typeof window !== "undefined" ? window.__sanctuaryFishTemplate : null;
  if (template?.geometry) {
    _jumperGeo = template.geometry;
    return _jumperGeo;
  }
  // Fallback to cylindrical "log" geometry only if the template is not loaded
  const geo = new THREE.CylinderGeometry(0.018, 0.06, FISH_LENGTH_M, 8, 1);
  geo.rotateZ(Math.PI / 2);
  _jumperGeo = geo;
  return geo;
}
function jumperMat() {
  if (_jumperMat) return _jumperMat;
  // Gorgeous shiny trout blue-indigo standard material (perfect match with the swimming trout school)
  _jumperMat = new THREE.MeshStandardMaterial({
    color: 0x2b6ffe,
    roughness: 0.35,
    metalness: 0.25,
    flatShading: false,
  });
  return _jumperMat;
}

function pickJumpPoint() {
  // Random spot inside the pool — but not too close to the rim so the
  // ripple has water to expand into.
  const ang = Math.random() * Math.PI * 2;
  const r = (0.25 + Math.random() * 0.55) * SANCTUARY_POOL_RADIUS_M;
  return {
    x: SANCTUARY_POOL_CENTER_X + Math.cos(ang) * r,
    z: SANCTUARY_POOL_CENTER_Z + Math.sin(ang) * r,
  };
}

function findJumpTarget() {
  const candidates = [];
  const poolCX = SANCTUARY_POOL_CENTER_X;
  const poolCZ = SANCTUARY_POOL_CENTER_Z;
  const poolR = SANCTUARY_POOL_RADIUS_M;

  // 1. Check active dragonflies over the water
  const dfs = window.__sanctuaryDragonflies || [];
  for (const df of dfs) {
    if (df.alive && df.sprite) {
      const pos = df.sprite.position;
      const distToCenter = Math.hypot(pos.x - poolCX, pos.z - poolCZ);
      // Ensure the dragonfly is low over the pool water
      if (distToCenter < poolR * 0.95 && pos.y < 2.2 && pos.y > -0.2) {
        candidates.push({ type: "dragonfly", obj: df, pos: pos.clone() });
      }
    }
  }

  // 2. Check active butterflies exploring near the water
  const orc = window.anuOrchestrator;
  const butterfliesMod = orc?._activeModuleInstances?.SanctuaryButterflies;
  const bfs = butterfliesMod?._butterflies || [];
  for (const bf of bfs) {
    if (bf.visible !== false) {
      const pos = bf.position;
      const distToCenter = Math.hypot(pos.x - poolCX, pos.z - poolCZ);
      if (distToCenter < poolR * 0.95 && pos.y < 2.2 && pos.y > -0.2) {
        candidates.push({ type: "butterfly", obj: bf, pos: pos.clone() });
      }
    }
  }

  if (candidates.length > 0) {
    // Steer fish target to the lowest-flying insect (closest to the water)
    candidates.sort((a, b) => a.pos.y - b.pos.y);
    return candidates[0];
  }
  return null;
}

export const SanctuaryFishJumpsModule = {
  name: "SanctuaryFishJumps",

  _scene: null,
  _root: null,
  _waterY: 0,
  _active: null,         // { mesh, t0, dirX, dirZ, x, z, targetType, targetObj, willEat, hasEaten }
  _nextJumpAtS: 0,
  _elapsed: 0,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;
    const root = new THREE.Group();
    root.name = "sanctuary_fish_jumps";
    root.userData.anuId = "fauna.sanctuary.fish_jumps";
    root.userData.anuKind = "sanctuary_fish_jumps";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
    scene.add(root);
    this._root = root;

    this._waterY =
      typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
        ? window.__sanctuaryWaterY
        : -0.5;

    // Schedule the first jump a few seconds after world is alive — gives
    // the kid time to look around before the first surprise.
    this._nextJumpAtS = 5 + Math.random() * 4;

    console.log(
      "%c[Sanctuary] 🐟 Dynamic trout jumps online — targeting low-flying insects.",
      "color:#d0985a;font-weight:bold;",
    );
  },

  _startJump() {
    const target = findJumpTarget();
    let pt;
    let willEat = false;
    let targetType = null;
    let targetObj = null;

    if (target) {
      pt = { x: target.pos.x, z: target.pos.z };
      // 45% chance to eat the targeted insect
      willEat = Math.random() < 0.45;
      targetType = target.type;
      targetObj = target.obj;
    } else {
      pt = pickJumpPoint();
    }

    // Parabolic jump direction
    const dirAng = Math.random() * Math.PI * 2;
    const dirLength = 1.4;
    const dirX = Math.cos(dirAng) * dirLength;
    const dirZ = Math.sin(dirAng) * dirLength;

    const mesh = new THREE.Mesh(jumperGeo(), jumperMat());
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = "sanctuary_jumping_fish";
    mesh.userData.anuKind = "sanctuary_jumping_fish";
    mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;

    // Correct scale based on template fish scale
    const template = typeof window !== "undefined" ? window.__sanctuaryFishTemplate : null;
    if (template) {
      const scale = template.targetLengthM / template.fishLen;
      mesh.scale.setScalar(scale);
    }

    // Set horizontal path so that at t=0.5 the fish is exactly at the targeted insect's (x, z)
    let startX, startZ;
    if (target) {
      startX = pt.x - dirX * 0.5;
      startZ = pt.z - dirZ * 0.5;
    } else {
      startX = pt.x;
      startZ = pt.z;
    }

    mesh.position.set(startX, this._waterY - 0.05, startZ);
    this._root.add(mesh);

    this._active = { 
      mesh, 
      t0: this._elapsed, 
      x: startX, 
      z: startZ, 
      dirX, 
      dirZ, 
      targetType,
      targetObj,
      willEat,
      hasEaten: false
    };

    // Ripple at the entry point.
    if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
      window.sanctuaryPulse(startX, startZ);
    }
  },

  _executeEat(a) {
    if (!a.targetObj) return;

    if (a.targetType === "dragonfly") {
      const df = a.targetObj;
      df.alive = false;
      if (df.sprite) {
        df.sprite.position.set(0, -100, 0);
      }

      console.log("%c[SanctuaryFishJumps] 🐟 CHOMP! Trout successfully snapped up a dragonfly!", "color:#22afa2;font-weight:bold;");

      // Spawn a splash ripple where the catch happened
      if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
        window.sanctuaryPulse(df.sprite.position.x, df.sprite.position.z);
      }

      // "another dragonfly smaller replaces it"
      // Resurrect it as a baby dragonfly (scale 0.22) immediately from the edge of the pond
      setTimeout(() => {
        if (!this._root) return;
        df.sprite.scale.set(0.22, 0.22, 1);
        df.alive = true;
        const dfMod = window.anuOrchestrator?._activeModuleInstances?.SanctuaryDragonfly;
        if (dfMod && typeof dfMod._pickNewFlight === "function") {
          dfMod._pickNewFlight(df);
        }
      }, 700);
    } 
    else if (a.targetType === "butterfly") {
      const bf = a.targetObj;
      bf.visible = false;
      bf.position.set(0, -100, 0);

      console.log("%c[SanctuaryFishJumps] 🐟 CHOMP! Trout successfully snapped up a yellow butterfly!", "color:#fbc02d;font-weight:bold;");

      // Spawn a splash ripple
      if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
        window.sanctuaryPulse(bf.position.x, bf.position.z);
      }

      // Respawn the butterfly back at Tipi 1 after a delay
      setTimeout(() => {
        if (!this._root) return;
        bf.visible = true;
        const bMod = window.anuOrchestrator?._activeModuleInstances?.SanctuaryButterflies;
        if (bMod) {
          const spawn = bMod._returnTarget(bMod._rng, bMod._anchor.x, bMod._anchor.z);
          bf.position.copy(spawn);
          bf.userData.mode = "explore";
          bf.userData.target = bMod._exploreTarget(bMod._rng, bMod._anchor.x, bMod._anchor.z);
          bf.userData.modeT = 0;
        }
      }, 5000);
    }
  },

  _endJump() {
    if (!this._active) return;
    // Second ripple on splash-down.
    if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
      const a = this._active;
      window.sanctuaryPulse(a.x + a.dirX, a.z + a.dirZ);
    }
    this._root.remove(this._active.mesh);
    this._active = null;
    // Schedule the next jump.
    this._nextJumpAtS = this._elapsed + JUMP_INTERVAL_MIN_S +
      Math.random() * (JUMP_INTERVAL_MAX_S - JUMP_INTERVAL_MIN_S);
  },

  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;

    // Start a new jump?
    if (!this._active && this._elapsed >= this._nextJumpAtS) {
      this._startJump();
    }

    // Advance the active jump along its parabolic arc.
    if (this._active) {
      const a = this._active;
      const t = (this._elapsed - a.t0) / JUMP_DURATION_S; // 0..1
      if (t >= 1) {
        this._endJump();
        return;
      }
      // Parabola: peak at t=0.5.
      const arc = -4 * (t - 0.5) * (t - 0.5) + 1; // 0 at edges, 1 at midpoint
      a.mesh.position.set(
        a.x + a.dirX * t,
        this._waterY + JUMP_PEAK_M * arc,
        a.z + a.dirZ * t,
      );
      // Pitch the fish along the arc tangent — diving up at first,
      // levelling out at the peak, diving down at the end.
      const pitch = (1 - 2 * t) * 0.9; // +0.9 at start, -0.9 at end
      a.mesh.rotation.set(0, Math.atan2(a.dirX, a.dirZ), pitch);

      // Snap action: snap up the insect at the peak of the leap (t >= 0.48)
      if (t >= 0.48 && a.willEat && !a.hasEaten) {
        a.hasEaten = true;
        this._executeEat(a);
      }
    }
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry && o.geometry !== jumperGeo()) o.geometry.dispose?.();
    });
    this._root = null;
    this._active = null;
    this._scene = null;
  },
};
