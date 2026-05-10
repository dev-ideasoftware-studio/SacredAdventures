/**
 * Anu Universe — AnuModule IS the orchestrator module: the SacredOrchestrator instance
 * (renderer, scene, loop, registry) is Anu's engine shell. window.AnuUniverse exposes
 * governance (pipeline memory, rendering governor, interaction bus).
 *
 * Naming (bulletproof):
 * - Class: SacredOrchestrator (import from Orchestrator.js)
 * - Canonical live singleton: window.anuOrchestrator (same object as AnuUniverse.anuOrchestrator)
 * - Legacy alias: window.Orchestrator (same object — prefer anuOrchestrator)
 * - Discriminator on the live shell: instance.isSacredOrchestratorShell === true
 */

import { V2_PIP_RENDER_EVERY_N_FRAMES } from "./constants.js";
import {
  shouldRenderPipSceneThisFrame,
  resetPipRenderPhase,
  getRenderingSnapshot,
  MAIN_RENDERER_BLUEPRINT,
  subscribeInteraction,
  dispatchInteraction,
  getFrameBudgetSnapshot,
  getAdaptivePolicyDebug,
  buildAiCodingBrief,
  exportLedgerJsonPretty,
  getLedgerSnapshot,
  clearStressLedger,
  exportSceneInventoryJson as serializeSceneInventoryJson,
  getSceneInventorySnapshot,
  ANU_SIMULATION_DOMAIN,
  buildSimulationOverview,
  exportSimulationOverviewJson,
} from "./anu/index.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";

/** Incidents and invariants — append when the pipeline teaches something new. */
export const ANU_PIPELINE_MEMORY = [
  {
    id: "pip-second-gl-context",
    learnedAt: "2026-05",
    title: "PiP duplicates full-scene 3D pass",
    summary:
      "SacredOrchestrator._renderPip() uses a second WebGLRenderer (#pipCanvas) and renders the same THREE.Scene with an orthographic camera.",
    impact:
      "Triangle/transform cost is largely duplicated vs the main view; HUD renderer.info only reflects the main canvas.",
    mitigations: [
      "constants.js — V2_PIP_RENDER_EVERY_N_FRAMES",
      "anu/RenderingGovernor.js — shouldRenderPipSceneThisFrame()",
      "anu/AdaptiveRenderPolicy.js — raises stride under frame stress (Phase 1)",
    ],
    files: ["js/v2/Orchestrator.js", "js/v2/constants.js", "js/v2/anu/RenderingGovernor.js"],
  },
  {
    id: "hud-stats-main-only",
    learnedAt: "2026-05",
    title: "Triangle / draw counts are main renderer only",
    summary:
      "SacredOrchestrator HUD reads this.renderer.info — PiP and other WebGL contexts are not included in that line.",
    mitigations: ["When profiling GPU, assume PiP + overlay renderers add uncredited cost."],
    files: ["js/v2/Orchestrator.js"],
  },
  {
    id: "trees-instancing-tri-count",
    learnedAt: "2026-05",
    title: "Forest dominates triangle stats",
    summary:
      "Instanced tree.glb × TREE_TARGET can push millions of reported tris; avatar/guide layers were smaller factors.",
    mitigations: ["Trees.js TREE_TARGET / decimate template mesh when FPS drops."],
    files: ["js/v2/Trees.js"],
  },
  {
    id: "v2panel-three-namespace",
    learnedAt: "2026-05",
    title: "Legacy ThreeIcons must not assign onto import * as THREE",
    summary:
      "ES module namespace objects are non-extensible; expose loaders via Proxy or subclass, never THREE.GLTFLoader = …",
    mitigations: ["js/v2/V2Panel.js createThreeGlobalForLegacyIcons()"],
    files: ["js/v2/V2Panel.js", "Component.ThreeIcons.js"],
  },
  {
    id: "guides-fullscreen-webgl",
    learnedAt: "2026-05",
    title: "V2Panel / ThreeIcons adds another fullscreen WebGL layer",
    summary:
      "ThreeIconManager clears a full-size overlay canvas each frame — distinct from main + PiP.",
    mitigations: ["Activate V2Panel only when needed; pixel ratio caps in Component.ThreeIcons.js"],
    files: ["js/v2/V2Panel.js", "Component.ThreeIcons.js"],
  },
  {
    id: "anu-stress-ledger",
    learnedAt: "2026-05",
    title: "Anu stress ledger + loop errors export as JSON for tuning",
    summary:
      "SacredOrchestrator wraps the frame loop in try/catch; module updates isolated; AnuErrorAndStressLedger samples pipeline stress on an interval and buildAiCodingBrief() suggests constants edits when stress persists.",
    mitigations: [
      "AnuUniverse.exportStressJson() — paste into LLM/issue",
      "Subscribe ANU_EVENTS.PIPELINE_STRESS_LEVEL / ORCHESTRATOR_LOOP_ERROR",
    ],
    files: ["js/v2/anu/AnuErrorAndStressLedger.js", "js/v2/Orchestrator.js", "js/v2/AnuModule.js"],
  },
  {
    id: "anu-scene-player-bus",
    learnedAt: "2026-05",
    title: "Scene inventory + player/UI interactions on Anu InteractionBus",
    summary:
      "SacredOrchestrator samples full scene drawable inventory on an interval (SceneModelInventory). World dispatches PLAYER_KEY_EDGE and PLAYER_STATE_SAMPLE; UIModule dispatches UI_PIP_VIEW_TOGGLE and existing SEASON_CHANGE — subscribe via AnuUniverse.interactions.subscribe.",
    mitigations: [
      "AnuUniverse.exportSceneInventoryJson() — full mesh list (may truncate rows)",
      "Events: PLAYER_STATE_SAMPLE (~24f), PLAYER_KEY_EDGE (edges), SCENE_INVENTORY_TICK (~90f)",
    ],
    files: ["js/v2/anu/SceneModelInventory.js", "js/v2/World.js", "js/v2/UIModule.js", "js/v2/Orchestrator.js"],
  },
  {
    id: "anu-simulation-controller",
    learnedAt: "2026-05",
    title: "Anu as universe simulation controller (player / flora / fauna / structures / population)",
    summary:
      "SimulationController merges SacredOrchestrator module roster + scene inventory domain rollups (bySimulationDomain). Meshes should set userData.anuSimulationDomain + anuKind. Planned fauna/NPC/buildings dispatch FAUNA_TICK, NPC_ENTITY, STRUCTURE_EVENT.",
    mitigations: [
      "AnuUniverse.exportSimulationJson() — full simulation overview",
      "Trees / World tag meshes — SacredFlora_* flora, terrain/haze environment",
    ],
    files: ["js/v2/anu/SimulationController.js", "js/v2/Trees.js", "js/v2/World.js", "js/v2/anu/SceneModelInventory.js"],
  },
];

