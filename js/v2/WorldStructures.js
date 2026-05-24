import * as THREE from "three";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
// Procedural tipi + figure builders were extracted and gated behind
// `USE_PROCEDURAL_*` flags during the May-17 2026 FPS pass, then
// reverted after two visual-regression rounds ("thin and stupid"). The
// dead-flag scaffolding + the unreachable procedural modules were
// removed during the May-17 forensic cleanup; only the GLB load path
// remains. Re-introduce a similar swap via a NEW module file if the
// FPS-vs-fidelity trade comes back into scope.
import {
  ANU_INTERACTION_VERB,
  ANU_SIMULATION_DOMAIN,
} from "./anu/SimulationController.js";
import {
  V2_NPC_BHG_TIPI2_GOLD_CIRCLE_LIFT_M,
  V2_NPC_BHG_TIPI2_GOLD_CIRCLE_RADIUS_M,
  V2_NPC_BHG_TIPI2_LOCAL_X_M,
  V2_NPC_BHG_TIPI2_LOCAL_Z_M,
  V2_NPC_BHG_TIPI2_MODEL_YAW_RAD,
  V2_NPC_BHG_TIPI2_PLAYER_AIM_YAW_BIAS_RAD,
  V2_NPC_BHG_TIPI2_SEAT_LOWER_M,
  V2_NPC_BHG_TIPI2_SIZE_MULTIPLIER,
  V2_NPC_BHG_TIPI2_TARGET_HEIGHT_M,
  V2_NPC_BHG_TIPI2_VERTICAL_TRIM_M,
  V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M,
  V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M,
  V2_NPC_YB_TIPI1_LOCAL_X_M,
  V2_NPC_YB_TIPI1_LOCAL_Z_M,
  V2_NPC_YB_TIPI1_MODEL_YAW_RAD,
  V2_NPC_YB_TIPI1_PLAYER_AIM_YAW_BIAS_RAD,
  V2_NPC_YB_TIPI1_SEAT_LOWER_M,
  V2_NPC_YB_TIPI1_SIZE_MULTIPLIER,
  V2_NPC_YB_TIPI1_TARGET_HEIGHT_M,
  V2_NPC_YB_TIPI1_VERTICAL_TRIM_M,
  V2_TIPI_2_CENTER_X_M,
  V2_TIPI_2_CENTER_Z_M,
  V2_TIPI_2_YAW_RAD,
  V2_TIPI_BRAZIER_ABOVE_DECK_M,
  V2_TIPI_BRAZIER_WORLD_X_M,
  V2_TIPI_BRAZIER_WORLD_Z_M,
  V2_TIPI_NPC_CEREMONIAL_FIRE_ABOVE_GROUND_M,
  V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_X_M,
  V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_Z_M,
  V2_TIPI_NPC_CEREMONIAL_FIRE_SCALE,
  V2_TIPI_SACRED_PLATFORM_HEIGHT,
  V2_TIPI_SACRED_PLATFORM_RADIUS,
  V2_TIPI_JOURNAL_BALLOON_ABOVE_APEX_M,
  V2_TIPI_SMOKE_ABOVE_APEX_M,
  V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M,
} from "./constants.js";
import { applyPipOrthoRingDiskClipToSubtree } from "./anu/PipOrthoRingDiskClip.js";
import {
  createPhotorealTravelDiscMaterial,
  createPhotorealTravelRingMaterial,
  touchTravelCircleTime,
} from "./anu/TravelFloorCircleMaterials.js";
import { createTipiCampfire, createTipiSmokePlume } from "./TipiCampfire.js";
import { createSacredCirclePlatform } from "./WorldSacredPlatform.js";
import { terrainY } from "./WorldTerrain.js";
import {
  loadMossyRockGltfShared,
  plantMossyRockClone,
} from "./WorldMossyRock.js";
import { getRuntimeService } from "./RuntimeServices.js";
import { createTipiOwnerBehaviour } from "./NPCBehaviour.js";
import { createTipiJournalQuestBalloon } from "./WorldTipiJournalBalloon.js";

/** Legacy primary yellow butterfly tipi path — WORDPRESS bundle mirrors original Assets layout. */
const TIPI_1_URL = "./WORDPRESS/Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb";
/** Yellow Butterfly character — seated host at tipi 1 only (fresh minimal path; no proximity FSM). */
const NPC_YB_URL = "./Assets/NPC.YB.glb";
/**
 * Tipi 2 reuses tipi 1's visual asset (same village vocabulary). When a
 * unique BHG tipi GLB is sourced, change just this constant.
 */
const TIPI_2_URL = TIPI_1_URL;
/**
 * Brings Happiness Girl — seated host at tipi 2. Note: this GLB is ~105 MB
 * uncompressed vs NPC.YB.glb's 8 MB Draco-compressed. First-load will be
 * slow until the asset is re-baked with Draco compression. Tracked in the
 * ANU memory card `tipi-owner-proximity-behaviour`.
 */
const NPC_BHG_URL = "./Assets/NPC.BHG.glb";

/**
 * Quest stone axe — prefer `BACKUP/Assets/axe.glb` when present; identical
 * fallback ships under `./Assets/axe.glb` so loads never hard-fail.
 */
const QUEST_AXE_GLBF_URLS = ["./BACKUP/Assets/axe.glb", "./Assets/axe.glb"];

/**
 * Nominal world XZ for the Tipi 2 quest axe on the grass (southeast of the
 * deck centre). Kept in sync with spawn placement below — journal autowalk
 * reads the same numbers via `World.handleAutowalk('axe')`.
 */
export function getTipi2QuestAxeNominalXZ() {
  const platRadius = V2_TIPI_SACRED_PLATFORM_RADIUS;
  const southBeyondDeck = platRadius + 1.28;
  const eastBias = 1.22;
  return {
    x: V2_TIPI_2_CENTER_X_M + eastBias,
    z: V2_TIPI_2_CENTER_Z_M - southBeyondDeck,
  };
}

/** Platform deck world Y (top of sacred cylinder under tipi 1). */
export function tipi1SacredDeckTopY(platMesh) {
  return platMesh.position.y + V2_TIPI_SACRED_PLATFORM_HEIGHT * 0.5;
}

/**
 * Sacred-circle platform deck material (May-11 2026 v2 — forest green).
 *
 * Plain deep **forest-green** `MeshStandardMaterial` — calm ceremonial slab
 * that ties the sacred circles into the surrounding tree ring (replaces the
 * earlier warm beige + retired photoreal/plaid stack per user request).
 */
function createForestGreenSacredCircleMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x2d5a3a,
    roughness: 0.9,
    metalness: 0.03,
  });
}

/**
 * Gold trim border for the sacred circle platform.
 *
 * Built as a thin TorusGeometry hugging the top rim of the platform
 * cylinder. Material is a brushed-gold MeshStandardMaterial — low
 * roughness, high metalness, warm amber base — so it catches sun /
 * fire light dramatically and reads as a "ceremonial" edge from any
 * angle. The torus is rotated π/2 around X so its plane is horizontal
 * (matches the deck top).
 *
 * Tube radius is sized in metres so the rim reads as a chunky bevelled
 * band rather than a hairline wire (the user's spec was "beautiful gold
 * trim border", not "thin gold line").
 *
 * Returns the THREE.Mesh ready to add to the platform's scene parent
 * with the correct world Y already baked in.
 */
/**
 * Procedural wildflower: stem + 5 disc petals tilted up + pollen core.
 * Cheap (~50 tris), no textures, kid-bright colors. Stem grounded at y=0.
 */
function createWildflower(petalColorHex, rand) {
  const flower = new THREE.Group();
  flower.name = "wildflower";

  const stemHeight = 0.16 + rand() * 0.08;
  const stemGeo = new THREE.CylinderGeometry(0.006, 0.008, stemHeight, 5, 1, false);
  stemGeo.translate(0, stemHeight * 0.5, 0);
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x3f5d22,
    roughness: 0.88,
    metalness: 0.0,
  });
  flower.add(new THREE.Mesh(stemGeo, stemMat));

  const petalRadius = 0.030 + rand() * 0.010;
  const petalMat = new THREE.MeshStandardMaterial({
    color: petalColorHex,
    roughness: 0.62,
    metalness: 0.0,
    emissive: petalColorHex,
    emissiveIntensity: 0.06,
    side: THREE.DoubleSide,
  });
  const NUM_PETALS = 5;
  for (let i = 0; i < NUM_PETALS; i++) {
    const a = (i / NUM_PETALS) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.CircleGeometry(petalRadius, 8), petalMat);
    petal.position.set(
      Math.cos(a) * petalRadius * 0.78,
      stemHeight,
      Math.sin(a) * petalRadius * 0.78,
    );
    // Tilt petals upward + outward so the flower reads as a cup, not a flat disc
    petal.rotation.x = -Math.PI / 2.4;
    petal.rotation.z = -a;
    flower.add(petal);
  }

  const coreGeo = new THREE.IcosahedronGeometry(0.013, 0);
  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xffd54f,
    roughness: 0.55,
    metalness: 0.0,
    emissive: 0xffaa00,
    emissiveIntensity: 0.22,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = stemHeight + 0.005;
  flower.add(core);

  flower.traverse((n) => {
    if (n.isMesh) { n.castShadow = false; n.receiveShadow = false; }
  });
  return flower;
}

