/**
 * Phase 3 — PiP capture strategies (stub).
 *
 * Today the Orchestrator renders the full Scene into #pipCanvas (see RenderingGovernor).
 * Future: plug in RT copy, layer-mask ortho, or baked minimap — see docs/V2_SENTIENT_RUNTIME_PLAN.md.
 */
export const PipRenderStrategy = Object.freeze({
  FULL_SCENE_ORTHO: "full-scene-ortho",
  /** Reserved for RT / impostor / simplified scene graph */
  SURROGATE: "surrogate",
});
