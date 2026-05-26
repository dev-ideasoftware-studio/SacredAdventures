/**
 * Sacred Adventures — SanctuaryFpsHud (expanded pipeline diagnostics + 60s trace copy).
 *
 * Always-on rendering pipeline panel (top-right). Shows every metric
 * Anu tracks so throttle causes are immediately visible without opening
 * DevTools:
 *
 *   Row 1  FPS (colour-coded) · avg ms · last ms
 *   Row 2  LOAD % of frame budget · budget target ms
 *   Row 3  DPR current · detected Hz · device cap
 *   Row 4  Stress streak/limit · relax streak/limit · total DPR steps
 *   Row 5  PiP render stride · PiP phase counter
 *   Row 6  Primary bottleneck ID · score (from AnuFuzzyPipeline)
 *   Row 7  [📋 COPY 60s TRACE] button — copies full diagnostic to clipboard
 *
 * All data pulled from:
 *   • FrameBudget.getFrameBudgetSnapshot()  (always available)
 *   • window.AnuUniverse.adaptiveDpr.snapshot()   (after AnuAdaptiveDpr loads)
 *   • window.AnuUniverse.rendering.getRenderingSnapshot()  (after Anu loads)
 *   • window.AnuUniverse.getFuzzyPipelineSnapshot()        (after Anu loads)
 *
 * Refresh: 250 ms (same as before — avoids flicker while staying reactive).
 *
 * COPY 60s TRACE:
 *   Maintains a 240-sample circular ring buffer (60 s at 250 ms / sample).
 *   Clicking "📋 COPY" writes a full diagnostic JSON blob to the clipboard.
 *   The blob contains:
 *     • summary  — min/max/avg FPS, DPR events, bottleneck timeline
 *     • samples  — every raw snapshot for precise per-frame analysis
 *   Paste directly into a prompt for Anu / AI diagnosis.
 *   Keyboard shortcut: Alt+Shift+C
 */

import { getFrameBudgetSnapshot } from "../v2/anu/FrameBudget.js";

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
    durationSec:      Math.round((samples[count-1].t - samples[0].t) / 1000),
    sampleCount:      count,
    fps:              { min: minFps, max: maxFps, avg: Math.round(sumFps / count) },
    loadPct:          { min: Math.round(minLoad), max: Math.round(maxLoad) },
    dprChanges:       dprEvents,
    bottleneckChanges: btlnkEvents,
  };
}

