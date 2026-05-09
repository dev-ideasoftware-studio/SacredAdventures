/**
 * Sacred Adventures v2 — World Module (Phase 1)
 *
 * Matches the exact AssetFactory terrain formula + neumorphic hex GLSL shader.
 * Target: SOLID 60 FPS baseline.
 *
 * FPS fixes vs original World.js:
 *  - NO per-frame object allocation (no new THREE.Euler / new THREE.Vector3 in update)
 *  - computeVertexNormals() called ONCE at build time, never again
 *  - Movement uses pre-allocated _moveDir vector, mutated in place
 *  - camera.rotation.order set once in load(), not every frame
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// TERRAIN HEIGHT — exact match to AssetFactory.buildGroundChunk terrainY
// ─────────────────────────────────────────────────────────────────────────────
function terrainY(gx, gz) {
  const CLEARING_R = 30;
  const HILL_INNER = 30;
  const HILL_OUTER = 60;
  const HILL_HEIGHT = 4.0;

  let baseNoise =
    Math.sin(gx * 0.08) * Math.cos(gz * 0.1) * 1.5 +
    Math.sin(gx * 0.2 + gz * 0.15) * 0.4;
  let y = baseNoise;
  const dist = Math.sqrt(gx * gx + gz * gz);

  if (dist < CLEARING_R) {
    if (dist < 8) {
      y = 0;
    } else {
      const t = (dist - 8) / (CLEARING_R - 8);
      const flatten = 0.5 + 0.5 * Math.cos(t * Math.PI);
      y = baseNoise * (1.0 - flatten);
    }
  }

  if (dist >= HILL_INNER && dist < HILL_OUTER) {
    const t = (dist - HILL_INNER) / (HILL_OUTER - HILL_INNER);
    const hillShape = Math.sin(t * Math.PI);
    const angle = Math.atan2(gz, gx);
    const noise =
      0.65 + 0.35 * Math.sin(angle * 3 + 0.8) * Math.sin(angle * 5 + 2.1) * 0.3;
    const lobe = 0.7 + 0.3 * Math.sin(angle * 2.3 + 1.2);
    y += HILL_HEIGHT * hillShape * (noise + 0.5) * lobe;
  }

  if (dist > HILL_OUTER) {
    const outerBlend = Math.min(1.0, (dist - HILL_OUTER) / 10);
    const rollingH =
      Math.sin(gx * 0.06 + 1.0) * Math.cos(gz * 0.05 + 0.7) * 2.5 +
      Math.sin(gx * 0.12 + gz * 0.1) * 1.0;
    y += rollingH * outerBlend;
  }

  if (dist > 100) {
    const dropT = Math.min(1.0, (dist - 100) / 20.0);
    y = y * (1.0 - dropT) - Math.pow(dropT, 3.0) * 8.0;
  }

  return y;
}

// ─────────────────────────────────────────────────────────────────────────────
// NEUMORPHIC HEX SHADER — ported directly from AssetFactory onBeforeCompile
// ─────────────────────────────────────────────────────────────────────────────
function applyNeuHexShader(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWorldPos;'
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
       varying vec3 vWorldPos;
       float hexDist(vec2 p) {
         p = abs(p);
         float c = dot(p, normalize(vec2(1.0, 1.73205081)));
         return max(c, p.x);
       }`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
       float hexRadius = 6.27;
       float hr3 = hexRadius * 1.73205081;
       vec2 r = vec2(hr3, hexRadius * 3.0);
       vec2 h = r * 0.5;
       vec2 uv = vWorldPos.xz;
       vec2 a = mod(uv, r) - h;
       vec2 b = mod(uv - h, r) - h;
       vec2 localPos = dot(a,a) < dot(b,b) ? a : b;
       float dist2 = hexDist(localPos);
       float maxDist = hr3 * 0.5;
       float edgeDist = maxDist - dist2;

       // --- LEGO-LEVEL TILE SEPARATION ---
       // Zone 1: Deep black crack at the very edge
       if (edgeDist < 0.28) {
         float crack = smoothstep(0.0, 0.28, edgeDist);
         // Pitch-black trough at edgeDist=0, rising steeply
         diffuseColor.rgb *= (crack * crack * 0.7);
       }
       // Zone 2: Steep dark bevel slope rising from the crack
       else if (edgeDist < 0.65) {
         float slope = smoothstep(0.28, 0.65, edgeDist);
         diffuseColor.rgb *= (slope * 0.45 + 0.35);
       }
       // Zone 3: Bright raised rim — the top "lip" of the lego stud edge
       else if (edgeDist < 0.95) {
         float rim = smoothstep(0.65, 0.95, edgeDist);
         diffuseColor.rgb *= (1.0 + (1.0 - rim) * 0.22);
       }
       // Zone 4: Flat tile interior — very slight inner brightening
       else {
         diffuseColor.rgb *= 1.04;
       }
       // Corner triple-junction: extra deep shadow where 3 tiles meet
       float cornerDist = length(localPos);
       if (cornerDist > hexRadius * 0.65) {
         float cornerDip = smoothstep(hexRadius * 0.65, hexRadius, cornerDist);
         diffuseColor.rgb *= (1.0 - cornerDip * 0.55);
       }`,
    );
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORLD MODULE
// ─────────────────────────────────────────────────────────────────────────────
export const WorldModule = {
  name: "World",

  _objects: [],
  _keys: {},
  _yaw: 0,
  _pitch: 0,
  _camera: null,
  _canvas: null,
  _onKey: null,

  // Pre-allocated vectors — NEVER recreated inside update()
  _moveDir: new THREE.Vector3(),
  _fwd: new THREE.Vector3(),

  // ──────────────────────────────────────────────────────────────────────────
  load(scene, camera) {
    this._camera = camera;
    this._canvas = document.querySelector("canvas");

    // ── Sky ───────────────────────────────────────────────────────────────
    scene.background = new THREE.Color(0xfff1ca); // match original warm sky
    scene.fog = new THREE.FogExp2(0xfff1ca, 0.008);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.85);
    scene.add(hemi);
    this._objects.push(hemi);

    // ── Sun ───────────────────────────────────────────────────────────────
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.3);
    sun.position.set(80, 120, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -120;
    sun.shadow.camera.right = sun.shadow.camera.top = 120;
    sun.shadow.bias = -0.001;
    scene.add(sun);
    this._objects.push(sun);

    const fill = new THREE.DirectionalLight(0xb0d4ff, 0.22);
    fill.position.set(-60, 40, -80);
    scene.add(fill);
    this._objects.push(fill);

    // ── Terrain (matches AssetFactory exactly) ────────────────────────────
    const geo = new THREE.PlaneGeometry(60 * 4, 60 * 4, 128, 128);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const _hCache = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainY(x, z);
      _hCache[i] = h;
      pos.setY(i, h);

      const dist = Math.sqrt(x * x + z * z);
      const sc = z * 0.6 + Math.sin(x * 0.05) * 8 + 15;
      const streamD = Math.abs(x - sc);

      let r = 0.97 + Math.random() * 0.06;
      let g = r,
        b = r;

      if (streamD < 3 && dist > 26) {
        const sb = 0.5 + 0.5 * Math.cos((streamD / 3) * Math.PI);
        r -= sb * 0.15;
        g -= sb * 0.05;
        b += sb * 0.1;
      }
      if (dist >= 16 && dist < 26) {
        const hb = Math.sin(((dist - 8) / 10) * Math.PI);
        r -= hb * 0.08;
        g += hb * 0.05;
        b -= hb * 0.06;
      }
      if (dist < 8) {
        const cb = 0.5 + 0.5 * Math.cos((dist / 8) * Math.PI);
        r = r * (1 - cb) + 0.8 * cb;
        g = g * (1 - cb) + 0.7 * cb;
        b = b * (1 - cb) + 0.48 * cb;
      }
      if (dist > 105) {
        const darkness = Math.min(1.0, (dist - 105) / 15.0);
        const v = 1.0 - darkness;
        r *= v;
        g *= v;
        b *= v;
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    pos.needsUpdate = true;
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals(); // called ONCE here, never in update()

    // Neumorphic hex material (MeshStandard so shader hooks work)
    const groundMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0.0,
    });
    applyNeuHexShader(groundMat);

    const terrain = new THREE.Mesh(geo, groundMat);
    terrain.receiveShadow = true;
    terrain.name = "terrain";
    scene.add(terrain);
    this._objects.push(terrain);

    // ── Ethereal haze overlay (matches AssetFactory) ──────────────────────
    const hazeGeo = new THREE.PlaneGeometry(60 * 4, 60 * 4, 128, 128);
    hazeGeo.rotateX(-Math.PI / 2);
    const hazePos = hazeGeo.attributes.position;
    for (let i = 0; i < hazePos.count; i++) {
      const hx = hazePos.getX(i),
        hz = hazePos.getZ(i);
      let hY = _hCache[i] + 0.15;
      const d2 = Math.sqrt(hx * hx + hz * hz);
      if (d2 < 6) hY -= 0.15;
      else if (d2 < 10) hY -= 0.15 * (1 - (d2 - 6) / 4);
      hazePos.setY(i, hY);
    }
    hazeGeo.computeVertexNormals();
    const hazeMat = new THREE.MeshBasicMaterial({
      color: 0x2d5a1e,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const hazeMesh = new THREE.Mesh(hazeGeo, hazeMat);
    scene.add(hazeMesh);
    this._objects.push(hazeMesh);

    // Expose height cache globally (same interface as AssetFactory)
    window._terrainHeightCache = { data: _hCache, geo, lookup: terrainY };
    this._terrainY = terrainY;

    // ── Horizon ring ──────────────────────────────────────────────────────
    const ringGeo = new THREE.CylinderGeometry(238, 238, 10, 48, 1, true);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x6fa858,
      side: THREE.BackSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = -3;
    scene.add(ring);
    this._objects.push(ring);

    // ── Player start ──────────────────────────────────────────────────────
    camera.position.set(0, terrainY(0, 0) + 1.7, 8);
    camera.rotation.order = "YXZ"; // set ONCE — never reset in update()

    // ── Input ─────────────────────────────────────────────────────────────
    this._setupInput();

    console.log(
      "%c[World] ✅ Phase 1 loaded — terrain + neumorphic hex shader, sky, sun, haze",
      "color:#a5d6a7;font-weight:bold;",
    );
    console.log(
      "[World] WASD = move | Left/Right arrows = turn | Up/Down arrows = move forward/back",
    );
  },

  // ──────────────────────────────────────────────────────────────────────────
  // UPDATE — zero allocations, all vectors pre-built
  // ──────────────────────────────────────────────────────────────────────────
  update(delta, _frameCount, _scene, camera) {
    const k = this._keys;
    const speed = 7.0;
    const turnRate = 1.8; // radians/sec
    const dir = this._moveDir;

    // Arrow left/right = TURN (yaw), not strafe
    if (k["arrowleft"]) this._yaw += turnRate * delta;
    if (k["arrowright"]) this._yaw -= turnRate * delta;

    dir.set(0, 0, 0);
    if (k["w"] || k["arrowup"]) dir.z -= 1;
    if (k["s"] || k["arrowdown"]) dir.z += 1;
    if (k["a"]) dir.x -= 1; // A/D still strafe
    if (k["d"]) dir.x += 1;

    if (dir.lengthSq() > 0) {
      dir.normalize();
      const cos = Math.cos(this._yaw),
        sin = Math.sin(this._yaw);
      const wx = dir.x * cos + dir.z * sin;
      const wz = -dir.x * sin + dir.z * cos;
      camera.position.x += wx * speed * delta;
      camera.position.z += wz * speed * delta;
    }

    // Ground clamping
    camera.position.y =
      this._terrainY(camera.position.x, camera.position.z) + 1.7;

    // Apply look rotation (rotation.order already 'YXZ' from load)
    camera.rotation.y = this._yaw;
    camera.rotation.x = this._pitch;
  },

  // ──────────────────────────────────────────────────────────────────────────
  unload(scene) {
    for (const obj of this._objects) scene.remove(obj);
    this._objects = [];
    if (this._onKey) {
      window.removeEventListener("keydown", this._onKey);
      window.removeEventListener("keyup", this._onKey);
    }
    console.log("[World] ⏹ Unloaded.");
  },

  // ──────────────────────────────────────────────────────────────
  _setupInput() {
    this._keys = {};
    this._onKey = (e) => {
      this._keys[e.key.toLowerCase()] = e.type === "keydown";
    };
    window.addEventListener("keydown", this._onKey);
    window.addEventListener("keyup", this._onKey);
  },
};
