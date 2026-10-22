/**
 * Sacred Adventures — sanctuary: SanctuaryGrass (photoreal meadow on the ground texture)
 *
 * Mark 2026-10-22: "I want to see the grass atop the existing ground texture …
 * the most hyper realistic grass … super efficient". Design from the grass
 * research (Sacred-Ones project doc claude/grass-research.md), with its four
 * changes to the billboard plan:
 *   1. Cards are locked upright (cylindrical) and recline toward a high camera,
 *      so the top-down village view sees their face instead of a sticker edge.
 *   2. Each card is trimmed to its blade outline (8 verts / 6 tris, not a quad),
 *      so fewer pixels reach the alpha discard — the iPhone HSR tax.
 *   3. Grass draws after the ground/rocks/buildings (renderOrder) and thins with
 *      distance in the VERTEX shader (instances collapse to zero-area), never by
 *      dissolving pixels.
 *   4. The blade texture's mip chain is coverage-preserving, so far cards keep
 *      their shape instead of thinning out.
 *
 * How it stays cheap: no per-instance data at all. Two instanced draws (a dense
 * near ring + a coarse far ring) walk a world-locked grid that follows the
 * camera; every card's position, height, ground colour, hex shading, wind and
 * fade are derived on the GPU from its grid cell. Three small textures are
 * baked once at load from the REAL terrain mesh (height, colour) and the scene
 * (keep-out mask). Per frame the CPU only sets two uniforms (clock, player).
 *
 * Ground match: a card's root colour = the terrain's own vertex colour ×
 * mean albedo of the terrain's grass texture × the terrain's hex-tile factor,
 * i.e. exactly what the ground pixel under it is made of, so roots melt into
 * the ground and the hex tiles still read through the meadow (Mark: "grass
 * shows the hexes"). Wind uses the trees' formula, direction and clock
 * (SanctuaryPondTrees.js) so one gust moves canopy and meadow together.
 * Shadows: receive only (tree leaves do the same); back-light glow is
 * computed inside the light loop, so shaded grass doesn't glow.
 *
 * Reads only (never edits): SanctuaryGround (sanctuaryGroundY, terrain mesh
 * "sanctuary_terrain" + its colour attribute and albedo map), SanctuaryPondTrees
 * (_time), window.__sanctuaryWaterY / __sanctuaryDockExtents / __sanctuaryAvatar,
 * SanctuaryMutations.list(), tipi platforms / braziers in the scene.
 *
 * Kill switch: ?grass=0 (or window.__sanctuaryGrassOff = true before boot).
 * Runtime:     window.__sanctuaryGrass.setEnabled(false|true) · .stats() · .rebake()
 * Anu note: SceneModelInventory multiplies only InstancedMesh by its count, so
 * it sees these two meshes as 6 triangles each; renderer.info sees the real
 * submitted count.
 * Main camera only: the minimap cameras also see layer 0 (Orchestrator.js
 * L1149-1154), so onBeforeRender gives any other camera zero instances and
 * the minimap is unchanged. Does not cast shadows.
 * Lighting: MeshStandardMaterial with the terrain's roughness, so blades get
 * the same grazing-angle sheen the ground gets in chase view.
 *
 * Anu domain: FLORA.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "../v2/anu/SimulationController.js";
import {
  sanctuaryGroundY,
  SANCTUARY_POOL_CENTER_X,
  SANCTUARY_POOL_CENTER_Z,
  SANCTUARY_POOL_RADIUS_M,
} from "./SanctuaryGround.js";
import { SanctuaryPondTreesModule } from "./SanctuaryPondTrees.js";

// ── Tiers ───────────────────────────────────────────────────────────────
// grid × grid instances per ring; spacing in metres; card = [width, height] m.
// ditherIn/ditherOut: horizontal-distance band where cards are randomly kept
// (ring cross-fade); heightOut: band where cards shrink to nothing (meadow
// recedes into the ground texture without popping). thinStart: 3-D distance
// beyond which cards thin as (thinStart/d)² and grow to keep coverage.
const TIERS = {
  desktop: {
    atlasCell: 256,
    rings: [
      { grid: 190, spacing: 0.21, card: [0.46, 0.36], ditherIn: [-2, -1], ditherOut: [13, 17], heightOut: [998, 999], thinStart: 9 },
      { grid: 120, spacing: 0.75, card: [0.95, 0.50], ditherIn: [13, 17], ditherOut: [998, 999], heightOut: [32, 43], thinStart: 24 },
    ],
  },
  mobile: {
    atlasCell: 128,
    rings: [
      { grid: 96, spacing: 0.32, card: [0.46, 0.38], ditherIn: [-2, -1], ditherOut: [10, 13.5], heightOut: [998, 999], thinStart: 8 },
      { grid: 72, spacing: 0.90, card: [1.00, 0.52], ditherIn: [10, 13.5], ditherOut: [998, 999], heightOut: [24, 31.5], thinStart: 20 },
    ],
  },
};

const MASK_RES = 256;           // keep-out mask over the terrain rect (~0.43 m texels)
const MASK_EDGE_M = 0.6;        // soft edge around keep-outs (grass gets shorter, then stops)
const WIND_DIR = new THREE.Vector2(0.78, 0.62); // = SanctuaryPondTrees.js:102
const WIND_AMP = 0.30;          // tip sway as a fraction of blade height at full gust
const RENDER_ORDER = 5;         // after terrain/rocks/buildings (all 0), before transparents
const SIGNATURE_EVERY_N_FRAMES = 60;

// Trimmed card outline in cell space (x right, y up). 4 rows × 2 = 8 verts.
// The atlas blades are clipped to exactly this polygon.
const CARD_ROWS = [
  [0.0, 0.28, 0.72],
  [0.3, 0.10, 0.90],
  [0.62, 0.02, 0.98],
  [1.0, 0.06, 0.94],
];
const ATLAS_INSET = 0.03;       // cell padding so mips don't bleed between variants

// ── Small utils ─────────────────────────────────────────────────────────
function mulberry32(seed) {
  return function rng() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function isMobileDevice(orc) {
  try {
    if (window.SacredDeviceProfile && typeof window.SacredDeviceProfile.isMobile === "boolean") {
      return window.SacredDeviceProfile.isMobile;
    }
  } catch (_) { /* fall through */ }
  return !!(orc && orc._isMobile);
}

