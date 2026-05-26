/**
 * Sacred Adventures — SanctuaryFpsHud (unified ANU pipeline panel)
 * =================================================================
 * Single always-on fixed panel (top-right) in the FPS panel's own
 * amber/dark/monospace design. Absorbs all OrchestratorHud data so
 * the floating modal can be hidden.
 *
 * Layout (top → bottom, all using the FPS panel's own design tokens):
 *   ANU PIPELINE header
 *   FPS · AVG ms · LST ms
 *   [frame-graph 16-bar equaliser, amber-coded]
 *   UNIVERSE.ANU alert
 *   DRAW n · TRI nk
 *   LOAD % · BDG ms
 *   ─────
 *   DPR × · HZ · CAP ×
 *   ↓STR /n · ↑RLX /n · STP
 *   ─────
 *   PiP × stride · φ phase
 *   BTLNK id · score
 *   ─────
 *   ▶ TRACE NNs  [📋 COPY]   ← accordion, 60s sparkline+stats
 *   ▶ UNIVERSE NN%  N mods   ← accordion, module list
 *   ─────
 *   [📋 COPY 60s TRACE]   Alt+Shift+C
 *
 * On load:
 *   • CSS-hides  #v2-orchestrator-hud
 *   • Nulls      window.anuOrchestrator._hud  →  stops the Orchestrator
 *     from double-running its per-frame canvas/DOM updates for the now-
 *     hidden modal. The Orchestrator's own guard `if (!orc._hud) return`
 *     makes this safe. Restored on unload.
 *
 * Refresh: 250 ms.  Ring buffer: 240 samples = 60 s.
 * NOTE: zero imports from OrchestratorHud — all helpers are inline.
 */

import { getFrameBudgetSnapshot, getFrameSamples } from "../v2/anu/FrameBudget.js";
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

// ── DOM helpers (FPS panel design tokens) ────────────────────────────────────
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
function _hr() {
  return `<div style="height:1px;background:rgba(255,255,255,0.06);margin:3px 0;"></div>`;
}

// ── Frame-graph (inline — no OrchestratorHud import) ────────────────────────
/**
 * 16-bar equaliser drawn in the FPS panel's own colour palette.
 * Green < 70% budget · Amber 70–105% · Red > 105%.
 * Dashed amber line at 1× budget.
 */
function _drawGraph(canvasEl, samples, budgetMs) {
  const ctx = canvasEl.getContext("2d");
  if (!ctx || !(budgetMs > 0)) return;
  const w = canvasEl.width, h = canvasEl.height;
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, w, h);

  // Dashed budget line
  const span   = 2 * budgetMs;
  const yForMs = (ms) => h - Math.min(1, Math.max(0, ms) / span) * h;
  const yBudget = yForMs(budgetMs);
  ctx.strokeStyle = "rgba(251,192,45,0.30)";
  ctx.setLineDash([2, 3]);
  ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.moveTo(0, yBudget + 0.5); ctx.lineTo(w, yBudget + 0.5); ctx.stroke();
  ctx.setLineDash([]);

  const N   = samples.length;
  if (N === 0) return;

  const MAX_BARS = 16;
  const visible  = Math.min(N, MAX_BARS);
  const startIdx = Math.max(0, N - visible);
  const slotW    = w / MAX_BARS;
  const barW     = Math.max(2, slotW - 1.5);
  const radius   = Math.min(2, barW * 0.35);

  for (let i = 0; i < visible; i++) {
    const ms = samples[startIdx + i];
    if (!(ms > 0)) continue;
    const ratio = ms / budgetMs;
    const y    = yForMs(ms);
    const barH = h - y;
    if (barH < 1) continue;

    ctx.fillStyle = ratio < 0.7  ? "#4caf50"
                  : ratio < 1.05 ? "#fbc02d"
                  :                "#ef5350";
    const x = Math.floor(i * slotW + (slotW - barW) * 0.5);
    const bw = Math.floor(barW);
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
    // bright cap
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x, y, bw, 1);
  }
}

