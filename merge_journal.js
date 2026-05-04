const fs = require('fs');

const originalContent = fs.readFileSync('Component.NewJournal.html', 'utf8');
const newContent = fs.readFileSync('journalnewsource.html', 'utf8');

const regex = /window\.LOGBOOK_DATA = {[\s\S]*?JournalMasterAI\.initializeDatabase\(\);\s*}\);/m;

const matchOriginal = originalContent.match(regex);
if (!matchOriginal) {
    console.error('Could not find LOGBOOK_DATA in original.');
    process.exit(1);
}

const matchNew = newContent.match(regex);
if (!matchNew) {
    console.error('Could not find LOGBOOK_DATA in new.');
    process.exit(1);
}

const mergedContent = newContent.replace(regex, matchOriginal[0]);

fs.writeFileSync('Component.NewJournal.html', mergedContent);
console.log('Merged successfully!');
