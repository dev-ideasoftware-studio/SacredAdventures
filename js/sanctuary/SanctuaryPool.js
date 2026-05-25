/**
 * Sacred Adventures — sanctuary part 2 of 5: THE POOL.
 *
 * The centrepiece. A sacred dark-water pool with organic edges. Anu
 * domain: ENVIRONMENT (water itself isn't a structure; it's part of
 * the ground-and-atmosphere that bodies must obey).
 *
 * Pieces:
 *   • Water surface  — CircleGeometry, 48 segments, animated 3-wave
 *                       ripple shader. Sits at `groundY(center) +
 *                       WATER_DROP_M`. Transparent at 0.62 so the fish
 *                       and bowl floor read through cleanly.
 *   • Basin floor    — second darker disc just under the water, gives
 *                       the pool a sense of depth (the carved terrain
 *                       under it is mostly hidden).
 *   • Lily pads      — 14 instanced low-poly discs scattered across the
 *                       surface, with small gold lily flowers on some.
 *   • Mossy rim      — narrow ring around the water edge in dark moss
 *                       green, hides the seam between water and bank.
 *
 * Triangle target: ≤ 4 k. Achieved: water 96 tris + basin 96 +
 * 14 lily-pad instances × ~16 = 224 + rim 96 ≈ ~510 tris. Plenty of
 * headroom.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
  SANCTUARY_POOL_DEPTH_M,
  SANCTUARY_WATER_DROP_M,
  sanctuaryGroundY,
} from "./SanctuaryGround.js";

/** Cached uniforms — one shared `uTime` so all wave-driven surfaces tick together. */
const _poolTimeUniform = { value: 0 };

function organicRimRadius(angle) {
  return (
    SANCTUARY_POOL_RADIUS_M *
    (0.97 + 0.03 * Math.sin(angle * 2.2 + 0.7) + 0.02 * Math.cos(angle * 5.1 - 1.4))
  );
}

function buildWaterSurface(centerY) {
  const segs = 48;
  const geo = new THREE.CircleGeometry(SANCTUARY_POOL_RADIUS_M * 0.97, segs);
  // Jitter the rim verts to an organic perimeter so the waterline reads
  // natural instead of perfectly circular.
  const pos = geo.attributes.position;
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const a = Math.atan2(y, x);
    const r = organicRimRadius(a) * 0.97;
    pos.setXY(i, Math.cos(a) * r, Math.sin(a) * r);
  }
  geo.computeVertexNormals();

  // Water tint — May-25 2026 user spec: "darken the water 10% more
  // greenish-blue water with soft waves as a pond would have".
  // Base hex 0x0c3a36 (deep teal) → 0x0a3438 (10 % darker, slight blue
  // shift), emissive 0x051d1c → 0x042022 (matches the darker base).
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x0a3438),
    emissive: new THREE.Color(0x042022),
    emissiveIntensity: 0.15,
    roughness: 0.30,            // slightly less glossy → softer pond read
    metalness: 0.05,
    transparent: true,
    opacity: 0.66,
    depthWrite: false,
    side: THREE.DoubleSide,
    defines: { USE_UV: "" },
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = _poolTimeUniform;
    mat.userData.uTimeRef = _poolTimeUniform;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\n      uniform float uTime;\n`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #include <map_fragment>
      // FPS-tuned water — May-17 2026. The original had 3 wave-front
      // sin() calls + a second multiplicative sin-pair for sparkle;
      // that's 5 trig ops per fragment over a ~30 % screen area pool.
      // Halved to 2 directional sins; sparkle dropped. Still reads as
      // sun-on-water from the camera angle; saves measurable shading
      // time at DPR=1.5.
      // SOFTER POND waves (May-25 2026) — lower wave frequency + smaller
      // amplitude for a tranquil koi-pond surface (vs the prior choppier
      // 1.20/-0.45 spatial frequencies). Slower time multipliers too.
      vec2 pUv = vUv * 4.0;
      float t = uTime;
      float w1 = sin(pUv.x * 0.85 + pUv.y * 0.40 + t * 0.42);
      float w2 = sin(pUv.x * -0.35 + pUv.y * 0.95 + t * 0.32);
      float ripple = (w1 + w2) * 0.5;
      // Color palette shifted 10 % darker + greenish-blue (more cyan,
      // less olive). Old: (0.04,0.16,0.13) → (0.09,0.30,0.24) → (0.28,0.52,0.42).
      // New: more blue channel, less green, all darker.
      vec3 deep   = vec3(0.03, 0.14, 0.16);
      vec3 mid    = vec3(0.07, 0.26, 0.28);
      vec3 bright = vec3(0.22, 0.46, 0.50);
      vec3 col = mix(deep, mid, 0.50 + ripple * 0.28);
      col = mix(col, bright, smoothstep(0.60, 1.0, abs(ripple)) * 0.18);
      diffuseColor.rgb = col;
      `,
    );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(SANCTUARY_POOL_CENTER_X, centerY, SANCTUARY_POOL_CENTER_Z);
  mesh.renderOrder = 4;
  mesh.name = "sanctuary_pool_water";
  mesh.userData.anuId = "environment.sanctuary.pool.water";
  mesh.userData.anuKind = "sanctuary_pool_water";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  return mesh;
}

