/**
 * Sacred Adventures — sanctuary part 12 of N: BASELINE FLORA.
 *
 * Pass-B rewrite (May-18 2026): the prior implementation spawned ~300
 * Group/Mesh nodes for 50 flower clusters + 12 mushroom clusters + 40
 * grass tufts. Anu flagged `draw-calls SEVERE` (355 total) the moment
 * this module activated. The new implementation uses `InstancedMesh`
 * for every population:
 *
 *   • Stems         — 1 InstancedMesh (all wildflower stems share a
 *                      single dark-green stem material).
 *   • Blossoms      — 5 InstancedMesh (one per palette colour). Each
 *                      gets ~10 instances on a 50-cluster scatter.
 *   • Mushroom stems — 1 InstancedMesh (cream).
 *   • Mushroom caps — 3 InstancedMesh (red / cream / amber).
 *   • Grass tufts   — 1 InstancedMesh of a baked cross-quad geometry.
 *
 * Net draw calls for the entire flora layer: **~11** (was ~300). Anu's
 * `draw-calls` candidate should drop from SEVERE back to NOMINAL once
 * this lands.
 *
 * Anu tags are still per-domain (every mesh + the per-position random
 * userData on the InstancedMesh remains FLORA). Inheritance isn't
 * needed because the InstancedMesh ITSELF is the drawable Anu walks.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN, ANU_INTERACTION_VERB } from "../v2/anu/SimulationController.js";
import {
  sanctuaryGroundY,
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
} from "./SanctuaryGround.js";

const _floraTimeUniform = { value: 0 };

const FLOWER_CLUSTER_COUNT = 50;
const MUSHROOM_CLUSTER_COUNT = 12;
const GRASS_TUFT_COUNT = 40;

const FLOWER_PALETTE = [0xffb6c1, 0xffe97a, 0xc8a0ff, 0xffcc66, 0xff8c8c];
const MUSHROOM_PALETTE = [0xc94c3a, 0xe9c08a, 0xa56b3a];

function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function inMeadowZone(x, z) {
  const dx = x - SANCTUARY_POOL_CENTER_X;
  const dz = z - SANCTUARY_POOL_CENTER_Z;
  const r = Math.hypot(dx, dz);
  if (r < SANCTUARY_POOL_RADIUS_M + 1.5) return false;
  if (r > 38) return false;
  if (Math.abs(z) < 2 && x < -SANCTUARY_POOL_RADIUS_M) return false;
  return true;
}

/**
 * Bake a cross-quad geometry: two planes intersecting at 90° around Y
 * collapsed into a single BufferGeometry. Lets us use one InstancedMesh
 * for the entire grass-tuft population.
 */
function crossQuadGeometry(w, h) {
  const planeA = new THREE.PlaneGeometry(w, h);
  const planeB = new THREE.PlaneGeometry(w, h);
  planeB.rotateY(Math.PI / 2);
  // Merge by hand — two PlaneGeometry vertex arrays + two index arrays.
  const posA = planeA.attributes.position.array;
  const posB = planeB.attributes.position.array;
  const idxA = planeA.index.array;
  const idxB = planeB.index.array;

  const positions = new Float32Array(posA.length + posB.length);
  positions.set(posA, 0);
  positions.set(posB, posA.length);

  const indexCount = idxA.length + idxB.length;
  const indices = new Uint16Array(indexCount);
  for (let i = 0; i < idxA.length; i++) indices[i] = idxA[i];
  const offset = posA.length / 3;
  for (let i = 0; i < idxB.length; i++) indices[idxA.length + i] = idxB[i] + offset;

  // UVs: just repeat the planeA UVs over both halves.
  const uvA = planeA.attributes.uv.array;
  const uvCombined = new Float32Array(uvA.length * 2);
  uvCombined.set(uvA, 0);
  uvCombined.set(uvA, uvA.length);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvCombined, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  planeA.dispose();
  planeB.dispose();
  return geo;
}

