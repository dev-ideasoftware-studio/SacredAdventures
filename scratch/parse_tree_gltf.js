const fs = require('fs');
const gltf = JSON.parse(fs.readFileSync('Assets/PineTree/tree.glb.gltf', 'utf8').catch ? "Wait, it's a GLB, not GLTF." : "");
