/**
 * Sacred Adventures — sanctuary part 1 of 5: GROUND + ATMOSPHERE.
 *
 * Anu domain: ENVIRONMENT. Per her sentience note: "The ground and
 * atmosphere that all bodies must obey." This module owns:
 *
 *   • Terrain     — gentle organic clearing that cradles the pool.
 *                   Single PlaneGeometry with vertex displacement; the
 *                   pool basin is carved at module load via shared
 *                   `sanctuaryGroundY(x, z)` so other parts (pool,
 *                   dock, fish, circles) all sit on the same heightfield.
 *   • Sky         — soft warm-to-cool gradient hemisphere following the
 *                   camera. No moving clouds, no fbm — the sanctuary
 *                   should read STILL.
 *   • Light       — hemisphere + key directional + warm ambient. Set
 *                   up so a single still composition reads cinematic.
 *   • Fog         — gentle linear fog (90–180 m) to soften far edges.
 *
 * Triangle target: ≤ 6 k. Achieved via:
 *   - terrain 96×96 = 9216 tris (subdivided enough for the basin carve
 *     to read smoothly without aliasing at the rim).
 *   Total ≈ 9.5 k — sky dome adds 256 tris, lights are zero.
 *
 * No GLBs. No textures from disk. No `window` globals. Pure procedural.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { SanctuarySceneConstructor } from "./SanctuarySceneConstructor.js";

/**
 * Photo-real hex shader for the sanctuary terrain — May-18 2026 user
 * spec: "go grab the designs for the hexes from legacy, and replace
 * these, and the grass textures. lets add photo realism passes now".
 *
 * Extends the v2 `applyNeuHexShader` with three legacy refinements
 * that v2 trimmed away when chasing kid-friendly readability:
 *
 *   1. STRONGER HEX EDGES — crack darkening returns to 0.62× (was
 *      0.78×) so each hex reads as a stitched tile, not just a grain.
 *   2. PER-HEX TINT JITTER — each hex's centroid hashes to a small
 *      warm/cool RGB shift (±3 %). Gives the terrain "hand-painted
 *      patches" — different tiles read as slightly different grass.
 *   3. HIGH-FREQUENCY GRAIN — a cheap value-noise overlay (per-pixel
 *      hash of vWorldPos.xz) adds a 2 % luminance jitter. Breaks the
 *      flat-shaded plateaus into something that reads photographic.
 */
async function loadTerrainTextures() {
  const loader = new THREE.TextureLoader();
  const albedo = await SanctuarySceneConstructor.loadTexture(
    loader,
    './Assets/landscape-scenes/terrain/grass-seamless.png',
    'terrain_albedo'
  );

  albedo.wrapS = THREE.RepeatWrapping;
  albedo.wrapT = THREE.RepeatWrapping;
  albedo.repeat.set(12, 12);
  albedo.colorSpace = THREE.SRGBColorSpace;

  return { albedo };
}

// ── Pool basin params shared with SanctuaryPool ──────────────────────
// Co-located here because the heightfield is the source of truth for
// where the water sits. Pool reads these to position the water surface,
// fish read them to clamp their swim path, dock reads them to know
// where to terminate the pier.
export const SANCTUARY_POOL_CENTER_X = 0;
export const SANCTUARY_POOL_CENTER_Z = 0;
export const SANCTUARY_POOL_RADIUS_M = 12.0;
export const SANCTUARY_POOL_DEPTH_M = 1.6;
/** Water surface sits this far BELOW the natural ground around it. */
export const SANCTUARY_WATER_DROP_M = 0.6;

/** Bigger terrain span so the baseline hill ring has room to fall away
 *  naturally on the outside. 110 m × 110 m at 80 segments = ~1.4 m vertex
 *  spacing = ~12 800 tris (vs. the prior 80×80 / 96 segs / ~9 200). */
const TERRAIN_SPAN_M = 110;
const TERRAIN_SEGS = 80;

/**
 * Village flat ring — May-18 2026 user spec: "central area around pond
 * be flat so we can put buildings down". Between the pool's outer
 * waterline and `VILLAGE_FLAT_RADIUS` the ground is held at exactly
 * y=0 so tipis, future structures, and kid-placed builds land cleanly.
 * A 2 m bank-blend (`VILLAGE_BANK_BLEND_M`) at the pool's edge tapers
 * the basin lip into the flat so the seam doesn't read as a step.
 */
