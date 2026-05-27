import { chromium } from '@playwright/test';

async function diagnose() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`[CONSOLE ${msg.type().toUpperCase()}] ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.error('[PAGE ERROR]', err);
  });

  console.log('Navigating to http://127.0.0.1:5505/index.html...');
  await page.goto('http://127.0.0.1:5505/index.html');

  console.log('Waiting 18 seconds for boot...');
  await page.waitForTimeout(18000);

  const audit = await page.evaluate(() => {
    return {
      audit: window.AnuUniverse?.audit?.() || [],
      seenV2: localStorage.getItem('sanctuary.welcomeGuide.seenV2'),
      seenV1: localStorage.getItem('sanctuary.welcomeGuide.seenV1'),
      welcomeGuideElement: !!document.getElementById('sanctuary-welcome-guide'),
      welcomeGuideClassList: document.getElementById('sanctuary-welcome-guide')?.className,
      moondialWrapper: !!document.getElementById('moondial-wrapper'),
      v4Banner: !!document.getElementById('v4-banner'),
    };
  });

  console.log('\n--- AUDIT RESULT ---');
  console.log(JSON.stringify(audit, null, 2));

  await browser.close();
}

diagnose().catch(console.error);
