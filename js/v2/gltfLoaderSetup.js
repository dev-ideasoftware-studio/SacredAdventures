/**
 * Shared Draco decoder for GLTFLoader (Avatar + legacy ThreeIcons guide meshes).
 * Decoder WASM is loaded from Google's CDN (matches three.js DRACOLoader expectations).
 */
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const DRACO_DECODER_PATH =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";

let _dracoLoader = null;

export function getSharedDRACOLoader() {
  if (!_dracoLoader) {
    _dracoLoader = new DRACOLoader();
    _dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
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
