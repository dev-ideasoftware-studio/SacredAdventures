/**
 * Anu governance rules.
 *
 * These are runtime contracts, not lore: every V2 model and interaction path
 * should be added through these rules so ANU can verify what governs it.
 */

import { ANU_SIMULATION_DOMAIN } from "./SimulationController.js";

export const ANU_GOVERNANCE_RULES = Object.freeze({
  MODEL_REGISTRATION: Object.freeze({
    id: "model-registration",
    enabled: true,
    authority: "ANU",
    rule:
      "Every 3D model/Object3D must declare userData.anuSimulationDomain and userData.anuKind before it is considered governed.",
    appliesTo: Object.freeze(Object.values(ANU_SIMULATION_DOMAIN)),
  }),
  INTERACTION_REGISTRATION: Object.freeze({
    id: "interaction-registration",
    enabled: true,
    authority: "ANU",
    rule:
      "Every player/AI targetable interaction must declare userData.anuInteractable and userData.anuInteractionVerbs, then publish lifecycle events through AnuUniverse.interactions.",
    appliesTo: Object.freeze([
      ANU_SIMULATION_DOMAIN.FLORA,
      ANU_SIMULATION_DOMAIN.FAUNA,
      ANU_SIMULATION_DOMAIN.POPULATION,
      ANU_SIMULATION_DOMAIN.STRUCTURES,
      ANU_SIMULATION_DOMAIN.ITEMS,
    ]),
  }),
  PHYSICS_3D_GRAVITY: Object.freeze({
    id: "physics-3d-gravity",
    enabled: true,
    authority: "ANU",
    rule:
      "3D gravity is on for bodies registered with WorldPhysics; movement integrates x/y/z and vertical velocity.",
    required: true,
  }),
  PHYSICS_3D_ELEVATION: Object.freeze({
    id: "physics-3d-elevation",
    enabled: true,
    authority: "ANU",
    rule:
      "3D elevation physics is on: movement must use terrain height + slope/normal sampling for elevation detection and grounding.",
    required: true,
  }),
  AI_IO_AUTHORITY: Object.freeze({
    id: "ai-io-authority",
    enabled: true,
    authority: "ANU",
    rule:
      "AI/ANU is the governing authority for IO operations. Player, wildlife, and NPC IO must publish through the ANU interaction bus even when raw device events are captured by a domain module.",
    appliesTo: Object.freeze([
      ANU_SIMULATION_DOMAIN.PLAYER,
      ANU_SIMULATION_DOMAIN.FAUNA,
      ANU_SIMULATION_DOMAIN.POPULATION,
    ]),
  }),
});

function activeModulesFrom(orchestrator) {
  return orchestrator && Array.isArray(orchestrator._activeModules)
    ? [...orchestrator._activeModules]
    : [];
}

function getPhysicsSnapshot() {
  if (typeof window === "undefined") return null;
  const physics = window.WorldPhysics;
  if (!physics || typeof physics.getAnuPhysicsSnapshot !== "function") {
    return null;
  }
  return physics.getAnuPhysicsSnapshot();
}

function compliance(id, ok, evidence, note) {
  return Object.freeze({
    id,
    ok: ok === true,
    state: ok === true ? "on" : "needs_attention",
    evidence,
    note,
  });
}

/**
 * @param {object | null} orchestrator SacredOrchestrator instance.
 */
export function getGovernanceSnapshot(orchestrator = null) {
  const activeModules = activeModulesFrom(orchestrator);
  const physics = getPhysicsSnapshot();
  const anuBound =
    orchestrator?.isSacredOrchestratorShell === true &&
    typeof window !== "undefined" &&
    window.anuOrchestrator === orchestrator;

  const checks = [
    compliance(
      ANU_GOVERNANCE_RULES.PHYSICS_3D_GRAVITY.id,
      physics?.gravityEnabled === true,
      physics,
      "WorldPhysics must expose gravityEnabled=true after World loads.",
    ),
    compliance(
      ANU_GOVERNANCE_RULES.PHYSICS_3D_ELEVATION.id,
      physics?.elevationPhysicsEnabled === true,
      physics,
      "WorldPhysics must expose elevationPhysicsEnabled=true after terrain height injection.",
    ),
    compliance(
      ANU_GOVERNANCE_RULES.AI_IO_AUTHORITY.id,
      anuBound === true,
      {
        anuBound,
        activeModules,
        governedDomains: ANU_GOVERNANCE_RULES.AI_IO_AUTHORITY.appliesTo,
      },
      "Domain modules may capture raw device/AI signals, but ANU is the authority via InteractionBus events.",
    ),
  ];

  const ok = checks.every((c) => c.ok);

  return Object.freeze({
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    authority: "ANU",
    state: ok ? "governance_on" : "governance_needs_attention",
    rules: ANU_GOVERNANCE_RULES,
    activeModules,
    physics,
    checks: Object.freeze(checks),
    directive:
      "All new models, physics bodies, and player/wildlife/NPC IO must enter V2 through ANU-governed domains, tags, physics, and InteractionBus events.",
  });
}

export function exportGovernanceJson(orchestrator = null) {
  return JSON.stringify(getGovernanceSnapshot(orchestrator), null, 2);
}
