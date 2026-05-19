/**
 * Forest slot list — literal reproduction of `js/EnvironmentBuilder.js` (ANIME FOREST block):
 * same `minDistanceSq`, hex snap hook, ring counts, radii, and `tryAddPosition(scale, widthOverride?)` keys.
 *
 * Final headcount depends on overlap rejection — `Flora.js` applies `V2_FLORA_MAX_TREE_INSTANCES`
 * when FPS / triangle budget bites (see ANU_PIPELINE_MEMORY trees-instancing).
 *
 * Uses `Math.random()` like legacy (non-deterministic per page load). When `window.getNearestHexCenter`
 * exists (legacy board), positions snap to hex centers; otherwise raw XZ is kept.
 */

import {
  V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M,
  V2_POND_ENCLAVE_CENTER_X_M,
  V2_POND_ENCLAVE_CENTER_Z_M,
  V2_POOL2_BASIN_RADIUS_M,
} from "./constants.js";

/** @typedef {{ x: number; z: number; scale: number; widthOverride: number | null, priority?: number }} FloraTreeSlot */

/**
 * North-of-pond ridge bank — extra tree slots placed along the hill ring
 * (terrain `HILL_INNER..HILL_OUTER` = 55..90 m) in the arc north of the
 * pond (pool centre `V2_POND_ENCLAVE_CENTER_*`, basin radius
 * `V2_POOL2_BASIN_RADIUS_M`). Marked `priority: 1` so the Flora cap
 * keeps them even when the legacy nearest-origin sort would evict them.
 *
 * `tryAddPosition` still applies the standard minDistance + tipi /
 * exclusion checks, so duplicates / hot-zone overlaps are rejected
 * automatically. Reads as "wooded ridgeline behind the pool" rather
 * than a dense forest wall.
 */
const NORTH_HILL_RIDGE_COUNT = 95;
const NORTH_HILL_RADIUS_MIN_M = 58;
const NORTH_HILL_RADIUS_MAX_M = 86;
/** Half-angle of the ridge fan, in radians. ±55° around the pond→north
 *  vector covers the back rim without leaking around to the east/west
 *  meadows. */
const NORTH_HILL_HALF_ANGLE_RAD = (55 * Math.PI) / 180;

/**
 * @typedef {{ x: number; z: number; radius: number }} TreeExclusionZone
 *
 * @param {object} [opts]
 * @param {number} [opts.tipiX]
 * @param {number} [opts.tipiZ]
 * @param {TreeExclusionZone[]} [opts.exclusionZones] — extra circular keep-outs
 *   on top of the tipi clear zone (e.g. the rabbit warren). Each tree
 *   candidate is rejected if its snapped (x, z) falls within `radius` m of
 *   any zone centre.
 * @param {(tx: number, tz: number) => { x: number; z?: number; y?: number }} [opts.nearestHexCenter]
 * @returns {FloraTreeSlot[]}
 */