// ── Shared geometries / materials ────────────────────────────────────
let _flowerStemGeo = null, _flowerBlossomGeo = null;
let _mushroomStemGeo = null, _mushroomCapGeo = null;
let _grassGeo = null, _grassMat = null;
let _stemMat = null, _mushroomStemMat = null;
const _flowerMats = new Map();
const _mushroomCapMats = new Map();

function applyWindSway(material, type) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = _floraTimeUniform;
    
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
      uniform float uTime;
      `
    );

    let heightFactor = "1.0";
    if (type === "stem") {
      heightFactor = "position.y";
    } else if (type === "blossom") {
      heightFactor = "0.20";
    } else if (type === "grass") {
      heightFactor = "(position.y + 0.15)";
    }

    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      
      #ifdef USE_INSTANCING
        vec3 instPos = instanceMatrix[3].xyz;
      #else
        vec3 instPos = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #endif
      
      // Compute wind sway using sine wave
      float sAngle = instPos.x * 2.0 + instPos.z * 1.5 + uTime * 2.5;
      float swayOffset = sin(sAngle) * 0.14 * ${heightFactor};
      float swayCos = cos(sAngle * 0.8) * 0.08 * ${heightFactor};
      
      transformed.x += swayOffset;
      transformed.z += swayCos;
      `
    );
  };
}

