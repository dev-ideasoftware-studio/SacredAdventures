"""Build the Sacred Adventures Decision Engine workbook.

Usage: python3 -I build_engine.py <repo> <system.json> <assets.json> <variants.json> <out.xlsx>

Zero-trust rules baked in:
  * Every evidence reference is re-located in source at build time by a regex,
    so a stale line number cannot survive a rebuild ("NOT FOUND" flags drift).
  * "Assumed" columns hold what comments/docs claim; "Verified" columns hold only
    what extract.py, glbjson.mjs or a regex measured.
"""
import json, os, re, sys
from collections import defaultdict
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.comments import Comment

REPO, SYSJ, ASSETJ, VARJ, OUT = sys.argv[1:6]
SYS = json.load(open(SYSJ))
ASSETS = json.load(open(ASSETJ))
VARIANTS = json.load(open(VARJ))  # live path -> {prev_file, plan, mobile_file}
LIMBO = json.load(open(sys.argv[6]))["rows"] if len(sys.argv) > 6 else []
FILES = {f["file"]: f for f in SYS["files"]}
from datetime import date
AS_OF = os.environ.get("AS_OF") or date.today().isoformat()  # build date
SESSION_1 = "2026-10-22"  # fixed date of the first Claude session rows (history must not move)
SESSION_AG = "2026-10-22"  # Anu falsification review + Antigravity removal session
SCRATCH = "tools/decision-engine"

# ── evidence locator ─────────────────────────────────────────────────────
_src_cache = {}
def src(path):
    if path not in _src_cache:
        _src_cache[path] = open(os.path.join(REPO, path), encoding="utf-8").read().splitlines()
    return _src_cache[path]

def ev(path, pattern, nth=1):
    """Return 'path:L<n>' for the nth line matching pattern, or a NOT FOUND flag."""
    rx = re.compile(pattern)
    hits = [i + 1 for i, l in enumerate(src(path)) if rx.search(l)]
    if len(hits) < nth:
        return f"{path}: NOT FOUND /{pattern}/ — re-verify"
    return f"{path}:L{hits[nth - 1]}"

def evs(*pairs):
    return " · ".join(ev(p, r) for p, r in pairs)

# ── subsystem taxonomy ──────────────────────────────────────────────────
SUBSYSTEMS = [
    ("SUB-01", "Boot & entry", "Loads the page, import map, loading modal, registers and activates modules in a fixed order.",
     "index.html is the only live entry; index.v2.html is an older v2 build reachable from launch.html."),
    ("SUB-02", "Engine shell", "SacredOrchestrator owns renderer, scene, camera, RAF loop, module registry, HUD.",
     "One RAF loop calls 43 active modules in activation order, then renders main + PiP."),
    ("SUB-03", "ANU governance & telemetry", "Self-observing layer: audit, governance checks, sensorium, error/stress ledger, event bus, services.",
     "Mostly read-on-demand diagnostics. InteractionBus has 0 live subscribers; inventory walk runs every 120 frames with no live reader."),
    ("SUB-04", "Render governance", "Adaptive DPR, PiP stride, shadow sampling driven by frame budget.",
     "Three controllers act on the same lever (PiP stride) with different thresholds; all read JS-only frame time."),
    ("SUB-05", "PiP minimap & compass", "Picture-in-picture map / FPV view with compass dial.",
     "Second WebGL context on desktop; full scene re-render; every frame in Village View."),
    ("SUB-06", "World environment", "Ground, sky, day/night, weather, ambient audio, pool, dock, circles, pond flora.",
     "Pool and ground are procedural; pond flora is instanced (tree 18, bush 24, reeds 14)."),
    ("SUB-07", "Fauna", "Fish, fish jumps, frogs, butterflies, dragonfly, nature awareness.",
     "18 trout + 4 baby koi at 15,644 tris each as separate meshes (ATT-25); small fish instanced (32)."),
    ("SUB-08", "Player", "Avatar, click-to-move, keyboard look, zoom, cursor, footsteps, WorldPlayer shim.",
     "Loads Avatar-New.glb (246k tris, 2×4096² maps) by default; Avatar3 only with ?avatar=old."),
    ("SUB-09", "Population (NPCs)", "Seated NPCs at tipis: Yellow Butterfly, BHG, REG.",
     "Ambient only; REG is 1.94M tris on desktop and skipped on mobile."),
    ("SUB-10", "Structures & village building", "Tipis, braziers, village pad, mold tools, tool palette, building panel, map generator.",
     "Mold tools place flora/hills/rocks/tipis; building panel is list-only; 3 tipi clones of a 246k-tri model."),
    ("SUB-11", "Fishing", "Cast, bite turns, reel, catch, gauge, PiP gauge close-up.",
     "Largest module (2,991 lines, 981-line update). Transmission material on the gauge adds a pass while fishing."),
    ("SUB-12", "Items & save", "Harvest inventory and SAVE/RESET of world mutations.",
     "localStorage key v4.sanctuary.save; spec key sacredAdventures_saveState not implemented."),
    ("SUB-13", "UI shell & journal", "Panel and journal iframes, welcome guide, controls bar, HUD.",
     "postMessage bridge; HUD runs audit + governance at 2 Hz."),
    ("SUB-14", "Asset pipeline", "Draco loader, mobile GLB swap, compression scripts.",
     "Mobile swap set does not include the tipi URL the live game loads."),
    ("SUB-15", "Shared config & helpers", "constants, maps registry, terrain/platform helpers, compass math.",
     "constants.js is imported by most modules; v2 helper files are imported for single functions."),
    ("SUB-16", "Legacy / unused code", "v2 world modules and sanctuary leftovers.",
     "20 files only reachable from index.v2.html; 8 files reachable from no entry page."),
]
SUB_NAME = {s[0]: s[1] for s in SUBSYSTEMS}

def subsystem_for(f):
    b = os.path.basename(f)
    st = FILES[f]["status"]
    if st.startswith("Legacy") or st.startswith("Unreferenced"):
        return "SUB-16"
    if b in ("BuildBadge.js",):
        return "SUB-01"
    if b in ("Orchestrator.js", "OrchestratorHud.js", "RuntimeServices.js"):
        return "SUB-02"
    if b in ("AnuAdaptiveDpr.js", "RenderingGovernor.js", "FrameBudget.js", "AdaptiveRenderPolicy.js", "PipRenderStrategy.js"):
        return "SUB-04"
    if b in ("PipOrthoRingDiskClip.js", "UIModule.js", "pipCompassMath.js"):
        return "SUB-05"
    if b == "AnuNatureAwareness.js":
        return "SUB-07"
    if f.startswith("js/v2/anu/") or b == "AnuModule.js":
        return "SUB-03"
    if b in ("SanctuaryGround.js", "SanctuarySky.js", "SanctuaryDayNight.js", "SanctuaryWeather.js", "SanctuaryAmbient.js",
             "SanctuaryPool.js", "SanctuaryDock.js", "SanctuaryCircles.js", "SanctuaryHexGrid.js", "SanctuaryPondTrees.js",
             "SanctuarySceneConstructor.js"):
        return "SUB-06"
    if b in ("SanctuaryFish.js", "SanctuaryFishJumps.js", "SanctuaryFrogs.js", "SanctuaryButterflies.js", "SanctuaryDragonfly.js"):
        return "SUB-07"
    if b in ("SanctuaryAvatar.js", "SanctuaryClickToMove.js", "SanctuaryKeyboardLook.js", "SanctuaryZoom.js", "SanctuaryCursor.js",
             "SanctuaryWaterFootsteps.js", "SanctuaryWorldPlayerShim.js", "SanctuaryTravelDisc.js"):
        return "SUB-08"
    if b in ("SanctuaryTipiNpcs.js", "NPCBehaviour.js"):
        return "SUB-09"
    if b.startswith("Mold") or b in ("SanctuaryTipis.js", "SanctuaryBraziers.js", "SanctuaryVillagePad.js", "SanctuaryToolPalette.js",
                                      "SanctuaryMapGeneratorUi.js", "BuildingPanelUI.js", "SanctuaryMutations.js", "TipiCampfire.js",
                                      "WorldTipiJournalBalloon.js"):
        return "SUB-10"
    if b == "SanctuaryFishing.js":
        return "SUB-11"
    if b in ("SanctuaryInventory.js", "SanctuaryControls.js"):
        return "SUB-12"
    if b in ("SanctuaryJournalBridge.js", "SanctuaryWelcomeGuide.js"):
        return "SUB-13"
    if b == "gltfLoaderSetup.js":
        return "SUB-14"
    return "SUB-15"

MOD_ID = {f: f"MOD-{i:03d}" for i, f in enumerate(sorted(FILES), 1)}
def mid(f):
    return MOD_ID.get(f, f)

