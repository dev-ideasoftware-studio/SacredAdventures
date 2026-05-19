/**
 * Sacred Adventures — sanctuary part 5 of 5: THE 3D CIRCLES.
 *
 * Three concentric circle systems that read as guiding light on the
 * sanctuary surfaces. Anu domain: ENVIRONMENT (decorative/UX effects,
 * not buildings).
 *
 *   1. Fishing-spot ring   — gold double-ring on the dock end-cap, the
 *                            "stand here to fish" affordance. Animated
 *                            slow rotation + gentle radial pulse so the
 *                            eye lands on it from any distance.
 *
 *   2. Pool perimeter ring — soft cyan ring just inside the water rim,
 *                            tracing the pool shape. Reads as moonlight
 *                            kissing the waterline; gives the pool a
 *                            visible "edge of the sanctuary" feel.
 *
 *   3. Fish-bite ripples   — pool of expanding ring meshes initialised
 *                            invisible; emit one each time `pulseAt(x,
 *                            z)` is called (sanctuary-level pulse used
 *                            by Fish module when one passes near the
 *                            fishing spot). Animates outward + fades.
 *
 * Geometry total: ~300 tris.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import {
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
  sanctuaryGroundY,
} from "./SanctuaryGround.js";

const GOLD = 0xfbc02d;
const MOONLIGHT = 0xb6dff5;

function buildFishingSpotRing(spotX, spotY, spotZ) {
  const group = new THREE.Group();
  group.name = "sanctuary_fishing_spot_ring";
  group.userData.anuId = "environment.sanctuary.fishing_spot_ring";
  group.userData.anuKind = "sanctuary_fishing_spot_ring";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.position.set(spotX, spotY + 0.03, spotZ);

  // Outer ring — thick gold band.
  const outerGeo = new THREE.RingGeometry(0.85, 1.05, 48);
  const outerMat = new THREE.MeshBasicMaterial({
    color: GOLD,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.rotation.x = -Math.PI / 2;
  outer.renderOrder = 10;
  outer.userData.anuKind = "sanctuary_fishing_spot_ring_outer";
  outer.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(outer);

  // Inner thin ring — hair-line accent that emphasises the "target".
  const innerGeo = new THREE.RingGeometry(0.55, 0.62, 36);
  const innerMat = new THREE.MeshBasicMaterial({
    color: GOLD,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.rotation.x = -Math.PI / 2;
  inner.renderOrder = 10;
  inner.userData.anuKind = "sanctuary_fishing_spot_ring_inner";
  inner.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  group.add(inner);

  // 4 short tick marks across the outer ring — 12 / 3 / 6 / 9 o'clock.
  const tickMat = new THREE.MeshBasicMaterial({
    color: GOLD,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    toneMapped: false,
  });
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    const tickGeo = new THREE.PlaneGeometry(0.08, 0.22);
    const tick = new THREE.Mesh(tickGeo, tickMat);
    tick.rotation.x = -Math.PI / 2;
    tick.position.set(Math.cos(ang) * 0.95, 0.01, Math.sin(ang) * 0.95);
    tick.lookAt(group.position);
    tick.rotation.x = -Math.PI / 2;
    tick.rotation.z = -ang;
    tick.renderOrder = 10;
    tick.userData.anuKind = "sanctuary_fishing_spot_tick";
    tick.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    group.add(tick);
  }
  return group;
}

function buildPoolPerimeter(waterY) {
  // Thin cyan ring just inside the water radius — moonlight at the edge.
  const geo = new THREE.RingGeometry(
    SANCTUARY_POOL_RADIUS_M * 0.88,
    SANCTUARY_POOL_RADIUS_M * 0.94,
    72,
  );
  const mat = new THREE.MeshBasicMaterial({
    color: MOONLIGHT,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SANCTUARY_POOL_CENTER_X, waterY + 0.05, SANCTUARY_POOL_CENTER_Z);
  ring.renderOrder = 9;
  ring.name = "sanctuary_pool_perimeter_ring";
  ring.userData.anuId = "environment.sanctuary.pool_perimeter_ring";
  ring.userData.anuKind = "sanctuary_pool_perimeter_ring";
  ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  return ring;
}

function buildRipplePool(waterY) {
  // 6 reusable ripples. Each starts invisible; `pulseAt` recycles them.
  const RIPPLE_COUNT = 6;
  const ripples = [];
  const baseGeo = new THREE.RingGeometry(0.08, 0.10, 28);
  for (let i = 0; i < RIPPLE_COUNT; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: MOONLIGHT,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(baseGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, waterY + 0.04, 0);
    mesh.scale.set(1, 1, 1);
    mesh.visible = false;
    mesh.renderOrder = 11;
    mesh.name = `sanctuary_ripple_${i}`;
    mesh.userData.anuKind = "sanctuary_ripple";
    mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    ripples.push({ mesh, mat, life: 0 });
  }
  return ripples;
}

export const SanctuaryCirclesModule = {
  name: "SanctuaryCircles",

  _scene: null,
  _root: null,
  _fishingRing: null,
  _perimeterRing: null,
  _ripples: [],
  _elapsed: 0,
  _autoPulseT: 0,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;

    const root = new THREE.Group();
    root.name = "sanctuary_circles_root";
    root.userData.anuId = "environment.sanctuary.circles";
    root.userData.anuKind = "sanctuary_circles";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    const spot =
      typeof window !== "undefined" && window.__sanctuaryFishingSpot
        ? window.__sanctuaryFishingSpot
        : { x: 0, y: 0.5, z: 0 };
    this._fishingRing = buildFishingSpotRing(spot.x, spot.y, spot.z);
    root.add(this._fishingRing);

    const waterY =
      typeof window !== "undefined" && Number.isFinite(window.__sanctuaryWaterY)
        ? window.__sanctuaryWaterY
        : sanctuaryGroundY(SANCTUARY_POOL_CENTER_X, SANCTUARY_POOL_CENTER_Z) + 0.4;
    this._perimeterRing = buildPoolPerimeter(waterY);
    root.add(this._perimeterRing);

    this._ripples = buildRipplePool(waterY);
    for (const r of this._ripples) root.add(r.mesh);

    scene.add(root);
    this._root = root;

    // Expose `pulseAt(x, z)` on the module so Fish can call it when a
    // trout passes near the fishing spot (or as an ambient cue). Also
    // hung on `window` for ad-hoc DevTools experiments.
    if (typeof window !== "undefined") {
      window.sanctuaryPulse = (x, z) => this.pulseAt(x, z);
    }

    console.log(
      "%c[Sanctuary] ⭕ Circles ready — fishing-spot ring, pool perimeter, ripple pool.",
      "color:#fbc02d;font-weight:bold;",
    );
  },

  /**
   * Trigger one expanding ring at (x, z) on the water surface. Cycles
   * through the pre-allocated `_ripples` slots — never allocates.
   */
  pulseAt(x, z) {
    for (const slot of this._ripples) {
      if (!slot.mesh.visible || slot.life >= 1.0) {
        slot.mesh.visible = true;
        slot.mesh.position.x = x;
        slot.mesh.position.z = z;
        slot.mesh.scale.set(1, 1, 1);
        slot.mat.opacity = 0.65;
        slot.life = 0;
        return;
      }
    }
  },

  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;
    const t = this._elapsed;

    // Fishing-spot ring — slow rotation + gentle scale pulse.
    if (this._fishingRing) {
      this._fishingRing.rotation.y = t * 0.35;
      const pulse = 1 + Math.sin(t * 1.7) * 0.04;
      this._fishingRing.scale.set(pulse, 1, pulse);
    }

    // Perimeter ring — subtle opacity breathing.
    if (this._perimeterRing) {
      const mat = this._perimeterRing.material;
      mat.opacity = 0.28 + Math.sin(t * 0.6) * 0.08;
    }

    // Ripple ageing — each pulse expands radially and fades over ~1.8 s.
    for (const slot of this._ripples) {
      if (!slot.mesh.visible) continue;
      slot.life += delta / 1.8;
      if (slot.life >= 1.0) {
        slot.mesh.visible = false;
        slot.mat.opacity = 0;
        continue;
      }
      const s = 1 + slot.life * 9.0;
      slot.mesh.scale.set(s, 1, s);
      slot.mat.opacity = (1 - slot.life) * 0.65;
    }

    // Ambient auto-pulse — one ripple every ~5 s at a wandering point
    // inside the pool. Sells "life under the surface" even before any
    // fish-bite mini-game is wired.
    this._autoPulseT += delta;
    if (this._autoPulseT > 4 + Math.sin(t * 0.13) * 1.5) {
      this._autoPulseT = 0;
      const ang = t * 0.7;
      const r = SANCTUARY_POOL_RADIUS_M * (0.35 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.21)));
      const px = SANCTUARY_POOL_CENTER_X + Math.cos(ang) * r;
      const pz = SANCTUARY_POOL_CENTER_Z + Math.sin(ang) * r;
      this.pulseAt(px, pz);
    }
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose?.());
        else o.material.dispose?.();
      }
    });
    this._root = null;
    this._fishingRing = null;
    this._perimeterRing = null;
    this._ripples = [];
    this._scene = null;
    if (typeof window !== "undefined") delete window.sanctuaryPulse;
  },
};
