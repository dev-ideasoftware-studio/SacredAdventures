const fs = require('fs');
const buffer = fs.readFileSync('Assets/yb2.glb');
// Extremely basic check for animation names in GLB JSON chunk
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonChunk = buffer.toString('utf8', 20, 20 + jsonChunkLength);
const data = JSON.parse(jsonChunk);
if (data.animations) {
    console.log("Animations found:");
    data.animations.forEach((anim, i) => console.log(`[${i}] ${anim.name}`));
} else {
    console.log("No animations found");
}
