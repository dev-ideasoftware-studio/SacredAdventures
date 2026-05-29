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
/** Trout school size. Bumped 12 → 18 on 2026-05-28 ("add more fish").
 *  Each trout currently costs <1 FPS at the bench so the extra six
 *  are cheap; a future InstancedMesh refactor (filed earlier) would
 *  drop the whole school to one draw call regardless of count. */
const FISH_COUNT = 18;
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

function _createProceduralKoiTexture(index) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");

  // Determine Koi style based on index
  const styles = ["kohaku", "sanke", "showa", "tancho", "ogon"];
  const style = styles[index % styles.length];

  // Base background and shading parameters
  let baseColor = "#fffefb"; // Pearlescent White
  let roughness = 0.25;
  let metalness = 0.15;

  if (style === "showa") {
    baseColor = "#151515"; // Matte sumi black
    roughness = 0.3;
    metalness = 0.2;
  } else if (style === "ogon") {
    baseColor = "#ffb300"; // Rich metallic yellow-gold
    roughness = 0.18;
    metalness = 0.8; // High metallic reflection!
  }

  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 512);

  // Custom deterministic RNG per fish
  const rng = mulberry32(0xe2a81900 + index * 997);

  if (style === "ogon") {
    // Make Ogon texture ultra metallic with nice gold gradients
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0, "#ffe082");
    grad.addColorStop(0.5, "#ffb300");
    grad.addColorStop(1.0, "#ff8f00");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle shiny scale highlights
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 3;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.ellipse(256, 256, 40 + i * 36, 15 + i * 18, Math.PI / 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    // Red/orange organic spot patterns
    if (style === "kohaku" || style === "sanke" || style === "showa" || style === "tancho") {
      const redCount = style === "tancho" ? 1 : Math.floor(3 + rng() * 4);
      
      if (style === "tancho") {
        // Red tancho spot on head/center of texture mapping
        const cx = 256 + (rng() - 0.5) * 40;
        const cy = 200 + (rng() - 0.5) * 40;
        const r = 55 + rng() * 25;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, "#ff3d00");
        grad.addColorStop(0.8, "#d84315");
        grad.addColorStop(1.0, "rgba(216, 67, 21, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Overlaying organic red spots
        for (let s = 0; s < redCount; s++) {
          const rx = 100 + rng() * 312;
          const ry = 100 + rng() * 312;
          const maxR = 60 + rng() * 60;
          const blobCircles = 4 + Math.floor(rng() * 5);
          const color = rng() > 0.45 ? "#e65100" : "#d84315";

          for (let c = 0; c < blobCircles; c++) {
            const bx = rx + (rng() - 0.5) * (maxR * 0.7);
            const by = ry + (rng() - 0.5) * (maxR * 0.7);
            const br = (0.4 + rng() * 0.6) * maxR;

            const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
            grad.addColorStop(0, color);
            grad.addColorStop(0.85, color);
            grad.addColorStop(1.0, "rgba(0,0,0,0)");
            ctx.fillStyle = grad;

            ctx.beginPath();
            ctx.arc(bx, by, br, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }

    // Black organic sumi spot patterns
    if (style === "sanke" || style === "showa") {
      const blackCount = Math.floor(3 + rng() * 4);
      for (let s = 0; s < blackCount; s++) {
        const bx = 100 + rng() * 312;
        const by = 100 + rng() * 312;
        const maxR = 30 + rng() * 45;
        const blobCircles = 3 + Math.floor(rng() * 4);
        const color = rng() > 0.5 ? "#111111" : "#212121";

        for (let c = 0; c < blobCircles; c++) {
          const cx = bx + (rng() - 0.5) * (maxR * 0.6);
          const cy = by + (rng() - 0.5) * (maxR * 0.6);
          const cr = (0.4 + rng() * 0.6) * maxR;

          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
          grad.addColorStop(0, color);
          grad.addColorStop(0.85, color);
          grad.addColorStop(1.0, "rgba(0,0,0,0)");
          ctx.fillStyle = grad;

          ctx.beginPath();
          ctx.arc(cx, cy, cr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // High quality scale texture overlay
    ctx.strokeStyle = "rgba(0, 0, 0, 0.025)";
    ctx.lineWidth = 1;
    for (let x = 0; x < 512; x += 16) {
      ctx.beginPath();
      for (let y = 0; y < 512; y += 8) {
        ctx.arc(x + (y % 16 === 0 ? 8 : 0), y, 12, 0, Math.PI);
      }
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: roughness,
    metalness: metalness,
  });

  return { texture, material };
}

function _makeButterflyTexture() {
  const SZ = 128;
  const cv = document.createElement("canvas");
  cv.width = SZ; cv.height = SZ;
  const ctx = cv.getContext("2d");
  
  const cx = SZ / 2;
  const cy = SZ / 2;
  
  // Draw a gorgeous yellow/orange monarch-style butterfly
  ctx.save();
  ctx.translate(cx, cy);
  
  // Wings
  const drawWing = (side, isTop) => {
    ctx.save();
    ctx.scale(side, 1);
    const grad = ctx.createRadialGradient(0, 0, 2, 10, -10, 40);
    grad.addColorStop(0, "#ffe082"); // bright yellow center
    grad.addColorStop(0.7, "#ff9100"); // orange outer
    grad.addColorStop(1, "#3e2723"); // dark brown/black edge
    ctx.fillStyle = grad;
    
    ctx.beginPath();
    if (isTop) {
      // Top wing
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(15, -35, 45, -25, 40, -5);
      ctx.bezierCurveTo(35, 5, 15, 5, 0, 0);
    } else {
      // Bottom wing
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(20, 5, 30, 25, 15, 30);
      ctx.bezierCurveTo(5, 30, 5, 15, 0, 0);
    }
    ctx.fill();
    
    // White spots on the dark edge
    ctx.fillStyle = "#ffffff";
    if (isTop) {
      ctx.beginPath(); ctx.arc(36, -16, 2, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(38, -8, 1.5, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(22, 18, 1.5, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(14, 26, 1.2, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  };
  
  drawWing(-1, true);  // top-left
  drawWing(1, true);   // top-right
  drawWing(-1, false); // bottom-left
  drawWing(1, false);  // bottom-right
  
  // Body
  const bodyGrad = ctx.createLinearGradient(0, -15, 0, 20);
  bodyGrad.addColorStop(0, "#212121");
  bodyGrad.addColorStop(1, "#424242");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, 4, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  
  // Antennae
  ctx.strokeStyle = "#212121";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-1, -12); ctx.quadraticCurveTo(-6, -24, -12, -26);
  ctx.moveTo(1, -12); ctx.quadraticCurveTo(6, -24, 12, -26);
  ctx.stroke();
  
  ctx.restore();
  
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
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

function _buildSmallFishGeometry() {
  const geom = new THREE.BufferGeometry();
  // Double-pyramid 3D shape representing a small fish (8 faces, 6 vertices)
  const vertices = new Float32Array([
    0.0, 0.0, 0.045,    // 0: head (forward along Z)
    0.0, 0.0, -0.065,   // 1: tail (backward along Z)
    0.012, 0.0, 0.0,    // 2: left side (X+)
    -0.012, 0.0, 0.0,   // 3: right side (X-)
    0.0, 0.015, -0.008, // 4: top fin (Y+)
    0.0, -0.012, -0.008 // 5: bottom (Y-)
  ]);
  const indices = new Uint16Array([
    0, 2, 4,  0, 4, 3,  0, 3, 5,  0, 5, 2, // head to middle (4 faces)
    1, 4, 2,  1, 3, 4,  1, 5, 3,  1, 2, 5  // tail to middle (4 faces)
  ]);
  geom.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geom.setIndex(new THREE.BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  return geom;
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
  _fishMaterials: [],
  _fishTextures: [],
  _fishMeshes: [],
  _fishCenterY: 0,
  _cx: SANCTUARY_POOL_CENTER_X,
  _cz: SANCTUARY_POOL_CENTER_Z,
  
  _butterflySprite: null,
  _butterflyTexture: null,
  _butterflyTimer: 0,
  _butterflyActiveTime: 0,
  _butterflyStartPos: null,
  _butterflyFlyInTimer: 0,

  _smallFishGeometry: null,
  _smallFishMaterial: null,
  _smallFishMesh: null,
  _smallFishData: [],
  _smallFishGroups: [],

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
      this._fishGeometry = fg.geometry;
      this._fishMaterials = [];
      this._fishTextures = [];

      const waterY =
        typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
          ? window.__sanctuaryWaterY
          : -0.2;
      this._fishCenterY = waterY - SWIM_DEPTH_CENTER_M;

      const rng = mulberry32(0x3713ba75);
      this._fishMeshes = [];

      for (let i = 0; i < FISH_COUNT; i++) {
        const { texture, material } = _createProceduralKoiTexture(i);
        this._fishMaterials.push(material);
        this._fishTextures.push(texture);

        // Keep the first material as fallback/reference for any external logic
        if (i === 0) {
          this._fishMaterial = material;
        }

        const fish = new THREE.Mesh(fg.geometry, material);
        fish.castShadow = false;
        fish.receiveShadow = false;

        // Size variations: make 1/3 of the school young smaller koi, and 2/3 varied adult sizes
        let sizeMultiplier = 0.7 + rng() * 0.75; // [0.7, 1.45]
        if (i % 3 === 0) {
          sizeMultiplier = 0.3 + rng() * 0.25; // [0.3, 0.55] - smaller young koi
        }
        const fishScale = scale * sizeMultiplier;
        fish.scale.setScalar(fishScale);
        fish.name = `sanctuary_fish_${i}`;
        fish.userData.anuId = `fauna.sanctuary.fish.${i}`;
        fish.userData.anuKind = "sanctuary_fish";
        fish.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
        fish.userData.anuInteractable = true;
        fish.userData.anuInteractionVerbs = [
          ANU_INTERACTION_VERB.INSPECT,
          ANU_INTERACTION_VERB.HARVEST,
        ];
        // Layer 1 — show in main PIP minimap.
        // Layer 2 — show in fishing PIP "fish-finder" lens. The
        // fishing gauge was removed from layer 2 (user-requested
        // 2026-05-28: "in pip = its gone so we can see fish thrugh
        // it"); enabling layer 2 on fish here is what makes the PIP
        // actually display fish where the gauge used to be.
        fish.layers.enable(1);
        fish.layers.enable(2);

        // orbitFrac in [0.22, 0.72] → max orbit ≈ 8.6 m, stays inside the
        // bowl-water intersection (~9.5 m) so fish never appear embedded
        // in the rim slope.
        const orbitFrac = 0.22 + (i / FISH_COUNT) * 0.50;
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
        fish.userData.baseScaleFactor = fishScale;
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
        if (!_module._root || !_module._fishGeometry) {
          console.warn("[SanctuaryFish] Cannot spawn baby fish — not ready");
          return null;
        }
        const waterY =
          typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
            ? window.__sanctuaryWaterY
            : -0.05;
        const baseScale = FISH_TARGET_LENGTH_M / fg.fishLen;
        const idx = _module._fishMeshes.length;
        const { texture, material } = _createProceduralKoiTexture(idx);
        _module._fishMaterials.push(material);
        _module._fishTextures.push(texture);

        const baby = new THREE.Mesh(_module._fishGeometry, material);
        baby.castShadow = false;
        baby.receiveShadow = false;
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

      // Procedurally spawn 4 additional smaller baby koi fish randomly in the pond!
      for (let k = 0; k < 4; k++) {
        const angle = rng() * Math.PI * 2;
        const radius = SANCTUARY_POOL_RADIUS_M * (0.2 + rng() * 0.45);
        const bx = this._cx + Math.cos(angle) * radius;
        const bz = this._cz + Math.sin(angle) * radius;
        window.__sanctuarySpawnBabyFish(bx, bz);
      }

      console.log(
        `%c[Sanctuary] 🐟 ${FISH_COUNT} fish.obj trout + 4 baby koi — upright, velocity swim (target ${FISH_TARGET_LENGTH_M} m).`,
        "color:#2b6ffe;font-weight:bold;",
      );

      // Create procedural yellow butterfly sprite and add to root
      this._butterflyTexture = _makeButterflyTexture();
      const bflyMat = new THREE.SpriteMaterial({
        map: this._butterflyTexture,
        transparent: true,
        depthWrite: false,
        depthTest: true,
      });
      this._butterflySprite = new THREE.Sprite(bflyMat);
      this._butterflySprite.scale.set(0.28, 0.28, 1);
      this._butterflySprite.visible = false;
      this._butterflySprite.name = "sanctuary_testing_butterfly";
      this._butterflySprite.renderOrder = 6;
      this._root.add(this._butterflySprite);
      
      this._butterflyTimer = 0;
      this._butterflyActiveTime = 0;
      this._butterflyFlyInTimer = 0;

      // ── Small Schooling Fish Initialization (Phase 3) ──
      this._smallFishGeometry = _buildSmallFishGeometry();
      this._smallFishMaterial = new THREE.MeshStandardMaterial({
        color: 0xff6e40, // coral neon orange / gold
        emissive: 0x3e2723,
        emissiveIntensity: 0.25,
        roughness: 0.15,
        metalness: 0.65,
        flatShading: true,
      });

      const SMALL_FISH_COUNT = 32;
      this._smallFishMesh = new THREE.InstancedMesh(
        this._smallFishGeometry,
        this._smallFishMaterial,
        SMALL_FISH_COUNT
      );
      this._smallFishMesh.castShadow = false;
      this._smallFishMesh.receiveShadow = false;
      this._smallFishMesh.name = "sanctuary_small_fish_school";
      this._smallFishMesh.userData.anuKind = "sanctuary_small_fish";
      this._smallFishMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
      this._smallFishMesh.layers.enable(1); // Show in PIP minimap
      this._smallFishMesh.layers.enable(2); // Show in fish-finder lens
      this._root.add(this._smallFishMesh);

      // Setup 4 schooling groups
      const NUM_GROUPS = 4;
      this._smallFishGroups = [];
      this._smallFishData = [];

      for (let g = 0; g < NUM_GROUPS; g++) {
        // Group leader
        const groupAngle = (g / NUM_GROUPS) * Math.PI * 2 + rng() * 0.5;
        const groupR = SANCTUARY_POOL_RADIUS_M * (0.3 + rng() * 0.4);
        this._smallFishGroups.push({
          x: this._cx + Math.cos(groupAngle) * groupR,
          z: this._cz + Math.sin(groupAngle) * groupR,
          y: this._fishCenterY + (rng() - 0.5) * 0.4,
          heading: rng() * Math.PI * 2,
          speed: 0.25 + rng() * 0.15,
          orbitR: groupR,
          orbitSpeed: (0.015 + rng() * 0.01) * (rng() > 0.5 ? 1 : -1),
        });
      }

      for (let i = 0; i < SMALL_FISH_COUNT; i++) {
        const groupIdx = i % NUM_GROUPS;
        const rad = 0.2 + rng() * 0.45;
        const ang = rng() * Math.PI * 2;
        this._smallFishData.push({
          groupIdx,
          offsetX: Math.cos(ang) * rad,
          offsetZ: Math.sin(ang) * rad,
          offsetY: (rng() - 0.5) * 0.2,
          x: this._cx,
          y: this._fishCenterY,
          z: this._cz,
          heading: rng() * Math.PI * 2,
          wigglePhase: rng() * Math.PI * 2,
          wiggleSpeed: 10 + rng() * 5,
        });
      }

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

    // ── Small Schooling Fish Schooling Simulation Update (Phase 3) ──
    if (this._smallFishMesh && this._smallFishData.length > 0) {
      const NUM_GROUPS = 4;

      // 1. Update Group Leaders (Orbital wander inside the pond)
      for (let g = 0; g < NUM_GROUPS; g++) {
        const leader = this._smallFishGroups[g];
        // Slow orbital progression
        const ang = Math.atan2(leader.z - this._cz, leader.x - this._cx) + leader.orbitSpeed * delta * stride;
        leader.x = this._cx + Math.cos(ang) * leader.orbitR;
        leader.z = this._cz + Math.sin(ang) * leader.orbitR;
        leader.y = this._fishCenterY + Math.sin(t * 0.6 + g) * 0.18;
        leader.heading = ang + Math.PI / 2 * (leader.orbitSpeed > 0 ? 1 : -1);
      }

      // 2. Update each individual fish in the school
      const _m = new THREE.Matrix4();
      const _pos = new THREE.Vector3();
      const _quat = new THREE.Quaternion();
      const _euler = new THREE.Euler();
      const _scl = new THREE.Vector3(1, 1, 1);

      for (let i = 0; i < this._smallFishData.length; i++) {
        const fishData = this._smallFishData[i];
        const leader = this._smallFishGroups[fishData.groupIdx];

        // Organic flocking oscillation offset from group leader
        const groupWobbleX = Math.sin(t * 2.2 + i * 0.4) * 0.15;
        const groupWobbleZ = Math.cos(t * 2.2 + i * 0.4) * 0.15;
        const targetX = leader.x + fishData.offsetX + groupWobbleX;
        const targetZ = leader.z + fishData.offsetZ + groupWobbleZ;
        const targetY = leader.y + fishData.offsetY + Math.sin(t * 3.5 + i) * 0.05;

        // Smooth follow/lerp physics toward target position
        const followSpeed = 3.5 * delta * stride;
        fishData.x += (targetX - fishData.x) * Math.min(1.0, followSpeed);
        fishData.z += (targetZ - fishData.z) * Math.min(1.0, followSpeed);
        fishData.y += (targetY - fishData.y) * Math.min(1.0, followSpeed);

        // Calculate heading from actual velocity
        const dx = targetX - fishData.x;
        const dz = targetZ - fishData.z;
        const targetHeading = Math.atan2(dz, dx);
        
        // Low-pass filter heading rotation
        let dH = targetHeading - fishData.heading;
        while (dH > Math.PI) dH -= Math.PI * 2;
        while (dH < -Math.PI) dH += Math.PI * 2;
        fishData.heading += dH * Math.min(1.0, 4.0 * delta * stride);

        // Micro tail wiggle animation
        const wiggle = Math.sin(t * fishData.wiggleSpeed + fishData.wigglePhase) * 0.18;

        _pos.set(fishData.x, fishData.y, fishData.z);
        _euler.set(0, -fishData.heading + Math.PI + wiggle, 0);
        _quat.setFromEuler(_euler);
        _m.compose(_pos, _quat, _scl);
        this._smallFishMesh.setMatrixAt(i, _m);
      }
      this._smallFishMesh.instanceMatrix.needsUpdate = true;
    }

    // ── Safe Low-Frequency Funny Jump Event Roll (Phase 4) ──
    this._funnyJumpCheckTimer = (this._funnyJumpCheckTimer || 0) + delta * stride;
    if (this._funnyJumpCheckTimer >= 5.0) {
      this._funnyJumpCheckTimer = 0.0;
      // 5% chance per minute = 5% * 5s / 60s = 0.00416 (0.416% chance per check)
      if (Math.random() < 0.00416) {
        this._triggerFunnyEatJump();
      }
    }

    // 30-minute pool reset: resets all fish growth scale back to 1.0
    this._poolResetTimer = (this._poolResetTimer || 0) + delta * stride;
    if (this._poolResetTimer >= 1800) {
      this._poolResetTimer = 0;
      for (const fish of this._fishMeshes) {
        fish.userData.growthScale = 1.0;
      }
      console.log("%c[SanctuaryFish] 30-minute pool reset: all fish grown back to 100%!", "color:#4caf50;font-weight:bold;");
    }

    // Butterfly Hovering AI Update
    const waterSurfaceY =
      typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
        ? window.__sanctuaryWaterY
        : -0.05;

    if (this._butterflySprite) {
      this._butterflyTimer += delta * stride;
      // Spawn/reveal butterfly every 5 minutes (300 seconds)
      if (this._butterflyTimer >= 300) {
        this._butterflyTimer = 0;
        this._butterflyActiveTime = 60.0; // Stay active for 60 seconds
        
        // Pick a random starting position at the edge of the pool
        const ang = Math.random() * Math.PI * 2;
        const startR = SANCTUARY_POOL_RADIUS_M * 1.1;
        this._butterflyStartPos = new THREE.Vector3(
          this._cx + Math.cos(ang) * startR,
          waterSurfaceY + 1.2,
          this._cz + Math.sin(ang) * startR
        );
        this._butterflySprite.position.copy(this._butterflyStartPos);
        this._butterflySprite.visible = true;
        this._butterflySprite.material.opacity = 1.0;
        this._butterflyFlyInTimer = 3.0; // 3 seconds to fly in
      }
      
      if (this._butterflyActiveTime > 0) {
        this._butterflyActiveTime -= delta * stride;
        
        // Find the biggest koi fish
        let biggestFish = null;
        let maxScale = -1;
        for (const fish of this._fishMeshes) {
          if (fish.scale.x > maxScale) {
            maxScale = fish.scale.x;
            biggestFish = fish;
          }
        }
        
        if (biggestFish) {
          const fp = biggestFish.position;
          const targetY = waterSurfaceY + 0.35 + Math.sin(t * 8) * 0.05;
          const flutterX = Math.sin(t * 5) * 0.18;
          const flutterZ = Math.cos(t * 5) * 0.18;
          
          if (this._butterflyFlyInTimer > 0) {
            this._butterflyFlyInTimer -= delta * stride;
            const pct = Math.max(0, this._butterflyFlyInTimer / 3.0);
            this._butterflySprite.position.lerpVectors(
              new THREE.Vector3(fp.x + flutterX, targetY, fp.z + flutterZ),
              this._butterflyStartPos,
              1.0 - pct
            );
          } else {
            this._butterflySprite.position.set(fp.x + flutterX, targetY, fp.z + flutterZ);
          }
          
          // Wingbeat flutter (fast scale oscillation)
          const bWob = 0.28 + Math.sin(t * 45) * 0.03;
          this._butterflySprite.scale.set(bWob, bWob, 1);
          
          // Fade out in final 3 seconds
          if (this._butterflyActiveTime < 3.0) {
            this._butterflySprite.material.opacity = Math.max(0, this._butterflyActiveTime / 3.0);
          } else {
            this._butterflySprite.material.opacity = 1.0;
          }
        }
      } else {
        this._butterflySprite.visible = false;
      }
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

      // ── HILARIOUS HIJACKED JUMP-AND-EAT PREY STATE MACHINE (Phase 4) ──
      if (ud._funnyEatState) {
        ud._funnyEatTimer += delta * stride;
        const target = ud._funnyEatTarget;
        const JUMP_DURATION = 1.2; // 1.2 seconds of cinematic leap
        const PEAK_HEIGHT = 1.45; // Spectacular high vertical leap!
        
        if (ud._funnyEatState === "approach") {
          // Approach phase: swim rapidly directly underneath the target prey
          const tx = target.pos.x;
          const tz = target.pos.z;
          const dx = tx - fish.position.x;
          const dz = tz - fish.position.z;
          const dist = Math.hypot(dx, dz);
          
          if (dist > 0.35 && ud._funnyEatTimer < 1.5) {
            // Rapid charge under the prey
            const chargeSpeed = 3.6 * delta * stride;
            fish.position.x += (dx / dist) * chargeSpeed;
            fish.position.z += (dz / dist) * chargeSpeed;
            // Face the target
            const hdg = Math.atan2(dz, dx);
            ud._currentHeading = hdg;
            fish.rotation.set(0, -hdg + Math.PI, 0);
          } else {
            // Underneath target! Initiate the glorious leap!
            ud._funnyEatState = "leap";
            ud._funnyEatTimer = 0.0;
            ud._funnyEatStartPos = fish.position.clone();
            
            // Spawn entry ripple!
            if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
              window.sanctuaryPulse(fish.position.x, fish.position.z);
            }
          }
        } 
        else if (ud._funnyEatState === "leap") {
          // Leap phase: parabolic vertical motion + forward drift
          const tLeap = Math.min(1.0, ud._funnyEatTimer / JUMP_DURATION);
          const arc = -4 * (tLeap - 0.5) * (tLeap - 0.5) + 1; // Parabolic profile [0 -> 1 -> 0]
          
          // Drift from jump start toward the target coordinates
          fish.position.lerpVectors(ud._funnyEatStartPos, target.pos, tLeap);
          
          // Apply parabolic elevation
          const normalY = ud.fishMidY ?? this._fishCenterY;
          fish.position.y = normalY + PEAK_HEIGHT * arc;
          
          // Dynamic rotations: Pitch up on climb, face forward, Pitch down on fall
          const pitch = (1.0 - 2.0 * tLeap) * 1.1; // [1.1 -> 0 -> -1.1] radians
          const hdg = Math.atan2(target.pos.z - ud._funnyEatStartPos.z, target.pos.x - ud._funnyEatStartPos.x);
          fish.rotation.set(pitch, -hdg + Math.PI, 0);
          
          // ── Capture Window at the apex ──
          if (tLeap >= 0.45 && tLeap <= 0.55) {
            // Consume the prey!
            let preyMesh = null;
            let preyName = "";
            if (target.type === "dragonfly") {
              if (target.obj.alive) {
                target.obj.alive = false;
                target.obj.respawnTimer = 12.0; // Respawn in 12s
                preyName = "Dragonfly 🪰💨";
              }
            } else if (target.type === "butterfly") {
              if (this._butterflySprite.visible) {
                this._butterflySprite.visible = false;
                this._butterflyTimer = -15.0; // Stagger next butterfly spawner
                this._butterflyActiveTime = 0.0;
                preyName = "Butterfly 🦋😋";
              }
            } else if (target.type === "butterfly_ritual") {
              if (target.obj.visible) {
                target.obj.visible = false;
                preyName = "Butterfly 🦋🍭";
                // Let them respawn after ritual disperse
                setTimeout(() => { if (target.obj) target.obj.visible = true; }, 10000);
              }
            } else if (target.type === "frog") {
              if (target.obj.group.visible) {
                target.obj.group.visible = false;
                preyName = "Frog 🐸💥";
                // Add funny dangling frog legs!
                if (!ud._frogLegs) {
                  ud._frogLegs = _buildFrogLegs();
                  fish.add(ud._frogLegs);
                }
                // Respawn frog in 12s
                setTimeout(() => {
                  if (target.obj && target.obj.group) {
                    target.obj.group.visible = true;
                    target.obj.state = 0; // Swim state
                    target.obj.timer = 3.0;
                    target.obj.group.position.set(this._cx + (Math.random() - 0.5) * 4.0, -0.68, this._cz + (Math.random() - 0.5) * 4.0);
                  }
                }, 12000);
              }
            }
            
            if (preyName && !ud._funnyEatCaptured) {
              ud._funnyEatCaptured = true;
              
              // 1. Splash ripple at apex prey capture coordinates
              if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
                window.sanctuaryPulse(target.pos.x, target.pos.z);
              }
              
              // 2. Synthesize a funny high-pitched splash/snap sound
              if (typeof window !== "undefined" && window.AudioContext) {
                try {
                  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                  const osc = audioCtx.createOscillator();
                  const gain = audioCtx.createGain();
                  osc.connect(gain);
                  gain.connect(audioCtx.destination);
                  osc.type = "sine";
                  osc.frequency.setValueAtTime(420, audioCtx.currentTime);
                  osc.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.15);
                  gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
                  gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
                  osc.start();
                  osc.stop(audioCtx.currentTime + 0.15);
                } catch (e) {}
              }

              // 3. Display hilarious Floating Combat Text!
              const funnyPhrases = [
                `NOM NOM NOM! ${preyName}`,
                `BURP! Tastes like ${target.type === "frog" ? "chicken 🐸" : "candy 🍭"}`,
                `EPIC SNACK! ${preyName}`,
                `GET IN MY BELLY! ${preyName}`,
                `YUMMY! ${preyName}`,
                `CRUNCHY! 😋`
              ];
              const phrase = funnyPhrases[Math.floor(Math.random() * funnyPhrases.length)];
              
              if (typeof window !== "undefined") {
                const textFunc = window.showWoWCombatText || window.anuOrchestrator?._activeModuleInstances?.SanctuaryFishing?.showWoWCombatText;
                if (typeof textFunc === "function") {
                  textFunc(phrase, true);
                } else {
                  // Fallback: simple floating combat text
                  const el = document.createElement("div");
                  el.textContent = phrase.toUpperCase();
                  Object.assign(el.style, {
                    position: "fixed", left: "50%", top: "35%", transform: "translate(-50%, -50%)",
                    zIndex: "100000", pointerEvents: "none", userSelect: "none",
                    font: "900 38px 'Fredoka One', 'Outfit', sans-serif", color: "#ffa726",
                    textShadow: "0 0 10px rgba(0,0,0,0.9), 0 3px 12px rgba(0,0,0,0.95)",
                    transition: "all 1.5s ease-out"
                  });
                  document.body.appendChild(el);
                  requestAnimationFrame(() => {
                    el.style.opacity = "0";
                    el.style.transform = "translate(-50%, -220%) scale(1.3)";
                  });
                  setTimeout(() => el.remove(), 1500);
                }
              }
            }
          }
          
          if (tLeap >= 1.0) {
            // Landing: return to water
            ud._funnyEatState = "landing";
            ud._funnyEatTimer = 0.0;
            
            // Landing splash ripple
            if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
              window.sanctuaryPulse(fish.position.x, fish.position.z);
            }
          }
        }
        else if (ud._funnyEatState === "landing") {
          // Landing phase: fish dives back under water and dissolves frog legs if present
          const tLand = Math.min(1.0, ud._funnyEatTimer / 1.5);
          const normalY = ud.fishMidY ?? this._fishCenterY;
          
          // Dive slightly below water and slowly float back up
          const diveDepth = normalY - 0.28;
          fish.position.y += (diveDepth - fish.position.y) * Math.min(1.0, 5.0 * delta * stride);
          
          // Shrink frog legs to 0 as it digests
          if (ud._frogLegs) {
            const s = Math.max(0.001, 1.0 - tLand);
            ud._frogLegs.scale.setScalar(s);
          }
          
          if (tLand >= 1.0) {
            // Restore normal state
            if (ud._frogLegs) {
              fish.remove(ud._frogLegs);
              ud._frogLegs.traverse((o) => o.geometry?.dispose?.());
              ud._frogLegs = null;
            }
            // Clear tracking references
            if (target && target.obj && target.obj.userData) {
              target.obj.userData.targetedBy = null;
            }
            ud._funnyEatState = null;
            ud._funnyEatTarget = null;
            ud._funnyEatCaptured = false;
          }
        }
        
        // Skip standard updates while in hijacked funny jump
        if (fish.renderOrder !== 5) fish.renderOrder = 5;
        continue;
      }

      // ── Dragonfly Hunt & Parabolic Jump State Machine ──
      if (ud._dfJumpState === "jump") {
        ud._dfJumpTimer += delta * stride;
        const JUMP_DURATION_S = 0.85;
        const JUMP_PEAK_M = 0.65;
        const jt = Math.min(1.0, ud._dfJumpTimer / JUMP_DURATION_S);
        
        const arc = -4 * (jt - 0.5) * (jt - 0.5) + 1; // 0 at t=0, 1 at t=0.5, 0 at t=1.0
        const normalY = ud.fishMidY ?? this._fishCenterY;
        
        // Continue moving forward along current heading during jump
        const jumpSpeed = 0.25 * delta * stride;
        fish.position.x += Math.cos(ud._currentHeading || 0) * jumpSpeed;
        fish.position.z += Math.sin(ud._currentHeading || 0) * jumpSpeed;
        fish.position.y = normalY + JUMP_PEAK_M * arc;
        
        // Set pitch based on jump climbing/descending
        const pitch = (1 - 2 * jt) * 0.9;
        fish.rotation.set(pitch, -(ud._currentHeading || 0) + Math.PI, 0);
        
        const targetDf = ud._dfJumpTarget;
        
        // At peak, consume the dragonfly
        if (jt >= 0.45 && jt <= 0.55 && targetDf && targetDf.alive) {
          targetDf.alive = false;
          targetDf.targetedBy = null;
          targetDf.respawnTimer = 8.0; // respawn in 8s
          
          if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
            window.sanctuaryPulse(fish.position.x, fish.position.z);
          }
        }
        
        if (jt >= 1.0) {
          // Landing splash
          if (typeof window !== "undefined" && typeof window.sanctuaryPulse === "function") {
            window.sanctuaryPulse(fish.position.x, fish.position.z);
          }
          ud._dfJumpState = null;
          if (targetDf) targetDf.targetedBy = null;
          ud._dfJumpTarget = null;
        }
        
        // Skip standard updates while jumping
        if (fish.renderOrder !== 5) fish.renderOrder = 5;
        continue;
      }

      // Check for dragonflies to hunt/jump at
      const dragonflies = typeof window !== "undefined" ? window.__sanctuaryDragonflies : null;
      const isInterested = (typeof window !== "undefined" && window.__interestedFish === fish);

      if (dragonflies && !ud.isStruggling && !isInterested && !ud._interestPhase && !ud._frogEatState && !ud._dfJumpState) {
        for (const df of dragonflies) {
          if (df.alive && !df.targetedBy) {
            const dx = df.sprite.position.x - fish.position.x;
            const dz = df.sprite.position.z - fish.position.z;
            const horizontalDist = Math.hypot(dx, dz);
            
            // Scaled length of the fish (standard length is ~0.42m)
            const oneFishLength = 0.45 * currentScale;
            if (horizontalDist < oneFishLength) {
              // Initiate jump!
              ud._dfJumpState = "jump";
              ud._dfJumpTimer = 0;
              ud._dfJumpTarget = df;
              df.targetedBy = fish.name;
              break;
            }
          }
        }
      }

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
            // ── Interest behaviour (user-rewritten 2026-05-28) ──
            // "if a fish is interested it will be below the bait looking
            //  up at it, slowly wigling it will not cross the center
            //  until it bites ... sink lower when they want the fish
            //  and diagonal facing up to strike"
            //
            // Three-phase state machine on `ud._interestPhase`:
            //   sink   → approach the bait from below, sinking deeper
            //            and drifting toward XZ alignment with the bait.
            //   hover  → linger ~50 cm BELOW the bait, slow tail wiggle,
            //            diagonal-up pitch (face the lure), and a hard
            //            radius clamp so the fish NEVER crosses the
            //            bait's XZ centre until it bites.
            //   strike → diagonal-up lunge from below toward the bait;
            //            on contact the legacy "isStruggling" branch
            //            takes over (set elsewhere). Phase auto-fires
            //            from hover after a randomised dwell.
            const targetX = bPos.x;
            const targetZ = bPos.z;
            const waterSurfaceY =
              typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
                ? window.__sanctuaryWaterY
                : -0.05;
            // Bait sits at the water surface; the fish hovers 50 cm
            // below it.  Pool basin floor at the centre is ~waterY-1.0,
            // so 50 cm leaves clear water above + below — fish never
            // bumps the basin.
            const HOVER_DEPTH_BELOW_BAIT_M = 0.50;
            const hoverY = waterSurfaceY - HOVER_DEPTH_BELOW_BAIT_M;
            // Minimum XZ distance from bait centre — fish cannot
            // cross this line until it transitions to `strike`.
            const NO_CROSS_RADIUS_M = 0.18;
            // Pitch (radians) for "diagonal up" — ~25° above horizontal.
            const DIAGONAL_UP_PITCH_RAD = 0.44;

            const dx = targetX - fish.position.x;
            const dz = targetZ - fish.position.z;
            const dist = Math.hypot(dx, dz);

            // Initialise interest state on the first frame interested.
            if (!ud._interestPhase) {
              ud._interestPhase = "sink";
              ud._interestTimer = 0;
              ud._strikeDwell = 4.0 + Math.random() * 4.0; // 4-8 s of hovering
              // Entry ripple at the fish's current position.
              if (typeof window !== "undefined" && window.__sanctuaryFishingSpawnRipple) {
                window.__sanctuaryFishingSpawnRipple(fish.position.x, fish.position.z);
              }
            }
            ud._interestTimer += delta;

            // ── SINK ── descend + drift in toward the bait XZ
            if (ud._interestPhase === "sink") {
              if (dist > NO_CROSS_RADIUS_M) {
                const speed = 0.35 * delta;
                fish.position.x += (dx / dist) * speed;
                fish.position.z += (dz / dist) * speed;
              }
              // Sink toward hover depth (smooth, ~1.5 s to settle).
              fish.position.y += (hoverY - fish.position.y) * Math.min(1.0, 1.5 * delta);

              // Face the bait diagonal-up
              if (dist > 0.01) {
                const heading = Math.atan2(dz, dx);
                fish.rotation.set(DIAGONAL_UP_PITCH_RAD * 0.5, -heading + Math.PI, 0);
              }

              // Settled criterion: close to hover depth AND outside
              // the no-cross radius (so we don't slam through).
              const yDelta = Math.abs(fish.position.y - hoverY);
              if (yDelta < 0.05 && dist <= NO_CROSS_RADIUS_M + 0.08) {
                ud._interestPhase = "hover";
                ud._interestTimer = 0;
              }
            }

            // ── HOVER ── stay below bait, slow wiggle, never cross centre
            else if (ud._interestPhase === "hover") {
              // Hard clamp: if drift brought us inside no-cross radius,
              // push back out toward the closest edge of the ring.
              if (dist < NO_CROSS_RADIUS_M) {
                const nx = -dx / Math.max(0.001, dist);
                const nz = -dz / Math.max(0.001, dist);
                fish.position.x = targetX + nx * NO_CROSS_RADIUS_M;
                fish.position.z = targetZ + nz * NO_CROSS_RADIUS_M;
              }
              // Drift gently along the ring (slow orbit ~0.05 rad/s)
              // so the fish doesn't look frozen.
              const ringAngle = Math.atan2(-dz, -dx) + delta * 0.05;
              const ringR = NO_CROSS_RADIUS_M + 0.04 + Math.sin(t * 0.6) * 0.02;
              fish.position.x = targetX + Math.cos(ringAngle) * ringR;
              fish.position.z = targetZ + Math.sin(ringAngle) * ringR;
              // Vertical bob — very gentle, ±1 cm around hover depth.
              fish.position.y = hoverY + Math.sin(t * 1.2) * 0.012;

              // Always face the bait, diagonal-up.  Tail wiggle goes
              // into a small rotation-Z oscillation (not Y heading) so
              // the body roll reads as "thinking, swaying", not panic.
              const heading = Math.atan2(targetZ - fish.position.z, targetX - fish.position.x);
              const tailWiggle = Math.sin(t * 2.4) * 0.10;
              fish.rotation.set(DIAGONAL_UP_PITCH_RAD, -heading + Math.PI, tailWiggle);

              // After the random dwell, commit to strike.
              if (ud._interestTimer >= ud._strikeDwell) {
                ud._interestPhase = "strike";
                ud._interestTimer = 0;
              }
            }

            // ── STRIKE ── diagonal-up lunge from below
            else if (ud._interestPhase === "strike") {
              const STRIKE_DURATION = 0.55;
              const frac = Math.min(1.0, ud._interestTimer / STRIKE_DURATION);
              // Ease-out: fast launch, slow approach to the bait.
              const ease = 1 - (1 - frac) * (1 - frac);
              // Interpolate from hover position toward bait position.
              const startX = targetX + (fish.position.x - targetX) * (1 - ease);
              const startZ = targetZ + (fish.position.z - targetZ) * (1 - ease);
              const startY = hoverY + (waterSurfaceY - 0.06 - hoverY) * ease;
              fish.position.set(startX, startY, startZ);
              // Pitch increases through the strike — by impact she's
              // angled steeply up at ~40°.
              const strikePitch = DIAGONAL_UP_PITCH_RAD + ease * 0.30;
              const heading = Math.atan2(dz, dx);
              fish.rotation.set(strikePitch, -heading + Math.PI, 0);

              // Splash at the half-way point of the strike
              if (!ud._strikeSplashed && frac > 0.55) {
                ud._strikeSplashed = true;
                if (typeof window !== "undefined" && window.__sanctuaryFishingSpawnRipple) {
                  window.__sanctuaryFishingSpawnRipple(targetX, targetZ);
                }
              }
              // On reaching the bait, hand off to the existing struggle
              // path (set externally when the bite is registered).
              if (frac >= 1.0) {
                // Lock to the bait, let `isStruggling` take over next frame.
                fish.position.set(targetX, waterSurfaceY - 0.06, targetZ);
                ud._interestPhase = "hooked";
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
        // The bowl carve rises ABOVE waterline beyond r ≈ 0.79 * poolRadius
        // (`1 - inner² = WATER_DROP / POOL_DEPTH`). Beyond that the fish would
        // swim into the visible rim slope. Clamp comfortably inside (0.75) so
        // there's a small water-margin between the school's orbit and the rim.
        const MAX_R = SANCTUARY_POOL_RADIUS_M * 0.75;
        
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

  _triggerFunnyEatJump() {
    // 1. Gather all candidates that are alive/active and located inside or near the pool boundary
    const candidates = [];

    // Dragonflies
    const dragonflies = window.__sanctuaryDragonflies;
    if (dragonflies) {
      for (const df of dragonflies) {
        if (df.alive && !df.targetedBy && df.sprite && df.sprite.position.y > 0) {
          const dx = df.sprite.position.x - this._cx;
          const dz = df.sprite.position.z - this._cz;
          if (Math.hypot(dx, dz) < SANCTUARY_POOL_RADIUS_M * 0.95) {
            candidates.push({ type: "dragonfly", obj: df, pos: df.sprite.position });
          }
        }
      }
    }

    // Hovering Butterfly (the local one in SanctuaryFish.js)
    if (this._butterflySprite && this._butterflySprite.visible && this._butterflyActiveTime > 0.0 && !this._butterflySprite.userData?.targetedBy) {
      const dx = this._butterflySprite.position.x - this._cx;
      const dz = this._butterflySprite.position.z - this._cz;
      if (Math.hypot(dx, dz) < SANCTUARY_POOL_RADIUS_M * 0.95) {
        candidates.push({ type: "butterfly", obj: this._butterflySprite, pos: this._butterflySprite.position });
      }
    }

    // Seated Butterflies (if any explore near the pool)
    const bMod = window.anuOrchestrator?._activeModuleInstances?.SanctuaryButterflies;
    if (bMod && bMod._butterflies) {
      for (const bf of bMod._butterflies) {
        if (bf.visible && !bf.userData?.targetedBy) {
          const dx = bf.position.x - this._cx;
          const dz = bf.position.z - this._cz;
          if (Math.hypot(dx, dz) < SANCTUARY_POOL_RADIUS_M * 0.95) {
            candidates.push({ type: "butterfly_ritual", obj: bf, pos: bf.position });
          }
        }
      }
    }

    // Frogs
    const frogs = window.__sanctuaryFrogs;
    if (frogs) {
      for (const fr of frogs) {
        // Frog must be basking or swimming, not already airborne/jumping (state 3) or eaten
        if (fr.group && fr.group.visible && fr.state !== 3 && !fr.group.userData?.targetedBy) {
          const dx = fr.group.position.x - this._cx;
          const dz = fr.group.position.z - this._cz;
          if (Math.hypot(dx, dz) < SANCTUARY_POOL_RADIUS_M * 0.95) {
            candidates.push({ type: "frog", obj: fr, pos: fr.group.position });
          }
        }
      }
    }

    if (candidates.length === 0) return;

    // Pick a random candidate
    const candidate = candidates[Math.floor(Math.random() * candidates.length)];

    // 2. Select a real swimming fish mesh from the school to perform the jump
    // Exclude fish currently struggling on a hook, interested, or already jumping
    const eligibleFish = this._fishMeshes.filter((fish) => {
      const ud = fish.userData;
      return !ud.isStruggling && !ud._dfJumpState && !ud._funnyEatState && !ud._frogEatState && !ud._interestPhase;
    });

    if (eligibleFish.length === 0) return;
    
    // Pick a random eligible fish
    const fish = eligibleFish[Math.floor(Math.random() * eligibleFish.length)];
    const ud = fish.userData;

    // 3. Initiate the hilarious hijacked jump state!
    ud._funnyEatState = "approach"; // phases: approach -> leap -> landing
    ud._funnyEatTimer = 0.0;
    ud._funnyEatTarget = candidate;
    ud._funnyEatCaptured = false;
    
    candidate.obj.userData = candidate.obj.userData || {};
    candidate.obj.userData.targetedBy = fish.name;
    if (candidate.type === "dragonfly") {
      candidate.obj.targetedBy = fish.name;
    }

    console.log(
      `%c[FunnyJump] 🚀 Fish ${fish.name} is jumping to eat a ${candidate.type} at (${candidate.pos.x.toFixed(2)}, ${candidate.pos.z.toFixed(2)})!`,
      "color:#f57c00;font-weight:bold;"
    );
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    for (const fish of this._fishMeshes) {
      this._root.remove(fish);
    }
    this._fishGeometry?.dispose?.();
    if (this._fishMaterials) {
      for (const mat of this._fishMaterials) {
        mat.dispose();
      }
      this._fishMaterials = [];
    }
    if (this._fishTextures) {
      for (const tex of this._fishTextures) {
        tex.dispose();
      }
      this._fishTextures = [];
    }
    if (this._butterflySprite) {
      this._root?.remove(this._butterflySprite);
      this._butterflySprite.material?.dispose?.();
      this._butterflySprite = null;
    }
    if (this._butterflyTexture) {
      this._butterflyTexture.dispose();
      this._butterflyTexture = null;
    }
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
