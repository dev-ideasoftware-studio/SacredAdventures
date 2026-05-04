const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('console', msg => console.log('LOG:', msg.text()));
    page.on('pageerror', err => console.log('ERR:', err.message));
    
    await page.goto('http://127.0.0.1:8000/index.html', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 10000));
    
    const status = await page.evaluate(() => {
        return {
            assetComplete: window._assetDownloadsComplete,
            worldComplete: window._worldGenerationComplete,
            logbookReady: window.customScriptsReady
        };
    });
    console.log("STATUS:", status);
    await browser.close();
})();
