/**
 * PiP ortho minimap (#pipCanvas): discard fragments whose gl_FragCoord lies inside the
 * circular glass aperture disk (`V2_PIP_GLASS_DISK_CLIP_RADIUS_FACTOR` × min(w,h)).
 * Tipi **smoke** uses a **larger** discard disk (`V2_PIP_SMOKE_DISK_CLIP_RADIUS_FACTOR`) so
 * billowing particles stay off the minimap when ortho clip is armed.
 * The yellow dashed overlay ring is smaller and UX-only (`V2_PIP_OVERLAY_BRANCH_CLIP_RADIUS_FACTOR`).
 * Armed only during `SacredOrchestrator._renderPip()` orthographic pass.
 */
import * as THREE from "three";
import {
  V2_PIP_GLASS_DISK_CLIP_RADIUS_FACTOR,
  V2_PIP_SMOKE_DISK_CLIP_RADIUS_FACTOR,
} from "../constants.js";
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

/** @returns {boolean} true when clip uniforms armed (Orchestrator must clear after ortho render) */
export function armPipOrthoRingDisk(w, h) {
  if (!(w >= 16) || !(h >= 16)) return false;
  const scale = Math.min(w, h);
  const r = scale * V2_PIP_GLASS_DISK_CLIP_RADIUS_FACTOR;
  const rSmoke = scale * V2_PIP_SMOKE_DISK_CLIP_RADIUS_FACTOR;
  _uniforms.uPipRingCen.value.set(w * 0.5, h * 0.5);
  _uniforms.uPipRingRad2.value = r * r;
  _uniforms.uPipSmokeRingRad2.value = rSmoke * rSmoke;
  _uniforms.uPipRingClip.value = 1;
  return true;
}

export function clearPipOrthoRingDisk() {
  _uniforms.uPipRingClip.value = 0;
}

function chainOnBeforeCompile(material, fn) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === "function") prev.call(material, shader, renderer);
    fn(shader, renderer);
  };
}

/** Built-in THREE mesh materials (`MeshStandardMaterial`, `MeshBasicMaterial`, …). */
export function installMeshMaterialPipRingDiskClip(
  material,
  uniforms = _uniforms,
) {
  if (!material || material.userData?.pipOrthoRingDiskClipInstalled) return;
  material.userData.pipOrthoRingDiskClipInstalled = true;
  chainOnBeforeCompile(material, (shader) => {
    if (shader.fragmentShader.includes("uPipRingClip")) return;
    shader.uniforms.uPipRingClip = uniforms.uPipRingClip;
    shader.uniforms.uPipRingCen = uniforms.uPipRingCen;
    shader.uniforms.uPipRingRad2 = uniforms.uPipRingRad2;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>
uniform float uPipRingClip;
uniform vec2 uPipRingCen;
uniform float uPipRingRad2;
`,
    );
    const needles = [
      "#include <clipping_planes_fragment>",
      "#include <dithering_fragment>",
      "#include <colorspace_fragment>",
    ];
    let done = false;
    for (const n of needles) {
      if (shader.fragmentShader.includes(n)) {
        shader.fragmentShader = shader.fragmentShader.replace(
          n,
          `${n}
vec2 _pipRingDfSac = gl_FragCoord.xy - uPipRingCen;
if (uPipRingClip > 0.5 && dot(_pipRingDfSac, _pipRingDfSac) < uPipRingRad2) discard;
`,
        );
        done = true;
        break;
      }
    }
    if (!done) {
      console.warn(
        "[PipOrthoRingDiskClip] fragment patch skipped — unknown shader layout",
        material.type,
      );
    }
  });
}

/** Apply disk clip to all mesh / skinned mesh / Points materials under `root` (skipped if already flagged). */
export function applyPipOrthoRingDiskClipToSubtree(root) {
  if (!root) return;
  const u = _uniforms;
  root.traverse((ch) => {
    if ((ch.isMesh || ch.isSkinnedMesh) && ch.material) {
      const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.isShaderMaterial) continue;
        installMeshMaterialPipRingDiskClip(m, u);
      }
    }
    if (ch.isPoints && ch.material?.isShaderMaterial) {
      const smokeExt = ch.userData?.anuKind === "tipi_smoke_particles";
      installPointsShaderMaterialPipRingDiskClip(ch.material, u, smokeExt);
    }
  });
}

/**
 * Raw `ShaderMaterial` on `THREE.Points` (campfire / smoke).
 * @param {boolean} [smokeExtended] — use larger PiP ortho discard disk (tipi smoke billboards).
 */
export function installPointsShaderMaterialPipRingDiskClip(
  material,
  uniforms = _uniforms,
  smokeExtended = false,
) {
  if (!material?.isShaderMaterial || material.userData?.pipOrthoRingDiskClipInstalled)
    return;
  material.userData.pipOrthoRingDiskClipInstalled = true;
  material.uniforms.uPipRingClip = uniforms.uPipRingClip;
  material.uniforms.uPipRingCen = uniforms.uPipRingCen;
  material.uniforms.uPipRingRad2 = uniforms.uPipRingRad2;
  if (smokeExtended) {
    material.uniforms.uPipSmokeRingRad2 = uniforms.uPipSmokeRingRad2;
    const decl = `
uniform float uPipRingClip;
uniform vec2 uPipRingCen;
uniform float uPipRingRad2;
uniform float uPipSmokeRingRad2;
`;
    material.fragmentShader =
      decl +
      insertPipRingDiscardAfterMainOpen(material.fragmentShader, "smoke");
  } else {
    const decl = `
uniform float uPipRingClip;
uniform vec2 uPipRingCen;
uniform float uPipRingRad2;
`;
    material.fragmentShader =
      decl + insertPipRingDiscardAfterMainOpen(material.fragmentShader, "default");
  }
}

/**
 * @param {"default" | "smoke"} variant
 */
function insertPipRingDiscardAfterMainOpen(fragmentSrc, variant) {
  const discardLine =
    variant === "smoke"
      ? `vec2 _pipRingDfSac = gl_FragCoord.xy - uPipRingCen;
  if (uPipRingClip > 0.5 && dot(_pipRingDfSac, _pipRingDfSac) < uPipSmokeRingRad2) discard;`
      : `vec2 _pipRingDfSac = gl_FragCoord.xy - uPipRingCen;
  if (uPipRingClip > 0.5 && dot(_pipRingDfSac, _pipRingDfSac) < uPipRingRad2) discard;`;
  return fragmentSrc.replace(
    /\bvoid\s+main\s*\(\s*\)\s*\{/,
    `void main() {
  ${discardLine}`,
  );
}

export function ensurePipOrthoRingClipRuntimeServiceRegistered() {
  if (_registered) return;
  _registered = true;
  registerRuntimeService(
    "PipOrthoBranchClip",
    Object.freeze({
      armOrthoClip(w, h) {
        return armPipOrthoRingDisk(w, h) === true;
      },
      clearOrthoClip() {
        clearPipOrthoRingDisk();
      },
    }),
    { owner: "PipOrthoRingDiskClip" },
  );
}