// ── Trace ring buffer helpers ─────────────────────────────────────────────────
function _buildTraceSummary(samples) {
  if (!samples.length) return { note: "no samples yet" };
  let minFps = Infinity, maxFps = 0, sumFps = 0;
  let minLoad = Infinity, maxLoad = 0;
  const dprEvents = [], btlnkEvents = [];
  let prevDpr = null, prevBtl = null;

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
      dprEvents.push({ t: s.t, dpr: s.dpr }); prevDpr = s.dpr;
    }
    const btlKey = s.btlId && s.btlScore > 0.05 ? s.btlId : "none";
    if (btlKey !== prevBtl) {
      btlnkEvents.push({ t: s.t, id: btlKey, score: s.btlScore }); prevBtl = btlKey;
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

// ── Trace sparkline (in panel's own palette) ─────────────────────────────────
function _drawTraceSpark(canvas, samples, summary) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(0, 0, W, H);
  if (!samples.length) return;
  const n = samples.length;
  const barW = Math.max(1, W / n);
  const steady = samples.slice(Math.min(3, n));
  const maxFps = Math.max(1, steady.reduce((m, s) => Math.max(m, s.fps || 0), 0));
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const barH = Math.round(Math.min(H, ((s.fps || 0) / maxFps) * H));
    const load = s.loadPct || 0;
    ctx.fillStyle = load > 130 ? "#ef5350" : load > 100 ? "#ff7043" : load > 85 ? "#fbc02d" : "#a5d6a7";
    ctx.fillRect(Math.floor(i * barW), H - barH, Math.max(1, Math.ceil(barW) - 1), barH);
  }
  for (const ev of (summary?.dprChanges || [])) {
    const idx = samples.findIndex(s => s.t >= ev.t);
    if (idx < 0) continue;
    const x = Math.floor(idx * barW);
    ctx.strokeStyle = "rgba(251,192,45,0.65)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
    ctx.fillStyle = "rgba(251,192,45,0.9)";
    ctx.font = "7px ui-monospace,Menlo,monospace";
    ctx.fillText(`×${ev.dpr}`, x + 2, 8);
  }
}

// ── Trace stats HTML ─────────────────────────────────────────────────────────
function _buildTraceStatsHtml(summary, samples) {
  if (!summary || !samples.length)
    return `<span style="opacity:0.4">No trace data yet — wait ~5s.</span>`;
  const hi = (v, good, warn, suf = "") => {
    const n = Number(v), s = `${n}${suf}`;
    if (n <= good) return `<b style="color:#a5d6a7">${s}</b>`;
    if (n <= warn) return `<b style="color:#fbc02d">${s}</b>`;
    return `<b style="color:#ef5350">${s}</b>`;
  };
  const steady  = samples.slice(Math.min(3, samples.length)).filter(s => s.fps > 0);
  const avgLoad = steady.length
    ? Math.round(steady.reduce((a, s) => a + (s.loadPct || 0), 0) / steady.length) : null;
  const dprStr = (summary.dprChanges || []).map(d => `×${d.dpr}`).join(" → ") || "—";
  const btlStr = (summary.bottleneckChanges || [])
    .map(b => b.id === "none" ? "·" : `<b style="color:#fff59d">${b.id}</b>`)
    .join(" → ") || "—";
  let diagColor = "#a5d6a7", diagIcon = "✓", diagMsg = "Healthy — frame budget nominal";
  if (avgLoad !== null && avgLoad > 130) {
    diagColor = "#ef5350"; diagIcon = "✗"; diagMsg = `Over budget avg ${avgLoad}%`;
  } else if (avgLoad !== null && avgLoad > 85) {
    diagColor = "#fbc02d"; diagIcon = "⚠"; diagMsg = `Watch — avg ${avgLoad}% budget`;
  } else if (avgLoad !== null) {
    diagMsg = `${avgLoad}% avg budget · DPR ×${(summary.dprChanges || []).at(-1)?.dpr ?? "?"}`;
  }
  const hasPipBtl = (summary.bottleneckChanges || []).some(b => b.id === "pip-pass");
  const pipNote = (hasPipBtl && avgLoad !== null && avgLoad < 60)
    ? `<div style="opacity:0.55;font-size:8px;margin-top:2px;">↑ pip-pass=1.0 is relative score, not abs cost</div>` : "";
  return `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:0 8px;align-items:baseline;">
      <span style="opacity:0.4;font-size:8px;letter-spacing:1px;">DUR</span><span>${summary.durationSec ?? "--"}s · ${summary.sampleCount} samples</span>
      <span style="opacity:0.4;font-size:8px;letter-spacing:1px;">FPS</span><span>${hi(summary.fps.min,60,30)} min · ${hi(summary.fps.avg,60,30)} avg · <b>${summary.fps.max}</b> peak</span>
      <span style="opacity:0.4;font-size:8px;letter-spacing:1px;">LOAD</span><span>${hi(summary.loadPct.min,85,130,"%")} → ${hi(summary.loadPct.max,85,130,"%")}</span>
      <span style="opacity:0.4;font-size:8px;letter-spacing:1px;">DPR</span><span>${dprStr}</span>
      <span style="opacity:0.4;font-size:8px;letter-spacing:1px;">BTLNK</span><span style="font-size:8.5px;">${btlStr}</span>
    </div>
    <div style="margin-top:4px;padding:2px 6px;border-radius:3px;
                background:rgba(0,0,0,0.2);border-left:2px solid ${diagColor};
                font-size:8.5px;color:${diagColor};">
      ${diagIcon} ${diagMsg}
    </div>${pipNote}`;
}

