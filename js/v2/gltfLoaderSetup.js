/**
 * Shared Draco decoder for GLTFLoader (Avatar + legacy ThreeIcons guide meshes).
 * Decoder WASM is loaded from the local bundled vendor copy so compressed glTF works offline.
 *
 * Phase 2 of the May-19 2026 FPS refactor (then aimed at 120 FPS; the target is now 60 FPS): use the full CPU
 * for parallel Draco decoding, and preload the decoder WASM during
 * boot so the first GLB doesn't pay the wasm-fetch cost mid-load.
 */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { deviceProfile } from "./deviceProfile.js";

const DRACO_DECODER_PATH =
  "./vendor/three/examples/jsm/libs/draco/gltf/";

let _dracoLoader = null;

export function getSharedDRACOLoader() {
  if (!_dracoLoader) {
    _dracoLoader = new DRACOLoader();
    _dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    // Use all logical cores (capped at 4 to leave headroom for the
    // main thread + render thread). Default is 1 worker, which
    // serialised every GLB's Draco decode — the Chrome perf trace
    // flagged 1.3 s of GLB decode time on the critical path.
    const workers = Math.min(4, Math.max(1, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 2));
    _dracoLoader.setWorkerLimit(workers);
    // Preload the decoder WASM + JS now (not on first GLB). Returns a
    // promise we don't await — workers spin up in parallel with the
    // rest of boot.
    try { _dracoLoader.preload(); } catch (_) { /* best effort */ }
    console.log(
      `%c[gltfLoaderSetup] Draco workers = ${workers} · decoder preload started`,
      "color:#80deea;font-weight:bold;",
    );
  }
  return _dracoLoader;
}

// ── MOBILE low-poly GLB variants ──────────────────────────────────────────
// Heavy Tripo GLBs (avatar ~2M tris, NPCs/tipis 1–2M each) OOM-kill the mobile
// GPU process at render. `scripts/decimate-mobile-assets.mjs` produced weld+
// meshopt-simplified `<name>.mobile.glb` copies (3–5× fewer triangles). On
// mobile we transparently swap any of these filenames to its `.mobile.glb`
// sibling at load time — every module using this loader benefits, no per-module
// edits. Desktop always loads the full-detail originals.
// Two kinds of variant live here:
//  - decimated (fewer triangles): REG, tipis, BHG, ...
//  - texture-only (mobile Phase 2, tools/mobile/texonly-variant.mjs): NPC.YB,
//    reeds. Geometry, rig and clips are byte-identical to the original;
//    only the embedded maps are 1024 px instead of 4096 px.
//  - Avatar-New.mobile.glb (2026-10-22, Q21 "we need memory for mobiles"):
//    100k tris instead of 246k (tools/decision-engine/lite.mjs; 41 joints and
//    9 clips intact, skincheck clean) + 1024 px maps. Close-up comparison:
//    docs/mobile/img/avatar_phone_246k_vs_100k.jpg. On mobile the
//    renderer uploads every texture at <= 256 px anyway (Orchestrator's
//    maxTextureSize cap), so the on-screen result is the same; the variant only
//    removes the 4096 px download + decode.
// Every entry must be the basename the LIVE code actually requests — a name that is
// never requested is a silent no-op (tipi.yellowbutterfly-compressed.glb below is
// requested by nothing in index.html's import graph; kept for the legacy v2 build).
const MOBILE_GLB_VARIANTS = new Set([
  "NPC.REG.lite.glb",              // PLN-01 → NPC.REG.lite.mobile.glb (31k tris, 256 px)
  "tipi.yellowbutterfly.lite.glb", // PLN-02 → tipi.yellowbutterfly.lite.mobile.glb (15k tris, 1024 px)
  "Avatar-New.glb",                // phone: 100k tris + 1024 px maps (11.4 → 2.5 MB)
  "NPC.YB.glb",                    // mobile Phase 2 → texture-only, 1024 px maps (3.0 → 1.25 MB)
  "reeds.glb",                     // mobile Phase 2 → texture-only, 1024 px map (0.75 → 0.34 MB)
  "tipi.player.glb",
  "tipi.yellowbutterfly-compressed.glb",
  "NPC.BHG.glb",
  "TraderJosh3d.glb",
  "Buffalo.glb",
  "animated.stag.glb",
]);

/**
 * A weak desktop or very slow device (master prompt C3, Mark 2026-10-22) loads the same light
 * variants as phones: the quality budget "low" (testing bar, window.SacredQuality) or, until
 * that exists, the device check's tier 0 / 2 (window.SacredDeviceCheck). Assets requested
 * before the check has run still load in full.
 */
/** ?tier=0..3 from the page URL (same switch as the device check), or null. */
function urlTier() {
  try {
    const v = new URLSearchParams(window.location.search).get("tier");
    return v !== null && /^[0-3]$/.test(v) ? Number(v) : null;
  } catch (_) { return null; }
}
function lowBudgetDesktop() {
  if (typeof window === "undefined") return false;
  const q = window.SacredQuality;
  if (q && typeof q.budget === "string") return q.budget === "low";
  const t = window.SacredDeviceCheck && Number.isFinite(window.SacredDeviceCheck.tier)
    ? window.SacredDeviceCheck.tier
    : urlTier();
  return t === 0 || t === 2;
}

/** On mobile (or a low-budget desktop), rewrite `…/X.glb` → `…/X.mobile.glb` for known heavy assets. */
export function mobileGlbUrl(url) {
  if (typeof url !== "string" || !(deviceProfile.isMobile || lowBudgetDesktop())) return url;
  const base = url.split("/").pop().split("?")[0];
  if (MOBILE_GLB_VARIANTS.has(base)) {
    return url.replace(/\.glb(\?|$)/i, ".mobile.glb$1");
  }
  return url;
}

/** Same constructor shape as GLTFLoader; attaches Draco so compressed glTF works. */
export class GLTFLoaderWithDraco extends GLTFLoader {
  constructor(manager) {
    super(manager);
    this.setDRACOLoader(getSharedDRACOLoader());
  }
  // Swap heavy GLBs for their decimated mobile variants. load() is the single
  // funnel for both load() and loadAsync(), so this covers every caller.
  load(url, onLoad, onProgress, onError) {
    return super.load(mobileGlbUrl(url), onLoad, onProgress, onError);
  }
}
