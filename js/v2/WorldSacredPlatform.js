/**
 * Sacred Adventures v2 — procedural wooden platform.
 *
 * Single factory `createSacredCirclePlatform({...})` that builds the
 * stylized-realism wooden circle every sacred building now sits on:
 *
 *   • Deck (radial hand-hewn planks with grain + knots).
 *   • Vertical log posts spaced evenly around the rim.
 *   • Stacked horizontal log rails between each pair of posts (two
 *     courses high) — the "interlocked outer ring".
 *   • Rope lashings wrapping every post at each course joint.
 *   • A 2-step set of timber treads centered on `stepFacingRad` so the
 *     player approaches and steps UP onto the deck rather than clipping
 *     through the rim.
 *
 * Materials are PBR-style `MeshStandardMaterial` driven by procedural
 * canvas textures (albedo + bump) — no external asset fetch. Three
 * materials are shared across every platform via module-scope caches so
 * the second/third call is essentially free.
 *
 * Replaces the legacy two-piece build (green grass deck +
 * `createSacredCircleGoldTrim` log border + wildflowers) for tipis 1,
 * 2, and any Player's Tipi the Village Builder spawns.
 *
 * Public return value:
 *   {
 *     platMesh,   // central deck Mesh — caller reads .position to align
 *                 // the tipi GLB. `position.y + height/2` = deck top.
 *     group,      // ALL ancillary structure (posts, rails, rope, steps)
 *                 // — pre-added to the scene; caller doesn't need to.
 *     deckTopY,   // world-Y of the plank surface.
 *   }
 */

import * as THREE from "three";
import { V2_TIPI_SACRED_PLATFORM_CENTER_Y } from "./constants.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import { ANU_INTERACTION_VERB } from "./anu/SimulationController.js";

// ── Cached procedural materials (built lazily on first call) ──────────
/** @type {THREE.Material[] | null} — [side, top, bottom] for the deck cylinder. */
let _cachedDeckMaterials = null;
/** @type {THREE.Material | null} — shared for vertical posts + horizontal rails + steps. */
let _cachedTimberMaterial = null;
/** @type {THREE.Material | null} — shared for every rope lashing torus. */
let _cachedRopeMaterial = null;

/**
 * Radial-plank deck texture: 12 wedge-shaped planks running from center to rim,
 * each with its own slight hue offset + along-grain striations + a few knots.
 * Returns [side, topAndBottom] materials so CylinderGeometry's group slots get
 * the right surface — the rim side is a darker end-grain band, the top is the
 * planks proper.
 */
