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

const JUMP_INTERVAL_MIN_S = 8;
const JUMP_INTERVAL_MAX_S = 18;
const JUMP_DURATION_S = 0.85;
const JUMP_PEAK_M = 0.55;
const FISH_LENGTH_M = 0.40;

let _jumperGeo = null, _jumperMat = null;
function jumperGeo() {
  if (_jumperGeo) return _jumperGeo;
  // Reuse the same drop-shape body the SanctuaryFish module uses so
  // the silhouette reads as one of the pool's own. Long axis = +X.
  const geo = new THREE.CylinderGeometry(0.018, 0.06, FISH_LENGTH_M, 8, 1);
  geo.rotateZ(Math.PI / 2);
  _jumperGeo = geo;
  return geo;
}
function jumperMat() {
  if (_jumperMat) return _jumperMat;
  _jumperMat = new THREE.MeshStandardMaterial({
    color: 0xd0985a,
    emissive: 0x3a2511,
    emissiveIntensity: 0.20,
    roughness: 0.55,
    metalness: 0.18,
    flatShading: true,
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
      "%c[Sanctuary] 🐟 Fish jumps online — every 8–18 s a trout breaks the surface.",
      "color:#d0985a;font-weight:bold;",
    );
  },

  _startJump() {
    const pt = pickJumpPoint();
    // Random horizontal arc direction — small (the fish doesn't travel
    // far across the water, just up + slight forward).
    const dirAng = Math.random() * Math.PI * 2;
    const dirX = Math.cos(dirAng) * 0.7;
    const dirZ = Math.sin(dirAng) * 0.7;
    const mesh = new THREE.Mesh(jumperGeo(), jumperMat());
    mesh.position.set(pt.x, this._waterY - 0.05, pt.z);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.name = "sanctuary_jumping_fish";
    mesh.userData.anuKind = "sanctuary_jumping_fish";
    mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
    this._root.add(mesh);
    this._active = { mesh, t0: this._elapsed, x: pt.x, z: pt.z, dirX, dirZ };

    // Ripple at the entry point.
    if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
      window.sanctuaryPulse(pt.x, pt.z);
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
