const fs = require('fs');
const buffer = fs.readFileSync('Assets/animated.avatar.glb');
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonBuffer = buffer.slice(20, 20 + jsonChunkLength);
const gltf = JSON.parse(jsonBuffer.toString('utf8'));

if (gltf.animations) {
    gltf.animations.forEach((anim, i) => {
        let maxTime = 0;
        anim.samplers.forEach(samp => {
            const acc = gltf.accessors[samp.input];
            if (acc && acc.max && acc.max[0] > maxTime) {
                maxTime = acc.max[0];
            }
        });
        console.log(`[${i}] ${anim.name} - Duration: ${maxTime.toFixed(2)}s`);
    });
}
