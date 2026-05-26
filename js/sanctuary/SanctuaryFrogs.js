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

const FROG_COUNT = 2;
const LILY_COUNT = 16;
const WATER_Y = -0.6; // Pool surface level
const FLEE_DIST_SQ = 3.5 * 3.5;
const MAX_JUMP = 1.5;

// States
const S_SWIM = 0;
const S_BASK_LILY = 1;
const S_JUMP = 3;
const S_STRIKE = 4;

let _scene = null;
let _group = null;
let _frogs = [];
let _lilies = [];
let _clock = 0;

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
  frog.scale.set(0.6, 0.6, 0.6); // smaller frog model

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

  // Hind Left Leg (folded)
  const thighGeo = new THREE.CapsuleGeometry(0.015, 0.06, 4, 8);
  const legHL = new THREE.Mesh(thighGeo, legMat);
  legHL.position.set(-0.08, 0.04, -0.05);
  legHL.rotation.x = Math.PI / 2;
  legHL.rotation.z = Math.PI / 4;
  
  const footHL = new THREE.Mesh(footGeo, legMat);
  footHL.position.set(0, -0.04, 0.04);
  footHL.rotation.x = -Math.PI / 2;
  footHL.rotation.z = -Math.PI / 4;
  legHL.add(footHL);
  frog.add(legHL);

  // Hind Right Leg (folded)
  const legHR = new THREE.Mesh(thighGeo, legMat);
  legHR.position.set(0.08, 0.04, -0.05);
  legHR.rotation.x = Math.PI / 2;
  legHR.rotation.z = -Math.PI / 4;

  const footHR = new THREE.Mesh(footGeo, legMat);
  footHR.position.set(0, -0.04, 0.04);
  footHR.rotation.x = -Math.PI / 2;
  footHR.rotation.z = Math.PI / 4;
  legHR.add(footHR);
  frog.add(legHR);

  // Front Left Leg
  const armGeo = new THREE.CapsuleGeometry(0.01, 0.04, 4, 8);
  const armL = new THREE.Mesh(armGeo, legMat);
  armL.position.set(-0.06, 0.03, 0.08);
  armL.rotation.x = Math.PI / 6;

  const footFL = new THREE.Mesh(footGeo, legMat);
  footFL.position.set(0, -0.03, 0.02);
  footFL.rotation.x = -Math.PI / 6;
  armL.add(footFL);
  frog.add(armL);

  // Front Right Leg
  const armR = new THREE.Mesh(armGeo, legMat);
  armR.position.set(0.06, 0.03, 0.08);
  armR.rotation.x = Math.PI / 6;

  const footFR = new THREE.Mesh(footGeo, legMat);
  footFR.position.set(0, -0.03, 0.02);
  footFR.rotation.x = -Math.PI / 6;
  armR.add(footFR);
  frog.add(armR);

  return frog;
}

// ── AI Logic ──────────────────────────────────────────────────────────────

