/**
 * Anu Universe — pipeline memory, rendering governor bridge, interaction bus,
 * and orchestrator attachment (central coordination surface for the living world).
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
} from "./anu/index.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";

/** Incidents and invariants — append when the pipeline teaches something new. */
export const ANU_PIPELINE_MEMORY = [
  {
    id: "pip-second-gl-context",
    learnedAt: "2026-05",
    title: "PiP duplicates full-scene 3D pass",
    summary:
      "Orchestrator._renderPip() uses a second WebGLRenderer (#pipCanvas) and renders the same THREE.Scene with an orthographic camera.",
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
      "Orchestrator HUD reads this.renderer.info — PiP and other WebGL contexts are not included in that line.",
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
];

let _attachedOrchestrator = null;

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
      console.groupEnd();
    },

    /** PiP / main WebGL policy (same functions Orchestrator uses). */
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

    attachOrchestrator(orc) {
      _attachedOrchestrator = orc ?? null;
    },

    /** Live telemetry — wall-clock frame duration (Orchestrator loop). */
    budget: Object.freeze({
      snapshot: getFrameBudgetSnapshot,
    }),

    /** Adaptive PiP stride under load (Phase 1). */
    adaptive: Object.freeze({
      debug: getAdaptivePolicyDebug,
    }),
  };

  Object.defineProperty(api, "orchestrator", {
    configurable: true,
    enumerable: true,
    get() {
      return _attachedOrchestrator;
    },
  });

  return api;
}

export const AnuModule = {
  name: "Anu",

  _alertedIds: new Set(),

  load(_scene, _camera, _renderer) {
    window.AnuUniverse = buildPublicApi(this);

    if (typeof window.Orchestrator !== "undefined") {
      window.AnuUniverse.attachOrchestrator(window.Orchestrator);
    }

    console.log(
      "%c[Anu Universe] Governance online — rendering.interactions.orchestrator · report: AnuUniverse.report()",
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
    if (window.AnuUniverse && typeof window.AnuUniverse.attachOrchestrator === "function") {
      window.AnuUniverse.attachOrchestrator(null);
    }
    delete window.AnuUniverse;
    this._alertedIds.clear();
    console.log("%c[Anu Universe] Module unloaded.", "color:#ef9a9a;");
  },
};
