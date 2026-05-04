const fs = require('fs');

const headHtml = fs.readFileSync('Component.NewJournal.html', 'utf8');
const newHtml = fs.readFileSync('journalnewsource.html', 'utf8');

let result = newHtml;

// 1. Fix Tailwind CDN -> Compiled Styles + offline fonts/three.js
const headImportsRegex = /<script>\s*const originalWarn[\s\S]*?<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"><\/script>/m;
const headImportsHead = `<link rel="stylesheet" href="vendor/fa/all.min.css">
    <link href="vendor/fonts/google-fonts.css" rel="stylesheet" />
    <script src="vendor/three/three.r128.min.js"></script>`;
result = result.replace(headImportsRegex, headImportsHead);

// We also need to copy the massive Tailwind CSS block from HEAD.
// It starts with /* Layout */ and ends before .book-content {
const tailwindRegex = /\/\* Layout \*\/[\s\S]*?(?=\.book-content \{)/m;
const tailwindMatch = headHtml.match(tailwindRegex);
if (tailwindMatch) {
    result = result.replace(/<style>\s*:root {/, `<style>\n        ${tailwindMatch[0]}\n        :root {`);
}

// 2. Fix images
result = result.replace(/https:\/\/www\.transparenttextures\.com\/patterns\/cream-paper\.png/g, 'vendor/textures/cream-paper.png');
result = result.replace(/\.\/Assets\/Journal\.CoverPage\.png/g, './Assets/Journal.Cover.png');
result = result.replace(/https:\/\/www\.sacredones\.org\/SacredAdventures\/Assets\/AnimatedOpening\.mp4/g, './Assets/AnimatedOpening.mp4');

// 3. Inject Buildings Tab
const buildingsTabRegex = /<div class="book-tab" role="tab" tabindex="0" id="tab-buildings"[\s\S]*?<\/div>/;
const buildingsMatch = headHtml.match(buildingsTabRegex);
if (buildingsMatch) {
    const destBestiaryRegex = /<div class="book-tab" role="tab" tabindex="0" id="tab-bestiary"[\s\S]*?<\/div>/;
    const destBestiaryMatch = result.match(destBestiaryRegex);
    if (destBestiaryMatch) {
        result = result.slice(0, destBestiaryMatch.index + destBestiaryMatch[0].length) + '\n                        ' + buildingsMatch[0] + result.slice(destBestiaryMatch.index + destBestiaryMatch[0].length);
    }
}

// 4. Inject LOGBOOK_DATA and JournalMasterAI
const logbookRegexOriginal = /window\.LOGBOOK_DATA = {[\s\S]*?JournalMasterAI\.initializeDatabase\(\);\s*}\);/m;
const logbookRegexNew = /window\.LOGBOOK_DATA = {[\s\S]*?JournalMasterAI\.initializeDatabase\(\);\s*}\);/m;
const logbookMatch = headHtml.match(logbookRegexOriginal);
if (logbookMatch) {
    result = result.replace(logbookRegexNew, logbookMatch[0]);
}

// 5. Inject scheduleAlign and Observers
const alignLoopRegexOriginal = /function scheduleAlign\(\) {[\s\S]*?attributes: true, attributeFilter: \['style', 'class'\] }\);\s*}\s*}\);/m;
const alignLoopRegexNew = /let lastAlignTime = 0;\s*function alignLoop\(timestamp\) {[\s\S]*?requestAnimationFrame\(alignLoop\);/m;
const alignMatch = headHtml.match(alignLoopRegexOriginal);
if (alignMatch) {
    result = result.replace(alignLoopRegexNew, alignMatch[0]);
}

// 6. Inject message listeners (SHOW_BUILDING_INFO, YB_GREETING_ARRIVED, etc.)
// We want to replace the switch_tab/add_page part up to the end of the script
const messageListenersOriginal = /if \(d\.type === 'SWITCH_TAB'\) if \(typeof window\.switchBookTab === 'function'\) window\.switchBookTab\(d\.tab\);\s*if \(d\.type === 'ADD_PAGE'\) window\.addPage\(d\.category, d\.title, d\.text, d\.state, d\.imageUrl, d\.videoUrl, d\.buttonLabel, d\.buttonAction\);[\s\S]*?\}\);/m;
const messageListenersNew = /if \(d\.type === 'SWITCH_TAB'\) if \(typeof window\.switchBookTab === 'function'\) window\.switchBookTab\(d\.tab\);\s*if \(d\.type === 'ADD_PAGE'\) window\.addPage\(d\.category, d\.title, d\.text, d\.state, d\.imageUrl, d\.videoUrl, d\.buttonLabel, d\.buttonAction\);[\s\S]*?\}\);/m;
const messageMatch = headHtml.match(messageListenersOriginal);
if (messageMatch) {
    result = result.replace(messageListenersNew, messageMatch[0]);
}

fs.writeFileSync('Component.NewJournal.html', result);
console.log('Fixed images, fonts, styles, and logic.');