# ── findings (evidence relocated by regex) ───────────────────────────────
FINDINGS = [
    dict(id="FND-01", sev="Critical", sub="SUB-09", title="REG NPC is 1.94M triangles",
         assumed="Seated NPC, one of three tipi owners; header says desktop loads REG at full detail.",
         verified="NPC.REG.glb = 1,942,136 tris, 18 primitives, 54 textures (~294 MB VRAM). ~48% of estimated boot triangles.",
         evidence=evs(("js/sanctuary/SanctuaryTipiNpcs.js", r"const REG_URL"), ("js/sanctuary/SanctuaryTipiNpcs.js", r"REG loads on every device now")),
         impact="Vertex + skinning cost in main and PiP passes; largest single VRAM consumer.",
         fix="Swap to NPC.REG.lite.glb (60,410 tris, 66 MB) on desktop and NPC.REG.mobile.glb (31,096 tris, 18 MB) on mobile.",
         effort="S", plan="PLN-01"),
    dict(id="FND-02", sev="Critical", sub="SUB-10", title="Tipis use the 246k-triangle model ×3",
         assumed="Header: loads the same yellow-butterfly tipi as v2; mobile decimation script covers tipis.",
         verified="tipi.yellowbutterfly.glb = 245,880 tris, 4096² map; 3 clones at boot = 737,640 tris. Mobile swap set lists 'tipi.yellowbutterfly-compressed.glb', not the URL loaded, so mobile also gets full detail.",
         evidence=evs(("js/sanctuary/SanctuaryTipis.js", r"const TIPI_GLB_URL"), ("js/v2/gltfLoaderSetup.js", r"tipi.yellowbutterfly-compressed.glb")),
         impact="~18% of boot triangles; mobile memory risk.",
         fix="Swap to tipi.yellowbutterfly.lite.glb (40,000 tris, 2048²) and .mobile.glb (14,998 tris, 1024²); add the loaded basename to MOBILE_GLB_VARIANTS.",
         effort="S", plan="PLN-02"),
    dict(id="FND-03", sev="High", sub="SUB-14", title="~939 MB of texture VRAM at boot (desktop)",
         assumed="Mobile cap at 256 px handles memory; desktop has headroom.",
         verified="Boot GLB textures sum to ~939 MB uncompressed with mips: REG 294, YB 256 (3×4096² on a 37k-tri NPC), Avatar-New 171, tipi 85, reeds 85 (4096² on a 10k-tri reed).",
         evidence=evs(("js/v2/Orchestrator.js", r"MOBILE TEXTURE-MEMORY CAP"), ("js/sanctuary/SanctuaryTipiNpcs.js", r"const YB_URL")),
         impact="GPU memory pressure; doubled by the PiP second context (FND-04).",
         fix="Cap hero textures at 2048, props at 1024, small NPC parts at 512; consider KTX2/Basis.",
         effort="M", plan="PLN-03"),
    dict(id="FND-04", sev="High", sub="SUB-05", title="PiP minimap is a second WebGL context",
         assumed="PiP is a cheap minimap; throttled by RenderingGovernor stride.",
         verified="Desktop creates a 2nd WebGLRenderer with antialias + preserveDrawingBuffer; warm-up uploads every mesh and texture into it with culling off.",
         evidence=evs(("js/v2/Orchestrator.js", r"this\._pipRenderer = new THREE\.WebGLRenderer"), ("js/v2/Orchestrator.js", r"preserveDrawingBuffer: false"), ("js/v2/Orchestrator.js", r"this\._performBootRenderWarmup\(this\._pipRenderer")),
         impact="Duplicate GPU memory for all assets; extra full-scene pass; MSAA buffer.",
         fix="Render PiP into the main canvas with setViewport + setScissor (one context). Interim: drop antialias and preserveDrawingBuffer.",
         effort="L", plan="PLN-05"),
    dict(id="FND-05", sev="High", sub="SUB-05", title="PiP renders every frame in Village View",
         assumed="RenderingGovernor is the single source of truth for PiP cadence (stride 16).",
         verified="The stride gate is skipped when body has v4-top-down-view, so Village View renders the scene twice per frame.",
         evidence=ev("js/v2/Orchestrator.js", r"!isTopDown && !shouldRenderPipSceneThisFrame"),
         impact="Up to ~2× GPU work in the village-building screen.",
         fix="Apply the stride (or a dedicated village-view stride) in top-down mode.",
         effort="S", plan="PLN-06"),
    dict(id="FND-06", sev="Medium", sub="SUB-05", title="Per-PiP-pass scene traversals and allocations",
         assumed="PiP prep only toggles fog/background.",
         verified="Each PiP pass traverses the whole scene to zero uTime uniforms, allocates and adds an AmbientLight, and (fishing) runs ~40 string tests per object.",
         evidence=evs(("js/v2/Orchestrator.js", r"this\._pipAmbientLight = new THREE\.AmbientLight"), ("js/v2/Orchestrator.js", r"_getPipTimeUniforms\(\) \{"), ("js/v2/Orchestrator.js", r"o\.name\.includes\(\"tipi\"\)")),
         impact="CPU per PiP frame grows with scene size; GC churn.",
         fix="One shared time uniform; one cached ambient light toggled via layers; precomputed cull list.",
         effort="S", plan="PLN-06"),
    dict(id="FND-07", sev="High", sub="SUB-04", title="ANU governors time JavaScript, not frames",
         assumed="FrameBudget samples wall-clock frame duration.",
         verified="frameMs = performance.now() at loop start to after render calls: CPU submission only. GPU-bound frames read as OPTIMAL, so DPR and PiP never shed.",
         evidence=evs(("js/v2/Orchestrator.js", r"const frameT0 = performance\.now\(\)"), ("js/v2/Orchestrator.js", r"const frameMs = performance\.now\(\) - frameT0"), ("js/v2/anu/FrameBudget.js", r"export function recordFrameDuration")),
         impact="Adaptive quality does not react to the real bottleneck (GPU).",
         fix="Feed the controllers the RAF-to-RAF interval (clock delta), optionally EXT_disjoint_timer_query for GPU time.",
         effort="S", plan="PLN-07"),
    dict(id="FND-08", sev="Medium", sub="SUB-04", title="Three controllers fight over PiP stride",
         assumed="RenderingGovernor is the single source of truth.",
         verified="AdaptiveRenderPolicy (1.4×/1.1× target), AnuAdaptiveDpr (1.0×, 1.3×) and the Orchestrator CRITICAL bypass (1.6×) all change PiP cadence; shadows use a 4th threshold set (1.25×/1.6×).",
         evidence=evs(("js/v2/anu/AdaptiveRenderPolicy.js", r"setAdaptivePipStrideTarget\(cur \+ 1\)"), ("js/sanctuary/AnuAdaptiveDpr.js", r"setAdaptivePipStrideTarget\(curStride \+ 1\)"), ("js/v2/Orchestrator.js", r"this\._pipBypass = true")),
         impact="Oscillation and unpredictable quality; hard to tune.",
         fix="One controller owning DPR, PiP stride and shadow cadence with one hysteresis band.",
         effort="M", plan="PLN-07"),
    dict(id="FND-09", sev="Medium", sub="SUB-03", title="Scene inventory walk every 120 frames, no live reader",
         assumed="Inventory feeds ANU's live audit.",
         verified="captureSceneRenderInventory traverses the scene, calls getWorldPosition per object, builds and sorts rows every 120 frames. SCENE_INVENTORY_TICK has 0 live subscribers; snapshot is read only by on-demand debug APIs.",
         evidence=evs(("js/v2/anu/SceneModelInventory.js", r"export const SCENE_INVENTORY_INTERVAL_FRAMES"), ("js/v2/Orchestrator.js", r"captureSceneRenderInventory\(this\.scene\)")),
         impact="Periodic CPU spike (~every 2 s at 60 FPS).",
         fix="Compute on demand (when AnuUniverse.report()/journal asks).",
         effort="S", plan="PLN-08"),
    dict(id="FND-10", sev="Medium", sub="SUB-03", title="ANU InteractionBus is write-only in the live game",
         assumed="ANU sees and coordinates every event via the bus.",
         verified=f"{sum(1 for f in SYS['files'] if f['anu_events_dispatched'] and f['status'] not in ('Legacy v2 build only (index.v2.html)','Unreferenced by any entry page'))} live files dispatch; 0 live files subscribe (subscribers exist only in legacy v2 files).",
         evidence=evs(("js/v2/anu/InteractionBus.js", r"export function dispatchInteraction"), ("js/v2/Flora.js", r"subscribeInteraction\(ANU_EVENTS\.SEASON_CHANGE")),
         impact="Coordination happens through window globals instead (FND-11); bus adds cost without effect.",
         fix="Either route real coordination through the bus or treat it as debug-only.",
         effort="M", plan="PLN-12"),
    dict(id="FND-11", sev="Medium", sub="SUB-02", title=f"{len({g for f in SYS['files'] if f['status'] not in ('Legacy v2 build only (index.v2.html)','Unreferenced by any entry page') for g in f['globals_written']})} window globals are the real integration layer",
         assumed="Scorecard dimension 3 rewards 'no silent globals'; RuntimeServices is the service registry.",
         verified="Live modules write the window.* names listed in 41_Globals; only 4 runtime services are registered.",
         evidence=evs(("js/v2/Orchestrator.js", r"const _fishingNow = window\.__sanctuaryFishingActive"), ("js/v2/RuntimeServices.js", r"export function registerRuntimeService")),
         impact="Hidden coupling; hard to reason about; easy to break silently.",
         fix="Promote the top cross-module globals to RuntimeServices with contracts.",
         effort="L", plan="PLN-12"),
    dict(id="FND-12", sev="Low", sub="SUB-03", title="163 KB of AI memory prose ships to every player",
         assumed="pipelineMemory is the engine's incident ledger for agents.",
         verified="pipelineMemory.js is the largest file in the live import graph (163 KB unminified); 78 modules / ~1.3 MB unminified load without bundling.",
         evidence=ev("js/v2/anu/pipelineMemory.js", r"ANU_PIPELINE_MEMORY"),
         impact="Download + parse on every boot; no runtime value to the player.",
         fix="Move to docs/ or lazy-load from DevTools helpers only.",
         effort="S", plan="PLN-09"),
    dict(id="FND-13", sev="Medium", sub="SUB-01", title="Service worker is a kill switch (no offline play)",
         assumed="PROGRESS.md: Service Worker v9 caches all shell files; manifesto: offline-first.",
         verified="sw.js deletes all caches and unregisters itself.",
         evidence=ev("sw.js", r"DISABLED / SELF-DESTRUCT"),
         impact="~55 MB of GLBs re-downloaded when HTTP cache misses; offline goal unmet.",
         fix="Versioned cache-first SW for Assets/ only (hashed filenames), network-first for code.",
         effort="M", plan="PLN-10"),
    dict(id="FND-14", sev="Low", sub="SUB-02", title="Per-module FPS benchmarks are noise",
         assumed="Orchestrator benchmarks the FPS cost of every module in isolation.",
         verified="All 43 modules activate before start(); benches queue until FPS warm-up, so every bench runs with every module already active.",
         evidence=evs(("index.html", r"orc\.start\(\)"), ("js/v2/Orchestrator.js", r"_processBenchQueue\(\) \{")),
         impact="fpsCost values mislead tuning decisions.",
         fix="Remove, or bench by toggling one module off at a time after boot.",
         effort="S", plan="PLN-11"),
    dict(id="FND-15", sev="Medium", sub="SUB-07", title="22 fish (18 trout + 4 baby koi) at 15,644 triangles each, not instanced",
         assumed="Header: same trout mesh as v2 Pool2.",
         verified="fish.obj = 7,822 quads = 15,644 tris (OBJLoader count; an awk count gave 23,466 because of CRLF — ATT-25). 22 separate Meshes = 344,168 tris + 22 draws; census total for SanctuaryFishModule 344,426 tris / 24 draws.",
         evidence=evs(("js/sanctuary/SanctuaryFish.js", r"const FISH_COUNT"), ("js/sanctuary/SanctuaryFish.js", r"const FISH_OBJ_URL")),
         impact="~10% of boot triangles for small, mostly submerged fish.",
         fix="Decimate fish to ~1.5k tris and draw as one InstancedMesh.",
         effort="M", plan="PLN-04"),
    dict(id="FND-16", sev="Low", sub="SUB-02", title="Shadow map re-renders every frame when OPTIMAL",
         assumed="Shadows sampled under stress.",
         verified="shadowMap.autoUpdate = true whenever stress is OPTIMAL; scene casters are mostly static.",
         evidence=ev("js/v2/Orchestrator.js", r"this\.renderer\.shadowMap\.autoUpdate = true"),
         impact="A shadow depth pass every frame (512² key light, 18 instanced trees cast).",
         fix="autoUpdate false; needsUpdate when a caster moves or the sun changes; avatar via a blob or contact shadow.",
         effort="S", plan="PLN-13"),
    dict(id="FND-17", sev="Low", sub="SUB-08", title="Avatar foot-flatten allocates and forces matrix updates every frame",
         assumed="Cheap per-frame foot fix.",
         verified="3 Quaternions + 1 Euler allocated per frame; updateMatrixWorld(true) on foot and its parent.",
         evidence=ev("js/sanctuary/SanctuaryAvatar.js", r"this\._lFoot\.updateMatrixWorld\(true\)"),
         impact="Small GC churn.",
         fix="Hoist scratch objects to module scope.",
         effort="S", plan="PLN-14"),
    dict(id="FND-18", sev="Low", sub="SUB-11", title="Transmission material on the fishing gauge",
         assumed="Clear plastic look.",
         verified="MeshPhysicalMaterial with transmission 0.98 makes three.js render a transmission pass of opaque objects while the gauge is visible.",
         evidence=ev("js/sanctuary/SanctuaryFishing.js", r"2026-10-22 \(FND-18\)"),
         impact="Extra pass during fishing.",
         fix="Plain transparent MeshStandardMaterial at opacity 0.04 gives the same read.",
         effort="S", plan="PLN-14"),
    dict(id="FND-19", sev="Low", sub="SUB-01", title="Docs point at the wrong entry and wrong test commands",
         assumed="README/CONTRIBUTING: boot index.v2.html; npm test runs smoke + fidelity.",
         verified="Live game is index.html; package.json test = check:v2 + check:assets + test:v4 (no test:v2/test:fidelity scripts). WORDPRESS/, dist/, _legacy_archive/, SacredOnes.1/ are not in the repo.",
         evidence=evs(("README.md", r"index\.v2\.html"), ("package.json", r'"test":')),
         impact="Agents edit the wrong build; validation claims are wrong.",
         fix="Rewrite README/CONTRIBUTING entry + test sections from 10_System.",
         effort="S", plan="PLN-15"),
    dict(id="FND-20", sev="Low", sub="SUB-14", title="Mobile detection duplicated in 4 places",
         assumed="—",
         verified="RESOLVED (PLN-23, mobile Phase 1): was the same UA regex in Orchestrator constructor, Orchestrator._ensurePipPipeline, AnuAdaptiveDpr.load and gltfLoaderSetup; now one detectMobile() in js/v2/deviceProfile.js that all four read.",
         evidence=evs(("js/v2/deviceProfile.js", r"export function detectMobile"), ("js/v2/Orchestrator.js", r"this\._isMobile = deviceProfile\.isMobile"), ("js/v2/gltfLoaderSetup.js", r"deviceProfile\.isMobile")),
         impact="Drift risk between paths (removed).",
         fix="Done: js/v2/deviceProfile.js.",
         effort="S", plan="PLN-23"),
]
STATUS = {
    "FND-01": "Fixed in code (PLN-01) — verify in browser", "FND-02": "Fixed in code (PLN-02) — verify in browser",
    "FND-06": "Partly fixed (cached light + uniform cache); scan kept for non-close-up PiP", "FND-18": "Fixed in code — check gauge look in browser",
}
FINDINGS += [
    dict(id="FND-21", sev="Medium", sub="SUB-05", title="PiP posted a PIP_FRAME bitmap to a frame that never listens",
         assumed="Panel iframe shows the minimap frame.",
         verified="limbo.py: PIP_FRAME had 1 sender (Orchestrator) and 0 receivers across index.html, Panel, Journal, NewJournal, LoadingModal. Panel handles 10 other types only. Raised by Coder 1; verified.",
         evidence=ev("js/v2/Orchestrator.js", r"removed the PIP_FRAME createImageBitmap"),
         impact="createImageBitmap + postMessage on every PiP render; forced preserveDrawingBuffer.", fix="Removed; preserveDrawingBuffer false.", effort="S", plan="PLN-06"),
    dict(id="FND-22", sev="Low", sub="SUB-05", title="Fishing PiP ran a full-scene name scan that hid nothing visible",
         assumed="Scan keeps the fishing PiP focused on the gauge.",
         verified="Close-up camera uses layers.set(2); layer-2 objects (pool water, basin, fish, gauge) match none of the hide rules. Raised by Coder 1; verified against every layers.enable(2) site.",
         evidence=evs(("js/v2/Orchestrator.js", r"this\._pipOrtho\.layers\.set\(2\)"), ("js/v2/Orchestrator.js", r"2026-10-22 \(FND-22\)")),
         impact="~40 string tests per scene object every other frame while fishing.", fix="Skipped when the bobber exists.", effort="S", plan="PLN-06"),
    dict(id="FND-23", sev="High", sub="SUB-13", title="Journal commands go nowhere in the live game",
         assumed="index.html L179 comment: the page relays PROCESS_INPUT / RETURN_TO_GAME; journal is the LLM interaction layer.",
         verified="PROCESS_INPUT, JOURNAL_START_GAME_INTRO and JOURNAL_GREET_BHG are sent by Component.NewJournal.html and handled only in index.v2.html / legacy EngineMain.js. No live receiver.",
         evidence=evs(("js/components/Component.NewJournal.html", r"PROCESS_INPUT"), ("index.html", r"relay PROCESS_INPUT")),
         impact="Typed journal commands, START GAME and GREET HER do nothing — the accessibility path in the manifesto is cut.", fix="Port the handlers into a sanctuary module (JournalBridge).", effort="M", plan="PLN-17"),
    dict(id="FND-24", sev="Medium", sub="SUB-10", title="GENERATE SCENE silently skips terrain and pool regeneration",
         assumed="Generate rebuilds terrain and pool.",
         verified="window.__regenerateTerrain and window.__regeneratePoolObjects are called behind if-guards but assigned nowhere in live code.",
         evidence=evs(("js/sanctuary/SanctuaryToolPalette.js", r"window\.__regenerateTerrain\(\)"), ("js/sanctuary/SanctuaryToolPalette.js", r"window\.__regeneratePoolObjects\(\)")),
         impact="Map generation is partial without any error.", fix="Implement in SanctuaryGround / SanctuaryPool or remove the steps.", effort="M", plan="PLN-18"),
    dict(id="FND-25", sev="Low", sub="SUB-05", title="PiP toggle calls a function that does not exist",
         assumed="Shortcut suspends the PiP second renderer.",
         verified="index.html calls window._v4TogglePip behind a typeof guard; nothing assigns it.",
         evidence=ev("index.html", r"window\._v4TogglePip\(\)"), impact="Toggle does nothing.", fix="Implement on the orchestrator or remove the binding.", effort="S", plan="PLN-18"),
    dict(id="FND-26", sev="Low", sub="SUB-05", title="PiP protect rule names a selector that no longer exists",
         assumed="Rule protects #pipCanvas inside #moondial-wrapper.",
         verified="Live element is #v2-pip-canvas inside #pip-compass-wrapper (UIModule). Raised by Coder 1; verified.",
         evidence=evs((".cursor/rules/sacred-pip-map-protect.mdc", r"moondial-wrapper"), ("js/v2/UIModule.js", r'id="v2-pip-canvas"')),
         impact="Agents may not recognise the live PiP as protected.", fix="Update the rule's selector text.", effort="S", plan="PLN-19"),
    dict(id="FND-27", sev="Low", sub="SUB-15", title="WorldPhysics service is looked up but only the legacy build registers it",
         assumed="Shared structure helpers read terrain height from WorldPhysics.",
         verified="getRuntimeService('WorldPhysics') in WorldStructures.js; registerRuntimeService('WorldPhysics') only in World.js (index.v2.html). Whether the live game reaches those helper lines is not yet traced.",
         evidence=evs(("js/v2/WorldStructures.js", r"getRuntimeService\(\"WorldPhysics\"\)"), ("js/v2/World.js", r"registerRuntimeService\(\"WorldPhysics\"")),
         impact="Unknown until the call path is traced.", fix="Trace callers; register a sanctuary WorldPhysics shim if reached.", effort="S", plan="PLN-18"),
    dict(id="FND-28", sev="Medium", sub="SUB-11", title="Fishing pins the DPR floor at 1.5",
         assumed="Keeps the fishing close-up crisp.",
         verified="setMinDpr(1.5) on entering fishing; desktop DPR cap is 1.5, so fishing can never shed resolution.",
         evidence=ev("js/sanctuary/SanctuaryFishing.js", r"setMinDpr\?\.\(1\.5\)"),
         impact="Full fill-rate cost for the whole fishing session.", fix="Decide: floor 1.25, or keep for crispness.", effort="S", plan="PLN-16"),
    dict(id="FND-29", sev="Medium", sub="SUB-08", title="Avatar is 246k skinned triangles with 2×4096² maps and casts a shadow",
         assumed="gltfLoaderSetup comment: Avatar-New is already low-poly.",
         verified="Avatar-New.glb = 245,991 tris, 170.6 MB texture VRAM; castShadow true, so it is drawn in the shadow pass too.",
         evidence=evs(("js/sanctuary/SanctuaryAvatar.js", r'let AVATAR_URL'), ("js/sanctuary/SanctuaryAvatar.js", r"ch\.castShadow = true")),
         impact="Largest remaining skinned mesh; three passes (main, shadow, Village View PiP).", fix="Lite avatar (~40k tris, 2048 px) built and verified like REG.", effort="S", plan="PLN-20"),
    dict(id="FND-30", sev="Low", sub="SUB-07", title="Comments say the gauge left layer 2; code still puts it there",
         assumed="SanctuaryFish / SanctuaryPool comments: gauge removed from layer 2.",
         verified="_build3DGauge enables layer 2 on every gauge child.",
         evidence=evs(("js/sanctuary/SanctuaryFishing.js", r"child\.layers\.enable\(2\)"), ("js/sanctuary/SanctuaryPool.js", r"gauge removed from layer 2")),
         impact="Misleads anyone tuning the fish-finder view.", fix="Correct the comments (or remove the gauge from layer 2 if that was the intent).", effort="S", plan="PLN-15"),
    dict(id="FND-31", sev="Low", sub="SUB-05", title="Old PiP uniform stash could leave shared clocks at zero",
         assumed="Stash/restore leaves time uniforms as they were.",
         verified="A uniform reached twice (global clock + material reference) was pushed twice; restore wrote the real value then 0.",
         evidence=ev("js/v2/Orchestrator.js", r"A Set de-duplicates uniforms"),
         impact="Shared clock read 0 until its owner's next update.", fix="De-duplicated in _getPipTimeUniforms.", effort="S", plan="PLN-06"),
]
# ── pond + fishing line-by-line pass (playbook "Pool & Fishing Optimization — Coder Playbook", cards C-01..C-10) ──
_PL = "Playbook card "
FINDINGS += [
    dict(id="FND-32", sev="High", sub="SUB-11", title="Every catch leaks a 512² texture, a material and a cloned geometry",
         assumed="Removed fish are cleaned up.",
         verified="_createFishMesh builds a MeshPhysicalMaterial + 512² CanvasTexture + geometry.clone() per catch; hook removals (3 sites) never dispose; the dispose loops call material.dispose() but never material.map.dispose(). ~5.4 MB per catch.",
         evidence=evs(("js/sanctuary/SanctuaryFishing.js", r"template\.geometry\.clone\(\)"), ("js/sanctuary/SanctuaryFishing.js", r"this\._hookGroup\.remove\(this\._caughtFish3D\)")),
         impact="GPU memory grows ~109 MB after 20 catches.", fix=_PL + "C-01: one shared geometry/material/texture + _releaseFish().", effort="M", plan="PLN-21"),
    dict(id="FND-33", sev="Medium", sub="SUB-07", title="Small-fish school culled while on screen (frozen bounding sphere)",
         assumed="InstancedMesh culls correctly.",
         verified="three r160 computes InstancedMesh.boundingSphere once on first cull (radius 0.67–3.73 m in simulation); fish swim 4.88–9 m out.",
         evidence=ev("js/sanctuary/SanctuaryFish.js", r"this\._smallFishMesh = new THREE\.InstancedMesh"),
         impact="School pops out at the edges of the view.", fix=_PL + "C-02: fixed sphere covering the pool.", effort="S", plan="PLN-21"),
    dict(id="FND-34", sev="Medium", sub="SUB-07", title="15 fish behaviours ignore the stride under stress",
         assumed="update(delta) scales by stride everywhere.",
         verified="Most motion uses delta*stride; 15 lines in update() use raw delta (awk check in C-03), so at stride 6 they run at 1/6 speed.",
         evidence=ev("js/sanctuary/SanctuaryFish.js", r"const turnSpeed = 1\.2 \* delta;"),
         impact="Fish hover/turn/chase slowly exactly when the game is already struggling.", fix=_PL + "C-03: const dt = delta * stride.", effort="S", plan="PLN-21"),
    dict(id="FND-35", sev="High", sub="SUB-06", title="Lily flowers: 182 draws + 165 shadow casters for 3,136 triangles",
         assumed="Lilies are cheap.",
         verified="scene_census + test_mergeStatic: each flower is many child meshes; merged per material → 50 draws, 0 shadow casters, identical vertices and colours.",
         evidence=ev("js/sanctuary/SanctuaryPool.js", r"^function _buildLotusFlower"),
         impact="~347 draw submissions per frame on the CPU.", fix=_PL + "C-04: mergeStaticChildren per flower group.", effort="S", plan="PLN-21"),
    dict(id="FND-36", sev="Medium", sub="SUB-06", title="Shoreline rocks: 60 materials that differ only in colour",
         assumed="Rocks need their own materials.",
         verified="test_mergeStatic: tint → vertex colour merge gives 60 → 2 draws and shadow casters; worst vertex shift 4.77e-7 m; moss shader kept.",
         evidence=ev("js/sanctuary/SanctuaryPool.js", r"^function buildShorelineRocks"),
         impact="116 extra draws per frame.", fix=_PL + "C-05.", effort="S", plan="PLN-21"),
    dict(id="FND-37", sev="Low", sub="SUB-06", title="Flat transparent DoubleSide sheets draw twice (water, circles, ripples)",
         assumed="One mesh = one draw.",
         verified="r160 renders transparent+DoubleSide in two passes unless forceSinglePass; water 2, circles 16 in the census.",
         evidence=ev("js/sanctuary/SanctuaryCircles.js", r"side: THREE\.DoubleSide"),
         impact="9+ wasted draws per frame.", fix=_PL + "C-06: forceSinglePass on flat sheets only.", effort="S", plan="PLN-21"),
    dict(id="FND-38", sev="Medium", sub="SUB-06", title="Turtle 34 draws / 30 casters, dock 37 draws",
         assumed="Static props are already cheap.",
         verified="test_mergeOthers: turtle 34 → 13 (animated refs kept), dock 37 → 3, both identical.",
         evidence=evs(("js/sanctuary/SanctuaryPool.js", r"group\.userData\.flipperLRef"), ("js/sanctuary/SanctuaryDock.js", r'root\.name = "sanctuary_dock"')),
         impact="55 draws + 37 shadow draws.", fix=_PL + "C-07.", effort="S", plan="PLN-21"),
    dict(id="FND-39", sev="Low", sub="SUB-06", title="Water normal-map scroll patch is dead",
         assumed="Comment: dual-scrolling normal blend.",
         verified="patchcheck.mjs: the replace target 'texture2D( normalMap, vNormalMapUv ).xyz' is not in r160's raw ShaderLib (it lives inside an #include chunk). 1 dead of 28 shader replaces in js/sanctuary.",
         evidence=ev("js/sanctuary/SanctuaryPool.js", r"texture2D\( normalMap, vNormalMapUv \)\.xyz"),
         impact="Visual effect never shows.", fix="Owner decision (C-10 #4): make it work or delete it.", effort="S", plan="PLN-21"),
    dict(id="FND-40", sev="Low", sub="SUB-06", title="getWaveHeight does not match the water vertex shader",
         assumed="Comment: 'must match the vertex shader exactly'.",
         verified="JS: freq 22/36, speed 0.32/0.45, amp 0.005/0.003, fade 0.35. Shader: 10/18, 0.785/1.047, 0.020/0.008, fade 0.32.",
         evidence=evs(("js/sanctuary/SanctuaryPool.js", r"^function getWaveHeight"), ("js/sanctuary/SanctuaryPool.js", r"float phase1 = vDist \* 10\.0")),
         impact="Pads bob out of step with the visible swell.", fix="Owner decision (C-10 #5).", effort="S", plan="PLN-21"),
    dict(id="FND-41", sev="Low", sub="SUB-11", title="Gauge needle is never built",
         assumed="Gauge shows reel progress.",
         verified="ud.needleGroup is read but never assigned anywhere in js/.",
         evidence=ev("js/sanctuary/SanctuaryFishing.js", r"if \(ud\.needleGroup\)"),
         impact="No progress feedback on the 3D gauge.", fix="Owner decision (C-10 #1).", effort="S", plan="PLN-21"),
    dict(id="FND-42", sev="Low", sub="SUB-07", title="New AudioContext for every fish snack, never closed",
         assumed="Sound is fire-and-forget.",
         verified="new AudioContext() inside update(); no close().",
         evidence=ev("js/sanctuary/SanctuaryFish.js", r"const audioCtx = new \(window\.AudioContext"),
         impact="Browsers cap open contexts; sound can stop working.", fix=_PL + "C-09e.", effort="S", plan="PLN-21"),
    dict(id="FND-43", sev="Medium", sub="SUB-06", title="Reeds use one 4096² texture (~85 MB VRAM) for 9,912 triangles",
         assumed="Flora assets are light.",
         verified="glbjson.mjs on Assets/flora/reeds.glb: 1 texture, max 4096 px, 85.3 MB estimated VRAM.",
         evidence=ev("js/sanctuary/SanctuaryPondTrees.js", r'const REED_URL'),
         impact="Largest single texture in the pond.", fix="Lite reeds via lite.mjs (playbook research rank 2).", effort="S", plan="PLN-03"),
    dict(id="FND-44", sev="High", sub="SUB-05", title="PiP cameras enable layer 0, so the minimap redraws every default object",
         assumed="layers.enable(1) marks what the minimap shows.",
         verified="Both PiP cameras enable layers 0, 1 and 3; layer 0 is every object's default.",
         evidence=ev("js/v2/Orchestrator.js", r"this\._pipOrtho\.layers\.enable\(0\)"),
         impact="Second WebGL context renders the whole scene.", fix="Research rank 1: layer-only PiP; owner OK needed (PiP protect rule).", effort="M", plan="PLN-06"),
]
STATUS.update({"FND-21": "Fixed in code", "FND-22": "Fixed in code", "FND-31": "Fixed in code"})
for _f in FINDINGS:
    _f["status"] = STATUS.get(_f["id"], "Open")
