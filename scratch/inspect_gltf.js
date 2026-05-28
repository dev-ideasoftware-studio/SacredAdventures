const fs = require('fs');

const file = 'Assets/npc/Avatar-New.glb';
const buf = fs.readFileSync(file);
const chunkLength = buf.readUInt32LE(12);
const jsonStr = buf.toString('utf8', 20, 20 + chunkLength);
const gltf = JSON.parse(jsonStr);

// Let's index nodes by index
const nodes = gltf.nodes || [];
console.log('Nodes count:', nodes.length);
nodes.forEach((n, idx) => {
  if (n.name) {
    console.log(`Node [${idx}]: "${n.name}"`);
  }
});

if (gltf.animations) {
  gltf.animations.forEach((anim, idx) => {
    console.log(`\n=== Animation [${idx}]: "${anim.name}" ===`);
    const boneTargets = {};
    anim.channels.forEach(ch => {
      const nodeIdx = ch.target.node;
      const nodeName = nodes[nodeIdx]?.name || `Node_${nodeIdx}`;
      const path = ch.target.path;
      if (!boneTargets[nodeName]) boneTargets[nodeName] = [];
      boneTargets[nodeName].push(path);
    });
    // Print top bones affected
    Object.entries(boneTargets).forEach(([bone, paths]) => {
      console.log(`  Bone "${bone}": ${paths.join(', ')}`);
    });
  });
}
