const fs = require('fs');
const buffer = fs.readFileSync('Assets/NPC.YB.glb');
// The GLB format has a 12 byte header, followed by chunks.
// Chunk 0 is JSON.
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonChunkType = buffer.readUInt32LE(16);
if (jsonChunkType === 0x4E4F534A) { // 'JSON'
    const jsonStr = buffer.toString('utf8', 20, 20 + jsonChunkLength);
    const gltf = JSON.parse(jsonStr);
    if (gltf.animations) {
        gltf.animations.forEach((anim, index) => {
            console.log(`[${index}] ${anim.name}`);
        });
    } else {
        console.log("No animations found");
    }
}