FND_IDX = {f["id"]: f for f in FINDINGS}

# ── plan ─────────────────────────────────────────────────────────────────
PLAN = [
    ("PLN-01", 1, "Swap REG to the lite/mobile models", "FND-01",
     "js/sanctuary/SanctuaryTipiNpcs.js (REG_URL, mobile skip); js/v2/gltfLoaderSetup.js (MOBILE_GLB_VARIANTS); Assets/NPC.REG.lite.glb + .mobile.glb",
     "renderer.info.render.triangles drops by ≥1.8M on desktop; REG sits and animates (6 clips); REG appears on mobile.",
     "Done (code) — verify in browser", "Approved by user ('lets use those'). REG_URL → lite; mobile skip removed; loader swap set updated; mobile URL rewrite traced."),
    ("PLN-02", 2, "Swap tipis to the lite/mobile models", "FND-02",
     "js/sanctuary/SanctuaryTipis.js (TIPI_GLB_URL); js/v2/gltfLoaderSetup.js (MOBILE_GLB_VARIANTS); Assets/Tipi.yellowbutterfly/*.lite/.mobile.glb",
     "Triangles drop by ~618k; tipi scale/placement unchanged (target height logic reads bbox).",
     "Done (code) — verify in browser", "TIPI_GLB_URL → lite; mobile swap traced to an existing file. Tipis 1–3 strip the texture by design."),
    ("PLN-03", 3, "Texture downsize pass", "FND-03",
     "Assets: NPC.YB.glb, npc/Avatar-New.glb, flora/reeds.glb, pond-side rocks; scripts/ (reuse lite.mjs)",
     "Boot texture VRAM < 250 MB desktop (measured with glbjson.mjs).", "Not started", ""),
    ("PLN-04", 4, "Decimate + instance the trout", "FND-15",
     "Assets/Fish/fish.obj (new low-poly); js/sanctuary/SanctuaryFish.js",
     "Fish triangles < 40k total; one draw call for 18 trout.", "Not started", ""),
    ("PLN-05", 5, "PiP on one WebGL context", "FND-04",
     "js/v2/Orchestrator.js (_ensurePipPipeline, _renderWithMask, _renderPip); index.html PiP DOM",
     "One WebGL context in chrome://gpu / document canvases; minimap identical; PiP invariant rule respected.",
     "Not started", "Touches the protected PiP — needs explicit user approval (sacred-pip-map-protect)."),
    ("PLN-06", 6, "PiP quick wins", "FND-05, FND-06",
     "js/v2/Orchestrator.js (_renderPip stride gate, _preparePipScene, _stashAnuCullablesForPipRender, renderer options)",
     "PiP renders ≤ every 4th frame in Village View; no per-pass traverse; no AmbientLight allocation.",
     "In progress", "Done: PIP_FRAME removed, preserveDrawingBuffer false, fishing scan skip, cached light, uniform cache (user asked to super-cull the PiP). Open: Village View stride."),
    ("PLN-07", 7, "One frame-clock controller", "FND-07, FND-08",
     "js/v2/Orchestrator.js (_loop); js/v2/anu/FrameBudget.js; AdaptiveRenderPolicy.js; js/sanctuary/AnuAdaptiveDpr.js",
     "Under an artificial GPU load, DPR steps down within 2 s; no stride oscillation.", "Not started", ""),
    ("PLN-08", 8, "Scene inventory on demand", "FND-09", "js/v2/Orchestrator.js; js/v2/anu/SceneModelInventory.js",
     "No 120-frame periodic task in a Performance trace; AnuUniverse.report() still returns inventory.", "Not started", ""),
    ("PLN-09", 9, "Move pipelineMemory out of the runtime bundle", "FND-12", "js/v2/anu/pipelineMemory.js; js/v2/AnuModule.js",
     "Live import graph < 1.2 MB; AnuUniverse memory helpers still work in DevTools.", "Not started", ""),
    ("PLN-10", 10, "Asset-only caching service worker", "FND-13", "sw.js; index.html registration",
     "Second visit loads GLBs from cache; code still network-first.", "Not started", "User previously directed NO caching — confirm before changing."),
    ("PLN-11", 11, "Fix or remove module benchmarks", "FND-14", "js/v2/Orchestrator.js (bench methods)", "No misleading fpsCost in report().", "Not started", ""),
    ("PLN-12", 12, "Decide the bus/global contract", "FND-10, FND-11", "js/v2/RuntimeServices.js; top globals in 41_Globals",
     "Top 10 cross-module globals have a registered service or a documented owner.", "Not started", ""),
    ("PLN-13", 13, "Static shadow map", "FND-16", "js/v2/Orchestrator.js (stress → shadow block); js/sanctuary/SanctuaryGround.js (key light)",
     "Shadow pass only on change; visuals unchanged.", "Not started", ""),
    ("PLN-14", 14, "Small hot-loop cleanups", "FND-17, FND-18, FND-20",
     "js/sanctuary/SanctuaryAvatar.js; SanctuaryFishing.js; mobile detection sites", "No per-frame allocations in Avatar update; no transmission pass.", "In progress", "Done: gauge transmission → standard transparent (FND-18)."),
    ("PLN-16", 16, "Fishing render cost", "FND-18, FND-22, FND-28, FND-15",
     "js/sanctuary/SanctuaryFishing.js; js/v2/Orchestrator.js; js/sanctuary/SanctuaryFish.js", "Fishing frame interval ≥ 30% shorter than baseline in a Performance trace; tipis/trees/NPCs stay visible (ATT-04).", "In progress", "Done: transmission pass removed, PiP scan skip. Open: DPR floor decision, trout decimation (PLN-04)."),
    ("PLN-17", 17, "Restore journal command routing", "FND-23", "js/sanctuary/SanctuaryJournalBridge.js; index.html", "Typing a command in the journal triggers its game event; START GAME and GREET HER work.", "Not started", "Port from index.v2.html handlers — read them first."),
    ("PLN-18", 18, "Fix limbo UI calls", "FND-24, FND-25, FND-27", "js/sanctuary/SanctuaryToolPalette.js; index.html; js/v2/WorldStructures.js", "limbo.py shows no LIMBO for these names.", "Not started", ""),
    ("PLN-19", 19, "Update PiP protect rule selector", "FND-26", ".cursor/rules/sacred-pip-map-protect.mdc", "Rule names #v2-pip-canvas / #pip-compass-wrapper.", "Not started", ""),
    ("PLN-20", 20, "Lite avatar", "FND-29", "Assets/npc/Avatar-New.glb → lite; js/sanctuary/SanctuaryAvatar.js", "Avatar ≤ 50k tris, 9 clips intact, skincheck + raster preview pass.", "Not started", "Same pipeline as PLN-01."),
    ("PLN-21", 21, "Pond & fishing change cards C-01..C-09", "FND-15, FND-32, FND-33, FND-34, FND-35, FND-36, FND-37, FND-38, FND-39, FND-40, FND-41, FND-42",
     "js/sanctuary/SanctuaryFishing.js; SanctuaryFish.js; SanctuaryPool.js; SanctuaryDock.js; SanctuaryCircles.js; new js/sanctuary/mergeStatic.js (from tools/decision-engine/proposals/)",
     "Census pond total 799 → 285 after C-04..C-07; merge tests exit 0; patchcheck dead count never rises; renderer.info.memory flat after 5 catches (C-01).",
     "Not started (proposals proven in Node)", "One card per commit; follow the playbook's Do-not lists. C-10 items wait for the owner."),
    ("PLN-22", 22, "Mobile Phase 0 — ground-truth baseline", "", "docs/mobile/PHASE0_BASELINE.md; tools/mobile/*",
     "Every row has file:line or measurement evidence.", "Done", "MOBILE_OPTIMIZATION_PROMPT.md Phase 0. 6 profiles + online simulation."),
    ("PLN-23", 23, "Mobile Phase 1 — one 'is mobile' source", "", "js/v2/deviceProfile.js (new); Orchestrator.js; AnuAdaptiveDpr.js; gltfLoaderSetup.js",
     "UA regex only in deviceProfile.js; Phase 0 measurements unchanged.", "Done", "4 live copies replaced; 66/66 UA equivalence; 6-profile diff identical; ?device= override. docs/mobile/PHASE1_REPORT.md"),
    ("PLN-24", 24, "Mobile Phase 2 — panel icon renderer + source images", "", "js/components/Component.ThreeIcons.js; SacredGame.Panel.html; mobile variants of NPC.YB / flora/reeds (Avatar-New = PLN-20)",
     "Phone: no 2nd-context texture > 256 px; no 4096^2 source maps on mobile.", "Done", "Online phone: 2nd WebGL context holds ~172 MB; 384 MB of 4096^2 source pixels. Coordinate with PLN-20 / FIX_PROMPT task 7."),
    ("PLN-25", 25, "Mobile Phase 3 — fluid UI for remaining panels", "", "OrchestratorHud.js (landscape breakpoint); UIModule.js (distance pill); SacredGame.Panel.html (center-stack); hidden sheets",
     "tests/v4-mobile-layout.spec.js passes on all 6 profiles.", "Not started", ""),
    ("PLN-26", 26, "Mobile Phase 4 — minimap without readback", "FND-04", "js/v2/Orchestrator.js (_renderWithMask mobile branch)",
     "No readRenderTargetPixels on the mobile live path.", "Awaiting approval", "Needs Mark's written approval (PiP protect rule)."),
    ("PLN-27", 27, "Mobile Phase 6 — self-host lucide / three / fonts", "", "SacredGame.Panel.html; vendor/",
     "All-external-blocked boot: zero page errors.", "Not started", "Offline: lucide@latest failure leaves panel action handlers undefined."),
    ("PLN-15", 15, "Correct README / CONTRIBUTING", "FND-19", "README.md; CONTRIBUTING.md; PROGRESS.md",
     "Docs match 10_System facts.", "Not started", ""),
]

