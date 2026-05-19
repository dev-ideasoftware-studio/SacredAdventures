/**
 * SacredOrchestrator HUD — extracted from Orchestrator.js (Phase 9+ split).
 *
 * Pure rendering / DOM functions. No lifecycle state of its own; every
 * function takes the live orchestrator (`orc`) and reads from its public
 * surface (`renderer.info`, `_activeModules`, `_hud`, `_bench`, …).
 *
 * Why split: Orchestrator.js had grown to 1267 LOC and the HUD HTML +
 * `_updateHUDValues` + `_drawFrameGraph` accounted for ~300 of those —
 * orthogonal to the coordination role the file should have. Pulling them
 * out drops Orchestrator.js to ~960 LOC and gives the HUD its own surface
 * that can be reskinned without touching the render loop.
 *
 * Coupling contract — what `orc` must expose:
 *   - `orc._hud` (HTMLElement or null)
 *   - `orc._activeModules: string[]`
 *   - `orc._registry: Map<string,{ fpsCost: number|null }>`
 *   - `orc._fpsReady: boolean`, `orc.smoothFPS`, `orc.rawFPS`, `orc._peakFPS`
 *   - `orc.renderer.info.render: { calls, triangles }`
 *   - `orc._pipRenderedLastFrame: boolean`
 *   - `orc._anuAuditNextAtMs`, `orc._anuAuditAlerts` (managed by this module)
 *   - `orc._bench: { name, frames, totalFrames } | null`
 */

import { V2_PIP_RENDER_EVERY_N_FRAMES } from "./constants.js";
import { getRenderingSnapshot } from "./anu/RenderingGovernor.js";
import { getFrameBudgetSnapshot, getFrameSamples } from "./anu/FrameBudget.js";
import { getActiveMapId, listMaps, setActiveMapId } from "./MapsConfig.js";

/** HUD HTML — kept as a constant so a future reskin doesn't have to rebuild the function. */
export const ORCHESTRATOR_HUD_HTML = `
      <div style="font-size:10px;letter-spacing:2px;color:rgba(251,192,45,0.5);margin-bottom:10px;font-weight:600;">SACRED ADV v2 · ORCHESTRATOR</div>
      <div id="v2-fps" style="font-size:30px;font-weight:700;color:#a5d6a7;line-height:1;margin-bottom:6px;">-- FPS</div>
      <div style="position:relative;width:204px;height:46px;margin-bottom:8px;border-radius:9px;padding:3px;box-sizing:border-box;background:linear-gradient(160deg, #0a0603 0%, #1a0f06 50%, #060300 100%);box-shadow:inset 2px 2px 5px rgba(0,0,0,0.95), inset -1px -1px 2px rgba(251,192,45,0.10), 0 1px 0 rgba(255,220,100,0.06), 0 -1px 0 rgba(0,0,0,0.6);">
        <canvas id="v2-frame-graph" width="198" height="40" style="display:block;width:198px;height:40px;border-radius:6px;background:transparent;"></canvas>
        <div id="v2-load" style="position:absolute;left:8px;top:5px;font-size:9px;letter-spacing:1.4px;color:rgba(255,248,220,0.92);font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.7);pointer-events:none;">LOAD --%</div>
        <div id="v2-load-detail" style="position:absolute;right:8px;top:5px;font-size:8px;letter-spacing:0.6px;color:rgba(255,248,220,0.62);text-shadow:0 1px 2px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.7);pointer-events:none;">--/--ms</div>
      </div>
      <div id="v2-anu-alert" title="UNIVERSE.ANU live audit — hover for full findings, or run AnuUniverse.audit() in DevTools" style="font-size:9.5px;letter-spacing:0.4px;color:rgba(165,214,167,0.55);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:auto;cursor:help;">UNIVERSE.ANU: warming up…</div>
      <div id="v2-draws" style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:6px;">warming up…</div>
      <div id="v2-pip" style="font-size:10px;color:rgba(129,212,250,0.75);margin-bottom:10px;letter-spacing:0.4px;">PiP …</div>
      <div style="height:1px;background:rgba(251,192,45,0.15);margin-bottom:10px;"></div>
      <div style="font-size:10px;letter-spacing:1.5px;color:rgba(251,192,45,0.45);margin-bottom:6px;font-weight:600;">UNIVERSE</div>
      <div id="v2-modules" style="font-size:12px;color:#81d4fa;line-height:1.9;">none</div>
      <div id="v2-bench" style="font-size:11px;color:#ce93d8;margin-top:10px;min-height:16px;"></div>
      <div style="height:1px;background:rgba(251,192,45,0.15);margin:10px 0;"></div>
      <div style="font-size:10px;letter-spacing:1.5px;color:rgba(251,192,45,0.45);margin-bottom:6px;font-weight:600;">MAP</div>
      <div id="v2-map-picker" style="display:flex;flex-direction:column;gap:5px;"></div>
      <div id="v2-hud-copyright" style="font-size:8px;line-height:1.35;color:rgba(255,255,255,0.28);margin-top:12px;padding-top:10px;border-top:1px solid rgba(251,192,45,0.08);letter-spacing:0.15px;text-align:center;">Idea Software Studio &copy; 2026</div>
    `;

