const fs = require('fs');
const content = fs.readFileSync('js/EngineMain.mjs', 'utf8');
const lines = content.split('\n');
let open = 0;
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cleanLine = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^']*'/g, '').replace(/\"[^\"]*\"/g, '').replace(/\`[^\`]*\`/g, '');
    open += (cleanLine.match(/\{/g) || []).length;
    open -= (cleanLine.match(/\}/g) || []).length;
    if (open < 0) console.log(`NEGATIVE OPEN at ${i+1}: ${line}`);
}
console.log('Final open count:', open);