# ── claims vs verified ──────────────────────────────────────────────────
CLAIMS = [
    ("CLM-01", "README.md", "index.v2.html is the only HTML you should boot; js/v2 is canonical.", "Live game = index.html with 43 modules (36 from js/sanctuary). index.v2.html is the older v2 build linked from launch.html.", "Stale", ev("README.md", r"only HTML you should boot")),
    ("CLM-02", "README.md", "npm test runs check:v2, check:assets, test:v2 smoke, test:fidelity.", "package.json test = check:v2 && check:assets && test:v4. No test:v2 or test:fidelity script exists.", "Stale", ev("package.json", r'"test":')),
    ("CLM-03", "PROGRESS.md", "Service Worker v9 caches all shell files.", "sw.js is a self-destruct kill switch; nothing is cached.", "Stale", ev("PROGRESS.md", r"Service Worker v9")),
    ("CLM-04", "SanctuaryAvatar.js header", "Loads Assets/Avatar3.glb (decimated to ~205k).", "Default URL is Assets/npc/Avatar-New.glb (245,991 tris). Avatar3.glb (1,956,236 tris) loads only with ?avatar=old.", "Stale", ev("js/sanctuary/SanctuaryAvatar.js", r'let AVATAR_URL')),
    ("CLM-05", "RenderingGovernor.js header", "Single source of truth for multi-pass WebGL / PiP cadence.", "Three controllers change PiP stride; Village View bypasses the stride entirely.", "Contradicted", ev("js/v2/Orchestrator.js", r"!isTopDown && !shouldRenderPipSceneThisFrame")),
    ("CLM-06", "FrameBudget.js header", "Wall-clock frame duration sampling.", "Receives JS time from loop start to after render submission; excludes GPU and idle time.", "Contradicted", ev("js/v2/Orchestrator.js", r"const frameMs = performance\.now\(\) - frameT0")),
    ("CLM-07", "docs/SCORECARD.md dim 3", "No silent globals.", "Live modules write many window.* globals (see 41_Globals).", "Contradicted", ev("docs/SCORECARD.md", r"no silent globals")),
    ("CLM-08", "Orchestrator.js header", "Benchmark FPS cost of every module in isolation.", "Benches run after all modules are active; values are not isolated.", "Contradicted", ev("js/v2/Orchestrator.js", r"Benchmark FPS cost of every module")),
    ("CLM-09", "scripts/decimate-mobile-assets.mjs", "Mobile variants cover the tipi.", "Covers tipi.yellowbutterfly-compressed.glb; live code loads tipi.yellowbutterfly.glb, so no mobile swap happens.", "Contradicted", ev("js/sanctuary/SanctuaryTipis.js", r"const TIPI_GLB_URL")),
    ("CLM-10", "SanctuaryTipiNpcs.js (before PLN-01)", "REG is ~1.9M triangles and is skipped on mobile.", "Measured 1,942,136 tris. Superseded: lite model now loads on every device.", "Verified, then changed", ev("js/sanctuary/SanctuaryTipiNpcs.js", r"REG loads on every device now")),
    ("CLM-11", "Orchestrator.js constructor", "Mobile: shadows off, DPR 1.0, texture cap 256 px.", "Present in code (not runtime-tested here).", "Verified (static)", ev("js/v2/Orchestrator.js", r"shadowMap\.enabled = !this\._isMobile")),
    ("CLM-12", "docs/legacy-reconciliation.md", "WORDPRESS/, dist/, _legacy_archive/, SacredOnes.1/ trees exist and are frozen.", "None of those directories are in the repository.", "Stale", ev("docs/legacy-reconciliation.md", r"WORDPRESS/")),
    ("CLM-13", "Manifesto / index.html meta", "WCAG 2.2 AAA compliance.", "Not verified — no audit run in this session.", "Unverified", ev("SACRED_ADVENTURES_MANIFESTO.md", r"WCAG 2\.2")),
    ("CLM-14", "Orchestrator FISHING_SUSPEND comment", "Skipping non-pond modules saves 3–6 ms/frame.", "Not measured (no browser runtime here).", "Unverified", ev("js/v2/Orchestrator.js", r"saves 3-6ms/frame")),
    ("CLM-16", "Coder 1 report", "Nothing in the repo listens for PIP_FRAME.", "limbo.py over all live frames: 0 receivers. Panel handler lists 10 other types.", "Verified", ev("js/v2/Orchestrator.js", r"removed the PIP_FRAME")),
    ("CLM-17", "Coder 1 report", "The fishing PiP scan hides nothing that would be drawn.", "Close-up camera is layer 2 only; every layer-2 object checked against the hide rules.", "Verified", ev("js/v2/Orchestrator.js", r"this\._pipOrtho\.layers\.set\(2\)")),
    ("CLM-18", "Coder 1 report", "The frame timer stops right after render() is issued.", "frameMs measured after render submission; GPU time excluded.", "Verified", ev("js/v2/Orchestrator.js", r"const frameMs = performance\.now\(\) - frameT0")),
    ("CLM-19", "Coder 1 report", "Two shared time uniforms already exist.", "window._globalTime and window.__sanctuaryFloraTimeUniform are stashed separately.", "Verified", ev("js/v2/Orchestrator.js", r"window\.__sanctuaryFloraTimeUniform\.value = 0")),
    ("CLM-20", "Coder 1 report", "Protect-rule selector is out of date.", "Rule: #pipCanvas in #moondial-wrapper; live: #v2-pip-canvas in #pip-compass-wrapper.", "Verified", ev(".cursor/rules/sacred-pip-map-protect.mdc", r"moondial-wrapper")),
    ("CLM-21", "index.html comment", "This page relays PROCESS_INPUT / RETURN_TO_GAME.", "No handler for PROCESS_INPUT in index.html; only the comment mentions it.", "Contradicted", ev("index.html", r"relay PROCESS_INPUT")),
    ("CLM-22", "SanctuaryFish / SanctuaryPool comments", "Gauge removed from layer 2.", "_build3DGauge enables layer 2 on every child.", "Contradicted", ev("js/sanctuary/SanctuaryFishing.js", r"child\.layers\.enable\(2\)")),
    ("CLM-23", "gltfLoaderSetup.js comment (before edit)", "Avatar-New is already low-poly.", "245,991 tris, 2×4096² maps.", "Contradicted", ev("js/sanctuary/SanctuaryAvatar.js", r'let AVATAR_URL')),
    ("CLM-15", "Project description", "Village builder + hunting + fishing + crafting simulator.", "Fishing and village shaping exist; hunting and crafting have no code in the live build.", "Partly true", ev("js/sanctuary/SanctuaryInventory.js", r"Five item kinds")),
]

# ── decision log ─────────────────────────────────────────────────────────
DECISIONS = [
    ("DEC-01", "Treat index.html as the live entry, not index.v2.html", "GitHub Pages serves index.html; it imports js/sanctuary; README says otherwise.", "Import-graph walk from both entry pages (extract.py).", "CLM-01"),
    ("DEC-02", "Classify file status by import reachability, never by comments", "Zero-trust instruction; comments drift.", "extract.py reachability from index.html and index.v2.html.", "30_Modules"),
    ("DEC-03", "Estimate boot triangles from measured GLB tris × instance counts in code", "No browser available (Playwright Chromium download blocked by the network allowlist).", "glbjson.mjs + instance constants (TREE_COUNT, BUSH_COUNT, REED_PATCHES, FISH_COUNT, tipi clones).", "51_Assets"),
    ("DEC-04", "REG targets: 60k tris / 512 px desktop, 31k / 256 px mobile", "Seated ~1 m NPC; YB is 37k tris; 54 maps across 18 materials dominate VRAM.", "skincheck.mjs (41 joints, weights sum to 1, 6 clips) + raster.py preview vs original.", "FND-01"),
    ("DEC-05", "Tipi targets: 40k tris / 2048 px desktop, 15k / 1024 px mobile", "Tipi is ~3 m and close to camera; keep texture detail higher than NPC parts.", "raster.py per-pixel preview vs original.", "FND-02"),
    ("DEC-06", "Do not change game code without approval", "User asked to plan the swap; repo scope-lock rule; PiP invariant.", "—", "60_Plan"),
    ("DEC-07", "Deliver the workbook as .xlsx", "No spreadsheet artifact type is offered in this session.", "Artifact type listing.", "00_Index"),
    ("DEC-08", "Revert the package-lock.json rename instead of committing it", "Side effect of npm install in a differently named folder; scope lock.", "git diff showed only the name field.", "—"),
    ("DEC-09", "Record comments as 'Assumed', measurements as 'Verified'", "Zero-trust mode.", "Column split in 30_Modules, 20_Subsystems, 50_Findings.", "—"),
    ("DEC-11", "Name mobile files *.lite.mobile.glb", "The existing mobileGlbUrl rewrite (.glb → .mobile.glb) then works with no loader code change.", "trace/m.cjs: desktop and iPhone UA rewrite to files that exist.", "PLN-01, PLN-02"),
    ("DEC-12", "PiP render-path edits are approved", "User asked to super-cull the PiP; that satisfies sacred-pip-map-protect.", "—", "PLN-06"),
    ("DEC-13", "Fishing cull is view-based only, never distance or type", "92a1163 reversed a 16 m distance cull because tipis/trees/NPCs vanished (ATT-04).", "three.js already frustum-culls every heavy mesh (frustumCulled stays true); removed real extra passes instead.", "PLN-16"),
    ("DEC-14", "Leave the shadow map running while fishing", "The avatar casts a shadow and animates while reeling; a frozen shadow map would freeze it.", "castShadow true on avatar meshes.", "FND-16"),
    ("DEC-15", "Keep PiP MSAA; drop only preserveDrawingBuffer", "MSAA removal is a visible change; preserveDrawingBuffer had no reader once PIP_FRAME was gone.", "grep for toDataURL/toBlob/readPixels on the PiP canvas: none.", "FND-21"),
    ("DEC-16", "Do not change the fishing DPR floor yet", "It was added on purpose for crispness; needs the user's call.", "—", "FND-28"),
    ("DEC-17", "Merge only direct children of a group, with animated parts skipped", "Groups keep moving (flower bob, turtle swim); window-published meshes (lily pads) must stay separate objects.", "test_mergeStatic / test_mergeOthers: identical vertices, pads untouched, refs still attached.", "PLN-21"),
    ("DEC-18", "Anything players can see change goes to the owner first", "Zero-trust + earlier reverts on visual changes (ATT-06, ATT-09).", "Playbook C-10 lists 8 such decisions.", "PLN-21"),
    ("DEC-10", "Use per-pixel rasterization for low-poly previews", "Centroid sampling made big triangles look blotchy and would mislead.", "raster.py vs render.py side by side.", "FND-01, FND-02"),
]

# ── review playbook ──────────────────────────────────────────────────────
PLAYBOOK = [
    ("RVW-01", "Low FPS in Village View", "SUB-05", ev("js/v2/Orchestrator.js", r"_renderPip\(\) \{"),
     "In DevTools: watch anuOrchestrator._pipRenderedLastFrame for 60 frames with body.v4-top-down-view set.",
     "Code path renders every frame in top-down (FND-05)."),
    ("RVW-02", "FPS low but ANU reports OPTIMAL", "SUB-04", ev("js/v2/Orchestrator.js", r"recordFrameDuration\(frameMs\)"),
     "Compare 1/clock delta (anuOrchestrator.rawFPS) with 1000/AnuUniverse.budget avgMs; Performance panel GPU track.",
     "Governor input is JS-only time (FND-07)."),
    ("RVW-03", "Triangle count too high", "SUB-14", "51_Assets",
     f"node {SCRATCH}/glbjson.mjs out.json <glbs> ; in game: anuOrchestrator.renderer.info.render.triangles",
     "Boot estimate 3.95M (fish corrected, ATT-25); REG + tipis = 68%."),
    ("RVW-04", "Mobile crash / page reload", "SUB-14", ev("js/v2/gltfLoaderSetup.js", r"const MOBILE_GLB_VARIANTS"),
     "For each URL in 51_Assets 'Loaded at boot', check its basename is in MOBILE_GLB_VARIANTS or the module skips it on mobile.",
     "Tipi URL missing from the set (FND-02)."),
    ("RVW-05", "Periodic hitch every ~2 s", "SUB-03", ev("js/v2/Orchestrator.js", r"SCENE_INVENTORY_INTERVAL_FRAMES === 0"),
     "Performance trace: long tasks spaced 120 frames apart; temporarily set the interval huge and compare.",
     "Code path confirmed; not profiled (FND-09)."),
    ("RVW-06", "Module fpsCost numbers look wrong", "SUB-02", ev("js/v2/Orchestrator.js", r"_beginBench\(name\) \{"),
     "Check index.html: are all activate() calls before orc.start()?",
     "Yes — benches are not isolated (FND-14)."),
    ("RVW-07", "ANU event fires but nothing reacts", "SUB-03", ev("js/v2/anu/InteractionBus.js", r"export function subscribeInteraction"),
     "grep -rn 'subscribeInteraction(' over files with status Active/Imported in 30_Modules.",
     "0 live subscribers (FND-10)."),
    ("RVW-08", "A global changes unexpectedly", "SUB-02", "41_Globals",
     "Find the name in 41_Globals → writers column → grep 'window.<name>\\s*=' in those files.",
     "Registry built by extract.py."),
    ("RVW-09", "Swapped model breaks animation", "SUB-09", ev("js/sanctuary/SanctuaryTipiNpcs.js", r"loadAsync\(cfg\.url\)"),
     f"node {SCRATCH}/skincheck.mjs <orig.glb> <new.glb> — joints, weight sums, clip names must match.",
     "REG lite/mobile: 41 joints, 6 clips, weight deviation ≤ 0.0004."),
    ("RVW-10", "Decimated model looks wrong", "SUB-14", "51_Assets",
     f"node {SCRATCH}/dump.mjs <glb> <dir> ; python3 -I {SCRATCH}/raster.py <dir> out.png title",
     "REG and tipi previews delivered (reg_compare.png, tipi_compare.png)."),
    ("RVW-11", "New module added but nothing happens", "SUB-01", ev("index.html", r"orc\.register\(AnuModule\)"),
     "Check both orc.register(X) and await orc.activate('<name>') exist and are not commented; rerun extract.py → 30_Modules status.",
     "SanctuaryHexGrid is registered but its activate line is commented out."),
    ("RVW-13", "Fishing scene slow", "SUB-11", ev("js/sanctuary/SanctuaryFishing.js", r"_enterFishingZone\(\) \{"),
     "DevTools: scan scene for materials with transmission > 0; check AnuUniverse.adaptiveDpr.snapshot() floor; count PiP renders; never fix by hiding world objects (ATT-04).",
     "Transmission removed; PiP scan skipped; DPR floor 1.5 still pinned."),
    ("RVW-14", "A call or message seems to do nothing", "SUB-02", "44_Limbo_Calls",
     f"python3 -I {SCRATCH}/limbo.py <repo> system.json limbo.json — look the name up in 44_Limbo_Calls.",
     "13 postMessage types, 4 window functions, 7 DOM ids, 17 ANU events without a live receiver at build."),
    ("RVW-12", "This workbook may be stale", "SUB-01", "10_System commit row",
     f"python3 -I {SCRATCH}/extract.py <repo> system.json && python3 -I {SCRATCH}/build_engine.py … ; search the workbook for 'NOT FOUND'.",
     f"Built at commit {SYS['commit']}."),
    ("RVW-15", "Pond or fishing view draws too much", "SUB-06", ev("js/sanctuary/SanctuaryPool.js", r"^function buildLilyPads"),
     "node --import ./tools/decision-engine/census_pre.mjs tools/decision-engine/scene_census.mjs <file> <ExportName> …; compare with the playbook baseline (799 pond total); look at byKind for the biggest row; check frustumCulledFalse and doubleSidedTransparent.",
     "Merges must keep window-published meshes and animated refs (DEC-17)."),
    ("RVW-16", "A shader patch seems to do nothing", "SUB-06", ev("js/sanctuary/SanctuaryPool.js", r"onBeforeCompile"),
     "node tools/decision-engine/patchcheck.mjs — lists every .replace() target missing from r160's raw ShaderLib text (onBeforeCompile sees text before #include expansion).",
     "Baseline: 1 dead (FND-39)."),
    ("RVW-17", "GPU memory grows during play", "SUB-11", ev("js/sanctuary/SanctuaryFishing.js", r"_createFishMesh\(\) \{"),
     "Console: anuOrchestrator.renderer.info.memory before/after 5 catches; grep every .remove( of a mesh for a matching dispose, and every material.dispose() for its .map.",
     "material.dispose() never frees textures."),
]

GLOSSARY = [
    ("ANU / Anu / Simulation Universe", "The governance + telemetry layer (AnuModule + js/v2/anu). User-facing name since 2026-05-31: Simulation Universe."),
    ("SacredOrchestrator", "Engine shell class in js/v2/Orchestrator.js; singleton at window.anuOrchestrator."),
    ("Module", "Object {name, load, unload, update} registered and activated by the orchestrator."),
    ("PiP", "Picture-in-picture minimap/compass canvas #v2-pip-canvas; FPV in Village View, top-down map otherwise, gauge close-up while fishing."),
    ("Village View", "Top-down main camera (body class v4-top-down-view) where mold tools work."),
    ("Mold tool", "Village-shaping verb (grow_hill, plant_tree/flower/bush/lily/rock, place_tipi) applied through SanctuaryMutations."),
    ("Stride", "PiP renders every Nth frame (baseline 16, max 22)."),
    ("DPR", "Device pixel ratio of the main renderer; AnuAdaptiveDpr steps a ladder 2.0 → 0.75."),
    ("Stress level", "OPTIMAL / STRESS / CRITICAL from rolling JS frame time vs target (FrameBudget.getSystemStressLevel)."),
    ("Boot triangles", "Sum of measured GLB triangles × instances placed at boot (desktop, default map); excludes procedural ground/pool geometry."),
    ("VRAM (est.)", "Texture width × height × 4 bytes × 1.333 for mips, uncompressed; per WebGL context."),
    ("Live", "Reachable by import from index.html."),
    ("Zero-trust", "Comments and docs are recorded as Assumed; only measured facts go in Verified columns."),
]

# ═════════════════════════════════ workbook ═════════════════════════════
wb = Workbook()
FONT = "Arial"
H_FILL = PatternFill("solid", fgColor="3E2C23")
H_FONT = Font(name=FONT, bold=True, color="FFFFFF", size=10)
B_FONT = Font(name=FONT, size=10)
LINK_FONT = Font(name=FONT, size=10, color="0B5394", underline="single")
TITLE_FONT = Font(name=FONT, bold=True, size=14, color="3E2C23")
SUB_FONT = Font(name=FONT, italic=True, size=10, color="666666")
THIN = Side(style="thin", color="D9D2C9")
BORDER = Border(bottom=THIN)
WRAP = Alignment(wrap_text=True, vertical="top")
SEV_FILL = {"Critical": "F4CCCC", "High": "FCE5CD", "Medium": "FFF2CC", "Low": "E8F0E3"}

