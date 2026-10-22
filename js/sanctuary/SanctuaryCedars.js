/**
 * Sacred Adventures — SanctuaryCedars: procedural western red cedars.
 *
 * Mark 2026-10-22: "draw better trees, more random more cedar trees".
 *
 * Western red cedar (Thuja plicata), as children see it from the village:
 *   - a narrow conical crown with a drooping leader at the very top;
 *   - branches that sweep down and turn up at the tips (J shape), carrying flat,
 *     lacy sprays of scale leaves that hang like curtains;
 *   - a reddish-brown trunk of long fibrous bark strips, flared and fluted
 *     (buttressed) at the base.
 *
 * Each variant is ~10 m tall in model units (instances scale it), about 700
 * triangles (≈500 on phones): a trunk of 9 sides with a buttress flare, then
 * curved flat spray ribbons in whorls plus hanging pendant sprays, all drawn
 * with one procedural frond texture (alpha-tested, coverage-preserving mips,
 * like the grass) and one bark texture. Vertex colours carry the shading that
 * makes the crown read as a volume (darker toward the trunk and the bottom).
 *
 * The models are plain meshes in their rest pose; SanctuaryPondTrees instances
 * them (wind, sectors, minimap layer) and SanctuaryImpostors bakes their cards.
 */

import * as THREE from "three";

import { coveragePreservingMips, dataTextureWithMips } from "./SanctuaryImpostors.js";

export const CEDAR_VARIANTS = 3;
export const CEDAR_MODEL_HEIGHT_M = 10;

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

// ── Textures ─────────────────────────────────────────────────────────────
/** One flat cedar spray, base at the bottom of the canvas, tip at the top. */
function drawFrond(size, seed) {
  const rand = lcg(seed);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.clearRect(0, 0, size, size);
  const S = size / 256;
  const greens = ["#2c4a1c", "#35561f", "#3f6224", "#4a6e2a", "#577a30", "#66883a"];
  const tips = ["#7d9a42", "#8aa64b", "#728f3c"];
  // Outline of the spray: widest a little below the middle, pointed tip.
  const halfWidthAt = (t) => (0.46 * Math.sin(Math.PI * Math.min(1, t * 1.08)) * (1 - 0.35 * t) + 0.02) * size;
  const axisX = (t) => size * (0.5 + 0.035 * Math.sin(t * 3.1 + 0.6));
  const yOf = (t) => size * (1 - t);

  // Scale-leaf "segments": short overlapping rounded strokes along a branchlet.
  function branchlet(x0, y0, x1, y1, w, depth) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(3, Math.round(len / (3.2 * S)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const ww = w * (1 - 0.55 * t);
      g.fillStyle = t > 0.78 ? tips[(rand() * tips.length) | 0] : greens[(rand() * greens.length) | 0];
      g.beginPath();
      g.ellipse(x, y, ww, ww * 1.45, Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2, 0, Math.PI * 2);
      g.fill();
    }
    if (depth > 0) {
      const subs = Math.max(2, Math.round(len / (14 * S)));
      for (let k = 1; k <= subs; k++) {
        const t = k / (subs + 1);
        const bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t;
        const ang = Math.atan2(y1 - y0, x1 - x0);
        const side = k % 2 ? 1 : -1;
        const a = ang + side * (0.75 + rand() * 0.25);
        const l = len * (0.34 - 0.18 * t) * (0.8 + rand() * 0.4);
        branchlet(bx, by, bx + Math.cos(a) * l, by + Math.sin(a) * l, w * 0.72, depth - 1);
      }
    }
  }

  // A solid body first, so the spray reads as one dense plate of foliage (not a net),
  // with a ragged edge; the scale-leaf branchlets are drawn over it.
  g.fillStyle = "#33521f";
  g.beginPath();
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const jag = 0.78 + 0.22 * Math.sin(i * 2.7 + 1.1) * Math.sin(i * 1.3);
    const x = axisX(t) - halfWidthAt(t) * 0.82 * jag;
    if (i) g.lineTo(x, yOf(t)); else g.moveTo(x, yOf(t));
  }
  for (let i = N; i >= 0; i--) {
    const t = i / N;
    const jag = 0.78 + 0.22 * Math.sin(i * 3.1 + 0.4) * Math.sin(i * 1.7);
    g.lineTo(axisX(t) + halfWidthAt(t) * 0.82 * jag, yOf(t));
  }
  g.closePath();
  g.fill();
  // Rachis (main stem of the spray).
  g.strokeStyle = "#5a4a2a";
  g.lineWidth = 2.2 * S;
  g.beginPath();
  for (let i = 0; i <= 20; i++) { const t = i / 20; if (i) g.lineTo(axisX(t), yOf(t)); else g.moveTo(axisX(t), yOf(t)); }
  g.stroke();
  // Alternating branchlets toward the tip, sized to the outline.
  const pairs = 11;
  for (let k = 0; k < pairs * 2; k++) {
    const t = 0.04 + (k / (pairs * 2)) * 0.9;
    const side = k % 2 ? 1 : -1;
    const x = axisX(t), y = yOf(t);
    const hw = halfWidthAt(t + 0.06);
    const a = -Math.PI / 2 + side * (0.95 + rand() * 0.15);     // up-and-out, toward the tip
    const l = hw / Math.max(0.35, Math.abs(Math.cos(a)));   // horizontal reach = the outline
    branchlet(x, y, x + Math.cos(a) * l * 0.98, y + Math.sin(a) * l * 0.98, 3.7 * S, 1);
  }
  branchlet(axisX(0.9), yOf(0.9), axisX(1), yOf(1) + 2 * S, 2.8 * S, 0);
  return c;
}