function buildBasinFloor(centerY) {
  // Slightly smaller, slightly darker disc just below the water surface
  // — gives the pool depth without exposing the carved terrain.
  const geo = new THREE.CircleGeometry(SANCTUARY_POOL_RADIUS_M * 0.92, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x05181a),
    roughness: 1.0,
    metalness: 0.0,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    SANCTUARY_POOL_CENTER_X,
    centerY - SANCTUARY_POOL_DEPTH_M * 0.62,
    SANCTUARY_POOL_CENTER_Z,
  );
  mesh.receiveShadow = true;
  mesh.name = "sanctuary_pool_basin_floor";
  mesh.userData.anuId = "environment.sanctuary.pool.basin_floor";
  mesh.userData.anuKind = "sanctuary_pool_basin_floor";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  return mesh;
}

function buildDrainHole(centerY) {
  const group = new THREE.Group();
  group.name = "sanctuary_pool_drain_hole";
  group.userData.anuKind = "sanctuary_pool_drain_hole";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  // Sits at the bottom center of the carved pool basin
  const y = centerY - SANCTUARY_POOL_DEPTH_M * 0.62 + 0.005; // Elevated a tiny bit to prevent z-fighting with basin floor

  // Outer bronze rustic ring
  const ringGeo = new THREE.RingGeometry(0.35, 0.45, 32);
  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x4a3a2a), // dark rustic bronze/stone
    roughness: 0.85,
    metalness: 0.7,
    flatShading: true,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.rotation.x = -Math.PI / 2;
  ringMesh.position.set(SANCTUARY_POOL_CENTER_X, y, SANCTUARY_POOL_CENTER_Z);
  ringMesh.receiveShadow = true;
  ringMesh.userData.anuKind = "sanctuary_pool_drain_ring";
  ringMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(ringMesh);

  // Inner deep obsidian black disc
  const holeGeo = new THREE.CircleGeometry(0.35, 32);
  const holeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x010305), // deep black hole
    roughness: 1.0,
    metalness: 0.05,
  });
  const holeMesh = new THREE.Mesh(holeGeo, holeMat);
  holeMesh.rotation.x = -Math.PI / 2;
  holeMesh.position.set(SANCTUARY_POOL_CENTER_X, y + 0.001, SANCTUARY_POOL_CENTER_Z);
  holeMesh.receiveShadow = true;
  holeMesh.userData.anuKind = "sanctuary_pool_drain_depth";
  holeMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(holeMesh);

  return group;
}


function buildRim(centerY) {
  // Thin moss collar at the waterline — RingGeometry between water
  // radius and slightly beyond, dark green, lifted a hair above water.
  const geo = new THREE.RingGeometry(
    SANCTUARY_POOL_RADIUS_M * 0.96,
    SANCTUARY_POOL_RADIUS_M * 1.06,
    48,
  );
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x2c4123),
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    SANCTUARY_POOL_CENTER_X,
    centerY + 0.04,
    SANCTUARY_POOL_CENTER_Z,
  );
  mesh.name = "sanctuary_pool_moss_rim";
  mesh.userData.anuId = "environment.sanctuary.pool.moss_rim";
  mesh.userData.anuKind = "sanctuary_pool_moss_rim";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  return mesh;
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
 * Procedural lily-pad texture — 256×256 CanvasTexture.
 * Radial veins from center + edge darkening + subtle water droplets
 * give the pads a photo-real read without fetching any image asset.
 * Built ONCE, shared across all 14 pad meshes.
 */
