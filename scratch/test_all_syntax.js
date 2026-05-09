const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(function(file) {
        if (file === 'vendor' || file === 'node_modules' || file === 'BACKUP') return;
        file = dir + '/' + file;
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory()) { 
            results = results.concat(walk(file));
        } else { 
            if (file.endsWith('.js')) results.push(file);
        }
    });
    return results;
}

const files = walk('.');
let errors = 0;
for (const file of files) {
    try {
        execSync(`node -c "${file}"`, { stdio: 'pipe' });
    } catch (e) {
        const out = e.stderr ? e.stderr.toString() : e.toString();
        // Ignore "Cannot use import statement outside a module"
        if (!out.includes('SyntaxError: Cannot use import statement outside a module') && 
            !out.includes('Warning: To load an ES module')) {
            console.error(`\n--- SYNTAX ERROR IN ${file} ---`);
            console.error(out);
            errors++;
        }
    }
}
if (errors === 0) console.log('All syntax checks passed!');
