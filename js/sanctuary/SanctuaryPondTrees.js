/**
 * Sacred Adventures — sanctuary: SanctuaryPondTrees (InstancedMesh refactor)
 *
 * Recreates the misty sacred pond atmosphere using high-quality photorealistic
 * assets (tree.glb, bush.glb, and reeds.glb).
 *
 * All flora is now rendered using THREE.InstancedMesh to achieve massive density
 * (18 trees, 24 bushes, 14 reed patches; see the counts below), split into
 * angular sectors so three.js can frustum-cull the ring (CULL-01).
 *
 * Cedars (Mark 2026-10-22: "draw better trees, more random more cedar trees"):
 * procedural western red cedars (SanctuaryCedars.js) in random groves on the
 * hill ring around the village, kept out of the flat village ring, the open
 * valley mouth and the tipi circles. Kill switch: ?cedars=0.
 *
 * Billboards (culling guide E1.6, Mark: "use more billboards for distant
 * objects"): every tree, bush, reed patch and cedar is baked once into a card;
 * beyond the card distance (set by the Compassionate UI ladder) the main camera
 * sees the card instead of the 3D model. Cards face the pond centre; Village
 * View and the minimap always show 3D (SanctuaryImpostors.js). ?billboards=0.
 *
 * Anu domain: FLORA
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "../v2/gltfLoaderSetup.js";
import { deviceProfile } from "../v2/deviceProfile.js";
import { bakeImpostorAtlas, ImpostorField, billboardsDisabledByUser } from "./SanctuaryImpostors.js";
import { buildCedarMaterials, buildCedarModel, CEDAR_VARIANTS, CEDAR_MODEL_HEIGHT_M } from "./SanctuaryCedars.js";

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
const BUSH_URL       = "./Assets/bush.glb";

const REED_PATCHES   = 14;  // FPS T1: 24→14 (9,912 tris/patch ×24 ≈ 238k → ~139k; barely resolved behind MIST_FAR fog)
const REED_INNER     = SANCTUARY_POOL_RADIUS_M - 1.2;
const REED_OUTER     = SANCTUARY_POOL_RADIUS_M + 3.0;

const TREE_COUNT     = 18;  // Reverted from 36 because vertex processing was too heavy for shadows
const BUSH_COUNT     = 24;  // FPS T1: 36→24 (low ground clutter mostly behind reeds; ~31k tris saved)
const TREE_INNER     = SANCTUARY_POOL_RADIUS_M + 8.0;
const TREE_OUTER     = SANCTUARY_POOL_RADIUS_M + 24.0;
const TREE_H_MIN     = 3.5;
const TREE_H_MAX     = 7.0;

// Cedars: the hill ring (SanctuaryGround: village flat to 26 m, hills 28-52 m,
// open valley mouth ±45° around +Z, terrain square ±55 m).
const CEDAR_COUNT_DESKTOP = 120;
const CEDAR_COUNT_MOBILE  = 64;
const CEDAR_R_MIN         = 33;    // clear of the flat village ring and the hill foot
const CEDAR_EDGE_M        = 52;    // |x|, |z| ≤ this
const CEDAR_SPACING_M     = 3.4;   // minimum trunk spacing (scaled by tree size)
const CEDAR_H_MIN         = 7.0;
const CEDAR_H_MAX         = 12.5;
const CEDAR_TREE_GAP_M    = 4.0;   // from the pond ring's trees
const CEDAR_KEEPOUT_PAD_M = 3.0;   // around tipi circles, braziers, the village pad
const VALLEY_MOUTH_RAD    = Math.PI / 2;
const VALLEY_MOUTH_HALF   = Math.PI / 4;

// Billboards: beyond this distance from the main camera a tree is drawn as its card.
// The Compassionate UI ladder pulls it closer (setCardDistance).
const CARD_DISTANCE_DESKTOP_M = 45;
const CARD_DISTANCE_MOBILE_M  = 32;

const MIST_COLOR     = 0x9badb8;
const MIST_NEAR      = 35;
const MIST_FAR       = 105;

let _group  = null;
let _origFog = null;

// Helper to extract meshes from a GLB and create an InstancedMesh array
function buildInstancedMeshGroup(gltfScene, count, receiveShadow, castShadow, anuKind) {
  gltfScene.updateMatrixWorld(true);
  const instances = [];
  gltfScene.traverse((child) => {
    if (child.isMesh && child.geometry) {
      const mat = child.material ? child.material.clone() : new THREE.MeshStandardMaterial();
      mat.roughness = Math.max(0.7, mat.roughness || 0.7);
      mat.metalness = 0.0;
      
      // Inject wind sway shader logic
      if (anuKind.includes("tree") || anuKind.includes("bush") || anuKind.includes("reeds")) {
        mat.userData.uTime = { value: 0 };
        // 1 = sway; 0 = paused (Village View, SanctuaryCompassion): the shader skips all sway math.
        mat.userData.uWindOn = { value: 1 };
        SanctuaryPondTreesModule._materialsToUpdate.push(mat);

        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = mat.userData.uTime;
          shader.uniforms.uWindOn = mat.userData.uWindOn;
          
          shader.vertexShader = shader.vertexShader.replace(
            `#include <common>`,
            `#include <common>
            uniform float uTime;
            uniform float uWindOn;`
          );

          let swayScale = 0.02;
          let speedScale = 0.30;
          if (anuKind.includes("reeds")) {
            swayScale = 0.03;
            speedScale = 0.40;
          } else if (anuKind.includes("bush")) {
            swayScale = 0.025;
            speedScale = 0.35;
          }

          shader.vertexShader = shader.vertexShader.replace(
            `#include <begin_vertex>`,
            `#include <begin_vertex>
            if (uWindOn > 0.5) { // paused in Village View: skip all sway math
            // Synchronized travelling wind gust wave coming from West-Southwest (1.0, 0.8)
            vec2 windDir = vec2(0.78, 0.62);
            
            // Get instance translation coordinates
            #ifdef USE_INSTANCING
              vec3 instPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            #else
              vec3 instPos = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
            #endif

            // Project translation onto wind gust direction for phase offsets
            float distAlongWind = dot(instPos.xz, windDir);

            // Travelling wind gust swells (period ~7.5s)
            float gustSwell = 0.5 + 0.5 * sin(uTime * 0.84 - distAlongWind * 0.05);

            // Multi-frequency wind noise phase for sync'd forest-wide wave
            float windPhase = uTime * ${speedScale} - distAlongWind * 0.12;
            float windOsc = sin(windPhase) * 0.7 + cos(windPhase * 2.1) * 0.3;

            // Soft trunk sway: restricted to 1–4 degrees (0.017 to 0.07 rad)
            float trunkAngle = (0.017 + 0.035 * gustSwell * (0.5 + 0.5 * windOsc)) * (${swayScale} / 0.04);
            float h = max(0.0, position.y);
            float trunkSway = h * trunkAngle;

            // Branches/leaves: sway/flutter based on radial distance from trunk axis (position.xz)
            float radialDist = length(position.xz);
            // Higher frequency branch wiggling phase
            float branchPhase = uTime * (${speedScale} * 1.1) + position.x * 0.5 + position.z * 0.5 + distAlongWind * 0.1;
            float branchSway = sin(branchPhase) * (${swayScale} * 0.4) * radialDist * (h * 0.12 + 0.15);

            // Apply soft trunk sway along wind direction
            transformed.x += windDir.x * trunkSway;
            transformed.z += windDir.y * trunkSway;

            // Apply high-frequency branch fluttering/wiggling
            transformed.x += cos(branchPhase) * (${swayScale} * 0.25) * radialDist;
            transformed.z += branchSway;
            } // uWindOn
            `
          );
        };
      }
      
      const bakedGeo = child.geometry.clone();
      bakedGeo.applyMatrix4(child.matrixWorld);
      
      const im = new THREE.InstancedMesh(bakedGeo, mat, count);
      im.receiveShadow = receiveShadow;
      // FPS T1: alpha-mask leaf/foliage meshes must NOT cast shadows — an
      // alpha-tested shadow pass doubles their vertex cost into the 1024²
      // shadow map for a barely-visible result. Trunks/branches still cast.
      const isAlphaLeaf = mat.alphaTest > 0 || mat.transparent === true;
      im.castShadow = castShadow && !isAlphaLeaf;
      // FPS T1: frustumCulled true (was false). load() splits this mesh into
      // angular sectors after placement (splitIntoSectors, CULL-01), each with its
      // own bounding sphere, so wedges behind the camera are skipped.
      im.frustumCulled = true;
      im.layers.enable(1);
      
      im.name = anuKind;
      im.userData.anuKind = anuKind;
      instances.push(im);
    }
  });
  return instances;
}

// ── CULL-01: angular sectors so three.js can frustum-cull the ring ──────────
// Each ring InstancedMesh above holds every instance, so its bounding sphere wraps
// the whole ring around the pool and is never off-screen: all pond flora drew every
// frame whichever way the camera faced (probe: 601,788 of 947,559 triangles while
// facing away from the pool). This splits each placed InstancedMesh into up to
// FLORA_SECTORS wedges around the pool centre, each with its own bounding sphere,
// so wedges behind the camera are skipped. View-based only (ATT-04 / DEC-13): no
// instance is hidden, moved or recoloured; geometry and material stay shared, so
// the wind shader and _materialsToUpdate are unchanged.
const FLORA_SECTORS = 8;
// Wind moves vertices a little past the rest pose; pad each wedge's sphere so a
// swaying tree never pops at the screen edge (cf. FND-33, frozen fish-school sphere).
const FLORA_SECTOR_BOUNDS_PAD_M = 1.0;

function splitIntoSectors(im) {
  const n = im.count;
  const buckets = Array.from({ length: FLORA_SECTORS }, () => []);
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    im.getMatrixAt(i, m);
    p.setFromMatrixPosition(m);
    const a = Math.atan2(p.z - SANCTUARY_POOL_CENTER_Z, p.x - SANCTUARY_POOL_CENTER_X); // −π..π
    const s = Math.min(FLORA_SECTORS - 1, Math.floor(((a + Math.PI) / (Math.PI * 2)) * FLORA_SECTORS));
    buckets[s].push(i);
  }
  const out = [];
  const c = new THREE.Color();
  buckets.forEach((idx, s) => {
    if (idx.length === 0) return;
    const part = new THREE.InstancedMesh(im.geometry, im.material, idx.length);
    idx.forEach((src, dst) => {
      im.getMatrixAt(src, m);
      part.setMatrixAt(dst, m);
      if (im.instanceColor) { im.getColorAt(src, c); part.setColorAt(dst, c); }
    });
    part.instanceMatrix.needsUpdate = true;
    if (part.instanceColor) part.instanceColor.needsUpdate = true;
    part.receiveShadow = im.receiveShadow;
    part.castShadow = im.castShadow;
    part.frustumCulled = true;
    part.layers.mask = im.layers.mask;            // keeps layer 1 (minimap)
    part.name = im.name;                          // fishing/minimap rules match on name
    part.userData = { ...im.userData, floraSector: s };
    part.computeBoundingSphere();
    part.boundingSphere.radius += FLORA_SECTOR_BOUNDS_PAD_M;
    out.push(part);
  });
  // The un-split mesh is dropped. Do NOT dispose its geometry or material: the
  // sector meshes share them. Only its own per-instance buffers go with it.
  im.dispose();
  return out;
}

// ── Cedar groves ──────────────────────────────────────────────────────────
function cedarsDisabledByUser() {
  try {
    if (window.__sanctuaryCedarsOff === true) return true;
    const q = new URLSearchParams(window.location.search);
    return q.get("cedars") === "0" || q.get("cedars") === "off";
  } catch (_) {
    return false;
  }
}

/** Circles to keep clear: tipi circles, braziers, the village pad, seated NPCs. */
function cedarKeepOuts(scene) {
  const out = [];
  const box = new THREE.Box3(), c = new THREE.Vector3(), sz = new THREE.Vector3();
  for (const o of scene.children) {
    const kind = String(o.userData?.anuKind || "");
    if (!/sacred_circle_platform|sanctuary_brazier|sanctuary_village_pad|sanctuary_npc/.test(kind)) continue;
    box.setFromObject(o);
    if (!isFinite(box.min.x) || box.max.y - box.min.y > 50) continue;
    box.getCenter(c); box.getSize(sz);
    out.push({ x: c.x, z: c.z, r: Math.max(sz.x, sz.z) * 0.5 + CEDAR_KEEPOUT_PAD_M });
  }
  return out;
}

