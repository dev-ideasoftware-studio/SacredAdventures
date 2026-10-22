import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({"draco3d.decoder": await draco3d.createDecoderModule()});
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f); const r = doc.getRoot();
  const skins = r.listSkins().map(s => s.listJoints().length);
  let verts = 0, missing = 0, badSum = 0, maxDev = 0, normals = true;
  for (const m of r.listMeshes()) for (const p of m.listPrimitives()) {
    const W = p.getAttribute("WEIGHTS_0"), J = p.getAttribute("JOINTS_0");
    if (!p.getAttribute("NORMAL")) normals = false;
    const n = p.getAttribute("POSITION").getCount(); verts += n;
    if (!W || !J) { if (skins.length) missing += n; continue; }
    const w = [0,0,0,0];
    for (let i = 0; i < n; i++) { W.getElement(i, w); const s = w[0]+w[1]+w[2]+w[3]; const dev = Math.abs(1 - s); if (dev > 0.01) badSum++; if (dev > maxDev) maxDev = dev; }
  }
  const anims = r.listAnimations().map(a => `${a.getName()}(${a.listChannels().length}ch)`);
  console.log(JSON.stringify({ file: f.split("/").pop(), joints: skins, verts, vertsMissingSkin: missing, weightSumOff: badSum, maxWeightDev: +maxDev.toFixed(4), normals, anims }));
}
