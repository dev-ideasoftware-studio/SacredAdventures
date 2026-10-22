// Scene census: run a sanctuary module's real load() in Node and count what it puts in the scene.
//
// Usage (from repo root):
//   node tools/decision-engine/scene_census.mjs js/sanctuary/SanctuaryPool.js SanctuaryPoolModule [more pairs...]
//
// How it works: the module is copied into a temp dir with its imports rewritten —
//   "three"                 → the vendored r160 build (vendor/three/three.module.js)
//   other relative imports  → copied recursively and rewritten the same way
// Browser APIs are stubbed just enough for construction: document.createElement('canvas')
// returns a canvas whose 2D context accepts every call; Image/TextureLoader loads resolve
// immediately with a 1×1 placeholder (so texture SIZES are not measured here — only counts).
// Only scene construction is measured: per frame, each visible Mesh = 1 draw call per pass
// (transparent + DoubleSide materials = 2 in three r160 — see renderObject's forceSinglePass branch).
import { THREE, importStaged, cleanup } from "./node_stage.mjs";

// ── census ───────────────────────────────────────────────────────────────────
function tri(g) { if (!g) return 0; return (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3; }
function census(root) {
  const s = { meshes: 0, instanced: 0, instances: 0, drawsMain: 0, drawsShadow: 0, tris: 0, trisShadow: 0, materials: new Set(), textures: new Set(), transparent: 0, doubleSidedTransparent: 0, frustumCulledFalse: 0, physical: 0, lights: 0 };
  root.traverse((o) => {
    if (o.isLight) s.lights++;
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const inst = o.isInstancedMesh ? o.count : 1;
    const t = o.isSprite ? 2 : tri(o.geometry) * inst;
    s.meshes++; if (o.isInstancedMesh) { s.instanced++; s.instances += inst; }
    let passes = 0;
    for (const m of mats) {
      if (!m) continue;
      s.materials.add(m);
      for (const k of ["map", "normalMap", "bumpMap", "roughnessMap", "metalnessMap", "alphaMap", "emissiveMap", "aoMap", "envMap"]) if (m[k]) s.textures.add(m[k]);
      if (m.transparent) s.transparent++;
      const two = m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass;
      if (two) s.doubleSidedTransparent++;
      passes += two ? 2 : 1;
      if (m.isMeshPhysicalMaterial) s.physical++;
    }
    s.drawsMain += passes; s.tris += t * (passes > 1 ? 2 : 1);
    if (o.castShadow) { s.drawsShadow += mats.length; s.trisShadow += t; }
    if (o.frustumCulled === false) s.frustumCulledFalse++;
  });
  s.materials = s.materials.size; s.textures = s.textures.size;
  return s;
}

const args = process.argv.slice(2);
const report = {};
// Modules log heavily; keep stdout clean for the JSON report.
const _log = console.log;
console.log = console.info = console.debug = () => {};
for (let i = 0; i < args.length; i += 2) {
  const exportName = args[i + 1];
  const mod = await importStaged(args[i]);
  const M = mod[exportName];
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1.6, 0.1, 2000);
  try {
    await M.load(scene, camera, null, null);
  } catch (e) {
    report[exportName] = { error: String(e && e.message || e).slice(0, 200) };
    continue;
  }
  // group by top-level child (usually one root per module) and by anuKind under it
  const byKind = {};
  scene.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
    let k = o.userData?.anuKind; let p = o.parent;
    while (!k && p) { k = p.userData?.anuKind; p = p.parent; }
    k = k || o.name || "(unnamed)";
    (byKind[k] ||= new THREE.Group()).children.push(o);
  });
  const kinds = {};
  for (const [k, g] of Object.entries(byKind)) {
    const c = { meshes: 0, drawsMain: 0, drawsShadow: 0, tris: 0, materials: new Set() };
    for (const o of g.children) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const two = mats.some((m) => m && m.transparent && m.side === THREE.DoubleSide && !m.forceSinglePass);
      c.meshes++; c.drawsMain += two ? 2 : 1; if (o.castShadow) c.drawsShadow++;
      c.tris += (o.isSprite ? 2 : tri(o.geometry) * (o.isInstancedMesh ? o.count : 1)) * (two ? 2 : 1);
      mats.forEach((m) => m && c.materials.add(m));
    }
    c.materials = c.materials.size;
    kinds[k] = c;
  }
  report[exportName] = { total: census(scene), byKind: kinds };
}
_log(JSON.stringify(report, null, 1));
cleanup();
process.exit(0);
