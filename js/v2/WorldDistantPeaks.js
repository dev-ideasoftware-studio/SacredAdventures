/**
 * Sacred Adventures v2 — Distant snowcapped peaks backdrop.
 *
 * Procedural low-poly mountain ridge planted far to the NORTH of the
 * playable world (z ≈ +220..+360 m, well beyond `MOUNTAIN_OUTER` at
 * 118 m and the `WORLD_EDGE` cliff drop at the same radius). Reads as
 * "snowy peaks on the horizon past the unclimbable hills" without
 * adding any GLB fetches, textures, or skybox layers.
 *
 * Build approach:
 *   • Two parallel ridges (near + far) of ~14 cone-shaped peaks each,
 *     spread across a 600-m east-west arc north of the village. Two
 *     layers give parallax separation when the player looks around.
 *   • Each peak is a single `ConeGeometry(radius, height, 6 segments)`
 *     — 6 base verts + apex = 12 tris per peak × 28 peaks = 336 tris.
 *   • Vertex colours blend deep slate at the base → grey shoulders →
 *     near-white snow above a configurable snow line. No extra draw
 *     calls for snowcaps; one MeshStandardMaterial per layer.
 *   • `material.fog = false` so the village fog (fogFar = 160 m) does
 *     not white-out the ridge — atmospheric perspective is implied by
 *     the desaturated colour palette instead.
 *
 * Heads-up: this module is decorative only. Peaks are NOT inserted
 * into the heightfield (`terrainY` is unchanged), have no physics
 * bodies, and are tagged ENVIRONMENT for the Anu sensorium.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";

const RIDGE_CENTER_Z_NEAR = 235;
const RIDGE_CENTER_Z_FAR = 340;
const RIDGE_SPAN_X = 620;

const NEAR_PEAK_COUNT = 14;
const FAR_PEAK_COUNT = 14;

const NEAR_BASE_RADIUS_M = 28;
const NEAR_HEIGHT_RANGE_M = [38, 64];
const FAR_BASE_RADIUS_M = 36;
const FAR_HEIGHT_RANGE_M = [54, 88];

const ROCK_COLOR = new THREE.Color(0x3a4452);
const SHOULDER_COLOR = new THREE.Color(0x6f7a82);
const SNOW_COLOR = new THREE.Color(0xf2f5fa);

function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Paint vertex colours on a cone so the lower hull stays slate-rock and
 * the upper portion blends through shoulder-grey into snow-white. The
 * snow line is expressed as a fraction `t` along the cone height (0 at
 * base, 1 at apex).
 */
function paintSnowCap(geo, snowLineT) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(0.001, maxY - minY);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / span;
    if (t < snowLineT * 0.85) {
      tmp.copy(ROCK_COLOR);
    } else if (t < snowLineT) {
      const k = (t - snowLineT * 0.85) / Math.max(0.001, snowLineT * 0.15);
      tmp.copy(ROCK_COLOR).lerp(SHOULDER_COLOR, k);
    } else {
      const k = Math.min(1, (t - snowLineT) / Math.max(0.001, 1 - snowLineT));
      tmp.copy(SHOULDER_COLOR).lerp(SNOW_COLOR, 0.55 + 0.45 * k);
    }
    colors[i * 3 + 0] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function buildRidge(opts) {
  const {
    count,
    baseZ,
    spanX,
    baseRadius,
    heightRange,
    snowLineT,
    seed,
    layerName,
  } = opts;
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  group.name = `distant_peaks_${layerName}`;
  group.userData.anuKind = "distant_peaks_layer";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true,
    fog: false,
  });

  const startX = -spanX * 0.5;
  const step = spanX / (count - 1);

  for (let i = 0; i < count; i++) {
    const jitterX = (rng() - 0.5) * step * 0.45;
    const jitterZ = (rng() - 0.5) * 40;
    const x = startX + i * step + jitterX;
    const z = baseZ + jitterZ;
    const height =
      heightRange[0] + rng() * (heightRange[1] - heightRange[0]);
    const radius = baseRadius * (0.75 + rng() * 0.5);

    const geo = new THREE.ConeGeometry(radius, height, 6, 1, false);
    paintSnowCap(geo, snowLineT * (0.92 + rng() * 0.16));

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, height * 0.5 - 6, z);
    mesh.rotation.y = rng() * Math.PI * 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.name = `distant_peak_${layerName}_${i}`;
    mesh.userData.anuKind = "distant_peak";
    mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    group.add(mesh);
  }
  return group;
}

/* ─────────────────────── module ─────────────────────── */

export const DistantPeaksModule = {
  name: "DistantPeaks",

  _scene: null,
  _root: null,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;

    const root = new THREE.Group();
    root.name = "distant_peaks";
    root.userData.anuId = "environment.scene.distant_peaks";
    root.userData.anuKind = "distant_peaks";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    const nearLayer = buildRidge({
      count: NEAR_PEAK_COUNT,
      baseZ: RIDGE_CENTER_Z_NEAR,
      spanX: RIDGE_SPAN_X,
      baseRadius: NEAR_BASE_RADIUS_M,
      heightRange: NEAR_HEIGHT_RANGE_M,
      snowLineT: 0.55,
      seed: 0x71b2c4,
      layerName: "near",
    });
    const farLayer = buildRidge({
      count: FAR_PEAK_COUNT,
      baseZ: RIDGE_CENTER_Z_FAR,
      spanX: RIDGE_SPAN_X * 1.2,
      baseRadius: FAR_BASE_RADIUS_M,
      heightRange: FAR_HEIGHT_RANGE_M,
      snowLineT: 0.42,
      seed: 0x91d057,
      layerName: "far",
    });

    root.add(nearLayer);
    root.add(farLayer);
    scene.add(root);

    this._root = root;

    let tris = 0;
    root.traverse((o) => {
      const g = o.geometry;
      if (!g) return;
      if (g.index) tris += Math.floor(g.index.count / 3);
      else if (g.attributes?.position) tris += Math.floor(g.attributes.position.count / 3);
    });

    console.log(
      `%c[DistantPeaks] 🏔  Snowcapped ridge backdrop ready — ${NEAR_PEAK_COUNT + FAR_PEAK_COUNT} peaks, ${tris} tris`,
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update() {
    /* Static decor — no per-frame work. */
  },

  unload(scene) {
    const root = this._root;
    if (!root) return;
    scene.remove(root);
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material.dispose?.();
      }
    });
    this._root = null;
    this._scene = null;
  },
};
