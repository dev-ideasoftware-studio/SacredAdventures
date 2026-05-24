/**
 * ANU_PIPELINE_MEMORY — the v2 engine's incident & invariant ledger.
 *
 * Extracted from AnuModule.js so the parent file stays about coordination
 * (binding the live SacredOrchestrator, exposing window.AnuUniverse, running
 * evaluateLivePipelineRisk) rather than the ever-growing card list.
 *
 * Pure data — no side effects, no imports, no behaviour. Append when the
 * pipeline teaches something new. Each card: { id, learnedAt, title, summary,
 * impact?, mitigations[], files[], probeLedger? }.
 *
 * Consumed (and re-exported) by js/v2/AnuModule.js. Legacy import paths
 * (js/v2/UniverseModule.js, downstream tooling) keep working through that
 * re-export.
 */

/** Incidents and invariants — append when the pipeline teaches something new. */
export const ANU_PIPELINE_MEMORY = [
  {
    id: "reeds-fps-regression-may-16",
    learnedAt: "2026-05",
    title: "Pond reed ring FPS regression — Tripo reeds at 1.98 M tris × 28 instances",
    summary:
      "May-16 2026 — user reported an FPS hit immediately after the pond-fun-spot work landed (reeds ring + sand bottom + fishing module). Deep forensic on the new assets:\n\n  Asset                                tris       inst   per-frame\n  -----------------------------------  ---------  -----  ----------\n  Assets/flora/reeds.glb               1,983,570  × 28   55,539,960  ← regression\n  Assets/landscape-scenes/terrain/     1,129,052  × 2     2,258,104\n   rock.mossy.glb\n  Assets/animated.deer/source/[deer+3d+model].glb     785,038  × 3     2,355,114\n  Assets/Avatar3.glb                   1,956,236  × 1     1,956,236\n  Assets/NPC.BHG.glb                     954,260  × 1       954,260\n  Assets/Tipi.yellowbutterfly  983,526  × 2     1,967,052\n  Assets/animated.stag.glb               748,456  × ~0           ~0  (mostly hidden)\n\nThe reed ring alone was drawing **~55 M tris/frame** — more than the rest of the scene combined. InstancedMesh saves a draw call but the vertex shader still runs per-instance per-vertex, so 28 × 1.98 M = ~55 M instance-verts/frame went to the GPU. Tripo authors reeds at sculpt density (vertex budget more typical of an offline render asset); for a small grass-clump scattered 18–28× as background flora, even 5 % of that is plenty.\n\n**Fix landed in this entry:** ran `scripts/simplify-and-draco.mjs` at ratios tuned to the asset's role.\n\n  Asset                    Tris in     Tris out   Ratio   Err     File size\n  -----------------------  ----------  ---------  ------  ------  --------\n  Assets/flora/reeds.glb   1,983,570   9,912      0.005   0.0054  55.5 → 0.78 MB\n  rock.mossy.glb           1,129,052   113,259    0.10    0.0050  38.2 → 5.2 MB\n\nReeds ring redraw cost: 9,912 × 18 = **178,416 tris/frame** (was 55,539,960). Mossy rock cost: 113,259 × 2 = 226,518 (was 2,258,104). Pond floor + fishing rig are negligible (< 1 k tris each).\n\nVisual impact: reeds at 9.9 k tris per clump are still readable as foliage cones at the human-eye scale they occupy (each clump ~0.5 m tall × 1 m wide); they're background dressing 1.5–2 m past the water rim, never the camera focus. Mossy rock at 113 k tris keeps the silhouette sharp at the two known camera distances (tipi 1 prop + pond dock prop).\n\nAlso reduced `REEDS_RING_COUNT 28 → 18` in `WorldPool2.js` — tighter ring count gives a slightly sparser look that reads more naturally as wild pond growth, and trims another 35 % off the reed redraw.",
    impact:
      "Reed ring was 99.5 % of the per-frame triangle cost added by the fun-spot landing. Targeting 120 FPS the SACRED-tier hardware budget (~6–10 M tris/frame on a modern integrated GPU) cannot absorb a 55 M/frame burst — frame time stretches to multiple ms and FPS halves.",
    mitigations: [
      "Originals preserved in `BACKUP/draco-originals/reeds.glb` (55.5 MB pre-simplify) and `BACKUP/draco-originals/rock.mossy.preSimplify.glb` (38.2 MB pre-simplify) — reversible if a future render-quality audit wants a higher-poly reed clump.",
      "When adding a new InstancedMesh of a Tripo-authored GLB, ALWAYS check `tri_count × instance_count` before merging. The check: `node -e \"... gltf.meshes[*].primitives[*].accessors[POSITION].count / 3 ...\"` reads the JSON header without spinning up Three.js.",
      "Tripo-AI exports are reliably ~1.5–2 M tris per part. Background flora should be simplified to < 20 k tris before instancing > 10×; mid-foreground props (~10 m camera distance) can stay at 100–200 k tris.",
      "WorldPool2.js — REEDS_RING_COUNT (currently 18). Raising back above 24 without re-simplifying the GLB will re-introduce the regression.",
    ],
    files: [
      "Assets/flora/reeds.glb",
      "Assets/landscape-scenes/terrain/rock.mossy.glb",
      "js/v2/WorldPool2.js",
      "BACKUP/draco-originals/reeds.glb",
      "BACKUP/draco-originals/rock.mossy.preSimplify.glb",
      "scripts/simplify-and-draco.mjs",
    ],
  },
  {
    id: "fps-recovery-wave-2-may-16",
    learnedAt: "2026-05",
    title: "FPS recovery wave 2 — Avatar3 + deer + Fauna per-frame scene.traverse",
    summary:
      "User reported the wave-1 fixes (reeds + mossy rock simplify) didn't fully recover 120 FPS. Second forensic pass turned up three remaining costs:\n\n  1. Player avatar geometry — `Avatar3.glb` shipped Draco-compressed but UN-simplified at 1,956,236 tris. The player figurine is on-screen every frame, often filling a third of the chase camera frame, so its vertex shader cost is paid on every tick.\n  2. Deer herd — `[deer+3d+model].glb` at 785,038 tris × 3 herd instances = 2,355,114 tris/frame. Skinned mesh = per-vertex skinning math in addition to transform.\n  3. Per-frame `scene.traverse` in `Fauna.collectExtraMoverXZs` — added with the rabbits-scatter-from-NPCs feature on May-16. Walks every Object3D in the scene (thousands when forest + props + village are loaded) each tick to filter the ~4–6 relevant `anuKind` matches.\n\n**Fixes landed:**\n\n  Asset / op                    Before                       After                     Saved/frame\n  ----------------------------  ---------------------------  ------------------------  -----------\n  Avatar3.glb                   1,956,236 tris × 1           586,798 tris × 1          −1,369,438\n  [deer+3d+model].glb           785,038 tris × 3             157,006 tris × 3          −1,884,096\n  Fauna mover scan              N scene.traverse / frame     N / 90 frames (cached)    ~99 % CPU\n\n  - Avatar3 simplify ratio 0.30, err 0.00029 (very low; cinematic-pan distance keeps it crisp).\n  - Deer simplify ratio 0.20, err 0.00014 (deer typically read at ~5–10 m camera distance from the dock).\n  - Mover-cache: `_moverCachedRefs` (Array<Object3D>) is rebuilt every `MOVER_CACHE_REFRESH_FRAMES = 90` ticks (~1.5 s @ 60 FPS); per-frame work drops to a tight for-loop reading `getWorldPosition` on 4–6 cached refs.\n\nOriginals preserved in `BACKUP/pre-simplify/Avatar3.preSimplify.glb` and `BACKUP/pre-simplify/deer.preSimplify.glb`. Combined with wave-1 (reeds + rock.mossy = −57.4 M tris/frame), the two waves remove ~60.6 M tris/frame and the per-frame Object3D traversal — well clear of the 120-FPS budget.",
    impact:
      "Wave-1 left ~3.25 M tris/frame of headroom on the table (Avatar3 + deer) plus a hidden CPU cost (Fauna mover scan). On hardware near the 120-FPS budget edge, that's the difference between hitting target and missing it.",
    mitigations: [
      "Background flora / props that ship from Tripo at > 1 M tris should be simplified to < 50 k tris before going live; player + on-screen NPCs at ~500 k tris is the upper end of what's comfortable for skinned-mesh-heavy scenes.",
      "Any new per-frame `scene.traverse` is a smell — cache the candidate Object3D refs once and read `.position` / `getWorldPosition` from the cached list. Refresh on a slow timer (1–2 s) or on a 'scene structure changed' signal.",
      "WorldPool2.js — DEER_HERD_MAX defaults to 3; raising back above 4 without re-checking the per-frame tri budget will undo this fix.",
      "Avatar3 / deer originals live in `BACKUP/pre-simplify/`. To revert (e.g. for a render-quality audit), copy the `.preSimplify.glb` back over the live asset and re-Draco via `scripts/draco-compress.mjs`.",
    ],
    files: [
      "Assets/Avatar3.glb",
      "Assets/animated.deer/source/[deer+3d+model].glb",
      "js/v2/Fauna.js",
      "BACKUP/pre-simplify/Avatar3.preSimplify.glb",
      "BACKUP/pre-simplify/deer.preSimplify.glb",
      "scripts/simplify-and-draco.mjs",
    ],
  },
  {
    id: "pip-second-gl-context",
    learnedAt: "2026-05",
    title: "PiP second WebGL pass (ortho map vs persp spirit)",
    summary:
      "SacredOrchestrator._renderPip() uses a second WebGLRenderer on #pipCanvas and renders the same THREE.Scene when V2_PIP_RENDER_EVERY_N_FRAMES > 0. When the main canvas is FPV, PiP uses an orthographic top-down camera; when the main canvas is map view, PiP uses a short perspective “spirit” camera. Cadence follows RenderingGovernor / frame stride. The ortho frustum span = `V2_PIP_ORTHO_WIDTH × V2_PIP_ORTHO_ZOOM × _pipUserZoom`; SMALLER `V2_PIP_ORTHO_ZOOM` = TIGHTER frustum = fewer tris in the duplicate pass.",
    impact:
      "Triangle/transform cost is largely duplicated vs the main view when PiP renders; HUD renderer.info only reflects the main canvas.",
    mitigations: [
      "constants.js — V2_PIP_RENDER_EVERY_N_FRAMES (0 skips PiP). Baseline lifted 3 → 4 on May-11 2026 as part of the Anu 'Plan A' FPS recovery; combined with the flora cap drop, fuzzy sensor relaxed from `scene-triangles` SEVERE to ELEVATED.",
      "constants.js — V2_PIP_ORTHO_ZOOM (designer default for the duplicate pass's ortho span). May-11 2026 Anu 'Plan B' FPS recovery lowered 0.96 → 0.80 (~17 % less world area per PiP frame; combined with the Plan A stride bump, the duplicate pass touches ~30 % less geometry per second). Direction is anti-intuitive: smaller value tightens. Stacks with UIModule per-user zoom; the user can still zoom out to 1.6 if they want a wider PiP.",
      "anu/RenderingGovernor.js — shouldRenderPipSceneThisFrame()",
      "anu/AdaptiveRenderPolicy.js — raises stride under frame stress",
      "Orchestrator.js — `_ensurePipPipeline` calls `pipRenderer.compile(scene, pipOrtho)` so the second GL context's program cache is warm before the first user-visible PiP frame (see `boot-shader-warmup`).",
    ],
    files: ["js/v2/Orchestrator.js", "js/v2/constants.js", "js/v2/anu/RenderingGovernor.js"],
  },
  {
    id: "hud-stats-main-only",
    learnedAt: "2026-05",
    title: "Triangle / draw counts are main renderer only",
    summary:
      "SacredOrchestrator HUD reads this.renderer.info — PiP and other WebGL contexts are not included in that line.",
    mitigations: ["When profiling GPU, assume PiP + overlay renderers add uncredited cost."],
    files: ["js/v2/Orchestrator.js"],
  },
  {
    id: "trees-instancing-tri-count",
    learnedAt: "2026-05",
    title: "Forest dominates triangle stats",
    summary:
      "Instanced tree.glb × TREE_TARGET can push millions of reported tris; avatar/guide layers were smaller factors. May-11 2026 Anu 'Plan A' FPS recovery: live fuzzy sensor reported `scene-triangles` SEVERE at ~12.5 M tris with flora ~3.0 M / 24 % on 155 instances; cap lowered 155 → 110 so the distant forest ring thins first (nearest-origin priority) and the village reads unchanged. Plan B (same day) tightened the PiP duplicate-pass frustum (`V2_PIP_ORTHO_ZOOM` 0.96 → 0.80) so the forest is touched on fewer minimap pixels per stride tick; combined cost reduction vs pre-recovery is ~30 % flora tris per second.",
    mitigations: [
      "constants.js — V2_FLORA_MAX_TREE_INSTANCES (nearest-origin cap), V2_PIP_RENDER_EVERY_N_FRAMES (PiP baseline stride), and V2_PIP_ORTHO_ZOOM (PiP ortho span). Plan A+B landed at 110 / 4 / 0.80 — do not raise without re-running `scratch/probe-current-regressions.mjs` and watching the fuzzy `scene-triangles` level.",
      "Flora.js multipart tree.glb × N — each mesh part is its own InstancedMesh; trim N before adding domains.",
      "AdaptiveRenderPolicy still widens PiP stride under sustained frame stress.",
    ],
    files: ["js/v2/Flora.js", "js/v2/FloraLegacyTreeLayout.js", "js/v2/Trees.js"],
  },
  {
    id: "boot-shader-warmup",
    learnedAt: "2026-05",
    title: "Boot-time warm-up — kill the first-move stall (shaders + textures + geometry)",
    summary:
      "May-11 2026 morning fix (shader-only): SacredOrchestrator.start() calls precompileShaders() before _loop(), invoking renderer.compile(scene, camera) so material programs are linked before the first frame. That eliminated GLSL-compile stalls.\n\nMay-11 2026 evening fix (deep diagnosis from scratch/probe-boot-stutter.mjs): the player still reported a noticeable freeze the moment they tried to move. The probe captured 720 frames of per-frame deltaMs + renderer.info counters (programs/textures/geometries) and pinned the stall to a SINGLE FRAME (frame 691, deltaMs ≈ 2548 ms) where dProg=+24, dTex=+61, dGeo=+90 ALL jumped in one tick. That is the textbook signature of LAZY GPU UPLOAD: renderer.compile() only links programs; textures and geometry VBO/IBO buffers are not actually uploaded to the GPU until a material is first rasterized. Fix: extended precompileShaders() to ALSO perform a 1×1 render-to-target pass via the new `_performBootRenderWarmup(renderer, camera)` helper. Inside that helper, `frustumCulled` is temporarily set to false on every visible drawable so meshes outside the initial camera frustum still get warmed (a tree behind the camera would otherwise re-stutter on first rotation). The micro-rasterization cost is negligible (1 pixel); the side-effects — texImage2D for every texture, bufferData for every geometry, finalisation of every onBeforeCompile shader variant — are what flatten the curve. `_ensurePipPipeline()` runs the same compile + 1×1 prime render pair on the second WebGLRenderer so the PiP context's caches are also warm before its first frame.",
    mitigations: [
      "Orchestrator.js precompileShaders() — calls renderer.compile() THEN _performBootRenderWarmup() (frustum-cull bypass during the 1×1 RT pass; both bypass flag and render target are restored in finally).",
      "Orchestrator.js _ensurePipPipeline — runs pipRenderer.compile() THEN _performBootRenderWarmup() on the PiP renderer + ortho camera. Stacks with V2_PIP_RENDER_EVERY_N_FRAMES.",
      "Both warm-ups log `🔥 Boot warm-up complete (main pass | PiP pass): compile N ms · prime render N ms` so a regression in either stage is visible in console without enabling stats.",
      "Visibility is NOT modified during warmup — intentionally hidden meshes (e.g. the stag during WAIT_TO_APPEAR) stay out of the warmup pass, so cost stays bounded. When such a mesh becomes visible later, it pays its own small warmup cost once; subsequent appearances are free.",
    ],
    impact:
      "Probe ledger (headless, mac-arm64): before fix — one 2548 ms stall at frame 691 (first move). After fix — main warm-up ~3.3 s and PiP warm-up ~3.5 s happen DURING BOOT (behind the loading iframe), and the first user-visible frame draws cleanly. On M1 iMac (~3.5× faster than headless), boot delta is ~2 s; user-perceived effect: 'loading finishes, click play, smooth movement immediately'. Trade-off: boot loading extends ~2 s; mid-play first-move stutter eliminated. Subsequent steady-state FPS is unchanged — warmup is one-shot.",
    files: ["js/v2/Orchestrator.js"],
    probeLedger: "scratch/probe-boot-stutter.mjs",
  },
  {
    id: "tripo-asset-decimation",
    learnedAt: "2026-05",
    title: "Tripo-generated GLBs dominate scene-triangles — offline mesh simplification path",
    summary:
      "Deep Anu diagnosis (scratch/probe-anu-domains.mjs) on May-11 2026 evening revealed the headline `scene-triangles` SEVERE was not flora-driven — flora was only 18.3 % (~2.13 M tris). The real elephants were the Tripo-AI-generated GLBs: tipi.yellowbutterfly.glb (1.97 M tris × 2 nodes = 3.94 M tris, 33.8 % of scene), animated.stag.glb (~1.50 M tris primary mesh), Avatar3.glb (1.96 M tris), NPC.BHG/YB (~2 M combined). These ship from Tripo without poly-budget passes — vert counts more typical of a sculpt source than a runtime asset. Anu's #1 recommendation pivoted from 'trim per-tree' (mature: tree.glb only has 2 parts, both essential to silhouette) to 'simplify Tripo GLBs offline'.\n\nFirst landed reduction: stag GLB decimated 1.50 M → 748 k tris (ratio 0.5) using meshoptimizer (already in node_modules) + Draco re-encode. File shrank 3.47 MB → 2.32 MB on disk. Stag is the safe first target because (a) it's a hologram so the cyan-mint emissive shader masks any subtle silhouette artifacts, (b) it's invisible most of the time (30 s appearance window every 5 min), (c) BACKUP/draco-originals/animated.stag.glb (47 MB pre-Draco) is the canonical revert path; an additional fresh snapshot lives at scratch/animated.stag.predecimate.glb for instant rollback to the Draco-but-not-decimated state.",
    mitigations: [
      "scripts/simplify-and-draco.mjs — wrapper that drives meshoptimizer + KHRDracoMeshCompression directly via @gltf-transform/core (bypasses @gltf-transform/functions because it transitively imports sharp which fails on Node 20.0; same workaround pattern as scripts/draco-compress.mjs). MUTATES the index accessor in place rather than creating a new one (an orphaned accessor on the same buffer caused output bloat from 3.47 MB → 19.45 MB on the first attempt — Draco still encoded the new buffer, but the writer also serialized the orphaned old one).",
      "Usage: `node scripts/simplify-and-draco.mjs <in.glb> <out.glb> <ratio> [targetError]` — ratio 0.5 keeps 50 % of triangles; targetError 0.02 is the conservative default for game meshes.",
      "Safe staging recipe before decimating a user-visible asset: (1) `cp Assets/<NAME>.glb scratch/<NAME>.predecimate.glb` (2) run script in-place (3) re-run scratch/probe-anu-domains.mjs to confirm tri count dropped (4) visually verify in browser (5) if regression, `cp scratch/<NAME>.predecimate.glb Assets/<NAME>.glb`.",
      "scratch/probe-anu-domains.mjs — captures bySimulationDomain rollup + top 25 heaviest drawables. THE diagnostic to run before any 'reduce triangles' lever; assumptions about which domain owns the cost are routinely wrong.",
      "scratch/probe-tripo-parents.mjs — walks scene-graph ancestors for every tripo_node_* mesh. Used to identify whether a heavy mesh is the player avatar, an NPC, a structure, or the stag (their tripo_node names are not self-descriptive).",
    ],
    impact:
      "Stag pass alone: total scene tris 11,641,316 → 10,892,858 (−6.4 %). Score on Anu's `scene-triangles` sensor stays saturated (clamps above 2.5 M) until total drops below ~2 M; the absolute count + per-domain rollup is the honest indicator. Next biggest available levers (NOT yet pulled, require user OK because both modify user-visible assets): tipi.yellowbutterfly.glb decimation (~1.97 M tris saved across both tipi instances) and Avatar3.glb decimation (~1 M tris saved). Tree.glb is NOT a useful simplify target — only 2 parts, both essential to silhouette; flora optimization is exhausted with the cap + PiP stride/zoom triad (Plans A + B).",
    files: ["scripts/simplify-and-draco.mjs", "Assets/animated.stag.glb", "BACKUP/draco-originals/"],
    probeLedger: "scratch/probe-anu-domains.mjs, scratch/probe-tripo-parents.mjs",
  },
  {
    id: "rabbit-families-low-poly-webgl-holes",
    learnedAt: "2026-05",
    title: "Rabbit families — real WebGL holes, not CSS/sprites, must stay tiny",
    summary:
      "May-12 2026 triangle-pressure request: `js/v2/Fauna.js` now owns three independent rabbit families, each with a real scene burrow built from small procedural Three.js geometries (lathed dirt rim, dark back-side cylinder throat, lip/floor caps). This satisfies the 'WebGL not CSS or sprite' requirement without creating a new renderer, texture atlas, terrain rewrite, or high-poly asset. The important Anu lesson: these holes are NOT the source of the sustained-triangle-pressure alert; the alert is still dominated by the known Tripo GLBs / forest / duplicate PiP pass. Keep fauna burrows procedural and low-poly so rabbit behavior does not distract from the real triangle levers documented in `tripo-asset-decimation` and `trees-instancing-tri-count`.",
    mitigations: [
      "Do not replace the burrows with GLB/sculpt assets unless a probe shows the triangle cost remains trivial; the current burrow is intentionally only a few simple primitives per family.",
      "Do not add a separate rabbit-hole canvas, CSS sprite layer, or decal renderer. Burrows live in the main THREE.Scene so Anu's scene inventory can see them and normal culling/shadows apply.",
      "When sustained triangle pressure appears, run `scratch/probe-anu-domains.mjs` before changing fauna. The likely levers remain Tripo asset decimation, PiP stride/frustum, and flora instance caps.",
    ],
    files: ["js/v2/Fauna.js", "js/v2/AnuModule.js"],
  },
  {
    id: "v2panel-three-namespace",
    learnedAt: "2026-05",
    title: "Legacy ThreeIcons must not assign onto import * as THREE",
    summary:
      "ES module namespace objects are non-extensible; expose loaders via Proxy or subclass, never THREE.GLTFLoader = …",
    mitigations: ["js/v2/V2Panel.js createThreeGlobalForLegacyIcons()"],
    files: ["js/v2/V2Panel.js", "Component.ThreeIcons.js"],
  },
  {
    id: "guides-fullscreen-webgl",
    learnedAt: "2026-05",
    title: "V2Panel / ThreeIcons adds another fullscreen WebGL layer",
    summary:
      "ThreeIconManager clears a full-size overlay canvas each frame — distinct from main + PiP. May-12 2026 RESOLVED by the Tier-B/Tier-C icon renderer (see memory entry `v2-hud-icon-tier-b`): the canvas still exists at full window size (the scissor math is by-design tied to viewport-relative container rects) but the per-frame full-window clear is replaced by scissored-per-icon clear, hidden guide containers collapse to zero rects, cached scene animation updates run ONLY for visible icon types, and V2Panel can hard-pause the guide rAF loop while the guide strip is hidden. The historical advice ('activate V2Panel only when needed') is no longer required for steady-state FPS; activate freely.",
    mitigations: [
      "js/v2/V2IconRenderer.js — subclass: ~15 fps cap (every 4th rAF on 60Hz) + scissored clear (only icon rects clear per frame) + off-screen cull (zero-area or out-of-viewport icons skipped entirely) + visible-only cached scene updates + setGuideIconsActive(false) rAF pause while guides are hidden.",
      "V2Panel passes maxPixelRatio=2 for crisp guide models while keeping the full-window canvas bounded and relying on scissored render regions for fill-rate control.",
    ],
    files: ["js/v2/V2Panel.js", "js/v2/V2IconRenderer.js", "Component.ThreeIcons.js"],
  },
  {
    id: "v2-hud-icon-tier-b",
    learnedAt: "2026-05",
    title: "v2-hud-dock + Tier-B icon renderer — invariants",
    summary:
      "May-12 2026: re-enabled V2Panel in index.v2.html after the legacy ThreeIcons full-window-clear FPS issue was fixed by a subclass override (`createV2IconRendererLite` in js/v2/V2IconRenderer.js). The fix uses single-dispatch JS class inheritance: the legacy constructor calls `this.initLoop()`, which polymorphically resolves to the subclass's throttled+scissored loop, so the legacy 60Hz fullscreen-clear loop NEVER STARTS. Scene builders (buildQuest/buildSearch/buildLog/buildGather/buildFish) are fully reused via prototype, including the axe GLB + fish OBJ + procedural models + their idle animations.\n\nLayout: three legacy absolutely-positioned panels (#v2-left-panel / #v2-center-stack / #v2-right-panel) replaced by a single fluid flex dock #v2-hud-dock with three slots (.dock-left, .dock-guides, .dock-right). All three sit on the same horizontal baseline by construction (justify-content: space-between, align-items: flex-end); responsive via clamp() on --panel-size/--btn-size/--panel-offset plus two media queries (≤1100px compresses guide cards; ≤760px hides the guide row, keeping left+right). No JS layout math.",
    impact:
      "Cost change for the icon canvas (rough order-of-magnitude estimate): clear cost was 1× full-window pixel writes per frame at 60Hz = ~60 × Wpx × Hpx scalar writes; now ~15 × Σ(icon_rect_area) per second while visible. Even at DPR≤2 and larger circles, the scissored area remains tiny vs full-window. When guide cards are hidden/offscreen while walking, V2Panel calls `setGuideIconsActive(false)`, cancelling the guide icon rAF loop entirely (no rect checks, cached scene updates, clears, or renders).",
    mitigations: [
      "js/v2/V2IconRenderer.js — createV2IconRendererLite(options). Default frameStride=4 (~15 fps cap on 60Hz) and maxPixelRatio=2. Polymorphic override of `initLoop` prevents the legacy fullscreen-clear loop from ever starting. `setGuideIconsActive(false)` is the canonical hidden-state pause; `disposeLite()` is the canonical teardown path.",
      "js/v2/V2Panel.js — V2PanelModule.load creates the lite renderer via createV2IconRendererLite + registers 5 icon containers (icon-quest, icon-search, icon-log, icon-gather, icon-fish). Do NOT call `new window.ThreeIconManager()` directly — that revives the legacy 60Hz fullscreen-clear loop and re-introduces the regression this memory documents.",
      "js/v2/V2Panel.js — guide containers use `hidden` while walking so the renderer culls the icon rects entirely, not just opacity-fades them.",
      "Layout invariant: the dock is `position: fixed; left:0; right:0; bottom: var(--panel-offset); display:flex; justify-content:space-between; align-items:flex-end;`. If a future change re-introduces `position:absolute` on #v2-left-panel / #v2-right-panel they will drift off the shared baseline at narrow viewports.",
    ],
    files: ["js/v2/V2Panel.js", "js/v2/V2IconRenderer.js", "index.v2.html", "Component.ThreeIcons.js"],
  },
  {
    id: "v2-hud-avatar-mirror-canvas",
    learnedAt: "2026-05",
    title: "HUD Avatar3 mirror — second V2Panel WebGL canvas",
    summary:
      "May-12 2026: `#v2-avatar-hud-canvas` renders a `SkeletonUtils.clone` of the world Avatar3 mesh in a tiny off-HUD scene. The HUD no longer owns an independent AnimationMixer: V2Panel copies the live world Avatar3 local transforms + morph weights into the HUD clone each frame, then applies a presentation yaw on a wrapper pivot. This mirrors idle/walk/gesture poses 1:1 and avoids mixer/action drift. Main canvas draw stats do not include this context — same caveat as PiP.",
    mitigations: [
      "evaluateLivePipelineRisk expected canvas count adds +1 when V2Panel is active (icon canvas + avatar canvas).",
      "Render cadence for the mirror is ~30 Hz (every other orchestrator frame) while pose-copy sync runs every frame.",
    ],
    files: ["js/v2/V2Panel.js", "js/v2/AnuModule.js"],
  },
  {
    id: "anu-stress-ledger",
    learnedAt: "2026-05",
    title: "Anu stress ledger + loop errors export as JSON for tuning",
    summary:
      "SacredOrchestrator wraps the frame loop in try/catch; module updates isolated; AnuErrorAndStressLedger samples pipeline stress on an interval and buildAiCodingBrief() suggests constants edits when stress persists.",
    mitigations: [
      "AnuUniverse.exportStressJson() — paste into LLM/issue",
      "Subscribe ANU_EVENTS.PIPELINE_STRESS_LEVEL / ORCHESTRATOR_LOOP_ERROR",
    ],
    files: ["js/v2/anu/AnuErrorAndStressLedger.js", "js/v2/Orchestrator.js", "js/v2/AnuModule.js"],
  },
  {
    id: "anu-fuzzy-pipeline-sensor",
    learnedAt: "2026-05",
    title: "Anu exposes fuzzy bottleneck diagnosis for AI checks",
    summary:
      "AnuFuzzyPipelineSensor merges frame budget, PiP stride, scene inventory, draw-call history, module load errors, and loop errors into a ranked bottleneck list.",
    mitigations: [
      "AnuUniverse.getFuzzyPipelineSnapshot() — live object for tools",
      "AnuUniverse.exportFuzzyPipelineJson() — paste into LLM/issue",
      "AnuUniverse.report() — logs primary bottleneck with other pipeline memory",
    ],
    files: [
      "js/v2/anu/AnuFuzzyPipelineSensor.js",
      "js/v2/anu/AnuErrorAndStressLedger.js",
      "js/v2/anu/SceneModelInventory.js",
      "js/v2/AnuModule.js",
    ],
  },
  {
    id: "anu-scene-player-bus",
    learnedAt: "2026-05",
    title: "Scene inventory + player/UI interactions on Anu InteractionBus",
    summary:
      "SacredOrchestrator samples full scene drawable inventory on an interval (SceneModelInventory). World dispatches PLAYER_KEY_EDGE and PLAYER_STATE_SAMPLE; UIModule dispatches UI_PIP_VIEW_TOGGLE and existing SEASON_CHANGE — subscribe via AnuUniverse.interactions.subscribe.",
    mitigations: [
      "AnuUniverse.exportSceneInventoryJson() — full mesh list (may truncate rows)",
      "Events: PLAYER_STATE_SAMPLE (~24f), PLAYER_KEY_EDGE (edges), SCENE_INVENTORY_TICK (~120f)",
    ],
    files: ["js/v2/anu/SceneModelInventory.js", "js/v2/World.js", "js/v2/UIModule.js", "js/v2/Orchestrator.js"],
  },
  {
    id: "anu-simulation-controller",
    learnedAt: "2026-05",
    title: "Anu as universe simulation controller (player / flora / fauna / structures / population)",
    summary:
      "SimulationController merges SacredOrchestrator module roster + scene inventory domain rollups (bySimulationDomain). Meshes should set userData.anuSimulationDomain + anuKind. Planned fauna/NPC/buildings dispatch FAUNA_TICK, NPC_ENTITY, STRUCTURE_EVENT.",
    mitigations: [
      "AnuUniverse.exportSimulationJson() — full simulation overview",
      "Trees / World tag meshes — SacredFlora_* flora, terrain/haze environment",
    ],
    files: ["js/v2/anu/SimulationController.js", "js/v2/Trees.js", "js/v2/World.js", "js/v2/anu/SceneModelInventory.js"],
  },
  {
    id: "anu-world-sensorium",
    learnedAt: "2026-05",
    title: "Anu world sensorium unifies objects, domains, interactions, and pressure",
    summary:
      "AnuWorldSensorium combines scene inventory, simulation domains, fuzzy pipeline diagnosis, active modules, and interactable metadata into one AI-readable awareness snapshot.",
    mitigations: [
      "AnuUniverse.getWorldSensoriumSnapshot() — live object/domain awareness",
      "AnuUniverse.exportWorldSensoriumJson() — paste into LLM/issue before adding flora/fauna/NPC/buildings/items",
      "Every world Object3D should set userData.anuSimulationDomain; interactables should set anuInteractable + anuInteractionVerbs.",
    ],
    files: [
      "js/v2/anu/AnuWorldSensorium.js",
      "js/v2/anu/SceneModelInventory.js",
      "js/v2/anu/SimulationController.js",
      "js/v2/AnuModule.js",
    ],
  },
  {
    id: "anu-governance-rules",
    learnedAt: "2026-05",
    title: "Anu governance rules own models, physics, and AI IO",
    summary:
      "AnuGovernanceRules makes model registration, interaction registration, 3D gravity, 3D elevation physics, and AI IO authority explicit runtime contracts.",
    mitigations: [
      "AnuUniverse.GOVERNANCE_RULES — canonical enabled rules",
      "AnuUniverse.getGovernanceSnapshot() — live compliance check",
      "WorldPhysics.getAnuPhysicsSnapshot() — gravity/elevation proof for ANU",
    ],
    files: [
      "js/v2/anu/AnuGovernanceRules.js",
      "js/v2/World.js",
      "js/v2/anu/AnuWorldSensorium.js",
      "js/v2/AnuModule.js",
    ],
  },
  {
    id: "avatar3-player-figurine",
    learnedAt: "2026-05",
    title: "Avatar3 is the governed player figurine",
    summary:
      "World installs Assets/Avatar3.glb as the player avatar, corrects its imported facing to v2 player-forward, stores all GLB animation clips, and adds a travel circle.",
    mitigations: [
      "WorldPlayer.animations — runtime list of Avatar3 clips",
      "WorldPlayer.avatar.userData.anuAnimationScan — scanned clip notes + semantic mapping",
      "ANU_EVENTS.PLAYER_AVATAR_ANIMATION — animation state changes",
      "Proximity NPC greet/orbit was removed — no automatic tipi/population coupling to player yaw",
    ],
    files: ["Assets/Avatar3.glb", "js/v2/World.js", "js/v2/anu/anuEvents.js"],
  },
  {
    id: "npc-yb-tipi1-population",
    learnedAt: "2026-05",
    title: "NPC.YB (Yellow Butterfly) seated host on tipi 1 sacred deck",
    summary:
      "WorldStructures loads Assets/NPC.YB.glb with POPULATION domain tagging, sit clip, model yaw from constants, and a gold player-style travel marker (disc + ring + facing arrow). The seated root origin is **below** the green platform deck (`deckTop + vertical_trim − seat_lower`); the marker lift must include `(seat_lower − vertical_trim) + travel_lift` so the decal draws **on** the deck, not inside the cylinder beneath it.",
    mitigations: [
      "constants.js — V2_NPC_YB_TIPI1_* including V2_NPC_YB_TIPI1_GOLD_CIRCLE_LIFT_M",
      "WorldStructures.js — attachYellowButterflySeatedTipi1 / addGoldTravelMarkerAtFeet",
      "PiP ortho ring clip allowlist keeps tipi, platform, and YB visible under the compass disk",
    ],
    files: ["js/v2/WorldStructures.js", "js/v2/constants.js", "js/v2/anu/PipOrthoRingDiskClip.js"],
  },
  {
    id: "world-collision-autowalk",
    learnedAt: "2026-05",
    title: "WorldPhysics owns colliders and autowalk avoidance",
    summary:
      "WorldPhysics now exposes circular obstacle colliders, body collision resolution, and steerAroundObstacles() so player, NPC, and wildlife locomotion can share the same avoidance rules. Tipi models are explicitly passable. Player **long-hold autowalk** (WorldPlayerController.syncAutowalkFromHeldKeys) is additionally suppressed inside **one tile** of either tipi centre in World.js — clears `_autoWalk` if already active and blocks both arming (3 s hold) and the drift branch while near — so autowalk never stomps through NPC greet poses at tipi 1 or tipi 2.",
    mitigations: [
      "WorldPhysics.js — add solid/passable circular XZ colliders for scene objects",
      "WorldPhysics.steerAroundObstacles() — reusable avoidance hook before assigning NPC/wildlife/player velocity",
      "WorldPlayerController.js — long-hold movement key state for player autowalk",
      "World.js — tipi proximity gate: `min(distXZ(player, origin), distXZ(player, (V2_TIPI_2_CENTER_X_M,0))) < V2_TILE_WORLD` suppresses autowalk (clears active flag + skips sync + skips drift dir). Tipi centres are world-space constants matching WorldStructures placement.",
    ],
    files: ["js/v2/World.js", "js/v2/WorldPhysics.js", "js/v2/WorldPlayerController.js"],
  },
  {
    id: "world-input-axis-convention",
    learnedAt: "2026-05",
    title: "Input axis convention — turn-key polarity is USER-CHOSEN, not physics-derived",
    summary:
      "World.js has two horizontal input pairs that are tuned INDEPENDENTLY because the user has different preferences for each: (1) **Strafe keys (A / D)** are physical: A strafes the player toward their left (world -X at spawn yaw=π / facing +Z), D strafes right. After the May-2026 fix, the bindings are `a → dir.x += 1` and `d → dir.x -= 1` (positive Y rotation matrix on lines 380–381 makes those map to -X/+X at yaw=π). (2) **Turn keys (ArrowLeft / ArrowRight)** are NON-physical per the user's explicit request: `ArrowLeft → yaw += turnRate*delta` and `ArrowRight → yaw -= turnRate*delta`. Under the engine's `_fwd = (-sin yaw, 0, -cos yaw)` convention, increasing yaw rotates `_fwd` from +Z toward +X (right-handed +Y rotation, CW from above) — so ArrowLeft actually turns the player toward physical RIGHT (+X / east). The compass dial correctly reflects this physical heading (E comes to the top of the bezel when ArrowLeft is held). The user chose this mapping (May 2026) for muscle-memory reasons and is aware the heading dial 'looks reversed' under it — that's the intended trade-off. The previous May-2026 turn-key inversion fix was rolled back on user request.",
    mitigations: [
      "**Strafe vs Turn are independent.** Do NOT 'symmetry-fix' the turn keys to match strafe physics. They were deliberately set asymmetric. If a future contributor sees 'A is left, ArrowLeft is right' and tries to make them consistent, they'll regress the user's preferred turn-key feel.",
      "**Compass is the truth-teller for PHYSICS, not for KEYS.** It uses the *physical* yaw via `_syncCompass(yaw)`. Under the current turn-key polarity, ArrowLeft makes the compass show 'E at top' (because the player physically turns toward east). If a future report says 'compass is backwards' AGAIN, ask first: 'do you want me to fix the compass display, the key polarity, or leave it alone because you like the muscle memory?' Do NOT silently re-invert anything — the May-2026 history shows this oscillates.",
      "**Strafe bindings are physically correct and load-bearing.** `a → dir.x += 1`, `d → dir.x -= 1`. The rotation matrix on lines 380–381 (`wx = x·cos + z·sin / wz = -x·sin + z·cos`) is a NEGATIVE Y rotation; with these signs the strafe keys come out physical (A=left=world -X at yaw=π). Don't 'fix' that matrix — flipping it without also flipping `_fwd`, the camera lookAt, and A/D would re-invert the entire world.",
      "**Autowalk inherits direction** from the last `dir` vector before normalization (`WorldPlayerController.syncAutowalkFromHeldKeys`). Strafe direction is physical, so autowalk strafe is physical. Autowalk does not call the turn keys so it's unaffected by their polarity.",
      "**README hint** in `index.v2.html`: 'W/S or ↑↓ = move | ←→ = turn in place | A/D = strafe | SPACE = jump'. The hint doesn't promise physical-vs-camera polarity — keep it that way unless the user asks for an annotation.",
      "**Avatar facing follows yaw via `_avatar.setPose(..., this._yaw)`** — the figurine, camera, and compass all agree because they read the same `_yaw`. Don't introduce a parallel 'visual yaw' variable; one source of truth.",
    ],
    files: [
      "js/v2/World.js",
      "js/v2/WorldPlayerController.js",
      "js/v2/UIModule.js",
      "index.v2.html",
    ],
  },
  {
    id: "tipi-sacred-platform-legacy-parity",
    learnedAt: "2026-05",
    title: "Tipi + sacred green platform match legacy EnvironmentBuilder",
    summary:
      "Canonical heights live in constants.js: trees scale to V2_TREE_TEMPLATE_TARGET_HEIGHT_M (11), yellow butterfly tipi to V2_TIPI_YELLOW_BUTTERFLY_TARGET_HEIGHT_M (7.2), Avatar3 to V2_AVATAR_TARGET_HEIGHT_M (~0.93 m, baseline 1.78 × 0.7 × 0.75). WorldStructures loads cylinder platform radius 4.7, height 0.22, colour 0x1a2e1a, cylinder centre terrainY + 0.05 — parity with js/EnvironmentBuilder.js.",
    mitigations: [
      "js/v2/constants.js — shared tuning constants",
      "js/v2/WorldStructures.js — loadCenterTipi implementation",
      "Legacy reference — js/EnvironmentBuilder.js (yellow butterfly tipi block)",
    ],
    files: ["js/v2/constants.js", "js/v2/WorldStructures.js", "js/v2/Trees.js", "js/v2/WorldAvatar.js"],
  },
  {
    id: "avatar-crossfade-play-order",
    learnedAt: "2026-05",
    title: "Animation crossFadeFrom requires incoming action to be playing first",
    summary:
      "THREE.AnimationAction.crossFadeFrom schedules fadeIn on the incoming clip. Calling crossFadeTo before play() leaves mixer weights wrong and can strand limbs (e.g. one leg frozen during walk).",
    mitigations: [
      "WorldAvatar.play — next.play() then next.crossFadeFrom(prev) (Three.js executeCrossFade pattern).",
    ],
    files: ["js/v2/WorldAvatar.js"],
  },
  {
    id: "pip-ui-vs-webgl-scope",
    learnedAt: "2026-05",
    title: "PiP UI scope vs WebGL PiP scope — protect parent #pipCanvas",
    summary:
      "Mixing HTML/CSS dial work with the live #pipCanvas WebGL render path historically replaced the green map with a flat fill. UI changes (compass, moon dial, season hover, zoom controls, separators) belong in js/v2/UIModule.js around the canvas; render-path changes belong in SacredOrchestrator._renderPip / PipRenderStrategy / PipOrthoRingDiskClip. .cursor/rules/sacred-pip-map-protect.mdc encodes the boundary.",
    mitigations: [
      "Treat #pipCanvas as the Orchestrator WebGL target — never repurpose for 2D decoration.",
      "Bezel/compass/moon dial/zoom edits live in UIModule.js + Component.MoonDial.html, never in render-path files.",
      "If the change might touch WebGL PiP, stop and confirm in one line before editing.",
    ],
    files: [".cursor/rules/sacred-pip-map-protect.mdc", "js/v2/UIModule.js", "js/v2/Orchestrator.js", "js/v2/anu/PipRenderStrategy.js"],
  },
  {
    id: "moondial-compass-and-glass",
    learnedAt: "2026-05",
    title: "Moondial compass formula + PiP crystal-dome glass (legacy 1:1, extended to moonphase rim)",
    summary:
      "Two related UIModule fixes for the moondial bezel, scoped strictly to js/v2/UIModule.js (no PiP WebGL or render-strategy edits). (1) Compass: ring rotation is `180 - yawDeg` (mod 360) — see `js/v2/pipCompassMath.js` for the canonical implementation + four-cardinal proof. The earlier inline formula painted the dial 180° upside-down at spawn because v2 spawn yaw is π (player facing +Z = north toward tipi 1), not 0. **May-11 2026 hardening:** that law is now **exported from one module** so `js/v2/anu/PipRenderStrategy.js` (surrogate-2D PiP) cannot drift to a different `ctx.rotate(-yaw)` again — that mismatch read to users as 'you keep inverting my compass'. (2) Crystal-dome glass: .pip-optics-stack mask was tightened from a clamp around 14% inset to `calc(100% - var(--pip-moon-track))` so the glass surface now reaches the **inner edge of the moonphase track** (where the lunar ring meets the WebGL hole). .pip-optics-glaze is the legacy Component.MoonDial #pip-lens::after formula reproduced 1:1: highlight `ellipse 92% 74% at 34% 26% → rgba(255,255,255,0.22)`, dark seat `circle at 50% 88% → rgba(0,15,30,0.18)`, `mix-blend-mode: soft-light`, opacity 0.88. .pip-optics-shade keeps the top inset rim highlight but the bottom inset shadow was pulled from 40px / 0.20 to 28px / 0.14 so the moonphase ring at the rim no longer reads as dimmed under the glass. .lunar-phase-slot dropped its 0.82 opacity + heavy drop-shadow filter — moon glyphs are now crisp on top of the dome.",
    mitigations: [
      "Layering invariant: .pip-optics-stack is z:1, .lunar-radial-ring (moon phase slots) is z:7, compass-outer-ring is z:6, pip-lens-legacy is z:4, pipOverlay is z:3, pipCanvas is z:0. The glass NEVER overlays the moonphases because of this z-order — if a future contributor raises optics-stack above z:6, the moons will start reading as fuzzed again. Don't raise it.",
      "**Single source:** `pipCompassRingRotationDegFromYawRad` / `pipCompassRingRotationRadFromYawRad` in `js/v2/pipCompassMath.js`. UIModule `_syncCompass` and PipRenderStrategy surrogate compass **must** import these — never re-derive `±π` or `180−` locally. The oscillation users hate came from editing World.js yaw/keys and then 'fixing' UI in one file without grep-updating the other.",
      "Compass law remains `180 - yawDeg` (mod 360), now centralized. Do not 'fix' to plain `-yawDeg` or `yawDeg` — both break at spawn yaw π. If world-yaw convention flips, update `pipCompassMath.js` JSDoc + proof table, then consumers only.",
      "If the v2 spawn yaw changes, the compass still self-corrects — the formula derives ring rotation from the live yaw, no per-spawn baked constant. If world-yaw convention itself flips (e.g. switch to right-hand from-above CW), update the formula derivation in `pipCompassMath.js` and re-verify all four cardinals.",
      "**The compass is the truth-teller** — it always shows the player's *physical* heading, not what their key labels promise. If a user ever reports 'compass is backwards', the bug is almost certainly in the input mapping (see `world-input-axis-convention`), not in this formula. Verify input semantics with a Playwright probe before touching `pipCompassMath.js` or `_syncCompass`.",
      "The crystal-dome mask boundary is var(--pip-moon-track) (default 22px). If a future redesign moves the moonphase track inward, change the CSS var only — both the lunar-radial-ring's own mask AND the optics-stack mask key off the same variable so they stay aligned.",
      "Glass formulas are the legacy iframe (Component.MoonDial.html) 1:1 — DO NOT just bump intensities to 'more glassy'. The legacy was tuned at those exact numbers (highlight 0.22, dark anchor 0.18, blend soft-light, opacity 0.88) — they're the canonical look the user explicitly asked for.",
      "Moon-glyph crispness was the user-visible cost of the previous 0.82 opacity + drop-shadow blur halo. If you re-add a glow effect (e.g. for active phase), use box-shadow / filter only on the .active-phase / :hover states — do NOT apply a default filter to .lunar-phase-slot itself.",
      "This card lives alongside `pip-ui-vs-webgl-scope` — together they form the scope boundary for moondial work. Future moondial tweaks (bezel material, additional rings, animated indicator pointer) belong in UIModule.js + this card; render-path changes do not.",
    ],
    files: [
      "js/v2/UIModule.js",
      "js/v2/pipCompassMath.js",
      "js/v2/anu/PipRenderStrategy.js",
      "Component.MoonDial.html",
      ".cursor/rules/sacred-pip-map-protect.mdc",
    ],
  },
  {
    id: "travel-floor-decal-depth",
    learnedAt: "2026-05",
    title: "Horizontal travel decals must ignore depth on uneven terrain",
    summary:
      "The white travel ring/disc and gold NPC marker disappeared into grass micro-relief on tilted terrain because the shader materials default to depth testing. Fix is depthTest:false + depthWrite:false plus consistent renderOrder (8/9/10 disc/ring/arrow) on every horizontal floor decal.",
    mitigations: [
      "TravelFloorCircleMaterials.js — disc and ring materials disable depth.",
      "WorldAvatar.js arrow + WorldStructures.js NPC marker reuse the same depth + renderOrder policy.",
      "If a future decal should occlude, build a different material factory; do not flip the policy on the shared one.",
    ],
    files: ["js/v2/anu/TravelFloorCircleMaterials.js", "js/v2/WorldAvatar.js", "js/v2/WorldStructures.js"],
  },
  {
    id: "bush-glb-removal-discipline",
    learnedAt: "2026-05",
    title: "Remove every reference when removing a corrupt asset",
    summary:
      "A corrupt bush model under the Assets root required stripping its loader call in six files (js/EnvironmentBuilder.js, dist/js/EnvironmentBuilder.js, WORDPRESS/js/EnvironmentBuilder.js, WORDPRESS/dist/js/EnvironmentBuilder.js, WORDPRESS/js/components/WorldManager.js, and _legacy_archive/SacredGame.3f24aff.html). Loader chains that resolve via promise must still resolve so forest pipelines do not stall.",
    mitigations: [
      "Run `npm run check:assets` — STRICT failures cite file:line of every dangling reference.",
      "When deleting an asset, grep its base name across the repo before commit; do not rely on memory.",
    ],
    files: ["scripts/check-assets.mjs", "Assets/README.md"],
  },
  {
    id: "assets-gate-strict-warn",
    learnedAt: "2026-05",
    title: "Assets gate guards canonical v2 against missing or corrupt files",
    summary:
      "scripts/check-assets.mjs walks js/v2/** + index.v2.html (STRICT) and legacy/WordPress/SacredOnes.1/scratch (WARN), verifies every Assets/... reference exists, and confirms .glb files start with the glTF magic. Wired into `npm test` so CI fails on STRICT regressions before Playwright even starts.",
    mitigations: [
      "npm run check:assets — fast gate, exits 1 on STRICT failure.",
      "--strict flag promotes WARN findings to failures for full-tree audits.",
      "WARN tier surfaces ~30 legacy dangling refs as the Phase 7 reconciliation queue.",
    ],
    files: ["scripts/check-assets.mjs", "package.json", "Assets/README.md"],
  },
  {
    id: "legacy-tree-reconciliation",
    learnedAt: "2026-05",
    title: "Legacy / WordPress drift policy — keep / freeze / sunset matrix",
    summary:
      "Phase 7 of the 78→100 program. The repo holds parallel trees that pre-date js/v2/ (the canonical engine). docs/legacy-reconciliation.md is the source of truth: js/v2/ KEEP-canonical; WORDPRESS/ KEEP-FROZEN production bundle; dist/ KEEP-artifact; js/ (non-v2) FROZEN reference; _legacy_archive/ SUNSET read-only; scratch/ SUNSET deletable; SacredOnes.1/ KEEP sibling exploration. The asset gate already encodes the same tier split (STRICT vs WARN). When porting behaviour from legacy, re-implement inside js/v2/, add a fidelity test, leave the legacy file untouched.",
    mitigations: [
      "Before editing anything outside js/v2/, read docs/legacy-reconciliation.md and confirm the tree's status.",
      "Do NOT 'mirror' v2 changes into WORDPRESS/ unless the user explicitly asks for a deploy update — the WP bundle is independent.",
      "If a WARN-tier asset reference becomes a real WP runtime blocker, promote to a focused fix on the WP page only — never a sweep across legacy code.",
      "Future legacy ports follow the 5-step protocol in docs/legacy-reconciliation.md (read → re-implement in v2 → add test → ANU card → leave legacy alone).",
    ],
    files: [
      "docs/legacy-reconciliation.md",
      "scripts/check-assets.mjs",
      "js/v2",
    ],
  },
  {
    id: "npc-yb-tipi-scene-polish",
    learnedAt: "2026-05",
    title: "Seated NPC YB scene: model centred on disc, arrow flipped, halo + small ceremonial fire added",
    summary:
      "User-reported scene polish to the seated host at tipi 1. (1) Model X/Z centred on its bbox so she sits over the gold disc centre (the GLB pivot is internally offset). (2) Facing arrow shape Y values negated → tip now points to the OPPOSITE side of the disc, matching her seated forward direction. (3) Root Z pushed 1 ft north (V2_NPC_YB_TIPI1_LOCAL_Z_M = -0.4 - 0.3048) so a small ceremonial fire fits 1 ft south of hex centre, 1 ft above the analytic terrain, with a 6-inch flame (V2_TIPI_NPC_CEREMONIAL_FIRE_*). The new fire reuses the brazier shader via createTipiCampfire's new optional { scale, lightIntensity, lightDistance } params. (4) Soft additive Sprite halo behind her headdress (canvas radial gradient, depthTest:false, AdditiveBlending) — saintly read without a real PointLight.",
    mitigations: [
      "When adding a new GLB host, do not assume the model's internal pivot is centred — measure with Box3.getCenter and translate model.position.x/z accordingly.",
      "If a future arrow needs to flip again, prefer flipping the Shape Y values over rotating the mesh post-rotation — keeps the arrow.rotation.x = -π/2 invariant simple.",
      "createTipiCampfire's lightIntensity/lightDistance scale linearly with the proportional flicker; a smaller flame should also use a smaller PointLight range to avoid overpainting the deck.",
      "PiP ortho ring/disk clip handles Mesh/Points materials only — Sprite materials slip through. Acceptable for the small NPC halo; if a larger sprite VFX is added, extend installPointsShaderMaterialPipRingDiskClip's sibling for SpriteMaterial.",
    ],
    files: [
      "js/v2/WorldStructures.js",
      "js/v2/TipiCampfire.js",
      "js/v2/constants.js",
    ],
  },
  {
    id: "pip-user-zoom-wire-up",
    learnedAt: "2026-05",
    title: "PiP user zoom (UIModule \"+/−\") wired into the Orchestrator ortho frustum",
    summary:
      "UIModule's pip-zoom buttons dispatch CustomEvent `v2-pip-zoom-change` and persist `sacred:v2:pipZoom` to localStorage. Phase 5 adds the matching listener in SacredOrchestrator: `_pipUserZoom` is seeded from localStorage on construct, updated on each event, and combined as `V2_PIP_ORTHO_WIDTH * V2_PIP_ORTHO_ZOOM * _pipUserZoom` for both `_ensurePipPipeline` and `_resizePipIfNeeded` frustum spans. Both zero `_pipW/_pipH` after a zoom change so the ortho rebake happens on the next PiP tick. Listener torn down in dispose().",
    mitigations: [
      "UIModule clamp [0.6, 1.6] is duplicated on the orchestrator side as a defense for callers that bypass UIModule.",
      "_pipUserZoom is read from localStorage with try/catch (private mode / blocked storage) — falls back to 1.",
      "Designer constant V2_PIP_ORTHO_ZOOM stays the canonical default; user zoom multiplies it, not replaces it.",
    ],
    files: ["js/v2/Orchestrator.js", "js/v2/UIModule.js", "js/v2/constants.js"],
  },
  {
    id: "npc-arrow-decal-policy-alignment",
    learnedAt: "2026-05",
    title: "NPC YB gold travel arrow now follows the shared floor-decal depth policy",
    summary:
      "Phase 5 audit found one straggler: the NPC YB arrow in WorldStructures.js used a hand-rolled MeshBasicMaterial with polygonOffset, missing depthTest:false, and renderOrder:3 — out of step with the avatar arrow (renderOrder:10, depthTest:false, depthWrite:false). Aligned with the policy from `travel-floor-decal-depth`: drop polygonOffset, add depthTest:false, bump renderOrder to 10. Stays readable on the sacred deck and on tilted terrain alike.",
    mitigations: [
      "If a future arrow / decal genuinely should occlude, build a different material — do not flip the policy on the shared one.",
      "When adding a new floor decal, copy the avatar arrow's material recipe (depthTest+depthWrite false + renderOrder 8/9/10).",
    ],
    files: ["js/v2/WorldStructures.js", "js/v2/WorldAvatar.js", "js/v2/anu/TravelFloorCircleMaterials.js"],
  },
  {
    id: "orchestrator-pip-decomp-and-hud-line",
    learnedAt: "2026-05",
    title: "PiP render decomposed (prepare/pass/restore) + HUD pip status line",
    summary:
      "SacredOrchestrator._renderPip() previously did gating, scene mutation, branch render, and restore in one block. Phase 4 split it into _preparePipScene → _renderPipPass → _restorePipScene with a finally-guaranteed restore, and added _pipRenderedLastFrame tracked at every gate exit. The HUD now carries a #v2-pip line `PiP=on stride:N phase:M rendered:✓` (or `PiP=off`) so the second-context cost (which renderer.info does not include) is at least visible at a glance.",
    mitigations: [
      "Future PiP review only needs to read the prepare/pass/restore trio, not a 60-line monolith.",
      "HUD pip line surfaces stride/phase from RenderingGovernor.getRenderingSnapshot() — single source of truth.",
      "_pipRenderedLastFrame flag is cleared on dispose so a re-mount starts honest.",
    ],
    files: ["js/v2/Orchestrator.js", "js/v2/anu/RenderingGovernor.js"],
  },
  {
    id: "anu-api-naming-coherence",
    learnedAt: "2026-05",
    title: "AnuUniverse.report() labels match public API names; help() indexes the surface",
    summary:
      "Earlier report() output logged `Frame budget:` while the public method is AnuUniverse.budget.snapshot — confusing for tools and copy-paste debugging. report() now labels every console line with the canonical AnuUniverse.* method that produced it, and AnuUniverse.help() returns + prints the grouped supported-method index.",
    mitigations: [
      "AnuUniverse.help() — grouped index of supported methods.",
      "AnuUniverse.report() — labels each console.log with its public API name.",
    ],
    files: ["js/v2/AnuModule.js"],
  },
  {
    id: "phase-9-final-integration",
    learnedAt: "2026-05",
    title: "Phase 9 — 78→100 program close: rubric reassessment, baseline/v1, HUD label = UNIVERSE",
    summary:
      "Closing phase of the 78→100 program. Full suite green: 4/4 smoke + 4/4 fidelity in 36.8 s on Apple Silicon. Asset gate clean (6/6 STRICT pass; 31 WARN are policy-accepted per docs/legacy-reconciliation.md). Audit replay confirmed: evaluateLivePipelineRisk shape unchanged since Phase 2, none of the 27 ANU_PIPELINE_MEMORY incidents re-introduced. Score reassessment landed at 94/100 (rubric) — 8 of 10 dimensions in Excellent / World-class, no dimension below 85, hard floors held (Dim 3 ≥ 80 ✓, Dim 10 ≥ 80 ✓). Two laggards (Dim 5 Completeness 85, Dim 1 Architecture 94) have explicit out-of-scope follow-ups in docs/baselines/2026-05-10-final.md. One small UX touch: HUD modal label `ACTIVE MODULES` → `UNIVERSE` per user request — generally readable to non-developers while still pointing at the AnuUniverse module registry.",
    mitigations: [
      "Future work to push 94 → 100 has a written list in docs/baselines/2026-05-10-final.md §What's next (split Orchestrator.js, activate Fauna, HUD visual sentinel, boot help() print, quarantine SUNSET trees).",
      "When re-running the rubric, follow docs/SCORECARD.md §Capture protocol exactly — copy outputs from AnuUniverse.audit / report / budget / services / help into the next-dated baseline file.",
      "The HUD label is intentionally `UNIVERSE` not `ACTIVE MODULES`. Don't 'fix' it back — the underlying registry is still the AnuUniverse active-module list, the label is just user-facing.",
      "git tag baseline/v1 marks this snapshot; baseline/v0 is the pre-program reference. Never force-move either tag.",
    ],
    files: [
      "docs/baselines/2026-05-10-final.md",
      "docs/SCORECARD.md",
      "js/v2/Orchestrator.js",
    ],
  },
  {
    id: "fauna-pillar-simplified-three-rabbits",
    learnedAt: "2026-05",
    title: "Fauna pillar — tan family + narrow burrow + locomotion-synced hop clip",
    summary:
      "`js/v2/Fauna.js` (May-11 2026 refresh): **one tan mom** (25 % shorter than the old `0.55×avatar` calibration) + **two tan kits** on grass south-east of tipi 1. Kits follow offset slots behind mom with gravity and bounded hops (max vertical ≈ **2× kit body length**, clamped). Mom wanders slowly inside a ~1 m radius anchor. All three share `rabbit.animated.glb` cloned via **`SkeletonUtils.clone()`** (mandatory for SkinnedMesh — `Object3D.clone(true)` breaks multi-instance rigs). **Animation**: single GLB clip `timeScale` tracks horizontal speed vs `stride ≈ 0.38×bodyLength` so cadence stays in-family with leg length. **Hard locomotion invariant (May-11 late correction): rabbits turn in place first, then move only along local +Z after yaw error is ≤ 8°; no sideways/backwards translation is allowed.** **Attention**: optional `headBone` yaw tweak only while idle/looking; horizontal movement never comes from a free velocity vector. **`FAUNA_TICK` still not dispatched.** **Burrow**: `fauna_burrow_narrow_slot` at fixed `(5.55, -4.82)` — 6″-diameter tapering `BackSide` throat + bottom cap + raised soil lip ring (Bugs-Bunny read, not a wide plaza). `getFaunaSnapshot()` → `{ schemaVersion: '2.1', burrow: {x,z}, rabbits: [{id, role, position}] }`.",
    mitigations: [
      "**Rig-forward pivot** is a **quarter-turn**, not a half-turn (May-11 2026 evening, take 2 — measured via `scratch/probe-three-failures.mjs`). `rabbit.animated.glb`'s local bbox is `(x:0.96, y:1.0, z:0.52)` — the long (nose-to-tail) axis is **X**, not Z. An earlier `pivot.rotation.y = Math.PI` made the rabbit pass through its flank during `translateZ` (probe dot = 0 = perpendicular). The correct pivot is `pivot.rotation.y = axisSign * (Math.PI / 2)` where `axisSign` is `-1` if the head bone sits at `+X` in skeleton-root space (rotates `(1,0,0)→(0,0,1)`) or `+1` if at `-X`. Empirical sign is derived at load by comparing `headBone.matrixWorld.x` vs the skeleton root bone. **Do not** rotate the SkinnedMesh itself or you may disturb the skeleton bind orientation.",
      "**`bodyLengthM = size.x * scale`** (long axis), not `Math.max(size.x, size.z) * scale` — the latter can pick the short axis if the GLB ever loads in a different bind orientation. Use `size.x` after the long-axis-is-X invariant is established.",
      "**Strict turn-then-forward locomotion** (May-11 2026 late correction): both `updateMom` and `updateBaby` call `turnThenForwardStep()`. It clamps yaw by a per-role turn rate, refuses horizontal translation until remaining yaw error is ≤ `FORWARD_MOVE_MAX_YAW_ERR` (8°), then moves only via `r.group.translateZ(r.speed * dt)`. This prevents the visual side/back step that happened when a rabbit translated while the body was still rotating toward a target.",
      "**`frustumCulled = true`** on rabbit SkinnedMeshes — the earlier `false` was an over-defensive workaround that cost ~3 unnecessary skinning passes per frame when the rabbits were off-screen. Measured cost (`fps_after_warmup` in probe-three-failures.mjs): 30.6 fps → 47.0 fps after restoring culling. Bind-pose bbox is plenty for a rabbit that wanders within a ~1 m radius. Don't toggle this off again unless probing first.",
      "**SkeletonUtils.clone()** is non-negotiable for each rabbit instance. Regressing to `clone(true)` will make kits invisible or pin all instances to one skeleton.",
      "**Platform occlusion**: keep spawn anchors outside `V2_TIPI_SACRED_PLATFORM_RADIUS` (~4.7 m) or the deck cylinder + gold trim hide the meshes.",
      "**Per-rabbit material clones** — `tintRabbitMesh` clones before colour multiply so mom + kits can share one GLB load.",
      "**SkinnedMesh frustum culling stays enabled** on rabbit meshes (`frustumCulled = true`) — the GLB's bind-pose bounds are adequate for the tiny wander radius, and disabling culling was a measured FPS regression.",
      "**No Flora warren exclusion** — burrow is a tiny cosmetic patch on grass; tree layout unchanged from the post-warren-removal state.",
      "**ANU_EVENTS.FAUNA_TICK** remains unused; `AnuWorldSensorium` may still list it — no-op unless a subscriber is added.",
      "**Sacred circle decks** — tipi 1 + 2 platform cylinders use deep forest-green `MeshStandardMaterial` (`0x2d5a3a`) via `createForestGreenSacredCircleMaterial()` in `js/v2/WorldStructures.js`; this superseded the brief beige pass (which itself superseded the procedural/plaid stack). The constant lives in the helper function — touch one place to retune deck colour for both tipis.",
      "Fauna activates AFTER PanelsPIP in index.v2.html — do not reorder without moving v2LoadLog beats.",
    ],
    files: [
      "js/v2/Fauna.js",
      "js/v2/WorldStructures.js",
      "js/v2/Flora.js",
      "index.v2.html",
      "Assets/rabbit.animated.glb",
    ],
  },
  {
    id: "nature-spirit-stag-hologram-cycle",
    learnedAt: "2026-05",
    title: "Nature-spirit stag — 10 ft hologram, 5-min YB visit cycle, FPS-gated update",
    summary:
      "`js/v2/WorldNatureSpirit.js` was orphaned (broken imports — none of its `V2_NATURE_SPIRIT_*` constants existed) until the May-11 2026 revival. Owned by `WorldModule` (not a separate orchestrator module). Loads `Assets/animated.stag.glb` (Draco-compressed) via `GLTFLoaderWithDraco`, scales it to **10 ft** by fitting the GLB's measured bbox.y to `V2_NATURE_SPIRIT_HEIGHT_M` (was 20 ft on May-11 morning; halved that evening per user — too tall + the pivot-in-the-ground bug made the bottom half invisible). **FSM (May-11 2026 late correction — no mutated head/turn animation)**: `WAIT_TO_APPEAR` (30 s) → `WALK_TO_STANDOFF` (spawn at forest NW, walk to a point **0.5 tile south of YB** using `V2_NATURE_SPIRIT_YB_STANDOFF_M`; this keeps the whole model outside tipi 1's 4.7 m sacred-platform radius) → `FACE_YB` (stand still; slowly rotate the whole root toward YB with `FACE_YB_TURN_RATE`, no head-bone quaternion mutation) → `NOD` (2.6 s; at ~25 % calls `tipi.userData.ybBehaviour.playSpiritGreeting(stagX, stagZ)` and spawns the layered bloom pulse at YB) → `POST_NOD_HOLD` (1.6 s) → `WALK_TO_FOREST` → `COOLDOWN` (5 min) → loop. Hologram materials cloned per mesh, opacity + pulsed cyan-mint emissive (`0x6ef0c8`). Bloom is an additive **three-layer** pulse (wide halo disc, outer ring, delayed inner ring) anchored at YB and sustained for `V2_NATURE_SPIRIT_BLOOM_FADE_S` = 2.6 s with peak radius `V2_NATURE_SPIRIT_BLOOM_PEAK_RADIUS_M` = 8.5 m. A persistent additive foot-circle (`_footCircle`) is synced under the stag at terrain height while the stag root gets `V2_NATURE_SPIRIT_FEET_LIFT_M` so feet visually sit on the circle instead of below the grass. `playSpiritGreeting()` on the YB controller pulls her from `SEATED` into a one-shot `SPIRIT_GREETING` state (face the stag + play wave clip once); returns `false` if she's mid-player-cycle so the two FSMs never collide.",
    mitigations: [
      "**Fit-to-bbox height** (not raw `scale.setScalar(V2_NATURE_SPIRIT_HEIGHT_M)`) — the legacy orphan used the raw constant and produced a ~6× over-scale because the GLB is ~1 m tall on import. If you swap the stag GLB, the fit code keeps the spec.",
      "**Pivot-in-the-ground fix uses BONE bbox + root lift** (May-11 2026 late correction). The animated bone bbox extends below the geometry bind-pose bbox; original `asset.position.y -= rawBox.min.y` left the stag buried. Current two-step: (1) after `root.scale.setScalar(fitScale)` and `root.updateMatrixWorld(true)`, traverse all skinned meshes, expand a `Box3` over every bone's world position, and apply `asset.position.y -= boneBox.min.y / fitScale`; (2) set live root Y to `terrainY + V2_NATURE_SPIRIT_FEET_LIFT_M` so the visible feet sit on the hologram foot-circle. If the legs read buried again, adjust `V2_NATURE_SPIRIT_FEET_LIFT_M`, not the GLB scale.",
      "**Standoff clearance — NEVER walk to YB directly** (May-11 2026 late user correction). The old direct target put the stag visually onto tipi 1. Current target = `(YB.x, YB.z - V2_NATURE_SPIRIT_YB_STANDOFF_M)` = 0.5 tile south of YB; validation should assert min distance to YB ≥ 5.3 m. If the asset gets bigger, bump the standoff constant.",
      "**No head-bone mutation** — the previous head-only look (`findHeadBone`, `_headYaw`, `_applyHeadYaw`) created a strange mutated turn. It is intentionally deleted. During `FACE_YB`, rotate the whole `root` slowly toward YB with `_faceToward(..., FACE_YB_TURN_RATE)` while staying at the standoff point. Do not reintroduce per-bone look-at unless the user explicitly asks for it.",
      "**Foot hologram circle** — `buildFootCircle()` creates an additive ring + fill under the spirit. `_syncFootCircle()` pins it to `terrainY + 0.018`, matches root XZ/yaw, and fades opacity with `_opacity`. The foot-circle is part of the visual grounding contract.",
      "**Layered bloom pulse** — `buildBloomFlash()` returns three concentric unit-radius additive prims: a soft `halo` disc, a wide `outerRing`, and a delayed tighter `innerRing`. Per-frame `_tickBloom` scales each from a unit prim (no per-frame geometry rebuilds) and drives independent ease curves (sin-bell for rings, eased quadratic for halo). Tuning constants: `V2_NATURE_SPIRIT_BLOOM_PEAK_RADIUS_M` (8.5 m) and `V2_NATURE_SPIRIT_BLOOM_FADE_S` (2.6 s). Don't fork the bloom into per-frame `RingGeometry()` rebuilds — that was the regression vector last time.",
      "**Graceful crossfades** — all locomotion clip transitions use a single `CROSSFADE_S = 0.8 s` constant (was 0.4 s and felt twitchy). `WALK_SPEED_MPS = 1.2` and `TURN_RATE = 2.4` rad/s — both slowed deliberately for majesty. If the stag ever feels rushed, tune these three constants together; don't shorten the crossfade in isolation.",
      "**FPS short-circuit in `update()` (BIG WIN)**: skip `mixer.update(delta)`, `_tickHologram()`, and `_tickBloom()` entirely while in `WAIT_TO_APPEAR` (30 s) and `COOLDOWN` (5 min). The mixer driving the stag's skinned skeleton was the single biggest cost the controller added to the frame budget — it ran every frame for 5+ minutes evaluating a hidden mesh. The short-circuit advances the wake-up / cooldown timer only and lets the rest of the controller sleep. Do NOT remove the gate without measuring first.",
      "**Owned by `WorldModule`, not the orchestrator.** Don't register a `NatureSpiritModule` in `index.v2.html` — controller needs direct access to YB (`tipi.userData.ybBehaviour`, `ybSeatRoot`) and terrain, and lifecycle hangs off WorldModule's `load`/`update`/`unload`. If it ever moves to its own module, expose a service for YB via `RuntimeServices` first.",
      "**Greeting is opt-in for YB.** If `playSpiritGreeting()` returns `false` (YB busy with player approach / FAREWELL_WAVE etc.), the stag still nods and the bloom is suppressed — keeping the two cycles independent.",
      "**5-minute cooldown** is `V2_NATURE_SPIRIT_COOLDOWN_MS`; first appearance gated by `V2_NATURE_SPIRIT_APPEAR_DELAY_MS` (30 s) so the player sees the village before the visit.",
      "**Materials cloned per stag mesh** so the opacity/emissive pulse doesn't leak into shared `MeshStandardMaterial` sources. Dispose iterates `_materials` on `dispose()`.",
      "**Brazier 1 ft south of hex centre**: `V2_TIPI_BRAZIER_WORLD_Z_M` shifted from `-0.06` to `-0.06 - 0.3048` per user spec. Both tipi 1 and tipi 2 read from this constant.",
    ],
    files: [
      "js/v2/WorldNatureSpirit.js",
      "js/v2/NPCBehaviour.js",
      "js/v2/World.js",
      "js/v2/constants.js",
      "js/v2/AnuModule.js",
      "Assets/animated.stag.glb",
    ],
  },
  {
    id: "tipi-owner-proximity-behaviour",
    learnedAt: "2026-05",
    title: "Tipi-owner proximity FSM — wave moved from approach → depart, tipis face south, model yaw aligned",
    summary:
      "Each tipi has an 'owner' NPC. Two are wired: NPC.YB at tipi 1 (origin) and NPC.BHG at tipi 2 (V2_TIPI_2_CENTER_X_M ≈ 21.72 m east — one empty tile of grass between centres). Both tipis are PLAYER-IMPASSABLE via a 2.2 m solid collider; NPCs bypass because they write `root.position` directly and are not physics bodies, so the asymmetric 'NPC can enter, player can't' rule emerges naturally. **May-2026 reorientation pass** (3 related fixes): (1) Both tipis now have **yaw π** — doorway (GLB local +Z) maps to world -Z (south), lined up with the player's spawn axis at z = -3*tile. Previous -π/2 yaw pointed the doorway west. (2) NPC model yaw constants dropped the spurious `+ π` spin (`V2_NPC_YB_TIPI1_MODEL_YAW_RAD = π/2`, was `π/2 + π`). The model rig forward is local **-X**; π/2 maps that to facingGroup's local +Z, which is what `updateYellowButterflyPlayerAim` aligns with the player via `atan2(dx, dz)`. The `+ π` spin made her face 180° away (root cause of the 'all alignments are backwards' May-2026 report). (3) Greet FSM rewired per user spec: **wave is no longer on approach** — SEATED → if player crosses 1 tile → EXITING_WALK (crossfade sit → walk, walk straight to entrance) → STANDING_IDLE (idle clip, body tracks player). Past 2 tiles → new FAREWELL_WAVE state (face player, wave LoopOnce, stationary, ~1.4 s) → RETURNING (walk back to seat) → TURNAROUND_SIT → SEATED. Greeting events still publish via ANU_EVENTS.PLAYER_NPC_GREETING (phases: approach / arrived / depart / returned).",
    mitigations: [
      "NPC.YB.glb (8.4 MB Draco-compressed) and NPC.BHG.glb (30 MB Draco-compressed — was 105 MB uncompressed, see `assets-draco-diet-pass-1` for the May-2026 compression pass). Both ship 5 NlaTrack-named clips. The controller does name-search first (so a future re-bake with 'wave' / 'idle' / 'sit' / 'walk' clip names will Just Work) and falls back to the legacy `js/EnvironmentBuilder.js` index mapping: walk=0, idle=2, sit=3, wave=4. If those indices ever shift, update CLIP_PREFS.*.fallbackIndex.",
      "**Asset size**: NPC.BHG.glb was 12.5× larger than NPC.YB.glb until both were brought onto the same Draco pipeline in May 2026 — the residual 3.7× gap (30 MB vs 8.4 MB) is now textures, which Draco does not touch. Further reduction needs `textureCompress` (KTX2/Basis) or a smaller source bake.",
      "Tipi 2 reuses tipi 1's GLB (TIPI_2_URL = TIPI_1_URL). When a unique BHG tipi GLB lands, change just `TIPI_2_URL` in WorldStructures.js — every other tuning constant is already in `V2_TIPI_2_*` / `V2_NPC_BHG_TIPI2_*`.",
      "The behaviour controller is the only thing allowed to write `*FacingGroup.rotation.y` while the NPC is moving — the seated aim helper in World.js is short-circuited via `suppressPlayerAim`. Don't add another writer; either extend this controller or re-route through it.",
      "Approach/depart thresholds key off `V2_TILE_WORLD` (the canonical hex flat-width). Use that constant, not raw metres — the world has a hex shader and the design language is in tiles.",
      "The SEATED → EXITING_WALK transition is a RISING-EDGE trigger via `playerHasLeftZone`. If you remove the gate, the NPC pulls out of her seat instantly whenever the player loads inside the tile radius (the boot-time regression). Initialise the flag false; do not init to true.",
      "**Wave clip is now a farewell, not a greeting.** The user explicitly moved it from the approach phase to the depart phase (May 2026). Don't reintroduce wave on SEATED → EXITING_WALK — the new contract is silent approach + farewell wave. If you want a 'standing up' beat on approach, add a brief idle hold *before* walking; do not re-use the wave clip there.",
      "**FAREWELL_WAVE is stationary** — she faces the player and waves *before* turning to walk back. The user wording was 'wave while walking back'; we implement sequentially (wave → walk) because the rig has no upper-body-only wave clip and a concurrent wave+walk crossfade reads as visual chaos. If a future re-bake ships separate upper/lower NLA tracks, FAREWELL_WAVE can step position toward the seat while the wave plays on a layered track.",
      "**Both `NPC.YB.glb` and `NPC.BHG.glb` have rig-forward = local `+X`, so `MODEL_YAW_RAD = π/2 + π = 3π/2`.** Confirmed May-11 2026 by multi-angle `scratch/probe-village.mjs` snaps (`village-yb-close-from-player.png` vs `*-from-opposite.png`, plus east/west profiles): at `π/2` YB's decorated front-bib appeared on the NORTH side = AWAY from the player (the 'yb is backwards' symptom). The seated aim helper writes `facingGroup.rotation.y = atan2(dx, dz)` which aims facingGroup's local +Z at the player; for model.+X (rig forward) to land on facingGroup.+Z, the inner rotation must be `+π/2 + π = 3π/2`. An earlier doc-comment in `constants.js` claimed YB's rig was `-X` (and triggered a wrong revert to `π/2`) — that was based on a single low-light close-up which couldn't distinguish front from back. **Diagnosis recipe when an NPC reads as backwards:** rerun the probe with both `*-from-player.png` and `*-from-opposite.png` (and east/west profiles if needed); the side that shows the decorated front-bib is the FRONT, and `MODEL_YAW_RAD` must orient that side toward the player. Despite both NPCs sharing the same numeric value today, keep `V2_NPC_YB_TIPI1_MODEL_YAW_RAD` and `V2_NPC_BHG_TIPI2_MODEL_YAW_RAD` as independent literals (not aliases) so a future re-export of one GLB doesn't silently break the other.",
      "**Tipis face south by spec.** `tipi.rotation.y = π` for tipi 1, `V2_TIPI_2_YAW_RAD = π` for tipi 2. The GLB's doorway is on the local +Z side; π maps that to world -Z so the doorway is on the spawn-axis side of the cone. If a future scene moves spawn to north of the village, BOTH tipi yaws + the spawn `_yaw` need to flip consistently — do not change tipi yaw in isolation.",
      "Entrance position is FIXED, not radial. Earlier code used `_computeExitPoint(playerX, playerZ)` to walk her toward the player on a radial of `platformRadius + 1 foot`. That landed her at the deck edge regardless of which way the doorway actually faces. The new contract: every tipi owner walks to a single per-tipi entrance point set at construction. `entranceLocalXZ = { x: 0, z: -2.6 }` is now genuinely *at the south-facing doorway* (post the May-2026 tipi yaw reorientation), not an off-axis south flare exit.",
      "Tipi-cone player block uses radius 2.2 m < platform radius 4.7 m so the deck remains walkable around each tipi. If a future tipi has a wider base (re-baked asset), recompute the radius from the scaled bbox. Tipi 2 uses the same 2.2 m because it reuses tipi 1's visual asset.",
      "ANU_EVENTS.PLAYER_NPC_GREETING is the canonical proximity event. Subscribers should expect { phase, playerId, npcId, distance, tipi:{x,z} }. With two NPCs wired, `npcId` is now meaningfully distinguishing ('npc_yb_tipi1' vs 'npc_bhg_tipi2') and subscribers MUST branch on it if they need per-tipi handling.",
      "TIPI 3+ ROADMAP: a third tipi owner is the duplication-tipping point — the three loaders (loadCenterTipi, loadTipi2WithBhg, hypothetical loadTipi3WithREG) and three aim functions share so much code that a config-driven `loadTipi({hexPos, npcUrl, npcConstants, npcKey, npcSlug, entranceLocalXZ})` is the right refactor before adding tipi 3. Until then, the duplication is bounded and intentional (zero risk to tipi 1).",
      "Tree-clear-zone (`V2_FLORA_TIPI_CLEAR_ZONE_RADIUS_M`) only excludes a circle around the ORIGIN (tipi 1). Trees won't currently respect tipi 2's footprint. In practice the legacy tree rings (r=31-45 m) sit well outside tipi 2's 4.7 m platform so they don't overlap visually, but if a future spawn rule places trees inside the 12.5 m clearzone radius around tipi 2's centre they would clip. Fix when it becomes a visible problem.",
    ],
    files: [
      "js/v2/NPCBehaviour.js",
      "js/v2/WorldStructures.js",
      "js/v2/World.js",
      "js/v2/WorldPhysics.js",
      "js/v2/constants.js",
      "js/v2/anu/anuEvents.js",
      "Assets/NPC.YB.glb",
      "Assets/NPC.BHG.glb",
    ],
  },
  {
    id: "assets-draco-diet-pass-1",
    learnedAt: "2026-05",
    title: "Draco diet (pass 1) — 5 active GLBs compressed, ~166 MB saved, all GLTFLoaders must use GLTFLoaderWithDraco",
    summary:
      "May-2026 mesh-compression pass took the five GLBs actually loaded by js/v2/** (NPC.BHG, animated.stag, Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb, Avatar3, tree) and ran them through `scripts/draco-compress.mjs` — a tiny wrapper that drives KHR_draco_mesh_compression directly via @gltf-transform/core + /extensions (we bypass @gltf-transform/functions because its bundle eagerly imports `ndarray-pixels` → `sharp`, which won't load on this workspace's Node 20.0.0). Result: BHG 100.6 → 30.1 MB (-70 %), stag 46.7 → 3.5 MB (-93 %), tipi 42.8 → 4.2 MB (-90 %), Avatar3 22.4 → 8.7 MB (-61 %), tree 7.4 → 6.7 MB (-9 %, mostly texture). Originals are preserved in `BACKUP/draco-originals/` so the swap is fully reversible. Boot end-to-end (orchestrator ready → tipi 2 + BHG present) dropped to ~7 s. CONSEQUENCE: every GLTFLoader in the project that opens one of these files MUST be Draco-aware — Flora.js was migrated from `new GLTFLoader()` to `new GLTFLoaderWithDraco()` as part of this pass. Fauna.js still uses a plain loader because rabbit.animated.glb (294 KB) was NOT compressed (too small to be worth the round trip).",
    mitigations: [
      "Quantization knobs in `scripts/draco-compress.mjs` are conservative on purpose for skinned meshes: POSITION=14, NORMAL=10, TEXCOORD=12, GENERIC=12 (covers JOINTS / WEIGHTS). DO NOT drop GENERIC below 12 on skinned models — joint weights start to drift visibly off the skeleton. POSITION below 12 starts to show as faceting on smooth surfaces (BHG face especially).",
      "If you add a new GLB to `js/v2/**`, decide compression policy up front. (a) > ~2 MB: compress with `node scripts/draco-compress.mjs in.glb out.glb` and load via GLTFLoaderWithDraco. (b) ≤ ~2 MB: leave uncompressed (Draco's per-asset decoder bootstrap can be a wash for small meshes). Either way, the loader call must be GLTFLoaderWithDraco unless you have a documented reason not to.",
      "Residual file size on BHG (30 MB) and Avatar3 (8.7 MB) is now TEXTURES. Draco only compresses mesh attributes (POSITION / NORMAL / TEXCOORD / COLOR / JOINTS / WEIGHTS). Further reduction needs KTX2/Basis (via @gltf-transform/functions `textureCompress` — which requires upgrading Node ≥ 20.3 to satisfy sharp / ndarray-pixels) or a smaller source bake. Do not promise more compression gains in this card until that gate is unblocked.",
      "BACKUP/draco-originals/ is the rollback chute. If a Draco re-bake breaks visually (joint drift, normal seams, UV jitter), `cp BACKUP/draco-originals/<file>.glb <orig path>` reverts in seconds. Do not delete the backup folder until at least one full QA pass has shipped without complaint.",
      "Inactive heavy GLBs (Avatar2, animated.avatar, tipi.player, animated.bringshappiness, TraderJosh3d, Buffalo, NPC.REG, animated.deer/source/, NPC.YB is already Draco) were SKIPPED on purpose — the user is sourcing smaller replacements for some of them. Compress them only when they get wired into js/v2/**; compressing files about to be replaced is wasted bytes-on-disk.",
      "The CLI variant `npx gltf-transform draco` does NOT work on this workspace because its bin shim loads `sharp` at startup and Node 20.0.0 < required 20.3. The local `scripts/draco-compress.mjs` is the supported entry point. If you upgrade Node, you can switch back to the CLI; until then, use the script.",
    ],
    files: [
      "scripts/draco-compress.mjs",
      "js/v2/Flora.js",
      "js/v2/gltfLoaderSetup.js",
      "Assets/NPC.BHG.glb",
      "Assets/Avatar3.glb",
      "Assets/animated.stag.glb",
      "Assets/tree.glb",
      "Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb",
      "BACKUP/draco-originals/",
      "package.json",
    ],
  },
  {
    id: "tipi-2-bhg-stripe-overlay",
    learnedAt: "2026-05",
    title: "Tipi 2 visual identity — onBeforeCompile stripe + butterfly-suppression shader",
    summary:
      "Tipi 2 reuses tipi 1's yellow-butterfly GLB. To give BHG a distinct visual identity without authoring a new asset, every tipi-2 material is **cloned** on load and patched via `onBeforeCompile`. A vertex varying carries the world-space Y of each fragment (computed as `(modelMatrix * vec4(transformed, 1.0)).y` right after `<begin_vertex>`) and the fragment shader paints two 6-inch horizontal bands (red below the middle, blue above) separated by a 6-inch empty gap centred on `uBhgMidY`, while outside the band the baked yellow butterfly motifs are dimmed by mixing the baseColor 55% toward a flat canvas tan. World-Y is used (NOT unscaled local-Y) because the source GLB has an intermediate node transform that shifts local position values away from the symmetric [-0.5, 0.5] range the bbox accessor suggests; world-Y is invariant to those surprises. `uBhgMidY` is seeded after the tipi is positioned by computing `Box3.setFromObject(tipi)` and taking the midpoint, and the JS-side uniform object is shared by reference with `shader.uniforms` so updates propagate without recompile.",
    mitigations: [
      "The clone-before-mutate pattern is what makes tipi 1 safe. Both tipis load the same GLB and although `loadAsync` returns separate gltf trees, sharing a material instance would couple their appearance. If a future tipi N also reuses TIPI_1_URL, copy the clone-first pattern.",
      "`onBeforeCompile` runs once when the material is first uploaded. The patch chains by saving the existing `onBeforeCompile` (`prior`) and calling it inside the new one — this preserves any chunks Three.js or another module may have already added.",
      "Varyings are prefixed `vBhg*` and uniforms `uBhg*` to avoid collisions with future per-material shader patches. If you add a stripe/badge shader for another NPC's tipi, use a different prefix.",
      "DO NOT use the GLTF POSITION accessor's `min/max` to compute band positions in local-Y space — the result will be off by an intermediate node transform that doesn't show up in the accessor alone. World-Y via `modelMatrix * vec4(transformed, 1.0)` is the right primitive.",
      "Stripe colours are constants in the shader, not uniforms — fast but means you have to recompile to retune. If you want runtime sliders, switch the consts to uniforms exposed via shader.uniforms.",
      "Suppression mix is 0.55 — a sweet spot found by reading the existing baseColor lightness. If a future tipi asset has a brighter or darker baked texture, retune this constant or the canvas tan colour to keep the stripes the dominant feature.",
      "6\" stripes on a 7.2 m tipi render as ~7 px wide at typical viewing distance and ~30 px at close approach — readable but subtle. If you want them more dominant, bump BHG_STRIPE_H / BHG_GAP_HALF to 12\" or 18\" equivalents (0.3048 / 0.4572 m). Don't change the world-Y math, just the band constants.",
      "When tipi 2 needs its own GLB (BHG-specific texture), swap `TIPI_2_URL` in WorldStructures.js and DELETE the stripe/suppression call — the new texture should already have the desired look baked in. The shader patch is a transitional tool, not a permanent system.",
    ],
    files: [
      "js/v2/WorldStructures.js",
    ],
  },
  {
    id: "pond-with-waterfalls-landmark",
    learnedAt: "2026-05",
    title: "Pond asset rejected and REMOVED — RESOLVED by `pond-enclave-may-12` (replacement asset + procedural enclave)",
    summary:
      "**RESOLVED May-12 2026.** See entry `pond-enclave-may-12` for the resolution — `Assets/little_pond__fish` (stylized Sketchfab GLB with animations, 39 draw calls, 12 k tris) was loaded via `js/v2/WorldPondEnclave.js` and wrapped in a procedural rock ring + lily pads + footbridge. Original incident retained below for historical context. A prior turn authored js/v2/WorldPond.js to load a pond+waterfalls GLB authored in Z-up Blender (404 meshes / 4 materials / ~9 MB textures). Visual evaluation rejected the asset on four grounds: (1) ZERO animations — water doesn't ripple, waterfalls don't flow, reading as 'frozen' next to breathing fire smoke / hopping rabbits / walking NPC; (2) 404 draw calls ≈ ½ of the entire instanced forest — too expensive for a decoration that doesn't sell its own quality; (3) photoreal Blender style fighting the stylized hex shader / neumorphic UI vocabulary — material reads as 'cloud / fog patch' from above rather than 'water'; (4) waterfalls not visibly rendering from ground-level POVs (suspected backface culling post Z-up flip even with DoubleSide). Originally the WorldPondModule file was PARKED on disk for educational reference (Z-up → Y-up handling, DoubleSide flip post-rotation, terrain-snap pattern). The user subsequently REMOVED the `Assets/pond_with_waterfalls/` folder to source a better asset, and the parked loader was deleted in the same commit (along with its `check:v2` entry in package.json) to keep the strict asset gate green. The educational patterns are documented inline in this card so the procedural replacement has the blueprint.",
    mitigations: [
      "If a future contributor wants a pond, the right path is a NEW procedural module (e.g. js/v2/WorldPondStylized.js) that matches the warren's vocabulary: CircleGeometry water with a shader-animated UV scroll, a cylindrical basin depression, ~5-8 rock instances around the rim, and one or two waterfall ribbons with scrolling UVs. Target ≤ 15 draw calls vs the rejected asset's 404.",
      "Patterns to reuse from the deleted WorldPond.js (preserved here as the blueprint): for any Z-up Blender export, apply `rotateX(-π/2)` BEFORE other transforms so Z becomes world-Y; force `material.side = THREE.DoubleSide` on basin / ribbon meshes because the flip exposes back-faces; snap to terrain by reading `WorldPhysics.getGroundY(x, z) + 5 mm lift` to prevent shoreline z-fighting.",
      "If the asset is ever revisited, do NOT trust bbox-only inspection — render from ground-level POV first. The bbox said the rejected asset would look right; the visual probe said otherwise.",
      "If a NEW pond asset arrives (the user said 'I will get a better one'), evaluate it from ground POV BEFORE writing a loader module. Don't repeat the WorldPond.js rewrite-then-delete cycle.",
    ],
    files: [
      "js/v2/AnuModule.js",
      "package.json",
    ],
  },
  {
    id: "rabbit-warren-pond-waterfall-spirit-bloom-may-12",
    learnedAt: "2026-05",
    title:
      "Rabbit warren hub + 6-tile family spacing + pond waterfall sheet burial + YB spirit 3D bloom",
    summary:
      "May-12 2026 user pass: (1) Three rabbit families sit on vertices of an equilateral triangle with edge length `V2_RABBIT_FAMILY_TRIANGLE_SIDE_M = 6 * V2_TILE_WORLD` while **preserving** the original tipi-1 meadow anchor as one vertex — layout is canonical in `constants.js` `V2_RABBIT_FAMILY_LAYOUT` / hub `V2_RABBIT_WARREN_HUB_*`. (2) The triangle centroid gets a **shared** deep bowl carved into `WorldTerrain.terrainY` (so physics + hex mesh vertices agree), a vertex-colour dirt pass in `World.js` so grass tint does not read over the void, and a large additive WebGL chasm in `Fauna.js` (`fauna_warren_hub_chasm`). (3) Procedural pond waterfall **sheet** only (`pond_enclave_waterfall_fx`) is lowered an extra **6 ft** via `V2_POND1_WATERFALL_SHEET_BURY_FT` in `WorldPondEnclavePond1.js` — the GLB pool embed path is unchanged. (4) `WorldNatureSpirit` bloom at YB adds additive **icosahedron burst + vertical cylinder shaft** in hologram colour on top of the existing ring stack. (5) `Flora.js` passes warren + per-family exclusion disks into `buildLegacyEnvironmentBuilderTreeSlots`. (6) Fauna `SPIRIT_AVOID` re-issues dodge with `assignThreatDodgeTargets(..., distMul)` when player feet enter `TRAMPLE_RE_SCAMPER_M` so kits are not stood on during watch.",
    mitigations: [
      "If the hub chasm clips distant LOD or PiP reads it as a black spot unexpectedly, reduce `V2_RABBIT_WARREN_CHASM_DEPTH_M` / `V2_RABBIT_WARREN_CHASM_RADIUS_M` together — terrain carve and mesh must stay in sync.",
      "If the waterfall sheet disappears under terrain, reduce `V2_POND1_WATERFALL_SHEET_BURY_FT` slightly — only the procedural sheet is shifted; baked pond GLB embed uses `V2_POND1_EMBED_*` separately.",
      "Bloom burst is extra overdraw during NOD — if FPS dips on low-end GPUs, lower burst max scale in `_tickBloom` or skip the shaft mesh.",
      "Triangle placement uses fixed `V2_RABBIT_ORIGIN_ANCHOR_*` — if the village moves, recompute the three anchors and hub in constants in one commit so Flora exclusions stay aligned.",
    ],
    files: [
      "js/v2/constants.js",
      "js/v2/WorldTerrain.js",
      "js/v2/World.js",
      "js/v2/Fauna.js",
      "js/v2/Flora.js",
      "js/v2/WorldPondEnclavePond1.js",
      "js/v2/WorldNatureSpirit.js",
    ],
  },
  {
    id: "pond1-world-basin-kid-polish-may-12",
    learnedAt: "2026-05",
    title:
      "pond1.glb — elliptical terrain bowl + deeper multi-sample embed + Flora dell + kid-friendly water",
    summary:
      "May-12 2026 follow-up: user reported the **pool still reads above ground** and asked ANU to help integrate it into the map universe with a kid-polished read. **Terrain integration** — `WorldTerrain.terrainY` now subtracts `pondBasinCarveDelta` (elliptical bowl centred on `V2_POND_ENCLAVE_CENTER_*`, tunable via `V2_POND1_BASIN_CARVE_RADIUS_*_M` and `V2_POND1_BASIN_CARVE_DEPTH_M` in `constants.js`) so the hex heightfield + `WorldPhysics.getGroundY` share the same dell as the landmark (mirrors the rabbit-warren hub carve pattern). **Deeper tuck** — `V2_POND1_EMBED_BASE_SINK_M` raised to 0.62 m and `V2_POND1_EMBED_EXTRA_FT_M` to 3 ft (0.9144 m) so `pond1` mesh burial matches the new bowl. **Placement** — `WorldPondEnclavePond1.js` samples **10** ground heights on an ellipse under the scaled footprint and pins `embedY` to the **minimum**, preventing one high terrain sample from levitating the whole GLB. **Lip ring** — average of 8 samples on the water-radius ring replaces a single-centre `terrainY + 0.025` so the moss collar hugs the carved rim. **Flora** — exclusion disk `(10,14,r=14.5)` stops instanced trees from growing through the dell. **Kid polish** — warmer `POND_TINT`, brighter pool `WATER_BASE` with mild emissive on the procedural water plane, softer moss lip colour, friendlier trout albedo.",
    mitigations: [
      "**Bowl depth vs swim-plane** — if fish or procedural water read clipped after a future asset swap, lower `V2_POND1_BASIN_CARVE_DEPTH_M` slightly before reducing embed sinks (physics and mesh must stay coherent).",
      "**Ellipse radii must cover the scaled pond footprint** — if the rim still floats at one compass direction, widen `V2_POND1_BASIN_CARVE_RADIUS_X_M` / `_Z_M` together so the carve undercuts every edge of `pond1.glb`.",
      "**Flora exclusion radius 14.5 m** thins the decorative tree ring around the pond; if the dell feels too bare, reduce the radius (not below the rock ring footprint ~13 m).",
      "**Multi-sample embed uses pre-scale bbox × uniform scale** — if `V2_POND1_TARGET_FOOTPRINT_M` changes a lot, retune the `0.4` footprint fraction in `WorldPondEnclavePond1.js` so the sample ring stays under the outer rim.",
    ],
    files: [
      "js/v2/constants.js",
      "js/v2/WorldTerrain.js",
      "js/v2/WorldPondEnclavePond1.js",
      "js/v2/Flora.js",
      "js/v2/AnuModule.js",
    ],
  },
  {
    id: "the-pool-sanctuary-hidden-valley-may-12",
    learnedAt: "2026-05",
    title:
      "THE POOL sanctuary pass — deeper valley embed, fuller water universe, waterfall hillock, stream-channel fish travel",
    summary:
      "User rejected the toy/cartoon read and asked ANU to rebuild **THE POOL** as a professional sacred sanctuary. `WorldPondEnclavePond1.js` now applies a deeper landmark sink (`V2_POND1_SANCTUARY_EXTRA_SINK_M`), larger pool water radius (`V2_POND1_SANCTUARY_WATER_RADIUS_SCALE`), stronger waterfall sheet, a hillock backdrop, and hidden-valley ecology plus emissive neumorphic stream guide-lines. Stream beds were widened/deepened with gentle banks and flowing blue water ribbons. Continuation pass swapped major vegetation placeholders to **owned** environment models (`WORDPRESS/Assets/tree.glb`, `WORDPRESS/Assets/bush.glb`) via Draco-safe template loading/cloning, while retaining fallback procedural geometry if model load fails. A follow-up art-direction pass now assigns explicit sanctuary zones (`foreground_frame_trees`, `shrine_ring_bushes`, `background_ridge_trees`, `outer_rock_ring`, `waterfall_cluster`) so composition reads intentional from player approach; no dedicated rock asset existed in-repo, so boulders remain procedural for now. Screenshot-guided polish added a dedicated **waterfall source cap** mesh (`pond_enclave_waterfall_source_fx`) that reuses pond-style animated water and introduced a strict tree keep-out radius around the waterbody so no tree trunks spawn inside the pond footprint. `fish.obj` behavior keeps flee-from-player but now also periodically transitions through the stream channel (`mode: pool/stream`) so fish can enter and leave the pool as part of one connected water system.",
    mitigations: [
      "Sanctuary vegetation now prefers authored GLBs (`tree.glb` / `bush.glb`) but still keeps procedural fallback; if either asset path changes, update `TREE_MODEL_URL` / `BUSH_MODEL_URL` in one place.",
      "Rock/boulder meshes are still procedural because no dedicated rock/boulder asset file exists in current repo inventory.",
      "Tree keep-out around pond uses a conservative branch-safe radius (`waterRadius + 4.8`); if shoreline feels too empty, lower in small steps while checking branch overhang in player camera.",
      "Fish channel travel uses `streamT` progression on CatmullRom and remains O(n^2) only for local schooling separation; keep `V2_POND1_FISH_COUNT` conservative on low-end GPUs.",
      "If pool rim clips after future `pond1.glb` swaps, tune `V2_POND1_SANCTUARY_EXTRA_SINK_M` before changing waterfall bury constants.",
      "Supersized sentinel tree: `hideLikelyStumpMeshes` now returns the world-XZ centroid of the best stump candidate and a `tree.glb` clone scaled to ~22 m is seated there (`_stumpTree`, `pond_enclave_stump_sentinel_tree`). Scale is `22 / baseHeight` where baseHeight comes from `normalizeTemplateForGround`. If the sentinel reads too tall/short in future GLB swaps, adjust the `22` constant before touching other tree scales. Fallback to procedural pine if `tree.glb` fails.",
    ],
    files: ["js/v2/constants.js", "js/v2/WorldPondEnclavePond1.js", "js/v2/AnuModule.js"],
  },
  {
    id: "rabbits-bloom-and-stump-sentinel-may-13",
    learnedAt: "2026-05",
    title: "Rabbit bloom-avoidance + pond stump sentinel tree (guaranteed placement)",
    summary:
      "Two fixes landed together. **Rabbit / nature-spirit circle**: `WorldNatureSpirit.js` gained a public `getBloomThreatXZ()` method on `window.natureSpiritSystem` that returns the bloom circle's XZ centre + current outer-ring radius while the bloom is expanding/fading (mirrors `_tickBloom` math). `Fauna.js` replaced the single `getSpiritXZ()` shim with `getSpiritState()` returning `{ bodyXZ, bloomXZ, bloomRadius }`. `getThreatFleeOrigin()` and `threatsClearForRelease()` were extended with `bloomXZ`/`bloomRadius` params. When the bloom is active, any rabbit inside `bloomRadius + BLOOM_FLEE_BUFFER_M (1.8 m)` from the bloom centre enters `FAMILY_MODE_SPIRIT_AVOID` and hops away — rabbits MUST clear the expanding ring at YB's feet before they can return to wandering. **Pond sentinel tree**: `STUMP_NAME_RE` extended with `trunk|pillar_?wood|chopped|felled`. `hideLikelyStumpMeshes` gained a **tall-narrow trunk heuristic** (`h < 6.0, w < 2.8, h/w > 0.8`) as a third scoring tier alongside name-match and wide-squat, so taller bole sections baked into `pond1.glb` are now detected. A guaranteed hard-coded fallback anchor `(cx + wfX*0.55+1.2, groundY, cz + wfZ*0.55-0.8)` is used when detection yields null, so the sentinel `tree.glb` is **always planted** at the chopped trunk location.",
    mitigations: [
      "If the bloom fires at a position far from any rabbit family (e.g. YB is repositioned in a future update), adjust `BLOOM_FLEE_BUFFER_M` or check bloom XZ vs family anchors rather than per-rabbit.",
      "The tall-narrow heuristic (`h/w > 0.8`) could match non-trunk meshes (fence posts, torch poles). If false positives hide valid scenery, narrow the `w` range or add exclusion keywords.",
      "`getBloomThreatXZ()` mirrors `_tickBloom`'s lerp math. If the bloom curve changes in WorldNatureSpirit.js, keep the mirror in sync or expose the result directly from `_tickBloom`.",
      "Stump fallback position is NE of pond centre near waterfall. If `pond1.glb` is swapped for a model with a different stump location, update the fallback or re-tune `STUMP_NAME_RE`.",
    ],
    files: ["js/v2/WorldNatureSpirit.js", "js/v2/Fauna.js", "js/v2/WorldPondEnclavePond1.js", "js/v2/AnuModule.js"],
  },
  {
    id: "pond-procedural-water-vs-terrain-may-13",
    learnedAt: "2026-05",
    title:
      "Forensic — missing POOL disk / waterfall with only stream ribbons visible + FPS ~40 Hz (cause vs pond cost)",
    summary:
      "**Visual root cause:** The sanctuary **stream ribbons and neumorphic flow lines** are built with `physics.getGroundY(...)` along the spline, so they hug the carved hex dell no matter how `pond1.glb` is scaled. The **circle pool** (`pond_enclave_water_fx`) and **waterfall sheet** Y were derived chiefly from the **mesh world bounding box** (`min.y + frac * height` and offset fractions). Any replacement or re-export of `Assets/pond1.glb` with different vertical proportions (common after blender/Tripo passes) pushes those planes **below the terrain shell** — from the player's POV the pool reads as vanished and only the glowing stream guides remain readable. **`V2_POND1_WATERFALL_SHEET_BURY_FT` (6 ft)** further lowers the procedural sheet relative to bbox space; combined with bbox drift the entire fall can bury below grass. Fix: **`estimateSanctuaryWaterSurfaceY()`** clamps procedural pool Y between **floor** (`getGroundY` at centre) and **rim** (average of 8 radial samples near `waterRadius * 0.88`) still blended from the bbox heuristic; waterfall centre Y lifted with `Math.max(bboxCentre, wfGround + wfH*0.48)` before bury. **FPS root cause:** The pond module is tiny vs forest + Tripo décor (historic ANU: ~46 k tris sandbox — well under typical multi-million tri village load). Forty fps is overwhelmingly likely **dual WebGL contexts** (`#v2-canvas` + PiP `#pipCanvas`; journal overlay `#v2-journal-frame` adds a fourth GL **when opened** — see `journal-anu-bridge-phase1`), **trees-instancing**, and **Hud tier-B** churn — not ripple shaders. Ripple cost is capped: all pond/onBeforeCompile mats now share **`_pondWaterTimeUniform`** (one float write/frame instead of N). Verification: disable PiP temporarily (`V2_PIP_RENDER_EVERY_N_FRAMES = 0` in constants), close journal, rerun `scratch/probe-fps-diagnose.mjs` after local static server boots index.v2.html.",
    mitigations: [
      "After every `pond1.glb` swap, sanity-check `(10,14)` ground POV: pool disc must sit visibly between basin floor and rim — do not revert to bbox-only Y without revisiting clamps.",
      "If waterfall still disappears, temporarily set `V2_POND1_WATERFALL_SHEET_BURY_FT` to 2–4 ft — bury was authored for one mesh silhouette.",
      "For FPS regressions compare **before vs after activating PondEnclave** using orchestrator `_registry` bench `fpsCost` — historically single-digit deltas; if Δ ≫ 15 fps blame another subsystem (journal open, flora cap, stag skinned ticks).",
    ],
    files: ["js/v2/WorldPondEnclavePond1.js", "js/v2/constants.js", "js/v2/AnuModule.js"],
  },
  {
    id: "journal-anu-bridge-phase1",
    learnedAt: "2026-05",
    title: "Sacred Journal — ANU bridge Phase 1: pocket design + PROCESS_INPUT dispatch",
    summary:
      "Component.NewJournal.html redesigned to a **compact portrait pocket journal** (`max-width: min(92vw, 500px); aspect-ratio: 0.72`) — no longer landscape-full-viewport. A soft book-opening animation now fires automatically 1.6 s after the Three.js engine initialises (via `setTimeout(() => initiateOpenSequence(), 1600)` inside `run3DEngine`), so the journal opens itself on first reveal rather than requiring a second click. `INTERACTIVE_ENTITIES_MANIFEST` expanded to 18 entries covering all known scene domains (structures, fauna, population, Sacred Pool ecosystem — pond/fish/waterfall/stream/sacredtree). Default font size dropped from 14 pt → 12 pt to fit the narrower portrait columns. An `ANU_SENSORIUM_SYNC` message handler was added so the ANU bridge can push live entity counts without a full page reload.\n\nindex.v2.html now hosts a **first-class journal overlay** (`#v2-journal-overlay` + `#v2-journal-frame` + `#v2-journal-btn`): J key or button toggles a centred `520 × 740px` iframe, backdrop-blurred over the game canvas, no Panel intermediary needed. The existing `window.addEventListener('message')` handler was extended to intercept `PROCESS_INPUT` from the iframe and call `window._v2HandleAnuInput(source, value, ctx)`. That bridge: (1) verb+entity matches against the journal's pre-parsed context; (2) pond/water commands are short-circuited to a pool autowalk with a friendly kid-safe message; (3) matched entities dispatch `'anu-journal-verb'` on `AnuUniverse.interactions` so the bus carries the intent for future module subscribers; (4) autowalk is forwarded to `WorldModule.handleAutowalk` if available; (5) `NLP_RESPONSE` is posted back to `event.source` directly — no relay through Panel needed. `RETURN_TO_GAME` / `CLOSE_LOGBOOK` from the journal close the overlay.",
    mitigations: [
      "Journal iframe spawns its own WebGL context (Three.js for the 3D leather book). On GPU-constrained devices this doubles GL contexts. If frame budget degrades when journal is open, hide the 3D canvas inside the journal or replace it with a CSS-only cover, keeping the 2D page DOM intact.",
      "`'anu-journal-verb'` is a custom event string not yet in ANU_EVENTS. Phase 2 should promote it to ANU_EVENTS.JOURNAL_VERB and add it to anuEvents.js.",
      "`WorldModule.handleAutowalk` is not yet implemented on WorldModule — the fallback `window.postMessage({ type: 'REQ_AUTOWALK_TO_ENTITY' })` covers the SacredGame.Panel.html path. Implement `WorldModule.handleAutowalk` when the fauna/movement module is ready.",
      "Phase 2: subscribe to ANU_EVENTS.SCENE_INVENTORY_TICK → push `ANU_SENSORIUM_SYNC` to the journal on every tick so entity manifest stays live without user action.",
      "Phase 2: NPC dialogue (PLAYER_NPC_GREETING) should update parser-feedback in the journal via a targeted NLP_RESPONSE relay.",
      "Portrait aspect-ratio 0.72 means each page column is ~220px wide at max-width. If content overflows, reduce font-size index further via adjustJournalFontSize or allow per-page override in LOGBOOK_DATA.",
    ],
    files: ["Component.NewJournal.html", "index.v2.html", "js/v2/AnuModule.js"],
  },
  {
    id: "phase-8-docs-and-dx",
    learnedAt: "2026-05",
    title: "Phase 8 — repo entry points: README, CONTRIBUTING, AnuUniverse cheatsheet",
    summary:
      "78→100 program Phase 8 (Documentation & DX). Added top-level README.md (project quick-start + tree map + invariants), CONTRIBUTING.md (workflow rules summary, npm scripts, asset gate, ANU memory cards, doc map), and docs/anu-cheatsheet.md (markdown mirror of AnuUniverse.help()). Cross-linked Assets/README.md to docs/legacy-reconciliation.md so the WARN-tier asset entries point at the policy that accepts them. Promoted AnuUniverse.help() in index.v2.html: bolded in the visible #v2-hint, plus an obvious `Start here → AnuUniverse.help()` line in the boot console banner.",
    mitigations: [
      "AnuUniverse.help() is the live source of truth — when adding a new public method, register it in the help() index in the same commit so docs/anu-cheatsheet.md and CONTRIBUTING stay accurate by reference.",
      "When adding a new docs file, link it from CONTRIBUTING.md's documentation map and from README.md's tree map.",
      "If the v2-hint or boot console message is restyled, keep the AnuUniverse.help() pointer prominent — first-time DevTools open is the only chance to surface the discovery path.",
    ],
    files: [
      "README.md",
      "CONTRIBUTING.md",
      "docs/anu-cheatsheet.md",
      "Assets/README.md",
      "index.v2.html",
    ],
  },
  {
    id: "empathy-engine-product-name",
    learnedAt: "2026-05",
    title: "Product identity — The Empathy Engine v1.0a",
    summary:
      "The governed Sacred Adventures v2 stack (AnuUniverse + SacredOrchestrator shell + js/v2 modules) is referred to as **The Empathy Engine v1.0a**. The string is the single source of truth in `ANU_EMPATHY_ENGINE_NAME`; `AnuUniverse.engineName` mirrors it for DevTools and tooling. Bump the suffix (e.g. v1.0b) only when the user or release process explicitly renames the product — do not drift the label from marketing copy.",
    mitigations: [
      "AnuModule.js — export ANU_EMPATHY_ENGINE_NAME; buildPublicApi exposes engineName.",
      "Boot console line in AnuModule.load() appends the label so first open sees it next to AnuUniverse.report().",
      "When publishing release notes or CONTRIBUTING invariants, cite ANU_EMPATHY_ENGINE_NAME instead of duplicating the string.",
    ],
    files: ["js/v2/AnuModule.js"],
  },
  {
    id: "spirit-yb-visit-fsm-may-12",
    learnedAt: "2026-05",
    title:
      "Nature-spirit / NPC.YB visit FSM split — SPIRIT_WAVE → SPIRIT_WATCH + PLAYER_GREETING_WAVE override",
    summary:
      "May-12 2026 user spec: the spirit must idle (slow timeScale) while in front of YB — no more nod-clip swap; YB must wave for a fixed 3 s (longer than the wave clip's native ~1.4 s), then idle while watching the spirit walk away, and only sit when the spirit is more than 1 tile from her. If the player crosses inside 1 tile of YB during the visit, the spirit aborts to WALK_TO_FOREST and YB plays a 1× wave facing the player, then slides into STANDING_IDLE so the existing player-FSM (depart wave → return → sit) picks up cleanly. The old single SPIRIT_GREETING state (wave clip duration only, no watch phase, no player override) was replaced by three states in `NPCBehaviour.js`: SPIRIT_WAVE (3 s, wave LoopRepeat then restored to LoopOnce), SPIRIT_WATCH (idle, faces stored spiritX/Z fed by `updateSpiritPos()` each frame), and PLAYER_GREETING_WAVE (1× wave facing player). `WorldNatureSpirit.js` runs a per-frame player-priority check across FACE_YB / NOD / POST_NOD_HOLD (radius `PLAYER_PRIORITY_RADIUS_M = V2_TILE_WORLD`); on trigger it fires `_notifyYbPlayerInterrupt()` once and jumps to WALK_TO_FOREST. The `nod` clip is intentionally never played now (kept loaded for asset-compat); the spirit's idle action gets `setEffectiveTimeScale(0.35)`. World.js wires four hooks: terrainY, getYbPosition, getPlayerPosition (new), playYbSpiritGreeting, notifyYbSpiritPos (new), notifyYbPlayerInterrupt (new).",
    mitigations: [
      "**3-second wave duration is a constant** — `SPIRIT_WAVE_DURATION_S = 3.0` in `NPCBehaviour.js`. The native wave clip is ~1.4 s; we force `LoopRepeat` during SPIRIT_WAVE and restore `LoopOnce` on exit so the depart farewell + player greeting paths still play once. If you ever change the wave clip itself, the 3-s window is independent — only adjust this constant if the user explicitly asks.",
      "**Wave loop hygiene** — every state that ends a SPIRIT_WAVE / SPIRIT_WATCH / PLAYER_GREETING_WAVE branch must reset `actions.wave.setLoop(LoopOnce, 1)` before transitioning if SPIRIT_WAVE was the immediately previous state. Two restoration sites today: SPIRIT_WAVE → SPIRIT_WATCH (timer end), and `notifyPlayerInterrupt()` (player override). FAREWELL_WAVE relies on LoopOnce — do not assume it.",
      "**Spirit position is fed unconditionally during WALK_TO_FOREST**. `_notifyYbSpiritPos` updates YB's stored spiritX/Z on every WALK_TO_FOREST frame; YB's `updateSpiritPos` is a plain setter (no state guards) so stale callers don't matter — only SPIRIT_WATCH reads the value. Don't gate the notify on YB's state from the spirit side; the FSMs stay independent.",
      "**Player-interrupt is one-shot per visit**. `_playerInterruptHandled` is reset on every WALK_TO_STANDOFF entry. The check covers FACE_YB / NOD / POST_NOD_HOLD only (not WALK_TO_FOREST — by then the spirit is already leaving, no need to re-trigger). If the player jitters in/out the spirit doesn't get whiplashed.",
      "**Idle timescale = 0.35** — `SPIRIT_IDLE_TIMESCALE` in `WorldNatureSpirit.js`. Reads as a calm, ethereal cadence. If the GLB ever swaps to a more energetic idle clip, retune this constant — not the visit timing.",
      "**Spirit never plays its `nod` action now.** The state is still named NOD because the YB-greeting trigger fires inside it (~25 % elapsed); only the visual changed. Don't reintroduce `actions.nod.play()` for the spirit unless the user explicitly asks for the bow back.",
    ],
    files: [
      "js/v2/NPCBehaviour.js",
      "js/v2/WorldNatureSpirit.js",
      "js/v2/World.js",
    ],
  },
  {
    id: "loading-modal-percent-tween-may-12",
    learnedAt: "2026-05",
    title: "Loading modal — unified per-row odometer (`_odo`) + no-backwards guard + host ordering",
    summary:
      "May-12 2026 user spec evolved across three iterations. **Iteration 1** (initial fix) introduced `tweenPercentLabel` — an ease-out cubic numeric tween so non-Processing rows no longer snapped text via `Math.round`. **Iteration 2** added `flipToHundred` — a transient slot-strip for the final 99→100 tick — and host-side ordering fixes so pInit no longer regressed 100→98. **Iteration 3** (this update — the one ANU MEMORY now describes) replaced the entire two-stage `tweenPercentLabel` + `flipToHundred` mechanism with a single unified persistent odometer (`_odo`) and added a hard no-backwards guard, in response to user feedback '*when modals finish they start back the progress bars over. stop that. where are the flip up animations like processing has for all the rest?*'. **Root cause of 'bars start back over':** the iframe sends `VIDEO_READY` asynchronously when its `<video>` finishes buffering; the host listener fires `v2LoadLog('Opening reel ready', 100, 8, 0, 0)` — which carries pAssets=8, pLogic=0, pInit=0. If VIDEO_READY lands AFTER 'Modules registered' (or any later progress message) — a frequent race — those lower values rewind the bars. The previous numeric tween + final-only flip mechanism happily ran the rewinds through the CSS `transition: transform 2.0s ease-out` and the user saw bars empty back to zero. **Root cause of 'where are the flip-up animations':** only Processing used the .gpu-slot-* odometer for its 25→99 main-thread-parse ramp; the other rows had a 220–900 ms numeric tween that read as a counter, not an odometer. **Fix shape:** (1) Replaced `_pctTweens` / `tweenPercentLabel` / `flipToHundred` with `_odo` (`video / assets / logic / init`, each `{ strip, current, flipped100 }`) and two functions, `ensureOdometer(key, labEl)` (lazy-builds a persistent 0→100 vertical strip per row, initialized at `translateY(-current * 1.2em)` so a strip created after a `current` seed doesn't flash 0%) and `animateOdometer(key, labEl, target)` (animates the strip's `translateY` to `-target * 1.2em` over `clamp(280, 240 + delta·5, 720) ms` using the same `cubic-bezier(0.1,0.7,0.1,1)` curve as the GPU slot). (2) `applyRowUpdate` gained a HARD no-backwards guard: `if (state && t < state.current) return;` — single line; this is what stops the late VIDEO_READY message from rewinding the bars. (3) `flipped100 = true` is set as soon as the odometer lands on 100; further updates are no-ops for both bar AND label. (4) Processing's GPU-slot path is unchanged; the exit-from-slot still seeds `_odo.logic.current = 99` before the final 99→100 flip so the freshly-built strip starts at row 99, not row 0. (5) `LOADING_COMPLETE` defensive force-to-100 loop and the 720 ms pre-fade pause remain.",
    mitigations: [
      "**Per-row state lives in `_odo`** (`video / assets / logic / init`), each `{ strip: HTMLElement | null, current: number, flipped100: boolean }`. If a future row is added, register it in this object AND add it to the LOADING_COMPLETE safety-net loop — otherwise the odometer silently no-ops.",
      "**`flipped100` freezes the row after 100.** Once the odometer lands on 100, applyRowUpdate ignores BOTH bar and label updates for that row. The host repeatedly asserts `pVideo=100` etc. on every later message; without this flag a fresh strip would be built each time or the bar would re-trigger a CSS transition.",
      "**HARD NO-BACKWARDS GUARD in applyRowUpdate is load-bearing.** `if (state && t < state.current) return;` — that single line is what stops the user-visible 'bars restart over' regression. Root cause is the late-arriving `VIDEO_READY → v2LoadLog('Opening reel ready', 100, 8, 0, 0)` message which carries lower pAssets/pLogic/pInit values than messages that already landed. Removing this guard re-introduces the regression. If a future spec ever needs LEGITIMATE reverse motion (none today), add an explicit `reset()` API rather than weakening this guard.",
      "**Every row uses the SAME `.gpu-slot-*`-style visual language** — a persistent vertical strip of '0%'…'100%' rows scrolled via CSS `translateY` transition. User's explicit ask: 'flip up animations like processing has for all the rest'. Do not regress to a numeric `Math.round + textContent` counter for any row — the perception is that text is 'jumping'.",
      "**Strip is built lazily on first non-zero update**, initialized at `translateY(-current * 1.2em)`. This matters for Processing: after the GPU slot exits and we seed `_odo.logic.current = 99`, `ensureOdometer` runs for the first time and must NOT flash '0%' before flipping to 100. The lazy-init transform handles this.",
      "**`v2LoadLog('Enter world', 100,100,100,100)` MUST remain the LAST loading message** in `index.v2.html`. Even with the no-backwards guard the host should not assert backward values — the guard prevents visual regression but the message sequence should still be monotonic per row. If you add a new module activation, position it BEFORE 'Enter world' in the activation sequence.",
      "**720 ms wait before `v2LoadingComplete()` is non-negotiable.** `animateOdometer` upper bound is 720 ms; trimming the wait causes the longest flip (e.g. video 0→100 if it ever happens that wide) to race the fade. The render loop is already running behind the fading modal — the wait is invisible.",
      "**Bar progress (`transform: scaleX(...)`) is updated in lockstep with the odometer** inside applyRowUpdate, but stays an independent CSS animation (no RAF). The bar's CSS `transition: transform 2.0s ease-out` (or the overridden 30 s slot ramp for logic) is GPU-cheap; don't bundle bar updates into the odometer's RAF.",
      "**Processing GPU-slot remains the priority path** for the 25→99 main-thread-parse ramp when `window._gpuSlideStarted` is true. The odometer only takes over for the final 99→100 tick on Processing once `actualLogic === 100 || !window._gpuSlideStarted`.",
      "**Don't shorten `animateOdometer` max duration below ~600 ms.** A 0→100 case (rare but possible for video if VIDEO_READY arrives before any incremental pVideo) needs visible scroll time — anything shorter reads as a snap rather than a flip.",
    ],
    files: ["Component.LoadingModal.html", "index.v2.html"],
  },
  {
    id: "asset-decimate-tipi-bhg-may-12",
    learnedAt: "2026-05",
    title:
      "Asset-tier perf lever — Tripo3D GLB decimation @ ratio 0.5 (tipi.yellowbutterfly + NPC.BHG) saves ~2.9 M tris/frame",
    summary:
      "May-12 2026: user reported 'FPS is back to horrible' after the Empathy Engine v1.0a release (commit 47fd643 — added BHG + tipi 2 + rabbit family + nature spirit). `scratch/probe-fps-diagnose.mjs` pinpointed scene-triangles as the bottleneck (10.9 M total tris, 8.9 M visible). Tripo3D source GLBs ship at ~2 M tris/mesh; the renderer.info.render.triangles reported 6.22 M drawn per frame (main + PiP pass combined). Ran `scripts/simplify-and-draco.mjs` with meshoptimizer simplification at ratio 0.5 on two high-cost assets: (1) `Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb` (1,967,053 → 983,526 tris — both tipi instances now share this so net per-frame drawn drops by 2× the saving), and (2) `Assets/NPC.BHG.glb` (1,908,538 → 954,260 tris). Headless probe before: 49.7 FPS; after tipi: 60.0 FPS (capped); per-frame drawn after BHG: 5.27 M (was 6.22 M). Originals preserved in `BACKUP/pre-simplify/{tipi.yellowbutterfly,NPC.BHG}.preSimplify.glb`. CRUCIAL: the user's hypothesis that the rabbit mods / nature-spirit feature caused the FPS drop was disproven by the diagnostic — rabbits cost ~15 k tris total (3 rabbits × 5 k each); nature spirit's 748 k tris are correctly hidden by `root.visible = false` during WAIT_TO_APPEAR / COOLDOWN and DO NOT appear in `renderer.info.render.triangles`. The actual cost came from the same commit's BHG (1.9 M) and tipi 2 (1.97 M) additions, not from the behavior code.",
    mitigations: [
      "**Diagnose with `renderer.info.render.triangles`, not `scene.traverse` totals.** Three.js culls invisible subtrees in the render pass — counting tris by traversing the scene over-reports by every hidden mesh (the spirit alone is 748 k tris hidden during cooldown). `scratch/probe-fps-diagnose.mjs` now exposes both `totalTriangles` (scene graph) and `visibleTriangles` + `rendererInfoRender.triangles` (actually drawn).",
      "**Ratio 0.5 is the user-vetted default for Tripo3D high-poly assets.** meshoptimizer error budget at this ratio stays under 0.001 for the BHG meshes and `tipi.yellowbutterfly` (no visible holes / silhouette breaks). Going lower (0.3) starts breaking facets on hands / silhouettes — bring back the preSimplify backup and pick a higher ratio if a user spots damage.",
      "**Always back up to `BACKUP/pre-simplify/<name>.preSimplify.glb` before running in-place.** `scripts/simplify-and-draco.mjs` overwrites the source. Originals are the recovery path if a user decides a decimation went too far.",
      "**The script overwrites in-place by design** so the runtime path (`Assets/...`) doesn't need a code change. Both tipi instances in `WorldStructures.js` already load the same URL, so a single decimation pass saves 2× draws/frame for free.",
      "**Don't blame the latest behavior change for an FPS regression — measure first.** This incident's root cause was buried under three other landed features in commit 47fd643. The probe attributed cost correctly by top-group + by-domain breakdown. Repeat this pattern: instrument `renderer.info.render.triangles` AND `top10Meshes` with `visible: bool`, then point the user at the actual offender even if their hypothesis is elsewhere.",
      "**Levers still available, not pulled (user-gated):** Avatar3 (1.96 M tris — hero character, decimation visible on close inspection), nature-spirit defer-load (skip adding the 748 k-tri model to the scene during boot — saves VRAM not draw cost since culling already works), Flora tree LOD (1.34 M tris in part_0 + 792 k in leaf, instanced — would need per-distance LOD swap). All require explicit user approval.",
    ],
    files: [
      "scripts/simplify-and-draco.mjs",
      "scratch/probe-fps-diagnose.mjs",
      "Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.glb",
      "Assets/NPC.BHG.glb",
      "BACKUP/pre-simplify/tipi.yellowbutterfly.preSimplify.glb",
      "BACKUP/pre-simplify/NPC.BHG.preSimplify.glb",
    ],
  },
  {
    id: "pond-enclave-may-12",
    learnedAt: "2026-05",
    title:
      "Pond enclave landmark — `little_pond__fish` (de-mushroomed, embedded) + rock ring / lily pads / small trees / fish.obj trout",
    summary:
      "May-12 2026 — TWO iterations. **Iteration 1** dropped `Assets/[removed]/little_pond__fish/scene.gltf` (Sketchfab, Kenny Kwok, CC-BY-4.0, ~907 KB, 26.5 m × 8.8 m × 24.7 m — 39 meshes / 15 materials / 11,932 tris / 1 animation `Take 001` 7.08 s 56 tracks) at `(V2_POND_ENCLAVE_CENTER_X_M=10, terrainY+0.02, V2_POND_ENCLAVE_CENTER_Z_M=14)` with procedural rock ring + lily pads + wooden footbridge. Resolved all four rejection grounds of `pond-with-waterfalls-landmark` (animations ✓, 39 draw calls vs 404, stylized vocabulary, no Z-up flip). **Iteration 2** (this update) addressed seven user follow-up complaints in one pass: '*the pool is above ground, add small trees around it. remove the ladder ramp, change the color of the leaves to match the color of the tree leaves/branches. remove the mushrooms. make it more realistic. can you make those shapes in the water use the fish.obj model?*'. Changes: (1) **Pool embedded** — earlier code centred X/Z but pinned `root.position.y = terrainY + 0.02` assuming the asset's local origin was at the water plane. It is not — the origin is at the bowl FLOOR, so the water floated ~1–2 m above terrain. New loader traverses the subtree, measures the water mesh (`pPlane1_water_0`) model-space Y, and sets `root.position.y = (terrainY - 0.05) - waterModelY` so the water surface sits 5 cm below terrain and the rim foliage forms a natural collar. (2) **Mushrooms removed** — `pSphere{4,5,6,7}_lambert6_0` set to `visible=false` via per-name regex. (3) **Leaves recoloured** — `pCube1_lambert6_0` (leafy rim) gets a CLONED material whose colour is forced to `0x32cd32` (lime green, the most leafy entry in `FOLIAGE_HEXES` consumed by Flora.js for tree foliage tints). Material is cloned before mutation because the mushrooms share the source material — without cloning, a future un-hide would surface green mushrooms. Lily pads also recoloured to the same green for visual cohesion. (4) **Footbridge removed** — `buildFootbridge` is gone, `V2_POND_ENCLAVE_BRIDGE_AZIMUTH_RAD` is no longer imported (left in `constants.js` as dead-storage with no consumer). The rock-ring and lily-pad bridge-skip arcs were dropped — the rocks now ring continuously. (5) **Realistic trout** — `Assets/Fish/fish.obj` (Wavefront, 21859_Rainbow_Trout_v1, ~1.1 MB, no mtl, no textures) loaded once via OBJLoader, cloned 3× into one shared `MeshStandardMaterial` (silvery-blue 0x8ea8b8 / metalness 0.25 / roughness 0.55), each orbits the pond centre at radii `V2_POND_ENCLAVE_WATER_RADIUS_M × (0.35 + 0.18·i)` with deterministic per-fish speed and direction-alternation. Pivot.rotation.y is set per frame so the OBJ's +X long axis aligns with the orbit tangent, plus a small Y-bob via `sin(2θ + bobPhase) × 0.04`. The asset's three stylized fish subtrees (`rig_01_n_pond_fish*`) and the abstract pulse decorations (`ani_01_n_pond_pulse*`, `pCube{6-9}_wave_0`, `pSphere{8,9,10}_wave_0`, `pCube{2-5}_Default_Material_0`) are all hidden via the same name-regex pass. The GLB mixer keeps running for surviving decor (water plane, leafy rim, grass) — hidden meshes still receive track updates but never render. (6) **Small trees** — 8 procedural cylinder-trunk + icosahedron-foliage trees ring just outside the rock collar (`V2_POND_ENCLAVE_RING_RADIUS_M + 1.8`), terrain-snapped, per-tree foliage tint drawn from a 5-entry `FOLIAGE_PALETTE` subset of Flora.js `FOLIAGE_HEXES` so the cluster reads as forest-edge that belongs to the same palette as the main forest.",
    mitigations: [
      "**Water-plane Y measurement is the correct positioning algorithm.** Earlier revisions tried `root.position.y = -box.min.y` (lifted by bowl depth, water at chest height) and `root.position.y = terrainY + 0.02` (water 1–2 m above terrain — user's 'pool is above ground' bug). The traverse-and-measure approach finds the mesh whose name matches `/water/i`, takes its model-space bbox midpoint, and offsets the root so that point lands at `terrainY - 0.05`. The -0.05 is non-negotiable — without it the water z-fights the surrounding terrain at the rim.",
      "**The leafy-rim recolor MUST clone the material before mutating colour.** `pCube1_lambert6_0` shares its source `lambert6` PBR material with the 4 mushroom spheres. If you set `mat.color.setHex(FOLIAGE_GREEN)` directly, a future un-hide of the mushrooms would surface green mushrooms. The current code calls `mat.clone()` and reassigns onto only the leafy rim mesh.",
      "**Hide-by-name regex list is the right granularity** — material-based hide isn't possible because `lambert6` is shared (mushrooms + leafy rim) and `Default_Material` is shared (splash cubes + ?). The 6-entry pattern list in `load()` covers: mushrooms (pSphere4-7), stylized fish (rig_01_n_pond_fish*), pulse parents (ani_01_n_pond_pulse*), wave cubes (pCube6-9_wave_0), wave spheres (pSphere8-10_wave_0), and splash cubes (pCube2-5_Default_Material_0). If a future asset revision adds new abstract decor, append to this list.",
      "**Deterministic RNG for every instanced layout** (`_xorshift(seed)`). Stable across boots so Anu sensorium exports don't drift; seeds today are rocks=0xb0b1ce, lilies=0xc4f4e7, trees=0x7ee5, fish=0xf1559. Do NOT replace with `Math.random()` — the resulting non-determinism breaks the asset-gate diff and looks 'twitchy' between dev sessions.",
      "**`V2_POND_ENCLAVE_BRIDGE_AZIMUTH_RAD` is dead-storage in `constants.js`.** No consumer remains after the footbridge was removed. It is left intentionally so a future 'put the bridge back' request is a single import + one `buildFootbridge()` call away — but do not add new consumers without restoring the builder.",
      "**Single GLB AnimationMixer covers all 56 tracks in `Take 001`.** Hidden meshes still receive track updates (they're not pruned from the clip). The mixer cost is dominated by track evaluations, not draw calls, so the cost is unchanged from iteration 1. Don't try to prune individual tracks from the clip — the GLB authored them as one consolidated rig.",
      "**Trout orientation depends on fish.obj's +X long axis.** Vertex range x ∈ [-4, +4] m. `buildFishInstances` does NOT pre-rotate the clone; the wrapping pivot's `rotation.y = atan2(cosθ·dθ, -sinθ·dθ)` aligns local +X with the orbit tangent (CCW orbit if dθ > 0, CW if dθ < 0). If a future asset's body axis differs, fix here, not in `update()`.",
      "**`FISH_SCALE = 0.06`** is sized so the rainbow trout reads as ~0.48 m — believable pond trout at typical camera distance. If you swap fish.obj for a different OBJ, recompute from its bbox: `target_length_m / obj_bbox_length`. The current trout is 8 m long in OBJ-space.",
      "**Module dependencies:** `WorldPhysics.getGroundY` must be registered (i.e. `World` module already activated) — boot order is `World → Trees → PanelsPIP → Fauna → PondEnclave → V2Panel`. If you reorder, the load() guard prints a warning and skips spawn (same defensive pattern as Fauna).",
      "**License retention:** Pond asset is CC-BY-4.0 (`Assets/[removed]/little_pond__fish/license.txt`). fish.obj is from a public model archive — verify the upstream licence on the next asset audit. Both files MUST stay in the repo.",
      "**Anu pipeline budget:** PondEnclave adds ~11.9 k tris (diorama; mushrooms + abstract fish + pulses are hidden but not pruned — they still consume scene-graph traversal but no rasterisation) + ~32 k tris (3 × ~10.6 k fish.obj — shared geometry, single upload) + ~2.5 k tris (rocks + lilies + small trees) → ~46 k tris and ~10 new draw calls (1 rock InstancedMesh + 1 lily InstancedMesh + 1 trees group of 16 meshes + 1 fish group of 3 trout + the GLB's surviving 25 visible meshes). vs the 5.27 M tris drawn per frame post tipi + BHG decimations: 0.87 % of frame load. Still negligible — if a future FPS audit flags it, gate the GLB mixer + trout orbits by camera distance (`WorldNatureSpirit.update`'s WAIT/COOLDOWN pattern).",
    ],
    files: [
      "js/v2/WorldPondEnclave.js",
      "js/v2/constants.js",
      "index.v2.html",
      "Assets/[removed]/little_pond__fish/scene.gltf",
      "Assets/[removed]/little_pond__fish/scene.bin",
      "Assets/[removed]/little_pond__fish/license.txt",
      "Assets/Fish/fish.obj",
      "scratch/probe-pond-fish-study.mjs",
    ],
  },
  {
    id: "avatar-walk-in-place-may-12",
    learnedAt: "2026-05",
    title:
      "Player avatar walk/look: strip root-motion `.position` tracks at bind time",
    summary:
      "May-12 2026: user report 'walking animation has the AVATAR moving forward back and forth, can you nail it to animate in place?'. Root cause — `Avatar3.glb`'s walk clip (NlaTrack.003 / clips[3]) ships root-motion translation baked onto the hips bone. `WorldPlayerController` already drives world position from input velocity each frame, so the clip's `.position` tracks STACK on top of the engine's translation: the avatar drifts forward over the cycle and snaps back at the loop boundary, reading as a 'forward-and-back' lurch on top of locomotion. Fix lives in `js/v2/WorldAvatar.js`: a module-private `_stripPositionTracks(clip)` clones the clip (preserves the original `gltf.animations[i]` reference for Anu inventory + future re-binding) and returns a copy whose `tracks` array is filtered to exclude every track whose `.name` ends in `.position`. In `setupAnimations`, walk + look clip names are resolved UP FRONT (same fallback chain `semanticClips` uses below) and deduped through a `Set`; locomotion clip names get their `.position` tracks stripped before `mixer.clipAction(...)` binds the action. Idle / wave / goodbye keep their tracks intact (no reported regression on those; they may have intentional micro-translation for breath/weight-shift). After the fix, joints animate exactly as authored but the hips bone holds its bind-pose position throughout the cycle — engine owns translation, clip owns pose.",
    mitigations: [
      "**Strip `.position` tracks ONLY on locomotion clips (walk + look).** Idle/wave/goodbye keep their tracks because they may use intentional small translations (breath, weight-shift, foot-tap). Don't expand the strip set without a specific bug report.",
      "**Clone the clip — never mutate gltf.animations[i] in place.** `clip.clone()` produces fresh KeyframeTrack instances; reassigning `out.tracks = keep` only affects the new clip. Mutating the source clip would propagate to Anu's scene-inventory snapshot (which captures `gltf.animations[i]` references at load time) and any future re-bind path.",
      "**Resolve walk/look clip names with the SAME fallback chain as `semanticClips`** so the strip set lines up with what `play('walk')` and `play('look')` will actually request. Walk: `clips[3]?.name ?? clips[1]?.name`. Look: `clips[3]?.name ?? clips[2]?.name ?? clips[7]?.name ?? clips[0]?.name`. Refactoring one chain without the other will silently un-strip walk or look.",
      "**De-dupe via Set.** Walk and look on Avatar3 share a clip (NlaTrack.003) by design. If we strip twice on the same clip we'd waste a clone; using `new Set([walkClipName, lookClipName].filter(Boolean))` keeps it to one.",
      "**`anuAnimationScan.findings[1]` and `[2]` document the strip.** If you change the strip behaviour, update those two findings strings — they appear in `root.userData.anuAnimationScan` which Anu's `SceneModelInventory.js` surfaces to the dashboard.",
      "**Walk-cycle timeScale (`syncWalkAnimToHorizontalSpeed`) is unaffected.** That function rescales the clip's playback rate; with `.position` tracks stripped, the rate only affects joint-pose advance, exactly as we want for cadence-matching to horizontal speed.",
      "**If a future avatar GLB has intentional bone position tracks on non-root bones in the walk clip** (e.g. a stylized character with bouncing hair tip translation), the broad `.endsWith('.position')` filter will over-strip. In that case, walk the model's `SkinnedMesh.skeleton.bones`, identify the root bone(s) (parent is `null` or parent is a non-bone), and filter tracks targeting ONLY those root names. The current avatar has root-motion only on the hips so the broad filter is safe.",
    ],
    files: [
      "js/v2/WorldAvatar.js",
      "Assets/Avatar3.glb",
    ],
  },
  {
    id: "rabbit-burrow-state-machine-may-12",
    learnedAt: "2026-05",
    title:
      "Rabbit family: 3D dark burrow + 5-ft hide-trigger / +1-tile release with staggered emergence",
    summary:
      "May-12 2026 user spec: 'the rabbit hole needs a 3d dark hole about a foot down. if player gets to close 5feet to rabbits they will all jump in. mother will poke her head up and watch player until +1 tiles away. and then rabbit pops up, followed by bunnies.' All implemented in `js/v2/Fauna.js`. **Burrow tune** — depth narrowed from 0.88 m to **0.30 m** (≈ 1 ft / 12 in per user), throat radius widened from 0.0762 m (6″ diameter) to **0.14 m** (≈ 11″ diameter, wide enough for mom's body to fit during HIDDEN and visually readable as a real hole from a 3rd-person camera). The throat-wall vertex gradient now runs from **near-black `0x140b06`** at the lip to **pure black `0x000000`** at the floor (was dirt-brown→near-black; the brown blended with the rim mound from overhead). A new **`fauna_burrow_lip_dark_cap`** disc (`MeshBasicMaterial(0x040201)`, FrontSide, +Y-facing, radius `0.985 × throatRad`, 12 mm below the rim's inner ledge) renders just inside the lip — from straight-down the eye lands on this disc instead of the BackSide throat wall (which contributes ~zero pixels at that camera angle), killing the 'flat decal' bug from the user's reference screenshot. **State machine** lives entirely on `FaunaModule` with a single `_familyMode` (`NORMAL | HIDING | HIDDEN | SHOWING`) plus a per-rabbit `phase` (`ROAM | WALK_TO_HOLE | DESCENDING | HIDDEN | RISE_WAIT | RISING | RETURNING`) and a per-rabbit `slot` (mom=0, baby1=1, baby2=2). Triggers: `HIDE_TRIGGER_M = 5 ft = 1.524 m` (NORMAL→HIDING) and `RELEASE_TRIGGER_M = HIDE_TRIGGER_M + V2_TILE_WORLD` (HIDDEN→SHOWING), with the gap providing hysteresis so a player loitering at the boundary can't oscillate the family. The family centroid is mom's live position while NORMAL but the burrow XZ once they start hiding — keeps the release ring keyed to the actual burrow location, not wherever mom started running from. Per-phase helpers (`updateRabbitDive`, `updateRabbitDescend`, `updateRabbitHidden`, `updateRabbitRiseWait`, `updateRabbitRise`, `updateRabbitReturn`) own Y / yaw / animation cadence for the duration of that phase; only `PHASE_ROAM` falls back to the existing `updateMom` / `updateBaby` paths. Mom's HIDDEN-phase head bone is biased toward the player on top of the body yaw so the 'head pokes up and watches you' read is unambiguous. Emergence is staggered through `PHASE_RISE_WAIT`: mom (slot 0, delay 0 s) rises first, baby1 (slot 1, 0.35 s) follows, baby2 (slot 2, 0.70 s) last — matches the user's 'rabbit pops up, followed by bunnies' wording.",
    mitigations: [
      "**The lip-cap dark disc is load-bearing for the 'reads as a hole from above' brief.** Without it the burrow renders as the rim mound around a faintly-darker centre — the exact 'flat decal' bug from the May-12 reference screenshot. From overhead the throat's BackSide cylinder contributes only the smallest fragments (walls are near-parallel to view), so the eye lands on whatever pixel is at the throat opening — make sure that pixel is the lip-cap, not the throat's vertex-coloured wall.",
      "**Throat top must stay near-black.** The previous `0x3a2716` dirt-brown top blended with the rim mound from camera elevation. The new `0x140b06` is dark enough to read as 'no light reaches here' but not so neutral that the smoothstep gradient loses its depth cue from oblique angles. If you bump this back toward brown, the May-12 'flat decal' regression returns.",
      "**Slot field is assigned at load time and stable across hide cycles.** Mom=0, baby1=1, baby2=2. Emergence delay is `slot × EMERGE_STAGGER_S` so a future third baby (slot 3) would emerge after a 1.05 s delay automatically. Don't compute the delay from `index` of `_rabbits` — `_rabbits[0]` is mom by happenstance, not by contract.",
      "**Family centroid switches from mom-pos (NORMAL) to burrow-XZ (HIDING/HIDDEN/SHOWING).** This is the right pivot — once the family has started running to the hole, the release ring must be keyed to the burrow, not to wherever mom was when the hide triggered (otherwise the release ring drags around as mom runs). Don't unify these into a single `familyX/familyZ = mom.pos` shorthand.",
      "**Hysteresis (release > trigger) is non-negotiable.** With `RELEASE_TRIGGER_M = HIDE_TRIGGER_M + V2_TILE_WORLD` the player must move at least one tile beyond the hide ring to release. Without the +1 tile gap, the family flickers between HIDING and SHOWING when the player walks the boundary.",
      "**Babies fully below ground rely on the terrain mesh being opaque from above.** Their `position.y = groundY - bodyTotalH - 0.02` places them below the hex terrain, which then occludes them. If terrain rendering ever changes to render only the top surface (no depth write below `groundY`), babies will be visible swimming under the ground — re-add an explicit `group.visible = false` for babies in `updateRabbitHidden` at that point.",
      "**Mom's peek is body-below-ground, not invisible-body.** `position.y = groundY - MOM_HEIGHT_M + PEEK_HEAD_LIFT_M (4 cm)`. The terrain occludes her body below `groundY`; only the head pokes up through the throat opening. Don't try to scale her body to zero or hide individual bones — the rig isn't designed for that.",
      "**Existing PLAYER_FACE_RADIUS_M (1 tile) logic in `updateMom` / `updateBaby` is now superseded** in practice — the hide trigger fires at 5 ft (≈1.85 tiles), so the family can't be in PHASE_ROAM at <1 tile from the player. The 1-tile face-player code is intentionally left in place so it covers any future edge case where the rabbit is in ROAM and somehow within 1 tile (e.g. a teleport).",
      "**Fail-safes** in `updateRabbitDive` (`r.phaseT > 4.0`) and `updateRabbitReturn` (`r.phaseT > 3.5`) force phase advance if a bad terrain query or pathological speed pegging would otherwise strand a rabbit. If you see a rabbit 'glued to the burrow' or 'glued returning' in a real session, raise these timeouts rather than removing them.",
      "**`getFaunaSnapshot()` schema bumped to 2.2.** Now includes `familyMode`, `hideTriggerM`, `releaseTriggerM`, `burrow.throatRadiusM`, `burrow.depthM`, and per-rabbit `phase` + `slot`. Anu sensorium consumers reading older fields keep working; anything binding to the new fields requires `schemaVersion >= 2.2`.",
    ],
    files: [
      "js/v2/Fauna.js",
      "Assets/rabbit.animated.glb",
    ],
  },
  {
    id: "rabbit-spirit-avoid-may-12",
    learnedAt: "2026-05",
    title:
      "Rabbit family: SPIRIT_AVOID sub-mode — dodge → watch → return when the nature-spirit walks by",
    summary:
      "May-12 2026 follow-up to the burrow state machine. User spec: 'when nature spirit walks by them — the rabbits all jump out of its way and return to where they were, looking at the naturespirit model as it goes before returning to play.' Implemented as a NEW family mode (`FAMILY_MODE_SPIRIT_AVOID`) in `js/v2/Fauna.js`, branching off `NORMAL` (and only `NORMAL` — player hide always wins). Trigger is the MIN per-rabbit XZ distance to the spirit (read via `window.natureSpiritSystem.root.position`) falling below `SPIRIT_DODGE_TRIGGER_M = V2_TILE_WORLD × 1.15`, evaluated AFTER the 5-ft player-hide check so player presence always preempts spirit-avoid. New phases `PHASE_SPIRIT_DODGE` and `PHASE_SPIRIT_WATCH` flank the existing `PHASE_RETURNING`: on trigger, `assignSpiritDodgeTargets` snapshots a per-rabbit dodge XZ ≈ 0.70 m directly away from the spirit (with ±0.25 rad per-slot jitter so the three rabbits fan out instead of stacking); each rabbit dives to its dodge target at 3× normal speed (`updateRabbitSpiritDodge`); once arrived, switches to `PHASE_SPIRIT_WATCH` (`updateRabbitSpiritWatch`) which yaws toward the spirit's LIVE position so the family visibly tracks the stag walking past. When the MAX per-rabbit spirit distance exceeds `SPIRIT_FAR_M = SPIRIT_DODGE_TRIGGER_M + V2_TILE_WORLD` AND every rabbit is in WATCH, the mode transitions to `SHOWING` and every rabbit is queued to `PHASE_RETURNING` (which already walks them back to their roaming anchor and finally to `PHASE_ROAM`). The existing 'all rabbits in ROAM → NORMAL' gate then closes the cycle. `getFaunaSnapshot()` schema is bumped to **2.3** with `spiritDodgeTriggerM` + `spiritFarM` exposed.",
    mitigations: [
      "**Player hide always preempts spirit-avoid.** The first transition block in `update()` now matches BOTH `NORMAL` and `SPIRIT_AVOID`, snapping the family into `HIDING` regardless of whether they were roaming or dodging. Don't reorder the transition blocks — the spirit-avoid trigger MUST be evaluated after the player-hide check.",
      "**Dodge target is snapshot-once at the transition, not re-computed each frame.** If you make the dodge target tracking (recomputed against the spirit's live position), the rabbit chases a moving point and never arrives — the dodge becomes 'flee', not 'jump aside'. Keep `r.dodgeTx` / `r.dodgeTz` stable for the duration of `PHASE_SPIRIT_DODGE`.",
      "**Spirit watch yaws toward live spirit XZ, not the dodge entry-frame XZ.** This is the 'looking at the naturespirit model as it goes' part of the spec — the rabbit must visibly track the stag as it walks past, which requires sampling spirit position EVERY frame in `updateRabbitSpiritWatch`. Don't snapshot the spirit position once at entry to WATCH.",
      "**Release uses MAX (worst-case) spirit distance across the family.** If you switch to MIN, one outlier rabbit can release the whole family while another rabbit is still within trigger range — they'd start walking back through the spirit. MAX guarantees every rabbit is past the spirit before the family unwinds.",
      "**Per-slot dodge-angle jitter ≠ random.** Mom slot 0 = 0 rad (straight away), baby1 slot 1 = -0.25 rad, baby2 slot 2 = +0.25 rad. This is intentional — deterministic per-rabbit so a saved replay reproduces exactly. If you replace it with `Math.random()`, you lose replayability.",
      "**`getSpiritXZ()` returns null on early frames before WorldNatureSpirit loads.** All callsites guard for this and treat 'no spirit nearby' as the safe default (no trigger / no release). Don't add a fallback to camera position — that would falsely trigger spirit-avoid every time the camera is near the family.",
      "**`getFaunaSnapshot()` schema bumped to 2.3.** Adds `spiritDodgeTriggerM` and `spiritFarM`. Existing 2.2 consumers keep working.",
    ],
    files: [
      "js/v2/Fauna.js",
      "js/v2/WorldNatureSpirit.js",
    ],
  },
  {
    id: "seasons-atmosphere-may-12",
    learnedAt: "2026-05",
    title:
      "PiP season buttons → live sky/atmosphere swap with onfocus/hover, autumn-amber dusk, starry moonlit night",
    summary:
      "May-12 2026 user spec: 'activate our seasons buttons onfocus in the pip. each season will change the sky and the atmosphere to match the season. golden browns for autumn, bright blue skies and green grasses, night time where stars are all in the sky and the current moon phase is in direct sight a little below the top of the viewport over the horizon so player can always see the sky. Make everything have a moonlight glow with slight moonbeams and clouds up above that also glow a little from the moon.' Implemented across **three files**:\n\n• `js/v2/WorldCelestial.js` — was orphan dead code (`attachWorldCelestial` had no callers); now the main-view sky. The legacy bright-blue-only day shader is generalized into a season-aware shader with new uniforms (`uZenithColor`, `uHorizonColor`, `uCloudColor`, `uCloudShadow`, `uCloudIntensity`, `uNightAmount`). A `SEASON_SKY_PRESETS` table holds one preset per `data-season` key (`night | dawn | day | dusk | gray`). `applySeason()` swaps uniform values + toggles `nightRoot.visible` (stars + moon disc + beams only at night) + re-tints `scene.fog.color` so distant terrain blends into the chosen season. The module subscribes to `ANU_EVENTS.SEASON_CHANGE` so any source (UI click, focus, hover, panel msg) routes through one path. Moon direction lowered y=0.5 → 0.32 (~18° above horizon, 'a little below the top of the viewport'), and moonbeam plane count bumped 7→11 with larger plane geo (102×270 → 132×340) so the moonlit-cloud halo reads stronger.\n\n• `js/v2/World.js` — replaced `scene.background = new THREE.Color(0xfff1ca)` placeholder with `attachWorldCelestial(scene)` stored on `_celestial`. `update()` drives `this._celestial.update(camera, delta)` for cloud-fbm advance + moon-beam rotation. `unload()` disposes the celestial root + materials.\n\n• `js/v2/UIModule.js` — season buttons now bind `click | focus | pointerenter | keydown(Enter|Space)` to a shared `fire` callback, with `_lastSeasonApplied` deduping so tabbing through the dial doesn't thrash the shader. `tabindex=0` + `role=button` + `aria-label` added so the spans are keyboard-focusable and SR-readable.\n\nThe user's three named atmospheres map onto the existing 5 buttons cleanly: 🌙 night → starry / moonlit / glowing-cloud preset; ☀️ day → bright blue zenith + light-blue horizon + white clouds; 🔅 dusk → amber/orange (the 'golden browns for autumn' preset). 🌤 dawn (cool periwinkle + peach) and ☁️ gray (overcast desaturated) keep their semantic names.",
    mitigations: [
      "**The sky dome's `scene.background = null` is intentional.** The dome is a `BackSide` sphere with `depthTest:false` + `renderOrder=-8` so it paints the entire celestial hemisphere underneath everything else. Reverting to a flat `scene.background = 0x...` color hides the dome and disables the season swap.",
      "**Fog color is owned by `applySeason()`.** World.js still owns fog DENSITY (`FogExp2(_, 0.008)`); the celestial module only writes `scene.fog.color` from the preset's horizon RGB. Don't reintroduce a fixed cream fog color in World.js — it overrides the season tint and distant terrain looks wrong at night.",
      "**`nightRoot.visible` is gated by `nightAmount > 0.5`, not by `currentSeason === 'night'`.** This is the right abstraction — if you add a future season that's e.g. 0.6 night-amount (a moonlit twilight), stars + moon will appear too. Don't tighten this back to a string-equality check.",
      "**Moon position lowered to y=0.32 in the world-direction vector — DO NOT raise it back to 0.5** without re-validating the 'always visible below top of viewport' user spec. The current direction sits at ~18° elevation which keeps the disc framed even when the player looks toward the horizon.",
      "**Moonbeam plane count is at 11; do not double it.** Beams are additive blending — 11 already saturates the immediate halo around the disc; going to 15+ stops adding signal and just adds vertex work. If beam halo should be stronger, raise per-plane opacity instead (in `makeRayTexture`'s gradient stops).",
      "**Season buttons share a single `_lastSeasonApplied` dedupe across click/focus/pointerenter/keydown.** Removing it makes tabbing through the dial re-fire SEASON_CHANGE 5× as the focus walks across all buttons, thrashing the shader uniforms and (worse) the fog color.",
      "**`SEASON_SKY_PRESETS` keys MUST match `UIModule._setSeason`'s `times` keys.** A typo (e.g. `'duck'` instead of `'dusk'`) silently fails: `applySeason()` returns early and the user sees no atmosphere change.",
      "**Per-rabbit nature-spirit hide takes priority over spirit-avoid via the player-hide-first ordering** — see `rabbit-spirit-avoid-may-12`. Atmosphere changes are unrelated to fauna dispatch, but a future regression that ties lighting / shadows to season would need to be checked against the player-hide invariant too.",
    ],
    files: [
      "js/v2/WorldCelestial.js",
      "js/v2/World.js",
      "js/v2/UIModule.js",
      "Component.MoonDial.html",
    ],
  },
  {
    id: "orchestrator-hud-extract-and-worldplayer-load-race-may-13",
    learnedAt: "2026-05-13",
    title: "Orchestrator HUD extracted to its own file + WorldPlayer registers in load(), not update()",
    summary:
      "Two governance fixes landed together May-13 2026 after a re-score audit. (1) Orchestrator.js had grown 821 → 1267 LOC since baseline — the documented Phase-9 next-lever #1. HUD HTML + `_buildHUD` + `_updateHUD` + `_updateHUDValues` + `_drawFrameGraph` (~310 LOC, orthogonal to coordination) extracted to `js/v2/OrchestratorHud.js`. Orchestrator.js dropped to 983 LOC (−22 %). Method names preserved as thin delegators (`_buildHUD()`, `_updateHUD()`, `_updateHUDValues()`) so callers in `start/register/deactivate/_loop/_finalizeBench` are unchanged. The HUD module is pure: it reads only from the orchestrator's public surface (`renderer.info`, `_activeModules`, `_hud`, `_bench`, `_pipRenderedLastFrame`, `_anuAuditAlerts`), so re-skinning the HUD now only touches one file. `_bench.totalFrames` added to the bench struct so the HUD can compute the bench progress % without importing `BENCH_FRAMES` (avoids a circular import). (2) `registerRuntimeService(\"WorldPlayer\", …)` was called from World.update() every frame — meaning the service did not exist until after the first RAF tick. The smoke test snapshots services immediately after `activate('World')` resolves, and the May-12 async additions (Fauna, PondEnclave, V2Panel each loading GLB/OBJ) pushed back the first frame enough that the snapshot landed BEFORE update() ran. Fix: call `registerRuntimeService(\"WorldPlayer\", buildWorldPlayerState(…))` ONCE at end of World.load() (right after the body + avatar are ready), so the service is available the instant activate() resolves. The per-frame call in update() still runs and keeps the state object fresh.",
    impact:
      "Architecture (Dim 1): 82 → 90 by removing the documented size laggard's biggest single contributor. Tests (Dim 6) + Runtime safety (Dim 3): the timing race that hid behind faster-booting baseline modules no longer surfaces as a flaky service-missing failure when new async modules land later.",
    mitigations: [
      "js/v2/OrchestratorHud.js exposes `buildOrchestratorHud()`, `updateOrchestratorHudModules(orc)`, `updateOrchestratorHudValues(orc)`, `drawHudFrameGraph(canvasEl, samples, budgetMs)`. The HTML lives in the module-scope `ORCHESTRATOR_HUD_HTML` constant — reskin without touching coordination code.",
      "Coupling contract is documented in the file's leading JSDoc — what `orc` must expose. If a future refactor renames `_activeModules` or similar, the HUD will silently no-op rather than throw.",
      "WorldPlayer registration in load(): a *second* initial registration covers the timing race; the per-frame registration in update() is kept for liveness (handles `_walkDistance`, `_yaw`, `velocityXZMps`). If a future refactor moves the per-frame call, the service is still available — just frozen.",
    ],
    files: [
      "js/v2/Orchestrator.js",
      "js/v2/OrchestratorHud.js",
      "js/v2/World.js",
    ],
  },
  {
    id: "pipeline-memory-extracted-may-13",
    learnedAt: "2026-05-13",
    title: "ANU_PIPELINE_MEMORY extracted into its own file (pure data, no behaviour)",
    summary:
      "AnuModule.js had ballooned 516 → 1514 LOC since baseline because the incident ledger grew from ~22 cards to 56. The cards are pure data with no behaviour, but they were sharing a file with the live audit / governance binding logic — making AnuModule.js the largest single file in the engine and the cards harder to grep / diff. The full 974-line `ANU_PIPELINE_MEMORY` array was extracted to `js/v2/anu/pipelineMemory.js` (pure-data module: no imports, no side effects). AnuModule.js dropped to 546 LOC and re-exports the constant so existing import paths (`js/v2/UniverseModule.js`, downstream tooling, `AnuUniverse.memory`) keep working unchanged.",
    mitigations: [
      "Adding a card now means editing `js/v2/anu/pipelineMemory.js` directly — same shape, same `{ id, learnedAt, title, summary, impact?, mitigations[], files[], probeLedger? }` schema.",
      "AnuModule.js imports + re-exports: `import { ANU_PIPELINE_MEMORY } from \"./anu/pipelineMemory.js\"; export { ANU_PIPELINE_MEMORY };`. `AnuUniverse.memory` still resolves correctly.",
      "Asset gate false-positive (a literal placeholder path inside a backticked recipe string) was fixed at the same time by changing the example to `Assets/<NAME>.glb` (angle brackets don't match the asset-path regex, so the scanner skips placeholder paths).",
    ],
    files: [
      "js/v2/AnuModule.js",
      "js/v2/anu/pipelineMemory.js",
      "js/v2/UniverseModule.js",
    ],
  },
  {
    id: "building-circles-wood-timber-may-13",
    learnedAt: "2026-05-13",
    title: "NPC building circles: gold → real-log border + wildflower scatter (two-pass)",
    summary:
      "May-13 2026 user pass, two iterations. (1) First request — 'the gold borders of the building circles, instead of gold can we make it wood timber? natural wood, cute and woodsy.' Two surfaces carried the gold reading: the travel disc + ring decals around each NPC platform (`js/v2/anu/TravelFloorCircleMaterials.js`, `kind === 'npc'` branch — re-palette to aged-oak/walnut/blonde-pine; uMetal 0.62 → 0.10, uSpec 0.55 → 0.18; roughness 0.22 → 0.78), and the torus trim on each sacred-circle platform. (2) Follow-up — 'real logs around the border, photorealistic … add some nice wildflowers, rustic fun, less sterile and cold.' The platform trim torus was replaced with a Group containing an `InstancedMesh` of N cylinder logs laid end-to-end around the platform perimeter (one draw call regardless of log count) plus 12–14 procedural wildflowers. Logs use deterministic per-tipi LCG-seeded jitter (per-log y/pitch/roll/yaw + HSL color drift) so each tipi looks hand-stacked, identical on reload, but the two tipis aren't twins. Wildflowers are 5-petal cup + pollen core, ~50 tris each, kid-bright palette (coral, sunshine, daisy white, sky blue, lavender, marigold) alternating between platform-interior and between-the-logs positions. The `player` kind on the disc/ring factory is unchanged (forest-green avatar circle).",
    impact:
      "Visual fidelity (Dim 10): village reads as a warm hand-built homestead rather than a gilded shrine. Performance: logs are a single InstancedMesh per circle (one draw call); flowers are individual meshes (~14 per circle) but tiny (~50 tris each). Total added cost per circle ≈ 1 instanced draw + ~14 small draws + ~6k tris. Two circles = +12k tris, +30 draws — negligible against the ~10M total scene tris baseline.",
    mitigations: [
      "Scene-graph identifiers and `anuKind` strings still carry the historical `gold_trim` / `gold_disc` / `gold_ring` slugs — Anu scene-inventory + memory-card cross-refs depend on those. The rename is cosmetic-only.",
      "Tuning seams: `createSacredCircleGoldTrim` in `js/v2/WorldStructures.js` — `logRadius` (0.16 m), `ringRadius` (platRadius + 0.05), N-derivation (`circumference / 0.95` → ~31 logs at platRadius 4.7), per-log HSL drift, flower count (`Math.max(12, Math.round(N * 0.6))`). `createWildflower` next to it: stem height range, petal radius range, emissive intensities.",
      "Per-tipi seed: LCG seeded from `tipiKey.charCodeAt(0) * 977 + last * 31` — deterministic, so `tipi_1` and `tipi_2` look different but each is the same every reload. If you rename tipi keys, the visual layout changes.",
      "Visual verification: scratch/forensic-out/logs-tipi1-rim-close.png + logs-tipi2-rim-close.png show the chunky logs + flowers; logs-tipi1-iso.png + logs-tipi2-iso.png show the full ring in 3/4 perspective.",
    ],
    files: [
      "js/v2/anu/TravelFloorCircleMaterials.js",
      "js/v2/WorldStructures.js",
    ],
  },
  {
    id: "journal-overlay-zindex-and-layout-may-13",
    learnedAt: "2026-05-13",
    title: "Journal modal: z-index above HUD + flex-overflow scroll fix + cap welcome video",
    summary:
      "May-13 2026 user report: 'journal needs to be at top z-index when opened. Why are the pages brown still? please fix the page layout, its all busted, there should be no text at the bottom.' Three findings, three fixes. (1) Z-INDEX: `#v2-journal-overlay` was z-index 800 — below the HUD modal (`#v2-orchestrator-hud` z-index 9999) and the moondial. With the journal open, the HUD bled through on the right and the moondial on the left, making the page area read as 'brown' because of the dimming through the semi-transparent backdrop. Bumped overlay to 50000, dropped backdrop alpha 0.55 → 0.78, added `backdrop-filter: blur(3px)` so anything still showing through is clearly dimmed. (2) BROWN PAGES — diagnosed via a Playwright probe that pulled computed styles from inside the journal iframe: `rootPageBg: #fdfcfb`, pages-wrapper / page-static both report `rgb(253, 252, 251)` (white). The CSS was already correct. The 'brown' was the HUD/moondial bleed through the low-alpha backdrop. Fixed by (1) above. (3) LAYOUT: classic flex-child overflow bug — `.page-content` had `height: 100%; overflow-y: auto` but its parent `.page-static` was NOT a flex container, so the child grew to fit content rather than triggering overflow. Made `.page-static` `display: flex; flex-direction: column; min-height: 0`, made `.page-content` `flex: 1 1 auto; min-height: 0`. Welcome page video was `w-full aspect-video` (~190px tall — half the page) — capped to `max-w-[88%] max-h-[150px] object-cover`. Modal cap raised 600 → 760 height for more breathing room. Selectively re-enabled a thin scrollbar inside `.page-content` (was hidden globally by `::-webkit-scrollbar { display: none !important }`) so users see at a glance that there's more content below.",
    impact:
      "Visual fidelity (Dim 10) + DX. The journal now fully owns the screen when open — no HUD / moondial pixels leak into perception. Page content reaches the bottom without being clipped, and when content exceeds the viewport the user sees a thin walnut scrollbar so the scroll affordance is discoverable.",
    mitigations: [
      "Z-index stack reference: loading iframe 100000 (re-load progress), journal overlay 50000 (focused reading), HUD 9999, moondial / dock ~100–810, world canvas 1. New overlays must declare intent relative to this stack.",
      "If a future page renders unscrollable content, the seam is `.page-content { flex: 1 1 auto; min-height: 0 }`. The `min-height: 0` is load-bearing — without it flex-children won't trigger overflow.",
      "If new content blocks (image / video / pip-box) are tall enough to push the body paragraph below the visible fold, prefer adding `max-h-[140-160px]` and `max-w-[80-88%]` rather than `w-full aspect-video` (which can be 190+ px at modal width).",
      "Probe used: a small playwright script (since cleaned up) opened the modal, force-hid the loading iframe, then `getComputedStyle` on `.pages-wrapper`, `.page-static.left/right`, `.book-text`, `.book-tabs` from inside the iframe — the only way to confirm whether the journal was actually rendering brown vs. just appearing brown through layered transparency.",
    ],
    files: [
      "index.v2.html",
      "Component.NewJournal.html",
    ],
  },
  {
    id: "check-v2-globified-may-13",
    learnedAt: "2026-05-13",
    title: "check:v2 replaced hand-listed module chain with a glob walker (self-healing)",
    summary:
      "The pre-existing `npm run check:v2` was a hand-written chain of `node --input-type=module --check < js/v2/X.js && …` for each module. Since baseline, 9 new v2 modules (`WorldPondEnclavePond1.js`, `WorldNatureSpirit.js`, `WorldTipiJournalBalloon.js`, `V2IconRenderer.js`, `pipCompassMath.js`, `constants.js`, `gltfLoaderSetup.js`, `lunarPhase.js`, `readThroughFoliage.js`) had landed without being added to the chain — silent drift. Replaced with `node scripts/check-v2.mjs` which walks `js/v2/**/*.js` and runs the same per-file syntax check. Now self-healing: new files appear in coverage automatically the moment they're added.",
    mitigations: [
      "scripts/check-v2.mjs — single source of truth for the v2 syntax gate. Spawns `node --input-type=module --check` per file, reports per-file failures.",
      "If you add a new module under `js/v2/` (incl. `js/v2/anu/`), check:v2 picks it up on the next run — no script edit needed.",
      "Today's run reports 45 modules; the prior hand-listed gate covered 20.",
    ],
    files: [
      "scripts/check-v2.mjs",
      "package.json",
    ],
  },
  {
    id: "cinematic-idle-ui-chrome-may-14",
    learnedAt: "2026-05-14",
    title: "20s stand-still cinematic orbit hides dock + PiP shell, not the orchestrator HUD",
    summary:
      "WorldModule accumulates true rest-idle time (no journal, no smart-nav, no map view, low horizontal velocity, no walk/turn intent). After `V2_IDLE_CINEMATIC_ENTER_S` (20s) it enables a slow spherical orbit camera and toggles `document.body` class `v2-cinematic-ui-hidden` via `window._v2SetCinematicUiHidden(true)`. CSS in `index.v2.html` targets `#v2-panel-root`, `#v2-panels-pip` (moondial + PiP lens shell), journal overlay chrome, distance pill, intro banner, and `#v2-hint` only — `#v2-orchestrator-hud` and `#v2-loading-iframe` stay visible so FPS / LOAD telemetry and boot tests keep working.",
    mitigations: [
      "If a new fixed overlay must survive cinematic idle, give it a dedicated id and EXCLUDE it from the `body.v2-cinematic-ui-hidden …` selector list (do not blanket-`display:none` on `body > *`).",
      "Do not reparent `#pipCanvas` / swap PiP render policy for this feature — cinematic is HTML visibility + main-canvas camera only.",
    ],
    files: ["index.v2.html", "js/v2/World.js", "js/v2/constants.js", "js/v2/WorldBirdFlock.js"],
  },
  {
    id: "cinematic-idle-orbit-smooth-may-13",
    learnedAt: "2026-05-13",
    title: "Idle orbit: slow period + low-pass orbit params + no vertical micro-bob (cinematic read)",
    summary:
      'The 20s stand-still "cinematic" mode is **main-canvas camera motion only** (`js/v2/World.js`): half-plane azimuth sweep stays on the anatomical right of the avatar (legacy user spec). Polish pass: **orbit period ~17s** (was ~5s toy timing), **orbit amplitude ~0.09–0.19 rad** (was much wider), **radius drift band narrowed**, `CINEMATIC_PAN_PARAM_REFRESH_MS` retargets amplitude/ω/radius on **targets** that are **exp-smoothed** over `CINEMATIC_PARAM_LERP_TAU_S` so timer ticks do not visibly pop motion. **Removed `elevBob`** (high-frequency pitch wiggle) — it read cheap next to the lyrical azimuth. Camera follow uses **lower** `CINEMATIC_CAMERA_POSITION_LERP_EXP_BASE` than gameplay chase for heavier inertia. **Invariant:** do not touch PiP/`#pipCanvas` / `PipRenderStrategy` for cinematic idle — chrome hide is still `body.v2-cinematic-ui-hidden` CSS only (`cinematic-idle-ui-chrome-may-14`).',
    mitigations: [
      "World.js — `expToward()` for `_cinePanAmp` / `_cinePanOmega` / `_cineRadius` chasing `*Tgt`; timer mutates `*Tgt` only.",
      "Tune `CINEMATIC_PAN_ORBIT_PERIOD_S` and `CINEMATIC_PARAM_LERP_TAU_S` before adding new wiggle channels — extra sines usually fight the smooth read.",
    ],
    files: ["js/v2/World.js"],
  },
  {
    id: "pool2-fish-cycle-observe-may-13",
    learnedAt: "2026-05-13",
    title: "POOL2 trout + littoral minnows — lifecycle, dormancy halo, shared OBJ geometry",
    summary:
      "WorldPool2 spawns duplicate `THREE.Mesh` copies of `./Assets/Fish/fish.obj` (one BufferGeometry + material shared across instances). Behaviour uses `_fishBioTime` (paused when the player leaves the basin + halo) to cycle solo wander → cohesive school (~5 minutes per constants) → dispersal slice → repeat. Shallower/smaller meshes ring the littoral (~2×-count cap). Observation gate: dormant when the avatar is neither in-water nor within `OBSERVE_EXTRA_TILES` × `V2_TILE_WORLD` beyond basin radius (`V2_POOL2_FISH_*` constants in constants.js — Anu/kids parity tuning surface). While dormant, meshes are invisible and receive no motion updates.",
    mitigations: [
      "constants.js — V2_POOL2_FISH_COUNT, *_SHALLOW_FACTOR, *_SHALLOW_MAX, *_SHALLOW_TARGET_LENGTH_M, LIFE_SOLO/SCHOOL/BLEND/DISPERSE, V2_POOL2_FISH_OBSERVE_EXTRA_TILES.",
      "Prefer shared geometry/material + capped mesh counts instead of importing new fish assets (draw + VRAM creep).",
      "If triangle pressure spikes, lower SHALLOW_MAX or FISH_COUNT before considering InstancedMesh migration.",
    ],
    files: ["js/v2/WorldPool2.js", "js/v2/constants.js"],
  },
];