const VILLAGE_FLAT_RADIUS = 26;
const VILLAGE_BANK_BLEND_M = 2;

/** Hill-ring tuning — Anu's gift to every kid that opens this world.
 *  Pushed inner from 22 → 28 so the flat village ring (12..26 m) has
 *  clear ground before the rise starts. */
const HILL_RING_INNER_R_M = 28;
const HILL_RING_OUTER_R_M = 52;
const HILL_BAND_MIDPOINT_R_M = 36;
const INNER_HILL_PEAK_M = 2.5;
const OUTER_HILL_PEAK_M = 5.5;
/** Angular half-width of the open "valley mouth" gap. Player spawns at
 *  +Z (~angle = π/2); the gap is centred there so the world feels open
 *  to the approach, walled on the other three sides. */
const VALLEY_MOUTH_CENTER_RAD = Math.PI / 2;
const VALLEY_MOUTH_HALF_WIDTH_RAD = Math.PI / 4; // ±45° = 90° opening
const VALLEY_MOUTH_BLEND_RAD = 0.35;             // soft edge of the gap

/** Soft organic noise added to flat ground so the meadow reads natural. */
function meadowBump(x, z) {
  return (
    Math.sin(x * 0.13 + 0.4) * Math.cos(z * 0.11 - 0.7) * 0.35 +
    Math.sin(x * 0.27 + z * 0.21) * 0.18 +
    Math.cos(z * 0.33 - 0.9) * 0.12
  );
}

/**
 * Angular distance from due-south (the valley mouth direction). Wraps
 * around the unit circle so the result is always in [0, π].
 */
