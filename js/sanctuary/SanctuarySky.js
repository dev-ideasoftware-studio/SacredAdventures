/**
 * Sacred Adventures — sanctuary part 11 of N: SKY · CLOUDS + BIRDS.
 *
 * Anu domain: ENVIRONMENT. Atmosphere layer that lives between the
 * sky dome and the meadow. Two pieces:
 *
 *   • Cloud puffs   — 9 low-poly cumulus shapes (clustered icospheres
 *                     painted soft white) drifting slowly on the wind.
 *                     Each cloud is a small group of 2-3 overlapping
 *                     spheres so the silhouette reads soft, not perfect.
 *   • Distant birds — 16 tiny dark "V" sprites circling at high
 *                     altitude. They're billboard quads with a baked
 *                     bird-silhouette canvas texture, billboarded to
 *                     always face the camera. Cheap, alive, magical.
 *
 * Triangle target: clouds ~360 tris total, birds 32 tris total → 392.
 *
 * Why no shader work: the user just paid the bill for the hill ring +
 * baseline flora coming in next part; this layer is intentionally
 * primitives-only so it composes onto the existing budget cleanly.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";

const CLOUD_COUNT = 9;
const CLOUD_BASE_Y = 36;       // metres above ground
const CLOUD_RADIUS_RANGE = [3.2, 6.5];
const CLOUD_FIELD_RADIUS = 80; // horizontal extent of the cloud field
const CLOUD_DRIFT_MPS = 0.6;

const BIRD_COUNT = 16;
const BIRD_BASE_Y = 24;
const BIRD_ORBIT_R_MIN = 22;
const BIRD_ORBIT_R_MAX = 55;
const BIRD_SIZE_M = 0.65;

function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a soft cumulus billboard texture — multi-layered radial
 * gradients with light noise so each sprite reads gaseous (not as a
 * hard ball). Cached at module scope so all clouds share the same
 * canvas; per-cluster opacity is varied via material clone instead.
 */
let _cachedCloudTexture = null;
function cloudTexture() {
  if (_cachedCloudTexture) return _cachedCloudTexture;
  const SZ = 256;
  const c = document.createElement("canvas");
  c.width = SZ; c.height = SZ;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, SZ, SZ);
  // Stack of overlapping soft radial gradients — gives a fluffy
  // multi-lobe profile that doesn't read as a perfect circle.
  for (let i = 0; i < 7; i++) {
    const cx = SZ * (0.30 + Math.random() * 0.40);
    const cy = SZ * (0.32 + Math.random() * 0.36);
    const r = SZ * (0.18 + Math.random() * 0.22);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0,    "rgba(255, 255, 255, 0.85)");
    grad.addColorStop(0.55, "rgba(255, 255, 255, 0.32)");
    grad.addColorStop(1,    "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SZ, SZ);
  }
  // Sprinkle a thin noise layer so the gradient doesn't look CG.
  const noise = ctx.createImageData(SZ, SZ);
  for (let i = 0; i < noise.data.length; i += 4) {
    const v = Math.random() * 12;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = 255;
    noise.data[i + 3] = v;
  }
  ctx.globalCompositeOperation = "lighter";
  ctx.putImageData(noise, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  _cachedCloudTexture = new THREE.CanvasTexture(c);
  _cachedCloudTexture.anisotropy = 4;
  return _cachedCloudTexture;
}

/**
 * Per-cluster SpriteMaterial — cloned from a base so each cloud can
 * fade opacity independently (e.g. when a cloud drifts over the
 * player's tile and Anu wants it 95 % transparent).
 */
function makeCloudMaterial(baseOpacity) {
  return new THREE.SpriteMaterial({
    map: cloudTexture(),
    color: 0xfff5e6,         // very faint warm tint, never pure white
    transparent: true,
    opacity: baseOpacity,
    depthWrite: false,
    fog: false,
    toneMapped: true,
    blending: THREE.NormalBlending,
  });
}

