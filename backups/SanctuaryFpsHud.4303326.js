/**
 * Sacred Adventures — SanctuaryFpsHud (unified ANU pipeline panel)
 * =================================================================
 * Single always-on panel (top-right) that replaces both the old
 * SanctuaryFpsHud AND the OrchestratorHud floating modal.
 *
 * Layout (top → bottom):
 *   ANU PIPELINE header
 *   FPS · AVG ms · LST ms
 *   [frame-graph equaliser with LOAD%/ms overlay]
 *   UNIVERSE.ANU alert row
 *   DRAW n · TRI nk
 *   LOAD % · BDG ms
 *   ─────
 *   DPR × · HZ · CAP ×
 *   ↓STR /n · ↑RLX /n · STP
 *   ─────
 *   PiP ×stride · φ phase
 *   BTLNK id · score
 *   ─────
 *   ▶ TRACE accordion  (60 s sparkline + stats, COPY pill)
 *   ▶ UNIVERSE accordion (active modules + governance %)
 *   ─────
 *   [📋 COPY 60s TRACE button]   ← Alt+Shift+C
 *
 * On load:  injects `#v2-orchestrator-hud { display:none !important }` to
 *           retire the old modal without removing it from the DOM tree.
 * On unload: removes that style tag to restore it cleanly.
 *
 * Data sources:
 *   FrameBudget.getFrameBudgetSnapshot() / getFrameSamples()
 *   drawHudFrameGraph()            — from OrchestratorHud.js
 *   window.AnuUniverse.adaptiveDpr.snapshot()
 *   window.AnuUniverse.rendering.getRenderingSnapshot()
 *   window.AnuUniverse.getFuzzyPipelineSnapshot()
 *   window.AnuUniverse.audit()
 *   getGovernanceSnapshot()        — from AnuGovernanceRules.js
 *   window.anuOrchestrator._activeModules / ._registry
 *
 * Refresh: 250 ms.  Ring buffer: 240 samples = 60 s.
 */

import { getFrameBudgetSnapshot, getFrameSamples } from "../v2/anu/FrameBudget.js";
import { drawHudFrameGraph } from "../v2/OrchestratorHud.js";
import { getGovernanceSnapshot } from "../v2/anu/AnuGovernanceRules.js";

const REFRESH_MS    = 250;
const TRACE_SAMPLES = 240; // 60 s × 4 samples/s

// ── Colour helpers ───────────────────────────────────────────────────────────
function _fpsColor(fps) {
  if (fps >= 115) return "#a5d6a7";
  if (fps >= 90)  return "#fff59d";
  if (fps >= 60)  return "#ffb74d";
  return "#ef9a9a";
}
function _loadColor(pct) {
  if (pct <= 85)  return "#a5d6a7";
  if (pct <= 100) return "#fff59d";
  if (pct <= 130) return "#ffb74d";
  return "#ef9a9a";
}
function _stressColor(frames, limit) {
  const ratio = limit > 0 ? frames / limit : 0;
  if (ratio < 0.4) return "#a5d6a7";
  if (ratio < 0.7) return "#fff59d";
  if (ratio < 0.9) return "#ffb74d";
  return "#ef9a9a";
}
function _btlnkColor(score) {
  if (score < 0.4)  return "#a5d6a7";
  if (score < 0.65) return "#fff59d";
  if (score < 0.85) return "#ffb74d";
  return "#ef9a9a";
}
function _ms(v)  { return Number.isFinite(v) ? v.toFixed(1) : "--"; }
function _pct(v) { return Number.isFinite(v) ? Math.round(v) : "--"; }

// ── DOM builder ──────────────────────────────────────────────────────────────
function _row(id, content) {
  return `<div id="${id}" style="display:flex;align-items:baseline;gap:4px;line-height:1.7;">${content}</div>`;
}
function _lbl(t) {
  return `<span style="opacity:0.52;font-size:9px;letter-spacing:2px;font-weight:600;">${t}</span>`;
}
function _val(id, text = "--", color = "#e6f0d8") {
  return `<span id="${id}" style="color:${color};font-weight:700;">${text}</span>`;
}
function _dim(t) {
  return `<span style="opacity:0.35;font-size:9px;">${t}</span>`;
}
function _sep() {
  return `<span style="opacity:0.22;margin:0 2px;">·</span>`;
}