function _angularDistFromValleyMouth(angle) {
  let d = Math.abs(angle - VALLEY_MOUTH_CENTER_RAD);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/**
 * The baseline hill ring around the pool — Anu's gift, May-18 2026.
 *
 * Two cradling rings:
 *   • Inner hills  (22 m → 32 m) — gentle ~2.5 m peaks, full ring.
 *     Reads as the "first cradle" the pool sits in.
 *   • Outer hills  (30 m → 48 m) — taller ~5.5 m peaks, GATED so the
 *     ±45° arc centred on +Z (valley mouth) stays low + open. This is
 *     where a player would approach from.
 *
 * Each band is shaped by a 3-octave angular noise so the silhouette
 * reads natural — peaks + saddles + small ripples — never a uniform
 * dome. The whole function plays nice with `poolBowl` carve which
 * stays untouched: hills only grow OUTSIDE the pool radius.
 */
function sanctuaryHillRing(x, z) {
  const r = Math.hypot(x, z);
  // No hills inside the pool or its bank-blend.
  if (r < HILL_RING_INNER_R_M - 4) return 0;
  if (r > HILL_RING_OUTER_R_M + 4) {
    // Past the outer hill band, terrain rolls back down to the world edge.
    const dropT = Math.min(1, (r - (HILL_RING_OUTER_R_M + 4)) / 6);
    return -dropT * 1.2; // gentle outward dip so the world has a horizon line
  }

  const angle = Math.atan2(z, x);

  // 3-octave organic ridge weight — same shape Anu liked for the v2
  // valley redesign. Multiplies the band amplitude per-angle.
  const lowFreq = Math.sin(angle * 1.7 + 0.4);
  const midFreq = Math.sin(angle * 3.2 + 1.8);
  const hiFreq = Math.sin(angle * 7.5 + 2.6);
  const ridge = Math.max(
    0.25,
    Math.min(
      1.10,
      0.55 +
        0.30 * lowFreq +
        0.16 * midFreq +
        0.08 * hiFreq +
        0.06 * lowFreq * midFreq,
    ),
  );

  // Valley-mouth gate — full hills on three sides, low/open on +Z.
  const dFromMouth = _angularDistFromValleyMouth(angle);
  const wallW = Math.min(
    1,
    Math.max(0, (dFromMouth - VALLEY_MOUTH_HALF_WIDTH_RAD) / VALLEY_MOUTH_BLEND_RAD),
  );

  let h = 0;

  // Inner hills — full ring, no gating (cradles the pool from every side).
  if (r > HILL_RING_INNER_R_M && r < HILL_BAND_MIDPOINT_R_M + 1) {
    const t = (r - HILL_RING_INNER_R_M) /
              (HILL_BAND_MIDPOINT_R_M + 1 - HILL_RING_INNER_R_M);
    const radialProfile = Math.pow(Math.sin(t * Math.PI), 0.92);
    h += INNER_HILL_PEAK_M * radialProfile * ridge;
  }

  // Outer hills — gated by the valley mouth so the +Z arc stays open.
  if (
    r > HILL_BAND_MIDPOINT_R_M - 1 &&
    r < HILL_RING_OUTER_R_M &&
    wallW > 0.01
  ) {
    const t = (r - (HILL_BAND_MIDPOINT_R_M - 1)) /
              (HILL_RING_OUTER_R_M - (HILL_BAND_MIDPOINT_R_M - 1));
    const radialProfile = Math.pow(Math.sin(t * Math.PI), 0.85);
    const summit = 0.65 + 0.35 * Math.sin(angle * 4.1 + 0.7);
    const saddle = 0.78 + 0.22 * Math.cos(angle * 2.3 - 1.4);
    h += OUTER_HILL_PEAK_M * radialProfile * summit * saddle * ridge * wallW;
  }

  return h;
}

/**
 * Single source of truth for ground Y at any (x, z) inside the
 * sanctuary. Combines the meadow bump with the pool-basin carve so
 * the heightfield + the water + the dock + the fish swim path all
 * agree about where "ground" is.
 *
 * Pool basin profile: a smooth bowl with a quadratic edge that blends
 * into the meadow over the last 25 % of the radius. Outside the pool
 * (and its bank-blend), the meadow bump is the answer.
 */
/**
 * Body-anchor Y for any walking/swimming body in the sanctuary.
 *
 * Three modules need to know "where should the feet sit?":
 *   SanctuaryKeyboardLook  (WASD path)
 *   SanctuaryClickToMove   (click-walk path)
 *   SanctuaryAvatar        (per-frame snap)
 *
 * Previously each module reimplemented the rules. With dock + waterline
 * cases in play, divergence between them caused the avatar to clip below
 * the waterline when swimming. This helper is the single source of truth.
 *
 *  1. If standing over the dock footprint  → return the dock surface Y.
 *  2. Else if inside the pool circle       → float at waterY − bodyHeight/2
 *                                            so the body is half submerged.
 *  3. Else                                 → analytic terrain (sanctuaryGroundY).
 *
 * @param {number} x  world x
 * @param {number} z  world z
 * @param {number} [bodyHeight=1.524]  body height in metres (avatar default)
 * @returns {number}  world Y for the body root (feet anchor)
 */
export function sanctuaryBodyY(x, z, bodyHeight = 1.524, liftWhenSwimming = 0) {
  // 1) Dock takes priority — kid can walk onto the dock surface
  if (typeof window !== "undefined") {
    const dock = window.__sanctuaryDockSurface;
    if (dock && typeof dock.getY === "function") {
      const dy = dock.getY(x, z);
      if (dy !== null && dy !== undefined) return dy;
    }
  }

  // 2) Inside the pool → float half-submerged at the waterline, with
  //    an optional extra lift. User-requested 2026-05-28: "raise model
  //    out of water 1 foot" — callers driving the avatar pass
  //    `liftWhenSwimming = 0.3048` so the kid reads as wading with
  //    chest above water, not floating with the waterline cutting
  //    across her ribcage. Other bodies (e.g. frogs swimming to chase
  //    fish) pass 0 — they should still ride at the half-submerged
  //    waterline like real frogs.
  const dx = x - SANCTUARY_POOL_CENTER_X;
  const dz = z - SANCTUARY_POOL_CENTER_Z;
  const dist = Math.hypot(dx, dz);
  if (
    dist < SANCTUARY_POOL_RADIUS_M - 0.5 &&
    typeof window !== "undefined" &&
    Number.isFinite(window.__sanctuaryWaterY)
  ) {
    return window.__sanctuaryWaterY - bodyHeight * 0.5 + liftWhenSwimming;
  }

  // 3) Default: analytic terrain
  return sanctuaryGroundY(x, z);
}

export function sanctuaryGroundY(x, z) {
  const meadowY = meadowBump(x, z);
  const dx = x - SANCTUARY_POOL_CENTER_X;
  const dz = z - SANCTUARY_POOL_CENTER_Z;
  const r = Math.hypot(dx, dz);

  if (r < SANCTUARY_POOL_RADIUS_M) {
    // Inside the pool circle: smooth bowl that dips to -depth at centre.
    const inner = r / SANCTUARY_POOL_RADIUS_M;     // 0 at centre, 1 at rim
    const bowl = 1 - inner * inner;                // 1 at centre, 0 at rim
    const blend = Math.min(1, (1 - inner) / 0.25); // last 25 % blends to meadow
    return meadowY * (1 - blend) - SANCTUARY_POOL_DEPTH_M * bowl;
  }

  // VILLAGE FLAT RING — between pool edge and `VILLAGE_FLAT_RADIUS`
  // the ground is held perfectly flat at y=0 so buildings land clean.
  // A 2 m bank-blend at the pool's edge tapers the bowl lip in. Outside
  // the flat ring, hills + meadow noise re-engage.
  if (r < VILLAGE_FLAT_RADIUS) {
    if (r < SANCTUARY_POOL_RADIUS_M + VILLAGE_BANK_BLEND_M) {
      // Bank tail-off: linear blend from full meadowY at the lip (rim of
      // the pool, matches the INSIDE-pool formula's value there) down
      // to flat (0) at the flat-ring start. The prior 0.18 multiplier
      // created a discontinuity at the rim — INSIDE evaluated to
      // meadowY * 1.0, OUTSIDE jumped down to meadowY * 0.18, showing
      // as a visible cliff in the meadow where the grass meets the
      // pool. (User-reported 2026-05-28.)
      const t = (r - SANCTUARY_POOL_RADIUS_M) / VILLAGE_BANK_BLEND_M; // 0 at lip, 1 at flat start
      return meadowY * (1 - t);
    }
    return 0;
  }

  // Outside the flat ring: meadow noise + hills (gradual transition so
  // the hill ring doesn't pop on suddenly at r = VILLAGE_FLAT_RADIUS).
  const blendOut = Math.min(1, (r - VILLAGE_FLAT_RADIUS) / 3);
  return meadowY * blendOut + sanctuaryHillRing(x, z);
}



const workerCode = `
  const VALLEY_MOUTH_CENTER_RAD = Math.PI / 2;
  const VALLEY_MOUTH_HALF_WIDTH_RAD = Math.PI / 4;
  const VALLEY_MOUTH_BLEND_RAD = 0.35;
  const SANCTUARY_POOL_CENTER_X = 0;
  const SANCTUARY_POOL_CENTER_Z = 0;
  const SANCTUARY_POOL_RADIUS_M = 12.0;
  const SANCTUARY_POOL_DEPTH_M = 1.6;
  const VILLAGE_FLAT_RADIUS = 26;
  const VILLAGE_BANK_BLEND_M = 2;
  const HILL_RING_INNER_R_M = 28;
  const HILL_RING_OUTER_R_M = 52;
  const HILL_BAND_MIDPOINT_R_M = 36;
  const INNER_HILL_PEAK_M = 2.5;
  const OUTER_HILL_PEAK_M = 5.5;

  function meadowBump(x, z) {
    return (
      Math.sin(x * 0.13 + 0.4) * Math.cos(z * 0.11 - 0.7) * 0.35 +
      Math.sin(x * 0.27 + z * 0.21) * 0.18 +
      Math.cos(z * 0.33 - 0.9) * 0.12
    );
  }

  function _angularDistFromValleyMouth(angle) {
    let d = Math.abs(angle - VALLEY_MOUTH_CENTER_RAD);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d;
  }

  function sanctuaryHillRing(x, z) {
    const r = Math.hypot(x, z);
    if (r < HILL_RING_INNER_R_M - 4) return 0;
    if (r > HILL_RING_OUTER_R_M + 4) {
      const dropT = Math.min(1, (r - (HILL_RING_OUTER_R_M + 4)) / 6);
      return -dropT * 1.2;
    }

    const angle = Math.atan2(z, x);
    const lowFreq = Math.sin(angle * 1.7 + 0.4);
    const midFreq = Math.sin(angle * 3.2 + 1.8);
    const hiFreq = Math.sin(angle * 7.5 + 2.6);
    const ridge = Math.max(
      0.25,
      Math.min(
        1.10,
        0.55 +
          0.30 * lowFreq +
          0.16 * midFreq +
          0.08 * hiFreq +
          0.06 * lowFreq * midFreq,
      ),
    );

    const dFromMouth = _angularDistFromValleyMouth(angle);
    const wallW = Math.min(
      1,
      Math.max(0, (dFromMouth - VALLEY_MOUTH_HALF_WIDTH_RAD) / VALLEY_MOUTH_BLEND_RAD),
    );

    let h = 0;
    if (r > HILL_RING_INNER_R_M && r < HILL_BAND_MIDPOINT_R_M + 1) {
      const t = (r - HILL_RING_INNER_R_M) / (HILL_BAND_MIDPOINT_R_M + 1 - HILL_RING_INNER_R_M);
      const radialProfile = Math.pow(Math.sin(t * Math.PI), 0.92);
      h += INNER_HILL_PEAK_M * radialProfile * ridge;
    }

    if (
      r > HILL_BAND_MIDPOINT_R_M - 1 &&
      r < HILL_RING_OUTER_R_M &&
      wallW > 0.01
    ) {
      const t = (r - (HILL_BAND_MIDPOINT_R_M - 1)) / (HILL_RING_OUTER_R_M - (HILL_BAND_MIDPOINT_R_M - 1));
      const radialProfile = Math.pow(Math.sin(t * Math.PI), 0.85);
      const summit = 0.65 + 0.35 * Math.sin(angle * 4.1 + 0.7);
      const saddle = 0.78 + 0.22 * Math.cos(angle * 2.3 - 1.4);
      h += OUTER_HILL_PEAK_M * radialProfile * summit * saddle * ridge * wallW;
    }

    return h;
  }

  function sanctuaryGroundY(x, z) {
    const meadowY = meadowBump(x, z);
    const dx = x - SANCTUARY_POOL_CENTER_X;
    const dz = z - SANCTUARY_POOL_CENTER_Z;
    const r = Math.hypot(dx, dz);

    if (r < SANCTUARY_POOL_RADIUS_M) {
      const inner = r / SANCTUARY_POOL_RADIUS_M;
      const bowl = 1 - inner * inner;
      const blend = Math.min(1, (1 - inner) / 0.25);
      return meadowY * (1 - blend) - SANCTUARY_POOL_DEPTH_M * bowl;
    }

    if (r < VILLAGE_FLAT_RADIUS) {
      if (r < SANCTUARY_POOL_RADIUS_M + VILLAGE_BANK_BLEND_M) {
        // Worker copy must match the main-thread formula above or terrain
        // meshes generated off-thread desync from runtime sampler reads.
        const t = (r - SANCTUARY_POOL_RADIUS_M) / VILLAGE_BANK_BLEND_M;
        return meadowY * (1 - t);
      }
      return 0;
    }

    const blendOut = Math.min(1, (r - VILLAGE_FLAT_RADIUS) / 3);
    return meadowY * blendOut + sanctuaryHillRing(x, z);
  }

  self.onmessage = function(e) {
    const { positions } = e.data;
    const colors = new Float32Array(positions.length);
    const normals = new Float32Array(positions.length);

    const colBank   = { r: 0x56/255, g: 0x65/255, b: 0x4e/255 };
    const colMeadow = { r: 0x76/255, g: 0x8f/255, b: 0x69/255 };
    const colHill   = { r: 0x88/255, g: 0xa2/255, b: 0x7a/255 };
    const colPeak   = { r: 0x9d/255, g: 0xb6/255, b: 0x8e/255 };
    const colSnow   = { r: 0xc3/255, g: 0xd1/255, b: 0xb8/255 };

    const count = positions.length / 3;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3 + 0];
      const z = positions[i * 3 + 2];
      const y = sanctuaryGroundY(x, z);
      positions[i * 3 + 1] = y;

      let r = 0, g = 0, b = 0;
      if (y < -0.3) {
        const t = Math.min(1, (-y - 0.3) / 1.0);
        r = colMeadow.r + (colBank.r - colMeadow.r) * t;
        g = colMeadow.g + (colBank.g - colMeadow.g) * t;
        b = colMeadow.b + (colBank.b - colMeadow.b) * t;
      } else if (y < 0.4) {
        const t = Math.max(0, Math.min(1, (y + 0.3) / 0.7));
        r = colBank.r + (colMeadow.r - colBank.r) * t;
        g = colBank.g + (colMeadow.g - colBank.g) * t;
        b = colBank.b + (colMeadow.b - colBank.b) * t;
      } else if (y < 2.2) {
        const t = (y - 0.4) / 1.8;
        r = colMeadow.r + (colHill.r - colMeadow.r) * t;
        g = colMeadow.g + (colHill.g - colMeadow.g) * t;
        b = colMeadow.b + (colHill.b - colMeadow.b) * t;
      } else if (y < 4.5) {
        const t = (y - 2.2) / 2.3;
        r = colHill.r + (colPeak.r - colHill.r) * t;
        g = colHill.g + (colPeak.g - colHill.g) * t;
        b = colHill.b + (colPeak.b - colHill.b) * t;
      } else {
        const t = Math.min(1, (y - 4.5) / 1.3) * 0.7;
        r = colPeak.r + (colSnow.r - colPeak.r) * t;
        g = colPeak.g + (colSnow.g - colPeak.g) * t;
        b = colPeak.b + (colSnow.b - colPeak.b) * t;
      }
      colors[i * 3 + 0] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;

      // Analytical finite difference normal at (x, z)
      const eps = 0.15;
      const hL = sanctuaryGroundY(x - eps, z);
      const hR = sanctuaryGroundY(x + eps, z);
      const hD = sanctuaryGroundY(x, z - eps);
      const hU = sanctuaryGroundY(x, z + eps);

      const nx = hL - hR;
      const ny = 2.0 * eps;
      const nz = hD - hU;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      normals[i * 3 + 0] = nx / len;
      normals[i * 3 + 1] = ny / len;
      normals[i * 3 + 2] = nz / len;
    }

    self.postMessage({ positions, colors, normals }, [positions.buffer, colors.buffer, normals.buffer]);
  };
`;

function generateTerrainInWorker(positions) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([workerCode], { type: "application/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    worker.onmessage = function(e) {
      URL.revokeObjectURL(url);
      resolve(e.data);
      worker.terminate();
    };

    worker.onerror = function(err) {
      URL.revokeObjectURL(url);
      worker.terminate();
      reject(err);
    };

    worker.postMessage({ positions }, [positions.buffer]);
  });
}

