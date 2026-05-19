/**
 * Sacred Adventures — sanctuary part 30 of N: TIPI BRAZIERS.
 *
 * Anu domain: STRUCTURES (the stone bowl) + ENVIRONMENT (fire +
 * smoke). One brazier sits in front of each tipi.
 *
 * **Perf rewrite (May-18 2026):**
 *   • Smoke is now ONE `THREE.Points` cloud per brazier instead of
 *     28 individual sprites. Drops 28 draw calls per brazier (so 56
 *     across both). Visual identical — Points + a soft canvas alpha
 *     mask reads as smoke at the camera distance kids will see it.
 *   • The PointLight is **night-only**. During the day the brazier's
 *     additive fire sprites are bright enough to read as fire; the
 *     extra dynamic light just made every PBR material in range pay
 *     the lighting cost for nothing. At night the light flicks on +
 *     drives a warm flicker on the surrounding terrain.
 *   • Materials shared across both braziers — one fire sprite map,
 *     one core map, one smoke points map, one bowl/stem stone.
 *
 * Listens to `anu:season-change` to flip the night light + intensity.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import { sanctuaryGroundY } from "./SanctuaryGround.js";

const BOWL_RADIUS_TOP_M = 0.32;
const BOWL_RADIUS_BOT_M = 0.22;
const BOWL_HEIGHT_M = 0.34;
const BOWL_STAND_HEIGHT_M = 0.55;
const FIRE_SPRITE_HEIGHT_M = 0.80;

const SMOKE_PARTICLE_COUNT = 28;
const SMOKE_RISE_M_PER_S = 0.55;
const SMOKE_LIFETIME_S = 4.0;
const SMOKE_DRIFT_M_PER_S = 0.20;
const SMOKE_BASE_SIZE = 0.45;

// ── Shared materials (built once on first call) ────────────────────
let _stoneMat = null;
function stoneMaterial() {
  if (_stoneMat) return _stoneMat;
  _stoneMat = new THREE.MeshStandardMaterial({
    color: 0x5a4a3c,
    roughness: 0.95,
    metalness: 0.05,
  });
  return _stoneMat;
}

let _charMat = null;
function charMaterial() {
  if (_charMat) return _charMat;
  _charMat = new THREE.MeshBasicMaterial({ color: 0x1a0e08 });
  return _charMat;
}

function _makeRadialTexture(innerHex, outerHex, falloff = 0.45) {
  const size = 64; // dropped 128 → 64; sprites + points are tiny on screen
  const cnv = document.createElement("canvas");
  cnv.width = cnv.height = size;
  const ctx = cnv.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
  const ihex = `#${innerHex.toString(16).padStart(6, "0")}`;
  const ohex = `#${outerHex.toString(16).padStart(6, "0")}`;
  grad.addColorStop(0, ihex);
  grad.addColorStop(falloff, ihex);
  grad.addColorStop(1, ohex + "00");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let _fireMatProto = null;
function fireMaterial() {
  if (_fireMatProto) return _fireMatProto;
  _fireMatProto = new THREE.SpriteMaterial({
    map: _makeRadialTexture(0xfff0a0, 0xff5510),
    color: 0xffe48a,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.95,
  });
  return _fireMatProto;
}

let _coreMatProto = null;
function coreMaterial() {
  if (_coreMatProto) return _coreMatProto;
  _coreMatProto = new THREE.SpriteMaterial({
    map: _makeRadialTexture(0xffffff, 0xffd040),
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.85,
  });
  return _coreMatProto;
}

let _smokeTex = null;
function smokeTexture() {
  if (_smokeTex) return _smokeTex;
  _smokeTex = _makeRadialTexture(0xc0c0c0, 0x707070);
  return _smokeTex;
}

/** Build bowl + stem + char disc using shared materials. */
function _buildBowlMesh() {
  const group = new THREE.Group();
  const stone = stoneMaterial();

  const bowl = new THREE.Mesh(
    new THREE.CylinderGeometry(BOWL_RADIUS_TOP_M, BOWL_RADIUS_BOT_M, BOWL_HEIGHT_M, 14, 1, false),
    stone,
  );
  bowl.position.y = BOWL_STAND_HEIGHT_M - BOWL_HEIGHT_M * 0.5;
  bowl.userData.anuKind = "sanctuary_brazier_bowl";
  bowl.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  group.add(bowl);

  const char = new THREE.Mesh(
    new THREE.CircleGeometry(BOWL_RADIUS_TOP_M * 0.92, 14),
    charMaterial(),
  );
  char.rotation.x = -Math.PI / 2;
  char.position.y = BOWL_STAND_HEIGHT_M - 0.02;
  char.userData.anuKind = "sanctuary_brazier_char";
  char.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  group.add(char);

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(BOWL_RADIUS_BOT_M * 0.85, BOWL_RADIUS_BOT_M * 1.1, BOWL_STAND_HEIGHT_M - BOWL_HEIGHT_M, 10, 1, false),
    stone,
  );
  stem.position.y = (BOWL_STAND_HEIGHT_M - BOWL_HEIGHT_M) * 0.5;
  stem.userData.anuKind = "sanctuary_brazier_stem";
  stem.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  group.add(stem);

  return group;
}

