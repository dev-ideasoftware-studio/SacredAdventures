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
      "WorldPhysics now exposes circular obstacle colliders, body collision resolution, and steerAroundObstacles() so player, NPC, and wildlife locomotion can share the same avoidance rules. Tipi models are explicitly passable. Player **long-hold autowalk** (WorldPlayerController.syncAutowalkFromHeldKeys) is additionally suppressed inside **one tile** of either tipi centre in World.js — clears `_autoWalk` if already active and blocks both arming (3 s hold) and the drift branch while near — so autowalk never stomps through NPC greet poses at tipi 1 or tipi 2.",
    mitigations: [
      "WorldPhysics.js — add solid/passable circular XZ colliders for scene objects",
      "WorldPhysics.steerAroundObstacles() — reusable avoidance hook before assigning NPC/wildlife/player velocity",
      "WorldPlayerController.js — long-hold movement key state for player autowalk",
      "World.js — tipi proximity gate: `min(distXZ(player, origin), distXZ(player, (V2_TIPI_2_CENTER_X_M,0))) < V2_TILE_WORLD` suppresses autowalk (clears active flag + skips sync + skips drift dir). Tipi centres are world-space constants matching WorldStructures placement.",
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
    id: "moondial-compass-and-glass",
    learnedAt: "2026-05",
    title: "Moondial compass formula + PiP crystal-dome glass (legacy 1:1, extended to moonphase rim)",
    summary:
      "Two related UIModule fixes for the moondial bezel, scoped strictly to js/v2/UIModule.js (no PiP WebGL or render-strategy edits). (1) Compass: _syncCompass(yaw) now rotates the ring by `180 - yawDeg` instead of `yawDeg`. The earlier formula painted the dial 180° upside-down at spawn because v2 spawn yaw is π (player facing +Z = north toward tipi 1), not 0. Verified for all four cardinals: yaw=π → N at top, yaw=0 → S at top, yaw=π/2 → W at top, yaw=-π/2 → E at top. (2) Crystal-dome glass: .pip-optics-stack mask was tightened from a clamp around 14% inset to `calc(100% - var(--pip-moon-track))` so the glass surface now reaches the **inner edge of the moonphase track** (where the lunar ring meets the WebGL hole). .pip-optics-glaze is the legacy Component.MoonDial #pip-lens::after formula reproduced 1:1: highlight `ellipse 92% 74% at 34% 26% → rgba(255,255,255,0.22)`, dark seat `circle at 50% 88% → rgba(0,15,30,0.18)`, `mix-blend-mode: soft-light`, opacity 0.88. .pip-optics-shade keeps the top inset rim highlight but the bottom inset shadow was pulled from 40px / 0.20 to 28px / 0.14 so the moonphase ring at the rim no longer reads as dimmed under the glass. .lunar-phase-slot dropped its 0.82 opacity + heavy drop-shadow filter — moon glyphs are now crisp on top of the dome.",
    mitigations: [
      "Layering invariant: .pip-optics-stack is z:1, .lunar-radial-ring (moon phase slots) is z:7, compass-outer-ring is z:6, pip-lens-legacy is z:4, pipOverlay is z:3, pipCanvas is z:0. The glass NEVER overlays the moonphases because of this z-order — if a future contributor raises optics-stack above z:6, the moons will start reading as fuzzed again. Don't raise it.",
      "Compass formula is `180 - yawDeg` (mod 360). Do not 'fix' to plain `-yawDeg` or `yawDeg` — both give wrong results at the current spawn (yaw=π). The constant comes from the marker positions (N=0°, E=90°, S=180°, W=270° CW from top) plus v2's world yaw convention (yaw=0 ⇒ facing -Z).",
      "If the v2 spawn yaw changes, the compass still self-corrects — the formula derives ring rotation from the live yaw, no per-spawn baked constant. If world-yaw convention itself flips (e.g. switch to right-hand from-above CW), update the formula derivation in the JSDoc and re-verify all four cardinals.",
      "The crystal-dome mask boundary is var(--pip-moon-track) (default 22px). If a future redesign moves the moonphase track inward, change the CSS var only — both the lunar-radial-ring's own mask AND the optics-stack mask key off the same variable so they stay aligned.",
      "Glass formulas are the legacy iframe (Component.MoonDial.html) 1:1 — DO NOT just bump intensities to 'more glassy'. The legacy was tuned at those exact numbers (highlight 0.22, dark anchor 0.18, blend soft-light, opacity 0.88) — they're the canonical look the user explicitly asked for.",
      "Moon-glyph crispness was the user-visible cost of the previous 0.82 opacity + drop-shadow blur halo. If you re-add a glow effect (e.g. for active phase), use box-shadow / filter only on the .active-phase / :hover states — do NOT apply a default filter to .lunar-phase-slot itself.",
      "This card lives alongside `pip-ui-vs-webgl-scope` — together they form the scope boundary for moondial work. Future moondial tweaks (bezel material, additional rings, animated indicator pointer) belong in UIModule.js + this card; render-path changes do not.",
    ],
    files: [
      "js/v2/UIModule.js",
      "Component.MoonDial.html",
      ".cursor/rules/sacred-pip-map-protect.mdc",
    ],
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
    id: "legacy-tree-reconciliation",
    learnedAt: "2026-05",
    title: "Legacy / WordPress drift policy — keep / freeze / sunset matrix",
    summary:
      "Phase 7 of the 78→100 program. The repo holds parallel trees that pre-date js/v2/ (the canonical engine). docs/legacy-reconciliation.md is the source of truth: js/v2/ KEEP-canonical; WORDPRESS/ KEEP-FROZEN production bundle; dist/ KEEP-artifact; js/ (non-v2) FROZEN reference; _legacy_archive/ SUNSET read-only; scratch/ SUNSET deletable; SacredOnes.1/ KEEP sibling exploration. The asset gate already encodes the same tier split (STRICT vs WARN). When porting behaviour from legacy, re-implement inside js/v2/, add a fidelity test, leave the legacy file untouched.",
    mitigations: [
      "Before editing anything outside js/v2/, read docs/legacy-reconciliation.md and confirm the tree's status.",
      "Do NOT 'mirror' v2 changes into WORDPRESS/ unless the user explicitly asks for a deploy update — the WP bundle is independent.",
      "If a WARN-tier asset reference becomes a real WP runtime blocker, promote to a focused fix on the WP page only — never a sweep across legacy code.",
      "Future legacy ports follow the 5-step protocol in docs/legacy-reconciliation.md (read → re-implement in v2 → add test → ANU card → leave legacy alone).",
    ],
    files: [
      "docs/legacy-reconciliation.md",
      "scripts/check-assets.mjs",
      "js/v2",
    ],
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
  {
    id: "phase-9-final-integration",
    learnedAt: "2026-05",
    title: "Phase 9 — 78→100 program close: rubric reassessment, baseline/v1, HUD label = UNIVERSE",
    summary:
      "Closing phase of the 78→100 program. Full suite green: 4/4 smoke + 4/4 fidelity in 36.8 s on Apple Silicon. Asset gate clean (6/6 STRICT pass; 31 WARN are policy-accepted per docs/legacy-reconciliation.md). Audit replay confirmed: evaluateLivePipelineRisk shape unchanged since Phase 2, none of the 27 ANU_PIPELINE_MEMORY incidents re-introduced. Score reassessment landed at 94/100 (rubric) — 8 of 10 dimensions in Excellent / World-class, no dimension below 85, hard floors held (Dim 3 ≥ 80 ✓, Dim 10 ≥ 80 ✓). Two laggards (Dim 5 Completeness 85, Dim 1 Architecture 94) have explicit out-of-scope follow-ups in docs/baselines/2026-05-10-final.md. One small UX touch: HUD modal label `ACTIVE MODULES` → `UNIVERSE` per user request — generally readable to non-developers while still pointing at the AnuUniverse module registry.",
    mitigations: [
      "Future work to push 94 → 100 has a written list in docs/baselines/2026-05-10-final.md §What's next (split Orchestrator.js, activate Fauna, HUD visual sentinel, boot help() print, quarantine SUNSET trees).",
      "When re-running the rubric, follow docs/SCORECARD.md §Capture protocol exactly — copy outputs from AnuUniverse.audit / report / budget / services / help into the next-dated baseline file.",
      "The HUD label is intentionally `UNIVERSE` not `ACTIVE MODULES`. Don't 'fix' it back — the underlying registry is still the AnuUniverse active-module list, the label is just user-facing.",
      "git tag baseline/v1 marks this snapshot; baseline/v0 is the pre-program reference. Never force-move either tag.",
    ],
    files: [
      "docs/baselines/2026-05-10-final.md",
      "docs/SCORECARD.md",
      "js/v2/Orchestrator.js",
    ],
  },
  {
    id: "fauna-pillar-rabbit-warren",
    learnedAt: "2026-05",
    title: "Fauna pillar — rabbit family burrow v3 (simple real hole + motion-gated animation, relocated)",
    summary:
      "js/v2/Fauna.js spawns a five-member rabbit family (dad 1.5× mom, mom, three babies with distinct coats) around a **minimal burrow** — no raised mound, no pebble/grass props. **Location**: the empty tile **directly right of tipi 1** — WARREN_X = V2_TILE_WORLD ≈ 10.86 m, WARREN_Z = 0 — between tipi 1 (origin) and tipi 2 (V2_TILE_WORLD*2). Inside the V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M=12.5 m exclusion so no tree will plant on the ring. **Warren pieces** (`buildWarren()`): (a) disturbed-earth **RingGeometry** flush with the grass (inner radius ≈ throat top, outer ≈ 1.05 m) — reads as kicked-up dirt without a second 'saucer' mesh sitting on the terrain; (b) tapering open throat (top 0.38 → bottom 0.22 m, 0.95 m deep) with baked vertex-colour gradient rim soil (0x3a2316) → pure black on `MeshBasicMaterial({ vertexColors, side: BackSide, toneMapped: false })` so only the interior walls are visible and tone-mapping doesn't lift the black; (c) inner **CircleGeometry** cap with radial vertex colours so a straight-down camera stays black; (d) small underground `BackSide` sphere pocket for AI / introspection. **Spawn**: rabbits boot in a **tight 0.55–0.87 m** radius around the burrow lip (not 1.6–2.0 m away) so they're obviously in-frame next to the hole. All rabbits share one rigged GLB (Assets/rabbit.animated.glb, single hop loop) cloned per-instance with material clones so per-rabbit tints don't bleed. **Animation gate**: action is created + scheduled (`action.play()`) at load but starts `paused = true`; `_updateRabbitMotion` flips `paused` based on whether the rabbit is in a locomoting state (HOP / CHASE_SIBLING / FLEE / FOLLOW_MOM) — and bumps `timeScale` (CHASE 1.3×, FLEE 1.6×). Idle / graze / look / peek / emerge / hide all sit in the bind pose. Behaviour FSM and proximity tuning unchanged.",
    mitigations: [
      "**Vertex-colour gradient gotcha**: the throat must be a `MeshBasicMaterial` (not Standard/Physical) because tone mapping + a soft light bath were lifting pure-black vertex colours into a perceptible dark-brown. `toneMapped: false` and a Basic material guarantee the rim→black falloff renders as intended. If you switch to a lit material to add shadowing, replicate this with a custom shader; do not just turn off tone mapping on a lit material.",
      "**Throat is BackSide-only** so the player can never see the cylinder's outer wall from above; the disturbed-earth ring hides the outer seam at the lip. Don't switch to DoubleSide or you'll see the cylinder showing through the ring when the sun is low.",
      "**Terrain occlusion reality**: the main terrain mesh is continuous — a 'true hole' that deletes terrain triangles would need a terrain carve pass. This burrow instead **cuts through visually** with an open throat + black cap while staying flush with the grass plane (no raised mound). If you ever author a terrain carve, keep the throat + cap — they're still the right interior vocabulary.",
      "**Position is right-of-tipi-1**. If a 'tipi 3' is ever added, do not place it at V2_TILE_WORLD — that tile is the warren. The next available 'next tile' from tipi 2 going east is `V2_TILE_WORLD * 4`.",
      "**Animation gate** depends on `r.action` existing — if a future fauna species ships with no animations, the gate is a no-op via the `if (r.action)` guard. If the rabbit GLB grows more clips (walk / sit / nibble), upgrade `_updateRabbitMotion` to a state→action map and crossfade between them rather than toggling `.paused` on the single hop clip.",
      "**Boot pause** — calling `action.play()` then `action.paused = true` is the correct way to 'schedule but freeze' an AnimationAction. Setting `action.enabled = false` would also work but stops the mixer from advancing time at all (breaking later resume). Don't replace this idiom.",
      "ANU_EVENTS.FAUNA_TICK still fires every 180 ms with { rabbitCount, states[], warren, playerSpeedMps }. The warren payload is `{ x: WARREN_X, z: WARREN_Z }` — subscribers can read the new position by reacting to that tick (no API break).",
      "Per-rabbit material clones are mandatory — sharing the GLB's source material would make recolouring one rabbit recolour all five.",
      "Rabbits use the cosmetic-pet motion model (parabolic hop arc + getGroundY snap), not WorldPhysics bodies. Don't 'upgrade' them to full bodies without a budget plan.",
      "Fauna activates AFTER PanelsPIP in index.v2.html so the moondial + HUD finish wiring first; do not reorder without also moving the v2LoadLog progress beats.",
    ],
    files: [
      "js/v2/Fauna.js",
      "index.v2.html",
      "js/v2/anu/anuEvents.js",
      "js/v2/anu/AnuWorldSensorium.js",
      "js/v2/anu/SimulationController.js",
      "Assets/rabbit.animated.glb",
    ],
  },
  {
    id: "tipi-owner-proximity-behaviour",
    learnedAt: "2026-05",
    title: "Tipi-owner proximity FSM — two tipi owners wired (NPC.YB tipi 1, NPC.BHG tipi 2)",
    summary:
      "Each tipi has an 'owner' NPC. Two are now wired: NPC.YB at tipi 1 (origin) and NPC.BHG at tipi 2 (+2 tile widths east, V2_TIPI_2_CENTER_X_M ≈ 21.72 m — one empty tile of grass between centres, satisfying 'right of tipi 1 skip 1 tile'). Both tipis are PLAYER-IMPASSABLE via a 2.2 m solid collider at their centre — the NPC bypasses because she writes `root.position` directly each frame and is not a registered physics body, so the asymmetric 'NPC can enter, player can't' rule emerges naturally from the two motion models. Each NPC is gated by a rising-edge `playerHasLeftZone` flag: she remains seated at boot even if the player happens to spawn within 1 tile, and she only triggers the greeting when the player has been observed beyond DEPART_DIST_M (2 tiles) and then crosses back inside APPROACH_DIST_M (1 tile). On a rising edge she takes the body yaw from the seated aim helper, plays the wave clip, walks to a FIXED entrance point on the tipi's doorway side (`entranceLocalXZ`, default `{x:0, z:-2.6}` — outside the cone's south flare; real tipis have one entrance), and crossfades to idle. Past 2 tiles she walks back to her exact seat XZ/Y, turns around, and crossfades to sit. World.js gates each tipi's seated aim helper on its own `*Behaviour.suppressPlayerAim` so the two yaw writers per tipi never fight. Greeting/lifecycle events publish through ANU_EVENTS.PLAYER_NPC_GREETING (phases: approach / arrived / depart / returned) — payloads include `npcId` so subscribers can distinguish 'npc_yb_tipi1' from 'npc_bhg_tipi2'.",
    mitigations: [
      "NPC.YB.glb (8.4 MB Draco-compressed) and NPC.BHG.glb (30 MB Draco-compressed — was 105 MB uncompressed, see `assets-draco-diet-pass-1` for the May-2026 compression pass). Both ship 5 NlaTrack-named clips. The controller does name-search first (so a future re-bake with 'wave' / 'idle' / 'sit' / 'walk' clip names will Just Work) and falls back to the legacy `js/EnvironmentBuilder.js` index mapping: walk=0, idle=2, sit=3, wave=4. If those indices ever shift, update CLIP_PREFS.*.fallbackIndex.",
      "**Asset size**: NPC.BHG.glb was 12.5× larger than NPC.YB.glb until both were brought onto the same Draco pipeline in May 2026 — the residual 3.7× gap (30 MB vs 8.4 MB) is now textures, which Draco does not touch. Further reduction needs `textureCompress` (KTX2/Basis) or a smaller source bake.",
      "Tipi 2 reuses tipi 1's GLB (TIPI_2_URL = TIPI_1_URL). When a unique BHG tipi GLB lands, change just `TIPI_2_URL` in WorldStructures.js — every other tuning constant is already in `V2_TIPI_2_*` / `V2_NPC_BHG_TIPI2_*`.",
      "The behaviour controller is the only thing allowed to write `*FacingGroup.rotation.y` while the NPC is moving — the seated aim helper in World.js is short-circuited via `suppressPlayerAim`. Don't add another writer; either extend this controller or re-route through it.",
      "Approach/depart thresholds key off `V2_TILE_WORLD` (the canonical hex flat-width). Use that constant, not raw metres — the world has a hex shader and the design language is in tiles.",
      "The SEATED → EXITING_WAVE transition is a RISING-EDGE trigger via `playerHasLeftZone`. If you remove the gate, the NPC pulls out of her seat instantly whenever the player loads inside the tile radius (the boot-time regression). Initialise the flag false; do not init to true.",
      "Entrance position is FIXED, not radial. Earlier code used `_computeExitPoint(playerX, playerZ)` to walk her toward the player on a radial of `platformRadius + 1 foot`. That landed her at the deck edge regardless of which way the doorway actually faces. The new contract: every tipi owner walks to a single per-tipi entrance point set at construction.",
      "Tipi-cone player block uses radius 2.2 m < platform radius 4.7 m so the deck remains walkable around each tipi. If a future tipi has a wider base (re-baked asset), recompute the radius from the scaled bbox. Tipi 2 uses the same 2.2 m because it reuses tipi 1's visual asset.",
      "ANU_EVENTS.PLAYER_NPC_GREETING is the canonical proximity event. Subscribers should expect { phase, playerId, npcId, distance, tipi:{x,z} }. With two NPCs wired, `npcId` is now meaningfully distinguishing ('npc_yb_tipi1' vs 'npc_bhg_tipi2') and subscribers MUST branch on it if they need per-tipi handling.",
      "TIPI 3+ ROADMAP: a third tipi owner is the duplication-tipping point — the three loaders (loadCenterTipi, loadTipi2WithBhg, hypothetical loadTipi3WithREG) and three aim functions share so much code that a config-driven `loadTipi({hexPos, npcUrl, npcConstants, npcKey, npcSlug, entranceLocalXZ})` is the right refactor before adding tipi 3. Until then, the duplication is bounded and intentional (zero risk to tipi 1).",
      "Tree-clear-zone (`V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M`) only excludes a circle around the ORIGIN (tipi 1). Trees won't currently respect tipi 2's footprint. In practice the legacy tree rings (r=31-45 m) sit well outside tipi 2's 4.7 m platform so they don't overlap visually, but if a future spawn rule places trees inside the 12.5 m clearzone radius around tipi 2's centre they would clip. Fix when it becomes a visible problem.",
    ],
    files: [
      "js/v2/NPCBehaviour.js",
      "js/v2/WorldStructures.js",
      "js/v2/World.js",
      "js/v2/WorldPhysics.js",
      "js/v2/constants.js",
      "js/v2/anu/anuEvents.js",
      "Assets/NPC.YB.glb",
      "Assets/NPC.BHG.glb",
    ],
  },
  {
    id: "assets-draco-diet-pass-1",
    learnedAt: "2026-05",
    title: "Draco diet (pass 1) — 5 active GLBs compressed, ~166 MB saved, all GLTFLoaders must use GLTFLoaderWithDraco",
    summary:
      "May-2026 mesh-compression pass took the five GLBs actually loaded by js/v2/** (NPC.BHG, animated.stag, WORDPRESS/Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb, Avatar3, tree) and ran them through `scripts/draco-compress.mjs` — a tiny wrapper that drives KHR_draco_mesh_compression directly via @gltf-transform/core + /extensions (we bypass @gltf-transform/functions because its bundle eagerly imports `ndarray-pixels` → `sharp`, which won't load on this workspace's Node 20.0.0). Result: BHG 100.6 → 30.1 MB (-70 %), stag 46.7 → 3.5 MB (-93 %), tipi 42.8 → 4.2 MB (-90 %), Avatar3 22.4 → 8.7 MB (-61 %), tree 7.4 → 6.7 MB (-9 %, mostly texture). Originals are preserved in `BACKUP/draco-originals/` so the swap is fully reversible. Boot end-to-end (orchestrator ready → tipi 2 + BHG present) dropped to ~7 s. CONSEQUENCE: every GLTFLoader in the project that opens one of these files MUST be Draco-aware — Flora.js was migrated from `new GLTFLoader()` to `new GLTFLoaderWithDraco()` as part of this pass. Fauna.js still uses a plain loader because rabbit.animated.glb (294 KB) was NOT compressed (too small to be worth the round trip).",
    mitigations: [
      "Quantization knobs in `scripts/draco-compress.mjs` are conservative on purpose for skinned meshes: POSITION=14, NORMAL=10, TEXCOORD=12, GENERIC=12 (covers JOINTS / WEIGHTS). DO NOT drop GENERIC below 12 on skinned models — joint weights start to drift visibly off the skeleton. POSITION below 12 starts to show as faceting on smooth surfaces (BHG face especially).",
      "If you add a new GLB to `js/v2/**`, decide compression policy up front. (a) > ~2 MB: compress with `node scripts/draco-compress.mjs in.glb out.glb` and load via GLTFLoaderWithDraco. (b) ≤ ~2 MB: leave uncompressed (Draco's per-asset decoder bootstrap can be a wash for small meshes). Either way, the loader call must be GLTFLoaderWithDraco unless you have a documented reason not to.",
      "Residual file size on BHG (30 MB) and Avatar3 (8.7 MB) is now TEXTURES. Draco only compresses mesh attributes (POSITION / NORMAL / TEXCOORD / COLOR / JOINTS / WEIGHTS). Further reduction needs KTX2/Basis (via @gltf-transform/functions `textureCompress` — which requires upgrading Node ≥ 20.3 to satisfy sharp / ndarray-pixels) or a smaller source bake. Do not promise more compression gains in this card until that gate is unblocked.",
      "BACKUP/draco-originals/ is the rollback chute. If a Draco re-bake breaks visually (joint drift, normal seams, UV jitter), `cp BACKUP/draco-originals/<file>.glb <orig path>` reverts in seconds. Do not delete the backup folder until at least one full QA pass has shipped without complaint.",
      "Inactive heavy GLBs (Avatar2, animated.avatar, tipi.player, animated.bringshappiness, TraderJosh3d, Buffalo, NPC.REG, animated.deer/source/, NPC.YB is already Draco) were SKIPPED on purpose — the user is sourcing smaller replacements for some of them. Compress them only when they get wired into js/v2/**; compressing files about to be replaced is wasted bytes-on-disk.",
      "The CLI variant `npx gltf-transform draco` does NOT work on this workspace because its bin shim loads `sharp` at startup and Node 20.0.0 < required 20.3. The local `scripts/draco-compress.mjs` is the supported entry point. If you upgrade Node, you can switch back to the CLI; until then, use the script.",
    ],
    files: [
      "scripts/draco-compress.mjs",
      "js/v2/Flora.js",
      "js/v2/gltfLoaderSetup.js",
      "Assets/NPC.BHG.glb",
      "Assets/Avatar3.glb",
      "Assets/animated.stag.glb",
      "Assets/tree.glb",
      "WORDPRESS/Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb",
      "BACKUP/draco-originals/",
      "package.json",
    ],
  },
  {
    id: "tipi-2-bhg-stripe-overlay",
    learnedAt: "2026-05",
    title: "Tipi 2 visual identity — onBeforeCompile stripe + butterfly-suppression shader",
    summary:
      "Tipi 2 reuses tipi 1's yellow-butterfly GLB. To give BHG a distinct visual identity without authoring a new asset, every tipi-2 material is **cloned** on load and patched via `onBeforeCompile`. A vertex varying carries the world-space Y of each fragment (computed as `(modelMatrix * vec4(transformed, 1.0)).y` right after `<begin_vertex>`) and the fragment shader paints two 6-inch horizontal bands (red below the middle, blue above) separated by a 6-inch empty gap centred on `uBhgMidY`, while outside the band the baked yellow butterfly motifs are dimmed by mixing the baseColor 55% toward a flat canvas tan. World-Y is used (NOT unscaled local-Y) because the source GLB has an intermediate node transform that shifts local position values away from the symmetric [-0.5, 0.5] range the bbox accessor suggests; world-Y is invariant to those surprises. `uBhgMidY` is seeded after the tipi is positioned by computing `Box3.setFromObject(tipi)` and taking the midpoint, and the JS-side uniform object is shared by reference with `shader.uniforms` so updates propagate without recompile.",
    mitigations: [
      "The clone-before-mutate pattern is what makes tipi 1 safe. Both tipis load the same GLB and although `loadAsync` returns separate gltf trees, sharing a material instance would couple their appearance. If a future tipi N also reuses TIPI_1_URL, copy the clone-first pattern.",
      "`onBeforeCompile` runs once when the material is first uploaded. The patch chains by saving the existing `onBeforeCompile` (`prior`) and calling it inside the new one — this preserves any chunks Three.js or another module may have already added.",
      "Varyings are prefixed `vBhg*` and uniforms `uBhg*` to avoid collisions with future per-material shader patches. If you add a stripe/badge shader for another NPC's tipi, use a different prefix.",
      "DO NOT use the GLTF POSITION accessor's `min/max` to compute band positions in local-Y space — the result will be off by an intermediate node transform that doesn't show up in the accessor alone. World-Y via `modelMatrix * vec4(transformed, 1.0)` is the right primitive.",
      "Stripe colours are constants in the shader, not uniforms — fast but means you have to recompile to retune. If you want runtime sliders, switch the consts to uniforms exposed via shader.uniforms.",
      "Suppression mix is 0.55 — a sweet spot found by reading the existing baseColor lightness. If a future tipi asset has a brighter or darker baked texture, retune this constant or the canvas tan colour to keep the stripes the dominant feature.",
      "6\" stripes on a 7.2 m tipi render as ~7 px wide at typical viewing distance and ~30 px at close approach — readable but subtle. If you want them more dominant, bump BHG_STRIPE_H / BHG_GAP_HALF to 12\" or 18\" equivalents (0.3048 / 0.4572 m). Don't change the world-Y math, just the band constants.",
      "When tipi 2 needs its own GLB (BHG-specific texture), swap `TIPI_2_URL` in WorldStructures.js and DELETE the stripe/suppression call — the new texture should already have the desired look baked in. The shader patch is a transitional tool, not a permanent system.",
    ],
    files: [
      "js/v2/WorldStructures.js",
    ],
  },
  {
    id: "pond-with-waterfalls-landmark",
    learnedAt: "2026-05",
    title: "Pond asset rejected and REMOVED — procedural stylized replacement pending",
    summary:
      "A prior turn authored js/v2/WorldPond.js to load a pond+waterfalls GLB authored in Z-up Blender (404 meshes / 4 materials / ~9 MB textures). Visual evaluation rejected the asset on four grounds: (1) ZERO animations — water doesn't ripple, waterfalls don't flow, reading as 'frozen' next to breathing fire smoke / hopping rabbits / walking NPC; (2) 404 draw calls ≈ ½ of the entire instanced forest — too expensive for a decoration that doesn't sell its own quality; (3) photoreal Blender style fighting the stylized hex shader / neumorphic UI vocabulary — material reads as 'cloud / fog patch' from above rather than 'water'; (4) waterfalls not visibly rendering from ground-level POVs (suspected backface culling post Z-up flip even with DoubleSide). Originally the WorldPondModule file was PARKED on disk for educational reference (Z-up → Y-up handling, DoubleSide flip post-rotation, terrain-snap pattern). The user subsequently REMOVED the `Assets/pond_with_waterfalls/` folder to source a better asset, and the parked loader was deleted in the same commit (along with its `check:v2` entry in package.json) to keep the strict asset gate green. The educational patterns are documented inline in this card so the procedural replacement has the blueprint.",
    mitigations: [
      "If a future contributor wants a pond, the right path is a NEW procedural module (e.g. js/v2/WorldPondStylized.js) that matches the warren's vocabulary: CircleGeometry water with a shader-animated UV scroll, a cylindrical basin depression, ~5-8 rock instances around the rim, and one or two waterfall ribbons with scrolling UVs. Target ≤ 15 draw calls vs the rejected asset's 404.",
      "Patterns to reuse from the deleted WorldPond.js (preserved here as the blueprint): for any Z-up Blender export, apply `rotateX(-π/2)` BEFORE other transforms so Z becomes world-Y; force `material.side = THREE.DoubleSide` on basin / ribbon meshes because the flip exposes back-faces; snap to terrain by reading `WorldPhysics.getGroundY(x, z) + 5 mm lift` to prevent shoreline z-fighting.",
      "If the asset is ever revisited, do NOT trust bbox-only inspection — render from ground-level POV first. The bbox said the rejected asset would look right; the visual probe said otherwise.",
      "If a NEW pond asset arrives (the user said 'I will get a better one'), evaluate it from ground POV BEFORE writing a loader module. Don't repeat the WorldPond.js rewrite-then-delete cycle.",
    ],
    files: [
      "js/v2/AnuModule.js",
      "package.json",
    ],
  },
  {
    id: "phase-8-docs-and-dx",
    learnedAt: "2026-05",
    title: "Phase 8 — repo entry points: README, CONTRIBUTING, AnuUniverse cheatsheet",
    summary:
      "78→100 program Phase 8 (Documentation & DX). Added top-level README.md (project quick-start + tree map + invariants), CONTRIBUTING.md (workflow rules summary, npm scripts, asset gate, ANU memory cards, doc map), and docs/anu-cheatsheet.md (markdown mirror of AnuUniverse.help()). Cross-linked Assets/README.md to docs/legacy-reconciliation.md so the WARN-tier asset entries point at the policy that accepts them. Promoted AnuUniverse.help() in index.v2.html: bolded in the visible #v2-hint, plus an obvious `Start here → AnuUniverse.help()` line in the boot console banner.",
    mitigations: [
      "AnuUniverse.help() is the live source of truth — when adding a new public method, register it in the help() index in the same commit so docs/anu-cheatsheet.md and CONTRIBUTING stay accurate by reference.",
      "When adding a new docs file, link it from CONTRIBUTING.md's documentation map and from README.md's tree map.",
      "If the v2-hint or boot console message is restyled, keep the AnuUniverse.help() pointer prominent — first-time DevTools open is the only chance to surface the discovery path.",
    ],
    files: [
      "README.md",
      "CONTRIBUTING.md",
      "docs/anu-cheatsheet.md",
      "Assets/README.md",
      "index.v2.html",
    ],
  },
  {
    id: "empathy-engine-product-name",
    learnedAt: "2026-05",
    title: "Product identity — The Empathy Engine v1.0a",
    summary:
      "The governed Sacred Adventures v2 stack (AnuUniverse + SacredOrchestrator shell + js/v2 modules) is referred to as **The Empathy Engine v1.0a**. The string is the single source of truth in `ANU_EMPATHY_ENGINE_NAME`; `AnuUniverse.engineName` mirrors it for DevTools and tooling. Bump the suffix (e.g. v1.0b) only when the user or release process explicitly renames the product — do not drift the label from marketing copy.",
    mitigations: [
      "AnuModule.js — export ANU_EMPATHY_ENGINE_NAME; buildPublicApi exposes engineName.",
      "Boot console line in AnuModule.load() appends the label so first open sees it next to AnuUniverse.report().",
      "When publishing release notes or CONTRIBUTING invariants, cite ANU_EMPATHY_ENGINE_NAME instead of duplicating the string.",
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
