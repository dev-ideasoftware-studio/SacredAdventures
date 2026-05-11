const fs = require('fs');
const buffer = fs.readFileSync('Assets/animated.avatar.glb');
// A GLB file has a JSON chunk. The JSON chunk starts after the 12 byte header and an 8 byte chunk header.
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonBuffer = buffer.slice(20, 20 + jsonChunkLength);
try {
    const gltf = JSON.parse(jsonBuffer.toString('utf8'));
    if (gltf.animations) {
        gltf.animations.forEach((anim, i) => {
            console.log(`[${i}] ${anim.name}`);
        });
    } else {
         console.log("No animations found.");
    }
} catch(e) {
    console.log("Error parsing JSON:", e.message);
}
