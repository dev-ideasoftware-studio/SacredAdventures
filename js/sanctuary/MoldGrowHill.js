/**
 * Sacred Adventures — sanctuary part 10 of N: MOLD TOOL · GROW HILL.
 *
 * First real handler against the `SanctuaryMutations` registry. When
 * a kid clicks the ground in top-down mode, the input layer publishes
 * a `grow_hill` mutation; THIS module materialises the mesh.
 *
 * Design (Anu's brief — "grow the beautiful hills that will surround
 * our pool and sacred valley so kids can have their digital sanctuary
 * for free"):
 *
 *   • Each hill is a low-poly dome (half-sphere with smoothed Z-axis
 *     flattening + meadow-coloured material) anchored to the click
 *     point on the heightfield.
 *   • Radius + height are mild defaults that scale gently if the
 *     mutation payload carries `radius` / `height` (future tool-palette).
 *   • Colour matches the baseline hill ring's mid-slope green so a
 *     grown hill blends with the world Anu already shipped.
 *   • Anu-tagged on creation (ENVIRONMENT domain, anuKind
 *     `sanctuary_mold_hill`); the mesh is stored on `mutation.mesh` so
 *     SAVE / RESET in the SanctuaryMutations registry can dispose it.
 *
 * Triangle target per hill: ~96 tris (sphere segs 12×6 = 72 vertices).
 * 20 hills = ~2 k tris — well inside Anu's frame budget.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const DEFAULT_RADIUS_M = 4.5;
const DEFAULT_HEIGHT_M = 2.2;

let _sharedMaterial = null;
function hillMaterial() {
  if (_sharedMaterial) return _sharedMaterial;
  _sharedMaterial = new THREE.MeshStandardMaterial({
    color: 0x7c9a5e, // matches the colHill band in SanctuaryGround
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });
  return _sharedMaterial;
}

/**
 * Build one hill dome at world (x, z) sitting on the terrain.
 * @param {{ x:number, z:number, payload?:{radius?:number, height?:number} }} mut
 * @param {THREE.Scene} scene
 */
function buildHillMesh(mut, scene) {
  const payload = mut.payload ?? {};
  const radius = Number.isFinite(payload.radius) ? payload.radius : DEFAULT_RADIUS_M;
  const height = Number.isFinite(payload.height) ? payload.height : DEFAULT_HEIGHT_M;

  // Half-sphere — top half only — with vertical scale = height/radius so
  // the dome reads like a hill, not a bubble. Skipping the bottom half
  // halves the triangles vs a full sphere.
  const geo = new THREE.SphereGeometry(
    radius, 14, 8,
    0, Math.PI * 2,           // full azimuth
    0, Math.PI / 2,           // top half only (phi 0..π/2)
  );
  geo.scale(1, height / radius, 1);

  // Subtle Y-jitter on the rim verts so the dome's base reads organic.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0.02) {
      // Pull rim verts slightly inward + downward so the hill softens
      // into the ground.
      pos.setY(i, y - 0.04);
    }
  }
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, hillMaterial());
  const groundY = sanctuaryGroundY(mut.x, mut.z);
  // Lift very slightly so the rim doesn't z-fight the terrain.
  mesh.position.set(mut.x, groundY - 0.05, mut.z);
  // Random yaw so adjacent hills don't read identical.
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `sanctuary_mold_hill_${mut.id ?? "x"}`;
  mesh.userData.anuId = `environment.sanctuary.mold.hill.${mut.id ?? "x"}`;
  mesh.userData.anuKind = "sanctuary_mold_hill";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  scene.add(mesh);
  return mesh;
}

export const MoldGrowHillModule = {
  name: "MoldGrowHill",

  _scene: null,

  async load(scene) {
    this._scene = scene;
    // Register the handler. SanctuaryMutations exposes itself on
    // `window.SanctuaryMutations` (see SanctuaryMutations.js); we hook
    // in here so the registry knows what `grow_hill` does.
    const reg = typeof window !== "undefined" ? window.SanctuaryMutations : null;
    if (!reg?.registerToolHandler) {
      console.warn("[MoldGrowHill] SanctuaryMutations registry not present — skipping handler wire.");
      return;
    }
    reg.registerToolHandler("grow_hill", (mut, sceneArg) => {
      const target = sceneArg ?? this._scene;
      if (!target) return;
      const mesh = buildHillMesh(mut, target);
      // Store the mesh ref on the mutation so RESET can dispose it.
      mut.mesh = mesh;
    });
    console.log(
      "%c[MoldGrowHill] 🏔  Handler registered — clicks in top-down mode grow hills.",
      "color:#7c9a5e;font-weight:bold;",
    );
  },

  update() { /* mesh creation happens on mutation publish, not per-frame */ },

  unload() {
    this._scene = null;
    // The handler stays registered until the mutation registry tears
    // down; cleanup of placed hills is handled via `SanctuaryMutations.applyReset()`.
  },
};