/**
 * Procedural log-bark textures shared by every sacred-circle log instance.
 *
 * Why this lives module-scope (not per-tipi): the bark/roughness/bump canvases
 * are ~256×512 with thousands of fibres + dozens of knots — re-drawing them
 * every time a tipi spawns would cost a 100 ms hitch per circle for visuals
 * that are intentionally identical between tipis. We build them lazily on
 * first call and cache the configured `MeshStandardMaterial`.
 *
 * The texture treats v (cylinder height direction post `rotateX(π/2)` →
 * along-the-log axis) as the wood-fibre direction, and u (around the
 * circumference) as the cross-grain. With `repeat(1, 3)` the bark wraps
 * once per log and tiles 3× along its length, which reads as a contiguous
 * grain without obvious seams at the radial-segment count of 10.
 */
let _cachedSacredLogMaterial = null;
function buildSacredLogBarkMaterial() {
  if (_cachedSacredLogMaterial) return _cachedSacredLogMaterial;

  const W = 256;
  const H = 512;

  // ── Albedo canvas — banded browns + vertical fibres + knots ─────────────
  const albedoCanvas = document.createElement("canvas");
  albedoCanvas.width = W;
  albedoCanvas.height = H;
  const ac = albedoCanvas.getContext("2d");

  // Base brown gradient (cool umber → warm walnut) along v.
  const grad = ac.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.0, "#5a3a1f");
  grad.addColorStop(0.35, "#74471f");
  grad.addColorStop(0.7, "#5d3a1c");
  grad.addColorStop(1.0, "#3c2410");
  ac.fillStyle = grad;
  ac.fillRect(0, 0, W, H);

  // Subtle horizontal banding so the cross-grain reads as ring-like.
  for (let y = 0; y < H; y += 4) {
    const a = 0.04 + (Math.sin(y * 0.07) + 1) * 0.025;
    ac.fillStyle = `rgba(28, 16, 8, ${a})`;
    ac.fillRect(0, y, W, 2);
  }

  // Vertical fibres — long, thin, mostly-straight strokes along v.
  const fibreCount = 240;
  for (let i = 0; i < fibreCount; i++) {
    const x = Math.random() * W;
    const len = 60 + Math.random() * (H - 80);
    const yStart = Math.random() * (H - len);
    const dark = Math.random() < 0.55;
    ac.strokeStyle = dark
      ? `rgba(22, 12, 6, ${0.18 + Math.random() * 0.32})`
      : `rgba(196, 148, 96, ${0.10 + Math.random() * 0.16})`;
    ac.lineWidth = 0.5 + Math.random() * 1.4;
    ac.beginPath();
    ac.moveTo(x, yStart);
    // Slight curve so fibres don't read as a comb.
    const cx = x + (Math.random() - 0.5) * 6;
    ac.quadraticCurveTo(cx, yStart + len * 0.5, x + (Math.random() - 0.5) * 3, yStart + len);
    ac.stroke();
  }

  // A handful of knots — dark concentric ellipses with a warmer core.
  const knotCount = 6;
  for (let i = 0; i < knotCount; i++) {
    const cx = Math.random() * W;
    const cy = Math.random() * H;
    const r = 6 + Math.random() * 14;
    const g = ac.createRadialGradient(cx, cy, 1, cx, cy, r);
    g.addColorStop(0.0, "rgba(18, 8, 4, 0.95)");
    g.addColorStop(0.45, "rgba(48, 24, 10, 0.7)");
    g.addColorStop(1.0, "rgba(48, 24, 10, 0)");
    ac.fillStyle = g;
    ac.beginPath();
    ac.ellipse(cx, cy, r * 1.1, r * 0.78, 0, 0, Math.PI * 2);
    ac.fill();
  }

  // ── Roughness canvas — bark is rough nearly everywhere, fibre cracks a
  // touch rougher, knot cores a touch glossier from sap. Values 0..1 where
  // 0 = mirror, 1 = pure diffuse. Wood lives in the 0.78..0.96 band. ─────
  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = W;
  roughCanvas.height = H;
  const rc = roughCanvas.getContext("2d");
  rc.fillStyle = "#dcdcdc"; // ≈ 0.86
  rc.fillRect(0, 0, W, H);
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * W;
    const len = 60 + Math.random() * (H - 80);
    const yStart = Math.random() * (H - len);
    rc.strokeStyle = `rgba(255,255,255,${0.06 + Math.random() * 0.10})`;
    rc.lineWidth = 0.5 + Math.random() * 1.0;
    rc.beginPath();
    rc.moveTo(x, yStart);
    rc.lineTo(x + (Math.random() - 0.5) * 2, yStart + len);
    rc.stroke();
  }

  // ── Bump canvas — same fibre/knot pattern as a height field so the
  // surface picks up real shading micro-relief under the directional light.
  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = W;
  bumpCanvas.height = H;
  const bc = bumpCanvas.getContext("2d");
  bc.fillStyle = "#808080";
  bc.fillRect(0, 0, W, H);
  for (let i = 0; i < fibreCount; i++) {
    const x = Math.random() * W;
    const len = 60 + Math.random() * (H - 80);
    const yStart = Math.random() * (H - len);
    bc.strokeStyle = `rgba(${Math.random() < 0.5 ? 30 : 220},${0},${0},${0.35 + Math.random() * 0.4})`;
    // Tint via lumens — use grayscale via fillStyle below instead.
    bc.strokeStyle = Math.random() < 0.5
      ? `rgba(30,30,30,${0.25 + Math.random() * 0.4})`
      : `rgba(220,220,220,${0.10 + Math.random() * 0.18})`;
    bc.lineWidth = 0.5 + Math.random() * 1.2;
    bc.beginPath();
    bc.moveTo(x, yStart);
    bc.lineTo(x + (Math.random() - 0.5) * 2, yStart + len);
    bc.stroke();
  }
  for (let i = 0; i < knotCount; i++) {
    const cx = Math.random() * W;
    const cy = Math.random() * H;
    const r = 6 + Math.random() * 14;
    const g = bc.createRadialGradient(cx, cy, 1, cx, cy, r);
    g.addColorStop(0.0, "rgba(20,20,20,0.85)");
    g.addColorStop(1.0, "rgba(20,20,20,0)");
    bc.fillStyle = g;
    bc.beginPath();
    bc.ellipse(cx, cy, r * 1.1, r * 0.78, 0, 0, Math.PI * 2);
    bc.fill();
  }

  const albedoTex = new THREE.CanvasTexture(albedoCanvas);
  albedoTex.colorSpace = THREE.SRGBColorSpace;
  albedoTex.wrapS = albedoTex.wrapT = THREE.RepeatWrapping;
  albedoTex.repeat.set(1, 3);
  albedoTex.anisotropy = 4;
  albedoTex.needsUpdate = true;

  const roughTex = new THREE.CanvasTexture(roughCanvas);
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
  roughTex.repeat.set(1, 3);
  roughTex.needsUpdate = true;

  const bumpTex = new THREE.CanvasTexture(bumpCanvas);
  bumpTex.wrapS = bumpTex.wrapT = THREE.RepeatWrapping;
  bumpTex.repeat.set(1, 3);
  bumpTex.needsUpdate = true;

  _cachedSacredLogMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,        // base white — per-instance color tints it lightly
    map: albedoTex,
    roughness: 0.88,
    roughnessMap: roughTex,
    metalness: 0.0,
    bumpMap: bumpTex,
    bumpScale: 0.045,
    flatShading: false,
  });
  return _cachedSacredLogMaterial;
}

/** Pool2 dock & other non-tipi consumers need the same bark as sacred platform logs. */
export function getSharedSacredLogBarkMaterial() {
  return buildSacredLogBarkMaterial();
}

/**
 * Rustic log border + wildflowers (May-13 2026 user pass — "real logs around the
 * border, photorealistic, like the border was made out of real logs … add some
 * nice wildflowers for the rustic fun experience for kids").
 *
 * Builds a Group containing:
 *   • An InstancedMesh of N cylinder logs laid end-to-end around the platform
 *     perimeter, with per-log color/rotation/y jitter so it reads hand-stacked
 *     rather than CAD-perfect. One draw call regardless of log count.
 *   • A scatter of procedural wildflowers (stem + 5 petals + pollen core) in
 *     cheerful kid-palette colors, alternating inside / between the logs so
 *     they look like they grew up through the moss between the timbers.
 *
 * Scene-graph identifiers still carry the historical `gold_trim` slug — Anu
 * scene-inventory + memory cards depend on those IDs, and renaming them would
 * be a wider contract change. The visual rename is cosmetic-only.
 */
