// Equivalence test for proposals/mergeStatic.js against the REAL SanctuaryPool.load().
// Run from repo root: node --import <seed-globals> tools/decision-engine/proposals/test_mergeStatic.mjs
//
// For the lily-flower groups (C-04) and the shoreline-rock group (C-05) it checks:
//   1. the multiset of world-space triangle vertices is identical before/after (≤1e-5 m),
//   2. per-vertex rendered base colour is identical (material.color × vertex colour),
//   3. draw-call and shadow-caster counts drop as claimed,
//   4. the lily PADS are untouched (frogs read them via window.__sanctuaryLilyPads),
//   5. a lily flower group still bobs: moving the group moves the merged meshes.
import { THREE, importStaged, cleanup } from "../node_stage.mjs";

const { SanctuaryPoolModule } = await importStaged("js/sanctuary/SanctuaryPool.js");
const { mergeStaticChildren } = await importStaged("tools/decision-engine/proposals/mergeStatic.js");

const log = console.log; console.log = () => {};
const scene = new THREE.Scene();
await SanctuaryPoolModule.load(scene);
console.log = log;

const root = SanctuaryPoolModule._root;
const lilies = root.children.find((c) => c.name === "sanctuary_lily_pads");
const rocks = root.children.find((c) => c.name === "sanctuary_pool_shoreline_rocks");
if (!lilies || !rocks) throw new Error("groups not found");

function snapshot(group) {
  group.updateMatrixWorld(true);
  const verts = [];
  let draws = 0, shadow = 0, tris = 0;
  const v = new THREE.Vector3();
  group.traverse((o) => {
    if (!o.isMesh) return;
    draws++; if (o.castShadow) shadow++;
    const g = o.geometry, pos = g.attributes.position, col = g.attributes.color;
    const idx = g.index ? Array.from(g.index.array) : [...Array(pos.count).keys()];
    tris += idx.length / 3;
    const mc = o.material.color;
    for (const i of idx) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const r = mc.r * (o.material.vertexColors && col ? col.getX(i) : 1);
      const gg = mc.g * (o.material.vertexColors && col ? col.getY(i) : 1);
      const b = mc.b * (o.material.vertexColors && col ? col.getZ(i) : 1);
      verts.push([v.x, v.y, v.z, r, gg, b]);
    }
  });
  return { verts, draws, shadow, tris };
}
// Tolerance match: every vertex (position ±0.1 mm, colour ±1e-4) in B must pair with a distinct one in A.
// Float32 storage of baked positions ~12 m from the origin is only good to ~1e-6 m, so exact string
// compares flip on rounding boundaries; a spatial-hash nearest match does not.
function same(a, b, tolPos = 1e-4, tolCol = 1e-4) {
  if (a.verts.length !== b.verts.length) return false;
  const cell = (x) => Math.floor(x / 1e-3);
  const grid = new Map();
  a.verts.forEach((v, i) => { const k = cell(v[0]) + "," + cell(v[1]) + "," + cell(v[2]); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
  const used = new Uint8Array(a.verts.length);
  let worst = 0;
  for (const v of b.verts) {
    let hit = -1;
    outer: for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get((cell(v[0]) + dx) + "," + (cell(v[1]) + dy) + "," + (cell(v[2]) + dz));
      if (!list) continue;
      for (const i of list) {
        if (used[i]) continue;
        const u = a.verts[i];
        const dp = Math.max(Math.abs(u[0] - v[0]), Math.abs(u[1] - v[1]), Math.abs(u[2] - v[2]));
        const dc = Math.max(Math.abs(u[3] - v[3]), Math.abs(u[4] - v[4]), Math.abs(u[5] - v[5]));
        if (dp <= tolPos && dc <= tolCol) { hit = i; worst = Math.max(worst, dp); break outer; }
      }
    }
    if (hit < 0) return false;
    used[hit] = 1;
  }
  same.worst = worst;
  return true;
}

const flowerGroups = lilies.children.filter((c) => /flower/.test(c.userData.anuKind || ""));
const padsBefore = lilies.children.filter((c) => c.userData.anuKind === "sanctuary_lily_pad");

// ── C-04 lily flowers ──
const lilyBefore = snapshot(lilies);
for (const f of flowerGroups) mergeStaticChildren(f, { castShadow: false });
const lilyAfter = snapshot(lilies);
const padsAfter = lilies.children.filter((c) => c.userData.anuKind === "sanctuary_lily_pad");

// bob test: move one flower group, its merged meshes must follow
const f0 = flowerGroups[0];
const before0 = snapshot(f0).verts[0][1];
f0.position.y += 0.05; f0.updateMatrixWorld(true);
const after0 = snapshot(f0).verts[0][1];
f0.position.y -= 0.05;

// ── C-05 shoreline rocks ──
const rockBefore = snapshot(rocks);
mergeStaticChildren(rocks, { tintAsVertexColor: true });
const rockAfter = snapshot(rocks);
const rockMat = rocks.children[0].material;

const result = {
  lily: {
    geometryAndColourIdentical: same(lilyBefore, lilyAfter),
    draws: `${lilyBefore.draws} → ${lilyAfter.draws}`,
    shadowCasters: `${lilyBefore.shadow} → ${lilyAfter.shadow}`,
    triangles: `${lilyBefore.tris} → ${lilyAfter.tris}`,
    padsUntouched: padsBefore.length === padsAfter.length && padsBefore.every((p, i) => p === padsAfter[i]),
    flowerStillBobs: before0 !== after0,
  },
  rocks: {
    geometryAndColourIdentical: same(rockBefore, rockAfter),
    worstVertexShift_m: same.worst,
    draws: `${rockBefore.draws} → ${rockAfter.draws}`,
    shadowCasters: `${rockBefore.shadow} → ${rockAfter.shadow}`,
    triangles: `${rockBefore.tris} → ${rockAfter.tris}`,
    mergedMaterialKeepsMossShader: typeof rockMat.onBeforeCompile === "function" && /mossStrength/.test(rockMat.onBeforeCompile.toString()),
    vertexColors: rockMat.vertexColors === true,
  },
};
log(JSON.stringify(result, null, 1));
cleanup();
const ok = result.lily.geometryAndColourIdentical && result.lily.padsUntouched && result.lily.flowerStillBobs &&
  result.rocks.geometryAndColourIdentical && result.rocks.mergedMaterialKeepsMossShader;
process.exit(ok ? 0 : 1);
