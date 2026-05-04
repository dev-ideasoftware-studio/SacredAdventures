const fs = require('fs');
const html = fs.readFileSync('Component.NewJournal.html', 'utf8');
const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gm;
let match;
let i = 1;
while ((match = scriptRegex.exec(html)) !== null) {
    const code = match[1];
    if(code.trim().length === 0) continue;
    try {
        new Function(code);
        console.log('Script ' + i + ' OK');
    } catch (e) {
        console.error('Syntax Error in Script ' + i + ':', e);
    }
    i++;
}