function createSacredCircleGoldTrim(platMesh, platRadius, tipiKey) {
  const group = new THREE.Group();
  group.name = `structure_${tipiKey}_sacred_platform_gold_trim`;
  group.userData.anuId = `structure.${tipiKey}.sacred_platform.gold_trim`;
  group.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
  group.userData.anuKind = "tipi_sacred_circle_gold_trim";

  const logRadius = 0.04;            // 75 % lower than legacy 0.16 m — thin rim logs
  const ringRadius = platRadius + 0.05;
  const circumference = 2 * Math.PI * ringRadius;
  const N = Math.max(18, Math.round(circumference / 0.95));
  const angleStep = (Math.PI * 2) / N;
  const chord = 2 * Math.sin(angleStep / 2) * ringRadius;
  const logLen = chord * 1.06;       // 6% overlap so adjacent logs touch
  const topY = platMesh.position.y + V2_TIPI_SACRED_PLATFORM_HEIGHT * 0.5;
  const logCenterY = topY + logRadius * 0.55;

  // ── Logs (InstancedMesh — one draw call per circle) ──────────────────────
  // 12 radial segments (was 10) so the bark wrap doesn't telegraph a polygon
  // facet under raking light; still cheap with InstancedMesh batching.
  const logGeo = new THREE.CylinderGeometry(logRadius, logRadius * 0.97, logLen, 12, 1, false);
  logGeo.rotateX(Math.PI / 2); // axis now along +Z so mesh.rotation.y aligns with tangent
  // Shared textured bark material — see `buildSacredLogBarkMaterial`.
  // Cached at module scope so adjacent tipis share one GPU upload.
  const logMat = buildSacredLogBarkMaterial();
  const logs = new THREE.InstancedMesh(logGeo, logMat, N);
  logs.name = `structure_${tipiKey}_sacred_platform_logs`;
  logs.castShadow = true;
  logs.receiveShadow = true;
  const dummy = new THREE.Object3D();
  // Deterministic per-tipi jitter — same circle looks the same on reload.
  let seed = tipiKey.charCodeAt(0) * 977 + (tipiKey.charCodeAt(tipiKey.length - 1) || 0) * 31;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < N; i++) {
    const a = i * angleStep;
    dummy.position.set(
      platMesh.position.x + ringRadius * Math.cos(a),
      logCenterY + (rand() - 0.5) * 0.018,
      platMesh.position.z + ringRadius * Math.sin(a),
    );
    dummy.rotation.set(
      (rand() - 0.5) * 0.05,        // pitch
      -a + (rand() - 0.5) * 0.04,   // yaw — tangent + jitter
      (rand() - 0.5) * 0.06,        // roll
    );
    dummy.updateMatrix();
    logs.setMatrixAt(i, dummy.matrix);
    // Per-instance tint multiplies the bark map. Keep near-white with a
    // gentle warm-cool drift so logs vary subtly (some fresher, some
    // weathered) without obliterating the bark albedo.
    const tint = new THREE.Color(0xf0e2d2);
    tint.offsetHSL(
      (rand() - 0.5) * 0.04,  // hue: sienna ↔ umber drift
      (rand() - 0.5) * 0.05,  // sat
      (rand() - 0.5) * 0.12,  // value: keep narrow so bark map dominates
    );
    logs.setColorAt(i, tint);
  }
  logs.instanceMatrix.needsUpdate = true;
  if (logs.instanceColor) logs.instanceColor.needsUpdate = true;
  group.add(logs);

  // ── Wildflowers — cheerful kid-palette clusters along the inner lip ──────
  const FLOWER_PALETTE = [
    0xff8aa5, // coral pink
    0xffd24a, // sunshine yellow
    0xfff6dc, // creamy white daisy
    0xa3c2ff, // sky blue forget-me-not
    0xd9a6ff, // lavender
    0xff7043, // bright marigold
  ];
  const flowerCount = Math.max(12, Math.round(N * 0.6));
  for (let i = 0; i < flowerCount; i++) {
    // Alternate between just-inside-logs (on platform) and between-logs (peeking up).
    const insideRing = i % 3 !== 0;
    const baseR = insideRing ? ringRadius - 0.14 - rand() * 0.16 : ringRadius + 0.03;
    const a = (i / flowerCount) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const flower = createWildflower(FLOWER_PALETTE[i % FLOWER_PALETTE.length], rand);
    flower.position.set(
      platMesh.position.x + baseR * Math.cos(a),
      topY + 0.005,
      platMesh.position.z + baseR * Math.sin(a),
    );
    flower.rotation.y = rand() * Math.PI * 2;
    flower.scale.setScalar(0.85 + rand() * 0.55);
    group.add(flower);
  }

  return group;
}

/**
 * Gold deck decal only (disc + ring) — stays on `root` while rig + arrow rotate in `ybFacingGroup`.
 *
 * `opts.npcKey` / `opts.npcSlug` parameterise the mesh names and ANU ids so
 * the same helper can be reused per NPC without collisions in ANU's id
 * namespace. Defaults preserve YB tipi 1 behaviour exactly.
 */
export function addGoldTravelFloorDecalAtFeet(group, radius, liftY, opts = {}) {
  const R = radius;
  const lift = liftY;
  const innerR = R * 0.92;
  const npcKey = opts.npcKey ?? "yb";
  const npcSlug = opts.npcSlug ?? "yellow_butterfly";

  const discMat = createPhotorealTravelDiscMaterial("npc", R);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 72), discMat);
  disc.name = `population_npc_${npcKey}_gold_travel_disc`;
  disc.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  disc.userData.anuKind = `npc_${npcKey}_travel_disc`;
  disc.userData.anuId = `population.npc.${npcSlug}.gold_disc`;
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = lift;
  disc.renderOrder = 8;
  group.add(disc);

  const ringMat = createPhotorealTravelRingMaterial("npc", innerR, R);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(innerR, R, 96),
    ringMat,
  );
  ring.name = `population_npc_${npcKey}_gold_travel_ring`;
  ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  ring.userData.anuKind = `npc_${npcKey}_travel_ring`;
  ring.userData.anuId = `population.npc.${npcSlug}.gold_ring`;
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = lift + 0.008;
  ring.renderOrder = 9;
  group.add(ring);

  return [discMat, ringMat];
}

/**
 * Facing arrow mesh (−Z in pivot space after `rotation.x = −π/2`). Parent:
 * `ybFacingGroup`. Tip is built at −Y in shape space so that after the
 * rotation the arrow points in the seated host's forward direction (the
 * opposite side of her disc to where it pointed prior — see ANU memory
 * card `npc-yb-tipi-scene-polish`).
 */
export function createGoldTravelFacingArrowMesh(radius, localY, opts = {}) {
  const R = radius;
  const npcKey = opts.npcKey ?? "yb";
  const npcSlug = opts.npcSlug ?? "yellow_butterfly";
  const arrowShape = new THREE.Shape()
    .moveTo(0, -R * 0.92)
    .lineTo(R * 0.22, -R * 0.52)
    .lineTo(-R * 0.22, -R * 0.52)
    .lineTo(0, -R * 0.92);
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(arrowShape),
    new THREE.MeshBasicMaterial({
      color: 0xfff4b3,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      // Match the shared travel-floor-decal policy (ANU memory:
      // travel-floor-decal-depth). depthTest off + renderOrder 10 keeps
      // the arrow readable on the sacred deck and on tilted terrain
      // alike, with no polygonOffset artefacts.
      depthTest: false,
      depthWrite: false,
    }),
  );
  arrow.name = `population_npc_${npcKey}_gold_travel_arrow`;
  arrow.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  arrow.userData.anuKind = `npc_${npcKey}_travel_arrow`;
  arrow.userData.anuId = `population.npc.${npcSlug}.gold_arrow`;
  arrow.rotation.x = -Math.PI / 2;
  arrow.position.y = localY;
  arrow.renderOrder = 10;
  return arrow;
}

/**
 * Soft additive halo behind the seated host's headdress — gives a subtle
 * "saintly" glow without adding a full PointLight. Generated from a tiny
 * canvas radial gradient so we never have to ship a halo PNG asset.
 *
 * Sprite always faces the camera; depthTest:false lets the additive light
 * read through the headdress silhouette as a gentle bloom rather than a
 * hard disc occluded by hair / feathers.
 */
function createNpcEtherealHaloSprite(diameterMetres, opts = {}) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2 - 4);
  grad.addColorStop(0.0, "rgba(255, 248, 210, 0.95)");
  grad.addColorStop(0.32, "rgba(255, 220, 130, 0.55)");
  grad.addColorStop(0.62, "rgba(255, 180, 80, 0.18)");
  grad.addColorStop(1.0, "rgba(255, 160, 60, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
  });
  const halo = new THREE.Sprite(mat);
  halo.scale.set(diameterMetres, diameterMetres, 1);
  halo.renderOrder = 11;
  const npcKey = opts.npcKey ?? "yb";
  const npcSlug = opts.npcSlug ?? "yellow_butterfly";
  halo.name = `population_npc_${npcKey}_ethereal_halo`;
  halo.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
  halo.userData.anuKind = `npc_${npcKey}_ethereal_halo`;
  halo.userData.anuId = `population.npc.${npcSlug}.halo`;
  return halo;
}

