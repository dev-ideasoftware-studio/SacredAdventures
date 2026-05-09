const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const scriptRegex = /<script.*?>([\s\S]*?)<\/script>/gi;
let match;
let count = 0;
while ((match = scriptRegex.exec(html)) !== null) {
    fs.writeFileSync(`scratch/script_${count}.js`, match[1]);
    console.log(`Checking script ${count}...`);
    try {
        require('child_process').execSync(`node -c scratch/script_${count}.js`);
    } catch(e) {
        console.log(`Error in script ${count}:`);
        console.log(e.stdout.toString() || e.stderr.toString());
    }
    count++;
}
