/**
 * decimate-mobile-assets.mjs — build low-poly `.mobile.glb` variants.
 *
 * Mobile WebGL processes have a hard memory ceiling. The sanctuary ships
 * ~3M triangles of Tripo GLB geometry (avatar ~1.5M, props the rest) which
 * OOM-kills the iOS GPU process at render. This produces decimated variants
 * (weld + meshopt simplify + Draco) that the GLTF loader swaps in on mobile.
 *
 * Triangle reduction is what fixes the OOM (Draco only shrinks download).
 * Run: node scripts/decimate-mobile-assets.mjs
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, prune, dedup } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import { promises as fs } from "node:fs";

// [path, simplifyRatio]. Only assets with a BIG triangle win AND a small
// decimated file ship as mobile variants (loader swaps them on mobile). The
// loader's MOBILE_GLB_VARIANTS set must stay in sync with this list.
// NPC.REG.glb is intentionally NOT here — it's ~1.9M tris / 26MB and is SKIPPED
// outright on mobile in SanctuaryTipiNpcs.js (decimating still left a 21MB file).
const TARGETS = [
  ["Assets/tipi.player.glb", 0.18],
  ["Assets/Tipi.yellowbutterfly/tipi.yellowbutterfly-compressed.glb", 0.18],
  ["Assets/NPC.BHG.glb", 0.25],
  ["Assets/TraderJosh3d.glb", 0.25],
  ["Assets/Buffalo.glb", 0.2],
  ["Assets/animated.stag.glb", 0.2],
];

function countTris(doc) {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const pr of m.listPrimitives()) {
      const idx = pr.getIndices();
      const pos = pr.getAttribute("POSITION");
      t += (idx ? idx.getCount() : pos ? pos.getCount() : 0) / 3;
    }
  return Math.round(t);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});
await MeshoptSimplifier.ready;

const manifest = [];
for (const [rel, ratio] of TARGETS) {
  const out = rel.replace(/\.glb$/i, ".mobile.glb");
  try {
    await fs.access(rel);
  } catch {
    console.log(`skip (missing): ${rel}`);
    continue;
  }
  try {
    const doc = await io.read(rel);
    const before = countTris(doc);
    await doc.transform(
      weld({ tolerance: 0.0001 }),
      simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.012 }),
      dedup(),
      prune(),
    );
    const after = countTris(doc);
    await io.write(out, doc);
    const [a, b] = await Promise.all([fs.stat(rel), fs.stat(out)]);
    console.log(
      `✓ ${rel.split("/").pop()}: ${(before / 1000).toFixed(0)}k→${(after / 1000).toFixed(0)}k tris · ${(a.size / 1e6).toFixed(1)}MB→${(b.size / 1e6).toFixed(1)}MB`,
    );
    manifest.push(rel.split("/").pop());
  } catch (e) {
    console.log(`✗ ${rel}: ${e.message}`);
  }
}
console.log("\nMOBILE_VARIANT_FILES =", JSON.stringify(manifest));
