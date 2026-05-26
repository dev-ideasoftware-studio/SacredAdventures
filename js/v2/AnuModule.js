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
 *
 * Product (governance label): The Empathy Engine v1.0a — see ANU_EMPATHY_ENGINE_NAME
 * and the `empathy-engine-product-name` pipeline memory card.
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
  ANU_INTERACTION_VERB,
  buildSimulationOverview,
  exportSimulationOverviewJson,
  getFuzzyPipelineSnapshot as buildFuzzyPipelineSnapshot,
  exportFuzzyPipelineJson as serializeFuzzyPipelineJson,
  getWorldSensoriumSnapshot as buildWorldSensoriumSnapshot,
  exportWorldSensoriumJson as serializeWorldSensoriumJson,
  ANU_GOVERNANCE_RULES,
  getGovernanceSnapshot as buildGovernanceSnapshot,
  exportGovernanceJson as serializeGovernanceJson,
} from "./anu/index.js";
import { ANU_EVENTS } from "./anu/anuEvents.js";
import {
  getRuntimeServicesSnapshot,
  validateRuntimeServiceContracts,
  RUNTIME_SERVICE_CONTRACTS,
} from "./RuntimeServices.js";

/** Canonical human-facing name for this governed shell (Anu + Sacred v2). */
export const ANU_EMPATHY_ENGINE_NAME = "The Empathy Engine v1.0a";

// ANU_PIPELINE_MEMORY now lives in ./anu/pipelineMemory.js so this file can
// stay about coordination instead of carrying ~970 lines of incident cards.
// Re-exported here so existing import paths (e.g. js/v2/UniverseModule.js)
// keep working unchanged.
import { ANU_PIPELINE_MEMORY } from "./anu/pipelineMemory.js";
export { ANU_PIPELINE_MEMORY };

/** Bound SacredOrchestrator shell (window.anuOrchestrator). Cleared on unload. */
let _anuOrchestratorRef = null;

/** Stateful streaks for sustained-pressure alerts; only the periodic update path bumps these. */
const _streaks = {
  triPressure: 0,
};

const _SUSTAINED_TRI_PRIMARY_THRESHOLD = 3; // 240-frame samples (~12 s @ 60 fps)
const _SUSTAINED_TRI_SCORE_FLOOR = 0.6;

/**
 * Live audit of the Sacred v2 pipeline. Returns a deduplicated array of
 * `{ id, severity, text }` alerts. Every check is defensive — a snapshot
 * failure must never escape this function.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.fromUpdate=false]  When true, the periodic update
 *   loop is calling this; sustained-pressure streak counters are advanced.
 *   Manual calls (`AnuUniverse.audit()`, `report()`) leave streak state alone.
 */
