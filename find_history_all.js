const fs = require('fs');
const path = require('path');
const os = require('os');

const baseDirs = [
    path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'History'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'History')
];

let foundEngine = [];
let foundBird = [];

for (const historyDir of baseDirs) {
    if (!fs.existsSync(historyDir)) continue;

    const folders = fs.readdirSync(historyDir);
    for (const folder of folders) {
        const folderPath = path.join(historyDir, folder);
        const entriesFile = path.join(folderPath, 'entries.json');
        if (fs.existsSync(entriesFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(entriesFile, 'utf8'));
                let resId = data.resource || data.id || '';
                resId = resId.toLowerCase();
                if (resId.endsWith('enginemain.js')) {
                    foundEngine.push({ dir: historyDir, folder, entries: data.entries, resId });
                }
                if (resId.endsWith('component.birdsystem.js')) {
                    foundBird.push({ dir: historyDir, folder, entries: data.entries, resId });
                }
            } catch (e) {}
        }
    }
}

for (const f of foundEngine) {
    console.log(`EngineMain backup in: ${f.dir}/${f.folder} (${f.resId})`);
    for (const entry of f.entries) {
        console.log(`- ${entry.id} @ ${new Date(entry.timestamp).toISOString()} -> ${path.join(f.dir, f.folder, entry.id)}`);
    }
}
for (const f of foundBird) {
    console.log(`BirdSystem backup in: ${f.dir}/${f.folder} (${f.resId})`);
    for (const entry of f.entries) {
        console.log(`- ${entry.id} @ ${new Date(entry.timestamp).toISOString()} -> ${path.join(f.dir, f.folder, entry.id)}`);
    }
}
