/**
 * Sacred Adventures — sanctuary: SanctuaryFrogs
 *
 * Procedural implementation of frogs and lily pads with AI state machines.
 *
 * Elements:
 *   1. Lily Pads & Flowers: Flat cylinders with v-notches + procedural petal clusters.
 *   2. Frogs: Procedural geometry (green body, white belly, eyes, black smile).
 *
 * AI States:
 *   - SWIM: Moving in water, only eyes/top visible.
 *   - BASK_LILY: Resting on a lily pad.
 *   - BASK_SHORE: Resting on the shore.
 *   - FLEE: Jumps from shore to water/lily when player approaches.
 *   - JUMP: Parabolic motion between two points.
 *
 * Anu domain: FAUNA + FLORA
 */

import * as THREE from "three";
import { STRESS_LEVELS, getSystemStressLevel } from "../v2/anu/FrameBudget.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
  sanctuaryGroundY,
} from "./SanctuaryGround.js";

// ── Seeded LCG ────────────────────────────────────────────────────────────
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

const FROG_COUNT = 7;
/**
 * Extra "small" frogs — user-requested 2026-05-28: "ad 2 more small
 * frogs I dont seethem often." Spawned alongside the solo school but
 * at SMALL_FROG_SCALE so they read as tiny froglets. They share the
 * solo state machine (BASK / SWIM / JUMP / STRIKE) so no extra
 * update path is needed.
 */
const SMALL_FROG_COUNT = 3;
const SMALL_FROG_SCALE = 0.7;
const LILY_COUNT = 16;
const WATER_Y = -0.6; // Pool surface level
const FLEE_DIST_SQ = 3.5 * 3.5;
const MAX_JUMP = 1.5;

// States
const S_SWIM = 0;
const S_BASK_LILY = 1;
const S_JUMP = 3;
const S_STRIKE = 4;

// ── Friend-frog pair (user-requested 2026-05-28) ───────────────────
// Two extra frogs that behave as a buddy pair: leader picks a target,
// follower mirrors ~0.4s later, both bask/jump/swim together. Every
// ~12s they break from the lilies to chase the nearest fish for a
// few seconds (existing fish AI flees, that's the joke), then they
// return to a lily. Stored separately from `_frogs` so they don't
// fall under the solo-frog state machine.
// User-requested 2026-05-28: "remove the friend 2 frogs they look stupid".
// Setting count to 0 (rather than deleting the entire pair pipeline) keeps
// the state-machine code paths inert without touching every reference —
// the init loop, _updateFriendFrogPair, and _friendFrogs[] all become
// no-ops because every iterator / length check short-circuits at zero.
const FRIEND_FROG_COUNT = 0;
const FRIEND_FOLLOW_DELAY_S = 0.4;
const FRIEND_REST_MIN_S = 5.0;
const FRIEND_REST_MAX_S = 8.0;
const FRIEND_CHASE_INTERVAL_S = 12.0;  // seconds between chase events
const FRIEND_CHASE_DURATION_S = 4.5;
const FRIEND_SWIM_SPEED = 0.9;
// Pair modes
const PAIR_REST = 0;
const PAIR_JUMP = 1;
const PAIR_CHASE = 2;
const PAIR_RETURN = 3;

let _scene = null;
let _group = null;
let _frogs = [];
let _lilies = [];
let _clock = 0;
let _friendFrogs = [];       // length 2: [leader, follower]
let _friendPairTimer = 0;     // seconds in current mode
let _friendPairMode = PAIR_REST;
let _friendChaseClock = 0;    // ticks up while NOT chasing; reset on chase
let _friendLeaderTarget = new THREE.Vector3(); // shared target XYZ

// ── Geometries & Materials ────────────────────────────────────────────────

function _buildLilyPad(rand) {
  const group = new THREE.Group();
  
  // The Pad
  // We simulate a V-notch using a shape geometry
  const shape = new THREE.Shape();
  const r = 0.35 + rand() * 0.15;
  shape.absarc(0, 0, r, 0.2, Math.PI * 2 - 0.2, false);
  shape.lineTo(0, 0); // V notch
  
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.02,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.01,
    bevelThickness: 0.01
  });
  // Rotate to lie flat
  geo.rotateX(-Math.PI / 2);
  
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7cb342, // ethereal green
    roughness: 0.8,
    metalness: 0.1,
    flatShading: true
  });
  const pad = new THREE.Mesh(geo, mat);
  pad.castShadow = true;
  pad.receiveShadow = true;
  group.add(pad);

  // The Flower (70% chance to have a flower)
  if (rand() > 0.3) {
    const flower = new THREE.Group();
    const petalGeo = new THREE.SphereGeometry(0.06, 5, 2);
    petalGeo.scale(1, 0.2, 2.5); // flatten and stretch
    petalGeo.translate(0, 0, 0.08); // offset so they cluster

    // Gradient-like coloring: white with a hint of pink
    const petalMat = new THREE.MeshStandardMaterial({
      color: 0xffeef5,
      roughness: 0.9,
      metalness: 0.0,
      flatShading: true
    });

    const petals = 8 + Math.floor(rand() * 5);
    for (let p = 0; p < petals; p++) {
      const mesh = new THREE.Mesh(petalGeo, petalMat);
      mesh.rotation.y = (p / petals) * Math.PI * 2;
      mesh.rotation.x = 0.2 + rand() * 0.3; // tilt upward
      flower.add(mesh);
    }
    
    // Yellow center
    const centerGeo = new THREE.SphereGeometry(0.04, 5, 4);
    const centerMat = new THREE.MeshStandardMaterial({ color: 0xfbc02d });
    const center = new THREE.Mesh(centerGeo, centerMat);
    flower.add(center);

    flower.position.set((rand()-0.5)*r*0.6, 0.03, (rand()-0.5)*r*0.6);
    group.add(flower);
  }

  return group;
}