/** Bound SacredOrchestrator shell (window.anuOrchestrator). Cleared on unload. */
let _anuOrchestratorRef = null;

function evaluateLivePipelineRisk() {
  const alerts = [];

  if (V2_PIP_RENDER_EVERY_N_FRAMES === 1) {
    alerts.push({
      id: "pip-full-rate",
      severity: "warn",
      text:
        "[Anu Universe] PiP 3D runs every frame — duplicates full-scene GPU work (see ANU_PIPELINE_MEMORY pip-second-gl-context). Prefer V2_PIP_RENDER_EVERY_N_FRAMES ≥ 2 or 0 while profiling.",
    });
  }

  return alerts;
}

function buildPublicApi(moduleRef) {
  const api = {
    version: "2.0.0",
    memory: ANU_PIPELINE_MEMORY,
    EVENTS: ANU_EVENTS,

    audit() {
      return evaluateLivePipelineRisk();
    },

    resetAlerts() {
      moduleRef._alertedIds.clear();
    },

    report() {
      console.group("%c[Anu Universe] Pipeline memory", "color:#fbc02d;font-weight:bold;");
      console.log(`Recorded incidents: ${ANU_PIPELINE_MEMORY.length}`);
      for (const m of ANU_PIPELINE_MEMORY) {
        console.log(`— ${m.id}: ${m.title}`);
      }
      console.log("Live audit:", evaluateLivePipelineRisk());
      console.log("Rendering snapshot:", getRenderingSnapshot());
      console.log("Frame budget:", getFrameBudgetSnapshot());
      console.log("Adaptive PiP policy:", getAdaptivePolicyDebug());
      console.log(
        "Exports: exportStressJson() · exportAiStressBrief() · exportSceneInventoryJson() · exportSimulationJson()",
      );
      console.groupEnd();
    },

    /** PiP / main WebGL policy (same functions SacredOrchestrator uses). */
    rendering: Object.freeze({
      shouldRenderPipSceneThisFrame,
      resetPipRenderPhase,
      getRenderingSnapshot,
      blueprint: MAIN_RENDERER_BLUEPRINT,
    }),

    /** Cross-module signals (UI, physics hooks, orchestration). */
    interactions: Object.freeze({
      subscribe: subscribeInteraction,
      dispatch: dispatchInteraction,
    }),

    /** Live telemetry — wall-clock frame duration (SacredOrchestrator loop). */
    budget: Object.freeze({
      snapshot: getFrameBudgetSnapshot,
    }),

    /** Adaptive PiP stride under load (Phase 1). */
    adaptive: Object.freeze({
      debug: getAdaptivePolicyDebug,
    }),

    /** SacredOrchestrator loop errors + pipeline stress history — paste JSON into issues / LLMs. */
    exportStressJson() {
      return exportLedgerJsonPretty();
    },

    exportAiStressBrief() {
      return JSON.stringify(buildAiCodingBrief(), null, 2);
    },

    getStressSnapshot() {
      return getLedgerSnapshot();
    },

    clearStressHistory() {
      clearStressLedger();
    },

    /** Latest scene drawable inventory (Meshes, InstancedMesh, etc.) — refreshed on interval. */
    getSceneInventory() {
      return getSceneInventorySnapshot();
    },

    exportSceneInventoryJson() {
      return serializeSceneInventoryJson();
    },

    SIMULATION_DOMAINS: ANU_SIMULATION_DOMAIN,

    getSimulationSnapshot() {
      return buildSimulationOverview(_anuOrchestratorRef);
    },

    exportSimulationJson() {
      return exportSimulationOverviewJson(_anuOrchestratorRef);
    },

    /**
     * True when Anu is bound to the canonical live engine singleton (SacredOrchestrator shell).
     */
    isLiveSacredOrchestratorBound() {
      const ref = _anuOrchestratorRef;
      if (ref == null || ref.isSacredOrchestratorShell !== true) return false;
      if (typeof window === "undefined") return false;
      if (window.anuOrchestrator !== ref) return false;
      if (
        typeof window.Orchestrator !== "undefined" &&
        window.Orchestrator !== ref
      )
        return false;
      return true;
    },
  };

  Object.defineProperty(api, "anuOrchestrator", {
    configurable: true,
    enumerable: true,
    get() {
      return _anuOrchestratorRef;
    },
  });

  return api;
}

