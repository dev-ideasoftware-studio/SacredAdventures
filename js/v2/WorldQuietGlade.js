/**
 * Sacred Adventures v2 — Quiet Glade scene module.
 *
 * A small contemplative clearing southwest of the village. Built entirely
 * from procedural primitives (no GLB fetch, no Tripo meshes) so the whole
 * scene weighs ~3k triangles — a deliberate counterweight to the
 * million-tri tipi GLBs that dominate the village budget.
 *
 * Contents:
 *   • Eight standing-stone monoliths arranged on an octagon ring,
 *     each octagonal-prism geometry (16 tris × 8 = 128 tris).
 *   • A flat moss disc deck inside the ring (32-segment cylinder ≈ 64 tris).
 *   • A central low-poly cairn — five stacked stones, each an icosahedron
 *     at detail 0 (20 tris × 5 = 100 tris).
 *   • Three ribbon-thin prayer flags on a single staff (low-poly).
 *   • A drifting wisp particle (single Points, 24 sprites).
 *
 * All meshes are tagged via `userData.anuKind` + `userData.anuSimulationDomain`
 * so the Anu sensorium picks them up in the next inventory tick.
 *
 * The module is purely cosmetic — it adds objects on load(), animates the
 * wisps + slow rotation of the prayer flags on update(), and tears them
 * down cleanly on unload(). No physics, no collisions, no triangle
 * regressions on the main hot path.
 *
 * Anchor: 4 hex-tiles southwest of origin (negative X, negative Z), well
 * clear of the tipi village (centered around 0,0 and +2 tiles east) and
 * the POOL2 anchor (10, 26).
 */

import * as THREE from "three";
import { V2_TILE_WORLD } from "./constants.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import { terrainY } from "./WorldTerrain.js";

const GLADE_CENTER_X_M = -V2_TILE_WORLD * 3;
const GLADE_CENTER_Z_M = -V2_TILE_WORLD * 3;

const GLADE_DECK_RADIUS_M = 4.6;
const GLADE_STONE_RING_RADIUS_M = 4.0;
const GLADE_STONE_COUNT = 8;

const STONE_PALETTE = [0x6b7079, 0x7a7f88, 0x5d6168, 0x868a92, 0x6f7480];

function makeStoneMaterial(rng) {
  const hex = STONE_PALETTE[Math.floor(rng() * STONE_PALETTE.length)];
  return new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 0.92,
    metalness: 0.04,
    flatShading: true,
  });
}

function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDeck(rng) {
  const geo = new THREE.CylinderGeometry(
    GLADE_DECK_RADIUS_M,
    GLADE_DECK_RADIUS_M + 0.18,
    0.12,
    32,
    1,
  );
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4f6b3a,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "quiet_glade_moss_deck";
  mesh.userData.anuKind = "quiet_glade_deck";
  mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  void rng;
  return mesh;
}

function buildStoneRing(rng) {
  const group = new THREE.Group();
  group.name = "quiet_glade_stone_ring";
  group.userData.anuKind = "quiet_glade_stone_ring";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  for (let i = 0; i < GLADE_STONE_COUNT; i++) {
    const ang = (i / GLADE_STONE_COUNT) * Math.PI * 2;
    const h = 1.4 + rng() * 1.1;
    const r = 0.34 + rng() * 0.12;
    const geo = new THREE.CylinderGeometry(r * 0.7, r, h, 8, 1);
    const mesh = new THREE.Mesh(geo, makeStoneMaterial(rng));
    mesh.position.set(
      Math.cos(ang) * GLADE_STONE_RING_RADIUS_M,
      h * 0.5,
      Math.sin(ang) * GLADE_STONE_RING_RADIUS_M,
    );
    mesh.rotation.y = rng() * Math.PI * 2;
    mesh.rotation.z = (rng() - 0.5) * 0.18;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `quiet_glade_standing_stone_${i}`;
    mesh.userData.anuKind = "quiet_glade_standing_stone";
    mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    group.add(mesh);
  }
  return group;
}

function buildCairn(rng) {
  const group = new THREE.Group();
  group.name = "quiet_glade_cairn";
  group.userData.anuKind = "quiet_glade_cairn";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  const radii = [0.55, 0.46, 0.38, 0.30, 0.22];
  let y = 0;
  for (let i = 0; i < radii.length; i++) {
    const r = radii[i];
    const geo = new THREE.IcosahedronGeometry(r, 0);
    const mesh = new THREE.Mesh(geo, makeStoneMaterial(rng));
    mesh.position.set((rng() - 0.5) * 0.08, y + r * 0.7, (rng() - 0.5) * 0.08);
    mesh.rotation.y = rng() * Math.PI * 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.anuKind = "quiet_glade_cairn_stone";
    mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    group.add(mesh);
    y += r * 1.35;
  }
  return group;
}

