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
import { getGovernanceSnapshot } from "./anu/AnuGovernanceRules.js";
import { getRuntimeService } from "./RuntimeServices.js";

/** HUD HTML — kept as a constant so a future reskin doesn't have to rebuild the function. */
export const ORCHESTRATOR_HUD_HTML = `
      <div id="v2-fps" style="font-size:30px;font-weight:700;color:#a5d6a7;line-height:1;margin-bottom:6px;">-- FPS</div>
      <div id="v2-frame-graph-wrap" style="position:relative;width:204px;height:46px;margin-bottom:8px;border-radius:9px;padding:3px;box-sizing:border-box;background:linear-gradient(160deg, #0a0603 0%, #1a0f06 50%, #060300 100%);box-shadow:inset 2px 2px 5px rgba(0,0,0,0.95), inset -1px -1px 2px rgba(251,192,45,0.10), 0 1px 0 rgba(255,220,100,0.06), 0 -1px 0 rgba(0,0,0,0.6);">
        <canvas id="v2-frame-graph" width="198" height="40" style="display:block;width:198px;height:40px;border-radius:6px;background:transparent;"></canvas>
        <div id="v2-load" style="position:absolute;left:8px;top:5px;font-size:9px;letter-spacing:1.4px;color:rgba(255,248,220,0.92);font-weight:800;text-shadow:0 1px 2px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.7);pointer-events:none;">LOAD --%</div>
        <div id="v2-load-detail" style="position:absolute;right:8px;top:5px;font-size:8px;letter-spacing:0.6px;color:rgba(255,248,220,0.62);text-shadow:0 1px 2px rgba(0,0,0,0.95), 0 0 4px rgba(0,0,0,0.7);pointer-events:none;">--/--ms</div>
      </div>
      <div id="v2-anu-alert" title="Simulation Universe live audit — hover for full findings, or run AnuUniverse.audit() in DevTools" style="font-size:9.5px;letter-spacing:0.4px;color:rgba(165,214,167,0.55);margin-bottom:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:auto;cursor:help;">Simulation Universe: warming up…</div>
      <div id="v2-draws" style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:6px;">warming up…</div>
      <div id="v2-pip" style="font-size:10px;color:rgba(129,212,250,0.75);margin-bottom:6px;letter-spacing:0.4px;">PiP …</div>
      <div id="v2-hud-title" style="font-size:9px;letter-spacing:2px;color:rgba(251,192,45,0.35);margin-bottom:10px;font-weight:600;text-align:right;">SACRED ADV v2 · ORCHESTRATOR</div>
      <div style="height:1px;background:rgba(251,192,45,0.15);margin-bottom:10px;"></div>

      <!-- ── PIPELINE TRACE accordion (above UNIVERSE) ──────────────── -->
      <div id="v2-hud-trace-label" role="button" tabindex="0" aria-expanded="false"
           aria-controls="v2-trace-accordion-body"
           title="60-second pipeline trace — click to expand. Auto-refreshes every 2s while open."
           style="font-size:10px;letter-spacing:1.5px;color:rgba(128,222,234,0.5);margin-bottom:6px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px;user-select:none;pointer-events:auto;">
        <span>
          <span id="v2-trace-toggle-icon" style="display:inline-block;width:9px;transition:transform 0.15s;">▶</span>
          TRACE
          <span id="v2-trace-dur" style="color:#80deea;font-weight:700;letter-spacing:0;font-size:9px;opacity:0.7;">--s</span>
        </span>
        <span id="v2-trace-copy-pill"
              style="pointer-events:auto;cursor:pointer;background:rgba(128,222,234,0.08);border:1px solid rgba(128,222,234,0.25);border-radius:4px;padding:1px 7px;font-size:8px;letter-spacing:1.5px;color:rgba(128,222,234,0.65);user-select:none;">
          📋 COPY
        </span>
      </div>
      <div id="v2-trace-accordion-body" style="display:none;margin-bottom:4px;">
        <canvas id="v2-trace-spark" width="198" height="32"
                style="display:block;width:198px;height:32px;border-radius:5px;
                       background:#0a0603;margin-bottom:6px;
                       box-shadow:inset 1px 1px 4px rgba(0,0,0,0.9);"></canvas>
        <div id="v2-trace-stats"
             style="font-size:9px;color:rgba(255,255,255,0.55);line-height:1.85;
                    letter-spacing:0.3px;padding-bottom:4px;">
          loading…
        </div>
      </div>
      <div style="height:1px;background:rgba(251,192,45,0.08);margin-bottom:8px;"></div>

      <div id="v2-hud-universe-label" role="button" tabindex="0" aria-expanded="false" aria-controls="v2-universe-accordion-body" title="Click to expand/collapse module list" style="font-size:10px;letter-spacing:1.5px;color:rgba(251,192,45,0.45);margin-bottom:6px;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px;user-select:none;">
        <span><span id="v2-universe-toggle-icon" style="display:inline-block;width:9px;transition:transform 0.15s;">▶</span> SIMULATION UNIVERSE <span id="v2-universe-pct" style="color:#a5d6a7;font-weight:700;letter-spacing:0;">--%</span></span>
        <span id="v2-universe-count" style="color:rgba(255,255,255,0.4);font-size:9px;letter-spacing:0.2px;font-weight:500;">0 mods</span>
      </div>
      <div id="v2-universe-accordion-body" style="display:none;">
        <div id="v2-modules" style="font-size:12px;color:#81d4fa;line-height:1.9;">none</div>
        <div id="v2-bench" style="font-size:11px;color:#ce93d8;margin-top:10px;min-height:16px;"></div>
      </div>
      <div id="v2-hud-map-section">
        <div style="height:1px;background:rgba(251,192,45,0.15);margin:10px 0;"></div>
        <div id="v2-hud-map-label" style="font-size:10px;letter-spacing:1.5px;color:rgba(251,192,45,0.45);margin-bottom:6px;font-weight:600;">MAP</div>
        <div id="v2-map-picker" style="display:flex;flex-direction:column;gap:5px;"></div>
      </div>
      <div id="v2-hud-copyright" style="font-size:8px;line-height:1.35;color:rgba(255,255,255,0.28);margin-top:12px;padding-top:10px;border-top:1px solid rgba(251,192,45,0.08);letter-spacing:0.15px;text-align:center;">Idea Software Studio &copy; 2026</div>
    `;

