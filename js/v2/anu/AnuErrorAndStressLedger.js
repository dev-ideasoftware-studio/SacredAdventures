/**
 * Central error capture + pipeline stress samples for Anu.
 * Exports JSON-friendly payloads so humans / AI coders can tune constants when stress persists.
 */

import {
  V2_FRAME_MS_BUDGET,
  V2_TARGET_FPS,
  V2_ADAPTIVE_PIP_MAX_STRIDE,
  V2_PIP_RENDER_EVERY_N_FRAMES,
} from "../constants.js";
import { getFrameBudgetSnapshot } from "./FrameBudget.js";
import { getRenderingSnapshot } from "./RenderingGovernor.js";
import { dispatchInteraction } from "./InteractionBus.js";
import { ANU_EVENTS } from "./anuEvents.js";

const MAX_ERRORS = 80;
const MAX_STRESS_TICKS = 120;
/** Record stress samples every N engine frames (bounded JSON growth). */
export const STRESS_LEDGER_SAMPLE_INTERVAL_FRAMES = 45;

const _errors = [];
const _stressTicks = [];

let _lastStressLevel = "nominal";

function _pushError(entry) {
  _errors.push(entry);
  if (_errors.length > MAX_ERRORS) _errors.shift();
}

/**
 * Runtime failure inside SacredOrchestrator._loop (game keeps running; next rAF already queued).
 */
export function recordSacredLoopError(err, context = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  const entry = {
    kind: "sacred_loop",
    at: new Date().toISOString(),
    message: e.message,
    stack: e.stack ?? null,
    ...context,
  };
  _pushError(entry);
  dispatchInteraction(ANU_EVENTS.ORCHESTRATOR_LOOP_ERROR, entry);
  console.error("%c[Anu/stress] SacredOrchestrator loop error", "color:#ef9a9a;font-weight:bold;", e);
}

/**
 * Module load() threw — registry entry must not be activated by caller.
 */
export function recordModuleLoadError(moduleName, err, context = {}) {
  const e = err instanceof Error ? err : new Error(String(err));
  const entry = {
    kind: "module_load",
    at: new Date().toISOString(),
    moduleName,
    message: e.message,
    stack: e.stack ?? null,
    ...context,
  };
  _pushError(entry);
  dispatchInteraction(ANU_EVENTS.MODULE_LOAD_ERROR, entry);
  console.error(
    `%c[Anu/stress] Module load failed: ${moduleName}`,
    "color:#ef9a9a;font-weight:bold;",
    e,
  );
}

/**
 * Sample GPU-adjacent pipeline stress (throttled by caller — e.g. every N frames).
 * @param {() => { render?: { triangles?: number; calls?: number } } | null} [rendererInfo] main WebGLRenderer.info
 */
export function tickPipelineStressLedger(rendererInfo) {
  const budget = getFrameBudgetSnapshot();
  const render = getRenderingSnapshot();
  let mainTriangles = null;
  let mainDrawCalls = null;
  try {
    const info = typeof rendererInfo === "function" ? rendererInfo() : null;
    if (info?.render) {
      mainTriangles = info.render.triangles ?? null;
      mainDrawCalls = info.render.calls ?? null;
    }
  } catch (_e) {
    /* non-fatal */
  }

  const avgMs = budget.avgMs > 0 ? budget.avgMs : budget.lastMs;
  const stressRatio =
    V2_FRAME_MS_BUDGET > 0 ? avgMs / V2_FRAME_MS_BUDGET : 1;

  let stressLevel = "nominal";
  if (stressRatio > 1.35) stressLevel = "elevated";
  if (stressRatio > 1.8 || render.pipEffectiveStride >= V2_ADAPTIVE_PIP_MAX_STRIDE) {
    stressLevel = "severe";
  }

  if (stressLevel !== _lastStressLevel) {
    _lastStressLevel = stressLevel;
    dispatchInteraction(ANU_EVENTS.PIPELINE_STRESS_LEVEL, {
      stressLevel,
      stressRatio: Math.round(stressRatio * 1000) / 1000,
      pipEffectiveStride: render.pipEffectiveStride,
    });
  }

  const tick = {
    at: new Date().toISOString(),
    frameMsLast: budget.lastMs,
    frameMsAvg: Math.round(avgMs * 1000) / 1000,
    stressRatio: Math.round(stressRatio * 1000) / 1000,
    stressLevel,
    targetFps: V2_TARGET_FPS,
    frameMsBudget: Math.round(V2_FRAME_MS_BUDGET * 1000) / 1000,
    pipBaselineFromConstants: render.pipBaseline,
    pipEffectiveStride: render.pipEffectiveStride,
    pipAdaptiveRaw: render.pipAdaptiveRaw,
    mainTriangles,
    mainDrawCalls,
  };
  _stressTicks.push(tick);
  if (_stressTicks.length > MAX_STRESS_TICKS) _stressTicks.shift();
}

