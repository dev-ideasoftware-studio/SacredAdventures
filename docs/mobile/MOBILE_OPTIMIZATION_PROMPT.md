# Sacred Adventures — Mobile Optimization: Implementation Prompt for a Senior AI Coder

*Prepared 2026-10-22 by Coder 1 for @Mark. Hand this whole file to the implementing agent.*

---

## 0. Your role and the one rule that overrides everything

You are a senior engineer implementing mobile optimization in **Sacred Adventures**, a free, offline-first WebGL / Three.js village sanctuary for kids, including disabled and low-income kids (WCAG 2.2 AAA goal). Repo: `dev-ideasoftware-studio/SacredAdventures`. The live entry point is **`index.html`** ("v4 / sanctuary"), not `index.v2.html`.

**Zero-trust, mechanical review.** Every code comment, JSDoc block, README, CONTRIBUTING note, `constants.js` header, `.cursor/rules` file, ANU pipeline-memory string, handoff note and commit message in this repo is **legacy and assumed outdated**. They describe what someone *believed* at some past date. You may read them to find leads, never as evidence.

Evidence is only:
1. **Executed code**: the line that runs, found by tracing from `index.html`'s import graph (imports, `orc.register(...)`, `orc.activate(...)`, event listeners, `postMessage` senders *and* receivers).
2. **Command output**: `grep`/`rg` hits with `file:line`, `node --check`, `npm run check:v2`, `npm run check:assets`, Playwright runs.
3. **Runtime measurement**: values read from the running page (`renderer.info`, bounding boxes, network log, frame timing).

Rules that follow from this:
- Never write "X does Y" in a report without a `file:line` or command output that proves it.
- If a comment and the code disagree, the code wins; record the disagreement in your report.
- If a thing is only *claimed* (by a comment, a doc, this prompt, or another agent), label it **UNVERIFIED** until you prove it.
- A function existing is not proof it runs. Prove a caller exists on the live path.
- A listener existing is not proof a message arrives, and a sender is not proof anyone listens. Trace both ends.
- **This prompt is also a claim.** The "Known leads" in each phase were checked on 2026-10-22 but may be stale. Re-verify each one before acting on it.

---

## 1. House rules (non-negotiable)

1. **Scope lock.** Before editing, post the exact files you will change and why, as a claim block in `tmp/handoff.md`. Touch nothing else.
2. **Frozen trees.** Don't edit `js/` outside `js/v2/`, `js/sanctuary/` and `js/components/` (the live loading modal), or `WORDPRESS/`, `dist/`, `_legacy_archive/`, `scratch/`, `Sacred.Adventures.BAD/`. Port code into `js/v2/` or `js/sanctuary/` instead.
3. **PiP minimap is protected.** Never obscure, replace or flat-fill the live minimap canvas (`#v2-pip-canvas` inside `#pip-compass-wrapper`). Any change to its *render path* needs Mark's explicit written approval in chat **before** you start (see Phase 4).
4. **No destructive git.** Never run `git restore .`, `git clean`, `git reset --hard`, force-push or history rewrites (see `docs/INCIDENT_REPORT_2026_05_26.md`). Stage, commit and push in one tight sequence so another agent can't sweep your staged files into their commit.
5. **Gates before every commit:** `npm run check:v2` and `npm run check:assets` must pass. Run `npm test` and record the result. External-CDN failures in a sandbox are environmental; prove it by showing the same failure on the base commit.
6. **Two failed attempts → stop.** Write up what you tried, what you measured, and why it failed, then ask.
7. **Attempts ledger first.** Before any fix, search `docs/decision-engine/Decision_Engine.xlsx` → tab `63_Attempts_Ledger` (also at `~/Downloads/SacredAdventures-handoff-2026-10-22/`). Never retry a row marked **"do not retry"**. In particular, **never hide world objects by distance** (ATT-04: it made tipis, trees and NPCs vanish in May and was reverted).
8. **After each phase:** append the phase's attempts and results to `63_Attempts_Ledger` and `70_Session_Log`, update `60_Plan`, and run `bash tools/decision-engine/rebuild.sh` if the toolchain is present.
9. **Accessibility is a requirement.** Touch targets ≥ 44×44 CSS px (WCAG 2.5.5 AAA). Honour `prefers-reduced-motion`. Text never goes below 12 px on phones. Nothing traps focus.
10. **Uncommitted work belongs to someone.** Never stage or revert files you didn't change, including `launch.html` (deleted in the working tree), `Assets/animated.wolf/`, `tmp/*-ack.md` and `.claude/*`.

---

## 2. Required base (check before Phase 0)