function grassDisabledByUser() {
  try {
    if (window.__sanctuaryGrassOff === true) return true;
    const q = new URLSearchParams(window.location.search);
    return q.get("grass") === "0" || q.get("grass") === "off";
  } catch (_) { return false; }
}

// ── Card geometry (shared by both rings) ────────────────────────────────
function buildCardGeometry(instanceCount) {
  const pos = [], uv = [], idx = [];
  for (const [y, x0, x1] of CARD_ROWS) {
    pos.push(x0 - 0.5, y, 0, x1 - 0.5, y, 0);
    uv.push(x0, y, x1, y);
  }
  for (let r = 0; r < CARD_ROWS.length - 1; r++) {
    const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, d, a, d, c); // CCW seen from +Z (the camera side)
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const ids = new Float32Array(instanceCount);
  for (let i = 0; i < instanceCount; i++) ids[i] = i;
  geo.setAttribute("aIdx", new THREE.InstancedBufferAttribute(ids, 1));
  geo.instanceCount = instanceCount;
  return geo;
}

// ── Procedural blade atlas (2×2 variants) + coverage-preserving mips ────
function rowHalfWidthAt(y) {
  for (let r = 0; r < CARD_ROWS.length - 1; r++) {
    const [ya, a0, a1] = CARD_ROWS[r], [yb, b0, b1] = CARD_ROWS[r + 1];
    if (y >= ya && y <= yb) {
      const t = (y - ya) / (yb - ya);
      return [a0 + (b0 - a0) * t, a1 + (b1 - a1) * t];
    }
  }
  return [CARD_ROWS[3][1], CARD_ROWS[3][2]];
}

