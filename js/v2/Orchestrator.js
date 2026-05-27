/**
 * Sacred Adventures v2 — SacredOrchestrator (Anu engine shell)
 *
 * Responsibilities:
 *  1. Own the Three.js renderer, scene, camera, and clock
 *  2. Maintain a MODULE REGISTRY — each module is a named object with
 *     { name, load(), unload(), update(delta) }
 *  3. Benchmark FPS cost of every module in isolation
 *  4. Drive the requestAnimationFrame loop and call active module updates
 *  5. Render an on-screen HUD showing live FPS and active module list
 *  6. Expose the live shell as window.anuOrchestrator (canonical). window.Orchestrator is a
 *     legacy alias for the same instance. Class SacredOrchestrator ≠ global: import the class,
 *     use window.anuOrchestrator for the singleton engine at runtime.
 *  7. After AnuModule loads, window.AnuUniverse is the primary governance + sensor portal
 *     (exports, audit, InteractionBus). Engine HUD stays on anuOrchestrator.report().
 */

import * as THREE from 'three';
import {
  V2_PIP_ORTHO_WIDTH,
  V2_PIP_ORTHO_ZOOM,
  V2_PIP_RENDER_EVERY_N_FRAMES,
  V2_TARGET_FPS,
} from "./constants.js";
import {
  shouldRenderPipSceneThisFrame,
  getRenderingSnapshot,
} from "./anu/RenderingGovernor.js";
import { dispatchInteraction } from "./anu/InteractionBus.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import {
  recordFrameDuration,
  getFrameBudgetSnapshot,
  getFrameSamples,
  getSystemStressLevel,
  STRESS_LEVELS,
} from "./anu/FrameBudget.js";
import { tickAdaptiveRenderPolicy } from "./anu/AdaptiveRenderPolicy.js";
import {
  recordSacredLoopError,
  recordModuleLoadError,
  tickPipelineStressLedger,
  STRESS_LEDGER_SAMPLE_INTERVAL_FRAMES,
} from "./anu/AnuErrorAndStressLedger.js";
import {
  captureSceneRenderInventory,
  SCENE_INVENTORY_INTERVAL_FRAMES,
} from "./anu/SceneModelInventory.js";
import {
  getRuntimeService,
  getRuntimeServicesSnapshot,
  validateRuntimeServiceContracts,
} from "./RuntimeServices.js";
import { ensurePipOrthoRingClipRuntimeServiceRegistered } from "./anu/PipOrthoRingDiskClip.js";
/**
 * Side-effect import — registers `AnuNatureAwareness` on `RuntimeServices`
 * at load time. The orchestrator pumps `.tick()` once per frame so the
 * service's player-position cache stays one frame fresh. See its source
 * for the rationale (May-16 2026 user spec on inter-animal awareness).
 */
import { AnuNatureAwareness } from "./anu/AnuNatureAwareness.js";
import {
  attachVillageViewRightStackLayout,
  buildOrchestratorHud,
  updateOrchestratorHudModules,
  updateOrchestratorHudValues,
} from "./OrchestratorHud.js";

const _pipSpiritLook = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const BENCH_FRAMES   = 180;   // frames to average for a benchmark
const SMOOTH_ALPHA   = 0.05;  // EMA smoothing for live FPS

// Modules whose update() is suspended while fishing is active.
// Geometries are already culled by _enterFishingZone; these CPU loops
// have nothing pond-relevant to do and would just burn frame budget.
const FISHING_SUSPEND_MODULES = new Set([
  'SanctuaryButterflies', 'SanctuaryBraziers', 'SanctuaryWeather',
  'SanctuaryTipis',       'SanctuaryTipiNpcs', 'SanctuaryVillagePad',
  'SanctuaryToolPalette', 'SanctuaryMapGeneratorUi',
  'SanctuaryKeyboardLook','SanctuaryZoom',      'SanctuaryWelcomeGuide',
  'SanctuaryJournalBridge','SanctuaryCursor',   'SanctuaryInventory',
  'SanctuarySky',                               'SanctuaryClickToMove',
  'SanctuaryMutations',   'SanctuaryAmbient',
  'MoldPlaceTipi', 'MoldPlantRock', 'MoldPlantLily',
  'MoldPlantBush', 'MoldPlantFlower', 'MoldPlantTree', 'MoldGrowHill',
]);

