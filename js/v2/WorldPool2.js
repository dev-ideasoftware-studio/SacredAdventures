/**
 * Sacred Adventures v2 — Northern Forest Deep Pool ("POOL2").
 *
 * May-14 2026 rebuild. The user removed the original `pond1.glb`
 * PondEnclave ("its ugly") and asked for a real 3D pool at the same
 * anchor, ported from their "Forest Deep Pool" Three.js reference:
 *
 *   • Organic-edged stone basin with tiered shelves (~5 m deep).
 *   • Deep forest-green water surface with a shader-animated ripple
 *     pass (reused from the prior `createAnimatedWaterMaterial` shape,
 *     re-tuned to forest greens).
 *   • South-shore fishing pier with **terrain-height deck patch** so the
 *     avatar walks at deck level (WorldPhysics.registerDeckSurface).
 *   • **Glass orb** (`fish.obj` inside, journal-balloon lift height), not a tube.
 *   • Lily-pad disc cluster (`InstancedMesh`, single draw).
 *   • School of rainbow trout (`Assets/Fish/fish.obj`) on lazy lemniscates.
 *
 * Anu's budget envelope (from May-14 audit): ≤8 draws, ≤30k tris, ≤5 FPS
 * cost. PointLights from the reference design are deliberately skipped —
 * the reference used 6 underwater glow PointLights which alone would
 * have busted the per-frame light limit on the scene. The deep-green
 * basin material + water shader emissive sub-pass give the same
 * "mossy glow" read without spending real lights.
 */

import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import { terrainY } from "./WorldTerrain.js";
import { getSharedSacredLogBarkMaterial } from "./WorldStructures.js";
import {
  loadMossyRockGltfShared,
  plantMossyRockClone,
} from "./WorldMossyRock.js";
import { getRuntimeService } from "./RuntimeServices.js";
import { PLAYER_HEIGHT } from "./WorldPhysics.js";
import {
  V2_POND_ENCLAVE_CENTER_X_M,
  V2_POND_ENCLAVE_CENTER_Z_M,
  V2_POOL2_BASIN_DEPTH_M,
  V2_POOL2_BASIN_RADIUS_M,
  V2_POOL2_FISH_COUNT,
  V2_POOL2_FISH_SWIM_RADIUS_FRACTION,
  V2_POOL2_FISH_SWIM_RATE,
  V2_POOL2_FISH_TARGET_LENGTH_M,
  V2_POOL2_LILY_COUNT,
  V2_POOL2_SATELLITE_PONDS,
  V2_POOL2_SATELLITE_PONDS_LILY_COUNT,
  V2_POOL2_WATER_LEVEL_DROP_M,
  V2_POOL2_FISH_SHALLOW_FACTOR,
  V2_POOL2_FISH_SHALLOW_MAX,
  V2_POOL2_FISH_SHALLOW_TARGET_LENGTH_M,
  V2_POOL2_FISH_LIFE_SOLO_S,
  V2_POOL2_FISH_LIFE_SCHOOL_BLEND_S,
  V2_POOL2_FISH_LIFE_SCHOOL_S,
  V2_POOL2_FISH_LIFE_DISPERSE_S,
  V2_POOL2_FISH_OBSERVE_EXTRA_TILES,
  V2_TILE_WORLD,
  V2_CHARACTER_REFERENCE_HEIGHT_M,
  V2_TIPI_JOURNAL_BALLOON_ABOVE_APEX_M,
  V2_TIPI_SACRED_PLATFORM_CENTER_Y,
  V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M,
} from "./constants.js";

const FISH_OBJ_URL = "./Assets/Fish/fish.obj";

/** May-2026 user spec: on first step into pond water, school panics then relaxes ~5 s later. */
const POOL2_FISH_WATER_ENTER_SCATTER_S = 5;
/** Horizontal inset vs full basin rim so beach / lip doesn't flicker in/out (m). */
const POOL2_FISH_WATER_DISC_FR = 0.89;

/** Mirrors `WorldTipiJournalBalloon.js` balloon root placement (`apex + lift + 0.35 ft`). */
const V2_POOL2_GOLD_BALLOON_MATCH_TRIM_M = 0.35 * 0.3048;

/**
 * Deer herd loaded around the wooded sides of Pool2. They start in the
 * north/east/south/west tree line, wander/browse independently, and only
 * sometimes walk to the dry pond bank (never inside the water).
 *
 * Loaded once from `DEER_GLB_URL` (rigged `animal-pack` deer with Idle / Walk /
 * Eating / Gallop) and skeleton-cloned N× so the herd shares one network fetch.
 *
 * Each entry parameterises one deer:
 *  - `angleRad`: radial angle on the wooded spawn ring (0 = +X, π/2 = +Z).
 *  - `sizeMul`: scalar in `[0.82, 1.22]` (±~20 %, within the user's 25 %
 *    spec band) applied on top of `DEER_TARGET_HEIGHT_M`.
 *  - `tint`: a warm-coat hex multiplied into every cloned material so the
 *    four coats read as a herd, not a clone army.
 */
/**
 * Rigged deer with Idle / Walk / Eating / Gallop (`Assets/fauna/animal-pack/deer.glb`).
 * Legacy Tripo sculpt had no skeleton — walking read as ice-skating.
 */
const DEER_GLB_URL = "./Assets/fauna/animal-pack/deer.glb";
/** World-space yaw added to atan2(fx,fz) so model +Z faces the velocity vector. */
const DEER_WORLD_YAW_OFFSET = 0;
/** Deer belong at the tree line, not on the pond bank. */
const POOL2_DEER_FOREST_RING_M = V2_POOL2_BASIN_RADIUS_M + 10.5;
/** Hard exclusion radius used by deer wander / flee so hooves never enter water. */
const POOL2_WILDLIFE_EXCLUSION_M = V2_POOL2_BASIN_RADIUS_M + 5.5;
/** Dry bank stop: deer may visit the pond edge, but never cross the water exclusion. */
const POOL2_DEER_POND_VISIT_RING_M = POOL2_WILDLIFE_EXCLUSION_M + 1.25;
const POOL2_DEER_FOREST_WANDER_RADIUS_M = 5.5;
const POOL2_DEER_OBSERVE_RADIUS_M = 13.5;
const POOL2_DEER_OBSERVE_REFRESH_S = 0.75;
const POOL2_DEER_PERSONAL_SPACE_M = 2.7;
/** Reused so per-deer alert head-pitch doesn't allocate quaternions each frame. */
const _pool2DeerHeadQuat = new THREE.Quaternion();
const _pool2DeerHeadAxisPitch = new THREE.Vector3(1, 0, 0);
const _pool2ObserveVec = new THREE.Vector3();
const DEER_OBSERVABLE_NPC_KINDS = new Set([
  "npc_yb_tipi1_seated",
  "npc_bhg_tipi2_seated",
]);
/**
 * Disable the pond herd entirely (loads no GLB). Current asset is a low-poly
 * rig (~2k tris); Anu memory `tripo-asset-decimation` documents the old Tripo cost.
 */
const DEER_HERD_ENABLED = true;
/** How many entries from `DEER_HERD_PLACEMENT` actually spawn (cheap rig → small herd ok). */
const DEER_HERD_MAX = 4;
/**
 * Shoulder height for the base-size deer. May-15 2026 user fix #2 ("deer
 * is too small and half buried"). Bumped 1.3 m → 1.95 m so the herd reads
 * as adult elk-scale from the dock; with sizeMul variants the smallest
 * deer is still ~1.6 m, the largest ~2.34 m.
 */
const DEER_TARGET_HEIGHT_M = 1.95;
const DEER_HERD_PLACEMENT = Object.freeze([
  Object.freeze({ angleRad:  Math.PI / 2, sizeMul: 0.96, tint: 0xc99770 }), // north woods
  Object.freeze({ angleRad: 0,             sizeMul: 1.2,  tint: 0x8c6644 }), // east woods
  Object.freeze({ angleRad: -Math.PI / 2, sizeMul: 1.0,  tint: 0xb7835a }), // south woods
  Object.freeze({ angleRad: Math.PI,       sizeMul: 0.82, tint: 0xe5c9a0 }), // west woods
]);

/**
 * Sand-beach ring REMOVED — May-16 2026 user spec: "get rid of that
 * ugly border strip you are calling a sandbar around the pool its
 * ridiculous". The previous `buildPondSandBeach` ringed the pond with
 * a 1-ft warm-tan ribbon (`#d9bf86`) and from any oblique angle the
 * flat ring read as a fake stripe band. Deer no longer path to this
 * edge; they spawn and wander at the tree line while fish own the water.
 *
 * Replaced visually by procedural wetland foliage (cattails, reed blades,
 * willow-grass fans, and small wildflowers). See `buildReedsAroundPond`
 * below. This intentionally avoids the old `reeds.glb` asset path so the
 * shoreline stays art-directable and cheap.
 *
 * SEPARATELY — May-16 2026, second iteration — a wide **pond-BOTTOM**
 * sand bed was added that covers the full water disc, sitting just
 * above the carved basin floor (+0.6 m ≈ 2 ft). User wanted a real
 * mixed-grain sand floor visible through the translucent green water.
 * See `createPondBottomSandTexture` + `buildPondSandBottom` below —
 * totally distinct from the deleted ring decal.
 */

/**
 * Procedural underwater sand texture (CanvasTexture so we don't ship a
 * binary asset). Lays a warm-ochre base, then peppers it with:
 *   • lighter sand grains   (~5 % of pixels)
 *   • darker mud grains     (~3 % of pixels)
 *   • muted dark pebbles    (~0.6 % of pixels)
 *   • a low-frequency tonal field (stacked sines) so patches of redder /
 *     greyer sand mingle across the disc.
 * Wraps repeatedly so we can tile it across the wide pond floor.
 */
function createPondBottomSandTexture(size = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#a8895c";
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4;
    const px = idx % size;
    const py = (idx / size) | 0;
    const patch =
      Math.sin(px * 0.024) * Math.cos(py * 0.031) * 14 +
      Math.sin((px + py) * 0.07) * 7;
    const grain = (Math.random() - 0.5) * 28;
    data[i]     = Math.max(0, Math.min(255, data[i]     + patch * 0.7 + grain));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + patch * 0.4 + grain * 0.82));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + patch * 0.18 + grain * 0.55));
    if (Math.random() < 0.05) {
      data[i]     = Math.min(255, data[i]     + 38);
      data[i + 1] = Math.min(255, data[i + 1] + 30);
      data[i + 2] = Math.min(255, data[i + 2] + 18);
    }
    if (Math.random() < 0.03) {
      data[i]     = Math.max(0, data[i]     - 36);
      data[i + 1] = Math.max(0, data[i + 1] - 42);
      data[i + 2] = Math.max(0, data[i + 2] - 30);
    }
    if (Math.random() < 0.006) {
      data[i]     = Math.max(0, data[i]     - 70);
      data[i + 1] = Math.max(0, data[i + 1] - 60);
      data[i + 2] = Math.max(0, data[i + 2] - 40);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  tex.anisotropy = 8;
  return tex;
}

/**
 * Pond-bottom sand bed — wide organic-radius disc sitting +0.6 m above
 * the carved basin floor at the pond centre. Visible through the
 * translucent green water as the natural sandy pond floor.
 *
 * Uses the same `organicRadius` perimeter as `buildWaterSurface` so the
 * sand silhouette aligns with the waterline above (no visible sand band
 * protruding past the rim).
 *
 * Slight green-grey tint cools the warm sand so the through-water read
 * isn't garish. `renderOrder = 1` puts it well below the water surface
 * (which is `renderOrder = 4`).
 */
function buildPondSandBottom(cx, cz, terrainAtCenter) {
  const radius = V2_POOL2_BASIN_RADIUS_M;
  // `terrainAtCenter` is the deepest carved point; lift 0.6 m (2 ft).
  const sandY = terrainAtCenter + 0.6;
  const segs = 64;
  const geom = new THREE.CircleGeometry(radius, segs);
  const pos = geom.attributes.position;
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const angle = Math.atan2(y, x);
    const oR = organicRadius(angle, radius * 0.94);
    pos.setXY(i, Math.cos(angle) * oR, Math.sin(angle) * oR);
  }
  geom.computeVertexNormals();
  const tex = createPondBottomSandTexture(512);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9a8b66,
    map: tex,
    roughness: 0.94,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, sandY, cz);
  mesh.receiveShadow = true;
  mesh.renderOrder = 1;
  mesh.name = "pool2_sand_bottom";
  mesh.userData.anuId = "pool.pool2.sand_bottom";
  mesh.userData.anuKind = "landmark_pool_sand_bottom";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  return mesh;
}

/**
 * Procedural wetland builder. Replaces the old `reeds.glb` dependency with
 * simple instanced shapes: cattail stems + heads, willow-grass blades,
 * broad reed fans, and tiny meadow flowers. Five draw calls, zero assets.
 */
const WETLAND_STEM_COUNT = 126;
const WETLAND_BLADE_COUNT = 180;
const WETLAND_FAN_COUNT = 72;
const WETLAND_FLOWER_COUNT = 52;
const WETLAND_RING_RADIUS_BIAS_M = 0.16;
const WETLAND_RADIAL_JITTER_M = 1.25;
const WETLAND_AVATAR_HEIGHT_M = V2_CHARACTER_REFERENCE_HEIGHT_M;
const WETLAND_CATTAIL_HEIGHT_MIN_M = WETLAND_AVATAR_HEIGHT_M * 0.62;
const WETLAND_CATTAIL_HEIGHT_MAX_M = WETLAND_AVATAR_HEIGHT_M * 1.08;
const WETLAND_BLADE_HEIGHT_MIN_M = WETLAND_AVATAR_HEIGHT_M * 0.28;
const WETLAND_BLADE_HEIGHT_MAX_M = WETLAND_AVATAR_HEIGHT_M * 0.76;
const WETLAND_FAN_SCALE_MIN_M = WETLAND_AVATAR_HEIGHT_M * 0.26;
const WETLAND_FAN_SCALE_MAX_M = WETLAND_AVATAR_HEIGHT_M * 0.56;
const WETLAND_FLOWER_SCALE_MIN_M = WETLAND_AVATAR_HEIGHT_M * 0.045;
const WETLAND_FLOWER_SCALE_MAX_M = WETLAND_AVATAR_HEIGHT_M * 0.085;
const WETLAND_ARCS = Object.freeze([
  Object.freeze({ start: -2.95, end: -1.92, density: 0.88 }), // quiet west/south bank
  Object.freeze({ start: -1.34, end: -0.36, density: 0.74 }), // south-east
  Object.freeze({ start: 0.22, end: 1.05, density: 0.62 }),   // east
  Object.freeze({ start: 1.56, end: 2.34, density: 0.5 }),    // north-west, dock gap kept open
  Object.freeze({ start: 2.62, end: 3.08, density: 0.45 }),   // west glade
]);

