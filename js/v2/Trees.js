/**
 * Sacred Adventures v2 — Trees from Assets/tree.glb
 *
 * Instanced placement on terrain (requires World + WorldPhysics).
 * Geometry: merged mesh(es) from GLB → InstancedMesh for low draw calls.
 */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const TREE_URL = "./Assets/tree.glb";

const TREE_TARGET = 140;
const PLACE_TRIES = TREE_TARGET * 14;
const CLEAR_R = 18;
const WORLD_EDGE = 102;

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function maxSlope(getY, x, z) {
  const c = getY(x, z);
  const s = 0.85;
  const samples = [
    getY(x - s, z),
    getY(x + s, z),
    getY(x, z - s),
    getY(x, z + s),
  ];
  let lo = c,
    hi = c;
  for (const h of samples) {
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  return hi - lo;
}

function mergeTemplateFromGltf(root) {
  root.updateMatrixWorld(true);
  const geoms = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry) {
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      geoms.push(g);
    }
  });
  if (geoms.length === 0) return null;
  if (geoms.length === 1) return geoms[0];
  try {
    return mergeGeometries(geoms, false);
  } catch (_e) {
    return geoms[0];
  }
}

function firstMeshMaterial(root) {
  let mat = null;
  root.traverse((o) => {
    if (o.isMesh && o.material && !mat)
      mat = Array.isArray(o.material) ? o.material[0] : o.material;
  });
  return mat;
}

export const TreesModule = {
  name: "Trees",

  _objects: [],
  _dummy: new THREE.Object3D(),
  _mesh: null,
  _windTime: 0,
  /** Per-instance layout + sway (typed arrays sized TREE_TARGET; only [0..count) used) */
  _tx: null,
  _ty: null,
  _tz: null,
  _tsc: null,
  _tbaseRy: null,
  _tphase: null,

  async load(scene) {
    const getY =
      window.WorldPhysics && typeof window.WorldPhysics.getGroundY === "function"
        ? window.WorldPhysics.getGroundY.bind(window.WorldPhysics)
        : null;

    if (!getY) {
      console.error(
        "[Trees] WorldPhysics.getGroundY missing — activate World before Trees.",
      );
      return;
    }

    const gltf = await new GLTFLoader().loadAsync(TREE_URL);
    let geom = mergeTemplateFromGltf(gltf.scene);
    if (!geom) {
      console.error("[Trees] tree.glb had no mesh geometry.");
      return;
    }

    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);
    const scaleFix = size.y > 0 ? 11 / size.y : 1;
    geom.scale(scaleFix, scaleFix, scaleFix);
    geom.computeBoundingBox();

    const srcMat = firstMeshMaterial(gltf.scene);
    const mat = srcMat
      ? srcMat.clone()
      : new THREE.MeshStandardMaterial({
          color: 0x3a5f2d,
          roughness: 0.9,
          metalness: 0,
        });

    const mesh = new THREE.InstancedMesh(geom, mat, TREE_TARGET);
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    this._tx = new Float32Array(TREE_TARGET);
    this._ty = new Float32Array(TREE_TARGET);
    this._tz = new Float32Array(TREE_TARGET);
    this._tsc = new Float32Array(TREE_TARGET);
    this._tbaseRy = new Float32Array(TREE_TARGET);
    this._tphase = new Float32Array(TREE_TARGET);

    const rand = mulberry32(0x73524301);
    const dummy = this._dummy;
    let placed = 0;

    for (let attempt = 0; attempt < PLACE_TRIES && placed < TREE_TARGET; attempt++) {
      const x = (rand() - 0.5) * 2 * WORLD_EDGE;
      const z = (rand() - 0.5) * 2 * WORLD_EDGE;
      const dist = Math.sqrt(x * x + z * z);
      if (dist < CLEAR_R || dist > WORLD_EDGE - 6) continue;
      if (maxSlope(getY, x, z) > 2.8) continue;

      const y = getY(x, z);
      const s = (0.72 + rand() * 0.38) * 0.92;
      const ry = rand() * Math.PI * 2;

      this._tx[placed] = x;
      this._ty[placed] = y;
      this._tz[placed] = z;
      this._tsc[placed] = s;
      this._tbaseRy[placed] = ry;
      this._tphase[placed] = rand() * Math.PI * 2;

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }

    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;

    scene.add(mesh);
    this._objects.push(mesh);
    this._mesh = mesh;

    console.log(
      `%c[Trees] ✅ ${placed} × Assets/tree.glb (instanced)`,
      "color:#81c784;font-weight:bold;",
    );
  },

  update(delta) {
    const mesh = this._mesh;
    if (!mesh || !this._tx) return;

    this._windTime += delta;
    const t = this._windTime;
    const dummy = this._dummy;
    const n = mesh.count;
    const ampX = 0.048;
    const ampZ = 0.041;
    const twist = 0.026;

    for (let i = 0; i < n; i++) {
      const ph = this._tphase[i];
      const rx =
        Math.sin(t * 2.15 + ph) * ampX +
        Math.sin(t * 3.05 + ph * 2.1) * (ampX * 0.38);
      const rz =
        Math.cos(t * 1.92 + ph * 1.27) * ampZ +
        Math.cos(t * 2.65 + ph) * (ampZ * 0.33);
      const ry =
        this._tbaseRy[i] + Math.sin(t * 1.38 + ph) * twist;

      dummy.position.set(this._tx[i], this._ty[i], this._tz[i]);
      dummy.rotation.set(rx, ry, rz);
      dummy.scale.set(this._tsc[i], this._tsc[i], this._tsc[i]);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  },

  unload(scene) {
    for (const obj of this._objects) {
      scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose && x.dispose());
      else if (m && m.dispose) m.dispose();
    }
    this._objects = [];
    this._mesh = null;
    this._tx = this._ty = this._tz = this._tsc = this._tbaseRy = this._tphase = null;
    this._windTime = 0;
    console.log("[Trees] ⏹ Unloaded.");
  },
};
