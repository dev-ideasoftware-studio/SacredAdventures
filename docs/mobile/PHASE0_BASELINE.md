# Mobile Optimization — Phase 0: Ground-Truth Baseline

*2026-10-22 · Coder 1 · measure-only, no code edits*

```
PHASE 0 — Ground truth
Base: f5e535e on claude/mobile-optimization
      = ae31a9f (main) + 7d8d880, af4d52e, e22e24d (lite-models bundle)
        + f5e535e (logo + fluid panels, from Mark's working tree)
Files claimed: none (read-only phase). New files: docs/mobile/*, tools/mobile/*
```

Raw data: `docs/mobile/phase0-measurements.json`. Probes (re-runnable): `tools/mobile/p0probe.js`, `p0online.js`, `p0panels.js`, `graph.py`.

## How this was measured

- **Browser:** headless Chromium 1194 + SwiftShader (software GL) via Playwright; repo served by `python3 -m http.server`.
- **Profiles:** as in the prompt. Phone/tablet profiles set the user agent (iPad: `Macintosh` UA + `maxTouchPoints=5`). `deviceScaleFactor` was 1 on every profile, so real phones (DPR 2–3) will differ where DPR matters; the renderer caps phones at DPR 1.0 anyway (`Orchestrator.js:130`).
- **GPU textures:** an init script wraps `texStorage2D` / `texImage2D` on both WebGL prototypes *before* any renderer exists, and logs every level-0 allocation per canvas. MB = w×h×4 (×1.333 when mip levels > 1).
- **CPU image pixels:** sum of `texture.image` w×h×4 over textures reachable from scene materials. This is an upper bound on decoded image memory, and whether the browser keeps it resident is browser-specific. **NEEDS DEVICE** to confirm on iOS Safari.
- **"Online" vs "sandbox":** this sandbox can't reach CDNs. "Sandbox" runs show what happens offline. "Online simulation" runs (`p0online.js`, `p0panels.js`) serve the jsdelivr three.js URLs from `vendor/three/` and stub `lucide`, to reproduce what a phone with internet runs.
- **Frame rate:** SwiftShader managed about 13 frames in 3 s after boot, so **no frame-rate number in this report means anything**. Any FPS claim is **NEEDS DEVICE**.

---

## 1. Live import graph (step 2)

| Item | Value | Evidence |
|---|---|---|
| Static ES-module graph from `index.html` | **79 files** (78 under `js/v2/` + `js/sanctuary/`, plus `js/BuildBadge.js`) | `graph.py` → `phase0-measurements.json › static_graph.live_files` |
| Runtime check | every one of the 79 was fetched on boot (phoneL); no static file was unfetched | network log `jsFiles` |
| Fetched outside the graph | `js/Data.Fish.js` (classic `<script>` in the panel iframe) | `SacredGame.Panel.html:26` |
| Modules registered / activated | 44 `orc.register(...)` and 44 `orc.activate(...)` | `index.html` |
| Iframes on the live path | `js/components/Component.LoadingModal.html` (boot), `SacredGame.Panel.html` (`#v4-panel-frame`), `SacredGame.Journal.html` (`#v4-journal-frame`) | `index.html:285–320` |
| Panel iframe has its **own** import map → jsdelivr three@0.160.0 | yes | `SacredGame.Panel.html:20–21` |

## 2. "Is this a phone?" inventory (step 3)

Search: `Mobi\||maxTouchPoints|_isMobile|isMobile|matchMedia(|innerWidth|coarse` over the 79 live files plus the three iframe HTML files.

| Site | What it gates | Live? |
|---|---|---|
| `Orchestrator.js:106–109` `this._isMobile = UA test` | source flag for everything below | yes |
| `Orchestrator.js:130` | DPR cap 1.0 (mobile) / 1.5 | yes |
| `Orchestrator.js:140` | shadows off on mobile | yes |
| `Orchestrator.js:159–210` | **mobile texture cap**: `capabilities.maxTextureSize = 256` + `texImage2D` downscale wrapper | yes (phones show maxDim 256) |
| `Orchestrator.js:620` | skips the all-geometry boot warm-up on mobile | yes |
| `Orchestrator.js:1426–1431, 1716` | mobile minimap = render target + readback | yes |
| `Orchestrator.js:1086–1093` (2nd UA copy, `_ensurePipPipeline`) | creates the desktop minimap context | **dead on mobile**: only called from `:1429`, in the `else` of `if (this._isMobile)` at `:1426` |
| `AnuAdaptiveDpr.js:159–163` (3rd UA copy) | DPR ceiling 1.0 / 1.5 | yes |
| `gltfLoaderSetup.js:63–74` `_isMobileUA()` (4th UA copy) | `.mobile.glb` swaps | yes |
| `SanctuaryToolPalette.js:206`, `BuildingPanelUI.js:77` | CSS `@media (pointer: coarse)` | yes (CSS) |
| `SacredGame.Panel.html:2626` | `matchMedia("(max-width: 1100px)")` early return | in the panel iframe |