function _makeLilyPadTexture() {
  const SZ = 256;
  const cv = document.createElement("canvas");
  cv.width = SZ; cv.height = SZ;
  const ctx = cv.getContext("2d");
  const cx = SZ / 2, cy = SZ / 2;

  // Base — radial gradient (lighter center, darker edge)
  const baseGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, SZ / 2);
  baseGrad.addColorStop(0.00, "#7ea15a");      // sunlit center
  baseGrad.addColorStop(0.55, "#4d6b34");      // mid green
  baseGrad.addColorStop(0.85, "#33491f");      // outer band
  baseGrad.addColorStop(1.00, "#1d2e10");      // dark edge
  ctx.fillStyle = baseGrad;
  ctx.beginPath(); ctx.arc(cx, cy, SZ / 2, 0, Math.PI * 2); ctx.fill();

  // Radial veins (12 visible)
  ctx.strokeStyle = "rgba(28, 42, 14, 0.55)";
  ctx.lineWidth = 1.5;
  const VEINS = 12;
  for (let i = 0; i < VEINS; i++) {
    const a = (i / VEINS) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
    ctx.lineTo(cx + Math.cos(a) * (SZ / 2 - 6), cy + Math.sin(a) * (SZ / 2 - 6));
    ctx.stroke();
  }

  // Sub-veins (32 hairline)
  ctx.strokeStyle = "rgba(30, 50, 18, 0.25)";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (SZ * 0.18), cy + Math.sin(a) * (SZ * 0.18));
    ctx.lineTo(cx + Math.cos(a) * (SZ / 2 - 8), cy + Math.sin(a) * (SZ / 2 - 8));
    ctx.stroke();
  }

  // Central spot (vein convergence)
  const spotGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
  spotGrad.addColorStop(0, "rgba(255, 240, 180, 0.6)");
  spotGrad.addColorStop(1, "rgba(40, 60, 22, 0)");
  ctx.fillStyle = spotGrad;
  ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill();

  // Scattered water-droplet highlights
  ctx.fillStyle = "rgba(255, 255, 255, 0.42)";
  for (let i = 0; i < 8; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 20 + Math.random() * (SZ / 2 - 40);
    const r = 2 + Math.random() * 3;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Build a beautiful lotus flower from stacked layered petals.
 * Three concentric rings, pink-to-white gradient. Casts shadow.
 */
function _buildLotusFlower(rng) {
  const flower = new THREE.Group();

  // Outer petal ring (8 petals, outer-most, deepest pink)
  const outerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf7c4d5),
    emissive: new THREE.Color(0x331a23),
    emissiveIntensity: 0.05,
    roughness: 0.6,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const outerGeo = new THREE.ConeGeometry(0.05, 0.13, 4);
  for (let i = 0; i < 8; i++) {
    const petal = new THREE.Mesh(outerGeo, outerMat);
    const a = (i / 8) * Math.PI * 2;
    petal.position.set(Math.cos(a) * 0.06, 0.045, Math.sin(a) * 0.06);
    petal.rotation.z = Math.cos(a) * -0.6;
    petal.rotation.x = Math.sin(a) *  0.6;
    petal.castShadow = true;
    petal.receiveShadow = true;
    flower.add(petal);
  }

  // Inner petal ring (6 petals, lighter)
  const innerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xfde6ef),
    emissive: new THREE.Color(0x402028),
    emissiveIntensity: 0.04,
    roughness: 0.55,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const innerGeo = new THREE.ConeGeometry(0.035, 0.10, 4);
  for (let i = 0; i < 6; i++) {
    const petal = new THREE.Mesh(innerGeo, innerMat);
    const a = (i / 6) * Math.PI * 2 + 0.3;
    petal.position.set(Math.cos(a) * 0.035, 0.075, Math.sin(a) * 0.035);
    petal.rotation.z = Math.cos(a) * -0.35;
    petal.rotation.x = Math.sin(a) *  0.35;
    petal.castShadow = true;
    flower.add(petal);
  }

  // Central pistil (gold/yellow)
  const pistilMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xf2c94c),
    emissive: new THREE.Color(0x6b4a10),
    emissiveIntensity: 0.4,
    roughness: 0.4,
    metalness: 0.1,
  });
  const pistil = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), pistilMat);
  pistil.position.y = 0.09;
  pistil.castShadow = true;
  flower.add(pistil);

  return flower;
}

