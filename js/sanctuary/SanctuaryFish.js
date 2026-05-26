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
// User spec May-25 2026: "Fish will slowly avoid player if closer than
// 2 feet — they will run away if player steps on them."
// 2 feet ≈ 0.61 m — start the soft avoidance there. Below 0.25 m
// (player essentially standing on the fish), apply a much stronger
// flee impulse via PLAYER_STEPON_RADIUS_M / PLAYER_STEPON_GAIN.
const PLAYER_AVOID_RADIUS_M = 2 * 0.3048;     // 2 feet ≈ 0.61 m
const PLAYER_STEPON_RADIUS_M = 0.25;          // step-on threshold
const PLAYER_PUSH_GAIN = 0.40;                // gentle slow drift
const PLAYER_STEPON_GAIN = 1.8;               // hard flee burst

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

        // ── Head-locked locomotion (May-25 2026 koi refactor) ─────────
        // Fish move ONLY in the direction their head points. heading is
        // the canonical yaw (atan2 convention where 0 → facing +X). Per
        // frame we (1) compute a DESIRED heading from orbit + bobber +
        // player, (2) smoothly turn heading toward it (angular-rate
        // limited so no spin-snaps), (3) integrate position along the
        // CURRENT heading × speed. Sideways / backwards motion is
        // structurally impossible.
        fish.userData.heading = (i / FISH_COUNT) * Math.PI * 2;
        // ── Personality (May-25 2026 koi refactor) ────────────────────
        // 12 fish split 4 curious / 4 cautious / 4 indifferent.
        const _PERSONALITIES = ["curious", "cautious", "indifferent"];
        const personality = _PERSONALITIES[i % 3];
        fish.userData.personality = personality;
        fish.userData.anuKind = `sanctuary_fish_${personality}`;
        fish.userData.curiosityRadius = personality === "curious" ? 4.5
                                       : personality === "cautious" ? 2.5
                                       : 0;
        fish.userData.fleeRadius = personality === "curious" ? 0.7
                                  : personality === "cautious" ? 1.6
                                  : 0;
        fish.userData.reactState = "idle";
        fish.userData.reactT = 0;

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
        // ════════════════════════════════════════════════════════════════
        // INDEPENDENT FORWARD SWIMMING (Wander & Avoid)
        // Each fish moves strictly forward along its current heading, and
        // smoothly turns toward its target heading. This completely breaks
        // the rigid schooling/orbit logic.
        // ════════════════════════════════════════════════════════════════
        
        // 1. Initialize custom independent AI vars if missing
        if (ud._wanderTargetHeading === undefined) {
          ud._wanderTargetHeading = Math.random() * Math.PI * 2;
          ud._currentHeading = Math.random() * Math.PI * 2;
          ud._turnTimer = 0;
          ud._swimSpeed = 0.15 * (ud.speedMul ?? 1.0);
        }
        
        // 2. Periodic target heading updates (random wandering)
        ud._turnTimer -= delta;
        if (ud._turnTimer <= 0) {
          ud._wanderTargetHeading += (Math.random() - 0.5) * 1.5; // gentle random turn
          ud._turnTimer = 2.0 + Math.random() * 4.0;
        }

        // 3. Pool boundary avoidance (steer back to center if too close to edge)
        const dxFromCenter = fish.position.x - this._cx;
        const dzFromCenter = fish.position.z - this._cz;
        const distFromCenter = Math.hypot(dxFromCenter, dzFromCenter);
        const MAX_R = SANCTUARY_POOL_RADIUS_M * 0.85; // keep inside pool
        
        if (distFromCenter > MAX_R) {
          // Force target heading towards the pool center
          const angleToCenter = Math.atan2(-dzFromCenter, -dxFromCenter);
          ud._wanderTargetHeading = angleToCenter;
        }

        // 4. Player Avoidance
        let avoidSpeedMultiplier = 1.0;
        if (playerX !== null && playerZ !== null) {
          const dxP = fish.position.x - playerX;
          const dzP = fish.position.z - playerZ;
          const dP = Math.hypot(dxP, dzP);
          if (dP < PLAYER_AVOID_RADIUS_M && dP > 1e-3) {
            // Steer away from player
            const angleAway = Math.atan2(dzP, dxP);
            ud._wanderTargetHeading = angleAway;
            
            // Speed up if stepped on!
            if (dP < PLAYER_STEPON_RADIUS_M) {
              avoidSpeedMultiplier = 3.5;
            } else {
              avoidSpeedMultiplier = 1.8;
            }
          }
        }

        // 5. Smoothly rotate current heading toward target heading
        // Shortest angle delta
        let hDiff = ud._wanderTargetHeading - ud._currentHeading;
        while (hDiff > Math.PI) hDiff -= Math.PI * 2;
        while (hDiff < -Math.PI) hDiff += Math.PI * 2;
        
        const turnSpeed = 1.2 * delta; // rad/s turn rate
        if (Math.abs(hDiff) > turnSpeed) {
          ud._currentHeading += Math.sign(hDiff) * turnSpeed;
        } else {
          ud._currentHeading = ud._wanderTargetHeading;
        }

        // Wrap heading cleanly
        while (ud._currentHeading > Math.PI) ud._currentHeading -= Math.PI * 2;
        while (ud._currentHeading < -Math.PI) ud._currentHeading += Math.PI * 2;

        // 6. Move forward!
        const currentSpeed = ud._swimSpeed * avoidSpeedMultiplier * delta;
        fish.position.x += Math.cos(ud._currentHeading) * currentSpeed;
        fish.position.z += Math.sin(ud._currentHeading) * currentSpeed;

        // 7. Depth Bobbing
        const orbitPhase = ud.orbitPhase ?? 0;
        const midY = ud.fishMidY ?? this._fishCenterY;
        const bobY = Math.sin(t * 0.9 + orbitPhase * 2.17) * 0.14;
        fish.position.y = midY + (ud.depthOffset ?? 0) + bobY;

        // Occasionally ripple the surface when bobbing near the top
        // Greatly reduced probability (was 1.8) to prevent FPS death from ripple overflow
        if (bobY > 0.10 && Math.random() < 0.08 * delta) {
          if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
            window.sanctuaryPulse(fish.position.x, fish.position.z);
          }
        }

        // 8. Visual Rotation (Heading + natural wiggle)
        // atan2 is naturally oriented, but we add Math.PI if the fish model 
        // faces -X natively. If the model faces +X naturally, we just use heading.
        // The original code used: Math.atan2(-vz, vx) + Math.PI
        const wiggleAmp = 0.22;
        const wiggle = Math.sin(t * 6.5 + (ud.wigglePhase ?? 0) * 4.7) * wiggleAmp;
        fish.rotation.set(0, -ud._currentHeading + Math.PI + wiggle, 0);

        // Render-order trick (user spec): "fish have higher z-index than
        // player circle in case they are in water."
        if (fish.renderOrder !== 5) fish.renderOrder = 5;
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