function wetlandArcSample(rnd) {
  const total = WETLAND_ARCS.reduce((sum, a) => sum + (a.end - a.start) * a.density, 0);
  let pick = rnd() * total;
  for (const arc of WETLAND_ARCS) {
    const w = (arc.end - arc.start) * arc.density;
    if (pick <= w) return arc.start + (pick / w) * (arc.end - arc.start);
    pick -= w;
  }
  const fallback = WETLAND_ARCS[0];
  return fallback.start + rnd() * (fallback.end - fallback.start);
}

function buildWetlandBladeGeometry() {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      -0.055, 0, 0,
       0.055, 0, 0,
       0.012, 1, 0,
    ], 3),
  );
  geom.computeVertexNormals();
  return geom;
}

function buildWetlandFanGeometry() {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      0, 0, 0, -0.34, 0.55, 0.03, -0.10, 1.0, 0,
      0, 0, 0,  0.34, 0.55, -0.03, 0.10, 1.0, 0,
      0, 0, 0, -0.10, 0.48, -0.05, 0.10, 0.48, 0.05,
    ], 3),
  );
  geom.computeVertexNormals();
  return geom;
}

function buildReedsAroundPond(cx, cz) {
  const group = new THREE.Group();
  group.name = "pool2_wetland_foliage";
  group.userData.anuId = "pool.pool2.wetland_foliage";
  group.userData.anuKind = "landmark_pool_wetland_foliage";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;

  let seed = 0xc0ffee01;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const dummy = new THREE.Object3D();
  const placeOnBank = (angle, radialOffset = 0) => {
    const waterlineR = organicRadius(angle, V2_POOL2_BASIN_RADIUS_M * 0.94);
    const r =
      waterlineR +
      WETLAND_RING_RADIUS_BIAS_M +
      radialOffset +
      (rnd() - 0.5) * WETLAND_RADIAL_JITTER_M;
    const x = cx + Math.cos(angle) * r;
    const z = cz + Math.sin(angle) * r;
    return { x, z, y: terrainY(x, z) - 0.025, r };
  };

  const stemGeom = new THREE.CylinderGeometry(0.016, 0.026, 1, 6);
  const headGeom = new THREE.CylinderGeometry(0.055, 0.06, 0.38, 8);
  const bladeGeom = buildWetlandBladeGeometry();
  const fanGeom = buildWetlandFanGeometry();
  const flowerGeom = new THREE.IcosahedronGeometry(0.055, 0);

  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x55743a,
    roughness: 0.82,
    metalness: 0.01,
    emissive: 0x071606,
    emissiveIntensity: 0.12,
  });
  const cattailMat = new THREE.MeshStandardMaterial({
    color: 0x6f4a2f,
    roughness: 0.9,
    metalness: 0,
    emissive: 0x120804,
    emissiveIntensity: 0.08,
  });
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x6f8d45,
    roughness: 0.78,
    metalness: 0,
    emissive: 0x0b1e08,
    emissiveIntensity: 0.14,
    side: THREE.DoubleSide,
  });
  const fanMat = new THREE.MeshStandardMaterial({
    color: 0x799a52,
    roughness: 0.8,
    metalness: 0,
    emissive: 0x0b1a08,
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
  });
  const flowerMat = new THREE.MeshStandardMaterial({
    color: 0xdccf7d,
    roughness: 0.72,
    metalness: 0,
    emissive: 0x352a0b,
    emissiveIntensity: 0.16,
  });

  const stems = new THREE.InstancedMesh(stemGeom, stemMat, WETLAND_STEM_COUNT);
  const heads = new THREE.InstancedMesh(headGeom, cattailMat, WETLAND_STEM_COUNT);
  const blades = new THREE.InstancedMesh(bladeGeom, bladeMat, WETLAND_BLADE_COUNT);
  const fans = new THREE.InstancedMesh(fanGeom, fanMat, WETLAND_FAN_COUNT);
  const flowers = new THREE.InstancedMesh(flowerGeom, flowerMat, WETLAND_FLOWER_COUNT);

  for (const mesh of [stems, heads, blades, fans, flowers]) {
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  }
  stems.name = "pool2_wetland_cattail_stems";
  heads.name = "pool2_wetland_cattail_heads";
  blades.name = "pool2_wetland_reed_blades";
  fans.name = "pool2_wetland_willow_grass";
  flowers.name = "pool2_wetland_wildflowers";
  stems.userData.anuKind = heads.userData.anuKind = blades.userData.anuKind =
    fans.userData.anuKind = flowers.userData.anuKind = "landmark_pool_wetland_foliage";

  for (let i = 0; i < WETLAND_STEM_COUNT; i++) {
    const a = wetlandArcSample(rnd);
    const p = placeOnBank(a, -0.12 + rnd() * 0.65);
    const h =
      WETLAND_CATTAIL_HEIGHT_MIN_M +
      rnd() * (WETLAND_CATTAIL_HEIGHT_MAX_M - WETLAND_CATTAIL_HEIGHT_MIN_M);
    const w = 0.78 + rnd() * 0.55;
    dummy.position.set(p.x, p.y + h * 0.5, p.z);
    dummy.rotation.set((rnd() - 0.5) * 0.16, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.18);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);

    dummy.position.set(p.x, p.y + h * (0.88 + rnd() * 0.08), p.z);
    dummy.rotation.set((rnd() - 0.5) * 0.2, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.22);
    dummy.scale.setScalar(0.8 + rnd() * 0.45);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  }

  for (let i = 0; i < WETLAND_BLADE_COUNT; i++) {
    const a = wetlandArcSample(rnd);
    const p = placeOnBank(a, -0.55 + rnd() * 1.45);
    const h =
      WETLAND_BLADE_HEIGHT_MIN_M +
      rnd() * (WETLAND_BLADE_HEIGHT_MAX_M - WETLAND_BLADE_HEIGHT_MIN_M);
    const w = 0.7 + rnd() * 1.45;
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set((rnd() - 0.5) * 0.2, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.24);
    dummy.scale.set(w, h, w);
    dummy.updateMatrix();
    blades.setMatrixAt(i, dummy.matrix);
  }

  for (let i = 0; i < WETLAND_FAN_COUNT; i++) {
    const a = wetlandArcSample(rnd);
    const p = placeOnBank(a, 0.25 + rnd() * 1.65);
    const s =
      WETLAND_FAN_SCALE_MIN_M +
      rnd() * (WETLAND_FAN_SCALE_MAX_M - WETLAND_FAN_SCALE_MIN_M);
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set((rnd() - 0.5) * 0.16, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.18);
    dummy.scale.set(s * (1 + rnd() * 0.7), s, s);
    dummy.updateMatrix();
    fans.setMatrixAt(i, dummy.matrix);
  }

  for (let i = 0; i < WETLAND_FLOWER_COUNT; i++) {
    const a = wetlandArcSample(rnd);
    const p = placeOnBank(a, 1.25 + rnd() * 2.2);
    const s =
      WETLAND_FLOWER_SCALE_MIN_M +
      rnd() * (WETLAND_FLOWER_SCALE_MAX_M - WETLAND_FLOWER_SCALE_MIN_M);
    dummy.position.set(p.x, p.y + WETLAND_AVATAR_HEIGHT_M * (0.1 + rnd() * 0.09), p.z);
    dummy.rotation.set(rnd() * Math.PI, rnd() * Math.PI * 2, rnd() * Math.PI);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    flowers.setMatrixAt(i, dummy.matrix);
  }

  for (const mesh of [stems, heads, blades, fans, flowers]) {
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}

/**
 * If the target XZ falls inside the wildlife-exclusion disc around the
 * pool centre, project it radially outward to the disc rim. Used by deer
 * wander / flee / alert picks so panicked deer never end up wading into
 * the water (May-2026 user spec: "wildlife do not enter pool — only fish
 * belong"). The function is a no-op when the target is already outside.
 */
function pool2ClampOutsideExclusion(tx, tz, pcx, pcz, radius) {
  const dx = tx - pcx;
  const dz = tz - pcz;
  const d = Math.hypot(dx, dz);
  if (d >= radius) return { x: tx, z: tz };
  if (d < 1e-4) {
    // Degenerate: target sits exactly on centre — pick an arbitrary radial.
    return { x: pcx + radius, z: pcz };
  }
  return {
    x: pcx + (dx / d) * radius,
    z: pcz + (dz / d) * radius,
  };
}

function isPool2DeerObservableKind(kind) {
  return kind === "rabbit" || DEER_OBSERVABLE_NPC_KINDS.has(kind);
}

function collectPool2DeerObservables(scene) {
  if (!scene) return [];
  const refs = [];
  scene.traverse((obj) => {
    const kind = obj.userData?.anuKind;
    if (!isPool2DeerObservableKind(kind)) return;
    refs.push(obj);
  });
  return refs;
}

function nearestPool2DeerObservable(refs, x, z, radiusM) {
  let best = null;
  let bestD2 = radiusM * radiusM;
  for (const ref of refs || []) {
    if (!ref.parent) continue;
    ref.getWorldPosition(_pool2ObserveVec);
    const dx = _pool2ObserveVec.x - x;
    const dz = _pool2ObserveVec.z - z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= bestD2) continue;
    bestD2 = d2;
    best = {
      x: _pool2ObserveVec.x,
      z: _pool2ObserveVec.z,
      kind: ref.userData?.anuKind || "fauna",
      dist: Math.sqrt(d2),
    };
  }
  return best;
}

/**
 * Skeleton-clone one deer instance from a shared GLB template, scale it
 * so its shoulder height is `DEER_TARGET_HEIGHT_M × sizeMul`, and tint
 * every cloned material toward a warm coat color. Picks Idle / Walk /
 * Eating / Gallop clips (non-`AnimalArmature|` duplicates preferred) and
 * binds a fresh `AnimationMixer` per instance.
 *
 * Returns `{ root, mixer, idleAction, walkAction, eatAction, gallopAction,
 * headBone, finalScale, solesOffsetY }`. Caller positions `root` on the beach
 * and assigns yaw to face the pond centre.
 */
function spawnDeerInstance(template, animations, sizeMul, tintHex) {
  const root = cloneSkinned(template);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  const sourceH = Math.max(size.y, 0.001);
  const baseScale = DEER_TARGET_HEIGHT_M / sourceH;
  const finalScale = baseScale * sizeMul;
  root.scale.setScalar(finalScale);
  /**
   * May-15 2026 user fix #2 ("deer half buried in ground"). Prior code
   * shifted `root.position.y` to compensate for the bbox min, but the
   * caller then OVERWROTE `position.y` with `terrainY`, losing the soles
   * adjustment — the model dipped below ground.
   *
   * Fix: capture `solesOffsetY` (the world-space sole height in local
   * coords AFTER scale, ignoring `root.position`) and let the caller add
   * it on top of `terrainY` when placing the deer. We do NOT touch
   * `root.position.y` here.
   */
  root.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(root);
  const solesOffsetY = -box2.min.y; // shift to add ABOVE terrainY when planting

  const tint = new THREE.Color(tintHex);
  let headBone = null;
  const shortBoneName = (n) => String(n || "").replace(/^.*\|/, "");
  root.traverse((c) => {
    if (c.isSkinnedMesh && c.skeleton?.bones && !headBone) {
      for (const b of c.skeleton.bones) {
        const sn = shortBoneName(b.name);
        if (/^head$/i.test(sn)) {
          headBone = b;
          break;
        }
      }
    }
  });
  if (!headBone) {
    root.traverse((c) => {
      if (!c.isBone || headBone) return;
      const sn = shortBoneName(c.name);
      if (/^head$/i.test(sn)) headBone = c;
      else if (/head/i.test(sn) && !/horn|antler|jaw|tongue/i.test(sn)) {
        headBone = c;
      }
    });
  }

  root.traverse((c) => {
    if (c.isMesh || c.isSkinnedMesh) {
      c.castShadow = false;
      c.receiveShadow = false;
      c.frustumCulled = false; // skinned-mesh footgun (see WorldAvatar.js)
      const mats = Array.isArray(c.material) ? c.material : [c.material];
      const tinted = mats.map((m) => {
        if (!m) return m;
        const cloned = m.clone();
        if (cloned.color) cloned.color.multiply(tint);
        cloned.transparent = false;
        cloned.depthWrite = true;
        cloned.needsUpdate = true;
        return cloned;
      });
      c.material = Array.isArray(c.material) ? tinted : tinted[0];
    }
  });

  let mixer = null;
  let idleAction = null;
  let walkAction = null;
  let eatAction = null;
  let gallopAction = null;
  if (animations && animations.length > 0) {
    mixer = new THREE.AnimationMixer(root);
    const noDup = animations.filter((c) => !String(c.name || "").includes("|"));
    const pickExact = (name) => animations.find((c) => c.name === name);
    const pickRe = (list, re) => list.find((c) => re.test(String(c.name || "")));

    const idleClip =
      pickExact("Idle") ||
      pickRe(noDup, /^Idle$/i) ||
      pickExact("Idle_2") ||
      pickRe(noDup, /^Idle_2$/i) ||
      animations[0];
    const walkClip =
      pickExact("Walk") ||
      pickRe(noDup, /^Walk$/i) ||
      null;
    const eatClip =
      pickExact("Eating") ||
      pickRe(noDup, /^Eating$/i) ||
      null;
    const gallopClip =
      pickExact("Gallop") ||
      pickRe(noDup, /^Gallop$/i) ||
      null;

    idleAction = mixer.clipAction(idleClip);
    idleAction.setLoop(THREE.LoopRepeat, Infinity);
    idleAction.timeScale = 0.82 + Math.random() * 0.36;
    idleAction.play();
    idleAction.setEffectiveWeight(1);
    if (walkClip && walkClip !== idleClip) {
      walkAction = mixer.clipAction(walkClip);
      walkAction.setLoop(THREE.LoopRepeat, Infinity);
      walkAction.timeScale = 0.92 + Math.random() * 0.28;
      walkAction.play();
      walkAction.setEffectiveWeight(0);
    }
    if (eatClip) {
      eatAction = mixer.clipAction(eatClip);
      eatAction.setLoop(THREE.LoopRepeat, Infinity);
      eatAction.timeScale = 0.88 + Math.random() * 0.2;
      eatAction.play();
      eatAction.setEffectiveWeight(0);
    }
    if (gallopClip) {
      gallopAction = mixer.clipAction(gallopClip);
      gallopAction.setLoop(THREE.LoopRepeat, Infinity);
      gallopAction.timeScale = 1.02 + Math.random() * 0.16;
      gallopAction.play();
      gallopAction.setEffectiveWeight(0);
    }
  }

  return {
    root,
    mixer,
    idleAction,
    walkAction,
    eatAction,
    gallopAction,
    headBone,
    finalScale,
    solesOffsetY,
  };
}