SHEETS = []  # (name, level, purpose, read when)

def sheet(name, level, purpose, when, title, subtitle, headers, rows, widths, first=False):
    ws = wb.active if first else wb.create_sheet()
    ws.title = name
    SHEETS.append((name, level, purpose, when))
    ws["A1"] = title; ws["A1"].font = TITLE_FONT
    ws["A2"] = subtitle; ws["A2"].font = SUB_FONT
    hr = 4
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=hr, column=c, value=h)
        cell.font, cell.fill, cell.alignment = H_FONT, H_FILL, Alignment(wrap_text=True, vertical="center")
    for r, row in enumerate(rows, hr + 1):
        for c, v in enumerate(row, 1):
            if isinstance(v, (list, tuple)):
                v = "; ".join(str(x) for x in v)
            cell = ws.cell(row=r, column=c, value=v)
            cell.font, cell.alignment, cell.border = B_FONT, WRAP, BORDER
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = ws.cell(row=hr + 1, column=2)
    if rows:
        ws.auto_filter.ref = f"A{hr}:{get_column_letter(len(headers))}{hr + len(rows)}"
    ws.row_dimensions[hr].height = 30
    return ws, hr

# ── 00_Index placeholder (filled last) ──
idx = wb.active
idx.title = "00_Index"

# ── 30_Modules (built early so 10_System formulas can count it) ──
mod_rows = []
for f in sorted(FILES):
    fr = FILES[f]
    hz = ", ".join(f"{k}×{v}" for k, v in fr["hazards"].items())
    verified = (f"{fr['lines']} lines, {fr['kb']} KB. "
                + (f"update() at L{fr['update_line']} ({fr['update_lines']} lines{', ' + fr['update_throttle'] if fr['update_throttle'] else ''})." if fr["has_update"] else "No update().")
                + (f" Per-frame hazards: {hz}." if hz else "")
                + (f" Writes {len(fr['globals_written'])} globals." if fr["globals_written"] else ""))
    finds = [x["id"] for x in FINDINGS if f in x["evidence"]]
    mod_rows.append([
        mid(f), f, subsystem_for(f), SUB_NAME[subsystem_for(f)], fr["status"], fr["activation_order"],
        fr["module_name"], fr["anu_domain_claimed"], fr["header"], verified,
        ", ".join(mid(x) for x in fr["imports"]), ", ".join(mid(x) for x in fr["imported_by"]),
        fr["globals_written"], fr["globals_read"],
        fr["anu_events_dispatched"], fr["anu_events_subscribed"],
        fr["services_registered"] + [f"uses:{s}" for s in fr["services_used"]],
        fr["postmessage_types"] + [f"dom:{e}" for e in fr["dom_events_dispatched"]],
        fr["assets"], "Yes" if fr["fishing_suspended"] else "", "Yes" if fr.get("also_in_v2_build") else "",
        fr["commit_count"], fr["last_commit"], ", ".join(finds),
    ])
MOD_HEAD = ["Module ID", "File", "Subsystem ID", "Subsystem", "Status (verified)", "Activation order",
            "Module name", "ANU domain (claimed)", "Assumed purpose (header comment — treat as stale)",
            "Verified behaviour (mechanical)", "Imports (MOD IDs)", "Imported by (MOD IDs)",
            "Globals written", "Globals read", "ANU events dispatched", "ANU events subscribed",
            "Runtime services", "postMessage / DOM events sent", "Assets referenced",
            "Suspended while fishing", "Also in v2 build", "Commits touching file", "Last commit", "Findings"]

# ── 51_Assets ──
BOOT = {  # instances placed at boot, desktop default map; each backed by evidence
    "Assets/NPC.REG.lite.glb": (1, 1, ev("js/sanctuary/SanctuaryTipiNpcs.js", r"const REG_URL")),
    "Assets/NPC.YB.glb": (1, 1, ev("js/sanctuary/SanctuaryTipiNpcs.js", r"const YB_URL")),
    "Assets/NPC.BHG.glb": (1, 1, ev("js/sanctuary/SanctuaryTipiNpcs.js", r"const BHG_URL")),
    "Assets/npc/Avatar-New.glb": (1, 1, ev("js/sanctuary/SanctuaryAvatar.js", r'let AVATAR_URL')),
    "Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly.lite.glb": (3, 3, ev("js/sanctuary/SanctuaryTipis.js", r"_plantTipi\(scene, root, gltf\.scene, tipi1Hex")),
    "Assets/tree.glb": (18, 18, ev("js/sanctuary/SanctuaryPondTrees.js", r"const TREE_COUNT")),
    "Assets/bush.glb": (24, 24, ev("js/sanctuary/SanctuaryPondTrees.js", r"const BUSH_COUNT")),
    "Assets/flora/reeds.glb": (14, 14, ev("js/sanctuary/SanctuaryPondTrees.js", r"const REED_PATCHES")),
    "Assets/Avatar3.glb": (0, 0, ev("js/sanctuary/SanctuaryAvatar.js", r"avatar=old")),
}
asset_rows = []
users = defaultdict(list)
for f, fr in FILES.items():
    for a in fr["assets"]:
        users[a].append(mid(f))
REPLACED = {v["prev_file"]: k for k, v in VARIANTS.items()}
MOBILE_FILES = {v["mobile_file"] for v in VARIANTS.values()}
LIVE_ASSET_NAMES = {x for fr in FILES.values() if not fr["status"].startswith(("Legacy", "Unreferenced")) for x in fr["assets"]}
for i, (a, m) in enumerate(sorted(((k, v) for k, v in ASSETS.items() if k in LIVE_ASSET_NAMES), key=lambda kv: -kv[1].get("tris", 0)), 1):
    inst_d, inst_m, evid = BOOT.get(a, (0, 0, "No load call found from an Active module (URL constant only)."))
    if a in REPLACED:
        evid = f"Replaced at boot by {REPLACED[a]} ({VARIANTS[REPLACED[a]]['plan']}); URL constant may remain in legacy helpers."
    var = VARIANTS.get(a, {})
    prev = ASSETS.get(var.get("prev_file", ""), {})
    mob = ASSETS.get(var.get("mobile_file", ""), {})
    asset_rows.append([f"AST-{i:02d}", a, "Yes" if inst_d else "No", m["tris"], inst_d, None,
                       inst_m, m["maxTex"], m["textures"], m["vramMB"], m["fileMB"],
                       "Yes" if m["skinned"] else "", m["animations"], ", ".join(users.get(a, [])), evid,
                       var.get("prev_file", ""), prev.get("tris"), None, prev.get("vramMB"),
                       var.get("mobile_file", ""), mob.get("tris"), mob.get("vramMB"),
                       ", ".join(x["id"] for x in FINDINGS if os.path.basename(a) in x["verified"] or os.path.basename(a) in x["evidence"])])
# fish.obj is not a GLB — measured by face count
asset_rows.append([f"AST-{len(asset_rows) + 1:02d}", "Assets/Fish/fish.obj", "Yes", 23466, 18, None, 18, None, 0, 0, 1.06, "", 0,
                   ", ".join(users.get("Assets/Fish/fish.obj", [mid("js/sanctuary/SanctuaryFish.js")])),
                   ev("js/sanctuary/SanctuaryFish.js", r"const FISH_COUNT"), "", None, None, None, "", None, None, "FND-15"])
ASSET_HEAD = ["Asset ID", "Path", "Loaded at boot", "Triangles (measured)", "Instances at boot (desktop)",
              "Boot triangles (desktop)", "Instances at boot (mobile)", "Largest texture (px)", "Textures",
              "Texture VRAM est. (MB)", "File (MB)", "Skinned", "Animations", "Referenced by (MOD IDs)",
              "Instance evidence", "Replaced asset (before)", "Replaced triangles", "Replaced boot triangles",
              "Replaced VRAM (MB)", "Mobile variant (loader swap)", "Mobile triangles", "Mobile VRAM (MB)", "Findings"]

# ── 40_Connections edge list ──
edges = []
def add_edge(kind, a, b, detail=""):
    edges.append([kind, a, b, detail])
for f, fr in FILES.items():
    for d in fr["imports"]:
        add_edge("import", mid(f), mid(d), os.path.basename(d))
    for g in fr["globals_written"]:
        add_edge("global-write", mid(f), f"window.{g}", "")
    for e in fr["anu_events_dispatched"]:
        add_edge("anu-event-dispatch", mid(f), f"ANU_EVENTS.{e}", "")
    for e in fr["anu_events_subscribed"]:
        add_edge("anu-event-subscribe", mid(f), f"ANU_EVENTS.{e}", "")
    for s in fr["services_registered"]:
        add_edge("service-register", mid(f), f"service:{s}", "")
    for s in fr["services_used"]:
        add_edge("service-use", mid(f), f"service:{s}", "")
    for a in fr["assets"]:
        add_edge("asset", mid(f), a, "")
    for p in fr["postmessage_types"]:
        add_edge("postMessage", mid(f), f"msg:{p}", "")
EDGE_ROWS = [[f"EDG-{i:04d}", k, a, FILES_BY_ID if False else "", b, d,
              "Live" if (a.startswith("MOD-") and not FILES[[x for x, y in MOD_ID.items() if y == a][0]]["status"].startswith(("Legacy", "Unreferenced"))) else "Legacy/unused"]
             for i, (k, a, b, d) in enumerate(edges, 1)]
ID_TO_FILE = {v: k for k, v in MOD_ID.items()}
for r in EDGE_ROWS:
    r[3] = ID_TO_FILE.get(r[2], "")

# ── 41_Globals registry ──
gw, gr = defaultdict(list), defaultdict(list)
for f, fr in FILES.items():
    for g in fr["globals_written"]:
        gw[g].append(f)
    for g in fr["globals_read"]:
        gr[g].append(f)
live = lambda f: not FILES[f]["status"].startswith(("Legacy", "Unreferenced"))
GLOB_ROWS = []
for i, g in enumerate(sorted(set(gw) | set(gr), key=lambda g: (-len([x for x in gw[g] if live(x)]) - len([x for x in gr[g] if live(x)]), g)), 1):
    lw, lr = [x for x in gw[g] if live(x)], [x for x in gr[g] if live(x)]
    if not lw and not lr:
        continue
    GLOB_ROWS.append([f"GLB-{i:03d}", f"window.{g}", len(lw), len(lr), ", ".join(mid(x) for x in lw), ", ".join(mid(x) for x in lr),
                      "Cross-module (written by one, read by another)" if lw and lr and set(lr) - set(lw) else ("Write-only" if lw and not lr else ("Read-only here (written elsewhere/HTML)" if lr and not lw else "Self-use"))])
for n, r in enumerate(GLOB_ROWS, 1):
    r[0] = f"GLB-{n:03d}"

# ── 42_Events registry ──
ev_disp, ev_sub = defaultdict(list), defaultdict(list)
for f, fr in FILES.items():
    for e in fr["anu_events_dispatched"]:
        ev_disp[e].append(f)
    for e in fr["anu_events_subscribed"]:
        ev_sub[e].append(f)
ev_names = re.findall(r"^\s+([A-Z_]+):\s*\"", "\n".join(src("js/v2/anu/anuEvents.js")), re.M)
EVENT_ROWS = []
for i, e in enumerate(ev_names, 1):
    ld, ls = [x for x in ev_disp[e] if live(x)], [x for x in ev_sub[e] if live(x)]
    EVENT_ROWS.append([f"EVT-{i:02d}", f"ANU_EVENTS.{e}", ", ".join(mid(x) for x in ld), ", ".join(mid(x) for x in ls),
                       ", ".join(mid(x) for x in ev_sub[e] if not live(x)),
                       "Dispatched, nobody listens (live)" if ld and not ls else ("Live round trip" if ld and ls else ("Never dispatched (live)" if not ld else ""))])

# ── 43_Services ──
svc = defaultdict(lambda: {"reg": [], "use": []})
for f, fr in FILES.items():
    for s in fr["services_registered"]:
        svc[s]["reg"].append(f)
    for s in fr["services_used"]:
        svc[s]["use"].append(f)
SVC_ROWS = [[f"SVC-{i:02d}", s, ", ".join(mid(x) for x in v["reg"] if live(x)), ", ".join(mid(x) for x in v["use"] if live(x)),
             "Registered and used" if v["reg"] and v["use"] else ("Used but never registered in live code" if v["use"] else "Registered, no live consumer")]
            for i, (s, v) in enumerate(sorted(svc.items()), 1)]

# ── 11_Boot_Sequence ──
name_to_file = {fr["module_name"]: f for f, fr in FILES.items() if fr["registered_symbol"]}
BOOT_ROWS = []
for i, n in enumerate(SYS["activated"], 1):
    f = name_to_file.get(n, "")
    BOOT_ROWS.append([i, n, mid(f) if f else "", f, subsystem_for(f) if f else "", "Yes" if FILES.get(f, {}).get("fishing_suspended") else "",
                      ev("index.html", rf"await orc\.activate\('{n}'\)")])
for n in SYS["activation_commented_out"]:
    f = name_to_file.get(n, "")
    BOOT_ROWS.append(["—", n + " (commented out)", mid(f), f, subsystem_for(f) if f else "", "", ev("index.html", rf"//\s*await orc\.activate\('{n}'\)")])

# ── 12_Frame_Loop ──
O = "js/v2/Orchestrator.js"
LOOP_ROWS = [
    (1, "FPS EMA smoothing", "Every frame", ev(O, r"FPS smoothing \(EMA\)"), "CPU, trivial", ""),
    (2, "AnuNatureAwareness.tick()", "Every frame", ev(O, r"AnuNatureAwareness\.tick\(\)"), "CPU, trivial", ""),
    (3, "43 module update() calls in activation order (27 skipped while fishing)", "Every frame", ev(O, r"for \(const name of this\._activeModules\)"), "CPU; see 30_Modules hazards", "FND-17"),
    (4, "Benchmark tick", "Every frame while a bench runs", ev(O, r"── Benchmark tick"), "CPU, trivial", "FND-14"),
    (5, "Stress level → shadow autoUpdate / sampling", "Every frame", ev(O, r"stress = getSystemStressLevel\(\)"), "GPU: shadow pass every frame when OPTIMAL", "FND-16"),
    (6, "PiP bypass hysteresis (CRITICAL → off, OPTIMAL → on)", "Every frame", ev(O, r"this\._pipBypass = true"), "Decision only", "FND-08"),
    (7, "Main render", "Every frame", ev(O, r"this\.renderer\.render\(this\.scene, this\.camera\); // P0"), "GPU: ~4.0M boot triangles", "FND-01, FND-02, FND-15"),
    (8, "PiP render (2nd context): FPV map stride 16 · Village View every frame · fishing every 2nd", "Variable", ev(O, r"_renderPip\(\) \{"), "GPU: full scene again + MSAA; CPU: scene traversal per pass", "FND-04, FND-05, FND-06"),
    (9, "HUD values (+ ANU audit and governance at 2 Hz)", "Every 20 frames", ev(O, r"this\._frameCount % 20 === 0"), "CPU + DOM writes", ""),
    (10, "recordFrameDuration + tickAdaptiveRenderPolicy", "Every frame", ev(O, r"recordFrameDuration\(frameMs\)"), "Feeds JS-only time to governors", "FND-07"),
    (11, "Stress ledger sample", "Every 45 frames", ev(O, r"STRESS_LEDGER_SAMPLE_INTERVAL_FRAMES === 0"), "CPU, small", ""),
    (12, "Scene inventory walk", "Every 120 frames", ev(O, r"SCENE_INVENTORY_INTERVAL_FRAMES === 0"), "CPU spike: traverse + getWorldPosition per object", "FND-09"),
    (13, "ANU alert evaluation (inside AnuModule.update)", "Every 240 frames", ev("js/v2/AnuModule.js", r"frameCount % 240"), "CPU, small", ""),
]

# ── 10_System facts (formulas reference other sheets) ──
# built after we know sheet names/ranges
# ── create sheets in taxonomy order ──
sys_ws = wb.create_sheet("10_System"); SHEETS.append(("10_System", "L1 System", "Headline facts about the whole system, computed from the deeper sheets.", "Start of every session; after a rebuild."))
sheet("11_Boot_Sequence", "L1 System", "Exact module activation order from index.html.", "Adding, removing or reordering modules.",
      "Boot sequence", f"Activation order in index.html · evidence re-located at build · commit {SYS['commit']}",
      ["Order", "Module name", "Module ID", "File", "Subsystem", "Suspended while fishing", "Evidence"], BOOT_ROWS, [7, 28, 10, 40, 9, 10, 40])
sheet("12_Frame_Loop", "L1 System", "What runs inside one RAF frame, in order, with cadence and cost class.", "Any FPS or stutter problem.",
      "Frame loop", "SacredOrchestrator._loop — order of work in one frame",
      ["Step", "Work", "Cadence", "Evidence", "Cost class", "Findings"], LOOP_ROWS, [6, 52, 22, 32, 40, 18])
