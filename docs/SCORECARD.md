# SacredOnes — System Scorecard (78 → 100 program)

This rubric is the single source of truth used by the **78 → 100** master plan.
Phase 0 establishes it; Phase 9 re-scores against it.

A score is **not** an opinion ladder — every dimension has explicit criteria so
two readers should produce the same number ± 3 points.

---

## Scoring scale (per dimension)

| Band | Range | Meaning |
|------|-------|---------|
| Critical gap | 0–39   | Missing or actively harmful; blocks production. |
| Prototype    | 40–59  | Works in the happy path; obvious failure modes unhandled. |
| Working      | 60–74  | Real users could use it; observable defects remain. |
| Solid        | 75–87  | Hardened; defects are edge cases; documented. |
| Excellent    | 88–95  | Self-monitoring; tested; defended against drift. |
| World-class  | 96–100 | Self-healing or fully governed; new contributor productive in < 1 hr. |

---

## Dimensions and weights

Total weight = **100**. Final score = Σ(dimension × weight ÷ 100).

| # | Dimension | Weight | What it measures |
|---|-----------|-------:|------------------|
| 1 | Architecture & clarity         | 12 | Module boundaries, single-source-of-truth files, naming, lifecycle. |
| 2 | Observability & live audit     | 14 | `AnuUniverse.audit/report/budget`, fuzzy/sensorium/governance reach, HUD truthfulness. |
| 3 | Runtime safety & isolation     | 12 | try/catch boundaries, dispose paths, service contracts, no silent globals. |
| 4 | Performance honesty            | 10 | Per-context tri/draw accounting, PiP cost transparency, adaptive policy correctness. |
| 5 | Completeness vs roadmap        | 10 | Active modules vs designed modules; “planned” items not silently regressed. |
| 6 | Test coverage & gates          | 12 | `check:v2` + Playwright + asset gate + Anu API spec; visible CI/local commands. |
| 7 | Asset pipeline integrity       | 10 | Manifest, GLB header probe, taxonomy, no dangling refs. |
| 8 | Documentation & DX             | 10 | New contributor flow, API cheatsheet, scope/PiP rules, contributing guide. |
| 9 | Legacy/WordPress drift control |  5 | Tri-tree (`js/`, `dist/`, `WORDPRESS/`) status declared; canonical = `js/v2/**`. |
| 10| Visual fidelity & UX           |  5 | Decals readable on terrain, dial separation, PiP map always intact. |

> Dimension 1 + 2 + 3 dominate (38 pts) because they are what make a complex
> game shell *governable*.

---

## Per-dimension scoring rules

### 1. Architecture & clarity (weight 12)

- +25 each for: clear module registry / lifecycle; single-source render policy
  (e.g. `RenderingGovernor`); explicit ANU portal (`AnuUniverse`); orchestrator
  does not duplicate module logic.
- −10 each for: undocumented globals replacing services; circular imports;
  > 1 source of truth for the same constant.

### 2. Observability & live audit (weight 14)

- +20 each for: `audit()` returns warnings + ok list; `report()` matches public
  API names; fuzzy bottleneck sensor; stress ledger; sensorium; governance;
  scene inventory; help/index method.
- −10 each for: silent failure modes; warning stored only in console; method
  name drift between docs/code.

### 3. Runtime safety & isolation (weight 12)

- +20 each for: per-module `update` try/catch with ledger; outer RAF try/catch;
  `dispose()` cancels RAF, deactivates modules in reverse, tears PiP; service
  registry validates contracts; optional services declared.
- −15 for any path that can throw out of the RAF loop unobserved.

### 4. Performance honesty (weight 10)

- +25 each for: HUD documents that tri/draw counts are main-renderer only;
  PiP cost surfaced (stride/phase/pip-on-this-frame); adaptive policy clamped
  to baseline–MAX; no second context unaccounted for.
- −10 for HUD numbers the user could mistake for total GPU truth.

### 5. Completeness vs roadmap (weight 10)

- +20 per active module pillar (player, terrain, structures, flora, fauna, npc,
  celestial, UI, audit). Score is fraction of pillars active and integrated.

### 6. Test coverage & gates (weight 12)

- +20 each for: `check:v2` syntax gate; Playwright smoke (boot, dispose,
  movement); asset existence gate; Anu API contract test; visual sentinel
  for PiP / decals / dial DOM.

### 7. Asset pipeline integrity (weight 10)

- +25 each for: manifest of all referenced asset paths; header/byte sanity for
  GLB; CI step running gate; taxonomy enforcement (`Assets/README.md`).

### 8. Documentation & DX (weight 10)

- +25 each for: `CONTRIBUTING.md` with workflow rule; API cheatsheet visible
  in `index.v2.html` boot hint; `Assets/README.md` cross-link; runnable
  one-liner for full validation (`npm test`).

### 9. Legacy / WordPress drift (weight 5)

- +50 each for: `LEGACY.md` declaring keep/freeze/sunset per top-level tree;
  banner pointing legacy files at `js/v2/**` canonical paths.

### 10. Visual fidelity & UX (weight 5)

- +25 each for: travel ring/disc visible on uneven terrain; dial separation
  (compass / phase / glass / hover-season / zoom) free of overlap at 1× and 2×
  DPR; parent `#pipCanvas` shows live WebGL map (never a flat fill); zoom UI
  wired to ortho zoom.

---

## Capture protocol (used by Phase 0 baseline & Phase 9 final)

For each scoring run, paste into the dated baseline file:

1. `git rev-parse HEAD` and `git status --short --branch`.
2. Output of `npm test` (exit code, last 30 lines).
3. In-browser console paste (boot `index.v2.html`, then run):
   - `AnuUniverse.audit()`
   - `AnuUniverse.report()`
   - `AnuUniverse.budget.snapshot()`
   - `AnuUniverse.services?.list?.()` (Phase 3 onward)
   - `AnuUniverse.help?.()` (Phase 2 onward)
4. Per-dimension score with one-sentence justification + delta vs previous run.

---

## Targets

- **Baseline (today):** documented as 78 (see `docs/baselines/2026-05-10.md`).
- **Phase 9 target:** average ≥ **97**, no dimension below **95**.
- **Hard floors that must hold every phase:** Dim 3 ≥ 80, Dim 10 ≥ 80
  (safety + visual fidelity should never regress in the chase for points).
