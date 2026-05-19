/**
 * Sacred Adventures v2 — Build Mode.
 *
 * Two creative modes the player can toggle on top of the regular
 * walking gameplay:
 *
 *   • **Seed planting (T)** — click bare grass to drop a seed.
 *     The seed grows from a 5 cm sapling through 4 ease-out phases
 *     into a full ~5 m tree over `SEED_GROW_MS`. Per-seed wall-clock
 *     timestamp so reloads pick up where they left off (a seed
 *     planted 20 s ago is 2/3 of the way grown).
 *
 *   • **Tipi placement (B)** — click clear ground to drop a procedural
 *     tipi marker (cone + flag pole). 10–12 of these is the user's
 *     target "village" the kid is building.
 *
 * Persistence:
 *   localStorage `v2.build.<mapId>` → `{ seeds: [...], buildings: [...] }`
 *
 * Both modes share one pointer-capture handler that runs **before**
 * `World.js`'s pointerdown so click-to-move doesn't fight click-to-
 * place. ESC exits the active mode.
 *
 * Rendering cost:
 *   • Each seed/tree merges its trunk + 3 canopy cones into one
 *     BufferGeometry → 1 mesh per seed.
 *   • Each tipi: one Group of 4 procedural meshes (poles + cover +
 *     entrance flap).
 *   • All meshes opt into the shadow pass — they read as real
 *     anchored objects when the sun rakes across the meadow.
 */

import * as THREE from "three";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import { getActiveMapId, getActiveMap } from "./MapsConfig.js";
import { getRuntimeService } from "./RuntimeServices.js";
import { GLTFLoaderWithDraco } from "./gltfLoaderSetup.js";
import {
  loadMossyRockGltfShared,
  plantMossyRockClone,
} from "./WorldMossyRock.js";

/** Same GLB the Flora module uses for the canopy forest — sharing it
 *  means a planted seed matures into a tree visually identical to the
 *  surrounding forest. */
const TREE_GLB_URL = "./Assets/tree.glb";

/** Rock placement tuning. */
const ROCK_HEIGHT_MIN_M = 0.55;
const ROCK_HEIGHT_MAX_M = 1.35;
/** Cluster (shift-click) spawns 4–6 rocks inside this radius. */
const ROCKPILE_CLUSTER_RADIUS_M = 1.3;
const ROCKPILE_COUNT_MIN = 4;
const ROCKPILE_COUNT_MAX = 6;
const MAX_ROCKS = 80;

/** Reed placement tuning. */
const REED_MIN_STEMS = 4;
const REED_MAX_STEMS = 8;
const REED_CLUSTER_RADIUS_M = 0.55;
const MAX_REEDS = 60;

/* ─────────────────────── tunables ─────────────────────── */

/** Sapling → full-tree growth window. User spec May-2026:
 *  "make them grow 10x slower so kids can watch them" — so the
 *  original 30 s ease-out is now 5 minutes. A kid plants a seed and
 *  can come back later to see noticeable growth, or sit and watch
 *  the first sapling stretch toward the sky in real time. */
const SEED_GROW_MS = 300000;

/** Smallest scale fraction of the full tree at germination. 0.005 of
 *  a ~14 m GLB tree = ~7 cm — a true sprout. */
const SEED_START_FRACTION = 0.005;

/**
 * Per-species silhouette modifiers — same triplet Flora.js uses so
 * a maturing planted seed reads as a member of the same forest
 * (pine / squat-deciduous / spire). Distribution mirrors Flora's
 * 60/30/10 split so the planted-tree mix matches the canopy.
 */
const SEED_SPECIES_MOD = [
  Object.freeze({ yMul: 1.00, xzMul: 1.00, tintBoost: null }),
  Object.freeze({ yMul: 0.72, xzMul: 1.28, tintBoost: 0xfff0a8 }),
  Object.freeze({ yMul: 1.34, xzMul: 0.66, tintBoost: 0x8eb878 }),
];
function _rollSpecies() {
  const r = Math.random();
  return r < 0.6 ? 0 : r < 0.9 ? 1 : 2;
}

/** Cap on total planted seeds + buildings combined — protects against
 *  a kid spamming clicks. Hard but generous. */
const MAX_SEEDS = 60;
const MAX_BUILDINGS = 16;

/** Min spacing between any two seeds (m) so the forest reads natural. */
const SEED_MIN_SPACING_M = 2.0;
/** Min spacing between buildings (m). */
const BUILDING_MIN_SPACING_M = 6.0;
/** Min distance from existing world structures (pond / tipis) so the
 *  player can't plonk a building inside the sacred deck or the pool. */