function drawBlade(ctx, P, W, b, rng) {
  // b: { bx, tx, ty, cx, cy, w0, lum, hr, hb }
  const N = 14, L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, it = 1 - t;
    // quadratic Bézier centreline (cell space, y up)
    const x = it * it * b.bx + 2 * it * t * b.cx + t * t * b.tx;
    const y = 2 * it * t * b.cy + t * t * b.ty;
    const dx = 2 * it * (b.cx - b.bx) + 2 * t * (b.tx - b.cx);
    const dy = 2 * it * (b.cy) + 2 * t * (b.ty - b.cy);
    const len = Math.hypot(dx, dy) || 1;
    const hw = (b.w0 * Math.pow(1 - t, 0.85) + 0.0015) * 0.5;
    L.push(P(x - (dy / len) * hw, y + (dx / len) * hw));
    R.push(P(x + (dy / len) * hw, y - (dx / len) * hw));
  }
  const base = P(b.bx, 0), tip = P(b.tx, b.ty);
  const g = ctx.createLinearGradient(base[0], base[1], tip[0], tip[1]);
  const col = (k) => {
    const v = Math.min(1, b.lum * k);
    return `rgb(${Math.round(255 * v * b.hr)},${Math.round(255 * v)},${Math.round(255 * v * b.hb)})`;
  };
  g.addColorStop(0, col(0.62));
  g.addColorStop(0.3, col(0.86));
  g.addColorStop(0.75, col(0.97));
  g.addColorStop(1, col(1.05));
  ctx.beginPath();
  ctx.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < L.length; i++) ctx.lineTo(L[i][0], L[i][1]);
  for (let i = R.length - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  // darker edges
  ctx.lineWidth = Math.max(0.6, W * 0.0025);
  ctx.strokeStyle = col(0.55);
  ctx.globalAlpha = 0.35;
  ctx.stroke();
  // lighter midrib
  ctx.beginPath();
  for (let i = 1; i <= 12; i++) {
    const t = 0.05 + (i / 12) * 0.8, it = 1 - t;
    const x = it * it * b.bx + 2 * it * t * b.cx + t * t * b.tx;
    const y = 2 * it * t * b.cy + t * t * b.ty;
    const p = P(x, y);
    if (i === 1) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
  }
  ctx.lineWidth = Math.max(0.5, b.w0 * W * 0.16);
  ctx.strokeStyle = col(1.25);
  ctx.globalAlpha = 0.3;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawSeedStalk(ctx, P, W, rng) {
  const bx = 0.5 + (rng() - 0.5) * 0.1, ty = 0.86 + rng() * 0.1;
  const tx = bx + (rng() - 0.5) * 0.25;
  const cx = bx + (tx - bx) * 0.4 + (rng() - 0.5) * 0.08, cy = ty * 0.5;
  ctx.beginPath();
  for (let i = 0; i <= 16; i++) {
    const t = i / 16, it = 1 - t;
    const p = P(it * it * bx + 2 * it * t * cx + t * t * tx, 2 * it * t * cy + t * t * ty);
    if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
  }
  ctx.lineWidth = Math.max(0.8, W * 0.006);
  ctx.strokeStyle = "rgb(196,200,150)";
  ctx.stroke();
  // spikelets along the top 25 %
  for (let i = 0; i < 9; i++) {
    const t = 0.76 + (i / 9) * 0.24, it = 1 - t;
    const x = it * it * bx + 2 * it * t * cx + t * t * tx;
    const y = 2 * it * t * cy + t * t * ty;
    const p = P(x + (i % 2 ? 0.012 : -0.012), y);
    ctx.beginPath();
    ctx.ellipse(p[0], p[1], W * 0.009, W * 0.02, (i % 2 ? 0.5 : -0.5), 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${210 + (i % 3) * 8},${206 + (i % 2) * 6},150)`;
    ctx.fill();
  }
}

const VARIANTS = [
  { blades: 24, h: [0.45, 0.95], w: [0.024, 0.042], bend: 0.10 },           // dense meadow clump
  { blades: 16, h: [0.65, 1.0], w: [0.018, 0.030], bend: 0.18 },            // tall wispy
  { blades: 19, h: [0.5, 0.95], w: [0.022, 0.038], bend: 0.12, seeds: 2 },  // with seed heads
  { blades: 20, h: [0.38, 0.80], w: [0.030, 0.050], bend: 0.08 },           // short broad
];

function buildAtlas(cell) {
  const S = cell * 2;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rng = mulberry32(20261022);
  VARIANTS.forEach((v, vi) => {
    const cx0 = (vi % 2) * cell, cy0 = Math.floor(vi / 2) * cell;
    const ins = ATLAS_INSET * cell, W = cell - 2 * ins;
    const P = (x, y) => [cx0 + ins + x * W, cy0 + ins + (1 - y) * W];
    ctx.save();
    ctx.beginPath();
    const poly = [];
    for (const [y, x0] of CARD_ROWS) poly.push(P(x0, y));
    for (let r = CARD_ROWS.length - 1; r >= 0; r--) poly.push(P(CARD_ROWS[r][2], CARD_ROWS[r][0]));
    ctx.moveTo(poly[0][0], poly[0][1]);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
    ctx.closePath();
    ctx.clip();
    const blades = [];
    for (let i = 0; i < v.blades; i++) {
      const ty = v.h[0] + rng() * (v.h[1] - v.h[0]);
      const [lo, hi] = rowHalfWidthAt(ty);
      const bx = 0.5 + (rng() - 0.5) * 0.36;
      const tx = lo + 0.04 + rng() * (hi - lo - 0.08);
      const bend = (rng() - 0.5) * 2 * v.bend;
      blades.push({
        bx, tx, ty,
        cx: bx + (tx - bx) * 0.35 + bend, cy: ty * (0.45 + rng() * 0.2),
        w0: v.w[0] + rng() * (v.w[1] - v.w[0]),
        depth: rng(),
        hr: 0.93 + rng() * 0.1, hb: 0.84 + rng() * 0.12,
      });
    }
    blades.sort((a, b) => a.depth - b.depth); // back to front
    for (const b of blades) {
      b.lum = 0.62 + b.depth * 0.32 + (rng() - 0.5) * 0.08; // back blades darker (self-occlusion)
      drawBlade(ctx, P, W, b, rng);
    }
    for (let s = 0; s < (v.seeds || 0); s++) drawSeedStalk(ctx, P, W, rng);
    ctx.restore();
  });

  const img = ctx.getImageData(0, 0, S, S).data;
  // Mean opaque luminance → gain so the average blade pixel = 1.0 × tint.
  let sum = 0, n = 0;
  for (let i = 0; i < img.length; i += 4) {
    if (img[i + 3] >= 128) { sum += (img[i] + img[i + 1] + img[i + 2]) / (3 * 255); n++; }
  }
  const mean = n ? sum / n : 0.8;
  const fill = Math.round(mean * 255);
  const level0 = new Uint8Array(img.length);
  for (let i = 0; i < img.length; i += 4) {
    const a = img[i + 3];
    // dilate colour into empty texels so mips have no dark fringes
    level0[i] = a ? img[i] : fill;
    level0[i + 1] = a ? img[i + 1] : fill;
    level0[i + 2] = a ? img[i + 2] : fill;
    level0[i + 3] = a;
  }
  const mipmaps = coveragePreservingMips(level0, S);
  const tex = new THREE.DataTexture(level0, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.mipmaps = mipmaps;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  canvas.width = canvas.height = 0; // free the 2-D backing store (mobile memory is tight)
  return { tex, gain: 1 / mean };
}

function coverageOf(data, k) {
  let c = 0, n = 0;
  for (let i = 3; i < data.length; i += 4) { if (Math.min(255, data[i] * k) >= 128) c++; n++; }
  return c / n;
}

/** Castaño-style: each mip's alpha is rescaled so the fraction of texels
 *  passing the 0.5 test equals level 0's, so far cards keep their shape. */
function coveragePreservingMips(level0, size) {
  const levels = [{ data: level0, width: size, height: size }];
  const target = coverageOf(level0, 1);
  let src = level0, w = size;
  while (w > 1) {
    const nw = w >> 1, dst = new Uint8Array(nw * nw * 4);
    for (let y = 0; y < nw; y++) {
      for (let x = 0; x < nw; x++) {
        for (let c = 0; c < 4; c++) {
          const i00 = ((y * 2) * w + x * 2) * 4 + c, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
          dst[(y * nw + x) * 4 + c] = (src[i00] + src[i10] + src[i01] + src[i11] + 2) >> 2;
        }
      }
    }
    let lo = 0.5, hi = 6;
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      if (coverageOf(dst, mid) < target) lo = mid; else hi = mid;
    }
    const k = (lo + hi) / 2;
    for (let i = 3; i < dst.length; i += 4) dst[i] = Math.min(255, Math.round(dst[i] * k));
    levels.push({ data: dst, width: nw, height: nw });
    src = dst; w = nw;
  }
  return levels;
}

// ── Terrain-derived textures (height + colour), read from the live mesh ──
function bakeTerrainTextures(terrain) {
  const geo = terrain.geometry;
  const pos = geo.attributes.position, col = geo.attributes.color;
  if (!pos || !col) return null;
  terrain.updateMatrixWorld(true);
  geo.computeBoundingBox();
  const bb = geo.boundingBox.clone().applyMatrix4(terrain.matrixWorld);
  const n = Math.round(Math.sqrt(pos.count));
  if (n * n !== pos.count) return null; // not the grid we expect
  const minX = bb.min.x, minZ = bb.min.z, sizeX = bb.max.x - bb.min.x, sizeZ = bb.max.z - bb.min.z;
  const h = new Uint16Array(n * n), c = new Uint8Array(n * n * 4);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(terrain.matrixWorld);
    const gx = Math.round(((v.x - minX) / sizeX) * (n - 1));
    const gz = Math.round(((v.z - minZ) / sizeZ) * (n - 1));
    const k = gz * n + gx;
    h[k] = THREE.DataUtils.toHalfFloat(v.y);
    c[k * 4] = Math.round(col.getX(i) * 255);
    c[k * 4 + 1] = Math.round(col.getY(i) * 255);
    c[k * 4 + 2] = Math.round(col.getZ(i) * 255);
    c[k * 4 + 3] = 255;
  }
  const hTex = new THREE.DataTexture(h, n, n, THREE.RedFormat, THREE.HalfFloatType);
  const cTex = new THREE.DataTexture(c, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  for (const t of [hTex, cTex]) {
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace; // vertex colours are linear multipliers in the terrain shader
    t.needsUpdate = true;
  }
  return { hTex, cTex, n, rect: new THREE.Vector4(minX, minZ, 1 / sizeX, 1 / sizeZ) };
}

/** Mean of the terrain's tiled grass albedo, in linear space (what the
 *  terrain shader multiplies the vertex colour by, on average). */
function meanAlbedo(terrain) {
  const fallback = new THREE.Vector3(0.16, 0.24, 0.07);
  try {
    const img = terrain.material?.map?.image;
    if (!img || !img.width) return fallback;
    const S = 64, cv = document.createElement("canvas");
    cv.width = cv.height = S;
    const cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(img, 0, 0, S, S);
    const d = cx.getImageData(0, 0, S, S).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += srgbToLinear(d[i] / 255); g += srgbToLinear(d[i + 1] / 255); b += srgbToLinear(d[i + 2] / 255);
    }
    const n = d.length / 4;
    return new THREE.Vector3(r / n, g / n, b / n);
  } catch (_) {
    return fallback;
  }
}

// ── Keep-out mask (water, dock, tipi platforms, braziers, kids' builds) ─
const NO_KEEPOUT_TOOLS = /flower|lily/i;
const TOOL_DEFAULT_RADIUS = { hill: 3.8, rock: 1.2, tree: 0.9, bush: 1.0, tipi: 4.9 };

function collectKeepOuts(scene) {
  const circles = [], rects = [];
  const box = new THREE.Box3(), c = new THREE.Vector3(), s = new THREE.Vector3();
  for (const o of scene.children) {
    const kind = String(o.userData?.anuKind || "");
    if (!o.visible) continue;
    if (/sacred_circle_platform|sanctuary_brazier|sanctuary_village_pad/.test(kind)) {
      box.setFromObject(o);
      if (!isFinite(box.min.x)) continue;
      box.getCenter(c); box.getSize(s);
      circles.push({ x: c.x, z: c.z, r: Math.max(s.x, s.z) * 0.5 + 0.15 });
    }
  }
  const dock = window.__sanctuaryDockExtents;
  if (dock && Number.isFinite(dock.midX)) {
    rects.push({ x: dock.midX, z: dock.midZ, hx: dock.halfLen + 0.3, hz: dock.halfWid + 0.2, yaw: dock.yaw || 0 });
  }
  const muts = window.SanctuaryMutations?.list?.() || [];
  for (const m of muts) {
    if (!m || !Number.isFinite(m.x) || NO_KEEPOUT_TOOLS.test(String(m.tool))) continue;
    let r = null;
    if (m.mesh && m.mesh.isObject3D) {
      box.setFromObject(m.mesh);
      if (isFinite(box.min.x)) { box.getSize(s); r = Math.max(s.x, s.z) * 0.5 * 0.9; }
    }
    if (r == null) {
      const key = Object.keys(TOOL_DEFAULT_RADIUS).find((k) => String(m.tool).toLowerCase().includes(k));
      r = Number.isFinite(m.payload?.radius) ? m.payload.radius * 0.85 : (TOOL_DEFAULT_RADIUS[key] ?? 1.0);
    }
    circles.push({ x: m.x, z: m.z, r });
  }
  return { circles, rects };
}

function keepOutSignature(k) {
  const f = (v) => v.toFixed(1);
  return k.circles.map((q) => `${f(q.x)},${f(q.z)},${f(q.r)}`).join(";") + "|" +
         k.rects.map((q) => `${f(q.x)},${f(q.z)},${f(q.hx)},${f(q.hz)},${f(q.yaw)}`).join(";");
}

function bakeMask(maskData, rect, keep) {
  const minX = rect.x, minZ = rect.y, sizeX = 1 / rect.z, sizeZ = 1 / rect.w;
  const waterY = Number.isFinite(window.__sanctuaryWaterY) ? window.__sanctuaryWaterY : -0.6;
  for (let j = 0; j < MASK_RES; j++) {
    const z = minZ + ((j + 0.5) / MASK_RES) * sizeZ;
    for (let i = 0; i < MASK_RES; i++) {
      const x = minX + ((i + 0.5) / MASK_RES) * sizeX;
      let v = 1;
      if (i === 0 || j === 0 || i === MASK_RES - 1 || j === MASK_RES - 1) v = 0;
      // Water + its wet bank (the pool bowl). Grass gets shorter toward the waterline.
      const r = Math.hypot(x - SANCTUARY_POOL_CENTER_X, z - SANCTUARY_POOL_CENTER_Z);
      if (v > 0 && r < SANCTUARY_POOL_RADIUS_M + 0.5) {
        const gy = sanctuaryGroundY(x, z);
        v *= smooth(waterY + 0.08, waterY + 0.35, gy);
      }
      for (let q = 0; v > 0 && q < keep.circles.length; q++) {
        const c = keep.circles[q];
        v *= smooth(0, MASK_EDGE_M, Math.hypot(x - c.x, z - c.z) - c.r);
      }
      for (let q = 0; v > 0 && q < keep.rects.length; q++) {
        const b = keep.rects[q];
        const dx = x - b.x, dz = z - b.z, cs = Math.cos(b.yaw), sn = Math.sin(b.yaw);
        const lx = Math.abs(dx * cs + dz * sn) - b.hx, lz = Math.abs(-dx * sn + dz * cs) - b.hz;
        const outside = Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0);
        v *= smooth(0, MASK_EDGE_M, outside);
      }
      maskData[j * MASK_RES + i] = Math.round(v * 255);
    }
  }
}

// ── Shader ──────────────────────────────────────────────────────────────
// Hex factor mirrors SanctuaryGround.js terrain shader (hexRadius 6.27, the
// groove/bevel/rim/interior profile and the corner dip). If that look changes
// there, change GRASS_HEX here too, or the grass stops matching the tiles.
const GRASS_VERTEX_PARS = /* glsl */ `
attribute float aIdx;
uniform sampler2D uGHeight;
uniform sampler2D uGColor;
uniform sampler2D uGMask;
uniform vec4  uGRect;      // minX, minZ, 1/sizeX, 1/sizeZ of the terrain
uniform vec2  uGGridUV;    // (n-1)/n, 0.5/n for the vertex-grid textures
uniform float uGTime;
uniform vec2  uGWindDir;
uniform float uGWindAmp;
uniform float uGSpacing;
uniform vec2  uGOrigin;    // first grid cell of this frame's window (world-aligned)
uniform float uGCols;      // window width in cells
uniform vec2  uGCard;
uniform vec2  uGDitherIn;
uniform vec2  uGDitherOut;
uniform vec2  uGHeightOut;
uniform float uGThinStart;
uniform vec3  uGAlbedo;
uniform vec3  uGPlayer;    // xz + w-flag in y (1 = valid)
uniform float uGLean;
varying vec2  vGUv;
varying vec3  vGRoot;
varying vec3  vGTip;
varying float vGH;

float gHash(vec2 p) {                       // Hoskins hash12 (no sin: stable on mobile)
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x),
             mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float gHexDist(vec2 p) { p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.73205081))), p.x); }