**4 live copies** of the UA regex. The prompt's lead said 6: `V2Panel.js:250` is **not on the live graph**, and `SanctuaryTipiNpcs.js` lost its copy in `7d8d880`.

## 3. GPU and asset budget per profile (step 4)

| Profile | `_isMobile` | DPR | Drawing buffer | Shadows | maxTex | Draw calls | Tris / frame | Scene tris | **GPU tex (main)** | CPU image px | GLB download | Boot |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Phone S 320×568 | true | 1 | 320×568 | off | 256 | 380 | 1.42 M | 1.44 M | **33.7 MB** | 481 MB | 27.1 MB | 28 s |
| Phone M 360×740 | true | 1 | 360×740 | off | 256 | 373 | 1.41 M | 1.44 M | 34.0 MB | 481 MB | 27.1 MB | 31 s |
| Phone L 390×844 | true | 1 | 390×844 | off | 256 | 346 | 1.39 M | 1.44 M | 33.7 MB | 481 MB | 27.1 MB | 28 s |
| Phone land 844×390 | true | 1 | 844×390 | off | 256 | 584 | 1.50 M | 1.44 M | 34.7 MB | 481 MB | 27.1 MB | 34 s |
| Tablet (iPadOS UA) 768×1024 | **true** | 1 | 768×1024 | off | 256 | 399 | 1.45 M | 1.44 M | 34.0 MB | 481 MB | 27.1 MB | 42 s |
| Desktop 1280×800 | false | 1 | 1280×800 | on | 8192 | 316 | 1.34 M | 1.62 M | **710.9 MB** | 529 MB | 30.6 MB | 42 s |

(Boot times are SwiftShader times, comparable only with each other.)

### 3a. The phone texture cap works on the GPU; the source images don't shrink

On every phone profile the main canvas never allocates a texture above 256 px (`gpu.v4-canvas.maxDim = 256`), so `Orchestrator.js:159–210` is effective. But the **source images are still full size** in memory. The biggest, identical on all profiles:

| Texture | Size | Pixels | Owner (scene root) | Comes from |
|---|---|---|---|---|
| `Avatar-New_basecolor` | 4096² | 64 MB | `sanctuary_avatar` | `Assets/npc/Avatar-New.glb` (12.0 MB) |
| `Avatar-New_normal` | 4096² | 64 MB | `sanctuary_avatar` | same |
| `yb2_basecolor` | 4096² | 64 MB | YB seated NPC (tipi 1) | `Assets/NPC.YB.glb` (3.2 MB) |
| `yb2_normal` | 4096² | 64 MB | same | same |
| `yb2_rm` | 4096² | 64 MB | same | same |
| `grass+tuft+3d+model_basecolor.jpg` | 4096² | 64 MB | `sanctuary_pond_trees` | `Assets/flora/reeds.glb` (0.8 MB; `grep -c` on the GLB) |

These **6 maps = 384 MB of the 481 MB** of source pixels on phones. None of `Avatar-New.glb`, `NPC.YB.glb` or `flora/reeds.glb` has a mobile variant: they're absent from `MOBILE_GLB_VARIANTS` (`gltfLoaderSetup.js`), and the phone network log requests the originals. In Chromium, `GLTFLoader` decodes through `ImageBitmapLoader` (`vendor/three/examples/jsm/loaders/GLTFLoader.js:2541–2547`), which keeps the full decoded bitmap. Safari uses `TextureLoader` (HTMLImageElement). **NEEDS DEVICE:** the resident memory on iOS.

### 3b. Phone GLB requests (the mobile swap fired where it's registered)

`Avatar-New.glb` 12.0 MB · `tree.glb` 7.1 MB · `NPC.YB.glb` 3.2 MB · **`NPC.REG.lite.mobile.glb`** 2.5 MB · **`NPC.BHG.mobile.glb`** 1.7 MB · `bush.glb` 0.9 MB · `flora/reeds.glb` 0.8 MB · **`tipi.yellowbutterfly.lite.mobile.glb`** 0.2 MB. Desktop requests the non-mobile versions of the three bold files.

### 3c. The panel iframe is a second renderer, uncapped (online only)

**Online simulation, Phone L** (`online_sim_phoneL`):

| WebGL context | Frame | Canvas | GPU textures | Max dim |
|---|---|---|---|---|
| 1 | top | `#v4-canvas` (main) | 33.7 MB (112 allocations) | 256 |
| 2 | `#v4-panel-frame` | `#v2-guide-icons-canvas`, **full-screen**, 390×844 backing | **172.2 MB** (9 allocations) | **4096** |