function flowerStemGeo() {
  if (_flowerStemGeo) return _flowerStemGeo;
  const g = new THREE.CylinderGeometry(0.012, 0.018, 0.20, 4);
  g.translate(0, 0.10, 0);
  _flowerStemGeo = g;
  return g;
}
function flowerBlossomGeo() {
  if (_flowerBlossomGeo) return _flowerBlossomGeo;
  _flowerBlossomGeo = new THREE.IcosahedronGeometry(0.06, 0);
  return _flowerBlossomGeo;
}
function stemMat() {
  if (_stemMat) return _stemMat;
  _stemMat = new THREE.MeshStandardMaterial({
    color: 0x3f5530, roughness: 0.9, metalness: 0.0, flatShading: true,
  });
  applyWindSway(_stemMat, "stem");
  return _stemMat;
}
function flowerMat(hex) {
  if (_flowerMats.has(hex)) return _flowerMats.get(hex);
  const m = new THREE.MeshStandardMaterial({
    color: hex,
    emissive: hex,
    emissiveIntensity: 0.12,
    roughness: 0.85,
    metalness: 0.0,
    flatShading: true,
  });
  applyWindSway(m, "blossom");
  _flowerMats.set(hex, m);
  return m;
}
function mushroomStemGeo() {
  if (_mushroomStemGeo) return _mushroomStemGeo;
  const g = new THREE.CylinderGeometry(0.03, 0.04, 0.14, 6);
  g.translate(0, 0.07, 0);
  _mushroomStemGeo = g;
  return g;
}
function mushroomCapGeo() {
  if (_mushroomCapGeo) return _mushroomCapGeo;
  const g = new THREE.SphereGeometry(0.10, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(1.0, 0.7, 1.0);
  _mushroomCapGeo = g;
  return g;
}
function mushroomStemMat() {
  if (_mushroomStemMat) return _mushroomStemMat;
  _mushroomStemMat = new THREE.MeshStandardMaterial({
    color: 0xe8e0c4, roughness: 0.9, metalness: 0.0, flatShading: true,
  });
  return _mushroomStemMat;
}
function mushroomCapMat(hex) {
  if (_mushroomCapMats.has(hex)) return _mushroomCapMats.get(hex);
  const m = new THREE.MeshStandardMaterial({
    color: hex, roughness: 0.85, metalness: 0.0, flatShading: true,
  });
  _mushroomCapMats.set(hex, m);
  return m;
}

function grassGeo() {
  if (_grassGeo) return _grassGeo;
  _grassGeo = crossQuadGeometry(0.45, 0.30);
  return _grassGeo;
}
function grassMat() {
  if (_grassMat) return _grassMat;
  // Photo-real grass tuft texture — May-18 2026 upgrade. Dense blade
  // pass (40 blades vs the prior 18), per-blade colour variation
  // pulling from a wider green palette including dry-yellow tips, a
  // soft base shadow that anchors the tuft to its ground plane, and
  // a higher-resolution canvas (128 vs 64) so anisotropic filtering
  // doesn't muddy the strokes from close camera angles.
  const SZ = 128;
  const cvs = document.createElement("canvas");
  cvs.width = SZ; cvs.height = SZ;
  const ctx = cvs.getContext("2d");
  ctx.clearRect(0, 0, SZ, SZ);
  // Base shadow at the foot of the tuft — soft dark ellipse.
  const baseShadow = ctx.createRadialGradient(SZ / 2, SZ * 0.94, 0, SZ / 2, SZ * 0.94, SZ * 0.35);
  baseShadow.addColorStop(0, "rgba(20, 30, 18, 0.32)");
  baseShadow.addColorStop(1, "rgba(20, 30, 18, 0)");
  ctx.fillStyle = baseShadow;
  ctx.fillRect(0, SZ * 0.70, SZ, SZ * 0.30);
  // 40 grass blades with rich colour variation.
  for (let i = 0; i < 40; i++) {
    const x = 14 + Math.random() * (SZ - 28);
    const tipY = 6 + Math.random() * (SZ * 0.62);
    const baseY = SZ - 4;
    // Per-blade colour: mostly green with occasional dry tips.
    const dryTip = Math.random() < 0.2;
    const r = 56 + Math.random() * (dryTip ? 130 : 70);
    const g = 110 + Math.random() * 90;
    const b = 40 + Math.random() * 50;
    const a = 0.55 + Math.random() * 0.45;
    ctx.strokeStyle = `rgba(${r|0},${g|0},${b|0},${a.toFixed(2)})`;
    ctx.lineWidth = 1.1 + Math.random() * 1.8;
    ctx.lineCap = "round";
    // Curve the blade with a quadratic so it has a natural arc.
    const lean = (Math.random() - 0.5) * 12;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(
      x + lean * 0.5,
      (baseY + tipY) / 2,
      x + lean,
      tipY,
    );
    ctx.stroke();
  }
  // Brighter highlight pass — paint a few blades on top in a brighter
  // colour so the tuft has a sun-kissed glint.
  for (let i = 0; i < 6; i++) {
    const x = 18 + Math.random() * (SZ - 36);
    const tipY = 8 + Math.random() * (SZ * 0.5);
    const baseY = SZ - 4;
    ctx.strokeStyle = `rgba(180, 220, 110, ${(0.55 + Math.random() * 0.25).toFixed(2)})`;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x, baseY);
    ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 8, (baseY + tipY) / 2, x + (Math.random() - 0.5) * 10, tipY);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(cvs);
  tex.anisotropy = 8;
  _grassMat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.30,
    depthWrite: true,
    side: THREE.DoubleSide,
    roughness: 0.96,
    metalness: 0.0,
  });
  applyWindSway(_grassMat, "grass");
  return _grassMat;
}

// ── Per-cluster placement pre-compute ─────────────────────────────────
function _sampleFlowerCluster(rng, x, z) {
  const out = [];
  const count = 3 + Math.floor(rng() * 3);
  const colour = FLOWER_PALETTE[Math.floor(rng() * FLOWER_PALETTE.length)];
  for (let i = 0; i < count; i++) {
    out.push({
      dx: (rng() - 0.5) * 0.6,
      dz: (rng() - 0.5) * 0.6,
      yJ: rng() * 0.06 - 0.02,
      colour,
      scale: 0.8 + rng() * 0.6,
    });
  }
  return out;
}

function _sampleMushroomCluster(rng, x, z) {
  const out = [];
  const count = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < count; i++) {
    out.push({
      dx: (rng() - 0.5) * 0.5,
      dz: (rng() - 0.5) * 0.5,
      scale: 0.7 + rng() * 0.7,
      colour: MUSHROOM_PALETTE[Math.floor(rng() * MUSHROOM_PALETTE.length)],
    });
  }
  return out;
}

