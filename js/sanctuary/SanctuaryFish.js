/**
 * Sacred Adventures — sanctuary part 4 of 5: THE FISH.
 *
 * Loads `Assets/Fish/fish.obj` (same trout mesh as v2 Pool2), bakes the
 * 3DS Max Z-up export upright, and swims with velocity-based orbital
 * physics: head leads the path, body wiggles on yaw, gentle depth bob.
 */

import * as THREE from "three";
import { STRESS_LEVELS, getSystemStressLevel } from "../v2/anu/FrameBudget.js";
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

/**
 * Two dangling frog legs — added as a child of the fish mesh when it
 * catches a frog. Positions are in the fish's local space; the group
 * scales from 1 → 0 as the fish digests at the bottom.
 */
function _buildFrogLegs() {
  const group = new THREE.Group();
  group.name = "frog_legs";
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a7c29, roughness: 0.8 });
  const thighGeo = new THREE.CapsuleGeometry(0.012, 0.06, 4, 6);
  const shinGeo  = new THREE.CapsuleGeometry(0.009, 0.07, 4, 6);
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(thighGeo, mat);
    // Sit near the fish's mouth (local +Z ≈ front for this model)
    thigh.position.set(side * 0.045, -0.018, 0.12);
    thigh.rotation.x =  0.6;  // angle backward-down
    thigh.rotation.z =  side * 0.3;
    const shin = new THREE.Mesh(shinGeo, mat);
    shin.position.set(0, -0.07, 0.02);
    shin.rotation.x = -0.9;  // dangle below
    thigh.add(shin);
    group.add(thigh);
  }
  return group;
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