const STRUCTURE_KEEPOUT_M = 4.5;

/* ─────────────────────── geometry templates ─────────────────────── */

/**
 * Build the per-tipi template Group. Returns a fresh Group each call
 * so each placement has its own transformable root. Keeps poly count
 * low — cone cover + 4 pole sticks + a small entrance flap.
 */
function buildTipiTemplate() {
  const group = new THREE.Group();
  // Cover — slightly tapered cone, cream colour.
  const coverGeom = new THREE.ConeGeometry(1.55, 3.4, 14, 1, true);
  coverGeom.translate(0, 1.7, 0);
  const coverMat = new THREE.MeshStandardMaterial({
    color: 0xe2d4a8,
    roughness: 0.88,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const cover = new THREE.Mesh(coverGeom, coverMat);
  cover.castShadow = true;
  cover.receiveShadow = true;
  group.add(cover);

  // Crossed poles poking out the top — 4 thin cylinders.
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x6e4a2c,
    roughness: 0.9,
    metalness: 0.0,
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 4.0, 6),
      poleMat,
    );
    // Tilt outward from the tipi apex.
    pole.position.set(Math.cos(a) * 0.15, 2.0, Math.sin(a) * 0.15);
    pole.rotation.z = Math.cos(a) * 0.18;
    pole.rotation.x = Math.sin(a) * 0.18;
    pole.castShadow = true;
    group.add(pole);
  }
  // Entrance — a small darker triangle facing the camera approach.
  const entranceGeom = new THREE.PlaneGeometry(0.55, 1.05);
  entranceGeom.translate(0, 0.525, 0);
  const entranceMat = new THREE.MeshStandardMaterial({
    color: 0x3a2a1e,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const entrance = new THREE.Mesh(entranceGeom, entranceMat);
  entrance.position.set(0, 0, 1.45);
  group.add(entrance);
  return group;
}

/**
 * Build a small reed cluster Group at the player's click point.
 * Procedural — handful of tapered stems with cattail heads + a few
 * blade leaves. Reads as a lakeside reed clump from gameplay range.
 */
function buildReedCluster() {
  const group = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x6a8d3a,
    roughness: 0.86,
    metalness: 0.0,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x6e4d2a,
    roughness: 0.92,
    metalness: 0.0,
  });
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x4f7a32,
    roughness: 0.78,
    side: THREE.DoubleSide,
  });

  const stemCount =
    REED_MIN_STEMS + Math.floor(Math.random() * (REED_MAX_STEMS - REED_MIN_STEMS + 1));
  for (let i = 0; i < stemCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * REED_CLUSTER_RADIUS_M;
    const px = Math.cos(a) * r;
    const pz = Math.sin(a) * r;
    const h = 0.85 + Math.random() * 0.6;
    // Stem.
    const stemGeom = new THREE.CylinderGeometry(0.015, 0.022, h, 5);
    stemGeom.translate(0, h * 0.5, 0);
    const stem = new THREE.Mesh(stemGeom, stemMat);
    stem.position.set(px, 0, pz);
    // Slight lean so the cluster isn't a row of toothpicks.
    stem.rotation.x = (Math.random() - 0.5) * 0.18;
    stem.rotation.z = (Math.random() - 0.5) * 0.18;
    stem.castShadow = true;
    stem.receiveShadow = true;
    group.add(stem);
    // Cattail head (only on the taller half).
    if (Math.random() < 0.65) {
      const headGeom = new THREE.CylinderGeometry(0.04, 0.045, 0.18, 7);
      headGeom.translate(0, h + 0.09, 0);
      const head = new THREE.Mesh(headGeom, headMat);
      head.position.set(px, 0, pz);
      head.rotation.copy(stem.rotation);
      head.castShadow = true;
      group.add(head);
    }
    // A blade leaf or two.
    if (Math.random() < 0.5) {
      const bladeGeom = new THREE.PlaneGeometry(0.08, h * 0.7);
      bladeGeom.translate(0, h * 0.45, 0);
      const blade = new THREE.Mesh(bladeGeom, bladeMat);
      blade.position.set(px, 0, pz);
      blade.rotation.y = Math.random() * Math.PI * 2;
      blade.rotation.x = (Math.random() - 0.5) * 0.3;
      blade.castShadow = true;
      blade.receiveShadow = true;
      group.add(blade);
    }
  }
  return group;
}

/* ─────────────────────── module ─────────────────────── */

