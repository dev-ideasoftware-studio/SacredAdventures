/**
 * Forest slot list — reproduced from `js/EnvironmentBuilder.js` (ANIME FOREST block):
 * same `minDistanceSq`, hex snap hook, ring radii/jitter, and `tryAddPosition(scale, widthOverride?)` keys.
 *
 * Ring *iteration counts* are doubled vs legacy (~2× forest headcount — overlap filter still caps final N).
 *
 * Uses `Math.random()` like legacy (non-deterministic per page load). When `window.getNearestHexCenter`
 * exists (legacy board), positions snap to hex centers; otherwise raw XZ is kept.
 */

/** @typedef {{ x: number; z: number; scale: number; widthOverride: number | null }} FloraTreeSlot */

/**
 * @param {object} [opts]
 * @param {number} [opts.tipiX]
 * @param {number} [opts.tipiZ]
 * @param {(tx: number, tz: number) => { x: number; z?: number; y?: number }} [opts.nearestHexCenter]
 * @returns {FloraTreeSlot[]}
 */
export function buildLegacyEnvironmentBuilderTreeSlots(opts = {}) {
  const tipiX = opts.tipiX ?? 0;
  const tipiZ = opts.tipiZ ?? 0;
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

  /**
   * @param {number} rawX
   * @param {number} rawZ
   * @param {number} scale
   * @param {number | null} [widthOverride]
   */
  const tryAddPosition = (rawX, rawZ, scale, widthOverride = null) => {
    const { x, z } = snap(rawX, rawZ);
    for (let i = 0; i < treePositions.length; i++) {
      const dx = treePositions[i].x - x;
      const dz = treePositions[i].z - z;
      if (dx * dx + dz * dz < minDistanceSq) return false;
    }
    treePositions.push({ x, z, scale, widthOverride });
    return true;
  };

  const numTipiTrees = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < numTipiTrees; i++) {
    const angle = Math.PI * 0.8 + Math.random() * Math.PI * 1.4;
    const r = 7.0 + Math.random() * 3.0;
    tryAddPosition(
      tipiX + Math.cos(angle) * r,
      tipiZ + Math.sin(angle) * r,
      0.8 + Math.random() * 0.5,
    );
  }

  for (let i = 0; i < 120; i++) {
    const angle = (i / 120) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
    const r = 31 + Math.random() * 5;
    tryAddPosition(
      Math.cos(angle) * r + (Math.random() - 0.5) * 1.5,
      Math.sin(angle) * r + (Math.random() - 0.5) * 1.5,
      0.9 + Math.random() * 0.8,
    );
  }

  for (let i = 0; i < 100; i++) {
    const angle = (i / 100) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const r = 36 + Math.random() * 9;
    tryAddPosition(
      Math.cos(angle) * r + (Math.random() - 0.5) * 2,
      Math.sin(angle) * r + (Math.random() - 0.5) * 2,
      1.0 + Math.random() * 0.7,
    );
  }

  const sentinelAngles = [
    0.3,
    1.2,
    2.5,
    3.8,
    5.0,
    0.95,
    2.08,
    3.55,
    4.71,
    5.71,
    6.03,
  ];
  sentinelAngles.forEach((a) => {
    tryAddPosition(
      Math.cos(a) * 28 + (Math.random() - 0.5),
      Math.sin(a) * 28 + (Math.random() - 0.5),
      1.6 + Math.random() * 0.5,
      1.2,
    );
  });

  for (let i = 0; i < 120; i++) {
    const angle = (i / 120) * Math.PI * 2 + (Math.random() - 0.4) * 0.2;
    const r = 45 + Math.random() * 20;
    tryAddPosition(Math.cos(angle) * r, Math.sin(angle) * r, 0.7 + Math.random() * 0.6);
  }

  for (let i = 0; i < 100; i++) {
    const angle = (i / 100) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const r = 40 + Math.random() * 25;
    tryAddPosition(Math.cos(angle) * r, Math.sin(angle) * r, 0.5 + Math.random() * 0.7);
  }

  for (let i = 0; i < 80; i++) {
    const angle = (i / 80) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const r = 65 + Math.random() * 25;
    tryAddPosition(Math.cos(angle) * r, Math.sin(angle) * r, 0.4 + Math.random() * 0.5);
  }

  return treePositions;
}
