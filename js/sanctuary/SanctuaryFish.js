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
/** Base angular rate (rad/s) for school coherence. slowed down by 80% (0.22 * 0.2) */
const SWIM_RATE_RAD_S = 0.044;
const LOOK_AHEAD_S = 0.06;
const PLAYER_AVOID_RADIUS_M = 3 * 0.3048 * 1.4;
const PLAYER_PUSH_GAIN = 0.85;

/**
 * Shortest signed delta between two angles (rad), wrapped to ±π.
 * Used by the smoothed-orientation low-pass so a fish turning past
 * Math.PI doesn't sweep the long way around (visible as a 360° spin).
 */
function _shortAngleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI)  d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

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
          ((0.04 * speedMul * orbitDir) / Math.max(0.5, orbitR / 8)) *
          (0.55 + rng() * 0.5);
        fish.userData.fishMidY = this._fishCenterY;
        fish.userData.baseScaleFactor = scale;
        fish.userData.growthScale = 1.0;

        // ── Realistic-motion state ────────────────────────────────────
        // Trout swim with burst-and-glide phases (tail beats hard → coasts
        // → beats again), bank into turns, pitch on depth change. We keep
        // these as per-fish CSS variables so they read like persistent
        // animal traits rather than uniform behaviour.
        fish.userData.glidePhase   = rng() * Math.PI * 2; // burst-glide offset
        fish.userData.gliderPeriod = 2.4 + rng() * 1.8;   // 2.4-4.2 s burst-glide cycle
        fish.userData.dartCooldown = 4 + rng() * 8;        // s until next dart
        fish.userData.dartT        = 0;                    // elapsed in current dart (0 = no dart)
        // Smoothed orientation — eulers are LOW-PASS-filtered toward target
        // angles each frame, otherwise yaw snaps look mechanical.
        fish.userData.smoothYaw   = 0;
        fish.userData.smoothPitch = 0;
        fish.userData.smoothRoll  = 0;
        fish.userData.prevY       = 0; // for pitch (depth-rate)

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

    // 30-minute pool reset: resets all fish growth scale back to 1.0
    this._poolResetTimer = (this._poolResetTimer || 0) + delta;
    if (this._poolResetTimer >= 1800) {
      this._poolResetTimer = 0;
      for (const fish of this._fishMeshes) {
        fish.userData.growthScale = 1.0;
      }
      console.log("%c[SanctuaryFish] 30-minute pool reset: all fish grown back to 100%!", "color:#4caf50;font-weight:bold;");
    }

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

      // Update growth scale: grow 1% per minute player is active
      if (ud.growthScale === undefined) {
        ud.growthScale = 1.0;
      }
      if (ud.growthScale < 1.0) {
        ud.growthScale += delta * (0.01 / 60.0);
        if (ud.growthScale > 1.0) {
          ud.growthScale = 1.0;
        }
      }

      // Dynamic scale sizing
      const baseScale = ud.baseScaleFactor || 1.0;
      const currentScale = baseScale * ud.growthScale;
      fish.scale.setScalar(currentScale);

      const isInterested = (typeof window !== "undefined" && window.__interestedFish === fish);

      if (isInterested) {
        const bPos = window.__sanctuaryBobberPos;
        if (bPos) {
          if (ud.isStruggling) {
            // Rapid wiggle & shake during struggle at hook position
            const shake = Math.sin(t * 45) * 0.04;
            fish.position.set(
              bPos.x + (Math.random() - 0.5) * 0.06,
              bPos.y - 0.14 + shake,
              bPos.z + (Math.random() - 0.5) * 0.06
            );
            fish.rotation.set(
              Math.sin(t * 30) * 0.35,
              Math.cos(t * 40) * 0.8,
              Math.sin(t * 35) * 0.35
            );
            
            // Spawn ripples as splash particles!
            if (Math.random() < 0.25 && typeof window !== "undefined" && window.__sanctuaryFishingSpawnRipple) {
              window.__sanctuaryFishingSpawnRipple(fish.position.x, fish.position.z);
            }
          } else {
            // Swim towards the lure!
            const targetX = bPos.x;
            const targetZ = bPos.z;
            const targetY = bPos.y - 0.14;
            
            const dx = targetX - fish.position.x;
            const dy = targetY - fish.position.y;
            const dz = targetZ - fish.position.z;
            const dist = Math.hypot(dx, dz);
            
            if (dist > 0.05) {
              const speed = 0.24 * delta; // slowed down by 80% (1.2 * 0.2)
              fish.position.x += (dx / dist) * speed;
              fish.position.z += (dz / dist) * speed;
              fish.position.y += dy * 2.0 * delta;
              
              // Smoothly face the lure in 3D space
              fish.lookAt(targetX, targetY, targetZ);
              // Add a bit of realistic swimming wiggle around its local yaw axis
              fish.rotateY(Math.sin(t * 1.6) * 0.15); // slowed down to match speed
            } else {
              fish.position.set(targetX, targetY, targetZ);
              fish.rotation.set(0, t * 0.4, 0); // slowed down idle rotation
            }
          }
        }
      } else {
        const R = ud.orbitR ?? SANCTUARY_POOL_RADIUS_M * 0.45;
        const orbitPhase = ud.orbitPhase ?? 0;

        // ── Burst-and-glide speed modulation ───────────────────────────
        // Real trout don't swim at constant speed — they push the tail
        // for 0.5-1 s then coast for 1-2 s. Encoded as a smoothed sin +
        // occasional 'dart' bursts when something startles them.
        const gp = ud.glidePhase ?? 0;
        const period = ud.gliderPeriod ?? 3.2;
        // Burst pulse: sin² so the peak is sustained, troughs are short.
        const burstRaw = Math.sin((tb * (Math.PI * 2)) / period + gp);
        const burst = burstRaw * burstRaw;          // 0..1, peak-biased
        const speedEnvelope = 0.55 + 0.85 * burst;   // 0.55..1.40

        // Dart event — occasional sudden acceleration (e.g. 1.6× normal)
        // that decays over ~1 s, then a cooldown of ~6-12 s.
        ud.dartCooldown -= delta;
        if (ud.dartCooldown <= 0 && ud.dartT <= 0) {
          ud.dartT = 1.0;                            // 1-second burst
          ud.dartCooldown = 6 + Math.random() * 6;
        }
        let dartK = 1;
        if (ud.dartT > 0) {
          ud.dartT -= delta;
          if (ud.dartT < 0) ud.dartT = 0;
          dartK = 1 + 0.6 * ud.dartT;                // 1.6 → 1.0
        }

        const speedMulNow = (ud.speedMul ?? 1) * speedEnvelope * dartK;
        const soloO = (ud.soloOmega ?? 0.16) * speedMulNow;
        const schOff = ud.schoolAngleOff ?? 0;
        const omegaSchool = SWIM_RATE_RAD_S * 0.55 * schoolStr * speedEnvelope * dartK;

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
            // Startle → trigger dart if not already mid-dart
            if (ud.dartT <= 0 && push > 0.4) ud.dartT = 0.8;
          }
        }

        // ── Position with depth excursions ─────────────────────────────
        // Two-frequency bob = lazy rise/fall + small ripple shimmer.
        // Burst phase amplifies bob slightly (fish push deeper on bursts).
        const midY = ud.fishMidY ?? this._fishCenterY;
        const lazyDip   = Math.sin(t * 0.22 + orbitPhase * 0.91) * 0.18;
        const shimmer   = Math.sin(t * 0.9  + orbitPhase * 2.17) * 0.06;
        const targetY   = midY + (ud.depthOffset ?? 0) + lazyDip + shimmer;
        fish.position.set(this._cx + lx, targetY, this._cz + lz);

        if (vx * vx + vz * vz > 1e-8) {
          // ── Yaw (direction of travel) with body S-curve wiggle ──────
          const baseYaw = Math.atan2(-vz, vx) + Math.PI;
          // Tail wag freq + amp scale with speed (faster swim → faster
          // wag, harder beats). Glide phase has lower amp.
          const wagFreq = 4.2 + 6.0 * burst;          // 4-10 Hz
          const wagAmp  = 0.10 + 0.18 * burst;        // 0.10-0.28 rad
          const wiggle  = Math.sin(t * wagFreq + (ud.wigglePhase ?? 0) * 4.7) * wagAmp;
          const targetYaw = baseYaw + wiggle;

          // ── Pitch from vertical velocity ────────────────────────────
          // Diving / rising tilts the nose. dy is per-frame so /delta gives
          // m/s; clamp to ±0.35 rad (about 20°).
          const dy = (ud.prevY !== undefined) ? (targetY - ud.prevY) : 0;
          ud.prevY = targetY;
          const verticalRate = delta > 0 ? dy / delta : 0;
          const targetPitch = Math.max(-0.35, Math.min(0.35, -verticalRate * 1.2));

          // ── Bank-into-the-turn roll ─────────────────────────────────
          // yaw delta this frame → angular velocity → roll = -k * ω
          // (positive yaw rate banks the fish to its inside, like a plane).
          const yawDelta = _shortAngleDelta(ud.smoothYaw, targetYaw);
          const yawRate  = delta > 0 ? yawDelta / delta : 0;
          const targetRoll = Math.max(-0.45, Math.min(0.45, -yawRate * 0.55));

          // ── Smooth (low-pass) toward target angles ──────────────────
          // Higher gain → snappier; lower → glassier. Tuned by eye.
          const yawGain   = 1 - Math.exp(-delta * 9);
          const pitchGain = 1 - Math.exp(-delta * 5);
          const rollGain  = 1 - Math.exp(-delta * 6);
          ud.smoothYaw   = ud.smoothYaw   + _shortAngleDelta(ud.smoothYaw, targetYaw) * yawGain;
          ud.smoothPitch = ud.smoothPitch + (targetPitch - ud.smoothPitch) * pitchGain;
          ud.smoothRoll  = ud.smoothRoll  + (targetRoll  - ud.smoothRoll)  * rollGain;

          fish.rotation.set(ud.smoothPitch, ud.smoothYaw, ud.smoothRoll);
        }
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