- `Component.ThreeIcons.js:15–34` creates a full-screen `WebGLRenderer` at `z-index: 9999` with its own endless `requestAnimationFrame` loop (`:52–54`). It loads `./Assets/npc/Avatar-New.glb` again (`:269`) through the panel's **own** three.js, which comes from jsdelivr (`SacredGame.Panel.html:20–21`).
- The phone texture cap is installed on the main renderer only (`Orchestrator.js:159`), so this context uploads the **4096² avatar maps at full size**.
- `Avatar-New.glb` was fetched **twice** (12.0 MB each) in the online run. A real browser cache may serve the second fetch. **NEEDS DEVICE.**
- In the sandbox (offline) this context never appears, because the panel's three.js import fails. The sandbox numbers in table 3 therefore **understate production phone memory by about 172 MB of GPU textures plus a second WebGL context.**

### 3d. Minimap state at measurement time

No profile had built a minimap target yet (`pip.mobileRT=false`, `renderer2ndCtx=false`): only 3–13 frames had run, and the minimap stride is 16 (`constants.js:63`). The minimap's memory and readback costs are **not in these numbers**. **NEEDS DEVICE** (or a longer software run) for Phase 4.

## 4. Panels at every profile (step 5)

Online simulation, outermost positioned elements with an `id`, top document plus the panel iframe. `#__boot_err` is this sandbox's error bar (CDN failures) and is excluded from conclusions.

| Finding | Profiles | Evidence |
|---|---|---|
| No horizontal page scroll | all | `hScroll=false` |
| **`#v2-distance-pill` off-screen** (x = −26) and overlapping the left thumb zone by 98×32 | phone landscape | `panels.phoneLand` |
| **FPS / telemetry HUD at desktop size covers about a quarter of the screen** (the HUD's mobile CSS only applies at `max-width: 768px`, and a landscape phone is 844 wide) | phone landscape | screenshot `panels_phoneLand.png`; `OrchestratorHud.js` mobile `@media (max-width: 768px)` |
| `#setup-trigger` (panel iframe, 49×49 at 15,15) overlaps the minimap wrapper's box by 44×44 | all | `panels.*.overlaps`. Whether it covers the visible circular lens: **UNVERIFIED** (the overlap is in the box's corner) |
| `#center-stack` (action bar) overlaps `#left-panel` / `#mobile-thumb-zone` and `#right-panel` / `#action-zone` by 52 px vertically | phones (portrait) | `panels.phoneL.overlaps`. Whether those zones still take taps there: **UNVERIFIED** (needs an `elementFromPoint` probe in Phase 3) |
| Tap targets under 44 px (visible) | all | `#v2-hud-trace-label` 116×10, `#v2-hud-universe-label` 116×15 (HUD accordions), `#build-badge-copy` 22×22 |
| Not measured (hidden at boot) | — | journal overlay, village build sheet, tool palette, map generator, quest/inventory sheets. Phase 3 must open each one and measure. |

The 2026-10-22 fluid fixes hold: the loading modal and welcome guide fit at 320–1280 and landscape (verified before this phase; not re-listed).

## 5. Outside-network dependencies (step 6)

| Request | Used by | What breaks when it fails | Proof |
|---|---|---|---|
| `https://unpkg.com/lucide@latest` (**unpinned**) | `SacredGame.Panel.html:10` | `lucide.createIcons()` at `:1956` throws on the first line of a 948-line `<script>` block (`:1955–2903`), so **none of it runs**: `handleActionClick`, `toggleFish`, `toggleGather`, `toggleLogbook`, `toggleObserve`, `GameEngine`, `emit` and others stay undefined, and the block's `message`, `touchstart/end`, `keydown` and `click` listeners are never attached | offline run: `typeof panel.handleActionClick === "undefined"` (and the other four); online sim: all `"function"` |
| `cdn.jsdelivr.net/npm/three@0.160.0/…` (three + OBJ/GLTF/DRACO loaders) | panel iframe import map `SacredGame.Panel.html:20–21` | panel 3D icons (`Component.ThreeIcons.js`) never start; `window.THREE` undefined in the panel | offline run: `typeof panel.THREE === "undefined"`, no second context |
| `cdnjs …/font-awesome/6.4.0/css/all.min.css` | top and iframes | icon glyphs missing (visual) | request failed in sandbox; visual impact **UNVERIFIED** |
| Google Fonts: Fredoka, Fredoka One, Nunito, Lato, Outfit, Cinzel, Lora, Roboto | various | fallback fonts; layout and line breaks change (seen in the welcome-guide screenshots) | requests failed in sandbox |
| `build-signature.json` (local, 404) | build badge | none visible; console 404 | not tracked in git |

