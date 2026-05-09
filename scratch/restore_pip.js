const fs = require('fs');

const headFile = fs.readFileSync('scratch/EngineMain.HEAD.js', 'utf8');
const curFile = fs.readFileSync('js/EngineMain.js', 'utf8');

// Find start and end in HEAD
const headStartMarker = "// --- COMPASS / MAP PIP RENDER ---";
const headEndMarker = "// PIP was natively rendered here AFTER Main View.";

const headStartIndex = headFile.indexOf(headStartMarker);
const headEndIndex = headFile.indexOf(headEndMarker, headStartIndex);

if (headStartIndex === -1 || headEndIndex === -1) {
    console.error("Could not find markers in HEAD file.");
    process.exit(1);
}

const headBlock = headFile.substring(headStartIndex, headEndIndex);

// Find start and end in CURRENT
const curStartMarker = "// --- COMPASS / MAP PIP RENDER (THROTTLED) ---";
const curEndMarker = "// PIP was natively rendered here AFTER Main View.";

const curStartIndex = curFile.indexOf(curStartMarker);
const curEndIndex = curFile.indexOf(curEndMarker, curStartIndex);

if (curStartIndex === -1 || curEndIndex === -1) {
    console.error("Could not find markers in CURRENT file.");
    process.exit(1);
}

const newFileContent = curFile.substring(0, curStartIndex) + headBlock + curFile.substring(curEndIndex);

fs.writeFileSync('js/EngineMain.js', newFileContent);
console.log("Replaced block successfully!");