function evaluateLivePipelineRisk(opts = {}) {
  const alerts = [];

  if (V2_PIP_RENDER_EVERY_N_FRAMES === 1) {
    alerts.push({
      id: "pip-full-rate",
      severity: "warn",
      text:
        "[Anu Universe] PiP cadence is every frame. With V2_PIP_RENDER_EVERY_N_FRAMES === 1, the second WebGL pass on #pipCanvas doubles scene work when PiP renders; prefer ≥ 2 or 0 while profiling.",
    });
  }

  // World module active but the WorldPlayer service has not registered — PiP
  // render path silently no-ops every frame in this state, so it deserves a
  // dedicated alert (and not a fuzzy bottleneck candidate).
  try {
    if (V2_PIP_RENDER_EVERY_N_FRAMES > 0 && _anuOrchestratorRef) {
      const active = _anuOrchestratorRef._activeModules ?? [];
      const services = getRuntimeServicesSnapshot().names;
      if (active.includes("World") && !services.includes("WorldPlayer")) {
        alerts.push({
          id: "pip-without-world-player",
          severity: "warn",
          text:
            "[Anu Universe] World module is active but WorldPlayer service is not registered. PiP renderer will no-op each frame; suspect a regression in World.load() service registration.",
        });
      }
    }
  } catch (_) {
    /* defensive — never let the audit throw */
  }

  // V2Panel icon renderer must be Tier-B (lite). If someone replaces the
  // subclass with a raw `new window.ThreeIconManager()` they re-introduce
  // the 60Hz full-window clear loop the team documented as a real FPS
  // regression in ANU_PIPELINE_MEMORY entry `v2-hud-icon-tier-b`.
  try {
    if (typeof window !== "undefined" && _anuOrchestratorRef) {
      const active = _anuOrchestratorRef._activeModules ?? [];
      if (active.includes("V2Panel") && window.icons) {
        const stride = window.icons._liteStride;
        const maxPixelRatio = window.icons._liteMaxPixelRatio;
        const visibleOnlyUpdates = window.icons._liteVisibleOnlyUpdates === true;
        const hasHardPause = typeof window.icons.setGuideIconsActive === "function";
        if (
          !Number.isFinite(stride) ||
          stride < 2 ||
          !Number.isFinite(maxPixelRatio) ||
          maxPixelRatio > 2.25 ||
          !visibleOnlyUpdates ||
          !hasHardPause
        ) {
          alerts.push({
            id: "v2-hud-icon-tier-b-regression",
            severity: "warn",
            text:
              "[Anu Universe] V2Panel is active but window.icons is not the Tier-B/C guide renderer (requires _liteStride ≥ 2, _liteMaxPixelRatio ≤ 2.25, visible-only cached updates, and setGuideIconsActive hard pause). This risks re-introducing the legacy 60Hz full-window-clear/update loop documented in `v2-hud-icon-tier-b`. Restore createV2IconRendererLite() in V2Panel._bootThreeIcons.",
          });
        }
      }
    }
  } catch (_) {
    /* defensive */
  }

  // Detect surprise WebGL surfaces. The expected canvas count is the sum
  // of every module that owns a canvas (NOT a single OR'd term — each
  // module adds independently):
  //
  //   1 main game canvas (`#v2-canvas` from index.v2.html)
  // + 2 engine HUD canvases (`#v2-frame-graph` and `#v2-trace-spark`) — created
  //   when the Orchestrator starts and attaches the HUD.
  // + PanelsPIP (the moondial PiP UIModule) contributes TWO canvases:
  //     - `#pipCanvas` — the second WebGL pass, gated by
  //       `V2_PIP_RENDER_EVERY_N_FRAMES > 0`.
  //     - `#pipOverlay` — a 2D moondial bezel overlay, present whenever
  //       PanelsPIP is loaded regardless of PiP cadence.
  // + V2Panel contributes TWO canvases when the HUD is active:
  //     - Tier-B icon renderer full-window WebGL (scissored clear; see
  //       ANU_PIPELINE_MEMORY entry `v2-hud-icon-tier-b`).
  //     - `#v2-avatar-hud-canvas` — small WebGL preview of Avatar3, synced
  //       from the world figurine mixer (render throttled ~30 Hz).
  //
  // The +1 slack absorbs incidental UI canvases (e.g. canvases inside
  // iframes, or temporary canvases from screenshot/forensic tooling).
  try {
    if (typeof document !== "undefined" && _anuOrchestratorRef) {
      const active = _anuOrchestratorRef._activeModules ?? [];
      const hasHud = _anuOrchestratorRef._hud ? 2 : 0;
      const expected =
        1 +
        hasHud +
        (active.includes("PanelsPIP")
          ? (V2_PIP_RENDER_EVERY_N_FRAMES > 0 ? 2 : 1)
          : 0) +
        (active.includes("V2Panel") ? 2 : 0);
      const actual = document.querySelectorAll("canvas").length;
      if (actual > expected + 1) {
        alerts.push({
          id: "unexpected-canvas-count",
          severity: "warn",
          text:
            `[Anu Universe] Detected ${actual} <canvas> elements in DOM; expected ~${expected} for the active module set (Anu=${active.includes("Anu")}, PanelsPIP=${active.includes("PanelsPIP")}, V2Panel=${active.includes("V2Panel")}, PiPstride=${V2_PIP_RENDER_EVERY_N_FRAMES}). Extra WebGL contexts add uncredited GPU cost (HUD tri/draw counts only reflect the main renderer).`,
        });
      }
    }
  } catch (_) {
    /* defensive */
  }

  // Sustained triangle pressure: only the periodic update path adjusts the
  // streak; any caller that finds streak ≥ N surfaces the alert so manual
  // audit() / report() runs see consistent state.
  if (opts.fromUpdate === true) {
    try {
      const fuzzy = buildFuzzyPipelineSnapshot(_anuOrchestratorRef);
      const primary = fuzzy?.primaryBottleneck ?? null;
      if (
        primary &&
        primary.id === "scene-triangles" &&
        (primary.score ?? 0) >= _SUSTAINED_TRI_SCORE_FLOOR
      ) {
        _streaks.triPressure++;
      } else {
        _streaks.triPressure = 0;
      }
    } catch (_) {
      /* defensive */
    }
  }
  if (_streaks.triPressure >= _SUSTAINED_TRI_PRIMARY_THRESHOLD) {
    alerts.push({
      id: "sustained-triangle-pressure",
      severity: "warn",
      text:
        `[Anu Universe] Triangle pressure has been the primary fuzzy bottleneck for ${_streaks.triPressure} consecutive 240-frame samples. Reduce flora/tree instance counts (V2_FLORA_MAX_TREE_INSTANCES) or domain density before adding more.`,
    });
  }

  return alerts;
}