function buildDeckMaterials() {
  if (_cachedDeckMaterials) return _cachedDeckMaterials;
  const SIZE = 1024;

  // ── Top (radial planks) ──────────────────────────────────────────────
  const topC = document.createElement("canvas");
  topC.width = topC.height = SIZE;
  const tc = topC.getContext("2d");

  // Base warm-tan wood field.
  tc.fillStyle = "#8a6336";
  tc.fillRect(0, 0, SIZE, SIZE);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const R = SIZE / 2 - 4;
  const PLANK_COUNT = 14;
  const TWO_PI = Math.PI * 2;

  // Per-plank wedge fills with a slight hue jitter, drawn as triangular sectors.
  for (let i = 0; i < PLANK_COUNT; i++) {
    const a0 = (i / PLANK_COUNT) * TWO_PI;
    const a1 = ((i + 1) / PLANK_COUNT) * TWO_PI;
    const hueShift = (Math.random() - 0.5) * 18;
    const valShift = (Math.random() - 0.5) * 28;
    // Convert HSL-ish jitter to a hex by varying base RGB directly.
    const baseR = 138 + valShift;
    const baseG = 99  + valShift * 0.85 + hueShift * 0.15;
    const baseB = 54  + valShift * 0.6  - hueShift * 0.15;
    tc.fillStyle = `rgb(${Math.round(baseR)}, ${Math.round(baseG)}, ${Math.round(baseB)})`;
    tc.beginPath();
    tc.moveTo(cx, cy);
    tc.arc(cx, cy, R, a0, a1);
    tc.closePath();
    tc.fill();
  }

  // Wood-grain striations: short arcs at varying radii, along the planks.
  for (let i = 0; i < 1800; i++) {
    const ang = Math.random() * TWO_PI;
    const r = 30 + Math.random() * (R - 40);
    const len = 0.04 + Math.random() * 0.18; // radians
    const dark = Math.random() < 0.65;
    tc.strokeStyle = dark
      ? `rgba(48, 28, 14, ${0.10 + Math.random() * 0.22})`
      : `rgba(214, 178, 122, ${0.06 + Math.random() * 0.14})`;
    tc.lineWidth = 0.5 + Math.random() * 1.4;
    tc.beginPath();
    tc.arc(cx, cy, r, ang, ang + len);
    tc.stroke();
  }

  // Plank seams: 14 thin dark radial lines marking plank edges.
  for (let i = 0; i < PLANK_COUNT; i++) {
    const a = (i / PLANK_COUNT) * TWO_PI;
    tc.strokeStyle = "rgba(20, 12, 6, 0.62)";
    tc.lineWidth = 2.2;
    tc.beginPath();
    tc.moveTo(cx, cy);
    tc.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    tc.stroke();
  }

  // A handful of knots — dark concentric rings.
  for (let i = 0; i < 14; i++) {
    const ang = Math.random() * TWO_PI;
    const r = 80 + Math.random() * (R - 100);
    const kx = cx + Math.cos(ang) * r;
    const ky = cy + Math.sin(ang) * r;
    const kr = 8 + Math.random() * 14;
    const g = tc.createRadialGradient(kx, ky, 1, kx, ky, kr);
    g.addColorStop(0.0, "rgba(20, 10, 4, 0.95)");
    g.addColorStop(0.5, "rgba(56, 32, 14, 0.55)");
    g.addColorStop(1.0, "rgba(56, 32, 14, 0)");
    tc.fillStyle = g;
    tc.beginPath();
    tc.ellipse(kx, ky, kr * 1.05, kr * 0.82, Math.random() * Math.PI, 0, TWO_PI);
    tc.fill();
  }

  // Soft ambient occlusion ring near the rim so the deck reads as recessed
  // inside the log rail.
  const ao = tc.createRadialGradient(cx, cy, R * 0.78, cx, cy, R);
  ao.addColorStop(0.0, "rgba(0, 0, 0, 0)");
  ao.addColorStop(1.0, "rgba(0, 0, 0, 0.42)");
  tc.fillStyle = ao;
  tc.beginPath();
  tc.arc(cx, cy, R, 0, TWO_PI);
  tc.fill();

  const topTex = new THREE.CanvasTexture(topC);
  topTex.colorSpace = THREE.SRGBColorSpace;
  topTex.anisotropy = 4;
  topTex.needsUpdate = true;

  // ── Side (end-grain band) ────────────────────────────────────────────
  const sideC = document.createElement("canvas");
  sideC.width = 512;
  sideC.height = 64;
  const sc = sideC.getContext("2d");
  const sGrad = sc.createLinearGradient(0, 0, 0, 64);
  sGrad.addColorStop(0.0, "#5a3b1c");
  sGrad.addColorStop(0.5, "#6b4622");
  sGrad.addColorStop(1.0, "#3e2a14");
  sc.fillStyle = sGrad;
  sc.fillRect(0, 0, 512, 64);
  // Horizontal grain striations.
  for (let i = 0; i < 240; i++) {
    sc.strokeStyle = `rgba(28, 16, 8, ${0.08 + Math.random() * 0.18})`;
    sc.lineWidth = 0.4 + Math.random() * 1.0;
    const y = Math.random() * 64;
    sc.beginPath();
    sc.moveTo(0, y);
    sc.lineTo(512, y + (Math.random() - 0.5) * 4);
    sc.stroke();
  }
  const sideTex = new THREE.CanvasTexture(sideC);
  sideTex.colorSpace = THREE.SRGBColorSpace;
  sideTex.wrapS = THREE.RepeatWrapping;
  sideTex.repeat.set(4, 1);
  sideTex.needsUpdate = true;

  const topMat = new THREE.MeshStandardMaterial({
    map: topTex,
    roughness: 0.86,
    metalness: 0.0,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    map: sideTex,
    roughness: 0.92,
    metalness: 0.0,
  });
  const bottomMat = new THREE.MeshStandardMaterial({
    color: 0x2d1f10,
    roughness: 0.98,
    metalness: 0.0,
  });
  // CylinderGeometry group order: [side, top, bottom].
  _cachedDeckMaterials = [sideMat, topMat, bottomMat];
  return _cachedDeckMaterials;
}

