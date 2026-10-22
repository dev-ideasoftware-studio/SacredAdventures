/**
 * Sacred Adventures — SanctuaryImpostors: distant-tree billboards (culling guide E1.6).
 *
 * Mark 2026-10-22: "make billboards of the trees and forest and background scenery
 * in the distance"; "when FPS is bad - remove grass, start removing # of trees at
 * distance - use more billboards for distant objects until 60fps is achieved".
 * Guide E1.6: bake each tree/bush model once at load into a small texture (side
 * view, transparent background); every card faces the pond centre (never the
 * camera), so cards don't swim or read as broken wall panels; fade cards at steep
 * viewing angles and keep the 3D tree whenever the view is top-down. Swapping a
 * far tree for its card is allowed (ATT-04); the minimap shows 3D trees (ATT-05).
 *
 *   1. bakeImpostorAtlas(): renders each model once (orthographic side view) into
 *      an albedo atlas (sRGB) and a normal atlas (the model's own normals as seen
 *      from the side, softened toward a rounded-crown normal), then builds
 *      coverage-preserving mips (as the grass) so far cards keep their shape.
 *   2. createCardMaterial(): ONE shared MeshStandardMaterial for every card (one
 *      texture upload): lit by the same sun and sky as the 3D trees, so day/night
 *      matches; fog; receives shadows; dissolves when seen from steeply above.
 *   3. ImpostorField: every few frames, splits each flora instance into "near: 3D"
 *      and "far: card" by its distance to the MAIN camera (hysteresis; a tree seen
 *      edge-on stays 3D). The 3D sector meshes keep every instance, near ones
 *      first: the main camera (and the shadow pass) draws only the near ones; any
 *      other camera (the minimap) draws all of them. Cards draw only for the main
 *      camera. The Compassionate UI ladder moves the swap distance.
 *
 * Kill switch: ?billboards=0 (everything stays 3D).
 */

import * as THREE from "three";

import { SANCTUARY_POOL_CENTER_X, SANCTUARY_POOL_CENTER_Z } from "./SanctuaryGround.js";

const SWAP_HYSTERESIS_M = 2.0;   // a tree near the swap distance doesn't flip back and forth
const EDGE_ON_COS = 0.5;         // seen more than 60° off its face, a card would look thin: keep 3D
const UPDATE_EVERY_N_FRAMES = 4;
const CAMERA_MOVE_M = 0.75;      // ...or sooner when the camera has moved this far

export function billboardsDisabledByUser() {
  try {
    if (window.__sanctuaryBillboardsOff === true) return true;
    const q = new URLSearchParams(window.location.search);
    return q.get("billboards") === "0" || q.get("billboards") === "off";
  } catch (_) {
    return false;
  }
}

// ── Mips that keep alpha-tested shapes from thinning out with distance ────
function coverageOf(data, k) {
  let c = 0, n = 0;
  for (let i = 3; i < data.length; i += 4) { if (Math.min(255, data[i] * k) >= 128) c++; n++; }
  return n ? c / n : 0;
}

function halve(src, w, h) {
  const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1);
  const dst = new Uint8Array(nw * nh * 4);
  const sx = w > 1 ? 2 : 1, sy = h > 1 ? 2 : 1;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const x0 = x * sx, y0 = y * sy, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
      const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4, i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
      const o = (y * nw + x) * 4;
      for (let c = 0; c < 4; c++) dst[o + c] = (src[i00 + c] + src[i10 + c] + src[i01 + c] + src[i11 + c] + 2) >> 2;
    }
  }
  return { data: dst, width: nw, height: nh };
}

/**
 * Mip chain whose alpha is rescaled per level so the fraction of texels passing
 * the 0.5 alpha test stays what level 0 has (Castaño). Colour must already be
 * dilated into the empty texels (no dark fringes).
 */
export function coveragePreservingMips(level0, w, h) {
  const levels = [{ data: level0, width: w, height: h }];
  const target = coverageOf(level0, 1);
  let cur = levels[0];
  while (cur.width > 1 || cur.height > 1) {
    const next = halve(cur.data, cur.width, cur.height);
    let lo = 0.5, hi = 6;
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      if (coverageOf(next.data, mid) < target) lo = mid; else hi = mid;
    }
    const k = (lo + hi) / 2;
    for (let i = 3; i < next.data.length; i += 4) next.data[i] = Math.min(255, Math.round(next.data[i] * k));
    levels.push(next);
    cur = next;
  }
  return levels;
}

