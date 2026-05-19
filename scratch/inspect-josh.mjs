import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";

async function inspect(path) {
  const io = new NodeIO()
    .registerExtensions(KHRONOS_EXTENSIONS)
    .registerDependencies({
      "draco3d.decoder": await draco3d.createDecoderModule(),
      "draco3d.encoder": await draco3d.createEncoderModule(),
    });
  const doc = await io.read(path);
  const root = doc.getRoot();
  const anims = root.listAnimations();
  const skins = root.listSkins();
  const meshes = root.listMeshes();
  console.log("=", path);
  console.log("  animations:", anims.length);
  for (const a of anims) {
    const channels = a.listChannels();
    const samplers = a.listSamplers();
    console.log("   - name:", JSON.stringify(a.getName()), "channels:", channels.length, "samplers:", samplers.length);
    for (const c of channels) {
      const target = c.getTargetNode();
      console.log("     channel:", c.getTargetPath(), "→ node:", target?.getName());
    }
  }
  console.log("  skins:", skins.length);
  for (const s of skins) {
    console.log("   - joints:", s.listJoints().length);
  }
  console.log("  meshes:", meshes.length);
  let totalPrim = 0;
  for (const m of meshes) totalPrim += m.listPrimitives().length;
  console.log("  primitives total:", totalPrim);
}

await inspect("/Users/Me/Documents/SacredOnes/SACREDGAME/NEW.SACREDONES/Assets/TraderJosh3d.glb");
await inspect("/Users/Me/Documents/SacredOnes/SACREDGAME/NEW.SACREDONES/BACKUP/draco-originals/TraderJosh3d.glb");
