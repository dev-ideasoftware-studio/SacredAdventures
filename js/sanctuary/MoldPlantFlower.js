/**
 * Sacred Adventures — sanctuary mold tool: PLANT FLOWER.
 *
 * Registers a `plant_flower` handler. Each click drops a small flower
 * cluster (3-5 flowers in a single random colour) at the click point —
 * same shape as the SanctuaryFlora baseline clusters but with the kid's
 * agency stamped on it.
 *
 * Geometry per cluster (~50 tris). Mutation registry serialises the
 * (x, z, colourHex) tuple so SAVE → reload reproduces the exact same
 * colour.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const COLOR_PALETTE = [
  0xffb6c1, 0xffe97a, 0xc8a0ff, 0xffcc66, 0xff8c8c,
  0x9affe7, 0xffa07a, 0xe9c08a, 0xa1d6ff, 0xffc9f5,
];

let _stemGeo = null, _blossomGeo = null, _stemMat = null;
function stemGeo() {
  if (_stemGeo) return _stemGeo;
  const g = new THREE.CylinderGeometry(0.014, 0.022, 0.26, 4);
  g.translate(0, 0.13, 0);
  _stemGeo = g;
  return g;
}
function blossomGeo() {
  if (_blossomGeo) return _blossomGeo;
  _blossomGeo = new THREE.IcosahedronGeometry(0.075, 0);
  return _blossomGeo;
}
function stemMat() {
  if (_stemMat) return _stemMat;
  _stemMat = new THREE.MeshStandardMaterial({
    color: 0x3f5530, roughness: 0.9, metalness: 0.0, flatShading: true,
  });
  return _stemMat;
}
const _blossomMats = new Map();
function blossomMat(hex) {
  if (_blossomMats.has(hex)) return _blossomMats.get(hex);
  const m = new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: 0.18,
    roughness: 0.80,
    metalness: 0.0,
    flatShading: true,
  });
  _blossomMats.set(hex, m);
  return m;
}

function buildFlowerCluster(mut, scene) {
  const payload = mut.payload ?? {};
  const colour =
    Number.isInteger(payload.colourHex) ? payload.colourHex :
    COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
  // Persist the colour back into payload so SAVE → reload matches.
  if (mut.payload) mut.payload.colourHex = colour;
  else mut.payload = { colourHex: colour };

  const group = new THREE.Group();
  group.name = `sanctuary_mold_flower_${mut.id ?? "x"}`;
  group.userData.anuId = `flora.sanctuary.mold.flower.${mut.id ?? "x"}`;
  group.userData.anuKind = "sanctuary_mold_flower";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
  group.userData.anuInteractable = true;
  group.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.HARVEST, ANU_INTERACTION_VERB.INSPECT];

  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const dx = (Math.random() - 0.5) * 0.7;
    const dz = (Math.random() - 0.5) * 0.7;
    const stem = new THREE.Mesh(stemGeo(), stemMat());
    stem.position.set(dx, 0, dz);
    stem.userData.anuKind = "sanctuary_mold_flower_stem";
    stem.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    group.add(stem);
    const blossom = new THREE.Mesh(blossomGeo(), blossomMat(colour));
    blossom.position.set(dx, 0.28, dz);
    blossom.scale.setScalar(0.8 + Math.random() * 0.5);
    blossom.userData.anuKind = "sanctuary_mold_flower_blossom";
    blossom.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    group.add(blossom);
  }
  const groundY = sanctuaryGroundY(mut.x, mut.z);
  group.position.set(mut.x, groundY + 0.01, mut.z);
  scene.add(group);
  return group;
}

export const MoldPlantFlowerModule = {
  name: "MoldPlantFlower",

  _scene: null,

  async load(scene) {
    this._scene = scene;
    const reg = typeof window !== "undefined" ? window.SanctuaryMutations : null;
    if (!reg?.registerToolHandler) return;
    reg.registerToolHandler("plant_flower", (mut, sceneArg) => {
      const target = sceneArg ?? this._scene;
      if (!target) return;
      mut.mesh = buildFlowerCluster(mut, target);
    });
    console.log(
      "%c[MoldPlantFlower] 🌼 Handler registered — kids can plant flowers.",
      "color:#ffb6c1;font-weight:bold;",
    );
  },

  update() {},
  unload() { this._scene = null; },
};