/** Build the HUD root element and inject the HTML. Returns the element. */
export function buildOrchestratorHud() {
  if (!document.getElementById('v2-font')) {
    const lnk = document.createElement('link');
    lnk.id = 'v2-font';
    lnk.rel = 'stylesheet';
    lnk.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap';
    document.head.appendChild(lnk);
  }
  const hud = document.createElement('div');
  hud.id = 'v2-orchestrator-hud';
  /**
   * Default placement: **top-right**. PiP stays top-left in both views.
   * Village map view adjusts this HUD panel in `index.v2.html` and aligns
   * Village Builder beneath it (`syncVillageViewRightStackCssVars`).
   */
  hud.style.cssText = `
      position: fixed;
      top: 12px;
      right: 14px;
      left: auto;
      transform: none;
      z-index: 9999;
      background:
        radial-gradient(120% 80% at 50% 0%, rgba(255, 210, 120, 0.10) 0%, rgba(0,0,0,0) 60%),
        linear-gradient(165deg, #1e1408 0%, #2c1d09 55%, #1a1106 100%);
      border: 1px solid rgba(251,192,45,0.42);
      border-radius: 16px;
      padding: 14px 20px 12px;
      font-family: 'Fredoka', 'Segoe UI', sans-serif;
      font-size: 13px;
      color: #fbc02d;
      width: min(280px, calc(100vw - 32px));
      max-height: min(440px, calc(100vh - 24px));
      overflow-x: hidden;
      overflow-y: auto;
      box-sizing: border-box;
      pointer-events: auto;
      box-shadow:
        0 10px 28px rgba(0,0,0,0.6),
        0 2px 6px rgba(0,0,0,0.5),
        inset 0 1px 0 rgba(255,220,100,0.18),
        inset 0 -1px 0 rgba(0,0,0,0.45),
        0 0 22px rgba(251, 192, 45, 0.08);
      user-select: none;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    `;
  hud.innerHTML = ORCHESTRATOR_HUD_HTML;
  document.body.appendChild(hud);
  _renderMapPicker(hud);
  return hud;
}

/**
 * Populate the `#v2-map-picker` slot with one row per map in the
 * registry. Clicking a row that isn't the active map persists the
 * new id and reloads the page (which is how every module picks up
 * the new terrain / palette / flora targets).
 */
function _renderMapPicker(hud) {
  const wrap = hud.querySelector("#v2-map-picker");
  if (!wrap) return;
  const activeId = getActiveMapId();
  const maps = listMaps();
  wrap.innerHTML = "";
  for (const m of maps) {
    const isActive = m.id === activeId;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = m.blurb;
    btn.dataset.mapId = m.id;
    btn.style.cssText = [
      "all:unset",
      "cursor:pointer",
      "display:flex",
      "flex-direction:column",
      "gap:1px",
      "padding:6px 10px",
      "border-radius:8px",
      "font-family:inherit",
      "font-size:11px",
      `border:1px solid ${isActive ? "rgba(251,192,45,0.65)" : "rgba(251,192,45,0.18)"}`,
      `background:${isActive ? "rgba(251,192,45,0.12)" : "rgba(255,255,255,0.025)"}`,
      `color:${isActive ? "#ffe9a8" : "rgba(255,248,220,0.78)"}`,
      `box-shadow:${isActive ? "inset 0 0 0 1px rgba(255,220,100,0.08), 0 0 10px rgba(251,192,45,0.10)" : "none"}`,
      "text-align:left",
    ].join(";");
    btn.innerHTML = `
      <div style="font-weight:600;letter-spacing:0.3px;">
        ${isActive ? "● " : ""}${m.name}
      </div>
      <div style="font-size:9.5px;line-height:1.25;color:rgba(255,248,220,0.45);">
        ${m.blurb}
      </div>
    `;
    btn.addEventListener("click", () => {
      if (m.id === activeId) return;
      btn.disabled = true;
      btn.style.opacity = "0.5";
      setActiveMapId(m.id); // triggers location.reload()
    });
    wrap.appendChild(btn);
  }
}

