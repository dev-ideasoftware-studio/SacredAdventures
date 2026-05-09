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
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // ── Scene & Camera ────────────────────────────────────────────────────
    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 1.7, 5);

    // ── Clock ─────────────────────────────────────────────────────────────
    this.clock = new THREE.Clock();

    // ── Module registry ───────────────────────────────────────────────────
    // Map<name, { module, active, fpsCost, benchFrames, benchTotal }>
    this._registry = new Map();
    this._activeModules = [];  // ordered list of active module names

    // ── FPS tracking ──────────────────────────────────────────────────────
    this.smoothFPS   = 60;
    this.rawFPS      = 60;
    this._frameCount = 0;

    // ── Benchmarking state ────────────────────────────────────────────────
    this._bench = null; // { name, frames, totalDelta, baselineFPS }

    // ── HUD ───────────────────────────────────────────────────────────────
    this._hud = this._buildHUD();

    // ── Resize ────────────────────────────────────────────────────────────
    window.addEventListener('resize', () => this._onResize());

    // ── Expose globally ───────────────────────────────────────────────────
    window.Orchestrator = this;

    console.log('%c[Orchestrator] 🚀 Sacred Adventures v2 — Engine Online', 'color:#fbc02d;font-weight:bold;font-size:14px;');
    console.log('[Orchestrator] Renderer:', this.renderer.info.render);
    console.log('[Orchestrator] Call Orchestrator.report() for full status at any time.');
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
    if (!entry) { console.error(`[Orchestrator] Unknown module: ${name}`); return; }
    if (entry.active) { console.warn(`[Orchestrator] Already active: ${name}`); return; }

    const baselineFPS = this.smoothFPS;
    console.log(`%c[Orchestrator] ▶ Activating: ${name} (baseline FPS: ${baselineFPS.toFixed(1)})`, 'color:#a5d6a7;');

    await entry.module.load(this.scene, this.camera, this.renderer);
    entry.active = true;
    this._activeModules.push(name);
    this._updateHUD();

    // Start benchmark for this module
    this._bench = { name, frames: 0, totalDelta: 0, baselineFPS };
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
    this.rawFPS   = 1 / delta;
    this.smoothFPS = this.smoothFPS * (1 - SMOOTH_ALPHA) + this.rawFPS * SMOOTH_ALPHA;

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
    const hud = document.createElement('div');
    hud.id = 'v2-orchestrator-hud';
    hud.style.cssText = `
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 9999;
      background: rgba(0,0,0,0.72);
      border: 1px solid rgba(251,192,45,0.4);
      border-radius: 8px;
      padding: 10px 14px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      color: #fbc02d;
      min-width: 220px;
      pointer-events: none;
      backdrop-filter: blur(4px);
      user-select: none;
    `;
    hud.innerHTML = this._hudHTML();
    document.body.appendChild(hud);
    return hud;
  }

  _hudHTML() {
    return `
      <div style="font-size:11px;letter-spacing:1px;color:#aaa;margin-bottom:6px;">SACRED ADV v2 — ORCHESTRATOR</div>
      <div id="v2-fps" style="font-size:22px;font-weight:bold;color:#a5d6a7;">-- FPS</div>
      <div id="v2-draws" style="font-size:10px;color:#aaa;margin-bottom:8px;">draws: -- | tris: --</div>
      <div style="font-size:10px;color:#aaa;border-top:1px solid rgba(255,255,255,0.1);padding-top:6px;margin-bottom:4px;">ACTIVE MODULES</div>
      <div id="v2-modules" style="font-size:11px;color:#81d4fa;line-height:1.7;">none</div>
      <div id="v2-bench" style="font-size:10px;color:#ce93d8;margin-top:6px;"></div>
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

    const fps = this.smoothFPS;
    const col = fps >= 55 ? '#a5d6a7' : fps >= 30 ? '#fbc02d' : '#ef5350';
    fpsEl.style.color   = col;
    fpsEl.textContent   = `${fps.toFixed(1)} FPS`;

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
