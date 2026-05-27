import fs from 'fs';
const buf = fs.readFileSync('Assets/tree.glb');
console.log("Tree GLB size: " + (buf.length / 1024 / 1024).toFixed(2) + " MB");