function _getRandomLilyPos(rand, currentPos) {
  if (!currentPos || _lilies.length === 0) {
    if (_lilies.length > 0) {
      const pad = _lilies[Math.floor(rand() * _lilies.length)];
      return new THREE.Vector3(pad.position.x, WATER_Y + 0.02, pad.position.z);
    } else {
      return _getRandomWaterPos(rand, currentPos);
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
     return new THREE.Vector3(pad.position.x, WATER_Y + 0.02, pad.position.z);
  }
  
  // No nearby pads, jump to water instead
  return _getRandomWaterPos(rand, currentPos);
}

// Removed S_BASK_SHORE and _getRandomShorePos entirely.

function _getRandomWaterPos(rand, currentPos) {
  if (!currentPos) {
    const a = rand() * Math.PI * 2;
    const r = rand() * (SANCTUARY_POOL_RADIUS_M - 0.5);
    const x = SANCTUARY_POOL_CENTER_X + Math.cos(a) * r;
    const z = SANCTUARY_POOL_CENTER_Z + Math.sin(a) * r;
    return new THREE.Vector3(x, WATER_Y - 0.08, z);
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
  return new THREE.Vector3(x, WATER_Y - 0.08, z);
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

    // 1. Scatter Lily Pads
    for (let i = 0; i < LILY_COUNT; i++) {
      const pad = _buildLilyPad(rand);
      
      // Scatter anywhere inside the pool, keeping them away from the shore edge
      const a = rand() * Math.PI * 2;
      const r = rand() * (SANCTUARY_POOL_RADIUS_M - 1.5); 
      const px = SANCTUARY_POOL_CENTER_X + Math.cos(a) * r;
      const pz = SANCTUARY_POOL_CENTER_Z + Math.sin(a) * r;
      
      pad.position.set(px, WATER_Y + 0.01, pz);
      pad.rotation.y = rand() * Math.PI * 2;
      
      _lilies.push(pad);
      _group.add(pad);
    }

    // 2. Initialize Frogs
    for (let i = 0; i < FROG_COUNT; i++) {
      const group = _buildFrog();
      const isLily = rand() > 0.5;
      
      const f = {
        group,
        state: isLily ? S_BASK_LILY : S_SWIM,
        timer: rand() * 5.0, // wait time before next action
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        duration: 0,
        swimSpeed: 0.5 + rand() * 0.5,
        targetYaw: 0
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

    scene.add(_group);
    console.log("%c[SanctuaryFrogs] 🐸 Photoreal frogs & Lilies online.", "color:#a5d6a7;font-weight:bold;");
  },

  update(dt, frameCount, scene, camera) {
    if (!dt || !_group) return;
    _clock += dt;

    // Gentle lily pad bobbing
    for (let i = 0; i < _lilies.length; i++) {
      _lilies[i].position.y = WATER_Y + 0.01 + Math.sin(_clock * 1.5 + i) * 0.005;
      _lilies[i].rotation.x = Math.sin(_clock * 1.0 + i) * 0.02;
      _lilies[i].rotation.z = Math.cos(_clock * 1.2 + i) * 0.02;
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

      if (f.state === S_JUMP) {
        f.timer += dt;
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
          } else {
            f.state = S_SWIM;
            f.timer = 2.0 + rand() * 4.0; // rest for 2-6s in water
            // They just landed in water, give them a target to swim towards
            f.endPos.copy(_getRandomWaterPos(rand, f.group.position));
          }
        }
      } 
      else if (f.state === S_BASK_LILY) {
        f.timer -= dt;

        // Flee logic!
        if (playerPos) {
          const d2 = f.group.position.distanceToSquared(playerPos);
          if (d2 < FLEE_DIST_SQ) {
            // Frog panics and jumps back into water
            const target = _getRandomWaterPos(rand, f.group.position);
            _startJump(f, target, 0.6); // fast panic jump
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
          f.group.rotation.y += normalizedDiff * dt * 2.0; // slow turn

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
            f.state = S_STRIKE;
            f.timer = 0;
            f.duration = 0.5; // half second strike animation
            f.targetDF = nearestDF;
            
            // Immediately jump to the water
            f.startPos.copy(f.group.position);
            f.endPos.copy(_getRandomWaterPos(rand, f.group.position));
            
            // "Eat" the dragonfly
            nearestDF.alive = false;
            nearestDF.respawnTimer = 2.0;
            continue;
          }
        }

        if (f.timer <= 0) {
          // Decide next action after 30s rest
          const roll = rand();
          const target = roll > 0.4 ? _getRandomLilyPos(rand, f.group.position) : _getRandomWaterPos(rand, f.group.position);
          _startJump(f, target, 0.8);
        }
      }
      else if (f.state === S_STRIKE) {
        f.timer += dt;
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
          f.endPos.copy(_getRandomWaterPos(rand, f.group.position));
          if (tongue) tongue.visible = false;
          f.targetDF = null;
          
          // Tiny splash and big ripple!
          if (window.sanctuaryPulse) {
            window.sanctuaryPulse(f.group.position.x, f.group.position.z);
          }
        }
      }
      else if (f.state === S_SWIM) {
        f.timer -= dt;
        
        // Swim towards target
        const dir = new THREE.Vector3().subVectors(f.endPos, f.group.position);
        dir.y = 0;
        const dist = dir.length();
        
        if (dist < 0.2 || f.timer <= 0) {
          // Time to rest or switch path
          const roll = rand();
          if (roll < 0.3) {
            _startJump(f, _getRandomLilyPos(rand, f.group.position), 0.6);
          } else {
            f.endPos.copy(_getRandomWaterPos(rand, f.group.position));
            f.timer = 2 + rand() * 3;
          }
        } else {
          dir.normalize();
          f.group.position.addScaledVector(dir, f.swimSpeed * dt);
          // Gently submerge/emerge while swimming
          f.group.position.y = WATER_Y - 0.08 + Math.sin(_clock * 10.0) * 0.01;
          
          // Face direction of swimming
          const targetYaw = Math.atan2(dir.x, dir.z);
          const angleDiff = targetYaw - f.group.rotation.y;
          const normalizedDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
          f.group.rotation.y += normalizedDiff * dt * 5.0;
        }
      }
    }
  },

  unload() {
    if (_group && this._scene) this._scene.remove(_group);
    _group = null;
    _scene = null;
    _frogs = [];
    _lilies = [];
  }
};
