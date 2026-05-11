# Sacred Adventures v2 — File Timeline

This is the canonical human-readable timeline for the V2 rebuild files. Git is still the source of truth for exact diffs; this file exists so Cursor/agent work has a visible per-file milestone map.

## Forensic Note — `index.v2.html`

`index.v2.html` did not appear in commit `dfe8455` because no content in that file changed during the ANU governance/sensorium work. Its last Git timeline entry before this fix was:

- `dbcea3d` — `2026-05-09 23:57:07 -0500` — `feat(v2): establish ANU-monitored rebuild baseline`

That means the boot order was already correct, but the file itself had no new modification event for Cursor/Git to show. The fix is to add the ANU governance/sensorium runtime surface directly to `index.v2.html` so this entrypoint now records the current ANU contract.

## 2026-05-10 — ANU Governance Sensorium Timeline

Commit baseline: `dfe8455 feat(v2): add ANU world governance sensorium`

| File | Timeline role | Current milestone |
|---|---|---|
| `index.v2.html` | V2 boot entry and module activation order | ANU loads first and now advertises governance/sensorium/fuzzy exports in the dev hint and module roadmap comments. |
| `js/v2/AnuModule.js` | Public `window.AnuUniverse` API | Exposes governance rules, fuzzy bottleneck sensor, world sensorium, simulation domains, interaction verbs, and ANU pipeline memory. |
| `js/v2/World.js` | Terrain, player body, gravity/elevation physics | `WorldPhysics.getAnuPhysicsSnapshot()` proves 3D gravity, XYZ motion, terrain height sampling, and elevation/normal detection. |
| `js/v2/Trees.js` | Flora model domain | Tags tree instances with stable ANU ID/domain/kind and interaction verbs. |
| `js/v2/anu/SceneModelInventory.js` | Object/world scanner | Captures `anuId`, `anuKind`, domain, interaction verbs, interactable status, rollups, and world position. |
| `js/v2/anu/SimulationController.js` | Simulation domain contract | Defines player/environment/flora/fauna/structures/population/items plus interaction verbs and conventions. |
| `js/v2/anu/AnuFuzzyPipelineSensor.js` | Bottleneck diagnosis | Ranks likely pressure points for AI from frame budget, PiP, triangles, draw calls, module errors, and loop errors. |
| `js/v2/anu/AnuWorldSensorium.js` | Unified ANU awareness | Combines scene inventory, domains, interactions, governance, simulation overview, and fuzzy pipeline state. |
| `js/v2/anu/AnuGovernanceRules.js` | Runtime rule authority | Makes model registration, interaction registration, 3D gravity, 3D elevation physics, and AI IO authority explicit. |
| `js/v2/anu/anuEvents.js` | Event namespace | Adds fuzzy pipeline, world sensorium, governance, and item event names. |
| `js/v2/anu/index.js` | ANU barrel exports | Re-exports the new governance/sensorium/fuzzy APIs. |
| `.cursor/rules/agent-task-workflow.mdc` | Agent closeout timeline | Requires mandatory proof-backed task summaries. |
| `.cursor/rules/live-state-and-apple-silicon.mdc` | Agent environment timeline | Records live filesystem sync and Apple Silicon/ARM Playwright handling. |

## 2026-05-10 — Avatar3 Player Figurine Timeline

| File | Timeline role | Current milestone |
|---|---|---|
| `Assets/Avatar3.glb` | Player model source | Studied as a Draco-compressed GLB with 1 mesh, 1 skin, 43 nodes, and 9 animation clips (`NlaTrack` through `NlaTrack.008`). |
| `js/v2/World.js` | Player avatar, physics, camera, NPC proximity behavior | Removes the disabled Avatar3 branch, installs Avatar3 as the governed player figurine, corrects the 90-degree left-facing model offset, stores all clips, adds a travel circle, plays walk/look/idle/wave states, and adds front/chase camera behavior. |
| `js/v2/anu/anuEvents.js` | Avatar/NPC event namespace | Adds player avatar animation and player/NPC greeting events. |
| `js/v2/AnuModule.js` | ANU pipeline memory | Records Avatar3 as a governed player figurine milestone. |

## 2026-05-10 — World modularization, dual PiP cameras, moondial stacking, runtime services

