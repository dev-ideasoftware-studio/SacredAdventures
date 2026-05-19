/**
 * Mold tool — PLANT ROCK.
 *
 * Drops a small cluster of stones at the click point — 2-4 low-poly
 * icosahedra in slate-grey tones, varied scale + yaw so each pile reads
 * unique. ~40 tris per pile.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const STONE_PALETTE = [0x6b7079, 0x7a7f88, 0x5d6168, 0x868a92];

let _stoneGeo = null;
function stoneGeo() {
  if (_stoneGeo) return _stoneGeo;
  _stoneGeo = new THREE.IcosahedronGeometry(0.28, 0);
  return _stoneGeo;
}
const _stoneMats = new Map();
function stoneMat(hex) {
  if (_stoneMats.has(hex)) return _stoneMats.get(hex);
  const m = new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 0.95,
    metalness: 0.05,
    flatShading: true,
  });
  _stoneMats.set(hex, m);
  return m;
}

function buildRockCluster(mut, scene) {
  const group = new THREE.Group();
  group.name = `sanctuary_rocks_${mut.id ?? "x"}`;
  group.userData.anuId = `environment.sanctuary.rocks.${mut.id ?? "x"}`;
  group.userData.anuKind = "sanctuary_mold_rocks";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.userData.anuInteractable = true;
  group.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];

  const count = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const hex = STONE_PALETTE[Math.floor(Math.random() * STONE_PALETTE.length)];
    const m = new THREE.Mesh(stoneGeo(), stoneMat(hex));
    const s = 0.6 + Math.random() * 1.0;
    m.position.set(
      (Math.random() - 0.5) * 0.7,
      0.16 * s + Math.random() * 0.04,
      (Math.random() - 0.5) * 0.7,
    );
    m.scale.setScalar(s);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.rotation.z = (Math.random() - 0.5) * 0.4;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.anuKind = "sanctuary_mold_rock";
    m.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    group.add(m);
  }

  const groundY = sanctuaryGroundY(mut.x, mut.z);
  group.position.set(mut.x, groundY, mut.z);
  scene.add(group);
  return group;
}

export const MoldPlantRockModule = {
  name: "MoldPlantRock",

  _scene: null,

  async load(scene) {
    this._scene = scene;
    const reg = typeof window !== "undefined" ? window.SanctuaryMutations : null;
    if (!reg?.registerToolHandler) return;
    reg.registerToolHandler("plant_rock", (mut, sceneArg) => {
      const target = sceneArg ?? this._scene;
      if (!target) return;
      mut.mesh = buildRockCluster(mut, target);
    });
    console.log(
      "%c[MoldPlantRock] 🪨 Handler registered — kids can place stones.",
      "color:#888a86;font-weight:bold;",
    );
  },

  update() {},
  unload() { this._scene = null; },
};
