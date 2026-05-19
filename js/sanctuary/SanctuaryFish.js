/**
 * Sacred Adventures — sanctuary part 4 of 5: THE FISH.
 *
 * Loads `Assets/Fish/fish.obj` (same trout mesh as v2 Pool2), bakes the
 * 3DS Max Z-up export upright, and swims with velocity-based orbital
 * physics: head leads the path, body wiggles on yaw, gentle depth bob.
 */

import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
} from "./SanctuaryGround.js";

const FISH_OBJ_URL = "./Assets/Fish/fish.obj";
const FISH_COUNT = 12;
/** Body length after scale — matches v2 guidebook trout read. */
const FISH_TARGET_LENGTH_M = 0.44;
const SWIM_DEPTH_CENTER_M = 0.55;
const SWIM_DEPTH_SPREAD_M = 0.35;
/** Base angular rate (rad/s) for school coherence. */
const SWIM_RATE_RAD_S = 0.22;
const LOOK_AHEAD_S = 0.06;
const PLAYER_AVOID_RADIUS_M = 3 * 0.3048 * 1.4;
const PLAYER_PUSH_GAIN = 0.85;

function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Load + center + bake Z-up OBJ → Y-up (1:1 `WorldPool2.loadCenteredFishGeometry`).
 * @returns {Promise<{ geometry: THREE.BufferGeometry, fishLen: number } | null>}
 */
async function loadSanctuaryFishGeometry(url) {
  const obj = await new OBJLoader().loadAsync(url);
  let geom = null;
  obj.updateMatrixWorld(true);
  obj.traverse((c) => {
    if (geom || !c.isMesh || !c.geometry) return;
    geom = c.geometry.clone();
    geom.applyMatrix4(c.matrixWorld);
  });
  if (!geom) return null;
  if (!geom.getAttribute("normal")) geom.computeVertexNormals();
  geom.rotateX(-Math.PI / 2);
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const fishLen = Math.max(size.x, size.y, size.z, 0.001);
  const center = bb.getCenter(new THREE.Vector3());
  geom.translate(-center.x, -center.y, -center.z);
  return { geometry: geom, fishLen };
}

