/**
 * Sacred Adventures — sanctuary: SanctuaryPondTrees (Photorealistic GLB version)
 *
 * Recreates the misty sacred pond atmosphere using high-quality photorealistic
 * assets (tree.glb and reeds.glb) to match the reference photo exactly:
 *
 *   1. REEDS (Assets/flora/reeds.glb) — dense patches of photorealistic
 *      cattails/reeds at the water's edge.
 *
 *   2. TREES (Assets/tree.glb) — mixed deciduous treeline set back from the pond.
 *      To match the reference's mixed palette, we tint the cloned materials
 *      so that ~30% are warm golden autumn tones and the rest are dark forest greens.
 *
 *   3. FOG — blue-gray morning mist sitting just above the water.
 *
 * Anu domain: FLORA
 */

import * as THREE from "three";
import { clone as cloneGLTF } from "three/addons/utils/SkeletonUtils.js";
import { GLTFLoaderWithDraco } from "../v2/gltfLoaderSetup.js";

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

// ── Reference-matched palettes ────────────────────────────────────────────
// The GLB has its own textures, but we tint them using material.color
const GREENS = [
  new THREE.Color(0x596e4d), new THREE.Color(0x4f6444),
  new THREE.Color(0x45593c), new THREE.Color(0x5e7352),
  new THREE.Color(0x546949), new THREE.Color(0x637857),
];
const GOLDS = [
  new THREE.Color(0x8a9168), new THREE.Color(0x99a274),
  new THREE.Color(0x7c855a), new THREE.Color(0x848e62),
  new THREE.Color(0x9fa97a), new THREE.Color(0x8f996c),
];

// ── Config ────────────────────────────────────────────────────────────────
const REED_URL       = "./Assets/flora/reeds.glb";
const TREE_URL       = "./Assets/tree.glb";

const REED_PATCHES   = 24;  // was 36 — fewer reed clones, lighter PiP pass
const REED_INNER     = SANCTUARY_POOL_RADIUS_M - 1.2;
const REED_OUTER     = SANCTUARY_POOL_RADIUS_M + 3.0;

const TREE_COUNT     = 18;  // was 28 — trimmed for PiP performance
const TREE_INNER     = SANCTUARY_POOL_RADIUS_M + 8.0;
const TREE_OUTER     = SANCTUARY_POOL_RADIUS_M + 24.0;
const TREE_H_MIN     = 6.0;
const TREE_H_MAX     = 13.0;

const MIST_COLOR     = 0x9badb8;  // blue-gray haze matching the reference
const MIST_NEAR      = 35;
const MIST_FAR       = 105;

let _group  = null;
let _origFog = null;

// Helper to recursively tint materials on a cloned GLB
function _tintModel(model, colorHex) {
  model.traverse((child) => {
    if (child.isMesh && child.material) {
      // Clone the material so we don't tint all instances of the GLB
      child.material = child.material.clone();
      
      // If it's leaves (often uses alpha/transparency), tint it
      // Simple heuristic: if it's not mostly brown, it's probably foliage
      // Or we just tint everything slightly and rely on the texture
      child.material.color.multiply(colorHex);
      
      // Ensure photorealistic shading
      child.material.roughness = Math.max(0.7, child.material.roughness);
      child.material.metalness = 0.0;
    }
  });
}

function _enableShadows(model) {
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
}

// ── Module ────────────────────────────────────────────────────────────────
export const SanctuaryPondTreesModule = {
  name: "SanctuaryPondTrees",
  _scene: null,

  async load(scene) {
    this._scene = scene;
    const rand = lcg(101);

    // Save original fog so unload() can restore it
    _origFog = scene.fog;

    // Tighten fog to blue-gray morning mist matching the reference
    scene.fog = new THREE.Fog(MIST_COLOR, MIST_NEAR, MIST_FAR);
    if (scene.background?.isColor) {
      scene.background.set(0xb8ccd8);
    }

    _group = new THREE.Group();
    _group.name = "sanctuary_pond_trees";
    _group.userData.anuId = "environment.sanctuary.pondtrees";

    // Load photorealistic assets
    const loader = new GLTFLoaderWithDraco();
    let treeGltf = null;
    let reedGltf = null;
    
    try {
      [treeGltf, reedGltf] = await Promise.all([
        loader.loadAsync(TREE_URL).catch(() => null),
        loader.loadAsync(REED_URL).catch(() => null)
      ]);
    } catch (e) {
      console.warn("[SanctuaryPondTrees] Failed to load photoreal GLBs.", e);
    }

    if (reedGltf && reedGltf.scene) {
      const baseReed = reedGltf.scene;
      for (let i = 0; i < REED_PATCHES; i++) {
        const clone = cloneGLTF(baseReed);
        const a  = rand() * Math.PI * 2;
        const r  = REED_INNER + rand() * (REED_OUTER - REED_INNER);
        const px = SANCTUARY_POOL_CENTER_X + Math.cos(a) * r;
        const pz = SANCTUARY_POOL_CENTER_Z + Math.sin(a) * r;
        const gy = sanctuaryGroundY(px, pz);
        
        clone.position.set(px, gy - 0.2, pz); // sink slightly into bank
        clone.rotation.set(0, rand() * Math.PI * 2, 0);
        
        // Reeds usually come as patches in GLBs; scale them to fit
        const s = 1.0 + rand() * 0.8;
        clone.scale.set(s, s, s);
        
        _enableShadows(clone);
        _group.add(clone);
      }
    }

    if (treeGltf && treeGltf.scene) {
      const baseTree = treeGltf.scene;
      for (let i = 0; i < TREE_COUNT; i++) {
        const clone = cloneGLTF(baseTree);
        
        // Spread angle evenly then jitter
        const baseAngle = (i / TREE_COUNT) * Math.PI * 2;
        const a   = baseAngle + (rand()-0.5) * (Math.PI * 2 / TREE_COUNT) * 0.8;
        const r   = TREE_INNER + rand() * (TREE_OUTER - TREE_INNER);
        const px  = SANCTUARY_POOL_CENTER_X + Math.cos(a) * r;
        const pz  = SANCTUARY_POOL_CENTER_Z + Math.sin(a) * r;
        const gY  = sanctuaryGroundY(px, pz);

        clone.position.set(px, gY, pz);
        clone.rotation.y = rand() * Math.PI * 2;
        
        const hScale = (TREE_H_MIN + rand() * (TREE_H_MAX - TREE_H_MIN)) / 10.0 * 0.75; // 25% smaller (May-26 PiP trim)
        clone.scale.set(hScale * (0.8 + rand()*0.4), hScale, hScale * (0.8 + rand()*0.4));
        
        // Tint to match reference colors (mix of green and autumn gold)
        const isGold = rand() < 0.35;
        const pal = isGold ? GOLDS : GREENS;
        const col = pal[Math.floor(rand() * pal.length)];
        _tintModel(clone, col);
        
        _enableShadows(clone);
        
        clone.name = `pond_tree_glb_${i}`;
        _group.add(clone);
      }
    }

    scene.add(_group);

    console.log(
      "%c[SanctuaryPondTrees] 🌿 Photoreal GLB treeline + reeds — misty pond ready.",
      "color:#3d5629;font-weight:bold;",
    );
  },

  update(dt) {
    // Photoreal GLBs are static or have their own wind shaders; we just let them sit.
  },

  unload() {
    if (_group && this._scene) this._scene.remove(_group);
    if (this._scene && _origFog !== undefined) this._scene.fog = _origFog;
    _group  = null;
    this._scene = null;
  },
};
