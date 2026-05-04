const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    
    page.on('pageerror', err => {
        console.log('PAGE EXCEPTION:', err.toString());
        console.log('STACK:', err.stack);
    });

    try {
        await page.goto('http://127.0.0.1:5500/index.html', { waitUntil: 'networkidle0', timeout: 15000 });
    } catch (e) {
    }
    
    await new Promise(r => setTimeout(r, 2000));
    await browser.close();
})();
