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

## Timeline Rule Going Forward

When a V2 milestone changes ANU, boot order, world object governance, or module contracts, update this file in the same commit as the code change. If a referenced file was intentionally not changed, record why in a forensic note instead of pretending it moved.