float gHexMul(vec2 xz) {                    // GRASS_HEX — mirrors SanctuaryGround.js
  float hexRadius = 6.27;
  float hr3 = hexRadius * 1.73205081;
  vec2 hr = vec2(hr3, hexRadius * 3.0);
  vec2 hh = hr * 0.5;
  vec2 ha = mod(xz, hr) - hh;
  vec2 hb = mod(xz - hh, hr) - hh;
  vec2 hl = dot(ha, ha) < dot(hb, hb) ? ha : hb;
  float hedge = hr3 * 0.5 - gHexDist(hl);
  float m;
  if (hedge < 0.55)      m = 0.38 + smoothstep(0.0, 0.55, hedge) * 0.34;
  else if (hedge < 1.10) m = 0.72 + smoothstep(0.55, 1.10, hedge) * 0.20;
  else if (hedge < 1.70) m = 0.92 + smoothstep(1.10, 1.70, hedge) * 0.36;
  else                   m = mix(1.28, 1.0, smoothstep(1.70, 3.0, hedge));
  float hc = length(hl);
  if (hc > hexRadius * 0.62) m *= 1.0 - smoothstep(hexRadius * 0.62, hexRadius, hc) * 0.45;
  return m;
}
`;

const GRASS_VERTEX_MAIN = /* glsl */ `
  // ── which grid cell is this instance? (world-locked, follows the camera)
  vec2 gij = vec2(mod(aIdx, uGCols), floor(aIdx / uGCols));
  vec2 gCell = uGOrigin + gij;
  float hA = gHash(gCell), hB = gHash(gCell + 17.31), hC = gHash(gCell + 41.7), hD = gHash(gCell + 73.9);
  float hE = gHash(gCell + 101.3), hF = gHash(gCell + 131.1);
  vec2 gXZ = (gCell + vec2(hA, hB)) * uGSpacing;

  // ── ground: height, colour, keep-out mask (baked from the real terrain)
  vec2 gT = (gXZ - uGRect.xy) * uGRect.zw;
  float gInside = step(0.0, gT.x) * step(0.0, gT.y) * step(gT.x, 1.0) * step(gT.y, 1.0);
  vec2 gGridUV = gT * uGGridUV.x + uGGridUV.y;
  float gY = texture2D(uGHeight, gGridUV).r - 0.035;
  vec3 gBand = texture2D(uGColor, gGridUV).rgb;
  float gMask = texture2D(uGMask, gT).r * gInside;

  // ── keep / thin / fade (all in the vertex shader: no pixel dissolves)
  float gHd = distance(gXZ, cameraPosition.xz);
  vec3 gRoot = vec3(gXZ.x, gY, gXZ.y);
  float gD3 = max(distance(cameraPosition, gRoot), 0.001);
  float gThin = clamp((uGThinStart * uGThinStart) / (gD3 * gD3), 0.1, 1.0);
  float gKeepP = smoothstep(uGDitherIn.x, uGDitherIn.y, gHd) * (1.0 - smoothstep(uGDitherOut.x, uGDitherOut.y, gHd));
  bool gKeep = hC < gKeepP && hD < gThin && hE < gMask * 1.05 && gMask > 0.02;
  float gGrow = min(inversesqrt(gThin), 2.5);
  float gHeightFade = 1.0 - smoothstep(uGHeightOut.x, uGHeightOut.y, gHd);
  float gW = uGCard.x * (0.8 + 0.4 * hA) * gGrow;
  float gPatchH = 0.72 + 0.6 * gNoise(gXZ * 0.23 + 3.1);
  float gHt = uGCard.y * (0.6 + 0.8 * hB) * gPatchH * gGrow * gHeightFade * mix(0.35, 1.0, smoothstep(0.0, 0.8, gMask));

  // ── card frame: upright, faces the camera around Y, reclines back toward a high camera
  vec3 gToCam = cameraPosition - gRoot;
  vec2 gC = normalize(gToCam.xz + vec2(1e-4, 0.0));
  float gYaw = (hF - 0.5) * 1.4;
  float cy = cos(gYaw), sy = sin(gYaw);
  vec2 gRightH = vec2(gC.y, -gC.x);
  gRightH = vec2(gRightH.x * cy - gRightH.y * sy, gRightH.x * sy + gRightH.y * cy);
  vec3 gRight = vec3(gRightH.x, 0.0, gRightH.y);
  float gElev = atan(gToCam.y, length(gToCam.xz));
  float gA = clamp(gElev, 0.0, 1.5) * uGLean;
  vec3 gUp = vec3(-gC.x * sin(gA), cos(gA), -gC.y * sin(gA));
  vec3 gFace = vec3(gC.x * cos(gA), sin(gA), gC.y * cos(gA));

  // ── place the vertex
  float gYv = position.y;
  vec3 gPos = gRoot + gRight * (position.x * gW) + gUp * (gYv * gHt);

  // ── wind: the trees' exact gust (SanctuaryPondTrees.js) + a little flutter
  float gAlong = dot(gXZ, uGWindDir);
  float gGust = 0.5 + 0.5 * sin(uGTime * 0.84 - gAlong * 0.05);
  float gPhase = uGTime * 0.40 - gAlong * 0.12 + hE * 1.7;
  float gOsc = sin(gPhase) * 0.7 + cos(gPhase * 2.1) * 0.3;
  float gFlut = 0.08 * sin(uGTime * 6.3 + hF * 40.0);
  float gBend = uGWindAmp * (0.35 + 0.65 * gGust) * (0.8 + 0.25 * gOsc + gFlut) * gYv * gYv * gHt;
  gPos.xz += uGWindDir * gBend;
  gPos.y -= 0.35 * gBend * gYv;

  // ── trample: blades lean away from the player
  if (uGPlayer.y > 0.5) {
    vec2 gDp = gXZ - uGPlayer.xz;
    float gDist = length(gDp);
    float gTr = (1.0 - smoothstep(0.25, 1.3, gDist)) * pow(gYv, 1.5) * gHt;
    gPos.xz += (gDp / max(gDist, 0.01)) * gTr * 0.7;
    gPos.y -= gTr * 0.45;
  }
  if (!gKeep || gHt < 0.01) gPos = vec3(0.0, -9999.0, 0.0);   // zero-area: never rasterised

  // ── atlas cell + colour (root = the ground under it; tips brighter, patchy dryness)
  float gVar = floor(gHash(gCell + 157.7) * 3.999);
  vec2 gCellUV = vec2(mod(gVar, 2.0), floor(gVar * 0.5));
  float gU = gHash(gCell + 191.3) < 0.5 ? uv.x : 1.0 - uv.x;   // mirror the art, not the geometry (keeps winding)
  vGUv = (gCellUV + ${ATLAS_INSET.toFixed(3)} + vec2(gU, 1.0 - uv.y) * ${(1 - 2 * ATLAS_INSET).toFixed(3)}) * 0.5;
  vGH = gYv;
  float gHex = gHexMul(gXZ);
  vGRoot = gBand * uGAlbedo * gHex;
  float gPatch = gNoise(gXZ * 0.045) * 0.65 + gNoise(gXZ * 0.17) * 0.35;
  float gDry = smoothstep(0.5, 0.82, gPatch);
  vec3 gLift = mix(vec3(1.22, 1.20, 1.10), vec3(1.45, 1.32, 0.92), gDry) * (0.9 + 0.2 * hF);
  gLift *= mix(vec3(0.94, 1.0, 1.06), vec3(1.08, 1.03, 0.90), gHash(gCell + 223.9)); // per-clump warm/cool
  vGTip = vGRoot * gLift;

  // ── bent normal: up at the root, curving across the card toward the tips
  vec3 objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0),
                                    normalize(gFace * 0.25 + vec3(0.0, 1.0, 0.0) + gRight * (position.x * 0.7)),
                                    smoothstep(0.0, 0.5, gYv)));
  #ifdef USE_TANGENT
    vec3 objectTangent = vec3( tangent.xyz );
  #endif
