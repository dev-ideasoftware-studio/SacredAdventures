// Lighter geometry, same textures. weld → meshoptimizer simplifyWithAttributes
// (normals + UVs weighted, so shading and texture seams hold) → compact → Draco.
// Embedded images are NOT touched (byte-identical). Skins, joints, animations kept.
// Optional: keep a body part at full detail by locking the vertices that given
// bones drive (e.g. --lock-bones Head keeps the face untouched).
// Usage (repo root):
//   node tools/models/simplify-keep-textures.mjs <in.glb> <out.glb> <targetTris>
//        [--lock-bones Head,NeckTwist02] [--lock-weight 0.3] [--error 0.03]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { weld, dedup, prune, compactPrimitive } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import draco3d from "draco3dgltf";
import fs from "node:fs";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const [input, output, targetStr] = args;
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const target = Number(targetStr);
const lockBones = (opt("--lock-bones", "") || "").split(",").filter(Boolean);
const lockWeight = Number(opt("--lock-weight", "0.3"));
const maxError = Number(opt("--error", "0.03"));
if (!input || !output || !(target > 0)) { console.error("usage: simplify-keep-textures.mjs <in.glb> <out.glb> <targetTris> [--lock-bones A,B] [--lock-weight 0.3] [--error 0.03]"); process.exit(2); }

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
});
await MeshoptSimplifier.ready;
const prims = (doc) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
const tris = (doc) => Math.round(prims(doc).reduce((t, p) => t + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute("POSITION").getCount()) / 3, 0));
const verts = (doc) => prims(doc).reduce((v, p) => v + p.getAttribute("POSITION").getCount(), 0);
const texHash = (doc) => doc.getRoot().listTextures().map((t) => crypto.createHash("sha1").update(t.getImage() ?? new Uint8Array()).digest("hex").slice(0, 10)).join(",");
const jointNames = (doc) => doc.getRoot().listSkins().map((s) => s.listJoints().map((j) => j.getName()).join("|")).join("#");

const doc = await io.read(input);
const before = tris(doc), beforeVerts = verts(doc), texBefore = texHash(doc), jointsBefore = jointNames(doc);
await doc.transform(weld({ tolerance: 0.0001 }));
const ratio = Math.min(1, target / before);

// Which skin drives each mesh (for bone locks).
const skinOf = new Map();
for (const node of doc.getRoot().listNodes()) if (node.getMesh() && node.getSkin()) skinOf.set(node.getMesh(), node.getSkin());

let lockedTotal = 0, vertTotal = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idxAcc = prim.getIndices(); if (!idxAcc) continue;
    const pos = prim.getAttribute("POSITION").getArray();
    const n = pos.length / 3;
    const nrm = prim.getAttribute("NORMAL")?.getArray();
    const uv = prim.getAttribute("TEXCOORD_0")?.getArray();
    const attrs = new Float32Array(n * 5);
    for (let i = 0; i < n; i++) {
      if (nrm) { attrs[i * 5] = nrm[i * 3]; attrs[i * 5 + 1] = nrm[i * 3 + 1]; attrs[i * 5 + 2] = nrm[i * 3 + 2]; }
      if (uv) { attrs[i * 5 + 3] = uv[i * 2]; attrs[i * 5 + 4] = uv[i * 2 + 1]; }
    }
    let lock = null;
    const skin = skinOf.get(mesh), J = prim.getAttribute("JOINTS_0"), W = prim.getAttribute("WEIGHTS_0");
    if (lockBones.length && skin && J && W) {
      const ids = new Set(skin.listJoints().map((j, k) => (lockBones.includes(j.getName()) ? k : -1)).filter((k) => k >= 0));
      lock = new Uint8Array(n); const jv = [0, 0, 0, 0], wv = [0, 0, 0, 0];
      for (let i = 0; i < n; i++) { J.getElement(i, jv); W.getElement(i, wv); let s = 0; for (let k = 0; k < 4; k++) if (ids.has(jv[k])) s += wv[k]; if (s >= lockWeight) { lock[i] = 1; lockedTotal++; } }
    }
    vertTotal += n;
    const idx = new Uint32Array(idxAcc.getArray());
    const goal = Math.max(3, Math.floor((idx.length / 3) * ratio) * 3);
    const [outIdx] = MeshoptSimplifier.simplifyWithAttributes(idx, new Float32Array(pos), 3, attrs, 5, [0.5, 0.5, 0.5, 1, 1], lock, goal, maxError);
    idxAcc.setArray(n > 65535 ? new Uint32Array(outIdx) : new Uint16Array(outIdx));
    compactPrimitive(prim);
  }
}
await doc.transform(dedup(), prune());
doc.createExtension(KHRDracoMeshCompression).setRequired(true).setEncoderOptions({ method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER });
await io.write(output, doc);
console.log(JSON.stringify({
  output, trisBefore: before, trisAfter: tris(doc), vertsBefore: beforeVerts, vertsAfter: verts(doc),
  lockedVerts: lockedTotal, lockedPct: +(100 * lockedTotal / Math.max(1, vertTotal)).toFixed(1), lockBones,
  texturesUnchanged: texHash(doc) === texBefore, jointsUnchanged: jointNames(doc) === jointsBefore,
  animations: doc.getRoot().listAnimations().length, MB: +(fs.statSync(output).size / 1048576).toFixed(2),
}));
