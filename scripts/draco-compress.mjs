/**
 * Sacred Adventures v2 — Draco mesh compressor.
 *
 * Compresses one GLB at a time using the @gltf-transform/extensions Draco
 * encoder DIRECTLY, skipping @gltf-transform/functions (which transitively
 * loads `sharp` via `ndarray-pixels` at module-load time and requires Node
 * ≥ 20.3 — this workspace runs Node 20.0). The Draco extension owns the
 * actual encode-on-write machinery; the `draco()` convenience function in
 * @gltf-transform/functions only wraps `weld() + setEncoderOptions()`. We
 * skip welding because most Tripo-authored assets are already de-duped;
 * skipping costs ~5–10 % vs the welded ideal, which is fine versus the
 * 5–10× gain Draco itself delivers.
 *
 * Usage:  node scripts/draco-compress.mjs <input.glb> <output.glb>
 */

import { stat } from "node:fs/promises";
import { NodeIO } from "@gltf-transform/core";
import {
  KHRONOS_EXTENSIONS,
  KHRDracoMeshCompression,
} from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";

async function main() {
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) {
    console.error("usage: draco-compress.mjs <input.glb> <output.glb>");
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

  /**
   * Quantization is conservative — these are game-grade meshes and we'd
   * rather pay a few extra MB than ship visible artefacts:
   *   POSITION 14 bits → ≈1 part in 16k of mesh bbox (sub-mm at 10 m extent)
   *   NORMAL   10 bits → octahedral encoding, indistinguishable in practice
   *   TEXCOORD 12 bits → 1 part in 4k, invisible at typical texel density
   *   COLOR    8  bits → standard 8-bit-per-channel
   *   GENERIC  12 bits → covers JOINTS/WEIGHTS/etc; do not drop below 12
   *                      for skinned meshes (joint weights drift visibly).
   * EDGEBREAKER is the right method for closed triangle meshes.
   */
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
  const ratio = outBytes / inBytes;
  const mb = (b) => (b / 1024 / 1024).toFixed(2);
  console.log(
    JSON.stringify(
      {
        in: inPath,
        out: outPath,
        inMB: +mb(inBytes),
        outMB: +mb(outBytes),
        ratio: +ratio.toFixed(3),
        savedMB: +mb(inBytes - outBytes),
        savedPct: +(100 * (1 - ratio)).toFixed(1),
      },
      null,
      0,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