export function buildLegacyEnvironmentBuilderTreeSlots(opts = {}) {
  const tipiX = opts.tipiX ?? 0;
  const tipiZ = opts.tipiZ ?? 0;
  const exclusionZones = Array.isArray(opts.exclusionZones)
    ? opts.exclusionZones
    : [];
  const nearestHex =
    typeof opts.nearestHexCenter === "function"
      ? opts.nearestHexCenter
      : typeof window !== "undefined" &&
          typeof window.getNearestHexCenter === "function"
        ? window.getNearestHexCenter.bind(window)
        : null;

  /** Legacy returns `{ x, z }` with hexcenters using `.y` as Z — normalize. */
  const snap = (rawX, rawZ) => {
    if (!nearestHex) return { x: rawX, z: rawZ };
    const h = nearestHex(rawX, rawZ);
    const zx = h.z !== undefined ? h.z : h.y;
    return { x: h.x, z: zx };
  };

  /** @type {FloraTreeSlot[]} */
  const treePositions = [];
  const minDistanceSq = 3.5 * 3.5;
  const tipiBlockSq =
    V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M * V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M;

  /**
   * @param {number} rawX
   * @param {number} rawZ
   * @param {number} scale
   * @param {number | null} [widthOverride]
   * @param {number} [priority] Higher = survives the Flora cap first.
   *                            Default 0 (legacy nearest-origin rule).
   */
  const tryAddPosition = (
    rawX,
    rawZ,
    scale,
    widthOverride = null,
    priority = 0,
  ) => {
    const { x, z } = snap(rawX, rawZ);
    const dTipiX = x - tipiX;
    const dTipiZ = z - tipiZ;
    if (dTipiX * dTipiX + dTipiZ * dTipiZ < tipiBlockSq) return false;
    for (let i = 0; i < exclusionZones.length; i++) {
      const ez = exclusionZones[i];
      const ex = x - ez.x;
      const ez_ = z - ez.z;
      if (ex * ex + ez_ * ez_ < ez.radius * ez.radius) return false;
    }
    for (let i = 0; i < treePositions.length; i++) {
      const dx = treePositions[i].x - x;
      const dz = treePositions[i].z - z;
      if (dx * dx + dz * dz < minDistanceSq) return false;
    }
    /**
     * Species tier — rolled once per accepted slot so the same GLB
     * reads as three distinct silhouettes via per-instance scale and
     * leaf-tint shifts (`Flora.js` applies the actual deformation):
     *
     *   0 — pine: default proportions          (60 %)
     *   1 — squat deciduous: short + wide      (30 %)
     *   2 — spire: tall + narrow               (10 %)
     */
    const speciesRoll = Math.random();
    const species = speciesRoll < 0.6 ? 0 : speciesRoll < 0.9 ? 1 : 2;
    treePositions.push({ x, z, scale, widthOverride, priority, species });
    return true;
  };

  const numTipiTrees = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numTipiTrees; i++) {
    const angle = Math.PI * 0.8 + Math.random() * Math.PI * 1.4;
    const r =
      V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M + 0.6 + Math.random() * 3.2;
    tryAddPosition(
      tipiX + Math.cos(angle) * r,
      tipiZ + Math.sin(angle) * r,
      0.8 + Math.random() * 0.5,
    );
  }

  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
    const r = 31 + Math.random() * 5;
    tryAddPosition(
      Math.cos(angle) * r + (Math.random() - 0.5) * 1.5,
      Math.sin(angle) * r + (Math.random() - 0.5) * 1.5,
      0.9 + Math.random() * 0.8,
    );
  }

  for (let i = 0; i < 50; i++) {
    const angle = (i / 50) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const r = 36 + Math.random() * 9;
    tryAddPosition(
      Math.cos(angle) * r + (Math.random() - 0.5) * 2,
      Math.sin(angle) * r + (Math.random() - 0.5) * 2,
      1.0 + Math.random() * 0.7,
    );
  }

  const sentinelAngles = [0.3, 1.2, 2.5, 3.8, 5.0];
  sentinelAngles.forEach((a) => {
    tryAddPosition(
      Math.cos(a) * 28 + (Math.random() - 0.5),
      Math.sin(a) * 28 + (Math.random() - 0.5),
      1.6 + Math.random() * 0.5,
      1.2,
    );
  });

  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * Math.PI * 2 + (Math.random() - 0.4) * 0.2;
    const r = 45 + Math.random() * 20;
    tryAddPosition(Math.cos(angle) * r, Math.sin(angle) * r, 0.7 + Math.random() * 0.6);
  }

  for (let i = 0; i < 50; i++) {
    const angle = (i / 50) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const r = 40 + Math.random() * 25;
    tryAddPosition(Math.cos(angle) * r, Math.sin(angle) * r, 0.5 + Math.random() * 0.7);
  }

  for (let i = 0; i < 40; i++) {
    const angle = (i / 40) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const r = 65 + Math.random() * 25;
    tryAddPosition(Math.cos(angle) * r, Math.sin(angle) * r, 0.4 + Math.random() * 0.5);
  }

  // ── North-of-pond ridge bank ────────────────────────────────────────────
  // Trees on the hill ring (HILL_INNER..HILL_OUTER ≈ 55..90 m from origin)
  // arranged on a fan facing **north of the pond**. We pick the local
  // ridge centre as the unit vector from the world origin (tipi) toward
  // the pond centre, then walk outward past the basin into the hill
  // band. Slots are marked `priority: 1` so the Flora cap doesn't drop
  // them in favour of nearer trees.
  const pondNorthLen = Math.hypot(
    V2_POND_ENCLAVE_CENTER_X_M,
    V2_POND_ENCLAVE_CENTER_Z_M,
  ) || 1;
  const pondDirX = V2_POND_ENCLAVE_CENTER_X_M / pondNorthLen;
  const pondDirZ = V2_POND_ENCLAVE_CENTER_Z_M / pondNorthLen;
  /** Angle (rad) of the pond→origin axis, measured XZ. */
  const pondCentreAngle = Math.atan2(pondDirZ, pondDirX);
  /** Minimum distance from pond CENTRE so we don't drop trees on the
   *  basin rim itself (pond bowl edge at `basin + 1` m). */
  const minDistFromPondSq =
    (V2_POOL2_BASIN_RADIUS_M + 2.5) * (V2_POOL2_BASIN_RADIUS_M + 2.5);
  for (let i = 0; i < NORTH_HILL_RIDGE_COUNT; i++) {
    const angle =
      pondCentreAngle +
      (Math.random() - 0.5) * 2 * NORTH_HILL_HALF_ANGLE_RAD;
    const r =
      NORTH_HILL_RADIUS_MIN_M +
      Math.random() * (NORTH_HILL_RADIUS_MAX_M - NORTH_HILL_RADIUS_MIN_M);
    const x = Math.cos(angle) * r + (Math.random() - 0.5) * 1.6;
    const z = Math.sin(angle) * r + (Math.random() - 0.5) * 1.6;
    // Reject anything still inside the pond basin's exclusion ring (the
    // explicit world tests below catch this too, but the early-out
    // keeps the per-frame budget tiny).
    const pdx = x - V2_POND_ENCLAVE_CENTER_X_M;
    const pdz = z - V2_POND_ENCLAVE_CENTER_Z_M;
    if (pdx * pdx + pdz * pdz < minDistFromPondSq) continue;
    // Smaller scale than the village rings — these are background
    // ridgeline trees, not landmark sentinels. Reads as a wooded
    // overlook behind the pool.
    tryAddPosition(
      x,
      z,
      0.55 + Math.random() * 0.55,
      null,
      1, // priority — survives the cap first
    );
  }

  return treePositions;
}
