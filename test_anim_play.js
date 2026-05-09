const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage();
    page.on('console', msg => console.log('BROWSER:', msg.text()));
    await page.goto('http://127.0.0.1:8080/index.html', { waitUntil: 'networkidle0', timeout: 30000 });
    
    // wait until _isCinematic is true (meaning it loaded)
    await page.waitForFunction(() => window._isCinematic === true, { timeout: 30000 }).catch(() => {});
    
    const regResult = await page.evaluate(() => {
        if (!window.bhgMixer) return "No bhgMixer";
        let out = "BHG Actions:\n";
        const rootTracks = window.bhgMixer._root.animations || window.bhgMixer._actions.map(a => a._clip);
        
        for (const clip of rootTracks) {
            out += `Clip: ${clip.name}\n`;
            for (const track of clip.tracks) {
                if (track.name.endsWith('.position')) {
                    const y = track.values[1];
                    out += `  Pos Y: ${y}\n`;
                    break;
                }
            }
        }
        return out;
    });
    console.log(regResult);
    
    await browser.close();
})();
