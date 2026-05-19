/**
 * Sacred Adventures v2 — high-altitude sky flock (Reynolds-style boids, instanced mesh).
 *
 * One draw call: procedural low-poly goose silhouettes → `InstancedMesh`.
 * Starts in a readable V-formation in front of the launch camera, then blends
 * into separation / alignment / cohesion + soft follow of a player-tracked
 * anchor. The aim is a beautiful “geese crossing the sky” read on game load,
 * not strict biological simulation.
 *
 * Anchor + instanced mesh use `decor_sky_flock_*` kinds so they are not misread as
 * ground-level `fauna_bird` threats (Fauna mover scan matches prefix `fauna_bird`).
 */

import * as THREE from "three";
import { getRuntimeService } from "./RuntimeServices.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import { terrainY } from "./WorldTerrain.js";

const FLOCK_COUNT = 29;
const BIRD_TARGET_SPAN_M = 1.55;
const ANCHOR_FOLLOW_RATE = 0.022;
const INTRO_FORMATION_S = 13;
const INTRO_VISIBLE_DISTANCE_M = 72;
const INTRO_VISIBLE_LIFT_M = 17;
const INTRO_MIGRATION_SPEED_MPS = 4.8;
const FORMATION_SIDE_STEP_M = 4.15;
const FORMATION_BACK_STEP_M = 3.35;
const FORMATION_VERTICAL_STEP_M = 0.18;

const SKY_ALT_MIN_M = 44;
const SKY_ALT_MAX_M = 58;
const SKY_ALT_WAVE_AMP_M = 5;
const SKY_ALT_WAVE_HZ = 0.07;

const BOID_SEP_DIST = 9.5;
const BOID_SEP_WEIGHT = 1.35;
const BOID_ALIGN_DIST = 16;
const BOID_ALIGN_WEIGHT = 0.42;
const BOID_COH_DIST = 20;
const BOID_COH_WEIGHT = 0.32;
const BOID_COH_STEER_MUL = 0.045;
const BOID_MAX_SPEED = 11;
const BOID_MAX_ACCEL = 3.4;
const BOID_WANDER_WEIGHT = 0.55;

const ANCHOR_PULL_START_M = 38;
const ANCHOR_PULL_WEIGHT = 0.22;

const _dummy = new THREE.Object3D();
const _introForward = new THREE.Vector3();
const _introRight = new THREE.Vector3();
const _introUp = new THREE.Vector3(0, 1, 0);
const _introOrigin = new THREE.Vector3();

function clampVecHoriz(vx, vz, maxH) {
  const h = Math.hypot(vx, vz);
  if (h <= maxH || h < 1e-6) return { vx, vz };
  const s = maxH / h;
  return { vx: vx * s, vz: vz * s };
}

function pushTri(out, a, b, c) {
  out.push(...a, ...b, ...c);
}

function buildPolygonGooseGeometry() {
  const verts = [];
  const y = 0;
  const nose = [0, y, -0.78];
  const headL = [-0.09, y, -0.58];
  const headR = [0.09, y, -0.58];
  const chestL = [-0.22, y, -0.25];
  const chestR = [0.22, y, -0.25];
  const tail = [0, y, 0.52];
  const tailL = [-0.16, y, 0.3];
  const tailR = [0.16, y, 0.3];
  const leftWingTip = [-0.88, y, -0.02];
  const leftWingBack = [-0.34, y, 0.18];
  const rightWingTip = [0.88, y, -0.02];
  const rightWingBack = [0.34, y, 0.18];

  pushTri(verts, nose, headL, headR);
  pushTri(verts, headL, chestL, chestR);
  pushTri(verts, headL, chestR, headR);
  pushTri(verts, chestL, tailL, tail);
  pushTri(verts, chestL, tail, chestR);
  pushTri(verts, chestR, tail, tailR);
  pushTri(verts, chestL, leftWingTip, leftWingBack);
  pushTri(verts, chestL, leftWingBack, tailL);
  pushTri(verts, chestR, rightWingBack, rightWingTip);
  pushTri(verts, chestR, tailR, rightWingBack);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  return geom;
}

