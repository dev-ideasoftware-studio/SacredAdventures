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
  "./WORDPRESS/vendor/three/examples/jsm/libs/draco/gltf/";

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

/** Same constructor shape as GLTFLoader; attaches Draco so compressed glTF works. */
export class GLTFLoaderWithDraco extends GLTFLoader {
  constructor(manager) {
    super(manager);
    this.setDRACOLoader(getSharedDRACOLoader());
  }
}