/**
 * Stamp Anu tags directly on an InstancedMesh so the sensorium counts
 * it under the right domain (single tag covers every instance — Anu's
 * walker only inspects the InstancedMesh node, not each instance).
 */
function tagInstancedFlora(mesh, kind, interactable = false) {
  mesh.userData.anuKind = kind;
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
  if (interactable) {
    mesh.userData.anuInteractable = true;
    mesh.userData.anuInteractionVerbs = [
      ANU_INTERACTION_VERB.HARVEST,
      ANU_INTERACTION_VERB.INSPECT,
    ];
  }
}

export const SanctuaryFloraModule = {
  name: "SanctuaryFlora",

  _scene: null,
  _root: null,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;
    const rng = mulberry32(0x77f10ea);

    const root = new THREE.Group();
    root.name = "sanctuary_flora_baseline";
    root.userData.anuId = "flora.sanctuary.baseline";
    root.userData.anuKind = "sanctuary_flora_baseline";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;

    // ── PASS 1: pre-compute every flower/mushroom instance transform ──
    const flowerInstances = []; // { x, y, z, colour, scale }
    const stemInstances = [];   // wildflower stems (shared material)
    const mushroomStemInstances = [];
    const mushroomCapInstances = []; // { x, y, z, colour, scale }

    let placedF = 0;
    for (let attempt = 0; attempt < 400 && placedF < FLOWER_CLUSTER_COUNT; attempt++) {
      const ang = rng() * Math.PI * 2;
      const r = 14 + rng() * 24;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (!inMeadowZone(x, z)) continue;
      const groundY = sanctuaryGroundY(x, z) + 0.01;
      for (const slot of _sampleFlowerCluster(rng, x, z)) {
        const wx = x + slot.dx;
        const wz = z + slot.dz;
        stemInstances.push({ x: wx, y: groundY + slot.yJ, z: wz });
        flowerInstances.push({
          x: wx, y: groundY + slot.yJ + 0.22, z: wz,
          colour: slot.colour, scale: slot.scale,
        });
      }
      placedF++;
    }

    let placedM = 0;
    for (let attempt = 0; attempt < 200 && placedM < MUSHROOM_CLUSTER_COUNT; attempt++) {
      const ang = Math.PI + (rng() - 0.5) * Math.PI;
      const r = 14 + rng() * 22;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (!inMeadowZone(x, z)) continue;
      const groundY = sanctuaryGroundY(x, z) + 0.01;
      for (const slot of _sampleMushroomCluster(rng, x, z)) {
        const wx = x + slot.dx;
        const wz = z + slot.dz;
        mushroomStemInstances.push({ x: wx, y: groundY, z: wz, scale: slot.scale });
        mushroomCapInstances.push({
          x: wx, y: groundY + 0.14 * slot.scale, z: wz,
          colour: slot.colour, scale: slot.scale,
        });
      }
      placedM++;
    }

    let placedG = 0;
    const grassInstances = [];
    for (let attempt = 0; attempt < 300 && placedG < GRASS_TUFT_COUNT; attempt++) {
      const ang = rng() * Math.PI * 2;
      const r = 13 + rng() * 26;
      const x = Math.cos(ang) * r;
      const z = Math.sin(ang) * r;
      if (!inMeadowZone(x, z)) continue;
      grassInstances.push({
        x, y: sanctuaryGroundY(x, z) + 0.15, z,
        yaw: rng() * Math.PI * 2,
        scale: 0.7 + rng() * 0.6,
      });
      placedG++;
    }

    // ── PASS 2: build one InstancedMesh per material variant ──────────
    const dummy = new THREE.Object3D();

    // Wildflower stems — single InstancedMesh.
    if (stemInstances.length > 0) {
      const im = new THREE.InstancedMesh(flowerStemGeo(), stemMat(), stemInstances.length);
      stemInstances.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.name = "sanctuary_flora_flower_stems";
      tagInstancedFlora(im, "sanctuary_wildflower_stems");
      root.add(im);
    }

    // Wildflower blossoms — bucket by colour, one InstancedMesh per colour.
    const blossomBuckets = new Map();
    for (const f of flowerInstances) {
      if (!blossomBuckets.has(f.colour)) blossomBuckets.set(f.colour, []);
      blossomBuckets.get(f.colour).push(f);
    }
    for (const [colour, list] of blossomBuckets) {
      const im = new THREE.InstancedMesh(flowerBlossomGeo(), flowerMat(colour), list.length);
      list.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(p.scale, p.scale, p.scale);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.name = `sanctuary_flora_flower_blossoms_${colour.toString(16)}`;
      tagInstancedFlora(im, "sanctuary_wildflower_blossoms", true);
      root.add(im);
    }

    // Mushroom stems — single InstancedMesh.
    if (mushroomStemInstances.length > 0) {
      const im = new THREE.InstancedMesh(mushroomStemGeo(), mushroomStemMat(), mushroomStemInstances.length);
      mushroomStemInstances.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(p.scale, p.scale, p.scale);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.name = "sanctuary_flora_mushroom_stems";
      tagInstancedFlora(im, "sanctuary_mushroom_stems");
      root.add(im);
    }

    // Mushroom caps — bucket by colour.
    const capBuckets = new Map();
    for (const m of mushroomCapInstances) {
      if (!capBuckets.has(m.colour)) capBuckets.set(m.colour, []);
      capBuckets.get(m.colour).push(m);
    }
    for (const [colour, list] of capBuckets) {
      const im = new THREE.InstancedMesh(mushroomCapGeo(), mushroomCapMat(colour), list.length);
      list.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(p.scale, p.scale, p.scale);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.name = `sanctuary_flora_mushroom_caps_${colour.toString(16)}`;
      tagInstancedFlora(im, "sanctuary_mushroom_caps", true);
      root.add(im);
    }

    // Grass tufts — single cross-quad InstancedMesh.
    if (grassInstances.length > 0) {
      const im = new THREE.InstancedMesh(grassGeo(), grassMat(), grassInstances.length);
      grassInstances.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.yaw, 0);
        dummy.scale.set(p.scale, p.scale, p.scale);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
      im.name = "sanctuary_flora_grass_tufts";
      tagInstancedFlora(im, "sanctuary_grass_tufts");
      root.add(im);
    }

    scene.add(root);
    this._root = root;
    console.log(
      `%c[Sanctuary] 🌸 Flora INSTANCED — ${flowerInstances.length} blossoms across ${blossomBuckets.size} colours, ${mushroomCapInstances.length} mushroom caps, ${grassInstances.length} grass tufts. Draws: ${1 + blossomBuckets.size + 1 + capBuckets.size + 1}.`,
      "color:#ffb6c1;font-weight:bold;",
    );
  },

  _elapsed: 0,
  update(delta) {
    this._elapsed += delta;
    _floraTimeUniform.value = this._elapsed;
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
    });

    // Dispose materials and textures
    _flowerMats.forEach((m) => m.dispose?.());
    _flowerMats.clear();

    _mushroomCapMats.forEach((m) => m.dispose?.());
    _mushroomCapMats.clear();

    if (_grassMat) {
      _grassMat.map?.dispose?.();
      _grassMat.dispose?.();
      _grassMat = null;
    }
    if (_stemMat) {
      _stemMat.dispose?.();
      _stemMat = null;
    }
    if (_mushroomStemMat) {
      _mushroomStemMat.dispose?.();
      _mushroomStemMat = null;
    }

    _flowerStemGeo = null;
    _flowerBlossomGeo = null;
    _mushroomStemGeo = null;
    _mushroomCapGeo = null;
    _grassGeo = null;

    this._root = null;
    this._scene = null;
  },
};