/** Build the HUD root element and inject the HTML. Returns the element. */
export function buildOrchestratorHud() {
  const fontService = getRuntimeService("WebFontsService");
  if (fontService) {
    fontService.loadFont("v2-font-fredoka", "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap");
  } else {
    if (!document.getElementById("v2-font")) {
      const lnk = document.createElement("link");
      lnk.id = "v2-font";
      lnk.rel = "stylesheet";
      lnk.href = "https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap";
      document.head.appendChild(lnk);
    }
  }
  // Mobile shrink (≤ 768 px): ~30% smaller + thinner + smaller fonts so
  // the truncated "Simulation Universe: ✓ cle…" and "PiP=on stride:8 phas…"
  // lines fit. Desktop is unchanged. `!important` is required because
  // every styleable element below uses inline `style="…"`.
  if (!document.getElementById('v2-orchestrator-hud-mobile-css')) {
    const st = document.createElement('style');
    st.id = 'v2-orchestrator-hud-mobile-css';
    st.textContent = `
      #v2-hud-map-section { display: none; }
      body.v2-village-view #v2-hud-map-section { display: block; }
      @media (max-width: 768px) {
        #v2-orchestrator-hud {
          width: min(196px, calc(100vw - 24px)) !important;
          padding: 9px 12px 7px !important;
          font-size: 9px !important;
          border-radius: 11px !important;
          max-height: min(380px, calc(100vh - 24px)) !important;
        }
        #v2-orchestrator-hud #v2-hud-title { font-size: 6.5px !important; letter-spacing: 1.4px !important; margin-bottom: 7px !important; }
        #v2-orchestrator-hud #v2-fps { font-size: 21px !important; margin-bottom: 4px !important; }
        #v2-orchestrator-hud #v2-frame-graph-wrap {
          width: 142px !important; height: 32px !important;
          padding: 2px !important; margin-bottom: 6px !important;
          border-radius: 6px !important;
        }
        #v2-orchestrator-hud #v2-frame-graph {
          width: 138px !important; height: 28px !important;
          border-radius: 4px !important;
        }
        #v2-orchestrator-hud #v2-load        { font-size: 7px !important; left: 6px !important; top: 4px !important; letter-spacing: 1px !important; }
        #v2-orchestrator-hud #v2-load-detail { font-size: 6.5px !important; right: 6px !important; top: 4px !important; }
        #v2-orchestrator-hud #v2-anu-alert   { font-size: 7px !important; margin-bottom: 6px !important; }
        #v2-orchestrator-hud #v2-draws       { font-size: 8px !important; margin-bottom: 4px !important; }
        #v2-orchestrator-hud #v2-pip         { font-size: 7.5px !important; margin-bottom: 7px !important; }
        #v2-orchestrator-hud #v2-hud-universe-label,
        #v2-orchestrator-hud #v2-hud-map-label { font-size: 7px !important; margin-bottom: 4px !important; letter-spacing: 1px !important; }
        #v2-orchestrator-hud #v2-modules     { font-size: 9px !important; line-height: 1.7 !important; }
        #v2-orchestrator-hud #v2-bench       { font-size: 8px !important; margin-top: 7px !important; }
        #v2-orchestrator-hud #v2-hud-copyright {
          font-size: 6.5px !important; margin-top: 9px !important;
          padding-top: 7px !important; line-height: 1.25 !important;
        }
      }
    `;
    document.head.appendChild(st);
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
      right: 0;
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
  _wireUniverseAccordion(hud);
  _wireTraceAccordion(hud);
  return hud;
}

/**
 * UNIVERSE label is a clickable accordion header — click toggles the
 * #v2-universe-accordion-body (which holds the modules list + bench).
 * Default state: collapsed (set by inline `display:none` in HTML).
 * Keyboard: Enter/Space also toggles. Persists across boots via localStorage.
 */
function _wireUniverseAccordion(hud) {
  const header = hud.querySelector('#v2-hud-universe-label');
  const body = hud.querySelector('#v2-universe-accordion-body');
  const icon = hud.querySelector('#v2-universe-toggle-icon');
  if (!header || !body || !icon) return;

  const STORAGE_KEY = 'v2.hud.universe.expanded';
  const setExpanded = (open) => {
    body.style.display = open ? 'block' : 'none';
    icon.textContent = open ? '▼' : '▶';
    header.setAttribute('aria-expanded', open ? 'true' : 'false');
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch (_e) {}
  };

  // Restore last state (default collapsed).
  let initial = false;
  try { initial = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_e) {}
  setExpanded(initial);

  const toggle = () => setExpanded(body.style.display === 'none');
  header.addEventListener('click', toggle);
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
}

// ── Pipeline Trace ring-buffer (feeds window._v4GetPipelineTrace) ───────────
// Samples ANU's existing FrameBudget + adaptiveDpr + fuzzy-pipeline sensors
// at 1 Hz into a 60-sample ring (60 s window). The original ring-buffer in
// SanctuaryFpsHud was reverted in 6685fb1; this rebuilds it next to its only
// consumer so the TRACE accordion stops showing "FPS HUD not loaded".

const TRACE_RING_SIZE = 60;
const TRACE_SAMPLE_MS = 1000;
const _traceRing = new Array(TRACE_RING_SIZE);
let _traceHead = 0;
let _traceFull = false;
let _traceSamplerStarted = false;

function _sampleTraceTick() {
  const now = Date.now();
  let fps = 0, loadPct = 0, dpr = null, bottleneck = 'none';
  let haveBudget = false;
  try {
    const budget = window.AnuUniverse?.budget?.snapshot?.();
    if (budget) {
      const avg = budget.avgMs > 0 ? budget.avgMs : budget.lastMs;
      if (avg > 0) {
        fps = Math.round(1000 / avg);
        loadPct = Math.round(budget.loadPct || 0);
        haveBudget = true;
      }
    }
  } catch (_) {}
  if (!haveBudget) return; // skip pre-warmup ticks so boot zeros don't pollute the ring
  try {
    const adapt = window.AnuUniverse?.adaptiveDpr?.snapshot?.();
    if (adapt && typeof adapt.currentDpr === 'number') {
      dpr = Math.round(adapt.currentDpr * 100) / 100;
    }
  } catch (_) {}
  if (dpr === null && typeof window !== 'undefined') {
    dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
  }
  try {
    const fuzzy = window.AnuUniverse?.getFuzzyPipelineSnapshot?.();
    bottleneck = fuzzy?.primaryBottleneck?.id || 'none';
  } catch (_) {}
  _traceRing[_traceHead] = { t: now, fps, loadPct, dpr, bottleneck };
  _traceHead = (_traceHead + 1) % TRACE_RING_SIZE;
  if (_traceHead === 0) _traceFull = true;
}

function _readTraceSamples() {
  const out = [];
  if (_traceFull) {
    for (let i = 0; i < TRACE_RING_SIZE; i++) {
      const s = _traceRing[(_traceHead + i) % TRACE_RING_SIZE];
      if (s) out.push(s);
    }
  } else {
    for (let i = 0; i < _traceHead; i++) {
      const s = _traceRing[i];
      if (s) out.push(s);
    }
  }
  return out;
}

function _buildTraceSummary(samples) {
  if (!samples.length) {
    return { durationSec: 0, sampleCount: 0,
             fps: { min: 0, avg: 0, max: 0 }, loadPct: { min: 0, max: 0 },
             dprChanges: [], bottleneckChanges: [] };
  }
  let fpsMin = Infinity, fpsMax = 0, fpsSum = 0;
  let loadMin = Infinity, loadMax = 0;
  const dprChanges = [];
  const bottleneckChanges = [];
  let lastDpr = null, lastBtl = null;
  for (const s of samples) {
    if (s.fps < fpsMin) fpsMin = s.fps;
    if (s.fps > fpsMax) fpsMax = s.fps;
    fpsSum += s.fps;
    if (s.loadPct < loadMin) loadMin = s.loadPct;
    if (s.loadPct > loadMax) loadMax = s.loadPct;
    if (s.dpr !== lastDpr) { dprChanges.push({ t: s.t, dpr: s.dpr }); lastDpr = s.dpr; }
    if (s.bottleneck !== lastBtl) { bottleneckChanges.push({ t: s.t, id: s.bottleneck }); lastBtl = s.bottleneck; }
  }
  const durationSec = Math.round((samples[samples.length - 1].t - samples[0].t) / 1000);
  return {
    durationSec,
    sampleCount: samples.length,
    fps: { min: fpsMin === Infinity ? 0 : fpsMin, avg: Math.round(fpsSum / samples.length), max: fpsMax },
    loadPct: { min: loadMin === Infinity ? 0 : loadMin, max: loadMax },
    dprChanges,
    bottleneckChanges,
  };
}

function _startTraceSampler() {
  if (_traceSamplerStarted) return;
  _traceSamplerStarted = true;
  _sampleTraceTick();
  setInterval(_sampleTraceTick, TRACE_SAMPLE_MS);
  if (typeof window !== 'undefined') {
    window._v4GetPipelineTrace = () => {
      const samples = _readTraceSamples();
      return { samples, summary: _buildTraceSummary(samples) };
    };
  }
}

// ── Pipeline Trace accordion helpers ────────────────────────────────────────

/**
 * Draw a compact FPS sparkline into the trace canvas.
 * Each sample → 1 bar, colour = load-based heat, cyan ticks = DPR steps.
 */
function _drawTraceSpark(canvas, samples, summary) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0a0603';
  ctx.fillRect(0, 0, W, H);
  if (!samples.length) return;

  const n = samples.length;
  const barW = Math.max(1, W / n);

  // Use steady-state max (skip first 3 boot samples) to scale bars
  const steady = samples.slice(Math.min(3, n));
  const maxFps = Math.max(1, steady.reduce((m, s) => Math.max(m, s.fps || 0), 0));

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const barH = Math.round(Math.min(H, ((s.fps || 0) / maxFps) * H));
    const load = s.loadPct || 0;
    ctx.fillStyle = load > 130 ? '#ef5350'
                  : load > 100 ? '#ff7043'
                  : load > 85  ? '#fbc02d'
                  :              '#a5d6a7';
    ctx.fillRect(Math.floor(i * barW), H - barH, Math.max(1, Math.ceil(barW) - 1), barH);
  }

  // Cyan vertical ticks at DPR change events
  const dprChanges = summary?.dprChanges || [];
  for (const ev of dprChanges) {
    const idx = samples.findIndex(s => s.t >= ev.t);
    if (idx < 0) continue;
    const x = Math.floor(idx * barW);
    ctx.strokeStyle = 'rgba(128,222,234,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    // Label the DPR value
    ctx.fillStyle = 'rgba(128,222,234,0.9)';
    ctx.font = '7px ui-monospace,Menlo,monospace';
    ctx.fillText(`×${ev.dpr}`, x + 2, 8);
  }
}