function _buildFrog() {
  const frog = new THREE.Group();
  frog.scale.set(0.8, 0.8, 0.8); // bigger so they're easy to spot (user 2026-06-02)

  // Colors
  const colGreen = 0x4a7c29; // natural green
  const colBelly = 0xffffe0; // white belly
  const colEye   = 0xffffff; // white eyes
  const colPupil = 0x111111;

  // Body: squashed sphere, tapered at front
  const bodyGeo = new THREE.SphereGeometry(0.08, 16, 12);
  bodyGeo.scale(1, 0.6, 1.3);
  const bodyMat = new THREE.MeshStandardMaterial({ color: colGreen, roughness: 0.8 });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.05;
  body.castShadow = true;
  frog.add(body);

  // Belly: bottom half of the body
  const bellyGeo = new THREE.SphereGeometry(0.078, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  bellyGeo.scale(1, 0.4, 1.25);
  const bellyMat = new THREE.MeshStandardMaterial({ color: colBelly, roughness: 0.9 });
  const belly = new THREE.Mesh(bellyGeo, bellyMat);
  belly.position.y = 0.04;
  belly.position.z = 0.01;
  belly.rotation.x = Math.PI; // point down
  frog.add(belly);

  // Eyes: white spheres with black pupils
  const eyeGeo = new THREE.SphereGeometry(0.025, 12, 12);
  const eyeMat = new THREE.MeshStandardMaterial({ color: colEye, roughness: 0.2 });
  const pupilGeo = new THREE.SphereGeometry(0.01, 8, 8);
  const pupilMat = new THREE.MeshStandardMaterial({ color: colPupil, roughness: 0.1 });

  // Left Eye
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.04, 0.09, 0.06);
  const pupilL = new THREE.Mesh(pupilGeo, pupilMat);
  pupilL.position.set(-0.01, 0.005, 0.02);
  eyeL.add(pupilL);
  frog.add(eyeL);

  // Right Eye
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.04, 0.09, 0.06);
  const pupilR = new THREE.Mesh(pupilGeo, pupilMat);
  pupilR.position.set(0.01, 0.005, 0.02);
  eyeR.add(pupilR);
  frog.add(eyeR);

  // Frog mouth: wide slit across the front
  const mouthGeo = new THREE.TorusGeometry(0.05, 0.003, 4, 16, Math.PI * 0.9);
  const mouthMat = new THREE.MeshBasicMaterial({ color: colPupil });
  const mouth = new THREE.Mesh(mouthGeo, mouthMat);
  mouth.position.set(0, 0.05, 0.1);
  mouth.rotation.x = Math.PI; 
  mouth.rotation.z = -Math.PI * 0.45;
  frog.add(mouth);

  // Tongue (hidden by default, stretches forward)
  const tongueGeo = new THREE.CylinderGeometry(0.015, 0.015, 1, 8);
  tongueGeo.translate(0, 0.5, 0); // origin at the base
  tongueGeo.rotateX(Math.PI / 2); // point forward along Z
  const tongueMat = new THREE.MeshBasicMaterial({ color: 0xcc3333 });
  const tongue = new THREE.Mesh(tongueGeo, tongueMat);
  tongue.position.set(0, 0.05, 0.1);
  tongue.scale.set(1, 1, 0.001); // collapsed
  tongue.visible = false;
  tongue.name = "tongue";
  frog.add(tongue);

  // Legs & Big Flipper Feet
  const legMat = new THREE.MeshStandardMaterial({ color: colGreen, roughness: 0.8 });
  const footGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.08, 3); // triangular flipper
  footGeo.scale(1, 0.1, 1); // flatten
  footGeo.rotateX(Math.PI / 2); // point forward

  // Hind Left Leg (folded) — named so animation loop can find + flex it.
  // Anchor hip a touch closer to body and use a longer thigh so the leg
  // reads as a "frog leg" rather than a stub (user-asked 2026-05-28:
  // "where are frog legs"). Default crouch pose, animation extends.
  const thighGeo = new THREE.CapsuleGeometry(0.014, 0.085, 4, 8);
  const legHL = new THREE.Mesh(thighGeo, legMat);
  legHL.name = "leg_hind_L";
  legHL.position.set(-0.075, 0.035, -0.045);
  legHL.rotation.x = Math.PI / 2;
  legHL.rotation.z = Math.PI / 4;
  legHL.userData.basePose = {
    x: Math.PI / 2,
    y: 0,
    z: Math.PI / 4,
  };

  const footHL = new THREE.Mesh(footGeo, legMat);
  footHL.position.set(0, -0.05, 0.05);
  footHL.rotation.x = -Math.PI / 2;
  footHL.rotation.z = -Math.PI / 4;
  legHL.add(footHL);
  frog.add(legHL);

  // Hind Right Leg (folded)
  const legHR = new THREE.Mesh(thighGeo, legMat);
  legHR.name = "leg_hind_R";
  legHR.position.set(0.075, 0.035, -0.045);
  legHR.rotation.x = Math.PI / 2;
  legHR.rotation.z = -Math.PI / 4;
  legHR.userData.basePose = {
    x: Math.PI / 2,
    y: 0,
    z: -Math.PI / 4,
  };

  const footHR = new THREE.Mesh(footGeo, legMat);
  footHR.position.set(0, -0.05, 0.05);
  footHR.rotation.x = -Math.PI / 2;
  footHR.rotation.z = Math.PI / 4;
  legHR.add(footHR);
  frog.add(legHR);

  // Front Left Leg
  const armGeo = new THREE.CapsuleGeometry(0.01, 0.04, 4, 8);
  const armL = new THREE.Mesh(armGeo, legMat);
  armL.name = "leg_front_L";
  armL.position.set(-0.06, 0.03, 0.08);
  armL.rotation.x = Math.PI / 6;
  armL.userData.basePose = { x: Math.PI / 6, y: 0, z: 0 };

  const footFL = new THREE.Mesh(footGeo, legMat);
  footFL.position.set(0, -0.03, 0.02);
  footFL.rotation.x = -Math.PI / 6;
  armL.add(footFL);
  frog.add(armL);

  // Front Right Leg
  const armR = new THREE.Mesh(armGeo, legMat);
  armR.name = "leg_front_R";
  armR.position.set(0.06, 0.03, 0.08);
  armR.rotation.x = Math.PI / 6;
  armR.userData.basePose = { x: Math.PI / 6, y: 0, z: 0 };

  const footFR = new THREE.Mesh(footGeo, legMat);
  footFR.position.set(0, -0.03, 0.02);
  footFR.rotation.x = -Math.PI / 6;
  armR.add(footFR);
  frog.add(armR);

  // Cache the four limb refs on the group for cheap per-frame access.
  frog.userData.limbs = {
    hindL:  legHL,
    hindR:  legHR,
    frontL: armL,
    frontR: armR,
  };

  return frog;
}