/**
 * Organic radius generator — same noise pattern as the reference design.
 * Produces a pleasingly irregular pool perimeter so the pond doesn't read
 * as a perfect circle. Inputs: angle (rad), base radius (m). Output: the
 * effective radius at that angle.
 */
function organicRadius(angle, baseR) {
  const n1 = Math.sin(angle * 2.0) * 1.9;
  const n2 = Math.cos(angle * 3.5) * 1.1;
  const n3 = Math.sin(angle * 1.0) * 2.2;
  return baseR + n1 + n2 + n3;
}

/** Shared time uniform for the pool's animated water shader (one ref → many materials). */
const _pool2TimeUniform = { value: 0 };

/**
 * Forest-green water material. Same `onBeforeCompile` shape as the
 * prior PondEnclave water — re-tuned palette (deep emerald instead of
 * blue) so the pool reads as a mossy forest pond rather than open lake.
 */
function buildPool2WaterMaterial() {
  // May-17 2026 user spec ("cannot see fish, zindex of player avatar
  // is less than the water"). The pool's water surface was opaque
  // enough (opacity 0.86) that fish swimming below + any avatar pixels
  // overlapping the disc read as washed out / hidden. Drop opacity to
  // 0.55 so the trout school + lily-pad shadows + the player's silhouette
  // all show through cleanly. The water still reads as "water" (not a
  // hole) thanks to the emissive lift + animated wave shader below.
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x0a3b22),
    transparent: true,
    opacity: 0.55,
    roughness: 0.16,
    metalness: 0.04,
    emissive: new THREE.Color(0x041a0d),
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    defines: { USE_UV: "" },
  });
  /**
   * May-15 2026 user fix ("fix that hypnotic weird wave thing"). The
   * prior pass added vertex displacement + concentric expanding rings
   * which produced a pulsing bullseye effect on the water surface — the
   * user read this as a hypnotic disco, not a forest pond. Reverted to a
   * calm three-direction sin-wave ripple typical of stylised game water:
   * three small-amplitude wave fronts at different angles cross-pollinate
   * across the disc, with shimmer highlights. No vertex displacement, no
   * radial ring pulse. Anu's shared `_pool2TimeUniform` is still used so
   * the cost stays at one float write per frame across the pond + every
   * satellite pond.
   */
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPool2Time = _pool2TimeUniform;
    mat.userData._pool2TimeUniform = _pool2TimeUniform;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `
      #include <common>
      uniform float uPool2Time;
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #include <map_fragment>
      vec2 pUv = vUv * 8.0;
      float t = uPool2Time;
      // Three crossing wave fronts at different angles, low amplitude.
      // Direction vectors are pre-normalised to keep wavelength uniform.
      vec2 d1 = vec2( 0.92,  0.39);
      vec2 d2 = vec2(-0.55,  0.83);
      vec2 d3 = vec2( 0.31, -0.95);
      float w1 = sin(dot(pUv, d1) * 1.30 + t * 0.65);
      float w2 = sin(dot(pUv, d2) * 1.70 + t * 0.48);
      float w3 = sin(dot(pUv, d3) * 2.10 + t * 0.92);
      float ripple = (w1 + w2 + w3) * 0.33;
      // Colour palette — deep emerald to algae green.
      vec3 deep   = vec3(0.04, 0.18, 0.10);
      vec3 mid    = vec3(0.10, 0.34, 0.18);
      vec3 bright = vec3(0.34, 0.62, 0.36);
      vec3 col = mix(deep, mid, 0.50 + ripple * 0.30);
      col = mix(col, bright, smoothstep(0.55, 1.0, abs(ripple)) * 0.18);
      // Sparkle caustics — high-frequency shimmer only on wave crests.
      float crest = smoothstep(0.55, 1.0, ripple);
      float sparkle = sin(pUv.x * 14.0 + t * 1.05) * sin(pUv.y * 12.5 - t * 0.85);
      col += vec3(0.16, 0.30, 0.18) * smoothstep(0.78, 1.0, abs(sparkle)) * crest * 0.4;
      diffuseColor.rgb = col;
      `
    );
  };
  return mat;
}

/**
 * NOTE — May-14 2026: the previous `buildBasinFloor` helper was removed.
 * It produced a square `PlaneGeometry` overlay that, for vertices *outside*
 * the organic bowl perimeter, sat at the rim Y level — floating ~1.6 m
 * above the heightfield's carved bank as a dark `0x0a1a0d` shelf. From
 * the player's POV that read as "a black band of dirt surrounding the
 * pool" (the user's exact complaint). The carved heightfield in
 * `WorldTerrain.js` already supplies the bowl shape directly, so the
 * basin-floor mesh was redundant; through translucent water the player
 * now sees the natural hex-terrain grass darkening with depth, which is
 * the right "we can see the bottom" forest-pond read.
 */

/**
 * Water surface — circular disc tiled with the animated shader.
 * Vertices on the rim are jittered to the same organic radius as the
 * basin, so the waterline aligns with the bank silhouette.
 */
function buildWaterSurface(cx, cz, waterY) {
  const segs = 64;
  const radius = V2_POOL2_BASIN_RADIUS_M;
  const geom = new THREE.CircleGeometry(radius, segs);
  const pos = geom.attributes.position;
  // Vertex 0 is the centre; rim verts start at index 1.
  for (let i = 1; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const angle = Math.atan2(y, x);
    const oR = organicRadius(angle, radius * 0.94);
    pos.setXY(i, Math.cos(angle) * oR, Math.sin(angle) * oR);
  }
  geom.computeVertexNormals();
  const mat = buildPool2WaterMaterial();
  const water = new THREE.Mesh(geom, mat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, waterY, cz);
  water.renderOrder = 4;
  water.name = "pool2_water";
  water.userData.anuId = "pool.pool2.water";
  water.userData.anuKind = "landmark_pool_water";
  water.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  return water;
}

/** Clone sacred-log bark so dock UV tiling can differ without touching the tipi caches. */
function forkDockWoodMaterial(base) {
  const m = base.clone();
  for (const k of ["map", "roughnessMap", "bumpMap"]) {
    if (m[k]) {
      m[k] = m[k].clone();
      m[k].needsUpdate = true;
    }
  }
  m.map.repeat.set(5.5, 1.85);
  m.roughnessMap.repeat.copy(m.map.repeat);
  m.bumpMap.repeat.copy(m.map.repeat);
  return m;
}

const _hzRailDir = new THREE.Vector3();
function makeHorizontalLogCylinder(midX, y, midZ, dx, dz, len, rad, logMat) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 10, 1, false), logMat);
  mesh.position.set(midX, y, midZ);
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    _hzRailDir.set(dx, 0, dz).normalize(),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addDeckPost(group, x, z, topY, logMat, radius) {
  const ground = terrainY(x, z);
  const h = Math.max(0.35, topY - ground + 0.08);
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 1.03, h, 10, 1, false),
    logMat,
  );
  post.position.set(x, ground + h * 0.5 - 0.04, z);
  post.castShadow = true;
  post.receiveShadow = true;
  group.add(post);
}

/**
 * Advanced fishing pier: sacred-platform log bark, piled posts, double
 * rails, fishing overhang, and bank steps — replaces stone ramp + drowned bench.
 *
 * NORTH shore (`pierDirZ = −1`) per May-15 2026 user spec ("move pool
 * bridge across side of pool on NORTH side"). The pier extends from the
 * far (north) bank toward the pool centre. Set `pierDirZ = +1` to put it
 * back on the south shore.
 *
 * @returns {{ group: THREE.Group, woodMat: THREE.Material, pierTipZ: number, deckTopY: number, deckSurfacePatch: { id: string, minX: number, maxX: number, minZ: number, maxZ: number, y: number } }}
 */
function buildAdvancedFishingDock(cx, cz, waterY) {
  const R = V2_POOL2_BASIN_RADIUS_M;
  /** +1 = south shore (player-spawn side); −1 = north (far) shore — user-spec May-15 2026. */
  const pierDirZ = -1;
  const shoreZ = cz - pierDirZ * R * 0.91;
  /** Pier tip — heads toward pool centre along `pierDirZ`. */
  const tipZ = cz - pierDirZ * R * 0.34;
  const overhangStretch = Math.min(R * 0.068, 1.92);
  const deckBackZ = shoreZ + pierDirZ * 0.42;
  const deckFrontZ = tipZ + pierDirZ * overhangStretch * 0.94;
  const pierLen = Math.max(Math.abs(deckFrontZ - deckBackZ), 6.8);
  const deckFrontAdjusted = deckBackZ + pierDirZ * pierLen;
  const zMid = (deckBackZ + deckFrontAdjusted) * 0.5;

  const yShore = terrainY(cx, shoreZ);
  const yMid = terrainY(cx, deckBackZ + pierDirZ * pierLen * 0.5);
  const yTip = terrainY(cx, deckFrontAdjusted);
  const deckW = 5.4;
  const deckThick = 0.4;
  const deckTop = Math.max(yShore + 0.62, yMid + 0.52, yTip + 0.48, waterY + 0.78);

  const woodMat = forkDockWoodMaterial(getSharedSacredLogBarkMaterial());
  const group = new THREE.Group();
  group.name = "pool2_fishing_dock";
  group.userData.anuId = "pool.pool2.fishing_dock";
  group.userData.anuKind = "landmark_pool_dock";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;

  const deck = new THREE.Mesh(new THREE.BoxGeometry(deckW, deckThick, pierLen), woodMat);
  deck.position.set(cx, deckTop - deckThick * 0.5, zMid);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  const undersideY = deckTop - deckThick;
  const xL = cx - deckW * 0.46;
  const xR = cx + deckW * 0.46;
  const postR = 0.15;

  [
    [xL, deckBackZ + pierDirZ * pierLen * 0.22],
    [xR, deckBackZ + pierDirZ * pierLen * 0.22],
    [xL, deckBackZ + pierDirZ * pierLen * 0.72],
    [xR, deckBackZ + pierDirZ * pierLen * 0.72],
    [cx, deckBackZ + pierDirZ * 0.45],
    [cx, deckBackZ + pierDirZ * pierLen * 0.48],
    [cx, deckFrontAdjusted - pierDirZ * pierLen * 0.06],
    [cx, deckBackZ + pierDirZ * pierLen * 0.92],
  ].forEach(([px, pz]) => addDeckPost(group, px, pz, undersideY, woodMat, postR));

  const railLowerY = deckTop + 0.22;
  const railUpperY = deckTop + 0.76;
  const railRad = 0.072;
  const railInset = deckW * 0.465;
  const zx0 = deckBackZ + pierDirZ * pierLen * 0.06;
  const zx1 = deckFrontAdjusted - pierDirZ * pierLen * 0.045;
  const dz = zx1 - zx0;
  const lenRail = Math.abs(dz);
  const midZR = (zx0 + zx1) * 0.5;

  for (const edgeX of [cx - railInset, cx + railInset]) {
    group.add(makeHorizontalLogCylinder(edgeX, railLowerY, midZR, 0, dz, lenRail, railRad, woodMat));
    group.add(makeHorizontalLogCylinder(edgeX, railUpperY, midZR, 0, dz, lenRail, railRad, woodMat));
    const pillarH = railUpperY - railLowerY;
    for (const zz of [zx0, zx1, midZR]) {
      const stump = new THREE.Mesh(
        new THREE.CylinderGeometry(railRad * 1.4, railRad * 1.45, pillarH + 0.08, 8, 1, false),
        woodMat,
      );
      stump.position.set(edgeX, (railUpperY + railLowerY) * 0.5, zz);
      stump.castShadow = true;
      group.add(stump);
    }
  }

  /** Cantilever slab so anglers stand past the lily line. */
  const cant = new THREE.Mesh(
    new THREE.BoxGeometry(deckW * 0.92, deckThick * 0.85, deckW * 0.42),
    woodMat,
  );
  cant.position.set(cx, deckTop - deckThick * 0.38, deckFrontAdjusted + pierDirZ * deckW * 0.155);
  cant.castShadow = true;
  cant.receiveShadow = true;
  group.add(cant);

  const plankCount = Math.min(
    4,
    Math.max(2, Math.ceil(Math.max(0, deckTop - yShore - 0.12) / 0.26)),
  );
  for (let i = 0; i < plankCount; i++) {
    // Stairs descend AWAY from the pool, i.e. in the −pierDirZ direction.
    const pz = shoreZ - pierDirZ * (0.35 + i * 0.5);
    const drop = deckTop - (i + 1) * 0.2;
    if (terrainY(cx, pz) + 0.25 > deckTop && i === 0) break;
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(deckW * 0.95, 0.19, 0.52),
      woodMat,
    );
    step.position.set(cx, Math.max(drop, terrainY(cx, pz) + 0.12), pz);
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);
  }

  /** Built-in pew — log slab so kids have a perch without the old submerged cube. */
  const pew = new THREE.Mesh(new THREE.BoxGeometry(2.85, 0.36, 0.58), woodMat);
  pew.position.set(cx + deckW * 0.32, deckTop + 0.2, deckBackZ + pierDirZ * pierLen * 0.52);
  pew.castShadow = true;
  pew.receiveShadow = true;
  group.add(pew);

  const pierTipZ = deckFrontAdjusted + pierDirZ * deckW * 0.268;

  /**
   * Walkable deck footprint for `WorldPhysics.registerDeckSurface`.
   *
   * May-15 2026 user fix ("fix dock so player can stand on it"): prior
   * patch bounds were generous on every side (pad 0.95 + 3.1 m south of
   * the actual shore + a 5+ m overshoot past the pier tip). With
   * `deckTop ≈ shoreY + 0.62 m`, this caused the player to "step up" to
   * deck height several metres BEFORE reaching the dock mesh — feet
   * floated 0.62 m above the grass with no visible support, and the
   * "stand on" experience read as broken. Tighten the patch to the
   * actual deck box footprint (+ a small `pad` for stride width); the
   * stair planks have their own progressive height profile and don't
   * need to be part of this rectangle.
   *
   * Mesh footprint:
   *   • Main deck Box: X ∈ [cx − deckW/2, cx + deckW/2], Z ∈ [deckBackZ, deckFrontAdjusted].
   *   • Cantilever extension: Z up to deckFrontAdjusted + deckW × 0.155 + 0.21
   *     (cant geo z = deckW * 0.42; centred at deckFront + deckW * 0.155).
   */
  const pad = 0.2; // half stride width; enough to step on without ghost-floor.
  const cantHalfZ = deckW * 0.42 * 0.5;
  const cantCenterZ = deckFrontAdjusted + pierDirZ * deckW * 0.155;
  /**
   * Z extent: cantilever tip (into pool) ↔ bank approach grass (`shore` +
   * offset against `pierDirZ`). `_sampleGroundY` uses max(terrain, deck.y),
   * so natural ground outside the carve is unchanged.
   */
  const cantOuterZ = cantCenterZ + pierDirZ * (cantHalfZ + pad);
  const bankApproachZ = shoreZ - pierDirZ * R * 0.55;
  const deckSurfacePatch = {
    id: "pool2_fishing_dock_deck",
    minX: cx - deckW * 0.5 - pad,
    maxX: cx + deckW * 0.5 + pad,
    minZ: Math.min(cantOuterZ, bankApproachZ),
    maxZ: Math.max(cantOuterZ, bankApproachZ),
    y: deckTop,
  };

  return { group, woodMat, pierTipZ, deckTopY: deckTop, deckSurfacePatch };
}