function canvasToCoverageTexture(canvas) {
  const w = canvas.width, h = canvas.height;
  const img = canvas.getContext("2d").getImageData(0, 0, w, h).data;
  // Flip rows: canvas row 0 is the top; texture row 0 is v = 0 (the spray's base).
  const level0 = new Uint8Array(w * h * 4);
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < img.length; i += 4) if (img[i + 3] >= 128) { sr += img[i]; sg += img[i + 1]; sb += img[i + 2]; n++; }
  const fill = n ? [sr / n, sg / n, sb / n].map(Math.round) : [60, 90, 40];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((h - 1 - y) * w + x) * 4, d = (y * w + x) * 4;
      const a = img[s + 3] >= 128 ? 255 : 0;
      level0[d] = a ? img[s] : fill[0];
      level0[d + 1] = a ? img[s + 1] : fill[1];
      level0[d + 2] = a ? img[s + 2] : fill[2];
      level0[d + 3] = a;
    }
  }
  canvas.width = canvas.height = 0;
  return dataTextureWithMips(coveragePreservingMips(level0, w, h), THREE.SRGBColorSpace);
}

function drawBark(w, h, seed) {
  const rand = lcg(seed);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#6a3b27";
  g.fillRect(0, 0, w, h);
  const strips = ["#7d4630", "#5a301f", "#8e5a3d", "#4a2718", "#9a6a4a", "#6f3f2a"];
  // Long vertical fibrous strips, slightly wavy; they wrap seamlessly in u.
  for (let i = 0; i < w * 1.6; i++) {
    const x0 = rand() * w, sw = 0.8 + rand() * 2.6;
    g.strokeStyle = strips[(rand() * strips.length) | 0];
    g.globalAlpha = 0.55 + rand() * 0.45;
    g.lineWidth = sw;
    g.beginPath();
    const ph = rand() * 6.28, amp = 0.6 + rand() * 1.4;
    for (let y = 0; y <= h; y += 8) {
      const x = x0 + Math.sin(y * 0.03 + ph) * amp;
      if (y === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  // Deep fissures between ridges.
  g.globalAlpha = 0.7;
  g.strokeStyle = "#2e170d";
  for (let i = 0; i < w / 6; i++) {
    const x0 = rand() * w;
    g.lineWidth = 0.6 + rand();
    g.beginPath();
    g.moveTo(x0, 0);
    for (let y = 0; y <= h; y += 10) g.lineTo(x0 + Math.sin(y * 0.05 + i) * 1.2, y);
    g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export function buildCedarMaterials({ mobile = false } = {}) {
  const frondTex = canvasToCoverageTexture(drawFrond(mobile ? 128 : 256, 7));
  frondTex.name = "sanctuary_cedar_frond";
  const barkTex = drawBark(mobile ? 64 : 128, mobile ? 128 : 256, 11);
  barkTex.name = "sanctuary_cedar_bark";
  const foliage = new THREE.MeshStandardMaterial({
    map: frondTex, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true,
    roughness: 0.82, metalness: 0.0,
  });
  foliage.name = "sanctuary_cedar_foliage";
  const trunk = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95, metalness: 0.0 });
  trunk.name = "sanctuary_cedar_bark";
  return { foliage, trunk, textures: [frondTex, barkTex] };
}

// ── Geometry ─────────────────────────────────────────────────────────────
function trunkGeometry(H, r0, rand) {
  const RS = 9;
  const fr = [0, 0.012, 0.03, 0.06, 0.1, 0.16, 0.26, 0.38, 0.52, 0.68, 0.84, 0.97];
  const phase = rand() * Math.PI * 2;
  const pos = [], nrm = [], uv = [], idx = [];
  fr.forEach((f, k) => {
    const h = f * H;
    const taper = Math.pow(Math.max(0.02, 1 - 0.95 * f), 1.15);
    const flare = 1 + 0.95 * Math.exp(-h / (0.055 * H));            // buttress at the base
    const r = r0 * taper * flare;
    for (let j = 0; j <= RS; j++) {
      const th = (j / RS) * Math.PI * 2;
      const flute = 1 + 0.16 * Math.exp(-h / (0.09 * H)) * Math.sin(5 * th + phase);
      const rr = r * flute;
      pos.push(Math.cos(th) * rr, h, Math.sin(th) * rr);
      const n = new THREE.Vector3(Math.cos(th), 0.18, Math.sin(th)).normalize();
      nrm.push(n.x, n.y, n.z);
      uv.push((j / RS) * 2, h / 2.4);
    }
    if (k > 0) {
      const a = (k - 1) * (RS + 1), b = k * (RS + 1);
      for (let j = 0; j < RS; j++) idx.push(a + j, b + j, a + j + 1, a + j + 1, b + j, b + j + 1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function foliageGeometry(H, opts, rand) {
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  const crownBase = H * opts.crownBase;
  const crownR = H * opts.crownRadius;
  const v = new THREE.Vector3(), side = new THREE.Vector3(), n = new THREE.Vector3(), out = new THREE.Vector3();

  function vert(p, nx, ny, nz, u, vv, shade, hue) {
    pos.push(p.x, p.y, p.z);
    nrm.push(nx, ny, nz);
    uv.push(u, vv);
    col.push(shade * (0.94 + 0.08 * hue), shade, shade * (0.9 + 0.06 * (1 - hue)));
  }

  /** A curved flat spray from the trunk outward: rows of (left, right) vertices. */
  function spray(h0, ang, L, W, droop, upturn, roll, shadeBase, hue) {
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const sx = -dz * Math.cos(roll), sy = Math.sin(roll), sz = dx * Math.cos(roll);
    side.set(sx, sy, sz);
    const rows = 4, base = pos.length / 3;
    for (let i = 0; i < rows; i++) {
      const u = i / (rows - 1);
      const reach = 0.12 + L * u;
      const y = h0 - droop * L * u * u + upturn * L * Math.max(0, u - 0.65) * 0.9;
      v.set(dx * reach, y, dz * reach);
      const w = W * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, 0.25 + u)));
      // Normal: the spray plane's up side, bent outward from the trunk so the crown
      // shades as one soft volume rather than as separate flat cards.
      n.set(dx, 0, dz).cross(side).normalize();
      if (n.y < 0) n.negate();
      out.set(dx, 0.35, dz).normalize();
      n.multiplyScalar(0.45).addScaledVector(out, 0.75).normalize();
      const shade = shadeBase * (0.72 + 0.28 * u);
      const l = v.clone().addScaledVector(side, -w / 2), r = v.clone().addScaledVector(side, w / 2);
      vert(l, n.x, n.y, n.z, 0, u, shade, hue);
      vert(r, n.x, n.y, n.z, 1, u, shade, hue);
    }
    for (let i = 0; i < rows - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  /** A pendant spray hanging from the outer half of a branch (the cedar "curtain"). */
  function pendant(h0, ang, reach, len, W, shadeBase, hue) {
    const dx = Math.cos(ang), dz = Math.sin(ang);
    side.set(-dz, 0, dx);
    const rows = 3, base = pos.length / 3;
    out.set(dx, 0.1, dz).normalize();
    for (let i = 0; i < rows; i++) {
      const u = i / (rows - 1);                       // 0 = attached (spray base), 1 = hanging tip
      v.set(dx * (reach + 0.12 * u), h0 - len * u, dz * (reach + 0.12 * u));
      const w = W * (1 - 0.35 * u);
      const shade = shadeBase * (0.8 + 0.2 * (1 - u));
      const l = v.clone().addScaledVector(side, -w / 2), r = v.clone().addScaledVector(side, w / 2);
      vert(l, out.x, out.y, out.z, 0, u, shade, hue);
      vert(r, out.x, out.y, out.z, 1, u, shade, hue);
    }
    for (let i = 0; i < rows - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const layers = opts.layers;
  for (let k = 0; k < layers; k++) {
    const t = k / (layers - 1);
    const h = crownBase + (H * 0.94 - crownBase) * Math.pow(t, 0.92);
    const R = crownR * Math.pow(1 - t, 0.82) * (0.88 + 0.24 * rand()) + 0.35;
    const count = Math.max(4, Math.round(8 - 3.2 * t + rand() * 0.8));
    const phase = rand() * Math.PI * 2;
    for (let s = 0; s < count; s++) {
      const ang = phase + (s / count) * Math.PI * 2 + (rand() - 0.5) * 0.7;
      const L = R * (0.78 + 0.32 * rand());
      const W = L * (0.72 + 0.25 * rand()) + 0.25;
      const droop = (0.34 + 0.22 * rand()) * (1 - 0.45 * t);
      const upturn = 0.18 + 0.2 * rand();
      const roll = (rand() - 0.5) * 0.7;
      const shade = 0.5 + 0.5 * Math.pow(t, 0.7) + 0.08 * (rand() - 0.5);
      const hue = rand();
      spray(h + (rand() - 0.5) * 0.25, ang, L, W, droop, upturn, roll, shade, hue);
      if (L > 0.9 && rand() < opts.pendants) {
        const reach = 0.12 + L * (0.55 + 0.25 * rand());
        const yAt = h - droop * L * 0.36;
        pendant(yAt, ang + (rand() - 0.5) * 0.3, reach, 0.45 + 0.6 * rand() * (1 - t), W * 0.6, shade * 0.95, hue);
      }
    }
  }
  // The drooping leader at the very top.
  spray(H * 0.95, rand() * Math.PI * 2, 0.95, 0.5, -0.25, -0.6, 0, 1.0, rand());

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

const VARIANT_SHAPES = [
  { crownBase: 0.16, crownRadius: 0.27, trunk: 0.032 },   // classic narrow cone
  { crownBase: 0.24, crownRadius: 0.31, trunk: 0.036 },   // older, broader, higher crown base
  { crownBase: 0.1, crownRadius: 0.23, trunk: 0.028 },    // young, slender, low branches
];

/**
 * @returns {THREE.Group} a cedar in its rest pose: origin at the trunk base, ~10 m tall,
 *          children "cedar_trunk" and "cedar_foliage" (materials shared).
 */
export function buildCedarModel(variant, materials, { mobile = false } = {}) {
  const shape = VARIANT_SHAPES[variant % VARIANT_SHAPES.length];
  const rand = lcg(4100 + variant * 977);
  const H = CEDAR_MODEL_HEIGHT_M;
  const group = new THREE.Group();
  group.name = `sanctuary_cedar_model_${variant}`;
  const trunk = new THREE.Mesh(trunkGeometry(H, H * shape.trunk, rand), materials.trunk);
  trunk.name = "cedar_trunk";
  const foliage = new THREE.Mesh(
    foliageGeometry(H, { ...shape, layers: mobile ? 12 : 18, pendants: mobile ? 0.55 : 0.85 }, rand),
    materials.foliage,
  );
  foliage.name = "cedar_foliage";
  group.add(trunk, foliage);
  return group;
}