/** Build one brazier — bowl + 2 fire sprites + (lazy) point light + smoke Points. */
function _buildBrazier({ anchor, anuId }) {
  const root = new THREE.Group();
  root.name = anuId;
  root.userData.anuId = anuId;
  root.userData.anuKind = "sanctuary_brazier";
  root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;

  root.add(_buildBowlMesh());

  // Fire sprite — uses a CLONE of the shared material so we can flicker
  // opacity per-brazier without affecting the other one.
  const fire = new THREE.Sprite(fireMaterial().clone());
  fire.scale.set(FIRE_SPRITE_HEIGHT_M * 0.85, FIRE_SPRITE_HEIGHT_M, 1);
  fire.position.y = BOWL_STAND_HEIGHT_M + FIRE_SPRITE_HEIGHT_M * 0.45;
  fire.userData.anuKind = "sanctuary_brazier_fire";
  fire.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  root.add(fire);

  const core = new THREE.Sprite(coreMaterial().clone());
  core.scale.set(FIRE_SPRITE_HEIGHT_M * 0.42, FIRE_SPRITE_HEIGHT_M * 0.48, 1);
  core.position.y = BOWL_STAND_HEIGHT_M + FIRE_SPRITE_HEIGHT_M * 0.32;
  core.userData.anuKind = "sanctuary_brazier_fire_core";
  core.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  root.add(core);

  // ── Smoke as a single Points cloud (was 28 sprites) ─────────────
  const sgeo = new THREE.BufferGeometry();
  const positions = new Float32Array(SMOKE_PARTICLE_COUNT * 3);
  const alphas = new Float32Array(SMOKE_PARTICLE_COUNT);
  const sizes = new Float32Array(SMOKE_PARTICLE_COUNT);
  const smokeStates = [];
  for (let i = 0; i < SMOKE_PARTICLE_COUNT; i++) {
    positions[i * 3 + 0] = 0;
    positions[i * 3 + 1] = BOWL_STAND_HEIGHT_M + 0.1;
    positions[i * 3 + 2] = 0;
    alphas[i] = 0;
    sizes[i] = SMOKE_BASE_SIZE;
    smokeStates.push({
      age: Math.random() * SMOKE_LIFETIME_S,
      driftAngle: Math.random() * Math.PI * 2,
      driftSpeed: SMOKE_DRIFT_M_PER_S * (0.6 + Math.random() * 0.8),
      jitter: 0.05 + Math.random() * 0.07,
    });
  }
  sgeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  sgeo.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
  sgeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

  const smokeMat = new THREE.PointsMaterial({
    map: smokeTexture(),
    color: 0xb8b8b8,
    size: SMOKE_BASE_SIZE,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    opacity: 0.55,
    sizeAttenuation: true,
  });
  const smokePoints = new THREE.Points(sgeo, smokeMat);
  smokePoints.name = "sanctuary_smoke";
  smokePoints.userData.anuKind = "sanctuary_smoke";
  smokePoints.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  smokePoints.frustumCulled = false;
  root.add(smokePoints);

  // ── PointLight — built but OFF by default, turned on at night ───
  const light = new THREE.PointLight(0xffb060, 0.0, 6.0, 1.6);
  light.position.y = BOWL_STAND_HEIGHT_M + 0.30;
  light.userData.anuKind = "sanctuary_brazier_light";
  light.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
  light.visible = false;
  root.add(light);

  // Anchor.
  const groundY = sanctuaryGroundY(anchor.x, anchor.z);
  root.position.set(anchor.x, groundY, anchor.z);

  return {
    root,
    fire,
    core,
    light,
    smokePoints,
    smokeGeo: sgeo,
    smokePositions: positions,
    smokeStates,
  };
}

