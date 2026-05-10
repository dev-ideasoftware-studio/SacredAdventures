# Sacred Adventures v2 — Sentient runtime & 120 FPS rollout

This document is the **canonical phased plan** for closing the loop between **telemetry → Anu policy → rendering**. Use git tags / commits aligned with phases to rewind safely.

## Philosophy

- **Sentience (engineering sense)** = observe → model → act → verify, with **hysteresis** so policies do not oscillate.
- **120 FPS** = **budget contract** (ms/frame), not a magic constant.
- **PiP** must stop paying **full-scene** cost long-term (Phase 4); Phase 1 only **reduces cadence** under stress.

---

## Phase 0 — Baseline snapshot

**Goal:** One commit that captures the full v2 stack + rules + assets so work can be replayed.

**Artifacts:** git commit on `main` (or feature branch) including `js/v2/**`, `index.v2.html`, `docs/`, key `Component.*`, `Assets/Fish/`, `.cursor/rules/*.mdc`.

**Rollback:** `git checkout <commit>`.

---

## Phase 1 — Frame timing + adaptive PiP stride (implemented in code)

**Goal:** Measure per-frame wall time in the Orchestrator loop and let Anu **raise PiP stride** (fewer minimap 3D passes) when frames run hot, and **ease back** when stable.

**Code:**

- `js/v2/anu/FrameBudget.js` — frame wall clock, rolling average, export for Anu reports.
- `js/v2/anu/AdaptiveRenderPolicy.js` — stress / relax streaks, hysteresis, calls `RenderingGovernor` to adjust stride.
- `js/v2/anu/RenderingGovernor.js` — `getEffectivePipStride()`, optional adaptive uplift vs `constants.js` baseline.

**Constants:** `V2_TARGET_FPS`, `V2_ADAPTIVE_PIP_MAX_STRIDE`, stress/relax thresholds (documented in file headers).

**Validation:** DevTools — under synthetic load, stride increases; when idle, returns toward baseline.

---

## Phase 2 — Policy ladder (CPU + render features)

**Goal:** Expand knobs Anu may turn without human editing `constants.js`.

**Candidates:**

- Skip or reduce **tree sway** matrix updates when `FrameBudget` is hot.
- Lower **HUD** update cadence (Orchestrator already throttles HUD; align with budget).
- Optional: **dynamic pixel ratio** within a clamp (requires careful validation).

**Dependency:** Phase 1 metrics stable.

---

## Phase 3 — PiP surrogate interface (design + stub)

**Goal:** Introduce `IPipCapture` / `PipRenderStrategy` so the minimap can switch from **full scene** → **RT snapshot / layer mask / impostor** without rewriting Orchestrator each time.

**Deliverables:** interface module + no-op or cheap placeholder; Orchestrator calls strategy instead of inline `_renderPip` only after review.

---

## Phase 4 — Asset & scene LOD

**Goal:** **TREE_TARGET**, mesh decimation, impostors/billboards, terrain chunk LOD.

**Dependency:** art pipeline + profiling; separate from policy code.

---

## Phase 5 — Closed-loop “sentient” goals (optional ML later)

**Goal:** Explicit **goal state** (e.g. min FPS, max PiP latency) and **reward** = stable frame time + low variance.

**Deliverables:** Anu state machine (idle / degrade / recover), audit log, rollback if metrics worsen.

---

## Task workflow

Follow `.cursor/rules/agent-task-workflow.mdc` and **§3.1 Anu** validation on every change touching `js/v2/**` or `anu/**`.

For **1:1 visual work**, follow `.cursor/rules/sacred-fidelity-parity.mdc`.

---

## Revision history

| Date       | Note                                      |
|------------|-------------------------------------------|
| 2026-05-09 | Phase 1 landed: `FrameBudget`, `AdaptiveRenderPolicy`, adaptive PiP stride |
