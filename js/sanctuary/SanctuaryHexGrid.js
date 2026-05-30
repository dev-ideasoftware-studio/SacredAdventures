/**
 * Sacred Adventures — sanctuary: LEGACY GOLD HEX-LINE GRID.
 *
 * Ports the warm-gold neumorphic hexagon OUTLINE grid from the legacy
 * engine (`EnvironmentBuilder.createVillageHexGrid`) onto the v2
 * sanctuary scene. The legacy `EnvironmentBuilder` is not loaded by the
 * sanctuary boot path, so this is a self-contained re-implementation of
 * just the line ring — no filled hex tiles, only the elegant boardgame
 * outlines the user asked to bring back.
 *
 * Legacy fidelity (1:1 with EnvironmentBuilder lines 184-224):
 *   • 25 m hexagons (RADIUS 25, GAP 0.5 → size 24.5)
 *   • 0.25 m border width (inner hole at size - 0.25)
 *   • thin ExtrudeGeometry (depth 0.04) with a small bevel
 *   • gold emissive material: #fff3e0 base, #ffb74d emissive @ 0.35,
 *     roughness 0.1, metalness 0.8, opacity 0.85
 *
 * Views (user spec 2026-05-29):
 *   • Layer 0 — main FPV 3D  ✔ (also covers the fishing PANORAMA, which
 *               is the main camera lifted/pulled back)
 *   • Layer 1 — PIP minimap   ✔
 *   • Layer 2 — fish-finder   -- DELIBERATELY OFF (would clutter the
 *               close-up fish view)
 *
 * Anu domain: ENVIRONMENT (decorative overlay, not a building).
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

// ── Legacy geometry constants (1:1 with EnvironmentBuilder) ──────────────
const HEX_RADIUS_M = 25;        // 25 m hexagons (legacy village scale)
const HEX_GAP_M = 0.5;          // 1 m visible trench between tiles
const HEX_SIZE_M = HEX_RADIUS_M - HEX_GAP_M;
const HEX_BORDER_M = 0.25;      // 25 cm elegant border width
const HEX_RINGS = 3;            // 3 rings ≈ 150 m across — covers the 110 m terrain
const TERRAIN_CULL_SQ = 80 * 80; // drop hexes whose centre is past the visible meadow

/** Build the gold neumorphic hex-OUTLINE line geometry (one tile). */
function buildHexLineGeometry() {
  const outerShape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    if (i === 0) outerShape.moveTo(Math.cos(a) * HEX_SIZE_M, Math.sin(a) * HEX_SIZE_M);
    else outerShape.lineTo(Math.cos(a) * HEX_SIZE_M, Math.sin(a) * HEX_SIZE_M);
  }
  outerShape.closePath();

  const innerHole = new THREE.Path();
  const innerSize = HEX_SIZE_M - HEX_BORDER_M;
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI * 2) / 6;
    if (i === 0) innerHole.moveTo(Math.cos(a) * innerSize, Math.sin(a) * innerSize);
    else innerHole.lineTo(Math.cos(a) * innerSize, Math.sin(a) * innerSize);
  }
  innerHole.closePath();
  outerShape.holes.push(innerHole);

  const geo = new THREE.ExtrudeGeometry(outerShape, {
    depth: 0.04, // very thin line
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSteps: 1,
    bevelSize: 0.04,
    bevelThickness: 0.04,
  });
  geo.rotateX(Math.PI / 2); // lay flat on the ground plane
  return geo;
}

/** Hex axial grid → world positions (pointy-top layout, legacy 1:1). */
function hexPositions() {
  const positions = [];
  const w = Math.sqrt(3) * HEX_RADIUS_M;
  const h = 1.5 * HEX_RADIUS_M;
  for (let q = -HEX_RINGS; q <= HEX_RINGS; q++) {
    for (let r = Math.max(-HEX_RINGS, -q - HEX_RINGS); r <= Math.min(HEX_RINGS, -q + HEX_RINGS); r++) {
      const x = w * (q + r / 2);
      const z = h * r;
      if (x * x + z * z <= TERRAIN_CULL_SQ) positions.push({ x, z });
    }
  }
  return positions;
}

export const SanctuaryHexGridModule = {
  name: "SanctuaryHexGrid",

  _scene: null,
  _lines: null,

  async load(scene) {
    if (this._lines) return;
    this._scene = scene;

    const lineGeo = buildHexLineGeometry();
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xfff3e0,
      emissive: 0xffb74d, // warm gold highlight
      emissiveIntensity: 0.35,
      roughness: 0.1,
      metalness: 0.8,
      transparent: true,
      opacity: 0.85,
    });

    const positions = hexPositions();
    const lines = new THREE.InstancedMesh(lineGeo, lineMat, positions.length);
    lines.name = "sanctuary_hex_lines";
    lines.userData.anuId = "environment.sanctuary.hex_lines";
    lines.userData.anuKind = "sanctuary_hex_lines";
    lines.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    const dummy = new THREE.Object3D();
    positions.forEach((pos, i) => {
      const groundY = sanctuaryGroundY(pos.x, pos.z);
      // Sit the thin line flush on the ground, lifted a hair to avoid
      // z-fighting with the terrain surface.
      dummy.position.set(pos.x, groundY + 0.04, pos.z);
      dummy.updateMatrix();
      lines.setMatrixAt(i, dummy.matrix);
    });
    lines.instanceMatrix.needsUpdate = true;

    // VIEWS: layer 0 (main FPV + panorama) + layer 1 (PIP minimap).
    // Layer 2 (fish-finder lens) is intentionally left OFF per user spec.
    lines.layers.enable(0);
    lines.layers.enable(1);

    scene.add(lines);
    this._lines = lines;

    console.log(
      `%c[Sanctuary] ⬡ Legacy gold hex-line grid online — ${positions.length} tiles, layers 0+1 (fish-finder off).`,
      "color:#ffb74d;font-weight:bold;",
    );
  },

  update() {},

  unload(scene) {
    if (!this._lines) return;
    scene.remove(this._lines);
    this._lines.geometry.dispose?.();
    const m = this._lines.material;
    if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
    else m?.dispose?.();
    this._lines = null;
    this._scene = null;
  },
};