`;

const GRASS_FRAGMENT_PARS = /* glsl */ `
uniform sampler2D uGAtlas;
uniform float uGAtlasGain;
uniform float uGRootAO;
uniform float uGTranslucency;
varying vec2  vGUv;
varying vec3  vGRoot;
varying vec3  vGTip;
varying float vGH;
`;

// Back-light (translucency) added to the library's own physical lighting chunk,
// diffuse only. directLight.color already carries the shadow term, so grass in
// shadow does not glow.
const GRASS_BACKLIGHT_ANCHOR = "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );";
function grassPhysicalParsChunk() {
  return replaceOnce(
    THREE.ShaderChunk.lights_physical_pars_fragment,
    GRASS_BACKLIGHT_ANCHOR,
    `${GRASS_BACKLIGHT_ANCHOR}
	reflectedLight.directDiffuse += pow( saturate( dot( geometryViewDir, -directLight.direction ) ), 4.0 ) * uGTranslucency * smoothstep( 0.15, 1.0, vGH ) * directLight.color * BRDF_Lambert( material.diffuseColor );`,
    "RE_Direct_Physical diffuse line",
  );
}

const GRASS_FRAGMENT_MAP = /* glsl */ `
  vec4 gTex = texture2D( uGAtlas, vGUv );
  if ( gTex.a < 0.5 ) discard;
  vec3 gCol = mix( vGRoot, vGTip, smoothstep( 0.0, 0.8, vGH ) );
  diffuseColor.rgb = gCol * gTex.rgb * uGAtlasGain * mix( uGRootAO, 1.0, smoothstep( 0.0, 0.6, vGH ) );
