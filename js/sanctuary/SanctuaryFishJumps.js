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

// REMOVED 2026-05-27: findJumpTarget() previously made fish leap OUT of the
// pond to "eat" dragonflies and butterflies. Per user spec: "only the fish
// inside the pond jump, don't create silly animations for nothing." Fish
// now jump in place inside the pond as a cosmetic surprise — no cross-
// pond chase, no out-of-pond ripples, no insect-eating side effects.

export const SanctuaryFishJumpsModule = {
  name: "SanctuaryFishJumps",

  _scene: null,
  _root: null,
  _waterY: 0,
  _active: null,         // { mesh, t0, dirX, dirZ, x, z }
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
      "%c[Sanctuary] 🐟 Trout jumps online — cosmetic in-pond breach only.",
      "color:#d0985a;font-weight:bold;",
    );
  },

  _startJump() {
    // Pick a random point inside the pond (already constrained to interior
    // by pickJumpPoint — uses 0.25–0.80 × pool radius).
    const pt = pickJumpPoint();

    // Short horizontal travel so the splash-down stays well inside the pond
    // even if the jump starts near the edge. Reduced from the old 1.4 m
    // chase-distance now that fish no longer pursue insects.
    const dirAng = Math.random() * Math.PI * 2;
    const dirLength = 0.45;
    const dirX = Math.cos(dirAng) * dirLength;
    const dirZ = Math.sin(dirAng) * dirLength;

    const mesh = new THREE.Mesh(jumperGeo(), jumperMat());
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = "sanctuary_jumping_fish";
    mesh.userData.anuKind = "sanctuary_jumping_fish";
    mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;

    const template = typeof window !== "undefined" ? window.__sanctuaryFishTemplate : null;
    if (template) {
      const scale = template.targetLengthM / template.fishLen;
      mesh.scale.setScalar(scale);
    }

    const startX = pt.x;
    const startZ = pt.z;

    mesh.position.set(startX, this._waterY - 0.05, startZ);
    this._root.add(mesh);

    this._active = {
      mesh,
      t0: this._elapsed,
      x: startX,
      z: startZ,
      dirX,
      dirZ,
    };

    if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
      window.sanctuaryPulse(startX, startZ);
    }
  },

  _endJump() {
    if (!this._active) return;
    const a = this._active;
    // Splash-down ripple, clamped to pond interior so it can never appear
    // on grass even if some future edit lengthens dirLength.
    if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
      let endX = a.x + a.dirX;
      let endZ = a.z + a.dirZ;
      const dx = endX - SANCTUARY_POOL_CENTER_X;
      const dz = endZ - SANCTUARY_POOL_CENTER_Z;
      const dist = Math.hypot(dx, dz);
      const maxR = SANCTUARY_POOL_RADIUS_M * 0.92;
      if (dist > maxR) {
        endX = SANCTUARY_POOL_CENTER_X + (dx / dist) * maxR;
        endZ = SANCTUARY_POOL_CENTER_Z + (dz / dist) * maxR;
      }
      window.sanctuaryPulse(endX, endZ);
    }
    this._root.remove(this._active.mesh);
    this._active = null;
    this._nextJumpAtS = this._elapsed + JUMP_INTERVAL_MIN_S +
      Math.random() * (JUMP_INTERVAL_MAX_S - JUMP_INTERVAL_MIN_S);
  },

  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;

    if (!this._active && this._elapsed >= this._nextJumpAtS) {
      this._startJump();
    }

    if (this._active) {
      const a = this._active;
      const t = (this._elapsed - a.t0) / JUMP_DURATION_S; // 0..1
      if (t >= 1) {
        this._endJump();
        return;
      }
      const arc = -4 * (t - 0.5) * (t - 0.5) + 1; // 0 at edges, 1 at midpoint
      a.mesh.position.set(
        a.x + a.dirX * t,
        this._waterY + JUMP_PEAK_M * arc,
        a.z + a.dirZ * t,
      );
      const pitch = (1 - 2 * t) * 0.9;
      a.mesh.rotation.set(0, Math.atan2(a.dirX, a.dirZ), pitch);
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