/**
 * Aim a seated NPC (rig + gold arrow) toward the player on XZ. `World`
 * passes physics/camera body XZ; `facingGroup.rotation.y = atan2(dx, dz)`
 * aligns the rig's local +Z with (player − NPC) — matches Three.js's
 * Y-rotation convention. May-17 2026 cleanup folded the YB and BHG
 * variants (byte-identical except for userData key names + yaw-bias
 * constant) into this single helper; the named exports below remain as
 * thin shims so `World.js` and the panel reference them by their
 * existing identifiers.
 *
 * @param {THREE.Object3D} tipi
 * @param {number} playerX
 * @param {number} playerZ
 * @param {object} cfg
 * @param {string} cfg.facingGroupKey   `userData[...]` slot for the facing pivot.
 * @param {string} cfg.seatRootKey      `userData[...]` slot for the seat root.
 * @param {string} cfg.travelMatsKey    `userData[...]` slot for the gold travel-disc materials.
 * @param {number} cfg.yawBiasRad       Per-NPC rig-forward offset.
 */
function updateSeatedNpcPlayerAim(tipi, playerX, playerZ, cfg) {
  const fg = tipi?.userData?.[cfg.facingGroupKey];
  const root = tipi?.userData?.[cfg.seatRootKey];
  if (!fg || !root) return;
  const dx = playerX - root.position.x;
  const dz = playerZ - root.position.z;
  if (dx * dx + dz * dz < 1e-10) return;
  fg.rotation.y = Math.atan2(dx, dz) + cfg.yawBiasRad;
  const mats = tipi?.userData?.[cfg.travelMatsKey];
  if (Array.isArray(mats)) {
    const t =
      (typeof performance !== "undefined" ? performance.now() : 0) * 0.001;
    for (let i = 0; i < mats.length; i++) touchTravelCircleTime(mats[i], t);
  }
}

export function updateYellowButterflyPlayerAim(tipi, playerX, playerZ) {
  updateSeatedNpcPlayerAim(tipi, playerX, playerZ, {
    facingGroupKey: "ybFacingGroup",
    seatRootKey: "ybSeatRoot",
    travelMatsKey: "ybTravelCircleMaterials",
    yawBiasRad: V2_NPC_YB_TIPI1_PLAYER_AIM_YAW_BIAS_RAD,
  });
}

/**
 * Walk a freshly-loaded NPC GLB and stamp the Anu identity userData on
 * every mesh + skinned-mesh under it. Shared between the YB and BHG
 * seated-attach pipelines (May-17 2026 cleanup — was inlined twice
 * byte-identically except for the `anuKind` / `anuId` strings).
 *
 * @param {THREE.Object3D} model    Root of the loaded GLB tree.
 * @param {string} anuKind          Mesh-level `userData.anuKind` value.
 * @param {string} anuIdPrefix      Mesh-level `userData.anuId` prefix.
 *                                  Each mesh becomes `${anuIdPrefix}.${slug}`.
 */
