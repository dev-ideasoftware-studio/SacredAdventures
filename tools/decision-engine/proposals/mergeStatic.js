/**
 * PROPOSAL (not wired into the game) — playbook card C-04 / C-05.
 * Target location when adopted: js/sanctuary/mergeStatic.js
 *
 * mergeStaticChildren(group, opts)
 *   Bakes the direct child meshes of `group` that share a material into ONE mesh per
 *   material. Each child's own transform (child.matrix, i.e. relative to `group`) is
 *   baked into the merged geometry, so `group` itself can keep moving every frame
 *   (lily flowers bob and tilt as a whole — that keeps working unchanged).
 *
 * opts.tintAsVertexColor (default false)
 *   Also merge meshes whose materials are identical except for `.color`. Each
 *   material's colour moves into a per-vertex `color` attribute and the shared
 *   material uses `vertexColors: true` with a white base colour. Both multiply the
 *   map, so the rendered colour is the same. (Shoreline rocks: 60 materials → 1.)
 * opts.skip(child) → true (optional)
 *   Leave that child exactly as it is. REQUIRED for any part animated per frame that is
 *   a plain Mesh (frog "tongue"; turtle flipper/head refs). Groups are never merged anyway.
 * opts.castShadow (optional boolean)
 *   Override castShadow on the merged meshes. Omit to keep the first child's value.
 *
 * Rules this helper follows (see playbook "Read this first"):
 *   - Only direct children that are plain Mesh (not Skinned/Instanced) with no
 *     children of their own are merged. Anything else is left exactly as it was.
 *   - Children that animate on their own must NOT be in `group` (no such children in
 *     the lily flowers or shoreline rock group — verified by the census test).
 *   - Source geometries/materials that are no longer referenced are disposed here.
 *     Shared ones (still used by a kept child) are not.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const TEX_SLOTS = ["map", "normalMap", "bumpMap", "roughnessMap", "metalnessMap", "alphaMap", "emissiveMap", "aoMap", "lightMap", "envMap"];

function materialKey(m, ignoreColor) {
  const parts = [m.type, m.side, m.transparent, m.opacity, m.alphaTest, m.depthWrite, m.depthTest,
    m.vertexColors, m.flatShading, m.roughness, m.metalness, m.bumpScale, m.emissiveIntensity,
    m.emissive ? m.emissive.getHex() : "", ignoreColor ? "" : (m.color ? m.color.getHex() : ""),
    m.onBeforeCompile ? m.onBeforeCompile.toString() : ""];
  for (const s of TEX_SLOTS) parts.push(m[s] ? m[s].uuid : "");
  return parts.join("|");
}

function isMergeable(o) {
  return o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && o.children.length === 0 &&
    !Array.isArray(o.material) && o.geometry && o.geometry.attributes.position;
}

export function mergeStaticChildren(group, opts = {}) {
  const tint = opts.tintAsVertexColor === true;
  const buckets = new Map(); // key -> mesh[]
  const skip = typeof opts.skip === "function" ? opts.skip : () => false;
  for (const child of group.children) {
    if (!isMergeable(child) || skip(child)) continue;
    const key = materialKey(child.material, tint);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(child);
  }
  let removedMeshes = 0;
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const first = meshes[0];
    const parts = [];
    for (const m of meshes) {
      m.updateMatrix();
      let g = m.geometry.clone().applyMatrix4(m.matrix);
      if (tint) {
        const c = m.material.color;
        const n = g.attributes.position.count;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
        g.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      }
      parts.push(g);
    }
    // mergeGeometries needs all-indexed or all-non-indexed inputs.
    if (parts.some((g) => g.index === null) && parts.some((g) => g.index !== null)) {
      for (let i = 0; i < parts.length; i++) if (parts[i].index !== null) parts[i] = parts[i].toNonIndexed();
    }
    const merged = mergeGeometries(parts, false);
    if (!merged) {
      console.warn("[mergeStaticChildren] merge failed (attribute mismatch) — left unmerged:", group.name);
      continue;
    }
    merged.computeBoundingSphere();
    let material = first.material;
    if (tint) {
      material = first.material.clone();           // clone() does NOT copy onBeforeCompile
      material.onBeforeCompile = first.material.onBeforeCompile;
      material.color.set(0xffffff);
      material.vertexColors = true;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = (first.name || "merged").replace(/_\d+$/, "") + "_merged";
    mesh.userData = { ...first.userData, mergedFrom: meshes.length };
    mesh.castShadow = opts.castShadow ?? first.castShadow;
    mesh.receiveShadow = first.receiveShadow;
    mesh.layers.mask = first.layers.mask;
    mesh.renderOrder = first.renderOrder;
    mesh.frustumCulled = first.frustumCulled;
    // Remove sources; dispose what nothing else uses any more.
    const stillUsedGeo = new Set(), stillUsedMat = new Set();
    for (const c of group.children) if (!meshes.includes(c) && c.isMesh) { stillUsedGeo.add(c.geometry); stillUsedMat.add(c.material); }
    stillUsedMat.add(material);
    for (const m of meshes) {
      group.remove(m);
      if (!stillUsedGeo.has(m.geometry)) m.geometry.dispose();
      if (!stillUsedMat.has(m.material)) m.material.dispose(); // textures are shared — never disposed here
    }
    for (const p of parts) p.dispose();
    group.add(mesh);
    removedMeshes += meshes.length - 1;
  }
  // castShadow override applies to every direct mesh child, merged or not (a flower's
  // single pistil has nothing to merge with but must stop casting too).
  if (typeof opts.castShadow === "boolean") {
    for (const c of group.children) if (c.isMesh) c.castShadow = opts.castShadow;
  }
  return removedMeshes;
}