/**
 * Build inner HTML for the trace stats div.
 * Produces a concise table + inline diagnosis.
 */
function _buildTraceStatsHtml(summary, samples) {
  if (!summary || !samples.length) return '<span style="opacity:0.4">No trace data yet — wait ~5s.</span>';

  const hi = (v, good, warn, suf = '') => {
    const n = Number(v);
    const s = `${n}${suf}`;
    if (n <= good) return `<b style="color:#a5d6a7">${s}</b>`;
    if (n <= warn) return `<b style="color:#fbc02d">${s}</b>`;
    return `<b style="color:#ef5350">${s}</b>`;
  };

  // Steady-state = samples after the first 3 (skip boot spike)
  const steady = samples.slice(Math.min(3, samples.length)).filter(s => s.fps > 0);
  const avgLoad = steady.length
    ? Math.round(steady.reduce((a, s) => a + (s.loadPct || 0), 0) / steady.length)
    : null;

  const dprStr = (summary.dprChanges || [])
    .map(d => `×${d.dpr}`).join(' <span style="opacity:0.4">→</span> ') || '—';

  const btlStr = (summary.bottleneckChanges || [])
    .map(b => b.id === 'none' ? '<span style="opacity:0.3">·</span>'
                              : `<b style="color:#80deea">${b.id}</b>`)
    .join(' → ') || '—';

  let diagColor = '#a5d6a7', diagIcon = '✓', diagMsg = 'Healthy — frame budget nominal';
  if (avgLoad !== null && avgLoad > 130) {
    diagColor = '#ef5350'; diagIcon = '✗'; diagMsg = `Over budget avg ${avgLoad}% — scene cost too high`;
  } else if (avgLoad !== null && avgLoad > 85) {
    diagColor = '#fbc02d'; diagIcon = '⚠'; diagMsg = `Watch — avg ${avgLoad}% budget in steady state`;
  } else if (avgLoad !== null) {
    diagMsg = `${avgLoad}% budget · DPR stepped up to ×${(summary.dprChanges || []).at(-1)?.dpr ?? '?'}`;
  }

  // pip-pass note: if pip-pass is labeled BTLNK but load is healthy, clarify
  const hasPipBtl = (summary.bottleneckChanges || []).some(b => b.id === 'pip-pass');
  const pipNote   = (hasPipBtl && avgLoad !== null && avgLoad < 60)
    ? `<div style="color:rgba(128,222,234,0.6);font-size:8px;margin-top:3px;line-height:1.5;">
         ↑ pip-pass score=1.0 is relative — it's the heaviest single op,<br>
         but absolute budget is fine. Not a perf emergency.
       </div>`
    : '';

  return `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:0 8px;align-items:baseline;">
      <span style="opacity:0.38;font-size:8px;letter-spacing:1px;">DUR</span>
      <span>${summary.durationSec ?? '--'}s &nbsp;<span style="opacity:0.35">·</span>&nbsp; ${summary.sampleCount} samples</span>

      <span style="opacity:0.38;font-size:8px;letter-spacing:1px;">FPS</span>
      <span>${hi(summary.fps.min,60,30)} min &nbsp;·&nbsp; ${hi(summary.fps.avg,60,30)} avg &nbsp;·&nbsp; <b>${summary.fps.max}</b> peak</span>

      <span style="opacity:0.38;font-size:8px;letter-spacing:1px;">LOAD</span>
      <span>${hi(summary.loadPct.min,85,130,'%')} → ${hi(summary.loadPct.max,85,130,'%')}</span>

      <span style="opacity:0.38;font-size:8px;letter-spacing:1px;">DPR</span>
      <span>${dprStr}</span>

      <span style="opacity:0.38;font-size:8px;letter-spacing:1px;">BTLNK</span>
      <span style="font-size:8.5px;">${btlStr}</span>
    </div>
    <div style="margin-top:5px;padding:3px 6px;border-radius:4px;
                background:rgba(0,0,0,0.25);border-left:2px solid ${diagColor};
                font-size:8.5px;color:${diagColor};">
      ${diagIcon} ${diagMsg}
    </div>
    ${pipNote}
  `;
}