// ── Module ───────────────────────────────────────────────────────────────────
export const SanctuaryFpsHudModule = {
  name: "SanctuaryFpsHud",

  _el:              null,
  _timer:           0,
  _renderer:        null,
  _$:               {},

  // Style tag hiding the old OrchestratorHud element
  _hideOrcHudStyle: null,
  // Saved orc._hud ref so the Orchestrator stops double-updating it
  _savedOrcHudRef:  null,

  // Ring buffer
  _trace:      [],
  _traceHead:  0,
  _traceFull:  false,

  // Throttle state
  _anuAuditNextAtMs:      0,
  _anuAuditAlerts:        [],
  _anuGovernanceNextAtMs: 0,
  _anuGovernancePct:      null,
  _anuGovernancePassing:  0,
  _anuGovernanceTotal:    0,

  // Trace accordion auto-refresh
  _traceRefreshInterval: null,

  // ── Ring buffer ───────────────────────────────────────────────────────────
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

  // ── Clipboard ─────────────────────────────────────────────────────────────
  _copyTrace() {
    const samples = this._readTrace();
    const summary = _buildTraceSummary(samples);
    const text = JSON.stringify({
      _meta: { source: "SanctuaryFpsHud 60s pipeline trace",
               capturedAt: new Date().toISOString(), project: "Sacred Adventures",
               purpose: "Paste into Anu / AI prompt to diagnose rendering throttle" },
      summary, samples,
    }, null, 2);
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => { this._flashCopyBtn("✓ COPIED"); console.info("[FpsHud] 📋 60s trace copied."); })
        .catch(() => this._flashCopyBtn("✗ FAILED"));
    } else {
      try {
        const ta = document.createElement("textarea");
        ta.value = text; ta.style.cssText = "position:fixed;opacity:0;pointer-events:none;";
        document.body.appendChild(ta); ta.select(); document.execCommand("copy");
        document.body.removeChild(ta); this._flashCopyBtn("✓ COPIED");
      } catch (_) { this._flashCopyBtn("✗ FAILED"); }
    }
  },

  _flashCopyBtn(msg) {
    const btn = this._$["hud-copy-btn"];
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = msg;
    btn.style.color = msg.startsWith("✓") ? "#a5d6a7" : "#ef9a9a";
    setTimeout(() => { if (btn) { btn.textContent = orig; btn.style.color = "rgba(251,192,45,0.72)"; } }, 1800);
  },

  // ── TRACE accordion ────────────────────────────────────────────────────────
  _wireTraceAccordion() {
    const hud    = this._el;
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

    const SK = "v4.hud.trace.expanded";
    const setExpanded = (open) => {
      body.style.display = open ? "block" : "none";
      icon.textContent   = open ? "▼" : "▶";
      header.setAttribute("aria-expanded", String(open));
      if (open) refresh();
      try { localStorage.setItem(SK, open ? "1" : "0"); } catch (_) {}
    };

    let init = false;
    try { init = localStorage.getItem(SK) === "1"; } catch (_) {}
    setExpanded(init);

    const toggle = () => setExpanded(body.style.display === "none");
    header.addEventListener("click", (e) => {
      if (e.target.closest("#hud-trace-copy-pill")) return;
      toggle();
    });
    header.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    if (copyPill) {
      copyPill.addEventListener("click", (e) => { e.stopPropagation(); this._copyTrace(); });
    }
    this._traceRefreshInterval = setInterval(refresh, 2000);
  },

  // ── UNIVERSE accordion ─────────────────────────────────────────────────────
  _wireUniverseAccordion() {
    const hud = this._el;
    if (!hud) return;
    const header = hud.querySelector("#hud-universe-label");
    const body   = hud.querySelector("#hud-universe-body");
    const icon   = hud.querySelector("#hud-universe-icon");
    if (!header || !body || !icon) return;

    const SK = "v4.hud.universe.expanded";
    const setExpanded = (open) => {
      body.style.display = open ? "block" : "none";
      icon.textContent   = open ? "▼" : "▶";
      header.setAttribute("aria-expanded", open ? "true" : "false");
      try { localStorage.setItem(SK, open ? "1" : "0"); } catch (_) {}
    };

    let init = false;
    try { init = localStorage.getItem(SK) === "1"; } catch (_) {}
    setExpanded(init);

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

    // ── 1. Hide old OrchestratorHud + stop its per-frame DOM updates ───
    const hideStyle = document.createElement("style");
    hideStyle.id = "v4-hide-orchestrator-hud";
    hideStyle.textContent = "#v2-orchestrator-hud { display: none !important; }";
    document.head.appendChild(hideStyle);
    this._hideOrcHudStyle = hideStyle;

    // Null orc._hud so updateOrchestratorHudValues / drawHudFrameGraph
    // no longer run every RAF tick for a hidden element.
    const orc = (typeof window !== "undefined") ? (window.anuOrchestrator ?? null) : null;
    if (orc && orc._hud) {
      this._savedOrcHudRef = orc._hud;
      orc._hud = null;
    }

    // ── 2. Panel element ──────────────────────────────────────────────
    const el = document.createElement("div");
    el.id = "v4-fps-hud";
    Object.assign(el.style, {
      position:       "fixed",
      top:            "12px",
      right:          "12px",
      zIndex:         "5200",
      minWidth:       "226px",
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
    });

    const style = document.createElement("style");
    style.textContent = `body.v4-top-down-view #v4-fps-hud { opacity: 0; visibility: hidden; }`;
    document.head.appendChild(style);

    el.innerHTML = `
      <!-- Header -->
      <div style="font-size:9px;letter-spacing:3px;color:rgba(251,192,45,0.65);
                  font-weight:800;margin-bottom:5px;padding-bottom:4px;
                  border-bottom:1px solid rgba(251,192,45,0.12);">ANU PIPELINE</div>

      <!-- FPS / AVG / LAST -->
      ${_row("hud-r-fps",
        _lbl("FPS") + _val("hud-fps","--","#a5d6a7") +
        _sep() + _lbl("AVG") + _val("hud-avg") + _dim("ms") +
        _sep() + _lbl("LST") + _val("hud-last") + _dim("ms")
      )}

      <!-- Frame graph equaliser -->
      <div style="position:relative;margin:3px 0 4px;">
        <canvas id="hud-frame-graph" width="210" height="28"
          style="display:block;border-radius:4px;
                 background:rgba(0,0,0,0.4);
                 border:1px solid rgba(255,255,255,0.07);"></canvas>
        <div id="hud-fg-load"
          style="position:absolute;left:5px;top:2px;font-size:8px;letter-spacing:1px;
                 color:rgba(255,255,255,0.70);font-weight:800;pointer-events:none;
                 text-shadow:0 1px 3px rgba(0,0,0,0.9);">LOAD --%</div>
        <div id="hud-fg-detail"
          style="position:absolute;right:5px;top:2px;font-size:8px;
                 color:rgba(255,255,255,0.42);pointer-events:none;
                 text-shadow:0 1px 3px rgba(0,0,0,0.9);">--/--ms</div>
      </div>

      <!-- UNIVERSE.ANU alert -->
      <div id="hud-anu-alert"
        title="UNIVERSE.ANU live audit — run AnuUniverse.audit() in DevTools"
        style="font-size:9px;letter-spacing:0.4px;color:rgba(165,214,167,0.55);
               margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
               pointer-events:auto;cursor:help;">
        UNIVERSE.ANU: warming up…
      </div>

      <!-- DRAW / TRI -->
      ${_row("hud-r-draws",
        _lbl("DRAW") + _val("hud-draws","--") +
        _sep() + _lbl("TRI") + _val("hud-tris","--") + _dim("k")
      )}

      <!-- LOAD / BUDGET -->
      ${_row("hud-r-load",
        _lbl("LOAD") + _val("hud-load") + _dim("%") +
        _sep() + _lbl("BDG") + _val("hud-budget") + _dim("ms")
      )}

      ${_hr()}

      ${_row("hud-r-dpr",
        _lbl("DPR") + _val("hud-dpr") + _dim("×") +
        _sep() + _lbl("HZ") + _val("hud-hz") +
        _sep() + _lbl("CAP") + _val("hud-cap") + _dim("×")
      )}

      ${_row("hud-r-stress",
        _lbl("↓STR") + _val("hud-str") + _dim("<span id='hud-strlim'>/--</span>") +
        _sep() + _lbl("↑RLX") + _val("hud-rlx") + _dim("<span id='hud-rlxlim'>/--</span>") +
        _sep() + _lbl("STP") + _val("hud-stp")
      )}

      ${_hr()}

      ${_row("hud-r-pip",
        _lbl("PiP") + _dim("×") + _val("hud-pip-str") +
        _sep() + _lbl("φ") + _val("hud-pip-phase")
      )}

      ${_row("hud-r-btl",
        _lbl("BTLNK") + _val("hud-btl-id","none","#a5d6a7") +
        _sep() + _val("hud-btl-sc","")
      )}

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 0 5px;"></div>

      <!-- TRACE accordion -->
      <div id="hud-trace-label" role="button" tabindex="0" aria-expanded="false"
           aria-controls="hud-trace-body"
           style="font-size:9px;letter-spacing:2px;color:rgba(251,192,45,0.55);
                  margin-bottom:3px;font-weight:700;cursor:pointer;
                  display:flex;align-items:center;justify-content:space-between;
                  gap:6px;user-select:none;pointer-events:auto;">
        <span>
          <span id="hud-trace-icon" style="display:inline-block;width:9px;">▶</span>
          TRACE
          <span id="hud-trace-dur"
                style="font-weight:700;font-size:9px;opacity:0.65;letter-spacing:0;">--s</span>
        </span>
        <span id="hud-trace-copy-pill"
              style="pointer-events:auto;cursor:pointer;
                     background:rgba(251,192,45,0.08);border:1px solid rgba(251,192,45,0.25);
                     border-radius:4px;padding:1px 7px;font-size:8px;letter-spacing:1.5px;
                     color:rgba(251,192,45,0.60);user-select:none;">📋 COPY</span>
      </div>
      <div id="hud-trace-body" style="display:none;margin-bottom:5px;">
        <canvas id="hud-trace-spark" width="210" height="26"
          style="display:block;border-radius:4px;background:rgba(0,0,0,0.4);
                 border:1px solid rgba(255,255,255,0.06);margin-bottom:4px;"></canvas>
        <div id="hud-trace-stats"
          style="font-size:9px;color:rgba(255,255,255,0.55);line-height:1.85;
                 letter-spacing:0.3px;padding-bottom:2px;">loading…</div>
      </div>

      <div style="height:1px;background:rgba(251,192,45,0.08);margin-bottom:5px;"></div>

      <!-- UNIVERSE accordion -->
      <div id="hud-universe-label" role="button" tabindex="0" aria-expanded="false"
           aria-controls="hud-universe-body"
           style="font-size:9px;letter-spacing:2px;color:rgba(251,192,45,0.45);
                  margin-bottom:3px;font-weight:700;cursor:pointer;
                  display:flex;align-items:center;justify-content:space-between;
                  gap:6px;user-select:none;pointer-events:auto;">
        <span>
          <span id="hud-universe-icon" style="display:inline-block;width:9px;">▶</span>
          UNIVERSE
          <span id="hud-universe-pct"
                style="color:#a5d6a7;font-weight:700;letter-spacing:0;">--%</span>
        </span>
        <span id="hud-universe-count"
              style="color:rgba(255,255,255,0.35);font-size:9px;font-weight:500;
                     letter-spacing:0.2px;">0 mods</span>
      </div>
      <div id="hud-universe-body" style="display:none;margin-bottom:4px;">
        <div id="hud-universe-modules"
             style="font-size:10px;color:#81d4fa;line-height:1.9;">none</div>
      </div>

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 0 4px;"></div>

      <!-- COPY button -->
      <div style="display:flex;justify-content:center;margin-top:2px;">
        <button id="hud-copy-btn"
          style="pointer-events:auto;cursor:pointer;
                 background:rgba(251,192,45,0.08);border:1px solid rgba(251,192,45,0.32);
                 border-radius:5px;padding:3px 10px;
                 font:700 9px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
                 letter-spacing:2px;color:rgba(251,192,45,0.72);
                 user-select:none;outline:none;transition:background 0.15s;">
          📋 COPY 60s TRACE
        </button>
      </div>
    `;

    document.body.appendChild(el);
    this._el = el;

    // Cache element refs
    const ids = [
      "hud-fps","hud-avg","hud-last",
      "hud-frame-graph","hud-fg-load","hud-fg-detail",
      "hud-anu-alert",
      "hud-draws","hud-tris",
      "hud-load","hud-budget",
      "hud-dpr","hud-hz","hud-cap",
      "hud-str","hud-strlim","hud-rlx","hud-rlxlim","hud-stp",
      "hud-pip-str","hud-pip-phase",
      "hud-btl-id","hud-btl-sc",
      "hud-trace-dur",
      "hud-universe-pct","hud-universe-count","hud-universe-modules",
      "hud-copy-btn",
    ];
    const $ = {};
    for (const id of ids) $[id] = document.getElementById(id);
    this._$ = $;

    if ($["hud-copy-btn"]) {
      $["hud-copy-btn"].addEventListener("click", () => this._copyTrace());
      $["hud-copy-btn"].addEventListener("mouseover", () => { $["hud-copy-btn"].style.background = "rgba(251,192,45,0.18)"; });
      $["hud-copy-btn"].addEventListener("mouseout",  () => { $["hud-copy-btn"].style.background = "rgba(251,192,45,0.08)"; });
    }

    window._v4GetPipelineTrace = () => {
      const samples = this._readTrace();
      return { samples, summary: _buildTraceSummary(samples) };
    };

    this._onKeyDown = (e) => {
      if (e.altKey && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault(); this._copyTrace();
      }
    };
    window.addEventListener("keydown", this._onKeyDown);

    this._wireTraceAccordion();
    this._wireUniverseAccordion();

    console.log(
      "%c[Sanctuary] 📊 FPS HUD (unified ANU pipeline panel) online. Alt+Shift+C to copy.",
      "color:#a5d6a7;font-weight:bold;"
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
    const fps     = avgMs > 0 ? Math.min(999, Math.round(1000 / avgMs)) : 0;
    const loadPct = snap.loadPct;

    $["hud-fps"].textContent    = fps;
    $["hud-fps"].style.color    = _fpsColor(fps);
    $["hud-fps"].style.fontSize = "14px";
    $["hud-avg"].textContent    = _ms(avgMs);
    $["hud-last"].textContent   = _ms(lastMs);
    $["hud-load"].textContent   = _pct(loadPct);
    $["hud-load"].style.color   = _loadColor(loadPct);
    $["hud-budget"].textContent = _ms(snap.budgetMs);

    // ── 2. Frame graph ────────────────────────────────────────────────
    const graphEl = $["hud-frame-graph"];
    if (graphEl) _drawGraph(graphEl, samples, snap.budgetMs);
    const lp2 = Math.round(loadPct);
    const lc  = lp2 < 75 ? "#a5d6a7" : lp2 < 105 ? "#fbc02d" : "#ef5350";
    if ($["hud-fg-load"]) { $["hud-fg-load"].textContent = `LOAD ${lp2}%`; $["hud-fg-load"].style.color = lc; }
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
      } else {
        const f = alerts[0], more = alerts.length > 1 ? `  +${alerts.length - 1}` : "";
        alertEl.style.color = f.severity === "error" ? "#ef5350" : "#fbc02d";
        alertEl.textContent = `UNIVERSE.ANU ${f.severity === "error" ? "✗" : "⚠"} ${f.id}${more}`;
        alertEl.title = alerts.map((a, i) => `${i + 1}. [${a.severity}] ${a.id}\n   ${a.text}`).join("\n\n");
      }
    }

    // ── 4. Draws / tris ───────────────────────────────────────────────
    if (this._renderer?.info?.render) {
      const r = this._renderer.info.render;
      if ($["hud-draws"]) $["hud-draws"].textContent = r.calls;
      if ($["hud-tris"])  $["hud-tris"].textContent  = (r.triangles / 1000).toFixed(1);
    }

    // ── 5. AdaptiveDpr ────────────────────────────────────────────────
    const Anu   = typeof window !== "undefined" ? window.AnuUniverse : null;
    const dprSn = Anu?.adaptiveDpr?.snapshot?.() ?? null;
    let traceDpr = null, traceStress = null, traceRelax = null, traceStep = null, traceHz = null;
    if (dprSn) {
      traceDpr = dprSn.currentDpr; traceStress = dprSn.stressFrames;
      traceRelax = dprSn.relaxFrames; traceStep = dprSn.stepCount; traceHz = dprSn.detectedHz;
      $["hud-dpr"].textContent = dprSn.currentDpr.toFixed(2);
      $["hud-hz"].textContent  = dprSn.detectedHz;
      $["hud-cap"].textContent = dprSn.deviceDprCap.toFixed(2);
      const stressLim = Math.round(0.75 * dprSn.detectedHz);
      const relaxLim  = Math.round(2.0  * dprSn.detectedHz);
      $["hud-str"].textContent    = dprSn.stressFrames;
      $["hud-str"].style.color    = _stressColor(dprSn.stressFrames, stressLim);
      $["hud-strlim"].textContent = `/${stressLim}`;
      $["hud-rlx"].textContent    = dprSn.relaxFrames;
      $["hud-rlxlim"].textContent = `/${relaxLim}`;
      $["hud-stp"].textContent    = dprSn.stepCount;
    } else {
      traceDpr = this._renderer?.getPixelRatio?.() ?? window.devicePixelRatio ?? 1;
      $["hud-dpr"].textContent = traceDpr.toFixed(2);
    }

    // ── 6. PiP snapshot ───────────────────────────────────────────────
    const renderSn = Anu?.rendering?.getRenderingSnapshot?.() ?? null;
    let tracePipStr = null, tracePipPhase = null;
    if (renderSn) {
      tracePipStr   = renderSn.pipEffectiveStride ?? null;
      tracePipPhase = renderSn.pipPhase ?? null;
      $["hud-pip-str"].textContent   = tracePipStr   ?? "--";
      $["hud-pip-phase"].textContent = tracePipPhase ?? "--";
    }

    // ── 7. Bottleneck ─────────────────────────────────────────────────
    let traceBtlId = null, traceBtlScore = 0;
    try {
      const fuzz = Anu?.getFuzzyPipelineSnapshot?.();
      const btl  = fuzz?.primaryBottleneck;
      if (btl && btl.id && btl.score > 0.05) {
        traceBtlId = btl.id; traceBtlScore = btl.score;
        $["hud-btl-id"].textContent = btl.id;
        $["hud-btl-id"].style.color = _btlnkColor(btl.score);
        $["hud-btl-sc"].textContent = btl.score.toFixed(2);
        $["hud-btl-sc"].style.color = _btlnkColor(btl.score);
      } else {
        $["hud-btl-id"].textContent = "none"; $["hud-btl-id"].style.color = "#a5d6a7";
        $["hud-btl-sc"].textContent = "";
      }
    } catch (_) {}

    // ── 8. UNIVERSE governance + module list (throttled 500 ms) ──────
    const nowMs2 = performance.now();
    if (nowMs2 >= this._anuGovernanceNextAtMs) {
      this._anuGovernanceNextAtMs = nowMs2 + 500;
      const orchInst = (typeof window !== "undefined" ? window.anuOrchestrator : null) ?? null;
      try {
        const gSnap  = getGovernanceSnapshot(orchInst);
        const checks = Array.isArray(gSnap?.checks) ? gSnap.checks : [];
        const total   = checks.length;
        const passing = checks.filter(c => c?.ok === true).length;
        this._anuGovernancePct     = total > 0 ? Math.round((passing / total) * 100) : null;
        this._anuGovernancePassing = passing;
        this._anuGovernanceTotal   = total;
      } catch (_) {}

      const pct = this._anuGovernancePct;
      if ($["hud-universe-pct"]) {
        $["hud-universe-pct"].textContent = pct !== null ? `${pct}%` : "--%";
        $["hud-universe-pct"].style.color = pct === null ? "rgba(255,255,255,0.4)"
          : pct >= 90 ? "#a5d6a7" : pct >= 50 ? "#fbc02d" : "#ef5350";
      }

      const modules  = orchInst?._activeModules ?? [];
      const registry = orchInst?._registry ?? null;
      if ($["hud-universe-count"]) {
        const n = modules.length;
        $["hud-universe-count"].textContent = `${n} mod${n === 1 ? "" : "s"}`;
      }
      if ($["hud-universe-modules"]) {
        if (!modules.length) {
          $["hud-universe-modules"].textContent = "none";
        } else {
          $["hud-universe-modules"].innerHTML = modules.map(name => {
            const entry = registry?.get(name);
            const cost  = entry?.fpsCost !== null && entry?.fpsCost !== undefined
              ? ` <span style="color:#ef9a9a;">[${entry.fpsCost.toFixed(1)}fps]</span>` : "";
            return `▶ ${name === "Anu" ? "UNIVERSE.ANU" : name}${cost}`;
          }).join("<br>");
        }
      }
    }

    // ── 9. Ring buffer sample ─────────────────────────────────────────
    this._pushTrace({
      t: Date.now(), fps,
      avgMs:    Number.isFinite(avgMs)       ? +avgMs.toFixed(2)      : null,
      lastMs:   Number.isFinite(lastMs)      ? +lastMs.toFixed(2)     : null,
      loadPct:  Number.isFinite(loadPct)     ? Math.round(loadPct)    : null,
      budgetMs: Number.isFinite(snap.budgetMs) ? +snap.budgetMs.toFixed(2) : null,
      dpr:      traceDpr    !== null         ? +traceDpr.toFixed(3)   : null,
      hz: traceHz, stress: traceStress, relax: traceRelax, dprSteps: traceStep,
      pipStride: tracePipStr, pipPhase: tracePipPhase,
      btlId: traceBtlId,
      btlScore: traceBtlScore > 0 ? +traceBtlScore.toFixed(3) : 0,
    });
  },

  unload() {
    // Restore anuOrchestrator._hud so OrchestratorHud resumes if we exit
    const orc = (typeof window !== "undefined" ? window.anuOrchestrator : null) ?? null;
    if (orc && this._savedOrcHudRef) {
      orc._hud = this._savedOrcHudRef;
    }

    if (this._el?.parentElement)           this._el.parentElement.removeChild(this._el);
    if (this._hideOrcHudStyle?.parentElement)
      this._hideOrcHudStyle.parentElement.removeChild(this._hideOrcHudStyle);
    if (this._onKeyDown)                   window.removeEventListener("keydown", this._onKeyDown);
    if (this._traceRefreshInterval)        clearInterval(this._traceRefreshInterval);

    this._el                   = null;
    this._$                    = {};
    this._renderer             = null;
    this._trace                = [];
    this._traceHead            = 0;
    this._traceFull            = false;
    this._onKeyDown            = null;
    this._hideOrcHudStyle      = null;
    this._savedOrcHudRef       = null;
    this._traceRefreshInterval = null;
    this._anuAuditAlerts       = [];
    this._anuGovernancePct     = null;
    if (typeof window !== "undefined") delete window._v4GetPipelineTrace;
  },
};
