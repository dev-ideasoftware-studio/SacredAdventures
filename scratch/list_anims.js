const fs = require('fs');

const file = 'Assets/Avatar3.glb';
const buf = fs.readFileSync(file);
const magic = buf.readUInt32LE(0);
const chunkLength = buf.readUInt32LE(12);
const jsonStr = buf.toString('utf8', 20, 20 + chunkLength);
const gltf = JSON.parse(jsonStr);

if (gltf.animations) {
  gltf.animations.forEach((anim, idx) => {
    console.log(`[${idx}]: "${anim.name}"`);
  });
}