// ── Module ───────────────────────────────────────────────────────────────────
export const SanctuaryFpsHudModule = {
  name: "SanctuaryFpsHud",

  _el:       null,
  _timer:    0,
  _renderer: null,

  // Cached element refs (set once after DOM injection)
  _$: {},

  // ── 60-second ring buffer ─────────────────────────────────────────────────
  _trace:      [],   // Array<snapshot>, max TRACE_SAMPLES entries
  _traceHead:  0,    // next write index (circular)
  _traceFull:  false,

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
    // Reconstruct chronological order from circular buffer
    const out = new Array(TRACE_SAMPLES);
    const h = this._traceHead;
    for (let i = 0; i < TRACE_SAMPLES; i++) {
      out[i] = this._trace[(h + i) % TRACE_SAMPLES];
    }
    return out;
  },

  // ── Copy-to-clipboard ─────────────────────────────────────────────────────
  _copyTrace() {
    const samples  = this._readTrace();
    const summary  = _buildTraceSummary(samples);
    const blob = {
      _meta: {
        source:   "SanctuaryFpsHud 60s pipeline trace",
        capturedAt: new Date().toISOString(),
        project:  "Sacred Adventures",
        purpose:  "Paste into Anu / AI prompt to diagnose rendering throttle",
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
      // Fallback: legacy execCommand
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

  // ── Keyboard shortcut ─────────────────────────────────────────────────────
  _onKeyDown: null,

  async load(scene, camera, renderer) {
    this._renderer = renderer ?? null;
    if (typeof document === "undefined") return;

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
    });

    el.innerHTML = `
      <div style="font-size:9px;letter-spacing:3px;color:rgba(251,192,45,0.65);
                  font-weight:800;margin-bottom:5px;padding-bottom:4px;
                  border-bottom:1px solid rgba(251,192,45,0.12);">
        ANU PIPELINE
      </div>

      ${_row("hud-r-fps",
        _lbl("FPS") + _val("hud-fps","--","#a5d6a7") +
        _sep() + _lbl("AVG") + _val("hud-avg") + _dim("ms") +
        _sep() + _lbl("LST") + _val("hud-last") + _dim("ms")
      )}

      ${_row("hud-r-load",
        _lbl("LOAD") + _val("hud-load") + _dim("%") +
        _sep() + _lbl("BDG") + _val("hud-budget") + _dim("ms")
      )}

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:3px 0;"></div>

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

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:3px 0;"></div>

      ${_row("hud-r-pip",
        _lbl("PiP") + _dim("×") + _val("hud-pip-str") +
        _sep() + _lbl("φ") + _val("hud-pip-phase")
      )}

      ${_row("hud-r-btl",
        _lbl("BTLNK") + _val("hud-btl-id","none","#a5d6a7") +
        _sep() + _val("hud-btl-sc","")
      )}

      <div style="height:1px;background:rgba(255,255,255,0.06);margin:4px 0 3px;"></div>

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
      "hud-fps","hud-avg","hud-last",
      "hud-load","hud-budget",
      "hud-dpr","hud-hz","hud-cap",
      "hud-str","hud-strlim","hud-rlx","hud-rlxlim","hud-stp",
      "hud-pip-str","hud-pip-phase",
      "hud-btl-id","hud-btl-sc",
      "hud-copy-btn",
    ];
    const $ = {};
    for (const id of ids) $[id] = document.getElementById(id);
    this._$ = $;

    // Button click
    if ($["hud-copy-btn"]) {
      $["hud-copy-btn"].addEventListener("click", () => this._copyTrace());
      $["hud-copy-btn"].addEventListener("mouseover", () => {
        $["hud-copy-btn"].style.background = "rgba(251,192,45,0.18)";
      });
      $["hud-copy-btn"].addEventListener("mouseout", () => {
        $["hud-copy-btn"].style.background = "rgba(251,192,45,0.08)";
      });
    }

    // Keyboard shortcut: Alt+Shift+C
    this._onKeyDown = (e) => {
      if (e.altKey && e.shiftKey && (e.key === "c" || e.key === "C")) {
        e.preventDefault();
        this._copyTrace();
      }
    };
    window.addEventListener("keydown", this._onKeyDown);

    console.log(
      "%c[Sanctuary] 📊 FPS HUD (expanded pipeline diagnostics + 60s trace copy) online. Alt+Shift+C to copy.",
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
    const avgMs   = snap.avgMs  > 0 ? snap.avgMs  : snap.lastMs;
    const lastMs  = snap.lastMs > 0 ? snap.lastMs : snap.avgMs;
    const fps     = avgMs > 0 ? Math.min(999, Math.round(1000 / avgMs)) : 0;
    const loadPct = snap.loadPct;

    $["hud-fps"].textContent  = fps;
    $["hud-fps"].style.color  = _fpsColor(fps);
    $["hud-fps"].style.fontSize = "14px";
    $["hud-avg"].textContent  = _ms(avgMs);
    $["hud-last"].textContent = _ms(lastMs);

    $["hud-load"].textContent = _pct(loadPct);
    $["hud-load"].style.color = _loadColor(loadPct);
    $["hud-budget"].textContent = _ms(snap.budgetMs);

    // ── 2. AdaptiveDpr snapshot ───────────────────────────────────────
    const Anu   = typeof window !== "undefined" ? window.AnuUniverse : null;
    const dprSn = Anu?.adaptiveDpr?.snapshot?.() ?? null;

    let traceDpr = null, traceStress = null, traceRelax = null, traceStep = null;
    let traceHz = null;

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

      $["hud-str"].textContent  = dprSn.stressFrames;
      $["hud-str"].style.color  = _stressColor(dprSn.stressFrames, stressLim);
      $["hud-strlim"].textContent = `/${stressLim}`;
      $["hud-rlx"].textContent  = dprSn.relaxFrames;
      $["hud-rlxlim"].textContent = `/${relaxLim}`;
      $["hud-stp"].textContent  = dprSn.stepCount;
    } else {
      const dprFallback =
        this._renderer?.getPixelRatio?.() ?? window.devicePixelRatio ?? 1;
      traceDpr = dprFallback;
      $["hud-dpr"].textContent = dprFallback.toFixed(2);
    }

    // ── 3. PiP rendering snapshot ─────────────────────────────────────
    const renderSn = Anu?.rendering?.getRenderingSnapshot?.() ?? null;
    let tracePipStr = null, tracePipPhase = null;
    if (renderSn) {
      tracePipStr   = renderSn.pipEffectiveStride ?? null;
      tracePipPhase = renderSn.pipPhase ?? null;
      $["hud-pip-str"].textContent   = tracePipStr   ?? "--";
      $["hud-pip-phase"].textContent = tracePipPhase ?? "--";
    }

    // ── 4. Fuzzy pipeline / bottleneck ────────────────────────────────
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

    // ── 5. Record trace sample ────────────────────────────────────────
    this._pushTrace({
      t:          Date.now(),
      fps:        fps,
      avgMs:      Number.isFinite(avgMs)   ? +avgMs.toFixed(2)   : null,
      lastMs:     Number.isFinite(lastMs)  ? +lastMs.toFixed(2)  : null,
      loadPct:    Number.isFinite(loadPct) ? Math.round(loadPct) : null,
      budgetMs:   Number.isFinite(snap.budgetMs) ? +snap.budgetMs.toFixed(2) : null,
      dpr:        traceDpr    !== null ? +traceDpr.toFixed(3)    : null,
      hz:         traceHz,
      stress:     traceStress,
      relax:      traceRelax,
      dprSteps:   traceStep,
      pipStride:  tracePipStr,
      pipPhase:   tracePipPhase,
      btlId:      traceBtlId,
      btlScore:   traceBtlScore > 0 ? +traceBtlScore.toFixed(3) : 0,
    });
  },

  unload() {
    if (this._el?.parentElement) this._el.parentElement.removeChild(this._el);
    if (this._onKeyDown) window.removeEventListener("keydown", this._onKeyDown);
    this._el       = null;
    this._$        = {};
    this._renderer = null;
    this._trace    = [];
    this._traceHead = 0;
    this._traceFull = false;
    this._onKeyDown = null;
  },
};
