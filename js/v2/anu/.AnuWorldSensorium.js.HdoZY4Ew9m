/**
 * Anu World Sensorium.
 *
 * A single awareness snapshot for AI/tools: what is alive in the V2 world,
 * what domain it belongs to, whether it is interactable, and what ANU should
 * watch before more flora/fauna/NPC/building/item systems are added.
 */

import {
  ANU_SIMULATION_DOMAIN,
  ANU_INTERACTION_VERB,
  buildSimulationOverview,
} from "./SimulationController.js";
import { getSceneInventorySnapshot } from "./SceneModelInventory.js";
import { getFuzzyPipelineSnapshot } from "./AnuFuzzyPipelineSensor.js";
import { getGovernanceSnapshot } from "./AnuGovernanceRules.js";

const DOMAIN_CONTRACTS = Object.freeze({
  [ANU_SIMULATION_DOMAIN.PLAYER]: Object.freeze({
    sentienceNote: "The witness point: input, camera, body, and intent.",
    expectedModule: "World",
    expectedEvents: ["PLAYER_KEY_EDGE", "PLAYER_STATE_SAMPLE"],
    defaultVerbs: [ANU_INTERACTION_VERB.INSPECT],
  }),
  [ANU_SIMULATION_DOMAIN.ENVIRONMENT]: Object.freeze({
    sentienceNote: "The ground and atmosphere that all bodies must obey.",
    expectedModule: "World",
    expectedEvents: ["SCENE_INVENTORY_TICK"],
    defaultVerbs: [ANU_INTERACTION_VERB.INSPECT],
  }),
  [ANU_SIMULATION_DOMAIN.FLORA]: Object.freeze({
    sentienceNote: "Rooted life: trees, plants, harvestable groves, forest pressure.",
    expectedModule: "Trees",
    expectedEvents: ["SCENE_INVENTORY_TICK"],
    defaultVerbs: [ANU_INTERACTION_VERB.INSPECT, ANU_INTERACTION_VERB.HARVEST],
  }),
  [ANU_SIMULATION_DOMAIN.FAUNA]: Object.freeze({
    sentienceNote: "Moving non-player life: wildlife, creatures, herds, threats.",
    expectedModule: "WildlifeModule",
    expectedEvents: ["FAUNA_TICK"],
    defaultVerbs: [ANU_INTERACTION_VERB.INSPECT],
  }),
  [ANU_SIMULATION_DOMAIN.POPULATION]: Object.freeze({
    sentienceNote: "People and spirits: NPC bodies, dialogue, mood, quest memory.",
    expectedModule: "NPCModule",
    expectedEvents: ["NPC_ENTITY"],
    defaultVerbs: [ANU_INTERACTION_VERB.INSPECT, ANU_INTERACTION_VERB.TALK],
  }),
  [ANU_SIMULATION_DOMAIN.STRUCTURES]: Object.freeze({
    sentienceNote: "Built world: homes, doors, sockets, village objects.",
    expectedModule: "BuildingsModule | VillageMapModule",
    expectedEvents: ["STRUCTURE_EVENT"],
    defaultVerbs: [ANU_INTERACTION_VERB.INSPECT, ANU_INTERACTION_VERB.ENTER],
  }),
  [ANU_SIMULATION_DOMAIN.ITEMS]: Object.freeze({
    sentienceNote: "Held and found things: tools, loot, journals, quest objects.",
    expectedModule: "ItemsModule | JournalModule",
    expectedEvents: ["ITEM_EVENT"],
    defaultVerbs: [ANU_INTERACTION_VERB.INSPECT, ANU_INTERACTION_VERB.PICK_UP],
  }),
  [ANU_SIMULATION_DOMAIN.UNSPECIFIED]: Object.freeze({
    sentienceNote: "Unclaimed matter: visible objects not yet assigned to ANU.",
    expectedModule: null,
    expectedEvents: ["SCENE_INVENTORY_TICK"],
    defaultVerbs: [],
  }),
});

function activeModulesFrom(orchestrator) {
  return orchestrator && Array.isArray(orchestrator._activeModules)
    ? [...orchestrator._activeModules]
    : [];
}

function summarizeDomains(inventory, activeModules) {
  const source = inventory?.summary?.bySimulationDomain ?? {};
  return Object.values(ANU_SIMULATION_DOMAIN).reduce((acc, domain) => {
    const sourceRollup = source[domain] ?? {};
    const rollup = {
      drawables: sourceRollup.drawables ?? 0,
      trianglesEstimate: sourceRollup.trianglesEstimate ?? 0,
      interactables: sourceRollup.interactables ?? 0,
    };
    const contract = DOMAIN_CONTRACTS[domain];
    const moduleName = contract?.expectedModule ?? null;
    const moduleActive =
      moduleName != null &&
      moduleName
        .split("|")
        .map((s) => s.trim())
        .some((name) => activeModules.includes(name));

    acc[domain] = Object.freeze({
      ...rollup,
      expectedModule: moduleName,
      moduleActive,
      sentienceNote: contract?.sentienceNote ?? "",
      expectedEvents: contract?.expectedEvents ?? [],
      defaultVerbs: contract?.defaultVerbs ?? [],
      readyForInteraction:
        rollup.interactables > 0 || (domain === ANU_SIMULATION_DOMAIN.FLORA && rollup.drawables > 0),
    });
    return acc;
  }, {});
}

function topInteractables(inventory) {
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  return entries
    .filter((entry) => entry.interactable)
    .slice(0, 24)
    .map((entry) =>
      Object.freeze({
        anuId: entry.anuId,
        name: entry.name,
        domain: entry.simulationDomain,
        kind: entry.anuKind,
        verbs: entry.interactionVerbs,
        instances: entry.instances,
        worldPosition: entry.worldPosition,
      }),
    );
}

/**
 * @param {object | null} orchestrator SacredOrchestrator instance.
 */
export function getWorldSensoriumSnapshot(orchestrator = null) {
  const inventory = getSceneInventorySnapshot();
  const activeModules = activeModulesFrom(orchestrator);
  const domains = summarizeDomains(inventory, activeModules);
  const fuzzyPipeline = getFuzzyPipelineSnapshot(orchestrator);
  const governance = getGovernanceSnapshot(orchestrator);

  return Object.freeze({
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    identity:
      "Anu is the unified world sensor: it watches every tagged object, every active module, and every pipeline signal before AI changes the simulation.",
    domains,
    interactables: Object.freeze({
      count: inventory?.summary?.interactableRows ?? 0,
      top: topInteractables(inventory),
    }),
    simulation: buildSimulationOverview(orchestrator),
    governance,
    fuzzyPipeline,
    watchProtocol: Object.freeze([
      "Every world object should carry userData.anuSimulationDomain.",
      "Every interactable object should carry userData.anuInteractable = true and userData.anuInteractionVerbs.",
      "Every 3D moving body should register with WorldPhysics so ANU can verify gravity and elevation physics.",
      "Player, fauna, and NPC IO must publish through AnuUniverse.interactions; raw inputs are capture details, not authority.",
      "Flora/fauna/NPC/building/item modules should publish lifecycle events through AnuUniverse.interactions.",
      "Before adding a new system, check this sensorium plus exportFuzzyPipelineJson() for pressure and missing tags.",
    ]),
  });
}

export function exportWorldSensoriumJson(orchestrator = null) {
  return JSON.stringify(getWorldSensoriumSnapshot(orchestrator), null, 2);
}
