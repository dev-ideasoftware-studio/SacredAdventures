const fs = require('fs');

let html = fs.readFileSync('Component.NewJournal.html', 'utf8');

const resIndicatorLogic = `
        /* --- RESOLUTION INDICATOR --- */
        function updateResIndicator() {
            const el = document.getElementById('res-indicator');
            if (!el) return;
            const w = window.innerWidth;
            const h = window.innerHeight;
            let mode = 'Desktop';
            if (w <= 400) mode = 'Mobile';
            else if (w <= 860) mode = 'Tablet';
            else if (w <= 1024) mode = 'Tablet';
            el.textContent = \`\${w}×\${h} \${mode}\`;
        }
        window.addEventListener('resize', updateResIndicator);
        updateResIndicator();
`;

// Insert it right after submitLogbookChat
const submitEndRegex = /function submitLogbookChat\(\) \{[\s\S]*?\}\s*catch \(e\) \{ \}\s*inputEl\.value = ''; inputEl\.blur\(\);\s*const announcer = document\.getElementById\('sr-announcer'\);\s*if \(announcer\) announcer\.textContent = "Command submitted\.";\s*\}/m;
if (!html.includes('updateResIndicator()')) {
    html = html.replace(submitEndRegex, match => match + '\n' + resIndicatorLogic);
}

fs.writeFileSync('Component.NewJournal.html', html);
console.log('Restored Resolution Indicator.');
