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
      "Instanced tree.glb × TREE_TARGET can push millions of reported tris; avatar/guide layers were smaller factors.",
    mitigations: [
      "constants.js — V2_FLORA_MAX_TREE_INSTANCES (nearest-origin cap) and V2_PIP_RENDER_EVERY_N_FRAMES (PiP baseline stride).",
      "Flora.js multipart tree.glb × N — each mesh part is its own InstancedMesh; trim N before adding domains.",
      "AdaptiveRenderPolicy still widens PiP stride under sustained frame stress.",
    ],
    files: ["js/v2/Flora.js", "js/v2/FloraLegacyTreeLayout.js", "js/v2/Trees.js"],
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
    id: "anu-fuzzy-pipeline-sensor",
    learnedAt: "2026-05",
    title: "Anu exposes fuzzy bottleneck diagnosis for AI checks",
    summary:
      "AnuFuzzyPipelineSensor merges frame budget, PiP stride, scene inventory, draw-call history, module load errors, and loop errors into a ranked bottleneck list.",
    mitigations: [
      "AnuUniverse.getFuzzyPipelineSnapshot() — live object for tools",
      "AnuUniverse.exportFuzzyPipelineJson() — paste into LLM/issue",
      "AnuUniverse.report() — logs primary bottleneck with other pipeline memory",
    ],
    files: [
      "js/v2/anu/AnuFuzzyPipelineSensor.js",
      "js/v2/anu/AnuErrorAndStressLedger.js",
      "js/v2/anu/SceneModelInventory.js",
      "js/v2/AnuModule.js",
    ],
  },
  {
    id: "anu-scene-player-bus",
    learnedAt: "2026-05",
    title: "Scene inventory + player/UI interactions on Anu InteractionBus",
    summary:
      "SacredOrchestrator samples full scene drawable inventory on an interval (SceneModelInventory). World dispatches PLAYER_KEY_EDGE and PLAYER_STATE_SAMPLE; UIModule dispatches UI_PIP_VIEW_TOGGLE and existing SEASON_CHANGE — subscribe via AnuUniverse.interactions.subscribe.",
    mitigations: [
      "AnuUniverse.exportSceneInventoryJson() — full mesh list (may truncate rows)",
      "Events: PLAYER_STATE_SAMPLE (~24f), PLAYER_KEY_EDGE (edges), SCENE_INVENTORY_TICK (~120f)",
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
  {
    id: "anu-world-sensorium",
    learnedAt: "2026-05",
    title: "Anu world sensorium unifies objects, domains, interactions, and pressure",
    summary:
      "AnuWorldSensorium combines scene inventory, simulation domains, fuzzy pipeline diagnosis, active modules, and interactable metadata into one AI-readable awareness snapshot.",
    mitigations: [
      "AnuUniverse.getWorldSensoriumSnapshot() — live object/domain awareness",
      "AnuUniverse.exportWorldSensoriumJson() — paste into LLM/issue before adding flora/fauna/NPC/buildings/items",
      "Every world Object3D should set userData.anuSimulationDomain; interactables should set anuInteractable + anuInteractionVerbs.",
    ],
    files: [
      "js/v2/anu/AnuWorldSensorium.js",
      "js/v2/anu/SceneModelInventory.js",
      "js/v2/anu/SimulationController.js",
      "js/v2/AnuModule.js",
    ],
  },
  {
    id: "anu-governance-rules",
    learnedAt: "2026-05",
    title: "Anu governance rules own models, physics, and AI IO",
    summary:
      "AnuGovernanceRules makes model registration, interaction registration, 3D gravity, 3D elevation physics, and AI IO authority explicit runtime contracts.",
    mitigations: [
      "AnuUniverse.GOVERNANCE_RULES — canonical enabled rules",
      "AnuUniverse.getGovernanceSnapshot() — live compliance check",
      "WorldPhysics.getAnuPhysicsSnapshot() — gravity/elevation proof for ANU",
    ],
    files: [
      "js/v2/anu/AnuGovernanceRules.js",
      "js/v2/World.js",
      "js/v2/anu/AnuWorldSensorium.js",
      "js/v2/AnuModule.js",
    ],
  },
  {
    id: "avatar3-player-figurine",
    learnedAt: "2026-05",
    title: "Avatar3 is the governed player figurine",
    summary:
      "World installs Assets/Avatar3.glb as the player avatar, corrects its imported facing to v2 player-forward, stores all GLB animation clips, and adds a travel circle.",
    mitigations: [
      "WorldPlayer.animations — runtime list of Avatar3 clips",
      "WorldPlayer.avatar.userData.anuAnimationScan — scanned clip notes + semantic mapping",
      "ANU_EVENTS.PLAYER_AVATAR_ANIMATION — animation state changes",
      "Proximity NPC greet/orbit was removed — no automatic tipi/population coupling to player yaw",
    ],
    files: ["Assets/Avatar3.glb", "js/v2/World.js", "js/v2/anu/anuEvents.js"],
  },
  {
    id: "npc-yb-tipi1-population",
    learnedAt: "2026-05",
    title: "NPC.YB (Yellow Butterfly) seated host on tipi 1 sacred deck",
    summary:
      "WorldStructures loads Assets/NPC.YB.glb with POPULATION domain tagging, sit clip, model yaw from constants, and a gold player-style travel marker (disc + ring + facing arrow). The seated root origin is **below** the green platform deck (`deckTop + vertical_trim − seat_lower`); the marker lift must include `(seat_lower − vertical_trim) + travel_lift` so the decal draws **on** the deck, not inside the cylinder beneath it.",
    mitigations: [
      "constants.js — V2_NPC_YB_TIPI1_* including V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M",
      "WorldStructures.js — attachYellowButterflySeatedTipi1 / addGoldTravelMarkerAtFeet",
      "PiP ortho ring clip allowlist keeps tipi, platform, and YB visible under the compass disk",
    ],
    files: ["js/v2/WorldStructures.js", "js/v2/constants.js", "js/v2/anu/PipOrthoRingDiskClip.js"],
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
      "Canonical heights live in constants.js: trees scale to V2_TREE_TEMPLATE_TARGET_HEIGHT_M (11), yellow butterfly tipi to V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M (7.2), Avatar3 to V2_AVATAR_TARGET_HEIGHT_M (~0.93 m, baseline 1.78 × 0.7 × 0.75). WorldStructures loads cylinder platform radius 4.7, height 0.22, colour 0x1a2e1a, cylinder centre terrainY + 0.05 — parity with js/EnvironmentBuilder.js.",
    mitigations: [
      "js/v2/constants.js — shared tuning constants",
      "js/v2/WorldStructures.js — loadCenterTipi implementation",
      "Legacy reference — js/EnvironmentBuilder.js (yellow butterfly tipi block)",
    ],
    files: ["js/v2/constants.js", "js/v2/WorldStructures.js", "js/v2/Trees.js", "js/v2/WorldAvatar.js"],
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
  {
    id: "pip-ui-vs-webgl-scope",
    learnedAt: "2026-05",
    title: "PiP UI scope vs WebGL PiP scope — protect parent #pipCanvas",
    summary:
      "Mixing HTML/CSS dial work with the live #pipCanvas WebGL render path historically replaced the green map with a flat fill. UI changes (compass, moon dial, season hover, zoom controls, separators) belong in js/v2/UIModule.js around the canvas; render-path changes belong in SacredOrchestrator._renderPip / PipRenderStrategy / PipOrthoRingDiskClip. .cursor/rules/sacred-pip-map-protect.mdc encodes the boundary.",
    mitigations: [
      "Treat #pipCanvas as the Orchestrator WebGL target — never repurpose for 2D decoration.",
      "Bezel/compass/moon dial/zoom edits live in UIModule.js + Component.MoonDial.html, never in render-path files.",
      "If the change might touch WebGL PiP, stop and confirm in one line before editing.",
    ],
    files: [".cursor/rules/sacred-pip-map-protect.mdc", "js/v2/UIModule.js", "js/v2/Orchestrator.js", "js/v2/anu/PipRenderStrategy.js"],
  },
  {
    id: "travel-floor-decal-depth",
    learnedAt: "2026-05",
    title: "Horizontal travel decals must ignore depth on uneven terrain",
    summary:
      "The white travel ring/disc and gold NPC marker disappeared into grass micro-relief on tilted terrain because the shader materials default to depth testing. Fix is depthTest:false + depthWrite:false plus consistent renderOrder (8/9/10 disc/ring/arrow) on every horizontal floor decal.",
    mitigations: [
      "TravelFloorCircleMaterials.js — disc and ring materials disable depth.",
      "WorldAvatar.js arrow + WorldStructures.js NPC marker reuse the same depth + renderOrder policy.",
      "If a future decal should occlude, build a different material factory; do not flip the policy on the shared one.",
    ],
    files: ["js/v2/anu/TravelFloorCircleMaterials.js", "js/v2/WorldAvatar.js", "js/v2/WorldStructures.js"],
  },
  {
    id: "bush-glb-removal-discipline",
    learnedAt: "2026-05",
    title: "Remove every reference when removing a corrupt asset",
    summary:
      "A corrupt bush model under the Assets root required stripping its loader call in six files (js/EnvironmentBuilder.js, dist/js/EnvironmentBuilder.js, WORDPRESS/js/EnvironmentBuilder.js, WORDPRESS/dist/js/EnvironmentBuilder.js, WORDPRESS/js/components/WorldManager.js, and _legacy_archive/SacredGame.3f24aff.html). Loader chains that resolve via promise must still resolve so forest pipelines do not stall.",
    mitigations: [
      "Run `npm run check:assets` — STRICT failures cite file:line of every dangling reference.",
      "When deleting an asset, grep its base name across the repo before commit; do not rely on memory.",
    ],
    files: ["scripts/check-assets.mjs", "Assets/README.md"],
  },
  {
    id: "assets-gate-strict-warn",
    learnedAt: "2026-05",
    title: "Assets gate guards canonical v2 against missing or corrupt files",
    summary:
      "scripts/check-assets.mjs walks js/v2/** + index.v2.html (STRICT) and legacy/WordPress/SacredOnes.1/scratch (WARN), verifies every Assets/... reference exists, and confirms .glb files start with the glTF magic. Wired into `npm test` so CI fails on STRICT regressions before Playwright even starts.",
    mitigations: [
      "npm run check:assets — fast gate, exits 1 on STRICT failure.",
      "--strict flag promotes WARN findings to failures for full-tree audits.",
      "WARN tier surfaces ~30 legacy dangling refs as the Phase 7 reconciliation queue.",
    ],
    files: ["scripts/check-assets.mjs", "package.json", "Assets/README.md"],
  },
  {
    id: "npc-yb-tipi-scene-polish",
    learnedAt: "2026-05",
    title: "Seated NPC YB scene: model centred on disc, arrow flipped, halo + small ceremonial fire added",
    summary:
      "User-reported scene polish to the seated host at tipi 1. (1) Model X/Z centred on its bbox so she sits over the gold disc centre (the GLB pivot is internally offset). (2) Facing arrow shape Y values negated → tip now points to the OPPOSITE side of the disc, matching her seated forward direction. (3) Root Z pushed 1 ft north (V2_NPC_YB_TIPI1_LOCAL_Z_M = -0.4 - 0.3048) so a small ceremonial fire fits 1 ft south of hex centre, 1 ft above the analytic terrain, with a 6-inch flame (V2_TIPI_NPC_CEREMONIAL_FIRE_*). The new fire reuses the brazier shader via createTipiCampfire's new optional { scale, lightIntensity, lightDistance } params. (4) Soft additive Sprite halo behind her headdress (canvas radial gradient, depthTest:false, AdditiveBlending) — saintly read without a real PointLight.",
    mitigations: [
      "When adding a new GLB host, do not assume the model's internal pivot is centred — measure with Box3.getCenter and translate model.position.x/z accordingly.",
      "If a future arrow needs to flip again, prefer flipping the Shape Y values over rotating the mesh post-rotation — keeps the arrow.rotation.x = -π/2 invariant simple.",
      "createTipiCampfire's lightIntensity/lightDistance scale linearly with the proportional flicker; a smaller flame should also use a smaller PointLight range to avoid overpainting the deck.",
      "PiP ortho ring/disk clip handles Mesh/Points materials only — Sprite materials slip through. Acceptable for the small NPC halo; if a larger sprite VFX is added, extend installPointsShaderMaterialPipRingDiskClip's sibling for SpriteMaterial.",
    ],
    files: [
      "js/v2/WorldStructures.js",
      "js/v2/TipiCampfire.js",
      "js/v2/constants.js",
    ],
  },
  {
    id: "pip-user-zoom-wire-up",
    learnedAt: "2026-05",
    title: "PiP user zoom (UIModule \"+/−\") wired into the Orchestrator ortho frustum",
    summary:
      "UIModule's pip-zoom buttons dispatch CustomEvent `v2-pip-zoom-change` and persist `sacred:v2:pipZoom` to localStorage. Phase 5 adds the matching listener in SacredOrchestrator: `_pipUserZoom` is seeded from localStorage on construct, updated on each event, and combined as `V2_PIP_ORTHO_WIDTH * V2_PIP_ORTHO_ZOOM * _pipUserZoom` for both `_ensurePipPipeline` and `_resizePipIfNeeded` frustum spans. Both zero `_pipW/_pipH` after a zoom change so the ortho rebake happens on the next PiP tick. Listener torn down in dispose().",
    mitigations: [
      "UIModule clamp [0.6, 1.6] is duplicated on the orchestrator side as a defense for callers that bypass UIModule.",
      "_pipUserZoom is read from localStorage with try/catch (private mode / blocked storage) — falls back to 1.",
      "Designer constant V2_PIP_ORTHO_ZOOM stays the canonical default; user zoom multiplies it, not replaces it.",
    ],
    files: ["js/v2/Orchestrator.js", "js/v2/UIModule.js", "js/v2/constants.js"],
  },
  {
    id: "npc-arrow-decal-policy-alignment",
    learnedAt: "2026-05",
    title: "NPC YB gold travel arrow now follows the shared floor-decal depth policy",
    summary:
      "Phase 5 audit found one straggler: the NPC YB arrow in WorldStructures.js used a hand-rolled MeshBasicMaterial with polygonOffset, missing depthTest:false, and renderOrder:3 — out of step with the avatar arrow (renderOrder:10, depthTest:false, depthWrite:false). Aligned with the policy from `travel-floor-decal-depth`: drop polygonOffset, add depthTest:false, bump renderOrder to 10. Stays readable on the sacred deck and on tilted terrain alike.",
    mitigations: [
      "If a future arrow / decal genuinely should occlude, build a different material — do not flip the policy on the shared one.",
      "When adding a new floor decal, copy the avatar arrow's material recipe (depthTest+depthWrite false + renderOrder 8/9/10).",
    ],
    files: ["js/v2/WorldStructures.js", "js/v2/WorldAvatar.js", "js/v2/anu/TravelFloorCircleMaterials.js"],
  },
  {
    id: "orchestrator-pip-decomp-and-hud-line",
    learnedAt: "2026-05",
    title: "PiP render decomposed (prepare/pass/restore) + HUD pip status line",
    summary:
      "SacredOrchestrator._renderPip() previously did gating, scene mutation, branch render, and restore in one block. Phase 4 split it into _preparePipScene → _renderPipPass → _restorePipScene with a finally-guaranteed restore, and added _pipRenderedLastFrame tracked at every gate exit. The HUD now carries a #v2-pip line `PiP=on stride:N phase:M rendered:✓` (or `PiP=off`) so the second-context cost (which renderer.info does not include) is at least visible at a glance.",
    mitigations: [
      "Future PiP review only needs to read the prepare/pass/restore trio, not a 60-line monolith.",
      "HUD pip line surfaces stride/phase from RenderingGovernor.getRenderingSnapshot() — single source of truth.",
      "_pipRenderedLastFrame flag is cleared on dispose so a re-mount starts honest.",
    ],
    files: ["js/v2/Orchestrator.js", "js/v2/anu/RenderingGovernor.js"],
  },
  {
    id: "anu-api-naming-coherence",
    learnedAt: "2026-05",
    title: "AnuUniverse.report() labels match public API names; help() indexes the surface",
    summary:
      "Earlier report() output logged `Frame budget:` while the public method is AnuUniverse.budget.snapshot — confusing for tools and copy-paste debugging. report() now labels every console line with the canonical AnuUniverse.* method that produced it, and AnuUniverse.help() returns + prints the grouped supported-method index.",
    mitigations: [
      "AnuUniverse.help() — grouped index of supported methods.",
      "AnuUniverse.report() — labels each console.log with its public API name.",
    ],
    files: ["js/v2/AnuModule.js"],
  },
];

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

  // Detect surprise WebGL surfaces. Expected canvases: 1 (main) + (PiP enabled
  // ? 1 : 0) + (V2Panel/PanelsPIP active ? 1 : 0). Allow +1 slack for
  // incidental UI canvases (e.g. moon dial bezel inside the iframe).
  try {
    if (typeof document !== "undefined" && _anuOrchestratorRef) {
      const active = _anuOrchestratorRef._activeModules ?? [];
      const expected =
        1 +
        (V2_PIP_RENDER_EVERY_N_FRAMES > 0 ? 1 : 0) +
        (active.includes("PanelsPIP") || active.includes("V2Panel") ? 1 : 0);
      const actual = document.querySelectorAll("canvas").length;
      if (actual > expected + 1) {
        alerts.push({
          id: "unexpected-canvas-count",
          severity: "warn",
          text:
            `[Anu Universe] Detected ${actual} <canvas> elements in DOM; expected ~${expected} for the active module set. Extra WebGL contexts add uncredited GPU cost (HUD tri/draw counts only reflect the main renderer).`,
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
        boot: Object.freeze(["isLiveSacredOrchestratorBound", "anuOrchestrator", "version"]),
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