function plainMips(level0, w, h) {
  const levels = [{ data: level0, width: w, height: h }];
  let cur = levels[0];
  while (cur.width > 1 || cur.height > 1) { cur = halve(cur.data, cur.width, cur.height); levels.push(cur); }
  return levels;
}

/** RGBA8 DataTexture with a prebuilt mip chain. */
export function dataTextureWithMips(levels, colorSpace) {
  const l0 = levels[0];
  const tex = new THREE.DataTexture(l0.data, l0.width, l0.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = levels;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ── Bake ─────────────────────────────────────────────────────────────────
const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
#ifdef USE_COLOR
varying vec3 vCol;
#endif
void main() {
  vUv = uv;
  vN = normalize(normalMatrix * normal);
  #ifdef USE_COLOR
  vCol = color;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const BAKE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlphaTest;
uniform int uMode;          // 0 = albedo (sRGB-encoded), 1 = view-space normal
#ifdef HAS_MAP
uniform sampler2D uMap;
#endif
varying vec2 vUv;
varying vec3 vN;
#ifdef USE_COLOR
varying vec3 vCol;
#endif
void main() {
  vec4 c = vec4(uColor, 1.0);
  #ifdef HAS_MAP
  c *= texture2D(uMap, vUv);
  #endif
  if (c.a < uAlphaTest) discard;
  #ifdef USE_COLOR
  c.rgb *= vCol;
  #endif
  if (uMode == 0) {
    vec3 s = mix(c.rgb * 12.92, 1.055 * pow(max(c.rgb, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c.rgb));
    gl_FragColor = vec4(s, 1.0);
  } else {
    vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
    gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
  }
}`;

function bakeMaterialFor(src) {
  const map = src && src.map ? src.map : null;
  const defines = {};
  if (map) defines.HAS_MAP = "";
  const alphaTest = src && (src.alphaTest > 0 || src.transparent) ? Math.max(0.35, src.alphaTest || 0.5) : 0.01;
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uColor: { value: src && src.color ? src.color.clone() : new THREE.Color(1, 1, 1) },
      uAlphaTest: { value: alphaTest },
      uMode: { value: 0 },
    },
    defines,
    vertexColors: !!(src && src.vertexColors),
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    side: THREE.DoubleSide,
  });
}

function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Bake every entry's side view into one atlas.
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ key: string, object: THREE.Object3D }[]} entries  models in their rest pose,
 *        origin at the trunk base (not added to any scene; this function parents them briefly)
 * @param {{ cellW?: number, cellH?: number, cols?: number }} [opts]
 */
export function bakeImpostorAtlas(renderer, entries, opts = {}) {
  const cellW = opts.cellW || 256, cellH = opts.cellH || 512, cols = opts.cols || 4;
  const rows = Math.max(1, Math.ceil(entries.length / cols));
  const atlasW = cellW * cols, atlasH = cellH * rows;
  const albedo = new Uint8Array(atlasW * atlasH * 4);
  const normal = new Uint8Array(atlasW * atlasH * 4);
  const cells = new Map();
  const t0 = performance.now();

  const rt = new THREE.WebGLRenderTarget(cellW, cellH, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false,
  });
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  const bakeScene = new THREE.Scene();
  const px = new Uint8Array(cellW * cellH * 4);
  const prevRT = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;
  const box = new THREE.Box3();

  try {
    entries.forEach((entry, idx) => {
      const col = idx % cols, row = Math.floor(idx / cols);
      const obj = entry.object;
      const parent = obj.parent;
      bakeScene.add(obj);
      obj.updateMatrixWorld(true);
      box.setFromObject(obj);
      if (!isFinite(box.min.x)) { if (parent) parent.add(obj); else bakeScene.remove(obj); return; }
      // Symmetric about the trunk axis so the card centre is the instance origin.
      const halfW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
      const height = box.max.y - box.min.y;
      const padX = halfW * 0.04, padY = height * 0.02;
      cam.left = -halfW - padX; cam.right = halfW + padX;
      cam.bottom = box.min.y - padY; cam.top = box.max.y + padY;
      cam.near = 0.01; cam.far = halfW * 2 + 20;
      cam.position.set(0, 0, halfW + 10);
      cam.rotation.set(0, 0, 0);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);

      // Swap in bake materials (originals restored below).
      const swaps = [];
      obj.traverse((m) => {
        if (!m.isMesh) return;
        const orig = m.material;
        const bm = Array.isArray(orig) ? orig.map(bakeMaterialFor) : bakeMaterialFor(orig);
        swaps.push([m, orig, bm]);
        m.material = bm;
      });
      const setMode = (mode) => swaps.forEach(([, , bm]) => (Array.isArray(bm) ? bm : [bm]).forEach((x) => { x.uniforms.uMode.value = mode; }));

      for (const mode of [0, 1]) {
        setMode(mode);
        renderer.setRenderTarget(rt);
        renderer.render(bakeScene, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, cellW, cellH, px);
        const dst = mode === 0 ? albedo : normal;
        for (let y = 0; y < cellH; y++) {
          const srcRow = y * cellW * 4;
          const dstRow = ((row * cellH + y) * atlasW + col * cellW) * 4;
          dst.set(px.subarray(srcRow, srcRow + cellW * 4), dstRow);
        }
      }

      for (const [m, orig, bm] of swaps) {
        m.material = orig;
        (Array.isArray(bm) ? bm : [bm]).forEach((x) => x.dispose());
      }
      bakeScene.remove(obj);
      if (parent) parent.add(obj);

      const fullW = 2 * (halfW + padX), fullH = height + 2 * padY;
      cells.set(entry.key, {
        u0: col * cellW / atlasW, v0: row * cellH / atlasH,
        u1: (col + 1) * cellW / atlasW, v1: (row + 1) * cellH / atlasH,
        width: fullW, height: fullH, bottom: box.min.y - padY,
        col, row,
      });
    });
  } finally {
    renderer.setRenderTarget(prevRT);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAutoClear;
    rt.dispose();
  }

  // Per cell: soften normals toward a rounded crown, dilate colour/normal into the
  // empty texels (no dark fringes in the mips), note the mean colour.
  for (const cell of cells.values()) {
    const x0 = cell.col * cellW, y0 = cell.row * cellH;
    let sx = 0, sy = 0, sxx = 0, syy = 0, n = 0, sr = 0, sg = 0, sb = 0;
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const i = ((y0 + y) * atlasW + x0 + x) * 4;
        if (albedo[i + 3] < 128) continue;
        n++; sx += x; sy += y; sxx += x * x; syy += y * y;
        sr += albedo[i]; sg += albedo[i + 1]; sb += albedo[i + 2];
      }
    }
    if (!n) continue;
    const cx = sx / n, cy = sy / n;
    const rx = Math.max(4, 1.9 * Math.sqrt(Math.max(1, sxx / n - cx * cx)));
    const ry = Math.max(4, 1.9 * Math.sqrt(Math.max(1, syy / n - cy * cy)));
    const fill = [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
    cell.meanLinear = [srgbToLinear(fill[0]), srgbToLinear(fill[1]), srgbToLinear(fill[2])];
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const i = ((y0 + y) * atlasW + x0 + x) * 4;
        if (albedo[i + 3] < 128) {
          albedo[i] = fill[0]; albedo[i + 1] = fill[1]; albedo[i + 2] = fill[2]; albedo[i + 3] = 0;
          normal[i] = 128; normal[i + 1] = 128; normal[i + 2] = 255; normal[i + 3] = 255;
          continue;
        }
        albedo[i + 3] = 255;
        let bx = normal[i] / 127.5 - 1, by = normal[i + 1] / 127.5 - 1, bz = normal[i + 2] / 127.5 - 1;
        const ex = (x - cx) / rx, ey = (y - cy) / ry;
        const ez = Math.sqrt(Math.max(0, 1 - ex * ex - ey * ey)) + 0.35;
        const el = Math.hypot(ex, ey, ez) || 1;
        bx = 0.45 * bx + 0.55 * ex / el;
        by = 0.45 * by + 0.55 * ey / el;
        bz = 0.45 * bz + 0.55 * ez / el;
        if (bz < 0.15) bz = 0.15;                       // never face away from the viewer
        const bl = Math.hypot(bx, by, bz) || 1;
        normal[i] = Math.round((bx / bl * 0.5 + 0.5) * 255);
        normal[i + 1] = Math.round((by / bl * 0.5 + 0.5) * 255);
        normal[i + 2] = Math.round((bz / bl * 0.5 + 0.5) * 255);
        normal[i + 3] = 255;
      }
    }
  }

  const albedoTex = dataTextureWithMips(coveragePreservingMips(albedo, atlasW, atlasH), THREE.SRGBColorSpace);
  const normalTex = dataTextureWithMips(plainMips(normal, atlasW, atlasH), THREE.NoColorSpace);
  albedoTex.name = "sanctuary_impostor_albedo";
  normalTex.name = "sanctuary_impostor_normal";
  return { albedo: albedoTex, normal: normalTex, cells, atlasW, atlasH, cellW, cellH, bakeMs: performance.now() - t0 };
}

// ── Cards ────────────────────────────────────────────────────────────────
export function createCardMaterial(atlas) {
  const mat = new THREE.MeshStandardMaterial({
    map: atlas.albedo,
    normalMap: atlas.normal,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.88,
    metalness: 0.0,
  });
  mat.name = "sanctuary_impostor_card";
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vImpSteep;")
      .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
      {
        #ifdef USE_INSTANCING
          vec3 impBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #else
          vec3 impBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        vImpSteep = abs(normalize(cameraPosition - impBase).y);
      }`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vImpSteep;")
      .replace("#include <alphatest_fragment>", `
      {
        // Seen from steeply above, a card reads as a flat panel: dissolve it (guide E1.6).
        float impFade = smoothstep(0.62, 0.80, vImpSteep);
        float impDither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        if (impFade > impDither) discard;
      }
      #include <alphatest_fragment>`);
  };
  mat.customProgramCacheKey = () => "sanctuary-impostor-card-v1";
  return mat;
}

function cardGeometry(cell) {
  const g = new THREE.PlaneGeometry(1, 1);
  g.translate(0, 0.5, 0);                              // stands on y = 0, faces +Z
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0));
  }
  uv.needsUpdate = true;
  return g;
}