/**
 * Heuristic recommendations for **source** edits (constants / hot files) when stress is sustained.
 * Does not mutate the repo — meant for copy into issues or AI prompts.
 */
export function buildAiCodingBrief() {
  const latest = _stressTicks.length > 0 ? _stressTicks[_stressTicks.length - 1] : null;
  const recommendedConstantsEdits = [];
  const recommendedCodePaths = [];

  if (latest?.stressLevel === "severe") {
    recommendedConstantsEdits.push({
      file: "js/v2/constants.js",
      symbol: "V2_PIP_RENDER_EVERY_N_FRAMES",
      suggestion:
        "Increase baseline PiP stride (e.g. 2 → 3), or set 0 to skip PiP 3D under profiling.",
      reason: "Pipeline stress classified severe (frame budget vs target).",
    });
    recommendedCodePaths.push({
      path: "js/v2/Orchestrator.js",
      hint: "Second GL pass _renderPip — verify stride via RenderingGovernor / AdaptiveRenderPolicy.",
    });
  }

  if (
    latest?.pipEffectiveStride != null &&
    latest.pipEffectiveStride >= V2_ADAPTIVE_PIP_MAX_STRIDE
  ) {
    recommendedConstantsEdits.push({
      file: "js/v2/constants.js",
      symbol: "V2_ADAPTIVE_PIP_MAX_STRIDE",
      suggestion:
        "Raise cap slightly if minimap quality collapses too often; lower TREE_TARGET / geometry first if tris huge.",
      reason: "Adaptive PiP stride is pegged at configured maximum.",
    });
    recommendedCodePaths.push({
      path: "js/v2/Flora.js",
      hint: "Instanced forest dominates triangles — see ANU_PIPELINE_MEMORY trees-instancing-tri-count.",
    });
  }

  if (latest?.mainTriangles != null && latest.mainTriangles > 2_500_000) {
    recommendedCodePaths.push({
      path: "js/v2/FloraLegacyTreeLayout.js",
      hint: `Main renderer reports ~${(latest.mainTriangles / 1e6).toFixed(2)}M tris — reduce legacy ring iterations or mesh LOD.`,
    });
  }

  if (V2_PIP_RENDER_EVERY_N_FRAMES === 1) {
    recommendedConstantsEdits.push({
      file: "js/v2/constants.js",
      symbol: "V2_PIP_RENDER_EVERY_N_FRAMES",
      suggestion: "PiP every frame doubles scene workload — use ≥ 2 or 0 for profiling.",
      reason: "Baseline stride forces maximum PiP cost.",
    });
  }

  return Object.freeze({
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    purpose:
      "Paste into LLM / issue when tuning Sacred v2 pipeline under sustained GPU or frame stress.",
    pipelineLatest: latest,
    recommendedConstantsEdits,
    recommendedCodePaths,
    recentErrors: _errors.slice(-24),
  });
}

export function exportLedgerJsonPretty() {
  return JSON.stringify(
    {
      schemaVersion: "1.0",
      exportedAt: new Date().toISOString(),
      aiBrief: buildAiCodingBrief(),
      errors: [..._errors],
      stressHistory: [..._stressTicks],
    },
    null,
    2,
  );
}

export function getLedgerSnapshot() {
  return Object.freeze({
    errors: [..._errors],
    stressHistory: [..._stressTicks],
    lastStressLevel: _lastStressLevel,
  });
}

export function clearStressLedger() {
  _errors.length = 0;
  _stressTicks.length = 0;
  _lastStressLevel = "nominal";
}