function formationSlot(i) {
  if (i === 0) return { side: 0, rank: 0 };
  const rank = Math.ceil(i / 2);
  const side = i % 2 === 1 ? -1 : 1;
  return { side, rank };
}

export const WorldSkyFlockModule = {
  name: "WorldSkyFlock",

  _scene: null,
  _disposed: false,
  _mesh: null,
  _threatAnchor: null,
  _px: null,
  _py: null,
  _pz: null,
  _vx: null,
  _vy: null,
  _vz: null,
  _phase: null,
  _slotSide: null,
  _slotRank: null,
  _anchorX: 0,
  _anchorZ: 0,
  _anchorY: 50,
  _introX: 0,
  _introY: 50,
  _introZ: 0,
  _introDirX: 0,
  _introDirZ: 1,
  _introRightX: 1,
  _introRightZ: 0,
  _windA: 0,
  _time: 0,
  _birdScale: 1,
  _bootLogged: false,

  async load(scene, camera, _renderer, _orc) {
    if (this._disposed) return;
    this._scene = scene;

    this._px = new Float32Array(FLOCK_COUNT);
    this._py = new Float32Array(FLOCK_COUNT);
    this._pz = new Float32Array(FLOCK_COUNT);
    this._vx = new Float32Array(FLOCK_COUNT);
    this._vy = new Float32Array(FLOCK_COUNT);
    this._vz = new Float32Array(FLOCK_COUNT);
    this._phase = new Float32Array(FLOCK_COUNT);
    this._slotSide = new Float32Array(FLOCK_COUNT);
    this._slotRank = new Float32Array(FLOCK_COUNT);

    this._threatAnchor = new THREE.Object3D();
    this._threatAnchor.name = "fauna_sky_flock_cog";
    this._threatAnchor.userData.anuKind = "decor_sky_flock_anchor";
    this._threatAnchor.userData.anuId = "fauna.sky_flock.centre";
    this._threatAnchor.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    scene.add(this._threatAnchor);

    const geometry = buildPolygonGooseGeometry();
    const mat = new THREE.MeshLambertMaterial({
      color: 0x2d2f38,
      emissive: 0x1b1c24,
      emissiveIntensity: 0.28,
      side: THREE.DoubleSide,
    });
    this._birdScale = BIRD_TARGET_SPAN_M;

    this._mesh = new THREE.InstancedMesh(geometry, mat, FLOCK_COUNT);
    this._mesh.name = "fauna_sky_flock_instanced";
    this._mesh.userData.anuId = "fauna.sky_flock.instanced";
    this._mesh.userData.anuKind = "decor_sky_flock_instanced";
    this._mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.count = FLOCK_COUNT;
    this._mesh.frustumCulled = false;
    scene.add(this._mesh);

    const player = getRuntimeService("WorldPlayer");
    const fx = player?.feet?.x ?? 0;
    const fz = player?.feet?.z ?? -32;
    const gY = terrainY(fx, fz);
    if (camera) {
      camera.getWorldDirection(_introForward);
      _introForward.y = 0;
      if (_introForward.lengthSq() < 1e-6) _introForward.set(0, 0, 1);
      _introForward.normalize();
      _introRight.crossVectors(_introForward, _introUp).normalize();
      _introOrigin
        .copy(camera.position)
        .addScaledVector(_introForward, INTRO_VISIBLE_DISTANCE_M)
        .addScaledVector(_introUp, INTRO_VISIBLE_LIFT_M);
    } else {
      _introForward.set(0, 0, 1);
      _introRight.set(1, 0, 0);
      _introOrigin.set(fx, gY + 34, fz + INTRO_VISIBLE_DISTANCE_M);
    }
    const skyFloor = gY + SKY_ALT_MIN_M;
    if (_introOrigin.y < skyFloor) _introOrigin.y = skyFloor;

    this._introX = _introOrigin.x;
    this._introY = _introOrigin.y;
    this._introZ = _introOrigin.z;
    this._introDirX = _introForward.x;
    this._introDirZ = _introForward.z;
    this._introRightX = _introRight.x;
    this._introRightZ = _introRight.z;
    this._anchorX = this._introX;
    this._anchorZ = this._introZ;
    this._anchorY = this._introY;
    this._windA = Math.atan2(this._introDirZ, this._introDirX);

    for (let i = 0; i < FLOCK_COUNT; i++) {
      const slot = formationSlot(i);
      this._slotSide[i] = slot.side;
      this._slotRank[i] = slot.rank;
      const side = slot.side;
      const rank = slot.rank;
      const lateral = side * rank * FORMATION_SIDE_STEP_M;
      const back = rank * FORMATION_BACK_STEP_M;
      const jitter = i === 0 ? 0 : (Math.random() - 0.5) * 0.75;
      this._px[i] =
        this._introX +
        this._introRightX * (lateral + jitter) -
        this._introDirX * back;
      this._pz[i] =
        this._introZ +
        this._introRightZ * (lateral + jitter) -
        this._introDirZ * back;
      this._py[i] =
        this._introY +
        Math.sin(rank * 0.72 + side) * 0.7 -
        rank * FORMATION_VERTICAL_STEP_M;
      this._vx[i] = this._introDirX * INTRO_MIGRATION_SPEED_MPS;
      this._vy[i] = 0;
      this._vz[i] = this._introDirZ * INTRO_MIGRATION_SPEED_MPS;
      this._phase[i] = Math.random() * Math.PI * 2;
    }

    if (!this._bootLogged) {
      console.log(
        "%c[WorldSkyFlock] High-altitude boid flock",
        "color:#90caf9;font-weight:bold;",
        `— ${FLOCK_COUNT} polygon geese, visible V-flight intro + Reynolds rules.`,
      );
      this._bootLogged = true;
    }
  },

  unload(scene) {
    this._disposed = true;
    if (this._mesh && scene) {
      scene.remove(this._mesh);
      this._mesh.geometry?.dispose?.();
      const m = this._mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
      else m?.dispose?.();
    }
    this._mesh = null;
    if (this._threatAnchor && scene) {
      scene.remove(this._threatAnchor);
    }
    this._threatAnchor = null;
    this._scene = null;
  },

  update(delta) {
    if (this._disposed || !this._mesh) return;
    const dt = Math.min(0.05, delta);
    const t = (this._time += dt);

    const player = getRuntimeService("WorldPlayer");
    const pxf = player?.feet?.x ?? this._anchorX;
    const pzf = player?.feet?.z ?? this._anchorZ;
    const gPlayer = terrainY(pxf, pzf);
    const introK = THREE.MathUtils.clamp(t / INTRO_FORMATION_S, 0, 1);
    const introHold = 1 - THREE.MathUtils.smoothstep(introK, 0.55, 1);
    const introCx = this._introX + this._introDirX * INTRO_MIGRATION_SPEED_MPS * t;
    const introCz = this._introZ + this._introDirZ * INTRO_MIGRATION_SPEED_MPS * t;
    const introCy =
      this._introY +
      Math.sin(t * (Math.PI * 2 * SKY_ALT_WAVE_HZ)) * (SKY_ALT_WAVE_AMP_M * 0.35);
    const skyYTarget =
      gPlayer +
      0.5 * (SKY_ALT_MIN_M + SKY_ALT_MAX_M) +
      Math.sin(t * (Math.PI * 2 * SKY_ALT_WAVE_HZ)) * SKY_ALT_WAVE_AMP_M;
    const followX = pxf;
    const followZ = pzf;
    const targetAnchorX = THREE.MathUtils.lerp(followX, introCx, introHold);
    const targetAnchorZ = THREE.MathUtils.lerp(followZ, introCz, introHold);
    const targetAnchorY = THREE.MathUtils.lerp(skyYTarget, introCy, introHold);

    this._anchorX += (targetAnchorX - this._anchorX) * (1 - Math.exp(-ANCHOR_FOLLOW_RATE * dt * 60));
    this._anchorZ += (targetAnchorZ - this._anchorZ) * (1 - Math.exp(-ANCHOR_FOLLOW_RATE * dt * 60));
    this._anchorY += (targetAnchorY - this._anchorY) * (1 - Math.exp(-0.045 * dt * 60));

    this._windA += dt * (0.1 + 0.08 * Math.sin(t * 0.23));
    const wx = Math.cos(this._windA) * 0.55;
    const wz = Math.sin(this._windA) * 0.55;

    const px = this._px;
    const py = this._py;
    const pz = this._pz;
    const vx = this._vx;
    const vy = this._vy;
    const vz = this._vz;

    const ax = this._anchorX;
    const ay = this._anchorY;
    const az = this._anchorZ;

    if (this._threatAnchor) {
      this._threatAnchor.position.set(ax, ay, az);
      this._threatAnchor.updateMatrixWorld(true);
    }

    for (let i = 0; i < FLOCK_COUNT; i++) {
      let sx = 0;
      let sz = 0;
      let sy = 0;
      let avx = 0;
      let avz = 0;
      let avy = 0;
      let cx = 0;
      let cz = 0;
      let cy = 0;
      let nSep = 0;
      let nAli = 0;
      let nCoh = 0;

      for (let j = 0; j < FLOCK_COUNT; j++) {
        if (j === i) continue;
        const dx = px[i] - px[j];
        const dy = py[i] - py[j];
        const dz = pz[i] - pz[j];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < 1e-4) continue;

        if (d < BOID_SEP_DIST) {
          const push = (BOID_SEP_DIST - d) / (BOID_SEP_DIST * d);
          sx += dx * push;
          sy += dy * push * 0.65;
          sz += dz * push;
          nSep++;
        }
        if (d < BOID_ALIGN_DIST) {
          avx += vx[j];
          avy += vy[j];
          avz += vz[j];
          nAli++;
        }
        if (d < BOID_COH_DIST) {
          cx += px[j];
          cy += py[j];
          cz += pz[j];
          nCoh++;
        }
      }

      let axTot = wx * BOID_WANDER_WEIGHT;
      let ayTot =
        Math.sin(t * 0.31 + this._phase[i]) * 0.14 * BOID_WANDER_WEIGHT;
      let azTot = wz * BOID_WANDER_WEIGHT;

      if (nSep > 0) {
        axTot += (sx / nSep) * BOID_SEP_WEIGHT;
        ayTot += (sy / nSep) * BOID_SEP_WEIGHT;
        azTot += (sz / nSep) * BOID_SEP_WEIGHT;
      }

      if (nAli > 0) {
        const inv = 1 / nAli;
        axTot += (avx * inv - vx[i]) * BOID_ALIGN_WEIGHT;
        ayTot += (avy * inv - vy[i]) * BOID_ALIGN_WEIGHT;
        azTot += (avz * inv - vz[i]) * BOID_ALIGN_WEIGHT;
      }

      if (nCoh > 0) {
        const inv = 1 / nCoh;
        axTot += (cx * inv - px[i]) * BOID_COH_STEER_MUL * BOID_COH_WEIGHT;
        ayTot += (cy * inv - py[i]) * BOID_COH_STEER_MUL * BOID_COH_WEIGHT;
        azTot += (cz * inv - pz[i]) * BOID_COH_STEER_MUL * BOID_COH_WEIGHT;
      }

      const dxA = ax - px[i];
      const dzA = az - pz[i];
      const dh = Math.hypot(dxA, dzA);
      if (dh > ANCHOR_PULL_START_M) {
        const pull = (dh - ANCHOR_PULL_START_M) * ANCHOR_PULL_WEIGHT;
        axTot += (dxA / dh) * pull;
        azTot += (dzA / dh) * pull;
      }
      const dyA = ay - py[i];
      if (Math.abs(dyA) > 14) {
        ayTot += Math.sign(dyA) * 0.85;
      }

      if (introHold > 0.01) {
        const side = this._slotSide[i];
        const rank = this._slotRank[i];
        const lateral = side * rank * FORMATION_SIDE_STEP_M;
        const back = rank * FORMATION_BACK_STEP_M;
        const tx =
          introCx +
          this._introRightX * lateral -
          this._introDirX * back;
        const tz =
          introCz +
          this._introRightZ * lateral -
          this._introDirZ * back;
        const ty =
          introCy +
          Math.sin(t * 1.1 + this._phase[i] + rank * 0.4) * 0.85 -
          rank * FORMATION_VERTICAL_STEP_M;
        axTot += (tx - px[i]) * 0.22 * introHold;
        ayTot += (ty - py[i]) * 0.18 * introHold;
        azTot += (tz - pz[i]) * 0.22 * introHold;
        axTot += (this._introDirX * INTRO_MIGRATION_SPEED_MPS - vx[i]) * 0.42 * introHold;
        azTot += (this._introDirZ * INTRO_MIGRATION_SPEED_MPS - vz[i]) * 0.42 * introHold;
      }

      let nvx = vx[i] + axTot * dt;
      let nvy = vy[i] + ayTot * dt;
      let nvz = vz[i] + azTot * dt;
      const sp = Math.sqrt(nvx * nvx + nvy * nvy + nvz * nvz);
      if (sp > BOID_MAX_SPEED) {
        const q = BOID_MAX_SPEED / sp;
        nvx *= q;
        nvy *= q;
        nvz *= q;
      }
      const acc = Math.sqrt(
        (nvx - vx[i]) ** 2 + (nvy - vy[i]) ** 2 + (nvz - vz[i]) ** 2,
      ) / dt;
      if (acc > BOID_MAX_ACCEL && dt > 1e-6) {
        const q = BOID_MAX_ACCEL / acc;
        nvx = vx[i] + (nvx - vx[i]) * q;
        nvy = vy[i] + (nvy - vy[i]) * q;
        nvz = vz[i] + (nvz - vz[i]) * q;
      }
      const ch = clampVecHoriz(nvx, nvz, BOID_MAX_SPEED * 0.96);
      nvx = ch.vx;
      nvz = ch.vz;
      nvy = THREE.MathUtils.clamp(nvy, -3.8, 3.8);

      vx[i] = nvx;
      vy[i] = nvy;
      vz[i] = nvz;
      px[i] += nvx * dt;
      py[i] += nvy * dt;
      pz[i] += nvz * dt;
    }

    const scaleBase = this._birdScale;
    const mx = this._mesh;
    for (let i = 0; i < FLOCK_COUNT; i++) {
      const vlen = Math.hypot(vx[i], vy[i], vz[i]) || 1;
      _dummy.position.set(px[i], py[i], pz[i]);
      _dummy.lookAt(
        px[i] + vx[i] / vlen,
        py[i] + vy[i] / vlen,
        pz[i] + vz[i] / vlen,
      );
      const flap = Math.sin(t * 7.4 + this._phase[i] + this._slotRank[i] * 0.32);
      const wingSpread = 1 + 0.13 * flap;
      const bodyPulse = 1 + 0.035 * Math.sin(t * 5.2 + this._phase[i]);
      _dummy.rotateZ(flap * 0.08 + this._slotSide[i] * this._slotRank[i] * 0.006 * introHold);
      _dummy.scale.set(
        scaleBase * wingSpread,
        scaleBase * bodyPulse,
        scaleBase * (1 - 0.035 * flap),
      );
      _dummy.updateMatrix();
      mx.setMatrixAt(i, _dummy.matrix);
    }
    mx.instanceMatrix.needsUpdate = true;
  },
};