sub_rows = []
for sid, name, assumed, verified in SUBSYSTEMS:
    mods = [r for r in mod_rows if r[2] == sid]
    sub_rows.append([sid, name, assumed, verified, None, None, None,
                     ", ".join(r[0] for r in mods), ", ".join(x["id"] for x in FINDINGS if x["sub"] == sid),
                     ", ".join(p[0] for p in PLAN if any(FND_IDX.get(f.strip(), {}).get("sub") == sid for f in p[3].split(",")))])
SUB_HEAD = ["Subsystem ID", "Subsystem", "Assumed role (docs/comments)", "Verified reality (mechanical)", "Files (count)",
            "Active modules", "Lines of code", "Module IDs", "Findings", "Plan steps"]
sub_ws, sub_hr = sheet("20_Subsystems", "L2 Subsystems", "Each subsystem: assumed role vs verified reality, size, members, findings, plan.", "Choosing where a change belongs.",
                       "Subsystems", "Counts are live formulas over 30_Modules", SUB_HEAD, sub_rows, [10, 24, 44, 52, 9, 9, 10, 40, 22, 16])
mod_ws, mod_hr = sheet("30_Modules", "L3 Modules", "Every JS file: status, assumed vs verified behaviour, and all connections.", "Before editing any file.",
                       "Modules", f"{len(mod_rows)} files under js/sanctuary, js/v2, js/v2/anu + BuildBadge · generated by extract.py",
                       MOD_HEAD, mod_rows, [10, 40, 9, 20, 22, 8, 22, 14, 60, 50, 30, 30, 30, 30, 26, 18, 20, 20, 30, 9, 8, 8, 34, 14])
mod_last = mod_hr + len(mod_rows)
# subsystem formulas
for i in range(len(sub_rows)):
    r = sub_hr + 1 + i
    sub_ws.cell(row=r, column=5, value=f"=COUNTIF('30_Modules'!$C${mod_hr + 1}:$C${mod_last},A{r})")
    sub_ws.cell(row=r, column=6, value=f"=COUNTIFS('30_Modules'!$C${mod_hr + 1}:$C${mod_last},A{r},'30_Modules'!$E${mod_hr + 1}:$E${mod_last},\"Active\")")
    sub_ws.cell(row=r, column=7, value=None)
# lines of code per subsystem: helper hidden column in modules (lines)
mod_ws.cell(row=mod_hr, column=len(MOD_HEAD) + 1, value="Lines").font = H_FONT
mod_ws.cell(row=mod_hr, column=len(MOD_HEAD) + 1).fill = H_FILL
for i, f in enumerate(sorted(FILES)):
    mod_ws.cell(row=mod_hr + 1 + i, column=len(MOD_HEAD) + 1, value=FILES[f]["lines"]).font = B_FONT
LINES_COL = get_column_letter(len(MOD_HEAD) + 1)
for i in range(len(sub_rows)):
    r = sub_hr + 1 + i
    sub_ws.cell(row=r, column=7, value=f"=SUMIF('30_Modules'!$C${mod_hr + 1}:$C${mod_last},A{r},'30_Modules'!${LINES_COL}${mod_hr + 1}:${LINES_COL}${mod_last})")
for c in (5, 6, 7):
    for i in range(len(sub_rows)):
        sub_ws.cell(row=sub_hr + 1 + i, column=c).font = B_FONT

con_ws, _ = sheet("40_Connections", "L4 Contracts", "Every edge: imports, globals, ANU events, services, assets, postMessage.", "Tracing what a change will touch.",
                  "Connections", "Edge list for graph tools: Kind · From · To", ["Edge ID", "Kind", "From (MOD ID)", "From file", "To", "Detail", "Scope"],
                  EDGE_ROWS, [11, 20, 10, 40, 44, 26, 12])
sheet("41_Globals", "L4 Contracts", "window.* names written/read by live code — the de-facto integration layer.", "A value changes unexpectedly.",
      "Globals registry", "Live files only · sorted by how many files touch the name",
      ["Global ID", "Name", "Live writers", "Live readers", "Writer MOD IDs", "Reader MOD IDs", "Pattern"], GLOB_ROWS, [9, 38, 8, 8, 34, 50, 30])
sheet("42_Events", "L4 Contracts", "ANU_EVENTS vocabulary: who dispatches, who subscribes.", "Wiring behaviour through ANU.",
      "ANU events", "From js/v2/anu/anuEvents.js", ["Event ID", "Event", "Live dispatchers", "Live subscribers", "Legacy subscribers", "Verdict"],
      EVENT_ROWS, [9, 40, 34, 18, 22, 32])
sheet("43_Services", "L4 Contracts", "RuntimeServices registry: registrations and consumers.", "Adding a cross-module dependency.",
      "Runtime services", "registerRuntimeService / getRuntimeService call sites", ["Service ID", "Service", "Registered by", "Used by", "Verdict"],
      SVC_ROWS, [9, 26, 26, 44, 36])
limbo_rows = [[f"LMB-{i:03d}", r["kind"], r["name"], "; ".join(r["senders"]), "; ".join(r["receivers"]), r["verdict"], r["note"]]
              for i, r in enumerate(sorted(LIMBO, key=lambda r: (not r["verdict"].startswith("LIMBO"), r["kind"], r["name"])), 1)]
lmb_ws, lmb_hr = sheet("44_Limbo_Calls", "L4 Contracts", "Every message, event, service, window function and DOM id sent by live code, matched to a receiver.", "A call or message seems to do nothing.",
      "Limbo calls", "limbo.py — LIMBO rows have no receiver anywhere in live code (all frames scanned, comments excluded)",
      ["Call ID", "Kind", "Name", "Senders (file:line)", "Receivers (file:line)", "Verdict", "Note"], limbo_rows, [9, 20, 30, 50, 50, 40, 30])
for i, r in enumerate(limbo_rows):
    if r[5].startswith("LIMBO"):
        lmb_ws.cell(row=lmb_hr + 1 + i, column=6).fill = PatternFill("solid", fgColor="F4CCCC")
