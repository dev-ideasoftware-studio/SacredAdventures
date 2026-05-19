/**
 * Sacred Adventures v2 — Tier-B icon renderer.
 *
 * Why this file exists
 * ────────────────────
 * The legacy `Component.ThreeIcons.js` ships a `ThreeIconManager` whose
 * `initLoop()` clears a *full-viewport* WebGL canvas every animation frame
 * and then renders each registered icon via a scissored pass. On a 1440p
 * monitor that single overdraw pass dominated the v2 HUD frame cost, and
 * the per-icon scissor stack added another ~5 render calls/frame stacked
 * on top of the main scene **and** the PiP duplicate pass — three full
 * WebGL pipelines per frame. That is why `index.v2.html` had `V2Panel`
 * commented out with the note "heavy second WebGL pass — off for perf".
 *
 * What this module changes
 * ────────────────────────
 * 1. **Throttle**: render at ~15 fps cap (every 4th `requestAnimationFrame`
 *    on a 60 Hz monitor by default). Idle/log/quest/eye animations read fine
 *    at reduced cadence — these are UI accents, not gameplay simulation.
 *    V2Panel passes `frameStride: 4`; override with `frameStride: 3` (~20 Hz)
 *    if you need slightly smoother micro-motions.
 * 2. **Scissored clear**: keep the renderer's canvas at full window (so
 *    we can reuse the legacy scene-builders' container-rect → scissor
 *    math 1:1), but **only** clear each icon's scissor rect, not the
 *    whole window. Fill-rate cost drops from `width × height` per frame
 *    to `Σ icon_rect` per frame (~ 5 × 64 × 64 = ~20 k px on 1440p, vs
 *    ~ 3.7 M px for a full-window clear). That is a ~180× fill-rate
 *    saving even before the rAF throttle.
 * 3. **Visibility cull**: any icon whose container is fully off-screen
 *    (`getBoundingClientRect` outside the viewport) or zero-sized is
 *    skipped entirely — no scissor, no scene update consequence.
 * 4. **Hi-DPR scissor only**: override the legacy 1.25 DPR ceiling with a
 *    guide-only cap (default 2.0) so the tiny 3D circles look crisp without
 *    returning to full-window clear cost. The framebuffer is larger, but the
 *    only pixels cleared/rendered each tick are the visible icon scissor rects.
 * 5. **Hard pause while hidden**: V2Panel can call
 *    `setGuideIconsActive(false)` when the guide strip is hidden. That
 *    cancels this renderer's rAF loop, so no scene updates, rect checks,
 *    clears, or renders happen until the strip is visible again.
 * 6. **Heartbeat preserved**: the cached-scene `update(time, dt)`
 *    callbacks still run once per *rendered* frame so animations stay
 *    in lock-step with what is drawn (no de-syncing between time and
 *    frames the user actually sees).
 *
 * What this module deliberately does **not** change
 * ──────────────────────────────────────────────────
 * - The legacy scene-builders (`buildQuest`, `buildSearch`, `buildLog`,
 *   `buildGather`, `buildFish`) — fully reused via prototype inheritance.
 * - The legacy GLB/OBJ assets (axe, fish), procedural quest star,
 *   spellbook, eye scenes, animation timing — all intact.
 * - Cross-iframe scissor projection (`logbookFrame` fallback) — dropped
 *   because v2 is single-document. The legacy code-path is bypassed.
 *
 * Anu invariant
 * ─────────────
 * Logged in `ANU_PIPELINE_MEMORY` as `v2-hud-icon-tier-b`. If a future
 * change re-enables the full-window clear or removes the rAF stride,
 * Anu's `evaluateLivePipelineRisk` will flag a regression.
 */

