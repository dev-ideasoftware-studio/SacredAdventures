// Build lighter GLB variants: weld → meshopt simplify to a triangle target →
// downsize textures → Draco. Usage: node lite.mjs <in.glb> <out.glb> <targetTris> <maxTexPx> [maxError]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { weld, simplify, dedup, prune, textureCompress } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import sharp from "sharp";
import fs from "node:fs";

const [input, output, targetStr, texStr, errStr] = process.argv.slice(2);
const target = Number(targetStr), maxTex = Number(texStr), maxError = Number(errStr ?? 0.02);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});
await MeshoptSimplifier.ready;

const tris = (doc) => {
  let t = 0;
  for (const m of doc.getRoot().listMeshes())
    for (const p of m.listPrimitives()) {
      const i = p.getIndices();
      t += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3;
    }
  return Math.round(t);
};

const doc = await io.read(input);
const before = tris(doc);
const ratio = Math.min(1, target / before);
await doc.transform(
  weld({ tolerance: 0.0001 }),
  simplify({ simplifier: MeshoptSimplifier, ratio, error: maxError }),
  dedup(),
  prune(),
  // Same container format as the source (png stays png, jpeg stays jpeg) — no new extensions needed.
  textureCompress({ encoder: sharp, resize: [maxTex, maxTex] }),
);
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({
  method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
});
await io.write(output, doc);
const after = tris(doc);
console.log(JSON.stringify({
  input, output, before, after, ratioAsked: +ratio.toFixed(4),
  inMB: +(fs.statSync(input).size / 1048576).toFixed(2),
  outMB: +(fs.statSync(output).size / 1048576).toFixed(2),
  animations: doc.getRoot().listAnimations().length,
  skins: doc.getRoot().listSkins().length,
}));