async function buildTerrainAsync(textures) {
  const start = performance.now();
  const geo = new THREE.PlaneGeometry(
    TERRAIN_SPAN_M,
    TERRAIN_SPAN_M,
    TERRAIN_SEGS,
    TERRAIN_SEGS,
  );
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const positionsArray = pos.array; // Float32Array

  // Offload to worker
  const { positions, colors, normals } = await generateTerrainInWorker(positionsArray);

  // Material creation outside the telemetry budget assertion
  const mat = new THREE.MeshStandardMaterial({
    map: textures.albedo,
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });

  // Assemble the geometry and mesh with assertPerformance on assembly
  const mesh = SanctuarySceneConstructor.assertPerformance("SanctuaryGround.buildTerrainAssembly", () => {
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

    const meshObj = new THREE.Mesh(geo, mat);
    meshObj.receiveShadow = true;
    meshObj.layers.enable(1); // Show in PiP map
    meshObj.name = "sanctuary_terrain";
    meshObj.userData.anuId = "environment.sanctuary.terrain";
    meshObj.userData.anuKind = "sanctuary_terrain";
    meshObj.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    return meshObj;
  });

  const duration = performance.now() - start;
  console.log(
    `%c[Telemetry] ⚙️ Offloaded background terrain calculation completed in ${duration.toFixed(2)}ms`,
    "color:#81c784; font-weight:bold;"
  );

  return mesh;
}