ATTEMPTS = [
    ("ATT-01", "2026-05-09", "Previous agent", "Journal", "Kill the journal's GL context (iframe → about:blank on close)", "Reverted (98c4819): slow load + broken journal", "d0f7895, 466fa8d → 98c4819", "Yes", "Journal must stay loaded."),
    ("ATT-02", "2026-05-26", "Previous agent", "Flora", "V2_FLORA_MAX_TREE_INSTANCES = 0", "Failed: ≤0 disables the cap → ~3M tris; reset to 260", "docs/INCIDENT_REPORT_2026_05_26.md", "Yes", "Never set the cap ≤ 0."),
    ("ATT-03", "2026-05-26", "Previous agent", "Repo", "git restore . && git clean -fd to 'clean' a bad agent's work", "Failed: destroyed the user's uncommitted work + 60 files", "docs/INCIDENT_REPORT_2026_05_26.md", "Yes", "No destructive git, ever."),
    ("ATT-04", "2026-05-29", "Previous agent", "Fishing", "Hide everything beyond 16 m while fishing", "Reverted (92a1163): tipis, trees, NPCs vanished; radius 70 m + exclusions", "92a1163", "Yes", "Fishing culling must be view-based only."),
    ("ATT-05", "2026-05-27", "Previous agent", "PiP", "Unthrottle PiP + semantic culling + hologram theme", "Partly reverted: hologram removed (47424db); tree culling undone (5bf2db8)", "049c9a1 → 47424db, 5bf2db8", "Yes", "Trees and bushes must show in the minimap in normal view."),
    ("ATT-06", "2026-05-28", "Previous agent", "Fishing", "Hide dial koi / player border / gauge rim while fishing", "Reverted (6204233) on user push-back", "6204233", "Yes", "Keep player border visible; recolour instead."),
    ("ATT-07", "2026-05-29", "Previous agent", "Maps", "Change the default map on load (scene0/scene1), force-reset localStorage", "Reverted 3× the same day", "a4fbc78, 5e06b8c → 15a7e16, c83d57c, 491295f", "Yes", "Ask the user before touching the default map."),
    ("ATT-08", "2026-05-29", "Previous agent", "Avatar", "Turn avatar 180° to fix start orientation", "Reverted", "9900df1", "Yes", ""),
    ("ATT-09", "2026-05-28", "Previous agent", "Pool", "Water clarity bundle + remove moss tufts", "Reverted", "de3c912 → d8ee422", "Yes", ""),
    ("ATT-10", "2026-05-30", "Previous agent", "Hex grid", "Gold 3D hex lines / invisible overlay", "Removed (a51037c) / reverted (58d4372); seams live in the terrain shader; SanctuaryHexGrid activation commented out", "a51037c, 58d4372", "Yes", "Do not reactivate SanctuaryHexGrid without asking."),
    ("ATT-11", "2026-05-31", "User directive", "Service worker", "Caching service worker", "Replaced by self-destruct kill switch on request", "53b7422", "Yes", "No caching without the user's OK (PLN-10)."),
    ("ATT-12", "2026-06-01", "Previous agent", "Mobile", "Second WebGL context for PiP on iOS", "Failed: context limit / blank screen; mobile uses main-context render target", "e377f7c", "Yes", "Never a 2nd WebGL context on mobile."),
    ("ATT-13", "2026-06-01", "Previous agent", "Mobile", "Full-scene geometry warm-up on mobile", "Failed: 'can't load WebGL'; skipped on mobile", "git log 2026-06-01", "Yes", ""),
    ("ATT-14", "2026-06-01", "Previous agent", "Mobile", "Cap mobile textures at 256 px at upload", "Worked: stopped iOS OOM", "git log 2026-06-01", "No", "Keep."),
    ("ATT-15", SESSION_1, "Claude", "Tooling", "Install Playwright Chromium to run the game headless", "Failed: browser download blocked by the network allowlist", "npx playwright install", "Yes", "Use static gates + offline raster checks here; runtime checks happen on the user's machine."),
    ("ATT-16", SESSION_1, "Claude", "Tooling", "Parse gltf-transform inspect CSV", "Failed: output is tables; replaced by glbjson.mjs (NodeIO)", "glbjson.mjs", "Yes", ""),
    ("ATT-17", SESSION_1, "Claude", "Previews", "Centroid-sampled preview of decimated models", "Misleading: big triangles looked blotchy; replaced by per-pixel raster.py", "raster.py", "Yes", ""),
    ("ATT-18", SESSION_1, "Claude", "Tooling", "Stub navigator by assignment in Node 22", "Failed silently (read-only global); use Object.defineProperty", "trace/m.cjs", "Yes", ""),
    ("ATT-19", SESSION_1, "Claude", "Limbo tracer", "Line-based regex over live code", "False positives: multi-line calls, comments, prose file, relay lists, nested frames; fixed", "limbo.py", "Yes", "Keep full-text + comment filter + relay lists + nested frames."),
    ("ATT-20", SESSION_1, "Claude", "REG", "REG lite with 1024 px textures", "Too heavy: 198 MB VRAM; 512 px → 66 MB", "lite.mjs", "Yes", ""),
    ("ATT-21", SESSION_1, "Claude", "REG + tipi", "Swap to lite models (PLN-01/02)", "Done in code; static gates + URL trace pass; not runtime-tested", "SanctuaryTipiNpcs.js, SanctuaryTipis.js, gltfLoaderSetup.js", "No", "Verify in browser: seats, scale, animation, mobile."),
    ("ATT-22", SESSION_1, "Claude", "PiP", "Remove PIP_FRAME, preserveDrawingBuffer false, skip fishing scan, cache light + time uniforms", "Done in code; not runtime-tested", "Orchestrator.js", "No", "Verify minimap holds its frame between strides."),
    ("ATT-23", SESSION_1, "Claude", "Fishing", "Gauge transmission → transparent standard material", "Done in code; visual check needed", "SanctuaryFishing.js", "No", "If the dial looks wrong, revert this one material only."),
    ("ATT-24", SESSION_1, "Coder 1", "PiP", "Line audit of Finding 2 + four new observations", "All claims re-verified by Claude", "CLM-16..20", "No", ""),
    ("ATT-25", SESSION_1, "Claude", "Fish", "Count fish.obj triangles with awk", "Wrong: CRLF line endings → 23,466; OBJLoader count is 15,644 (7,822 quads)", "FND-15", "Yes", "Count geometry with a real loader or the census, never awk on OBJ."),
    ("ATT-26", SESSION_1, "Claude", "Tooling", "Run sanctuary load() in Node via node_stage.mjs", "Worked after fixes: line-anchored import rewrite (comments derailed regex), Request/ProgressEvent/addEventListener/img-load stubs, console silenced for clean JSON", "node_stage.mjs, scene_census.mjs", "No", "Pool module is a singleton: reuse the first scene; run from repo root."),
    ("ATT-27", SESSION_1, "Claude", "Merge test", "Exact string compare of baked vertices", "Failed: float32 rounding flips; replaced by spatial-hash tolerance match (1e-4 m)", "test_mergeStatic.mjs", "Yes", ""),
    ("ATT-28", SESSION_1, "Claude", "Merge", "mergeStaticChildren on lilies, rocks, dock, turtle", "Worked in Node: 799 → 285 pond draws, identical geometry/colour; NOT yet in the game", "test_mergeStatic.mjs, test_mergeOthers.mjs", "No", "Ship via PLN-21 cards, one per commit."),
    ("ATT-29", SESSION_1, "Claude", "Merge", "mergeStaticChildren on frogs (tint as vertex colour, tongue/leg_ skipped)", "No gain: 160 → 160 (every part has its own material params)", "test_mergeOthers.mjs", "Yes", "Frogs need shared materials or BatchedMesh first (C-10 #3)."),
    ("ATT-30", SESSION_1, "Claude", "Tooling", "node glbjson.mjs Assets/flora/reeds.glb (input passed first)", "Damage: argv[2] is the OUTPUT — reeds.glb overwritten; restored with git checkout; guard added (refuses non-.json output)", "glbjson.mjs", "Yes", "Read a tool's usage line before running it on assets; check git status after."),
    ("ATT-31", SESSION_1, "Coder 1", "Tooling", "Run Playwright with the preinstalled /opt/pw-browsers/chromium (executablePath) + SwiftShader args", "Worked: game boots headless; ~6–13 frames per 3 s, so layout/geometry/network only", "tools/mobile/p0probe.js", "No", "Supersedes ATT-15 when a Chromium binary is present; never use for FPS claims."),
    ("ATT-32", SESSION_1, "Coder 1", "REG + tipi", "Runtime check of ATT-21 (lite swap) desktop + iPhone UA", "Lite + mobile GLBs load (200), REG seated with 6 clips; scene 4.12M → 1.62M desktop", "docs/mobile/phase0-measurements.json", "No", "Pose/scale by eye and real-phone memory still NEEDS DEVICE."),
    ("ATT-33", SESSION_1, "Coder 1", "Measurement", "First probe: two python http.servers on one port (old one never died)", "Invalid run: branch measured as main; caught by identical numbers", "—", "Yes", "Check which process owns the port (readlink /proc/PID/cwd) before every run."),
    ("ATT-34", SESSION_1, "Coder 1", "Mobile Phase 0", "Measure 6 profiles + online simulation (CDN → vendor, lucide stub)", "Done; findings in PHASE0_BASELINE.md", "docs/mobile/PHASE0_BASELINE.md", "No", "Sandbox (offline) runs hide the panel's 2nd WebGL context — always add the online simulation."),
    ("ATT-35", SESSION_1, "Coder 1", "Mobile Phase 1", "Replace 4 live UA copies with js/v2/deviceProfile.js", "Done; 66/66 equivalence; deterministic 6-profile measurements identical; override works both ways; npm test identical to base", "docs/mobile/PHASE1_REPORT.md", "No", ""),
    ("ATT-36", SESSION_1, "Coder 1", "Measurement", "Diff 'top-15 textures' across runs", "False difference: arbitrary picks at the 4 MB (1024^2) tie line", "docs/mobile/PHASE1_REPORT.md", "Yes", "Compare above-tie entries + size histogram; GPU allocation counts on phones depend on frames rendered (lazy upload)."),
    ("ATT-37", SESSION_AG, "Claude", "Governance", "Remove all Antigravity hooks (owner directive: Antigravity is no longer used after it attacked the codebase): ANTIGRAVITY_GOVERNANCE rule + its hardcoded-true check, .agents/workflows/agent_mesh_protocol.md (shared agent mailbox), test outputs written into ~/.gemini/antigravity/brain (now test-results/), BuildBadge name match", "Done; check:v2 passes; history (manifesto, tmp/ handoffs, commit log) kept as record", "AnuGovernanceRules.js, tests/v4-*.spec.js, BuildBadge.js", "No", "Do not re-add Antigravity rules, workflows or output paths."),
    ("ATT-38", SESSION_1, "Coder 1", "Mobile Phase 2", "Texture-only phone variants (Avatar-New, NPC.YB, reeds; 4096 -> 1024, byte-identical geometry) + panel ThreeIcons texture cap 512 + mobile avatar URL", "Done: panel 2nd context 172.2 -> 4.3 MB; phone source pixels 481 -> 121 MB; phone GLB 27.1 -> 16.6 MB; desktop identical; screenshots same", "docs/mobile/PHASE2_REPORT.md", "No", "Phone GPU cap 256 makes 1024 and 4096 sources upload identically — shrink sources, never geometry, for memory without visual loss."),
    ("ATT-39", SESSION_1, "Coder 1", "Antigravity B1", "Remove fake window.WorldPhysics (8127cc9); shim restored from 8127cc9^", "Done f7b21ae: physics checks now needs_attention (honest)", "fix/antigravity-damage f7b21ae", "No", ""),
    ("ATT-40", SESSION_1, "Coder 1", "Antigravity B2", "Remove pip-full-rate filter from 6 test checks (b01cc70)", "Done f1325b2: audit empty at stride 16; 7/8 tests fail for unrelated reasons (boot timing, deleted dial)", "fix/antigravity-damage f1325b2", "No", ""),
    ("ATT-41", SESSION_1, "Coder 1", "Antigravity B3", "HUD test: real triangle check (666eb11 pointed tri at #v2-draws twice)", "Done 59d8da4: regex on #v2-draws text", "fix/antigravity-damage 59d8da4", "No", "There is no separate triangle element; draws + tris share #v2-draws."),
    ("ATT-42", SESSION_1, "Coder 1", "Antigravity B4", "Restore test:v2 + test:fidelity in npm test (5756757)", "Done 30b1492: 5 pass, 3 fail (stride 6 vs 16, moondial, software-GPU minimap) — reported, not weakened", "fix/antigravity-damage 30b1492", "No", ""),
    ("ATT-43", SESSION_1, "Coder 1", "Antigravity B5", "Delete no-op pointer test (2f0c13c)", "Done 72462b3", "fix/antigravity-damage 72462b3", "No", ""),
    ("ATT-44", SESSION_1, "Coder 1", "Antigravity extra", "Restore hard moondial asserts weakened by 1dcb1a2", "Done ec9f260; Trees->Fauna kept (1a8bf37 signed Claude 05-19 turned Trees off in v2)", "fix/antigravity-damage ec9f260", "No", "Audit called Trees->Fauna a weakening; tracing showed it matched the build."),
    ("ATT-45", SESSION_1, "Coder 1", "Antigravity B6", "Remove turtle plastron re-added by 1f4e275", "Done 9464b76; rim + shell texture left for Mark (not in his recorded decision)", "fix/antigravity-damage 9464b76", "No", ""),
    ("ATT-46", SESSION_1, "Coder 1", "Antigravity B7", "Restore gauge needle, pivot cap, state label (11de75a)", "Done fe1f821; needle sweep read from the dial (full circle now)", "fix/antigravity-damage fe1f821", "No", ""),
    ("ATT-47", SESSION_1, "Coder 1", "Antigravity B8", "Fishing minimap back to full rate", "NOT DONE: the 'user spec' quote was added by bf0114e (unsigned, Antigravity window); both versions are Antigravity's -> Mark decides", "git log -S'very high resolution'", "No", "Check who wrote a 'user spec' comment before treating it as Mark's."),
    ("ATT-48", SESSION_1, "Coder 1", "Antigravity B9", "Top-down minimap obeys stride", "NOT DONE: 076bc3a (signed Claude 05-31) made Village View PiP true FPV every frame; stride 16 would stutter -> Mark decides", "076bc3a", "No", ""),
    ("ATT-49", SESSION_1, "Coder 1", "Antigravity B10", "Minimap cost back to pre-11de75a", "NOT DONE: lower quality on desktop; phones already use the 256 px RT path, so no phone gain -> Mark decides", "Orchestrator _ensureMobilePip CAP 256", "No", ""),
    ("ATT-50", SESSION_1, "Coder 1", "Antigravity B11", "Delete hollow PipOrthoRingDiskClip (b0b4575) + contract + 9 no-op call sites", "Done a6af4d6; minimap renders on phone + desktop", "fix/antigravity-damage a6af4d6", "No", "On a software GPU the governor bypasses the minimap (CRITICAL); call _renderPip() directly to test it."),
    ("ATT-51", SESSION_1, "Coder 1", "Antigravity B12", "Drop dead hex-grid import + registration (35f349c)", "Done 0887cb6; registry 43, file not fetched", "fix/antigravity-damage 0887cb6", "No", ""),
    ("ATT-52", SESSION_1, "Coder 1", "Antigravity B13/B14", "Unhide HUD module list; phones DPR 1.5 -> 1.0", "NOT DONE: both visible (43-line list on phones; softer phone render). Measured 3x iPhone: renderer 1.5, AnuAdaptiveDpr cap 1.0 -> snaps to 1.0 on first step. Mark decides", "index.html:446", "No", ""),
    ("ATT-53", SESSION_1, "Claude GRASS", "Flora / grass", "Photoreal meadow on the ground texture (js/sanctuary/SanctuaryGrass.js, 939aca5): 2 instanced rings on a camera-following world-locked grid, trimmed upright cards reclining toward a high camera, colour = terrain vertex colour x albedo mean x hex factor, trees' wind + clock, receive-only shadows, main camera only (minimap unchanged), keep-out mask", "Done: Mark's M1 Chrome synced render chase 61.7 vs 63.1 ms, Village View 68.4 vs 65.0 ms (grass on vs off); Village colour within 1-2 L of bare ground, chase 5-12% darker; NOT measured on an iPhone", "js/sanctuary/SanctuaryGrass.js", "No", "Kill switch ?grass=0. Anu SceneModelInventory counts it as 12 tris (plain Mesh, not InstancedMesh). Hex formula mirrors SanctuaryGround.js: change both."),
    ("ATT-54", SESSION_1, "Coder 1", "Mobile memory (Q21) / B14", "Phones render at deviceProfile.dprCap (1.0) instead of a hard 1.5 in index.html", "Done e636515 (Mark Q21: 'we need memory for mobiles'); iPhone 3x framebuffer 5.7 -> 2.5 MB", "fix/antigravity-damage e636515", "No", ""),
    ("ATT-55", SESSION_1, "Coder 1", "Mobile memory (Q21)", "Phone avatar 246k -> 100k tris (lite.mjs; 41 joints, 9 clips intact), 1024 px maps", "Done cdb3410: geometry buffers game 20.9 -> 15.4 MB, panel badge 11.7 -> 6.2 MB; close-up 1.76 % px differ", "docs/mobile/img/avatar_phone_246k_vs_100k.jpg", "No", "60k changed the mouth/face: rejected. 100k is the floor for looks."),
    ("ATT-56", SESSION_1, "Coder 1", "Pond (Q22) / B5", "Turtle on the visible floor + new carapace texture (top-down UVs, scutes, R=height G=roughness detail map)", "Done c728235: turtle was 0.8-1.4 m under the terrain (placed from the water line); now sanctuaryGroundY + 0.2 m; texture 6-9 ms", "docs/pond/img/turtle_*.jpg", "No", "SphereGeometry UVs wrap the dome; draw top-down only with remapped UVs. Avoid getImageData in boot-time canvas work (210-700 ms)."),
    ("ATT-57", SESSION_1, "Coder 1", "Fishing minimap (Q17) / A5", "Cull the fishing PiP to the ring; keep every other frame", "Done 8926a2e: draws were already ring-only (37 draws, 288k tris, 98 % koi); skipped the redundant whole-scene matrix update: CPU 1.2 -> 0.4 ms; A/B image identical", "fix/antigravity-damage 8926a2e", "No", "Pruning layer-2-free groups gave no gain. Phone cost is the 18 x 15.6k-tri koi: lighter minimap fish needs Mark."),
    ("ATT-58", SESSION_1, "Claude", "Input / panel", "FND-49: panel input relay no longer depends on unpkg lucide (04513fc): lucide removed, mouseup focus-return + mousedown CANVAS_CLICK moved unchanged into their own <script> that posts PANEL_INPUT_READY; #v4-panel-frame catches clicks only once .input-ready", "Done: Mark's Chrome (M1, online): ground click walked 4.1 m, focus back in game, 25/25 W keydowns reached game, P hide/show OK, without .input-ready the canvas gets the click, spoofed ready message ignored, panel buttons work, no lucide errors. Offline proven by researcher's input_probe.mjs (not re-run: no repo copies)", "SacredGame.Panel.html", "No", "Never put the input relay back inside a script block that can throw; never make #v4-panel-frame pointer-events:none permanently; keep .hidden after .input-ready."),
    ("ATT-59", SESSION_1, "Claude", "Culling", "CULL-01 (99b8876): pond trees/bushes/reeds split into 8 view-cullable sectors (splitIntoSectors), geometry+material shared", "Done: Mark's M1, probe colour pass facing away 947,047 -> 586,571 tris (-38%), flora 601,788 -> 241,440; facing pool -16%; Village unchanged (+27 calls); fingerprints identical; 4 wind materials; layer 1 kept", "js/sanctuary/SanctuaryPondTrees.js", "No", "Never re-merge the ring meshes; never clone the wind material per sector."),
    ("ATT-60", SESSION_1, "Claude", "Culling / Anu", "CULL-02 (fead86d): stress ladder also reads the real rAF interval (GPU time + vsync), ref max(targetMs, 1000/60)", "Done: unit test stock 2 FAIL -> 6/6 PASS; Mark's M1: OPTIMAL at 60 fps, CRITICAL (minimap held, shadows sampled) at ~29-46 ms frames, recovers. iPhone / Low Power Mode NOT checked", "js/v2/anu/FrameBudget.js", "No", "Below ~37 fps the minimap holds its frame by design; Low Power Mode 30 fps cap would hold it permanently."),
    ("ATT-64", SESSION_1, "Claude", "Compassionate UI / Village View", "Step 1 (a120832): Village View (top-down) pauses tree, leaf and grass wind (uWindOn / uGWindOn uniforms, tree clock stops), hides the pond fish (school, jumps, fishing-spot fish; fish AI skipped while hidden), minimap renders every 4th frame there (TOPDOWN_PIP_EVERY_N_FRAMES)", "Done: Mark's M1 Chrome, Village View 38.1 -> 55.4 fps; main pass 1.84M -> 1.50M tris (fish 342k); minimap 21.5 -> 13.8 updates/s. NOT measured on an iPhone", "js/sanctuary/SanctuaryCompassion.js, SanctuaryPondTrees.js, SanctuaryGrass.js, SanctuaryFish.js, js/v2/Orchestrator.js", "No", "Mark: stop all tree/leaf/grass animation in top-down, don't render the pond fish, minimap may update slower. Fish visibility is restored exactly (saved per object)."),
    ("ATT-65", SESSION_1, "Claude", "Compassionate UI / ladder", "Step 2 (d7360ef): the one controller's fps ladder sheds grass first: rung 1 far grass ring off, rung 2 grass off. Sensor = median real frame interval over 250 ms; down < 57 fps (0.5 s settle), up after 3 s >= 59 fps, bounce doubles the wait (max 30 s); 5 s boot and 1.5 s view-switch watch-only; hidden tabs / >= 250 ms frames ignored", "Done: Node simulation of the real module 25/25 (0.14 s step-down at 50 fps, hitch immunity, bounce backoff, kill switch). Mark's M1 chase main pass median: full 11-12 ms, far ring off 10.6 ms, grass off 9.4 ms", "js/sanctuary/SanctuaryCompassion.js, js/sanctuary/SanctuaryGrass.js", "No", "No throttling and no resolution change here (Mark). Next rungs: distant trees -> billboards. Kill switch ?compassion=0; runtime window.__sanctuaryCompassion.state()/log()/setLevel(n)/hold(b)."),
]
sheet("63_Attempts_Ledger", "L6 Plan", "What was tried, by whom, the result, and whether it must not be retried.", "Before trying a fix — check it has not already failed.",
      "Attempts ledger", "Shared by every agent: append a row for every attempt, success or failure",
      ["Attempt ID", "Date", "Agent", "Area", "What was tried", "Result", "Evidence", "Do not retry", "Lesson"], [list(a) for a in ATTEMPTS], [10, 11, 14, 14, 44, 50, 32, 9, 40])
find_rows = [[x["id"], x["sev"], x["sub"], x["title"], x["assumed"], x["verified"], x["evidence"], x["impact"], x["fix"], x["effort"], x["plan"], x["status"]] for x in FINDINGS]
fnd_ws, fnd_hr = sheet("50_Findings", "L5 Evidence", "Forensic findings: assumed vs verified, file:line evidence, fix, plan link.", "Prioritising work; proving a claim.",
                       "Findings", "Evidence line numbers are re-located by regex at every build; 'NOT FOUND' means the code moved",
                       ["Finding ID", "Severity", "Subsystem", "Finding", "Assumed", "Verified (mechanical)", "Evidence (file:line)", "Impact", "Fix", "Effort", "Plan step", "Status"],
                       find_rows, [10, 9, 9, 34, 40, 52, 48, 34, 44, 7, 9, 26])
for i, x in enumerate(FINDINGS):
    fnd_ws.cell(row=fnd_hr + 1 + i, column=2).fill = PatternFill("solid", fgColor=SEV_FILL[x["sev"]])
ast_ws, ast_hr = sheet("51_Assets", "L5 Evidence", "Measured geometry and textures of every live 3D asset, boot totals, and lite variants.", "Any GPU memory or triangle question.",
                       "Assets", "Measured with glbjson.mjs (gltf-transform + Draco decode); VRAM = w×h×4×1.333 per context",
                       ASSET_HEAD, asset_rows, [8, 46, 8, 12, 10, 12, 10, 10, 8, 10, 8, 7, 9, 22, 40, 30, 10, 12, 9, 30, 10, 9, 12])
a_last = ast_hr + len(asset_rows)
for i in range(len(asset_rows)):
    r = ast_hr + 1 + i
    ast_ws.cell(row=r, column=6, value=f"=D{r}*E{r}").font = B_FONT
    ast_ws.cell(row=r, column=18, value=f'=IF(Q{r}="","",Q{r}*E{r})').font = B_FONT
    for c in (4, 6, 17, 18, 21):
        ast_ws.cell(row=r, column=c).number_format = "#,##0"
# totals row
tr = a_last + 2
ast_ws.cell(row=tr, column=2, value="Boot totals (desktop, default map; procedural geometry excluded)").font = Font(name=FONT, bold=True, size=10)
ast_ws.cell(row=tr, column=6, value=f"=SUM(F{ast_hr + 1}:F{a_last})").number_format = "#,##0"
ast_ws.cell(row=tr, column=10, value=f'=SUMPRODUCT((C{ast_hr + 1}:C{a_last}="Yes")*J{ast_hr + 1}:J{a_last})').number_format = "#,##0.0"
ast_ws.cell(row=tr + 1, column=2, value="Boot triangles BEFORE PLN-01 + PLN-02 (original REG + tipi)").font = Font(name=FONT, bold=True, size=10)
ast_ws.cell(row=tr + 1, column=6, value=f'=F{tr}-SUMPRODUCT((Q{ast_hr + 1}:Q{a_last}<>"")*(F{ast_hr + 1}:F{a_last}))+SUM(R{ast_hr + 1}:R{a_last})').number_format = "#,##0"
ast_ws.cell(row=tr + 2, column=2, value="Texture VRAM BEFORE PLN-01 + PLN-02 (MB)").font = Font(name=FONT, bold=True, size=10)
ast_ws.cell(row=tr + 2, column=10, value=f'=J{tr}-SUMPRODUCT((S{ast_hr + 1}:S{a_last}<>"")*(C{ast_hr + 1}:C{a_last}="Yes")*J{ast_hr + 1}:J{a_last})+SUMPRODUCT((C{ast_hr + 1}:C{a_last}="Yes")*(S{ast_hr + 1}:S{a_last}<>"")*N(+S{ast_hr + 1}:S{a_last}))').number_format = "#,##0.0"
for rr in (tr, tr + 1, tr + 2):
    for c in (6, 10):
        ast_ws.cell(row=rr, column=c).font = Font(name=FONT, bold=True, size=10)
ast_ws.cell(row=tr, column=6).comment = Comment("Sum of measured triangles × instances placed at boot. Instances come from code constants cited in column O.", "Claude")

clm_rows = [list(c) for c in CLAIMS]
sheet("52_Claims_vs_Verified", "L5 Evidence", "Statements in docs/comments checked against the code.", "Before trusting any comment or doc.",
      "Claims vs verified", "Zero-trust ledger — Stale/Contradicted rows must not be relied on",
      ["Claim ID", "Source", "Claim (assumed)", "Mechanical verification", "Verdict", "Evidence"], clm_rows, [9, 26, 44, 56, 14, 44])
pln_ws, pln_hr = sheet("60_Plan", "L6 Plan", "Ordered optimisation plan tied to findings and files, with acceptance tests and status.", "Deciding the next step; updating progress.",
                       "Plan", "Status is a dropdown — update it as work lands",
                       ["Plan ID", "Order", "Step", "Findings", "Files to change", "Acceptance test", "Status", "Notes"],
                       [list(p) for p in PLAN], [9, 6, 34, 16, 60, 52, 13, 44])
dv = DataValidation(type="list", formula1='"Not started,In progress,Blocked,Awaiting approval,Done (code) — verify in browser,Done"', allow_blank=False)
pln_ws.add_data_validation(dv)
dv.add(f"G{pln_hr + 1}:G{pln_hr + len(PLAN)}")
for i, p in enumerate(PLAN):
    if "approval" in p[7].lower():
        pln_ws.cell(row=pln_hr + 1 + i, column=7, value="Awaiting approval")
