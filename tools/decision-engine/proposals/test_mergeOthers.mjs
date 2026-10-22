// Measures mergeStaticChildren on frogs, dock and turtle with animated parts pinned, and proves
// (a) world-space geometry + colour identical, (b) every animated object is still the same object.
import { THREE, importStaged, cleanup } from "../node_stage.mjs";
const { mergeStaticChildren } = await importStaged("tools/decision-engine/proposals/mergeStatic.js");
const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
function draws(root) { let d = 0, s = 0; root.traverse((o) => { if (o.isMesh) { d++; if (o.castShadow) s++; } }); return { d, s }; }
function verts(root) { root.updateMatrixWorld(true); const out = []; const v = new THREE.Vector3(); root.traverse((o) => { if (!o.isMesh) return; const g = o.geometry, p = g.attributes.position, c = g.attributes.color; const idx = g.index ? g.index.array : [...Array(p.count).keys()]; for (const i of idx) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); const k = o.material.vertexColors && c ? [c.getX(i), c.getY(i), c.getZ(i)] : [1, 1, 1]; out.push([v.x, v.y, v.z, o.material.color.r * k[0], o.material.color.g * k[1], o.material.color.b * k[2]].map((n) => Math.round(n * 1e4)).join(",")); } }); return out.sort(); }
// tolerance compare (0.1 mm / 1e-4 colour) — see test_mergeStatic.mjs for why exact compares flip
function eq(a, b) {
  if (a.length !== b.length) return false;
  const A = a.map((s) => s.split(",").map(Number)), B = b.map((s) => s.split(",").map(Number));
  const key = (v) => v.slice(0, 3).map((n) => Math.floor(n / 10)).join(",");
  const grid = new Map(); A.forEach((v, i) => { const k = key(v); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  const used = new Uint8Array(A.length);
  for (const v of B) {
    let hit = -1; const base = v.slice(0, 3).map((n) => Math.floor(n / 10));
    for (let dx = -1; dx <= 1 && hit < 0; dx++) for (let dy = -1; dy <= 1 && hit < 0; dy++) for (let dz = -1; dz <= 1 && hit < 0; dz++) {
      for (const i of grid.get([base[0] + dx, base[1] + dy, base[2] + dz].join(",")) || []) {
        if (used[i]) continue; const u = A[i];
        if (u.every((x, j) => Math.abs(x - v[j]) <= 1)) { hit = i; break; }
      }
    }
    if (hit < 0) return false; used[hit] = 1;
  }
  return true;
}
const res = {};
// frogs
const poolScene = new THREE.Scene();
{ const { SanctuaryPoolModule: P0 } = await importStaged("js/sanctuary/SanctuaryPool.js"); await P0.load(poolScene);
  const { SanctuaryFrogsModule } = await importStaged("js/sanctuary/SanctuaryFrogs.js"); const scene = new THREE.Scene(); await SanctuaryFrogsModule.load(scene);
  const frogGroups = []; scene.traverse((o) => { if (o.isGroup && o.children.some((c) => c.name === "tongue")) frogGroups.push(o); });
  const animated = []; for (const f of frogGroups) f.traverse((o) => { if (/^(tongue|leg_)/.test(o.name)) animated.push(o); });
  const b = draws(scene), vb = verts(scene);
  for (const f of frogGroups) mergeStaticChildren(f, { tintAsVertexColor: true, skip: (c) => /^(tongue|leg_)/.test(c.name) });
  const a = draws(scene), va = verts(scene);
  const stillThere = animated.every((o) => { let p = o; while (p.parent) p = p.parent; return p === scene; });
  res.frogs = { frogs: frogGroups.length, draws: `${b.d} → ${a.d}`, shadow: `${b.s} → ${a.s}`, identical: eq(vb, va), animatedPartsKept: `${animated.length} kept: ${stillThere}` }; }
// dock
{ const { SanctuaryDockModule } = await importStaged("js/sanctuary/SanctuaryDock.js"); const scene = new THREE.Scene(); await SanctuaryDockModule.load(scene);
  const groups = []; scene.traverse((o) => { if (o.isGroup || o.isScene) groups.push(o); });
  const b = draws(scene), vb = verts(scene); for (const g of groups) mergeStaticChildren(g); const a = draws(scene), va = verts(scene);
  res.dock = { draws: `${b.d} → ${a.d}`, shadow: `${b.s} → ${a.s}`, identical: eq(vb, va) }; }
// turtle (inside the pool)
{ const scene = poolScene; // pool module is a singleton — reuse the scene it was loaded into
  let turtle = null; scene.traverse((o) => { if (o.userData?.anuKind === "sanctuary_pool_turtle" && !turtle && o.isGroup) turtle = o; });
  const refs = new Set(Object.entries(turtle.userData).filter(([k, v]) => /Ref$/.test(k) && v?.isObject3D).map(([, v]) => v));
  const groups = []; turtle.traverse((o) => { if (o.isGroup) groups.push(o); });
  const b = draws(turtle), vb = verts(turtle);
  for (const g of groups) mergeStaticChildren(g, { skip: (c) => refs.has(c), castShadow: false });
  const a = draws(turtle), va = verts(turtle);
  res.turtle = { draws: `${b.d} → ${a.d}`, shadow: `${b.s} → ${a.s}`, identical: eq(vb, va), animatedRefs: [...refs].map((r) => r.type + (r.name ? ":" + r.name : "")).join(", "), refsStillAttached: [...refs].every((r) => { let p = r; while (p.parent) p = p.parent; return p === scene; }) }; }
console.log = log; log(JSON.stringify(res, null, 1)); cleanup();
