const fs = require('fs');
const path = require('path');
const os = require('os');

const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
if (!fs.existsSync(brainDir)) process.exit(0);

const convos = fs.readdirSync(brainDir);
for (const convo of convos) {
    const overviewPath = path.join(brainDir, convo, '.system_generated', 'logs', 'overview.txt');
    if (fs.existsSync(overviewPath)) {
        const content = fs.readFileSync(overviewPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                if (entry.content && (entry.content.includes('js/EngineMain.js') || entry.content.includes('js/Component.BirdSystem.js'))) {
                    if (entry.type === 'CODE_ACTION' || entry.content.includes('[diff_block_start]')) {
                        console.log(`\n\n--- DIFF IN ${convo} AT ${entry.created_at} ---`);
                        console.log(entry.content);
                    }
                }
            } catch (e) {}
        }
    }
}
