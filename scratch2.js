const fs = require('fs');
const buffer = fs.readFileSync('Assets/animated.yellowbutterfly.glb');
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonChunk = buffer.toString('utf8', 20, 20 + jsonChunkLength);
const data = JSON.parse(jsonChunk);
if (data.animations) {
    console.log("Original Animations found:");
    data.animations.forEach((anim, i) => console.log(`[${i}] ${anim.name}`));
}
