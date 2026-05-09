/**
 * Sacred Adventures v2 — World Module (Phase 1)
 *
 * This is the absolute minimum 3D world:
 *   - Procedural terrain (noise-based Great Plains rolling hills)
 *   - Sky gradient (atmospheric hemisphere light)
 *   - Directional sun with shadows
 *   - Ambient ground fog
 *   - Grass ground plane with vertex colour variation
 *   - WASD + mouse-look player movement (no physics, pure camera)
 *
 * Target: SOLID 60 FPS with nothing else loaded.
 * All other systems build ON TOP of this verified baseline.
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// NOISE UTILITY (inline simplex-style — no external dep)
// ─────────────────────────────────────────────────────────────────────────────
function hash(n) {
  return (Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
}
function smoothNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash(ix     + iz     * 57);
  const b = hash(ix + 1 + iz     * 57);
  const c = hash(ix     + (iz+1) * 57);
  const d = hash(ix + 1 + (iz+1) * 57);
  return a + (b-a)*ux + (c-a)*uz + (d-a+a-b-c+b)*ux*uz;
}
function terrainY(x, z) {
  let y = 0;
  y += smoothNoise(x * 0.04,  z * 0.04)  * 4.0;   // large rolling hills
  y += smoothNoise(x * 0.12,  z * 0.12)  * 1.2;   // mid undulation
  y += smoothNoise(x * 0.35,  z * 0.35)  * 0.3;   // surface texture
  // Flatten center clearing (spawn zone)
  const d = Math.sqrt(x*x + z*z);
  if (d < 12) y *= (d / 12);
  return y;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORLD MODULE
// ─────────────────────────────────────────────────────────────────────────────
export const WorldModule = {
  name: 'World',

  // Internal refs — cleaned up on unload
  _objects: [],
  _keys: {},
  _yaw: 0,
  _pitch: 0,
  _pointerLocked: false,
  _camera: null,
  _onKey:  null,
  _onMouse: null,
  _onPointerLock: null,
  _canvas: null,
  _clickHandler: null,

  // ──────────────────────────────────────────────────────────────────────────
  load(scene, camera) {
    this._camera = camera;
    this._canvas = document.querySelector('canvas');

    // ── Sky colour / hemisphere light ────────────────────────────────────
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0xc8dff0, 0.012);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.9);
    scene.add(hemi);
    this._objects.push(hemi);

    // Gradient sky dome (cheap — just a sphere with vertex colour)
    const skyGeo = new THREE.SphereGeometry(800, 16, 8);
    const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    skyMat.color.setHex(0x7ec8e3);
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyMesh);
    this._objects.push(skyMesh);

    // ── Sun / directional light ───────────────────────────────────────────
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.4);
    sun.position.set(80, 120, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far  = 400;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -120;
    sun.shadow.camera.right = sun.shadow.camera.top   =  120;
    sun.shadow.bias = -0.001;
    scene.add(sun);
    this._objects.push(sun);

    // Subtle fill from opposite side
    const fill = new THREE.DirectionalLight(0xb0d4ff, 0.25);
    fill.position.set(-60, 40, -80);
    scene.add(fill);
    this._objects.push(fill);

    // ── Terrain ───────────────────────────────────────────────────────────
    const GRID = 128, SIZE = 200;
    const geo  = new THREE.PlaneGeometry(SIZE, SIZE, GRID, GRID);
    geo.rotateX(-Math.PI / 2);

    const pos    = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col    = new THREE.Color();

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = terrainY(x, z);
      pos.setY(i, y);

      // Vertex colour — subtle grass variation
      const t = Math.random() * 0.08;
      col.setRGB(0.27 + t, 0.48 + t * 0.5, 0.18 + t * 0.3);
      colors[i*3]   = col.r;
      colors[i*3+1] = col.g;
      colors[i*3+2] = col.b;
    }
    pos.needsUpdate = true;
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
    });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    terrain.name = 'terrain';
    scene.add(terrain);
    this._objects.push(terrain);

    // Cache terrain Y for player grounding
    this._terrainGeo = geo;

    // ── Ground horizon ring (hides terrain edge pop) ──────────────────────
    const ringGeo = new THREE.CylinderGeometry(198, 198, 8, 48, 1, true);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x6fa858, side: THREE.BackSide });
    const ring    = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = -2;
    scene.add(ring);
    this._objects.push(ring);

    // ── Player start position ─────────────────────────────────────────────
    camera.position.set(0, terrainY(0, 0) + 1.7, 5);

    // ── Input ─────────────────────────────────────────────────────────────
    this._setupInput(camera);

    console.log('%c[World] ✅ Phase 1 world loaded — terrain, sky, sun, fog', 'color:#a5d6a7;');
    console.log('[World] WASD to move, mouse-click canvas to lock pointer, ESC to release.');
  },

  // ──────────────────────────────────────────────────────────────────────────
  update(delta, frameCount, scene, camera) {
    const speed = 6.0;
    const k = this._keys;

    // Build movement vector from keyboard
    const dir = new THREE.Vector3();
    if (k['w'] || k['arrowup'])    dir.z -= 1;
    if (k['s'] || k['arrowdown'])  dir.z += 1;
    if (k['a'] || k['arrowleft'])  dir.x -= 1;
    if (k['d'] || k['arrowright']) dir.x += 1;

    if (dir.lengthSq() > 0) {
      dir.normalize().applyEuler(new THREE.Euler(0, this._yaw, 0));
      camera.position.addScaledVector(dir, speed * delta);
    }

    // Clamp to terrain + player height
    const px = camera.position.x, pz = camera.position.z;
    const groundY = terrainY(px, pz);
    camera.position.y = groundY + 1.7;

    // Apply yaw + pitch
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this._yaw;
    camera.rotation.x = this._pitch;
  },

  // ──────────────────────────────────────────────────────────────────────────
  unload(scene) {
    for (const obj of this._objects) scene.remove(obj);
    this._objects = [];

    if (this._onKey)         { window.removeEventListener('keydown', this._onKey);   window.removeEventListener('keyup', this._onKey); }
    if (this._onMouse)       document.removeEventListener('mousemove', this._onMouse);
    if (this._clickHandler)  this._canvas && this._canvas.removeEventListener('click', this._clickHandler);

    document.exitPointerLock && document.exitPointerLock();
    console.log('[World] ⏹ World unloaded.');
  },

  // ──────────────────────────────────────────────────────────────────────────
  _setupInput(camera) {
    this._keys = {};

    this._onKey = (e) => {
      const k = e.key.toLowerCase();
      this._keys[k] = (e.type === 'keydown');
    };
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup',   this._onKey);

    this._onMouse = (e) => {
      if (!this._pointerLocked) return;
      this._yaw   -= e.movementX * 0.002;
      this._pitch -= e.movementY * 0.002;
      this._pitch  = Math.max(-Math.PI/3, Math.min(Math.PI/3, this._pitch));
    };
    document.addEventListener('mousemove', this._onMouse);

    this._clickHandler = () => {
      if (!this._pointerLocked && this._canvas) {
        this._canvas.requestPointerLock();
      }
    };
    this._canvas && this._canvas.addEventListener('click', this._clickHandler);

    document.addEventListener('pointerlockchange', () => {
      this._pointerLocked = document.pointerLockElement === this._canvas;
    });
  },
};
