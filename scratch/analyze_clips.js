const fs = require('fs');

const file = 'Assets/npc/Avatar-New.glb';
const buf = fs.readFileSync(file);
const magic = buf.readUInt32LE(0);
const chunkLength = buf.readUInt32LE(12);
const jsonStr = buf.toString('utf8', 20, 20 + chunkLength);
const gltf = JSON.parse(jsonStr);

if (gltf.animations) {
  gltf.animations.forEach((anim, idx) => {
    console.log(`\nClip [${idx}]: "${anim.name}"`);
    console.log(`  Channels: ${anim.channels.length}`);
    console.log(`  Samplers: ${anim.samplers.length}`);
    // Find unique target paths or bone names affected
    const targetNodes = new Set();
    const targetPaths = new Set();
    anim.channels.forEach(ch => {
      if (ch.target) {
        if (ch.target.node !== undefined) targetNodes.add(ch.target.node);
        if (ch.target.path) targetPaths.add(ch.target.path);
      }
    });
    console.log(`  Target nodes count: ${targetNodes.size}`);
    console.log(`  Target paths: ${Array.from(targetPaths).join(', ')}`);
  });
}