export const BuildModeModule = {
  name: "BuildMode",

  _scene: null,
  _disposed: false,
  /** "off" | "seed" | "tipi" | "rock" | "reed" — active build mode. */
  _mode: "off",
  /** All planted seed entries: { root, plantedAt, species, baseScale }. */
  _seeds: [],
  /** All placed buildings: { root, kind }. */
  _buildings: [],
  /** Placed rocks: { root, h, yaw, mode: "single" | "pile" }. */
  _rocks: [],
  /** Placed reed clusters: { root, rotY }. */
  _reeds: [],
  /** Cached mossy rock GLB scene for cloning. */
  _rockTemplate: null,
  /** Live preview mesh while a mode is active. Cleared on exit. */
  _ghost: null,
  /** Cached tree.glb template Object3D — cloned for every seed. */
  _treeTemplate: null,
  /** Native bbox Y of the GLB so we can derive a "tree height = 1.0"
   *  normalisation factor regardless of the GLB's authored scale. */
  _treeOrigHeightM: 1,
  _hudRoot: null,
  _hudStatus: null,
  /** Cached references so the click handler doesn't have to dig per-frame. */
  _world: null,
  _terrainMesh: null,
  _raycaster: null,
  _ndc: null,
  /** Removable event listeners — held so unload() can clean up. */
  _pointerDown: null,
  _pointerMove: null,
  _keyDown: null,

  async load(scene) {
    if (this._disposed) return;
    this._scene = scene;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    // Load the same tree GLB the Flora module uses — planted seeds
    // mature into trees visually identical to the surrounding forest.
    // Build a once-loaded template; each seed `clone()`s it so the
    // geometry + materials are shared (memory-cheap; per-seed scale
    // animates the clone's root).
    try {
      const gltf = await new GLTFLoaderWithDraco().loadAsync(TREE_GLB_URL);
      const tpl = gltf.scene;
      // Centre the template on its XZ origin and rest its base at y=0
      // so per-seed `position.set(p.x, p.y, p.z)` places the trunk
      // base exactly on the terrain hit point.
      const box = new THREE.Box3().setFromObject(tpl);
      const size = new THREE.Vector3();
      box.getSize(size);
      const centre = box.getCenter(new THREE.Vector3());
      tpl.position.set(-centre.x, -box.min.y, -centre.z);
      tpl.updateMatrixWorld(true);
      // Promote shadows on each contained mesh so a planted tree
      // plants its own contact shadow.
      tpl.traverse((c) => {
        if (c.isMesh) {
          c.castShadow = true;
          c.receiveShadow = true;
        }
      });
      this._treeTemplate = tpl;
      this._treeOrigHeightM = Math.max(0.1, size.y);
    } catch (err) {
      console.warn(
        "[BuildMode] tree.glb load failed — seeds will be invisible:",
        err?.message ?? err,
      );
    }

    // Mossy rock GLB — re-used for player-placed rocks. Same loader
    // the (now-removed) world rocks used.
    try {
      const gltfRock = await loadMossyRockGltfShared();
      if (gltfRock?.scene) this._rockTemplate = gltfRock.scene;
    } catch (err) {
      console.warn(
        "[BuildMode] mossy rock GLB load failed — rock placement disabled:",
        err?.message ?? err,
      );
    }

    this._buildHud();
    this._wireInput();
    this._restoreFromStorage();

    console.log(
      "%c[BuildMode] 🌱 Press T to plant a seed, B to place a tipi, ESC to exit.",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update(delta) {
    if (this._disposed) return;
    // Advance seed growth phases. Wall-clock based so a long pause
    // (away tab, journal open) still advances the seedling.
    const now = performance.now();
    for (const seed of this._seeds) {
      const elapsed = now - seed.plantedAt;
      const t = Math.min(1, Math.max(0, elapsed / SEED_GROW_MS));
      // Ease-out cubic — fast early grow ("magic"), gentle settle late.
      const eased = 1 - Math.pow(1 - t, 3);
      // `baseScale` normalises the GLB's natural size to the active
      // map's target tree height. `growFrac` ramps from start fraction
      // to 1.0 across the grow window. Per-axis species multipliers
      // give pine / squat-deciduous / spire silhouettes.
      const growFrac = SEED_START_FRACTION + eased * (1 - SEED_START_FRACTION);
      const s = (seed.baseScale ?? 1) * growFrac;
      const mods = SEED_SPECIES_MOD[seed.species ?? 0] ?? SEED_SPECIES_MOD[0];
      seed.root.scale.set(s * mods.xzMul, s * mods.yMul, s * mods.xzMul);
      seed.root.userData.growT = t;
    }
  },

  unload(scene) {
    this._disposed = true;
    if (this._pointerDown) {
      document.removeEventListener("pointerdown", this._pointerDown, true);
    }
    if (this._pointerMove) {
      document.removeEventListener("pointermove", this._pointerMove, true);
    }
    if (this._keyDown) {
      window.removeEventListener("keydown", this._keyDown);
    }
    this._clearGhost();
    for (const s of this._seeds) scene.remove(s.root);
    for (const b of this._buildings) scene.remove(b.root);
    for (const r of this._rocks) scene.remove(r.root);
    for (const r of this._reeds) scene.remove(r.root);
    this._seeds = [];
    this._buildings = [];
    this._rocks = [];
    this._reeds = [];
    // The tree GLB template shares geometry+material with every clone
    // — disposing it would invalidate any still-rendering seed mesh.
    // Drop the reference; GC handles the cleanup once all clones are
    // gone (we just removed them above).
    this._treeTemplate = null;
    this._rockTemplate = null;
    if (this._hudRoot?.parentNode) this._hudRoot.parentNode.removeChild(this._hudRoot);
  },

  /* ─── HUD ─── */

  _buildHud() {
    const root = document.createElement("div");
    root.id = "v2-build-hud";
    root.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:14px",
      "transform:translateX(-50%)",
      "z-index:9500",
      "pointer-events:none",
      "user-select:none",
      "font-family:'Fredoka',system-ui,sans-serif",
      "font-size:12px",
      "padding:7px 14px",
      "border-radius:999px",
      "background:linear-gradient(180deg,rgba(28,22,12,0.92),rgba(14,10,6,0.92))",
      "border:1px solid rgba(251,192,45,0.22)",
      "box-shadow:0 4px 12px rgba(0,0,0,0.55)",
      "color:#ffe9a8",
      "letter-spacing:0.5px",
    ].join(";");
    root.innerHTML = `<span id="v2-build-hud-text"></span>`;
    document.body.appendChild(root);
    this._hudRoot = root;
    this._hudStatus = root.querySelector("#v2-build-hud-text");
    this._refreshHud();
  },

  _refreshHud() {
    if (!this._hudStatus) return;
    const seedCount = this._seeds.length;
    const buildingCount = this._buildings.length;
    const rockCount = this._rocks.length;
    const reedCount = this._reeds.length;
    let primary = "";
    if (this._mode === "seed") {
      primary = `🌱 PLANTING SEEDS  ·  click to plant  ·  ${seedCount}/${MAX_SEEDS}`;
    } else if (this._mode === "tipi") {
      primary = `🏕️ PLACING TIPIS  ·  click to build  ·  ${buildingCount}/${MAX_BUILDINGS}`;
    } else if (this._mode === "rock") {
      primary = `🪨 PLACING ROCKS  ·  click = single  ·  shift+click = pile  ·  ${rockCount}/${MAX_ROCKS}`;
    } else if (this._mode === "reed") {
      primary = `🌾 PLACING REEDS  ·  click to plant cluster  ·  ${reedCount}/${MAX_REEDS}`;
    } else {
      primary =
        `T = seed  ·  B = tipi  ·  R = rock  ·  L = reed  ` +
        `·  🌱 ${seedCount}  🏕️ ${buildingCount}  🪨 ${rockCount}  🌾 ${reedCount}`;
    }
    this._hudStatus.textContent = primary;
  },

  /* ─── input ─── */

  _wireInput() {
    this._keyDown = (ev) => {
      if (typeof window !== "undefined" && window._v2InputSuppressed) return;
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = ev.key?.toLowerCase();
      if (k === "t") {
        this._setMode(this._mode === "seed" ? "off" : "seed");
      } else if (k === "b") {
        this._setMode(this._mode === "tipi" ? "off" : "tipi");
      } else if (k === "r") {
        this._setMode(this._mode === "rock" ? "off" : "rock");
      } else if (k === "l") {
        this._setMode(this._mode === "reed" ? "off" : "reed");
      } else if (k === "escape" || k === "esc") {
        if (this._mode !== "off") this._setMode("off");
      }
    };
    window.addEventListener("keydown", this._keyDown);

    this._pointerMove = (ev) => {
      if (this._mode === "off" || !this._ghost) return;
      const point = this._raycastTerrain(ev);
      if (point) {
        this._ghost.position.set(point.x, point.y + 0.02, point.z);
        this._ghost.visible = true;
      } else if (this._ghost) {
        this._ghost.visible = false;
      }
    };
    document.addEventListener("pointermove", this._pointerMove, true);

    this._pointerDown = (ev) => {
      if (this._mode === "off") return;
      if (ev.button !== 0) return;
      // Suppress journal modal etc.
      if (typeof window !== "undefined" && window._v2InputSuppressed) return;
      const point = this._raycastTerrain(ev);
      if (!point) return;
      // Block the World pointerdown handler so we don't also start a
      // smart-nav walk to the click point.
      ev.stopImmediatePropagation();
      ev.preventDefault();
      if (this._mode === "seed") this._tryPlantSeed(point);
      else if (this._mode === "tipi") this._tryPlaceTipi(point);
      else if (this._mode === "rock") this._tryPlaceRock(point, ev.shiftKey);
      else if (this._mode === "reed") this._tryPlaceReed(point);
    };
    document.addEventListener("pointerdown", this._pointerDown, true);
  },

  _raycastTerrain(ev) {
    const world = this._resolveWorld();
    const canvas = world?._canvas;
    const camera = world?._camera;
    const terrain = world?._terrainRaycastMesh;
    if (!canvas || !camera || !terrain) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;
    this._ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this._ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._ndc, camera);
    const hits = this._raycaster.intersectObject(terrain, false);
    return hits.length ? hits[0].point.clone() : null;
  },

  _resolveWorld() {
    if (this._world) return this._world;
    this._world =
      window.anuOrchestrator?._activeModuleInstances?.World ?? null;
    return this._world;
  },

  /* ─── mode control ─── */

  _setMode(mode) {
    this._mode = mode;
    this._clearGhost();
    if (mode === "seed") {
      this._ghost = this._buildSeedMesh();
      // Show the ghost at ~60 % final size so the player sees what
      // their seed will become without crowding the view.
      const map = getActiveMap();
      const ghostHeight = (map.flora?.treeHeightM ?? 8) * 0.6;
      const ghostScale = ghostHeight / Math.max(0.1, this._treeOrigHeightM);
      this._ghost.scale.setScalar(ghostScale);
      this._applyGhostMaterial(this._ghost);
      this._scene.add(this._ghost);
    } else if (mode === "tipi") {
      this._ghost = buildTipiTemplate();
      this._applyGhostMaterial(this._ghost);
      this._scene.add(this._ghost);
    } else if (mode === "rock" && this._rockTemplate) {
      this._ghost = this._rockTemplate.clone(true);
      // Best-effort uniform scale so the ghost reads at human size.
      this._ghost.scale.setScalar(0.6);
      this._applyGhostMaterial(this._ghost);
      this._scene.add(this._ghost);
    } else if (mode === "reed") {
      this._ghost = buildReedCluster();
      this._applyGhostMaterial(this._ghost);
      this._scene.add(this._ghost);
    }
    this._refreshHud();
  },

  _clearGhost() {
    if (this._ghost) {
      this._scene.remove(this._ghost);
      this._ghost.traverse?.((c) => {
        if (c.isMesh) {
          c.geometry?.dispose?.();
          if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose());
          else c.material?.dispose?.();
        }
      });
      this._ghost = null;
    }
  },

  _applyGhostMaterial(root) {
    // Translucent yellow tint over whatever the underlying geometry has —
    // reads as "preview, not placed yet".
    root.traverse?.((c) => {
      if (!c.isMesh) return;
      c.material = c.material.clone();
      if (c.material.color) c.material.color.lerp(new THREE.Color(0xffe9a8), 0.4);
      c.material.transparent = true;
      c.material.opacity = 0.55;
      c.material.depthWrite = false;
      c.castShadow = false;
      c.receiveShadow = false;
    });
  },

  /* ─── placement ─── */

  _tryPlantSeed(point) {
    if (this._seeds.length >= MAX_SEEDS) {
      this._toast(`🌱 Max ${MAX_SEEDS} seeds — clear some first`);
      return;
    }
    if (!this._isAllowedPosition(point, "seed")) {
      this._toast("Too close to another seed");
      return;
    }
    this._plantSeed(point, performance.now(), true /* persist */);
    this._refreshHud();
  },

  _plantSeed(point, plantedAt, persist, opts = {}) {
    const map = getActiveMap();
    const targetHeightM = map.flora?.treeHeightM ?? 8;
    // `baseScale` normalises the GLB's authored size to the map's
    // target tree height. Per-seed `±15 %` jitter gives a natural mix.
    const heightJitter = 0.85 + Math.random() * 0.3;
    const baseScale =
      (targetHeightM * heightJitter) / Math.max(0.1, this._treeOrigHeightM);
    const species = opts.species ?? _rollSpecies();
    const root = this._buildSeedMesh();
    root.position.set(point.x, point.y, point.z);
    root.rotation.y = Math.random() * Math.PI * 2;
    // Start visible at sprout fraction so the kid sees something the
    // moment the click lands; growth loop ramps it from there.
    const mods = SEED_SPECIES_MOD[species] ?? SEED_SPECIES_MOD[0];
    const s0 = baseScale * SEED_START_FRACTION;
    root.scale.set(s0 * mods.xzMul, s0 * mods.yMul, s0 * mods.xzMul);
    root.name = `build_seed_${this._seeds.length}`;
    root.userData.anuId = `build.seed.${this._seeds.length}`;
    root.userData.anuKind = "player_planted_tree";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    this._scene.add(root);
    this._seeds.push({
      root,
      plantedAt,
      species,
      baseScale,
    });
    if (persist) this._saveToStorage();
  },

  /** Build a fresh tree-clone from the cached GLB scene. Returns a
   *  Group so `position` / `rotation` / `scale` are independent per
   *  instance; the geometry + materials are shared with the template
   *  (Three.js Object3D.clone(true) preserves the reference). */
  _buildSeedMesh() {
    if (!this._treeTemplate) {
      // Defensive — return an empty group so growth loop math doesn't
      // crash when the GLB failed to load.
      return new THREE.Group();
    }
    return this._treeTemplate.clone(true);
  },

  _tryPlaceTipi(point) {
    if (this._buildings.length >= MAX_BUILDINGS) {
      this._toast(`🏕️ Max ${MAX_BUILDINGS} buildings — clear some first`);
      return;
    }
    if (!this._isAllowedPosition(point, "tipi")) {
      this._toast("Too close to another building or existing structure");
      return;
    }
    this._placeTipi(point, true /* persist */);
    this._refreshHud();
  },

  _placeTipi(point, persist) {
    const root = buildTipiTemplate();
    // Aim entrance toward the world origin (player's spawn-side) so a
    // ring of tipis looks inward-facing from any spot.
    const ang = Math.atan2(-point.x, -point.z);
    root.rotation.y = ang + Math.random() * 0.3 - 0.15;
    root.position.set(point.x, point.y, point.z);
    root.name = `build_tipi_${this._buildings.length}`;
    root.userData.anuId = `build.tipi.${this._buildings.length}`;
    root.userData.anuKind = "player_placed_tipi";
    root.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.STRUCTURES;
    this._scene.add(root);
    this._buildings.push({ root, kind: "tipi" });
    if (persist) this._saveToStorage();
  },

  /* ─── rocks ─── */

  _tryPlaceRock(point, isPile) {
    if (!this._rockTemplate) {
      this._toast("rock asset missing");
      return;
    }
    if (this._rocks.length >= MAX_ROCKS) {
      this._toast(`🪨 Max ${MAX_ROCKS} rocks — clear some first`);
      return;
    }
    if (!this._isAllowedPosition(point, "rock")) {
      this._toast("That spot belongs to the world — pick somewhere else");
      return;
    }
    if (isPile) {
      const count =
        ROCKPILE_COUNT_MIN +
        Math.floor(Math.random() * (ROCKPILE_COUNT_MAX - ROCKPILE_COUNT_MIN + 1));
      for (let i = 0; i < count; i++) {
        if (this._rocks.length >= MAX_ROCKS) break;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * ROCKPILE_CLUSTER_RADIUS_M;
        const p = new THREE.Vector3(
          point.x + Math.cos(a) * r,
          point.y,
          point.z + Math.sin(a) * r,
        );
        // The pile picks slightly smaller stones than a single-click rock
        // so the cluster reads as "tumbled together", not "five boulders".
        this._placeRock(p, true /* persist */, /* heightBias */ 0.7);
      }
    } else {
      this._placeRock(point, true, 1.0);
    }
    this._refreshHud();
  },

  _placeRock(point, persist, heightBias = 1.0) {
    const h =
      (ROCK_HEIGHT_MIN_M +
        Math.random() * (ROCK_HEIGHT_MAX_M - ROCK_HEIGHT_MIN_M)) *
      heightBias;
    const yaw = Math.random() * Math.PI * 2;
    const rock = plantMossyRockClone({
      templateScene: this._rockTemplate,
      scene: this._scene,
      objects: null,
      x: point.x,
      z: point.z,
      yaw,
      targetHeightM: h,
      nameSuffix: `build_${this._rocks.length}`,
    });
    if (!rock) return;
    rock.userData.anuKind = "player_placed_rock";
    rock.userData.anuId = `build.rock.${this._rocks.length}`;
    rock.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    this._rocks.push({ root: rock, h, yaw });
    if (persist) this._saveToStorage();
  },

  /* ─── reeds ─── */

  _tryPlaceReed(point) {
    if (this._reeds.length >= MAX_REEDS) {
      this._toast(`🌾 Max ${MAX_REEDS} reed clumps — clear some first`);
      return;
    }
    if (!this._isAllowedPosition(point, "reed")) {
      this._toast("Too close to another reed");
      return;
    }
    this._placeReed(point, true);
    this._refreshHud();
  },

  _placeReed(point, persist) {
    const cluster = buildReedCluster();
    cluster.position.set(point.x, point.y, point.z);
    cluster.rotation.y = Math.random() * Math.PI * 2;
    cluster.name = `build_reed_${this._reeds.length}`;
    cluster.userData.anuId = `build.reed.${this._reeds.length}`;
    cluster.userData.anuKind = "player_placed_reed_cluster";
    cluster.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.FLORA;
    this._scene.add(cluster);
    this._reeds.push({ root: cluster, rotY: cluster.rotation.y });
    if (persist) this._saveToStorage();
  },

  /* ─── placement validity ─── */

  _isAllowedPosition(point, kind) {
    const map = getActiveMap();
    const clearingR = map.terrain.CLEARING_R;
    // Inside the valley floor only — past the hill ring the player
    // can't really walk anyway, but rejecting placements there keeps
    // the village contained.
    if (point.x * point.x + point.z * point.z > clearingR * clearingR) {
      this._toast("Place inside the valley floor");
      return false;
    }
    // Per-kind spacing + peer list. Rocks are allowed to overlap
    // freely (a "pile" relies on that), so they skip the peer check;
    // reeds want minimal spacing so individual clumps are distinct.
    let spacing = 0;
    let peers = null;
    if (kind === "seed") { spacing = SEED_MIN_SPACING_M; peers = this._seeds; }
    else if (kind === "tipi") { spacing = BUILDING_MIN_SPACING_M; peers = this._buildings; }
    else if (kind === "reed") { spacing = 1.2; peers = this._reeds; }
    // kind === "rock" → no peer-spacing check (piles intentionally overlap).
    if (peers && spacing > 0) {
      for (const p of peers) {
        const dx = p.root.position.x - point.x;
        const dz = p.root.position.z - point.z;
        if (dx * dx + dz * dz < spacing * spacing) return false;
      }
    }
    // Rocks + reeds are decorative — they can sit right next to the
    // tipi sacred platforms without breaking gameplay. Skip the
    // structure keep-out for those two kinds.
    if (kind === "rock" || kind === "reed") return true;
    // Stay clear of the existing tipis (origin + (V2_TILE_WORLD*2, 0))
    // and the pool. Hardcoded for now — when MapsConfig owns pond
    // position too, this can read from the active map.
    const KEEPOUT = [
      { x: 0, z: 0, r: STRUCTURE_KEEPOUT_M },
      { x: 21.7, z: 0, r: STRUCTURE_KEEPOUT_M },
      { x: 10, z: 26, r: 28.5 }, // pool basin radius + small buffer
    ];
    for (const k of KEEPOUT) {
      const dx = k.x - point.x;
      const dz = k.z - point.z;
      if (dx * dx + dz * dz < k.r * k.r) {
        this._toast("That spot belongs to the world — pick somewhere else");
        return false;
      }
    }
    return true;
  },

  /* ─── persistence ─── */

  _storageKey() {
    return `v2.build.${getActiveMapId()}`;
  },

  _saveToStorage() {
    try {
      const payload = {
        seeds: this._seeds.map((s) => ({
          x: s.root.position.x,
          y: s.root.position.y,
          z: s.root.position.z,
          plantedAt: s.plantedAt,
          rotY: s.root.rotation.y,
          species: s.species,
          baseScale: s.baseScale,
        })),
        buildings: this._buildings.map((b) => ({
          x: b.root.position.x,
          y: b.root.position.y,
          z: b.root.position.z,
          rotY: b.root.rotation.y,
          kind: b.kind,
        })),
        rocks: this._rocks.map((r) => ({
          x: r.root.position.x,
          y: r.root.position.y,
          z: r.root.position.z,
          h: r.h,
          yaw: r.yaw,
        })),
        reeds: this._reeds.map((r) => ({
          x: r.root.position.x,
          y: r.root.position.y,
          z: r.root.position.z,
          rotY: r.rotY,
        })),
      };
      window.localStorage?.setItem(this._storageKey(), JSON.stringify(payload));
    } catch (_e) {
      // localStorage blocked — placements are session-only. Non-fatal.
    }
  },

  _restoreFromStorage() {
    try {
      const raw = window.localStorage?.getItem(this._storageKey());
      if (!raw) return;
      const data = JSON.parse(raw);
      // May-17 2026 user spec (6th repeat of "remove small trees"): the
      // persisted BuildMode seeds were growing back into small trees on
      // every reload even after Trees / Fauna / Stonehenge were stripped
      // from the default boot. Drop the seed-restore path AND wipe any
      // seeds already in storage so this never re-appears. Buildings /
      // rocks / reeds restoration continues — the user hasn't asked to
      // remove those.
      if (Array.isArray(data?.seeds) && data.seeds.length) {
        try {
          const cleaned = { ...data, seeds: [] };
          window.localStorage?.setItem(
            this._storageKey(),
            JSON.stringify(cleaned),
          );
        } catch (_e) {
          /* private mode — fine, just don't re-plant from `data.seeds` below */
        }
      }
      if (Array.isArray(data?.buildings)) {
        for (const b of data.buildings) {
          if (typeof b?.x !== "number" || typeof b?.z !== "number") continue;
          const point = new THREE.Vector3(b.x, b.y ?? 0, b.z);
          this._placeTipi(point, false);
          const just = this._buildings[this._buildings.length - 1];
          if (typeof b.rotY === "number") just.root.rotation.y = b.rotY;
        }
      }
      if (Array.isArray(data?.rocks)) {
        for (const r of data.rocks) {
          if (typeof r?.x !== "number" || typeof r?.z !== "number") continue;
          const point = new THREE.Vector3(r.x, r.y ?? 0, r.z);
          // Reuse the saved height/yaw so the rock looks identical
          // across reloads instead of re-rolling random size.
          if (this._rockTemplate) {
            const rock = plantMossyRockClone({
              templateScene: this._rockTemplate,
              scene: this._scene,
              objects: null,
              x: r.x,
              z: r.z,
              yaw: typeof r.yaw === "number" ? r.yaw : 0,
              targetHeightM: typeof r.h === "number" ? r.h : 1.0,
              nameSuffix: `build_${this._rocks.length}_restored`,
            });
            if (rock) {
              rock.userData.anuKind = "player_placed_rock";
              this._rocks.push({
                root: rock,
                h: typeof r.h === "number" ? r.h : 1.0,
                yaw: typeof r.yaw === "number" ? r.yaw : 0,
              });
            }
          }
        }
      }
      if (Array.isArray(data?.reeds)) {
        for (const r of data.reeds) {
          if (typeof r?.x !== "number" || typeof r?.z !== "number") continue;
          const point = new THREE.Vector3(r.x, r.y ?? 0, r.z);
          this._placeReed(point, false);
          const just = this._reeds[this._reeds.length - 1];
          if (typeof r.rotY === "number") {
            just.root.rotation.y = r.rotY;
            just.rotY = r.rotY;
          }
        }
      }
      this._refreshHud();
      if (
        this._seeds.length ||
        this._buildings.length ||
        this._rocks.length ||
        this._reeds.length
      ) {
        console.log(
          `%c[BuildMode] Restored ${this._seeds.length} seeds + ${this._buildings.length} buildings + ${this._rocks.length} rocks + ${this._reeds.length} reed clusters for map ${getActiveMapId()}.`,
          "color:#80d0a6;",
        );
      }
    } catch (_e) {
      // Corrupt JSON — fall back to empty.
    }
  },

  /* ─── feedback ─── */

  _toastT: 0,
  _toast(msg) {
    if (!this._hudStatus) return;
    const prev = this._hudStatus.textContent;
    this._hudStatus.textContent = msg;
    const myId = ++this._toastT;
    setTimeout(() => {
      if (this._hudStatus && this._toastT === myId) this._refreshHud();
    }, 1700);
    // Keep prev unused but referenced so eslint-no-unused doesn't fire.
    void prev;
  },

  /* ─── public API ─── */

  /** Wipe all placements for the current map. Exposed on
   *  `window._v2BuildClear()` for the player. */
  clearAll() {
    for (const s of this._seeds) this._scene.remove(s.root);
    for (const b of this._buildings) this._scene.remove(b.root);
    for (const r of this._rocks) this._scene.remove(r.root);
    for (const r of this._reeds) this._scene.remove(r.root);
    this._seeds = [];
    this._buildings = [];
    this._rocks = [];
    this._reeds = [];
    this._saveToStorage();
    this._refreshHud();
  },
};

if (typeof window !== "undefined") {
  window._v2BuildClear = () => {
    const mod =
      window.anuOrchestrator?._activeModuleInstances?.BuildMode;
    mod?.clearAll?.();
  };
}
