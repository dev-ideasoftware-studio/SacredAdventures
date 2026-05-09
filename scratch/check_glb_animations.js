const fs = require('fs');

function extractGltfJson(filePath) {
    const buffer = fs.readFileSync(filePath);
    const magic = buffer.readUInt32LE(0);
    if (magic !== 0x46546C67) {
        console.log(filePath, "is not a valid GLB");
        return null;
    }
    
    let chunkLength = buffer.readUInt32LE(12);
    let chunkType = buffer.readUInt32LE(16);
    if (chunkType !== 0x4E4F534A) {
        console.log(filePath, "First chunk is not JSON");
        return null;
    }
    const jsonString = buffer.toString('utf8', 20, 20 + chunkLength);
    return JSON.parse(jsonString);
}

const files = ['Assets/NPC.YB.glb', 'Assets/NPC.BHG.glb', 'Assets/NPC.REG.glb'];
for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const json = extractGltfJson(file);
    if (json && json.animations) {
        const animNames = json.animations.map(a => a.name);
        console.log(`\n${file} animations:`);
        animNames.forEach(name => console.log(`  - ${name}`));
    } else {
        console.log(`\n${file} has NO animations.`);
    }
}