// ── Trace summary builder ────────────────────────────────────────────────────
function _buildTraceSummary(samples) {
  if (!samples.length) return { note: "no samples yet" };

  let minFps = Infinity, maxFps = 0, sumFps = 0;
  let minLoad = Infinity, maxLoad = 0;
  const dprEvents   = [];
  const btlnkEvents = [];
  let prevDpr  = null;
  let prevBtl  = null;

  for (const s of samples) {
    if (s.fps !== null) {
      if (s.fps < minFps) minFps = s.fps;
      if (s.fps > maxFps) maxFps = s.fps;
      sumFps += s.fps;
    }
    if (s.loadPct !== null) {
      if (s.loadPct < minLoad) minLoad = s.loadPct;
      if (s.loadPct > maxLoad) maxLoad = s.loadPct;
    }
    if (s.dpr !== null && s.dpr !== prevDpr) {
      dprEvents.push({ t: s.t, dpr: s.dpr });
      prevDpr = s.dpr;
    }
    const btlKey = s.btlId && s.btlScore > 0.05 ? s.btlId : "none";
    if (btlKey !== prevBtl) {
      btlnkEvents.push({ t: s.t, id: btlKey, score: s.btlScore });
      prevBtl = btlKey;
    }
  }

  const count = samples.length;
  return {
    durationSec:       Math.round((samples[count - 1].t - samples[0].t) / 1000),
    sampleCount:       count,
    fps:               { min: minFps, max: maxFps, avg: Math.round(sumFps / count) },
    loadPct:           { min: Math.round(minLoad), max: Math.round(maxLoad) },
    dprChanges:        dprEvents,
    bottleneckChanges: btlnkEvents,
  };
}

// ── Trace sparkline ──────────────────────────────────────────────────────────
function _drawTraceSpark(canvas, samples, summary) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a0603";
  ctx.fillRect(0, 0, W, H);
  if (!samples.length) return;

  const n    = samples.length;
  const barW = Math.max(1, W / n);

  const steady = samples.slice(Math.min(3, n));
  const maxFps = Math.max(1, steady.reduce((m, s) => Math.max(m, s.fps || 0), 0));

  for (let i = 0; i < n; i++) {
    const s    = samples[i];
    const barH = Math.round(Math.min(H, ((s.fps || 0) / maxFps) * H));
    const load = s.loadPct || 0;
    ctx.fillStyle = load > 130 ? "#ef5350"
                  : load > 100 ? "#ff7043"
                  : load > 85  ? "#fbc02d"
                  :              "#a5d6a7";
    ctx.fillRect(Math.floor(i * barW), H - barH, Math.max(1, Math.ceil(barW) - 1), barH);
  }

  for (const ev of (summary?.dprChanges || [])) {
    const idx = samples.findIndex(s => s.t >= ev.t);
    if (idx < 0) continue;
    const x = Math.floor(idx * barW);
    ctx.strokeStyle = "rgba(128,222,234,0.75)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    ctx.fillStyle = "rgba(128,222,234,0.9)";
    ctx.font = "7px ui-monospace,Menlo,monospace";
    ctx.fillText(`×${ev.dpr}`, x + 2, 8);
  }
}