/**
 * One "cloud" = 5-8 overlapping soft sprite billboards in a 3D cluster.
 * Multiple sprites with the gaseous texture stack up volumetric depth
 * — light hitting different parts at different angles reads as a real
 * fluffy cumulus, not an icosphere ball.
 */
function buildCloudPuff(rng, parent) {
  const group = new THREE.Group();
  group.name = "sanctuary_cloud_puff";
  group.userData.anuKind = "sanctuary_cloud";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

  const baseOpacity = 0.55 + rng() * 0.20;        // each cluster a bit different
  const cloudMat = makeCloudMaterial(baseOpacity); // unique per cluster
  group.userData.cloudMat = cloudMat;
  group.userData.baseOpacity = baseOpacity;
  group.userData.currentOpacity = baseOpacity;    // tracked for the fade

  const r0 = CLOUD_RADIUS_RANGE[0] + rng() * (CLOUD_RADIUS_RANGE[1] - CLOUD_RADIUS_RANGE[0]);
  const sprites = 5 + Math.floor(rng() * 4);
  for (let i = 0; i < sprites; i++) {
    const sp = new THREE.Sprite(cloudMat);
    // Cluster size: bigger sprite near the centre, smaller toward the edges.
    const isCenter = i === 0;
    const s = r0 * (isCenter ? 1.4 : 0.6 + rng() * 0.6) * (0.95 + rng() * 0.4);
    sp.scale.set(s, s * 0.72, 1);
    sp.position.set(
      (rng() - 0.5) * r0 * 1.6,
      (rng() - 0.5) * r0 * 0.30,
      (rng() - 0.5) * r0 * 1.2,
    );
    sp.renderOrder = 6;
    sp.name = "sanctuary_cloud_billboard";
    sp.userData.anuKind = "sanctuary_cloud_billboard";
    sp.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    group.add(sp);
  }

  // Initial position somewhere in the cloud field.
  const angle = rng() * Math.PI * 2;
  const radius = rng() * CLOUD_FIELD_RADIUS;
  group.position.set(
    Math.cos(angle) * radius,
    CLOUD_BASE_Y + (rng() - 0.5) * 8,
    Math.sin(angle) * radius,
  );
  // Per-cloud drift direction (mostly along +X with slight Z wander).
  group.userData.driftX = CLOUD_DRIFT_MPS * (0.6 + rng() * 0.6);
  group.userData.driftZ = CLOUD_DRIFT_MPS * (rng() - 0.5) * 0.4;
  parent.add(group);
  return group;
}

let _cachedBirdMat = null;
function birdMaterial() {
  if (_cachedBirdMat) return _cachedBirdMat;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 64, 32);
  // Simple V-shape silhouette — two diagonal wings.
  ctx.strokeStyle = "#1c1814";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(6, 22);
  ctx.lineTo(32, 11);
  ctx.lineTo(58, 22);
  ctx.stroke();
  // Body dot.
  ctx.fillStyle = "#1c1814";
  ctx.beginPath();
  ctx.arc(32, 13, 2.5, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  _cachedBirdMat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  return _cachedBirdMat;
}

function buildBird(rng, parent) {
  const sprite = new THREE.Sprite(birdMaterial());
  sprite.scale.set(BIRD_SIZE_M, BIRD_SIZE_M * 0.5, 1);
  sprite.name = "sanctuary_bird";
  sprite.userData.anuKind = "sanctuary_bird";
  sprite.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FAUNA;
  // Per-bird orbital params.
  sprite.userData.orbitR = BIRD_ORBIT_R_MIN + rng() * (BIRD_ORBIT_R_MAX - BIRD_ORBIT_R_MIN);
  sprite.userData.orbitY = BIRD_BASE_Y + (rng() - 0.5) * 8;
  sprite.userData.angularSpeed = (rng() < 0.5 ? -1 : 1) * (0.05 + rng() * 0.12);
  sprite.userData.phase = rng() * Math.PI * 2;
  sprite.userData.bobAmp = 0.4 + rng() * 0.6;
  sprite.renderOrder = 7;
  parent.add(sprite);
  return sprite;
}

