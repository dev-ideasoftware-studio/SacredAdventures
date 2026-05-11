# Contributing

This repo runs the **Sacred Adventures v2 engine** under `js/v2/`. The
canonical entry point is `index.v2.html`. Everything outside `js/v2/` is
documented under [`docs/legacy-reconciliation.md`](docs/legacy-reconciliation.md);
read that first if you are tempted to edit `WORDPRESS/`, `dist/`, the
non-v2 part of `js/`, `_legacy_archive/`, or `scratch/`.

---

## TL;DR

```bash
npm install
npm run dev          # live-server at http://127.0.0.1:8080
npm test             # check:v2 + check:assets + smoke + fidelity
```

Then open http://127.0.0.1:8080/index.v2.html and run
`AnuUniverse.help()` in DevTools.

---

## The hard scope rule

> **Before substantive edits, you must be able to state the exact list of
> files you will change and why each is required by the instruction. If
> you cannot, ask first.**

This is `.cursor/rules/agent-task-workflow.mdc` §0. Drive-bys, refactors
"while I'm here", or unrelated formatting sweeps are rejected even if
the narrow change works.

The PiP / live map area has its own invariant —
`.cursor/rules/sacred-pip-map-protect.mdc`. Never replace or obscure
parent `#pipCanvas` / Orchestrator PiP with solid textures or render-path
changes unless the user explicitly asks.

---

## Workflow per substantive instruction

1. **Card the instruction** — first reply quotes / paraphrases the user
   request so the goal is visible at a glance.
2. **Plan with todos** — decompose into setup → implement → verify steps.
   One `in_progress` at a time.
3. **Edit only files in scope.** No drive-bys.
4. **Run validation**:
   - `npm test` (the full gate — see below).
   - `read_lints` on every touched file.
   - For substantive work, the **§3.1 workflow compliance audit** in
     the rule file.
   - For anything that touches `js/v2/**`, the **§3.2 Anu pass** —
     re-read `js/v2/AnuModule.js` (`ANU_PIPELINE_MEMORY`,
     `evaluateLivePipelineRisk`) and confirm no recorded incident is
     re-introduced.
5. **Document** — when the change records a new lesson, append a card
   to `ANU_PIPELINE_MEMORY` so future agents see the provenance.
6. **Final reply** — Instruction · What changed · Validation · Task
   Summary (Asked / Provided / Proof).

---

## NPM scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Local static server (`live-server`). |
| `npm run check:v2` | `node --input-type=module --check` on every canonical v2 module. Catches ESM syntax errors before Playwright spins up. |
| `npm run check:assets` | Asset gate (see below). |
| `npm run test:v2` | Playwright smoke: boot, lifecycle, services, disposal, movement. |
| `npm run test:fidelity` | Playwright fidelity: PiP render sentinel, decal depth policy, dial layout, governor + contracts mutation. |
| `npm test` | All four — `check:v2 && check:assets && test:v2 && test:fidelity`. **This must pass before any commit closing a phase.** |

If a Playwright run cannot find Chromium for `mac-arm64`, run:

```bash
PLAYWRIGHT_BROWSERS_PATH=0 npx playwright install chromium
```

…per `.cursor/rules/live-state-and-apple-silicon.mdc`.

---

## Asset gate

`scripts/check-assets.mjs` is the automated guard against dangling
`Assets/...` references.

- **STRICT** trees — `js/v2/**`, `index.v2.html`. A missing or corrupt
  asset here exits 1 and fails the gate.
- **WARN** trees — `js/` (non-v2), `dist/`, `WORDPRESS/`,
  `SacredOnes.1/`, `_legacy_archive/`, `scratch/`. Reported but do not
  fail. These are the documented legacy drift; see
  [`docs/legacy-reconciliation.md`](docs/legacy-reconciliation.md).

For adding / removing / renaming an asset, follow the checklists in
[`Assets/README.md`](Assets/README.md).

---

## Tests

Two specs live under `tests/`:

- `tests/v2-smoke.spec.js` — boot, lifecycle, service binding, disposal,
  movement.
- `tests/v2-fidelity.spec.js` — PiP render sentinel (rAF-poll until a
  real PiP frame), floor-decal depth policy enforcement, moondial UI
  layout + click-through, RenderingGovernor + RuntimeServices mutation
  with state restore.

When you change a v2 module, ask:

- Does an existing fidelity assertion already cover the surface? Re-read
  `tests/v2-fidelity.spec.js` first.
- If you are introducing a new invariant, add a fidelity test for it in
  the same commit.

---

## ANU memory cards

`ANU_PIPELINE_MEMORY` (in `js/v2/AnuModule.js`) is the project's lessons
ledger. Each card has:

- `id` — kebab-case unique key.
- `learnedAt` — `YYYY-MM`.
- `title` — one-line headline.
- `summary` — 2–4 sentences explaining the regression / fix.
- `mitigations` — bulleted rules future agents should follow.
- `files` — paths the lesson lives in.

Add a card when you fix something that future-you (or a future agent)
might re-break. Ten minutes of writing here saves hours of re-discovery.

The Anu surface itself is documented in
[`docs/anu-cheatsheet.md`](docs/anu-cheatsheet.md) — call
`AnuUniverse.help()` in DevTools for the live grouped index.

---

## Documentation map

| Path | What it owns |
|---|---|
| [`docs/SCORECARD.md`](docs/SCORECARD.md) | The 10-dimension rubric used for the 78→100 program. |
| [`docs/baselines/2026-05-10.md`](docs/baselines/2026-05-10.md) | Phase 0 baseline snapshot (LOC, modules, GLB census, test exit codes). |
| [`docs/legacy-reconciliation.md`](docs/legacy-reconciliation.md) | Keep / freeze / sunset matrix for every parallel code tree. |
| [`docs/anu-cheatsheet.md`](docs/anu-cheatsheet.md) | AnuUniverse API reference (mirror of `AnuUniverse.help()`). |
| [`Assets/README.md`](Assets/README.md) | Asset taxonomy + add / remove / rename checklists. |
| [`docs/V2_FILE_TIMELINE.md`](docs/V2_FILE_TIMELINE.md) | When each v2 file landed (legacy reference). |
| [`docs/V2_SENTIENT_RUNTIME_PLAN.md`](docs/V2_SENTIENT_RUNTIME_PLAN.md) | Long-form design intent for the runtime (legacy reference). |
| [`docs/CODEBASE_STUDY.md`](docs/CODEBASE_STUDY.md) | Earlier deep-read of the codebase (legacy reference). |
| `.cursor/rules/` | Always-on agent rules: scope lock, PiP/map protect, live-state + Apple-Silicon. |

---

## Style

- Match the surrounding file's style (naming, indent, brace placement).
- Comments explain **why** / non-obvious intent — not what the code
  obviously does.
- New constants live in `js/v2/constants.js` with a comment that ties
  them to a real-world unit or a referenced ANU memory card.

---

## When in doubt

Ask. The cheapest fix is the one that does not have to be rolled back.
