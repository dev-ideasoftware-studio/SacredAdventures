# Mobile Optimization — Phase 2: Phone Memory Without Losing Looks

*2026-10-22 · Coder 1 · approved by Mark: "yes edit"; avatar variant is ours; "beauty and aesthetics as the #1 thing … pay close attention to memory"*

```
PHASE 2 — Mobile asset budget
Base: 149180d (Phase 1)   Branch: claude/mobile-optimization
Code commit: b56549a (part 1)   Report: this file
Files: Assets/npc/Avatar-New.mobile.glb, Assets/NPC.YB.mobile.glb,
       Assets/flora/reeds.mobile.glb (new); js/v2/gltfLoaderSetup.js;
       js/components/Component.ThreeIcons.js; tools/mobile/{texonly-variant,
       verify-texonly,inspect-glb}.mjs, tools/mobile/p2shots.js
```

## Result

| Measure | Before (Phase 1) | After | How measured |
|---|---|---|---|
| Panel icon renderer GPU textures, phone with internet | **172.2 MB**, max 4096 px | **4.3 MB**, max 512 px | WebGL upload hook, online simulation, Phone L |
| Phone source-image pixels (main game) | **481 MB** | **121 MB** (−75 %) | `texture.image` w×h×4 over scene materials, all 5 phone/tablet profiles |
| Phone model downloads (main game) | 27.1 MB | **16.6 MB** | network log, all 5 phone/tablet profiles |
| Avatar download in the panel (online) | 12.0 MB | 3.4 MB | network log, online simulation |
| Main canvas GPU textures, phone | 34 MB, max 256 px | 34 MB, max 256 px | unchanged by design |
| Desktop | — | **identical** in every deterministic field, same GLBs, same textures | 6-profile diff |

## Why phone visuals are unchanged

Mechanically traced, not taken from comments:

1. `vendor/three/three.module.js:24736`: every texture upload calls `resizeImage(texture.image, …, capabilities.maxTextureSize)`, and `resizeImage` (`:24035`) shrinks anything larger.
2. `js/v2/Orchestrator.js:159–210`: on mobile, `capabilities.maxTextureSize` is set to **256**.
3. So on a phone, a 4096 px map and a 1024 px map both reach the GPU as **256 px**. The new phone models only remove the 4096 px download and decode; the pixels on screen come from the same 256 px upload.

Visual check: `docs/mobile/img/phase2_compare_phone_full.jpg` (iPhone profile, 2× DPR, same spawn, before vs after) and `phase2_compare_badge_x4.jpg` (the 46 px avatar badge at 4× zoom). Differences are animation timing only; texture detail is the same.

The 1024 px phone maps leave headroom: if the phone cap is ever raised from 256 for more sharpness, these files still have 4× more detail than the cap uses.

## Changes

### 1. Texture-only phone models (`tools/mobile/texonly-variant.mjs`)

Rewrites **only** the embedded image `bufferView`s (Lanczos3 resize to ≤ 1024 px, same MIME type; JPEG q92 4:4:4, PNG level 9) and copies every other byte unchanged, so Draco geometry, skins, animations, node names and materials are bit-identical.

| Model | Size | Maps |
|---|---|---|
| `Assets/npc/Avatar-New.mobile.glb` | 11.44 → 3.20 MB | normal (PNG) + basecolor (JPEG) 4096² → 1024² |
| `Assets/NPC.YB.mobile.glb` | 3.02 → 1.25 MB | normal, basecolor, roughness-metal 4096² → 1024² |
| `Assets/flora/reeds.mobile.glb` | 0.75 → 0.34 MB | basecolor 4096² → 1024² |

**Proof** (`tools/mobile/verify-texonly.mjs`): every non-image bufferView is identical (3/3, 3/3, 1/1), and the JSON is identical apart from offsets and lengths. Also: gltf-validator reports 0 errors, with the same 2 warnings as each source; decoded triangle counts are unchanged (245,991 / 37,162 / 9,912); joints are 41 / 41 / –; clips are 9 / 5 / –.

Registered in `js/v2/gltfLoaderSetup.js` `MOBILE_GLB_VARIANTS` by the basenames the live code requests (`SanctuaryAvatar.js:49`, `SanctuaryTipiNpcs.js:42`, `SanctuaryPondTrees.js:42`, `WorldStructures.js:71`). All four load through `GLTFLoaderWithDraco`, whose `load()` applies the swap. The only name check on the avatar (`SanctuaryAvatar.js:420`) reads the constant `AVATAR_URL`, not the swapped URL. The stale comment there ("Avatar-New … excluded") was replaced with an accurate one.

### 2. Panel icon renderer (`js/components/Component.ThreeIcons.js`)

Traced: the panel iframe (`SacredGame.Panel.html`) loads its own three.js and `Component.ThreeIcons.js`. That file creates a full-screen 2nd `WebGLRenderer` (`:15–34`) and loads the avatar for the 46 px badge (`:269`). No phone texture cap applied to it.

- On mobile (from `window.parent.SacredDeviceProfile`, the Phase 1 single source; no new UA check), it sets `renderer.capabilities.maxTextureSize = 512`, the same mechanism the main renderer uses. 512 px is 11× the badge's on-screen size.
- On mobile it loads `Avatar-New.mobile.glb`, the same URL the main game loads.
- Desktop and other host pages: unchanged (no profile → desktop behaviour).

## Not changed

- **Geometry:** no decimation; triangle counts are identical (beauty first).
- **The phone cap of 256:** unchanged. Raising it is a quality option for later, and needs a real-device memory test.
- **The second WebGL context itself:** it still exists on phones (now ~4 MB). Removing it changes how the icons are drawn; that is a separate decision.

## Found while tracing (for the Antigravity fix list)

- `index.html` sets the renderer to DPR 1.5 regardless of the mobile clamp (Antigravity audit item **B14**). Phase 0–2 profiles ran at DPR 1–2 and didn't catch it. Handled as B14 in the Antigravity work, not here.

## NEEDS DEVICE

- iOS Safari resident memory before and after (the 481 → 121 MB source pixels is an upper bound on decoded memory).
- Whether a real browser cache dedupes the two `Avatar-New.mobile.glb` fetches (panel + game).

## Gates

`check:v2` PASS · `check:assets` PASS · `npm test`: environmental failures only, identical to base (the CDN is blocked in the sandbox).