sheet("61_Decision_Log", "L6 Plan", "Why each choice was made, the evidence, and how it was verified.", "Repeating an error; revisiting a choice.",
      "Decision log", "How decisions were made in this work",
      ["Decision ID", "Decision", "Reason", "How verified", "Related"], [list(d) for d in DECISIONS], [10, 44, 52, 52, 16])
sheet("62_Review_Playbook", "L6 Plan", "Symptom → where to cut in → mechanical check → last result.", "A known symptom reappears.",
      "Mechanical review playbook", "Zero-trust: run the check, do not trust the last result blindly",
      ["Review ID", "Symptom", "Subsystem", "Penetration point", "Mechanical check", "Last result"], [list(p) for p in PLAYBOOK], [9, 30, 9, 40, 70, 44])
LOG = [
    ("LOG-01", SESSION_1, "Cloned repos; identified SacredAdventures as the game; wrote claude/game-briefing.md to the project.", "Done", ""),
    ("LOG-02", SESSION_1, "Forensic pass on ANU + render loop (Orchestrator, anu/*, AnuAdaptiveDpr, module updates).", "Done", "50_Findings"),
    ("LOG-03", SESSION_1, "Measured every live GLB (tris, textures, VRAM).", "Done", "51_Assets"),
    ("LOG-04", SESSION_1, "Started 'ANU Performance Forensic' doc; filled Bottom line + PiP sections. Bottom-line numbers (3.6M, 74%) predate fish.obj measurement — correct to 4.03M / 66%.", "In progress", "Doc sections 2,3,5–9 pending"),
    ("LOG-05", SESSION_1, "Built NPC.REG lite/mobile and tipi lite/mobile; verified rig + previews; delivered files.", "Done", "PLN-01, PLN-02"),
    ("LOG-06", SESSION_1, "Built this Decision Engine workbook from extract.py output.", "Done", "00_Index"),
    ("LOG-07", SESSION_1, "Coder 1 report on Finding 2 received; every claim re-verified (CLM-16..20).", "Done", "52_Claims_vs_Verified"),
    ("LOG-08", SESSION_1, "Built limbo.py tracer; found journal commands, GENERATE SCENE steps and PiP toggle in limbo.", "Done", "44_Limbo_Calls"),
    ("LOG-09", SESSION_1, "Applied PLN-01/02 (lite REG + tipi), PiP quick wins and gauge material swap. Static gates pass; not runtime-tested (no browser here).", "Done (code)", "60_Plan"),
    ("LOG-10", SESSION_1, "NEXT: in-browser check of the swap and fishing view; decide DPR floor; PLN-17 journal routing; finish forensic doc.", "Next", ""),
    ("LOG-11", SESSION_1, "Line-by-line pass over pool, fish, fishing, frogs, dock, circles; Node scene census (799 pond draws); merge helper proven (→ 285).", "Done", "FND-32..44, ATT-25..30"),
    ("LOG-12", SESSION_1, "Wrote 'Pool & Fishing Optimization — Coder Playbook' with change cards C-01..C-10, research ranking and verification protocol; added patchcheck.mjs and census_pre.mjs.", "Done", "PLN-21"),
    ("LOG-13", SESSION_1, "NEXT: owner decisions in C-10; Coder 1 applies C-01..C-09 one per commit; browser checks per playbook section 'How to prove each change'.", "Next", "PLN-21"),
    ("LOG-14", SESSION_1, "Coder 1: Sacred Ones logo in loading modal, welcome guide (sized to tip height), FPS HUD; fluid loading modal + guide (320–1280 + landscape).", "Done", "commit 8d1570e"),
    ("LOG-15", SESSION_1, "Coder 1: wrote MOBILE_OPTIMIZATION_PROMPT.md (7 phases, zero-trust).", "Done", "Downloads handoff folder"),
    ("LOG-16", SESSION_1, "Coder 1: Mobile Phase 0 baseline measured and written.", "Done", "PLN-22; docs/mobile/PHASE0_BASELINE.md"),
    ("LOG-17", SESSION_1, "NEXT: Mark's go-ahead for mobile Phase 1; decide whether Phase 2 may touch js/components/Component.ThreeIcons.js + SacredGame.Panel.html; coordinate Avatar mobile variant with PLN-20.", "Next", ""),
    ("LOG-18", SESSION_1, "Coder 1: Mobile Phase 1 done — js/v2/deviceProfile.js is the single 'is mobile' source.", "Done", "PLN-23; docs/mobile/PHASE1_REPORT.md"),
    ("LOG-19", SESSION_1, "NEXT: Mobile Phase 2 (approved: may edit Component.ThreeIcons.js + SacredGame.Panel.html; Coder 1 makes the avatar mobile variant; beauty first). Then Phase 3+, then pond cards.", "Next", ""),
    ("LOG-20", SESSION_AG, "Anu falsification review (ANU_FALSIFICATION_REVIEW.md in the handoff folder): behaviour defects in DPR control, frame timing, fuzzy scores and alerts; always-true and dead checks.", "Done (review)", "ANU_FALSIFICATION_REVIEW.md"),
    ("LOG-21", SESSION_AG, "Removed every Antigravity hook from code, tests and agent workflows (ATT-37).", "Done (code)", "63_Attempts_Ledger"),
    ("LOG-22", SESSION_1, "Coder 1: Mobile Phase 2 done (b56549a code + report).", "Done", "PLN-24; docs/mobile/PHASE2_REPORT.md"),
    ("LOG-23", SESSION_1, "NEXT: Coder 1 starts FIX_ANTIGRAVITY_DAMAGE_PROMPT (Phase A questions to Mark, Phase B fixes) on fix/antigravity-damage.", "Next", ""),
    ("LOG-24", SESSION_1, "Coder 1: Antigravity repair on fix/antigravity-damage — B1-B7, B11, B12 + 1dcb1a2 test fix committed and pushed; B8-B10, B13, B14 moved to Mark after tracing.", "Done", "ATT-39..52"),
    ("LOG-25", SESSION_1, "NEXT: Mark answers Q1-Q16 + new questions (minimap rates, HUD list, phone DPR, turtle rim/shell); then mobile Phase 3.", "Next", ""),
    ("LOG-26", SESSION_1, "Claude GRASS: photoreal meadow committed (939aca5: SanctuaryGrass.js + 3 lines in index.html); claim released in tmp/handoff.md and LOCKS.md.", "Done", "ATT-53; project doc claude/grass-module.md"),
    ("LOG-27", SESSION_1, "Coder 1: Q21 phone memory (e636515, cdb3410), Q22 turtle (c728235), Q17 fishing minimap (8926a2e) committed and pushed. Found: a72ef50's x1.18 basin floor/drain/rocks lie under the terrain (Mark decides). LOG-26/ATT-53 reserved for the grass rows at merge.", "Done", "ATT-54..57"),
    ("LOG-28", SESSION_1, "Claude: FND-49 click/keyboard fix committed (04513fc); claim released in tmp/handoff.md and LOCKS.md.", "Done", "ATT-58; project doc claude/fix-fnd-49-input-relay.md"),
    ("LOG-29", SESSION_1, "Claude: CULL-01 (99b8876) and CULL-02 (fead86d) committed; M1 baseline 60 fps when uncontended, 3.5 MP canvas is GPU-tight (17-19 ms); Welcome Guide backdrop blur costs ~9 fps.", "Done", "ATT-59, ATT-60"),
    ("LOG-31", SESSION_1, "Claude: Compassionate UI steps 1-2 committed (a120832 Village View wind/fish/minimap, d7360ef grass ladder). ATT-61..63 / LOG-30 are Coder 1's reserved rows.", "Done", "ATT-64, ATT-65"),
]
sheet("70_Session_Log", "L7 Session", "What was done, in order, and the next step.", "Resuming work.", "Session log", "Newest last",
      ["Log ID", "Date", "What", "State", "Pointer"], [list(l) for l in LOG], [8, 11, 90, 11, 30])
sheet("90_Glossary", "Reference", "Terms used across the workbook.", "An unfamiliar term.", "Glossary", "", ["Term", "Meaning"],
      [list(g) for g in GLOSSARY], [30, 100])

# ── 10_System content ──
sys_ws["A1"] = "System facts"; sys_ws["A1"].font = TITLE_FONT
sys_ws["A2"] = "Counts and totals are formulas over the deeper sheets; inputs from code are cited"; sys_ws["A2"].font = SUB_FONT
for c, h in enumerate(["Fact", "Value", "Source / formula basis"], 1):
    cell = sys_ws.cell(row=4, column=c, value=h); cell.font, cell.fill = H_FONT, H_FILL
M = f"'30_Modules'!$E${mod_hr + 1}:$E${mod_last}"
facts = [
    ("Repository commit", SYS["commit"], "git rev-parse --short HEAD at build"),
    ("Workbook built", AS_OF, "build_engine.py"),
    ("Live entry page", "index.html", ev("index.html", r"new SacredOrchestrator\(canvas\)")),
    ("Legacy entry page", "index.v2.html (linked from launch.html)", ev("launch.html", r"index\.v2\.html")),
    ("Files tracked in 30_Modules", f"=COUNTA('30_Modules'!$A${mod_hr + 1}:$A${mod_last})", "30_Modules"),
    ("Active modules", f'=COUNTIF({M},"Active")', "30_Modules status"),
    ("Imported libraries (no lifecycle)", f'=COUNTIF({M},"Imported library (no module lifecycle)")', "30_Modules status"),
    ("Registered, activation commented out", f'=COUNTIF({M},"Registered, activation commented out")', "30_Modules status"),
    ("Legacy v2 build only", f'=COUNTIF({M},"Legacy v2 build only (index.v2.html)")', "30_Modules status"),
    ("Unreferenced by any entry page", f'=COUNTIF({M},"Unreferenced by any entry page")', "30_Modules status"),
    ("Boot triangles (desktop, measured assets)", f"='51_Assets'!F{tr}", "51_Assets totals"),
    ("Boot texture VRAM est. (MB, per context)", f"='51_Assets'!J{tr}", "51_Assets totals"),
    ("WebGL contexts on desktop", 2, ev(O, r"this\._pipRenderer = new THREE\.WebGLRenderer")),
    ("Calls with no live receiver (limbo)", f'=COUNTIF(\'44_Limbo_Calls\'!$F$5:$F${4 + len(LIMBO)},"LIMBO*")', "44_Limbo_Calls"),
    ("Boot triangles before PLN-01 + PLN-02", f"='51_Assets'!F{tr + 1}", "51_Assets totals"),
    ("Texture VRAM before PLN-01 + PLN-02 (MB)", f"='51_Assets'!J{tr + 2}", "51_Assets totals"),
    ("Triangles removed by PLN-01 + PLN-02", f"='51_Assets'!F{tr + 1}-'51_Assets'!F{tr}", "difference"),
    ("Live globals (window.*)", f"=COUNTA('41_Globals'!$A$5:$A${4 + len(GLOB_ROWS)})", "41_Globals"),
    ("ANU events with a live subscriber", f'=COUNTIF(\'42_Events\'!$F$5:$F${4 + len(EVENT_ROWS)},"Live round trip")', "42_Events"),
    ("Open findings (Critical + High)", f'=COUNTIF(\'50_Findings\'!$B$5:$B${4 + len(FINDINGS)},"Critical")+COUNTIF(\'50_Findings\'!$B$5:$B${4 + len(FINDINGS)},"High")', "50_Findings"),
    ("Plan steps done (incl. code-done awaiting browser check)", f'=COUNTIF(\'60_Plan\'!$G$5:$G${4 + len(PLAN)},"Done*")&" of "&COUNTA(\'60_Plan\'!$A$5:$A${4 + len(PLAN)})', "60_Plan status"),
    ("PiP stride baseline / max", "16 / 22", evs(("js/v2/constants.js", r"V2_PIP_RENDER_EVERY_N_FRAMES ="), ("js/v2/constants.js", r"V2_ADAPTIVE_PIP_MAX_STRIDE ="))),
    ("Target FPS constant", 65, ev("js/v2/constants.js", r"V2_TARGET_FPS =")),
    ("Main renderer DPR cap (desktop / mobile)", "1.5 / 1.0", ev(O, r"setPixelRatio\(Math\.min\(window\.devicePixelRatio, this\._isMobile")),
    ("Save key (localStorage)", "v4.sanctuary.save", ev("js/sanctuary/SanctuaryControls.js", r"v4\.sanctuary\.save")),
]
for r, (k, v, s) in enumerate(facts, 5):
    for c, val in enumerate((k, v, s), 1):
        cell = sys_ws.cell(row=r, column=c, value=val); cell.font, cell.alignment, cell.border = B_FONT, WRAP, BORDER
    if isinstance(v, str) and v.startswith("="):
        sys_ws.cell(row=r, column=2).number_format = "#,##0"
sys_ws.column_dimensions["A"].width = 44; sys_ws.column_dimensions["B"].width = 34; sys_ws.column_dimensions["C"].width = 70
sys_ws.freeze_panes = "A5"

# ── 00_Index ──
idx["A1"] = "Sacred Adventures — Decision Engine"; idx["A1"].font = Font(name=FONT, bold=True, size=16, color="3E2C23")
idx["A2"] = (f"Layered map of the live system for AI and humans. Read top-down: each level is more exact than the last. "
             f"Built {AS_OF} at commit {SYS['commit']}. Zero-trust: 'Assumed' = comments/docs, 'Verified' = measured.")
idx["A2"].font = SUB_FONT
idx.merge_cells("A2:E2"); idx["A2"].alignment = WRAP; idx.row_dimensions[2].height = 42
for c, h in enumerate(["Sheet", "Level", "What it holds", "Read it when", "Rows"], 1):
    cell = idx.cell(row=4, column=c, value=h); cell.font, cell.fill = H_FONT, H_FILL
order = ["10_System", "11_Boot_Sequence", "12_Frame_Loop", "20_Subsystems", "30_Modules", "40_Connections", "41_Globals",
         "42_Events", "43_Services", "44_Limbo_Calls", "50_Findings", "51_Assets", "52_Claims_vs_Verified", "60_Plan", "61_Decision_Log",
         "62_Review_Playbook", "63_Attempts_Ledger", "70_Session_Log", "90_Glossary"]
meta = {s[0]: s for s in SHEETS}
for r, name in enumerate(order, 5):
    _, level, purpose, when = meta[name]
    cell = idx.cell(row=r, column=1, value=name)
    cell.hyperlink = f"#'{name}'!A1"; cell.font = LINK_FONT
    for c, v in enumerate((level, purpose, when), 2):
        x = idx.cell(row=r, column=c, value=v); x.font, x.alignment, x.border = B_FONT, WRAP, BORDER
    rows_formula = "—" if name == "10_System" else f"=COUNTA('{name}'!A5:A2000)"
    idx.cell(row=r, column=5, value=rows_formula).font = B_FONT
idx.column_dimensions["A"].width = 24; idx.column_dimensions["B"].width = 14
idx.column_dimensions["C"].width = 62; idx.column_dimensions["D"].width = 40; idx.column_dimensions["E"].width = 8
base = 5 + len(order) + 1
rules = [
    ("ID scheme", "SUB- subsystem · MOD- file · AST- asset · EDG- edge · GLB- global · EVT- event · SVC- service · LMB- limbo call · FND- finding · CLM- claim · PLN- plan · DEC- decision · RVW- review · ATT- attempt · LOG- session."),
    ("How to navigate", "Problem → 62_Review_Playbook (symptom) → 50_Findings (evidence) → 30_Modules (file + connections) → 40_Connections (blast radius) → 60_Plan."),
    ("Update protocol", "Before a fix: check 63_Attempts_Ledger. After any code change: rerun tools/decision-engine/rebuild.sh, search for 'NOT FOUND', update 60_Plan, append to 63_Attempts_Ledger and 70_Session_Log."),
    ("Repo rules that bind edits", "Scope lock (name files + reason before editing) · never obscure #pipCanvas / PiP without explicit approval · no destructive git."),
    ("Not measured here", "Runtime FPS, GPU timings, real draw calls: no browser ran in this environment. Those cells say 'est.' or 'not profiled'."),
]
for i, (k, v) in enumerate(rules):
    a = idx.cell(row=base + i, column=1, value=k); a.font = Font(name=FONT, bold=True, size=10)
    b = idx.cell(row=base + i, column=2, value=v); b.font, b.alignment = B_FONT, WRAP
    idx.merge_cells(start_row=base + i, start_column=2, end_row=base + i, end_column=5)
    idx.row_dimensions[base + i].height = 30
idx.freeze_panes = "A5"

wb._sheets = [wb[n] for n in ["00_Index"] + order]
wb.save(OUT)
print("saved", OUT, "modules", len(mod_rows), "edges", len(EDGE_ROWS), "globals", len(GLOB_ROWS), "events", len(EVENT_ROWS))
notfound = [x for x in [f["evidence"] for f in FINDINGS] + [c[5] for c in CLAIMS] + [p[3] for p in PLAYBOOK] + [b[6] for b in BOOT_ROWS] + [l[3] for l in LOOP_ROWS] if "NOT FOUND" in x]
print("NOT FOUND evidence:", notfound)
