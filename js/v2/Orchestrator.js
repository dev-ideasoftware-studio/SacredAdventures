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

const _pipSpiritLook = new THREE.Vector3();

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const BENCH_FRAMES   = 180;   // frames to average for a benchmark
const SMOOTH_ALPHA   = 0.05;  // EMA smoothing for live FPS

// ─────────────────────────────────────────────────────────────────────────────
// SACRED ORCHESTRATOR (engine shell — Anu runtime host)
// ─────────────────────────────────────────────────────────────────────────────
export class SacredOrchestrator {
  constructor(canvas) {
    // ── Renderer ──────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: "high-performance",
    });
    // Cap at 1.0 so high-DPI screens don't 4x the pixel fill and cap below 120
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

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
    if (this._bench) {
      this._benchQueue.push(name);
      return;
    }

    const MIN_BASELINE = 8;
    if (!this._fpsReady || this.smoothFPS < MIN_BASELINE) {
      this._benchQueue.push(name);
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

    this._beginBench(name);
  }

  _processBenchQueue() {
    if (this._bench || this._benchQueue.length === 0) return;
    const next = this._benchQueue.shift();
    this._beginBench(next);
  }

  _beginBench(name) {
    const MIN_BASELINE = 8;
    const baselineFPS = Math.max(this.smoothFPS, MIN_BASELINE);
    this._bench = {
      name,
      frames: 0,
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
    this._loop();
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

      // ── Update active modules ─────────────────────────────────────────────
      for (const name of this._activeModules) {
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
  // HUD
  // ──────────────────────────────────────────────────────────────────────────

  _buildHUD() {
    // Inject Google Font for the HUD
    if (!document.getElementById('v2-font')) {
      const lnk = document.createElement('link');
      lnk.id = 'v2-font';
      lnk.rel = 'stylesheet';
      lnk.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap';
      document.head.appendChild(lnk);
    }

    const hud = document.createElement('div');
    hud.id = 'v2-orchestrator-hud';
    hud.style.cssText = `
      position: fixed;
      top: 85px;
      right: 20px;
      z-index: 9999;
      background: linear-gradient(160deg, #1c1208 0%, #2a1c08 100%);
      border: 2px solid rgba(251,192,45,0.35);
      border-radius: 14px;
      padding: 14px 18px 12px;
      font-family: 'Fredoka', 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #fbc02d;
      width: 240px;
      box-sizing: border-box;
      pointer-events: none;
      box-shadow: 0 4px 24px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,100,0.08);
      user-select: none;
      overflow: hidden;
    `;
    hud.innerHTML = this._hudHTML();
    document.body.appendChild(hud);
    return hud;
  }

  _hudHTML() {
    return `
      <div style="font-size:10px;letter-spacing:2px;color:rgba(251,192,45,0.5);margin-bottom:10px;font-weight:600;">SACRED ADV v2 · ORCHESTRATOR</div>
      <div id="v2-fps" style="font-size:30px;font-weight:700;color:#a5d6a7;line-height:1;margin-bottom:4px;">-- FPS</div>
      <div style="position:relative;width:200px;height:30px;margin-bottom:8px;">
        <canvas id="v2-frame-graph" width="200" height="30" style="display:block;width:200px;height:30px;border-radius:5px;background:linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.32) 100%);box-shadow:inset 0 0 0 1px rgba(251,192,45,0.22), inset 0 1px 2px rgba(0,0,0,0.55);"></canvas>
        <div id="v2-load" style="position:absolute;left:6px;top:2px;font-size:9px;letter-spacing:1px;color:rgba(255,255,255,0.85);font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.9);pointer-events:none;">LOAD --%</div>
        <div id="v2-load-detail" style="position:absolute;right:6px;top:2px;font-size:8px;letter-spacing:0.4px;color:rgba(255,255,255,0.6);text-shadow:0 1px 2px rgba(0,0,0,0.85);pointer-events:none;">--/--ms</div>
      </div>
      <div id="v2-draws" style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:6px;">warming up…</div>
      <div id="v2-pip" style="font-size:10px;color:rgba(129,212,250,0.75);margin-bottom:10px;letter-spacing:0.4px;">PiP …</div>
      <div style="height:1px;background:rgba(251,192,45,0.15);margin-bottom:10px;"></div>
      <div style="font-size:10px;letter-spacing:1.5px;color:rgba(251,192,45,0.45);margin-bottom:6px;font-weight:600;">ACTIVE MODULES</div>
      <div id="v2-modules" style="font-size:12px;color:#81d4fa;line-height:1.9;">none</div>
      <div id="v2-bench" style="font-size:11px;color:#ce93d8;margin-top:10px;min-height:16px;"></div>
    `;
  }

  _updateHUD() {
    if (!this._hud) return;
    const modEl = this._hud.querySelector('#v2-modules');
    if (!modEl) return;
    if (this._activeModules.length === 0) {
      modEl.textContent = 'none';
      return;
    }
    modEl.innerHTML = this._activeModules.map(name => {
      const entry = this._registry.get(name);
      const cost  = entry && entry.fpsCost !== null ? ` <span style="color:#ef9a9a;">[${entry.fpsCost.toFixed(1)}fps]</span>` : '';
      return `▶ ${name}${cost}`;
    }).join('<br>');
  }

  _updateHUDValues() {
    if (!this._hud) return;
    const fpsEl   = this._hud.querySelector('#v2-fps');
    const drawEl  = this._hud.querySelector('#v2-draws');
    const benchEl = this._hud.querySelector('#v2-bench');
    if (!fpsEl) return;

    const fps = this._fpsReady ? this.smoothFPS : this.rawFPS;
    const peak = this._peakFPS;
    const col = fps >= 55 ? "#a5d6a7" : fps >= 30 ? "#fbc02d" : "#ef5350";
    fpsEl.style.color = col;
    if (fps > 0) {
      const peakStr =
        peak > 0
          ? ` <span style="font-size:14px;color:rgba(255,255,255,0.3);font-weight:400;">(max ${Math.round(peak)})</span>`
          : "";
      fpsEl.innerHTML = `${Math.round(fps)} FPS${peakStr}`;
    } else {
      fpsEl.textContent = "Starting…";
    }

    const r = this.renderer.info.render;
    if (drawEl) {
      const pipLabel =
        V2_PIP_RENDER_EVERY_N_FRAMES > 0 ? "WebGL swap" : "off";
      drawEl.textContent = `draws: ${r.calls} | tris: ${(r.triangles / 1000).toFixed(1)}k · main · ${window._detectedHz || ".."}hz · PiP=${pipLabel}`;
    }

    // PiP status line — surfaces the second-context cost (Phase 4).
    const pipEl = this._hud.querySelector("#v2-pip");
    if (pipEl) {
      if (V2_PIP_RENDER_EVERY_N_FRAMES <= 0) {
        pipEl.textContent = "PiP=off  (V2_PIP_RENDER_EVERY_N_FRAMES = 0)";
      } else {
        const snap = getRenderingSnapshot();
        pipEl.textContent =
          `PiP=on  stride:${snap.pipEffectiveStride}  phase:${snap.pipPhase}  rendered:${this._pipRenderedLastFrame ? "✓" : "·"}`;
      }
    }

    // LOAD% + frame-time sparkline (Phase 4.5). The proxy is wall-clock frame
    // duration vs V2_FRAME_MS_BUDGET; WebGL does not expose true GPU load.
    const loadEl = this._hud.querySelector("#v2-load");
    const loadDetailEl = this._hud.querySelector("#v2-load-detail");
    const graphEl = this._hud.querySelector("#v2-frame-graph");
    if (loadEl || loadDetailEl || graphEl) {
      const fb = getFrameBudgetSnapshot();
      const samples = getFrameSamples();
      const loadPct = Math.round(fb.loadPct);
      const loadCol = loadPct < 75 ? "#a5d6a7" : loadPct < 105 ? "#fbc02d" : "#ef5350";
      if (loadEl) {
        loadEl.textContent = `LOAD ${loadPct}%`;
        loadEl.style.color = loadCol;
      }
      if (loadDetailEl) {
        loadDetailEl.textContent = `${fb.avgMs.toFixed(1)}/${fb.budgetMs.toFixed(1)}ms`;
      }
      if (graphEl) this._drawFrameGraph(graphEl, samples, fb.budgetMs);
    }

    if (benchEl) {
      if (this._bench) {
        const pct = Math.floor((this._bench.frames / BENCH_FRAMES) * 100);
        benchEl.textContent = `⏱ Benchmarking ${this._bench.name}… ${pct}%`;
      } else {
        benchEl.textContent = '';
      }
    }
  }

  /**
   * Frame-time sparkline for the HUD. Bars are coloured per-sample by their
   * own load ratio; a faint horizontal reference line marks the budget (1.0×).
   * Y axis: 0 ms at the bottom, 2× budget at the top (clamped).
   */
  _drawFrameGraph(canvasEl, samples, budgetMs) {
    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    const w = canvasEl.width;
    const h = canvasEl.height;
    ctx.clearRect(0, 0, w, h);
    if (!(budgetMs > 0)) return;

    // Budget reference line at 1.0× budget.
    const span = 2 * budgetMs;
    const yForMs = (ms) => h - Math.min(1, Math.max(0, ms) / span) * h;
    const yBudget = yForMs(budgetMs);
    ctx.strokeStyle = "rgba(251, 192, 45, 0.32)";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yBudget + 0.5);
    ctx.lineTo(w, yBudget + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);

    const N = samples.length;
    if (N === 0) return;
    const barW = w / N;
    for (let i = 0; i < N; i++) {
      const ms = samples[i];
      const ratio = ms / budgetMs;
      const col = ratio < 0.7 ? "#a5d6a7" : ratio < 1.05 ? "#fbc02d" : "#ef5350";
      const y = yForMs(ms);
      ctx.fillStyle = col;
      ctx.fillRect(Math.floor(i * barW), Math.floor(y), Math.max(1, Math.floor(barW) - 1), h - Math.floor(y));
    }
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

  _ensurePipPipeline(canvasEl) {
    if (this._pipRenderer) return;
    const pr = Math.min(window.devicePixelRatio || 1, 1.25);
    const rect = canvasEl.getBoundingClientRect();
    const w = Math.max(160, Math.floor(rect.width * pr));
    const h = Math.max(160, Math.floor(rect.height * pr));
    canvasEl.width = w;
    canvasEl.height = h;
    this._pipW = w;
    this._pipH = h;

    this._pipRenderer = new THREE.WebGLRenderer({
      canvas: canvasEl,
      alpha: true,
      antialias: false,
      powerPreference: "low-power",
    });
    this._pipRenderer.setPixelRatio(1);
    this._pipRenderer.setSize(w, h, false);
    if (this.renderer.outputColorSpace !== undefined) {
      this._pipRenderer.outputColorSpace = this.renderer.outputColorSpace;
    }
    this._pipRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._pipRenderer.toneMappingExposure = this.renderer.toneMappingExposure;

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
    this._pipPersp = new THREE.PerspectiveCamera(42, aspect, 0.12, 220);

    console.log(
      "%c[SacredOrchestrator] PiP WebGL pipeline — ortho map / persp spirit (swapped vs main view)",
      "color:#81d4fa;font-weight:bold;",
    );
  }

  _resizePipIfNeeded(canvasEl) {
    if (!this._pipRenderer || !this._pipOrtho || !this._pipPersp) return;
    const pr = Math.min(window.devicePixelRatio || 1, 1.25);
    const rect = canvasEl.getBoundingClientRect();
    const w = Math.max(160, Math.floor(rect.width * pr));
    const h = Math.max(160, Math.floor(rect.height * pr));
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

  _stashTipiSmokeForPipRender() {
    if (!this._pipTipiSmokePlume && this.scene) {
      this.scene.traverse((o) => {
        if (o.userData?.anuKind === "tipi_smoke")
          this._pipTipiSmokePlume = o;
      });
    }
    const g = this._pipTipiSmokePlume;
    if (!g) return null;
    const prev = g.visible;
    g.visible = false;
    return { g, prev };
  }

  _restoreTipiSmokeAfterPip(stash) {
    if (stash?.g) stash.g.visible = stash.prev;
  }

  /**
   * Top-level PiP gate + delegation. Decomposed into prepare/pass/restore
   * so each step has one job and the finally-restore is bulletproof.
   * Sets `_pipRenderedLastFrame` so the HUD pip line reports whether the
   * pass actually executed this tick (vs gated out by stride/services).
   */
  _renderPip() {
    if (!shouldRenderPipSceneThisFrame()) {
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
    return {
      smokeStash: this._stashTipiSmokeForPipRender(),
      fog,
      bg,
      feet: wp.feet,
      yaw: wp.yaw || 0,
      mainMap: wp.mainCanvasMapView === true,
    };
  }

  /**
   * The render pass itself: ortho top-down (with optional ring-disc clip)
   * when the main view is FPV, or short perspective "spirit" cam when the
   * main view is the map. No scene mutation beyond camera pose.
   */
  _renderPipPass(state) {
    const { feet, yaw, mainMap } = state;
    if (!mainMap) {
      const elev = 78;
      this._pipOrtho.position.set(feet.x, feet.y + elev, feet.z);
      this._pipOrtho.up.set(0, 1, 0);
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
    this._restoreTipiSmokeAfterPip(state.smokeStash);
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