function buildLilyPads(centerY) {
  const group = new THREE.Group();
  group.name = "sanctuary_lily_pads";
  group.userData.anuId = "environment.sanctuary.pool.lilies";
  group.userData.anuKind = "sanctuary_lily_pads";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  const rng = mulberry32(0xa55a55a5);

  // Higher-res circle (24 segments vs 10) for round photo-real silhouette.
  const padGeo = new THREE.CircleGeometry(0.45, 24);
  const padTex = _makeLilyPadTexture();
  const padMat = new THREE.MeshStandardMaterial({
    map: padTex,
    color: new THREE.Color(0xffffff),       // texture supplies all color
    roughness: 0.75,                        // wet leaf — slightly glossy
    metalness: 0.05,
    side: THREE.DoubleSide,
  });

  const PADS = 14;
  for (let i = 0; i < PADS; i++) {
    const ang = rng() * Math.PI * 2;
    const rNorm = 0.55 + rng() * 0.37;
    const r = rNorm * SANCTUARY_POOL_RADIUS_M;
    const x = SANCTUARY_POOL_CENTER_X + Math.cos(ang) * r;
    const z = SANCTUARY_POOL_CENTER_Z + Math.sin(ang) * r;

    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = rng() * Math.PI * 2;     // random vein orientation
    pad.position.set(x, centerY + 0.02 + rng() * 0.01, z);
    pad.scale.setScalar(0.7 + rng() * 0.7);
    pad.name = `sanctuary_lily_pad_${i}`;
    pad.userData.anuKind = "sanctuary_lily_pad";
    pad.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    pad.receiveShadow = true;                 // flower casts onto pad
    group.add(pad);

    // ~45% of pads carry a beautiful lotus flower.
    if (rng() < 0.45) {
      const flower = _buildLotusFlower(rng);
      flower.position.set(x, centerY + 0.025, z);
      flower.name = `sanctuary_lily_flower_${i}`;
      flower.userData.anuKind = "sanctuary_lily_flower";
      flower.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
      group.add(flower);
    }
  }
  return group;
}

export const SanctuaryPoolModule = {
  name: "SanctuaryPool",

  _scene: null,
  _root: null,
  _waterY: 0,
  _elapsed: 0,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;

    const groundCentre = sanctuaryGroundY(
      SANCTUARY_POOL_CENTER_X,
      SANCTUARY_POOL_CENTER_Z,
    );
    const waterY = groundCentre + SANCTUARY_POOL_DEPTH_M - SANCTUARY_WATER_DROP_M;
    this._waterY = waterY;
    // Park the water-Y where SanctuaryFish + SanctuaryDock can read it
    // without re-importing terrain logic.
    if (typeof window !== "undefined") window.__sanctuaryWaterY = waterY;

    const root = new THREE.Group();
    root.name = "sanctuary_pool_root";
    root.userData.anuId = "environment.sanctuary.pool";
    root.userData.anuKind = "sanctuary_pool";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    root.add(buildBasinFloor(waterY));
    root.add(buildDrainHole(waterY));
    root.add(buildWaterSurface(waterY));
    root.add(buildRim(waterY));
    root.add(buildLilyPads(waterY));

    scene.add(root);
    this._root = root;
    console.log(
      `%c[Sanctuary] 💧 Sacred pool ready @ Y=${waterY.toFixed(2)} (radius ${SANCTUARY_POOL_RADIUS_M.toFixed(1)} m)`,
      "color:#80deea;font-weight:bold;",
    );
  },

  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;
    _poolTimeUniform.value = this._elapsed;
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material.dispose?.();
      }
    });
    this._root = null;
    this._scene = null;
    if (typeof window !== "undefined") delete window.__sanctuaryWaterY;
  },
};