/**
 * @typedef {Object} V2IconRendererOptions
 * @property {number} [frameStride=4] Render every Nth rAF (4 ≈ 15fps on 60Hz).
 *   Set to 1 to match legacy 60fps cost (NOT recommended).
 * @property {number} [maxPixelRatio=2] Cap for guide icon render resolution.
 *   This overrides legacy ThreeIcons' 1.25 cap but remains bounded for GPU.
 * @property {boolean} [verboseBoot=false] Log the lite-vs-legacy delta at start.
 */

/**
 * Construct a Tier-B icon renderer. Returns null if the legacy script has
 * not loaded yet (window.ThreeIconManager undefined) — callers should
 * await the dynamic script load before calling this.
 *
 * @param {V2IconRendererOptions} [options]
 * @returns {object|null} An instance whose API mirrors `ThreeIconManager`
 *   (`createIcon(id, type)`, `updateInput(x, y)`). Same scene cache /
 *   flyweight semantics — drop-in replacement.
 */
export function createV2IconRendererLite(options = {}) {
  if (typeof window === "undefined" || typeof window.ThreeIconManager !== "function") {
    return null;
  }
  const Base = window.ThreeIconManager;
  const stride = Math.max(1, Math.floor(options.frameStride ?? 4));
  const maxPixelRatio = Math.max(1, Math.min(2.25, Number(options.maxPixelRatio ?? 2)));
  const verbose = options.verboseBoot === true;

  class V2IconRendererLite extends Base {
    constructor() {
      super();
      this._liteStride = stride;
      this._liteMaxPixelRatio = maxPixelRatio;
      this._liteVisibleOnlyUpdates = true;
      this._liteLoopPaused = false;
      this._liteAnimate = null;
      this._liteFrame = 0;
      this._liteRafId = 0;
      this._applyLitePixelRatio();
      this._liteResize = () => this._applyLitePixelRatio();
      window.addEventListener("resize", this._liteResize);
      if (verbose) {
        const liteHz = Math.round(60 / stride);
        console.log(
          `%c[V2IconRenderer] Tier-B icon renderer online — ~${liteHz} fps cap, DPR≤${maxPixelRatio}, scissored clear, off-screen cull.`,
          "color:#ce93d8;font-weight:bold;",
        );
      }
    }

    _applyLitePixelRatio() {
      const ratio = Math.min(window.devicePixelRatio || 1, this._liteMaxPixelRatio || 2);
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }

    /**
     * Override the legacy 60Hz full-window-clear loop. Polymorphic
     * dispatch from the base constructor's `this.initLoop()` lands here
     * automatically (single-dispatch JS class inheritance), so the
     * legacy fullscreen-clear loop never starts.
     */
    initLoop() {
      const animate = () => {
        this._liteRafId = 0;
        if (this._liteLoopPaused) return;
        this._liteRafId = requestAnimationFrame(animate);
        this._liteFrame++;
        if (this._liteFrame % this._liteStride !== 0) return;
        this._renderLiteFrame();
      };

      this._liteAnimate = animate;
      this._liteRafId = requestAnimationFrame(animate);
    }

    _renderLiteFrame() {
      if (this._liteLoopPaused) return;
      const dt = this.clock.getDelta();
      const time = this.clock.elapsedTime;
      const lerp = Math.min(dt * 6.0, 1);
      this.mouseSmooth.lerp(this.mouseRaw, lerp);

      for (let i = this.scenes.length - 1; i >= 0; i--) {
        const item = this.scenes[i];
        if (!item.container || !item.container.isConnected) {
          this.scenes.splice(i, 1);
        }
      }

      if (this.scenes.length === 0) return;

      const W = window.innerWidth;
      const H = window.innerHeight;

      const visible = [];
      for (const item of this.scenes) {
        const r = item.container.getBoundingClientRect();
        if (
          r.width <= 0 ||
          r.height <= 0 ||
          r.bottom < 0 ||
          r.top > H ||
          r.right < 0 ||
          r.left > W
        ) {
          continue;
        }
        visible.push({ item, rect: r });
      }
      if (visible.length === 0) return;

      const updatedTypes = new Set();
      for (const { item } of visible) {
        if (updatedTypes.has(item.type)) continue;
        updatedTypes.add(item.type);
        const cached = this.cachedScenes[item.type];
        if (cached?.update) cached.update(time, dt);
      }

      const renderer = this.renderer;
      renderer.setScissorTest(true);

      for (const { item, rect } of visible) {
        const width = rect.width;
        const height = rect.height;
        const left = rect.left;
        const bottom = H - rect.bottom;
        const dpr = this.renderer.getPixelRatio?.() || 1;
        const clearPad = Math.ceil(2 * dpr) / dpr;
        const aspect = width / height;

        if (item.camera.isOrthographicCamera) {
          const d = 3.0;
          if (item.camera.right !== d * aspect) {
            item.camera.left = -d * aspect;
            item.camera.right = d * aspect;
            item.camera.top = d;
            item.camera.bottom = -d;
            item.camera.updateProjectionMatrix();
          }
        } else if (item.camera.aspect !== aspect) {
          item.camera.aspect = aspect;
          item.camera.updateProjectionMatrix();
        }

        renderer.setViewport(left, bottom, width, height);
        renderer.setScissor(
          Math.max(0, left - clearPad),
          Math.max(0, bottom - clearPad),
          width + clearPad * 2,
          height + clearPad * 2,
        );
        renderer.clear();
        renderer.setScissor(left, bottom, width, height);
        renderer.render(item.scene, item.camera);
      }

      renderer.setScissorTest(false);
    }

    _clearVisibleIconRects() {
      const renderer = this.renderer;
      if (!renderer || this.scenes.length === 0) return;
      const W = window.innerWidth;
      const H = window.innerHeight;
      renderer.setScissorTest(true);
      for (const item of this.scenes) {
        if (!item.container || !item.container.isConnected) continue;
        const rect = item.container.getBoundingClientRect();
        if (
          rect.width <= 0 ||
          rect.height <= 0 ||
          rect.bottom < 0 ||
          rect.top > H ||
          rect.right < 0 ||
          rect.left > W
        ) {
          continue;
        }
        renderer.setViewport(rect.left, H - rect.bottom, rect.width, rect.height);
        renderer.setScissor(rect.left, H - rect.bottom, rect.width, rect.height);
        renderer.clear();
      }
      renderer.setScissorTest(false);
    }

    pauseLite() {
      this._liteLoopPaused = true;
      if (this._liteRafId) {
        cancelAnimationFrame(this._liteRafId);
        this._liteRafId = 0;
      }
      this._clearVisibleIconRects();
    }

    resumeLite() {
      if (!this._liteLoopPaused && this._liteRafId) return;
      this._liteLoopPaused = false;
      this._applyLitePixelRatio();
      requestAnimationFrame(() => this._renderLiteFrame());
      if (!this._liteRafId && this._liteAnimate) {
        this._liteRafId = requestAnimationFrame(this._liteAnimate);
      }
    }

    setGuideIconsActive(active) {
      if (active) this.resumeLite();
      else this.pauseLite();
    }

    /**
     * Stop the rAF loop and remove the renderer's canvas from the DOM.
     * Idempotent — safe to call from module unload paths even if the
     * legacy script never finished booting.
     */
    disposeLite() {
      if (this._liteRafId) {
        cancelAnimationFrame(this._liteRafId);
        this._liteRafId = 0;
      }
      this._liteLoopPaused = true;
      if (this._liteResize) {
        window.removeEventListener("resize", this._liteResize);
        this._liteResize = null;
      }
      try {
        const dom = this.renderer?.domElement;
        if (dom && dom.parentNode) dom.parentNode.removeChild(dom);
      } catch (_e) {
        /* ignore */
      }
      try {
        this.renderer?.dispose?.();
      } catch (_e) {
        /* ignore */
      }
    }
  }

  return new V2IconRendererLite();
}