Branch snapshot: `main` — full V2 engine slice committed together (World split, Orchestrator PiP modes, PanelsPIP moondial fixes, Anu runtime service registry, Playwright smoke harness).

| File | Timeline role | Current milestone |
|---|---|---|
| `js/v2/World.js` | World module facade | Composes terrain, physics, avatar controller, player input/sync, structures; keeps zero-allocation update discipline; NPC greeting / camera smoothing live here or via imports. |
| `js/v2/WorldTerrain.js` | Terrain + neu-hex shader | `terrainY`, `applyNeuHexShader`, shared with Phase 1 terrain formula. |
| `js/v2/WorldPhysics.js` | Physics bodies + grounding | `WorldPhysics`, gravity/jump constants, terrain collision — exported for Anu snapshots. |
| `js/v2/WorldAvatar.js` | Avatar3 figurine | `createWorldAvatarController()` — Draco GLB, clips, travel circle, animation states. |
| `js/v2/WorldPlayerController.js` | Input → velocity | Key map, autowalk sync, `buildWorldPlayerState` / `wirePlayerInput`. |
| `js/v2/WorldStructures.js` | Placeholder structures | e.g. center tipi load hook. |
| `js/v2/RuntimeServices.js` | Cross-module registry | `registerRuntimeService`, snapshots + contract validation surfaced through `AnuModule`. |
| `js/v2/Orchestrator.js` | Render loop + PiP | `_renderPip`: orthographic minimap when main view is FPV; perspective “spirit” PiP when main is map view; resize + second GL context policy unchanged at heart. |
| `js/v2/UIModule.js` | Moondial / PanelsPIP | `#pipCanvas` WebGL target, `#pipOverlay` 2D GPS dashed ring, `#pip-hit-plane` full-lens clicks, `#season-ring` z-order; DOM order: overlay canvas last in wrapper for stable compositing. |
| `js/v2/constants.js` | Tunables | Player move speed, PiP hex span / ortho zoom, `V2_PIP_RENDER_EVERY_N_FRAMES`, adaptive stride caps. |
| `js/v2/anu/PipRenderStrategy.js` | PiP strategy hook | Expanded toward surrogate/minimap policy (Phase 3 ladder). |
| `js/v2/anu/FrameBudget.js` | Wall-clock frame telemetry | Rolling average for adaptive policy. |
| `js/v2/anu/anuEvents.js` | Event ids | Avatar/NPC/player events aligned with world + UI. |
| `js/v2/Trees.js` | Flora | Domain tags / verbs / instance policy alignment with simulation controller. |
| `js/v2/AnuModule.js` | `window.AnuUniverse` | Pipeline memory, fuzzy sensor, sensorium, governance exports, **runtime service** snapshots from `RuntimeServices.js`. |
| `playwright.config.js` | E2E config | Local HTTP server assumption documented in file. |
| `tests/v2-smoke.spec.js` | Smoke | Boot / canvas / Anu presence checks for CI or local `npx playwright test`. |
| `package.json` | Scripts | Playwright (or test) script entries if present. |
| `.cursor/rules/live-state-and-apple-silicon.mdc` | Agent env | Apple Silicon / Playwright notes. |
| `index.v2.html` | Boot | Module registration order and dev hints stay aligned with Anu-first governance. |

**Forensic — GPS “player circle”:** The dashed ring is **2D** on `#pipOverlay`, not world geometry. It must redraw in `PanelsPIP.update()`, track dial pixel size via `ResizeObserver`, and sit **above** `#season-ring` in z-index (and ideally last in DOM) so the seasonal mask hole does not hide it.

## 2026-05-10 — 78 → 100 program (Phases 0–9, baseline/v0 → baseline/v1)

A 14-commit governance + observability program that took the engine from a
prose-rated 78 (rubric ~75) to **94 / 100** against the rubric in
[`SCORECARD.md`](SCORECARD.md). End-state captured in
[`baselines/2026-05-10-final.md`](baselines/2026-05-10-final.md).