/**
 * Animate the frog's four limbs based on its current state.
 *   • JUMP:  hind legs EXTEND back at takeoff, TUCK during arc apex,
 *            REACH forward to land. Front arms tuck during flight.
 *   • SWIM:  alternating hind-leg breaststroke kick (~3 Hz) +
 *            front arms held loosely. Speed scales with f.swimSpeed.
 *   • BASK/SIT: drift gently back to the resting base pose.
 *
 * Called from the per-frog update loop with the live state and t∈[0,1]
 * jump progress (-1 if not jumping). Operates purely on rotation so
 * there's no allocation per frame.
 */
function _animateFrogLimbs(f, state, t, clock) {
  const limbs = f.group?.userData?.limbs;
  if (!limbs) return;
  const { hindL, hindR, frontL, frontR } = limbs;
  if (!hindL || !hindR || !frontL || !frontR) return;

  if (state === S_JUMP || state === S_STRIKE) {
    // Hind-leg extension curve: legs SHOOT BACK at takeoff (t≈0–0.15),
    // TUCK toward body during arc (t≈0.3–0.7), REACH forward for
    // landing (t≈0.85–1). Pi-pulse approximation via two cosines.
    const tt = Math.max(0, Math.min(1, t));
    // extension: -1 (tucked) → +1 (extended back). At takeoff push back,
    // mid-arc tuck, end-arc push forward.
    const ext = (tt < 0.2)
      ? 1.0 - (tt / 0.2)       // 1 → 0  push back, then release
      : (tt < 0.7)
        ? -(tt - 0.2) / 0.5    //  0 → -1 tuck under body
        :  (tt - 0.85) / 0.15 - 1; // -1 → 0 reach forward
    // Apply: positive ext = thigh rotates DOWN (toes back).
    const baseX = Math.PI / 2;
    hindL.rotation.x = baseX + ext * 0.9;
    hindR.rotation.x = baseX + ext * 0.9;
    // Splay slightly on extension so it reads as a kick not a stab.
    hindL.rotation.z = (Math.PI / 4)  + ext * 0.25;
    hindR.rotation.z = (-Math.PI / 4) - ext * 0.25;
    // Front arms tuck against chest in flight.
    const tuck = 0.8;
    frontL.rotation.x = (Math.PI / 6) + tuck * (1 - Math.abs(ext));
    frontR.rotation.x = (Math.PI / 6) + tuck * (1 - Math.abs(ext));
    return;
  }

  if (state === S_SWIM) {
    // Breaststroke kick: ~3 Hz extend/retract on hind legs, alternating
    // slightly between L/R so it's not stiff-symmetrical.
    const omega = (1.5 + (f.swimSpeed || 0.5) * 2.0); // Hz scaled by speed
    const kick = Math.sin(clock * Math.PI * 2 * omega);
    const kickR = Math.sin(clock * Math.PI * 2 * omega + 0.35);
    const baseX = Math.PI / 2;
    hindL.rotation.x = baseX + kick  * 0.6;
    hindR.rotation.x = baseX + kickR * 0.6;
    hindL.rotation.z = (Math.PI / 4)  + kick  * 0.15;
    hindR.rotation.z = (-Math.PI / 4) + kickR * 0.15;
    // Front arms paddle small + out of phase with hind.
    const armWave = Math.sin(clock * Math.PI * 2 * omega + Math.PI);
    frontL.rotation.x = (Math.PI / 6) + armWave * 0.2;
    frontR.rotation.x = (Math.PI / 6) - armWave * 0.2;
    return;
  }

  // Default (BASK_LILY etc.): drift back to base pose at ~6/s.
  const k = 0.15;
  for (const limb of [hindL, hindR, frontL, frontR]) {
    const b = limb.userData.basePose;
    if (!b) continue;
    limb.rotation.x += (b.x - limb.rotation.x) * k;
    limb.rotation.y += (b.y - limb.rotation.y) * k;
    limb.rotation.z += (b.z - limb.rotation.z) * k;
  }
}

// ── AI Logic ──────────────────────────────────────────────────────────────

function _getRandomLilyPos(rand, currentPos, outVec) {
  const out = outVec || new THREE.Vector3();
  if (!currentPos || _lilies.length === 0) {
    if (_lilies.length > 0) {
      const pad = _lilies[Math.floor(rand() * _lilies.length)];
      return out.set(pad.position.x, WATER_Y + 0.02, pad.position.z);
    } else {
      return _getRandomWaterPos(rand, currentPos, out);
    }
  }
  
  // Find a pad within jump range
  let validPads = [];
  for (const pad of _lilies) {
     const d = pad.position.distanceTo(currentPos);
     if (d > 0.1 && d <= MAX_JUMP * 2) {
       validPads.push(pad);
     }
  }

  if (validPads.length > 0) {
     const pad = validPads[Math.floor(rand() * validPads.length)];
     return out.set(pad.position.x, WATER_Y + 0.02, pad.position.z);
  }
  
  // No nearby pads, jump to water instead
  return _getRandomWaterPos(rand, currentPos, out);
}

// Removed S_BASK_SHORE and _getRandomShorePos entirely.

