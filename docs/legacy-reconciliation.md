# Legacy & WordPress drift — reconciliation policy

Status: **Phase 7 of the 78→100 program.**
Last updated: 2026-05-10.

The repo holds several parallel code trees that pre-date the canonical v2
engine (`js/v2/`). This document is the source of truth for **which trees
are alive, which are frozen, and which are sunset**, plus the rules an
agent must follow before touching anything outside `js/v2/`.

> **Hard rule:** when in doubt about a non-`js/v2/` file, do **not** edit
> it. Read this doc first; if scope is still unclear, ask the user.

---

## Tree-by-tree classification

| Tree | Status | Owns / loaded by | Edit policy |
|---|---|---|---|
| `js/v2/` | **KEEP — canonical** | The v2 engine: `Orchestrator`, `World*`, `Trees`, `Flora`, `AnuModule`, `RuntimeServices`, `UIModule`, `V2Panel`, `anu/*`. Loaded by `index.v2.html`. | Free to edit, with the workflow rules in `.cursor/rules/` (scope lock, Anu compliance audit, etc.). |
| `WORDPRESS/` | **KEEP — FROZEN production bundle** | The deployed WordPress experience. Has its own `dist/`, `js/`, `Assets/`, `index.html`, `sw.js`, `manifest.json`. | Touch only when shipping a deploy or a bugfix to the WP-only path. Do **not** mirror `js/v2/` changes here unless explicitly asked — the v2 path lives independently. |
| `dist/` | **KEEP — generated artifact** | Built output that parallels parts of the v2 / legacy engine for static hosting. | Treat as build output. Do not hand-edit; if the source needs changes, edit `js/v2/` (or the legacy source) and rebuild. |
| `js/` (non-`v2/` files) | **FROZEN — legacy reference** | `EngineMain.js`, `EngineMain.mjs`, `Engine.js`, `EnvironmentBuilder.js`, `Constants.js`, `MasterAI.js`, `MasterNPCAI.js`, `Universe.Anu.js`, `Component.*` (BirdSystem, CameraDirector, HerdSystem, LLMAssistant, NextGenWildlife, PostProcessing, RabbitSystem), `Data.Fish.js`, `GameObjectsDatabase.js`, `main.js`, `test_rt.js`, `debug_log.js`, `components/`, `engine/`, `systems/`. Some are still loaded by `WORDPRESS/index.html`. | Read for reference (the v2 modules port concepts from here). Do **not** modify in service of v2 work — port the change into `js/v2/` instead. Bug fixes that ship via the WP bundle may still land here, narrowly scoped. |
| `_legacy_archive/` | **SUNSET — read-only archive** | HTML snapshots and components from before v2 (`Adventure.*.html`, `JournalPanel.html`, `MapEditor.html`, `Sacred.FPV.Unreal.html`, `Component.AssetFactory.NextGen.js`, …). | Reference only. Do not edit, do not move. If something here becomes useful, copy the relevant slice into `js/v2/` (or `docs/`) instead. |
| `scratch/` | **SUNSET — deletable** | Temporary debug scripts (`deep_forensic.js`, `inspect_npcs*.js`, `restore_pip.js`, `test_*.js`, `script_*.js`, `report_animations.js`, …). Nothing in the live engine imports these. | Safe to delete in a cleanup pass. Do not add new code here; create a real test under `tests/` instead. |
| `SacredOnes.1/` | **KEEP — sibling exploration** | Separate Vite project (`package.json`, `vite`-style `src/`, `public/`, `index.html`). Independent of the v2 engine. | Out of scope for the v2 78→100 program. Do not touch unless the user asks for a sibling-project change. |
| `WORDPRESS/scratch/`, `WORDPRESS/dist/`, `WORDPRESS/SacredOnes.1/` | **FROZEN with their parent** | Sub-trees of `WORDPRESS/`. | Same edit policy as `WORDPRESS/`. |

---

## Asset gate tiers

`scripts/check-assets.mjs` already encodes this policy:

- **STRICT** (`js/v2/`, `index.v2.html`): missing or malformed assets fail
  the gate. The v2 engine MUST stay clean.
- **WARN** (`js/`, `dist/`, `WORDPRESS/`, `SacredOnes.1/`,
  `_legacy_archive/`, `scratch/`): missing assets are reported but do not
  fail the gate. They are the long-tail drift this document accepts as
  expected debt.

As of the current snapshot the gate reports **31 WARN-tier missing
assets** — all in legacy / WordPress / scratch trees. They will not be
chased one-by-one; they exist because the legacy code referenced models /
textures that have since been removed or renamed. Two reasons we accept
this:

1. The legacy code paths are FROZEN; the references will not multiply.
2. Replacing every reference with a stub would mean editing FROZEN code,
   which violates this policy.

