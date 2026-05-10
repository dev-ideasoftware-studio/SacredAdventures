/**
 * Sacred Universe — UniverseModule is the orchestrator “coordinator” plugin: the SacredOrchestrator
 * instance (renderer, scene, loop, registry) is the engine shell. `window.Universe` exposes
 * governance (pipeline memory, rendering governor, interaction bus).
 *
 * Naming:
 * - Class: SacredOrchestrator (Orchestrator.js)
 * - Live singleton: window.anuOrchestrator (= Universe.anuOrchestrator getter)
 * - Legacy: window.Orchestrator — same shell
 * - Discriminator: instance.isSacredOrchestratorShell === true
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
} from "./RuntimeServices.js";

/** Incidents and invariants — append when the pipeline teaches something new. */
export const ANU_PIPELINE_MEMORY = [
  {
    id: "pip-second-gl-context",
    learnedAt: "2026-05",
    title: "PiP second WebGL pass (ortho map vs persp spirit)",
    summary:
      "SacredOrchestrator._renderPip() uses a second WebGLRenderer on #pipCanvas and renders the same THREE.Scene when V2_PIP_RENDER_EVERY_N_FRAMES > 0. When the main canvas is FPV, PiP uses an orthographic top-down camera; when the main canvas is map view, PiP uses a short perspective “spirit” camera. Cadence follows RenderingGovernor / frame stride.",
    impact:
      "Triangle/transform cost is largely duplicated vs the main view when PiP renders; HUD renderer.info only reflects the main canvas.",
    mitigations: [
      "constants.js — V2_PIP_RENDER_EVERY_N_FRAMES (0 skips PiP)",
      "anu/RenderingGovernor.js — shouldRenderPipSceneThisFrame()",
      "anu/AdaptiveRenderPolicy.js — raises stride under frame stress",
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
      "Instanced tree.glb × dense legacy forest (~260 slots + dirt meshes + multi-part instances) can push millions of reported tris; avatar/guide layers were smaller factors.",
    mitigations: [
      "FloraLegacyTreeLayout.js ring counts / Flora.js dirt draw budget / decimate template mesh when FPS drops.",
    ],
    files: ["js/v2/Flora.js"],
  },
  {
    id: "v2-bush-module-retired",
    learnedAt: "2026-05",
    title: "Standalone BushModule removed from v2 boot",
    summary:
      "A trial BushModule instanced `Assets/bush.glb` for ground cover but the asset barely read on ortho PiP minimap and cost disproportionate GPU (dense BLEND foliage). v2 no longer registers or activates Bush; legacy `js/EnvironmentBuilder.js` may still author bush clusters for other entry points.",
    mitigations: [
      "Reintroduce ground cover only with minimap-visible LOD or cheaper mesh (e.g. alpha-test billboards), not raw full-scene instancing blindly.",
    ],
    files: ["index.v2.html", "js/v2/constants.js"],
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
      "Universe.exportStressJson() — paste into LLM/issue",
      "Subscribe ANU_EVENTS.PIPELINE_STRESS_LEVEL / ORCHESTRATOR_LOOP_ERROR",
    ],
    files: ["js/v2/anu/AnuErrorAndStressLedger.js", "js/v2/Orchestrator.js", "js/v2/UniverseModule.js"],
  },
  {
    id: "anu-fuzzy-pipeline-sensor",
    learnedAt: "2026-05",
    title: "Anu exposes fuzzy bottleneck diagnosis for AI checks",
    summary:
      "AnuFuzzyPipelineSensor merges frame budget, PiP stride, scene inventory, draw-call history, module load errors, and loop errors into a ranked bottleneck list.",
    mitigations: [
      "Universe.getFuzzyPipelineSnapshot() — live object for tools",
      "Universe.exportFuzzyPipelineJson() — paste into LLM/issue",
      "Universe.report() — logs primary bottleneck with other pipeline memory",
    ],
    files: [
      "js/v2/anu/AnuFuzzyPipelineSensor.js",
      "js/v2/anu/AnuErrorAndStressLedger.js",
      "js/v2/anu/SceneModelInventory.js",
      "js/v2/UniverseModule.js",
    ],
  },
  {
    id: "anu-scene-player-bus",
    learnedAt: "2026-05",
    title: "Scene inventory + player/UI interactions on Anu InteractionBus",
    summary:
      "SacredOrchestrator samples full scene drawable inventory on an interval (SceneModelInventory). World dispatches PLAYER_KEY_EDGE and PLAYER_STATE_SAMPLE; UIModule dispatches UI_PIP_VIEW_TOGGLE and existing SEASON_CHANGE — subscribe via Universe.interactions.subscribe.",
    mitigations: [
      "Universe.exportSceneInventoryJson() — full mesh list (may truncate rows)",
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
      "Universe.exportSimulationJson() — full simulation overview",
      "Flora / World tag meshes — SacredFlora_* flora, terrain/haze environment",
    ],
    files: ["js/v2/anu/SimulationController.js", "js/v2/Flora.js", "js/v2/World.js", "js/v2/anu/SceneModelInventory.js"],
  },
  {
    id: "anu-world-sensorium",
    learnedAt: "2026-05",
    title: "Anu world sensorium unifies objects, domains, interactions, and pressure",
    summary:
      "AnuWorldSensorium combines scene inventory, simulation domains, fuzzy pipeline diagnosis, active modules, and interactable metadata into one AI-readable awareness snapshot.",
    mitigations: [
      "Universe.getWorldSensoriumSnapshot() — live object/domain awareness",
      "Universe.exportWorldSensoriumJson() — paste into LLM/issue before adding flora/fauna/NPC/buildings/items",
      "Every world Object3D should set userData.anuSimulationDomain; interactables should set anuInteractable + anuInteractionVerbs.",
    ],
    files: [
      "js/v2/anu/AnuWorldSensorium.js",
      "js/v2/anu/SceneModelInventory.js",
      "js/v2/anu/SimulationController.js",
      "js/v2/UniverseModule.js",
    ],
  },
  {
    id: "anu-governance-rules",
    learnedAt: "2026-05",
    title: "Anu governance rules own models, physics, and AI IO",
    summary:
      "AnuGovernanceRules makes model registration, interaction registration, 3D gravity, 3D elevation physics, and AI IO authority explicit runtime contracts.",
    mitigations: [
      "Universe.GOVERNANCE_RULES — canonical enabled rules",
      "Universe.getGovernanceSnapshot() — live compliance check",
      "WorldPhysics.getAnuPhysicsSnapshot() — gravity/elevation proof for ANU",
    ],
    files: [
      "js/v2/anu/AnuGovernanceRules.js",
      "js/v2/World.js",
      "js/v2/anu/AnuWorldSensorium.js",
      "js/v2/UniverseModule.js",
    ],
  },
  {
    id: "avatar3-player-figurine",
    learnedAt: "2026-05",
    title: "Avatar3 is the governed player figurine",
    summary:
      "World installs Assets/Avatar3.glb as the player avatar, corrects its imported facing to v2 player-forward, stores all GLB animation clips, adds a travel circle, and routes avatar/NPC greeting events through ANU.",
    mitigations: [
      "WorldPlayer.animations — runtime list of Avatar3 clips",
      "WorldPlayer.avatar.userData.anuAnimationScan — scanned clip notes + semantic mapping",
      "ANU_EVENTS.PLAYER_AVATAR_ANIMATION — animation state changes",
      "ANU_EVENTS.PLAYER_NPC_GREETING — hello/goodbye proximity rule for population models",
    ],
    files: ["Assets/Avatar3.glb", "js/v2/World.js", "js/v2/anu/anuEvents.js"],
  },
  {
    id: "world-collision-autowalk",
    learnedAt: "2026-05",
    title: "WorldPhysics owns colliders and autowalk avoidance",
    summary:
      "WorldPhysics now exposes circular obstacle colliders, body collision resolution, and steerAroundObstacles() so player, NPC, and wildlife locomotion can share the same avoidance rules. Tipi models are explicitly passable.",
    mitigations: [
      "WorldPhysics.js — add solid/passable circular XZ colliders for scene objects",
      "WorldPhysics.steerAroundObstacles() — reusable avoidance hook before assigning NPC/wildlife/player velocity",
      "WorldPlayerController.js — long-hold movement key state for player autowalk",
    ],
    files: ["js/v2/World.js", "js/v2/WorldPhysics.js", "js/v2/WorldPlayerController.js"],
  },
  {
    id: "tipi-sacred-platform-legacy-parity",
    learnedAt: "2026-05",
    title: "Tipi + sacred green platform match legacy EnvironmentBuilder",
    summary:
      "Canonical heights live in constants.js: trees use legacy per-slot `(8..16)×scale / templateY` EnvironmentBuilder sizing (design reference constant V2_TREE_TEMPLATE_TARGET_HEIGHT_M = 11 m), yellow butterfly tipi V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M (7.2), Avatar3 V2_AVATAR_TARGET_HEIGHT_M (~0.93 m, baseline 1.78 × 0.7 × 0.75). WorldStructures loads cylinder platform radius 4.7, height 0.22, colour 0x1a2e1a, cylinder centre terrainY + 0.05 — parity with js/EnvironmentBuilder.js.",
    mitigations: [
      "js/v2/constants.js — shared tuning constants",
      "js/v2/WorldStructures.js — loadCenterTipi implementation",
      "Legacy reference — js/EnvironmentBuilder.js (yellow butterfly tipi block)",
    ],
    files: ["js/v2/constants.js", "js/v2/WorldStructures.js", "js/v2/Flora.js", "js/v2/WorldAvatar.js"],
  },
  {
    id: "avatar-crossfade-play-order",
    learnedAt: "2026-05",
    title: "Animation crossFadeFrom requires incoming action to be playing first",
    summary:
      "THREE.AnimationAction.crossFadeFrom schedules fadeIn on the incoming clip. Calling crossFadeTo before play() leaves mixer weights wrong and can strand limbs (e.g. one leg frozen during walk).",
    mitigations: [
      "WorldAvatar.play — next.play() then next.crossFadeFrom(prev) (Three.js executeCrossFade pattern).",
    ],
    files: ["js/v2/WorldAvatar.js"],
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
        "[Universe] PiP cadence is every frame. With V2_PIP_RENDER_EVERY_N_FRAMES === 1, the second WebGL pass on #pipCanvas doubles scene work when PiP renders; prefer ≥ 2 or 0 while profiling.",
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
      console.group("%c[Universe] Pipeline memory", "color:#fbc02d;font-weight:bold;");
      console.log(`Recorded incidents: ${ANU_PIPELINE_MEMORY.length}`);
      for (const m of ANU_PIPELINE_MEMORY) {
        console.log(`— ${m.id}: ${m.title}`);
      }
      console.log("Live audit:", evaluateLivePipelineRisk());
      console.log("Rendering snapshot:", getRenderingSnapshot());
      console.log("Frame budget:", getFrameBudgetSnapshot());
      console.log("Adaptive PiP policy:", getAdaptivePolicyDebug());
      console.log("Runtime services:", getRuntimeServicesSnapshot());
      console.log(
        "Runtime service contracts:",
        validateRuntimeServiceContracts(_anuOrchestratorRef?._activeModules ?? []),
      );
      console.log("Governance:", buildGovernanceSnapshot(_anuOrchestratorRef));
      console.log("Fuzzy bottleneck sensor:", buildFuzzyPipelineSnapshot(_anuOrchestratorRef));
      console.log("World sensorium:", buildWorldSensoriumSnapshot(_anuOrchestratorRef));
      console.log(
        "Exports: exportStressJson() · exportAiStressBrief() · exportGovernanceJson() · exportFuzzyPipelineJson() · exportWorldSensoriumJson() · exportSceneInventoryJson() · exportSimulationJson()",
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

    getRuntimeServicesSnapshot,

    validateRuntimeServiceContracts() {
      return validateRuntimeServiceContracts(_anuOrchestratorRef?._activeModules ?? []);
    },

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
     * True when Universe is bound to the canonical live SacredOrchestrator shell.
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

export const UniverseModule = {
  /** Registry key — coordinator plugin that installs `window.Universe`. */
  name: "Universe",

  _alertedIds: new Set(),

  load(_scene, _camera, _renderer, orchestrator) {
    const shell =
      orchestrator ??
      (typeof window !== "undefined" ? window.anuOrchestrator : null) ??
      (typeof window !== "undefined" ? window.Orchestrator : null);

    if (shell && shell.isSacredOrchestratorShell !== true) {
      console.warn(
        "%c[Universe] Bound ref is not a SacredOrchestrator shell (expected isSacredOrchestratorShell === true).",
        "color:#ffab91;font-weight:bold;",
      );
    }

    _anuOrchestratorRef = shell;

    window.Universe = buildPublicApi(this);

    const ok =
      shell &&
      shell.isSacredOrchestratorShell === true &&
      typeof window !== "undefined" &&
      window.anuOrchestrator === shell;

    console.log(
      "%c[Universe / SacredOrchestrator] Online — " +
        (ok
          ? "Universe.anuOrchestrator === window.anuOrchestrator (verified shell)"
          : "Universe.anuOrchestrator bound — verify isLiveSacredOrchestratorBound()") +
        " · Universe.report()",
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
    delete window.Universe;
    this._alertedIds.clear();
    console.log("%c[Universe / SacredOrchestrator] Module unloaded.", "color:#ef9a9a;");
  },
};