| Commit | Phase | Files (timeline role · current milestone) |
|---|---|---|
| `72e6171` | **Phase 0 — Charter** | `docs/SCORECARD.md` (10-dim rubric, weights, scoring rules, capture protocol) · `docs/baselines/2026-05-10.md` (frozen pre-program snapshot, score 75). Tag `baseline/v0`. |
| `6d4377b` | **Phase 1 — Asset gate** | `scripts/check-assets.mjs` (existence + GLB magic header + taxonomy classifier · STRICT/WARN tiers) · `Assets/README.md` (gate workflow + add/remove checklists) · `package.json` (`check:assets` wired into `npm test`). |
| `2cb94a4` | **Phase 2 — ANU live audit hardening** | `js/v2/AnuModule.js` (+5 memory cards · +4 defensive checks in `evaluateLivePipelineRisk` · `AnuUniverse.help()` returns + prints frozen 13-group method index · `report()` labels match public API names). |
| `ca6f9b8` | **Phase 2.5 — Season dial click-through** | `js/v2/UIModule.js` (`.season-outer-bg { pointer-events: none; background: transparent; box-shadow: none }` so PiP glass receives clicks). |
| `f4e9314` | **Phase 3 — Runtime service contracts** | `js/v2/RuntimeServices.js` (`RUNTIME_SERVICE_CONTRACTS` extended with optional services + method shape (arity); `validateRuntimeServiceContracts` returns `{ ok, missing, malformed }`) · `js/v2/AnuModule.js` (`AnuUniverse.services.list/.validate/.contracts` namespace). |
| `4b1ee10` | **Phase 4 — Orchestrator hardening** | `js/v2/Orchestrator.js` (`_renderPip` decomposed into `_preparePipScene` → `_renderPipPass` → `_restorePipScene` with try/finally restore · HUD `#v2-pip` status line `PiP=on stride:N phase:M rendered:✓` · `_pipRenderedLastFrame` cleared on dispose · `dispose()` JSDoc) · ANU memory card `orchestrator-pip-decomp-and-hud-line`. |
| `f0d572f` | **Phase 4.5 — HUD frame telemetry** | `js/v2/anu/FrameBudget.js` (`getFrameSamples()`, `getFrameSamplesCapacity()`) · `js/v2/Orchestrator.js` (`_drawFrameGraph()` — vertical-bar sparkline · `LOAD %` text + ms detail in HUD). |
| `c2793b9` | **Phase 4.6 — Contain HUD graph** | `js/v2/Orchestrator.js` (HUD `width:240px` · graph `width:200px` · `box-sizing:border-box; overflow:hidden` so the graph cannot escape the modal). |
| `87d1e3e` | **Phase 5 — UI/PiP visual fidelity** | `js/v2/WorldStructures.js` (NPC YB gold travel arrow material aligned to shared decal policy: `depthTest:false`, `depthWrite:false`, `renderOrder:10`) · `js/v2/Orchestrator.js` (`_pipUserZoom` field, `v2-pip-zoom-change` event listener, `localStorage` persist, frustum span = `V2_PIP_ORTHO_WIDTH * V2_PIP_ORTHO_ZOOM * _pipUserZoom`) · ANU cards `pip-user-zoom-wire-up`, `npc-arrow-decal-policy-alignment`. |
| `4310967` | **Phase 6 — Test pyramid** | `tests/v2-fidelity.spec.js` (NEW · 4 fidelity tests: PiP render sentinel via `_pipRenderedLastFrame` + `info.render.calls` + `governor.pipPhase` · floor decal depth policy enforcement · moondial UI surface presence + season ring click-pass-through · governor + service contracts mutation with state restore) · `package.json` (`test:fidelity` + `npm test` chains all four gates) · `js/v2/Orchestrator.js` (HUD frame-graph repositioned directly under FPS counter). |
| `3995fbe` | **Phase 6.6 — NPC YB scene polish** | `js/v2/constants.js` (`V2_NPC_YB_TIPI1_LOCAL_Z_M` -1ft N · ceremonial fire constants `V2_TIPI_NPC_CEREMONIAL_FIRE_*`) · `js/v2/TipiCampfire.js` (`createTipiCampfire` accepts optional `scale`, `lightIntensity`, `lightDistance`, `anuIdOverride`) · `js/v2/WorldStructures.js` (NPC GLB X/Z centred on bbox · facing arrow flipped 180° · canvas radial-gradient sprite halo with `AdditiveBlending` · 6" ceremonial fire 1ft S, 1ft above terrain, integrated into `tipiAmbientEffectsUpdate` + `anuSubsystemIds` + PiP discard list). |
| `6b143f9` | **Phase 7 — Legacy & WP drift reconciliation** | `docs/legacy-reconciliation.md` (NEW · KEEP/FROZEN/SUNSET matrix per tree: `js/v2/` KEEP-canonical · `WORDPRESS/` KEEP-FROZEN production bundle · `dist/` KEEP-artifact · `js/` (non-v2) FROZEN reference · `_legacy_archive/` SUNSET read-only · `scratch/` SUNSET deletable · `SacredOnes.1/` KEEP sibling exploration · asset gate STRICT/WARN tiers map directly to this policy · 5-step legacy-port protocol: read → re-implement in v2 → add fidelity test → ANU card → leave legacy alone) · ANU card `legacy-tree-reconciliation`. |
| `3a9b660` | **Phase 7.5 — Neomorphic equalizer** | `js/v2/anu/FrameBudget.js` (`_ROLL_LEN` 45 → 40, comment explaining 32-bar visible window + 8-sample lookback) · `js/v2/Orchestrator.js` (recessed neomorphic graph well: 204×46px, 9px radius, inset shadow stack, amber inner highlight · 32-bar equalizer renderer with per-bar gradient (green/amber/red by own load ratio), rounded-top bar paths, 1px peak-cap with severity-scaled alpha, dashed amber 1.0× budget reference line). |
| `2439e53` | **Phase 8 — Documentation & DX** | `README.md` (NEW · top-level entry · quick-start, tree map, key invariants, validation gate) · `CONTRIBUTING.md` (NEW · workflow rules summary, npm scripts table, asset gate explanation, ANU memory card schema, full doc map, Apple-Silicon Playwright pointer) · `docs/anu-cheatsheet.md` (NEW · markdown mirror of `AnuUniverse.help()` with three quick recipes) · `Assets/README.md` (cross-link to legacy reconciliation) · `index.v2.html` (`#v2-hint` block bolds `AnuUniverse.help()` first; boot console adds highlighted `Start here →` banner) · ANU card `phase-8-docs-and-dx`. |
| `4247994` | **Phase 9 — Final integration check** | `js/v2/Orchestrator.js` (HUD section heading `ACTIVE MODULES` → `UNIVERSE` per user request — same registry, more readable label) · `docs/baselines/2026-05-10-final.md` (NEW · full closeout following the SCORECARD §Capture protocol · inventory deltas · score reassessment per dimension with deltas · final 94/100 honest read · 5 named out-of-scope follow-ups) · ANU card `phase-9-final-integration`. Tag `baseline/v1`. |

### Net deltas (baseline/v0 → baseline/v1)

| Surface | v0 | v1 | Δ |
|---|---:|---:|---:|
| `js/v2/Orchestrator.js` LOC      | 821 | 1099 | +278 |
| `js/v2/AnuModule.js` LOC         | 516 |  840 | +324 |
| `js/v2/RuntimeServices.js` LOC   |  88 |  165 |  +77 |
| `ANU_PIPELINE_MEMORY` cards      | ~22 |   27 |  +5  |
| Test files                       |   1 |    2 |  +1  |
| Test LOC                         | 157 |  504 | +347 |
| Top-level docs (README/CONTRIBUTING/Assets/README) | 1 | 3 | +2 |
| `docs/` files                    | ~5  | ~7 (+ baselines/) | +2 |
| Asset gate                       | none | `scripts/check-assets.mjs` in `npm test` | +1 |
| `npm test` walltime              | 53.7 s | 29.2 s | −24.5 s |
| Final score (rubric)             | 75 | **94** | **+19** |

## Timeline Rule Going Forward

When a V2 milestone changes ANU, boot order, world object governance, or module contracts, update this file in the same commit as the code change. If a referenced file was intentionally not changed, record why in a forensic note instead of pretending it moved.

For multi-phase programs (like 78 → 100), use a single dated section with one row per commit + a deltas summary table at the end. Tags should bracket the program (`baseline/v<n>` at start; `baseline/v<n+1>` at close).