`;

function replaceOnce(src, find, repl, label) {
  if (!src.includes(find)) throw new Error(`[SanctuaryGrass] shader anchor missing: ${label}`);
  return src.replace(find, repl);
}

function makeMaterial(shared, ring) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0.0 });
  mat.name = "sanctuary_grass_material";
  const uniforms = {
    uGHeight: { value: shared.hTex },
    uGColor: { value: shared.cTex },
    uGMask: { value: shared.maskTex },
    uGAtlas: { value: shared.atlas },
    uGRect: { value: shared.rect },
    uGGridUV: { value: new THREE.Vector2((shared.n - 1) / shared.n, 0.5 / shared.n) },
    uGTime: shared.time,            // shared object: one write per frame drives both rings
    uGPlayer: shared.player,
    uGWindDir: { value: WIND_DIR },
    uGWindAmp: { value: WIND_AMP },
    uGSpacing: { value: ring.spacing },
    uGOrigin: { value: new THREE.Vector2(0, 0) },
    uGCols: { value: ring.grid },
    uGCard: { value: new THREE.Vector2(ring.card[0], ring.card[1]) },
    uGDitherIn: { value: new THREE.Vector2(...ring.ditherIn) },
    uGDitherOut: { value: new THREE.Vector2(...ring.ditherOut) },
    uGHeightOut: { value: new THREE.Vector2(...ring.heightOut) },
    uGThinStart: { value: ring.thinStart },
    uGAlbedo: { value: shared.albedo },
    uGLean: { value: 0.55 },
    uGAtlasGain: { value: shared.atlasGain },
    uGRootAO: { value: 0.86 },
    uGTranslucency: { value: 0.55 },
  };
  mat.userData.grassUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    let vs = shader.vertexShader;
    vs = replaceOnce(vs, "#include <common>", `#include <common>\n${GRASS_VERTEX_PARS}`, "vs common");
    vs = replaceOnce(vs, "#include <beginnormal_vertex>", GRASS_VERTEX_MAIN, "beginnormal_vertex");
    vs = replaceOnce(vs, "#include <begin_vertex>", "vec3 transformed = gPos;", "begin_vertex");
    shader.vertexShader = vs;
    let fs = shader.fragmentShader;
    fs = replaceOnce(fs, "#include <common>", `#include <common>\n${GRASS_FRAGMENT_PARS}`, "fs common");
    fs = replaceOnce(fs, "#include <lights_physical_pars_fragment>", grassPhysicalParsChunk(), "lights_physical_pars_fragment");
    fs = replaceOnce(fs, "#include <map_fragment>", GRASS_FRAGMENT_MAP, "map_fragment");
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => "sanctuary-grass-v2";
  return mat;
}

