// Dump a GLB's triangles (bind pose) + per-primitive base-colour textures for an offline preview render.
// Usage: node dump.mjs <in.glb> <outDir>
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import fs from "node:fs";
import path from "node:path";

const [input, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
});
const doc = await io.read(input);
const prims = [];
let n = 0;
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  // Skinned meshes ignore their node transform (glTF spec); static meshes use it.
  const m = node.getSkin() ? null : node.getWorldMatrix();
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute("POSITION").getArray();
    const uv = p.getAttribute("TEXCOORD_0")?.getArray() ?? null;
    const idx = p.getIndices()?.getArray() ?? Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
    const P = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
      if (m) {
        P[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
        P[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        P[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      } else { P[i] = x; P[i + 1] = y; P[i + 2] = z; }
    }
    const mat = p.getMaterial();
    const tex = mat?.getBaseColorTexture();
    let texFile = null;
    if (tex) {
      texFile = `tex${n}.${tex.getMimeType() === "image/png" ? "png" : "jpg"}`;
      fs.writeFileSync(path.join(outDir, texFile), Buffer.from(tex.getImage()));
    }
    const base = `prim${n}`;
    fs.writeFileSync(path.join(outDir, base + ".pos.bin"), Buffer.from(P.buffer));
    fs.writeFileSync(path.join(outDir, base + ".idx.bin"), Buffer.from(Uint32Array.from(idx).buffer));
    if (uv) fs.writeFileSync(path.join(outDir, base + ".uv.bin"), Buffer.from(Float32Array.from(uv).buffer));
    prims.push({ base, texFile, hasUv: !!uv, color: mat?.getBaseColorFactor() ?? [0.8, 0.8, 0.8, 1] });
    n++;
  }
}
fs.writeFileSync(path.join(outDir, "prims.json"), JSON.stringify(prims));
console.log(input, "→", prims.length, "primitives");
