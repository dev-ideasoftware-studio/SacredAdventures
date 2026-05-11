# AnuUniverse cheatsheet

The single source of truth for the v2 engine's observability + governance
surface. Mirrors `AnuUniverse.help()` (call it in DevTools to get the
same index live).

> **Best discovery**: open the running game, open DevTools, then run
> `AnuUniverse.help()`. The console output is grouped exactly as below
> and reflects the running build.

---

## boot

| Path | Purpose |
|---|---|
| `AnuUniverse.isLiveSacredOrchestratorBound()` | `true` iff the live `SacredOrchestrator` shell is bound. Use as the first gate in tests + tooling. |
| `AnuUniverse.anuOrchestrator` | Reference to the live orchestrator (same as `window.anuOrchestrator`). |
| `AnuUniverse.version` | Schema version of the AnuUniverse API. |

## audit

| Path | Purpose |
|---|---|
| `AnuUniverse.audit()` | Runs `evaluateLivePipelineRisk()` and returns alerts (PiP cadence, canvas count, sustained triangle pressure, etc.). |
| `AnuUniverse.report()` | Console group: pipeline memory, audit, rendering snapshot, budget, services, governance, fuzzy bottleneck, world sensorium. Each line labelled with the canonical `AnuUniverse.*` method that produced it. |
| `AnuUniverse.resetAlerts()` | Clears the in-memory "already alerted" set so an alert can fire again. |
| `AnuUniverse.memory` | Read-only `ANU_PIPELINE_MEMORY` array — every recorded incident card. |
| `AnuUniverse.EVENTS` | Frozen registry of cross-module event names. |

## rendering

| Path | Purpose |
|---|---|
| `AnuUniverse.rendering.getRenderingSnapshot()` | `{ pipBaseline, pipEffectiveStride, pipAdaptiveRaw, pipPhase, mainRenderer }`. |
| `AnuUniverse.rendering.shouldRenderPipSceneThisFrame()` | The single source of truth the orchestrator uses each frame. |
| `AnuUniverse.rendering.resetPipRenderPhase()` | Reset the throttle counter (e.g. after a manual resize). |
| `AnuUniverse.rendering.blueprint` | Frozen `MAIN_RENDERER_BLUEPRINT` — values the live renderer matches at construction. |
| `AnuUniverse.adaptive.debug()` | Internal debug for the adaptive PiP policy. |

## budget

| Path | Purpose |
|---|---|
| `AnuUniverse.budget.snapshot()` | Wall-clock frame duration: `{ lastMs, avgMs, loadPct, budgetMs, samples }`. The HUD equalizer reads from this same source. |

## services

| Path | Purpose |
|---|---|
| `AnuUniverse.services.list()` | Read-only `getRuntimeServicesSnapshot()`. |
| `AnuUniverse.services.validate()` | Read-only `validateRuntimeServiceContracts(activeModules)`. |
| `AnuUniverse.services.contracts` | Frozen `RUNTIME_SERVICE_CONTRACTS` (required + optional with method shape specs). |
| `AnuUniverse.getRuntimeServicesSnapshot()` | Same as `services.list()` (kept for backward compat). |
| `AnuUniverse.validateRuntimeServiceContracts()` | Same as `services.validate()`. |

## governance

| Path | Purpose |
|---|---|
| `AnuUniverse.getGovernanceSnapshot()` | Live governance evaluation against `GOVERNANCE_RULES`. |
| `AnuUniverse.exportGovernanceJson()` | Same data, JSON-stringified. |
| `AnuUniverse.GOVERNANCE_RULES` | Frozen rule registry. |

## sensorium

| Path | Purpose |
|---|---|
| `AnuUniverse.getWorldSensoriumSnapshot()` | World awareness: avatars, NPCs, structures, environment effects with last-known state. |
| `AnuUniverse.exportWorldSensoriumJson()` | JSON-stringified. |

## simulation

| Path | Purpose |
|---|---|
| `AnuUniverse.getSimulationSnapshot()` | Per-domain simulation state. |
| `AnuUniverse.exportSimulationJson()` | JSON-stringified. |
| `AnuUniverse.SIMULATION_DOMAINS` | Frozen domain registry. |
| `AnuUniverse.INTERACTION_VERBS` | Frozen interaction-verb registry. |

## scene

| Path | Purpose |
|---|---|
| `AnuUniverse.getSceneInventory()` | Walk of `THREE.Scene` summarised by Anu kind / id. |
| `AnuUniverse.exportSceneInventoryJson()` | JSON-stringified. |

## fuzzy

| Path | Purpose |
|---|---|
| `AnuUniverse.getFuzzyPipelineSnapshot()` | Bottleneck attribution across CPU / GPU / triangles / draw calls / FPS / PiP cadence. |
| `AnuUniverse.exportFuzzyPipelineJson()` | JSON-stringified — copy-paste into an LLM bug brief. |

## stress

| Path | Purpose |
|---|---|
| `AnuUniverse.getStressSnapshot()` | Errors, module reload counts, last-N stress events. |
| `AnuUniverse.exportStressJson()` | JSON-stringified. |
| `AnuUniverse.exportAiStressBrief()` | Minimal stress brief shaped for an LLM. |
| `AnuUniverse.clearStressHistory()` | Reset the stress ledger. |

## interactions

| Path | Purpose |
|---|---|
| `AnuUniverse.interactions.subscribe(name, fn)` | Subscribe to a cross-module event. |
| `AnuUniverse.interactions.dispatch(name, detail)` | Dispatch a cross-module event. |

## help

| Path | Purpose |
|---|---|
| `AnuUniverse.help()` | Returns + prints the grouped index above. Always trust this over docs — it reflects the running build. |

---

## Three quick recipes

**Diagnose a frame-time spike**:
```js
AnuUniverse.budget.snapshot();
AnuUniverse.audit();
AnuUniverse.getFuzzyPipelineSnapshot().primaryBottleneck;
```

**Confirm services after a module activate / deactivate**:
```js
AnuUniverse.services.validate(window.anuOrchestrator._activeModules);
// → { ok: true, missing: [], malformed: [] }
```

**Snapshot for an LLM bug report**:
```js
copy(AnuUniverse.exportAiStressBrief()); // copies a minimal stress brief
copy(AnuUniverse.exportFuzzyPipelineJson()); // copies a perf bottleneck brief
```
