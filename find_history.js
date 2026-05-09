const fs = require('fs');
const path = require('path');
const os = require('os');

const historyDir = path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'History');
if (!fs.existsSync(historyDir)) {
    console.log("History directory not found.");
    process.exit(1);
}

const folders = fs.readdirSync(historyDir);
let foundEngine = [];
let foundBird = [];

for (const folder of folders) {
    const folderPath = path.join(historyDir, folder);
    const entriesFile = path.join(folderPath, 'entries.json');
    if (fs.existsSync(entriesFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(entriesFile, 'utf8'));
            const resId = data.resource || data.id || '';
            if (resId.endsWith('EngineMain.js') && resId.includes('NEW.SACREDONES')) {
                foundEngine.push({ folder, entries: data.entries });
            }
            if (resId.endsWith('Component.BirdSystem.js') && resId.includes('NEW.SACREDONES')) {
                foundBird.push({ folder, entries: data.entries });
            }
        } catch (e) {}
    }
}

console.log('EngineMain.js backups found in folders:');
for (const f of foundEngine) {
    console.log(f.folder);
    if (f.entries && f.entries.length > 0) {
        const latest = f.entries[f.entries.length - 1];
        console.log(`Latest backup: ${latest.id} at timestamp ${latest.timestamp}`);
        console.log(`File: ${path.join(historyDir, f.folder, latest.id)}`);
    }
}

console.log('BirdSystem backups found in folders:');
for (const f of foundBird) {
    console.log(f.folder);
    if (f.entries && f.entries.length > 0) {
        const latest = f.entries[f.entries.length - 1];
        console.log(`Latest backup: ${latest.id} at timestamp ${latest.timestamp}`);
        console.log(`File: ${path.join(historyDir, f.folder, latest.id)}`);
    }
}
