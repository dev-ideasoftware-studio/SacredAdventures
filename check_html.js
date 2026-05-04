const fs = require('fs');
const html = fs.readFileSync('Component.NewJournal.html', 'utf8');
const { JSDOM } = require('jsdom');
try {
  const dom = new JSDOM(html);
  if(dom.window.document.body.innerHTML.length > 0) {
     console.log('HTML parses successfully.');
  } else {
     console.log('HTML is empty or completely broken.');
  }
} catch (e) {
  console.log('JSDOM Error: ', e.message);
}