/**
 * Tipi 1 journal-balloon world Y, computed from constants.
 *
 * May-15 2026 user spec ("fix the fish bubble to be same height as quest
 * balloon"). The fish bubble previously anchored its lift to the dock's
 * `deckTopY` (≈ 0.6 m above shore), so it floated at ~5 m world Y while
 * the journal balloon over tipi 1 sat at ~10.4 m. From the player POV the
 * bubble looked half the altitude of the quest marker, breaking the
 * read that they're the same kind of "hover landmark".
 *
 * Anchoring point matches `WorldStructures.js` tipi 1 placement and
 * `WorldTipiJournalBalloon.js` root placement:
 *   • Terrain at hex origin (0, 0) is exactly 0 (CLEARING_R bowl).
 *   • Platform centre Y = `V2_TIPI_SACRED_PLATFORM_CENTER_Y` (0.05 m).
 *   • Tipi GLB scaled to `V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M` (7.2 m)
 *     and lifted so its bbox min sits at `platformY − 0.05`.
 *   • Balloon Y = `apexY + V2_TIPI_JOURNAL_BALLOON_ABOVE_APEX_M + 0.35 ft`.
 *
 * Total: 0 + 0.05 + (7.2 − 0.05) + 3.048 + 0.107 = ~10.355 m world Y.
 */
function _tipi1JournalBalloonWorldY() {
  const platformY = V2_TIPI_SACRED_PLATFORM_CENTER_Y;
  const apexY = platformY - 0.05 + V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M;
  return apexY + V2_TIPI_JOURNAL_BALLOON_ABOVE_APEX_M + 0.35 * 0.3048;
}

/**
 * Glass **sphere** (round tank) at the **same world Y as the tipi 1 journal
 * quest balloon** (May-15 2026 user spec); `fish.obj` trout swim inside so
 * they read clearly through transmission.
 */
function buildDockGlassShowcase(cx, pierTipZ, deckTopY, fishGeometry, fishLen) {
  const sphereR = 1.14;
  /**
   * May-15 2026 user fix #3 ("polish the fish resource — its ugly fuzzy and
   * no kid in the world will think it looks good"). The prior glass was
   * tuned for cinematic transmission (`transmission 0.96`, `thickness 0.55`,
   * `attenuationDistance 1.85` blue tint), which through `MeshPhysicalMaterial`'s
   * thickness-attenuation model SMEARED everything behind it — fish read
   * as fuzzy silhouettes that no kid could parse.
   *
   * Tune for read-clarity instead of photoreal glass:
   *  - `transmission 0.72` (down from 0.96) → less refraction blur.
   *  - `thickness 0.06` (down from 0.55) → barely any attenuation depth.
   *  - `attenuationDistance 12` (up from 1.85) → no blue smear over the fish.
   *  - `roughness 0.06` and bumped `clearcoat 1` keep the orb sparkly.
   *  - Subtle `transparent` + `opacity 0.94` so the glass still reads as
   *    glass rather than disappearing.
   */
  /**
   * May-15 2026 user spec: "change the bubble … more like a balloon but a
   * fishbowl with no opacity just glass reflection like a fishbowl shape
   * and one big fish in it". Two changes:
   *  - Replace the perfect sphere with a classic **fishbowl** silhouette:
   *    wide round bowl, narrow lipped opening at the top. Built via
   *    `LatheGeometry` from a 2D profile.
   *  - Lose the transmission blur entirely — set `transmission: 0` so the
   *    glass has zero refractive distortion; the fish inside reads
   *    fully crisp. The orb still reads as glass via `transparent` +
   *    very low `opacity` + sharp `clearcoat` reflection.
   */
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xcfeefb,
    metalness: 0.0,
    roughness: 0.03,
    transmission: 0.0,
    thickness: 0.0,
    ior: 1.45,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 1.0,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.6,
  });
  // ── Fishbowl profile ──────────────────────────────────────────────────
  // Bowl silhouette: starts at base centre, swells to widest equator,
  // tapers to a small lip, then a flat collar at top. LatheGeometry
  // revolves the profile around Y. y ∈ [-sphereR, sphereR] keeps the
  // overall size compatible with prior placement and the avatar travel
  // ring math.
  const bowlProfile = [];
  const segsP = 18;
  for (let i = 0; i <= segsP; i++) {
    const ty = i / segsP;
    // Map t to a fishbowl silhouette:
    //   ty=0    → base centre (small radius)
    //   ty≈0.4  → widest equator (full radius)
    //   ty≈0.85 → necks in to lip
    //   ty=1    → collar (flat top opening)
    const y = -sphereR + ty * (sphereR * 2);
    let r;
    if (ty < 0.06) {
      // Tiny flat base so the bowl looks like it could sit on a counter.
      r = sphereR * 0.46;
    } else if (ty < 0.55) {
      // Lower hemisphere swells to widest at ty=0.45.
      const u = (ty - 0.06) / 0.49;
      r = sphereR * (0.46 + Math.sin(u * Math.PI * 0.5) * 0.54);
    } else if (ty < 0.95) {
      // Upper hemisphere tapers to a narrow lip.
      const u = (ty - 0.55) / 0.40;
      r = sphereR * (1.0 - Math.sin(u * Math.PI * 0.5) * 0.62);
    } else {
      // Collar/lip — a slight outward flare at the very top.
      r = sphereR * 0.42;
    }
    bowlProfile.push(new THREE.Vector2(r, y));
  }
  const sphereGeo = new THREE.LatheGeometry(bowlProfile, 48);
  const ball = new THREE.Mesh(sphereGeo, glassMat);
  ball.renderOrder = 12;

  /**
   * May-15 2026 user spec ("make the fishbowl look like a balloon, same
   * height as quest ballon 1"). Mirror the journal-balloon visual
   * vocabulary: add a small upside-down cone "knot" hanging below the
   * bowl base. Material reuses `glassMat` so the knot reads as part of
   * the same hollow glass enclosure rather than a separate prop.
   */
  const knotGeo = new THREE.ConeGeometry(sphereR * 0.18, sphereR * 0.32, 14);
  const knot = new THREE.Mesh(knotGeo, glassMat);
  knot.position.y = -sphereR - sphereR * 0.16;
  knot.rotation.x = Math.PI; // tip pointing DOWN
  knot.renderOrder = 12;
  ball.add(knot);

  const root = new THREE.Group();
  root.name = "pool2_dock_glass_showcase";
  root.userData.anuId = "pool.pool2.dock_glass_showcase";
  root.userData.anuKind = "landmark_pool_dock_glass";
  root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  root.add(ball);

  /**
   * Anchor at the SAME world Y as the tipi 1 journal quest balloon (May-15
   * 2026 user spec). Both hover landmarks now read at matching altitude,
   * so the village's "ask here" cues live at one consistent height band.
   * `deckTopY` and `V2_POOL2_GOLD_BALLOON_MATCH_TRIM_M` are kept as
   * locals in case a future tuning pass wants a dock-relative offset.
   */
  void V2_POOL2_GOLD_BALLOON_MATCH_TRIM_M;
  void deckTopY;
  const balloonMatchWorldY = _tipi1JournalBalloonWorldY();
  root.position.set(cx, balloonMatchWorldY, pierTipZ);
  root.renderOrder = 6;

  /**
   * May-15 2026 user spec: "and one big fish in it, swimming just like in
   * screenshot". Drop count 2 → 1. Bigger again so the fish fills the
   * bowl's widest equator — fills the icon's silhouette so kids recognise
   * the FISH resource at a glance.
   */
  const targetFishLen = 1.05;
  const fishScale = targetFishLen / Math.max(fishLen, 0.001);
  const fishInnerMat = new THREE.MeshStandardMaterial({
    color: 0x2b6ffe, // exact guidebook blue
    roughness: 0.28,
    metalness: 0.3,
    emissive: 0x1a4ed8,
    emissiveIntensity: 0.4,
  });
  /** @type {THREE.Mesh[]} */
  const showcaseFishMeshes = [];
  /** @type {THREE.BufferGeometry[]} */
  const showcaseFishGeometries = [];

  {
    const g = fishGeometry.clone();
    const f = new THREE.Mesh(g, fishInnerMat);
    f.scale.setScalar(fishScale);
    f.castShadow = true;
    f.receiveShadow = false;
    f.renderOrder = 4;
    root.add(f);
    showcaseFishMeshes.push(f);
    showcaseFishGeometries.push(g);
  }

  return {
    group: root,
    showcaseFishMeshes,
    glassMat,
    fishInnerMat,
    sphereGeo,
    showcaseFishGeometries,
    sphereR,
  };
}

/**
 * Procedural “reflection” art: fishbowl + water + guidebook-blue trout read,
 * baked for a flat deck decal (visual cue for fishing / collection).
 */
function createFishbowlFloorMirrorTexture(size = 1024) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.48;

  ctx.clearRect(0, 0, size, size);

  const baseGrad = ctx.createRadialGradient(cx, cy, R * 0.08, cx, cy, R);
  baseGrad.addColorStop(0, "rgba(230, 248, 255, 0.94)");
  baseGrad.addColorStop(0.35, "rgba(160, 210, 255, 0.78)");
  baseGrad.addColorStop(0.72, "rgba(90, 150, 210, 0.55)");
  baseGrad.addColorStop(1, "rgba(44, 92, 140, 0.16)");

  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = baseGrad;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.92, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.44)";
  ctx.lineWidth = size * 0.022;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, R * 0.98, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(200, 235, 255, 0.26)";
  ctx.lineWidth = size * 0.007;
  ctx.stroke();

  for (let i = 0; i < 140; i++) {
    const ang = (i * 2.618) % (Math.PI * 2);
    const rad = R * (0.12 + (i % 97) * 0.007);
    const px = cx + Math.cos(ang) * rad;
    const py = cy + Math.sin(ang) * rad;
    const g = ctx.createRadialGradient(px, py, 0, px, py, 6 + (i % 8));
    g.addColorStop(0, `rgba(255, 255, 255, ${0.05 + (i % 5) * 0.018})`);
    g.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.save();
  ctx.translate(cx + R * 0.06, cy + R * 0.04);
  ctx.rotate(-0.28);
  const fishGrad = ctx.createLinearGradient(-R * 0.35, 0, R * 0.35, 0);
  fishGrad.addColorStop(0, "rgba(18, 52, 160, 0.92)");
  fishGrad.addColorStop(0.5, "rgba(43, 111, 254, 0.95)");
  fishGrad.addColorStop(1, "rgba(12, 40, 120, 0.88)");
  ctx.fillStyle = fishGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 0.28, R * 0.11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-R * 0.28, 0);
  ctx.lineTo(-R * 0.52, -R * 0.08);
  ctx.lineTo(-R * 0.52, R * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const hi = ctx.createRadialGradient(
    cx - R * 0.22,
    cy - R * 0.28,
    0,
    cx,
    cy,
    R * 0.7,
  );
  hi.addColorStop(0, "rgba(255, 255, 255, 0.55)");
  hi.addColorStop(0.35, "rgba(255, 255, 255, 0.08)");
  hi.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = hi;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/** Flat circle on the dock boards at the pier tip — “mirror” cue for the glass fishbowl above. */
function buildDockFishingSpotMirrorDecal(cx, pierTipZ, deckTopY) {
  const radiusM = 1.12;
  const geo = new THREE.CircleGeometry(radiusM, 72);
  geo.rotateX(-Math.PI / 2);
  const map = createFishbowlFloorMirrorTexture(1024);
  const mat = new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    opacity: 1,
    roughness: 0.42,
    metalness: 0.18,
    emissive: new THREE.Color(0x1a3355),
    emissiveIntensity: 0.14,
    envMapIntensity: 0.9,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "pool2_dock_fishing_spot_decal";
  mesh.userData.anuId = "pool.pool2.dock_fishing_spot_decal";
  mesh.userData.anuKind = "landmark_pool_fishing_circle";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  mesh.position.set(cx, deckTopY + 0.016, pierTipZ);
  mesh.renderOrder = 5;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * Lily-pad cluster — one `InstancedMesh` regardless of count. Pads sit
 * just above the water plane, scattered inside the organic radius, with
 * a random Y-yaw so the leaf cluster doesn't look stamped.
 */
function buildLilyPads(cx, cz, waterY, count) {
  const padGeom = new THREE.CircleGeometry(0.65, 18);
  padGeom.rotateX(-Math.PI / 2);
  // Pad colour pulled toward the scene's meadow / horizon palette
  // (terrain hemi ground 0x4a7c3f, horizon ring 0x6fa858) so the pads
  // harmonise with surrounding grass instead of reading as a near-black
  // patch on the water (May-2026 user).
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x4a7c3f,
    roughness: 0.7,
    emissive: 0x1a3a14,
    emissiveIntensity: 0.18,
    side: THREE.DoubleSide,
  });
  const inst = new THREE.InstancedMesh(padGeom, padMat, count);
  inst.name = "pool2_lily_pads";
  inst.userData.anuId = "pool.pool2.lily_pads";
  inst.userData.anuKind = "landmark_pool_lily";
  inst.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  inst.castShadow = false;
  inst.receiveShadow = true;
  const dummy = new THREE.Object3D();
  // Deterministic seeded RNG so reload is identical.
  let seed = 0xdeadbeef;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const angle = rnd() * Math.PI * 2;
    const oR = organicRadius(angle, V2_POOL2_BASIN_RADIUS_M);
    const r = (0.18 + rnd() * 0.72) * oR;
    dummy.position.set(
      cx + Math.cos(angle) * r,
      waterY + 0.06,
      cz + Math.sin(angle) * r,
    );
    dummy.rotation.y = rnd() * Math.PI;
    const s = 0.7 + rnd() * 0.7;
    dummy.scale.set(s, 1, s);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}