export const SanctuaryBraziersModule = {
  name: "SanctuaryBraziers",

  _scene: null,
  _braziers: [],
  _clock: 0,
  _isNight: false,

  async load(scene) {
    this._scene = scene;
    const tipi1 = window.__sanctuaryTipi1Anchor ?? { x: 18, z: -2 };
    const tipi2 = window.__sanctuaryTipi2Anchor ?? { x: 28.85, z: -2 };

    const placements = [
      { anchor: { x: tipi1.x - 0.4, z: tipi1.z + 2.1 }, anuId: "structures.sanctuary.brazier_tipi1" },
      { anchor: { x: tipi2.x - 0.4, z: tipi2.z + 2.1 }, anuId: "structures.sanctuary.brazier_tipi2" },
    ];

    for (const p of placements) {
      const b = _buildBrazier(p);
      scene.add(b.root);
      this._braziers.push(b);
    }

    // Day/night switch — light is off during the day, on at night.
    window.addEventListener("anu:season-change", (e) => {
      const next = e.detail?.next ?? e.detail?.season;
      this._isNight = String(next).toLowerCase().includes("night");
      for (const b of this._braziers) {
        b.light.visible = this._isNight;
      }
    });

    console.log(
      "%c[Sanctuary] 🔥 Braziers lit (×%d) — lights night-only, smoke is one Points cloud per brazier.",
      "color:#ff8a3d;font-weight:bold;",
      this._braziers.length,
    );
  },

  update(delta) {
    this._clock += delta;
    const t = this._clock;

    for (const b of this._braziers) {
      // Flicker — drives the fire sprite opacity always, but the
      // point-light intensity only when active.
      const flick =
        0.85 +
        0.10 * Math.sin(t * 12.0) +
        0.06 * Math.sin(t * 27.0) +
        (Math.random() - 0.5) * 0.04;

      // Fire scale + opacity (day + night).
      const sx = 0.85 + 0.05 * Math.sin(t * 7.5);
      const sy = 1.0 + 0.08 * Math.sin(t * 5.3 + 0.7);
      b.fire.scale.set(FIRE_SPRITE_HEIGHT_M * sx, FIRE_SPRITE_HEIGHT_M * sy, 1);
      b.fire.material.opacity = 0.85 + 0.10 * Math.sin(t * 11.0);
      b.core.material.opacity = 0.75 + 0.18 * Math.sin(t * 17.0 + 1.2);

      // Night-only light flicker.
      if (b.light.visible) {
        b.light.intensity = 2.2 * flick;
      }

      // Smoke — advance state, write to the Points position buffer.
      const positions = b.smokePositions;
      for (let i = 0; i < b.smokeStates.length; i++) {
        const ps = b.smokeStates[i];
        ps.age += delta;
        if (ps.age >= SMOKE_LIFETIME_S) {
          ps.age -= SMOKE_LIFETIME_S;
          ps.driftAngle = Math.random() * Math.PI * 2;
          ps.driftSpeed = SMOKE_DRIFT_M_PER_S * (0.6 + Math.random() * 0.8);
          ps.jitter = 0.05 + Math.random() * 0.07;
        }
        const a = ps.age / SMOKE_LIFETIME_S;
        const yLift = Math.sqrt(a) * SMOKE_RISE_M_PER_S * SMOKE_LIFETIME_S;
        const r = a * 0.85;
        const wobble = Math.sin(t * 1.5 + ps.driftAngle * 3.0) * ps.jitter;
        positions[i * 3 + 0] = Math.cos(ps.driftAngle) * r + wobble;
        positions[i * 3 + 1] = BOWL_STAND_HEIGHT_M + 0.10 + yLift;
        positions[i * 3 + 2] = Math.sin(ps.driftAngle) * r;
      }
      b.smokeGeo.attributes.position.needsUpdate = true;
    }
  },

  unload(scene) {
    for (const b of this._braziers) {
      scene.remove(b.root);
      b.root.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
      });
    }
    this._braziers = [];
    this._scene = null;
  },
};
