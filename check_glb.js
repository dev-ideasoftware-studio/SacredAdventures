const fs = require('fs');
const gltfPipeline = require('gltf-pipeline');
const glbToGltf = gltfPipeline.glbToGltf;

const glb = fs.readFileSync('Assets/NPC.YB.glb');
glbToGltf(glb).then(function(results) {
    const gltf = results.gltf;
    if (gltf.animations) {
        gltf.animations.forEach((anim, i) => {
            console.log(`Animation ${i}: ${anim.name}`);
        });
    } else {
        console.log("No animations found.");
    }
}).catch(e => console.error(e));
