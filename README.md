# Sacred Adventures — v2 engine

A WebGL-based exploration game running on a custom orchestrator
(`SacredOrchestrator`) with a self-observing governance + telemetry
layer (`AnuUniverse`).

This README is the project entry point. For working in the codebase,
read [`CONTRIBUTING.md`](CONTRIBUTING.md) — that's the workflow doc.

---

## Quick start

```bash
npm install
npm run dev
```

Open http://127.0.0.1:8080/index.v2.html

In DevTools:

```js
AnuUniverse.help();              // grouped index of every supported API
anuOrchestrator.report();        // live engine HUD
AnuUniverse.report();            // pipeline memory + audit + snapshots
```

---

## What's where

```
js/v2/                  Canonical engine (KEEP — this is what you edit)
  Orchestrator.js         RAF loop, renderers, HUD, dispose
  AnuModule.js            AnuUniverse — observability + governance + memory
  World.js, Trees.js,     Scene modules (worlds, flora, NPCs, structures…)
  WorldStructures.js,
  TipiCampfire.js, …
  anu/
    RenderingGovernor.js  PiP cadence policy (single source of truth)
    FrameBudget.js        Wall-clock frame samples (HUD equalizer reads this)
    …                     (other anu/ telemetry + sensors)
  RuntimeServices.js      Service registry + contracts
  UIModule.js             Moondial / compass / season / glass / zoom UI

index.v2.html           v2 entry HTML (only HTML you should boot)

tests/
  v2-smoke.spec.js        Boot + lifecycle + service binding + dispose
  v2-fidelity.spec.js     PiP render sentinel + decal depth + UI layout +
                          governor/contracts mutation

scripts/
  check-assets.mjs        Asset taxonomy + dangling-reference gate

docs/
  SCORECARD.md            10-dimension rubric for the 78→100 program
  baselines/              Phase 0 "before" snapshot
  legacy-reconciliation.md  KEEP / FROZEN / SUNSET matrix for every tree
  anu-cheatsheet.md       Markdown mirror of AnuUniverse.help()

Assets/
  README.md               Taxonomy + add/remove/rename checklists
  flora/, fauna/, npc/,
  buildings/, landscape-scenes/

WORDPRESS/, dist/, js/    Legacy / FROZEN trees — see
  (non-v2 parts),         docs/legacy-reconciliation.md before touching
  _legacy_archive/,
  scratch/, SacredOnes.1/

.cursor/rules/          Always-on agent rules:
                          agent-task-workflow.mdc      (hard scope lock)
                          sacred-pip-map-protect.mdc   (PiP invariant)
                          live-state-and-apple-silicon.mdc
                          sacred-fidelity-parity.mdc
                          sacred-v2-render-pipeline.mdc
```

---

## Key invariants

1. **The v2 engine is the canonical engine.** Other trees are FROZEN or
   SUNSET. See [`docs/legacy-reconciliation.md`](docs/legacy-reconciliation.md).
2. **PiP / live map is sacred.** Parent `#pipCanvas` is the
   Orchestrator's WebGL minimap target. Don't replace or obscure it
   without an explicit user request — see
   `.cursor/rules/sacred-pip-map-protect.mdc`.
3. **Hard scope lock.** Edit only what the instruction requires.
   See `.cursor/rules/agent-task-workflow.mdc` §0.
4. **Lessons go in `ANU_PIPELINE_MEMORY`.** Future agents read it.

---

## Validate before commit

```bash
npm test
```

Runs:

1. `check:v2` — ESM syntax check on every canonical v2 module.
2. `check:assets` — dangling `Assets/...` reference gate.
3. `test:v2` — Playwright smoke (boot + lifecycle + services + dispose
   + movement).
4. `test:fidelity` — Playwright fidelity (PiP render sentinel + decal
   depth + UI layout + governor + contracts).

If anything fails, fix it before committing.

---

## License

Personal / private project. No public license at this time.