export const SanctuaryFishModule = {
  name: "SanctuaryFish",

  _scene: null,
  _root: null,
  _elapsed: 0,
  _fishBioTime: 0,
  _fishGeometry: null,
  _fishMaterial: null,
  _fishMeshes: [],
  _fishCenterY: 0,
  _cx: SANCTUARY_POOL_CENTER_X,
  _cz: SANCTUARY_POOL_CENTER_Z,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;
    this._cx = SANCTUARY_POOL_CENTER_X;
    this._cz = SANCTUARY_POOL_CENTER_Z;

    const root = new THREE.Group();
    root.name = "sanctuary_fish_school";
    root.userData.anuId = "fauna.sanctuary.fish_school";
    root.userData.anuKind = "sanctuary_fish_school";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
    scene.add(root);
    this._root = root;

    try {
      const fg = await loadSanctuaryFishGeometry(FISH_OBJ_URL);
      if (!fg?.geometry) {
        console.warn("[SanctuaryFish] fish.obj produced no geometry");
        return;
      }

      const scale = FISH_TARGET_LENGTH_M / fg.fishLen;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2b6ffe,
        roughness: 0.35,
        metalness: 0.25,
      });
      this._fishGeometry = fg.geometry;
      this._fishMaterial = mat;

      const waterY =
        typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
          ? window.__sanctuaryWaterY
          : -0.2;
      this._fishCenterY = waterY - SWIM_DEPTH_CENTER_M;

      const rng = mulberry32(0x3713ba75);
      this._fishMeshes = [];

      for (let i = 0; i < FISH_COUNT; i++) {
        const fish = new THREE.Mesh(fg.geometry, mat);
        fish.castShadow = false;
        fish.receiveShadow = false;
        fish.scale.setScalar(scale);
        fish.name = `sanctuary_fish_${i}`;
        fish.userData.anuId = `fauna.sanctuary.fish.${i}`;
        fish.userData.anuKind = "sanctuary_fish";
        fish.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
        fish.userData.anuInteractable = true;
        fish.userData.anuInteractionVerbs = [
          ANU_INTERACTION_VERB.INSPECT,
          ANU_INTERACTION_VERB.HARVEST,
        ];

        const orbitFrac = 0.22 + (i / FISH_COUNT) * 0.58;
        const orbitR = SANCTUARY_POOL_RADIUS_M * orbitFrac;
        const orbitDir = i % 2 === 0 ? 1 : -1;
        fish.userData.orbitR = orbitR;
        fish.userData.orbitDir = orbitDir;
        fish.userData.orbitPhase = (i * 0.61 + rng() * 0.3) * Math.PI * 2;
        fish.userData.depthOffset =
          -SWIM_DEPTH_SPREAD_M * 0.5 + rng() * SWIM_DEPTH_SPREAD_M;
        fish.userData.speedMul = 0.82 + rng() * 0.38;
        fish.userData.wigglePhase = i * 0.43 + rng() * 0.2;
        fish.userData.schoolAngleOff = (i / FISH_COUNT) * Math.PI * 2 + rng() * 0.35;
        const speedMul = fish.userData.speedMul;
        fish.userData.soloOmega =
          ((0.2 * speedMul * orbitDir) / Math.max(0.5, orbitR / 8)) *
          (0.55 + rng() * 0.5);
        fish.userData.fishMidY = this._fishCenterY;

        fish.position.set(this._cx, this._fishCenterY, this._cz);
        root.add(fish);
        this._fishMeshes.push(fish);
      }

      if (typeof window !== "undefined") {
        window.__sanctuaryFishSchool = this._fishMeshes;
        window.__sanctuaryFishCount = this._fishMeshes.length;
        window.__sanctuaryFishTemplate = {
          geometry: fg.geometry,
          fishLen: fg.fishLen,
          targetLengthM: FISH_TARGET_LENGTH_M,
        };
      }

      console.log(
        `%c[Sanctuary] 🐟 ${FISH_COUNT} fish.obj trout — upright, velocity swim (target ${FISH_TARGET_LENGTH_M} m).`,
        "color:#2b6ffe;font-weight:bold;",
      );
    } catch (err) {
      console.warn("[SanctuaryFish] fish.obj load failed:", err);
    }
  },

  update(delta) {
    if (!this._fishMeshes.length) return;
    this._elapsed += delta;
    this._fishBioTime += delta;
    const tb = this._fishBioTime;
    const t = this._elapsed;

    const av =
      typeof window !== "undefined" ? window.__sanctuaryAvatar : null;
    let playerX = null;
    let playerZ = null;
    if (av?.position) {
      playerX = av.position.x;
      playerZ = av.position.z;
    }

    const schoolStr = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(tb * 0.08));

    for (const fish of this._fishMeshes) {
      const ud = fish.userData;
      const R = ud.orbitR ?? SANCTUARY_POOL_RADIUS_M * 0.45;
      const orbitPhase = ud.orbitPhase ?? 0;
      const soloO = (ud.soloOmega ?? 0.16) * (ud.speedMul ?? 1);
      const schOff = ud.schoolAngleOff ?? 0;
      const omegaSchool = SWIM_RATE_RAD_S * 0.55 * schoolStr;

      const soloA0 = tb * soloO + orbitPhase;
      const soloA1 = (tb + LOOK_AHEAD_S) * soloO + orbitPhase;
      const sx0 = R * Math.cos(soloA0);
      const sz0 = R * Math.sin(soloA0);
      const sx1 = R * Math.cos(soloA1);
      const sz1 = R * Math.sin(soloA1);

      const schA0 = tb * omegaSchool + schOff;
      const schA1 = (tb + LOOK_AHEAD_S) * omegaSchool + schOff;
      const scx0 = R * Math.cos(schA0);
      const scz0 = R * Math.sin(schA0);
      const scx1 = R * Math.cos(schA1);
      const scz1 = R * Math.sin(schA1);

      const oneMinus = 1 - schoolStr;
      let lx = sx0 * oneMinus + scx0 * schoolStr;
      let lz = sz0 * oneMinus + scz0 * schoolStr;
      let vx = sx1 * oneMinus + scx1 * schoolStr - lx;
      let vz = sz1 * oneMinus + scz1 * schoolStr - lz;

      if (playerX !== null && playerZ !== null) {
        const dxP = this._cx + lx - playerX;
        const dzP = this._cz + lz - playerZ;
        const dP = Math.hypot(dxP, dzP);
        if (dP < PLAYER_AVOID_RADIUS_M && dP > 1e-3) {
          const push = (PLAYER_AVOID_RADIUS_M - dP) / PLAYER_AVOID_RADIUS_M;
          lx += (dxP / dP) * push * PLAYER_PUSH_GAIN;
          lz += (dzP / dP) * push * PLAYER_PUSH_GAIN;
          vx = dxP / dP;
          vz = dzP / dP;
        }
      }

      const midY = ud.fishMidY ?? this._fishCenterY;
      const bobY = Math.sin(t * 0.9 + orbitPhase * 2.17) * 0.14;
      fish.position.set(
        this._cx + lx,
        midY + (ud.depthOffset ?? 0) + bobY,
        this._cz + lz,
      );

      if (vx * vx + vz * vz > 1e-8) {
        const baseYaw = Math.atan2(-vz, vx) + Math.PI;
        const wiggleAmp = 0.22;
        const wiggle =
          Math.sin(t * 6.5 + (ud.wigglePhase ?? 0) * 4.7) * wiggleAmp;
        fish.rotation.set(0, baseYaw + wiggle, 0);
      }
    }
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    for (const fish of this._fishMeshes) {
      this._root.remove(fish);
    }
    this._fishGeometry?.dispose?.();
    this._fishMaterial?.dispose?.();
    this._fishMeshes = [];
    this._root = null;
    this._scene = null;
    if (typeof window !== "undefined") {
      delete window.__sanctuaryFishSchool;
      delete window.__sanctuaryFishTemplate;
    }
  },
};
