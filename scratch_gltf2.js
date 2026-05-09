const fs = require('fs');
const buffer = fs.readFileSync('Assets/NPC.YB.glb');
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonStr = buffer.toString('utf8', 20, 20 + jsonChunkLength);
const gltf = JSON.parse(jsonStr);
gltf.animations.forEach((anim, index) => {
    console.log(`[${index}] ${anim.name}: ${anim.channels.length} channels`);
});