/**
 * Build one satellite pond — a small wide pond with the same forest-green
 * water shader as the main POOL2, sized for an intimate "wishing pool"
 * read instead of a duplicate basin.
 *
 * May-14 2026 user refactor (see `V2_POOL2_SATELLITE_PONDS` doc): replaces
 * the prior 3-stream ribbon system. Streams looked fake because the
 * heightfield carve ran along a polyline centre and the water ribbon
 * crossed the hill ring (`terrainY` adds up to 4 m between dist ∈ [30, 60]),
 * so the ribbon either floated above the slope or got clipped flat
 * through the hill. Replacing each stream with a flat-ground pond
 * inside the clearing kills both failure modes.
 *
 * Each pond emits TWO meshes:
 *   • a brown mud-bed disc sitting on the carved floor (renderOrder 2)
 *   • a forest-green water disc with the shared animated shader,
 *     `V2_POOL2_WATER_LEVEL_DROP_M` × (radius/main-radius) below the
 *     natural terrain so the bank-rim reads as exposed mossy mud.
 *
 * @param {{x:number, z:number, radius:number, depth:number}} cfg
 * @param {THREE.Material} sharedWaterMat — reuse the main pool's animated material
 * @returns {{ water: THREE.Mesh, mud: THREE.Mesh, lily: THREE.InstancedMesh, waterY: number }}
 */
function buildSatellitePond(cfg, sharedWaterMat) {
  const naturalTerrainY = terrainY(cfg.x, cfg.z) + cfg.depth;
  // Water level — proportional drop so the small pond's mud bank scales
  // with its radius. Capped by the bowl's actual depth so we never punch
  // the waterline through the carved floor.
  const drop = Math.min(cfg.depth * 0.55, V2_POOL2_WATER_LEVEL_DROP_M * 0.45);
  const waterY = naturalTerrainY - drop;

  // ── Water disc ────────────────────────────────────────────────────────
  const segs = 36;
  const waterGeom = new THREE.CircleGeometry(cfg.radius, segs);
  const wpos = waterGeom.attributes.position;
  // Light organic jitter on the rim so the pond doesn't read as a stamped
  // circle. Amplitude scales with radius — keeps the silhouette tight.
  for (let i = 1; i < wpos.count; i++) {
    const x = wpos.getX(i);
    const y = wpos.getY(i);
    const angle = Math.atan2(y, x);
    const jitter = 1 + Math.sin(angle * 3.1) * 0.06 + Math.cos(angle * 5.3) * 0.04;
    wpos.setXY(i, Math.cos(angle) * cfg.radius * jitter, Math.sin(angle) * cfg.radius * jitter);
  }
  waterGeom.computeVertexNormals();
  const water = new THREE.Mesh(waterGeom, sharedWaterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(cfg.x, waterY, cfg.z);
  water.renderOrder = 4;
  water.name = `pool2_satellite_water_${cfg.x}_${cfg.z}`;
  water.userData.anuId = `pool.pool2.satellite.water.${cfg.x}_${cfg.z}`;
  water.userData.anuKind = "landmark_pool_satellite_water";
  water.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;

  // ── Brown mud bed ─────────────────────────────────────────────────────
  // A flat disc just above the carved floor — gives the pond a visible
  // bottom through the translucent water (avoids the "see-through grass
  // floor" read the main pool had before).
  const mudGeom = new THREE.CircleGeometry(cfg.radius * 0.92, 28);
  const mudMat = new THREE.MeshStandardMaterial({
    color: 0x2a1b0e,
    roughness: 0.95,
    metalness: 0,
  });
  const mud = new THREE.Mesh(mudGeom, mudMat);
  mud.rotation.x = -Math.PI / 2;
  // Mud floor sits at the bowl's natural-floor depth, just above the carve.
  mud.position.set(cfg.x, terrainY(cfg.x, cfg.z) + 0.02, cfg.z);
  mud.renderOrder = 2;
  mud.receiveShadow = true;
  mud.name = `pool2_satellite_mud_${cfg.x}_${cfg.z}`;
  mud.userData.anuId = `pool.pool2.satellite.mud.${cfg.x}_${cfg.z}`;
  mud.userData.anuKind = "landmark_pool_satellite_mud";
  mud.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;

  // ── Lily pads ─────────────────────────────────────────────────────────
  const lilyCount = V2_POOL2_SATELLITE_PONDS_LILY_COUNT;
  const padGeom = new THREE.CircleGeometry(0.45, 14);
  padGeom.rotateX(-Math.PI / 2);
  // Match the main pool's pads — see `buildLilyPads` for the rationale.
  const padMat = new THREE.MeshStandardMaterial({
    color: 0x4a7c3f,
    roughness: 0.7,
    emissive: 0x1a3a14,
    emissiveIntensity: 0.18,
    side: THREE.DoubleSide,
  });
  const lily = new THREE.InstancedMesh(padGeom, padMat, lilyCount);
  lily.name = `pool2_satellite_lily_${cfg.x}_${cfg.z}`;
  lily.userData.anuId = `pool.pool2.satellite.lily.${cfg.x}_${cfg.z}`;
  lily.userData.anuKind = "landmark_pool_satellite_lily";
  lily.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  lily.castShadow = false;
  lily.receiveShadow = true;
  const dummy = new THREE.Object3D();
  // Deterministic seed per pond so reload is stable.
  let seed = (Math.floor(cfg.x * 1000) ^ Math.floor(cfg.z * 1000)) >>> 0 || 0xc0ffee;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < lilyCount; i++) {
    const angle = rnd() * Math.PI * 2;
    const r = (0.2 + rnd() * 0.6) * cfg.radius;
    dummy.position.set(cfg.x + Math.cos(angle) * r, waterY + 0.04, cfg.z + Math.sin(angle) * r);
    dummy.rotation.y = rnd() * Math.PI;
    const s = 0.7 + rnd() * 0.6;
    dummy.scale.set(s, 1, s);
    dummy.updateMatrix();
    lily.setMatrixAt(i, dummy.matrix);
  }
  lily.instanceMatrix.needsUpdate = true;

  return { water, mud, lily, waterY };
}

async function loadCenteredFishGeometry(url) {
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
  /**
   * May-15 2026 (re-revised — user complaint #3 "fish still swimming on
   * side"). FORENSIC: vertex-range probe of `Assets/Fish/fish.obj` shows
   * the file is a **3DS Max Z-up export** (header confirms `3ds Max
   * Wavefront OBJ Exporter`):
   *
   *     x ∈ [−4.979,  4.983]  span 9.962  ← body LENGTH
   *     y ∈ [−1.013,  1.013]  span 2.025  ← lateral width (sides)
   *     z ∈ [−1.925,  2.507]  span 4.431  ← top-to-bottom (back ↑)
   *
   * Three.js is Y-up. Without baking the axis conversion, the fish's
   * back (+Z in source) points along world +Z — i.e. the fish lies on
   * its side with its dorsal fin pointing AWAY from the camera, not up.
   * The legacy `WorldPondEnclavePond1.js` had the same bug; the user
   * never complained because the legacy pond was rejected for other
   * reasons. Bake `R_x(-π/2)` to map +Z (back) → +Y (up) so the fish
   * stands upright. Head is at local +X after the bake.
   *
   * Update-side yaw: after upright bake, use `atan2(-vz, vx) + π` so the
   * head leads the swim path (tail-first reads as "swimming backwards").
   */
  geom.rotateX(-Math.PI / 2);
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);
  // Pick the longest extent as the body length. After the upright rotation,
  // the body axis is along world X, so `size.x` is the natural length.
  const fishLen = Math.max(size.x, size.y, size.z, 0.001);
  const center = bb.getCenter(new THREE.Vector3());
  geom.translate(-center.x, -center.y, -center.z);
  return { geometry: geom, fishLen };
}

function disposePool2DockMeshes(group) {
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.dispose();
  });
}

/**
 * Returns `{ schoolStr, disperseSlice }` — Anu-/kid‑tunable timings from `constants.js`.
 * Driven by pooled `_fishBioTime` (paused when POOL2 fish are unobserved).
 */
function pool2FishBehaviourMix(bioTime) {
  const soloS = V2_POOL2_FISH_LIFE_SOLO_S;
  const blendS = V2_POOL2_FISH_LIFE_SCHOOL_BLEND_S;
  const schoolS = V2_POOL2_FISH_LIFE_SCHOOL_S;
  const dispersS = V2_POOL2_FISH_LIFE_DISPERSE_S;
  const cycle = soloS + blendS + schoolS + blendS + dispersS;
  let u = bioTime % cycle;
  if (u < 0) u += cycle;

  let schoolStr = 0;
  let disperseSlice = false;
  if (u < soloS) {
    schoolStr = 0;
  } else if (u < soloS + blendS) {
    schoolStr = (u - soloS) / blendS;
  } else if (u < soloS + blendS + schoolS) {
    schoolStr = 1;
  } else if (u < soloS + blendS + schoolS + blendS) {
    schoolStr = 1 - (u - (soloS + blendS + schoolS)) / blendS;
  } else {
    schoolStr = 0;
    disperseSlice = true;
  }
  return {
    schoolStr,
    /** Post-school chaos window — fish spin up distinct headings. */
    disperseSlice,
    cycleLen: cycle,
    uPhase: u,
  };
}

