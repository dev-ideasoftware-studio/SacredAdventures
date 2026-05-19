/**
 * Sacred Adventures v2 — GLB mesh simplifier (offline).
 *
 * Why this script exists (Anu deep diagnosis, May-11 2026):
 *   - Anu's fuzzy `scene-triangles` sensor reported SEVERE 11.6 M tris.
 *   - Deep inventory probe (`scratch/probe-anu-domains.mjs`) revealed flora
 *     is only 18.3 % of scene cost; the real elephants are the Tripo-AI-
 *     generated GLBs: tipi.yellowbutterfly (1.97 M tris × 2 = 33.8 %) and
 *     animated.stag (~3.45 M tris = 29.8 %). These come from Tripo without
 *     poly-budget passes — vert counts more typical of a sculpt source than
 *     a runtime asset.
 *   - Anu's #1 recommendation pivoted from "trim per-tree" to "trim heavy
 *     Tripo GLBs". Runtime mesh simplification is not viable
 *     (meshoptimizer wasm + scene re-build per session is too costly), so
 *     we decimate offline once and ship the lighter GLB.
 *
 * Why NOT @gltf-transform/cli or @gltf-transform/functions:
 *   - Both eagerly load `@gltf-transform/functions`, which transitively
 *     imports `sharp` via `ndarray-pixels`. `sharp` requires libvips and
 *     does not load on Node 20.0 (this workspace). The CLI errors out
 *     before doing anything useful. Same documented constraint as
 *     `scripts/draco-compress.mjs`.
 *   - We use `@gltf-transform/core` (no sharp) + `meshoptimizer` directly,
 *     then re-apply Draco via `KHRDracoMeshCompression` — same path the
 *     Draco script uses, just with a simplify pass inserted.
 *
 * What the simplifier preserves:
 *   - Vertex array is left untouched. Only the index buffer is rewritten
 *     to collapse triangles. JOINTS_0 / WEIGHTS_0 / NORMAL / TEXCOORD_0
 *     stay correctly bound to surviving triangles, so skinning quality
 *     on the kept polygons is bit-exact.
 *
 * Usage:
 *   node scripts/simplify-and-draco.mjs <input.glb> <output.glb> <ratio> [targetError]
 *
 * Examples:
 *   node scripts/simplify-and-draco.mjs Assets/animated.stag.glb Assets/animated.stag.glb 0.5
 *   node scripts/simplify-and-draco.mjs in.glb out.glb 0.5 0.02
 *
 *   - ratio        = fraction of original triangle count to keep (0.5 = 50 %)
 *   - targetError  = max allowed simplification error in mesh-local units;
 *                    default 0.02 is conservative for game meshes
 */

import { stat } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import {
  KHRONOS_EXTENSIONS,
  KHRDracoMeshCompression,
} from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import { MeshoptSimplifier } from "meshoptimizer";

const ATTR_POSITION = "POSITION";

function asUint32Indices(prim) {
  const idxAcc = prim.getIndices();
  if (idxAcc) {
    const a = idxAcc.getArray();
    if (a instanceof Uint32Array) return { indices: a, fromIndexed: true };
    return { indices: Uint32Array.from(a), fromIndexed: true };
  }
  const pos = prim.getAttribute(ATTR_POSITION);
  if (!pos) return null;
  const vertCount = pos.getCount();
  const idx = new Uint32Array(vertCount);
  for (let i = 0; i < vertCount; i++) idx[i] = i;
  return { indices: idx, fromIndexed: false };
}

async function simplifyDocument(doc, ratio, targetError) {
  await MeshoptSimplifier.ready;

  let totalIn = 0;
  let totalOut = 0;
  const meshLog = [];

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode?.() !== undefined && prim.getMode() !== 4) {
        continue;
      }
      const pos = prim.getAttribute(ATTR_POSITION);
      if (!pos) continue;

      const positions = pos.getArray();
      if (!(positions instanceof Float32Array)) continue;

      const stride = 3;

      const wrapped = asUint32Indices(prim);
      if (!wrapped) continue;
      const indices = wrapped.indices;
      const triIn = indices.length / 3;
      totalIn += triIn;

      const targetIndexCount = Math.max(
        3,
        Math.floor((indices.length * ratio) / 3) * 3,
      );

      const [newIndices, error] = MeshoptSimplifier.simplify(
        indices,
        positions,
        stride,
        targetIndexCount,
        targetError,
      );

      const triOut = newIndices.length / 3;
      totalOut += triOut;
      meshLog.push({
        mesh: mesh.getName() || "(unnamed)",
        triIn,
        triOut,
        ratio: triIn ? +(triOut / triIn).toFixed(3) : 0,
        err: +error.toFixed(5),
      });

      /**
       * Mutate the existing index accessor in place rather than creating
       * a new one. Creating a new accessor leaves the old one orphaned
       * but referenced by the same parent buffer, which the writer can
       * still serialize — observed bloating output from 3.5 MB → 19 MB
       * because both the original and simplified index streams end up
       * in the same glTF buffer.
       */
      const idxAcc = prim.getIndices();
      const fitArray = newIndices.length < 65536 ? Uint16Array.from(newIndices) : newIndices;
      if (idxAcc) {
        idxAcc.setArray(fitArray);
      } else {
        const acc = doc.createAccessor().setArray(fitArray).setType("SCALAR");
        prim.setIndices(acc);
      }
    }
  }

  return { totalIn, totalOut, meshLog };
}

async function main() {
  const [, , inPath, outPath, ratioStr, targetErrStr] = process.argv;
  if (!inPath || !outPath || !ratioStr) {
    console.error("usage: simplify-and-draco.mjs <input.glb> <output.glb> <ratio> [targetError]");
    process.exit(2);
  }
  const ratio = Number(ratioStr);
  const targetError = Number(targetErrStr ?? "0.02");
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    console.error("ratio must be in (0, 1) — e.g. 0.5 keeps 50% of triangles");
    process.exit(2);
  }

  const inBytes = (await stat(inPath)).size;

  const io = new NodeIO()
    .registerExtensions(KHRONOS_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule(),
    });

  const doc = await io.read(inPath);

  const { totalIn, totalOut, meshLog } = await simplifyDocument(doc, ratio, targetError);

  doc
    .createExtension(KHRDracoMeshCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
      encodeSpeed: 5,
      decodeSpeed: 5,
      quantizationBits: {
        POSITION: 14,
        NORMAL: 10,
        COLOR: 8,
        TEX_COORD: 12,
        GENERIC: 12,
      },
      quantizationVolume: "mesh",
    });

  await io.write(outPath, doc);

  const outBytes = (await stat(outPath)).size;
  const mb = (b) => +(b / 1024 / 1024).toFixed(2);

  console.log(JSON.stringify({
    in: inPath,
    out: outPath,
    inMB: mb(inBytes),
    outMB: mb(outBytes),
    sizeRatio: +(outBytes / inBytes).toFixed(3),
    trianglesIn: totalIn,
    trianglesOut: totalOut,
    triRatio: totalIn ? +(totalOut / totalIn).toFixed(3) : 0,
    triSaved: totalIn - totalOut,
    perMesh: meshLog,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