/** Refresh the active-modules block. Cheap; called on register/activate/deactivate. */
export function updateOrchestratorHudModules(orc) {
  if (!orc._hud) return;
  const modEl = orc._hud.querySelector('#v2-modules');
  if (!modEl) return;
  if (orc._activeModules.length === 0) {
    modEl.textContent = 'none';
    return;
  }
  modEl.innerHTML = orc._activeModules.map(name => {
    const entry = orc._registry.get(name);
    const cost = entry && entry.fpsCost !== null ? ` <span style="color:#ef9a9a;">[${entry.fpsCost.toFixed(1)}fps]</span>` : '';
    const displayName = name === "Anu" ? "UNIVERSE.ANU" : name;
    return `▶ ${displayName}${cost}`;
  }).join('<br>');
}

/** Per-frame values: FPS, draw counts, PiP status line, LOAD% + frame-graph, Anu alert row, bench progress. */
export function updateOrchestratorHudValues(orc) {
  if (!orc._hud) return;
  const fpsEl = orc._hud.querySelector('#v2-fps');
  const drawEl = orc._hud.querySelector('#v2-draws');
  const benchEl = orc._hud.querySelector('#v2-bench');
  if (!fpsEl) return;

  const fps = orc._fpsReady ? orc.smoothFPS : orc.rawFPS;
  const peak = orc._peakFPS;
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

  const r = orc.renderer.info.render;
  if (drawEl) {
    const pipLabel = V2_PIP_RENDER_EVERY_N_FRAMES > 0 ? "WebGL swap" : "off";
    drawEl.textContent = `draws: ${r.calls} | tris: ${(r.triangles / 1000).toFixed(1)}k · main · ${window._detectedHz || ".."}hz · PiP=${pipLabel}`;
  }

  // PiP status line — surfaces the second-context cost (Phase 4).
  const pipEl = orc._hud.querySelector("#v2-pip");
  if (pipEl) {
    if (V2_PIP_RENDER_EVERY_N_FRAMES <= 0) {
      pipEl.textContent = "PiP=off  (V2_PIP_RENDER_EVERY_N_FRAMES = 0)";
    } else {
      const snap = getRenderingSnapshot();
      pipEl.textContent =
        `PiP=on  stride:${snap.pipEffectiveStride}  phase:${snap.pipPhase}  rendered:${orc._pipRenderedLastFrame ? "✓" : "·"}`;
    }
  }

  // LOAD% + frame-time equalizer (Phase 4.5). Wall-clock frame duration vs
  // V2_FRAME_MS_BUDGET; WebGL does not expose true GPU load.
  const loadEl = orc._hud.querySelector("#v2-load");
  const loadDetailEl = orc._hud.querySelector("#v2-load-detail");
  const graphEl = orc._hud.querySelector("#v2-frame-graph");
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
    if (graphEl) drawHudFrameGraph(graphEl, samples, fb.budgetMs);
  }

  // Anu live alert row — surfaces AnuUniverse.audit() findings directly under
  // the frame-graph well so the user can paste them back to Anu without
  // opening DevTools (Phase 4.6 follow-up). Throttled to ~2 Hz because the
  // audit walks the DOM and snapshots a few subsystems.
  const alertEl = orc._hud.querySelector("#v2-anu-alert");
  if (alertEl) {
    const nowMs = performance.now();
    if (nowMs >= (orc._anuAuditNextAtMs || 0)) {
      orc._anuAuditNextAtMs = nowMs + 500;
      let alerts = [];
      try {
        alerts = window.AnuUniverse?.audit?.() ?? [];
      } catch (_err) {
        // never let the HUD throw on a defensive audit failure
      }
      orc._anuAuditAlerts = Array.isArray(alerts) ? alerts : [];
    }
    const alerts = orc._anuAuditAlerts || [];
    if (alerts.length === 0) {
      alertEl.style.color = "rgba(165, 214, 167, 0.55)";
      alertEl.textContent = "UNIVERSE.ANU: ✓ clear";
      alertEl.title = "UNIVERSE.ANU live audit — no findings. Run AnuUniverse.audit() in DevTools for the same result.";
    } else {
      const first = alerts[0];
      const more = alerts.length > 1 ? `  +${alerts.length - 1}` : "";
      const sev = first.severity === "error" ? "✗" : "⚠";
      alertEl.style.color = first.severity === "error" ? "#ef5350" : "#fbc02d";
      alertEl.textContent = `UNIVERSE.ANU ${sev} ${first.id}${more}`;
      alertEl.title = alerts
        .map((a, i) => `${i + 1}. [${a.severity}] ${a.id}\n   ${a.text}`)
        .join("\n\n");
    }
  }

  if (benchEl) {
    if (orc._bench) {
      const denom = orc._bench.totalFrames || 1;
      const pct = Math.floor((orc._bench.frames / denom) * 100);
      benchEl.textContent = `⏱ Benchmarking ${orc._bench.name}… ${pct}%`;
    } else {
      benchEl.textContent = '';
    }
  }
}

