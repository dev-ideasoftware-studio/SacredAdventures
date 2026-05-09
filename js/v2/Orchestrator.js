/**
 * Sacred Adventures v2 — Constructor Orchestrator AI
 *
 * Responsibilities:
 *  1. Own the Three.js renderer, scene, camera, and clock
 *  2. Maintain a MODULE REGISTRY — each module is a named object with
 *     { name, load(), unload(), update(delta) }
 *  3. Benchmark FPS cost of every module in isolation
 *  4. Drive the requestAnimationFrame loop and call active module updates
 *  5. Render an on-screen HUD showing live FPS and active module list
 *  6. Expose window.Orchestrator so devtools / Hi Anu can query it
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const BENCH_FRAMES   = 180;   // frames to average for a benchmark
const SMOOTH_ALPHA   = 0.05;  // EMA smoothing for live FPS
const TARGET_FPS     = 60;

// ─────────────────────────────────────────────────────────────────────────────
// ORCHESTRATOR CLASS
// ─────────────────────────────────────────────────────────────────────────────
export class Orchestrator {
  constructor(canvas) {
    // ── Renderer ──────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
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

    // ── Benchmarking state ────────────────────────────────────────────────
    this._bench = null; // { name, frames, totalDelta, baselineFPS }

    // ── HUD ───────────────────────────────────────────────────────────────
    this._hud = this._buildHUD();

    // ── Resize ────────────────────────────────────────────────────────────
    window.addEventListener("resize", () => this._onResize());

    // ── Expose globally ───────────────────────────────────────────────────
    window.Orchestrator = this;

    console.log(
      "%c[Orchestrator] 🚀 Sacred Adventures v2 — Engine Online",
      "color:#fbc02d;font-weight:bold;font-size:14px;",
    );
    console.log("[Orchestrator] Renderer:", this.renderer.info.render);
    console.log(
      "[Orchestrator] Call Orchestrator.report() for full status at any time.",
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
      console.error('[Orchestrator] Invalid module — must have name + load()', mod);
      return;
    }
    this._registry.set(mod.name, {
      module:      mod,
      active:      false,
      fpsCost:     null,   // null = not yet benchmarked
      benchFrames: 0,
      benchTotal:  0,
    });
    console.log(`%c[Orchestrator] 📦 Registered: ${mod.name}`, 'color:#81d4fa;');
  }

  /**
   * Activate a module by name. Calls load(), adds to update loop, then
   * auto-benchmarks FPS cost over BENCH_FRAMES frames.
   */
  async activate(name) {
    const entry = this._registry.get(name);
    if (!entry) {
      console.error(`[Orchestrator] Unknown module: ${name}`);
      return;
    }
    if (entry.active) {
      console.warn(`[Orchestrator] Already active: ${name}`);
      return;
    }

    const baselineFPS = this.smoothFPS;
    console.log(
      `%c[Orchestrator] ▶ Activating: ${name} (baseline FPS: ${baselineFPS.toFixed(1)})`,
      "color:#a5d6a7;",
    );

    await entry.module.load(this.scene, this.camera, this.renderer);
    entry.active = true;
    this._activeModules.push(name);
    this._updateHUD();

    // Start benchmark after EMA warmup
    if (!this._fpsReady) {
      console.log(
        `[Orchestrator] Waiting for FPS warmup before benchmarking ${name}…`,
      );
      const waitBench = setInterval(() => {
        if (this._fpsReady) {
          clearInterval(waitBench);
          this._bench = {
            name,
            frames: 0,
            totalDelta: 0,
            baselineFPS: this.smoothFPS,
          };
          console.log(
            `[Orchestrator] ⏱ Benchmarking ${name} (baseline ${this.smoothFPS.toFixed(1)} FPS)`,
          );
        }
      }, 200);
    } else {
      this._bench = { name, frames: 0, totalDelta: 0, baselineFPS };
    }
  }

  /** Deactivate a module — calls unload(), removes from loop */
  deactivate(name) {
    const entry = this._registry.get(name);
    if (!entry || !entry.active) { console.warn(`[Orchestrator] Not active: ${name}`); return; }
    entry.module.unload(this.scene);
    entry.active = false;
    this._activeModules = this._activeModules.filter(n => n !== name);
    console.log(`%c[Orchestrator] ⏹ Deactivated: ${name}`, 'color:#ef9a9a;');
    this._updateHUD();
  }

  /** Toggle a module on/off */
  toggle(name) {
    const entry = this._registry.get(name);
    if (!entry) return;
    entry.active ? this.deactivate(name) : this.activate(name);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ANIMATION LOOP
  // ──────────────────────────────────────────────────────────────────────────

  start() {
    this.clock.start();
    this._loop();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());

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
      if (entry && entry.active && typeof entry.module.update === 'function') {
        entry.module.update(delta, this._frameCount, this.scene, this.camera);
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

    // ── HUD update (every 20 frames) ──────────────────────────────────────
    if (this._frameCount % 20 === 0) {
      this._updateHUDValues();
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
      `%c[Orchestrator] 📊 Bench complete: ${b.name} | avg ${avgFPS.toFixed(1)} FPS | ${costStr} | baseline was ${b.baselineFPS.toFixed(1)}`,
      'color:#fbc02d;font-weight:bold;'
    );

    this._bench = null;
    this._updateHUD();
    this._recommendNextModule();
  }

  /** After each bench, console-recommend the cheapest unloaded module to add next */
  _recommendNextModule() {
    const unloaded = [...this._registry.entries()]
      .filter(([, e]) => !e.active)
      .map(([name, e]) => ({ name, cost: e.fpsCost }));

    if (unloaded.length === 0) {
      console.log('%c[Orchestrator] 🏁 All registered modules active!', 'color:#a5d6a7;font-weight:bold;');
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
      `%c[Orchestrator] 💡 Recommended next: Orchestrator.activate('${next.name}') ${costHint}`,
      'color:#ce93d8;font-weight:bold;'
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REPORTING
  // ──────────────────────────────────────────────────────────────────────────

  report() {
    const r = this.renderer.info.render;
    console.group('%c[Orchestrator] 📋 Full Status Report', 'color:#fbc02d;font-weight:bold;font-size:13px;');
    console.log(`FPS: ${this.smoothFPS.toFixed(1)} smooth | ${this.rawFPS.toFixed(1)} raw | Target: ${TARGET_FPS}`);
    console.log(`Draw calls: ${r.calls} | Triangles: ${r.triangles} | Frame: ${this._frameCount}`);
    console.log(`Active modules (${this._activeModules.length}):`, this._activeModules.join(', ') || 'none');
    console.log('Module registry:');
    for (const [name, entry] of this._registry) {
      const status = entry.active ? '✅ ACTIVE' : '⏹ INACTIVE';
      const cost   = entry.fpsCost !== null ? `${entry.fpsCost.toFixed(1)} FPS cost` : 'not benchmarked';
      console.log(`  ${status}  ${name}  [${cost}]`);
    }
    console.groupEnd();
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
      top: 14px;
      right: 14px;
      z-index: 9999;
      background: linear-gradient(160deg, #1c1208 0%, #2a1c08 100%);
      border: 2px solid rgba(251,192,45,0.35);
      border-radius: 14px;
      padding: 14px 18px 12px;
      font-family: 'Fredoka', 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #fbc02d;
      min-width: 230px;
      pointer-events: none;
      box-shadow: 0 4px 24px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,100,0.08);
      user-select: none;
    `;
    hud.innerHTML = this._hudHTML();
    document.body.appendChild(hud);
    return hud;
  }

  _hudHTML() {
    return `
      <div style="font-size:10px;letter-spacing:2px;color:rgba(251,192,45,0.5);margin-bottom:10px;font-weight:600;">SACRED ADV v2 · ORCHESTRATOR</div>
      <div id="v2-fps" style="font-size:30px;font-weight:700;color:#a5d6a7;line-height:1;margin-bottom:2px;">-- FPS</div>
      <div id="v2-draws" style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:12px;">warming up…</div>
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
    if (drawEl) drawEl.textContent = `draws: ${r.calls} | tris: ${(r.triangles/1000).toFixed(1)}k | frame: ${this._frameCount}`;

    if (benchEl) {
      if (this._bench) {
        const pct = Math.floor((this._bench.frames / BENCH_FRAMES) * 100);
        benchEl.textContent = `⏱ Benchmarking ${this._bench.name}… ${pct}%`;
      } else {
        benchEl.textContent = '';
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESIZE
  // ──────────────────────────────────────────────────────────────────────────

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