// ── The 3D ↔ card swap ───────────────────────────────────────────────────
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class ImpostorField {
  /**
   * @param {{ camera: THREE.Camera, atlas: object, parent: THREE.Object3D, distanceM: number }} o
   */
  constructor(o) {
    this.camera = o.camera;
    this.atlas = o.atlas;
    this.parent = o.parent;
    this.material = createCardMaterial(o.atlas);
    this.distanceM = o.distanceM;
    this.enabled = true;
    this.kinds = [];
    this._frame = 0;
    this._lastCam = new THREE.Vector3(1e9, 0, 1e9);
    this._dirty = true;
  }

  /**
   * Register one flora kind: its sector meshes (all primitives, all sectors) and
   * the atlas key of its baked card.
   */
  addKind(kind, meshes, atlasKey) {
    const cell = this.atlas.cells.get(atlasKey);
    if (!cell || !meshes.length) return null;
    const bySector = new Map();
    for (const mesh of meshes) {
      const s = mesh.userData.floraSector ?? 0;
      if (!bySector.has(s)) bySector.set(s, []);
      bySector.get(s).push(mesh);
    }
    const sectors = [];
    let total = 0;
    for (const [, group] of bySector) {
      const lead = group[0];
      const records = [];
      for (let i = 0; i < lead.count; i++) {
        lead.getMatrixAt(i, _m);
        const matrix = _m.clone();
        _m.decompose(_p, _q, _s);
        const color = lead.instanceColor ? lead.getColorAt(i, new THREE.Color()) : null;
        records.push({ matrix, color, x: _p.x, y: _p.y, z: _p.z, sy: _s.y, sxz: (Math.abs(_s.x) + Math.abs(_s.z)) / 2, far: false });
      }
      total += records.length;
      for (const mesh of group) this._installCountGate(mesh, records.length);
      sectors.push({ meshes: group, records });
    }
    const card = new THREE.InstancedMesh(cardGeometry(cell), this.material, total);
    card.name = `sanctuary_tree_cards_${atlasKey}`;     // "tree" keeps it through the fishing cull
    card.userData.anuKind = "sanctuary_tree_cards";
    card.castShadow = false;
    card.receiveShadow = true;
    card.matrixAutoUpdate = false;
    card.raycast = () => {};                               // never picked by click-to-move / tools
    card.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Bounding sphere over every potential card, so frustum culling stays correct.
    let k = 0;
    for (const sec of sectors) for (const r of sec.records) { this._cardMatrix(r, cell, _m); card.setMatrixAt(k++, _m); }
    card.computeBoundingSphere();
    card.count = 0;
    card.userData.farCount = 0;
    const field = this;
    card.onBeforeRender = function (_r, _s, cam) { this.count = (field.enabled && cam === field.camera) ? this.userData.farCount : 0; };
    card.onAfterRender = function () { this.count = this.userData.farCount; };
    this.parent.add(card);
    const entry = { kind, atlasKey, cell, sectors, card, total, far: 0 };
    this.kinds.push(entry);
    this._dirty = true;
    return entry;
  }

  _installCountGate(mesh, total) {
    mesh.userData.impTotal = total;
    mesh.userData.impNear = total;
    const field = this;
    // Main camera: near instances only (far ones are cards). Shadow pass: the same.
    // Any other camera (the minimap): every instance, always 3D (ATT-05).
    mesh.onBeforeRender = function (_r, _s, cam) { this.count = cam === field.camera ? this.userData.impNear : this.userData.impTotal; };
    mesh.onAfterRender = function () { this.count = this.userData.impNear; };
    mesh.onBeforeShadow = function () { this.count = this.userData.impNear; };
  }

  _cardMatrix(r, cell, out) {
    const yaw = Math.atan2(SANCTUARY_POOL_CENTER_X - r.x, SANCTUARY_POOL_CENTER_Z - r.z);
    _q.setFromAxisAngle(_up, yaw);
    _p.set(r.x, r.y + cell.bottom * r.sy, r.z);
    _s.set(cell.width * r.sxz, cell.height * r.sy, 1);
    return out.compose(_p, _q, _s);
  }

  setDistance(m) {
    if (Number.isFinite(m) && m !== this.distanceM) { this.distanceM = m; this._dirty = true; }
  }

  setEnabled(on) {
    if (!!on !== this.enabled) { this.enabled = !!on; this._dirty = true; }
  }

  update() {
    const cam = this.camera;
    if (!cam) return;
    this._frame++;
    const moved = Math.hypot(cam.position.x - this._lastCam.x, cam.position.z - this._lastCam.z) > CAMERA_MOVE_M;
    if (!this._dirty && !moved && this._frame % UPDATE_EVERY_N_FRAMES !== 0) return;
    this._dirty = false;
    this._lastCam.copy(cam.position);
    const cx = cam.position.x, cz = cam.position.z, D = this.distanceM, on = this.enabled;
    for (const k of this.kinds) {
      let changedAny = false;
      for (const sec of k.sectors) {
        let changed = false;
        for (const r of sec.records) {
          let far = false;
          if (on) {
            const dx = cx - r.x, dz = cz - r.z;
            const d = Math.hypot(dx, dz);
            far = d > (r.far ? D - SWAP_HYSTERESIS_M : D + SWAP_HYSTERESIS_M);
            if (far) {
              const nx = SANCTUARY_POOL_CENTER_X - r.x, nz = SANCTUARY_POOL_CENTER_Z - r.z;
              const nl = Math.hypot(nx, nz);
              if (nl > 1 && d > 0.01 && Math.abs((dx * nx + dz * nz) / (d * nl)) < EDGE_ON_COS) far = false;
            }
          }
          if (far !== r.far) { r.far = far; changed = true; }
        }
        if (changed) { this._writeSector(sec); changedAny = true; }
      }
      if (changedAny) this._writeCards(k);
    }
  }

  _writeSector(sec) {
    const order = sec.records.filter((r) => !r.far).concat(sec.records.filter((r) => r.far));
    const near = sec.records.length - sec.records.filter((r) => r.far).length;
    for (const mesh of sec.meshes) {
      order.forEach((r, j) => {
        mesh.setMatrixAt(j, r.matrix);
        if (mesh.instanceColor && r.color) mesh.setColorAt(j, r.color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.impNear = near;
      mesh.count = near;
    }
  }

  _writeCards(k) {
    let j = 0;
    for (const sec of k.sectors) {
      for (const r of sec.records) {
        if (!r.far) continue;
        k.card.setMatrixAt(j, this._cardMatrix(r, k.cell, _m));
        if (r.color) k.card.setColorAt(j, r.color);
        j++;
      }
    }
    k.card.userData.farCount = j;
    k.card.count = j;
    k.far = j;
    k.card.instanceMatrix.needsUpdate = true;
    if (k.card.instanceColor) k.card.instanceColor.needsUpdate = true;
  }

  stats() {
    const out = { enabled: this.enabled, distanceM: this.distanceM, kinds: {} };
    let cards = 0, total = 0;
    for (const k of this.kinds) { out.kinds[k.atlasKey] = { total: k.total, cards: k.far }; cards += k.far; total += k.total; }
    out.cards = cards;
    out.total = total;
    out.atlas = { width: this.atlas.atlasW, height: this.atlas.atlasH, bakeMs: Math.round(this.atlas.bakeMs) };
    return out;
  }

  dispose() {
    for (const k of this.kinds) {
      for (const sec of k.sectors) {
        for (const mesh of sec.meshes) {
          mesh.onBeforeRender = () => {};
          mesh.onAfterRender = () => {};
          mesh.onBeforeShadow = () => {};
          mesh.count = mesh.userData.impTotal ?? mesh.count;
        }
      }
      k.card.removeFromParent();
      k.card.geometry.dispose();
      k.card.dispose();
    }
    this.kinds = [];
    this.material.dispose();
    this.atlas.albedo.dispose();
    this.atlas.normal.dispose();
  }
}