function _getRandomWaterPos(rand, currentPos, outVec) {
  const out = outVec || new THREE.Vector3();
  if (!currentPos) {
    const a = rand() * Math.PI * 2;
    const r = rand() * (SANCTUARY_POOL_RADIUS_M - 0.5);
    const x = SANCTUARY_POOL_CENTER_X + Math.cos(a) * r;
    const z = SANCTUARY_POOL_CENTER_Z + Math.sin(a) * r;
    return out.set(x, WATER_Y + 0.02, z); // FROG-RESTORE: float at the surface (was -0.08 → submerged/invisible)
  }

  const a = rand() * Math.PI * 2;
  const d = 0.5 + rand() * MAX_JUMP;
  let x = currentPos.x + Math.cos(a) * d;
  let z = currentPos.z + Math.sin(a) * d;
  
  // Ensure we stay safely inside the water boundaries to prevent disappearing off-map
  const dx = x - SANCTUARY_POOL_CENTER_X;
  const dz = z - SANCTUARY_POOL_CENTER_Z;
  const distFromCenter = Math.hypot(dx, dz);
  if (distFromCenter > SANCTUARY_POOL_RADIUS_M - 0.8) {
     const inA = Math.atan2(dz, dx);
     const inR = SANCTUARY_POOL_RADIUS_M - 0.8;
     x = SANCTUARY_POOL_CENTER_X + Math.cos(inA) * inR;
     z = SANCTUARY_POOL_CENTER_Z + Math.sin(inA) * inR;
  }
  return out.set(x, WATER_Y + 0.02, z); // FROG-RESTORE: float at the surface (was -0.08 → submerged/invisible)
}


function _startJump(f, targetPos, jumpTime) {
  f.state = S_JUMP;
  f.startPos.copy(f.group.position);
  f.endPos.copy(targetPos);
  f.timer = 0;
  f.duration = jumpTime;
  // Orient toward target
  f.group.lookAt(targetPos.x, f.group.position.y, targetPos.z);
}

/**
 * Clear the near-hook frog event if it belongs to this frog — called
 * whenever the frog leaves the lily pad (flee, timer jump, being eaten).
 */
function _clearFrogEvent(f) {
  if (typeof window !== "undefined" && window.__sanctuaryFrogOnLily?.frogObj === f) {
    window.__sanctuaryFrogOnLily = null;
  }
}

// Pre-allocated static vectors for Layer 3 Zero-Allocation
const _staticFrogDir = new THREE.Vector3();
const _staticTempVec = new THREE.Vector3();
let _lastFrogFrameCount = 0;