// ── Per-render window: only the world-aligned cells the camera can see ──
// Cells stay locked to the world grid, so nothing swims or pops; cells
// outside the view are simply not submitted. Steep (village) views and
// non-perspective cameras get the full ring (vertex thinning handles them).
const _fwd = new THREE.Vector3();
function updateRingWindow(mesh, ring, camera) {
  const u = mesh.material.userData.grassUniforms;
  const geo = mesh.geometry;
  const s = ring.spacing, N = ring.grid;
  const e = camera.matrixWorld.elements;
  const cx = e[12], cz = e[14];
  const half = Math.floor(N / 2);
  const fullX0 = Math.floor(cx / s) - half, fullZ0 = Math.floor(cz / s) - half;
  let x0 = fullX0, z0 = fullZ0, x1 = fullX0 + N - 1, z1 = fullZ0 + N - 1;
  _fwd.set(-e[8], -e[9], -e[10]).normalize();
  const pitch = Math.asin(Math.max(-1, Math.min(1, _fwd.y)));
  if (camera.isPerspectiveCamera && pitch > -0.9) {
    const vHalf = THREE.MathUtils.degToRad(camera.fov) * 0.5;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect) + 0.3;
    if (hHalf < Math.PI * 0.5) {
      const yaw = Math.atan2(_fwd.z, _fwd.x);
      const R = N * s * 0.5;
      let ax0 = cx - 3, ax1 = cx + 3, az0 = cz - 3, az1 = cz + 3;
      for (let k = 0; k <= 8; k++) {
        const a = yaw - hHalf + (k / 8) * 2 * hHalf;
        const px = cx + Math.cos(a) * R, pz = cz + Math.sin(a) * R;
        if (px < ax0) ax0 = px; if (px > ax1) ax1 = px;
        if (pz < az0) az0 = pz; if (pz > az1) az1 = pz;
      }
      x0 = Math.max(x0, Math.floor(ax0 / s) - 2); x1 = Math.min(x1, Math.floor(ax1 / s) + 2);
      z0 = Math.max(z0, Math.floor(az0 / s) - 2); z1 = Math.min(z1, Math.floor(az1 / s) + 2);
    }
  }
  const cols = Math.max(1, x1 - x0 + 1), rows = Math.max(1, z1 - z0 + 1);
  u.uGOrigin.value.set(x0, z0);
  u.uGCols.value = cols;
  geo.instanceCount = Math.min(cols * rows, N * N);
}

