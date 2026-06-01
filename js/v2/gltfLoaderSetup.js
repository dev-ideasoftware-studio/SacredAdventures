/**
 * Shared Draco decoder for GLTFLoader (Avatar + legacy ThreeIcons guide meshes).
 * Decoder WASM is loaded from the local bundled vendor copy so compressed glTF works offline.
 *
 * Phase 2 of the 120-FPS refactor (May-19 2026): use the full CPU
 * for parallel Draco decoding, and preload the decoder WASM during
 * boot so the first GLB doesn't pay the wasm-fetch cost mid-load.
 */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

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
// Only assets with a BIG triangle win AND a small decimated file. Excluded:
// NPC.REG (skipped on mobile in SanctuaryTipiNpcs — too heavy to ship), and
// Avatar-New / Avatar3 / pond1 / tree / rock.mossy / NPC.YB (already low-poly or
// texture-bound files where the geometry win doesn't justify the download).
const MOBILE_GLB_VARIANTS = new Set([
  "tipi.player.glb",
  "tipi.yellowbutterfly-compressed.glb",
  "NPC.BHG.glb",
  "TraderJosh3d.glb",
  "Buffalo.glb",
  "animated.stag.glb",
]);

function _isMobileUA() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
  return (
    /Mobi|Android|iPhone|iPod/i.test(ua) ||
    /iPad/i.test(ua) ||
    (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)
  );
}

/** On mobile, rewrite `…/X.glb` → `…/X.mobile.glb` for known heavy assets. */
export function mobileGlbUrl(url) {
  if (typeof url !== "string" || !_isMobileUA()) return url;
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
