/**
 * VIP meshes (player by default) can draw after instanced flora with depth tests disabled
 * so they stay readable through dense canopy.
 *
 * Structures may use `configureMeshesRenderOrderAboveFlora` so they stay opaque (depthTest
 * stays true) while sorting above instanced trees. NPC / spirit characters use default
 * render order so occlusion looks natural with the forest.
 */

export const V2_RENDER_ORDER_STRUCTURES_ABOVE_FLORA = 1080;
export const V2_RENDER_ORDER_PLAYER_ABOVE_FLORA = 1200;

/** Sort above instanced trees without changing materials (opaque depth buffer). */
export function configureMeshesRenderOrderAboveFlora(root, renderOrder) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.renderOrder = renderOrder;
  });
}

/** @param {THREE.Object3D} root */
export function configureMeshesReadThroughInstancedFoliage(root, renderOrder) {
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.renderOrder = renderOrder;
    const mats = Array.isArray(child.material) ? child.material : [child.material];
    for (const m of mats) {
      if (!m) continue;
      m.depthTest = false;
      m.needsUpdate = true;
    }
  });
}

/**
 * Particle / additive overlays ( ShaderMaterial ).
 * @param {THREE.Points} points
 */
export function configurePointsReadThroughInstancedFoliage(points, renderOrder) {
  points.renderOrder = renderOrder;
  const mat = points.material;
  if (mat && "depthTest" in mat) {
    mat.depthTest = false;
    mat.needsUpdate = true;
  }
}
