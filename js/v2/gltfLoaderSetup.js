/**
 * Shared Draco decoder for GLTFLoader (Avatar + legacy ThreeIcons guide meshes).
 * Decoder WASM is loaded from the local bundled vendor copy so compressed glTF works offline.
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
