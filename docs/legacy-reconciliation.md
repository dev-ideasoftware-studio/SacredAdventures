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