/**
 * HUD frame-time equalizer (pure canvas paint).
 *
 * Renders the most recent N samples as discrete vertical bars in the
 * neomorphic recessed wrapper. Each bar is coloured by its OWN load ratio
 * (green / amber / red) with a vertical gradient + 1px bright cap as peak
 * indicator. Dashed reference line at 1.0× budget.
 *
 * Y axis: 0 ms at the bottom, 2× budget at the top (clamped).
 */
export function drawHudFrameGraph(canvasEl, samples, budgetMs) {
  const ctx = canvasEl.getContext("2d");
  if (!ctx) return;
  const w = canvasEl.width;
  const h = canvasEl.height;
  ctx.clearRect(0, 0, w, h);
  if (!(budgetMs > 0)) return;

  // Inner well — extra depth on top of the wrapper's recessed shadow.
  const wellGrad = ctx.createLinearGradient(0, 0, 0, h);
  wellGrad.addColorStop(0, "rgba(0, 0, 0, 0.42)");
  wellGrad.addColorStop(0.55, "rgba(20, 12, 4, 0.55)");
  wellGrad.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.fillStyle = wellGrad;
  ctx.fillRect(0, 0, w, h);

  // Faint baseline at y=0 ms.
  ctx.strokeStyle = "rgba(251, 192, 45, 0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h - 0.5);
  ctx.lineTo(w, h - 0.5);
  ctx.stroke();

  // Dashed budget reference line at 1.0× budget.
  const span = 2 * budgetMs;
  const yForMs = (ms) => h - Math.min(1, Math.max(0, ms) / span) * h;
  const yBudget = yForMs(budgetMs);
  ctx.strokeStyle = "rgba(251, 192, 45, 0.28)";
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, yBudget + 0.5);
  ctx.lineTo(w, yBudget + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);

  const N = samples.length;
  if (N === 0) return;

  // 16-bar equalizer (May-12 follow-up). Slot ≈ 12px / bar ≈ 11px in 198px
  // well — clean rhythm and single-frame stutters jump out instead of
  // averaging into the noise floor.
  const MAX_BARS = 16;
  const visible = Math.min(N, MAX_BARS);
  const startIdx = Math.max(0, N - visible);
  const slotW = w / MAX_BARS;
  const barW = Math.max(2, slotW - 1.2);
  const radius = Math.min(1.6, barW * 0.32);

  for (let i = 0; i < visible; i++) {
    const ms = samples[startIdx + i];
    if (!(ms > 0)) continue;
    const ratio = ms / budgetMs;
    const y = yForMs(ms);
    const barH = h - y;
    if (barH < 1) continue;

    // Per-bar palette by its own load ratio (independent of LOAD% avg).
    let baseCol, midCol, tipCol, capAlpha;
    if (ratio < 0.7) {
      baseCol = "#1b5e20"; midCol = "#66bb6a"; tipCol = "#c8e6c9"; capAlpha = 0.45;
    } else if (ratio < 1.05) {
      baseCol = "#e65100"; midCol = "#fbc02d"; tipCol = "#fff59d"; capAlpha = 0.6;
    } else {
      baseCol = "#7f0000"; midCol = "#ef5350"; tipCol = "#ffcdd2"; capAlpha = 0.85;
    }

    const grad = ctx.createLinearGradient(0, y, 0, h);
    grad.addColorStop(0, tipCol);
    grad.addColorStop(0.42, midCol);
    grad.addColorStop(1, baseCol);
    ctx.fillStyle = grad;

    const x = Math.floor(i * slotW + (slotW - barW) * 0.5);
    const bw = Math.floor(barW);

    // Rounded-top bar (only top corners — base sits flush).
    if (radius >= 0.5 && barH > radius) {
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, y + radius);
      ctx.quadraticCurveTo(x, y, x + radius, y);
      ctx.lineTo(x + bw - radius, y);
      ctx.quadraticCurveTo(x + bw, y, x + bw, y + radius);
      ctx.lineTo(x + bw, h);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillRect(x, y, bw, barH);
    }

    // Bright cap line — peak indicator (slight glow on red bars).
    ctx.fillStyle = `rgba(255, 255, 255, ${capAlpha})`;
    ctx.fillRect(x, y, bw, 1);
  }
}