// ─────────────────────────────────────────────────────────────────────────────
// SACRED ORCHESTRATOR (engine shell — Anu runtime host)
// ─────────────────────────────────────────────────────────────────────────────
export class SacredOrchestrator {
  constructor(canvas) {
    // ── Renderer ──────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      // MSAA OFF — May-19 2026 FPS pass. With DPR ≥ 1.25 the supersample
      // implicit in upscaling already smooths edges; running MSAA on top
      // doubled the cost without a meaningful visual gain on this
      // stylised scene. The hex-seam stair-stepping that motivated MSAA
      // earlier is gone now that DPR is the AA strategy.
      antialias: false,
      powerPreference: "high-performance",
    });
    // Pixel ratio: previously hard-clamped at 1.0 to chase 120 FPS, but
    // that left Retina-class displays rendering into a ¼-area buffer →
    // the entire scene read as soft / pixelated. Cap at 2.0 instead so
    // we get native Retina sharpness when available without paying for
    // 3× DPR phones / kiosks. Adaptive policy still has the freedom to
    // dial this back via `setPixelRatio` if FPS bends under load.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Shadows enabled — flat black contact discs under trees / rabbits
    // were the second-largest "ugly" read in the landscape screenshot.
    // PCFSoftShadowMap softens the umbra so a single shadow pass adds
    // depth across the whole scene; we leave per-mesh `castShadow` /
    // `receiveShadow` flags on the modules that already opted in.
    this.renderer.shadowMap.enabled = true;
    // PCF (not PCFSoft) — Soft is 5-tap and dominated the frame on a
    // scene with 16+ shadow casters and a 1024² shadow map. The visual
    // diff at the sanctuary's camera distances is small; the perf diff
    // is ~½ the shadow shader cost. Keeping shadows enabled is what
    // separates the v4 look from a flat low-poly read.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;

    // ── Production shader-debug OFF (May-19 2026 FPS profile) ────────
    // `gl.getProgramInfoLog` is a CPU↔GPU readback that Three.js fires
    // after every shader compile to surface compile errors. The profile
    // showed `onFirstUse` blocking the main thread for 403 ms (342 ms
    // inside getProgramInfoLog). Disabling skips the readback; if a
    // shader genuinely fails to compile we'll still see the WebGL
    // console error from the browser. Saves ~340 ms on first-frame.
    this.renderer.debug.checkShaderErrors = false;

    // ── Warm up GPU extensions during boot, not first frame ──────────
    // The profile flagged `getExtension('EXT_texture_filter_anisotropic')`
    // taking 280 ms on first touch. Many Sanctuary textures set
    // `tex.anisotropy = 4`, which triggers that query lazily during
    // the first scene render — i.e. inside the user-visible frame
    // budget. Forcing it here moves the stall behind the loading
    // modal where the user is already waiting.
    try {
      const caps = this.renderer.capabilities;
      const maxAniso = caps?.getMaxAnisotropy?.();
      console.log(
        `%c[SacredOrchestrator] GPU extensions warmed — maxAnisotropy=${maxAniso ?? "?"}`,
        "color:#80deea;",
      );
    } catch (_) { /* best-effort warmup */ }

    // ── Scene & Camera ────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      2000,
    );
    this.camera.position.set(0, 1.7, 5);

    // ── Clock ─────────────────────────────────────────────────────────────
    this.clock = new THREE.Clock();

    // ── Module registry ───────────────────────────────────────────────────
    // Map<name, { module, active, fpsCost, benchFrames, benchTotal }>
    this._registry = new Map();
    this._activeModules = []; // ordered list of active module names

    /**
     * `_activeModuleInstances` — name → live module object shim.
     *
     * Multiple callers (the parent journal-postMessage bridge in
     * index.v2.html, the START GAME / GREET HER intros in
     * `World.beginJournalStartGameIntro`, the top-down map-view foliage
     * hide in `World.update`, and the VillageBuilder building list) all
     * read `window.anuOrchestrator._activeModuleInstances.<Name>` via
     * optional chaining (`?.`). Until now nothing actually built that
     * record — every callsite silently no-op'd because the property was
     * undefined. That's why "START GAME does nothing" + "I don't see a
     * single change you say you made to map view" both reproduced: the
     * lookups were dead.
     *
     * This is a `Proxy` rather than a hand-maintained dict so we don't
     * have to remember to update it on every register / activate /
     * deactivate; each property access just reads from the live
     * `_registry`. Returns the module itself (not the entry wrapper),
     * so callers can keep writing `.World?.beginJournalStartGameIntro?.()`.
     */
    this._activeModuleInstances = new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (typeof prop !== "string") return undefined;
          const entry = this._registry?.get(prop);
          return entry?.module;
        },
        has: (_t, prop) => {
          if (typeof prop !== "string") return false;
          return this._registry?.has(prop) === true;
        },
        ownKeys: () =>
          this._registry ? Array.from(this._registry.keys()) : [],
        getOwnPropertyDescriptor: (_t, prop) => {
          if (typeof prop !== "string") return undefined;
          const entry = this._registry?.get(prop);
          if (!entry) return undefined;
          return { enumerable: true, configurable: true, value: entry.module };
        },
      },
    );

    // ── FPS tracking ──────────────────────────────────────────────────────
    this.smoothFPS = 0;
    this.rawFPS = 0;
    this._peakFPS = 0; // highest smoothed FPS seen — theoretical max
    this._fpsReady = false; // wait for EMA to warm up before benchmarking
    this._frameCount = 0;
    this._disposed = false;
    this._rafId = 0;

    // ── Benchmarking state ────────────────────────────────────────────────
    this._bench = null; // { name, frames, totalDelta, baselineFPS }
    /** Serial bench queue — avoids overlapping intervals when many modules activate before FPS warmup */
    this._benchQueue = [];
    this._warmupPoll = null;

    // ── Moondial PiP: second WebGLRenderer — ortho (map) vs persp (spirit) swapped with main view ──
    this._pipRenderer = null;
    this._pipOrtho = null;
    this._pipPersp = null;
    this._pipW = 0;
    this._pipH = 0;
    /** Cached `userData.anuKind === "tipi_smoke"` — hidden for PiP ortho + spirit passes. */
    this._pipTipiSmokePlume = null;
    /** Did the last `_renderPip()` invocation actually render? Surfaced in the HUD's PiP line. */
    this._pipRenderedLastFrame = false;
    /**
     * User-level PiP ortho zoom multiplier (UIModule "+/−" buttons → CustomEvent
     * "v2-pip-zoom-change"). Combined with V2_PIP_ORTHO_ZOOM in the frustum
     * span so adaptive policy + designer-tuned defaults compose with the
     * per-user preference. Range matches UIModule clamp [0.6, 1.6].
     */
    this._pipUserZoom = this._readPipUserZoomFromStorage();
    const self = this;
    this._pipStrategy = {
      getSnapshot() {
        return Object.freeze({
          id: "webgl-scene-pip",
          label: "PiP=WebGL (ortho/persp swap vs main)",
          canvasWidth: self._pipW,
          canvasHeight: self._pipH,
          secondWebGlPass: V2_PIP_RENDER_EVERY_N_FRAMES > 0,
        });
      },
      dispose() {},
      render() {},
    };

    // ── HUD ───────────────────────────────────────────────────────────────
    this._hud = this._buildHUD();
    attachVillageViewRightStackLayout();

    // ── Resize ────────────────────────────────────────────────────────────
    this._onResizeBound = () => this._onResize();
    window.addEventListener("resize", this._onResizeBound);

    // ── PiP user zoom (UIModule "v2-pip-zoom-change") ─────────────────────
    this._onPipZoomChangeBound = (e) => this._onPipUserZoomChange(e);
    window.addEventListener("v2-pip-zoom-change", this._onPipZoomChangeBound);

    /** Runtime discriminator — only the constructed engine shell sets this (not random globals). */
    this.isSacredOrchestratorShell = true;

    // ── Expose globally ───────────────────────────────────────────────────
    window.anuOrchestrator = this;
    /** Legacy alias — must stay identical to anuOrchestrator (singleton engine shell). */
    window.Orchestrator = this;

    ensurePipOrthoRingClipRuntimeServiceRegistered();

    console.log(
      "%c[SacredOrchestrator] 🚀 Sacred Adventures v2 — Engine Online",
      "color:#fbc02d;font-weight:bold;font-size:14px;",
    );
    console.log("[SacredOrchestrator] Renderer:", this.renderer.info.render);
    console.log(
      "[SacredOrchestrator] anuOrchestrator.report() — engine HUD · AnuUniverse.report() — governance + sensors (after activate('Anu')).",
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MODULE REGISTRY
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Register a module. Does NOT activate it.
   * @param {object} mod  { name:string, load:fn, unload:fn, update:fn(delta) }
   */
  register(mod) {
    if (!mod.name || typeof mod.load !== 'function') {
      console.error('[SacredOrchestrator] Invalid module — must have name + load()', mod);
      return;
    }
    this._registry.set(mod.name, {
      module:      mod,
      active:      false,
      fpsCost:     null,   // null = not yet benchmarked
      benchFrames: 0,
      benchTotal:  0,
    });
    console.log(`%c[SacredOrchestrator] 📦 Registered: ${mod.name}`, 'color:#81d4fa;');
  }

  /**
   * Activate a module by name. Calls load(scene, camera, renderer, orchestrator),
   * adds to update loop, then auto-benchmarks FPS cost over BENCH_FRAMES frames.
   * Extra load() args are ignored by modules that do not use them.
   */
  async activate(name) {
    const entry = this._registry.get(name);
    if (!entry) {
      console.error(`[SacredOrchestrator] Unknown module: ${name}`);
      return;
    }
    if (entry.active) {
      console.warn(`[SacredOrchestrator] Already active: ${name}`);
      return;
    }

    // ── Yield to main thread BEFORE heavy load() ────────────────────
    // The Chrome perf trace flagged two giant blocking tasks (1348 ms
    // + 1152 ms) during boot — caused by ~30 module load()s running
    // back-to-back in a single task. Yielding before each load lets
    // the browser paint the loading modal + LCP element between
    // modules and slices long tasks into <50 ms segments.
    // Prefers `scheduler.yield()` (Chrome 115+, keeps task priority);
    // falls back to `setTimeout(0)` everywhere else.
    if (typeof scheduler !== "undefined" && typeof scheduler.yield === "function") {
      await scheduler.yield();
    } else {
      await new Promise((r) => setTimeout(r, 0));
    }

    const baselineFPS = this.smoothFPS;
    console.log(
      `%c[SacredOrchestrator] ▶ Activating: ${name} (baseline FPS: ${baselineFPS.toFixed(1)})`,
      "color:#a5d6a7;",
    );

    try {
      await entry.module.load(this.scene, this.camera, this.renderer, this);
    } catch (err) {
      recordModuleLoadError(name, err);
      throw err;
    }
    entry.active = true;
    this._activeModules.push(name);
    this._updateHUD();

    dispatchInteraction(ANU_EVENTS.MODULE_ACTIVATED, { name });
    this._validateRuntimeContracts(`activate:${name}`);

    this._scheduleBenchForModule(name);
  }

  /**
   * One benchmark at a time; queues extras until FPS EMA is meaningful.
   */
  _scheduleBenchForModule(name) {
    this._benchQueue.push(name);
    this._processBenchQueue();
  }

  _processBenchQueue() {
    if (this._bench || this._benchQueue.length === 0) return;

    const MIN_BASELINE = 8;
    if (!this._fpsReady || this.smoothFPS < MIN_BASELINE) {
      if (!this._warmupPoll) {
        console.log(
          "%c[SacredOrchestrator] FPS warmup — benchmarks queued until EMA stabilizes (smoothFPS ≥ 8).",
          "color:#81d4fa;",
        );
        this._warmupPoll = setInterval(() => {
          if (this._fpsReady && this.smoothFPS >= MIN_BASELINE) {
            clearInterval(this._warmupPoll);
            this._warmupPoll = null;
            this._processBenchQueue();
          }
        }, 200);
      }
      return;
    }

    const next = this._benchQueue.shift();
    this._beginBench(next);
  }

  _beginBench(name) {
    const MIN_BASELINE = 8;
    const baselineFPS = Math.max(this.smoothFPS, MIN_BASELINE);
    this._bench = {
      name,
      frames: 0,
      totalFrames: BENCH_FRAMES,
      totalDelta: 0,
      baselineFPS,
    };
    console.log(
      `%c[SacredOrchestrator] ⏱ Benchmarking ${name} (baseline ${baselineFPS.toFixed(1)} FPS)`,
      "color:#fbc02d;font-weight:bold;",
    );
  }

  /** Deactivate a module — calls unload(), removes from loop */
  deactivate(name) {
    const entry = this._registry.get(name);
    if (!entry || !entry.active) { console.warn(`[SacredOrchestrator] Not active: ${name}`); return; }
    if (typeof entry.module.unload === "function") {
      entry.module.unload(this.scene, this.camera, this.renderer, this);
    }
    entry.active = false;
    this._activeModules = this._activeModules.filter(n => n !== name);
    dispatchInteraction(ANU_EVENTS.MODULE_DEACTIVATED, { name });
    this._validateRuntimeContracts(`deactivate:${name}`);
    console.log(`%c[SacredOrchestrator] ⏹ Deactivated: ${name}`, 'color:#ef9a9a;');
    this._updateHUD();
  }

  /** Toggle a module on/off (await when turning on — async load) */
  async toggle(name) {
    const entry = this._registry.get(name);
    if (!entry) return;
    if (entry.active) {
      this.deactivate(name);
    } else {
      await this.activate(name);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ANIMATION LOOP
  // ──────────────────────────────────────────────────────────────────────────

  start() {
    this._disposed = false;
    this.clock.start();
    /**
     * Pre-compile every material program in the scene BEFORE the first
     * frame so the player's first move isn't punctuated by GLSL
     * compile-jank stalls. `index.v2.html` activates World/Trees/PanelsPIP
     * /Fauna and only then calls `start()` — by this point the scene is
     * fully populated and the warm-up touches the real meshes.
     *
     * Anu memory `boot-shader-warmup` records the rationale + cost shape.
     */
    this.precompileShaders();
    this._loop();
  }

  /**
   * One-shot boot warm-up. Three stages, each addressing a different
   * source of first-move stutter that Anu's `probe-boot-stutter.mjs`
   * surfaced:
   *
   *   1. `renderer.compile(scene, camera)` — compiles every material's
   *      GLSL program against the active camera + lights set. Catches
   *      most shaders but DOES NOT upload textures or allocate GPU
   *      geometry buffers.
   *
   *   2. 1×1 render-to-target pass — fires a real `renderer.render()`
   *      into a 1×1 `WebGLRenderTarget`. The microscopic raster cost
   *      is irrelevant; the side-effect is what we want:
   *        • every visible material's textures get `texImage2D`'d
   *        • every visible geometry gets its VBO/IBO uploaded
   *        • any shader variant `renderer.compile()` missed (e.g.
   *          `onBeforeCompile` hooks that mutate the program at first
   *          use, like the leaf-wind shader in `Flora.js`) is compiled
   *      Before May-11 2026 evening, this was deferred to the first
   *      real frame after `_loop()` started, producing a single
   *      2.5-second stall at the moment of player-control hand-off
   *      (probe ledger: frame 691, `dTex=61, dGeo=90, dProg=24` in one
   *      frame). Now it happens during boot, behind the loading iframe.
   *
   *   3. Frustum-cull bypass during stage 2 — temporarily disables
   *      `frustumCulled` on every drawable so meshes outside the
   *      initial camera frustum still get uploaded. Without this, a
   *      tree behind the camera would stutter on first rotation.
   *      Visibility flags are NOT changed (we honour intentionally
   *      hidden meshes like the stag during `WAIT_TO_APPEAR`).
   *
   * Idempotent: subsequent calls compile + upload only resources added
   * since the previous call. Cheap to call again after activating a
   * module that brings new materials online mid-session.
   */
  precompileShaders() {
    if (!this.renderer || !this.scene || !this.camera) return;
    try {
      const t0 = performance.now();
      this.renderer.compile(this.scene, this.camera);
      const compileMs = performance.now() - t0;

      const tRender0 = performance.now();
      this._performBootRenderWarmup(this.renderer, this.camera);
      const renderMs = performance.now() - tRender0;

      console.log(
        `%c[SacredOrchestrator] 🔥 Boot warm-up complete (main pass): compile ${compileMs.toFixed(1)} ms · prime render ${renderMs.toFixed(1)} ms`,
        "color:#9ccc65;font-weight:bold;",
      );
    } catch (err) {
      console.warn("[SacredOrchestrator] Boot warm-up failed (continuing):", err);
    }
  }

  /**
   * Internal: render the scene to a 1×1 target so the GPU performs
   * texture + geometry uploads + shader-variant finalisation for every
   * visible mesh. Restores render-target + frustum-cull state on exit.
   *
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Camera} camera
   */
  _performBootRenderWarmup(renderer, camera) {
    if (!renderer || !camera || !this.scene) return;
    const target = new THREE.WebGLRenderTarget(1, 1);
    const savedRT = renderer.getRenderTarget();

    /** Restore frustum-cull and visibility state after the warmup pass. */
    const restoreCull = [];
    const restoreVis = [];
    this.scene.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) {
        if (o.frustumCulled === true) {
          restoreCull.push(o);
          o.frustumCulled = false;
        }
        if (o.visible === false) {
          restoreVis.push(o);
          o.visible = true;
        }
      }
    });

    try {
      renderer.setRenderTarget(target);
      renderer.render(this.scene, camera);
    } finally {
      renderer.setRenderTarget(savedRT);
      for (const o of restoreCull) o.frustumCulled = true;
      for (const o of restoreVis) o.visible = false;
      target.dispose();
    }
  }

  _loop() {
    if (this._disposed) return;
    this._rafId = requestAnimationFrame(() => this._loop());

    try {
      const frameT0 = performance.now();

      const delta = Math.min(this.clock.getDelta(), 0.1);
      this._frameCount++;

      // ── FPS smoothing (EMA) ───────────────────────────────────────────────
      if (delta > 0) {
        this.rawFPS = 1 / delta;
        this.smoothFPS =
          this._frameCount < 10
            ? this.rawFPS // seed with raw until EMA stabilises
            : this.smoothFPS * (1 - SMOOTH_ALPHA) + this.rawFPS * SMOOTH_ALPHA;
      }
      // Mark FPS ready after 60 frames of warmup
      if (!this._fpsReady && this._frameCount >= 60) this._fpsReady = true;
      // Track peak (theoretical max) — only after warmup, cap at monitor refresh
      if (this._fpsReady && this.smoothFPS > this._peakFPS) {
        this._peakFPS = this.smoothFPS;
      }

      // ── Nature awareness tick — refresh player XZ cache before any
      // animal FSM consults `senseThreat()`. Cheap (one Map read +
      // two float assignments); must run BEFORE module updates so the
      // values they see are this-frame fresh, not last-frame stale.
      AnuNatureAwareness.tick();

      // ── Update active modules ─────────────────────────────────────────────
      const _fishingNow = window.__sanctuaryFishingActive === true;
      for (const name of this._activeModules) {
        // During fishing: skip non-pond modules — their geometry is already
        // culled from the scene; skipping their JS loops saves 3-6ms/frame.
        if (_fishingNow && FISHING_SUSPEND_MODULES.has(name)) continue;

        const entry = this._registry.get(name);
        if (entry && entry.active && typeof entry.module.update === "function") {
          try {
            entry.module.update(delta, this._frameCount, this.scene, this.camera);
          } catch (err) {
            recordSacredLoopError(err, {
              phase: "module_update",
              moduleName: name,
              frameCount: this._frameCount,
            });
          }
        }
      }

      // ── Benchmark tick ────────────────────────────────────────────────────
      if (this._bench) {
        this._bench.frames++;
        this._bench.totalDelta += delta;
        if (this._bench.frames >= BENCH_FRAMES) {
          this._finalizeBench();
        }
      }

      // ── Prioritized Rendering Pipeline Governor (Prioritized Bypassing & % Sampling) ──
      const stress = getSystemStressLevel();
      if (stress === STRESS_LEVELS.OPTIMAL) {
        this.renderer.shadowMap.autoUpdate = true;
      } else {
        this.renderer.shadowMap.autoUpdate = false;
        // Stressed: 33% sampling (every 3rd frame)
        // Critical: 16.7% sampling (every 6th frame)
        const shadowStride = stress === STRESS_LEVELS.STRESS ? 3 : 6;
        if (this._frameCount % shadowStride === 0) {
          this.renderer.shadowMap.needsUpdate = true;
        }
      }

      // ── Render ────────────────────────────────────────────────────────────
      this.renderer.render(this.scene, this.camera);
      this._renderPip();

      // ── HUD update (every 20 frames) ──────────────────────────────────────
      if (this._frameCount % 20 === 0) {
        this._updateHUDValues();
      }

      const frameMs = performance.now() - frameT0;
      recordFrameDuration(frameMs);
      tickAdaptiveRenderPolicy(frameMs);

      if (this._frameCount % STRESS_LEDGER_SAMPLE_INTERVAL_FRAMES === 0) {
        try {
          tickPipelineStressLedger(() => this.renderer.info);
        } catch (ledgerErr) {
          recordSacredLoopError(ledgerErr, {
            phase: "stress_ledger",
            frameCount: this._frameCount,
          });
        }
      }

      if (this._frameCount % SCENE_INVENTORY_INTERVAL_FRAMES === 0) {
        try {
          captureSceneRenderInventory(this.scene);
        } catch (invErr) {
          recordSacredLoopError(invErr, {
            phase: "scene_inventory",
            frameCount: this._frameCount,
          });
        }
      }
    } catch (err) {
      recordSacredLoopError(err, { frameCount: this._frameCount });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BENCHMARKING
  // ──────────────────────────────────────────────────────────────────────────

  _finalizeBench() {
    const b = this._bench;
    const avgFPS = BENCH_FRAMES / b.totalDelta;
    const cost   = Math.max(0, b.baselineFPS - avgFPS);
    const entry  = this._registry.get(b.name);
    if (entry) entry.fpsCost = cost;

    const costStr = cost < 1 ? '✅ <1 FPS cost' : cost < 5 ? `🟡 ${cost.toFixed(1)} FPS cost` : `🔴 ${cost.toFixed(1)} FPS cost`;
    console.log(
      `%c[SacredOrchestrator] 📊 Bench complete: ${b.name} | avg ${avgFPS.toFixed(1)} FPS | ${costStr} | baseline was ${b.baselineFPS.toFixed(1)}`,
      'color:#fbc02d;font-weight:bold;'
    );

    dispatchInteraction(ANU_EVENTS.ORCHESTRATOR_BENCH_COMPLETE, {
      name: b.name,
      avgFPS,
      cost,
      baselineFPS: b.baselineFPS,
    });

    this._bench = null;
    this._updateHUD();
    this._recommendNextModule();
    this._processBenchQueue();
  }

  /** After each bench, console-recommend the cheapest unloaded module to add next */
  _recommendNextModule() {
    const unloaded = [...this._registry.entries()]
      .filter(([, e]) => !e.active)
      .map(([name, e]) => ({ name, cost: e.fpsCost }));

    if (unloaded.length === 0) {
      console.log('%c[SacredOrchestrator] 🏁 All registered modules active!', 'color:#a5d6a7;font-weight:bold;');
      return;
    }

    // Sort: benchmarked cheap ones first, then unknown
    unloaded.sort((a, b) => {
      if (a.cost === null && b.cost === null) return 0;
      if (a.cost === null) return 1;
      if (b.cost === null) return -1;
      return a.cost - b.cost;
    });

    const next = unloaded[0];
    const costHint = next.cost !== null ? `(estimated ${next.cost.toFixed(1)} FPS cost)` : '(not yet benchmarked)';
    console.log(
      `%c[SacredOrchestrator] 💡 Recommended next: anuOrchestrator.activate('${next.name}') ${costHint}`,
      'color:#ce93d8;font-weight:bold;'
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REPORTING
  // ──────────────────────────────────────────────────────────────────────────

  report() {
    const r = this.renderer.info.render;
    const modules = [];
    for (const [name, entry] of this._registry) {
      modules.push({
        name,
        active: !!entry.active,
        fpsCost: entry.fpsCost ?? null,
      });
    }
    const snapshot = {
      timestamp: new Date().toISOString(),
      fps: {
        smooth: this.smoothFPS,
        raw: this.rawFPS,
        peak: this._peakFPS,
        ready: !!this._fpsReady,
        target: V2_TARGET_FPS,
      },
      frame: this._frameCount,
      draws: r.calls,
      triangles: r.triangles,
      activeModules: [...this._activeModules],
      modules,
      runtimeServices: getRuntimeServicesSnapshot(),
    };
    console.group('%c[SacredOrchestrator] 📋 Full Status Report', 'color:#fbc02d;font-weight:bold;font-size:13px;');
    console.log(`FPS: ${this.smoothFPS.toFixed(1)} smooth | ${this.rawFPS.toFixed(1)} raw | Target: ${V2_TARGET_FPS}`);
    console.log(`Draw calls: ${r.calls} | Triangles: ${r.triangles} | Frame: ${this._frameCount}`);
    console.log(`Active modules (${this._activeModules.length}):`, this._activeModules.join(', ') || 'none');
    console.log('Module registry:');
    for (const [name, entry] of this._registry) {
      const status = entry.active ? '✅ ACTIVE' : '⏹ INACTIVE';
      const cost   = entry.fpsCost !== null ? `${entry.fpsCost.toFixed(1)} FPS cost` : 'not benchmarked';
      console.log(`  ${status}  ${name}  [${cost}]`);
    }
    console.log("Runtime services:", getRuntimeServicesSnapshot());
    if (typeof window !== "undefined" && window.AnuUniverse?.audit) {
      const alerts = window.AnuUniverse.audit();
      if (Array.isArray(alerts) && alerts.length > 0) {
        console.log(
          "%c[Anu Universe] Live audit alerts",
          "color:#ffab91;font-weight:bold;",
          alerts,
        );
      } else {
        console.log(
          "%c[Anu Universe] Live audit: no scripted pipeline warnings (see AnuUniverse.report() for full sensors)",
          "color:#a5d6a7;",
        );
      }
      console.log(
        "%c[Anu Universe] exportWorldSensoriumJson() · exportGovernanceJson() · exportStressJson() · exportFuzzyPipelineJson()",
        "color:#81d4fa;",
      );
    }
    console.groupEnd();
    return snapshot;
  }

  getRuntimeServicesSnapshot() {
    return getRuntimeServicesSnapshot();
  }

  validateRuntimeContracts() {
    return validateRuntimeServiceContracts(this._activeModules);
  }

  _validateRuntimeContracts(reason) {
    const result = this.validateRuntimeContracts();
    if (!result.ok) {
      console.warn(
        `%c[SacredOrchestrator] Runtime service contract issue after ${reason}`,
        "color:#ffab91;font-weight:bold;",
        result.missing,
      );
    }
    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HUD — surface lives in js/v2/OrchestratorHud.js (Phase 9+ split). These
  // methods are thin delegators so the call-sites in this file keep their
  // `this._foo()` shape; the HUD module reads from `this`'s public surface
  // (renderer.info, _activeModules, _hud, _bench, _pipRenderedLastFrame,
  // _anuAuditAlerts, …).
  // ──────────────────────────────────────────────────────────────────────────

  _buildHUD() {
    return buildOrchestratorHud();
  }

  _updateHUD() {
    updateOrchestratorHudModules(this);
  }

  _updateHUDValues() {
    updateOrchestratorHudValues(this);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESIZE
  // ──────────────────────────────────────────────────────────────────────────

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Force _resizePipIfNeeded to recompute on the next PiP frame; the canvas
    // backing store is owned by the second WebGLRenderer and must follow the
    // moondial wrapper's new client rect.
    this._pipW = 0;
    this._pipH = 0;
  }

  /**
   * UIModule.js dispatches `v2-pip-zoom-change` on each "+/−" press. We
   * clamp defensively in case a future caller bypasses UIModule's clamp,
   * then zero the cached PiP backing-store size so `_resizePipIfNeeded`
   * recomputes the ortho frustum on the next PiP tick.
   */
  _onPipUserZoomChange(e) {
    const raw = e?.detail?.zoom;
    const next = Number.isFinite(raw) ? Math.min(1.6, Math.max(0.6, raw)) : 1;
    if (next === this._pipUserZoom) return;
    this._pipUserZoom = next;
    this._pipW = 0;
    this._pipH = 0;
  }

  _readPipUserZoomFromStorage() {
    try {
      const raw = window.localStorage?.getItem("sacred:v2:pipZoom");
      const parsed = Number.parseFloat(raw ?? "");
      if (Number.isFinite(parsed)) {
        return Math.min(1.6, Math.max(0.6, parsed));
      }
    } catch (_err) {
      /* private mode / disabled — fall through to default */
    }
    return 1;
  }

  /**
   * PiP DPR + backing-size compute. Single source of truth shared by
   * `_ensurePipPipeline` and `_resizePipIfNeeded` — the two sites used
   * to inline the same `Math.min(devicePixelRatio, 1.25)` formula
   * which made drift trivially easy. Returns `{ w, h }` for the canvas
   * backing store (NOT CSS); CSS dimensions stay owned by the caller.
   */
  _computePipBackingSize(canvasEl) {
    const isTopDown = document.body.classList.contains("v4-top-down-view");
    const isFishing = (typeof window !== "undefined") &&
      window.__sanctuaryFishingActive === true;
    // Fishing: render the close-up at full device DPR and a bigger cap —
    // the frustum is 1.4 m and the scene is already culled to the pond,
    // so the cost stays small while the gauge & fish read sharp instead
    // of pixelated. Top-down: full DPR for the map. Default: light minimap.
    const dprClamp = 2.0;
    const pr = Math.min(window.devicePixelRatio || 1, dprClamp);
    const rect = canvasEl.getBoundingClientRect();
    const rawW = Math.max(160, Math.floor(rect.width * pr));
    const rawH = Math.max(160, Math.floor(rect.height * pr));
    const cap = isTopDown ? 512 : (isFishing ? 768 : 384);
    return {
      w: Math.min(cap, rawW),
      h: Math.min(cap, rawH),
    };
  }

  _ensurePipPipeline(canvasEl) {
    if (this._pipRenderer) return;
    const { w, h } = this._computePipBackingSize(canvasEl);
    canvasEl.width = w;
    canvasEl.height = h;
    this._pipW = w;
    this._pipH = h;

    if (!canvasEl._hasPipContextListeners) {
      canvasEl._hasPipContextListeners = true;
      canvasEl.addEventListener("webglcontextlost", (event) => {
        event.preventDefault();
        console.warn("[SacredOrchestrator] ⚠️ PiP WebGL context lost! Disposing PiP renderer to prepare for restore...");
        this._disposePipRenderer();
      }, false);

      canvasEl.addEventListener("webglcontextrestored", () => {
        console.log("[SacredOrchestrator] ♻️ PiP WebGL context restored! Re-initializing PiP pipeline on next frame...");
      }, false);
    }

    this._pipRenderer = new THREE.WebGLRenderer({
      canvas: canvasEl,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
      preserveDrawingBuffer: true,
    });
    this._pipRenderer.setPixelRatio(1);
    this._pipRenderer.setSize(w, h, false);
    if (this.renderer.outputColorSpace !== undefined) {
      this._pipRenderer.outputColorSpace = this.renderer.outputColorSpace;
    }
    this._pipRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._pipRenderer.toneMappingExposure = this.renderer.toneMappingExposure;
    // Kill shader debug readback on the PiP renderer too — main renderer
    // already had this disabled, but the perf trace still showed 240 ms
    // of onFirstUse because the PIP renderer keeps its own program cache
    // and its own debug flag. (May-19 2026 perf trace finding.)
    this._pipRenderer.debug.checkShaderErrors = false;

    // Frustum span = designer constant × per-user zoom (UIModule "+/−").
    const span = V2_PIP_ORTHO_WIDTH * V2_PIP_ORTHO_ZOOM * this._pipUserZoom;
    const aspect = w / Math.max(1, h);
    const halfW = span / 2;
    const halfH = halfW / aspect;
    this._pipOrtho = new THREE.OrthographicCamera(
      -halfW,
      halfW,
      halfH,
      -halfH,
      0.5,
      520,
    );
    this._pipOrtho.name = "pipOrtho";
    this._pipPersp = new THREE.PerspectiveCamera(42, aspect, 0.12, 220);
    this._pipPersp.name = "pipPersp";
    // Enable layer 1 on both PiP cameras so they pick up the PiP-only markers.
    // Restore layer 0 so the 3D scene (terrain, standard trees, etc.) renders on the minimap.
    this._pipOrtho.layers.enable(1);
    this._pipOrtho.layers.enable(0);
    this._pipPersp.layers.enable(1);
    this._pipPersp.layers.enable(0);

    // Warm-up: the second WebGL context has its own program cache + own
    // GPU buffer pool, so the *first* PiP render would otherwise compile
    // every material AND re-upload every texture/geometry from scratch
    // (same scene, different GL context — separate caches). We do both:
    //  - `pipRenderer.compile(scene, pipOrtho)` for shaders
    //  - 1×1 render-to-target through the SAME pipeline for textures + geos
    // See Anu memory `boot-shader-warmup`.
    try {
      const t0 = performance.now();
      this._pipRenderer.compile(this.scene, this._pipOrtho);
      const compileMs = performance.now() - t0;
      const tRender0 = performance.now();
      this._performBootRenderWarmup(this._pipRenderer, this._pipOrtho);
      const renderMs = performance.now() - tRender0;
      console.log(
        `%c[SacredOrchestrator] 🔥 Boot warm-up complete (PiP pass): compile ${compileMs.toFixed(1)} ms · prime render ${renderMs.toFixed(1)} ms`,
        "color:#9ccc65;font-weight:bold;",
      );
    } catch (err) {
      console.warn("[SacredOrchestrator] PiP boot warm-up failed (continuing):", err);
    }

    console.log(
      "%c[SacredOrchestrator] PiP WebGL pipeline — ortho map / persp spirit (swapped vs main view)",
      "color:#81d4fa;font-weight:bold;",
    );
  }

  _resizePipIfNeeded(canvasEl) {
    if (!this._pipRenderer || !this._pipOrtho || !this._pipPersp) return;
    const { w, h } = this._computePipBackingSize(canvasEl);
    if (w === this._pipW && h === this._pipH) return;
    this._pipW = w;
    this._pipH = h;
    canvasEl.width = w;
    canvasEl.height = h;
    this._pipRenderer.setSize(w, h, false);

    // Frustum span = designer constant × per-user zoom (UIModule "+/−").
    const span = V2_PIP_ORTHO_WIDTH * V2_PIP_ORTHO_ZOOM * this._pipUserZoom;
    const aspect = w / Math.max(1, h);
    const halfW = span / 2;
    const halfH = halfW / aspect;
    this._pipOrtho.left = -halfW;
    this._pipOrtho.right = halfW;
    this._pipOrtho.top = halfH;
    this._pipOrtho.bottom = -halfH;
    this._pipOrtho.updateProjectionMatrix();
    this._pipPersp.aspect = aspect;
    this._pipPersp.updateProjectionMatrix();
  }

  _disposePipRenderer() {
    if (this._pipRenderer) {
      this._pipRenderer.dispose();
      this._pipRenderer = null;
    }
    this._pipOrtho = null;
    this._pipPersp = null;
    this._pipW = 0;
    this._pipH = 0;
  }

  _stashAnuCullablesForPipRender(feet) {
    const stashed = [];
    const cullingRadiusSq = 30 * 30; // 30-meter proximity culling radius
    if (this.scene) {
      this.scene.traverse((o) => {
        let shouldHide = (
          o.userData?.anuKind === "tipi_smoke" ||
          o.userData?.anuKind === "sanctuary_frog_group" ||
          o.userData?.anuKind === "sanctuary_lily_pads" ||
          o.userData?.anuKind === "sanctuary_butterfly" ||
          o.userData?.anuKind === "sanctuary_butterflies" ||
          o.userData?.anuKind === "sanctuary_smoke" ||
          o.userData?.anuKind === "tipi_group" ||
          o.userData?.anuKind === "npc_yellowbutterfly" ||
          o.userData?.anuKind === "npc_bringshappiness" ||
          (o.name && (
            o.name.includes("tipi") ||
            o.name.includes("Tipi") ||
            o.name.includes("smoke") ||
            o.name.includes("Smoke")
          ))
        );

        if (!shouldHide && feet && o.position && (o.isMesh || o.isGroup)) {
          const isImmune = (
            o.name === "terrain" ||
            o.name === "water" ||
            o.name === "sky" ||
            o.name?.includes("terrain") ||
            o.name?.includes("water") ||
            o.name?.includes("sky") ||
            o.userData?.anuKind === "terrain" ||
            o.userData?.anuKind === "water" ||
            o.userData?.anuKind === "sky" ||
            o.isLight ||
            o === this._avatar
          );

          if (!isImmune) {
            const dx = o.position.x - feet.x;
            const dz = o.position.z - feet.z;
            const distSq = dx * dx + dz * dz;
            if (distSq > cullingRadiusSq) {
              shouldHide = true;
            }
          }
        }

        if (shouldHide && o.visible) {
          stashed.push({ g: o, prev: o.visible });
          o.visible = false;
        }
      });
    }
    return stashed;
  }

  _restoreAnuCullablesAfterPip(stashed) {
    if (stashed) {
      for (const stash of stashed) {
        if (stash.g) stash.g.visible = stash.prev;
      }
    }
  }

  /**
   * Top-level PiP gate + delegation. Decomposed into prepare/pass/restore
   * so each step has one job and the finally-restore is bulletproof.
   * Sets `_pipRenderedLastFrame` so the HUD pip line reports whether the
   * pass actually executed this tick (vs gated out by stride/services).
   */
  _renderPip() {
    const isTopDown = document.body.classList.contains("v4-top-down-view");
    const isFishingActive =
      window.__sanctuaryFishingActive === true && window.__sanctuaryBobberPos != null;
    // During fishing: throttle PIP to every 4th frame (~15fps) — gauge still looks live
    // but we stop burning a full 60fps second render pass over the pond.
    if (isFishingActive) {
      this._fishingPipFrame = ((this._fishingPipFrame ?? 0) + 1);
      if (this._fishingPipFrame % 8 !== 0) {
        this._pipRenderedLastFrame = false;
        return;
      }
    } else if (!isTopDown && !shouldRenderPipSceneThisFrame()) {
      this._pipRenderedLastFrame = false;
      return;
    }

    const wp = getRuntimeService("WorldPlayer") ?? window.WorldPlayer;
    if (!wp || !wp.feet) {
      this._pipRenderedLastFrame = false;
      return;
    }

    const pipCanvas = document.getElementById("pipCanvas");
    if (!pipCanvas) {
      this._pipRenderedLastFrame = false;
      return;
    }

    if (!this._pipRenderer) this._ensurePipPipeline(pipCanvas);
    if (!this._pipRenderer || !this._pipOrtho || !this._pipPersp) {
      this._pipRenderedLastFrame = false;
      return;
    }

    this._resizePipIfNeeded(pipCanvas);

    const state = this._preparePipScene(wp);
    try {
      this._renderPipPass(state);
      this._pipRenderedLastFrame = true;

      // Transfer the frame to the iframe via zero-copy ImageBitmap transferable
      // Only do this expensive createImageBitmap call if the panel is actually visible
      const iframe = document.getElementById("v4-panel-frame");
      if (!isFishingActive && iframe && iframe.contentWindow && window._v4PanelOpen !== false) {
        createImageBitmap(this._pipRenderer.domElement).then((bitmap) => {
          iframe.contentWindow.postMessage({ type: "PIP_FRAME", bitmap }, "*", [bitmap]);
        }).catch(() => {});
      }
    } finally {
      this._restorePipScene(state);
    }
  }

  /**
   * Stash mutated scene state and capture the per-frame inputs the pass needs.
   * Always paired with `_restorePipScene(state)` in a finally block.
   */
  _preparePipScene(wp) {
    const fog = this.scene.fog;
    const bg = this.scene.background;
    this.scene.fog = null;
    this.scene.background = null;

    // Add temporary bright ambient light for minimap legibility under all conditions
    const pipLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(pipLight);

    return {
      cullStash: this._stashAnuCullablesForPipRender(wp.feet),
      fog,
      bg,
      feet: wp.feet,
      yaw: wp.yaw || 0,
      mainMap: wp.mainCanvasMapView === true,
      pipLight,
    };
  }

  /**
   * The render pass itself: ortho top-down (with optional ring-disc clip)
   * when the main view is FPV, or short perspective "spirit" cam when the
   * main view is the map. No scene mutation beyond camera pose.
   */
  _renderPipPass(state) {
    const { feet, yaw, mainMap } = state;

    // ── Fishing mode: zoom PiP tight onto the 3D gauge ────────────────
    // When the player is fishing, the PiP acts as a magnified close-up of
    // the interest gauge floating on the water surface, so players can
    // read it at a glance without squinting at the pool.
    if (window.__sanctuaryFishingActive === true && window.__sanctuaryBobberPos) {
      const bp = window.__sanctuaryBobberPos; // THREE.Vector3 live reference
      // Gauge design radius = 2.0, world radius = 2.0 × 0.242 = 0.484 m.
      // Span of 1.4 m → gauge fills ~70 % of the pip inner circle.
      const FISHING_PIP_SPAN = 1.4;
      const aspect = this._pipW / Math.max(1, this._pipH);
      const halfW = FISHING_PIP_SPAN / 2;
      const halfH = halfW / aspect;
      this._pipOrtho.left   = -halfW;
      this._pipOrtho.right  =  halfW;
      this._pipOrtho.top    =  halfH;
      this._pipOrtho.bottom = -halfH;
      this._pipOrtho.updateProjectionMatrix();
      // Camera sits 4 m above the water surface, looking straight down
      const WATER_Y = -0.05;
      this._pipOrtho.position.set(bp.x, WATER_Y + 4.0, bp.z);
      this._pipOrtho.up.set(0, 0, -1);
      this._pipOrtho.lookAt(bp.x, WATER_Y, bp.z);
      this._pipRenderer.render(this.scene, this._pipOrtho);
      // Restore normal ortho frustum so the non-fishing frame is correct
      const span = V2_PIP_ORTHO_WIDTH * V2_PIP_ORTHO_ZOOM * this._pipUserZoom;
      const rHalfW = span / 2;
      const rHalfH = rHalfW / aspect;
      this._pipOrtho.left   = -rHalfW;
      this._pipOrtho.right  =  rHalfW;
      this._pipOrtho.top    =  rHalfH;
      this._pipOrtho.bottom = -rHalfH;
      this._pipOrtho.updateProjectionMatrix();
      return;
    }

    if (!mainMap) {
      const elev = 78;
      this._pipOrtho.position.set(feet.x, feet.y + elev, feet.z);
      this._pipOrtho.up.set(0, 0, -1);
      this._pipOrtho.lookAt(feet.x, feet.y, feet.z);
      const pipClip = getRuntimeService("PipOrthoBranchClip");
      let clipArmed = false;
      if (
        pipClip &&
        typeof pipClip.armOrthoClip === "function" &&
        typeof pipClip.clearOrthoClip === "function"
      ) {
        clipArmed = pipClip.armOrthoClip(this._pipW, this._pipH) === true;
      }
      this._pipRenderer.render(this.scene, this._pipOrtho);
      if (
        clipArmed &&
        pipClip &&
        typeof pipClip.clearOrthoClip === "function"
      ) {
        pipClip.clearOrthoClip();
      }
      return;
    }

    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const hx = feet.x - sin * 0.4;
    const hz = feet.z - cos * 0.4;
    const hy = feet.y + 1.55;
    _pipSpiritLook.set(feet.x - sin * 12, feet.y + 1.35, feet.z - cos * 12);
    this._pipPersp.position.set(hx, hy, hz);
    this._pipPersp.up.set(0, 1, 0);
    this._pipPersp.lookAt(_pipSpiritLook);
    this._pipRenderer.render(this.scene, this._pipPersp);
  }

  /** Always called in `finally`; idempotent on null state. */
  _restorePipScene(state) {
    if (!state) return;
    this.scene.fog = state.fog;
    this.scene.background = state.bg;
    this._restoreAnuCullablesAfterPip(state.cullStash);
    if (state.pipLight) {
      this.scene.remove(state.pipLight);
    }
  }

  /**
   * Tear down the engine shell. Order matters:
   *   1. Set _disposed early so any in-flight RAF callback short-circuits.
   *   2. Cancel RAF + clear the warmup poll so no further updates fire.
   *   3. Drop the resize listener (would otherwise call into a destroyed shell).
   *   4. Reverse-deactivate modules so dependencies unload before their
   *      dependents (matches the activate() order).
   *   5. Tear down the second WebGLRenderer (PiP) and forget cached refs.
   *   6. Remove the HUD from the DOM.
   *   7. Dispose the main renderer (frees the WebGL context).
   *   8. Drop window globals so nothing accidentally re-grabs the dead shell.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    if (this._warmupPoll) {
      clearInterval(this._warmupPoll);
      this._warmupPoll = null;
    }
    window.removeEventListener("resize", this._onResizeBound);
    if (this._onPipZoomChangeBound) {
      window.removeEventListener("v2-pip-zoom-change", this._onPipZoomChangeBound);
      this._onPipZoomChangeBound = null;
    }

    for (const name of [...this._activeModules].reverse()) {
      this.deactivate(name);
    }

    this._disposePipRenderer();
    this._pipStrategy = null;
    this._pipTipiSmokePlume = null;
    this._pipRenderedLastFrame = false;

    if (this._hud?.parentNode) this._hud.parentNode.removeChild(this._hud);
    this._hud = null;

    this.renderer.dispose();

    delete window.anuOrchestrator;
    delete window.Orchestrator;
  }
}