export const SanctuaryFrogsModule = {
  name: "SanctuaryFrogs",

  async load(scene) {
    _scene = scene;
    _group = new THREE.Group();
    _group.name = "sanctuary_frogs";
    _group.userData.anuId = "environment.sanctuary.frogs";
    _lilies = [];
    _frogs = [];
    _clock = 0;

    const rand = lcg(123);

    // 1. LILY PADS — reuse the beautiful multicoloured ones from
    // SanctuaryPool.js instead of building duplicate low-poly pads.
    // User-requested 2026-05-28: "just use the beautiful multicolored
    // lilies get rid of the other ones. Make sure frogs use the new
    // ones." SanctuaryPool.js publishes its full lily-pad mesh list
    // on window.__sanctuaryLilyPads after buildLilyPads runs.
    if (typeof window !== "undefined" && Array.isArray(window.__sanctuaryLilyPads) && window.__sanctuaryLilyPads.length > 0) {
      _lilies = window.__sanctuaryLilyPads.slice();
      console.log(
        `%c[SanctuaryFrogs] 🪷 Reusing ${_lilies.length} multi-colour lily pads from SanctuaryPool (no duplicate low-poly pads).`,
        "color:#a5d6a7;",
      );
    }

    if (typeof window !== "undefined") {
      window.__sanctuaryFrogsRegenerate = () => {
        if (Array.isArray(window.__sanctuaryLilyPads) && window.__sanctuaryLilyPads.length > 0) {
          _lilies = window.__sanctuaryLilyPads.slice();
          console.log("[SanctuaryFrogs] 🐸 Re-aligned frog target lily pads list!");
          const rL = lcg(456);
          for (const f of _frogs) {
            if (f.state === S_BASK_LILY) {
              f.group.position.copy(_getRandomLilyPos(rL, null));
            }
          }
          for (let i = 0; i < _friendFrogs.length; i++) {
            const ff = _friendFrogs[i];
            const startPad = _lilies[Math.min(i, _lilies.length - 1)];
            if (startPad) {
              ff.group.position.set(
                startPad.position.x + (i === 0 ? -0.15 : 0.15),
                WATER_Y + 0.08,
                startPad.position.z + (i === 0 ? -0.15 : 0.15),
              );
            }
          }
        }
      };
    }

    if (typeof window !== "undefined" && Array.isArray(window.__sanctuaryLilyPads) && window.__sanctuaryLilyPads.length > 0) {
      // already slice-handled above
    } else {
      // Fallback: SanctuaryPool hasn't loaded (boot order edge case).
      // Build the legacy low-poly pads so frogs still have somewhere
      // to land. Logged as a warning so we notice if this fires.
      console.warn(
        "[SanctuaryFrogs] window.__sanctuaryLilyPads not present — falling back to legacy pad build. Pool module load-order issue?",
      );
      for (let i = 0; i < LILY_COUNT; i++) {
        const pad = _buildLilyPad(rand);
        const a = rand() * Math.PI * 2;
        const r = rand() * (SANCTUARY_POOL_RADIUS_M - 1.5);
        const px = SANCTUARY_POOL_CENTER_X + Math.cos(a) * r;
        const pz = SANCTUARY_POOL_CENTER_Z + Math.sin(a) * r;
        pad.position.set(px, WATER_Y + 0.01, pz);
        pad.rotation.y = rand() * Math.PI * 2;
        _lilies.push(pad);
        _group.add(pad);
      }
    }

    // 2. Initialize Frogs (regular + small)
    const TOTAL_FROGS = FROG_COUNT + SMALL_FROG_COUNT;
    for (let i = 0; i < TOTAL_FROGS; i++) {
      const isSmall = i >= FROG_COUNT;
      const group = _buildFrog();
      if (isSmall) {
        // Tiny froglet — same model + state machine, just scaled down
        // so the kid spots them between the regulars (2026-05-28 ask).
        group.scale.setScalar(SMALL_FROG_SCALE);
        group.userData.isSmallFrog = true;
      }
      const isLily = rand() > 0.5;

      const f = {
        group,
        state: isLily ? S_BASK_LILY : S_SWIM,
        timer: rand() * 5.0,
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        duration: 0,
        swimSpeed: (0.5 + rand() * 0.5) * (isSmall ? 1.15 : 1.0), // small frogs paddle slightly faster
        targetYaw: 0,
        isSmall,
      };

      if (isLily) {
        group.position.copy(_getRandomLilyPos(rand, null));
      } else {
        group.position.copy(_getRandomWaterPos(rand, null));
      }
      group.rotation.y = rand() * Math.PI * 2;

      _frogs.push(f);
      _group.add(group);
    }

    if (typeof window !== "undefined") window.__sanctuaryFrogs = _frogs;

    // 3. Initialize FRIEND-FROG pair (leader + follower)
    _friendFrogs = [];
    _friendPairMode = PAIR_REST;
    _friendPairTimer = FRIEND_REST_MIN_S + rand() * (FRIEND_REST_MAX_S - FRIEND_REST_MIN_S);
    _friendChaseClock = 0;
    for (let i = 0; i < FRIEND_FROG_COUNT; i++) {
      const fg = _buildFrog();
      // Tint the leader slightly warmer / the follower slightly cooler so kids can tell them apart
      fg.traverse((ch) => {
        if (ch.isMesh && ch.material && ch.material.color) {
          ch.material = ch.material.clone();
          if (i === 0) {
            ch.material.color = ch.material.color.clone().lerp(new THREE.Color(0xcfd96b), 0.35); // warm chartreuse
          } else {
            ch.material.color = ch.material.color.clone().lerp(new THREE.Color(0x6bcfd9), 0.30); // cool teal-green
          }
        }
      });
      // Spawn on different starting lilies, ~0.7m apart
      const startPad = _lilies[Math.min(i, _lilies.length - 1)];
      if (startPad) {
        fg.position.set(
          startPad.position.x + (i === 0 ? -0.15 : 0.15),
          WATER_Y + 0.08,
          startPad.position.z + (i === 0 ? -0.15 : 0.15),
        );
      }
      fg.rotation.y = rand() * Math.PI * 2;
      fg.name = i === 0 ? "sanctuary_frog_friend_leader" : "sanctuary_frog_friend_follower";

      const ff = {
        group: fg,
        // own jump state — modeled like solo frogs
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        duration: 0,
        timer: 0,
        isAirborne: false,
        // follower-only: delay before mirroring leader's command
        followCue: null, // { mode, target, atClock }
      };
      _friendFrogs.push(ff);
      _group.add(fg);
    }

    scene.add(_group);
    console.log(
      `%c[SanctuaryFrogs] 🐸 Photoreal frogs online — ${FROG_COUNT} solo + ${SMALL_FROG_COUNT} small (buddy-pair retired 2026-05-28). Lilies: reused from SanctuaryPool.`,
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update(dt, frameCount, scene, camera) {
    if (!dt || !_group) return;

    // Prioritized Bypassing & Stride Governor: skips frames under stress but maintains a % sampling so as not to freeze entirely.
    const stress = getSystemStressLevel();
    let stride = 1;
    if (stress === STRESS_LEVELS.CRITICAL) {
      stride = 6; // 16.7% sampling to bypass bottleneck without freezing entirely
    } else if (stress === STRESS_LEVELS.STRESS) {
      stride = 2; // 50% sampling
    }
    const ticks = frameCount !== undefined ? frameCount : ++_lastFrogFrameCount;
    if (ticks % stride !== 0) {
      return;
    }

    const scaledDt = dt * stride;
    _clock += scaledDt;

    // Lily pad bobbing — when reusing SanctuaryPool's pads (the typical
    // path now per the 2026-05-28 consolidation), the pool module owns
    // the wave-follow integrator (getWaveHeight in SanctuaryPool.js)
    // and we MUST NOT also bob the pads or the two writers fight each
    // frame. Only bob if we fell back to the legacy own-built pads
    // (signalled by missing the shared global at load time).
    const ownsBobbing = (typeof window === "undefined")
      || !Array.isArray(window.__sanctuaryLilyPads);
    if (ownsBobbing) {
      for (let i = 0; i < _lilies.length; i++) {
        _lilies[i].position.y = WATER_Y + 0.01 + Math.sin(_clock * 1.5 + i) * 0.005;
        _lilies[i].rotation.x = Math.sin(_clock * 1.0 + i) * 0.02;
        _lilies[i].rotation.z = Math.cos(_clock * 1.2 + i) * 0.02;
      }
    }

    const rand = Math.random;
    
    // Get player position
    let playerPos = null;
    if (window.WorldPlayer && window.WorldPlayer.feet) {
      playerPos = window.WorldPlayer.feet;
    }

    for (const f of _frogs) {
      // Bobbing while on lily or in water
      if (f.state === S_BASK_LILY || f.state === S_SWIM) {
        // match the lily pad bob, or water bob
        f.group.position.y += Math.sin(_clock * 4.0) * 0.0005;
      }

      // Per-frog limb animation — runs every state (basking drifts back
      // to pose, swim breaststroke kick, jump extend-tuck-reach).
      // jumpT only valid during JUMP/STRIKE; use -1 otherwise.
      const jumpT = (f.state === S_JUMP || f.state === S_STRIKE)
        ? (f.duration > 0 ? Math.min(1, f.timer / f.duration) : 0)
        : -1;
      _animateFrogLimbs(f, f.state, jumpT, _clock);

      if (f.state === S_JUMP) {
        f.timer += scaledDt;
        const t = Math.min(1.0, f.timer / f.duration);
        
        // Linear interpolation XZ
        f.group.position.lerpVectors(f.startPos, f.endPos, t);
        
        // Realistic Physics / Gravity Parabola: y = startY + (endY-startY)*t + height*sin(t*pi)
        const height = Math.max(0.3, f.startPos.distanceTo(f.endPos) * 0.4); // higher jump arc
        const baseHeight = f.startPos.y + (f.endPos.y - f.startPos.y) * t;
        f.group.position.y = baseHeight + Math.sin(t * Math.PI) * height;
        
        // Pitch rotation during jump (point up, then point down)
        f.group.rotation.x = (0.5 - t) * 1.5;

        if (t >= 1.0) {
          // Landed
          f.group.position.copy(f.endPos);
          f.group.rotation.x = 0;

          // Determine landing state based on Y coordinate
          if (Math.abs(f.endPos.y - WATER_Y) < 0.05) {
            f.state = S_BASK_LILY; // landed on a pad
            f.timer = 30.0; // Rest for 30 seconds

            // ── Near-hook broadcast ──────────────────────────────────
            // If fishing is active and this lily pad is within 2.5 m of
            // the bobber (XZ), alert nearby fish to try to eat the frog.
            if (typeof window !== "undefined" && window.__sanctuaryBobberPos) {
              const bp = window.__sanctuaryBobberPos;
              const dxH = f.group.position.x - bp.x;
              const dzH = f.group.position.z - bp.z;
              if (Math.hypot(dxH, dzH) < 2.5) {
                window.__sanctuaryFrogOnLily = {
                  frogGroup: f.group,
                  frogObj:   f,
                  lilyPos:   f.group.position.clone(),
                  eaten:     false,
                };
                console.log(
                  "%c[SanctuaryFrogs] 🐸 Frog landed on lily NEAR HOOK — fish alert!",
                  "color:#a5d6a7;font-weight:bold;",
                );
              }
            }
          } else {
            f.state = S_SWIM;
            f.timer = 2.0 + rand() * 4.0; // rest for 2-6s in water
            // They just landed in water, give them a target to swim towards
            _getRandomWaterPos(rand, f.group.position, f.endPos);
          }
        }
      } 
      else if (f.state === S_BASK_LILY) {
        f.timer -= scaledDt;

        // Flee logic!
        if (playerPos) {
          const d2 = f.group.position.distanceToSquared(playerPos);
          if (d2 < FLEE_DIST_SQ) {
            // Frog panics and jumps back into water
            _clearFrogEvent(f);
            _getRandomWaterPos(rand, f.group.position, _staticTempVec);
            _startJump(f, _staticTempVec, 0.6); // fast panic jump
            continue;
          }
        }

        // Dragonfly tracking & hunting
        let nearestDF = null;
        let minDistSq = Infinity;
        if (window.__sanctuaryDragonflies) {
          for (let df of window.__sanctuaryDragonflies) {
            if (!df.alive) continue;
            const dSq = f.group.position.distanceToSquared(df.sprite.position);
            if (dSq < minDistSq) {
              minDistSq = dSq;
              nearestDF = df;
            }
          }
        }

        if (nearestDF) {
          // Slowly turn to look at nearest dragonfly
          const dfPos = nearestDF.sprite.position;
          const targetYaw = Math.atan2(dfPos.x - f.group.position.x, dfPos.z - f.group.position.z);
          const angleDiff = targetYaw - f.group.rotation.y;
          const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
          f.group.rotation.y += normalizedDiff * scaledDt * 2.0; // slow turn

          const distMeters = Math.sqrt(minDistSq);
          // 1 foot = ~0.3m, 2 feet = ~0.6m
          
          let shouldStrike = false;
          if (distMeters < 0.3 && Math.abs(normalizedDiff) < 0.3) {
            // Within 1 foot and directly in front: 100% chance
            shouldStrike = true;
          } else if (distMeters < 0.6) {
            // Within 2 feet: 1% chance per frame (approx)
            if (rand() < 0.01) shouldStrike = true;
          }

          if (shouldStrike) {
            // STRIKE!
            _clearFrogEvent(f);
            f.state = S_STRIKE;
            f.timer = 0;
            f.duration = 0.5; // half second strike animation
            f.targetDF = nearestDF;

            // Immediately jump to the water
            f.startPos.copy(f.group.position);
            _getRandomWaterPos(rand, f.group.position, f.endPos);
            
            // "Eat" the dragonfly
            nearestDF.alive = false;
            nearestDF.respawnTimer = 2.0;
            continue;
          }
        }

        if (f.timer <= 0) {
          // Decide next action after 30s rest
          _clearFrogEvent(f);
          const roll = rand();
          if (roll > 0.4) {
            _getRandomLilyPos(rand, f.group.position, _staticTempVec);
          } else {
            _getRandomWaterPos(rand, f.group.position, _staticTempVec);
          }
          _startJump(f, _staticTempVec, 0.8);
        }
      }
      else if (f.state === S_STRIKE) {
        f.timer += scaledDt;
        const t = Math.min(1.0, f.timer / f.duration);
        
        // Jump arc toward the water
        f.group.position.lerpVectors(f.startPos, f.endPos, t);
        const height = Math.max(0.3, f.startPos.distanceTo(f.endPos) * 0.4); 
        const baseHeight = f.startPos.y + (f.endPos.y - f.startPos.y) * t;
        f.group.position.y = baseHeight + Math.sin(t * Math.PI) * height;
        f.group.rotation.x = (0.5 - t) * 1.5;

        // Tongue stretch logic
        const tongue = f.group.getObjectByName("tongue");
        if (tongue) {
          tongue.visible = true;
          if (t < 0.5) {
            // Shoot out tongue
            const pt = t * 2.0; // 0 to 1
            // Tongue needs to point to where the dragonfly WAS
            if (f.targetDF) {
               const dfPos = f.targetDF.sprite.position;
               const dist = f.group.position.distanceTo(dfPos);
               tongue.scale.set(1, 1, dist * pt / 0.6); // 0.6 is frog scale
               
               // The dragonfly gets stuck to the tongue
               f.targetDF.sprite.position.lerpVectors(dfPos, f.group.position, pt * 0.5);
            }
          } else {
            // Retract tongue
            const pt = (1.0 - t) * 2.0; // 1 to 0
            tongue.scale.set(1, 1, Math.max(0.001, pt * 2.0));
            if (f.targetDF) {
               f.targetDF.sprite.position.copy(f.group.position);
               f.targetDF.sprite.position.y += 0.05; // in mouth
            }
          }
        }

        if (t >= 1.0) {
          f.group.position.copy(f.endPos);
          f.group.rotation.x = 0;
          f.state = S_SWIM;
          f.timer = 3.0 + rand() * 4.0;
          _getRandomWaterPos(rand, f.group.position, f.endPos);
          if (tongue) tongue.visible = false;
          f.targetDF = null;
          
          // Tiny splash and big ripple!
          if (window.sanctuaryPulse) {
            window.sanctuaryPulse(f.group.position.x, f.group.position.z);
          }
        }
      }
      else if (f.state === S_SWIM) {
        f.timer -= scaledDt;
        
        // Swim towards target
        const dir = _staticFrogDir.subVectors(f.endPos, f.group.position);
        dir.y = 0;
        const dist = dir.length();
        
        if (dist < 0.2 || f.timer <= 0) {
          // Time to rest or switch path
          const roll = rand();
          if (roll < 0.3) {
            _getRandomLilyPos(rand, f.group.position, _staticTempVec);
            _startJump(f, _staticTempVec, 0.6);
          } else {
            _getRandomWaterPos(rand, f.group.position, f.endPos);
            f.timer = 2 + rand() * 3;
          }
        } else {
          dir.normalize();
          f.group.position.addScaledVector(dir, f.swimSpeed * scaledDt);
          // FROG-RESTORE: float at the surface while swimming (was WATER_Y-0.08,
          // which pinned every swimming frog ~8 cm UNDER the opaque water each
          // frame → 6 of 7 frogs read as "missing"). Keep the gentle bob.
          f.group.position.y = WATER_Y + 0.02 + Math.sin(_clock * 10.0) * 0.01;
          
          // Face direction of swimming
          const targetYaw = Math.atan2(dir.x, dir.z);
          const angleDiff = targetYaw - f.group.rotation.y;
          const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
          f.group.rotation.y += normalizedDiff * scaledDt * 5.0;
        }
      }
    }

    // ── Friend-frog pair update (buddy behaviour) ─────────────────────
    _updateFriendFrogPair(scaledDt);
  },

  unload() {
    if (_group && this._scene) this._scene.remove(_group);
    _group = null;
    _scene = null;
    _frogs = [];
    _lilies = [];
    _friendFrogs = [];
    _friendPairMode = PAIR_REST;
    _friendPairTimer = 0;
    _friendChaseClock = 0;
  }
};

// ── Friend-frog pair: leader/follower state machine ──────────────────
// Modes:
//   REST   — both frogs idle on a lily pad. After 5–8s pick a new
//            target lily, fire JUMP for both (follower delayed 0.4s).
//   JUMP   — both frogs airborne (one then the other) toward the
//            shared target. Completes when both have landed.
//   CHASE  — every FRIEND_CHASE_INTERVAL_S, both frogs hop in and
//            swim toward the nearest fish for FRIEND_CHASE_DURATION_S
//            (existing fish AI flees on its own). Returns to REST.
//   RETURN — heading back to a lily after a chase.

const _ffScratchA = new THREE.Vector3();
const _ffScratchB = new THREE.Vector3();

function _updateFriendFrogPair(dt) {
  if (!_friendFrogs || _friendFrogs.length < 2) return;
  const leader = _friendFrogs[0];
  const follower = _friendFrogs[1];
  if (!leader.group || !follower.group) return;

  _friendPairTimer -= dt;

  // Tick the rest-clock toward a chase event
  if (_friendPairMode === PAIR_REST) {
    _friendChaseClock += dt;
  }

  // Mode transition: REST → JUMP or CHASE
  if (_friendPairMode === PAIR_REST && _friendPairTimer <= 0 && !leader.isAirborne && !follower.isAirborne) {
    // Time to do something. ~25% of the time when chase-clock has
    // matured, pick a fish to chase; otherwise hop to a new lily.
    if (_friendChaseClock >= FRIEND_CHASE_INTERVAL_S && _pickNearestFish(_friendLeaderTarget)) {
      _friendPairMode = PAIR_CHASE;
      _friendPairTimer = FRIEND_CHASE_DURATION_S;
      _friendChaseClock = 0;
    } else {
      // Pick a random lily as the new target
      if (_lilies.length > 0) {
        const pad = _lilies[Math.floor(Math.random() * _lilies.length)];
        _friendLeaderTarget.copy(pad.position);
        _friendPairMode = PAIR_JUMP;
        _friendPairTimer = 1.2; // safety timeout — jumps usually finish well under this
        // Leader jumps NOW
        _startFriendJump(leader, _friendLeaderTarget, 0.7);
        // Follower jumps after the delay (we'll trigger it when delay expires)
        follower.followCue = { atClock: _clock + FRIEND_FOLLOW_DELAY_S, target: _friendLeaderTarget.clone() };
      }
    }
  }

  // Trigger follower's delayed jump cue
  if (follower.followCue && _clock >= follower.followCue.atClock) {
    _startFriendJump(follower, follower.followCue.target, 0.7);
    follower.followCue = null;
  }

  // Integrate per-frog motion based on state
  _stepFriendFrog(leader, dt);
  _stepFriendFrog(follower, dt);

  // Mode transition: JUMP completes when both have landed
  if (_friendPairMode === PAIR_JUMP && !leader.isAirborne && !follower.isAirborne && !follower.followCue) {
    _friendPairMode = PAIR_REST;
    _friendPairTimer = FRIEND_REST_MIN_S + Math.random() * (FRIEND_REST_MAX_S - FRIEND_REST_MIN_S);
  }

  // CHASE mode: both swim toward the target (follower trails leader by ~0.6m)
  if (_friendPairMode === PAIR_CHASE) {
    // Re-pick nearest fish every 0.8s for live targeting (cheap)
    if (Math.random() < dt * 1.25) _pickNearestFish(_friendLeaderTarget);

    _swimFriendToward(leader, _friendLeaderTarget, dt, FRIEND_SWIM_SPEED);
    // Follower trails the leader's CURRENT position (not the target) so they read as following
    _ffScratchB.copy(leader.group.position);
    _swimFriendToward(follower, _ffScratchB, dt, FRIEND_SWIM_SPEED * 0.92);

    if (_friendPairTimer <= 0) {
      // Chase over — head back to a random lily
      if (_lilies.length > 0) {
        const pad = _lilies[Math.floor(Math.random() * _lilies.length)];
        _friendLeaderTarget.copy(pad.position);
      }
      _friendPairMode = PAIR_RETURN;
      _friendPairTimer = 4.0;
    }
  }

  // RETURN mode: swim back to a lily, then enter REST
  if (_friendPairMode === PAIR_RETURN) {
    _swimFriendToward(leader, _friendLeaderTarget, dt, FRIEND_SWIM_SPEED);
    _ffScratchB.copy(leader.group.position);
    _swimFriendToward(follower, _ffScratchB, dt, FRIEND_SWIM_SPEED * 0.92);

    // Arrival check — leader within 0.4m of lily, or timeout
    _ffScratchA.copy(_friendLeaderTarget).sub(leader.group.position);
    _ffScratchA.y = 0;
    if (_ffScratchA.lengthSq() < 0.16 || _friendPairTimer <= 0) {
      // Snap onto the lily
      leader.group.position.set(_friendLeaderTarget.x - 0.12, WATER_Y + 0.08, _friendLeaderTarget.z - 0.12);
      follower.group.position.set(_friendLeaderTarget.x + 0.12, WATER_Y + 0.08, _friendLeaderTarget.z + 0.12);
      _friendPairMode = PAIR_REST;
      _friendPairTimer = FRIEND_REST_MIN_S + Math.random() * (FRIEND_REST_MAX_S - FRIEND_REST_MIN_S);
    }
  }
}

function _startFriendJump(ff, target, duration) {
  ff.startPos.copy(ff.group.position);
  ff.endPos.copy(target);
  // Lily targets have Y at water level; aim a bit above so the frog lands on top
  ff.endPos.y = WATER_Y + 0.08;
  ff.duration = duration;
  ff.timer = 0;
  ff.isAirborne = true;
}

function _stepFriendFrog(ff, dt) {
  if (!ff.isAirborne) return;
  ff.timer += dt;
  const t = Math.min(1, ff.timer / ff.duration);
  // Parabolic arc
  const arcHeight = Math.max(0.25, ff.startPos.distanceTo(ff.endPos) * 0.35);
  const yArc = 4 * arcHeight * t * (1 - t);
  ff.group.position.x = ff.startPos.x + (ff.endPos.x - ff.startPos.x) * t;
  ff.group.position.z = ff.startPos.z + (ff.endPos.z - ff.startPos.z) * t;
  ff.group.position.y = ff.startPos.y + (ff.endPos.y - ff.startPos.y) * t + yArc;
  // Face the direction of travel
  const dx = ff.endPos.x - ff.startPos.x;
  const dz = ff.endPos.z - ff.startPos.z;
  if (dx * dx + dz * dz > 0.0001) {
    ff.group.rotation.y = Math.atan2(dx, dz);
  }
  // Pitch: head-up on takeoff, head-down on descent
  ff.group.rotation.x = -Math.sin(t * Math.PI) * 0.35 + (t - 0.5) * 0.4;
  if (t >= 1) {
    ff.isAirborne = false;
    ff.group.rotation.x = 0;
  }
}

function _swimFriendToward(ff, target, dt, speed) {
  // Float at the waterline + tiny bob so they read as swimming, not flying
  _ffScratchA.copy(target).sub(ff.group.position);
  _ffScratchA.y = 0;
  const d = _ffScratchA.length();
  if (d > 0.02) {
    _ffScratchA.multiplyScalar(speed * dt / d);
    ff.group.position.x += _ffScratchA.x;
    ff.group.position.z += _ffScratchA.z;
  }
  ff.group.position.y = WATER_Y + 0.04 + Math.sin(_clock * 3 + ff.group.position.x) * 0.015;
  // Face direction of motion
  if (d > 0.05) {
    const yaw = Math.atan2(target.x - ff.group.position.x, target.z - ff.group.position.z);
    const diff = yaw - ff.group.rotation.y;
    const norm = Math.atan2(Math.sin(diff), Math.cos(diff));
    ff.group.rotation.y += norm * dt * 6.0;
  }
}

function _pickNearestFish(outVec) {
  const school = typeof window !== "undefined" ? window.__sanctuaryFishSchool : null;
  if (!school || !school.length || !_friendFrogs[0]?.group) return false;
  const fromX = _friendFrogs[0].group.position.x;
  const fromZ = _friendFrogs[0].group.position.z;
  let best = null;
  let bestD = Infinity;
  for (const f of school) {
    if (!f?.position) continue;
    const dx = f.position.x - fromX;
    const dz = f.position.z - fromZ;
    const dSq = dx * dx + dz * dz;
    if (dSq < bestD) { bestD = dSq; best = f; }
  }
  if (!best) return false;
  outVec.set(best.position.x, WATER_Y, best.position.z);
  return true;
}