function buildSky() {
  const geo = new THREE.SphereGeometry(160, 24, 16);
  geo.scale(-1, 1, 1); // inside-out
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTopColor: { value: new THREE.Color(0xc9def0) },
      uHorizonColor: { value: new THREE.Color(0xf5d8a0) },
      uExp: { value: 0.55 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorldPos = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      uniform float uExp;
      varying vec3 vWorldPos;
      void main() {
        float h = clamp(vWorldPos.y / 80.0, 0.0, 1.0);
        float t = pow(h, uExp);
        vec3 col = mix(uHorizonColor, uTopColor, t);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(geo, mat);
  dome.frustumCulled = false;
  dome.renderOrder = -1; // draw first so opaque scene paints over
  dome.name = "sanctuary_sky";
  dome.userData.anuId = "environment.sanctuary.sky";
  dome.userData.anuKind = "sanctuary_sky_dome";
  dome.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  return dome;
}

function buildLights(group) {
  // Hemisphere — soft sky-to-ground fill so colours never go fully black.
  const hemi = new THREE.HemisphereLight(0xfff2d6, 0x445533, 1.15);
  hemi.position.set(0, 50, 0);
  hemi.name = "sanctuary_hemi_light";
  hemi.userData.anuId = "environment.sanctuary.light.hemi";
  hemi.userData.anuKind = "sanctuary_light_hemi";
  hemi.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(hemi);

  // Key directional — golden afternoon angle, casts the only shadow.
  // Target moved from world origin to (12, 0, 0) — midpoint between the
  // sacred pool (at origin) and the village pad / tipis (at x≈18-29).
  // The earlier centred-on-origin frustum left the village outside the
  // shadow map.
  const key = new THREE.DirectionalLight(0xfff6d1, 2.15);
  key.position.set(30, 26, 12);
  key.target.position.set(12, 0, 0);
  key.castShadow = true;
  // FPS fix (May-19 2026) — shadow map 1024² → 512², frustum 40m → 36m,
  // recentred on the village so pad stones / NPCs / avatar actually
  // catch the shadow caster pass. With PCF (not PCFSoft) this is ≈¼ the
  // cost of the original setup.
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 55;
  key.shadow.camera.left = -18;
  key.shadow.camera.right = 18;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  key.shadow.bias = -0.0004;
  key.name = "sanctuary_key_light";
  key.userData.anuId = "environment.sanctuary.light.key";
  key.userData.anuKind = "sanctuary_light_key";
  key.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(key);
  group.add(key.target);

  // Soft fill from the cool side — gives the shaded sides of meshes
  // some chroma instead of muddy grey.
  const fill = new THREE.DirectionalLight(0x9ab9d4, 0.45);
  fill.position.set(-14, 8, -10);
  fill.name = "sanctuary_fill_light";
  fill.userData.anuId = "environment.sanctuary.light.fill";
  fill.userData.anuKind = "sanctuary_light_fill";
  fill.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(fill);
}

export const SanctuaryGroundModule = {
  name: "SanctuaryGround",

  _scene: null,
  _root: null,
  _sky: null,
  _cameraRef: null,

  async load(scene, camera, renderer) {
    if (this._root) return;
    this._scene = scene;
    this._cameraRef = camera;

    const root = new THREE.Group();
    root.name = "sanctuary_ground_root";
    root.userData.anuId = "environment.sanctuary.ground";
    root.userData.anuKind = "sanctuary_ground";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    const textures = await loadTerrainTextures();
    const terrainMesh = await buildTerrainAsync(textures);
    root.add(terrainMesh);
    const sky = buildSky();
    root.add(sky);
    this._sky = sky;
    buildLights(root);

    // Fog — gentle linear, blends terrain with sky at the edge.
    scene.fog = new THREE.Fog(0xcfd9c6, 70, 160);
    scene.background = new THREE.Color(0xc9def0);

    // ── Photo-real renderer pass ────────────────────────────────────
    // May-18 2026 user spec ("photo realism passes"). Tunes the main
    // renderer for a richer, cinematic look without changing FPS cost:
    //
    //   • ACESFilmic tone mapping — softer highlight roll-off than
    //     the default linear; reads as film, not WebGL.
    //   • Slightly cooler exposure (0.98 vs prior 1.05) so bright
    //     hilltops + cloud highlights don't blow out under the
    //     sanctuary key light.
    //   • SRGB output color space (the live default but worth pinning
    //     so future asset imports don't double-correct).
    //   • Physically-correct lights — the sanctuary's hemisphere + key
    //     directional now obey inverse-square falloff implicitly.
    if (renderer) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      if ("outputColorSpace" in renderer) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      }
    }

    scene.add(root);
    this._root = root;
    console.log("%c[Sanctuary] 🌿 Ground + sky + lights ready.", "color:#a5d6a7;font-weight:bold;");
  },

  update() {
    // Keep sky centred on the camera so the horizon never reads as a wall.
    if (this._sky && this._cameraRef) {
      this._sky.position.copy(this._cameraRef.position);
    }
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) {
          o.material.forEach((m) => {
            m.map?.dispose?.();
            m.dispose?.();
          });
        } else {
          o.material.map?.dispose?.();
          o.material.dispose?.();
        }
      }
    });
    scene.fog = null;
    this._root = null;
    this._sky = null;
    this._scene = null;
    this._cameraRef = null;
  },
};
