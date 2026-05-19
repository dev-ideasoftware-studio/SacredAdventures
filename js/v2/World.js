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

import * as THREE from "three";
import {
  V2_AVATAR_GROUNDED_FEET_OFFSET_M,
  V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M,
  V2_INTRO_TIPI1_APPROACH_X_M,
  V2_INTRO_TIPI1_APPROACH_Z_M,
  V2_INTRO_YB_GREET_HOLD_MS,
  V2_JOURNAL_YB_FRONT_CONE_RAD,
  V2_JOURNAL_YB_PROXIMITY_M,
  V2_PLAYER_MOVE_SPEED_MPS,
  V2_POND_ENCLAVE_CENTER_X_M,
  V2_POND_ENCLAVE_CENTER_Z_M,
  V2_RABBIT_WARREN_CHASM_RADIUS_M,
  V2_RABBIT_WARREN_HUB_X_M,
  V2_RABBIT_WARREN_HUB_Z_M,
  V2_IDLE_CINEMATIC_ENTER_S,
  V2_SMART_NAV_ARRIVE_TOLERANCE_M,
  V2_TILE_WORLD,
  V2_TIPI_2_CENTER_X_M,
  V2_TIPI_2_CENTER_Z_M,
  V2_TIPI_SACRED_PLATFORM_RADIUS,
} from "./constants.js";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import { ANU_SIMULATION_DOMAIN } from "./anu/SimulationController.js";
import {
  clearRuntimeService,
  registerRuntimeService,
} from "./RuntimeServices.js";
import { applyNeuHexShader, terrainY } from "./WorldTerrain.js";
import { getActiveMap } from "./MapsConfig.js";
import {
  GRAVITY,
  JUMP_IMPULSE,
  PLAYER_COLLISION_RADIUS,
  PLAYER_HEIGHT,
  WorldPhysics,
} from "./WorldPhysics.js";
import { createWorldAvatarController } from "./WorldAvatar.js";
import {
  buildWorldPlayerState,
  clearPlayerInput,
  syncAutowalkFromHeldKeys,
  wirePlayerInput,
} from "./WorldPlayerController.js";
import {
  loadCenterTipi,
  loadTipi2WithBhg,
  getTipi2QuestAxeNominalXZ,
  updateBringsHappinessPlayerAim,
  updateYellowButterflyPlayerAim,
} from "./WorldStructures.js";
import { createWorldNatureSpiritController } from "./WorldNatureSpirit.js";
import { attachWorldCelestial } from "./WorldCelestial.js";
import { createClickToMoveMarker } from "./ClickToMoveMarker.js";

function disposeSubtreeGpuResources(root) {
  if (!root) return;
  root.traverse((child) => {
    child.geometry?.dispose?.();
    const mat = child.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
    else mat?.dispose?.();
  });
}

const FOOT_TO_M = 0.3048;
const DEFAULT_CAMERA_FOV = 58;
const IDLE_FPV_HEAD_FORWARD = 5 * FOOT_TO_M;
const FOLLOW_CAMERA_DIST = V2_TILE_WORLD;
const FOLLOW_CAMERA_HEIGHT = 4 * FOOT_TO_M;
/** Gold quest balloon sits above tipi 1 — max raycast distance for opener clicks (~160 ft). */
const JOURNAL_GUIDE_BALLOON_MAX_PICK_M = 52;
/** Tipi 2 quest axe — click pickup range (~22 m). */
const QUEST_AXE_MAX_PICK_DISTANCE_M = 22;
/** Chase / idle camera must stay this far above analytic terrain at (cam.x, cam.z) so steep hills do not expose back faces / sky holes. */
const CHASE_CAMERA_MIN_ABOVE_TERRAIN_M = 0.72;
/** Smart-nav polyline: spacing between intermediate waypoints (long cross-village paths). */
const SMART_NAV_WAYPOINT_STEP_M = Math.max(4.5, V2_TILE_WORLD * 0.55);
/**
 * Panoramic idle (May-17 2026): **full 360°** orbit around the avatar with
 * smooth random changes to radius, height (pitch), zoom (FOV), and orbit
 * direction/speed. Framing keeps feet + travel ring + figurine in shot; wide
 * radii show village / pond / warren at sweeping angles.
 */
const CINEMATIC_ORBIT_PARAM_REFRESH_MS = 7200;
const CINEMATIC_ORBIT_PARAM_LERP_TAU_S = 5.15;
/** Rev period bounds — ~11–48 s per full rotation at target ω (before linger micro-pauses). */
const CINEMATIC_ORBIT_OMEGA_MIN = (Math.PI * 2) / 48;
const CINEMATIC_ORBIT_OMEGA_MAX = (Math.PI * 2) / 11;
const CINEMATIC_RADIUS_MIN_M = V2_TILE_WORLD * 0.58;
const CINEMATIC_RADIUS_MAX_M = V2_TILE_WORLD * 5.35;
/** Camera pitch above XZ toward avatar pivot (rad): low = more horizon, high = more birds-eye. */
const CINEMATIC_PITCH_MIN_RAD = 0.07;
const CINEMATIC_PITCH_MAX_RAD = 0.64;
const CINEMATIC_FOV_MIN = 36;
const CINEMATIC_FOV_MAX = 59;
/** Heavier camera inertia during idle orbit vs gameplay chase (chase branch uses ~0.012). */
const CINEMATIC_CAMERA_POSITION_LERP_EXP_BASE = 0.004;

function clampChaseCameraAboveTerrainXZ(v, terrainYFn) {
  const minY = terrainYFn(v.x, v.z) + CHASE_CAMERA_MIN_ABOVE_TERRAIN_M;
  if (v.y < minY) v.y = minY;
}

function expToward(current, target, delta, tauS) {
  if (!(tauS > 1e-6)) return target;
  return current + (target - current) * (1 - Math.exp(-delta / tauS));
}

function randomCinematicOrbitOmegaTgt() {
  if (Math.random() < 0.13) {
    return (Math.random() - 0.5) * 0.038;
  }
  const sign = Math.random() < 0.5 ? -1 : 1;
  return (
    sign *
    (CINEMATIC_ORBIT_OMEGA_MIN +
      Math.random() * (CINEMATIC_ORBIT_OMEGA_MAX - CINEMATIC_ORBIT_OMEGA_MIN))
  );
}

function randomCinematicRadiusTgt() {
  return (
    CINEMATIC_RADIUS_MIN_M +
    Math.random() * (CINEMATIC_RADIUS_MAX_M - CINEMATIC_RADIUS_MIN_M)
  );
}

function randomCinematicPitchTgt() {
  return (
    CINEMATIC_PITCH_MIN_RAD +
    Math.random() * (CINEMATIC_PITCH_MAX_RAD - CINEMATIC_PITCH_MIN_RAD)
  );
}