export const AnuModule = {
  /** Registry key; conceptually this module IS the orchestrator (see file header). */
  name: "Anu",

  _alertedIds: new Set(),

  load(_scene, _camera, _renderer, orchestrator) {
    const shell =
      orchestrator ??
      (typeof window !== "undefined" ? window.anuOrchestrator : null) ??
      (typeof window !== "undefined" ? window.Orchestrator : null);

    if (shell && shell.isSacredOrchestratorShell !== true) {
      console.warn(
        "%c[Anu Universe] Bound ref is not a SacredOrchestrator shell (expected isSacredOrchestratorShell === true).",
        "color:#ffab91;font-weight:bold;",
      );
    }

    _anuOrchestratorRef = shell;

    window.AnuUniverse = buildPublicApi(this);

    const ok =
      shell &&
      shell.isSacredOrchestratorShell === true &&
      typeof window !== "undefined" &&
      window.anuOrchestrator === shell;

    console.log(
      "%c[Anu / SacredOrchestrator] Online — " +
        (ok
          ? "AnuUniverse.anuOrchestrator === window.anuOrchestrator (verified shell)"
          : "AnuUniverse.anuOrchestrator bound — verify isLiveSacredOrchestratorBound()") +
        " · AnuUniverse.report()",
      "color:#fbc02d;font-weight:bold;",
    );

    this._emitNewAlerts(evaluateLivePipelineRisk());
  },

  update(_delta, frameCount) {
    if (frameCount % 240 !== 0) return;
    this._emitNewAlerts(evaluateLivePipelineRisk());
  },

  _emitNewAlerts(alerts) {
    for (const a of alerts) {
      if (this._alertedIds.has(a.id)) continue;
      this._alertedIds.add(a.id);
      const style =
        a.severity === "warn"
          ? "color:#ffab91;font-weight:bold;"
          : "color:#90caf9;font-weight:bold;";
      console.warn(`%c${a.text}`, style);
    }
  },

  unload() {
    clearStressLedger();
    _anuOrchestratorRef = null;
    delete window.AnuUniverse;
    this._alertedIds.clear();
    console.log("%c[Anu / SacredOrchestrator] Module unloaded.", "color:#ef9a9a;");
  },
};