If a WARN-tier reference becomes a real production blocker (e.g. a
WordPress page actually fetches it and crashes), promote it to a focused
fix on the WordPress page only, not a sweep.

---

## How to do a future legacy port the right way

Preferred sequence when you find behaviour worth keeping in legacy code:

1. **Read** the legacy source under `js/` or `_legacy_archive/`. Do not
   edit it.
2. **Re-implement** the slice you need inside a `js/v2/` module
   (existing one if natural, new file if not).
3. **Add a test** in `tests/v2-fidelity.spec.js` or a new spec.
4. **Document** the port in an ANU memory card so future agents see the
   provenance.
5. **Leave the legacy file alone** — do not delete it, do not "improve"
   it. It stays as the reference snapshot.

This protocol is captured by the ANU memory card
`legacy-tree-reconciliation` (see `js/v2/AnuModule.js`).

---

## Tags

- The current snapshot is what `baseline/v0` (Phase 0 tag) captured.
- Phase 7 itself does **not** add a new git tag — the classification is
  metadata, not a code change. The next milestone tag (`78to100/phase-9`)
  will record the post-program state.

---

## When this policy needs to change

- A FROZEN tree starts failing at runtime in a way that affects the v2
  experience → revisit, and document the exception in this file before
  editing.
- A SUNSET tree gets a new dependent → it is no longer SUNSET; reclassify
  here first.
- The user explicitly widens scope ("yes, refactor `js/MasterAI.js`") →
  follow that, but update this doc in the same commit so the next agent
  sees the new boundary.

---

## May-17 2026 forensic cleanup — update log

Applied during the "fix all tier" pass after the Anu deep-forensic
report. Use this section as the running ledger for what came out of the
tree and what still requires owner sign-off.

### Tier 1 (landed)

- `js/v2/anu/RenderingGovernor.js` — `MAIN_RENDERER_BLUEPRINT` now
  mirrors `js/v2/Orchestrator.js:81-104` field-for-field
  (antialias=true, pixelRatioCap=2.0, shadowMapEnabled=true).
- `js/v2/WorldPondEnclavePond1.js` — **deleted**. Replaced by
  `WorldPool2.js`; no live importers.
- `js/v2/WorldTipiProcedural.js`, `js/v2/WorldFigureProcedural.js` —
  **deleted**. Were gated off by `USE_PROCEDURAL_*` flags that have
  also been removed from `WorldStructures.js`.
- `scratch/` — pruned from 64 → 11 files. Kept: today's diagnostics
  (`probe-anu-forensic`, `probe-fps-diagnose`, `probe-may17-*`,
  `probe-josh-*`, `probe-trader-josh`, `probe-fishing-redesign`,
  `probe-render-state`, `probe-quiet-glade`, `quick-error-check`).
  53 obsolete scripts moved to `/tmp/scratch-deleted/` (rebootable).

### Tier 2 (landed)

- `updateYellowButterflyPlayerAim` + `updateBringsHappinessPlayerAim`
  now share `updateSeatedNpcPlayerAim(tipi, x, z, cfg)`; the two
  exports remain as thin shims (keeps every external caller working).
- `Orchestrator._computePipBackingSize(canvasEl)` is now the single
  source of truth for the PiP DPR + backing-size compute (used by
  both `_ensurePipPipeline` and `_resizePipIfNeeded`).

### Tier 3 (partial — pragmatic call)

- Extracted `tagSeatedNpcMeshes(model, anuKind, anuIdPrefix)` and
  `fitSeatedNpcToGroup(model, targetH, sizeMul)` from the duplicated
  YB/BHG attach pipelines. Removes ~30 lines of byte-identical code.
- **NOT** doing the full `_attachSeatedNpc(scene, ..., npcConfig)` +
  `_loadTipi(...)` collapse yet — Tipi 1 and Tipi 2 have meaningful
  divergences (Tipi 2 owns the quest-axe spawn + a behaviour
  controller variant; Tipi 1 hosts the journal-balloon + the
  separate ceremonial-fire). Folding them now risks a regression on
  systems the user has been actively iterating on. Revisit when a
  third tipi owner lands — that's the natural forcing function.

### Tier 4 (needs owner sign-off — NOT applied)

- `BACKUP/` (6.3 GB) and `.backup/` (1.7 GB) are pure archives. No
  live module imports them. **Recommend** off-repo cold storage
  (S3 / git LFS / cold drive) — but DO NOT delete in-tree without the
  owner confirming what's there. `BACKUP/draco-originals/` is the only
  revert path for the 5 GLBs Draco-compressed in May 2026.
- `WORDPRESS/` (1.4 GB) is **frozen production**, not archival — has
  its own `index.html`, `sw.js`, ships separately. Keep + label.

### Tier 5 (needs owner decision — NOT applied)

