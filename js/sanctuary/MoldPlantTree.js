/**
 * Sacred Adventures — sanctuary mold tool: PLANT TREE.
 *
 * Registers a `plant_tree` handler against the SanctuaryMutations
 * registry. When a kid clicks the ground in top-down mode with the
 * plant_tree tool armed, a low-poly conifer drops in there.
 *
 * Anu domain on the spawned mesh: FLORA. Each tree is INTERACTABLE
 * with verb `harvest` so Anu's vocabulary (which already names harvest
 * as a verb) finally has something to act on.
 *
 * Geometry per tree (~120 tris):
 *   • Trunk      — short tapered cylinder (8 segments).
 *   • Crown      — three stacked cones with decreasing radius, slight
 *                  random Y-jitter per cone so the silhouette reads
 *                  organic rather than perfectly stacked.
 *
 * 30 trees = ~3.6k tris. Anu's frame budget at v4 baseline is < 25%
 * load — plenty of room for many kid-planted trees.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const DEFAULT_HEIGHT_M = 3.6;

const CROWN_PALETTE = [
  0x3d6b32, 0x456b3d, 0x4f7038, 0x355829,
];

let _cachedTrunkMat = null;
function trunkMaterial() {
  if (_cachedTrunkMat) return _cachedTrunkMat;
  _cachedTrunkMat = new THREE.MeshStandardMaterial({
    color: 0x5e3d20,
    roughness: 0.93,
    metalness: 0.0,
    flatShading: true,
  });
  return _cachedTrunkMat;
}

const _crownMats = new Map();
function crownMaterial(hex) {
  if (_crownMats.has(hex)) return _crownMats.get(hex);
  const m = new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 0.92,
    metalness: 0.0,
    flatShading: true,
  });
  _crownMats.set(hex, m);
  return m;
}

function buildTreeMesh(mut, scene) {
  const payload = mut.payload ?? {};
  const height = Number.isFinite(payload.height) ? payload.height : DEFAULT_HEIGHT_M;
  const crownHex =
    Number.isInteger(payload.crownHex) ? payload.crownHex :
    CROWN_PALETTE[Math.floor(Math.random() * CROWN_PALETTE.length)];

  const group = new THREE.Group();
  group.name = `sanctuary_tree_${mut.id ?? "x"}`;
  group.userData.anuId = `flora.sanctuary.tree.${mut.id ?? "x"}`;
  group.userData.anuKind = "sanctuary_tree";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
  group.userData.anuInteractable = true;
  group.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.HARVEST, ANU_INTERACTION_VERB.INSPECT];

  const trunkH = height * 0.35;
  const trunkGeo = new THREE.CylinderGeometry(0.08, 0.13, trunkH, 6, 1);
  const trunk = new THREE.Mesh(trunkGeo, trunkMaterial());
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.userData.anuKind = "sanctuary_tree_trunk";
  trunk.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
  group.add(trunk);

  // Crown — three cones stacked, each smaller than the one below.
  const crownH = height * 0.65;
  const layerHeight = crownH / 3;
  let y = trunkH;
  for (let i = 0; i < 3; i++) {
    const r = (1 - i * 0.22) * 0.95;
    const geo = new THREE.ConeGeometry(r, layerHeight * 1.35, 8, 1);
    const cone = new THREE.Mesh(geo, crownMaterial(crownHex));
    cone.position.y = y + layerHeight * 0.5 + (Math.random() - 0.5) * 0.04;
    cone.rotation.y = Math.random() * Math.PI * 2;
    cone.castShadow = true;
    cone.receiveShadow = true;
    cone.userData.anuKind = "sanctuary_tree_crown";
    cone.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    group.add(cone);
    y += layerHeight * 0.85; // overlap a little so seams don't show
  }

  const groundY = sanctuaryGroundY(mut.x, mut.z);
  group.position.set(mut.x, groundY, mut.z);
  scene.add(group);
  return group;
}

export const MoldPlantTreeModule = {
  name: "MoldPlantTree",

  _scene: null,

  async load(scene) {
    this._scene = scene;
    const reg = typeof window !== "undefined" ? window.SanctuaryMutations : null;
    if (!reg?.registerToolHandler) return;
    reg.registerToolHandler("plant_tree", (mut, sceneArg) => {
      const target = sceneArg ?? this._scene;
      if (!target) return;
      mut.mesh = buildTreeMesh(mut, target);
    });
    console.log(
      "%c[MoldPlantTree] 🌲 Handler registered — kids can plant trees.",
      "color:#3d6b32;font-weight:bold;",
    );
  },

  update() {},
  unload() { this._scene = null; },
};
