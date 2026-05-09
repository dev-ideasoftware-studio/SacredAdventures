const fs = require('fs');
const buf = fs.readFileSync('Assets/NPC.YB.glb');
const magic = buf.toString('utf8', 0, 4);
const jsonLen = buf.readUInt32LE(12);
const jsonBuf = buf.slice(20, 20 + jsonLen);
const json = JSON.parse(jsonBuf.toString('utf8'));
console.log(json.animations.map((a, i) => i + ": " + a.name));