export const SanctuarySkyModule = {
  name: "SanctuarySky",

  _scene: null,
  _root: null,
  _clouds: [],
  _birds: [],
  _elapsed: 0,

  async load(scene) {
    if (this._root) return;
    this._scene = scene;
    const rng = mulberry32(0xc10cd1e);

    const root = new THREE.Group();
    root.name = "sanctuary_sky_atmosphere";
    root.userData.anuId = "environment.sanctuary.sky.atmosphere";
    root.userData.anuKind = "sanctuary_sky_atmosphere";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;

    this._clouds = [];
    for (let i = 0; i < CLOUD_COUNT; i++) {
      this._clouds.push(buildCloudPuff(rng, root));
    }
    this._birds = [];
    for (let i = 0; i < BIRD_COUNT; i++) {
      this._birds.push(buildBird(rng, root));
    }

    scene.add(root);
    this._root = root;
    console.log(
      `%c[Sanctuary] ☁  Sky atmosphere ready — ${CLOUD_COUNT} clouds drifting, ${BIRD_COUNT} birds wheeling.`,
      "color:#b5cce0;font-weight:bold;",
    );
  },

  update(delta) {
    if (!this._root) return;
    this._elapsed += delta;

    // Locate the player (avatar root or, fallback, the camera).
    // Used by the "95 % transparent when over the player tile" rule.
    const avatar = typeof window !== "undefined" ? window.__sanctuaryAvatar : null;
    const px = avatar?.position?.x ?? 0;
    const pz = avatar?.position?.z ?? 0;
    const FADE_RADIUS = 8;         // metres — XZ planar distance for full fade
    const FADE_BLEND_K = 1 - Math.pow(0.02, delta); // smoother

    // Clouds drift. Wrap around when they leave the field.
    const wrap = CLOUD_FIELD_RADIUS + 12;
    for (const cloud of this._clouds) {
      cloud.position.x += cloud.userData.driftX * delta;
      cloud.position.z += cloud.userData.driftZ * delta;
      if (cloud.position.x > wrap) cloud.position.x = -wrap;
      if (cloud.position.x < -wrap) cloud.position.x = wrap;
      if (cloud.position.z > wrap) cloud.position.z = -wrap;
      if (cloud.position.z < -wrap) cloud.position.z = wrap;

      // Player-over-tile transparency. When a cloud's XZ position
      // is within FADE_RADIUS of the player, target opacity drops to
      // 5 % so the kid can see the sky (and the world below) instead
      // of staring at a wall of cumulus. Outside the radius, opacity
      // eases back to its per-cloud baseline.
      const ud = cloud.userData;
      const dx = cloud.position.x - px;
      const dz = cloud.position.z - pz;
      const planar = Math.hypot(dx, dz);
      let target = ud.baseOpacity;
      if (planar < FADE_RADIUS) {
        const t = planar / FADE_RADIUS;                  // 0 = over player, 1 = edge of fade
        target = 0.05 + (ud.baseOpacity - 0.05) * t * t; // smooth fade, 95% transparent at centre
      }
      ud.currentOpacity += (target - ud.currentOpacity) * FADE_BLEND_K;
      ud.cloudMat.opacity = ud.currentOpacity;
    }

    // Birds wheel on circular orbits with a gentle Y bob.
    for (const bird of this._birds) {
      const u = bird.userData;
      const a = u.phase + this._elapsed * u.angularSpeed;
      bird.position.x = Math.cos(a) * u.orbitR;
      bird.position.z = Math.sin(a) * u.orbitR;
      bird.position.y = u.orbitY + Math.sin(this._elapsed * 0.7 + u.phase) * u.bobAmp;
    }
  },

  unload(scene) {
    if (!this._root) return;
    scene.remove(this._root);
    this._root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
    });
    this._root = null;
    this._clouds = [];
    this._birds = [];
    this._scene = null;
  },
};