/** Groves and clearings: a smooth density field, so the forest is clumped, not even. */
function groveDensity(x, z) {
  return 0.5 + 0.42 * Math.sin(x * 0.085 + 1.3) * Math.cos(z * 0.075 - 0.4) + 0.24 * Math.sin((x - z) * 0.11 + 2.1);
}

function placeCedars(scene, treePositions, count, rand) {
  const keep = cedarKeepOuts(scene);
  const spots = [];
  const tint = new THREE.Color();
  const warm = new THREE.Color(0xd9e4b8), cool = new THREE.Color(0xc2d6c4);
  for (let attempt = 0; attempt < count * 80 && spots.length < count; attempt++) {
    const x = (rand() * 2 - 1) * CEDAR_EDGE_M;
    const z = (rand() * 2 - 1) * CEDAR_EDGE_M;
    const r = Math.hypot(x - SANCTUARY_POOL_CENTER_X, z - SANCTUARY_POOL_CENTER_Z);
    if (r < CEDAR_R_MIN) continue;
    let p = groveDensity(x, z);
    let ad = Math.abs(Math.atan2(z, x) - VALLEY_MOUTH_RAD);
    if (ad > Math.PI) ad = 2 * Math.PI - ad;
    if (ad < VALLEY_MOUTH_HALF) p *= 0.12;        // the approach stays open
    if (rand() > p) continue;
    if (keep.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
    if (treePositions.some((t) => Math.hypot(x - t.px, z - t.pz) < CEDAR_TREE_GAP_M)) continue;
    const h = CEDAR_H_MIN + rand() * (CEDAR_H_MAX - CEDAR_H_MIN);
    const room = CEDAR_SPACING_M * (0.75 + 0.5 * (h - CEDAR_H_MIN) / (CEDAR_H_MAX - CEDAR_H_MIN));
    if (spots.some((o) => Math.hypot(x - o.x, z - o.z) < Math.max(room, o.room))) continue;
    // Sink the buttress more on slopes so the downhill side never floats.
    const gy = sanctuaryGroundY(x, z);
    const slope = Math.max(
      Math.abs(sanctuaryGroundY(x + 0.8, z) - gy), Math.abs(sanctuaryGroundY(x - 0.8, z) - gy),
      Math.abs(sanctuaryGroundY(x, z + 0.8) - gy), Math.abs(sanctuaryGroundY(x, z - 0.8) - gy),
    );
    tint.setRGB(1, 1, 1).lerp(rand() < 0.5 ? warm : cool, rand() * 0.55);
    spots.push({
      x, z, y: gy - 0.15 - slope * 0.6, h, room,
      variant: Math.floor(rand() * CEDAR_VARIANTS) % CEDAR_VARIANTS,
      yaw: rand() * Math.PI * 2,
      widen: 0.88 + rand() * 0.24,
      color: tint.clone(),
    });
  }
  return spots;
}

// ── Module ────────────────────────────────────────────────────────────────
export const SanctuaryPondTreesModule = {
  name: "SanctuaryPondTrees",
  _scene: null,
  _materialsToUpdate: [],
  _time: 0,
  _windPaused: false,
  _field: null,          // SanctuaryImpostors.ImpostorField (billboards), or null
  _cedars: null,         // { materials, models, count }
  _topDown: false,

  async load(scene, camera, renderer) {
    this._scene = scene;
    this._materialsToUpdate = [];
    this._time = 0;
    this._windPaused = false;
    this._field = null;
    this._cedars = null;
    this._topDown = false;
    const mobile = deviceProfile.isMobile === true;
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
    let bushGltf = null;
    
    try {
      [treeGltf, reedGltf, bushGltf] = await Promise.all([
        loader.loadAsync(TREE_URL).catch(() => null),
        loader.loadAsync(REED_URL).catch(() => null),
        loader.loadAsync(BUSH_URL).catch(() => null)
      ]);
    } catch (e) {
      console.warn("[SanctuaryPondTrees] Failed to load photoreal GLBs.", e);
    }

    const _m = new THREE.Matrix4();
    const _p = new THREE.Vector3();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3();
    const _c = new THREE.Color();

    // ── REEDS ─────────────────────────────────────────────────────────────
    if (reedGltf && reedGltf.scene) {
      const reedMeshes = buildInstancedMeshGroup(reedGltf.scene, REED_PATCHES, true, false, "sanctuary_pond_reeds");
      for (let i = 0; i < REED_PATCHES; i++) {
        const a  = rand() * Math.PI * 2;
        const r  = REED_INNER + rand() * (REED_OUTER - REED_INNER);
        const px = SANCTUARY_POOL_CENTER_X + Math.cos(a) * r;
        const pz = SANCTUARY_POOL_CENTER_Z + Math.sin(a) * r;
        const gy = sanctuaryGroundY(px, pz);
        
        _p.set(px, gy - 0.2, pz);
        _q.setFromAxisAngle(new THREE.Vector3(0,1,0), rand() * Math.PI * 2);
        const s = 1.0 + rand() * 0.8;
        _s.set(s, s, s);
        _m.compose(_p, _q, _s);
        
        reedMeshes.forEach(im => {
          im.setMatrixAt(i, _m);
          im.setColorAt(i, new THREE.Color(0xffffff));
        });
      }
      reedMeshes.forEach(im => {
        // CULL-01: add one wedge mesh per sector instead of the ring-wide mesh.
        for (const part of splitIntoSectors(im)) _group.add(part);
      });
    }

    // ── TREES ─────────────────────────────────────────────────────────────
    const treePositions = [];
    if (treeGltf && treeGltf.scene) {
      const treeMeshes = buildInstancedMeshGroup(treeGltf.scene, TREE_COUNT, true, true, "sanctuary_pond_tree_dense");
      for (let i = 0; i < TREE_COUNT; i++) {
        const baseAngle = (i / TREE_COUNT) * Math.PI * 2;
        const a   = baseAngle + (rand()-0.5) * (Math.PI * 2 / TREE_COUNT) * 0.8;
        const r   = TREE_INNER + rand() * (TREE_OUTER - TREE_INNER);
        const px  = SANCTUARY_POOL_CENTER_X + Math.cos(a) * r;
        const pz  = SANCTUARY_POOL_CENTER_Z + Math.sin(a) * r;
        const gY  = sanctuaryGroundY(px, pz);
        treePositions.push({px, pz, gY});

        _p.set(px, gY, pz);
        _q.setFromAxisAngle(new THREE.Vector3(0,1,0), rand() * Math.PI * 2);
        
        const hScale = (TREE_H_MIN + rand() * (TREE_H_MAX - TREE_H_MIN)) / 10.0 * 0.75;
        _s.set(hScale * (0.8 + rand()*0.4), hScale, hScale * (0.8 + rand()*0.4));
        _m.compose(_p, _q, _s);
        
        const isGold = rand() < 0.35;
        const pal = isGold ? GOLDS : GREENS;
        const col = pal[Math.floor(rand() * pal.length)];
        _c.copy(col);
        
        treeMeshes.forEach(im => {
          im.setMatrixAt(i, _m);
          im.setColorAt(i, _c);
        });
      }
      treeMeshes.forEach(im => {
        // CULL-01: add one wedge mesh per sector instead of the ring-wide mesh.
        for (const part of splitIntoSectors(im)) _group.add(part);
      });
    }

    // ── BUSHES ────────────────────────────────────────────────────────────
    if (bushGltf && bushGltf.scene && treePositions.length > 0) {
      const bushMeshes = buildInstancedMeshGroup(bushGltf.scene, BUSH_COUNT, true, false, "sanctuary_pond_bush_dense");
      for (let i = 0; i < BUSH_COUNT; i++) {
        // Tie bushes to trees
        const tPos = treePositions[Math.floor(i / (BUSH_COUNT / TREE_COUNT)) % treePositions.length];
        
        const ba = rand() * Math.PI * 2;
        const br = 1.0 + rand() * 2.5; // distance from trunk
        const bx = tPos.px + Math.cos(ba) * br;
        const bz = tPos.pz + Math.sin(ba) * br;
        const by = sanctuaryGroundY(bx, bz);
        
        _p.set(bx, by, bz);
        _q.setFromAxisAngle(new THREE.Vector3(0,1,0), rand() * Math.PI * 2);
        
        // Multisized bushes
        const bScale = 0.6 + rand() * 1.5; 
        _s.set(bScale, bScale * (0.7 + rand() * 0.4), bScale);
        _m.compose(_p, _q, _s);
        
        // Match ethereal green and dark patterns
        // 50% dark green shadows, 50% ethereal bright greens
        const isDark = rand() > 0.5;
        if (isDark) {
           _c.setHex(0x1a3311).lerp(new THREE.Color(0x284d1a), rand());
        } else {
           _c.setHex(0x6b9954).lerp(new THREE.Color(0x8bc34a), rand());
        }
        
        bushMeshes.forEach(im => {
          im.setMatrixAt(i, _m);
          im.setColorAt(i, _c);
        });
      }
      bushMeshes.forEach(im => {
        // CULL-01: add one wedge mesh per sector instead of the ring-wide mesh.
        for (const part of splitIntoSectors(im)) _group.add(part);
      });
    }

    // ── CEDARS ────────────────────────────────────────────────────────────
    if (!cedarsDisabledByUser()) {
      try {
        const materials = buildCedarMaterials({ mobile });
        const models = Array.from({ length: CEDAR_VARIANTS }, (_, v) => buildCedarModel(v, materials, { mobile }));
        const spots = placeCedars(scene, treePositions, mobile ? CEDAR_COUNT_MOBILE : CEDAR_COUNT_DESKTOP, lcg(2026));
        for (let v = 0; v < CEDAR_VARIANTS; v++) {
          const mine = spots.filter((sp) => sp.variant === v);
          if (!mine.length) continue;
          // No shadow casting: the hill ring is mostly outside the key light's shadow map, and
          // 120 more casters would add shadow-pass draws for nothing visible.
          const cedarMeshes = buildInstancedMeshGroup(models[v], mine.length, true, false, `sanctuary_cedar_tree_${v}`);
          mine.forEach((sp, i) => {
            const k = sp.h / CEDAR_MODEL_HEIGHT_M;
            _p.set(sp.x, sp.y, sp.z);
            _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sp.yaw);
            _s.set(k * sp.widen, k, k * sp.widen);
            _m.compose(_p, _q, _s);
            cedarMeshes.forEach((im) => { im.setMatrixAt(i, _m); im.setColorAt(i, sp.color); });
          });
          cedarMeshes.forEach((im) => {
            im.userData.anuSimulationDomain = "flora";
            for (const part of splitIntoSectors(im)) _group.add(part);
          });
        }
        this._cedars = { materials, models, count: spots.length };
      } catch (e) {
        console.warn("[SanctuaryPondTrees] cedars skipped:", e);
      }
    }

    scene.add(_group);

    // ── BILLBOARDS (culling guide E1.6) ──────────────────────────────────
    if (renderer && camera && !billboardsDisabledByUser()) {
      try {
        const entries = [];
        if (treeGltf?.scene) entries.push({ key: "tree", object: treeGltf.scene });
        if (bushGltf?.scene) entries.push({ key: "bush", object: bushGltf.scene });
        if (reedGltf?.scene) entries.push({ key: "reeds", object: reedGltf.scene });
        (this._cedars?.models || []).forEach((m, v) => entries.push({ key: `cedar${v}`, object: m }));
        const atlas = bakeImpostorAtlas(renderer, entries, mobile
          ? { cellW: 128, cellH: 256, cols: 4 }
          : { cellW: 256, cellH: 512, cols: 4 });
        const field = new ImpostorField({
          camera, atlas, parent: _group,
          distanceM: mobile ? CARD_DISTANCE_MOBILE_M : CARD_DISTANCE_DESKTOP_M,
        });
        const kind = (name) => _group.children.filter((o) => o.isInstancedMesh && o.name === name);
        field.addKind("sanctuary_pond_tree_dense", kind("sanctuary_pond_tree_dense"), "tree");
        field.addKind("sanctuary_pond_bush_dense", kind("sanctuary_pond_bush_dense"), "bush");
        field.addKind("sanctuary_pond_reeds", kind("sanctuary_pond_reeds"), "reeds");
        for (let v = 0; v < CEDAR_VARIANTS; v++) field.addKind(`sanctuary_cedar_tree_${v}`, kind(`sanctuary_cedar_tree_${v}`), `cedar${v}`);
        field.setEnabled(!this._topDown);
        this._field = field;
      } catch (e) {
        console.warn("[SanctuaryPondTrees] billboards skipped:", e);
        this._field = null;
      }
    }
    this._installGlobal();

    const fs = this._field?.stats();
    console.log(
      `%c[SanctuaryPondTrees] 🌿 Instanced flora: ${TREE_COUNT} trees, ${BUSH_COUNT} bushes, ${REED_PATCHES} reed patches, ${this._cedars?.count ?? 0} cedars in ${_group.children.length} meshes; billboards ${fs ? `on (${fs.atlas.width}×${fs.atlas.height} atlas baked in ${fs.atlas.bakeMs} ms, cards beyond ${fs.distanceM} m)` : "off"}.`,
      "color:#3d5629;font-weight:bold;",
    );
  },

  /** Compassionate UI ladder: trees farther than this from the main camera are drawn as cards. */
  setCardDistance(m) {
    this._field?.setDistance(m);
  },

  /** Village View: every tree in 3D, no cards (guide E1.6). */
  setTopDown(on) {
    this._topDown = !!on;
    this._field?.setEnabled(!this._topDown);
  },

  _forestStats() {
    return {
      cedars: this._cedars?.count ?? 0,
      billboards: this._field ? this._field.stats() : null,
      topDown: this._topDown,
    };
  },

  _installGlobal() {
    const self = this;
    window.__sanctuaryForest = {
      stats: () => self._forestStats(),
      setCardDistance: (m) => self.setCardDistance(m),
      setTopDown: (on) => self.setTopDown(on),
    };
  },

  /** Village View (SanctuaryCompassion): freeze the wind clock and skip the sway
   *  math in the shader. The grass reads _time, so it pauses with the trees. */
  setWindPaused(paused) {
    this._windPaused = !!paused;
    for (let i = 0; i < this._materialsToUpdate.length; i++) {
      const w = this._materialsToUpdate[i].userData.uWindOn;
      if (w) w.value = this._windPaused ? 0 : 1;
    }
  },

  update(dt) {
    if (!this._windPaused) this._time += dt;
    this._field?.update();
    for (let i = 0; i < this._materialsToUpdate.length; i++) {
      const mat = this._materialsToUpdate[i];
      if (mat.userData.uTime) {
        mat.userData.uTime.value = this._time;
      }
    }
  },

  unload() {
    this._field?.dispose();
    this._field = null;
    if (this._cedars) {
      this._cedars.models.forEach((m) => m.traverse((o) => o.geometry?.dispose?.()));
      this._cedars.materials.textures.forEach((t) => t.dispose());
      this._cedars.materials.foliage.dispose();
      this._cedars.materials.trunk.dispose();
      this._cedars = null;
    }
    if (_group && this._scene) this._scene.remove(_group);
    if (this._scene && _origFog !== undefined) this._scene.fog = _origFog;
    _group  = null;
    this._materialsToUpdate = [];
    this._scene = null;
    if (window.__sanctuaryForest) delete window.__sanctuaryForest;
  },
};
