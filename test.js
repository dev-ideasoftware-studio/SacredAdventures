const fs = require('fs');
const content = fs.readFileSync('js/EngineMain.mjs', 'utf8');
const lines = content.split('\n');
let open = 0;
for (let i = 4580; i <= 4815; i++) {
    const line = lines[i];
    if (!line) continue;
    const cleanLine = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^']*'/g, '').replace(/\"[^\"]*\"/g, '').replace(/\`[^\`]*\`/g, '');
    open += (cleanLine.match(/\{/g) || []).length;
    open -= (cleanLine.match(/\}/g) || []).length;
    console.log(`${i+1}: open=${open} -> ${line}`);
}
