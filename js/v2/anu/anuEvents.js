/**
 * Canonical interaction names — grep-friendly & stable for tools / LLMs.
 */
export const ANU_EVENTS = Object.freeze({
  SEASON_CHANGE: "anu-season-change",
  PLAYER_JUMP: "anu-player-jump",
  ORCHESTRATOR_BENCH_COMPLETE: "anu-orchestrator-bench-complete",
  MODULE_ACTIVATED: "anu-module-activated",
  MODULE_DEACTIVATED: "anu-module-deactivated",
  /** SacredOrchestrator render/update loop threw — detail: { message, stack, frameCount } */
  ORCHESTRATOR_LOOP_ERROR: "anu-orchestrator-loop-error",
  /** Module load() rejected — detail: { moduleName, message, stack } */
  MODULE_LOAD_ERROR: "anu-module-load-error",
  /** Optional subscribe — fires when pipeline stress tier changes (nominal | elevated | severe) */
  PIPELINE_STRESS_LEVEL: "anu-pipeline-stress-level",
  /** AI-readable fuzzy bottleneck diagnosis requested on demand by AnuUniverse */
  FUZZY_PIPELINE_SENSOR: "anu-fuzzy-pipeline-sensor",
  /** Player keyboard edge (movement / jump / turn keys only) — detail: { key, down, code, t } */
  PLAYER_KEY_EDGE: "anu-player-key-edge",
  /** Player avatar animation changed — detail: { animation, clipName, reason } */
  PLAYER_AVATAR_ANIMATION: "anu-player-avatar-animation",
  /** Player/NPC proximity greeting or goodbye — detail: { phase, playerId, npcId, distance } */
  PLAYER_NPC_GREETING: "anu-player-npc-greeting",
  /** Throttled world pose + locomotion — detail: position, yaw, grounded, walkDistance, t */
  PLAYER_STATE_SAMPLE: "anu-player-state-sample",
  /** After scene inventory refresh — detail: { at, summary, truncated, totalEntries } */
  SCENE_INVENTORY_TICK: "anu-scene-inventory-tick",
  /** Moondial PiP overlay toggled (postMessage TOGGLE_VIEW_MODE) */
  UI_PIP_VIEW_TOGGLE: "anu-ui-pip-view-toggle",
  /** MoonDial iframe manual phase — detail: { phase } (0–7), from Component.MoonDial postMessage */
  MOON_DIAL_PHASE: "anu-moon-dial-phase",
  /** Wildlife AI tick / probe — detail defined by WildlifeModule */
  FAUNA_TICK: "anu-fauna-tick",
  /** NPC entity lifecycle — detail defined by NPCModule */
  NPC_ENTITY: "anu-npc-entity",
  /** Buildings / placed structures — detail defined by BuildingsModule */
  STRUCTURE_EVENT: "anu-structure-event",
  /** Items / inventory world objects — detail defined by ItemsModule */
  ITEM_EVENT: "anu-item-event",
  /** Unified sentient-style world sensor snapshot requested by AnuUniverse */
  WORLD_SENSORIUM: "anu-world-sensorium",
  /** Governance rules snapshot requested by AnuUniverse */
  GOVERNANCE_SNAPSHOT: "anu-governance-snapshot",
});
