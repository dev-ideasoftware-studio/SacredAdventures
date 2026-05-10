/**
 * Anu as simulation controller — conceptual center for player IO, flora/fauna,
 * structures, and population (NPCs). Active modules + InteractionBus events + scene inventory roll up here.
 */

import { getSceneInventorySnapshot } from "./SceneModelInventory.js";

/** Stable IDs for tagging meshes (`userData.anuSimulationDomain`) and tooling. */
export const ANU_SIMULATION_DOMAIN = Object.freeze({
  PLAYER: "player",
  ENVIRONMENT: "environment",
  FLORA: "flora",
  FAUNA: "fauna",
  STRUCTURES: "structures",
  POPULATION: "population",
  ITEMS: "items",
  UNSPECIFIED: "unspecified",
});

export const ANU_INTERACTION_VERB = Object.freeze({
  INSPECT: "inspect",
  HARVEST: "harvest",
  TALK: "talk",
  ENTER: "enter",
  PICK_UP: "pick_up",
  USE: "use",
});

/**
 * JSON overview for LLMs / debugging — merges module activation + latest scene inventory (including domain rollups).
 * @param {object | null} orchestrator SacredOrchestrator engine instance (window.anuOrchestrator)
 */
export function buildSimulationOverview(orchestrator) {
  const activeModules =
    orchestrator && Array.isArray(orchestrator._activeModules)
      ? [...orchestrator._activeModules]
      : [];
  const registeredModules =
    orchestrator && orchestrator._registry
      ? [...orchestrator._registry.keys()]
      : [];

  const inv = getSceneInventorySnapshot();

  return Object.freeze({
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    role:
      "Anu is the Sacred Adventures v2 simulation controller — timebase is SacredOrchestrator; subsims (World, Trees, future fauna/NPC/buildings/items) register as modules, obey governance rules, and publish state via InteractionBus + tagged scene objects.",
    domains: Object.freeze({
      player: Object.freeze({
        status: activeModules.includes("World") ? "active" : "inactive",
        orchestratorModule: "World",
        responsibilities:
          "keyboard/pointer IO capture, ANU-governed PLAYER_* events, 3D gravity/elevation physics body, chase camera, optional avatar mesh",
      }),
      environment: Object.freeze({
        status: activeModules.includes("World") ? "active" : "inactive",
        orchestratorModule: "World",
        responsibilities: "terrain + atmospheric meshes tagged environment",
      }),
      flora: Object.freeze({
        status: activeModules.includes("Trees") ? "active" : "inactive",
        orchestratorModule: "Trees",
        responsibilities:
          "instanced tree.glb forest — SacredFlora_* mesh tags; wind update in Trees.update",
      }),
      fauna: Object.freeze({
        status: "planned",
        orchestratorModule: "WildlifeModule",
        responsibilities:
          "wildlife AI IO, meshes, 3D physics bodies, locomotion — dispatch ANU_EVENTS.FAUNA_TICK when implemented",
      }),
      structures: Object.freeze({
        status: "planned",
        orchestratorModule: "BuildingsModule | VillageMapModule",
        responsibilities:
          "buildings / sockets — tag meshes ANU_SIMULATION_DOMAIN.STRUCTURES; STRUCTURE_* events",
      }),
      population: Object.freeze({
        status: "planned",
        orchestratorModule: "NPCModule",
        responsibilities:
          "NPC AI IO, dialogue, behaviour, 3D physics bodies — ANU_EVENTS.NPC_* when implemented",
      }),
      items: Object.freeze({
        status: "planned",
        orchestratorModule: "ItemsModule | JournalModule",
        responsibilities:
          "loot, journal pages, tools, quest objects — tag meshes ANU_SIMULATION_DOMAIN.ITEMS and emit ITEM_EVENT",
      }),
    }),
    orchestrator: Object.freeze({
      activeModules,
      registeredModules,
    }),
    sceneInventory: inv
      ? Object.freeze({
          at: inv.at,
          summary: inv.summary,
          truncated: inv.truncated,
          totalEntries: inv.totalEntries,
        })
      : null,
    conventions: Object.freeze([
      "Set object.userData.anuSimulationDomain to one of ANU_SIMULATION_DOMAIN values.",
      "Set object.userData.anuKind to a short machine id (e.g. tree_instances, npc_villager).",
      "Set object.userData.anuInteractable + anuInteractionVerbs when the player/AI can target it.",
      "Register moving 3D entities with WorldPhysics so gravity/elevation checks stay governed.",
      "Route player, fauna, and NPC IO through AnuUniverse.interactions even when a domain module captures raw input.",
      "Subscribe to AnuUniverse.interactions for PLAYER_*, SCENE_INVENTORY_TICK, FAUNA_TICK / NPC_ENTITY / STRUCTURE_EVENT / ITEM_EVENT when implemented.",
    ]),
  });
}

export function exportSimulationOverviewJson(orchestrator) {
  return JSON.stringify(buildSimulationOverview(orchestrator), null, 2);
}