/** Bark / timber log material — used by posts, rails, and steps. */
function buildTimberMaterial() {
  if (_cachedTimberMaterial) return _cachedTimberMaterial;
  const W = 256;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  // Walnut → oak vertical gradient.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0.0, "#553617");
  g.addColorStop(0.4, "#6a4a25");
  g.addColorStop(1.0, "#3c2810");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // Vertical bark fibres (length-wise).
  for (let i = 0; i < 220; i++) {
    const x = Math.random() * W;
    const yStart = Math.random() * H * 0.4;
    const len = 60 + Math.random() * (H - 60);
    const dark = Math.random() < 0.6;
    ctx.strokeStyle = dark
      ? `rgba(20, 12, 6, ${0.15 + Math.random() * 0.32})`
      : `rgba(190, 144, 88, ${0.08 + Math.random() * 0.16})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.4;
    ctx.beginPath();
    ctx.moveTo(x, yStart);
    ctx.quadraticCurveTo(
      x + (Math.random() - 0.5) * 6,
      yStart + len * 0.5,
      x + (Math.random() - 0.5) * 4,
      yStart + len,
    );
    ctx.stroke();
  }
  // Knots.
  for (let i = 0; i < 5; i++) {
    const kx = Math.random() * W;
    const ky = Math.random() * H;
    const kr = 6 + Math.random() * 12;
    const kg = ctx.createRadialGradient(kx, ky, 1, kx, ky, kr);
    kg.addColorStop(0.0, "rgba(15, 8, 3, 0.95)");
    kg.addColorStop(1.0, "rgba(50, 28, 12, 0)");
    ctx.fillStyle = kg;
    ctx.beginPath();
    ctx.ellipse(kx, ky, kr * 1.1, kr * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  tex.anisotropy = 4;
  tex.needsUpdate = true;

  _cachedTimberMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex,
    roughness: 0.9,
    metalness: 0.0,
    flatShading: false,
  });
  return _cachedTimberMaterial;
}

/** Twisted-fibre rope material for lashings. */
function buildRopeMaterial() {
  if (_cachedRopeMaterial) return _cachedRopeMaterial;
  const W = 128;
  const H = 64;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#a8825a";
  ctx.fillRect(0, 0, W, H);
  // Diagonal twist striations: alternating light/dark slashes.
  const step = 6;
  for (let x = -H; x < W + H; x += step) {
    ctx.strokeStyle = Math.random() < 0.5
      ? "rgba(60, 38, 18, 0.55)"
      : "rgba(220, 188, 130, 0.45)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + H, H);
    ctx.stroke();
  }
  // Sparse frayed bits.
  for (let i = 0; i < 40; i++) {
    ctx.strokeStyle = "rgba(30, 18, 6, 0.35)";
    ctx.lineWidth = 0.6;
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1);
  tex.needsUpdate = true;
  _cachedRopeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex,
    roughness: 0.95,
    metalness: 0.0,
  });
  return _cachedRopeMaterial;
}

/**
 * @typedef {object} SacredPlatformOptions
 * @property {THREE.Scene} scene
 * @property {unknown[]} objects — pushed for World's generic unload sweep.
 * @property {number} centerX
 * @property {number} centerZ
 * @property {number} terrainAtCenter — world Y of the ground under the deck.
 * @property {number} radius
 * @property {number} height — deck thickness (vertical cylinder height).
 * @property {string} key — id slug, e.g. "tipi_1", "tipi_2", "tipi_player_3".
 * @property {number} [stepFacingRad=0] — world-Y angle the steps face (0 = +Z = south).
 * @property {number} [postCount=12] — number of vertical posts around the rim.
 */

/** @param {SacredPlatformOptions} opts */
export function createSacredCirclePlatform(opts) {
  const {
    scene,
    objects,
    centerX,
    centerZ,
    terrainAtCenter,
    radius,
    height,
    key,
    stepFacingRad = 0,
    postCount = 12,
  } = opts;

  const platCenterY = terrainAtCenter + height / 2 + V2_TIPI_SACRED_PLATFORM_CENTER_Y;
  const deckTopY = platCenterY + height / 2;

  // ── Deck cylinder ────────────────────────────────────────────────────
  const deckGeo = new THREE.CylinderGeometry(
    radius,
    radius + 0.15,
    height,
    96,
  );
  const platMesh = new THREE.Mesh(deckGeo, buildDeckMaterials());
  platMesh.name = "structure_" + key + "_sacred_platform";
  platMesh.position.set(centerX, platCenterY, centerZ);
  platMesh.castShadow = false;
  platMesh.receiveShadow = true;
  platMesh.userData.anuId = "structure." + key + ".sacred_platform";
  platMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  platMesh.userData.anuKind = "tipi_sacred_circle_platform";
  platMesh.userData.anuInteractable = true;
  platMesh.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
  scene.add(platMesh);
  objects.push(platMesh);

  // ── Ancillary structure: posts, rails, rope, steps ───────────────────
  const group = new THREE.Group();
  group.name = "structure_" + key + "_sacred_platform_woodwork";
  group.userData.anuId = "structure." + key + ".sacred_platform.woodwork";
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  group.userData.anuKind = "tipi_sacred_circle_woodwork";

  const timberMat = buildTimberMaterial();
  const ropeMat = buildRopeMaterial();

  // Rim woodwork — May-13 2026 user pass: log border height −75 % (0.32 → 0.08 m)
  // so the deck reads low like village dirt, not a fence.
  const POST_R = 0.11;
  const POST_HEIGHT = 0.08;
  const RAIL_R = 0.085;
  const RAIL_COURSES = 2;
  const RAIL_VERTICAL_GAP = POST_HEIGHT / (RAIL_COURSES + 1);
  const ROPE_TUBE_R = 0.04;
  const ROPE_RING_R = POST_R + 0.035;

  // Post ring radius — just inside the deck's outer edge so posts cap the rim.
  const postRingRadius = radius + 0.02;
  const angleStep = (Math.PI * 2) / postCount;

  /**
   * Stairway gap (May-14 2026 user fix: "there should be a front stairway
   * so players can approach the front of the tipi"). The post at index
   * `gapPostIdx` and the rails immediately adjacent (chord midpoints
   * `gapPostIdx - 1` and `gapPostIdx`) are skipped, leaving a clear
   * opening centred on `stepFacingRad`. The wooden treads then bridge
   * this opening so the player walks straight up from the grass onto the
   * deck instead of hopping the rail.
   */
  const gapPostIdx = Math.round(stepFacingRad / angleStep);
  const gapPostIdxMod = ((gapPostIdx % postCount) + postCount) % postCount;
  const railSkipIdxA = ((gapPostIdxMod - 1) % postCount + postCount) % postCount;
  const railSkipIdxB = gapPostIdxMod;
  const isPostInGap = (i) => i === gapPostIdxMod;
  const isRailInGap = (i) => i === railSkipIdxA || i === railSkipIdxB;

  // ── Vertical posts (InstancedMesh) ──────────────────────────────────
  const postGeo = new THREE.CylinderGeometry(
    POST_R,
    POST_R * 0.92,
    POST_HEIGHT,
    14,
    1,
    false,
  );
  const posts = new THREE.InstancedMesh(postGeo, timberMat, postCount);
  posts.name = "structure_" + key + "_sacred_platform_posts";
  posts.castShadow = true;
  posts.receiveShadow = true;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < postCount; i++) {
    if (isPostInGap(i)) {
      // Stairway gap: collapse the post at the entry. InstancedMesh has no
      // "skip" — scale 0 hides it without disturbing the per-instance count.
      dummy.scale.setScalar(0);
      dummy.position.set(0, -1000, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(i, dummy.matrix);
      continue;
    }
    const a = i * angleStep;
    dummy.position.set(
      centerX + postRingRadius * Math.cos(a),
      deckTopY + POST_HEIGHT / 2,
      centerZ + postRingRadius * Math.sin(a),
    );
    dummy.rotation.set(0, -a, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);

  // ── Horizontal rails (two stacked courses) ──────────────────────────
  // Each rail spans the chord between adjacent posts and sits between them.
  // Two courses give the "interlocked outer ring" look without a heavy
  // log-cabin pile.
  const chord = 2 * Math.sin(angleStep / 2) * postRingRadius;
  const railLen = chord * 1.04; // slight overlap so joints aren't gappy
  const railGeo = new THREE.CylinderGeometry(
    RAIL_R,
    RAIL_R * 0.97,
    railLen,
    12,
    1,
    false,
  );
  // Axis along +Z so mesh.rotation.y aligns with the tangent.
  railGeo.rotateX(Math.PI / 2);
  const railCount = postCount * RAIL_COURSES;
  const rails = new THREE.InstancedMesh(railGeo, timberMat, railCount);
  rails.name = "structure_" + key + "_sacred_platform_rails";
  rails.castShadow = true;
  rails.receiveShadow = true;
  let r = 0;
  for (let course = 1; course <= RAIL_COURSES; course++) {
    const railY = deckTopY + RAIL_VERTICAL_GAP * course;
    for (let i = 0; i < postCount; i++) {
      if (isRailInGap(i)) {
        // Stairway gap: omit the two rail segments framing the missing
        // post so the opening is a clean walk-through.
        dummy.scale.setScalar(0);
        dummy.position.set(0, -1000, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        rails.setMatrixAt(r++, dummy.matrix);
        continue;
      }
      // Center of the chord between post i and post i+1.
      const a = (i + 0.5) * angleStep;
      dummy.position.set(
        centerX + postRingRadius * Math.cos(a),
        railY,
        centerZ + postRingRadius * Math.sin(a),
      );
      // Tangent direction = perpendicular to radial.
      dummy.rotation.set(0, -a, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      rails.setMatrixAt(r++, dummy.matrix);
    }
  }
  rails.instanceMatrix.needsUpdate = true;
  group.add(rails);

  // ── Rope lashings (one torus at each post per course) ───────────────
  const ropeGeo = new THREE.TorusGeometry(ROPE_RING_R, ROPE_TUBE_R, 6, 16);
  const ropeCount = postCount * RAIL_COURSES;
  const ropes = new THREE.InstancedMesh(ropeGeo, ropeMat, ropeCount);
  ropes.name = "structure_" + key + "_sacred_platform_rope_lashings";
  ropes.castShadow = false;
  ropes.receiveShadow = false;
  let rp = 0;
  for (let course = 1; course <= RAIL_COURSES; course++) {
    const ropeY = deckTopY + RAIL_VERTICAL_GAP * course;
    for (let i = 0; i < postCount; i++) {
      if (isPostInGap(i)) {
        // No post = no rope. Park the instance off-stage.
        dummy.scale.setScalar(0);
        dummy.position.set(0, -1000, 0);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        ropes.setMatrixAt(rp++, dummy.matrix);
        continue;
      }
      const a = i * angleStep;
      dummy.position.set(
        centerX + postRingRadius * Math.cos(a),
        ropeY,
        centerZ + postRingRadius * Math.sin(a),
      );
      // Torus lies in XY by default; rotate so it wraps around the post (Y axis).
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      ropes.setMatrixAt(rp++, dummy.matrix);
    }
  }
  ropes.instanceMatrix.needsUpdate = true;
  group.add(ropes);

  // ── Steps (3 timber treads bridging the rail gap) ───────────────────
  // Cascade outward from the deck rim along `stepFacingRad`. Widened to
  // 2.4 m so the staircase visibly fills the gap between the two flanking
  // posts (post spacing on a 4.7 m-radius / 12-post rim is ~2.46 m), and
  // a third step is added so the descent reaches all the way to terrain
  // even on the lower 0.32 m rim height.
  const STEP_COUNT = 3;
  const STEP_DEPTH_M = 0.46;
  const STEP_WIDTH_M = 2.40;
  const STEP_THICKNESS_M = 0.14;
  const stepGeo = new THREE.BoxGeometry(STEP_WIDTH_M, STEP_THICKNESS_M, STEP_DEPTH_M);
  for (let s = 0; s < STEP_COUNT; s++) {
    const step = new THREE.Mesh(stepGeo, timberMat);
    step.name = "structure_" + key + "_sacred_platform_step_" + s;
    step.castShadow = true;
    step.receiveShadow = true;
    // s = 0 is the top tread (flush with deck top), s = STEP_COUNT-1 sits
    // on the grass. Each step shifts outward by one depth so the cascade
    // visually reads as a descending stairway.
    const fromCenter = radius + STEP_DEPTH_M * (s + 0.5) - 0.05;
    const stepY = deckTopY - STEP_THICKNESS_M / 2 - s * STEP_THICKNESS_M;
    const cos = Math.cos(stepFacingRad);
    const sin = Math.sin(stepFacingRad);
    step.position.set(
      centerX + cos * fromCenter,
      stepY,
      centerZ + sin * fromCenter,
    );
    step.rotation.y = -stepFacingRad + Math.PI / 2;
    group.add(step);
  }

  scene.add(group);
  objects.push(group);

  return { platMesh, group, deckTopY };
}

/**
 * Test-friendly accessor — lets tooling validate the cached materials were
 * built without rebuilding the canvases. NOT used by the runtime.
 */
export function _peekSacredPlatformCaches() {
  return {
    deck: _cachedDeckMaterials,
    timber: _cachedTimberMaterial,
    rope: _cachedRopeMaterial,
  };
}