/**
 * Wire the PIPELINE TRACE accordion — collapse/expand, auto-refresh, copy.
 */
function _wireTraceAccordion(hud) {
  const header  = hud.querySelector('#v2-hud-trace-label');
  const body    = hud.querySelector('#v2-trace-accordion-body');
  const icon    = hud.querySelector('#v2-trace-toggle-icon');
  const durEl   = hud.querySelector('#v2-trace-dur');
  const copyPill = hud.querySelector('#v2-trace-copy-pill');
  if (!header || !body || !icon) return;

  _startTraceSampler();

  const refresh = () => {
    if (body.style.display === 'none') return;
    const fn = typeof window._v4GetPipelineTrace === 'function' ? window._v4GetPipelineTrace : null;
    if (!fn) {
      const stats = body.querySelector('#v2-trace-stats');
      if (stats) stats.innerHTML = '<span style="opacity:0.4">Pipeline trace sampler not started.</span>';
      return;
    }
    const { samples, summary } = fn();
    if (durEl) durEl.textContent = `${summary.durationSec ?? '--'}s`;
    const canvas = body.querySelector('#v2-trace-spark');
    if (canvas) _drawTraceSpark(canvas, samples, summary);
    const stats = body.querySelector('#v2-trace-stats');
    if (stats)  stats.innerHTML = _buildTraceStatsHtml(summary, samples);
  };

  const STORAGE_KEY = 'v2.hud.trace.expanded';
  const setExpanded = (open) => {
    body.style.display = open ? 'block' : 'none';
    icon.textContent = open ? '▼' : '▶';
    header.setAttribute('aria-expanded', String(open));
    if (open) refresh();
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch (_) {}
  };

  let initial = false;
  try { initial = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}
  setExpanded(initial);

  const toggle = () => setExpanded(body.style.display === 'none');
  header.addEventListener('click', (e) => {
    // Don't toggle if the COPY pill was clicked
    if (e.target.closest('#v2-trace-copy-pill')) return;
    toggle();
  });
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });

  // COPY pill — in header so always accessible
  if (copyPill) {
    copyPill.addEventListener('click', (e) => {
      e.stopPropagation();
      const fn = typeof window._v4GetPipelineTrace === 'function' ? window._v4GetPipelineTrace : null;
      if (!fn) return;
      const { samples, summary } = fn();
      const text = JSON.stringify({
        _meta: { source: 'OrchestratorHud 60s pipeline trace', capturedAt: new Date().toISOString(), project: 'Sacred Adventures' },
        summary, samples,
      }, null, 2);
      navigator?.clipboard?.writeText(text).then(() => {
        const orig = copyPill.textContent;
        copyPill.textContent = '✓ COPIED';
        copyPill.style.color = '#a5d6a7';
        setTimeout(() => { copyPill.textContent = orig; copyPill.style.color = 'rgba(128,222,234,0.65)'; }, 1800);
      }).catch(() => {});
    });
  }

  // Auto-refresh every 2 s while open
  setInterval(refresh, 2000);
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

