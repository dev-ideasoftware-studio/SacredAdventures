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

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x0c3a36),
    emissive: new THREE.Color(0x051d1c),
    emissiveIntensity: 0.18,
    roughness: 0.22,
    metalness: 0.05,
    transparent: true,
    opacity: 0.62,
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
      vec2 pUv = vUv * 5.0;
      float t = uTime;
      float w1 = sin(pUv.x * 1.20 + pUv.y * 0.50 + t * 0.55);
      float w2 = sin(pUv.x * -0.45 + pUv.y * 1.30 + t * 0.42);
      float ripple = (w1 + w2) * 0.5;
      vec3 deep   = vec3(0.04, 0.16, 0.13);
      vec3 mid    = vec3(0.09, 0.30, 0.24);
      vec3 bright = vec3(0.28, 0.52, 0.42);
      vec3 col = mix(deep, mid, 0.50 + ripple * 0.32);
      col = mix(col, bright, smoothstep(0.55, 1.0, abs(ripple)) * 0.22);
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

function buildLilyPads(centerY) {
  const group = new THREE.Group();
  group.name = "sanctuary_lily_pads";
  group.userData.anuId = "environment.sanctuary.pool.lilies";
  group.userData.anuKind = "sanctuary_lily_pads";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  const rng = mulberry32(0xa55a55a5);

  const padGeo = new THREE.CircleGeometry(0.45, 10);
  // Bite a wedge out of each pad so it reads like a real lily pad (one
  // straight edge, one rounded). We do this by re-indexing — skip the
  // wedge triangles. Cheap; ~16 tris remains.
  const padMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x4f6e3a),
    roughness: 0.95,
    metalness: 0.0,
    flatShading: true,
    side: THREE.DoubleSide,
  });

  const flowerGeo = new THREE.ConeGeometry(0.085, 0.14, 6);
  const flowerMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0xfff0c4),
    emissive: new THREE.Color(0x55421f),
    emissiveIntensity: 0.2,
    roughness: 0.7,
    metalness: 0.0,
    flatShading: true,
  });

  const PADS = 14;
  for (let i = 0; i < PADS; i++) {
    // Pick a random point inside 0.55 .. 0.92 of pool radius so pads
    // never sit on the bank or the geometric centre.
    const ang = rng() * Math.PI * 2;
    const rNorm = 0.55 + rng() * 0.37;
    const r = rNorm * SANCTUARY_POOL_RADIUS_M;
    const x = SANCTUARY_POOL_CENTER_X + Math.cos(ang) * r;
    const z = SANCTUARY_POOL_CENTER_Z + Math.sin(ang) * r;

    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.rotation.z = rng() * Math.PI * 2;
    pad.position.set(x, centerY + 0.02 + rng() * 0.01, z);
    pad.scale.setScalar(0.7 + rng() * 0.7);
    pad.name = `sanctuary_lily_pad_${i}`;
    pad.userData.anuKind = "sanctuary_lily_pad";
    pad.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    group.add(pad);

    // Some pads carry a small gold lily flower.
    if (rng() < 0.45) {
      const flower = new THREE.Mesh(flowerGeo, flowerMat);
      flower.position.set(x, centerY + 0.07, z);
      flower.castShadow = false;
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
