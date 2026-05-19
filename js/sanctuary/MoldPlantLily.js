/**
 * Mold tool — PLANT LILY.
 *
 * Drops one lily pad (with a small chance of a gold flower) on the
 * pool surface at the click point. If the click is OUTSIDE the pool
 * radius, the mutation is rejected silently (the pad needs water to
 * float on). Anu domain: ENVIRONMENT (decorative water-surface
 * decoration, same as the baseline lily pads in SanctuaryPool).
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
} from "./SanctuaryGround.js";

let _padGeo = null, _padMat = null, _flowerGeo = null, _flowerMat = null;
function padGeo() {
  if (_padGeo) return _padGeo;
  _padGeo = new THREE.CircleGeometry(0.45, 10);
  return _padGeo;
}
function padMat() {
  if (_padMat) return _padMat;
  _padMat = new THREE.MeshStandardMaterial({
    color: 0x4f6e3a,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  return _padMat;
}
function flowerGeo() {
  if (_flowerGeo) return _flowerGeo;
  _flowerGeo = new THREE.ConeGeometry(0.085, 0.14, 6);
  return _flowerGeo;
}
function flowerMat() {
  if (_flowerMat) return _flowerMat;
  _flowerMat = new THREE.MeshStandardMaterial({
    color: 0xfff0c4,
    emissive: 0x55421f,
    emissiveIntensity: 0.2,
    roughness: 0.7,
    metalness: 0.0,
    flatShading: true,
  });
  return _flowerMat;
}

function buildLilyMesh(mut, scene) {
  // Reject if outside the pool — pads need water.
  const dx = mut.x - SANCTUARY_POOL_CENTER_X;
  const dz = mut.z - SANCTUARY_POOL_CENTER_Z;
  const r = Math.hypot(dx, dz);
  if (r > SANCTUARY_POOL_RADIUS_M * 0.92) {
    console.log(
      `%c[MoldPlantLily] click at (${mut.x.toFixed(1)}, ${mut.z.toFixed(1)}) is outside the pool — skipping.`,
      "color:#aaa;",
    );
    return null;
  }
  const waterY =
    typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
      ? window.__sanctuaryWaterY
      : 0;

  const payload = mut.payload ?? {};
  const hasFlower = Number.isFinite(payload.flower)
    ? payload.flower === 1
    : Math.random() < 0.45;
  if (mut.payload) mut.payload.flower = hasFlower ? 1 : 0;
  else mut.payload = { flower: hasFlower ? 1 : 0 };

  const group = new THREE.Group();
  group.name = `sanctuary_lily_${mut.id ?? "x"}`;
  group.userData.anuId = `environment.sanctuary.lily.${mut.id ?? "x"}`;
  group.userData.anuKind = "sanctuary_mold_lily";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.userData.anuInteractable = true;
  group.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];

  const pad = new THREE.Mesh(padGeo(), padMat());
  pad.rotation.x = -Math.PI / 2;
  pad.rotation.z = Math.random() * Math.PI * 2;
  pad.scale.setScalar(0.7 + Math.random() * 0.7);
  pad.userData.anuKind = "sanctuary_mold_lily_pad";
  pad.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(pad);

  if (hasFlower) {
    const flower = new THREE.Mesh(flowerGeo(), flowerMat());
    flower.position.set(0, 0.07, 0);
    flower.userData.anuKind = "sanctuary_mold_lily_flower";
    flower.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    group.add(flower);
  }

  group.position.set(mut.x, waterY + 0.025, mut.z);
  scene.add(group);

  // Ripple the water as it lands — kids will love it.
  if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
    window.sanctuaryPulse(mut.x, mut.z);
  }
  return group;
}

export const MoldPlantLilyModule = {
  name: "MoldPlantLily",

  _scene: null,

  async load(scene) {
    this._scene = scene;
    const reg = typeof window !== "undefined" ? window.SanctuaryMutations : null;
    if (!reg?.registerToolHandler) return;
    reg.registerToolHandler("plant_lily", (mut, sceneArg) => {
      const target = sceneArg ?? this._scene;
      if (!target) return;
      mut.mesh = buildLilyMesh(mut, target);
    });
    console.log(
      "%c[MoldPlantLily] 🪷 Handler registered — kids can drop lilies on the water.",
      "color:#aaeacf;font-weight:bold;",
    );
  },

  update() {},
  unload() { this._scene = null; },
};