// ── Village / top-down view: right column stack (HUD → Village Builder; PiP top-left like FPV) ──

let _villageRightStackAttached = false;

/**
 * Computes `--v2-village-after-hud`, `--v2-village-after-moondial`,
 * `--v2-village-after-builder` on `:root` so fixed panels share one right
 * rail without magic `top: 510px` offsets. PiP/moondial stay top-left (same
 * as FPV): `--v2-village-after-moondial` is max(HUD bottom, PiP bottom) so
 * Village Builder does not tuck under tall HUD overlaps. Idempotent when not
 * in map view.
 */
export function syncVillageViewRightStackCssVars() {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  if (!document.body.classList.contains("v2-village-view")) {
    root.removeProperty("--v2-village-after-hud");
    root.removeProperty("--v2-village-after-moondial");
    root.removeProperty("--v2-village-after-builder");
    return;
  }

  const gapA = 10;
  const gapB = 10;

  /** @type {number} */
  let afterHudPx = 140;

  const hud = document.getElementById("v2-orchestrator-hud");
  if (hud) {
    const b = hud.getBoundingClientRect();
    afterHudPx = Math.round(b.bottom + gapA);
    root.setProperty("--v2-village-after-hud", `${afterHudPx}px`);
  }

  let moonBottomPx = afterHudPx;
  const moon = document.querySelector("#v2-panels-pip #moondial-wrapper");
  if (moon) {
    const st = getComputedStyle(moon);
    if (st.display !== "none" && st.visibility !== "hidden") {
      const b = moon.getBoundingClientRect();
      moonBottomPx = Math.round(b.bottom + gapB);
    }
  }

  const afterMoondialCol = Math.max(afterHudPx, moonBottomPx);
  root.setProperty("--v2-village-after-moondial", `${afterMoondialCol}px`);

  const merged = document.querySelector("#v2-village-builder #vb-merged-panel");
  if (
    merged &&
    merged.style.display !== "none" &&
    getComputedStyle(merged).display !== "none"
  ) {
    const b = merged.getBoundingClientRect();
    root.setProperty(
      "--v2-village-after-builder",
      `${Math.round(b.bottom + gapB)}px`,
    );
  } else {
    root.setProperty(
      "--v2-village-after-builder",
      root.getPropertyValue("--v2-village-after-moondial") || "400px",
    );
  }
}

/**
 * ResizeObserver + hooks so the village column stays aligned when the FPS
 * HUD content height or moondial size changes. Exposes
 * `window._v2SyncVillageViewRightStack` for map-view edge toggles.
 */
export function attachVillageViewRightStackLayout() {
  if (_villageRightStackAttached || typeof document === "undefined") return;
  _villageRightStackAttached = true;

  try {
    window._v2SyncVillageViewRightStack = syncVillageViewRightStackCssVars;
  } catch (_e) {
    /* ignore */
  }

  const arm = () => {
    requestAnimationFrame(() => syncVillageViewRightStackCssVars());
  };

  const observeTargets = () => {
    const hud = document.getElementById("v2-orchestrator-hud");
    const moon = document.querySelector("#v2-panels-pip #moondial-wrapper");
    const merged = document.querySelector("#v2-village-builder #vb-merged-panel");
    return [hud, moon, merged].filter(Boolean);
  };

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => arm());
    const hook = () => {
      for (const el of observeTargets()) {
        try {
          ro.observe(el);
        } catch (_e) {
          /* ignore */
        }
      }
    };
    hook();
    let n = 0;
    const poll = window.setInterval(() => {
      hook();
      if (++n > 120) window.clearInterval(poll);
    }, 80);
  }

  window.addEventListener("resize", arm);
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(arm).observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  arm();
}