export const WorldPool2Module = {
  name: "Pool2",

  _scene: null,
  _water: null,
  _dockGroup: null,
  /** Cloned sacred-log material — safe to dispose without touching tipi caches. */
  _dockWoodMat: null,
  _dockGlassPkg: null,
  _lilies: null,
  /** @type {Array<{ water: THREE.Mesh, mud: THREE.Mesh, lily: THREE.InstancedMesh }>} */
  _satellitePonds: [],
  /** Forest-green water material reused by main pool + satellite ponds (single time uniform tick). */
  _sharedWaterMat: null,
  /** @type {THREE.Mesh[] | null} */
  _fishMeshes: null,
  _fishMaterial: null,
  _fishGeometry: null,
  _fishCenterY: 0,
  /** `WorldPhysics.registerDeckSurface` id — cleared on unload. */
  _deckSurfaceId: null,
  /** Procedural wetland foliage group ringing the pond + cleanup handles. */
  _reedsMesh: null,
  /** Pond-bottom sand bed (organic disc) + its CanvasTexture handle. */
  _sandBottom: null,
  _sandBottomTexture: null,
  /** @type {Array<{ root: THREE.Object3D, mixer: THREE.AnimationMixer|null, idleAction: THREE.AnimationAction|null }>} */
  _deerHerd: [],
  _cx: 0,
  _cz: 0,
  _waterY: 0,
  _time: 0,
  _disposed: false,
  /** `@this._time` when school scatter from water entry ends; inactive when `<= _time`. */
  _fishScatterEndT: -Infinity,
  _playerWasInPoolWater: false,
  /** Littoral minnow meshes — smaller scale, tighter depth; geometry shared with trout. */
  _fishShallowMeshes: null,
  /** Trout + shallows (single dormant / tick path). Built only when fish loads. */
  _allPoolFish: null,
  /** School-cycle clock; increments only while pool fish are "observed" (near + halo). */
  _fishBioTime: 0,
  /** Mossy landscape rocks added around the shoreline (dispose on unload). */
  _mossyRocks: [],
  /** Flat fishbowl “mirror” decal at the dock fishing point. */
  _fishingSpotDecal: null,
  _deerObserveRefs: null,
  _deerObserveNextT: 0,

  async load(scene) {
    if (this._disposed) return;
    this._scene = scene;
    this._time = 0;
    this._fishScatterEndT = -Infinity;
    this._playerWasInPoolWater = false;
    this._fishShallowMeshes = null;
    this._allPoolFish = null;
    this._fishBioTime = 0;
    this._mossyRocks = [];
    this._fishingSpotDecal = null;
    this._deerObserveRefs = null;
    this._deerObserveNextT = 0;

    const cx = V2_POND_ENCLAVE_CENTER_X_M;
    const cz = V2_POND_ENCLAVE_CENTER_Z_M;
    this._cx = cx;
    this._cz = cz;

    /**
     * Use the live carved `terrainY(cx, cz)` as the basin's anchor Y.
     * Because `WorldTerrain.js` now subtracts `V2_POOL2_BASIN_DEPTH_M`
     * at this point, `terrainAtCenter` is already ~5 m below the natural
     * grass. The basin floor mesh draws its bowl downward from this
     * value, and the water surface sits `V2_POOL2_WATER_LEVEL_DROP_M`
     * below the *natural* (pre-carve) terrain — i.e. the rim level.
     */
    const terrainAtCenter = terrainY(cx, cz);
    const naturalTerrainY = terrainAtCenter + V2_POOL2_BASIN_DEPTH_M;
    const waterY = naturalTerrainY - V2_POOL2_WATER_LEVEL_DROP_M;
    this._waterY = waterY;

    // Pond floor — wide sand bed at basin + 2 ft. Add BEFORE the water
    // so transparent-pass sort still draws the water (renderOrder 4) on
    // top of the sand (renderOrder 1) when looking down from above.
    this._sandBottom = buildPondSandBottom(cx, cz, terrainAtCenter);
    this._sandBottomTexture = this._sandBottom.material.map;
    scene.add(this._sandBottom);

    this._water = buildWaterSurface(cx, cz, waterY);
    scene.add(this._water);

    const dock = buildAdvancedFishingDock(cx, cz, waterY);
    this._dockGroup = dock.group;
    this._dockWoodMat = dock.woodMat;
    scene.add(this._dockGroup);

    // Mossy shoreline stones — REMOVED May-2026 per user spec
    // "clear out and remove all the rocks on this scene, I dont like
    // any of them". Reeds still ring the bank (see `buildReedsAroundPond`
    // earlier in this load), so the pond edge still reads as wetland.
    // BuildMode (R key) lets players place rocks where they want them.

    if (!this._disposed) {
      this._fishingSpotDecal = buildDockFishingSpotMirrorDecal(
        cx,
        dock.pierTipZ,
        dock.deckTopY,
      );
      scene.add(this._fishingSpotDecal);
    }

    /**
     * Expose the FISHING POINT — the dock cantilever tip XZ — as a window
     * global so the FISH guide-card click handler in `V2Panel._wireGuideCards`
     * can target it with smart-nav. May-15 2026 user spec: clicking FISH
     * must auto-path to the dock end where the fish-bowl resource lives.
     *
     * `dock.pierTipZ` is the cantilever-tip Z (north-shore: less than cz);
     * the X is the pool centre because the dock runs straight north-south.
     */
    if (typeof window !== "undefined") {
      window._v2FishingPoint = {
        x: cx,
        z: dock.pierTipZ,
        deckTopY: dock.deckTopY,
        waterY,
        // Direction from the fishing spot toward tipi 1 (the "pull" axis
        // for the WorldFishingModule). Tipi 1 lives at the world origin
        // (0, 0), so the unit XZ vector is just the normalized vector
        // from `(cx, pierTipZ)` toward (0,0).
        pullDirX: (() => {
          const dx = -cx, dz = -dock.pierTipZ;
          const len = Math.hypot(dx, dz) || 1;
          return dx / len;
        })(),
        pullDirZ: (() => {
          const dx = -cx, dz = -dock.pierTipZ;
          const len = Math.hypot(dx, dz) || 1;
          return dz / len;
        })(),
      };
    }

    /**
     * Register the dock deck so the player physics body can stand on it.
     *
     * May-15 2026 user fix ("dock is not allowing player to stand on it"):
     * harden the registration path. Two reported failure modes were
     * possible: (a) `getRuntimeService("WorldPhysics")` returning null
     * because of a service-init ordering edge, and (b) the registration
     * silently no-op'ing without any log. Try the runtime service first,
     * fall back to the legacy `window.WorldPhysics` global that
     * `WorldModule.load` also installs (line 385). Always log the
     * outcome so the user can verify in DevTools.
     */
    const physics =
      getRuntimeService("WorldPhysics") ??
      (typeof window !== "undefined" ? window.WorldPhysics : null);
    if (physics?.registerDeckSurface && dock.deckSurfacePatch) {
      physics.registerDeckSurface(dock.deckSurfacePatch);
      this._deckSurfaceId = dock.deckSurfacePatch.id;
      console.info(
        `%c[Pool2] ✅ dock deck surface registered id=${dock.deckSurfacePatch.id} ` +
          `y=${dock.deckSurfacePatch.y.toFixed(2)}m`,
        "color:#4caf50",
      );
    } else {
      console.warn(
        "[Pool2] ❌ dock deck surface NOT registered — player will fall " +
          "through the dock. physics=",
        physics,
      );
    }

    this._lilies = buildLilyPads(cx, cz, waterY, V2_POOL2_LILY_COUNT);
    scene.add(this._lilies);

    /**
     * Reed ring + deer herd (May-16 2026). The original 1-ft sand-band
     * around the water disc was removed (user: "ugly border strip…
     * ridiculous") and replaced by a randomly-scattered ring of
     * procedural cattail/reed/wildflower wetland just outside the rim.
     * Deer are skeleton-cloned from a single GLB load so instances don't
     * pay the asset cost repeatedly; they start at the tree line and may
     * visit the dry bank.
     */
    try {
      this._reedsMesh = buildReedsAroundPond(cx, cz);
      if (!this._disposed && this._reedsMesh) scene.add(this._reedsMesh);
    } catch (err) {
      console.warn("[Pool2] wetland foliage skipped:", err?.message || err);
    }

    this._deerHerd = [];
    if (!DEER_HERD_ENABLED) {
      console.info(
        "[Pool2] deer herd DISABLED — see DEER_HERD_ENABLED in WorldPool2.js " +
          "for the decimation recipe (FPS regression fix per Anu memory `tripo-asset-decimation`).",
      );
    } else try {
      const deerGltf = await new GLTFLoaderWithDraco().loadAsync(DEER_GLB_URL);
      if (!this._disposed) {
        const template = deerGltf.scene;
        template.updateMatrixWorld(true);
        // Spawn the herd at the forest edge, not at the pond edge.
        const forestR = POOL2_DEER_FOREST_RING_M;
        const placement = DEER_HERD_PLACEMENT.slice(0, DEER_HERD_MAX);
        for (const cfg of placement) {
          const deer = spawnDeerInstance(template, deerGltf.animations, cfg.sizeMul, cfg.tint);
          const dx = Math.cos(cfg.angleRad) * forestR;
          const dz = Math.sin(cfg.angleRad) * forestR;
          const wx = cx + dx;
          const wz = cz + dz;
          // Plant soles ON terrain: `terrainY` gives the carved ground; add
          // `solesOffsetY` from spawnDeerInstance so the model's lowest bbox
          // point sits exactly at terrain level (no more half-buried deer).
          deer.root.position.set(wx, terrainY(wx, wz) + deer.solesOffsetY, wz);
          // Stash phase + base pos for idle motion in update() (used when
          // the GLB has no usable idle clip — adds a slow head-bob so the
          // herd never reads as inert "frozen statues").
          deer.root.userData.deerPhase = Math.random() * Math.PI * 2;
          deer.root.userData.deerBaseY = deer.root.position.y;
          deer.root.userData.deerForestHome = { x: wx, z: wz };
          deer.root.userData.deerTemperament = 0.75 + Math.random() * 0.5;
          deer.root.userData.deerCuriosity = 0.35 + Math.random() * 0.45;
          deer.root.userData.deerWatchCooldownUntil = 0;
          deer.root.userData.deerPondCooldownUntil = 6 + Math.random() * 12;
          /**
           * Face along the tree line instead of toward the pond.
           */
          deer.root.rotation.y =
            cfg.angleRad + Math.PI / 2 + (Math.random() - 0.5) * 0.55;
          deer.root.name = `pool2_deer_${cfg.angleRad.toFixed(2)}`;
          deer.root.userData.anuId = `pool.pool2.deer.${cfg.angleRad.toFixed(2)}`;
          deer.root.userData.anuKind = "landmark_pool_deer";
          deer.root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
          // ── Register with the Anu Nature Awareness service ────────────
          // Other animals (rabbits, fish) can sense this deer; the deer
          // FSM in update() will call senseThreat() each frame against
          // the player and any active alarm.
          const awareness = getRuntimeService("AnuNatureAwareness");
          awareness?.register({
            id: deer.root.userData.anuId,
            kind: "deer",
            x: deer.root.position.x,
            z: deer.root.position.z,
            panicRadius: 4.5, // player within 4.5 m → FLEE
            alertRadius: 9.5, // player within 9.5 m → ALERT (raise head, face player)
          });
          deer.awarenessId = deer.root.userData.anuId;
          scene.add(deer.root);
          this._deerHerd.push(deer);
        }
        console.info(`[Pool2] ✅ ${this._deerHerd.length} deer in tree line`);
      }
    } catch (err) {
      console.warn("[Pool2] deer GLB load skipped:", err?.message || err);
    }

    // Satellite ponds — small wide ponds inside the flat clearing (replaces
    // the prior stream-ribbon system; see `V2_POOL2_SATELLITE_PONDS` doc).
    // Share the main pool's animated water material so the time uniform
    // ticks once per frame and the satellites read as part of the same
    // forest-pool family.
    this._sharedWaterMat = this._water.material;
    this._satellitePonds = [];
    for (const cfg of V2_POOL2_SATELLITE_PONDS) {
      const pond = buildSatellitePond(cfg, this._sharedWaterMat);
      scene.add(pond.mud);
      scene.add(pond.water);
      scene.add(pond.lily);
      this._satellitePonds.push(pond);
    }

    try {
      const fg = await loadCenteredFishGeometry(FISH_OBJ_URL);
      if (fg?.geometry && !this._disposed) {
        const scale = V2_POOL2_FISH_TARGET_LENGTH_M / fg.fishLen;
        /**
         * May-15 2026 user spec ("fish should be same blue color as guide
         * book fish model"). Mirror `Component.ThreeIcons.js → buildFish()`:
         * `color: 0x2b6ffe, roughness: 0.35, metalness: 0.25`. Emissive is
         * dropped — the guidebook fish is plain blue PBR with no glow, and
         * forest pool ambient light is already warm enough to read.
         */
        const mat = new THREE.MeshStandardMaterial({
          color: 0x2b6ffe,
          roughness: 0.35,
          metalness: 0.25,
        });
        this._fishMaterial = mat;
        this._fishGeometry = fg.geometry;
        this._fishMeshes = [];
        this._fishCenterY = waterY - 0.9; // ~half basin depth
        const schoolN = Math.max(1, Math.min(12, V2_POOL2_FISH_COUNT | 0));
        /**
         * Trout: each carries `soloOmega` + `schoolAngleOff` — independent
         * headings that ease into shared rotation when lifecycle `schoolStr`
         * rises (`constants.js` V2_POOL2_FISH_LIFE_* / Anu parity).
         */
        for (let i = 0; i < schoolN; i++) {
          const fish = new THREE.Mesh(fg.geometry, mat);
          fish.castShadow = false;
          fish.receiveShadow = false;
          fish.scale.setScalar(scale);
          fish.name = `pool2_fish_${i}`;
          fish.userData.anuId = "pool.pool2.fish";
          fish.userData.anuKind = "landmark_pool_fish";
          fish.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
          const orbitFrac = 0.18 + (i / schoolN) * 0.62;
          const orbitR = V2_POOL2_BASIN_RADIUS_M * orbitFrac;
          fish.userData.orbitR = orbitR;
          const orbitDir = i % 2 === 0 ? 1 : -1;
          fish.userData.orbitDir = orbitDir;
          fish.userData.orbitPhase = (i * 0.61 + Math.random() * 0.3) * Math.PI * 2;
          fish.userData.depthOffset = -0.4 - Math.random() * 1.6;
          fish.userData.speedMul = 0.85 + Math.random() * 0.35;
          fish.userData.wigglePhase = i * 0.43;
          const speedMul = fish.userData.speedMul;
          fish.userData.soloOmega =
            ((0.18 * speedMul * orbitDir) / Math.max(0.5, orbitR / 8)) *
            (0.52 + Math.random() * 0.62);
          fish.userData.schoolAngleOff = (i / schoolN) * Math.PI * 2 + Math.random() * 0.35;
          fish.userData.fishMidY = this._fishCenterY;
          fish.position.set(cx, this._fishCenterY, cz);
          scene.add(fish);
          this._fishMeshes.push(fish);
        }

        this._fishShallowMeshes = [];
        const shallowN = Math.min(
          V2_POOL2_FISH_SHALLOW_MAX,
          Math.max(0, Math.round(schoolN * V2_POOL2_FISH_SHALLOW_FACTOR)),
        );
        const shallowMidY = waterY - 0.36;
        const shallowScale = V2_POOL2_FISH_SHALLOW_TARGET_LENGTH_M / fg.fishLen;
        const denom = shallowN <= 1 ? 1 : shallowN - 1;
        for (let j = 0; j < shallowN; j++) {
          const fish = new THREE.Mesh(fg.geometry, mat);
          fish.castShadow = false;
          fish.receiveShadow = false;
          fish.scale.setScalar(shallowScale);
          fish.name = `pool2_fish_shallow_${j}`;
          fish.userData.anuId = `pool.pool2.fish.minnow.${j}`;
          fish.userData.anuKind = "landmark_pool_fish_shallow";
          fish.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
          const t = denom > 0 ? j / denom : 0.5;
          const orbitR =
            V2_POOL2_BASIN_RADIUS_M * (0.64 + t * (0.9 - 0.64)); // littoral shallow belt
          fish.userData.orbitR = orbitR;
          fish.userData.orbitPhase = (j * 1.93 + Math.random() * 0.45) * Math.PI * 2;
          fish.userData.depthOffset = -(0.04 + Math.random() * 0.2);
          fish.userData.speedMul = 1;
          fish.userData.wigglePhase = j * 0.71;
          fish.userData.fishMidY = shallowMidY;
          fish.userData.soloOmega =
            (0.15 + Math.random() * 0.26) * (j % 2 === 0 ? 1 : -1);
          fish.userData.schoolAngleOff =
            ((j + 0.33 * schoolN) / Math.max(1, shallowN + schoolN)) * Math.PI * 2;
          fish.position.set(cx, shallowMidY, cz);
          scene.add(fish);
          this._fishShallowMeshes.push(fish);
        }

        this._allPoolFish = [...this._fishMeshes, ...this._fishShallowMeshes];

        // Expose for WorldFishingModule (it borrows one fish for bite/fight
        // visuals). Also stash the shared fish geometry + length so a fresh
        // trophy clone can be attached to the player without re-loading.
        if (typeof window !== "undefined") {
          window._v2PoolFish = this._allPoolFish;
          window._v2PoolFishTemplate = {
            geometry: fg.geometry,
            fishLen: fg.fishLen,
            targetLengthM: V2_POOL2_FISH_TARGET_LENGTH_M,
          };
        }

        const glassPkg = buildDockGlassShowcase(cx, dock.pierTipZ, dock.deckTopY, fg.geometry, fg.fishLen);
        this._dockGlassPkg = glassPkg;
        scene.add(glassPkg.group);
      }
    } catch (err) {
      console.warn("[Pool2] fish.obj load skipped:", err?.message || err);
    }

    console.log(
      "%c[Pool2] ✅ Forest Deep Pool built at (" + cx.toFixed(1) + "," + cz.toFixed(1) + ")",
      "color:#4caf50;font-weight:bold;",
    );
  },

  update(delta) {
    if (this._disposed) return;
    this._time += delta;
    _pool2TimeUniform.value = this._time;

    const poolFish = this._allPoolFish;
    if (poolFish && poolFish.length > 0) {
      /**
       * POOL2 trout + littoral minnows (`fish.obj` duplicates; Anu ledger:
       * `pool2-fish-cycle-observe-may-13` in pipelineMemory.js).
       *
       * `_fishBioTime` drives solo ↔ school ↔ disperse; it **pauses**
       * outside basin + halo (`visible=false`). Tunables:
       * `constants.js` `V2_POOL2_FISH_LIFE_*` / `_OBSERVE_EXTRA_TILES`.
       */
      const phys =
        getRuntimeService("WorldPhysics") ??
        (typeof window !== "undefined" ? window.WorldPhysics : null);
      const bodies = phys?._bodies;
      let playerX = null;
      let playerZ = null;
      let playerY = null;
      if (bodies && bodies.length > 0) {
        playerX = bodies[0].position.x;
        playerZ = bodies[0].position.z;
        playerY = bodies[0].position.y;
      }
      /**
       * May-16 2026 awareness hookup. If the Anu nature-awareness
       * service has recently observed a panic alarm (deer fleeing, etc.)
       * within ~12 m of the pond, treat the fish school as if the player
       * were stepping in — same scatter behaviour, just driven by another
       * animal's panic. Keeps the world reacting "as if aware of each
       * other".
       */
      const awarenessFish = getRuntimeService("AnuNatureAwareness");
      if (awarenessFish) {
        const fishThreat = awarenessFish.senseThreat(
          this._cx,
          this._cz,
          "fish",
        );
        if (
          fishThreat &&
          (fishThreat.kind.startsWith("alarm:") || fishThreat.severity >= 0.5)
        ) {
          if (this._time + 1.0 > this._fishScatterEndT) {
            this._fishScatterEndT =
              this._time + POOL2_FISH_WATER_ENTER_SCATTER_S;
          }
        }
      }
      let inPoolWater = false;
      if (
        playerX !== null &&
        playerY !== null &&
        Number.isFinite(this._waterY)
      ) {
        const feetY = playerY - PLAYER_HEIGHT;
        const rPW = Math.hypot(playerX - this._cx, playerZ - this._cz);
        inPoolWater =
          rPW < V2_POOL2_BASIN_RADIUS_M * POOL2_FISH_WATER_DISC_FR &&
          feetY < this._waterY + 0.42;
        if (inPoolWater && !this._playerWasInPoolWater) {
          this._fishScatterEndT =
            this._time + POOL2_FISH_WATER_ENTER_SCATTER_S;
        }
        this._playerWasInPoolWater = inPoolWater;
      } else {
        this._playerWasInPoolWater = false;
      }

      const haloR =
        V2_POOL2_BASIN_RADIUS_M +
        V2_TILE_WORLD * V2_POOL2_FISH_OBSERVE_EXTRA_TILES;
      let fishObserved = false;
      if (playerX !== null && playerZ !== null) {
        const rH = Math.hypot(playerX - this._cx, playerZ - this._cz);
        fishObserved = inPoolWater || rH <= haloR;
      }

      if (!fishObserved) {
        for (const fish of poolFish) fish.visible = false;
      } else {
        for (const fish of poolFish) fish.visible = true;
        this._fishBioTime += delta;

        const mix = pool2FishBehaviourMix(this._fishBioTime);
        const schoolStr = mix.schoolStr;
        const disperseOmegaMul = mix.disperseSlice ? 1.68 : 1;

        const scattering = this._time < this._fishScatterEndT;
        const avoidR = 3 * 0.3048 * 1.6; // 3 ft user spec + 1.6× safety margin
        const effAvoidR = scattering ? avoidR * 3.35 : avoidR;
        const pushGain = scattering ? 2.85 : 0.9;
        const swimPanic = scattering ? 1.62 : 1;
        const lookAheadBio = 0.06;

        /** Shared swirl when coherent; eased by `schoolStr`. */
        let omegaSchoolActive = V2_POOL2_FISH_SWIM_RATE * 0.58;
        if (schoolStr < 1e-3) omegaSchoolActive = 0;
        omegaSchoolActive *= swimPanic;

        for (const fish of poolFish) {
          const ud = fish.userData;
          const R = ud.orbitR ?? V2_POOL2_BASIN_RADIUS_M * 0.4;
          const orbitPhase = ud.orbitPhase ?? 0;
          const tb = this._fishBioTime;
          const soloO =
            (ud.soloOmega ?? 0.16) * disperseOmegaMul * swimPanic;
          const schOff = ud.schoolAngleOff ?? 0;

          const soloA0 = tb * soloO + orbitPhase;
          const soloA1 = (tb + lookAheadBio) * soloO + orbitPhase;
          const sx0 = R * Math.cos(soloA0);
          const sz0 = R * Math.sin(soloA0);
          const sx1 = R * Math.cos(soloA1);
          const sz1 = R * Math.sin(soloA1);

          const schA0 = tb * omegaSchoolActive + schOff;
          const schA1 =
            (tb + lookAheadBio) * omegaSchoolActive + schOff;
          const scx0 = R * Math.cos(schA0);
          const scz0 = R * Math.sin(schA0);
          const scx1 = R * Math.cos(schA1);
          const scz1 = R * Math.sin(schA1);

          const oneMinus = 1 - schoolStr;
          let lx = sx0 * oneMinus + scx0 * schoolStr;
          let lz = sz0 * oneMinus + scz0 * schoolStr;
          let lx2 = sx1 * oneMinus + scx1 * schoolStr;
          let lz2 = sz1 * oneMinus + scz1 * schoolStr;
          let vx = lx2 - lx;
          let vz = lz2 - lz;

          if (playerX !== null) {
            const dxP = this._cx + lx - playerX;
            const dzP = this._cz + lz - playerZ;
            const dP = Math.hypot(dxP, dzP);
            if (dP < effAvoidR && dP > 1e-3) {
              const push = (effAvoidR - dP) / effAvoidR;
              lx += (dxP / dP) * push * pushGain;
              lz += (dzP / dP) * push * pushGain;
              vx = dxP / dP;
              vz = dzP / dP;
            }
          }

          const depthOffset = ud.depthOffset ?? -1;
          const midY = ud.fishMidY ?? this._fishCenterY;
          const bobAmp = scattering ? 0.42 : 0.18;
          const bobY =
            Math.sin(this._time * 0.9 + orbitPhase * 2.17) * bobAmp;
          fish.position.set(
            this._cx + lx,
            midY + depthOffset + bobY,
            this._cz + lz,
          );
          if (vx * vx + vz * vz > 1e-6) {
            const baseYaw = Math.atan2(-vz, vx) + Math.PI;
            const wiggleAmp = scattering ? 0.32 : 0.21;
            const wiggle =
              Math.sin(this._time * 6.5 + ud.wigglePhase * 4.7) * wiggleAmp;
            fish.rotation.y = baseYaw + wiggle;
          }
        }
      }
    }

    /**
     * Deer behaviour FSM, May-15 2026 polish pass (updated for rigged animal-pack deer).
     *
     * The legacy Tripo sculpt used a +π yaw hack; `deer.glb` is exported +Z-forward,
     * so heading uses `atan2(fx,fz) + DEER_WORLD_YAW_OFFSET` (default 0).
     *
     * States:
     *   • `wander_idle`  — pause in place. Random 1.5–4 s.
     *   • `wander_graze` — small ±3 m walk to a new graze spot.
     *   • `goto_pond`    — occasional dry-bank visit, outside water exclusion.
     *   • `pond_edge`    — pause at dry bank, face water, maybe browse.
     *   • `browse`       — head-down feeding pause.
     *   • `watch`        — curious look at nearby rabbits / seated NPCs.
     *   • `alert`        — rigid look toward threat.
     *   • `flee`         — run away from threat but stay outside pond exclusion.
     * Heading is slewed toward `ud.targetYaw`; speed eases with acceleration cap
     * so stops read heavier than arcade lerp.
     */
    const cxP = this._cx;
    const czP = this._cz;
    const SPEED_MPS = 1.6;
    const GRAZE_SPEED_MPS = 0.55;
    /** Sprint speed when fleeing from a threat. */
    const FLEE_SPEED_MPS = 4.2;
    const YAW_RATE_RAD_S = 2.4;
    const DEER_ACCEL_TIME_S = 0.36;
    const awareness = getRuntimeService("AnuNatureAwareness");
    const t = this._time;

    /** Shortest signed angle from `from` to `to` ∈ [−π, π]. */
    const wrapAngle = (a) => {
      let x = a;
      while (x > Math.PI) x -= Math.PI * 2;
      while (x < -Math.PI) x += Math.PI * 2;
      return x;
    };

    if (t >= this._deerObserveNextT) {
      this._deerObserveRefs = collectPool2DeerObservables(this._scene);
      this._deerObserveNextT = t + POOL2_DEER_OBSERVE_REFRESH_S;
    }
    const deerObserveRefs = this._deerObserveRefs || [];

    for (const deer of this._deerHerd) {
      const root = deer.root;
      const ud = root.userData;
      /** True for frames where the deer is actively translating (walk clip should dominate). */
      let locomoting = false;
      if (!ud.deerMode) {
        ud.deerMode = "wander_idle";
        ud.deerStateUntil = this._time + 1.5 + Math.random() * 2.5;
        ud.deerTargetX = root.position.x;
        ud.deerTargetZ = root.position.z;
        ud.targetYaw = root.rotation.y;
        ud.deerWanderHome = { x: root.position.x, z: root.position.z };
        ud.deerSmSpeed = 0;
      }
      let mode = ud.deerMode;
      const temperament = ud.deerTemperament ?? 1;
      const curiosity = ud.deerCuriosity ?? 0.5;
      const observation = nearestPool2DeerObservable(
        deerObserveRefs,
        root.position.x,
        root.position.z,
        POOL2_DEER_OBSERVE_RADIUS_M,
      );

      const aimAt = (tx, tz) => {
        const fx = tx - root.position.x;
        const fz = tz - root.position.z;
        ud.targetYaw = Math.atan2(fx, fz) + DEER_WORLD_YAW_OFFSET;
      };

      // ── Awareness pulse: keep registry fresh + react to threats ───
      // Pushed BEFORE the FSM transitions so a panic can interrupt
      // whatever the deer was about to do (graze, drink, etc.). Threats
      // include the player (via cached `_bodies[0]` XZ), the recent
      // alarm broadcast, and any nearby "scarier" animal (none yet, but
      // a future predator would slot in here for free).
      if (awareness) {
        awareness.update(deer.awarenessId, root.position.x, root.position.z);
        const threat = awareness.senseThreat(
          root.position.x,
          root.position.z,
          "deer",
        );
        if (threat) {
          if (threat.severity >= 0.9 && mode !== "flee") {
            // Panic — FLEE in the threat→deer direction. Raise alarm so
            // nearby rabbits / fish react too.
            ud.deerMode = "flee";
            mode = "flee";
            const dN = Math.max(0.01, threat.dist);
            const fleeX = root.position.x + (threat.dx / dN) * 14;
            const fleeZ = root.position.z + (threat.dz / dN) * 14;
            const clamped = pool2ClampOutsideExclusion(
              fleeX,
              fleeZ,
              cxP,
              czP,
              POOL2_WILDLIFE_EXCLUSION_M,
            );
            ud.deerTargetX = clamped.x;
            ud.deerTargetZ = clamped.z;
            aimAt(clamped.x, clamped.z);
            ud.deerStateUntil = t + 3 + Math.random() * 2;
            awareness.raiseAlarm(
              root.position.x,
              root.position.z,
              "deer",
              threat.kind === "player" ? "player_too_close" : "panic",
            );
          } else if (
            threat.severity >= 0.45 &&
            mode !== "alert" &&
            mode !== "flee"
          ) {
            // Notice the threat — stop, face it, raise head.
            ud.deerMode = "alert";
            mode = "alert";
            ud.deerStateUntil = t + 2 + Math.random() * 2;
            const dN = Math.max(0.01, threat.dist);
            const lookX = root.position.x - (threat.dx / dN) * 5;
            const lookZ = root.position.z - (threat.dz / dN) * 5;
            const clamped = pool2ClampOutsideExclusion(
              lookX,
              lookZ,
              cxP,
              czP,
              POOL2_WILDLIFE_EXCLUSION_M,
            );
            ud.atTargetX = clamped.x;
            ud.atTargetZ = clamped.z;
            aimAt(ud.atTargetX, ud.atTargetZ);
          }
        }
      }

      // ── State transitions on timer expiry ──────────────────────────
      if (t > ud.deerStateUntil) {
        if (mode === "wander_idle" || mode === "wander_graze") {
          if (mode === "wander_idle") {
            if (
              observation &&
              t > (ud.deerWatchCooldownUntil ?? 0) &&
              Math.random() < curiosity
            ) {
              ud.deerMode = "watch";
              ud.atTargetX = observation.x;
              ud.atTargetZ = observation.z;
              ud.watchKind = observation.kind;
              ud.deerStateUntil =
                t + (observation.kind === "rabbit" ? 1.6 : 2.6) + Math.random() * 1.4;
              ud.deerWatchCooldownUntil = t + 7 + Math.random() * 7;
              aimAt(observation.x, observation.z);
            } else if (Math.random() < 0.48 * temperament) {
              ud.deerMode = "browse";
              ud.deerStateUntil = t + 2.4 + Math.random() * 4.2;
              ud.targetYaw =
                root.rotation.y + (Math.random() - 0.5) * 0.65;
            } else if (
              t > (ud.deerPondCooldownUntil ?? 0) &&
              Math.random() < 0.28
            ) {
              ud.deerMode = "goto_pond";
              const home = ud.deerForestHome ?? ud.deerWanderHome;
              const homeAng = Math.atan2(home.z - czP, home.x - cxP);
              const ang = homeAng + (Math.random() - 0.5) * 0.52;
              ud.deerTargetX = cxP + Math.cos(ang) * POOL2_DEER_POND_VISIT_RING_M;
              ud.deerTargetZ = czP + Math.sin(ang) * POOL2_DEER_POND_VISIT_RING_M;
              aimAt(ud.deerTargetX, ud.deerTargetZ);
              ud.deerStateUntil = t + 8 + Math.random() * 6;
              ud.deerPondCooldownUntil = t + 35 + Math.random() * 45;
            } else {
              // Step to a new graze spot around the forest home anchor —
              // keeps the deer near the trees.
              ud.deerMode = "wander_graze";
              const home = ud.deerForestHome ?? ud.deerWanderHome;
              const ang = Math.random() * Math.PI * 2;
              const rad = 0.8 + Math.random() * POOL2_DEER_FOREST_WANDER_RADIUS_M;
              const gx = home.x + Math.cos(ang) * rad;
              const gz = home.z + Math.sin(ang) * rad;
              const clamped = pool2ClampOutsideExclusion(
                gx,
                gz,
                cxP,
                czP,
                POOL2_WILDLIFE_EXCLUSION_M,
              );
              ud.deerTargetX = clamped.x;
              ud.deerTargetZ = clamped.z;
              aimAt(ud.deerTargetX, ud.deerTargetZ);
              ud.deerStateUntil = t + 2 + Math.random() * 4;
            }
          } else {
            // Graze-step finished — idle pause before next move.
            ud.deerMode = "wander_idle";
            ud.deerStateUntil = t + 1.5 + Math.random() * 2.5;
          }
          mode = ud.deerMode;
        } else if (
          mode === "at_yb" ||
          mode === "drinking" ||
          mode === "alert" ||
          mode === "browse" ||
          mode === "watch" ||
          mode === "pond_edge"
        ) {
          // Legacy runtime recovery: older states now return to tree wandering.
          ud.deerMode = "wander_idle";
          ud.deerStateUntil = t + 1 + Math.random() * 2;
          ud.deerWanderHome = ud.deerForestHome ?? ud.deerWanderHome;
          mode = "wander_idle";
        } else if (mode === "goto_pond") {
          ud.deerMode = "wander_idle";
          ud.deerStateUntil = t + 1 + Math.random() * 2;
          ud.deerWanderHome = ud.deerForestHome ?? ud.deerWanderHome;
          mode = "wander_idle";
        } else if (mode === "flee") {
          // Flee timer ran out — drop into a brief alert before
          // resuming the wander cycle.
          ud.deerMode = "alert";
          ud.deerStateUntil = t + 1.4 + Math.random();
          ud.atTargetX = root.position.x;
          ud.atTargetZ = root.position.z;
          mode = "alert";
        }
      }

      // ── Per-frame motion + heading slew ────────────────────────────
      if (mode === "flee") {
        const dx = ud.deerTargetX - root.position.x;
        const dz = ud.deerTargetZ - root.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01) {
          locomoting = true;
          const accel = 1 - Math.exp(-delta / DEER_ACCEL_TIME_S);
          ud.deerSmSpeed = THREE.MathUtils.lerp(
            ud.deerSmSpeed ?? 0,
            FLEE_SPEED_MPS,
            accel,
          );
          const step = ud.deerSmSpeed * delta;
          root.position.x += (dx / d) * step;
          root.position.z += (dz / d) * step;
          aimAt(ud.deerTargetX, ud.deerTargetZ);
        } else {
          ud.deerSmSpeed = THREE.MathUtils.lerp(ud.deerSmSpeed ?? 0, 0, 1 - Math.exp(-delta * 4));
        }
      } else if (mode === "wander_graze" || mode === "goto_pond") {
        const dx = ud.deerTargetX - root.position.x;
        const dz = ud.deerTargetZ - root.position.z;
        const d = Math.hypot(dx, dz);
        const arriveR = mode === "goto_pond" ? 0.65 : 0.25;
        if (d < arriveR) {
          ud.deerSmSpeed = THREE.MathUtils.lerp(ud.deerSmSpeed ?? 0, 0, 1 - Math.exp(-delta * 5));
          if (mode === "goto_pond") {
            const dry = pool2ClampOutsideExclusion(
              root.position.x,
              root.position.z,
              cxP,
              czP,
              POOL2_DEER_POND_VISIT_RING_M,
            );
            root.position.x = dry.x;
            root.position.z = dry.z;
            ud.deerMode = "pond_edge";
            ud.deerStateUntil = t + 3.5 + Math.random() * 4.5;
            ud.atTargetX = cxP;
            ud.atTargetZ = czP;
            aimAt(cxP, czP);
          } else {
            // graze step complete — short idle pause.
            ud.deerMode = "wander_idle";
            ud.deerStateUntil = t + 0.6 + Math.random() * 1.6;
          }
        } else {
          locomoting = true;
          const desired = mode === "goto_pond" ? SPEED_MPS : GRAZE_SPEED_MPS;
          const accel = 1 - Math.exp(-delta / DEER_ACCEL_TIME_S);
          ud.deerSmSpeed = THREE.MathUtils.lerp(
            ud.deerSmSpeed ?? 0,
            desired,
            accel,
          );
          const step = ud.deerSmSpeed * delta;
          root.position.x += (dx / d) * step;
          root.position.z += (dz / d) * step;
          aimAt(ud.deerTargetX, ud.deerTargetZ);
        }
      } else if (mode === "pond_edge") {
        ud.deerSmSpeed = THREE.MathUtils.lerp(ud.deerSmSpeed ?? 0, 0, 1 - Math.exp(-delta * 5));
        const lookSway = Math.sin(t * 0.42 + (ud.deerPhase ?? 0)) * 0.12;
        const fx = cxP - root.position.x;
        const fz = czP - root.position.z;
        ud.targetYaw =
          Math.atan2(fx, fz) + DEER_WORLD_YAW_OFFSET + lookSway;
      } else if (mode === "browse") {
        ud.deerSmSpeed = THREE.MathUtils.lerp(ud.deerSmSpeed ?? 0, 0, 1 - Math.exp(-delta * 4.4));
        ud.targetYaw += Math.sin(t * 0.31 + (ud.deerPhase ?? 0)) * 0.018 * delta;
      } else if (mode === "watch") {
        ud.deerSmSpeed = THREE.MathUtils.lerp(ud.deerSmSpeed ?? 0, 0, 1 - Math.exp(-delta * 5));
        if (observation && observation.kind === ud.watchKind) {
          ud.atTargetX = observation.x;
          ud.atTargetZ = observation.z;
        }
        const swayAmp = ud.watchKind === "rabbit" ? 0.16 : 0.08;
        const lookSway = Math.sin(t * 0.72 + (ud.deerPhase ?? 0)) * swayAmp;
        const fx = (ud.atTargetX ?? root.position.x) - root.position.x;
        const fz = (ud.atTargetZ ?? root.position.z + 1) - root.position.z;
        ud.targetYaw =
          Math.atan2(fx, fz) + DEER_WORLD_YAW_OFFSET + lookSway;
      } else if (mode === "alert") {
        ud.deerSmSpeed = THREE.MathUtils.lerp(ud.deerSmSpeed ?? 0, 0, 1 - Math.exp(-delta * 5));
        // Tight ±5° sway so the deer stares more rigidly at the threat.
        const swayAmp = 0.09;
        const lookSway = Math.sin(t * 0.55 + (ud.deerPhase ?? 0)) * swayAmp;
        const fx = (ud.atTargetX ?? 0) - root.position.x;
        const fz = (ud.atTargetZ ?? 0) - root.position.z;
        ud.targetYaw =
          Math.atan2(fx, fz) + DEER_WORLD_YAW_OFFSET + lookSway;
      }

      for (const other of this._deerHerd) {
        if (other === deer) continue;
        const ox = root.position.x - other.root.position.x;
        const oz = root.position.z - other.root.position.z;
        const od = Math.hypot(ox, oz);
        if (od <= 1e-4 || od >= POOL2_DEER_PERSONAL_SPACE_M) continue;
        const push = (POOL2_DEER_PERSONAL_SPACE_M - od) * 0.22 * delta;
        root.position.x += (ox / od) * push;
        root.position.z += (oz / od) * push;
      }

      const dry = pool2ClampOutsideExclusion(
        root.position.x,
        root.position.z,
        cxP,
        czP,
        POOL2_WILDLIFE_EXCLUSION_M,
      );
      root.position.x = dry.x;
      root.position.z = dry.z;

      // Heading slew toward `targetYaw`.
      const yawRate = YAW_RATE_RAD_S;
      const delta_y = wrapAngle(ud.targetYaw - root.rotation.y);
      const maxStep = yawRate * delta;
      root.rotation.y +=
        Math.abs(delta_y) <= maxStep
          ? delta_y
          : Math.sign(delta_y) * maxStep;

      // Locomotion clips: Idle / Walk / Eating / Gallop (animal-pack rig).
      const ph = ud.deerPhase ?? 0;
      let tgtI = 0;
      let tgtW = 0;
      let tgtE = 0;
      let tgtG = 0;
      if (mode === "browse" || mode === "pond_edge") {
        tgtE = deer.eatAction ? 0.92 : 0;
        tgtI = deer.eatAction ? 0.08 : 1;
      } else if (mode === "flee" && locomoting && deer.gallopAction) {
        tgtG = 1;
      } else if (locomoting) {
        tgtW = 1;
      } else {
        tgtI = 1;
      }
      const wk = 1 - Math.exp(-delta * 5.2);
      deer._bwI = THREE.MathUtils.lerp(deer._bwI ?? 1, tgtI, wk);
      deer._bwW = THREE.MathUtils.lerp(deer._bwW ?? 0, tgtW, wk);
      deer._bwE = THREE.MathUtils.lerp(deer._bwE ?? 0, tgtE, wk);
      deer._bwG = THREE.MathUtils.lerp(deer._bwG ?? 0, tgtG, wk);
      if (deer.idleAction) deer.idleAction.setEffectiveWeight(deer._bwI);
      if (deer.walkAction) deer.walkAction.setEffectiveWeight(deer._bwW);
      if (deer.eatAction) deer.eatAction.setEffectiveWeight(deer._bwE);
      if (deer.gallopAction) deer.gallopAction.setEffectiveWeight(deer._bwG);

      const sm = ud.deerSmSpeed ?? 0;
      if (deer.walkAction && deer._bwW > 0.08) {
        const ref = mode === "goto_pond" ? SPEED_MPS : GRAZE_SPEED_MPS;
        deer.walkAction.timeScale = THREE.MathUtils.clamp(
          (sm / Math.max(0.15, ref)) * 0.95,
          0.5,
          1.42,
        );
        if (mode === "flee" && !deer.gallopAction) {
          deer.walkAction.timeScale = THREE.MathUtils.clamp(
            (sm / SPEED_MPS) * 1.15,
            1.05,
            2.15,
          );
        }
      }
      if (deer.gallopAction && mode === "flee" && deer._bwG > 0.12) {
        deer.gallopAction.timeScale = THREE.MathUtils.clamp(
          (sm / FLEE_SPEED_MPS) * 1.08,
          0.92,
          1.48,
        );
      }

      deer.mixer?.update(delta);
      if (deer.headBone && (mode === "alert" || mode === "watch" || mode === "browse" || mode === "pond_edge")) {
        let pitch = 0;
        if (mode === "browse" || mode === "pond_edge") {
          pitch = -0.28 + Math.sin(t * 1.4 + ph) * 0.08;
        } else if (mode === "watch") {
          pitch = 0.08 + Math.sin(t * 1.7 + ph) * 0.06;
        } else {
          pitch = 0.18 + Math.sin(t * 2.05 + ph) * 0.11;
        }
        _pool2DeerHeadQuat.setFromAxisAngle(_pool2DeerHeadAxisPitch, pitch);
        deer.headBone.quaternion.multiply(_pool2DeerHeadQuat);
      }

      /**
       * Ground stick + drink dip — FORENSIC: the previous implementation used
       * `root.position.y = baseY + bob` with `baseY` equal to the *previous*
       * frame's world Y (already containing last frame's bob). That **sums
       * oscillations frame-to-frame** and drifts the animal upward (“flying
       * deer”). Always recompute `terrainY + solesOffsetY`, then add a **single**
       * sinusoidal offset. Best practice elsewhere: match Fauna / avatar —
       * anchor feet to heightfield every tick; drive clip `timeScale` from speed;
       * never integrate bob into world Y cumulatively.
       */
      const gx = root.position.x;
      const gz = root.position.z;
      const groundY = terrainY(gx, gz) + (deer.solesOffsetY ?? 0);
      let bob = Math.sin(t * 1.15 + ph) * 0.012;
      if (mode === "browse" || mode === "pond_edge") bob -= 0.025 + 0.018 * Math.sin(t * 1.8 + ph);
      if (mode === "watch" || mode === "alert") bob += 0.012;
      root.position.y = groundY + bob;
    }

    const glassPkg = this._dockGlassPkg;
    const glassFish = glassPkg?.showcaseFishMeshes;
    const spR = glassPkg?.sphereR ?? 1.14;
    if (glassFish && glassFish.length) {
      const t = this._time;
      const swimR = spR * 0.52;
      glassFish.forEach((fm, i) => {
        const ph = t * 0.48 + i * Math.PI;
        const th = t * 0.36 + i * 2.05;
        const sinTh = Math.sin(th);
        const x = swimR * Math.cos(ph) * sinTh;
        const z = swimR * Math.sin(ph) * sinTh;
        const y = swimR * Math.cos(th) * 0.82;
        fm.position.set(x, y, z);
        const dph = 0.035;
        const ph2 = ph + dph;
        const ox = swimR * Math.cos(ph2) * sinTh;
        const oz = swimR * Math.sin(ph2) * sinTh;
        fm.rotation.y = Math.atan2(-(oz - z), ox - x) + Math.PI;
      });
    }
  },

  unload() {
    this._disposed = true;
    this._fishScatterEndT = -Infinity;
    this._playerWasInPoolWater = false;
    this._fishBioTime = 0;
    this._allPoolFish = null;
    const disposeMesh = (m) => {
      if (!m || !this._scene) return;
      this._scene.remove(m);
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.());
      else mat?.dispose?.();
    };
    // Satellite pond water meshes share `_sharedWaterMat` with the main
    // pool's `_water`. Release main-pool's geometry first WITHOUT disposing
    // its material, then dispose satellite-pond meshes (geometry only),
    // then dispose the shared material exactly once at the end.
    if (this._water && this._scene) {
      this._scene.remove(this._water);
      this._water.geometry?.dispose?.();
    }
    if (this._dockGroup && this._scene) {
      this._scene.remove(this._dockGroup);
      disposePool2DockMeshes(this._dockGroup);
      this._dockWoodMat?.dispose?.();
    }
    this._dockGroup = null;
    this._dockWoodMat = null;

    // Wetland foliage + deer herd dispose.
    if (this._reedsMesh && this._scene) {
      this._scene.remove(this._reedsMesh);
      this._reedsMesh.traverse?.((obj) => {
        if (!obj.isMesh && !obj.isInstancedMesh) return;
        obj.geometry?.dispose?.();
        const m = obj.material;
        if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
        else m?.dispose?.();
      });
    }
    this._reedsMesh = null;

    // Pond-bottom sand bed dispose.
    if (this._sandBottom && this._scene) {
      this._scene.remove(this._sandBottom);
      this._sandBottom.geometry?.dispose?.();
      this._sandBottom.material?.dispose?.();
    }
    this._sandBottomTexture?.dispose?.();
    this._sandBottom = null;
    this._sandBottomTexture = null;
    for (const r of this._mossyRocks) {
      if (!this._scene) break;
      this._scene.remove(r);
      r.traverse((c) => {
        if (c.isMesh) {
          c.geometry?.dispose?.();
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          for (const m of mats) m?.dispose?.();
        }
      });
    }
    this._mossyRocks = [];
    if (this._fishingSpotDecal && this._scene) {
      this._scene.remove(this._fishingSpotDecal);
      this._fishingSpotDecal.geometry?.dispose?.();
      const fm = this._fishingSpotDecal.material;
      fm.map?.dispose?.();
      fm.dispose?.();
    }
    this._fishingSpotDecal = null;
    const awarenessForUnload = getRuntimeService("AnuNatureAwareness");
    for (const deer of this._deerHerd) {
      if (!this._scene) break;
      deer.mixer?.stopAllAction?.();
      awarenessForUnload?.unregister(deer.awarenessId);
      this._scene.remove(deer.root);
      deer.root.traverse((c) => {
        if (c.isMesh || c.isSkinnedMesh) {
          c.geometry?.dispose?.();
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          for (const m of mats) m?.dispose?.();
        }
      });
    }
    this._deerHerd = [];

    const physics = getRuntimeService("WorldPhysics");
    if (this._deckSurfaceId && physics?.unregisterDeckSurface) {
      physics.unregisterDeckSurface(this._deckSurfaceId);
    }
    this._deckSurfaceId = null;

    if (this._dockGlassPkg?.group && this._scene) {
      this._scene.remove(this._dockGlassPkg.group);
      const g = this._dockGlassPkg;
      g.sphereGeo?.dispose?.();
      g.glassMat?.dispose?.();
      g.fishInnerMat?.dispose?.();
      for (const geo of g.showcaseFishGeometries || []) geo?.dispose?.();
    }
    this._dockGlassPkg = null;

    disposeMesh(this._lilies);
    if (this._fishMeshes && this._scene) {
      for (const f of this._fishMeshes) this._scene.remove(f);
    }
    if (this._fishShallowMeshes && this._scene) {
      for (const f of this._fishShallowMeshes) this._scene.remove(f);
    }
    this._fishMeshes = null;
    this._fishShallowMeshes = null;
    this._fishGeometry?.dispose?.();
    this._fishMaterial?.dispose?.();
    this._fishGeometry = null;
    this._fishMaterial = null;
    for (const pond of this._satellitePonds) {
      if (!this._scene) break;
      this._scene.remove(pond.water);
      this._scene.remove(pond.mud);
      this._scene.remove(pond.lily);
      pond.water.geometry?.dispose?.();
      pond.mud.geometry?.dispose?.();
      pond.mud.material?.dispose?.();
      pond.lily.geometry?.dispose?.();
      pond.lily.material?.dispose?.();
    }
    this._sharedWaterMat?.dispose?.();
    this._satellitePonds = [];
    this._sharedWaterMat = null;
    this._water = null;
    this._lilies = null;
    this._scene = null;
  },
};
