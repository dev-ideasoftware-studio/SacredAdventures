import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
import sharp from "sharp";
import fs from "node:fs";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "draco3d.decoder": await draco3d.createDecoderModule() });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  let tris = 0; for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { const i = p.getIndices(); tris += (i ? i.getCount() : p.getAttribute("POSITION").getCount()) / 3; }
  const tex = [];
  for (const t of root.listTextures()) { const img = t.getImage(); const meta = await sharp(Buffer.from(img)).metadata(); tex.push(`${t.getName() || "?"} ${meta.width}x${meta.height} ${t.getMimeType()} ${(img.byteLength / 1048576).toFixed(2)}MB`); }
  const texBytes = root.listTextures().reduce((s, t) => s + t.getImage().byteLength, 0);
  console.log(JSON.stringify({ file: f, MB: +(fs.statSync(f).size / 1048576).toFixed(2), texMB: +(texBytes / 1048576).toFixed(2), tris: Math.round(tris), meshes: root.listMeshes().length, skins: root.listSkins().length, joints: root.listSkins().map((s) => s.listJoints().length), anims: root.listAnimations().map((a) => a.getName()), extensions: root.listExtensionsUsed().map((e) => e.extensionName), textures: tex, materials: root.listMaterials().map((m) => m.getName()) }, null, 0));
}