The top document's three.js is **vendored** (`index.html:273–280` import map → `./vendor/three/`), so the main game boots offline. Only the panel iframe depends on the CDN copy.

## 6. Frame timing (step 7)

| Quantity | Measures | Set at | Read by |
|---|---|---|---|
| `smoothFPS` / `rawFPS` | **real frame interval**: `clock.getDelta()` between loop calls, capped at 0.1 s | `Orchestrator.js:663, 672–678` | HUD only (`OrchestratorHud.js:621`) |
| `frameMs` | **JS work inside one loop call**: `performance.now()` at `:661` to `:797`; includes module updates, `renderer.render()` submission, minimap pass and HUD; excludes GPU execution and the gap between frames, except where a sync point (e.g. the mobile `readRenderTargetPixels`) stalls inside the loop | `Orchestrator.js:797` | `recordFrameDuration` → rolling 40-sample avg (`anu/FrameBudget.js:18`) and `tickAdaptiveRenderPolicy` (`anu/AdaptiveRenderPolicy.js:43`) |
| stress level | rolling avg of `frameMs` against `targetMs × 1.25 / 1.6` | `anu/FrameBudget.js:76–109` | shadow sampling + minimap bypass (`Orchestrator.js:737–771`) |

**Three controllers move the minimap stride, all fed by `frameMs`:** `AdaptiveRenderPolicy.tickAdaptiveRenderPolicy` (±1), `AnuAdaptiveDpr.update` (`AnuAdaptiveDpr.js:226–272`: +1 / +2 / −1, plus DPR steps), and the stress-ladder bypass (`Orchestrator.js:770–771`). They share one stride via `setAdaptivePipStrideTarget` and can act in the same frame. Only the HUD sees the real frame interval.

## 7. Stale comments found (code wins)

| Where | Comment says | Code does |
|---|---|---|
| `Orchestrator.js:1079–1083` | on mobile "the minimap is simply absent" | mobile renders the minimap via `_ensureMobilePip` / `_pipRT` (`:1203`, `:1426–1427`, `:1716`) |
| `constants.js:49` | PiP renders "every 6 frames" | `V2_PIP_RENDER_EVERY_N_FRAMES = 16` (`constants.js:63`) |
| `anu/RenderingGovernor.js:61` | blueprint matches "Orchestrator.js:81-106" | the renderer construction is now at `Orchestrator.js:111–140` |
| `anu/RenderingGovernor.js:70` | `pixelRatioCap: 1.5` | phones are capped at 1.0 (`Orchestrator.js:130`, `AnuAdaptiveDpr.js:163`) |
| `anu/pipelineMemory.js:70, 380` | minimap canvas `#pipCanvas` | live canvas is `#v2-pip-canvas` (`UIModule.js:218`) |
| `Component.ThreeIcons.js:13` | "tiny UI icons" | full-screen canvas, loads a 12 MB avatar with 4096² maps |

## 8. What this changes in the plan

1. **Phase 2's biggest phone win is the panel's second renderer, not the main scene.** On phones the main canvas is already capped at 256 px (34 MB). The panel's icon renderer adds about 172 MB of GPU textures and a second context when online. Options: share or cap its textures, render the icons in the main context, or swap the icons on phones for static images. *Touches `js/components/Component.ThreeIcons.js` and `SacredGame.Panel.html`, which are outside `js/v2` and `js/sanctuary` but on the live path. Needs Mark's OK under house rule 2.*
2. **Second phone win: source images.** Mobile variants of `Avatar-New.glb`, `NPC.YB.glb` and `flora/reeds.glb` with maps ≤ 512–1024 would remove most of the 384 MB of 4096² source pixels and about 15 MB of download.
3. **Phase 6 is also a function fix.** Unpinned `lucide@latest` plus the CDN three.js copy decide whether the panel's action handlers exist at all. Pinning and vendoring both is low risk and high value.
4. **Phase 3 additions:** the landscape-phone HUD (its breakpoint is width-only), the distance pill off-screen in landscape, the action-bar overlap with the thumb zones, and HUD accordion targets under 44 px.
5. **Phase 1 is smaller than expected:** 4 live UA copies, one of them dead on mobile.

## NEEDS DEVICE

- Resident memory of decoded 4096² images on iOS Safari (3a); whether the 2nd `Avatar-New.glb` fetch hits the cache (3c).
- Minimap render-target cost and readback stall on a real phone (3d).
- Every frame-rate claim.

## Attempts

None. Phase 0 is read and measure only. The probes and their outputs are the record.

## Gates

`check:v2` PASS (59 modules) · `check:assets` PASS · `npm test` not run in this phase (no code changed).