// ── Trace stats HTML ─────────────────────────────────────────────────────────
function _buildTraceStatsHtml(summary, samples) {
  if (!summary || !samples.length)
    return '<span style="opacity:0.4">No trace data yet — wait ~5s.</span>';

  const hi = (v, good, warn, suf = "") => {
    const n = Number(v);
    const s = `${n}${suf}`;
    if (n <= good) return `<b style="color:#a5d6a7">${s}</b>`;
    if (n <= warn) return `<b style="color:#fbc02d">${s}</b>`;
    return `<b style="color:#ef5350">${s}</b>`;
  };

  const steady  = samples.slice(Math.min(3, samples.length)).filter(s => s.fps > 0);
  const avgLoad = steady.length
    ? Math.round(steady.reduce((a, s) => a + (s.loadPct || 0), 0) / steady.length) : null;

  const dprStr = (summary.dprChanges || [])
    .map(d => `×${d.dpr}`).join(' <span style="opacity:0.4">→</span> ') || "—";

  const btlStr = (summary.bottleneckChanges || [])
    .map(b => b.id === "none"
      ? '<span style="opacity:0.3">·</span>'
      : `<b style="color:#80deea">${b.id}</b>`)
    .join(" → ") || "—";

  let diagColor = "#a5d6a7", diagIcon = "✓", diagMsg = "Healthy — frame budget nominal";
  if (avgLoad !== null && avgLoad > 130) {
    diagColor = "#ef5350"; diagIcon = "✗"; diagMsg = `Over budget avg ${avgLoad}% — scene cost too high`;
  } else if (avgLoad !== null && avgLoad > 85) {
    diagColor = "#fbc02d"; diagIcon = "⚠"; diagMsg = `Watch — avg ${avgLoad}% budget in steady state`;
  } else if (avgLoad !== null) {
    diagMsg = `${avgLoad}% budget · DPR stepped to ×${(summary.dprChanges || []).at(-1)?.dpr ?? "?"}`;
  }

  const hasPipBtl = (summary.bottleneckChanges || []).some(b => b.id === "pip-pass");
  const pipNote   = (hasPipBtl && avgLoad !== null && avgLoad < 60)
    ? `<div style="color:rgba(128,222,234,0.6);font-size:8px;margin-top:3px;line-height:1.5;">
         ↑ pip-pass score=1.0 is relative — heaviest single op,<br>
         but absolute budget is fine. Not a perf emergency.
       </div>`
    : "";

  return `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:0 8px;align-items:baseline;">
      <span style="opacity:0.38;font-size:8px;letter-spacing:1px;">DUR</span>
      <span>${summary.durationSec ?? "--"}s &nbsp;<span style="opacity:0.35">·</span>&nbsp; ${summary.sampleCount} samples</span>
      <span style="opacity:0.38;font-size:8px;letter-spacing:1px;">FPS</span>
      <span>${hi(summary.fps.min,60,30)} min &nbsp;·&nbsp; ${hi(summary.fps.avg,60,30)} avg &nbsp;·&nbsp; <b>${summary.fps.max}</b> peak</span>
      <span style="opacity:0.38;font-size:8px;letter-spacing:1px;">LOAD</span>
      <span>${hi(summary.loadPct.min,85,130,"%")} → ${hi(summary.loadPct.max,85,130,"%")}</span>
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

// ── Module ───────────────────────────────────────────────────────────────────
export const SanctuaryFpsHudModule = {
  name: "SanctuaryFpsHud",

  _el:       null,
  _timer:    0,
  _renderer: null,

  // Cached element refs (set once after DOM injection)
  _$: {},

  // Style tag that hides the old OrchestratorHud modal
  _hideOrcHudStyle: null,

  // ── 60-second ring buffer ─────────────────────────────────────────────────
  _trace:      [],
  _traceHead:  0,
  _traceFull:  false,

  // ── Throttle state for slow reads ────────────────────────────────────────
  _anuAuditNextAtMs:      0,
  _anuAuditAlerts:        [],
  _anuGovernanceNextAtMs: 0,
  _anuGovernancePct:      null,
  _anuGovernancePassing:  0,
  _anuGovernanceTotal:    0,

  // Trace accordion auto-refresh interval handle
  _traceRefreshInterval: null,

  _pushTrace(snap) {
    if (this._traceFull) {
      this._trace[this._traceHead] = snap;
    } else {
      this._trace.push(snap);
      if (this._trace.length >= TRACE_SAMPLES) this._traceFull = true;
    }
    this._traceHead = (this._traceHead + 1) % TRACE_SAMPLES;
  },

  _readTrace() {
    if (!this._traceFull) return [...this._trace];
    const out = new Array(TRACE_SAMPLES);
    const h   = this._traceHead;
    for (let i = 0; i < TRACE_SAMPLES; i++) out[i] = this._trace[(h + i) % TRACE_SAMPLES];
    return out;
  },

  // ── Copy-to-clipboard ─────────────────────────────────────────────────────
  _copyTrace() {
    const samples = this._readTrace();
    const summary = _buildTraceSummary(samples);
    const blob = {
      _meta: {
        source:     "SanctuaryFpsHud 60s pipeline trace",
        capturedAt: new Date().toISOString(),
        project:    "Sacred Adventures",
        purpose:    "Paste into Anu / AI prompt to diagnose rendering throttle",
      },
      summary,
      samples,
    };
    const text = JSON.stringify(blob, null, 2);

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        this._flashCopyBtn("✓ COPIED");
        console.info("[FpsHud] 📋 60s trace copied — %d samples, %ds window.",
          samples.length, summary.durationSec ?? 0);
      }).catch((e) => {
        console.warn("[FpsHud] Clipboard write failed:", e);
        this._flashCopyBtn("✗ FAILED");
      });
    } else {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        this._flashCopyBtn("✓ COPIED");
      } catch (_) {
        this._flashCopyBtn("✗ FAILED");
      }
    }
  },

  _flashCopyBtn(msg) {
    const btn = this._$["hud-copy-btn"];
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = msg;
    btn.style.color = msg.startsWith("✓") ? "#a5d6a7" : "#ef9a9a";
    setTimeout(() => {
      if (btn) { btn.textContent = orig; btn.style.color = "rgba(251,192,45,0.72)"; }
    }, 1800);
  },

  // ── Accordion: PIPELINE TRACE ─────────────────────────────────────────────
  _wireTraceAccordion() {
    const hud = this._el;
    if (!hud) return;
    const header   = hud.querySelector("#hud-trace-label");
    const body     = hud.querySelector("#hud-trace-body");
    const icon     = hud.querySelector("#hud-trace-icon");
    const durEl    = hud.querySelector("#hud-trace-dur");
    const copyPill = hud.querySelector("#hud-trace-copy-pill");
    if (!header || !body || !icon) return;

    const refresh = () => {
      if (body.style.display === "none") return;
      const samples = this._readTrace();
      const summary = _buildTraceSummary(samples);
      if (durEl) durEl.textContent = `${summary.durationSec ?? "--"}s`;
      const canvas = body.querySelector("#hud-trace-spark");
      if (canvas) _drawTraceSpark(canvas, samples, summary);
      const stats = body.querySelector("#hud-trace-stats");
      if (stats) stats.innerHTML = _buildTraceStatsHtml(summary, samples);
    };

    const STORAGE_KEY = "v4.hud.trace.expanded";
    const setExpanded = (open) => {
      body.style.display = open ? "block" : "none";
      icon.textContent   = open ? "▼" : "▶";
      header.setAttribute("aria-expanded", String(open));
      if (open) refresh();
      try { localStorage.setItem(STORAGE_KEY, open ? "1" : "0"); } catch (_) {}
    };

    let initial = false;
    try { initial = localStorage.getItem(STORAGE_KEY) === "1"; } catch (_) {}
    setExpanded(initial);

    const toggle = () => setExpanded(body.style.display === "none");
    header.addEventListener("click", (e) => {
      if (e.target.closest("#hud-trace-copy-pill")) return;
      toggle();
    });
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

    if (copyPill) {
      copyPill.addEventListener("click", (e) => {
        e.stopPropagation();
        this._copyTrace();
      });
    }

    // Auto-refresh every 2 s while open
    this._traceRefreshInterval = setInterval(refresh, 2000);
  },

  // ── Accordion: UNIVERSE ───────────────────────────────────────────────────
  _wireUniverseAccordion() {
    const hud = this._el;
    if (!hud) return;
    const header = hud.querySelector("#hud-universe-label");
    const body   = hud.querySelector("#hud-universe-body");
    const icon   = hud.querySelector("#hud-universe-icon");
    if (!header || !body || !icon) return;

    const STORAGE_KEY = "v4.hud.universe.expanded";
    const setExpanded = (open) => {
      body.style.display = open ? "block" : "none";
      icon.textContent   = open ? "▼" : "▶";
      header.setAttribute("aria-expanded", open ? "true" : "false");
      try { localStorage.setItem(STORAGE_KEY, open ? "1" : "0"); } catch (_) {}
    };

    let initial = false;
    try { initial = localStorage.getItem(STORAGE_KEY) === "1"; } catch (_) {}
    setExpanded(initial);

    const toggle = () => setExpanded(body.style.display === "none");
    header.addEventListener("click", toggle);
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  },

  // ── Keyboard shortcut ─────────────────────────────────────────────────────
  _onKeyDown: null,

  async load(scene, camera, renderer) {
    this._renderer = renderer ?? null;
    if (typeof document === "undefined") return;

    // ── Hide the old OrchestratorHud floating modal ───────────────────
    const hideStyle = document.createElement("style");
    hideStyle.id = "v4-hide-orchestrator-hud";
    hideStyle.textContent = "#v2-orchestrator-hud { display: none !important; }";
    document.head.appendChild(hideStyle);
    this._hideOrcHudStyle = hideStyle;

    // ── Panel root ────────────────────────────────────────────────────
    const el = document.createElement("div");
    el.id = "v4-fps-hud";
    Object.assign(el.style, {
      position:       "fixed",
      top:            "12px",
      right:          "12px",
      zIndex:         "5200",
      minWidth:       "226px",
      maxHeight:      "calc(100vh - 24px)",
      overflowX:      "hidden",
      overflowY:      "auto",
      padding:        "8px 12px 10px",
      borderRadius:   "10px",
      background:     "rgba(10, 18, 14, 0.88)",
      color:          "#e6f0d8",
      font:           "600 11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      letterSpacing:  "0.03em",
      border:         "1px solid rgba(251,192,45,0.28)",
      boxShadow:      "0 2px 12px rgba(0,0,0,0.45)",
      pointerEvents:  "none",
      userSelect:     "none",
      backdropFilter: "blur(6px)",
      transition:     "opacity 0.2s ease, visibility 0.2s ease",
      scrollbarWidth: "none",
    });

    const style = document.createElement("style");
    style.textContent = [
      `body.v4-top-down-view #v4-fps-hud { opacity: 0; visibility: hidden; }`,
      `#v4-fps-hud::-webkit-scrollbar { display: none; }`,
    ].join("\n");
    document.head.appendChild(style);

    el.innerHTML = `
      <!-- ── Header ───────────────────────────────────────────────── -->
      <div style="font-size:9px;letter-spacing:3px;color:rgba(251,192,45,0.65);
                  font-weight:800;margin-bottom:5px;padding-bottom:4px;
                  border-bottom:1px solid rgba(251,192,45,0.12);">
        ANU PIPELINE
      </div>

      <!-- FPS row -->
      ${_row("hud-r-fps",
        _lbl("FPS") + _val("hud-fps", "--", "#a5d6a7") +
        _sep() + _lbl("AVG") + _val("hud-avg") + _dim("ms") +
        _sep() + _lbl("LST") + _val("hud-last") + _dim("ms")
      )}

      <!-- ── Frame-graph equaliser ─────────────────────────────────── -->
      <div id="hud-frame-graph-wrap"
           style="position:relative;width:204px;height:42px;margin:4px 0 5px;
                  border-radius:7px;padding:3px;box-sizing:border-box;
                  background:linear-gradient(160deg,#0a0603 0%,#1a0f06 50%,#060300 100%);
                  box-shadow:inset 2px 2px 5px rgba(0,0,0,0.95),
                             inset -1px -1px 2px rgba(251,192,45,0.10),
                             0 1px 0 rgba(255,220,100,0.06),
                             0 -1px 0 rgba(0,0,0,0.6);">
        <canvas id="hud-frame-graph" width="198" height="36"
                style="display:block;width:198px;height:36px;border-radius:5px;background:transparent;"></canvas>
        <div id="hud-fg-load"
             style="position:absolute;left:8px;top:5px;font-size:9px;letter-spacing:1.4px;
                    color:rgba(255,248,220,0.92);font-weight:800;pointer-events:none;
                    text-shadow:0 1px 2px rgba(0,0,0,0.95),0 0 6px rgba(0,0,0,0.7);">
          LOAD --%
        </div>
        <div id="hud-fg-detail"
             style="position:absolute;right:8px;top:5px;font-size:8px;letter-spacing:0.6px;
                    color:rgba(255,248,220,0.62);pointer-events:none;
                    text-shadow:0 1px 2px rgba(0,0,0,0.95),0 0 4px rgba(0,0,0,0.7);">
          --/--ms
        </div>
      </div>

      <!-- UNIVERSE.ANU alert -->
      <div id="hud-anu-alert"
           title="UNIVERSE.ANU live audit — run AnuUniverse.audit() in DevTools for full findings"
           style="font-size:9px;letter-spacing:0.4px;color:rgba(165,214,167,0.55);
                  margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
                  pointer-events:auto;cursor:help;">
        UNIVERSE.ANU: warming up…
      </div>

      <!-- DRAW / TRI row -->
      ${_row("hud-r-draws",
        _lbl("DRAW") + _val("hud-draws", "--") +
        _sep() + _lbl("TRI") + _val("hud-tris", "--") + _dim("k")
      )}

      <!-- LOAD / BUDGET row -->
      ${_row("hud-r-load",
        _lbl("LOAD") + _val("hud-load") + _dim("%") +
        _sep() + _lbl("BDG") + _val("hud-budget") + _dim("ms")
      )}

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:3px 0;"></div>

      <!-- DPR / HZ / CAP -->
      ${_row("hud-r-dpr",
        _lbl("DPR") + _val("hud-dpr") + _dim("×") +
        _sep() + _lbl("HZ") + _val("hud-hz") +
        _sep() + _lbl("CAP") + _val("hud-cap") + _dim("×")
      )}

      <!-- STRESS / RELAX / STEP -->
      ${_row("hud-r-stress",
        _lbl("↓STR") + _val("hud-str") + _dim("<span id='hud-strlim'>/--</span>") +
        _sep() + _lbl("↑RLX") + _val("hud-rlx") + _dim("<span id='hud-rlxlim'>/--</span>") +
        _sep() + _lbl("STP") + _val("hud-stp")
      )}

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:3px 0;"></div>

      <!-- PiP stride / phase -->
      ${_row("hud-r-pip",
        _lbl("PiP") + _dim("×") + _val("hud-pip-str") +
        _sep() + _lbl("φ") + _val("hud-pip-phase")
      )}

      <!-- BOTTLENECK -->
      ${_row("hud-r-btl",
        _lbl("BTLNK") + _val("hud-btl-id", "none", "#a5d6a7") +
        _sep() + _val("hud-btl-sc", "")
      )}

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 0 5px;"></div>

      <!-- ── TRACE accordion ──────────────────────────────────────────── -->
      <div id="hud-trace-label" role="button" tabindex="0" aria-expanded="false"
           aria-controls="hud-trace-body"
           style="font-size:10px;letter-spacing:1.5px;color:rgba(128,222,234,0.5);
                  margin-bottom:4px;font-weight:600;cursor:pointer;
                  display:flex;align-items:center;justify-content:space-between;
                  gap:6px;user-select:none;pointer-events:auto;">
        <span>
          <span id="hud-trace-icon"
                style="display:inline-block;width:9px;transition:transform 0.15s;">▶</span>
          TRACE
          <span id="hud-trace-dur"
                style="color:#80deea;font-weight:700;letter-spacing:0;font-size:9px;opacity:0.7;">
            --s
          </span>
        </span>
        <span id="hud-trace-copy-pill"
              style="pointer-events:auto;cursor:pointer;
                     background:rgba(128,222,234,0.08);border:1px solid rgba(128,222,234,0.25);
                     border-radius:4px;padding:1px 7px;
                     font-size:8px;letter-spacing:1.5px;color:rgba(128,222,234,0.65);
                     user-select:none;">
          📋 COPY
        </span>
      </div>
      <div id="hud-trace-body" style="display:none;margin-bottom:4px;">
        <canvas id="hud-trace-spark" width="198" height="28"
                style="display:block;width:198px;height:28px;border-radius:5px;
                       background:#0a0603;margin-bottom:5px;
                       box-shadow:inset 1px 1px 4px rgba(0,0,0,0.9);"></canvas>
        <div id="hud-trace-stats"
             style="font-size:9px;color:rgba(255,255,255,0.55);line-height:1.85;
                    letter-spacing:0.3px;padding-bottom:4px;">
          loading…
        </div>
      </div>
      <div style="height:1px;background:rgba(251,192,45,0.08);margin-bottom:6px;"></div>

      <!-- ── UNIVERSE accordion ───────────────────────────────────────── -->
      <div id="hud-universe-label" role="button" tabindex="0" aria-expanded="false"
           aria-controls="hud-universe-body"
           style="font-size:10px;letter-spacing:1.5px;color:rgba(251,192,45,0.45);
                  margin-bottom:4px;font-weight:600;cursor:pointer;
                  display:flex;align-items:center;justify-content:space-between;
                  gap:6px;user-select:none;pointer-events:auto;">
        <span>
          <span id="hud-universe-icon"
                style="display:inline-block;width:9px;transition:transform 0.15s;">▶</span>
          UNIVERSE
          <span id="hud-universe-pct"
                style="color:#a5d6a7;font-weight:700;letter-spacing:0;">
            --%
          </span>
        </span>
        <span id="hud-universe-count"
              style="color:rgba(255,255,255,0.4);font-size:9px;letter-spacing:0.2px;font-weight:500;">
          0 mods
        </span>
      </div>
      <div id="hud-universe-body" style="display:none;margin-bottom:4px;">
        <div id="hud-universe-modules"
             style="font-size:10px;color:#81d4fa;line-height:1.9;">none</div>
      </div>

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 0 4px;"></div>

      <!-- ── COPY button ───────────────────────────────────────────────── -->
      <div style="display:flex;justify-content:center;margin-top:2px;">
        <button id="hud-copy-btn"
          style="pointer-events:auto;cursor:pointer;
                 background:rgba(251,192,45,0.08);border:1px solid rgba(251,192,45,0.32);
                 border-radius:5px;padding:3px 10px;
                 font:700 9px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                 letter-spacing:2px;color:rgba(251,192,45,0.72);
                 user-select:none;outline:none;
                 transition:background 0.15s;">
          📋 COPY 60s TRACE
        </button>
      </div>
    `;

    document.body.appendChild(el);
    this._el = el;

    // Cache refs once
    const ids = [
      "hud-fps", "hud-avg", "hud-last",
      "hud-frame-graph", "hud-fg-load", "hud-fg-detail",
      "hud-anu-alert",
      "hud-draws", "hud-tris",
      "hud-load", "hud-budget",
      "hud-dpr", "hud-hz", "hud-cap",
      "hud-str", "hud-strlim", "hud-rlx", "hud-rlxlim", "hud-stp",
      "hud-pip-str", "hud-pip-phase",
      "hud-btl-id", "hud-btl-sc",
      "hud-trace-dur",
      "hud-universe-pct", "hud-universe-count", "hud-universe-modules",
      "hud-copy-btn",
    ];
    const $ = {};
    for (const id of ids) $[id] = document.getElementById(id);
    this._$ = $;

    // COPY button events
    if ($["hud-copy-btn"]) {
      $["hud-copy-btn"].addEventListener("click", () => this._copyTrace());
      $["hud-copy-btn"].addEventListener("mouseover", () => {
        $["hud-copy-btn"].style.background = "rgba(251,192,45,0.18)";
      });
      $["hud-copy-btn"].addEventListener("mouseout", () => {
        $["hud-copy-btn"].style.background = "rgba(251,192,45,0.08)";
      });
    }

    // Expose trace data globally (OrchestratorHud trace accordion also reads this)
    window._v4GetPipelineTrace = () => {
      const samples = this._readTrace();
      return { samples, summary: _buildTraceSummary(samples) };
    };

    // Keyboard shortcut: Alt+Shift+C
    this._onKeyDown = (e) => {
      if (e.altKey && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        this._copyTrace();
      }
    };
    window.addEventListener("keydown", this._onKeyDown);

    // Wire accordions
    this._wireTraceAccordion();
    this._wireUniverseAccordion();

    console.log(
      "%c[Sanctuary] 📊 FPS HUD (unified ANU pipeline panel) online. Alt+Shift+C to copy.",
      "color:#a5d6a7;font-weight:bold;",
    );
  },

  update(delta) {
    this._timer += delta;
    if (this._timer < REFRESH_MS / 1000) return;
    this._timer = 0;
    const $ = this._$;
    if (!$["hud-fps"]) return;

    // ── 1. Frame budget ───────────────────────────────────────────────
    const snap    = getFrameBudgetSnapshot();
    const samples = getFrameSamples();
    const avgMs   = snap.avgMs  > 0 ? snap.avgMs  : snap.lastMs;
    const lastMs  = snap.lastMs > 0 ? snap.lastMs : snap.avgMs;
    
    let fps = 0;
    const orc = window.anuOrchestrator;
    if (orc) {
      fps = Math.round(orc._fpsReady ? orc.smoothFPS : orc.rawFPS);
    }
    if (!(fps > 0)) {
      fps = avgMs > 0 ? Math.min(999, Math.round(1000 / avgMs)) : 0;
    }
    const loadPct = snap.loadPct;

    $["hud-fps"].textContent    = fps;
    $["hud-fps"].style.color    = _fpsColor(fps);
    $["hud-fps"].style.fontSize = "14px";
    $["hud-avg"].textContent    = _ms(avgMs);
    $["hud-last"].textContent   = _ms(lastMs);

    $["hud-load"].textContent       = _pct(loadPct);
    $["hud-load"].style.color       = _loadColor(loadPct);
    $["hud-budget"].textContent     = _ms(snap.budgetMs);

    // ── 2. Frame-graph equaliser ──────────────────────────────────────
    const graphEl = $["hud-frame-graph"];
    if (graphEl && snap.budgetMs > 0) drawHudFrameGraph(graphEl, samples, snap.budgetMs);
    const loadPct2  = Math.round(loadPct);
    const graphLoad = loadPct2 < 75 ? "#a5d6a7" : loadPct2 < 105 ? "#fbc02d" : "#ef5350";
    if ($["hud-fg-load"]) {
      $["hud-fg-load"].textContent  = `LOAD ${loadPct2}%`;
      $["hud-fg-load"].style.color  = graphLoad;
    }
    if ($["hud-fg-detail"]) {
      $["hud-fg-detail"].textContent =
        `${avgMs > 0 ? avgMs.toFixed(1) : "--"}/${snap.budgetMs > 0 ? snap.budgetMs.toFixed(1) : "--"}ms`;
    }

    // ── 3. UNIVERSE.ANU alert (throttled 500 ms) ──────────────────────
    const alertEl = $["hud-anu-alert"];
    if (alertEl) {
      const nowMs = performance.now();
      if (nowMs >= this._anuAuditNextAtMs) {
        this._anuAuditNextAtMs = nowMs + 500;
        try {
          const a = window.AnuUniverse?.audit?.() ?? [];
          this._anuAuditAlerts = Array.isArray(a) ? a : [];
        } catch (_) {}
      }
      const alerts = this._anuAuditAlerts;
      if (alerts.length === 0) {
        alertEl.style.color = "rgba(165,214,167,0.55)";
        alertEl.textContent = "UNIVERSE.ANU: ✓ clear";
        alertEl.title = "UNIVERSE.ANU live audit — no findings. Run AnuUniverse.audit() in DevTools.";
      } else {
        const first = alerts[0];
        const more  = alerts.length > 1 ? `  +${alerts.length - 1}` : "";
        const sev   = first.severity === "error" ? "✗" : "⚠";
        alertEl.style.color = first.severity === "error" ? "#ef5350" : "#fbc02d";
        alertEl.textContent = `UNIVERSE.ANU ${sev} ${first.id}${more}`;
        alertEl.title = alerts
          .map((a, i) => `${i + 1}. [${a.severity}] ${a.id}\n   ${a.text}`)
          .join("\n\n");
      }
    }

    // ── 4. Draws / tris ───────────────────────────────────────────────
    if (this._renderer?.info?.render) {
      const r = this._renderer.info.render;
      if ($["hud-draws"]) $["hud-draws"].textContent = r.calls;
      if ($["hud-tris"])  $["hud-tris"].textContent  = (r.triangles / 1000).toFixed(1);
    }

    // ── 5. AdaptiveDpr snapshot ───────────────────────────────────────
    const Anu   = typeof window !== "undefined" ? window.AnuUniverse : null;
    const dprSn = Anu?.adaptiveDpr?.snapshot?.() ?? null;

    let traceDpr = null, traceStress = null, traceRelax = null, traceStep = null;
    let traceHz  = null;

    if (dprSn) {
      traceDpr    = dprSn.currentDpr;
      traceStress = dprSn.stressFrames;
      traceRelax  = dprSn.relaxFrames;
      traceStep   = dprSn.stepCount;
      traceHz     = dprSn.detectedHz;

      $["hud-dpr"].textContent = dprSn.currentDpr.toFixed(2);
      $["hud-hz"].textContent  = dprSn.detectedHz;
      $["hud-cap"].textContent = dprSn.deviceDprCap.toFixed(2);

      const stressLim = dprSn.stressFrames !== undefined
        ? Math.round(0.75 * dprSn.detectedHz) : "--";
      const relaxLim  = dprSn.relaxFrames !== undefined
        ? Math.round(2.0  * dprSn.detectedHz) : "--";

      $["hud-str"].textContent    = dprSn.stressFrames;
      $["hud-str"].style.color    = _stressColor(dprSn.stressFrames, stressLim);
      $["hud-strlim"].textContent = `/${stressLim}`;
      $["hud-rlx"].textContent    = dprSn.relaxFrames;
      $["hud-rlxlim"].textContent = `/${relaxLim}`;
      $["hud-stp"].textContent    = dprSn.stepCount;
    } else {
      const dprFallback = this._renderer?.getPixelRatio?.() ?? window.devicePixelRatio ?? 1;
      traceDpr = dprFallback;
      $["hud-dpr"].textContent = dprFallback.toFixed(2);
    }

    // ── 6. PiP rendering snapshot ─────────────────────────────────────
    const renderSn = Anu?.rendering?.getRenderingSnapshot?.() ?? null;
    let tracePipStr = null, tracePipPhase = null;
    if (renderSn) {
      tracePipStr   = renderSn.pipEffectiveStride ?? null;
      tracePipPhase = renderSn.pipPhase ?? null;
      $["hud-pip-str"].textContent   = tracePipStr   ?? "--";
      $["hud-pip-phase"].textContent = tracePipPhase ?? "--";
    }

    // ── 7. Fuzzy pipeline / bottleneck ────────────────────────────────
    let traceBtlId = null, traceBtlScore = 0;
    try {
      const fuzz = Anu?.getFuzzyPipelineSnapshot?.();
      const btl  = fuzz?.primaryBottleneck;
      if (btl && btl.id && btl.score > 0.05) {
        traceBtlId    = btl.id;
        traceBtlScore = btl.score;
        $["hud-btl-id"].textContent = btl.id;
        $["hud-btl-id"].style.color = _btlnkColor(btl.score);
        $["hud-btl-sc"].textContent = btl.score.toFixed(2);
        $["hud-btl-sc"].style.color = _btlnkColor(btl.score);
      } else {
        $["hud-btl-id"].textContent = "none";
        $["hud-btl-id"].style.color = "#a5d6a7";
        $["hud-btl-sc"].textContent = "";
      }
    } catch (_) { /* fuzzy pipeline may not be ready at boot */ }

    // ── 8. UNIVERSE governance % + module list (throttled 500 ms) ────
    const nowMs2 = performance.now();
    if (nowMs2 >= this._anuGovernanceNextAtMs) {
      this._anuGovernanceNextAtMs = nowMs2 + 500;
      const orc = (typeof window !== "undefined" ? window.anuOrchestrator : null) ?? null;

      // Governance %
      try {
        const gSnap  = getGovernanceSnapshot(orc);
        const checks = Array.isArray(gSnap?.checks) ? gSnap.checks : [];
        const total   = checks.length;
        const passing = checks.filter(c => c && c.ok === true).length;
        this._anuGovernancePct      = total > 0 ? Math.round((passing / total) * 100) : null;
        this._anuGovernancePassing  = passing;
        this._anuGovernanceTotal    = total;
      } catch (_) {}

      const pct = this._anuGovernancePct;
      if ($["hud-universe-pct"]) {
        if (pct === null || pct === undefined) {
          $["hud-universe-pct"].textContent  = "--%";
          $["hud-universe-pct"].style.color  = "rgba(255,255,255,0.4)";
        } else {
          $["hud-universe-pct"].textContent  = `${pct}%`;
          $["hud-universe-pct"].style.color  = pct >= 90 ? "#a5d6a7" : pct >= 50 ? "#fbc02d" : "#ef5350";
          $["hud-universe-pct"].title = `Anu governance: ${this._anuGovernancePassing}/${this._anuGovernanceTotal} checks healthy`;
        }
      }

      // Module list
      const modules  = orc?._activeModules ?? [];
      const registry = orc?._registry ?? null;
      if ($["hud-universe-count"]) {
        const n = modules.length;
        $["hud-universe-count"].textContent = `${n} mod${n === 1 ? "" : "s"}`;
      }
      if ($["hud-universe-modules"]) {
        if (modules.length === 0) {
          $["hud-universe-modules"].textContent = "none";
        } else {
          $["hud-universe-modules"].innerHTML = modules.map(name => {
            const entry = registry?.get(name);
            const cost  = entry && entry.fpsCost !== null
              ? ` <span style="color:#ef9a9a;">[${entry.fpsCost.toFixed(1)}fps]</span>` : "";
            const displayName = name === "Anu" ? "UNIVERSE.ANU" : name;
            return `▶ ${displayName}${cost}`;
          }).join("<br>");
        }
      }
    }

    // ── 9. Record trace sample ────────────────────────────────────────
    this._pushTrace({
      t:        Date.now(),
      fps,
      avgMs:    Number.isFinite(avgMs)      ? +avgMs.toFixed(2)      : null,
      lastMs:   Number.isFinite(lastMs)     ? +lastMs.toFixed(2)     : null,
      loadPct:  Number.isFinite(loadPct)    ? Math.round(loadPct)    : null,
      budgetMs: Number.isFinite(snap.budgetMs) ? +snap.budgetMs.toFixed(2) : null,
      dpr:      traceDpr    !== null        ? +traceDpr.toFixed(3)   : null,
      hz:       traceHz,
      stress:   traceStress,
      relax:    traceRelax,
      dprSteps: traceStep,
      pipStride:  tracePipStr,
      pipPhase:   tracePipPhase,
      btlId:      traceBtlId,
      btlScore:   traceBtlScore > 0 ? +traceBtlScore.toFixed(3) : 0,
    });
  },

  unload() {
    if (this._el?.parentElement)
      this._el.parentElement.removeChild(this._el);
    if (this._hideOrcHudStyle?.parentElement)
      this._hideOrcHudStyle.parentElement.removeChild(this._hideOrcHudStyle);
    if (this._onKeyDown)
      window.removeEventListener("keydown", this._onKeyDown);
    if (this._traceRefreshInterval)
      clearInterval(this._traceRefreshInterval);

    this._el                    = null;
    this._$                     = {};
    this._renderer              = null;
    this._trace                 = [];
    this._traceHead             = 0;
    this._traceFull             = false;
    this._onKeyDown             = null;
    this._hideOrcHudStyle       = null;
    this._traceRefreshInterval  = null;
    this._anuAuditAlerts        = [];
    this._anuGovernancePct      = null;

    if (typeof window !== "undefined") delete window._v4GetPipelineTrace;
  },
};