function randomCinematicFovTgt() {
  return CINEMATIC_FOV_MIN + Math.random() * (CINEMATIC_FOV_MAX - CINEMATIC_FOV_MIN);
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
  _playerBody: null, // PhysicsBody for the camera/player
  _playerPos: new THREE.Vector3(),
  _walkDistance: 0,
  _lastWalkX: 0,
  _lastWalkZ: 0,

  _avatar: createWorldAvatarController(),
  /** Lazy-built in `load()` — nature-spirit stag controller (20 ft hologram on 5-min cycle). */
  _natureSpirit: null,
  /** `WorldCelestial` api handle — owns sky dome + stars + moon + beams. */
  _celestial: null,
  _feetScratch: new THREE.Vector3(),
  _avatarFeetScratch: new THREE.Vector3(),
  _back: new THREE.Vector3(),
  _lookTarget: new THREE.Vector3(),
  _cameraPosSmooth: new THREE.Vector3(),
  _cameraLookSmooth: new THREE.Vector3(),
  _cameraSmoothReady: false,
  /** Smoothed camera.up vector — only used when the fishing override
   *  pushes a horizontal up axis. Eased rather than snapped so the basis
   *  stays non-degenerate during the chase→top-down camera transition. */
  _cameraUpSmooth: new THREE.Vector3(0, 1, 0),
  _tmpAvoidVelocity: new THREE.Vector3(),
  _autoWalk: {
    active: false,
    key: null,
    startedByHoldAt: 0,
    dirX: 0,
    dirZ: -1,
  },
  _keyDownAt: {},
  /** Rising-edge gate on SEATED proximity (WorldModule edges). Suppressed during journal Start Game intro. */
  _journalTipiProximityWasInside: false,
  /** When true, `_v2OpenJournalFromProximity` is not invoked (YB intro walk crosses the rim). */
  _suppressJournalProximityOpen: false,
  _tipi: null,
  /** Tipi 2 — Brings Happiness Girl's tipi, +2 tile widths east of tipi 1. */
  _tipi2: null,
  /** FPV chase / idle forward vs top-down map on main canvas (PiP shows the other). */
  _mainCanvasMapView: false,
  /** Set in `load()` — needed for golden journal balloon picker raycasts. */
  _scene: null,
  _journalGuideRoot: null,
  _terrainRaycastMesh: null,
  /**
   * Scripted navigation: `{ segments, segIdx, tolerance, wpTol, onArrive }`.
   * Segments are auto-generated along the initial straight line; physics steering
   * still avoids obstacles each frame.
   */
  _smartNavGoal: null,
  _navScriptedDriving: false,
  /**
   * Click-to-move ground marker (gold X + dashed trail). Lifetime is
   * exactly the lifetime of `_smartNavGoal`: created when smart-nav
   * engages, disposed on arrival or when a new goal overwrites it.
   */
  _clickToMoveMarker: null,
  _journalRaycaster: null,
  _journalNdcScratch: null,
  _onCanvasPointerPrimary: null,
  /**
   * Tipi 2 stone-axe pickup vignette — `{ root, light, t, dur, baseScale, matPulse }`.
   */
  _tipi2AxePickupFx: null,

  /** Seconds of true stand-still before cinematic orbit + UI hide (see V2_IDLE_CINEMATIC_ENTER_S). */
  _idleStandSeconds: 0,
  _cinematicIdleActive: false,
  /**
   * Whether the cinematic idle decision should currently override the
   * avatar's locomotion to `sit`. True iff cinematic idle is active AND
   * the player is standing inside any sacred-circle building platform.
   * Recomputed each tick; gates the `desiredLocomotion = "sit"` branch
   * below so we never accidentally play sit off-platform.
   */
  _cinematicSitActive: false,
  _lastCinematicUiHidden: false,
  _lastAvatarCinematicDrawThrough: false,
  /** Synced with `document.body.v2-village-view` — top-down HUD column layout */
  _lastVillageViewBodyClass: false,
  /**
   * Panoramic idle camera — full-orbit azimuth + smoothed random radius /
   * pitch / FOV / signed ω (see constants `CINEMATIC_ORBIT_*`).
   */
  _cineOrbitAzimuth: 0,
  _cineOrbitOmega: 0,
  _cineOrbitOmegaTgt: 0,
  _cinePitch: 0.28,
  _cinePitchTgt: 0.28,
  _cineRadius: FOLLOW_CAMERA_DIST,
  _cineNextParamChangeAt: 0,
  _cineRadiusTgt: FOLLOW_CAMERA_DIST,
  _cineFovTgt: DEFAULT_CAMERA_FOV,

  // ──────────────────────────────────────────────────────────────────────────
  async load(scene, camera) {
    this._camera = camera;
    this._scene = scene;
    this._canvas = document.querySelector("canvas");
    camera.fov = DEFAULT_CAMERA_FOV;
    camera.updateProjectionMatrix();

    // ── Sky ───────────────────────────────────────────────────────────────
    /**
     * Procedural season-aware sky dome — replaces the old flat
     * `scene.background = 0xfff1ca` placeholder. The dome is rendered
     * with `BackSide` from inside, depthTest off, renderOrder = -8, so
     * it paints the whole celestial hemisphere underneath every
     * world-space object. Sky uniforms switch on `ANU_EVENTS.SEASON_CHANGE`
     * via UIModule's 5 PiP buttons (`data-season`). See `WorldCelestial.js`.
     *
     * `scene.background` is left null so the dome shows through; fog
     * stays (its color is tinted to the active horizon by the celestial
     * `applySeason` so distant terrain blends into the chosen season
     * instead of fading to the previous cream haze).
     */
    scene.background = null;
    // Linear fog driven by the active map's palette — `fogNear` / `fogFar`
    // tune how aggressively the mountain ridge fades into the horizon.
    // Celestial.applySeason re-tints `fog.color` per season at runtime
    // so the colour set here is just the cold-load default.
    const _mapPalette = getActiveMap().palette;
    scene.fog = new THREE.Fog(
      _mapPalette.fogColor,
      _mapPalette.fogNear,
      _mapPalette.fogFar,
    );
    this._celestial = attachWorldCelestial(scene);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7c3f, 0.85);
    scene.add(hemi);
    this._objects.push(hemi);

    // ── Sun ───────────────────────────────────────────────────────────────
    // Shadow casting re-enabled May-2026 alongside the renderer-side
    // `shadowMap.enabled` flip. **120-FPS pass** — dropped shadow map
    // 2048² → 1024² (4× cheaper shadow pass at one perceptible
    // softness step on hard-edged casters). Compensated with a higher
    // `normalBias` so the softer map's filtered edge still seats the
    // shadow correctly under each caster.
    const sun = new THREE.DirectionalLight(0xfff5e0, 1.3);
    sun.position.set(80, 120, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 400;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -130;
    sun.shadow.camera.right = sun.shadow.camera.top = 130;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.06;
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

    /**
     * Opening-scene composition (May-2026 user spec: "wow kids… they
     * won't want to leave our sacred hidden valley sanctuary"):
     *
     *   • PATH_SEGMENTS — worn dirt footpath from spawn → tipi 1 →
     *     tipi 2 (one arm) and tipi 1 → pool's south rim (the other
     *     arm). Each segment is a straight chord with a midpoint nudge
     *     so the trail reads slightly meandering rather than ruler-
     *     straight. Per-vertex distance to the closest segment drives
     *     a dirt-brown blend over the grass.
     *
     *   • The meadow inside the valley gets multi-octave noise so it
     *     reads as living grass rather than a flat colour field —
     *     yellow-cream sun patches alternating with deeper green
     *     pockets. Costs nothing per-frame; the noise is sampled once
     *     at terrain build.
     */
    const SPAWN_Z = -3 * V2_TILE_WORLD;
    const TIPI2_X = V2_TILE_WORLD * 2;
    const PATH_SEGMENTS = [
      // Spawn approach — slight wobble west then back to origin.
      [{ x: 0, z: SPAWN_Z }, { x: -1.4, z: SPAWN_Z * 0.55 }],
      [{ x: -1.4, z: SPAWN_Z * 0.55 }, { x: 0.6, z: SPAWN_Z * 0.22 }],
      [{ x: 0.6, z: SPAWN_Z * 0.22 }, { x: 0, z: -1.5 }],
      // Inter-tipi connector with a gentle southern bow.
      [{ x: 1.8, z: 0.2 }, { x: TIPI2_X * 0.5, z: 1.1 }],
      [{ x: TIPI2_X * 0.5, z: 1.1 }, { x: TIPI2_X - 1.8, z: 0.2 }],
      // Tipi-1 → pond south rim. Curves northeast through the meadow,
      // arriving at the bank just south of the basin.
      [{ x: 1.6, z: 1.8 }, { x: 4.4, z: 7.5 }],
      [{ x: 4.4, z: 7.5 }, { x: 7.2, z: 12.5 }],
      [{ x: 7.2, z: 12.5 }, { x: 9.0, z: 17.0 }],
    ];
    const _distToPath = (px, pz) => {
      let best = Infinity;
      for (let s = 0; s < PATH_SEGMENTS.length; s++) {
        const a = PATH_SEGMENTS[s][0];
        const b = PATH_SEGMENTS[s][1];
        const sdx = b.x - a.x;
        const sdz = b.z - a.z;
        const lenSq = sdx * sdx + sdz * sdz;
        let t = 0;
        if (lenSq > 1e-6) {
          t = ((px - a.x) * sdx + (pz - a.z) * sdz) / lenSq;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
        }
        const projX = a.x + t * sdx;
        const projZ = a.z + t * sdz;
        const dx = px - projX;
        const dz = pz - projZ;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      return Math.sqrt(best);
    };
    this._distToPath = _distToPath;

    // Resolve the active map's terrain bands + palette once so the
    // per-vertex colour loop can multiply-add against constants
    // instead of dereferencing through the registry every iteration.
    const _mapNow = getActiveMap();
    const MAP_T = _mapNow.terrain;
    const MAP_PAL = _mapNow.palette;

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
      // Hill + mountain + snow-cap colouration — drawn from the active
      // map's palette so swapping maps re-paints the terrain rings.
      // The `MAP_T` / `MAP_PAL` references resolve once before the
      // loop (see directly above this for-loop) so per-vertex work is
      // just a multiply-add against cached constants.
      if (dist >= MAP_T.HILL_INNER && dist < MAP_T.HILL_OUTER) {
        const t = (dist - MAP_T.HILL_INNER) / (MAP_T.HILL_OUTER - MAP_T.HILL_INNER);
        const lerp = t * 0.55;
        r = r * (1 - lerp) + MAP_PAL.hill[0] * lerp;
        g = g * (1 - lerp) + MAP_PAL.hill[1] * lerp;
        b = b * (1 - lerp) + MAP_PAL.hill[2] * lerp;
      } else if (dist >= MAP_T.MOUNTAIN_INNER && dist < MAP_T.MOUNTAIN_OUTER) {
        const t = (dist - MAP_T.MOUNTAIN_INNER) / (MAP_T.MOUNTAIN_OUTER - MAP_T.MOUNTAIN_INNER);
        const lerp = 0.55 + t * 0.35;
        r = r * (1 - lerp) + MAP_PAL.mountain[0] * lerp;
        g = g * (1 - lerp) + MAP_PAL.mountain[1] * lerp;
        b = b * (1 - lerp) + MAP_PAL.mountain[2] * lerp;
        // Snow cap — blends toward white when the vertex height clears
        // the configured snow line. Soft 4 m band so the transition
        // doesn't look painted-on. Only applies when the map opted in
        // (`palette.snowCap !== null`).
        if (MAP_PAL.snowCap && h > MAP_PAL.snowCap.snowLineM - 4) {
          const sLerp = Math.min(
            1,
            Math.max(0, (h - (MAP_PAL.snowCap.snowLineM - 4)) / 4),
          );
          r = r * (1 - sLerp) + MAP_PAL.snowCap.snow[0] * sLerp;
          g = g * (1 - sLerp) + MAP_PAL.snowCap.snow[1] * sLerp;
          b = b * (1 - sLerp) + MAP_PAL.snowCap.snow[2] * sLerp;
        }
      } else if (dist >= MAP_T.MOUNTAIN_OUTER) {
        const t = Math.min(1, (dist - MAP_T.MOUNTAIN_OUTER) / 6);
        r = r * (1 - t) + MAP_PAL.cliff[0] * t;
        g = g * (1 - t) + MAP_PAL.cliff[1] * t;
        b = b * (1 - t) + MAP_PAL.cliff[2] * t;
      }

      // Meadow color variation — multi-octave noise across the valley
      // floor so the grass reads as living grass with sun-bleached
      // highlights and deeper green pockets, not a flat colour field.
      if (dist < 52) {
        const meadowN =
          Math.sin(x * 0.07 + z * 0.04) * 0.045 +
          Math.cos(x * 0.13 - z * 0.09) * 0.030 +
          Math.sin(x * 0.31 + z * 0.27) * 0.018;
        if (meadowN > 0) {
          // Sun-cream highlight.
          r += meadowN * 0.85;
          g += meadowN * 0.60;
          b += meadowN * 0.15;
        } else {
          // Deeper green pocket — pull blue down so the shade reads cool.
          r += meadowN * 0.15;
          g += meadowN * 0.05;
          b += meadowN * 0.32;
        }
      }

      // Worn footpath — blend toward warm dirt brown when the vertex is
      // within `pathWidthFalloffStart` m of the closest path segment.
      // Hard centre stripe to ~1.5 m, soft shoulder out to ~3.2 m so
      // the trail blends back into grass at the edges.
      const pathD = _distToPath(x, z);
      if (pathD < 3.2) {
        const t = pathD < 1.5 ? 1.0 : 1.0 - (pathD - 1.5) / 1.7;
        const mix = 0.72 * t;
        // Per-vertex wobble in the dirt colour so the trail isn't
        // smooth tarmac — picks up bits of yellow grit / dark loam.
        const grit = (Math.sin(x * 0.9 + z * 1.1) + 1) * 0.5;
        const dirtR = 0.42 + grit * 0.10;
        const dirtG = 0.31 + grit * 0.06;
        const dirtB = 0.20 + grit * 0.03;
        r = r * (1 - mix) + dirtR * mix;
        g = g * (1 - mix) + dirtG * mix;
        b = b * (1 - mix) + dirtB * mix;
      }

      /** Warren hub: kill grass-green tint so the chasm reads as bare earth / void. */
      const wdx = x - V2_RABBIT_WARREN_HUB_X_M;
      const wdz = z - V2_RABBIT_WARREN_HUB_Z_M;
      const warD = Math.hypot(wdx, wdz);
      const warEdge = V2_RABBIT_WARREN_CHASM_RADIUS_M * 1.16;
      if (warD < warEdge) {
        const wf = THREE.MathUtils.clamp(1 - warD / warEdge, 0, 1);
        const mud = 0.08 + 0.42 * wf;
        r *= mud;
        g *= mud;
        b *= mud;
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    pos.needsUpdate = true;
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals(); // called ONCE here, never in update()

    // ── Real grass texture (seamless, from game assets) ───────────────────
    // The previous source `SacredOnes.1/assets/landscape/grass_seamless.png`
    // was deleted when the SacredOnes.1 sibling tree was removed; the canonical
    // copy now lives under the landscape-scenes domain in `Assets/`.
    const loader = new THREE.TextureLoader();
    const grassTex = loader.load(
      "./Assets/landscape-scenes/terrain/grass-seamless.png",
    );
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
    grassTex.repeat.set(24, 24); // tile density across the map

    // Neumorphic hex material (MeshStandard so shader hooks work)
    const groundMat = new THREE.MeshStandardMaterial({
      map: grassTex,
      vertexColors: true, // vertex colours tint on top of texture
      roughness: 0.92,
      metalness: 0.0,
    });
    applyNeuHexShader(groundMat);

    const terrain = new THREE.Mesh(geo, groundMat);
    // Terrain now receives shadows so trees, rabbits, and the avatar
    // plant onto the ground instead of floating above flat black discs.
    terrain.receiveShadow = true;
    terrain.name = "terrain";
    terrain.userData.anuId = "environment.terrain.hex_ground";
    terrain.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    terrain.userData.anuKind = "terrain_hex_mesh";
    scene.add(terrain);
    this._objects.push(terrain);
    this._terrainRaycastMesh = terrain;

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
    hazeMesh.name = "atmospheric_haze";
    hazeMesh.userData.anuId = "environment.atmosphere.haze";
    hazeMesh.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    hazeMesh.userData.anuKind = "haze_overlay";
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
    ring.name = "environment_outer_ring";
    ring.position.y = -3;
    ring.userData.anuId = "environment.boundary.outer_ring";
    ring.userData.anuSimulationDomain = ANU_SIMULATION_DOMAIN.ENVIRONMENT;
    ring.userData.anuKind = "outer_boundary_ring";
    scene.add(ring);
    this._objects.push(ring);

    // ── Physics engine ────────────────────────────────────────────────────
    WorldPhysics._init(terrainY);
    registerRuntimeService("WorldPhysics", WorldPhysics, { owner: this.name });
    // Legacy alias for older modules/scripts while V2 migrates to RuntimeServices.
    window.WorldPhysics = WorldPhysics;

    // ── Player physics body ───────────────────────────────────────────────
    /**
     * Spawn: **3 tiles in front of tipi 1**.
     *   • Tipi 1 sits at world origin; the NPCBehaviour entranceLocalXZ for
     *     tipi 1 is { x: 0, z: -2.6 } — the doorway is on the −Z (south)
     *     side of the model. "In front" therefore means −Z.
     *   • 3 tiles = 3 × V2_TILE_WORLD (≈ 32.58 m), measured to the player,
     *     so the platform's south edge (4.7 m radius) is still ~28 m away.
     *   • Yaw = π flips `_fwd` from (0,0,−1) to (0,0,+1), so the player
     *     faces north toward the tipi the moment the scene boots.
     * Far enough from the warren at (V2_TILE_WORLD, 0) (~34 m) that the
     * rabbit family stays out of FLEE range; far enough from tipi 1 that
     * the NPC.YB rising-edge gate sees the player as "outside zone" and
     * stays seated until the player demonstrably approaches.
     */
    const spawnX = 0;
    const spawnZ = -3 * V2_TILE_WORLD;
    this._playerPos.set(spawnX, terrainY(spawnX, spawnZ) + PLAYER_HEIGHT, spawnZ);
    camera.position.copy(this._playerPos);
    camera.rotation.order = "YXZ"; // set ONCE — never reset in update()
    this._playerBody = WorldPhysics.createBody(this._playerPos, PLAYER_HEIGHT);
    this._yaw = Math.PI;
    this._walkDistance = 0;
    this._lastWalkX = this._playerPos.x;
    this._lastWalkZ = this._playerPos.z;
    this._cameraSmoothReady = false;
    this._mainCanvasMapView = false;

    // ── Input ─────────────────────────────────────────────────────────────
    this._setupInput();

    const [tipi, tipi2] = await Promise.all([
      loadCenterTipi({ scene, objects: this._objects, worldPhysics: WorldPhysics }),
      loadTipi2WithBhg({ scene, objects: this._objects, worldPhysics: WorldPhysics }),
      this._avatar.load(scene, this._objects),
    ]);
    this._tipi = tipi;
    this._tipi2 = tipi2;
    this._journalGuideRoot = tipi?.userData?.journalQuestBalloonRoot ?? null;
    this._journalRaycaster = new THREE.Raycaster();
    this._journalNdcScratch = new THREE.Vector2();
    /**
     * Main canvas LMB: journal balloon (when closed), else terrain raycast →
     * smart path navigation (steerAroundObstacles loop in `update`).
     */
    this._onCanvasPointerPrimary = (ev) => {
      const btn = typeof ev.button === "number" ? ev.button : 0;
      if (btn !== 0) return;
      if (typeof window !== "undefined" && window._v2InputSuppressed) return;
      // May-17 2026 user spec: "prevent all mouse click movement and
      // keyboard movement WHILE FISHING otherwise player shoots off the
      // page". The keyboard side is handled by `_v2FishingEngaged`
      // folding into `modalBlocksLocomotion` in the update loop; here
      // we drop click-to-move starts at the source so the player can't
      // schedule a smart-nav goal that fires the instant fishing ends.
      if (typeof window !== "undefined" && window._v2FishingEngaged) return;
      if (!this._canvas || !this._camera) return;
      const rect = this._canvas.getBoundingClientRect();
      if (!(rect.width > 4 && rect.height > 4)) return;
      this._journalNdcScratch.x =
        ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      this._journalNdcScratch.y =
        -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      this._journalRaycaster.setFromCamera(this._journalNdcScratch, this._camera);

      const journalClosed =
        typeof window === "undefined" || window._v2JournalOpen !== true;

      if (journalClosed && this._journalGuideRoot) {
        const hitsBalloon = this._journalRaycaster.intersectObject(
          this._journalGuideRoot,
          true,
        );
        if (
          hitsBalloon.length &&
          hitsBalloon[0].distance <= JOURNAL_GUIDE_BALLOON_MAX_PICK_M
        ) {
          if (typeof window._v2ToggleJournal === "function") {
            window._v2ToggleJournal();
          }
          return;
        }
      }

      if (journalClosed && this._tipi2?.userData?.questAxe?.root) {
        const axeRoot = this._tipi2.userData.questAxe.root;
        const hitsAxe = this._journalRaycaster.intersectObject(axeRoot, true);
        if (
          hitsAxe.length &&
          hitsAxe[0].distance <= QUEST_AXE_MAX_PICK_DISTANCE_M
        ) {
          this._tryPickupTipi2QuestAxe();
          return;
        }
      }

      if (journalClosed && this._terrainRaycastMesh) {
        const hitsT = this._journalRaycaster.intersectObject(
          this._terrainRaycastMesh,
          false,
        );
        if (hitsT.length) {
          const p = hitsT[0].point;
          this.startSmartNavigateTo(
            p.x,
            p.z,
            V2_SMART_NAV_ARRIVE_TOLERANCE_M,
            null,
          );
        }
      }
    };
    if (this._canvas) {
      this._canvas.addEventListener("pointerdown", this._onCanvasPointerPrimary);
    }

    // ── Nature-spirit stag (20 ft hologram, 5-min cycle) ──────────────────
    // Owned by WorldModule so it has direct access to terrain + YB hooks
    // (NPC.YB lives on tipi.userData). The spirit periodically visits YB
    // and asks her behaviour controller for a one-shot "spirit greeting".
    //
    // May-17 2026 v3 boot escape hatch: set `window._v3DisableNatureSpirit`
    // before activating World to skip the 748k-tri `animated.stag.glb`
    // load entirely. v3 wants the smallest possible scene (just tipi +
    // pond + dock + avatar) — the spirit's GLB is the single biggest
    // optional cost not already tied to the village identity.
    const skipNatureSpirit =
      typeof window !== "undefined" && window._v3DisableNatureSpirit === true;
    try {
      if (skipNatureSpirit) {
        console.log(
          "%c[World] NatureSpirit skipped — `window._v3DisableNatureSpirit` is set.",
          "color:#aaaaaa;",
        );
      } else {
      this._natureSpirit = createWorldNatureSpiritController();
      await this._natureSpirit.load(scene, this._objects, {
        terrainY: (x, z) => terrainY(x, z),
        getYbPosition: () => {
          const r = this._tipi?.userData?.ybSeatRoot;
          if (!r) return null;
          return { x: r.position.x, z: r.position.z };
        },
        getPlayerPosition: () => {
          const b = this._playerBody;
          if (!b?.position) return null;
          return { x: b.position.x, z: b.position.z };
        },
        playYbSpiritGreeting: (stagX, stagZ) => {
          const beh = this._tipi?.userData?.ybBehaviour;
          if (!beh?.playSpiritGreeting) return false;
          return beh.playSpiritGreeting(stagX, stagZ);
        },
        notifyYbSpiritPos: (stagX, stagZ) => {
          const beh = this._tipi?.userData?.ybBehaviour;
          beh?.updateSpiritPos?.(stagX, stagZ);
        },
        notifyYbPlayerInterrupt: (playerX, playerZ) => {
          const beh = this._tipi?.userData?.ybBehaviour;
          if (!beh?.notifyPlayerInterrupt) return false;
          return beh.notifyPlayerInterrupt(playerX, playerZ);
        },
      });
      }
    } catch (err) {
      console.warn("[World] NatureSpirit init failed:", err);
      this._natureSpirit = null;
    }

    console.log(
      "%c[World] ✅ Phase 1 loaded — terrain + physics + neumorphic hex shader",
      "color:#a5d6a7;font-weight:bold;",
    );
    console.log(
      "[World] WASD/arrows = move | SPACE = jump | window.WorldPhysics = physics API",
    );
    console.log("[World] Physics:", {
      gravity: GRAVITY,
      jumpImpulse: JUMP_IMPULSE,
      playerHeight: PLAYER_HEIGHT,
    });

    // Register WorldPlayer service NOW (end of load) so it's available to
    // consumers the moment activate('World') resolves. Without this, the
    // service only appears after the first update() frame, which is a timing
    // race — async modules registered after World (Fauna, PondEnclave, …)
    // push back the first frame and tests that snapshot services right
    // after activate-await would miss it.
    const initialPlayerState = buildWorldPlayerState(this, camera, this._playerBody);
    registerRuntimeService("WorldPlayer", initialPlayerState, { owner: this.name });
    window.WorldPlayer = initialPlayerState;
  },

  // ──────────────────────────────────────────────────────────────────────────
  // UPDATE — zero allocations, all vectors pre-built
  // ──────────────────────────────────────────────────────────────────────────
  update(delta, _frameCount, _scene, camera) {
    const k = this._keys;
    const speed = V2_PLAYER_MOVE_SPEED_MPS;
    const dir = this._moveDir;
    const body = this._playerBody;
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    this._advanceTipi2QuestAxePickupFx(delta);
    /** Journal / modal overlay: freeze locomotion and keep avatar in idle (see index.v2.html `_v2InputSuppressed`). */
    const modalBlocksLocomotion =
      (typeof window !== "undefined" && window._v2InputSuppressed === true) ||
      /**
       * May-17 2026 user spec: "turn off ALL OVEMENT while fishing".
       * `_v2FishingEngaged` stays true for the entire rod-in-hand
       * session (EQUIPPED → BITE → FIGHTING → LANDING), so WASD +
       * arrows + autowalk + smart-nav are blocked for the whole
       * fishing flow — not just the tension-meter fight. The
       * narrower `_v2FishingActive` flag (FIGHTING only) still gates
       * the jump-on-space short-circuit a few lines below.
       */
      (typeof window !== "undefined" && window._v2FishingEngaged === true);

    let smartNavActive =
      !!(this._smartNavGoal && !modalBlocksLocomotion);
    this._navScriptedDriving = false;

    /**
     * May-15 2026 user spec: "click to move is good, but any input should
     * interrupt and cancel it (remove foot prints)". Detect any locomotion
     * intent keys (WASD, arrows, space jump) before the smart-nav driver
     * gets to run, and cancel the goal — this also disposes the click
     * marker so the gold X and footprint trail vanish in the same frame.
     */
    if (smartNavActive) {
      const anyInputPressed =
        k["w"] || k["a"] || k["s"] || k["d"] ||
        k["arrowup"] || k["arrowdown"] || k["arrowleft"] || k["arrowright"] ||
        k[" "];
      if (anyInputPressed) {
        this.cancelSmartNavigate?.();
        smartNavActive = false;
      }
    }

    // ── Horizontal movement intention ─────────────────────────────────────
    // Local XZ frame matches CAMERA-relative semantics, not world XYZ.
    // After the rotation on lines 380–381 the world dir becomes:
    //   wx = dir.x·cos(yaw) + dir.z·sin(yaw)
    //   wz = -dir.x·sin(yaw) + dir.z·cos(yaw)
    // At spawn yaw=π (facing +Z / north), pressing 'a' should strafe to
    // the player's LEFT (= world -X / west). Solving wx=-1 at yaw=π gives
    // dir.x = +1. Pressing 'd' (strafe right, world +X / east) → dir.x = -1.
    // The legacy `a: dir.x -= 1 / d: dir.x += 1` was inverted because the
    // rotation matrix uses an unsigned `cos+sin/-sin+cos` convention
    // (Y-axis negative rotation) rather than the textbook `cos-sin/sin+cos`.
    dir.set(0, 0, 0);
    if (!modalBlocksLocomotion && !smartNavActive) {
      if (k["w"] || k["arrowup"]) dir.z -= 1;
      // May-17 2026 user spec: "reverse movement for A and S keys they
      // are backwards exchange them". Reverse-walk now lives on A; S is
      // the new turn-left key (see yaw block below). ArrowDown keeps the
      // legacy reverse-walk binding so two-stick muscle memory still works.
      if (k["a"] || k["arrowdown"]) dir.z += 1;
    }

    const physicalMovingKeys =
      modalBlocksLocomotion || smartNavActive
        ? false
        : !!(k["w"] || k["a"] || k["arrowup"] || k["arrowdown"]);

    // Long-hold autowalk must not stomp NPC greet poses — suppress it inside
    // one tile of either tipi centre (tipi 1 at origin, tipi 2 at +X).
    const px = body.position.x;
    const pz = body.position.z;
    const r1 = Math.sqrt(px * px + pz * pz);
    const dx2 = px - V2_TIPI_2_CENTER_X_M;
    const r2 = Math.sqrt(dx2 * dx2 + pz * pz);
    const nearTipi = r1 < V2_TILE_WORLD || r2 < V2_TILE_WORLD;
    if (nearTipi && this._autoWalk.active) {
      this._autoWalk.active = false;
      this._autoWalk.key = null;
      this._autoWalk.startedByHoldAt = 0;
    }

    if (modalBlocksLocomotion) {
      this._autoWalk.active = false;
      this._autoWalk.key = null;
      this._autoWalk.startedByHoldAt = 0;
    }

    if (physicalMovingKeys) {
      if (!nearTipi) syncAutowalkFromHeldKeys(this, now, dir);
    } else if (this._autoWalk.active && !nearTipi && !smartNavActive) {
      dir.set(this._autoWalk.dirX, 0, this._autoWalk.dirZ);
    }
    let movingKeys =
      physicalMovingKeys ||
      (this._autoWalk.active && !nearTipi && !smartNavActive);
    if (modalBlocksLocomotion) movingKeys = false;

    let turnPressed =
      k["arrowleft"] || k["arrowright"] || k["s"] || k["d"];
    if (modalBlocksLocomotion || smartNavActive) turnPressed = false;
    const turnOnly = turnPressed && !movingKeys;
    const turnRate = turnOnly ? 2.85 : 1.72;

    // ── Turn (after movement keys known — faster when rotating in place) ───
    // Two turn-key sets coexist:
    //   • ArrowLeft / ArrowRight — legacy inverted muscle-memory mapping
    //     (← INCREMENTS yaw, → DECREMENTS yaw). Under the engine's
    //     `_fwd = (-sin yaw, 0, -cos yaw)` convention, increasing yaw
    //     rotates CW-from-above, so pressing ← physically turns the player
    //     toward world +X (east). The compass formula `_syncCompass` is
    //     unchanged and tells the physical truth.
    //   • S / D — PHYSICAL mapping (s = yaw -= → left, d = yaw +=
    //     → right). May-17 2026 user spec: A and S keys were "backwards"
    //     and got exchanged — A now moves backward (see dir block above)
    //     and S now turns left, taking A's old yaw -= binding.
    if (!modalBlocksLocomotion && !smartNavActive) {
      if (k["arrowleft"]) this._yaw += turnRate * delta;
      if (k["arrowright"]) this._yaw -= turnRate * delta;
      if (k["s"]) this._yaw -= turnRate * delta;
      if (k["d"]) this._yaw += turnRate * delta;
    }

    if (!modalBlocksLocomotion && smartNavActive && this._smartNavGoal) {
      const g = this._smartNavGoal;
      const segs = g.segments;
      let idx = g.segIdx;
      while (idx < segs.length - 1) {
        const s = segs[idx];
        const rdx = s.x - body.position.x;
        const rdz = s.z - body.position.z;
        if (Math.hypot(rdx, rdz) <= g.wpTol) idx += 1;
        else break;
      }
      g.segIdx = idx;

      const tgt = segs[idx];
      const dx = tgt.x - body.position.x;
      const dz = tgt.z - body.position.z;
      const dist = Math.hypot(dx, dz);
      const atLast = idx >= segs.length - 1;
      if (atLast && dist <= g.tolerance) {
        body.velocity.x = 0;
        body.velocity.z = 0;
        const cb = g.onArrive;
        this._smartNavGoal = null;
        // Dispose the click-to-move ground marker as the player halts so
        // the X + dashes don't linger after arrival.
        this._disposeClickToMoveMarker();
        if (cb)
          queueMicrotask(() => {
            try {
              cb();
            } catch (err) {
              console.warn("[World] smartNav onArrive failed:", err);
            }
          });
      } else {
        this._navScriptedDriving = true;
        const wx = dx / (dist || 1);
        const wz = dz / (dist || 1);
        this._tmpAvoidVelocity.set(wx * speed, 0, wz * speed);
        WorldPhysics.steerAroundObstacles(
          body.position,
          this._tmpAvoidVelocity,
          PLAYER_COLLISION_RADIUS,
        );
        body.velocity.x = this._tmpAvoidVelocity.x;
        body.velocity.z = this._tmpAvoidVelocity.z;

        // Face the actual motion vector (obstacle-steered), not the raw bearing
        // to the waypoint — matches locomotion clip and `_fwd = (-sin,-cos)`.
        const vx = this._tmpAvoidVelocity.x;
        const vz = this._tmpAvoidVelocity.z;
        const vh = Math.sqrt(vx * vx + vz * vz);
        if (vh > 0.06) {
          const mx = vx / vh;
          const mz = vz / vh;
          const targetYaw = Math.atan2(-mx, -mz);
          let ydiff = targetYaw - this._yaw;
          while (ydiff < -Math.PI) ydiff += Math.PI * 2;
          while (ydiff > Math.PI) ydiff -= Math.PI * 2;
          const maxTurn = 7.5 * delta;
          this._yaw += Math.sign(ydiff) * Math.min(Math.abs(ydiff), maxTurn);
        }
      }
    } else if (!modalBlocksLocomotion && dir.lengthSq() > 0) {
      dir.normalize();
      // Rotate direction by yaw — no allocations
      const cos = Math.cos(this._yaw),
        sin = Math.sin(this._yaw);
      const wx = dir.x * cos + dir.z * sin;
      const wz = -dir.x * sin + dir.z * cos;
      this._tmpAvoidVelocity.set(wx * speed, 0, wz * speed);
      WorldPhysics.steerAroundObstacles(
        body.position,
        this._tmpAvoidVelocity,
        PLAYER_COLLISION_RADIUS,
      );
      // Feed into physics body velocity (horizontal only)
      body.velocity.x = this._tmpAvoidVelocity.x;
      body.velocity.z = this._tmpAvoidVelocity.z;
    } else if (modalBlocksLocomotion) {
      body.velocity.x = 0;
      body.velocity.z = 0;
    } else if (turnOnly) {
      // ←/→ only: no horizontal motion — do not blend with friction (avoids drift before zero)
      body.velocity.x = 0;
      body.velocity.z = 0;
    } else {
      // No movement keys — friction stop
      body.velocity.x *= 0.82;
      body.velocity.z *= 0.82;
    }

    // ── Jump (Space) — only if grounded ───────────────────────────────────
    // Yield the spacebar to `WorldFishingModule` while it's actively fighting
    // a fish (sets `window._v2FishingActive`) so holding space releases line
    // tension instead of pogoing the avatar.
    if (!modalBlocksLocomotion && !smartNavActive && !window._v2FishingActive && k[" "] && body.grounded) {
      body.applyImpulse(0, JUMP_IMPULSE, 0);
      body.grounded = false;
      dispatchInteraction(ANU_EVENTS.PLAYER_JUMP, {
        t: typeof performance !== "undefined" ? performance.now() : 0,
      });
    }

    // ── Step all physics bodies (gravity, terrain collision, slope) ────────
    WorldPhysics.stepAll(delta);
    WorldPhysics.resolveBodyCollisions(body, PLAYER_COLLISION_RADIUS);

    // Belt-and-suspenders: slope integration must not leave horizontal drift during pivot
    if (turnOnly) {
      body.velocity.x = 0;
      body.velocity.z = 0;
    }

    const dx = body.position.x - this._lastWalkX;
    const dz = body.position.z - this._lastWalkZ;
    const stepDistance = Math.sqrt(dx * dx + dz * dz);
    this._lastWalkX = body.position.x;
    this._lastWalkZ = body.position.z;
    const horizontalSpeed = Math.sqrt(
      body.velocity.x * body.velocity.x + body.velocity.z * body.velocity.z,
    );
    const moving =
      body.grounded &&
      horizontalSpeed > 0.18 &&
      (dir.lengthSq() > 0 || this._navScriptedDriving);
    if (moving) this._walkDistance += stepDistance;

    /** Hold walk clip whenever movement intent is active — avoids idle flashes from grounded/slope jitter. */
    const walkIntent =
      (!smartNavActive && movingKeys && dir.lengthSq() > 0) ||
      this._navScriptedDriving;

    const journalOpen =
      typeof window !== "undefined" && window._v2JournalOpen === true;

    if (this._mainCanvasMapView && this._cinematicIdleActive) {
      this._cinematicIdleActive = false;
      this._idleStandSeconds = 0;
    }
    if (modalBlocksLocomotion && this._cinematicIdleActive) {
      this._cinematicIdleActive = false;
      this._idleStandSeconds = 0;
    }

    const playerRestIdle =
      !modalBlocksLocomotion &&
      !smartNavActive &&
      !this._mainCanvasMapView &&
      !journalOpen &&
      !walkIntent &&
      !turnOnly &&
      horizontalSpeed < 0.11 &&
      !k[" "];

    if (playerRestIdle) this._idleStandSeconds += delta;
    else {
      this._idleStandSeconds = 0;
      if (this._cinematicIdleActive) this._cinematicIdleActive = false;
    }

    if (
      playerRestIdle &&
      this._idleStandSeconds >= V2_IDLE_CINEMATIC_ENTER_S
    ) {
      if (!this._cinematicIdleActive) {
        this._cinematicIdleActive = true;
        this._cineOrbitAzimuth = Math.random() * Math.PI * 2;
        this._cineOrbitOmegaTgt = randomCinematicOrbitOmegaTgt();
        this._cineOrbitOmega = this._cineOrbitOmegaTgt;
        this._cinePitchTgt = randomCinematicPitchTgt();
        this._cinePitch = this._cinePitchTgt;
        this._cineRadiusTgt = randomCinematicRadiusTgt();
        this._cineRadius = this._cineRadiusTgt;
        this._cineFovTgt = randomCinematicFovTgt();
        if (this._camera) {
          this._camera.fov = this._cineFovTgt;
          this._camera.updateProjectionMatrix();
        }
        this._cineNextParamChangeAt =
          now +
          CINEMATIC_ORBIT_PARAM_REFRESH_MS * (0.85 + Math.random() * 0.28);
      }
    }

    if (this._cinematicIdleActive && now >= this._cineNextParamChangeAt) {
      this._cineRadiusTgt = randomCinematicRadiusTgt();
      this._cinePitchTgt = randomCinematicPitchTgt();
      this._cineOrbitOmegaTgt = randomCinematicOrbitOmegaTgt();
      this._cineFovTgt = randomCinematicFovTgt();
      this._cineNextParamChangeAt =
        now +
        CINEMATIC_ORBIT_PARAM_REFRESH_MS * (0.82 + Math.random() * 0.34);
    }

    if (this._cinematicIdleActive) {
      const tau = CINEMATIC_ORBIT_PARAM_LERP_TAU_S;
      this._cineOrbitOmega = expToward(
        this._cineOrbitOmega,
        this._cineOrbitOmegaTgt,
        delta,
        tau * 1.18,
      );
      this._cineOrbitAzimuth += delta * this._cineOrbitOmega;
      this._cinePitch = expToward(
        this._cinePitch,
        this._cinePitchTgt,
        delta,
        tau * 1.05,
      );
      this._cineRadius = expToward(
        this._cineRadius,
        this._cineRadiusTgt,
        delta,
        tau * 1.12,
      );
    }

    const hideChromeForCinematic =
      this._cinematicIdleActive && !this._mainCanvasMapView;
    if (hideChromeForCinematic !== this._lastCinematicUiHidden) {
      this._lastCinematicUiHidden = hideChromeForCinematic;
      try {
        if (typeof window._v2SetCinematicUiHidden === "function") {
          window._v2SetCinematicUiHidden(hideChromeForCinematic);
        }
      } catch (_e) {
        /* ignore */
      }
    }
    if (hideChromeForCinematic !== this._lastAvatarCinematicDrawThrough) {
      this._lastAvatarCinematicDrawThrough = hideChromeForCinematic;
      try {
        this._avatar?.setCinematicIdleFigurineDrawThrough?.(
          hideChromeForCinematic,
        );
      } catch (_e) {
        /* ignore */
      }
    }

    const villageTopDownUi = this._mainCanvasMapView === true;
    if (villageTopDownUi !== this._lastVillageViewBodyClass) {
      this._lastVillageViewBodyClass = villageTopDownUi;
      try {
        document.body.classList.toggle("v2-village-view", villageTopDownUi);
        if (typeof window._v2SyncVillageViewRightStack === "function") {
          requestAnimationFrame(() => window._v2SyncVillageViewRightStack());
        }
      } catch (_e) {
        /* ignore */
      }
    }

    /**
     * Cinematic-idle + on-platform swaps idle for the seated clip. Gate
     * also requires the avatar to actually have a `sit` semantic mapping
     * — Avatar3.glb's clip set is bound at load time and `semanticClips.sit`
     * may be `null` if none of the unnamed NlaTrack clips landed on a
     * seated pose. In that case we silently keep the standing idle.
     */
    this._cinematicSitActive =
      this._cinematicIdleActive &&
      !modalBlocksLocomotion &&
      !walkIntent &&
      !turnOnly &&
      !!this._avatar?.semanticClips?.sit &&
      this._isPlayerOnBuildingPlatform(body.position.x, body.position.z);

    let desiredLocomotion = "idle";
    if (modalBlocksLocomotion) desiredLocomotion = "idle";
    else if (walkIntent) desiredLocomotion = "walk";
    else if (turnOnly) desiredLocomotion = "look";
    else if (this._cinematicSitActive) desiredLocomotion = "sit";

    const rawFeetY = body.position.y - PLAYER_HEIGHT;
    /** Must match physics stepping (`WorldPhysics._sampleGroundY`) — includes dock deck plates. */
    const groundAtFeet = WorldPhysics.getGroundY(body.position.x, body.position.z);
    const figurineFeetY = body.grounded
      ? groundAtFeet + V2_AVATAR_GROUNDED_FEET_OFFSET_M
      : rawFeetY;
    /** Physics uses raw feet height; Avatar3 figurine snaps to analytic terrain when grounded. */
    this._feetScratch.set(body.position.x, rawFeetY, body.position.z);
    this._fwd.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
    this._back.copy(this._fwd).multiplyScalar(-1);

    if (this._avatar) {
      this._avatar.setPose(body.position.x, figurineFeetY, body.position.z, this._yaw);
      // Keep the travel disc / ring / arrow clear of the highest rim of
      // terrain under them so the player marker is never clipped on a
      // slope (May-14 2026 user fix). 4 analytic samples; cheap.
      this._avatar.syncDecalsToTerrainSlope?.(this._terrainY, figurineFeetY);
      if (now >= this._avatar.gestureUntil) {
        const reason =
          desiredLocomotion === "walk"
            ? "move"
            : desiredLocomotion === "look"
              ? "turn-in-place"
              : desiredLocomotion === "sit"
                ? "cinematic-rest-on-platform"
                : "idle";
        this._avatar.syncLocomotionIfNeeded(desiredLocomotion, reason);
      }
      this._avatar.syncWalkAnimToHorizontalSpeed(
        horizontalSpeed,
        walkIntent && desiredLocomotion === "walk",
        now,
      );
      this._avatar.advanceMixer(delta);
    }

    this._tipi?.userData?.ybNpcMixer?.update?.(delta);
    const _ybBehaviour = this._tipi?.userData?.ybBehaviour ?? null;
    _ybBehaviour?.update?.(delta, body.position.x, body.position.z);
    /**
     * Seated player-aim helper writes `ybFacingGroup.rotation.y`. While the
     * tipi-owner behaviour controller is in motion (wave / walk / turnaround)
     * it owns the body yaw, so skip the seated aim until she's seated again.
     * Seated state has `suppressPlayerAim === false`, so the helper still
     * tracks the player in the default case.
     */
    if (!_ybBehaviour?.suppressPlayerAim) {
      updateYellowButterflyPlayerAim(this._tipi, body.position.x, body.position.z);
    }
    this._tipi?.userData?.tipiAmbientEffectsUpdate?.(delta);

    /**
     * Tipi 2 — Brings Happiness Girl. Same shape as the tipi-1 update path:
     * advance her animation mixer, tick the proximity behaviour FSM, then
     * write the seated player-aim yaw unless the controller is owning her
     * body during a wave / walk / sit cycle. As of the May-11 2026 user
     * spec ("add a fire in middle of tipi2 just like in tipi1") tipi 2
     * now also has its own brazier + smoke plume — drain its ambient
     * effects callback the same way we drain tipi 1's.
     */
    this._tipi2?.userData?.bhgNpcMixer?.update?.(delta);
    const _bhgBehaviour = this._tipi2?.userData?.bhgBehaviour ?? null;
    _bhgBehaviour?.update?.(delta, body.position.x, body.position.z);
    if (!_bhgBehaviour?.suppressPlayerAim) {
      updateBringsHappinessPlayerAim(this._tipi2, body.position.x, body.position.z);
    }
    this._tipi2?.userData?.tipiAmbientEffectsUpdate?.(delta);

    /*
     * Sacred-Journal proximity trigger (May-14 2026 user spec):
     *   • ≤ 6 ft from NPC YB's seat (V2_JOURNAL_YB_PROXIMITY_M).
     *   • DIRECTLY IN FRONT of her — bearing from YB→player within
     *     ±30° of her forward axis (V2_JOURNAL_YB_FRONT_CONE_RAD).
     *
     * YB faces world −Z (forward = (0, 0, −1)) seated on tipi 1, so
     * "in front of her" = the player sits on the −Z side of her seat
     * with a small lateral offset. The dot product between her forward
     * vector and the unit YB→player vector is therefore the cosine of
     * the bearing; gating on cos(angle) ≥ cos(cone) is the cone test.
     */
    const ybSeat = this._tipi?.userData?.ybSeatRoot;
    let insideJournalZone = false;
    if (ybSeat) {
      const ybX = ybSeat.position.x;
      const ybZ = ybSeat.position.z;
      const dxYB = body.position.x - ybX;
      const dzYB = body.position.z - ybZ;
      const distYB = Math.hypot(dxYB, dzYB);
      if (distYB <= V2_JOURNAL_YB_PROXIMITY_M && distYB > 1e-4) {
        // YB forward = (0, 0, -1); unit YB→player = (dxYB, dzYB) / distYB.
        // cos(bearing) = forward · unit = -dzYB / distYB.
        const cosBearing = -dzYB / distYB;
        const cosCone = Math.cos(V2_JOURNAL_YB_FRONT_CONE_RAD);
        insideJournalZone = cosBearing >= cosCone;
      }
    }
    if (
      insideJournalZone &&
      !this._journalTipiProximityWasInside &&
      !this._suppressJournalProximityOpen
    ) {
      try {
        if (typeof window !== "undefined") {
          window._v2OpenJournalFromProximity?.();
        }
      } catch (_e) {
        /* ignore */
      }
    }
    this._journalTipiProximityWasInside = insideJournalZone;

    this._natureSpirit?.update?.(delta);

    /**
     * Distance-LOD pass — May-17 2026 FPS cleanup ("clean up the world
     * scene code its been chopped up. fix culling"). Each Tripo NPC GLB
     * weighs 0.9–1.0 M tris; from > 25 m away they're a few pixels of
     * silhouette anyway, so we toggle their `root.visible` based on
     * planar distance to the player. Saves 1–2 M tris/frame whenever
     * the player is exploring outside the village hex.
     *
     * Hidden roots are NOT removed from the scene graph (only `visible`
     * flag changes) — that keeps animation mixers + the journal/quest
     * proximity triggers working while skipping the render pass. Three's
     * `visible: false` short-circuits the draw call entirely; verified
     * via Anu's `rendererInfoRender.triangles` matching the sum of
     * `visible: true` meshes only.
     */
    this._updateNpcDistanceLod(body.position.x, body.position.z);

    // Tick the click-to-move ground marker (X + dashed trail). The smart-
    // nav arrival branch above disposes this in the same frame the player
    // reaches the destination, so the marker visibly fades away as the
    // player halts rather than snapping out.
    if (this._clickToMoveMarker) {
      // May-17 2026 user spec: "change feet that they always line up
      // with the facing of player and at same level as player". Pass
      // the live yaw so the marker can orient prints along the player's
      // facing direction instead of the path direction.
      this._clickToMoveMarker.update(body.position, delta, this._yaw);
    }

    // Sky dome follows the camera (sphere centred on the viewer so the
    // BackSide dome always stays in front of every camera direction);
    // also advances cloud-fbm uTime + rotates the moon-beam group.
    this._celestial?.update?.(camera, delta);

    const headY = body.position.y;

    /**
     * Top-down village-view housekeeping (May-14 2026 user fix #2):
     *   • Clip foliage ONLY within ~1 tile of the player and each
     *     building — the prior pass hid every leaf in the world and
     *     drowned the map. Now the 99 %+ of the canopy that isn't
     *     covering anything important stays in frame.
     *   • Scale the player's FPV travel disc / ring / arrow up so the
     *     same marker reads on the overhead minimap.
     *
     * The proximity clip uses `getMatrixAt` per leaf instance — cheap
     * but not free — so we throttle to every ~3 frames while in map
     * view and also when the player has moved more than 1 m since the
     * last clip pass. When map view is OFF, fire one restore pass and
     * skip until it re-engages.
     */
    {
      const mapView = this._mainCanvasMapView === true;
      const trees = window.anuOrchestrator?._activeModuleInstances?.Trees;
      const px = body.position.x;
      const pz = body.position.z;
      if (mapView) {
        const lastX = this._lastFoliageClipX ?? Number.POSITIVE_INFINITY;
        const lastZ = this._lastFoliageClipZ ?? Number.POSITIVE_INFINITY;
        const moved = Math.hypot(px - lastX, pz - lastZ) > 1.0;
        this._foliageClipPhase = ((this._foliageClipPhase ?? 0) + 1) % 4;
        if (this._foliageClipPhase === 0 || moved || !this._foliageClipActive) {
          const CLIP_R = V2_TILE_WORLD * 0.95; // ~one tile around each target
          const targets = [{ x: px, z: pz, radius: CLIP_R }];
          if (this._tipi) {
            targets.push({ x: 0, z: 0, radius: CLIP_R });
          }
          if (this._tipi2) {
            targets.push({
              x: V2_TIPI_2_CENTER_X_M,
              z: V2_TIPI_2_CENTER_Z_M,
              radius: CLIP_R,
            });
          }
          trees?.setFoliageHiddenForMapView?.(true, targets);
          this._lastFoliageClipX = px;
          this._lastFoliageClipZ = pz;
          this._foliageClipActive = true;
        }
      } else if (this._foliageClipActive) {
        trees?.setFoliageHiddenForMapView?.(false, null);
        this._foliageClipActive = false;
        this._lastFoliageClipX = null;
        this._lastFoliageClipZ = null;
      }
      this._avatar?.setTravelMarkerScaleForMapView?.(mapView);
    }

    if (this._mainCanvasMapView) {
      const elev = 78;
      camera.position.set(body.position.x, rawFeetY + elev, body.position.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(body.position.x, rawFeetY, body.position.z);
      this._cameraSmoothReady = true;
    } else if (window._v2FishingCameraOverride) {
      /**
       * Fishing camera — `WorldFishingModule` parks the desired pos + look
       * on `window._v2FishingCameraOverride` each frame. Stays smooth via
       * the standard `_cameraPosSmooth` / `_cameraLookSmooth` lerp pair
       * but at a slower rate so the framing feels peaceful (kids fishing
       * mini-game spec, May-16 2026). Skips terrain clamping because the
       * fishing module already gives us a safe elevation 10 ft above the
       * dock — clamping here would pop the camera up when the player
       * stands inside the dock-deck surface (raycast hits deck, not
       * terrain).
       */
      const ov = window._v2FishingCameraOverride;
      this._cameraPosSmooth.set(ov.posX, ov.posY, ov.posZ);
      this._lookTarget.set(ov.lookX, ov.lookY, ov.lookZ);
      if (!this._cameraSmoothReady) {
        camera.position.copy(this._cameraPosSmooth);
        this._cameraLookSmooth.copy(this._lookTarget);
        this._cameraSmoothReady = true;
      } else {
        // Heavier inertia than chase camera — peaceful, not snappy.
        const cameraLerp = 1 - Math.pow(0.0008, delta);
        camera.position.lerp(this._cameraPosSmooth, cameraLerp);
        this._cameraLookSmooth.lerp(this._lookTarget, cameraLerp);
      }
      // Top-down fishing view: when the override carries an `upX/upZ`
      // unit vector (player→hook XZ axis), ease `camera.up` toward it.
      // A hard snap to a horizontal up while the camera is still mid-
      // transition (e.g. coming from the chase view) collapses the
      // orthonormal basis (`forward ≈ ±up` for one frame). The lerp
      // keeps the basis stable; we re-normalise after to avoid drift.
      const targetUpX = typeof ov.upX === "number" ? ov.upX : 0;
      const targetUpY = typeof ov.upX === "number" ? 0 : 1;
      const targetUpZ = typeof ov.upZ === "number" ? ov.upZ : 0;
      const upLerp = 1 - Math.pow(0.05, delta);
      this._cameraUpSmooth.x += (targetUpX - this._cameraUpSmooth.x) * upLerp;
      this._cameraUpSmooth.y += (targetUpY - this._cameraUpSmooth.y) * upLerp;
      this._cameraUpSmooth.z += (targetUpZ - this._cameraUpSmooth.z) * upLerp;
      const upLen = this._cameraUpSmooth.length() || 1;
      camera.up.set(
        this._cameraUpSmooth.x / upLen,
        this._cameraUpSmooth.y / upLen,
        this._cameraUpSmooth.z / upLen,
      );
      camera.lookAt(this._cameraLookSmooth);
      // Ease the FOV toward whatever the fishing module asked for (or
      // the default if it didn't push one). Same `expToward` envelope
      // the cinematic-idle path uses so the zoom feels natural rather
      // than instant on FSM transitions.
      if (typeof ov.fovDeg === "number") {
        const fovNext = expToward(camera.fov, ov.fovDeg, delta, 0.55);
        if (Math.abs(fovNext - camera.fov) > 0.04) {
          camera.fov = fovNext;
          camera.updateProjectionMatrix();
        }
      }
    } else if (
      this._cinematicIdleActive &&
      !modalBlocksLocomotion &&
      !journalOpen
    ) {
      /**
       * Panoramic idle — **main canvas only** (PiP / Orchestrator unchanged).
       *
       * Continuous **360°** azimuth with smoothed random **radius** (intimate →
       * village-wide), **pitch** (low horizon ↔ soft crane), **signed orbit speed**
       * (reverse + linger micro-pauses), and **FOV** zoom. Look target rides the
       * travel-ring neighbourhood so the golden disc + avatar stay in frame.
       */
      const th = this._cineOrbitAzimuth;
      const ph = this._cinePitch;
      const cp = Math.cos(ph);
      const sp = Math.sin(ph);
      const R = this._cineRadius;
      const pivotY = rawFeetY + 0.92;

      this._cameraPosSmooth.set(
        body.position.x + R * cp * Math.sin(th),
        pivotY + R * sp,
        body.position.z + R * cp * Math.cos(th),
      );

      const ringR = V2_AVATAR_TRAVEL_CIRCLE_RADIUS_M;
      const lookLift =
        0.045 +
        Math.min(1.05, ringR * 0.42) * (0.35 + 0.65 * (ph / CINEMATIC_PITCH_MAX_RAD));
      this._lookTarget.set(
        body.position.x,
        rawFeetY + lookLift,
        body.position.z,
      );

      const tauF = CINEMATIC_ORBIT_PARAM_LERP_TAU_S * 0.88;
      const fovNext = expToward(camera.fov, this._cineFovTgt, delta, tauF);
      if (Math.abs(fovNext - camera.fov) > 0.04) {
        camera.fov = fovNext;
        camera.updateProjectionMatrix();
      }

      clampChaseCameraAboveTerrainXZ(this._cameraPosSmooth, this._terrainY);
      if (!this._cameraSmoothReady) {
        camera.position.copy(this._cameraPosSmooth);
        this._cameraLookSmooth.copy(this._lookTarget);
        this._cameraSmoothReady = true;
      } else {
        const cLerp =
          1 -
          Math.pow(CINEMATIC_CAMERA_POSITION_LERP_EXP_BASE, delta);
        camera.position.lerp(this._cameraPosSmooth, cLerp);
        this._cameraLookSmooth.lerp(this._lookTarget, cLerp);
      }
      clampChaseCameraAboveTerrainXZ(camera.position, this._terrainY);
      camera.up.set(0, 1, 0);
      camera.lookAt(this._cameraLookSmooth);
    } else {
      const chaseView = walkIntent || turnOnly;
      if (chaseView) {
        this._cameraPosSmooth.set(
          body.position.x + this._back.x * FOLLOW_CAMERA_DIST,
          headY + FOLLOW_CAMERA_HEIGHT,
          body.position.z + this._back.z * FOLLOW_CAMERA_DIST,
        );
        this._lookTarget.set(
          body.position.x + this._fwd.x * V2_TILE_WORLD,
          headY,
          body.position.z + this._fwd.z * V2_TILE_WORLD,
        );
      } else {
        this._cameraPosSmooth.set(
          body.position.x + this._fwd.x * IDLE_FPV_HEAD_FORWARD,
          headY,
          body.position.z + this._fwd.z * IDLE_FPV_HEAD_FORWARD,
        );
        this._lookTarget.set(
          body.position.x + this._fwd.x * V2_TILE_WORLD,
          headY,
          body.position.z + this._fwd.z * V2_TILE_WORLD,
        );
      }

      // May-17 2026 FPS cleanup: hide the 587k-tri Avatar3 figurine
      // while in idle FPV. The camera sits 1.5 m ahead of the head
      // looking forward — the player can't see themselves anyway, but
      // Avatar3.glb has `frustumCulled = false` (skinned-mesh vanish
      // workaround) so it draws every frame regardless of viewport.
      // In chase view the avatar is behind the camera and visible, so
      // we re-show it. Net: ~587k tris saved per frame whenever the
      // player isn't actively walking.
      if (this._avatar?.root) {
        this._avatar.root.visible = chaseView;
      }

      clampChaseCameraAboveTerrainXZ(this._cameraPosSmooth, this._terrainY);

      if (!this._cameraSmoothReady) {
        camera.position.copy(this._cameraPosSmooth);
        this._cameraLookSmooth.copy(this._lookTarget);
        this._cameraSmoothReady = true;
      } else {
        const cameraLerp = 1 - Math.pow(0.01, delta);
        camera.position.lerp(this._cameraPosSmooth, cameraLerp);
        this._cameraLookSmooth.lerp(this._lookTarget, cameraLerp);
      }
      clampChaseCameraAboveTerrainXZ(camera.position, this._terrainY);
      camera.up.set(0, 1, 0);
      camera.lookAt(this._cameraLookSmooth);
    }

    if (
      !this._cinematicIdleActive &&
      !this._mainCanvasMapView &&
      !window._v2FishingCameraOverride &&
      Math.abs(camera.fov - DEFAULT_CAMERA_FOV) > 0.06
    ) {
      camera.fov = expToward(camera.fov, DEFAULT_CAMERA_FOV, delta, 0.48);
      camera.updateProjectionMatrix();
    }

    if (_frameCount % 24 === 0) {
      dispatchInteraction(ANU_EVENTS.PLAYER_STATE_SAMPLE, {
        t: typeof performance !== "undefined" ? performance.now() : 0,
        frame: _frameCount,
        x: body.position.x,
        y: body.position.y,
        z: body.position.z,
        yaw: this._yaw,
        grounded: body.grounded,
        walkDistance: this._walkDistance,
        velocityXZ: Math.sqrt(
          body.velocity.x * body.velocity.x + body.velocity.z * body.velocity.z,
        ),
      });
    }

    const playerState = buildWorldPlayerState(this, camera, body);
    registerRuntimeService("WorldPlayer", playerState, { owner: this.name });
    // Legacy alias for console workflows and older scripts.
    window.WorldPlayer = playerState;
  },

  // ──────────────────────────────────────────────────────────────────────────
  unload(scene) {
    try {
      if (typeof window._v2SetCinematicUiHidden === "function") {
        window._v2SetCinematicUiHidden(false);
      }
    } catch (_e) {
      /* ignore */
    }
    this._cinematicIdleActive = false;
    this._lastCinematicUiHidden = false;
    this._lastAvatarCinematicDrawThrough = false;
    this._idleStandSeconds = 0;

    try {
      if (this._camera) {
        this._camera.fov = DEFAULT_CAMERA_FOV;
        this._camera.updateProjectionMatrix();
      }
    } catch (_e) {
      /* ignore */
    }

    try {
      this._avatar?.setCinematicIdleFigurineDrawThrough?.(false);
    } catch (_e) {
      /* ignore */
    }

    try {
      document.body.classList.remove("v2-village-view");
      this._lastVillageViewBodyClass = false;
      if (typeof window._v2SyncVillageViewRightStack === "function") {
        window._v2SyncVillageViewRightStack();
      }
    } catch (_e) {
      /* ignore */
    }

    if (this._tipi2AxePickupFx) {
      const fx = this._tipi2AxePickupFx;
      try {
        if (fx.light && fx.root) fx.root.remove(fx.light);
        if (fx.root && this._scene) this._scene.remove(fx.root);
        disposeSubtreeGpuResources(fx.root);
      } catch (_e) {
        /* ignore */
      }
      this._tipi2AxePickupFx = null;
    }

    if (this._canvas && this._onCanvasPointerPrimary) {
      this._canvas.removeEventListener(
        "pointerdown",
        this._onCanvasPointerPrimary,
      );
    }
    this._onCanvasPointerPrimary = null;
    this._journalGuideRoot = null;
    this._terrainRaycastMesh = null;
    this._smartNavGoal = null;
    this._disposeClickToMoveMarker();
    this._journalRaycaster = null;
    this._journalNdcScratch = null;
    this._scene = null;
    // Nature-spirit dispose first so it gets to clean up its own materials +
    // pull its objects out of `this._objects` before the generic sweep.
    try {
      this._natureSpirit?.dispose?.(scene, this._objects);
    } catch (err) {
      console.warn("[World] NatureSpirit dispose failed:", err);
    }
    this._natureSpirit = null;

    // Celestial sky dome owns its own root + materials + bus subscriptions.
    try {
      this._celestial?.dispose?.(scene);
    } catch (err) {
      console.warn("[World] Celestial dispose failed:", err);
    }
    this._celestial = null;
    for (const obj of this._objects) {
      scene.remove(obj);
      obj.traverse?.((child) => {
        if (child.geometry) child.geometry.dispose?.();
        const mat = child.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
        else mat?.dispose?.();
      });
      if (obj.geometry) obj.geometry.dispose?.();
      const mat = obj.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
      else mat?.dispose?.();
    }
    this._objects = [];
    this._avatar.dispose();
    this._playerBody = null;
    this._cameraSmoothReady = false;
    this._autoWalk.active = false;
    this._autoWalk.key = null;
    this._autoWalk.startedByHoldAt = 0;
    this._keyDownAt = {};
    this._mainCanvasMapView = false;
    this._journalTipiProximityWasInside = false;
    this._suppressJournalProximityOpen = false;
    clearPlayerInput(this);
    WorldPhysics._reset();
    clearRuntimeService("WorldPhysics", WorldPhysics);
    clearRuntimeService("WorldPlayer");
    if (window.WorldPhysics === WorldPhysics) delete window.WorldPhysics;
    if (window.WorldPlayer) delete window.WorldPlayer;
    if (window._terrainHeightCache?.lookup === terrainY) delete window._terrainHeightCache;
    console.log("[World] ⏹ Unloaded.");
  },

  /**
   * Distance-LOD ticker — toggles `root.visible` on the heavy Tripo NPC
   * GLBs based on planar distance to the player. Called every frame
   * from `update()`. The cached refs (`_npcLodCache`) are resolved
   * lazily on first call so this works regardless of module load order
   * (TraderJosh, BHG, etc. all activate after World).
   *
   * Thresholds (m, planar XZ) — tuned so a player standing anywhere on
   * the central valley floor (within `CLEARING_R = 55 m` of origin)
   * still sees every NPC that is also inside the valley. NPCs sitting
   * one or two tiles beyond the clearing rim are the ones that pop in:
   *   • BHG seated NPC (tipi 2 @ (22, 0))  — hide beyond 35 m
   *   • TraderJosh greeter  (1.4, -6)      — hide beyond 30 m
   *   • YB seated NPC (tipi 1 @ ~(0, -0.7)) — hide beyond 25 m
   * (journal-trigger radius is 1.8 m so YB's far visibility has no
   * gameplay role; she only needs to read at "village in view" range)
   *
   * Tipis themselves stay visible always — they're navigation landmarks
   * even at the world edge.
   */
  _updateNpcDistanceLod(px, pz) {
    if (!this._npcLodCache) this._npcLodCache = { ready: false };
    const cache = this._npcLodCache;
    if (!cache.ready) {
      const tipi1 = this._objects?.find?.(
        (o) => o?.name === "structure_tipi_1_center",
      );
      const tipi2 = this._objects?.find?.(
        (o) => o?.name === "structure_tipi_2_bhg",
      );
      cache.bhgRoot = tipi2?.userData?.bhgSeatRoot ?? null;
      cache.ybRoot = tipi1?.userData?.ybSeatRoot ?? null;
      cache.ready = !!(cache.bhgRoot || cache.ybRoot);
    }

    const checkLod = (root, maxDist) => {
      if (!root) return;
      const dx = root.position.x - px;
      const dz = root.position.z - pz;
      const wantVisible = dx * dx + dz * dz <= maxDist * maxDist;
      if (root.visible !== wantVisible) root.visible = wantVisible;
    };
    checkLod(cache.bhgRoot, 35);
    checkLod(cache.ybRoot, 25);
  },

  /** Dispose the click-to-move ground marker if one is active. Idempotent. */
  _disposeClickToMoveMarker() {
    if (this._clickToMoveMarker) {
      try { this._clickToMoveMarker.dispose(); } catch (_e) { /* ignore */ }
      this._clickToMoveMarker = null;
    }
  },

  /**
   * True when the player's XZ position sits inside any sacred-circle
   * building platform. Used by the cinematic-idle decision to swap the
   * avatar's locomotion to `sit` when the player rests on a tipi deck
   * (May-14 2026 user spec). Only the two canonical tipis (origin +
   * tipi 2) are tracked here; player-spawned tipis from VillageBuilder
   * are not yet enumerated.
   *
   * @param {number} x
   * @param {number} z
   */
  _isPlayerOnBuildingPlatform(x, z) {
    const r = V2_TIPI_SACRED_PLATFORM_RADIUS;
    const r2 = r * r;
    if (x * x + z * z < r2) return true;
    const dx2 = x - V2_TIPI_2_CENTER_X_M;
    const dz2 = z - V2_TIPI_2_CENTER_Z_M;
    if (dx2 * dx2 + dz2 * dz2 < r2) return true;
    return false;
  },

  /** Autowalk + scripted nav — called when Sacred Journal overlay opens. */
  cancelAutowalkForJournalOverlay() {
    this._autoWalk.active = false;
    this._autoWalk.key = null;
    this._autoWalk.startedByHoldAt = 0;
    this._smartNavGoal = null;
    this._disposeClickToMoveMarker();
    const body = this._playerBody;
    if (body) {
      body.velocity.x = 0;
      body.velocity.z = 0;
    }
  },

  _tryPickupTipi2QuestAxe() {
    const ctl = this._tipi2?.userData?.questAxe;
    const axe = ctl?.root;
    const scene = this._scene;
    if (!axe?.parent || !scene || this._tipi2AxePickupFx) return;
    if (axe.userData._v2QuestAxeCollected) return;
    axe.userData._v2QuestAxeCollected = true;
    axe.userData._v2QuestAxePickupAmbientOff = true;

    const baseScale = axe.scale.x;
    const light = new THREE.PointLight(0xffe8c4, 0, 18, 2);
    axe.add(light);

    axe.traverse((ch) => {
      if (!ch.isMesh) return;
      const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
      for (let mi = 0; mi < mats.length; mi++) {
        const m = mats[mi];
        if (!m?.emissive) continue;
        m.emissive.setHex(0xff9944);
        m.emissiveIntensity = 4;
      }
    });

    this._tipi2AxePickupFx = {
      root: axe,
      light,
      t: 0,
      dur: 0.52,
      baseScale,
    };

    try {
      window._v2StoneAxeInInventory = true;
      window._v2JournalInsertLogPageAfterTitle?.({
        afterTitle: "Brings Happiness Girl",
        title: "Stone Axe Secured",
        text:
          "You lifted the carved stone axe from the grass beside Brings Happiness Girl's doorway. Its edge catches the light — ready when you gather lodge poles.",
        icon: "fa-solid fa-hammer",
      });
    } catch (_e) {
      /* ignore */
    }
  },

  _advanceTipi2QuestAxePickupFx(delta) {
    const fx = this._tipi2AxePickupFx;
    if (!fx) return;
    if (!fx.root?.parent) {
      this._tipi2AxePickupFx = null;
      return;
    }
    fx.t += delta;
    const k = Math.min(1, fx.t / fx.dur);
    fx.light.intensity = Math.sin(Math.PI * k) * 13;
    const scaleMul = Math.max(0.02, 1 - k * k * k);
    fx.root.scale.setScalar(fx.baseScale * scaleMul);
    if (k >= 1) {
      fx.root.remove(fx.light);
      this._scene?.remove(fx.root);
      disposeSubtreeGpuResources(fx.root);
      delete this._tipi2.userData.questAxe;
      this._tipi2AxePickupFx = null;
    }
  },

  cancelSmartNavigate() {
    this._smartNavGoal = null;
    this._disposeClickToMoveMarker();
  },

  /**
   * Straight-line polyline from current XZ to (gx,gz); each segment gets obstacle
   * steering so the avatar does not face “through” a tree while side-stepping it.
   *
   * @param {number} gx
   * @param {number} gz
   * @param {number|null|undefined} [tolerance]
   * @param {(() => void)|null} [onArrive]
   */
  startSmartNavigateTo(gx, gz, tolerance, onArrive) {
    this._autoWalk.active = false;
    this._autoWalk.key = null;
    this._autoWalk.startedByHoldAt = 0;
    const tol =
      typeof tolerance === "number"
        ? tolerance
        : V2_SMART_NAV_ARRIVE_TOLERANCE_M;
    const body = this._playerBody;
    const sx = body?.position.x ?? 0;
    const sz = body?.position.z ?? 0;
    const segments = this._buildSmartNavSegments(sx, sz, gx, gz);
    const wpTol = Math.min(2.5, tol + 0.75);
    this._smartNavGoal = {
      segments,
      segIdx: 0,
      tolerance: tol,
      wpTol,
      onArrive: typeof onArrive === "function" ? onArrive : null,
    };
    /**
     * Snap yaw to face the click target on engagement (May-14 2026 user fix:
     * "click to move was walking backwards autowalk"). Reason: velocity gets
     * set toward the target on frame 1, but the per-frame yaw clamp
     * (`maxTurn = 7.5 * delta`) caps rotation to ~7.5 rad/s, so a 180° turn
     * needs ~0.42 s. During that window the body walked toward the target
     * while the figurine still faced the old direction — read on-screen as
     * backwards walking (or sideways for off-axis clicks). Snapping yaw to
     * the initial bearing means the very first locomotion frame already
     * faces the goal; the in-loop maxTurn still smooths obstacle-steered
     * course corrections after the first step.
     */
    if (body && segments.length > 0) {
      const tgt0 = segments[0];
      const idx0 =
        segments.length > 1 && Math.hypot(tgt0.x - sx, tgt0.z - sz) < 0.05
          ? 1
          : 0;
      const aim = segments[Math.min(idx0, segments.length - 1)];
      const adx = aim.x - sx;
      const adz = aim.z - sz;
      if (adx * adx + adz * adz > 1e-6) {
        const ad = Math.hypot(adx, adz);
        const amx = adx / ad;
        const amz = adz / ad;
        this._yaw = Math.atan2(-amx, -amz);
      }
    }

    /**
     * Click-to-move ground marker — gold X at the destination + dashed
     * trail along the path (May-14 2026 user spec). Lifetime tied to the
     * smart-nav goal: a new smart-nav call disposes the previous marker
     * and spawns a fresh one at the new goal so back-to-back clicks never
     * leave a stale X on the ground.
     */
    if (this._scene && this._terrainY) {
      try {
        this._disposeClickToMoveMarker();
        this._clickToMoveMarker = createClickToMoveMarker({
          scene: this._scene,
          terrainY: this._terrainY,
        });
        this._clickToMoveMarker.setGoal(gx, gz);
      } catch (err) {
        console.warn("[World] click-to-move marker init failed:", err);
        this._clickToMoveMarker = null;
      }
    }
  },

  /**
   * Smart-nav with an EXPLICIT waypoint chain. Same lifecycle as
   * `startSmartNavigateTo` but skips the linear segment builder — caller
   * supplies the route. Used by the FISH guide-card handler to route the
   * player AROUND the pond (the default builder cuts a straight line that
   * marches through the water; see V2Panel `fishClickHandler` for the
   * bypass + dock-corridor calculation).
   *
   * @param {{ x: number, z: number }[]} waypoints — ordered waypoints; the
   *   last entry is the final goal. Must contain at least one point.
   * @param {number} tolerance
   * @param {((world: any) => void) | null} onArrive
   */
  startSmartNavigateViaWaypoints(waypoints, tolerance, onArrive) {
    if (!Array.isArray(waypoints) || waypoints.length === 0) return;
    this._autoWalk.active = false;
    this._autoWalk.key = null;
    this._autoWalk.startedByHoldAt = 0;
    const tol =
      typeof tolerance === "number"
        ? tolerance
        : V2_SMART_NAV_ARRIVE_TOLERANCE_M;
    const body = this._playerBody;
    const sx = body?.position.x ?? 0;
    const sz = body?.position.z ?? 0;
    const segments = waypoints.map((w) => ({ x: w.x, z: w.z }));
    const wpTol = Math.min(2.5, tol + 0.75);
    this._smartNavGoal = {
      segments,
      segIdx: 0,
      tolerance: tol,
      wpTol,
      onArrive: typeof onArrive === "function" ? onArrive : null,
    };
    if (body && segments.length > 0) {
      const tgt0 = segments[0];
      const idx0 =
        segments.length > 1 && Math.hypot(tgt0.x - sx, tgt0.z - sz) < 0.05
          ? 1
          : 0;
      const aim = segments[Math.min(idx0, segments.length - 1)];
      const adx = aim.x - sx;
      const adz = aim.z - sz;
      if (adx * adx + adz * adz > 1e-6) {
        const ad = Math.hypot(adx, adz);
        const amx = adx / ad;
        const amz = adz / ad;
        this._yaw = Math.atan2(-amx, -amz);
      }
    }
    if (this._scene && this._terrainY) {
      try {
        this._disposeClickToMoveMarker();
        const last = segments[segments.length - 1];
        this._clickToMoveMarker = createClickToMoveMarker({
          scene: this._scene,
          terrainY: this._terrainY,
        });
        this._clickToMoveMarker.setGoal(last.x, last.z);
      } catch (err) {
        console.warn("[World] click-to-move marker init failed:", err);
        this._clickToMoveMarker = null;
      }
    }
  },

  /**
   * @param {number} sx
   * @param {number} sz
   * @param {number} gx
   * @param {number} gz
   * @returns {{ x: number, z: number }[]}
   */
  _buildSmartNavSegments(sx, sz, gx, gz) {
    const dx = gx - sx;
    const dz = gz - sz;
    const len = Math.hypot(dx, dz);
    /** @type {{ x: number, z: number }[]} */
    const out = [];
    if (len < 0.08) {
      out.push({ x: gx, z: gz });
      return out;
    }
    const ux = dx / len;
    const uz = dz / len;
    let d = SMART_NAV_WAYPOINT_STEP_M;
    while (d < len - SMART_NAV_WAYPOINT_STEP_M * 0.12) {
      out.push({ x: sx + ux * d, z: sz + uz * d });
      d += SMART_NAV_WAYPOINT_STEP_M;
    }
    out.push({ x: gx, z: gz });
    return out;
  },

  /** @param {unknown} targetName Entity id-style string from Sacred Journal / ANU. */
  handleAutowalk(targetName) {
    const compact = String(targetName ?? "")
      .toLowerCase()
      .replace(/[\s_]/g, "");
    const rimOff = -(V2_TIPI_SACRED_PLATFORM_RADIUS + 0.5 * V2_TILE_WORLD);

    /** @type {number} */
    let gx = V2_INTRO_TIPI1_APPROACH_X_M;
    /** @type {number} */
    let gz = V2_INTRO_TIPI1_APPROACH_Z_M;
    let ok = false;
    /** @type {number} */
    let tolAugment = 0;

    if (
      compact === "yellowbutterfly" ||
      (compact.includes("yellow") && compact.includes("butter"))
    ) {
      ok = true;
    } else if (
      compact.includes("bringshappiness") ||
      compact === "bringshappinessgirl"
    ) {
      gx = V2_TIPI_2_CENTER_X_M;
      gz = V2_TIPI_2_CENTER_Z_M + rimOff;
      tolAugment = 0.7;
      ok = true;
    } else if (
      compact.includes("pond") ||
      compact.includes("fish") ||
      compact === "fishingspot"
    ) {
      gx = V2_POND_ENCLAVE_CENTER_X_M;
      gz = V2_POND_ENCLAVE_CENTER_Z_M - 6;
      tolAugment = 1.2;
      ok = true;
    } else if (compact === "axe" || compact.includes("stoneaxe")) {
      const ax = getTipi2QuestAxeNominalXZ();
      gx = ax.x;
      gz = ax.z;
      tolAugment = 0.95;
      ok = true;
    }

    if (!ok) return false;
    this.startSmartNavigateTo(
      gx,
      gz,
      V2_SMART_NAV_ARRIVE_TOLERANCE_M + tolAugment,
      null,
    );
    return true;
  },

  /**
   * Quest-1 "Start Game" handler — May-14 2026 user spec, stripped down:
   *
   *   1. CLOSE JOURNAL  (the parent handler does this before calling us)
   *   2. AUTOWALK NORTH to a halt point 0.5 tiles directly IN FRONT OF
   *      NPC YB's seated model (`ybSeatRoot.position`).
   *   3. STOP. No cinematic, no balloon pop, no confetti, no auto-reopen
   *      of the journal — that's all gone now per the user's "it should
   *      JUST autowalk" instruction.
   *
   * "In front of YB" is the −Z side of her world position (she faces −Z
   * by spawn convention; `_fwd = (0, 0, -1)` at yaw 0). Player coming from
   * the south halts on the same axis, 0.5 tiles south of her, so she ends
   * up directly in front of the player when they arrive.
   */
  beginJournalStartGameIntro() {
    if (!this._playerBody) return;
    this._hardStopLocomotion();

    const seat = this._tipi?.userData?.ybSeatRoot;
    if (!seat) {
      console.warn("[World] Start Game: ybSeatRoot missing — cannot autowalk to YB.");
      return;
    }
    const seatPos = new THREE.Vector3();
    seat.getWorldPosition(seatPos);
    // 0.5 tiles "in front of" YB. YB faces −Z; in front of her is the −Z
    // side of her position. The player approaches from the south (+Z),
    // walking north, and halts BEFORE crossing her plane — so the halt
    // point is +0.5 tiles south of her on the world Z axis.
    const gx = seatPos.x;
    const gz = seatPos.z + 0.5 * V2_TILE_WORLD;

    this.startSmartNavigateTo(
      gx,
      gz,
      V2_SMART_NAV_ARRIVE_TOLERANCE_M,
      null,
    );
  },

  /**
   * Quest-2 "GREET HER" handler — autowalk to 0.5 tiles in front of BHG,
   * mirroring the YB rule above. No cinematic, no auto-page-flip.
   */
  beginJournalGreetBhg() {
    if (!this._playerBody) return;
    this._hardStopLocomotion();

    const seat = this._tipi2?.userData?.bhgSeatRoot;
    if (!seat) {
      console.warn("[World] GREET HER: bhgSeatRoot missing — cannot autowalk to BHG.");
      return;
    }
    const seatPos = new THREE.Vector3();
    seat.getWorldPosition(seatPos);
    const gx = seatPos.x;
    const gz = seatPos.z + 0.5 * V2_TILE_WORLD;

    this.startSmartNavigateTo(
      gx,
      gz,
      V2_SMART_NAV_ARRIVE_TOLERANCE_M,
      null,
    );
  },

  /**
   * Hard-stop helper used by all scripted intros — zeros locomotion state
   * so the new smart-nav step gets a clean first frame (no residual
   * velocity blending into the path's initial heading).
   */
  _hardStopLocomotion() {
    const body = this._playerBody;
    if (!body) return;
    this._smartNavGoal = null;
    this._autoWalk.active = false;
    this._autoWalk.key = null;
    this._autoWalk.startedByHoldAt = 0;
    body.velocity.x = 0;
    body.velocity.z = 0;
    this._navScriptedDriving = false;
    this._disposeClickToMoveMarker();
  },

  // ──────────────────────────────────────────────────────────────
  _setupInput() {
    wirePlayerInput(this, dispatchInteraction, ANU_EVENTS);
  },
};