function tagSeatedNpcMeshes(model, anuKind, anuIdPrefix) {
  model.traverse((ch) => {
    if (ch.isMesh || ch.isSkinnedMesh) {
      ch.castShadow = false;
      ch.receiveShadow = false;
      ch.frustumCulled = true;
      ch.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
      ch.userData.anuKind = anuKind;
      const nm = (ch.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
      ch.userData.anuId = `${anuIdPrefix}.${nm}`;
    }
  });
}

/**
 * Bbox-measure + scale + sole-align a seated NPC model so its soles
 * sit on `y=0` of its parent group. Returns the post-scale bbox height
 * (callers use it to place haloes etc).
 */
function fitSeatedNpcToGroup(model, baseTargetH, sizeMultiplier) {
  const box0 = new THREE.Box3().setFromObject(model);
  const size0 = new THREE.Vector3();
  box0.getSize(size0);
  const baseSc = size0.y > 0.001 ? baseTargetH / size0.y : 1;
  const sc = baseSc * sizeMultiplier;
  model.scale.setScalar(sc);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.y = -box.min.y;
  const boxCenter = box.getCenter(new THREE.Vector3());
  model.position.x = -boxCenter.x;
  model.position.z = -boxCenter.z;
  return box.max.y - box.min.y;
}

/**
 * Loads `NPC.YB.glb` seated on the tipi 1 cylinder deck (inside / centre area).
 * Animation: sit clip by name (`sit`, `003`, …) or legacy index **3** fallback (`EnvironmentBuilder.js`).
 *
 * Bind pose: `V2_NPC_YB_TIPI1_MODEL_YAW_RAD` on the mesh inside `ybFacingGroup`, which is rotated each frame toward the player.
 */
async function attachYellowButterflySeatedTipi1(scene, objects, platMesh, tipi) {
  try {
    const gltf = await new GLTFLoaderWithDraco().loadAsync(NPC_YB_URL);
    const model = gltf.scene;
    model.name = "population_npc_yb_model";
    model.rotation.y = V2_NPC_YB_TIPI1_MODEL_YAW_RAD;

    tagSeatedNpcMeshes(
      model,
      "npc_yb_tipi1_rig_mesh",
      "population.npc.yellow_butterfly.mesh",
    );

    const scaledHeight = fitSeatedNpcToGroup(
      model,
      V2_NPC_YB_TIPI1_TARGET_HEIGHT_M,
      V2_NPC_YB_TIPI1_SIZE_MULTIPLIER,
    );

    const root = new THREE.Group();
    root.name = "population_npc_yellow_butterfly_tipi1_seated";
    root.userData.anuId = "population.npc.yellow_butterfly";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
    root.userData.anuKind = "npc_yb_tipi1_seated";
    root.userData.anuInteractable = true;
    root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
    root.userData.anuCollision = "passable";
    root.userData.anuLegacyReference =
      "EnvironmentBuilder.js NPC.YB — seated only (fresh v2 attachment)";

    const ybTravelCircleMats = addGoldTravelFloorDecalAtFeet(
      root,
      V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M,
      V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M,
    );

    const lift = V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M;
    const facingGroup = new THREE.Group();
    facingGroup.name = "population_npc_yb_facing";
    facingGroup.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
    facingGroup.userData.anuKind = "npc_yb_facing_pivot";
    facingGroup.userData.anuId = "population.npc.yellow_butterfly.facing_pivot";

    const arrow = createGoldTravelFacingArrowMesh(
      V2_NPC_YB_TIPI1_GOLD_CIRCLE_RADIUS_M,
      lift + 0.015,
    );
    facingGroup.add(model);
    facingGroup.add(arrow);

    /**
     * Slight ethereal halo behind the headdress — sized to ~1.4× of the
     * "head crown" position above her soles (sprite is camera-aligned so
     * the diameter is in world metres). Sits at the head height in
     * facingGroup local space. Subtle by design.
     *
     * Note: PiP ortho ring clip currently handles Mesh/Points only — a
     * SpriteMaterial path is out of scope here. The halo's small
     * world-space diameter makes it a sub-pixel dot on the PiP minimap,
     * which reads as a faint location marker rather than an artefact.
     */
    const halo = createNpcEtherealHaloSprite(scaledHeight * 0.55);
    halo.position.set(0, scaledHeight * 0.92, 0);
    facingGroup.add(halo);

    root.add(facingGroup);

    const deckTop = tipi1SacredDeckTopY(platMesh);
    root.position.set(
      V2_NPC_YB_TIPI1_LOCAL_X_M,
      deckTop + V2_NPC_YB_TIPI1_VERTICAL_TRIM_M - V2_NPC_YB_TIPI1_SEAT_LOWER_M,
      V2_NPC_YB_TIPI1_LOCAL_Z_M,
    );

    scene.add(root);
    objects.push(root);

    const clips = gltf.animations ?? [];
    let sitClip = null;
    for (const c of clips) {
      const nm = String(c.name ?? "").toLowerCase();
      if (nm.includes("sit") || nm.includes("sitting") || nm.includes("003")) {
        sitClip = c;
        break;
      }
    }
    if (!sitClip && clips.length > 3) sitClip = clips[3];

    let mixer = null;
    if (sitClip) {
      mixer = new THREE.AnimationMixer(model);
      const act = mixer.clipAction(sitClip);
      act.setLoop(THREE.LoopRepeat, Infinity);
      act.clampWhenFinished = false;
      act.play();
      root.userData.anuActiveAnimation = { kind: "sit", clip: sitClip.name };
    }

    if (tipi) {
      tipi.userData.ybNpcMixer = mixer;
      tipi.userData.ybFacingGroup = facingGroup;
      tipi.userData.ybSeatRoot = root;
      tipi.userData.ybTravelCircleMaterials = ybTravelCircleMats;

      /**
       * Tipi-owner proximity behaviour controller — owns the NPC's pose
       * whenever the player crosses the 1-tile threshold (wave + walk out,
       * stand idle facing the player, walk back, turnaround, sit).
       * See `js/v2/NPCBehaviour.js`. World.js drives `update()` each frame
       * and honours `suppressPlayerAim` so the seated aim helper doesn't
       * fight the controller while she's in motion.
       */
      if (mixer && clips.length > 0) {
        try {
          const physics = getRuntimeService("WorldPhysics");
          const getGroundY =
            physics && typeof physics.getGroundY === "function"
              ? physics.getGroundY.bind(physics)
              : null;
          if (getGroundY) {
            tipi.userData.ybBehaviour = createTipiOwnerBehaviour({
              npcId: "npc_yb_tipi1",
              tipi,
              root,
              facingGroup,
              model,
              mixer,
              clips,
              tipiCenter: { x: 0, z: 0 },
              /**
               * Entrance position is provisional pending the May-11 2026
               * tipi-orientation forensic. The NPC walks from her seat to
               * `(0, ?, -2.6)` regardless of where the GLB's doorway flap
               * is actually sculpted — this lands her 2.6 m south of
               * centre, on the platform deck, between the tipi and the
               * approaching player.
               */
              entranceLocalXZ: { x: 0, z: -2.6 },
              getGroundY,
            });
          } else {
            console.warn(
              "[World] NPC.YB tipi1 owner behaviour skipped — WorldPhysics unavailable.",
            );
          }
        } catch (behaviourErr) {
          console.warn("[World] NPC.YB tipi1 owner behaviour wire failed:", behaviourErr);
        }
      }
    }

    console.log("%c[World] NPC.YB seated at tipi 1 (minimal load)", "color:#ce93d8;");
    return { root, mixer };
  } catch (e) {
    console.warn("[World] NPC.YB seated load failed:", e);
    return null;
  }
}

/**
 * Center Tipi + sacred green cylinder platform — 1:1 with legacy js/EnvironmentBuilder.js:
 * - tipi target height 7.2 m (trees scaled to V2_TREE_TEMPLATE_TARGET_HEIGHT_M in Trees.js)
 * - cylinder platRadius 4.7, height 0.22, colour 0x1a2e1a, center Y = terrain + 0.05
 */
export async function loadCenterTipi({ scene, objects, worldPhysics }) {
  const hexPos = { x: 0, z: 0 };
  const platformY = terrainY(hexPos.x, hexPos.z);
  if (typeof window !== "undefined") {
    window._tipiPlatformY = platformY;
  }

  const platRadius = V2_TIPI_SACRED_PLATFORM_RADIUS;
  const platH = V2_TIPI_SACRED_PLATFORM_HEIGHT;
  /**
   * Sacred-circle platform (May-14 2026 user spec): rebuilt as a stylized
   * wooden platform with radial plank deck, vertical log posts, two
   * stacked log rails with rope lashings, and a 2-step set facing south
   * (the player's approach axis). See `js/v2/WorldSacredPlatform.js` for
   * the procedural geometry + cached PBR materials.
   *
   * The legacy `createForestGreenSacredCircleMaterial` deck + golden
   * `createSacredCircleGoldTrim` log-and-wildflower border are gone;
   * `platMesh` here is the deck cylinder from the new builder, with the
   * same `position.y` semantics so every downstream consumer
   * (`tipi1SacredDeckTopY`, GLB pose alignment, brazier height, etc.)
   * keeps working unchanged.
   */
  const platBuild = createSacredCirclePlatform({
    scene,
    objects,
    centerX: hexPos.x,
    centerZ: hexPos.z,
    terrainAtCenter: platformY,
    radius: platRadius,
    height: platH,
    key: "tipi_1",
    // May-14 2026 user spec: "turn steps for buildings 45° more to the left".
    // CCW rotation around +Y in the XZ plane — positive radians rotate the
    // step direction left as seen from a top-down camera.
    stepFacingRad: Math.PI / 4,
  });
  const platMesh = platBuild.platMesh;

  try {
    const gltf = await new GLTFLoaderWithDraco().loadAsync(TIPI_1_URL);
    const tipi = gltf.scene;
    tipi.name = "structure_tipi_1_center";

    const box = new THREE.Box3().setFromObject(tipi);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M;
    const sf = targetH / Math.max(size.y, 0.1);
    tipi.scale.set(sf, sf, sf);

    /**
     * Tipi 1 doorway-facing yaw — `π/2` (May-11 2026 user spec:
     * "turn each tipi 90 degrees right on their current facing").
     * The GLB's doorway is on local +X (empirically confirmed by the
     * earlier forensic side-view renders in `scratch/forensic-out/`).
     * Rotating local +X by `π/2` around Y maps it to world `(0, 0, -1)`
     * = -Z = SOUTH, which faces the player at spawn `(0, ?, -3·TILE)`.
     * Do not change without re-running the side-view forensic; π/2 is
     * the unique value that puts the doorway on the player-facing side.
     */
    tipi.rotation.y = Math.PI / 2;
    tipi.updateMatrixWorld(true);

    box.setFromObject(tipi);
    const center = box.getCenter(new THREE.Vector3());

    tipi.position.set(
      hexPos.x - center.x + tipi.position.x,
      platBuild.deckTopY - box.min.y - 0.02,
      hexPos.z - center.z + tipi.position.z,
    );

    tipi.userData.anuId = "structure.tipi_1.center";
    tipi.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    tipi.userData.anuKind = "tipi_1_non_colliding";
    tipi.userData.anuInteractable = true;
    tipi.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
    tipi.userData.anuCollision = "passable";
    tipi.userData.anuCollisionReason =
      "Tipi models are explicitly excluded from object collision.";
    tipi.userData.anuLegacyReference =
      "EnvironmentBuilder.js TIPI yellowbutterfly — targetH 7.2, rotation -π/2";

    platMesh.userData.buildingRoot = tipi;

    tipi.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.userData.anuCollision = "passable";
        child.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
        child.userData.anuKind = "tipi_yellow_butterfly_mesh";
        const msh = (child.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
        child.userData.anuId = `structure.tipi_1.mesh.${msh}`;
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.roughness !== undefined) m.roughness = 0.9;
          if (m.metalness !== undefined) m.metalness = 0.0;
          if (m.emissive !== undefined) {
            m.emissive.setHex(0x000000);
            m.emissiveIntensity = 0.0;
          }
          m.transparent = false;
          m.depthWrite = true;
          /**
           * May-15 2026 user spec ("village view: fix buildings to not be
           * clipped"). The top-down map camera shoots straight down from
           * `feetY + 78m`. The tipi GLB's cone surface is single-sided
           * (`THREE.FrontSide`); from directly above, half the cone's outer
           * faces present their *back* sides to the camera (winding order
           * relative to the steep cone slope), so they get back-face culled
           * and the player sees straight through the roof into the interior
           * brazier/NPC — reading as a clipped-away building.
           *
           * Render both sides on tipi cones so the structure is visible from
           * every viewing angle (FPV, chase, cinematic orbit, map view).
           * Cost is negligible: a couple of low-tri cones doubled.
           */
          m.side = THREE.DoubleSide;
        }
      }
    });

    scene.add(tipi);
    objects.push(tipi);

    // v3 landscape-only opt-out (May-17 2026 user spec: "remove BHG
    // model. keep tipi2, lets now have ANU create a new map without
    // these models for now, just the new landscape, we will then phase
    // in the models from v2"). Setting `window._v3DisableSeatedNpcs`
    // before World activation skips the seated-NPC attach on both
    // tipis — the structures (Anu domain `structures`) remain, only
    // the seated population (Anu domain `population`) is absent.
    const _v3SkipSeated =
      typeof window !== "undefined" && window._v3DisableSeatedNpcs === true;
    const ybSeat = _v3SkipSeated
      ? null
      : await attachYellowButterflySeatedTipi1(scene, objects, platMesh, tipi);

    const deckFx = tipi1SacredDeckTopY(platMesh);
    const hearthY = deckFx + V2_TIPI_BRAZIER_ABOVE_DECK_M;
    /** Flame group sits at the brazier mesh XZ; Y is the bowl-rim cradle (V2_TIPI_BRAZIER_ABOVE_DECK_M). */
    const fireCtl = createTipiCampfire({
      scene,
      objects,
      x: hexPos.x + V2_TIPI_BRAZIER_WORLD_X_M,
      y: hearthY,
      z: hexPos.z + V2_TIPI_BRAZIER_WORLD_Z_M,
    });

    /**
     * Small ceremonial fire in front of the seated host: hex centre offset
     * by V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_Z_M (1 ft south), Y at terrain
     * + V2_TIPI_NPC_CEREMONIAL_FIRE_ABOVE_GROUND_M (1 ft above ground).
     * Reuses the brazier shader, scaled to ~30% (≈ 6 in flame). Lower
     * lightIntensity / distance keeps the warm fill local.
     */
    const ceremonialFireCtl = createTipiCampfire({
      scene,
      objects,
      x: hexPos.x + V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_X_M,
      y: platformY + V2_TIPI_NPC_CEREMONIAL_FIRE_ABOVE_GROUND_M,
      z: hexPos.z + V2_TIPI_NPC_CEREMONIAL_FIRE_LOCAL_Z_M,
      scale: V2_TIPI_NPC_CEREMONIAL_FIRE_SCALE,
      lightIntensity: 0.25,
      lightDistance: 1.0,
      anuIdOverride: "environment.tipi_1.ceremonial_fire",
      anuKindOverride: "tipi_ceremonial_fire",
      nameOverride: "effect_tipi_ceremonial_fire",
    });

    tipi.updateMatrixWorld(true);
    const apexBox = new THREE.Box3().setFromObject(tipi);
    const apexCenter = apexBox.getCenter(new THREE.Vector3());
    const smokeCtl = createTipiSmokePlume({
      scene,
      objects,
      x: apexCenter.x,
      y: apexBox.max.y + V2_TIPI_SMOKE_ABOVE_APEX_M,
      z: apexCenter.z,
    });

    const journalBalloon = createTipiJournalQuestBalloon({
      scene,
      objects,
      apexWorldX: apexCenter.x,
      apexWorldY: apexBox.max.y,
      apexWorldZ: apexCenter.z,
      liftAboveApexM: V2_TIPI_JOURNAL_BALLOON_ABOVE_APEX_M,
    });
    tipi.userData.journalQuestBalloonRoot = journalBalloon.root;
    /** Quest-1 Start Game pop handle — World.beginJournalStartGameIntro calls explode(). */
    tipi.userData.journalQuestBalloon = journalBalloon;

    let ambientEffectsT = 0;
    tipi.userData.tipiAmbientEffectsUpdate = (dt) => {
      ambientEffectsT += dt;
      fireCtl.update(dt);
      ceremonialFireCtl.update(dt);
      smokeCtl.update(dt);
      journalBalloon.update(ambientEffectsT, dt);
    };

    /* PiP ortho inner-circle discard: foliage / airborne VFX only — keep tipi/YB/platform visible under compass. */
    applyPipOrthoRingDiskClipToSubtree(fireCtl.group);
    applyPipOrthoRingDiskClipToSubtree(ceremonialFireCtl.group);
    applyPipOrthoRingDiskClipToSubtree(smokeCtl.group);
    applyPipOrthoRingDiskClipToSubtree(journalBalloon.root);

    tipi.userData.anuSubsystemIds = Object.freeze([
      platMesh.userData.anuId,
      tipi.userData.anuId,
      ybSeat?.root?.userData?.anuId ?? null,
      fireCtl.group.userData.anuId,
      ceremonialFireCtl.group.userData.anuId,
      smokeCtl.group.userData.anuId,
      journalBalloon.root.userData.anuId,
    ].filter(Boolean));

    worldPhysics.registerCollider({
      id: "structure.tipi_1.center.passable",
      x: hexPos.x,
      z: hexPos.z,
      radius: platRadius,
      object: tipi,
      passable: true,
      kind: "tipi_1",
    });

    /**
     * Asymmetric tipi collision (player-only block):
     *   • The tipi cone's scaled XZ footprint is ~5.5 m × 6.4 m, half-width
     *     ≈ 2.75 m. A 2.2 m solid collider radius blocks the player body
     *     from walking into the cone while leaving ~0.5 m of clearance to
     *     the visible cone wall (so the player can stand right at the
     *     doorway without clipping into geometry).
     *   • NPC.YB is NOT a physics body — `WorldPhysics.resolveBodyCollisions`
     *     only resolves bodies registered via `registerBody`, and the NPC
     *     controller writes `root.position` directly each frame. She passes
     *     through this collider freely, which is exactly the asymmetry the
     *     spec asks for: she can enter/exit her own tipi, the player can't.
     *   • Radius < platform radius (4.7 m) so the player can still walk on
     *     the deck around the tipi, near the ceremonial fire, etc.
     */
    worldPhysics.registerCollider({
      id: "structure.tipi_1.cone.player_block",
      x: hexPos.x,
      z: hexPos.z,
      radius: 2.2,
      object: null,
      passable: false,
      kind: "tipi_1_cone",
    });

    // Mossy rock next to tipi 1 — REMOVED May-2026 per user spec
    // "clear out and remove all the rocks on this scene, I dont like
    // any of them". `loadMossyRockGltfShared` + `plantMossyRockClone`
    // remain available in `WorldMossyRock.js` so BuildMode (or a future
    // map preset) can plant them on demand.

    console.log(
      "%c[World] Tipi 1 + sacred platform — legacy 1:1 (7.2m tipi, 4.7m platform)",
      "color:#d7ccc8;",
    );
    return tipi;
  } catch (err) {
    console.warn("[World] Tipi 1 load failed:", err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Tipi 2 — Brings Happiness Girl
// ──────────────────────────────────────────────────────────────────────────
//
// Parallel implementation of tipi 1 + NPC.YB, deliberately duplicated rather
// than refactored into a shared helper. The duplication is bounded (three
// functions: aim / attach / load) and trades a few hundred lines for zero
// risk to the existing tipi-1 path. When a third tipi owner lands and the
// duplication starts to bite, the right move is to fold all three through
// a single config-driven loader.

export function updateBringsHappinessPlayerAim(tipi, playerX, playerZ) {
  updateSeatedNpcPlayerAim(tipi, playerX, playerZ, {
    facingGroupKey: "bhgFacingGroup",
    seatRootKey: "bhgSeatRoot",
    travelMatsKey: "bhgTravelCircleMaterials",
    yawBiasRad: V2_NPC_BHG_TIPI2_PLAYER_AIM_YAW_BIAS_RAD,
  });
}

/**
 * Loads `NPC.BHG.glb` seated on the tipi 2 cylinder deck. Mirror of
 * `attachYellowButterflySeatedTipi1` with `bhg*` userData keys and the
 * `V2_NPC_BHG_TIPI2_*` tuning constants.
 */
async function attachBhgSeatedTipi2(scene, objects, platMesh, tipi, hexPos) {
  try {
    const gltf = await new GLTFLoaderWithDraco().loadAsync(NPC_BHG_URL);
    const model = gltf.scene;
    model.name = "population_npc_bhg_model";
    model.rotation.y = V2_NPC_BHG_TIPI2_MODEL_YAW_RAD;

    tagSeatedNpcMeshes(
      model,
      "npc_bhg_tipi2_rig_mesh",
      "population.npc.brings_happiness_girl.mesh",
    );

    const scaledHeight = fitSeatedNpcToGroup(
      model,
      V2_NPC_BHG_TIPI2_TARGET_HEIGHT_M,
      V2_NPC_BHG_TIPI2_SIZE_MULTIPLIER,
    );

    const root = new THREE.Group();
    root.name = "population_npc_brings_happiness_girl_tipi2_seated";
    root.userData.anuId = "population.npc.brings_happiness_girl";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
    root.userData.anuKind = "npc_bhg_tipi2_seated";
    root.userData.anuInteractable = true;
    root.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
    root.userData.anuCollision = "passable";
    root.userData.anuLegacyReference =
      "EnvironmentBuilder.js NPC.BHG — seated host of tipi 2";

    const bhgTravelCircleMats = addGoldTravelFloorDecalAtFeet(
      root,
      V2_NPC_BHG_TIPI2_GOLD_CIRCLE_RADIUS_M,
      V2_NPC_BHG_TIPI2_GOLD_CIRCLE_LIFT_M,
      { npcKey: "bhg", npcSlug: "brings_happiness_girl" },
    );

    const lift = V2_NPC_BHG_TIPI2_GOLD_CIRCLE_LIFT_M;
    const facingGroup = new THREE.Group();
    facingGroup.name = "population_npc_bhg_facing";
    facingGroup.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.POPULATION;
    facingGroup.userData.anuKind = "npc_bhg_facing_pivot";
    facingGroup.userData.anuId = "population.npc.brings_happiness_girl.facing_pivot";

    const arrow = createGoldTravelFacingArrowMesh(
      V2_NPC_BHG_TIPI2_GOLD_CIRCLE_RADIUS_M,
      lift + 0.015,
      { npcKey: "bhg", npcSlug: "brings_happiness_girl" },
    );
    facingGroup.add(model);
    facingGroup.add(arrow);

    const halo = createNpcEtherealHaloSprite(scaledHeight * 0.55, {
      npcKey: "bhg",
      npcSlug: "brings_happiness_girl",
    });
    halo.position.set(0, scaledHeight * 0.92, 0);
    facingGroup.add(halo);

    root.add(facingGroup);

    /** Same deck-top math used by tipi 1 — both platforms share the cylinder height. */
    const deckTop = platMesh.position.y + V2_TIPI_SACRED_PLATFORM_HEIGHT * 0.5;
    root.position.set(
      hexPos.x + V2_NPC_BHG_TIPI2_LOCAL_X_M,
      deckTop + V2_NPC_BHG_TIPI2_VERTICAL_TRIM_M - V2_NPC_BHG_TIPI2_SEAT_LOWER_M,
      hexPos.z + V2_NPC_BHG_TIPI2_LOCAL_Z_M,
    );

    scene.add(root);
    objects.push(root);

    /**
     * Clip discovery: BHG ships 5 NlaTrack-named clips in NPC.BHG.glb.
     * The legacy `js/EnvironmentBuilder.js` index mapping is the same as
     * YB (walk=0, idle=2, sit=3, wave=4) because BHG was rigged on the
     * same skeleton template. The NPCBehaviour controller does name-
     * search first then index fallback, so re-baked clip names will Just
     * Work without code changes.
     */
    const clips = gltf.animations ?? [];
    let sitClip = null;
    for (const c of clips) {
      const nm = String(c.name ?? "").toLowerCase();
      if (nm.includes("sit") || nm.includes("sitting") || nm.includes("003")) {
        sitClip = c;
        break;
      }
    }
    if (!sitClip && clips.length > 3) sitClip = clips[3];

    let mixer = null;
    if (sitClip) {
      mixer = new THREE.AnimationMixer(model);
      const act = mixer.clipAction(sitClip);
      act.setLoop(THREE.LoopRepeat, Infinity);
      act.clampWhenFinished = false;
      act.play();
      root.userData.anuActiveAnimation = { kind: "sit", clip: sitClip.name };
    }

    if (tipi) {
      tipi.userData.bhgNpcMixer = mixer;
      tipi.userData.bhgFacingGroup = facingGroup;
      tipi.userData.bhgSeatRoot = root;
      tipi.userData.bhgTravelCircleMaterials = bhgTravelCircleMats;

      if (mixer && clips.length > 0) {
        try {
          const physics = getRuntimeService("WorldPhysics");
          const getGroundY =
            physics && typeof physics.getGroundY === "function"
              ? physics.getGroundY.bind(physics)
              : null;
          if (getGroundY) {
            tipi.userData.bhgBehaviour = createTipiOwnerBehaviour({
              npcId: "npc_bhg_tipi2",
              tipi,
              root,
              facingGroup,
              model,
              mixer,
              clips,
              tipiCenter: { x: hexPos.x, z: hexPos.z },
              /** Same doorway-direction reasoning as tipi 1: south of centre. */
              entranceLocalXZ: { x: 0, z: -2.6 },
              getGroundY,
            });
          } else {
            console.warn(
              "[World] NPC.BHG tipi2 owner behaviour skipped — WorldPhysics unavailable.",
            );
          }
        } catch (behaviourErr) {
          console.warn("[World] NPC.BHG tipi2 owner behaviour wire failed:", behaviourErr);
        }
      }
    }

    console.log("%c[World] NPC.BHG seated at tipi 2", "color:#ce93d8;");
    return { root, mixer };
  } catch (e) {
    console.warn("[World] NPC.BHG seated load failed:", e);
    return null;
  }
}

/**
 * BHG-specific shader patch: paints two horizontal stripes on tipi 2 and
 * dims the baked yellow butterfly motifs everywhere else so the stripes
 * read as the dominant feature ("stripes_plus_suppression" per the user's
 * tipi 2 styling pick).
 *
 * Implementation uses **world Y** (via `modelMatrix * position` in the
 * vertex shader) compared against a per-material `uBhgMidY` uniform that
 * the caller seeds with the tipi's actual world-space vertical midpoint
 * (computed via `Box3.setFromObject` AFTER the tipi is placed in the
 * scene graph). World-space avoids any local-coordinate-system surprises
 * baked into the GLB (intermediate node transforms, non-zero pivot,
 * non-symmetric bbox).
 *
 * Geometry (all metres):
 *   • Band centred on `uBhgMidY`.
 *   • 6 inches = 0.1524 m → STRIPE_H constant.
 *   • 6 inches empty gap = 0.1524 m → GAP_FULL = 0.1524 m total → half = 0.0762 m.
 *   • Red below middle: world Y in [midY - 0.2286, midY - 0.0762]
 *   • Blue above middle: world Y in [midY + 0.0762, midY + 0.2286]
 *   • Outside bands: baseColor mixed 55% toward a flat canvas tan.
 *
 * Returns the uniforms object so the caller can update `uBhgMidY.value`
 * once the world-space midY is known.
 */
export function applyBhgStripeAndSuppressionShader(material) {
  material.userData.bhgStripeShader = true;
  const uniforms = { uBhgMidY: { value: 0 } };
  material.userData.bhgUniforms = uniforms;
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (typeof prior === "function") prior(shader);

    // Share the same uniform object between JS and the compiled shader so
    // updates to uniforms.uBhgMidY.value flow through without recompile.
    shader.uniforms.uBhgMidY = uniforms.uBhgMidY;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vBhgWorldY;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vBhgWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying float vBhgWorldY;
        uniform float uBhgMidY;
        const float BHG_GAP_HALF = 0.0762;    // 3" in metres (6" gap centred on midY)
        const float BHG_STRIPE_H = 0.1524;    // 6" stripe height in metres
        const vec3  BHG_STRIPE_RED      = vec3(0.82, 0.13, 0.11);
        const vec3  BHG_STRIPE_BLUE     = vec3(0.11, 0.20, 0.72);
        const vec3  BHG_SUPPRESS_CANVAS = vec3(0.62, 0.50, 0.36);
        const float BHG_SUPPRESS_MIX    = 0.55;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        {
          float bhgDy = vBhgWorldY - uBhgMidY;
          float bhgAbs = abs(bhgDy);
          bool bhgInBand =
            (bhgAbs > BHG_GAP_HALF) &&
            (bhgAbs < (BHG_GAP_HALF + BHG_STRIPE_H));
          if (bhgDy < 0.0 && bhgInBand) {
            diffuseColor.rgb = BHG_STRIPE_RED;
          } else if (bhgDy > 0.0 && bhgInBand) {
            diffuseColor.rgb = BHG_STRIPE_BLUE;
          } else {
            diffuseColor.rgb = mix(
              diffuseColor.rgb,
              BHG_SUPPRESS_CANVAS,
              BHG_SUPPRESS_MIX
            );
          }
        }`,
      );
  };
  material.needsUpdate = true;
  return uniforms;
}

/**
 * Tipi 2 — Brings Happiness Girl's tipi, +2 tile widths east of tipi 1
 * (one empty tile of grass between centres). Reuses tipi 1's GLB + platform
 * dimensions. No fire / smoke / ceremonial brazier on tipi 2 yet — those
 * are a follow-up if/when the village expands.
 */
export async function loadTipi2WithBhg({ scene, objects, worldPhysics }) {
  const hexPos = { x: V2_TIPI_2_CENTER_X_M, z: V2_TIPI_2_CENTER_Z_M };
  const platformY = terrainY(hexPos.x, hexPos.z);

  const platRadius = V2_TIPI_SACRED_PLATFORM_RADIUS;
  const platH = V2_TIPI_SACRED_PLATFORM_HEIGHT;
  /**
   * Sacred-circle platform — same procedural wooden build as tipi 1
   * (May-14 2026). Materials are cached at module scope inside
   * `WorldSacredPlatform.js`, so this second call uploads no new
   * canvases and the two decks read as a matched village pair.
   * Steps face south to mirror tipi 1's approach axis.
   */
  const platBuild = createSacredCirclePlatform({
    scene,
    objects,
    centerX: hexPos.x,
    centerZ: hexPos.z,
    terrainAtCenter: platformY,
    radius: platRadius,
    height: platH,
    key: "tipi_2",
    stepFacingRad: Math.PI / 4, // matches tipi 1 — 45° CCW (May-14 2026 user spec).
  });
  const platMesh = platBuild.platMesh;

  try {
    const gltf = await new GLTFLoaderWithDraco().loadAsync(TIPI_2_URL);
    const tipi = gltf.scene;
    tipi.name = "structure_tipi_2_bhg";

    const box = new THREE.Box3().setFromObject(tipi);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M;
    const sf = targetH / Math.max(size.y, 0.1);
    tipi.scale.set(sf, sf, sf);

    tipi.rotation.y = V2_TIPI_2_YAW_RAD;
    tipi.updateMatrixWorld(true);

    box.setFromObject(tipi);
    const center = box.getCenter(new THREE.Vector3());

    tipi.position.set(
      hexPos.x - center.x + tipi.position.x,
      platBuild.deckTopY - box.min.y - 0.02,
      hexPos.z - center.z + tipi.position.z,
    );

    tipi.userData.anuId = "structure.tipi_2.center";
    tipi.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    tipi.userData.anuKind = "tipi_2_non_colliding";
    tipi.userData.anuInteractable = true;
    tipi.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
    tipi.userData.anuCollision = "passable";
    tipi.userData.anuCollisionReason =
      "Tipi 2 cone has its own player-block collider; the GLB itself is passable in the object-graph traversal.";
    tipi.userData.anuLegacyReference =
      "EnvironmentBuilder.js TIPI yellowbutterfly variant — assigned to BHG (tipi 2)";

    platMesh.userData.buildingRoot = tipi;

    tipi.traverse((child) => {
      if (child.isMesh || child.isSkinnedMesh) {
        child.castShadow = false;
        child.receiveShadow = false;
        child.userData.anuCollision = "passable";
        child.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
        child.userData.anuKind = "tipi_2_mesh";
        const msh = (child.name || "mesh").replace(/\s+/g, "_").slice(0, 48);
        child.userData.anuId = `structure.tipi_2.mesh.${msh}`;

        /**
         * Clone every material before mutating it so tipi 1 cannot be
         * affected — both tipis load the same GLB and although `loadAsync`
         * returns separate gltf trees, sharing a material instance across
         * the two loads would couple their appearance. Cloning makes the
         * isolation explicit and is also where the BHG stripe + butterfly-
         * suppression shader patch lives (the source GLB has baked yellow
         * butterfly motifs we want to dim around BHG's red/blue band).
         */
        const sourceMats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        const patchedMats = sourceMats.map((srcMat) => {
          if (!srcMat) return srcMat;
          const m = srcMat.clone();
          m.name = (srcMat.name ?? "tipi2_mat") + "_bhg";
          if (m.roughness !== undefined) m.roughness = 0.9;
          if (m.metalness !== undefined) m.metalness = 0.0;
          if (m.emissive !== undefined) {
            m.emissive.setHex(0x000000);
            m.emissiveIntensity = 0.0;
          }
          m.transparent = false;
          m.depthWrite = true;
          // Same top-down map view fix as tipi 1 — see DoubleSide note above.
          m.side = THREE.DoubleSide;
          applyBhgStripeAndSuppressionShader(m);
          return m;
        });
        child.material = Array.isArray(child.material) ? patchedMats : patchedMats[0];
      }
    });

    /**
     * Now that the tipi has its final scale + position, compute the actual
     * world-space vertical midpoint and push it into every patched material's
     * `uBhgMidY` uniform. We use the shared uniform-object pattern in
     * `applyBhgStripeAndSuppressionShader` so updates flow through to the
     * compiled shader without forcing a recompile.
     */
    {
      const placedBbox = new THREE.Box3().setFromObject(tipi);
      const placedMidY = (placedBbox.min.y + placedBbox.max.y) * 0.5;
      tipi.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            const u = m?.userData?.bhgUniforms;
            if (u?.uBhgMidY) u.uBhgMidY.value = placedMidY;
          }
        }
      });
    }

    scene.add(tipi);
    objects.push(tipi);

    // v3 landscape-only opt-out — see matching block above tipi 1.
    const _v3SkipSeated =
      typeof window !== "undefined" && window._v3DisableSeatedNpcs === true;
    const bhgSeat = _v3SkipSeated
      ? null
      : await attachBhgSeatedTipi2(scene, objects, platMesh, tipi, hexPos);

    /**
     * Tipi 2 campfire + smoke (May-11 2026 user spec: "add a fire in middle
     * of tipi2 just like in tipi1 — same smoke, smaller fire by 50%").
     *
     *  • Position mirrors tipi 1: hex centre offset by the same
     *    `V2_TIPI_BRAZIER_WORLD_X/Z_M` constants so the brazier sits
     *    over the same spot on the deck regardless of which tipi.
     *  • The "50% smaller fire" is delivered via `scale: 0.5` on the
     *    flame group + a proportionally narrower fill-light range so
     *    the warm halo doesn't overflow the smaller silhouette. Tipi 1
     *    uses the default scale 1; tipi 2's fire is half the height /
     *    half the ember-fan width.
     *  • Smoke is intentionally NOT scaled — the user's wording was
     *    "same smoke". The plume sits the same `V2_TIPI_SMOKE_ABOVE_APEX_M`
     *    above the actual tipi-2 GLB apex.
     */
    const deckTopTipi2 = platMesh.position.y + V2_TIPI_SACRED_PLATFORM_HEIGHT * 0.5;
    const hearthYTipi2 = deckTopTipi2 + V2_TIPI_BRAZIER_ABOVE_DECK_M;
    const fireCtl = createTipiCampfire({
      scene,
      objects,
      x: hexPos.x + V2_TIPI_BRAZIER_WORLD_X_M,
      y: hearthYTipi2,
      z: hexPos.z + V2_TIPI_BRAZIER_WORLD_Z_M,
      scale: 0.5,
      lightIntensity: 0.42,
      lightDistance: 1.7,
      anuIdOverride: "environment.tipi_2.campfire",
      anuKindOverride: "tipi_campfire",
      nameOverride: "effect_tipi_2_campfire",
    });

    tipi.updateMatrixWorld(true);
    const apexBoxTipi2 = new THREE.Box3().setFromObject(tipi);
    const apexCenterTipi2 = apexBoxTipi2.getCenter(new THREE.Vector3());
    const smokeCtl = createTipiSmokePlume({
      scene,
      objects,
      x: apexCenterTipi2.x,
      y: apexBoxTipi2.max.y + V2_TIPI_SMOKE_ABOVE_APEX_M,
      z: apexCenterTipi2.z,
    });
    /**
     * Distinct anu-id for the tipi-2 plume — `createTipiSmokePlume` hard-
     * codes `environment.tipi_1.smoke_plume` because tipi 1 was the
     * original caller; rewrite it post-construction so the two plumes
     * don't collide in Anu's id namespace.
     */
    smokeCtl.group.name = "effect_tipi_2_smoke_plume";
    smokeCtl.group.userData.anuId = "environment.tipi_2.smoke_plume";

    /**
     * Quest-2 "Get Axe" prop: stone axe **outside** tipi 2's south-facing
     * doorway, biased toward **southeast** (+X, −Z from the sacred-circle
     * centre) so it rests on grass rather than the deck. Loads
     * `BACKUP/Assets/axe.glb` first with `./Assets/axe.glb` fallback.
     *
     * Slow yaw spin + gentle hover tag it as pickupable; `World.js`
     * raycasts `_v2QuestAxePickable` for click-to-collect + inventory flag.
     */
    let questAxeCtl = null;
    (async () => {
      try {
        let axeGltf = null;
        let loadErr = null;
        for (let u = 0; u < QUEST_AXE_GLBF_URLS.length; u++) {
          try {
            axeGltf = await new GLTFLoaderWithDraco().loadAsync(
              QUEST_AXE_GLBF_URLS[u],
            );
            break;
          } catch (e) {
            loadErr = e;
          }
        }
        if (!axeGltf) throw loadErr || new Error("quest axe GLB load failed");

        const axe = axeGltf.scene;
        axe.name = "item_quest_axe_tipi_2";
        axe.userData.anuId = "items.quest_axe.tipi_2";
        axe.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
        axe.userData.anuKind = "quest_axe_pickup";
        axe.userData.anuInteractable = true;
        axe.userData.anuInteractionVerbs = [ANU_INTERACTION_VERB.INSPECT];
        axe.userData._v2QuestAxePickable = true;

        // Fit to ~0.9 m so it reads as "child-scaled hand axe", not a prop log.
        const aBox = new THREE.Box3().setFromObject(axe);
        const aSize = new THREE.Vector3();
        aBox.getSize(aSize);
        const targetAxeH = 0.9;
        const aScale = targetAxeH / Math.max(aSize.y, 0.01);
        axe.scale.setScalar(aScale);
        axe.updateMatrixWorld(true);
        const fitBox = new THREE.Box3().setFromObject(axe);
        const fitCenter = fitBox.getCenter(new THREE.Vector3());

        const axXZ = getTipi2QuestAxeNominalXZ();
        const grassY = terrainY(axXZ.x, axXZ.z);
        const restY = grassY + 0.035 - fitBox.min.y;
        axe.position.set(
          axXZ.x - fitCenter.x + axe.position.x,
          restY + axe.position.y,
          axXZ.z - fitCenter.z + axe.position.z,
        );

        axe.traverse((ch) => {
          ch.userData._v2QuestAxePickable = true;
          if (ch.isMesh) {
            ch.userData.anuInteractable = true;
            ch.castShadow = false;
            ch.receiveShadow = true;
            ch.userData.anuKind = "quest_axe_mesh";
            ch.userData.anuId = `items.quest_axe.tipi_2.mesh.${(ch.name || "m").slice(0, 32)}`;
          }
        });

        scene.add(axe);
        objects.push(axe);

        // Hover + slow spin so it reads as a pickup rather than clutter.
        const baseY = axe.position.y;
        let axeT = 0;
        questAxeCtl = {
          root: axe,
          update: (dt) => {
            if (!axe.parent || axe.userData._v2QuestAxePickupAmbientOff) return;
            axeT += dt;
            axe.position.y = baseY + Math.sin(axeT * 1.25) * 0.035;
            axe.rotation.y += dt * 0.28;
          },
        };
        tipi.userData.questAxe = questAxeCtl;
      } catch (err) {
        console.warn(
          "[World] tipi 2 quest axe load failed — Get Axe step will skip the visible prop:",
          err,
        );
      }
    })();

    tipi.userData.tipiAmbientEffectsUpdate = (dt) => {
      fireCtl.update(dt);
      smokeCtl.update(dt);
      questAxeCtl?.update(dt);
    };

    applyPipOrthoRingDiskClipToSubtree(fireCtl.group);
    applyPipOrthoRingDiskClipToSubtree(smokeCtl.group);

    tipi.userData.anuSubsystemIds = Object.freeze([
      platMesh.userData.anuId,
      tipi.userData.anuId,
      bhgSeat?.root?.userData?.anuId ?? null,
      fireCtl.group.userData.anuId,
      smokeCtl.group.userData.anuId,
    ].filter(Boolean));

    worldPhysics.registerCollider({
      id: "structure.tipi_2.center.passable",
      x: hexPos.x,
      z: hexPos.z,
      radius: platRadius,
      object: tipi,
      passable: true,
      kind: "tipi_2",
    });

    /**
     * Same asymmetric-collision reasoning as tipi 1's cone collider:
     * blocks the player body but the NPC's `root.position.x/z` direct
     * writes are not gated by `WorldPhysics.resolveBodyCollisions`, so
     * BHG walks freely through her own doorway.
     */
    worldPhysics.registerCollider({
      id: "structure.tipi_2.cone.player_block",
      x: hexPos.x,
      z: hexPos.z,
      radius: 2.2,
      object: null,
      passable: false,
      kind: "tipi_2_cone",
    });

    console.log(
      `%c[World] Tipi 2 + BHG seated at (${hexPos.x.toFixed(2)}, ${hexPos.z.toFixed(2)}) — 1 tile gap east of tipi 1`,
      "color:#d7ccc8;",
    );
    return tipi;
  } catch (err) {
    console.warn("[World] Tipi 2 load failed:", err);
    return null;
  }
}