function buildPrayerStaff(rng) {
  const group = new THREE.Group();
  group.name = "quiet_glade_prayer_staff";
  group.userData.anuKind = "quiet_glade_prayer_staff";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  const staffH = 2.6;
  const staffMat = new THREE.MeshStandardMaterial({
    color: 0x5a3a22,
    roughness: 0.85,
    metalness: 0.0,
    flatShading: true,
  });
  const staff = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, staffH, 8, 1),
    staffMat,
  );
  staff.position.y = staffH * 0.5;
  staff.castShadow = true;
  staff.receiveShadow = true;
  group.add(staff);

  const flagColors = [0xd14d4d, 0xe5c252, 0x5089c4];
  const flagW = 0.65;
  const flagH = 0.42;
  for (let i = 0; i < flagColors.length; i++) {
    const geo = new THREE.PlaneGeometry(flagW, flagH, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: flagColors[i],
      roughness: 0.95,
      metalness: 0.0,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    const flag = new THREE.Mesh(geo, mat);
    flag.position.set(flagW * 0.55, staffH - 0.25 - i * (flagH + 0.08), 0);
    flag.rotation.y = (rng() - 0.5) * 0.2;
    flag.castShadow = false;
    flag.receiveShadow = false;
    flag.userData.anuKind = "quiet_glade_prayer_flag";
    flag.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    group.add(flag);
  }
  return group;
}

function buildWisps(rng) {
  const COUNT = 24;
  const positions = new Float32Array(COUNT * 3);
  const phases = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const ang = rng() * Math.PI * 2;
    const r = 0.6 + rng() * GLADE_DECK_RADIUS_M * 0.85;
    positions[i * 3 + 0] = Math.cos(ang) * r;
    positions[i * 3 + 1] = 0.4 + rng() * 1.6;
    positions[i * 3 + 2] = Math.sin(ang) * r;
    phases[i] = rng() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xfff2c4,
    size: 0.18,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.name = "quiet_glade_wisps";
  points.userData.anuKind = "quiet_glade_wisp_particles";
  points.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  points.userData.basePositions = positions.slice();
  points.userData.phases = phases;
  return points;
}

/* ─────────────────────── module ─────────────────────── */

export const QuietGladeModule = {
  name: "QuietGlade",

  _scene: null,
  _root: null,
  _staff: null,
  _wisps: null,
  _elapsed: 0,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;
    const rng = mulberry32(0x9c4d12 ^ 1);

    const root = new THREE.Group();
    root.name = "quiet_glade";
    root.userData.anuId = "environment.scene.quiet_glade";
    root.userData.anuKind = "quiet_glade";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    const deck = buildDeck(rng);
    const ring = buildStoneRing(rng);
    const cairn = buildCairn(rng);
    const staff = buildPrayerStaff(rng);
    staff.position.set(GLADE_STONE_RING_RADIUS_M * 0.55, 0, GLADE_STONE_RING_RADIUS_M * 0.55);

    const wisps = buildWisps(rng);

    root.add(deck);
    root.add(ring);
    root.add(cairn);
    root.add(staff);
    root.add(wisps);

    const groundY = terrainY(GLADE_CENTER_X_M, GLADE_CENTER_Z_M);
    root.position.set(GLADE_CENTER_X_M, groundY + 0.06, GLADE_CENTER_Z_M);

    scene.add(root);

    this._root = root;
    this._staff = staff;
    this._wisps = wisps;
    this._elapsed = 0;

    console.log(
      `%c[QuietGlade] 🪨 Procedural glade ready @ (${GLADE_CENTER_X_M.toFixed(1)}, ${GLADE_CENTER_Z_M.toFixed(1)}) — ~${this._approxTriangleCount()} tris`,
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;

    if (this._staff) {
      this._staff.rotation.y = Math.sin(this._elapsed * 0.18) * 0.12;
    }

    const wisps = this._wisps;
    if (wisps) {
      const pos = wisps.geometry.attributes.position;
      const base = wisps.userData.basePositions;
      const phases = wisps.userData.phases;
      const t = this._elapsed;
      for (let i = 0; i < phases.length; i++) {
        const i3 = i * 3;
        const ph = phases[i];
        pos.array[i3 + 0] = base[i3 + 0] + Math.sin(t * 0.6 + ph) * 0.18;
        pos.array[i3 + 1] = base[i3 + 1] + Math.sin(t * 0.9 + ph * 1.7) * 0.22;
        pos.array[i3 + 2] = base[i3 + 2] + Math.cos(t * 0.55 + ph) * 0.18;
      }
      pos.needsUpdate = true;
    }
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
    this._staff = null;
    this._wisps = null;
    this._scene = null;
  },

  _approxTriangleCount() {
    if (!this._root) return 0;
    let n = 0;
    this._root.traverse((o) => {
      const g = o.geometry;
      if (!g) return;
      if (g.index) n += Math.floor(g.index.count / 3);
      else if (g.attributes?.position) n += Math.floor(g.attributes.position.count / 3);
    });
    return n;
  },
};