// ── Module ──────────────────────────────────────────────────────────────
export const SanctuaryGrassModule = {
  name: "SanctuaryGrass",

  _scene: null,
  _mainCamera: null,
  _group: null,
  _meshes: [],
  _shared: null,
  _ownClock: 0,
  _frame: 0,
  _sig: "",
  _tier: "desktop",
  _enabled: true,

  async load(scene, camera, renderer, orchestrator) {
    if (this._group) return;
    this._scene = scene;
    this._mainCamera = camera;
    if (grassDisabledByUser()) {
      console.log("%c[SanctuaryGrass] off (?grass=0 / __sanctuaryGrassOff).", "color:#9e9e9e;");
      this._installGlobal();
      return;
    }
    const terrain = scene.getObjectByName("sanctuary_terrain");
    const baked = terrain ? bakeTerrainTextures(terrain) : null;
    if (!baked) {
      console.warn("[SanctuaryGrass] terrain mesh not found or not a grid; grass skipped.");
      this._installGlobal();
      return;
    }
    this._tier = isMobileDevice(orchestrator) ? "mobile" : "desktop";
    const tier = TIERS[this._tier];
    const atlas = buildAtlas(tier.atlasCell);

    const maskData = new Uint8Array(MASK_RES * MASK_RES);
    const keep = collectKeepOuts(scene);
    bakeMask(maskData, baked.rect, keep);
    this._sig = keepOutSignature(keep);
    const maskTex = new THREE.DataTexture(maskData, MASK_RES, MASK_RES, THREE.RedFormat, THREE.UnsignedByteType);
    maskTex.minFilter = maskTex.magFilter = THREE.LinearFilter;
    maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
    maskTex.generateMipmaps = false;
    maskTex.needsUpdate = true;

    this._shared = {
      hTex: baked.hTex, cTex: baked.cTex, n: baked.n, rect: baked.rect,
      maskTex, maskData, atlas: atlas.tex, atlasGain: atlas.gain,
      albedo: meanAlbedo(terrain),
      time: { value: 0 },
      player: { value: new THREE.Vector3(0, 0, 0) },
    };

    const group = new THREE.Group();
    group.name = "sanctuary_grass";
    group.userData.anuId = "flora.sanctuary.grass";
    group.userData.anuKind = "sanctuary_grass";
    group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    this._meshes = tier.rings.map((ring, i) => {
      const count = ring.grid * ring.grid;
      const mesh = new THREE.Mesh(buildCardGeometry(count), makeMaterial(this._shared, ring));
      mesh.name = `sanctuary_grass_ring_${i}`;
      mesh.frustumCulled = false;      // the vertex shader places and culls every card
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.renderOrder = RENDER_ORDER;
      mesh.matrixAutoUpdate = false;   // world-space vertices; model matrix stays identity
      mesh.raycast = () => {};         // never picked by click-to-move / tools
      mesh.onBeforeRender = (_r, _s, cam, geo) => {
        if (cam !== this._mainCamera) { geo.instanceCount = 0; return; }   // minimap / any other camera
        updateRingWindow(mesh, ring, cam);
      };
      mesh.userData.anuKind = "sanctuary_grass_ring";
      mesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
      mesh.userData.grassInstances = count;
      group.add(mesh);
      return mesh;
    });
    scene.add(group);
    this._group = group;
    this._installGlobal();
    const inst = this._meshes.reduce((a, m) => a + m.userData.grassInstances, 0);
    console.log(
      `%c[SanctuaryGrass] 🌾 ${this._tier} meadow: ${this._meshes.length} draws, ${inst} card slots (${inst * 6} tris max), ${keep.circles.length + keep.rects.length} keep-outs.`,
      "color:#9ccc65;font-weight:bold;",
    );
  },

  update(dt) {
    if (!this._shared) return;
    // Same clock as the trees so gusts line up; fall back to our own if absent.
    const treeT = SanctuaryPondTreesModule && Number.isFinite(SanctuaryPondTreesModule._time) && SanctuaryPondTreesModule._scene
      ? SanctuaryPondTreesModule._time : null;
    this._ownClock += dt || 0;
    this._shared.time.value = treeT ?? this._ownClock;
    const av = window.__sanctuaryAvatar;
    const p = this._shared.player.value;
    if (av && av.position) p.set(av.position.x, 1, av.position.z); else p.y = 0;
    if (++this._frame % SIGNATURE_EVERY_N_FRAMES === 0) this._maybeRebake();
  },

  _maybeRebake(force = false) {
    if (!this._shared || !this._scene) return false;
    const keep = collectKeepOuts(this._scene);
    const sig = keepOutSignature(keep);
    if (!force && sig === this._sig) return false;
    bakeMask(this._shared.maskData, this._shared.rect, keep);
    this._shared.maskTex.needsUpdate = true;
    this._sig = sig;
    return true;
  },

  _stats() {
    const inst = this._meshes.reduce((a, m) => a + (m.userData.grassInstances || 0), 0);
    return {
      enabled: !!this._group && this._enabled,
      tier: this._tier,
      draws: this._meshes.length,
      cardSlots: inst,
      maxTriangles: inst * 6,
      submittedThisFrame: this._meshes.map((m) => m.geometry.instanceCount),
      keepOutSignatureLength: this._sig.length,
    };
  },

  _installGlobal() {
    const self = this;
    window.__sanctuaryGrass = {
      setEnabled(on) { self._enabled = !!on; if (self._group) self._group.visible = self._enabled; return self._enabled; },
      stats: () => self._stats(),
      rebake: () => self._maybeRebake(true),
    };
  },

  unload(scene) {
    if (this._group) {
      (scene || this._scene)?.remove(this._group);
      for (const m of this._meshes) { m.geometry.dispose(); m.material.dispose(); }
    }
    if (this._shared) {
      for (const k of ["hTex", "cTex", "maskTex", "atlas"]) this._shared[k]?.dispose?.();
    }
    this._group = null;
    this._meshes = [];
    this._shared = null;
    this._scene = null;
    this._mainCamera = null;
    this._frame = 0;
    this._sig = "";
    if (window.__sanctuaryGrass) delete window.__sanctuaryGrass;
  },
};
