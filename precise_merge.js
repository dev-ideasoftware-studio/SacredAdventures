const fs = require('fs');

const srcStr = fs.readFileSync('journalnewsource.html', 'utf8');
const tgtStr = fs.readFileSync('Component.NewJournal.html', 'utf8');

// Find the start of the 3D logic
const startToken = 'function createBookGeo(w, l, d, r) {';
// Find the end of alignCameraToDOM
const endToken = 'const raycaster = new THREE.Raycaster();';

const srcStartIdx = srcStr.indexOf(startToken);
const srcEndIdx = srcStr.indexOf(endToken);

if(srcStartIdx === -1 || srcEndIdx === -1) {
    console.log("Tokens not found in source.");
    process.exit(1);
}

const goodLogic = srcStr.substring(srcStartIdx, srcEndIdx);

const tgtStartIdx = tgtStr.indexOf(startToken);
const tgtEndIdx = tgtStr.indexOf(endToken);

if(tgtStartIdx === -1 || tgtEndIdx === -1) {
    console.log("Tokens not found in target.");
    process.exit(1);
}

const newTgtStr = tgtStr.substring(0, tgtStartIdx) + goodLogic + tgtStr.substring(tgtEndIdx);

fs.writeFileSync('Component.NewJournal.html', newTgtStr);
console.log("Successfully transplanted the good 3D logic from journalnewsource.html into Component.NewJournal.html.");
