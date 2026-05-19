/**
 * Mold tool — PLANT BUSH.
 *
 * Each kid-placed bush is a small clump of 3-5 overlapping low-poly
 * spheres painted leafy green with slight per-lump hue variation. Optional
 * berry dots randomly added so some bushes carry colour. ~80 tris/bush.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const LEAF_PALETTE = [0x4f7038, 0x556c34, 0x3f6432, 0x537a3c];
const BERRY_PALETTE = [0xc94c3a, 0x6e3aa8, 0xe07a3a, 0xffd97a];

let _lumpGeo = null, _berryGeo = null;
function lumpGeo() {
  if (_lumpGeo) return _lumpGeo;
  _lumpGeo = new THREE.IcosahedronGeometry(0.42, 1);
  return _lumpGeo;
}
function berryGeo() {
  if (_berryGeo) return _berryGeo;
  _berryGeo = new THREE.IcosahedronGeometry(0.05, 0);
  return _berryGeo;
}
const _leafMats = new Map();
function leafMat(hex) {
  if (_leafMats.has(hex)) return _leafMats.get(hex);
  const m = new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 0.93,
    metalness: 0.0,
    flatShading: true,
  });
  _leafMats.set(hex, m);
  return m;
}
const _berryMats = new Map();
function berryMat(hex) {
  if (_berryMats.has(hex)) return _berryMats.get(hex);
  const m = new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: 0.22,
    roughness: 0.65,
    metalness: 0.05,
    flatShading: true,
  });
  _berryMats.set(hex, m);
  return m;
}

function buildBushMesh(mut, scene) {
  const payload = mut.payload ?? {};
  const leafHex =
    Number.isInteger(payload.leafHex) ? payload.leafHex :
    LEAF_PALETTE[Math.floor(Math.random() * LEAF_PALETTE.length)];
  const hasBerries = Number.isFinite(payload.berries)
    ? payload.berries === 1
    : Math.random() < 0.35;
  const berryHex =
    Number.isInteger(payload.berryHex) ? payload.berryHex :
    BERRY_PALETTE[Math.floor(Math.random() * BERRY_PALETTE.length)];
  if (mut.payload) {
    mut.payload.leafHex = leafHex;
    mut.payload.berries = hasBerries ? 1 : 0;
    if (hasBerries) mut.payload.berryHex = berryHex;
  } else {
    mut.payload = { leafHex, berries: hasBerries ? 1 : 0, berryHex };
  }

  const group = new THREE.Group();
  group.name = `sanctuary_bush_${mut.id ?? "x"}`;
  group.userData.anuId = `flora.sanctuary.bush.${mut.id ?? "x"}`;
  group.userData.anuKind = "sanctuary_mold_bush";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
  group.userData.anuInteractable = true;
  group.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.HARVEST, ANU_INTERACTION_VERB.INSPECT];

  const lumps = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < lumps; i++) {
    const lump = new THREE.Mesh(lumpGeo(), leafMat(leafHex));
    const r = 0.5 + Math.random() * 0.5;
    lump.position.set(
      (Math.random() - 0.5) * 0.8,
      0.22 + Math.random() * 0.16,
      (Math.random() - 0.5) * 0.8,
    );
    lump.scale.setScalar(r);
    lump.castShadow = true;
    lump.receiveShadow = true;
    lump.userData.anuKind = "sanctuary_mold_bush_lump";
    lump.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    group.add(lump);
  }
  if (hasBerries) {
    const berryCount = 4 + Math.floor(Math.random() * 5);
    const bm = berryMat(berryHex);
    for (let i = 0; i < berryCount; i++) {
      const b = new THREE.Mesh(berryGeo(), bm);
      b.position.set(
        (Math.random() - 0.5) * 0.6,
        0.30 + Math.random() * 0.30,
        (Math.random() - 0.5) * 0.6,
      );
      b.userData.anuKind = "sanctuary_mold_bush_berry";
      b.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
      group.add(b);
    }
  }

  const groundY = sanctuaryGroundY(mut.x, mut.z);
  group.position.set(mut.x, groundY, mut.z);
  scene.add(group);
  return group;
}

export const MoldPlantBushModule = {
  name: "MoldPlantBush",

  _scene: null,

  async load(scene) {
    this._scene = scene;
    const reg = typeof window !== "undefined" ? window.SanctuaryMutations : null;
    if (!reg?.registerToolHandler) return;
    reg.registerToolHandler("plant_bush", (mut, sceneArg) => {
      const target = sceneArg ?? this._scene;
      if (!target) return;
      mut.mesh = buildBushMesh(mut, target);
    });
    console.log(
      "%c[MoldPlantBush] 🌿 Handler registered — kids can plant bushes.",
      "color:#4f7038;font-weight:bold;",
    );
  },

  update() {},
  unload() { this._scene = null; },
};