- `index.html` (root) + `js/EngineMain.js` + `js/EnvironmentBuilder.js`
  + 7× `Component.*.js` (~430 KB total) belong to the legacy engine
  stack. **No v2 module imports any of them.** Two viable paths:
  1. **Delete entirely** if `index.html` is no longer served.
  2. **Move under `legacy/`** and add a top-of-file deprecation
     header pointing at `index.v2.html` if it's still a fallback.

### Live-state shortcomings still unaddressed

- ~25 `window._v2*` globals (mostly journal + fishing); the right
  long-term home is the `RuntimeServices` registry already present
  in `js/v2/RuntimeServices.js`. Migration is per-global; safe to do
  one at a time.
- The two large structural duplicates in `WorldStructures.js`
  (loadCenterTipi ↔ loadTipi2WithBhg, attachYellowButterflySeatedTipi1 ↔
  attachBhgSeatedTipi2) remain — see Tier 3 note above for the
  forcing-function trigger.

---

## May-17 2026 — Following Anu exactly

Anu's deep telemetry produced an ordered priority list (items 1–8). The
first three landed this session; the rest are documented here for the
next pass.

### Landed

**Anu #1 — Tag the pond** (extended `inferSimulationDomain` in
`js/v2/anu/SceneModelInventory.js`). The Pool2/Fishing meshes now
classify via name pattern: anything containing `pool|water|lily|
waterfall|moss|fire|smoke|sky|cloud|fog` falls under ENVIRONMENT, fish
under FAUNA, dock/pier under STRUCTURES. No per-module code changes
needed.

**Anu #2 — NPC interactables** (added `inheritInteractableFromAncestors`
to the same file). The walker now climbs the parent chain looking for
`anuInteractable` on any ancestor — so the existing convention of
tagging the wrapper Group instead of every child mesh finally counts
through Anu's sensorium. Result: `population.interactables` jumped from
**0 → 21**.

**Anu #3 — Decimation pass.** Ran `scripts/simplify-and-draco.mjs` on
the four heavy Tripo GLBs:

| Asset | tris ratio | original size | new size |
|---|---|---|---|
| `Avatar3.glb` | 0.35 | 22.4 MB orig (pre-Draco BACKUP) | 5.4 MB |
| `tipi.yellowbutterfly.glb` | 0.25 | 2.99 MB | 1.53 MB |
| `NPC.YB.glb` | 0.30 | 8.40 MB | 3.16 MB |
| `NPC.BHG.glb` | 0.30 | 100.6 MB orig | 26.2 MB |

Pre-decimation originals preserved at `BACKUP/draco-originals/*.glb` so
the revert is a single `cp`. Rendered tri count dropped 2,676,922 →
**853,170 (−68 %)**. Headless FPS smooth: 48.47 → **60.18 (peak 67)** —
first time we've broken the headless RAF cap.

**Anu's primary bottleneck demoted SEVERE → ELEVATED** for the first
time in the project — score went 1.0 → 0.648, total scene tri estimate
4.23 M → 1.62 M.

### Deferred — Anu items 4–8 (need next pass)

**#4 Split World into domain owners** — extract `WorldStructures` into
`BuildingsModule`, the seated-NPC attachment code into `NPCModule`. The
duplication between `loadCenterTipi` / `loadTipi2WithBhg` and the two
attach functions is a forcing function once a third tipi owner lands;
right now Tipi 2's quest-axe + behaviour-controller divergence makes a
single-config collapse risky. Revisit when that third tipi or third NPC
owner appears.

**#5 Flora as gameplay** — re-enable Trees module, route a `harvest`
verb through it so chopping returns a wood item + respawns on a timer.
Anu's verb vocabulary already has `harvest` waiting unused.

**#6 Fauna with herds** — Fauna is currently re-enabled in v2 but not
v3. Wire `AnuNatureAwareness.senseThreat` so rabbits scatter from the
player. Already half-built; needs the activation + tuning pass.

**#7 Items module** — build `js/v2/ItemsModule.js`. Migrate the quest
axe + the journal into it. Use `pick_up` for the axe, `use` to open the
journal. Stop holding items via `window._v2*` globals.

**#8 Population memory** — store per-NPC interaction history. The
`AnuUniverse.interactions` bus already records every dispatched event;
need a per-target index + accessor (`Anu.npcMemory("yb")` returning the
log).

### Remaining `unspecified`

After tagging passes, Anu still reports `unspecified.drawables = 97`
(mostly Points particle systems for fire/smoke/sparks/sky stars). These
don't match the name patterns added in `inferSimulationDomain` — they're
named things like `tipi_brazier_flame_points`, `sky_flock_birds`, etc.
A second pass on the inferrer (add `flame_points|spark|flock|halo|
ripple` patterns) would mop those up cheaply. Anu doesn't raise an alert
about them currently (audit is empty) so I deferred.
