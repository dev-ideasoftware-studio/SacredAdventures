/**
 * Fuzzy bottleneck sensor for Anu.
 *
 * Converts raw frame/render/scene/error telemetry into an AI-readable diagnosis.
 * This is intentionally heuristic: it should point attention to the likely pressure
 * point without pretending one metric is the whole truth.
 */

import {
  V2_ADAPTIVE_PIP_MAX_STRIDE,
  V2_FRAME_MS_BUDGET,
  V2_PIP_RENDER_EVERY_N_FRAMES,
} from "../constants.js";
import { getFrameBudgetSnapshot } from "./FrameBudget.js";
import { getRenderingSnapshot } from "./RenderingGovernor.js";
import { getSceneInventorySnapshot } from "./SceneModelInventory.js";
import { getLedgerSnapshot } from "./AnuErrorAndStressLedger.js";

function clamp01(n) {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function scoreLevel(score) {
  if (score >= 0.72) return "severe";
  if (score >= 0.42) return "elevated";
  if (score >= 0.18) return "watch";
  return "nominal";
}

function activeModulesFrom(orchestrator) {
  return orchestrator && Array.isArray(orchestrator._activeModules)
    ? [...orchestrator._activeModules]
    : [];
}

function registeredModulesFrom(orchestrator) {
  return orchestrator && orchestrator._registry
    ? [...orchestrator._registry.keys()]
    : [];
}

function moduleCostsFrom(orchestrator) {
  if (!orchestrator?._registry) return [];
  return [...orchestrator._registry.entries()].map(([name, entry]) => ({
    name,
    active: entry.active === true,
    fpsCost: entry.fpsCost,
  }));
}

function pushCandidate(candidates, id, label, score, evidence, recommendation) {
  const s = clamp01(score);
  candidates.push({
    id,
    label,
    score: round3(s),
    level: scoreLevel(s),
    evidence,
    recommendation,
  });
}

/**
 * @param {object | null} orchestrator SacredOrchestrator instance.
 */
export function getFuzzyPipelineSnapshot(orchestrator = null) {
  const budget = getFrameBudgetSnapshot();
  const rendering = getRenderingSnapshot();
  const inventory = getSceneInventorySnapshot();
  const ledger = getLedgerSnapshot();

  const avgMs = budget.avgMs > 0 ? budget.avgMs : budget.lastMs;
  const frameRatio = V2_FRAME_MS_BUDGET > 0 ? avgMs / V2_FRAME_MS_BUDGET : 0;
  const activeModules = activeModulesFrom(orchestrator);
  const registeredModules = registeredModulesFrom(orchestrator);
  const moduleCosts = moduleCostsFrom(orchestrator);
  const benchName = orchestrator?._bench?.name ?? null;

  const sceneSummary = inventory?.summary ?? null;
  const triangles = sceneSummary?.trianglesEstimate ?? null;
  const byDomain = sceneSummary?.bySimulationDomain ?? {};
  const floraTriangles = byDomain.flora?.trianglesEstimate ?? 0;
  const drawCalls =
    ledger.stressHistory.length > 0
      ? ledger.stressHistory[ledger.stressHistory.length - 1].mainDrawCalls
      : null;

  const recentErrors = ledger.errors.slice(-12);
  const moduleLoadErrors = recentErrors.filter((e) => e.kind === "module_load");
  const loopErrors = recentErrors.filter((e) => e.kind === "sacred_loop");

  const candidates = [];

  pushCandidate(
    candidates,
    "frame-budget",
    "Main loop frame budget",
    clamp01((frameRatio - 1) / 1.2),
    {
      avgMs: round3(avgMs || 0),
      lastMs: round3(budget.lastMs || 0),
      budgetMs: round3(V2_FRAME_MS_BUDGET),
      ratio: round3(frameRatio || 0),
      samples: budget.samples,
    },
    "Profile module update cost and render passes before adding new domains.",
  );

  pushCandidate(
    candidates,
    "pip-pass",
    "Moondial PiP second scene render",
    V2_PIP_RENDER_EVERY_N_FRAMES <= 0
      ? 0
      : clamp01(
          rendering.pipEffectiveStride / V2_ADAPTIVE_PIP_MAX_STRIDE +
            (frameRatio > 1 ? 0.3 : 0),
        ),
    {
      baselineStride: rendering.pipBaseline,
      effectiveStride: rendering.pipEffectiveStride,
      adaptiveRaw: rendering.pipAdaptiveRaw,
      maxStride: V2_ADAPTIVE_PIP_MAX_STRIDE,
    },
    "If this rises with frame pressure, increase PiP stride or temporarily disable PiP 3D.",
  );

  pushCandidate(
    candidates,
    "scene-triangles",
    "Scene drawable / triangle pressure",
    triangles == null ? 0 : clamp01(triangles / 2_500_000),
    {
      trianglesEstimate: triangles,
      floraTriangles,
      drawableRows: sceneSummary?.drawableRows ?? null,
      instancedMesh: sceneSummary?.instancedMesh ?? null,
    },
    "Reduce highest-triangle domains first, especially flora/tree instances.",
  );

  pushCandidate(
    candidates,
    "draw-calls",
    "Main renderer draw-call pressure",
    drawCalls == null ? 0 : clamp01(drawCalls / 240),
    {
      mainDrawCalls: drawCalls,
    },
    "Batch or instance repeated meshes before adding new visible systems.",
  );

  pushCandidate(
    candidates,
    "module-load",
    "Module load stability",
    clamp01(moduleLoadErrors.length / 3),
    {
      recentModuleLoadErrors: moduleLoadErrors.map((e) => ({
        moduleName: e.moduleName,
        message: e.message,
      })),
    },
    "Fix module load failures first; downstream modules may never activate.",
  );

  pushCandidate(
    candidates,
    "loop-errors",
    "Runtime loop stability",
    clamp01(loopErrors.length / 5),
    {
      recentLoopErrors: loopErrors.map((e) => ({
        phase: e.phase ?? "loop",
        moduleName: e.moduleName ?? null,
        message: e.message,
      })),
    },
    "Inspect failing update phases; repeated loop errors hide real bottlenecks.",
  );

  candidates.sort((a, b) => b.score - a.score);
  const primary = candidates[0] ?? null;

  return Object.freeze({
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    purpose:
      "AI-readable fuzzy diagnosis of the current Sacred v2 pipeline bottleneck.",
    boot: Object.freeze({
      anuBound:
        orchestrator?.isSacredOrchestratorShell === true &&
        typeof window !== "undefined" &&
        window.anuOrchestrator === orchestrator,
      activeModules,
      registeredModules,
      currentBenchmark: benchName,
      moduleCosts,
    }),
    primaryBottleneck: primary,
    candidates,
    currentState: Object.freeze({
      frameBudget: budget,
      rendering,
      latestSceneInventoryAt: inventory?.at ?? null,
      latestStressLevel: ledger.lastStressLevel,
      recentErrorCount: recentErrors.length,
    }),
  });
}

export function exportFuzzyPipelineJson(orchestrator = null) {
  return JSON.stringify(getFuzzyPipelineSnapshot(orchestrator), null, 2);
}