function buildPublicApi(moduleRef) {
  const api = {
    version: "2.0.0",
    engineName: ANU_EMPATHY_ENGINE_NAME,
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
      console.log(`${ANU_EMPATHY_ENGINE_NAME} · AnuUniverse.version ${api.version}`);
      console.log(`Recorded incidents: ${ANU_PIPELINE_MEMORY.length}`);
      for (const m of ANU_PIPELINE_MEMORY) {
        console.log(`— ${m.id}: ${m.title}`);
      }
      // Labels are the canonical AnuUniverse.* method that produced each line —
      // makes copy-paste debugging and tooling unambiguous (Phase 2 ergonomics fix).
      console.log("AnuUniverse.audit():", evaluateLivePipelineRisk());
      console.log("AnuUniverse.rendering.getRenderingSnapshot():", getRenderingSnapshot());
      console.log("AnuUniverse.budget.snapshot():", getFrameBudgetSnapshot());
      console.log("AnuUniverse.adaptive.debug():", getAdaptivePolicyDebug());
      console.log("AnuUniverse.getRuntimeServicesSnapshot():", getRuntimeServicesSnapshot());
      console.log(
        "AnuUniverse.validateRuntimeServiceContracts():",
        validateRuntimeServiceContracts(_anuOrchestratorRef?._activeModules ?? []),
      );
      console.log("AnuUniverse.getGovernanceSnapshot():", buildGovernanceSnapshot(_anuOrchestratorRef));
      console.log("AnuUniverse.getFuzzyPipelineSnapshot():", buildFuzzyPipelineSnapshot(_anuOrchestratorRef));
      console.log("AnuUniverse.getWorldSensoriumSnapshot():", buildWorldSensoriumSnapshot(_anuOrchestratorRef));
      console.log("Run AnuUniverse.help() for the full method index.");
      console.groupEnd();
    },

    /**
     * Grouped index of supported AnuUniverse methods. Returns a frozen object
     * AND prints a friendly summary so docs and code agree on names.
     */
    help() {
      const index = Object.freeze({
        boot: Object.freeze([
          "isLiveSacredOrchestratorBound",
          "anuOrchestrator",
          "version",
          "engineName",
        ]),
        audit: Object.freeze(["audit", "report", "resetAlerts", "memory", "EVENTS"]),
        rendering: Object.freeze([
          "rendering.getRenderingSnapshot",
          "rendering.shouldRenderPipSceneThisFrame",
          "rendering.resetPipRenderPhase",
          "rendering.blueprint",
          "adaptive.debug",
        ]),
        budget: Object.freeze(["budget.snapshot"]),
        services: Object.freeze([
          "services.list",
          "services.validate",
          "services.contracts",
          "getRuntimeServicesSnapshot",
          "validateRuntimeServiceContracts",
        ]),
        governance: Object.freeze([
          "getGovernanceSnapshot",
          "exportGovernanceJson",
          "GOVERNANCE_RULES",
        ]),
        sensorium: Object.freeze([
          "getWorldSensoriumSnapshot",
          "exportWorldSensoriumJson",
        ]),
        simulation: Object.freeze([
          "getSimulationSnapshot",
          "exportSimulationJson",
          "SIMULATION_DOMAINS",
          "INTERACTION_VERBS",
        ]),
        scene: Object.freeze(["getSceneInventory", "exportSceneInventoryJson"]),
        fuzzy: Object.freeze(["getFuzzyPipelineSnapshot", "exportFuzzyPipelineJson"]),
        stress: Object.freeze([
          "getStressSnapshot",
          "exportStressJson",
          "exportAiStressBrief",
          "clearStressHistory",
        ]),
        interactions: Object.freeze(["interactions.subscribe", "interactions.dispatch"]),
        help: Object.freeze(["help"]),
      });
      console.group(
        "%c[Anu Universe] help() — supported API surface",
        "color:#fbc02d;font-weight:bold;",
      );
      for (const [group, methods] of Object.entries(index)) {
        console.log(`${group}:  ${methods.join(",  ")}`);
      }
      console.groupEnd();
      return index;
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

    getRuntimeServicesSnapshot,

    validateRuntimeServiceContracts() {
      return validateRuntimeServiceContracts(_anuOrchestratorRef?._activeModules ?? []);
    },

    /**
     * Read-only view of the runtime service registry: contracts table,
     * current registrations, and live validation result. Phase 3 ergonomics —
     * makes the registry inspectable from a single AnuUniverse.services.* path.
     */
    services: Object.freeze({
      contracts: RUNTIME_SERVICE_CONTRACTS,
      list() {
        return getRuntimeServicesSnapshot();
      },
      validate() {
        return validateRuntimeServiceContracts(_anuOrchestratorRef?._activeModules ?? []);
      },
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

    /**
     * AI-readable fuzzy bottleneck sensor — rank likely pressure points at check time.
     */
    getFuzzyPipelineSnapshot() {
      const snapshot = buildFuzzyPipelineSnapshot(_anuOrchestratorRef);
      dispatchInteraction(ANU_EVENTS.FUZZY_PIPELINE_SENSOR, snapshot);
      return snapshot;
    },

    exportFuzzyPipelineJson() {
      const snapshot = buildFuzzyPipelineSnapshot(_anuOrchestratorRef);
      dispatchInteraction(ANU_EVENTS.FUZZY_PIPELINE_SENSOR, snapshot);
      return serializeFuzzyPipelineJson(_anuOrchestratorRef);
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
    INTERACTION_VERBS: ANU_INTERACTION_VERB,
    GOVERNANCE_RULES: ANU_GOVERNANCE_RULES,

    getGovernanceSnapshot() {
      const snapshot = buildGovernanceSnapshot(_anuOrchestratorRef);
      dispatchInteraction(ANU_EVENTS.GOVERNANCE_SNAPSHOT, snapshot);
      return snapshot;
    },

    exportGovernanceJson() {
      const snapshot = buildGovernanceSnapshot(_anuOrchestratorRef);
      dispatchInteraction(ANU_EVENTS.GOVERNANCE_SNAPSHOT, snapshot);
      return serializeGovernanceJson(_anuOrchestratorRef);
    },

    getSimulationSnapshot() {
      return buildSimulationOverview(_anuOrchestratorRef);
    },

    exportSimulationJson() {
      return exportSimulationOverviewJson(_anuOrchestratorRef);
    },

    getWorldSensoriumSnapshot() {
      const snapshot = buildWorldSensoriumSnapshot(_anuOrchestratorRef);
      dispatchInteraction(ANU_EVENTS.WORLD_SENSORIUM, snapshot);
      return snapshot;
    },

    exportWorldSensoriumJson() {
      const snapshot = buildWorldSensoriumSnapshot(_anuOrchestratorRef);
      dispatchInteraction(ANU_EVENTS.WORLD_SENSORIUM, snapshot);
      return serializeWorldSensoriumJson(_anuOrchestratorRef);
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
        ANU_EMPATHY_ENGINE_NAME +
        " — " +
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
    this._emitNewAlerts(evaluateLivePipelineRisk({ fromUpdate: true }));
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
    _streaks.triPressure = 0;
    console.log("%c[Anu / SacredOrchestrator] Module unloaded.", "color:#ef9a9a;");
  },
};