let _lastFrameCount = 0;

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

      // ── Baby fish spawner ─────────────────────────────────────────
      // Called from SanctuaryFishing when a fish is caught.
      // Spawns a tiny replacement fish (1/10 scale) that grows 10%/min.
      const _module = this;
      window.__sanctuarySpawnBabyFish = function (x, z) {
        if (!_module._root || !_module._fishGeometry || !_module._fishMaterial) {
          console.warn("[SanctuaryFish] Cannot spawn baby fish — not ready");
          return null;
        }
        const waterY =
          typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
            ? window.__sanctuaryWaterY
            : -0.05;
        const baseScale = FISH_TARGET_LENGTH_M / fg.fishLen;
        const baby = new THREE.Mesh(_module._fishGeometry, _module._fishMaterial);
        baby.castShadow = false;
        baby.receiveShadow = false;
        const idx = _module._fishMeshes.length;
        baby.name = `sanctuary_baby_fish_${idx}`;
        baby.userData.anuId = `fauna.sanctuary.baby_fish.${Date.now()}`;
        baby.userData.anuKind = "sanctuary_baby_fish";
        baby.userData.isBabyFish = true;
        baby.userData.growthScale = 0.1;
        baby.userData.baseScaleFactor = baseScale;
        baby.userData.fishMidY = waterY - 0.08; // swim near surface so player sees them
        baby.userData.depthOffset = 0;
        baby.userData.orbitPhase = Math.random() * Math.PI * 2;
        baby.userData.wigglePhase = Math.random() * Math.PI * 2;
        baby.userData.speedMul = 0.8 + Math.random() * 0.4;
        // Pre-init wander AI so no undefined check needed in update()
        baby.userData._wanderTargetHeading = Math.random() * Math.PI * 2;
        baby.userData._currentHeading = baby.userData._wanderTargetHeading;
        baby.userData._turnTimer = 0;
        baby.userData._swimSpeed = 0.18 * baby.userData.speedMul;
        baby.scale.setScalar(baseScale * 0.1); // start tiny
        baby.position.set(
          x ?? _module._cx,
          waterY - 0.08,
          z ?? _module._cz,
        );
        _module._root.add(baby);
        _module._fishMeshes.push(baby);
        window.__sanctuaryFishSchool = _module._fishMeshes;
        window.__sanctuaryFishCount = _module._fishMeshes.length;
        console.log(
          `%c[SanctuaryFish] 🐣 Baby fish spawned at (${x?.toFixed(2)}, ${z?.toFixed(2)})`,
          "color:#2b6ffe;",
        );
        return baby;
      };

      console.log(
        `%c[Sanctuary] 🐟 ${FISH_COUNT} fish.obj trout — upright, velocity swim (target ${FISH_TARGET_LENGTH_M} m).`,
        "color:#2b6ffe;font-weight:bold;",
      );
    } catch (err) {
      console.warn("[SanctuaryFish] fish.obj load failed:", err);
    }
  },

  update(delta, frameCount) {
    if (!this._fishMeshes.length) return;

    // Prioritized Bypassing & Stride Governor: skips frames under stress but maintains a % sampling so as not to freeze entirely.
    const stress = getSystemStressLevel();
    let stride = 1;
    if (stress === STRESS_LEVELS.CRITICAL) {
      stride = 6; // 16.7% sampling to bypass bottleneck without freezing entirely
    } else if (stress === STRESS_LEVELS.STRESS) {
      stride = 2; // 50% sampling
    }
    const ticks = frameCount !== undefined ? frameCount : ++_lastFrameCount;
    if (ticks % stride !== 0) {
      return;
    }

    this._elapsed += delta * stride;
    this._fishBioTime += delta * stride;
    const tb = this._fishBioTime;
    const t = this._elapsed;

    // 30-minute pool reset: resets all fish growth scale back to 1.0
    this._poolResetTimer = (this._poolResetTimer || 0) + delta * stride;
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

      // Update growth scale: baby fish grow 10%/min, adult fish 1%/min
      if (ud.growthScale === undefined) {
        ud.growthScale = ud.isBabyFish ? 0.1 : 1.0;
      }
      if (ud.growthScale < 1.0) {
        const growRate = ud.isBabyFish ? (0.10 / 60.0) : (0.01 / 60.0);
        ud.growthScale += delta * growRate;
        if (ud.growthScale > 1.0) ud.growthScale = 1.0;
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
            // ── Interest behaviour: jump arc → horizontal approach ──
            // Fish jumps out of the water with a splash, then swims
            // horizontally toward the lure — always facing the hook,
            // Y clamped below the surface so they never "fly".
            const targetX = bPos.x;
            const targetZ = bPos.z;
            const waterSurfaceY =
              typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
                ? window.__sanctuaryWaterY
                : -0.05;

            const dx = targetX - fish.position.x;
            const dz = targetZ - fish.position.z;
            const dist = Math.hypot(dx, dz);

            // Initialise interest state on the first frame interested.
            // Baby fish skip the jump — they're too small to breach the surface.
            if (!ud._interestPhase) {
              if (ud.isBabyFish) {
                ud._interestPhase = "approach"; // no jump for tiny fish
              } else {
                ud._interestPhase = "jump";
                ud._jumpTimer = 0;
                ud._jumpPeakSplashed = false;
                // Entry ripple at the fish's current position
                if (typeof window !== "undefined" && window.__sanctuaryFishingSpawnRipple) {
                  window.__sanctuaryFishingSpawnRipple(fish.position.x, fish.position.z);
                }
              }
            }

            if (ud._interestPhase === "jump") {
              const JUMP_DURATION = 0.55;
              ud._jumpTimer += delta;
              const jumpFrac = Math.min(1.0, ud._jumpTimer / JUMP_DURATION);
              // Sine arc — peak height 0.28 m above water surface
              const jumpHeight = Math.sin(jumpFrac * Math.PI) * 0.28;
              fish.position.y = waterSurfaceY + jumpHeight;

              // Drift gently toward the lure during the arc
              if (dist > 0.1) {
                fish.position.x += (dx / dist) * 0.06 * delta;
                fish.position.z += (dz / dist) * 0.06 * delta;
              }

              // Face the lure (Y-axis only — no pitch)
              if (dist > 0.01) {
                const heading = Math.atan2(dz, dx);
                fish.rotation.set(0, -heading + Math.PI, 0);
              }

              // Peak splash at ~50% of arc
              if (!ud._jumpPeakSplashed && jumpFrac > 0.45) {
                ud._jumpPeakSplashed = true;
                if (typeof window !== "undefined" && window.__sanctuaryFishingSpawnRipple) {
                  window.__sanctuaryFishingSpawnRipple(fish.position.x, fish.position.z);
                }
              }

              if (ud._jumpTimer >= JUMP_DURATION) {
                ud._interestPhase = "approach";
                // Landing splash
                if (typeof window !== "undefined" && window.__sanctuaryFishingSpawnRipple) {
                  window.__sanctuaryFishingSpawnRipple(fish.position.x, fish.position.z);
                }
              }
            } else {
              // Approach phase: swim horizontally toward lure, stay just below surface
              if (dist > 0.05) {
                const speed = 0.29 * delta;
                fish.position.x += (dx / dist) * speed;
                fish.position.z += (dz / dist) * speed;
              } else {
                fish.position.x = targetX;
                fish.position.z = targetZ;
              }

              // Smooth Y toward just-below surface (visible to player)
              const approachY = waterSurfaceY - 0.10;
              fish.position.y += (approachY - fish.position.y) * Math.min(1.0, 5.0 * delta);
              // Hard clamp: never above surface
              if (fish.position.y > waterSurfaceY - 0.04) fish.position.y = waterSurfaceY - 0.04;

              // Face the lure — Y-axis rotation only, no pitch (no flying look)
              if (dist > 0.01) {
                const heading = Math.atan2(dz, dx);
                const wiggle = Math.sin(t * 3.5) * 0.08;
                fish.rotation.set(0, -heading + Math.PI + wiggle, 0);
              }
            }
          }
        }
      } else {
        // Reset interest state when fish is no longer interested
        if (ud._interestPhase) {
          ud._interestPhase = null;
          ud._jumpTimer = 0;
          ud._jumpPeakSplashed = false;
        }

        // ── Frog-eat state machine ────────────────────────────────────
        // Triggered when a frog lands on a lily near the hook and this
        // fish rolled >25% to go for it.  Phases: approach → chomp →
        // dive → eat_bottom → rise → (back to normal wander).
        if (ud._frogEatState) {
          const fe = ud._frogTarget;
          ud._frogEatTimer = (ud._frogEatTimer || 0) + delta;

          if (ud._frogEatState === 'approach') {
            // Abort if another fish already ate the frog
            if (!fe || fe.eaten) {
              ud._frogEatState = null; ud._frogTarget = null;
            } else {
              const fp = fe.lilyPos;
              const dxF = fp.x - fish.position.x;
              const dzF = fp.z - fish.position.z;
              const distF = Math.hypot(dxF, dzF);
              if (distF > 0.12) {
                const spd = 0.40 * delta;
                fish.position.x += (dxF / distF) * spd;
                fish.position.z += (dzF / distF) * spd;
                // Rise to just below water surface toward the frog
                const tgtY = (fp.y ?? this._fishCenterY) - 0.05;
                fish.position.y += (tgtY - fish.position.y) * Math.min(1, 4.0 * delta);
                const hdg = Math.atan2(dzF, dxF);
                fish.rotation.set(0, -hdg + Math.PI, 0);
              } else if (!fe.eaten) {
                // CHOMP — first fish to arrive wins
                fe.eaten = true;
                if (fe.frogGroup) fe.frogGroup.visible = false;
                ud._frogLegs = _buildFrogLegs();
                fish.add(ud._frogLegs);
                if (typeof window !== "undefined" && window.sanctuaryPulse) {
                  window.sanctuaryPulse(fp.x, fp.z);
                }
                ud._frogEatState = 'chomp';
                ud._frogEatTimer = 0;
              } else {
                ud._frogEatState = null; ud._frogTarget = null;
              }
            }
          } else if (ud._frogEatState === 'chomp') {
            // Rapid wiggle for 0.35 s
            fish.rotation.y += Math.sin(ud._frogEatTimer * 28) * 0.6 * delta;
            if (ud._frogEatTimer >= 0.35) {
              ud._frogEatState = 'dive'; ud._frogEatTimer = 0;
            }
          } else if (ud._frogEatState === 'dive') {
            // Swim down to pool bottom over 1.6 s
            const bottomY = this._fishCenterY - 0.55;
            fish.position.y += (bottomY - fish.position.y) * Math.min(1, 2.8 * delta);
            if (ud._frogLegs) ud._frogLegs.rotation.z = Math.sin(ud._frogEatTimer * 9) * 0.45;
            if (ud._frogEatTimer >= 1.6) {
              ud._frogEatState = 'eat_bottom'; ud._frogEatTimer = 0;
            }
          } else if (ud._frogEatState === 'eat_bottom') {
            // Pause at bottom 1.0 s — shrink legs to 0
            if (ud._frogLegs) {
              const s = Math.max(0, 1.0 - ud._frogEatTimer);
              ud._frogLegs.scale.setScalar(s);
            }
            if (ud._frogEatTimer >= 1.0) {
              if (ud._frogLegs) {
                fish.remove(ud._frogLegs);
                ud._frogLegs.traverse(o => o.geometry?.dispose?.());
                ud._frogLegs = null;
              }
              ud._frogEatState = 'rise'; ud._frogEatTimer = 0;
              // Clear the global frog event so others stop tracking it
              if (typeof window !== "undefined" && window.__sanctuaryFrogOnLily?.eaten) {
                window.__sanctuaryFrogOnLily = null;
              }
            }
          } else if (ud._frogEatState === 'rise') {
            // Float back to normal swim depth over 2 s
            const normalY = ud.fishMidY ?? this._fishCenterY;
            fish.position.y += (normalY - fish.position.y) * Math.min(1, 1.8 * delta);
            if (ud._frogEatTimer >= 2.0) {
              ud._frogEatState = null; ud._frogTarget = null; ud._frogEatTimer = 0;
            }
          } else {
            ud._frogEatState = null;
          }
          // Skip normal wander while eating
          if (fish.renderOrder !== 5) fish.renderOrder = 5;
          continue;
        }

        // ── Roll for new frog target ──────────────────────────────────
        // When a frog lands on a lily near the hook, eligible fish within
        // 3 m each get a 30 % chance to chase it.
        const _frogEvt = typeof window !== "undefined" ? window.__sanctuaryFrogOnLily : null;
        if (!ud.isBabyFish && _frogEvt && !_frogEvt.eaten && !ud._frogEatState) {
          const fp = _frogEvt.lilyPos;
          if (fp) {
            const dfx = fp.x - fish.position.x;
            const dfz = fp.z - fish.position.z;
            if (Math.hypot(dfx, dfz) < 3.0 && Math.random() < 0.30) {
              ud._frogEatState = 'approach';
              ud._frogEatTimer = 0;
              ud._frogTarget = _frogEvt;
            }
          }
        }

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
          ud._swimSpeed = 0.18 * (ud.speedMul ?? 1.0);
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

        // 6b. HARD BOUNDARY CLAMP — defense in depth. Step 3 above sets
        // `_wanderTargetHeading` toward center when distance > MAX_R, but
        // step 4 (player avoidance) OVERWRITES that with `angleAway` from
        // the player. If the player is between the fish and the pool
        // center, "away from player" points OUTWARD and at flee speed
        // (up to 3.5× swim speed) the fish crosses the boundary before
        // the gradual heading rotation (1.2 rad/s) can turn it around.
        // Once XZ is past the pool radius, fish Y still sits at water
        // level — well below the bank terrain — so the fish appears to
        // "disappear into the ground." This clamp projects the position
        // back to the boundary circle and resets both the current and
        // target heading inward, so the next frame can't re-escape.
        const dxClamp = fish.position.x - this._cx;
        const dzClamp = fish.position.z - this._cz;
        const distClamp = Math.hypot(dxClamp, dzClamp);
        if (distClamp > MAX_R) {
          const k = MAX_R / distClamp;
          fish.position.x = this._cx + dxClamp * k;
          fish.position.z = this._cz + dzClamp * k;
          ud._currentHeading = Math.atan2(-dzClamp, -dxClamp);
          ud._wanderTargetHeading = ud._currentHeading;
        }

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
        const wiggleAmp = 0.10;
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
