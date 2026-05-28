/**
 * PiP ortho minimap (#pipCanvas): simplified to a standard simple camera pass.
 * Disables custom shader compiling/discard checks to restore solid rendering performance.
 */
import * as THREE from "three";
import { registerRuntimeService } from "../RuntimeServices.js";

let _registered = false;

const _uniforms = {
  uPipRingClip: { value: 0 },
  uPipRingCen: { value: new THREE.Vector2() },
  uPipRingRad2: { value: 0 },
  uPipSmokeRingRad2: { value: 0 },
};

export function getPipOrthoRingDiskUniforms() {
  return _uniforms;
}

export function armPipOrthoRingDisk(w, h) {
  return false;
}

export function clearPipOrthoRingDisk() {
  // No-op
}

export function installMeshMaterialPipRingDiskClip(material, uniforms = _uniforms) {
  // No-op
}

export function applyPipOrthoRingDiskClipToSubtree(root) {
  // No-op
}

export function installPointsShaderMaterialPipRingDiskClip(material, uniforms = _uniforms, smokeExtended = false) {
  // No-op
}

export function ensurePipOrthoRingClipRuntimeServiceRegistered() {
  if (_registered) return;
  _registered = true;
  registerRuntimeService(
    "PipOrthoBranchClip",
    Object.freeze({
      armOrthoClip(w, h) {
        return false;
      },
      clearOrthoClip() {
        // No-op
      },
    }),
    { owner: "PipOrthoRingDiskClip" },
  );
}

