const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log('BROWSER ERROR:', msg.text());
        }
    });
    page.on('pageerror', error => {
        console.log('PAGE ERROR:', error.message);
    });
    await page.goto('http://localhost:8080/index.html', { waitUntil: 'networkidle0' });
    await browser.close();
})();