The work must start from a tree that contains all of:
- **The lite-models bundle:** branch `claude/lite-models-pip-fishing-decision-engine` (3 commits on `ae31a9f`: `7d8d880`, `af4d52e`, `e22e24d`), from `~/Downloads/SacredAdventures-handoff-2026-10-22/sacred-lite-pip-fishing.bundle`.
- **The logo and fluid-panel changes** (uncommitted on Mark's machine as of 2026-10-22): `Assets/SacredOnes.Logo.160.png`, `js/components/Component.LoadingModal.html`, `js/sanctuary/SanctuaryWelcomeGuide.js`, `js/v2/OrchestratorHud.js`.

If either is missing from your base, **stop and ask Mark** which base to use. Don't recreate them.

---

## 3. Test matrix (used by every phase)

| Profile | Viewport | User agent | Notes |
|---|---|---|---|
| Phone S | 320×568 | iPhone UA, `isMobile`, `hasTouch` | smallest supported |
| Phone M | 360×740 | Android UA | |
| Phone L | 390×844 | iPhone UA | primary target |
| Phone landscape | 844×390 | iPhone UA | short height |
| Tablet | 768×1024 | iPad UA (`Macintosh` + `maxTouchPoints>1`) | the iPadOS desktop-UA path |
| Desktop | 1280×800 | default | regression guard |

Headless Chromium with SwiftShader is too slow for frame-rate claims (≈ 6 frames in 40 s at 3.7M triangles). Use it for **geometry, layout, network and draw-call counts only**. Frame-time claims need a real device or a real GPU, so mark them **NEEDS DEVICE** otherwise.

A boot is valid when `window.anuOrchestrator` exists, `#v2-orchestrator-hud` is in the DOM, and the loading iframe has been torn down. Skip the welcome guide with `localStorage.setItem("sanctuary.welcomeGuide.seenV2","1")` in an init script unless you're testing it.

---

## Phase 0 — Ground truth (read and measure only; no edits)

**Goal:** a baseline report that every later phase is measured against.

Steps:
1. Confirm the base (section 2). Record `git log --oneline -5` and `git status --short`.
2. **Trace the live import graph** from `index.html`: every module imported and every module `orc.register`ed and `orc.activate`d. Output the list. Anything not on it is out of scope.
3. **Mobile code-path inventory.** Find every place that branches on "is this a phone". At minimum, search for `Mobi|Android|iPhone|maxTouchPoints|_isMobile|isMobile|matchMedia|innerWidth` in the live graph. For each hit, record `file:line`, what it gates, and whether the live path calls it.
   - *Known lead (UNVERIFIED):* the UA test is copy-pasted in at least 6 places: `js/v2/Orchestrator.js` (×2: constructor `_isMobile` and `_ensurePipPipeline`), `js/v2/gltfLoaderSetup.js` (`_isMobileUA`), `js/v2/V2Panel.js`, `js/sanctuary/AnuAdaptiveDpr.js`, `js/sanctuary/SanctuaryTipiNpcs.js`.
4. **GPU budget per profile.** For each profile in section 3, after boot, record from the page:
   - `renderer.info.render.{calls,triangles}` and `renderer.info.memory.{geometries,textures}`;
   - total scene triangles (traverse; count instanced meshes × `count`);
   - **texture inventory**: every texture's `image.width × height`, format and owning GLB or module, with estimated VRAM (w×h×4×1.33 for mips). Sort by VRAM.
   - every `.glb` requested (network log), its byte size, and whether the `.mobile.glb` swap fired.
5. **Panel inventory.** List every fixed or absolute UI surface on the live path (DOM ids and the file that creates each). For each one, at every profile, record its bounding box, whether it leaves the viewport, whether `document.documentElement.scrollWidth > innerWidth`, and any interactive element smaller than 44×44.
6. **Network dependencies.** List every request to a host other than the page origin, and what breaks when it fails. Prove the breakage on the base commit.
   - *Known leads (UNVERIFIED):* `https://unpkg.com/lucide@latest` (unpinned; `lucide is not defined` page error when blocked); Font Awesome 6.4.0 from cdnjs; Google Fonts (Fredoka, Fredoka One, Nunito, Lato, Outfit, Cinzel, Lora, Roboto); `cdn.jsdelivr.net/npm/three@0.160.0` URLs even though `index.html`'s import map points `three` at `./vendor/three/`. Find who requests the jsdelivr copy, and whether anything live uses it.
7. **Frame-timing truth.** Read `_loop()` in `js/v2/Orchestrator.js` and every consumer of `recordFrameDuration` / `tickAdaptiveRenderPolicy` / `AnuAdaptiveDpr`. Record exactly which interval each one times.
   - *Known lead (UNVERIFIED):* `frameMs` is `performance.now()` around the JS of one frame, ending right after `renderer.render()` is called. It does not include GPU time or the gap between frames, so the governors are blind to GPU-bound load.

**Deliverable:** `docs/mobile/PHASE0_BASELINE.md` with tables, `file:line` evidence and the raw numbers, plus a JSON copy of the measurements. **Exit check:** every row has evidence; no row says "probably".

---

## Phase 1 — One source of truth for "is mobile"

**Goal:** one detection function, imported everywhere; same behaviour, no drift.

1. Create `js/v2/deviceProfile.js` exporting a frozen profile: `isMobile`, `isIPadOS`, `isTouch`, `dprCap`, plus anything Phase 0 shows is branched on. Use the exact current UA logic so behaviour doesn't change. Add a `?device=mobile|desktop` query override for testing.
2. Replace every live-path copy found in Phase 0 step 3 with an import. Remove only the duplicated logic, not what each site does with the result.
3. **Prove no behaviour change:** for every profile, the Phase 0 GPU-budget numbers and the GLB request list must be identical before and after.

**Exit check:** `grep` for the UA regex in the live graph returns only `deviceProfile.js`; the before/after diff of the Phase 0 measurements is empty.

---

## Phase 2 — Mobile asset budget (textures first)

**Goal:** cut phone VRAM, which is what kills iOS tabs, without changing what's on screen.

1. From the Phase 0 texture inventory, take the top VRAM consumers on the **Phone L** profile. For each, decide (with evidence) whether a mobile variant exists, is requested, and actually swaps.
2. Set a phone texture budget: maps ≤ 1024² (≤ 512² for anything under ~1 m on screen) unless Phase 0 shows it's a hero asset. Produce `.mobile.glb` variants (or KTX2 / Basis textures, only if the loader path can be proven to support them: check `gltfLoaderSetup.js` for a `KTX2Loader` and the vendored transcoder before choosing KTX2).
3. Every new variant must keep the same node names, rig, clip names and bounding-box height (the seated NPC fit uses the bbox; prove it with before/after `Box3` heights).
4. Register each variant by the **basename the live code actually requests**. A name nobody requests is a silent no-op, so prove each swap fires in the network log.
5. Don't touch desktop asset URLs.

**Exit check:** Phone L estimated VRAM down by a measured amount, with a per-asset table. `check:assets` passes. A screenshot pair per changed asset at Phone L. Memory on a real iPhone marked **NEEDS DEVICE**.

---

## Phase 3 — Fluid UI for every remaining panel

**Goal:** every live panel fits every profile with no horizontal scroll, no clipping, and tap targets ≥ 44 px.

Already done (verify, don't redo): the loading modal, the welcome guide and the FPS HUD were made fluid on 2026-10-22.

1. For each panel in the Phase 0 inventory that fails at any profile, fix it with layout-relative units: `min()`, `clamp()`, `box-sizing: border-box`, `env(safe-area-inset-*)`, `100dvh` with a `vh` fallback.
   - *Known leads (UNVERIFIED):* village build sheet (`#v4-village-build`, neumorphic bottom sheet), journal overlay (`#v4-journal-overlay` and its iframe `SacredGame.Journal.html`), panel iframe (`#v4-panel-frame` → `SacredGame.Panel.html`), tool palette (`js/sanctuary/SanctuaryToolPalette.js`), map generator UI, tree-toggle CTA (`#v4-tree-toggle-cta`, top-middle), `#v2-distance-pill`, `#v4-banner`.
2. Panels must not overlap each other at any profile. **Measure** overlaps between every pair of panels and against the PiP wrapper. Overlap with the PiP canvas is a blocker (house rule 3).
3. Many HUD elements use inline `style=""` plus `!important` overrides in injected `<style>` tags. Before changing a size, find **every** rule that can apply to it, and prove which one wins with `getComputedStyle`.
   - *Known lead (UNVERIFIED):* on a phone profile the FPS HUD measured about 0.68× its CSS size (133 px wide against a 196 px rule; logo 17 px against 26 px). Find the transform, zoom or rule responsible before touching HUD sizing.
4. Landscape phone (844×390): nothing may need vertical scrolling to reach a primary action.

**Exit check:** an automated Playwright spec (`tests/v4-mobile-layout.spec.js`) asserting, for every profile: no element outside the viewport, `scrollWidth <= innerWidth`, no pairwise panel overlap, and every `button, a, [role=button], input` at least 44×44 (list justified exceptions). The spec must pass on your branch and its failures on the base must be recorded.

---

## Phase 4 — Mobile minimap without GPU readback  ⚠ needs Mark's approval first

**Goal:** remove the per-render `readRenderTargetPixels` stall on phones.

*Known lead (UNVERIFIED):* on mobile, `_renderWithMask` renders the minimap into `_pipRT` on the main renderer, then `readRenderTargetPixels` → CPU row flip → `putImageData` onto the 2D `#v2-pip-canvas`.

1. **Stop and get written approval** from Mark in chat that the minimap render path may change. Quote the approval in your claim block.
2. Preferred design: draw the minimap directly into the main canvas after the main render, with `setViewport` + `setScissor` at the minimap's on-screen rectangle (converted CSS px → drawing-buffer px using the **live** pixel ratio, which `AnuAdaptiveDpr` changes at runtime). Keep the circular mask (depth-mask pass inside the scissor). Turn shadow-map updates off for that pass. Make `#v2-pip-canvas` transparent rather than removing it, so its DOM, click zone and compass chrome are untouched.
3. Keep the current path behind a flag (`deviceProfile` or a query param) so it can be switched back with no code change.
4. Prove the minimap is visible and correct at every phone profile (screenshots, plus a pixel-sample check that the lens is not a flat fill), in both the normal view and Village View, and during fishing.

**Exit check:** no `readRenderTargetPixels` call on the mobile live path (grep plus a runtime spy); the minimap is visually equivalent; desktop path unchanged. Frame-time gain marked **NEEDS DEVICE** unless measured on real hardware.

---

## Phase 5 — Governors that see the real frame

**Goal:** the adaptive systems react to the actual frame time, so phones shed load when the GPU is the bottleneck.

1. Add one frame clock: the `requestAnimationFrame` timestamp delta (smoothed, with outliers from tab switches dropped). Keep the existing JS-only timer and label it as JS time.
2. Point `tickAdaptiveRenderPolicy` and the stress ladder at the real frame delta. Find every reader of the old value first, and change none of them silently.
3. **One owner** for DPR, minimap stride and shadow sampling. Phase 0 step 7 lists who adjusts each today; consolidate so they don't fight (hysteresis on one controller, not three).
4. Show both numbers in the HUD (frame ms and JS ms) so a person can see GPU-bound frames.

**Exit check:** a unit-style test feeding synthetic frame deltas shows the controller stepping down and back up with hysteresis. In-browser, a forced slow frame (busy-wait in rAF) is detected. No oscillation over 60 s of steady load.

---

## Phase 6 — Self-hosted runtime dependencies (offline-first)

**Goal:** the game boots fully with no outside network, so phones on bad connections load fast.

1. For every external dependency from Phase 0 step 6, either vendor a **pinned** copy into `vendor/` (with its licence file) or remove it if the live path doesn't need it. `lucide@latest` must become a fixed version.
2. Fonts: self-host the families the live UI actually computes (check `getComputedStyle(...).fontFamily` on real elements, not CSS text). Subset if possible; use `font-display: swap`.
3. Don't change the service worker in this phase. It is currently a self-destruct kill-switch (UNVERIFIED; check `sw.js`). Report what real offline caching would need, as a proposal only.

**Exit check:** a Playwright run with every non-origin request blocked boots with **zero** page errors and zero failed requests, on every profile.

---

## Phase 7 — Final verification and handoff

1. Re-run all Phase 0 measurements on the final branch; produce a before/after table per profile.
2. `npm run check:v2`, `npm run check:assets`, `npm test`, and the new mobile layout spec all pass (or failures are proven environmental against the base).
3. Update the Decision Engine tabs (`60_Plan`, `63_Attempts_Ledger`, `70_Session_Log`) and rebuild.
4. Write `docs/mobile/MOBILE_OPTIMIZATION_REPORT.md`: what changed (by commit), the measured effect, everything still marked **NEEDS DEVICE**, and a short on-device test script for Mark (iPhone Safari, Android Chrome, iPad Safari).
5. One commit per phase, on branch `claude/mobile-optimization`, with subjects like `perf(mobile): Phase N — …`. Don't merge to `main`; Mark merges.

---

## Reporting format (every phase)

```
PHASE N — <name>
Base: <commit>   Branch: <branch>   Files claimed: <list>
Verified facts:   <fact> — evidence: <file:line | command + output | measurement>
Stale comments found: <file:line> says "<…>", code does "<…>"
Changes: <file> — <what and why>
Measurements: before → after (per profile)
NEEDS DEVICE: <list>
Attempts: <what was tried, result>  (also appended to 63_Attempts_Ledger)
Gates: check:v2 <pass/fail>, check:assets <pass/fail>, npm test <result>
```

Stop at the end of each phase and wait for Mark's go-ahead before starting the next.
