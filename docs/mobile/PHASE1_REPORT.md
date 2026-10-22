# Mobile Optimization — Phase 1: One Source of Truth for "Is Mobile"

*2026-10-22 · Coder 1 · approved by Mark ("go phase 1")*

```
PHASE 1 — One source of truth for "is mobile"
Base: 6b8cf51   Branch: claude/mobile-optimization
Files claimed: js/v2/deviceProfile.js (new), js/v2/Orchestrator.js,
               js/sanctuary/AnuAdaptiveDpr.js, js/v2/gltfLoaderSetup.js
               (+ tools/mobile/*, docs/mobile/* for tests and evidence)
```

The claim is recorded here rather than in `tmp/handoff.md`: that file has uncommitted local edits on Mark's machine, and a commit touching it would block his checkout of this branch.

## Verified facts (from Phase 0, re-traced before editing)

| Fact | Evidence |
|---|---|
| 4 live copies of the UA rule | `grep` over the 79-file live graph: `Orchestrator.js:106–109`, `Orchestrator.js:1086–1089`, `AnuAdaptiveDpr.js:159–162`, `gltfLoaderSetup.js:63–69` (at 6b8cf51) |
| Nothing outside `Orchestrator.js` reads `orc._isMobile` | `grep "_isMobile"` over live files and all iframe HTML/JS: only `Orchestrator.js` |
| `_pipMobileDisabled` is written, never read | only hit is the assignment, `Orchestrator.js:1091` (at 6b8cf51) |
| `window.__mobileTexCap` is written, never read | only hit is `Orchestrator.js:204` |
| `mobileGlbUrl()` is the only consumer of `_isMobileUA()` and runs on every `GLTFLoaderWithDraco.load` | `gltfLoaderSetup.js:74, 91`; 6 live importers (SanctuaryAvatar, SanctuaryPondTrees, SanctuaryTipiNpcs, SanctuaryTipis, WorldMossyRock, WorldStructures) |
| `V2Panel.js:250` has a 5th copy but is **not** on the live graph | `graph.py` live list (80 files after this change); not fetched at runtime |

## Changes

| File | What and why |
|---|---|
| `js/v2/deviceProfile.js` (new) | Frozen `deviceProfile` = `{ isMobile, isIPadOS, isTouch, dprCap, source }`. `detectMobile(ua, touchPoints)` is the verbatim former rule. `?device=mobile|desktop` overrides `isMobile` (and `dprCap`) for testing. Exposed read-only as `window.SacredDeviceProfile`. |
| `js/v2/Orchestrator.js` | `this._isMobile = deviceProfile.isMobile`; DPR cap reads `deviceProfile.dprCap` (same 1.0 / 1.5); `_ensurePipPipeline` guard uses `deviceProfile.isMobile`. Corrected the stale comment in that guard (it said the minimap is "absent on mobile"; mobile actually uses `_ensureMobilePip`). |
| `js/sanctuary/AnuAdaptiveDpr.js` | `_dprCeil = deviceProfile.dprCap` (same 1.0 / 1.5). |
| `js/v2/gltfLoaderSetup.js` | `_isMobileUA()` removed; `mobileGlbUrl()` reads `deviceProfile.isMobile`. |

Net: +1 file, 3 files changed, 32 lines removed / 10 added. The `this._isMobile` field and `_pipMobileDisabled` are kept, so nothing that reads them changes.

**One semantic note:** the former copies re-read `navigator` on every call; the profile reads it once at module load. `navigator.userAgent` and `maxTouchPoints` are fixed for a page's lifetime, so results are identical. The 6-profile run below confirms it.

## Proof of no behaviour change

**1. Equivalence test:** `node tools/mobile/deviceProfile.test.mjs` compares `detectMobile` with the verbatim old rule across 12 UAs (iPhone, iPod, old iPad, iPadOS desktop UA, Android phone/tablet, Firefox Android, Mac/Win/Linux desktop, headless, empty) × 5 touch-point values, plus 6 spot expectations. Result: **66/66 match.**

**2. Six-profile before/after** (`docs/mobile/phase0-measurements.json` vs `docs/mobile/phase1-measurements.json`, same probe):

| Profile | Deterministic fields* | GLB list | Errors | Notes |
|---|---|---|---|---|
| Phone S 320×568 | identical | identical | identical | |
| Phone M 360×740 | identical | identical | identical | |
| Phone L 390×844 | identical | identical | identical | |
| Phone landscape 844×390 | identical | identical | identical | |
| Tablet (iPadOS UA) | identical | identical | identical | iPadOS still detected as mobile |
| Desktop 1280×800 | identical | identical | identical | |

\* `_isMobile`, DPR, drawing buffer, shadows, `maxTextureSize`, scene triangles, mesh count, texture count, source-image MB, GLB MB, horizontal scroll, max GPU texture dimension, and the textures above the top-15 tie line.

Two fields **legitimately vary between runs** and are not evidence of a change:
- **GPU allocation count / MB on phones** (e.g. Phone L 112 → 91). Phones skip the boot warm-up (`Orchestrator.js:620`), so textures upload lazily per frame, and each run had rendered a different number of frames (7–16) when sampled. Max dimension stayed 256 on every phone run.
- **The top-15 texture list** differed only at its 4 MB cut-off. Many textures are exactly 1024², so which ones fall into the last slots is arbitrary. Every texture above the tie and the full size histogram are identical.

**3. Override test** (`tools/mobile/p1override.js`):

| Run | `SacredDeviceProfile` | `_isMobile` | Shadows | maxTextureSize | Mobile GLBs |
|---|---|---|---|---|---|
| Desktop + `?device=mobile` | `isMobile:true, source:"query"` | true | off | 256 | 3 of 8 |
| iPhone UA + `?device=desktop` | `isMobile:false, source:"query"` | false | on | 8192 | 0 of 8 |
| Desktop + `?device=bogus` | `isMobile:false, source:"ua"` | false | on | 8192 | 0 of 8 |

Every consumer follows the profile: renderer flag, shadows, texture cap, model swaps.

**Exit check:** the UA regex appears in the live graph **only** in `js/v2/deviceProfile.js` (grep over the 80 live files). The before/after diff of deterministic Phase 0 measurements is empty. ✓

## Stale comments found

| Where | Comment says | Code does |
|---|---|---|
| `Orchestrator.js` `_ensurePipPipeline` (fixed in this commit) | mobile minimap "simply absent" | mobile uses `_ensureMobilePip` (`_renderPip`) |
| `AnuAdaptiveDpr.js` load() | "This must match the Orchestrator's mobile clamp or the stepper overrides it" | now true by construction: both read `deviceProfile.dprCap` |

## NEEDS DEVICE

Nothing new. This phase changes no runtime behaviour.

## Attempts

- ATT-35 Phase 1 refactor: done, verified as above.
- ATT-36 Comparing the "top-15 textures" list across runs flagged false differences at the tie line. Compare above-tie entries plus the size histogram instead.

## Gates

`check:v2` PASS (60 modules) · `check:assets` PASS · `npm test`: **1 failed, 14 environmental errors, identical to the base `6b8cf51`** (12× blocked CDN, `lucide is not defined`, `build-signature.json` 404) · `node tools/mobile/deviceProfile.test.mjs` PASS (66/66).