/** Refresh the active-modules block. Cheap; called on register/activate/deactivate.
 *  Also updates the universe header count badge (e.g. "36 mods"). */
export function updateOrchestratorHudModules(orc) {
  if (!orc._hud) return;
  const modEl = orc._hud.querySelector('#v2-modules');
  const countEl = orc._hud.querySelector('#v2-universe-count');
  if (countEl) {
    const n = orc._activeModules.length;
    countEl.textContent = `${n} mod${n === 1 ? '' : 's'}`;
  }
  if (!modEl) return;
  if (orc._activeModules.length === 0) {
    modEl.textContent = 'none';
    return;
  }
  modEl.innerHTML = orc._activeModules.map(name => {
    const entry = orc._registry.get(name);
    const cost = entry && entry.fpsCost !== null ? ` <span style="color:#ef9a9a;">[${entry.fpsCost.toFixed(1)}fps]</span>` : '';
    const displayName = name === "Anu" ? "Simulation Universe" : name;
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
      alertEl.textContent = "Simulation Universe: ✓ clear";
      alertEl.title = "Simulation Universe live audit — no findings. Run AnuUniverse.audit() in DevTools for the same result.";
    } else {
      const first = alerts[0];
      const more = alerts.length > 1 ? `  +${alerts.length - 1}` : "";
      const sev = first.severity === "error" ? "✗" : "⚠";
      alertEl.style.color = first.severity === "error" ? "#ef5350" : "#fbc02d";
      alertEl.textContent = `Simulation Universe ${sev} ${first.id}${more}`;
      alertEl.title = alerts
        .map((a, i) => `${i + 1}. [${a.severity}] ${a.id}\n   ${a.text}`)
        .join("\n\n");
    }
  }

  // Universe % complete — header summary computed from Anu's governance
  // checks (passing / total). Shares the 2 Hz throttle with the audit read
  // so we don't walk Anu twice per HUD tick. Color: green ≥90, amber 50–89,
  // red <50, neutral while warming up.
  const pctEl = orc._hud.querySelector("#v2-universe-pct");
  if (pctEl) {
    const nowMs = performance.now();
    if (nowMs >= (orc._anuGovernanceNextAtMs || 0)) {
      orc._anuGovernanceNextAtMs = nowMs + 500;
      try {
        const snap = getGovernanceSnapshot(orc);
        const checks = Array.isArray(snap?.checks) ? snap.checks : [];
        const total = checks.length;
        const passing = checks.filter(c => c && c.ok === true).length;
        orc._anuGovernancePct = total > 0 ? Math.round((passing / total) * 100) : null;
        orc._anuGovernancePassing = passing;
        orc._anuGovernanceTotal = total;
      } catch (_e) { /* never throw from HUD */ }
    }
    const pct = orc._anuGovernancePct;
    if (pct === null || pct === undefined) {
      pctEl.textContent = "--%";
      pctEl.style.color = "rgba(255,255,255,0.4)";
    } else {
      pctEl.textContent = `${pct}%`;
      pctEl.style.color = pct >= 90 ? "#a5d6a7" : pct >= 50 ? "#fbc02d" : "#ef5350";
      pctEl.title = `Anu governance: ${orc._anuGovernancePassing}/${orc._anuGovernanceTotal} checks healthy`;
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
